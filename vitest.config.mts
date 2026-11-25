import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"], // e2e/ is Playwright's
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
    // The shared test database accumulates many users; seat limits are switched back on in subscription.test.ts
    env: { SEAT_LIMITS: "off" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
