"use strict";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

const FORCED_VALUES = Object.freeze({
  DEPLOYMENT_MODE: "local",
  PULSE_PRIMARY_INSTANCE: "false",
  AUTO_PUBLISH: "false",
  USE_JOB_QUEUE: "true",
  PULSE_LOCAL_DEPLOY_NOTIFY: "false",
  PRODUCE_NOTIFY_DISCORD: "false",
});

function snapshot(env = {}) {
  return Object.fromEntries(
    Object.keys(FORCED_VALUES).map((key) => [key, env[key] ?? null]),
  );
}

function isSafeObservationMode(env = process.env) {
  return truthy(env.PULSE_SAFE_OBSERVATION_MODE);
}

function applySafeObservationMode(env = process.env) {
  if (!isSafeObservationMode(env)) {
    return {
      applied: false,
      reason: "PULSE_SAFE_OBSERVATION_MODE not enabled",
    };
  }

  const before = snapshot(env);
  for (const [key, value] of Object.entries(FORCED_VALUES)) {
    env[key] = value;
  }

  return {
    applied: true,
    reason: "safe_observation_mode_forced",
    before,
    after: snapshot(env),
    safety: {
      no_publish: true,
      no_scheduler_runner: true,
      no_discord_deploy_notification: true,
      no_produce_discord_notification: true,
      no_token_or_oauth_mutation: true,
    },
  };
}

module.exports = {
  applySafeObservationMode,
  isSafeObservationMode,
};
