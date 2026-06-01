"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertSafeObservationHealth,
  buildSafeObservationEnv,
  buildSafeObservationPowerShellScript,
} = require("../../lib/ops/local-safe-observation-launcher");

const ROOT = path.resolve(__dirname, "..", "..");

test("buildSafeObservationEnv forces non-posting local runtime flags", () => {
  const env = buildSafeObservationEnv({
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_SAFE_OBSERVATION_MODE: "false",
    DEPLOYMENT_MODE: "production",
    USE_JOB_QUEUE: "false",
  });

  assert.equal(env.AUTO_PUBLISH, "false");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "false");
  assert.equal(env.PULSE_SAFE_OBSERVATION_MODE, "true");
  assert.equal(env.DEPLOYMENT_MODE, "local");
  assert.equal(env.USE_JOB_QUEUE, "true");
});

test("buildSafeObservationPowerShellScript emits literal env assignments", () => {
  const script = buildSafeObservationPowerShellScript({
    cwd: ROOT,
    logPath: path.join(ROOT, "test", "output", "local_server_safe_observation.log"),
  });

  assert.match(script, /\$env:AUTO_PUBLISH='false'/);
  assert.match(script, /\$env:PULSE_PRIMARY_INSTANCE='false'/);
  assert.match(script, /\$env:PULSE_SAFE_OBSERVATION_MODE='true'/);
  assert.match(script, /node server\.js/);
  assert.doesNotMatch(script, /\n='(?:true|false)'/);
});

test("assertSafeObservationHealth rejects live posting health", () => {
  const report = assertSafeObservationHealth({
    status: "ok",
    autonomousMode: true,
    schedulerActive: true,
    runtime: {
      auto_publish: true,
      safe_observation_mode: false,
    },
    deployment: {
      mode: "local",
      primary: true,
    },
  });

  assert.equal(report.safe, false);
  assert.deepEqual(report.blockers, [
    "runtime.auto_publish is not false",
    "runtime.safe_observation_mode is not true",
    "deployment.primary is not false",
    "schedulerActive is not false",
    "autonomousMode is not false",
  ]);
});

test("ops:local-safe-observation-server command is registered", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:local-safe-observation-server"],
    "node tools/local-safe-observation-server.js",
  );
});
