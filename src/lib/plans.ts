/** Subscription plans (shared by the public pricing page and the in-app Subscription page). */
export const TRIAL_DAYS = 14;
/** Users allowed while the free trial runs (everything is included). */
export const TRIAL_USER_LIMIT = 10;

export type PlanId = "STARTER" | "TEAM";
export interface Plan { id: PlanId; name: string; priceUsd: number; userLimit: number; tagline: string; highlight?: boolean }

export const PLANS: Plan[] = [
  { id: "STARTER", name: "Starter", priceUsd: 10, userLimit: 5, tagline: "For small teams getting organised", highlight: true },
  { id: "TEAM", name: "Team", priceUsd: 20, userLimit: 10, tagline: "For growing teams that bill every week" },
];

/** Everything is included in every plan — plans differ only by number of users. */
export const PLAN_FEATURES = [
  "AI assistant (Google Gemini) with Excel, Word & PDF exports",
  "Clients, contacts & activity timeline",
  "Projects with approval & business value",
  "Purchase orders with payment milestones",
  "Automatic milestone invoices & PDF invoices",
  "Payments, partial payments & balance invoices",
  "Invoice email with history",
  "10 built-in reports (CSV, Excel, PDF)",
  "User groups with custom permissions",
  "Audit log, two-factor sign-in, notifications",
];

/** The free trial, shown as its own package next to the paid plans (it is not a plan you can pick later). */
export const TRIAL_PACKAGE = {
  name: "Free trial", userLimit: TRIAL_USER_LIMIT,
  tagline: "Try every feature before you decide",
} as const;

export const planById =(id: string | null | undefined) => PLANS.find((p) => p.id === id) ?? null;
