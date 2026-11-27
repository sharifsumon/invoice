import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { isOverdue } from "@/server/core/invoices";
import { dec, outstandingOf } from "@/server/core/money";
import { PO_TRANSITIONS, poBalance } from "@/server/core/pos";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { LineEditor } from "@/components/line-editor";
import { Money } from "@/components/money";
import { Badge, buttonClass, Card, DL, Flash, Field, fmtDate, Input, isoDate, isPoApproved, labelize, PageHeader, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { approvePendingInvoiceAction, cancelAction, createBalanceInvoiceAction, finalizeAction, reissueAction, updateDraftAction } from "../actions";
import { PrintButton } from "./print-button";
import { EmailCard, PaymentsCard } from "./payments-email";

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const { flash } = await searchParams;
  const user = await requirePermission("invoices");
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true, project: true, po: true, milestone: true,
      balanceOf: { select: { id: true, invoiceNumber: true } },
      balanceInvoices: { where: { status: { not: "CANCELLED" } }, select: { id: true, invoiceNumber: true, total: true } },
      lineItems: { orderBy: { sequence: "asc" } },
      documents: { orderBy: { version: "desc" } },
      createdBy: { select: { name: true } }, finalizedBy: { select: { name: true } }, cancelledBy: { select: { name: true } },
      payments: { orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], include: { recordedBy: { select: { name: true } }, reversedBy: { select: { name: true } } } },
      emailLogs: { orderBy: { createdAt: "desc" }, include: { sender: { select: { name: true } } } },
    },
  });
  if (!inv) notFound();
  const [{ template, company }, bal, history] = await Promise.all([
    getSettings(prisma),
    inv.poId ? poBalance(prisma, inv.poId) : null,
    prisma.auditLog.findMany({ where: { entityType: "Invoice", entityId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } }),
  ]);
  const isDraft = inv.status === "DRAFT";
  const isCancelled = inv.status === "CANCELLED";
  const canEdit = isDraft && can(user, "invoices", "edit");
  const po = inv.po; // null for an individual invoice
  const poApproved = !po || isPoApproved(po.status);
  const pendingApproval = isDraft && !poApproved;
  const canFinalize = isDraft && poApproved && can(user, "invoices", "approve");
  const canApprovePO = pendingApproval && !!po && PO_TRANSITIONS[po.status].includes("APPROVED") && can(user, "pos", "approve");
  const siblings = pendingApproval ? await prisma.invoice.count({ where: { poId: inv.poId, status: "DRAFT", kind: "MILESTONE" } }) : 0;
  const canCancel = !isCancelled && can(user, "invoices", "delete") && inv.amountPaid.eq(0);
  const outstanding = isCancelled ? dec(0) : outstandingOf(inv);
  const carriedTo = inv.balanceInvoices[0];
  const canBalance = can(user, "invoices", "create") && can(user, "invoices", "approve");
  const canCreateBalance = canBalance && inv.status === "PARTIALLY_PAID" && outstanding.gt(0) && !carriedTo;
  const pdfUrl = `/api/invoices/${inv.id}/pdf`;
  const ownAllocation = isCancelled ? 0 : inv.subtotal.minus(inv.discount);
  const remainingForDraft = bal ? bal.remaining.plus(ownAllocation) : null;

  return (
    <>
      <Flash message={flash} />
      <PageHeader
        back={{ href: "/invoices", label: "Invoices" }}
        title={<span className="flex flex-wrap items-center gap-3">{inv.invoiceNumber ?? "Draft invoice"}
          <StatusBadge status={inv.status} pending={pendingApproval} />{isOverdue(inv) && <StatusBadge status="OVERDUE" />}
          {inv.version > 1 && <Badge tone="purple">Revised v{inv.version}</Badge>}</span>}
        subtitle={<>
          <Link href={`/clients/${inv.clientId}`} className="hover:underline">{inv.client.name}</Link> ·{" "}
          {inv.project && <><Link href={`/projects/${inv.projectId}`} className="hover:underline">{inv.project.code}</Link> ·{" "}</>}
          {po ? <Link href={`/pos/${inv.poId}`} className="hover:underline">PO {po.poNumber}</Link> : <span>Individual invoice</span>}
          {inv.milestone && <> · Milestone #{inv.milestone.sequence} {inv.milestone.name}</>}
        </>}
        actions={<>
          <a href={pdfUrl} target="_blank" className={buttonClass("secondary")}>{isDraft ? "Preview PDF" : "Open PDF"}</a>
          {!isDraft && <a href={`${pdfUrl}?download=1`} className={buttonClass("secondary")}>Download</a>}
          {!isDraft && <PrintButton url={pdfUrl} />}
          {!isDraft && !isCancelled && can(user, "invoices", "email") && <a href="#email" className={buttonClass("primary")}>Email invoice</a>}
        </>}
      />

      {inv.kind === "BALANCE" && inv.balanceOf && (
        <div className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          Balance invoice: carries forward the unpaid balance of{" "}
          <Link href={`/invoices/${inv.balanceOf.id}`} className="font-semibold underline underline-offset-2">{inv.balanceOf.invoiceNumber}</Link>.
          {po ? "It is not new billing against the PO." : "It is not new billing."}
        </div>
      )}
      {carriedTo && (
        <div className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          The outstanding balance ({inv.currency} {inv.balanceMoved.toFixed(2)}) was moved to{" "}
          <Link href={`/invoices/${carriedTo.id}`} className="font-semibold underline underline-offset-2">{carriedTo.invoiceNumber}</Link>. Nothing more is due on this invoice.
        </div>
      )}
      {canCreateBalance && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-lime-soft px-4 py-3 text-sm text-lime-ink">
          <p className="min-w-0 flex-1"><b>Partially paid.</b> {inv.currency} {outstanding.toFixed(2)} is still outstanding. You can keep collecting it here, or move it to a new invoice.</p>
          <ActionButton action={createBalanceInvoiceAction.bind(null, inv.id)} label="Create balance invoice" variant="primary" size="md"
            confirm={`Create a new invoice for the outstanding ${inv.currency} ${outstanding.toFixed(2)}? This invoice will then show nothing more due.`} />
        </div>
      )}
      {pendingApproval && po && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-lime-soft px-4 py-3 text-sm text-lime-ink">
          <p className="min-w-0 flex-1">
            <b>Pending approval.</b> This milestone invoice was drafted when <Link href={`/pos/${inv.poId}`} className="font-semibold underline underline-offset-2">PO {po.poNumber}</Link> was
            submitted. It can be finalized once the PO is approved, and is cancelled automatically if the PO is rejected.
          </p>
          {canApprovePO && (
            <ActionButton action={approvePendingInvoiceAction.bind(null, inv.id)} label="Approve" variant="primary" size="md"
              confirm={`Approve PO ${po.poNumber}? This approves ${siblings > 1 ? `all ${siblings} of its milestone invoices` : "this invoice"} and makes ${siblings > 1 ? "them" : "it"} ready to finalize.`} />
          )}
        </div>
      )}

      {isCancelled && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Cancelled {fmtDate(inv.cancelledAt)} by {inv.cancelledBy?.name ?? "—"}: {inv.cancelReason}. {po ? "This invoice no longer counts against the PO and is kept for audit." : "It is kept for audit."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canFinalize && (
            <Card title="Finalize">
              <p className="mb-3 text-sm text-slate-500">
                Finalizing assigns the next invoice number, freezes the invoice content and stores the PDF. After that it cannot be edited — only cancelled or reissued.
              </p>
              <ActionForm action={finalizeAction.bind(null, inv.id)}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Invoice date"><Input type="date" name="invoiceDate" defaultValue={isoDate(inv.invoiceDate) || new Date().toISOString().slice(0, 10)} /></Field>
                  <Field label="Due date" hint={`Blank = invoice date + ${company.paymentTermsDays} days`}><Input type="date" name="dueDate" defaultValue={isoDate(inv.dueDate)} /></Field>
                </div>
                <SubmitButton pendingText="Finalizing…">Finalize invoice</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {canEdit ? (
            <Card title="Edit draft">
              <ActionForm action={updateDraftAction.bind(null, inv.id)}>
                {inv.kind === "MILESTONE" && <p className="text-xs text-slate-500">Milestone invoice amounts are fixed to the PO milestone. You can change the description, tax, dates, notes and terms.</p>}
                <LineEditor
                  locked={inv.kind === "MILESTONE"}
                  initial={inv.lineItems.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toFixed(2) }))}
                  remaining={inv.kind === "MANUAL" && remainingForDraft ? remainingForDraft.toFixed(2) : undefined}
                  currency={inv.currency} discount={inv.discount.gt(0) ? inv.discount.toFixed(2) : ""}
                  taxRate={inv.taxRate.toString()} showTax={template.showTax} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Invoice date"><Input type="date" name="invoiceDate" defaultValue={isoDate(inv.invoiceDate)} /></Field>
                  <Field label="Due date"><Input type="date" name="dueDate" defaultValue={isoDate(inv.dueDate)} /></Field>
                  <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={inv.notes ?? ""} /></Field>
                  <Field label="Terms" className="sm:col-span-2"><Textarea name="terms" defaultValue={inv.terms ?? ""} /></Field>
                </div>
                <SubmitButton variant="secondary">Save draft</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card title="Lines">
              <Table head={["Description", "Qty", "Rate", "Amount"]}>
                {inv.lineItems.map((l) => (
                  <tr key={l.id}>
                    <Td className="min-w-[260px] whitespace-normal">{l.description}</Td>
                    <Td className="tabular">{l.quantity.toDecimalPlaces(4).toString()}</Td>
                    <Td><Money v={l.unitPrice} cur={inv.currency} /></Td>
                    <Td><Money v={l.amount} cur={inv.currency} /></Td>
                  </tr>
                ))}
              </Table>
              <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
                <Row k="Subtotal" v={<Money v={inv.subtotal} cur={inv.currency} />} />
                {inv.discount.gt(0) && <Row k="Discount" v={<Money v={inv.discount.negated()} cur={inv.currency} />} />}
                {inv.taxAmount.gt(0) && <Row k={`${template.taxLabel} ${inv.taxRate.toDecimalPlaces(2).toString()}%`} v={<Money v={inv.taxAmount} cur={inv.currency} />} />}
                <Row k="Total" v={<Money v={inv.total} cur={inv.currency} className="font-semibold" />} />
                <Row k="Paid" v={<Money v={inv.amountPaid} cur={inv.currency} />} />
                {inv.balanceMoved.gt(0) && <Row k={`Moved to ${carriedTo?.invoiceNumber ?? "balance invoice"}`} v={<Money v={inv.balanceMoved.negated()} cur={inv.currency} />} />}
                <Row k="Balance due" v={<Money v={outstanding} cur={inv.currency} className="font-semibold" />} />
              </div>
            </Card>
          )}

          {!isDraft && !isCancelled && (
            <PaymentsCard inv={inv} payments={inv.payments} canRecord={can(user, "invoices", "payments")} canReverse={can(user, "invoices", "payments")}
              canBalance={canBalance && !carriedTo} />
          )}
          {isCancelled && inv.payments.length > 0 && (
            <PaymentsCard inv={inv} payments={inv.payments} canRecord={false} canReverse={false} />
          )}

          {!isDraft && (
            <EmailCard inv={inv} logs={inv.emailLogs} canSend={can(user, "invoices", "email")} />
          )}

          {!isDraft && (
            <Card title="Document">
              <iframe src={pdfUrl} title="Invoice PDF" className="h-[720px] w-full rounded-lg border border-slate-200" />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <DL items={[
              ["Type", labelize(inv.kind)], ["Currency", inv.currency],
              ["Invoice date", fmtDate(inv.invoiceDate)], ["Due date", fmtDate(inv.dueDate)],
              ["Total", <Money key="t" v={inv.total} cur={inv.currency} />],
              ["PO remaining", bal ? <Money key="r" v={bal.remaining} cur={bal.currency} /> : null],
              ["Created", `${fmtDate(inv.createdAt)} by ${inv.createdBy?.name ?? "system"}`],
              ["Finalized", inv.finalizedAt ? `${fmtDate(inv.finalizedAt)} by ${inv.finalizedBy?.name ?? "—"}` : null],
            ]} />
            {inv.documents.length > 0 && (
              <div className="mt-4 text-xs text-slate-500">
                Stored PDF v{inv.documents[0].version} · SHA-256 <span className="font-mono">{inv.documents[0].sha256.slice(0, 16)}…</span>
              </div>
            )}
          </Card>

          {canCancel && (
            <Card title="Corrections">
              <div className="space-y-3">
                {!isDraft && can(user, "invoices", "create") && (
                  <ActionButton action={reissueAction.bind(null, inv.id)} label="Cancel & reissue" reasonPrompt="What needs correcting?" />
                )}
                <ActionButton action={cancelAction.bind(null, inv.id)} label={isDraft ? "Cancel draft" : "Cancel invoice"} variant="danger"
                  reasonPrompt="Reason for cancellation (kept in the audit trail)" />
                {po && <p className="text-xs text-slate-400">Cancelling releases this invoice&apos;s amount back to the PO balance.</p>}
              </div>
            </Card>
          )}

          <Card title="History">
            <ol className="space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <div className="font-medium text-slate-700">{labelize(h.action.split(".").slice(1).join("_"))}</div>
                  <div className="text-xs text-slate-400">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {h.actor?.name ?? "system"}</div>
                  {h.reason && <div className="text-xs text-slate-600">{h.reason}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500">{k}</span>{v}</div>;
}
