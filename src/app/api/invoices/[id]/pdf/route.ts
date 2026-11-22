import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { buildSnapshot, loadLogo } from "@/server/core/invoices";
import { renderInvoicePdf } from "@/server/core/pdf";
import { loadFile } from "@/server/core/storage";
import { prisma } from "@/server/db";

/**
 * Finalized invoices: always serve the stored PDF (same artifact for preview, download, print, email).
 * Drafts: render a live preview watermarked DRAFT.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "invoices", "view")) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { documents: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!inv) return new NextResponse("Not found", { status: 404 });

  let pdf: Buffer;
  let name: string;
  if (inv.documents[0]) {
    pdf = await loadFile(inv.documents[0].filePath);
    name = `${inv.invoiceNumber}.pdf`;
  } else {
    const { snap, logoPath } = await buildSnapshot(prisma, id);
    pdf = await renderInvoicePdf(snap, { logo: await loadLogo(logoPath), draft: true });
    name = `DRAFT-${id}.pdf`;
  }
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
