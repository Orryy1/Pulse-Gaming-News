"use strict";

const {
  resolveRequiredPulseEditorialContract,
} = require("../studio/v2/flash-lane-preflight");

/**
 * Media inventory decides whether a standalone render is supportable. It must
 * never choose the editorial runtime. Renderable classes defer to the explicit,
 * validated Pulse editorial contract for their exact duration band.
 */
const RUNTIME_PLANS = Object.freeze({
  reject_visuals: Object.freeze({
    inventoryAllowsRender: false,
    route: "manual_review",
    note: "Not enough safe visual inventory. Surface for editorial review.",
  }),
  blog_only: Object.freeze({
    inventoryAllowsRender: false,
    route: "blog",
    note: "Visual inventory is below the standalone-video bar.",
  }),
  briefing_item: Object.freeze({
    inventoryAllowsRender: false,
    route: "daily_briefing_segment",
    note: "Single-fact material belongs in a governed briefing, not a standalone Short.",
  }),
  short_only: Object.freeze({
    inventoryAllowsRender: true,
    route: "daily_short",
    note: "Media capacity supports a standalone short-form render.",
  }),
  standard_video: Object.freeze({
    inventoryAllowsRender: true,
    route: "daily_short_or_briefing",
    note: "Media capacity supports a standalone render.",
  }),
  premium_video: Object.freeze({
    inventoryAllowsRender: true,
    route: "premium_short_or_breakdown",
    note: "Media capacity supports a premium render; the editorial contract still owns runtime.",
  }),
});

function recommendRuntime(inventoryOrClass, {
  story = null,
  editorialContract = null,
} = {}) {
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
      note: `unknown inventory class "${cls}" - surface for review`,
      classification: cls || null,
      durationBandId: null,
      blocker: "unknown_media_inventory_class",
    };
  }

  if (!plan.inventoryAllowsRender) {
    return {
      ...plan,
      shouldRender: false,
      runtimeSeconds: null,
      classification: cls,
      durationBandId: null,
      blocker: null,
    };
  }

  const resolved = resolveRequiredPulseEditorialContract({
    story: story || {},
    editorialContract,
  });
  if (resolved.blocker || !resolved.contract) {
    return {
      ...plan,
      shouldRender: false,
      runtimeSeconds: null,
      classification: cls,
      durationBandId: null,
      blocker: resolved.blocker || "pulse_editorial_contract_required",
    };
  }

  const min = Number(resolved.contract.min_seconds);
  const max = Number(resolved.contract.max_seconds);
  return {
    ...plan,
    shouldRender: true,
    runtimeSeconds: {
      min,
      max,
      target: Number(((min + max) / 2).toFixed(3)),
    },
    classification: cls,
    durationBandId: resolved.contract.duration_band_id,
    blocker: null,
  };
}

function describeRuntimeRules() {
  return Object.entries(RUNTIME_PLANS).map(([cls, plan]) => ({
    classification: cls,
    inventoryAllowsRender: plan.inventoryAllowsRender,
    shouldRender: false,
    runtimeSeconds: null,
    route: plan.route,
    note: plan.note,
  }));
}

module.exports = {
  recommendRuntime,
  describeRuntimeRules,
  RUNTIME_PLANS,
};
