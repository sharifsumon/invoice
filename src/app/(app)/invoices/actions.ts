"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { cancelAndReissue, cancelInvoice, createBalanceInvoice, createManualInvoice, finalizeInvoice, updateDraftInvoice } from "@/server/core/invoices";
import { RuleError } from "@/server/core/permissions";
import { approvePO } from "@/server/core/pos";
import { recordPayment, reversePayment } from "@/server/core/payments";
import { parseAddresses, sendInvoiceEmail } from "@/server/core/email";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

/** Individual invoice straight to a client (no PO / project). */
export async function createStandaloneInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    let lines: { description: string; quantity: string; unitPrice: string }[] = [];
    try { lines = JSON.parse(str(fd, "lines") || "[]"); } catch { throw new RuleError("Invalid line items"); }
    id = (await createManualInvoice(prisma, actor, {
      clientId: str(fd, "clientId"), lines, discount: str(fd, "discount"), taxRate: str(fd, "taxRate"),
      invoiceDate: str(fd, "invoiceDate"), dueDate: str(fd, "dueDate"), notes: str(fd, "notes"), terms: str(fd, "terms"),
    })).id;
  });
  if (res?.ok) redirect(`/invoices/${id}`);
  return res;
}

/** "Approve" on a pending invoice: approves its PO, which releases all of the PO's milestone invoices. */
export async function approvePendingInvoiceAction(invoiceId: string, _: ActionState, __: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let flash = "";
  const res = await runAction(async () => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { poId: true } });
    if (!inv.poId) throw new RuleError("This invoice has no PO to approve");
    const r = await approvePO(prisma, actor, inv.poId);
    const n = r.milestones;
    flash = n ? `PO approved — ${n} milestone invoice${n > 1 ? "s" : ""} ready to finalize` : "PO approved";
  });
  if (res?.ok) redirect(`/invoices/${invoiceId}?flash=${encodeURIComponent(flash)}`);
  return res;
}

export async function recordPaymentAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const f = fd.get("receipt");
    const receipt = f instanceof File && f.size > 0 ? { name: f.name, data: Buffer.from(await f.arrayBuffer()) } : null;
    await recordPayment(prisma, actor, id, {
      amount: str(fd, "amount"), paymentDate: str(fd, "paymentDate"), method: str(fd, "method") as PaymentMethod,
      reference: str(fd, "reference"), receivingAccount: str(fd, "receivingAccount"), notes: str(fd, "notes"),
    }, receipt);
    revalidatePath(`/invoices/${id}`);
    // The payment form asks whether to carry a remaining balance forward to a new invoice.
    if (str(fd, "createBalance") === "1") {
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (inv.status === "PARTIALLY_PAID") {
        const bal = await createBalanceInvoice(prisma, actor, id);
        revalidatePath(`/pos/${bal.poId}`);
        // Nothing is left to pay here, so the payment form disappears; confirm with a page banner instead.
        redirect(`/invoices/${id}?flash=${encodeURIComponent(`Payment recorded. Balance invoice ${bal.invoiceNumber} created for ${bal.total.toFixed(2)} ${bal.currency}`)}`);
      }
    }
    return "Payment recorded";
  });
}

/** Manual: carry the outstanding balance of a part-paid invoice forward to a new balance invoice. */
export async function createBalanceInvoiceAction(invoiceId: string, _: ActionState, __: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let newId = "";
  const res = await runAction(async () => { newId = (await createBalanceInvoice(prisma, actor, invoiceId)).id; });
  if (res?.ok) redirect(`/invoices/${newId}`);
  return res;
}

export async function reversePaymentAction(invoiceId: string, paymentId: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await reversePayment(prisma, actor, paymentId, str(fd, "reason"));
    revalidatePath(`/invoices/${invoiceId}`);
    return "Payment reversed";
  });
}

export async function sendEmailAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const log = await sendInvoiceEmail(prisma, actor, id, {
      to: parseAddresses(str(fd, "to")), cc: parseAddresses(str(fd, "cc")), bcc: parseAddresses(str(fd, "bcc")),
      subject: str(fd, "subject"), body: str(fd, "body"),
    });
    revalidatePath(`/invoices/${id}`);
    if (log.status === "FAILED") throw new RuleError(`Sending failed: ${log.error ?? "unknown error"}. The attempt was logged; you can retry.`);
    return log.transport === "dev-outbox"
      ? "Email written to the dev outbox (SMTP is not configured, so nothing was delivered)"
      : `Email sent to ${log.toAddresses.join(", ")}`;
  });
}

export async function updateDraftAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    let lines: { description: string; quantity: string; unitPrice: string }[] | undefined;
    const raw = str(fd, "lines");
    if (raw) { try { lines = JSON.parse(raw); } catch { throw new RuleError("Invalid line items"); } }
    await updateDraftInvoice(prisma, actor, id, {
      lines, discount: fd.has("discount") ? str(fd, "discount") : undefined, taxRate: str(fd, "taxRate") || undefined,
      invoiceDate: str(fd, "invoiceDate"), dueDate: str(fd, "dueDate"), notes: str(fd, "notes"), terms: str(fd, "terms"),
    });
    revalidatePath(`/invoices/${id}`);
    return "Draft saved";
  });
}

export async function finalizeAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  let number = "";
  const res = await runAction(async () => {
    const inv = await finalizeInvoice(prisma, actor, id, { invoiceDate: str(fd, "invoiceDate") || undefined, dueDate: str(fd, "dueDate") || undefined });
    number = inv.invoiceNumber ?? "";
  });
  if (res?.ok) redirect(`/invoices/${id}?flash=${encodeURIComponent(`Finalized as ${number}`)}`);
  return res;
}

export async function cancelAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  const res = await runAction(async () => { await cancelInvoice(prisma, actor, id, str(fd, "reason")); });
  if (res?.ok) redirect(`/invoices/${id}?flash=${encodeURIComponent("Invoice cancelled — its PO allocation has been released")}`);
  return res;
}

export async function reissueAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let newId = "";
  const res = await runAction(async () => { newId = (await cancelAndReissue(prisma, actor, id, str(fd, "reason"))).id; });
  if (res?.ok) redirect(`/invoices/${newId}`);
  return res;
}
