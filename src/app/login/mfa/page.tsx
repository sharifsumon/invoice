import { redirect } from "next/navigation";
import { readMfaChallenge } from "@/server/auth";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-factor verification" };

export default async function MfaPage() {
  if (!(await readMfaChallenge())) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold">Two-factor verification</h1>
          <p className="text-sm text-slate-500">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><MfaForm /></div>
        <p className="mt-4 text-center text-xs text-slate-400">Lost your device? Ask an administrator to reset two-factor for your account.</p>
      </div>
    </main>
  );
}
