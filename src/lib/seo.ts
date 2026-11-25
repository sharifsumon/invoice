/**
 * SEO settings for the public pages (homepage, pricing). Target searches: "invoice", "billing",
 * "invoice software", "billing software", "invoice management system", "CRM with invoicing", "purchase order".
 * SITE_URL (env) overrides the domain, e.g. for a staging copy.
 */
export const SITE_URL = (process.env.SITE_URL || "https://invoicehub.online").replace(/\/$/, "");

export const SEO_TITLE = "InvoiceHub — Invoice & Billing Software with CRM, Purchase Orders and an AI Assistant";
export const SEO_DESCRIPTION =
  "InvoiceHub is invoice and billing software for growing teams: clients and contacts, projects, purchase orders with payment " +
  "milestones, automatic invoice creation, part payments, PDF & Excel invoices, invoice email — and an AI assistant you can ask anything. Free for 14 days.";

export const SEO_KEYWORDS = [
  "invoice software", "billing software", "invoice management system", "invoicing app", "online invoicing",
  "invoice generator", "billing system", "CRM with invoicing", "purchase order software", "milestone billing",
  "payment tracking", "PDF invoice", "accounts receivable", "AI invoice assistant", "small business invoicing",
  "invoices", "automatic invoices", "CRM and billing software", "client management",
];
