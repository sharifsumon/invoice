import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Building2, CheckCircle2, ChevronRight, FilePlus2, FileText, FolderKanban, ReceiptText, UserPlus, type LucideIcon,
} from "lucide-react";
import { ClientStatus, InvoiceStatus, POStatus, ProjectStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { today } from "@/server/core/common";
import { dec, formatMoney } from "@/server/core/money";
import { can } from "@/server/core/permissions";
import { collectionsByMonth } from "@/server/core/payments";
import { prisma } from "@/server/db";
import { GroupedBarChart } from "@/components/bar-chart";
import { Card, cx, LinkButton } from "@/components/ui";

export const metadata = { title: "Dashboard" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One step of the Client → Project → PO → Invoice → Payment flow. */
function FlowStep({ step, icon: Icon, title, value, detail, href, cta, tone = "brand", last }: {
  step: number; icon: LucideIcon; title: string; value: string; detail: string; href: string; cta: string; tone?: "brand" | "amber" | "green"; last?: boolean;
}) {
  return (
    <li className="relative flex">
      <Link href={href}
        className="group flex w-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
        <div className="flex items-center justify-between">
          <span className={cx("flex h-10 w-10 items-center justify-center rounded-xl",
            tone === "amber" ? "bg-amber-50 text-amber-600" : tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-brand-50 text-brand-600")}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-xs font-semibold text-slate-300">0{step}</span>
        </div>
        <div className="mt-4 text-[13px] font-medium text-slate-500">{title}</div>
        <div className="tabular mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className={cx("mt-1 text-xs", tone === "amber" ? "font-medium text-amber-700" : "text-slate-500")}>{detail}</div>
        <div className="mt-auto pt-4 text-sm font-medium text-brand-700 group-hover:text-brand-800">
          <span className="inline-flex items-center gap-1">{cta}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
        </div>
      </Link>
      {!last && (
        <span className="absolute -right-3.5 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm xl:flex" aria-hidden>
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
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
    prisma.project.count({ where: { approved: true, status: { notIn: [ProjectStatus.CANCELLED, ProjectStatus.REJECTED] } } }),
    prisma.project.count({ where: { status: ProjectStatus.SUBMITTED } }),
    prisma.purchaseOrder.count({ where: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } } }),
    prisma.purchaseOrder.count({ where: { status: POStatus.SUBMITTED } }),
    prisma.invoice.findMany({ where: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] } }, select: { currency: true, total: true, amountPaid: true, status: true, dueDate: true } }),
    prisma.invoice.count({ where: { status: InvoiceStatus.DRAFT } }),
    prisma.$queryRaw<{ month: number; currency: string; value: string }[]>`
      SELECT EXTRACT(MONTH FROM "invoiceDate")::int AS month, "currency", SUM("total")::text AS value
        FROM "Invoice" WHERE "status" NOT IN ('DRAFT','CANCELLED') AND EXTRACT(YEAR FROM "invoiceDate") = ${year}
       GROUP BY 1, 2`,
    collectionsByMonth(prisma, year),
    prisma.companySettings.findUnique({ where: { id: 1 }, select: { defaultCurrency: true } }),
    prisma.invoice.findMany({
      where: { status: { in: open }, dueDate: { lt: t } }, orderBy: { dueDate: "asc" }, take: 4,
      select: { id: true, invoiceNumber: true, currency: true, total: true, amountPaid: true, dueDate: true, client: { select: { name: true } } },
    }),
    prisma.project.findMany({ where: { status: ProjectStatus.SUBMITTED }, take: 3, orderBy: { updatedAt: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.purchaseOrder.findMany({ where: { status: POStatus.SUBMITTED }, take: 3, orderBy: { updatedAt: "asc" }, select: { id: true, poNumber: true, client: { select: { name: true } } } }),
  ]);

  // Money is shown for one currency at a time (never mixed); default = currency with most invoicing.
  const currencies = [...new Set([...issued.map((i) => i.currency), ...collectedMonthly.map((r) => r.currency)])].sort();
  const volume = (c: string) => issued.filter((i) => i.currency === c).reduce((s, i) => s + Number(i.total), 0);
  const cur = typeof sp.cur === "string" && currencies.includes(sp.cur) ? sp.cur
    : [...currencies].sort((a, b) => volume(b) - volume(a))[0] ?? company?.defaultCurrency ?? "USD";
  const inCur = issued.filter((i) => i.currency === cur);
  const invoiced = inCur.reduce((s, i) => s.plus(i.total), dec(0));
  const collected = inCur.reduce((s, i) => s.plus(i.amountPaid), dec(0));
  const outstanding = inCur.filter((i) => open.includes(i.status)).reduce((s, i) => s.plus(i.total.minus(i.amountPaid)), dec(0));
  const overdueCount = issued.filter((i) => open.includes(i.status) && i.dueDate && i.dueDate < t).length;

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
      detail: `${formatMoney(i.total.minus(i.amountPaid), i.currency)} was due ${i.dueDate!.toISOString().slice(0, 10)}`,
    })),
    ...(can(user.role, "projects", "approve") ? projectsWaiting.map((p) => ({
      href: `/projects/${p.id}`, title: `${p.code} — ${p.name}`, tone: "amber" as const, tag: "Approve project", detail: "Submitted and waiting for approval",
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

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{greeting}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currencies.length > 1 && (
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium shadow-sm" aria-label="Currency">
              {currencies.map((c) => (
                <Link key={c} href={`/?cur=${c}`} scroll={false}
                  className={cx("rounded-md px-2.5 py-1.5 transition", c === cur ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-800")}>{c}</Link>
              ))}
            </div>
          )}
          {can(user.role, "clients", "create") && <LinkButton href="/clients/new" variant="secondary"><UserPlus className="h-4 w-4" aria-hidden />New client</LinkButton>}
          {can(user.role, "pos", "create") && <LinkButton href="/pos/new"><FilePlus2 className="h-4 w-4" aria-hidden />New PO</LinkButton>}
        </div>
      </div>
      {sp.denied && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You don&apos;t have access to that page.</div>}

      <section aria-labelledby="flow-title" className="mb-8">
        <h2 id="flow-title" className="mb-3 text-sm font-semibold text-slate-700">Your workflow</h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <FlowStep step={1} icon={Building2} title="Clients" value={String(activeClients)}
            detail={newLeads ? `${newLeads} still being contacted` : "All onboarded"} href="/clients" cta="View clients" />
          <FlowStep step={2} icon={FolderKanban} title="Approved projects" value={String(approvedProjects)}
            detail={projectsToApprove ? `${projectsToApprove} waiting for approval` : "Nothing waiting"} tone={projectsToApprove ? "amber" : "brand"}
            href="/projects" cta="View projects" />
          <FlowStep step={3} icon={FileText} title="Approved POs" value={String(approvedPOs)}
            detail={posToApprove ? `${posToApprove} waiting for approval` : "Nothing waiting"} tone={posToApprove ? "amber" : "brand"}
            href="/pos" cta="View POs" />
          <FlowStep step={4} icon={ReceiptText} title={`Invoiced (${cur})`} value={formatMoney(invoiced, "").trim()}
            detail={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"} to finalize` : "No drafts waiting"} tone={draftCount ? "amber" : "brand"}
            href="/invoices" cta="View invoices" />
          <FlowStep step={5} icon={Banknote} title={`Collected (${cur})`} value={formatMoney(collected, "").trim()}
            detail={`${formatMoney(outstanding, cur)} still outstanding${overdueCount ? ` · ${overdueCount} overdue` : ""}`} tone="green"
            href="/reports/collections" cta="View payments" last />
        </ol>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={`Invoiced vs collected — ${year}`}
          actions={<Link href="/reports/performance" className="text-sm font-medium text-brand-700 hover:text-brand-800">Reports</Link>}>
          {chartData.some((d) => d.values.some((v) => v > 0))
            ? <GroupedBarChart currency={cur} data={chartData} series={[{ name: "Invoiced", color: "var(--color-series-1)" }, { name: "Collected", color: "var(--color-series-2)" }]} />
            : <p className="py-16 text-center text-sm text-slate-400">No invoices or payments in {cur} yet this year.</p>}
        </Card>

        <Card title="Needs attention" actions={todos.length > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">{todos.length}</span>}>
          {todos.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
              <p className="mt-3 text-sm font-medium text-slate-700">You&apos;re all caught up</p>
              <p className="text-xs text-slate-500">Nothing overdue or waiting for approval.</p>
            </div>
          ) : (
            <ul className="-mx-2 space-y-1">
              {todos.slice(0, 7).map((x) => (
                <li key={x.href + x.title}>
                  <Link href={x.href} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50">
                    <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      x.tone === "red" ? "bg-rose-50 text-rose-600" : x.tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-brand-50 text-brand-600")}>
                      {x.tone === "red" ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{x.title}</span>
                        <span className={cx("shrink-0 text-[11px] font-semibold", x.tone === "red" ? "text-rose-600" : x.tone === "amber" ? "text-amber-700" : "text-brand-700")}>{x.tag}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-500">{x.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
