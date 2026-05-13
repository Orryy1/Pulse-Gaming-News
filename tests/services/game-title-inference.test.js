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

test("headline inference trims newsy prefixes and platform utility suffixes", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("The next Tales Of remaster has leaked, and it's probably not what you're expecting"),
    ["Tales Of"],
  );
  assert.deepEqual(
    inferHeadlineGameCandidates("A New The Division PC Game Is Out Right Now, And It's Free"),
    ["The Division"],
  );
});

test("headline inference extracts mid-sentence subjects after release-age framing", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates(
      "It's been a year since release and Oblivion Remastered is still broken- Digital Foundry",
    ),
    ["Oblivion"],
  );
});

test("headline inference still accepts real colon-separated game title candidates", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("LEGO Batman: Legacy of the Dark Knight PC specs revealed"),
    ["LEGO Batman", "Legacy of the Dark Knight"],
  );
});

test("headline inference rejects sentence fragments as game titles", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("Even tho I can\u2019t download you. You will always be on my phone."),
    [],
  );
});

test("headline inference stops modal contractions before they become game names", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("Call of Duty won't hit Xbox Game Pass on day one anymore"),
    ["Call of Duty"],
  );
});

test("headline inference trims possessive news adverbs from game names", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("Pragmata's newly delayed demo finally gets a fresh date"),
    ["Pragmata"],
  );
});

test("headline inference rejects editorial colon fragments but keeps credited games", () => {
  assert.deepEqual(
    inferHeadlineGameCandidates("It's brutal out there: Deus Ex and Unreal composer says game music is changing"),
    ["Deus Ex", "Unreal"],
  );
});

test("headline candidate guard rejects source labels and quoted fragments", () => {
  assert.equal(isLikelyGameTitleCandidate("Digital Foundry"), false);
  assert.equal(isLikelyGameTitleCandidate("'Eventually the slop"), false);
  assert.equal(isLikelyGameTitleCandidate("I can't download you. You"), false);
  assert.equal(isLikelyGameTitleCandidate("It's brutal out there"), false);
});
