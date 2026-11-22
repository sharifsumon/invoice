# Backup for Windows installs: PostgreSQL dump + private file storage, with checksums and retention.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# Reads DATABASE_URL and STORAGE_DIR from .env unless already set. Schedule with Task Scheduler for daily runs.
param(
  [string]$BackupDir = ".\backups",
  [int]$RetentionDays = 30,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin"
)
$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ($v) { return $v }
  if (Test-Path .env) {
    $m = Select-String -Path .env -Pattern "^\s*$name\s*=\s*`"?([^`"]*)`"?\s*$" | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value }
  }
  return $null
}

$dbUrl = Read-DotEnv "DATABASE_URL"
if (-not $dbUrl) { throw "DATABASE_URL is not set" }
$dbUrl = $dbUrl.Split("?")[0]
$storage = Read-DotEnv "STORAGE_DIR"; if (-not $storage) { $storage = ".\storage" }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$dest = Join-Path $BackupDir $stamp
New-Item -ItemType Directory -Force $dest | Out-Null

& "$PgBin\pg_dump.exe" --format=custom --no-owner --no-privileges "--dbname=$dbUrl" "--file=$dest\db.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }

if (Test-Path $storage) {
  Compress-Archive -Path (Join-Path $storage "*") -DestinationPath "$dest\storage.zip" -CompressionLevel Optimal
} else {
  Write-Warning "Storage directory $storage not found; backing up the database only."
}

$sums = Get-ChildItem $dest -File | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name }
$sums | Out-File -Encoding ascii "$dest\SHA256SUMS"
"{`"created`":`"$stamp`",`"app`":`"invoice-crm`"}" | Out-File -Encoding ascii "$dest\manifest.json"

& "$PgBin\pg_restore.exe" --list "$dest\db.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backup verification failed: dump is not readable" }

Get-ChildItem $BackupDir -Directory | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Recurse -Force -Confirm:$false

Write-Output "Backup OK: $dest"
