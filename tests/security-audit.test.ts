import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PaymentMethod, ProjectStatus, Role } from "@/generated/prisma/enums";
import { adminResetMfa, beginMfaSetup, changeOwnPassword, confirmMfaSetup, disableOwnMfa, signOutEverywhere } from "@/server/core/account";
import { addAttachment, removeAttachment, sniffAttachment } from "@/server/core/attachments";
import { createClient, updateClient, upsertContact } from "@/server/core/clients";
import { createProject, transitionProject } from "@/server/core/projects";
import { approvePO, createPO } from "@/server/core/pos";
import { cancelInvoice, createManualInvoice, finalizeInvoice } from "@/server/core/invoices";
import { recordPayment, reversePayment } from "@/server/core/payments";
import { updateCompany, updateTemplate, updateUser } from "@/server/core/settings";
import { base32Decode, base32Encode, totp, verifyTotp } from "@/server/core/totp";
import { can, PERMISSIONS } from "@/server/core/permissions";
import type { Actor } from "@/server/core/common";
import { baseSettings, makeActor, testDb, uid } from "./helpers";

const db = testDb();
let admin: Actor;
let finance: Actor;
let viewer: Actor;

beforeAll(async () => {
  await baseSettings(db);
  admin = await makeActor(db, Role.ADMIN);
  finance = await makeActor(db, Role.FINANCE);
  viewer = await makeActor(db, Role.VIEWER);
});
afterAll(async () => db.$disconnect());

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, 59_000, 30, 8)).toBe("94287082");
    expect(totp(secret, 1_111_111_109_000, 30, 8)).toBe("07081804");
    expect(totp(secret, 2_000_000_000_000, 30, 8)).toBe("69279037");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("accepts ±1 step of drift and rejects others", () => {
    const s = base32Encode(Buffer.from("abcdefghijabcdefghij"));
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, "abc123", now)).toBe(false);
  });
});

describe("Accounts & sessions", () => {
  async function user(role: Role = Role.FINANCE, pw = "Initial-pass-123") {
    const u = await db.user.create({ data: { name: "U", email: `${uid("u")}@t.local`, role, passwordHash: await bcrypt.hash(pw, 4) } });
    return { actor: { id: u.id, role: u.role, name: u.name } as Actor, pw };
  }
  const sv = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).sessionVersion;

  it("password change verifies the current password, enforces policy and revokes sessions", async () => {
    const { actor, pw } = await user();
    const before = await sv(actor.id);
    await expect(changeOwnPassword(db, actor, "wrong", "Another-pass-456")).rejects.toThrow(/incorrect/);
    await expect(changeOwnPassword(db, actor, pw, "short1")).rejects.toThrow(/10 characters/);
    await changeOwnPassword(db, actor, pw, "Another-pass-456");
    expect(await sv(actor.id)).toBe(before + 1);
    await signOutEverywhere(db, actor);
    expect(await sv(actor.id)).toBe(before + 2);
  });

  it("admin role change, deactivation or reset revokes the user's sessions", async () => {
    const { actor } = await user(Role.VIEWER);
    const v0 = await sv(actor.id);
    const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, role: Role.VIEWER, active: true });
    expect(await sv(actor.id)).toBe(v0); // a rename alone does not
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, role: Role.FINANCE, active: true });
    expect(await sv(actor.id)).toBe(v0 + 1);
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, role: Role.FINANCE, active: false });
    expect(await sv(actor.id)).toBe(v0 + 2);
  });

  it("MFA must be confirmed with a valid code, and can be disabled or admin-reset", async () => {
    const { actor, pw } = await user();
    const secret = await beginMfaSetup(db, actor);
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).mfaEnabled).toBe(false);
    await expect(confirmMfaSetup(db, actor, "000000")).rejects.toThrow(/not valid/);
    await confirmMfaSetup(db, actor, totp(secret));
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).mfaEnabled).toBe(true);
    await expect(beginMfaSetup(db, actor)).rejects.toThrow(/already enabled/);
    await expect(disableOwnMfa(db, actor, "nope", totp(secret))).rejects.toThrow(/Password/);
    await disableOwnMfa(db, actor, pw, totp(secret));
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).mfaSecret).toBeNull();

    const s2 = await beginMfaSetup(db, actor);
    await confirmMfaSetup(db, actor, totp(s2));
    await expect(adminResetMfa(db, finance, actor.id)).rejects.toThrow(/permission/);
    await adminResetMfa(db, admin, actor.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).mfaEnabled).toBe(false);
  });
});

describe("Attachments", () => {
  const pdf = Buffer.from("%PDF-1.4\n%test\n");
  it("accepts allowed types by content, rejects disguised files, and audits add/remove", async () => {
    expect(sniffAttachment(pdf, "x.pdf")?.ext).toBe("pdf");
    expect(sniffAttachment(Buffer.from("MZ\x90\x00 evil"), "invoice.pdf")).toBeNull();
    expect(sniffAttachment(Buffer.from("<script>alert(1)</script>"), "x.png")).toBeNull();
    expect(sniffAttachment(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), "x.zip")).toBeNull(); // zip only as docx/xlsx

    const c = await createClient(db, admin, { name: uid("A") });
    const p = await createProject(db, admin, { code: uid("A"), name: "a", clientId: c.id, value: "1", currency: "USD" });
    const po = await createPO(db, finance, { poNumber: uid("APO"), projectId: p.id, poDate: "2026-01-01", value: "10" });
    await expect(addAttachment(db, viewer, "PurchaseOrder", po.id, { name: "a.pdf", data: pdf })).rejects.toThrow(/permission/);
    await expect(addAttachment(db, finance, "PurchaseOrder", po.id, { name: "a.exe", data: Buffer.from("MZ...") })).rejects.toThrow(/Allowed file types/);
    await expect(addAttachment(db, finance, "Client", c.id, { name: "a.pdf", data: pdf })).rejects.toThrow(/not supported/);
    const a = await addAttachment(db, finance, "PurchaseOrder", po.id, { name: "../../signed PO.pdf", data: pdf });
    expect(a.fileName).not.toContain("/");
    await expect(removeAttachment(db, finance, a.id, "")).rejects.toThrow(/reason/);
    await removeAttachment(db, finance, a.id, "Wrong file");
    const actions = (await db.auditLog.findMany({ where: { entityId: po.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["attachment.added", "attachment.removed"]));
  });
});

describe("Audit coverage (BRD §5.10)", () => {
  it("every material financial and configuration action writes an audit record with the actor", async () => {
    const c = await createClient(db, admin, { name: uid("Aud") });
    await updateClient(db, admin, c.id, { name: c.name, status: "ONBOARDED" });
    await upsertContact(db, admin, c.id, { name: "Ann" });
    const p = await createProject(db, admin, { code: uid("AU"), name: "x", clientId: c.id, value: "100", currency: "USD" });
    await transitionProject(db, admin, p.id, ProjectStatus.SUBMITTED);
    await transitionProject(db, admin, p.id, ProjectStatus.APPROVED);
    const po = await createPO(db, finance, { poNumber: uid("AUPO"), projectId: p.id, poDate: "2026-01-01", value: "100" });
    await approvePO(db, finance, po.id);
    const inv = await createManualInvoice(db, finance, { poId: po.id, lines: [{ description: "x", unitPrice: "60" }] });
    await finalizeInvoice(db, finance, inv.id, { invoiceDate: "2026-01-02" });
    const pay = await recordPayment(db, finance, inv.id, { amount: "10", paymentDate: "2026-01-03", method: PaymentMethod.CASH });
    await reversePayment(db, finance, pay.id, "test");
    const inv2 = await createManualInvoice(db, finance, { poId: po.id, lines: [{ description: "y", unitPrice: "10" }] });
    await cancelInvoice(db, finance, inv2.id, "test");
    await updateCompany(db, admin, { legalName: "Test Co Ltd", displayName: "Test Co", defaultCurrency: "USD", paymentTermsDays: 30 });
    await updateTemplate(db, admin, {
      title: "INVOICE", logoPosition: "left", pageSize: "A4", numberPrefix: "INV-", numberPadding: 5, numberReset: "YEARLY",
      showTax: false, taxLabel: "VAT", defaultTaxRate: "0", showAmountInWords: true,
    });

    const expected: [string, string][] = [
      ["client.created", c.id], ["client.updated", c.id], ["contact.created", c.id],
      ["project.created", p.id], ["project.status.submitted", p.id], ["project.status.approved", p.id],
      ["po.created", po.id], ["po.status.approved", po.id],
      ["invoice.created", inv.id], ["invoice.finalized", inv.id], ["payment.recorded", inv.id], ["payment.reversed", inv.id],
      ["invoice.cancelled", inv2.id], ["settings.company.updated", "1"], ["settings.template.updated", "1"],
    ];
    for (const [action, entityId] of expected) {
      const row = await db.auditLog.findFirst({ where: { action, entityId }, orderBy: { createdAt: "desc" } });
      expect(row, `missing audit: ${action}`).toBeTruthy();
      expect(row!.actorId, `no actor on ${action}`).toBeTruthy();
    }
    const approved = await db.auditLog.findFirst({ where: { action: "project.status.approved", entityId: p.id } });
    expect(approved?.before).toMatchObject({ status: "SUBMITTED" });
    expect(approved?.after).toMatchObject({ status: "APPROVED" });
  });

  it("permission matrix: viewers can never mutate; only admins administer", () => {
    for (const [, actions] of Object.entries(PERMISSIONS.VIEWER)) expect(actions).toEqual(["view"]);
    for (const role of Object.keys(PERMISSIONS) as Role[]) {
      expect(can(role, "users", "administer")).toBe(role === "ADMIN");
      expect(can(role, "settings", "administer")).toBe(role === "ADMIN");
    }
  });
});
