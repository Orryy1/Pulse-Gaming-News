"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { realignTimestampsToScript } = require("../../lib/caption-emphasis");

test("caption emphasis realignment preserves Hades II while local voice says Hades, two", () => {
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
