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
  assert.match(script, /existing_listener_noop/);
  assert.match(script, /-not\s+\$Restart/);
  assert.match(script, /\$process\.CommandLine\s+-notmatch\s+"server\\\.js"/);
  assert.match(script, /Refusing to stop PID \$pidToStop/);
  assert.match(script, /Stop-Process -Id \$pidToStop -Force/);
});

test("local live primary runtime launcher preserves guarded queue runtime env", () => {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert.match(script, /\$env:AUTO_PUBLISH = "true"/);
  assert.match(script, /\$env:USE_JOB_QUEUE = "true"/);
  assert.match(script, /\$env:PULSE_PRIMARY_INSTANCE = "true"/);
  assert.match(script, /\$env:PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true"/);
  assert.match(script, /\$env:PULSE_EMERGENCY_KILL_SWITCH = "clear"/);
  assert.match(script, /\$env:PULSE_GUARDED_EXECUTOR_PLAN_PATH = "output\/goal-contract\/guarded_dispatch_executor_plan\.json"/);
});
