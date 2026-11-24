import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/server/auth";
import { askAssistant } from "@/server/core/assistant";
import { can, ForbiddenError, RuleError } from "@/server/core/permissions";
import { prisma } from "@/server/db";

export const maxDuration = 120;

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20000) })).min(1).max(60),
});

/** Ask the AI assistant. JSON only, same-origin only (blocks cross-site form posts). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(user, "assistant", "view")) return NextResponse.json({ error: "You don't have access to the AI assistant." }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  if (!req.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ error: "JSON expected" }, { status: 415 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const reply = await askAssistant(prisma, user, parsed.data.messages);
    return NextResponse.json(reply);
  } catch (e) {
    if (e instanceof RuleError || e instanceof ForbiddenError) {
      console.warn(`assistant: request by ${user.id} failed: ${e.message}`); // reason in the server log (never the key)
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("assistant failed", e);
    return NextResponse.json({ error: "Something went wrong while answering. Please try again." }, { status: 500 });
  }
}
