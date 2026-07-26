#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  augmentStoriesWithRevenuePaths,
  buildGoalBatchPackages,
  writeGoalBatchPackages,
} = require("../lib/goal-batch-packages");
const { fetchRssProofStories } = require("../lib/goal-rss-proof-ingest");
const {
  buildSourceFingerprint,
  buildZeroYieldExclusions,
  readZeroYieldQuarantine,
} = require("../lib/refill-zero-yield-quarantine");
const pulseGamingChannel = require("../channels/pulse-gaming");

const ROOT = path.resolve(__dirname, "..");
const MAX_LIVE_RSS_FETCH_PER_FEED = 30;

function dotenvSkipped() {
  return /^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""));
}

function loadDotenvForCli() {
  if (dotenvSkipped()) return;
  try {
    require("dotenv").config({ override: false });
  } catch {}
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storiesFile: path.join(ROOT, "daily_news.json"),
    revenuePathsFile: path.join(ROOT, "output", "revenue", "revenue-paths.json"),
    v4MotionPackDir: path.join(ROOT, "output", "studio-v4", "motion-packs"),
    videoCacheDir: path.join(ROOT, "output", "video_cache"),
    sfxAssetsPath: path.join(ROOT, "output", "goal-contract", "sfx_asset_inventory.json"),
    sfxRightsLedgerPath: path.join(ROOT, "output", "goal-contract", "sfx_rights_ledger.json"),
    storiesFileExplicit: false,
    limit: 30,
    outDir: path.join(ROOT, "output", "goal-proof", "batch"),
    existingArtifactRoot: null,
    contractOutDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    liveRss: false,
    liveRssOnly: false,
    rssPerFeed: 8,
    rssOffsetPerFeed: 0,
    dbStories: false,
    storyIds: [],
    excludedStoryIds: [],
    excludedSourceFingerprints: [],
    zeroYieldQuarantineFile: "",
    includePublished: false,
    allowOwnedMotionFallback: false,
    targetPlatforms: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stories-file") {
      args.storiesFile = argv[++i] || args.storiesFile;
      args.storiesFileExplicit = true;
    }
    else if (arg === "--revenue-paths") args.revenuePathsFile = argv[++i] || args.revenuePathsFile;
    else if (arg === "--v4-motion-pack-dir") args.v4MotionPackDir = argv[++i] || args.v4MotionPackDir;
    else if (arg === "--video-cache-dir") args.videoCacheDir = argv[++i] || args.videoCacheDir;
    else if (arg === "--sfx-assets") args.sfxAssetsPath = argv[++i] || "";
    else if (arg === "--sfx-rights-ledger") args.sfxRightsLedgerPath = argv[++i] || "";
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--existing-artifact-root") {
      args.existingArtifactRoot = argv[++i] || args.existingArtifactRoot;
    }
    else if (arg === "--contract-out-dir") args.contractOutDir = argv[++i] || args.contractOutDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--live-rss") args.liveRss = true;
    else if (arg === "--live-rss-only") {
      args.liveRss = true;
      args.liveRssOnly = true;
    }
    else if (arg === "--rss-per-feed") args.rssPerFeed = Number(argv[++i] || args.rssPerFeed);
    else if (arg === "--rss-offset-per-feed") {
      args.rssOffsetPerFeed = Number(argv[++i] || args.rssOffsetPerFeed);
    }
    else if (arg === "--db-stories") args.dbStories = true;
    else if (arg === "--include-published") args.includePublished = true;
    else if (arg === "--allow-owned-motion-fallback") args.allowOwnedMotionFallback = true;
    else if (arg === "--platforms") {
      args.targetPlatforms = String(argv[++i] || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    }
    else if (arg === "--story-id" || arg === "--story" || arg === "--story-ids") {
      args.storyIds.push(...normaliseStoryIds(argv[++i] || ""));
    }
    else if (arg === "--exclude-story-id" || arg === "--exclude-story-ids") {
      args.excludedStoryIds.push(...normaliseStoryIds(argv[++i] || ""));
    }
    else if (arg === "--exclude-source-fingerprint") {
      args.excludedSourceFingerprints.push(...normaliseStoryIds(argv[++i] || ""));
    }
    else if (arg === "--zero-yield-quarantine") {
      args.zeroYieldQuarantineFile = argv[++i] || "";
    }
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function buildLiveRssFetchPlan({
  requestedPerFeed = 8,
  requestedOffsetPerFeed = 0,
  zeroYieldExclusions = {},
} = {}) {
  const requested = Math.max(
    1,
    Math.min(
      MAX_LIVE_RSS_FETCH_PER_FEED,
      Math.floor(Number(requestedPerFeed || 8) || 8),
    ),
  );
  const activeQuarantineCount = Math.max(
    0,
    Math.floor(Number(zeroYieldExclusions.active_entry_count || 0) || 0),
    asStoryArray(zeroYieldExclusions.story_ids).length,
    asStoryArray(zeroYieldExclusions.source_fingerprints).length,
  );
  const uncappedFetchCount = requested + activeQuarantineCount;
  const fetchPerFeed = Math.min(
    MAX_LIVE_RSS_FETCH_PER_FEED,
    uncappedFetchCount,
  );
  return {
    requested_per_feed: requested,
    fetch_per_feed: fetchPerFeed,
    offset_per_feed: Math.max(
      0,
      Math.floor(
        Math.max(
          Number(requestedOffsetPerFeed || 0),
          Number(zeroYieldExclusions.rss_offset_per_feed || 0),
        ),
      ),
    ),
    quarantine_active_entry_count: activeQuarantineCount,
    quarantine_headroom_per_feed: fetchPerFeed - requested,
    capped: uncappedFetchCount > MAX_LIVE_RSS_FETCH_PER_FEED,
  };
}

function buildLiveRssIntakeReport({
  generatedAt = new Date().toISOString(),
  liveRssStories = [],
  selectedStories = [],
  quarantinedStoryIds = [],
  quarantinedSourceFingerprints = [],
  excludedStoryIds = [],
  excludedSourceFingerprints = [],
  fetchPlan = {},
} = {}) {
  const selectedIds = new Set(
    asStoryArray(selectedStories).map(storyIdFor).filter(Boolean),
  );
  const quarantinedIds = new Set(normaliseStoryIds(quarantinedStoryIds));
  const quarantinedSources = new Set(
    normaliseStoryIds(quarantinedSourceFingerprints),
  );
  const excludedIds = new Set(normaliseStoryIds(excludedStoryIds));
  const excludedSources = new Set(
    normaliseStoryIds(excludedSourceFingerprints),
  );
  const rows = asStoryArray(liveRssStories).map((story) => {
    const id = storyIdFor(story);
    const sourceFingerprint = buildSourceFingerprint(story);
    const selected = Boolean(id && selectedIds.has(id));
    const motionGate = liveRssMotionGate(story);
    const repairGate = liveRssRepairIntakeGate(story, motionGate);
    const materializable = liveRssMaterializableDirectMediaEvidence(story);
    let classification = "selected";
    let reasonCodes = [];
    if (!selected && id && quarantinedIds.has(id)) {
      classification = "quarantine_blocked";
      reasonCodes = ["zero_yield_quarantine:story_id"];
    } else if (
      !selected &&
      sourceFingerprint &&
      quarantinedSources.has(sourceFingerprint)
    ) {
      classification = "quarantine_blocked";
      reasonCodes = ["zero_yield_quarantine:source"];
    } else if (
      !selected &&
      (
        (id && excludedIds.has(id)) ||
        (sourceFingerprint && excludedSources.has(sourceFingerprint))
      )
    ) {
      classification = "repeat_published_or_dedupe_blocked";
      reasonCodes = ["not_selected:excluded_published_or_dedupe"];
    } else if (!selected && !motionGate.pass && !repairGate.pass) {
      classification = "motion_gate_blocked";
      reasonCodes = [
        ...motionGate.reasons,
        ...repairGate.reasons,
      ];
    } else if (!selected && !materializable && !repairGate.pass) {
      classification = "motion_gate_blocked";
      reasonCodes = [
        "materializable_direct_media_missing",
        ...repairGate.reasons,
      ];
    } else if (!selected) {
      classification = "repeat_published_or_dedupe_blocked";
      reasonCodes = ["not_selected:repeat_published_or_dedupe"];
    }
    return {
      story_id: id || null,
      title: String(story.title || "").trim() || null,
      source_name:
        String(
          story.source_name ||
            story.primary_source ||
            story.subreddit ||
            "",
        ).trim() || null,
      status: selected ? "selected" : "blocked",
      classification,
      reason_codes: [...new Set(reasonCodes.filter(Boolean))],
      motion_gate: motionGate,
      repair_gate: repairGate,
      materializable_direct_media: materializable,
      source_fingerprint: sourceFingerprint || null,
    };
  });
  return {
    schema_version: 1,
    generated_at: new Date(generatedAt).toISOString(),
    mode: "LIVE_RSS_INTAKE_DIAGNOSTIC",
    fetch_plan: fetchPlan,
    summary: {
      fetched_count: rows.length,
      selected_count: rows.filter((row) => row.status === "selected").length,
      quarantine_blocked_count: rows.filter(
        (row) => row.classification === "quarantine_blocked",
      ).length,
      motion_blocked_count: rows.filter(
        (row) => row.classification === "motion_gate_blocked",
      ).length,
      repeat_published_or_dedupe_blocked_count: rows.filter(
        (row) =>
          row.classification === "repeat_published_or_dedupe_blocked",
      ).length,
    },
    rows,
  };
}

function usage() {
  return [
    "Usage: node tools/goal-batch-packages.js [options]",
    "",
    "Builds local-only governed proof packages for up to 30 stories and writes the /goal story-packages manifest.",
    "It never publishes, mutates DB rows or touches OAuth.",
    "",
    "Options:",
    "  --stories-file <path>       Defaults to daily_news.json",
    "  --revenue-paths <path>      Optional audit-candidate fallback when fewer than --limit stories exist",
    "  --v4-motion-pack-dir <dir>  Hydrates existing Visual V4 gameplay/trailer motion packs",
    "  --video-cache-dir <dir>      Resolves already-materialised V4 clips from local cache",
    "  --sfx-assets <path>          Retained licensed SFX asset inventory JSON; defaults to output/goal-contract/sfx_asset_inventory.json",
    "  --sfx-rights-ledger <path>   Retained licensed SFX rights ledger JSON; defaults to output/goal-contract/sfx_rights_ledger.json",
    "  --limit <n>                 Defaults to 30",
    "  --out-dir <dir>",
    "  --existing-artifact-root <dir>",
    "                              Read prior per-story evidence from this directory without writing into it",
    "  --contract-out-dir <dir>",
    "  --generated-at <iso>",
    "  --live-rss                 Prepend current source-backed RSS proof candidates from Pulse Gaming feeds",
    "  --live-rss-only            Use only current gated live-RSS candidates; prevents stale backlog/revenue fill",
    "  --rss-per-feed <n>          Defaults to 8 when --live-rss is set",
    "  --rss-offset-per-feed <n>   Skip an exhausted leading cohort in every RSS feed",
    "  --db-stories               Read story rows from the configured local DB instead of daily_news.json",
    "  --include-published        Allow live-RSS packaging of stories that already have public publish evidence",
    "  --story-id <id[,id]>        Package only the named story IDs; may be repeated",
    "  --exclude-story-id <id[,id]>",
    "                              Exclude failed story IDs from unattended refill",
    "  --exclude-source-fingerprint <hash[,hash]>",
    "                              Exclude failed source identities even when story IDs change",
    "  --zero-yield-quarantine <path>",
    "                              Load durable rolling story/source exclusions from JSON",
    "  --allow-owned-motion-fallback",
    "                              Use governed owned source-card motion when direct footage is unavailable",
    "  --platforms <csv>          Rights gate scope for explicitly enabled publish platforms",
    "  --json",
  ].join("\n");
}

function asStoryArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.stories)) return value.stories;
  if (Array.isArray(value?.items)) return value.items;
  if (value && typeof value === "object" && storyIdFor(value)) return [value];
  return [];
}

function storyIdFor(story) {
  return String(story?.id || story?.story_id || "").trim();
}

function storySourceTimestampMs(story = {}) {
  const candidates = [
    story.source_published_at,
    story.published_at,
    story.timestamp,
    story.pubDate,
    story.isoDate,
    story.date,
    story.source_manifest?.source_published_at,
    story.source_manifest?.primary_source?.published_at,
    story.primary_source?.published_at,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const ms = new Date(text).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function liveRssSourceFreshnessGate(story = {}, { now = new Date(), policyHours = 168 } = {}) {
  const timestamp = storySourceTimestampMs(story);
  const policy = Number.isFinite(Number(policyHours)) && Number(policyHours) > 0 ? Number(policyHours) : 168;
  if (!timestamp) {
    return {
      pass: true,
      state: "unknown",
      age_hours: null,
      policy_hours: policy,
      reasons: [],
    };
  }
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const ageHours = Number.isFinite(nowMs) ? Math.max(0, (nowMs - timestamp) / 36e5) : 0;
  const expired = ageHours > policy;
  return {
    pass: !expired,
    state: expired ? "expired" : "fresh",
    age_hours: Math.round(ageHours * 10) / 10,
    policy_hours: policy,
    reasons: expired ? ["source_age_expired"] : [],
  };
}

function normaliseStoryIds(value) {
  if (Array.isArray(value)) return value.flatMap((item) => normaliseStoryIds(item));
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function dedupeStoriesById(stories = []) {
  const seen = new Set();
  const out = [];
  for (const story of stories) {
    const id = storyIdFor(story);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(story);
  }
  return out;
}

function storyHasLegacyPublishEvidence(story = {}) {
  return [
    story.youtube_post_id,
    story.youtube_url,
    story.tiktok_post_id,
    story.instagram_media_id,
    story.instagram_story_id,
    story.facebook_post_id,
    story.facebook_story_id,
    story.twitter_post_id,
    story.twitter_image_tweet_id,
  ].some((value) => String(value || "").trim());
}

async function loadPublishedStoryIdsForGoalBatch({ dbModule = null } = {}) {
  const ids = new Set();
  let dbApi = dbModule;
  if (!dbApi) {
    try {
      dbApi = require("../lib/db");
    } catch {
      dbApi = null;
    }
  }

  if (!dbApi) return ids;

  try {
    const published = typeof dbApi.getPublished === "function" ? await dbApi.getPublished() : [];
    for (const story of asStoryArray(published)) {
      const id = storyIdFor(story);
      if (id) ids.add(id);
    }
  } catch {}

  try {
    const stories =
      typeof dbApi.getStoriesSync === "function"
        ? dbApi.getStoriesSync()
        : typeof dbApi.getStories === "function"
          ? await dbApi.getStories()
          : [];
    for (const story of asStoryArray(stories)) {
      if (!storyHasLegacyPublishEvidence(story)) continue;
      const id = storyIdFor(story);
      if (id) ids.add(id);
    }
  } catch {}

  try {
    const db = typeof dbApi.getDb === "function" ? dbApi.getDb() : null;
    const tableRows = db?.prepare?.("PRAGMA table_info(platform_posts)")?.all?.() || [];
    const hasStoryId = tableRows.some((row) => row?.name === "story_id");
    if (db && hasStoryId) {
      const rows = db
        .prepare(
          `SELECT DISTINCT story_id
             FROM platform_posts
            WHERE story_id IS NOT NULL
              AND TRIM(story_id) <> ''
              AND (
                status = 'published'
                OR (external_id IS NOT NULL AND TRIM(external_id) <> '' AND status NOT IN ('failed', 'skipped'))
              )`,
        )
        .all();
      for (const row of rows) {
        const id = String(row?.story_id || "").trim();
        if (id) ids.add(id);
      }
    }
  } catch {}

  return ids;
}

async function loadPublishedStoriesForGoalBatch({ dbModule = null } = {}) {
  const rows = [];
  let dbApi = dbModule;
  if (!dbApi) {
    try {
      dbApi = require("../lib/db");
    } catch {
      dbApi = null;
    }
  }

  if (!dbApi) return rows;

  try {
    const published = typeof dbApi.getPublished === "function" ? await dbApi.getPublished() : [];
    rows.push(...asStoryArray(published));
  } catch {}

  try {
    const stories =
      typeof dbApi.getStoriesSync === "function"
        ? dbApi.getStoriesSync()
        : typeof dbApi.getStories === "function"
          ? await dbApi.getStories()
          : [];
    rows.push(...asStoryArray(stories).filter((story) => storyHasLegacyPublishEvidence(story)));
  } catch {}

  try {
    const bridgePath = path.join(ROOT, "output", "goal-contract", "scheduler_bridge_candidates.json");
    const bridgeDocument = await fs.readJson(bridgePath);
    const bridgeRows = Array.isArray(bridgeDocument)
      ? bridgeDocument
      : asStoryArray(bridgeDocument.scheduler_bridge_candidates || bridgeDocument.candidates || bridgeDocument.stories);
    rows.push(...bridgeRows);
  } catch {}

  return dedupeStoriesById(rows);
}

function cleanSearchText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  if (Array.isArray(value)) return value.map(cleanSearchText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return [
      value.title,
      value.name,
      value.label,
      value.source_name,
      value.publisher,
      value.outlet,
      value.url,
      value.href,
      value.source_url,
      value.article_url,
      value.official_source_url,
      value.reference_url,
      value.direct_media_url,
      value.direct_media_url_if_available,
      value.approved_direct_media_url,
      value.video_url,
      value.trailer_url,
    ].map(cleanSearchText).filter(Boolean).join(" ");
  }
  return "";
}

const REPEAT_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "this",
  "that",
  "just",
  "gets",
  "got",
  "has",
  "have",
  "had",
  "new",
  "now",
  "says",
  "shows",
  "show",
  "reveals",
  "revealed",
  "changes",
  "change",
  "fight",
  "risk",
  "problem",
  "update",
  "news",
  "game",
  "games",
  "gaming",
  "players",
  "fans",
]);

function repeatTokens(value = "") {
  return cleanSearchText(value)
    .toLowerCase()
    .replace(/&(?:amp|#124);/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !REPEAT_TOKEN_STOPWORDS.has(token));
}

function storyRepeatText(story = {}) {
  return [
    story.title,
    story.public_title,
    story.suggested_title,
    story.upload_title,
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.description,
  ].map(cleanSearchText).filter(Boolean).join(" ");
}

function storyRepeatSubjectTokens(story = {}) {
  const explicit = [
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.primary_entity,
    leadingSubjectFromTitle(story.title),
  ].map(cleanSearchText).find((value) => value && !genericLiveRssSubject(value));
  return repeatTokens(explicit || story.title);
}

function nearRepeatStory(candidate = {}, published = {}) {
  const candidateId = storyIdFor(candidate);
  const publishedId = storyIdFor(published);
  if (candidateId && publishedId && candidateId === publishedId) return true;

  const candidateUrl = cleanSearchText(storyUrlForRepeat(candidate)).toLowerCase();
  const publishedUrl = cleanSearchText(storyUrlForRepeat(published)).toLowerCase();
  if (candidateUrl && publishedUrl && candidateUrl === publishedUrl) return true;

  const candidateSubject = new Set(storyRepeatSubjectTokens(candidate));
  const publishedSubject = new Set(storyRepeatSubjectTokens(published));
  const subjectOverlap = [...candidateSubject].filter((token) => publishedSubject.has(token)).length;

  const candidateTokens = new Set(repeatTokens(storyRepeatText(candidate)));
  const publishedTokens = new Set(repeatTokens(storyRepeatText(published)));
  const overlap = [...candidateTokens].filter((token) => publishedTokens.has(token)).length;
  const union = new Set([...candidateTokens, ...publishedTokens]).size || 1;
  const jaccard = overlap / union;

  if (subjectOverlap >= 2 && overlap >= 4) return true;
  if (subjectOverlap >= 1 && overlap >= 5 && jaccard >= 0.35) return true;
  if (overlap >= 7 && jaccard >= 0.5) return true;
  return false;
}

function storyUrlForRepeat(story = {}) {
  return story.article_url ||
    story.primary_source_url ||
    story.source_url ||
    story.url ||
    story.linked_url ||
    story.source_manifest?.primary_source?.url ||
    "";
}

function filterNearRepeatPublishedStories(stories = [], publishedStories = []) {
  const published = asStoryArray(publishedStories);
  if (!published.length) return asStoryArray(stories);
  return asStoryArray(stories).filter((story) => !published.some((row) => nearRepeatStory(story, row)));
}

function filterNearRepeatFreshStoryClusters(stories = []) {
  const selected = [];
  for (const story of asStoryArray(stories)) {
    const titleTokens = new Set(repeatTokens(story.title));
    const repeatsSelected = selected.some((row) => {
      if (nearRepeatStory(story, row)) return true;
      const selectedTitleTokens = new Set(repeatTokens(row.title));
      const overlap = [...titleTokens].filter((token) => selectedTitleTokens.has(token)).length;
      const union = new Set([...titleTokens, ...selectedTitleTokens]).size || 1;
      return overlap >= 5 && overlap / union >= 0.4;
    });
    if (repeatsSelected) continue;
    selected.push(story);
  }
  return selected;
}

function liveRssStorySearchText(story = {}) {
  return [
    story.title,
    story.description,
    story.summary,
    story.source_name,
    story.publisher,
    story.outlet,
    story.url,
    story.article_url,
    story.primary_source_url,
    story.official_source_url,
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.video_url,
    story.trailer_url,
    cleanSearchText(story.primary_source),
    cleanSearchText(story.official_source),
    cleanSearchText(story.direct_media_candidates),
    cleanSearchText(story.official_direct_media_candidates),
    cleanSearchText(story.media_candidates),
    cleanSearchText(story.trailer_references),
    cleanSearchText(story.official_source_entries),
    cleanSearchText(story.source_manifest),
  ].map(cleanSearchText).filter(Boolean).join(" ");
}

function liveRssDirectMotionEvidence(story = {}) {
  const text = liveRssStorySearchText(story);
  const directFields = [
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.video_url,
    story.trailer_url,
    story.media_url,
    story.direct_media_candidates,
    story.official_direct_media_candidates,
  ].map(cleanSearchText);
  if (directFields.some((url) => /\.(?:mp4|mov|m4v|webm)(?:[?#]|$)/i.test(url))) return true;
  if (
    /\b(?:gameplay|deep dive|hands[- ]?on|trailer|teaser|showcase|direct|state of play|developer diary|dev diary|footage|demo|playtest|beta|launch trailer|reveal trailer|official video|cover art animation)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

function liveRssMaterializableDirectMediaEvidence(story = {}) {
  const candidates = [
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.media_url,
    story.video_url,
    story.trailer_url,
    story.primary_source?.approved_direct_media_url,
    story.primary_source?.direct_media_url,
    story.primary_source?.direct_media_url_if_available,
    story.source_manifest?.primary_source?.approved_direct_media_url,
    story.source_manifest?.primary_source?.direct_media_url,
    story.source_manifest?.primary_source?.direct_media_url_if_available,
    story.direct_media_candidates,
    story.official_direct_media_candidates,
    story.trusted_footage_references,
    story.footage_references,
    story.media_candidates,
    story.trailer_references,
    story.source_manifest?.direct_media_candidates,
    story.source_manifest?.official_direct_media_candidates,
    story.source_manifest?.trusted_footage_references,
    story.source_manifest?.footage_references,
  ];
  return candidates
    .map(cleanSearchText)
    .some((url) => /\.(?:mp4|mov|m4v|webm|m3u8|mpd)(?:[?#]|$)/i.test(url));
}

function liveRssOfficialPlatformSource(story = {}) {
  const names = [
    story.source_name,
    story.publisher,
    story.outlet,
    story.primary_source?.name,
    story.official_source?.name,
  ].map(cleanSearchText).filter(Boolean);
  const urls = [
    story.url,
    story.article_url,
    story.primary_source_url,
    story.official_source_url,
    story.primary_source?.url,
    story.official_source?.url,
  ].map(cleanSearchText).filter(Boolean);
  const hosts = urls.map((url) => {
    try {
      return String(new URL(url).hostname || "").toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }).filter(Boolean);
  const officialHost = hosts.some((host) =>
    /(?:^|\.)(?:news\.xbox\.com|blog\.playstation\.com|nintendo\.com|steampowered\.com|steamcommunity\.com|rockstargames\.com|callofduty\.com|ea\.com|ubisoft\.com|capcom\.com|sega\.com|bandainamcoent\.com|square-enix-games\.com|bethesda\.net|bethesda\.com|konami\.com|epicgames\.com|devolverdigital\.com)$/i.test(host),
  );
  if (officialHost) return true;

  const recognisedName = names.some((name) =>
    /^(?:official|xbox wire|playstation blog|nintendo(?: news| direct| official)?|steam(?: news| store)?|rockstar(?: games| newswire)?|ea|electronic arts|ubisoft|capcom|sega|bandai namco|square enix|bethesda|konami|epic games|devolver digital)$/i.test(name),
  );
  const declaredOfficial = /^(?:official|platform|storefront)$/i.test(
    cleanSearchText(story.source_type),
  );
  return recognisedName && (declaredOfficial || hosts.length === 0);
}

function liveRssMajorMediaDiscoverySource(story = {}) {
  const names = [
    story.source_name,
    story.publisher,
    story.outlet,
    story.primary_source?.name,
  ].map(cleanSearchText).filter(Boolean);
  const urls = [
    story.url,
    story.article_url,
    story.primary_source_url,
    story.primary_source?.url,
  ].map(cleanSearchText).filter(Boolean);
  const hosts = urls.map((url) => {
    try {
      return String(new URL(url).hostname || "").toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }).filter(Boolean);
  const isMajorMedia =
    names.some((name) =>
      /^(?:ign|kotaku|polygon|eurogamer|gamespot|pc\s*gamer|vgc|gamesradar|rock\s*paper\s*shotgun|the\s*verge)$/i.test(name),
    ) ||
    hosts.some((host) =>
      /(?:^|\.)(?:ign|kotaku|polygon|eurogamer|gamespot|pcgamer|videogameschronicle|gamesradar|rockpapershotgun|theverge)\.com$/i.test(host),
    );
  if (!isMajorMedia) return false;

  const text = [
    story.title,
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.description,
    story.summary,
  ].map(cleanSearchText).filter(Boolean).join(" ");
  const hasRevealSignal = /\b(?:trailer|gameplay|reveal|revealed|first\s+look|showcase|demo|release\s+date|launch\s+date|preview)\b/i.test(text);
  const hasGameContext = /\b(?:game|games|gaming|gameplay|playable|demo|steam|xbox|playstation|ps5|nintendo|switch|pc|console|developer|publisher|studio|rpg|shooter|platformer|roguelike|survival|multiplayer|single-player|open-world|dlc|patch|season|battle\s+pass|wishlist)\b/i.test(text);
  const hasNonGameEntertainmentContext = /\b(?:movie|film|cinema|theater|theatre|box\s+office|actor|actress|director|tv|television|streaming|hbo|max|netflix|disney)\b/i.test(text);
  return hasRevealSignal && hasGameContext && !hasNonGameEntertainmentContext;
}

function liveRssWeakUnattendedPattern(story = {}) {
  const text = liveRssStorySearchText(story);
  return /\b(?:today[’']?s top deals|top deals|deal|deals|discount|sale|price drop|memory card|ssd|controller discount|amazon prime day|woot|bundle|best games|roundup|everything we know|what to play|guide|wishlist|review momentum|ranking by views|could split players|why this game|why .* could split players)\b/i.test(
    text,
  );
}

function liveRssWeakMetaMotionPattern(story = {}) {
  const text = liveRssStorySearchText(story);
  const title = cleanSearchText(story.title);
  const url = cleanSearchText(story.url || story.article_url || story.source_url);
  if (/\bshare of the week\b|\bpsshare\b|\bcommunity screenshots?\b/i.test(text)) {
    return true;
  }
  if (/\bplayers?[â€™']?\s+choice\b/i.test(text) && /\b(?:vote|poll|best new game|awards?)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:top downloads?|most downloaded|download charts?|indie selects?|playstation plus|ps plus|game catalog|leaving soon|monthly games|backlog deadline|support article|resetting xbox|reset your xbox|today[â€™']?s top deals|nintendo switch consoles?)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:and more|more games?|roundup|collection|consoles?)\b/i.test(title) && !liveRssDirectMotionEvidence(story)) {
    return true;
  }
  if (/\b(?:vote for|poll|survey|readers?[â€™']?\s+choice|community vote|best new game)\b/i.test(title)) {
    return true;
  }
  if (/\/players?-choice[-/]|\/poll[-/]|\/vote[-/]/i.test(url)) {
    return true;
  }
  return false;
}

function genericLiveRssSubject(value = "") {
  const clean = cleanSearchText(value);
  if (!clean) return true;
  if (/^(?:xbox|playstation|ps5|ps4|nintendo|switch|switch 2|steam|valve|pc|pc gamer|game|games|this game|this story|the update|the story|today)$/i.test(clean)) {
    return true;
  }
  if (/^(?:why|what|how|while|today[’']?s|everything we know|best games|top deals)\b/i.test(clean)) return true;
  return false;
}

function leadingSubjectFromTitle(title = "") {
  const clean = cleanSearchText(title).replace(/^["'“”]+|["'“”]+$/g, "");
  const beforeVerb = clean.match(
    /^(.{2,70}?)\s+(?:gets?|got|has|have|is|are|will|just|shows?|showed|reveals?|revealed|launches?|adds?|returns?|drops?|joins?|scores?|announces?|announced|turns?|puts?|makes?|delays?|delayed|moves?)\b/i,
  );
  if (beforeVerb) return beforeVerb[1].trim();
  const colon = clean.match(/^([^:]{2,70}):\s+/);
  if (colon) return colon[1].trim();
  return "";
}

function liveRssHasSpecificSubject(story = {}) {
  const explicit = [
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.primary_entity,
    story.franchise,
  ].map(cleanSearchText).find((value) => value && !genericLiveRssSubject(value));
  if (explicit) return true;

  const title = cleanSearchText(story.title);
  if (
    /\b(?:Grand Theft Auto\s+VI|GTA\s*(?:6|VI)|Halo:?\s*Campaign Evolved|Gears of War:?\s*E[- ]Day|Resident Evil:?\s*Requiem|Resident Evil|Forza Horizon\s+6|Fable|Sea of Thieves|Ninja Gaiden\s+4|Phantom Blade Zero|Dune:?\s*Awakening|Doom:?\s*The Dark Ages|Quake Champions|Granblue Fantasy:?\s*Relink|RuneScape:?\s*Dragonwilds|Yooka[- ]Laylee|007 First Light|Hell Is Us|Hades\s+II|Star Fox|Metroid Prime|Mario Kart World|Final Fantasy|Dragon Quest|Monster Hunter|Silent Hill|Persona\s+\d|Like a Dragon)\b/i.test(
      title,
    )
  ) {
    return true;
  }

  const leadingSubject = leadingSubjectFromTitle(title);
  if (leadingSubject && !genericLiveRssSubject(leadingSubject) && /[A-Z][a-z]+(?:\s+[A-Z0-9][A-Za-z0-9'’:+-]+)+/.test(leadingSubject)) {
    return true;
  }
  return false;
}

function liveRssMotionPotentialScore(story = {}) {
  const text = liveRssStorySearchText(story);
  let score = Number(story.breaking_score || story.score || 0) / 10;

  if (liveRssDirectMotionEvidence(story)) {
    score += 35;
  }
  if (/\b(?:official|xbox wire|playstation blog|nintendo|steam|capcom|sega|ubisoft|bethesda|rockstar|konami|square enix|bandai namco|ea|electronic arts)\b/i.test(text)) {
    score += 35;
  }
  if (/\b(?:gameplay|deep dive|hands[- ]?on|trailer|showcase|direct|state of play|developer diary|dev diary|footage|demo|playtest|beta|launch trailer|reveal trailer)\b/i.test(text)) {
    score += 55;
  }
  if (/\b(?:playable|try|available now|free update|new mode|new map|boss fight|combat|campaign|character reveal)\b/i.test(text)) {
    score += 25;
  }
  if (/\b(?:cover art|pre[- ]?order|official media|media page|download and share|artwork reveal)\b/i.test(text)) {
    score += 20;
  }
  if (/\b(?:review|score|metacritic|opencritic|ranking by views|review momentum)\b/i.test(text)) {
    score -= 18;
  }
  if (/\b(?:deal|deals|discount|sale|price drop|memory card|ssd|controller discount|amazon prime day|woot|bundle)\b/i.test(text)) {
    score -= 70;
  }
  if (/\b(?:best games|roundup|everything we know|what to play|guide|wishlist)\b/i.test(text)) {
    score -= 35;
  }
  if (liveRssWeakMetaMotionPattern(story)) {
    score -= 80;
  }
  return score;
}

const MIN_LIVE_RSS_MOTION_SCORE = 45;

function liveRssMotionGate(story = {}) {
  const score = liveRssMotionPotentialScore(story);
  const reasons = [];
  const hasSpecificSubject = liveRssHasSpecificSubject(story);
  const hasDirectMotion = liveRssDirectMotionEvidence(story);
  if (liveRssWeakUnattendedPattern(story)) reasons.push("weak_unattended_live_rss_pattern");
  if (liveRssWeakMetaMotionPattern(story)) reasons.push("weak_meta_motion_pattern");
  if (!hasSpecificSubject) reasons.push("specific_subject_missing");
  if (!hasDirectMotion) reasons.push("direct_motion_signal_missing");
  if (score < MIN_LIVE_RSS_MOTION_SCORE) reasons.push("motion_potential_below_threshold");
  return {
    pass: reasons.length === 0,
    score,
    reasons,
    has_specific_subject: hasSpecificSubject,
    has_direct_motion_signal: hasDirectMotion,
  };
}

function liveRssRepairIntakeGate(story = {}, motionGate = liveRssMotionGate(story)) {
  const reasons = [];
  const officialPlatformSource = liveRssOfficialPlatformSource(story);
  const majorMediaDiscoverySource = liveRssMajorMediaDiscoverySource(story);
  const hasSpecificSubject =
    motionGate.has_specific_subject === true || liveRssHasSpecificSubject(story);
  const score = Number(motionGate.score || liveRssMotionPotentialScore(story));
  if (liveRssWeakUnattendedPattern(story)) reasons.push("weak_unattended_live_rss_pattern");
  if (liveRssWeakMetaMotionPattern(story)) reasons.push("weak_meta_motion_pattern");
  if (!officialPlatformSource && !majorMediaDiscoverySource) {
    reasons.push("official_or_discoverable_source_missing");
  }
  if (!hasSpecificSubject) reasons.push("specific_subject_missing");
  if (score < 30) reasons.push("repair_intake_score_below_threshold");
  return {
    pass: reasons.length === 0,
    score,
    reasons,
    official_platform_source: officialPlatformSource,
    major_media_discovery_source: majorMediaDiscoverySource,
    has_specific_subject: hasSpecificSubject,
    mode: officialPlatformSource
      ? "official_source_motion_repair_intake"
      : majorMediaDiscoverySource
        ? "major_media_official_motion_discovery"
        : "unqualified_source",
  };
}

function prioritiseLiveRssStoriesForMotion(stories = []) {
  return asStoryArray(stories)
    .map((story, index) => ({
      story,
      index,
      score: liveRssMotionPotentialScore(story),
    }))
    .sort((a, b) => {
      const delta = b.score - a.score;
      return Math.abs(delta) > 0.001 ? delta : a.index - b.index;
    })
    .map((entry) => entry.story);
}

function filterLiveRssStoriesForMotion(stories = [], options = {}) {
  const requireMaterializableDirectMedia = options.requireMaterializableDirectMedia === true;
  const entries = asStoryArray(stories)
    .map((story, index) => ({
      story,
      index,
      freshness: liveRssSourceFreshnessGate(story, options),
      gate: liveRssMotionGate(story),
    }))
    .filter((entry) => entry.freshness.pass);
  const directMotionEntries = entries.filter(
    (entry) =>
      entry.gate.pass &&
      (!requireMaterializableDirectMedia || liveRssMaterializableDirectMediaEvidence(entry.story)),
  );
  if (requireMaterializableDirectMedia) {
    const selectedEntries = directMotionEntries.length
      ? directMotionEntries
      : entries
          .map((entry) => ({
            ...entry,
            repairGate: liveRssRepairIntakeGate(entry.story, entry.gate),
          }))
          .filter((entry) => entry.repairGate.pass);
    return selectedEntries
      .sort((a, b) => {
        const aScore = Number(a.gate?.score ?? a.repairGate?.score ?? 0);
        const bScore = Number(b.gate?.score ?? b.repairGate?.score ?? 0);
        const delta = bScore - aScore;
        return Math.abs(delta) > 0.001 ? delta : a.index - b.index;
      })
      .map((entry) => entry.story);
  }
  const directIds = new Set(directMotionEntries.map((entry) => storyIdFor(entry.story)).filter(Boolean));
  const repairEntries = entries
    .filter((entry) => !directIds.has(storyIdFor(entry.story)))
    .map((entry) => ({
      ...entry,
      repairGate: liveRssRepairIntakeGate(entry.story, entry.gate),
    }))
    .filter((entry) => entry.repairGate.pass);
  const selectedEntries = [...directMotionEntries, ...repairEntries];
  return selectedEntries
    .sort((a, b) => {
      const aScore = Number(a.gate?.score ?? a.repairGate?.score ?? 0);
      const bScore = Number(b.gate?.score ?? b.repairGate?.score ?? 0);
      const delta = bScore - aScore;
      return Math.abs(delta) > 0.001 ? delta : a.index - b.index;
    })
    .map((entry) => entry.story);
}

function selectStoriesForGoalBatch({
  baseStories = [],
  dbStories = [],
  liveRssStories = [],
  useDbStories = false,
  storyIds = [],
  excludedStoryIds = [],
  excludedSourceFingerprints = [],
  excludedPublishedStories = [],
  now = new Date(),
  sourceAgePolicyHours = 168,
  requireMaterializableDirectMedia = false,
} = {}) {
  const wanted = new Set(normaliseStoryIds(storyIds));
  const excluded = new Set(normaliseStoryIds(excludedStoryIds));
  const excludedSources = new Set(normaliseStoryIds(excludedSourceFingerprints));
  const sourceStories = useDbStories ? asStoryArray(dbStories) : asStoryArray(baseStories);
  const liveRssSelection = wanted.size
    ? prioritiseLiveRssStoriesForMotion(liveRssStories)
    : filterLiveRssStoriesForMotion(liveRssStories, {
        now,
        policyHours: sourceAgePolicyHours,
        requireMaterializableDirectMedia,
      });
  const repeatFilteredLiveRssSelection = wanted.size
    ? liveRssSelection
    : filterNearRepeatFreshStoryClusters(
        filterNearRepeatPublishedStories(liveRssSelection, excludedPublishedStories),
      );
  let merged = dedupeStoriesById([...repeatFilteredLiveRssSelection, ...sourceStories]).filter((story) => {
    if (wanted.size) return true;
    const id = storyIdFor(story);
    const sourceFingerprint = buildSourceFingerprint(story);
    return (!id || !excluded.has(id)) &&
      (!sourceFingerprint || !excludedSources.has(sourceFingerprint));
  });
  if (!wanted.size && requireMaterializableDirectMedia && merged.length === 0) {
    const repairFallbackSelection = filterNearRepeatFreshStoryClusters(
      filterNearRepeatPublishedStories(filterLiveRssStoriesForMotion(liveRssStories, {
        now,
        policyHours: sourceAgePolicyHours,
        requireMaterializableDirectMedia: false,
      }), excludedPublishedStories),
    );
    merged = dedupeStoriesById([...repairFallbackSelection, ...sourceStories]).filter((story) => {
      const id = storyIdFor(story);
      const sourceFingerprint = buildSourceFingerprint(story);
      return (!id || !excluded.has(id)) &&
        (!sourceFingerprint || !excludedSources.has(sourceFingerprint));
    });
  }
  if (!wanted.size) return merged;
  return merged.filter((story) => wanted.has(storyIdFor(story)));
}

function shouldFillRevenuePathsForGoalBatch(args = {}) {
  return (
    normaliseStoryIds(args.storyIds).length === 0 &&
    args.liveRssOnly !== true &&
    args.storiesFileExplicit !== true
  );
}

async function loadMotionPackByStory(dirPath) {
  const out = {};
  const dir = path.resolve(dirPath || "");
  if (!(await fs.pathExists(dir))) return out;
  const names = await fs.readdir(dir);
  for (const name of names) {
    if (!/_motion_pack_manifest\.json$/i.test(name)) continue;
    const filePath = path.join(dir, name);
    try {
      const pack = await fs.readJson(filePath);
      const storyId = String(pack.story_id || name.replace(/_motion_pack_manifest\.json$/i, "")).trim();
      if (!storyId) continue;
      out[storyId] = pack;
    } catch {}
  }
  return out;
}

async function loadRevenueManifestByStory(revenuePathsFile) {
  const out = {};
  const file = path.resolve(revenuePathsFile || "");
  const dir = path.dirname(file);
  if (!(await fs.pathExists(dir))) return out;
  const names = await fs.readdir(dir);
  for (const name of names) {
    if (!/_revenue_path_manifest\.json$/i.test(name)) continue;
    const filePath = path.join(dir, name);
    try {
      const manifest = await fs.readJson(filePath);
      const storyId = String(manifest.story_id || name.replace(/_revenue_path_manifest\.json$/i, "")).trim();
      if (!storyId) continue;
      out[storyId] = manifest;
    } catch {}
  }
  return out;
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  loadDotenvForCli();
  const generatedAt = args.generatedAt || new Date().toISOString();
  const baseStories = args.dbStories || args.liveRssOnly
    ? []
    : asStoryArray(await fs.readJson(path.resolve(args.storiesFile)));
  const dbStories = args.dbStories ? await require("../lib/db").getStories() : [];
  const zeroYieldQuarantine = args.zeroYieldQuarantineFile
    ? await readZeroYieldQuarantine(path.resolve(args.zeroYieldQuarantineFile), {
        now: new Date(generatedAt),
      })
    : null;
  const zeroYieldExclusions = buildZeroYieldExclusions(zeroYieldQuarantine, {
    now: new Date(generatedAt),
  });
  const liveRssFetchPlan = buildLiveRssFetchPlan({
    requestedPerFeed: args.rssPerFeed,
    requestedOffsetPerFeed: args.rssOffsetPerFeed,
    zeroYieldExclusions,
  });
  const liveRssStories = args.liveRss
    ? await fetchRssProofStories({
        feeds: pulseGamingChannel.rssFeeds || [],
        perFeed: liveRssFetchPlan.fetch_per_feed,
        offsetPerFeed: liveRssFetchPlan.offset_per_feed,
      })
    : [];
  const revenuePaths = await fs.pathExists(path.resolve(args.revenuePathsFile))
    ? await fs.readJson(path.resolve(args.revenuePathsFile))
    : {};
  const revenueManifestByStory = await loadRevenueManifestByStory(args.revenuePathsFile);
  const revenuePathsWithManifests = {
    ...revenuePaths,
    top_paths: asStoryArray(revenuePaths.top_paths || []).map((row) => ({
      ...row,
      revenue_manifest: revenueManifestByStory[row.story_id] || row.revenue_manifest,
    })),
  };
  const motionPackByStory = await loadMotionPackByStory(args.v4MotionPackDir);
  const sfxAssetInventory = await readJsonIfPresent(args.sfxAssetsPath, []);
  const sfxRightsLedger = await readJsonIfPresent(args.sfxRightsLedgerPath, []);
  const unattendedZeroYieldExclusions = args.storiesFileExplicit
    ? { story_ids: [], source_fingerprints: [] }
    : zeroYieldExclusions;
  const excludedStoryIds = [
    ...args.excludedStoryIds,
    ...unattendedZeroYieldExclusions.story_ids,
    ...(
    args.liveRssOnly && !args.includePublished
      ? Array.from(await loadPublishedStoryIdsForGoalBatch())
      : []
    ),
  ];
  const excludedSourceFingerprints = [
    ...args.excludedSourceFingerprints,
    ...unattendedZeroYieldExclusions.source_fingerprints,
  ];
  const excludedPublishedStories =
    args.liveRssOnly && !args.includePublished
      ? await loadPublishedStoriesForGoalBatch()
      : [];
  const selectedStories = selectStoriesForGoalBatch({
    baseStories,
    dbStories,
    liveRssStories,
    useDbStories: args.dbStories,
    storyIds: args.storyIds,
    excludedStoryIds,
    excludedSourceFingerprints,
    excludedPublishedStories,
    requireMaterializableDirectMedia: args.liveRssOnly === true,
  });
  const stories = augmentStoriesWithRevenuePaths(selectedStories, revenuePathsWithManifests, args.limit, {
    fillRevenuePaths: shouldFillRevenuePathsForGoalBatch(args),
  });
  const liveRssIntakeReport = args.liveRss
    ? buildLiveRssIntakeReport({
        generatedAt,
        liveRssStories,
        selectedStories,
        quarantinedStoryIds: zeroYieldExclusions.story_ids,
        quarantinedSourceFingerprints:
          zeroYieldExclusions.source_fingerprints,
        excludedStoryIds,
        excludedSourceFingerprints,
        fetchPlan: liveRssFetchPlan,
      })
    : null;
  const batch = buildGoalBatchPackages({
    stories,
    limit: args.limit,
    motionPackByStory,
    sfxAssetInventory,
    sfxRightsLedger,
    videoCacheDir: path.resolve(args.videoCacheDir),
    existingArtifactRoot: path.resolve(args.existingArtifactRoot || args.outDir),
    allowOwnedMotionFallback: args.allowOwnedMotionFallback,
    targetPlatforms: args.targetPlatforms,
    generatedAt,
  });
  const outputs = await writeGoalBatchPackages(batch, {
    outputDir: args.outDir,
    contractOutDir: args.contractOutDir,
  });
  if (liveRssIntakeReport) {
    const liveRssIntakeReportPath = path.join(
      path.resolve(args.contractOutDir),
      "live-rss-intake-report.json",
    );
    await fs.ensureDir(path.dirname(liveRssIntakeReportPath));
    await fs.writeJson(liveRssIntakeReportPath, liveRssIntakeReport, {
      spaces: 2,
    });
    outputs.liveRssIntakeReportPath = liveRssIntakeReportPath;
    outputs.liveRssIntakeSummary = liveRssIntakeReport.summary;
  }
  if (args.json) console.log(JSON.stringify({ summary: outputs.summary || batch.summary, outputs }, null, 2));
  else {
    const summary = outputs.summary || batch.summary;
    console.log(`Goal batch packages: ${summary.green_count}/${summary.story_count} GREEN`);
    console.log(`Story packages: ${outputs.storyPackagesPath}`);
    console.log("Safety: local-only, no publish, no DB mutation, no OAuth changes.");
  }
  return { batch, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-batch-packages] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  asStoryArray,
  buildLiveRssFetchPlan,
  buildLiveRssIntakeReport,
  loadRevenueManifestByStory,
  loadMotionPackByStory,
  filterLiveRssStoriesForMotion,
  filterNearRepeatPublishedStories,
  loadPublishedStoryIdsForGoalBatch,
  loadPublishedStoriesForGoalBatch,
  liveRssWeakMetaMotionPattern,
  liveRssMotionGate,
  liveRssMaterializableDirectMediaEvidence,
  liveRssMotionPotentialScore,
  liveRssRepairIntakeGate,
  normaliseStoryIds,
  prioritiseLiveRssStoriesForMotion,
  selectStoriesForGoalBatch,
  parseArgs,
  shouldFillRevenuePathsForGoalBatch,
  main,
};
