import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationEvent, PaymentMethod, ProjectStatus, Role } from "@/generated/prisma/enums";
import { createClient } from "@/server/core/clients";
import { createProject, transitionProject } from "@/server/core/projects";
import { approvePO, createPO } from "@/server/core/pos";
import { createManualInvoice, finalizeInvoice } from "@/server/core/invoices";
import { recordPayment } from "@/server/core/payments";
import { addRate, loadRateBook } from "@/server/core/fx";
import { getReport, isMoney, runReport, type MoneyCell } from "@/server/core/reports";
import { toCsv, toPdf, toXlsx } from "@/server/core/report-export";
import { scanDueNotifications, setNotificationSetting } from "@/server/core/notifications";
import { sendInvoiceEmail } from "@/server/core/email";
import { globalSearch } from "@/server/core/search";
import { addDays, today, type Actor } from "@/server/core/common";
import { dec } from "@/server/core/money";
import { getSettings } from "@/server/core/settings";
import { baseSettings, cl, ct, makeActor, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let pm: Actor;
let clientId: string;
const CUR = "SGD"; // a currency no other test file uses, so totals are isolated

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  pm = await makeActor(db, Role.PROJECT_MANAGER);
  const c = await createClient(db, admin, cl(uid("Report Client")), [ct("Rita", "Report")]);
  clientId = c.id;
});
afterAll(async () => db.$disconnect());

async function project(value: string, approve: boolean, approvalDate = "2026-03-10", currency = CUR) {
  // The app now creates projects in the company currency; other currencies only exist as older data.
  const p = await db.project.update({ where: { id: (await createProject(db, admin, { code: uid("R"), name: "Rep", clientId, value })).id }, data: { currency } });
  if (approve) {
    await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS, { approvalDate });
  }
  return p;
}

async function issued(projectId: string, amount: string, invoiceDate: string, dueDate: string) {
  const po = await createPO(db, finance, { poNumber: uid("RPO"), projectId, poDate: invoiceDate, value: amount });
  await approvePO(db, finance, po.id);
  const inv = await createManualInvoice(db, finance, { poId: po.id, lines: [{ description: "x", unitPrice: amount }] });
  return finalizeInvoice(db, finance, inv.id, { invoiceDate, dueDate });
}

const totalOf = (r: Awaited<ReturnType<typeof runReport>>, key: string, cur: string) =>
  r.totals[key]?.find((t) => t.currency === cur)?.amount.toString() ?? "0";

describe("Reports", () => {
  it("project register: business value counts approved projects only", async () => {
    const a = await project("1000", true);
    await project("5000", false);
    const r = await runReport(db, getReport("projects")!, { clientId, currency: CUR, rc: CUR });
    expect(r.rows.length).toBe(2);
    expect(totalOf(r, "bv", CUR)).toBe("1000");
    expect(totalOf(r, "value", CUR)).toBe("6000");
    await project("700", true, "2025-12-31");
    const ranged = await runReport(db, getReport("projects")!, { clientId, currency: CUR, rc: CUR, from: new Date("2026-01-01"), to: new Date("2026-12-31") });
    expect(totalOf(ranged, "bv", CUR)).toBe("1000"); // 2025 approval excluded by approval-date filter
    expect(a).toBeTruthy();
  });

  it("PO register, aging, forecast and collections agree with the underlying records", async () => {
    const p = await project("3000", true);
    const t = today();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const overdueInv = await issued(p.id, "1000", iso(addDays(t, -50)), iso(addDays(t, -40)));  // 31–60 bucket
    await issued(p.id, "2000", iso(t), iso(addDays(t, 20)));                                        // not due
    await recordPayment(db, finance, overdueInv.id, { amount: "400", paymentDate: iso(addDays(t, -1)), method: PaymentMethod.CASH });

    const pos = await runReport(db, getReport("pos")!, { clientId, currency: CUR, rc: CUR });
    expect(totalOf(pos, "invoiced", CUR)).toBe("3000");
    expect(totalOf(pos, "paid", CUR)).toBe("400");

    const aging = await runReport(db, getReport("aging")!, { clientId, currency: CUR, rc: CUR });
    expect(totalOf(aging, "d60", CUR)).toBe("600");
    expect(totalOf(aging, "notDue", CUR)).toBe("2000");

    const fc = await runReport(db, getReport("forecast")!, { clientId, currency: CUR, rc: CUR });
    expect(fc.rows[0].month).toBe("Overdue (past due)");
    expect((fc.rows[0].amount as MoneyCell).amount.toString()).toBe("600");
    expect(totalOf(fc, "amount", CUR)).toBe("2600");

    const col = await runReport(db, getReport("collections")!, { clientId, currency: CUR, rc: CUR });
    expect(totalOf(col, "amount", CUR)).toBe("400");

    const perf = await runReport(db, getReport("client-performance")!, { clientId, currency: CUR, rc: CUR });
    expect(totalOf(perf, "outstanding", CUR)).toBe("2600");
    expect(totalOf(perf, "collected", CUR)).toBe("400");
  });

  it("never mixes currencies without a reporting currency; converts with recorded rates when asked", async () => {
    await project("100", true, "2026-05-01", "CHF");
    const r = await runReport(db, getReport("projects")!, { clientId });
    const { company } = await getSettings(db);
    expect(r.reportingCurrency).toBe(company.defaultCurrency); // always reported in the company currency
    expect(r.totals.bv.every((t) => t.currency === company.defaultCurrency)).toBe(true); // never mixed

    await addRate(db, admin, { fromCurrency: "CHF", toCurrency: "SGD", rate: "1.5", effectiveDate: "2026-01-01" });
    await addRate(db, admin, { fromCurrency: "CHF", toCurrency: "SGD", rate: "2", effectiveDate: "2026-06-01" }); // later rate must not apply to May
    const conv = await runReport(db, getReport("projects")!, { clientId, rc: "SGD", from: new Date("2026-05-01"), to: new Date("2026-05-01") });
    expect(conv.totals.bv).toEqual([{ currency: "SGD", amount: dec(150) }]);
    expect(conv.unconverted).toBe(0);

    const book = await loadRateBook(db, "CHF"); // inverse lookup
    expect(book.convert(dec(300), "SGD", "CHF", new Date("2026-07-01"))!.value.toString()).toBe("150");
    expect(book.convert(dec(1), "JPY", "CHF", new Date("2026-07-01"))).toBeNull();

    const missing = await runReport(db, getReport("projects")!, { clientId, rc: "JPY" });
    expect(missing.unconverted).toBeGreaterThan(0);
    expect(missing.notes.join(" ")).toMatch(/no recorded rate/);
  });

  it("exports CSV (with formula guard), XLSX and PDF", async () => {
    await createClient(db, admin, cl("=HYPERLINK(\"http://x\")"), [ct()]);
    const r = await runReport(db, getReport("clients")!, {});
    const csv = toCsv(r);
    expect(csv).toContain("'=HYPERLINK");
    const xlsx = await toXlsx("Clients", r);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const pdf = await toPdf("Projects", "test", await runReport(db, getReport("projects")!, { clientId }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const money = (await runReport(db, getReport("projects")!, { clientId })).rows.flatMap((row) => Object.values(row)).filter(isMoney);
    expect(money.length).toBeGreaterThan(0);
  });
});

describe("Notifications (BRD §5.9)", () => {
  it("PO approval notifies the configured roles, and settings can switch a role off", async () => {
    const p = await project("500", true);
    const po1 = await createPO(db, finance, { poNumber: uid("NPO"), projectId: p.id, poDate: "2026-04-01", value: "100" });
    await approvePO(db, finance, po1.id);
    expect(await db.notification.count({ where: { userId: pm.id, event: NotificationEvent.PO_APPROVED, link: `/pos/${po1.id}` } })).toBe(1);

    await setNotificationSetting(db, admin, NotificationEvent.PO_APPROVED, Role.PROJECT_MANAGER, false);
    const po2 = await createPO(db, finance, { poNumber: uid("NPO"), projectId: p.id, poDate: "2026-04-01", value: "100" });
    await approvePO(db, finance, po2.id);
    expect(await db.notification.count({ where: { userId: pm.id, link: `/pos/${po2.id}` } })).toBe(0);
    expect(await db.notification.count({ where: { userId: finance.id, link: `/pos/${po2.id}` } })).toBe(1);
  });

  it("failed milestone approval raises a generation-failure notification", async () => {
    const p = await project("500", true);
    const po = await createPO(db, finance, { poNumber: uid("NPO"), projectId: p.id, poDate: "2026-04-01", value: "100", milestones: [{ name: "Half", percentage: "50" }] });
    await expect(approvePO(db, finance, po.id)).rejects.toThrow(/100%/);
    expect(await db.notification.count({ where: { userId: finance.id, event: NotificationEvent.INVOICE_GENERATION_FAILED, link: `/pos/${po.id}` } })).toBe(1);
  });

  it("due/overdue scan is idempotent", async () => {
    const p = await project("900", true);
    const t = today();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const soon = await issued(p.id, "100", iso(t), iso(addDays(t, 3)));
    const late = await issued(p.id, "100", iso(addDays(t, -30)), iso(addDays(t, -2)));
    await scanDueNotifications(db);
    await scanDueNotifications(db);
    expect(await db.notification.count({ where: { userId: finance.id, event: "INVOICE_DUE_SOON", link: `/invoices/${soon.id}` } })).toBe(1);
    expect(await db.notification.count({ where: { userId: finance.id, event: "INVOICE_OVERDUE", link: `/invoices/${late.id}` } })).toBe(1);
  });

  it("email failures notify finance", async () => {
    const p = await project("100", true);
    const inv = await issued(p.id, "50", "2026-02-01", "2026-03-01");
    await sendInvoiceEmail(db, finance, inv.id, { to: ["x@example.com"], subject: "s", body: "b" }, {
      name: "test", from: "a@b.c", async send() { throw new Error("connection refused"); },
    });
    expect(await db.notification.count({ where: { userId: finance.id, event: "EMAIL_FAILED", link: `/invoices/${inv.id}#email` } })).toBe(1);
  });
});

describe("Global search", () => {
  it("finds clients, contacts, projects, POs and invoices", async () => {
    const name = uid("Zebra");
    const c = await createClient(db, admin, cl(name), [ct(name, "Contact", { email: "zz@zebra.example" })]);
    const p = await createProject(db, admin, { code: `${name}-P`, name: "Stripes", clientId: c.id, value: "1", currency: "USD" });
    const hits = await globalSearch(db, name);
    expect(hits.map((h) => h.type)).toEqual(expect.arrayContaining(["Client", "Contact", "Project"]));
    expect(hits.find((h) => h.type === "Project")?.href).toBe(`/projects/${p.id}`);
    expect(await globalSearch(db, "z")).toEqual([]);
  });
});
