"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { buildCandidateBuffer } = require("./normal-operations");
const { auditOneTranscript } = require("./transcript-audience-audit");
const {
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../studio/v4/render-policy");
const { sourceNameFromUrl } = require("../source-bound-script-writer");
const {
  SOURCE_CARD_TIMING,
} = require("../studio/v4/premium-card-timing-policy");
const {
  sourceMotionCoherence,
} = require("./alternate-cohort-candidate-selector");

const DEFAULT_ENABLED_UPLOAD_PLATFORMS = ["youtube_shorts", "instagram_reels", "facebook_reels"];
const MIN_PROOF_PACKAGE_READABLE_CARD_DURATION_S = 12;
const MIN_PROOF_PACKAGE_SOURCE_CARD_DURATION_S = SOURCE_CARD_TIMING.minimum_visible_duration_s;
const MAX_PROOF_PACKAGE_SOURCE_CARD_DURATION_S = SOURCE_CARD_TIMING.maximum_visible_duration_s;
const MAX_PROOF_PACKAGE_BASE_SOURCE_CLIPS = 1;

const OFFICIAL_PLATFORM_SOURCES = [
  { name: "PlayStation Blog", url: "https://blog.playstation.com", focus: ["playstation", "ps5", "psvr2"] },
  { name: "Xbox Wire", url: "https://news.xbox.com", focus: ["xbox", "game pass", "pc"] },
  { name: "Nintendo News", url: "https://www.nintendo.com/us/whatsnew/", focus: ["nintendo", "switch", "switch 2"] },
  { name: "Steam News", url: "https://store.steampowered.com/news/", focus: ["steam", "pc"] },
  { name: "Epic Games News", url: "https://store.epicgames.com/news", focus: ["epic", "pc"] },
];

const OFFICIAL_PUBLISHER_SOURCES = [
  { name: "Capcom News", url: "https://news.capcomusa.com", focus: ["capcom", "resident evil", "monster hunter"] },
  { name: "Ubisoft News", url: "https://news.ubisoft.com", focus: ["ubisoft", "assassin's creed"] },
  { name: "Square Enix News", url: "https://www.square-enix-games.com/news", focus: ["square enix", "final fantasy"] },
  { name: "Electronic Arts News", url: "https://www.ea.com/news", focus: ["ea", "battlefield", "sports"] },
  { name: "SEGA News", url: "https://www.sega.com/news", focus: ["sega", "sonic", "persona"] },
  { name: "Bethesda News", url: "https://bethesda.net/news", focus: ["bethesda", "doom", "elder scrolls"] },
];

const EVENT_WATCHLIST = [
  { name: "Nintendo Direct", source_rule: "official_or_two_major_sources", expected_story_types: ["reveal", "release_date", "gameplay"] },
  { name: "State of Play", source_rule: "official_or_two_major_sources", expected_story_types: ["playstation", "trailer", "release_date"] },
  { name: "Xbox Games Showcase", source_rule: "official_or_two_major_sources", expected_story_types: ["xbox", "game pass", "trailer"] },
  { name: "Summer Game Fest", source_rule: "official_or_two_major_sources", expected_story_types: ["reveal", "trailer", "developer"] },
  { name: "Gamescom Opening Night Live", source_rule: "official_or_two_major_sources", expected_story_types: ["reveal", "hands_on", "trailer"] },
  { name: "The Game Awards", source_rule: "official_or_two_major_sources", expected_story_types: ["reveal", "award", "trailer"] },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "just",
  "new",
  "of",
  "on",
  "the",
  "to",
  "turns",
  "with",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function isSyntheticEvaluationStoryId(value) {
  return /(?:^|[_-])premium[_-]?eval(?:$|[_-])/.test(lower(value));
}

function normalisePlatform(value) {
  const platform = lower(value);
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    youtube_shorts: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    instagram_reels: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    facebook_reels: "facebook_reels",
    twitter: "x",
    twitter_video: "x",
    twitter_image: "x",
  };
  return aliases[platform] || platform;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function normaliseVerdict(value) {
  const text = lower(value);
  if (["green", "pass", "passed", "ok"].includes(text)) return "green";
  if (["amber", "warn", "warning", "review"].includes(text)) return "amber";
  if (["red", "fail", "failed", "blocked"].includes(text)) return "red";
  return "unknown";
}

function buildOfficialSourceWatchlist(channelConfig = {}) {
  const mediaSources = asArray(channelConfig.rssFeeds).map((feed) => ({
    name: clean(feed.name),
    url: clean(feed.url),
    tier: "major_media",
    usage: "source_or_confirmation",
  }));
  const discoverySources = asArray(channelConfig.subreddits).map((name) => ({
    name: clean(name),
    url: `https://www.reddit.com/r/${clean(name)}/`,
    tier: "discovery_only",
    usage: "discovery_not_primary_proof",
  }));
  const sources = [
    ...OFFICIAL_PLATFORM_SOURCES.map((source) => ({ ...source, tier: "official_platform", usage: "primary_proof" })),
    ...OFFICIAL_PUBLISHER_SOURCES.map((source) => ({ ...source, tier: "official_publisher", usage: "primary_proof" })),
    ...mediaSources,
    ...discoverySources,
  ];

  return {
    schema_version: 1,
    channel_id: channelConfig.id || "pulse-gaming",
    generated_at: new Date().toISOString(),
    policy: {
      reddit_is_discovery_only: true,
      official_or_major_media_required_for_factual_claims: true,
      rumours_require_hedging: true,
      disabled_platforms_do_not_affect_story_supply: true,
    },
    sources,
    events: EVENT_WATCHLIST,
  };
}

function fingerprintTitle(title) {
  return lower(title)
    .replace(/\bconfirmed\b/g, "confirm")
    .replace(/\bconfirms\b/g, "confirm")
    .replace(/\brevealed\b/g, "reveal")
    .replace(/\breveals\b/g, "reveal")
    .replace(/\bannounced\b/g, "announce")
    .replace(/\bannounces\b/g, "announce")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word))
    .slice(0, 8)
    .join(" ");
}

function storyTimestampMs(story = {}) {
  const value =
    story.published_at ||
    story.created_at ||
    story.timestamp ||
    story.updated_at ||
    story.source_published_at ||
    story.source_manifest?.source_published_at ||
    story.source_manifest?.primary_source?.published_at ||
    story.primary_source?.published_at;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

function countValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).length;
  const number = Number(value);
  if (Number.isFinite(number)) return Math.max(0, number);
  return clean(value) ? 1 : 0;
}

function timestampMsFromValues(values = []) {
  for (const value of values) {
    const text = clean(value);
    if (!text) continue;
    const ms = new Date(text).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function candidateSourceTimestampMs(candidate = {}, story = {}) {
  return timestampMsFromValues([
    candidate.preflight_qa?.checks?.source_age?.evidence?.source_published_at,
    candidate.preflight_qa?.checks?.source_age?.evidence?.published_at,
    candidate.source_manifest?.primary_source?.published_at,
    candidate.source_manifest?.source_published_at,
    candidate.source?.source_published_at,
    candidate.source?.published_at,
    candidate.primary_source?.published_at,
    candidate.source_published_at,
    candidate.published_at,
    story.published_at,
    story.created_at,
    story.timestamp,
    story.updated_at,
    story.source_published_at,
    story.source_manifest?.source_published_at,
    story.source_manifest?.primary_source?.published_at,
    story.primary_source?.published_at,
  ]);
}

function candidateSourceAgePolicyHours(candidate = {}, story = {}) {
  return (
    numberOrNull(candidate.preflight_qa?.checks?.source_age?.evidence?.policy_hours) ??
    numberOrNull(candidate.source_age_policy_hours) ??
    numberOrNull(candidate.source_manifest?.source_age_policy_hours) ??
    numberOrNull(story.source_age_policy_hours) ??
    numberOrNull(story.source_manifest?.source_age_policy_hours) ??
    168
  );
}

function sourceAgeMetadata(candidate = {}, story = {}, now = new Date()) {
  const timestamp = candidateSourceTimestampMs(candidate, story);
  const policyHours = candidateSourceAgePolicyHours(candidate, story);
  if (!timestamp) {
    return {
      age_hours: null,
      source_age_policy_hours: policyHours,
      source_age_expires_in_hours: null,
      source_age_state: "unknown",
    };
  }
  const ageHours = Math.max(0, (now.getTime() - timestamp) / 36e5);
  const expiresIn = policyHours - ageHours;
  const roundedAge = Math.round(ageHours * 10) / 10;
  const roundedExpires = Math.round(expiresIn * 10) / 10;
  let state = "fresh";
  if (expiresIn < 0) state = "expired";
  else if (expiresIn <= 24) state = "expiring_within_24h";
  return {
    age_hours: roundedAge,
    source_age_policy_hours: policyHours,
    source_age_expires_in_hours: roundedExpires,
    source_age_state: state,
  };
}

function sourceLabel(story = {}) {
  return clean(story.source || story.source_name || story.subreddit || story.feed || story.source_type || "unknown");
}

function isGenericSourceName(value) {
  return /^(?:source_manifest|canonical_story_manifest|manifest|unknown|rss|major_media_source)$/i.test(clean(value));
}

function sourceDisplayNameFromParts(parts = [], url = "") {
  const urlName = clean(sourceNameFromUrl(url));
  for (const part of parts) {
    const text = clean(part);
    if (!text || isGenericSourceName(text)) continue;
    if (urlName && text.toLowerCase() !== urlName.toLowerCase()) return urlName;
    return text;
  }
  return urlName;
}

function hasSourceUrl(story = {}) {
  return Boolean(clean(story.source_url || story.article_url || story.url || story.link));
}

function isSourceBacked(story = {}) {
  const type = lower(story.source_type);
  if (type === "rss") return hasSourceUrl(story);
  if (hasSourceUrl(story) && !/reddit\.com/i.test(clean(story.url || story.source_url))) return true;
  return false;
}

function groupDuplicateStories(stories = []) {
  const byFingerprint = new Map();
  for (const story of asArray(stories)) {
    const key = fingerprintTitle(story.title || story.suggested_title || story.id);
    if (!key) continue;
    const group = byFingerprint.get(key) || [];
    group.push({
      id: clean(story.id),
      title: clean(story.title || story.suggested_title),
      source: sourceLabel(story),
      url: clean(story.url || story.source_url || story.article_url),
    });
    byFingerprint.set(key, group);
  }

  return Array.from(byFingerprint.entries())
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      fingerprint,
      count: group.length,
      sources: unique(group.map((item) => item.source)),
      story_ids: group.map((item) => item.id),
      examples: group.slice(0, 5),
    }));
}

function candidateIsReady(candidate = {}) {
  const status = lower(candidate.status);
  const qaStatus = lower(candidate.preflight_qa?.status || candidate.preflightQa?.status);
  const blockers = asArray(candidate.preflight_qa?.blockers || candidate.blockers);
  return status === "publish_ready" && blockers.length === 0 && (!qaStatus || qaStatus === "pass" || qaStatus === "green");
}

function candidateIsV4Ready(candidate = {}) {
  const exportedPath = lower(candidate.source?.exported_path || candidate.exported_path);
  const reasons = asArray(candidate.reasons).map(lower);
  return exportedPath.includes("visual_v4") || exportedPath.includes("studio-v4") || reasons.includes("scheduler_bridge_candidate");
}

function candidateIsSourceSafe(candidate = {}) {
  const reasons = asArray(candidate.reasons).map(lower);
  return reasons.includes("preflight_qa_pass") || lower(candidate.preflight_qa?.checks?.content?.result) === "pass";
}

function candidatePlatformList(candidate = {}, field) {
  return unique([
    ...asArray(candidate[field]),
    ...asArray(candidate.source?.[field]),
    ...asArray(candidate.scheduler_preflight_candidate?.[field]),
    ...asArray(candidate.scheduler_preflight_candidate?.source?.[field]),
  ]).map(normalisePlatform);
}

function candidateAlreadyPublishedOn(candidate = {}, platform) {
  return candidatePlatformList(candidate, "already_published_platforms").includes(normalisePlatform(platform));
}

function candidateActionKey(candidate = {}, platform) {
  return `${clean(candidate.id || candidate.story_id)}:${normalisePlatform(platform)}`;
}

function terminalDuplicateActionKeysFrom(report = {}) {
  const keys = new Set();
  report = report || {};
  for (const action of asArray(report.blocked_actions)) {
    const blockers = unique(action.blockers).map(lower);
    const terminalDuplicate =
      lower(action.outcome) === "duplicate_blocked" ||
      blockers.includes("duplicate_blocked") ||
      /^duplicate_blocked:/i.test(clean(action.error));
    if (!terminalDuplicate) continue;
    const storyId = clean(action.story_id || action.storyId || action.id);
    const platform = normalisePlatform(action.platform);
    if (storyId && platform) keys.add(`${storyId}:${platform}`);
  }
  return keys;
}

function terminalDuplicatePlatformsForCandidate(candidate = {}, terminalDuplicateActionKeys = new Set()) {
  const storyId = clean(candidate.id || candidate.story_id);
  const platforms = candidatePlatformList(candidate, "terminal_duplicate_blocked_platforms");
  if (storyId && terminalDuplicateActionKeys.size) {
    for (const key of terminalDuplicateActionKeys) {
      const prefix = `${storyId}:`;
      if (!key.startsWith(prefix)) continue;
      const platform = normalisePlatform(key.slice(prefix.length));
      if (platform) platforms.push(platform);
    }
  }
  return unique(platforms);
}

function candidateFreshUploadPlatforms(
  candidate = {},
  terminalDuplicateActionKeys = new Set(),
  enabledPlatforms = DEFAULT_ENABLED_UPLOAD_PLATFORMS,
) {
  const missingEnabled = candidatePlatformList(candidate, "missing_enabled_platforms");
  const terminalDuplicatePlatforms = new Set(
    terminalDuplicatePlatformsForCandidate(candidate, terminalDuplicateActionKeys),
  );
  const targets = missingEnabled.length ? missingEnabled : asArray(enabledPlatforms).map(normalisePlatform);
  return unique(targets).filter(
    (platform) =>
      platform &&
      !candidateAlreadyPublishedOn(candidate, platform) &&
      !terminalDuplicatePlatforms.has(platform) &&
      !terminalDuplicateActionKeys.has(candidateActionKey(candidate, platform)),
  );
}

function candidateCanCreateNewPlatformUpload(candidate = {}, platform, terminalDuplicateActionKeys = new Set()) {
  const target = normalisePlatform(platform);
  if (!target) return false;
  if (candidateAlreadyPublishedOn(candidate, target)) return false;
  if (terminalDuplicatePlatformsForCandidate(candidate, terminalDuplicateActionKeys).includes(target)) return false;
  if (terminalDuplicateActionKeys.has(candidateActionKey(candidate, target))) return false;
  const missingEnabled = candidatePlatformList(candidate, "missing_enabled_platforms");
  return missingEnabled.length === 0 || missingEnabled.includes(target);
}

function candidateMediaHouseEvidence(candidate = {}) {
  return candidate.preflight_qa?.checks?.media_house?.evidence || {};
}

function candidateAttentionBlockers(candidate = {}) {
  const evidence = candidateMediaHouseEvidence(candidate);
  return unique([
    ...asArray(candidate.preflight_qa?.blockers),
    ...asArray(candidate.blockers),
    ...asArray(evidence.hard_failures),
  ]).filter((blocker) =>
    /media_house:(?:generic_title|title_lacks_curiosity_gap|platform_title_too_plain|platform_copy_too_plain|first_frame_or_thumbnail_not_attention_led|shorts_feed_competition_weak)|(?:^|:)feed_(?:title_template_fatigue|cover_too_abstract|description_lacks_specific_payoff)/i.test(
      blocker,
    ),
  );
}

function scoreFromEvidence(evidence = {}, ...keys) {
  for (const key of keys) {
    const value = numberOrNull(evidence[key]);
    if (value !== null) return value;
    const nested = numberOrNull(evidence.scores?.[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function legacyFeedStandoutScore(evidence = {}) {
  if (asArray(evidence.hard_failures).length > 0) return null;
  if (lower(evidence.verdict) !== "green") return null;

  const overall = scoreFromEvidence(evidence, "overall_media_house_score", "overall_score", "score");
  const title = scoreFromEvidence(evidence, "title_strength_score", "title_score");
  const firstFrame = scoreFromEvidence(evidence, "first_frame_score");
  const firstThree = scoreFromEvidence(evidence, "first_3_seconds_score", "first_three_seconds_score");
  const parity = scoreFromEvidence(evidence, "competitor_parity_score");
  const surpass = scoreFromEvidence(evidence, "competitor_surpass_score");
  const requiredScores = [overall, title, firstFrame, firstThree, parity];
  if (requiredScores.some((score) => score === null)) return null;
  if (overall < 90 || title < 90 || firstFrame < 90 || firstThree < 90 || parity < 90) return null;
  if (surpass !== null && surpass < 85) return null;
  return overall;
}

function candidateShortsAttention(candidate = {}) {
  const mediaHouse = candidate.preflight_qa?.checks?.media_house || {};
  const evidence = candidateMediaHouseEvidence(candidate);
  const blockers = candidateAttentionBlockers(candidate);
  const feedReport = evidence.shorts_feed_competition_report || {};
  const attentionReport = evidence.shorts_attention_report || {};
  const feedStatus = lower(feedReport.status || "");
  const inferredFeedScore = legacyFeedStandoutScore(evidence);
  const inferredFeedStatus = inferredFeedScore !== null ? "standout" : "";
  const attentionStatus = lower(attentionReport.status || "");
  const mediaHouseResult = lower(mediaHouse.result || evidence.verdict || "");
  const hasMediaHouseEvidence = Boolean(mediaHouse.result || evidence.verdict || feedReport.status || attentionReport.status);
  const passByEvidence =
    ["pass", "green"].includes(mediaHouseResult) ||
    lower(evidence.verdict) === "green" ||
    attentionStatus === "pass";
  const blocked =
    blockers.length > 0 ||
    ["blocked", "fail", "failed", "red"].includes(feedStatus) ||
    attentionStatus === "blocked";
  const readyWithoutCurrentEvidence = candidateIsReady(candidate) && !hasMediaHouseEvidence;
  const status = blocked
    ? "blocked"
    : passByEvidence || readyWithoutCurrentEvidence
      ? "pass"
      : "unknown";
  return {
    status,
    feed_status: feedStatus || inferredFeedStatus || (status === "pass" ? "pass" : "unknown"),
    feed_score: numberOrNull(feedReport.score) ?? inferredFeedScore,
    blockers,
  };
}

function buildPlatformUploadRunway(scorecards = [], {
  publishWindows24h = 5,
  reserveTarget = 5,
} = {}) {
  const publishWindows = Math.max(0, Number(publishWindows24h || 0));
  const reserve = Math.max(0, Number(reserveTarget || 0));
  const ready = asArray(scorecards);
  const expiringWithin24h = ready.filter((item) => {
    const expires = Number(item.source_age_expires_in_hours);
    return Number.isFinite(expires) && expires <= 24;
  });
  const covered = Math.min(ready.length, publishWindows);
  const uncovered = Math.max(0, publishWindows - ready.length);
  const reserveCandidates = Math.max(0, ready.length - publishWindows);
  const status = uncovered > 0
    ? "undercovered"
    : expiringWithin24h.length > 0
      ? "covered_with_expiring_candidates"
      : reserveCandidates < reserve
        ? "covered_no_reserve"
        : "covered_with_reserve";

  return {
    publish_windows_24h: publishWindows,
    ready_for_next_24h_boolean: uncovered === 0 && expiringWithin24h.length === 0,
    covered_publish_windows_24h: covered,
    uncovered_publish_windows_24h: uncovered,
    reserve_candidates: reserveCandidates,
    reserve_target: reserve,
    ready_candidates_expiring_within_24h: expiringWithin24h.length,
    expiring_candidate_ids: expiringWithin24h.map((item) => clean(item.story_id)).filter(Boolean),
    status,
    next_action: uncovered > 0
      ? "refill_fresh_youtube_short_candidates_before_next_publish_window"
      : expiringWithin24h.length > 0
        ? "replace_expiring_youtube_candidates_with_fresh_source_backed_stories"
        : reserveCandidates < reserve
          ? "build_youtube_short_reserve_candidates_before_the_buffer_is_consumed"
          : "keep_youtube_short_candidate_runway_on_daily_ops_cadence",
  };
}

function boundedInteger(value, { min = 0, max = 30, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function buildRefillActionPlan({
  cleanGreenReadyCount = 0,
  freshYoutubeReadyCount = 0,
  greenReadyTarget = 10,
  youtubeUploadRunway = {},
} = {}) {
  const publishWindows = boundedInteger(youtubeUploadRunway.publish_windows_24h, {
    min: 0,
    max: 24,
    fallback: 5,
  });
  const reserveTarget = boundedInteger(youtubeUploadRunway.reserve_target, {
    min: 0,
    max: 30,
    fallback: 5,
  });
  const uncovered = boundedInteger(youtubeUploadRunway.uncovered_publish_windows_24h, {
    min: 0,
    max: publishWindows || 24,
    fallback: Math.max(0, publishWindows - Number(freshYoutubeReadyCount || 0)),
  });
  const reserve = boundedInteger(youtubeUploadRunway.reserve_candidates, {
    min: 0,
    max: 30,
    fallback: Math.max(0, Number(freshYoutubeReadyCount || 0) - publishWindows),
  });
  const missingForTarget = Math.max(0, boundedInteger(greenReadyTarget, { min: 1, max: 30, fallback: 10 }) - Number(cleanGreenReadyCount || 0));
  const reserveGap = Math.max(0, reserveTarget - reserve);
  const minimumNewGreen = Math.max(missingForTarget, uncovered + reserveGap);
  const needed = minimumNewGreen > 0 || clean(youtubeUploadRunway.status) !== "covered_with_reserve";
  const recommendedRefillLimit = needed
    ? Math.min(30, Math.max(12, minimumNewGreen * 2))
    : 0;
  const recommendedRssPerFeed = !needed
    ? 0
    : uncovered > 0
      ? 10
      : recommendedRefillLimit >= 16
        ? 6
        : 4;
  const recommendedRepairStoryLimit = needed
    ? Math.min(10, Math.max(1, minimumNewGreen || 1))
    : 0;
  const reason = uncovered > 0
    ? "fresh_youtube_upload_runway_undercovered"
    : reserveGap > 0
      ? "fresh_youtube_upload_reserve_below_target"
      : missingForTarget > 0
        ? "clean_green_candidate_target_below_target"
        : "candidate_supply_runway_healthy";

  return {
    status: needed ? "needed" : "healthy",
    reason,
    clean_green_ready_candidates: Number(cleanGreenReadyCount || 0),
    fresh_youtube_upload_candidates: Number(freshYoutubeReadyCount || 0),
    publish_windows_24h: publishWindows,
    reserve_target: reserveTarget,
    reserve_candidates: reserve,
    needed_fresh_youtube_candidates_for_24h: uncovered,
    needed_fresh_youtube_candidates_for_reserve: reserveGap,
    needed_clean_green_candidates_for_target: missingForTarget,
    minimum_new_green_candidates: minimumNewGreen,
    recommended_refill_limit: recommendedRefillLimit,
    recommended_rss_per_feed: recommendedRssPerFeed,
    recommended_repair_story_limit: recommendedRepairStoryLimit,
    safe_refill_command: needed
      ? `npm run ops:fresh-production-refill -- --json --limit ${recommendedRefillLimit} --rss-per-feed ${recommendedRssPerFeed} --repair-evidence-mode plan --repair-story-limit ${recommendedRepairStoryLimit}`
      : "",
    safety: {
      local_proof_only: true,
      no_manual_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_stay_deferred: true,
    },
  };
}

function extractMotionCapacityRows(report = {}) {
  const reportPath = clean(report.path || report.report_path || report.file_path);
  const rows = [
    ...asArray(report.rows),
    ...asArray(report.packs),
    ...asArray(report.story_candidates),
    ...asArray(report.candidates),
  ];
  if (clean(report.story_id || report.storyId || report.id)) rows.push(report);
  return rows.map((row) => ({
    ...row,
    report_path: clean(row.report_path || row.path || row.file_path) || reportPath,
  }));
}

function directMotionClipsFromRow(row = {}) {
  return asArray(row.clips).filter((clip) => {
    const text = lower(
      [
        clip.media_kind,
        clip.source_type,
        clip.rights_basis,
        clip.licence_basis,
        clip.validation_reason,
        clip.provenance?.source,
        clip.provenance?.validation_reason,
      ].filter(Boolean).join(" "),
    );
    return (
      clip.counts_towards_motion_readiness === true ||
      /direct_video|official_direct_media|steam_movie|official_trailer|platform_storefront/.test(text)
    );
  });
}

function motionFamilyCountFromClips(clips = []) {
  return unique(
    asArray(clips).map((clip) =>
      clean(clip.motion_family || clip.source_family || clip.base_source_family || clip.source_url || clip.path),
    ),
  ).length;
}

function terminalMotionValidationFailure(row = {}) {
  return asArray(row.required_acquisitions).some((acquisition) => {
    const status = clean(acquisition.segment_validation_status || acquisition.status);
    return ["validation_failed", "validated_not_selected"].includes(status);
  });
}

function motionCapacityFromRow(row = {}) {
  const storyId = clean(row.story_id || row.storyId || row.id);
  if (!storyId) return null;

  const blockers = unique([
    ...asArray(row.blockers),
    ...asArray(row.render_input_blockers),
    ...asArray(row.readiness?.blockers),
  ]);
  const directMotionClips = directMotionClipsFromRow(row);
  const currentMotionClips = nonNegativeNumber(
    row.current_motion_clips ?? row.clip_count ?? row.accepted_clip_count,
    directMotionClips.length || countValue(row.clips),
  );
  const currentMotionFamilies = countValue(
    row.current_motion_families ??
      row.current_family_names ??
      row.source_families ??
      row.families ??
      row.distinct_motion_families ??
      (directMotionClips.length ? motionFamilyCountFromClips(directMotionClips) : null),
  );
  const requiredMotionClips = nonNegativeNumber(row.required_motion_clips, 5);
  const requiredMotionFamilies = nonNegativeNumber(row.required_motion_families, 4);
  const missingMotionClips = nonNegativeNumber(
    row.missing_motion_clips,
    Math.max(0, requiredMotionClips - currentMotionClips),
  );
  const missingMotionFamilies = nonNegativeNumber(
    row.missing_motion_families,
    Math.max(0, requiredMotionFamilies - currentMotionFamilies),
  );
  const directMediaReady = nonNegativeNumber(
    row.acquisition_counts?.direct_media_ready ?? row.direct_media_ready ?? row.direct_media_ready_count,
    directMotionClips.length,
  );
  const requiredAcquisitions = asArray(row.required_acquisitions);
  const terminalValidationStatuses = new Set(["validation_failed", "validated_not_selected"]);
  const actionableDirectMediaReady = requiredAcquisitions.length
    ? requiredAcquisitions.filter((acquisition) => {
        const status = clean(acquisition.segment_validation_status || acquisition.status);
        if (terminalValidationStatuses.has(status)) return false;
        return Boolean(clean(acquisition.direct_media_url || acquisition.media_url || acquisition.url));
      }).length
    : directMediaReady;
  const licenceOrOperatorRequired = nonNegativeNumber(
    row.acquisition_counts?.licence_or_operator_required ??
      row.licence_or_operator_required ??
      row.operator_required_entries,
  );
  const sourceFamilyCandidateCount = countValue(row.source_family_candidates);
  const officialSearchActionCount = countValue(row.official_search_actions);
  const operatorRequired = Boolean(
    row.render_input_operator_required ||
      row.governed_visual_plan?.operator_approval_required ||
      row.operator_approval_required ||
      licenceOrOperatorRequired > 0,
  );
  const readinessStatus = clean(row.readiness_status || row.readiness?.status || row.status || row.render_decision || "unknown");
  const blockingStatus = /blocked|hold|failed|operator/i.test(readinessStatus);
  const hasBlockingEvidence = blockingStatus || blockers.length > 0;
  const readyByStatus = /ready|green|pass/i.test(readinessStatus) && !hasBlockingEvidence;
  const motionReady =
    !hasBlockingEvidence &&
    (readyByStatus ||
      (missingMotionClips === 0 &&
        missingMotionFamilies === 0 &&
        currentMotionClips >= requiredMotionClips &&
        currentMotionFamilies >= requiredMotionFamilies));
  const nearReady =
    !motionReady &&
    !operatorRequired &&
    missingMotionClips <= 1 &&
    missingMotionFamilies <= 1 &&
    (currentMotionClips >= Math.max(0, requiredMotionClips - 1) ||
      currentMotionFamilies >= Math.max(0, requiredMotionFamilies - 1));
  const repairable = Boolean(
    !motionReady &&
      !operatorRequired &&
      (actionableDirectMediaReady > 0 || sourceFamilyCandidateCount > 0 || officialSearchActionCount > 0),
  );
  let repairPriority = "none";
  if (motionReady) repairPriority = "ready";
  else if (repairable && nearReady) repairPriority = "high";
  else if (repairable) repairPriority = "medium";
  else if (operatorRequired) repairPriority = "operator_required";

  return {
    story_id: storyId,
    title: clean(row.title),
    report_path: clean(row.report_path || row.path || row.file_path),
    artifact_dir: clean(row.artifact_dir || row.source?.artifact_dir),
    source_manifest: row.source_manifest || null,
    canonical_story_manifest: row.canonical_story_manifest || null,
    readiness_status: readinessStatus,
    motion_ready: motionReady,
    near_ready: nearReady,
    repairable,
    repair_priority: repairPriority,
    operator_required: operatorRequired,
    current_motion_clips: currentMotionClips,
    required_motion_clips: requiredMotionClips,
    missing_motion_clips: missingMotionClips,
    current_motion_families: currentMotionFamilies,
    required_motion_families: requiredMotionFamilies,
    missing_motion_families: missingMotionFamilies,
    direct_media_ready: directMediaReady,
    actionable_direct_media_ready: actionableDirectMediaReady,
    clips: directMotionClips.map((clip) => ({
      id: clean(clip.id || clip.clip_id),
      source_url: clean(clip.source_url || clip.url || clip.path),
      path: clean(clip.path || clip.local_materialized_path),
      source_family: clean(clip.source_family || clip.motion_family || clip.family),
      source_type: clean(clip.source_type || clip.media_kind || "official_direct_motion"),
      media_kind: clean(clip.media_kind || clip.kind || clip.type),
      title: clean(clip.title || clip.source_title || clip.label),
    })).filter((clip) => clip.source_url || clip.path),
    licence_or_operator_required: licenceOrOperatorRequired,
    source_family_candidate_count: sourceFamilyCandidateCount,
    official_search_action_count: officialSearchActionCount,
    blockers,
    terminal_validation_failure: terminalMotionValidationFailure(row),
  };
}

function mergeMotionCapacity(current = null, next = null) {
  if (!current) return next;
  if (!next) return current;
  const rankFor = (item) => {
    if (item?.terminal_validation_failure) return 5;
    return { none: 0, operator_required: 1, medium: 2, high: 3, ready: 4 }[item?.repair_priority] || 0;
  };
  const currentRank = rankFor(current);
  const nextRank = rankFor(next);
  const primary = nextRank >= currentRank ? next : current;
  const secondary = primary === next ? current : next;
  return {
    ...primary,
    current_motion_clips: primary.current_motion_clips || 0,
    current_motion_families: primary.current_motion_families || 0,
    required_motion_clips: primary.required_motion_clips || 0,
    required_motion_families: primary.required_motion_families || 0,
    missing_motion_clips: primary.missing_motion_clips ?? 0,
    missing_motion_families: primary.missing_motion_families ?? 0,
    direct_media_ready: Math.max(current.direct_media_ready || 0, next.direct_media_ready || 0),
    actionable_direct_media_ready: primary.actionable_direct_media_ready || 0,
    licence_or_operator_required: Math.max(current.licence_or_operator_required || 0, next.licence_or_operator_required || 0),
    source_family_candidate_count: Math.max(current.source_family_candidate_count || 0, next.source_family_candidate_count || 0),
    official_search_action_count: Math.max(current.official_search_action_count || 0, next.official_search_action_count || 0),
    motion_ready: Boolean(primary.motion_ready),
    near_ready: Boolean(primary.near_ready),
    repairable: Boolean(primary.repairable),
    operator_required: Boolean(current.operator_required || next.operator_required),
    blockers: primary.motion_ready ? asArray(primary.blockers) : unique([...asArray(current.blockers), ...asArray(next.blockers)]),
    terminal_validation_failure: Boolean(current.terminal_validation_failure || next.terminal_validation_failure),
    report_path: primary.report_path || secondary.report_path || "",
    artifact_dir: primary.artifact_dir || secondary.artifact_dir || "",
    source_manifest: primary.source_manifest || secondary.source_manifest || null,
    canonical_story_manifest: primary.canonical_story_manifest || secondary.canonical_story_manifest || null,
    clips: asArray(primary.clips).length ? primary.clips : asArray(secondary.clips),
    merged_from_statuses: unique([current.readiness_status, next.readiness_status, ...asArray(secondary.merged_from_statuses)]),
  };
}

function buildMotionCapacityIndex(reports = []) {
  const index = new Map();
  const reportList = Array.isArray(reports) ? reports : [reports];
  for (const report of reportList.filter(Boolean)) {
    for (const row of extractMotionCapacityRows(report)) {
      const capacity = motionCapacityFromRow(row);
      if (!capacity) continue;
      index.set(capacity.story_id, mergeMotionCapacity(index.get(capacity.story_id), capacity));
    }
  }
  return index;
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function resolveLocalPath(filePath) {
  const text = clean(filePath);
  if (!text) return "";
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(process.cwd(), text);
}

function candidateExportedPath(candidate = {}) {
  return clean(
    candidate.source?.exported_path ||
      candidate.exported_path ||
      candidate.final_mp4_path ||
      candidate.final_render_path ||
      candidate.render_path ||
      candidate.video_path ||
      candidate.source?.final_mp4_path ||
      candidate.source?.final_render_path ||
      candidate.source?.render_path ||
      candidate.source?.video_path,
  );
}

function candidateArtifactDir(candidate = {}) {
  const explicitDir = clean(candidate.artifact_dir || candidate.source?.artifact_dir);
  if (explicitDir) return resolveLocalPath(explicitDir);
  const exportedPath = candidateExportedPath(candidate);
  if (!exportedPath) return "";
  return path.dirname(resolveLocalPath(exportedPath));
}

function repoRootFromReportPath(reportPath = "") {
  const resolved = resolveLocalPath(reportPath);
  if (!resolved) return process.cwd();
  const parts = resolved.split(/[\\/]+/);
  const outputIndex = parts.map((part) => part.toLowerCase()).lastIndexOf("output");
  if (outputIndex <= 0) return process.cwd();
  return parts.slice(0, outputIndex).join(path.sep) || path.parse(resolved).root || process.cwd();
}

function proofPackageSearchDirsForStory(storyId = "", root = process.cwd()) {
  if (!storyId) return [];
  const bases = [
    path.join(root, "output", "fresh-green-refill"),
    path.join(root, "output", "candidate-supply", "fresh-production-refill"),
  ].filter((base) => fs.existsSync(base));
  const runs = bases
    .flatMap((base) =>
      fs
        .readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(base, entry.name)),
    )
    .sort((a, b) => b.localeCompare(a));
  const dirs = [];
  for (const runDir of runs) {
    const candidates = [
      path.join(runDir, "goal-proof-batch", storyId),
      path.join(runDir, "goal-proof-batch", "motion-hydrated", storyId),
      path.join(runDir, "goal-proof-batch", "official-source", storyId),
    ];
    dirs.push(...candidates.filter((dir) => fs.existsSync(dir)));
  }
  return dirs;
}

function sourceStoryFromProofPackageDir(storyId = "", artifactDir = "") {
  const dir = resolveLocalPath(artifactDir);
  if (!storyId || !dir || !fs.existsSync(dir)) return null;
  const sourceManifest = readJsonIfExists(path.join(dir, "source_manifest.json")) || {};
  const canonicalManifest = readJsonIfExists(path.join(dir, "canonical_story_manifest.json")) || {};
  const primarySource = sourceManifest.primary_source || {};
  const sourceUrl = clean(
    primarySource.url ||
      canonicalManifest.primary_source_url ||
      sourceManifest.url ||
      canonicalManifest.url,
  );
  const publishedAt = clean(
    primarySource.published_at ||
      sourceManifest.source_published_at ||
      canonicalManifest.source_published_at,
  );
  if (!sourceUrl || !publishedAt) return null;
  const displaySourceName = sourceDisplayNameFromParts(
    [
      primarySource.name,
      canonicalManifest.primary_source,
      sourceManifest.source_name,
      sourceManifest.source,
      primarySource.type,
    ],
    sourceUrl,
  );
  return {
    id: storyId,
    title: clean(canonicalManifest.canonical_title || canonicalManifest.selected_title || sourceManifest.title || storyId),
    canonical_subject: clean(canonicalManifest.canonical_subject || canonicalManifest.canonical_game || canonicalManifest.canonical_title || sourceManifest.title),
    canonical_game: clean(canonicalManifest.canonical_game || canonicalManifest.canonical_subject || canonicalManifest.canonical_title || sourceManifest.title),
    source: displaySourceName,
    source_name: displaySourceName,
    source_type: "rss",
    url: sourceUrl,
    source_url: sourceUrl,
    source_published_at: publishedAt,
    source_age_policy_hours: sourceManifest.source_age_policy_hours || canonicalManifest.source_age_policy_hours,
    confirmed_claims: asArray(sourceManifest.confirmed_claims || canonicalManifest.confirmed_claims),
    source_manifest: {
      ...sourceManifest,
      primary_source: {
        ...primarySource,
        url: sourceUrl,
        published_at: publishedAt,
      },
    },
  };
}

function sourceStoryFromMotionCapacity(capacity = {}, storiesById = new Map()) {
  const storyId = clean(capacity.story_id);
  const existing = storiesById.get(storyId);
  if (existing) return existing;
  const directManifestStory = sourceStoryFromProofPackageDir(storyId, capacity.artifact_dir);
  if (directManifestStory) return directManifestStory;
  if (capacity.source_manifest || capacity.canonical_story_manifest) {
    const sourceManifest = capacity.source_manifest || {};
    const canonicalStoryManifest = capacity.canonical_story_manifest || {};
    const primarySource = sourceManifest.primary_source || {};
    const sourceUrl = clean(primarySource.url || canonicalStoryManifest.primary_source_url);
    const publishedAt = clean(primarySource.published_at || sourceManifest.source_published_at || canonicalStoryManifest.source_published_at);
    if (sourceUrl && publishedAt) {
      const displaySourceName = sourceDisplayNameFromParts(
        [
          primarySource.name,
          canonicalStoryManifest.primary_source,
          sourceManifest.source_name,
          sourceManifest.source,
          primarySource.type,
        ],
        sourceUrl,
      );
      return {
        id: storyId,
        title: clean(canonicalStoryManifest.canonical_title || sourceManifest.title || capacity.title || storyId),
        canonical_subject: clean(canonicalStoryManifest.canonical_subject || canonicalStoryManifest.canonical_game || canonicalStoryManifest.canonical_title || sourceManifest.title),
        canonical_game: clean(canonicalStoryManifest.canonical_game || canonicalStoryManifest.canonical_subject || canonicalStoryManifest.canonical_title || sourceManifest.title),
        source: displaySourceName,
        source_name: displaySourceName,
        source_type: "rss",
        url: sourceUrl,
        source_url: sourceUrl,
        source_published_at: publishedAt,
        source_age_policy_hours: sourceManifest.source_age_policy_hours || canonicalStoryManifest.source_age_policy_hours,
        confirmed_claims: asArray(sourceManifest.confirmed_claims || canonicalStoryManifest.confirmed_claims),
        source_manifest: {
          ...sourceManifest,
          primary_source: {
            ...primarySource,
            url: sourceUrl,
            published_at: publishedAt,
          },
        },
      };
    }
  }
  const root = repoRootFromReportPath(capacity.report_path);
  for (const dir of proofPackageSearchDirsForStory(storyId, root)) {
    const story = sourceStoryFromProofPackageDir(storyId, dir);
    if (story) return story;
  }
  return {};
}

function motionClipIdentityKey(clip = {}) {
  return [
    clean(
      clip.direct_media_url ||
        clip.source_url ||
        clip.url ||
        clip.path,
    ),
    clean(clip.source_family || clip.motion_family || clip.family),
  ].join("|").toLowerCase();
}

function reconcileMotionCapacityIdentity(capacity = {}, storiesById = new Map()) {
  const story = sourceStoryFromMotionCapacity(capacity, storiesById);
  const subject = clean(
    story.canonical_subject ||
      story.canonical_game ||
      capacity.canonical_story_manifest?.canonical_subject ||
      capacity.canonical_story_manifest?.canonical_game,
  );
  const clips = asArray(capacity.clips);
  if (!subject || !clips.length) return capacity;

  const coherence = sourceMotionCoherence({
    ...story,
    canonical_subject: subject,
    canonical_game: clean(story.canonical_game || subject),
    motion_capacity: {
      ...capacity,
      clips,
    },
  });
  const identityBlockers = asArray(coherence.reason_codes);
  const hasDefiniteIdentityFailure = identityBlockers.some((reason) =>
    [
      "source_motion_coherence:cross_title_contamination",
      "source_motion_coherence:unrelated_media",
    ].includes(clean(reason)),
  );
  if (!hasDefiniteIdentityFailure) {
    return {
      ...capacity,
      source_motion_coherence: coherence,
    };
  }

  const matchedKeys = new Set(
    asArray(coherence.media_evidence)
      .filter((row) => clean(row.verdict) === "matched")
      .map(motionClipIdentityKey),
  );
  const matchedClips = clips.filter((clip) =>
    matchedKeys.has(motionClipIdentityKey(clip)),
  );
  const currentMotionClips = matchedClips.length;
  const currentMotionFamilies = motionFamilyCountFromClips(matchedClips);
  const requiredMotionClips = nonNegativeNumber(
    capacity.required_motion_clips,
    5,
  );
  const requiredMotionFamilies = nonNegativeNumber(
    capacity.required_motion_families,
    4,
  );
  const missingMotionClips = Math.max(
    0,
    requiredMotionClips - currentMotionClips,
  );
  const missingMotionFamilies = Math.max(
    0,
    requiredMotionFamilies - currentMotionFamilies,
  );
  const operatorRequired = Boolean(capacity.operator_required);
  const nearReady =
    !operatorRequired &&
    missingMotionClips <= 1 &&
    missingMotionFamilies <= 1 &&
    (currentMotionClips >= Math.max(0, requiredMotionClips - 1) ||
      currentMotionFamilies >= Math.max(0, requiredMotionFamilies - 1));
  const repairable = Boolean(
    !operatorRequired &&
      (currentMotionClips > 0 ||
        Number(capacity.source_family_candidate_count || 0) > 0 ||
        Number(capacity.official_search_action_count || 0) > 0),
  );

  return {
    ...capacity,
    readiness_status: "v4_motion_blocked",
    motion_ready: false,
    near_ready: nearReady,
    repairable,
    repair_priority: operatorRequired
      ? "operator_required"
      : repairable && nearReady
        ? "high"
        : repairable
          ? "medium"
          : "none",
    current_motion_clips: currentMotionClips,
    current_motion_families: currentMotionFamilies,
    missing_motion_clips: missingMotionClips,
    missing_motion_families: missingMotionFamilies,
    direct_media_ready: currentMotionClips,
    actionable_direct_media_ready: currentMotionClips,
    raw_motion_clip_count: clips.length,
    raw_motion_family_count: motionFamilyCountFromClips(clips),
    rejected_cross_title_clip_count: Math.max(
      0,
      clips.length - matchedClips.length,
    ),
    clips: matchedClips,
    blockers: unique([...asArray(capacity.blockers), ...identityBlockers]),
    source_motion_coherence: coherence,
  };
}

function objectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function packageOutputPlatforms(publishVerdict = {}, platformManifest = {}) {
  return unique([
    ...asArray(publishVerdict.enabled_platform_outputs),
    ...objectKeys(platformManifest.outputs),
  ]).map(normalisePlatform);
}

function greenish(value) {
  return normaliseVerdict(value) === "green";
}

function noHardFailures(...values) {
  return values.every((value) => asArray(value).length === 0);
}

function existingPackageVideoPath(artifactDir, renderManifest = {}, candidate = {}) {
  const paths = [
    renderManifest.output_path,
    renderManifest.output,
    candidateExportedPath(candidate),
    "visual_v4_render.mp4",
  ];
  for (const item of paths) {
    const text = clean(item);
    if (!text) continue;
    const resolved = path.isAbsolute(text) ? path.normalize(text) : path.join(artifactDir, text);
    if (fs.existsSync(resolved)) return resolved;
  }
  return "";
}

function visibleProofCardWindows(renderManifest = {}) {
  return asArray(
    renderManifest.overlay_card_windows ||
      renderManifest.visible_card_windows ||
      renderManifest.card_visible_windows ||
      renderManifest.rendered_card_windows,
  ).map((window) => ({
    id: clean(window.id || window.kind || window.label),
    kind: clean(window.kind || window.type),
    duration_s: numberOrNull(window.duration_s ?? window.durationS ?? window.duration),
  })).filter((window) => window.duration_s !== null);
}

function proofWindowIsSourceLock(window = {}) {
  return /\bsource[_\s-]?(?:lock|card)?\b/i.test(clean([window.id, window.kind].join(" ")));
}

function proofCardWindowDwellBlockers(windows = []) {
  const blockers = [];
  for (const window of asArray(windows)) {
    if (proofWindowIsSourceLock(window)) {
      if (window.duration_s < MIN_PROOF_PACKAGE_SOURCE_CARD_DURATION_S) {
        blockers.push("render_manifest_source_card_window_dwell_too_short");
      }
      if (window.duration_s > MAX_PROOF_PACKAGE_SOURCE_CARD_DURATION_S) {
        blockers.push("render_manifest_source_card_window_dwell_too_long");
      }
      continue;
    }
    if (window.duration_s < MIN_PROOF_PACKAGE_READABLE_CARD_DURATION_S) {
      blockers.push("render_manifest_card_window_dwell_too_short");
    }
  }
  return unique(blockers);
}

function stripMotionWindowSuffix(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/(?:[_/-]window[_/-]\d+(?:[_/-]\d+)?)$/i, "")
    .replace(/(?:[_/-]segment[_/-]\d+)$/i, "")
    .replace(/(?:[_/-]clip[_/-]\d+)$/i, "");
}

function proofMotionBaseSourceKey(clip = {}) {
  const explicit = clean(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family ||
      clip.source_family ||
      clip.motion_family,
  );
  const source = clean(clip.source_url || clip.url || clip.reference_url || clip.path || clip.local_path);
  return stripMotionWindowSuffix(explicit || source);
}

function proofPackageVisualSafetyBlockers(renderManifest = {}, motionManifest = {}) {
  const blockers = [];
  if (lower(renderManifest.repeat_guard?.status) !== "pass") {
    blockers.push("render_manifest_repeat_guard_missing_or_failed");
  }
  const repeatGuardCardFloor = numberOrNull(
    renderManifest.repeat_guard?.min_card_duration_s ??
      renderManifest.repeat_guard?.minimum_card_duration_s ??
      renderManifest.repeat_guard?.min_readable_card_duration_s,
  );
  if (
    repeatGuardCardFloor !== null &&
    repeatGuardCardFloor + 0.001 < MIN_PROOF_PACKAGE_READABLE_CARD_DURATION_S
  ) {
    blockers.push("render_manifest_repeat_guard_card_floor_too_low");
  }
  const visualPolicyVersion = clean(renderManifest.visual_design_policy_version);
  if (
    visualPolicyVersion &&
    visualPolicyVersion !== STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION
  ) {
    blockers.push("render_manifest_visual_design_policy_stale");
  }
  const cardWindows = visibleProofCardWindows(renderManifest);
  if (!cardWindows.length) {
    blockers.push("render_manifest_card_window_evidence_missing");
  }
  blockers.push(...proofCardWindowDwellBlockers(cardWindows));
  if (lower(motionManifest.repeat_guard?.status) !== "pass") {
    blockers.push("materialised_motion_repeat_guard_missing_or_failed");
  }

  const materializedClips = asArray(motionManifest.clips)
    .filter((clip) => clip.materialized !== false && clip.counts_towards_motion_readiness !== false);
  const baseCounts = new Map();
  for (const clip of materializedClips) {
    const key = proofMotionBaseSourceKey(clip);
    if (!key) continue;
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }
  if ([...baseCounts.values()].some((count) => count > MAX_PROOF_PACKAGE_BASE_SOURCE_CLIPS)) {
    blockers.push("materialised_motion_base_source_repeated");
  }
  return unique(blockers);
}

function currentProofPackageEvidence(candidate = {}, enabledPlatforms = DEFAULT_ENABLED_UPLOAD_PLATFORMS) {
  const artifactDir = candidateArtifactDir(candidate);
  if (!artifactDir || !fs.existsSync(artifactDir)) return null;

  const publishVerdict = readJsonIfExists(path.join(artifactDir, "publish_verdict.json")) || {};
  const platformManifest = readJsonIfExists(path.join(artifactDir, "platform_publish_manifest.json")) || {};
  const coherenceReport = readJsonIfExists(path.join(artifactDir, "coherence_report.json")) || {};
  const renderManifest = readJsonIfExists(path.join(artifactDir, "render_manifest.json")) || {};
  const audioManifest = readJsonIfExists(path.join(artifactDir, "audio_manifest.json")) || {};
  const motionManifest = readJsonIfExists(path.join(artifactDir, "materialised_motion_clips.json")) || {};
  const mediaHouseScore = readJsonIfExists(path.join(artifactDir, "pulse_media_house_score.json")) || {};

  const storyId = clean(candidate.id || candidate.story_id);
  const proofStoryIds = unique([
    publishVerdict.story_id,
    renderManifest.story_id,
    audioManifest.story_id,
    motionManifest.story_id,
    mediaHouseScore.story_id,
  ]);
  const blockers = [];
  if (storyId && proofStoryIds.some((id) => id !== storyId)) blockers.push("proof_package_story_id_mismatch");

  const enabled = asArray(enabledPlatforms).map(normalisePlatform).filter(Boolean);
  const outputPlatforms = packageOutputPlatforms(publishVerdict, platformManifest);
  const missingEnabledOutputs = enabled.filter((platform) => !outputPlatforms.includes(platform));
  if (missingEnabledOutputs.length) blockers.push(`proof_package_missing_enabled_outputs:${missingEnabledOutputs.join(",")}`);

  if (!greenish(publishVerdict.verdict || publishVerdict.status)) blockers.push("publish_verdict_not_green");
  if (publishVerdict.can_auto_publish !== true) blockers.push("publish_verdict_not_auto_publishable");
  if (!noHardFailures(publishVerdict.reason_codes, publishVerdict.blockers, publishVerdict.failures)) {
    blockers.push("publish_verdict_has_blockers");
  }

  if (!greenish(platformManifest.publish_status || platformManifest.status || platformManifest.verdict)) {
    blockers.push("platform_publish_manifest_not_green");
  }
  if (platformManifest.can_auto_publish !== true) blockers.push("platform_publish_manifest_not_auto_publishable");

  if (!greenish(coherenceReport.result || coherenceReport.verdict || coherenceReport.status)) {
    blockers.push("coherence_report_not_pass");
  }
  if (!noHardFailures(coherenceReport.failures, coherenceReport.blockers, coherenceReport.raw_failures)) {
    blockers.push("coherence_report_has_blockers");
  }

  const videoPath = existingPackageVideoPath(artifactDir, renderManifest, candidate);
  if (!videoPath) blockers.push("render_manifest_output_missing");
  if (renderManifest.final_publish_render !== true) blockers.push("render_manifest_not_final_publish_render");
  if (!/pass|green|passed/i.test(clean(renderManifest.quality_gate_status || renderManifest.post_render_forensic_result))) {
    blockers.push("render_manifest_forensics_not_passed");
  }
  if (!noHardFailures(renderManifest.post_render_forensic_blockers, renderManifest.blockers, renderManifest.failures)) {
    blockers.push("render_manifest_has_blockers");
  }
  blockers.push(...proofPackageVisualSafetyBlockers(renderManifest, motionManifest));

  const timestampSource = lower(audioManifest.word_timestamp_source || audioManifest.word_timestamp_provenance?.word_timestamp_source);
  const alignment = audioManifest.timestamp_whisper_alignment || {};
  if (!/materialized|ready|pass/.test(lower(audioManifest.voice_status || audioManifest.status))) {
    blockers.push("audio_manifest_voice_not_materialized");
  }
  if (!timestampSource.includes("whisper")) blockers.push("audio_manifest_whisper_timestamps_missing");
  if (nonNegativeNumber(audioManifest.word_timestamp_count) <= 0) blockers.push("audio_manifest_word_timestamps_missing");
  if (nonNegativeNumber(alignment.script_inserted_actual_word_count) > 0) blockers.push("audio_manifest_asr_insertions_present");
  if (nonNegativeNumber(alignment.script_trailing_actual_word_count) > 0) blockers.push("audio_manifest_asr_trailing_words_present");

  const motionClips = asArray(motionManifest.clips);
  const materializedClips = motionClips.filter((clip) => clip.materialized !== false && clip.counts_towards_motion_readiness !== false);
  const motionFamilies = unique(materializedClips.map((clip) => clip.motion_family || clip.source_family || clip.base_source_family));
  if (!/ready|pass|green/.test(lower(motionManifest.status || motionManifest.verdict))) {
    blockers.push("materialised_motion_not_ready");
  }
  if (materializedClips.length < 5) blockers.push("materialised_motion_clip_count_below_minimum");
  if (motionFamilies.length < 4) blockers.push("materialised_motion_family_count_below_minimum");

  if (!greenish(mediaHouseScore.verdict || mediaHouseScore.status)) blockers.push("media_house_score_not_green");
  if (!noHardFailures(mediaHouseScore.hard_failures, mediaHouseScore.blockers, mediaHouseScore.failures)) {
    blockers.push("media_house_score_has_blockers");
  }
  const scores = mediaHouseScore.scores || {};
  const overall = numberOrNull(scores.overall_media_house_score ?? mediaHouseScore.overall_media_house_score);
  const parity = numberOrNull(scores.competitor_parity_score ?? mediaHouseScore.competitor_parity_score);
  const firstThree = numberOrNull(scores.first_3_seconds_score ?? mediaHouseScore.first_3_seconds_score);
  if (overall !== null && overall < 90) blockers.push("media_house_overall_below_standout_threshold");
  if (parity !== null && parity < 90) blockers.push("media_house_parity_below_standout_threshold");
  if (firstThree !== null && firstThree < 90) blockers.push("media_house_first_3_seconds_below_standout_threshold");

  if (blockers.length) return null;

  const feedScore = overall ?? parity ?? firstThree ?? 90;
  return {
    status: "green",
    artifact_dir: artifactDir,
    video_path: videoPath,
    enabled_platform_outputs: enabled.filter((platform) => outputPlatforms.includes(platform)),
    generated_at: clean(
      publishVerdict.generated_at ||
        coherenceReport.generated_at ||
        renderManifest.generated_at ||
        motionManifest.generated_at ||
        mediaHouseScore.generated_at,
    ),
    motion_clip_count: materializedClips.length,
    motion_family_count: motionFamilies.length,
    media_house_evidence: {
      verdict: "GREEN",
      overall_media_house_score: overall,
      title_strength_score: numberOrNull(scores.title_strength_score ?? mediaHouseScore.title_strength_score),
      first_frame_score: numberOrNull(scores.first_frame_score ?? mediaHouseScore.first_frame_score),
      first_3_seconds_score: firstThree,
      competitor_parity_score: parity,
      competitor_surpass_score: numberOrNull(scores.competitor_surpass_score ?? mediaHouseScore.competitor_surpass_score),
      hard_failures: [],
      shorts_feed_competition_report: { status: "standout", score: feedScore },
      shorts_attention_report: { status: "pass" },
    },
  };
}

function removePreflightBlockedMarkers(values = []) {
  return asArray(values).filter((value) => lower(value) !== "preflight_qa_blocked");
}

function hydrateCandidateFromCurrentProofPackage(candidate = {}, enabledPlatforms = DEFAULT_ENABLED_UPLOAD_PLATFORMS) {
  const proof = currentProofPackageEvidence(candidate, enabledPlatforms);
  if (!proof) return candidate;
  const supersededPreflightBlockers = unique([
    ...asArray(candidate.preflight_qa?.blockers),
    ...asArray(candidate.blockers),
  ]);
  const existingChecks = candidate.preflight_qa?.checks || {};
  return {
    ...candidate,
    status: "publish_ready",
    reasons: unique([
      ...removePreflightBlockedMarkers(candidate.reasons),
      "preflight_qa_pass",
      "current_green_proof_package",
    ]),
    penalties: removePreflightBlockedMarkers(candidate.penalties),
    blockers: [],
    source: {
      ...candidate.source,
      exported_path: proof.video_path || candidate.source?.exported_path,
      artifact_dir: proof.artifact_dir,
    },
    preflight_qa: {
      ...candidate.preflight_qa,
      status: "pass",
      blockers: [],
      current_proof_package_status: "green",
      superseded_blockers: supersededPreflightBlockers,
      checks: {
        ...existingChecks,
        content: { ...(existingChecks.content || {}), result: "pass", failures: [] },
        video: { ...(existingChecks.video || {}), result: "pass", failures: [] },
        platform: { ...(existingChecks.platform || {}), result: "pass", failures: [] },
        governance: { ...(existingChecks.governance || {}), result: "pass", failures: [] },
        incident_guard: { ...(existingChecks.incident_guard || {}), result: "pass", failures: [] },
        voice_quality: { ...(existingChecks.voice_quality || {}), result: "pass", failures: [] },
        visual_entity_match: { ...(existingChecks.visual_entity_match || {}), result: "pass", failures: [] },
        media_house: {
          ...(existingChecks.media_house || {}),
          result: "pass",
          evidence: proof.media_house_evidence,
        },
      },
    },
    current_proof_package: {
      status: "green",
      artifact_dir: proof.artifact_dir,
      generated_at: proof.generated_at,
      enabled_platform_outputs: proof.enabled_platform_outputs,
      motion_clip_count: proof.motion_clip_count,
      motion_family_count: proof.motion_family_count,
      superseded_preflight_blockers: supersededPreflightBlockers,
    },
  };
}

function scorecardBlocksCurrentArtifact(scorecard = {}) {
  if (!scorecard || typeof scorecard !== "object") return [];
  const blockers = unique([
    ...asArray(scorecard.blockers),
    ...asArray(scorecard.failures),
    ...asArray(scorecard.hard_failures),
  ]);
  const verdict = lower(scorecard.verdict || scorecard.viral_status || scorecard.status || scorecard.result);
  if (/^(?:rewrite_required|tighten_before_tts|fail|failed|red|blocked)$/.test(verdict)) {
    blockers.push(`script_scorecard:${verdict}`);
  }
  const score = numberOrNull(scorecard.viral_score ?? scorecard.score ?? scorecard.overall_score);
  if (score !== null && score < 75) blockers.push("script_scorecard:script_score_below_threshold");
  return unique(blockers);
}

function auditCurrentCandidateTranscript(candidate = {}) {
  const storyId = clean(candidate.id);
  const artifactDir = candidateArtifactDir(candidate);
  if (!storyId || !artifactDir || !fs.existsSync(path.join(artifactDir, "canonical_story_manifest.json"))) return null;

  try {
    const audit = auditOneTranscript({ storyId, artifactDir });
    const scorecard = readJsonIfExists(path.join(artifactDir, "script_scorecard.json")) || {};
    const scorecardBlockers = scorecardBlocksCurrentArtifact(scorecard);
    const blockers = unique([...asArray(audit.blockers), ...scorecardBlockers]);
    const verdict = clean(audit.verdict) === "pass" && blockers.length === 0 ? "pass" : "rewrite_required";
    return {
      story_id: storyId,
      title: clean(audit.title || candidate.title),
      verdict,
      blockers,
      viral_score: numberOrNull(audit.viral_score ?? scorecard.viral_score),
      viral_verdict: clean(audit.viral_verdict || scorecard.verdict),
      mass_audience_result: clean(audit.mass_audience?.result),
      current_candidate: true,
      publish_ready_candidate: candidateIsReady(candidate),
      source_safe_candidate: candidateIsSourceSafe(candidate),
      v4_ready_candidate: candidateIsV4Ready(candidate),
      current_candidate_artifact: true,
      artifact_dir: artifactDir,
    };
  } catch (error) {
    return {
      story_id: storyId,
      title: clean(candidate.title),
      verdict: "rewrite_required",
      blockers: [`current_candidate_artifact_audit_error:${clean(error.message) || "unknown"}`],
      viral_score: null,
      current_candidate: true,
      publish_ready_candidate: candidateIsReady(candidate),
      source_safe_candidate: candidateIsSourceSafe(candidate),
      v4_ready_candidate: candidateIsV4Ready(candidate),
      current_candidate_artifact: true,
      artifact_dir: artifactDir,
    };
  }
}

function transcriptBacklogRowFromReport(story = {}, candidate = null) {
  return {
    story_id: clean(story.story_id || story.id),
    title: clean(story.title || candidate?.title),
    verdict: clean(story.verdict),
    blockers: asArray(story.blockers).map(clean).filter(Boolean),
    viral_score: numberOrNull(story.viral_score),
    current_candidate: Boolean(candidate),
    publish_ready_candidate: candidate ? candidateIsReady(candidate) : false,
    source_safe_candidate: candidate ? candidateIsSourceSafe(candidate) : false,
    v4_ready_candidate: candidate ? candidateIsV4Ready(candidate) : false,
  };
}

function transcriptAudienceBacklog(transcriptAudienceReport = {}, candidateReport = {}) {
  const candidates = asArray(candidateReport.candidates);
  const candidatesById = new Map(candidates.map((candidate) => [clean(candidate.id), candidate]));
  const currentArtifactAudits = candidates.map(auditCurrentCandidateTranscript).filter(Boolean);
  const currentArtifactAuditById = new Map(
    currentArtifactAudits.map((audit) => [clean(audit.story_id), audit]),
  );
  const rewriteRows = [];
  const currentArtifactRowsUsed = new Set();
  let staleTranscriptRewriteSuppressed = 0;

  for (const story of asArray(transcriptAudienceReport?.stories)) {
    const verdict = lower(story.verdict);
    if (!verdict || verdict === "pass") continue;
    const storyId = clean(story.story_id || story.id);
    const candidate = candidatesById.get(storyId);
    const currentAudit = currentArtifactAuditById.get(storyId);
    if (currentAudit?.verdict === "pass") {
      staleTranscriptRewriteSuppressed += 1;
      continue;
    }
    if (currentAudit && !currentArtifactRowsUsed.has(storyId)) {
      rewriteRows.push({
        ...currentAudit,
        replaces_stale_transcript_audit: true,
      });
      currentArtifactRowsUsed.add(storyId);
      continue;
    }
    const row = transcriptBacklogRowFromReport(story, candidate);
    if (row.story_id) rewriteRows.push(row);
  }

  for (const audit of currentArtifactAudits) {
    const storyId = clean(audit.story_id);
    if (audit.verdict === "pass" || currentArtifactRowsUsed.has(storyId)) continue;
    rewriteRows.push(audit);
    currentArtifactRowsUsed.add(storyId);
  }

  const current = rewriteRows.filter((story) => story.current_candidate);
  const ready = rewriteRows.filter((story) => story.publish_ready_candidate);
  const currentArtifactPassCount = currentArtifactAudits.filter((audit) => audit.verdict === "pass").length;
  const reportedTotal = Number(transcriptAudienceReport?.summary?.total || 0);
  const effectiveRewriteRequired = rewriteRows.length;

  return {
    generated_at: transcriptAudienceReport?.generated_at || null,
    summary: {
      audited_transcripts: Math.max(reportedTotal, rewriteRows.length + currentArtifactPassCount),
      pass: Number(transcriptAudienceReport?.summary?.pass || 0) + currentArtifactPassCount,
      rewrite_required: effectiveRewriteRequired,
      current_candidate_rewrite_count: current.length,
      ready_candidate_rewrite_count: ready.length,
      historical_rewrite_count: Math.max(0, rewriteRows.length - current.length),
      current_candidate_artifact_audit_count: currentArtifactAudits.length,
      current_candidate_artifact_pass_count: currentArtifactPassCount,
      stale_transcript_rewrite_suppressed_count: staleTranscriptRewriteSuppressed,
    },
    current_candidates: current.slice(0, 20),
    ready_candidates: ready.slice(0, 20),
    historical_rewrite_required: rewriteRows.filter((story) => !story.current_candidate).slice(0, 20),
  };
}

function scorePriority(candidate = {}, storiesById = new Map(), now = new Date(), motionCapacityById = new Map()) {
  const story = storiesById.get(clean(candidate.id)) || {};
  const age = sourceAgeMetadata(candidate, story, now);
  const ageHours = age.age_hours;
  const freshness = ageHours === null ? 10 : ageHours <= 24 ? 25 : ageHours <= 48 ? 18 : ageHours <= 96 ? 10 : 4;
  const sourceConfidence = isSourceBacked(story) || lower(candidate.source?.source_type) === "rss" ? 22 : 8;
  const motionCapacity = motionCapacityById.get(clean(candidate.id)) || null;
  let visualAvailability = candidateIsV4Ready(candidate) ? 22 : clean(candidate.source?.exported_path || candidate.exported_path) ? 12 : 0;
  if (!candidateIsV4Ready(candidate) && motionCapacity) {
    if (motionCapacity.motion_ready) visualAvailability = Math.max(visualAvailability, 20);
    else if (motionCapacity.repair_priority === "high") visualAvailability = Math.max(visualAvailability, 16);
    else if (motionCapacity.repair_priority === "medium") visualAvailability = Math.max(visualAvailability, 10);
    else if (motionCapacity.operator_required) visualAvailability = Math.max(visualAvailability, 3);
  }
  const qa = candidateIsReady(candidate) ? 18 : 0;
  const title = clean(candidate.title || story.title);
  const namedEntity = /\b(?:Nintendo|Xbox|PlayStation|Steam|Capcom|Square Enix|Sega|Ubisoft|Bethesda|Doom|Mario|Halo|Forza|Final Fantasy|Resident Evil)\b/i.test(title) ? 8 : 2;
  const score = Math.min(100, Math.round(freshness + sourceConfidence + visualAvailability + qa + namedEntity + Number(candidate.score || 0) / 20));

  return {
    story_id: clean(candidate.id),
    title,
    score,
    freshness_score: freshness,
    source_confidence_score: sourceConfidence,
    visual_availability_score: visualAvailability,
    qa_readiness_score: qa,
    named_entity_score: namedEntity,
    age_hours: age.age_hours,
    source_age_policy_hours: age.source_age_policy_hours,
    source_age_expires_in_hours: age.source_age_expires_in_hours,
    source_age_state: age.source_age_state,
    publish_ready: candidateIsReady(candidate),
    source_safe: candidateIsSourceSafe(candidate),
    v4_ready: candidateIsV4Ready(candidate),
    shorts_attention: candidateShortsAttention(candidate),
    motion_capacity: motionCapacity,
    source: clean(candidate.source?.source_type || story.source_type || sourceLabel(story)),
  };
}

function scoreMotionCapacityProspect(capacity = {}, storiesById = new Map(), now = new Date()) {
  const story = sourceStoryFromMotionCapacity(capacity, storiesById);
  const age = sourceAgeMetadata({}, story, now);
  const sourceSafe = Boolean(isSourceBacked(story) && age.source_age_state !== "unknown" && age.source_age_state !== "expired");
  let visualAvailability = 0;
  if (capacity.motion_ready) visualAvailability = 20;
  else if (capacity.repair_priority === "high") visualAvailability = 16;
  else if (capacity.repair_priority === "medium") visualAvailability = 10;
  else if (capacity.operator_required) visualAvailability = 3;
  const title = clean(capacity.title || story.title || capacity.story_id);
  const namedEntity = /\b(?:Nintendo|Xbox|PlayStation|Steam|Capcom|Square Enix|Sega|Ubisoft|Bethesda|Doom|Mario|Halo|Forza|Final Fantasy|Resident Evil|Granblue|Dave|Planet Crafter|EA Sports)\b/i.test(title) ? 8 : 2;
  const repeatOrStaleRiskReasons = unique([
    "not_scheduler_candidate",
    age.source_age_state === "unknown" ? "source_age_unknown" : "",
    sourceSafe ? "" : "source_safe_false",
    "publish_ready_false",
  ]);
  const rawScore = Math.min(100, Math.round(20 + visualAvailability + namedEntity + (capacity.near_ready ? 12 : 0) + (capacity.direct_media_ready > 0 ? 10 : 0)));
  const score = Math.min(rawScore, 34);
  return {
    story_id: clean(capacity.story_id),
    title,
    canonical_subject: clean(story.canonical_subject || story.canonical_game || story.title || title),
    canonical_game: clean(story.canonical_game || story.canonical_subject || story.title || title),
    score,
    raw_score_before_repeat_stale_cap: rawScore,
    freshness_score: age.age_hours === null ? 0 : age.age_hours <= 24 ? 25 : age.age_hours <= 48 ? 18 : age.age_hours <= 96 ? 10 : 4,
    source_confidence_score: sourceSafe ? 22 : 0,
    visual_availability_score: visualAvailability,
    qa_readiness_score: 0,
    named_entity_score: namedEntity,
    age_hours: age.age_hours,
    source_age_policy_hours: age.source_age_policy_hours,
    source_age_expires_in_hours: age.source_age_expires_in_hours,
    source_age_state: age.source_age_state,
    publish_ready: false,
    source_safe: sourceSafe,
    v4_ready: false,
    shorts_attention: {
      status: "not_scheduler_candidate",
      feed_status: "unknown",
      feed_score: null,
      blockers: [],
    },
    motion_capacity: capacity,
    source: "motion_capacity_report",
    source_name: sourceDisplayNameFromParts(
      [
        story.source_name,
        story.source,
        story.source_manifest?.primary_source?.name,
        story.source_manifest?.source_name,
        story.source_manifest?.source,
        story.source_manifest?.primary_source?.type,
      ],
      clean(story.source_url || story.url),
    ),
    source_url: clean(story.source_url || story.url),
    source_published_at: clean(story.source_published_at),
    primary_source: clean(story.source_url || story.url)
      ? {
          name: sourceDisplayNameFromParts(
            [
              story.source_name,
              story.source,
              story.source_manifest?.primary_source?.name,
              story.source_manifest?.source_name,
              story.source_manifest?.source,
              story.source_manifest?.primary_source?.type,
            ],
            clean(story.source_url || story.url),
          ),
          url: clean(story.source_url || story.url),
          type: clean(story.source_type || "rss"),
          published_at: clean(story.source_published_at),
        }
      : null,
    source_manifest: story.source_manifest || null,
    confirmed_claims: asArray(story.confirmed_claims || story.source_manifest?.confirmed_claims),
    direct_media_candidates: asArray(capacity.clips).map((clip) => ({
      direct_media_url: clean(clip.source_url || clip.url || clip.path),
      label: clean(clip.label || clip.title || clip.source_title || clip.source_family || clip.id),
      source_family: clean(clip.source_family || clip.motion_family || clip.family),
      source_type: clean(clip.source_type || clip.media_kind || "official_direct_motion"),
    })).filter((candidate) => candidate.direct_media_url),
    clean_green: false,
    repeat_or_stale_risk: true,
    repeat_or_stale_risk_reasons: repeatOrStaleRiskReasons,
    transcript_audience: {
      verdict: "not_scheduler_candidate",
      blockers: [],
    },
  };
}

function buildCandidateSupplyReport({
  stories = [],
  candidateReport = {},
  transcriptAudienceReport = null,
  motionCapacityReports = [],
  guardedLiveDispatchExecutorReport = {},
  enabledUploadPlatforms = DEFAULT_ENABLED_UPLOAD_PLATFORMS,
  channelConfig = {},
  now = new Date(),
  targets = {},
} = {}) {
  const watchlist = buildOfficialSourceWatchlist(channelConfig);
  const candidates = asArray(candidateReport.candidates).map((candidate) =>
    hydrateCandidateFromCurrentProofPackage(candidate, enabledUploadPlatforms),
  );
  const hydratedCandidateReport = {
    ...candidateReport,
    candidates,
  };
  const currentGreenProofPackageCandidates = candidates.filter(
    (candidate) => candidate.current_proof_package?.status === "green",
  );
  const terminalDuplicateActionKeys = terminalDuplicateActionKeysFrom(guardedLiveDispatchExecutorReport);
  const schedulerQuarantinedCandidates = candidates.filter(
    (candidate) => candidate.scheduler_quarantine?.status === "held",
  );
  const schedulerQuarantineReasons = schedulerQuarantinedCandidates.reduce((acc, candidate) => {
    const reason = clean(candidate.scheduler_quarantine?.reason) || "unknown";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const readyCandidates = candidates.filter(candidateIsReady);
  const transcriptBacklog = transcriptAudienceBacklog(transcriptAudienceReport, hydratedCandidateReport);
  const transcriptBlockedReadyIds = new Set(
    asArray(transcriptBacklog.ready_candidates).map((item) => clean(item.story_id)),
  );
  const transcriptBlockedById = new Map(
    asArray(transcriptBacklog.ready_candidates).map((item) => [clean(item.story_id), item]),
  );
  const transcriptCleanReadyCandidates = readyCandidates.filter(
    (candidate) => !transcriptBlockedReadyIds.has(clean(candidate.id)),
  );
  const shortsAttentionById = new Map(candidates.map((candidate) => [clean(candidate.id), candidateShortsAttention(candidate)]));
  const cleanGreenQualityCandidates = transcriptCleanReadyCandidates.filter((candidate) => {
    const attention = shortsAttentionById.get(clean(candidate.id)) || {};
    return attention.status === "pass" && attention.feed_status === "standout";
  });
  const cleanGreenReadyCandidates = cleanGreenQualityCandidates.filter(
    (candidate) => candidateFreshUploadPlatforms(candidate, terminalDuplicateActionKeys, enabledUploadPlatforms).length > 0,
  );
  const terminalDuplicatePlatformBlockedCandidates = cleanGreenQualityCandidates.filter(
    (candidate) =>
      candidateFreshUploadPlatforms(candidate, terminalDuplicateActionKeys, enabledUploadPlatforms).length === 0 &&
      terminalDuplicatePlatformsForCandidate(candidate, terminalDuplicateActionKeys).length > 0,
  );
  const sourceSafeCandidates = cleanGreenReadyCandidates.filter(candidateIsSourceSafe);
  const v4ReadyCandidates = cleanGreenReadyCandidates.filter(candidateIsV4Ready);
  const cleanCandidateReport = {
    ...candidateReport,
    candidates: candidates.filter((candidate) => cleanGreenReadyCandidates.some((ready) => clean(ready.id) === clean(candidate.id))),
  };
  const buffer = buildCandidateBuffer(cleanCandidateReport, {
    readyCandidates: targets.greenReadyCandidates || 10,
    sourceSafeCandidates: targets.sourceSafeCandidates || 6,
    v4ReadyCandidates: targets.v4ReadyCandidates || 3,
  });
  const storiesById = new Map(asArray(stories).map((story) => [clean(story.id), story]));
  const nowDate = now instanceof Date ? now : new Date(now);
  const freshStories = asArray(stories).filter((story) => {
    const timestamp = storyTimestampMs(story);
    return timestamp && nowDate.getTime() - timestamp <= 24 * 60 * 60 * 1000;
  });
  const freshSourceBacked = freshStories.filter(isSourceBacked);
  const duplicateGroups = groupDuplicateStories(stories);
  const motionCapacityById = new Map(
    Array.from(buildMotionCapacityIndex(motionCapacityReports).entries())
      .filter(([storyId]) => !isSyntheticEvaluationStoryId(storyId))
      .map(([storyId, capacity]) => [
        storyId,
        reconcileMotionCapacityIdentity(capacity, storiesById),
      ]),
  );
  const candidatePriorityScorecards = candidates
    .map((candidate) => {
      const scorecard = scorePriority(candidate, storiesById, nowDate, motionCapacityById);
      const transcriptBlock = transcriptBlockedById.get(clean(scorecard.story_id));
      const attention = shortsAttentionById.get(clean(scorecard.story_id)) || {};
      const cleanGreen = Boolean(
        scorecard.publish_ready &&
        !transcriptBlock &&
        attention.status === "pass" &&
        attention.feed_status === "standout" &&
        candidateFreshUploadPlatforms(candidate, terminalDuplicateActionKeys, enabledUploadPlatforms).length > 0,
      );
      return {
        ...scorecard,
        clean_green: cleanGreen,
        available_fresh_upload_platforms: candidateFreshUploadPlatforms(
          candidate,
          terminalDuplicateActionKeys,
          enabledUploadPlatforms,
        ),
        terminal_duplicate_blocked_platforms: terminalDuplicatePlatformsForCandidate(
          candidate,
          terminalDuplicateActionKeys,
        ),
        current_proof_package: candidate.current_proof_package || null,
        transcript_audience: transcriptBlock
          ? {
              verdict: transcriptBlock.verdict || "rewrite_required",
              blockers: asArray(transcriptBlock.blockers),
            }
          : {
              verdict: "pass_or_not_flagged",
              blockers: [],
            },
      };
    });
  const candidateIds = new Set(candidates.map((candidate) => clean(candidate.id)));
  const motionOnlyScorecards = Array.from(motionCapacityById.values())
    .filter((capacity) => !candidateIds.has(clean(capacity.story_id)))
    .map((capacity) => scoreMotionCapacityProspect(capacity, storiesById, nowDate));
  const priorityScorecards = [...candidatePriorityScorecards, ...motionOnlyScorecards].sort((a, b) => b.score - a.score);
  const readyIds = new Set(cleanGreenReadyCandidates.map((candidate) => clean(candidate.id)));
  const rawReadyIds = new Set(readyCandidates.map((candidate) => clean(candidate.id)));
  const readyScorecards = priorityScorecards.filter((item) => readyIds.has(clean(item.story_id)));
  const nonReadyScorecards = priorityScorecards.filter((item) => !rawReadyIds.has(clean(item.story_id)));
  const readyExpiringWithin24h = readyScorecards.filter((item) => item.source_age_state === "expiring_within_24h");
  const readyExpired = readyScorecards.filter((item) => item.source_age_state === "expired");
  const readyMissingSourceAge = readyScorecards.filter((item) => item.source_age_state === "unknown");
  const durableReadyCandidates = readyScorecards.filter(
    (item) => item.source_age_state === "fresh" && Number(item.source_age_expires_in_hours) > 24,
  );
  const freshYoutubeReadyCandidateIds = new Set(
    transcriptCleanReadyCandidates
      .filter((candidate) => candidateCanCreateNewPlatformUpload(candidate, "youtube_shorts", terminalDuplicateActionKeys))
      .map((candidate) => clean(candidate.id)),
  );
  const freshYoutubeReadyScorecards = readyScorecards.filter((item) => freshYoutubeReadyCandidateIds.has(clean(item.story_id)));
  const durableFreshYoutubeReadyScorecards = freshYoutubeReadyScorecards.filter(
    (item) => item.source_age_state === "fresh" && Number(item.source_age_expires_in_hours) > 24,
  );
  const catchUpOnlyGreenCandidates = cleanGreenReadyCandidates.filter(
    (candidate) => !freshYoutubeReadyCandidateIds.has(clean(candidate.id)),
  );
  const shortsAttentionReadyCandidates = transcriptCleanReadyCandidates.filter(
    (candidate) => shortsAttentionById.get(clean(candidate.id))?.status === "pass",
  );
  const shortsFeedStandoutCandidates = transcriptCleanReadyCandidates.filter(
    (candidate) => shortsAttentionById.get(clean(candidate.id))?.feed_status === "standout",
  );
  const metadataAttentionBlockedCandidates = candidates.filter(
    (candidate) => shortsAttentionById.get(clean(candidate.id))?.status === "blocked",
  );
  const platformCopyBlockedCandidates = metadataAttentionBlockedCandidates.filter((candidate) =>
    candidateAttentionBlockers(candidate).some((blocker) => /platform_(?:copy|title)_too_plain|title_lacks_curiosity_gap|generic_title/i.test(blocker)),
  );
  const thumbnailAttentionBlockedCandidates = metadataAttentionBlockedCandidates.filter((candidate) =>
    candidateAttentionBlockers(candidate).some((blocker) => /first_frame_or_thumbnail_not_attention_led|feed_cover_too_abstract/i.test(blocker)),
  );
  const shortsFeedCompetitionBlockedCandidates = metadataAttentionBlockedCandidates.filter((candidate) =>
    candidateAttentionBlockers(candidate).some((blocker) => /shorts_feed_competition_weak|feed_/i.test(blocker)),
  );
  const nonReadyExpiringWithin24h = nonReadyScorecards.filter((item) => item.source_age_state === "expiring_within_24h");
  const nonReadyExpired = nonReadyScorecards.filter((item) => item.source_age_state === "expired");
  const motionCapacityRows = Array.from(motionCapacityById.values());
  const motionCapacityScorecards = priorityScorecards.filter((item) => item.motion_capacity);
  const motionRepairableCandidates = motionCapacityRows.filter((item) => item.repairable);
  const actionableMotionRepairableCandidates = motionRepairableCandidates.filter((item) =>
    candidateIds.has(clean(item.story_id)),
  );
  const motionOnlyRepairableCandidates = motionRepairableCandidates.filter((item) =>
    !candidateIds.has(clean(item.story_id)),
  );
  const motionReadySourceMetadataRepairableCandidates = motionCapacityScorecards.filter((item) => {
    const motion = item.motion_capacity || {};
    const reasons = asArray(item.repeat_or_stale_risk_reasons).map(clean);
    return (
      item.source === "motion_capacity_report" &&
      motion.motion_ready === true &&
      item.repeat_or_stale_risk === true &&
      reasons.includes("source_age_unknown") &&
      reasons.includes("source_safe_false")
    );
  });
  const motionOperatorRequiredCandidates = motionCapacityRows.filter((item) => item.operator_required);
  const motionNearReadyCandidates = motionCapacityRows.filter((item) => item.near_ready);
  const blockers = [];
  const warnings = [];
  const greenReadyTarget = Number(targets.greenReadyCandidates || 10);
  const publishWindowTarget = Math.min(Number(targets.publishWindows24h || 5), Math.max(1, greenReadyTarget));
  const youtubeUploadRunway = buildPlatformUploadRunway(freshYoutubeReadyScorecards, {
    publishWindows24h: publishWindowTarget,
    reserveTarget: Number(targets.youtubeReserveCandidates || targets.publishWindowReserveCandidates || 5),
  });
  const refillActionPlan = buildRefillActionPlan({
    cleanGreenReadyCount: cleanGreenReadyCandidates.length,
    freshYoutubeReadyCount: freshYoutubeReadyScorecards.length,
    greenReadyTarget,
    youtubeUploadRunway,
  });
  const transcriptCurrentBacklog = Number(transcriptBacklog.summary.current_candidate_rewrite_count || 0);
  const transcriptReadyBacklog = Number(transcriptBacklog.summary.ready_candidate_rewrite_count || 0);

  if (watchlist.sources.filter((source) => /^official/.test(source.tier)).length < 8) blockers.push("official_source_watchlist_too_thin");
  if (cleanGreenReadyCandidates.length === 0) blockers.push("green_ready_candidate_buffer_empty");
  if (freshYoutubeReadyScorecards.length === 0) blockers.push("fresh_youtube_upload_candidate_buffer_empty");
  if (cleanGreenReadyCandidates.length < greenReadyTarget) warnings.push(`green_ready_candidates_below_target:${cleanGreenReadyCandidates.length}/${greenReadyTarget}`);
  if (shortsAttentionReadyCandidates.length < greenReadyTarget) warnings.push(`shorts_attention_ready_candidates_below_target:${shortsAttentionReadyCandidates.length}/${greenReadyTarget}`);
  if (freshYoutubeReadyScorecards.length < publishWindowTarget) warnings.push(`fresh_youtube_upload_candidates_below_window_target:${freshYoutubeReadyScorecards.length}/${publishWindowTarget}`);
  if (youtubeUploadRunway.reserve_candidates === 0 && youtubeUploadRunway.uncovered_publish_windows_24h === 0) warnings.push("fresh_youtube_upload_reserve_empty");
  if (youtubeUploadRunway.ready_candidates_expiring_within_24h > 0) warnings.push(`fresh_youtube_upload_candidates_expiring_within_24h:${youtubeUploadRunway.ready_candidates_expiring_within_24h}`);
  if (transcriptCurrentBacklog > 0) warnings.push(`transcript_backlog_current_candidates:${transcriptCurrentBacklog}`);
  if (transcriptReadyBacklog > 0) warnings.push(`transcript_backlog_ready_candidates:${transcriptReadyBacklog}`);
  if (transcriptCleanReadyCandidates.length < greenReadyTarget) warnings.push(`transcript_clean_green_ready_candidates_below_target:${transcriptCleanReadyCandidates.length}/${greenReadyTarget}`);
  if (terminalDuplicateActionKeys.size) warnings.push(`terminal_duplicate_blocked_actions_present:${terminalDuplicateActionKeys.size}`);
  if (terminalDuplicatePlatformBlockedCandidates.length) {
    warnings.push(`terminal_duplicate_platform_blocked_candidates:${terminalDuplicatePlatformBlockedCandidates.length}`);
  }
  if (sourceSafeCandidates.length < Number(targets.sourceSafeCandidates || 6)) warnings.push(`source_safe_candidates_below_target:${sourceSafeCandidates.length}/${targets.sourceSafeCandidates || 6}`);
  if (v4ReadyCandidates.length < Number(targets.v4ReadyCandidates || 3)) warnings.push(`v4_ready_candidates_below_target:${v4ReadyCandidates.length}/${targets.v4ReadyCandidates || 3}`);
  if (freshSourceBacked.length < Number(targets.freshSourceBackedStories || 10)) warnings.push(`fresh_source_backed_stories_below_daily_target:${freshSourceBacked.length}/${targets.freshSourceBackedStories || 10}`);
  if (readyExpiringWithin24h.length) warnings.push(`ready_candidates_expiring_within_24h:${readyExpiringWithin24h.length}`);
  if (readyExpired.length) blockers.push(`ready_candidates_source_age_expired:${readyExpired.length}`);
  if (readyMissingSourceAge.length) warnings.push(`ready_candidates_missing_source_age:${readyMissingSourceAge.length}`);
  if (nonReadyExpiringWithin24h.length) warnings.push(`non_ready_candidates_expiring_within_24h:${nonReadyExpiringWithin24h.length}`);
  if (nonReadyExpired.length) warnings.push(`non_ready_candidates_source_age_expired:${nonReadyExpired.length}`);
  if (schedulerQuarantinedCandidates.length) {
    warnings.push(`scheduler_quarantined_stale_backlog:${schedulerQuarantinedCandidates.length}`);
  }
  if (durableReadyCandidates.length < greenReadyTarget) warnings.push(`durable_green_ready_candidates_below_target:${durableReadyCandidates.length}/${greenReadyTarget}`);
  if (actionableMotionRepairableCandidates.length && cleanGreenReadyCandidates.length < greenReadyTarget) {
    warnings.push(`motion_repairable_candidates_available:${actionableMotionRepairableCandidates.length}`);
  }
  if (motionOnlyRepairableCandidates.length && cleanGreenReadyCandidates.length < greenReadyTarget) {
    warnings.push(`motion_repairable_repeat_or_stale_candidates_ignored:${motionOnlyRepairableCandidates.length}`);
  }
  if (motionReadySourceMetadataRepairableCandidates.length) {
    warnings.push(`motion_ready_source_metadata_repair_required:${motionReadySourceMetadataRepairableCandidates.length}`);
  }

  const refreshBeforeExpiry =
    readyExpiringWithin24h.length > 0 ||
    nonReadyExpiringWithin24h.length > 0 ||
    durableReadyCandidates.length < greenReadyTarget;
  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";

  return {
    schema_version: 1,
    generated_at: nowDate.toISOString(),
    mode: "read_only_candidate_supply_engine",
    verdict,
    targets: {
      fresh_source_backed_stories_per_day: Number(targets.freshSourceBackedStories || 10),
      green_ready_candidates: Number(targets.greenReadyCandidates || 10),
      source_safe_candidates: Number(targets.sourceSafeCandidates || 6),
      v4_ready_candidates: Number(targets.v4ReadyCandidates || 3),
    },
    summary: {
      stories_seen: asArray(stories).length,
      fresh_stories_24h: freshStories.length,
      fresh_source_backed_stories_24h: freshSourceBacked.length,
      candidate_report_returned: Number(candidateReport.totals?.returned || candidates.length),
      green_ready_candidates: cleanGreenReadyCandidates.length,
      raw_preflight_green_ready_candidates: readyCandidates.length,
      durable_green_ready_candidates: durableReadyCandidates.length,
      fresh_youtube_upload_candidates: freshYoutubeReadyScorecards.length,
      durable_fresh_youtube_upload_candidates: durableFreshYoutubeReadyScorecards.length,
      catch_up_only_green_candidates: catchUpOnlyGreenCandidates.length,
      shorts_attention_ready_candidates: shortsAttentionReadyCandidates.length,
      shorts_feed_standout_candidates: shortsFeedStandoutCandidates.length,
      metadata_attention_blocked_candidates: metadataAttentionBlockedCandidates.length,
      platform_copy_blocked_candidates: platformCopyBlockedCandidates.length,
      thumbnail_attention_blocked_candidates: thumbnailAttentionBlockedCandidates.length,
      shorts_feed_competition_blocked_candidates: shortsFeedCompetitionBlockedCandidates.length,
      ready_candidates_expiring_within_24h: readyExpiringWithin24h.length,
      ready_candidates_source_age_expired: readyExpired.length,
      ready_candidates_missing_source_age: readyMissingSourceAge.length,
      non_ready_candidates_expiring_within_24h: nonReadyExpiringWithin24h.length,
      non_ready_candidates_source_age_expired: nonReadyExpired.length,
      scheduler_quarantined_candidates: schedulerQuarantinedCandidates.length,
      scheduler_quarantine_reasons: schedulerQuarantineReasons,
      transcript_audience_rewrite_required: Number(transcriptBacklog.summary.rewrite_required || 0),
      transcript_backlog_current_candidates: transcriptCurrentBacklog,
      transcript_backlog_ready_candidates: transcriptReadyBacklog,
      transcript_clean_green_ready_candidates: transcriptCleanReadyCandidates.length,
      current_green_proof_package_candidates: currentGreenProofPackageCandidates.length,
      terminal_duplicate_blocked_action_count: terminalDuplicateActionKeys.size,
      terminal_duplicate_platform_blocked_candidate_count: terminalDuplicatePlatformBlockedCandidates.length,
      source_safe_candidates: sourceSafeCandidates.length,
      v4_ready_candidates: v4ReadyCandidates.length,
      duplicate_group_count: duplicateGroups.length,
      official_watchlist_sources: watchlist.sources.filter((source) => /^official/.test(source.tier)).length,
      major_media_sources: watchlist.sources.filter((source) => source.tier === "major_media").length,
      motion_capacity_stories: motionCapacityById.size,
      motion_capacity_repairable_candidates: motionRepairableCandidates.length,
      motion_capacity_actionable_repairable_candidates: actionableMotionRepairableCandidates.length,
      motion_capacity_repeat_or_stale_repairable_candidates: motionOnlyRepairableCandidates.length,
      motion_capacity_source_metadata_repairable_candidates: motionReadySourceMetadataRepairableCandidates.length,
      motion_capacity_operator_required_candidates: motionOperatorRequiredCandidates.length,
      motion_capacity_near_ready_candidates: motionNearReadyCandidates.length,
    },
    youtube_upload_runway: youtubeUploadRunway,
    shorts_attention: {
      target: greenReadyTarget,
      ready_candidates: shortsAttentionReadyCandidates.length,
      standout_candidates: shortsFeedStandoutCandidates.length,
      metadata_blocked_candidates: metadataAttentionBlockedCandidates.length,
      platform_copy_blocked_candidates: platformCopyBlockedCandidates.length,
      thumbnail_blocked_candidates: thumbnailAttentionBlockedCandidates.length,
      feed_competition_blocked_candidates: shortsFeedCompetitionBlockedCandidates.length,
      blocked_examples: metadataAttentionBlockedCandidates.slice(0, 10).map((candidate) => ({
        story_id: clean(candidate.id),
        title: clean(candidate.title),
        blockers: candidateAttentionBlockers(candidate),
      })),
    },
    official_source_watchlist: watchlist,
    candidate_buffer: buffer,
    refill_action_plan: refillActionPlan,
    transcript_backlog: transcriptBacklog,
    dedupe: {
      duplicate_group_count: duplicateGroups.length,
      groups: duplicateGroups.slice(0, 20),
    },
    priority_scorecards: priorityScorecards.slice(0, 30),
    blockers,
    warnings,
    next_action: blockers.length
      ? motionReadySourceMetadataRepairableCandidates.length
        ? "repair_source_metadata_for_motion_ready_candidates"
        : blockers.includes("fresh_youtube_upload_candidate_buffer_empty")
        ? "refill_fresh_youtube_short_candidates_before_next_publish_window"
        : "repair_candidate_supply_sources_before_scheduler_expansion"
      : transcriptCurrentBacklog > 0
        ? "repair_transcript_backlog_and_refill_green_candidate_buffer"
      : motionReadySourceMetadataRepairableCandidates.length
        ? "repair_source_metadata_for_motion_ready_candidates"
      : actionableMotionRepairableCandidates.length && transcriptCleanReadyCandidates.length < greenReadyTarget
        ? "promote_motion_repairable_candidates_with_official_direct_media"
      : refreshBeforeExpiry
        ? "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog"
      : youtubeUploadRunway.status && youtubeUploadRunway.status !== "covered_with_reserve"
        ? youtubeUploadRunway.next_action
      : warnings.length
        ? "run_or_wait_for_hunt_cycle_and_recheck_fresh_source_backed_supply"
        : "keep_candidate_supply_engine_on_daily_ops_cadence",
    safety: {
      read_only: true,
      no_hunt_triggered: true,
      no_db_mutation: true,
      no_oauth_triggered: true,
      no_token_mutation: true,
      no_social_uploads: true,
      no_public_posts: true,
    },
  };
}

function formatCandidateSupplyMarkdown(report = {}) {
  const lines = [
    "# Candidate Supply Engine",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${String(report.verdict || "unknown").toUpperCase()}`,
    "",
    "## Targets",
    "",
    `- Fresh source-backed stories per day: ${report.summary?.fresh_source_backed_stories_24h ?? 0}/${report.targets?.fresh_source_backed_stories_per_day ?? 0}`,
    `- Clean GREEN-ready candidates: ${report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`,
    `- Raw preflight GREEN candidates: ${report.summary?.raw_preflight_green_ready_candidates ?? report.summary?.green_ready_candidates ?? 0}`,
    `- Durable GREEN-ready candidates: ${report.summary?.durable_green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`,
    `- Shorts attention-ready candidates: ${report.summary?.shorts_attention_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`,
    `- Shorts feed standout candidates: ${report.summary?.shorts_feed_standout_candidates ?? 0}`,
    `- Metadata attention blockers: ${report.summary?.metadata_attention_blocked_candidates ?? 0}`,
    `- Fresh YouTube-ready candidates: ${report.summary?.fresh_youtube_upload_candidates ?? 0}/${report.youtube_upload_runway?.publish_windows_24h ?? 0}`,
    `- Catch-up-only GREEN candidates: ${report.summary?.catch_up_only_green_candidates ?? 0}`,
    `- Terminal duplicate-held candidates: ${report.summary?.terminal_duplicate_platform_blocked_candidate_count ?? 0}`,
    `- Source-safe candidates: ${report.summary?.source_safe_candidates ?? 0}/${report.targets?.source_safe_candidates ?? 0}`,
    `- V4-ready candidates: ${report.summary?.v4_ready_candidates ?? 0}/${report.targets?.v4_ready_candidates ?? 0}`,
    `- Motion repairable candidates: ${report.summary?.motion_capacity_repairable_candidates ?? 0}`,
    `- Source metadata repairable motion-ready candidates: ${report.summary?.motion_capacity_source_metadata_repairable_candidates ?? 0}`,
    `- Scheduler-quarantined stale backlog: ${report.summary?.scheduler_quarantined_candidates ?? 0}`,
    "",
    "## Source Network",
    "",
    `- Official sources: ${report.summary?.official_watchlist_sources ?? 0}`,
    `- Major media sources: ${report.summary?.major_media_sources ?? 0}`,
    `- Duplicate groups: ${report.dedupe?.duplicate_group_count ?? 0}`,
    "",
    "## Top Priority Scorecards",
    "",
  ];
  for (const item of asArray(report.priority_scorecards).slice(0, 8)) {
    const risk = item.repeat_or_stale_risk ? " - repeat/stale risk" : "";
    lines.push(`- ${item.story_id}: ${item.title} (${item.score})${risk}`);
  }
  if (!asArray(report.priority_scorecards).length) lines.push("- none");
  lines.push("", "## Transcript Backlog", "");
  lines.push(`- Audited transcripts: ${report.transcript_backlog?.summary?.audited_transcripts ?? 0}`);
  lines.push(`- Rewrite required: ${report.transcript_backlog?.summary?.rewrite_required ?? 0}`);
  lines.push(`- Current candidate rewrites: ${report.transcript_backlog?.summary?.current_candidate_rewrite_count ?? 0}`);
  lines.push(`- Clean GREEN-ready candidates: ${report.summary?.transcript_clean_green_ready_candidates ?? report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`);
  for (const item of asArray(report.transcript_backlog?.current_candidates).slice(0, 8)) {
    lines.push(`- ${item.story_id}: ${item.title} (${asArray(item.blockers).slice(0, 2).join(", ") || "rewrite_required"})`);
  }
  if (!asArray(report.transcript_backlog?.current_candidates).length) lines.push("- none");
  lines.push("", "## Motion Capacity", "");
  lines.push(`- Motion-capacity stories tracked: ${report.summary?.motion_capacity_stories ?? 0}`);
  lines.push(`- Repairable with direct/official media: ${report.summary?.motion_capacity_repairable_candidates ?? 0}`);
  lines.push(`- Near-ready motion candidates: ${report.summary?.motion_capacity_near_ready_candidates ?? 0}`);
  lines.push(`- Operator/licence required: ${report.summary?.motion_capacity_operator_required_candidates ?? 0}`);
  const motionScorecards = asArray(report.priority_scorecards).filter((scorecard) => scorecard.motion_capacity);
  for (const item of motionScorecards.slice(0, 8)) {
    const motion = item.motion_capacity || {};
    lines.push(
      `- ${item.story_id}: ${motion.repair_priority || "unknown"}; clips ${motion.current_motion_clips ?? 0}/${motion.required_motion_clips ?? 0}; families ${motion.current_motion_families ?? 0}/${motion.required_motion_families ?? 0}`,
    );
  }
  if (!motionScorecards.length) lines.push("- none");
  const refillPlan = report.refill_action_plan || {};
  lines.push("", "## Refill Action Plan", "");
  lines.push(`- Status: ${refillPlan.status || "unknown"}`);
  lines.push(`- Reason: ${refillPlan.reason || "unknown"}`);
  lines.push(`- Minimum new GREEN candidates: ${refillPlan.minimum_new_green_candidates ?? 0}`);
  lines.push(`- Recommended refill limit: ${refillPlan.recommended_refill_limit ?? 0}`);
  lines.push(`- Recommended RSS per feed: ${refillPlan.recommended_rss_per_feed ?? 0}`);
  lines.push(`- Safe command: ${refillPlan.safe_refill_command || "none"}`);
  lines.push("", "## Blockers", "");
  for (const blocker of asArray(report.blockers)) lines.push(`- ${blocker}`);
  if (!asArray(report.blockers).length) lines.push("- none");
  lines.push("", "## Warnings", "");
  for (const warning of asArray(report.warnings)) lines.push(`- ${warning}`);
  if (!asArray(report.warnings).length) lines.push("- none");
  lines.push("", `Next action: ${report.next_action || "unknown"}`, "");
  return lines.join("\n");
}

function candidateSupplyMonitorNeedsRepair(report = {}) {
  const verdict = normaliseVerdict(report.verdict);
  if (verdict === "red") return true;
  if (verdict !== "amber") return false;
  const runway = report.candidate_buffer?.publish_window_runway || {};
  const youtubeRunway = report.youtube_upload_runway || {};
  if (runway.status && runway.status !== "covered_with_reserve") return true;
  if (youtubeRunway.status && youtubeRunway.status !== "covered_with_reserve") return true;
  return asArray(report.warnings).some((warning) =>
    /green_ready_candidates_below_target|durable_green_ready_candidates_below_target|shorts_attention_ready_candidates_below_target|fresh_youtube_upload_candidates_below_window_target|fresh_youtube_upload_reserve_empty|fresh_youtube_upload_candidates_expiring|source_safe_candidates_below_target|ready_candidates_expiring|non_ready_candidates_expiring|publish_window_reserve_empty|transcript_backlog_|transcript_clean_green_ready_candidates_below_target/i.test(warning),
  );
}

function candidateSupplyMonitorNeedsTranscriptRepair(report = {}) {
  if (Number(report.summary?.transcript_backlog_current_candidates || 0) > 0) return true;
  if (Number(report.summary?.transcript_backlog_ready_candidates || 0) > 0) return true;
  return asArray(report.warnings).some((warning) => /transcript_backlog_/i.test(warning));
}

function candidateSupplyMonitorNeedsFreshIntake(report = {}) {
  const verdict = normaliseVerdict(report.verdict);
  if (verdict === "green") return false;

  const summary = report.summary || {};
  const targets = report.targets || {};
  const runway = report.candidate_buffer?.publish_window_runway || {};
  const youtubeRunway = report.youtube_upload_runway || {};
  const freshSourceTarget = Number(targets.fresh_source_backed_stories_per_day || 10);
  const greenTarget = Number(targets.green_ready_candidates || 10);
  const publishWindows = Number(runway.publish_windows_24h || 5);
  const youtubePublishWindows = Number(youtubeRunway.publish_windows_24h || publishWindows || 5);
  const freshSourceBacked = Number(summary.fresh_source_backed_stories_24h || 0);
  const durableGreen = Number(summary.durable_green_ready_candidates || 0);
  const freshYoutubeReady = Number(summary.fresh_youtube_upload_candidates || 0);
  const durableFreshYoutubeReady = Number(summary.durable_fresh_youtube_upload_candidates || 0);
  const expiringReady = Number(summary.ready_candidates_expiring_within_24h || 0);
  const reserve = Number(runway.reserve_candidates || 0);
  const youtubeReserve = Number(youtubeRunway.reserve_candidates || 0);
  const transcriptCleanGreen = Number.isFinite(Number(summary.transcript_clean_green_ready_candidates))
    ? Number(summary.transcript_clean_green_ready_candidates)
    : Number(summary.green_ready_candidates || 0);
  const transcriptCurrentBacklog = Number(summary.transcript_backlog_current_candidates || 0);

  if (freshSourceBacked < freshSourceTarget) return true;
  if (freshYoutubeReady < youtubePublishWindows) return true;
  if (durableFreshYoutubeReady < youtubePublishWindows) return true;
  if (expiringReady > 0) return true;
  if (durableGreen < Math.min(greenTarget, publishWindows)) return true;
  if (transcriptCurrentBacklog > 0 && transcriptCleanGreen < Math.min(greenTarget, publishWindows)) return true;
  if (runway.status && runway.status !== "covered_with_reserve") return true;
  if (youtubeRunway.status && youtubeRunway.status !== "covered_with_reserve") return true;
  if (reserve === 0 && Number(runway.uncovered_publish_windows_24h || 0) === 0) return true;
  if (youtubeReserve === 0 && Number(youtubeRunway.uncovered_publish_windows_24h || 0) === 0) return true;

  return asArray(report.warnings).some((warning) =>
    /fresh_source_backed_stories_below_daily_target|durable_green_ready_candidates_below_target|shorts_attention_ready_candidates_below_target|fresh_youtube_upload_candidates_below_window_target|fresh_youtube_upload_reserve_empty|fresh_youtube_upload_candidates_expiring|ready_candidates_expiring|publish_window_reserve_empty|green_ready_candidates_below_target|transcript_clean_green_ready_candidates_below_target/i.test(warning),
  );
}

function shouldNotifyCandidateSupplyMonitor(report = {}, payload = {}) {
  const verdict = normaliseVerdict(report.verdict);
  if (payload.post_discord === true || payload.post_discord_always === true) return true;
  if (verdict === "red" && payload.post_discord_on_red === true) return true;
  if (verdict === "amber") {
    return (
      payload.post_discord_on_amber === true ||
      payload.post_discord_on_non_green === true ||
      payload.post_discord_on_red === true
    );
  }
  return false;
}

function formatCandidateSupplyMonitorDiscord(report = {}) {
  const runway = report.candidate_buffer?.publish_window_runway || {};
  const youtubeRunway = report.youtube_upload_runway || {};
  const blockers = asArray(report.blockers);
  const warnings = asArray(report.warnings);
  const cleanGreen = Number(report.summary?.green_ready_candidates || 0);
  const rawGreen = Number(report.summary?.raw_preflight_green_ready_candidates ?? cleanGreen);
  const transcriptCleanGreen = Number(report.summary?.transcript_clean_green_ready_candidates ?? cleanGreen);
  const transcriptHeld = Math.max(0, rawGreen - transcriptCleanGreen);
  const terminalDuplicateHeld = Number(report.summary?.terminal_duplicate_platform_blocked_candidate_count || 0);
  const attentionHeld = Math.max(0, transcriptCleanGreen - cleanGreen - terminalDuplicateHeld);
  const terminalDuplicateLine = terminalDuplicateHeld > 0 ? [`terminal duplicate-held ${terminalDuplicateHeld}`] : [];
  const refillPlan = report.refill_action_plan || {};
  const refillLine = refillPlan.status === "needed"
    ? [`Refill: need ${Number(refillPlan.minimum_new_green_candidates || 0)} GREEN | limit ${Number(refillPlan.recommended_refill_limit || 0)} | rss/feed ${Number(refillPlan.recommended_rss_per_feed || 0)}`]
    : [];
  const sourceMetadataRepairLine = Number(report.summary?.motion_capacity_source_metadata_repairable_candidates || 0) > 0
    ? [`Source metadata repair: ${Number(report.summary.motion_capacity_source_metadata_repairable_candidates)}`]
    : [];
  return [
    "**Pulse Candidate Supply Monitor**",
    `Status: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Fresh source-backed 24h: ${report.summary?.fresh_source_backed_stories_24h || 0}/${report.targets?.fresh_source_backed_stories_per_day || 0}`,
    `Clean GREEN: ${cleanGreen}/${report.targets?.green_ready_candidates || 0} (raw preflight ${rawGreen}; transcript-held ${transcriptHeld}; attention-held ${attentionHeld})`,
    ...terminalDuplicateLine,
    `Durable GREEN: ${report.summary?.durable_green_ready_candidates || 0}/${report.targets?.green_ready_candidates || 0}`,
    `Shorts attention: ready ${report.summary?.shorts_attention_ready_candidates || 0}/${report.targets?.green_ready_candidates || 0} | standout ${report.summary?.shorts_feed_standout_candidates || 0} | blocked ${report.summary?.metadata_attention_blocked_candidates || 0}`,
    `Fresh YouTube-ready: ${report.summary?.fresh_youtube_upload_candidates || 0}/${Number(youtubeRunway.publish_windows_24h || 0)} | catch-up-only ${report.summary?.catch_up_only_green_candidates || 0}`,
    `Runway: ${Number(runway.covered_publish_windows_24h || 0)}/${Number(runway.publish_windows_24h || 0)} windows | reserve ${Number(runway.reserve_candidates || 0)}/${Number(runway.reserve_target || 0)}`,
    `YouTube runway: ${Number(youtubeRunway.covered_publish_windows_24h || 0)}/${Number(youtubeRunway.publish_windows_24h || 0)} windows | reserve ${Number(youtubeRunway.reserve_candidates || 0)}/${Number(youtubeRunway.reserve_target || 0)}`,
    `Source-safe: ${report.summary?.source_safe_candidates || 0}/${report.targets?.source_safe_candidates || 0} | V4-ready: ${report.summary?.v4_ready_candidates || 0}/${report.targets?.v4_ready_candidates || 0}`,
    `Transcript backlog: ${report.summary?.transcript_backlog_current_candidates || 0} current | clean GREEN ${report.summary?.transcript_clean_green_ready_candidates ?? report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates || 0}`,
    `Motion repairable: ${report.summary?.motion_capacity_repairable_candidates || 0} | near-ready ${report.summary?.motion_capacity_near_ready_candidates || 0} | operator ${report.summary?.motion_capacity_operator_required_candidates || 0}`,
    ...sourceMetadataRepairLine,
    ...refillLine,
    `Quarantined stale backlog: ${report.summary?.scheduler_quarantined_candidates || 0}`,
    `Blockers: ${blockers.slice(0, 4).join("; ") || "none"}`,
    `Warnings: ${warnings.slice(0, 4).join("; ") || "none"}`,
    `Next: ${report.next_action || "unknown"}`,
    "Safety: monitor/repair only; no manual publish, no token changes, disabled platforms stay deferred.",
  ].join("\n").slice(0, 1900);
}

module.exports = {
  buildCandidateSupplyReport,
  buildMotionCapacityIndex,
  buildOfficialSourceWatchlist,
  candidateSupplyMonitorNeedsFreshIntake,
  candidateSupplyMonitorNeedsRepair,
  candidateSupplyMonitorNeedsTranscriptRepair,
  currentProofPackageEvidence,
  candidateIsReady,
  candidateIsSourceSafe,
  candidateIsV4Ready,
  fingerprintTitle,
  formatCandidateSupplyMonitorDiscord,
  formatCandidateSupplyMarkdown,
  groupDuplicateStories,
  hydrateCandidateFromCurrentProofPackage,
  scorePriority,
  shouldNotifyCandidateSupplyMonitor,
};
