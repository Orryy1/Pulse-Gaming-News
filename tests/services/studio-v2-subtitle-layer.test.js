"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildKineticAss,
  buildWordPopDialogues,
  groupIntoPhrases,
  extractAssDialogueText,
} = require("../../lib/studio/v2/subtitle-layer-v2");

function assIntervals(ass) {
  return ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const m = line.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/);
      assert.ok(m, `dialogue line has parseable times: ${line}`);
      return m.slice(1).map((value) => {
        const parts = value.split(":").map(Number.parseFloat);
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      });
    });
}

test("buildKineticAss can skip script realignment for cached/non-editorial voice fixtures", () => {
  const ass = buildKineticAss({
    story: { title: "Test" },
    words: [
      { word: "twenty", start: 0, end: 0.25 },
      { word: "twenty", start: 0.26, end: 0.55 },
      { word: "six", start: 0.56, end: 0.8 },
      { word: "arrives", start: 0.82, end: 1.1 },
    ],
    duration: 2,
    scriptText: "2026 arrives",
    realign: false,
  });

  assert.match(ass, /twenty/);
  assert.match(ass, /six/);
  assert.doesNotMatch(ass, /2026/);
});

test("buildKineticAss falls back to synthetic timings when TTS alignment has huge gaps", () => {
  const scriptText = [
    "Mega Mewtwo is finally coming to Pokemon Go.",
    "The free Go Fest reveal means every player gets access.",
    "Niantic is changing the event model.",
  ].join(" ");
  const ass = buildKineticAss({
    story: { title: "Mega Mewtwo Pokemon Go" },
    words: [
      { word: "Mega", start: 4.1, end: 4.36 },
      { word: "Mewtwo", start: 9.34, end: 9.75 },
      { word: "is", start: 26.77, end: 26.87 },
      { word: "finally", start: 53.41, end: 53.86 },
    ],
    duration: 12,
    scriptText,
    realign: true,
  });

  const intervals = assIntervals(ass);
  assert.ok(intervals.length >= 4);
  assert.doesNotMatch(ass, /\.\d{3},/);
  for (let i = 1; i < intervals.length; i++) {
    assert.ok(
      intervals[i][0] - intervals[i - 1][1] <= 2,
      `caption gap too large between intervals ${i - 1} and ${i}`,
    );
  }
  assert.ok(intervals[intervals.length - 1][1] <= 12.1);
});

test("groupIntoPhrases caps creator subtitles at three words to avoid two-line blocks", () => {
  const phrases = groupIntoPhrases([
    { word: "Take-Two", start: 0, end: 0.2 },
    { word: "killed", start: 0.21, end: 0.42 },
    { word: "a", start: 0.43, end: 0.5 },
    { word: "legacy", start: 0.51, end: 0.75 },
    { word: "sequel.", start: 0.76, end: 1.0 },
  ]);

  assert.deepEqual(
    phrases.map((phrase) => phrase.words.map((word) => word.word)),
    [["Take-Two", "killed"], ["a", "legacy", "sequel."]],
  );
});

test("groupIntoPhrases splits long creator captions before they become two-line blocks", () => {
  const phrases = groupIntoPhrases([
    { word: "Developer", start: 0, end: 0.2 },
    { word: "passion", start: 0.21, end: 0.42 },
    { word: "has", start: 0.43, end: 0.5 },
    { word: "become", start: 0.51, end: 0.75 },
    { word: "a", start: 0.76, end: 0.85 },
    { word: "hard", start: 0.86, end: 1.0 },
    { word: "veto.", start: 1.01, end: 1.2 },
  ]);

  assert.deepEqual(
    phrases.map((phrase) => phrase.words.map((word) => word.word)),
    [["Developer"], ["passion", "has"], ["become", "a", "hard"], ["veto."]],
  );
  assert.ok(
    phrases.every((phrase) => phrase.words.map((word) => word.word).join(" ").length <= 16),
  );
});

test("buildWordPopDialogues uses hard spaces so short punches do not wrap", () => {
  const dialogues = buildWordPopDialogues(
    [
      {
        start: 0,
        end: 1.2,
        words: [
          { word: "GTA", start: 0, end: 0.2 },
          { word: "just", start: 0.21, end: 0.35 },
          { word: "changed", start: 0.36, end: 0.6 },
        ],
      },
    ],
    new Set(["GTA"]),
  );

  assert.match(dialogues[0], /GTA\\h/);
  assert.match(dialogues[0], /just\\h/);
});

test("buildKineticAss supports Flash captions capped at two-word punches", () => {
  const ass = buildKineticAss({
    story: { title: "GTA Red Dead BioShock" },
    words: [
      { word: "Developer", start: 0, end: 0.18 },
      { word: "passion", start: 0.2, end: 0.38 },
      { word: "has", start: 0.4, end: 0.52 },
      { word: "become", start: 0.54, end: 0.72 },
      { word: "a", start: 0.74, end: 0.86 },
      { word: "hard", start: 0.88, end: 1.02 },
      { word: "veto.", start: 1.04, end: 1.2 },
    ],
    duration: 3,
    scriptText: "Developer passion has become a hard veto.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
  });

  const captions = extractAssDialogueText(ass);
  assert.ok(captions.length >= 4);
  assert.ok(
    captions.every((caption) => caption.replace(/\\h/g, " ").split(/\s+/).filter(Boolean).length <= 2),
  );
});
