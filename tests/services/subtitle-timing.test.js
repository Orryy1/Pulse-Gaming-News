"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  anchorSubtitleWordsToAudioSilences,
  buildSyntheticCharacterAlignment,
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
  repairTimestampAlignment,
  speechIntervalsFromSilences,
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
  assert.equal(repaired.repairStrategy, "synthetic_full_duration");
  assert.equal(repaired.inspection.usable, true);
  assert.equal(repaired.alignment.characters.join(""), "Stardew Valley creator follow pulse");
});

test("anchorSubtitleWordsToAudioSilences moves synthetic local timings onto real speech pauses", () => {
  const text =
    "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.";
  const synthetic = characterAlignmentToSubtitleWords(buildSyntheticCharacterAlignment(text, 10.45))
    .map((word) => ({ word: word.text, start: word.start, end: word.end }));

  const anchored = anchorSubtitleWordsToAudioSilences({
    text,
    words: synthetic,
    duration: 10.45,
    silences: [
      { start: 0, end: 0.266, duration: 0.266 },
      { start: 4.793, end: 5.279, duration: 0.486 },
      { start: 10.2, end: 10.45, duration: 0.25 },
    ],
  });

  assert.equal(anchored.repaired, true);
  assert.equal(anchored.strategy, "audio_silence_sentence_anchored");
  assert.equal(Number(anchored.words[0].start.toFixed(3)), 0.266);
  assert.ok(
    anchored.words.find((word) => word.word.startsWith("Xbox's")).start >= 5.279,
    "second sentence should start after the measured audio pause",
  );
  assert.ok(
    anchored.words.find((word) => word.word.startsWith("countdown")).end <= 4.793,
    "first sentence should finish before the measured audio pause",
  );
});

test("audio silence anchoring honours short leading silence without fragmenting tiny internal gaps", () => {
  const text = "Hades II finally has a PlayStation and Xbox date.";
  const synthetic = characterAlignmentToSubtitleWords(buildSyntheticCharacterAlignment(text, 4.5))
    .map((word) => ({ word: word.text, start: word.start, end: word.end }));

  const silences = [
    { start: 0, end: 0.209, duration: 0.209 },
    { start: 0.979, end: 1.085, duration: 0.106 },
    { start: 1.408, end: 1.461, duration: 0.053 },
  ];
  const intervals = speechIntervalsFromSilences(silences, 4.5, { minPauseS: 0.22 });
  const anchored = anchorSubtitleWordsToAudioSilences({
    text,
    words: synthetic,
    duration: 4.5,
    silences,
    minPauseS: 0.22,
  });

  assert.deepEqual(intervals, [{ start: 0.209, end: 4.5 }]);
  assert.equal(anchored.repaired, true);
  assert.equal(Number(anchored.words[0].start.toFixed(3)), 0.209);
  assert.ok(
    anchored.words.find((word) => word.word === "PlayStation").start > 1,
    "words should still be distributed through the full speech interval",
  );
});
