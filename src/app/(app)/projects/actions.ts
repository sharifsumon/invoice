"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { createProject, PROJECT_STATUSES, transitionProject, updateProject } from "@/server/core/projects";
import { prisma } from "@/server/db";

function fields(fd: FormData) {
  return {
    code: str(fd, "code"), name: str(fd, "name"), clientId: str(fd, "clientId"), description: str(fd, "description"),
    startDate: str(fd, "startDate"), plannedEndDate: str(fd, "plannedEndDate"), actualEndDate: str(fd, "actualEndDate"),
    managerId: str(fd, "managerId"), value: str(fd, "value"), currency: str(fd, "currency"), remarks: str(fd, "remarks"),
  };
}

export async function createProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    id = (await createProject(prisma, actor, fields(fd))).id;
  });
  if (res?.ok) redirect(`/projects/${id}`);
  return res;
}

export async function updateProjectAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updateProject(prisma, actor, id, fields(fd), str(fd, "reason"));
    revalidatePath(`/projects/${id}`);
    return "Project updated";
  });
}

export async function updateProjectAndCloseAction(id: string, s: ActionState, fd: FormData) {
  const res = await updateProjectAction(id, s, fd);
  if (res?.ok) redirect(`/projects/${id}?flash=${encodeURIComponent("Project updated")}`);
  return res;
}

/** Status dropdown on the project page. */
export async function setProjectStatusAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  const to = str(fd, "status");
  if (!(PROJECT_STATUSES as string[]).includes(to)) return { error: "Choose a valid status", at: Date.now() };
  const res = await runAction(async () => {
    await transitionProject(prisma, actor, id, to as ProjectStatus, { approvalDate: str(fd, "approvalDate") || undefined });
  });
  if (res?.ok) redirect(`/projects/${id}?flash=${encodeURIComponent(`Project moved to ${to.toLowerCase().replace("_", " ")}`)}`);
  return res;
}
