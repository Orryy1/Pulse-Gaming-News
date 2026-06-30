"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normaliseCaptionDisplayText,
  normaliseCaptionDisplayWords,
} = require("../../lib/caption-display-text");

test("caption display normalises GTA VI see-six ASR text variants", () => {
  assert.equal(
    normaliseCaptionDisplayText("GTA see-six starts the preorder fight."),
    "GTA VI starts the preorder fight.",
  );
  assert.equal(
    normaliseCaptionDisplayText("GTAVI starts the preorder fight."),
    "GTA VI starts the preorder fight.",
  );
  assert.equal(
    normaliseCaptionDisplayText("GTA-VI starts the preorder fight."),
    "GTA VI starts the preorder fight.",
  );
  assert.equal(
    normaliseCaptionDisplayText("Grand Theft Auto sea six finally moved."),
    "GTA VI finally moved.",
  );
  assert.equal(
    normaliseCaptionDisplayText("GTA size six starts the preorder fight."),
    "GTA VI starts the preorder fight.",
  );
});

test("caption display merges GTA VI see-six ASR word variants", () => {
  const words = [
    { word: "G", start: 0, end: 0.1 },
    { word: "T", start: 0.1, end: 0.2 },
    { word: "A", start: 0.2, end: 0.3 },
    { word: "see", start: 0.3, end: 0.45 },
    { word: "six", start: 0.45, end: 0.7 },
    { word: "starts", start: 0.8, end: 1.1 },
  ];

  const normalised = normaliseCaptionDisplayWords(words);

  assert.equal(normalised[0].word, "GTA VI");
  assert.equal(normalised[0].start, 0);
  assert.equal(normalised[0].end, 0.7);
  assert.equal(normalised[1].word, "starts");
});

test("caption display merges compact GTAVI ASR word variants", () => {
  const words = [
    { word: "GTAVI", start: 0, end: 0.3 },
    { word: "starts", start: 0.35, end: 0.6 },
  ];

  const normalised = normaliseCaptionDisplayWords(words);

  assert.equal(normalised[0].word, "GTA VI");
  assert.equal(normalised[0].start, 0);
  assert.equal(normalised[0].end, 0.3);
  assert.equal(normalised[1].word, "starts");
});
