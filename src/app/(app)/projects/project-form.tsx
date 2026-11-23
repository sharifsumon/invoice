import type { Project } from "@/generated/prisma/client";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, isoDate, Select, Textarea } from "@/components/ui";

export function ProjectForm({ action, project, clients, managers, defaultClientId, defaultCurrency, submitLabel = "Save", isNew }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  project?: Project;
  clients: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  defaultClientId?: string;
  defaultCurrency: string;
  submitLabel?: string;
  isNew?: boolean;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project code *"><Input name="code" required defaultValue={project?.code} placeholder="e.g. ACME-WEB-01" /></Field>
        <Field label="Project name *"><Input name="name" required defaultValue={project?.name} /></Field>
        <Field label="Client *">
          <Select name="clientId" required defaultValue={project?.clientId ?? defaultClientId ?? ""}>
            <option value="" disabled>Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Project manager">
          <Select name="managerId" defaultValue={project?.managerId ?? ""}>
            <option value="">— None —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Project value *" hint="Counts toward Business Value once the project is In Progress.">
          <Input name="value" required inputMode="decimal" defaultValue={project?.value.toString()} placeholder="0.00" />
        </Field>
        <Field label="Currency" hint={project ? "Fixed when the project was created." : "Company currency — change it in Settings."}>
          <Input value={project?.currency ?? defaultCurrency} disabled readOnly />
        </Field>
        <Field label="Start date"><Input name="startDate" type="date" defaultValue={isoDate(project?.startDate)} /></Field>
        <Field label="Planned end date"><Input name="plannedEndDate" type="date" defaultValue={isoDate(project?.plannedEndDate)} /></Field>
        {!isNew && <Field label="Actual end date"><Input name="actualEndDate" type="date" defaultValue={isoDate(project?.actualEndDate)} /></Field>}
        {isNew && (
          <Field label="Status" hint="New projects start as Draft. Change the status from the project page.">
            <Input value="Draft" disabled readOnly />
          </Field>
        )}
        <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={project?.description ?? ""} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" defaultValue={project?.remarks ?? ""} /></Field>
        {project?.approved && (
          <Field label="Reason for change" className="sm:col-span-2" hint="Required if you change the value of an approved project — it is recorded in the audit log.">
            <Input name="reason" />
          </Field>
        )}
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
