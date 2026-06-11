param(
  [string]$RepoRoot = "",
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  exit 0
}

Set-Location -LiteralPath $RepoRoot

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

& node server.js
