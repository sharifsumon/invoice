import { z } from "zod";
import { RequisitionPriority, RequisitionStatus } from "@/generated/prisma/enums";
import { audit, inTx, parseDate, today, type Actor, type Db, type Tx } from "./common";
import { dec, money, sum } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";

/**
 * Requisitions: internal requests for items (equipment, supplies, services).
 * Flow: Draft → Submitted → Approved / Rejected → Fulfilled. Draft or submitted ones can be cancelled.
 * The requester manages their own (with "create"); "edit"/"delete" cover anyone's; "approve" decides and fulfils.
 */

export const STATUS_FLOW: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
  APPROVED: ["FULFILLED"],
  REJECTED: [],
  FULFILLED: [],
  CANCELLED: [],
};

export const itemInput = z.object({
  description: z.string().trim().min(1, "Item description is required").max(500),
  quantity: z.string().trim().min(1, "Quantity is required"),
  unit: z.string().trim().max(30).optional().transform((v) => v || null),
  unitPrice: z.string().trim().optional().transform((v) => v || null),
});

export const requisitionInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  departmentId: z.string().optional().transform((v) => v || null),
  priority: z.enum(RequisitionPriority).default("NORMAL"),
  neededBy: z.string().optional(),
  deliverTo: z.string().trim().max(500).optional().transform((v) => v || null),
  purpose: z.string().trim().max(5000).optional().transform((v) => v || null),
  items: z.array(itemInput).min(1, "Add at least one item").max(200),
});
export type RequisitionInput = z.input<typeof requisitionInput>;

function computeItems(items: z.output<typeof itemInput>[]) {
  return items.map((it, i) => {
    let q, p;
    try { q = dec(it.quantity).toDecimalPlaces(4); } catch { throw new RuleError(`Item ${i + 1}: quantity must be a number`); }
    if (q.lte(0)) throw new RuleError(`Item ${i + 1}: quantity must be greater than zero`);
    if (it.unitPrice !== null) {
      try { p = money(dec(it.unitPrice)); } catch { throw new RuleError(`Item ${i + 1}: estimated price must be a number`); }
      if (p.lt(0)) throw new RuleError(`Item ${i + 1}: estimated price cannot be negative`);
    }
    return {
      sequence: i + 1, description: it.description, quantity: q, unit: it.unit,
      unitPrice: p ?? null, amount: p ? money(q.times(p)) : dec(0),
    };
  });
}

/** Who may change this requisition's content (only while it is a draft). */
export function canEditRequisition(actor: Actor, r: { requestedById: string; status: RequisitionStatus }) {
  if (r.status !== "DRAFT") return false;
  return can(actor, "requisitions", "edit") || (r.requestedById === actor.id && can(actor, "requisitions", "create"));
}

/** Who may see it: everyone with "view", plus the requester. */
export function canSeeRequisition(actor: Actor, r: { requestedById: string }) {
  return can(actor, "requisitions", "view") || r.requestedById === actor.id;
}

/** A new choice must be an active department; keeping the current (possibly deactivated) one is fine. */
async function checkDepartment(tx: Tx, departmentId: string | null, current?: string | null) {
  if (!departmentId || departmentId === current) return;
  const d = await tx.department.findUnique({ where: { id: departmentId }, select: { active: true } });
  if (!d) throw new RuleError("Department not found");
  if (!d.active) throw new RuleError("That department is no longer active");
}

export async function createRequisition(db: Db, actor: Actor, raw: RequisitionInput, opts: { submit?: boolean } = {}) {
  if (!can(actor, "requisitions", "create")) throw new ForbiddenError("requisitions", "create");
  const data = requisitionInput.parse(raw);
  const items = computeItems(data.items);
  return inTx(db, async (tx) => {
    await checkDepartment(tx, data.departmentId);
    const company = await tx.companySettings.findUnique({ where: { id: 1 } });
    const r = await tx.requisition.create({
      data: {
        title: data.title, departmentId: data.departmentId, priority: data.priority,
        neededBy: parseDate(data.neededBy || null), deliverTo: data.deliverTo, purpose: data.purpose,
        currency: company?.defaultCurrency ?? "USD", estimatedTotal: sum(items.map((i) => i.amount)),
        requestedById: actor.id, items: { create: items },
      },
    });
    await audit(tx, actor, "requisition.created", "Requisition", r.id, { after: { ...r, items } });
    return opts.submit ? submitTx(tx, actor, r.id) : r;
  });
}

export async function updateRequisition(db: Db, actor: Actor, id: string, raw: RequisitionInput) {
  const data = requisitionInput.parse(raw);
  const items = computeItems(data.items);
  return inTx(db, async (tx) => {
    const before = await lock(tx, id);
    if (!canEditRequisition(actor, before)) {
      if (before.status !== "DRAFT") throw new RuleError("Only draft requisitions can be edited");
      throw new ForbiddenError("requisitions", "edit");
    }
    await checkDepartment(tx, data.departmentId, before.departmentId);
    await tx.requisitionItem.deleteMany({ where: { requisitionId: id } });
    const r = await tx.requisition.update({
      where: { id },
      data: {
        title: data.title, departmentId: data.departmentId, priority: data.priority,
        neededBy: parseDate(data.neededBy || null), deliverTo: data.deliverTo, purpose: data.purpose,
        estimatedTotal: sum(items.map((i) => i.amount)), items: { create: items },
      },
    });
    await audit(tx, actor, "requisition.updated", "Requisition", id, { before, after: { ...r, items } });
    return r;
  });
}

async function lock(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Requisition" WHERE "id" = ${id} FOR UPDATE`;
  const r = await tx.requisition.findUnique({ where: { id } });
  if (!r) throw new RuleError("Requisition not found");
  return r;
}

async function nextNumber(tx: Tx) {
  const year = String(today().getUTCFullYear());
  const key = `REQ-${year}`;
  await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("key", "next") VALUES (${key}, 1) ON CONFLICT ("key") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "InvoiceSequence" WHERE "key" = ${key} FOR UPDATE`;
  await tx.$executeRaw`UPDATE "InvoiceSequence" SET "next" = "next" + 1 WHERE "key" = ${key}`;
  return `REQ-${year}-${String(row.next).padStart(4, "0")}`;
}

async function submitTx(tx: Tx, actor: Actor, id: string) {
  const r = await lock(tx, id);
  if (r.status !== "DRAFT") throw new RuleError("Only draft requisitions can be submitted");
  if (r.requestedById !== actor.id && !can(actor, "requisitions", "edit")) throw new ForbiddenError("requisitions", "edit");
  const count = await tx.requisitionItem.count({ where: { requisitionId: id } });
  if (!count) throw new RuleError("Add at least one item before submitting");
  const updated = await tx.requisition.update({
    where: { id },
    data: { status: "SUBMITTED", number: r.number ?? (await nextNumber(tx)), submittedAt: new Date() },
  });
  await audit(tx, actor, "requisition.submitted", "Requisition", id, { before: { status: r.status }, after: { status: "SUBMITTED", number: updated.number } });
  return updated;
}

export async function submitRequisition(db: Db, actor: Actor, id: string) {
  return inTx(db, (tx) => submitTx(tx, actor, id));
}

/**
 * Status changes after submission.
 * - Approve / Reject / Fulfil: "approve" permission (not on your own request, unless you also hold "edit" — i.e. an admin).
 * - Back to draft (recall): the requester, or anyone with "edit", while it is still submitted.
 * - Cancel: the requester or anyone with "delete", while draft or submitted.
 */
export async function transitionRequisition(db: Db, actor: Actor, id: string, to: RequisitionStatus, note?: string) {
  return inTx(db, async (tx) => {
    const r = await lock(tx, id);
    if (to === "SUBMITTED") return submitTx(tx, actor, id);
    if (!STATUS_FLOW[r.status].includes(to)) throw new RuleError(`A ${r.status.toLowerCase()} requisition cannot be moved to ${to.toLowerCase()}`);
    const own = r.requestedById === actor.id;
    const reason = note?.trim() || null;

    if (to === "APPROVED" || to === "REJECTED" || to === "FULFILLED") {
      if (!can(actor, "requisitions", "approve")) throw new ForbiddenError("requisitions", "approve");
      if (own && to !== "FULFILLED" && !can(actor, "requisitions", "edit")) throw new RuleError("You cannot approve or reject your own requisition");
      if (to === "REJECTED" && !reason) throw new RuleError("A reason is required to reject a requisition");
    } else if (to === "DRAFT") {
      if (!own && !can(actor, "requisitions", "edit")) throw new ForbiddenError("requisitions", "edit");
    } else if (to === "CANCELLED") {
      if (!own && !can(actor, "requisitions", "delete")) throw new ForbiddenError("requisitions", "delete");
    }

    const decided = to === "APPROVED" || to === "REJECTED";
    const updated = await tx.requisition.update({
      where: { id },
      data: {
        status: to,
        ...(decided ? { decidedById: actor.id, decidedAt: new Date(), decisionNote: reason } : {}),
        ...(to === "FULFILLED" ? { fulfilledAt: new Date() } : {}),
        ...(to === "CANCELLED" && reason ? { decisionNote: reason } : {}),
      },
    });
    await audit(tx, actor, `requisition.${to.toLowerCase()}`, "Requisition", id, { before: { status: r.status }, after: { status: to }, reason: reason ?? undefined });
    return updated;
  });
}
