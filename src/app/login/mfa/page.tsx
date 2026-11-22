import { redirect } from "next/navigation";
import { readMfaChallenge } from "@/server/auth";
import { AuthShell } from "../auth-shell";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-factor verification" };

export default async function MfaPage() {
  if (!(await readMfaChallenge())) redirect("/login");
  return (
    <AuthShell title="Two-factor verification" subtitle="Enter the 6-digit code from your authenticator app."
      footer="Lost your device? Ask an administrator to reset two-factor for your account.">
      <MfaForm />
    </AuthShell>
  );
}
