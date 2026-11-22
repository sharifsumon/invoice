import { access, constants, mkdir } from "node:fs/promises";
import { NextResponse } from "next/server";
import { storageRoot } from "@/server/core/storage";
import { prisma } from "@/server/db";

/** Unauthenticated liveness/readiness probe for load balancers and uptime monitors. Reveals nothing sensitive. */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = { database: "fail", storage: "fail" };
  try { await prisma.$queryRaw`SELECT 1`; checks.database = "ok"; } catch { /* reported below */ }
  try { await mkdir(storageRoot(), { recursive: true }); await access(storageRoot(), constants.W_OK); checks.storage = "ok"; } catch { /* reported below */ }
  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
