import { createHash } from "node:crypto";
import { z } from "zod";
import { InvoiceStatus, PaymentMethod, PaymentState } from "@/generated/prisma/enums";
import { audit, inTx, parseDate, today, type Actor, type Db } from "./common";
import { dec, money } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";
import { saveFile } from "./storage";

export const paymentInput = z.object({
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.string().min(1, "Payment date is required"),
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().trim().max(200).optional(),
  receivingAccount: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type PaymentInput = z.input<typeof paymentInput>;

export interface ReceiptFile { name: string; data: Buffer }

const RECEIPT_MAX = 5 * 1024 * 1024;

/** Receipts: PDF, PNG or JPEG, validated by magic bytes. */
function sniffReceipt(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

/**
 * BRD §5.6: record a full or partial payment. Under a row lock on the invoice; the DB trigger
 * independently rejects overpayment and derives amountPaid + status (BR-11).
 */
export async function recordPayment(db: Db, actor: Actor, invoiceId: string, raw: PaymentInput, receipt?: ReceiptFile | null) {
  if (!can(actor.role, "invoices", "edit")) throw new ForbiddenError("invoices", "edit");
  const data = paymentInput.parse(raw);
  let amount;
  try { amount = money(dec(data.amount)); } catch { throw new RuleError("Amount must be a number"); }
  if (amount.lte(0)) throw new RuleError("Payment amount must be greater than zero");
  const paymentDate = parseDate(data.paymentDate)!;
  if (paymentDate > today()) throw new RuleError("Payment date cannot be in the future");

  let stored: { path: string; mime: string; name: string } | null = null;
  if (receipt && receipt.data.length) {
    if (receipt.data.length > RECEIPT_MAX) throw new RuleError("Receipt must be 5 MB or smaller");
    const kind = sniffReceipt(receipt.data);
    if (!kind) throw new RuleError("Receipt must be a PDF, PNG or JPEG file");
    const sha = createHash("sha256").update(receipt.data).digest("hex");
    const f = await saveFile(`receipts/${invoiceId}/${sha}.${kind.ext}`, receipt.data);
    stored = { path: f.path, mime: kind.mime, name: receipt.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || `receipt.${kind.ext}` };
  }

  return inTx(db, async (tx) => {
    const [inv] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (!inv) throw new RuleError("Invoice not found");
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (invoice.status !== InvoiceStatus.UNPAID && invoice.status !== InvoiceStatus.PARTIALLY_PAID) {
      throw new RuleError(invoice.status === InvoiceStatus.PAID ? "This invoice is already fully paid" : "Payments can only be recorded on finalized, unpaid invoices");
    }
    const outstanding = invoice.total.minus(invoice.amountPaid);
    if (amount.gt(outstanding)) {
      throw new RuleError(`Payment of ${amount.toFixed(2)} exceeds the outstanding balance of ${outstanding.toFixed(2)} ${invoice.currency}`);
    }
    const p = await tx.payment.create({
      data: {
        invoiceId, amount, currency: invoice.currency, paymentDate, method: data.method,
        reference: data.reference || null, receivingAccount: data.receivingAccount || null, notes: data.notes || null,
        receiptPath: stored?.path ?? null, receiptMime: stored?.mime ?? null, receiptName: stored?.name ?? null,
        recordedById: actor.id,
      },
    });
    const after = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, amountPaid: true } });
    await audit(tx, actor, "payment.recorded", "Invoice", invoiceId, {
      before: { status: invoice.status, amountPaid: invoice.amountPaid },
      after: { paymentId: p.id, amount, paymentDate, method: p.method, reference: p.reference, status: after.status, amountPaid: after.amountPaid },
    });
    return p;
  });
}

/** Correction: reverse (never delete) a payment, with a reason. Status is re-derived by the DB trigger. */
export async function reversePayment(db: Db, actor: Actor, paymentId: string, reason: string) {
  if (!can(actor.role, "invoices", "cancel")) throw new ForbiddenError("invoices", "cancel");
  if (!reason?.trim()) throw new RuleError("A reason is required to reverse a payment");
  return inTx(db, async (tx) => {
    const pre = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${pre.invoiceId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.state === PaymentState.REVERSED) throw new RuleError("Payment is already reversed");
    const before = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId }, select: { status: true, amountPaid: true } });
    await tx.payment.update({
      where: { id: paymentId },
      data: { state: PaymentState.REVERSED, reversedAt: new Date(), reversedById: actor.id, reversalReason: reason.trim() },
    });
    const after = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId }, select: { status: true, amountPaid: true } });
    await audit(tx, actor, "payment.reversed", "Invoice", p.invoiceId, {
      before: { paymentId, amount: p.amount, ...before }, after, reason: reason.trim(),
    });
  });
}

/** Actual collections by payment date, per currency (BR-13). */
export async function collectionsByMonth(db: Db, year: number) {
  return db.$queryRaw<{ month: number; currency: string; value: string }[]>`
    SELECT EXTRACT(MONTH FROM "paymentDate")::int AS month, "currency", SUM("amount")::text AS value
      FROM "Payment" WHERE "state" = 'VALID' AND EXTRACT(YEAR FROM "paymentDate") = ${year}
     GROUP BY 1, 2 ORDER BY 1, 2`;
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", CASH: "Cash", CARD: "Card", ONLINE: "Online", OTHER: "Other",
};
