import type { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus, POStatus, ProjectStatus, type ClientStatus } from "@/generated/prisma/enums";
import { aiConfig, generateResilient, type FunctionDeclaration, type GeminiContent, type GeminiPart } from "./ai";
import { createExport, type DataTable, type ExportFormat } from "./assistant-export";
import { audit, today, type Actor, type Db } from "./common";
import { loadRateBook, type RateBook } from "./fx";
import { dec, outstandingOf } from "./money";
import { can, ForbiddenError, RuleError, type Module } from "./permissions";
import { getReport, isLink, isMoney, REPORTS, runReport } from "./reports";
import { globalSearch } from "./search";
import { getSettings } from "./settings";

/**
 * AI assistant: Gemini answers questions by calling read-only tools over the live data. Every tool checks the
 * asking user's own permissions, so the assistant can never show more than the user could open themselves.
 * Totals are computed here (not by the model); exports are rendered server-side from tool results.
 *
 * Speed: lookups support sort/limit/include_details so most questions need one lookup; independent lookups
 * run in parallel; the model sees a compact slice of each result; answers stream to the browser.
 */

export interface ChatTurn { role: "user" | "assistant"; text: string }
export interface AssistantFile { name: string; title: string; format: ExportFormat; url: string; size: number }
export interface AssistantReply { text: string; files: AssistantFile[]; steps: string[] }
/** Live progress for the chat: a step label, answer text as it streams, or "reset" (discard interim text). */
export type AssistantEvent = { type: "step"; label: string } | { type: "text"; delta: string } | { type: "reset" };

const MAX_STEPS = 10;
const MODEL_ROWS = 30; // rows shown to the model per tool call (exports always get every row)
const EXPORT_ROWS = 5000; // rows allowed in an export
const DETAIL_MAX = 3; // include_details expands at most this many records

type Ctx = { db: Db; actor: Actor; currency: string; rates: RateBook; files: AssistantFile[]; tables: Map<string, DataTable> };
type ToolResult = Record<string, unknown>;
type Args = Record<string, unknown>;

// ───────────── helpers ─────────────

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (d: Prisma.Decimal | number) => Math.round(Number(d) * 100) / 100;
const r2 = (x: number) => Math.round(x * 100) / 100;
function date(v: unknown): Date | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) ? undefined : d;
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const ci = (s: string) => ({ contains: s, mode: "insensitive" as const });
const range = (a: Args) => {
  const from = date(a.date_from), to = date(a.date_to);
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
};
/** Convert into the company currency (older records in another currency use recorded rates). */
function cc(ctx: Ctx, amount: Prisma.Decimal, currency: string, on: Date | null): number | null {
  if (currency === ctx.currency) return num(amount);
  const c = ctx.rates.convert(amount, currency, ctx.currency, on ?? today());
  return c ? num(c.value) : null;
}
const isOverdue = (i: { status: InvoiceStatus; dueDate: Date | null } & Parameters<typeof outstandingOf>[0]) =>
  (i.status === "UNPAID" || i.status === "PARTIALLY_PAID") && !!i.dueDate && i.dueDate < today() && outstandingOf(i).gt(0);

async function resolveClientIds(ctx: Ctx, name?: string) {
  if (!name) return undefined;
  const cs = await ctx.db.client.findMany({ where: { OR: [{ name: ci(name) }, { legalName: ci(name) }] }, select: { id: true } });
  return cs.map((c) => c.id);
}

/** Apply sort_by / order / limit (from tool args) to rows. */
function sortLimit<T extends Record<string, unknown>>(rows: T[], a: Args, keys: Record<string, string>): T[] {
  const key = typeof a.sort_by === "string" ? keys[a.sort_by] : undefined;
  let out = rows;
  if (key) {
    const dir = a.order === "asc" ? 1 : -1;
    out = [...rows].sort((x, y) => {
      const vx = x[key], vy = y[key];
      if (vx === vy) return 0;
      if (vx === null || vx === undefined) return 1;
      if (vy === null || vy === undefined) return -1;
      return (typeof vx === "number" && typeof vy === "number" ? vx - vy : String(vx).localeCompare(String(vy))) * dir;
    });
  }
  const n = typeof a.limit === "number" && a.limit > 0 ? Math.min(Math.floor(a.limit), EXPORT_ROWS) : undefined;
  return n ? out.slice(0, n) : out;
}

/** Show the model a compact, bounded slice; keep the full table for exports under a handle. */
function present(ctx: Ctx, tool: string, t: DataTable, extra: ToolResult = {}): ToolResult {
  const handle = `${tool}#${ctx.tables.size + 1}`;
  ctx.tables.set(handle, t);
  const totals: Record<string, number> = {};
  for (const c of t.columns) if (c.kind === "money") totals[c.label] = r2(t.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0));
  // One header row + value arrays (no repeated keys) → fewer tokens, faster replies
  const keys = [...t.columns.map((c) => c.key), ...(t.rows.some((r) => "link" in r) ? ["link"] : [])];
  return {
    table_handle: handle, currency: ctx.currency,
    columns: [...t.columns.map((c) => `${c.label} (${c.kind})`), ...(keys.includes("link") ? ["link"] : [])],
    rows: t.rows.slice(0, MODEL_ROWS).map((r) => keys.map((k) => r[k] ?? null)),
    total_rows: t.rows.length,
    ...(t.rows.length > MODEL_ROWS ? { note: `Only the first ${MODEL_ROWS} rows are shown; exports include all rows. Use sort_by/limit for the rows you need.` } : {}),
    column_totals: totals, ...(t.notes?.length ? { notes: t.notes } : {}), ...extra,
  };
}

// ───────────── record details (shared by get_* and include_details) ─────────────

async function invoiceDetails(ctx: Ctx, where: Prisma.InvoiceWhereInput): Promise<ToolResult | null> {
  const inv = await ctx.db.invoice.findFirst({
    where,
    include: {
      client: { select: { name: true } }, project: { select: { code: true, name: true } }, po: { select: { poNumber: true, status: true } },
      milestone: { select: { name: true, sequence: true } }, lineItems: { orderBy: { sequence: "asc" } },
      payments: { orderBy: { paymentDate: "asc" } }, balanceOf: { select: { invoiceNumber: true } },
      balanceInvoices: { select: { invoiceNumber: true, status: true, total: true } },
    },
  });
  if (!inv) return null;
  return {
    invoice: inv.invoiceNumber ?? "Draft", link: `/invoices/${inv.id}`, type: inv.kind, status: inv.status, overdue: isOverdue(inv),
    client: inv.client.name, project: `${inv.project.code} — ${inv.project.name}`, po: `${inv.po.poNumber} (${inv.po.status})`,
    milestone: inv.milestone ? `#${inv.milestone.sequence} ${inv.milestone.name}` : null,
    invoice_date: day(inv.invoiceDate), due_date: day(inv.dueDate), currency: inv.currency,
    subtotal: num(inv.subtotal), discount: num(inv.discount), tax_rate_percent: num(inv.taxRate), tax: num(inv.taxAmount), total: num(inv.total),
    paid: num(inv.amountPaid), moved_to_balance_invoice: num(inv.balanceMoved), outstanding: num(outstandingOf(inv)),
    balance_of: inv.balanceOf?.invoiceNumber ?? null,
    balance_invoices: inv.balanceInvoices.map((b) => ({ number: b.invoiceNumber, status: b.status, total: num(b.total) })),
    lines: inv.lineItems.map((l) => ({ description: l.description, quantity: Number(l.quantity), rate: num(l.unitPrice), amount: num(l.amount) })),
    payments: inv.payments.map((p) => ({ date: day(p.paymentDate), amount: num(p.amount), method: p.method, reference: p.reference, state: p.state, reversal_reason: p.reversalReason })),
    notes: inv.notes,
  };
}

async function poDetails(ctx: Ctx, where: Prisma.PurchaseOrderWhereInput): Promise<ToolResult | null> {
  const po = await ctx.db.purchaseOrder.findFirst({
    where,
    include: {
      client: { select: { name: true } }, project: { select: { code: true, name: true } }, approvedBy: { select: { name: true } },
      milestones: { orderBy: { sequence: "asc" }, include: { invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNumber: true, status: true } } } },
      invoices: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!po) return null;
  const live = po.invoices.filter((i) => i.status !== "CANCELLED");
  const billing = live.filter((i) => i.kind !== "BALANCE");
  return {
    po: po.poNumber, link: `/pos/${po.id}`, status: po.status, client: po.client.name, project: `${po.project.code} — ${po.project.name}`,
    po_date: day(po.poDate), currency: po.currency, value: num(po.value), payment_terms: po.paymentTerms, reference: po.reference,
    approved_by: po.approvedBy?.name ?? null, approved_at: day(po.approvedAt),
    invoiced_issued: num(billing.filter((i) => i.status !== "DRAFT").reduce((s, i) => s.plus(i.total), dec(0))),
    drafts_pending: billing.filter((i) => i.status === "DRAFT").length,
    collected: num(live.reduce((s, i) => s.plus(i.amountPaid), dec(0))),
    outstanding: num(live.filter((i) => i.status !== "DRAFT").reduce((s, i) => s.plus(outstandingOf(i)), dec(0))),
    left_to_invoice: num(po.value.minus(billing.reduce((s, i) => s.plus(i.subtotal).minus(i.discount), dec(0)))),
    milestones: po.milestones.map((m) => ({ seq: m.sequence, name: m.name, percent: Number(m.percentage), amount: num(m.amount), expected: day(m.expectedDate), invoices: m.invoices.map((i) => `${i.invoiceNumber ?? "Draft"} (${i.status})`) })),
    invoices: po.invoices.map((i) => ({ number: i.invoiceNumber ?? "Draft", type: i.kind, status: i.status, date: day(i.invoiceDate), due: day(i.dueDate), total: num(i.total), paid: num(i.amountPaid), outstanding: i.status === "CANCELLED" ? 0 : num(outstandingOf(i)) })),
  };
}

/** Expand up to DETAIL_MAX rows into full records (rows carry `link` = /<kind>/<id>). */
async function withDetails(rows: Record<string, unknown>[], a: Args, load: (id: string) => Promise<ToolResult | null>) {
  if (!a.include_details) return {};
  if (rows.length > DETAIL_MAX) return { details_note: `include_details works for up to ${DETAIL_MAX} rows — use limit, or get_* for one record.` };
  const details = await Promise.all(rows.map((r) => load(String(r.link ?? "").split("/").pop() ?? "")));
  return { details: details.filter(Boolean) };
}

// ───────────── tool schemas ─────────────

const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: "STRING", description, ...extra });
const N = (description: string) => ({ type: "INTEGER", description });
const B = (description: string) => ({ type: "BOOLEAN", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "OBJECT", properties, ...(required.length ? { required } : {}) });
const DATE_FROM = S("Start date YYYY-MM-DD (inclusive)");
const DATE_TO = S("End date YYYY-MM-DD (inclusive)");
const sortParams = (fields: string[]) => ({
  sort_by: S("Sort rows by this field", { enum: fields }),
  order: S("desc (default: largest / latest first) or asc", { enum: ["desc", "asc"] }),
  limit: N("Return only the first N rows after sorting (1 for 'the largest', 5 for 'top 5')"),
});
const DETAILS = B(`Also return full details (lines, payments / milestones, invoices) for the rows — only when ${DETAIL_MAX} or fewer rows result, e.g. with limit 1`);

type Tool = FunctionDeclaration & { module: Module | null; label: (a: Args) => string; run: (ctx: Ctx, a: Args) => Promise<ToolResult> };

const TOOLS: Tool[] = [
  {
    name: "search_records", module: null, label: (a) => `Searching for “${String(a.query ?? "")}”`,
    description: "Find clients, contacts, projects, POs or invoices by any text (name, number, code, email). Use when the user names something you can't look up directly.",
    parameters: obj({ query: S("Text to search for") }, ["query"]),
    async run(ctx, a) {
      const hits = await globalSearch(ctx.db, String(a.query ?? ""), 15);
      const allowed: Record<string, Module> = { Client: "clients", Contact: "clients", Project: "projects", PO: "pos", Invoice: "invoices" };
      return { results: hits.filter((h) => can(ctx.actor, allowed[h.type], "view")) };
    },
  },
  {
    name: "find_invoices", module: "invoices", label: () => "Looking up invoices",
    description: "List invoices with amounts (company currency). Filter by status, client, project, PO, invoice date range or overdue; sort and limit (e.g. largest outstanding first). Drafts and cancelled are excluded unless asked.",
    parameters: obj({
      status: S("One of DRAFT, UNPAID, PARTIALLY_PAID, PAID, CANCELLED, OPEN (unpaid or part-paid)"),
      client: S("Client name (partial match)"), project: S("Project code or name (partial match)"), po_number: S("PO number"),
      date_from: DATE_FROM, date_to: DATE_TO, overdue_only: B("Only overdue invoices"), include_drafts: B("Include drafts and cancelled"),
      ...sortParams(["total", "outstanding", "paid", "invoice_date", "due_date"]), include_details: DETAILS,
    }),
    async run(ctx, a) {
      const status = str(a.status)?.toUpperCase();
      const clientIds = await resolveClientIds(ctx, str(a.client));
      const where: Prisma.InvoiceWhereInput = {
        ...(status === "OPEN" ? { status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID] } }
          : status && status in InvoiceStatus ? { status: status as InvoiceStatus }
          : a.include_drafts ? {} : { status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] } }),
        ...(clientIds ? { clientId: { in: clientIds } } : {}),
        ...(str(a.project) ? { project: { OR: [{ code: ci(str(a.project)!) }, { name: ci(str(a.project)!) }] } } : {}),
        ...(str(a.po_number) ? { po: { poNumber: ci(str(a.po_number)!) } } : {}),
        ...(range(a) ? { invoiceDate: range(a) } : {}),
      };
      let invs = await ctx.db.invoice.findMany({
        where, orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }], take: EXPORT_ROWS,
        include: { client: { select: { name: true } }, project: { select: { code: true } }, po: { select: { poNumber: true } } },
      });
      if (a.overdue_only) invs = invs.filter(isOverdue);
      const rows = sortLimit(invs.map((i) => ({
        number: i.invoiceNumber ?? "Draft", client: i.client.name, project: i.project.code, po: i.po.poNumber, kind: i.kind,
        status: isOverdue(i) ? `${i.status} (OVERDUE)` : i.status, date: day(i.invoiceDate), due: day(i.dueDate),
        total: cc(ctx, i.total, i.currency, i.invoiceDate), paid: cc(ctx, i.amountPaid, i.currency, i.invoiceDate),
        outstanding: i.status === "CANCELLED" || i.status === "DRAFT" ? 0 : cc(ctx, outstandingOf(i), i.currency, i.invoiceDate),
        link: `/invoices/${i.id}`,
      })), a, { total: "total", outstanding: "outstanding", paid: "paid", invoice_date: "date", due_date: "due" });
      return present(ctx, "find_invoices", {
        currency: ctx.currency,
        columns: [
          { key: "number", label: "Invoice", kind: "text" }, { key: "client", label: "Client", kind: "text" }, { key: "project", label: "Project", kind: "text" },
          { key: "po", label: "PO", kind: "text" }, { key: "kind", label: "Type", kind: "text" }, { key: "status", label: "Status", kind: "text" },
          { key: "date", label: "Invoice date", kind: "date" }, { key: "due", label: "Due date", kind: "date" },
          { key: "total", label: "Total", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "outstanding", label: "Outstanding", kind: "money" },
        ],
        rows,
        notes: ["BALANCE-type invoices re-bill an earlier invoice's unpaid part; don't count them as new billing."],
      }, await withDetails(rows, a, (id) => invoiceDetails(ctx, { id })));
    },
  },
  {
    name: "get_invoice", module: "invoices", label: (a) => `Reading invoice ${String(a.invoice_number ?? "")}`,
    description: "Full details of one invoice by number: lines, tax, payments (dates, methods), balance invoices, PO and milestone.",
    parameters: obj({ invoice_number: S("Invoice number, e.g. INV-2026-00012") }, ["invoice_number"]),
    async run(ctx, a) {
      const n = String(a.invoice_number ?? "").trim();
      return (await invoiceDetails(ctx, { invoiceNumber: { equals: n, mode: "insensitive" } })) ?? { error: `No invoice numbered ${n}. Try search_records.` };
    },
  },
  {
    name: "find_purchase_orders", module: "pos", label: () => "Looking up purchase orders",
    description: "List POs with value, invoiced, collected, outstanding and left-to-invoice (company currency). Filter by status, client, project, PO date range; sort and limit (e.g. limit 1 sorted by value = the largest PO). Add include_details for milestones and invoices in the same call.",
    parameters: obj({
      status: S("DRAFT, SUBMITTED, APPROVED, REJECTED, ON_HOLD, COMPLETED or CANCELLED"), client: S("Client name (partial)"),
      project: S("Project code or name (partial)"), date_from: DATE_FROM, date_to: DATE_TO,
      ...sortParams(["value", "invoiced", "collected", "outstanding", "left_to_invoice", "po_date"]), include_details: DETAILS,
    }),
    async run(ctx, a) {
      const status = str(a.status)?.toUpperCase();
      const clientIds = await resolveClientIds(ctx, str(a.client));
      const pos = await ctx.db.purchaseOrder.findMany({
        where: {
          ...(status && status in POStatus ? { status: status as POStatus } : {}),
          ...(clientIds ? { clientId: { in: clientIds } } : {}),
          ...(str(a.project) ? { project: { OR: [{ code: ci(str(a.project)!) }, { name: ci(str(a.project)!) }] } } : {}),
          ...(range(a) ? { poDate: range(a) } : {}),
        },
        orderBy: { poDate: "desc" }, take: EXPORT_ROWS,
        include: {
          client: { select: { name: true } }, project: { select: { code: true } },
          invoices: { where: { status: { not: InvoiceStatus.CANCELLED } }, select: { kind: true, status: true, subtotal: true, discount: true, total: true, amountPaid: true, balanceMoved: true } },
        },
      });
      const rows = sortLimit(pos.map((p) => {
        const billing = p.invoices.filter((i) => i.kind !== "BALANCE");
        const used = billing.reduce((s, i) => s.plus(i.subtotal).minus(i.discount), dec(0));
        const issued = p.invoices.filter((i) => i.status !== "DRAFT");
        return {
          po: p.poNumber, client: p.client.name, project: p.project.code, status: p.status, date: day(p.poDate),
          value: cc(ctx, p.value, p.currency, p.poDate),
          invoiced: cc(ctx, billing.filter((i) => i.status !== "DRAFT").reduce((s, i) => s.plus(i.total), dec(0)), p.currency, p.poDate),
          collected: cc(ctx, issued.reduce((s, i) => s.plus(i.amountPaid), dec(0)), p.currency, p.poDate),
          outstanding: cc(ctx, issued.reduce((s, i) => s.plus(outstandingOf(i)), dec(0)), p.currency, p.poDate),
          remaining: cc(ctx, p.value.minus(used), p.currency, p.poDate), link: `/pos/${p.id}`,
        };
      }), a, { value: "value", invoiced: "invoiced", collected: "collected", outstanding: "outstanding", left_to_invoice: "remaining", po_date: "date" });
      return present(ctx, "find_purchase_orders", {
        currency: ctx.currency,
        columns: [
          { key: "po", label: "PO", kind: "text" }, { key: "client", label: "Client", kind: "text" }, { key: "project", label: "Project", kind: "text" },
          { key: "status", label: "Status", kind: "text" }, { key: "date", label: "PO date", kind: "date" }, { key: "value", label: "PO value", kind: "money" },
          { key: "invoiced", label: "Invoiced", kind: "money" }, { key: "collected", label: "Collected", kind: "money" },
          { key: "outstanding", label: "Outstanding", kind: "money" }, { key: "remaining", label: "Left to invoice", kind: "money" },
        ],
        rows,
      }, await withDetails(rows, a, (id) => poDetails(ctx, { id })));
    },
  },
  {
    name: "get_purchase_order", module: "pos", label: (a) => `Reading PO ${String(a.po_number ?? "")}`,
    description: "Full details of one PO by number: milestones (with their invoices), every invoice with paid/outstanding, and the PO balance.",
    parameters: obj({ po_number: S("PO number") }, ["po_number"]),
    async run(ctx, a) {
      const n = String(a.po_number ?? "").trim();
      return (await poDetails(ctx, { poNumber: { equals: n, mode: "insensitive" } })) ?? { error: `No PO numbered ${n}. Try search_records.` };
    },
  },
  {
    name: "find_clients", module: "clients", label: () => "Looking up clients",
    description: "List clients with country, status, project count and money totals (business value, invoiced, collected, outstanding, overdue); sort and limit (e.g. top 5 by outstanding).",
    parameters: obj({
      query: S("Name contains (optional)"), status: S("PROSPECT, COMMUNICATED, ONBOARDED, IN_PROGRESS, ON_HOLD, COMPLETED or INACTIVE"), include_archived: B("Include archived clients"),
      ...sortParams(["business_value", "invoiced", "collected", "outstanding", "overdue", "projects", "name"]),
    }),
    async run(ctx, a) {
      const clients = await ctx.db.client.findMany({
        where: {
          ...(str(a.query) ? { OR: [{ name: ci(str(a.query)!) }, { legalName: ci(str(a.query)!) }] } : {}),
          ...(str(a.status) ? { status: str(a.status)!.toUpperCase() as ClientStatus } : {}),
          ...(a.include_archived ? {} : { archived: false }),
        },
        orderBy: { name: "asc" }, take: EXPORT_ROWS,
        include: {
          projects: { select: { value: true, currency: true, approved: true, approvalDate: true } },
          invoices: { where: { status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] } }, select: { kind: true, total: true, amountPaid: true, balanceMoved: true, currency: true, invoiceDate: true, status: true, dueDate: true } },
        },
      });
      const canMoney = can(ctx.actor, "invoices", "view");
      const rows = sortLimit(clients.map((c) => ({
        client: c.name, country: c.country, status: c.status, projects: c.projects.length,
        bv: r2(c.projects.filter((p) => p.approved).reduce((s, p) => s + (cc(ctx, p.value, p.currency, p.approvalDate) ?? 0), 0)),
        ...(canMoney ? {
          invoiced: r2(c.invoices.filter((i) => i.kind !== "BALANCE").reduce((s, i) => s + (cc(ctx, i.total, i.currency, i.invoiceDate) ?? 0), 0)),
          collected: r2(c.invoices.reduce((s, i) => s + (cc(ctx, i.amountPaid, i.currency, i.invoiceDate) ?? 0), 0)),
          outstanding: r2(c.invoices.reduce((s, i) => s + (cc(ctx, outstandingOf(i), i.currency, i.invoiceDate) ?? 0), 0)),
          overdue: r2(c.invoices.filter(isOverdue).reduce((s, i) => s + (cc(ctx, outstandingOf(i), i.currency, i.invoiceDate) ?? 0), 0)),
        } : {}),
        link: `/clients/${c.id}`,
      })), a, { business_value: "bv", invoiced: "invoiced", collected: "collected", outstanding: "outstanding", overdue: "overdue", projects: "projects", name: "client" });
      return present(ctx, "find_clients", {
        currency: ctx.currency,
        columns: [
          { key: "client", label: "Client", kind: "text" }, { key: "country", label: "Country", kind: "text" }, { key: "status", label: "Status", kind: "text" },
          { key: "projects", label: "Projects", kind: "number" }, { key: "bv", label: "Business value", kind: "money" },
          ...(canMoney ? [
            { key: "invoiced", label: "Invoiced", kind: "money" as const }, { key: "collected", label: "Collected", kind: "money" as const },
            { key: "outstanding", label: "Outstanding", kind: "money" as const }, { key: "overdue", label: "Overdue", kind: "money" as const },
          ] : []),
        ],
        rows,
      });
    },
  },
  {
    name: "find_projects", module: "projects", label: () => "Looking up projects",
    description: "List projects with client, status, manager, value, approval date and (if allowed) approved PO value, invoiced and collected; sort and limit.",
    parameters: obj({
      client: S("Client name (partial)"), status: S("DRAFT, IN_PROGRESS, ON_HOLD, COMPLETED or CANCELLED"), query: S("Code or name contains"),
      ...sortParams(["value", "po_value", "invoiced", "collected", "approved_on", "code"]),
    }),
    async run(ctx, a) {
      const clientIds = await resolveClientIds(ctx, str(a.client));
      const status = str(a.status)?.toUpperCase();
      const ps = await ctx.db.project.findMany({
        where: {
          ...(clientIds ? { clientId: { in: clientIds } } : {}),
          ...(status && status in ProjectStatus ? { status: status as ProjectStatus } : {}),
          ...(str(a.query) ? { OR: [{ code: ci(str(a.query)!) }, { name: ci(str(a.query)!) }] } : {}),
        },
        orderBy: { code: "asc" }, take: EXPORT_ROWS,
        include: {
          client: { select: { name: true } }, manager: { select: { name: true } },
          purchaseOrders: { where: { status: { in: [POStatus.APPROVED, POStatus.COMPLETED] } }, select: { value: true, currency: true, poDate: true } },
          invoices: { where: { status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] } }, select: { kind: true, total: true, amountPaid: true, currency: true, invoiceDate: true } },
        },
      });
      const canMoney = can(ctx.actor, "invoices", "view") && can(ctx.actor, "pos", "view");
      const rows = sortLimit(ps.map((p) => ({
        code: p.code, name: p.name, client: p.client.name, status: p.status, manager: p.manager?.name ?? null, approved: day(p.approvalDate),
        value: cc(ctx, p.value, p.currency, p.approvalDate ?? p.createdAt),
        ...(canMoney ? {
          po: r2(p.purchaseOrders.reduce((s, o) => s + (cc(ctx, o.value, o.currency, o.poDate) ?? 0), 0)),
          invoiced: r2(p.invoices.filter((i) => i.kind !== "BALANCE").reduce((s, i) => s + (cc(ctx, i.total, i.currency, i.invoiceDate) ?? 0), 0)),
          collected: r2(p.invoices.reduce((s, i) => s + (cc(ctx, i.amountPaid, i.currency, i.invoiceDate) ?? 0), 0)),
        } : {}),
        link: `/projects/${p.id}`,
      })), a, { value: "value", po_value: "po", invoiced: "invoiced", collected: "collected", approved_on: "approved", code: "code" });
      return present(ctx, "find_projects", {
        currency: ctx.currency,
        columns: [
          { key: "code", label: "Code", kind: "text" }, { key: "name", label: "Project", kind: "text" }, { key: "client", label: "Client", kind: "text" },
          { key: "status", label: "Status", kind: "text" }, { key: "manager", label: "Manager", kind: "text" }, { key: "approved", label: "Approved on", kind: "date" },
          { key: "value", label: "Project value", kind: "money" },
          ...(canMoney ? [{ key: "po", label: "Approved PO value", kind: "money" as const }, { key: "invoiced", label: "Invoiced", kind: "money" as const }, { key: "collected", label: "Collected", kind: "money" as const }] : []),
        ],
        rows,
      });
    },
  },
  {
    name: "summarize_billing", module: "invoices", label: (a) => `Totalling billing by ${String(a.group_by ?? "client")}`,
    description: "Grouped totals for comparisons: invoiced, collected, outstanding, overdue and invoice count, grouped by client, project, PO, month (of invoice date) or status, over an optional invoice-date range. Use this for comparisons instead of adding numbers yourself. Call it twice in the same turn to compare two periods.",
    parameters: obj({ group_by: S("client, project, po, month or status", { enum: ["client", "project", "po", "month", "status"] }), date_from: DATE_FROM, date_to: DATE_TO, client: S("Limit to a client (partial name)") }, ["group_by"]),
    async run(ctx, a) {
      const by = String(a.group_by ?? "client");
      const clientIds = await resolveClientIds(ctx, str(a.client));
      const invs = await ctx.db.invoice.findMany({
        where: {
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
          ...(clientIds ? { clientId: { in: clientIds } } : {}),
          ...(range(a) ? { invoiceDate: range(a) } : {}),
        },
        include: { client: { select: { name: true } }, project: { select: { code: true } }, po: { select: { poNumber: true } } },
      });
      const groups = new Map<string, { invoiced: number; collected: number; outstanding: number; overdue: number; count: number }>();
      for (const i of invs) {
        const k = by === "project" ? i.project.code : by === "po" ? i.po.poNumber : by === "month" ? (i.invoiceDate ? i.invoiceDate.toISOString().slice(0, 7) : "no date") : by === "status" ? i.status : i.client.name;
        const g = groups.get(k) ?? { invoiced: 0, collected: 0, outstanding: 0, overdue: 0, count: 0 };
        if (i.kind !== "BALANCE") { g.invoiced += cc(ctx, i.total, i.currency, i.invoiceDate) ?? 0; g.count++; }
        g.collected += cc(ctx, i.amountPaid, i.currency, i.invoiceDate) ?? 0;
        const out = cc(ctx, outstandingOf(i), i.currency, i.invoiceDate) ?? 0;
        g.outstanding += out;
        if (isOverdue(i)) g.overdue += out;
        groups.set(k, g);
      }
      const rows = [...groups.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, g]) => ({
        group: k, count: g.count, invoiced: r2(g.invoiced), collected: r2(g.collected), outstanding: r2(g.outstanding), overdue: r2(g.overdue),
        collection_rate: g.invoiced ? `${Math.round((g.collected / g.invoiced) * 1000) / 10}%` : "—",
      }));
      const from = date(a.date_from), to = date(a.date_to);
      return present(ctx, "summarize_billing", {
        currency: ctx.currency,
        columns: [
          { key: "group", label: by === "month" ? "Month" : by[0].toUpperCase() + by.slice(1), kind: "text" }, { key: "count", label: "Invoices", kind: "number" },
          { key: "invoiced", label: "Invoiced", kind: "money" }, { key: "collected", label: "Collected", kind: "money" },
          { key: "outstanding", label: "Outstanding", kind: "money" }, { key: "overdue", label: "Overdue", kind: "money" }, { key: "collection_rate", label: "Collected %", kind: "text" },
        ],
        rows,
        notes: [`Issued invoices only (drafts and cancelled excluded)${from || to ? `, invoice dates ${day(from) ?? "…"} to ${day(to) ?? "…"}` : ""}. Balance invoices are not counted as new billing.`],
      });
    },
  },
  {
    name: "summarize_collections", module: "invoices", label: () => "Totalling payments received",
    description: "Payments actually received (by payment date), grouped by month, client or payment method. Use for cash-collected questions.",
    parameters: obj({ group_by: S("month, client or method", { enum: ["month", "client", "method"] }), date_from: DATE_FROM, date_to: DATE_TO }, ["group_by"]),
    async run(ctx, a) {
      const by = String(a.group_by ?? "month");
      const ps = await ctx.db.payment.findMany({
        where: { state: "VALID", ...(range(a) ? { paymentDate: range(a) } : {}) },
        include: { invoice: { select: { client: { select: { name: true } } } } },
      });
      const g = new Map<string, { amount: number; count: number }>();
      for (const p of ps) {
        const k = by === "client" ? p.invoice.client.name : by === "method" ? p.method : p.paymentDate.toISOString().slice(0, 7);
        const x = g.get(k) ?? { amount: 0, count: 0 };
        x.amount += cc(ctx, p.amount, p.currency, p.paymentDate) ?? 0; x.count++;
        g.set(k, x);
      }
      return present(ctx, "summarize_collections", {
        currency: ctx.currency,
        columns: [{ key: "group", label: by === "month" ? "Month" : by === "method" ? "Method" : "Client", kind: "text" }, { key: "count", label: "Payments", kind: "number" }, { key: "amount", label: "Collected", kind: "money" }],
        rows: [...g.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => ({ group: k, count: x.count, amount: r2(x.amount) })),
        notes: ["Valid (not reversed) payments, by payment date."],
      });
    },
  },
  {
    name: "run_report", module: "reports", label: (a) => `Running the ${getReport(String(a.report_id ?? ""))?.title ?? "report"}`,
    description: `Run one of the built-in reports. Report ids: ${REPORTS.map((r) => `${r.id} (${r.title})`).join("; ")}.`,
    parameters: obj({ report_id: S("Report id", { enum: REPORTS.map((r) => r.id) }), date_from: DATE_FROM, date_to: DATE_TO, client: S("Client name (partial)"), status: S("Status filter, if the report supports one"), year: N("Year, for yearly reports") }, ["report_id"]),
    async run(ctx, a) {
      const def = getReport(String(a.report_id ?? ""));
      if (!def) return { error: "Unknown report id" };
      const clientIds = await resolveClientIds(ctx, str(a.client));
      const r = await runReport(ctx.db, def, {
        from: date(a.date_from), to: date(a.date_to), clientId: clientIds?.[0], status: str(a.status)?.toUpperCase(),
        year: typeof a.year === "number" ? a.year : undefined,
      }, ctx.rates);
      return present(ctx, "run_report", {
        currency: ctx.currency,
        columns: r.columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind === "money" ? "money" : c.kind === "number" ? "number" : c.kind === "date" ? "date" : "text" })),
        rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c) => {
          const v = row[c.key];
          if (isMoney(v)) return [c.key, v.converted != null ? num(v.converted) : v.currency === ctx.currency ? num(v.amount) : null];
          if (isLink(v)) return [c.key, v.text];
          if (v instanceof Date) return [c.key, day(v)];
          return [c.key, v as string | number | null];
        }))),
        notes: [def.title, ...r.notes],
      }, { report: def.title });
    },
  },
  {
    name: "create_export", module: null, label: (a) => `Creating the ${a.format === "docx" ? "Word" : a.format === "pdf" ? "PDF" : "Excel"} file`,
    description: "Create a downloadable Excel (xlsx), Word (docx) or PDF file. Prefer source_table (a table_handle returned by another tool) so numbers are exact; or pass columns and rows you composed (e.g. a comparison). Totals are added automatically.",
    parameters: obj({
      title: S("Report title shown in the file"), format: S("xlsx, docx or pdf", { enum: ["xlsx", "docx", "pdf"] }),
      source_table: S("table_handle from an earlier tool result in this answer"),
      columns: { type: "ARRAY", description: "Column definitions when composing a table yourself", items: obj({ label: S("Header"), kind: S("text, number, money or date", { enum: ["text", "number", "money", "date"] }) }, ["label", "kind"]) },
      rows: { type: "ARRAY", description: "Rows when composing a table yourself; each row is an array of cell values (as strings) in column order", items: { type: "ARRAY", items: { type: "STRING" } } },
      notes: { type: "ARRAY", items: { type: "STRING" }, description: "Optional notes under the title" },
    }, ["title", "format"]),
    async run(ctx, a) {
      if (!can(ctx.actor, "reports", "export") && !can(ctx.actor, "invoices", "export")) throw new ForbiddenError("reports", "export");
      const format = String(a.format ?? "") as ExportFormat;
      if (!["xlsx", "docx", "pdf"].includes(format)) return { error: "format must be xlsx, docx or pdf" };
      const title = (str(a.title) ?? "Report").slice(0, 120);
      let table: DataTable | undefined;
      if (str(a.source_table)) {
        table = ctx.tables.get(str(a.source_table)!);
        if (!table) return { error: `Unknown source_table. Available: ${[...ctx.tables.keys()].join(", ") || "none — call a data tool first"}` };
        table = { ...table, rows: table.rows.map(({ link: _l, ...r }) => r) };
      } else {
        const cols = Array.isArray(a.columns) ? (a.columns as { label?: string; kind?: string }[]) : [];
        const rows = Array.isArray(a.rows) ? (a.rows as unknown[][]) : [];
        if (!cols.length) return { error: "Provide source_table, or columns and rows" };
        const columns = cols.map((c, i) => ({ key: `c${i}`, label: String(c.label ?? `Column ${i + 1}`), kind: (["text", "number", "money", "date"].includes(String(c.kind)) ? c.kind : "text") as DataTable["columns"][number]["kind"] }));
        table = {
          currency: ctx.currency, columns,
          rows: rows.slice(0, EXPORT_ROWS).map((r) => Object.fromEntries(columns.map((c, i) => {
            const v = Array.isArray(r) ? r[i] : null;
            if (c.kind === "money" || c.kind === "number") { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return [c.key, v === null || v === "" || !Number.isFinite(n) ? (v as string | null) : n]; }
            return [c.key, v === null || v === undefined ? null : String(v)];
          }))),
        };
      }
      if (Array.isArray(a.notes)) table.notes = [...(table.notes ?? []), ...(a.notes as unknown[]).map(String).slice(0, 5)];
      const f = await createExport(ctx.actor.id, title, format, table);
      const file: AssistantFile = { name: f.name, title, format, url: `/api/assistant/files/${encodeURIComponent(f.name)}`, size: f.size };
      ctx.files.push(file);
      await ctx.db.$transaction((tx) => audit(tx, ctx.actor, "assistant.exported", "Assistant", f.name, { after: { title, format, rows: table!.rows.length } }));
      return { ok: true, file: f.name, rows: table.rows.length, message: "The file is attached to your answer as a download button; do not paste a link to it." };
    },
  },
];

function toolsFor(actor: Actor) {
  return TOOLS.filter((t) => t.module === null || can(actor, t.module, "view"));
}

function systemPrompt(ctx: Ctx, company: string, allowed: string[]) {
  return [
    `You are the analytics assistant inside "${company}"'s Invoice + CRM system. Today is ${day(today())}.`,
    `The user is ${ctx.actor.name} (group: ${ctx.actor.groupName}). They may see: ${allowed.join(", ") || "nothing"}. If they ask about anything else, say they don't have access.`,
    `All amounts are in ${ctx.currency} (the company currency). Older amounts in other currencies are already converted by the tools.`,
    "Rules:",
    "- Answer only from tool results. Never invent invoices, numbers, dates or names. If the data doesn't contain it, say so.",
    "- Be efficient: use as few tool calls as possible. Use sort_by/limit and include_details to answer in one lookup (e.g. 'my largest PO' = find_purchase_orders sort_by value, limit 1, include_details). When several lookups are independent, request them all in the same turn.",
    "- Tool tables come as `columns` plus `rows` of values in the same order.",
    "- For totals, comparisons and rankings use summarize_billing / summarize_collections / column_totals rather than adding numbers yourself.",
    "- This system records revenue (PO value, invoiced, collected, outstanding) but NOT costs or expenses, so profit, loss and margin cannot be calculated. If asked, explain that and offer revenue-side figures instead.",
    "- When the user asks for Excel, Word or PDF (or a file/export/download), call create_export with format xlsx, docx or pdf, preferably with source_table set to a table_handle from a data tool.",
    "- Reply in concise Markdown: a one-line answer first, then a table when there are several rows (max ~25 rows; mention if more exist and offer an export). Format money with thousands separators and the currency code.",
    "- Link records with Markdown links using the `link` values from tool results, e.g. [INV-2026-00012](/invoices/abc).",
    "- Statuses: invoices DRAFT/UNPAID/PARTIALLY_PAID/PAID/CANCELLED; overdue = past due date with an outstanding balance. A BALANCE invoice re-bills the unpaid part of an earlier invoice.",
  ].join("\n");
}

/**
 * Answer a conversation. History is plain text turns; tool calls happen within this request only.
 * `onEvent` (optional) receives live steps and streamed answer text.
 */
export async function askAssistant(
  db: Db, actor: Actor, history: ChatTurn[], opts: { retryDelays?: number[]; onEvent?: (e: AssistantEvent) => void } = {},
): Promise<AssistantReply> {
  if (!can(actor, "assistant", "view")) throw new ForbiddenError("assistant", "view");
  const cfg = await aiConfig(db);
  if (!cfg.apiKey) throw new RuleError("The AI assistant isn't set up yet. An administrator can add a Google API key under Settings → AI assistant.");
  const turns = history.filter((t) => t.text.trim()).slice(-20).map((t) => ({ ...t, text: t.text.slice(0, 8000) }));
  if (!turns.length || turns[turns.length - 1].role !== "user") throw new RuleError("Ask a question first");

  const { company } = await getSettings(db);
  const ctx: Ctx = { db, actor, currency: company.defaultCurrency, rates: await loadRateBook(db, company.defaultCurrency), files: [], tables: new Map() };
  const tools = toolsFor(actor);
  const declarations = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const allowed = (["clients", "projects", "pos", "invoices", "reports"] as Module[]).filter((m) => can(actor, m, "view"));
  const system = systemPrompt(ctx, company.displayName, allowed);
  const contents: GeminiContent[] = turns.map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] }));
  const steps: string[] = [];
  const emit = opts.onEvent ?? (() => {});

  let model = cfg.model;
  for (let i = 0; i < MAX_STEPS; i++) {
    let streamedText = false;
    // Busy model → retried; on the first step only, a backup model may take over for the whole answer
    // (switching mid-answer would mix one model's tool-call signatures into another's conversation).
    const { reply, model: used } = await generateResilient(cfg.apiKey, model, { system, contents, tools: declarations }, {
      allowFallback: i === 0, delays: opts.retryDelays,
      onText: (d) => { streamedText = true; emit({ type: "text", delta: d }); },
    });
    if (used !== model) steps.push(`fallback:${used}`);
    model = used;
    contents.push(reply); // keep model parts verbatim (thought signatures must round-trip)
    const calls = reply.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = reply.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      await db.$transaction((tx) => audit(tx, actor, "assistant.asked", "Assistant", actor.id, { after: { question: turns[turns.length - 1].text.slice(0, 500), tools: steps, model } }));
      return { text: text || (ctx.files.length ? "Your file is ready." : "I couldn't find an answer to that."), files: ctx.files, steps };
    }
    if (streamedText) emit({ type: "reset" }); // text before a tool call was a preamble, not the answer

    // Independent lookups requested in the same turn run in parallel
    const responses: GeminiPart[] = await Promise.all(calls.map(async (p) => {
      const { name, args = {}, id } = p.functionCall!;
      const tool = tools.find((t) => t.name === name);
      steps.push(name);
      if (tool) emit({ type: "step", label: tool.label(args) });
      let result: ToolResult;
      try {
        result = tool ? await tool.run(ctx, args) : { error: `Unknown tool ${name}` };
      } catch (e) {
        result = { error: e instanceof ForbiddenError || e instanceof RuleError ? e.message : "The lookup failed." };
        if (!(e instanceof ForbiddenError || e instanceof RuleError)) console.error("assistant tool failed", name, e);
      }
      return { functionResponse: { ...(id ? { id } : {}), name, response: { result } } };
    }));
    contents.push({ role: "user", parts: responses });
    emit({ type: "step", label: "Writing the answer" });
  }
  return { text: "That needed too many steps. Please ask a narrower question (e.g. one client or one period).", files: ctx.files, steps };
}
