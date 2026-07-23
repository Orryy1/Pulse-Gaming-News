"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "tools", "local-live-primary-runtime.ps1");

test("local live primary runtime launcher supports explicit safe restart", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\[switch\]\$Restart/);
  assert.match(script, /try\s*\{\s*[\s\S]*Add-Content/);
  assert.match(script, /Logging must never block replacing a stale server process/);
  assert.match(script, /existing_listener_noop/);
  assert.match(script, /-not\s+\$Restart/);
  assert.match(script, /\$process\.CommandLine\s+-notmatch\s+"server\\\.js"/);
  assert.match(script, /Refusing to stop PID \$pidToStop/);
  assert.match(script, /Stop-Process -Id \$pidToStop -Force/);
});

test("local live primary runtime launcher serialises the complete runtime transition", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(
    script,
    /\$runtimeTransitionMutexName\s*=\s*"Local\\PulseGamingPrimaryRuntimeTransition-\{0\}"\s+-f\s+\$Port/,
  );
  assert.match(
    script,
    /\[System\.Threading\.Mutex\]::new\(\$false,\s*\$runtimeTransitionMutexName\)/,
  );
  assert.match(script, /\$runtimeTransitionMutex\.WaitOne\(/);
  assert.match(script, /catch \[System\.Threading\.AbandonedMutexException\]/);
  assert.match(
    script,
    /finally\s*\{[\s\S]*\$runtimeTransitionMutex\.ReleaseMutex\(\)[\s\S]*\$runtimeTransitionMutex\.Dispose\(\)/,
  );

  const waitIndex = script.indexOf("$runtimeTransitionMutex.WaitOne(");
  const listenerIndex = script.indexOf("$existing = Get-NetTCPConnection");
  const verifiedStartIndex = script.indexOf('Write-Output ("node_started');
  const releaseIndex = script.indexOf("$runtimeTransitionMutex.ReleaseMutex()");
  assert.ok(waitIndex < listenerIndex, "mutex must be acquired before listener inspection");
  assert.ok(listenerIndex < verifiedStartIndex, "listener inspection must precede verified start");
  assert.ok(verifiedStartIndex < releaseIndex, "mutex must remain held through start verification");
});

test("local live primary runtime launcher auto-recovers stale matching server runtime", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /Invoke-RestMethod/);
  assert.match(script, /existing_listener_stale_restart/);
  assert.match(script, /existing_listener_noop_current/);
  assert.match(script, /\$Restart = \$true/);
  assert.match(script, /commit_sha/);
  assert.match(script, /branch/);
});

test("local live primary runtime launcher resolves Git when SYSTEM PATH omits it", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /function Resolve-GitExecutable/);
  assert.match(script, /Get-Command "git\.exe"/);
  assert.match(script, /\$env:ProgramFiles/);
  assert.match(script, /Git[\\/]cmd[\\/]git\.exe/);
  assert.match(script, /Test-Path -LiteralPath \$candidate -PathType Leaf/);
  assert.match(script, /& \$gitExecutable -C \$RepoRoot rev-parse HEAD/);
  assert.match(script, /& \$gitExecutable -C \$RepoRoot rev-parse --abbrev-ref HEAD/);
});

test("local live primary runtime launcher reads Git HEAD without changing SYSTEM safe-directory config", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /function Resolve-GitDirectory/);
  assert.match(script, /function Resolve-RepositoryIdentity/);
  assert.match(script, /Get-Content -LiteralPath \$headPath -Raw/);
  assert.match(script, /refs\/heads\//);
  assert.match(script, /packed-refs/);
  assert.match(script, /\$repositoryIdentity = Resolve-RepositoryIdentity -RepositoryRoot \$RepoRoot/);
  assert.doesNotMatch(script, /safe\.directory/);
  assert.doesNotMatch(script, /git config --global/);
});

test("local live primary runtime launcher replaces matching-commit observation mode", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /existing_listener_mode_mismatch_restart/);
  assert.match(script, /schedulerActive/);
  assert.match(script, /auto_publish/);
  assert.match(script, /use_job_queue_explicit/);
  assert.match(script, /dispatch\.mode/);
  assert.match(script, /safe_observation_mode/);
  assert.match(script, /primary_runtime_hold/);
  assert.match(script, /protected_primary_runtime/);
});

test("local live primary runtime launcher defers restarts only while an external publish is actively claimed", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const guardStart = script.indexOf("function Get-ActivePublishJobs");
  const guardEnd = script.indexOf("$runtimeTransitionMutexName", guardStart);
  const guardSource = script.slice(guardStart, guardEnd);

  assert.match(script, /Get-ActivePublishJobs/);
  assert.match(guardSource, /WHERE kind = 'publish'/);
  assert.doesNotMatch(guardSource, /publish_schedule_recovery_monitor/);
  assert.doesNotMatch(guardSource, /publish_runway_generate/);
  assert.doesNotMatch(guardSource, /publish_window_watchdog/);
  assert.match(script, /lease_until/);
  assert.match(script, /ConvertFrom-Json/);
  assert.match(script, /PSObject\.Properties\["id"\]/);
  assert.doesNotMatch(script, /return @\(\$raw \| ConvertFrom-Json\)/);
  assert.match(script, /restart_deferred_active_publish_jobs/);
  assert.doesNotMatch(script, /PULSE_ALLOW_RUNTIME_RESTART_DURING_PUBLISH/);
  assert.match(script, /exit 0/);
  assert.match(guardSource, /active_publish_restart_guard_db_missing/);
  assert.match(guardSource, /active_publish_restart_guard_query_failed/);
  assert.doesNotMatch(guardSource, /return @\(\)/);
});

test("local live primary runtime launcher preserves guarded queue runtime env", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\$env:AUTO_PUBLISH = "true"/);
  assert.match(script, /\$env:USE_JOB_QUEUE = "true"/);
  assert.match(script, /\$env:PULSE_PRIMARY_INSTANCE = "true"/);
  assert.match(script, /\$env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true"/);
  assert.match(script, /\$env:PULSE_EMERGENCY_KILL_SWITCH = "clear"/);
  assert.match(script, /\$env:TIKTOK_AUTH_CHECK_ENABLED = "true"/);
  assert.match(script, /\$env:PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT = \$EvidenceRoot/);
  assert.match(script, /output.*LinkType.*Junction/s);
  assert.match(script, /Refusing publish evidence root/);
  assert.match(script, /\$env:PULSE_GUARDED_EXECUTOR_PLAN_PATH = "output\/goal-contract\/guarded_dispatch_executor_plan\.json"/);
});

test("local live primary runtime launcher isolates guarded publish work from the HTTP process", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\$env:PULSE_MISSED_WINDOW_RECOVERY = "false"/);
  assert.match(script, /\$env:PULSE_PUBLISH_CRITICAL_RUNNER = "false"/);
  assert.match(script, /local-publish-critical-worker\.js/);
  assert.match(script, /pulse-live-publish-critical/);
  assert.match(script, /publish_schedule_recovery_monitor,publish_window_watchdog,publish/);
  assert.match(script, /publish_critical_worker_started/);
  assert.match(script, /publish_critical_worker_noop_current/);
});

test("local live primary runtime launcher recycles the stable publish worker during a safe transition", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const matcherStart = script.indexOf("function Get-PublishCriticalWorkerProcesses");
  const matcherEnd = script.indexOf("function Ensure-PublishCriticalWorker", matcherStart);
  const matcherSource = script.slice(matcherStart, matcherEnd);
  const initialGuardIndex = script.indexOf("$activePublishJobs = @(Get-ActivePublishJobs)");
  const workerStopIndex = script.indexOf(
    "publish_critical_worker_stopping_for_runtime_transition",
  );
  const postStopGuardIndex = script.indexOf(
    "$postWorkerStopActivePublishJobs = @(Get-ActivePublishJobs)",
  );
  const serverStopIndex = script.indexOf("stopping_existing_runtime");

  assert.match(
    matcherSource,
    /tools\[\\\\\/\]local-publish-critical-worker\\\.js/,
  );
  assert.doesNotMatch(
    matcherSource,
    /GetFullPath\(\$publishCriticalWorkerScript\)/,
  );
  assert.match(script, /restart_deferred_publish_worker_race/);
  assert.ok(initialGuardIndex >= 0, "initial active-job guard must exist");
  assert.ok(initialGuardIndex < workerStopIndex, "guard must precede worker stop");
  assert.ok(
    workerStopIndex < postStopGuardIndex,
    "queue must be rechecked after stopping the worker",
  );
  assert.ok(
    postStopGuardIndex < serverStopIndex,
    "post-stop queue guard must precede server stop",
  );
});

test("local live primary runtime launcher can ensure the publish worker without restarting the server", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const ensureStart = script.indexOf("if ($EnsurePublishWorkerOnly)");
  const normalRuntimeStart = script.indexOf(
    "if ($existing -and -not $Restart)",
    ensureStart,
  );
  const ensureSource = script.slice(ensureStart, normalRuntimeStart);

  assert.match(script, /\[switch\]\$EnsurePublishWorkerOnly/);
  assert.match(script, /"\-EnsurePublishWorkerOnly"/);
  assert.match(ensureSource, /publish_worker_ensure_skipped_no_listener/);
  assert.match(ensureSource, /publish_worker_ensure_skipped_runtime_mismatch/);
  assert.match(ensureSource, /Ensure-PublishCriticalWorker/);
  assert.match(ensureSource, /publish_worker_ensure_complete/);
  assert.doesNotMatch(ensureSource, /\$Restart\s*=\s*\$true/);
  assert.doesNotMatch(ensureSource, /Stop-Process/);
});

test("local live primary runtime launcher can safely replace an uninspectable Windows node owner", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /Test-HealthProvesProtectedPrimaryRuntime/);
  assert.match(script, /\$process\.Name -ieq "node\.exe"/);
  assert.match(script, /\$process\.CommandLine -notmatch "server\\\.js"/);
  assert.match(script, /\$Health\.deployment\.mode -eq "local"/);
  assert.match(script, /\$Health\.deployment\.primary/);
  assert.match(script, /\$Health\.runtime\.protected_primary_runtime/);
  assert.match(script, /Refusing to stop PID/);
});

test("local live primary runtime launcher detaches and verifies the Node child", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /Start-Process -FilePath \$nodeExe/);
  assert.match(script, /-WindowStyle Hidden/);
  assert.match(script, /-RedirectStandardOutput \$stdoutPath/);
  assert.match(script, /-RedirectStandardError \$stderrPath/);
  assert.match(script, /started_runtime_failed_health_check/);
  assert.doesNotMatch(script, /& node server\.js/);
});

test("local live primary runtime launcher redirects only through a validated clean selection", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\[switch\]\$RuntimeSelectionPlanOnly/);
  assert.match(script, /approved-runtime-selection\.js/);
  assert.match(script, /pulse-approved-runtime-selection\.json/);
  assert.match(script, /approved_runtime_selection_validation_failed/);
  assert.match(script, /pulse-approved-runtime-selection\.stderr\.log/);
  assert.match(script, /approved_runtime_selection_redirect/);
  assert.match(script, /runtime_entrypoint/);
  assert.match(script, /runtime_repo_root/);
  assert.match(script, /evidence_root/);
  assert.match(script, /-EvidenceRoot/);
  assert.match(script, /-Restart/);
});

test("local live primary runtime launcher records a bounded redacted selected-child failure", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /function Protect-RuntimeLogMessage/);
  assert.match(script, /approved_runtime_selection_child_output/);
  assert.match(script, /approved_runtime_selection_child_failed exit_code=/);
  assert.match(script, /Select-Object -Last 20/);
  assert.match(script, /Substring\(0,\s*1000\)/);
  assert.match(script, /authorization/i);
  assert.match(script, /access_token/i);
  assert.match(script, /refresh_token/i);

  const redirectIndex = script.indexOf(
    "approved_runtime_selection_redirect",
  );
  const childOutputIndex = script.indexOf(
    "approved_runtime_selection_child_output",
  );
  const childFailureIndex = script.indexOf(
    "approved_runtime_selection_child_failed",
  );
  assert.ok(redirectIndex < childOutputIndex);
  assert.ok(childOutputIndex < childFailureIndex);
});
