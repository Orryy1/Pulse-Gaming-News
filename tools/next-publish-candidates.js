#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
  NORMAL_PRODUCTION_DURATION_LANE,
  RETENTION_DURATION_LANE,
  resolveDurationLane,
} = require("../lib/services/short-duration-contract");
const {
  hydrateCandidateFromCurrentProofPackage,
} = require("../lib/ops/candidate-supply");
const {
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
} = require("../lib/subtitle-timing");
const {
  directMotionBaseSourceOveruseEvidence,
  finalRenderVisualReuseEvidence,
  hyperframesReadableDwellEvidence,
} = require("../lib/goal-dry-run-publisher");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_BRIDGE_CANDIDATES_PATH = path.join(
  ROOT,
  "output",
  "goal-contract",
  "scheduler_bridge_candidates.json",
);
const DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH = path.join(
  ROOT,
  "output",
  "goal-contract",
  "direct_video_enrichment_work_order.json",
);
const DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH = path.join(
  ROOT,
  "output",
  "goal-contract",
  "studio_v4_source_family_acquisition_remaining.json",
);
const DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH = path.join(
  ROOT,
  "output",
  "goal-10",
  "goal10_readiness_report.json",
);
const DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH = path.join(
  ROOT,
  "output",
  "goal-20",
  "goal20_readiness_report.json",
);
const DEFAULT_ANALYTICS_PATH = "D:\\pulse-data\\analytics_findings.md";
const DEFAULT_LIMIT = 12;
const DEFAULT_SCRIPT_SCORE_THRESHOLD = 75;
const DEFAULT_SOURCE_AGE_POLICY_HOURS = 168;
const DEFAULT_ENABLED_SCHEDULER_GOVERNANCE_PLATFORMS = ["youtube", "instagram", "facebook"];

const PUBLIC_PLATFORM_FIELDS = [
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "x_post_id",
];

const PUBLIC_PLATFORM_FIELD_GROUPS = {
  youtube_shorts: ["youtube_post_id", "youtube_url"],
  tiktok: ["tiktok_post_id"],
  instagram_reels: ["instagram_media_id"],
  facebook_reels: ["facebook_post_id"],
  x: ["twitter_post_id", "x_post_id"],
};

const PLATFORM_ERROR_FIELD_GROUPS = {
  youtube_shorts: ["youtube_error"],
  tiktok: ["tiktok_error"],
  instagram_reels: ["instagram_error"],
  facebook_reels: ["facebook_error"],
  x: ["twitter_error", "x_error"],
};

const SCHEDULER_PLATFORM_TO_PUBLISH_PLATFORM = {
  youtube: "youtube_shorts",
  instagram: "instagram_reels",
  facebook: "facebook_reels",
  tiktok: "tiktok",
  x: "x",
  twitter: "x",
  threads: "threads",
  pinterest: "pinterest",
};

function envEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function schedulerGovernancePlatforms(env = process.env) {
  const platforms = [...DEFAULT_ENABLED_SCHEDULER_GOVERNANCE_PLATFORMS];
  if (envEnabled(env?.TIKTOK_ENABLED) && envEnabled(env?.TIKTOK_AUTO_UPLOAD_ENABLED)) {
    platforms.splice(1, 0, "tiktok");
  }
  return platforms;
}

function schedulerStudioGovernanceOptions(opts = {}) {
  const supplied = opts.studioGovernanceOptions || {};
  if (Array.isArray(supplied.platforms) && supplied.platforms.length > 0) return supplied;
  return {
    ...supplied,
    platforms: schedulerGovernancePlatforms(opts.env || process.env),
  };
}

const BRIDGE_REPLACED_MEDIA_FIELDS = [
  "downloaded_images",
  "game_images",
  "downloaded_videos",
  "local_motion_clips",
  "motion_clips",
  "sfx_assets",
  "sfx_asset_inventory",
  "sound_effects",
  "music_assets",
  "image_path",
  "thumbnail_candidate_path",
  "hf_thumbnail_path",
  "music_path",
  "sfx_path",
];

const COMPANY_TERMS = [
  "Amazon",
  "Apple",
  "Arc System Works",
  "Bandai",
  "Bethesda",
  "BioWare",
  "Blizzard",
  "Capcom",
  "CD Projekt",
  "Dexerto",
  "Discord",
  "EA",
  "eBay",
  "Epic",
  "Facebook",
  "GameStop",
  "Google",
  "Konami",
  "Meta",
  "Microsoft",
  "Nintendo",
  "PlayStation",
  "Rockstar",
  "Sega",
  "Sony",
  "Square Enix",
  "Steam",
  "Take-Two",
  "Tencent",
  "Ubisoft",
  "Valve",
  "Warner",
  "Xbox",
];

const CORPORATE_DRAMA_TERMS = [
  "accused",
  "bid",
  "blocked",
  "board",
  "boss",
  "ceo",
  "collapsed",
  "court",
  "deal",
  "destroyed",
  "executive",
  "lawsuit",
  "president",
  "pricing",
  "pressure",
  "rejected",
  "shut down",
  "strong-arm",
  "takeover",
  "walked away",
];

const CONCRETE_OUTCOME_TERMS = [
  "approved",
  "cancelled",
  "confirmed",
  "delayed",
  "drops",
  "launches",
  "launched",
  "price",
  "rejected",
  "revealed",
  "shut down",
  "update",
  "walked away",
];

const SPECULATIVE_TERMS = [
  "could",
  "may",
  "maybe",
  "might",
  "possibly",
  "rumour",
  "rumor",
  "speculation",
  "would",
];

function textForStory(story = {}) {
  return [
    story.title,
    story.suggested_title,
    story.hook,
    story.full_script,
    story.tts_script,
    story.body,
    story.loop,
    story.publish_error,
  ]
    .filter(Boolean)
    .join(" ");
}

function lc(value) {
  return String(value || "").toLowerCase();
}

function includesAny(lowerText, terms) {
  return terms.some((term) => lowerText.includes(lc(term)));
}

function matchedTerms(lowerText, terms) {
  return terms.filter((term) => lowerText.includes(lc(term)));
}

function realPlatformId(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^DUPE_/i.test(text)) return false;
  if (/^(blocked|disabled|skipped|failed|none|null|undefined)$/i.test(text)) {
    return false;
  }
  return true;
}

function existingPublicPlatformFields(story = {}) {
  return PUBLIC_PLATFORM_FIELDS.filter((field) => realPlatformId(story[field]));
}

function publishedPlatformNames(story = {}) {
  return Object.entries(PUBLIC_PLATFORM_FIELD_GROUPS)
    .filter(([, fields]) => fields.some((field) => realPlatformId(story[field])))
    .map(([platform]) => platform);
}

function errorTextIsDuplicateBlocked(value) {
  const text = String(value || "").trim();
  return /\b(?:duplicate_blocked|dupe-blocked)\b/i.test(text);
}

function terminalDuplicateBlockedPlatformNames(story = {}) {
  return Object.entries(PLATFORM_ERROR_FIELD_GROUPS)
    .filter(([, fields]) => fields.some((field) => errorTextIsDuplicateBlocked(story[field])))
    .map(([platform]) => platform);
}

function enabledPublishPlatformNames(options = {}) {
  return schedulerGovernancePlatforms(options.env || process.env)
    .map((platform) => SCHEDULER_PLATFORM_TO_PUBLISH_PLATFORM[platform] || platform)
    .filter(Boolean);
}

function missingEnabledPublishPlatformNames(story = {}, options = {}) {
  const published = new Set(publishedPlatformNames(story));
  const terminalDuplicate = new Set(terminalDuplicateBlockedPlatformNames(story));
  return enabledPublishPlatformNames(options).filter((platform) =>
    !published.has(platform) && !terminalDuplicate.has(platform),
  );
}

function hasCompletedEnabledPublishPlatforms(story = {}, options = {}) {
  const publicFields = existingPublicPlatformFields(story);
  const terminalDuplicatePlatforms = terminalDuplicateBlockedPlatformNames(story);
  if (!publicFields.length && !terminalDuplicatePlatforms.length) return false;
  return missingEnabledPublishPlatformNames(story, options).length === 0;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function storyDurationSeconds(story = {}) {
  return (
    numberOrNull(story.duration_seconds) ??
    numberOrNull(story.audio_duration) ??
    numberOrNull(story.video_duration_seconds) ??
    numberOrNull(story.runtime_seconds) ??
    numberOrNull(story.final_duration_seconds)
  );
}

function normaliseComparablePath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^file:\/+/i, "")
    .toLowerCase();
}

function renderedDurationFromManifest(manifest = {}) {
  return (
    numberOrNull(manifest.rendered_duration_s) ??
    numberOrNull(manifest.duration_s) ??
    numberOrNull(manifest.video_duration_s) ??
    numberOrNull(manifest.duration_seconds)
  );
}

function selectedSfxAssetsForFreshness(sfxManifest = {}) {
  const sourcePlan = objectValue(
    sfxManifest.source_plan || sfxManifest.sourcePlan || sfxManifest.sourcing_plan,
    {},
  );
  const selected = [
    ...asArray(sourcePlan.selected_assets || sourcePlan.selectedAssets),
    ...asArray(sfxManifest.selected_assets || sfxManifest.selectedAssets),
  ];
  const seen = new Set();
  return selected
    .map((asset) => ({
      role: cleanText(asset.role || asset.sfx_role || asset.family || asset.category || "unknown")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
      asset_id: cleanText(asset.asset_id || asset.id),
    }))
    .filter((asset) => asset.asset_id)
    .filter((asset) => {
      const key = `${asset.role}:${asset.asset_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.role}:${a.asset_id}`.localeCompare(`${b.role}:${b.asset_id}`));
}

function selectedSfxAssetSignature(sfxManifest = {}) {
  const assets = selectedSfxAssetsForFreshness(sfxManifest);
  return assets.length ? assets.map((asset) => `${asset.role}:${asset.asset_id}`).join("|") : "";
}

function renderOutputPathFromManifest(manifest = {}) {
  return (
    manifest.output_path ||
    manifest.exported_path ||
    manifest.final_render_path ||
    manifest.output?.path ||
    manifest.output?.file ||
    ""
  );
}

function isLongformLane(story = {}) {
  const fields = [
    story.format,
    story.format_type,
    story.suggested_format,
    story.render_lane,
    story.content_pillar,
    story.classification,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(longform|weekly|monthly|roundup|briefing|release radar|documentary|trailer breakdown)\b/.test(fields);
}

function durationVerdict(story = {}) {
  const duration = storyDurationSeconds(story);
  if (duration == null) {
    return {
      status: "review",
      score: -8,
      reason: "duration_unknown",
      duration_seconds: null,
    };
  }
  const durationLane = resolveDurationLane({ story });
  if (durationLane === RETENTION_DURATION_LANE || story.allow_retention_short_video === true) {
    const hardMin = numberOrNull(story.min_video_duration_seconds) ?? 15;
    const targetMin = numberOrNull(story.target_video_duration_seconds_min) ?? 22;
    const targetMax = numberOrNull(story.target_video_duration_seconds_max) ?? 60;
    const max = numberOrNull(story.max_video_duration_seconds) ?? 75;
    if (duration < hardMin) {
      return {
        status: "exclude",
        score: -28,
        reason: `retention_short_too_short_${duration.toFixed(2)}s`,
        duration_seconds: duration,
      };
    }
    if (duration < targetMin) {
      return {
        status: "review",
        score: 2,
        reason: "retention_short_below_target_review",
        duration_seconds: duration,
      };
    }
    if (duration <= targetMax) {
      const centrePenalty = Math.abs(duration - Math.min(30, targetMax)) * 0.2;
      return {
        status: "publish_ready",
        score: Math.round(24 - centrePenalty),
        reason: "retention_short_target_window",
        duration_seconds: duration,
      };
    }
    if (duration <= max) {
      return {
        status: "review",
        score: 4,
        reason: "retention_short_extended_review",
        duration_seconds: duration,
      };
    }
    return {
      status: "exclude",
      score: -30,
      reason: `retention_short_too_long_${duration.toFixed(2)}s`,
      duration_seconds: duration,
    };
  }
  if (durationLane === NORMAL_PRODUCTION_DURATION_LANE) {
    const hardMin =
      numberOrNull(story.min_video_duration_seconds) ??
      numberOrNull(story.target_video_duration_seconds_min) ??
      DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS;
    const targetMax =
      numberOrNull(story.target_video_duration_seconds_max) ??
      DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS;
    const max =
      numberOrNull(story.max_video_duration_seconds) ??
      DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS;
    if (duration < 15) {
      return {
        status: "exclude",
        score: -28,
        reason: `normal_production_too_short_${duration.toFixed(2)}s`,
        duration_seconds: duration,
      };
    }
    if (duration < hardMin) {
      return {
        status: "review",
        score: -4,
        reason: "normal_production_below_floor_review",
        duration_seconds: duration,
      };
    }
    if (duration <= targetMax) {
      const centrePenalty = Math.abs(duration - 45) * 0.25;
      return {
        status: "publish_ready",
        score: Math.round(25 - centrePenalty),
        reason: "normal_production_duration_window",
        duration_seconds: duration,
      };
    }
    if (duration <= max + 15) {
      return {
        status: "review",
        score: 2,
        reason: "normal_production_extended_review",
        duration_seconds: duration,
      };
    }
    return {
      status: "exclude",
      score: -30,
      reason: `normal_production_too_long_${duration.toFixed(2)}s`,
      duration_seconds: duration,
    };
  }
  if (duration >= 61 && duration <= 75) {
    const centrePenalty = Math.abs(duration - 68) * 0.4;
    return {
      status: "publish_ready",
      score: Math.round(28 - centrePenalty),
      reason: "ideal_61_75s",
      duration_seconds: duration,
    };
  }
  if (duration >= 58 && duration < 61) {
    return {
      status: "review",
      score: 6,
      reason: "near_minimum_duration_review",
      duration_seconds: duration,
    };
  }
  if (duration > 75 && duration <= 90 && !isLongformLane(story)) {
    return {
      status: "review",
      score: 4,
      reason: "extended_short_review",
      duration_seconds: duration,
    };
  }
  if (duration > 75 && duration <= 95 && isLongformLane(story)) {
    return {
      status: "review",
      score: 2,
      reason: "longform_or_briefing_lane",
      duration_seconds: duration,
    };
  }
  if (duration > 75) {
    return {
      status: "exclude",
      score: -30,
      reason: `duration_too_long_${duration.toFixed(2)}s`,
      duration_seconds: duration,
    };
  }
  return {
    status: "exclude",
    score: -25,
    reason: `duration_too_short_${duration.toFixed(2)}s`,
    duration_seconds: duration,
  };
}

function parseFailureList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // fall through
    }
    return [trimmed];
  }
  return [];
}

function qaFailures(story = {}) {
  const failures = [
    ...parseFailureList(story.qa_failures),
    ...parseFailureList(story.video_qa_failures),
    ...parseFailureList(story.content_qa_failures),
  ];
  if (story.qa_failed === true) failures.push("qa_failed=true");
  if (String(story.publish_status || "").toLowerCase() === "failed") {
    failures.push("publish_status=failed");
  }
  if (story.script_generation_status === "review_required") {
    failures.push(`script_generation_review:${story.script_review_reason || "validation_failed"}`);
  }
  const publishError = String(story.publish_error || "");
  if (/(content_qa|video_qa|audio_duration_too_long|script validation failed|duration_too_long)/i.test(publishError)) {
    failures.push(publishError);
  }
  return [...new Set(failures.filter(Boolean))];
}

function pendingAudioReason(story = {}) {
  const status = String(story.publish_status || "").toLowerCase();
  const error = String(story.publish_error || "");
  if (status !== "pending_audio" && !/^audio_generation_pending:/i.test(error)) {
    return null;
  }
  if (
    story.qa_failed !== true &&
    story.audio_path &&
    story.exported_path
  ) {
    return null;
  }
  const gpuSaturated =
    /gpu_saturated/i.test(error) ||
    parseFailureList(story.qa_warnings).some((warning) =>
      /audio_generation_pending:gpu_saturated/i.test(warning),
    );
  if (gpuSaturated) return "pending_audio:gpu_saturated";
  const reason = error.match(/^audio_generation_pending:\s*([a-z0-9_-]+)/i);
  if (reason) return `pending_audio:${reason[1].toLowerCase()}`;
  return "pending_audio";
}

function upstreamSkippedStoryMap(report = {}) {
  const rows = [
    ...asArray(report.stories),
    ...asArray(report.rows),
  ];
  const map = new Map();
  for (const row of rows) {
    const storyId = normaliseStoryId(row?.story_id || row?.id);
    if (!storyId) continue;
    const status = cleanText(row.status || row.verdict || row.direct_uniqueness_status).toLowerCase();
    if (status !== "skipped") continue;
    map.set(storyId, {
      status: cleanText(row.skipped_status || row.status || "skipped") || "skipped",
      reason: cleanText(row.skipped_reason || row.reason || "upstream_skipped"),
    });
  }
  return map;
}

function upstreamSkippedReason(story = {}, report = {}) {
  const storyId = normaliseStoryId(story.id || story.story_id);
  if (!storyId) return null;
  const row = upstreamSkippedStoryMap(report).get(storyId);
  if (!row) return null;
  return `upstream_skipped:${row.status}:${row.reason}`;
}

function parseStoryPublishAgeMs(story = {}, now = Date.now()) {
  const raw =
    story.approved_at ||
    story.produced_at ||
    story.created_at ||
    story.timestamp ||
    story.updated_at;
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return now - parsed;
}

function staleBacklogMaxAgeMs(env = process.env) {
  const days = Number(env.PUBLISH_STALE_BACKLOG_MAX_DAYS);
  const safeDays = Number.isFinite(days) && days >= 1 ? days : 7;
  return safeDays * 24 * 60 * 60 * 1000;
}

function storyIsStaleUnpublishedBacklog(story = {}, env = process.env, now = Date.now()) {
  if (env.ALLOW_STALE_BACKLOG_PUBLISH === "true") return false;
  const ageMs = parseStoryPublishAgeMs(story, now);
  if (ageMs === null) return false;
  return ageMs > staleBacklogMaxAgeMs(env);
}

function properNameHits(text) {
  const hits = new Set();
  const companyLower = lc(text);
  for (const company of COMPANY_TERMS) {
    if (companyLower.includes(lc(company))) hits.add(company);
  }
  const personLike = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z'\u2019-]+){1,2}\b/g) || [];
  for (const hit of personLike) {
    if (!/^(Pulse Gaming|Source Breakdown|Confirmed Drop|Rumour Watch)$/.test(hit)) {
      hits.add(hit);
    }
  }
  return [...hits];
}

function scoreAnalyticsFit(story = {}, analyticsText = "") {
  const storyText = textForStory(story);
  const lower = lc(storyText);
  const analyticsLower = lc(analyticsText);
  const recommendationCorporate = analyticsLower.includes("corporate drama");
  const recommendationNamed = analyticsLower.includes("named");
  const recommendationConcrete = analyticsLower.includes("concrete");
  const names = properNameHits(storyText);
  const drama = matchedTerms(lower, CORPORATE_DRAMA_TERMS);
  const outcomes = matchedTerms(lower, CONCRETE_OUTCOME_TERMS);
  const speculative = matchedTerms(lower, SPECULATIVE_TERMS);

  let score = 0;
  const reasons = [];
  const penalties = [];

  if (names.length > 0) {
    score += recommendationNamed ? 16 : 10;
    reasons.push("named_people_or_companies");
  }
  if (drama.length > 0) {
    score += recommendationCorporate ? 18 : 10;
    reasons.push("corporate_drama");
  }
  if (outcomes.length > 0) {
    score += recommendationConcrete ? 16 : 10;
    reasons.push("concrete_outcome");
  }
  if (includesAny(lower, ["price", "$", "\u00a3", "date", "launch", "bundle", "release"])) {
    score += 7;
    reasons.push("specific_detail");
  }
  if (speculative.length > 0) {
    const penalty = Math.min(18, speculative.length * 6);
    score -= penalty;
    penalties.push("speculative_language");
  }
  if (/abstract industry|industry commentary|things are changing|future of gaming/i.test(storyText)) {
    score -= 8;
    penalties.push("abstract_industry_commentary");
  }

  return {
    score,
    reasons: [...new Set(reasons)],
    penalties: [...new Set(penalties)],
    matched_names: names.slice(0, 6),
    matched_drama_terms: [...new Set(drama)].slice(0, 6),
    matched_outcome_terms: [...new Set(outcomes)].slice(0, 6),
  };
}

function platformReadiness(story = {}) {
  const reasons = [];
  let score = 0;
  if (story.exported_path) {
    score += 16;
    reasons.push("mp4_present");
  } else {
    reasons.push("mp4_missing");
    score -= 20;
  }
  if (story.audio_path || story.voice_report_path || story.final_voice_report_path) {
    score += 4;
    reasons.push("audio_evidence_present");
  }
  if (story.image_path || story.thumbnail_path || story.cover_path || story.suggested_thumbnail_text) {
    score += 4;
    reasons.push("thumbnail_or_cover_present");
  }
  if (story.pinned_comment || story.caption || story.description) {
    score += 2;
    reasons.push("caption_or_description_present");
  }
  return { score, reasons };
}

function tiktokInboxReadiness(story = {}) {
  const duration = storyDurationSeconds(story);
  const reasons = [];
  let score = 0;
  if (duration != null && duration >= 60) {
    score += 8;
    reasons.push("duration_60_plus");
  } else {
    score -= 8;
    reasons.push("duration_under_60_or_unknown");
  }
  if (story.exported_path) {
    score += 4;
    reasons.push("mp4_present");
  }
  if (story.tiktok_inbox_ready === true || story.tiktok_dispatch_ready === true) {
    score += 8;
    reasons.push("explicit_tiktok_dispatch_ready");
  }
  if (story.do_not_reuse_for_tiktok_dispatch === true) {
    score -= 20;
    reasons.push("voice_or_render_marked_do_not_reuse");
  }
  return { score, reasons };
}

function approvalScore(story = {}) {
  if (story.auto_approved === true || story.auto_approved === 1) {
    return { score: 24, reason: "auto_approved" };
  }
  if (story.approved === true || story.approved === 1) {
    return { score: 16, reason: "approved" };
  }
  return { score: -40, reason: "not_approved" };
}

function exclusionReason(story = {}, options = {}) {
  const publicFields = existingPublicPlatformFields(story);
  const terminalDuplicatePlatforms = terminalDuplicateBlockedPlatformNames(story);
  if (hasCompletedEnabledPublishPlatforms(story, options)) {
    if (terminalDuplicatePlatforms.length) {
      return `enabled_platforms_already_public_or_terminal_duplicate:${[
        ...publicFields,
        ...terminalDuplicatePlatforms.map((platform) => `${platform}:duplicate_blocked`),
      ].join(",")}`;
    }
    return `already_has_public_platform_id:${publicFields.join(",")}`;
  }
  const upstreamSkip = upstreamSkippedReason(story, options.upstreamAntiSpamReport || {});
  if (upstreamSkip) return upstreamSkip;
  if (story.stale_scheduler_bridge_candidate === true) {
    return "stale_scheduler_bridge_candidate:not_in_current_bridge";
  }
  const failures = qaFailures(story);
  if (failures.length > 0) return `qa_failure:${failures[0]}`;
  const approval = approvalScore(story);
  if (approval.score < 0) return approval.reason;
  const pendingAudio = pendingAudioReason(story);
  if (pendingAudio) return pendingAudio;
  if (!story.exported_path) return "missing_mp4";
  if (
    storyIsStaleUnpublishedBacklog(
      story,
      options.env || process.env,
      options.nowMs || Date.now(),
    )
  ) {
    return "stale_unpublished_backlog";
  }
  const duration = durationVerdict(story);
  if (duration.status === "exclude") return duration.reason;
  return null;
}

function scoreCandidate(story = {}, options = {}) {
  const analytics = scoreAnalyticsFit(story, options.analyticsText || "");
  const duration = durationVerdict(story);
  const approval = approvalScore(story);
  const platform = platformReadiness(story);
  const tiktok = tiktokInboxReadiness(story);
  const alreadyPublishedPlatforms = publishedPlatformNames(story);
  const terminalDuplicatePlatforms = terminalDuplicateBlockedPlatformNames(story);
  const missingEnabledPlatforms = missingEnabledPublishPlatformNames(story, options);
  const baseScore = Number(story.breaking_score || story.score || 0) * 0.12;
  const score = Math.round(
    approval.score +
      duration.score +
      analytics.score +
      platform.score +
      tiktok.score +
      baseScore,
  );
  const status = duration.status === "publish_ready" ? "publish_ready" : "review";
  const reasons = [
    approval.reason,
    duration.reason,
    story.scheduler_bridge_source ? "scheduler_bridge_candidate" : null,
    alreadyPublishedPlatforms.length > 0 && missingEnabledPlatforms.length > 0
      ? "partial_platform_completion"
      : null,
    ...analytics.reasons,
    ...platform.reasons,
    ...tiktok.reasons,
  ].filter(Boolean);
  const penalties = [...analytics.penalties];

  return {
    id: story.id,
    title: String(story.title || "").slice(0, 180),
    score,
    status,
    duration_seconds: duration.duration_seconds,
    approval: approval.reason,
    analytics_fit: analytics,
    platform_readiness: platform,
    tiktok_inbox_readiness: tiktok,
    reasons: [...new Set(reasons)],
    penalties: [...new Set(penalties)],
    source: {
      breaking_score: Number(story.breaking_score || 0),
      score: Number(story.score || 0),
      source_type: story.source_type || null,
      content_pillar: story.content_pillar || null,
      exported_path: story.exported_path || null,
      already_published_platforms: alreadyPublishedPlatforms,
      terminal_duplicate_blocked_platforms: terminalDuplicatePlatforms,
      missing_enabled_platforms: missingEnabledPlatforms,
      public_platform_fields: existingPublicPlatformFields(story),
    },
  };
}

function bridgeCandidateCount(stories = []) {
  return (Array.isArray(stories) ? stories : []).filter(
    (story) => story && story.scheduler_bridge_source,
  ).length;
}

function bridgeCandidateId(candidate = {}) {
  return String(candidate?.id || candidate?.story_id || "").trim();
}

function mergeBridgeCandidates(stories = [], bridgeCandidates = []) {
  const rows = Array.isArray(stories) ? stories.filter(Boolean) : [];
  const bridges = Array.isArray(bridgeCandidates) ? bridgeCandidates.filter(Boolean) : [];
  if (!bridges.length) return [...rows];
  const bridgeIds = new Set(
    bridges.map(bridgeCandidateId).filter(Boolean),
  );

  const byId = new Map(
    rows.map((story, index) => [String(story.id || `row-${index}`), { story: { ...story }, index }]),
  );
  const merged = rows.map((story) => ({ ...story }));

  for (const bridge of bridges) {
    const id = String(bridge.id || "").trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      merged.push({
        ...bridge,
        scheduler_bridge_source: bridge.scheduler_bridge_source || "scheduler_bridge_candidates",
      });
      continue;
    }
    const live = existing.story;
    const overlay = {
      ...live,
      ...bridge,
      scheduler_bridge_source: bridge.scheduler_bridge_source || "scheduler_bridge_candidates",
      scheduler_bridge_overlay_live_row: true,
    };
    for (const field of BRIDGE_REPLACED_MEDIA_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(bridge, field)) continue;
      overlay[field] = Array.isArray(live[field]) ? [] : null;
    }
    for (const field of PUBLIC_PLATFORM_FIELDS) {
      if (realPlatformId(live[field]) && !realPlatformId(bridge[field])) {
        overlay[field] = live[field];
      }
    }
    merged[existing.index] = overlay;
  }

  return merged.map((story) => {
    const id = String(story.id || story.story_id || "").trim();
    if (!id || !story.scheduler_bridge_source || bridgeIds.has(id) || story.scheduler_bridge_overlay_live_row) {
      return story;
    }
    return {
      ...story,
      stale_scheduler_bridge_candidate: true,
      stale_scheduler_bridge_source: story.scheduler_bridge_source,
      scheduler_bridge_source: null,
    };
  });
}

function normaliseBridgeManifest(manifest = {}) {
  const requested = manifest.requested === true || Boolean(manifest.path);
  const disabled = manifest.disabled === true || requested === false;
  const exists = manifest.exists === true;
  const allowLiveFallback =
    manifest.allowLiveFallback === true ||
    manifest.allow_live_fallback === true;
  const candidateCount = Number.isFinite(Number(manifest.candidate_count))
    ? Number(manifest.candidate_count)
    : Array.isArray(manifest.candidates)
      ? manifest.candidates.length
      : null;
  return {
    requested,
    disabled,
    exists,
    path: manifest.path || null,
    status:
      manifest.status ||
      (disabled ? "disabled" : exists ? "loaded" : requested ? "missing" : "disabled"),
    candidate_count: candidateCount,
    allowLiveFallback,
    authoritative: manifest.authoritative === true,
    mode: manifest.mode || null,
    source: manifest.source || null,
    live_fallback_used: manifest.live_fallback_used === true,
    live_db_rows_seen: Number.isFinite(Number(manifest.live_db_rows_seen))
      ? Number(manifest.live_db_rows_seen)
      : 0,
    live_db_rows_considered: Number.isFinite(Number(manifest.live_db_rows_considered))
      ? Number(manifest.live_db_rows_considered)
      : 0,
    live_db_rows_ignored: Number.isFinite(Number(manifest.live_db_rows_ignored))
      ? Number(manifest.live_db_rows_ignored)
      : 0,
  };
}

function bridgeManifestIsAuthoritative(manifest = {}) {
  const normalised = normaliseBridgeManifest(manifest);
  return (
    normalised.requested === true &&
    normalised.disabled !== true &&
    normalised.exists === true &&
    normalised.allowLiveFallback !== true
  );
}

function selectCandidateSourceStories({
  liveStories = [],
  bridgeCandidates = [],
  bridgeManifest = {},
} = {}) {
  const liveRows = Array.isArray(liveStories) ? liveStories.filter(Boolean) : [];
  const bridges = Array.isArray(bridgeCandidates) ? bridgeCandidates.filter(Boolean) : [];
  const normalisedManifest = normaliseBridgeManifest({
    ...bridgeManifest,
    candidate_count:
      Number.isFinite(Number(bridgeManifest?.candidate_count))
        ? Number(bridgeManifest.candidate_count)
        : bridges.length,
  });
  const authoritative = bridgeManifestIsAuthoritative(normalisedManifest);

  if (authoritative && bridges.length) {
    const bridgeIds = new Set(bridges.map(bridgeCandidateId).filter(Boolean));
    const liveRowsForBridgeIds = liveRows.filter((story) =>
      bridgeIds.has(String(story?.id || "").trim()),
    );
    const stories = mergeBridgeCandidates(liveRowsForBridgeIds, bridges);
    const bridgeHasEnabledRunway = stories.some((story) => {
      const id = String(story?.id || story?.story_id || "").trim();
      if (!id || !bridgeIds.has(id)) return false;
      return missingEnabledPublishPlatformNames(story).length > 0;
    });
    if (bridgeHasEnabledRunway) {
      return {
        stories,
        bridge_manifest: {
          ...normalisedManifest,
          authoritative: true,
          mode: "authoritative_bridge_only",
          source: "scheduler_bridge_candidates",
          live_fallback_used: false,
          live_db_rows_seen: liveRows.length,
          live_db_rows_considered: liveRowsForBridgeIds.length,
          live_db_rows_ignored: Math.max(0, liveRows.length - liveRowsForBridgeIds.length),
        },
      };
    }
  }

  const stories = mergeBridgeCandidates(liveRows, bridges);
  const fallbackUsed =
    normalisedManifest.requested === true &&
    normalisedManifest.disabled !== true &&
    (normalisedManifest.exists !== true ||
      normalisedManifest.allowLiveFallback === true ||
      authoritative === true);
  return {
    stories,
    bridge_manifest: {
      ...normalisedManifest,
      authoritative: false,
      mode: bridges.length ? "bridge_overlay_with_live_rows" : "live_db",
      source: bridges.length ? "scheduler_bridge_candidates" : "live_db",
      live_fallback_used: fallbackUsed,
      live_db_rows_seen: liveRows.length,
      live_db_rows_considered: liveRows.length,
      live_db_rows_ignored: 0,
    },
  };
}

function summariseQaResult(result = {}) {
  if (!result || typeof result !== "object") {
    return {
      result: "unknown",
      failures: ["qa_result_missing"],
      warnings: [],
    };
  }
  const summary = {
    result: result.result || result.status || "unknown",
    failures: Array.isArray(result.failures) ? result.failures : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    reason: result.reason || null,
  };
  if (result.evidence && typeof result.evidence === "object" && !Array.isArray(result.evidence)) {
    summary.evidence = result.evidence;
  }
  return summary;
}

function combinePreflightQa({
  sourceAge,
  content,
  video,
  platform,
  governance,
  publicCopy,
  publicMetadata,
  incidentGuard,
  voiceQuality,
  audioSegment,
  timestampAlignment,
  visualEntityMatch,
  bridgeArtifactFreshness,
  bridgeMotionGovernance,
  aggregateBenchmark,
  scriptScorecard,
  mediaHouse,
} = {}) {
  const checks = {
    ...(sourceAge ? { source_age: summariseQaResult(sourceAge) } : {}),
    content: summariseQaResult(content),
    video: summariseQaResult(video),
    platform: summariseQaResult(platform),
    governance: summariseQaResult(governance),
  };
  if (publicCopy) checks.public_copy = summariseQaResult(publicCopy);
  if (publicMetadata) checks.public_metadata = summariseQaResult(publicMetadata);
  if (incidentGuard) checks.incident_guard = summariseQaResult(incidentGuard);
  if (voiceQuality) checks.voice_quality = summariseQaResult(voiceQuality);
  if (audioSegment) checks.audio_segment_loudness = summariseQaResult(audioSegment);
  if (timestampAlignment) checks.timestamp_alignment = summariseQaResult(timestampAlignment);
  if (visualEntityMatch) checks.visual_entity_match = summariseQaResult(visualEntityMatch);
  if (bridgeArtifactFreshness) checks.bridge_artifact_freshness = summariseQaResult(bridgeArtifactFreshness);
  if (bridgeMotionGovernance) checks.bridge_motion_governance = summariseQaResult(bridgeMotionGovernance);
  if (aggregateBenchmark) checks.aggregate_benchmark = summariseQaResult(aggregateBenchmark);
  if (scriptScorecard) checks.script_scorecard = summariseQaResult(scriptScorecard);
  if (mediaHouse) checks.media_house = summariseQaResult(mediaHouse);
  const blockers = [];
  const warnings = [];

  for (const [name, check] of Object.entries(checks)) {
    if (check.result === "fail") {
      const failures = check.failures.length ? check.failures : [check.reason || "failed"];
      blockers.push(...failures.map((failure) => `${name}:${failure}`));
    } else if (check.result === "warn") {
      warnings.push(`${name}:${check.warnings[0] || "warning"}`);
    } else if (check.result === "skip") {
      warnings.push(`${name}:skipped:${check.reason || "unknown"}`);
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warn" : "pass",
    blockers,
    warnings,
    checks,
  };
}

function addStoryIdToSet(target, value) {
  const storyId = normaliseStoryId(value);
  if (storyId) target.add(storyId);
}

function bridgeMotionEvidenceSource(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    directVideoEnrichmentWorkOrder:
      value.directVideoEnrichmentWorkOrder ||
      value.direct_video_enrichment_work_order ||
      value.directVideoWorkOrder ||
      value.direct_video_work_order ||
      (Array.isArray(value.jobs) ? value : null),
    sourceFamilyAcquisitionReport:
      value.sourceFamilyAcquisitionReport ||
      value.source_family_acquisition_report ||
      value.sourceFamilyReport ||
      value.source_family_report ||
      (Array.isArray(value.rows) ? value : null),
  };
}

const OWNED_EXPLAINER_SOURCE_FAMILY_EXCEPTION_BLOCKERS = new Set([
  "corporate_transaction_requires_owned_explainer_visual_plan",
  "broad_platform_story_requires_specific_visual_plan",
  "legal_story_requires_source_card_or_human_visual_plan",
]);

function rowAllowsOwnedExplainerMotionException(row = {}) {
  const tokens = [
    row.visual_plan_type,
    row.plan_type,
    row.recommended_visual_plan_type,
    ...(Array.isArray(row.source_search_blockers) ? row.source_search_blockers : []),
    ...(Array.isArray(row.blockers) ? row.blockers : []),
  ]
    .map(cleanText)
    .filter(Boolean);
  return tokens.some((token) => {
    const normalised = token.toLowerCase();
    return (
      OWNED_EXPLAINER_SOURCE_FAMILY_EXCEPTION_BLOCKERS.has(normalised) ||
      /owned_explainer_plan|owned_explainer_visual_plan|source_card_or_human_visual_plan/.test(
        normalised,
      )
    );
  });
}

function explicitFalse(value) {
  if (value === false) return true;
  if (typeof value !== "string") return false;
  const normalised = value.trim().toLowerCase();
  return normalised === "false" || normalised === "0" || normalised === "no" || normalised === "off";
}

function bridgeMotionWorkOrderJobBlocksCurrentDryRun(job = {}) {
  return !(
    explicitFalse(job.blocking_current_dry_run) ||
    explicitFalse(job.blocks_current_dry_run) ||
    explicitFalse(job.blockingCurrentDryRun)
  );
}

function normaliseBridgeMotionGovernanceEvidence(value = {}) {
  const directVideoEnrichmentStoryIds = new Set();
  const blockedMotionPackStoryIds = new Set();
  const canonicalEntityRepairStoryIds = new Set();
  const ownedExplainerExceptionStoryIds = new Set();

  for (const storyId of [
    ...asArray(value.direct_video_enrichment_story_ids),
    ...asArray(value.directVideoEnrichmentStoryIds),
  ]) {
    addStoryIdToSet(directVideoEnrichmentStoryIds, storyId);
  }
  for (const storyId of [
    ...asArray(value.blocked_motion_pack_story_ids),
    ...asArray(value.blockedMotionPackStoryIds),
  ]) {
    addStoryIdToSet(blockedMotionPackStoryIds, storyId);
  }

  const { directVideoEnrichmentWorkOrder, sourceFamilyAcquisitionReport } =
    bridgeMotionEvidenceSource(value);

  for (const job of asArray(directVideoEnrichmentWorkOrder?.jobs)) {
    const blockerText = [
      job.blocker_type,
      job.repair_lane,
      job.exact_missing_input,
      ...(Array.isArray(job.blockers) ? job.blockers : []),
    ]
      .map(cleanText)
      .join(" ")
      .toLowerCase();
    const requestsDirectVideoEnrichment =
      blockerText.includes("direct_video") ||
      blockerText.includes("direct-video") ||
      blockerText.includes("direct video");
    if (bridgeMotionWorkOrderJobBlocksCurrentDryRun(job) && requestsDirectVideoEnrichment) {
      addStoryIdToSet(directVideoEnrichmentStoryIds, job.story_id || job.id);
    }
  }

  for (const row of asArray(sourceFamilyAcquisitionReport?.rows)) {
    const storyId = row.story_id || row.id;
    const blockers = [
      row.readiness_status,
      ...(Array.isArray(row.blockers) ? row.blockers : []),
    ]
      .map(cleanText)
      .join(" ")
      .toLowerCase();
    if (
      row.blocking_current_motion_readiness === true ||
      blockers.includes("v4_motion_blocked") ||
      blockers.includes("actual_motion_clip_minimum_not_met") ||
      blockers.includes("distinct_motion_families_minimum_not_met")
    ) {
      addStoryIdToSet(blockedMotionPackStoryIds, storyId);
    }
    if (
      row.direct_video_enrichment_requested === true ||
      blockers.includes("direct_video_motion_missing") ||
      Number(row.missing_direct_video_motion || 0) > 0
    ) {
      addStoryIdToSet(directVideoEnrichmentStoryIds, storyId);
    }
    if (Array.isArray(row.canonical_entity_repair_blockers) && row.canonical_entity_repair_blockers.length) {
      addStoryIdToSet(canonicalEntityRepairStoryIds, storyId);
    }
    if (rowAllowsOwnedExplainerMotionException(row)) {
      addStoryIdToSet(ownedExplainerExceptionStoryIds, storyId);
    }
  }

  const enabled =
    directVideoEnrichmentStoryIds.size > 0 ||
    blockedMotionPackStoryIds.size > 0 ||
    canonicalEntityRepairStoryIds.size > 0 ||
    ownedExplainerExceptionStoryIds.size > 0;

  return {
    enabled,
    directVideoEnrichmentStoryIds,
    blockedMotionPackStoryIds,
    canonicalEntityRepairStoryIds,
    ownedExplainerExceptionStoryIds,
  };
}

function bridgeMotionGovernanceEvidenceSummary(value = {}) {
  const evidence = normaliseBridgeMotionGovernanceEvidence(value);
  return {
    enabled: evidence.enabled,
    direct_video_enrichment_story_count: evidence.directVideoEnrichmentStoryIds.size,
    blocked_motion_pack_story_count: evidence.blockedMotionPackStoryIds.size,
    canonical_entity_repair_story_count: evidence.canonicalEntityRepairStoryIds.size,
    owned_explainer_exception_story_count: evidence.ownedExplainerExceptionStoryIds.size,
  };
}

function bridgeMotionGovernanceExceptionApprovedForStory(story = {}, evidence = null) {
  const directMotionExceptionApproved =
    story.human_reviewed_direct_video_motion_exception === true ||
    story.direct_video_motion_exception_approved === true;
  if (directMotionExceptionApproved) return true;

  const humanReviewedOwnedExplainerException =
    story.human_reviewed_owned_explainer_motion_exception === true;
  if (humanReviewedOwnedExplainerException) return sourceLooksEditoriallyVerified(story);

  const automaticOwnedExplainerException =
    story.owned_explainer_motion_exception_approved === true;
  if (!automaticOwnedExplainerException || !sourceLooksEditoriallyVerified(story)) return false;

  const storyId = normaliseStoryId(story.id || story.story_id);
  return Boolean(storyId && evidence?.ownedExplainerExceptionStoryIds?.has(storyId));
}

function currentBridgeMotionEvidenceForStory(story = {}) {
  const { visualEvidenceProfile } = require("../lib/visual-evidence-classifier");
  const profile = visualEvidenceProfile({
    story,
    rightsLedger: objectValue(story.rights_ledger || story.rights_records, {}),
    footageInventory: objectValue(story.footage_inventory, {}),
    directorPlan: objectValue(story.visual_v4_director_plan || story.director_plan, {}),
  });
  const currentClipCount = Math.max(
    Number(story.visual_v4_render_bridge_clip_count || 0),
    asArray(story.video_clips).length,
    asArray(story.visual_v4_bridge_video_clips).length,
  );
  return {
    profile,
    directVideoMotionReady: Number(profile.direct_video_motion_asset_count || 0) > 0,
    motionPackReady:
      currentClipCount >= 3 &&
      Number(profile.motion_asset_count || 0) >= 3 &&
      profile.generated_only_motion_deck !== true,
  };
}

function bridgeMotionGovernancePreflightForStory(story = {}, opts = {}) {
  if (!story.scheduler_bridge_source) return null;
  const storyId = normaliseStoryId(story.id || story.story_id);
  if (!storyId) return null;

  const evidence = normaliseBridgeMotionGovernanceEvidence(opts.bridgeMotionGovernanceEvidence || {});
  if (!evidence.enabled) return null;

  const failures = [];
  if (evidence.directVideoEnrichmentStoryIds.has(storyId)) {
    failures.push("direct_video_enrichment_required");
  }
  if (evidence.blockedMotionPackStoryIds.has(storyId)) {
    failures.push("v4_motion_pack_blocked");
  }
  if (evidence.canonicalEntityRepairStoryIds.has(storyId)) {
    failures.push("canonical_entity_repair_required");
  }
  if (!failures.length) return { result: "pass", failures: [], warnings: [] };

  const currentMotionEvidence = currentBridgeMotionEvidenceForStory(story);
  const staleFailures = [];
  const activeFailures = failures.filter((failure) => {
    if (
      failure === "direct_video_enrichment_required" &&
      currentMotionEvidence.directVideoMotionReady
    ) {
      staleFailures.push(failure);
      return false;
    }
    if (
      failure === "v4_motion_pack_blocked" &&
      currentMotionEvidence.directVideoMotionReady &&
      currentMotionEvidence.motionPackReady
    ) {
      staleFailures.push(failure);
      return false;
    }
    return true;
  });
  if (!activeFailures.length && staleFailures.length) {
    return {
      result: "warn",
      failures: [],
      warnings: ["stale_source_family_evidence_ignored"],
      evidence: {
        story_id: storyId,
        stale_failures: [...new Set(staleFailures)],
        direct_video_motion_asset_count:
          currentMotionEvidence.profile.direct_video_motion_asset_count,
        motion_asset_count: currentMotionEvidence.profile.motion_asset_count,
      },
    };
  }

  if (bridgeMotionGovernanceExceptionApprovedForStory(story, evidence)) {
    return {
      result: "pass",
      failures: [],
      warnings: ["bridge_motion_governance_exception:human_reviewed_source_locked"],
    };
  }

  return {
    result: "fail",
    failures: [...new Set(activeFailures)],
    warnings: staleFailures.length ? ["stale_source_family_evidence_ignored"] : [],
    evidence: {
      story_id: storyId,
      direct_video_enrichment_required: activeFailures.includes("direct_video_enrichment_required"),
      v4_motion_pack_blocked: activeFailures.includes("v4_motion_pack_blocked"),
      canonical_entity_repair_required: activeFailures.includes("canonical_entity_repair_required"),
      stale_failures: [...new Set(staleFailures)],
    },
  };
}

const VISUAL_ENTITY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "game",
  "games",
  "gaming",
  "official",
  "trailer",
  "gameplay",
  "direct",
  "motion",
  "clip",
  "media",
  "product",
  "page",
  "showcase",
  "demo",
  "xbox",
  "wire",
  "playstation",
  "nintendo",
  "steam",
  "video",
  "story",
  "news",
  "update",
]);
const VISUAL_CHARACTER_SPECIFIC_CONTEXT_RE =
  /\b(?:character|fighter|roster|new[-_\s]?fighter|new[-_\s]?character|dlc[-_\s]?fighter|gameplay[-_\s]?reveal|ranked|rushdown|zoner|footsie|footsies|meter|combo|combos|knife[-_\s]?feints?|eskrima|space[-_\s]?control)\b/i;
const VISUAL_SPECIFIC_SOURCE_LOCK_STOPWORDS = new Set([
  "ahead",
  "beat",
  "capcom",
  "character",
  "combat",
  "control",
  "dangerous",
  "defenders",
  "eskrima",
  "fairness",
  "fighter",
  "footage",
  "headline",
  "just",
  "knife",
  "looks",
  "made",
  "mode",
  "players",
  "pressure",
  "problem",
  "ranked",
  "reveal",
  "revealed",
  "rushdown",
  "space",
  "street",
  "videos",
  "while",
  "zoner",
  "zoners",
]);

function visualEntityTokenise(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) =>
      token &&
      !VISUAL_ENTITY_STOPWORDS.has(token) &&
      (token.length >= 3 || /^\d+$/.test(token))
    );
}

function visualSubjectAliasTokens(value = "") {
  const key = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = key.replace(/\s+/g, "");
  const aliases = new Set();
  if (
    /\bgrand theft auto vi\b|\bgta vi\b|\bgta 6\b/.test(key) ||
    ["grandtheftautovi", "grandtheftauto6", "gtavi", "gta6"].includes(compact)
  ) {
    aliases.add("grand theft auto vi");
    aliases.add("grand theft auto 6");
    aliases.add("gta vi");
    aliases.add("gta 6");
    aliases.add("gtavi");
    aliases.add("gta6");
  }
  if (
    /\bgrand theft auto v\b|\bgta v\b|\bgta 5\b/.test(key) ||
    ["grandtheftautov", "grandtheftauto5", "gtav", "gta5"].includes(compact)
  ) {
    aliases.add("grand theft auto v");
    aliases.add("grand theft auto 5");
    aliases.add("gta v");
    aliases.add("gta 5");
    aliases.add("gtav");
    aliases.add("gta5");
  }
  return Array.from(aliases).filter(Boolean);
}

function visualSubjectTokensForStory(story = {}) {
  const subject = cleanText(
    story.canonical_subject ||
      story.canonical_game ||
      story.game_title ||
      story.primary_game ||
      "",
  );
  const fallbackTitle = cleanText(
    story.selected_title ||
      story.public_title ||
      story.upload_title ||
      story.title ||
      "",
  );
  const tokens = visualEntityTokenise(subject || fallbackTitle);
  tokens.push(...visualSubjectAliasTokens(subject || fallbackTitle));
  if (tokens.includes("gta")) tokens.push("grand", "theft", "auto");
  if (tokens.includes("gta")) {
    for (const token of tokens) {
      if (/^\d+$/.test(token)) tokens.push(`gta${token}`);
    }
  }
  return [...new Set(tokens)];
}

function visualSourceLockTokensForStory(story = {}) {
  const url = cleanText(
    story.primary_source_url ||
      story.source_url ||
      story.article_url ||
      story.url ||
      "",
  );
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const pathTokens = visualEntityTokenise(parsed.pathname);
    const numericIds = parsed.pathname.match(/\b\d{5,}\b/g) || [];
    return [...new Set([...pathTokens, ...numericIds])];
  } catch {
    return [];
  }
}

function visualSpecificSourceLockTokensForStory(story = {}) {
  const context = [
    story.title,
    story.selected_title,
    story.public_title,
    story.short_title,
    story.suggested_thumbnail_text,
    story.thumbnail_headline,
    story.full_script,
    story.tts_script,
    story.narration_script,
    story.primary_source_url,
    story.source_url,
    story.url,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  if (!VISUAL_CHARACTER_SPECIFIC_CONTEXT_RE.test(context)) return [];

  let urlPath = "";
  const url = cleanText(story.primary_source_url || story.source_url || story.url);
  if (url) {
    try {
      urlPath = new URL(url).pathname;
    } catch {
      urlPath = url;
    }
  }

  const gameTokens = new Set(visualEntityTokenise(story.canonical_game || story.game_title || ""));
  const sourceTokens = new Set([
    ...visualEntityTokenise(story.source_name),
    ...visualEntityTokenise(story.primary_source_name),
  ]);
  const seen = new Set();
  return visualEntityTokenise([
    story.motion_subject,
    story.featured_character,
    story.character_name,
    story.title,
    story.selected_title,
    story.public_title,
    story.short_title,
    story.suggested_thumbnail_text,
    story.thumbnail_headline,
    urlPath,
  ].map(cleanText).filter(Boolean).join(" "))
    .filter((token) => token.length >= 4)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !gameTokens.has(token))
    .filter((token) => !sourceTokens.has(token))
    .filter((token) => !VISUAL_SPECIFIC_SOURCE_LOCK_STOPWORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    })
    .slice(0, 4);
}

function isLocalOrGeneratedReference(value = "") {
  const text = cleanText(value).toLowerCase().replace(/\\/g, "/");
  return (
    !text ||
    text.startsWith("local://") ||
    text.startsWith("file://") ||
    text.startsWith("output/") ||
    text.includes("/output/") ||
    /^[a-z]:\//i.test(text)
  );
}

function genericMotionFamily(value = "") {
  return /^(?:direct_motion|selected_render_clip|production_motion|bridge_shot_family|v4_motion_family|motion_clip)[_-]?\d*$/i.test(
    cleanText(value),
  );
}

function externalSourceValue(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !isLocalOrGeneratedReference(text)) return text;
  }
  return cleanText(values.find(Boolean));
}

function richerFamilyValue(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && !genericMotionFamily(text)) return text;
  }
  return cleanText(values.find(Boolean));
}

function visualAssetPathKey(asset = {}) {
  if (typeof asset === "string") return cleanText(asset).replace(/\\/g, "/").toLowerCase();
  return cleanText(
    asset.path ||
      asset.local_path ||
      asset.local_materialized_path ||
      asset.local_materialised_path ||
      asset.file_path ||
      asset.media_path,
  ).replace(/\\/g, "/").toLowerCase();
}

function visualAssetPathCandidates(asset = {}) {
  const values = typeof asset === "string"
    ? [asset]
    : [
        asset.path,
        asset.local_path,
        asset.local_materialized_path,
        asset.local_materialised_path,
        asset.file_path,
        asset.media_path,
      ];
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function resolveLocalVisualAssetPath(value = "") {
  const text = cleanText(value);
  if (!text || /^local:\/\//i.test(text) || /^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) return "";
  const normalised = text.replace(/\//g, path.sep);
  return path.isAbsolute(normalised) ? normalised : path.resolve(ROOT, normalised);
}

function readVisualAssetSidecar(asset = {}) {
  for (const candidate of visualAssetPathCandidates(asset)) {
    const resolved = resolveLocalVisualAssetPath(candidate);
    if (!resolved) continue;
    const sidecarPath = `${resolved}.json`;
    try {
      if (!fs.existsSync(sidecarPath)) continue;
      const sidecar = fs.readJsonSync(sidecarPath);
      if (sidecar && typeof sidecar === "object" && !Array.isArray(sidecar)) {
        return { ...sidecar, source_sidecar_path: sidecarPath };
      }
    } catch {
      // Sidecar evidence is optional, but unreadable sidecars should not crash
      // read-only scheduler preflight.
    }
  }
  return null;
}

function enrichVisualAssetWithSidecar(asset = {}) {
  const normalised = typeof asset === "string" ? { path: asset } : { ...asset };
  const sidecar = readVisualAssetSidecar(normalised);
  if (!sidecar) return normalised;
  const sidecarSourceUrl = cleanText(sidecar.source_url || sidecar.url);
  const sidecarSourceFamily = cleanText(sidecar.source_family || sidecar.motion_family || sidecar.family);
  return {
    ...normalised,
    source_sidecar_path: cleanText(sidecar.source_sidecar_path),
    source_sidecar_signature: cleanText(sidecar.render_signature || sidecar.generator),
    sidecar_source_url: sidecarSourceUrl,
    sidecar_source_family: sidecarSourceFamily,
    sidecar_media_start_s: sidecar.media_start_s ?? sidecar.mediaStartS ?? null,
    sidecar_duration_s: sidecar.duration_s ?? sidecar.durationS ?? null,
    original_source_url: externalSourceValue(
      sidecarSourceUrl,
      normalised.original_source_url,
      normalised.source_url,
      normalised.url,
    ),
    original_source_family: richerFamilyValue(
      sidecarSourceFamily,
      normalised.original_source_family,
      normalised.source_family,
      normalised.motion_family,
      normalised.family,
    ),
  };
}

function mergeVisualAssetProvenance(existing = {}, incoming = {}) {
  const merged = {
    ...enrichVisualAssetWithSidecar(existing),
    ...enrichVisualAssetWithSidecar(incoming),
  };
  merged.source_url = externalSourceValue(
    existing.source_url || existing.url,
    incoming.source_url || incoming.url,
  );
  merged.url = externalSourceValue(existing.url, incoming.url);
  merged.source_family = richerFamilyValue(
    existing.source_family || existing.motion_family || existing.family,
    incoming.source_family || incoming.motion_family || incoming.family,
  );
  merged.motion_family = richerFamilyValue(
    existing.motion_family || existing.source_family || existing.family,
    incoming.motion_family || incoming.source_family || incoming.family,
  );
  return enrichVisualAssetWithSidecar(merged);
}

function dedupeVisualAssetsByPath(assets = []) {
  const byPath = new Map();
  const unkeyed = [];
  for (const asset of asArray(assets)) {
    if (!asset) continue;
    const normalised = enrichVisualAssetWithSidecar(asset);
    const key = visualAssetPathKey(normalised);
    if (!key) {
      unkeyed.push(normalised);
      continue;
    }
    byPath.set(
      key,
      byPath.has(key)
        ? mergeVisualAssetProvenance(byPath.get(key), normalised)
        : { ...normalised },
    );
  }
  return [...byPath.values(), ...unkeyed];
}

function visualAssetProvenanceText(asset = {}) {
  const values = [
    asset.source_family,
    asset.motion_family,
    asset.family,
    asset.trusted_footage_source_id,
    asset.source_id,
    asset.source_owner,
    asset.asset_owner,
    asset.owner,
    asset.publisher,
    asset.developer,
    asset.product_title,
    asset.app_title,
    asset.app_name,
    asset.game_title,
    asset.entity,
    ...asArray(asset.entities),
    asset.source_title,
    asset.media_title,
    asset.title,
    asset.name,
    asset.display_name,
    asset.source_tier,
    asset.sidecar_source_family,
    !isLocalOrGeneratedReference(asset.sidecar_source_url) ? asset.sidecar_source_url : "",
    !isLocalOrGeneratedReference(asset.source_url) ? asset.source_url : "",
    !isLocalOrGeneratedReference(asset.url) ? asset.url : "",
    !isLocalOrGeneratedReference(asset.reference_url) ? asset.reference_url : "",
    asset.original_source_family,
    !isLocalOrGeneratedReference(asset.original_source_url) ? asset.original_source_url : "",
  ];
  return cleanText(values.filter(Boolean).join(" ")).toLowerCase();
}

function visualAssetSidecarProvenanceText(asset = {}) {
  if (!asset.source_sidecar_path) return "";
  const values = [
    asset.sidecar_source_family,
    !isLocalOrGeneratedReference(asset.sidecar_source_url) ? asset.sidecar_source_url : "",
  ];
  return cleanText(values.filter(Boolean).join(" ")).toLowerCase();
}

const OPAQUE_SIDECAR_PROVENANCE_TOKENS = new Set([
  "akamai",
  "akamaized",
  "assets",
  "asset",
  "avs",
  "cdn",
  "com",
  "content",
  "dash",
  "direct",
  "fastly",
  "family",
  "hls",
  "https",
  "http",
  "is",
  "m3u8",
  "master",
  "media",
  "microsoft",
  "microsoftassets",
  "mp4",
  "packagedstreaming",
  "segment",
  "source",
  "store",
  "store_trailers",
  "steamstatic",
  "trailers",
  "true",
  "url",
  "video",
  "uploads",
  "window",
  "www",
  "xboxservices",
]);

function provenanceContainsSubjectToken(provenance = "", subjectTokens = []) {
  if (!provenance) return false;
  const rawProvenance = cleanText(provenance).toLowerCase();
  const normalisedProvenance = rawProvenance
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compactProvenance = normalisedProvenance.replace(/\s+/g, "");
  return subjectTokens.some((token) => {
    const rawToken = cleanText(token).toLowerCase();
    const normalisedToken = rawToken
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalisedToken) return false;
    const compactToken = normalisedToken.replace(/\s+/g, "");
    if (normalisedToken.includes(" ")) {
      return normalisedProvenance.includes(normalisedToken) ||
        (compactToken.length >= 4 && compactProvenance.includes(compactToken));
    }
    return new RegExp(`(^|[^a-z0-9])${normalisedToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(normalisedProvenance) ||
      (compactToken.length >= 4 && compactProvenance.includes(compactToken));
  });
}

function sidecarProvenanceLooksOpaque(provenance = "") {
  const tokens = visualEntityTokenise(provenance).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) =>
    OPAQUE_SIDECAR_PROVENANCE_TOKENS.has(token) ||
    /^[a-f0-9]{4,}$/i.test(token) ||
    /^[0-9]+$/.test(token)
  );
}

function visualAssetSubjectLocked(asset = {}, subjectTokens = []) {
  const sidecarProvenance = visualAssetSidecarProvenanceText(asset);
  const provenance = visualAssetProvenanceText(asset);
  if (sidecarProvenance) {
    if (provenanceContainsSubjectToken(sidecarProvenance, subjectTokens)) return true;
    return sidecarProvenanceLooksOpaque(sidecarProvenance) &&
      provenanceContainsSubjectToken(provenance, subjectTokens);
  }
  return provenanceContainsSubjectToken(provenance, subjectTokens);
}

function visualAssetBasename(value = "") {
  const text = cleanText(value).replace(/\\/g, "/");
  if (!text) return "";
  const withoutQuery = text.split(/[?#]/)[0];
  return cleanText(withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1)).toLowerCase();
}

function visualAssetIdentityValues(asset = {}) {
  if (!asset || typeof asset !== "object") return [];
  return [
    asset.source_family,
    asset.motion_family,
    asset.family,
    asset.id,
    asset.asset_id,
    asset.motion_pack_clip_id,
    asset.source_id,
    asset.trusted_footage_source_id,
    visualAssetBasename(asset.path || asset.local_path || asset.media_path || asset.file_path),
    visualAssetBasename(asset.source_url || asset.url || asset.reference_url),
  ].map((value) => cleanText(value).toLowerCase()).filter(Boolean);
}

function trustedSourceIntakeAssets(footageInventory = {}) {
  return [
    ...asArray(footageInventory.trusted_source_pipeline?.intake_queue),
    ...asArray(footageInventory.trusted_sources?.intake_queue),
  ].map((item) => {
    const referenceUrl = cleanText(item.reference_url || item.source_url || item.url);
    return {
      id: cleanText(item.source_id || item.id || item.asset_id),
      asset_id: cleanText(item.source_id || item.asset_id || item.id),
      source_id: cleanText(item.source_id || item.id),
      source_family: cleanText(item.source_family || item.family || item.display_name),
      motion_family: cleanText(item.source_family || item.family || item.display_name),
      source_url: referenceUrl,
      reference_url: referenceUrl,
      source_type: cleanText(
        item.source_type ||
          (/^local:\/\/existing-official-direct-motion\//i.test(referenceUrl)
            ? "licensed_direct_media_url"
            : item.intake_mode || item.source_url_kind),
      ),
      media_kind: cleanText(item.media_kind || "direct_video"),
      source_title: cleanText(item.source_title || item.display_name || item.title),
      display_name: cleanText(item.display_name),
      entity: cleanText(item.entity),
      entities: asArray(item.entities).map(cleanText).filter(Boolean),
      source_tier: cleanText(item.source_tier),
      rights_risk_class: cleanText(item.rights_risk_class),
      rights_basis: cleanText(item.rights_basis || item.licence_basis || item.license_basis),
    };
  }).filter((item) =>
    visualAssetIdentityValues(item).length &&
    (item.entity || item.entities.length || item.source_title || item.reference_url)
  );
}

function enrichVisualAssetsWithTrustedSourceIntake(assets = [], intakeAssets = []) {
  if (!intakeAssets.length) return assets;
  return assets.map((asset) => {
    const assetValues = new Set(visualAssetIdentityValues(asset));
    const match = intakeAssets.find((intake) =>
      visualAssetIdentityValues(intake).some((value) => assetValues.has(value))
    );
    return match ? mergeVisualAssetProvenance(asset, match) : asset;
  });
}

async function readArtifactJsonObjectForStory(story = {}, fileName = "") {
  const artifactDir = artifactDirForStory(story);
  if (!artifactDir || !fileName) return {};
  const filePath = path.resolve(ROOT, artifactDir, fileName);
  try {
    if (!(await fs.pathExists(filePath))) return {};
    const value = await fs.readJson(filePath);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function readCurrentRenderManifestForStory(story = {}) {
  const artifactDir = artifactDirForStory(story);
  const candidates = [
    cleanText(story.render_manifest_path),
    artifactDir ? path.join(artifactDir, "render_manifest.json") : "",
  ].filter(Boolean);
  for (const rawPath of [...new Set(candidates)]) {
    const filePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(ROOT, rawPath);
    try {
      if (!(await fs.pathExists(filePath))) continue;
      const value = await fs.readJson(filePath);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Stale or unreadable package evidence is handled by bridge freshness.
    }
  }
  return {};
}

async function visualEntityPreflightForStory(story = {}) {
  if (!shouldRunIncidentGuardForStory(story)) return null;
  const subjectTokens = visualSubjectTokensForStory(story);
  const sourceLockTokens = visualSourceLockTokensForStory(story);
  const requiredSpecificSourceLockTokens = visualSpecificSourceLockTokensForStory(story);
  const lockTokens = requiredSpecificSourceLockTokens.length
    ? requiredSpecificSourceLockTokens
    : [...new Set([...subjectTokens, ...sourceLockTokens])];
  if (!lockTokens.length) return null;

  const [renderStory, footageInventoryArtifact, rightsLedgerArtifact, directorArtifact] = await Promise.all([
    readArtifactJsonObjectForStory(story, "visual_v4_render_story.json"),
    readArtifactJsonObjectForStory(story, "footage_inventory.json"),
    readArtifactJsonObjectForStory(story, "rights_ledger.json"),
    readArtifactJsonObjectForStory(story, "director_beat_map.json"),
  ]);
  const footageInventory = objectValue(story.footage_inventory, footageInventoryArtifact);
  const rightsLedger = objectValue(story.rights_ledger || story.rights_records, rightsLedgerArtifact);
  const directorPlan = objectValue(story.visual_v4_director_plan || story.director_plan, directorArtifact);
  const trustedIntakeAssets = trustedSourceIntakeAssets(footageInventory);
  const assets = enrichVisualAssetsWithTrustedSourceIntake(dedupeVisualAssetsByPath([
    ...asArray(story.visual_v4_bridge_video_clips),
    ...asArray(story.video_clips),
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.video_clips),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...rightsLedgerRecords(rightsLedger),
    ...asArray(directorPlan.shot_plan).map((shot) => ({
      ...shot,
      path: shot.path || shot.media_path || shot.file_path,
      source_url: shot.source_url || shot.url,
    })),
  ]), trustedIntakeAssets);
  const { isDirectVideoMotionAsset } = require("../lib/visual-evidence-classifier");
  const directMotionAssets = assets.filter(isDirectVideoMotionAsset);
  if (!directMotionAssets.length) return null;

  const mismatched = directMotionAssets
    .filter((asset) =>
      !visualAssetSubjectLocked(
        asset,
        asset.source_sidecar_path && !requiredSpecificSourceLockTokens.length
          ? subjectTokens
          : lockTokens,
      )
    )
    .map((asset) => ({
      id: cleanText(asset.id || asset.asset_id),
      source_family: cleanText(asset.source_family || asset.motion_family || asset.family),
      source_url: cleanText(asset.source_url || asset.url),
      path: cleanText(asset.path || asset.local_path || asset.media_path),
      provenance_text: visualAssetProvenanceText(asset).slice(0, 240),
    }));

  if (mismatched.length) {
    return {
      result: "fail",
      failures: ["direct_motion_subject_mismatch"],
      warnings: [],
      evidence: {
        canonical_subject_tokens: subjectTokens,
        source_lock_tokens: sourceLockTokens,
        required_specific_source_lock_tokens: requiredSpecificSourceLockTokens,
        direct_motion_asset_count: directMotionAssets.length,
        mismatched_motion_assets: mismatched.slice(0, 8),
      },
    };
  }

  return {
    result: "pass",
    failures: [],
    warnings: [],
    evidence: {
      canonical_subject_tokens: subjectTokens,
      source_lock_tokens: sourceLockTokens,
      required_specific_source_lock_tokens: requiredSpecificSourceLockTokens,
      direct_motion_asset_count: directMotionAssets.length,
      direct_motion_assets: directMotionAssets.slice(0, 8).map((asset) => ({
        id: cleanText(asset.id || asset.asset_id),
        source_family: cleanText(asset.source_family || asset.motion_family || asset.family),
        source_url: cleanText(asset.source_url || asset.url),
        path: cleanText(asset.path || asset.local_path || asset.media_path),
        sidecar_source_family: cleanText(asset.sidecar_source_family),
        sidecar_source_url: cleanText(asset.sidecar_source_url),
        source_sidecar_path: cleanText(asset.source_sidecar_path),
        provenance_text: visualAssetProvenanceText(asset).slice(0, 240),
      })),
    },
  };
}

function benchmarkReportPathForStory(story = {}) {
  const explicit = cleanText(story.benchmark_report_path || story.benchmarkReportPath);
  if (explicit) return path.resolve(ROOT, explicit);
  const artifactDir = cleanText(
    story.scheduler_bridge_artifact_dir ||
      story.artifact_dir ||
      story.artifactDir ||
      story.output_dir ||
      story.outputDir,
  );
  if (!artifactDir) return null;
  return path.join(path.resolve(ROOT, artifactDir), "benchmark_report.json");
}

function localBenchmarkPreflightForStory(story = {}) {
  const reportPath = benchmarkReportPathForStory(story);
  if (!reportPath || !fs.existsSync(reportPath)) return null;
  let report = null;
  try {
    report = fs.readJsonSync(reportPath);
  } catch {
    return {
      result: "fail",
      failures: ["local_benchmark_report_unreadable"],
      warnings: [],
      evidence: { benchmark_report_path: reportPath },
    };
  }

  const status = cleanText(report.result || report.status || report.verdict).toLowerCase();
  const failures = [
    ...asArray(report.failures),
    ...asArray(report.blockers),
  ].map(cleanText).filter(Boolean);

  if ((status === "pass" || status === "ready" || status === "green") && failures.length === 0) {
    return {
      result: "pass",
      failures: [],
      warnings: [
        "goal10_aggregate_index_stale_local_benchmark_used",
        ...asArray(report.warnings).map(cleanText).filter(Boolean),
      ],
      evidence: {
        benchmark_report_path: reportPath,
        local_benchmark_result: report.result || report.status || report.verdict || "pass",
      },
    };
  }

  return {
    result: "fail",
    failures: failures.length ? failures : [status ? `local_benchmark_status:${status}` : "local_benchmark_status_not_ready"],
    warnings: asArray(report.warnings).map(cleanText).filter(Boolean),
    evidence: {
      benchmark_report_path: reportPath,
      local_benchmark_result: report.result || report.status || report.verdict || "unknown",
    },
  };
}

function aggregateBenchmarkPreflightForStory(story = {}, opts = {}) {
  if (!story.scheduler_bridge_source) return null;
  const report =
    opts.upstreamBenchmarkReport ||
    opts.aggregateBenchmarkReport ||
    opts.goal10ReadinessReport ||
    null;
  if (!report || typeof report !== "object") return null;

  const storyId = normaliseStoryId(story.id || story.story_id);
  if (!storyId) {
    return {
      result: "fail",
      failures: ["goal10_story_id_missing"],
      warnings: [],
    };
  }

  const rows = asArray(report.stories);
  if (!rows.length) {
    const local = localBenchmarkPreflightForStory(story);
    if (local) return local;
    return {
      result: "fail",
      failures: ["goal10_report_has_no_story_rows"],
      warnings: [],
      evidence: {
        goal: cleanText(report.goal || "goal10_gold_standard_forensics_engine"),
      },
    };
  }

  const row = rows.find((item) => normaliseStoryId(item?.story_id || item?.id) === storyId);
  if (!row) {
    const local = localBenchmarkPreflightForStory(story);
    if (local) return local;
    return {
      result: "fail",
      failures: ["goal10_story_missing"],
      warnings: [],
      evidence: {
        story_id: storyId,
        goal: cleanText(report.goal || "goal10_gold_standard_forensics_engine"),
      },
    };
  }

  const status = cleanText(row.status || row.verdict || row.readiness_status).toLowerCase();
  if (status === "ready" || status === "pass" || status === "green") {
    return {
      result: "pass",
      failures: [],
      warnings: [],
      evidence: {
        story_id: storyId,
        status: row.status || "ready",
      },
    };
  }

  const failures = [
    ...asArray(row.blockers),
    ...asArray(row.direct_benchmark_blockers),
    ...asArray(row.upstream_blockers),
    status ? `goal10_status:${status}` : "goal10_status_not_ready",
  ]
    .map(cleanText)
    .filter(Boolean);

  return {
    result: "fail",
    failures: [...new Set(failures)],
    warnings: asArray(row.warnings).map(cleanText).filter(Boolean),
    evidence: {
      story_id: storyId,
      status: row.status || "unknown",
      direct_benchmark_status: row.direct_benchmark_status || null,
    },
  };
}

function scriptScoreFromScorecard(scorecard = {}) {
  const candidates = [
    scorecard.viral_score,
    scorecard.total_score,
    scorecard.score,
    scorecard.scores?.viral_score,
    scorecard.scores?.total_score,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function embeddedScriptScorecard(story = {}) {
  return objectValue(
    story.script_scorecard ||
      story.scriptScorecard ||
      story.viral_script_scorecard ||
      story.selected_script?.scorecard,
    null,
  );
}

async function scriptScorecardPreflightForStory(story = {}, opts = {}) {
  const artifactDir = cleanText(
    story.scheduler_bridge_artifact_dir || story.artifact_dir || story.output_dir || story.package_dir,
  );
  const explicitPath = cleanText(story.script_scorecard_path || story.scriptScorecardPath);
  const scorecardPath = explicitPath || (artifactDir ? path.join(artifactDir, "script_scorecard.json") : "");
  let scorecard = embeddedScriptScorecard(story);

  if (!scorecard && scorecardPath) {
    try {
      scorecard = await fs.readJson(path.resolve(scorecardPath));
    } catch {
      return null;
    }
  }

  if (!scorecard) return null;

  const threshold =
    Number.isFinite(Number(opts.scriptScoreThreshold))
      ? Number(opts.scriptScoreThreshold)
      : DEFAULT_SCRIPT_SCORE_THRESHOLD;
  const score = scriptScoreFromScorecard(scorecard);
  const verdict = cleanText(scorecard.verdict || scorecard.status || scorecard.result).toLowerCase();
  const blockers = asArray(scorecard.blockers).map(cleanText).filter(Boolean);
  const warnings = asArray(scorecard.warnings).map(cleanText).filter(Boolean);
  const failures = [];

  if (Number.isFinite(score) && score < threshold) {
    failures.push("script_score_below_threshold");
  }
  if (/rewrite_required|tighten_before_tts|reject|blocked|fail/.test(verdict)) {
    failures.push(`script_verdict_${verdict}`);
  }
  for (const blocker of blockers) {
    failures.push(`script_blocker:${blocker}`);
  }
  if (warnings.includes("no_curiosity_marker")) {
    failures.push("no_curiosity_marker");
  }

  return {
    result: failures.length ? "fail" : "pass",
    failures: [...new Set(failures)],
    warnings,
    evidence: {
      story_id: story.id || story.story_id || null,
      script_scorecard_path: scorecardPath || null,
      viral_score: score,
      threshold,
      verdict: scorecard.verdict || scorecard.status || scorecard.result || null,
    },
  };
}

function parsedSourcePublishedAt(story = {}) {
  const candidates = [
    story.source_published_at,
    story.published_at,
    story.primary_source_published_at,
    story.primary_source?.published_at,
    story.source_manifest?.source_published_at,
    story.source_manifest?.primary_source?.published_at,
    story.canonical_story_manifest?.source_published_at,
    story.timestamp,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(cleanText(candidate));
    if (Number.isFinite(parsed)) return { value: cleanText(candidate), ms: parsed };
  }
  return null;
}

function staleSourceApprovalStatus(story = {}) {
  const review = objectValue(
    story.stale_temporal_review ||
      story.stale_source_review ||
      story.evergreen_review ||
      story.source_age_review,
    {},
  );
  const decision = cleanText(
    review.decision ||
      review.status ||
      story.stale_temporal_review_decision ||
      story.stale_source_review_decision ||
      story.evergreen_review_decision,
  ).toLowerCase();
  const explicitApproval =
    story.evergreen_approved === true ||
    story.operator_approved_evergreen === true ||
    story.stale_source_operator_approved === true ||
    story.stale_temporal_operator_approved === true ||
    review.operator_approved === true ||
    review.approved === true;
  const approvalDecision =
    /^(approve_evergreen|approved_evergreen|approve_stale_evergreen|operator_approved_evergreen|approve_current_relevance|approved_current_relevance|approve_stale_with_current_relevance|approved_stale_with_current_relevance)$/i.test(
      decision,
    );
  return {
    approved: explicitApproval || approvalDecision,
    decision: decision || null,
  };
}

async function sourceAgePreflightForStory(story = {}, opts = {}) {
  const sourceManifest = objectValue(story.source_manifest, {});
  const freshnessGate = cleanText(sourceManifest.freshness_gate || story.freshness_gate).toLowerCase();
  const published = parsedSourcePublishedAt(story);
  if (!published && freshnessGate !== "blocked") return null;

  const policyHours = Number.isFinite(Number(story.source_age_policy_hours))
    ? Number(story.source_age_policy_hours)
    : Number.isFinite(Number(sourceManifest.source_age_policy_hours))
      ? Number(sourceManifest.source_age_policy_hours)
      : DEFAULT_SOURCE_AGE_POLICY_HOURS;
  const nowMs = Number.isFinite(Number(opts.nowMs))
    ? Number(opts.nowMs)
    : opts.now instanceof Date
      ? opts.now.getTime()
      : Date.now();
  const ageHours = published
    ? Math.max(0, Number(((nowMs - published.ms) / 36e5).toFixed(2)))
    : null;
  const approval = staleSourceApprovalStatus(story);
  const stale =
    freshnessGate === "blocked" ||
    (Number.isFinite(ageHours) && ageHours > policyHours);

  if (!stale) {
    return {
      result: "pass",
      failures: [],
      warnings: [],
      evidence: {
        source_published_at: published?.value || null,
        age_hours: ageHours,
        policy_hours: policyHours,
      },
    };
  }

  if (approval.approved) {
    return {
      result: "warn",
      failures: [],
      warnings: ["source_age_exceeds_policy_operator_approved"],
      evidence: {
        source_published_at: published?.value || null,
        age_hours: ageHours,
        policy_hours: policyHours,
        stale_source_decision: approval.decision,
      },
    };
  }

  return {
    result: "fail",
    failures: ["source_age_exceeds_policy"],
    warnings: [],
    evidence: {
      source_published_at: published?.value || null,
      age_hours: ageHours,
      policy_hours: policyHours,
      freshness_gate: freshnessGate || null,
    },
  };
}

async function bridgeArtifactFreshnessPreflightForStory(story = {}) {
  if (!story.scheduler_bridge_source) return null;
  const artifactDir = cleanText(
    story.scheduler_bridge_artifact_dir || story.artifact_dir || story.output_dir || story.package_dir,
  );
  const manifestPath = cleanText(story.render_manifest_path) ||
    (artifactDir ? path.join(artifactDir, "render_manifest.json") : "");
  if (!manifestPath) {
    return {
      result: "fail",
      failures: ["bridge_render_manifest_missing"],
      warnings: [],
    };
  }

  let manifest = null;
  try {
    manifest = await fs.readJson(path.resolve(manifestPath));
  } catch {
    return {
      result: "fail",
      failures: ["bridge_render_manifest_unreadable"],
      warnings: [],
    };
  }

  const failures = [];
  const manifestDuration = renderedDurationFromManifest(manifest);
  const bridgeDuration = storyDurationSeconds(story);
  if (
    Number.isFinite(manifestDuration) &&
    Number.isFinite(bridgeDuration) &&
    Math.abs(manifestDuration - bridgeDuration) > 0.25
  ) {
    failures.push("bridge_metadata_stale:duration_seconds");
  }

  const manifestOutputPath = normaliseComparablePath(renderOutputPathFromManifest(manifest));
  const bridgeOutputPath = normaliseComparablePath(story.exported_path);
  if (manifestOutputPath && bridgeOutputPath && manifestOutputPath !== bridgeOutputPath) {
    failures.push("bridge_metadata_stale:exported_path");
  }

  let currentSfxSignature = "";
  let bridgeSfxSignature = selectedSfxAssetSignature(story.sfx_manifest || story.sound_transition_plan?.sfx || {});
  const sfxManifestPath = artifactDir ? path.join(artifactDir, "sfx_manifest.json") : "";
  if (sfxManifestPath && await fs.pathExists(path.resolve(sfxManifestPath))) {
    try {
      const currentSfxManifest = await fs.readJson(path.resolve(sfxManifestPath));
      currentSfxSignature = selectedSfxAssetSignature(currentSfxManifest);
      if (currentSfxSignature && bridgeSfxSignature && currentSfxSignature !== bridgeSfxSignature) {
        failures.push("bridge_metadata_stale:sfx_manifest_selected_assets");
      }
    } catch {
      // The bridge freshness gate already blocks stale evidence when it can be
      // read. Other required-input gates own missing or malformed SFX files.
    }
  }

  return {
    result: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    evidence: {
      render_manifest_path: manifestPath,
      sfx_manifest_path: sfxManifestPath || null,
      bridge_duration_seconds: bridgeDuration,
      render_manifest_duration_seconds: manifestDuration,
      bridge_sfx_signature: bridgeSfxSignature || null,
      current_sfx_signature: currentSfxSignature || null,
    },
  };
}

async function audioSegmentPreflightForStory(story = {}) {
  const embedded =
    story.audio_segment_loudness_report ||
    story.render_audio_segment_report ||
    story.audio_segment_report ||
    null;
  if (embedded && typeof embedded === "object") {
    return {
      result: embedded.verdict === "pass" || embedded.status === "pass" ? "pass" : "fail",
      failures: asArray(embedded.blockers || embedded.failures),
      warnings: asArray(embedded.warnings),
      reason: embedded.reason || null,
    };
  }

  const explicitPath = cleanText(
    story.audio_segment_loudness_report_path || story.render_audio_segment_report_path,
  );
  const artifactDir = cleanText(
    story.scheduler_bridge_artifact_dir || story.artifact_dir || story.output_dir || story.package_dir,
  );
  const reportPath = explicitPath || (artifactDir ? path.join(artifactDir, "audio_segment_loudness_report.json") : "");
  if (!reportPath) {
    return {
      result: "fail",
      failures: ["audio_segment_loudness_report_missing"],
      warnings: [],
    };
  }
  try {
    const report = await fs.readJson(path.resolve(reportPath));
    return {
      result: report.verdict === "pass" || report.status === "pass" ? "pass" : "fail",
      failures: asArray(report.blockers || report.failures),
      warnings: asArray(report.warnings),
      reason: report.reason || null,
    };
  } catch {
    return {
      result: "fail",
      failures: ["audio_segment_loudness_report_missing"],
      warnings: [],
    };
  }
}

function numberFromFirst(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function localTtsSegmentationEvidence({ story = {}, report = {}, audioManifest = {}, timestampPayload = {} } = {}) {
  const meta = timestampPayload?.meta || timestampPayload?.alignment?.meta || {};
  const wordCounts = [
    ...asArray(meta.segment_word_counts),
    ...asArray(audioManifest.segment_word_counts),
    ...asArray(report.segment_word_counts),
  ]
    .map((value) => numberOrNull(value))
    .filter((value) => value != null);
  const explicitLocalTtsSegmented = Boolean(
    meta.segmentedLocalTtsMaterialized === true ||
      audioManifest.segmentedLocalTtsMaterialized === true ||
      report.segmentedLocalTtsMaterialized === true,
  );
  const segmentCount = numberFromFirst(
    meta.local_tts_segment_count,
    meta.tts_segment_count,
    audioManifest.local_tts_segment_count,
    audioManifest.tts_segment_count,
    report.local_tts_segment_count,
    report.tts_segment_count,
    explicitLocalTtsSegmented ? meta.segment_count : null,
    explicitLocalTtsSegmented ? audioManifest.segment_count : null,
    explicitLocalTtsSegmented ? report.segment_count : null,
    wordCounts.length ? wordCounts.length : null,
  );
  const segmented = Boolean(
    explicitLocalTtsSegmented ||
      (segmentCount != null && segmentCount > 1 && wordCounts.length > 1),
  );
  const provider = cleanText(
    story.voice_provider ||
      story.tts_provider ||
      audioManifest.voice_provider ||
      audioManifest.provider ||
      report.provider ||
      meta.provider ||
      "",
  ).toLowerCase();
  const local = Boolean(
    provider.includes("local") ||
      meta.localTts ||
      audioManifest.voice_provider === "local_tts" ||
      story.local_tts === true ||
      story.local_voice === true,
  );
  const minWords = wordCounts.length ? Math.min(...wordCounts) : null;
  const maxWords = wordCounts.length ? Math.max(...wordCounts) : null;
  const segmentGapS = numberFromFirst(meta.segment_gap_s, audioManifest.segment_gap_s, report.segment_gap_s);
  const continuityVerified = Boolean(
    meta.segment_voice_continuity_verified === true ||
      meta.local_tts_segment_voice_continuity_verified === true ||
      meta.voiceContinuity?.verified === true ||
      audioManifest.segment_voice_continuity_verified === true ||
      audioManifest.local_tts_segment_voice_continuity_verified === true ||
      report.segment_voice_continuity_verified === true ||
      report.local_tts_segment_voice_continuity_verified === true,
  );
  return {
    local,
    segmented,
    segment_count: segmentCount,
    min_segment_words: minWords,
    max_segment_words: maxWords,
    segment_gap_s: segmentGapS,
    continuity_verified: continuityVerified,
  };
}

function localTtsSegmentationFailures(evidence = {}) {
  if (!evidence.local || !evidence.segmented) return [];
  const failures = [];
  const count = Number(evidence.segment_count);
  const minWords = Number(evidence.min_segment_words);
  if (evidence.continuity_verified !== true && Number.isFinite(count) && count > 1) {
    failures.push("local_tts_segmented_voice_continuity_unverified");
  }
  if (
    (Number.isFinite(count) && count >= 10) ||
    (Number.isFinite(count) && count >= 8 && Number.isFinite(minWords) && minWords < 10)
  ) {
    failures.push("local_tts_micro_segmented_narration");
  }
  return failures;
}

function timestampWordsForCadence(payload = {}) {
  const words = Array.isArray(payload.words)
    ? payload.words
    : Array.isArray(payload.alignment?.words)
      ? payload.alignment.words
      : [];
  return words
    .map((word) => ({
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((word) =>
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start,
    );
}

function timestampCadenceEvidence(payload = {}) {
  const words = timestampWordsForCadence(payload);
  if (words.length < 20) return null;
  const firstStart = Math.min(...words.map((word) => word.start));
  const lastEnd = Math.max(...words.map((word) => word.end));
  const durationSeconds = lastEnd - firstStart;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return {
    word_count: words.length,
    duration_seconds: Number(durationSeconds.toFixed(3)),
    spoken_wpm: Number((words.length / (durationSeconds / 60)).toFixed(1)),
  };
}

function timestampCadenceFailures(cadence = {}, report = {}) {
  if (!cadence) return [];
  const thresholds = report.cadence?.thresholds || {};
  const minPublishable = numberOrNull(thresholds.min_publishable_wpm) ?? 110;
  const maxPublishable = numberOrNull(thresholds.max_publishable_wpm) ?? 175;
  const wpm = numberOrNull(cadence.spoken_wpm);
  if (wpm === null) return [];
  const failures = [];
  if (wpm < minPublishable) failures.push("voice_cadence:wpm_too_slow");
  if (wpm > maxPublishable) failures.push("voice_cadence:wpm_too_fast");
  return failures;
}

function timestampCadenceWarnings(cadence = {}, report = {}) {
  if (!cadence) return [];
  const warnings = [];
  const currentWpm = numberOrNull(cadence.spoken_wpm);
  const reportedWpm = numberOrNull(report.cadence?.spoken_wpm);
  if (currentWpm !== null && reportedWpm !== null && Math.abs(currentWpm - reportedWpm) >= 8) {
    warnings.push("voice_quality_report_cadence_stale");
  }
  const thresholds = report.cadence?.thresholds || {};
  const maxTarget = numberOrNull(thresholds.max_target_wpm) ?? 162;
  const minTarget = numberOrNull(thresholds.min_target_wpm) ?? 130;
  if (currentWpm !== null && currentWpm > maxTarget) warnings.push("voice_cadence:above_target_wpm");
  if (currentWpm !== null && currentWpm < minTarget) warnings.push("voice_cadence:below_target_wpm");
  return warnings;
}

async function voiceQualityPreflightForStory(story = {}) {
  const embedded =
    story.voice_quality_report ||
    story.narration_voice_quality_report ||
    story.voiceQualityReport ||
    null;
  const explicitPath = cleanText(
    story.voice_quality_report_path || story.narration_voice_quality_report_path,
  );
  const artifactDir = artifactDirForStory(story);
  const reportPath = explicitPath || (artifactDir ? path.join(artifactDir, "voice_quality_report.json") : "");

  let report = embedded && typeof embedded === "object" ? embedded : null;
  if (!report && reportPath) {
    try {
      report = await fs.readJson(path.resolve(reportPath));
    } catch {
      report = null;
    }
  }
  if (!report) return null;

  const audioManifest = firstObjectValue(
    story.audio_manifest,
    story.final_audio_manifest,
    await readArtifactJsonObjectForStory(story, "audio_manifest.json"),
  );
  const timestampEvidence = await readTimestampPayloadForStory(story);
  const segmentationEvidence = localTtsSegmentationEvidence({
    story,
    report,
    audioManifest,
    timestampPayload: timestampEvidence.payload || {},
  });
  const segmentationFailures = localTtsSegmentationFailures(segmentationEvidence);
  const currentCadence = timestampCadenceEvidence(timestampEvidence.payload || {});
  const currentCadenceFailures = timestampCadenceFailures(currentCadence, report);
  const currentCadenceWarnings = timestampCadenceWarnings(currentCadence, report);
  const verdict = cleanText(report.verdict || report.status || report.result).toLowerCase();
  const blockers = [
    ...asArray(report.blockers || report.failures),
    ...asArray(report.cadence?.blockers),
    ...segmentationFailures,
    ...currentCadenceFailures,
  ].map(cleanText).filter(Boolean);
  const warnings = [
    ...asArray(report.warnings),
    ...asArray(report.cadence?.warnings),
    ...currentCadenceWarnings,
  ].map(cleanText).filter(Boolean);
  const failed =
    blockers.length > 0 ||
    ["fail", "failed", "blocked", "red"].includes(verdict);

  return {
    result: failed ? "fail" : "pass",
    failures: [...new Set(blockers.length ? blockers : failed ? ["voice_quality_not_pass"] : [])],
    warnings: [...new Set(warnings)],
    evidence: {
      voice_quality_report_path: reportPath || null,
      verdict: report.verdict || report.status || report.result || null,
      spoken_wpm: numberOrNull(report.cadence?.spoken_wpm),
      ...(currentCadence
        ? {
            current_spoken_wpm: currentCadence.spoken_wpm,
            current_word_timestamp_count: currentCadence.word_count,
            current_timing_duration_seconds: currentCadence.duration_seconds,
          }
        : {}),
      ...(segmentationEvidence.segmented
        ? {
            local_tts_segment_count: segmentationEvidence.segment_count,
            local_tts_min_segment_words: segmentationEvidence.min_segment_words,
            local_tts_max_segment_words: segmentationEvidence.max_segment_words,
            local_tts_segment_gap_s: segmentationEvidence.segment_gap_s,
          }
        : {}),
    },
  };
}

function firstObjectValue(...values) {
  for (const value of values) {
    const parsed = objectValue(value, null);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return {};
}

function timestampPathCandidatesForStory(story = {}, audioManifest = {}) {
  return [
    story.word_timestamps_path,
    story.timestamps_path,
    story.timestamp_path,
    audioManifest.word_timestamps_path,
    audioManifest.timestamps_path,
    audioManifest.resolved_timestamps_path,
  ].map(cleanText).filter(Boolean);
}

function artifactDirForStory(story = {}) {
  return cleanText(
    story.scheduler_bridge_artifact_dir ||
      story.artifact_dir ||
      story.output_dir ||
      story.package_dir,
  );
}

async function resolveReadableTimestampPath(candidate = "", artifactDir = "") {
  const raw = cleanText(candidate);
  if (!raw || /^local:\/\//i.test(raw)) return "";
  const attempts = [];
  if (path.isAbsolute(raw)) {
    attempts.push(raw);
  } else {
    try {
      const mediaPaths = require("../lib/media-paths");
      const mediaResolved = await mediaPaths.resolveExisting(raw).catch(() => "");
      if (mediaResolved) attempts.push(mediaResolved);
    } catch {
      // Optional media-root resolution should not make read-only preflight crash.
    }
    if (artifactDir) attempts.push(path.resolve(artifactDir, raw));
    attempts.push(path.resolve(raw));
  }
  for (const attempt of [...new Set(attempts.filter(Boolean))]) {
    if (await fs.pathExists(attempt)) return attempt;
  }
  return "";
}

async function readTimestampPayloadForStory(story = {}) {
  const inlinePayload = firstObjectValue(
    story.word_timestamps_payload,
    story.timestamps_payload,
    story.word_timestamps,
    story.timestamps,
  );
  if (Object.keys(inlinePayload).length) {
    return { payload: inlinePayload, path: null, requested: true, loaded: true };
  }

  const audioManifest = firstObjectValue(story.audio_manifest, story.final_audio_manifest);
  const artifactDir = artifactDirForStory(story);
  const candidates = timestampPathCandidatesForStory(story, audioManifest);
  for (const candidate of candidates) {
    const resolved = await resolveReadableTimestampPath(candidate, artifactDir);
    if (!resolved) continue;
    try {
      return {
        payload: await fs.readJson(resolved),
        path: resolved,
        requested: true,
        loaded: true,
      };
    } catch {
      return { payload: null, path: resolved, requested: true, loaded: false };
    }
  }
  return {
    payload: null,
    path: null,
    requested: candidates.length > 0,
    loaded: false,
  };
}

function timestampSourceForPayload(payload = {}, story = {}) {
  return cleanText(
    story.word_timestamp_source ||
      story.wordTimestampSource ||
      story.timestamp_source ||
      payload?.meta?.wordTimestampSource ||
      payload?.meta?.word_timestamp_source ||
      payload?.wordTimestampSource ||
      payload?.word_timestamp_source,
  );
}

function voiceProviderForTimestampGate(story = {}) {
  const audioManifest = firstObjectValue(story.audio_manifest, story.final_audio_manifest);
  return cleanText(
    story.voice_provider ||
      story.tts_provider ||
      story.narration_provider ||
      audioManifest.voice_provider ||
      audioManifest.provider,
  ).toLowerCase();
}

function localVoiceTimingRequired({ story = {}, source = "" } = {}) {
  const provider = voiceProviderForTimestampGate(story);
  const lowerSource = cleanText(source).toLowerCase();
  return (
    provider === "local" ||
    provider === "local_tts" ||
    provider === "existing_local_audio" ||
    provider.startsWith("local_") ||
    story.local_tts === true ||
    story.local_voice === true ||
    lowerSource.startsWith("local_")
  );
}

function timestampPayloadAsrAligned(payload = {}, source = "", story = {}) {
  const lowerSource = cleanText(source).toLowerCase();
  return Boolean(
    lowerSource === "local_whisper_word_alignment" ||
      lowerSource === "whisper_word_alignment" ||
      story.word_timestamps_asr_aligned === true ||
      story.asr_aligned_word_timestamps === true ||
      payload?.meta?.timestampWhisperAlignment?.repaired === true ||
      payload?.timestampWhisperAlignment?.repaired === true,
  );
}

function timestampWordsForPayload(payload = {}) {
  if (Array.isArray(payload?.words)) {
    return payload.words
      .map((word) => ({
        text: cleanText(word?.word || word?.text || word?.token),
        start: numberOrNull(word?.start ?? word?.start_s ?? word?.start_time),
        end: numberOrNull(word?.end ?? word?.end_s ?? word?.end_time),
      }))
      .filter((word) => word.text && word.start != null && word.end != null && word.end >= word.start);
  }
  return characterAlignmentToSubtitleWords(payload?.alignment || payload);
}

function timestampInspectionDurationSeconds(story = {}, payload = {}, words = []) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  const maxWordEnd = Math.max(0, ...words.map((word) => Number(word.end)).filter(Number.isFinite));
  const durationMetadataIgnored = Boolean(meta?.timestampDurationMetadataIgnored);
  const candidates = durationMetadataIgnored
    ? [
        storyDurationSeconds(story),
        numberOrNull(meta?.timestampDurationMetadataIgnored?.last_word_end_s),
        maxWordEnd,
      ]
    : [
        numberOrNull(meta?.acoustic?.durationSeconds),
        numberOrNull(meta?.durationSeconds),
        numberOrNull(meta?.audio_duration_seconds),
        numberOrNull(meta?.audioDurationSeconds),
        numberOrNull(payload?.duration_seconds),
        numberOrNull(payload?.durationSeconds),
        storyDurationSeconds(story),
        maxWordEnd,
      ];
  return candidates.find((value) => Number.isFinite(value) && value > 0) || null;
}

function timestampTimingInspectionForPayload(payload = {}, story = {}) {
  const words = timestampWordsForPayload(payload);
  const duration = timestampInspectionDurationSeconds(story, payload, words);
  const inspection = inspectSubtitleTimingWords(words, duration, {
    maxGapLimitSeconds: 2.2,
    maxTrailingGapSeconds: 1.0,
    maxZeroDurationWordRatio: 0.04,
    maxNonMonotonicWords: 0,
  });
  return {
    words,
    duration,
    inspection,
    evidence: {
      word_timestamp_word_count: inspection.wordCount,
      word_timestamp_timing_reason: inspection.reason,
      word_timestamp_max_gap_seconds: inspection.maxGapSeconds,
      word_timestamp_zero_duration_ratio: inspection.zeroDurationWordRatio,
      word_timestamp_trailing_gap_seconds: inspection.trailingGapSeconds,
      word_timestamp_coverage_ratio: inspection.coverageRatio,
    },
  };
}

function localTtsSpeakingRateForPayload(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  const values = [
    meta?.localTts?.speakingRate,
    meta?.localTts?.speaking_rate,
    meta?.voiceDiagnostics?.effective_rate,
    meta?.voiceDiagnostics?.effectiveRate,
    meta?.speakingRate,
    meta?.speaking_rate,
  ];
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function formatRateForBlocker(value) {
  return Number(value).toFixed(2);
}

async function timestampAlignmentPreflightForStory(story = {}) {
  if (!shouldRunIncidentGuardForStory(story)) return null;
  const artifactDir = artifactDirForStory(story);
  const sourceHint = timestampSourceForPayload({}, story);
  const requiresLocalTiming = localVoiceTimingRequired({ story, source: sourceHint });
  const timestampEvidence = await readTimestampPayloadForStory(story);

  if (!timestampEvidence.loaded) {
    if (artifactDir || requiresLocalTiming) {
      return {
        result: "fail",
        failures: [timestampEvidence.requested ? "word_timestamps_payload_unreadable" : "word_timestamps_path_missing"],
        warnings: [],
        evidence: {
          word_timestamp_alignment_required: requiresLocalTiming
            ? "local_whisper_word_alignment"
            : null,
        },
      };
    }
    return null;
  }

  const payload = timestampEvidence.payload || {};
  const source = timestampSourceForPayload(payload, story);
  const requiresLocalTimingForPayload = localVoiceTimingRequired({ story, source });
  if (!requiresLocalTimingForPayload) {
    return {
      result: "pass",
      failures: [],
      warnings: [],
      evidence: source ? { word_timestamp_source: source } : {},
    };
  }

  const localTtsSpeakingRate = localTtsSpeakingRateForPayload(payload);
  const minNativeLocalTtsRate = 0.9;
  if (localTtsSpeakingRate != null && localTtsSpeakingRate < minNativeLocalTtsRate) {
    return {
      result: "fail",
      failures: [`local_tts_speaking_rate_below_native:${formatRateForBlocker(localTtsSpeakingRate)}`],
      warnings: [],
      evidence: {
        word_timestamp_source: source || "unknown",
        word_timestamp_alignment_required: "local_whisper_word_alignment",
        word_timestamps_path: timestampEvidence.path || null,
        local_tts_speaking_rate: localTtsSpeakingRate,
        local_tts_min_native_rate: minNativeLocalTtsRate,
      },
    };
  }

  if (timestampPayloadAsrAligned(payload, source, story)) {
    const timing = timestampTimingInspectionForPayload(payload, story);
    const baseEvidence = {
      word_timestamp_source: source || "local_whisper_word_alignment",
      word_timestamp_alignment_required: "local_whisper_word_alignment",
      ...timing.evidence,
    };
    if (!timing.inspection.usable) {
      return {
        result: "fail",
        failures: [`word_timestamps_timing_unusable:${timing.inspection.reason}`],
        warnings: [],
        evidence: {
          ...baseEvidence,
          word_timestamps_path: timestampEvidence.path || null,
        },
      };
    }
    return {
      result: "pass",
      failures: [],
      warnings: [],
      evidence: baseEvidence,
    };
  }

  return {
    result: "fail",
    failures: ["word_timestamps_not_asr_aligned"],
    warnings: [],
    evidence: {
      word_timestamp_source: source || "unknown",
      word_timestamp_alignment_required: "local_whisper_word_alignment",
      word_timestamps_path: timestampEvidence.path || null,
    },
  };
}

function cloneStoryForPreflight(story = {}) {
  if (!story || typeof story !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(story));
  } catch {
    return { ...story };
  }
}

async function readBridgeArtifactJson(story = {}, fileName = "") {
  const artifactDir = cleanText(
    story.scheduler_bridge_artifact_dir || story.artifact_dir || story.output_dir || story.package_dir,
  );
  if (!artifactDir || !fileName) return null;
  const filePath = path.resolve(artifactDir, fileName);
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function platformManifestForMediaHousePreflight(story = {}) {
  const embedded = objectValue(story.platform_publish_manifest || story.platformManifest, {});
  const artifact = await readBridgeArtifactJson(story, "platform_publish_manifest.json");
  if (artifact && typeof artifact === "object" && Object.keys(artifact).length) return artifact;
  return embedded;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function publicCopyManifestForStory(story = {}) {
  const script = cleanText(story.narration_script || story.full_script || story.tts_script);
  return {
    canonical_subject: cleanText(story.canonical_subject || story.canonical_game),
    canonical_game: cleanText(story.canonical_game),
    selected_title: cleanText(
      story.selected_title ||
        story.public_title ||
        story.upload_title ||
        story.suggested_title ||
        story.title,
    ),
    first_spoken_line: cleanText(
      story.first_spoken_line ||
        story.narration_hook ||
        story.hook ||
        firstSentence(script),
    ),
    narration_script: script,
    description: cleanText(story.description),
    thumbnail_headline: cleanText(story.suggested_thumbnail_text || story.thumbnail_text || story.thumbnail_headline),
    primary_source: story.primary_source || story.source_card_label || story.source_name || null,
    primary_source_url: cleanText(story.primary_source_url || story.source_url || story.article_url || story.url),
    discovery_source: story.discovery_source || null,
    official_source: story.official_source || story.official_confirmation_source || null,
    secondary_sources: Array.isArray(story.secondary_sources) ? story.secondary_sources : [],
    confirmed_claims: asArray(story.confirmed_claims),
    unconfirmed_claims: asArray(story.unconfirmed_claims),
    prohibited_claims: asArray(story.prohibited_claims),
    claim_inventory: objectValue(story.claim_inventory, {}),
  };
}

function summarisePublicCopyQaResult(result = {}) {
  const failures = Array.isArray(result.failures) ? result.failures : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return {
    result: result.verdict === "fail" ? "fail" : "pass",
    failures: failures.map((failure) => String(failure).replace(/^public_copy:/, "")),
    warnings: warnings.map((warning) => String(warning).replace(/^public_copy:/, "")),
  };
}

function objectValue(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function rightsLedgerRecords(value = null) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return rightsLedgerRecords(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  return [
    ...asArray(value.assets),
    ...asArray(value.records),
    ...asArray(value.rights_ledger),
  ];
}

function clipKeyValues(clip = {}) {
  return [
    clip.asset_id,
    clip.id,
    clip.path,
    clip.local_path,
    clip.local_materialized_path,
    clip.media_path,
    clip.source_url,
  ]
    .map(cleanText)
    .filter(Boolean)
    .map((value) => value.replace(/\\/g, "/").toLowerCase());
}

function recordCoversClip(record = {}, clip = {}) {
  const recordKeys = new Set(clipKeyValues(record));
  return clipKeyValues(clip).some((key) => recordKeys.has(key));
}

function ownedExplainerMotionReadyForStory(story = {}) {
  const footageInventory = objectValue(story.footage_inventory, {});
  const budget = footageInventory.motion_budget || {};
  const inventory = footageInventory.motion_inventory || {};
  const explicitPlan =
    budget.allow_owned_explainer_motion_only === true ||
    budget.owned_explainer_visual_plan === true ||
    inventory.owned_explainer_visual_plan === true;
  if (!explicitPlan) return false;
  const clips = [
    ...asArray(story.visual_v4_bridge_video_clips),
    ...asArray(story.video_clips),
    ...asArray(inventory.accepted_local_clips),
    ...asArray(inventory.production_motion_clips),
  ].filter((clip) => clip && typeof clip === "object");
  const ownedClips = clips.filter((clip) => {
    const text = [
      clip.source_type,
      clip.source_kind,
      clip.media_kind,
      clip.rights_risk_class,
      clip.licence_basis,
      clip.rights_basis,
      clip.source_url,
      clip.path,
    ]
      .map(cleanText)
      .join(" ")
      .toLowerCase();
    return (
      clip.owned_explainer_visual_plan === true ||
      text.includes("owned_explainer_motion") ||
      text.includes("owned_source_card_explainer_motion") ||
      text.includes("owned_generated_editorial_motion_graphic")
    );
  });
  const families = new Set(
    ownedClips
      .map((clip) => cleanText(clip.motion_family || clip.source_family || clip.visual_family || clip.family || clip.id))
      .filter(Boolean),
  );
  const rightsRecords = rightsLedgerRecords(story.rights_ledger || story.rights_records);
  const rightsCovered = ownedClips.every((clip) =>
    rightsRecords.some((record) => {
      const rightsText = [
        record.licence_basis,
        record.license_basis,
        record.rights_basis,
        record.approval_status,
        record.asset_type,
        record.source_type,
      ]
        .map(cleanText)
        .join(" ")
        .toLowerCase();
      return (
        recordCoversClip(record, clip) &&
        rightsText.includes("owned_generated_editorial_motion_graphic") &&
        record.commercial_use_allowed !== false
      );
    }),
  );
  return ownedClips.length >= 5 && families.size >= 5 && rightsCovered;
}

function ownedExplainerExceptionApprovedForStory(story = {}, renderManifest = {}) {
  return Boolean(
    story.breaking_news_flag === true ||
      renderManifest.breaking_news_flag === true ||
      story.human_reviewed_owned_explainer_motion_exception === true ||
      story.owned_explainer_motion_exception_approved === true ||
      renderManifest.human_reviewed_owned_explainer_motion_exception === true ||
      renderManifest.owned_explainer_motion_exception_approved === true,
  );
}

function sourceNameValue(value) {
  if (value && typeof value === "object") return cleanText(value.name || value.source_name || value.label);
  return cleanText(value);
}

function sourceUrlValue(value) {
  if (value && typeof value === "object") return cleanText(value.url || value.source_url || value.href);
  return cleanText(value);
}

function sourceUrlFamilyKey(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return "";
  }
}

function directMotionReadinessFamily(clip = {}, index = 0) {
  if (typeof clip === "string") return path.basename(cleanText(clip), path.extname(cleanText(clip)));
  const sourceKey = sourceUrlFamilyKey(
    clip.source_url ||
      clip.url ||
      clip.original_source_url ||
      clip.reference_url ||
      clip.source,
  );
  const mediaKind = cleanText(clip.media_kind || clip.source_url_kind || clip.source_kind || clip.source_type).toLowerCase();
  const directMotion =
    mediaKind.includes("direct_video") ||
    mediaKind.includes("hls_manifest") ||
    mediaKind.includes("dash_manifest") ||
    mediaKind.includes("official_platform_product_page") ||
    mediaKind.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv)(?:$|[?#])/i.test(cleanText(clip.path || clip.media_path || clip.local_path || clip.source_url || clip.url));
  if (directMotion && sourceKey) return sourceKey;
  const baseFamily = cleanText(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return cleanText(
    clip.source_family ||
      clip.motion_family ||
      clip.visual_family ||
      clip.family ||
      clip.id ||
      `motion_family_${index + 1}`,
  );
}

function sourceLooksEditoriallyVerified(story = {}) {
  const sourceName = sourceNameValue(story.primary_source || story.source_card_label || story.official_source);
  const sourceUrl =
    (story.primary_source && typeof story.primary_source === "object"
      ? sourceUrlValue(story.primary_source)
      : "") ||
    sourceUrlValue(story.primary_source_url || story.source_url || story.article_url || story.url);
  if (!sourceName || /reddit|unknown|source needed/i.test(sourceName)) return false;
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/reddit\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) return false;
  } catch {
    return false;
  }
  return true;
}

function ownedExplainerPolicyApprovedForStory(story = {}) {
  const footageInventory = objectValue(story.footage_inventory, {});
  const budget = footageInventory.motion_budget || {};
  const inventory = footageInventory.motion_inventory || {};
  const explicitOwnedExplainerPlan =
    budget.allow_owned_explainer_motion_only === true &&
    (budget.owned_explainer_visual_plan === true || inventory.owned_explainer_visual_plan === true);
  if (!explicitOwnedExplainerPlan) return false;
  const subject = cleanText(story.canonical_subject || story.canonical_game || story.canonical_company);
  if (!subject || /^(?:this story|gaming story|story|news|update)$/i.test(subject)) return false;
  return sourceLooksEditoriallyVerified(story);
}

function shouldRunIncidentGuardForStory(story = {}) {
  return Boolean(
    story.scheduler_bridge_source ||
      story.visual_v4_render_bridge_status ||
      story.require_incident_guard === true,
  );
}

function uniqueMotionFamilies(story = {}) {
  const clips = [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_bridge_video_clips),
  ];
  return new Set(
    clips
      .map((clip, index) => directMotionReadinessFamily(clip, index))
      .filter(Boolean),
  );
}

function incidentGuardFileEvidenceForStory(story = {}) {
  const clipRows = [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_bridge_video_clips),
  ];
  const families = uniqueMotionFamilies(story);
  const clipCount = Math.max(
    Number(story.visual_v4_render_bridge_clip_count || 0),
    clipRows.length,
  );
  const rightsRecords = rightsLedgerRecords(story.rights_ledger || story.rights_records);
  return {
    mp4_ready: Boolean(story.exported_path),
    captions_ready: Boolean(story.manual_caption_path || story.caption_path || story.clean_manual_captions),
    narration_ready: Boolean(story.audio_path || story.voice_report_path || story.final_voice_report_path),
    word_timestamps_ready: Boolean(
      story.timestamps_path ||
        story.word_timestamps_path ||
        story.subtitle_timing_source === "timestamps" ||
        Number(story.word_timestamp_count) > 0,
    ),
    materialised_motion_ready: clipCount >= 3,
    distinct_motion_families_ready:
      families.size >= 3 ||
      (clipRows.length === 0 && Number(story.distinct_motion_family_count) >= 3),
    rights_ledger_ready: rightsRecords.length > 0,
  };
}

function materialisedMotionEvidenceClipsForStory({
  story = {},
  ownedMotionManifest = {},
  materialisedMotionClips = {},
} = {}) {
  return [
    ...asArray(story.materialised_motion_clips),
    ...asArray(story.motion_clips),
    ...asArray(ownedMotionManifest.materialised_clips),
    ...asArray(ownedMotionManifest.clips),
    ...asArray(ownedMotionManifest.assets),
    ...asArray(
      Array.isArray(materialisedMotionClips)
        ? materialisedMotionClips
        : materialisedMotionClips.clips || materialisedMotionClips.materialised_clips,
    ),
  ];
}

async function visualLoopPreflightForStory(story = {}, renderManifest = {}) {
  const [
    renderStoryArtifact,
    directorArtifact,
    ownedMotionArtifact,
    materialisedMotionArtifact,
  ] = await Promise.all([
    readArtifactJsonObjectForStory(story, "visual_v4_render_story.json"),
    readArtifactJsonObjectForStory(story, "director_beat_map.json"),
    readArtifactJsonObjectForStory(story, "owned_motion_manifest.json"),
    readArtifactJsonObjectForStory(story, "materialised_motion_clips.json"),
  ]);
  const renderStory = {
    ...renderStoryArtifact,
    video_clips: [
      ...asArray(story.video_clips),
      ...asArray(renderStoryArtifact.video_clips),
    ],
    visual_v4_bridge_video_clips: [
      ...asArray(story.visual_v4_bridge_video_clips),
      ...asArray(renderStoryArtifact.visual_v4_bridge_video_clips),
    ],
  };
  const directorArtifactHasShots = asArray(directorArtifact.shot_plan || directorArtifact.shots).length > 0;
  const directorBeatMap = directorArtifactHasShots
    ? directorArtifact
    : objectValue(
        story.director_beat_map ||
          story.visual_v4_director_plan ||
          story.director_plan,
        directorArtifact,
      );
  const materialisedMotion = materialisedMotionEvidenceClipsForStory({
    story,
    ownedMotionManifest: objectValue(story.owned_motion_manifest, ownedMotionArtifact),
    materialisedMotionClips: objectValue(story.materialised_motion_clips_manifest, materialisedMotionArtifact),
  });
  const directMotionSegmentEvidenceSource = materialisedMotion.length
    ? materialisedMotion
    : [
        ...asArray(renderStory.visual_v4_bridge_video_clips),
        ...asArray(renderStory.video_clips),
      ];
  const finalRenderVisualReuse = finalRenderVisualReuseEvidence({ renderManifest, renderStory });
  const hyperframesReadableDwell = hyperframesReadableDwellEvidence({
    renderManifest,
    renderStory,
    directorBeatMap,
  });
  const directMotionBaseSourceOveruse = directMotionBaseSourceOveruseEvidence(directMotionSegmentEvidenceSource);
  const blockers = [
    ...finalRenderVisualReuse.blockers,
    ...hyperframesReadableDwell.blockers,
    ...directMotionBaseSourceOveruse.blockers,
  ];
  return {
    result: blockers.length ? "fail" : "pass",
    failures: blockers,
    warnings: [],
    evidence: {
      file_evidence: {
        ...finalRenderVisualReuse.evidence,
        ...hyperframesReadableDwell.evidence,
        ...directMotionBaseSourceOveruse.evidence,
      },
    },
  };
}

async function incidentGuardPreflightForStory(story = {}) {
  if (!shouldRunIncidentGuardForStory(story)) return null;
  const { evaluateIncidentGuard } = require("../lib/incident-guard");
  const { visualEvidenceProfile } = require("../lib/visual-evidence-classifier");
  const embeddedRenderManifest = objectValue(story.render_manifest, {});
  const currentRenderManifest = await readCurrentRenderManifestForStory(story);
  const renderManifest = {
    ...embeddedRenderManifest,
    ...currentRenderManifest,
  };
  const renderLane = cleanText(renderManifest.render_lane || renderManifest.lane || story.render_lane);
  const renderClass = cleanText(
    renderManifest.render_quality_class ||
      renderManifest.quality_class ||
      renderManifest.visual_tier ||
      story.render_quality_class,
  );
  const report = evaluateIncidentGuard({
    story_id: story.id || story.story_id || "unknown",
    canonical_story_manifest: publicCopyManifestForStory(story),
    render_manifest: {
      ...renderManifest,
      final_publish_render:
        renderManifest.final_publish_render === true ||
        Boolean(story.exported_path && /visual_v4|studio_v4/i.test(renderLane)),
      render_lane: renderLane,
      render_quality_class: renderClass,
      visual_count:
        renderManifest.visual_count ||
        renderManifest.visuals_count ||
        story.qa_visual_count ||
        story.distinct_visual_count ||
        story.visual_v4_render_bridge_clip_count,
    },
    visual_quality_report: objectValue(story.visual_quality_report || story.visualQualityReport, {}),
    benchmark_report: objectValue(story.benchmark_report || story.media_house_benchmark || story.benchmarkReport, {}),
    publish_verdict: objectValue(story.publish_verdict, {}),
    platform_publish_manifest: objectValue(story.platform_publish_manifest, {}),
    platform_policy_report: objectValue(story.platform_policy_report, {}),
    landing_page_manifest: objectValue(story.landing_page_manifest, {}),
    affiliate_link_manifest: objectValue(story.affiliate_link_manifest, {}),
    sfx_manifest: objectValue(story.sfx_manifest || story.sound_transition_plan?.sfx, {}),
    file_evidence: incidentGuardFileEvidenceForStory(story),
  });
  const visualEvidence = visualEvidenceProfile({
    story,
    rightsLedger: story.rights_ledger || story.rights_records || {},
    footageInventory: objectValue(story.footage_inventory, {}),
    directorPlan: story.visual_v4_director_plan || story.director_plan || {},
  });
  const ownedExplainerReady = ownedExplainerMotionReadyForStory(story);
  const ownedExplainerExceptionApproved =
    ownedExplainerExceptionApprovedForStory(story, renderManifest) ||
    (ownedExplainerReady && ownedExplainerPolicyApprovedForStory(story));
  const generatedVisualFailures = asArray(visualEvidence.blockers).filter(
    (blocker) =>
      !ownedExplainerReady ||
      !ownedExplainerExceptionApproved ||
      ![
        "visual_evidence:generated_only_motion_deck",
        "visual_evidence:no_real_visual_media_asset",
        "visual_evidence:direct_video_motion_missing",
      ].includes(blocker),
  );
  const directMotionExceptionApproved =
    story.breaking_news_flag === true ||
    story.human_reviewed_direct_video_motion_exception === true ||
    story.direct_video_motion_exception_approved === true ||
    renderManifest.human_reviewed_direct_video_motion_exception === true ||
    renderManifest.direct_video_motion_exception_approved === true;
  const requiresDirectVideoMotion =
    !directMotionExceptionApproved &&
    !(ownedExplainerReady && ownedExplainerExceptionApproved) &&
    (
      /visual_v4/i.test(renderLane) ||
      /production_v4/i.test(cleanText(renderManifest.visual_tier || renderManifest.tier)) ||
      /premium/i.test(renderClass)
    );
  if (
    requiresDirectVideoMotion &&
    Number(visualEvidence.direct_video_motion_asset_count) < 1 &&
    !(ownedExplainerReady && ownedExplainerExceptionApproved)
  ) {
    generatedVisualFailures.push("visual_evidence:direct_video_motion_missing");
  }
  const visualLoop = await visualLoopPreflightForStory(story, {
    ...renderManifest,
    final_publish_render:
      renderManifest.final_publish_render === true ||
      Boolean(story.exported_path && /visual_v4|studio_v4/i.test(renderLane)),
    render_lane: renderLane,
    render_quality_class: renderClass,
  });
  const visualLoopFailures = asArray(visualLoop.failures);
  if (report.verdict === "pass" && !generatedVisualFailures.length && !visualLoopFailures.length) {
    return {
      result: "pass",
      failures: [],
      warnings: report.warnings || [],
      evidence: visualLoop.evidence,
    };
  }
  return {
    result: "fail",
    failures: [
      ...asArray(report.disaster_upload_blockers || ["incident_guard_failed"]),
      ...generatedVisualFailures,
      ...visualLoopFailures,
    ],
    warnings: report.warnings || [],
    evidence: {
      ...(visualLoop.evidence || {}),
    },
  };
}

async function mediaHousePreflightForStory(story = {}) {
  const { buildPulseMediaHouseScore } = require("../lib/pulse-media-house-score");
  const platformManifest = await platformManifestForMediaHousePreflight(story);
  const score = buildPulseMediaHouseScore({
    story_id: cleanText(story.id || story.story_id),
    canonical: {
      ...publicCopyManifestForStory(story),
      id: cleanText(story.id || story.story_id),
      story_id: cleanText(story.id || story.story_id),
      first_frame_text: cleanText(story.first_frame_text || story.cover_frame_text),
      thumbnail_headline: cleanText(
        story.suggested_thumbnail_text ||
          story.thumbnail_text ||
          story.thumbnail_headline ||
          story.cover_headline,
      ),
      suggested_thumbnail_text: cleanText(story.suggested_thumbnail_text),
    },
    scriptScorecard: objectValue(story.script_scorecard || story.scriptScorecard, {}),
    visualQuality: objectValue(story.visual_quality_report || story.visualQualityReport, {}),
    director: objectValue(story.director_beat_map || story.visual_v4_director_plan || story.director_plan, {}),
    audio: objectValue(story.audio_manifest || story.audio, {}),
    loudness: objectValue(story.audio_segment_loudness_report || story.loudness_report, {}),
    affiliate: objectValue(story.affiliate_link_manifest || story.affiliate, {}),
    platformManifest,
    benchmark: objectValue(story.benchmark_report || story.media_house_benchmark || story.benchmarkReport, {}),
    uniqueness: objectValue(story.uniqueness_report || story.uniqueness, {}),
    competitorSimilarity: objectValue(story.competitor_similarity_report || story.competitorSimilarity, {}),
    footageEmpireV2: objectValue(story.footage_empire_v2 || story.footageEmpireV2 || story.footage_empire, {}),
    distinctMotionFamily: objectValue(
      story.distinct_motion_family_report ||
        story.distinctMotionFamilyReport ||
        story.distinct_motion_family ||
        {},
    ),
  });
  const failures = asArray(score.hard_failures).map((failure) =>
    cleanText(failure).replace(/^media_house:/, ""),
  );
  return {
    result: failures.length ? "fail" : "pass",
    failures,
    warnings: asArray(score.warnings),
    evidence: {
      verdict: score.verdict,
      overall_media_house_score: score.scores?.overall_media_house_score ?? null,
      title_strength_score: score.scores?.title_strength_score ?? null,
      first_frame_score: score.scores?.first_frame_score ?? null,
      first_3_seconds_score: score.scores?.first_3_seconds_score ?? null,
      competitor_parity_score: score.scores?.competitor_parity_score ?? null,
      competitor_surpass_score: score.scores?.competitor_surpass_score ?? null,
      hard_failures: score.hard_failures,
    },
  };
}

async function runPreflightQaForStory(story = {}, opts = {}) {
  const {
    runContentQa = require("../lib/services/content-qa").runContentQa,
    runVideoQa = require("../lib/services/video-qa").runVideoQa,
    buildVideoQaOptionsForStory = require("../lib/services/video-qa").buildVideoQaOptionsForStory,
    runPlatformVideoQa = require("../lib/services/platform-video-qa").runPlatformVideoQa,
    runStudioGovernancePreflight = require("../lib/services/studio-governance-preflight").runStudioGovernancePreflight,
    runSourceAgeQa = sourceAgePreflightForStory,
    runPublicCopyQa = (manifest) => require("../lib/goal-public-copy-qa").evaluateGoalPublicCopy(manifest),
    runPublicMetadataQa = (qaStory, qaOptions = {}) => {
      const { collectPublicMetadataFailures } = require("../lib/public-metadata-qa");
      const failures = collectPublicMetadataFailures(qaStory, qaOptions);
      return {
        result: failures.length ? "fail" : "pass",
        failures,
        warnings: [],
      };
    },
    runIncidentGuard = incidentGuardPreflightForStory,
    runVoiceQualityQa = voiceQualityPreflightForStory,
    runAudioSegmentQa = audioSegmentPreflightForStory,
    runTimestampAlignmentQa = timestampAlignmentPreflightForStory,
    runVisualEntityQa = visualEntityPreflightForStory,
    runBridgeArtifactFreshnessQa = bridgeArtifactFreshnessPreflightForStory,
    runBridgeMotionGovernanceQa = bridgeMotionGovernancePreflightForStory,
    runAggregateBenchmarkQa = aggregateBenchmarkPreflightForStory,
    runScriptScorecardQa = scriptScorecardPreflightForStory,
    runMediaHouseQa = mediaHousePreflightForStory,
  } = opts;

  try {
    const contentStory = cloneStoryForPreflight(story);
    const videoStory = cloneStoryForPreflight(story);
    const platformStory = cloneStoryForPreflight(story);
    const governanceStory = cloneStoryForPreflight(story);
    const publicCopyStory = cloneStoryForPreflight(story);
    const publicMetadataStory = cloneStoryForPreflight(story);
    const sourceAge = await runSourceAgeQa(cloneStoryForPreflight(story), opts);
    const content = await runContentQa(contentStory, {
      blockThinVisuals: true,
      ...(opts.contentQaOptions || {}),
    });
    const video = await runVideoQa(
      videoStory.exported_path,
      buildVideoQaOptionsForStory(videoStory, opts.videoQaOptions || {}),
    );
    const platform = await runPlatformVideoQa(
      platformStory.exported_path,
      opts.platformVideoQaOptions || {},
    );
    const governance = await runStudioGovernancePreflight(
      governanceStory,
      schedulerStudioGovernanceOptions(opts),
    );
    const publicCopy = summarisePublicCopyQaResult(
      await runPublicCopyQa(publicCopyManifestForStory(publicCopyStory)),
    );
    const publicMetadata = await runPublicMetadataQa(publicMetadataStory, {
      surface: "scheduler_preflight",
      publicTitle:
        publicMetadataStory.public_title ||
        publicMetadataStory.upload_title ||
        publicMetadataStory.suggested_title ||
        publicMetadataStory.title,
      ...(opts.publicMetadataQaOptions || {}),
    });
    const incidentGuard = await runIncidentGuard(cloneStoryForPreflight(story));
    const voiceQuality = await runVoiceQualityQa(cloneStoryForPreflight(story));
    const audioSegment = await runAudioSegmentQa(cloneStoryForPreflight(story));
    const timestampAlignment = await runTimestampAlignmentQa(cloneStoryForPreflight(story));
    const visualEntityMatch = await runVisualEntityQa(cloneStoryForPreflight(story));
    const bridgeArtifactFreshness = story.scheduler_bridge_source
      ? await runBridgeArtifactFreshnessQa(cloneStoryForPreflight(story))
      : null;
    const bridgeMotionGovernance = story.scheduler_bridge_source
      ? await runBridgeMotionGovernanceQa(cloneStoryForPreflight(story), opts)
      : null;
    const aggregateBenchmark = story.scheduler_bridge_source
      ? await runAggregateBenchmarkQa(cloneStoryForPreflight(story), opts)
      : null;
    const scriptScorecard = await runScriptScorecardQa(cloneStoryForPreflight(story), opts);
    const mediaHouseInput = await platformManifestForMediaHousePreflight(story);
    const mediaHouse = opts.mediaHouseQaEnabled === true && Object.keys(mediaHouseInput).length
      ? await runMediaHouseQa(cloneStoryForPreflight(story), opts)
      : null;
    return combinePreflightQa({
      sourceAge,
      content,
      video,
      platform,
      governance,
      publicCopy,
      publicMetadata,
      incidentGuard,
      voiceQuality,
      audioSegment,
      timestampAlignment,
      visualEntityMatch,
      bridgeArtifactFreshness,
      bridgeMotionGovernance,
      aggregateBenchmark,
      scriptScorecard,
      mediaHouse,
    });
  } catch (err) {
    return {
      status: "blocked",
      blockers: [`preflight_exception:${err.code || err.name || "unknown"}`],
      warnings: [],
      checks: {
        content: { result: "unknown", failures: [], warnings: [] },
        video: { result: "unknown", failures: [], warnings: [] },
        platform: { result: "unknown", failures: [], warnings: [] },
        governance: { result: "unknown", failures: [], warnings: [] },
      },
    };
  }
}

async function attachPreflightQa(report = {}, stories = [], opts = {}) {
  const byId = new Map(
    (Array.isArray(stories) ? stories : [])
      .filter((story) => story && story.id)
      .map((story) => [String(story.id), story]),
  );
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  for (const candidate of candidates) {
    const story = byId.get(String(candidate.id || ""));
    if (!story) {
      candidate.preflight_qa = {
        status: "blocked",
        blockers: ["story_missing"],
        warnings: [],
      };
      candidate.status = "review";
      continue;
    }
    const preflight = await runPreflightQaForStory(story, opts);
    candidate.preflight_qa = preflight;
    if (preflight.status === "blocked") {
      const sourceAgeBlocked = asArray(preflight.blockers).some((blocker) =>
        /^source_age:/i.test(cleanText(blocker)),
      );
      const visualLoopBlocked = asArray(preflight.blockers).some((blocker) =>
        /(?:final_render_reuses_visual_units|card_visible_dwell_too_short|card_visible_dwell_missing|card_clip_dwell_missing|director_card_dwell_too_short|direct_motion_base_source_overused|repeated_direct_motion_segment)/i.test(
          cleanText(blocker),
        ),
      );
      if (!sourceAgeBlocked && !visualLoopBlocked) {
        const hydrated = hydrateCandidateFromCurrentProofPackage(
          {
            ...candidate,
            preflight_qa: preflight,
            source: {
              ...(candidate.source || {}),
              artifact_dir:
                candidate.source?.artifact_dir ||
                story.scheduler_bridge_artifact_dir ||
                story.artifact_dir ||
                story.package_dir,
              exported_path:
                candidate.source?.exported_path ||
                story.exported_path ||
                story.final_mp4_path ||
                story.final_render_path,
            },
          },
          enabledPublishPlatformNames(opts),
        );
        if (hydrated.current_proof_package?.status === "green") {
          Object.assign(candidate, hydrated);
          candidate.preflight_qa = {
            ...candidate.preflight_qa,
            superseded_preflight_qa: {
              status: preflight.status,
              blockers: asArray(preflight.blockers),
              warnings: asArray(preflight.warnings),
            },
          };
          continue;
        }
      }
      candidate.status = "review";
      candidate.penalties = [...new Set([...(candidate.penalties || []), "preflight_qa_blocked"])];
      candidate.reasons = [...new Set([...(candidate.reasons || []), "preflight_qa_blocked"])];
      if (Array.isArray(preflight.blockers) && preflight.blockers.includes("source_age:source_age_exceeds_policy")) {
        candidate.scheduler_quarantine = {
          status: "held",
          reason: "source_age_exceeds_policy",
          lane: "stale_source_backlog",
          safe_next_action: "replace_with_fresh_source_or_operator_approve_evergreen",
        };
        candidate.reasons = [...new Set([...(candidate.reasons || []), "scheduler_quarantine_stale_source"])];
      }
    } else {
      candidate.reasons = [...new Set([...(candidate.reasons || []), `preflight_qa_${preflight.status}`])];
    }
  }
  const schedulerQuarantined = candidates.filter((candidate) => candidate.scheduler_quarantine?.status === "held");
  const schedulerQuarantineReasons = schedulerQuarantined.reduce((acc, candidate) => {
    const reason = candidate.scheduler_quarantine?.reason || "unknown";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  report.preflight_qa = {
    enabled: true,
    mode: "read_only",
    candidates_checked: candidates.length,
    blocked: candidates.filter((candidate) => candidate.preflight_qa?.status === "blocked").length,
    warning: candidates.filter((candidate) => candidate.preflight_qa?.status === "warn").length,
    pass: candidates.filter((candidate) => candidate.preflight_qa?.status === "pass").length,
    scheduler_quarantined: schedulerQuarantined.length,
    scheduler_quarantine_reasons: schedulerQuarantineReasons,
    bridge_motion_governance: bridgeMotionGovernanceEvidenceSummary(
      opts.bridgeMotionGovernanceEvidence || {},
    ),
  };
  return report;
}

function normaliseStoryId(value) {
  const storyId = String(value || "").trim();
  return storyId || null;
}

function filterStoriesByStoryId(stories = [], storyId = null) {
  const requestedStoryId = normaliseStoryId(storyId);
  const rows = Array.isArray(stories) ? stories : [];
  if (!requestedStoryId) return rows;
  return rows.filter((story) => String(story?.id || "") === requestedStoryId);
}

async function attachStoryPreflight(report = {}, stories = [], storyId = null, opts = {}) {
  const requestedStoryId = normaliseStoryId(storyId);
  if (!requestedStoryId) return report;

  const story = (Array.isArray(stories) ? stories : []).find(
    (row) => String(row?.id || "") === requestedStoryId,
  );

  if (!story) {
    report.story_preflight = {
      enabled: true,
      mode: "read_only",
      story_id: requestedStoryId,
      status: "blocked",
      blockers: ["story_not_found"],
      warnings: [],
      checks: {},
    };
    return report;
  }

  const run = opts.runPreflightQaForStory || runPreflightQaForStory;
  const preflight = await run(story, opts);
  report.story_preflight = {
    enabled: true,
    mode: "read_only",
    story_id: requestedStoryId,
    title: String(story.title || "").slice(0, 180),
    status: preflight?.status || "blocked",
    blockers: Array.isArray(preflight?.blockers) ? preflight.blockers : [],
    warnings: Array.isArray(preflight?.warnings) ? preflight.warnings : [],
    checks: preflight?.checks || {},
  };
  return report;
}

function buildNextPublishCandidatesReport(stories, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const requestedStoryId = normaliseStoryId(options.storyId);
  const inputRows = Array.isArray(stories) ? stories : [];
  const rows = filterStoriesByStoryId(inputRows, requestedStoryId);
  const bridgeCount = bridgeCandidateCount(rows);
  const bridgeManifest = options.bridgeManifest
    ? normaliseBridgeManifest(options.bridgeManifest)
    : null;
  const explicitLimit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0;
  const bridgeCandidateTotal =
    bridgeManifest && bridgeManifest.candidate_count !== null
      ? Number(bridgeManifest.candidate_count || 0)
      : bridgeCount;
  const limit = explicitLimit
    ? Math.max(1, Number(options.limit))
    : Math.max(DEFAULT_LIMIT, bridgeCandidateTotal);
  const candidates = [];
  const excluded = [];
  let pendingAudioCount = 0;

  for (const story of rows) {
    if (!story || typeof story !== "object") continue;
    const reason = exclusionReason(story, options);
    if (reason) {
      if (reason.startsWith("pending_audio")) pendingAudioCount += 1;
      excluded.push({
        id: story.id || "unknown",
        title: String(story.title || "").slice(0, 180),
        reason,
        scheduler_bridge_source: story.scheduler_bridge_source || null,
      });
      continue;
    }
    candidates.push(scoreCandidate(story, options));
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const report = {
    generated_at: generatedAt,
    safety: {
      mode: "read_only",
      db_mutation: false,
      posting: false,
      oauth: false,
      token_printing: false,
    },
    analytics_source: options.analyticsPath || DEFAULT_ANALYTICS_PATH,
    analytics_summary: summariseAnalytics(options.analyticsText || ""),
    totals: {
      stories_seen: rows.length,
      candidates: candidates.length,
      excluded: excluded.length,
      returned: Math.min(limit, candidates.length),
      pending_audio: pendingAudioCount,
    },
    candidates: candidates.slice(0, limit),
    excluded: excludedRowsForReport(excluded, { limit }),
  };

  if (bridgeCount > 0 || bridgeManifest) {
    report.bridge_candidates = {
      count:
        bridgeManifest && bridgeManifest.candidate_count !== null
          ? bridgeManifest.candidate_count
          : bridgeCount,
      mode: bridgeManifest?.mode || "dry_run_overlay",
      status: bridgeManifest?.status || "loaded",
      authoritative: bridgeManifest?.authoritative === true,
      source: bridgeManifest?.source || "scheduler_bridge_candidates",
      path: bridgeManifest?.path || null,
      live_fallback_used: bridgeManifest?.live_fallback_used === true,
      live_db_rows_seen: Number(bridgeManifest?.live_db_rows_seen || 0),
      live_db_rows_considered: Number(bridgeManifest?.live_db_rows_considered || 0),
      live_db_rows_ignored: Number(bridgeManifest?.live_db_rows_ignored || 0),
      db_mutation: false,
    };
  }

  if (requestedStoryId) {
    report.story_filter = {
      story_id: requestedStoryId,
      matched: rows.length,
      input_stories_seen: inputRows.length,
    };
  }

  return report;
}

function excludedRowsForReport(excluded = [], { limit = DEFAULT_LIMIT } = {}) {
  const displayCap = Math.max(Number(limit) || DEFAULT_LIMIT, 20);
  const rows = [];
  const seen = new Set();
  function add(row) {
    const id = String(row?.id || "");
    if (!id || seen.has(id)) return;
    rows.push(row);
    seen.add(id);
  }
  for (const row of excluded.slice(0, displayCap)) add(row);
  for (const row of excluded) {
    const reason = String(row?.reason || "");
    if (row?.scheduler_bridge_source && /^already_has_public_platform_id:/i.test(reason)) {
      add(row);
    }
  }
  return rows;
}

function summariseAnalytics(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  let latestRecommendation = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const inline = line.match(/^#{0,6}\s*Tomorrow:\s*(.+)$/i);
    if (inline) {
      latestRecommendation = inline[1].trim();
      break;
    }
    if (/^#{0,6}\s*Tomorrow's recommendation\s*$/i.test(line)) {
      latestRecommendation =
        lines.slice(i + 1).map((next) => next.trim()).find((next) => next && !next.startsWith("#")) || null;
      break;
    }
  }
  return {
    available: String(text || "").trim().length > 0,
    latest_recommendation: latestRecommendation
      ? latestRecommendation.replace(/^#+\s*/, "").trim()
      : null,
    scoring_bias: [
      "named_people_or_companies",
      "corporate_drama",
      "concrete_outcome",
      "specific_detail",
      "penalise_speculation",
    ],
  };
}

function formatNextPublishCandidatesMarkdown(report = {}) {
  const lines = [];
  lines.push("# Next Publish Candidates");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- read-only");
  lines.push("- no posting");
  lines.push("- no OAuth");
  lines.push("- no token printing");
  lines.push("- no DB mutation");
  lines.push("");
  const totals = report.totals || {};
  lines.push("## Totals");
  lines.push(`- stories seen: ${Number(totals.stories_seen || 0)}`);
  lines.push(`- candidates: ${Number(totals.candidates || 0)}`);
  lines.push(`- excluded: ${Number(totals.excluded || 0)}`);
  if (Number(totals.pending_audio || 0) > 0) {
    lines.push(`- pending audio: ${Number(totals.pending_audio || 0)}`);
  }
  lines.push("");
  if (report.story_filter) {
    lines.push("## Story Filter");
    lines.push(`- story id: ${report.story_filter.story_id}`);
    lines.push(`- matched: ${Number(report.story_filter.matched || 0)}`);
    lines.push("");
  }
  if (report.bridge_candidates) {
    const bridge = report.bridge_candidates;
    lines.push("## Scheduler Bridge");
    lines.push(`- status: ${bridge.status || "unknown"}`);
    lines.push(`- mode: ${bridge.mode || "unknown"}`);
    lines.push(`- candidates: ${Number(bridge.count || 0)}`);
    lines.push(`- authoritative: ${bridge.authoritative ? "yes" : "no"}`);
    lines.push(`- live fallback: ${bridge.live_fallback_used ? "used" : "blocked"}`);
    if (Number(bridge.live_db_rows_ignored || 0) > 0) {
      lines.push(`- live DB rows ignored: ${Number(bridge.live_db_rows_ignored || 0)}`);
    }
    lines.push("");
  }
  if (report.story_preflight) {
    const preflight = report.story_preflight;
    lines.push("## Story Preflight");
    lines.push(`- story id: ${preflight.story_id || "unknown"}`);
    lines.push(`- status: ${preflight.status || "unknown"}`);
    if (Array.isArray(preflight.blockers) && preflight.blockers.length) {
      lines.push(`- blockers: ${preflight.blockers.join(", ")}`);
    }
    if (Array.isArray(preflight.warnings) && preflight.warnings.length) {
      lines.push(`- warnings: ${preflight.warnings.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## Analytics Bias");
  const summary = report.analytics_summary || {};
  lines.push(`- available: ${summary.available ? "yes" : "no"}`);
  if (summary.latest_recommendation) {
    lines.push(`- latest: ${summary.latest_recommendation}`);
  }
  lines.push("");
  lines.push("## Ranked Candidates");
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  if (!candidates.length) {
    lines.push("- none");
  } else {
    for (const [index, candidate] of candidates.entries()) {
      const duration =
        candidate.duration_seconds == null
          ? "unknown"
          : `${Number(candidate.duration_seconds).toFixed(2)}s`;
      const reasons = (candidate.reasons || []).slice(0, 6).join(", ");
      const penalties = (candidate.penalties || []).join(", ") || "none";
      const preflight = candidate.preflight_qa
        ? ` | preflight=${candidate.preflight_qa.status}`
        : "";
      lines.push(
        `${index + 1}. ${candidate.id} - ${candidate.score} - ${candidate.status} - ${duration}${preflight}`,
      );
      lines.push(`   ${candidate.title || ""}`);
      lines.push(`   reasons: ${reasons || "none"}`);
      lines.push(`   penalties: ${penalties}`);
      if (candidate.preflight_qa?.blockers?.length) {
        lines.push(`   preflight blockers: ${candidate.preflight_qa.blockers.join(", ")}`);
      }
      if (candidate.preflight_qa?.warnings?.length) {
        lines.push(`   preflight warnings: ${candidate.preflight_qa.warnings.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Excluded Sample");
  const excluded = Array.isArray(report.excluded) ? report.excluded : [];
  if (!excluded.length) {
    lines.push("- none");
  } else {
    for (const row of excluded.slice(0, 12)) {
      lines.push(`- ${row.id}: ${row.reason} - ${row.title || ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    json: false,
    help: false,
    limit: null,
    analyticsPath: DEFAULT_ANALYTICS_PATH,
    outDir: OUT,
    preflightQa: false,
    storyId: null,
    bridgeCandidatesPath: DEFAULT_BRIDGE_CANDIDATES_PATH,
    directVideoEnrichmentWorkOrderPath: DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH,
    sourceFamilyAcquisitionReportPath: DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH,
    upstreamBenchmarkReportPath: DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH,
    upstreamBenchmarkReportPathExplicit: false,
    upstreamAntiSpamReportPath: DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH,
    allowLiveFallback: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--preflight-qa" || arg === "--qa") args.preflightQa = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--limit") args.limit = Number(argv[++i] || DEFAULT_LIMIT);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1] || DEFAULT_LIMIT);
    else if (arg === "--analytics") args.analyticsPath = argv[++i] || args.analyticsPath;
    else if (arg.startsWith("--analytics=")) args.analyticsPath = arg.slice("--analytics=".length);
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) {
      args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    }
    else if (arg === "--no-bridge" || arg === "--no-bridge-candidates") {
      args.bridgeCandidatesPath = null;
    }
    else if (arg === "--allow-live-fallback") args.allowLiveFallback = true;
    else if (arg === "--bridge-candidates" || arg === "--bridge") {
      args.bridgeCandidatesPath = argv[++i] || null;
    }
    else if (arg.startsWith("--bridge-candidates=")) {
      args.bridgeCandidatesPath = arg.slice("--bridge-candidates=".length);
    }
    else if (arg.startsWith("--bridge=")) args.bridgeCandidatesPath = arg.slice("--bridge=".length);
    else if (arg === "--direct-video-work-order") {
      args.directVideoEnrichmentWorkOrderPath = argv[++i] || null;
    }
    else if (arg.startsWith("--direct-video-work-order=")) {
      args.directVideoEnrichmentWorkOrderPath = arg.slice("--direct-video-work-order=".length);
    }
    else if (arg === "--no-direct-video-work-order") {
      args.directVideoEnrichmentWorkOrderPath = null;
    }
    else if (arg === "--source-family-acquisition") {
      args.sourceFamilyAcquisitionReportPath = argv[++i] || null;
    }
    else if (arg.startsWith("--source-family-acquisition=")) {
      args.sourceFamilyAcquisitionReportPath = arg.slice("--source-family-acquisition=".length);
    }
    else if (arg === "--no-source-family-acquisition") {
      args.sourceFamilyAcquisitionReportPath = null;
    }
    else if (arg === "--upstream-benchmark-report" || arg === "--goal10-report") {
      args.upstreamBenchmarkReportPath = argv[++i] || null;
      args.upstreamBenchmarkReportPathExplicit = true;
    }
    else if (arg.startsWith("--upstream-benchmark-report=")) {
      args.upstreamBenchmarkReportPath = arg.slice("--upstream-benchmark-report=".length);
      args.upstreamBenchmarkReportPathExplicit = true;
    }
    else if (arg.startsWith("--goal10-report=")) {
      args.upstreamBenchmarkReportPath = arg.slice("--goal10-report=".length);
      args.upstreamBenchmarkReportPathExplicit = true;
    }
    else if (arg === "--no-upstream-benchmark-report" || arg === "--no-goal10-report") {
      args.upstreamBenchmarkReportPath = null;
      args.upstreamBenchmarkReportPathExplicit = true;
    }
    else if (arg === "--upstream-anti-spam-report" || arg === "--goal20-report") {
      args.upstreamAntiSpamReportPath = argv[++i] || null;
    }
    else if (arg.startsWith("--upstream-anti-spam-report=")) {
      args.upstreamAntiSpamReportPath = arg.slice("--upstream-anti-spam-report=".length);
    }
    else if (arg.startsWith("--goal20-report=")) {
      args.upstreamAntiSpamReportPath = arg.slice("--goal20-report=".length);
    }
    else if (arg === "--no-upstream-anti-spam-report" || arg === "--no-goal20-report") {
      args.upstreamAntiSpamReportPath = null;
    }
    else if (arg === "--story-id" || arg === "--story") args.storyId = normaliseStoryId(argv[++i]);
    else if (arg.startsWith("--story-id=")) args.storyId = normaliseStoryId(arg.slice("--story-id=".length));
    else if (arg.startsWith("--story=")) args.storyId = normaliseStoryId(arg.slice("--story=".length));
  }
  return args;
}

async function localGoal10ReportPathForBridge(bridgeCandidatesPath) {
  if (!bridgeCandidatesPath) return null;
  const bridgeDir = path.dirname(path.resolve(bridgeCandidatesPath));
  const localPath = path.join(bridgeDir, "goal10_readiness_report.json");
  if (await fs.pathExists(localPath)) return localPath;
  const parentDir = path.dirname(bridgeDir);
  const siblingPath = path.join(parentDir, "goal-10", "goal10_readiness_report.json");
  if (await fs.pathExists(siblingPath)) return siblingPath;
  return null;
}

async function resolveUpstreamBenchmarkReportPath(args = {}) {
  if (args.upstreamBenchmarkReportPathExplicit) return args.upstreamBenchmarkReportPath || null;
  const siblingPath = await localGoal10ReportPathForBridge(args.bridgeCandidatesPath);
  if (siblingPath) return siblingPath;
  return args.upstreamBenchmarkReportPath || null;
}

async function readAnalytics(pathname) {
  try {
    if (await fs.pathExists(pathname)) return fs.readFile(pathname, "utf8");
  } catch {
    // report as unavailable below
  }
  return "";
}

async function readOptionalJson(pathname) {
  if (!pathname) return null;
  try {
    const resolved = path.resolve(pathname);
    if (await fs.pathExists(resolved)) return fs.readJson(resolved);
  } catch {
    // Optional governance evidence should never make read-only preflight crash.
  }
  return null;
}

async function readBridgeCandidates(pathname) {
  return (await readBridgeCandidateManifest(pathname)).candidates;
}

async function readBridgeCandidateManifest(pathname) {
  if (!pathname) {
    return {
      candidates: [],
      requested: false,
      disabled: true,
      exists: false,
      path: null,
      status: "disabled",
    };
  }
  const resolved = path.resolve(pathname);
  try {
    if (!(await fs.pathExists(resolved))) {
      return {
        candidates: [],
        requested: true,
        disabled: false,
        exists: false,
        path: resolved,
        status: "missing",
      };
    }
    const value = await fs.readJson(resolved);
    const candidates = Array.isArray(value)
      ? value
      : Array.isArray(value?.candidates)
        ? value.candidates
        : [];
    return {
      candidates,
      requested: true,
      disabled: false,
      exists: true,
      path: resolved,
      status: "loaded",
      candidate_count: candidates.length,
    };
  } catch {
    return {
      candidates: [],
      requested: true,
      disabled: false,
      exists: true,
      path: resolved,
      status: "unreadable",
      candidate_count: 0,
    };
  }
}

async function loadStories() {
  const db = require("../lib/db");
  return db.getStories();
}

async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/next-publish-candidates.js [--json] [--limit N] [--analytics PATH] [--out-dir DIR] [--preflight-qa] [--story-id ID] [--bridge PATH|--no-bridge] [--direct-video-work-order PATH|--no-direct-video-work-order] [--source-family-acquisition PATH|--no-source-family-acquisition] [--allow-live-fallback]\n",
    );
    return { exitCode: 0 };
  }

  const upstreamBenchmarkReportPath = await resolveUpstreamBenchmarkReportPath(args);
  const [
    stories,
    analyticsText,
    bridgeManifest,
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
    upstreamBenchmarkReport,
    upstreamAntiSpamReport,
  ] = await Promise.all([
    loadStories(),
    readAnalytics(args.analyticsPath),
    readBridgeCandidateManifest(args.bridgeCandidatesPath),
    readOptionalJson(args.directVideoEnrichmentWorkOrderPath),
    readOptionalJson(args.sourceFamilyAcquisitionReportPath),
    readOptionalJson(upstreamBenchmarkReportPath),
    readOptionalJson(args.upstreamAntiSpamReportPath),
  ]);
  const bridgeMotionGovernanceEvidence = {
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
  };
  const selected = selectCandidateSourceStories({
    liveStories: stories,
    bridgeCandidates: bridgeManifest.candidates,
    bridgeManifest: {
      ...bridgeManifest,
      allowLiveFallback: args.allowLiveFallback,
    },
  });
  const mergedStories = selected.stories;
  const report = buildNextPublishCandidatesReport(mergedStories, {
    analyticsText,
    analyticsPath: args.analyticsPath,
    limit: args.limit,
    storyId: args.storyId,
    bridgeManifest: selected.bridge_manifest,
    upstreamAntiSpamReport,
  });
  if (args.preflightQa) {
    await attachPreflightQa(report, mergedStories, {
      bridgeMotionGovernanceEvidence,
      upstreamBenchmarkReport,
      mediaHouseQaEnabled: true,
    });
    await attachStoryPreflight(report, mergedStories, args.storyId, {
      bridgeMotionGovernanceEvidence,
      upstreamBenchmarkReport,
      mediaHouseQaEnabled: true,
    });
  }
  const markdown = formatNextPublishCandidatesMarkdown(report);
  await fs.ensureDir(args.outDir);
  const jsonPath = path.join(args.outDir, "next_publish_candidates.json");
  const mdPath = path.join(args.outDir, "next_publish_candidates.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(markdown);
  if (!args.json) {
    process.stderr.write(`[next-publish-candidates] json=${path.relative(ROOT, jsonPath)}\n`);
    process.stderr.write(`[next-publish-candidates] md=${path.relative(ROOT, mdPath)}\n`);
  }
  return { exitCode: 0, report };
}

if (require.main === module) {
  require("dotenv").config({ override: true });
  runCli().catch((err) => {
    process.stderr.write(`[next-publish-candidates] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BRIDGE_CANDIDATES_PATH,
  DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH,
  DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH,
  DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH,
  DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH,
  DEFAULT_SCRIPT_SCORE_THRESHOLD,
  buildNextPublishCandidatesReport,
  formatNextPublishCandidatesMarkdown,
  scoreCandidate,
  scoreAnalyticsFit,
  attachPreflightQa,
  attachStoryPreflight,
  aggregateBenchmarkPreflightForStory,
  audioSegmentPreflightForStory,
  bridgeArtifactFreshnessPreflightForStory,
  bridgeMotionGovernancePreflightForStory,
  cloneStoryForPreflight,
  combinePreflightQa,
  durationVerdict,
  existingPublicPlatformFields,
  filterStoriesByStoryId,
  mergeBridgeCandidates,
  mediaHousePreflightForStory,
  parseArgs,
  readBridgeCandidateManifest,
  readBridgeCandidates,
  readOptionalJson,
  resolveUpstreamBenchmarkReportPath,
  runPreflightQaForStory,
  scriptScorecardPreflightForStory,
  sourceAgePreflightForStory,
  selectCandidateSourceStories,
  timestampAlignmentPreflightForStory,
  visualEntityPreflightForStory,
  voiceQualityPreflightForStory,
  normaliseBridgeMotionGovernanceEvidence,
  summariseQaResult,
  runCli,
};
