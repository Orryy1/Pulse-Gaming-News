param(
  [string]$RepoRoot = "",
  [int]$Port = 3001,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-primary-runtime.log"

function Write-RuntimeLog {
  param([string]$Message)
  try {
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message)
  } catch {
    # The active node process may hold the combined runtime log open during a restart.
    # Logging must never block replacing a stale server process.
  }
}

Set-Location -LiteralPath $RepoRoot

$commitSha = ""
$branchName = ""
try {
  $commitSha = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
  $branchName = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
} catch {
  $commitSha = ""
  $branchName = ""
}

function Get-RuntimeHealth {
  param([int]$RuntimePort)
  try {
    return Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/health" -f $RuntimePort) -TimeoutSec 3 -UseBasicParsing
  } catch {
    Write-RuntimeLog ("existing_listener_health_unavailable port={0} error={1}" -f $RuntimePort, $_.Exception.Message)
    return $null
  }
}

function Get-RuntimeCommitSha {
  param($Health)
  if (-not $Health) { return "" }
  if ($Health.build -and $Health.build.commit_sha) { return [string]$Health.build.commit_sha }
  if ($Health.commit_sha) { return [string]$Health.commit_sha }
  return ""
}

function Get-RuntimeBranchName {
  param($Health)
  if (-not $Health) { return "" }
  if ($Health.build -and $Health.build.branch) { return [string]$Health.build.branch }
  if ($Health.branch) { return [string]$Health.branch }
  return ""
}

function Test-ExpectedPrimaryRuntimeMode {
  param($Health)
  if (-not $Health -or -not $Health.runtime) { return $false }
  $schedulerActive = [bool]$Health.schedulerActive
  $autoPublish = [bool]$Health.runtime.auto_publish
  $jobQueueEnabled = ([string]$Health.runtime.use_job_queue_explicit).ToLowerInvariant() -eq "true"
  $queueDispatch = [string]$Health.runtime.dispatch.mode -eq "queue"
  $safeObservationMode = [bool]$Health.runtime.safe_observation_mode
  $primaryRuntimeHold = [bool]$Health.runtime.primary_runtime_hold
  return (
    $schedulerActive -and
    $autoPublish -and
    $jobQueueEnabled -and
    $queueDispatch -and
    -not $safeObservationMode -and
    -not $primaryRuntimeHold
  )
}

function Get-ActivePublishJobs {
  $guardDbPath = $env:SQLITE_DB_PATH
  if (-not $guardDbPath) { $guardDbPath = "D:/pulse-data/pulse.db" }
  if (-not (Test-Path -LiteralPath $guardDbPath)) { return @() }

  $previousGuardDbPath = $env:PULSE_RUNTIME_RESTART_GUARD_DB_PATH
  $env:PULSE_RUNTIME_RESTART_GUARD_DB_PATH = $guardDbPath
  try {
    $nodeScript = @'
const Database = require("better-sqlite3");
const dbPath = process.env.PULSE_RUNTIME_RESTART_GUARD_DB_PATH || process.env.SQLITE_DB_PATH || "D:/pulse-data/pulse.db";
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT id, kind, claimed_by, lease_until, updated_at
  FROM jobs
  WHERE kind IN ('publish','publish_window_watchdog')
    AND status = 'running'
    AND lease_until IS NOT NULL
    AND datetime(lease_until) > datetime('now')
  ORDER BY id DESC
  LIMIT 10
`).all();
console.log(JSON.stringify(rows));
'@
    $raw = $nodeScript | node - 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return @() }
    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed) { return @() }
    foreach ($job in @($parsed)) {
      if ($job -and $job.PSObject.Properties["id"]) {
        Write-Output $job
      }
    }
  } catch {
    Write-RuntimeLog ("active_publish_restart_guard_unavailable db={0} error={1}" -f $guardDbPath, $_.Exception.Message)
    return @()
  } finally {
    if ($previousGuardDbPath) {
      $env:PULSE_RUNTIME_RESTART_GUARD_DB_PATH = $previousGuardDbPath
    } else {
      Remove-Item Env:\PULSE_RUNTIME_RESTART_GUARD_DB_PATH -ErrorAction SilentlyContinue
    }
  }
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($existing -and -not $Restart) {
  $existingHealth = Get-RuntimeHealth -RuntimePort $Port
  $existingCommitSha = Get-RuntimeCommitSha -Health $existingHealth
  $existingBranchName = Get-RuntimeBranchName -Health $existingHealth
  $commitMismatch = $commitSha -and $existingCommitSha -and ($existingCommitSha -ne $commitSha)
  $branchMismatch = $branchName -and $existingBranchName -and ($existingBranchName -ne $branchName)
  $runtimeModeMismatch = $existingHealth -and -not (Test-ExpectedPrimaryRuntimeMode -Health $existingHealth)

  if ($runtimeModeMismatch) {
    Write-RuntimeLog ("existing_listener_mode_mismatch_restart port={0} pid={1} schedulerActive={2} auto_publish={3} use_job_queue_explicit={4} dispatch.mode={5} safe_observation_mode={6} primary_runtime_hold={7}" -f $Port, ($existing -join ","), $existingHealth.schedulerActive, $existingHealth.runtime.auto_publish, $existingHealth.runtime.use_job_queue_explicit, $existingHealth.runtime.dispatch.mode, $existingHealth.runtime.safe_observation_mode, $existingHealth.runtime.primary_runtime_hold)
    $Restart = $true
  } elseif ($commitMismatch -or $branchMismatch) {
    Write-RuntimeLog ("existing_listener_stale_restart port={0} pid={1} commit_sha={2} expected_commit_sha={3} branch={4} expected_branch={5}" -f $Port, ($existing -join ","), $existingCommitSha, $commitSha, $existingBranchName, $branchName)
    $Restart = $true
  } elseif (-not $existingCommitSha -and -not $existingBranchName) {
    Write-RuntimeLog ("existing_listener_noop_unverified port={0} pid={1}" -f $Port, ($existing -join ","))
    exit 0
  } else {
    Write-RuntimeLog ("existing_listener_noop_current port={0} pid={1} commit_sha={2} branch={3}" -f $Port, ($existing -join ","), $existingCommitSha, $existingBranchName)
    exit 0
  }
}

if ($existing -and $Restart) {
  $activePublishJobs = @(Get-ActivePublishJobs)
  $allowRestartDuringPublish = [string]$env:PULSE_ALLOW_RUNTIME_RESTART_DURING_PUBLISH -eq "true"
  if ($activePublishJobs.Count -gt 0 -and -not $allowRestartDuringPublish) {
    Write-RuntimeLog ("restart_deferred_active_publish_jobs port={0} pid={1} jobs={2}" -f $Port, ($existing -join ","), (($activePublishJobs | ConvertTo-Json -Compress) -replace "`r?`n", ""))
    exit 0
  }

  foreach ($pidToStop in $existing) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop"
    if (-not $process.CommandLine -or $process.CommandLine -notmatch "server\.js") {
      throw "Refusing to stop PID $pidToStop on port $Port because it is not node server.js: $($process.CommandLine)"
    }
    Write-RuntimeLog ("stopping_existing_runtime port={0} pid={1}" -f $Port, $pidToStop)
    Stop-Process -Id $pidToStop -Force
  }
  Start-Sleep -Seconds 2
}

$env:PORT = "$Port"
$env:DEPLOYMENT_MODE = "local"
$env:PULSE_PRIMARY_INSTANCE = "true"
$env:AUTO_PUBLISH = "true"
$env:USE_SQLITE = "true"
$env:SQLITE_DB_PATH = "D:/pulse-data/pulse.db"
$env:USE_JOB_QUEUE = "true"
$env:USE_SCORING_ENGINE = "true"
$env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true"
$env:PULSE_EMERGENCY_KILL_SWITCH = "clear"
$env:PULSE_SAFE_OBSERVATION_MODE = "false"
$env:PULSE_PRIMARY_RUNTIME_HOLD = "false"
$env:PULSE_GUARDED_EXECUTOR_PLAN_PATH = "output/goal-contract/guarded_dispatch_executor_plan.json"
$env:PULSE_RESET_SCHEDULES_ON_BOOT = "true"
if ($commitSha) { $env:RAILWAY_GIT_COMMIT_SHA = $commitSha }
if ($branchName) { $env:RAILWAY_GIT_BRANCH = $branchName }

Write-RuntimeLog ("node_start repo={0} port={1}" -f $RepoRoot, $Port)
& node server.js *>> $logPath
$exitCode = $LASTEXITCODE
Write-RuntimeLog ("node_exit code={0}" -f $exitCode)
