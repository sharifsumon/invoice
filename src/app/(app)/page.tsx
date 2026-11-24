import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Building2, CheckCircle2, FilePlus2, FileText, FolderKanban, ReceiptText, UserPlus, type LucideIcon,
} from "lucide-react";
import { ClientStatus, InvoiceStatus, POStatus, ProjectStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { today } from "@/server/core/common";
import { dec, formatMoney } from "@/server/core/money";
import { can } from "@/server/core/permissions";
import { collectionsByMonth } from "@/server/core/payments";
import { prisma } from "@/server/db";
import { GroupedBarChart } from "@/components/bar-chart";
import { Card, cx, LinkButton, Table, Td } from "@/components/ui";
import { outstandingOf } from "@/server/core/money";

export const metadata = { title: "Dashboard" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One step of the Client → Project → PO → Invoice → Payment flow. */
function FlowStep({ step, icon: Icon, title, value, detail, href, alert }: {
  step: number; icon: LucideIcon; title: string; value: string; detail: string; href: string; alert?: boolean;
}) {
  return (
    <li>
      <Link href={href} className="group flex h-full items-start gap-3 rounded-2xl bg-surface p-4 transition hover:bg-brand-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-sm">
          <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-slate-500"><span className="text-slate-400">0{step} · </span>{title}</span>
          <span className="tabular block text-xl font-semibold tracking-tight text-slate-900">{value}</span>
          <span className={cx("block truncate text-xs", alert ? "font-medium text-lime-ink" : "text-slate-500")}>{detail}</span>
        </span>
      </Link>
    </li>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const t = today();
  const year = t.getUTCFullYear();
  const open: InvoiceStatus[] = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID];

  const [
    activeClients, newLeads, approvedProjects, projectsToApprove, approvedPOs, posToApprove,
    issued, draftCount, invoicedMonthly, collectedMonthly, company, overdueList, projectsWaiting, posWaiting,
  ] = await Promise.all([
    prisma.client.count({ where: { archived: false } }),
    prisma.client.count({ where: { archived: false, status: { in: [ClientStatus.PROSPECT, ClientStatus.COMMUNICATED] } } }),
    prisma.project.count({ where: { approved: true, status: { not: ProjectStatus.CANCELLED } } }),
    prisma.project.count({ where: { status: ProjectStatus.DRAFT } }),
    prisma.purchaseOrder.count({ where: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } } }),
    prisma.purchaseOrder.count({ where: { status: POStatus.SUBMITTED } }),
    prisma.invoice.findMany({ where: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] } }, select: { currency: true, total: true, amountPaid: true, balanceMoved: true, kind: true, status: true, dueDate: true } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.DRAFT, po: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } } } }),
    prisma.$queryRaw<{ month: number; currency: string; value: string }[]>`
      SELECT EXTRACT(MONTH FROM "invoiceDate")::int AS month, "currency", SUM("total")::text AS value
        FROM "Invoice" WHERE "status" NOT IN ('DRAFT','CANCELLED') AND "kind" <> 'BALANCE' AND EXTRACT(YEAR FROM "invoiceDate") = ${year}
       GROUP BY 1, 2`,
    collectionsByMonth(prisma, year),
    prisma.companySettings.findUnique({ where: { id: 1 }, select: { defaultCurrency: true } }),
    prisma.invoice.findMany({
      where: { status: { in: open }, balanceMoved: 0, dueDate: { lt: t } }, orderBy: { dueDate: "asc" }, take: 4,
      select: { id: true, invoiceNumber: true, currency: true, total: true, amountPaid: true, balanceMoved: true, dueDate: true, client: { select: { name: true } } },
    }),
    prisma.project.findMany({ where: { status: ProjectStatus.DRAFT }, take: 3, orderBy: { updatedAt: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.purchaseOrder.findMany({ where: { status: POStatus.SUBMITTED }, take: 3, orderBy: { updatedAt: "asc" }, select: { id: true, poNumber: true, client: { select: { name: true } } } }),
  ]);

  // The app works in one currency: the company currency from Settings.
  const cur = company?.defaultCurrency ?? "USD";
  const inCur = issued.filter((i) => i.currency === cur);
  const invoiced = inCur.filter((i) => i.kind !== "BALANCE").reduce((s, i) => s.plus(i.total), dec(0)); // balance invoices are not new billing
  const collected = inCur.reduce((s, i) => s.plus(i.amountPaid), dec(0));
  const outstanding = inCur.filter((i) => open.includes(i.status)).reduce((s, i) => s.plus(outstandingOf(i)), dec(0));
  const overdueCount = issued.filter((i) => open.includes(i.status) && i.dueDate && i.dueDate < t && outstandingOf(i).gt(0)).length;

  const chartData = MONTHS.slice(0, t.getUTCMonth() + 1).map((label, idx) => ({
    label,
    values: [
      Number(invoicedMonthly.find((r) => r.month === idx + 1 && r.currency === cur)?.value ?? 0),
      Number(collectedMonthly.find((r) => r.month === idx + 1 && r.currency === cur)?.value ?? 0),
    ],
  }));

  type Todo = { href: string; title: string; detail: string; tone: "red" | "amber" | "brand"; tag: string };
  const todos: Todo[] = [
    ...overdueList.map((i) => ({
      href: `/invoices/${i.id}`, title: `${i.invoiceNumber} · ${i.client.name}`, tone: "red" as const, tag: "Overdue",
      detail: `${formatMoney(outstandingOf(i), i.currency)} was due ${i.dueDate!.toISOString().slice(0, 10)}`,
    })),
    ...(can(user.role, "projects", "approve") ? projectsWaiting.map((p) => ({
      href: `/projects/${p.id}`, title: `${p.code} — ${p.name}`, tone: "amber" as const, tag: "Start project", detail: "Draft — set it to In Progress once approved",
    })) : []),
    ...(can(user.role, "pos", "approve") ? posWaiting.map((p) => ({
      href: `/pos/${p.id}`, title: `PO ${p.poNumber} · ${p.client.name}`, tone: "amber" as const, tag: "Approve PO", detail: "Approving creates its milestone invoices",
    })) : []),
    ...(draftCount > 0 && can(user.role, "invoices", "approve") ? [{
      href: "/invoices?status=DRAFT", title: `${draftCount} draft invoice${draftCount === 1 ? "" : "s"}`, tone: "brand" as const, tag: "Finalize",
      detail: "Review and finalize to issue them",
    }] : []),
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const paidCount = inCur.filter((i) => i.status === InvoiceStatus.PAID).length;
  const openCount = inCur.filter((i) => open.includes(i.status) && outstandingOf(i).gt(0)).length;
  const collectedPct = invoiced.gt(0) ? Math.round(collected.div(invoiced).times(100).toNumber()) : 0;
  const amount = (v: ReturnType<typeof dec>) => formatMoney(v, "").trim();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">{greeting}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user.role, "clients", "create") && <LinkButton href="/clients/new" variant="secondary"><UserPlus className="h-4 w-4" aria-hidden />New client</LinkButton>}
          {can(user.role, "pos", "create") && <LinkButton href="/pos/new"><FilePlus2 className="h-4 w-4" aria-hidden />New PO</LinkButton>}
        </div>
      </div>
      {sp.denied && <div className="mb-5 rounded-xl bg-lime-soft px-4 py-3 text-sm text-lime-ink">You don&apos;t have access to that page.</div>}

      {/* Money at a glance + chart */}
      <div className="mb-6 grid gap-4 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_1.7fr]">
        <BandCard band="lime" title="Invoiced" href="/invoices">
          <BigNumber value={amount(invoiced)} cur={cur} />
          <Pills items={[[String(inCur.length), "Invoices"], [String(draftCount), "Drafts"]]} />
        </BandCard>
        <BandCard band="teal" title="Collected" href="/reports/collections">
          <BigNumber value={amount(collected)} cur={cur} chip={`${collectedPct}%`} />
          <Pills items={[[String(paidCount), "Paid"], [String(openCount), "Open"]]} />
        </BandCard>
        <BandCard band="dark" title="Outstanding" href="/invoices?status=OVERDUE">
          <BigNumber value={amount(outstanding)} cur={cur} />
          <Pills items={[[String(overdueCount), "Overdue"]]} alert={overdueCount > 0} />
        </BandCard>
        <Card className="md:col-span-3 xl:col-span-1" title={`Invoiced vs collected · ${year}`}
          actions={<Link href="/reports/performance" className="rounded-lg bg-lime-soft px-2.5 py-1 text-xs font-medium text-brand-950 hover:bg-lime-mid">Reports</Link>}>
          {chartData.some((d) => d.values.some((v) => v > 0))
            ? <GroupedBarChart currency={cur} data={chartData} series={[{ name: "Invoiced", color: "var(--color-series-1)" }, { name: "Collected", color: "var(--color-series-2)" }]} />
            : <p className="py-16 text-center text-sm text-slate-400">No invoices or payments yet this year.</p>}
        </Card>
      </div>

      {/* Pipeline */}
      <Card className="mb-6" title="Your workflow" flush>
        <ol className="grid grid-cols-2 gap-3 p-5 pt-4 sm:grid-cols-3 xl:grid-cols-5">
          <FlowStep step={1} icon={Building2} title="Clients" value={String(activeClients)}
            detail={newLeads ? `${newLeads} still being contacted` : "All onboarded"} href="/clients" />
          <FlowStep step={2} icon={FolderKanban} title="Active projects" value={String(approvedProjects)}
            detail={projectsToApprove ? `${projectsToApprove} still in draft` : "Nothing waiting"} alert={projectsToApprove > 0} href="/projects" />
          <FlowStep step={3} icon={FileText} title="Approved POs" value={String(approvedPOs)}
            detail={posToApprove ? `${posToApprove} waiting for approval` : "Nothing waiting"} alert={posToApprove > 0} href="/pos" />
          <FlowStep step={4} icon={ReceiptText} title="Invoices issued" value={String(inCur.length)}
            detail={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} to finalize` : "No drafts waiting"} alert={draftCount > 0} href="/invoices" />
          <FlowStep step={5} icon={Banknote} title="Paid in full" value={String(paidCount)}
            detail={`${openCount} still open`} href="/reports/collections" />
        </ol>
      </Card>

      {/* Needs attention */}
      <Card title="Needs attention" actions={todos.length > 0 && <span className="rounded-lg bg-brand-900 px-2.5 py-1 text-xs font-semibold text-white">{todos.length}</span>}>
        {todos.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-brand-500" aria-hidden />
            <p className="mt-3 text-sm font-medium text-slate-700">You&apos;re all caught up</p>
            <p className="text-xs text-slate-500">Nothing overdue or waiting for approval.</p>
          </div>
        ) : (
          <Table head={["Item", "Details", "Action"]}>
            {todos.slice(0, 8).map((x) => (
              <tr key={x.href + x.title}>
                <Td>
                  <Link href={x.href} className="flex items-center gap-3 font-medium text-slate-900 hover:text-brand-700">
                    <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      x.tone === "red" ? "bg-rose-50 text-rose-600" : x.tone === "amber" ? "bg-lime-soft text-lime-ink" : "bg-brand-50 text-brand-600")}>
                      {x.tone === "red" ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                    </span>
                    {x.title}
                  </Link>
                </Td>
                <Td className="whitespace-normal text-slate-500">{x.detail}</Td>
                <Td>
                  <Link href={x.href} className={cx("inline-flex rounded-lg px-2.5 py-1 text-xs font-medium",
                    x.tone === "red" ? "bg-rose-50 text-rose-700" : x.tone === "amber" ? "bg-lime-mid text-lime-ink" : "bg-brand-500 text-white")}>{x.tag}</Link>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

const BANDS = {
  lime: "bg-lime-soft text-brand-950",
  teal: "bg-brand-500 text-white",
  dark: "bg-brand-900 text-white",
};

/** Summary card with a coloured title band, as on the reference design. */
function BandCard({ band, title, href, children }: { band: keyof typeof BANDS; title: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group flex flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(16,40,32,0.04)] transition hover:-translate-y-0.5 hover:shadow-md">
      <div className={cx("flex items-center justify-between px-5 py-3.5 text-[15px] font-semibold", BANDS[band])}>
        {title}<ArrowRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" aria-hidden />
      </div>
      <div className="flex flex-1 flex-col justify-between gap-4 p-5">{children}</div>
    </Link>
  );
}

function BigNumber({ value, cur, chip }: { value: string; cur: string; chip?: string }) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div>
        <div className="tabular text-[28px] font-semibold leading-none tracking-tight text-slate-900">{value}</div>
        <div className="mt-1.5 text-xs text-slate-500">{cur}</div>
      </div>
      {chip && <span className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">{chip}</span>}
    </div>
  );
}

function Pills({ items, alert }: { items: [string, string][]; alert?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-surface px-3 py-2 text-xs text-slate-500">
      {items.map(([n, l]) => (
        <span key={l}><span className={cx("mr-1 text-sm font-semibold", alert ? "text-rose-600" : "text-slate-900")}>{n}</span>{l}</span>
      ))}
    </div>
  );
}
