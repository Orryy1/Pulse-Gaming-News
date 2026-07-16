"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PREMIUM_EDIT_RHYTHM_V5,
  inspectPremiumEditRhythm,
} = require("../../lib/studio/v5/premium-edit-rhythm");

function motion(id, durationS = 4) {
  return { id, durationS, readableCardKind: null };
}

function card(kind, durationS) {
  return { id: `${kind}-card`, durationS, readableCardKind: kind };
}

test("premium edit rhythm passes a footage-led sequence with a compact source lock", () => {
  const scenes = [
    motion("m1"),
    motion("m2"),
    card("source", 2.2),
    motion("m3"),
    motion("m4"),
    card("context", 4.2),
    motion("m5"),
    motion("m6"),
    card("takeaway", 4.2),
    motion("m7"),
    motion("m8"),
  ];
  const coveredDurationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const report = inspectPremiumEditRhythm({ scenes, coveredDurationS });

  assert.equal(report.status, "pass");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.metrics.generated_card_scene_count, 3);
  assert.equal(report.metrics.narrative_card_scene_count, 2);
  assert.equal(report.metrics.adjacent_card_pair_count, 0);
  assert.equal(
    report.metrics.generated_card_duration_ratio <=
      PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio,
    true,
  );
});

test("premium edit rhythm blocks adjacent and excessive full-screen cards", () => {
  const scenes = [
    motion("m1", 5),
    card("source", 2.2),
    card("context", 4.2),
    motion("m2", 5),
    card("quote", 4.2),
    motion("m3", 5),
    card("takeaway", 4.2),
    motion("m4", 5),
  ];
  const coveredDurationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const report = inspectPremiumEditRhythm({ scenes, coveredDurationS });

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("adjacent_generated_card_scenes"));
  assert.ok(report.blockers.includes("generated_card_scene_count_above_premium_ceiling"));
  assert.ok(report.blockers.includes("narrative_card_scene_count_above_premium_ceiling"));
});

test("premium edit rhythm blocks a card-heavy sequence even when cards are separated", () => {
  const scenes = [
    motion("m1", 3),
    card("source", 2.2),
    motion("m2", 3),
    card("context", 5.8),
    motion("m3", 3),
    card("takeaway", 5.8),
    motion("m4", 3),
  ];
  const coveredDurationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const report = inspectPremiumEditRhythm({ scenes, coveredDurationS });

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("generated_card_duration_ratio_above_premium_ceiling"));
});

test("premium edit rhythm blocks a source lock that ends the episode", () => {
  const scenes = [
    motion("m1", 4),
    motion("m2", 4),
    motion("m3", 4),
    card("source", 2.6),
  ];
  const coveredDurationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const report = inspectPremiumEditRhythm({ scenes, coveredDurationS });

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("source_lock_card_at_episode_end"));
});

test("premium edit rhythm ignores legacy owned explainer cards outside the V5 shell", () => {
  const scenes = [
    { ...card("title", 12), premiumCardV5: false },
    motion("m1", 5),
    motion("m2", 5),
    motion("m3", 5),
    motion("m4", 5),
  ];
  const report = inspectPremiumEditRhythm({ scenes, coveredDurationS: 32 });

  assert.equal(report.status, "pass");
  assert.equal(report.metrics.generated_card_scene_count, 0);
  assert.equal(report.metrics.legacy_or_non_v5_card_scene_count, 1);
});
