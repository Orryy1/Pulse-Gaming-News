"use strict";

/**
 * lib/creative/runtime-recommender.js — Session 2 (creative pass).
 *
 * Maps a media-inventory class (from media-inventory-scorer) to a
 * concrete runtime ceiling and a render decision. The pipeline
 * should never force 60-75 second videos out of weak source
 * material — that's the failure mode this module exists to prevent.
 *
 *   reject_visuals -> do not render as video; route to blog/queue/manual
 *   blog_only      -> do not render unless an operator approves
 *   briefing_item  -> 18-30s, treat as a Daily Briefing line, not a Short
 *   short_only     -> 30-45s
 *   standard_video -> 45-60s
 *   premium_video  -> 60-75s, eligible for long-form formats
 *
 * Caller pattern:
 *   const inv = scoreStoryMediaInventory(story);
 *   const plan = recommendRuntime(inv);
 *   // plan.shouldRender === false  -> skip render, route to alt
 *   // plan.runtimeSeconds          -> { min, max, target }
 */

const RUNTIME_PLANS = {
  reject_visuals: {
    shouldRender: false,
    runtimeSeconds: null,
    route: "manual_review",
    note: "Not enough safe visual inventory. Do not render — surface for editorial review.",
  },
  blog_only: {
    shouldRender: false,
    runtimeSeconds: null,
    route: "blog",
    note: "Visual inventory below the video bar. Push to blog/newsletter only.",
  },
  briefing_item: {
    shouldRender: false,
    runtimeSeconds: { min: 18, max: 30, target: 22 },
    route: "daily_briefing_segment",
    note: "Single-fact line inside the Daily Briefing — do not stand it up as its own Short.",
  },
  short_only: {
    shouldRender: true,
    runtimeSeconds: { min: 30, max: 45, target: 38 },
    route: "daily_short",
    note: "Short-form only. Avoid runtime padding.",
  },
  standard_video: {
    shouldRender: true,
    runtimeSeconds: { min: 45, max: 60, target: 52 },
    route: "daily_short_or_briefing",
    note: "Solid inventory but not premium. Lean toward 45-55s, do not stretch.",
  },
  premium_video: {
    shouldRender: true,
    runtimeSeconds: { min: 60, max: 75, target: 68 },
    route: "premium_short_or_breakdown",
    note: "Eligible for premium formats (Trailer Breakdown, Before You Download). Long-form requires aggregated material.",
  },
};

function recommendRuntime(inventoryOrClass) {
  const cls =
    typeof inventoryOrClass === "string"
      ? inventoryOrClass
      : inventoryOrClass?.classification;
  const plan = RUNTIME_PLANS[cls];
  if (!plan) {
    return {
      shouldRender: false,
      runtimeSeconds: null,
      route: "manual_review",
      note: `unknown inventory class "${cls}" — surface for review`,
      classification: cls || null,
    };
  }
  return { ...plan, classification: cls };
}

function describeRuntimeRules() {
  return Object.entries(RUNTIME_PLANS).map(([cls, plan]) => ({
    classification: cls,
    shouldRender: plan.shouldRender,
    runtimeSeconds: plan.runtimeSeconds,
    route: plan.route,
    note: plan.note,
  }));
}

module.exports = {
  recommendRuntime,
  describeRuntimeRules,
  RUNTIME_PLANS,
};
