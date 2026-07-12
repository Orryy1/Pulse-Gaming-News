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
  -Wait `
  -PassThru
exit $process.ExitCode
