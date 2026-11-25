import Link from "next/link";
import { BarChart3, FileCheck2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { APP_NAME, BrandLogo } from "@/components/brand";

const FEATURES = [
  { icon: FileCheck2, title: "Milestone invoicing", text: "Approve a PO and its milestone invoices are drafted for you — never over the PO value." },
  { icon: BarChart3, title: "Live financial picture", text: "Business value, receivables and collections, always up to date." },
  { icon: ShieldCheck, title: "Audit-ready", text: "Every financial change is recorded, and issued invoices never silently change." },
];

/** Framed split screen for sign-in pages: dark-green brand panel on the left, form on the right. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas p-0 md:p-4">
      <div className="grid min-h-screen overflow-hidden bg-white md:min-h-[calc(100vh-2rem)] md:rounded-[28px] lg:grid-cols-[1.05fr_1fr]">
        <section className="relative m-2 hidden flex-col overflow-hidden rounded-[22px] bg-brand-900 p-12 text-white lg:flex">
          <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-lime-mid/15 blur-3xl" aria-hidden />

          <Link href="/" className="relative mb-10 self-start" aria-label={`${APP_NAME} home`}><BrandLogo light size="lg" /></Link>

          <div className="relative my-auto max-w-md">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">Every client, invoice, and payment —<br />track all in one place.</h2>
            <p className="mt-4 text-base text-brand-100/80">Clients, projects, purchase orders, invoices and collections in one simple app.</p>
            <ul className="mt-10 space-y-4">
              {FEATURES.map(({ icon: Icon, title: t, text }) => (
                <li key={t} className="flex gap-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-soft text-brand-900">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">{t}</span>
                    <span className="mt-0.5 block text-sm text-brand-100/70">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-brand-100/60">Secure sign-in · Two-factor ready · Encrypted sessions</p>
        </section>

        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <Link href="/" className="mb-8 inline-flex lg:hidden" aria-label={`${APP_NAME} home`}><BrandLogo size="lg" /></Link>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-xs text-slate-400">{footer}</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
