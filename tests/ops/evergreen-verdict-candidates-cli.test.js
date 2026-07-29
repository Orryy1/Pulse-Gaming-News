"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const TOOL = path.join(ROOT, "tools", "evergreen-verdict-candidates.js");
const INPUT = path.join(
  ROOT,
  "tests",
  "fixtures",
  "evergreen-verdict-candidates-input.json",
);
const NOW = "2026-07-28T12:00:00.000Z";

test("CLI writes machine-readable and human-readable LOCAL_PROOF artefacts", (t) => {
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-evergreen-candidates-"),
  );
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const outDir = path.join(workDir, "proof");

  const result = spawnSync(
    process.execPath,
    [
      TOOL,
      "--input",
      INPUT,
      "--out-dir",
      outDir,
      "--now",
      NOW,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const jsonPath = path.join(outDir, "evergreen_candidate_report.json");
  const markdownPath = path.join(
    outDir,
    "evergreen_candidate_report.md",
  );
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.equal(report.mode, "LOCAL_PROOF");
  assert.equal(report.candidates.length, 1);
  assert.equal(
    report.candidates[0].assessment.verdict,
    "READY_FOR_PRODUCTION",
  );
  assert.equal(report.selected_candidates.length, 1);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.match(markdown, /Mode: LOCAL_PROOF/);
  assert.match(result.stdout, /evergreen_candidate_report\.json/);
});
