import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailStatus, InvoiceKind, InvoiceStatus, PaymentMethod, ProjectStatus } from "@/generated/prisma/enums";
import { createClient } from "@/server/core/clients";
import { createProject, transitionProject } from "@/server/core/projects";
import { approvePO, createPO, poBalance } from "@/server/core/pos";
import { cancelInvoice, createBalanceInvoice, createManualInvoice, finalizeInvoice, isOverdue } from "@/server/core/invoices";
import { recordPayment, reversePayment } from "@/server/core/payments";
import { composeInvoiceEmail, merge, sendInvoiceEmail, type MailTransport } from "@/server/core/email";
import { dec, outstandingOf } from "@/server/core/money";
import type { Actor } from "@/server/core/common";
import { baseSettings, cl, ct, makeActor, Role, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let viewer: Actor;

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  viewer = await makeActor(db, Role.VIEWER);
});
afterAll(async () => db.$disconnect());

/** An issued (finalized) invoice for `amount`, due on `dueDate`. */
async function issuedInvoice(amount = "1000", dueDate = "2026-01-31") {
  const c = await createClient(db, admin, cl(uid("Client")), [ct("Dana", "Primary", { email: "dana@client.example", isPrimary: true })]);
  const p = await createProject(db, admin, { code: uid("P"), name: "Proj X", clientId: c.id, value: amount, currency: "USD" });
  await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS);
  const o = await createPO(db, finance, { poNumber: uid("PO"), projectId: p.id, poDate: "2026-01-01", value: amount });
  await approvePO(db, finance, o.id);
  const inv = await createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "Work", unitPrice: amount }] });
  return finalizeInvoice(db, finance, inv.id, { invoiceDate: "2026-01-01", dueDate });
}

const pay = (amount: string, extra: Partial<{ paymentDate: string; reference: string }> = {}) => ({
  amount, paymentDate: extra.paymentDate ?? "2026-02-01", method: PaymentMethod.BANK_TRANSFER, reference: extra.reference,
});

describe("Balance invoices (carry the unpaid part forward)", () => {
  it("part payment → balance invoice for the rest; nothing is outstanding or billed twice", async () => {
    const inv = await issuedInvoice("3000"); // PO value 3000, fully invoiced
    await recordPayment(db, finance, inv.id, pay("1000"));
    const bal = await createBalanceInvoice(db, finance, inv.id);
    expect(bal.kind).toBe(InvoiceKind.BALANCE);
    expect(bal.status).toBe(InvoiceStatus.UNPAID);
    expect(bal.invoiceNumber).toMatch(/^INV-/);
    expect(bal.total.toString()).toBe("2000");
    expect(bal.balanceOfId).toBe(inv.id);

    const orig = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(orig.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(outstandingOf(orig).toString()).toBe("0");
    const b = await poBalance(db, inv.poId);
    expect(b.invoiced.toString()).toBe("3000");      // not new billing (PO cap untouched)
    expect(b.outstanding.toString()).toBe("2000");   // counted once, on the balance invoice
    expect(b.paid.toString()).toBe("1000");

    // The original takes no more payments; its payments cannot be reversed while the balance invoice is live
    await expect(recordPayment(db, finance, inv.id, pay("1"))).rejects.toThrow(/exceeds the outstanding balance of 0.00/);
    const p1 = await db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await expect(reversePayment(db, admin, p1.id, "test")).rejects.toThrow(/moved to/);
    await expect(createBalanceInvoice(db, finance, inv.id)).rejects.toThrow(/no outstanding balance|already exists/);

    // Paying the balance invoice in full
    await recordPayment(db, finance, bal.id, pay("2000"));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: bal.id } })).status).toBe(InvoiceStatus.PAID);
    expect((await poBalance(db, inv.poId)).outstanding.toString()).toBe("0");
  });

  it("cancelling the balance invoice puts the balance back on the original", async () => {
    const inv = await issuedInvoice("900");
    await recordPayment(db, finance, inv.id, pay("300"));
    const bal = await createBalanceInvoice(db, finance, inv.id);
    await cancelInvoice(db, finance, bal.id, "client will pay the original");
    const orig = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(orig.balanceMoved.toString()).toBe("0");
    expect(outstandingOf(orig).toString()).toBe("600");
    await recordPayment(db, finance, inv.id, pay("600"));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe(InvoiceStatus.PAID);
  });

  it("only part-paid invoices can be carried forward", async () => {
    const inv = await issuedInvoice("100");
    await expect(createBalanceInvoice(db, finance, inv.id)).rejects.toThrow(/partially paid/);
    await expect(createBalanceInvoice(db, viewer, inv.id)).rejects.toThrow(/permission/);
  });
});

describe("Payments (BRD §5.6, BR-11)", () => {
  it("partial then full payments update balance and status", async () => {
    const inv = await issuedInvoice("1000");
    await recordPayment(db, finance, inv.id, pay("400"));
    let cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(cur.amountPaid.toString()).toBe("400");

    await recordPayment(db, finance, inv.id, pay("600"));
    cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe(InvoiceStatus.PAID);
    expect(cur.amountPaid.toString()).toBe("1000");
    await expect(recordPayment(db, finance, inv.id, pay("0.01"))).rejects.toThrow(/already fully paid/);
  });

  it("rejects overpayment, zero, future dates and drafts", async () => {
    const inv = await issuedInvoice("500");
    await expect(recordPayment(db, finance, inv.id, pay("500.01"))).rejects.toThrow(/exceeds the outstanding balance of 500.00/);
    await expect(recordPayment(db, finance, inv.id, pay("0"))).rejects.toThrow(/greater than zero/);
    await expect(recordPayment(db, finance, inv.id, pay("10", { paymentDate: "2999-01-01" }))).rejects.toThrow(/future/);
  });

  it("rejects payments on draft invoices", async () => {
    const issued = await issuedInvoice("500");
    const po = await createPO(db, finance, { poNumber: uid("PO"), projectId: issued.projectId, poDate: "2026-01-01", value: "300" });
    await approvePO(db, finance, po.id);
    const draft = await createManualInvoice(db, finance, { poId: po.id, lines: [{ description: "Draft work", unitPrice: "300" }] });
    await expect(recordPayment(db, finance, draft.id, pay("10"))).rejects.toThrow(/finalized/);
  });

  it("the database blocks overpayment even if the service is bypassed", async () => {
    const inv = await issuedInvoice("100");
    await expect(db.payment.create({
      data: { invoiceId: inv.id, amount: dec("100.01"), currency: "USD", paymentDate: new Date("2026-02-01"), method: "CASH" },
    })).rejects.toThrow(/OVERPAYMENT/);
  });

  it("concurrent payments can never exceed the invoice total", async () => {
    const inv = await issuedInvoice("1000");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => recordPayment(db, finance, inv.id, pay("300", { reference: `T${i}` }))),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    const cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.amountPaid.toString()).toBe("900");
    expect(cur.status).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  it("reversal (never deletion) restores the balance and status, with audit", async () => {
    const inv = await issuedInvoice("1000");
    const p = await recordPayment(db, finance, inv.id, pay("1000"));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe(InvoiceStatus.PAID);
    await expect(reversePayment(db, finance, p.id, "")).rejects.toThrow(/reason/);
    await reversePayment(db, finance, p.id, "Bounced transfer");
    const cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe(InvoiceStatus.UNPAID);
    expect(cur.amountPaid.toString()).toBe("0");
    expect(await db.payment.findUnique({ where: { id: p.id } })).toMatchObject({ state: "REVERSED", reversalReason: "Bounced transfer" });
    await expect(reversePayment(db, finance, p.id, "again")).rejects.toThrow(/already reversed/);
    await expect(db.payment.delete({ where: { id: p.id } })).rejects.toThrow(/PAYMENT_IMMUTABLE/);
    expect(await db.auditLog.count({ where: { entityId: inv.id, action: { in: ["payment.recorded", "payment.reversed"] } } })).toBe(2);
  });

  it("a partially paid invoice past due stays Partially Paid and is flagged overdue", async () => {
    const inv = await issuedInvoice("1000", "2026-01-15");
    await recordPayment(db, finance, inv.id, pay("250"));
    const cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(isOverdue(cur, new Date("2026-03-01"))).toBe(true);
  });

  it("invoices with payments cannot be cancelled", async () => {
    const inv = await issuedInvoice("1000");
    await recordPayment(db, finance, inv.id, pay("1"));
    await expect(cancelInvoice(db, finance, inv.id, "oops")).rejects.toThrow(/recorded payments/);
  });

  it("viewers cannot record payments", async () => {
    const inv = await issuedInvoice("10");
    await expect(recordPayment(db, viewer, inv.id, pay("1"))).rejects.toThrow(/permission/);
  });
});

describe("Invoice email (BRD §5.7.5, BR-15)", () => {
  const sent: Parameters<MailTransport["send"]>[0][] = [];
  const okTransport: MailTransport = {
    name: "test", from: "billing@test.local",
    async send(msg) { sent.push(msg); return { messageId: `<${sent.length}@test>`, response: "250 OK" }; },
  };
  const failTransport: MailTransport = {
    name: "test", from: "billing@test.local",
    async send() { throw new Error("SMTP 550 mailbox unavailable"); },
  };

  it("merges the template and pre-fills the primary contact", async () => {
    const inv = await issuedInvoice("1234.5");
    const draft = await composeInvoiceEmail(db, inv.id);
    expect(draft.to).toEqual(["dana@client.example"]);
    const company = (inv.snapshot as { company: { displayName: string } }).company.displayName;
    expect(draft.subject).toBe(`Invoice ${inv.invoiceNumber} – ${company}`);
    expect(draft.body).toContain("Dear Dana Primary,");
    expect(draft.body).toContain("Invoice Amount: USD 1,234.50");
    expect(merge("{{a}} {{unknown}}", { a: "x" })).toBe("x {{unknown}}");
  });

  it("sends the stored PDF, logs the attempt, and does not change payment status", async () => {
    const inv = await issuedInvoice("800");
    const before = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const doc = await db.invoiceDocument.findFirstOrThrow({ where: { invoiceId: inv.id } });
    const log = await sendInvoiceEmail(db, finance, inv.id, {
      to: ["ap@client.example"], cc: ["pm@client.example"], bcc: ["archive@us.example"], subject: "Hi\r\nBcc: evil@x.com", body: "See attached",
    }, okTransport);
    expect(log.status).toBe(EmailStatus.SENT);
    expect(log.providerMessageId).toBeTruthy();
    expect(log.attachmentSha256).toBe(doc.sha256);
    const msg = sent.at(-1)!;
    expect(msg.subject).toBe("Hi Bcc: evil@x.com"); // header injection neutralized
    expect(msg.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(msg.cc).toEqual(["pm@client.example"]);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe(before.status);
    expect(after.amountPaid.eq(before.amountPaid)).toBe(true);
  });

  it("logs failures and keeps every resend attempt", async () => {
    const inv = await issuedInvoice("50");
    const msg = { to: ["a@client.example"], subject: "Invoice", body: "Body" };
    const f = await sendInvoiceEmail(db, finance, inv.id, msg, failTransport);
    expect(f.status).toBe(EmailStatus.FAILED);
    expect(f.error).toMatch(/550/);
    await sendInvoiceEmail(db, finance, inv.id, msg, okTransport);
    await sendInvoiceEmail(db, finance, inv.id, msg, okTransport);
    const logs = await db.invoiceEmailLog.findMany({ where: { invoiceId: inv.id } });
    expect(logs.map((l) => l.status).sort()).toEqual(["FAILED", "SENT", "SENT"]);
    await expect(db.invoiceEmailLog.delete({ where: { id: f.id } })).rejects.toThrow();
  });

  it("refuses drafts, cancelled invoices, bad addresses and unauthorized users", async () => {
    const inv = await issuedInvoice("60");
    await expect(sendInvoiceEmail(db, finance, inv.id, { to: ["not-an-email"], subject: "s", body: "b" }, okTransport)).rejects.toThrow(/Invalid To/);
    await expect(sendInvoiceEmail(db, viewer, inv.id, { to: ["a@b.co"], subject: "s", body: "b" }, okTransport)).rejects.toThrow(/permission/);
    await cancelInvoice(db, finance, inv.id, "test");
    await expect(sendInvoiceEmail(db, finance, inv.id, { to: ["a@b.co"], subject: "s", body: "b" }, okTransport)).rejects.toThrow(/cancelled/);
  });
});
