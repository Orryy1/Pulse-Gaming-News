"use strict";

const path = require("node:path");

function resolveLocalReadinessEvidenceRoot({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const configured = String(
    env?.PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT || "",
  ).trim();
  return path.resolve(configured || cwd);
}

function resolveLocalReadinessOutputDir(options = {}) {
  return path.join(
    resolveLocalReadinessEvidenceRoot(options),
    "test",
    "output",
  );
}

module.exports = {
  resolveLocalReadinessEvidenceRoot,
  resolveLocalReadinessOutputDir,
};
