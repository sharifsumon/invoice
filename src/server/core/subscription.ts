import { planById, PLANS, TRIAL_DAYS, TRIAL_USER_LIMIT, type Plan, type PlanId } from "@/lib/plans";
import { audit, inTx, type Actor, type Db, type Tx } from "./common";
import { can, ForbiddenError, RuleError } from "./permissions";

/**
 * Subscription: a 14-day free trial (up to TRIAL_USER_LIMIT users) from company setup, then a monthly plan
 * that limits active users. No card payments yet — choosing a plan activates it; a payment provider can be
 * added later in choosePlan().
 */
export type SubscriptionStatus = "trial" | "active" | "expired";
export interface Subscription {
  status: SubscriptionStatus;
  plan: Plan | null;
  trialEndsAt: Date;
  trialDaysLeft: number;
  userLimit: number;
  activeUsers: number;
  planStartedAt: Date | null;
  renewsOn: Date | null;
}

const DAY = 86_400_000;

function nextRenewal(start: Date, now: Date) {
  const d = new Date(start);
  while (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export async function getSubscription(db: Db | Tx, now = new Date()): Promise<Subscription> {
  const c = await db.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { trialEndsAt: true, plan: true, planStartedAt: true } });
  const plan = planById(c.plan);
  const activeUsers = await db.user.count({ where: { active: true } });
  // Rounded up (a part day counts), never more than the trial length (clock reads can differ by milliseconds)
  const trialDaysLeft = Math.min(TRIAL_DAYS, Math.max(0, Math.ceil((c.trialEndsAt.getTime() - now.getTime()) / DAY)));
  const status: SubscriptionStatus = plan ? "active" : c.trialEndsAt > now ? "trial" : "expired";
  return {
    status, plan, trialEndsAt: c.trialEndsAt, trialDaysLeft, activeUsers,
    userLimit: plan ? plan.userLimit : TRIAL_USER_LIMIT,
    planStartedAt: c.planStartedAt, renewsOn: plan && c.planStartedAt ? nextRenewal(c.planStartedAt, now) : null,
  };
}

/** Why a new / re-activated user can't be added under this subscription, or null if there is a free seat. */
export function seatProblem(s: Pick<Subscription, "status" | "plan" | "activeUsers" | "userLimit">): string | null {
  if (s.status === "expired") return "The free trial has ended. Choose a plan under Subscription to add users.";
  if (s.activeUsers < s.userLimit) return null;
  const bigger = PLANS.find((p) => p.userLimit > s.userLimit);
  return `Your ${s.plan ? `${s.plan.name} plan` : "free package"} allows ${s.userLimit} active users and all are in use.${bigger ? ` Upgrade to ${bigger.name} (${bigger.userLimit} users) under Subscription, or deactivate a user.` : " Deactivate a user first."}`;
}

/** Before adding or re-activating a user: is there a free seat on the current plan? */
export async function assertUserSeat(tx: Db | Tx) {
  if (process.env.SEAT_LIMITS === "off") return; // automated tests only (see vitest.config.mts)
  const problem = seatProblem(await getSubscription(tx));
  if (problem) throw new RuleError(problem);
}

export async function choosePlan(db: Db, actor: Actor, planId: PlanId) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  const plan = planById(planId);
  if (!plan) throw new RuleError("Choose a valid plan");
  return inTx(db, async (tx) => {
    const before = await getSubscription(tx);
    if (before.activeUsers > plan.userLimit && process.env.SEAT_LIMITS !== "off") {
      throw new RuleError(`${plan.name} allows ${plan.userLimit} active users, but you have ${before.activeUsers}. Deactivate ${before.activeUsers - plan.userLimit} user(s) first, or choose a bigger plan.`);
    }
    const now = new Date();
    await tx.companySettings.update({ where: { id: 1 }, data: { plan: plan.id, planStartedAt: before.plan?.id === plan.id ? undefined : now } });
    await audit(tx, actor, "subscription.plan_chosen", "CompanySettings", "1", {
      before: { status: before.status, plan: before.plan?.id ?? null }, after: { plan: plan.id, priceUsd: plan.priceUsd, userLimit: plan.userLimit },
    });
    return plan;
  });
}
