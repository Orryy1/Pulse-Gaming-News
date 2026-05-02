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
