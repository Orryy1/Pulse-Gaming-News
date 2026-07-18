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

$taskWrapper = Join-Path $RepoRoot "tools/local-content-worker-task.ps1"
$lanes = @(
  @{ Task = "PulseGaming-Content-Publish-Prep"; Id = "local-publish-prep"; Kinds = "publish_runway_generate" },
  @{ Task = "PulseGaming-Content-Runway"; Id = "local-content-runway"; Kinds = "candidate_supply_monitor" },
  @{ Task = "PulseGaming-Content-Refill"; Id = "local-content-refill"; Kinds = "fresh_production_refill" },
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

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Starting a task directly from an automation host can leave the worker in that
# host's process job. This near-future trigger makes Task Scheduler the owner.
$independentStartTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
for ($index = 0; $index -lt $lanes.Count; $index++) {
  Unregister-ScheduledTask -TaskName $lanes[$index].Task -Confirm:$false -ErrorAction SilentlyContinue
}
$taskName = "PulseGaming-Content-Host"
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
for ($index = 0; $index -lt $lanes.Count; $index++) {
  $lane = $lanes[$index]
  $arguments = ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -WorkerId "{2}" -Kinds "{3}"' -f $taskWrapper, $RepoRoot, $lane.Id, $lane.Kinds)
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $RepoRoot
  Register-ScheduledTask -TaskName $lane.Task -Action $action -Trigger @($logonTrigger, $independentStartTrigger) -Settings $settings -Description ("Pulse Gaming non-publish worker: {0}" -f $lane.Id) -Force | Out-Null
  Start-ScheduledTask -TaskName $lane.Task
  $plan[$index].applied = $true
  $plan[$index].started = $true
}
$plan | ConvertTo-Json -Depth 4
