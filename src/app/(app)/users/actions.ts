"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/generated/prisma/enums";
import { createSession, requireUser } from "@/server/auth";
import { adminResetMfa } from "@/server/core/account";
import { bool, runAction, str, type ActionState } from "@/server/action";
import { createUser, updateUser } from "@/server/core/settings";
import { prisma } from "@/server/db";

export async function createUserAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await createUser(prisma, actor, { name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role") as Role, password: str(fd, "password") });
    revalidatePath("/users");
    return "User created";
  });
}

export async function updateUserAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const u = await updateUser(prisma, actor, id, {
      name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role") as Role,
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
