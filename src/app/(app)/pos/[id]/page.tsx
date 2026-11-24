import Link from "next/link";
import { notFound } from "next/navigation";
import { POStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { isMilestonePlanComplete, PO_TRANSITIONS, poBalance } from "@/server/core/pos";
import { isOverdue } from "@/server/core/invoices";
import { getSettings } from "@/server/core/settings";
import { sum } from "@/server/core/money";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { LineEditor } from "@/components/line-editor";
import { Money } from "@/components/money";
import { Badge, buttonClass, Card, DL, Flash, Field, fmtDate, Input, isPoApproved, labelize, PageHeader, Select, Stat, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import {
  createManualInvoiceAction, removeAttachmentAction, retryGenerationAction, transitionPOAction, updatePOAction, uploadAttachmentAction,
} from "../actions";
import { POForm } from "../po-form";
import { createBalanceInvoiceAction } from "../../invoices/actions";
import { outstandingOf } from "@/server/core/money";

const LABELS: Partial<Record<POStatus, string>> = {
  SUBMITTED: "Submit for approval", APPROVED: "Approve", REJECTED: "Reject", ON_HOLD: "Put on hold",
  CANCELLED: "Cancel PO", COMPLETED: "Mark completed", DRAFT: "Back to draft",
};

export default async function POPage({ params, searchParams }: PageProps<"/pos/[id]">) {
  const { flash } = await searchParams;
  const user = await requirePermission("pos");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      client: true, project: true, approvedBy: { select: { name: true } },
      milestones: { orderBy: { sequence: "asc" }, include: { invoices: { orderBy: { createdAt: "desc" } } } },
      invoices: { orderBy: { createdAt: "desc" }, include: { balanceInvoices: { where: { status: { not: "CANCELLED" } }, select: { id: true, invoiceNumber: true } } } },
    },
  });
  if (!po) notFound();
  const attachments = await prisma.attachment.findMany({
    where: { entityType: "PurchaseOrder", entityId: id }, orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true } } },
  });
  const [bal, { template, company }, history, projects] = await Promise.all([
    poBalance(prisma, id),
    getSettings(prisma),
    prisma.auditLog.findMany({ where: { entityType: "PurchaseOrder", entityId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } }),
    prisma.project.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, currency: true, client: { select: { name: true } } } }),
  ]);

  const editable = can(user.role, "pos", "edit") && (["DRAFT", "SUBMITTED", "REJECTED"] as POStatus[]).includes(po.status);
  const transitions = PO_TRANSITIONS[po.status].filter((t) =>
    can(user.role, "pos", t === "APPROVED" || t === "REJECTED" ? "approve" : t === "CANCELLED" ? "cancel" : "edit"));
  const pctTotal = sum(po.milestones.map((m) => m.percentage));
  const planOk = isMilestonePlanComplete(po.milestones);
  const approved = isPoApproved(po.status);
  const missingInvoices = (po.status === "APPROVED" || po.status === "SUBMITTED") && planOk && po.milestones.some((m) => !m.invoices.some((i) => i.status !== "CANCELLED"));
  const openMilestones = po.milestones.filter((m) => !m.invoices.some((i) => i.status !== "CANCELLED"));
  const canInvoice = po.status === "APPROVED" && can(user.role, "invoices", "create");
  const canBalance = can(user.role, "invoices", "create") && can(user.role, "invoices", "approve");
  const partPaid = po.invoices.filter((i) => i.status === "PARTIALLY_PAID" && !i.balanceInvoices.length && outstandingOf(i).gt(0));

  return (
    <>
      <Flash message={flash} />
      <PageHeader
        back={{ href: "/pos", label: "Purchase Orders" }}
        title={<span className="flex items-center gap-3">PO {po.poNumber} <StatusBadge status={po.status} /></span>}
        subtitle={<><Link className="hover:underline" href={`/clients/${po.clientId}`}>{po.client.name}</Link> · <Link className="hover:underline" href={`/projects/${po.projectId}`}>{po.project.code} — {po.project.name}</Link></>}
        actions={canInvoice && bal.remaining.gt(0) && <a href="#new-invoice" className={buttonClass("primary")}>Create invoice</a>}
      />

      {transitions.length > 0 && (
        <Card className="mb-6" title="Workflow">
          {po.milestones.length > 0 && !planOk && transitions.includes("APPROVED") && (
            <p className="mb-3 rounded-lg bg-lime-soft px-3 py-2 text-sm text-lime-ink">
              Milestones total {pctTotal.toString()}%. They must total exactly 100% before this PO can be approved.
            </p>
          )}
          {po.milestones.length > 0 && planOk && transitions.includes("APPROVED") && (
            <p className="mb-3 text-sm text-slate-500">
              {po.status === "SUBMITTED"
                ? <>Its {po.milestones.length} milestone invoice{po.milestones.length > 1 ? "s are" : " is"} drafted and waiting. Approving releases them for finalizing; rejecting cancels them.</>
                : <>Approving will create {po.milestones.length} draft invoice{po.milestones.length > 1 ? "s" : ""}, one per milestone.</>}
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            {transitions.map((t) => (
              <ActionButton key={t} action={transitionPOAction.bind(null, po.id, t)} label={LABELS[t] ?? labelize(t)}
                variant={t === "APPROVED" ? "primary" : t === "REJECTED" || t === "CANCELLED" ? "danger" : "secondary"}
                reasonPrompt={t === "CANCELLED" ? "Reason for cancelling this PO" : undefined}
                confirm={t === "APPROVED" ? "Approve this PO? It will be locked and its milestone invoices become ready to finalize."
                  : t === "REJECTED" || t === "DRAFT" ? "Its pending milestone invoices will be cancelled. Continue?" : undefined} />
            ))}
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="PO value" value={<Money v={bal.value} cur={bal.currency} />} />
        <Stat label="Valid invoiced" value={<Money v={bal.invoiced} cur={bal.currency} />} sub="Drafts + issued, excludes cancelled" />
        <Stat label="Paid" value={<Money v={bal.paid} cur={bal.currency} />} />
        <Stat label="Outstanding" value={<Money v={bal.outstanding} cur={bal.currency} />} sub="Issued invoices" />
        <Stat label="Remaining invoiceable" value={<Money v={bal.remaining} cur={bal.currency} />} tone={bal.remaining.eq(0) ? undefined : "green"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Payment milestones" actions={missingInvoices && can(user.role, "pos", "approve") &&
            <ActionButton action={retryGenerationAction.bind(null, po.id)} label="Generate missing invoices" />}>
            <Table head={["#", "Milestone", "%", "Amount", "Expected", "Invoice"]} empty="No milestone plan — invoices are raised manually.">
              {po.milestones.map((m) => {
                const active = m.invoices.find((i) => i.status !== "CANCELLED");
                return (
                  <tr key={m.id}>
                    <Td className="tabular">{m.sequence}</Td>
                    <Td className="min-w-[180px] whitespace-normal">{m.name}{m.notes && <div className="text-xs text-slate-400">{m.notes}</div>}</Td>
                    <Td className="tabular">{m.percentage.toDecimalPlaces(4).toString()}%</Td>
                    <Td><Money v={m.amount} cur={po.currency} /></Td>
                    <Td>{fmtDate(m.expectedDate)}</Td>
                    <Td>{active ? <Link href={`/invoices/${active.id}`} className="text-brand-700 hover:underline">{active.invoiceNumber ?? (approved ? "Draft" : "Pending approval")}</Link>
                      : <span className="text-slate-400">{m.invoices.length ? "Cancelled — available" : "—"}</span>}</Td>
                  </tr>
                );
              })}
            </Table>
            {po.milestones.length > 0 && (
              <div className={`mt-3 text-xs ${planOk ? "text-brand-600" : "text-lime-ink"}`}>Total {pctTotal.toString()}%</div>
            )}
          </Card>

          {partPaid.length > 0 && (
            <Card title="Outstanding on part-paid invoices">
              <ul className="space-y-3">
                {partPaid.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-lime-soft px-4 py-3 text-sm text-lime-ink">
                    <span>
                      <Link href={`/invoices/${i.id}`} className="font-semibold underline underline-offset-2">{i.invoiceNumber}</Link>{" "}
                      is partially paid: <b><Money v={outstandingOf(i)} cur={i.currency} /></b> still outstanding.
                    </span>
                    {canBalance && (
                      <ActionButton action={createBalanceInvoiceAction.bind(null, i.id)} label="Create balance invoice" variant="primary"
                        confirm={`Create a new invoice for the outstanding ${i.currency} ${outstandingOf(i).toFixed(2)} of ${i.invoiceNumber}?`} />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Invoices on this PO">
            <Table head={["Invoice", "Type", "Status", "Due", "Amount", "Total", "Outstanding"]} empty="No invoices yet.">
              {po.invoices.map((i) => (
                <tr key={i.id} className={i.status === "CANCELLED" ? "opacity-60" : ""}>
                  <Td><Link href={`/invoices/${i.id}`} className="text-brand-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link>{i.version > 1 && <span className="ml-1 text-xs text-slate-400">v{i.version}</span>}</Td>
                  <Td><Badge>{labelize(i.kind)}</Badge></Td>
                  <Td><span className="flex gap-1"><StatusBadge status={i.status} pending={!approved} />{isOverdue(i) && <StatusBadge status="OVERDUE" />}</span></Td>
                  <Td>{fmtDate(i.dueDate)}</Td>
                  <Td><Money v={i.subtotal.minus(i.discount)} cur={i.currency} /></Td>
                  <Td><Money v={i.total} cur={i.currency} /></Td>
                  <Td>{i.status === "CANCELLED" || i.status === "DRAFT" ? "—" : i.balanceInvoices[0]
                    ? <span className="text-xs text-slate-500">Moved to <Link href={`/invoices/${i.balanceInvoices[0].id}`} className="text-brand-700 hover:underline">{i.balanceInvoices[0].invoiceNumber}</Link></span>
                    : <Money v={outstandingOf(i)} cur={i.currency} />}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          {canInvoice && (
            <div id="new-invoice" className="scroll-mt-24">
            <Card title="Create invoice">
              {bal.remaining.lte(0) ? (
                <p className="text-sm text-slate-500">This PO is fully invoiced. A new invoice is only possible after an existing one is cancelled.</p>
              ) : (
                <ActionForm action={createManualInvoiceAction.bind(null, po.id)}>
                  <LineEditor initial={[]} remaining={bal.remaining.toFixed(2)} currency={po.currency}
                    taxRate={template.showTax ? template.defaultTaxRate.toString() : "0"} showTax={template.showTax} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {openMilestones.length > 0 && (
                      <Field label="Link to milestone (optional)">
                        <Select name="milestoneId" defaultValue="">
                          <option value="">— Not linked —</option>
                          {openMilestones.map((m) => <option key={m.id} value={m.id}>#{m.sequence} {m.name}</option>)}
                        </Select>
                      </Field>
                    )}
                    <Field label="Due date" hint="Leave blank to use default payment terms at finalization."><Input type="date" name="dueDate" /></Field>
                    <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" /></Field>
                  </div>
                  <SubmitButton>Create draft invoice</SubmitButton>
                </ActionForm>
              )}
            </Card>
            </div>
          )}

          {editable && (
            <Card title="Edit PO">
              <POForm action={updatePOAction.bind(null, po.id)} po={po} projects={projects} defaultCurrency={company.defaultCurrency} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Attachments" actions={<span className="text-xs text-slate-400">{attachments.length}</span>}>
            <ul className="space-y-2 text-sm">
              {attachments.map((a) => (
                <li key={a.id} className="rounded-lg border border-slate-100 p-2">
                  <a href={`/api/attachments/${a.id}`} target="_blank" className="break-all font-medium text-brand-700 hover:underline">{a.fileName}</a>
                  <div className="text-xs text-slate-400">{(a.sizeBytes / 1024).toFixed(0)} KB · {fmtDate(a.createdAt)} · {a.uploadedBy?.name ?? "—"}</div>
                  {can(user.role, "pos", "edit") && (
                    <div className="mt-1"><ActionButton action={removeAttachmentAction.bind(null, po.id, a.id)} label="Remove" variant="ghost" reasonPrompt="Why remove this attachment?" /></div>
                  )}
                </li>
              ))}
              {!attachments.length && <li className="text-slate-400">No attachments.</li>}
            </ul>
            {can(user.role, "pos", "edit") && (
              <ActionForm action={uploadAttachmentAction.bind(null, po.id)} resetOnSuccess className="mt-4 space-y-2">
                <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" className="block w-full text-sm" />
                <p className="text-xs text-slate-400">PDF, image, Word or Excel up to 10 MB — e.g. the signed client PO.</p>
                <SubmitButton size="sm">Upload</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="Details">
            <DL items={[
              ["PO date", fmtDate(po.poDate)], ["Currency", po.currency],
              ["Client reference", po.reference], ["Approved", po.approvedAt ? `${fmtDate(po.approvedAt)} by ${po.approvedBy?.name ?? "—"}` : null],
              ["Remarks", po.remarks],
            ]} />
          </Card>
          <Card title="Change history">
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
