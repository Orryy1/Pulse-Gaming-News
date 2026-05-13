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
  const ttsAnchor = AUDIO.indexOf("await generateTtsForStory");

  assert.ok(gateAnchor > 0, "audio.js must import/use classifyShortScriptRuntime");
  assert.ok(ttsAnchor > 0, "audio.js must generate TTS via the story wrapper");
  assert.ok(
    gateAnchor < ttsAnchor,
    "script runtime gate must run before the first TTS generation call",
  );
});

test("audio.js uses provider-aware timing for local Liam runtime gates", () => {
  assert.match(AUDIO, /secondsPerWordForTtsProvider/);
  assert.match(AUDIO, /runtimeSecondsPerWord/);
  assert.match(AUDIO, /secondsPerWord:\s*runtimeSecondsPerWord/);
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

test("audio.js rechecks regenerated audio duration, not the stale first pass", () => {
  assert.match(AUDIO, /let\s+totalDuration\s*=\s*audioDuration\s*\+\s*BUMPER_DURATION/);
  assert.match(AUDIO, /totalDuration\s*=\s*newDuration\s*\+\s*BUMPER_DURATION/);
});
