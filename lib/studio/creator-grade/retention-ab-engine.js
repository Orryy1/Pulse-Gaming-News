"use strict";

const VARIANTS = [
  {
    id: "canonical-safe",
    description: "Preserve current canonical order; apply only stronger asset ordering.",
    opener: "clip",
    quoteTiming: "late",
    cardDensity: "normal",
    risk: 5,
  },
  {
    id: "proof-first",
    description: "Move source proof earlier and keep first 12 seconds clip-heavy.",
    opener: "clip",
    quoteTiming: "late",
    cardDensity: "lean",
    risk: 12,
  },
  {
    id: "context-middle",
    description: "Spend the middle on a timeline reframe, then return to footage.",
    opener: "clip",
    quoteTiming: "late",
    cardDensity: "normal",
    risk: 10,
  },
  {
    id: "quote-punch",
    description: "Make the viewer quote the main second-half impact beat.",
    opener: "clip",
    quoteTiming: "mid-late",
    cardDensity: "normal",
    risk: 18,
  },
];

function scoreVariant(variant, { vault = {}, timeline = {}, visualQa = {} } = {}) {
  const clipCount = vault.stats?.clipCount || 0;
  const beatCoverage = visualQa.beatCoverage?.length || 0;
  const clipBonus = Math.min(25, clipCount * 8);
  const coverageBonus = Math.min(30, beatCoverage * 5);
  const riskPenalty = variant.risk;
  const sourcePenalty = (vault.stats?.stockRejected || 0) > 0 ? 4 : 0;
  const cardPenalty = variant.cardDensity === "normal" && timeline.beats?.length > 6 ? 0 : 3;
  const score = Math.max(0, Math.min(100, 50 + clipBonus + coverageBonus - riskPenalty - sourcePenalty - cardPenalty));
  return {
    ...variant,
    score,
    rationale: [
      `${clipCount} accepted trailer clip(s) available`,
      `${beatCoverage} semantic beat(s) have preferred assets`,
      `risk penalty ${riskPenalty}`,
    ],
  };
}

function planRetentionAB({ vault = {}, timeline = {}, visualQa = {} } = {}) {
  const candidates = VARIANTS.map((variant) => scoreVariant(variant, { vault, timeline, visualQa })).sort(
    (a, b) => b.score - a.score,
  );
  const winner = candidates[0] || null;
  return {
    candidates,
    winner,
    recommendation: winner
      ? `Render ${winner.id} first; keep canonical as holdout until retention data proves the variant.`
      : "No safe A/B candidate.",
  };
}

module.exports = {
  VARIANTS,
  planRetentionAB,
  scoreVariant,
};
