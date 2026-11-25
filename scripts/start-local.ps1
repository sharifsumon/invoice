# Keeps the app running on http://localhost:3100 in the background, in PRODUCTION mode.
# Registered as the "InvoiceCRM-Local" scheduled task at logon; restarts the server if it exits.
#
# Production mode (build + next start) rather than `next dev`: dev mode's live-reload made open pages refresh
# themselves in an endless loop. It is also faster. After changing code, restart the task to rebuild:
#   Stop-ScheduledTask InvoiceCRM-Local; Start-ScheduledTask InvoiceCRM-Local
# The build goes to .next-local (NEXT_DIST_DIR) so `npm run build` for tests doesn't touch the running server.
#
# Logs: %LOCALAPPDATA%\InvoiceCRM\logs\server.log  (outside the project folder on purpose)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$env:NEXT_DIST_DIR = ".next-local"
$logDir = Join-Path $env:LOCALAPPDATA "InvoiceCRM\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "server.log"
Set-Location $root

while ($true) {
  # Wait for PostgreSQL after boot.
  while ((Get-Service postgresql-x64-17 -ErrorAction SilentlyContinue).Status -ne "Running") { Start-Sleep 5 }
  # Rotate a large log.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item $log "$log.old" -Force }
  Add-Content $log "`n==== $(Get-Date -Format s) building ===="
  & cmd.exe /c "npm run build >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Add-Content $log "==== $(Get-Date -Format s) build failed ($LASTEXITCODE), retrying in 60s ===="
    Start-Sleep 60
    continue
  }
  Add-Content $log "==== $(Get-Date -Format s) starting server ===="
  & cmd.exe /c "npx next start -p 3100 >> `"$log`" 2>&1"
  Add-Content $log "==== $(Get-Date -Format s) server exited ($LASTEXITCODE), restarting in 10s ===="
  Start-Sleep 10
}
