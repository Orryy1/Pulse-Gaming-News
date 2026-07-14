"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareVideoFingerprints,
  _private: { frameDifferenceHash, hammingDistance },
} = require("../../lib/video-visual-fingerprint");

test("frame difference hash distinguishes opposite horizontal gradients", () => {
  const ascending = Buffer.alloc(9 * 8);
  const descending = Buffer.alloc(9 * 8);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      ascending[row * 9 + column] = column;
      descending[row * 9 + column] = 8 - column;
    }
  }

  assert.equal(frameDifferenceHash(ascending), "0000000000000000");
  assert.equal(frameDifferenceHash(descending), "ffffffffffffffff");
  assert.equal(hammingDistance(frameDifferenceHash(ascending), frameDifferenceHash(descending)), 64);
});

test("temporal fingerprints match clips with small frame-level changes", () => {
  const result = compareVideoFingerprints(
    {
      hashes: [
        "0000000000000000",
        "1111111111111111",
        "2222222222222222",
        "3333333333333333",
        "4444444444444444",
      ],
    },
    {
      hashes: [
        "0000000000000001",
        "1111111111111113",
        "2222222222222220",
        "3333333333333337",
        "444444444444444c",
      ],
    },
  );

  assert.equal(result.near_duplicate, true);
  assert.equal(result.matched_frames, 5);
  assert.equal(result.required_matches, 3);
});

test("temporal fingerprints reject visually different clips", () => {
  const result = compareVideoFingerprints(
    { hashes: Array(5).fill("0000000000000000") },
    { hashes: Array(5).fill("ffffffffffffffff") },
  );

  assert.equal(result.near_duplicate, false);
  assert.equal(result.matched_frames, 0);
});

test("opaque test signatures only match exact signatures", () => {
  assert.equal(compareVideoFingerprints("clip-a", "clip-a").near_duplicate, true);
  assert.equal(compareVideoFingerprints("clip-a", "clip-b").near_duplicate, false);
});
