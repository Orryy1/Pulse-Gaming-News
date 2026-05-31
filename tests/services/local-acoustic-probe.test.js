"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveLocalAcousticProbePythonPath,
} = require("../../lib/ops/local-acoustic-probe");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-acoustic-probe-"));
  fs.mkdirSync(path.join(root, "tts_server", "venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "tts_server", "venv", "Scripts", "python.exe"), "");
  fs.writeFileSync(path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"), "");
  return root;
}

test("local acoustic probe uses the windowless repo python on Windows", () => {
  const root = tempRoot();

  assert.equal(
    resolveLocalAcousticProbePythonPath({ root, platform: "win32", env: {} }),
    path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"),
  );
});

test("local acoustic probe honours explicit console debugging opt-in", () => {
  const root = tempRoot();

  assert.equal(
    resolveLocalAcousticProbePythonPath({
      root,
      platform: "win32",
      env: { LOCAL_TTS_ALLOW_CONSOLE: "1" },
    }),
    path.join(root, "tts_server", "venv", "Scripts", "python.exe"),
  );
});
