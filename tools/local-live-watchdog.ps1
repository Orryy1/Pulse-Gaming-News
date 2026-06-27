param(
  [string]$RepoRoot = "",
  [int]$Port = 3001,
  [int]$IntervalSeconds = 15,
  [string]$TunnelConfigPath = "D:/pulse-data/cloudflared-pulse.yml"
)

$ErrorActionPreference = "Continue"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-watchdog.log"
$runtimeScript = Join-Path $RepoRoot "tools/local-live-primary-runtime.ps1"
$tunnelScript = Join-Path $RepoRoot "tools/local-live-cloudflared-tunnel.ps1"

function Write-WatchdogLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message
  Add-Content -LiteralPath $logPath -Value $line
}

function Get-RuntimeHealth {
  try {
    return Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 3 -UseBasicParsing
  } catch {
    Write-WatchdogLog ("runtime_health_unavailable error={0}" -f $_.Exception.Message)
    return $null
  }
}

function Test-RuntimeHealth {
  param($Health)
  if (-not $Health) { return $false }
  $statusOk = ([string]$Health.status) -eq "ok"
  $schedulerActive = [bool]$Health.schedulerActive
  $autoPublish = [bool]($Health.runtime -and $Health.runtime.auto_publish)
  $queueMode = [string]($Health.runtime.dispatch.mode) -eq "queue"
  return ($statusOk -and $schedulerActive -and $autoPublish -and $queueMode)
}

Write-WatchdogLog "watchdog_start repo=$RepoRoot port=$Port interval=${IntervalSeconds}s"

while ($true) {
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) {
      Write-WatchdogLog "runtime_missing starting_primary_runtime"
      Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runtimeScript, "-RepoRoot", $RepoRoot, "-Port", "$Port") `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden | Out-Null
    } else {
      $health = Get-RuntimeHealth
      if (-not (Test-RuntimeHealth -Health $health)) {
        Write-WatchdogLog "runtime_unhealthy starting_primary_runtime"
        Start-Process -FilePath "powershell.exe" `
          -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runtimeScript, "-RepoRoot", $RepoRoot, "-Port", "$Port", "-Restart") `
          -WorkingDirectory $RepoRoot `
          -WindowStyle Hidden | Out-Null
      }
    }

    $tunnel = Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
      Where-Object { $_.CommandLine -like "*cloudflared-pulse.yml*" }
    if (-not $tunnel) {
      Write-WatchdogLog "tunnel_missing starting_cloudflared"
      Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $tunnelScript, "-ConfigPath", $TunnelConfigPath) `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden | Out-Null
    }
  } catch {
    Write-WatchdogLog ("watchdog_error " + $_.Exception.Message)
  }

  Start-Sleep -Seconds $IntervalSeconds
}
