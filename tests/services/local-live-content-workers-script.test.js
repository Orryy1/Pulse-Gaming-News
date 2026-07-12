"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "tools", "local-live-content-workers.ps1");

test("local live content worker launcher starts durable non-publish worker lanes", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  for (const workerId of [
    "local-content-runway",
    "local-content-repair",
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
