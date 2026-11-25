import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit, inTx, type Actor, type Db, type Tx } from "./common";
import { can, ForbiddenError, normalizePerms, RuleError, type Perms } from "./permissions";
import { assertUserSeat } from "./subscription";

export const PASSWORD_RULE = "At least 10 characters, with a letter and a number";
export function checkPassword(pw: string) {
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new RuleError(`Password: ${PASSWORD_RULE}`);
}

// ───────────── Users ─────────────

export const userInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  groupId: z.string().min(1, "Choose a group"),
  password: z.string().optional(),
});

/** Never leave the system without an active user who can manage users and groups. */
async function assertGroupManagerRemains(tx: Tx) {
  const groups = await tx.userGroup.findMany({ select: { id: true, permissions: true } });
  const managerGroups = groups.filter((g) => can({ perms: normalizePerms(g.permissions) }, "users", "groups")).map((g) => g.id);
  const n = managerGroups.length ? await tx.user.count({ where: { active: true, groupId: { in: managerGroups } } }) : 0;
  if (n === 0) throw new RuleError("At least one active user must stay in a group that can manage groups");
}

export async function createUser(db: Db, actor: Actor, raw: z.input<typeof userInput>) {
  if (!can(actor, "users", "create")) throw new ForbiddenError("users", "create");
  const data = userInput.parse(raw);
  checkPassword(data.password ?? "");
  return inTx(db, async (tx) => {
    const group = await tx.userGroup.findUnique({ where: { id: data.groupId }, select: { name: true } });
    if (!group) throw new RuleError("Choose a valid group");
    if (await tx.user.findUnique({ where: { email: data.email }, select: { id: true } })) throw new RuleError("A user with this email already exists");
    await assertUserSeat(tx); // plan / trial user limit
    const u = await tx.user.create({
      data: { name: data.name, email: data.email, groupId: data.groupId, passwordHash: await bcrypt.hash(data.password!, 12) },
    });
    await audit(tx, actor, "user.created", "User", u.id, { after: { name: u.name, email: u.email, group: group.name } });
    return u;
  });
}

/** Edit needs "edit"; activating / deactivating needs "delete". Password reset, deactivation or a group change signs the user out everywhere. */
export async function updateUser(db: Db, actor: Actor, id: string, raw: z.input<typeof userInput> & { active: boolean }) {
  if (!can(actor, "users", "edit")) throw new ForbiddenError("users", "edit");
  const data = userInput.parse(raw);
  if (id === actor.id && !raw.active) throw new RuleError("You cannot deactivate your own account");
  if (data.password) checkPassword(data.password);
  return inTx(db, async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id }, select: { name: true, email: true, groupId: true, active: true } });
    if (before.active !== raw.active && !can(actor, "users", "delete")) throw new ForbiddenError("users", "delete");
    if (!(await tx.userGroup.findUnique({ where: { id: data.groupId }, select: { id: true } }))) throw new RuleError("Choose a valid group");
    if (!before.active && raw.active) await assertUserSeat(tx); // re-activating takes a seat
    const revoke = !!data.password || before.active !== raw.active || before.groupId !== data.groupId;
    const u = await tx.user.update({
      where: { id },
      data: {
        name: data.name, email: data.email, groupId: data.groupId, active: raw.active,
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12) } : {}),
        ...(revoke ? { sessionVersion: { increment: 1 } } : {}),
      },
    });
    await assertGroupManagerRemains(tx);
    await audit(tx, actor, "user.updated", "User", id, {
      before, after: { name: u.name, email: u.email, groupId: u.groupId, active: u.active, passwordChanged: !!data.password },
    });
    return u;
  });
}

// ───────────── Groups ─────────────

export const groupInput = z.object({
  name: z.string().trim().min(1, "Group name is required").max(80),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
  permissions: z.record(z.string(), z.array(z.string())),
});
export type GroupInput = z.input<typeof groupInput>;

function needGroups(actor: Actor) {
  if (!can(actor, "users", "groups")) throw new ForbiddenError("users", "groups");
}

function cleanPerms(p: Record<string, string[]>): Perms {
  const perms = normalizePerms(p);
  // Any other right on a module implies being able to see it
  for (const k of Object.keys(perms) as (keyof Perms)[]) {
    const list = perms[k]!;
    if (k !== "settings" && !list.includes("view")) list.unshift("view");
  }
  return perms;
}

export async function createGroup(db: Db, actor: Actor, raw: GroupInput) {
  needGroups(actor);
  const d = groupInput.parse(raw);
  return inTx(db, async (tx) => {
    if (await tx.userGroup.findUnique({ where: { name: d.name }, select: { id: true } })) throw new RuleError("A group with this name already exists");
    const g = await tx.userGroup.create({ data: { name: d.name, description: d.description, permissions: cleanPerms(d.permissions) } });
    await audit(tx, actor, "group.created", "UserGroup", g.id, { after: g });
    return g;
  });
}

export async function updateGroup(db: Db, actor: Actor, id: string, raw: GroupInput) {
  needGroups(actor);
  const d = groupInput.parse(raw);
  return inTx(db, async (tx) => {
    const before = await tx.userGroup.findUniqueOrThrow({ where: { id } });
    const clash = await tx.userGroup.findUnique({ where: { name: d.name }, select: { id: true } });
    if (clash && clash.id !== id) throw new RuleError("A group with this name already exists");
    const g = await tx.userGroup.update({ where: { id }, data: { name: d.name, description: d.description, permissions: cleanPerms(d.permissions) } });
    await assertGroupManagerRemains(tx);
    await audit(tx, actor, "group.updated", "UserGroup", id, { before, after: g });
    return g;
  });
}

/** Only an empty group can be deleted (move its users to another group first). */
export async function deleteGroup(db: Db, actor: Actor, id: string) {
  needGroups(actor);
  return inTx(db, async (tx) => {
    const g = await tx.userGroup.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
    if (g._count.users > 0) throw new RuleError(`Move the ${g._count.users} user(s) in "${g.name}" to another group before deleting it`);
    await tx.userGroup.delete({ where: { id } });
    await audit(tx, actor, "group.deleted", "UserGroup", id, { before: { name: g.name, permissions: g.permissions } });
  });
}
