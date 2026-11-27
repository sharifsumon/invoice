import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { EmailStatus, InvoiceStatus, NotificationEvent } from "@/generated/prisma/enums";
import { notify } from "./notifications";
import { audit, inTx, type Actor, type Db } from "./common";
import { formatMoney } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";
import type { InvoiceSnapshot } from "./pdf";
import { servedInvoicePdf } from "./invoices";
import { loadFile, saveFile } from "./storage";
import { outstandingOf } from "./money";

export const DEFAULT_INVOICE_TEMPLATE = {
  subject: "Invoice {{invoice_number}} – {{company_name}}",
  body: [
    "Dear {{client_contact_name}},",
    "",
    "Please find attached invoice {{invoice_number}} for {{project_name}}.",
    "",
    "Invoice Number: {{invoice_number}}",
    "Invoice Date: {{invoice_date}}",
    "Due Date: {{due_date}}",
    "Invoice Amount: {{currency}} {{invoice_amount}}",
    "",
    "Please review the attached invoice and arrange payment by the due date. Should you have any questions, please feel free to contact us.",
    "",
    "Best regards,",
    "{{company_name}}",
  ].join("\n"),
};

export const MERGE_FIELDS = [
  "invoice_number", "company_name", "client_name", "client_contact_name", "project_name", "po_number",
  "invoice_date", "due_date", "currency", "invoice_amount", "balance_due",
] as const;

export function merge(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));
}

// ───────────── Transport ─────────────

export interface MailTransport {
  name: string;
  from: string;
  send(msg: { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; attachments: { filename: string; content: Buffer; contentType: string }[] }):
    Promise<{ messageId?: string; response?: string; raw?: Buffer }>;
}

/**
 * SMTP when SMTP_HOST is configured; otherwise a dev "outbox" that writes .eml files to storage/outbox
 * (nothing leaves the machine). Delivery status is the provider's acceptance — not a read receipt.
 */
export function defaultTransport(): MailTransport {
  const from = process.env.EMAIL_FROM || "invoices@localhost";
  if (process.env.SMTP_HOST) {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return {
      name: "smtp", from,
      async send(msg) { const info = await t.sendMail(msg); return { messageId: info.messageId, response: info.response }; },
    };
  }
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  return {
    name: "dev-outbox", from,
    async send(msg) {
      const info = await t.sendMail(msg);
      return { messageId: info.messageId, response: "Written to dev outbox (not delivered)", raw: info.message as Buffer };
    },
  };
}

// ───────────── Template ─────────────

export async function getInvoiceTemplate(db: Db) {
  return db.emailTemplate.upsert({ where: { key: "invoice" }, update: {}, create: { key: "invoice", ...DEFAULT_INVOICE_TEMPLATE } });
}

export const templateInput = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: z.string().trim().min(1, "Body is required").max(20000),
});

export async function updateInvoiceTemplate(db: Db, actor: Actor, raw: z.input<typeof templateInput>) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  const data = templateInput.parse(raw);
  return inTx(db, async (tx) => {
    const before = await tx.emailTemplate.upsert({ where: { key: "invoice" }, update: {}, create: { key: "invoice", ...DEFAULT_INVOICE_TEMPLATE } });
    const after = await tx.emailTemplate.update({ where: { key: "invoice" }, data });
    await audit(tx, actor, "settings.email_template.updated", "EmailTemplate", "invoice", { before, after });
    return after;
  });
}

// ───────────── Compose & send ─────────────

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
}

/** Pre-filled draft for the "Email invoice" form: recipients from the primary contact, merged template. */
export async function composeInvoiceEmail(db: Db, invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { client: { include: { contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } } },
  });
  if (!inv.snapshot || !inv.invoiceNumber) throw new RuleError("Only finalized invoices can be emailed");
  const s = inv.snapshot as unknown as InvoiceSnapshot;
  const primary = inv.client.contacts.find((c) => c.isPrimary && c.email) ?? inv.client.contacts.find((c) => c.email);
  const tpl = await getInvoiceTemplate(db);
  const values: Record<string, string> = {
    invoice_number: inv.invoiceNumber,
    company_name: s.company.displayName,
    client_name: s.client.legalName || s.client.name,
    client_contact_name: primary?.name ?? s.client.contactName ?? "Sir/Madam",
    project_name: s.project?.name ?? "",
    po_number: s.po?.poNumber ?? "",
    invoice_date: fmtDate(s.invoice.date),
    due_date: fmtDate(s.invoice.dueDate),
    currency: inv.currency,
    invoice_amount: formatMoney(inv.total, "").trim(),
    balance_due: formatMoney(outstandingOf(inv), "").trim(),
  };
  return {
    to: [primary?.email ?? inv.client.email].filter(Boolean) as string[],
    cc: [] as string[],
    bcc: [] as string[],
    subject: merge(tpl.subject, values),
    body: merge(tpl.body, values),
    contacts: inv.client.contacts.filter((c) => c.email).map((c) => ({ name: c.name, email: c.email! })),
  };
}

const emailList = (label: string) =>
  z.array(z.string().trim().toLowerCase().email(`Invalid ${label} address`)).max(20, `Too many ${label} recipients`);

export const sendInput = z.object({
  to: emailList("To").min(1, "Add at least one recipient"),
  cc: emailList("CC").default([]),
  bcc: emailList("BCC").default([]),
  subject: z.string().trim().min(1, "Subject is required").max(300).transform((s) => s.replace(/[\r\n]+/g, " ")),
  body: z.string().trim().min(1, "Message is required").max(20000),
});
export type SendInput = z.input<typeof sendInput>;

export function parseAddresses(v: string): string[] {
  return v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
}

/**
 * BRD §5.7.5: email the stored, finalized PDF. Every attempt (success or failure, including resends)
 * is logged. Sending never changes the invoice's financial status (BR-15).
 */
export async function sendInvoiceEmail(db: Db, actor: Actor, invoiceId: string, raw: SendInput, transport: MailTransport = defaultTransport()) {
  if (!can(actor, "invoices", "email")) throw new ForbiddenError("invoices", "email");
  const data = sendInput.parse(raw);
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { documents: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (inv.status === InvoiceStatus.DRAFT || !inv.documents[0]) throw new RuleError("Finalize the invoice before emailing it");
  if (inv.status === InvoiceStatus.CANCELLED) throw new RuleError("A cancelled invoice cannot be emailed");

  const doc = inv.documents[0];
  const stored = await loadFile(doc.filePath);
  if (createHash("sha256").update(stored).digest("hex") !== doc.sha256) {
    throw new RuleError("The stored invoice PDF failed its integrity check; it was not sent");
  }
  // Once paid or part-paid, send the version with the payment summary (balance due)
  const pdf = (await servedInvoicePdf(db, invoiceId)).pdf;
  const sha = createHash("sha256").update(pdf).digest("hex");
  const filename = `${inv.invoiceNumber}.pdf`.replace(/[^\w.-]/g, "_");

  let status: EmailStatus = EmailStatus.SENT;
  let messageId: string | null = null;
  let response: string | null = null;
  let error: string | null = null;
  try {
    const r = await transport.send({
      from: transport.from, to: data.to, cc: data.cc, bcc: data.bcc, subject: data.subject, text: data.body,
      attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
    });
    messageId = r.messageId ?? null;
    response = r.response?.slice(0, 1000) ?? null;
    if (r.raw) await saveFile(`outbox/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.eml`, r.raw);
  } catch (e) {
    status = EmailStatus.FAILED;
    error = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
  }

  const saved = await inTx(db, async (tx) => {
    const log = await tx.invoiceEmailLog.create({
      data: {
        invoiceId, senderId: actor.id, fromAddress: transport.from, toAddresses: data.to, ccAddresses: data.cc, bccAddresses: data.bcc,
        subject: data.subject, body: data.body, attachmentName: filename, attachmentSha256: sha, status,
        providerMessageId: messageId, providerResponse: response, error, transport: transport.name,
      },
    });
    await audit(tx, actor, status === EmailStatus.SENT ? "invoice.emailed" : "invoice.email_failed", "Invoice", invoiceId, {
      after: { logId: log.id, to: data.to, cc: data.cc, bcc: data.bcc, transport: transport.name, messageId, error },
    });
    return log;
  });
  if (saved.status === EmailStatus.FAILED) {
    await notify(db, NotificationEvent.EMAIL_FAILED, {
      title: `Email for ${inv.invoiceNumber} failed`, body: `To ${data.to.join(", ")}: ${error}`, link: `/invoices/${invoiceId}#email`, dedupeKey: saved.id,
    });
  }
  return saved;
}
