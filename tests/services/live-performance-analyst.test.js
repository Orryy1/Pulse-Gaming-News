"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const a = require("../../lib/intelligence/live-performance-analyst");

// 2026-04-29: live continuous-analysis model. Pins the pure functions
// (Welford update, feature extraction, candidate selection,
// per-story analyse) and the env-gating contract on runLiveAnalystPass.

// ── Welford ───────────────────────────────────────────────────────

test("welfordUpdate: first sample sets mean to value, m2=0", () => {
  const next = a.welfordUpdate(
    { sample_count: 0, running_mean: 0, running_m2: 0 },
    10,
  );
  assert.equal(next.sample_count, 1);
  assert.equal(next.running_mean, 10);
  assert.equal(next.running_m2, 0);
});

test("welfordUpdate: matches batch mean / variance to within 1e-9", () => {
  const xs = [4, 7, 13, 16];
  let s = { sample_count: 0, running_mean: 0, running_m2: 0 };
  for (const x of xs) s = a.welfordUpdate(s, x);
  const batchMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const batchVar =
    xs.map((x) => (x - batchMean) ** 2).reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(s.sample_count, 4);
  assert.ok(Math.abs(s.running_mean - batchMean) < 1e-9);
  assert.ok(Math.abs(a.variance(s) - batchVar) < 1e-9);
});

test("variance and stdev: 0 when n<2", () => {
  const s = { sample_count: 1, running_mean: 5, running_m2: 0 };
  assert.equal(a.variance(s), 0);
  assert.equal(a.stdev(s), 0);
});

// ── feature extraction ────────────────────────────────────────────

test("extractFeatures: lowercases and fills 'unknown' for missing fields", () => {
  const f = a.extractFeatures({
    hook_type: "Hard_Reveal",
    topic: "PlayStation",
    content_pillar: undefined,
    source_type: "RSS",
    created_at: "2026-04-15T17:30:00Z",
    render_quality_class: "PREMIUM",
    comment_source_type: null,
  });
  assert.equal(f.hook_type, "hard_reveal");
  assert.equal(f.topic, "playstation");
  assert.equal(f.content_pillar, "unknown");
  assert.equal(f.source_type, "rss");
  assert.equal(f.publish_hour_utc, "17");
  assert.equal(f.render_quality_class, "premium");
  assert.equal(f.comment_source_type, "unknown");
});

// ── candidate selection ──────────────────────────────────────────

test("selectAnalysableStories: keeps stories <72h with a snapshot, skips others", () => {
  const now = Date.parse("2026-04-29T12:00:00Z");
  const fresh = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 100 * 60 * 60 * 1000).toISOString();
  const stories = [
    { id: "f1", youtube_post_id: "yt", published_at: fresh },
    { id: "old1", youtube_post_id: "yt", published_at: old },
    { id: "no_snap", youtube_post_id: "yt", published_at: fresh },
    { id: "unpub", published_at: fresh }, // no platform id
  ];
  const snapshotIndex = new Map([
    ["f1", [{ snapshot_at: fresh, views: 1000 }]],
    ["old1", [{ snapshot_at: old, views: 100 }]],
  ]);
  const got = a.selectAnalysableStories(stories, snapshotIndex, now);
  assert.deepEqual(
    got.map((s) => s.id),
    ["f1"],
  );
});

// ── analyseStory ──────────────────────────────────────────────────

test("analyseStory: cold start (no prior state) writes updates but no signals", () => {
  const story = {
    id: "s1",
    hook_type: "question",
    topic: "playstation",
    content_pillar: "Confirmed Drop",
    source_type: "rss",
    render_quality_class: "premium",
    comment_source_type: "rss_description",
    created_at: "2026-04-29T17:00:00Z",
  };
  const snapshot = {
    views: 500,
    retention_percent: 50,
    comments: 10,
  };
  const modelState = new Map();
  const { updates, signals } = a.analyseStory({ story, snapshot, modelState });
  assert.ok(updates.length > 0);
  assert.equal(signals.length, 0);
});

test("analyseStory: a clear outlier produces a signal", () => {
  // Pre-populate model state with a tight distribution (mean=100, low σ)
  // for hook_type=question, then feed a story with views=2000 — a huge
  // overperform.
  const modelState = new Map();
  // Seed 10 prior samples around 100 with small spread
  let s = {
    sample_count: 0,
    running_mean: 0,
    running_m2: 0,
    feature_kind: "hook_type",
    feature_value: "question",
    metric: "views",
  };
  for (const v of [98, 102, 100, 99, 101, 100, 100, 102, 99, 101]) {
    s = { ...s, ...a.welfordUpdate(s, v) };
  }
  modelState.set("hook_type|question|views", s);

  const story = {
    id: "outlier-1",
    hook_type: "question",
    topic: "general",
    content_pillar: "Confirmed Drop",
    source_type: "rss",
    render_quality_class: "standard",
    comment_source_type: "none",
    created_at: "2026-04-29T17:00:00Z",
  };
  const snapshot = { views: 2000, retention_percent: 50, comments: 10 };
  const { signals } = a.analyseStory({ story, snapshot, modelState });
  // Should produce a strong overperform signal on hook_type=question/views.
  const hit = signals.find(
    (sig) =>
      sig.signal_kind === "outlier_overperform" &&
      sig.metric === "views" &&
      JSON.parse(sig.raw_json).feature_kind === "hook_type",
  );
  assert.ok(
    hit,
    `expected hook_type/views signal, got ${JSON.stringify(signals)}`,
  );
  assert.ok(hit.severity > 5);
});

// ── env-gating ────────────────────────────────────────────────────

test("runLiveAnalystPass: env unset → enabled=false, no DB read", async () => {
  let getStoriesCalled = false;
  const summary = await a.runLiveAnalystPass({
    db: {
      async getStories() {
        getStoriesCalled = true;
        return [];
      },
    },
    repos: { db: null },
    env: {},
    log: () => {},
  });
  assert.equal(summary.enabled, false);
  assert.equal(getStoriesCalled, false);
});

test("runLiveAnalystPass: env true + no candidates → enabled=true with zeroed counters", async () => {
  const summary = await a.runLiveAnalystPass({
    db: {
      async getStories() {
        return [];
      },
    },
    repos: { db: null },
    env: { LIVE_ANALYST_ENABLED: "true" },
    log: () => {},
  });
  assert.equal(summary.enabled, true);
  assert.equal(summary.analysed, 0);
});

// ── formatMetric ──────────────────────────────────────────────────

test("formatMetric: comments_per_view rendered in per-mille", () => {
  assert.equal(a.formatMetric("comments_per_view", 0.025), "25.00‰");
});

test("formatMetric: avg_view_pct rendered in percent", () => {
  assert.equal(a.formatMetric("avg_view_pct", 0.42), "42.0%");
});

test("formatMetric: views rendered as integer", () => {
  assert.equal(a.formatMetric("views", 1234.7), "1235");
});

// ── latestSnapshotsByPlatform ────────────────────────────────────

test("latestSnapshotsByPlatform: keeps the most recent per platform", () => {
  const snaps = [
    { platform: "youtube", snapshot_at: "2026-04-29T10:00:00Z", views: 100 },
    { platform: "youtube", snapshot_at: "2026-04-29T15:00:00Z", views: 200 },
    { platform: "tiktok", snapshot_at: "2026-04-29T12:00:00Z", views: 50 },
  ];
  const got = a.latestSnapshotsByPlatform(snaps);
  assert.equal(got.get("youtube").views, 200);
  assert.equal(got.get("tiktok").views, 50);
});
