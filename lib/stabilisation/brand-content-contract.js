"use strict";

const BRAND = Object.freeze({
  public_display_name_candidate: "Pulse Gaming News",
  in_video_name: "PULSE",
  tagline: "Fast gaming news. Checked. Explained.",
  viewer_proposition:
    "Pulse tells players what a gaming headline actually changes, with the source and proof shown on screen.",
  subscriber_promise:
    "Subscribe for the player consequence, not another recap.",
});

const OUTWARD_EDITORIAL_LANES = Object.freeze([
  Object.freeze({
    id: "what_changes_for_players",
    label: "What Changes for Players",
    viewer_promise: "The practical consequence in under 40 seconds",
    typical_subjects: Object.freeze([
      "pricing",
      "account rules",
      "platforms",
      "release dates",
      "delistings",
    ]),
  }),
  Object.freeze({
    id: "trailer_truth_check",
    label: "Trailer Truth Check",
    viewer_promise: "What the footage really proves",
    typical_subjects: Object.freeze([
      "gameplay reveals",
      "remakes",
      "demos",
      "graphical claims",
    ]),
  }),
  Object.freeze({
    id: "platform_pulse",
    label: "Platform Pulse",
    viewer_promise: "Who wins, who loses and why it matters",
    typical_subjects: Object.freeze([
      "Xbox",
      "PlayStation",
      "Nintendo",
      "Steam",
      "PC strategy",
    ]),
  }),
]);

const INITIAL_RUNTIME_BANDS = Object.freeze({
  single_fact_consequence: Object.freeze({
    min_seconds: 25,
    max_seconds: 32,
    never_pad: true,
  }),
  standard_news: Object.freeze({
    min_seconds: 32,
    max_seconds: 42,
    never_pad: true,
  }),
  two_sided_platform_business: Object.freeze({
    min_seconds: 40,
    max_seconds: 50,
    never_pad: true,
  }),
  four_item_list: Object.freeze({
    min_seconds: 42,
    max_seconds: 55,
    never_pad: true,
  }),
});

const EXPERIMENT_RUNTIME_BANDS = Object.freeze({
  what_changes_for_players: Object.freeze({
    short: Object.freeze({ min_seconds: 25, max_seconds: 32 }),
    standard: Object.freeze({ min_seconds: 35, max_seconds: 42 }),
    direct_hook: "State the consequence immediately.",
    open_loop_hook: "Reveal the affected player first, then the change.",
  }),
  trailer_truth_check: Object.freeze({
    short: Object.freeze({ min_seconds: 28, max_seconds: 35 }),
    standard: Object.freeze({ min_seconds: 38, max_seconds: 48 }),
    direct_hook: "State what the footage proves.",
    open_loop_hook: "Challenge the headline, then show proof.",
  }),
  platform_pulse: Object.freeze({
    short: Object.freeze({ min_seconds: 30, max_seconds: 36 }),
    standard: Object.freeze({ min_seconds: 42, max_seconds: 50 }),
    direct_hook: "Name the winner and loser immediately.",
    open_loop_hook: "Present the corporate contradiction first.",
  }),
});

const APPROVED_ENDING_TYPES = Object.freeze([
  "final_consequence",
  "concise_verdict",
  "game_choice",
  "story_specific_question",
  "real_tease",
]);

const HOOK_TIMING_SECONDS = Object.freeze({
  exact_subject_motion_by: 0.5,
  consequence_clear_by: 1.5,
  proof_by: 3,
  second_fact_before_fraction: 0.5,
  payoff_not_before_fraction: 0.75,
  opening_logo_may_delay_story: false,
});

function resolveInitialRuntime(storyType) {
  const runtime = INITIAL_RUNTIME_BANDS[String(storyType || "").trim()];
  if (!runtime) {
    throw new RangeError(`Unknown stabilisation story type: ${storyType || "missing"}`);
  }
  return { ...runtime };
}

function resolveExperimentRuntime(laneId, band) {
  const lane = EXPERIMENT_RUNTIME_BANDS[String(laneId || "").trim()];
  const runtime = lane?.[String(band || "").trim()];
  if (!runtime || !Number.isFinite(runtime.min_seconds)) {
    throw new RangeError(
      `Unknown stabilisation experiment runtime: ${laneId || "missing"}/${band || "missing"}`,
    );
  }
  return { ...runtime };
}

function validateHookTiming(timeline = {}) {
  const duration = Number(timeline.duration_seconds);
  const subjectAt = Number(timeline.exact_subject_motion_at_seconds);
  const consequenceAt = Number(timeline.consequence_complete_at_seconds);
  const proofAt = Number(timeline.proof_at_seconds);
  const secondFactAt = Number(timeline.second_fact_at_seconds);
  const payoffAt = Number(timeline.payoff_at_seconds);
  const blockers = [];

  if (!(Number.isFinite(duration) && duration > 0)) {
    blockers.push("hook_timing:duration_missing");
  }
  if (!(Number.isFinite(subjectAt) && subjectAt >= 0 && subjectAt <= 0.5)) {
    blockers.push("hook_timing:exact_subject_not_visible_by_0_5s");
  }
  if (
    !(Number.isFinite(consequenceAt) && consequenceAt >= 0 && consequenceAt <= 1.5)
  ) {
    blockers.push("hook_timing:consequence_not_clear_by_1_5s");
  }
  if (!(Number.isFinite(proofAt) && proofAt >= 0 && proofAt <= 3)) {
    blockers.push("hook_timing:proof_not_shown_by_3s");
  }
  if (
    Number.isFinite(duration) &&
    !(Number.isFinite(secondFactAt) && secondFactAt >= 0 && secondFactAt < duration / 2)
  ) {
    blockers.push("hook_timing:second_fact_not_before_midpoint");
  }
  if (
    Number.isFinite(duration) &&
    !(
      Number.isFinite(payoffAt) &&
      payoffAt >= duration * 0.75 &&
      payoffAt <= duration
    )
  ) {
    blockers.push("hook_timing:payoff_not_in_final_quarter");
  }
  if (timeline.opening_logo_delays_story !== false) {
    blockers.push("hook_timing:opening_logo_delays_story");
  }

  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
  };
}

function validateEngagementPlan(plan = {}) {
  const blockers = [];
  const endingType = String(plan.ending_type || "").trim();
  const endingText = String(plan.ending_text || "").trim();
  const ctaText = String(plan.cta_text || "").trim();
  const pinnedComment = String(plan.pinned_comment || "").trim();

  if (!APPROVED_ENDING_TYPES.includes(endingType)) {
    blockers.push("engagement:ending_type_not_story_specific");
  }
  if (!endingText) blockers.push("engagement:ending_text_missing");
  if (
    /follow pulse gaming so you never miss a beat/i.test(ctaText) ||
    plan.reused_fixed_cta === true
  ) {
    blockers.push("engagement:fixed_repeated_cta_forbidden");
  }
  if (pinnedComment) {
    if (plan.pinned_comment_human_approved !== true) {
      blockers.push("engagement:pinned_comment_not_human_approved");
    }
    if (plan.pinned_comment_has_legitimate_choice !== true) {
      blockers.push("engagement:pinned_comment_has_no_legitimate_choice");
    }
    if (
      !Number.isInteger(plan.expected_answer_max_words) ||
      plan.expected_answer_max_words < 1 ||
      plan.expected_answer_max_words > 2
    ) {
      blockers.push("engagement:pinned_comment_answer_not_one_or_two_words");
    }
  }
  if (plan.automated_engagement !== false) {
    blockers.push("engagement:automated_engagement_forbidden");
  }

  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
  };
}

function validateCtaCohort(videos = []) {
  const cohort = Array.isArray(videos) ? videos : [];
  const ctaTexts = cohort
    .map((video) =>
      String(video?.cta_text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const ctaCount = ctaTexts.length;
  const ratio = cohort.length ? ctaCount / cohort.length : 0;
  const blockers = [];
  if (ratio > 1 / 3) blockers.push("engagement:cta_cadence_above_one_third");
  if (new Set(ctaTexts).size < ctaTexts.length) {
    blockers.push("engagement:repeated_cta_forbidden");
  }

  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
    video_count: cohort.length,
    cta_count: ctaCount,
    cta_ratio: Number(ratio.toFixed(4)),
  };
}

function validateBrandEditorialPackage(storyPackage = {}) {
  const blockers = [];
  const laneIds = new Set(OUTWARD_EDITORIAL_LANES.map(({ id }) => id));
  const laneId = String(storyPackage.lane_id || "").trim();
  const duration = Number(storyPackage.duration_seconds);

  if (!laneIds.has(laneId)) {
    blockers.push("editorial:outward_lane_missing_or_invalid");
  }

  let runtime;
  try {
    runtime = storyPackage.experiment_band
      ? resolveExperimentRuntime(laneId, storyPackage.experiment_band)
      : resolveInitialRuntime(storyPackage.story_type);
  } catch {
    blockers.push("editorial:runtime_policy_unresolved");
  }

  if (
    runtime &&
    !(
      Number.isFinite(duration) &&
      duration >= runtime.min_seconds &&
      duration <= runtime.max_seconds
    )
  ) {
    blockers.push("editorial:duration_outside_authoritative_band");
  }
  if (storyPackage.duration_padding_used === true) {
    blockers.push("editorial:duration_padding_forbidden");
  }

  blockers.push(...validateHookTiming(storyPackage.hook_timing).blockers);
  blockers.push(...validateEngagementPlan(storyPackage.engagement).blockers);

  return {
    status: blockers.length ? "blocked" : "pass",
    blockers: [...new Set(blockers)],
  };
}

function validateTikTokCreatorRewardsDerivative(derivative = {}) {
  const blockers = [];
  if (!String(derivative.canonical_story_id || "").trim()) {
    blockers.push("duration:tiktok_canonical_story_missing");
  }
  if (
    !(Number.isFinite(Number(derivative.duration_seconds)) &&
      Number(derivative.duration_seconds) >= 60)
  ) {
    blockers.push("duration:tiktok_derivative_under_60s");
  }
  if (derivative.separate_derivative !== true) {
    blockers.push("duration:tiktok_derivative_not_separate");
  }
  if (!String(derivative.derivative_reason || "").trim()) {
    blockers.push("duration:tiktok_derivative_reason_missing");
  }
  if (derivative.padding_added_for_duration !== false) {
    blockers.push("duration:tiktok_padding_forbidden");
  }
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers,
  };
}

function getBrandContentContract() {
  return {
    schema_version: 1,
    status: "stabilisation_authoritative",
    brand: BRAND,
    outward_editorial_lanes: OUTWARD_EDITORIAL_LANES,
    initial_runtime_bands: INITIAL_RUNTIME_BANDS,
    experiment_runtime_bands: EXPERIMENT_RUNTIME_BANDS,
    hook_timing_seconds: HOOK_TIMING_SECONDS,
    engagement: {
      cta_maximum_cohort_fraction: 1 / 3,
      repeated_fixed_cta_allowed: false,
      automated_engagement_allowed: false,
      pinned_comment_human_approval_required: true,
      pinned_comment_answer_max_words: 2,
      approved_ending_types: APPROVED_ENDING_TYPES,
    },
    avatar: {
      asset_path: "public/brand/pulse-v1/avatar.svg",
      wordless: true,
      palette: ["#050505", "#FF6B1A"],
      signal_occupancy_fraction: { min: 0.7, max: 0.8 },
      asymmetric_feature_required: true,
      glow_allowed: false,
      proof_sizes_px: [24, 32, 48],
    },
    tiktok_creator_rewards_derivative: {
      minimum_seconds: 60,
      separate_derivative_only: true,
      never_pad: true,
    },
    legacy_format_policy:
      "Legacy labels may be used internally but must not be presented as additional public franchises during stabilisation.",
  };
}

module.exports = {
  BRAND,
  APPROVED_ENDING_TYPES,
  EXPERIMENT_RUNTIME_BANDS,
  HOOK_TIMING_SECONDS,
  INITIAL_RUNTIME_BANDS,
  OUTWARD_EDITORIAL_LANES,
  getBrandContentContract,
  resolveExperimentRuntime,
  resolveInitialRuntime,
  validateBrandEditorialPackage,
  validateCtaCohort,
  validateEngagementPlan,
  validateHookTiming,
  validateTikTokCreatorRewardsDerivative,
};
