import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { getReport, isLink, isMoney, runReport, type Cell, type Column } from "@/server/core/reports";
import { formatMoney } from "@/server/core/money";
import { prisma } from "@/server/db";
import { filtersQuery, parseReportFilters } from "@/server/report-params";
import { buttonClass, Card, Field, Input, labelize, PageHeader, Select, Table, Td } from "@/components/ui";

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[id]">) {
  const user = await requirePermission("reports");
  const { id } = await params;
  const def = getReport(id);
  if (!def) notFound();
  const sp = await searchParams;
  const f = parseReportFilters(sp);
  const [result, clients, rateCurrencies, usedCurrencies] = await Promise.all([
    runReport(prisma, def, f),
    def.filters.includes("client") ? prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    prisma.exchangeRate.findMany({ distinct: ["toCurrency"], select: { toCurrency: true } }),
    prisma.project.findMany({ distinct: ["currency"], select: { currency: true } }),
  ]);
  const qs = filtersQuery(sp);
  const canExport = can(user.role, "reports", "export");
  const rcOptions = [...new Set([...rateCurrencies.map((r) => r.toCurrency), ...(f.rc ? [f.rc] : [])])].sort();
  const raw = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title={def.title} subtitle={def.description}
        actions={canExport && <>
          {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
            <a key={fmt} href={`/api/reports/${def.id}?${qs}${qs ? "&" : ""}format=${fmt}`} className={buttonClass("secondary")}>
              {fmt === "csv" ? "CSV" : fmt === "xlsx" ? "Excel" : "PDF"}
            </a>
          ))}
        </>} />

      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3">
          {def.filters.includes("dateRange") && <>
            <Field label={`${def.dateLabel ?? "Date"} from`}><Input type="date" name="from" defaultValue={raw("from")} /></Field>
            <Field label="to"><Input type="date" name="to" defaultValue={raw("to")} /></Field>
          </>}
          {def.filters.includes("year") && (
            <Field label="Year"><Input type="number" name="year" min={2000} max={2199} defaultValue={raw("year") || String(new Date().getFullYear())} className="w-28" /></Field>
          )}
          {def.filters.includes("client") && (
            <Field label="Client">
              <Select name="clientId" defaultValue={raw("clientId")} className="min-w-[180px]">
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          {def.filters.includes("currency") && (
            <Field label="Currency">
              <Select name="currency" defaultValue={raw("currency")} className="w-28">
                <option value="">All</option>
                {usedCurrencies.map((c) => <option key={c.currency} value={c.currency}>{c.currency}</option>)}
              </Select>
            </Field>
          )}
          {def.filters.includes("status") && def.statuses && (
            <Field label="Status">
              <Select name="status" defaultValue={raw("status")} className="min-w-[150px]">
                <option value="">All</option>
                {def.statuses.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Reporting currency" hint={rcOptions.length ? undefined : "Add exchange rates in Settings to enable"}>
            <Select name="rc" defaultValue={f.rc ?? ""} className="w-40" disabled={!rcOptions.length}>
              <option value="">None (per currency)</option>
              {rcOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <button className={buttonClass("primary")}>Apply</button>
          {qs && <Link href={`/reports/${def.id}`} className={buttonClass("ghost")}>Reset</Link>}
        </form>
      </Card>

      <Card title={`${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`}>
        <ul className="mb-4 space-y-1 text-xs text-slate-500">
          {result.notes.map((n) => <li key={n} className={n.includes("no recorded rate") ? "text-amber-700" : ""}>• {n}</li>)}
        </ul>
        <Table head={result.columns.map((c) => c.label)} empty="No rows match these filters.">
          {result.rows.slice(0, 1000).map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {result.columns.map((c) => <Td key={c.key} className={c.kind === "money" || c.kind === "number" ? "text-right tabular whitespace-nowrap" : ""}>{render(c, row[c.key], result.reportingCurrency)}</Td>)}
            </tr>
          ))}
        </Table>
        {result.rows.length > 1000 && <p className="mt-2 text-xs text-slate-500">Showing the first 1,000 rows — export for the full set.</p>}

        {Object.keys(result.totals).length > 0 && (
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(result.totals).map(([k, list]) => (
              <div key={k}>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total {result.columns.find((c) => c.key === k)?.label}</div>
                {list.length ? list.map((t) => <div key={t.currency} className="tabular font-semibold">{formatMoney(t.amount, t.currency)}</div>) : <div className="text-slate-400">—</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function render(col: Column, v: Cell, rc: string | null) {
  if (v === null || v === undefined || v === "") return <span className="text-slate-300">—</span>;
  if (isLink(v)) return <Link href={v.href} className="text-indigo-700 hover:underline">{v.text}</Link>;
  if (isMoney(v)) {
    if (!rc || v.currency === rc) return formatMoney(v.amount, v.currency);
    return v.converted != null
      ? <span title={`Original ${formatMoney(v.amount, v.currency)}`}>{formatMoney(v.converted, rc)}<div className="text-[11px] text-slate-400">{formatMoney(v.amount, v.currency)}</div></span>
      : <span className="text-amber-700" title="No recorded exchange rate">{formatMoney(v.amount, v.currency)}<div className="text-[11px]">no rate</div></span>;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (col.kind === "text" && col.key !== "currency" && typeof v === "string" && /^[A-Z_]{4,}$/.test(v)) return labelize(v);
  return String(v);
}
