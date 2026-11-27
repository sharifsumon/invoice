import Link from "next/link";
import { RequisitionPriority } from "@/generated/prisma/enums";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, labelize, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/server/action";
import { ItemEditor, type ItemRow } from "./item-editor";

export interface RequisitionDefaults {
  title?: string; departmentId?: string | null; priority?: string; neededBy?: string;
  deliverTo?: string | null; purpose?: string | null; items?: ItemRow[];
}

export function RequisitionForm({ action, defaults = {}, departments, currency, canManageDepartments }: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: RequisitionDefaults; departments: { id: string; name: string; active: boolean }[]; currency: string;
  canManageDepartments?: boolean;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Title *" className="sm:col-span-3">
          <Input name="title" required maxLength={200} defaultValue={defaults.title ?? ""} placeholder="e.g. Laptops for the new design team" />
        </Field>
        <Field label="Department"
          hint={departments.length === 0
            ? (canManageDepartments ? <>No departments yet. <Link href="/departments" className="font-medium text-brand-700 underline underline-offset-2">Add departments</Link></> : "No departments have been set up yet.")
            : undefined}>
          <Select name="departmentId" defaultValue={defaults.departmentId ?? ""}>
            <option value="">— Select department —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.active ? "" : " (inactive)"}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue={defaults.priority ?? "NORMAL"}>
            {Object.values(RequisitionPriority).map((p) => <option key={p} value={p}>{labelize(p)}</option>)}
          </Select>
        </Field>
        <Field label="Needed by"><Input type="date" name="neededBy" defaultValue={defaults.neededBy ?? ""} /></Field>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Items *</div>
        <ItemEditor initial={defaults.items ?? []} currency={currency} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purpose / justification"><Textarea name="purpose" defaultValue={defaults.purpose ?? ""} placeholder="Why is this needed?" /></Field>
        <Field label="Deliver to"><Textarea name="deliverTo" defaultValue={defaults.deliverTo ?? ""} placeholder="Location or person" /></Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="submit" pendingText="Submitting…">Submit for approval</SubmitButton>
        <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…">Save as draft</SubmitButton>
      </div>
    </ActionForm>
  );
}
