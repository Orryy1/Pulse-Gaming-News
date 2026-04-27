"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  parseTarget,
  targetLabel,
  outputPathFor,
  buildLoudnormFilter,
} = require("../../tools/studio-v2-audio-master-ab");

test("parseTarget defaults and clamps to the safe benchmark range", () => {
  assert.equal(parseTarget("bad"), -14);
  assert.equal(parseTarget(-99), -24);
  assert.equal(parseTarget(-5), -12);
  assert.equal(parseTarget(-16), -16);
});

test("targetLabel creates stable output suffixes", () => {
  assert.equal(targetLabel(-14), "loudnorm14");
  assert.equal(targetLabel(-16.5), "loudnorm165");
});

test("outputPathFor builds a story-specific benchmark MP4 path", () => {
  const out = outputPathFor({ storyId: "1sn9xhe", target: -14 });
  assert.equal(path.basename(out), "studio_v2_1sn9xhe_loudnorm14.mp4");
});

test("buildLoudnormFilter includes target, true peak and LRA", () => {
  assert.equal(
    buildLoudnormFilter({ target: -14, truePeak: -1.5, lra: 11 }),
    "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=summary",
  );
});
