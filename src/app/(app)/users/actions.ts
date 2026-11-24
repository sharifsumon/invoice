"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, requireUser } from "@/server/auth";
import { adminResetMfa } from "@/server/core/account";
import { bool, runAction, str, type ActionState } from "@/server/action";
import { MODULES } from "@/server/core/permissions";
import { createGroup, createUser, deleteGroup, updateGroup, updateUser } from "@/server/core/users";
import { prisma } from "@/server/db";

/** Creates the user, then closes the form (back to the list) with a confirmation. */
export async function createUserAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  const res = await runAction(async () => {
    await createUser(prisma, actor, { name: str(fd, "name"), email: str(fd, "email"), groupId: str(fd, "groupId"), password: str(fd, "password") });
    return "User created";
  });
  if (!res?.ok) return res;
  revalidatePath("/users");
  redirect("/users?flash=User+created");
}

export async function updateUserAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const u = await updateUser(prisma, actor, id, {
      name: str(fd, "name"), email: str(fd, "email"), groupId: str(fd, "groupId"),
      password: str(fd, "password") || undefined, active: bool(fd, "active"),
    });
    if (id === actor.id) await createSession(u.id, u.sessionVersion); // editing yourself keeps you signed in here
    revalidatePath("/users");
    return "User updated";
  });
}

export async function resetMfaAction(id: string, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await adminResetMfa(prisma, actor, id);
    revalidatePath("/users");
    return "Two-factor reset; the user has been signed out";
  });
}

// ───────────── Groups ─────────────

/** Checkboxes are named "perm:<module>:<action>". */
function readPerms(fd: FormData) {
  const perms: Record<string, string[]> = {};
  for (const m of MODULES) {
    const list = m.actions.map((a) => a.key).filter((a) => fd.get(`perm:${m.key}:${a}`) === "on");
    if (list.length) perms[m.key] = list;
  }
  return perms;
}

export async function createGroupAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    const g = await createGroup(prisma, actor, { name: str(fd, "name"), description: str(fd, "description"), permissions: readPerms(fd) });
    id = g.id;
    return "Group created";
  });
  if (!id) return res;
  revalidatePath("/users/groups");
  redirect(`/users/groups/${id}?flash=Group+created`);
}

export async function updateGroupAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updateGroup(prisma, actor, id, { name: str(fd, "name"), description: str(fd, "description"), permissions: readPerms(fd) });
    revalidatePath("/users/groups");
    revalidatePath(`/users/groups/${id}`);
    return "Group saved";
  });
}

export async function deleteGroupAction(id: string, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  const res = await runAction(async () => {
    await deleteGroup(prisma, actor, id);
    return "Group deleted";
  });
  if (!res?.ok) return res;
  revalidatePath("/users/groups");
  redirect("/users/groups?flash=Group+deleted");
}
