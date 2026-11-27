"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RequisitionPriority, RequisitionStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { RuleError } from "@/server/core/permissions";
import { createRequisition, transitionRequisition, updateRequisition, type RequisitionInput } from "@/server/core/requisitions";
import { prisma } from "@/server/db";

function readForm(fd: FormData): RequisitionInput {
  let items: RequisitionInput["items"] = [];
  try { items = JSON.parse(str(fd, "items") || "[]"); } catch { throw new RuleError("Invalid items"); }
  // Ignore completely empty rows (e.g. the blank row the form starts with).
  items = items.filter((i) => i.description?.trim() || i.unitPrice?.trim());
  return {
    title: str(fd, "title"), departmentId: str(fd, "departmentId"),
    priority: (str(fd, "priority") || "NORMAL") as RequisitionPriority, neededBy: str(fd, "neededBy"),
    deliverTo: str(fd, "deliverTo"), purpose: str(fd, "purpose"), items,
  };
}

export async function createRequisitionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const submit = str(fd, "intent") === "submit";
  let id = "";
  const res = await runAction(async () => {
    id = (await createRequisition(prisma, actor, readForm(fd), { submit })).id;
  });
  if (res?.ok) redirect(`/requisitions/${id}?flash=${encodeURIComponent(submit ? "Requisition submitted" : "Requisition saved as draft")}`);
  return res;
}

export async function updateRequisitionAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const submit = str(fd, "intent") === "submit";
  const res = await runAction(async () => {
    await updateRequisition(prisma, actor, id, readForm(fd));
    if (submit) await transitionRequisition(prisma, actor, id, "SUBMITTED");
  });
  if (res?.ok) redirect(`/requisitions/${id}?flash=${encodeURIComponent(submit ? "Requisition submitted" : "Requisition updated")}`);
  return res;
}

const DONE: Partial<Record<RequisitionStatus, string>> = {
  SUBMITTED: "Requisition submitted", APPROVED: "Requisition approved", REJECTED: "Requisition rejected",
  FULFILLED: "Requisition marked fulfilled", CANCELLED: "Requisition cancelled", DRAFT: "Requisition moved back to draft",
};

export async function transitionRequisitionAction(id: string, to: RequisitionStatus, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  const res = await runAction(async () => {
    await transitionRequisition(prisma, actor, id, to, str(fd, "reason") || str(fd, "note"));
    revalidatePath("/requisitions");
  });
  // The button that ran this disappears with the new status, so show the result as a page flash.
  if (res?.ok) redirect(`/requisitions/${id}?flash=${encodeURIComponent(DONE[to] ?? "Requisition updated")}`);
  return res;
}
