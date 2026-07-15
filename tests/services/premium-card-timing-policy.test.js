"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PREMIUM_CARD_TIMING_POLICY_VERSION,
  PREMIUM_CARD_TIMING_V5_VERSION,
  cardTimingContract,
  v5CardTimingContract,
} = require("../../lib/studio/v4/premium-card-timing-policy");

test("premium card timing gives source verification enough time to register without stalling", () => {
  const timing = v5CardTimingContract("source", "ROCKSTAR GAMES OFFICIAL TRAILER");

  assert.equal(PREMIUM_CARD_TIMING_V5_VERSION, "pulse_card_timing_v3");
  assert.deepEqual(timing, {
    kind: "source",
    minimum_visible_duration_s: 1.9,
    planned_visible_duration_s: 2.6,
    required_visible_duration_s: 2.3,
    maximum_visible_duration_s: 3.1,
    content_fits_maximum: true,
  });
});

test("premium card timing keeps proof beats readable without allowing momentum-killing holds", () => {
  const shortProof = v5CardTimingContract("context", "PLAYER IMPACT GAME PASS");
  const longProof = v5CardTimingContract(
    "timeline",
    "THE FULL PLAYER IMPACT ACROSS RELEASE DATE PRICE PLATFORMS EDITIONS AND UPGRADES",
  );

  assert.equal(shortProof.minimum_visible_duration_s, 3.4);
  assert.ok(shortProof.planned_visible_duration_s >= 3.4);
  assert.ok(shortProof.planned_visible_duration_s <= 5.2);
  assert.equal(shortProof.maximum_visible_duration_s, 5.2);
  assert.equal(longProof.planned_visible_duration_s, 5.0);
});

test("premium card timing reports when readable copy exceeds the momentum ceiling", () => {
  const timing = v5CardTimingContract(
    "timeline",
    "BLACK FLAG RESYNCED NINE DLC PACKS AT LAUNCH EIGHTY FOUR DOLLARS VERSUS FIFTY NINE DOLLARS FOUR DOLLAR MAP PACK REVEALS EVERY COLLECTIBLE LOCATION",
  );

  assert.equal(timing.planned_visible_duration_s, 5.2);
  assert.ok(timing.required_visible_duration_s > timing.maximum_visible_duration_s);
  assert.equal(timing.content_fits_maximum, false);
});

test("premium card timing recognises source-lock aliases", () => {
  assert.equal(v5CardTimingContract("source_lock", "IGN").kind, "source");
  assert.equal(v5CardTimingContract("hyperframes_source_card", "VGC").planned_visible_duration_s, 2.6);
});

test("premium card timing exposes source labels that cannot fit the momentum ceiling", () => {
  const timing = v5CardTimingContract(
    "source",
    "BANDAI NAMCO ENTERTAINMENT AMERICA OFFICIAL PUBLISHER NEWS SOURCE",
  );

  assert.equal(timing.planned_visible_duration_s, 3.1);
  assert.ok(timing.required_visible_duration_s > timing.maximum_visible_duration_s);
  assert.equal(timing.content_fits_maximum, false);
});

test("premium V5 timing leaves compact overlay defaults backwards compatible", () => {
  assert.equal(PREMIUM_CARD_TIMING_POLICY_VERSION, "pulse_card_timing_v2");
  assert.equal(cardTimingContract("source_lock", "IGN").planned_visible_duration_s, 2.2);
  assert.equal(cardTimingContract("context", "PLAYER IMPACT").minimum_visible_duration_s, 3.6);
});
