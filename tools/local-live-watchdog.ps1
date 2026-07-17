param(
  [string]$RepoRoot = "",
  [int]$Port = 3001,
  [int]$IntervalSeconds = 15,
  [int]$HealthTimeoutSeconds = 5,
  [int]$UnhealthyRestartThreshold = 3,
  [int]$PublishWindowGuardBeforeMinutes = 10,
  [int]$PublishWindowGuardAfterMinutes = 35,
  [string]$TunnelConfigPath = "D:/pulse-data/cloudflared-pulse.yml"
)

$ErrorActionPreference = "Continue"

. (Join-Path $PSScriptRoot "local-live-watchdog-policy.ps1")

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$logDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "pulse-live-watchdog.log"
$runtimeScript = Join-Path $RepoRoot "tools/local-live-primary-runtime.ps1"
$tunnelScript = Join-Path $RepoRoot "tools/local-live-cloudflared-tunnel.ps1"
$contentWorkersScript = Join-Path $RepoRoot "tools/local-live-content-workers.ps1"

$watchdogMutexCreated = $false
$watchdogMutex = New-Object System.Threading.Mutex($true, "Local\PulseGamingLiveWatchdog", [ref]$watchdogMutexCreated)
if (-not $watchdogMutexCreated) {
  exit 0
}

function Write-WatchdogLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("s"), $Message
  Add-Content -LiteralPath $logPath -Value $line
}

function Get-RuntimeHealthProbe {
  try {
    $health = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec $HealthTimeoutSeconds -UseBasicParsing
    return [pscustomobject]@{
      outcome = "answered"
      health = $health
    }
  } catch {
    $outcome = "request_failed"
    if (Test-HealthRequestTimeout -ErrorRecord $_) {
      $outcome = "timeout"
    }
    Write-WatchdogLog ("runtime_health_unavailable outcome={0} error={1}" -f $outcome, $_.Exception.Message)
    return [pscustomobject]@{
      outcome = $outcome
      health = $null
    }
  }
}

function Get-RuntimeListenerOwners {
  return @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

function Get-VerifiedNodeServerOwnerIds {
  param([int[]]$OwnerIds)

  foreach ($ownerId in @($OwnerIds)) {
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId" -ErrorAction Stop
      $isNode = ([string]$process.Name) -ieq "node.exe"
      $isServer = ([string]$process.CommandLine) -match '(^|[\\/\s"])server\.js($|[\s"])'
      if ($isNode -and $isServer) {
        Write-Output ([int]$ownerId)
      }
    } catch {
      Write-WatchdogLog ("runtime_listener_identity_unavailable pid={0} error={1}" -f $ownerId, $_.Exception.Message)
    }
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

function Test-InCriticalPublishWindow {
  $nowUtc = (Get-Date).ToUniversalTime()
  $minuteOfDay = [int]$nowUtc.TimeOfDay.TotalMinutes
  $publishWindowMinutes = @((9 * 60), (11 * 60), (14 * 60), (16 * 60), (19 * 60))
  foreach ($windowMinute in $publishWindowMinutes) {
    $start = $windowMinute - $PublishWindowGuardBeforeMinutes
    $end = $windowMinute + $PublishWindowGuardAfterMinutes
    if ($minuteOfDay -ge $start -and $minuteOfDay -le $end) {
      return $true
    }
  }
  return $false
}

Write-WatchdogLog "watchdog_start repo=$RepoRoot port=$Port interval=${IntervalSeconds}s"

$destructiveRestartCount = 0

while ($true) {
  try {
    $listenerOwners = @(Get-RuntimeListenerOwners)
    $listenerPresent = $listenerOwners.Count -gt 0
    $healthOutcome = "request_failed"
    $sameServerListener = $false

    if ($listenerPresent) {
      $healthProbe = Get-RuntimeHealthProbe
      if ($healthProbe.outcome -eq "answered") {
        if (Test-RuntimeHealth -Health $healthProbe.health) {
          $healthOutcome = "healthy"
        } else {
          $healthOutcome = "answered_invalid_policy"
        }
      } else {
        $healthOutcome = [string]$healthProbe.outcome
        $postProbeListenerOwners = @(Get-RuntimeListenerOwners)
        $verifiedNodeServerOwnerIds = @(Get-VerifiedNodeServerOwnerIds -OwnerIds $postProbeListenerOwners)
        $sameServerListener = Test-SameNodeServerListener `
          -BeforeOwnerIds $listenerOwners `
          -AfterOwnerIds $postProbeListenerOwners `
          -VerifiedNodeServerOwnerIds $verifiedNodeServerOwnerIds
        $listenerPresent = $postProbeListenerOwners.Count -gt 0
      }
    }

    $inCriticalPublishWindow = Test-InCriticalPublishWindow
    $decision = Resolve-WatchdogRuntimeDecision `
      -ListenerPresent $listenerPresent `
      -HealthOutcome $healthOutcome `
      -SameServerListener $sameServerListener `
      -DestructiveRestartCount $destructiveRestartCount `
      -RestartThreshold $UnhealthyRestartThreshold `
      -InCriticalPublishWindow $inCriticalPublishWindow
    $destructiveRestartCount = [int]$decision.destructive_restart_count

    if ($decision.action -eq "start") {
      Write-WatchdogLog "runtime_missing starting_primary_runtime"
      Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runtimeScript, "-RepoRoot", $RepoRoot, "-Port", "$Port") `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden | Out-Null
    } elseif ($decision.action -eq "restart") {
      Write-WatchdogLog ("runtime_unhealthy starting_primary_runtime classification={0} destructive_restart_count={1}" -f $decision.classification, $destructiveRestartCount)
      $destructiveRestartCount = 0
      Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runtimeScript, "-RepoRoot", $RepoRoot, "-Port", "$Port", "-Restart") `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden | Out-Null
    } elseif ($decision.classification -eq "invalid_runtime_policy") {
      if ($inCriticalPublishWindow) {
        Write-WatchdogLog ("runtime_unhealthy_publish_window_guard skip_restart destructive_restart_count={0} threshold={1}" -f $destructiveRestartCount, $UnhealthyRestartThreshold)
      } else {
        Write-WatchdogLog ("runtime_unhealthy_retrying classification={0} destructive_restart_count={1} threshold={2}" -f $decision.classification, $destructiveRestartCount, $UnhealthyRestartThreshold)
      }
    } elseif ($decision.classification -eq "overloaded_or_unresponsive") {
      Write-WatchdogLog ("runtime_classification=overloaded_or_unresponsive action=none pid={0} destructive_restart_count={1}" -f ($listenerOwners -join ","), $destructiveRestartCount)
    } elseif ($decision.classification -ne "healthy") {
      Write-WatchdogLog ("runtime_classification={0} action=none destructive_restart_count={1}" -f $decision.classification, $destructiveRestartCount)
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

    Write-WatchdogLog "content_workers_check ensuring_content_workers"
    Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $contentWorkersScript, "-RepoRoot", $RepoRoot) `
      -WorkingDirectory $RepoRoot `
      -WindowStyle Hidden | Out-Null
  } catch {
    Write-WatchdogLog ("watchdog_error " + $_.Exception.Message)
  }

  Start-Sleep -Seconds $IntervalSeconds
}
