import Link from "next/link";
import { InvoiceStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { isOverdue } from "@/server/core/invoices";
import { prisma } from "@/server/db";
import { filtersToWhere, invoiceListInclude, readFilters } from "@/server/invoice-list";
import { groupSum } from "@/server/queries";
import { Money } from "@/components/money";
import { CompanyMoney } from "@/components/company-money";
import { buttonClass, Card, fmtDate, Input, labelize, isPoApproved, PageHeader, Select, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { outstandingOf } from "@/server/core/money";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const user = await requirePermission("invoices");
  const sp = await searchParams;
  const f = readFilters(sp);
  const [invoices, clients] = await Promise.all([
    prisma.invoice.findMany({ where: filtersToWhere(f), include: invoiceListInclude, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const valid = invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "DRAFT");
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const canExport = can(user.role, "invoices", "export");

  return (
    <>
      <PageHeader title="Invoices" subtitle={`${invoices.length} shown`}
        actions={<>
          {can(user.role, "invoices", "create") && <Link href="/invoices/new" className={buttonClass("primary")}>New invoice</Link>}
          {canExport && <><a href={`/api/invoices/export?${qs}`} className={buttonClass("secondary")}>Export CSV</a>
          <a href={`/api/invoices/export?${qs}${qs ? "&" : ""}format=xlsx`} className={buttonClass("secondary")}>Export Excel</a></>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Issued (shown)" value={<CompanyMoney rows={groupSum(valid.filter((i) => i.kind !== "BALANCE"), (i) => i.currency, (i) => i.total)} />} sub="Excludes drafts, cancelled & balance invoices" />
        <Stat label="Outstanding (shown)" value={<CompanyMoney rows={groupSum(valid, (i) => i.currency, (i) => outstandingOf(i))} />} />
        <Stat label="Overdue (shown)" tone="red" value={<CompanyMoney rows={groupSum(valid.filter((i) => isOverdue(i)), (i) => i.currency, (i) => outstandingOf(i))} />} />
      </div>

      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input name="q" defaultValue={f.q} placeholder="Invoice, client, project or PO…" className="max-w-xs" />
          <Select name="status" defaultValue={f.status ?? ""} className="max-w-[170px]">
            <option value="">All statuses</option>
            {Object.values(InvoiceStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
            <option value="OVERDUE">Overdue</option>
          </Select>
          <Select name="clientId" defaultValue={f.clientId ?? ""} className="max-w-[200px]">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input name="from" type="date" defaultValue={f.from} className="max-w-[160px]" aria-label="Invoice date from" />
          <Input name="to" type="date" defaultValue={f.to} className="max-w-[160px]" aria-label="Invoice date to" />
          <button className={buttonClass("secondary")}>Filter</button>
          {qs && <Link href="/invoices" className={buttonClass("ghost")}>Clear</Link>}
        </form>

        <form action="/api/invoices/zip" method="post">
          <Table head={[canExport ? "" : null, "Invoice", "Client", "Project / PO", "Date", "Due", "Status", "Total", "Balance"].filter((h) => h !== null)} empty="No invoices match.">
            {invoices.map((i) => (
              <tr key={i.id} className={`hover:bg-slate-50 ${i.status === "CANCELLED" ? "opacity-60" : ""}`}>
                {canExport && <Td className="w-8">{i.invoiceNumber && <input type="checkbox" name="ids" value={i.id} aria-label={`Select ${i.invoiceNumber}`} />}</Td>}
                <Td><Link href={`/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link>
                  {i.version > 1 && <span className="ml-1 text-xs text-slate-400">v{i.version}</span>}
                  <div className="text-xs text-slate-400">{labelize(i.kind)}
                    {i.invoiceNumber && i.status !== "CANCELLED" && can(user.role, "invoices", "email") && (
                      <> · <Link href={`/invoices/${i.id}#email`} className="text-brand-600 hover:underline">Email</Link></>
                    )}</div></Td>
                <Td>{i.client.name}</Td>
                <Td>{i.project.code}<div className="text-xs text-slate-400">PO {i.po.poNumber}</div></Td>
                <Td>{fmtDate(i.invoiceDate)}</Td>
                <Td>{fmtDate(i.dueDate)}</Td>
                <Td><span className="flex flex-wrap gap-1"><StatusBadge status={i.status} pending={!isPoApproved(i.po.status)} />{isOverdue(i) && <StatusBadge status="OVERDUE" />}</span></Td>
                <Td><Money v={i.total} cur={i.currency} /></Td>
                <Td>{i.status === "CANCELLED" ? "—" : <Money v={outstandingOf(i)} cur={i.currency} />}</Td>
              </tr>
            ))}
          </Table>
          {canExport && invoices.some((i) => i.invoiceNumber) && (
            <div className="mt-4"><button className={buttonClass("secondary", "sm")}>Download selected PDFs (ZIP)</button></div>
          )}
        </form>
      </Card>
    </>
  );
}
