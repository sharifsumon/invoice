# Keeps the app running on http://localhost:3100 in the background (dev mode, picks up code changes).
# Registered as the "InvoiceCRM-Local" scheduled task at logon; restarts the server if it exits.
# Logs: storage\logs\server.log
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$logDir = Join-Path $root "storage\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "server.log"
Set-Location $root

while ($true) {
  # Wait for PostgreSQL after boot.
  while ((Get-Service postgresql-x64-17 -ErrorAction SilentlyContinue).Status -ne "Running") { Start-Sleep 5 }
  # Rotate a large log.
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item $log "$log.old" -Force }
  Add-Content $log "`n==== $(Get-Date -Format s) starting server ===="
  & cmd.exe /c "npm run dev -- -p 3100 >> `"$log`" 2>&1"
  Add-Content $log "==== $(Get-Date -Format s) server exited ($LASTEXITCODE), restarting in 10s ===="
  Start-Sleep 10
}
