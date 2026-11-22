import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account to continue."
      footer="Forgot your password? Ask an administrator to reset it from the Users page.">
      <LoginForm />
    </AuthShell>
  );
}
