param(
  [string]$RepoRoot = "",
  [switch]$Apply,
  [switch]$OperatorConfirmed
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
if ($Apply -and -not $OperatorConfirmed) {
  throw "Refusing to install content worker tasks without -OperatorConfirmed."
}

$pythonwExe = (Get-Command "pythonw.exe" -ErrorAction Stop).Source
$nodeExe = (Get-Command "node.exe" -ErrorAction Stop).Source
$workerScript = Join-Path $RepoRoot "tools/local-sqlite-content-worker.js"
$hostScript = Join-Path $RepoRoot "tools/local_content_worker_host.py"
$lanes = @(
  @{ Task = "PulseGaming-Content-Runway"; Id = "local-content-runway"; Kinds = "candidate_supply_monitor,fresh_production_refill" },
  @{ Task = "PulseGaming-Content-Repair"; Id = "local-content-repair"; Kinds = "fresh_review_script_repair,safe_auto_repair_runner,local_tts_doctor,local_tts_retry_recovery" },
  @{ Task = "PulseGaming-Content-Ops"; Id = "local-content-ops"; Kinds = "hunt,produce,analytics,scoring_digest,engage,engage_first_hour,blog_rebuild,db_backup,instagram_pending_verify,overnight_produce_sweep,overnight_analytics_backfill,overnight_claude_analyst,overnight_morning_digest" },
  @{ Task = "PulseGaming-Content-Learning"; Id = "local-content-learning"; Kinds = "live_performance_analyst,studio_analytics_loop,commercial_learning_loop,competitor_forensics_lab,competitor_quality_gate,autonomous_feedback_monitor,continuous_learning_loop" }
)

$plan = @()
foreach ($lane in $lanes) {
  $plan += [ordered]@{ task = $lane.Task; worker_id = $lane.Id; applied = $false; started = $false }
}
if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 4
  exit 0
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
for ($index = 0; $index -lt $lanes.Count; $index++) {
  $lane = $lanes[$index]
  $arguments = '"{0}" --repo-root "{1}" --node-exe "{2}" --worker-id "{3}" --kinds "{4}"' -f $hostScript, $RepoRoot, $nodeExe, $lane.Id, $lane.Kinds
  $action = New-ScheduledTaskAction -Execute $pythonwExe -Argument $arguments -WorkingDirectory $RepoRoot
  Register-ScheduledTask -TaskName $lane.Task -Action $action -Trigger $trigger -Settings $settings -Description "Pulse Gaming non-publish content worker" -Force | Out-Null
  Start-ScheduledTask -TaskName $lane.Task
  $plan[$index].applied = $true
  $plan[$index].started = $true
}
$plan | ConvertTo-Json -Depth 4
