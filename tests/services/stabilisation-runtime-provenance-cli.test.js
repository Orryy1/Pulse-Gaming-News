"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "stabilisation-runtime-provenance.js");

test("runtime provenance CLI writes deterministic redacted local-proof evidence", () => {
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-runtime-provenance-"),
  );
  const secret = "must-never-appear-in-evidence";

  try {
    execFileSync(
      process.execPath,
      [
        TOOL,
        "--out-dir",
        outputDir,
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--expires-at",
        "2026-08-03T10:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "def5678",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PULSE_OPERATING_MODE: "LOCAL_PROOF",
          USE_JOB_QUEUE: "true",
          ELEVENLABS_API_KEY: secret,
        },
        encoding: "utf8",
      },
    );

    const jsonPath = path.join(outputDir, "runtime_provenance_report.json");
    const markdownPath = path.join(outputDir, "runtime_provenance_report.md");
    const jsonText = fs.readFileSync(jsonPath, "utf8");
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const report = JSON.parse(jsonText);

    assert.equal(report.schema_version, "pulse-runtime-provenance-v1");
    assert.equal(report.generated_at, "2026-07-27T10:00:00.000Z");
    assert.equal(report.expires_at, "2026-08-03T10:00:00.000Z");
    assert.equal(report.source_commit_sha, "abc1234");
    assert.equal(report.runtime_commit_sha, "def5678");
    assert.equal(report.environment, "local-proof");
    assert.equal(report.authoritative, false);
    assert.equal(report.effective_config.valid, true);
    assert.doesNotMatch(jsonText, new RegExp(secret));
    assert.doesNotMatch(markdown, new RegExp(secret));
    assert.match(markdown, /# Pulse Runtime Provenance/);
    assert.match(markdown, /LOCAL_PROOF evidence is not production authority/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("runtime provenance CLI has no database or network dependency", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /better-sqlite3|lib\/db|axios|fetch\s*\(/);
});
