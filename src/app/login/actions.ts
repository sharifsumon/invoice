"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createMfaChallenge, createSession, destroySession, readMfaChallenge } from "@/server/auth";
import { prisma } from "@/server/db";
import { verifyTotp } from "@/server/core/totp";
import type { ActionState } from "@/server/action";

// In-memory throttle (single server): 8 failures per key per 15 minutes. Use a shared store if you run several instances.
const failures = new Map<string, { n: number; until: number }>();
const blocked = (k: string) => { const f = failures.get(k); return !!f && f.n >= 8 && f.until > Date.now(); };
const fail = (k: string) => {
  const f = failures.get(k);
  const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + 15 * 60_000 };
  failures.set(k, { n: cur.n + 1, until: cur.until });
};
// Equalizes timing between "unknown email" and "wrong password" so accounts can't be enumerated.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-password", 12);

async function finishLogin(userId: string, sv: number) {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await createSession(userId, sv);
  await prisma.auditLog.create({ data: { actorId: userId, action: "auth.login", entityType: "User", entityId: userId } });
}

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (blocked(`pw:${email}`)) return { error: "Too many failed attempts. Try again in a few minutes." };

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) {
    fail(`pw:${email}`);
    if (user) await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.login_failed", entityType: "User", entityId: user.id } });
    return { error: "Invalid email or password." };
  }
  failures.delete(`pw:${email}`);
  if (user.mfaEnabled && user.mfaSecret) {
    await createMfaChallenge(user.id, user.sessionVersion);
    redirect("/login/mfa");
  }
  await finishLogin(user.id, user.sessionVersion);
  redirect("/");
}

export async function verifyMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const ch = await readMfaChallenge();
  if (!ch) redirect("/login");
  if (blocked(`mfa:${ch.userId}`)) return { error: "Too many invalid codes. Sign in again in a few minutes." };
  const user = await prisma.user.findUnique({ where: { id: ch.userId } });
  if (!user?.active || !user.mfaEnabled || !user.mfaSecret || user.sessionVersion !== ch.sv) redirect("/login");
  if (!verifyTotp(user.mfaSecret, String(fd.get("code") ?? ""))) {
    fail(`mfa:${ch.userId}`);
    await prisma.auditLog.create({ data: { actorId: user.id, action: "auth.mfa_failed", entityType: "User", entityId: user.id } });
    return { error: "That code is not valid. Enter the current 6-digit code from your authenticator app." };
  }
  failures.delete(`mfa:${ch.userId}`);
  await finishLogin(user.id, user.sessionVersion);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
