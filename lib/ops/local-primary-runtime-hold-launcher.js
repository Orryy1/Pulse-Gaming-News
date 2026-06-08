"use strict";

const path = require("node:path");

const HOLD_ENV = {
  PULSE_PRIMARY_RUNTIME_HOLD: "true",
  PULSE_SAFE_OBSERVATION_MODE: "false",
  PULSE_PRIMARY_INSTANCE: "true",
  AUTO_PUBLISH: "false",
  DEPLOYMENT_MODE: "local",
  USE_JOB_QUEUE: "true",
  PULSE_LOCAL_DEPLOY_NOTIFY: "false",
  PRODUCE_NOTIFY_DISCORD: "false",
  PULSE_DISABLE_DISCORD_BOT: "true",
};

function psSingleQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function buildPrimaryRuntimeHoldEnv(baseEnv = {}) {
  return {
    ...baseEnv,
    ...HOLD_ENV,
  };
}

function buildPrimaryRuntimeHoldPowerShellScript({
  cwd = process.cwd(),
  logPath = path.join(process.cwd(), "test", "output", "local_server_primary_runtime_hold.log"),
} = {}) {
  const lines = [
    "$ErrorActionPreference='Stop'",
  ];
  for (const [key, value] of Object.entries(HOLD_ENV)) {
    lines.push(`$env:${key}=${psSingleQuote(value)}`);
  }
  lines.push(`Set-Location ${psSingleQuote(cwd)}`);
  lines.push(`node server.js *> ${psSingleQuote(logPath)}`);
  return `${lines.join("\n")}\n`;
}

function assertPrimaryRuntimeHoldHealth(health) {
  const blockers = [];
  if (health?.runtime?.auto_publish !== false) {
    blockers.push("runtime.auto_publish is not false");
  }
  if (health?.runtime?.safe_observation_mode !== false) {
    blockers.push("runtime.safe_observation_mode is not false");
  }
  if (health?.runtime?.primary_runtime_hold !== true) {
    blockers.push("runtime.primary_runtime_hold is not true");
  }
  if (health?.deployment?.primary !== true) {
    blockers.push("deployment.primary is not true");
  }
  if (health?.schedulerActive !== false) {
    blockers.push("schedulerActive is not false");
  }
  if (health?.autonomousMode !== false) {
    blockers.push("autonomousMode is not false");
  }
  return {
    safe: blockers.length === 0,
    blockers,
  };
}

module.exports = {
  HOLD_ENV,
  assertPrimaryRuntimeHoldHealth,
  buildPrimaryRuntimeHoldEnv,
  buildPrimaryRuntimeHoldPowerShellScript,
};
