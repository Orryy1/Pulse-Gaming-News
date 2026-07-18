function Test-HealthRequestTimeout {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)

  $exception = $ErrorRecord.Exception
  while ($exception) {
    if ($exception -is [System.TimeoutException]) {
      return $true
    }
    if (
      $exception -is [System.Net.WebException] -and
      $exception.Status -eq [System.Net.WebExceptionStatus]::Timeout
    ) {
      return $true
    }
    if ([string]$exception.Message -match "(?i)timed?\s*out|timeout") {
      return $true
    }
    $exception = $exception.InnerException
  }
  return $false
}

function Convert-WatchdogLogTimestampToUtcIso {
  param([AllowNull()][string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  $text = $Value.Trim()
  try {
    if ($text -match "(?i)(?:Z|[+-]\d{2}:\d{2})$") {
      return ([DateTimeOffset]::Parse(
        $text,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
      )).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }

    # Watchdog logs before this helper used UTC wall time without a zone suffix.
    $legacyUtc = [DateTime]::Parse(
      $text,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AllowWhiteSpaces
    )
    $legacyUtc = [DateTime]::SpecifyKind($legacyUtc, [DateTimeKind]::Utc)
    return ([DateTimeOffset]$legacyUtc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  } catch {
    return $null
  }
}

function Test-NoMatchingWindowsEventError {
  param($ErrorRecord)

  return (
    $null -ne $ErrorRecord -and
    [string]$ErrorRecord.FullyQualifiedErrorId -match "^NoMatchingEventsFound,"
  )
}

function Test-SameNodeServerListener {
  param(
    [int[]]$BeforeOwnerIds,
    [int[]]$AfterOwnerIds,
    [int[]]$VerifiedNodeServerOwnerIds
  )

  $before = @($BeforeOwnerIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
  $after = @($AfterOwnerIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
  $verified = @($VerifiedNodeServerOwnerIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique)

  if ($before.Count -eq 0 -or $before.Count -ne $after.Count) {
    return $false
  }
  if (@(Compare-Object -ReferenceObject $before -DifferenceObject $after).Count -gt 0) {
    return $false
  }
  foreach ($ownerId in $before) {
    if ($verified -notcontains $ownerId) {
      return $false
    }
  }
  return $true
}

function Resolve-WatchdogOperatorRestartRequest {
  param(
    $Request,
    [int[]]$ListenerOwnerIds,
    [DateTimeOffset]$NowUtc = ([DateTimeOffset]::UtcNow)
  )

  function New-RestartRequestDecision {
    param(
      [bool]$Approved,
      [string]$Classification,
      [int]$ExpectedPid = 0,
      [string]$Reason = ""
    )
    return [pscustomobject][ordered]@{
      approved = $Approved
      classification = $Classification
      expected_pid = $ExpectedPid
      reason = $Reason
    }
  }

  if (-not $Request) {
    return New-RestartRequestDecision -Approved $false -Classification "missing"
  }
  if ([int]$Request.schema_version -ne 1) {
    return New-RestartRequestDecision -Approved $false -Classification "unsupported_schema"
  }
  if (-not [bool]$Request.operator_confirmed) {
    return New-RestartRequestDecision -Approved $false -Classification "operator_confirmation_missing"
  }

  $expectedPid = [int]$Request.expected_pid
  $reason = ([string]$Request.reason).Trim()
  $requestId = ([string]$Request.request_id).Trim()
  if ($expectedPid -le 0 -or -not $reason -or -not $requestId) {
    return New-RestartRequestDecision -Approved $false -Classification "invalid_request"
  }

  try {
    $requestedAt = [DateTimeOffset]::Parse(
      [string]$Request.requested_at_utc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
    $expiresAt = [DateTimeOffset]::Parse(
      [string]$Request.expires_at_utc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
  } catch {
    return New-RestartRequestDecision -Approved $false -Classification "invalid_time"
  }

  $now = $NowUtc.ToUniversalTime()
  if ($expiresAt -le $now) {
    return New-RestartRequestDecision -Approved $false -Classification "expired" -ExpectedPid $expectedPid -Reason $reason
  }
  if ($requestedAt -gt $now.AddMinutes(1) -or $requestedAt -lt $now.AddMinutes(-15)) {
    return New-RestartRequestDecision -Approved $false -Classification "stale_or_future" -ExpectedPid $expectedPid -Reason $reason
  }
  if (@($ListenerOwnerIds | Where-Object { $_ -eq $expectedPid }).Count -ne 1) {
    return New-RestartRequestDecision -Approved $false -Classification "listener_pid_mismatch" -ExpectedPid $expectedPid -Reason $reason
  }

  return New-RestartRequestDecision -Approved $true -Classification "operator_restart_requested" -ExpectedPid $expectedPid -Reason $reason
}

function Test-WatchdogRuntimeHealth {
  param($Health)

  if (-not $Health -or -not $Health.runtime -or -not $Health.deployment -or -not $Health.build) {
    return $false
  }

  $statusOk = ([string]$Health.status) -eq "ok"
  $schedulerActive = [bool]$Health.schedulerActive
  $identifiedBuild = (
    -not [string]::IsNullOrWhiteSpace([string]$Health.build.commit_sha) -and
    -not [string]::IsNullOrWhiteSpace([string]$Health.build.branch)
  )
  $approvedPrimary = (
    [string]$Health.deployment.mode -eq "local" -and
    [bool]$Health.deployment.primary -and
    [bool]$Health.runtime.protected_primary_runtime
  )
  $guardedQueue = (
    [bool]$Health.runtime.auto_publish -and
    ([string]$Health.runtime.use_job_queue_explicit).ToLowerInvariant() -eq "true" -and
    [string]$Health.runtime.dispatch.mode -eq "queue" -and
    [bool]$Health.runtime.guarded_live_dispatch_enabled -and
    [bool]$Health.runtime.emergency_kill_switch_clear
  )
  $unheld = (
    -not [bool]$Health.runtime.safe_observation_mode -and
    -not [bool]$Health.runtime.primary_runtime_hold
  )

  return (
    $statusOk -and
    $schedulerActive -and
    $identifiedBuild -and
    $approvedPrimary -and
    $guardedQueue -and
    $unheld
  )
}

function Resolve-WatchdogRuntimeDecision {
  param(
    [bool]$ListenerPresent,
    [ValidateSet("healthy", "answered_invalid_policy", "timeout", "request_failed")]
    [string]$HealthOutcome,
    [bool]$SameServerListener,
    [int]$DestructiveRestartCount,
    [int]$RestartThreshold,
    [bool]$InCriticalPublishWindow
  )

  if (-not $ListenerPresent) {
    return [pscustomobject][ordered]@{
      classification = "runtime_missing"
      action = "start"
      destructive_restart_count = 0
    }
  }

  if ($HealthOutcome -eq "healthy") {
    return [pscustomobject][ordered]@{
      classification = "healthy"
      action = "none"
      destructive_restart_count = 0
    }
  }

  if ($HealthOutcome -eq "timeout") {
    $classification = "listener_changed_or_unverified"
    $action = "none"
    $nextRestartCount = $DestructiveRestartCount
    if ($SameServerListener) {
      $classification = "overloaded_or_unresponsive"
      $nextRestartCount = $DestructiveRestartCount + 1
      $action = if ($nextRestartCount -ge $RestartThreshold) { "restart" } else { "retry" }
    }
    return [pscustomobject][ordered]@{
      classification = $classification
      action = $action
      destructive_restart_count = $nextRestartCount
    }
  }

  if ($HealthOutcome -eq "answered_invalid_policy") {
    $nextRestartCount = $DestructiveRestartCount + 1
    $action = "retry"
    if ($InCriticalPublishWindow) {
      $action = "none"
    } elseif ($nextRestartCount -ge $RestartThreshold) {
      $action = "restart"
    }

    return [pscustomobject][ordered]@{
      classification = "invalid_runtime_policy"
      action = $action
      destructive_restart_count = $nextRestartCount
    }
  }

  if ($HealthOutcome -eq "request_failed" -and $SameServerListener) {
    $nextRestartCount = $DestructiveRestartCount + 1
    $action = if ($nextRestartCount -ge $RestartThreshold) { "restart" } else { "retry" }
    return [pscustomobject][ordered]@{
      classification = "unresponsive_server"
      action = $action
      destructive_restart_count = $nextRestartCount
    }
  }

  return [pscustomobject][ordered]@{
    classification = "health_probe_failed"
    action = "none"
    destructive_restart_count = $DestructiveRestartCount
  }
}
