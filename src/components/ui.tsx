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
const FLASH_ALLOWED = /^(PO (approved|moved to) |Project moved to |Finalized as INV|Invoice cancelled)[\w\s—.,()%:-]*$/;
export function Flash({ message }: { message?: string | string[] }) {
  const m = typeof message === "string" ? message.slice(0, 300) : "";
  if (!m || !FLASH_ALLOWED.test(m)) return null;
  return (
    <div role="status" className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />{m}<FlashCleanup />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-7">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700">
          <ChevronLeft className="h-4 w-4" aria-hidden />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
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
    <section className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden />}{title}
          </h2>
          {actions}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

const btn = {
  primary: "bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 disabled:bg-brand-300 disabled:shadow-none",
  secondary: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-600/20 hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};
export type BtnVariant = keyof typeof btn;
export const buttonClass = (v: BtnVariant = "primary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
    size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm", btn[v]);

export function LinkButton({ href, variant = "primary", size = "md", children, ...rest }: { href: string; variant?: BtnVariant; size?: "sm" | "md"; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return <Link href={href} className={buttonClass(variant, size)} {...rest}>{children}</Link>;
}

export const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-slate-500 user-invalid:border-rose-400 user-invalid:ring-rose-500/15";

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
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  indigo: "bg-brand-50 text-brand-700 ring-brand-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
};
const dots: Record<Tone, string> = {
  slate: "bg-slate-400", blue: "bg-sky-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500", indigo: "bg-brand-500", purple: "bg-violet-500",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "slate", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tones[tone])}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "slate", PROPOSED: "slate", PROSPECT: "slate", COMMUNICATED: "blue", ONBOARDED: "indigo",
  SUBMITTED: "blue", APPROVED: "green", IN_PROGRESS: "indigo", ON_HOLD: "amber", COMPLETED: "purple",
  CANCELLED: "red", REJECTED: "red", INACTIVE: "slate",
  UNPAID: "amber", PARTIALLY_PAID: "blue", PAID: "green", OVERDUE: "red",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge dot tone={STATUS_TONES[status] ?? "slate"}>{labelize(status)}</Badge>;
}
export function labelize(s: string) {
  return s.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.filter(Boolean).length > 0 : !!children;
  return (
    <div className="-mx-5 overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {head.map((h, i) => <th key={i} className="px-3.5 py-2.5 whitespace-nowrap first:pl-5 last:pr-5">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr]:transition-colors [&>tr:hover]:bg-slate-50/60">{children}</tbody>
      </table>
      {!hasRows && (
        <div className="px-5 py-12 text-center">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-slate-100" aria-hidden />
          <div className="text-sm text-slate-500">{empty ?? "Nothing here yet."}</div>
        </div>
      )}
    </div>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  // One line by default (numbers, dates, IDs); pass "whitespace-normal" for free-text columns.
  const wrap = className?.includes("whitespace-") || className?.includes("truncate");
  return <td {...rest} className={cx(!wrap && "whitespace-nowrap", "px-3.5 py-3 align-top text-slate-700 first:pl-5 last:pr-5", className)}>{children}</td>;
}

const statAccents = {
  blue: "bg-brand-50 text-brand-600 ring-brand-100",
  green: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
  red: "bg-rose-50 text-rose-600 ring-rose-100",
  violet: "bg-violet-50 text-violet-600 ring-violet-100",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  cyan: "bg-cyan-50 text-cyan-600 ring-cyan-100",
};
export type StatAccent = keyof typeof statAccents;

export function Stat({ label, value, sub, tone, icon: Icon, accent = "slate" }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green"; icon?: LucideIcon; accent?: StatAccent;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] font-medium text-slate-500">{label}</div>
        {Icon && (
          <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", statAccents[accent])}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
      </div>
      <div className={cx("mt-2 break-words text-xl font-semibold tracking-tight", tone === "red" ? "text-rose-600" : tone === "green" ? "text-emerald-600" : "text-slate-900")}>{value}</div>
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
