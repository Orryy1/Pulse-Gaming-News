"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyPrimaryRuntimeHold,
  isPrimaryRuntimeHold,
} = require("../../lib/primary-runtime-hold");

const ROOT = path.resolve(__dirname, "..", "..");

test("primary runtime hold keeps primary health but force-disables posting side effects", () => {
  const env = {
    PULSE_PRIMARY_RUNTIME_HOLD: "true",
    DEPLOYMENT_MODE: "railway",
    PULSE_PRIMARY_INSTANCE: "false",
    AUTO_PUBLISH: "true",
    USE_JOB_QUEUE: "false",
    PULSE_LOCAL_DEPLOY_NOTIFY: "true",
    PRODUCE_NOTIFY_DISCORD: "true",
    PULSE_DISABLE_DISCORD_BOT: "false",
  };

  const result = applyPrimaryRuntimeHold(env);

  assert.equal(result.applied, true);
  assert.equal(env.DEPLOYMENT_MODE, "local");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "true");
  assert.equal(env.AUTO_PUBLISH, "false");
  assert.equal(env.USE_JOB_QUEUE, "true");
  assert.equal(env.PULSE_LOCAL_DEPLOY_NOTIFY, "false");
  assert.equal(env.PRODUCE_NOTIFY_DISCORD, "false");
  assert.equal(env.PULSE_DISABLE_DISCORD_BOT, "true");
  assert.equal(result.safety.primary_health_signal, true);
  assert.equal(result.safety.no_publish, true);
  assert.equal(result.safety.no_scheduler_runner, true);
  assert.equal(result.before.AUTO_PUBLISH, "true");
  assert.equal(result.after.AUTO_PUBLISH, "false");
});

test("primary runtime hold is opt-in only", () => {
  const env = {
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "false",
  };

  const result = applyPrimaryRuntimeHold(env);

  assert.equal(result.applied, false);
  assert.equal(isPrimaryRuntimeHold(env), false);
  assert.equal(env.AUTO_PUBLISH, "true");
  assert.equal(env.PULSE_PRIMARY_INSTANCE, "false");
});

test("server applies primary runtime hold after dotenv and before scheduler startup", () => {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const dotenvIndex = source.indexOf("loadDotenvOnce({ dotenv, env: process.env })");
  const holdApplyIndex = source.indexOf("applyPrimaryRuntimeHold(process.env)");
  const safeApplyIndex = source.indexOf("applySafeObservationMode(process.env)");
  const schedulerHoldGuardIndex = source.indexOf("Primary runtime hold active - scheduler and jobs runner skipped");
  const schedulerStartIndex = source.indexOf("startAutonomousScheduler().catch");
  const discordHoldGuardIndex = source.indexOf("Discord bot skipped - primary runtime hold");
  const discordStartIndex = source.indexOf('spawn("node", ["discord/bot.js"]');

  assert.ok(dotenvIndex >= 0, "server must use the one-shot no-override dotenv loader");
  assert.ok(holdApplyIndex > dotenvIndex, "primary hold must run after governed dotenv loading");
  assert.ok(safeApplyIndex > holdApplyIndex, "safe observation must be able to override primary hold");
  assert.ok(
    schedulerHoldGuardIndex > safeApplyIndex,
    "scheduler guard must see forced env values",
  );
  assert.ok(
    schedulerHoldGuardIndex < schedulerStartIndex,
    "primary hold guard must run before scheduler startup",
  );
  assert.ok(
    discordHoldGuardIndex < discordStartIndex,
    "primary hold must skip Discord bot before spawn",
  );
});
