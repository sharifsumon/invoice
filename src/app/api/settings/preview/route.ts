import { NextResponse } from "next/server";
import { getUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { loadLogo } from "@/server/core/invoices";
import { amountInWords, dec } from "@/server/core/money";
import { renderInvoicePdf, type InvoiceSnapshot } from "@/server/core/pdf";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";

/** Sample invoice rendered with the current company + template settings. */
export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user, "settings", "view")) return new NextResponse("Forbidden", { status: 403 });
  const { company: c, template: t } = await getSettings(prisma);
  const subtotal = dec("12500.00");
  const rate = t.showTax ? t.defaultTaxRate : dec(0);
  const tax = subtotal.times(rate).dividedBy(100).toDecimalPlaces(2);
  const total = subtotal.plus(tax);
  const year = new Date().getFullYear();
  const snap: InvoiceSnapshot = {
    title: t.title,
    company: { displayName: c.displayName, legalName: c.legalName, address: c.address, email: c.email, phone: c.phone, website: c.website,
      registrationNumber: c.registrationNumber, taxNumber: c.taxNumber, bankDetails: c.bankDetails, logoSha256: null },
    template: { logoPosition: t.logoPosition, headerText: t.headerText, footerText: t.footerText, pageSize: t.pageSize, showTax: t.showTax, taxLabel: t.taxLabel, showAmountInWords: t.showAmountInWords },
    client: { name: "Sample Client Ltd", legalName: "Sample Client Limited", address: "1 Example Street\nSample City", country: "Country",
      taxId: "TAX-000000", email: "accounts@client.example", contactName: "Alex Example", contactEmail: "alex@client.example" },
    project: { code: "SAMPLE-01", name: "Website Redevelopment" },
    po: { poNumber: "PO-12345" },
    invoice: {
      number: `${t.numberPrefix}${t.numberReset === "YEARLY" ? `${year}-` : ""}${"1".padStart(t.numberPadding, "0")}`,
      date: new Date().toISOString().slice(0, 10), dueDate: new Date(Date.now() + c.paymentTermsDays * 86400000).toISOString().slice(0, 10),
      currency: c.defaultCurrency, kind: "MILESTONE",
      lines: [{ description: "Milestone 2: Design sign-off (25% of PO PO-12345)", quantity: "1", unitPrice: "12500.00", amount: "12500.00" }],
      subtotal: subtotal.toFixed(2), discount: "0.00", taxRate: rate.toString(), taxAmount: tax.toFixed(2), total: total.toFixed(2),
      notes: c.defaultNotes, terms: t.defaultTerms, amountInWords: t.showAmountInWords ? amountInWords(total, c.defaultCurrency) : null, version: 1,
    },
  };
  const pdf = await renderInvoicePdf(snap, { logo: await loadLogo(c.logoPath), draft: true });
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="sample-invoice.pdf"' } });
}
