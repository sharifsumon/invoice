import { execSync } from "node:child_process";
import "dotenv/config";
import { Client } from "pg";

/** Recreate the test database from migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
