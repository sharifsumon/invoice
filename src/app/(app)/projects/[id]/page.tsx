import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarCheck, CalendarClock, ChevronLeft, CalendarDays, Check, FileText, FolderKanban, History, Pause, Pencil, Plus, ReceiptText, UserRound, X, type LucideIcon,
} from "lucide-react";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { dec, outstandingOf } from "@/server/core/money";
import { can } from "@/server/core/permissions";
import { PROJECT_STATUSES, PROJECT_TRANSITIONS, transitionApproves } from "@/server/core/projects";
import { getSettings } from "@/server/core/settings";
import { isOverdue } from "@/server/core/invoices";
import { prisma } from "@/server/db";
import { groupSum } from "@/server/queries";
import { Money } from "@/components/money";
import { CompanyMoney } from "@/components/company-money";
import { Card, cx, Flash, fmtDate, labelize, LinkButton, StatusBadge, Table, Td } from "@/components/ui";
import { setProjectStatusAction, updateProjectAndCloseAction } from "../actions";
import { ProjectForm } from "../project-form";
import { StatusSelect } from "./status-select";

const TABS = ["overview", "pos", "invoices", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { flash, edit, tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
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
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(prisma),
    prisma.auditLog.findMany({ where: { entityType: "Project", entityId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } }),
  ]);

  const approvedPOs = project.purchaseOrders.filter((p) => p.status === "APPROVED" || p.status === "COMPLETED");
  const issued = project.invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "DRAFT");
  const editable = can(user, "projects", "edit") && project.status !== "CANCELLED";
  const editing = editable && edit === "1";
  const statusOptions = PROJECT_STATUSES.map((s) => ({
    value: s,
    allowed: PROJECT_TRANSITIONS[project.status].includes(s)
      && can(user, "projects", s === "CANCELLED" ? "delete" : transitionApproves(project, s) ? "approve" : "edit"),
  }));
  const canChangeStatus = statusOptions.some((o) => o.allowed);
  const approvesOn = PROJECT_STATUSES.filter((s) => transitionApproves(project, s));

  // Progress figures in the project's own currency (other currencies are listed separately, never mixed).
  const cur = project.currency;
  const sum = <T extends { currency: string }>(rows: T[], val: (r: T) => ReturnType<typeof dec>) =>
    rows.filter((r) => r.currency === cur).reduce((s, r) => s.plus(val(r)), dec(0));
  const poValue = sum(approvedPOs, (p) => p.value);
  const invoiced = sum(issued.filter((i) => i.kind !== "BALANCE"), (i) => i.total); // balance invoices are not new billing
  const collected = sum(issued, (i) => i.amountPaid);
  const outstanding = sum(issued, (i) => outstandingOf(i));
  const otherCur = [...approvedPOs, ...issued].some((r) => r.currency !== cur);
  const overdue = issued.filter((i) => isOverdue(i)).length;

  const base = `/projects/${project.id}`;
  const tabHref = (t: Tab) => (t === "overview" ? base : `${base}?tab=${t}`);
  const tabs: { key: Tab; label: string; count?: number; icon: LucideIcon }[] = [
    { key: "overview", label: "Overview", icon: FolderKanban },
    { key: "pos", label: "Purchase orders", count: project.purchaseOrders.length, icon: FileText },
    { key: "invoices", label: "Invoices", count: project.invoices.length, icon: ReceiptText },
    { key: "activity", label: "Activity", count: history.length, icon: History },
  ];

  return (
    <>
      <Flash message={flash} />
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700">
        <ChevronLeft className="h-4 w-4" aria-hidden />Projects
      </Link>

      {/* Hero */}
      <section className="mb-6 overflow-hidden rounded-[20px] bg-white shadow-[0_1px_2px_rgba(16,40,32,0.04)]">
        <div className="bg-brand-900 px-6 py-6 text-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                <FolderKanban className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/80">
                  <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono tracking-wide">{project.code}</span>
                  <Link href={`/clients/${project.clientId}`} className="hover:text-white hover:underline">{project.client.name}</Link>
                </div>
                <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-tight">{project.name}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editable && !editing && (
                <Link href={`${base}?edit=1`} scroll={false}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/30 transition hover:bg-white/25">
                  <Pencil className="h-4 w-4" aria-hidden />Edit project
                </Link>
              )}
              {can(user, "pos", "create") && project.status !== "CANCELLED" && (
                <Link href={`/pos/new?projectId=${project.id}`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-medium text-brand-700 shadow-sm transition hover:bg-brand-50">
                  <Plus className="h-4 w-4" aria-hidden />New PO
                </Link>
              )}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-slate-100 sm:grid-cols-3 xl:grid-cols-5 xl:divide-x">
          <Fact icon={UserRound} label="Manager" value={project.manager?.name} />
          <Fact icon={CalendarDays} label="Start" value={project.startDate && fmtDate(project.startDate)} />
          <Fact icon={CalendarClock} label="Planned end" value={project.plannedEndDate && fmtDate(project.plannedEndDate)} />
          <Fact icon={CalendarCheck} label="Approved" value={project.approvalDate && project.approved ? fmtDate(project.approvalDate) : null} />
          <Fact label="Project value" value={<Money v={project.value} cur={cur} className="font-semibold text-slate-900" />} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {editing ? (
            <Card title="Edit project" icon={Pencil}
              actions={<LinkButton href={base} variant="ghost" size="sm" scroll={false}><X className="h-4 w-4" aria-hidden />Close</LinkButton>}>
              <ProjectForm action={updateProjectAndCloseAction.bind(null, project.id)} project={project} clients={clients} managers={managers}
                defaultCurrency={company.defaultCurrency} submitLabel="Save changes" />
            </Card>
          ) : (
            <section className="rounded-[20px] bg-white shadow-[0_1px_2px_rgba(16,40,32,0.04)]">
              <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-100 px-3 [scrollbar-width:none]" aria-label="Project sections">
                {tabs.map((t) => {
                  const active = t.key === tab;
                  return (
                    <Link key={t.key} href={tabHref(t.key)} scroll={false} aria-current={active ? "page" : undefined}
                      className={cx("-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm font-medium transition",
                        active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
                      <t.icon className="h-4 w-4" aria-hidden />{t.label}
                      {t.count !== undefined && (
                        <span className={cx("rounded-full px-1.5 py-px text-[11px] font-semibold", active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500")}>{t.count}</span>
                      )}
                    </Link>
                  );
                })}
              </nav>
              <div className="p-5">
                {tab === "overview" && (
                  <div className="space-y-6">
                    <TextBlock title="Description" text={project.description} empty="No description yet." />
                    <TextBlock title="Remarks" text={project.remarks} empty="No remarks." />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <MiniStat label="Purchase orders" value={String(project.purchaseOrders.length)} sub={`${approvedPOs.length} approved`} href={tabHref("pos")} />
                      <MiniStat label="Invoices issued" value={String(issued.length)} sub={overdue ? `${overdue} overdue` : "None overdue"} alert={overdue > 0} href={tabHref("invoices")} />
                      <MiniStat label="Actual end" value={project.actualEndDate ? fmtDate(project.actualEndDate) : "—"} sub={project.status === "COMPLETED" ? "Completed" : "Not finished"} />
                    </div>
                    {project.status === "CANCELLED" && can(user, "projects", "edit") && (
                      <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">This project is cancelled. Set its status back to Draft to edit it.</p>
                    )}
                  </div>
                )}

                {tab === "pos" && (
                  <Table head={["PO", "Date", "Status", "Value"]} empty="No purchase orders yet.">
                    {project.purchaseOrders.map((o) => (
                      <tr key={o.id}>
                        <Td><Link href={`/pos/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.poNumber}</Link></Td>
                        <Td>{fmtDate(o.poDate)}</Td>
                        <Td><StatusBadge status={o.status} /></Td>
                        <Td><Money v={o.value} cur={o.currency} /></Td>
                      </tr>
                    ))}
                  </Table>
                )}

                {tab === "invoices" && (
                  <Table head={["Invoice", "PO", "Status", "Due", "Total"]} empty="No invoices yet.">
                    {project.invoices.map((i) => (
                      <tr key={i.id}>
                        <Td><Link href={`/invoices/${i.id}`} className="font-medium text-brand-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link></Td>
                        <Td>{i.po?.poNumber ?? "—"}</Td>
                        <Td><span className="flex gap-1"><StatusBadge status={i.status} />{isOverdue(i) && <StatusBadge status="OVERDUE" />}</span></Td>
                        <Td>{fmtDate(i.dueDate)}</Td>
                        <Td><Money v={i.total} cur={i.currency} /></Td>
                      </tr>
                    ))}
                  </Table>
                )}

                {tab === "activity" && (
                  history.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No activity yet.</p> : (
                    <ol className="relative space-y-5 border-l border-slate-200 pl-6">
                      {history.map((h) => (
                        <li key={h.id} className="relative">
                          <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" aria-hidden />
                          <div className="text-sm font-medium text-slate-800">{labelize(h.action.split(".").slice(1).join("_"))}</div>
                          <div className="text-xs text-slate-400">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {h.actor?.name ?? "system"}</div>
                          {h.action === "project.value_changed" && (
                            <div className="mt-1 text-xs text-slate-600">
                              {(h.before as { value: string }).value} → {(h.after as { value: string }).value} — {h.reason}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )
                )}
              </div>
            </section>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Card title="Status">
            <Lifecycle status={project.status} />
            {canChangeStatus && !editing && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <StatusSelect action={setProjectStatusAction.bind(null, project.id)} current={project.status} options={statusOptions} approvesOn={approvesOn} />
              </div>
            )}
            <p className="mt-4 text-xs text-slate-500">
              {project.approved ? `Counts toward Business Value since ${fmtDate(project.approvalDate)}.` : "Not yet counted toward Business Value."}
            </p>
          </Card>

          <Card title="Financials">
            <div className="space-y-5">
              <Progress label="Covered by approved POs" value={poValue} total={project.value} cur={cur} />
              <Progress label="Invoiced of PO value" value={invoiced} total={poValue} cur={cur} />
              <Progress label="Collected of invoiced" value={collected} total={invoiced} cur={cur} tone="green" />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                <span className="text-slate-500">Outstanding</span>
                <Money v={outstanding} cur={cur} className={cx("font-semibold", outstanding.gt(0) ? "text-lime-ink" : "text-slate-900")} />
              </div>
              {otherCur && (
                <div className="text-xs text-slate-500">
                  <div className="mb-1 font-medium text-slate-600">All currencies (invoiced)</div>
                  <CompanyMoney rows={groupSum(issued.filter((i) => i.kind !== "BALANCE"), (i) => i.currency, (i) => i.total)} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Fact({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: React.ReactNode }) {
  return (
    <div className="px-6 py-4 min-w-0">
      <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-500">{Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function TextBlock({ title, text, empty }: { title: string; text: string | null; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {text ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{text}</p> : <p className="text-sm text-slate-400">{empty}</p>}
    </div>
  );
}

function MiniStat({ label, value, sub, href, alert }: { label: string; value: string; sub: string; href?: string; alert?: boolean }) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className={cx("mt-0.5 text-xs", alert ? "font-medium text-rose-600" : "text-slate-500")}>{sub}</div>
    </>
  );
  const cls = "block rounded-xl border border-slate-200/80 p-4";
  return href ? <Link href={href} scroll={false} className={cx(cls, "transition hover:border-brand-200 hover:bg-brand-50/40")}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Draft → In Progress → Completed, with On Hold / Cancelled shown as a detour. */
function Lifecycle({ status }: { status: ProjectStatus }) {
  const steps: ProjectStatus[] = ["DRAFT", "IN_PROGRESS", "COMPLETED"];
  const pos = status === "ON_HOLD" ? 1 : status === "CANCELLED" ? -1 : steps.indexOf(status);
  return (
    <div>
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const done = pos > i || (status === "COMPLETED" && i === 2);
          const current = pos === i && status !== "COMPLETED";
          return (
            <li key={s} className={cx("flex items-center", i < steps.length - 1 && "flex-1")}>
              <div className="flex flex-col items-center gap-1.5">
                <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset",
                  done ? "bg-brand-600 text-white ring-brand-600"
                    : current ? (status === "ON_HOLD" ? "bg-lime-soft text-lime-ink ring-lime-mid" : "bg-brand-50 text-brand-700 ring-brand-300")
                      : "bg-white text-slate-400 ring-slate-200")}>
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : current && status === "ON_HOLD" ? <Pause className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={cx("whitespace-nowrap text-[11px] font-medium", done || current ? "text-slate-700" : "text-slate-400")}>
                  {current && status === "ON_HOLD" ? "On Hold" : labelize(s)}
                </span>
              </div>
              {i < steps.length - 1 && <span className={cx("mx-2 mb-5 h-0.5 flex-1 rounded-full", pos > i ? "bg-brand-500" : "bg-slate-200")} aria-hidden />}
            </li>
          );
        })}
      </ol>
      {status === "CANCELLED" && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">This project is cancelled.</p>}
    </div>
  );
}

function Progress({ label, value, total, cur, tone = "brand" }: {
  label: string; value: ReturnType<typeof dec>; total: ReturnType<typeof dec>; cur: string; tone?: "brand" | "green";
}) {
  const pct = total.gt(0) ? Math.min(100, Math.round(value.div(total).times(100).toNumber())) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="tabular text-slate-500">{total.gt(0) ? `${pct}%` : "—"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx("h-full rounded-full", tone === "green" ? "bg-brand-500" : "bg-brand-500")} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-500"><Money v={value} cur={cur} /> of <Money v={total} cur={cur} /></div>
    </div>
  );
}
