import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/server/core/money";

export function Money({ v, cur, className }: { v: Prisma.Decimal | string | number; cur: string; className?: string }) {
  return <span className={`tabular whitespace-nowrap ${className ?? ""}`}>{formatMoney(v, cur)}</span>;
}

/** Stacked per-currency amounts: never summed across currencies. */
export function MultiMoney({ rows, empty = "—" }: { rows: [string, Prisma.Decimal][]; empty?: string }) {
  if (!rows.length) return <span className="text-slate-400">{empty}</span>;
  return (
    <span className="flex flex-col">
      {[...rows].sort(([a], [b]) => a.localeCompare(b)).map(([c, v]) => <Money key={c} v={v} cur={c} />)}
    </span>
  );
}
