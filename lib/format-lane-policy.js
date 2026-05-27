"use strict";

const { normaliseText } = require("./text-hygiene");

const FLASH_FORMATS = new Set(["premium_short", "standard_short", "short_only"]);
const BRIEFING_FORMATS = new Set([
  "daily_briefing_item",
  "weekly_roundup_item",
  "monthly_release_radar_item",
  "before_you_download_candidate",
  "trailer_breakdown_candidate",
]);

function routeFormatLane(formatVerdict) {
  if (FLASH_FORMATS.has(formatVerdict)) return "pulse_flash_short";
  if (BRIEFING_FORMATS.has(formatVerdict)) return "pulse_briefing_longform";
  if (formatVerdict === "reject") return "reject";
  if (formatVerdict === "blog_only") return "blog_only";
  return "unknown";
}

function sharedIntelligenceContract() {
  return {
    story_dossier: "story_dossier",
    source_pack: "fact_check_report",
    media_inventory: "media_inventory",
    exact_subject_readiness: "media_inventory.exact_subject_readiness",
    platform_route_plan: "platform_route_plan",
    analytics_join: "learning_hook",
  };
}

function colourFor(blockers, warnings) {
  if (blockers.length > 0) return "RED";
  if (warnings.length > 0) return "AMBER";
  return "GREEN";
}

const SPECULATIVE_HOOK_RE =
  /\b(?:could|might|may|maybe|possibly|potentially|rumou?r|speculat(?:e|ion|ive)|reportedly|sources?\s+(?:say|claim|suggest))\b/i;
const CONCRETE_CONSEQUENCE_RE =
  /\b(?:announced|available|confirmed|date|drops?|ends|free|gets?|got|just|launched|made|now|official|price|released|revealed|said|says|starts|today|tomorrow|update|week)\b/i;

function appendUnique(items, value) {
  if (!items.includes(value)) items.push(value);
}

function assessFlashLaneHookDiscipline(story = {}) {
  const hook = normaliseText(story?.hook || story?.title || "").trim();
  const context = normaliseText(
    [story?.hook, story?.title, story?.body, story?.loop, story?.full_script]
      .filter(Boolean)
      .join(" "),
  ).trim();
  const warnings = [];
  const speculative = SPECULATIVE_HOOK_RE.test(hook);
  const concrete = CONCRETE_CONSEQUENCE_RE.test(hook) || CONCRETE_CONSEQUENCE_RE.test(context);

  if (speculative) warnings.push("flash_lane_hook_uses_speculative_language");
  if (!concrete) warnings.push("flash_lane_hook_needs_concrete_consequence");

  return {
    hook,
    speculative_language: speculative,
    concrete_consequence_signal: concrete,
    warnings,
  };
}

function buildFlashLanePolicy({ story, mediaInventory, renderContract }) {
  const blockers = [];
  const warnings = [];
  const exactCount = Number(mediaInventory?.exact_subject_asset_count || 0);
  const clipCount = Number(renderContract?.clip_count || 0);
  const visualCount = Number(renderContract?.visual_count || 0);
  const hookDiscipline = assessFlashLaneHookDiscipline(story);

  if (renderContract?.render_lane === "reject") blockers.push("render_contract_reject");
  if (renderContract?.tiktok_60_second_eligibility !== true) {
    blockers.push("flash_lane_requires_61s_plus_runtime");
  }
  if (exactCount < 4) warnings.push("flash_lane_needs_more_exact_subject_visuals");
  if (clipCount < 1) warnings.push("flash_lane_needs_game_footage_backbone");
  if (visualCount < 8) warnings.push("flash_lane_needs_eight_scene_beats");
  for (const warning of hookDiscipline.warnings) appendUnique(warnings, warning);

  return {
    lane_id: "pulse_flash_short",
    lane_name: "Pulse Flash Lane",
    format_family: "shorts",
    purpose: "High-energy gaming TikTok and Shorts-native news.",
    runtime_target_seconds: { min: 61, max: 75 },
    platform_targets: ["tiktok_dispatch", "youtube_shorts", "instagram_reels"],
    script_rules: [
      "open_with_wait_what_or_concrete_consequence",
      "first_two_seconds_hook",
      "first_eight_seconds_proof_or_context",
      "avoid_could_might_hooks",
      "single_editorial_angle",
      "fast_follow_or_question_cta",
    ],
    caption_rules: {
      style: "punch_captions",
      max_words_per_punch: 3,
      prefer_one_line: true,
      kinetic_emphasis: true,
    },
    render_rules: {
      visual_backbone: ["game_footage", "official_trailer_frames", "exact_subject_game_art"],
      required_elements: [
        "rapid_topic_cards",
        "creator_style_popups",
        "subject_matched_overlays",
        "branded_outro",
      ],
      clip_dominance_target: 0.55,
      avoid: ["rating_cards", "trailer_logo_intro_cards", "generic_store_assets", "unapproved_local_voice"],
    },
    qa_gates: [
      "approved_voice_required",
      "tiktok_60s_runtime_required",
      "exact_subject_visuals_required",
      "no_wrong_story_assets",
      "subtitle_energy_required",
      "outro_required",
    ],
    readiness_colour: colourFor(blockers, warnings),
    blockers,
    warnings,
    hook_discipline: hookDiscipline,
    shared_intelligence: sharedIntelligenceContract(),
    production_safety: {
      report_only: true,
      changes_live_behaviour: false,
      switches_renderer: false,
      enables_hard_gates: false,
    },
  };
}

function buildBriefingLanePolicy({ sourcePack, mediaInventory, renderContract }) {
  const blockers = [];
  const warnings = [];
  const sourceConfidence = sourcePack?.confidence_level || "unknown";

  if (renderContract?.render_lane === "reject") blockers.push("render_contract_reject");
  if (!sourcePack?.source_url) warnings.push("briefing_lane_needs_source_url");
  if (["unknown", "rumour", "likely"].includes(sourceConfidence)) {
    warnings.push("briefing_lane_needs_source_confidence_review");
  }
  if (["blog_only", "card_only"].includes(mediaInventory?.verdict)) {
    warnings.push("briefing_lane_needs_richer_media_or_chapters");
  }

  return {
    lane_id: "pulse_briefing_longform",
    lane_name: "Pulse Briefing Lane",
    format_family: "briefing_or_longform",
    purpose: "Weekly, monthly and documentary-style gaming explainers.",
    runtime_target_seconds: { min: 360, max: 900 },
    platform_targets: ["youtube_longform", "blog", "newsletter"],
    script_rules: [
      "source_timeline",
      "chaptered_structure",
      "calmer_narration",
      "context_before_opinion",
      "explicit_uncertainty_labels",
      "credible_takeaway_close",
    ],
    caption_rules: {
      style: "documentary_support",
      max_words_per_punch: 7,
      prefer_one_line: false,
      kinetic_emphasis: false,
    },
    render_rules: {
      visual_backbone: ["source_timeline", "chapter_cards", "game_footage", "context_graphics"],
      required_elements: [
        "chapter_cards",
        "source_timeline",
        "fact_check_callouts",
        "context_cards",
        "branded_outro",
      ],
      clip_dominance_target: 0.35,
      avoid: ["unsupported_claims", "shorts_only_pacing", "generic_filler_sections"],
    },
    qa_gates: [
      "source_pack_required",
      "fact_check_required",
      "chapter_cards_required",
      "source_timeline_required",
      "clear_uncertainty_labels_required",
    ],
    readiness_colour: colourFor(blockers, warnings),
    blockers,
    warnings,
    shared_intelligence: sharedIntelligenceContract(),
    production_safety: {
      report_only: true,
      changes_live_behaviour: false,
      switches_renderer: false,
      enables_hard_gates: false,
    },
  };
}

function buildNonVideoPolicy({ formatRoute, renderContract }) {
  const laneId = routeFormatLane(formatRoute?.verdict);
  const blockers = laneId === "reject" ? ["format_route_reject"] : [];
  const warnings = laneId === "blog_only" ? ["video_lane_not_recommended"] : ["unknown_format_lane"];

  if (renderContract?.render_lane === "reject" && !blockers.includes("render_contract_reject")) {
    blockers.push("render_contract_reject");
  }

  return {
    lane_id: laneId,
    lane_name: laneId === "reject" ? "Reject" : "Blog / Non-video",
    format_family: laneId,
    purpose: "No video lane should be selected until the story clears readiness.",
    runtime_target_seconds: { min: 0, max: 0 },
    platform_targets: laneId === "blog_only" ? ["blog"] : [],
    script_rules: [],
    caption_rules: {
      style: "none",
      max_words_per_punch: 0,
      prefer_one_line: true,
      kinetic_emphasis: false,
    },
    render_rules: {
      visual_backbone: [],
      required_elements: [],
      clip_dominance_target: 0,
      avoid: [],
    },
    qa_gates: ["do_not_render_as_video"],
    readiness_colour: colourFor(blockers, warnings),
    blockers,
    warnings,
    shared_intelligence: sharedIntelligenceContract(),
    production_safety: {
      report_only: true,
      changes_live_behaviour: false,
      switches_renderer: false,
      enables_hard_gates: false,
    },
  };
}

function buildFormatLanePolicy({
  story,
  formatRoute,
  sourcePack,
  mediaInventory,
  renderContract,
} = {}) {
  const lane = routeFormatLane(formatRoute?.verdict);
  if (lane === "pulse_flash_short") {
    return buildFlashLanePolicy({ story, mediaInventory, renderContract });
  }
  if (lane === "pulse_briefing_longform") {
    return buildBriefingLanePolicy({ sourcePack, mediaInventory, renderContract });
  }
  return buildNonVideoPolicy({ formatRoute, renderContract });
}

module.exports = {
  assessFlashLaneHookDiscipline,
  buildFormatLanePolicy,
  routeFormatLane,
};
