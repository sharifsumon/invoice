import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { loadRateBook } from "@/server/core/fx";
import { dec, formatMoney } from "@/server/core/money";
import { today } from "@/server/core/common";
import { prisma } from "@/server/db";
import { Money } from "./money";

/**
 * A single total in the company currency (Settings → Company currency).
 * Amounts in another currency (older records) are converted with the latest recorded exchange rate;
 * without a rate they are left out and a short note says so — currencies are never silently mixed.
 */
export async function CompanyMoney({ rows, empty = "—" }: { rows: [string, Prisma.Decimal][]; empty?: string }) {
  const company = await prisma.companySettings.findUnique({ where: { id: 1 }, select: { defaultCurrency: true } });
  const cur = company?.defaultCurrency ?? "USD";
  const nonZero = rows.filter(([, v]) => !v.isZero());
  if (!nonZero.length) return rows.length ? <Money v={0} cur={cur} /> : <span className="text-slate-400">{empty}</span>;

  const others = nonZero.filter(([c]) => c !== cur);
  const book = others.length ? await loadRateBook(prisma, cur) : null;
  let total = dec(0);
  const missing: [string, Prisma.Decimal][] = [];
  for (const [c, v] of nonZero) {
    if (c === cur) { total = total.plus(v); continue; }
    const conv = book!.convert(v, c, cur, today());
    if (conv) total = total.plus(conv.value); else missing.push([c, v]);
  }
  return (
    <span className="flex flex-col">
      <Money v={total} cur={cur} />
      {others.length > missing.length && (
        <span className="text-[11px] font-normal text-slate-400">incl. other currencies converted to {cur}</span>
      )}
      {missing.length > 0 && (
        <span className="text-[11px] font-normal text-slate-400" title="Add a rate under Settings → Exchange rates to include it">
          Excludes {missing.map(([c, v]) => formatMoney(v, c)).join(", ")} (no exchange rate)
        </span>
      )}
    </span>
  );
}
