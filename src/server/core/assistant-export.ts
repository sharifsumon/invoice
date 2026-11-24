import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, PageOrientation } from "docx";
import { formatMoney } from "./money";
import { saveFile } from "./storage";

/** A plain table produced by an assistant tool or composed by the model. */
export type ColKind = "text" | "number" | "money" | "date";
export interface DataTable {
  columns: { key: string; label: string; kind: ColKind }[];
  rows: Record<string, string | number | null>[];
  notes?: string[];
  /** Totals per money/number column (computed in code, never by the model). */
  totals?: Record<string, number>;
  currency?: string;
}
export type ExportFormat = "xlsx" | "docx" | "pdf";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/** Recompute totals for numeric columns so exported totals are always exact. */
export function withTotals(t: DataTable): DataTable {
  const totals: Record<string, number> = {};
  for (const c of t.columns) {
    if (c.kind !== "money" && c.kind !== "number") continue;
    if (/(%|percent|rate|count|days|#)/i.test(c.label) && c.kind === "number") continue;
    let s = 0;
    for (const r of t.rows) { const v = Number(r[c.key]); if (Number.isFinite(v)) s += v; }
    totals[c.key] = Math.round(s * 100) / 100;
  }
  return { ...t, totals };
}

function cell(t: DataTable, kind: ColKind, v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "money") { const n = Number(v); return Number.isFinite(n) ? formatMoney(n, t.currency ?? "") .trim() : String(v); }
  if (kind === "number") { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v); }
  return String(v);
}

async function toXlsx(title: string, t: DataTable) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Invoice+CRM assistant";
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, " ") || "Report");
  ws.addRow([title]).font = { bold: true, size: 13 };
  for (const n of t.notes ?? []) ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  const head = ws.addRow(t.columns.map((c) => (c.kind === "money" && t.currency ? `${c.label} (${t.currency})` : c.label)));
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDFAF5" } }; });
  for (const r of t.rows) {
    ws.addRow(t.columns.map((c) => {
      const v = r[c.key];
      if ((c.kind === "money" || c.kind === "number") && v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
      // formula-injection guard for text cells
      return typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v ?? "";
    }));
  }
  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === "money") col.numFmt = "#,##0.00";
    col.width = Math.min(45, Math.max(12, c.label.length + 4, ...t.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2)));
  });
  if (t.totals && Object.keys(t.totals).length) {
    const row = ws.addRow(t.columns.map((c, i) => (i === 0 ? "Total" : t.totals![c.key] ?? "")));
    row.font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function toDocx(title: string, t: DataTable) {
  const border = { style: "single" as const, size: 4, color: "D9E2DE" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const right = (c: { kind: ColKind }) => (c.kind === "money" || c.kind === "number" ? AlignmentType.RIGHT : AlignmentType.LEFT);
  const mkCell = (text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType], bold = false, shade?: string) => new TableCell({
    borders, shading: shade ? { fill: shade } : undefined,
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold, size: 18 })] })],
  });
  const rows = [
    new TableRow({ tableHeader: true, children: t.columns.map((c) => mkCell(c.kind === "money" && t.currency ? `${c.label} (${t.currency})` : c.label, right(c), true, "EDFAF5")) }),
    ...t.rows.map((r) => new TableRow({ children: t.columns.map((c) => mkCell(cell(t, c.kind, r[c.key]), right(c))) })),
  ];
  if (t.totals && Object.keys(t.totals).length) {
    rows.push(new TableRow({ children: t.columns.map((c, i) => mkCell(i === 0 ? "Total" : t.totals![c.key] !== undefined ? cell(t, c.kind, t.totals![c.key]) : "", right(c), true, "F4F6F3")) }));
  }
  const doc = new Document({
    creator: "Invoice+CRM assistant", title,
    sections: [{
      properties: { page: { size: { orientation: t.columns.length > 5 ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT } } },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title })] }),
        ...(t.notes ?? []).map((n) => new Paragraph({ children: [new TextRun({ text: n, italics: true, color: "666666", size: 18 })] })),
        new Paragraph({ text: "" }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ children: [new TextRun({ text: `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, color: "888888", size: 16 })] }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function toPdf(title: string, t: DataTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = t.columns.length > 5;
    const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margin: 36, info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const L = 36, R = doc.page.width - 36, W = R - L, bottom = doc.page.height - 48;
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(title, L, 36, { width: W });
    doc.font("Helvetica").fontSize(8.5).fillColor("#555");
    for (const n of t.notes ?? []) doc.text(n, { width: W });
    doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC${t.currency ? ` · amounts in ${t.currency}` : ""}`, { width: W });
    doc.moveDown(0.6);
    const weight = (k: ColKind) => (k === "money" ? 1.2 : k === "date" ? 0.9 : k === "number" ? 0.8 : 1.5);
    const tw = t.columns.reduce((a, c) => a + weight(c.kind), 0);
    const widths = t.columns.map((c) => (weight(c.kind) / tw) * W);
    const align = (k: ColKind) => (k === "money" || k === "number" ? "right" : "left");
    const header = () => {
      let x = L; const y = doc.y;
      doc.rect(L, y - 2, W, 16).fill("#edfaf5");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#114a3a");
      t.columns.forEach((c, i) => { doc.text(c.label.toUpperCase(), x + 3, y + 2, { width: widths[i] - 6, align: align(c.kind), lineBreak: false, ellipsis: true }); x += widths[i]; });
      doc.y = y + 18;
      doc.font("Helvetica").fontSize(7.5).fillColor("#111");
    };
    header();
    const drawRow = (texts: string[], bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica");
      const h = Math.max(...texts.map((s, i) => doc.heightOfString(s || " ", { width: widths[i] - 6 }))) + 5;
      if (doc.y + h > bottom) { doc.addPage(); doc.y = 36; header(); doc.font(bold ? "Helvetica-Bold" : "Helvetica"); }
      const y = doc.y; let x = L;
      texts.forEach((s, i) => { doc.text(s, x + 3, y + 2, { width: widths[i] - 6, align: align(t.columns[i].kind) }); x += widths[i]; });
      doc.moveTo(L, y + h).lineTo(R, y + h).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      doc.y = y + h + 1;
    };
    for (const r of t.rows) drawRow(t.columns.map((c) => cell(t, c.kind, r[c.key])));
    if (!t.rows.length) doc.font("Helvetica-Oblique").text("No rows.", L, doc.y + 6);
    if (t.totals && Object.keys(t.totals).length) drawRow(t.columns.map((c, i) => (i === 0 ? "Total" : t.totals![c.key] !== undefined ? cell(t, c.kind, t.totals![c.key]) : "")), true);
    doc.end();
  });
}

/** Render and store an export for a user; returns the stored file name (served by /api/assistant/files/[name]). */
export async function createExport(userId: string, title: string, format: ExportFormat, table: DataTable) {
  const t = withTotals(table);
  const buf = format === "xlsx" ? await toXlsx(title, t) : format === "docx" ? await toDocx(title, t) : await toPdf(title, t);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
  const name = `${slug}-${randomUUID().slice(0, 8)}.${format}`;
  await saveFile(`assistant/${userId}/${name}`, buf);
  return { name, size: buf.length };
}
