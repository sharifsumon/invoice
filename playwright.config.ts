import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { E2E_PORT, e2eDatabaseUrl } from "./e2e/config";

/**
 * End-to-end tests against the PRODUCTION build (`npm run build` first) on a throwaway database.
 * Uses the installed Microsoft Edge (channel "msedge") so no browser download is needed;
 * set E2E_CHANNEL=chrome or run `npx playwright install chromium` and E2E_CHANNEL= to change.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    channel: process.env.E2E_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${E2E_PORT}`,
    // Not /api/health: Playwright starts the server before globalSetup creates the E2E database.
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      STORAGE_DIR: "./.e2e-storage",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
      SMTP_HOST: "",
      CRON_SECRET: "e2e-cron-secret-123456",
    },
  },
});
