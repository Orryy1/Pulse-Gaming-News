"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applySafeObservationMode,
  isSafeObservationMode,
} = require("../../lib/safe-observation-mode");

const ROOT = path.resolve(__dirname, "..", "..");

test("safe observation mode force-disables posting after dotenv values load", () => {
  const env = {
    PULSE_SAFE_OBSERVATION_MODE: "true",
    DEPLOYMENT_MODE: "railway",
    PULSE_PRIMARY_INSTANCE: "true",
    AUTO_PUBLISH: "true",
    USE_JOB_QUEUE: "false",
    PULSE_LOCAL_DEPLOY_NOTIFY: "true",
    PRODUCE_NOTIFY_DISCORD: "true",
  };

  const result = applySafeObservationMode(env);

  assert.equal(result.applied, true);
  assert.equal(env.DEPLOYMENT_MODE, "local");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "false");
  assert.equal(env.AUTO_PUBLISH, "false");
  assert.equal(env.USE_JOB_QUEUE, "true");
  assert.equal(env.PULSE_LOCAL_DEPLOY_NOTIFY, "false");
  assert.equal(env.PRODUCE_NOTIFY_DISCORD, "false");
  assert.equal(result.safety.no_publish, true);
  assert.equal(result.safety.no_scheduler_runner, true);
  assert.equal(result.before.AUTO_PUBLISH, "true");
  assert.equal(result.after.AUTO_PUBLISH, "false");
});

test("safe observation mode is opt-in only", () => {
  const env = {
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "true",
  };

  const result = applySafeObservationMode(env);

  assert.equal(result.applied, false);
  assert.equal(isSafeObservationMode(env), false);
  assert.equal(env.AUTO_PUBLISH, "true");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "true");
});

test("server applies safe observation mode after dotenv and skips scheduler startup", () => {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const dotenvIndex = source.indexOf("dotenv.config");
  const applyIndex = source.indexOf("applySafeObservationMode(process.env)");
  const schedulerGuardIndex = source.indexOf("isSafeObservationMode(process.env)");
  const schedulerStartIndex = source.indexOf("startAutonomousScheduler().catch");

  assert.ok(dotenvIndex >= 0, "server must load dotenv");
  assert.ok(applyIndex > dotenvIndex, "safe mode must run after dotenv override");
  assert.ok(schedulerGuardIndex > applyIndex, "scheduler guard must see forced env values");
  assert.ok(
    schedulerGuardIndex < schedulerStartIndex,
    "safe mode guard must run before scheduler startup",
  );
});
