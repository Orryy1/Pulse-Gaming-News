param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$WorkerId,
  [Parameter(Mandatory = $true)]
  [string]$Kinds
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).Path
$workerScript = Join-Path $RepoRoot "tools/local-sqlite-content-worker.js"
$nodeExe = (Get-Command "node.exe" -ErrorAction Stop).Source
$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Set-BackgroundProcessResources {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Process
  )

  $Process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
  $logicalProcessors = [Environment]::ProcessorCount
  if ($logicalProcessors -gt 2 -and $logicalProcessors -lt 63) {
    $reservedForForeground = if ($logicalProcessors -ge 8) {
      [Math]::Max(2, [Math]::Ceiling($logicalProcessors / 4))
    } else {
      1
    }
    $backgroundProcessors = [Math]::Max(1, $logicalProcessors - $reservedForForeground)
    $affinityMask = ([int64]1 -shl $backgroundProcessors) - 1
    $Process.ProcessorAffinity = [IntPtr]$affinityMask
  }
}

$threadBudget = [string]$env:PULSE_CONTENT_WORKER_THREAD_BUDGET
if (-not $threadBudget -or $threadBudget -notmatch "^\d+$" -or [int]$threadBudget -lt 1) {
  $threadBudget = "2"
}
$env:PULSE_CONTENT_WORKER_RESOURCE_CLASS = "background"
$env:PULSE_CONTENT_WORKER_THREAD_BUDGET = $threadBudget
$env:OMP_NUM_THREADS = $threadBudget
$env:OPENBLAS_NUM_THREADS = $threadBudget
$env:MKL_NUM_THREADS = $threadBudget
$env:NUMEXPR_NUM_THREADS = $threadBudget
$env:VECLIB_MAXIMUM_THREADS = $threadBudget
$env:VIPS_CONCURRENCY = $threadBudget
$env:TOKENIZERS_PARALLELISM = "false"

# Set the wrapper first so every descendant inherits the background class.
Set-BackgroundProcessResources -Process ([System.Diagnostics.Process]::GetCurrentProcess())

$env:USE_SQLITE = "true"
$env:SQLITE_DB_PATH = "D:/pulse-data/pulse.db"
$env:PULSE_PRIMARY_INSTANCE = "true"
$env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"
$env:PULSE_MAINTENANCE_RUNNER = "false"

$stdoutPath = Join-Path $logDir ("{0}.task.stdout.log" -f $WorkerId)
$stderrPath = Join-Path $logDir ("{0}.task.stderr.log" -f $WorkerId)
$process = Start-Process -FilePath $nodeExe `
  -ArgumentList @($workerScript, "--worker-id", $WorkerId, "--kinds", $Kinds) `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

try {
  Set-BackgroundProcessResources -Process $process
} catch {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "Refusing to run content worker $WorkerId without background resource isolation: $($_.Exception.Message)"
}

$process.WaitForExit()
exit $process.ExitCode
