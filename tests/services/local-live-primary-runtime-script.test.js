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

test("local live primary runtime launcher defers restarts while publish jobs are actively claimed", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /Get-ActivePublishJobs/);
  assert.match(
    script,
    /kind IN \('publish_schedule_recovery_monitor','publish_runway_generate','publish','publish_window_watchdog'\)/,
  );
  assert.match(script, /lease_until/);
  assert.match(script, /ConvertFrom-Json/);
  assert.match(script, /PSObject\.Properties\["id"\]/);
  assert.doesNotMatch(script, /return @\(\$raw \| ConvertFrom-Json\)/);
  assert.match(script, /restart_deferred_active_publish_jobs/);
  assert.match(script, /PULSE_ALLOW_RUNTIME_RESTART_DURING_PUBLISH/);
  assert.match(script, /exit 0/);
});

test("local live primary runtime launcher preserves guarded queue runtime env", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\$env:AUTO_PUBLISH = "true"/);
  assert.match(script, /\$env:USE_JOB_QUEUE = "true"/);
  assert.match(script, /\$env:PULSE_PRIMARY_INSTANCE = "true"/);
  assert.match(script, /\$env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true"/);
  assert.match(script, /\$env:PULSE_EMERGENCY_KILL_SWITCH = "clear"/);
  assert.match(script, /\$env:TIKTOK_AUTH_CHECK_ENABLED = "true"/);
  assert.match(script, /\$env:PULSE_GUARDED_EXECUTOR_PLAN_PATH = "output\/goal-contract\/guarded_dispatch_executor_plan\.json"/);
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
