#!/usr/bin/env bash
# Restore a backup made by backup.sh. DESTRUCTIVE for the target database and storage directory.
# Usage:  DATABASE_URL=... STORAGE_DIR=... ./scripts/restore.sh /var/backups/invoicecrm/20261122T021500Z
# Stop the app first. Restore into a scratch database first if you only want to inspect a backup.
set -euo pipefail

src="${1:?Pass the backup directory}"
: "${DATABASE_URL:?DATABASE_URL is required}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"

( cd "$src" && sha256sum --check SHA256SUMS )
db_url="${DATABASE_URL%%\?*}"

read -r -p "This will overwrite the database and $STORAGE_DIR. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Aborted."; exit 1; }

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$db_url" "$src/db.dump"

if [ -d "$STORAGE_DIR" ]; then mv "$STORAGE_DIR" "$STORAGE_DIR.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"; fi
mkdir -p "$(dirname "$STORAGE_DIR")"
tar -C "$(dirname "$STORAGE_DIR")" -xzf "$src/storage.tar.gz"
echo "Restore complete. Start the app and check /api/health."
