# UAT checklist: BRD §11 acceptance criteria

The "How verified" column says what already covers each criterion. Abbreviations:
**U** = unit/integration tests (`npm test`, against a real PostgreSQL database) · **E** = browser E2E (`npm run test:e2e`) · **M** = manual check during development.
For business sign-off, the "UAT step" column is what a tester does in the app.

| # | Acceptance criterion | How verified | UAT step |
|---|---|---|---|
| 1 | Create a client with multiple contacts and track its status | U, E | Clients → New client; add a 2nd contact; change status and see it on the activity timeline |
| 2 | Multiple projects per client with value, dates, status, approval date | U, E | Client → New project (×2); Submit → Approve with a date |
| 3 | Business Value = approved projects only, by approval date | U (`financial-rules`, `reports-notifications`) | Dashboard + Reports → Project register: draft projects add 0 |
| 4 | A project with several POs counts once in Business Value | U | Add 2 POs to one project; Business Value is unchanged |
| 5 | PO with a configurable number of milestones | U, E | New PO → add 3 milestones |
| 6 | Approval blocked unless milestones total exactly 100% | U, M | Set 60% → Approve → error message; PO stays Draft |
| 7 | Approval creates one invoice per milestone, no duplicates | U (including concurrent retries), E | Approve → "2 milestone invoices generated"; "Generate missing" creates 0 |
| 8 | Concurrent invoice creation cannot exceed the PO value | U (8 concurrent requests; DB trigger) | — (automated only) |
| 9 | No one, including admins, can override the PO cap | U (admin attempt; DB trigger rejects direct writes) | As admin, try a manual invoice over the remaining balance |
| 10 | Cancelling releases the allocation and keeps history | U | Cancel an invoice → PO "Remaining invoiceable" goes up; invoice still listed as Cancelled |
| 11 | Manual invoices only within the remaining balance | U, E | PO page → Create manual invoice; the box shows the remaining balance |
| 12 | Full/partial payments update balance and status | U (including concurrent), E | Invoice → Record payment 40% → Partially Paid; record the rest → Paid |
| 13 | Partially paid and past due = Partially Paid + Overdue flag | U | Finalize with a past due date, pay part → both badges show |
| 14 | Dashboards never combine currencies without conversion | U, M | Dashboard shows USD and EUR on separate lines; Reports → pick a reporting currency |
| 15 | Admin uploads/previews logo; configures branding and print settings | M | Settings → upload logo → "Open sample invoice PDF" |
| 16 | Finalized invoices can be previewed, downloaded and printed | E, M | Invoice → Open PDF / Download / Print |
| 17 | Export to Excel/CSV; bulk PDF ZIP | U, M | Invoices → Export CSV/Excel; tick rows → Download selected PDFs |
| 18 | Email invoice with PDF; review before sending | U, E | Invoice → Email invoice → edit To/CC/subject → Send |
| 19 | Email attempts and failures recorded; resend possible | U | Send twice → two entries in Send history; a failure shows its error |
| 20 | Finalized PDFs don't change when settings change | U (byte-identical file after a settings change) | Finalize, rename company in Settings, reopen PDF: old name |
| 21 | Role permissions restrict sensitive actions; audit captures financial changes | U (permission matrix + audit coverage), E (viewer) | Sign in as Viewer: no edit buttons, Settings denied; Audit Log lists every action |

## Additional phase 6 checks

| Area | How verified |
|---|---|
| Two-factor sign-in (TOTP) | U (RFC 6238 test vectors), E |
| Sessions revoked on password change, role change or deactivation | U |
| Security headers (CSP, HSTS, X-Frame-Options, nosniff) | E |
| Upload validation (content-based, size limits) | U |
| Backup → restore round trip | M (see DEPLOYMENT.md) |

## Decisions still to confirm with the business (BRD §15)

1. **PO cap amount:** the cap is checked on the pre-tax invoice amount (subtotal minus discount); tax is added on top. Confirm, or switch to checking the tax-inclusive total.
2. **Invoice numbering:** default is `INV-YYYY-00001`, restarting each year. It can be changed in Settings.
3. **Approval authority:** projects are approved by Management or Admin; POs by Finance, Management or Admin; invoices finalized and cancelled by Finance or Admin. The matrix is in `src/server/core/permissions.ts`.
4. **Corrections:** an invoice is corrected by cancelling it and reissuing a v2. No credit-note process yet.
5. **Tax/VAT wording and rates** for each country you invoice in.
