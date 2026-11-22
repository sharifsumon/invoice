#!/usr/bin/env bash
# Backup: PostgreSQL (custom-format dump) + private file storage (invoice PDFs, receipts, logos, attachments).
# Usage:  DATABASE_URL=... STORAGE_DIR=/var/lib/invoicecrm/storage BACKUP_DIR=/var/backups/invoicecrm ./scripts/backup.sh
# Schedule daily (cron):  15 2 * * *  cd /opt/invoicecrm && ./scripts/backup.sh >> /var/log/invoicecrm-backup.log 2>&1
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/$stamp"
mkdir -p "$dest"
chmod 700 "$BACKUP_DIR" "$dest"

# --dbname accepts the URI; strip Prisma-only query params (e.g. ?schema=public) that libpq rejects.
db_url="${DATABASE_URL%%\?*}"
pg_dump --format=custom --no-owner --no-privileges --dbname="$db_url" --file="$dest/db.dump"
tar -C "$(dirname "$STORAGE_DIR")" -czf "$dest/storage.tar.gz" "$(basename "$STORAGE_DIR")"

( cd "$dest" && sha256sum db.dump storage.tar.gz > SHA256SUMS )
echo "{\"created\":\"$stamp\",\"app\":\"invoice-crm\"}" > "$dest/manifest.json"

# Verify the dump is readable before declaring success.
pg_restore --list "$dest/db.dump" > /dev/null

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} +
echo "Backup OK: $dest"
