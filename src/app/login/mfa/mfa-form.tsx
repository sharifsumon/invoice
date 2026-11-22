"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { verifyMfa } from "../actions";

export function MfaForm() {
  const [state, action] = useActionState(verifyMfa, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Authentication code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus
          className="text-center text-lg tracking-[0.4em]" />
      </Field>
      <SubmitButton className="w-full" pendingText="Verifying…">Verify</SubmitButton>
    </form>
  );
}
