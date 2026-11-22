import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { loadFile } from "@/server/core/storage";
import { prisma } from "@/server/db";

/** Bulk download of finalized invoice PDFs as a ZIP (POST with ids[]). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "invoices", "export")) return new NextResponse("Forbidden", { status: 403 });

  const fd = await req.formData();
  const ids = fd.getAll("ids").map(String).slice(0, 500);
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    include: { documents: { orderBy: { version: "desc" }, take: 1 } },
  });
  const withPdf = invoices.filter((i) => i.documents[0]);
  if (!withPdf.length) return new NextResponse("None of the selected invoices has been finalized yet.", { status: 400 });

  const zip = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  zip.pipe(out);
  for (const inv of withPdf) {
    zip.append(await loadFile(inv.documents[0].filePath), { name: `${(inv.invoiceNumber ?? inv.id).replace(/[^\w.-]/g, "_")}.pdf` });
  }
  void zip.finalize();
  const chunks: Buffer[] = [];
  for await (const c of out) chunks.push(c as Buffer);

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "invoice.bulk_downloaded", entityType: "Invoice", entityId: "*", after: { ids: withPdf.map((i) => i.id) } },
  });
  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.zip"` },
  });
}
