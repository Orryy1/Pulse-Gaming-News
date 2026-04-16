# pulse-worker.ps1 — the wrapper Task Scheduler actually invokes.
#
# Keep this script minimal and idempotent. It sets up env, hands off to
# `node workers/local-worker.js`, and logs stdout/stderr to a rolling
# log file. All policy (idle detection, battery gate, protected-app
# watchdog) lives in lib/power-gate.js — this script just launches the
# process and lets Node do the rest.
#
# Conventions:
#   - Reads env from pulse-gaming/.env.worker if present.
#   - Logs to %LOCALAPPDATA%\PulseGaming\worker.log (rotates at 10MB).
#   - Exit code 0 on clean shutdown; non-zero lets Task Scheduler's
#     "restart on failure" policy take over.

param(
  [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'

$LogDir = Join-Path $env:LOCALAPPDATA 'PulseGaming'
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
$LogFile = Join-Path $LogDir 'worker.log'

# Rotate log at 10MB
if (Test-Path $LogFile) {
  $len = (Get-Item $LogFile).Length
  if ($len -gt 10MB) {
    $stamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
    Move-Item $LogFile (Join-Path $LogDir ("worker.$stamp.log")) -Force
  }
}

function Write-WorkerLog {
  param([string]$msg)
  $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  "$ts  $msg" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

Write-WorkerLog "=== pulse-worker.ps1 starting ==="
Write-WorkerLog "ProjectRoot: $ProjectRoot"

Set-Location $ProjectRoot

# Load .env.worker if present (a minimal env file kept outside .env so
# the cloud's secrets and the worker's secrets can diverge)
$envFile = Join-Path $ProjectRoot '.env.worker'
if (Test-Path $envFile) {
  Write-WorkerLog "Loading env from $envFile"
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    # Strip matched quotes
    if ($v.Length -ge 2 -and ($v.StartsWith('"') -and $v.EndsWith('"'))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($k, $v, 'Process')
  }
}

if (-not $env:WORKER_CLOUD_URL) {
  Write-WorkerLog "FATAL: WORKER_CLOUD_URL not set. Exiting."
  exit 2
}

# Locate node.exe. Prefer the one on PATH; fall back to the usual nvm-for-Windows location.
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\nvm\node.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $nodeExe = $c; break }
  }
}
if (-not $nodeExe) {
  Write-WorkerLog "FATAL: node.exe not found on PATH or standard install locations."
  exit 3
}
Write-WorkerLog "node.exe: $nodeExe"

$workerScript = Join-Path $ProjectRoot 'workers\local-worker.js'
if (-not (Test-Path $workerScript)) {
  Write-WorkerLog "FATAL: $workerScript not found"
  exit 4
}

Write-WorkerLog "launching node $workerScript"

# Hand off. All stdout/stderr tee'd to the log via the Task Scheduler's
# redirect (see install-worker.ps1). We explicitly invoke node rather than
# Start-Process so the task's exit code mirrors node's.
& $nodeExe $workerScript 2>&1 | ForEach-Object {
  $_ | Out-File -FilePath $LogFile -Append -Encoding utf8
}
$code = $LASTEXITCODE
Write-WorkerLog "node exited with code $code"
exit $code
