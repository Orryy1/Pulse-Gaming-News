"use strict";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

const FORCED_VALUES = Object.freeze({
  DEPLOYMENT_MODE: "local",
  PULSE_PRIMARY_INSTANCE: "true",
  AUTO_PUBLISH: "false",
  USE_JOB_QUEUE: "true",
  PULSE_LOCAL_DEPLOY_NOTIFY: "false",
  PRODUCE_NOTIFY_DISCORD: "false",
  PULSE_DISABLE_DISCORD_BOT: "true",
});

function snapshot(env = {}) {
  return Object.fromEntries(
    Object.keys(FORCED_VALUES).map((key) => [key, env[key] ?? null]),
  );
}

function isPrimaryRuntimeHold(env = process.env) {
  return truthy(env.PULSE_PRIMARY_RUNTIME_HOLD);
}

function applyPrimaryRuntimeHold(env = process.env) {
  if (!isPrimaryRuntimeHold(env)) {
    return {
      applied: false,
      reason: "PULSE_PRIMARY_RUNTIME_HOLD not enabled",
    };
  }

  const before = snapshot(env);
  for (const [key, value] of Object.entries(FORCED_VALUES)) {
    env[key] = value;
  }

  return {
    applied: true,
    reason: "primary_runtime_hold_forced",
    before,
    after: snapshot(env),
    safety: {
      primary_health_signal: true,
      no_publish: true,
      no_scheduler_runner: true,
      no_discord_bot: true,
      no_discord_deploy_notification: true,
      no_produce_discord_notification: true,
      no_token_or_oauth_mutation: true,
    },
  };
}

module.exports = {
  applyPrimaryRuntimeHold,
  isPrimaryRuntimeHold,
};
