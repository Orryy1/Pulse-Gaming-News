# uninstall-worker.ps1 — removes the Pulse Gaming worker scheduled task.
param(
  [string]$TaskName = 'PulseGamingWorker'
)

$ErrorActionPreference = 'Stop'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Task '$TaskName' not registered — nothing to do."
  exit 0
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "✔ Task '$TaskName' removed." -ForegroundColor Green
