param(
  [string]$RepoRoot = "",
  [string]$RuntimeRepoRoot = "",
  [switch]$Restart,
  [ValidateSet(
    "local-publish-prep",
    "local-content-runway",
    "local-content-refill",
    "local-content-repair",
    "local-content-produce",
    "local-content-ops",
    "local-content-learning"
  )]
  [string]$OnlyWorkerId = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if (-not $RuntimeRepoRoot) {
  $RuntimeRepoRoot = $RepoRoot
  if ((Split-Path -Leaf $RepoRoot) -eq "pulse-gaming") {
    $protectedSibling = Join-Path (Split-Path -Parent $RepoRoot) "pulse-gaming-live"
    if (Test-Path -LiteralPath $protectedSibling -PathType Container) {
      $RuntimeRepoRoot = $protectedSibling
    }
  }
}
$RuntimeRepoRoot = (Resolve-Path -LiteralPath $RuntimeRepoRoot).Path

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-content-workers.log"
$workerScript = Join-Path $RepoRoot "tools/local-sqlite-content-worker.js"
$taskWrapper = Join-Path $RepoRoot "tools/local-content-worker-task.ps1"
$powershellExe = (Get-Command "powershell.exe" -ErrorAction Stop).Source

function Get-ManagedContentWorkerScriptPaths {
  param([string]$CurrentRepoRoot)

  $roots = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  [void]$roots.Add([System.IO.Path]::GetFullPath($CurrentRepoRoot))

  $repoName = Split-Path -Leaf $CurrentRepoRoot
  if ($repoName -in @("pulse-gaming", "pulse-gaming-live")) {
    $repoParent = Split-Path -Parent $CurrentRepoRoot
    foreach ($approvedSiblingName in @("pulse-gaming", "pulse-gaming-live")) {
      $approvedSiblingRoot = Join-Path $repoParent $approvedSiblingName
      if (Test-Path -LiteralPath $approvedSiblingRoot -PathType Container) {
        [void]$roots.Add([System.IO.Path]::GetFullPath($approvedSiblingRoot))
      }
    }
  }

  return @(
    $roots |
      ForEach-Object {
        [System.IO.Path]::GetFullPath(
          (Join-Path $_ "tools/local-sqlite-content-worker.js")
        )
      }
  )
}

$managedWorkerScriptPaths = @(Get-ManagedContentWorkerScriptPaths -CurrentRepoRoot $RepoRoot)

function Write-ContentWorkerLog {
  param([string]$Message)
  try {
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message)
  } catch {
    # Worker supervision must never fail because the log file is busy.
  }
}

function Get-ContentWorkerCommandLineArgument {
  param(
    [string]$CommandLine,
    [string]$Name
  )
  if (-not $CommandLine -or -not $Name) {
    return $null
  }

  $argumentPattern = '(?:^|\s)--{0}(?:=|\s+)(?:"([^"]*)"|([^\s]+))(?=\s|$)' -f [regex]::Escape($Name)
  $matches = [regex]::Matches($CommandLine, $argumentPattern)
  if ($matches.Count -eq 0) {
    return $null
  }

  $match = $matches[$matches.Count - 1]
  if ($match.Groups[1].Success) {
    return $match.Groups[1].Value
  }
  return $match.Groups[2].Value
}

function ConvertTo-NormalizedContentWorkerKinds {
  param([string]$Kinds)
  return @(
    ([string]$Kinds -split ",") |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ } |
      Sort-Object -CaseSensitive -Unique
  ) -join ","
}

function Test-ContentWorkerProcessScript {
  param(
    [object]$Process,
    [string]$ScriptPath
  )
  $commandLine = [string]$Process.CommandLine
  if (-not $commandLine -or -not $ScriptPath) {
    return $false
  }

  $nodeExecutablePattern = '(?:"(?:[^"]*[\\/])?node(?:\.exe)?"|(?:[^\s"]*[\\/])?node(?:\.exe)?)'
  $workerCommandPattern = '(?i)^\s*{0}\s+"?{1}"?(?=\s|$)' -f $nodeExecutablePattern, [regex]::Escape([System.IO.Path]::GetFullPath($ScriptPath))
  return [regex]::IsMatch($commandLine, $workerCommandPattern)
}

function Test-ContentWorkerProcessOwnership {
  param(
    [object]$Process,
    [string]$WorkerId
  )
  $commandLine = [string]$Process.CommandLine
  if (-not $commandLine) {
    return $false
  }

  $managedScriptMatched = $false
  foreach ($managedWorkerScriptPath in $managedWorkerScriptPaths) {
    if (Test-ContentWorkerProcessScript -Process $Process -ScriptPath $managedWorkerScriptPath) {
      $managedScriptMatched = $true
      break
    }
  }
  if (-not $managedScriptMatched) {
    return $false
  }

  $actualWorkerId = Get-ContentWorkerCommandLineArgument -CommandLine $commandLine -Name "worker-id"
  return [string]::Equals(
    $actualWorkerId,
    $WorkerId,
    [System.StringComparison]::Ordinal
  )
}

function Get-ContentWorkerProcesses {
  param([string]$WorkerId)
  return Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object {
      Test-ContentWorkerProcessOwnership -Process $_ -WorkerId $WorkerId
    }
}

function Stop-ContentWorkerProcess {
  param(
    [string]$WorkerId,
    [object]$process
  )
  if (-not (Test-ContentWorkerProcessOwnership -Process $process -WorkerId $WorkerId)) {
    throw "Refusing to stop PID $($process.ProcessId) because it is not the expected content worker: $($process.CommandLine)"
  }
  Write-ContentWorkerLog ("stopping_worker id={0} pid={1}" -f $WorkerId, $process.ProcessId)
  Stop-Process -Id $process.ProcessId -Force
}

function Stop-ContentWorkerProcesses {
  param([string]$WorkerId)
  $processes = @(Get-ContentWorkerProcesses -WorkerId $WorkerId)
  foreach ($process in $processes) {
    Stop-ContentWorkerProcess -WorkerId $WorkerId -Process $process
  }
}

$lanes = @(
  @{
    Id = "local-publish-prep"
    Kinds = "publish_runway_generate"
  },
  @{
    Id = "local-content-runway"
    Kinds = "candidate_supply_monitor"
  },
  @{
    Id = "local-content-refill"
    Kinds = "fresh_production_refill"
  },
  @{
    Id = "local-content-repair"
    Kinds = "fresh_review_script_repair,safe_auto_repair_runner,local_tts_doctor,local_tts_retry_recovery"
  },
  @{
    Id = "local-content-produce"
    Kinds = "produce"
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

if ($OnlyWorkerId) {
  $lanes = @(
    $lanes |
      Where-Object {
        [string]::Equals(
          [string]$_.Id,
          $OnlyWorkerId,
          [System.StringComparison]::Ordinal
        )
      }
  )
  Write-ContentWorkerLog ("worker_lane_filter id={0}" -f $OnlyWorkerId)
}

$env:USE_SQLITE = "true"
$env:SQLITE_DB_PATH = "D:/pulse-data/pulse.db"
$env:PULSE_PRIMARY_INSTANCE = "true"
$env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"
$env:PULSE_MAINTENANCE_RUNNER = "false"

$supervisorMutex = [System.Threading.Mutex]::new(
  $false,
  "Local\PulseGamingLiveContentWorkers"
)
$supervisorLockAcquired = $false
try {
  try {
    $supervisorLockAcquired = $supervisorMutex.WaitOne([TimeSpan]::FromSeconds(60))
  } catch [System.Threading.AbandonedMutexException] {
    $supervisorLockAcquired = $true
    Write-ContentWorkerLog "supervisor_mutex_abandoned_recovered"
  }
  if (-not $supervisorLockAcquired) {
    throw "Timed out waiting for PulseGamingLiveContentWorkers supervisor mutex."
  }

  foreach ($lane in $lanes) {
    $workerId = [string]$lane.Id
    $kinds = [string]$lane.Kinds
    $expectedKinds = ConvertTo-NormalizedContentWorkerKinds -Kinds $kinds

    if ($Restart) {
      Stop-ContentWorkerProcesses -WorkerId $workerId
      Start-Sleep -Milliseconds 250
    }

    $existing = @(Get-ContentWorkerProcesses -WorkerId $workerId)
    $current = @()
    $staleStopped = $false
    foreach ($process in $existing) {
      $actualKindsArgument = Get-ContentWorkerCommandLineArgument -CommandLine $process.CommandLine -Name "kinds"
      $actualKinds = ConvertTo-NormalizedContentWorkerKinds -Kinds $actualKindsArgument
      if ([string]::Equals($actualKinds, $expectedKinds, [System.StringComparison]::Ordinal)) {
        $current += $process
        continue
      }

      Write-ContentWorkerLog ("worker_stale_configuration id={0} pid={1} expected_kinds={2} actual_kinds={3}" -f $workerId, $process.ProcessId, $expectedKinds, $actualKinds)
      Stop-ContentWorkerProcess -WorkerId $workerId -Process $process
      $staleStopped = $true
    }
    if ($staleStopped) {
      Start-Sleep -Milliseconds 250
    }
    if ($current.Count -gt 1) {
      $preferredCurrent = @(
        $current |
          Where-Object {
            Test-ContentWorkerProcessScript -Process $_ -ScriptPath $workerScript
          } |
          Sort-Object CreationDate -Descending
      ) | Select-Object -First 1
      if (-not $preferredCurrent) {
        $preferredCurrent = @($current | Sort-Object CreationDate -Descending) | Select-Object -First 1
      }

      foreach ($duplicateCurrent in $current) {
        if ($duplicateCurrent.ProcessId -eq $preferredCurrent.ProcessId) {
          continue
        }
        Write-ContentWorkerLog ("worker_duplicate_configuration id={0} keep_pid={1} stop_pid={2}" -f $workerId, $preferredCurrent.ProcessId, $duplicateCurrent.ProcessId)
        Stop-ContentWorkerProcess -WorkerId $workerId -Process $duplicateCurrent
      }
      $current = @($preferredCurrent)
    }
    if ($current.Count -gt 0) {
      Write-ContentWorkerLog ("worker_noop_current id={0} pid={1}" -f $workerId, (($current | Select-Object -ExpandProperty ProcessId) -join ","))
      continue
    }

    Write-ContentWorkerLog ("starting_worker id={0} kinds={1}" -f $workerId, $kinds)
    $stdoutPath = Join-Path $logDir ("{0}.task.stdout.log" -f $workerId)
    $stderrPath = Join-Path $logDir ("{0}.task.stderr.log" -f $workerId)
    $commandLine = ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -RepoRoot "{2}" -WorkerId "{3}" -Kinds "{4}" -RuntimeRepoRoot "{5}"' -f $powershellExe, $taskWrapper, $RepoRoot, $workerId, $kinds, $RuntimeRepoRoot)
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine = $commandLine
      CurrentDirectory = $RepoRoot
    }
    if ($created.ReturnValue -ne 0 -or -not $created.ProcessId) {
      $failure = "worker_launch_failed id={0} return_value={1} stdout={2} stderr={3}" -f $workerId, $created.ReturnValue, $stdoutPath, $stderrPath
      Write-ContentWorkerLog $failure
      throw $failure
    }
    Start-Sleep -Seconds 2
    $launched = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $created.ProcessId) -ErrorAction SilentlyContinue
    if (-not $launched) {
      $failure = "worker_launch_failed id={0} pid={1} stdout={2} stderr={3}" -f $workerId, $created.ProcessId, $stdoutPath, $stderrPath
      Write-ContentWorkerLog $failure
      throw $failure
    }
    Write-ContentWorkerLog ("worker_started id={0} pid={1}" -f $workerId, $created.ProcessId)
  }
} finally {
  if ($supervisorLockAcquired) {
    $supervisorMutex.ReleaseMutex()
  }
  $supervisorMutex.Dispose()
}
