import { z } from "zod";
import { ProjectStatus } from "@/generated/prisma/enums";
import { audit, inTx, parseDate, today, type Actor, type Db, type Tx } from "./common";
import { dec, money } from "./money";
import { getSettings } from "./settings";
import { can, ForbiddenError, RuleError } from "./permissions";

const optStr = z.string().trim().max(5000).optional().transform((v) => (v ? v : null));
const optDate = z.string().optional().transform((v) => parseDate(v || null));

export const projectInput = z.object({
  /** Ignored: codes are generated automatically (Settings prefix + running number) and never change. */
  code: z.string().optional(),
  name: z.string().trim().min(1, "Project name is required").max(200),
  clientId: z.string().min(1, "Client is required"),
  description: optStr,
  startDate: optDate,
  plannedEndDate: optDate,
  actualEndDate: optDate,
  managerId: z.string().optional().transform((v) => v || null),
  value: z.string().min(1, "Project value is required"),
  /** Ignored: projects always use the company currency from Settings (kept for callers that still send it). */
  currency: z.string().optional(),
  remarks: optStr,
});
export type ProjectInput = z.input<typeof projectInput>;

function parseValue(v: string) {
  let d;
  try { d = money(dec(v)); } catch { throw new RuleError("Project value must be a number"); }
  if (d.lt(0)) throw new RuleError("Project value cannot be negative");
  return d;
}

/**
 * Project lifecycle: Draft → In Progress ⇄ On Hold → Completed, or Cancelled.
 * Moving a project to In Progress (or straight to Completed) is its approval: from then on it counts toward
 * Business Value (BR-01), using the approval date. On Hold keeps whatever approval the project already had.
 * Completed projects can be reopened; cancelled ones can go back to Draft.
 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED,
];
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: [ProjectStatus.IN_PROGRESS, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  IN_PROGRESS: [ProjectStatus.DRAFT, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  ON_HOLD: [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  COMPLETED: [ProjectStatus.IN_PROGRESS],
  CANCELLED: [ProjectStatus.DRAFT],
};
const STARTS_WORK: ProjectStatus[] = [ProjectStatus.IN_PROGRESS, ProjectStatus.COMPLETED];

/** Whether moving `project` to `to` approves it (and therefore needs the "approve" permission). */
export function transitionApproves(project: { approved: boolean }, to: ProjectStatus) {
  return !project.approved && STARTS_WORK.includes(to);
}

const CODE_DIGITS = 4;
const SEQ_KEY = "PROJECT_CODE";
const formatCode = (prefix: string, n: number) => `${prefix}${String(n).padStart(CODE_DIGITS, "0")}`;

/** Allocate the next project code (row-locked counter; skips any code already taken, e.g. older manual codes). */
async function nextProjectCode(tx: Tx, prefix: string) {
  await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("key", "next") VALUES (${SEQ_KEY}, 1) ON CONFLICT ("key") DO NOTHING`;
  for (;;) {
    const [row] = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "InvoiceSequence" WHERE "key" = ${SEQ_KEY} FOR UPDATE`;
    await tx.$executeRaw`UPDATE "InvoiceSequence" SET "next" = "next" + 1 WHERE "key" = ${SEQ_KEY}`;
    const code = formatCode(prefix, row.next);
    if (!(await tx.project.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
}

/** The code the next new project will most likely get (shown on the form; the real one is assigned on save). */
export async function peekNextProjectCode(db: Db) {
  const { company } = await getSettings(db);
  const seq = await db.invoiceSequence.findUnique({ where: { key: SEQ_KEY } });
  let n = seq?.next ?? 1;
  while (await db.project.findUnique({ where: { code: formatCode(company.projectCodePrefix, n) }, select: { id: true } })) n++;
  return formatCode(company.projectCodePrefix, n);
}

export async function createProject(db: Db, actor: Actor, raw: ProjectInput) {
  if (!can(actor, "projects", "create")) throw new ForbiddenError("projects", "create");
  const data = projectInput.parse(raw);
  const value = parseValue(data.value);
  const { company } = await getSettings(db);
  return inTx(db, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: data.clientId } });
    if (!client || client.archived) throw new RuleError("Select an active client");
    const code = await nextProjectCode(tx, company.projectCodePrefix);
    const p = await tx.project.create({ data: { ...data, code, value, currency: company.defaultCurrency, status: ProjectStatus.DRAFT } });
    await audit(tx, actor, "project.created", "Project", p.id, { after: p });
    return p;
  });
}

/** BRD §5.3: changing an approved project's value requires a reason and is audited (old/new/user/time). */
export async function updateProject(db: Db, actor: Actor, id: string, raw: ProjectInput, reason?: string) {
  if (!can(actor, "projects", "edit")) throw new ForbiddenError("projects", "edit");
  const data = projectInput.parse(raw);
  const value = parseValue(data.value);
  return inTx(db, async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id } });
    if (before.status === ProjectStatus.CANCELLED) {
      throw new RuleError("A cancelled project cannot be edited — move it back to Draft first");
    }
    if (before.clientId !== data.clientId) {
      const linked = await tx.purchaseOrder.count({ where: { projectId: id } });
      if (linked) throw new RuleError("Client cannot be changed once POs exist for this project");
    }
    const valueChanged = !before.value.eq(value);
    if (before.approved && valueChanged && !reason?.trim()) {
      throw new RuleError("A reason is required to change the value of an approved project");
    }
    // Currency never changes on edit: it was fixed from Settings when the project was created.
    const p = await tx.project.update({ where: { id }, data: { ...data, code: before.code, value, currency: before.currency } });
    if (before.approved && valueChanged) {
      await audit(tx, actor, "project.value_changed", "Project", id, {
        before: { value: before.value, currency: before.currency },
        after: { value, currency: before.currency },
        reason: reason!.trim(),
      });
    }
    await audit(tx, actor, "project.updated", "Project", id, { before, after: p, reason: reason?.trim() || null });
    return p;
  });
}

export async function transitionProject(
  db: Db, actor: Actor, id: string, to: ProjectStatus, opts: { approvalDate?: string; reason?: string } = {},
) {
  if (!can(actor, "projects", "edit") && !can(actor, "projects", "approve") && !can(actor, "projects", "delete")) {
    throw new ForbiddenError("projects", "edit");
  }

  return inTx(db, async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id } });
    if (before.status === to) return before;
    if (!PROJECT_TRANSITIONS[before.status].includes(to)) {
      throw new RuleError(`Cannot move a project from ${before.status} to ${to}`);
    }
    // Cancelling needs "delete"; starting / completing needs "approve"; any other move needs "edit".
    const need = to === ProjectStatus.CANCELLED ? "delete" : transitionApproves(before, to) ? "approve" : "edit";
    if (!can(actor, "projects", need)) throw new ForbiddenError("projects", need);
    if (to === ProjectStatus.DRAFT && before.status !== ProjectStatus.CANCELLED) {
      const linked = await tx.purchaseOrder.count({ where: { projectId: id, status: { not: "CANCELLED" } } });
      if (linked) throw new RuleError("A project with purchase orders cannot go back to Draft");
    }
    const data: { status: ProjectStatus; approved?: boolean; approvalDate?: Date | null; actualEndDate?: Date } = { status: to };
    if (transitionApproves(before, to)) {
      data.approved = true;
      data.approvalDate = parseDate(opts.approvalDate) ?? before.approvalDate ?? today();
    } else if (to === ProjectStatus.DRAFT || to === ProjectStatus.CANCELLED) {
      data.approved = false;
    }
    if (to === ProjectStatus.COMPLETED && !before.actualEndDate) data.actualEndDate = today();
    const p = await tx.project.update({ where: { id }, data });
    await audit(tx, actor, `project.status.${to.toLowerCase()}`, "Project", id, {
      before: { status: before.status, approved: before.approved, approvalDate: before.approvalDate },
      after: { status: p.status, approved: p.approved, approvalDate: p.approvalDate },
      reason: opts.reason ?? null,
    });
    return p;
  });
}

/**
 * BR-01/02/03/12: Business Value = sum of approved project values, grouped by currency
 * (and optionally by approval month). PO values are never included.
 */
export async function businessValue(db: Db, opts: { from?: Date; to?: Date } = {}) {
  const rows = await db.project.groupBy({
    by: ["currency"],
    where: {
      approved: true,
      status: { not: ProjectStatus.CANCELLED },
      approvalDate: { gte: opts.from, lte: opts.to },
    },
    _sum: { value: true },
    _count: true,
  });
  return rows.map((r) => ({ currency: r.currency, value: r._sum.value ?? dec(0), projects: r._count }));
}

export async function businessValueByMonth(db: Db, year: number) {
  return db.$queryRaw<{ month: number; currency: string; value: string }[]>`
    SELECT EXTRACT(MONTH FROM "approvalDate")::int AS month, "currency", SUM("value")::text AS value
      FROM "Project"
     WHERE "approved" = true AND "status" <> 'CANCELLED'
       AND EXTRACT(YEAR FROM "approvalDate") = ${year}
     GROUP BY 1, 2 ORDER BY 1, 2`;
}
