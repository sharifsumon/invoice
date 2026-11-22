import { ClientStatus } from "@/generated/prisma/enums";
import type { Client } from "@/generated/prisma/client";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, labelize, Select, Textarea } from "@/components/ui";

export function ClientForm({ action, client, withContact, submitLabel = "Save" }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>; client?: Client; withContact?: boolean; submitLabel?: string;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company / client name *"><Input name="name" required defaultValue={client?.name} /></Field>
        <Field label="Legal name"><Input name="legalName" defaultValue={client?.legalName ?? ""} /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={client?.status ?? ClientStatus.COMMUNICATED}>
            {Object.values(ClientStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
        </Field>
        <Field label="Industry"><Input name="industry" defaultValue={client?.industry ?? ""} /></Field>
        <Field label="General email"><Input name="email" type="email" defaultValue={client?.email ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={client?.phone ?? ""} /></Field>
        <Field label="Website"><Input name="website" defaultValue={client?.website ?? ""} /></Field>
        <Field label="Tax / VAT ID"><Input name="taxId" defaultValue={client?.taxId ?? ""} /></Field>
        <Field label="Country"><Input name="country" defaultValue={client?.country ?? ""} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" defaultValue={client?.address ?? ""} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" defaultValue={client?.remarks ?? ""} /></Field>
      </div>
      {withContact && (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-xs font-medium text-slate-600">Primary contact (optional)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input name="contactName" /></Field>
            <Field label="Designation"><Input name="contactDesignation" /></Field>
            <Field label="Email"><Input name="contactEmail" type="email" /></Field>
            <Field label="Phone"><Input name="contactPhone" /></Field>
          </div>
        </fieldset>
      )}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
