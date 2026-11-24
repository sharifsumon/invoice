import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { loadFile } from "@/server/core/storage";
import { prisma } from "@/server/db";

/** Payment receipts are private files; served only to users who can view invoices. */
export async function GET(_req: Request, ctx: RouteContext<"/api/payments/[id]/receipt">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "invoices", "view")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p?.receiptPath || !p.receiptMime) return new NextResponse("Not found", { status: 404 });
  const data = await loadFile(p.receiptPath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": p.receiptMime,
      "Content-Disposition": `inline; filename="${(p.receiptName ?? "receipt").replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
