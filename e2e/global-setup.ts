import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { E2E_ADMIN, E2E_VIEWER, e2eDatabaseUrl } from "./config";

/** Fresh E2E database + storage: migrate, then seed settings, an admin and a viewer. */
export default async function setup() {
  const url = e2eDatabaseUrl();
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "invoicecrm_e2e" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "invoicecrm_e2e"`);
  await c.end();
  rmSync(".e2e-storage", { recursive: true, force: true });

  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: E2E_ADMIN.email, SEED_ADMIN_PASSWORD: E2E_ADMIN.password, SEED_DEMO: "0" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx prisma db seed", { env, stdio: "pipe" });

  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query(
    `INSERT INTO "User" (id, name, email, "passwordHash", "groupId", "updatedAt") VALUES ('e2e-viewer', 'Vera Viewer', $1, $2, 'grp_viewer', now())`,
    [E2E_VIEWER.email, await bcrypt.hash(E2E_VIEWER.password, 10)],
  );
  await db.end();
}
