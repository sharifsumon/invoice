import Link from "next/link";
import { Check } from "lucide-react";
import { getUser } from "@/server/auth";
import { PLANS, TRIAL_DAYS, TRIAL_USER_LIMIT } from "@/lib/plans";
import { PlanCards } from "@/components/plan-cards";
import { MarketingFooter, MarketingHeader, SectionTitle } from "@/components/marketing";
import { buttonClass, cx } from "@/components/ui";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Invoice & Billing Software",
  description: `InvoiceHub pricing: free for ${TRIAL_DAYS} days (up to ${TRIAL_USER_LIMIT} users), Starter $10/month for up to 5 users, Team $20/month for up to 10 users. Every invoicing and billing feature included.`,
  alternates: { canonical: "/pricing" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: "/pricing", siteName: "InvoiceHub", title: "InvoiceHub pricing — invoice & billing software from $10/month" },
};

export default async function PricingPage() {
  const signedIn = !!(await getUser());
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader signedIn={signedIn} />
      <main className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <SectionTitle eyebrow="Pricing" title="Simple pricing for every team" center>
            Start free for {TRIAL_DAYS} days, or go straight to a paid plan. Every package includes every feature, including the AI assistant.
          </SectionTitle>

          <div className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-600">
            {[`Free for ${TRIAL_DAYS} days, no card`, "Every feature in every package", "Switch plans any time"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-500" aria-hidden />{t}</span>
            ))}
          </div>

          <div className="mt-12">
            <PlanCards
              trialAction={<Link href={signedIn ? "/subscription" : "/login"} className={cx(buttonClass("secondary"), "w-full")}>{signedIn ? "View subscription" : "Start free trial"}</Link>}
              action={(p) => (
                <Link href={signedIn ? "/subscription" : "/login"} className={cx(buttonClass(p.highlight ? "primary" : "secondary"), "w-full")}>
                  Choose {p.name}
                </Link>
              )} />
          </div>

          <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-[20px] ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <caption className="sr-only">Plan comparison</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3"></th><th className="px-5 py-3">Free trial</th>{PLANS.map((p) => <th key={p.id} className="px-5 py-3">{p.name}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                <tr><td className="px-5 py-3 font-medium">Price</td><td className="px-5 py-3">Free for {TRIAL_DAYS} days</td>{PLANS.map((p) => <td key={p.id} className="px-5 py-3">${p.priceUsd} USD / month</td>)}</tr>
                <tr><td className="px-5 py-3 font-medium">Active users</td><td className="px-5 py-3">Up to {TRIAL_USER_LIMIT}</td>{PLANS.map((p) => <td key={p.id} className="px-5 py-3">Up to {p.userLimit}</td>)}</tr>
                <tr><td className="px-5 py-3 font-medium">AI assistant & exports</td><td className="px-5 py-3">✓</td>{PLANS.map((p) => <td key={p.id} className="px-5 py-3">✓</td>)}</tr>
                <tr><td className="px-5 py-3 font-medium">All other features</td><td className="px-5 py-3">✓</td>{PLANS.map((p) => <td key={p.id} className="px-5 py-3">✓</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">Prices in USD. Deactivated users don&apos;t count toward the limit. The AI assistant uses your own Google Gemini API key.</p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
