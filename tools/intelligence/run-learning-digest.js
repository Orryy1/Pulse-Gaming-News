#!/usr/bin/env node
"use strict";

/**
 * tools/intelligence/run-learning-digest.js — Session 3 prototype.
 *
 * Generates a learning digest from fixture stories + fixture
 * snapshots and writes Markdown + JSON under
 * test/output/learning-digest/.
 *
 * Read-only with respect to production. Never queries YouTube.
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output", "learning-digest");

const { extractMany } = require(
  path.join(ROOT, "lib", "intelligence", "feature-extractor"),
);
const { buildAnalyticsClient } = require(
  path.join(ROOT, "lib", "intelligence", "analytics-client"),
);
const { buildLearningDigest, writeDigestArtefacts } = require(
  path.join(ROOT, "lib", "intelligence", "learning-digest"),
);

const FIXTURE_STORIES = [
  {
    id: "fix-story-1",
    title: "Iron Saint Console Reveal Confirmed for PS5",
    flair: "Confirmed",
    youtube_post_id: "fix-vid-1",
    duration_seconds: 52,
    downloaded_images: [
      { path: "x://k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "x://h.jpg", type: "hero", source: "steam", priority: 92 },
      { path: "x://s1.jpg", type: "screenshot", source: "steam", priority: 88 },
      { path: "x://s2.jpg", type: "screenshot", source: "steam", priority: 87 },
    ],
    video_clips: [
      { path: "x://announce.mp4", type: "trailer", source: "trailer" },
    ],
  },
  {
    id: "fix-story-2",
    title: "Pale Compass Spring Update Coming Soon",
    flair: "Verified",
    youtube_post_id: "fix-vid-2",
    duration_seconds: 48,
    downloaded_images: [
      { path: "x://kb.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "x://sb.jpg", type: "screenshot", source: "steam", priority: 88 },
      {
        path: "x://ahb.jpg",
        type: "article_hero",
        source: "article",
        priority: 70,
      },
    ],
    video_clips: [],
  },
  {
    id: "fix-story-3",
    title: "Quiet Engine Patch Notes Detailed",
    flair: "News",
    youtube_post_id: "fix-vid-3",
    duration_seconds: 38,
    downloaded_images: [
      { path: "x://qc.jpg", type: "capsule", source: "steam", priority: 88 },
    ],
    video_clips: [],
  },
  {
    id: "fix-story-4",
    title: "Aurora Drift Open Beta Date Revealed",
    flair: "Confirmed",
    youtube_post_id: "fix-vid-4",
    duration_seconds: 56,
    downloaded_images: [
      { path: "x://ak.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "x://as.jpg", type: "screenshot", source: "steam", priority: 88 },
      {
        path: "x://atf.jpg",
        type: "trailer_frame",
        source: "trailer",
        priority: 80,
      },
    ],
    video_clips: [
      { path: "x://aurora.mp4", type: "trailer", source: "trailer" },
    ],
  },
  {
    id: "fix-story-5",
    title: "Forge & Ferry Co-op Trailer Drops",
    flair: "Verified",
    youtube_post_id: "fix-vid-5",
    duration_seconds: 50,
    downloaded_images: [
      { path: "x://fk.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "x://fh.jpg", type: "hero", source: "steam", priority: 92 },
    ],
    video_clips: [
      { path: "x://forge.mp4", type: "trailer", source: "trailer" },
    ],
  },
  {
    id: "fix-story-6",
    title: "Untitled Sequel Rumour Spreads",
    flair: "Rumour",
    youtube_post_id: "fix-vid-6",
    duration_seconds: 42,
    downloaded_images: [
      {
        path: "x://ah.jpg",
        type: "article_hero",
        source: "article",
        priority: 60,
      },
    ],
    video_clips: [],
  },
];

async function main() {
  await fs.ensureDir(OUT_DIR);
  const features = extractMany(FIXTURE_STORIES);
  const client = buildAnalyticsClient({ mode: "fixture" });
  const snapshotsByVideo = {};
  for (const f of features) {
    if (!f.video_id) continue;
    const snaps = await client.pullSnapshotsForVideo(f.video_id, {
      baseSeed: f.video_id.length,
    });
    snapshotsByVideo[f.video_id] = snaps;
  }
  const digest = buildLearningDigest({
    snapshotsByVideo,
    features,
    windowDays: 7,
  });
  const { jsonPath, mdPath } = await writeDigestArtefacts(digest, OUT_DIR);
  return {
    features: features.length,
    videos: Object.keys(snapshotsByVideo).length,
    jsonPath: path.relative(ROOT, jsonPath),
    mdPath: path.relative(ROOT, mdPath),
    confidence: digest.confidence,
    recommendations: (digest.recommendations || []).length,
    experiments: (digest.experiments_suggested || []).length,
  };
}

if (require.main === module) {
  main()
    .then((r) => {
      console.log(
        `[learning-digest] features=${r.features} videos=${r.videos} confidence=${r.confidence} recs=${r.recommendations} experiments=${r.experiments}`,
      );
      console.log(`[learning-digest] md:   ${r.mdPath}`);
      console.log(`[learning-digest] json: ${r.jsonPath}`);
    })
    .catch((err) => {
      console.error(`[learning-digest] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main, FIXTURE_STORIES };
