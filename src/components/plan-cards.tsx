import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { PLAN_FEATURES, PLANS, TRIAL_DAYS, type Plan } from "@/lib/plans";
import { cx } from "./ui";

/** The two plans side by side. `action` renders each card's button (link on the public page, form in the app). */
export function PlanCards({ action, current }: { action: (p: Plan) => ReactNode; current?: string | null }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {PLANS.map((p) => {
        const isCurrent = current === p.id;
        return (
          <section key={p.id} aria-label={`${p.name} plan`}
            className={cx("relative flex flex-col rounded-[24px] bg-white p-7 ring-1", p.highlight ? "ring-2 ring-brand-500 shadow-lg shadow-brand-600/10" : "ring-slate-200")}>
            {p.highlight && !isCurrent && <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
            {isCurrent && <span className="absolute -top-3 left-7 rounded-full bg-brand-900 px-3 py-1 text-xs font-semibold text-white">Your plan</span>}
            <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tracking-tight text-brand-950">${p.priceUsd}</span>
              <span className="text-sm text-slate-500">USD / month</span>
            </p>
            <p className="mt-1 text-sm font-medium text-brand-700">Up to {p.userLimit} users · {TRIAL_DAYS}-day free trial</p>
            <div className="mt-6">{action(p)}</div>
            <ul className="mt-6 space-y-2.5 border-t border-slate-100 pt-6 text-sm text-slate-700">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden />{f}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
