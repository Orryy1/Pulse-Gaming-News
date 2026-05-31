#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "test", "output");

const {
  buildYouTubeAnalyticsIngestionPacket,
  renderYouTubeAnalyticsIngestionMarkdown,
} = require("../lib/intelligence/youtube-analytics-ingestion-packet");
const {
  selectPublishedVideoTargets,
} = require("../lib/intelligence/continuous-learning-loop");
const { readTokenStatus } = require("./analytics-capability-doctor");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    fixture: false,
    videos: [],
    limit: 5,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--video" && argv[i + 1]) args.videos.push(argv[++i]);
    else if (arg.startsWith("--video=")) args.videos.push(arg.slice(8));
    else if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice(8));
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 5;
  args.limit = Math.min(Math.floor(args.limit), 25);
  return args;
}

function fixtureVideos(limit = 5) {
  return [
    "fixture-short-001",
    "fixture-short-002",
    "fixture-short-003",
    "fixture-longform-001",
    "fixture-briefing-001",
  ].slice(0, limit);
}

function resolvePacketVideosFromStories({
  args = {},
  stories = [],
  now = Date.now(),
} = {}) {
  if (Array.isArray(args.videos) && args.videos.length) return args.videos;
  if (args.fixture) return fixtureVideos(args.limit);
  return selectPublishedVideoTargets(stories, {
    now,
    maxAgeDays: 45,
    limit: args.limit,
  }).map((target) => target.video_id);
}

async function readStoriesForPacket() {
  try {
    return await require("../lib/db").getStories();
  } catch {
    return [];
  }
}

async function main(argv = process.argv.slice(2)) {
  await fs.ensureDir(OUT_DIR);
  const args = parseArgs(argv);
  const tokenStatus = args.fixture
    ? { exists: true, yt_analytics_scope: "granted" }
    : await readTokenStatus();
  const stories = args.fixture || args.videos.length ? [] : await readStoriesForPacket();
  const videos = resolvePacketVideosFromStories({
    args,
    stories,
  });

  const packet = buildYouTubeAnalyticsIngestionPacket({
    videoIds: videos,
    tokenStatus,
    env: process.env,
  });

  const jsonPath = path.join(OUT_DIR, "youtube_analytics_ingestion_packet.json");
  const mdPath = path.join(OUT_DIR, "youtube_analytics_ingestion_packet.md");
  await fs.writeJson(jsonPath, packet, { spaces: 2 });
  await fs.writeFile(mdPath, renderYouTubeAnalyticsIngestionMarkdown(packet), "utf8");

  console.log(`[youtube-analytics-packet] verdict=${packet.verdict}`);
  console.log(`[youtube-analytics-packet] status=${packet.status}`);
  console.log(`[youtube-analytics-packet] queries=${packet.planned_queries.length}`);
  console.log(`[youtube-analytics-packet] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[youtube-analytics-packet] json=${path.relative(ROOT, jsonPath)}`);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  }
  return {
    packet,
    artefacts: {
      md: path.relative(ROOT, mdPath),
      json: path.relative(ROOT, jsonPath),
    },
  };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[youtube-analytics-packet] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  fixtureVideos,
  main,
  parseArgs,
  resolvePacketVideosFromStories,
};
