# Deployment & operations

## Option A: Docker (recommended)

Requirements: a Linux server with Docker and Compose, a domain name, and a TLS reverse proxy (Caddy or nginx).

```bash
git clone <repo> /opt/invoicecrm && cd /opt/invoicecrm
cp .env.example .env.production          # then edit; see "Configuration" below
export POSTGRES_PASSWORD='<long random>'  # same password as in DATABASE_URL
docker compose up -d --build
docker compose exec app npx prisma db seed   # first run only: settings + admin account
curl -s http://127.0.0.1:3000/api/health     # {"status":"ok",...}
```

Example reverse proxy (Caddy):

```
crm.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

To upgrade: `git pull && docker compose up -d --build`. Migrations run automatically when the container starts.

> **Not yet tested:** the Dockerfile and compose file were written but not built on the development PC, which has no Docker. Build and smoke-test them on a staging server before relying on them. Option B below is what was actually tested (`npm run build`, then `next start` with the E2E suite running against it).

## Option B: Node directly (systemd)

Requirements: Node 20.9 or later, PostgreSQL 14 or later.

```bash
npm ci && npm run build
npm run db:migrate && npm run db:seed
PORT=3000 npx next start            # wrap in a systemd unit; run as a dedicated non-root user
```

Example `/etc/systemd/system/invoicecrm.service`:

```ini
[Service]
User=invoicecrm
WorkingDirectory=/opt/invoicecrm
EnvironmentFile=/opt/invoicecrm/.env.production
ExecStartPre=/usr/bin/npx prisma migrate deploy
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
```

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/invoicecrm` (host `db` under Docker Compose) |
| `AUTH_SECRET` | yes | 32+ random characters; changing it signs everyone out. Generate with `openssl rand -base64 48` |
| `STORAGE_DIR` | yes | Persistent private directory for PDFs, receipts, logos and attachments |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | for email | Without `SMTP_HOST`, mail goes to `STORAGE_DIR/outbox` and is **not delivered** |
| `CRON_SECRET` | recommended | Enables `POST /api/cron/notifications` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first run | Used once by `db:seed`; remove them from the file afterwards |

## Scheduled jobs

```cron
# due / overdue notifications (hourly)
5 * * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.com/api/cron/notifications
# nightly backup, 30-day retention
15 2 * * *  cd /opt/invoicecrm && DATABASE_URL=... STORAGE_DIR=... BACKUP_DIR=/var/backups/invoicecrm ./scripts/backup.sh
```

On Docker, run the backup against the database container, or run `pg_dump` from the host against the published port. Copy backups **off the server**, for example to object storage with `rclone`.

## Backup & restore

- `scripts/backup.sh` / `scripts/backup.ps1` write `db.dump` (pg_dump custom format) plus `storage.tar.gz` / `storage.zip`, along with `SHA256SUMS` and `manifest.json`. Each backup is checked by reading the dump back (`pg_restore --list`).
- `scripts/restore.sh` / `scripts/restore.ps1` verify the checksums first, then restore the database and storage. Restore requires typing `RESTORE` (or passing `-Force`). Stop the app before restoring.
- **Tested 2026-11-22:** a backup of the development database was restored into a scratch database. Row counts for clients, invoices, payments and audit entries matched, the invoice total matched (53,000.00), the protective triggers were present, and the invoice PDFs were restored.
- Repeat a test restore into a scratch database at least quarterly (BRD §9).

## Monitoring

- `GET /api/health` returns 200 `{"status":"ok"}` when the database and storage are both available, otherwise 503. It needs no login and reveals no data.
- Watch for the following in the audit log: `auth.login_failed`, `auth.mfa_failed`, `invoice.email_failed`.

## Release checklist

1. `npm run typecheck && npm run lint && npm test` all pass.
2. `npm run build && npm run test:e2e` (4 browser tests against the production build).
3. Back up the database before running migrations.
4. Deploy and check `/api/health`.
5. Sign in as admin and confirm the dashboard loads.
6. Turn on two-factor for all Administrator and Finance accounts.
7. Configure SMTP and send a test invoice email to yourself.
8. Set up the backup cron job, then perform one test restore.
