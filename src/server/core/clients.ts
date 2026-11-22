import { z } from "zod";
import { ActivityType, ClientStatus } from "@/generated/prisma/enums";
import { audit, inTx, type Actor, type Db } from "./common";
import { can, ForbiddenError, RuleError } from "./permissions";

const opt = z.string().trim().max(2000).optional().transform((v) => (v ? v : null));

export const clientInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  legalName: opt,
  address: opt,
  country: opt,
  website: opt,
  industry: opt,
  taxId: opt,
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => v || null),
  phone: opt,
  remarks: opt,
  status: z.nativeEnum(ClientStatus).default(ClientStatus.COMMUNICATED),
});
export type ClientInput = z.input<typeof clientInput>;

export const contactInput = z.object({
  name: z.string().trim().min(1, "Contact name is required").max(200),
  designation: opt,
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => v || null),
  phone: opt,
  department: opt,
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactInput>;

function need(actor: Actor, action: "create" | "edit") {
  if (!can(actor.role, "clients", action)) throw new ForbiddenError("clients", action);
}

export async function createClient(db: Db, actor: Actor, raw: ClientInput, contacts: ContactInput[] = []) {
  need(actor, "create");
  const data = clientInput.parse(raw);
  const parsedContacts = contacts.map((c) => contactInput.parse(c));
  if (parsedContacts.length && !parsedContacts.some((c) => c.isPrimary)) parsedContacts[0].isPrimary = true;
  return inTx(db, async (tx) => {
    const client = await tx.client.create({ data: { ...data, contacts: { create: parsedContacts } } });
    await audit(tx, actor, "client.created", "Client", client.id, { after: data });
    return client;
  });
}

export async function updateClient(db: Db, actor: Actor, id: string, raw: ClientInput) {
  need(actor, "edit");
  const data = clientInput.parse(raw);
  return inTx(db, async (tx) => {
    const before = await tx.client.findUniqueOrThrow({ where: { id } });
    const client = await tx.client.update({ where: { id }, data });
    await audit(tx, actor, "client.updated", "Client", id, { before, after: client });
    if (before.status !== client.status) {
      await tx.clientActivity.create({
        data: {
          clientId: id, type: ActivityType.STATUS_CHANGE, userId: actor.id,
          subject: `Status changed from ${before.status} to ${client.status}`,
        },
      });
    }
    return client;
  });
}

/** BRD §5.1: no hard delete — archive instead. */
export async function setClientArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  need(actor, "edit");
  return inTx(db, async (tx) => {
    const client = await tx.client.update({
      where: { id },
      data: { archived, ...(archived ? { status: ClientStatus.INACTIVE } : {}) },
    });
    await audit(tx, actor, archived ? "client.archived" : "client.restored", "Client", id);
    return client;
  });
}

export async function upsertContact(db: Db, actor: Actor, clientId: string, raw: ContactInput, contactId?: string) {
  need(actor, "edit");
  const data = contactInput.parse(raw);
  return inTx(db, async (tx) => {
    if (data.isPrimary) {
      await tx.clientContact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    const contact = contactId
      ? await tx.clientContact.update({ where: { id: contactId, clientId }, data })
      : await tx.clientContact.create({ data: { ...data, clientId } });
    const count = await tx.clientContact.count({ where: { clientId, isPrimary: true } });
    if (count === 0) await tx.clientContact.update({ where: { id: contact.id }, data: { isPrimary: true } });
    await audit(tx, actor, contactId ? "contact.updated" : "contact.created", "Client", clientId, { after: data });
    return contact;
  });
}

export async function deleteContact(db: Db, actor: Actor, clientId: string, contactId: string) {
  need(actor, "edit");
  return inTx(db, async (tx) => {
    const c = await tx.clientContact.delete({ where: { id: contactId, clientId } });
    if (c.isPrimary) {
      const next = await tx.clientContact.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
      if (next) await tx.clientContact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await audit(tx, actor, "contact.deleted", "Client", clientId, { before: c });
  });
}

export const activityInput = z.object({
  type: z.nativeEnum(ActivityType),
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: opt,
  occurredAt: z.string().optional(),
});

export async function addActivity(db: Db, actor: Actor, clientId: string, raw: z.input<typeof activityInput>) {
  need(actor, "edit");
  const data = activityInput.parse(raw);
  if (data.type === ActivityType.STATUS_CHANGE) throw new RuleError("Status changes are logged automatically.");
  return db.clientActivity.create({
    data: {
      clientId, type: data.type, subject: data.subject, body: data.body, userId: actor.id,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
    },
  });
}
