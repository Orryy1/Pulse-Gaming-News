const { test } = require("node:test");
const assert = require("node:assert/strict");

const processor = require("../../processor");

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
