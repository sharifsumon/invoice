import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/server/auth";
import { askAssistant, type AssistantEvent } from "@/server/core/assistant";
import { can, ForbiddenError, RuleError } from "@/server/core/permissions";
import { prisma } from "@/server/db";

export const maxDuration = 120;

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20000) })).min(1).max(60),
});

/**
 * Ask the AI assistant. JSON in, newline-delimited JSON out (streamed):
 *   {"type":"step","label":"…"} · {"type":"text","delta":"…"} · {"type":"reset"} · {"type":"done", text, files} · {"type":"error", error}
 * Same-origin JSON only (blocks cross-site form posts).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(user, "assistant", "view")) return NextResponse.json({ error: "You don't have access to the AI assistant." }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  if (!req.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "JSON expected" }, { status: 415 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: AssistantEvent | Record<string, unknown>) => {
        try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client went away */ }
      };
      try {
        const reply = await askAssistant(prisma, user, parsed.data.messages, { onEvent: send });
        send({ type: "done", ...reply });
      } catch (e) {
        if (e instanceof RuleError || e instanceof ForbiddenError) {
          console.warn(`assistant: request by ${user.id} failed: ${e.message}`); // reason in the server log (never the key)
          send({ type: "error", error: e.message });
        } else {
          console.error("assistant failed", e);
          send({ type: "error", error: "Something went wrong while answering. Please try again." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
