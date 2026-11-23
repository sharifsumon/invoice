"use client";

import { useActionState, useState } from "react";
import { SubmitButton, type ActionState } from "@/components/forms";
import { buttonClass, cx, inputClass, labelize } from "@/components/ui";

/** Project status as a dropdown; changing it reveals Update (and an approval date when the project starts). */
export function StatusSelect({ action, current, options, approvesOn }: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  current: string;
  options: { value: string; allowed: boolean }[];
  /** Statuses that start (approve) this project — ask for the approval date. */
  approvesOn: string[];
}) {
  const [state, formAction] = useActionState(action, null);
  const [value, setValue] = useState(current);
  const changed = value !== current;
  const starts = changed && approvesOn.includes(value);
  return (
    <form action={formAction} className="space-y-3"
      onSubmit={(e) => {
        if (value === "CANCELLED" && !window.confirm("Cancel this project? It will no longer count toward Business Value.")) e.preventDefault();
      }}>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Status</span>
        <select name="status" value={value} onChange={(e) => setValue(e.target.value)} className={cx(inputClass, "pr-8")}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={!o.allowed && o.value !== current}>{labelize(o.value)}</option>
          ))}
        </select>
      </label>
      {starts && (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Approval date</span>
          <input type="date" name="approvalDate" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
          <span className="mt-1.5 block text-xs text-slate-500">Starting the project approves it; its value counts toward Business Value from this date.</span>
        </label>
      )}
      {changed && (
        <div className="flex gap-2">
          <SubmitButton variant={value === "CANCELLED" ? "danger" : "primary"} pendingText="Updating…">Update status</SubmitButton>
          <button type="button" className={buttonClass("ghost")} onClick={() => setValue(current)}>Reset</button>
        </div>
      )}
      {state?.error && <p role="alert" className="text-sm text-rose-600">{state.error}</p>}
    </form>
  );
}
