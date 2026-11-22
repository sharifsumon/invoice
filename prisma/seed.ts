/**
 * Seed: default company/template settings + first admin account.
 * Set SEED_DEMO=1 to also create demo clients, projects, POs and invoices (through the real services,
 * so every business rule applies).
 *
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  (required for the admin account)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ProjectStatus, Role } from "../src/generated/prisma/enums";
import { createClient } from "../src/server/core/clients";
import { createProject, transitionProject } from "../src/server/core/projects";
import { approvePO, createPO } from "../src/server/core/pos";
import { createManualInvoice, finalizeInvoice } from "../src/server/core/invoices";
import { checkPassword } from "../src/server/core/settings";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  await db.companySettings.upsert({
    where: { id: 1 }, update: {},
    create: {
      id: 1, legalName: "Your Company Ltd", displayName: "Your Company", defaultCurrency: "USD", paymentTermsDays: 30,
      address: "Street address\nCity, Country", email: "billing@yourcompany.example",
      bankDetails: "Bank: Example Bank\nAccount name: Your Company Ltd\nAccount no: 000000000\nSWIFT: EXAMPXXX",
      defaultNotes: "Thank you for your business.",
    },
  });
  await db.invoiceTemplateSettings.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, defaultTerms: "Payment due within the agreed payment terms. Please quote the invoice number with your payment." },
  });

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env");
  checkPassword(password);
  const admin = await db.user.upsert({
    where: { email }, update: {},
    create: { email, name: "Administrator", role: Role.ADMIN, passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log(`Admin account ready: ${email}`);

  if (process.env.SEED_DEMO !== "1") return;
  if (await db.client.count()) { console.log("Demo skipped — clients already exist."); return; }

  const actor = { id: admin.id, role: admin.role, name: admin.name };
  const acme = await createClient(db, actor, { name: "Acme Retail", legalName: "Acme Retail Pvt Ltd", country: "United Kingdom", industry: "Retail", status: "IN_PROGRESS" },
    [{ firstName: "Priya", lastName: "Shah", designation: "Finance Manager", email: "priya@acme.example", phone: "+44 20 7946 0101", isPrimary: true }]);
  const nova = await createClient(db, actor, { name: "Nova Health", country: "Germany", industry: "Healthcare", status: "ONBOARDED" },
    [{ firstName: "Jonas", lastName: "Weber", designation: "CTO", email: "jonas@nova.example", phone: "+49 30 901820" }]);
  await createClient(db, actor, { name: "Bluewave Logistics", country: "Netherlands", status: "COMMUNICATED" },
    [{ firstName: "Daan", lastName: "Visser", email: "daan@bluewave.example", phone: "+31 20 555 0199" }]);

  const year = new Date().getFullYear();
  const p1 = await createProject(db, actor, { code: "ACME-ECOM", name: "E-commerce platform", clientId: acme.id, value: "48000", currency: "USD", startDate: `${year}-01-15` });
  await transitionProject(db, actor, p1.id, ProjectStatus.SUBMITTED);
  await transitionProject(db, actor, p1.id, ProjectStatus.APPROVED, { approvalDate: `${year}-02-01` });
  const p2 = await createProject(db, actor, { code: "NOVA-APP", name: "Patient mobile app", clientId: nova.id, value: "30000", currency: "EUR" });
  await transitionProject(db, actor, p2.id, ProjectStatus.SUBMITTED);
  await transitionProject(db, actor, p2.id, ProjectStatus.APPROVED, { approvalDate: `${year}-04-10` });
  await createProject(db, actor, { code: "ACME-BI", name: "BI dashboards (proposal)", clientId: acme.id, value: "15000", currency: "USD" }, "PROPOSED");

  const po1 = await createPO(db, actor, {
    poNumber: "ACME-PO-1001", projectId: p1.id, poDate: `${year}-02-05`, value: "40000", paymentTerms: "Net 30",
    milestones: [
      { name: "Discovery & design", percentage: "30", expectedDate: `${year}-03-01` },
      { name: "Build", percentage: "40", expectedDate: `${year}-06-01` },
      { name: "Go-live", percentage: "30", expectedDate: `${year}-09-01` },
    ],
  });
  await approvePO(db, actor, po1.id);
  const first = await db.invoice.findFirstOrThrow({ where: { poId: po1.id }, orderBy: { createdAt: "asc" } });
  await finalizeInvoice(db, actor, first.id, { invoiceDate: `${year}-03-01` });

  const po2 = await createPO(db, actor, { poNumber: "NOVA-4471", projectId: p2.id, poDate: `${year}-04-15`, value: "12000" });
  await approvePO(db, actor, po2.id);
  const manual = await createManualInvoice(db, actor, { poId: po2.id, lines: [{ description: "Sprint 1–2 delivery", quantity: "2", unitPrice: "2500" }] });
  await finalizeInvoice(db, actor, manual.id);

  await createPO(db, actor, { poNumber: "ACME-PO-1002", projectId: p1.id, poDate: `${year}-05-01`, value: "8000", milestones: [{ name: "Support retainer", percentage: "60" }] });
  console.log("Demo data created.");
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
