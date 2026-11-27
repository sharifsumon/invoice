import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LineEditor } from "@/components/line-editor";
import { buttonClass, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { createStandaloneInvoiceAction } from "../actions";

export const metadata = { title: "Create invoice" };

/** Individual invoice: billed straight to a client, without a project or purchase order. */
export default async function NewInvoicePage({ searchParams }: PageProps<"/invoices/new">) {
  await requirePermission("invoices", "create");
  const { clientId } = await searchParams;
  const [{ template, company }, clients] = await Promise.all([
    getSettings(prisma),
    prisma.client.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const currency = company.defaultCurrency;
  const preselect = typeof clientId === "string" && clients.some((c) => c.id === clientId) ? clientId : "";

  return (
    <>
      <PageHeader back={{ href: "/invoices", label: "Invoices" }} title="Create invoice"
        subtitle="An individual invoice billed straight to a client. To bill against a purchase order, create the invoice from the PO." />
      <Card actions={<Link href="/invoices" className={buttonClass("secondary")}>Cancel</Link>}>
        {clients.length === 0 ? (
          <p className="text-sm text-slate-500">Add a client first. <Link href="/clients" className="font-semibold text-brand-700 underline underline-offset-2">Go to clients</Link></p>
        ) : (
          <ActionForm action={createStandaloneInvoiceAction}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Client *" className="sm:col-span-3">
                <Select name="clientId" defaultValue={preselect} required>
                  <option value="" disabled>Choose a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Invoice date" hint="Blank = the day it is finalized"><Input type="date" name="invoiceDate" /></Field>
              <Field label="Due date" hint={`Blank = invoice date + ${company.paymentTermsDays} days`}><Input type="date" name="dueDate" /></Field>
              <Field label="Currency"><Input value={currency} readOnly aria-readonly className="bg-slate-50" /></Field>
            </div>
            <LineEditor initial={[]} currency={currency}
              taxRate={template.showTax ? template.defaultTaxRate.toString() : "0"} showTax={template.showTax} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notes"><Textarea name="notes" placeholder={company.defaultNotes ?? ""} /></Field>
              <Field label="Terms"><Textarea name="terms" placeholder={template.defaultTerms ?? ""} /></Field>
            </div>
            <SubmitButton>Create draft invoice</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
