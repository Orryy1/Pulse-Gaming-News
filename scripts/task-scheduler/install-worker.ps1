# install-worker.ps1 — register the pulse-gaming worker as a Scheduled Task.
#
# Run from an elevated PowerShell. Creates a task that:
#   - Starts at user logon (so node has access to the user's GPU/node_modules).
#   - Restarts every 5 minutes on failure, indefinitely.
#   - Stops the task if the system switches to battery power (desktop
#     hosts don't switch, so this is a belt-and-braces gate in addition
#     to the Node-side battery check).
#   - Wakes the computer to run (so overnight builds still happen).
#   - Runs only when the user is idle for 10+ minutes (conservative
#     default — Node-side gate is the real arbiter).
#
# Usage:
#   pwsh -File scripts\task-scheduler\install-worker.ps1
#   pwsh -File scripts\task-scheduler\install-worker.ps1 -TaskName PulseWorker -MinIdleMinutes 10
#
# Uninstall: scripts\task-scheduler\uninstall-worker.ps1

param(
  [string]$TaskName = 'PulseGamingWorker',
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [int]$MinIdleMinutes = 10,
  [switch]$RunAsSystem
)

$ErrorActionPreference = 'Stop'

$wrapper = Join-Path $ProjectRoot 'scripts\task-scheduler\pulse-worker.ps1'
if (-not (Test-Path $wrapper)) {
  throw "Wrapper script not found: $wrapper"
}

Write-Host "Installing scheduled task '$TaskName'"
Write-Host "ProjectRoot: $ProjectRoot"
Write-Host "Wrapper:     $wrapper"

# Stop + remove existing registration so re-runs are idempotent.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Existing task found — removing before re-install."
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`" -ProjectRoot `"$ProjectRoot`"" `
  -WorkingDirectory $ProjectRoot

# Trigger at logon + every boot. The task is long-running; we don't need
# a time-of-day trigger because the cloud scheduler is already the
# source of truth for "when should X happen".
$trigAtLogon = New-ScheduledTaskTrigger -AtLogOn
$trigAtStart = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries:$false `
  -DontStopIfGoingOnBatteries:$false `
  -WakeToRun:$true `
  -StartWhenAvailable:$true `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -RestartCount 999 `
  -MultipleInstances IgnoreNew `
  -RunOnlyIfIdle:$true `
  -IdleDuration ([TimeSpan]::FromMinutes($MinIdleMinutes)) `
  -IdleWaitTimeout ([TimeSpan]::FromMinutes(60))

if ($RunAsSystem) {
  $principal = New-ScheduledTaskPrincipal `
    -UserId 'SYSTEM' `
    -LogonType ServiceAccount `
    -RunLevel Highest
} else {
  # Run as the invoking user so node inherits their GPU driver + PATH.
  $principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType InteractiveToken `
    -RunLevel Highest
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($trigAtLogon, $trigAtStart) `
  -Settings $settings `
  -Principal $principal `
  -Description 'Pulse Gaming autonomous worker — polls cloud for GPU jobs when the machine is idle.' | Out-Null

Write-Host ""
Write-Host "✔ Task '$TaskName' installed." -ForegroundColor Green
Write-Host "Check status:    Get-ScheduledTask -TaskName $TaskName"
Write-Host "Manual start:    Start-ScheduledTask -TaskName $TaskName"
Write-Host "Manual stop:     Stop-ScheduledTask -TaskName $TaskName"
Write-Host "Remove:          .\uninstall-worker.ps1 -TaskName $TaskName"
Write-Host ""
Write-Host "Worker log:      %LOCALAPPDATA%\PulseGaming\worker.log"
