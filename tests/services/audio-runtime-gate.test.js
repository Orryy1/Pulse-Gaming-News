const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AUDIO = fs.readFileSync(
  path.join(__dirname, "..", "..", "audio.js"),
  "utf8",
);

test("audio.js checks script runtime before generating TTS", () => {
  const gateAnchor = AUDIO.indexOf("classifyShortScriptRuntime");
  const ttsAnchor = AUDIO.indexOf("await generateTTS");

  assert.ok(gateAnchor > 0, "audio.js must import/use classifyShortScriptRuntime");
  assert.ok(ttsAnchor > 0, "audio.js must generate TTS");
  assert.ok(
    gateAnchor < ttsAnchor,
    "script runtime gate must run before the first generateTTS call",
  );
});

test("audio.js persists pre-TTS runtime blocks as QA failures", () => {
  assert.match(AUDIO, /duration_contract_pre_tts/);
  assert.match(AUDIO, /story\.qa_failed\s*=\s*true/);
  assert.match(AUDIO, /story\.publish_status\s*=\s*["']failed["']/);
  assert.match(AUDIO, /story\.publish_error\s*=/);
});

test("audio.js blocks generated overlong audio before render", () => {
  assert.match(AUDIO, /MAX_FLASH_TOTAL_DURATION\s*=\s*75/);
  assert.match(AUDIO, /duration_contract_post_tts/);
  assert.match(AUDIO, /audio_duration_too_long/);
});
