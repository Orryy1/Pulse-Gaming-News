"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractVideoFeatures,
  hookType,
  sourceMixFromReport,
  titlePattern,
} = require("../../lib/performance/feature-extractor");
const {
  classifyScore,
  scorePerformanceSnapshot,
} = require("../../lib/performance/performance-score");
const {
  buildPerformanceLearningDigest,
  latestSnapshotByVideo,
  renderDigestMarkdown,
} = require("../../lib/performance/learning-digest");

test("feature extractor derives source mix and render metadata from a Studio report", () => {
  const report = {
    storyId: "s1",
    runtime: { durationS: 51.2 },
    editorial: { chosenHook: "Metro 2039 is real, and the reveal is grim." },
    seo: { title: "Metro 2039 is real" },
    heroMoments: { enabled: true, momentCount: 3 },
    sceneList: [
      { type: "opener" },
      { type: "punch" },
      { type: "clip.frame" },
      { type: "card.source" },
      { type: "card.quote" },
    ],
  };
  const mix = sourceMixFromReport(report);
  assert.equal(mix.clip_count, 2);
  assert.equal(mix.still_count, 1);
  assert.equal(mix.card_count, 2);
  const features = extractVideoFeatures({ report });
  assert.equal(features.render_version, "studio-v21");
  assert.equal(features.hook_type, "hard-reveal");
  assert.equal(features.hero_moment_count, 3);
});

test("hook and title pattern helpers keep the labels simple and explainable", () => {
  assert.equal(hookType("Is this finally real?"), "question");
  assert.equal(hookType("The trailer is reportedly coming soon."), "qualified-rumour");
  assert.equal(titlePattern("Metro 2039 is real"), "is-real-reveal");
  assert.equal(titlePattern("When is Switch 2 out?"), "question");
});

test("performance score favours retention, velocity and engagement without overfitting", () => {
  const result = scorePerformanceSnapshot({
    views: 10000,
    likes: 500,
    comments: 100,
    subscribers_gained: 20,
    average_percentage_viewed: 72,
    age_hours: 10,
  });
  assert.ok(result.score >= 90);
  assert.equal(classifyScore(result.score), "strong");
  assert.equal(result.derived.views_per_hour, 1000);
});

test("latestSnapshotByVideo keeps the newest row for each video", () => {
  const rows = latestSnapshotByVideo([
    { video_id: "a", snapshot_at: "2026-04-27T10:00:00.000Z", views: 10 },
    { video_id: "a", snapshot_at: "2026-04-27T12:00:00.000Z", views: 20 },
    { video_id: "b", snapshot_at: "2026-04-27T09:00:00.000Z", views: 5 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.video_id === "a").views, 20);
});

test("learning digest emits conservative recommendations and markdown", () => {
  const digest = buildPerformanceLearningDigest({
    snapshots: [
      {
        video_id: "low-retention",
        title: "Low retention",
        views: 1000,
        likes: 10,
        comments: 1,
        average_percentage_viewed: 22,
        age_hours: 24,
        snapshot_at: "2026-04-27T12:00:00.000Z",
      },
    ],
    features: [
      {
        video_id: "low-retention",
        topic: "Metro",
        hook_type: "hard-reveal",
        runtime_seconds: 54,
        render_version: "studio-v21",
        hero_moment_count: 2,
      },
    ],
  });
  assert.equal(digest.videoCount, 1);
  assert.ok(digest.recommendations.some((r) => r.type === "retention"));
  const md = renderDigestMarkdown(digest);
  assert.match(md, /Performance Intelligence Loop v1/);
  assert.match(md, /No production scoring weights were changed/);
});
