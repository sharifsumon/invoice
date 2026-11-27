import Link from "next/link";
import { notFound } from "next/navigation";
import type { RequisitionStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { canEditRequisition, canSeeRequisition, STATUS_FLOW } from "@/server/core/requisitions";
import { prisma } from "@/server/db";
import { ActionButton } from "@/components/forms";
import { Money } from "@/components/money";
import { Badge, buttonClass, Card, DL, Flash, fmtDate, isoDate, labelize, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { transitionRequisitionAction, updateRequisitionAction } from "../actions";
import { RequisitionForm } from "../requisition-form";

const PRIORITY_TONE = { LOW: "slate", NORMAL: "blue", HIGH: "amber", URGENT: "red" } as const;

export default async function RequisitionPage({ params, searchParams }: PageProps<"/requisitions/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { flash, edit } = await searchParams;
  const r = await prisma.requisition.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sequence: "asc" } }, department: { select: { name: true } },
      requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
    },
  });
  if (!r || !canSeeRequisition(user, r)) notFound();

  const own = r.requestedById === user.id;
  const editable = canEditRequisition(user, r);
  const editing = editable && edit === "1";
  const next = STATUS_FLOW[r.status];
  const mayDecide = can(user, "requisitions", "approve") && (!own || can(user, "requisitions", "edit"));
  const allowed = (to: RequisitionStatus) => {
    if (!next.includes(to)) return false;
    if (to === "SUBMITTED") return own || can(user, "requisitions", "edit");
    if (to === "APPROVED" || to === "REJECTED") return mayDecide;
    if (to === "FULFILLED") return can(user, "requisitions", "approve");
    if (to === "DRAFT") return own || can(user, "requisitions", "edit");
    if (to === "CANCELLED") return own || can(user, "requisitions", "delete");
    return false;
  };
  const act = (to: RequisitionStatus) => transitionRequisitionAction.bind(null, r.id, to);
  const [departments, history] = await Promise.all([
    editing ? prisma.department.findMany({ where: { OR: [{ active: true }, { id: r.departmentId ?? "" }] }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }) : [],
    prisma.auditLog.findMany({ where: { entityType: "Requisition", entityId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } }),
  ]);

  return (
    <>
      <Flash message={flash} />
      <PageHeader back={{ href: "/requisitions", label: "Requisitions" }}
        title={<span className="flex flex-wrap items-center gap-3">{r.title}<StatusBadge status={r.status} /></span>}
        subtitle={<>{r.number ?? "Draft — a number is assigned when submitted"} · requested by {r.requestedBy.name} on {fmtDate(r.createdAt)}</>}
        actions={<>
          {editable && !editing && <Link href={`/requisitions/${r.id}?edit=1`} className={buttonClass("secondary")}>Edit</Link>}
          {allowed("SUBMITTED") && !editing && <ActionButton action={act("SUBMITTED")} label="Submit for approval" variant="primary" size="md" />}
          {allowed("APPROVED") && <ActionButton action={act("APPROVED")} label="Approve" variant="primary" size="md" confirm="Approve this requisition?" />}
          {allowed("REJECTED") && <ActionButton action={act("REJECTED")} label="Reject" variant="danger" size="md" reasonPrompt="Reason for rejecting (the requester will see it)" />}
          {allowed("FULFILLED") && <ActionButton action={act("FULFILLED")} label="Mark fulfilled" variant="primary" size="md" confirm="Mark all items as delivered / fulfilled?" />}
        </>} />

      {r.status === "REJECTED" && r.decisionNote && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Rejected by {r.decidedBy?.name ?? "—"} on {fmtDate(r.decidedAt)}: {r.decisionNote}
        </div>
      )}
      {r.status === "SUBMITTED" && own && !mayDecide && (
        <div className="mb-6 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">Waiting for approval. You can recall it to draft to make changes.</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {editing ? (
            <Card title="Edit requisition" actions={<Link href={`/requisitions/${r.id}`} className={buttonClass("secondary")}>Cancel</Link>}>
              <RequisitionForm action={updateRequisitionAction.bind(null, r.id)} departments={departments} currency={r.currency} canManageDepartments={can(user, "settings", "administer")}
                defaults={{
                  title: r.title, departmentId: r.departmentId, priority: r.priority, neededBy: isoDate(r.neededBy),
                  deliverTo: r.deliverTo, purpose: r.purpose,
                  items: r.items.map((i) => ({ description: i.description, quantity: i.quantity.toString(), unit: i.unit ?? "", unitPrice: i.unitPrice?.toFixed(2) ?? "" })),
                }} />
            </Card>
          ) : (
            <Card title="Items">
              <Table head={["#", "Item", "Qty", "Unit", "Est. unit price", "Est. amount"]}>
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <Td className="text-slate-400">{i.sequence}</Td>
                    <Td className="min-w-[240px] whitespace-normal">{i.description}</Td>
                    <Td className="tabular">{i.quantity.toDecimalPlaces(4).toString()}</Td>
                    <Td>{i.unit ?? "—"}</Td>
                    <Td>{i.unitPrice ? <Money v={i.unitPrice} cur={r.currency} /> : "—"}</Td>
                    <Td>{i.unitPrice ? <Money v={i.amount} cur={r.currency} /> : "—"}</Td>
                  </tr>
                ))}
              </Table>
              <div className="ml-auto mt-4 flex max-w-xs justify-between text-sm font-semibold">
                <span>Estimated total</span><Money v={r.estimatedTotal} cur={r.currency} />
              </div>
            </Card>
          )}

          {(r.purpose || r.deliverTo) && !editing && (
            <Card title="Details">
              <DL items={[["Purpose / justification", r.purpose], ["Deliver to", r.deliverTo]]} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <DL items={[
              ["Priority", <Badge key="p" tone={PRIORITY_TONE[r.priority]}>{labelize(r.priority)}</Badge>],
              ["Needed by", fmtDate(r.neededBy)],
              ["Department", r.department?.name ?? null],
              ["Submitted", r.submittedAt ? fmtDate(r.submittedAt) : null],
              [r.status === "REJECTED" ? "Rejected" : "Approved", r.decidedAt ? `${fmtDate(r.decidedAt)} by ${r.decidedBy?.name ?? "—"}` : null],
              ["Fulfilled", r.fulfilledAt ? fmtDate(r.fulfilledAt) : null],
            ]} />
          </Card>

          {(allowed("DRAFT") || allowed("CANCELLED")) && (
            <Card title="Changes">
              <div className="space-y-3">
                {allowed("DRAFT") && <ActionButton action={act("DRAFT")} label="Recall to draft" confirm="Move it back to draft so it can be edited? It will need to be submitted again." />}
                {allowed("CANCELLED") && <ActionButton action={act("CANCELLED")} label="Cancel requisition" variant="danger" confirm="Cancel this requisition? This cannot be undone." />}
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
