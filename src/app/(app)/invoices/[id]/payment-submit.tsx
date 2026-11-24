"use client";

import { useRef } from "react";
import { SubmitButton } from "@/components/forms";

/**
 * "Record payment" button. If the amount is less than what is outstanding, asks whether to create a new
 * invoice for the rest (a balance invoice). "Cancel" in the dialog = no: the invoice stays Partially Paid.
 */
export function PaymentSubmit({ outstanding, currency, canBalance }: { outstanding: number; currency: string; canBalance: boolean }) {
  const flag = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={flag} type="hidden" name="createBalance" value="0" />
      <span
        onClickCapture={(e) => {
          if (!canBalance || !flag.current) return;
          const form = (e.target as HTMLElement).closest("form");
          const amount = Number((form?.elements.namedItem("amount") as HTMLInputElement | null)?.value ?? "");
          flag.current.value = "0";
          if (!(amount > 0) || amount >= outstanding) return;
          const rest = (Math.round((outstanding - amount) * 100) / 100).toFixed(2);
          flag.current.value = window.confirm(
            `This payment leaves ${currency} ${rest} outstanding.\n\nCreate a new invoice for the outstanding ${currency} ${rest}?\n\n` +
            "OK = create the balance invoice now\nCancel = keep it outstanding on this invoice (you can create it later from the PO)",
          ) ? "1" : "0";
        }}>
        <SubmitButton>Record payment</SubmitButton>
      </span>
    </>
  );
}
