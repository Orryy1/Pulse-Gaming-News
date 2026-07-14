"use strict";

const PREMIUM_EDIT_RHYTHM_V5 = Object.freeze({
  version: "pulse_premium_edit_rhythm_v5",
  max_generated_card_scene_count: 3,
  max_narrative_card_scene_count: 2,
  max_generated_card_duration_ratio: 0.25,
  min_direct_motion_scenes_between_cards: 1,
  source_lock_is_provenance_not_narrative: true,
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cardKind(scene = {}) {
  return String(scene.readableCardKind || scene.readable_card_kind || "")
    .trim()
    .toLowerCase();
}

function sceneDuration(scene = {}) {
  const value = Number(scene.durationS ?? scene.duration_s ?? scene.plannedDurationS);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isSourceLockKind(kind = "") {
  return kind === "source" || kind === "source_lock";
}

function governedV5CardKind(scene = {}) {
  if (scene.premiumCardV5 === false || scene.premium_card_v5 === false) return "";
  return cardKind(scene);
}

function inspectPremiumEditRhythm({ scenes = [], coveredDurationS = null } = {}) {
  const sequence = asArray(scenes);
  const cardIndexes = sequence
    .map((scene, index) => (governedV5CardKind(scene) ? index : -1))
    .filter((index) => index >= 0);
  const narrativeCardIndexes = cardIndexes.filter(
    (index) => !isSourceLockKind(governedV5CardKind(sequence[index])),
  );
  const adjacentCardPairs = [];
  const directMotionGaps = [];
  for (let index = 1; index < cardIndexes.length; index += 1) {
    const previous = cardIndexes[index - 1];
    const current = cardIndexes[index];
    const gap = sequence
      .slice(previous + 1, current)
      .filter((scene) => !governedV5CardKind(scene)).length;
    directMotionGaps.push(gap);
    if (gap === 0) adjacentCardPairs.push([previous, current]);
  }

  const generatedCardDurationS = cardIndexes.reduce(
    (sum, index) => sum + sceneDuration(sequence[index]),
    0,
  );
  const measuredDuration = Number(coveredDurationS);
  const totalDurationS = Number.isFinite(measuredDuration) && measuredDuration > 0
    ? measuredDuration
    : sequence.reduce((sum, scene) => sum + sceneDuration(scene), 0);
  const generatedCardDurationRatio = totalDurationS > 0
    ? Number((generatedCardDurationS / totalDurationS).toFixed(3))
    : 0;
  const minimumGap = directMotionGaps.length ? Math.min(...directMotionGaps) : null;
  const blockers = [];

  if (cardIndexes.length > PREMIUM_EDIT_RHYTHM_V5.max_generated_card_scene_count) {
    blockers.push("generated_card_scene_count_above_premium_ceiling");
  }
  if (narrativeCardIndexes.length > PREMIUM_EDIT_RHYTHM_V5.max_narrative_card_scene_count) {
    blockers.push("narrative_card_scene_count_above_premium_ceiling");
  }
  if (adjacentCardPairs.length) blockers.push("adjacent_generated_card_scenes");
  if (
    minimumGap != null &&
    minimumGap < PREMIUM_EDIT_RHYTHM_V5.min_direct_motion_scenes_between_cards
  ) {
    blockers.push("direct_motion_spacing_between_cards_below_premium_floor");
  }
  if (
    cardIndexes.length &&
    generatedCardDurationRatio > PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio
  ) {
    blockers.push("generated_card_duration_ratio_above_premium_ceiling");
  }

  return {
    version: PREMIUM_EDIT_RHYTHM_V5.version,
    status: blockers.length ? "fail" : "pass",
    blockers,
    metrics: {
      total_scene_count: sequence.length,
      direct_motion_scene_count: sequence.filter((scene) => !cardKind(scene)).length,
      legacy_or_non_v5_card_scene_count: sequence.filter(
        (scene) => cardKind(scene) && !governedV5CardKind(scene),
      ).length,
      generated_card_scene_count: cardIndexes.length,
      narrative_card_scene_count: narrativeCardIndexes.length,
      source_lock_card_scene_count: cardIndexes.length - narrativeCardIndexes.length,
      generated_card_duration_s: Number(generatedCardDurationS.toFixed(3)),
      total_duration_s: Number(totalDurationS.toFixed(3)),
      generated_card_duration_ratio: generatedCardDurationRatio,
      adjacent_card_pair_count: adjacentCardPairs.length,
      adjacent_card_pairs: adjacentCardPairs,
      direct_motion_gaps_between_cards: directMotionGaps,
      minimum_direct_motion_gap_between_cards: minimumGap,
      limits: PREMIUM_EDIT_RHYTHM_V5,
    },
  };
}

module.exports = {
  PREMIUM_EDIT_RHYTHM_V5,
  inspectPremiumEditRhythm,
};
