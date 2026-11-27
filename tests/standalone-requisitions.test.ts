import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvoiceStatus, PaymentMethod } from "@/generated/prisma/enums";
import { createClient } from "@/server/core/clients";
import { buildSnapshot, cancelInvoice, createManualInvoice, finalizeInvoice } from "@/server/core/invoices";
import { recordPayment } from "@/server/core/payments";
import { createRequisition, submitRequisition, transitionRequisition, updateRequisition } from "@/server/core/requisitions";
import { createDepartment, deleteDepartment, renameDepartment, setDepartmentActive } from "@/server/core/departments";
import type { Actor } from "@/server/core/common";
import { baseSettings, cl, ct, makeActor, Role, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor, finance: Actor, management: Actor, pm: Actor, viewer: Actor, clientId: string;

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  management = await makeActor(db, Role.MANAGEMENT);
  pm = await makeActor(db, Role.PROJECT_MANAGER);
  viewer = await makeActor(db, Role.VIEWER);
  clientId = (await createClient(db, admin, cl(uid("Solo client")), [ct("Sam", "Solo", { isPrimary: true })])).id;
});
afterAll(() => db.$disconnect());

describe("individual (standalone) invoices", () => {
  it("creates, finalizes and collects an invoice with no project or PO", async () => {
    const inv = await createManualInvoice(db, finance, {
      clientId, lines: [{ description: "Consulting", quantity: "2", unitPrice: "150" }], taxRate: "10",
    });
    expect(inv.poId).toBeNull();
    expect(inv.projectId).toBeNull();
    expect(inv.total.toString()).toBe("330");

    const { snap } = await buildSnapshot(db, inv.id);
    expect(snap.po).toBeNull();
    expect(snap.project).toBeNull();

    const fin = await finalizeInvoice(db, finance, inv.id, { invoiceDate: "2026-03-01" });
    expect(fin.status).toBe(InvoiceStatus.UNPAID);
    expect(fin.invoiceNumber).toBeTruthy();

    await recordPayment(db, finance, inv.id, { amount: "330", paymentDate: "2026-03-05", method: PaymentMethod.BANK_TRANSFER });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe(InvoiceStatus.PAID);
  });

  it("requires a client and the create permission, and can be cancelled", async () => {
    await expect(createManualInvoice(db, finance, { lines: [{ description: "x", quantity: "1", unitPrice: "1" }] })).rejects.toThrow(/Choose a client/);
    await expect(createManualInvoice(db, viewer, { clientId, lines: [{ description: "x", quantity: "1", unitPrice: "1" }] })).rejects.toThrow(/permission/);
    const inv = await createManualInvoice(db, finance, { clientId, lines: [{ description: "Draft", quantity: "1", unitPrice: "10" }] });
    const c = await cancelInvoice(db, finance, inv.id, "Not needed");
    expect(c.status).toBe(InvoiceStatus.CANCELLED);
  });

  it("rejects a due date before the invoice date", async () => {
    await expect(createManualInvoice(db, finance, {
      clientId, invoiceDate: "2026-05-10", dueDate: "2026-05-01", lines: [{ description: "x", quantity: "1", unitPrice: "1" }],
    })).rejects.toThrow(/Due date/);
  });
});

describe("requisitions", () => {
  const items = [
    { description: "Laptop", quantity: "2", unit: "pcs", unitPrice: "1200" },
    { description: "USB-C dock", quantity: "2" },
  ];

  it("draft → submit (numbered) → approve → fulfil, with an estimated total", async () => {
    const dep = await createDepartment(db, admin, uid("Design"));
    const r = await createRequisition(db, pm, { title: "Design team kit", departmentId: dep.id, priority: "HIGH", items });
    expect(r.departmentId).toBe(dep.id);
    expect(r.status).toBe("DRAFT");
    expect(r.number).toBeNull();
    expect(r.estimatedTotal.toString()).toBe("2400");

    const s = await submitRequisition(db, pm, r.id);
    expect(s.status).toBe("SUBMITTED");
    expect(s.number).toMatch(/^REQ-\d{4}-\d{4}$/);

    await expect(transitionRequisition(db, pm, r.id, "APPROVED")).rejects.toThrow(/permission/);
    const a = await transitionRequisition(db, management, r.id, "APPROVED");
    expect(a.status).toBe("APPROVED");
    expect(a.decidedById).toBe(management.id);

    const f = await transitionRequisition(db, finance, r.id, "FULFILLED");
    expect(f.status).toBe("FULFILLED");
    expect(f.fulfilledAt).toBeTruthy();
  });

  it("can be submitted straight away, and rejected only with a reason", async () => {
    const r = await createRequisition(db, pm, { title: "Paper", items: [{ description: "A4 paper", quantity: "10", unit: "reams" }] }, { submit: true });
    expect(r.status).toBe("SUBMITTED");
    await expect(transitionRequisition(db, finance, r.id, "REJECTED")).rejects.toThrow(/reason/);
    const x = await transitionRequisition(db, finance, r.id, "REJECTED", "Use stock from the store room");
    expect(x.status).toBe("REJECTED");
    expect(x.decisionNote).toBe("Use stock from the store room");
  });

  it("approvers cannot approve their own request (unless admin)", async () => {
    const r = await createRequisition(db, management, { title: "Monitor", items: [{ description: "27in monitor", quantity: "1" }] }, { submit: true });
    await expect(transitionRequisition(db, management, r.id, "APPROVED")).rejects.toThrow(/own requisition/);
    const own = await createRequisition(db, admin, { title: "Chair", items: [{ description: "Chair", quantity: "1" }] }, { submit: true });
    expect((await transitionRequisition(db, admin, own.id, "APPROVED")).status).toBe("APPROVED");
  });

  it("only drafts can be edited; the requester can recall and cancel", async () => {
    const r = await createRequisition(db, pm, { title: "Cables", items: [{ description: "HDMI cable", quantity: "5" }] }, { submit: true });
    await expect(updateRequisition(db, pm, r.id, { title: "Cables", items: [{ description: "HDMI cable", quantity: "6" }] })).rejects.toThrow(/draft/);
    await transitionRequisition(db, pm, r.id, "DRAFT");
    const u = await updateRequisition(db, pm, r.id, { title: "Cables (more)", items: [{ description: "HDMI cable", quantity: "6", unitPrice: "5" }] });
    expect(u.estimatedTotal.toString()).toBe("30");
    // someone else's draft: PM has no "edit" on requisitions
    const other = await createRequisition(db, finance, { title: "Other", items: [{ description: "x", quantity: "1" }] });
    await expect(updateRequisition(db, pm, other.id, { title: "Hijack", items: [{ description: "x", quantity: "1" }] })).rejects.toThrow(/permission/);
    expect((await transitionRequisition(db, pm, r.id, "CANCELLED")).status).toBe("CANCELLED");
  });

  it("validates items and permissions", async () => {
    await expect(createRequisition(db, pm, { title: "Empty", items: [] })).rejects.toThrow();
    await expect(createRequisition(db, pm, { title: "Bad qty", items: [{ description: "x", quantity: "0" }] })).rejects.toThrow(/greater than zero/);
    await expect(createRequisition(db, viewer, { title: "No", items: [{ description: "x", quantity: "1" }] })).rejects.toThrow(/permission/);
  });
});

describe("departments", () => {
  it("admins add, rename, deactivate and delete departments; names are unique", async () => {
    const name = uid("Finance");
    const d = await createDepartment(db, admin, name);
    await expect(createDepartment(db, admin, name.toUpperCase())).rejects.toThrow(/already exists/);
    await expect(createDepartment(db, finance, uid("Nope"))).rejects.toThrow(/permission/);
    const renamed = await renameDepartment(db, admin, d.id, `${name} & Accounts`);
    expect(renamed.name).toBe(`${name} & Accounts`);

    // An inactive department can't be chosen for a new requisition, but stays on existing ones
    const r = await createRequisition(db, pm, { title: "Calculator", departmentId: d.id, items: [{ description: "Calculator", quantity: "1" }] });
    await setDepartmentActive(db, admin, d.id, false);
    await expect(createRequisition(db, pm, { title: "Pens", departmentId: d.id, items: [{ description: "Pens", quantity: "5" }] })).rejects.toThrow(/no longer active/);
    const kept = await updateRequisition(db, pm, r.id, { title: "Calculator (scientific)", departmentId: d.id, items: [{ description: "Calculator", quantity: "1" }] });
    expect(kept.departmentId).toBe(d.id);

    // Used departments can't be deleted; unused ones can
    await expect(deleteDepartment(db, admin, d.id)).rejects.toThrow(/Deactivate it instead/);
    const unused = await createDepartment(db, admin, uid("Temp"));
    await deleteDepartment(db, admin, unused.id);
    expect(await db.department.findUnique({ where: { id: unused.id } })).toBeNull();
  });
});
