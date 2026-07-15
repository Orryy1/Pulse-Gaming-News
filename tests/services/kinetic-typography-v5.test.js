"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KINETIC_TYPOGRAPHY_V5,
  buildPremiumKineticAss,
  inspectPremiumCaptionCadence,
} = require("../../lib/studio/v5/kinetic-typography");

test("V5 kinetic typography groups narration into readable semantic phrases", () => {
  const scriptText = "GTA VI just revealed the detail that changes the entire launch debate.";
  const tokens = scriptText.split(/\s+/);
  const words = tokens.map((word, index) => ({
    word,
    start: index * 0.24,
    end: index * 0.24 + 0.22,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "GTA VI Cover Art Reveal" },
    words,
    duration: 4,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(report.metrics.maximum_words_per_caption <= KINETIC_TYPOGRAPHY_V5.max_words_per_phrase, true);
  assert.equal(report.metrics.caption_count < tokens.length / 2, true);
  assert.equal(report.metrics.single_word_caption_ratio, 0);
  assert.match(ass, /GTA/);
  assert.match(ass, /VI/);
});

test("V5 caption cadence rejects strobing one-word subtitle decks", () => {
  const ass = [
    "[Events]",
    "Dialogue: 0,0:00:00.00,0:00:00.18,Pop,,0,0,0,,ONE",
    "Dialogue: 0,0:00:00.18,0:00:00.36,Pop,,0,0,0,,WORD",
    "Dialogue: 0,0:00:00.36,0:00:00.54,Pop,,0,0,0,,FLASHES",
    "Dialogue: 0,0:00:00.54,0:00:00.72,Pop,,0,0,0,,FAST",
  ].join("\n");
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("caption_single_word_ratio_above_premium_ceiling"));
  assert.ok(report.blockers.includes("caption_dwell_below_premium_floor"));
});

test("V5 kinetic typography rebalances single-word sentence tails", () => {
  const scriptText = "Small dinosaurs can collect wild resources.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.24,
    end: index * 0.24 + 0.22,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "Paleo Pines Players' Choice Update" },
    words,
    duration: 2,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(report.metrics.single_word_caption_count, 0);
  assert.deepEqual(
    report.captions.map((caption) => caption.text),
    ["SMALL DINOSAURS CAN COLLECT", "WILD RESOURCES."],
  );
});

test("V5 kinetic typography never lets dangling-tail repair exceed the premium word ceiling", () => {
  const scriptText = "Make or break it is four.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.2,
    end: index * 0.2 + 0.18,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "MARVEL Tokon" },
    words,
    duration: 1.5,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(
    report.metrics.maximum_words_per_caption <= KINETIC_TYPOGRAPHY_V5.max_words_per_phrase,
    true,
  );
});
