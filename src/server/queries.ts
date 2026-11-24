import "server-only";
import { InvoiceStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { dec } from "./core/money";

type Dec = Prisma.Decimal;

/** Per-currency invoice totals (never mixes currencies — BR-12). */
export async function invoiceTotalsByCurrency(where: Prisma.InvoiceWhereInput) {
  const rows = await prisma.invoice.groupBy({
    by: ["currency"],
    where: { ...where, status: { notIn: [InvoiceStatus.CANCELLED] } },
    _sum: { total: true, amountPaid: true, subtotal: true, discount: true, balanceMoved: true },
    _count: true,
  });
  return rows.map((r) => {
    const total = r._sum.total ?? dec(0);
    const paid = r._sum.amountPaid ?? dec(0);
    return { currency: r.currency, total, paid, outstanding: total.minus(paid).minus(r._sum.balanceMoved ?? 0), count: r._count };
  });
}

export function groupSum<T>(items: T[], cur: (t: T) => string, val: (t: T) => Dec) {
  const m = new Map<string, Dec>();
  for (const i of items) m.set(cur(i), (m.get(cur(i)) ?? dec(0)).plus(val(i)));
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}
