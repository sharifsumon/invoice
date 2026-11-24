import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, updateClient, upsertContact } from "@/server/core/clients";
import type { Actor } from "@/server/core/common";
import { cl, ct, makeActor, Role, testDb, uid } from "./helpers";

const db = testDb();
let bd: Actor;
beforeAll(async () => { bd = await makeActor(db, Role.BUSINESS_DEVELOPMENT); });
afterAll(async () => db.$disconnect());

describe("Client & contact required fields", () => {
  it("creates a client with its primary contact and stores the full name", async () => {
    const c = await createClient(db, bd, cl(uid("Req")), [ct("Ada", "Lovelace")]);
    const [contact] = await db.clientContact.findMany({ where: { clientId: c.id } });
    expect(contact).toMatchObject({ firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", isPrimary: true });
    expect(c.country).toBe("Testland");
  });

  it("requires country and status on the client", async () => {
    await expect(createClient(db, bd, { name: uid("X"), status: "COMMUNICATED" } as never, [ct()])).rejects.toThrow(/Country is required/);
    await expect(createClient(db, bd, { name: uid("X"), country: "  ", status: "COMMUNICATED" }, [ct()])).rejects.toThrow(/Country is required/);
    await expect(createClient(db, bd, { name: uid("X"), country: "UK" } as never, [ct()])).rejects.toThrow(/Status is required/);
    const c = await createClient(db, bd, cl(uid("Y")), [ct()]);
    await expect(updateClient(db, bd, c.id, { name: c.name, status: "ONBOARDED", country: "" })).rejects.toThrow(/Country is required/);
  });

  it("requires a primary contact with first name, last name, email and phone", async () => {
    await expect(createClient(db, bd, cl(uid("Z")), [])).rejects.toThrow(/primary contact is required/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("", "Smith")])).rejects.toThrow(/First name is required/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", " ")])).rejects.toThrow(/Last name is required/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", "Smith", { email: "" })])).rejects.toThrow(/Contact email is required/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", "Smith", { email: "not-an-email" })])).rejects.toThrow(/Invalid contact email/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", "Smith", { phone: "" })])).rejects.toThrow(/Contact phone is required/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", "Smith", { phone: "call me" })])).rejects.toThrow(/Invalid contact phone/);
    await expect(createClient(db, bd, cl(uid("Z")), [ct("Jo", "Smith", { phone: "123" })])).rejects.toThrow(/Invalid contact phone/);
    expect(await db.client.count({ where: { name: { startsWith: "Z-" } } })).toBe(0); // nothing half-created
  });

  it("applies the same rules when adding or editing a contact later", async () => {
    const c = await createClient(db, bd, cl(uid("Later")), [ct()]);
    await expect(upsertContact(db, bd, c.id, ct("Only", "", {}))).rejects.toThrow(/Last name is required/);
    const added = await upsertContact(db, bd, c.id, ct("Grace", "Hopper", { phone: "(020) 7946-0000" }));
    expect(added.name).toBe("Grace Hopper");
    const edited = await upsertContact(db, bd, c.id, ct("Grace", "Murray Hopper"), added.id);
    expect(edited).toMatchObject({ lastName: "Murray Hopper", name: "Grace Murray Hopper" });
  });
});
