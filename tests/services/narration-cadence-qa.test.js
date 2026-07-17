"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyseNarrationCadence,
} = require("../../lib/narration-cadence-qa");

function repeatedSentencePauseFixture() {
  const sentences = [
    ["Paleo", "Pines", "fixed", "the", "hunt."],
    ["Players", "can", "target", "rare", "colours."],
    ["Saddlebags", "carry", "four", "useful", "items."],
    ["Helpers", "collect", "resources", "around", "farms."],
    ["The", "update", "respects", "your", "time."],
    ["Rare", "dinosaurs", "still", "feel", "special."],
    ["That", "tradeoff", "will", "split", "players."],
  ];
  const words = [];
  let cursor = 0;
  for (const sentence of sentences) {
    sentence.forEach((word, index) => {
      words.push({
        word,
        start: Number(cursor.toFixed(2)),
        end: Number((cursor + 0.22).toFixed(2)),
      });
      cursor += 0.24;
      if (index === sentence.length - 1) cursor += 0.82;
    });
  }
  return {
    transcript: sentences.flat().join(" "),
    timestampPayload: { words, duration_seconds: cursor },
  };
}

test("cadence QA blocks repeated identical long sentence pauses even when no single gap exceeds the absolute ceiling", async () => {
  const fixture = repeatedSentencePauseFixture();

  const report = await analyseNarrationCadence({
    ...fixture,
    silenceProbe: async () => [],
    generatedAt: "2026-07-17T09:00:00.000Z",
  });

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("voice_cadence:repetitive_long_pauses"));
  assert.ok(report.pause_profile.dominant_long_pause_count >= 6);
  assert.ok(report.pause_profile.dominant_long_pause_seconds >= 0.8);
});
