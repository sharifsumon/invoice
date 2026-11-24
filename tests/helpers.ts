import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor, type Actor } from "@/server/core/common";

/** The built-in groups (created by the user_groups migration), by their old role key. */
export type Role = "ADMIN" | "MANAGEMENT" | "BUSINESS_DEVELOPMENT" | "PROJECT_MANAGER" | "FINANCE" | "VIEWER";
export const Role = {
  ADMIN: "ADMIN", MANAGEMENT: "MANAGEMENT", BUSINESS_DEVELOPMENT: "BUSINESS_DEVELOPMENT",
  PROJECT_MANAGER: "PROJECT_MANAGER", FINANCE: "FINANCE", VIEWER: "VIEWER",
} as const satisfies Record<Role, Role>;

export async function groupId(db: PrismaClient, role: Role) {
  return (await db.userGroup.findUniqueOrThrow({ where: { key: role }, select: { id: true } })).id;
}

process.env.STORAGE_DIR = path.join(os.tmpdir(), "invoice-crm-test-storage");

export function testDb() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
}

let n = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function makeActor(db: PrismaClient, role: Role = Role.ADMIN): Promise<Actor> {
  const u = await db.user.create({ data: { name: role, email: `${uid(role)}@test.local`, passwordHash: "x", groupId: await groupId(db, role) } });
  return loadActor(db, u.id);
}

/** Required client fields (country, status) for tests. */
export const cl = (name: string, extra: Record<string, unknown> = {}) => ({ name, country: "Testland", status: "COMMUNICATED" as const, ...extra });

/** A valid primary contact; override any field. */
export const ct = (firstName = "Test", lastName = "Contact", extra: Record<string, unknown> = {}) => ({
  firstName, lastName, email: `${firstName}.${lastName}@client.example`.toLowerCase().replace(/[^a-z0-9.@-]/g, ""), phone: "+1 555 010 0000", ...extra,
});

export async function baseSettings(db: PrismaClient) {
  await db.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, displayName: "Test Co", legalName: "Test Co Ltd" } });
  await db.invoiceTemplateSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
