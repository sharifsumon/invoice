import { NumberReset } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { buttonClass, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { getInvoiceTemplate, MERGE_FIELDS } from "@/server/core/email";
import { NotificationEvent } from "@/generated/prisma/enums";
import { EVENT_LABELS, recipientGroups } from "@/server/core/notifications";
import { Table, Td } from "@/components/ui";
import {
  addRateAction, deleteRateAction, removeLogoAction, saveCompanyAction, saveEmailTemplateAction, saveNotificationMatrixAction,
  saveTemplateAction, uploadLogoAction,
} from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings", "administer");
  const { company: c, template: t } = await getSettings(prisma);
  const emailTpl = await getInvoiceTemplate(prisma);
  const smtp = process.env.SMTP_HOST;
  const rates = await prisma.exchangeRate.findMany({ orderBy: [{ effectiveDate: "desc" }, { fromCurrency: "asc" }], take: 100 });
  const groups = await prisma.userGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const matrix = await Promise.all(Object.values(NotificationEvent).map(async (e) => ({ event: e, groupIds: await recipientGroups(prisma, e) })));
  const year = new Date().getFullYear();
  const sample = `${t.numberPrefix}${t.numberReset === "YEARLY" ? `${year}-` : ""}${"1".padStart(t.numberPadding, "0")}`;

  return (
    <>
      <PageHeader title="Settings" subtitle="Company profile, branding and invoice template. Changes apply to new and draft invoices only." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Company profile">
            <ActionForm action={saveCompanyAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name *"><Input name="legalName" required defaultValue={c.legalName} /></Field>
                <Field label="Display name *"><Input name="displayName" required defaultValue={c.displayName} /></Field>
                <Field label="Business email"><Input name="email" type="email" defaultValue={c.email ?? ""} /></Field>
                <Field label="Phone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
                <Field label="Website"><Input name="website" defaultValue={c.website ?? ""} /></Field>
                <Field label="Registration number"><Input name="registrationNumber" defaultValue={c.registrationNumber ?? ""} /></Field>
                <Field label="Tax / VAT registration number"><Input name="taxNumber" defaultValue={c.taxNumber ?? ""} /></Field>
                <Field label="Company currency" hint="Used for all new projects, POs, invoices, the dashboard and reports. Existing records keep their currency."><Input name="defaultCurrency" maxLength={3} className="uppercase" defaultValue={c.defaultCurrency} /></Field>
                <Field label="Default payment terms (days)"><Input name="paymentTermsDays" type="number" min={0} max={365} defaultValue={c.paymentTermsDays} /></Field>
                <Field label="Project code prefix" hint={`New projects are numbered automatically, e.g. ${c.projectCodePrefix || ""}0001.`}>
                  <Input name="projectCodePrefix" maxLength={20} pattern="[A-Za-z0-9/_\-]*" defaultValue={c.projectCodePrefix} placeholder="PRJ-" className="font-mono" />
                </Field>
                <Field label="Address" className="sm:col-span-2"><Textarea name="address" defaultValue={c.address ?? ""} /></Field>
                <Field label="Bank account / payment instructions" className="sm:col-span-2"><Textarea name="bankDetails" rows={4} defaultValue={c.bankDetails ?? ""} /></Field>
                <Field label="Standard invoice notes" className="sm:col-span-2"><Textarea name="defaultNotes" defaultValue={c.defaultNotes ?? ""} /></Field>
              </div>
              <SubmitButton>Save company profile</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Invoice template & numbering">
            <ActionForm action={saveTemplateAction}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Invoice title"><Input name="title" defaultValue={t.title} placeholder="INVOICE or TAX INVOICE" /></Field>
                <Field label="Page format">
                  <Select name="pageSize" defaultValue={t.pageSize}><option value="A4">A4</option><option value="LETTER">US Letter</option></Select>
                </Field>
                <Field label="Logo position">
                  <Select name="logoPosition" defaultValue={t.logoPosition}><option value="left">Left</option><option value="right">Right</option></Select>
                </Field>
                <Field label="Number prefix" hint={`Next number looks like ${sample}`}><Input name="numberPrefix" defaultValue={t.numberPrefix} /></Field>
                <Field label="Number digits"><Input name="numberPadding" type="number" min={1} max={10} defaultValue={t.numberPadding} /></Field>
                <Field label="Number reset">
                  <Select name="numberReset" defaultValue={t.numberReset}>
                    <option value={NumberReset.YEARLY}>Restart each year (includes year)</option>
                    <option value={NumberReset.NEVER}>Never reset</option>
                  </Select>
                </Field>
                <Field label="Tax label"><Input name="taxLabel" defaultValue={t.taxLabel} /></Field>
                <Field label="Default tax rate %"><Input name="defaultTaxRate" inputMode="decimal" defaultValue={t.defaultTaxRate.toString()} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showTax" defaultChecked={t.showTax} /> Show and apply tax on invoices</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showAmountInWords" defaultChecked={t.showAmountInWords} /> Show amount in words</label>
                <Field label="Header text" className="sm:col-span-2"><Textarea name="headerText" rows={2} defaultValue={t.headerText ?? ""} /></Field>
                <Field label="Default terms" className="sm:col-span-2"><Textarea name="defaultTerms" defaultValue={t.defaultTerms ?? ""} /></Field>
                <Field label="Footer text" className="sm:col-span-2"><Input name="footerText" defaultValue={t.footerText ?? ""} /></Field>
              </div>
              <SubmitButton>Save template</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Invoice email template">
            <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${smtp ? "bg-brand-50 text-brand-800" : "bg-lime-soft text-lime-ink"}`}>
              {smtp
                ? <>Sending via SMTP server <b>{smtp}</b> as <b>{process.env.EMAIL_FROM || "invoices@localhost"}</b>.</>
                : <>SMTP is not configured: emails are written to <code>storage/outbox</code> and not delivered. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM in <code>.env</code> to send for real.</>}
            </div>
            <ActionForm action={saveEmailTemplateAction}>
              <Field label="Subject"><Input name="subject" required defaultValue={emailTpl.subject} /></Field>
              <Field label="Body"><Textarea name="body" required rows={14} defaultValue={emailTpl.body} className="font-mono text-xs" /></Field>
              <p className="text-xs text-slate-500">Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(" ")}</p>
              <SubmitButton>Save email template</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Notification recipients">
            <p className="mb-3 text-xs text-slate-500">Choose which user groups receive each event. Due-soon means due within 7 days.</p>
            <ActionForm action={saveNotificationMatrixAction}>
              <Table head={["Event", ...groups.map((g) => g.name)]}>
                {matrix.map(({ event, groupIds }) => (
                  <tr key={event}>
                    <Td className="font-medium">{EVENT_LABELS[event]}</Td>
                    {groups.map((g) => (
                      <Td key={g.id} className="text-center">
                        <input type="checkbox" name={`${event}:${g.id}`} defaultChecked={groupIds.includes(g.id)} aria-label={`${EVENT_LABELS[event]} — ${g.name}`} />
                      </Td>
                    ))}
                  </tr>
                ))}
              </Table>
              <SubmitButton>Save recipients</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Exchange rates (reporting only)">
            <p className="mb-3 text-xs text-slate-500">
              1 unit of <b>From</b> = <b>Rate</b> units of <b>To</b>, from the effective date. Reports use the latest rate on or before each row&apos;s date
              (the inverse pair works too). Rates never change invoice amounts.
            </p>
            <ActionForm action={addRateAction} resetOnSuccess className="mb-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-5">
                <Field label="From"><Input name="fromCurrency" required maxLength={3} className="uppercase" placeholder="EUR" /></Field>
                <Field label="To"><Input name="toCurrency" required maxLength={3} className="uppercase" placeholder="USD" /></Field>
                <Field label="Rate"><Input name="rate" required inputMode="decimal" placeholder="1.0850" /></Field>
                <Field label="Effective"><Input name="effectiveDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
                <Field label="Source"><Input name="source" placeholder="e.g. central bank" /></Field>
              </div>
              <SubmitButton size="sm">Add rate</SubmitButton>
            </ActionForm>
            <Table head={["From", "To", "Rate", "Effective", "Source", ""]} empty="No rates recorded — reports will show per-currency totals only.">
              {rates.map((r) => (
                <tr key={r.id}>
                  <Td>{r.fromCurrency}</Td><Td>{r.toCurrency}</Td><Td className="tabular">{r.rate.toString()}</Td>
                  <Td>{r.effectiveDate.toISOString().slice(0, 10)}</Td><Td>{r.source ?? "—"}</Td>
                  <Td><ActionButton action={deleteRateAction.bind(null, r.id)} label="Remove" variant="ghost" confirm="Remove this rate? Reports using it will change." /></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Company logo">
            <div className="mb-4 flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
              {c.logoPath
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/settings/logo?v=${encodeURIComponent(c.logoPath)}`} alt="Company logo" className="max-h-24 max-w-full object-contain" />
                : <span className="text-xs text-slate-400">No logo uploaded</span>}
            </div>
            <ActionForm action={uploadLogoAction} resetOnSuccess className="space-y-3">
              <input type="file" name="logo" accept="image/png,image/jpeg" required className="block w-full text-sm" />
              <p className="text-xs text-slate-400">PNG or JPEG, up to 2 MB. Files are checked by content, not extension.</p>
              <SubmitButton size="sm">Upload logo</SubmitButton>
            </ActionForm>
            {c.logoPath && <div className="mt-3"><ActionButton action={removeLogoAction} label="Remove logo" variant="ghost" confirm="Remove the logo from new invoices?" /></div>}
          </Card>
          <Card title="Preview">
            <p className="mb-3 text-sm text-slate-500">See the current template with sample data.</p>
            <a href="/api/settings/preview" target="_blank" className={buttonClass("secondary")}>Open sample invoice PDF</a>
          </Card>
        </div>
      </div>
    </>
  );
}
