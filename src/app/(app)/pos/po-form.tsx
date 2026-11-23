import type { PaymentMilestone, PurchaseOrder } from "@/generated/prisma/client";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, isoDate, Select, Textarea } from "@/components/ui";
import { MilestoneEditor } from "./milestone-editor";

export function POForm({ action, po, projects, defaultProjectId, defaultCurrency, submitLabel = "Save", canApprove }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  po?: PurchaseOrder & { milestones: PaymentMilestone[] };
  projects: { id: string; code: string; name: string; currency: string; client: { name: string } }[];
  defaultProjectId?: string;
  /** Company currency from Settings. */
  defaultCurrency: string;
  submitLabel?: string;
  /** New PO only: also offer "Approve" (save and approve in one step). */
  canApprove?: boolean;
}) {
  const projectId = po?.projectId ?? defaultProjectId ?? "";
  const currency = po?.currency ?? projects.find((p) => p.id === projectId)?.currency ?? defaultCurrency;
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PO number *"><Input name="poNumber" required defaultValue={po?.poNumber} /></Field>
        <Field label="PO date *"><Input name="poDate" type="date" required defaultValue={isoDate(po?.poDate) || new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Project *" className="sm:col-span-2" hint="The PO's client is taken from the project.">
          <Select name="projectId" required defaultValue={projectId}>
            <option value="" disabled>Select a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name} ({p.client.name})</option>)}
          </Select>
        </Field>
        <Field label="Client reference" className="sm:col-span-2"><Input name="reference" defaultValue={po?.reference ?? ""} /></Field>
        <div className="sm:col-span-2">
          <MilestoneEditor defaultValue={po?.value.toString() ?? ""} currency={currency}
            initial={(po?.milestones ?? []).sort((a, b) => a.sequence - b.sequence).map((m) => ({
              name: m.name, percentage: m.percentage.toString(), expectedDate: isoDate(m.expectedDate), notes: m.notes ?? "",
            }))} />
        </div>
        <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" defaultValue={po?.remarks ?? ""} /></Field>
      </div>
      {po ? <SubmitButton>{submitLabel}</SubmitButton> : (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…">Save draft</SubmitButton>
          {canApprove && <SubmitButton name="intent" value="approve" pendingText="Approving…">Approve</SubmitButton>}
          <span className="text-xs text-slate-500">
            {canApprove ? "Save draft keeps it waiting for approval; Approve saves and approves it now." : "The PO will wait for approval."}
          </span>
        </div>
      )}
    </ActionForm>
  );
}
