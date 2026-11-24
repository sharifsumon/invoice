import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { audit, inTx, parseDate, type Actor, type Db } from "./common";
import { dec, money } from "./money";
import { can, ForbiddenError, RuleError } from "./permissions";

/**
 * BR-12: currencies are only combined through an explicit reporting currency and a recorded rate.
 * A rate row means: 1 unit of `fromCurrency` = `rate` units of `toCurrency`, effective from `effectiveDate`.
 * Lookup uses the latest rate effective on or before the row's own date; the inverse pair is used if
 * only the opposite direction is recorded. No rate → the amount is not converted (and is reported as such).
 */
export interface RateBook {
  convert(amount: Prisma.Decimal, from: string, to: string, on: Date): { value: Prisma.Decimal; rate: Prisma.Decimal; effective: Date | null } | null;
}

export async function loadRateBook(db: Db, to: string): Promise<RateBook> {
  const rows = await db.exchangeRate.findMany({
    where: { OR: [{ toCurrency: to }, { fromCurrency: to }] },
    orderBy: { effectiveDate: "desc" },
  });
  return {
    convert(amount, from, target, on) {
      if (from === target) return { value: amount, rate: dec(1), effective: null };
      for (const r of rows) {
        if (r.effectiveDate > on) continue;
        if (r.fromCurrency === from && r.toCurrency === target) {
          return { value: money(amount.times(r.rate)), rate: r.rate, effective: r.effectiveDate };
        }
        if (r.fromCurrency === target && r.toCurrency === from) {
          const inv = dec(1).dividedBy(r.rate);
          return { value: money(amount.times(inv)), rate: inv.toDecimalPlaces(8), effective: r.effectiveDate };
        }
      }
      return null;
    },
  };
}

export const rateInput = z.object({
  fromCurrency: z.string().trim().length(3, "Use 3-letter codes").transform((v) => v.toUpperCase()),
  toCurrency: z.string().trim().length(3, "Use 3-letter codes").transform((v) => v.toUpperCase()),
  rate: z.string().min(1, "Rate is required"),
  effectiveDate: z.string().min(1, "Effective date is required"),
  source: z.string().trim().max(200).optional(),
});

export async function addRate(db: Db, actor: Actor, raw: z.input<typeof rateInput>) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  const d = rateInput.parse(raw);
  if (d.fromCurrency === d.toCurrency) throw new RuleError("From and to currencies must differ");
  let rate;
  try { rate = dec(d.rate).toDecimalPlaces(8); } catch { throw new RuleError("Rate must be a number"); }
  if (rate.lte(0)) throw new RuleError("Rate must be greater than zero");
  return inTx(db, async (tx) => {
    const r = await tx.exchangeRate.create({
      data: { fromCurrency: d.fromCurrency, toCurrency: d.toCurrency, rate, effectiveDate: parseDate(d.effectiveDate)!, source: d.source || null },
    });
    await audit(tx, actor, "fx.rate_added", "ExchangeRate", r.id, { after: r });
    return r;
  });
}

export async function deleteRate(db: Db, actor: Actor, id: string) {
  if (!can(actor, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  return inTx(db, async (tx) => {
    const r = await tx.exchangeRate.delete({ where: { id } });
    await audit(tx, actor, "fx.rate_deleted", "ExchangeRate", id, { before: r });
  });
}
