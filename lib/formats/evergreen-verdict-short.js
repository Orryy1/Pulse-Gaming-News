"use strict";

const crypto = require("node:crypto");

const FORMAT_ID = "evergreen_verdict_short";
const DURATION_LANE = "pulse_extended_short";
const FORMAT_SHAPES = Object.freeze([
  "franchise_fault_line",
  "ranked_lens",
  "versus_verdict",
  "still_worth_playing",
]);
const DEFAULT_ROTATION_POLICY = Object.freeze({
  enabled: true,
  experiment_window_days: 30,
  target_per_week: 2,
  maximum_per_week: 2,
  minimum_hours_between: 48,
  franchise_cooldown_days: 7,
  consecutive_shape_limit: 1,
  target_duration_seconds: Object.freeze({
    min: 61,
    max: 90,
    target: 82,
  }),
  target_words_per_minute: Object.freeze({
    min: 175,
    max: 210,
    target: 195,
  }),
  minimum_editorial_criteria: 2,
  minimum_claims: 3,
  minimum_source_count: 2,
  minimum_item_rationales: 3,
  minimum_exact_subject_motion_ratio: 0.65,
  minimum_clip_count: 5,
  minimum_distinct_motion_families: 2,
  continuation_minimum_evidence_window_hours: 72,
  continuation_minimum_average_percentage_viewed: 65,
  platform_targets: Object.freeze([
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]),
});
const ALLOWED_RIGHTS_BASES = new Set([
  "owned_capture",
  "licensed",
  "official_publisher_policy",
  "bounded_editorial_excerpt",
]);

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, places = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const sorted = array(values)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function https(value) {
  try {
    return new URL(clean(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function validEvergreenRightsSourceUrl(record, storyId) {
  const sourceUrl = clean(record?.source_url);
  if (https(sourceUrl)) return true;
  if (
    lower(record?.rights_basis) !== "owned_capture" ||
    clean(record?.owner) !== "Pulse Gaming"
  ) {
    return false;
  }
  try {
    const parsed = new URL(sourceUrl);
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    return (
      parsed.protocol === "pulse-owned:" &&
      parsed.hostname === "pulse-gaming" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      segments.length === 2 &&
      segments[0] === clean(storyId) &&
      segments[1] === clean(record?.asset_id)
    );
  } catch {
    return false;
  }
}

function normaliseTitle(value) {
  return lower(value)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyReferenceTitle(title) {
  const value = lower(title);
  if (
    /\b(?:worst|best|strongest|weakest|biggest problem)\b/.test(value) &&
    /\b(?:every|each)\b/.test(value)
  ) {
    return "franchise_fault_line";
  }
  if (/\b(?:ranked|ranking|worst to best|best to worst)\b/.test(value)) {
    return "ranked_lens";
  }
  if (/\b(?:vs|versus|which .+ is better)\b/.test(value)) {
    return "versus_verdict";
  }
  if (/\b(?:still good|still worth|worth playing|aged well)\b/.test(value)) {
    return "still_worth_playing";
  }
  return "other";
}

function franchiseForTitle(title) {
  const value = clean(title);
  if (/\b(?:AC|Assassin'?s Creed)\b/i.test(value)) {
    return "Assassin's Creed";
  }
  if (/\bFallout\b/i.test(value)) return "Fallout";
  if (/\bHalo\b/i.test(value)) return "Halo";
  if (/\bZelda\b/i.test(value)) return "The Legend of Zelda";
  if (/\bForza\b/i.test(value)) return "Forza";
  const prefix = value
    .replace(
      /^(?:the\s+)?(?:worst|best|strongest|weakest|is|which)\s+/i,
      "",
    )
    .split(
      /\b(?:game|games|dlc|dlcs|ranked|vs|versus|still|thing|mechanic)\b/i,
    )[0];
  return clean(prefix) || "Unknown";
}

function formatMix(videos) {
  const rows = new Map();
  for (const video of videos) {
    const shape = video.format_shape;
    const row = rows.get(shape) || {
      format_shape: shape,
      views: [],
      durations: [],
      video_count: 0,
    };
    row.video_count += 1;
    if (Number.isFinite(video.view_count)) row.views.push(video.view_count);
    if (Number.isFinite(video.duration_s)) row.durations.push(video.duration_s);
    rows.set(shape, row);
  }
  return [...rows.values()].map((row) => ({
    format_shape: row.format_shape,
    video_count: row.video_count,
    median_views: round(median(row.views), 0),
    median_duration_seconds: round(median(row.durations), 1),
  }));
}

function franchiseMix(videos) {
  const rows = new Map();
  for (const video of videos) {
    const franchise = franchiseForTitle(video.title);
    const row = rows.get(franchise) || {
      franchise,
      video_count: 0,
      views: [],
    };
    row.video_count += 1;
    if (Number.isFinite(video.view_count)) row.views.push(video.view_count);
    rows.set(franchise, row);
  }
  return [...rows.values()]
    .map((row) => ({
      franchise: row.franchise,
      video_count: row.video_count,
      median_views: round(median(row.views), 0),
    }))
    .sort(
      (a, b) =>
        b.video_count - a.video_count ||
        (b.median_views || 0) - (a.median_views || 0),
    );
}

function continuationKey(title) {
  return normaliseTitle(title).replace(
    /\b(?:part|pt)\s*[0-9]+\b/g,
    "",
  );
}

function continuationNumber(title) {
  const match = clean(title).match(/\b(?:part|pt)\.?\s*([0-9]+)\b/i);
  return match ? Number(match[1]) : null;
}

function continuationAnalysis(videos) {
  const groups = new Map();
  for (const video of videos) {
    const part = continuationNumber(video.title);
    if (!part) continue;
    const key = continuationKey(video.title);
    const group = groups.get(key) || {};
    group[part] = video;
    groups.set(key, group);
  }
  const pairs = [];
  for (const [seriesKey, group] of groups) {
    if (!group[1] || !group[2]) continue;
    const firstViews = number(group[1].view_count);
    const secondViews = number(group[2].view_count);
    pairs.push({
      series_key: seriesKey,
      part_one_id: group[1].id,
      part_two_id: group[2].id,
      part_one_views: firstViews,
      part_two_views: secondViews,
      part_two_to_part_one_view_ratio:
        firstViews && secondViews !== null
          ? round(secondViews / firstViews, 3)
          : null,
    });
  }
  return {
    pairs,
    automatic_continuations_supported: false,
    continuation_rule:
      "Require at least 72 hours of retention, engaged-view and subscriber evidence before commissioning a continuation.",
  };
}

function performance(videos) {
  const top = [...videos]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 10);
  const dates = videos
    .map((video) => Date.parse(video.published_at || ""))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const spanDays =
    dates.length > 1
      ? Math.max(1, (dates[dates.length - 1] - dates[0]) / 86_400_000)
      : 1;
  return {
    top_by_views: top,
    posts_per_day: round(videos.length / spanDays, 2),
  };
}

function buildEvergreenReferenceAudit({
  channel = {},
  videos = [],
  structure_samples: structureSamples = [],
  observations = {},
  collected_at: collectedAt = new Date().toISOString(),
} = {}) {
  const normalisedVideos = array(videos).map((video) => ({
    id: clean(video.id),
    title: clean(video.title),
    video_url: clean(video.video_url),
    published_at: clean(video.published_at) || null,
    duration_s: number(video.duration_s),
    view_count: number(video.view_count),
    format_shape: classifyReferenceTitle(video.title),
  }));
  const samples = array(structureSamples).map((sample) => {
    const duration = number(sample.duration_s);
    const words = number(sample.spoken_word_count);
    return {
      duration_s: duration,
      spoken_word_count: words,
      estimated_words_per_minute:
        number(sample.estimated_wpm) ??
        (duration && words ? round((words / duration) * 60, 0) : null),
      median_words_per_caption: number(
        sample.median_words_per_caption,
      ),
    };
  });
  const viewCounts = normalisedVideos
    .map((video) => video.view_count)
    .filter(Number.isFinite);
  const durations = normalisedVideos
    .map((video) => video.duration_s)
    .filter(Number.isFinite);

  return {
    schema_version: 1,
    generated_at: collectedAt,
    channel: {
      id: clean(channel.id),
      display_name: clean(channel.display_name),
      channel_url: clean(channel.channel_url),
      subscriber_count: number(channel.subscriber_count),
      verified_cross_platform_accounts: array(
        channel.verified_cross_platform_accounts,
      ),
    },
    summary: {
      video_count: normalisedVideos.length,
      median_views: round(median(viewCounts), 0),
      median_duration_seconds: round(median(durations), 1),
      structural_sample_count: samples.length,
      observed_median_words_per_minute: round(
        median(
          samples
            .map((sample) => sample.estimated_words_per_minute)
            .filter(Number.isFinite),
        ),
        0,
      ),
    },
    format_mix: formatMix(normalisedVideos),
    franchise_mix: franchiseMix(normalisedVideos),
    continuation_analysis: continuationAnalysis(normalisedVideos),
    performance: performance(normalisedVideos),
    patterns: {
      immediate_premise: observations.immediate_premise === true,
      real_motion_from_first_beat:
        observations.real_motion_from_first_beat === true,
      large_kinetic_emphasis_words:
        observations.large_kinetic_emphasis_words === true,
      brief_subject_identifier_cards:
        observations.brief_subject_identifier_cards === true,
      criterion_led_judgements: true,
      one_concrete_reason_per_beat: true,
      rapid_progression_without_channel_intro: true,
    },
    pulse_adaptation: {
      format_shapes: [...FORMAT_SHAPES],
      target_duration_seconds: {
        ...DEFAULT_ROTATION_POLICY.target_duration_seconds,
      },
      target_words_per_minute: {
        ...DEFAULT_ROTATION_POLICY.target_words_per_minute,
      },
      caption_rule:
        "one readable line plus selective kinetic emphasis",
      visual_rule:
        "exact-subject rights-cleared motion from frame one with short identifier cards",
      editorial_rule:
        "state a criterion and give one specific reason for every judgement",
      copy_titles: false,
      copy_scripts: false,
      copy_assets: false,
      copy_branding_or_trade_dress: false,
      use_first_person_without_verified_play_evidence: false,
    },
    evidence_limits: {
      public_metadata_only: true,
      structural_samples_store_no_transcript_text: true,
      no_competitor_media_downloaded_or_stored: true,
    },
    videos: normalisedVideos,
    structure_samples: samples,
  };
}

function rightsBlockers(record, storyId) {
  const blockers = [];
  const basis = lower(record?.rights_basis);
  if (!clean(record?.asset_id)) blockers.push("rights_asset_id_missing");
  if (!clean(record?.owner)) blockers.push("rights_owner_missing");
  if (!validEvergreenRightsSourceUrl(record, storyId)) {
    blockers.push("rights_source_url_missing");
  }
  if (!ALLOWED_RIGHTS_BASES.has(basis)) {
    blockers.push("rights_basis_not_defensible");
  }
  if (!clean(record?.usage)) blockers.push("rights_usage_missing");
  if (
    basis === "official_publisher_policy" &&
    !https(record?.policy_url)
  ) {
    blockers.push("official_media_policy_url_missing");
  }
  if (basis === "bounded_editorial_excerpt") {
    const start = number(record.start_seconds);
    const end = number(record.end_seconds);
    if (start === null || end === null || end <= start) {
      blockers.push("editorial_excerpt_time_range_missing");
    }
    if (!clean(record.editorial_purpose)) {
      blockers.push("editorial_excerpt_purpose_missing");
    }
    if (!clean(record.transformation_note)) {
      blockers.push("editorial_excerpt_transformation_missing");
    }
  }
  return blockers;
}

function historyTimestamp(item) {
  const parsed = Date.parse(
    item?.published_at || item?.scheduled_for || item?.created_at || "",
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function mergedPolicy(policy = {}) {
  return {
    ...DEFAULT_ROTATION_POLICY,
    ...policy,
    target_duration_seconds: {
      ...DEFAULT_ROTATION_POLICY.target_duration_seconds,
      ...(policy.target_duration_seconds || {}),
    },
    target_words_per_minute: {
      ...DEFAULT_ROTATION_POLICY.target_words_per_minute,
      ...(policy.target_words_per_minute || {}),
    },
  };
}

function candidateScore(candidate, policy) {
  const duration = number(
    candidate?.script_contract?.target_duration_seconds,
  );
  const media = candidate?.media_plan || {};
  const motionRatio =
    duration && duration > 0
      ? number(media.exact_subject_motion_seconds) / duration
      : 0;
  return Math.min(
    100,
    Math.round(
      20 +
        Math.min(array(candidate.source_manifest).length, 4) * 7 +
        Math.min(array(candidate.claims).length, 6) * 5 +
        Math.min(array(candidate.editorial_criteria).length, 4) * 5 +
        Math.min(number(media.distinct_motion_families) || 0, 4) * 5 +
        Math.min(motionRatio || 0, 1) * 15,
    ),
  );
}

function assessEvergreenVerdictCandidate(
  candidate = {},
  {
    history = [],
    now = new Date().toISOString(),
    policy = DEFAULT_ROTATION_POLICY,
  } = {},
) {
  const rules = mergedPolicy(policy);
  const blockers = [];
  const warnings = [];
  const id = clean(candidate.id);
  const title = clean(candidate.title);
  const franchise = clean(candidate.franchise);
  const shape = clean(candidate.format_shape);
  const criteria = array(candidate.editorial_criteria);
  const rationales = array(candidate.item_rationales);
  const claims = array(candidate.claims);
  const sources = array(candidate.source_manifest);
  const script = candidate.script_contract || {};
  const media = candidate.media_plan || {};
  const duration = number(script.target_duration_seconds);
  const wpm = number(script.target_words_per_minute);

  if (!id) blockers.push("candidate_id_missing");
  if (!title) blockers.push("candidate_title_missing");
  if (!franchise) blockers.push("candidate_franchise_missing");
  if (!FORMAT_SHAPES.includes(shape)) {
    blockers.push("format_shape_not_supported");
  }
  if (
    array(candidate.reference_titles)
      .map(normaliseTitle)
      .includes(normaliseTitle(title))
  ) {
    blockers.push("title_matches_reference_exactly");
  }
  if (criteria.length < rules.minimum_editorial_criteria) {
    blockers.push("editorial_criteria_too_thin");
  }
  if (rationales.length < rules.minimum_item_rationales) {
    blockers.push("item_rationales_too_thin");
  }
  if (
    rationales.some(
      (item) =>
        !clean(item.subject) ||
        !clean(item.judgement) ||
        !https(item.source_url),
    )
  ) {
    blockers.push("item_rationale_missing_source_or_judgement");
  }
  if (sources.length < rules.minimum_source_count) {
    blockers.push("source_manifest_too_thin");
  }
  if (sources.some((source) => !https(source.url))) {
    blockers.push("source_manifest_contains_invalid_url");
  }
  if (
    !sources.some((source) =>
      /^(?:official_publisher|official_platform|official_storefront|first_party)$/i.test(
        clean(source.tier),
      ),
    )
  ) {
    blockers.push("first_party_or_official_source_missing");
  }
  if (claims.length < rules.minimum_claims) {
    blockers.push("claim_inventory_too_thin");
  }
  if (
    claims.some(
      (claim) =>
        !clean(claim.text || claim.claim) || !https(claim.source_url),
    )
  ) {
    blockers.push("claim_inventory_contains_unsourced_claim");
  }
  if (
    duration === null ||
    duration < rules.target_duration_seconds.min ||
    duration > rules.target_duration_seconds.max
  ) {
    blockers.push("target_duration_outside_extended_short_lane");
  }
  if (
    wpm === null ||
    wpm < rules.target_words_per_minute.min ||
    wpm > rules.target_words_per_minute.max
  ) {
    blockers.push("narration_speed_outside_readability_guardrail");
  }
  if (number(script.opening_premise_words) > 15) {
    blockers.push("opening_premise_too_long");
  }
  if (number(script.closing_cta_count) > 1) {
    blockers.push("repeated_cta_not_allowed");
  }
  if (script.uses_first_person_play_claims === true) {
    const evidence = candidate.first_hand_evidence || {};
    if (
      evidence.verified !== true ||
      !clean(evidence.capture_log_id) ||
      !clean(evidence.reviewer_id)
    ) {
      blockers.push("verified_first_hand_play_evidence_missing");
    }
  }

  const rights = array(media.rights_records);
  if (rights.length < 3) blockers.push("rights_records_too_thin");
  rights.forEach((record) =>
    blockers.push(
      ...rightsBlockers(record, candidate.origin_story_id),
    ),
  );
  if (number(media.unknown_reuploads) > 0) {
    blockers.push("unknown_reuploads_not_allowed");
  }
  if (media.third_party_music === true) {
    blockers.push("third_party_music_not_allowed");
  }
  if ((number(media.clip_count) || 0) < rules.minimum_clip_count) {
    blockers.push("exact_subject_clip_count_too_low");
  }
  if (
    (number(media.distinct_motion_families) || 0) <
    rules.minimum_distinct_motion_families
  ) {
    blockers.push("distinct_motion_families_too_low");
  }
  const motionRatio =
    duration && duration > 0
      ? (number(media.exact_subject_motion_seconds) || 0) / duration
      : 0;
  if (motionRatio < rules.minimum_exact_subject_motion_ratio) {
    blockers.push("exact_subject_motion_ratio_too_low");
  }

  const nowMs = Date.parse(now);
  if (Number.isFinite(nowMs) && franchise) {
    const cutoff =
      nowMs - rules.franchise_cooldown_days * 86_400_000;
    const sameRecentFranchise = array(history).some((item) => {
      const publishedAt = historyTimestamp(item);
      return (
        publishedAt !== null &&
        publishedAt >= cutoff &&
        publishedAt <= nowMs &&
        lower(item.franchise || item.canonical_franchise) ===
          lower(franchise)
      );
    });
    if (sameRecentFranchise) {
      blockers.push("franchise_cooldown_active");
    }
  }
  const continuation = candidate.continuation || {};
  if (number(continuation.part_number) > 1) {
    if (
      (number(continuation.evidence_window_hours) || 0) <
      rules.continuation_minimum_evidence_window_hours
    ) {
      blockers.push("continuation_evidence_window_too_short");
    }
    const metrics = continuation.parent_metrics || {};
    if (
      number(metrics.average_percentage_viewed) === null ||
      number(metrics.engaged_view_rate) === null ||
      number(metrics.subscribers_per_1000_engaged_views) === null
    ) {
      blockers.push("continuation_parent_metrics_missing");
    } else if (
      number(metrics.average_percentage_viewed) <
      rules.continuation_minimum_average_percentage_viewed
    ) {
      blockers.push("continuation_parent_retention_below_guardrail");
    }
    if (
      number(metrics.rights_policy_incidents) > 0 ||
      metrics.no_cohort_deterioration !== true
    ) {
      blockers.push("continuation_parent_policy_or_cohort_risk");
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const score = candidateScore(candidate, rules);
  return {
    schema_version: 1,
    candidate_id: id,
    title,
    franchise,
    format_shape: shape,
    format_id: FORMAT_ID,
    duration_lane: DURATION_LANE,
    verdict: uniqueBlockers.length ? "BLOCKED" : "READY_FOR_PRODUCTION",
    score,
    blockers: uniqueBlockers,
    warnings: [...new Set(warnings)],
    scheduler_authoritative: false,
    dispatch_ready: false,
    production_story_patch: {
      editorial_format: FORMAT_ID,
      content_identity_id: "evergreen_guide",
      duration_lane: DURATION_LANE,
      evergreen_verdict_assessment: {
        verdict: uniqueBlockers.length
          ? "BLOCKED"
          : "READY_FOR_PRODUCTION",
        score,
        blockers: uniqueBlockers,
      },
    },
  };
}

function buildEvergreenVerdictRotation({
  candidates = [],
  history = [],
  policy = DEFAULT_ROTATION_POLICY,
  now = new Date().toISOString(),
} = {}) {
  const rules = mergedPolicy(policy);
  const assessed = array(candidates)
    .map((candidate) => ({
      ...candidate,
      assessment: assessEvergreenVerdictCandidate(candidate, {
        history,
        now,
        policy: rules,
      }),
    }))
    .sort(
      (a, b) =>
        b.assessment.score - a.assessment.score ||
        clean(a.id).localeCompare(clean(b.id)),
    );
  const selected = [];
  const deferred = [];
  const selectedShapes = new Set();
  for (const candidate of assessed) {
    const row = {
      id: clean(candidate.id),
      title: clean(candidate.title),
      franchise: clean(candidate.franchise),
      format_shape: clean(candidate.format_shape),
      score: candidate.assessment.score,
      verdict: candidate.assessment.verdict,
      blockers: [...candidate.assessment.blockers],
      production_story_patch:
        candidate.assessment.production_story_patch,
    };
    if (candidate.assessment.verdict !== "READY_FOR_PRODUCTION") {
      deferred.push(row);
      continue;
    }
    if (selected.length >= rules.maximum_per_week) {
      row.blockers.push("weekly_rotation_capacity_reached");
      deferred.push(row);
      continue;
    }
    if (selectedShapes.has(row.format_shape)) {
      row.blockers.push("consecutive_shape_diversity_guard");
      deferred.push(row);
      continue;
    }
    selected.push(row);
    selectedShapes.add(row.format_shape);
  }
  return {
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    format_id: FORMAT_ID,
    policy: rules,
    summary: {
      input_candidate_count: assessed.length,
      ready_for_production_count: selected.length,
      blocked_or_deferred_count: deferred.length,
    },
    selected,
    deferred,
    scheduler_authoritative_candidate_count: 0,
    safety: {
      planning_only: true,
      scheduler_authority_created: false,
      dispatch_enabled: false,
      no_publish_triggered: true,
    },
    experiment: {
      window_days: rules.experiment_window_days,
      continuation_requires_observed_evidence: true,
    },
  };
}

function renderEvergreenVerdictRotationMarkdown(rotation) {
  const lines = [
    "# Pulse Gaming Evergreen Verdict Rotation",
    "",
    `Generated: ${rotation.generated_at}`,
    `Selected: ${rotation.selected.length}`,
    `Deferred: ${rotation.deferred.length}`,
    "",
  ];
  for (const item of rotation.selected) {
    lines.push(`## ${item.title}`);
    lines.push("");
    lines.push(`- Franchise: ${item.franchise}`);
    lines.push(`- Shape: ${item.format_shape}`);
    lines.push(`- Score: ${item.score}`);
    lines.push("");
  }
  lines.push(
    "This plan does not create scheduler authority or publish externally.",
  );
  lines.push("");
  return lines.join("\n");
}

function stableCandidateId(value) {
  return crypto
    .createHash("sha256")
    .update(clean(value))
    .digest("hex")
    .slice(0, 16);
}

module.exports = {
  DEFAULT_ROTATION_POLICY,
  DURATION_LANE,
  FORMAT_ID,
  FORMAT_SHAPES,
  assessEvergreenVerdictCandidate,
  buildEvergreenReferenceAudit,
  buildEvergreenVerdictRotation,
  classifyReferenceTitle,
  renderEvergreenVerdictRotationMarkdown,
  stableCandidateId,
  validEvergreenRightsSourceUrl,
};
