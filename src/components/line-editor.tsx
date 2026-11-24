"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "./ui";

export interface LineRow { description: string; quantity: string; unitPrice: string }

/** Line items with live preview totals. The server recomputes everything with decimals. */
export function LineEditor({ initial, remaining, currency, discount: d0 = "", taxRate: t0 = "0", locked, showTax }: {
  initial: LineRow[]; remaining?: string; currency: string; discount?: string; taxRate?: string; locked?: boolean; showTax?: boolean;
}) {
  const [rows, setRows] = useState<LineRow[]>(initial.length ? initial : [{ description: "", quantity: "1", unitPrice: "" }]);
  const [discount, setDiscount] = useState(d0);
  const [taxRate, setTaxRate] = useState(t0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = r2(rows.reduce((a, r) => a + r2((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)), 0));
  const net = r2(subtotal - (Number(discount) || 0));
  const tax = r2(net * (Number(taxRate) || 0) / 100);
  const over = remaining !== undefined && net > Number(remaining) + 1e-9;
  const set = (i: number, k: keyof LineRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="space-y-3">
      {/* Locked (milestone) invoices still send lines: only their descriptions are applied server-side. */}
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div className="rounded-lg border border-slate-200">
        <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-500 xl:grid">
          <span className="col-span-6">Description</span><span className="col-span-2 text-right">Qty</span>
          <span className="col-span-2 text-right">Rate</span><span className="col-span-2 text-right">Amount</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
            <input aria-label="Description" value={r.description} onChange={(e) => set(i, "description", e.target.value)} className={`${inputClass} col-span-12 xl:col-span-6`} placeholder="Description" />
            <input aria-label="Quantity" disabled={locked} value={r.quantity} inputMode="decimal" onChange={(e) => set(i, "quantity", e.target.value)} className={`${inputClass} col-span-4 text-right xl:col-span-2`} />
            <input aria-label="Rate" disabled={locked} value={r.unitPrice} inputMode="decimal" onChange={(e) => set(i, "unitPrice", e.target.value)} className={`${inputClass} col-span-4 text-right xl:col-span-2`} placeholder="0.00" />
            <span className="col-span-4 flex items-center justify-end gap-2 text-sm tabular xl:col-span-2">
              {r2((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)).toFixed(2)}
              {!locked && rows.length > 1 && <button type="button" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-rose-500">×</button>}
            </span>
          </div>
        ))}
        {!locked && (
          <div className="border-t border-slate-100 px-3 py-2">
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setRows((rs) => [...rs, { description: "", quantity: "1", unitPrice: "" }])}>+ Add line</button>
          </div>
        )}
      </div>
      <div className="ml-auto max-w-sm space-y-2 text-sm">
        <Row label="Subtotal" value={subtotal.toFixed(2)} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Discount</span>
          <input name="discount" disabled={locked} value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className={`${inputClass} w-32 text-right`} placeholder="0.00" />
        </div>
        {(showTax || Number(taxRate) > 0) && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">Tax rate %</span>
            <input name="taxRate" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" className={`${inputClass} w-32 text-right`} />
          </div>
        )}
        {!(showTax || Number(taxRate) > 0) && <input type="hidden" name="taxRate" value={taxRate} />}
        {tax > 0 && <Row label="Tax" value={tax.toFixed(2)} />}
        <Row label={`Total (${currency})`} value={(net + tax).toFixed(2)} bold />
        {remaining !== undefined && (
          <div className={`rounded-lg px-3 py-2 text-xs ${over ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>
            Remaining invoiceable PO balance: <b className="tabular">{currency} {Number(remaining).toFixed(2)}</b>
            {over && " — this invoice exceeds it and will be rejected."}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-slate-200 pt-2 font-semibold" : ""}`}>
      <span className={bold ? "" : "text-slate-500"}>{label}</span><span className="tabular">{value}</span>
    </div>
  );
}
