import { z } from "zod";
import { InvoiceKind, InvoiceStatus, NotificationEvent, POStatus, ProjectStatus } from "@/generated/prisma/enums";
import { notify } from "./notifications";
import { audit, inTx, parseDate, type Actor, type Db, type Tx } from "./common";
import { allocateMilestones, dec, money, sum, D } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";

export const milestoneInput = z.object({
  name: z.string().trim().min(1, "Milestone name is required").max(300),
  percentage: z.string().min(1, "Percentage is required"),
  expectedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const poInput = z.object({
  poNumber: z.string().trim().min(1, "PO number is required").max(80),
  projectId: z.string().min(1, "Project is required"),
  poDate: z.string().min(1, "PO date is required"),
  value: z.string().min(1, "PO value is required"),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  paymentTerms: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(500).optional(),
  remarks: z.string().trim().max(5000).optional(),
  milestones: z.array(milestoneInput).max(100).default([]),
});
export type POInput = z.input<typeof poInput>;

const EDITABLE: POStatus[] = [POStatus.DRAFT, POStatus.SUBMITTED, POStatus.REJECTED];

function parsePOValue(v: string) {
  let d;
  try { d = money(dec(v)); } catch { throw new RuleError("PO value must be a number"); }
  if (d.lte(0)) throw new RuleError("PO value must be greater than zero");
  return d;
}

function buildMilestones(value: InstanceType<typeof D>, ms: z.output<typeof milestoneInput>[]) {
  const pcts = ms.map((m) => {
    let p;
    try { p = dec(m.percentage).toDecimalPlaces(4); } catch { throw new RuleError(`Invalid percentage for "${m.name}"`); }
    if (p.lte(0) || p.gt(100)) throw new RuleError(`Percentage for "${m.name}" must be between 0 and 100`);
    return p;
  });
  const total = sum(pcts);
  // Exact allocation when the plan is complete; provisional per-line rounding while drafting.
  const amounts = total.eq(100) ? allocateMilestones(value, pcts) : pcts.map((p) => money(value.times(p).dividedBy(100)));
  if (total.gt(100)) throw new RuleError(`Milestone percentages total ${total}% — they cannot exceed 100%`);
  return ms.map((m, i) => ({
    sequence: i + 1,
    name: m.name,
    percentage: pcts[i],
    amount: amounts[i],
    expectedDate: parseDate(m.expectedDate || null),
    notes: m.notes || null,
  }));
}

export async function createPO(db: Db, actor: Actor, raw: POInput) {
  if (!can(actor.role, "pos", "create")) throw new ForbiddenError("pos", "create");
  const data = poInput.parse(raw);
  const value = parsePOValue(data.value);
  return inTx(db, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: data.projectId } });
    if (!project) throw new RuleError("Project not found");
    if (project.status === ProjectStatus.CANCELLED || project.status === ProjectStatus.REJECTED) {
      throw new RuleError("Cannot create a PO for a cancelled or rejected project");
    }
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber: data.poNumber,
        clientId: project.clientId,
        projectId: project.id,
        poDate: parseDate(data.poDate)!,
        value,
        currency: data.currency ?? project.currency,
        paymentTerms: data.paymentTerms || null,
        reference: data.reference || null,
        remarks: data.remarks || null,
        milestones: { create: buildMilestones(value, data.milestones) },
      },
      include: { milestones: true },
    });
    await audit(tx, actor, "po.created", "PurchaseOrder", po.id, { after: po });
    return po;
  });
}

export async function updatePO(db: Db, actor: Actor, id: string, raw: POInput) {
  if (!can(actor.role, "pos", "edit")) throw new ForbiddenError("pos", "edit");
  const data = poInput.parse(raw);
  const value = parsePOValue(data.value);
  return inTx(db, async (tx) => {
    await lockPO(tx, id);
    const before = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { milestones: true } });
    if (!EDITABLE.includes(before.status)) {
      throw new RuleError(`A ${before.status.toLowerCase()} PO cannot be edited. Approved POs are locked.`);
    }
    const project = await tx.project.findUniqueOrThrow({ where: { id: data.projectId } });
    await tx.paymentMilestone.deleteMany({ where: { poId: id } });
    const po = await tx.purchaseOrder.update({
      where: { id },
      data: {
        poNumber: data.poNumber,
        clientId: project.clientId,
        projectId: project.id,
        poDate: parseDate(data.poDate)!,
        value,
        currency: data.currency ?? project.currency,
        paymentTerms: data.paymentTerms || null,
        reference: data.reference || null,
        remarks: data.remarks || null,
        status: before.status === POStatus.REJECTED ? POStatus.DRAFT : before.status,
        milestones: { create: buildMilestones(value, data.milestones) },
      },
      include: { milestones: true },
    });
    await audit(tx, actor, "po.updated", "PurchaseOrder", id, { before, after: po });
    return po;
  });
}

/** Row-level lock on the PO; serializes all invoice/approval work against it. */
export async function lockPO(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw new RuleError("PO not found");
}

const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: [POStatus.SUBMITTED, POStatus.APPROVED, POStatus.CANCELLED],
  SUBMITTED: [POStatus.APPROVED, POStatus.REJECTED, POStatus.ON_HOLD, POStatus.DRAFT],
  REJECTED: [POStatus.DRAFT, POStatus.CANCELLED],
  ON_HOLD: [POStatus.SUBMITTED, POStatus.CANCELLED],
  APPROVED: [POStatus.COMPLETED, POStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};
export { PO_TRANSITIONS };

export async function transitionPO(db: Db, actor: Actor, id: string, to: POStatus, reason?: string) {
  if (to === POStatus.APPROVED) return approvePO(db, actor, id);
  const perm = to === POStatus.REJECTED ? "approve" : to === POStatus.CANCELLED ? "cancel" : "edit";
  if (!can(actor.role, "pos", perm)) throw new ForbiddenError("pos", perm);
  return inTx(db, async (tx) => {
    await lockPO(tx, id);
    const before = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
    if (!PO_TRANSITIONS[before.status].includes(to)) {
      throw new RuleError(`Cannot move a PO from ${before.status} to ${to}`);
    }
    if (to === POStatus.CANCELLED) {
      const valid = await tx.invoice.count({ where: { poId: id, status: { not: InvoiceStatus.CANCELLED } } });
      if (valid) throw new RuleError("Cancel all valid invoices on this PO before cancelling it");
      if (!reason?.trim()) throw new RuleError("A reason is required to cancel a PO");
    }
    const po = await tx.purchaseOrder.update({ where: { id }, data: { status: to } });
    await audit(tx, actor, `po.status.${to.toLowerCase()}`, "PurchaseOrder", id, {
      before: { status: before.status }, after: { status: to }, reason: reason ?? null,
    });
    return { po, generated: 0 };
  });
}

/**
 * BR-04/05/06: approve a PO. If it has a milestone plan, percentages must total exactly 100%,
 * amounts are re-allocated deterministically, and one DRAFT invoice is created per milestone —
 * all in one transaction. Any failure rolls the whole approval back.
 */
export async function approvePO(db: Db, actor: Actor, id: string) {
  if (!can(actor.role, "pos", "approve")) throw new ForbiddenError("pos", "approve");
  try {
    const r = await approvePOTx(db, actor, id);
    await notify(db, NotificationEvent.PO_APPROVED, {
      title: `PO ${r.po.poNumber} approved`,
      body: r.generated ? `${r.generated} milestone invoice(s) generated as drafts.` : "No milestone plan — raise invoices manually.",
      link: `/pos/${id}`, dedupeKey: id,
    });
    return r;
  } catch (e) {
    const po = await db.purchaseOrder.findUnique({ where: { id }, include: { _count: { select: { milestones: true } } } });
    if (po && po._count.milestones > 0 && po.status !== POStatus.APPROVED) {
      await notify(db, NotificationEvent.INVOICE_GENERATION_FAILED, {
        title: `PO ${po.poNumber}: approval / invoice generation failed`,
        body: e instanceof Error ? e.message : String(e), link: `/pos/${id}`, dedupeKey: `${id}:${Date.now()}`,
      });
    }
    throw e;
  }
}

async function approvePOTx(db: Db, actor: Actor, id: string) {
  return inTx(db, async (tx) => {
    await lockPO(tx, id);
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { milestones: { orderBy: { sequence: "asc" } } } });
    if (!PO_TRANSITIONS[po.status].includes(POStatus.APPROVED)) {
      throw new RuleError(`Cannot approve a PO that is ${po.status}`);
    }
    if (po.milestones.length) {
      const amounts = allocateMilestones(po.value, po.milestones.map((m) => m.percentage));
      for (let i = 0; i < po.milestones.length; i++) {
        if (!po.milestones[i].amount.eq(amounts[i])) {
          await tx.paymentMilestone.update({ where: { id: po.milestones[i].id }, data: { amount: amounts[i] } });
        }
      }
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: POStatus.APPROVED, approvedAt: new Date(), approvedById: actor.id },
    });
    await audit(tx, actor, "po.status.approved", "PurchaseOrder", id, { before: { status: po.status }, after: { status: "APPROVED" } });
    const generated = await generateMilestoneInvoicesTx(tx, actor, id);
    return { po: await tx.purchaseOrder.findUniqueOrThrow({ where: { id } }), generated };
  });
}

/** Idempotent: creates invoices only for milestones that have no valid invoice. Caller must hold the PO lock. */
export async function generateMilestoneInvoicesTx(tx: Tx, actor: Actor | null, poId: string): Promise<number> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      milestones: {
        orderBy: { sequence: "asc" },
        include: { invoices: { where: { status: { not: InvoiceStatus.CANCELLED } }, select: { id: true } } },
      },
    },
  });
  if (po.status !== POStatus.APPROVED) throw new RuleError("Milestone invoices are generated only for approved POs");
  const template = await tx.invoiceTemplateSettings.findUnique({ where: { id: 1 } });
  const company = await tx.companySettings.findUnique({ where: { id: 1 } });
  const taxRate = template?.showTax ? template.defaultTaxRate : dec(0);

  let created = 0;
  for (const m of po.milestones) {
    if (m.invoices.length) continue; // BR-06 — already invoiced
    const subtotal = m.amount;
    const taxAmount = money(subtotal.times(taxRate).dividedBy(100));
    const inv = await tx.invoice.create({
      data: {
        kind: InvoiceKind.MILESTONE,
        status: InvoiceStatus.DRAFT,
        clientId: po.clientId,
        projectId: po.projectId,
        poId: po.id,
        milestoneId: m.id,
        currency: po.currency,
        subtotal,
        taxRate,
        taxAmount,
        total: subtotal.plus(taxAmount),
        dueDate: m.expectedDate,
        notes: company?.defaultNotes ?? null,
        terms: template?.defaultTerms ?? null,
        createdById: actor?.id ?? null,
        lineItems: {
          create: [{
            sequence: 1,
            description: `Milestone ${m.sequence}: ${m.name} (${m.percentage.toDecimalPlaces(2).toString()}% of PO ${po.poNumber})`,
            quantity: dec(1),
            unitPrice: subtotal,
            amount: subtotal,
          }],
        },
      },
    });
    await audit(tx, actor, "invoice.generated", "Invoice", inv.id, { after: { poId, milestoneId: m.id, subtotal } });
    created++;
  }
  return created;
}

/** Retry entry point (e.g. after a failure): safe to call any number of times. */
export async function generateMilestoneInvoices(db: Db, actor: Actor, poId: string) {
  if (!can(actor.role, "pos", "approve")) throw new ForbiddenError("pos", "approve");
  return inTx(db, async (tx) => {
    await lockPO(tx, poId);
    return generateMilestoneInvoicesTx(tx, actor, poId);
  });
}

/** BRD §5.4: PO value, valid invoiced, paid, outstanding and remaining invoiceable — shown separately. */
export async function poBalance(db: Db | Tx, poId: string) {
  const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { value: true, currency: true } });
  const agg = await db.invoice.aggregate({
    where: { poId, status: { not: InvoiceStatus.CANCELLED } },
    _sum: { subtotal: true, discount: true, amountPaid: true, total: true },
  });
  // Receivables only exist once an invoice is issued (drafts still reserve PO allocation).
  const issued = await db.invoice.aggregate({
    where: { poId, status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] } },
    _sum: { total: true, amountPaid: true },
  });
  const invoiced = (agg._sum.subtotal ?? dec(0)).minus(agg._sum.discount ?? dec(0));
  const paid = agg._sum.amountPaid ?? dec(0);
  const billed = issued._sum.total ?? dec(0);
  return {
    currency: po.currency,
    value: po.value,
    invoiced,
    billedInclTax: billed,
    paid,
    outstanding: billed.minus(issued._sum.amountPaid ?? dec(0)),
    remaining: po.value.minus(invoiced),
  };
}

export function isMilestonePlanComplete(milestones: { percentage: InstanceType<typeof D> }[]) {
  return milestones.length > 0 && sum(milestones.map((m) => m.percentage)).eq(100);
}
