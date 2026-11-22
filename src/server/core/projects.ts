import { z } from "zod";
import { ProjectStatus } from "@/generated/prisma/enums";
import { audit, inTx, parseDate, today, type Actor, type Db } from "./common";
import { dec, money } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";

const optStr = z.string().trim().max(5000).optional().transform((v) => (v ? v : null));
const optDate = z.string().optional().transform((v) => parseDate(v || null));

export const projectInput = z.object({
  code: z.string().trim().min(1, "Project code is required").max(50),
  name: z.string().trim().min(1, "Project name is required").max(200),
  clientId: z.string().min(1, "Client is required"),
  description: optStr,
  startDate: optDate,
  plannedEndDate: optDate,
  actualEndDate: optDate,
  managerId: z.string().optional().transform((v) => v || null),
  value: z.string().min(1, "Project value is required"),
  currency: z.string().trim().length(3, "Use a 3-letter currency code").transform((v) => v.toUpperCase()),
  remarks: optStr,
});
export type ProjectInput = z.input<typeof projectInput>;

function parseValue(v: string) {
  let d;
  try { d = money(dec(v)); } catch { throw new RuleError("Project value must be a number"); }
  if (d.lt(0)) throw new RuleError("Project value cannot be negative");
  return d;
}

/** Statuses that count as "approved" for Business Value (BR-01). */
const APPROVED_FAMILY: ProjectStatus[] = [ProjectStatus.APPROVED, ProjectStatus.IN_PROGRESS, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED];

export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  PROPOSED: [ProjectStatus.DRAFT, ProjectStatus.SUBMITTED, ProjectStatus.CANCELLED],
  DRAFT: [ProjectStatus.PROPOSED, ProjectStatus.SUBMITTED, ProjectStatus.CANCELLED],
  SUBMITTED: [ProjectStatus.APPROVED, ProjectStatus.REJECTED, ProjectStatus.DRAFT],
  APPROVED: [ProjectStatus.IN_PROGRESS, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  IN_PROGRESS: [ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.CANCELLED],
  ON_HOLD: [ProjectStatus.IN_PROGRESS, ProjectStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [ProjectStatus.DRAFT],
};

export async function createProject(db: Db, actor: Actor, raw: ProjectInput, initial: "DRAFT" | "PROPOSED" = "DRAFT") {
  if (!can(actor.role, "projects", "create")) throw new ForbiddenError("projects", "create");
  const data = projectInput.parse(raw);
  const value = parseValue(data.value);
  return inTx(db, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: data.clientId } });
    if (!client || client.archived) throw new RuleError("Select an active client");
    const p = await tx.project.create({ data: { ...data, value, status: initial } });
    await audit(tx, actor, "project.created", "Project", p.id, { after: p });
    return p;
  });
}

/** BRD §5.3: changing an approved project's value requires a reason and is audited (old/new/user/time). */
export async function updateProject(db: Db, actor: Actor, id: string, raw: ProjectInput, reason?: string) {
  if (!can(actor.role, "projects", "edit")) throw new ForbiddenError("projects", "edit");
  const data = projectInput.parse(raw);
  const value = parseValue(data.value);
  return inTx(db, async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id } });
    if (before.status === ProjectStatus.CANCELLED || before.status === ProjectStatus.COMPLETED) {
      throw new RuleError(`A ${before.status.toLowerCase()} project cannot be edited`);
    }
    if (before.clientId !== data.clientId) {
      const linked = await tx.purchaseOrder.count({ where: { projectId: id } });
      if (linked) throw new RuleError("Client cannot be changed once POs exist for this project");
    }
    const valueChanged = !before.value.eq(value);
    const currencyChanged = before.currency !== data.currency;
    if (before.approved && (valueChanged || currencyChanged)) {
      if (!reason?.trim()) throw new RuleError("A reason is required to change the value of an approved project");
      if (currencyChanged) {
        const linked = await tx.purchaseOrder.count({ where: { projectId: id } });
        if (linked) throw new RuleError("Currency cannot be changed once POs exist for this project");
      }
    }
    const p = await tx.project.update({ where: { id }, data: { ...data, value } });
    if (before.approved && valueChanged) {
      await audit(tx, actor, "project.value_changed", "Project", id, {
        before: { value: before.value, currency: before.currency },
        after: { value, currency: data.currency },
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
  const needsApprove = to === ProjectStatus.APPROVED || to === ProjectStatus.REJECTED;
  const perm = needsApprove ? "approve" : "edit";
  if (!can(actor.role, "projects", perm)) throw new ForbiddenError("projects", perm);

  return inTx(db, async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id } });
    if (!PROJECT_TRANSITIONS[before.status].includes(to)) {
      throw new RuleError(`Cannot move a project from ${before.status} to ${to}`);
    }
    const data: { status: ProjectStatus; approved?: boolean; approvalDate?: Date | null; actualEndDate?: Date } = { status: to };
    if (to === ProjectStatus.APPROVED) {
      data.approved = true;
      data.approvalDate = parseDate(opts.approvalDate) ?? today();
    } else if (to === ProjectStatus.CANCELLED || to === ProjectStatus.REJECTED) {
      data.approved = false;
    } else if (APPROVED_FAMILY.includes(to)) {
      data.approved = true;
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
      status: { notIn: [ProjectStatus.CANCELLED, ProjectStatus.REJECTED] },
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
     WHERE "approved" = true AND "status" NOT IN ('CANCELLED','REJECTED')
       AND EXTRACT(YEAR FROM "approvalDate") = ${year}
     GROUP BY 1, 2 ORDER BY 1, 2`;
}
