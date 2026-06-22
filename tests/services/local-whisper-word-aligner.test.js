"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  alignWordsWithLocalWhisper,
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

test("alignWordsWithLocalWhisper passes configured Whisper device", async () => {
  const calls = [];
  const result = await alignWordsWithLocalWhisper({
    audioPath: "C:\\media\\granblue.mp3",
    scriptText: "Granblue Fantasy Relink just made its next update harder to ignore.",
    model: "tiny.en",
    device: "cpu",
    execFileImpl: async (python, args) => {
      calls.push({ python, args });
      return {
        stdout: JSON.stringify({
          model: "tiny.en",
          language: "en",
          text: "Granblue Fantasy Relink",
          segments: [
            {
              text: "Granblue Fantasy Relink",
              start: 0,
              end: 1.2,
              words: [
                { word: "Granblue", start: 0, end: 0.4 },
                { word: "Fantasy", start: 0.42, end: 0.78 },
                { word: "Relink", start: 0.8, end: 1.2 },
              ],
            },
          ],
        }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const deviceIndex = calls[0].args.indexOf("--device");
  assert.notEqual(deviceIndex, -1);
  assert.equal(calls[0].args[deviceIndex + 1], "cpu");
});
