"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferHeadlineGameCandidates,
  isLikelyGameTitleCandidate,
} = require("../../lib/game-title-inference");

test("headline inference ignores outlet prefixes and filler before game titles", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("Digital Foundry: Yup, Oblivion Remastered Is Still Broken a Year After Release"),
    ["Oblivion"],
  );
});

test("headline inference rejects quoted article phrases but keeps the game after the colon", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates(
      "'Eventually the slop will just fall to the bottom': Garry's Mod sequel launches to mixed reviews",
    ),
    ["Garry's Mod"],
  );
});

test("headline inference trims release-time utility phrasing from title candidates", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("Invincible VS Global Release Times Confirmed"),
    ["Invincible VS"],
  );
});

test("headline inference still accepts real colon-separated game title candidates", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("LEGO Batman: Legacy of the Dark Knight PC specs revealed"),
    ["LEGO Batman", "Legacy of the Dark Knight"],
  );
});

test("headline candidate guard rejects source labels and quoted fragments", () => {
  assert.equal(isLikelyGameTitleCandidate("Digital Foundry"), false);
  assert.equal(isLikelyGameTitleCandidate("'Eventually the slop"), false);
});
