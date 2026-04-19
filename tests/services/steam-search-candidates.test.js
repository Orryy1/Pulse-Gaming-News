/**
 * tests/services/steam-search-candidates.test.js
 *
 * Pins the Steam search-candidate extractor added 2026-04-19 after the
 * Black Flag publish (1sojcmy) shipped with 6 generic Pexels stock
 * photos and zero game art. Root cause: the old extractor stripped
 * everything before the first colon, so for
 *   "Tom Henderson on Black Flag remake: reveal set for April 23rd..."
 * it threw away "Black Flag" and sent Steam the post-colon noise.
 *
 * The new extractor builds an ordered list of search candidates and
 * the image pipeline tries each in turn. Tests confirm:
 *   - "Black Flag" survives as a candidate for the exact Black Flag title
 *   - leaker-attribution prefix ("Tom Henderson on") is stripped
 *   - titles that put the game AFTER the colon still work
 *   - multi-candidate shape is stable (before-colon, after-colon, whole)
 *   - empty / short / garbage input handled safely
 *
 * Run: node --test tests/services/steam-search-candidates.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSteamSearchCandidates } = require("../../images_download");

test("1sojcmy: Black Flag title produces a candidate containing 'Black Flag'", () => {
  const cands = buildSteamSearchCandidates(
    "Tom Henderson on Black Flag remake: reveal set for April 23rd, " +
      "Embargo lifts 12:15 PM ET, media are impressed with the game, " +
      "current-gen only and exclusive game details",
  );
  assert.ok(cands.length >= 1, `expected candidates; got ${cands.length}`);
  const joined = cands.join(" | ").toLowerCase();
  assert.match(
    joined,
    /black flag/,
    `at least one candidate must contain 'black flag'; got: ${cands.join(" | ")}`,
  );
});

test("leaker-attribution prefix ('Tom Henderson on') is stripped from the primary candidate", () => {
  const cands = buildSteamSearchCandidates(
    "Tom Henderson on Black Flag remake: reveal set for April 23rd",
  );
  // The first candidate should NOT start with "tom henderson".
  assert.ok(
    !cands[0].toLowerCase().startsWith("tom henderson"),
    `leaker prefix not stripped from first candidate: '${cands[0]}'`,
  );
});

test("Billbil-kun prefix is stripped too", () => {
  const cands = buildSteamSearchCandidates(
    "Billbil-kun says Horizon Zero Dawn Remastered is coming to PS Plus",
  );
  const joined = cands.join(" | ").toLowerCase();
  assert.match(joined, /horizon/);
  assert.ok(
    !cands[0].toLowerCase().startsWith("billbil"),
    `billbil-kun prefix not stripped: '${cands[0]}'`,
  );
});

test("game-after-colon pattern still works ('Rumour: New Elder Scrolls leak')", () => {
  const cands = buildSteamSearchCandidates(
    "Rumour: New Elder Scrolls leak surfaces on Reddit",
  );
  const joined = cands.join(" | ").toLowerCase();
  assert.match(joined, /elder scrolls/);
});

test("produces multiple distinct candidates when both colon sides are meaningful", () => {
  const cands = buildSteamSearchCandidates(
    "Mafia 2 remake: release date confirmed",
  );
  assert.ok(
    cands.length >= 2,
    `expected multiple candidates; got ${cands.length}: ${cands.join(" | ")}`,
  );
  const joined = cands.join(" | ").toLowerCase();
  assert.match(joined, /mafia/);
});

test("empty input returns empty array", () => {
  assert.deepEqual(buildSteamSearchCandidates(""), []);
  assert.deepEqual(buildSteamSearchCandidates(null), []);
  assert.deepEqual(buildSteamSearchCandidates(undefined), []);
});

test("very short title returns empty (below the 3-char floor)", () => {
  // After stripping stopwords, "a is" becomes "" which is below 3 chars.
  const cands = buildSteamSearchCandidates("a is");
  assert.equal(cands.length, 0);
});

test("candidates are deduped when before- and after-colon clean to the same thing", () => {
  const cands = buildSteamSearchCandidates("Cyberpunk: Cyberpunk");
  // Both sides clean to "Cyberpunk", so we should see it exactly once.
  const counts = cands.filter((c) => c.toLowerCase() === "cyberpunk").length;
  assert.ok(
    counts <= 1,
    `duplicate 'cyberpunk' candidates: ${cands.join(" | ")}`,
  );
});
