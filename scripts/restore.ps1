# Restore a backup made by backup.ps1. DESTRUCTIVE for the target database and storage directory.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -From .\backups\20261122T021500Z [-DatabaseUrl postgresql://...] [-StorageDir .\storage] [-Force]
# Stop the app first. To inspect a backup safely, pass -DatabaseUrl for a scratch database and -StorageDir for a scratch folder.
param(
  [Parameter(Mandatory = $true)][string]$From,
  [string]$DatabaseUrl,
  [string]$StorageDir,
  [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
  [switch]$Force
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

if (-not $DatabaseUrl) { $DatabaseUrl = Read-DotEnv "DATABASE_URL" }
if (-not $StorageDir) { $StorageDir = Read-DotEnv "STORAGE_DIR"; if (-not $StorageDir) { $StorageDir = ".\storage" } }
$DatabaseUrl = $DatabaseUrl.Split("?")[0]

# Verify checksums
foreach ($line in Get-Content (Join-Path $From "SHA256SUMS")) {
  $parts = $line -split "\s+", 2
  $actual = (Get-FileHash (Join-Path $From $parts[1]) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $parts[0]) { throw "Checksum mismatch for $($parts[1]) - backup is corrupt" }
}

if (-not $Force) {
  throw "Refusing to overwrite without -Force. Target DB: $($DatabaseUrl -replace '//[^@]*@', '//***@'), storage: $StorageDir"
}

& "$PgBin\pg_restore.exe" --clean --if-exists --no-owner --no-privileges --exit-on-error "--dbname=$DatabaseUrl" (Join-Path $From "db.dump")
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed ($LASTEXITCODE)" }

$zip = Join-Path $From "storage.zip"
if (Test-Path $zip) {
  if (Test-Path $StorageDir) {
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    Rename-Item $StorageDir "$StorageDir.before-restore.$stamp"
  }
  Expand-Archive -Path $zip -DestinationPath $StorageDir
}
Write-Output "Restore complete into $($DatabaseUrl -replace '//[^@]*@', '//***@'). Start the app and check /api/health."
