"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

export interface MilestoneRow { name: string; percentage: string; expectedDate: string; notes: string }

const labelCls = "mb-1.5 block text-xs font-medium text-slate-600";

/** Preview only — the server re-computes amounts with decimal arithmetic on save and approval. */
function cents(value: string, pct: string) {
  const v = Number(value), p = Number(pct);
  if (!isFinite(v) || !isFinite(p)) return null;
  return Math.round(v * p) / 100;
}

export function MilestoneEditor({ initial, defaultValue, currency }: { initial: MilestoneRow[]; defaultValue: string; currency: string }) {
  const [rows, setRows] = useState<MilestoneRow[]>(initial);
  const [value, setValue] = useState(defaultValue);
  const total = rows.reduce((a, r) => a + (Number(r.percentage) || 0), 0);
  const totalRounded = Math.round(total * 10000) / 10000;
  const ok = rows.length === 0 || totalRounded === 100;
  const set = (i: number, k: keyof MilestoneRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">PO value * <span className="text-slate-400">({currency})</span></span>
        <input name="value" required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} placeholder="0.00" />
      </label>
      <input type="hidden" name="milestones" value={JSON.stringify(rows)} />
      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-xs font-medium text-slate-600">Payment milestones</span>
          <span className={`text-xs font-medium ${ok ? "text-brand-600" : "text-lime-ink"}`}>
            Total {totalRounded}% {rows.length > 0 && !ok && "— must equal 100%"}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const amt = cents(value, r.percentage);
            return (
              <div key={i} className="grid grid-cols-12 items-end gap-3 px-3 py-3">
                <label className="col-span-12 lg:col-span-5">
                  <span className={labelCls}>Milestone name</span>
                  <input aria-label={`Milestone ${i + 1} name`} placeholder={`e.g. Milestone ${i + 1}`} value={r.name} onChange={(e) => set(i, "name", e.target.value)} className={inputClass} />
                </label>
                <label className="col-span-4 lg:col-span-2">
                  <span className={labelCls}>Percentage</span>
                  <span className="relative block">
                    <input aria-label={`Milestone ${i + 1} percentage`} placeholder="0" inputMode="decimal" value={r.percentage} onChange={(e) => set(i, "percentage", e.target.value)} className={`${inputClass} pr-8`} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500" aria-hidden>%</span>
                  </span>
                </label>
                <label className="col-span-8 lg:col-span-3">
                  <span className={labelCls}>Due date</span>
                  <input aria-label={`Milestone ${i + 1} due date`} type="date" value={r.expectedDate} onChange={(e) => set(i, "expectedDate", e.target.value)} className={inputClass} />
                </label>
                <div className="col-span-12 flex items-end justify-between gap-3 lg:col-span-2">
                  <div>
                    <span className={labelCls}>Amount</span>
                    <span className="tabular block py-2 text-sm font-medium text-slate-800">{amt !== null ? amt.toFixed(2) : "—"}</span>
                  </div>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove milestone ${i + 1}`}
                    className="mb-2 text-xs font-medium text-rose-600 hover:underline">Remove</button>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="px-3 py-4 text-xs text-slate-400">No milestones. Without a milestone plan, invoices are raised manually.</div>}
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-3 py-2">
          <button type="button" className={buttonClass("secondary", "sm")}
            onClick={() => setRows((rs) => [...rs, { name: "", percentage: rs.length ? String(Math.max(0, Math.round((100 - total) * 10000) / 10000)) : "100", expectedDate: "", notes: "" }])}>
            + Add milestone
          </button>
          {rows.length > 1 && (
            <button type="button" className={buttonClass("ghost", "sm")}
              onClick={() => { const each = Math.floor((100 / rows.length) * 100) / 100; setRows((rs) => rs.map((r, i) => ({ ...r, percentage: String(i === rs.length - 1 ? Math.round((100 - each * (rs.length - 1)) * 100) / 100 : each) }))); }}>
              Split evenly
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400">Percentages must total 100%. Saving creates one invoice per milestone, pending approval until the PO is approved. Amounts shown are a preview. On approval they are recalculated exactly, with any rounding difference placed on the last milestone.</p>
    </div>
  );
}
