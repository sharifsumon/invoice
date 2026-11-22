import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import type { Actor } from "@/server/core/common";

process.env.STORAGE_DIR = path.join(os.tmpdir(), "invoice-crm-test-storage");

export function testDb() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
}

let n = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function makeActor(db: PrismaClient, role: Role = Role.ADMIN): Promise<Actor> {
  const u = await db.user.create({ data: { name: role, email: `${uid(role)}@test.local`, passwordHash: "x", role } });
  return { id: u.id, role: u.role, name: u.name };
}

export async function baseSettings(db: PrismaClient) {
  await db.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, displayName: "Test Co", legalName: "Test Co Ltd" } });
  await db.invoiceTemplateSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
