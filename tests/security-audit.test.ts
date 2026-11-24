import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PaymentMethod, ProjectStatus } from "@/generated/prisma/enums";
import { adminResetMfa, beginMfaSetup, changeOwnPassword, confirmMfaSetup, disableOwnMfa, signOutEverywhere } from "@/server/core/account";
import { addAttachment, removeAttachment, sniffAttachment } from "@/server/core/attachments";
import { createClient, updateClient, upsertContact } from "@/server/core/clients";
import { createProject, transitionProject } from "@/server/core/projects";
import { approvePO, createPO } from "@/server/core/pos";
import { cancelInvoice, createManualInvoice, finalizeInvoice } from "@/server/core/invoices";
import { recordPayment, reversePayment } from "@/server/core/payments";
import { updateCompany, updateTemplate, updateUser } from "@/server/core/settings";
import { base32Decode, base32Encode, totp, verifyTotp } from "@/server/core/totp";
import { can } from "@/server/core/permissions";
import { loadActor, type Actor } from "@/server/core/common";
import { createGroup, createUser, deleteGroup, updateGroup } from "@/server/core/users";
import { baseSettings, cl, ct, groupId, makeActor, Role, testDb, uid } from "./helpers";

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
    const u = await db.user.create({ data: { name: "U", email: `${uid("u")}@t.local`, groupId: await groupId(db, role), passwordHash: await bcrypt.hash(pw, 4) } });
    return { actor: await loadActor(db, u.id), pw };
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

  it("admin group change, deactivation or reset revokes the user's sessions", async () => {
    const { actor } = await user(Role.VIEWER);
    const v0 = await sv(actor.id);
    const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    const [viewerG, financeG] = [await groupId(db, Role.VIEWER), await groupId(db, Role.FINANCE)];
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, groupId: viewerG, active: true });
    expect(await sv(actor.id)).toBe(v0); // a rename alone does not
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, groupId: financeG, active: true });
    expect(await sv(actor.id)).toBe(v0 + 1);
    await updateUser(db, admin, actor.id, { name: "Renamed", email: u.email, groupId: financeG, active: false });
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

    const c = await createClient(db, admin, cl(uid("A")), [ct()]);
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
    const c = await createClient(db, admin, cl(uid("Aud")), [ct()]);
    await updateClient(db, admin, c.id, cl(c.name, { status: "ONBOARDED" }));
    await upsertContact(db, admin, c.id, ct("Ann", "Lee"));
    const p = await createProject(db, admin, { code: uid("AU"), name: "x", clientId: c.id, value: "100", currency: "USD" });
    await transitionProject(db, admin, p.id, ProjectStatus.IN_PROGRESS);
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
      ["project.created", p.id], ["project.status.in_progress", p.id],
      ["po.created", po.id], ["po.status.approved", po.id],
      ["invoice.created", inv.id], ["invoice.finalized", inv.id], ["payment.recorded", inv.id], ["payment.reversed", inv.id],
      ["invoice.cancelled", inv2.id], ["settings.company.updated", "1"], ["settings.template.updated", "1"],
    ];
    for (const [action, entityId] of expected) {
      const row = await db.auditLog.findFirst({ where: { action, entityId }, orderBy: { createdAt: "desc" } });
      expect(row, `missing audit: ${action}`).toBeTruthy();
      expect(row!.actorId, `no actor on ${action}`).toBeTruthy();
    }
    const started = await db.auditLog.findFirst({ where: { action: "project.status.in_progress", entityId: p.id } });
    expect(started?.before).toMatchObject({ status: "DRAFT", approved: false });
    expect(started?.after).toMatchObject({ status: "IN_PROGRESS", approved: true });
  });

  it("built-in groups: viewers can never mutate; only administrators manage users, groups and settings", async () => {
    for (const actions of Object.values(viewer.perms)) expect(actions).toEqual(["view"]);
    for (const r of Object.values(Role)) {
      const a = await makeActor(db, r);
      expect(can(a, "users", "groups")).toBe(r === "ADMIN");
      expect(can(a, "settings", "administer")).toBe(r === "ADMIN");
    }
  });
});

describe("User groups", () => {
  it("a custom group grants exactly its ticked permissions (and implies view)", async () => {
    const g = await createGroup(db, admin, { name: uid("Sales"), permissions: { clients: ["create", "edit"], projects: ["create"], bogus: ["x"] } });
    expect(g.permissions).toEqual({ clients: ["view", "create", "edit"], projects: ["view", "create"] });
    const u = await createUser(db, admin, { name: "Sam", email: `${uid("sam")}@t.local`, groupId: g.id, password: "Sales-pass-123" });
    const sam = await loadActor(db, u.id);
    const c = await createClient(db, sam, cl(uid("SamCo")), [ct()]);
    await updateClient(db, sam, c.id, cl("Renamed"));
    await expect(createPO(db, sam, { poNumber: uid("PO"), projectId: "x", poDate: "2026-01-01", value: "10" })).rejects.toThrow(/permission/);
    await expect(createGroup(db, sam, { name: uid("Nope"), permissions: {} })).rejects.toThrow(/permission/);

    // Changing the group's permissions applies to its members
    await updateGroup(db, admin, g.id, { name: g.name, permissions: { clients: ["view"] } });
    await expect(updateClient(db, await loadActor(db, u.id), c.id, cl("Again"))).rejects.toThrow(/permission/);
  });

  it("delete permission: archive needs clients.delete; deactivating a user needs users.delete", async () => {
    const g = await createGroup(db, admin, { name: uid("Editors"), permissions: { clients: ["edit"], users: ["edit"] } });
    const u = await createUser(db, admin, { name: "Ed", email: `${uid("ed")}@t.local`, groupId: g.id, password: "Editor-pass-123" });
    const ed = await loadActor(db, u.id);
    const { setClientArchived } = await import("@/server/core/clients");
    const c = await createClient(db, admin, cl(uid("Arch")), [ct()]);
    await expect(setClientArchived(db, ed, c.id, true)).rejects.toThrow(/permission/);
    const other = await createUser(db, admin, { name: "Ozzy", email: `${uid("oz")}@t.local`, groupId: g.id, password: "Other-pass-123" });
    await expect(updateUser(db, ed, other.id, { name: "Ozzy", email: other.email, groupId: g.id, active: false })).rejects.toThrow(/permission/);
    await updateUser(db, ed, other.id, { name: "Oswald", email: other.email, groupId: g.id, active: true }); // plain edit is fine
  });

  it("cannot lock everyone out of user management; a group with users cannot be deleted", async () => {
    const adminGroup = await groupId(db, Role.ADMIN);
    // Stripping "manage groups" from the only group that has it is refused
    const before = await db.userGroup.findUniqueOrThrow({ where: { id: adminGroup } });
    await expect(updateGroup(db, admin, adminGroup, { name: before.name, permissions: { clients: ["view"] } })).rejects.toThrow(/manage groups/);
    await expect(deleteGroup(db, admin, adminGroup)).rejects.toThrow(/Move the/);
    const empty = await createGroup(db, admin, { name: uid("Empty"), permissions: {} });
    await deleteGroup(db, admin, empty.id);
    expect(await db.userGroup.findUnique({ where: { id: empty.id } })).toBeNull();
  });
});
