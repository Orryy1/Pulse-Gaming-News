param(
  [string]$RepoRoot = "",
  [switch]$Apply,
  [switch]$OperatorConfirmed
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$hostScript = Join-Path $RepoRoot "tools/local_live_watchdog_host.py"
$watchdogScript = Join-Path $RepoRoot "tools/local-live-watchdog.ps1"
$pythonwExe = (Get-Command "pythonw.exe" -ErrorAction Stop).Source
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "PulseGaming-LiveWatchdog.lnk"
$scheduledTaskName = "PulseGaming-LiveWatchdog-Supervisor"
$arguments = "`"$hostScript`" --repo-root `"$RepoRoot`" --port 3001"
$backupDir = Join-Path $RepoRoot "output/runtime/startup-backups"

if (-not (Test-Path -LiteralPath $hostScript)) {
  throw "Windowless watchdog host missing: $hostScript"
}
if (-not (Test-Path -LiteralPath $watchdogScript)) {
  throw "Approved live watchdog missing: $watchdogScript"
}
if ($Apply -and -not $OperatorConfirmed) {
  throw "Refusing to install the live watchdog startup shortcut without -OperatorConfirmed."
}

$plan = [ordered]@{
  startup_shortcut = $shortcutPath
  scheduled_task = $scheduledTaskName
  executable = $pythonwExe
  arguments = $arguments
  apply_requested = [bool]$Apply
  operator_confirmed = [bool]$OperatorConfirmed
  applied = $false
  host_already_running = $false
  host_started = $false
  host_pid = $null
  backup_path = $null
  scheduled_task_registered = $false
  scheduled_task_started = $false
}

if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 4
  exit 0
}

if (Test-Path -LiteralPath $shortcutPath) {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $backupPath = Join-Path $backupDir "PulseGaming-LiveWatchdog-$stamp.lnk"
  Copy-Item -LiteralPath $shortcutPath -Destination $backupPath -Force
  $plan.backup_path = $backupPath
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonwExe
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Pulse Gaming guarded runtime watchdog"
$shortcut.Save()

$taskArguments = (
  '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -Port 3001' -f
    $watchdogScript,
    $RepoRoot
)
$taskAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument $taskArguments `
  -WorkingDirectory $RepoRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$independentStartTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$taskSettings = New-ScheduledTaskSettingsSet `
  -RestartCount 99 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
Stop-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $scheduledTaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $scheduledTaskName `
  -Action $taskAction `
  -Trigger @($logonTrigger, $independentStartTrigger) `
  -Settings $taskSettings `
  -Description "Pulse Gaming guarded runtime watchdog supervisor" `
  -Force | Out-Null
$plan.scheduled_task_registered = $true
Start-ScheduledTask -TaskName $scheduledTaskName
$plan.scheduled_task_started = $true

$existingHost = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "pythonw.exe" -and $_.CommandLine -match "local_live_watchdog_host\.py"
} | Select-Object -First 1
if ($existingHost) {
  $plan.host_already_running = $true
  $plan.host_pid = [int]$existingHost.ProcessId
} else {
  $commandLine = "`"$pythonwExe`" $arguments"
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $RepoRoot
  }
  if ([int]$created.ReturnValue -ne 0) {
    throw "Watchdog host launch failed with Win32 return value $($created.ReturnValue)."
  }
  $plan.host_started = $true
  $plan.host_pid = [int]$created.ProcessId
}

$plan.applied = $true
$plan | ConvertTo-Json -Depth 4
