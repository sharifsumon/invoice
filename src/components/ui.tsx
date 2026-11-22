import Link from "next/link";
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
  return <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{m}<FlashCleanup /></div>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-sm text-slate-500 hover:text-slate-800">← {back.label}</Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const btn = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-slate-600 hover:bg-slate-100",
};
export type BtnVariant = keyof typeof btn;
export const buttonClass = (v: BtnVariant = "primary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", btn[v]);

export function LinkButton({ href, variant = "primary", size = "md", children, ...rest }: { href: string; variant?: BtnVariant; size?: "sm" | "md"; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return <Link href={href} className={buttonClass(variant, size)} {...rest}>{children}</Link>;
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
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
  return <select {...props} className={cx(inputClass, props.className)} />;
}

const tones = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-rose-50 text-rose-700",
  indigo: "bg-indigo-50 text-indigo-700",
  purple: "bg-purple-50 text-purple-700",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  DRAFT: "slate", PROPOSED: "slate", PROSPECT: "slate", COMMUNICATED: "blue", ONBOARDED: "indigo",
  SUBMITTED: "blue", APPROVED: "green", IN_PROGRESS: "indigo", ON_HOLD: "amber", COMPLETED: "purple",
  CANCELLED: "red", REJECTED: "red", INACTIVE: "slate",
  UNPAID: "amber", PARTIALLY_PAID: "blue", PAID: "green", OVERDUE: "red",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "slate"}>{labelize(status)}</Badge>;
}
export function labelize(s: string) {
  return s.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {!hasRows && <div className="px-3 py-10 text-center text-sm text-slate-400">{empty ?? "Nothing here yet."}</div>}
    </div>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  return <td {...rest} className={cx("px-3 py-2.5 align-top text-slate-700", className)}>{children}</td>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 break-words text-lg font-semibold", tone === "red" ? "text-rose-600" : tone === "green" ? "text-emerald-600" : "text-slate-900")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-slate-800 whitespace-pre-line">{v ?? <span className="text-slate-300">—</span>}</dd>
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
