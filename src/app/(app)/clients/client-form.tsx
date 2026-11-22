import { ClientStatus } from "@/generated/prisma/enums";
import type { Client } from "@/generated/prisma/client";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, labelize, Select, Textarea } from "@/components/ui";

/** Browser-side hint matching the server rule: optional +, then digits/spaces/()-. */
export const PHONE_PATTERN = "\\+?[0-9\\s().\\-]{6,}";

export function ClientForm({ action, client, withContact, submitLabel = "Save" }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>; client?: Client; withContact?: boolean; submitLabel?: string;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company / client name *"><Input name="name" required defaultValue={client?.name} /></Field>
        <Field label="Legal name"><Input name="legalName" defaultValue={client?.legalName ?? ""} /></Field>
        <Field label="Status *">
          <Select name="status" required defaultValue={client?.status ?? ""}>
            <option value="" disabled>Select a status…</option>
            {Object.values(ClientStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
        </Field>
        <Field label="Country *"><Input name="country" required defaultValue={client?.country ?? ""} /></Field>
        <Field label="Industry"><Input name="industry" defaultValue={client?.industry ?? ""} /></Field>
        <Field label="General email"><Input name="email" type="email" defaultValue={client?.email ?? ""} /></Field>
        <Field label="General phone"><Input name="phone" defaultValue={client?.phone ?? ""} /></Field>
        <Field label="Website"><Input name="website" defaultValue={client?.website ?? ""} /></Field>
        <Field label="Tax / VAT ID"><Input name="taxId" defaultValue={client?.taxId ?? ""} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" defaultValue={client?.address ?? ""} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" defaultValue={client?.remarks ?? ""} /></Field>
      </div>
      {withContact && (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-xs font-medium text-slate-600">Primary contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name *"><Input name="contactFirstName" required autoComplete="off" /></Field>
            <Field label="Last name *"><Input name="contactLastName" required autoComplete="off" /></Field>
            <Field label="Email *"><Input name="contactEmail" type="email" required autoComplete="off" /></Field>
            <Field label="Phone *" hint="e.g. +44 20 7946 0000"><Input name="contactPhone" type="tel" required pattern={PHONE_PATTERN} autoComplete="off" /></Field>
            <Field label="Designation"><Input name="contactDesignation" /></Field>
          </div>
        </fieldset>
      )}
      <p className="text-xs text-slate-400">* Required</p>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
