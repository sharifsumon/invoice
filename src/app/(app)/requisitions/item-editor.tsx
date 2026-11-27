"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

export interface ItemRow { description: string; quantity: string; unit: string; unitPrice: string }

/** Requested items with an optional estimated price; the server recomputes the estimate. */
export function ItemEditor({ initial, currency }: { initial: ItemRow[]; currency: string }) {
  const blank: ItemRow = { description: "", quantity: "1", unit: "", unitPrice: "" };
  const [rows, setRows] = useState<ItemRow[]>(initial.length ? initial : [blank]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const amount = (r: ItemRow) => r2((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0));
  const total = r2(rows.reduce((a, r) => a + amount(r), 0));
  const set = (i: number, k: keyof ItemRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-3">
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <div className="rounded-lg border border-slate-200">
        <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-500 xl:grid">
          <span className="col-span-5">Item</span><span className="col-span-2 text-right">Qty</span><span className="col-span-1">Unit</span>
          <span className="col-span-2 text-right">Est. unit price</span><span className="col-span-2 text-right">Est. amount</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
            <input aria-label="Item" value={r.description} onChange={(e) => set(i, "description", e.target.value)} className={`${inputClass} col-span-12 xl:col-span-5`} placeholder="What do you need? e.g. Laptop, 16 GB RAM" />
            <input aria-label="Quantity" value={r.quantity} inputMode="decimal" onChange={(e) => set(i, "quantity", e.target.value)} className={`${inputClass} col-span-3 text-right xl:col-span-2`} />
            <input aria-label="Unit" value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} className={`${inputClass} col-span-3 xl:col-span-1`} placeholder="pcs" />
            <input aria-label="Estimated unit price" value={r.unitPrice} inputMode="decimal" onChange={(e) => set(i, "unitPrice", e.target.value)} className={`${inputClass} col-span-3 text-right xl:col-span-2`} placeholder="Optional" />
            <span className="col-span-3 flex items-center justify-end gap-2 text-sm tabular xl:col-span-2">
              {amount(r).toFixed(2)}
              {rows.length > 1 && <button type="button" aria-label="Remove item" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-rose-500">×</button>}
            </span>
          </div>
        ))}
        <div className="border-t border-slate-100 px-3 py-2">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setRows((rs) => [...rs, blank])}>+ Add item</button>
        </div>
      </div>
      <div className="ml-auto flex max-w-sm justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
        <span>Estimated total ({currency})</span><span className="tabular">{total.toFixed(2)}</span>
      </div>
    </div>
  );
}
