"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { beginMfaSetup, changeOwnPassword, confirmMfaSetup, disableOwnMfa, signOutEverywhere } from "@/server/core/account";
import { RuleError } from "@/server/core/permissions";
import { prisma } from "@/server/db";

export async function changePasswordAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    if (str(fd, "next") !== str(fd, "confirm")) throw new RuleError("The new passwords do not match.");
    const sv = await changeOwnPassword(prisma, actor, str(fd, "current"), str(fd, "next"));
    await createSession(actor.id, sv); // keep this session; all others are now invalid
    return "Password changed. Other sessions have been signed out.";
  });
}

export async function beginMfaAction(_: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await beginMfaSetup(prisma, actor);
    revalidatePath("/account");
    return "Scan the QR code, then enter a code to confirm";
  });
}

export async function confirmMfaAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const sv = await confirmMfaSetup(prisma, actor, str(fd, "code"));
    await createSession(actor.id, sv);
    revalidatePath("/account");
    return "Two-factor authentication is on. You'll be asked for a code at each sign-in.";
  });
}

export async function disableMfaAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await disableOwnMfa(prisma, actor, str(fd, "password"), str(fd, "code"));
    revalidatePath("/account");
    return "Two-factor authentication turned off";
  });
}

export async function signOutEverywhereAction() {
  const actor = await requireUser();
  await signOutEverywhere(prisma, actor);
  await destroySession();
  redirect("/login");
}
