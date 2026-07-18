param(
  [string]$RepoRoot = "",
  [string]$RuntimeRepoRoot = "",
  [string]$TaskName = "PulseGaming-LiveWatchdog-Supervisor",
  [int]$Port = 3001,
  [string]$TunnelConfigPath = "D:/pulse-data/cloudflared-pulse.yml",
  [string]$ExpectedTunnelHost = "pulse.orryy.com",
  [string]$ExpectedTunnelService = "",
  [string]$ProbeFixturePath = "",
  [string]$StatusPath = "",
  [string]$MissedWindowEvidencePath = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
if (-not $RuntimeRepoRoot) {
  $RuntimeRepoRoot = $RepoRoot
} else {
  $RuntimeRepoRoot = (Resolve-Path -LiteralPath $RuntimeRepoRoot).Path
}

if (-not [System.IO.Path]::IsPathRooted($TunnelConfigPath)) {
  $TunnelConfigPath = Join-Path $RepoRoot $TunnelConfigPath
}
$TunnelConfigPath = [System.IO.Path]::GetFullPath($TunnelConfigPath)
if (-not $ExpectedTunnelService) {
  $ExpectedTunnelService = "http://localhost:{0}" -f $Port
}

$outputDirectory = Join-Path $RepoRoot "output/runtime"
if (-not $StatusPath) {
  $StatusPath = Join-Path $outputDirectory "machine_boot_supervision_status.json"
}
if (-not $MissedWindowEvidencePath) {
  $MissedWindowEvidencePath = Join-Path $outputDirectory "machine_boot_missed_window_evidence.json"
}

$watchdogScript = Join-Path $RepoRoot "tools/local-live-watchdog.ps1"
$policyScript = Join-Path $RepoRoot "tools/local-live-watchdog-policy.ps1"
$runtimeEntrypoint = Join-Path $RuntimeRepoRoot "tools/local-live-primary-runtime.ps1"
$tunnelEntrypoint = Join-Path $RepoRoot "tools/local-live-cloudflared-tunnel.ps1"
$approvedPowerShell = Join-Path $env:SystemRoot "System32/WindowsPowerShell/v1.0/powershell.exe"
$publishWindowMinutesUtc = @((9 * 60), (11 * 60), (14 * 60), (16 * 60), (19 * 60))

. $policyScript

function Write-JsonAtomic {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $jsonText = ($Value | ConvertTo-Json -Depth 12)
  $temporaryPath = "{0}.tmp.{1}" -f $Path, $PID
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temporaryPath, $jsonText + [Environment]::NewLine, $utf8WithoutBom)
  Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Convert-ToUtcIso {
  param($Value)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return $null
  }
  try {
    if ($Value -is [DateTimeOffset]) {
      return $Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    if ($Value -is [DateTime]) {
      return $Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }
    return ([DateTimeOffset]::Parse([string]$Value)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  } catch {
    return $null
  }
}

function Test-PathEquivalent {
  param(
    [string]$Actual,
    [string]$Expected
  )
  if ([string]::IsNullOrWhiteSpace($Actual) -or [string]::IsNullOrWhiteSpace($Expected)) {
    return $false
  }
  try {
    $actualPath = [System.IO.Path]::GetFullPath($Actual).TrimEnd("\", "/")
    $expectedPath = [System.IO.Path]::GetFullPath($Expected).TrimEnd("\", "/")
    return $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Get-CommandArgumentTokens {
  param([string]$Arguments)
  if ([string]::IsNullOrWhiteSpace($Arguments)) {
    return @()
  }
  $parseErrors = $null
  $tokens = @([System.Management.Automation.PSParser]::Tokenize($Arguments, [ref]$parseErrors))
  if (@($parseErrors).Count -gt 0) {
    return @()
  }
  return @($tokens | ForEach-Object { [string]$_.Content })
}

function Test-TokenSequence {
  param(
    [string[]]$Actual,
    [string[]]$Expected
  )
  if ($Actual.Count -ne $Expected.Count) {
    return $false
  }
  for ($index = 0; $index -lt $Actual.Count; $index++) {
    if (-not $Actual[$index].Equals($Expected[$index], [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
  }
  return $true
}

function Test-ApprovedTaskAction {
  param(
    $Task,
    [string]$ExpectedPowerShell,
    [string]$ExpectedWatchdog,
    [string]$ExpectedRepoRoot,
    [string]$ExpectedRuntimeRepoRoot,
    [int]$ExpectedPort,
    [string]$ExpectedTunnelConfig
  )
  if (-not $Task) {
    return $false
  }
  if (-not (Test-PathEquivalent -Actual ([string]$Task.execute) -Expected $ExpectedPowerShell)) {
    return $false
  }
  if (-not (Test-PathEquivalent -Actual ([string]$Task.working_directory) -Expected $ExpectedRepoRoot)) {
    return $false
  }

  $baseArguments = (
    '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -Port {2}' -f
      $ExpectedWatchdog,
      $ExpectedRepoRoot,
      $ExpectedPort
  )
  $protectedRuntimeArguments = (
    '{0} -RuntimeRepoRoot "{1}"' -f $baseArguments, $ExpectedRuntimeRepoRoot
  )
  $withTunnelArguments = '{0} -TunnelConfigPath "{1}"' -f $baseArguments, $ExpectedTunnelConfig
  $protectedRuntimeWithTunnelArguments = '{0} -TunnelConfigPath "{1}"' -f $protectedRuntimeArguments, $ExpectedTunnelConfig
  $actualTokens = @(Get-CommandArgumentTokens -Arguments ([string]$Task.arguments))
  $baseTokens = @(Get-CommandArgumentTokens -Arguments $baseArguments)
  $protectedRuntimeTokens = @(Get-CommandArgumentTokens -Arguments $protectedRuntimeArguments)
  $withTunnelTokens = @(Get-CommandArgumentTokens -Arguments $withTunnelArguments)
  $protectedRuntimeWithTunnelTokens = @(Get-CommandArgumentTokens -Arguments $protectedRuntimeWithTunnelArguments)
  if (
    (Test-TokenSequence -Actual $actualTokens -Expected $protectedRuntimeTokens) -or
    (Test-TokenSequence -Actual $actualTokens -Expected $protectedRuntimeWithTunnelTokens)
  ) {
    return $true
  }
  $sameRoot = Test-PathEquivalent -Actual $ExpectedRuntimeRepoRoot -Expected $ExpectedRepoRoot
  return (
    $sameRoot -and (
      (Test-TokenSequence -Actual $actualTokens -Expected $baseTokens) -or
      (Test-TokenSequence -Actual $actualTokens -Expected $withTunnelTokens)
    )
  )
}

function Get-WatchdogProcessVerification {
  param(
    $Process,
    [string]$ExpectedPowerShell,
    [string]$ExpectedWatchdog,
    [string]$ExpectedRepoRoot,
    [string]$ExpectedRuntimeRepoRoot,
    [int]$ExpectedPort,
    [string]$ExpectedTunnelConfig
  )

  $rejectionReasons = @()
  if ([int]$Process.pid -le 0) {
    $rejectionReasons += "invalid_pid"
  }
  if ([string]$Process.name -ne "powershell.exe") {
    $rejectionReasons += "process_name_not_approved"
  }
  if (-not (Test-PathEquivalent -Actual ([string]$Process.executable_path) -Expected $ExpectedPowerShell)) {
    $rejectionReasons += "executable_path_not_approved"
  }

  $legacyArguments = (
    '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -Port {2}' -f
      $ExpectedWatchdog,
      $ExpectedRepoRoot,
      $ExpectedPort
  )
  $taskArguments = (
    '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -Port {2}' -f
      $ExpectedWatchdog,
      $ExpectedRepoRoot,
      $ExpectedPort
  )
  $legacyProtectedArguments = '{0} -RuntimeRepoRoot "{1}"' -f $legacyArguments, $ExpectedRuntimeRepoRoot
  $taskProtectedArguments = '{0} -RuntimeRepoRoot "{1}"' -f $taskArguments, $ExpectedRuntimeRepoRoot
  $approvedCommandLines = @(
    ('{0} {1}' -f $ExpectedPowerShell, $legacyProtectedArguments),
    ('{0} {1} -TunnelConfigPath "{2}"' -f $ExpectedPowerShell, $legacyProtectedArguments, $ExpectedTunnelConfig),
    ('{0} {1}' -f $ExpectedPowerShell, $taskProtectedArguments),
    ('{0} {1} -TunnelConfigPath "{2}"' -f $ExpectedPowerShell, $taskProtectedArguments, $ExpectedTunnelConfig)
  )
  if (Test-PathEquivalent -Actual $ExpectedRuntimeRepoRoot -Expected $ExpectedRepoRoot) {
    $approvedCommandLines += @(
      ('{0} {1}' -f $ExpectedPowerShell, $legacyArguments),
      ('{0} {1} -TunnelConfigPath "{2}"' -f $ExpectedPowerShell, $legacyArguments, $ExpectedTunnelConfig),
      ('{0} {1}' -f $ExpectedPowerShell, $taskArguments),
      ('{0} {1} -TunnelConfigPath "{2}"' -f $ExpectedPowerShell, $taskArguments, $ExpectedTunnelConfig)
    )
  }
  $actualTokens = @(Get-CommandArgumentTokens -Arguments ([string]$Process.command_line))
  $commandLineApproved = $false
  if ($actualTokens.Count -gt 0) {
    foreach ($approvedCommandLine in $approvedCommandLines) {
      $approvedTokens = @(Get-CommandArgumentTokens -Arguments $approvedCommandLine)
      if (
        $approvedTokens.Count -gt 0 -and
        (Test-TokenSequence -Actual $actualTokens -Expected $approvedTokens)
      ) {
        $commandLineApproved = $true
        break
      }
    }
  }
  if (-not $commandLineApproved) {
    $rejectionReasons += "command_line_not_approved"
  }

  return [ordered]@{
    approved = ($rejectionReasons.Count -eq 0)
    rejection_reasons = @($rejectionReasons)
  }
}

function Remove-ConfigValueQuotes {
  param([string]$Value)
  $text = ([string]$Value).Trim()
  if (
    $text.Length -ge 2 -and
    (($text.StartsWith('"') -and $text.EndsWith('"')) -or
      ($text.StartsWith("'") -and $text.EndsWith("'")))
  ) {
    return $text.Substring(1, $text.Length - 2)
  }
  return $text
}

function Get-TunnelConfigVerification {
  param(
    [string]$ConfigPath,
    [string]$ExpectedHost,
    [string]$ExpectedService
  )

  $state = [ordered]@{
    path = $ConfigPath
    present = $false
    tunnel_declared = $false
    credentials_file_declared = $false
    credentials_file_present = $false
    expected_host = $ExpectedHost
    expected_service = $ExpectedService
    route_service = $null
    route_verified = $false
    verified = $false
    inspection_error = $null
  }
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    return $state
  }

  try {
    $configText = Get-Content -Raw -LiteralPath $ConfigPath
    $state.present = -not [string]::IsNullOrWhiteSpace($configText)
    $tunnelMatch = [regex]::Match($configText, "(?m)^\s*tunnel:\s*(?<value>[^#\r\n]+)")
    $credentialsMatch = [regex]::Match($configText, "(?m)^\s*credentials-file:\s*(?<value>[^#\r\n]+)")
    $state.tunnel_declared = $tunnelMatch.Success -and -not [string]::IsNullOrWhiteSpace($tunnelMatch.Groups["value"].Value)
    $state.credentials_file_declared = $credentialsMatch.Success

    if ($credentialsMatch.Success) {
      $credentialsPath = Remove-ConfigValueQuotes $credentialsMatch.Groups["value"].Value
      if (-not [System.IO.Path]::IsPathRooted($credentialsPath)) {
        $credentialsPath = Join-Path (Split-Path -Parent $ConfigPath) $credentialsPath
      }
      $state.credentials_file_present = Test-Path -LiteralPath $credentialsPath -PathType Leaf
    }

    $currentHost = ""
    foreach ($line in @($configText -split "`r?`n")) {
      $hostMatch = [regex]::Match($line, "^\s*-\s*hostname:\s*(?<value>[^#\r\n]+)")
      if ($hostMatch.Success) {
        $currentHost = Remove-ConfigValueQuotes $hostMatch.Groups["value"].Value
        continue
      }
      $serviceMatch = [regex]::Match($line, "^\s*service:\s*(?<value>[^#\r\n]+)")
      if ($serviceMatch.Success -and $currentHost.Equals($ExpectedHost, [StringComparison]::OrdinalIgnoreCase)) {
        $state.route_service = Remove-ConfigValueQuotes $serviceMatch.Groups["value"].Value
        break
      }
    }

    $state.route_verified = (
      $null -ne $state.route_service -and
      ([string]$state.route_service).Equals($ExpectedService, [StringComparison]::OrdinalIgnoreCase)
    )
    $state.verified = (
      $state.present -and
      $state.tunnel_declared -and
      $state.credentials_file_declared -and
      $state.credentials_file_present -and
      $state.route_verified
    )
  } catch {
    $state.inspection_error = "tunnel_config_inspection_failed"
  }
  return $state
}

function Test-PowerShellFileSyntax {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $Path,
    [ref]$tokens,
    [ref]$parseErrors
  )
  return @($parseErrors).Count -eq 0
}

function Get-EntrypointVerification {
  $result = [ordered]@{
    supervision_entrypoint_verified = $false
    runtime_entrypoint_verified = $false
    tunnel_entrypoint_verified = $false
  }
  if (
    -not (Test-PowerShellFileSyntax -Path $watchdogScript) -or
    -not (Test-PowerShellFileSyntax -Path $policyScript)
  ) {
    return $result
  }

  $watchdogSource = Get-Content -Raw -LiteralPath $watchdogScript
  $policyLoaded = $watchdogSource -match '(?m)^\.\s+\(Join-Path\s+\$PSScriptRoot\s+"local-live-watchdog-policy\.ps1"\)\s*$'
  $runtimeAssigned = $watchdogSource -match '(?m)^\$runtimeScript\s*=\s*Join-Path\s+\$RuntimeRepoRoot\s+"tools/local-live-primary-runtime\.ps1"\s*$'
  $tunnelAssigned = $watchdogSource -match '(?m)^\$tunnelScript\s*=\s*Join-Path\s+\$RepoRoot\s+"tools/local-live-cloudflared-tunnel\.ps1"\s*$'
  $runtimeInvoked = $watchdogSource -match '(?s)Start-Process\s+-FilePath\s+"powershell\.exe"\s+`\s*\r?\n\s*-ArgumentList\s+@\(.{0,300}?"-File",\s*\$runtimeScript(?:,|\))'
  $tunnelInvoked = $watchdogSource -match '(?s)Start-Process\s+-FilePath\s+"powershell\.exe"\s+`\s*\r?\n\s*-ArgumentList\s+@\(.{0,400}?"-File",\s*\$tunnelScript,\s*"-ConfigPath",\s*\$TunnelConfigPath\)'
  $result.supervision_entrypoint_verified = (
    $policyLoaded -and
    $runtimeAssigned -and
    $tunnelAssigned -and
    $runtimeInvoked -and
    $tunnelInvoked
  )

  if (Test-PowerShellFileSyntax -Path $runtimeEntrypoint) {
    $runtimeSource = Get-Content -Raw -LiteralPath $runtimeEntrypoint
    $result.runtime_entrypoint_verified = (
      $result.supervision_entrypoint_verified -and
      $runtimeSource -match '-ArgumentList\s+@\("server\.js",\s*"--protected-primary-runtime"\)' -and
      $runtimeSource -match '-WindowStyle\s+Hidden'
    )
  }

  if (Test-PowerShellFileSyntax -Path $tunnelEntrypoint) {
    $tunnelSource = Get-Content -Raw -LiteralPath $tunnelEntrypoint
    $result.tunnel_entrypoint_verified = (
      $result.supervision_entrypoint_verified -and
      $tunnelSource -match '\[string\]\$ConfigPath' -and
      $tunnelSource -match '-ArgumentList\s+@\("tunnel",\s*"--config",\s*\$ConfigPath,\s*"run"\)' -and
      $tunnelSource -match '-WindowStyle\s+Hidden'
    )
  }
  return $result
}

function Protect-CommandArguments {
  param([string]$Arguments)
  if (-not $Arguments) {
    return ""
  }
  $secretPattern = "(?i)(?<key>(?:--?|\b)(?:api[_-]?token|access[_-]?token|client[_-]?secret|webhook(?:_url)?|password|secret))(?<separator>\s+|=)(?<value>`"[^`"]*`"|'[^']*'|[^\s]+)"
  return [regex]::Replace($Arguments, $secretPattern, '${key}${separator}<redacted>')
}

function Get-TaskTriggerNames {
  param($Triggers)
  $names = @()
  foreach ($trigger in @($Triggers)) {
    $className = [string]$trigger.CimClass.CimClassName
    if ($className -match "BootTrigger") {
      $names += "AtStartup"
    } elseif ($className -match "LogonTrigger") {
      $names += "AtLogOn"
    } elseif ($className -match "TimeTrigger") {
      $names += "Once"
    } else {
      $names += $(if ($className) { $className } else { "Unknown" })
    }
  }
  return @($names)
}

function Get-PulseStartupShortcuts {
  $descriptors = @()
  $startupDirectories = @(
    [Environment]::GetFolderPath("Startup"),
    [Environment]::GetFolderPath("CommonStartup")
  ) | Where-Object { $_ } | Select-Object -Unique

  $shell = $null
  try {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($directory in $startupDirectories) {
      if (-not (Test-Path -LiteralPath $directory)) {
        continue
      }
      foreach ($shortcutFile in @(Get-ChildItem -LiteralPath $directory -Filter "*.lnk" -File -ErrorAction SilentlyContinue)) {
        try {
          $shortcut = $shell.CreateShortcut($shortcutFile.FullName)
          $identity = "{0} {1} {2}" -f $shortcutFile.Name, $shortcut.TargetPath, $shortcut.Arguments
          if ($identity -notmatch "(?i)(pulse.*(?:gaming|watchdog)|local[_-]live[_-]watchdog)") {
            continue
          }
          $descriptors += [ordered]@{
            path = $shortcutFile.FullName
            target = [string]$shortcut.TargetPath
            arguments = Protect-CommandArguments ([string]$shortcut.Arguments)
          }
        } catch {
          $descriptors += [ordered]@{
            path = $shortcutFile.FullName
            target = ""
            arguments = ""
            inspection_error = "shortcut_inspection_failed"
          }
        }
      }
    }
  } finally {
    if ($shell) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
  }
  return @($descriptors)
}

function Get-SupervisionStartTimes {
  param(
    [string]$LogPath,
    [string]$BootTimeUtc
  )
  $bootIso = Convert-ToUtcIso $BootTimeUtc
  if (-not $bootIso -or -not (Test-Path -LiteralPath $LogPath)) {
    return @()
  }

  $boot = [DateTimeOffset]::Parse($bootIso).ToUniversalTime()
  $starts = @()
  foreach ($line in @(Get-Content -LiteralPath $LogPath -Tail 10000 -ErrorAction SilentlyContinue)) {
    if ($line -notmatch "^(?<stamp>\S+)\s+watchdog_start\b") {
      continue
    }
    $stampIso = Convert-WatchdogLogTimestampToUtcIso $Matches.stamp
    if (-not $stampIso) {
      continue
    }
    $stamp = [DateTimeOffset]::Parse($stampIso).ToUniversalTime()
    if ($stamp -ge $boot) {
      $starts += $stampIso
    }
  }
  return @($starts | Sort-Object -Unique)
}

function Get-LiveProbe {
  $probeErrors = @()
  $now = (Get-Date).ToUniversalTime()
  $bootTime = $null
  try {
    $bootTime = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime()
  } catch {
    $probeErrors += "boot_time_probe_failed"
  }

  $tasks = @()
  try {
    foreach ($task in @(Get-ScheduledTask -ErrorAction Stop)) {
      $matchingAction = @($task.Actions | Where-Object {
        ("{0} {1}" -f $_.Execute, $_.Arguments) -match "(?i)local[_-]live[_-]watchdog"
      })
      if ($task.TaskName -ne $TaskName -and $matchingAction.Count -eq 0) {
        continue
      }

      $taskInfo = $null
      try {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
      } catch {
        $taskInfo = $null
      }
      $primaryAction = @($task.Actions | Select-Object -First 1)
      $tasks += [ordered]@{
        task_name = [string]$task.TaskName
        task_path = [string]$task.TaskPath
        state = [string]$task.State
        triggers = @(Get-TaskTriggerNames -Triggers $task.Triggers)
        execute = $(if ($primaryAction.Count -gt 0) { [string]$primaryAction[0].Execute } else { "" })
        arguments = $(if ($primaryAction.Count -gt 0) { Protect-CommandArguments ([string]$primaryAction[0].Arguments) } else { "" })
        working_directory = $(if ($primaryAction.Count -gt 0) { [string]$primaryAction[0].WorkingDirectory } else { "" })
        user_id = [string]$task.Principal.UserId
        logon_type = [string]$task.Principal.LogonType
        run_level = [string]$task.Principal.RunLevel
        settings = [ordered]@{
          multiple_instances = [string]$task.Settings.MultipleInstances
          start_when_available = [bool]$task.Settings.StartWhenAvailable
          restart_count = [int]$task.Settings.RestartCount
          restart_interval = [string]$task.Settings.RestartInterval
          execution_time_limit = [string]$task.Settings.ExecutionTimeLimit
        }
        last_run_time_utc = $(if ($taskInfo) { Convert-ToUtcIso -Value $taskInfo.LastRunTime } else { $null })
        last_task_result = $(if ($taskInfo) { [int64]($taskInfo.LastTaskResult) } else { $null })
      }
    }
  } catch {
    $probeErrors += "scheduled_task_probe_failed"
  }

  $shortcuts = @()
  try {
    $shortcuts = @(Get-PulseStartupShortcuts)
  } catch {
    $probeErrors += "startup_shortcut_probe_failed"
  }

  $watchdogProcesses = @()
  try {
    $watchdogLeafPattern = [regex]::Escape([System.IO.Path]::GetFileName($watchdogScript))
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
      $commandLine = [string]$process.CommandLine
      if ($commandLine -notmatch "(?i)(?:^|[\\/\s`"'])$watchdogLeafPattern(?:$|[\s`"'])") {
        continue
      }
      $watchdogProcesses += [ordered]@{
        pid = [int]$process.ProcessId
        parent_pid = [int]$process.ParentProcessId
        name = [string]$process.Name
        executable_path = [string]$process.ExecutablePath
        command_line = $commandLine
      }
    }
  } catch {
    $probeErrors += "watchdog_process_probe_failed"
  }

  $runtimeHealth = [ordered]@{
    status = "unavailable"
    scheduler_active = $false
    auto_publish = $false
    use_job_queue = $false
    dispatch_mode = ""
  }
  try {
    $health = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 3 -UseBasicParsing
    $runtimeHealth.status = [string]$health.status
    $runtimeHealth.scheduler_active = [bool]$health.schedulerActive
    $runtimeHealth.auto_publish = [bool]$health.runtime.auto_publish
    $runtimeHealth.use_job_queue = (
      ([string]$health.runtime.use_job_queue_explicit).ToLowerInvariant() -eq "true" -or
      [bool]$health.runtime.use_job_queue
    )
    $runtimeHealth.dispatch_mode = [string]$health.runtime.dispatch.mode
  } catch {
    $probeErrors += "runtime_health_probe_failed"
  }

  $logoffEvents = @()
  if ($bootTime) {
    try {
      $logoffEvents = @(
        Get-WinEvent -FilterHashtable @{
          LogName = "Microsoft-Windows-TerminalServices-LocalSessionManager/Operational"
          Id = 23
          StartTime = $bootTime.ToLocalTime()
        } -ErrorAction Stop |
          ForEach-Object { Convert-ToUtcIso -Value $_.TimeCreated } |
          Where-Object { $_ } |
          Sort-Object -Unique
      )
    } catch {
      if (-not (Test-NoMatchingWindowsEventError $_)) {
        $probeErrors += "logoff_event_probe_failed"
      }
    }
  } else {
    $probeErrors += "logoff_event_probe_skipped_boot_unknown"
  }

  $tunnelRuntime = [ordered]@{
    status = "unavailable"
    matching_process_count = 0
  }
  try {
    $configLeaf = [System.IO.Path]::GetFileName($TunnelConfigPath)
    $matchingTunnelProcesses = @(
      Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" -ErrorAction Stop |
        Where-Object { ([string]$_.CommandLine) -like "*$configLeaf*" }
    )
    $tunnelRuntime.matching_process_count = $matchingTunnelProcesses.Count
    $tunnelRuntime.status = $(if ($matchingTunnelProcesses.Count -gt 0) { "running" } else { "stopped" })
  } catch {
    $probeErrors += "tunnel_process_probe_failed"
  }

  $bootIso = Convert-ToUtcIso -Value $bootTime
  return [ordered]@{
    generated_at_utc = $now.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    now_utc = $now.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    boot_time_utc = $bootIso
    scheduled_tasks = @($tasks)
    startup_shortcuts = @($shortcuts)
    watchdog_processes = @($watchdogProcesses)
    supervision_start_times_utc = @(Get-SupervisionStartTimes -LogPath (Join-Path $RepoRoot "output/runtime/pulse-live-watchdog.log") -BootTimeUtc $bootIso)
    logoff_events_utc = @($logoffEvents)
    runtime_health = $runtimeHealth
    tunnel_runtime = $tunnelRuntime
    probe_errors = @($probeErrors)
  }
}

function Get-MissedWindowEvidence {
  param($Probe)

  $bootIso = Convert-ToUtcIso $Probe.boot_time_utc
  $nowIso = Convert-ToUtcIso $Probe.now_utc
  if (-not $bootIso -or -not $nowIso) {
    return [ordered]@{
      schema_version = 2
      generated_at_utc = $nowIso
      boot_time_utc = $bootIso
      evaluation_status = "not_evaluated"
      schedule_timezone = "UTC"
      publish_window_minutes_utc = @($publishWindowMinutesUtc)
      evaluated_count = 0
      missed_count = 0
      covered_by_supervision_count = 0
      windows = @()
      covered_windows = @()
      proof_scope = "machine_boot_supervision_only"
      disclaimer = "Boot time was unavailable, so missed windows were not inferred."
    }
  }

  $boot = [DateTimeOffset]::Parse($bootIso).ToUniversalTime()
  $now = [DateTimeOffset]::Parse($nowIso).ToUniversalTime()
  $startTimes = @(
    @($Probe.supervision_start_times_utc) |
      ForEach-Object {
        try { [DateTimeOffset]::Parse([string]$_).ToUniversalTime() } catch { $null }
      } |
      Where-Object { $null -ne $_ -and $_ -ge $boot } |
      Sort-Object
  )
  $firstSupervisionStart = $(if ($startTimes.Count -gt 0) { $startTimes[0] } else { $null })

  $missed = @()
  $covered = @()
  $day = $boot.UtcDateTime.Date
  $lastDay = $now.UtcDateTime.Date
  while ($day -le $lastDay) {
    foreach ($minute in $publishWindowMinutesUtc) {
      $window = [DateTimeOffset]::new($day.AddMinutes($minute), [TimeSpan]::Zero)
      if ($window -lt $boot -or $window -gt $now) {
        continue
      }
      $entry = [ordered]@{
        window_utc = $window.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        boot_time_utc = $boot.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        first_supervision_start_utc = $(if ($firstSupervisionStart) { $firstSupervisionStart.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") } else { $null })
      }
      if (-not $firstSupervisionStart) {
        $entry.reason = "no_supervision_start_evidence"
        $missed += $entry
      } elseif ($firstSupervisionStart -gt $window) {
        $entry.reason = "supervision_started_after_window"
        $missed += $entry
      } else {
        $entry.reason = "supervision_available_before_window"
        $covered += $entry
      }
    }
    $day = $day.AddDays(1)
  }

  return [ordered]@{
    schema_version = 2
    generated_at_utc = $nowIso
    boot_time_utc = $bootIso
    evaluation_status = "evaluated"
    schedule_timezone = "UTC"
    publish_window_minutes_utc = @($publishWindowMinutesUtc)
    evaluated_count = $missed.Count + $covered.Count
    missed_count = $missed.Count
    covered_by_supervision_count = $covered.Count
    windows = @($missed)
    covered_windows = @($covered)
    proof_scope = "machine_boot_supervision_only"
    disclaimer = "Supervision availability does not prove that a candidate was publishable or that an external upload occurred."
  }
}

$probe = if ($ProbeFixturePath) {
  Get-Content -Raw -LiteralPath $ProbeFixturePath | ConvertFrom-Json
} else {
  Get-LiveProbe
}

$desiredTasks = @($probe.scheduled_tasks | Where-Object { [string]$_.task_name -eq $TaskName })
$desiredTask = $(if ($desiredTasks.Count -gt 0) { $desiredTasks[0] } else { $null })
$competingTaskOwners = @($probe.scheduled_tasks | Where-Object {
  [string]$_.task_name -ne $TaskName -and
  ("{0} {1}" -f $_.execute, $_.arguments) -match "(?i)local[_-]live[_-]watchdog"
})
$competingStartupShortcuts = @($probe.startup_shortcuts)
$triggers = @($(if ($desiredTask) { $desiredTask.triggers } else { @() }))
$arguments = $(if ($desiredTask) { Protect-CommandArguments ([string]$desiredTask.arguments) } else { "" })
$taskSettings = $(if ($desiredTask) { $desiredTask.settings } else { $null })
$approvedTrigger = (
  $triggers.Count -eq 1 -and
  $triggers -contains "AtStartup"
)
$approvedPrincipal = (
  $desiredTask -and
  [string]$desiredTask.user_id -eq "SYSTEM" -and
  [string]$desiredTask.logon_type -eq "ServiceAccount" -and
  [string]$desiredTask.run_level -eq "Highest"
)
$approvedSettings = (
  $taskSettings -and
  [string]$taskSettings.multiple_instances -eq "IgnoreNew" -and
  [bool]$taskSettings.start_when_available -and
  [int]$taskSettings.restart_count -gt 0 -and
  -not [string]::IsNullOrWhiteSpace([string]$taskSettings.restart_interval) -and
  [string]$taskSettings.execution_time_limit -eq "PT0S"
)
$approvedTaskAction = Test-ApprovedTaskAction `
  -Task $desiredTask `
  -ExpectedPowerShell $approvedPowerShell `
  -ExpectedWatchdog $watchdogScript `
  -ExpectedRepoRoot $RepoRoot `
  -ExpectedRuntimeRepoRoot $RuntimeRepoRoot `
  -ExpectedPort $Port `
  -ExpectedTunnelConfig $TunnelConfigPath
$taskConfigurationVerified = (
  $desiredTask -and
  [string]$desiredTask.task_path -eq "\" -and
  $approvedTrigger -and
  $approvedPrincipal -and
  $approvedSettings -and
  $approvedTaskAction
)
$logoffResilient = (
  $approvedTrigger -and
  $approvedPrincipal -and
  -not ($triggers -contains "AtLogOn")
)

$taskState = [ordered]@{
  exists = [bool]$desiredTask
  task_name = $TaskName
  state = $(if ($desiredTask) { [string]$desiredTask.state } else { "Missing" })
  at_startup = ($triggers -contains "AtStartup")
  has_logon_trigger = ($triggers -contains "AtLogOn")
  noninteractive = ($arguments -match "(?i)(?:^|\s)-NonInteractive(?:\s|$)")
  hidden = ($arguments -match "(?i)-WindowStyle\s+Hidden(?:\s|$)")
  approved_watchdog = $approvedTaskAction
  action_verified = $approvedTaskAction
  trigger_verified = $approvedTrigger
  principal_verified = $approvedPrincipal
  settings_verified = $approvedSettings
  configuration_verified = $taskConfigurationVerified
  logoff_resilient = $logoffResilient
  run_as_system = $(if ($desiredTask) { [string]$desiredTask.user_id -eq "SYSTEM" } else { $false })
  execute = $(if ($desiredTask) { [string]$desiredTask.execute } else { "" })
  arguments = $arguments
  working_directory = $(if ($desiredTask) { [string]$desiredTask.working_directory } else { "" })
  user_id = $(if ($desiredTask) { [string]$desiredTask.user_id } else { "" })
  logon_type = $(if ($desiredTask) { [string]$desiredTask.logon_type } else { "" })
  run_level = $(if ($desiredTask) { [string]$desiredTask.run_level } else { "" })
  settings = [ordered]@{
    multiple_instances = $(if ($taskSettings) { [string]$taskSettings.multiple_instances } else { "" })
    start_when_available = $(if ($taskSettings) { [bool]$taskSettings.start_when_available } else { $false })
    restart_count = $(if ($taskSettings) { [int]$taskSettings.restart_count } else { 0 })
    restart_interval = $(if ($taskSettings) { [string]$taskSettings.restart_interval } else { "" })
    execution_time_limit = $(if ($taskSettings) { [string]$taskSettings.execution_time_limit } else { "" })
  }
  last_run_time_utc = $(if ($desiredTask) { Convert-ToUtcIso -Value $desiredTask.last_run_time_utc } else { $null })
  last_task_result = $(if ($desiredTask) { $desiredTask.last_task_result } else { $null })
}

$approvedWatchdogProcessOwners = @()
$competingProcessOwners = @()
foreach ($process in @($probe.watchdog_processes)) {
  $verification = Get-WatchdogProcessVerification `
    -Process $process `
    -ExpectedPowerShell $approvedPowerShell `
    -ExpectedWatchdog $watchdogScript `
    -ExpectedRepoRoot $RepoRoot `
    -ExpectedRuntimeRepoRoot $RuntimeRepoRoot `
    -ExpectedPort $Port `
    -ExpectedTunnelConfig $TunnelConfigPath
  $descriptor = [ordered]@{
    pid = [int]$process.pid
    parent_pid = [int]$process.parent_pid
    name = [string]$process.name
    executable_path = [string]$process.executable_path
    command_line = Protect-CommandArguments ([string]$process.command_line)
  }
  if ([bool]$verification.approved) {
    $approvedWatchdogProcessOwners += $descriptor
  } else {
    $descriptor.rejection_reasons = @($verification.rejection_reasons)
    $competingProcessOwners += $descriptor
  }
}
$watchdogProcessProbeFailed = @(
  $probe.probe_errors |
    Where-Object { [string]$_ -eq "watchdog_process_probe_failed" }
).Count -gt 0
$watchdogProcessOwnershipHealthy = (
  -not $watchdogProcessProbeFailed -and
  $approvedWatchdogProcessOwners.Count -eq 1 -and
  $competingProcessOwners.Count -eq 0
)
$watchdogProcessOwnershipConflict = (
  $approvedWatchdogProcessOwners.Count -gt 1 -or
  $competingProcessOwners.Count -gt 0
)

$entrypointVerification = Get-EntrypointVerification
$tunnelConfigVerification = Get-TunnelConfigVerification `
  -ConfigPath $TunnelConfigPath `
  -ExpectedHost $ExpectedTunnelHost `
  -ExpectedService $ExpectedTunnelService
$oneOwner = (
  $desiredTasks.Count -eq 1 -and
  $competingTaskOwners.Count -eq 0 -and
  $competingStartupShortcuts.Count -eq 0
)
$runtimeHealth = $probe.runtime_health
$runtimeHealthy = (
  [string]$runtimeHealth.status -eq "ok" -and
  [bool]$runtimeHealth.scheduler_active -and
  [bool]$runtimeHealth.auto_publish -and
  [bool]$runtimeHealth.use_job_queue -and
  [string]$runtimeHealth.dispatch_mode -eq "queue"
)
$tunnelRuntime = $probe.tunnel_runtime
$tunnelRunning = (
  [string]$tunnelRuntime.status -eq "running" -and
  [int]$tunnelRuntime.matching_process_count -eq 1
)
$configurationHealthy = (
  $oneOwner -and
  $taskConfigurationVerified -and
  [bool]$entrypointVerification.supervision_entrypoint_verified -and
  [bool]$entrypointVerification.runtime_entrypoint_verified -and
  [bool]$entrypointVerification.tunnel_entrypoint_verified -and
  [bool]$tunnelConfigVerification.verified
)

$missedWindowEvidence = Get-MissedWindowEvidence -Probe $probe
$bootIso = Convert-ToUtcIso $probe.boot_time_utc
$nowIso = Convert-ToUtcIso $probe.now_utc
$supervisionStartTimes = @(
  @($probe.supervision_start_times_utc) |
    ForEach-Object { Convert-ToUtcIso $_ } |
    Where-Object { $_ } |
    Sort-Object -Unique
)
$logoffEvents = @(
  @($probe.logoff_events_utc) |
    ForEach-Object { Convert-ToUtcIso $_ } |
    Where-Object { $_ } |
    Sort-Object -Unique
)
$taskLastRunSinceBoot = $null
$supervisionStartSinceBoot = $null
if ($bootIso) {
  $bootInstant = [DateTimeOffset]::Parse($bootIso).ToUniversalTime()
  $taskLastRunSinceBoot = (
    $taskState.last_run_time_utc -and
    [DateTimeOffset]::Parse([string]$taskState.last_run_time_utc).ToUniversalTime() -ge $bootInstant
  )
  $supervisionStartSinceBoot = @(
    $supervisionStartTimes |
      Where-Object { [DateTimeOffset]::Parse($_).ToUniversalTime() -ge $bootInstant }
  ).Count -gt 0
}
$logoffProbeUnknown = (
  -not $bootIso -or
  @($probe.probe_errors | Where-Object {
    [string]$_ -in @("logoff_event_probe_failed", "logoff_event_probe_skipped_boot_unknown")
  }).Count -gt 0
)
$logoffStatus = if ($logoffProbeUnknown) {
  "unknown"
} elseif ($logoffEvents.Count -gt 0) {
  "observed"
} else {
  "none_observed"
}
$schedulerTaskReportsRunning = [string]$taskState.state -eq "Running"
$supervisorRunning = (
  $taskConfigurationVerified -and
  $watchdogProcessOwnershipHealthy
)
$verdict = if (-not $configurationHealthy -or $watchdogProcessOwnershipConflict) {
  "red"
} elseif (
  $missedWindowEvidence.missed_count -gt 0 -or
  -not $runtimeHealthy -or
  -not $tunnelRunning -or
  -not $supervisorRunning -or
  @($probe.probe_errors).Count -gt 0
) {
  "amber"
} else {
  "green"
}
$guardReady = (
  $configurationHealthy -and
  $runtimeHealthy -and
  $tunnelRunning -and
  $supervisorRunning -and
  @($probe.probe_errors).Count -eq 0
)

$status = [ordered]@{
  schema_version = 3
  generated_at_utc = $nowIso
  verdict = $verdict
  guard_ready = $guardReady
  one_owner = $oneOwner
  watchdog_process_probe_status = $(if ($watchdogProcessProbeFailed) { "unknown" } else { "complete" })
  watchdog_process_owner_count = $approvedWatchdogProcessOwners.Count + $competingProcessOwners.Count
  active_approved_watchdog_owner_count = $approvedWatchdogProcessOwners.Count
  active_approved_watchdog_owners = @($approvedWatchdogProcessOwners)
  competing_process_owner_count = $competingProcessOwners.Count
  competing_process_owners = @($competingProcessOwners)
  approved_supervision_entrypoint = $watchdogScript
  supervisor_repo_root = $RepoRoot
  runtime_repo_root = $RuntimeRepoRoot
  approved_supervision_entrypoint_verified = [bool]$entrypointVerification.supervision_entrypoint_verified
  approved_runtime_entrypoint = $runtimeEntrypoint
  approved_runtime_entrypoint_verified = [bool]$entrypointVerification.runtime_entrypoint_verified
  approved_tunnel_entrypoint = $tunnelEntrypoint
  approved_tunnel_entrypoint_verified = [bool]$entrypointVerification.tunnel_entrypoint_verified
  autostart_configuration = [ordered]@{
    verified = $configurationHealthy
    one_owner = $oneOwner
    task_action_verified = $approvedTaskAction
    task_configuration_verified = $taskConfigurationVerified
    supervision_entrypoint_verified = [bool]$entrypointVerification.supervision_entrypoint_verified
    runtime_entrypoint_verified = [bool]$entrypointVerification.runtime_entrypoint_verified
    tunnel_entrypoint_verified = [bool]$entrypointVerification.tunnel_entrypoint_verified
    tunnel_config_verified = [bool]$tunnelConfigVerification.verified
  }
  task = $taskState
  competing_startup_shortcut_count = $competingStartupShortcuts.Count
  competing_startup_shortcuts = @($competingStartupShortcuts | ForEach-Object {
    [ordered]@{
      path = [string]$_.path
      target = [string]$_.target
      arguments = Protect-CommandArguments ([string]$_.arguments)
    }
  })
  competing_task_owner_count = $competingTaskOwners.Count
  competing_task_owners = @($competingTaskOwners | ForEach-Object {
    [ordered]@{
      task_name = [string]$_.task_name
      task_path = [string]$_.task_path
      execute = [string]$_.execute
      arguments = Protect-CommandArguments ([string]$_.arguments)
    }
  })
  runtime_health = [ordered]@{
    status = [string]$runtimeHealth.status
    scheduler_active = [bool]$runtimeHealth.scheduler_active
    auto_publish = [bool]$runtimeHealth.auto_publish
    use_job_queue = [bool]$runtimeHealth.use_job_queue
    dispatch_mode = [string]$runtimeHealth.dispatch_mode
  }
  tunnel_runtime = [ordered]@{
    status = $(if ($tunnelRuntime) { [string]$tunnelRuntime.status } else { "unavailable" })
    matching_process_count = $(if ($tunnelRuntime) { [int]$tunnelRuntime.matching_process_count } else { 0 })
    verified = $tunnelRunning
  }
  tunnel_config = $tunnelConfigVerification
  boot_time_utc = $bootIso
  boot_observation = [ordered]@{
    status = $(if ($bootIso) { "observed" } else { "unknown" })
    boot_time_utc = $bootIso
    source = "Win32_OperatingSystem.LastBootUpTime"
  }
  logoff_observation = [ordered]@{
    status = $logoffStatus
    event_count_since_boot = $logoffEvents.Count
    events_utc = @($logoffEvents)
    source = "Microsoft-Windows-TerminalServices-LocalSessionManager/Operational:event_23"
  }
  continuity = [ordered]@{
    task_last_run_since_boot = $taskLastRunSinceBoot
    supervision_start_since_boot = $supervisionStartSinceBoot
    scheduler_task_reports_running = $schedulerTaskReportsRunning
    supervisor_task_running = $supervisorRunning
    exactly_one_approved_watchdog_process = $watchdogProcessOwnershipHealthy
    logoff_resilient_configuration = $logoffResilient
    claim_scope = "Observed events and configuration only; no uninterrupted runtime claim is inferred."
  }
  supervision_start_times_utc = @($supervisionStartTimes)
  missed_window_count_since_boot = [int]$missedWindowEvidence.missed_count
  missed_window_evidence_path = $MissedWindowEvidencePath
  probe_errors = @($probe.probe_errors)
  safety = [ordered]@{
    read_only = $true
    task_scheduler_mutated = $false
    runtime_touched = $false
    token_values_collected = $false
    oauth_or_tokens_mutated = $false
    publishing_attempted = $false
    production_db_mutated = $false
  }
}

Write-JsonAtomic -Value $missedWindowEvidence -Path $MissedWindowEvidencePath
Write-JsonAtomic -Value $status -Path $StatusPath

if ($Json) {
  $status | ConvertTo-Json -Depth 12
} else {
  Write-Output ("Machine boot supervision: {0}" -f $status.verdict.ToUpperInvariant())
  Write-Output ("Configured owner: {0}; approved process owners: {1}; competing process owners: {2}" -f $status.one_owner, $status.active_approved_watchdog_owner_count, $status.competing_process_owner_count)
  Write-Output ("AtStartup: {0}; supervisor running: {1}; missed since boot: {2}" -f $status.task.at_startup, $status.continuity.supervisor_task_running, $status.missed_window_count_since_boot)
  Write-Output ("Status: {0}" -f $StatusPath)
  Write-Output ("Missed-window evidence: {0}" -f $MissedWindowEvidencePath)
}
