"use strict";

const FLASH_FORMATS = new Set(["premium_short", "standard_short", "short_only"]);
const BRIEFING_FORMATS = new Set([
  "daily_briefing_item",
  "weekly_roundup_item",
  "monthly_release_radar_item",
  "before_you_download_candidate",
  "trailer_breakdown_candidate",
]);
const EVERGREEN_FORMATS = new Set(["evergreen_verdict_short"]);

function routeFormatLane(formatVerdict) {
  if (FLASH_FORMATS.has(formatVerdict)) return "pulse_flash_short";
  if (BRIEFING_FORMATS.has(formatVerdict)) return "pulse_briefing_longform";
  if (EVERGREEN_FORMATS.has(formatVerdict)) {
    return "pulse_evergreen_verdict_short";
  }
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

function buildFlashLanePolicy({
  mediaInventory,
  renderContract,
  editorialContract,
  editorialBlocker,
}) {
  const blockers = [];
  const warnings = [];
  const exactCount = Number(mediaInventory?.exact_subject_asset_count || 0);
  const clipCount = Number(renderContract?.clip_count || 0);
  const visualCount = Number(renderContract?.visual_count || 0);

  if (renderContract?.render_lane === "reject") blockers.push("render_contract_reject");
  if (editorialBlocker) blockers.push(editorialBlocker);
  if (!editorialContract && !editorialBlocker) {
    blockers.push("pulse_editorial_contract_missing");
  }
  if (exactCount < 4) warnings.push("flash_lane_needs_more_exact_subject_visuals");
  if (clipCount < 1) warnings.push("flash_lane_needs_game_footage_backbone");
  if (visualCount < 8) warnings.push("flash_lane_needs_eight_scene_beats");

  return {
    lane_id: "pulse_flash_short",
    lane_name: "Pulse Flash Lane",
    format_family: "shorts",
    purpose: "High-energy gaming TikTok and Shorts-native news.",
    editorial_lane_id: editorialContract?.editorial_lane_id || null,
    duration_band_id: editorialContract?.duration_band_id || null,
    runtime_target_seconds: editorialContract
      ? {
          min: editorialContract.min_seconds,
          max: editorialContract.max_seconds,
        }
      : null,
    platform_targets: ["tiktok_dispatch", "youtube_shorts", "instagram_reels"],
    script_rules: [
      "open_with_wait_what_or_concrete_consequence",
      "first_two_seconds_hook",
      "first_eight_seconds_proof_or_context",
      "avoid_could_might_hooks",
      "single_editorial_angle",
      "selective_story_specific_cta_only",
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
        "branded_end_card",
      ],
      clip_dominance_target: 0.55,
      avoid: ["rating_cards", "trailer_logo_intro_cards", "generic_store_assets", "unapproved_local_voice"],
    },
    qa_gates: [
      "approved_voice_required",
      "pulse_editorial_contract_required",
      "selected_duration_band_required",
      "exact_subject_visuals_required",
      "no_wrong_story_assets",
      "subtitle_energy_required",
      "contextual_cta_policy_required",
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

function buildEvergreenVerdictLanePolicy({
  story,
  sourcePack,
  mediaInventory,
  renderContract,
}) {
  const blockers = [];
  const warnings = [];
  const sourceConfidence = String(
    sourcePack?.confidence_level || "unknown",
  ).toLowerCase();
  const assessment = story?.evergreen_verdict_assessment;
  const duration = Number(renderContract?.target_duration_seconds);
  const clipCount = Number(renderContract?.clip_count || 0);
  const visualCount = Number(renderContract?.visual_count || 0);
  const exactCount = Number(
    mediaInventory?.exact_subject_asset_count || 0,
  );

  if (renderContract?.render_lane === "reject") {
    blockers.push("render_contract_reject");
  }
  if (!Number.isFinite(duration) || duration < 61 || duration > 90) {
    blockers.push(
      "evergreen_verdict_requires_61_to_90_seconds",
    );
  }
  if (!["verified", "confirmed"].includes(sourceConfidence)) {
    blockers.push("evergreen_verdict_requires_verified_sources");
  }
  if (!assessment) {
    blockers.push("evergreen_verdict_pitch_assessment_missing");
  } else if (
    assessment.verdict !== "READY_FOR_PRODUCTION" ||
    (Array.isArray(assessment.blockers) &&
      assessment.blockers.length > 0)
  ) {
    blockers.push("evergreen_verdict_pitch_assessment_not_ready");
  }
  if (
    story?.script_contract?.uses_first_person_play_claims === true &&
    (story?.first_hand_evidence?.verified !== true ||
      !story?.first_hand_evidence?.capture_log_id ||
      !story?.first_hand_evidence?.reviewer_id)
  ) {
    blockers.push(
      "evergreen_verdict_first_hand_evidence_required",
    );
  }
  if (clipCount < 5) {
    warnings.push(
      "evergreen_verdict_needs_five_exact_subject_clips",
    );
  }
  if (exactCount < 5) {
    warnings.push(
      "evergreen_verdict_needs_richer_exact_subject_inventory",
    );
  }
  if (visualCount < 8) {
    warnings.push("evergreen_verdict_needs_eight_visual_beats");
  }

  return {
    lane_id: "pulse_evergreen_verdict_short",
    lane_name: "Pulse Evergreen Verdict Lane",
    format_family: "evergreen_verdict_short",
    purpose:
      "Original, source-backed rankings, comparisons and still-worth-playing verdicts.",
    duration_lane: "pulse_extended_short",
    runtime_target_seconds: { min: 61, max: 90, target: 82 },
    platform_targets: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    script_rules: [
      "immediate_premise_without_channel_intro",
      "state_judging_criteria",
      "one_specific_reason_per_judgement",
      "verified_first_hand_evidence_for_first_person_claims",
      "at_most_one_contextual_cta",
    ],
    caption_rules: {
      style: "readable_kinetic_verdict",
      max_words_per_punch: 7,
      prefer_one_line: true,
      kinetic_emphasis: true,
    },
    render_rules: {
      visual_backbone: [
        "exact_subject_gameplay",
        "official_trailer_motion",
        "brief_subject_identifier_cards",
      ],
      required_elements: [
        "motion_from_frame_one",
        "platform_safe_kinetic_emphasis",
        "criterion_markers",
        "verdict_progression",
      ],
      clip_dominance_target: 0.65,
      avoid: [
        "copied_titles",
        "copied_scripts",
        "copied_branding_or_trade_dress",
        "unknown_reuploads",
        "third_party_music",
      ],
    },
    qa_gates: [
      "evergreen_pitch_assessment_required",
      "verified_sources_required",
      "complete_rights_records_required",
      "exact_subject_motion_ratio_required",
      "first_hand_claim_evidence_required",
      "strict_green_render_required",
      "human_visual_review_required",
    ],
    readiness_colour: colourFor(blockers, warnings),
    blockers,
    warnings,
    shared_intelligence: sharedIntelligenceContract(),
    production_safety: {
      report_only: false,
      changes_live_behaviour: false,
      switches_renderer: false,
      enables_hard_gates: true,
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
  formatRoute,
  sourcePack,
  mediaInventory,
  renderContract,
  editorialContract,
  editorialBlocker,
  story,
} = {}) {
  const lane = routeFormatLane(formatRoute?.verdict);
  if (lane === "pulse_flash_short") {
    return buildFlashLanePolicy({
      mediaInventory,
      renderContract,
      editorialContract,
      editorialBlocker,
    });
  }
  if (lane === "pulse_briefing_longform") {
    return buildBriefingLanePolicy({ sourcePack, mediaInventory, renderContract });
  }
  if (lane === "pulse_evergreen_verdict_short") {
    return buildEvergreenVerdictLanePolicy({
      story,
      sourcePack,
      mediaInventory,
      renderContract,
    });
  }
  return buildNonVideoPolicy({ formatRoute, renderContract });
}

module.exports = {
  buildFormatLanePolicy,
  buildEvergreenVerdictLanePolicy,
  routeFormatLane,
};
