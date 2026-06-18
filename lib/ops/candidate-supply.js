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

function transcriptAudienceBacklog(transcriptAudienceReport = {}, candidateReport = {}) {
  const candidates = asArray(candidateReport.candidates);
  const candidatesById = new Map(candidates.map((candidate) => [clean(candidate.id), candidate]));
  const rewriteRows = asArray(transcriptAudienceReport?.stories)
    .filter((story) => clean(story.verdict) && clean(story.verdict) !== "pass")
    .map((story) => {
      const storyId = clean(story.story_id || story.id);
      const candidate = candidatesById.get(storyId);
      return {
        story_id: storyId,
        title: clean(story.title || candidate?.title),
        verdict: clean(story.verdict),
        blockers: asArray(story.blockers).map(clean).filter(Boolean),
        viral_score: numberOrNull(story.viral_score),
        current_candidate: Boolean(candidate),
        publish_ready_candidate: candidate ? candidateIsReady(candidate) : false,
        source_safe_candidate: candidate ? candidateIsSourceSafe(candidate) : false,
        v4_ready_candidate: candidate ? candidateIsV4Ready(candidate) : false,
      };
    })
    .filter((story) => story.story_id);
  const current = rewriteRows.filter((story) => story.current_candidate);
  const ready = rewriteRows.filter((story) => story.publish_ready_candidate);

  return {
    generated_at: transcriptAudienceReport?.generated_at || null,
    summary: {
      audited_transcripts: Number(transcriptAudienceReport?.summary?.total || rewriteRows.length || 0),
      pass: Number(transcriptAudienceReport?.summary?.pass || 0),
      rewrite_required: Number(transcriptAudienceReport?.summary?.rewrite_required || rewriteRows.length || 0),
      current_candidate_rewrite_count: current.length,
      ready_candidate_rewrite_count: ready.length,
      historical_rewrite_count: Math.max(0, rewriteRows.length - current.length),
    },
    current_candidates: current.slice(0, 20),
    ready_candidates: ready.slice(0, 20),
    historical_rewrite_required: rewriteRows.filter((story) => !story.current_candidate).slice(0, 20),
  };
}

function scorePriority(candidate = {}, storiesById = new Map(), now = new Date()) {
  const story = storiesById.get(clean(candidate.id)) || {};
  const age = sourceAgeMetadata(candidate, story, now);
  const ageHours = age.age_hours;
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
    age_hours: age.age_hours,
    source_age_policy_hours: age.source_age_policy_hours,
    source_age_expires_in_hours: age.source_age_expires_in_hours,
    source_age_state: age.source_age_state,
    publish_ready: candidateIsReady(candidate),
    source_safe: candidateIsSourceSafe(candidate),
    v4_ready: candidateIsV4Ready(candidate),
    source: clean(candidate.source?.source_type || story.source_type || sourceLabel(story)),
  };
}

function buildCandidateSupplyReport({
  stories = [],
  candidateReport = {},
  transcriptAudienceReport = null,
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
  const transcriptBacklog = transcriptAudienceBacklog(transcriptAudienceReport, candidateReport);
  const transcriptBlockedReadyIds = new Set(
    asArray(transcriptBacklog.ready_candidates).map((item) => clean(item.story_id)),
  );
  const transcriptCleanReadyCandidates = readyCandidates.filter(
    (candidate) => !transcriptBlockedReadyIds.has(clean(candidate.id)),
  );
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
  const readyIds = new Set(readyCandidates.map((candidate) => clean(candidate.id)));
  const readyScorecards = priorityScorecards.filter((item) => readyIds.has(clean(item.story_id)));
  const nonReadyScorecards = priorityScorecards.filter((item) => !readyIds.has(clean(item.story_id)));
  const readyExpiringWithin24h = readyScorecards.filter((item) => item.source_age_state === "expiring_within_24h");
  const readyExpired = readyScorecards.filter((item) => item.source_age_state === "expired");
  const readyMissingSourceAge = readyScorecards.filter((item) => item.source_age_state === "unknown");
  const durableReadyCandidates = readyScorecards.filter(
    (item) => item.source_age_state === "fresh" && Number(item.source_age_expires_in_hours) > 24,
  );
  const nonReadyExpiringWithin24h = nonReadyScorecards.filter((item) => item.source_age_state === "expiring_within_24h");
  const nonReadyExpired = nonReadyScorecards.filter((item) => item.source_age_state === "expired");
  const blockers = [];
  const warnings = [];
  const greenReadyTarget = Number(targets.greenReadyCandidates || 10);
  const transcriptCurrentBacklog = Number(transcriptBacklog.summary.current_candidate_rewrite_count || 0);
  const transcriptReadyBacklog = Number(transcriptBacklog.summary.ready_candidate_rewrite_count || 0);

  if (watchlist.sources.filter((source) => /^official/.test(source.tier)).length < 8) blockers.push("official_source_watchlist_too_thin");
  if (readyCandidates.length === 0) blockers.push("green_ready_candidate_buffer_empty");
  if (readyCandidates.length < greenReadyTarget) warnings.push(`green_ready_candidates_below_target:${readyCandidates.length}/${greenReadyTarget}`);
  if (transcriptCurrentBacklog > 0) warnings.push(`transcript_backlog_current_candidates:${transcriptCurrentBacklog}`);
  if (transcriptReadyBacklog > 0) warnings.push(`transcript_backlog_ready_candidates:${transcriptReadyBacklog}`);
  if (transcriptCleanReadyCandidates.length < greenReadyTarget) warnings.push(`transcript_clean_green_ready_candidates_below_target:${transcriptCleanReadyCandidates.length}/${greenReadyTarget}`);
  if (sourceSafeCandidates.length < Number(targets.sourceSafeCandidates || 6)) warnings.push(`source_safe_candidates_below_target:${sourceSafeCandidates.length}/${targets.sourceSafeCandidates || 6}`);
  if (v4ReadyCandidates.length < Number(targets.v4ReadyCandidates || 3)) warnings.push(`v4_ready_candidates_below_target:${v4ReadyCandidates.length}/${targets.v4ReadyCandidates || 3}`);
  if (freshSourceBacked.length < Number(targets.freshSourceBackedStories || 10)) warnings.push(`fresh_source_backed_stories_below_daily_target:${freshSourceBacked.length}/${targets.freshSourceBackedStories || 10}`);
  if (readyExpiringWithin24h.length) warnings.push(`ready_candidates_expiring_within_24h:${readyExpiringWithin24h.length}`);
  if (readyExpired.length) blockers.push(`ready_candidates_source_age_expired:${readyExpired.length}`);
  if (readyMissingSourceAge.length) warnings.push(`ready_candidates_missing_source_age:${readyMissingSourceAge.length}`);
  if (nonReadyExpiringWithin24h.length) warnings.push(`non_ready_candidates_expiring_within_24h:${nonReadyExpiringWithin24h.length}`);
  if (nonReadyExpired.length) warnings.push(`non_ready_candidates_source_age_expired:${nonReadyExpired.length}`);
  if (durableReadyCandidates.length < greenReadyTarget) warnings.push(`durable_green_ready_candidates_below_target:${durableReadyCandidates.length}/${greenReadyTarget}`);

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
      green_ready_candidates: readyCandidates.length,
      durable_green_ready_candidates: durableReadyCandidates.length,
      ready_candidates_expiring_within_24h: readyExpiringWithin24h.length,
      ready_candidates_source_age_expired: readyExpired.length,
      ready_candidates_missing_source_age: readyMissingSourceAge.length,
      non_ready_candidates_expiring_within_24h: nonReadyExpiringWithin24h.length,
      non_ready_candidates_source_age_expired: nonReadyExpired.length,
      transcript_audience_rewrite_required: Number(transcriptBacklog.summary.rewrite_required || 0),
      transcript_backlog_current_candidates: transcriptCurrentBacklog,
      transcript_backlog_ready_candidates: transcriptReadyBacklog,
      transcript_clean_green_ready_candidates: transcriptCleanReadyCandidates.length,
      source_safe_candidates: sourceSafeCandidates.length,
      v4_ready_candidates: v4ReadyCandidates.length,
      duplicate_group_count: duplicateGroups.length,
      official_watchlist_sources: watchlist.sources.filter((source) => /^official/.test(source.tier)).length,
      major_media_sources: watchlist.sources.filter((source) => source.tier === "major_media").length,
    },
    official_source_watchlist: watchlist,
    candidate_buffer: buffer,
    transcript_backlog: transcriptBacklog,
    dedupe: {
      duplicate_group_count: duplicateGroups.length,
      groups: duplicateGroups.slice(0, 20),
    },
    priority_scorecards: priorityScorecards.slice(0, 30),
    blockers,
    warnings,
    next_action: blockers.length
      ? "repair_candidate_supply_sources_before_scheduler_expansion"
      : transcriptCurrentBacklog > 0
        ? "repair_transcript_backlog_and_refill_green_candidate_buffer"
      : refreshBeforeExpiry
        ? "refresh_fresh_source_intake_and_promote_new_green_candidates_before_expiring_backlog"
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
    `- Durable GREEN-ready candidates: ${report.summary?.durable_green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`,
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
  lines.push("", "## Transcript Backlog", "");
  lines.push(`- Audited transcripts: ${report.transcript_backlog?.summary?.audited_transcripts ?? 0}`);
  lines.push(`- Rewrite required: ${report.transcript_backlog?.summary?.rewrite_required ?? 0}`);
  lines.push(`- Current candidate rewrites: ${report.transcript_backlog?.summary?.current_candidate_rewrite_count ?? 0}`);
  lines.push(`- Clean GREEN-ready candidates: ${report.summary?.transcript_clean_green_ready_candidates ?? report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates ?? 0}`);
  for (const item of asArray(report.transcript_backlog?.current_candidates).slice(0, 8)) {
    lines.push(`- ${item.story_id}: ${item.title} (${asArray(item.blockers).slice(0, 2).join(", ") || "rewrite_required"})`);
  }
  if (!asArray(report.transcript_backlog?.current_candidates).length) lines.push("- none");
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
  if (runway.status && runway.status !== "covered_with_reserve") return true;
  return asArray(report.warnings).some((warning) =>
    /green_ready_candidates_below_target|durable_green_ready_candidates_below_target|source_safe_candidates_below_target|ready_candidates_expiring|non_ready_candidates_expiring|publish_window_reserve_empty|transcript_backlog_|transcript_clean_green_ready_candidates_below_target/i.test(warning),
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
  const freshSourceTarget = Number(targets.fresh_source_backed_stories_per_day || 10);
  const greenTarget = Number(targets.green_ready_candidates || 10);
  const publishWindows = Number(runway.publish_windows_24h || 5);
  const freshSourceBacked = Number(summary.fresh_source_backed_stories_24h || 0);
  const durableGreen = Number(summary.durable_green_ready_candidates || 0);
  const expiringReady = Number(summary.ready_candidates_expiring_within_24h || 0);
  const reserve = Number(runway.reserve_candidates || 0);
  const transcriptCleanGreen = Number.isFinite(Number(summary.transcript_clean_green_ready_candidates))
    ? Number(summary.transcript_clean_green_ready_candidates)
    : Number(summary.green_ready_candidates || 0);
  const transcriptCurrentBacklog = Number(summary.transcript_backlog_current_candidates || 0);

  if (freshSourceBacked < freshSourceTarget) return true;
  if (expiringReady > 0) return true;
  if (durableGreen < Math.min(greenTarget, publishWindows)) return true;
  if (transcriptCurrentBacklog > 0 && transcriptCleanGreen < Math.min(greenTarget, publishWindows)) return true;
  if (runway.status && runway.status !== "covered_with_reserve") return true;
  if (reserve === 0 && Number(runway.uncovered_publish_windows_24h || 0) === 0) return true;

  return asArray(report.warnings).some((warning) =>
    /fresh_source_backed_stories_below_daily_target|durable_green_ready_candidates_below_target|ready_candidates_expiring|publish_window_reserve_empty|green_ready_candidates_below_target|transcript_clean_green_ready_candidates_below_target/i.test(warning),
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
  const blockers = asArray(report.blockers);
  const warnings = asArray(report.warnings);
  return [
    "**Pulse Candidate Supply Monitor**",
    `Status: ${String(report.verdict || "unknown").toUpperCase()}`,
    `Fresh source-backed 24h: ${report.summary?.fresh_source_backed_stories_24h || 0}/${report.targets?.fresh_source_backed_stories_per_day || 0}`,
    `GREEN-ready: ${report.summary?.green_ready_candidates || 0}/${report.targets?.green_ready_candidates || 0}`,
    `Durable GREEN: ${report.summary?.durable_green_ready_candidates || 0}/${report.targets?.green_ready_candidates || 0}`,
    `Runway: ${Number(runway.covered_publish_windows_24h || 0)}/${Number(runway.publish_windows_24h || 0)} windows | reserve ${Number(runway.reserve_candidates || 0)}/${Number(runway.reserve_target || 0)}`,
    `Source-safe: ${report.summary?.source_safe_candidates || 0}/${report.targets?.source_safe_candidates || 0} | V4-ready: ${report.summary?.v4_ready_candidates || 0}/${report.targets?.v4_ready_candidates || 0}`,
    `Transcript backlog: ${report.summary?.transcript_backlog_current_candidates || 0} current | clean GREEN ${report.summary?.transcript_clean_green_ready_candidates ?? report.summary?.green_ready_candidates ?? 0}/${report.targets?.green_ready_candidates || 0}`,
    `Blockers: ${blockers.slice(0, 4).join("; ") || "none"}`,
    `Warnings: ${warnings.slice(0, 4).join("; ") || "none"}`,
    `Next: ${report.next_action || "unknown"}`,
    "Safety: monitor/repair only; no manual publish, no token changes, disabled platforms stay deferred.",
  ].join("\n").slice(0, 1900);
}

module.exports = {
  buildCandidateSupplyReport,
  buildOfficialSourceWatchlist,
  candidateSupplyMonitorNeedsFreshIntake,
  candidateSupplyMonitorNeedsRepair,
  candidateSupplyMonitorNeedsTranscriptRepair,
  candidateIsReady,
  candidateIsSourceSafe,
  candidateIsV4Ready,
  fingerprintTitle,
  formatCandidateSupplyMonitorDiscord,
  formatCandidateSupplyMarkdown,
  groupDuplicateStories,
  scorePriority,
  shouldNotifyCandidateSupplyMonitor,
};
