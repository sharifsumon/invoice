import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { isOverdue } from "@/server/core/invoices";
import { prisma } from "@/server/db";
import { filtersToWhere, invoiceListInclude, readFilters } from "@/server/invoice-list";
import { outstandingOf } from "@/server/core/money";

/** Invoice register export (CSV or XLSX), honoring the same filters as the list page. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "invoices", "export")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const invoices = await prisma.invoice.findMany({
    where: filtersToWhere(readFilters(sp)), include: invoiceListInclude, orderBy: { createdAt: "desc" }, take: 20000,
  });
  const header = ["Invoice No", "Status", "Overdue", "Type", "Client", "Project Code", "Project", "PO No", "Invoice Date", "Due Date",
    "Currency", "Subtotal", "Discount", "Tax", "Total", "Paid", "Balance", "Version"];
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  const rows = invoices.map((i) => [
    i.invoiceNumber ?? "DRAFT", i.status, isOverdue(i) ? "YES" : "", i.kind, i.client.name, i.project.code, i.project.name, i.po.poNumber,
    d(i.invoiceDate), d(i.dueDate), i.currency, i.subtotal.toFixed(2), i.discount.toFixed(2), i.taxAmount.toFixed(2), i.total.toFixed(2),
    i.amountPaid.toFixed(2), i.status === "CANCELLED" ? "0.00" : outstandingOf(i).toFixed(2), String(i.version),
  ]);
  await prisma.auditLog.create({
    data: { actorId: user.id, action: "invoice.exported", entityType: "Invoice", entityId: "*", after: { format: sp.format ?? "csv", rows: rows.length, filters: sp } },
  });
  const stamp = new Date().toISOString().slice(0, 10);

  if (sp.format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Invoices");
    ws.addRow(header).font = { bold: true };
    for (const r of rows) ws.addRow(r.map((v, idx) => (idx >= 11 && idx <= 16 ? Number(v) : v)));
    ws.columns.forEach((c) => { c.width = 16; });
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="invoices-${stamp}.xlsx"`,
      },
    });
  }

  // CSV — neutralize spreadsheet formula injection in text cells.
  const esc = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) && isNaN(Number(v)) ? `'${v}` : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="invoices-${stamp}.csv"` },
  });
}
