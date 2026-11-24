# Invoice + CRM

A web app for clients, projects, purchase orders (POs) and invoices, built from *BRD v1.2 – CRM, Project, PO & Invoice Management System*.

**All six BRD phases are implemented:** foundation, projects and POs, invoices, payments and invoice email, reports, currency conversion, notifications and search. Phase 6 added two-factor sign-in, session revocation, security headers, PO attachments, a health check, backup/restore scripts, browser E2E tests and deployment files.

More documentation: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (install, configuration, scheduled jobs, backups) · [docs/UAT.md](docs/UAT.md) (BRD §11 acceptance checklist) · [docs/SECURITY.md](docs/SECURITY.md) (security review).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, server actions, route handlers), React 19, TypeScript |
| UI | Tailwind CSS 4 |
| Database | PostgreSQL 17 with Prisma 7 (`@prisma/adapter-pg`) |
| Money | `Decimal(18,2)` in the database, Prisma `Decimal` in code. No floats anywhere in financial logic. |
| PDF | pdfkit, rendered on the server |
| Export | CSV, Excel (exceljs), bulk ZIP (archiver) |
| Auth | Email and password (bcrypt), signed JWT session cookie (jose), 8-hour sessions |
| Tests | Vitest, run against a real PostgreSQL test database |

It is a modular monolith. The business rules live in `src/server/core/*`; these modules take a db client and an actor and know nothing about the web layer. Pages and server actions in `src/app/**` are thin wrappers around them.

```
prisma/schema.prisma           data model
prisma/migrations/             SQL migrations, including the DB guards (triggers, partial unique index)
prisma/seed.ts                 settings + first admin (+ optional demo data)
src/server/core/
  money.ts                     decimal helpers, milestone allocation, amount in words
  permissions.ts               role → module/action matrix (BRD §4)
  clients.ts projects.ts       CRM, project approval, business value
  pos.ts                       PO lifecycle, approval, idempotent milestone invoice generation, PO balance
  invoices.ts                  manual invoices, draft edits, finalize/number/snapshot, cancel, reissue
  pdf.ts                       invoice PDF renderer
  settings.ts                  company profile, template, logo, users
  storage.ts                   private file storage (local disk)
src/app/(app)/**               pages + server actions
src/app/api/**                 PDF, export, ZIP, logo, template preview
tests/                         money + financial-rule integration tests
```

## How the financial rules are enforced

| Rule | Where it is enforced |
|---|---|
| BR-01/02/03: Business Value counts approved projects only, grouped by approval date, and never includes PO value | `projects.ts` (`businessValue`, `businessValueByMonth`) |
| BR-04: milestones must total exactly 100% before approval | `allocateMilestones` checks with exact decimals; the rounding remainder goes on the last milestone |
| BR-05/06: approval creates one invoice per milestone; a retry never creates duplicates | `approvePO` runs in one transaction, and generation skips milestones that already have an invoice. **DB:** a partial unique index allows one non-cancelled invoice per milestone. |
| BR-07/08/10: valid invoices never exceed the PO value, with no override | Service-level check under a `SELECT … FOR UPDATE` lock on the PO row. **DB:** the `invoice_po_cap` trigger rejects any insert or update that would exceed the cap, whoever makes it. |
| BR-09: a cancelled invoice frees its PO allocation | Cancelled invoices are excluded from every total; the record and its audit entries stay |
| BR-11: payment status follows recorded payments | Overdue is a derived flag, not a status (see `isOverdue`) |
| BR-12: currencies are never added together | Every total is grouped by currency |
| BR-14: finalized documents stay as issued | Finalizing freezes a JSON snapshot and stores the PDF with its SHA-256. Preview, download, print and ZIP all serve that stored file. |
| Audit trail | `AuditLog` is append-only; a DB trigger blocks UPDATE and DELETE |
| §5.6: payments never exceed the outstanding balance; they are never deleted | `recordPayment` checks under an invoice row lock. **DB:** the `payment_guard` trigger rejects overpayment, payments on drafts or cancelled invoices, edits and deletes. Corrections are reversals that require a reason. |
| BR-11: payment status follows recorded payments | **DB:** the `payment_sync_invoice` trigger recalculates `amountPaid` and sets Unpaid / Partially Paid / Paid after every payment or reversal |
| BR-13: actual collections use payment dates | `collectionsByMonth` and the dashboard group valid payments by `paymentDate` |
| BR-15: every email attempt is logged; sending never changes payment status | `sendInvoiceEmail` attaches the **stored** PDF (its SHA-256 is checked first) and writes an append-only `InvoiceEmailLog` row for every attempt, success or failure |

**PO cap amount.** The cap applies to each invoice's pre-tax amount: subtotal minus discount. Tax is added on top, so a PO priced without tax can still carry a tax invoice. This needs business confirmation (BRD §15, Tax/VAT).

**Drafts and totals.** A draft invoice reserves its share of the PO, so it counts against the cap. It only becomes a receivable (invoiced, outstanding, overdue) once it is finalized.

## Setup (local)

Requirements: Node 20.9 or later, PostgreSQL 14 or later.

```powershell
npm install
copy .env.example .env      # then edit the values
npm run db:migrate          # apply migrations
npm run db:seed             # settings + admin (SEED_DEMO=1 adds demo data)
npm run dev                 # http://localhost:3000
```

The database user in `TEST_DATABASE_URL` needs `CREATEDB`: the test suite drops and recreates that database on every run.

```powershell
npm test          # 58 tests: money, PO/invoice rules, payments, email, reports, FX, notifications, search, security, audit
npm run build; npm run test:e2e   # 4 browser tests against the production build (uses installed Edge; separate e2e DB)
npm run backup    # Windows backup (Linux: scripts/backup.sh)
npm run typecheck
npm run lint
```

## Roles (default permissions)

| Role | Can |
|---|---|
| Administrator | Everything, including settings, users and numbering |
| Management | View everything, approve projects and POs, export |
| Business Development | Create and edit clients, contacts and projects |
| Project Manager | Create and edit projects |
| Finance | POs (create, approve, cancel), invoices (create, finalize, cancel, export) |
| Viewer | Read-only |

The matrix is in `src/server/core/permissions.ts`. Every server action and route handler checks permissions; hiding buttons in the UI is only a convenience.

## Key workflows

1. **Client → Project:** create a client and its contacts, then a project. Submit the project; Management or Admin approves it and sets the approval date, which drives Business Value.
2. **Project → PO:** create a PO with optional milestones; the editor shows a running total and preview amounts. Submit the PO, then approve it. If it has milestones, one **draft** invoice is created per milestone.
3. **Invoice:** review the draft, then finalize it. Finalizing assigns the next number (for example `INV-2026-00001`), sets the dates, freezes the snapshot and stores the PDF. From then on, preview, download, print, export and bulk ZIP all use that same file.
4. **Correction:** use *Cancel & reissue*. It cancels the invoice, releases the allocation and creates a new draft marked `v2`. An invoice with valid payments must have them reversed first.
5. **Payment:** on a finalized invoice, use *Record payment*: amount (pre-filled with the outstanding balance, editable), date, method, reference and an optional receipt (PDF, PNG or JPEG). Partial payments are allowed, and the status updates automatically. Use *Reverse* (with a reason) to correct a mistake.
6. **Email:** *Email invoice* opens a form pre-filled from the template, addressed to the client's primary contact. Edit To, CC, BCC, subject and body, then send. The finalized PDF is attached. Each attempt, including resends and failures, appears in the send history.

### Reports (BRD §5.8, §10)

The **Reports** menu holds 10 reports, all built on one engine (`src/server/core/reports.ts`). Each can be filtered (date range, client, currency, status or year, depending on the report) and exported as **CSV, Excel or PDF**:

client register & contacts · project register & business value · PO register · invoice register · payments & collections ·
receivables aging (not due / 1–30 / 31–60 / 61–90 / 90+) · expected collections forecast by due month ·
monthly commercial performance · client performance · project performance.

**Currencies (BR-12).** By default, totals are shown per currency. To combine currencies, pick a **reporting currency**. Each amount is then converted with the latest recorded rate effective on or before that row's own date; the inverse pair is used if only that direction exists. Amounts with no rate are never guessed: they're flagged "no rate", counted, and left out of the converted total. Rates are managed under Settings → Exchange rates and are for reporting only.

### Notifications & search (BRD §5.9)

- In-app notifications, shown on the bell in the sidebar, for: invoice due within 7 days, invoice overdue, PO approved, milestone approval/invoice generation failed, and invoice email failed.
- Settings → Notification recipients sets which roles receive each event.
- Due and overdue checks run automatically while the app is in use (at most every 10 minutes). For guaranteed timing, call `POST /api/cron/notifications` with `Authorization: Bearer $CRON_SECRET` from a scheduler. The checks are safe to repeat, because each notification is created once per invoice and due date.
- The search box in the sidebar searches clients, contacts, projects, POs and invoices. Results are filtered by the user's permissions.

### Email delivery

With `SMTP_HOST` set, mail goes through that SMTP server. Without it, the app uses a **dev outbox**: each message is written as an `.eml` file under `storage/outbox/` and nothing is delivered. The UI says so clearly. "Sent" means the SMTP server accepted the message, not that the recipient opened it.

## Deployment notes

- `npm run build` then `npm start` behind a reverse proxy with HTTPS. Session cookies are `Secure` in production.
- Put `STORAGE_DIR` on persistent disk, and back it up **together with** the database: invoice PDFs and logos live there.
- Run `npm run db:migrate` on each deploy.
- Back up PostgreSQL with `pg_dump` on a schedule, and test restores (BRD §9).

## Roadmap

- ~~**Phase 4:** payments and invoice email~~ (done)
- ~~**Phase 5:** reports, exchange rates, notifications, global search~~ (done)
- ~~**Phase 6:** MFA, PO attachments, E2E tests, Docker, backups, security review~~ (done; Docker files not yet built, see DEPLOYMENT.md)
- **Possible next steps:** enforce two-factor for chosen roles, credit notes, nonce-based CSP, a client portal (out of scope in BRD §3.2).
