/**
 * Test-only credentials for the throwaway E2E database (recreated on every run — never real data).
 */
export const E2E_PORT = 3200;
export const E2E_ADMIN = { email: "e2e-admin@invoicecrm.test", password: "E2e-admin-pass-2026" };
export const E2E_VIEWER = { email: "e2e-viewer@invoicecrm.test", password: "E2e-viewer-pass-2026" };

export function e2eDatabaseUrl() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is required (see .env.example)");
  const u = new URL(base);
  u.pathname = "/invoicecrm_e2e";
  return u.toString();
}
