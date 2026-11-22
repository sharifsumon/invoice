import type { PaymentMilestone, PurchaseOrder } from "@/generated/prisma/client";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, isoDate, Select, Textarea } from "@/components/ui";
import { MilestoneEditor } from "./milestone-editor";

export function POForm({ action, po, projects, defaultProjectId, submitLabel = "Save" }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  po?: PurchaseOrder & { milestones: PaymentMilestone[] };
  projects: { id: string; code: string; name: string; currency: string; client: { name: string } }[];
  defaultProjectId?: string;
  submitLabel?: string;
}) {
  const projectId = po?.projectId ?? defaultProjectId ?? "";
  const currency = po?.currency ?? projects.find((p) => p.id === projectId)?.currency ?? "";
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PO number *"><Input name="poNumber" required defaultValue={po?.poNumber} /></Field>
        <Field label="PO date *"><Input name="poDate" type="date" required defaultValue={isoDate(po?.poDate) || new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Project *" className="sm:col-span-2" hint="The PO's client is taken from the project.">
          <Select name="projectId" required defaultValue={projectId}>
            <option value="" disabled>Select a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.client.name}, {p.currency})</option>)}
          </Select>
        </Field>
        <Field label="Currency" hint="Defaults to the project currency."><Input name="currency" maxLength={3} defaultValue={currency} className="uppercase" /></Field>
        <Field label="Payment terms"><Input name="paymentTerms" defaultValue={po?.paymentTerms ?? ""} placeholder="e.g. Net 30" /></Field>
        <Field label="Client reference" className="sm:col-span-2"><Input name="reference" defaultValue={po?.reference ?? ""} /></Field>
        <div className="sm:col-span-2">
          <MilestoneEditor defaultValue={po?.value.toString() ?? ""} currency={currency || "—"}
            initial={(po?.milestones ?? []).sort((a, b) => a.sequence - b.sequence).map((m) => ({
              name: m.name, percentage: m.percentage.toString(), expectedDate: isoDate(m.expectedDate), notes: m.notes ?? "",
            }))} />
        </div>
        <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" defaultValue={po?.remarks ?? ""} /></Field>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
