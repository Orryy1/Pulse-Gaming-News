"use strict";

const path = require("node:path");

const SAFE_ENV = {
  PULSE_SAFE_OBSERVATION_MODE: "true",
  AUTO_PUBLISH: "false",
  PULSE_PRIMARY_INSTANCE: "false",
  DEPLOYMENT_MODE: "local",
  USE_JOB_QUEUE: "true",
};

function psSingleQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function buildSafeObservationEnv(baseEnv = {}) {
  return {
    ...baseEnv,
    ...SAFE_ENV,
  };
}

function buildSafeObservationPowerShellScript({
  cwd = process.cwd(),
  logPath = path.join(process.cwd(), "test", "output", "local_server_safe_observation.log"),
} = {}) {
  const lines = [
    "$ErrorActionPreference='Stop'",
  ];
  for (const [key, value] of Object.entries(SAFE_ENV)) {
    lines.push(`$env:${key}=${psSingleQuote(value)}`);
  }
  lines.push(`Set-Location ${psSingleQuote(cwd)}`);
  lines.push(`node server.js *> ${psSingleQuote(logPath)}`);
  return `${lines.join("\n")}\n`;
}

function assertSafeObservationHealth(health) {
  const blockers = [];
  if (health?.runtime?.auto_publish !== false) {
    blockers.push("runtime.auto_publish is not false");
  }
  if (health?.runtime?.safe_observation_mode !== true) {
    blockers.push("runtime.safe_observation_mode is not true");
  }
  if (health?.deployment?.primary !== false) {
    blockers.push("deployment.primary is not false");
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
  SAFE_ENV,
  assertSafeObservationHealth,
  buildSafeObservationEnv,
  buildSafeObservationPowerShellScript,
};
