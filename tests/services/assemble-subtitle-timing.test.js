"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assTime,
  characterAlignmentToSubtitleWords,
  effectiveVisualTimelineDuration,
  inspectSubtitleTimingWords,
  mergeSubtitleWordsForDisplay,
  planLegacySegmentDuration,
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

test("subtitle timing inspection rejects timestamp tracks that stop before narration ends", () => {
  const alignment = alignmentFromWords(
    Array.from({ length: 30 }, (_, index) => ({
      text: `word${index}`,
      start: index * 2,
      end: index * 2 + 0.35,
    })),
  );

  const words = characterAlignmentToSubtitleWords(alignment);
  const inspection = inspectSubtitleTimingWords(words, 64, {
    maxTrailingGapSeconds: 2,
  });

  assert.equal(inspection.usable, false);
  assert.equal(inspection.reason, "trailing_caption_gap_too_large");
  assert.equal(inspection.trailingGapSeconds > 5, true);
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

test("subtitle display merge keeps gaming names readable", () => {
  const words = [
    { text: "G", start: 0, end: 0.1 },
    { text: "T", start: 0.1, end: 0.2 },
    { text: "A", start: 0.2, end: 0.3 },
    { text: "five", start: 0.3, end: 0.5 },
    { text: "and", start: 0.5, end: 0.6 },
    { text: "GTA", start: 0.6, end: 0.75 },
    { text: "six.", start: 0.75, end: 1 },
    { text: "PlayStation", start: 1, end: 1.3 },
    { text: "Five", start: 1.3, end: 1.5 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["GTA 5", "and", "GTA VI.", "PlayStation 5"]);
});

test("subtitle display merge handles ASR punctuation and possessive gaming names", () => {
  const words = [
    { text: "G.", start: 0, end: 0.08 },
    { text: "T.", start: 0.08, end: 0.16 },
    { text: "A.", start: 0.16, end: 0.24 },
    { text: "Five's", start: 0.24, end: 0.48 },
    { text: "free", start: 0.5, end: 0.7 },
    { text: "PlayStation", start: 0.72, end: 0.98 },
    { text: "Five.", start: 0.98, end: 1.14 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["GTA 5's", "free", "PlayStation 5."]);
});

test("subtitle display merge renders spoken Grand Theft Auto six as GTA VI", () => {
  const words = [
    { text: "Grand", start: 0, end: 0.18 },
    { text: "Theft", start: 0.18, end: 0.36 },
    { text: "Auto", start: 0.36, end: 0.54 },
    { text: "six", start: 0.54, end: 0.74 },
    { text: "preorders", start: 0.76, end: 1.1 },
    { text: "changed", start: 1.1, end: 1.4 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["GTA VI", "preorders", "changed"]);
});

test("subtitle display merge hides malformed GTA VI ASR stutters", () => {
  const words = [
    { text: "GTA", start: 0, end: 0.18 },
    { text: "si", start: 0.18, end: 0.25 },
    { text: "six", start: 0.25, end: 0.44 },
    { text: "starts", start: 0.46, end: 0.7 },
    { text: "Grand", start: 0.72, end: 0.9 },
    { text: "Theft", start: 0.9, end: 1.08 },
    { text: "Auto", start: 1.08, end: 1.24 },
    { text: "si", start: 1.24, end: 1.32 },
    { text: "six.", start: 1.32, end: 1.52 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["GTA VI", "starts", "GTA VI."]);
});

test("subtitle display merge hides one-token GTA VI ASR stutters", () => {
  const words = [
    { text: "GTA", start: 0, end: 0.18 },
    { text: "si-six", start: 0.18, end: 0.44 },
    { text: "starts", start: 0.46, end: 0.7 },
    { text: "Grand", start: 0.72, end: 0.9 },
    { text: "Theft", start: 0.9, end: 1.08 },
    { text: "Auto", start: 1.08, end: 1.24 },
    { text: "si-six.", start: 1.24, end: 1.52 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["GTA VI", "starts", "GTA VI."]);
});

test("subtitle display merge renders PS five spellings as PlayStation 5", () => {
  const words = [
    { text: "P", start: 0, end: 0.1 },
    { text: "S", start: 0.1, end: 0.2 },
    { text: "five", start: 0.2, end: 0.45 },
    { text: "and", start: 0.45, end: 0.6 },
    { text: "PS", start: 0.6, end: 0.8 },
    { text: "Five.", start: 0.8, end: 1.05 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["PlayStation 5", "and", "PlayStation 5."]);
});

test("subtitle display merge converts spoken modern years without rewriting ordinary numbers", () => {
  const words = [
    { text: "twenty", start: 0, end: 0.1 },
    { text: "twenty", start: 0.1, end: 0.2 },
    { text: "six", start: 0.2, end: 0.3 },
    { text: "has", start: 0.3, end: 0.4 },
    { text: "twenty", start: 0.4, end: 0.5 },
    { text: "six", start: 0.5, end: 0.6 },
    { text: "demos", start: 0.6, end: 0.8 },
    { text: "twenty", start: 0.8, end: 0.9 },
    { text: "twenty", start: 0.9, end: 1 },
    { text: "seven.", start: 1, end: 1.1 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["2026", "has", "twenty", "six", "demos", "2027."]);
});

test("subtitle display merge repairs Cyberpunk 2077 ASR split tokens", () => {
  const words = [
    { text: "Cyberpunk", start: 0, end: 0.62 },
    { text: "2070", start: 0.62, end: 1.34 },
    { text: "seven's", start: 1.34, end: 2.04 },
    { text: "biggest", start: 2.04, end: 2.4 },
    { text: "launch", start: 2.4, end: 2.7 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["Cyberpunk 2077's", "biggest", "launch"]);
});

test("subtitle display merge repairs spoken Cyberpunk 2077 year tokens", () => {
  const words = [
    { text: "Cyberpunk", start: 0, end: 0.62 },
    { text: "twenty", start: 0.62, end: 1.04 },
    { text: "seventy", start: 1.04, end: 1.34 },
    { text: "seven's", start: 1.34, end: 1.78 },
    { text: "biggest", start: 1.78, end: 2.14 },
  ];

  const merged = mergeSubtitleWordsForDisplay(words).map((word) => word.text);

  assert.deepEqual(merged, ["Cyberpunk 2077's", "biggest"]);
});

test("legacy multi-image segment planner covers narration after xfade overlap", () => {
  const segment = planLegacySegmentDuration(62, 8, 0.5);
  const timeline = effectiveVisualTimelineDuration(segment, 8, 0.5);

  assert.equal(segment >= 8.19, true);
  assert.equal(timeline >= 62, true);
});

test("legacy segment planner avoids old floor-duration subtitle cut", () => {
  const oldSegment = Math.max(4, Math.floor(61 / 8));
  const oldTimeline = effectiveVisualTimelineDuration(oldSegment, 8, 0.5);
  const planned = planLegacySegmentDuration(61, 8, 0.5);
  const plannedTimeline = effectiveVisualTimelineDuration(planned, 8, 0.5);

  assert.equal(oldTimeline < 61, true);
  assert.equal(plannedTimeline >= 61, true);
});
