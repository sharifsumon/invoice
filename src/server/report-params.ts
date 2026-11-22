import "server-only";
import type { Filters } from "./core/reports";

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "") || undefined;
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : undefined);

export function parseReportFilters(sp: SP): Filters {
  const year = Number(one(sp, "year"));
  const to = date(one(sp, "to"));
  return {
    from: date(one(sp, "from")),
    to: to ? new Date(to.getTime() + 86_399_999) : undefined,
    clientId: one(sp, "clientId"),
    currency: one(sp, "currency")?.toUpperCase(),
    status: one(sp, "status"),
    year: Number.isInteger(year) && year > 1999 && year < 2200 ? year : undefined,
    rc: one(sp, "rc")?.toUpperCase(),
  };
}

export function filtersQuery(sp: SP) {
  const keep = ["from", "to", "clientId", "currency", "status", "year", "rc"];
  return new URLSearchParams(keep.flatMap((k) => (one(sp, k) ? [[k, one(sp, k)!]] : []))).toString();
}
