"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertPrimaryRuntimeHoldHealth,
  buildPrimaryRuntimeHoldEnv,
  buildPrimaryRuntimeHoldPowerShellScript,
} = require("../../lib/ops/local-primary-runtime-hold-launcher");
const {
  startPrimaryRuntimeHoldScript,
} = require("../../tools/local-primary-runtime-hold-server");

const ROOT = path.resolve(__dirname, "..", "..");

test("buildPrimaryRuntimeHoldEnv forces primary health without posting side effects", () => {
  const env = buildPrimaryRuntimeHoldEnv({
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "false",
    PULSE_PRIMARY_RUNTIME_HOLD: "false",
    PULSE_SAFE_OBSERVATION_MODE: "true",
    DEPLOYMENT_MODE: "production",
    USE_JOB_QUEUE: "false",
  });

  assert.equal(env.AUTO_PUBLISH, "false");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "true");
  assert.equal(env.PULSE_PRIMARY_RUNTIME_HOLD, "true");
  assert.equal(env.PULSE_SAFE_OBSERVATION_MODE, "false");
  assert.equal(env.DEPLOYMENT_MODE, "local");
  assert.equal(env.USE_JOB_QUEUE, "true");
  assert.equal(env.PULSE_DISABLE_DISCORD_BOT, "true");
});

test("buildPrimaryRuntimeHoldPowerShellScript emits literal env assignments", () => {
  const script = buildPrimaryRuntimeHoldPowerShellScript({
    cwd: ROOT,
    logPath: path.join(ROOT, "test", "output", "local_server_primary_runtime_hold.log"),
  });

  assert.match(script, /\$env:AUTO_PUBLISH='false'/);
  assert.match(script, /\$env:PULSE_PRIMARY_INSTANCE='true'/);
  assert.match(script, /\$env:PULSE_PRIMARY_RUNTIME_HOLD='true'/);
  assert.match(script, /\$env:PULSE_SAFE_OBSERVATION_MODE='false'/);
  assert.match(script, /node server\.js/);
  assert.doesNotMatch(script, /\n='(?:true|false)'/);
});

test("assertPrimaryRuntimeHoldHealth rejects any posting-capable health", () => {
  const report = assertPrimaryRuntimeHoldHealth({
    status: "ok",
    autonomousMode: true,
    schedulerActive: true,
    runtime: {
      auto_publish: true,
      safe_observation_mode: false,
      primary_runtime_hold: false,
    },
    deployment: {
      mode: "local",
      primary: true,
    },
  });

  assert.equal(report.safe, false);
  assert.deepEqual(report.blockers, [
    "runtime.auto_publish is not false",
    "runtime.primary_runtime_hold is not true",
    "schedulerActive is not false",
    "autonomousMode is not false",
  ]);
});

test("ops:local-primary-runtime-hold-server command is registered", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:local-primary-runtime-hold-server"],
    "node tools/local-primary-runtime-hold-server.js",
  );
});

test("startPrimaryRuntimeHoldScript delegates to hidden Windows Start-Process", () => {
  let captured = null;
  const result = startPrimaryRuntimeHoldScript({
    cwd: ROOT,
    scriptPath: "C:\\safe\\primary-hold.ps1",
    spawnImpl(file, args, opts) {
      captured = { file, args, opts };
      return {
        pid: 4321,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
    },
  });

  assert.equal(result.pid, 4321);
  assert.equal(captured.file, "powershell.exe");
  assert.deepEqual(captured.args.slice(0, 4), [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
  ]);
  assert.match(captured.args[4], /Start-Process -FilePath 'powershell\.exe'/);
  assert.match(captured.args[4], /-WindowStyle Hidden/);
  assert.match(captured.args[4], /-File', 'C:\\safe\\primary-hold\.ps1'/);
  assert.equal(captured.opts.windowsHide, true);
  assert.equal(captured.opts.detached, false);
});
