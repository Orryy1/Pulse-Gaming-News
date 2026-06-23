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

test("caption emphasis repairs Cyberpunk 2077 ASR split before phrase grouping", () => {
  const ass = buildAss({
    story: { title: "Cyberpunk 2077's Trust Debt" },
    words: [
      { word: "Cyberpunk", start: 0, end: 0.62 },
      { word: "twenty", start: 0.62, end: 1.04 },
      { word: "seventy", start: 1.04, end: 1.34 },
      { word: "seven's", start: 1.34, end: 1.78 },
      { word: "biggest", start: 1.78, end: 2.14 },
      { word: "launch", start: 2.14, end: 2.44 },
    ],
    duration: 3,
    scriptText: "Cyberpunk 2077's biggest launch problem is not bugs anymore.",
  });

  assert.match(ass, /Cyberpunk[\s\S]*2077/i);
  assert.doesNotMatch(ass, /twenty/i);
  assert.doesNotMatch(ass, /seventy/i);
  assert.doesNotMatch(ass, /seven's/i);
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

test("caption emphasis restores Grand Theft Auto roman numerals from spoken local TTS words", () => {
  const ass = buildAss({
    story: { title: "Grand Theft Auto VI Cover Art" },
    scriptText: "Grand Theft Auto Six just revealed its cover.",
    words: [
      { word: "Grand", start: 0, end: 0.14 },
      { word: "Theft", start: 0.16, end: 0.32 },
      { word: "Auto", start: 0.34, end: 0.52 },
      { word: "Six", start: 0.54, end: 0.7 },
      { word: "just", start: 0.72, end: 0.88 },
      { word: "revealed", start: 0.9, end: 1.2 },
      { word: "its", start: 1.22, end: 1.34 },
      { word: "cover.", start: 1.36, end: 1.7 },
    ],
    duration: 3,
  });

  assert.match(ass, /Grand Theft Auto VI/i);
  assert.doesNotMatch(ass, /Grand Theft Auto Six/i);
});

test("caption emphasis restores spoken two-digit dates to script digits", () => {
  const ass = buildAss({
    story: { title: "Grand Theft Auto VI Pre Orders" },
    scriptText: "Pre orders open on June 25.",
    words: [
      { word: "Pre", start: 0, end: 0.16 },
      { word: "orders", start: 0.18, end: 0.48 },
      { word: "open", start: 0.5, end: 0.78 },
      { word: "on", start: 0.8, end: 0.94 },
      { word: "June", start: 0.96, end: 1.18 },
      { word: "twenty", start: 1.2, end: 1.44 },
      { word: "five.", start: 1.46, end: 1.72 },
    ],
    duration: 3,
  });

  assert.match(ass, /June[\s\S]*25/i);
  assert.doesNotMatch(ass, /twenty five/i);
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
