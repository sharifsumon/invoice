import { PaymentMethod } from "@/generated/prisma/enums";
import type { Invoice, InvoiceEmailLog, Payment } from "@/generated/prisma/client";
import { composeInvoiceEmail, MERGE_FIELDS } from "@/server/core/email";
import { METHOD_LABELS } from "@/server/core/payments";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Money } from "@/components/money";
import { Badge, Card, Field, fmtDate, Input, Select, Table, Td, Textarea } from "@/components/ui";
import { recordPaymentAction, reversePaymentAction, sendEmailAction } from "../actions";

type P = Payment & { recordedBy: { name: string } | null; reversedBy: { name: string } | null };

export function PaymentsCard({ inv, payments, canRecord, canReverse }: { inv: Invoice; payments: P[]; canRecord: boolean; canReverse: boolean }) {
  const outstanding = inv.total.minus(inv.amountPaid);
  const open = inv.status === "UNPAID" || inv.status === "PARTIALLY_PAID";
  return (
    <Card title="Payments" actions={<span className="text-xs text-slate-500">Paid <Money v={inv.amountPaid} cur={inv.currency} /> · Due <Money v={outstanding} cur={inv.currency} /></span>}>
      <Table head={["Date", "Method", "Reference", "Amount", "Receipt", "Status", ""]} empty="No payments recorded yet.">
        {payments.map((p) => (
          <tr key={p.id} className={p.state === "REVERSED" ? "opacity-60" : ""}>
            <Td>{fmtDate(p.paymentDate)}</Td>
            <Td className="whitespace-normal">{METHOD_LABELS[p.method]}{p.receivingAccount && <div className="text-xs text-slate-400">to {p.receivingAccount}</div>}</Td>
            <Td className="whitespace-normal">{p.reference ?? "—"}{p.notes && <div className="text-xs text-slate-400">{p.notes}</div>}</Td>
            <Td><Money v={p.amount} cur={p.currency} className={p.state === "REVERSED" ? "line-through" : ""} /></Td>
            <Td className="max-w-[140px] truncate">{p.receiptPath ? <a href={`/api/payments/${p.id}/receipt`} target="_blank" className="text-brand-700 hover:underline">{p.receiptName ?? "View"}</a> : "—"}</Td>
            <Td className="whitespace-normal">
              {p.state === "VALID" ? <Badge tone="green">Valid</Badge> : <Badge tone="red">Reversed</Badge>}
              <div className="text-xs text-slate-400">by {p.recordedBy?.name ?? "—"}</div>
              {p.state === "REVERSED" && <div className="text-xs text-slate-500">{fmtDate(p.reversedAt)} by {p.reversedBy?.name}: {p.reversalReason}</div>}
            </Td>
            <Td>{p.state === "VALID" && canReverse &&
              <ActionButton action={reversePaymentAction.bind(null, inv.id, p.id)} label="Reverse" variant="ghost" reasonPrompt="Why is this payment being reversed?" />}</Td>
          </tr>
        ))}
      </Table>

      {canRecord && open && (
        <details className="mt-5" open>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">+ Record payment</summary>
          <ActionForm action={recordPaymentAction.bind(null, inv.id)} resetOnSuccess className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Amount (${inv.currency}) *`} hint={`Outstanding: ${outstanding.toFixed(2)}`}>
                <Input name="amount" required inputMode="decimal" defaultValue={outstanding.toFixed(2)} />
              </Field>
              <Field label="Payment date *"><Input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} max={new Date().toISOString().slice(0, 10)} /></Field>
              <Field label="Method *">
                <Select name="method" defaultValue={PaymentMethod.BANK_TRANSFER}>
                  {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </Select>
              </Field>
              <Field label="Transaction / reference no."><Input name="reference" /></Field>
              <Field label="Receiving account"><Input name="receivingAccount" /></Field>
              <Field label="Receipt (PDF, PNG, JPEG ≤ 5 MB)"><input type="file" name="receipt" accept="application/pdf,image/png,image/jpeg" className="block w-full pt-2 text-sm" /></Field>
              <Field label="Notes" className="sm:col-span-3"><Textarea name="notes" rows={2} /></Field>
            </div>
            <SubmitButton>Record payment</SubmitButton>
          </ActionForm>
        </details>
      )}
      {inv.status === "PAID" && <p className="mt-4 text-sm text-emerald-700">This invoice is fully paid.</p>}
    </Card>
  );
}

type L = InvoiceEmailLog & { sender: { name: string } | null };

export async function EmailCard({ inv, logs, canSend }: { inv: Invoice; logs: L[]; canSend: boolean }) {
  const sendable = canSend && inv.status !== "DRAFT" && inv.status !== "CANCELLED";
  const draft = sendable ? await composeInvoiceEmail(prisma, inv.id) : null;
  const smtp = !!process.env.SMTP_HOST;
  return (
    <Card title="Email to client" actions={<span id="email" className="text-xs text-slate-500">{logs.length} attempt{logs.length === 1 ? "" : "s"}</span>}>
      {draft && (
        <details open>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">{logs.length ? "Resend invoice" : "Compose email"}</summary>
          {!smtp && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              SMTP is not configured, so messages are written to the server&apos;s dev outbox (<code>storage/outbox</code>) and not delivered. Set SMTP_HOST in .env to send for real.
            </p>
          )}
          <ActionForm action={sendEmailAction.bind(null, inv.id)} className="mt-3 space-y-3">
            <Field label="To *" hint={draft.contacts.length ? `Client contacts: ${draft.contacts.map((c) => `${c.name} <${c.email}>`).join(", ")}` : "No client contacts have an email address."}>
              <Input name="to" required defaultValue={draft.to.join(", ")} placeholder="name@client.com, …" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="CC"><Input name="cc" placeholder="Comma-separated" /></Field>
              <Field label="BCC"><Input name="bcc" placeholder="Comma-separated" /></Field>
            </div>
            <Field label="Subject *"><Input name="subject" required defaultValue={draft.subject} /></Field>
            <Field label="Message *" hint="Review and edit before sending. The finalized PDF is attached automatically.">
              <Textarea name="body" required rows={12} defaultValue={draft.body} className="font-mono text-xs" />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">📎 {inv.invoiceNumber}.pdf (stored version)</span>
              <SubmitButton pendingText="Sending…">Send email</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
      {!draft && inv.status === "DRAFT" && <p className="text-sm text-slate-500">Finalize the invoice to email it.</p>}

      {logs.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Send history</div>
          <ol className="space-y-3 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {l.status === "SENT" ? <Badge tone="green">{l.transport === "dev-outbox" ? "Outbox (dev)" : "Sent"}</Badge> : <Badge tone="red">Failed</Badge>}
                  <span className="text-xs text-slate-400">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {l.sender?.name ?? "—"}</span>
                </div>
                <div className="mt-1 text-slate-700">{l.subject}</div>
                <div className="text-xs text-slate-500">
                  To {l.toAddresses.join(", ")}{l.ccAddresses.length > 0 && ` · CC ${l.ccAddresses.join(", ")}`}{l.bccAddresses.length > 0 && ` · BCC ${l.bccAddresses.join(", ")}`}
                </div>
                {l.providerMessageId && <div className="font-mono text-[11px] text-slate-400">id {l.providerMessageId}</div>}
                {l.error && <div className="text-xs text-rose-600">{l.error}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-4 text-xs text-slate-400">Emailing never changes the invoice&apos;s payment status. Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(" ")}</p>
    </Card>
  );
}
