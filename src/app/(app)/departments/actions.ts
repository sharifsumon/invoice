"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { createDepartment, deleteDepartment, renameDepartment, setDepartmentActive } from "@/server/core/departments";
import { prisma } from "@/server/db";

function done(res: ActionState, flash: string) {
  revalidatePath("/departments");
  if (res?.ok) redirect(`/departments?flash=${encodeURIComponent(flash)}`);
  return res;
}

export async function createDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const name = str(fd, "name").trim();
  return done(await runAction(async () => { await createDepartment(prisma, actor, name); }), `Department added: ${name}`);
}

export async function renameDepartmentAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const name = str(fd, "name").trim();
  return done(await runAction(async () => { await renameDepartment(prisma, actor, id, name); }), `Department renamed to ${name}`);
}

export async function setDepartmentActiveAction(id: string, active: boolean, _: ActionState, __: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return done(await runAction(async () => { await setDepartmentActive(prisma, actor, id, active); }), active ? "Department activated" : "Department deactivated");
}

export async function deleteDepartmentAction(id: string, _: ActionState, __: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return done(await runAction(async () => { await deleteDepartment(prisma, actor, id); }), "Department deleted");
}
