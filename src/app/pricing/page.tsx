import Link from "next/link";
import { Check } from "lucide-react";
import { getUser } from "@/server/auth";
import { PLANS, TRIAL_DAYS, TRIAL_USER_LIMIT } from "@/lib/plans";
import { PlanCards } from "@/components/plan-cards";
import { MarketingFooter, MarketingHeader, SectionTitle } from "@/components/marketing";
import { buttonClass, cx } from "@/components/ui";

export const metadata = { title: "Pricing — Invoice+CRM", description: `${TRIAL_DAYS}-day free trial, then $10/month for up to 5 users or $20/month for up to 10 users.` };

export default async function PricingPage() {
  const signedIn = !!(await getUser());
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader signedIn={signedIn} />
      <main className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-4xl px-5 py-16 md:py-20">
          <SectionTitle eyebrow="Pricing" title={<>Try everything free for {TRIAL_DAYS} days</>} center>
            No card needed. After the trial, choose the plan that fits your team — every feature, including the AI assistant, is in both.
          </SectionTitle>

          <div className="mx-auto mt-8 flex max-w-xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-600">
            {[`${TRIAL_DAYS}-day free trial`, `Up to ${TRIAL_USER_LIMIT} users while you try it`, "Switch plans any time"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-500" aria-hidden />{t}</span>
            ))}
          </div>

          <div className="mt-12">
            <PlanCards action={(p) => (
              <Link href={signedIn ? "/subscription" : "/login"} className={cx(buttonClass(p.highlight ? "primary" : "secondary"), "w-full")}>
                {signedIn ? `Choose ${p.name}` : "Start free trial"}
              </Link>
            )} />
          </div>

          <div className="mt-12 overflow-hidden rounded-[20px] ring-1 ring-slate-200">
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
