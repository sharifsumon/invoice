import { BarChart3, FileCheck2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const FEATURES = [
  { icon: FileCheck2, title: "Milestone invoicing", text: "Approve a PO and its milestone invoices are drafted for you — never over the PO value." },
  { icon: BarChart3, title: "Live financial picture", text: "Business value, receivables and collections, per currency, always up to date." },
  { icon: ShieldCheck, title: "Audit-ready", text: "Every financial change is recorded, and issued invoices never silently change." },
];

/** Split-screen frame for sign-in pages: brand panel on the left, form on the right. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-600/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[26rem] w-[26rem] rounded-full bg-cyan-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px]" aria-hidden />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold shadow-lg shadow-brand-900/40">IC</span>
          <span className="text-lg font-semibold tracking-tight">Invoice<span className="text-brand-400"> + </span>CRM</span>
        </div>

        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            From first call<br />to final payment.
          </h2>
          <p className="mt-4 text-base text-slate-300">Clients, projects, purchase orders, invoices and collections — in one place.</p>
          <ul className="mt-10 space-y-6">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-5 w-5 text-brand-300" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="mt-0.5 block text-sm text-slate-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">Secure sign-in · Two-factor ready · Encrypted sessions</p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white">IC</span>
            <span className="text-lg font-semibold tracking-tight">Invoice + CRM</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-xs text-slate-400">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
