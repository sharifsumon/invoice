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

/** Per-call limit: a stuck call is abandoned and treated as "busy" so retry / backup model kick in quickly. */
export const CALL_TIMEOUT_MS = 25_000;

function mapError(status: number, msg: string): never {
  if (status === 400 && /API key/i.test(msg)) throw new RuleError("Google rejected the API key. Check it under Settings → AI assistant.");
  if (status === 403) throw new RuleError(`Google AI refused the request: ${msg}`);
  if (status === 404) throw new RuleError(`The AI model was not found: ${msg}. Pick another model under Settings → AI assistant.`);
  if (status === 429) {
    if (/quota|billing|exceeded your current/i.test(msg)) throw new RuleError("The Google AI quota for this API key is used up. Wait for it to reset, or enable billing on the key's Google project.");
    throw new AiBusyError("rate limit");
  }
  if (status === 503 || status === 500 || status === 504 || /high demand|overloaded|unavailable/i.test(msg)) throw new AiBusyError("high demand");
  throw new RuleError(`Google AI error: ${msg}`);
}

async function request(apiKey: string, pathAndQuery: string, init: RequestInit, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${API}/${pathAndQuery}`, {
      ...init,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey, ...(init.headers ?? {}) },
      signal,
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new AiBusyError("no reply within 25 seconds");
    throw new RuleError(`Could not reach Google AI (${e instanceof Error ? e.message : "network error"}). Check the internet connection.`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    mapError(res.status, body.error?.message ?? `HTTP ${res.status}`);
  }
  return res;
}

async function call(apiKey: string, pathAndQuery: string, init: RequestInit = {}) {
  const res = await request(apiKey, pathAndQuery, init, AbortSignal.timeout(CALL_TIMEOUT_MS));
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

type GenReq = { system: string; contents: GeminiContent[]; tools?: FunctionDeclaration[] };
type Chunk = { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };

/**
 * One model turn, streamed (server-sent events). `onText` receives answer text as it arrives.
 * Returns the full turn (all parts, verbatim, so thought signatures round-trip).
 */
export async function generate(apiKey: string, model: string, req: GenReq, onText?: (delta: string) => void): Promise<GeminiContent> {
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const res = await request(apiKey, `models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents,
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
      generationConfig: { temperature: 0.2 },
    }),
  }, signal);

  const parts: GeminiPart[] = [];
  let finish: string | undefined;
  let blocked: string | undefined;
  const take = (c: Chunk) => {
    if (c.promptFeedback?.blockReason) blocked = c.promptFeedback.blockReason;
    const cand = c.candidates?.[0];
    if (cand?.finishReason) finish = cand.finishReason;
    for (const p of cand?.content?.parts ?? []) {
      parts.push(p);
      if (p.text && !p.thought) onText?.(p.text);
    }
  };
  try {
    if (!res.body) take((await res.json()) as Chunk);
    else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line.startsWith("data:")) { try { take(JSON.parse(line.slice(5)) as Chunk); } catch { /* partial / keep-alive */ } }
        }
      }
      if (buf.trim().startsWith("data:")) { try { take(JSON.parse(buf.trim().slice(5)) as Chunk); } catch { /* ignore */ } }
    }
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new AiBusyError("no reply within 25 seconds");
    throw e;
  }
  if (!parts.length) {
    if (blocked) throw new RuleError(`Google AI blocked this request (${blocked}).`);
    if (finish && finish !== "STOP") throw new RuleError(`Google AI stopped without an answer (${finish}). Try rephrasing.`);
    return { role: "model", parts: [{ text: "" }] };
  }
  return { role: "model", parts };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Backup models tried (in order) when the chosen one stays overloaded. */
export const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"];

/**
 * generate() with resilience: retries a busy model (default after 1 s, then 3 s); if still busy and
 * `allowFallback` is set, tries the backup models. Only retries before any text has streamed to the user.
 */
export async function generateResilient(apiKey: string, model: string, req: GenReq, opts: { allowFallback: boolean; delays?: number[]; onText?: (d: string) => void }) {
  const delays = opts.delays ?? [1000, 3000];
  const candidates = [model, ...(opts.allowFallback ? FALLBACK_MODELS.filter((m) => m !== model) : [])];
  let last: unknown;
  let streamed = false;
  const onText = opts.onText ? (d: string) => { streamed = true; opts.onText!(d); } : undefined;
  for (const m of candidates) {
    for (let attempt = 0; attempt <= (m === model ? delays.length : 0); attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        return { reply: await generate(apiKey, m, req, onText), model: m };
      } catch (e) {
        last = e;
        if (streamed) throw e; // the user already saw part of an answer — don't start over silently
        if (!(e instanceof AiBusyError)) {
          if (m !== model) break; // a backup model that doesn't exist for this key — try the next one
          throw e;
        }
        console.warn(`assistant: ${m} busy (attempt ${attempt + 1}): ${(e as Error).message}`);
      }
    }
  }
  throw last;
}

/** Models this key can use for chat (generateContent), newest names first. */
export async function listModels(apiKey: string): Promise<{ name: string; label: string }[]> {
  const body = await call(apiKey, "models?pageSize=200") as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|robotics|banana|vision|veo|imagen|computer-use|transcribe|customtools/i.test(m.name))
    .map((m) => ({ name: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}
