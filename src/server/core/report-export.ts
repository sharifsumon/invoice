import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatMoney } from "./money";
import { isLink, isMoney, type Cell, type ReportResult } from "./reports";

/** Flatten a report into plain rows. Money columns become [currency, amount] (+ converted when a reporting currency is set). */
export function flatten(r: ReportResult): { header: string[]; rows: (string | number)[][]; numeric: boolean[] } {
  const header: string[] = [];
  const numeric: boolean[] = [];
  for (const c of r.columns) {
    if (c.kind === "money") {
      header.push(`${c.label} currency`, c.label); numeric.push(false, true);
      if (r.reportingCurrency) { header.push(`${c.label} (${r.reportingCurrency})`); numeric.push(true); }
    } else { header.push(c.label); numeric.push(c.kind === "number"); }
  }
  const rows = r.rows.map((row) => {
    const out: (string | number)[] = [];
    for (const c of r.columns) {
      const v = row[c.key];
      if (c.kind === "money") {
        if (isMoney(v)) {
          out.push(v.currency, Number(v.amount.toFixed(2)));
          if (r.reportingCurrency) out.push(v.converted != null ? Number(v.converted.toFixed(2)) : "no rate");
        } else { out.push("", ""); if (r.reportingCurrency) out.push(""); }
      } else out.push(text(v));
    }
    return out;
  });
  return { header, rows, numeric };
}

export function text(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (isLink(v)) return v.text;
  if (isMoney(v)) return formatMoney(v.amount, v.currency);
  return String(v);
}

export function toCsv(r: ReportResult) {
  const { header, rows } = flatten(r);
  const esc = (x: string | number) => {
    let s = String(x);
    if (typeof x === "string" && /^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = `'${s}`; // formula-injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

export async function toXlsx(title: string, r: ReportResult) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const { header, rows, numeric } = flatten(r);
  ws.addRow([title]).font = { bold: true, size: 13 };
  for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  ws.addRow(header).font = { bold: true };
  for (const row of rows) ws.addRow(row);
  numeric.forEach((isNum, i) => { if (isNum) ws.getColumn(i + 1).numFmt = "#,##0.00"; });
  ws.columns.forEach((c) => { c.width = 18; });
  ws.addRow([]);
  for (const [key, list] of Object.entries(r.totals)) {
    const col = r.columns.find((c) => c.key === key)!;
    for (const t of list) ws.addRow([`Total ${col.label}`, t.currency, Number(t.amount.toFixed(2))]).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(title: string, subtitle: string, r: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 36, R = doc.page.width - 36, W = R - L, bottom = doc.page.height - 48;
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(title, L, 36);
    doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(subtitle, { width: W });
    for (const n of r.notes) doc.text(n, { width: W });
    doc.moveDown(0.6);

    const cols = r.columns;
    const weight = (k: string) => (k === "money" ? 1.4 : k === "date" ? 0.9 : k === "number" ? 0.7 : 1.3);
    const totalW = cols.reduce((a, c) => a + weight(c.kind), 0);
    const widths = cols.map((c) => (weight(c.kind) / totalW) * W);
    const cellText = (c: (typeof cols)[number], v: Cell) => {
      if (c.kind === "money" && isMoney(v)) {
        if (r.reportingCurrency) return v.converted != null ? formatMoney(v.converted, r.reportingCurrency) : `${formatMoney(v.amount, v.currency)} (no rate)`;
        return formatMoney(v.amount, v.currency);
      }
      return text(v);
    };

    const drawHeader = () => {
      let x = L; const y = doc.y;
      doc.rect(L, y - 2, W, 16).fill("#f1f5f9");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#333");
      cols.forEach((c, i) => { doc.text(c.label.toUpperCase(), x + 3, y + 2, { width: widths[i] - 6, align: c.kind === "money" || c.kind === "number" ? "right" : "left", lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = y + 18;
    };
    drawHeader();
    doc.font("Helvetica").fontSize(7.5).fillColor("#111");
    for (const row of r.rows) {
      const texts = cols.map((c) => cellText(c, row[c.key]));
      const h = Math.max(...texts.map((t, i) => doc.heightOfString(t || " ", { width: widths[i] - 6 }))) + 5;
      if (doc.y + h > bottom) { doc.addPage(); doc.y = 36; drawHeader(); doc.font("Helvetica").fontSize(7.5).fillColor("#111"); }
      const y = doc.y; let x = L;
      texts.forEach((t, i) => { doc.text(t, x + 3, y + 2, { width: widths[i] - 6, align: cols[i].kind === "money" || cols[i].kind === "number" ? "right" : "left" }); x += widths[i]; });
      doc.moveTo(L, y + h).lineTo(R, y + h).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      doc.y = y + h + 1;
    }
    if (!r.rows.length) doc.font("Helvetica-Oblique").text("No rows match the selected filters.", L, doc.y + 6);

    const totalLines = Object.entries(r.totals).flatMap(([k, list]) => {
      const col = cols.find((c) => c.key === k)!;
      return list.map((t) => `${col.label}: ${formatMoney(t.amount, t.currency)}`);
    });
    if (totalLines.length) {
      if (doc.y + 14 * (totalLines.length + 1) > bottom) { doc.addPage(); doc.y = 36; }
      doc.moveDown(0.8).font("Helvetica-Bold").fontSize(9).fillColor("#111").text("Totals", L);
      doc.font("Helvetica").fontSize(8.5);
      for (const l of totalLines) doc.text(l, L);
    }
    doc.end();
  });
}
