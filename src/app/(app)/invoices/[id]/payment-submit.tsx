"use client";

import { useState } from "react";
import { Field, inputClass } from "@/components/ui";

/**
 * Payment amount (left empty on purpose, so a full payment is never recorded by accident).
 * When the amount is less than what is outstanding, offers — ticked by default — to create a new invoice
 * for the remaining balance (a balance invoice). Unticked: the invoice simply stays Partially Paid.
 */
export function PaymentAmount({ outstanding, currency, canBalance }: { outstanding: number; currency: string; canBalance: boolean }) {
  const [amount, setAmount] = useState("");
  const [carry, setCarry] = useState(true);
  const n = Number(amount.replace(/,/g, ""));
  const partial = amount.trim() !== "" && n > 0 && n < outstanding;
  const rest = partial ? (Math.round((outstanding - n) * 100) / 100).toFixed(2) : "";
  const over = n > outstanding;
  return (
    <div className="space-y-3 sm:col-span-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`Amount received (${currency}) *`} hint={`Outstanding: ${outstanding.toFixed(2)}. Enter less for a partial payment.`}>
          <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={`e.g. ${(outstanding / 2).toFixed(2)}`} className={inputClass} />
        </Field>
        <div className="flex items-end gap-2 pb-1 sm:col-span-2">
          <button type="button" onClick={() => setAmount(outstanding.toFixed(2))}
            className="rounded-lg bg-lime-soft px-3 py-2 text-xs font-medium text-brand-950 hover:bg-lime-mid">Pay full {outstanding.toFixed(2)}</button>
          {partial && <span className="pb-2 text-xs font-medium text-lime-ink">Partial payment — {currency} {rest} will remain</span>}
          {over && <span className="pb-2 text-xs font-medium text-rose-600">More than the outstanding balance</span>}
        </div>
      </div>
      <input type="hidden" name="createBalance" value={partial && canBalance && carry ? "1" : "0"} />
      {partial && canBalance && (
        <label className="flex items-start gap-2.5 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
          <span>
            <b>Create a new invoice for the remaining {currency} {rest}</b>
            <span className="block text-xs text-brand-800/80">
              Untick to keep the balance outstanding on this invoice — you can still create it later from the PO page.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
