import Link from "next/link";
import { InvoiceStatus, POStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/server/auth";
import { addDays, today } from "@/server/core/common";
import { dec } from "@/server/core/money";
import { can } from "@/server/core/permissions";
import { businessValue, businessValueByMonth } from "@/server/core/projects";
import { collectionsByMonth } from "@/server/core/payments";
import { prisma } from "@/server/db";
import { groupSum } from "@/server/queries";
import { Money, MultiMoney } from "@/components/money";
import { Card, fmtDate, PageHeader, Stat, StatusBadge, Table, Td } from "@/components/ui";

export const metadata = { title: "Dashboard" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const t = today();
  const year = t.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const openStatuses = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID];

  const [bvAll, bvYear, bvMonthly, approvedPOs, issued, drafts, poSums] = await Promise.all([
    businessValue(prisma),
    businessValue(prisma, { from: yearStart }),
    businessValueByMonth(prisma, year),
    prisma.purchaseOrder.groupBy({ by: ["currency"], where: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } }, _sum: { value: true } }),
    prisma.invoice.findMany({
      where: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] } },
      select: { id: true, invoiceNumber: true, currency: true, total: true, amountPaid: true, dueDate: true, status: true, client: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { status: InvoiceStatus.DRAFT }, orderBy: { createdAt: "asc" }, take: 8,
      select: { id: true, currency: true, total: true, client: { select: { name: true } }, po: { select: { poNumber: true } } },
    }),
    prisma.invoice.groupBy({
      by: ["currency"], where: { status: { not: InvoiceStatus.CANCELLED }, po: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } } },
      _sum: { subtotal: true, discount: true },
    }),
  ]);
  const monthStart = new Date(Date.UTC(year, t.getUTCMonth(), 1));
  const [draftCount, collectedMonth, collectedMonthly] = await Promise.all([
    prisma.invoice.count({ where: { status: InvoiceStatus.DRAFT } }),
    prisma.payment.groupBy({ by: ["currency"], where: { state: "VALID", paymentDate: { gte: monthStart } }, _sum: { amount: true } }),
    collectionsByMonth(prisma, year),
  ]);
  const collCurrencies = [...new Set(collectedMonthly.map((r) => r.currency))].sort();

  const open = issued.filter((i) => openStatuses.includes(i.status as typeof openStatuses[number]));
  const bal = (i: (typeof issued)[number]) => i.total.minus(i.amountPaid);
  const overdue = open.filter((i) => i.dueDate && i.dueDate < t);
  const upcoming = open.filter((i) => i.dueDate && i.dueDate >= t && i.dueDate <= addDays(t, 30)).sort((a, b) => +a.dueDate! - +b.dueDate!);

  // Remaining invoiceable = approved PO value − valid invoices on those POs (per currency)
  const remaining = approvedPOs.map((p) => {
    const s = poSums.find((x) => x.currency === p.currency);
    const used = s ? s._sum.subtotal!.minus(s._sum.discount!) : dec(0);
    return [p.currency, (p._sum.value ?? dec(0)).minus(used)] as [string, Prisma.Decimal];
  });

  // Aging buckets of outstanding balances (days past due)
  const buckets = ["Not due", "1–30", "31–60", "61–90", "90+"];
  const aging = new Map<string, Prisma.Decimal[]>();
  for (const i of open) {
    const days = i.dueDate ? Math.floor((+t - +i.dueDate) / 86_400_000) : -1;
    const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    const row = aging.get(i.currency) ?? buckets.map(() => dec(0));
    row[b] = row[b].plus(bal(i));
    aging.set(i.currency, row);
  }

  const currencies = [...new Set(bvMonthly.map((r) => r.currency))].sort();

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle="All totals are per currency — different currencies are never added together." />
      {sp.denied && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">You don&apos;t have access to that page.</div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Business value (all time)" value={<MultiMoney rows={bvAll.map((r) => [r.currency, r.value])} />} sub="Approved projects only" />
        <Stat label={`Business value ${year}`} value={<MultiMoney rows={bvYear.map((r) => [r.currency, r.value])} />} sub="By approval date" />
        <Stat label="Approved PO value" value={<MultiMoney rows={approvedPOs.map((r) => [r.currency, r._sum.value ?? dec(0)])} />} sub="Shown separately from business value" />
        <Stat label="Remaining invoiceable" value={<MultiMoney rows={remaining} />} sub="Approved POs − valid invoices" />
        <Stat label="Total invoiced" value={<MultiMoney rows={groupSum(issued, (i) => i.currency, (i) => i.total)} />} sub="Issued, not cancelled" />
        <Stat label="Collected (all time)" value={<MultiMoney rows={groupSum(issued, (i) => i.currency, (i) => i.amountPaid)} />}
          sub={<>This month: <MultiMoney rows={collectedMonth.map((r) => [r.currency, r._sum.amount ?? dec(0)])} empty="none" /></>} />
        <Stat label="Outstanding" value={<MultiMoney rows={groupSum(open, (i) => i.currency, bal)} />} />
        <Stat label="Overdue" tone="red" value={<MultiMoney rows={groupSum(overdue, (i) => i.currency, bal)} />} sub={`${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Monthly business value — ${year}`}>
          {currencies.length === 0 ? <p className="text-sm text-slate-400">No projects approved this year yet.</p> : (
            <Table head={["Month", ...currencies]}>
              {MONTHS.map((m, idx) => {
                const rows = bvMonthly.filter((r) => r.month === idx + 1);
                if (!rows.length) return null;
                return (
                  <tr key={m}>
                    <Td>{m}</Td>
                    {currencies.map((c) => { const r = rows.find((x) => x.currency === c); return <Td key={c}>{r ? <Money v={r.value} cur={c} /> : "—"}</Td>; })}
                  </tr>
                );
              }).filter(Boolean)}
            </Table>
          )}
        </Card>

        <Card title={`Cash collected by month — ${year}`}>
          {collCurrencies.length === 0 ? <p className="text-sm text-slate-400">No payments recorded this year yet.</p> : (
            <Table head={["Month", ...collCurrencies]}>
              {MONTHS.map((m, idx) => {
                const rows = collectedMonthly.filter((r) => r.month === idx + 1);
                if (!rows.length) return null;
                return (
                  <tr key={m}>
                    <Td>{m}</Td>
                    {collCurrencies.map((c) => { const r = rows.find((x) => x.currency === c); return <Td key={c}>{r ? <Money v={r.value} cur={c} /> : "—"}</Td>; })}
                  </tr>
                );
              }).filter(Boolean)}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-400">Actual collections use payment dates; expected collections (below) use invoice due dates.</p>
        </Card>

        <Card title="Receivables aging">
          <Table head={["Currency", ...buckets]} empty="No outstanding receivables.">
            {[...aging.entries()].map(([c, row]) => (
              <tr key={c}>
                <Td className="font-medium">{c}</Td>
                {row.map((v, i) => <Td key={i} className={i > 0 && v.gt(0) ? "text-rose-600" : ""}>{v.gt(0) ? <Money v={v} cur="" /> : "—"}</Td>)}
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Overdue invoices">
          <Table head={["Invoice", "Client", "Due", "Balance"]} empty="Nothing overdue.">
            {overdue.slice(0, 10).map((i) => (
              <tr key={i.id}>
                <Td><Link className="text-indigo-700 hover:underline" href={`/invoices/${i.id}`}>{i.invoiceNumber}</Link></Td>
                <Td>{i.client.name}</Td>
                <Td className="text-rose-600">{fmtDate(i.dueDate)}</Td>
                <Td><Money v={bal(i)} cur={i.currency} /></Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Expected collections — next 30 days">
          <Table head={["Invoice", "Client", "Due", "Balance"]} empty="No invoices due in the next 30 days.">
            {upcoming.slice(0, 10).map((i) => (
              <tr key={i.id}>
                <Td><Link className="text-indigo-700 hover:underline" href={`/invoices/${i.id}`}>{i.invoiceNumber}</Link></Td>
                <Td>{i.client.name}</Td>
                <Td>{fmtDate(i.dueDate)}</Td>
                <Td><Money v={bal(i)} cur={i.currency} /></Td>
              </tr>
            ))}
          </Table>
        </Card>

        {can(user.role, "invoices", "approve") && (
          <Card title={`Draft invoices awaiting finalization (${draftCount})`} className="lg:col-span-2">
            <Table head={["Client", "PO", "Status", "Total"]} empty="No drafts.">
              {drafts.map((d) => (
                <tr key={d.id}>
                  <Td><Link className="text-indigo-700 hover:underline" href={`/invoices/${d.id}`}>{d.client.name}</Link></Td>
                  <Td>{d.po.poNumber}</Td>
                  <Td><StatusBadge status="DRAFT" /></Td>
                  <Td><Money v={d.total} cur={d.currency} /></Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
