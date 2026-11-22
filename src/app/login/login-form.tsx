"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { login } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState(login, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
