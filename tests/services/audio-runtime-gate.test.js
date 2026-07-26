const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AUDIO = fs.readFileSync(
  path.join(__dirname, "..", "..", "audio.js"),
  "utf8",
);
const { resolvePostTtsDurationContract } = require("../../audio");

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

test("audio.js can promote approved local Liam 76-90s narration to extended Short", () => {
  assert.match(AUDIO, /shouldAutoPromoteGeneratedAudioToExtendedShort/);
  assert.match(AUDIO, /local_tts_actual_76_to_90s/);
  assert.match(AUDIO, /pulse_extended_short/);
  assert.match(AUDIO, /MAX_EXTENDED_TOTAL_DURATION\s*=\s*90/);
});

test("audio.js rechecks regenerated audio duration, not the stale first pass", () => {
  assert.match(AUDIO, /let\s+totalDuration\s*=\s*audioDuration\s*\+\s*BUMPER_DURATION/);
  assert.match(AUDIO, /totalDuration\s*=\s*newDuration\s*\+\s*BUMPER_DURATION/);
});

test("audio.js only retries legacy undershoots and never pads stabilisation stories", () => {
  assert.match(
    AUDIO,
    /while\s*\(\s*!durationContract\.measuredNarrationAuthority[\s\S]*!durationContract\.paddingForbidden[\s\S]*totalDuration\s*<\s*durationContract\.minSeconds/,
  );
  assert.match(AUDIO, /Regenerating longer script \(attempt \$\{regenAttempts\}\/\$\{MAX_REGEN\}\)/);
});

test("audio.js uses measured narration duration for the breaking-news lane", () => {
  const pass = resolvePostTtsDurationContract({
    runtimePlan: {
      durationLane: "breaking_news",
      minSeconds: 35,
      maxSeconds: 59,
    },
    audioDuration: 41,
    totalDuration: 41,
  });
  assert.deepEqual(pass, {
    measuredNarrationAuthority: true,
    stabilisationAuthoritative: false,
    paddingForbidden: false,
    actualSeconds: 41,
    minSeconds: 35,
    maxSeconds: 59,
    label: "Breaking News Lane",
  });

  const flash = resolvePostTtsDurationContract({
    runtimePlan: { durationLane: "pulse_flash_short", maxSeconds: 75 },
    audioDuration: 62,
    totalDuration: 62,
  });
  assert.equal(flash.measuredNarrationAuthority, false);
  assert.equal(flash.stabilisationAuthoritative, false);
  assert.equal(flash.paddingForbidden, false);
  assert.equal(flash.minSeconds, 61);
  assert.equal(flash.maxSeconds, 75);

  const standard = resolvePostTtsDurationContract({
    runtimePlan: {
      durationLane: "standard_news",
      stabilisationAuthoritative: true,
      minSeconds: 32,
      maxSeconds: 42,
    },
    audioDuration: 36,
    totalDuration: 36,
  });
  assert.equal(standard.stabilisationAuthoritative, true);
  assert.equal(standard.paddingForbidden, true);
  assert.equal(standard.minSeconds, 32);
  assert.equal(standard.maxSeconds, 42);
});
