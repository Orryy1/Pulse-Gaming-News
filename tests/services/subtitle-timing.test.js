"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSyntheticCharacterAlignment,
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
  repairTimestampAlignment,
} = require("../../lib/subtitle-timing");

function badAlignment() {
  return {
    characters: Array.from("Stardew Valley creator follow pulse"),
    character_start_times_seconds: [
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 36.7, 36.7, 36.7, 36.7, 36.7, 36.7,
      36.7, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
      64, 64, 63.8, 63.8, 63.8, 63.8,
    ],
    character_end_times_seconds: [
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 37.1, 37.1, 37.1, 37.1, 37.1,
      37.1, 37.1, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64,
      64, 64, 64, 64, 64.1, 64.1, 64.1, 64.1,
    ],
  };
}

test("buildSyntheticCharacterAlignment covers the full narration duration", () => {
  const alignment = buildSyntheticCharacterAlignment(
    "Pulse Gaming keeps captions alive.",
    12,
  );
  const words = characterAlignmentToSubtitleWords(alignment);
  const inspection = inspectSubtitleTimingWords(words, 12);

  assert.equal(inspection.usable, true);
  assert.equal(words.at(-1).end, 12);
  assert.equal(alignment.characters.join(""), "Pulse Gaming keeps captions alive.");
});

test("repairTimestampAlignment replaces unusable local sidecars with synthetic timing", () => {
  const repaired = repairTimestampAlignment({
    alignment: badAlignment(),
    text: "Stardew Valley creator follow pulse",
    duration: 64,
  });

  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairReason, "max_gap_too_large");
  assert.equal(repaired.inspection.usable, true);
  assert.equal(repaired.alignment.characters.join(""), "Stardew Valley creator follow pulse");
});
