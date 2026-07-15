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

test("caption display compacts spoken currency tokens for burned-in subtitles", () => {
  const words = [
    { word: "84", start: 0, end: 0.2 },
    { word: "dollars", start: 0.2, end: 0.5 },
    { word: "91,", start: 0.5, end: 0.75 },
    { word: "versus", start: 0.8, end: 1.05 },
    { word: "59", start: 1.05, end: 1.25 },
    { word: "dollars", start: 1.25, end: 1.55 },
    { word: "99.", start: 1.55, end: 1.8 },
  ];

  const normalised = normaliseCaptionDisplayWords(words);

  assert.equal(normalised[0].word, "$84.91,");
  assert.equal(normalised[0].start, 0);
  assert.equal(normalised[0].end, 0.75);
  assert.equal(normalised[1].word, "versus");
  assert.equal(normalised[2].word, "$59.99.");
  assert.equal(normalised[2].start, 1.05);
  assert.equal(normalised[2].end, 1.8);
});
