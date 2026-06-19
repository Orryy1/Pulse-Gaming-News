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

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($existing -and -not $Restart) {
  $existingHealth = Get-RuntimeHealth -RuntimePort $Port
  $existingCommitSha = Get-RuntimeCommitSha -Health $existingHealth
  $existingBranchName = Get-RuntimeBranchName -Health $existingHealth
  $commitMismatch = $commitSha -and $existingCommitSha -and ($existingCommitSha -ne $commitSha)
  $branchMismatch = $branchName -and $existingBranchName -and ($existingBranchName -ne $branchName)

  if ($commitMismatch -or $branchMismatch) {
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
