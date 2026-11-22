import QRCode from "qrcode";
import { requireUser } from "@/server/auth";
import { ROLE_LABELS } from "@/server/core/permissions";
import { PASSWORD_RULE } from "@/server/core/settings";
import { otpauthUrl } from "@/server/core/totp";
import { prisma } from "@/server/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, buttonClass, Card, DL, Field, Input, PageHeader } from "@/components/ui";
import { beginMfaAction, changePasswordAction, confirmMfaAction, disableMfaAction, signOutEverywhereAction } from "./actions";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const me = await requireUser();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  const pending = !u.mfaEnabled && u.mfaSecret;
  const qr = pending ? await QRCode.toDataURL(otpauthUrl(u.mfaSecret!, u.email), { margin: 1, width: 200 }) : null;

  return (
    <>
      <PageHeader title="My account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <DL items={[["Name", u.name], ["Email", u.email], ["Role", ROLE_LABELS[u.role]],
            ["Last sign-in", u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"]]} />
          <form action={signOutEverywhereAction} className="mt-5">
            <button className={buttonClass("secondary", "sm")}>Sign out of all devices</button>
          </form>
        </Card>

        <Card title={<span className="flex items-center gap-2">Two-factor authentication {u.mfaEnabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</span>}>
          {u.mfaEnabled ? (
            <ActionForm action={disableMfaAction} className="space-y-3">
              <p className="text-sm text-slate-500">Sign-in requires a code from your authenticator app. To turn this off, confirm your password and a current code.</p>
              <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
              <Field label="Current code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} /></Field>
              <SubmitButton variant="danger" size="sm">Turn off two-factor</SubmitButton>
            </ActionForm>
          ) : pending ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">1. Scan this with Google Authenticator, Microsoft Authenticator, Authy or 1Password.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr!} alt="Authenticator QR code" width={200} height={200} className="rounded-lg border border-slate-200" />
              <p className="text-xs text-slate-500">Can&apos;t scan? Enter this key manually: <code className="break-all rounded bg-slate-100 px-1">{u.mfaSecret}</code></p>
              <ActionForm action={confirmMfaAction} className="space-y-3">
                <Field label="2. Enter the 6-digit code shown in the app"><Input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} /></Field>
                <SubmitButton size="sm">Confirm and turn on</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={beginMfaAction} className="space-y-3">
              <p className="text-sm text-slate-500">Add a second step at sign-in using an authenticator app. Recommended for Administrator and Finance accounts.</p>
              <SubmitButton size="sm">Set up two-factor</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title="Change password">
          <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
            <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
            <Field label="New password" hint={PASSWORD_RULE}><Input name="next" type="password" required autoComplete="new-password" /></Field>
            <Field label="Confirm new password"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
            <SubmitButton size="sm">Change password</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
