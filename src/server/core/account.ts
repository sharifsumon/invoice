import bcrypt from "bcryptjs";
import { audit, inTx, type Actor, type Db } from "./common";
import { can, ForbiddenError, RuleError } from "./permissions";
import { checkPassword } from "./settings";
import { generateSecret, verifyTotp } from "./totp";

/** Self-service password change. Bumps sessionVersion so every other session is signed out. */
export async function changeOwnPassword(db: Db, actor: Actor, current: string, next: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new RuleError("Current password is incorrect");
  checkPassword(next);
  if (await bcrypt.compare(next, u.passwordHash)) throw new RuleError("New password must be different from the current one");
  return inTx(db, async (tx) => {
    const updated = await tx.user.update({
      where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(next, 12), sessionVersion: { increment: 1 } },
    });
    await audit(tx, actor, "account.password_changed", "User", actor.id);
    return updated.sessionVersion;
  });
}

export async function signOutEverywhere(db: Db, actor: Actor) {
  return inTx(db, async (tx) => {
    const u = await tx.user.update({ where: { id: actor.id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, actor, "account.sessions_revoked", "User", actor.id);
    return u.sessionVersion;
  });
}

/** Step 1 of MFA setup: store a fresh, not-yet-enabled secret. */
export async function beginMfaSetup(db: Db, actor: Actor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (u.mfaEnabled) throw new RuleError("Two-factor authentication is already enabled");
  const secret = generateSecret();
  await db.user.update({ where: { id: actor.id }, data: { mfaSecret: secret } });
  return secret;
}

/** Step 2: confirm with a valid code; only then is MFA enforced at sign-in. */
export async function confirmMfaSetup(db: Db, actor: Actor, code: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!u.mfaSecret) throw new RuleError("Start the setup first");
  if (!verifyTotp(u.mfaSecret, code)) throw new RuleError("That code is not valid. Check your authenticator app's clock and try again.");
  return inTx(db, async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: true, sessionVersion: { increment: 1 } } });
    await audit(tx, actor, "account.mfa_enabled", "User", actor.id);
    return (await tx.user.findUniqueOrThrow({ where: { id: actor.id } })).sessionVersion;
  });
}

export async function disableOwnMfa(db: Db, actor: Actor, password: string, code: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!u.mfaEnabled || !u.mfaSecret) throw new RuleError("Two-factor authentication is not enabled");
  if (!(await bcrypt.compare(password, u.passwordHash))) throw new RuleError("Password is incorrect");
  if (!verifyTotp(u.mfaSecret, code)) throw new RuleError("That code is not valid");
  return inTx(db, async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: false, mfaSecret: null } });
    await audit(tx, actor, "account.mfa_disabled", "User", actor.id);
  });
}

/** Admin recovery when a user loses their authenticator. Signs them out everywhere. */
export async function adminResetMfa(db: Db, actor: Actor, userId: string) {
  if (!can(actor, "users", "edit")) throw new ForbiddenError("users", "edit");
  return inTx(db, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null, sessionVersion: { increment: 1 } } });
    await audit(tx, actor, "user.mfa_reset", "User", userId);
  });
}
