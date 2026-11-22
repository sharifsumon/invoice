"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { POStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { approvePO, createPO, generateMilestoneInvoices, transitionPO, updatePO } from "@/server/core/pos";
import { createManualInvoice } from "@/server/core/invoices";
import { RuleError } from "@/server/core/permissions";
import { addAttachment, removeAttachment } from "@/server/core/attachments";
import { prisma } from "@/server/db";

export async function uploadAttachmentAction(poId: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new RuleError("Choose a file");
    await addAttachment(prisma, actor, "PurchaseOrder", poId, { name: f.name, data: Buffer.from(await f.arrayBuffer()) });
    revalidatePath(`/pos/${poId}`);
    return "Attachment uploaded";
  });
}

export async function removeAttachmentAction(poId: string, id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await removeAttachment(prisma, actor, id, str(fd, "reason"));
    revalidatePath(`/pos/${poId}`);
    return "Attachment removed";
  });
}

function fields(fd: FormData) {
  let milestones: { name: string; percentage: string; expectedDate: string; notes: string }[] = [];
  try { milestones = JSON.parse(str(fd, "milestones") || "[]"); } catch { throw new RuleError("Invalid milestone data"); }
  return {
    poNumber: str(fd, "poNumber"), projectId: str(fd, "projectId"), poDate: str(fd, "poDate"), value: str(fd, "value"),
    currency: str(fd, "currency") || undefined, paymentTerms: str(fd, "paymentTerms"), reference: str(fd, "reference"),
    remarks: str(fd, "remarks"), milestones,
  };
}

export async function createPOAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => { id = (await createPO(prisma, actor, fields(fd))).id; });
  if (res?.ok) redirect(`/pos/${id}`);
  return res;
}

export async function updatePOAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updatePO(prisma, actor, id, fields(fd));
    revalidatePath(`/pos/${id}`);
    return "PO updated";
  });
}

export async function transitionPOAction(id: string, to: POStatus, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  let flash = "";
  const res = await runAction(async () => {
    if (to === "APPROVED") {
      const r = await approvePO(prisma, actor, id);
      flash = r.generated ? `PO approved — ${r.generated} milestone invoice${r.generated > 1 ? "s" : ""} generated as drafts` : "PO approved";
    } else {
      await transitionPO(prisma, actor, id, to, str(fd, "reason") || undefined);
      flash = `PO moved to ${to.toLowerCase().replace("_", " ")}`;
    }
  });
  // The button that triggered this disappears with the status change, so confirm via a page banner.
  if (res?.ok) redirect(`/pos/${id}?flash=${encodeURIComponent(flash)}`);
  return res;
}

export async function retryGenerationAction(id: string, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const n = await generateMilestoneInvoices(prisma, actor, id);
    revalidatePath(`/pos/${id}`);
    return n ? `${n} missing milestone invoice(s) generated` : "All milestones already have valid invoices";
  });
}

export async function createManualInvoiceAction(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    let lines: { description: string; quantity: string; unitPrice: string }[] = [];
    try { lines = JSON.parse(str(fd, "lines") || "[]"); } catch { throw new RuleError("Invalid line items"); }
    id = (await createManualInvoice(prisma, actor, {
      poId, lines, milestoneId: str(fd, "milestoneId") || undefined, discount: str(fd, "discount"),
      taxRate: str(fd, "taxRate"), dueDate: str(fd, "dueDate"), notes: str(fd, "notes"), terms: str(fd, "terms"),
    })).id;
  });
  if (res?.ok) redirect(`/invoices/${id}`);
  return res;
}
