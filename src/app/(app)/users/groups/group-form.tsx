import { ACTION_LABELS, MODULES, type Action, type Perms } from "@/server/core/permissions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import type { ActionState } from "@/server/action";

const MAIN: Action[] = ["view", "create", "edit", "delete"];

function Box({ module, action, perms, label, hint }: { module: string; action: Action; perms: Perms; label?: string; hint?: string }) {
  const checked = perms[module as keyof Perms]?.includes(action) ?? false;
  return (
    <label className="inline-flex items-start gap-2 text-sm text-slate-700" title={hint}>
      <input type="checkbox" name={`perm:${module}:${action}`} defaultChecked={checked} className="mt-0.5 h-4 w-4 accent-brand-600"
        aria-label={`${module} — ${label ?? ACTION_LABELS[action]}`} />
      {label && <span>{label}{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>}
    </label>
  );
}

/** Name + description + permission grid (rows = areas; View/Create/Edit/Delete columns; anything else under "Other"). */
export function GroupForm({ action, group, submitLabel }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  group?: { name: string; description: string | null; perms: Perms };
  submitLabel: string;
}) {
  const perms = group?.perms ?? {};
  return (
    <ActionForm action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Group name *"><Input name="name" required maxLength={80} defaultValue={group?.name} placeholder="e.g. Sales team" /></Field>
        <Field label="Description"><Input name="description" maxLength={300} defaultValue={group?.description ?? ""} placeholder="What this group is for" /></Field>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Area</th>
              {MAIN.map((a) => <th key={a} className="px-3 py-3 text-center">{ACTION_LABELS[a]}</th>)}
              <th className="px-4 py-3">Other permissions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MODULES.map((m) => {
              const byKey = new Map(m.actions.map((a) => [a.key, a]));
              const other = m.actions.filter((a) => !MAIN.includes(a.key));
              return (
                <tr key={m.key} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">{m.label}</td>
                  {MAIN.map((a) => {
                    const def = byKey.get(a);
                    return (
                      <td key={a} className="px-3 py-3 text-center">
                        {def ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <Box module={m.key} action={a} perms={perms} hint={def.hint} />
                            {def.hint && <span className="text-[11px] text-slate-400">{def.hint}</span>}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {other.length ? other.map((a) => (
                        <Box key={a.key} module={m.key} action={a.key} perms={perms} label={a.label ?? ACTION_LABELS[a.key]} hint={a.hint} />
                      )) : <span className="text-slate-300">—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Any permission in an area also lets the group <b>view</b> it. &ldquo;Delete&rdquo; never erases records — it archives clients,
        cancels projects, POs and invoices, and deactivates users, so the history stays intact.
      </p>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
