param(
  [string]$RepoRoot = "",
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-content-workers.log"
$workerScript = Join-Path $RepoRoot "tools/local-sqlite-content-worker.js"
$nodeExe = (Get-Command "node.exe" -ErrorAction Stop).Source

function Write-ContentWorkerLog {
  param([string]$Message)
  try {
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message)
  } catch {
    # Worker supervision must never fail because the log file is busy.
  }
}

function Get-ContentWorkerProcesses {
  param([string]$WorkerId)
  return Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -like "*local-sqlite-content-worker.js*" -and
      $_.CommandLine -like "*--worker-id*" -and
      $_.CommandLine -like "*$WorkerId*"
    }
}

function Stop-ContentWorkerProcesses {
  param([string]$WorkerId)
  $processes = @(Get-ContentWorkerProcesses -WorkerId $WorkerId)
  foreach ($process in $processes) {
    if (-not $process.CommandLine -or $process.CommandLine -notlike "*local-sqlite-content-worker.js*" -or $process.CommandLine -notlike "*$WorkerId*") {
      throw "Refusing to stop PID $($process.ProcessId) because it is not the expected content worker: $($process.CommandLine)"
    }
    Write-ContentWorkerLog ("stopping_worker id={0} pid={1}" -f $WorkerId, $process.ProcessId)
    Stop-Process -Id $process.ProcessId -Force
  }
}

$lanes = @(
  @{
    Id = "local-content-runway"
    Kinds = "candidate_supply_monitor,fresh_production_refill"
  },
  @{
    Id = "local-content-repair"
    Kinds = "fresh_review_script_repair,safe_auto_repair_runner,local_tts_doctor,local_tts_retry_recovery"
  },
  @{
    Id = "local-content-ops"
    Kinds = "hunt,produce,analytics,scoring_digest,engage,engage_first_hour,blog_rebuild,db_backup,instagram_pending_verify,overnight_produce_sweep,overnight_analytics_backfill,overnight_claude_analyst,overnight_morning_digest"
  },
  @{
    Id = "local-content-learning"
    Kinds = "live_performance_analyst,studio_analytics_loop,commercial_learning_loop,competitor_forensics_lab,competitor_quality_gate,autonomous_feedback_monitor,continuous_learning_loop"
  }
)

$env:USE_SQLITE = "true"
$env:SQLITE_DB_PATH = "D:/pulse-data/pulse.db"
$env:PULSE_PRIMARY_INSTANCE = "true"
$env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"
$env:PULSE_MAINTENANCE_RUNNER = "false"

foreach ($lane in $lanes) {
  $workerId = [string]$lane.Id
  $kinds = [string]$lane.Kinds

  if ($Restart) {
    Stop-ContentWorkerProcesses -WorkerId $workerId
    Start-Sleep -Milliseconds 250
  }

  $existing = @(Get-ContentWorkerProcesses -WorkerId $workerId)
  if ($existing.Count -gt 0) {
    Write-ContentWorkerLog ("worker_noop_current id={0} pid={1}" -f $workerId, (($existing | Select-Object -ExpandProperty ProcessId) -join ","))
    continue
  }

  Write-ContentWorkerLog ("starting_worker id={0} kinds={1}" -f $workerId, $kinds)
  $stdoutPath = Join-Path $logDir ("{0}.stdout.log" -f $workerId)
  $stderrPath = Join-Path $logDir ("{0}.stderr.log" -f $workerId)
  $created = Start-Process -FilePath $nodeExe `
    -ArgumentList @($workerScript, "--worker-id", $workerId, "--kinds", $kinds) `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Start-Sleep -Seconds 2
  $created.Refresh()
  if ($created.HasExited) {
    $failure = "worker_launch_failed id={0} exit_code={1} stdout={2} stderr={3}" -f $workerId, $created.ExitCode, $stdoutPath, $stderrPath
    Write-ContentWorkerLog $failure
    throw $failure
  }
  Write-ContentWorkerLog ("worker_started id={0} pid={1}" -f $workerId, $created.Id)
}
