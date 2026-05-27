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

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storiesFile: path.join(ROOT, "daily_news.json"),
    revenuePathsFile: path.join(ROOT, "output", "revenue", "revenue-paths.json"),
    v4MotionPackDir: path.join(ROOT, "output", "studio-v4", "motion-packs"),
    videoCacheDir: path.join(ROOT, "output", "video_cache"),
    limit: 30,
    outDir: path.join(ROOT, "output", "goal-proof", "batch"),
    contractOutDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    liveRss: false,
    rssPerFeed: 8,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stories-file") args.storiesFile = argv[++i] || args.storiesFile;
    else if (arg === "--revenue-paths") args.revenuePathsFile = argv[++i] || args.revenuePathsFile;
    else if (arg === "--v4-motion-pack-dir") args.v4MotionPackDir = argv[++i] || args.v4MotionPackDir;
    else if (arg === "--video-cache-dir") args.videoCacheDir = argv[++i] || args.videoCacheDir;
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--contract-out-dir") args.contractOutDir = argv[++i] || args.contractOutDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--live-rss") args.liveRss = true;
    else if (arg === "--rss-per-feed") args.rssPerFeed = Number(argv[++i] || args.rssPerFeed);
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
    "  --limit <n>                 Defaults to 30",
    "  --out-dir <dir>",
    "  --contract-out-dir <dir>",
    "  --generated-at <iso>",
    "  --live-rss                 Prepend current source-backed RSS proof candidates from Pulse Gaming feeds",
    "  --rss-per-feed <n>          Defaults to 8 when --live-rss is set",
    "  --json",
  ].join("\n");
}

function asStoryArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.stories)) return value.stories;
  if (Array.isArray(value?.items)) return value.items;
  return [];
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

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const baseStories = asStoryArray(await fs.readJson(path.resolve(args.storiesFile)));
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
  const stories = augmentStoriesWithRevenuePaths([...liveRssStories, ...baseStories], revenuePathsWithManifests, args.limit);
  const batch = buildGoalBatchPackages({
    stories,
    limit: args.limit,
    motionPackByStory,
    videoCacheDir: path.resolve(args.videoCacheDir),
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
  parseArgs,
  main,
};
