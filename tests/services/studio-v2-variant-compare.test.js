"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  variantSuffix,
  mp4Path,
  safeName,
} = require("../../tools/studio-v2-variant-compare");

test("variantSuffix maps canonical to the base render", () => {
  assert.equal(variantSuffix("canonical"), "");
  assert.equal(variantSuffix("nofreeze"), "_nofreeze");
});

test("mp4Path builds the expected studio v2 filename", () => {
  const canonical = mp4Path("1sn9xhe", "canonical");
  const nofreeze = mp4Path("1sn9xhe", "nofreeze");
  assert.equal(path.basename(canonical), "studio_v2_1sn9xhe.mp4");
  assert.equal(path.basename(nofreeze), "studio_v2_1sn9xhe_nofreeze.mp4");
});

test("safeName produces filesystem-friendly variant labels", () => {
  assert.equal(safeName("snapshot-3954f4c"), "snapshot_3954f4c");
});
