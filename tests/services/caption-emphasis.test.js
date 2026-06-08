"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAss, realignTimestampsToScript } = require("../../lib/caption-emphasis");

test("caption emphasis realignment preserves Hades II while local voice says Hades two", () => {
  const aligned = realignTimestampsToScript("Hades II lands on console.", [
    { word: "Hades", start: 0, end: 0.28 },
    { word: "two", start: 0.3, end: 0.5 },
    { word: "lands", start: 0.66, end: 0.92 },
    { word: "on", start: 0.96, end: 1.08 },
    { word: "console", start: 1.12, end: 1.44 },
  ]);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["Hades", "II", "lands", "on", "console."],
  );
  assert.equal(aligned[1].start, 0.3);
  assert.equal(aligned[1].end, 0.5);
});

test("caption emphasis repairs spoken modern year transcripts for display captions", () => {
  const ass = buildAss({
    story: { title: "Subnautica 2" },
    words: [
      { word: "launches", start: 0, end: 0.34 },
      { word: "in", start: 0.36, end: 0.46 },
      { word: "twenty", start: 0.48, end: 0.68 },
      { word: "twenty", start: 0.7, end: 0.9 },
      { word: "seven", start: 0.92, end: 1.16 },
    ],
    duration: 2,
    scriptText: "launches in twenty twenty seven.",
  });

  assert.match(ass, /2027/);
  assert.doesNotMatch(ass, /twenty twenty seven/i);
});
