import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { servedInvoicePdf } from "@/server/core/invoices";
import { prisma } from "@/server/db";

/** Draft preview, the stored finalized PDF, or — once paid/part-paid — that PDF with a payment summary. */
export async function GET(req: Request, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "invoices", "view")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const exists = await prisma.invoice.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return new NextResponse("Not found", { status: 404 });
  const { pdf, name } = await servedInvoicePdf(prisma, id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  if (download) {
    await prisma.auditLog.create({ data: { actorId: user.id, action: "invoice.downloaded", entityType: "Invoice", entityId: id } });
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
