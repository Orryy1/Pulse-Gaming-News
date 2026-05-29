"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  buildSponsorPerformanceSnapshotFromSignals,
  buildSponsorPerformanceSnapshotFromLocalSources,
  buildGoal25SponsorReadinessPack,
  writeGoal25SponsorReadinessPack,
} = require("../../lib/goal25-sponsor-readiness-pack");

async function makeStoryPackage(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: overrides.title || `Story ${storyId}`,
    canonical_subject: overrides.subject || "Mixtape",
    content_pillar: overrides.vertical || "gaming news",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    operating_mode: "DRY_RUN_PUBLISH",
    platform_pack_version: "platform_pack_v1",
    outputs: {
      youtube_shorts: { title: overrides.title || `Story ${storyId}` },
      instagram_reels: { caption: overrides.title || `Story ${storyId}` },
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    story_id: storyId,
    verdict: overrides.policyVerdict || "pass",
    publish_blockers: overrides.policyBlockers || [],
  });
  await fs.outputJson(path.join(artifactDir, "finance_crypto_risk_report.json"), {
    story_id: storyId,
    verdict: overrides.financeVerdict || "pass",
    blockers: overrides.financeBlockers || [],
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: overrides.publishVerdict || "GREEN",
    can_auto_publish: false,
  });
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    title: overrides.title || `Story ${storyId}`,
  };
}

function readyGoal24(...storyIds) {
  return {
    verdict: "PASS",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "ready",
      blockers: [],
    })),
  };
}

function blockedGoal24(...storyIds) {
  return {
    verdict: "BLOCKED",
    stories: storyIds.map((storyId) => ({
      story_id: storyId,
      status: "blocked",
      blockers: ["corrections:source_status_signal_missing"],
    })),
  };
}

function mixedGoal24({ ready = [], skipped = [] } = {}) {
  return {
    verdict: "PASS",
    stories: [
      ...ready.map((storyId) => ({ story_id: storyId, status: "ready", blockers: [] })),
      ...skipped.map((storyId) => ({ story_id: storyId, status: "skipped", skipped_reason: "upstream_duplicate" })),
    ],
  };
}

function completePerformanceSnapshot(overrides = {}) {
  return {
    subscribers: 7200,
    shorts_views_90d: 2200000,
    average_views: 84000,
    average_view_duration_seconds: 31,
    average_view_percentage: 72,
    comments_per_view: 0.018,
    platform_reach: {
      youtube_shorts: 1800000,
      instagram_reels: 300000,
      tiktok: 100000,
    },
    vertical_breakdown: {
      gaming_news: 0.72,
      hardware: 0.18,
      deals: 0.1,
    },
    audience_summary: {
      core: "adult gaming news viewers",
      top_markets: ["UK", "US"],
      age_range: "25-44",
    },
    story_metrics: {
      "story-a": { views: 120000, average_view_duration_seconds: 33, platform: "youtube_shorts" },
      "story-b": { views: 97000, average_view_duration_seconds: 30, platform: "instagram_reels" },
    },
    pricing_basis: {
      currency: "GBP",
      floor_cpm: 8,
      ceiling_cpm: 18,
    },
    ...overrides,
  };
}

test("Goal 25 preserves Goal 24 blockers while direct sponsor pack inputs pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-upstream-"));
  const story = await makeStoryPackage(root, "story-a", { title: "Mixtape Release Date Changed" });

  const report = await buildGoal25SponsorReadinessPack({
    storyPackages: [story],
    upstreamCorrectionsReport: blockedGoal24("story-a"),
    performanceSnapshot: completePerformanceSnapshot(),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:08:16.908Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_sponsor_verdict, "PASS");
  assert.equal(report.summary.sponsor_ready_story_count, 0);
  assert.equal(report.summary.direct_sponsor_pass_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("upstream:goal24_corrections_retractions_takedowns_blocked"));
  assert.ok(report.stories[0].blockers.includes("corrections:source_status_signal_missing"));
  assert.equal(report.sponsor_media_kit.ready_for_outreach, false);
  assert.equal(report.safety.no_sponsor_outreach_sent, true);
});

test("Goal 25 preserves Goal 24 skipped stories instead of turning them into sponsor blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-skipped-"));
  const ready = await makeStoryPackage(root, "ready-story");
  const skipped = await makeStoryPackage(root, "skipped-story");

  const report = await buildGoal25SponsorReadinessPack({
    storyPackages: [ready, skipped],
    upstreamCorrectionsReport: mixedGoal24({ ready: ["ready-story"], skipped: ["skipped-story"] }),
    performanceSnapshot: completePerformanceSnapshot({
      story_metrics: {
        "ready-story": { views: 91000, average_view_duration_seconds: 32, platform: "youtube_shorts" },
      },
    }),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:08:16.908Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.sponsor_ready_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  const skippedStory = report.stories.find((story) => story.story_id === "skipped-story");
  assert.equal(skippedStory.status, "skipped");
  assert.equal(skippedStory.upstream_status, "skipped");
  assert.deepEqual(skippedStory.blockers, []);
});

test("Goal 25 derives a sponsor performance snapshot from verified channel and analytics signals", () => {
  const snapshot = buildSponsorPerformanceSnapshotFromSignals({
    channelStats: { subscribers: 17, views: 43176, videos: 91, source: "youtube_public_api:@PulseGMG" },
    analyticsSnapshots: [
      {
        story_id: "story-a",
        title: "Mixtape Release Date Changed",
        content_pillar: "gaming_news",
        youtube_views: 120,
        instagram_views: 20,
        tiktok_views: 0,
        youtube_comments: 2,
        instagram_comments: 1,
        tiktok_comments: 0,
        total_views: 140,
      },
      {
        story_id: "story-b",
        title: "Steam Deck Gets A Useful Update",
        content_pillar: "hardware",
        youtube_views: 80,
        instagram_views: 10,
        tiktok_views: 0,
        youtube_comments: 1,
        instagram_comments: 0,
        tiktok_comments: 0,
        total_views: 90,
      },
    ],
    retentionReports: [
      { story_id: "story-a", durationS: 60, traffic: { weighted_average_percentage_viewed: 0.5 } },
      { story_id: "story-b", durationS: 40, traffic: { shorts_average_percentage_viewed: 0.75 } },
    ],
    generatedAt: "2026-05-26T07:08:16.908Z",
  });

  assert.equal(snapshot.subscribers, 17);
  assert.equal(snapshot.shorts_views_90d, 230);
  assert.equal(snapshot.average_views, 115);
  assert.equal(snapshot.average_view_duration_seconds, 30);
  assert.equal(snapshot.average_view_percentage, 62.5);
  assert.equal(snapshot.comments_per_view, 4 / 230);
  assert.deepEqual(snapshot.platform_reach, {
    youtube_shorts: 200,
    instagram_reels: 30,
    tiktok: 0,
  });
  assert.equal(snapshot.vertical_breakdown.gaming_news, 1);
  assert.equal(snapshot.vertical_breakdown.hardware, 1);
  assert.equal(snapshot.audience_summary.core, "gaming news viewers");
  assert.equal(snapshot.provenance.channel_stats, "youtube_public_api:@PulseGMG");
});

test("Goal 25 reads sponsor performance inputs from local analytics and retention artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-local-snapshot-"));
  const dbPath = path.join(root, "pulse.db");
  const retentionDir = path.join(root, "retention");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE analytics_snapshots (
      story_id TEXT,
      title TEXT,
      content_pillar TEXT,
      youtube_views INTEGER,
      instagram_views INTEGER,
      tiktok_views INTEGER,
      youtube_comments INTEGER,
      instagram_comments INTEGER,
      tiktok_comments INTEGER,
      total_views INTEGER,
      published_at TEXT,
      updated_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO analytics_snapshots
    (story_id, title, content_pillar, youtube_views, instagram_views, tiktok_views, youtube_comments, instagram_comments, tiktok_comments, total_views, published_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("story-a", "Mixtape Release Date Changed", "gaming_news", 120, 20, 0, 2, 1, 0, 140, "2026-05-20T00:00:00.000Z", "2026-05-20T00:00:00.000Z");
  db.close();
  await fs.outputJson(path.join(retentionDir, "story-a.json"), {
    story_id: "story-a",
    durationS: 60,
    traffic: { weighted_average_percentage_viewed: 0.5 },
  });

  const snapshot = await buildSponsorPerformanceSnapshotFromLocalSources({
    dbPath,
    retentionDir,
    channelStats: { subscribers: 17, source: "youtube_public_api:@PulseGMG" },
    generatedAt: "2026-05-26T07:08:16.908Z",
    now: new Date("2026-05-29T00:00:00.000Z"),
  });

  assert.equal(snapshot.subscribers, 17);
  assert.equal(snapshot.shorts_views_90d, 140);
  assert.equal(snapshot.average_views, 140);
  assert.equal(snapshot.average_view_duration_seconds, 30);
  assert.equal(snapshot.average_view_percentage, 50);
  assert.equal(snapshot.provenance.analytics_rows, 1);
  assert.equal(snapshot.provenance.retention_reports, 1);
});

test("Goal 25 builds a complete draft sponsor pack when metrics and brand safety are verified", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-ready-"));
  const storyA = await makeStoryPackage(root, "story-a", { title: "Mixtape Release Date Changed" });
  const storyB = await makeStoryPackage(root, "story-b", { title: "Steam Deck Gets A Useful Update", vertical: "hardware" });

  const report = await buildGoal25SponsorReadinessPack({
    storyPackages: [storyA, storyB],
    upstreamCorrectionsReport: readyGoal24("story-a", "story-b"),
    performanceSnapshot: completePerformanceSnapshot(),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:08:16.908Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.direct_sponsor_verdict, "PASS");
  assert.equal(report.sponsor_media_kit.ready_for_outreach, true);
  assert.ok(report.sponsor_media_kit.audience_summary);
  assert.ok(report.sponsor_media_kit.best_performing_videos.length >= 2);
  assert.equal(report.sponsor_media_kit.average_views, 84000);
  assert.equal(report.sponsor_media_kit.retention_stats.average_view_duration_seconds, 31);
  assert.ok(Object.keys(report.sponsor_media_kit.platform_reach).includes("youtube_shorts"));
  assert.ok(Object.keys(report.sponsor_media_kit.vertical_breakdown).includes("gaming_news"));
  assert.ok(report.sponsor_media_kit.sponsor_safe_examples.length >= 2);
  assert.ok(report.sponsor_media_kit.pricing_recommendations.ranges.length >= 1);
  assert.ok(report.sponsor_media_kit.disclosure_plan.required_labels.includes("#ad"));
  assert.ok(report.sponsor_media_kit.sponsorship_formats.includes("sponsor-safe Short integration"));
  assert.equal(report.brand_safety_report.verdict, "PASS");
  assert.equal(report.sponsor_pitch_pack.outreach_sent, false);
});

test("Goal 25 blocks missing sponsor metrics instead of inventing a media kit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-missing-"));
  const story = await makeStoryPackage(root, "story-c");

  const report = await buildGoal25SponsorReadinessPack({
    storyPackages: [story],
    upstreamCorrectionsReport: readyGoal24("story-c"),
    performanceSnapshot: {
      shorts_views_90d: 15000,
      comments_per_view: 0.01,
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:08:16.908Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.direct_sponsor_verdict, "BLOCKED");
  assert.ok(report.direct_risk_counts["sponsor:required_metrics_missing"] >= 1);
  assert.ok(report.sponsor_media_kit.missing_metrics.includes("subscribers"));
  assert.ok(report.sponsor_media_kit.missing_metrics.includes("average_views"));
  assert.ok(report.sponsor_media_kit.missing_metrics.includes("platform_reach"));
  assert.equal(report.sponsor_media_kit.ready_for_outreach, false);
  assert.equal(report.sponsor_media_kit.pricing_recommendations.status, "blocked_missing_metrics");
  assert.deepEqual(report.sponsor_media_kit.pricing_recommendations.ranges, []);
});

test("Goal 25 writes all sponsor readiness artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal25-write-"));
  const story = await makeStoryPackage(root, "story-write");
  const report = await buildGoal25SponsorReadinessPack({
    storyPackages: [story],
    upstreamCorrectionsReport: readyGoal24("story-write"),
    performanceSnapshot: completePerformanceSnapshot({
      story_metrics: {
        "story-write": { views: 91000, average_view_duration_seconds: 32, platform: "youtube_shorts" },
      },
    }),
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T07:08:16.908Z",
  });
  const written = await writeGoal25SponsorReadinessPack(report, { outputDir: path.join(root, "out") });

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.sponsorMediaKit), true);
  assert.equal(await fs.pathExists(written.sponsorPitchPack), true);
  assert.equal(await fs.pathExists(written.brandSafetyReport), true);
});
