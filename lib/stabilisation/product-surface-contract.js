"use strict";

const ESSENTIAL_FUNCTIONS = Object.freeze([
  Object.freeze({ id: "discover_story", order: 1 }),
  Object.freeze({ id: "verify_story", order: 2 }),
  Object.freeze({ id: "choose_editorial_angle", order: 3 }),
  Object.freeze({ id: "write_source_bound_script", order: 4 }),
  Object.freeze({ id: "acquire_cleared_exact_subject_media", order: 5 }),
  Object.freeze({ id: "render_polished_video", order: 6 }),
  Object.freeze({ id: "obtain_human_approval", order: 7 }),
  Object.freeze({ id: "publish_youtube", order: 8 }),
  Object.freeze({
    id: "learn_from_retention_and_subscribers",
    order: 9,
  }),
]);

const RENDERER_POLICY = Object.freeze({
  standard: Object.freeze({
    id: "hyperframes_ffmpeg_flagship_v1",
    components: Object.freeze(["HyperFrames", "FFmpeg", "FFprobe"]),
    modes: Object.freeze(["LOCAL_PROOF", "HUMAN_REVIEW", "LIVE_GUARDED"]),
  }),
  experimental: Object.freeze({
    id: "studio_v4_local_proof",
    modes: Object.freeze(["LOCAL_PROOF"]),
    production_allowed: false,
    new_generation_allowed: false,
    review_date: "after_pulse_v1_12_video_experiment",
  }),
  variant_layer: Object.freeze({
    id: "platform_variant_v1",
    behaviour: "metadata_safe_area_and_approved_crop_only",
    may_change_editorial_claim: false,
  }),
  legacy: Object.freeze({
    active_dependency_allowed: false,
    retirement_milestone: "pulse_v1_release",
    archive_required: true,
  }),
});

const FROZEN_CAPABILITIES = new Set([
  "new_platform",
  "new_content_vertical",
  "finance_vertical",
  "crypto_vertical",
  "new_studio_generation",
  "affiliate_system",
  "discord_economy",
  "autonomous_engagement",
  "broad_auto_publish",
  "stack_replacement",
  "heygen",
  "kokoro",
  "musicgen",
  "bulk_backlog_publication",
  "generic_article_to_video_scale",
]);

const ANCILLARY_POLICY = Object.freeze({
  blog: "maintenance_only",
  discord: "announcements_and_feedback_only",
  long_form_youtube: "later_pilot_from_proven_short_topic",
  instagram: "disabled_until_youtube_experiment_complete",
  facebook: "controlled_proof_only",
  tiktok: "manual_handoff_only",
  x: "disabled",
  threads: "disabled",
  pinterest: "disabled",
});

function normalise(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function evaluateScopeChange({ capability } = {}) {
  const target = normalise(capability);
  if (ESSENTIAL_FUNCTIONS.some((item) => item.id === target)) {
    return { capability: target, allowed: true, reason: "pulse_v1_essential" };
  }
  if (FROZEN_CAPABILITIES.has(target)) {
    return {
      capability: target,
      allowed: false,
      reason: "stabilisation_feature_freeze",
    };
  }
  if (Object.prototype.hasOwnProperty.call(ANCILLARY_POLICY, target)) {
    return {
      capability: target,
      allowed: false,
      reason: ANCILLARY_POLICY[target],
    };
  }
  return {
    capability: target,
    allowed: false,
    reason: "outside_approved_pulse_v1_surface",
  };
}

function evaluateRendererSelection({ renderer, mode = "LOCAL_PROOF" } = {}) {
  const selected = normalise(renderer);
  const operatingMode = String(mode || "LOCAL_PROOF").trim().toUpperCase();
  const standard = normalise(RENDERER_POLICY.standard.id);
  const experimental = normalise(RENDERER_POLICY.experimental.id);
  const blockers = [];

  if (selected === standard) {
    if (!RENDERER_POLICY.standard.modes.includes(operatingMode)) {
      blockers.push("renderer_mode_not_allowed");
    }
  } else if (selected === experimental) {
    if (!RENDERER_POLICY.experimental.modes.includes(operatingMode)) {
      blockers.push("experimental_renderer_local_proof_only");
    }
  } else {
    blockers.push("renderer_not_in_pulse_v1_contract");
  }

  return {
    renderer: selected,
    mode: operatingMode,
    allowed: blockers.length === 0,
    blockers,
  };
}

function getProductSurfaceContract() {
  return {
    schema_version: "pulse-product-surface-v1",
    essential_functions: ESSENTIAL_FUNCTIONS,
    renderer_policy: RENDERER_POLICY,
    ancillary_policy: ANCILLARY_POLICY,
    frozen_capabilities: [...FROZEN_CAPABILITIES],
  };
}

module.exports = {
  ANCILLARY_POLICY,
  ESSENTIAL_FUNCTIONS,
  FROZEN_CAPABILITIES,
  RENDERER_POLICY,
  evaluateRendererSelection,
  evaluateScopeChange,
  getProductSurfaceContract,
};
