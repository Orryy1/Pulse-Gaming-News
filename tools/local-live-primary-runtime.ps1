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

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($existing -and -not $Restart) {
  Write-RuntimeLog ("existing_listener_noop port={0} pid={1}" -f $Port, ($existing -join ","))
  exit 0
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
$env:PULSE_RESET_SCHEDULES_ON_BOOT = "true"

Write-RuntimeLog ("node_start repo={0} port={1}" -f $RepoRoot, $Port)
& node server.js *>> $logPath
$exitCode = $LASTEXITCODE
Write-RuntimeLog ("node_exit code={0}" -f $exitCode)
