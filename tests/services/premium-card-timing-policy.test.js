"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PREMIUM_CARD_TIMING_POLICY_VERSION,
  cardTimingContract,
} = require("../../lib/studio/v4/premium-card-timing-policy");

test("premium card timing gives source verification enough time to register without stalling", () => {
  const timing = cardTimingContract("source", "ROCKSTAR GAMES OFFICIAL TRAILER");

  assert.equal(PREMIUM_CARD_TIMING_POLICY_VERSION, "pulse_card_timing_v2");
  assert.deepEqual(timing, {
    kind: "source",
    minimum_visible_duration_s: 1.6,
    planned_visible_duration_s: 2.2,
    maximum_visible_duration_s: 2.8,
  });
});

test("premium card timing keeps proof beats readable without allowing momentum-killing holds", () => {
  const shortProof = cardTimingContract("context", "PLAYER IMPACT GAME PASS");
  const longProof = cardTimingContract(
    "timeline",
    "THE FULL PLAYER IMPACT ACROSS RELEASE DATE PRICE PLATFORMS EDITIONS AND UPGRADES",
  );

  assert.equal(shortProof.minimum_visible_duration_s, 3.6);
  assert.ok(shortProof.planned_visible_duration_s >= 3.6);
  assert.ok(shortProof.planned_visible_duration_s <= 6.4);
  assert.equal(shortProof.maximum_visible_duration_s, 6.4);
  assert.equal(longProof.planned_visible_duration_s, 5.4);
});

test("premium card timing recognises source-lock aliases", () => {
  assert.equal(cardTimingContract("source_lock", "IGN").kind, "source");
  assert.equal(cardTimingContract("hyperframes_source_card", "VGC").planned_visible_duration_s, 2.2);
});
