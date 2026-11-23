import { InvoiceStatus, POStatus, ProjectStatus, type ClientStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { today, type Db } from "./common";
import { loadRateBook, type RateBook } from "./fx";
import { dec, sum } from "./money";
import { getSettings } from "./settings";

// ───────────── Generic report model ─────────────

export interface MoneyCell { amount: Prisma.Decimal; currency: string; on: Date | null; converted?: Prisma.Decimal | null }
export interface LinkCell { text: string; href: string }
export type Cell = string | number | Date | MoneyCell | LinkCell | null;
export type ColumnKind = "text" | "money" | "date" | "number" | "link";
export interface Column { key: string; label: string; kind: ColumnKind }
export type Row = Record<string, Cell>;

export interface Filters {
  from?: Date; to?: Date; clientId?: string; currency?: string; status?: string; year?: number; rc?: string;
}
export type FilterKey = "dateRange" | "client" | "currency" | "status" | "year";

export interface ReportResult {
  columns: Column[];
  rows: Row[];
  notes: string[];
  totals: Record<string, { currency: string; amount: Prisma.Decimal }[]>;
  reportingCurrency: string | null;
  unconverted: number;
}

export interface ReportDef {
  id: string;
  title: string;
  description: string;
  filters: FilterKey[];
  dateLabel?: string;
  statuses?: string[];
  run(db: Db, f: Filters): Promise<{ columns: Column[]; rows: Row[]; notes?: string[] }>;
}

export const isMoney = (c: Cell): c is MoneyCell => !!c && typeof c === "object" && "amount" in c && "currency" in c;
export const isLink = (c: Cell): c is LinkCell => !!c && typeof c === "object" && "href" in c;
const m = (amount: Prisma.Decimal | null | undefined, currency: string, on: Date | null): MoneyCell => ({ amount: amount ?? dec(0), currency, on });
const dateRange = (f: Filters) => (f.from || f.to ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } : undefined);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const ymLabel = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const OPEN: InvoiceStatus[] = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID];
const ISSUED: InvoiceStatus[] = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID];
const APPROVED_PO: POStatus[] = [POStatus.APPROVED, POStatus.COMPLETED];

// ───────────── Reports (BRD §10) ─────────────

export const REPORTS: ReportDef[] = [
  {
    id: "clients", title: "Client register & contact directory",
    description: "Every client with its contacts.",
    filters: ["client", "status"], statuses: ["PROSPECT", "COMMUNICATED", "ONBOARDED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "INACTIVE"],
    async run(db, f) {
      const clients = await db.client.findMany({
        where: { id: f.clientId, status: f.status as ClientStatus | undefined },
        orderBy: { name: "asc" }, include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } },
      });
      const rows: Row[] = [];
      for (const c of clients) {
        const base = { client: { text: c.name, href: `/clients/${c.id}` }, status: c.status, country: c.country, archived: c.archived ? "Yes" : "" };
        if (!c.contacts.length) rows.push({ ...base, contact: null, designation: null, email: c.email, phone: c.phone, primary: null });
        for (const ct of c.contacts) rows.push({ ...base, contact: ct.name, designation: ct.designation, email: ct.email, phone: ct.phone, primary: ct.isPrimary ? "Primary" : "" });
      }
      return {
        columns: [
          { key: "client", label: "Client", kind: "link" }, { key: "status", label: "Status", kind: "text" },
          { key: "country", label: "Country", kind: "text" }, { key: "contact", label: "Contact", kind: "text" },
          { key: "designation", label: "Designation", kind: "text" }, { key: "email", label: "Email", kind: "text" },
          { key: "phone", label: "Phone", kind: "text" }, { key: "primary", label: "Primary", kind: "text" },
          { key: "archived", label: "Archived", kind: "text" },
        ],
        rows,
      };
    },
  },
  {
    id: "projects", title: "Project register & business value",
    description: "All projects. Business Value counts approved projects only, dated by approval date (BR-01/02).",
    filters: ["dateRange", "client", "currency", "status"], dateLabel: "Approval date",
    statuses: Object.values(ProjectStatus),
    async run(db, f) {
      const ps = await db.project.findMany({
        where: { clientId: f.clientId, currency: f.currency, status: f.status as ProjectStatus | undefined, approvalDate: dateRange(f) },
        orderBy: [{ approvalDate: "desc" }, { code: "asc" }], include: { client: { select: { name: true } }, manager: { select: { name: true } } },
      });
      return {
        columns: [
          { key: "code", label: "Code", kind: "link" }, { key: "name", label: "Project", kind: "text" }, { key: "client", label: "Client", kind: "text" },
          { key: "manager", label: "Manager", kind: "text" }, { key: "status", label: "Status", kind: "text" },
          { key: "approvalDate", label: "Approved", kind: "date" }, { key: "value", label: "Project value", kind: "money" },
          { key: "bv", label: "Business value", kind: "money" },
        ],
        rows: ps.map((p) => {
          const counts = p.approved && p.status !== "CANCELLED";
          return {
            code: { text: p.code, href: `/projects/${p.id}` }, name: p.name, client: p.client.name, manager: p.manager?.name ?? null,
            status: p.status, approvalDate: p.approvalDate, value: m(p.value, p.currency, p.approvalDate ?? p.createdAt),
            bv: counts ? m(p.value, p.currency, p.approvalDate) : null,
          };
        }),
        notes: ["Business value total = approved projects only; PO values are never added (BR-03)."],
      };
    },
  },
  {
    id: "pos", title: "PO register",
    description: "Purchase orders with approved, invoiced, paid and remaining invoiceable values.",
    filters: ["dateRange", "client", "currency", "status"], dateLabel: "PO date", statuses: Object.values(POStatus),
    async run(db, f) {
      const pos = await db.purchaseOrder.findMany({
        where: { clientId: f.clientId, currency: f.currency, status: f.status as POStatus | undefined, poDate: dateRange(f) },
        orderBy: { poDate: "desc" },
        include: { client: { select: { name: true } }, project: { select: { code: true } }, invoices: { where: { status: { not: InvoiceStatus.CANCELLED } }, select: { subtotal: true, discount: true, amountPaid: true } } },
      });
      return {
        columns: [
          { key: "po", label: "PO", kind: "link" }, { key: "client", label: "Client", kind: "text" }, { key: "project", label: "Project", kind: "text" },
          { key: "date", label: "PO date", kind: "date" }, { key: "status", label: "Status", kind: "text" },
          { key: "value", label: "PO value", kind: "money" }, { key: "invoiced", label: "Valid invoiced", kind: "money" },
          { key: "paid", label: "Paid", kind: "money" }, { key: "remaining", label: "Remaining invoiceable", kind: "money" },
        ],
        rows: pos.map((p) => {
          const invoiced = sum(p.invoices.map((i) => i.subtotal.minus(i.discount)));
          const approved = APPROVED_PO.includes(p.status);
          return {
            po: { text: p.poNumber, href: `/pos/${p.id}` }, client: p.client.name, project: p.project.code, date: p.poDate, status: p.status,
            value: m(p.value, p.currency, p.poDate), invoiced: m(invoiced, p.currency, p.poDate),
            paid: m(sum(p.invoices.map((i) => i.amountPaid)), p.currency, p.poDate),
            remaining: approved ? m(p.value.minus(invoiced), p.currency, p.poDate) : null,
          };
        }),
        notes: ["Remaining invoiceable is shown for approved/completed POs only."],
      };
    },
  },
  {
    id: "invoices", title: "Invoice register",
    description: "Invoices with status, due date, amount, paid and outstanding balance.",
    filters: ["dateRange", "client", "currency", "status"], dateLabel: "Invoice date", statuses: [...Object.values(InvoiceStatus), "OVERDUE"],
    async run(db, f) {
      const t = today();
      const status = f.status === "OVERDUE" ? { in: OPEN } : (f.status as InvoiceStatus | undefined);
      const invs = await db.invoice.findMany({
        where: { clientId: f.clientId, currency: f.currency, status, invoiceDate: dateRange(f), ...(f.status === "OVERDUE" ? { dueDate: { lt: t } } : {}) },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: { client: { select: { name: true } }, project: { select: { code: true } }, po: { select: { poNumber: true } } },
      });
      return {
        columns: [
          { key: "invoice", label: "Invoice", kind: "link" }, { key: "client", label: "Client", kind: "text" }, { key: "project", label: "Project", kind: "text" },
          { key: "po", label: "PO", kind: "text" }, { key: "date", label: "Invoice date", kind: "date" }, { key: "due", label: "Due", kind: "date" },
          { key: "status", label: "Status", kind: "text" }, { key: "overdue", label: "Overdue", kind: "text" },
          { key: "total", label: "Total", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "balance", label: "Balance", kind: "money" },
        ],
        rows: invs.map((i) => {
          const live = i.status !== "CANCELLED" && i.status !== "DRAFT";
          const bal = i.total.minus(i.amountPaid);
          const on = i.invoiceDate ?? i.createdAt;
          return {
            invoice: { text: i.invoiceNumber ?? "Draft", href: `/invoices/${i.id}` }, client: i.client.name, project: i.project.code, po: i.po.poNumber,
            date: i.invoiceDate, due: i.dueDate, status: i.status,
            overdue: OPEN.includes(i.status) && i.dueDate && i.dueDate < t && bal.gt(0) ? "Yes" : "",
            total: live ? m(i.total, i.currency, on) : null, paid: live ? m(i.amountPaid, i.currency, on) : null, balance: live ? m(bal, i.currency, on) : null,
          };
        }),
        notes: ["Totals exclude drafts and cancelled invoices (they are listed for reference only)."],
      };
    },
  },
  {
    id: "collections", title: "Payments & collections",
    description: "Valid payment transactions by payment date — actual cash collected (BR-13).",
    filters: ["dateRange", "client", "currency"], dateLabel: "Payment date",
    async run(db, f) {
      const ps = await db.payment.findMany({
        where: { state: "VALID", currency: f.currency, paymentDate: dateRange(f), invoice: { clientId: f.clientId } },
        orderBy: { paymentDate: "desc" },
        include: { invoice: { select: { id: true, invoiceNumber: true, client: { select: { name: true } }, project: { select: { code: true } } } } },
      });
      return {
        columns: [
          { key: "date", label: "Payment date", kind: "date" }, { key: "invoice", label: "Invoice", kind: "link" }, { key: "client", label: "Client", kind: "text" },
          { key: "project", label: "Project", kind: "text" }, { key: "method", label: "Method", kind: "text" }, { key: "reference", label: "Reference", kind: "text" },
          { key: "account", label: "Receiving account", kind: "text" }, { key: "amount", label: "Amount", kind: "money" },
        ],
        rows: ps.map((p) => ({
          date: p.paymentDate, invoice: { text: p.invoice.invoiceNumber ?? "—", href: `/invoices/${p.invoice.id}` }, client: p.invoice.client.name,
          project: p.invoice.project.code, method: p.method, reference: p.reference, account: p.receivingAccount, amount: m(p.amount, p.currency, p.paymentDate),
        })),
        notes: ["Reversed payments are excluded."],
      };
    },
  },
  {
    id: "aging", title: "Receivables aging",
    description: "Outstanding balances of issued invoices by days past due, as of today.",
    filters: ["client", "currency"],
    async run(db, f) {
      const t = today();
      const invs = await db.invoice.findMany({
        where: { status: { in: OPEN }, clientId: f.clientId, currency: f.currency },
        orderBy: { dueDate: "asc" }, include: { client: { select: { name: true } } },
      });
      const buckets = [["notDue", "Not due"], ["d30", "1–30"], ["d60", "31–60"], ["d90", "61–90"], ["d90p", "90+"]] as const;
      return {
        columns: [
          { key: "invoice", label: "Invoice", kind: "link" }, { key: "client", label: "Client", kind: "text" }, { key: "due", label: "Due", kind: "date" },
          { key: "days", label: "Days overdue", kind: "number" },
          ...buckets.map(([k, l]) => ({ key: k, label: l, kind: "money" as const })),
        ],
        rows: invs.map((i) => {
          const days = i.dueDate ? Math.floor((+t - +i.dueDate) / 86_400_000) : 0;
          const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
          const row: Row = { invoice: { text: i.invoiceNumber ?? "—", href: `/invoices/${i.id}` }, client: i.client.name, due: i.dueDate, days: Math.max(0, days) };
          buckets.forEach(([k], idx) => { row[k] = idx === b ? m(i.total.minus(i.amountPaid), i.currency, t) : null; });
          return row;
        }),
      };
    },
  },
  {
    id: "forecast", title: "Expected collections forecast",
    description: "Outstanding balances grouped by invoice due month (BR-13). Past-due amounts are shown as overdue.",
    filters: ["client", "currency"],
    async run(db, f) {
      const t = today();
      const invs = await db.invoice.findMany({ where: { status: { in: OPEN }, clientId: f.clientId, currency: f.currency }, select: { total: true, amountPaid: true, currency: true, dueDate: true } });
      const groups = new Map<string, { label: string; sort: string; currency: string; amount: Prisma.Decimal; n: number; on: Date }>();
      for (const i of invs) {
        const overdue = !i.dueDate || i.dueDate < t;
        const k = overdue ? "0000-00" : ymKey(i.dueDate!);
        const key = `${k}|${i.currency}`;
        const g = groups.get(key) ?? { label: overdue ? "Overdue (past due)" : ymLabel(k), sort: k, currency: i.currency, amount: dec(0), n: 0, on: overdue ? t : i.dueDate! };
        g.amount = g.amount.plus(i.total.minus(i.amountPaid)); g.n++;
        groups.set(key, g);
      }
      return {
        columns: [{ key: "month", label: "Due month", kind: "text" }, { key: "count", label: "Invoices", kind: "number" }, { key: "amount", label: "Expected", kind: "money" }],
        rows: [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort) || a.currency.localeCompare(b.currency))
          .map((g) => ({ month: g.label, count: g.n, amount: m(g.amount, g.currency, g.on) })),
      };
    },
  },
  {
    id: "performance", title: "Monthly commercial performance",
    description: "Business value (approval date), approved PO value (approval date), invoiced (invoice date) and collected (payment date) per month.",
    filters: ["year", "currency"],
    async run(db, f) {
      const year = f.year ?? today().getUTCFullYear();
      const from = new Date(Date.UTC(year, 0, 1)); const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
      const cur = f.currency;
      const [projects, pos, invs, pays] = await Promise.all([
        db.project.findMany({ where: { approved: true, status: { not: "CANCELLED" }, approvalDate: { gte: from, lte: to }, currency: cur }, select: { value: true, currency: true, approvalDate: true } }),
        db.purchaseOrder.findMany({ where: { status: { in: APPROVED_PO }, approvedAt: { gte: from, lte: to }, currency: cur }, select: { value: true, currency: true, approvedAt: true } }),
        db.invoice.findMany({ where: { status: { in: ISSUED }, invoiceDate: { gte: from, lte: to }, currency: cur }, select: { total: true, currency: true, invoiceDate: true } }),
        db.payment.findMany({ where: { state: "VALID", paymentDate: { gte: from, lte: to }, currency: cur }, select: { amount: true, currency: true, paymentDate: true } }),
      ]);
      const grid = new Map<string, Row & { _k: string }>();
      const add = (d: Date, c: string, col: string, v: Prisma.Decimal) => {
        const k = `${ymKey(d)}|${c}`;
        const row = grid.get(k) ?? { _k: k, month: ymLabel(ymKey(d)), bv: null, po: null, invoiced: null, collected: null };
        const prev = row[col] as MoneyCell | null;
        row[col] = m((prev?.amount ?? dec(0)).plus(v), c, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
        grid.set(k, row);
      };
      projects.forEach((p) => add(p.approvalDate!, p.currency, "bv", p.value));
      pos.forEach((p) => add(p.approvedAt!, p.currency, "po", p.value));
      invs.forEach((i) => add(i.invoiceDate!, i.currency, "invoiced", i.total));
      pays.forEach((p) => add(p.paymentDate, p.currency, "collected", p.amount));
      return {
        columns: [
          { key: "month", label: "Month", kind: "text" }, { key: "bv", label: "Business value", kind: "money" }, { key: "po", label: "Approved PO value", kind: "money" },
          { key: "invoiced", label: "Invoiced", kind: "money" }, { key: "collected", label: "Collected", kind: "money" },
        ],
        rows: [...grid.values()].sort((a, b) => a._k.localeCompare(b._k)).map(({ _k: _, ...r }) => r),
        notes: [`Year ${year}. One row per month and currency.`],
      };
    },
  },
  ...(["client", "project"] as const).map((by): ReportDef => ({
    id: `${by}-performance`, title: by === "client" ? "Client performance" : "Project performance",
    description: `Business value, approved PO value, invoiced, collected and outstanding per ${by} and currency.`,
    filters: ["client", "currency"],
    async run(db, f) {
      const projects = await db.project.findMany({
        where: { clientId: f.clientId, currency: f.currency },
        include: {
          client: { select: { id: true, name: true } },
          purchaseOrders: { where: { status: { in: APPROVED_PO } }, select: { value: true, currency: true } },
          invoices: { where: { status: { in: ISSUED } }, select: { total: true, amountPaid: true, currency: true } },
        },
      });
      const t = today();
      const out = new Map<string, Row & { _n: string }>();
      const bump = (key: string, label: LinkCell, client: string, col: string, v: Prisma.Decimal, c: string) => {
        const k = `${key}|${c}`;
        const row = out.get(k) ?? { _n: label.text, name: label, client, currency: c, bv: m(dec(0), c, t), po: m(dec(0), c, t), invoiced: m(dec(0), c, t), collected: m(dec(0), c, t), outstanding: m(dec(0), c, t) };
        (row[col] as MoneyCell).amount = (row[col] as MoneyCell).amount.plus(v);
        out.set(k, row);
      };
      for (const p of projects) {
        const key = by === "client" ? p.clientId : p.id;
        const label = by === "client" ? { text: p.client.name, href: `/clients/${p.clientId}` } : { text: `${p.code} — ${p.name}`, href: `/projects/${p.id}` };
        bump(key, label, p.client.name, "bv", p.approved && p.status !== "CANCELLED" ? p.value : dec(0), p.currency);
        for (const o of p.purchaseOrders) bump(key, label, p.client.name, "po", o.value, o.currency);
        for (const i of p.invoices) {
          bump(key, label, p.client.name, "invoiced", i.total, i.currency);
          bump(key, label, p.client.name, "collected", i.amountPaid, i.currency);
          bump(key, label, p.client.name, "outstanding", i.total.minus(i.amountPaid), i.currency);
        }
      }
      const cols: Column[] = [
        { key: "name", label: by === "client" ? "Client" : "Project", kind: "link" },
        ...(by === "project" ? [{ key: "client", label: "Client", kind: "text" as const }] : []),
        { key: "currency", label: "Currency", kind: "text" }, { key: "bv", label: "Business value", kind: "money" }, { key: "po", label: "Approved PO value", kind: "money" },
        { key: "invoiced", label: "Invoiced", kind: "money" }, { key: "collected", label: "Collected", kind: "money" }, { key: "outstanding", label: "Outstanding", kind: "money" },
      ];
      return { columns: cols, rows: [...out.values()].sort((a, b) => a._n.localeCompare(b._n)).map(({ _n: _, ...r }) => r) };
    },
  })),
];

export function getReport(id: string) {
  return REPORTS.find((r) => r.id === id) ?? null;
}

/**
 * Run a report; compute per-column totals. Without a reporting currency, totals are per currency.
 * With one, each money cell is converted at the rate effective on its own date; cells without a
 * rate are left unconverted, counted and excluded from the converted total (never silently mixed).
 */
export async function runReport(db: Db, def: ReportDef, f: Filters, book?: RateBook): Promise<ReportResult> {
  const { columns, rows, notes = [] } = await def.run(db, f);
  // One-currency app: everything is reported in the company currency from Settings.
  const rc = f.rc?.toUpperCase() || (await getSettings(db)).company.defaultCurrency;
  const rates = rc ? book ?? (await loadRateBook(db, rc)) : null;
  let unconverted = 0;
  let foreign = 0;
  const totals: ReportResult["totals"] = {};
  for (const col of columns.filter((c) => c.kind === "money")) {
    const acc = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const c = r[col.key];
      if (!isMoney(c)) continue;
      if (rc && rates) {
        if (c.currency !== rc) foreign++;
        const conv = rates.convert(c.amount, c.currency, rc, c.on ?? today());
        c.converted = conv?.value ?? null;
        if (!conv) { if (!c.amount.isZero()) unconverted++; continue; }
        acc.set(rc, (acc.get(rc) ?? dec(0)).plus(conv.value));
      } else {
        acc.set(c.currency, (acc.get(c.currency) ?? dec(0)).plus(c.amount));
      }
    }
    totals[col.key] = [...acc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount }));
  }
  const allNotes = [...notes];
  if (rc && foreign) {
    allNotes.push(`Older amounts in other currencies converted to ${rc} using recorded exchange rates effective on or before each row's date (reporting only — no settlement).`);
    if (unconverted) allNotes.push(`${unconverted} amount(s) had no recorded rate to ${rc} and are excluded from converted totals. Add rates under Settings → Exchange rates.`);
  } else if (rc) {
    allNotes.push(`All amounts in ${rc}.`);
  }
  return { columns, rows, notes: allNotes, totals, reportingCurrency: rc, unconverted };
}
