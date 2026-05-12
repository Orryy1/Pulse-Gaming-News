"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildKineticAss,
  buildWordPopDialogues,
  groupIntoPhrases,
  extractAssDialogueText,
  planCaptionDensity,
  prepareSubtitleWords,
  transcriptCoverageRatio,
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

test("buildKineticAss falls back when alignment collapses long before narration ends", () => {
  const scriptText = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
  const words = Array.from({ length: 90 }, (_, i) => ({
    word: `word${i}`,
    start: i * 0.08,
    end: i * 0.08 + 0.04,
  }));

  const ass = buildKineticAss({
    story: { title: "Collapsed Alignment" },
    words,
    duration: 60,
    scriptText,
    realign: true,
  });

  const intervals = assIntervals(ass);
  assert.ok(intervals.length > 20);
  assert.ok(
    intervals[intervals.length - 1][1] >= 55,
    "caption timeline should cover the spoken narration instead of ending near the collapsed timestamp track",
  );
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

test("planCaptionDensity prefers one-line normal captions inside word and char caps", () => {
  const phrases = planCaptionDensity(
    [
      { word: "Pokemon", start: 0, end: 0.22 },
      { word: "fans", start: 0.23, end: 0.38 },
      { word: "get", start: 0.39, end: 0.52 },
      { word: "Mega", start: 0.53, end: 0.7 },
      { word: "Mewtwo.", start: 0.71, end: 0.96 },
    ],
    {
      maxWordsPerCaption: 3,
      maxCharsPerCaption: 18,
      preferOneLine: true,
    },
  );

  const captionTexts = phrases.map((phrase) => phrase.words.map((word) => word.word).join(" "));
  assert.deepEqual(captionTexts, ["Pokemon fans get", "Mega Mewtwo."]);
  assert.ok(captionTexts.every((caption) => !caption.includes("\n")));
  assert.ok(captionTexts.every((caption) => caption.split(/\s+/).length <= 3));
  assert.ok(captionTexts.every((caption) => caption.length <= 18));
});

test("planCaptionDensity splits long phrases into multiple punch captions", () => {
  const phrases = planCaptionDensity(
    [
      { word: "PlayStation", start: 0, end: 0.18 },
      { word: "showcase", start: 0.19, end: 0.36 },
      { word: "shadow", start: 0.37, end: 0.52 },
      { word: "drop", start: 0.53, end: 0.66 },
      { word: "just", start: 0.67, end: 0.78 },
      { word: "leaked.", start: 0.79, end: 0.98 },
    ],
    {
      maxWordsPerCaption: 2,
      maxCharsPerCaption: 14,
      preferOneLine: true,
    },
  );

  const captionTexts = phrases.map((phrase) => phrase.words.map((word) => word.word).join(" "));
  assert.deepEqual(captionTexts, [
    "PlayStation",
    "showcase",
    "shadow drop",
    "just leaked.",
  ]);
  assert.ok(captionTexts.every((caption) => caption.split(/\s+/).length <= 2));
  assert.ok(captionTexts.every((caption) => caption.length <= 14));
});

test("groupIntoPhrases can merge dangling Flash Lane caption fragments", () => {
  const phrases = groupIntoPhrases(
    [
      { word: "This", start: 0, end: 0.18 },
      { word: "as", start: 0.19, end: 0.35 },
      { word: "flagship", start: 0.36, end: 0.58 },
      { word: "launcher.", start: 0.59, end: 0.75 },
    ],
    {
      maxWordsPerPhrase: 2,
      maxPhraseChars: 16,
      avoidDanglingWords: true,
      danglingMergeMaxWords: 3,
    },
  );

  assert.deepEqual(
    phrases.map((phrase) => phrase.words.map((word) => word.word)),
    [["This", "as", "flagship"], ["launcher."]],
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

test("buildKineticAss can render Flash Lane captions in uppercase without changing timing", () => {
  const ass = buildKineticAss({
    story: { title: "Pokemon GTA" },
    words: [
      { word: "Pokemon", start: 0, end: 0.2 },
      { word: "just", start: 0.22, end: 0.36 },
      { word: "changed", start: 0.38, end: 0.6 },
    ],
    duration: 2,
    scriptText: "Pokemon just changed",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /POKEMON/);
  assert.doesNotMatch(captions, /Pokemon/);
  assert.ok(assIntervals(ass).every(([start, end]) => end > start));
});

test("buildKineticAss can keep full Flash punches visible while words pop", () => {
  const ass = buildKineticAss({
    story: { title: "Marathon Steam" },
    words: [
      { word: "Marathon", start: 0, end: 0.24 },
      { word: "just", start: 0.25, end: 0.38 },
      { word: "fell", start: 0.39, end: 0.58 },
      { word: "hard.", start: 0.59, end: 0.8 },
    ],
    duration: 2,
    scriptText: "Marathon just fell hard.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 16,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass);
  assert.deepEqual(captions.slice(0, 2), ["MARATHON\\hJUST", "FELL\\hHARD."]);
  assert.doesNotMatch(ass, /\\alpha&HFF&/);
  assert.match(ass, /\\t\(0,100,\\fscx115\\fscy115\)/);
});

test("buildKineticAss synthetic captions cover narration end and obey density caps", () => {
  const scriptText = "Pokemon fans get Mega Mewtwo before the free event timer closes tonight.";
  const ass = buildKineticAss({
    story: { title: "Pokemon Mega Mewtwo" },
    words: [],
    duration: 8,
    scriptText,
    maxWordsPerPhrase: 2,
    maxPhraseChars: 16,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const intervals = assIntervals(ass);
  const captions = extractAssDialogueText(ass).map((caption) => caption.replace(/\\h/g, " "));
  assert.ok(intervals.length >= 5);
  for (let i = 1; i < intervals.length; i++) {
    assert.ok(intervals[i][0] - intervals[i - 1][1] <= 0.25);
  }
  assert.ok(intervals[intervals.length - 1][1] >= 7.75);
  assert.ok(captions.every((caption) => caption.split(/\s+/).filter(Boolean).length <= 2));
  assert.ok(captions.every((caption) => caption.length <= 16));
});

test("prepareSubtitleWords rejects stale timestamp tracks when transcript coverage is low", () => {
  const scriptText =
    "GTA players just got a confirmed trailer clue and Rockstar fans are watching the next announcement window closely.";
  const staleWords = [
    { word: "Metro", start: 0.1, end: 0.4 },
    { word: "survivors", start: 0.45, end: 0.8 },
    { word: "walk", start: 0.85, end: 1.1 },
    { word: "through", start: 1.15, end: 1.42 },
    { word: "snow", start: 1.48, end: 1.8 },
    { word: "and", start: 1.85, end: 2.0 },
    { word: "tunnels", start: 2.05, end: 2.4 },
    { word: "again", start: 2.45, end: 2.8 },
    { word: "tonight", start: 2.85, end: 3.15 },
  ];

  assert.ok(transcriptCoverageRatio(staleWords, scriptText) < 0.35);
  const prepared = prepareSubtitleWords({
    words: staleWords,
    duration: 8,
    scriptText,
  });

  assert.equal(prepared[0].word, "GTA");
  assert.ok(prepared[prepared.length - 1].end >= 7.7);
  assert.notEqual(prepared[0].start, staleWords[0].start);
});

test("prepareSubtitleWords keeps healthy timestamp tracks with good transcript coverage", () => {
  const scriptText =
    "GTA players just got a confirmed trailer clue and Rockstar fans are watching the next announcement window closely.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.28,
    end: index * 0.28 + 0.18,
  }));

  assert.ok(transcriptCoverageRatio(words, scriptText) > 0.8);
  const prepared = prepareSubtitleWords({
    words,
    duration: 4.2,
    scriptText,
  });

  assert.equal(prepared[0].word, "GTA");
  assert.equal(prepared[1].start, words[1].start);
});

test("buildKineticAss can add TikTok-native Flash motion styling", () => {
  const ass = buildKineticAss({
    story: { title: "GTA Red Dead" },
    words: [
      { word: "GTA", start: 0, end: 0.2 },
      { word: "just", start: 0.22, end: 0.34 },
      { word: "changed", start: 0.36, end: 0.62 },
    ],
    duration: 2,
    scriptText: "GTA just changed",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
    motionStyle: "flash",
  });

  assert.match(ass, /\\move\(540,1484,540,1450,0,130\)/);
  assert.match(ass, /\\fad\(35,70\)/);
  assert.match(ass, /\\bord8\\shad5/);
  assert.match(ass, /\\t\(0,130,\\fscx106\\fscy106\)/);
});
