import "server-only";
import { InvoiceStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { today } from "./core/common";

export interface InvoiceFilters { q?: string; status?: string; currency?: string; clientId?: string; from?: string; to?: string }

export function readFilters(sp: Record<string, string | string[] | undefined>): InvoiceFilters {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined) || undefined;
  return { q: g("q"), status: g("status"), currency: g("currency"), clientId: g("clientId"), from: g("from"), to: g("to") };
}

export function filtersToWhere(f: InvoiceFilters): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {};
  if (f.status === "OVERDUE") {
    where.status = { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID] };
    where.dueDate = { lt: today() };
  } else if (f.status && f.status in InvoiceStatus) {
    where.status = f.status as InvoiceStatus;
  }
  if (f.currency) where.currency = f.currency.toUpperCase();
  if (f.clientId) where.clientId = f.clientId;
  if (f.from || f.to) {
    where.invoiceDate = { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) };
  }
  if (f.q) {
    where.OR = [
      { invoiceNumber: { contains: f.q, mode: "insensitive" } },
      { client: { name: { contains: f.q, mode: "insensitive" } } },
      { project: { OR: [{ code: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] } },
      { po: { poNumber: { contains: f.q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export const invoiceListInclude = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  po: { select: { id: true, poNumber: true } },
} satisfies Prisma.InvoiceInclude;
