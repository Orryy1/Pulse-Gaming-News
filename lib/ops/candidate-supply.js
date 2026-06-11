"use strict";

const { buildCandidateBuffer } = require("./normal-operations");

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
  const value = story.published_at || story.created_at || story.timestamp || story.updated_at;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function sourceLabel(story = {}) {
  return clean(story.source || story.source_name || story.subreddit || story.feed || story.source_type || "unknown");
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

function scorePriority(candidate = {}, storiesById = new Map(), now = new Date()) {
  const story = storiesById.get(clean(candidate.id)) || {};
  const timestamp = storyTimestampMs(story);
  const ageHours = timestamp ? Math.max(0, (now.getTime() - timestamp) / 36e5) : null;
  const freshness = ageHours === null ? 10 : ageHours <= 24 ? 25 : ageHours <= 48 ? 18 : ageHours <= 96 ? 10 : 4;
  const sourceConfidence = isSourceBacked(story) || lower(candidate.source?.source_type) === "rss" ? 22 : 8;
  const visualAvailability = candidateIsV4Ready(candidate) ? 22 : clean(candidate.source?.exported_path || candidate.exported_path) ? 12 : 0;
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
    age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    publish_ready: candidateIsReady(candidate),
    source_safe: candidateIsSourceSafe(candidate),
    v4_ready: candidateIsV4Ready(candidate),
    source: clean(candidate.source?.source_type || story.source_type || sourceLabel(story)),
  };
}

function buildCandidateSupplyReport({
  stories = [],
  candidateReport = {},
  channelConfig = {},
  now = new Date(),
  targets = {},
} = {}) {
  const watchlist = buildOfficialSourceWatchlist(channelConfig);
  const buffer = buildCandidateBuffer(candidateReport, {
    readyCandidates: targets.greenReadyCandidates || 10,
    sourceSafeCandidates: targets.sourceSafeCandidates || 6,
    v4ReadyCandidates: targets.v4ReadyCandidates || 3,
  });
  const candidates = asArray(candidateReport.candidates);
  const readyCandidates = candidates.filter(candidateIsReady);
  const sourceSafeCandidates = readyCandidates.filter(candidateIsSourceSafe);
  const v4ReadyCandidates = readyCandidates.filter(candidateIsV4Ready);
  const storiesById = new Map(asArray(stories).map((story) => [clean(story.id), story]));
  const nowDate = now instanceof Date ? now : new Date(now);
  const freshStories = asArray(stories).filter((story) => {
    const timestamp = storyTimestampMs(story);
    return timestamp && nowDate.getTime() - timestamp <= 24 * 60 * 60 * 1000;
  });
  const freshSourceBacked = freshStories.filter(isSourceBacked);
  const duplicateGroups = groupDuplicateStories(stories);
  const priorityScorecards = candidates
    .map((candidate) => scorePriority(candidate, storiesById, nowDate))
    .sort((a, b) => b.score - a.score);
  const blockers = [];
  const warnings = [];

  if (watchlist.sources.filter((source) => /^official/.test(source.tier)).length < 8) blockers.push("official_source_watchlist_too_thin");
  if (readyCandidates.length === 0) blockers.push("green_ready_candidate_buffer_empty");
  if (readyCandidates.length < Number(targets.greenReadyCandidates || 10)) warnings.push(`green_ready_candidates_below_target:${readyCandidates.length}/${targets.greenReadyCandidates || 10}`);
  if (sourceSafeCandidates.length < Number(targets.sourceSafeCandidates || 6)) warnings.push(`source_safe_candidates_below_target:${sourceSafeCandidates.length}/${targets.sourceSafeCandidates || 6}`);
  if (v4ReadyCandidates.length < Number(targets.v4ReadyCandidates || 3)) warnings.push(`v4_ready_candidates_below_target:${v4ReadyCandidates.length}/${targets.v4ReadyCandidates || 3}`);
  if (freshSourceBacked.length < Number(targets.freshSourceBackedStories || 10)) warnings.push(`fresh_source_backed_stories_below_daily_target:${freshSourceBacked.length}/${targets.freshSourceBackedStories || 10}`);

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
      green_ready_candidates: readyCandidates.length,
      source_safe_candidates: sourceSafeCandidates.length,
      v4_ready_candidates: v4ReadyCandidates.length,
      duplicate_group_count: duplicateGroups.length,
      official_watchlist_sources: watchlist.sources.filter((source) => /^official/.test(source.tier)).length,
      major_media_sources: watchlist.sources.filter((source) => source.tier === "major_media").length,
    },
    official_source_watchlist: watchlist,
    candidate_buffer: buffer,
    dedupe: {
      duplicate_group_count: duplicateGroups.length,
      groups: duplicateGroups.slice(0, 20),
    },
    priority_scorecards: priorityScorecards.slice(0, 30),
    blockers,
    warnings,
    next_action: blockers.length
      ? "repair_candidate_supply_sources_before_scheduler_expansion"
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
    `- GREEN-ready candidates: ${report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`,
    `- Source-safe candidates: ${report.summary?.source_safe_candidates ?? 0}/${report.targets?.source_safe_candidates ?? 0}`,
    `- V4-ready candidates: ${report.summary?.v4_ready_candidates ?? 0}/${report.targets?.v4_ready_candidates ?? 0}`,
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
    lines.push(`- ${item.story_id}: ${item.title} (${item.score})`);
  }
  if (!asArray(report.priority_scorecards).length) lines.push("- none");
  lines.push("", "## Blockers", "");
  for (const blocker of asArray(report.blockers)) lines.push(`- ${blocker}`);
  if (!asArray(report.blockers).length) lines.push("- none");
  lines.push("", "## Warnings", "");
  for (const warning of asArray(report.warnings)) lines.push(`- ${warning}`);
  if (!asArray(report.warnings).length) lines.push("- none");
  lines.push("", `Next action: ${report.next_action || "unknown"}`, "");
  return lines.join("\n");
}

module.exports = {
  buildCandidateSupplyReport,
  buildOfficialSourceWatchlist,
  candidateIsReady,
  candidateIsSourceSafe,
  candidateIsV4Ready,
  fingerprintTitle,
  formatCandidateSupplyMarkdown,
  groupDuplicateStories,
  scorePriority,
};
