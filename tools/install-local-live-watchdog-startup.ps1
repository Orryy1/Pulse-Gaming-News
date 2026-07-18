param(
  [string]$RepoRoot = "",
  [string]$RuntimeRepoRoot = "",
  [ValidateSet("Plan", "Install")]
  [string]$Mode = "Plan",
  [int]$Port = 3001,
  [string]$TaskName = "PulseGaming-LiveWatchdog-Supervisor",
  [string]$ProbeFixturePath = "",
  [string]$OutputDirectory = "",
  [switch]$OperatorConfirmed,
  [switch]$MigrateLegacyStartupOwners
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if (-not $RuntimeRepoRoot) {
  $RuntimeRepoRoot = $RepoRoot
} else {
  $RuntimeRepoRoot = (Resolve-Path -LiteralPath $RuntimeRepoRoot).Path
}

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $RepoRoot "output/runtime"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$doctorScript = Join-Path $RepoRoot "tools/machine-boot-supervision-doctor.ps1"
$watchdogScript = Join-Path $RepoRoot "tools/local-live-watchdog.ps1"
$runtimeEntrypoint = Join-Path $RuntimeRepoRoot "tools/local-live-primary-runtime.ps1"
$statusPath = Join-Path $OutputDirectory "machine_boot_supervision_status.json"
$missedWindowEvidencePath = Join-Path $OutputDirectory "machine_boot_missed_window_evidence.json"
$planPath = Join-Path $OutputDirectory "machine_boot_supervision_install_plan.json"
$backupDirectory = Join-Path $OutputDirectory "machine_boot_supervision_backups"
$powershellExe = Join-Path $env:SystemRoot "System32/WindowsPowerShell/v1.0/powershell.exe"

function Write-JsonAtomic {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $jsonText = ($Value | ConvertTo-Json -Depth 12)
  $temporaryPath = "{0}.tmp.{1}" -f $Path, $PID
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temporaryPath, $jsonText + [Environment]::NewLine, $utf8WithoutBom)
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-IsApprovedStartupShortcutPath {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $candidate = [System.IO.Path]::GetFullPath($Path)
  $startupDirectories = @(
    [Environment]::GetFolderPath("Startup"),
    [Environment]::GetFolderPath("CommonStartup")
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($directory in $startupDirectories) {
    $root = [System.IO.Path]::GetFullPath($directory).TrimEnd("\") + "\"
    if ($candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

foreach ($requiredPath in @($doctorScript, $watchdogScript, $runtimeEntrypoint, $powershellExe)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "machine_boot_supervision_required_file_missing:$requiredPath"
  }
}

if ($Mode -eq "Install" -and -not $OperatorConfirmed) {
  throw "install_requires_operator_confirmation"
}
if ($Mode -eq "Install" -and $ProbeFixturePath) {
  throw "install_refuses_probe_fixture"
}

$doctorArguments = @(
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $doctorScript,
  "-RepoRoot",
  $RepoRoot,
  "-RuntimeRepoRoot",
  $RuntimeRepoRoot,
  "-TaskName",
  $TaskName,
  "-Port",
  "$Port",
  "-StatusPath",
  $statusPath,
  "-MissedWindowEvidencePath",
  $missedWindowEvidencePath,
  "-Json"
)
if ($ProbeFixturePath) {
  $doctorArguments += @("-ProbeFixturePath", $ProbeFixturePath)
}
$doctorOutput = & $powershellExe @doctorArguments
if ($LASTEXITCODE -ne 0) {
  throw "machine_boot_supervision_doctor_failed"
}
$status = (($doctorOutput -join [Environment]::NewLine) | ConvertFrom-Json)

$taskArguments = (
  '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -Port {2} -RuntimeRepoRoot "{3}"' -f
    $watchdogScript,
    $RepoRoot,
    $Port,
    $RuntimeRepoRoot
)

$blockers = @()
if (-not [bool]$status.approved_runtime_entrypoint_verified) {
  $blockers += "approved_runtime_entrypoint_not_verified"
}
if (@($status.probe_errors).Count -gt 0) {
  $blockers += "machine_probe_incomplete"
}
if ([int]$status.competing_task_owner_count -gt 0) {
  $blockers += "competing_scheduled_task_owners"
}
if ([int]$status.competing_startup_shortcut_count -gt 0 -and -not $MigrateLegacyStartupOwners) {
  $blockers += "competing_startup_owners_require_explicit_migration"
}

$installCommand = (
  'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -RuntimeRepoRoot "{2}" -Mode Install -OperatorConfirmed{3}' -f
    $PSCommandPath,
    $RepoRoot,
    $RuntimeRepoRoot,
    $(if ([int]$status.competing_startup_shortcut_count -gt 0) { " -MigrateLegacyStartupOwners" } else { "" })
)

$plan = [ordered]@{
  schema_version = 1
  generated_at_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  mode = $Mode.ToLowerInvariant()
  os_mutation_performed = $false
  installed = $false
  task_started_immediately = $false
  supervisor_repo_root = $RepoRoot
  runtime_repo_root = $RuntimeRepoRoot
  task = [ordered]@{
    name = $TaskName
    trigger = "AtStartup"
    run_as = "SYSTEM"
    logon_type = "ServiceAccount"
    run_level = "Highest"
    executable = $powershellExe
    arguments = $taskArguments
    working_directory = $RepoRoot
    multiple_instances = "IgnoreNew"
    start_when_available = $true
    restart_count = 999
    restart_interval_minutes = 1
  }
  approved_supervision_entrypoint = $watchdogScript
  approved_runtime_entrypoint = $runtimeEntrypoint
  current_state = [ordered]@{
    verdict = [string]$status.verdict
    one_owner = [bool]$status.one_owner
    existing_task_at_startup = [bool]$status.task.at_startup
    competing_startup_shortcut_count = [int]$status.competing_startup_shortcut_count
    competing_task_owner_count = [int]$status.competing_task_owner_count
    missed_window_count_since_boot = [int]$status.missed_window_count_since_boot
  }
  install_allowed = ($blockers.Count -eq 0)
  blockers = @($blockers)
  migrate_legacy_startup_owners_requested = [bool]$MigrateLegacyStartupOwners
  operator_confirmed = [bool]$OperatorConfirmed
  install_command = $installCommand
  status_path = $statusPath
  missed_window_evidence_path = $missedWindowEvidencePath
  backup_directory = $backupDirectory
  migrated_startup_shortcuts = @()
  safety = [ordered]@{
    plan_is_default = $true
    no_immediate_task_start = $true
    currently_running_runtime_touched = $false
    token_values_collected = $false
    production_db_mutated = $false
    external_publish_attempted = $false
  }
}

Write-JsonAtomic -Value $plan -Path $planPath

if ($Mode -eq "Plan") {
  $plan | ConvertTo-Json -Depth 12
  exit 0
}

if (-not (Test-IsAdministrator)) {
  throw "install_requires_elevated_powershell"
}
if ($blockers.Count -gt 0) {
  throw ("install_blocked:{0}" -f ($blockers -join ","))
}

if ($MigrateLegacyStartupOwners) {
  New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
  $migrationRecords = @()
  foreach ($shortcut in @($status.competing_startup_shortcuts)) {
    $shortcutPath = [string]$shortcut.path
    if (-not (Test-IsApprovedStartupShortcutPath -Path $shortcutPath)) {
      throw "legacy_startup_owner_path_not_approved"
    }
    $shortcutIdentity = "{0} {1} {2}" -f $shortcutPath, $shortcut.target, $shortcut.arguments
    if ($shortcutIdentity -notmatch "(?i)(pulse.*(?:gaming|watchdog)|local[_-]live[_-]watchdog)") {
      throw "legacy_startup_owner_identity_not_approved"
    }
    $backupName = "{0}-{1}{2}" -f
      [System.IO.Path]::GetFileNameWithoutExtension($shortcutPath),
      (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff"),
      [System.IO.Path]::GetExtension($shortcutPath)
    $backupPath = Join-Path $backupDirectory $backupName
    Copy-Item -LiteralPath $shortcutPath -Destination $backupPath -Force
    Remove-Item -LiteralPath $shortcutPath -Force
    $migrationRecords += [ordered]@{
      path = $shortcutPath
      backup_path = $backupPath
      removed = $true
    }
  }
  $plan.migrated_startup_shortcuts = @($migrationRecords)
}

$taskAction = New-ScheduledTaskAction `
  -Execute $powershellExe `
  -Argument $taskArguments `
  -WorkingDirectory $RepoRoot
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId "SYSTEM" `
  -LogonType ServiceAccount `
  -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$scheduledTask = New-ScheduledTask `
  -Action $taskAction `
  -Trigger $startupTrigger `
  -Principal $taskPrincipal `
  -Settings $taskSettings `
  -Description "Pulse Gaming machine-boot runtime watchdog; invokes only the approved guarded runtime entrypoint."
Register-ScheduledTask `
  -TaskName $TaskName `
  -InputObject $scheduledTask `
  -Force | Out-Null

$plan.os_mutation_performed = $true
$plan.installed = $true
$plan.task_started_immediately = $false
$plan.safety.currently_running_runtime_touched = $false
Write-JsonAtomic -Value $plan -Path $planPath
$plan | ConvertTo-Json -Depth 12
