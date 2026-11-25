import { ReceiptText } from "lucide-react";
import { cx } from "./ui";

/** Product name (domain: invoicehub.online). Change it here to rebrand everywhere. */
export const APP_NAME = "InvoiceHub";

/**
 * The InvoiceHub logo: a teal tile with an invoice mark + the wordmark "Invoice" / "Hub" (Hub in the accent colour).
 * `light` is for dark backgrounds.
 */
export function BrandLogo({ light, size = "md", className }: { light?: boolean; size?: "md" | "lg"; className?: string }) {
  const lg = size === "lg";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span className={cx(
        "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-600/30",
        lg ? "h-10 w-10" : "h-9 w-9",
      )}>
        <ReceiptText className={lg ? "h-5 w-5" : "h-[18px] w-[18px]"} strokeWidth={2.2} aria-hidden />
      </span>
      <span className={cx("font-bold tracking-tight", lg ? "text-xl" : "text-[18px]", light ? "text-white" : "text-brand-950")}>
        Invoice<span className={light ? "text-lime-mid" : "text-brand-500"}>Hub</span>
      </span>
    </span>
  );
}
