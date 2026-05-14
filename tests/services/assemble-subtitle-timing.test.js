"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assTime,
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
  selectSubtitleScriptText,
} = require("../../assemble");

function alignmentFromWords(words) {
  const characters = [];
  const starts = [];
  const ends = [];
  for (const [idx, word] of words.entries()) {
    if (idx > 0) {
      characters.push(" ");
      starts.push(word.start);
      ends.push(word.start);
    }
    for (const ch of word.text) {
      characters.push(ch);
      starts.push(word.start);
      ends.push(word.end);
    }
  }
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

test("subtitle timing inspection accepts continuous character alignments", () => {
  const alignment = alignmentFromWords([
    { text: "Pulse", start: 0.1, end: 0.4 },
    { text: "Gaming", start: 0.45, end: 0.9 },
    { text: "keeps", start: 0.95, end: 1.2 },
    { text: "moving", start: 1.25, end: 1.7 },
  ]);

  const words = characterAlignmentToSubtitleWords(alignment);
  const inspection = inspectSubtitleTimingWords(words, 2);

  assert.equal(inspection.usable, true);
  assert.equal(inspection.reason, "usable");
  assert.equal(inspection.maxGapSeconds < 1, true);
});

test("subtitle timing inspection rejects frozen local TTS timestamp sidecars", () => {
  const alignment = alignmentFromWords([
    { text: "Stardew", start: 0.16, end: 0.54 },
    { text: "Valley's", start: 36.73, end: 37.1 },
    { text: "creator", start: 37.1, end: 37.45 },
    { text: "Follow", start: 64.48, end: 64.48 },
    { text: "Pulse", start: 64.48, end: 64.48 },
    { text: "Gaming", start: 64.48, end: 64.48 },
    { text: "beat", start: 64.16, end: 64.34 },
  ]);

  const words = characterAlignmentToSubtitleWords(alignment);
  const inspection = inspectSubtitleTimingWords(words, 64.48);

  assert.equal(inspection.usable, false);
  assert.match(inspection.reason, /gap|zero|monotonic/i);
  assert.equal(inspection.maxGapSeconds > 30, true);
  assert.equal(inspection.zeroDurationWordRatio > 0.3, true);
});

test("subtitle script fallback prefers the actual TTS transcript over stale story text", () => {
  const sidecar = {
    meta: {
      transcript: "Actual narration including the final Pulse Gaming outro.",
    },
    characters: Array.from("ignored"),
  };

  const text = selectSubtitleScriptText(
    { full_script: "Old story script without the outro." },
    sidecar,
  );

  assert.equal(text, sidecar.meta.transcript);
});

test("assemble ASS timestamp formatter carries rounded centiseconds across minute boundaries", () => {
  assert.equal(assTime(59.999), "0:01:00.00");
  assert.equal(assTime(119.999), "0:02:00.00");
});
