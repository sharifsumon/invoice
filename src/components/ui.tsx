import Link from "next/link";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { FlashCleanup } from "./flash-cleanup";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/**
 * Success banner after a redirecting action (`?flash=...`). Rendered as escaped text, and only for messages
 * our own actions produce, so a crafted link can't display arbitrary text on a trusted page.
 */
const FLASH_ALLOWED = /^(PO (approved|moved to) |Project moved to |Project updated|Payment recorded\. Balance invoice |Finalized as INV|Invoice cancelled|Group (created|deleted)|User (created|updated)|Client updated|Plan changed to |Requisition (submitted|saved as draft|updated|approved|rejected|marked fulfilled|cancelled|moved back to draft)|Department (added: |renamed to |activated|deactivated|deleted))[\w\s—.,()%:-]*$/;
export function Flash({ message }: { message?: string | string[] }) {
  const m = typeof message === "string" ? message.slice(0, 300) : "";
  if (!m || !FLASH_ALLOWED.test(m)) return null;
  return (
    <div role="status" className="mb-5 flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-white shadow-sm shadow-brand-600/20">
      <span className="h-2 w-2 rounded-full bg-white" aria-hidden />{m}<FlashCleanup />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600 transition hover:text-brand-800">
          <ChevronLeft className="h-4 w-4" aria-hidden />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1.5 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, icon: Icon, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; icon?: LucideIcon; flush?: boolean;
}) {
  return (
    <section className={cx("rounded-[20px] bg-white shadow-[0_1px_2px_rgba(16,40,32,0.04)]", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-5">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-slate-900">
            {Icon && <Icon className="h-4 w-4 text-brand-600" aria-hidden />}{title}
          </h2>
          {actions}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const btn = {
  primary: "bg-brand-500 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-600 disabled:bg-brand-200 disabled:shadow-none",
  secondary: "bg-lime-soft text-brand-950 hover:bg-lime-mid disabled:text-slate-400",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-600/20 hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-slate-600 hover:bg-brand-50 hover:text-brand-900",
};
export type BtnVariant = keyof typeof btn;
export const buttonClass = (v: BtnVariant = "primary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
    size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm", btn[v]);

export function LinkButton({ href, variant = "primary", size = "md", children, ...rest }: { href: string; variant?: BtnVariant; size?: "sm" | "md"; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return <Link href={href} className={buttonClass(variant, size)} {...rest}>{children}</Link>;
}

export const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-slate-500 user-invalid:border-rose-400 user-invalid:ring-rose-500/15";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const required = label.endsWith(" *");
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {required ? label.slice(0, -2) : label}
        {required && <span className="ml-0.5 text-rose-500" aria-hidden> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClass, "pr-8", props.className)} />;
}

const tones = {
  slate: "bg-slate-100 text-slate-600 ring-transparent",
  blue: "bg-brand-50 text-brand-800 ring-brand-200",
  green: "bg-brand-500 text-white ring-transparent",
  amber: "bg-lime-mid text-lime-ink ring-transparent",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  indigo: "bg-brand-900 text-white ring-transparent",
  purple: "bg-brand-100 text-brand-900 ring-transparent",
};
const dots: Record<Tone, string> = {
  slate: "bg-slate-400", blue: "bg-brand-500", green: "bg-white", amber: "bg-lime-ink", red: "bg-rose-500", indigo: "bg-brand-300", purple: "bg-brand-700",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "slate", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tones[tone])}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "slate", PROPOSED: "slate", PROSPECT: "slate", COMMUNICATED: "blue", ONBOARDED: "indigo",
  SUBMITTED: "blue", APPROVED: "green", IN_PROGRESS: "indigo", ON_HOLD: "amber", COMPLETED: "purple",
  CANCELLED: "red", REJECTED: "red", INACTIVE: "slate", FULFILLED: "purple",
  UNPAID: "amber", PARTIALLY_PAID: "blue", PAID: "green", OVERDUE: "red",
};
const STATUS_LABELS: Record<string, string> = { SUBMITTED: "Submitted for approval" };
/** `pending`: a draft invoice whose PO is not approved yet — shown as "Pending approval". */
export function StatusBadge({ status, pending }: { status: string; pending?: boolean }) {
  if (pending && status === "DRAFT") return <Badge dot tone="amber">Pending approval</Badge>;
  return <Badge dot tone={STATUS_TONES[status] ?? "slate"}>{STATUS_LABELS[status] ?? labelize(status)}</Badge>;
}
export const isPoApproved = (status: string) => status === "APPROVED" || status === "COMPLETED";
export function labelize(s: string) {
  return s.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.filter(Boolean).length > 0 : !!children;
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-slate-500">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap bg-surface px-3.5 py-3 first:rounded-l-xl first:pl-4 last:rounded-r-xl last:pr-4">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:border-slate-100 [&>tr:last-child>td]:border-b-0 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50/40">{children}</tbody>
      </table>
      {!hasRows && (
        <div className="px-5 py-12 text-center">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-lime-soft" aria-hidden />
          <div className="text-sm text-slate-500">{empty ?? "Nothing here yet."}</div>
        </div>
      )}
    </div>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  // One line by default (numbers, dates, IDs); pass "whitespace-normal" for free-text columns.
  const wrap = className?.includes("whitespace-") || className?.includes("truncate");
  return <td {...rest} className={cx(!wrap && "whitespace-nowrap", "px-3.5 py-3.5 align-middle text-slate-700 first:pl-4 last:pr-4", className)}>{children}</td>;
}

const statAccents = {
  blue: "bg-brand-50 text-brand-600 ring-brand-100",
  green: "bg-brand-500 text-white ring-brand-500",
  amber: "bg-lime-soft text-lime-ink ring-lime-mid",
  red: "bg-rose-50 text-rose-600 ring-rose-100",
  violet: "bg-brand-900 text-white ring-brand-900",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  cyan: "bg-cyan-50 text-cyan-600 ring-cyan-100",
};
export type StatAccent = keyof typeof statAccents;

export function Stat({ label, value, sub, tone, icon: Icon, accent = "slate" }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green"; icon?: LucideIcon; accent?: StatAccent;
}) {
  return (
    <div className="rounded-[20px] bg-white p-5 shadow-[0_1px_2px_rgba(16,40,32,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] font-medium text-slate-500">{label}</div>
        {Icon && (
          <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", statAccents[accent])}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
      </div>
      <div className={cx("mt-2 break-words text-xl font-semibold tracking-tight", tone === "red" ? "text-rose-600" : tone === "green" ? "text-brand-600" : "text-slate-900")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-1 whitespace-pre-line text-slate-900">{v ?? <span className="text-slate-300">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}
export function isoDate(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}
