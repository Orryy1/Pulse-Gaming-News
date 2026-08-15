#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  assignCurrentReleaseFootage,
  isPoolSnapshotFresh,
  loadPool,
  scoreCandidate,
} = require("../lib/services/current-release-footage-pool");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  const args = { command: argv[2] || "assign" };
  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

const STORY_SPECS = [
  { story_id: "system-trace-shader-compilation", topic_tags: ["shader-compilation", "combat", "multiplayer"] },
  { story_id: "system-trace-temporal-upscaling", topic_tags: ["temporal-upscaling", "ray-tracing", "horror"] },
  { story_id: "system-trace-spatial-headphone-audio", topic_tags: ["spatial-audio", "combat", "multiplayer"] },
  { story_id: "system-trace-texture-streaming", topic_tags: ["texture-streaming", "open-world", "combat"] },
  { story_id: "system-trace-ray-tracing-bvh", topic_tags: ["ray-tracing", "rendering", "effects"] },
  { story_id: "system-trace-render-queue-latency", topic_tags: ["render-queue-latency", "input-latency", "fighting"] },
];

async function refreshPool(poolPath, outputPath) {
  const { google } = require("googleapis");
  const authRoot = process.env.PULSE_YOUTUBE_AUTH_ROOT
    ? path.resolve(process.env.PULSE_YOUTUBE_AUTH_ROOT)
    : path.resolve(__dirname, "..");
  const authEnvPath = path.join(authRoot, ".env");
  if (fs.existsSync(authEnvPath)) {
    require("dotenv").config({ path: authEnvPath, override: false });
  }
  const { getAuthClient } = require(path.join(authRoot, "upload_youtube.js"));
  const pool = loadPool(poolPath);
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: "v3", auth });
  const ids = pool.candidates.map((candidate) => candidate.youtube_video_id);
  const response = await youtube.videos.list({
    part: ["snippet", "statistics", "status", "contentDetails"],
    id: ids,
  }, { retry: false, timeout: 30000 });
  const byId = new Map((response.data.items || []).map((item) => [item.id, item]));
  const capturedAt = new Date().toISOString();
  const refreshed = {
    ...pool,
    generated_at: capturedAt,
    candidates: pool.candidates.map((candidate) => {
      const item = byId.get(candidate.youtube_video_id);
      if (!item) return { ...candidate, snapshot: { ...(candidate.snapshot || {}), captured_at: capturedAt, missing_remote: true } };
      return {
        ...candidate,
        snapshot: {
          views: Number(item.statistics?.viewCount || 0),
          likes: Number(item.statistics?.likeCount || 0),
          captured_at: capturedAt,
          channel_id: item.snippet?.channelId || null,
          channel_title: item.snippet?.channelTitle || null,
          source_title: item.snippet?.title || null,
          privacy_status: item.status?.privacyStatus || null,
          duration: item.contentDetails?.duration || null,
        },
      };
    }),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(refreshed, null, 2)}\n`);
  return refreshed;
}

async function main() {
  const args = parseArgs(process.argv);
  const poolPath = path.resolve(args.pool || path.join(__dirname, "..", "config", "current-release-footage-pool.json"));
  if (args.command === "refresh") {
    const outputPath = path.resolve(args.output || poolPath);
    const refreshed = await refreshPool(poolPath, outputPath);
    console.log(JSON.stringify({ status: "GREEN_REFRESHED", output: outputPath, sha256: sha256File(outputPath), candidates: refreshed.candidates.length }, null, 2));
    return;
  }
  const pool = loadPool(poolPath);
  if (args.command === "rank") {
    const rows = pool.candidates.map((candidate) => ({ candidate, evaluation: scoreCandidate(candidate, pool, { now: args.now, seed: args.seed || "pulse-rank" }) }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (args.command !== "assign") throw new Error(`unsupported command ${args.command}`);
  const freshness = isPoolSnapshotFresh(pool, { now: args.now });
  if (!freshness.fresh) {
    throw new Error(
      `current-release pool snapshot is stale (${freshness.ageHours}h > ${freshness.maxAgeHours}h); run media:current-release-refresh first`,
    );
  }
  const assignments = assignCurrentReleaseFootage(pool, STORY_SPECS, {
    seed: args.seed || "pulse-system-trace-current-release-v1",
    now: args.now || "2026-08-14T22:30:00.000Z",
  });
  const outputPath = path.resolve(args.output || path.join(__dirname, "..", "config", "system-trace-current-release-assignments.json"));
  const report = {
    schema_version: "pulse-system-trace-current-release-assignments-v1",
    generated_at: new Date().toISOString(),
    pool_path: poolPath,
    pool_sha256: sha256File(poolPath),
    selection_seed: args.seed || "pulse-system-trace-current-release-v1",
    pool_snapshot_age_hours: freshness.ageHours,
    pool_snapshot_max_age_hours: freshness.maxAgeHours,
    assignments,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "GREEN_ASSIGNED", output: outputPath, sha256: sha256File(outputPath), assignments: assignments.map((row) => ({ story: row.story_id, game: row.selected.game, candidate: row.selected.id, score: row.evaluation.score })) }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(2);
});
