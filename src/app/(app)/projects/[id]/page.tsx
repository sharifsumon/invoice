import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { PROJECT_TRANSITIONS } from "@/server/core/projects";
import { getSettings } from "@/server/core/settings";
import { isOverdue } from "@/server/core/invoices";
import { prisma } from "@/server/db";
import { groupSum } from "@/server/queries";
import { ActionButton } from "@/components/forms";
import { Money, MultiMoney } from "@/components/money";
import { Card, DL, Flash, fmtDate, Input, labelize, LinkButton, PageHeader, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { transitionProjectAction, updateProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

const TRANSITION_STYLE: Partial<Record<ProjectStatus, "primary" | "danger" | "secondary">> = {
  APPROVED: "primary", REJECTED: "danger", CANCELLED: "danger",
};

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { flash } = await searchParams;
  const user = await requirePermission("projects");
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true, manager: true,
      purchaseOrders: { orderBy: { poDate: "desc" } },
      invoices: { orderBy: { createdAt: "desc" }, include: { po: { select: { poNumber: true } } } },
    },
  });
  if (!project) notFound();
  const [clients, managers, { company }, history] = await Promise.all([
    prisma.client.findMany({ where: { OR: [{ archived: false }, { id: project.clientId }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true, role: { in: ["PROJECT_MANAGER", "ADMIN", "MANAGEMENT"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(prisma),
    prisma.auditLog.findMany({ where: { entityType: "Project", entityId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } }),
  ]);

  const approvedPOs = project.purchaseOrders.filter((p) => p.status === "APPROVED" || p.status === "COMPLETED");
  const valid = project.invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "DRAFT");
  const editable = can(user.role, "projects", "edit") && project.status !== "CANCELLED" && project.status !== "COMPLETED";
  const transitions = PROJECT_TRANSITIONS[project.status].filter((t) =>
    can(user.role, "projects", t === "APPROVED" || t === "REJECTED" ? "approve" : "edit"));

  return (
    <>
      <Flash message={flash} />
      <PageHeader
        back={{ href: "/projects", label: "Projects" }}
        title={<span className="flex items-center gap-3">{project.name} <StatusBadge status={project.status} /></span>}
        subtitle={<>{project.code} · <Link className="hover:underline" href={`/clients/${project.clientId}`}>{project.client.name}</Link></>}
        actions={can(user.role, "pos", "create") && project.status !== "CANCELLED" && project.status !== "REJECTED" &&
          <LinkButton href={`/pos/new?projectId=${project.id}`}>New PO</LinkButton>}
      />

      {transitions.length > 0 && (
        <Card className="mb-6" title="Workflow">
          <div className="flex flex-wrap items-start gap-3">
            {transitions.map((t) => (
              <ActionButton key={t} action={transitionProjectAction.bind(null, project.id, t)} label={t === "APPROVED" ? "Approve" : t === "REJECTED" ? "Reject" : t === "CANCELLED" ? "Cancel project" : `Mark ${labelize(t)}`}
                variant={TRANSITION_STYLE[t] ?? "secondary"}
                confirm={t === "CANCELLED" ? "Cancel this project? It will no longer count toward Business Value." : undefined}
                extra={t === "APPROVED" ? (
                  <label className="block text-xs text-slate-600">Approval date (drives Business Value period)
                    <Input type="date" name="approvalDate" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1" />
                  </label>
                ) : undefined} />
            ))}
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Project value" value={<Money v={project.value} cur={project.currency} />} sub={project.approved ? `Approved ${fmtDate(project.approvalDate)}` : "Not approved — excluded from Business Value"} />
        <Stat label="Approved PO value" value={<MultiMoney rows={groupSum(approvedPOs, (p) => p.currency, (p) => p.value)} />} sub="Separate from project value" />
        <Stat label="Invoiced" value={<MultiMoney rows={groupSum(valid, (i) => i.currency, (i) => i.total)} />} />
        <Stat label="Collected" value={<MultiMoney rows={groupSum(valid, (i) => i.currency, (i) => i.amountPaid)} />} />
        <Stat label="Outstanding" value={<MultiMoney rows={groupSum(valid, (i) => i.currency, (i) => i.total.minus(i.amountPaid))} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Purchase orders">
            <Table head={["PO", "Date", "Status", "Value"]} empty="No POs yet.">
              {project.purchaseOrders.map((o) => (
                <tr key={o.id}>
                  <Td><Link href={`/pos/${o.id}`} className="text-indigo-700 hover:underline">{o.poNumber}</Link></Td>
                  <Td>{fmtDate(o.poDate)}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td><Money v={o.value} cur={o.currency} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Invoices">
            <Table head={["Invoice", "PO", "Status", "Due", "Total"]} empty="No invoices yet.">
              {project.invoices.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/invoices/${i.id}`} className="text-indigo-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link></Td>
                  <Td>{i.po.poNumber}</Td>
                  <Td><span className="flex gap-1"><StatusBadge status={i.status} />{isOverdue(i) && <StatusBadge status="OVERDUE" />}</span></Td>
                  <Td>{fmtDate(i.dueDate)}</Td>
                  <Td><Money v={i.total} cur={i.currency} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Details">
            {editable && (
              <details>
                <summary className="mb-4 cursor-pointer text-sm text-indigo-700">Edit project</summary>
                <ProjectForm action={updateProjectAction.bind(null, project.id)} project={project} clients={clients} managers={managers} defaultCurrency={company.defaultCurrency} />
                <hr className="my-5 border-slate-100" />
              </details>
            )}
            <DL items={[
              ["Manager", project.manager?.name], ["Currency", project.currency],
              ["Start", fmtDate(project.startDate)], ["Planned end", fmtDate(project.plannedEndDate)],
              ["Actual end", fmtDate(project.actualEndDate)], ["Approval date", fmtDate(project.approvalDate)],
              ["Description", project.description], ["Remarks", project.remarks],
            ]} />
          </Card>
        </div>
        <Card title="History">
          <ol className="space-y-3 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                <div className="font-medium text-slate-700">{labelize(h.action.split(".").slice(1).join("_"))}</div>
                <div className="text-xs text-slate-400">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {h.actor?.name ?? "system"}</div>
                {h.action === "project.value_changed" && (
                  <div className="text-xs text-slate-600">
                    {(h.before as { value: string }).value} → {(h.after as { value: string }).value} — {h.reason}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
