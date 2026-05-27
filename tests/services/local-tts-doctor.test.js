"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  writeReport,
} = require("../../tools/local-tts-doctor");

test("local TTS doctor JSON includes its report paths", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tts-doctor-"));
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    const paths = await writeReport({
      generated_at: "2026-05-06T00:00:00.000Z",
      verdict: "green",
      action: "none",
      failure_code: null,
      reason: "ready",
      before: { status: "ok", phase: "ready", ready: true, voice: {} },
    });
    const json = await fs.readJson(paths.jsonPath);
    assert.equal(json.report_paths.jsonPath, paths.jsonPath);
    assert.equal(json.report_paths.mdPath, paths.mdPath);
  } finally {
    process.chdir(previousCwd);
    await fs.remove(dir);
  }
});
