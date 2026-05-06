const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyShortScriptRuntime,
  estimateSpeechSecondsFromWords,
  countSpokenWords,
  secondsPerWordForTtsProvider,
  DEFAULT_LOCAL_SECONDS_PER_WORD,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
} = require("../../lib/services/short-runtime-planner");

test("short runtime planner: 61s lower edge passes Flash Lane", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 90 });
  assert.equal(plan.result, "pass");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.estimatedSeconds, 61.2);
});

test("short runtime planner: 75s upper edge passes Flash Lane", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 110 });
  assert.equal(plan.result, "pass");
  assert.equal(plan.shouldGenerateShortAudio, true);
  assert.equal(plan.estimatedSeconds, 74.8);
});

test("short runtime planner: 90s script is review, not normal Short audio", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 132 });
  assert.equal(plan.result, "review");
  assert.equal(plan.route, "review_or_briefing");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.ok(
    plan.warnings.some((w) => w.startsWith("script_runtime_review_required")),
  );
});

test("short runtime planner: 117s script blocks before audio/render", () => {
  const plan = classifyShortScriptRuntime({ wordCount: 172 });
  assert.equal(plan.result, "fail");
  assert.equal(plan.route, "blocked");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.ok(
    plan.failures.some((f) => f.startsWith("script_runtime_too_long")),
  );
});

test("short runtime planner: longform candidate routes away from normal Short", () => {
  const plan = classifyShortScriptRuntime({
    wordCount: 172,
    format: "weekly_roundup_item",
  });
  assert.equal(plan.result, "route_longform");
  assert.equal(plan.route, "briefing_or_longform");
  assert.equal(plan.shouldGenerateShortAudio, false);
  assert.deepEqual(plan.failures, []);
});

test("short runtime planner: default word budget matches current voice calibration", () => {
  assert.equal(DEFAULT_MIN_WORDS, 90);
  assert.equal(DEFAULT_MAX_WORDS, 110);
  assert.equal(estimateSpeechSecondsFromWords(100), 68);
  assert.equal(countSpokenWords("G T A six just moved again."), 7);
});

test("short runtime planner: local Liam voice uses measured approved-reference calibration", () => {
  assert.equal(DEFAULT_LOCAL_SECONDS_PER_WORD, 0.33);
  assert.equal(secondsPerWordForTtsProvider("local", {}), 0.33);
  assert.equal(secondsPerWordForTtsProvider("voxcpm", {}), 0.33);
  assert.equal(secondsPerWordForTtsProvider("elevenlabs", {}), 0.68);
  assert.equal(
    secondsPerWordForTtsProvider("local", { LOCAL_TTS_SECONDS_PER_WORD: "0.4" }),
    0.4,
  );

  const shortLocal = classifyShortScriptRuntime({
    wordCount: 180,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  assert.equal(shortLocal.result, "warn");
  assert.match(shortLocal.warnings[0], /below_flash_target/);
  assert.equal(shortLocal.estimatedSeconds, 59.4);

  const passLocal = classifyShortScriptRuntime({
    wordCount: 210,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  assert.equal(passLocal.result, "pass");
  assert.equal(passLocal.estimatedSeconds, 69.3);
  assert.equal(passLocal.minWords, 185);
  assert.equal(passLocal.maxWords, 227);
});

test("short runtime planner: punctuation-heavy local Liam scripts still estimate from spoken words", () => {
  const text = "Wait... GTA? Xbox! Steam, moving now. ".repeat(35);
  const plan = classifyShortScriptRuntime({
    text,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(countSpokenWords(text), 210);
  assert.equal(plan.result, "pass");
  assert.equal(plan.estimatedSeconds, 69.3);
});

test("short runtime planner: local Liam too-short and too-long estimates are explicit", () => {
  const tooShort = classifyShortScriptRuntime({
    wordCount: 180,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });
  const tooLong = classifyShortScriptRuntime({
    wordCount: 274,
    secondsPerWord: secondsPerWordForTtsProvider("local", {}),
  });

  assert.equal(tooShort.result, "warn");
  assert.match(tooShort.warnings[0], /script_runtime_below_flash_target/);
  assert.equal(tooLong.result, "fail");
  assert.match(tooLong.failures[0], /script_runtime_too_long/);
});
