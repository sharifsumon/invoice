import { CalendarClock, Users } from "lucide-react";
import { currentSubscription, requireUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { TRIAL_DAYS } from "@/lib/plans";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PlanCards } from "@/components/plan-cards";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { choosePlanAction } from "./actions";

export const metadata = { title: "Subscription" };

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function SubscriptionPage({ searchParams }: PageProps<"/subscription">) {
  const user = await requireUser({ allowExpired: true });
  const { flash } = await searchParams;
  const sub = await currentSubscription();
  const canManage = can(user, "settings", "administer");
  const usedPct = Math.min(100, Math.round((sub.activeUsers / sub.userLimit) * 100));

  return (
    <>
      <Flash message={flash} />
      <PageHeader title="Subscription" subtitle={`Start with a ${TRIAL_DAYS}-day free trial, then choose the plan that fits your team. Every plan includes every feature.`} />

      {sub.status === "expired" && (
        <div role="alert" className="mb-6 rounded-2xl bg-rose-50 px-5 py-4 text-sm text-rose-800 ring-1 ring-rose-200">
          <b>Your free trial ended on {fmt(sub.trialEndsAt)}.</b>{" "}
          {canManage ? "Choose a plan below to keep using the app — all your data is safe." : "Ask an administrator to choose a plan — all your data is safe."}
        </div>
      )}

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lime-soft"><CalendarClock className="h-5 w-5 text-brand-700" aria-hidden /></span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</div>
              {sub.status === "trial" && <>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">Free trial <Badge tone="green">{sub.trialDaysLeft} day{sub.trialDaysLeft === 1 ? "" : "s"} left</Badge></div>
                <p className="text-sm text-slate-500">Ends {fmt(sub.trialEndsAt)}. Everything is included, for up to {sub.userLimit} users.</p>
              </>}
              {sub.status === "active" && sub.plan && <>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">{sub.plan.name} plan <Badge tone="green">Active</Badge></div>
                <p className="text-sm text-slate-500">${sub.plan.priceUsd} USD / month · next renewal {sub.renewsOn ? fmt(sub.renewsOn) : "—"}</p>
              </>}
              {sub.status === "expired" && <>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900">Trial ended <Badge tone="red">Choose a plan</Badge></div>
                <p className="text-sm text-slate-500">Ended {fmt(sub.trialEndsAt)}.</p>
              </>}
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lime-soft"><Users className="h-5 w-5 text-brand-700" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">{sub.activeUsers} of {sub.userLimit} active users</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Users used" aria-valuenow={usedPct} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${usedPct >= 100 ? "bg-rose-500" : "bg-brand-500"}`} style={{ width: `${usedPct}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-500">Deactivated users don&apos;t count.</p>
            </div>
          </div>
        </Card>
      </div>

      <PlanCards current={sub.plan?.id} onTrial={sub.status === "trial"}
        trialAction={
          <div className={`rounded-xl px-4 py-2.5 text-center text-sm font-semibold ${sub.status === "trial" ? "bg-white text-brand-800 ring-1 ring-lime-mid" : "bg-slate-100 text-slate-500"}`}>
            {sub.status === "trial" ? `${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? "" : "s"} left` : sub.status === "expired" ? "Trial ended" : "Trial used"}
          </div>
        }
        action={(p) => {
        if (!canManage) return <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-center text-sm text-slate-500">{sub.plan ? "An administrator can change the plan" : `Ask an administrator to upgrade to ${p.name}`}</p>;
        if (sub.plan?.id === p.id) return <div className="rounded-xl bg-brand-50 px-4 py-2.5 text-center text-sm font-semibold text-brand-800">Current plan</div>;
        const tooSmall = sub.activeUsers > p.userLimit;
        return (
          <ActionForm action={choosePlanAction}>
            <input type="hidden" name="plan" value={p.id} />
            <SubmitButton className="w-full">{sub.plan ? `Switch to ${p.name}` : `Upgrade to ${p.name}`}</SubmitButton>
            {tooSmall && <p className="text-xs text-rose-600">You have {sub.activeUsers} active users — deactivate some first.</p>}
          </ActionForm>
        );
      }} />

      <p className="mt-6 text-xs text-slate-500">
        Prices are in USD per month. Online card payment isn&apos;t connected yet — choosing a plan activates it right away and is recorded in the audit log.
      </p>
    </>
  );
}
