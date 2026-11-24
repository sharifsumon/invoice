import { Prisma } from "@/generated/prisma/client";
import { RuleError } from "./permissions";

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

/** Parse user/DB input into a Decimal. Rejects NaN/Infinity and non-numeric strings. */
export function dec(v: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new D(0);
  const d = new D(typeof v === "string" ? v.trim().replace(/,/g, "") : v);
  if (!d.isFinite()) throw new Error("Invalid number");
  return d;
}

/** Round to 2 dp, half-up (deterministic). */
export function money(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((a, b) => a.plus(b), new D(0));
}

/**
 * BRD section 5.4: split a PO value across milestone percentages.
 * Each milestone = round_half_up(value * pct / 100); the rounding residual goes to the
 * final milestone so the amounts always add up to the PO value exactly.
 * Throws if percentages don't total exactly 100.
 */
export function allocateMilestones(poValue: Prisma.Decimal, percentages: Prisma.Decimal[]): Prisma.Decimal[] {
  if (percentages.length === 0) throw new RuleError("At least one milestone is required");
  for (const p of percentages) {
    if (p.lte(0) || p.gt(100)) throw new RuleError("Each milestone percentage must be greater than 0 and at most 100");
  }
  const total = sum(percentages);
  if (!total.eq(100)) throw new RuleError(`Milestone percentages must total exactly 100% (currently ${total.toString()}%)`);

  const amounts = percentages.map((p) => money(poValue.times(p).dividedBy(100)));
  const allocated = sum(amounts.slice(0, -1));
  amounts[amounts.length - 1] = poValue.minus(allocated);
  if (amounts[amounts.length - 1].lt(0)) throw new RuleError("Milestone allocation exceeds PO value");
  return amounts;
}

export function formatMoney(v: Prisma.Decimal | string | number, currency: string): string {
  const d = typeof v === "object" ? v : dec(v);
  const [int, frac] = d.toFixed(2).split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${neg ? "-" : ""}${grouped}.${frac}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

function intToWords(n: bigint): string {
  if (n === BigInt(0)) return "Zero";
  const scales = ["", " Thousand", " Million", " Billion", " Trillion"];
  const out: string[] = [];
  let i = 0;
  while (n > BigInt(0)) {
    const chunk = Number(n % BigInt(1000));
    if (chunk) out.unshift(below1000(chunk) + scales[i]);
    n /= BigInt(1000);
    i++;
  }
  return out.join(" ");
}

export function amountInWords(v: Prisma.Decimal, currency: string): string {
  const [i, f] = v.abs().toFixed(2).split(".");
  const cents = Number(f);
  return `${currency} ${intToWords(BigInt(i))}${cents ? ` and ${f}/100` : ""} Only`;
}

export interface OutstandingParts { total: Prisma.Decimal; amountPaid: Prisma.Decimal; balanceMoved?: Prisma.Decimal | null }
/** What is still owed on an invoice: total − paid − any balance carried forward to a balance invoice. */
export function outstandingOf(inv: OutstandingParts): Prisma.Decimal {
  const v = inv.total.minus(inv.amountPaid).minus(inv.balanceMoved ?? 0);
  return v.lt(0) ? new D(0) : v;
}