import { expect, test, type Page } from "@playwright/test";
import { totp } from "../src/server/core/totp";
import { E2E_ADMIN, E2E_VIEWER } from "./config";

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.configure({ mode: "serial" });

test("platform: health, security headers, auth gate", async ({ request, page }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok" });

  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["strict-transport-security"]).toBeTruthy();
  expect(h["x-powered-by"]).toBeUndefined();

  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/login$/);
  const exp = await request.get("/api/invoices/export", { maxRedirects: 0 });
  expect([302, 307, 401]).toContain(exp.status());
  const cron = await request.post("/api/cron/notifications", { headers: { authorization: "Bearer wrong-secret-wrong-sec" } });
  expect(cron.status()).toBe(401);

  await login(page, { email: E2E_ADMIN.email, password: "wrong-password-1" });
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
});

test("full lifecycle: client → project → PO → milestone invoices → payment → email → reports", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, E2E_ADMIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

  // Client with primary contact
  await page.goto("/clients/new");
  await page.getByLabel("Company / client name *").fill("Orbit Labs");
  await page.getByLabel("Name", { exact: true }).fill("Olu Ade");
  await page.getByLabel("Email", { exact: true }).fill("olu@orbit.example");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("heading", { name: /Orbit Labs/ })).toBeVisible();

  // Project → submit → approve
  await page.getByRole("link", { name: "New project" }).click();
  await page.getByLabel("Project code *").fill("ORB-1");
  await page.getByLabel("Project name *").fill("Data platform");
  await page.getByLabel("Project value *").fill("20000");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: /Data platform/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark Submitted" }).click();
  await expect(page.getByText("Project moved to submitted")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approve" }).click();
  await expect(page.getByText("Project moved to approved")).toBeVisible();

  // PO with a 50/50 milestone plan
  await page.getByRole("link", { name: "New PO" }).click();
  await page.getByLabel("PO number *").fill("ORB-PO-1");
  await page.getByLabel("PO value *").fill("10000");
  await page.getByRole("button", { name: "+ Add milestone" }).click();
  await page.getByLabel("Milestone 1 name").fill("Design");
  await page.getByLabel("Percentage").first().fill("50");
  await page.getByRole("button", { name: "+ Add milestone" }).click();
  await page.getByLabel("Milestone 2 name").fill("Delivery");
  await page.getByLabel("Percentage").nth(1).fill("50");
  await expect(page.getByText("Total 100%")).toBeVisible();
  await page.getByRole("button", { name: "Create PO" }).click();
  await expect(page.getByRole("heading", { name: /PO ORB-PO-1/ })).toBeVisible();

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("PO moved to submitted")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("PO approved — 2 milestone invoices generated as drafts")).toBeVisible();
  await expect(page.getByText("This PO is fully invoiced")).toBeVisible(); // strict cap: 100% allocated, no manual invoice possible

  // Finalize the first milestone invoice
  await page.getByRole("link", { name: "Draft" }).first().click();
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await expect(page.getByText(/Finalized as INV-\d{4}-\d{5}/)).toBeVisible();
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).match(/INV-\d{4}-\d{5}/)![0];

  // Stored PDF is served
  const pdf = await page.request.get(page.url().replace(/\/invoices\//, "/api/invoices/") + "/pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Overpayment rejected, partial payment accepted
  await page.getByLabel(/Amount \(USD\)/).fill("6000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "exceeds the outstanding balance" })).toBeVisible();
  await page.getByLabel(/Amount \(USD\)/).fill("2000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Partially Paid");

  // Email to the dev outbox; status must not change
  await page.getByRole("button", { name: "Send email" }).click();
  await expect(page.getByText(/Email written to the dev outbox/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Partially Paid");

  // Reports reflect it
  await page.goto("/reports/collections");
  await expect(page.getByRole("cell", { name: number })).toBeVisible();
  await expect(page.getByText("USD 2,000.00").first()).toBeVisible();
  const csv = await page.request.get("/api/reports/collections?format=csv");
  expect(await csv.text()).toContain(number);

  // Global search
  await page.goto("/search?q=orbit");
  await expect(page.getByRole("link", { name: /Orbit Labs/ }).first()).toBeVisible();
});

test("role-based access: viewer is read-only", async ({ page }) => {
  await login(page, E2E_VIEWER);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);
  const exp = await page.request.get("/api/invoices/export");
  expect(exp.status()).toBe(403);
});

test("two-factor sign-in", async ({ page, context }) => {
  await login(page, E2E_ADMIN);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Set up two-factor" }).click();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor authentication On" })).toBeVisible();

  await context.clearCookies();
  await login(page, E2E_ADMIN);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not valid" })).toBeVisible();
  await page.getByLabel("Authentication code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
});
