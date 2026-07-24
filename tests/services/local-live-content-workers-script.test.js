"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "tools", "local-live-content-workers.ps1");
const TASK_WRAPPER_PATH = path.join(ROOT, "tools", "local-content-worker-task.ps1");

test("local live content worker launcher starts durable non-publish worker lanes", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  for (const workerId of [
    "local-publish-prep",
    "local-content-runway",
    "local-content-refill",
    "local-content-repair",
    "local-content-produce",
    "local-content-ops",
    "local-content-learning",
  ]) {
    assert.match(script, new RegExp(workerId));
  }

  assert.match(script, /tools\/local-content-worker-task\.ps1/);
  assert.match(script, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(script, /CurrentDirectory = \$RepoRoot/);
  assert.match(script, /ReturnValue -ne 0/);
  assert.match(script, /worker_launch_failed/);
  assert.match(script, /worker_started id=\{0\} pid=\{1\}/);
  assert.match(script, /publish_runway_generate/);
  assert.match(
    script,
    /Id = "local-content-runway"[\s\S]*?Kinds = "candidate_supply_monitor"/,
  );
  assert.match(
    script,
    /Id = "local-content-refill"[\s\S]*?Kinds = "fresh_production_refill"/,
  );
  assert.match(
    script,
    /Id = "local-content-produce"[\s\S]*?Kinds = "produce"/,
  );
  assert.doesNotMatch(
    script,
    /Kinds = "candidate_supply_monitor,fresh_production_refill"/,
  );
});

test("local live content worker launcher does not include publish or credential jobs", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.doesNotMatch(script, /"publish"/);
  assert.doesNotMatch(script, /"publish_window_watchdog"/);
  assert.doesNotMatch(script, /instagram_token_refresh/);
  assert.doesNotMatch(script, /tiktok_auth_check/);
});

test("local live content worker launcher can safely restart only its own worker ids", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\[switch\]\$Restart/);
  assert.match(script, /local-sqlite-content-worker\.js/);
  assert.match(script, /Stop-Process -Id \$process\.ProcessId -Force/);
  assert.match(script, /Refusing to stop/);
  assert.match(script, /local-content-runway/);
});

test("local live content worker launcher can rotate one validated lane without stopping peers", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\[ValidateSet\([\s\S]*"local-content-runway"[\s\S]*\)\]/);
  assert.match(script, /\[string\]\$OnlyWorkerId\s*=\s*""/);
  assert.match(
    script,
    /\$lanes\s*=\s*@\(\s*\$lanes\s*\|\s*Where-Object\s*\{[\s\S]*\$OnlyWorkerId[\s\S]*\}\s*\)/,
  );
  assert.match(script, /worker_lane_filter id=\{0\}/);
});

test("local live content worker launcher replaces only exact owned workers with stale kinds", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /function Get-ContentWorkerCommandLineArgument/);
  assert.match(script, /function ConvertTo-NormalizedContentWorkerKinds/);
  assert.match(script, /function Get-ManagedContentWorkerScriptPaths/);
  assert.match(script, /pulse-gaming-live/);
  assert.match(
    script,
    /Get-ContentWorkerCommandLineArgument[\s\S]*-Name "worker-id"/,
  );
  assert.match(
    script,
    /Get-ContentWorkerCommandLineArgument[\s\S]*-Name "kinds"/,
  );
  assert.match(script, /\$managedWorkerScriptPaths/);
  assert.match(script, /\[System\.IO\.Path\]::GetFullPath/);
  assert.match(
    script,
    /Test-ContentWorkerProcessOwnership -Process \$_ -WorkerId \$WorkerId/,
  );
  assert.match(script, /\[System\.StringComparison\]::Ordinal/);
  assert.match(
    script,
    /\$expectedKinds = ConvertTo-NormalizedContentWorkerKinds -Kinds \$kinds/,
  );
  assert.match(
    script,
    /\$actualKinds = ConvertTo-NormalizedContentWorkerKinds -Kinds \$actualKindsArgument/,
  );
  assert.match(
    script,
    /worker_stale_configuration[\s\S]*Stop-ContentWorkerProcess -WorkerId \$workerId -Process \$process[\s\S]*worker_noop_current/,
  );
  assert.match(script, /worker_duplicate_configuration/);
  assert.match(script, /\$preferredCurrent/);
  assert.match(
    script,
    /Test-ContentWorkerProcessScript -Process \$_ -ScriptPath \$workerScript/,
  );
  assert.doesNotMatch(script, /CommandLine -like "\*\$WorkerId\*"/);
});

test("local live content worker launcher serialises concurrent supervisor invocations", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /System\.Threading\.Mutex/);
  assert.match(script, /PulseGamingLiveContentWorkers/);
  assert.match(script, /\.WaitOne\(/);
  assert.match(script, /AbandonedMutexException/);
  assert.match(script, /\.ReleaseMutex\(\)/);
  assert.match(script, /\.Dispose\(\)/);
});

test("content workers reserve foreground capacity for the scheduler and publish runner", () => {
  const wrapper = fs.readFileSync(TASK_WRAPPER_PATH, "utf8");

  assert.match(wrapper, /ProcessPriorityClass\]::BelowNormal/);
  assert.match(wrapper, /ProcessorAffinity/);
  assert.match(wrapper, /PULSE_CONTENT_WORKER_RESOURCE_CLASS\s*=\s*"background"/);
  assert.match(wrapper, /PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT/);
  assert.match(wrapper, /PULSE_CONTENT_WORKER_THREAD_BUDGET/);
  assert.match(wrapper, /OMP_NUM_THREADS/);
  assert.match(wrapper, /OPENBLAS_NUM_THREADS/);
  assert.match(wrapper, /MKL_NUM_THREADS/);
  assert.match(wrapper, /VIPS_CONCURRENCY/);
  assert.match(wrapper, /Start-Process[\s\S]*-PassThru/);
  assert.match(wrapper, /\$process\.WaitForExit\(\)/);
  assert.match(wrapper, /Stop-Process -Id \$process\.Id -Force/);
});

test("content workers evaluate live readiness against the protected runtime checkout", () => {
  const launcher = fs.readFileSync(SCRIPT_PATH, "utf8");
  const wrapper = fs.readFileSync(TASK_WRAPPER_PATH, "utf8");

  assert.match(launcher, /\[string\]\$RuntimeRepoRoot\s*=\s*""/);
  assert.match(launcher, /pulse-gaming-live/);
  assert.match(
    launcher,
    /-RuntimeRepoRoot\s+"\{5\}"[\s\S]*\$RuntimeRepoRoot/,
  );
  assert.match(wrapper, /\[string\]\$RuntimeRepoRoot/);
  assert.match(
    wrapper,
    /\$env:PULSE_APPROVED_RUNTIME_REPO_ROOT\s*=\s*\$RuntimeRepoRoot/,
  );
});
