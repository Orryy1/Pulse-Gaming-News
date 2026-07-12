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
$hostScript = Join-Path $RepoRoot "tools/local_content_workers_host.py"
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
  Unregister-ScheduledTask -TaskName $lanes[$index].Task -Confirm:$false -ErrorAction SilentlyContinue
}
$taskName = "PulseGaming-Content-Host"
$action = New-ScheduledTaskAction -Execute $pythonwExe -Argument ('"{0}"' -f $hostScript) -WorkingDirectory $RepoRoot
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Pulse Gaming non-publish content workers" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
foreach ($item in $plan) { $item.applied = $true; $item.started = $true }
$plan | ConvertTo-Json -Depth 4
