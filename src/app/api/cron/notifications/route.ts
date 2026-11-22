import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { scanDueNotifications } from "@/server/core/notifications";
import { prisma } from "@/server/db";

/**
 * For a scheduler (cron, systemd timer): POST with `Authorization: Bearer $CRON_SECRET`.
 * Creates due-soon / overdue notifications; safe to run any number of times.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new NextResponse("CRON_SECRET not configured", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new NextResponse("Unauthorized", { status: 401 });
  const created = await scanDueNotifications(prisma);
  return NextResponse.json({ ok: true, created });
}
