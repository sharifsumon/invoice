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

test("public homepage and pricing (no sign-in needed)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Every client, invoice, and payment/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask the AI assistant anything" })).toBeVisible(); // AI assistant card
  for (const f of ["Clients & contacts", "Projects", "Purchase orders & milestones", "Automatic invoice creation", "Payments & part payments",
    "Excel & PDF invoices", "Invoice email", "Notifications", "Global search"]) {
    await expect(page.getByRole("heading", { name: f, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel("Starter plan")).toContainText("$10");
  await expect(page.getByLabel("Team plan")).toContainText("$20");
  await page.getByRole("link", { name: "Pricing", exact: true }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "Simple pricing for every team" })).toBeVisible();
  // The free trial is its own package; paid plans carry no trial; Starter is the most popular
  await expect(page.getByLabel("Free trial package")).toContainText("Free");
  await expect(page.getByLabel("Free trial package")).toContainText("for 14 days");
  await expect(page.getByLabel("Starter plan")).not.toContainText("free trial");
  await expect(page.getByLabel("Team plan")).not.toContainText("free trial");
  await expect(page.getByLabel("Starter plan")).toContainText("Most popular");
  await expect(page.getByLabel("Team plan")).not.toContainText("Most popular");
  await expect(page.getByRole("cell", { name: "Up to 5", exact: true })).toHaveCount(2); // free package and Starter
  await expect(page.getByLabel("Free trial package")).toContainText("Up to 5 users");
  await page.getByRole("link", { name: "Start free trial" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

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
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();

  // Client with primary contact
  await page.goto("/clients/new");
  await page.getByLabel("Company / client name *").fill("Orbit Labs");
  // Required fields are enforced by the browser before anything is sent
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/new$/);
  expect(await page.getByLabel("Country *").evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
  expect(await page.getByLabel("Country *").locator("option").count()).toBeGreaterThan(240); // full country list
  await page.getByLabel("Status *").selectOption("ONBOARDED");
  await page.getByLabel("Country *").selectOption("Nigeria");
  await page.getByLabel("First name *").fill("Olu");
  await page.getByLabel("Last name *").fill("Ade");
  await page.getByLabel("Email *").fill("olu@orbit.example");
  await page.getByLabel("Phone *").fill("+234 1 280 0000");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("heading", { name: /Orbit Labs/ })).toBeVisible();

  // Edit details: a button on the Details card opens the form; saving closes it
  await expect(page.getByLabel("Company / client name *")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page.getByLabel("Country *")).toHaveValue("Nigeria");
  await page.getByLabel("Country *").selectOption("Ghana");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Client updated")).toBeVisible();
  await expect(page.getByText("Ghana")).toBeVisible();
  await expect(page.getByLabel("Company / client name *")).toHaveCount(0);

  // Project starts as Draft → status dropdown → In Progress; then edit it
  await page.getByRole("link", { name: "New project" }).click();
  await expect(page.getByLabel("Project code")).toHaveValue(/^PRJ-\d{4}$/); // auto-numbered
  await page.getByLabel("Project name *").fill("Data platform");
  await page.getByLabel("Project value *").fill("20000");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: /Data platform/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("DRAFT");
  await page.getByRole("combobox", { name: "Status" }).selectOption("IN_PROGRESS");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Project moved to in progress")).toBeVisible();
  await page.getByRole("link", { name: "Edit project" }).click();
  await page.getByLabel("Project name *").fill("Data platform v2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: /Data platform v2/ })).toBeVisible();
  await expect(page.getByText("Project updated")).toBeVisible();

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
  await expect(page.getByText("Total 100%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: /PO ORB-PO-1/ })).toBeVisible();

  // Saved straight into "Submitted for approval", with one pending invoice per milestone
  await expect(page.getByText("Submitted for approval").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pending approval" })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Payment milestones" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft invoice" })).toHaveCount(0); // form only on request

  // Approve from a pending invoice: approves the PO and releases both milestone invoices
  await page.getByRole("link", { name: "Pending approval" }).first().click();
  await expect(page.getByText("Pending approval.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize invoice" })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("PO approved — 2 milestone invoices ready to finalize")).toBeVisible();

  // Finalize this milestone invoice
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await expect(page.getByText(/Finalized as INV-\d{4}-\d{5}/)).toBeVisible();
  const number = (await page.getByRole("heading", { level: 1 }).innerText()).match(/INV-\d{4}-\d{5}/)![0];

  // Stored PDF is served
  const pdf = await page.request.get(new URL(page.url()).pathname.replace(/\/invoices\//, "/api/invoices/") + "/pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Amount is pre-filled with the outstanding balance; overpayment rejected, partial payment accepted
  await expect(page.getByLabel(/Amount received \(USD\)/)).toHaveValue("5000.00");
  await expect(page.getByLabel("Receiving account")).toHaveCount(0);
  await page.getByLabel(/Amount received \(USD\)/).fill("6000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "exceeds the outstanding balance" })).toBeVisible();
  await page.getByLabel(/Amount received \(USD\)/).fill("2000");
  await expect(page.getByText("Create a new invoice for the remaining USD 3000.00")).toBeVisible(); // ticked by default
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Balance invoice INV-\d{4}-\d{5} created for 3000\.00 USD/)).toBeVisible();
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

test("individual invoice from the Invoices page (no PO)", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.goto("/invoices");
  await page.getByRole("link", { name: "Create invoice" }).click();
  await expect(page.getByRole("heading", { name: "Create invoice", level: 1 })).toBeVisible();
  await page.getByLabel("Client *").selectOption({ label: "Orbit Labs" });
  await page.getByLabel("Description").fill("Strategy workshop");
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Rate").fill("750");
  await page.getByLabel("Notes").fill("Thank you for your business.");
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-create-invoice.png`, fullPage: true });
  await page.getByRole("button", { name: "Create draft invoice" }).click();
  await expect(page.getByRole("heading", { name: /Draft invoice/ })).toBeVisible();
  await expect(page.getByText("Individual invoice")).toBeVisible();
  await page.getByRole("button", { name: "Finalize invoice" }).click();
  await expect(page.getByText(/Finalized as INV/)).toBeVisible();
  await page.goto("/invoices?q=Orbit");
  await expect(page.getByRole("cell", { name: "Individual" }).first()).toBeVisible();
});

test("requisitions: raise, submit, approve and fulfil", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await login(page, E2E_VIEWER);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  // Viewers can see requisitions but not raise them
  await page.goto("/requisitions");
  await expect(page.getByRole("heading", { name: "Requisitions", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "New requisition" })).toHaveCount(0);
  await page.context().clearCookies();

  await login(page, E2E_ADMIN);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  // Departments are set up by an admin first, then picked from a dropdown
  await page.getByRole("link", { name: "Requisitions" }).first().click();
  await page.getByRole("link", { name: "Manage departments" }).click();
  await expect(page.getByRole("heading", { name: "Departments", level: 1 })).toBeVisible();
  for (const d of ["Engineering", "Design"]) {
    await page.getByLabel("Department name").fill(d);
    await page.getByRole("button", { name: "Add department" }).click();
    await expect(page.getByText(`Department added: ${d}`)).toBeVisible();
  }
  await page.getByRole("link", { name: "Rename Design" }).click();
  await page.getByLabel("New name for Design").fill("Product Design");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Department renamed to Product Design")).toBeVisible();
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-departments.png`, fullPage: true });

  await page.getByRole("link", { name: "Go to requisitions" }).click();
  await page.getByRole("link", { name: "New requisition" }).click();
  await expect(page.getByLabel("Project (optional)")).toHaveCount(0);
  await page.getByLabel("Title *").fill("Laptops for new hires");
  await page.getByLabel("Department").selectOption({ label: "Engineering" });
  await expect(page.getByLabel("Department").locator("option")).toHaveText(["— Select department —", "Engineering", "Product Design"]);
  await page.getByLabel("Priority").selectOption("HIGH");
  await page.getByLabel("Item", { exact: true }).fill("Laptop, 16 GB RAM");
  await page.getByLabel("Quantity").fill("3");
  await page.getByLabel("Unit", { exact: true }).fill("pcs");
  await page.getByLabel("Estimated unit price").fill("1100");
  await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel("Item", { exact: true }).nth(1).fill("Laptop bag");
  await page.getByLabel("Quantity").nth(1).fill("3");
  await expect(page.getByText("3300.00").last()).toBeVisible();
  await page.getByLabel("Purpose / justification").fill("Three engineers start next month.");
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-requisition-new.png`, fullPage: true });
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Requisition submitted")).toBeVisible();
  await expect(page.getByText(/REQ-\d{4}-\d{4}/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Requisition approved")).toBeVisible();
  await page.getByRole("button", { name: "Mark fulfilled" }).click();
  await expect(page.getByText("Requisition marked fulfilled")).toBeVisible();
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-requisition.png`, fullPage: true });
  await page.goto("/requisitions");
  await expect(page.getByRole("link", { name: "Laptops for new hires" })).toBeVisible();
});

test("role-based access: viewer is read-only", async ({ page }) => {
  await login(page, E2E_VIEWER);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  // Everyone on the free package sees the upgrade options (only admins can actually change the plan)
  await expect(page.getByRole("region", { name: "Upgrade" }).getByRole("link", { name: /Upgrade to Team/ })).toBeVisible();
  await page.goto("/subscription");
  await expect(page.getByLabel("Team plan")).toContainText("Ask an administrator to upgrade to Team");
  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);
  await page.goto("/clients");
  await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);
  const exp = await page.request.get("/api/invoices/export");
  expect(exp.status()).toBe(403);
  await expect(page.getByRole("link", { name: "User groups" })).toHaveCount(0);
  await page.goto("/users/groups");
  await expect(page).toHaveURL(/denied=1/);
});

test("user groups: create a group with chosen permissions", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.getByRole("link", { name: "User groups" }).click();
  await expect(page.getByRole("link", { name: "Administrator" })).toBeVisible();
  await page.getByRole("link", { name: "New group" }).click();
  await page.getByLabel("Group name *").fill("Sales team");
  await page.getByLabel("clients — Create").check();
  await page.getByLabel("clients — Edit").check();
  await page.getByLabel("projects — Create").check();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByText("Group created")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales team" })).toBeVisible();
  await expect(page.getByLabel("clients — Edit")).toBeChecked();
  await expect(page.getByLabel("pos — Create")).not.toBeChecked();

  // Users page: form hidden until "Add user"; new users can be put in the group
  await page.goto("/users");
  await expect(page.getByRole("button", { name: "Create user" })).toHaveCount(0);
  await page.getByRole("link", { name: "Add user" }).click();
  await page.getByLabel("Name *").fill("Sally Sales");
  await page.getByLabel("Email *").fill("sally@e2e.local");
  await page.getByLabel("Group *").selectOption({ label: "Sales team" });
  await page.getByLabel("Initial password *").fill("Sally-pass-12345");
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText("User created")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sally Sales", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create user" })).toHaveCount(0);

  // Edit opens a full-width form above the list; saving closes it
  await page.getByRole("link", { name: "Edit Sally Sales" }).click();
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-users-edit.png`, fullPage: true });
  await page.getByLabel("Name *").fill("Sally Seller");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("User updated")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sally Seller", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("AI assistant: not set up → points to Settings, where the key is entered", async ({ page }) => {
  await login(page, E2E_ADMIN);
  await page.getByRole("link", { name: "AI assistant" }).click();
  await expect(page.getByText("isn't set up yet")).toBeVisible();
  await page.getByRole("link", { name: "Add the API key in Settings" }).click();
  await expect(page.getByText("No key saved yet")).toBeVisible();
  await expect(page.getByLabel("Google API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test key" })).toBeVisible();
  // (Saving is checked against Google, so it's covered by unit tests with a fake Google instead of here.)
});

test("subscription: free package (5 users) shows upgrade options; upgrade to Starter", async ({ page }) => {
  await login(page, E2E_ADMIN);
  const bar = page.getByRole("region", { name: "Upgrade" });
  await expect(bar).toContainText(/Free package: 14 days left/);
  await expect(bar).toContainText(/of 5 users/);
  await bar.getByRole("link", { name: /Upgrade to Starter/ }).click();
  await expect(page.getByRole("heading", { name: "Subscription", level: 1 })).toBeVisible();
  await expect(page.getByText(/of 5 active users/)).toBeVisible();
  await expect(page.getByLabel("Free trial package")).toContainText("Your plan");
  if (process.env.E2E_SHOT) await page.screenshot({ path: `${process.env.E2E_SHOT}-subscription.png`, fullPage: true });
  await page.getByLabel("Starter plan").getByRole("button", { name: "Upgrade to Starter" }).click();
  await expect(page.getByText("Plan changed to Starter")).toBeVisible();
  await expect(page.getByRole("region", { name: "Upgrade" })).toHaveCount(0); // no upgrade bar once on a paid plan
});

test("two-factor sign-in", async ({ page, context }) => {
  await login(page, E2E_ADMIN);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
});
