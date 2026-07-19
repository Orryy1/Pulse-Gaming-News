const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const watchdogPath = path.join(ROOT, "tools", "local-live-watchdog.ps1");
const policyPath = path.join(ROOT, "tools", "local-live-watchdog-policy.ps1");
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const POWERSHELL_TEST_TIMEOUT_MS = 120_000;

function evaluatePolicy(argumentsScript) {
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `. '${policyPath.replaceAll("'", "''")}'; ${argumentsScript} | ConvertTo-Json -Compress`,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: POWERSHELL_TEST_TIMEOUT_MS,
    },
  );

  assert.equal(
    result.status,
    0,
    `PowerShell policy probe failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout.trim());
}

test("local live watchdog counts a timeout from the same verified server before restarting", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $true -HealthOutcome timeout " +
      "-SameServerListener $true -DestructiveRestartCount 0 -RestartThreshold 3 " +
      "-InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "overloaded_or_unresponsive");
  assert.equal(decision.action, "retry");
  assert.equal(decision.destructive_restart_count, 1);
});

test("local live watchdog restarts the same verified server after repeated timeouts", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $true -HealthOutcome timeout " +
      "-SameServerListener $true -DestructiveRestartCount 2 -RestartThreshold 3 " +
      "-InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "overloaded_or_unresponsive");
  assert.equal(decision.action, "restart");
  assert.equal(decision.destructive_restart_count, 3);
});

test("local live watchdog recognises timeout error records without misclassifying other failures", () => {
  const evidence = evaluatePolicy(
    "$timeoutRecord = [System.Management.Automation.ErrorRecord]::new(" +
      "[System.TimeoutException]::new('probe timed out'), 'timeout', " +
      "[System.Management.Automation.ErrorCategory]::OperationTimeout, $null); " +
      "$otherRecord = [System.Management.Automation.ErrorRecord]::new(" +
      "[System.InvalidOperationException]::new('connection failed'), 'failed', " +
      "[System.Management.Automation.ErrorCategory]::ConnectionError, $null); " +
      "[pscustomobject]@{" +
      "timeout = (Test-HealthRequestTimeout -ErrorRecord $timeoutRecord); " +
      "other = (Test-HealthRequestTimeout -ErrorRecord $otherRecord)" +
      "}",
  );

  assert.equal(evidence.timeout, true);
  assert.equal(evidence.other, false);
});

test("local live watchdog overload evidence requires an unchanged verified node server listener", () => {
  const evidence = evaluatePolicy(
    "[pscustomobject]@{" +
      "same = (Test-SameNodeServerListener -BeforeOwnerIds @(4101) " +
      "-AfterOwnerIds @(4101) -VerifiedNodeServerOwnerIds @(4101)); " +
      "changed = (Test-SameNodeServerListener -BeforeOwnerIds @(4101) " +
      "-AfterOwnerIds @(4102) -VerifiedNodeServerOwnerIds @(4102)); " +
      "unverified = (Test-SameNodeServerListener -BeforeOwnerIds @(4101) " +
      "-AfterOwnerIds @(4101) -VerifiedNodeServerOwnerIds @())" +
      "}",
  );

  assert.equal(evidence.same, true);
  assert.equal(evidence.changed, false);
  assert.equal(evidence.unverified, false);
});

test("local live watchdog accepts only a fresh operator-confirmed restart request for the exact listener PID", () => {
  const evidence = evaluatePolicy(
    "$now = [DateTimeOffset]::Parse('2026-07-18T18:00:00Z'); " +
      "$valid = [pscustomobject]@{" +
        "schema_version = 1; request_id = 'range-v1'; operator_confirmed = $true; " +
        "expected_pid = 44340; requested_at_utc = '2026-07-18T17:59:00Z'; " +
        "expires_at_utc = '2026-07-18T18:09:00Z'; reason = 'load_public_media_range_v1'" +
      "}; " +
      "$wrongPid = $valid.PSObject.Copy(); $wrongPid.expected_pid = 44341; " +
      "$expired = $valid.PSObject.Copy(); $expired.expires_at_utc = '2026-07-18T17:59:59Z'; " +
      "[pscustomobject]@{" +
        "valid = (Resolve-WatchdogOperatorRestartRequest -Request $valid -ListenerOwnerIds @(44340) -NowUtc $now); " +
        "wrong_pid = (Resolve-WatchdogOperatorRestartRequest -Request $wrongPid -ListenerOwnerIds @(44340) -NowUtc $now); " +
        "expired = (Resolve-WatchdogOperatorRestartRequest -Request $expired -ListenerOwnerIds @(44340) -NowUtc $now)" +
      "}",
  );

  assert.equal(evidence.valid.approved, true);
  assert.equal(evidence.valid.expected_pid, 44340);
  assert.equal(evidence.wrong_pid.approved, false);
  assert.equal(evidence.wrong_pid.classification, "listener_pid_mismatch");
  assert.equal(evidence.expired.approved, false);
  assert.equal(evidence.expired.classification, "expired");
});

test("local live watchdog starts a missing listener without a destructive restart", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $false -HealthOutcome request_failed " +
      "-SameServerListener $false -DestructiveRestartCount 2 -RestartThreshold 3 " +
      "-InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "runtime_missing");
  assert.equal(decision.action, "start");
  assert.equal(decision.destructive_restart_count, 0);
});

test("local live watchdog reaches restart threshold on an answered invalid runtime policy", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $true " +
      "-HealthOutcome answered_invalid_policy -SameServerListener $true " +
      "-DestructiveRestartCount 2 -RestartThreshold 3 -InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "invalid_runtime_policy");
  assert.equal(decision.action, "restart");
  assert.equal(decision.destructive_restart_count, 3);
});

test("local live watchdog rejects a protected primary with missing build identity", () => {
  const evidence = evaluatePolicy(
    "$health = [pscustomobject]@{" +
      "status = 'ok'; schedulerActive = $true; " +
      "build = [pscustomobject]@{ commit_sha = $null; branch = $null }; " +
      "deployment = [pscustomobject]@{ mode = 'local'; primary = $true }; " +
      "runtime = [pscustomobject]@{" +
        "auto_publish = $true; use_job_queue_explicit = 'true'; " +
        "guarded_live_dispatch_enabled = $true; emergency_kill_switch_clear = $true; " +
        "protected_primary_runtime = $true; safe_observation_mode = $false; " +
        "primary_runtime_hold = $false; dispatch = [pscustomobject]@{ mode = 'queue' }" +
      "}" +
    "}; " +
    "[pscustomobject]@{ healthy = (Test-WatchdogRuntimeHealth -Health $health) }",
  );

  assert.equal(evidence.healthy, false);
});

test("local live watchdog accepts only an identified protected queue primary", () => {
  const evidence = evaluatePolicy(
    "$health = [pscustomobject]@{" +
      "status = 'ok'; schedulerActive = $true; " +
      "build = [pscustomobject]@{ commit_sha = 'abcdef1234567890'; branch = 'codex/live' }; " +
      "deployment = [pscustomobject]@{ mode = 'local'; primary = $true }; " +
      "runtime = [pscustomobject]@{" +
        "auto_publish = $true; use_job_queue_explicit = 'true'; " +
        "guarded_live_dispatch_enabled = $true; emergency_kill_switch_clear = $true; " +
        "protected_primary_runtime = $true; safe_observation_mode = $false; " +
        "primary_runtime_hold = $false; dispatch = [pscustomobject]@{ mode = 'queue' }" +
      "}" +
    "}; " +
    "[pscustomobject]@{ healthy = (Test-WatchdogRuntimeHealth -Health $health) }",
  );

  assert.equal(evidence.healthy, true);
});

test("local live watchdog restarts an unchanged verified server after repeated connection failures", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $true " +
      "-HealthOutcome request_failed -SameServerListener $true " +
      "-DestructiveRestartCount 2 -RestartThreshold 3 -InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "unresponsive_server");
  assert.equal(decision.action, "restart");
  assert.equal(decision.destructive_restart_count, 3);
});

test("local live watchdog does not kill an unverified listener after a connection failure", () => {
  const decision = evaluatePolicy(
    "Resolve-WatchdogRuntimeDecision -ListenerPresent $true " +
      "-HealthOutcome request_failed -SameServerListener $false " +
      "-DestructiveRestartCount 2 -RestartThreshold 3 -InCriticalPublishWindow $false",
  );

  assert.equal(decision.classification, "health_probe_failed");
  assert.equal(decision.action, "none");
  assert.equal(decision.destructive_restart_count, 2);
});

test("local live watchdog rechecks server listener ownership and applies the tested policy", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /local-live-watchdog-policy\.ps1/);
  assert.match(source, /Test-HealthRequestTimeout -ErrorRecord/);
  assert.match(source, /function Get-RuntimeListenerOwners/);
  assert.match(source, /function Get-VerifiedNodeServerOwnerIds/);
  assert.match(source, /Test-WatchdogRuntimeHealth -Health/);
  assert.match(source, /Test-SameNodeServerListener/);
  assert.match(source, /Resolve-WatchdogRuntimeDecision/);
  assert.match(source, /overloaded_or_unresponsive/);
  assert.match(source, /\$decision\.action\s+-eq\s+"restart"/);
  assert.match(source, /pulse-runtime-restart-request\.json/);
  assert.match(source, /Resolve-WatchdogOperatorRestartRequest/);
  assert.match(source, /PULSE_ALLOW_RUNTIME_RESTART_DURING_PUBLISH/);
});

test("local live watchdog checks runtime health and polls quickly enough for publish windows", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /\[int\]\$IntervalSeconds\s*=\s*15\b/);
  assert.match(source, /Invoke-RestMethod[\s\S]+\/api\/health/);
  assert.match(source, /runtime_unhealthy starting_primary_runtime/);
  assert.match(source, /"-Restart"/);
});

test("local live watchdog guards answered invalid policy during critical publish windows", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /\[int\]\$UnhealthyRestartThreshold\s*=\s*3\b/);
  assert.match(source, /\[int\]\$PublishWindowGuardBeforeMinutes\s*=\s*10\b/);
  assert.match(source, /\[int\]\$PublishWindowGuardAfterMinutes\s*=\s*35\b/);
  assert.match(source, /function Test-InCriticalPublishWindow/);
  assert.match(source, /runtime_unhealthy_publish_window_guard skip_restart/);
  assert.match(source, /\$decision\.classification\s+-eq\s+"invalid_runtime_policy"/);
  assert.match(source, /\$destructiveRestartCount/);
});

test("local live watchdog keeps non-publish content workers alive", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /local-live-content-workers\.ps1/);
  assert.match(source, /\$contentWorkersScript/);
  assert.match(source, /content_workers_check ensuring_content_workers/);
  assert.match(source, /-File",\s*\$contentWorkersScript/);
  assert.doesNotMatch(source, /content_workers_check[\s\S]{0,400}"-Restart"/);
});

test("local live watchdog can supervise workers from one checkout while restarting the protected runtime checkout", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /\[string\]\$RuntimeRepoRoot\s*=\s*""/);
  assert.match(source, /\$RuntimeRepoRoot\s*=\s*\$RepoRoot/);
  assert.match(
    source,
    /\$runtimeScript\s*=\s*Join-Path\s+\$RuntimeRepoRoot\s+"tools\/local-live-primary-runtime\.ps1"/,
  );
  assert.match(
    source,
    /"-RepoRoot",\s*\$RuntimeRepoRoot,\s*"-Port"/,
  );
  assert.match(
    source,
    /-WorkingDirectory\s+\$RuntimeRepoRoot/,
  );
  assert.match(
    source,
    /\$contentWorkersScript\s*=\s*Join-Path\s+\$RepoRoot\s+"tools\/local-live-content-workers\.ps1"/,
  );
});
