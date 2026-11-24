import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityType } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { isOverdue } from "@/server/core/invoices";
import { prisma } from "@/server/db";
import { groupSum } from "@/server/queries";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Money } from "@/components/money";
import { CompanyMoney } from "@/components/company-money";
import { Badge, Card, DL, Field, fmtDate, Input, labelize, LinkButton, PageHeader, Select, Stat, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { ClientForm, PHONE_PATTERN } from "../client-form";
import { addActivityAction, archiveClientAction, deleteContactAction, saveContactAction, updateClientAction } from "../actions";
import { outstandingOf } from "@/server/core/money";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const user = await requirePermission("clients");
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      activities: { orderBy: { occurredAt: "desc" }, take: 50, include: { user: { select: { name: true } } } },
      projects: { orderBy: { createdAt: "desc" } },
      purchaseOrders: { orderBy: { poDate: "desc" }, include: { project: { select: { code: true } } } },
      invoices: { orderBy: { createdAt: "desc" }, include: { po: { select: { poNumber: true } } } },
    },
  });
  if (!client) notFound();
  const canEdit = can(user, "clients", "edit");
  const valid = client.invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "DRAFT");
  const outstanding = groupSum(valid, (i) => i.currency, (i) => outstandingOf(i));
  const invoiced = groupSum(valid.filter((i) => i.kind !== "BALANCE"), (i) => i.currency, (i) => i.total);
  const paid = groupSum(valid, (i) => i.currency, (i) => i.amountPaid);
  const bv = groupSum(client.projects.filter((p) => p.approved), (p) => p.currency, (p) => p.value);

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "Clients" }}
        title={<span className="flex items-center gap-3">{client.name} <StatusBadge status={client.status} />{client.archived && <Badge>Archived</Badge>}</span>}
        subtitle={client.legalName}
        actions={<>
          {can(user, "projects", "create") && !client.archived && <LinkButton href={`/projects/new?clientId=${client.id}`} variant="secondary">New project</LinkButton>}
          {can(user, "clients", "delete") && <ActionButton action={archiveClientAction.bind(null, client.id, !client.archived)} label={client.archived ? "Restore" : "Archive"}
            confirm={client.archived ? undefined : "Archive this client? It will be hidden from active lists but all records are kept."} />}
        </>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Business value" value={<CompanyMoney rows={bv} />} sub="Approved projects" />
        <Stat label="Invoiced" value={<CompanyMoney rows={invoiced} />} />
        <Stat label="Collected" value={<CompanyMoney rows={paid} />} />
        <Stat label="Outstanding" value={<CompanyMoney rows={outstanding} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Details">
            {canEdit ? (
              <details>
                <summary className="mb-4 cursor-pointer text-sm text-brand-700">Edit details</summary>
                <ClientForm action={updateClientAction.bind(null, client.id)} client={client} />
                <hr className="my-5 border-slate-100" />
              </details>
            ) : null}
            <DL items={[
              ["Industry", client.industry], ["Country", client.country], ["Email", client.email], ["Phone", client.phone],
              ["Website", client.website], ["Tax / VAT ID", client.taxId], ["Address", client.address], ["Remarks", client.remarks],
            ]} />
          </Card>

          <Card title="Projects" actions={<span className="text-xs text-slate-400">{client.projects.length}</span>}>
            <Table head={["Code", "Project", "Status", "Value", "Approved"]} empty="No projects yet.">
              {client.projects.map((p) => (
                <tr key={p.id}>
                  <Td><Link href={`/projects/${p.id}`} className="text-brand-700 hover:underline">{p.code}</Link></Td>
                  <Td>{p.name}</Td>
                  <Td><StatusBadge status={p.status} /></Td>
                  <Td><Money v={p.value} cur={p.currency} /></Td>
                  <Td>{fmtDate(p.approvalDate)}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Purchase orders">
            <Table head={["PO", "Project", "Date", "Status", "Value"]} empty="No POs yet.">
              {client.purchaseOrders.map((o) => (
                <tr key={o.id}>
                  <Td><Link href={`/pos/${o.id}`} className="text-brand-700 hover:underline">{o.poNumber}</Link></Td>
                  <Td>{o.project.code}</Td>
                  <Td>{fmtDate(o.poDate)}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td><Money v={o.value} cur={o.currency} /></Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Invoices">
            <Table head={["Invoice", "PO", "Status", "Due", "Total", "Balance"]} empty="No invoices yet.">
              {client.invoices.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/invoices/${i.id}`} className="text-brand-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link></Td>
                  <Td>{i.po.poNumber}</Td>
                  <Td><span className="flex gap-1"><StatusBadge status={i.status} />{isOverdue(i) && <StatusBadge status="OVERDUE" />}</span></Td>
                  <Td>{fmtDate(i.dueDate)}</Td>
                  <Td><Money v={i.total} cur={i.currency} /></Td>
                  <Td>{i.status === "CANCELLED" ? "—" : <Money v={outstandingOf(i)} cur={i.currency} />}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Contacts">
            <ul className="space-y-3">
              {client.contacts.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.firstName} {c.lastName}</span>
                    {c.isPrimary && <Badge tone="indigo">Primary</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">{[c.designation, c.department].filter(Boolean).join(" · ")}</div>
                  <div className="mt-1 text-xs text-slate-600">{c.email}{c.email && c.phone ? " · " : ""}{c.phone}</div>
                  {canEdit && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-brand-700">Edit</summary>
                      <div className="mt-2"><ContactForm action={saveContactAction.bind(null, client.id, c.id)} c={c} /></div>
                      <div className="mt-2"><ActionButton action={deleteContactAction.bind(null, client.id, c.id)} label="Remove contact" variant="ghost" confirm="Remove this contact?" /></div>
                    </details>
                  )}
                </li>
              ))}
              {!client.contacts.length && <li className="text-sm text-slate-400">No contacts yet.</li>}
            </ul>
            {canEdit && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-brand-700">+ Add contact</summary>
                <div className="mt-3"><ContactForm action={saveContactAction.bind(null, client.id, undefined)} reset /></div>
              </details>
            )}
          </Card>

          <Card title="Activity timeline">
            {canEdit && (
              <ActionForm action={addActivityAction.bind(null, client.id)} resetOnSuccess className="mb-5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Select name="type" defaultValue="NOTE">
                    {Object.values(ActivityType).filter((t) => t !== "STATUS_CHANGE").map((t) => <option key={t} value={t}>{labelize(t)}</option>)}
                  </Select>
                  <Input name="occurredAt" type="datetime-local" />
                </div>
                <Input name="subject" placeholder="Subject" required />
                <Textarea name="body" placeholder="Details (optional)" rows={2} />
                <SubmitButton size="sm">Log activity</SubmitButton>
              </ActionForm>
            )}
            <ol className="space-y-3 border-l border-slate-200 pl-4">
              {client.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center gap-2"><Badge tone={a.type === "STATUS_CHANGE" ? "amber" : "slate"}>{labelize(a.type)}</Badge>
                    <span className="text-xs text-slate-400">{a.occurredAt.toISOString().slice(0, 16).replace("T", " ")}</span></div>
                  <div className="mt-1 font-medium text-slate-800">{a.subject}</div>
                  {a.body && <div className="text-slate-600 whitespace-pre-line">{a.body}</div>}
                  {a.user && <div className="text-xs text-slate-400">by {a.user.name}</div>}
                </li>
              ))}
              {!client.activities.length && <li className="text-sm text-slate-400">No activity yet.</li>}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function ContactForm({ action, c, reset }: {
  action: Parameters<typeof ActionForm>[0]["action"]; reset?: boolean;
  c?: { firstName: string; lastName: string; designation: string | null; email: string | null; phone: string | null; department: string | null; isPrimary: boolean };
}) {
  return (
    <ActionForm action={action} resetOnSuccess={reset} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name *"><Input name="firstName" required defaultValue={c?.firstName} /></Field>
        <Field label="Last name *"><Input name="lastName" required defaultValue={c?.lastName} /></Field>
        <Field label="Email *"><Input name="email" type="email" required defaultValue={c?.email ?? ""} /></Field>
        <Field label="Phone *"><Input name="phone" type="tel" required pattern={PHONE_PATTERN} defaultValue={c?.phone ?? ""} /></Field>
        <Field label="Designation"><Input name="designation" defaultValue={c?.designation ?? ""} /></Field>
        <Field label="Department"><Input name="department" defaultValue={c?.department ?? ""} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrimary" defaultChecked={c?.isPrimary} /> Primary contact</label>
      <SubmitButton size="sm">Save contact</SubmitButton>
    </ActionForm>
  );
}
