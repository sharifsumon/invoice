import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";
import { cache } from "react";
import { prisma } from "./db";
import type { Actor } from "./core/common";
import { can, normalizePerms, type Action, type Module } from "./core/permissions";

export const SESSION_COOKIE = "crm_session";
export const MFA_COOKIE = "crm_mfa";
const SESSION_HOURS = 8;
const MFA_MINUTES = 5;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge,
});

/** Session token carries the user's sessionVersion; bumping it in the DB revokes every outstanding session. */
export async function createSession(userId: string, sessionVersion: number) {
  const token = await new SignJWT({ sub: userId, sv: sessionVersion, typ: "session" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${SESSION_HOURS}h`).sign(key());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOpts(SESSION_HOURS * 3600));
  jar.delete(MFA_COOKIE);
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(MFA_COOKIE);
}

/** Password verified, second factor pending: short-lived token that only the MFA step accepts. */
export async function createMfaChallenge(userId: string, sessionVersion: number) {
  const token = await new SignJWT({ sub: userId, sv: sessionVersion, typ: "mfa" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MFA_MINUTES}m`).sign(key());
  (await cookies()).set(MFA_COOKIE, token, cookieOpts(MFA_MINUTES * 60));
}

export async function readMfaChallenge(): Promise<{ userId: string; sv: number } | null> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.typ !== "mfa") return null;
    return { userId: String(payload.sub), sv: Number(payload.sv) };
  } catch {
    return null;
  }
}

/** Current user (verified token, active account, current session version), memoized per request. */
export const getUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.typ !== "session") return null;
    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: {
        id: true, name: true, email: true, active: true, sessionVersion: true, mfaEnabled: true,
        group: { select: { id: true, name: true, permissions: true } },
      },
    });
    if (!user?.active || user.sessionVersion !== Number(payload.sv)) return null;
    const { group, ...rest } = user;
    return { ...rest, groupId: group.id, groupName: group.name, perms: normalizePerms(group.permissions) };
  } catch {
    return null;
  }
});

export type SessionUser = Actor & { email: string; mfaEnabled: boolean };

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return { id: u.id, name: u.name, groupId: u.groupId, groupName: u.groupName, perms: u.perms, email: u.email, mfaEnabled: u.mfaEnabled };
}

/** Page-level guard: send users without the permission back to the dashboard. */
export async function requirePermission(module: Module, action: Action = "view") {
  const u = await requireUser();
  if (!can(u, module, action)) redirect("/?denied=1");
  return u;
}
