param(
  [string]$RepoRoot = "",
  [string]$EvidenceRoot = "",
  [int]$Port = 3001,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if (-not $EvidenceRoot) {
  $EvidenceRoot = [string]$env:PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT
}
if (-not $EvidenceRoot) {
  $outputItem = Get-Item -LiteralPath (Join-Path $RepoRoot "output") -ErrorAction SilentlyContinue
  if ($outputItem -and $outputItem.LinkType -eq "Junction" -and @($outputItem.Target).Count -gt 0) {
    $outputTarget = [string]@($outputItem.Target)[0]
    if (-not [System.IO.Path]::IsPathRooted($outputTarget)) {
      $outputTarget = Join-Path $RepoRoot $outputTarget
    }
    $EvidenceRoot = Split-Path -Parent (Resolve-Path -LiteralPath $outputTarget).Path
  } else {
    $EvidenceRoot = $RepoRoot
  }
}
$EvidenceRoot = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$evidenceRootItem = Get-Item -LiteralPath $EvidenceRoot
if (
  -not $evidenceRootItem.PSIsContainer -or
  ($evidenceRootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
) {
  throw "Refusing publish evidence root because it is not a normal local directory: $EvidenceRoot"
}

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-primary-runtime.log"
$publishCriticalWorkerScript = Join-Path $RepoRoot "tools/local-publish-critical-worker.js"
$publishCriticalWorkerId = "pulse-live-publish-critical"

function Write-RuntimeLog {
  param([string]$Message)
  try {
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message)
  } catch {
    # The active node process may hold the combined runtime log open during a restart.
    # Logging must never block replacing a stale server process.
  }
}

function Get-PublishCriticalWorkerProcesses {
  $escapedScript = [regex]::Escape([System.IO.Path]::GetFullPath($publishCriticalWorkerScript))
  return @(
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $commandLine = [string]$_.CommandLine
        $commandLine -and
        $commandLine -match $escapedScript -and
        $commandLine -match ('--worker-id(?:=|\s+)"?{0}"?(?:\s|$)' -f [regex]::Escape($publishCriticalWorkerId))
      }
  )
}

function Ensure-PublishCriticalWorker {
  param([string]$NodeExecutable)

  if (-not (Test-Path -LiteralPath $publishCriticalWorkerScript -PathType Leaf)) {
    throw "Guarded publish worker script missing: $publishCriticalWorkerScript"
  }

  $existingWorkers = @(Get-PublishCriticalWorkerProcesses)
  if ($existingWorkers.Count -gt 0) {
    $preferredWorker = @($existingWorkers | Sort-Object CreationDate -Descending) | Select-Object -First 1
    foreach ($duplicateWorker in $existingWorkers) {
      if ($duplicateWorker.ProcessId -eq $preferredWorker.ProcessId) { continue }
      Stop-Process -Id $duplicateWorker.ProcessId -Force -ErrorAction SilentlyContinue
      Write-RuntimeLog ("publish_critical_worker_duplicate_stopped pid={0}" -f $duplicateWorker.ProcessId)
    }
    Write-RuntimeLog ("publish_critical_worker_noop_current pid={0}" -f $preferredWorker.ProcessId)
    return $preferredWorker.ProcessId
  }

  $env:AUTO_PUBLISH = "true"
  $env:USE_JOB_QUEUE = "true"
  $env:USE_SQLITE = "true"
  $env:SQLITE_DB_PATH = "D:/pulse-data/pulse.db"
  $env:PULSE_PRIMARY_INSTANCE = "true"
  $env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true"
  $env:PULSE_EMERGENCY_KILL_SWITCH = "clear"
  $env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"
  $env:PULSE_MAINTENANCE_RUNNER = "false"

  $workerStdoutPath = Join-Path $logDir "pulse-live-publish-critical.stdout.log"
  $workerStderrPath = Join-Path $logDir "pulse-live-publish-critical.stderr.log"
  $worker = Start-Process -FilePath $NodeExecutable `
    -ArgumentList @($publishCriticalWorkerScript, "--worker-id", $publishCriticalWorkerId) `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $workerStdoutPath `
    -RedirectStandardError $workerStderrPath `
    -PassThru
  Start-Sleep -Seconds 2
  $worker.Refresh()
  if ($worker.HasExited) {
    throw "Guarded publish worker exited during startup. Inspect $workerStderrPath"
  }
  Write-RuntimeLog ("publish_critical_worker_started pid={0} kinds=publish_schedule_recovery_monitor,publish_window_watchdog,publish" -f $worker.Id)
  return $worker.Id
}

function Resolve-GitExecutable {
  $command = Get-Command "git.exe" -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return [string]$command.Source
  }

  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles "Git/cmd/git.exe"
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += Join-Path ${env:ProgramFiles(x86)} "Git/cmd/git.exe"
  }
  if ($env:ProgramW6432) {
    $candidates += Join-Path $env:ProgramW6432 "Git/cmd/git.exe"
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [string]$candidate
    }
  }
  return $null
}

function Resolve-GitDirectory {
  param([string]$RepositoryRoot)

  $dotGitPath = Join-Path $RepositoryRoot ".git"
  $dotGitItem = Get-Item -LiteralPath $dotGitPath -Force -ErrorAction SilentlyContinue
  if (-not $dotGitItem) {
    return $null
  }
  if ($dotGitItem.PSIsContainer) {
    return [string]$dotGitItem.FullName
  }

  $pointer = [string](Get-Content -LiteralPath $dotGitPath -Raw -ErrorAction SilentlyContinue)
  if ($pointer -notmatch '(?im)^\s*gitdir:\s*(.+?)\s*$') {
    return $null
  }
  $gitDirectory = [string]$Matches[1]
  if (-not [System.IO.Path]::IsPathRooted($gitDirectory)) {
    $gitDirectory = Join-Path $RepositoryRoot $gitDirectory
  }
  $resolved = Resolve-Path -LiteralPath $gitDirectory -ErrorAction SilentlyContinue
  return $(if ($resolved) { [string]$resolved.Path } else { $null })
}

function Resolve-RepositoryIdentity {
  param([string]$RepositoryRoot)

  $gitDirectory = Resolve-GitDirectory -RepositoryRoot $RepositoryRoot
  if (-not $gitDirectory) {
    return $null
  }

  $headPath = Join-Path $gitDirectory "HEAD"
  $head = [string](Get-Content -LiteralPath $headPath -Raw -ErrorAction SilentlyContinue)
  $head = $head.Trim()
  $commit = ""
  $branch = ""

  if ($head -match '^ref:\s*(.+)$') {
    $refName = [string]$Matches[1]
    if ($refName.StartsWith("refs/heads/")) {
      $branch = $refName.Substring("refs/heads/".Length)
    }

    $looseRefPath = Join-Path $gitDirectory $refName
    if (Test-Path -LiteralPath $looseRefPath -PathType Leaf) {
      $commit = ([string](Get-Content -LiteralPath $looseRefPath -Raw)).Trim()
    } else {
      $packedRefsPath = Join-Path $gitDirectory "packed-refs"
      if (Test-Path -LiteralPath $packedRefsPath -PathType Leaf) {
        $escapedRef = [regex]::Escape($refName)
        foreach ($line in Get-Content -LiteralPath $packedRefsPath) {
          if ([string]$line -match ("^([a-fA-F0-9]{{40,64}})\s+{0}$" -f $escapedRef)) {
            $commit = [string]$Matches[1]
            break
          }
        }
      }
    }
  } elseif ($head -match '^[a-fA-F0-9]{40,64}$') {
    $commit = $head
    $branch = "HEAD"
  }

  if (
    $commit -notmatch '^[a-fA-F0-9]{40,64}$' -or
    [string]::IsNullOrWhiteSpace($branch)
  ) {
    return $null
  }

  return [pscustomobject]@{
    commit_sha = $commit
    branch = $branch
  }
}

Set-Location -LiteralPath $RepoRoot

$commitSha = ""
$branchName = ""
$gitExecutable = Resolve-GitExecutable
try {
  if ($gitExecutable) {
    $commitSha = (& $gitExecutable -C $RepoRoot rev-parse HEAD 2>$null).Trim()
    $branchName = (& $gitExecutable -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
  }
} catch {
  $commitSha = ""
  $branchName = ""
}
$repositoryIdentity = Resolve-RepositoryIdentity -RepositoryRoot $RepoRoot
if (-not $commitSha -and $repositoryIdentity) {
  $commitSha = [string]$repositoryIdentity.commit_sha
}
if (-not $branchName -and $repositoryIdentity) {
  $branchName = [string]$repositoryIdentity.branch
}
if (-not $commitSha -or -not $branchName) {
  throw "Refusing protected primary runtime start without repository commit and branch identity."
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
  $protectedPrimaryRuntime = [bool]$Health.runtime.protected_primary_runtime
  return (
    $schedulerActive -and
    $autoPublish -and
    $jobQueueEnabled -and
    $queueDispatch -and
    $protectedPrimaryRuntime -and
    -not $safeObservationMode -and
    -not $primaryRuntimeHold
  )
}

function Test-HealthProvesProtectedPrimaryRuntime {
  param($Health)
  if (-not $Health -or -not $Health.runtime -or -not $Health.deployment) { return $false }
  return (
    $Health.deployment.mode -eq "local" -and
    [bool]$Health.deployment.primary -and
    [bool]$Health.runtime.protected_primary_runtime -and
    [bool]$Health.schedulerActive -and
    [bool]$Health.runtime.auto_publish -and
    ([string]$Health.runtime.use_job_queue_explicit).ToLowerInvariant() -eq "true" -and
    [string]$Health.runtime.dispatch.mode -eq "queue"
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
  WHERE kind IN ('publish_schedule_recovery_monitor','publish_runway_generate','publish','publish_window_watchdog')
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

$runtimeTransitionMutexName = "Local\PulseGamingPrimaryRuntimeTransition-{0}" -f $Port
$runtimeTransitionMutex = [System.Threading.Mutex]::new($false, $runtimeTransitionMutexName)
$runtimeTransitionMutexAcquired = $false

try {
  try {
    $runtimeTransitionMutexAcquired = $runtimeTransitionMutex.WaitOne([TimeSpan]::FromMinutes(2))
  } catch [System.Threading.AbandonedMutexException] {
    $runtimeTransitionMutexAcquired = $true
    Write-RuntimeLog ("runtime_transition_mutex_abandoned_acquired name={0} port={1}" -f $runtimeTransitionMutexName, $Port)
  }

  if (-not $runtimeTransitionMutexAcquired) {
    Write-RuntimeLog ("runtime_transition_mutex_timeout name={0} port={1}" -f $runtimeTransitionMutexName, $Port)
    exit 0
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
    $nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
      $nodeCommand = Get-Command "node" -ErrorAction Stop
    }
    [void](Ensure-PublishCriticalWorker -NodeExecutable $nodeCommand.Source)
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

  $runtimeHealthForStop = Get-RuntimeHealth -RuntimePort $Port
  foreach ($pidToStop in $existing) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidToStop"
    $commandLineRejectsServer = -not $process.CommandLine -or $process.CommandLine -notmatch "server\.js"
    $commandLineProvesServer = $process -and -not $commandLineRejectsServer
    $healthProvesProtectedPrimary =
      $process -and
      $process.Name -ieq "node.exe" -and
      (Test-HealthProvesProtectedPrimaryRuntime -Health $runtimeHealthForStop)
    if (-not $commandLineProvesServer -and -not $healthProvesProtectedPrimary) {
      throw "Refusing to stop PID $pidToStop on port $Port because it is not node server.js: $($process.CommandLine)"
    }
    if (-not $commandLineProvesServer) {
      Write-RuntimeLog ("stopping_health_attested_uninspectable_runtime port={0} pid={1}" -f $Port, $pidToStop)
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
$env:PULSE_PROTECTED_PRIMARY_RUNTIME = "true"
$env:PULSE_SERVER_GENERAL_QUEUE_RUNNER = "false"
$env:PULSE_GENERAL_QUEUE_RUNNER = "false"
$env:PULSE_SERVER_CONTENT_RUNNERS = "false"
$env:PULSE_MISSED_WINDOW_RECOVERY = "false"
$env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"
$env:PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT = $EvidenceRoot
$env:TIKTOK_AUTH_CHECK_ENABLED = "true"
$env:PULSE_GUARDED_EXECUTOR_PLAN_PATH = "output/goal-contract/guarded_dispatch_executor_plan.json"
$env:PULSE_RESET_SCHEDULES_ON_BOOT = "true"
if ($commitSha) { $env:RAILWAY_GIT_COMMIT_SHA = $commitSha }
if ($branchName) { $env:RAILWAY_GIT_BRANCH = $branchName }

$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $nodeCommand = Get-Command "node" -ErrorAction Stop
}
$nodeExe = $nodeCommand.Source
$stdoutPath = Join-Path $logDir "pulse-live-primary-runtime.stdout.log"
$stderrPath = Join-Path $logDir "pulse-live-primary-runtime.stderr.log"

Write-RuntimeLog ("node_start repo={0} port={1}" -f $RepoRoot, $Port)
$startedProcess = Start-Process -FilePath $nodeExe `
  -ArgumentList @("server.js", "--protected-primary-runtime") `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$startedHealth = $null
for ($attempt = 1; $attempt -le 15; $attempt++) {
  Start-Sleep -Seconds 2
  $startedProcess.Refresh()
  if ($startedProcess.HasExited) { break }
  $startedHealth = Get-RuntimeHealth -RuntimePort $Port
  if ($startedHealth -and (Test-ExpectedPrimaryRuntimeMode -Health $startedHealth)) {
    break
  }
}

$startedProcess.Refresh()
if (
  $startedProcess.HasExited -or
  -not $startedHealth -or
  -not (Test-ExpectedPrimaryRuntimeMode -Health $startedHealth)
) {
  if (-not $startedProcess.HasExited) {
    Stop-Process -Id $startedProcess.Id -Force -ErrorAction SilentlyContinue
  }
  $failure = "started_runtime_failed_health_check pid={0} port={1} exited={2} stdout={3} stderr={4}" -f $startedProcess.Id, $Port, $startedProcess.HasExited, $stdoutPath, $stderrPath
  Write-RuntimeLog $failure
  throw $failure
}

Write-RuntimeLog ("node_started pid={0} port={1} commit_sha={2} branch={3}" -f $startedProcess.Id, $Port, (Get-RuntimeCommitSha -Health $startedHealth), (Get-RuntimeBranchName -Health $startedHealth))
[void](Ensure-PublishCriticalWorker -NodeExecutable $nodeExe)
Write-Output ("node_started pid={0} port={1}" -f $startedProcess.Id, $Port)
} finally {
  if ($runtimeTransitionMutexAcquired) {
    try {
      $runtimeTransitionMutex.ReleaseMutex()
    } catch {
      Write-RuntimeLog ("runtime_transition_mutex_release_failed name={0} port={1} error={2}" -f $runtimeTransitionMutexName, $Port, $_.Exception.Message)
    }
  }
  $runtimeTransitionMutex.Dispose()
}
