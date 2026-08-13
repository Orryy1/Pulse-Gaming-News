"use strict";

const {
  getTrustedPulseEditorialAcceptanceAuthorityState,
  getTrustedPulseRightsAuthorityState,
} = require("../../internal/pulse-editorial-authority-handles");

const PULSE_VISUAL_EDITORIAL_POLICY = Object.freeze({
  version: "pulse_visual_editorial_policy_v2",
  mode: "gameplay_first_animated_news_hybrid",
  benchmark_reference: "pulse_xbox_four_game_pass_games_video",
  authentic_game_media_is_default_backbone: true,
  continuous_full_bleed_game_motion_canvas_required: true,
  text_and_evidence_default_presentation: "OVERLAY",
  comparison_footage_counts_as_full_bleed_motion: true,
  unrelated_filler_forbidden: true,
  cta_and_outro_require_game_motion_canvas: true,
  rights_ledger_still_authoritative: true,
  target_authentic_motion_ratio: 0.72,
  minimum_authentic_motion_ratio_when_available: 0.6,
  maximum_context_card_duration_ratio: 0.25,
  maximum_generic_abstract_visual_ratio_when_relevant_game_media_exists: 0.08,
  preferred_motion_scene_count: 10,
  minimum_motion_scene_count: 8,
  source_audio_policy: "remove_or_replace",
  generic_ai_or_abstract_visuals_when_relevant_game_media_exists: "fallback_only",
  animated_context_is_required: true,
  animation_rule: "clarify_or_intensify_story_beat",
  decorative_motion_without_story_function: "forbidden",
  platform_story_theme_required: true,
  pulse_brand_boundary_required: true,
  supported_platform_visual_languages: Object.freeze([
    "xbox",
    "playstation",
    "nintendo",
    "steam",
    "multi_platform",
    "neutral",
  ]),
  required_animated_element_families: Object.freeze([
    "kinetic_headline",
    "game_count_reveal",
    "achievement_or_feature_pop",
    "timeline",
    "comparison_panel",
    "source_lock",
    "stat_or_price_count_up",
    "platform_signal_transition",
  ]),
  preferred_optional_element_families: Object.freeze([
    "animated_map",
    "release_calendar",
    "before_after_panel",
    "rank_or_score_meter",
    "quote_reveal",
    "player_impact_callout",
  ]),
  edit_rules: Object.freeze({
    open_on_story_specific_motion_or_animated_proof: true,
    first_attention_reset_deadline_s: 2.5,
    maximum_seconds_without_visual_change: 3.8,
    cards_overlay_gameplay_when_readable: true,
    adjacent_fullscreen_cards_forbidden: true,
    source_lock_is_provenance_not_narrative: true,
    gameplay_clips_must_be_story_specific: true,
    irrelevant_eye_candy_forbidden: true,
  }),
  platform_theme_rules: Object.freeze({
    preserve_pulse_amber_signature: true,
    preserve_pulse_wordmark: true,
    official_platform_logo_as_pulse_identity: false,
    official_account_impersonation_forbidden: true,
    platform_colour_and_motion_language_as_context: true,
  }),
});

const MOTION_CANVAS_TYPES = Object.freeze([
  "GAMEPLAY",
  "COMPARISON",
  "EVIDENCE_EXCEPTION",
]);

const BOUNDED_EDITORIAL_PURPOSES = Object.freeze([
  "CRITICISM_REVIEW",
  "QUOTATION",
  "CURRENT_EVENTS_REPORTING",
  "COMPARISON",
]);

const MOTION_CANVAS_FORMAT_PROFILES = Object.freeze({
  SHORT: Object.freeze({
    maximum_single_evidence_exception_seconds: 3.5,
    editorial_exception_default_minimum_seconds: 2,
    editorial_exception_default_maximum_seconds: 5,
    editorial_exception_maximum_justified_comparison_seconds: 8,
    editorial_exception_maximum_per_asset_seconds: 8,
    editorial_exception_maximum_per_episode_seconds: 20,
  }),
  LONGFORM: Object.freeze({
    maximum_single_evidence_exception_seconds: 8,
    editorial_exception_default_minimum_seconds: 3,
    editorial_exception_default_maximum_seconds: 10,
    editorial_exception_maximum_justified_comparison_seconds: 15,
    editorial_exception_maximum_per_asset_seconds: 30,
    editorial_exception_maximum_per_episode_seconds: 90,
  }),
  DOCUMENTARY: Object.freeze({
    maximum_single_evidence_exception_seconds: 8,
    editorial_exception_default_minimum_seconds: 3,
    editorial_exception_default_maximum_seconds: 10,
    editorial_exception_maximum_justified_comparison_seconds: 15,
    editorial_exception_maximum_per_asset_seconds: 30,
    editorial_exception_maximum_per_episode_seconds: 90,
  }),
});

function round(value, places = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(places)) : null;
}

function clean(value) {
  return String(value || "").trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normaliseFormat(value) {
  const format = clean(value).toUpperCase();
  return MOTION_CANVAS_FORMAT_PROFILES[format] ? format : "SHORT";
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function normaliseUsageScope(value = {}) {
  return deepFreeze({
    platform: clean(value.platform || "youtube_shorts").toLowerCase(),
    ypp_monetisation_requested: value.ypp_monetisation_requested !== false,
    paywall_distribution_requested: value.paywall_distribution_requested === true,
    resale_requested: value.resale_requested === true,
  });
}

function trustedRightsBindingReasons({
  authority,
  segment,
  expectedVerdict,
  usageScope,
}) {
  const state = getTrustedPulseRightsAuthorityState(authority);
  if (!state) return { reasons: ["trusted_rights_authority_required"], state: null };
  const rightsRecordId = clean(segmentValue(segment, "rights_record_id"));
  const canonicalMediaSha256 = clean(
    segmentValue(segment, "source_media_sha256"),
  ).toLowerCase();
  const sourceAssetId = clean(segmentValue(segment, "source_asset_id"));
  const record = state.records.find(
    (candidate) =>
      clean(candidate.rights_record_id) === rightsRecordId &&
      clean(candidate.canonical_media_sha256).toLowerCase() === canonicalMediaSha256 &&
      (!clean(candidate.source_asset_id) ||
        clean(candidate.source_asset_id) === sourceAssetId),
  );
  if (!record) {
    return {
      reasons: ["trusted_rights_record_not_bound_to_canonical_media"],
      state,
    };
  }
  const reasons = [];
  const verdict = clean(record.verdict).toUpperCase();
  if (verdict !== expectedVerdict) reasons.push("trusted_rights_verdict_mismatch");
  const assessedPlatforms = record.assessed_platforms.map((value) => clean(value).toLowerCase());
  if (!assessedPlatforms.includes(usageScope.platform)) {
    reasons.push("trusted_rights_platform_scope_missing");
  }
  if (expectedVerdict === "GREEN") {
    if (record.commercial_use_allowed !== true) {
      reasons.push("trusted_rights_commercial_scope_missing");
    }
    if (
      usageScope.ypp_monetisation_requested &&
      record.youtube_partner_programme_allowed !== true
    ) {
      reasons.push("trusted_rights_ypp_scope_missing");
    }
    if (
      usageScope.paywall_distribution_requested &&
      record.paywall_use_allowed !== true
    ) {
      reasons.push("trusted_rights_paywall_scope_missing");
    }
    if (usageScope.resale_requested && record.resale_allowed !== true) {
      reasons.push("trusted_rights_resale_scope_missing");
    }
  } else if (expectedVerdict === "AMBER") {
    if (record.editorial_exception_review_allowed !== true) {
      reasons.push("trusted_rights_editorial_review_scope_missing");
    }
    if (usageScope.ypp_monetisation_requested && record.ypp_risk_reviewed !== true) {
      reasons.push("trusted_rights_ypp_risk_unreviewed");
    }
    if (
      usageScope.paywall_distribution_requested &&
      record.paywall_risk_reviewed !== true
    ) {
      reasons.push("trusted_rights_paywall_risk_unreviewed");
    }
    if (usageScope.resale_requested && record.resale_risk_reviewed !== true) {
      reasons.push("trusted_rights_resale_risk_unreviewed");
    }
  }
  return { reasons, record, state };
}

function trustedAcceptanceBinding({
  authority,
  episodeId,
  segment,
  timelineStart,
  timelineEnd,
  sourceStart,
  sourceEnd,
  sourceMediaSha256,
}) {
  const state = getTrustedPulseEditorialAcceptanceAuthorityState(authority);
  if (!state) return { reason: "trusted_acceptance_authority_required", state: null };
  const rightsRecordId = clean(segmentValue(segment, "rights_record_id"));
  const sourceAssetId = clean(segmentValue(segment, "source_asset_id"));
  const acceptance = state.records.find(
    (candidate) =>
      clean(candidate.episode_id) === episodeId &&
      clean(candidate.rights_record_id) === rightsRecordId &&
      clean(candidate.source_asset_id) === sourceAssetId &&
      clean(candidate.canonical_media_sha256).toLowerCase() === sourceMediaSha256 &&
      Number(candidate.timeline_start_s) === timelineStart &&
      Number(candidate.timeline_end_s) === timelineEnd &&
      Number(candidate.source_start_s) === sourceStart &&
      Number(candidate.source_end_s) === sourceEnd,
  );
  return acceptance
    ? { acceptance, state, reason: null }
    : { reason: "trusted_acceptance_not_bound_to_exact_window", state };
}

function authorityEvidenceSummary(state) {
  return state ? { ...state.evidence, actor: { ...state.actor } } : null;
}

function segmentValue(segment = {}, key) {
  if (Object.hasOwn(segment, key)) return segment[key];
  const record = segment.rights_record;
  return record && typeof record === "object" ? record[key] : undefined;
}

function buildPulseMotionCanvasContract({ format = "SHORT" } = {}) {
  const normalisedFormat = normaliseFormat(format);
  const profile = MOTION_CANVAS_FORMAT_PROFILES[normalisedFormat];
  return Object.freeze({
    contract_id: "pulse_motion_canvas_contract_v1",
    format: normalisedFormat,
    default_canvas: "FULL_BLEED_GAME_MOTION",
    allowed_canvas_types: [...MOTION_CANVAS_TYPES],
    required_timeline_coverage_ratio: 1,
    required_full_bleed_coverage_ratio: 1,
    text_and_evidence_default_presentation: "OVERLAY",
    comparison_footage_counts_as_full_bleed_motion: true,
    unrelated_filler_forbidden: true,
    cta_and_outro_require_game_motion_canvas: true,
    rights_ledger_still_authoritative: true,
    rights_verdict_required: "GREEN",
    continuous_canvas_rights_verdict_required: "GREEN",
    commercial_use_must_be_affirmative: true,
    fullscreen_evidence_exception: Object.freeze({
      allowed_only_when_necessary_for_readability: true,
      evidence_id_required: true,
      necessity_code_required: true,
      maximum_single_seconds:
        profile.maximum_single_evidence_exception_seconds,
    }),
    bounded_editorial_exception: Object.freeze({
      green_sources_may_be_continuous_canvas: true,
      amber_sources_are_brief_claim_bound_evidence_only: true,
      source_rights_verdict_required: "AMBER",
      default_window_seconds: Object.freeze({
        minimum: profile.editorial_exception_default_minimum_seconds,
        maximum: profile.editorial_exception_default_maximum_seconds,
      }),
      maximum_justified_comparison_seconds:
        profile.editorial_exception_maximum_justified_comparison_seconds,
      maximum_per_asset_seconds:
        profile.editorial_exception_maximum_per_asset_seconds,
      maximum_per_episode_seconds:
        profile.editorial_exception_maximum_per_episode_seconds,
      longer_comparison_requires_explicit_justification: true,
      human_review_required: true,
      exact_window_required: true,
      permanent_visible_attribution_required: true,
      source_audio_must_be_muted: true,
      transformation_and_annotation_required: true,
      minimum_necessary_rationale_required: true,
      fact_specific_rights_record_required: true,
      supported_editorial_purposes: [...BOUNDED_EDITORIAL_PURPOSES],
      credit_is_clearance: false,
      licence_clearance_claimed: false,
      legal_clearance_claimed: false,
      legal_safe_harbour_claimed: false,
    }),
  });
}

function buildPulseEditorialExceptionPlan({
  format = "SHORT",
  episode_id: episodeId,
  segments = [],
  trusted_rights_authority: trustedRightsAuthority,
  trusted_acceptance_authority: trustedAcceptanceAuthority,
  usage_scope: requestedUsageScope,
} = {}) {
  const contract = buildPulseMotionCanvasContract({ format });
  const controls = contract.bounded_editorial_exception;
  const normalisedEpisodeId = clean(episodeId);
  const usageScope = normaliseUsageScope(requestedUsageScope);
  const blockers = [];
  const warnings = [];
  const addUnique = (rows, value) => {
    if (value && !rows.includes(value)) rows.push(value);
  };
  const usesByAsset = new Map();
  const usesByCanonicalMedia = new Map();
  let totalSeconds = 0;
  let totalSourceWindowSeconds = 0;

  const entries = (Array.isArray(segments) ? segments : []).map((segment, index) => {
    const segmentId = clean(segment.segment_id) || `segment-${index + 1}`;
    const prefix = `editorial_exception:${segmentId}`;
    const entryBlockers = [];
    const entryReviewBlockers = [];
    const entryWarnings = [
      `${prefix}:copyright_exception_is_fact_specific_and_not_a_licence`,
    ];
    const fail = (reason) => addUnique(entryBlockers, `${prefix}:${reason}`);
    const hold = (reason) => addUnique(entryReviewBlockers, `${prefix}:${reason}`);
    const start = Number(segment.start_s);
    const end = Number(segment.end_s);
    const duration = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? round(end - start)
      : null;
    const sourceStart = Number(segmentValue(segment, "source_start_s"));
    const sourceEnd = Number(segmentValue(segment, "source_end_s"));
    const sourceDuration = Number.isFinite(sourceStart) &&
      Number.isFinite(sourceEnd) && sourceEnd > sourceStart
      ? round(sourceEnd - sourceStart)
      : null;
    const sourceAssetId = clean(segmentValue(segment, "source_asset_id"));
    const sourceMediaSha256 = clean(
      segmentValue(segment, "source_media_sha256"),
    ).toLowerCase();
    const canvasType = clean(segment.canvas_type).toUpperCase();

    if (clean(segment.rights_verdict).toUpperCase() !== "AMBER") {
      fail("rights_verdict_must_remain_amber");
    }
    if (!sourceAssetId) fail("source_asset_id_missing");
    if (!clean(segmentValue(segment, "source_owner"))) fail("source_owner_missing");
    if (!clean(segmentValue(segment, "source_url"))) fail("source_url_missing");
    if (!isSha256(sourceMediaSha256)) fail("source_media_sha256_missing_or_invalid");
    if (sourceDuration == null) fail("exact_source_window_missing");
    if (segment.directly_tied_to_narrated_claim !== true) {
      fail("narrated_claim_tie_missing");
    }
    if (!clean(segment.narrated_claim_id)) fail("narrated_claim_id_missing");
    if (
      !BOUNDED_EDITORIAL_PURPOSES.includes(
        clean(segment.editorial_purpose).toUpperCase(),
      )
    ) {
      fail("editorial_purpose_missing_or_unsupported");
    }
    if (segment.permanent_visible_attribution !== true) {
      fail("permanent_visible_attribution_missing");
    }
    if (!clean(segment.attribution_text)) fail("attribution_text_missing");
    if (segment.source_audio_muted !== true) fail("source_audio_must_be_muted");
    if (segment.contains_creator_narration !== false) {
      fail("creator_narration_must_be_absent");
    }
    if (segment.contains_third_party_music !== false) {
      fail("third_party_music_must_be_absent");
    }
    if (
      segment.transformation_applied !== true ||
      !clean(segment.transformation_notes)
    ) {
      fail("transformation_missing");
    }
    if (segment.annotation_present !== true || !clean(segment.annotation_notes)) {
      fail("annotation_missing");
    }
    if (
      segment.minimum_necessary !== true ||
      !clean(segment.minimum_necessary_rationale)
    ) {
      fail("minimum_necessary_rationale_missing");
    }
    if (
      segmentValue(segment, "fact_specific_rights_record") !== true ||
      !clean(segmentValue(segment, "rights_record_id"))
    ) {
      fail("fact_specific_rights_record_missing");
    }
    if (
      !/bounded_editorial_(?:exception|excerpt)|uk_fair_dealing/i.test(
        clean(segmentValue(segment, "rights_decision_basis")),
      )
    ) {
      fail("bounded_editorial_rights_basis_missing");
    }
    if (
      !normalisedEpisodeId ||
      clean(segmentValue(segment, "rights_record_episode_id")) !== normalisedEpisodeId
    ) {
      fail("rights_record_not_bound_to_episode");
    }
    if (segmentValue(segment, "licence_clearance_claimed") !== false) {
      fail("licence_clearance_claim_forbidden");
    }
    if (segmentValue(segment, "legal_clearance_claimed") !== false) {
      fail("legal_clearance_claim_forbidden");
    }
    if (segmentValue(segment, "ownership_claimed") !== false) {
      fail("ownership_claim_forbidden");
    }
    if (segment.decorative_use !== false) fail("decorative_use_forbidden");
    if (segment.generic_wallpaper !== false) fail("generic_wallpaper_forbidden");
    if (segment.watermark_removed !== false) fail("watermark_removal_forbidden");
    if (segment.long_unanalysed_sequence !== false) {
      fail("long_unanalysed_sequence_forbidden");
    }
    if (duration == null) {
      fail("timeline_window_missing");
    } else {
      totalSeconds += duration;
      if (sourceAssetId) {
        usesByAsset.set(sourceAssetId, round((usesByAsset.get(sourceAssetId) || 0) + duration));
      }
      if (duration < controls.default_window_seconds.minimum) {
        addUnique(entryWarnings, `${prefix}:below_default_window_range`);
      }
      if (duration > controls.default_window_seconds.maximum) {
        if (
          canvasType !== "COMPARISON" ||
          segment.comparison_requires_continuity !== true ||
          !clean(segment.longer_comparison_justification)
        ) {
          fail("longer_comparison_justification_missing");
        }
      }
      if (duration > controls.maximum_justified_comparison_seconds) {
        fail("maximum_justified_comparison_duration_exceeded");
      }
    }
    if (sourceDuration != null) {
      totalSourceWindowSeconds += sourceDuration;
      if (sourceDuration > controls.default_window_seconds.maximum) {
        if (
          canvasType !== "COMPARISON" ||
          segment.comparison_requires_continuity !== true ||
          !clean(segment.longer_comparison_justification)
        ) {
          fail("longer_source_window_justification_missing");
        }
      }
      if (sourceDuration > controls.maximum_justified_comparison_seconds) {
        fail("maximum_justified_comparison_source_window_exceeded");
      }
    }
    if (isSha256(sourceMediaSha256)) {
      const current = usesByCanonicalMedia.get(sourceMediaSha256) || {
        output_seconds: 0,
        source_window_seconds: 0,
      };
      usesByCanonicalMedia.set(sourceMediaSha256, {
        output_seconds: round(current.output_seconds + (duration || 0)),
        source_window_seconds: round(
          current.source_window_seconds + (sourceDuration || 0),
        ),
      });
    }

    const rightsBinding = trustedRightsBindingReasons({
      authority: trustedRightsAuthority,
      segment,
      expectedVerdict: "AMBER",
      usageScope,
    });
    for (const reason of rightsBinding.reasons) {
      if (reason === "trusted_rights_verdict_mismatch") fail(reason);
      else hold(reason);
    }

    // The similarly named object in a story is intentionally ignored. Only an
    // opaque handle produced from separately materialised authority evidence
    // can resolve this exact episode, canonical media hash and source window.
    const acceptanceBinding = trustedAcceptanceBinding({
      authority: trustedAcceptanceAuthority,
      episodeId: normalisedEpisodeId,
      segment,
      timelineStart: start,
      timelineEnd: end,
      sourceStart,
      sourceEnd,
      sourceMediaSha256,
    });
    if (acceptanceBinding.reason) {
      hold("human_review_unresolved");
      hold(acceptanceBinding.reason);
    }

    entryBlockers.forEach((value) => addUnique(blockers, value));
    entryReviewBlockers.forEach((value) => addUnique(blockers, value));
    entryWarnings.forEach((value) => addUnique(warnings, value));
    return {
      segment_id: segmentId,
      source_asset_id: sourceAssetId || null,
      authority_binding: {
        rights_record_id: clean(segmentValue(segment, "rights_record_id")) || null,
        source_asset_id: sourceAssetId || null,
        canonical_media_sha256: isSha256(sourceMediaSha256)
          ? sourceMediaSha256
          : null,
        timeline_start_s: Number.isFinite(start) ? start : null,
        timeline_end_s: Number.isFinite(end) ? end : null,
        source_start_s: Number.isFinite(sourceStart) ? sourceStart : null,
        source_end_s: Number.isFinite(sourceEnd) ? sourceEnd : null,
        expected_rights_verdict: "AMBER",
      },
      source_window: sourceDuration == null
        ? null
        : { start_s: sourceStart, end_s: sourceEnd, duration_s: sourceDuration },
      timeline_duration_s: duration,
      status: entryBlockers.length
        ? "RED"
        : entryReviewBlockers.length
          ? "AMBER_HUMAN_REVIEW_REQUIRED"
          : "GOVERNANCE_RESOLVED_FOR_EPISODE",
      blockers: [...entryBlockers, ...entryReviewBlockers],
      warnings: entryWarnings,
      licence_clearance_claimed: false,
      legal_clearance_claimed: false,
      ownership_claimed: false,
    };
  });

  for (const [sourceAssetId, seconds] of usesByAsset.entries()) {
    if (seconds > controls.maximum_per_asset_seconds) {
      addUnique(
        blockers,
        `editorial_exception:${sourceAssetId}:maximum_per_asset_duration_exceeded`,
      );
    }
  }
  for (const [canonicalMediaSha256, seconds] of usesByCanonicalMedia.entries()) {
    if (seconds.output_seconds > controls.maximum_per_asset_seconds) {
      addUnique(
        blockers,
        `editorial_exception:media:${canonicalMediaSha256}:maximum_per_media_output_duration_exceeded`,
      );
    }
    if (seconds.source_window_seconds > controls.maximum_per_asset_seconds) {
      addUnique(
        blockers,
        `editorial_exception:media:${canonicalMediaSha256}:maximum_per_media_source_window_duration_exceeded`,
      );
    }
  }
  if (totalSeconds > controls.maximum_per_episode_seconds) {
    addUnique(blockers, "editorial_exception:maximum_per_episode_duration_exceeded");
  }
  if (totalSourceWindowSeconds > controls.maximum_per_episode_seconds) {
    addUnique(
      blockers,
      "editorial_exception:maximum_per_episode_source_window_duration_exceeded",
    );
  }
  const hasRed = entries.some((entry) => entry.status === "RED") ||
    blockers.some((blocker) => /duration_exceeded$/.test(blocker));
  const hasUnresolvedReview = entries.some(
    (entry) => entry.status === "AMBER_HUMAN_REVIEW_REQUIRED",
  );
  return {
    contract_id: contract.contract_id,
    format: contract.format,
    episode_id: normalisedEpisodeId || null,
    used: entries.length > 0,
    verdict: !entries.length
      ? "NOT_USED"
      : hasRed
        ? "RED"
        : hasUnresolvedReview
          ? "AMBER_HUMAN_REVIEW_REQUIRED"
          : "GOVERNANCE_RESOLVED_FOR_EPISODE",
    planning_valid: !entries.length || (!hasRed && !hasUnresolvedReview),
    blockers,
    warnings,
    entries,
    duration_controls: {
      default_window_seconds: { ...controls.default_window_seconds },
      maximum_justified_comparison_seconds:
        controls.maximum_justified_comparison_seconds,
      maximum_per_asset_seconds: controls.maximum_per_asset_seconds,
      maximum_per_episode_seconds: controls.maximum_per_episode_seconds,
      total_exception_seconds: round(totalSeconds),
      total_source_window_seconds: round(totalSourceWindowSeconds),
      per_asset_seconds: Object.fromEntries(usesByAsset),
      per_media_sha256: Object.fromEntries(usesByCanonicalMedia),
    },
    usage_scope: { ...usageScope },
    authority_evidence: {
      rights: authorityEvidenceSummary(
        getTrustedPulseRightsAuthorityState(trustedRightsAuthority),
      ),
      acceptance: authorityEvidenceSummary(
        getTrustedPulseEditorialAcceptanceAuthorityState(
          trustedAcceptanceAuthority,
        ),
      ),
    },
    human_review_path: "HASH_BOUND_EPISODE_EXACT_WINDOW_ACCEPTANCE",
    publish_gate: "GREEN_CONTROL_TOWER_REQUIRED",
    rights_ledger_still_authoritative: true,
    credit_is_clearance: false,
    licence_clearance_claimed: false,
    legal_clearance_claimed: false,
    legal_safe_harbour_claimed: false,
  };
}

function verifyPulseEditorialExceptionPlanAuthority({
  plan = {},
  trusted_rights_authority: trustedRightsAuthority,
  trusted_acceptance_authority: trustedAcceptanceAuthority,
} = {}) {
  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  if (plan.used !== true && entries.length === 0) {
    return {
      valid: true,
      required: false,
      blockers: [],
      verified_entry_count: 0,
    };
  }
  const blockers = [];
  const add = (value) => {
    if (value && !blockers.includes(value)) blockers.push(value);
  };
  const episodeId = clean(plan.episode_id);
  const usageScope = normaliseUsageScope(plan.usage_scope);
  if (plan.used !== true || !entries.length) {
    add("editorial_authority:serialized_plan_entries_missing");
  }
  if (
    plan.planning_valid !== true ||
    plan.verdict !== "GOVERNANCE_RESOLVED_FOR_EPISODE"
  ) {
    add("editorial_authority:serialized_plan_not_resolved");
  }
  if (!episodeId) add("editorial_authority:serialized_plan_episode_missing");
  const seenSegmentIds = new Set();
  const seenBindings = new Set();
  let verifiedEntryCount = 0;
  for (const [index, entry] of entries.entries()) {
    const segmentId = clean(entry.segment_id) || `segment-${index + 1}`;
    const prefix = `editorial_authority:entry:${segmentId}`;
    const binding = entry.authority_binding || {};
    const rightsRecordId = clean(binding.rights_record_id);
    const sourceAssetId = clean(binding.source_asset_id);
    const sourceMediaSha256 = clean(binding.canonical_media_sha256).toLowerCase();
    const timelineStart = binding.timeline_start_s;
    const timelineEnd = binding.timeline_end_s;
    const sourceStart = binding.source_start_s;
    const sourceEnd = binding.source_end_s;
    const bindingValid =
      rightsRecordId &&
      sourceAssetId &&
      isSha256(sourceMediaSha256) &&
      binding.expected_rights_verdict === "AMBER" &&
      Number.isFinite(timelineStart) &&
      Number.isFinite(timelineEnd) &&
      timelineEnd > timelineStart &&
      Number.isFinite(sourceStart) &&
      Number.isFinite(sourceEnd) &&
      sourceEnd > sourceStart;
    if (!bindingValid) {
      add(`${prefix}:authority_binding_invalid`);
      continue;
    }
    if (seenSegmentIds.has(segmentId)) add(`${prefix}:duplicate_segment_id`);
    seenSegmentIds.add(segmentId);
    const bindingKey = [
      rightsRecordId,
      sourceAssetId,
      sourceMediaSha256,
      timelineStart,
      timelineEnd,
      sourceStart,
      sourceEnd,
    ].join("|");
    if (seenBindings.has(bindingKey)) add(`${prefix}:duplicate_authority_binding`);
    seenBindings.add(bindingKey);
    if (
      Number(entry.timeline_duration_s) !== round(timelineEnd - timelineStart) ||
      Number(entry.source_window?.start_s) !== sourceStart ||
      Number(entry.source_window?.end_s) !== sourceEnd ||
      Number(entry.source_window?.duration_s) !== round(sourceEnd - sourceStart)
    ) {
      add(`${prefix}:serialized_window_binding_mismatch`);
    }
    if (entry.status !== "GOVERNANCE_RESOLVED_FOR_EPISODE") {
      add(`${prefix}:serialized_entry_not_resolved`);
    }
    const segment = {
      rights_record_id: rightsRecordId,
      source_asset_id: sourceAssetId,
      source_media_sha256: sourceMediaSha256,
    };
    const rightsBinding = trustedRightsBindingReasons({
      authority: trustedRightsAuthority,
      segment,
      expectedVerdict: "AMBER",
      usageScope,
    });
    for (const reason of rightsBinding.reasons) add(`${prefix}:${reason}`);
    const acceptanceBinding = trustedAcceptanceBinding({
      authority: trustedAcceptanceAuthority,
      episodeId,
      segment,
      timelineStart,
      timelineEnd,
      sourceStart,
      sourceEnd,
      sourceMediaSha256,
    });
    if (acceptanceBinding.reason) add(`${prefix}:${acceptanceBinding.reason}`);
    if (!rightsBinding.reasons.length && !acceptanceBinding.reason) {
      verifiedEntryCount += 1;
    }
  }
  return {
    valid: blockers.length === 0 && verifiedEntryCount === entries.length,
    required: true,
    blockers,
    verified_entry_count: verifiedEntryCount,
    authority_evidence: {
      rights: authorityEvidenceSummary(
        getTrustedPulseRightsAuthorityState(trustedRightsAuthority),
      ),
      acceptance: authorityEvidenceSummary(
        getTrustedPulseEditorialAcceptanceAuthorityState(
          trustedAcceptanceAuthority,
        ),
      ),
    },
  };
}

function addInterval(intervals, start, end) {
  if (!(end > start)) return intervals;
  const next = [...intervals, [start, end]].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const interval of next) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) {
      merged.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  return merged;
}

function intervalSeconds(intervals) {
  return round(
    intervals.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0),
  );
}

function validatePulseMotionCanvasTimeline({
  format = "SHORT",
  episode_id: episodeId,
  duration_s: durationS,
  segments = [],
  trusted_rights_authority: trustedRightsAuthority,
  trusted_acceptance_authority: trustedAcceptanceAuthority,
  usage_scope: requestedUsageScope,
} = {}) {
  const contract = buildPulseMotionCanvasContract({ format });
  const usageScope = normaliseUsageScope(requestedUsageScope);
  const blockers = [];
  const addBlocker = (blocker) => {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };
  const duration = Number(durationS);
  if (!(duration > 0)) addBlocker("timeline:duration_invalid");
  const ordered = (Array.isArray(segments) ? segments : [])
    .map((segment) => ({ ...segment }))
    .sort((left, right) => Number(left.start_s) - Number(right.start_s));
  if (ordered.length === 0) addBlocker("timeline:segments_missing");
  const amberSegments = ordered.filter(
    (segment) => clean(segment.rights_verdict).toUpperCase() === "AMBER",
  );
  const editorialExceptionPlan = buildPulseEditorialExceptionPlan({
    format,
    episode_id: episodeId,
    segments: amberSegments,
    trusted_rights_authority: trustedRightsAuthority,
    trusted_acceptance_authority: trustedAcceptanceAuthority,
    usage_scope: usageScope,
  });
  const editorialExceptionBlockers = new Map(
    editorialExceptionPlan.entries.map((entry) => [entry.segment_id, entry.blockers]),
  );

  let cursor = 0;
  let coveredIntervals = [];
  let fullBleedIntervals = [];
  let motionCanvasSeconds = 0;
  let comparisonMotionSeconds = 0;
  let fullscreenEvidenceExceptionSeconds = 0;
  let boundedEditorialExceptionSeconds = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const segment = ordered[index];
    const id = clean(segment.segment_id) || `segment-${index + 1}`;
    const start = Number(segment.start_s);
    const end = Number(segment.end_s);
    const type = clean(segment.canvas_type).toUpperCase();
    const phase = clean(segment.editorial_phase).toUpperCase();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
      addBlocker(`segment:timing_invalid:${id}`);
      continue;
    }
    if (start > cursor + 0.001) {
      addBlocker(`timeline:gap:${cursor.toFixed(3)}-${start.toFixed(3)}`);
    } else if (start < cursor - 0.001) {
      addBlocker(`timeline:overlap:${start.toFixed(3)}-${cursor.toFixed(3)}`);
    }
    cursor = Math.max(cursor, end);
    coveredIntervals = addInterval(coveredIntervals, start, end);
    if (segment.full_bleed === true) {
      fullBleedIntervals = addInterval(fullBleedIntervals, start, end);
    } else {
      addBlocker(`segment:full_bleed_required:${id}`);
    }
    if (!contract.allowed_canvas_types.includes(type)) {
      addBlocker(`segment:canvas_type_not_allowed:${id}`);
    }
    if (segment.story_relevant !== true) {
      addBlocker(`segment:story_relevance_missing:${id}`);
    }
    if (!clean(segment.rights_record_id)) {
      addBlocker(`segment:rights_record_missing:${id}`);
    }
    const rightsVerdict = clean(segment.rights_verdict).toUpperCase();
    if (rightsVerdict === "AMBER") {
      boundedEditorialExceptionSeconds += end - start;
      for (const blocker of editorialExceptionBlockers.get(id) || []) {
        addBlocker(blocker);
      }
    } else {
      const rightsBinding = trustedRightsBindingReasons({
        authority: trustedRightsAuthority,
        segment,
        expectedVerdict: "GREEN",
        usageScope,
      });
      for (const reason of rightsBinding.reasons) {
        addBlocker(`segment:${reason}:${id}`);
      }
      if (rightsVerdict !== "GREEN") {
        addBlocker(`segment:rights_verdict_not_green:${id}`);
      }
      if (segment.commercial_use_allowed !== true) {
        addBlocker(`segment:commercial_use_not_allowed:${id}`);
      }
    }
    if (
      segment.has_text_or_evidence_overlay === true &&
      clean(segment.overlay_presentation).toUpperCase() !== "OVERLAY"
    ) {
      addBlocker(`segment:text_or_evidence_must_overlay:${id}`);
    }
    const segmentDuration = end - start;
    if (type === "GAMEPLAY" || type === "COMPARISON") {
      motionCanvasSeconds += segmentDuration;
      if (type === "COMPARISON") comparisonMotionSeconds += segmentDuration;
    }
    if (type === "EVIDENCE_EXCEPTION") {
      fullscreenEvidenceExceptionSeconds += segmentDuration;
      if (!clean(segment.evidence_id)) {
        addBlocker(`evidence_exception:evidence_id_missing:${id}`);
      }
      if (!clean(segment.necessity_code)) {
        addBlocker(`evidence_exception:necessity_code_missing:${id}`);
      }
      if (
        segmentDuration >
        contract.fullscreen_evidence_exception.maximum_single_seconds + 0.001
      ) {
        addBlocker(`evidence_exception:duration_exceeded:${id}`);
      }
    }
    if ((phase === "CTA" || phase === "OUTRO") && type !== "GAMEPLAY" && type !== "COMPARISON") {
      addBlocker(`ending:game_motion_canvas_required:${id}`);
    }
  }
  for (const blocker of editorialExceptionPlan.blockers) {
    addBlocker(blocker);
  }
  if (duration > 0 && cursor < duration - 0.001) {
    addBlocker(`timeline:gap:${cursor.toFixed(3)}-${duration.toFixed(3)}`);
  }
  if (duration > 0 && cursor > duration + 0.001) {
    addBlocker("timeline:segment_exceeds_runtime");
  }

  const coveredSeconds = duration > 0
    ? Math.min(duration, intervalSeconds(coveredIntervals) || 0)
    : 0;
  const fullBleedSeconds = duration > 0
    ? Math.min(duration, intervalSeconds(fullBleedIntervals) || 0)
    : 0;
  const timelineCoverageRatio = duration > 0 ? round(coveredSeconds / duration, 6) : 0;
  const fullBleedCoverageRatio = duration > 0 ? round(fullBleedSeconds / duration, 6) : 0;
  if (timelineCoverageRatio !== contract.required_timeline_coverage_ratio) {
    addBlocker("timeline:continuous_coverage_required");
  }
  if (fullBleedCoverageRatio !== contract.required_full_bleed_coverage_ratio) {
    addBlocker("timeline:full_bleed_coverage_required");
  }

  const governedEditorialExceptionUsed =
    editorialExceptionPlan.verdict === "GOVERNANCE_RESOLVED_FOR_EPISODE";
  return {
    contract_id: contract.contract_id,
    format: contract.format,
    valid: blockers.length === 0,
    verdict: blockers.length
      ? "BLOCKED"
      : governedEditorialExceptionUsed
        ? "PASS_WITH_GOVERNED_EDITORIAL_EXCEPTION"
        : "PASS",
    blockers,
    editorial_exception_plan: editorialExceptionPlan,
    usage_scope: { ...usageScope },
    metrics: {
      duration_seconds: round(duration),
      timeline_coverage_ratio: timelineCoverageRatio,
      full_bleed_coverage_ratio: fullBleedCoverageRatio,
      motion_canvas_seconds: round(motionCanvasSeconds),
      comparison_motion_seconds: round(comparisonMotionSeconds),
      fullscreen_evidence_exception_seconds: round(
        fullscreenEvidenceExceptionSeconds,
      ),
      bounded_editorial_exception_seconds: round(
        boundedEditorialExceptionSeconds,
      ),
    },
    rights_ledger_still_authoritative: true,
  };
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function resolvePulseVisualEditorialPolicy(story = {}) {
  const override =
    story.visual_editorial_policy ||
    story.visualEditorialPolicy ||
    story.channel_visual_editorial_policy ||
    {};
  const targetAuthenticMotionRatio = clamp(
    override.target_authentic_motion_ratio,
    PULSE_VISUAL_EDITORIAL_POLICY.minimum_authentic_motion_ratio_when_available,
    0.9,
    PULSE_VISUAL_EDITORIAL_POLICY.target_authentic_motion_ratio,
  );
  const preferredMotionSceneCount = Math.round(
    clamp(
      override.preferred_motion_scene_count,
      PULSE_VISUAL_EDITORIAL_POLICY.minimum_motion_scene_count,
      16,
      PULSE_VISUAL_EDITORIAL_POLICY.preferred_motion_scene_count,
    ),
  );
  const immutableMotionCanvasContract = buildPulseMotionCanvasContract({
    format: "SHORT",
  });

  return {
    ...PULSE_VISUAL_EDITORIAL_POLICY,
    ...override,
    version: PULSE_VISUAL_EDITORIAL_POLICY.version,
    mode: PULSE_VISUAL_EDITORIAL_POLICY.mode,
    continuous_full_bleed_game_motion_canvas_required: true,
    text_and_evidence_default_presentation: "OVERLAY",
    comparison_footage_counts_as_full_bleed_motion: true,
    unrelated_filler_forbidden: true,
    cta_and_outro_require_game_motion_canvas: true,
    rights_ledger_still_authoritative: true,
    source_audio_policy: PULSE_VISUAL_EDITORIAL_POLICY.source_audio_policy,
    authentic_game_media_is_default_backbone:
      PULSE_VISUAL_EDITORIAL_POLICY.authentic_game_media_is_default_backbone,
    irrelevant_eye_candy_forbidden:
      PULSE_VISUAL_EDITORIAL_POLICY.edit_rules.irrelevant_eye_candy_forbidden,
    official_account_impersonation_forbidden:
      PULSE_VISUAL_EDITORIAL_POLICY.platform_theme_rules
        .official_account_impersonation_forbidden,
    gameplay_clips_must_be_story_specific:
      PULSE_VISUAL_EDITORIAL_POLICY.edit_rules
        .gameplay_clips_must_be_story_specific,
    bounded_editorial_exception:
      immutableMotionCanvasContract.bounded_editorial_exception,
    target_authentic_motion_ratio: targetAuthenticMotionRatio,
    preferred_motion_scene_count: preferredMotionSceneCount,
    maximum_context_card_duration_ratio: Math.min(
      PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
      clamp(
        override.maximum_context_card_duration_ratio,
        0.1,
        PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
        PULSE_VISUAL_EDITORIAL_POLICY.maximum_context_card_duration_ratio,
      ),
    ),
    supported_platform_visual_languages: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.supported_platform_visual_languages,
    ],
    required_animated_element_families: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.required_animated_element_families,
    ],
    preferred_optional_element_families: [
      ...PULSE_VISUAL_EDITORIAL_POLICY.preferred_optional_element_families,
    ],
    edit_rules: {
      ...PULSE_VISUAL_EDITORIAL_POLICY.edit_rules,
      ...(override.edit_rules || {}),
      cards_overlay_gameplay_when_readable: true,
      gameplay_clips_must_be_story_specific: true,
      irrelevant_eye_candy_forbidden: true,
    },
    platform_theme_rules: {
      ...PULSE_VISUAL_EDITORIAL_POLICY.platform_theme_rules,
      ...(override.platform_theme_rules || {}),
      official_account_impersonation_forbidden: true,
    },
  };
}

module.exports = {
  PULSE_VISUAL_EDITORIAL_POLICY,
  buildPulseEditorialExceptionPlan,
  buildPulseMotionCanvasContract,
  resolvePulseVisualEditorialPolicy,
  validatePulseMotionCanvasTimeline,
  verifyPulseEditorialExceptionPlanAuthority,
};
