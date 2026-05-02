const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyShortScriptRuntime,
  estimateSpeechSecondsFromWords,
  countSpokenWords,
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
