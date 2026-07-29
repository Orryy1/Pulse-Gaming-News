const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AUDIO = fs.readFileSync(
  path.join(__dirname, "..", "..", "audio.js"),
  "utf8",
);
const {
  evaluateAudioDurationAgainstPlan,
  resolveAudioRuntimePlan,
} = require("../../audio");

function words(count) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

test("Pulse audio resolves the selected editorial duration band instead of a fixed Flash runtime", () => {
  const plan = resolveAudioRuntimePlan({
    channelId: "pulse-gaming",
    story: {
      id: "dynamic-audio-runtime",
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
      full_script: words(40),
    },
  });

  assert.equal(plan.durationBandId, "what_changes_short_25_32");
  assert.equal(plan.minSeconds, 25);
  assert.equal(plan.maxSeconds, 32);
  assert.equal(plan.minWords, 37);
  assert.equal(plan.maxWords, 47);
  assert.equal(plan.shouldGenerateShortAudio, true);
});

test("Pulse audio fails closed when generated narration misses its selected band", () => {
  const plan = resolveAudioRuntimePlan({
    channelId: "pulse-gaming",
    story: {
      id: "dynamic-audio-duration",
      editorial_lane_id: "trailer_truth_check",
      hook_type: "open_loop",
      duration_band_id: "trailer_truth_short_28_35",
      full_script: words(45),
    },
  });

  assert.deepEqual(evaluateAudioDurationAgainstPlan(34.8, plan), {
    result: "pass",
    failures: [],
    durationSeconds: 34.8,
    minSeconds: 28,
    maxSeconds: 35,
    durationBandId: "trailer_truth_short_28_35",
  });
  assert.deepEqual(
    evaluateAudioDurationAgainstPlan(35.1, plan).failures,
    ["audio_duration_above_selected_band"],
  );
  assert.deepEqual(
    evaluateAudioDurationAgainstPlan(27.9, plan).failures,
    ["audio_duration_below_selected_band"],
  );
});

test("active Pulse audio generation cannot reinsert a fixed runtime or fixed CTA", () => {
  assert.match(AUDIO, /resolveAudioRuntimePlan\(\{\s*story,\s*channelId:/);
  assert.match(AUDIO, /evaluateAudioDurationAgainstPlan/);
  assert.doesNotMatch(AUDIO, /61.?75\s+second/i);
  assert.doesNotMatch(AUDIO, /90.?110\s+spoken\s+words/i);
  assert.doesNotMatch(
    AUDIO,
    /Follow Pulse Gaming so you never miss a beat/i,
  );
});

test("audio.js checks script runtime before generating TTS", () => {
  const gateAnchor = AUDIO.indexOf(
    "const runtimePlan = resolveAudioRuntimePlan",
  );
  const ttsAnchor = AUDIO.indexOf("await generateTTS");

  assert.ok(gateAnchor > 0, "audio.js must use the selected runtime contract");
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

test("audio.js blocks narration outside the selected band before render", () => {
  assert.match(AUDIO, /evaluateAudioDurationAgainstPlan/);
  assert.match(AUDIO, /duration_contract_post_tts/);
  assert.match(AUDIO, /selected editorial band, blocking before render/);
});
