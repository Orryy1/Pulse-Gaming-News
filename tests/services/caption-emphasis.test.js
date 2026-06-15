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

test("caption emphasis collapses spoken acronym letters back to GTA digits", () => {
  const words = [
    { word: "G", start: 0, end: 0.1 },
    { word: "T", start: 0.12, end: 0.22 },
    { word: "A", start: 0.24, end: 0.34 },
    { word: "five", start: 0.36, end: 0.58 },
    { word: "became", start: 0.6, end: 0.9 },
    { word: "G", start: 1, end: 1.1 },
    { word: "T", start: 1.12, end: 1.22 },
    { word: "A", start: 1.24, end: 1.34 },
    { word: "six", start: 1.36, end: 1.58 },
  ];

  const aligned = realignTimestampsToScript("GTA 5 became GTA 6", words);

  assert.deepEqual(
    aligned.map((word) => word.word),
    ["GTA", "5", "became", "GTA", "6"],
  );

  const ass = buildAss({
    story: { title: "GTA 5" },
    scriptText: "GTA 5 became GTA 6",
    words,
    duration: 3,
  });

  assert.match(ass, /GTA/);
  assert.match(ass, /5/);
  assert.match(ass, /6/);
  assert.doesNotMatch(ass, /\bG\s+T\s+A\b/i);
  assert.doesNotMatch(ass, /\bfive\b/i);
  assert.doesNotMatch(ass, /\bsix\b/i);
});

test("caption emphasis restores Beastro display title from local TTS helper spelling", () => {
  const ass = buildAss({
    story: { title: "Beastro" },
    scriptText: "Beastrow wins if it makes strategy feel generous.",
    words: [
      { word: "Beastrow", start: 0, end: 0.42 },
      { word: "wins", start: 0.44, end: 0.62 },
      { word: "if", start: 0.64, end: 0.72 },
      { word: "it", start: 0.74, end: 0.82 },
      { word: "makes", start: 0.84, end: 1 },
      { word: "strategy", start: 1.02, end: 1.36 },
      { word: "feel", start: 1.38, end: 1.56 },
      { word: "generous", start: 1.58, end: 1.94 },
    ],
    duration: 3,
  });

  assert.match(ass, /Beastro/);
  assert.doesNotMatch(ass, /Beastrow/i);
});
