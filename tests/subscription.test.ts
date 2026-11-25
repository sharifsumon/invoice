import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertUserSeat, choosePlan, getSubscription, seatProblem } from "@/server/core/subscription";
import { createUser } from "@/server/core/users";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import type { Actor } from "@/server/core/common";
import { baseSettings, groupId, makeActor, Role, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let original: { trialEndsAt: Date; plan: string | null; planStartedAt: Date | null };

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  original = await db.companySettings.findUniqueOrThrow({ where: { id: 1 }, select: { trialEndsAt: true, plan: true, planStartedAt: true } });
});
afterEach(async () => {
  process.env.SEAT_LIMITS = "off";
  await db.companySettings.update({ where: { id: 1 }, data: original });
});
afterAll(async () => db.$disconnect());

const DAY = 86_400_000;

describe("Subscription", () => {
  it(`starts with a ${TRIAL_DAYS}-day trial, then expires without a plan`, async () => {
    const created = new Date();
    await db.companySettings.update({ where: { id: 1 }, data: { trialEndsAt: new Date(created.getTime() + TRIAL_DAYS * DAY), plan: null } });
    const s = await getSubscription(db, created);
    expect(s).toMatchObject({ status: "trial", trialDaysLeft: TRIAL_DAYS, userLimit: 10, plan: null });
    const later = await getSubscription(db, new Date(created.getTime() + (TRIAL_DAYS + 1) * DAY));
    expect(later.status).toBe("expired");
  });

  it("only administrators choose a plan; the plan sets the user limit and renewal date", async () => {
    await expect(choosePlan(db, finance, "STARTER")).rejects.toThrow(/permission/);
    await choosePlan(db, admin, "TEAM");
    const s = await getSubscription(db);
    expect(s).toMatchObject({ status: "active", userLimit: 10 });
    expect(s.plan?.priceUsd).toBe(20);
    expect(s.renewsOn!.getTime()).toBeGreaterThan(Date.now());
    expect(await db.auditLog.count({ where: { action: "subscription.plan_chosen", actorId: admin.id } })).toBeGreaterThan(0);
  });

  it("refuses a plan smaller than the number of active users", async () => {
    const g = await groupId(db, Role.VIEWER);
    for (let i = 0; i < 6; i++) await db.user.create({ data: { name: "Seat", email: `${uid("seat")}@t.local`, passwordHash: "x", groupId: g } });
    process.env.SEAT_LIMITS = "";
    await expect(choosePlan(db, admin, "STARTER")).rejects.toThrow(/allows 5 active users/);
  });

  it("blocks adding users beyond the limit, and after the trial ends", async () => {
    expect(seatProblem({ status: "trial", plan: null, activeUsers: 9, userLimit: 10 })).toBeNull();
    expect(seatProblem({ status: "active", plan: PLANS[0], activeUsers: 5, userLimit: 5 })).toMatch(/Starter plan allows 5.*Upgrade to Team/);
    expect(seatProblem({ status: "active", plan: PLANS[1], activeUsers: 10, userLimit: 10 })).toMatch(/Deactivate a user first/);
    expect(seatProblem({ status: "expired", plan: null, activeUsers: 1, userLimit: 10 })).toMatch(/trial has ended/);

    // Enforced for real on createUser: fill the trial's 10 seats, then one more is refused
    const g = await groupId(db, Role.VIEWER);
    const { activeUsers } = await getSubscription(db);
    for (let i = activeUsers; i < 10; i++) await db.user.create({ data: { name: "Seat", email: `${uid("fill")}@t.local`, passwordHash: "x", groupId: g } });
    process.env.SEAT_LIMITS = "";
    await expect(assertUserSeat(db)).rejects.toThrow(/allows 10 active users/);
    await expect(createUser(db, admin, { name: "Over", email: `${uid("over")}@t.local`, groupId: g, password: "Over-limit-123" }))
      .rejects.toThrow(/active users and all are in use/);
  });

  it("a fresh install shows exactly 14 days left (trial end stored in UTC)", async () => {
    await db.$executeRawUnsafe(`UPDATE "CompanySettings" SET "trialEndsAt" = DEFAULT WHERE id = 1`);
    const s = await getSubscription(db);
    expect(s.trialDaysLeft).toBe(TRIAL_DAYS);
    expect(Math.abs(s.trialEndsAt.getTime() - (Date.now() + TRIAL_DAYS * DAY))).toBeLessThan(60_000); // UTC, not shifted by the PC's time zone
  });
});
