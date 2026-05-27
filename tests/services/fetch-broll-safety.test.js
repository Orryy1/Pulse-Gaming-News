"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveBrollSearchTitles,
  hasStrongTitleMatch,
  isSafeYoutubeTrailerCandidate,
  selectSafeYoutubeTrailerCandidate,
  chooseClipWindow,
} = require("../../fetch_broll");
const { extractGameTitles } = require("../../lib/script-game-enrichment");

function ytCandidate({
  videoId = "abc123",
  title,
  channelTitle,
  description = "",
} = {}) {
  return {
    id: { videoId },
    snippet: { title, channelTitle, description },
  };
}

test("YouTube fallback rejects unrelated fan-channel trailer results", () => {
  const item = ytCandidate({
    title: "MASTER OF ASHINA - Official Trailer",
    channelTitle: "Master of Ashina",
    description: "A stylish sword combat trailer.",
  });

  assert.equal(
    isSafeYoutubeTrailerCandidate(item, "Final Fantasy 7 Rebirth"),
    false,
  );
});

test("YouTube fallback requires trusted channel and exact-subject match", () => {
  const item = ytCandidate({
    title: "FINAL FANTASY VII REBIRTH - Launch Trailer",
    channelTitle: "FINAL FANTASY",
    description: "The official launch trailer for Final Fantasy VII Rebirth.",
  });

  assert.equal(
    isSafeYoutubeTrailerCandidate(item, "Final Fantasy 7 Rebirth"),
    true,
  );
});

test("YouTube fallback does not accept trusted channels for the wrong game", () => {
  const item = ytCandidate({
    title: "BioShock Infinite - Official Trailer",
    channelTitle: "IGN",
    description: "Official trailer.",
  });

  assert.equal(
    isSafeYoutubeTrailerCandidate(item, "Final Fantasy 7 Rebirth"),
    false,
  );
});

test("YouTube fallback selector chooses only a safe exact-subject candidate", () => {
  const unsafe = ytCandidate({
    videoId: "bad",
    title: "Cool RPG trailer",
    channelTitle: "Random Uploads",
  });
  const safe = ytCandidate({
    videoId: "good",
    title: "Clair Obscur: Expedition 33 - Launch Trailer",
    channelTitle: "PlayStation",
  });

  const selected = selectSafeYoutubeTrailerCandidate(
    [unsafe, safe],
    "Clair Obscur Expedition 33",
  );
  assert.equal(selected.id.videoId, "good");
});

test("B-roll search titles come from script entities before headline noise", () => {
  const story = {
    title: "RPG director says modern combat is changing",
    full_script:
      "Final Fantasy 7 Rebirth director Naoki Hamaguchi compared the shift with Clair Obscur: Expedition 33.",
  };

  assert.deepEqual(deriveBrollSearchTitles(story), [
    "Final Fantasy 7 Rebirth",
    "Clair Obscur Expedition 33",
  ]);
});

test("Clair Obscur is available as an exact entity for media matching", () => {
  const out = extractGameTitles("Clair Obscur: Expedition 33 keeps climbing.");
  assert.equal(out.some((entry) => entry.name === "Clair Obscur Expedition 33"), true);
});

test("Roman numeral normalisation treats VII and 7 as the same game", () => {
  assert.equal(
    hasStrongTitleMatch(
      "FINAL FANTASY VII REBIRTH - Launch Trailer",
      "Final Fantasy 7 Rebirth",
    ),
    true,
  );
});

test("fallback B-roll clip window skips trailer intro slates when possible", () => {
  assert.deepEqual(chooseClipWindow(90), { start: 5, end: 17 });
});

test("fallback B-roll clip window uses the tail of short trailers safely", () => {
  assert.deepEqual(chooseClipWindow(14), { start: 2, end: 14 });
});

test("fallback B-roll clip window keeps very short clips bounded", () => {
  assert.deepEqual(chooseClipWindow(8), { start: 0, end: 8 });
});

test("fallback B-roll clip window defaults safely when duration is unknown", () => {
  assert.deepEqual(chooseClipWindow(undefined), { start: 0, end: 12 });
});
