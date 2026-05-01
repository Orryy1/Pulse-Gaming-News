const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ASSEMBLE = fs.readFileSync(
  path.join(__dirname, "..", "..", "assemble.js"),
  "utf8",
);

test("assemble.js checks the short duration contract before rendering", () => {
  const renderAnchor = ASSEMBLE.indexOf("[assemble] Rendering");
  const gateAnchor = ASSEMBLE.indexOf("classifyShortDuration");

  assert.ok(gateAnchor > 0, "assemble.js must import/use classifyShortDuration");
  assert.ok(renderAnchor > 0, "assemble.js render log anchor must exist");
  assert.ok(
    gateAnchor < renderAnchor,
    "duration contract must run before the FFmpeg render command is built",
  );
});

test("assemble.js persists overlong audio as a QA failure instead of rendering", () => {
  assert.match(ASSEMBLE, /audio_duration_too_long/);
  assert.match(ASSEMBLE, /story\.qa_failed\s*=\s*true/);
  assert.match(ASSEMBLE, /story\.publish_status\s*=\s*["']failed["']/);
  assert.match(ASSEMBLE, /story\.publish_error\s*=/);
});
