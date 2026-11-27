import { z } from "zod";
import { audit, inTx, type Actor, type Db } from "./common";
import { can, ForbiddenError, RuleError } from "./permissions";

/** Departments used on requisitions. Managed by administrators (Settings permission). Never deleted once used — deactivate instead. */

const nameInput = z.string().trim().min(1, "Department name is required").max(120, "Keep the name under 120 characters");

function assertAdmin(actor: Actor) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
}

async function assertUnique(db: Db | Parameters<Parameters<typeof inTx>[1]>[0], name: string, exceptId?: string) {
  const clash = await db.department.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new RuleError(`A department called "${clash.name}" already exists`);
}

export async function createDepartment(db: Db, actor: Actor, rawName: string) {
  assertAdmin(actor);
  const name = nameInput.parse(rawName);
  return inTx(db, async (tx) => {
    await assertUnique(tx, name);
    const d = await tx.department.create({ data: { name } });
    await audit(tx, actor, "department.created", "Department", d.id, { after: d });
    return d;
  });
}

export async function renameDepartment(db: Db, actor: Actor, id: string, rawName: string) {
  assertAdmin(actor);
  const name = nameInput.parse(rawName);
  return inTx(db, async (tx) => {
    const before = await tx.department.findUnique({ where: { id } });
    if (!before) throw new RuleError("Department not found");
    await assertUnique(tx, name, id);
    const d = await tx.department.update({ where: { id }, data: { name } });
    await audit(tx, actor, "department.renamed", "Department", id, { before, after: d });
    return d;
  });
}

/** Inactive departments stay on existing requisitions but can't be picked for new ones. */
export async function setDepartmentActive(db: Db, actor: Actor, id: string, active: boolean) {
  assertAdmin(actor);
  return inTx(db, async (tx) => {
    const before = await tx.department.findUnique({ where: { id } });
    if (!before) throw new RuleError("Department not found");
    const d = await tx.department.update({ where: { id }, data: { active } });
    await audit(tx, actor, active ? "department.activated" : "department.deactivated", "Department", id, { before, after: d });
    return d;
  });
}

/** Unused departments can be removed completely. */
export async function deleteDepartment(db: Db, actor: Actor, id: string) {
  assertAdmin(actor);
  return inTx(db, async (tx) => {
    const d = await tx.department.findUnique({ where: { id }, include: { _count: { select: { requisitions: true } } } });
    if (!d) throw new RuleError("Department not found");
    if (d._count.requisitions) throw new RuleError("This department is used on requisitions. Deactivate it instead.");
    await tx.department.delete({ where: { id } });
    await audit(tx, actor, "department.deleted", "Department", id, { before: d });
  });
}
