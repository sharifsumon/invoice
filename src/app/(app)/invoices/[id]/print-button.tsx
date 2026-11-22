"use client";

import { buttonClass } from "@/components/ui";

/** Prints the stored PDF itself (not the web page), via a hidden iframe. */
export function PrintButton({ url }: { url: string }) {
  return (
    <button type="button" className={buttonClass("secondary")}
      onClick={() => {
        const f = document.createElement("iframe");
        f.style.position = "fixed"; f.style.width = "0"; f.style.height = "0"; f.style.border = "0";
        f.src = url;
        f.onload = () => { setTimeout(() => { f.contentWindow?.focus(); f.contentWindow?.print(); }, 300); };
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 60_000);
      }}>
      Print
    </button>
  );
}
