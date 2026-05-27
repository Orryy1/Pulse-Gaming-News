"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normaliseWhisperWords,
  parseWhisperJson,
} = require("../../lib/local-whisper-word-aligner");

test("normaliseWhisperWords extracts word-level timings from Whisper segments", () => {
  const words = normaliseWhisperWords({
    segments: [
      {
        text: " Hades two lands",
        words: [
          { word: " Hades", start: 0.12, end: 0.36 },
          { word: " two", start: 0.38, end: 0.52 },
          { word: " lands", start: 0.56, end: 0.86 },
        ],
      },
    ],
  });

  assert.deepEqual(words, [
    { word: "Hades", start: 0.12, end: 0.36 },
    { word: "two", start: 0.38, end: 0.52 },
    { word: "lands", start: 0.56, end: 0.86 },
  ]);
});

test("normaliseWhisperWords distributes segment text when word details are absent", () => {
  const words = normaliseWhisperWords({
    segments: [
      {
        text: "Hades two",
        start: 1,
        end: 1.6,
      },
    ],
  });

  assert.deepEqual(words, [
    { word: "Hades", start: 1, end: 1.3 },
    { word: "two", start: 1.3, end: 1.6 },
  ]);
});

test("parseWhisperJson returns parsed JSON payloads", () => {
  assert.deepEqual(parseWhisperJson('{"text":"Hades two"}'), {
    text: "Hades two",
  });
});
