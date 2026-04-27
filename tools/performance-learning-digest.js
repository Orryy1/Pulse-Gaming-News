"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { extractVideoFeatures } = require("../lib/performance/feature-extractor");
const {
  buildPerformanceLearningDigest,
  renderDigestMarkdown,
} = require("../lib/performance/learning-digest");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "test", "output");

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  try {
    return fs.readJson(filePath);
  } catch {
    return null;
  }
}

function buildFixtureSnapshots() {
  return [
    {
      video_id: "yt_bloodlines_fixture",
      story_id: "bloodlines-fixture",
      title: "Bloodlines update tested by Shorts feed",
      publish_time: "2026-04-24T18:00:00.000Z",
      snapshot_at: "2026-04-25T18:00:00.000Z",
      snapshot_label: "+24h",
      views: 7400,
      watch_time_seconds: 42624,
      average_view_duration_seconds: 5.76,
      average_percentage_viewed: 22.8,
      likes: 92,
      comments: 11,
      subscribers_gained: 1,
      platform: "youtube",
      render_version: "production",
      topic: "Bloodlines",
      hook_type: "confirmation",
    },
    {
      video_id: "yt_recent_topic_fixture",
      story_id: "recent-fixture",
      title: "Recent verified gaming short",
      publish_time: "2026-04-26T18:00:00.000Z",
      snapshot_at: "2026-04-27T18:00:00.000Z",
      snapshot_label: "+24h",
      views: 3300,
      watch_time_seconds: 29700,
      average_view_duration_seconds: 9,
      average_percentage_viewed: 36,
      likes: 61,
      comments: 7,
      subscribers_gained: 0,
      platform: "youtube",
      render_version: "production",
      topic: "verified-news",
      hook_type: "hard-reveal",
    },
    {
      video_id: "local_1sn9xhe_v21",
      story_id: "1sn9xhe",
      title: "METRO 2039 is real, and the reveal is unusually grim",
      publish_time: "2026-04-27T17:10:56.276Z",
      snapshot_at: "2026-04-27T18:30:00.000Z",
      snapshot_label: "local-render-fixture",
      views: 0,
      watch_time_seconds: 0,
      average_view_duration_seconds: 0,
      average_percentage_viewed: null,
      likes: 0,
      comments: 0,
      subscribers_gained: 0,
      platform: "local",
      render_version: "studio-v21",
      topic: "Metro",
      hook_type: "hard-reveal",
    },
  ];
}

async function buildLocalFeatures() {
  const v21Report = await readJsonIfExists(
    path.join(OUTPUT_DIR, "1sn9xhe_studio_v2_v21_report.json"),
  );
  const canonicalReport = await readJsonIfExists(
    path.join(OUTPUT_DIR, "1sn9xhe_studio_v2_report.json"),
  );
  const features = [];
  if (canonicalReport) {
    features.push(
      extractVideoFeatures({
        report: canonicalReport,
        analytics: {
          video_id: "local_1sn9xhe_canonical",
          title: canonicalReport?.seo?.title,
          render_version: "studio-v2",
        },
      }),
    );
  }
  if (v21Report) {
    features.push(
      extractVideoFeatures({
        report: v21Report,
        analytics: {
          video_id: "local_1sn9xhe_v21",
          title: v21Report?.seo?.title,
          render_version: "studio-v21",
        },
      }),
    );
  }
  features.push(
    {
      video_id: "yt_bloodlines_fixture",
      story_id: "bloodlines-fixture",
      channel_id: "pulse-gaming",
      title: "Bloodlines update tested by Shorts feed",
      topic: "Bloodlines",
      franchise: "Bloodlines",
      story_type: "Verified",
      hook_type: "confirmation",
      title_pattern: "confirmed-reveal",
      runtime_seconds: 25.3,
      render_version: "production",
      source_mix: { clip_count: 0, still_count: 5, card_count: 2, scene_count: 7 },
      clip_ratio: 0,
      still_ratio: 0.71,
      card_ratio: 0.29,
      hero_moment_count: 0,
    },
    {
      video_id: "yt_recent_topic_fixture",
      story_id: "recent-fixture",
      channel_id: "pulse-gaming",
      title: "Recent verified gaming short",
      topic: "verified-news",
      franchise: "unknown",
      story_type: "Verified",
      hook_type: "hard-reveal",
      title_pattern: "statement",
      runtime_seconds: 50.4,
      render_version: "production",
      source_mix: { clip_count: 2, still_count: 4, card_count: 2, scene_count: 8 },
      clip_ratio: 0.25,
      still_ratio: 0.5,
      card_ratio: 0.25,
      hero_moment_count: 0,
    },
  );
  return features;
}

async function main() {
  await fs.ensureDir(OUTPUT_DIR);
  const snapshots = buildFixtureSnapshots();
  const features = await buildLocalFeatures();
  const commentDigestPath = path.join(OUTPUT_DIR, "comment_digest.json");
  const commentDigest = await readJsonIfExists(commentDigestPath);
  const digest = buildPerformanceLearningDigest({
    snapshots,
    features,
    commentInsights: commentDigest?.comments || [],
    dataSource: "fixture-plus-local-render-reports",
  });
  const jsonPath = path.join(OUTPUT_DIR, "performance_learning_digest.json");
  const mdPath = path.join(OUTPUT_DIR, "performance_learning_digest.md");
  await fs.writeJson(jsonPath, digest, { spaces: 2 });
  await fs.writeFile(mdPath, renderDigestMarkdown(digest), "utf8");
  console.log(`[performance] wrote ${path.relative(ROOT, jsonPath)}`);
  console.log(`[performance] wrote ${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { buildFixtureSnapshots, buildLocalFeatures };
