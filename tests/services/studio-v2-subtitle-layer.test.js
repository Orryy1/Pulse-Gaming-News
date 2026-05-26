"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildKineticAss,
  buildWordPopDialogues,
  groupIntoPhrases,
  extractAssDialogueText,
  planCaptionDensity,
  prepareSubtitleWords,
  realignTimestampsToScript,
  transcriptCoverageRatio,
} = require("../../lib/studio/v2/subtitle-layer-v2");

const ROOT = path.resolve(__dirname, "..", "..");

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

test("realignTimestampsToScript preserves numeric display tokens over spoken number expansions", () => {
  const aligned = realignTimestampsToScript("Steam early-access launch hit 130,000 concurrent players.", [
    { word: "Steam", start: 0, end: 0.18 },
    { word: "early", start: 0.2, end: 0.38 },
    { word: "access", start: 0.42, end: 0.62 },
    { word: "launch", start: 0.66, end: 0.82 },
    { word: "hit", start: 0.86, end: 1 },
    { word: "one", start: 1.04, end: 1.16 },
    { word: "hundred", start: 1.18, end: 1.38 },
    { word: "and", start: 1.4, end: 1.5 },
    { word: "thirty", start: 1.52, end: 1.72 },
    { word: "thousand", start: 1.74, end: 1.98 },
    { word: "concurrent", start: 2.02, end: 2.42 },
    { word: "players", start: 2.46, end: 2.74 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["Steam", "early-access", "launch", "hit", "130,000", "concurrent", "players."],
  );
  assert.equal(aligned[1].start, 0.2);
  assert.equal(aligned[1].end, 0.62);
  assert.equal(aligned[4].start, 1.04);
  assert.equal(aligned[4].end, 1.98);
});

test("prepareSubtitleWords keeps real numeric timings across natural local-TTS pauses", () => {
  const scriptText =
    "GamesRadar reports the early-access launch hit 130,000 concurrent players on Steam. It is only the premium launch crowd.";
  const aligned = realignTimestampsToScript(scriptText, [
    { word: "GamesRadar", start: 0, end: 0.38 },
    { word: "reports", start: 0.42, end: 0.72 },
    { word: "the", start: 0.76, end: 0.88 },
    { word: "early", start: 0.92, end: 1.12 },
    { word: "access", start: 1.16, end: 1.38 },
    { word: "launch", start: 1.42, end: 1.62 },
    { word: "hit", start: 1.66, end: 1.8 },
    { word: "one", start: 1.84, end: 1.96 },
    { word: "hundred", start: 1.98, end: 2.18 },
    { word: "and", start: 2.2, end: 2.3 },
    { word: "thirty", start: 2.32, end: 2.52 },
    { word: "thousand", start: 2.54, end: 2.78 },
    { word: "concurrent", start: 2.82, end: 3.22 },
    { word: "players", start: 3.26, end: 3.54 },
    { word: "on", start: 3.58, end: 3.7 },
    { word: "Steam.", start: 3.74, end: 3.98 },
    { word: "It", start: 6.78, end: 6.9 },
    { word: "is", start: 6.94, end: 7.04 },
    { word: "only", start: 7.08, end: 7.28 },
    { word: "the", start: 7.32, end: 7.42 },
    { word: "premium", start: 7.46, end: 7.74 },
    { word: "launch", start: 7.78, end: 7.98 },
    { word: "crowd.", start: 8.02, end: 8.34 },
  ]);

  const prepared = prepareSubtitleWords({
    words: aligned,
    duration: 9,
    scriptText,
  });

  const number = prepared.find((word) => word.word === "130,000");
  assert.ok(number, "numeric display token should survive preparation");
  assert.equal(number.start, 1.84);
  assert.equal(number.end, 2.78);
  assert.equal(prepared.find((word) => word.word === "It")?.start, 6.78);
});

test("realignTimestampsToScript consumes direct spoken currency units", () => {
  const aligned = realignTimestampsToScript("players paid 120 dollars early.", [
    { word: "players", start: 0, end: 0.24 },
    { word: "paid", start: 0.26, end: 0.44 },
    { word: "120", start: 0.48, end: 0.72 },
    { word: "dollars", start: 0.74, end: 1.04 },
    { word: "early", start: 1.08, end: 1.34 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["players", "paid", "$120", "early."],
  );
  assert.equal(aligned[2].start, 0.48);
  assert.equal(aligned[2].end, 1.04);
});

test("realignTimestampsToScript preserves Hades II display while audio says Hades number two", () => {
  const aligned = realignTimestampsToScript("Hades II lands on console.", [
    { word: "Hades", start: 0, end: 0.28 },
    { word: "number", start: 0.3, end: 0.42 },
    { word: "two", start: 0.44, end: 0.62 },
    { word: "lands", start: 0.66, end: 0.92 },
    { word: "on", start: 0.96, end: 1.08 },
    { word: "console", start: 1.12, end: 1.44 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["Hades", "II", "lands", "on", "console."],
  );
  assert.equal(aligned[1].start, 0.3);
  assert.equal(aligned[1].end, 0.62);
});

test("realignTimestampsToScript repairs local Whisper brand-name misrecognition", () => {
  const aligned = realignTimestampsToScript("Follow Pulse Gaming so you never miss a beat.", [
    { word: "Follow", start: 41.3, end: 41.3 },
    { word: "Paul", start: 41.3, end: 41.6 },
    { word: "Skaming,", start: 41.6, end: 41.94 },
    { word: "so", start: 42.22, end: 42.32 },
    { word: "you", start: 42.32, end: 42.46 },
    { word: "never", start: 42.46, end: 42.6 },
    { word: "miss", start: 42.6, end: 42.78 },
    { word: "a", start: 42.78, end: 42.92 },
    { word: "beat.", start: 42.92, end: 43.06 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["Follow", "Pulse", "Gaming", "so", "you", "never", "miss", "a", "beat."],
  );
  assert.equal(aligned[1].start, 41.3);
  assert.equal(aligned[1].end, 41.6);
  assert.equal(aligned[2].start, 41.6);
  assert.equal(aligned[2].end, 41.94);
});

test("realignTimestampsToScript skips one-word ASR duplicates when the next timestamp matches", () => {
  const aligned = realignTimestampsToScript("clean reads and players breaking builds", [
    { word: "clean", start: 29.72, end: 29.8 },
    { word: "reads", start: 29.8, end: 29.98 },
    { word: "and", start: 29.98, end: 29.98 },
    { word: "and", start: 29.98, end: 30.32 },
    { word: "players", start: 30.32, end: 30.62 },
    { word: "breaking", start: 30.62, end: 30.96 },
    { word: "builds", start: 30.96, end: 31.28 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["clean", "reads", "and", "players", "breaking", "builds"],
  );
  assert.equal(aligned[3].start, 30.32);
  assert.equal(aligned[3].end, 30.62);
});

test("buildKineticAss burns numeric captions while audio speaks the expanded number", () => {
  const ass = buildKineticAss({
    story: { title: "Forza Horizon 6" },
    words: [
      { word: "Steam", start: 0, end: 0.18 },
      { word: "hit", start: 0.2, end: 0.34 },
      { word: "one", start: 0.4, end: 0.52 },
      { word: "hundred", start: 0.54, end: 0.74 },
      { word: "and", start: 0.76, end: 0.86 },
      { word: "thirty", start: 0.88, end: 1.08 },
      { word: "thousand", start: 1.1, end: 1.34 },
      { word: "players", start: 1.38, end: 1.72 },
    ],
    duration: 3,
    scriptText: "Steam hit 130,000 players.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /130,000/);
  assert.doesNotMatch(captions, /ONE/);
  assert.doesNotMatch(captions, /THIRTY/);
  assert.doesNotMatch(captions, /THOUSAND/);
});

test("buildKineticAss burns currency captions while audio speaks dollars", () => {
  const ass = buildKineticAss({
    story: { title: "Premium Launch" },
    words: [
      { word: "The", start: 0, end: 0.12 },
      { word: "premium", start: 0.14, end: 0.42 },
      { word: "early", start: 0.44, end: 0.62 },
      { word: "access", start: 0.64, end: 0.86 },
      { word: "crowd", start: 0.88, end: 1.08 },
      { word: "paid", start: 1.1, end: 1.28 },
      { word: "around", start: 1.3, end: 1.56 },
      { word: "one", start: 1.6, end: 1.72 },
      { word: "hundred", start: 1.74, end: 1.96 },
      { word: "and", start: 1.98, end: 2.08 },
      { word: "twenty", start: 2.1, end: 2.34 },
      { word: "dollars", start: 2.36, end: 2.66 },
      { word: "before", start: 2.7, end: 2.94 },
      { word: "launch", start: 2.96, end: 3.22 },
    ],
    duration: 4,
    scriptText: "The premium early-access crowd paid around $120 before launch.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /\$120/);
  assert.doesNotMatch(captions, /120 DOLLARS/);
  assert.doesNotMatch(captions, /DOLLARS/);
  assert.doesNotMatch(captions, /ONE/);
  assert.doesNotMatch(captions, /TWENTY/);
});

test("buildKineticAss compacts numeric dollar phrases in caption scripts", () => {
  const ass = buildKineticAss({
    story: { title: "Premium Launch" },
    words: [
      { word: "paid", start: 0, end: 0.18 },
      { word: "around", start: 0.2, end: 0.46 },
      { word: "one", start: 0.5, end: 0.62 },
      { word: "hundred", start: 0.64, end: 0.86 },
      { word: "and", start: 0.88, end: 0.98 },
      { word: "twenty", start: 1, end: 1.24 },
      { word: "dollars", start: 1.26, end: 1.56 },
      { word: "early", start: 1.6, end: 1.82 },
    ],
    duration: 3,
    scriptText: "paid around 120 dollars early.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /\$120/);
  assert.doesNotMatch(captions, /120 DOLLARS/);
  assert.doesNotMatch(captions, /DOLLARS/);
});

test("buildKineticAss consumes spoken dollars after direct numeric currency timestamps", () => {
  const ass = buildKineticAss({
    story: { title: "Premium Launch" },
    words: [
      { word: "paid", start: 0, end: 0.18 },
      { word: "around", start: 0.2, end: 0.46 },
      { word: "120", start: 0.5, end: 0.78 },
      { word: "dollars", start: 0.8, end: 1.14 },
      { word: "early", start: 1.18, end: 1.42 },
    ],
    duration: 2.5,
    scriptText: "paid around 120 dollars early.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /\$120/);
  assert.doesNotMatch(captions, /\$120 DOLLARS/);
  assert.doesNotMatch(captions, /DOLLARS/);
});

test("buildKineticAss consumes hyphenated numeric metric suffixes before currency captions", () => {
  const ass = buildKineticAss({
    story: { title: "Forza Horizon 6 Steam update" },
    words: [
      { word: "reports", start: 0, end: 0.2 },
      { word: "a", start: 0.22, end: 0.3 },
      { word: "one", start: 0.32, end: 0.42 },
      { word: "hundred", start: 0.44, end: 0.6 },
      { word: "and", start: 0.62, end: 0.68 },
      { word: "seventy", start: 0.7, end: 0.86 },
      { word: "eight", start: 0.88, end: 1.0 },
      { word: "thousand", start: 1.02, end: 1.22 },
      { word: "and", start: 1.24, end: 1.3 },
      { word: "nine", start: 1.32, end: 1.48 },
      { word: "player", start: 1.5, end: 1.7 },
      { word: "Steam", start: 1.72, end: 1.92 },
      { word: "peak", start: 1.94, end: 2.14 },
      { word: "tied", start: 2.16, end: 2.34 },
      { word: "to", start: 2.36, end: 2.46 },
      { word: "the", start: 2.48, end: 2.58 },
      { word: "120", start: 2.6, end: 2.82 },
      { word: "dollars", start: 2.84, end: 3.08 },
      { word: "Premium", start: 3.1, end: 3.34 },
    ],
    duration: 4,
    scriptText:
      "reports a 178,009-player Steam peak tied to the $120 Premium Edition.",
    maxWordsPerPhrase: 3,
    maxPhraseChars: 18,
    captionCase: "upper",
    revealMode: "phrase",
  });

  const captions = extractAssDialogueText(ass).join(" ");
  assert.match(captions, /178,009-PLAYER/);
  assert.doesNotMatch(captions, /PLAYER\\hSTEAM/);
  assert.match(captions, /\$120/);
  assert.doesNotMatch(captions, /120 DOLLARS/);
});

test("buildKineticAss repairs early-ending cached voice timings without swapping in editorial text", () => {
  const ass = buildKineticAss({
    story: { title: "Cached Voice" },
    words: [
      { word: "spoken", start: 0, end: 0.22 },
      { word: "cached", start: 0.24, end: 0.48 },
      { word: "voice", start: 0.5, end: 0.78 },
      { word: "track", start: 0.8, end: 1.04 },
    ],
    duration: 8,
    scriptText: "editorial text should not replace cached narration",
    realign: false,
  });

  const intervals = assIntervals(ass);
  assert.match(ass, /spoken/);
  assert.match(ass, /cached/);
  assert.doesNotMatch(ass, /editorial/);
  assert.ok(
    intervals[intervals.length - 1][1] >= 7.5,
    "cached/non-editorial subtitle timings should still cover the full narration duration",
  );
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

test("buildWordPopDialogues carries centiseconds at minute boundaries", () => {
  const dialogues = buildWordPopDialogues(
    [
      {
        start: 59.996,
        end: 60.504,
        words: [
          { word: "clean", start: 59.996, end: 60.004 },
          { word: "timing", start: 60.004, end: 60.504 },
        ],
      },
    ],
    new Set(),
  );
  const ass = dialogues.join("\n");

  assert.doesNotMatch(ass, /\.100/);
  assert.match(ass, /0:01:00\.00/);
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

test("buildKineticAss repairs tracks that end several seconds before narration", () => {
  const scriptText = Array.from({ length: 120 }, (_, i) => `beat${i}`).join(" ");
  const words = Array.from({ length: 120 }, (_, i) => {
    const start = (i / 120) * 55.2;
    return {
      word: `beat${i}`,
      start: Number(start.toFixed(3)),
      end: Number((start + 0.18).toFixed(3)),
    };
  });

  const ass = buildKineticAss({
    story: { title: "Early Ending Alignment" },
    words,
    duration: 60,
    scriptText,
    realign: true,
  });

  const intervals = assIntervals(ass);
  assert.ok(intervals.length > 20);
  assert.ok(
    intervals[intervals.length - 1][1] >= 59,
    "caption timeline should be regenerated when source timestamps stop several seconds early",
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

test("planCaptionDensity splits captions before a loose phrase drifts off sync", () => {
  const phrases = planCaptionDensity(
    [
      { word: "GTA", start: 0, end: 0.18 },
      { word: "delay", start: 0.82, end: 1.02 },
      { word: "watch", start: 1.72, end: 1.94 },
    ],
    {
      maxWordsPerCaption: 3,
      maxCharsPerCaption: 18,
      maxDurationPerCaption: 1.15,
    },
  );

  const captionTexts = phrases.map((phrase) => phrase.words.map((word) => word.word).join(" "));
  assert.deepEqual(captionTexts, ["GTA delay", "watch"]);
  assert.ok(phrases.every((phrase) => phrase.end - phrase.start <= 1.15));
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

test("groupIntoPhrases merges short sentence-tail words backwards in Flash captions", () => {
  const phrases = groupIntoPhrases(
    [
      { word: "dismiss", start: 0, end: 0.28 },
      { word: "it.", start: 0.3, end: 0.52 },
      { word: "This", start: 1.2, end: 1.44 },
      { word: "matters.", start: 1.46, end: 1.8 },
    ],
    {
      maxWordsPerPhrase: 2,
      maxPhraseChars: 16,
      avoidDanglingWords: true,
      danglingMergeMaxWords: 2,
      maxPhraseDurationS: 1.15,
    },
  );

  const captionTexts = phrases.map((phrase) => phrase.words.map((word) => word.word).join(" "));
  assert.deepEqual(captionTexts, ["dismiss it.", "This matters."]);
});

test("groupIntoPhrases will not merge dangling words into overlong Flash captions", () => {
  const phrases = groupIntoPhrases(
    [
      { word: "GTA", start: 0, end: 0.18 },
      { word: "delay", start: 0.82, end: 1.02 },
      { word: "watch", start: 1.72, end: 1.94 },
    ],
    {
      maxWordsPerPhrase: 2,
      maxPhraseChars: 16,
      maxPhraseDurationS: 1.15,
      avoidDanglingWords: true,
      danglingMergeMaxWords: 3,
    },
  );

  const captionTexts = phrases.map((phrase) => phrase.words.map((word) => word.word).join(" "));
  assert.deepEqual(captionTexts, ["GTA delay", "watch"]);
  assert.ok(phrases.every((phrase) => phrase.end - phrase.start <= 1.15));
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

test("buildKineticAss can merge short Flash sentence tails into three-word punches", () => {
  const ass = buildKineticAss({
    story: { title: "Forza Steam" },
    words: [
      { word: "numbers", start: 0, end: 0.24 },
      { word: "behind", start: 0.28, end: 0.54 },
      { word: "it.", start: 0.58, end: 0.82 },
    ],
    duration: 1.4,
    scriptText: "numbers behind it.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 18,
    captionCase: "upper",
    revealMode: "phrase",
    motionStyle: "flash",
    avoidDanglingWords: true,
    danglingMergeMaxWords: 3,
  });

  const captions = extractAssDialogueText(ass).map((caption) => caption.replace(/\\h/g, " "));
  assert.deepEqual(captions, ["NUMBERS BEHIND IT."]);
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

test("still-deck enriched proofs use phrase reveal to avoid lonely word holds", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(source, /revealMode:\s*flash\s*\?\s*"phrase"\s*:\s*"word"/);
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

test("prepareSubtitleWords rejects stale cached tracks even when end coverage is relaxed", () => {
  const scriptText =
    "Subnautica 2 just crossed a million sales and the player count is already massive.";
  const staleWords = [
    { word: "Metro", start: 0.1, end: 0.3 },
    { word: "Exodus", start: 0.35, end: 0.6 },
    { word: "players", start: 0.65, end: 0.9 },
    { word: "return", start: 0.95, end: 1.2 },
    { word: "again", start: 1.25, end: 1.5 },
  ];

  assert.ok(transcriptCoverageRatio(staleWords, scriptText) < 0.35);
  const prepared = prepareSubtitleWords({
    words: staleWords,
    duration: 6,
    scriptText,
    strictEndCoverage: false,
  });

  assert.equal(prepared[0].word, "Subnautica");
  assert.ok(prepared[prepared.length - 1].end >= 5.7);
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

test("buildKineticAss Flash word reveal hides later words until their timestamps", () => {
  const ass = buildKineticAss({
    story: { title: "GTA delay" },
    words: [
      { word: "GTA", start: 0, end: 0.2 },
      { word: "delay", start: 0.72, end: 0.96 },
      { word: "hits", start: 1.08, end: 1.24 },
      { word: "tonight.", start: 1.3, end: 1.56 },
    ],
    duration: 2,
    scriptText: "GTA delay hits tonight.",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "word",
    motionStyle: "flash",
  });

  assert.match(ass, /GTA\\h/);
  assert.match(ass, /\\alpha&HFF&\\t\(719,750,\\alpha&H00&\).*DELAY/);
});

test("buildWordPopDialogues does not let short caption holds overlap the next punch", () => {
  const dialogues = buildWordPopDialogues(
    [
      {
        start: 0,
        end: 0.22,
        words: [{ word: "GTA", start: 0, end: 0.22 }],
      },
      {
        start: 0.28,
        end: 0.48,
        words: [{ word: "delay", start: 0.28, end: 0.48 }],
      },
    ],
    new Set(["GTA"]),
  );
  const intervals = assIntervals(dialogues.join("\n"));

  assert.equal(intervals.length, 2);
  assert.ok(
    intervals[0][1] <= intervals[1][0],
    `previous caption should clear before next starts: ${JSON.stringify(intervals)}`,
  );
});

test("buildKineticAss clamps overlong Flash caption tokens inside the one-line safe width", () => {
  const ass = buildKineticAss({
    story: { title: "PlayStation Showcase" },
    words: [
      { word: "SupercalifragilisticexpialidociousEdition", start: 0, end: 0.4 },
      { word: "leaked", start: 0.44, end: 0.72 },
    ],
    duration: 2,
    scriptText: "SupercalifragilisticexpialidociousEdition leaked",
    maxWordsPerPhrase: 2,
    maxPhraseChars: 14,
    captionCase: "upper",
    revealMode: "phrase",
    motionStyle: "flash",
  });
  const captions = extractAssDialogueText(ass).map((caption) => caption.replace(/\\h/g, " "));

  assert.ok(captions.length >= 2, captions.join(" | "));
  assert.ok(captions.every((caption) => caption.length <= 14), captions.join(" | "));
  assert.match(captions[0], /\.\.\.$/);
});
