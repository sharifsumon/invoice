import PDFDocument from "pdfkit";
import { dec, formatMoney } from "./money";

export interface InvoiceSnapshot {
  title: string;
  company: {
    displayName: string; legalName: string; address: string | null; email: string | null; phone: string | null;
    website: string | null; registrationNumber: string | null; taxNumber: string | null; bankDetails: string | null;
    logoSha256: string | null;
  };
  template: {
    logoPosition: string; headerText: string | null; footerText: string | null; pageSize: string;
    showTax: boolean; taxLabel: string; showAmountInWords: boolean;
  };
  client: {
    name: string; legalName: string | null; address: string | null; country: string | null; taxId: string | null;
    email: string | null; contactName: string | null; contactEmail: string | null;
  };
  /** Empty for individual invoices (no project / PO). */
  project: { code: string; name: string } | null;
  po: { poNumber: string } | null;
  invoice: {
    number: string | null; date: string | null; dueDate: string | null; currency: string; kind: string;
    lines: { description: string; quantity: string; unitPrice: string; amount: string }[];
    subtotal: string; discount: string; taxRate: string; taxAmount: string; total: string;
    notes: string | null; terms: string | null; amountInWords: string | null; version: number;
  };
  /** Live payment position, added when the PDF is served (never part of the frozen snapshot). */
  payment?: PaymentSummary;
}

export interface PaymentSummary {
  status: string; // e.g. "PARTIALLY PAID", "PAID"
  payments: { date: string; amount: string }[];
  /** Total minus payments on this invoice (a part carried to a balance invoice still counts as due here). */
  balanceDue: string;
}

const GREY = "#555555";
const LIGHT = "#e5e7eb";
const ACCENT = "#1e3a8a";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

/**
 * Render an invoice PDF from a snapshot. Deterministic for a given snapshot + logo,
 * so the finalized artifact is rendered once and stored (BR-14).
 */
export function renderInvoicePdf(s: InvoiceSnapshot, opts: { logo?: Buffer | null; draft?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: s.template.pageSize === "LETTER" ? "LETTER" : "A4",
      margin: 48,
      info: { Title: `${s.title} ${s.invoice.number ?? "DRAFT"}`, Author: s.company.displayName, CreationDate: new Date(0) },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const L = 48;
    const R = W - 48;
    const cur = s.invoice.currency;

    if (opts.draft) {
      doc.save().fontSize(110).fillColor("#000000").opacity(0.06).rotate(-35, { origin: [W / 2, 420] })
        .text("DRAFT", 60, 360, { width: W - 120, align: "center" }).restore().opacity(1);
    }

    // ── Header: logo + company ──
    const logoRight = s.template.logoPosition === "right";
    let headerBottom = 48;
    if (opts.logo) {
      try {
        doc.image(opts.logo, logoRight ? R - 140 : L, 48, { fit: [140, 60] });
        headerBottom = 112;
      } catch { /* unreadable logo — skip */ }
    }
    const coX = logoRight ? L : opts.logo ? L + 160 : L;
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(13).text(s.company.displayName, coX, 48, { width: 260 });
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY);
    const coLines = [
      s.company.legalName !== s.company.displayName ? s.company.legalName : null,
      s.company.address,
      [s.company.email, s.company.phone].filter(Boolean).join("  ·  ") || null,
      s.company.website,
      s.company.registrationNumber ? `Reg. No: ${s.company.registrationNumber}` : null,
      s.company.taxNumber ? `${s.template.taxLabel} No: ${s.company.taxNumber}` : null,
    ].filter(Boolean) as string[];
    doc.text(coLines.join("\n"), coX, doc.y + 2, { width: 260 });
    headerBottom = Math.max(headerBottom, doc.y);

    // Title block on the right (or left when logo is right)
    const tX = logoRight ? L + 290 : R - 200;
    doc.font("Helvetica-Bold").fontSize(22).fillColor(ACCENT).text(s.title, tX, logoRight && opts.logo ? 116 : 48, { width: 200, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#111111");
    const meta: [string, string][] = [
      ["Invoice No", s.invoice.number ?? "DRAFT"],
      ["Invoice Date", fmtDate(s.invoice.date)],
      ["Due Date", fmtDate(s.invoice.dueDate)],
    ];
    if (s.invoice.version > 1) meta.push(["Revision", `v${s.invoice.version}`]);
    for (const [k, v] of meta) {
      const y = doc.y + 2;
      doc.fillColor(GREY).text(k, tX, y, { width: 90, align: "right" });
      doc.fillColor("#111111").font("Helvetica-Bold").text(v, tX + 95, y, { width: 105, align: "right" }).font("Helvetica");
    }
    headerBottom = Math.max(headerBottom, doc.y) + 16;

    if (s.template.headerText) {
      doc.fontSize(9).fillColor(GREY).text(s.template.headerText, L, headerBottom, { width: R - L });
      headerBottom = doc.y + 8;
    }
    doc.moveTo(L, headerBottom).lineTo(R, headerBottom).strokeColor(LIGHT).lineWidth(1).stroke();

    // ── Bill to / project reference ──
    let y = headerBottom + 12;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY).text("BILL TO", L, y);
    doc.text("REFERENCE", L + 280, y);
    y += 12;
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#111111").text(s.client.legalName || s.client.name, L, y, { width: 260 });
    doc.font("Helvetica").fontSize(9).fillColor("#333333");
    const billLines = [
      s.client.contactName ? `Attn: ${s.client.contactName}` : null,
      s.client.address, s.client.country,
      s.client.taxId ? `${s.template.taxLabel}/Tax ID: ${s.client.taxId}` : null,
      s.client.contactEmail || s.client.email,
    ].filter(Boolean) as string[];
    doc.text(billLines.join("\n"), L, doc.y + 1, { width: 260 });
    const billBottom = doc.y;
    doc.fontSize(9).fillColor("#333333");
    const refs: [string, string][] = [
      ...(s.project ? [["Project", `${s.project.name} (${s.project.code})`] as [string, string]] : []),
      ...(s.po ? [["PO Number", s.po.poNumber] as [string, string]] : []),
      ["Currency", cur],
    ];
    let ry = y;
    for (const [k, v] of refs) {
      doc.fillColor(GREY).text(k, L + 280, ry, { width: 70 });
      doc.fillColor("#111111").text(v, L + 350, ry, { width: R - L - 350 });
      ry = doc.y + 2;
    }
    y = Math.max(billBottom, ry) + 18;

    // ── Line items ──
    const cols = { desc: L, qty: R - 250, rate: R - 180, amt: R - 90 };
    doc.rect(L, y, R - L, 20).fill("#f3f4f6");
    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(8.5);
    doc.text("DESCRIPTION", cols.desc + 6, y + 6);
    doc.text("QTY", cols.qty, y + 6, { width: 60, align: "right" });
    doc.text("RATE", cols.rate, y + 6, { width: 80, align: "right" });
    doc.text("AMOUNT", cols.amt, y + 6, { width: 84, align: "right" });
    y += 26;
    doc.font("Helvetica").fontSize(9);
    for (const line of s.invoice.lines) {
      const h = doc.heightOfString(line.description, { width: cols.qty - cols.desc - 16 });
      doc.fillColor("#111111").text(line.description, cols.desc + 6, y, { width: cols.qty - cols.desc - 16 });
      doc.text(dec(line.quantity).toDecimalPlaces(4).toString(), cols.qty, y, { width: 60, align: "right" });
      doc.text(formatMoney(line.unitPrice, "").trim(), cols.rate, y, { width: 80, align: "right" });
      doc.text(formatMoney(line.amount, "").trim(), cols.amt, y, { width: 84, align: "right" });
      y += Math.max(h, 12) + 8;
      doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor(LIGHT).stroke();
    }

    // ── Totals ──
    y += 6;
    const tot: [string, string, boolean][] = [["Subtotal", formatMoney(s.invoice.subtotal, cur), false]];
    if (dec(s.invoice.discount).gt(0)) tot.push(["Discount", `- ${formatMoney(s.invoice.discount, cur)}`, false]);
    if (s.template.showTax || dec(s.invoice.taxAmount).gt(0)) {
      tot.push([`${s.template.taxLabel} (${dec(s.invoice.taxRate).toDecimalPlaces(2).toString()}%)`, formatMoney(s.invoice.taxAmount, cur), false]);
    }
    tot.push(["Total", formatMoney(s.invoice.total, cur), true]);
    for (const [k, v, bold] of tot) {
      if (bold) { doc.rect(R - 230, y - 4, 230, 22).fill("#eef2ff"); }
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(bold ? ACCENT : "#111111");
      doc.text(k, R - 224, y + (bold ? 1 : 0), { width: 110 });
      doc.text(v, R - 114, y + (bold ? 1 : 0), { width: 108, align: "right" });
      y += bold ? 24 : 16;
    }
    if (s.payment) {
      const p = s.payment;
      const rows: [string, string, boolean][] = [
        ...p.payments.map((x) => [`Paid ${fmtDate(x.date)}`, `- ${formatMoney(x.amount, cur)}`, false] as [string, string, boolean]),
        ["Balance due", formatMoney(p.balanceDue, cur), true],
      ];
      for (const [k, v, bold] of rows) {
        if (bold) { doc.rect(R - 230, y - 4, 230, 22).fill("#ecfdf5"); }
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(bold ? "#065f46" : "#111111");
        doc.text(k, R - 224, y + (bold ? 1 : 0), { width: 116 });
        doc.text(v, R - 114, y + (bold ? 1 : 0), { width: 108, align: "right" });
        y += bold ? 24 : 16;
      }
      // Status stamp beside the totals
      doc.save().font("Helvetica-Bold").fontSize(16).fillColor("#065f46").opacity(0.85)
        .text(p.status, L, y - 70, { width: R - L - 250, align: "left" }).restore().opacity(1);
    }
    if (s.template.showAmountInWords && s.invoice.amountInWords) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(GREY).text(`Amount in words: ${s.invoice.amountInWords}`, L, y + 4, { width: R - L });
      y = doc.y + 6;
    }

    // ── Notes, terms, payment instructions ──
    const blocks: [string, string | null][] = [
      ["Payment Instructions", s.company.bankDetails],
      ["Notes", s.invoice.notes],
      ["Terms", s.invoice.terms],
    ];
    y += 12;
    for (const [k, v] of blocks) {
      if (!v) continue;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GREY).text(k.toUpperCase(), L, y);
      doc.font("Helvetica").fontSize(9).fillColor("#333333").text(v, L, doc.y + 2, { width: R - L });
      y = doc.y + 10;
    }

    // ── Footer ──
    const footer = s.template.footerText || `${s.company.displayName}`;
    const fy = doc.page.height - 48 - 14;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY).text(footer, L, fy, { width: R - L, align: "center", lineBreak: false });

    doc.end();
  });
}
