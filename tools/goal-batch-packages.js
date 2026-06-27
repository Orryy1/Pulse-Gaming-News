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
const pulseGamingChannel = require("../channels/pulse-gaming");

const ROOT = path.resolve(__dirname, "..");

function dotenvSkipped() {
  return /^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""));
}

function loadDotenvForCli() {
  if (dotenvSkipped()) return;
  try {
    require("dotenv").config({ override: true });
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
    limit: 30,
    outDir: path.join(ROOT, "output", "goal-proof", "batch"),
    contractOutDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    liveRss: false,
    liveRssOnly: false,
    rssPerFeed: 8,
    dbStories: false,
    storyIds: [],
    includePublished: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stories-file") args.storiesFile = argv[++i] || args.storiesFile;
    else if (arg === "--revenue-paths") args.revenuePathsFile = argv[++i] || args.revenuePathsFile;
    else if (arg === "--v4-motion-pack-dir") args.v4MotionPackDir = argv[++i] || args.v4MotionPackDir;
    else if (arg === "--video-cache-dir") args.videoCacheDir = argv[++i] || args.videoCacheDir;
    else if (arg === "--sfx-assets") args.sfxAssetsPath = argv[++i] || "";
    else if (arg === "--sfx-rights-ledger") args.sfxRightsLedgerPath = argv[++i] || "";
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--contract-out-dir") args.contractOutDir = argv[++i] || args.contractOutDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--live-rss") args.liveRss = true;
    else if (arg === "--live-rss-only") {
      args.liveRss = true;
      args.liveRssOnly = true;
    }
    else if (arg === "--rss-per-feed") args.rssPerFeed = Number(argv[++i] || args.rssPerFeed);
    else if (arg === "--db-stories") args.dbStories = true;
    else if (arg === "--include-published") args.includePublished = true;
    else if (arg === "--story-id" || arg === "--story" || arg === "--story-ids") {
      args.storyIds.push(...normaliseStoryIds(argv[++i] || ""));
    }
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
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
    "  --contract-out-dir <dir>",
    "  --generated-at <iso>",
    "  --live-rss                 Prepend current source-backed RSS proof candidates from Pulse Gaming feeds",
    "  --live-rss-only            Use only current gated live-RSS candidates; prevents stale backlog/revenue fill",
    "  --rss-per-feed <n>          Defaults to 8 when --live-rss is set",
    "  --db-stories               Read story rows from the configured local DB instead of daily_news.json",
    "  --include-published        Allow live-RSS packaging of stories that already have public publish evidence",
    "  --story-id <id[,id]>        Package only the named story IDs; may be repeated",
    "  --json",
  ].join("\n");
}

function asStoryArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.stories)) return value.stories;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function storyIdFor(story) {
  return String(story?.id || story?.story_id || "").trim();
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

function liveRssOfficialPlatformSource(story = {}) {
  const text = [
    story.source_name,
    story.primary_source,
    story.source_type,
    story.url,
    story.article_url,
    story.primary_source_url,
    story.official_source_url,
  ].map(cleanSearchText).filter(Boolean).join(" ");
  return /\b(?:official|playstation blog|blog\.playstation\.com|xbox wire|news\.xbox\.com|nintendo|steam news|steampowered|rockstar newswire|rockstargames|capcom|sega|ubisoft|bethesda|square enix|bandai namco|konami|ea|electronic arts)\b/i.test(text);
}

function liveRssWeakUnattendedPattern(story = {}) {
  const text = liveRssStorySearchText(story);
  return /\b(?:today[’']?s top deals|top deals|deal|deals|discount|sale|price drop|memory card|ssd|controller discount|amazon prime day|woot|bundle|best games|roundup|everything we know|what to play|guide|wishlist|review momentum|ranking by views|could split players|why this game|why .* could split players)\b/i.test(
    text,
  );
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
    /\b(?:Grand Theft Auto\s+VI|GTA\s*(?:6|VI)|Halo:?\s*Campaign Evolved|Gears of War:?\s*E[- ]Day|Resident Evil:?\s*Requiem|Resident Evil|Forza Horizon\s+6|Fable|Sea of Thieves|Ninja Gaiden\s+4|Phantom Blade Zero|Doom:?\s*The Dark Ages|Quake Champions|Granblue Fantasy:?\s*Relink|RuneScape:?\s*Dragonwilds|Yooka[- ]Laylee|007 First Light|Hell Is Us|Hades\s+II|Star Fox|Metroid Prime|Mario Kart World|Final Fantasy|Dragon Quest|Monster Hunter|Silent Hill|Persona\s+\d|Like a Dragon)\b/i.test(
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
  return score;
}

const MIN_LIVE_RSS_MOTION_SCORE = 45;

function liveRssMotionGate(story = {}) {
  const score = liveRssMotionPotentialScore(story);
  const reasons = [];
  const hasSpecificSubject = liveRssHasSpecificSubject(story);
  const hasDirectMotion = liveRssDirectMotionEvidence(story);
  if (liveRssWeakUnattendedPattern(story)) reasons.push("weak_unattended_live_rss_pattern");
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
  const hasSpecificSubject =
    motionGate.has_specific_subject === true || liveRssHasSpecificSubject(story);
  const score = Number(motionGate.score || liveRssMotionPotentialScore(story));
  if (liveRssWeakUnattendedPattern(story)) reasons.push("weak_unattended_live_rss_pattern");
  if (!officialPlatformSource) reasons.push("official_or_platform_source_missing");
  if (!hasSpecificSubject) reasons.push("specific_subject_missing");
  if (score < 30) reasons.push("repair_intake_score_below_threshold");
  return {
    pass: reasons.length === 0,
    score,
    reasons,
    official_platform_source: officialPlatformSource,
    has_specific_subject: hasSpecificSubject,
    mode: "official_source_motion_repair_intake",
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

function filterLiveRssStoriesForMotion(stories = []) {
  const entries = asStoryArray(stories)
    .map((story, index) => ({
      story,
      index,
      gate: liveRssMotionGate(story),
    }));
  const directMotionEntries = entries.filter((entry) => entry.gate.pass);
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
} = {}) {
  const wanted = new Set(normaliseStoryIds(storyIds));
  const excluded = new Set(normaliseStoryIds(excludedStoryIds));
  const sourceStories = useDbStories ? asStoryArray(dbStories) : asStoryArray(baseStories);
  const liveRssSelection = wanted.size
    ? prioritiseLiveRssStoriesForMotion(liveRssStories)
    : filterLiveRssStoriesForMotion(liveRssStories);
  const merged = dedupeStoriesById([...liveRssSelection, ...sourceStories]).filter((story) => {
    if (wanted.size) return true;
    const id = storyIdFor(story);
    return !id || !excluded.has(id);
  });
  if (!wanted.size) return merged;
  return merged.filter((story) => wanted.has(storyIdFor(story)));
}

function shouldFillRevenuePathsForGoalBatch(args = {}) {
  return normaliseStoryIds(args.storyIds).length === 0 && args.liveRssOnly !== true;
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
  const baseStories = args.dbStories || args.liveRssOnly
    ? []
    : asStoryArray(await fs.readJson(path.resolve(args.storiesFile)));
  const dbStories = args.dbStories ? await require("../lib/db").getStories() : [];
  const liveRssStories = args.liveRss
    ? await fetchRssProofStories({
        feeds: pulseGamingChannel.rssFeeds || [],
        perFeed: args.rssPerFeed,
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
  const excludedStoryIds =
    args.liveRssOnly && !args.includePublished
      ? Array.from(await loadPublishedStoryIdsForGoalBatch())
      : [];
  const selectedStories = selectStoriesForGoalBatch({
    baseStories,
    dbStories,
    liveRssStories,
    useDbStories: args.dbStories,
    storyIds: args.storyIds,
    excludedStoryIds,
  });
  const stories = augmentStoriesWithRevenuePaths(selectedStories, revenuePathsWithManifests, args.limit, {
    fillRevenuePaths: shouldFillRevenuePathsForGoalBatch(args),
  });
  const batch = buildGoalBatchPackages({
    stories,
    limit: args.limit,
    motionPackByStory,
    sfxAssetInventory,
    sfxRightsLedger,
    videoCacheDir: path.resolve(args.videoCacheDir),
    existingArtifactRoot: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const outputs = await writeGoalBatchPackages(batch, {
    outputDir: args.outDir,
    contractOutDir: args.contractOutDir,
  });
  if (args.json) console.log(JSON.stringify({ summary: batch.summary, outputs }, null, 2));
  else {
    console.log(`Goal batch packages: ${batch.summary.green_count}/${batch.summary.story_count} GREEN`);
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
  loadRevenueManifestByStory,
  loadMotionPackByStory,
  filterLiveRssStoriesForMotion,
  loadPublishedStoryIdsForGoalBatch,
  liveRssMotionGate,
  liveRssMotionPotentialScore,
  liveRssRepairIntakeGate,
  normaliseStoryIds,
  prioritiseLiveRssStoriesForMotion,
  selectStoriesForGoalBatch,
  parseArgs,
  shouldFillRevenuePathsForGoalBatch,
  main,
};
