const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const processor = require("../../processor");
const PROCESSOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "processor.js"),
  "utf8",
);

function words(n) {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ");
}

function script(wordCount) {
  return {
    classification: "[CONFIRMED]",
    hook: "Nintendo quietly confirmed a hardware shift.",
    body: "Details landed from an official source.",
    cta: "Follow Pulse Gaming so you never miss a beat.",
    full_script: words(wordCount),
    word_count: wordCount,
    suggested_thumbnail_text: "Nintendo shift",
  };
}

test("processor validate: Pulse accepts current 61-75s spoken word budget", () => {
  const errors = processor.validate(script(100), "pulse-gaming");
  assert.deepEqual(errors, []);
});

test("processor validate: Pulse rejects old 160-180 word scripts", () => {
  const errors = processor.validate(script(166), "pulse-gaming");
  assert.ok(
    errors.some((e) => e.includes("script_runtime_too_long")),
    `got: ${errors.join(", ")}`,
  );
});

test("processor validate: non-Pulse channels keep their existing word-count contract", () => {
  const errors = processor.validate(script(166), "the-signal");
  assert.deepEqual(errors, []);
});

test("processor editor prompt: Pulse uses Flash Lane word budget, not old 155-185 range", () => {
  const instruction = processor.editorWordCountInstruction({
    id: "pulse-gaming",
  });

  assert.match(instruction, /90-110/);
  assert.doesNotMatch(instruction, /155-185/);
  assert.match(instruction, /Do not expand it/);
});

test("processor editor prompt: non-Pulse channels keep legacy long-form short range", () => {
  const instruction = processor.editorWordCountInstruction({
    id: "the-signal",
  });

  assert.match(instruction, /155-185/);
});

test("processor editor pass revalidates edited scripts before accepting them", () => {
  assert.match(PROCESSOR_SOURCE, /validate\(edited,\s*channel\.id\)/);
  assert.match(PROCESSOR_SOURCE, /editor_validation_failed/);
});

test("processor final validation failure routes story to review instead of accepting bad Short script", () => {
  assert.doesNotMatch(PROCESSOR_SOURCE, /Using script despite validation issues/);
  assert.match(PROCESSOR_SOURCE, /Final validation failed; routing story to review/);

  const fallback = processor.buildScriptValidationReview(
    { id: "story1", title: "GTA 6 script ran too long" },
    { id: "pulse-gaming" },
    ["script_runtime_too_long (112.00s, max 75.00s)"],
  );

  assert.equal(fallback.classification, "[REVIEW]");
  assert.equal(fallback.full_script, "");
  assert.equal(fallback.tts_script, "");
  assert.equal(fallback.word_count, 0);
  assert.equal(fallback.quality_score, 0);
  assert.equal(fallback.approved, false);
  assert.equal(fallback.auto_approved, false);
  assert.equal(fallback.script_generation_status, "review_required");
  assert.equal(fallback.runtime_route, "briefing_or_longform");
  assert.deepEqual(fallback.script_validation_errors, [
    "script_runtime_too_long (112.00s, max 75.00s)",
  ]);
});

test("processor final validation failure preserves extended-short routing metadata", () => {
  const fallback = processor.buildScriptValidationReview(
    { id: "story2", title: "A richer story needs more than Flash Lane" },
    { id: "pulse-gaming" },
    [
      "script_runtime_extended_review_required (84.00s, flash max 75.00s, review max 90.00s)",
    ],
  );

  assert.equal(fallback.classification, "[REVIEW]");
  assert.equal(fallback.format_route, "extended_or_briefing");
  assert.equal(fallback.runtime_route, "extended_or_briefing");
  assert.equal(fallback.script_generation_status, "review_required");
});
