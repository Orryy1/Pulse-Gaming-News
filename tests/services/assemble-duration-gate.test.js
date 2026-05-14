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

test("assemble.js checks approved voice path before rendering", () => {
  const renderAnchor = ASSEMBLE.indexOf("[assemble] Rendering");
  const voiceAnchor = ASSEMBLE.indexOf("const voiceQa = await runAssembleVoiceGuard");

  assert.ok(voiceAnchor > 0, "assemble.js must run assemble-stage voice QA");
  assert.ok(renderAnchor > 0, "assemble.js render log anchor must exist");
  assert.ok(
    voiceAnchor < renderAnchor,
    "approved voice guard must run before the FFmpeg render command is built",
  );
  assert.match(ASSEMBLE, /runPublishVoiceQa/);
  assert.match(ASSEMBLE, /STRICT_ASSEMBLE_VOICE_QA/);
  assert.match(ASSEMBLE, /DEPLOYMENT_MODE[^;]+local/s);
  assert.match(ASSEMBLE, /voice_contract:\$\{reason\}/);
});

test("assemble.js persists overlong audio as a QA failure instead of rendering", () => {
  assert.match(ASSEMBLE, /audio_duration_too_long/);
  assert.match(ASSEMBLE, /story\.qa_failed\s*=\s*true/);
  assert.match(ASSEMBLE, /story\.publish_status\s*=\s*["']failed["']/);
  assert.match(ASSEMBLE, /story\.publish_error\s*=/);
});

test("assemble.js persists successful render durations so publish QA does not use stale _extra", () => {
  const successAnchor = ASSEMBLE.indexOf("story.exported_path = outputPath;");
  const audioAnchor = ASSEMBLE.indexOf("story.audio_duration = audioDuration;");
  const videoAnchor = ASSEMBLE.indexOf("story.duration_seconds = duration;");
  const contractAnchor = ASSEMBLE.indexOf("story.short_duration_contract = durationQa;");

  assert.ok(successAnchor > 0, "assemble.js success export anchor must exist");
  assert.ok(audioAnchor > 0 && audioAnchor < successAnchor, "audio duration must be saved before export path");
  assert.ok(videoAnchor > 0 && videoAnchor < successAnchor, "video duration must be saved before export path");
  assert.ok(contractAnchor > 0 && contractAnchor < successAnchor, "duration contract must be saved before export path");
});
