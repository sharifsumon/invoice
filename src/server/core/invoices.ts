import { z } from "zod";
import { InvoiceKind, InvoiceStatus, NumberReset, POStatus } from "@/generated/prisma/enums";
import { addDays, audit, inTx, parseDate, today, type Actor, type Db, type Tx } from "./common";
import { amountInWords, dec, money, outstandingOf, sum, type OutstandingParts } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";
import { renderInvoicePdf, type InvoiceSnapshot } from "./pdf";
import { lockPO, poBalance } from "./pos";
import { loadFile, saveFile } from "./storage";

export const lineInput = z.object({
  description: z.string().trim().min(1, "Line description is required").max(1000),
  quantity: z.string().default("1"),
  unitPrice: z.string().min(1, "Rate is required"),
});

export const manualInvoiceInput = z.object({
  /** Against a PO… */
  poId: z.string().optional().transform((v) => v || null),
  /** …or an individual invoice straight to a client (no PO / project). */
  clientId: z.string().optional().transform((v) => v || null),
  currency: z.string().optional().transform((v) => (v || "").trim().toUpperCase() || null),
  invoiceDate: z.string().optional(),
  milestoneId: z.string().optional().transform((v) => v || null),
  lines: z.array(lineInput).min(1, "Add at least one line").max(200),
  discount: z.string().optional(),
  taxRate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
});
export type ManualInvoiceInput = z.input<typeof manualInvoiceInput>;

function computeLines(lines: z.output<typeof lineInput>[]) {
  return lines.map((l, i) => {
    let q, p;
    try { q = dec(l.quantity).toDecimalPlaces(4); p = money(dec(l.unitPrice)); } catch { throw new RuleError(`Line ${i + 1}: quantity and rate must be numbers`); }
    if (q.lte(0)) throw new RuleError(`Line ${i + 1}: quantity must be greater than zero`);
    if (p.lt(0)) throw new RuleError(`Line ${i + 1}: rate cannot be negative`);
    return { sequence: i + 1, description: l.description, quantity: q, unitPrice: p, amount: money(q.times(p)) };
  });
}

/** Server-side totals (BRD §5.5.4). Allocation against the PO = subtotal − discount. */
function computeTotals(subtotal: ReturnType<typeof dec>, discountRaw?: string, taxRateRaw?: string) {
  const discount = money(dec(discountRaw || "0"));
  const taxRate = dec(taxRateRaw || "0").toDecimalPlaces(4);
  if (discount.lt(0) || discount.gt(subtotal)) throw new RuleError("Discount must be between 0 and the subtotal");
  if (taxRate.lt(0) || taxRate.gt(100)) throw new RuleError("Tax rate must be between 0 and 100");
  const net = subtotal.minus(discount);
  const taxAmount = money(net.times(taxRate).dividedBy(100));
  return { discount, taxRate, taxAmount, total: net.plus(taxAmount), net };
}

/** BR-07/BR-10: manual invoice within the remaining PO balance, under a PO row lock. */
export async function createManualInvoice(db: Db, actor: Actor, raw: ManualInvoiceInput) {
  if (!can(actor, "invoices", "create")) throw new ForbiddenError("invoices", "create");
  const data = manualInvoiceInput.parse(raw);
  const lines = computeLines(data.lines);
  const subtotal = sum(lines.map((l) => l.amount));
  if (subtotal.lte(0)) throw new RuleError("Invoice amount must be greater than zero");
  const t = computeTotals(subtotal, data.discount, data.taxRate);

  if (!data.poId) return createStandaloneInvoice(db, actor, data, lines, subtotal, t);
  const poId = data.poId;

  return inTx(db, async (tx) => {
    await lockPO(tx, poId);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    if (po.status !== POStatus.APPROVED) throw new RuleError("Manual invoices can only be created against an approved PO");

    if (data.milestoneId) {
      const m = await tx.paymentMilestone.findFirst({
        where: { id: data.milestoneId, poId: po.id },
        include: { invoices: { where: { status: { not: InvoiceStatus.CANCELLED } }, select: { id: true } } },
      });
      if (!m) throw new RuleError("Milestone does not belong to this PO");
      if (m.invoices.length) throw new RuleError("This milestone has already been invoiced");
    }

    const bal = await poBalance(tx, po.id);
    if (t.net.gt(bal.remaining)) {
      throw new RuleError(
        `Invoice amount ${t.net.toFixed(2)} exceeds the remaining invoiceable PO balance of ${bal.remaining.toFixed(2)} ${po.currency}.`,
      );
    }

    const company = await tx.companySettings.findUnique({ where: { id: 1 } });
    const template = await tx.invoiceTemplateSettings.findUnique({ where: { id: 1 } });
    const inv = await tx.invoice.create({
      data: {
        kind: InvoiceKind.MANUAL,
        status: InvoiceStatus.DRAFT,
        clientId: po.clientId,
        projectId: po.projectId,
        poId: po.id,
        milestoneId: data.milestoneId,
        currency: po.currency,
        subtotal,
        discount: t.discount,
        taxRate: t.taxRate,
        taxAmount: t.taxAmount,
        total: t.total,
        dueDate: parseDate(data.dueDate || null),
        notes: data.notes?.trim() || company?.defaultNotes || null,
        terms: data.terms?.trim() || template?.defaultTerms || null,
        createdById: actor.id,
        lineItems: { create: lines },
      },
    });
    await audit(tx, actor, "invoice.created", "Invoice", inv.id, { after: { ...inv, lines } });
    return inv;
  });
}

/** Individual invoice: billed straight to a client, no PO or project, so no PO cap applies. */
async function createStandaloneInvoice(
  db: Db, actor: Actor, data: z.output<typeof manualInvoiceInput>,
  lines: ReturnType<typeof computeLines>, subtotal: ReturnType<typeof dec>, t: ReturnType<typeof computeTotals>,
) {
  if (!data.clientId) throw new RuleError("Choose a client");
  if (data.milestoneId) throw new RuleError("Milestones belong to a PO");
  const clientId = data.clientId;
  return inTx(db, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new RuleError("Client not found");
    if (client.archived) throw new RuleError("Archived clients cannot be invoiced");
    const company = await tx.companySettings.findUnique({ where: { id: 1 } });
    const template = await tx.invoiceTemplateSettings.findUnique({ where: { id: 1 } });
    const currency = data.currency || company?.defaultCurrency || "USD";
    if (!/^[A-Z]{3}$/.test(currency)) throw new RuleError("Currency must be a 3-letter code, e.g. USD");
    const invoiceDate = parseDate(data.invoiceDate || null);
    const dueDate = parseDate(data.dueDate || null);
    if (invoiceDate && dueDate && dueDate < invoiceDate) throw new RuleError("Due date cannot be before the invoice date");
    const inv = await tx.invoice.create({
      data: {
        kind: InvoiceKind.MANUAL,
        status: InvoiceStatus.DRAFT,
        clientId: client.id,
        currency,
        subtotal,
        discount: t.discount,
        taxRate: t.taxRate,
        taxAmount: t.taxAmount,
        total: t.total,
        invoiceDate,
        dueDate,
        notes: data.notes?.trim() || company?.defaultNotes || null,
        terms: data.terms?.trim() || template?.defaultTerms || null,
        createdById: actor.id,
        lineItems: { create: lines },
      },
    });
    await audit(tx, actor, "invoice.created", "Invoice", inv.id, { after: { ...inv, lines, standalone: true } });
    return inv;
  });
}

/** Serialize changes to one invoice: through its PO when it has one (PO cap), else on the invoice row. */
async function lockScope(tx: Tx, inv: { id: string; poId: string | null }) {
  if (inv.poId) await lockPO(tx, inv.poId);
  else await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${inv.id} FOR UPDATE`;
}

export const draftUpdateInput = z.object({
  lines: z.array(lineInput).min(1).max(200).optional(),
  discount: z.string().optional(),
  taxRate: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(5000).optional(),
  terms: z.string().max(5000).optional(),
});

/** Drafts are editable. Milestone invoice amounts are fixed to the milestone; only descriptions/tax/dates/notes change. */
export async function updateDraftInvoice(db: Db, actor: Actor, id: string, raw: z.input<typeof draftUpdateInput>) {
  if (!can(actor, "invoices", "edit")) throw new ForbiddenError("invoices", "edit");
  const data = draftUpdateInput.parse(raw);
  return inTx(db, async (tx) => {
    const cur = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lineItems: true } });
    await lockScope(tx, cur);
    const before = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lineItems: true } });
    if (before.status !== InvoiceStatus.DRAFT) throw new RuleError("Only draft invoices can be edited. Use cancel & reissue for finalized invoices.");

    let subtotal = before.subtotal;
    let lines: ReturnType<typeof computeLines> | null = null;
    if (data.lines && before.kind === InvoiceKind.MANUAL) {
      lines = computeLines(data.lines);
      subtotal = sum(lines.map((l) => l.amount));
      if (subtotal.lte(0)) throw new RuleError("Invoice amount must be greater than zero");
    }
    const discount = before.kind === InvoiceKind.MILESTONE ? "0" : (data.discount ?? before.discount.toString());
    const t = computeTotals(subtotal, discount, data.taxRate ?? before.taxRate.toString());

    if (before.kind === InvoiceKind.MANUAL && before.poId) {
      const bal = await poBalance(tx, before.poId);
      const available = bal.remaining.plus(before.subtotal.minus(before.discount));
      if (t.net.gt(available)) {
        throw new RuleError(`Invoice amount ${t.net.toFixed(2)} exceeds the remaining invoiceable PO balance of ${available.toFixed(2)} ${before.currency}.`);
      }
    }

    if (lines) {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLineItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: id })) });
    }
    // Milestone invoices: amounts stay fixed to the milestone, but line descriptions can be reworded.
    if (data.lines && before.kind === InvoiceKind.MILESTONE) {
      const existing = [...before.lineItems].sort((a, b) => a.sequence - b.sequence);
      if (data.lines.length !== existing.length) throw new RuleError("Milestone invoice lines cannot be added or removed");
      for (let i = 0; i < existing.length; i++) {
        const description = data.lines[i].description;
        if (description !== existing[i].description) {
          await tx.invoiceLineItem.update({ where: { id: existing[i].id }, data: { description } });
        }
      }
    }
    const inv = await tx.invoice.update({
      where: { id },
      data: {
        subtotal, discount: t.discount, taxRate: t.taxRate, taxAmount: t.taxAmount, total: t.total,
        invoiceDate: data.invoiceDate !== undefined ? parseDate(data.invoiceDate || null) : undefined,
        dueDate: data.dueDate !== undefined ? parseDate(data.dueDate || null) : undefined,
        notes: data.notes !== undefined ? data.notes.trim() || null : undefined,
        terms: data.terms !== undefined ? data.terms.trim() || null : undefined,
      },
    });
    await audit(tx, actor, "invoice.updated", "Invoice", id, { before, after: inv });
    return inv;
  });
}

async function nextInvoiceNumber(tx: Tx, issueDate: Date) {
  const tpl = await tx.invoiceTemplateSettings.findUniqueOrThrow({ where: { id: 1 } });
  const year = String(issueDate.getUTCFullYear());
  const key = tpl.numberReset === NumberReset.YEARLY ? year : "ALL";
  await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("key", "next") VALUES (${key}, 1) ON CONFLICT ("key") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "InvoiceSequence" WHERE "key" = ${key} FOR UPDATE`;
  await tx.$executeRaw`UPDATE "InvoiceSequence" SET "next" = "next" + 1 WHERE "key" = ${key}`;
  const n = String(row.next).padStart(tpl.numberPadding, "0");
  return `${tpl.numberPrefix}${tpl.numberReset === NumberReset.YEARLY ? `${year}-` : ""}${n}`;
}

/** Build what will be printed. Used live for draft previews and frozen at finalization. */
export async function buildSnapshot(tx: Db | Tx, invoiceId: string, override?: { number?: string; date?: Date; dueDate?: Date | null }) {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      lineItems: { orderBy: { sequence: "asc" } },
      client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
      project: true,
      po: true,
    },
  });
  const company = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  const tpl = await tx.invoiceTemplateSettings.findUniqueOrThrow({ where: { id: 1 } });
  const contact = inv.client.contacts[0];
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const logoSha = company.logoPath ? company.logoPath.split("/").pop()!.split(".")[0] : null;

  const snap: InvoiceSnapshot = {
    title: tpl.title,
    company: {
      displayName: company.displayName, legalName: company.legalName, address: company.address, email: company.email,
      phone: company.phone, website: company.website, registrationNumber: company.registrationNumber,
      taxNumber: company.taxNumber, bankDetails: company.bankDetails, logoSha256: logoSha,
    },
    template: {
      logoPosition: tpl.logoPosition, headerText: tpl.headerText, footerText: tpl.footerText, pageSize: tpl.pageSize,
      showTax: tpl.showTax, taxLabel: tpl.taxLabel, showAmountInWords: tpl.showAmountInWords,
    },
    client: {
      name: inv.client.name, legalName: inv.client.legalName, address: inv.client.address, country: inv.client.country,
      taxId: inv.client.taxId, email: inv.client.email, contactName: contact?.name ?? null, contactEmail: contact?.email ?? null,
    },
    project: inv.project ? { code: inv.project.code, name: inv.project.name } : null,
    po: inv.po ? { poNumber: inv.po.poNumber } : null,
    invoice: {
      number: override?.number ?? inv.invoiceNumber,
      date: iso(override?.date ?? inv.invoiceDate),
      dueDate: iso(override?.dueDate !== undefined ? override.dueDate : inv.dueDate),
      currency: inv.currency,
      kind: inv.kind,
      lines: inv.lineItems.map((l) => ({
        description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2), amount: l.amount.toFixed(2),
      })),
      subtotal: inv.subtotal.toFixed(2), discount: inv.discount.toFixed(2), taxRate: inv.taxRate.toString(),
      taxAmount: inv.taxAmount.toFixed(2), total: inv.total.toFixed(2),
      notes: inv.notes, terms: inv.terms,
      amountInWords: tpl.showAmountInWords ? amountInWords(inv.total, inv.currency) : null,
      version: inv.version,
    },
  };
  return { snap, logoPath: company.logoPath };
}

export async function loadLogo(logoPath: string | null) {
  if (!logoPath) return null;
  try { return await loadFile(logoPath); } catch { return null; }
}

/**
 * The PDF to show, download or send for an invoice.
 * - Draft: live preview watermarked DRAFT.
 * - Finalized, nothing paid or carried: the stored PDF exactly as finalized (BR-14).
 * - Finalized with payments or a balance carried to another invoice: the frozen snapshot re-rendered with a
 *   payment summary (each payment, balance due). The stored original is kept untouched for audit.
 */
export async function servedInvoicePdf(db: Db, invoiceId: string): Promise<{ pdf: Buffer; name: string; storedPath: string | null }> {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      documents: { orderBy: { version: "desc" }, take: 1 },
      payments: { where: { state: "VALID" }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] },
    },
  });
  const doc = inv.documents[0];
  if (!doc) {
    const { snap, logoPath } = await buildSnapshot(db, invoiceId);
    return { pdf: await renderInvoicePdf(snap, { logo: await loadLogo(logoPath), draft: true }), name: `DRAFT-${invoiceId}.pdf`, storedPath: null };
  }
  const name = `${inv.invoiceNumber}.pdf`;
  const hasPosition = inv.payments.length > 0 || inv.balanceMoved.gt(0);
  if (!hasPosition || inv.status === InvoiceStatus.CANCELLED || !inv.snapshot) {
    return { pdf: await loadFile(doc.filePath), name, storedPath: doc.filePath };
  }
  const snap = inv.snapshot as unknown as InvoiceSnapshot;
  snap.payment = {
    status: inv.status === InvoiceStatus.PAID ? "PAID" : "PARTIALLY PAID",
    payments: inv.payments.map((p) => ({ date: p.paymentDate.toISOString().slice(0, 10), amount: p.amount.toFixed(2) })),
    balanceDue: inv.total.minus(inv.amountPaid).toFixed(2),
  };
  // The logo the invoice was finalized with (logos are stored by content hash and never deleted)
  const sha = snap.company.logoSha256;
  const logo = sha && /^[a-f0-9]+$/i.test(sha)
    ? (await loadLogo(`branding/${sha}.png`)) ?? (await loadLogo(`branding/${sha}.jpg`))
    : null;
  return { pdf: await renderInvoicePdf(snap, { logo }), name, storedPath: doc.filePath };
}

/**
 * Finalize: assign the next sequential number, freeze a snapshot, render + store the PDF once (BR-14).
 * The stored PDF is what preview, download, print and email all use.
 */
export async function finalizeInvoice(db: Db, actor: Actor, id: string, opts: { invoiceDate?: string; dueDate?: string } = {}) {
  if (!can(actor, "invoices", "approve")) throw new ForbiddenError("invoices", "approve");
  return inTx(db, async (tx) => {
    const pre = await tx.invoice.findUniqueOrThrow({ where: { id } });
    await lockScope(tx, pre);
    return finalizeInvoiceTx(tx, actor, id, opts);
  });
}

/** Finalize inside an open transaction. Caller must hold the PO lock and have checked permissions. */
async function finalizeInvoiceTx(tx: Tx, actor: Actor, id: string, opts: { invoiceDate?: string; dueDate?: string } = {}) {
  {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== InvoiceStatus.DRAFT) throw new RuleError("Only draft invoices can be finalized");
    if (inv.poId) {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: inv.poId }, select: { status: true, poNumber: true } });
      if (po.status !== POStatus.APPROVED && po.status !== POStatus.COMPLETED) {
        throw new RuleError(`This invoice is pending approval — approve PO ${po.poNumber} before finalizing it`);
      }
    }

    const company = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    const invoiceDate = parseDate(opts.invoiceDate || null) ?? inv.invoiceDate ?? today();
    const dueDate = parseDate(opts.dueDate || null) ?? inv.dueDate ?? addDays(invoiceDate, company.paymentTermsDays);
    if (dueDate < invoiceDate) throw new RuleError("Due date cannot be before the invoice date");

    const number = await nextInvoiceNumber(tx, invoiceDate);
    const { snap, logoPath } = await buildSnapshot(tx, id, { number, date: invoiceDate, dueDate });
    const pdf = await renderInvoicePdf(snap, { logo: await loadLogo(logoPath) });
    const file = await saveFile(`invoices/${id}/v${inv.version}-${number.replace(/[^\w.-]/g, "_")}.pdf`, pdf);

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: number, invoiceDate, dueDate, status: InvoiceStatus.UNPAID,
        snapshot: JSON.parse(JSON.stringify(snap)), finalizedAt: new Date(), finalizedById: actor.id,
      },
    });
    await tx.invoiceDocument.create({
      data: { invoiceId: id, version: inv.version, filePath: file.path, sha256: file.sha256, sizeBytes: file.size },
    });
    await audit(tx, actor, "invoice.finalized", "Invoice", id, { after: { invoiceNumber: number, invoiceDate, dueDate, total: inv.total, pdfSha256: file.sha256 } });
    return updated;
  }
}

/**
 * Carry a part-paid invoice's unpaid balance forward to a new, issued BALANCE invoice.
 * The original keeps its total and payments (Partially Paid) and records the moved amount, so the balance is
 * outstanding only on the new invoice; balance invoices are not new billing against the PO cap.
 */
export async function createBalanceInvoice(db: Db, actor: Actor, invoiceId: string) {
  if (!can(actor, "invoices", "create") || !can(actor, "invoices", "approve")) throw new ForbiddenError("invoices", "create");
  return inTx(db, async (tx) => {
    const pre = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await lockScope(tx, pre);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status !== InvoiceStatus.PARTIALLY_PAID) throw new RuleError("A balance invoice can only be created for a partially paid invoice");
    const remaining = outstandingOf(inv);
    if (remaining.lte(0)) throw new RuleError("This invoice has no outstanding balance to carry forward");
    const live = await tx.invoice.count({ where: { balanceOfId: invoiceId, status: { not: InvoiceStatus.CANCELLED } } });
    if (live) throw new RuleError("A balance invoice already exists for this invoice");

    await tx.invoice.update({ where: { id: invoiceId }, data: { balanceMoved: inv.balanceMoved.plus(remaining) } });
    const t = today();
    const copy = await tx.invoice.create({
      data: {
        kind: InvoiceKind.BALANCE, status: InvoiceStatus.DRAFT, balanceOfId: inv.id,
        clientId: inv.clientId, projectId: inv.projectId, poId: inv.poId, currency: inv.currency,
        subtotal: remaining, discount: dec(0), taxRate: dec(0), taxAmount: dec(0), total: remaining,
        dueDate: inv.dueDate && inv.dueDate >= t ? inv.dueDate : null, // past due date → today + payment terms
        notes: [`Outstanding balance of invoice ${inv.invoiceNumber}.`, inv.notes].filter(Boolean).join("\n"),
        terms: inv.terms, createdById: actor.id,
        lineItems: {
          create: [{
            sequence: 1, quantity: dec(1), unitPrice: remaining, amount: remaining,
            description: `Balance of invoice ${inv.invoiceNumber} (total ${inv.total.toFixed(2)}, paid ${inv.amountPaid.toFixed(2)} ${inv.currency})`,
          }],
        },
      },
    });
    await audit(tx, actor, "invoice.balance_moved", "Invoice", inv.id, { after: { balanceInvoiceId: copy.id, amount: remaining } });
    await audit(tx, actor, "invoice.created", "Invoice", copy.id, { after: { balanceOf: inv.id, invoiceNumber: inv.invoiceNumber, amount: remaining } });
    return finalizeInvoiceTx(tx, actor, copy.id, { invoiceDate: t.toISOString().slice(0, 10) });
  });
}

/** BR-09: cancelling releases the PO allocation; the record and its documents stay for audit. */
export async function cancelInvoice(db: Db, actor: Actor, id: string, reason: string) {
  if (!can(actor, "invoices", "delete")) throw new ForbiddenError("invoices", "delete");
  if (!reason?.trim()) throw new RuleError("A cancellation reason is required");
  return inTx(db, async (tx) => {
    const pre = await tx.invoice.findUniqueOrThrow({ where: { id } });
    await lockScope(tx, pre);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status === InvoiceStatus.CANCELLED) throw new RuleError("Invoice is already cancelled");
    if (inv.amountPaid.gt(0)) throw new RuleError("An invoice with recorded payments cannot be cancelled. Reverse the payments first.");
    // Cancelling a balance invoice puts the balance back on the original invoice.
    if (inv.kind === InvoiceKind.BALANCE && inv.balanceOfId) {
      const orig = await tx.invoice.findUniqueOrThrow({ where: { id: inv.balanceOfId } });
      const back = orig.balanceMoved.minus(inv.total);
      await tx.invoice.update({ where: { id: orig.id }, data: { balanceMoved: back.lt(0) ? dec(0) : back } });
    }
    const updated = await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason.trim() },
    });
    await audit(tx, actor, "invoice.cancelled", "Invoice", id, {
      before: { status: inv.status, invoiceNumber: inv.invoiceNumber, subtotal: inv.subtotal },
      after: { status: "CANCELLED" }, reason: reason.trim(),
    });
    return updated;
  });
}

/** Controlled correction: cancel the invoice and create a new draft copy (marked as a revision). */
export async function cancelAndReissue(db: Db, actor: Actor, id: string, reason: string) {
  if (!can(actor, "invoices", "delete") || !can(actor, "invoices", "create")) {
    throw new ForbiddenError("invoices", "delete");
  }
  if (!reason?.trim()) throw new RuleError("A reason is required to reissue an invoice");
  return inTx(db, async (tx) => {
    const pre = await tx.invoice.findUniqueOrThrow({ where: { id } });
    await lockScope(tx, pre);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { lineItems: { orderBy: { sequence: "asc" } } } });
    if (inv.status === InvoiceStatus.CANCELLED) throw new RuleError("Invoice is already cancelled");
    if (inv.status === InvoiceStatus.DRAFT) throw new RuleError("Draft invoices can simply be edited");
    if (inv.amountPaid.gt(0)) throw new RuleError("An invoice with recorded payments cannot be reissued");
    if (inv.kind === InvoiceKind.BALANCE) throw new RuleError("A balance invoice cannot be reissued — cancel it and create a new balance invoice instead");
    await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: `Reissued: ${reason.trim()}` },
    });
    const copy = await tx.invoice.create({
      data: {
        kind: inv.kind, status: InvoiceStatus.DRAFT, clientId: inv.clientId, projectId: inv.projectId, poId: inv.poId,
        milestoneId: inv.milestoneId, currency: inv.currency, subtotal: inv.subtotal, discount: inv.discount,
        taxRate: inv.taxRate, taxAmount: inv.taxAmount, total: inv.total, dueDate: inv.dueDate,
        notes: [inv.notes, `Revised invoice — replaces ${inv.invoiceNumber}.`].filter(Boolean).join("\n"),
        terms: inv.terms, version: inv.version + 1, createdById: actor.id,
        lineItems: { create: inv.lineItems.map(({ sequence, description, quantity, unitPrice, amount }) => ({ sequence, description, quantity, unitPrice, amount })) },
      },
    });
    await audit(tx, actor, "invoice.reissued", "Invoice", id, { after: { replacementId: copy.id }, reason: reason.trim() });
    await audit(tx, actor, "invoice.created", "Invoice", copy.id, { after: { reissueOf: id, invoiceNumber: inv.invoiceNumber } });
    return copy;
  });
}

/** Overdue is a flag, not a status (BRD §5.5.4). A balance moved to a balance invoice is no longer due here. */
export function isOverdue(inv: OutstandingParts & { status: InvoiceStatus; dueDate: Date | null }, on = today()) {
  if (inv.status === InvoiceStatus.CANCELLED || inv.status === InvoiceStatus.DRAFT || inv.status === InvoiceStatus.PAID) return false;
  return !!inv.dueDate && inv.dueDate < on && outstandingOf(inv).gt(0);
}
