import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { audit, inTx, type Actor, type Db } from "./common";
import { can, ForbiddenError, RuleError } from "./permissions";

/**
 * Google Gemini access for the AI assistant. The API key is stored AES-256-GCM encrypted (key derived from
 * AUTH_SECRET) and never sent back to the browser. GEMINI_API_KEY in the environment is used when none is saved.
 */
const API = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-flash-latest";

function cryptoKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return createHash("sha256").update(`ai-api-key:${s}`).digest();
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(blob: string): string | null {
  try {
    const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", cryptoKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null; // AUTH_SECRET changed or data corrupted — the key must be entered again
  }
}

export async function aiConfig(db: Db): Promise<{ apiKey: string | null; model: string; source: "settings" | "env" | null }> {
  const c = await db.companySettings.findUnique({ where: { id: 1 }, select: { aiApiKeyEnc: true, aiModel: true } });
  const saved = c?.aiApiKeyEnc ? decryptSecret(c.aiApiKeyEnc) : null;
  const env = process.env.GEMINI_API_KEY?.trim() || null;
  return { apiKey: saved ?? env, model: c?.aiModel || DEFAULT_MODEL, source: saved ? "settings" : env ? "env" : null };
}

export const aiSettingsInput = z.object({
  /** Blank = keep the saved key. */
  apiKey: z.string().trim().max(300).optional(),
  model: z.string().trim().min(1, "Choose a model").max(100).regex(/^[\w.\-/]+$/, "Model name may contain letters, digits, . - _ /"),
  removeKey: z.boolean().optional(),
});

export async function updateAiSettings(db: Db, actor: Actor, raw: z.input<typeof aiSettingsInput>) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  const d = aiSettingsInput.parse(raw);
  const model = d.model.replace(/^models\//, "");
  // Check the model against what Google offers this key, so a typo or a retired model can't be saved
  const key = d.removeKey ? null : d.apiKey || (await aiConfig(db)).apiKey;
  if (key) {
    const available = await listModels(key);
    if (!available.some((m) => m.name === model)) {
      throw new RuleError(`"${model}" isn't available to this API key. Choose a model from the list (e.g. ${available.find((m) => m.name === DEFAULT_MODEL)?.name ?? available[0]?.name ?? DEFAULT_MODEL}).`);
    }
  }
  return inTx(db, async (tx) => {
    await tx.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const data: { aiModel: string; aiApiKeyEnc?: string | null } = { aiModel: model };
    if (d.removeKey) data.aiApiKeyEnc = null;
    else if (d.apiKey) data.aiApiKeyEnc = encryptSecret(d.apiKey);
    await tx.companySettings.update({ where: { id: 1 }, data });
    // Never log the key itself
    await audit(tx, actor, "settings.ai.updated", "CompanySettings", "1", { after: { model, keyChanged: !!d.apiKey || !!d.removeKey } });
  });
}

// ───────────── Gemini REST ─────────────

export type GeminiPart = {
  text?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  thought?: boolean;
  thoughtSignature?: string;
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type FunctionDeclaration = { name: string; description: string; parameters?: Record<string, unknown> };

/** Google is temporarily overloaded or rate-limited — worth retrying (or trying another model). */
export class AiBusyError extends RuleError {
  constructor(detail: string) {
    super(`Google's AI service is busy right now (${detail}). Please try again in a minute.`);
    this.name = "AiBusyError";
  }
}

async function call(apiKey: string, pathAndQuery: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(`${API}/${pathAndQuery}`, {
      ...init,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new RuleError(`Could not reach Google AI (${e instanceof Error ? e.message : "network error"}). Check the internet connection.`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } } & Record<string, unknown>;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new RuleError("Google rejected the API key. Check it under Settings → AI assistant.");
    if (res.status === 403) throw new RuleError(`Google AI refused the request: ${msg}`);
    if (res.status === 404) throw new RuleError(`The AI model was not found: ${msg}. Pick another model under Settings → AI assistant.`);
    if (res.status === 429) {
      if (/quota|billing|exceeded your current/i.test(msg)) throw new RuleError("The Google AI quota for this API key is used up. Wait for it to reset, or enable billing on the key's Google project.");
      throw new AiBusyError("rate limit");
    }
    if (res.status === 503 || res.status === 500 || res.status === 504 || /high demand|overloaded|unavailable/i.test(msg)) throw new AiBusyError("high demand");
    throw new RuleError(`Google AI error: ${msg}`);
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Backup models tried (in order) when the chosen one stays overloaded. */
export const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];

/**
 * generate() with resilience: retries a busy model twice (1 s, then 3 s); if it is still busy and `allowFallback`
 * is set, tries the backup models. Returns the reply and the model that produced it.
 */
export async function generateResilient(apiKey: string, model: string, req: Parameters<typeof generate>[2], opts: { allowFallback: boolean; delays?: number[] }) {
  const delays = opts.delays ?? [1000, 3000];
  const candidates = [model, ...(opts.allowFallback ? FALLBACK_MODELS.filter((m) => m !== model) : [])];
  let last: unknown;
  for (const m of candidates) {
    for (let attempt = 0; attempt <= (m === model ? delays.length : 0); attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        return { reply: await generate(apiKey, m, req), model: m };
      } catch (e) {
        last = e;
        if (!(e instanceof AiBusyError)) {
          if (m !== model) break; // a backup model that doesn't exist for this key — try the next one
          throw e;
        }
        console.warn(`assistant: ${m} busy (attempt ${attempt + 1})`);
      }
    }
  }
  throw last;
}

export async function generate(apiKey: string, model: string, req: {
  system: string; contents: GeminiContent[]; tools?: FunctionDeclaration[];
}): Promise<GeminiContent> {
  const body = await call(apiKey, `models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents,
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
      generationConfig: { temperature: 0.2 },
    }),
  }) as { candidates?: { content?: GeminiContent; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const cand = body.candidates?.[0];
  if (!cand?.content?.parts) {
    if (body.promptFeedback?.blockReason) throw new RuleError(`Google AI blocked this request (${body.promptFeedback.blockReason}).`);
    if (cand?.finishReason && cand.finishReason !== "STOP") throw new RuleError(`Google AI stopped without an answer (${cand.finishReason}). Try rephrasing.`);
    return { role: "model", parts: [{ text: "" }] };
  }
  return { role: "model", parts: cand.content.parts };
}

/** Models this key can use for chat (generateContent), newest names first. */
export async function listModels(apiKey: string): Promise<{ name: string; label: string }[]> {
  const body = await call(apiKey, "models?pageSize=200") as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|robotics|banana|vision|veo|imagen|computer-use|transcribe|customtools/i.test(m.name))
    .map((m) => ({ name: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}
