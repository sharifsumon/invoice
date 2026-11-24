import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { InvoiceStatus, POStatus, ProjectStatus, Role } from "@/generated/prisma/enums";
import { createClient } from "@/server/core/clients";
import { createProject, transitionProject, updateProject, businessValue } from "@/server/core/projects";
import { approvePO, createPO, generateMilestoneInvoices, poBalance, transitionPO } from "@/server/core/pos";
import { cancelAndReissue, cancelInvoice, createManualInvoice, finalizeInvoice, isOverdue, updateDraftInvoice } from "@/server/core/invoices";
import { getSettings, updateCompany } from "@/server/core/settings";
import { storageRoot } from "@/server/core/storage";
import { dec } from "@/server/core/money";
import type { Actor } from "@/server/core/common";
import { baseSettings, cl, ct, makeActor, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let bd: Actor;
let viewer: Actor;

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  bd = await makeActor(db, Role.BUSINESS_DEVELOPMENT);
  viewer = await makeActor(db, Role.VIEWER);
});
afterAll(async () => db.$disconnect());

async function approvedProject(value = "10000", currency = "USD") {
  const c = await createClient(db, bd, cl(uid("Client")), [ct("Jane", "Doe")]);
  // Projects are created in the company currency; set another one directly to simulate older multi-currency data.
  const p = await db.project.update({ where: { id: (await createProject(db, bd, { code: uid("P"), name: "Proj", clientId: c.id, value })).id }, data: { currency } });
  await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS, { approvalDate: "2026-03-15" });
  return p;
}

async function po(projectId: string, value: string, milestones: [string, string][] = []) {
  return createPO(db, finance, {
    poNumber: uid("PO"), projectId, poDate: "2026-04-01", value,
    milestones: milestones.map(([name, percentage]) => ({ name, percentage })),
  });
}

describe("Business value (BR-01..03, BR-12)", () => {
  it("counts only approved projects, once, per currency — POs never add to it", async () => {
    const before = await businessValue(db);
    const get = (rows: typeof before, cur: string) => rows.find((r) => r.currency === cur)?.value ?? dec(0);

    const p = await approvedProject("5000", "EUR");
    await po(p.id, "3000");
    await po(p.id, "4000");
    const c = await createClient(db, bd, cl(uid("C")), [ct()]);
    const d = await createProject(db, bd, { code: uid("D"), name: "Draft only", clientId: c.id, value: "99999" });
    await db.project.update({ where: { id: d.id }, data: { currency: "EUR" } });

    const after = await businessValue(db);
    expect(get(after, "EUR").minus(get(before, "EUR")).toString()).toBe("5000");
    expect(get(after, "USD").eq(get(before, "USD"))).toBe(true);
  });

  it("drops out when an approved project is cancelled", async () => {
    const p = await approvedProject("777", "GBP");
    const b1 = (await businessValue(db)).find((r) => r.currency === "GBP")!.value;
    await transitionProject(db, admin, p.id, ProjectStatus.CANCELLED);
    const b2 = (await businessValue(db)).find((r) => r.currency === "GBP")?.value ?? dec(0);
    expect(b1.minus(b2).toString()).toBe("777");
  });

  it("requires a reason to change an approved project's value and audits old/new", async () => {
    const p = await approvedProject("1000");
    const base = { code: p.code, name: p.name, clientId: p.clientId, value: "1500", currency: "USD" };
    await expect(updateProject(db, admin, p.id, base)).rejects.toThrow(/reason is required/);
    await updateProject(db, admin, p.id, base, "Scope extended");
    const log = await db.auditLog.findFirst({ where: { entityId: p.id, action: "project.value_changed" } });
    expect(log?.reason).toBe("Scope extended");
    expect(log?.before).toMatchObject({ value: "1000" });
    expect(log?.after).toMatchObject({ value: "1500" });
  });

  it("project codes are auto-numbered with the Settings prefix, ignore typed codes and never change", async () => {
    const { company } = await getSettings(db);
    const keep = { legalName: company.legalName, displayName: company.displayName, defaultCurrency: company.defaultCurrency, paymentTermsDays: company.paymentTermsDays };
    await updateCompany(db, admin, { ...keep, projectCodePrefix: "TST-" });
    try {
      const c = await createClient(db, bd, cl(uid("C")), [ct()]);
      const a = await createProject(db, bd, { code: "TYPED-1", name: "a", clientId: c.id, value: "1" });
      const b = await createProject(db, bd, { name: "b", clientId: c.id, value: "1" });
      expect(a.code).toMatch(/^TST-\d{4,}$/);
      expect(b.code).toMatch(/^TST-\d{4,}$/);
      expect(Number(b.code.slice(4))).toBeGreaterThan(Number(a.code.slice(4)));
      const u = await updateProject(db, bd, a.id, { code: "CHANGED", name: "a2", clientId: c.id, value: "1" });
      expect(u.code).toBe(a.code);
      await expect(updateCompany(db, admin, { ...keep, projectCodePrefix: "bad prefix!" })).rejects.toThrow(/prefix/);
    } finally {
      await updateCompany(db, admin, { ...keep, projectCodePrefix: company.projectCodePrefix });
    }
  });

  it("new projects always use the company currency from Settings, and edits never change it", async () => {
    const { company } = await getSettings(db);
    const c = await createClient(db, bd, cl(uid("C")), [ct()]);
    const p = await createProject(db, bd, { code: uid("P"), name: "cur", clientId: c.id, value: "10", currency: "JPY" });
    expect(p.currency).toBe(company.defaultCurrency);
    const u = await updateProject(db, bd, p.id, { code: p.code, name: p.name, clientId: c.id, value: "10", currency: "JPY" });
    expect(u.currency).toBe(company.defaultCurrency);
    const o = await po(p.id, "5");
    expect(o.currency).toBe(company.defaultCurrency);
  });

  it("only approvers can start a draft project, and starting it approves it", async () => {
    const c = await createClient(db, bd, cl(uid("C")), [ct()]);
    const p = await createProject(db, bd, { code: uid("P"), name: "x", clientId: c.id, value: "1", currency: "USD" });
    expect(p.status).toBe(ProjectStatus.DRAFT);
    await expect(transitionProject(db, bd, p.id, ProjectStatus.IN_PROGRESS)).rejects.toThrow(/permission/);
    await transitionProject(db, bd, p.id, ProjectStatus.ON_HOLD); // not a start: edit permission is enough
    const started = await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS, { approvalDate: "2026-05-01" });
    expect(started.approved).toBe(true);
    expect(started.approvalDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
    await transitionProject(db, bd, p.id, ProjectStatus.ON_HOLD); // on hold keeps the approval
    expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).approved).toBe(true);
  });

  it("a project with POs cannot go back to Draft; cancelled projects reopen as Draft", async () => {
    const p = await approvedProject("50");
    await po(p.id, "10");
    await expect(transitionProject(db, admin, p.id, ProjectStatus.DRAFT)).rejects.toThrow(/back to Draft/);
    const c = await createClient(db, bd, cl(uid("C")), [ct()]);
    const q = await createProject(db, bd, { code: uid("P"), name: "y", clientId: c.id, value: "1", currency: "USD" });
    await transitionProject(db, bd, q.id, ProjectStatus.CANCELLED);
    await expect(transitionProject(db, bd, q.id, ProjectStatus.COMPLETED)).rejects.toThrow(/Cannot move/);
    expect((await transitionProject(db, bd, q.id, ProjectStatus.DRAFT)).status).toBe(ProjectStatus.DRAFT);
  });
});

describe("PO approval & automatic milestone invoices (BR-04..06)", () => {
  it("refuses to create a PO whose milestones do not total 100%, leaving nothing behind", async () => {
    const p = await approvedProject();
    const number = uid("PO");
    await expect(createPO(db, finance, { poNumber: number, projectId: p.id, poDate: "2026-04-01", value: "1000",
      milestones: [{ name: "A", percentage: "50" }, { name: "B", percentage: "40" }] })).rejects.toThrow(/exactly 100%/);
    expect(await db.purchaseOrder.count({ where: { poNumber: number } })).toBe(0);
  });

  it("a new PO is submitted for approval with one pending invoice per milestone (exact amounts)", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000.00", [["Kickoff", "33.3333"], ["Build", "33.3333"], ["Go-live", "33.3334"]]);
    expect(o.status).toBe(POStatus.SUBMITTED);
    const invs = await db.invoice.findMany({ where: { poId: o.id }, orderBy: { createdAt: "asc" } });
    expect(invs.map((i) => i.subtotal.toString())).toEqual(["333.33", "333.33", "333.34"]);
    expect(invs.every((i) => i.status === InvoiceStatus.DRAFT && i.milestoneId)).toBe(true);
    // Pending approval: cannot be finalized yet
    await expect(finalizeInvoice(db, finance, invs[0].id, { invoiceDate: "2026-04-02" })).rejects.toThrow(/pending approval/);
    // Approval releases them (no duplicates created)
    const r = await approvePO(db, finance, o.id);
    expect(r.generated).toBe(0);
    expect(await db.invoice.count({ where: { poId: o.id, status: { not: InvoiceStatus.CANCELLED } } })).toBe(3);
    const fin = await finalizeInvoice(db, finance, invs[0].id, { invoiceDate: "2026-04-02" });
    expect(fin.status).toBe(InvoiceStatus.UNPAID);
  });

  it("milestone draft: the line description can be reworded, the amount cannot change", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "600", [["Phase 1", "100"]]);
    const inv = await db.invoice.findFirstOrThrow({ where: { poId: o.id }, include: { lineItems: true } });
    await updateDraftInvoice(db, finance, inv.id, { lines: [{ description: "Phase 1 — design sign-off", quantity: "5", unitPrice: "1" }] });
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lineItems: true } });
    expect(after.lineItems[0].description).toBe("Phase 1 — design sign-off");
    expect(after.lineItems[0].amount.toString()).toBe("600");
    expect(after.subtotal.toString()).toBe("600");
    await expect(updateDraftInvoice(db, finance, inv.id, { lines: [{ description: "a", unitPrice: "1" }, { description: "b", unitPrice: "1" }] }))
      .rejects.toThrow(/cannot be added or removed/);
  });

  it("rejecting a submitted PO cancels its pending invoices; resubmitting drafts them again", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "800", [["A", "50"], ["B", "50"]]);
    await transitionPO(db, admin, o.id, POStatus.REJECTED);
    const after = await db.invoice.findMany({ where: { poId: o.id } });
    expect(after.length).toBe(2);
    expect(after.every((i) => i.status === InvoiceStatus.CANCELLED && i.cancelReason)).toBe(true);
    await transitionPO(db, finance, o.id, POStatus.DRAFT);
    await transitionPO(db, finance, o.id, POStatus.SUBMITTED);
    expect(await db.invoice.count({ where: { poId: o.id, status: InvoiceStatus.DRAFT } })).toBe(2);
  });

  it("is idempotent — retries never duplicate milestone invoices", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "500", [["A", "50"], ["B", "50"]]);
    await approvePO(db, finance, o.id);
    expect(await generateMilestoneInvoices(db, finance, o.id)).toBe(0);
    await Promise.all([1, 2, 3].map(() => generateMilestoneInvoices(db, finance, o.id)));
    expect(await db.invoice.count({ where: { poId: o.id } })).toBe(2);
    await expect(approvePO(db, finance, o.id)).rejects.toThrow(/Cannot approve/);
  });

  it("the database blocks a second valid invoice for the same milestone", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "500", [["A", "100"]]);
    await approvePO(db, finance, o.id);
    const existing = await db.invoice.findFirstOrThrow({ where: { poId: o.id } });
    await expect(
      db.invoice.create({
        data: { ...pick(existing), id: undefined, invoiceNumber: null, subtotal: dec("0.01"), total: dec("0.01") },
      }),
    ).rejects.toThrow();
  });

  it("only approvers can approve POs", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "100", [["A", "100"]]);
    await expect(approvePO(db, viewer, o.id)).rejects.toThrow(/permission/);
  });
});

describe("Strict PO cap (BR-07, BR-08, BR-10)", () => {
  it("allows manual invoices only within the remaining balance", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000");
    await approvePO(db, finance, o.id);
    await createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "Phase 1", unitPrice: "600" }] });
    await expect(
      createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "Phase 2", unitPrice: "400.01" }] }),
    ).rejects.toThrow(/exceeds the remaining invoiceable PO balance of 400.00/);
    await createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "Phase 2", quantity: "4", unitPrice: "100" }] });
    const bal = await poBalance(db, o.id);
    expect(bal.remaining.toString()).toBe("0");
  });

  it("no manual invoice once milestones consume 100% — even for an administrator", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000", [["A", "100"]]);
    await approvePO(db, admin, o.id);
    await expect(
      createManualInvoice(db, admin, { poId: o.id, lines: [{ description: "Extra", unitPrice: "0.01" }] }),
    ).rejects.toThrow(/remaining invoiceable/);
  });

  it("the database trigger enforces the cap even if application checks are bypassed", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "100", [["A", "100"]]);
    await approvePO(db, admin, o.id);
    const inv = await db.invoice.findFirstOrThrow({ where: { poId: o.id } });
    await expect(db.invoice.update({ where: { id: inv.id }, data: { subtotal: dec("100.01"), total: dec("100.01") } })).rejects.toThrow(/PO_CAP_EXCEEDED/);
  });

  it("concurrent manual invoices cannot exceed the PO value", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000");
    await approvePO(db, finance, o.id);
    const attempts = Array.from({ length: 8 }, (_, i) =>
      createManualInvoice(db, finance, { poId: o.id, lines: [{ description: `Concurrent ${i}`, unitPrice: "300" }] }),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3);
    const bal = await poBalance(db, o.id);
    expect(bal.invoiced.toString()).toBe("900");
    expect(bal.remaining.toString()).toBe("100");
  });

  it("rejects invoices on unapproved POs", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000");
    await expect(
      createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "x", unitPrice: "1" }] }),
    ).rejects.toThrow(/approved PO/);
  });

  it("manual invoices cannot re-invoice an already invoiced milestone", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000", [["A", "50"], ["B", "50"]]);
    await approvePO(db, finance, o.id);
    const ms = await db.paymentMilestone.findFirstOrThrow({ where: { poId: o.id, sequence: 1 } });
    await expect(
      createManualInvoice(db, finance, { poId: o.id, milestoneId: ms.id, lines: [{ description: "dup", unitPrice: "1" }] }),
    ).rejects.toThrow(/already been invoiced|remaining/);
  });

  it("editing a draft manual invoice is also capped", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000");
    await approvePO(db, finance, o.id);
    const inv = await createManualInvoice(db, finance, { poId: o.id, lines: [{ description: "x", unitPrice: "500" }] });
    await updateDraftInvoice(db, finance, inv.id, { lines: [{ description: "x", unitPrice: "1000" }] });
    await expect(updateDraftInvoice(db, finance, inv.id, { lines: [{ description: "x", unitPrice: "1000.01" }] })).rejects.toThrow(/exceeds/);
  });
});

describe("Cancellation releases allocation (BR-09)", () => {
  it("frees the PO balance, keeps history, and lets the milestone be invoiced again", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000", [["A", "100"]]);
    await approvePO(db, finance, o.id);
    const inv = await db.invoice.findFirstOrThrow({ where: { poId: o.id } });
    await expect(cancelInvoice(db, finance, inv.id, "")).rejects.toThrow(/reason/);
    await cancelInvoice(db, finance, inv.id, "Wrong client contact");
    expect((await poBalance(db, o.id)).remaining.toString()).toBe("1000");
    expect(await db.invoice.findUnique({ where: { id: inv.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "Wrong client contact" });
    expect(await db.auditLog.count({ where: { entityId: inv.id, action: "invoice.cancelled" } })).toBe(1);
    expect(await generateMilestoneInvoices(db, finance, o.id)).toBe(1);
  });

  it("cancel & reissue creates a versioned replacement within the cap", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "1000", [["A", "100"]]);
    await approvePO(db, finance, o.id);
    const inv = await db.invoice.findFirstOrThrow({ where: { poId: o.id } });
    await finalizeInvoice(db, finance, inv.id, { invoiceDate: "2026-05-01" });
    const copy = await cancelAndReissue(db, finance, inv.id, "Typo in address");
    expect(copy.version).toBe(2);
    expect(copy.status).toBe(InvoiceStatus.DRAFT);
    expect((await poBalance(db, o.id)).remaining.toString()).toBe("0");
  });
});

describe("Finalization, numbering & document snapshot (BR-14)", () => {
  it("assigns sequential unique numbers and stores a PDF that later settings changes do not alter", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "900", [["A", "50"], ["B", "50"]]);
    await approvePO(db, finance, o.id);
    const [a, b] = await db.invoice.findMany({ where: { poId: o.id }, orderBy: { createdAt: "asc" } });
    const fa = await finalizeInvoice(db, finance, a.id, { invoiceDate: "2026-06-01" });
    const fb = await finalizeInvoice(db, finance, b.id, { invoiceDate: "2026-06-01" });
    expect(fa.invoiceNumber).toMatch(/^INV-2026-\d{5}$/);
    const na = Number(fa.invoiceNumber!.split("-").pop());
    const nb = Number(fb.invoiceNumber!.split("-").pop());
    expect(nb).toBe(na + 1);
    expect(fa.status).toBe(InvoiceStatus.UNPAID);
    expect(fa.dueDate?.toISOString().slice(0, 10)).toBe("2026-07-01");

    const doc = await db.invoiceDocument.findFirstOrThrow({ where: { invoiceId: a.id } });
    const file = path.join(storageRoot(), doc.filePath);
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    await updateCompany(db, admin, {
      legalName: "Renamed Ltd", displayName: "Renamed", defaultCurrency: "USD", paymentTermsDays: 15,
    });
    const after = await db.invoice.findUniqueOrThrow({ where: { id: a.id } });
    expect((after.snapshot as { company: { displayName: string } }).company.displayName).toBe("Test Co");
    expect(readFileSync(file).equals(bytes)).toBe(true);

    await expect(finalizeInvoice(db, finance, a.id)).rejects.toThrow(/Only draft/);
    await expect(updateDraftInvoice(db, finance, a.id, { notes: "x" })).rejects.toThrow(/Only draft/);
  });

  it("flags overdue separately from payment status", () => {
    const base = { total: dec(100), amountPaid: dec(40), dueDate: new Date("2026-01-01") };
    expect(isOverdue({ ...base, status: InvoiceStatus.PARTIALLY_PAID }, new Date("2026-02-01"))).toBe(true);
    expect(isOverdue({ ...base, status: InvoiceStatus.CANCELLED }, new Date("2026-02-01"))).toBe(false);
    expect(isOverdue({ ...base, status: InvoiceStatus.UNPAID }, new Date("2025-12-01"))).toBe(false);
  });
});

describe("Audit log is append-only", () => {
  it("cannot be updated or deleted", async () => {
    const row = await db.auditLog.findFirstOrThrow();
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("PO lifecycle guards", () => {
  it("approved POs are locked and cannot be cancelled while invoices are valid", async () => {
    const p = await approvedProject();
    const o = await po(p.id, "100", [["A", "100"]]);
    await approvePO(db, finance, o.id);
    await expect(transitionPO(db, finance, o.id, POStatus.CANCELLED, "client withdrew")).rejects.toThrow(/Cancel all valid invoices/);
  });
});

function pick(i: Record<string, unknown>) {
  const { kind, status, clientId, projectId, poId, milestoneId, currency } = i as Record<string, never>;
  return { kind, status, clientId, projectId, poId, milestoneId, currency };
}
