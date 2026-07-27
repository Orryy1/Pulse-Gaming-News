"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePortablePath,
} = require("../../lib/portable-path");

test("resolvePortablePath preserves a Windows drive path on every host platform", () => {
  assert.equal(
    resolvePortablePath("/linux/checkout", "D:/pulse-data/pulse.db")
      .replace(/\\/g, "/"),
    "D:/pulse-data/pulse.db",
  );
});

test("resolvePortablePath resolves a relative leaf against a Windows root on every host platform", () => {
  assert.equal(
    resolvePortablePath(
      "C:/Pulse/runtime/pulse-v1",
      "tools/windows-local-runtime-supervisor.js",
    ).replace(/\\/g, "/"),
    "C:/Pulse/runtime/pulse-v1/tools/windows-local-runtime-supervisor.js",
  );
});

test("resolvePortablePath preserves a Windows UNC path on every host platform", () => {
  assert.equal(
    resolvePortablePath("/linux/checkout", "\\\\media\\pulse\\clip.mp4")
      .replace(/\\/g, "/"),
    "//media/pulse/clip.mp4",
  );
});
