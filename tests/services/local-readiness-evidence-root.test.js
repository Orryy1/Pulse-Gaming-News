"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  resolveLocalReadinessOutputDir,
} = require("../../lib/ops/local-readiness-evidence-root");

test("local readiness reports use the shared publish-runway evidence root", () => {
  const cwd = path.resolve("C:/work/pulse-gaming-live");
  const evidenceRoot = path.resolve("C:/work/pulse-gaming");

  assert.equal(
    resolveLocalReadinessOutputDir({
      cwd,
      env: { PULSE_PUBLISH_RUNWAY_EVIDENCE_ROOT: evidenceRoot },
    }),
    path.join(evidenceRoot, "test", "output"),
  );
  assert.equal(
    resolveLocalReadinessOutputDir({ cwd, env: {} }),
    path.join(cwd, "test", "output"),
  );
});
