"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  bind: bindControlledExperiments,
} = require("../../lib/repositories/controlled_video_experiments");
const {
  bind: bindAnalyticsSnapshots,
} = require("../../lib/repositories/youtube_analytics_experiment_snapshots");
const {
  createYouTubeAnalyticsIngestionService,
} = require("../../lib/services/youtube-analytics-ingestion");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const NOW = new Date("2026-07-27T12:00:00.000Z");

function fixture() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  const experiments = bindControlledExperiments(db);
  experiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  experiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-1",
    videoId: "youtube-video-1",
    assignedAt: "2026-07-26T12:00:00.000Z",
    creativeManifest: {
      runtime_seconds: 31.25,
      hook_type: "direct",
      narrator_version: "elevenlabs-pulse-v3",
      first_frame_text: "GAME PASS JUST CHANGED",
      motion_ratio: 0.625,
      topic: "Game Pass catalogue update",
      game: "Fable",
      platform: "Xbox",
      source_type: "official_xbox_wire",
      consequence_lane: "what_changes_for_players",
      runtime_commit_sha: "a".repeat(40),
      renderer_version: "studio-v21.4.0",
      qa_result: "pass",
      published_at: "2026-07-26T12:00:00.000Z",
    },
  });
  return {
    db,
    snapshots: bindAnalyticsSnapshots(db),
  };
}

test("ingestion persists only metrics returned for the explicit assigned video", async () => {
  const { db, snapshots } = fixture();
  const calls = [];
  const service = createYouTubeAnalyticsIngestionService({
    snapshots,
    now: () => NOW,
    analyticsAdapter: {
      async fetchVideoSnapshot(input) {
        calls.push(input);
        return {
          status: "collected",
          channelId: "UC_PULSE_GAMING",
          videoId: "youtube-video-1",
          snapshotWindow: "24h",
          metrics: {
            average_percentage_viewed: 63.5,
            engaged_views: 80,
            views: 120,
          },
          sourceRequest: {
            summary: {
              ids: "channel==UC_PULSE_GAMING",
              filters: "video==youtube-video-1",
            },
          },
          sourcePayload: {
            summary: {
              columnHeaders: [{ name: "video" }, { name: "views" }],
              rows: [["youtube-video-1", 120]],
            },
          },
        };
      },
    },
  });

  const result = await service.ingestSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
  });

  assert.deepEqual(calls, [
    {
      channelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
      startDate: "2026-07-26",
      endDate: "2026-07-27",
      includeBreakdowns: true,
    },
  ]);
  assert.equal(result.status, "collected");
  assert.equal(result.persisted, true);
  assert.equal(result.snapshot.views, 120);
  assert.equal(result.snapshot.shown_in_feed, null);
  assert.equal(result.snapshot.stayed_to_watch_percent, null);
  assert.equal(result.snapshot.swiped_away_percent, null);
  assert.equal(result.snapshot.retention_1_second_percent, null);
  assert.equal(result.snapshot.retention_3_second_percent, null);
  assert.equal(result.snapshot.retention_10_second_percent, null);
  assert.deepEqual(
    JSON.parse(result.snapshot.metric_derivations_json),
    {},
  );
  assert.equal(
    snapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
    }).id,
    result.snapshot.id,
  );
  db.close();
});

test("ingestion derives 1s, 3s and 10s retention only from observed curve evidence and immutable runtime", async () => {
  const { db, snapshots } = fixture();
  const retentionCurve = [
    {
      elapsed_video_time_ratio: 0,
      audience_watch_ratio: 1,
      relative_retention_performance: 0.5,
    },
    {
      elapsed_video_time_ratio: 0.04,
      audience_watch_ratio: 0.92,
      relative_retention_performance: 0.45,
    },
    {
      elapsed_video_time_ratio: 0.08,
      audience_watch_ratio: 0.86,
      relative_retention_performance: 0.4,
    },
    {
      elapsed_video_time_ratio: 0.12,
      audience_watch_ratio: 0.8,
      relative_retention_performance: 0.35,
    },
    {
      elapsed_video_time_ratio: 0.32,
      audience_watch_ratio: 0.6,
      relative_retention_performance: 0.2,
    },
  ];
  const rawRetentionPayload = {
    columnHeaders: [
      { name: "elapsedVideoTimeRatio" },
      { name: "audienceWatchRatio" },
      { name: "relativeRetentionPerformance" },
    ],
    rows: [
      [0, 1, 0.5],
      [0.04, 0.92, 0.45],
      [0.08, 0.86, 0.4],
      [0.12, 0.8, 0.35],
      [0.32, 0.6, 0.2],
    ],
  };
  const service = createYouTubeAnalyticsIngestionService({
    snapshots,
    now: () => NOW,
    analyticsAdapter: {
      async fetchVideoSnapshot() {
        return {
          status: "collected",
          channelId: "UC_PULSE_GAMING",
          videoId: "youtube-video-1",
          snapshotWindow: "24h",
          metrics: {
            engaged_views: 80,
            views: 120,
          },
          breakdowns: { retention_curve: retentionCurve },
          sourceRequest: {
            retention: {
              dimensions: "elapsedVideoTimeRatio",
              filters: "video==youtube-video-1",
            },
          },
          sourcePayload: {
            retention: rawRetentionPayload,
            summary: {
              columnHeaders: [
                { name: "video" },
                { name: "views" },
                { name: "engagedViews" },
              ],
              rows: [["youtube-video-1", 120, 80]],
            },
          },
        };
      },
    },
  });

  const result = await service.ingestSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
  });

  assert.equal(result.snapshot.retention_1_second_percent, 93.6);
  assert.equal(result.snapshot.retention_3_second_percent, 83.6);
  assert.equal(result.snapshot.retention_10_second_percent, 60);
  assert.equal(result.snapshot.stayed_to_watch_percent, null);
  assert.equal(result.snapshot.swiped_away_percent, null);
  assert.deepEqual(
    JSON.parse(result.snapshot.observed_metrics_json),
    ["engaged_views", "views"],
  );
  assert.deepEqual(
    JSON.parse(result.snapshot.retention_curve_json),
    retentionCurve,
  );
  assert.deepEqual(
    JSON.parse(result.snapshot.source_payload_json).retention,
    rawRetentionPayload,
  );
  const derivations = JSON.parse(
    result.snapshot.metric_derivations_json,
  );
  const assignmentEvidence = db
    .prepare(
      `SELECT creative_manifest_sha256
       FROM controlled_video_experiment_cells
       WHERE video_id = ?`,
    )
    .get("youtube-video-1");
  assert.equal(
    derivations.retention_1_second_percent.method,
    "linear_interpolation_elapsed_video_time_ratio_v1",
  );
  assert.equal(
    derivations.retention_3_second_percent.method,
    "linear_interpolation_elapsed_video_time_ratio_v1",
  );
  assert.equal(
    derivations.retention_10_second_percent.method,
    "exact_observed_curve_point_v1",
  );
  assert.equal(
    derivations.retention_1_second_percent.runtime_seconds,
    31.25,
  );
  assert.equal(
    derivations.retention_1_second_percent.target_seconds,
    1,
  );
  assert.equal(
    derivations.retention_1_second_percent
      .assignment_creative_manifest_sha256,
    assignmentEvidence.creative_manifest_sha256,
  );
  assert.match(
    derivations.retention_1_second_percent.retention_curve_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    derivations.retention_1_second_percent.retention_curve_sha256,
    crypto
      .createHash("sha256")
      .update(result.snapshot.retention_curve_json)
      .digest("hex"),
  );
  assert.equal(
    derivations.retention_3_second_percent.retention_curve_sha256,
    derivations.retention_1_second_percent.retention_curve_sha256,
  );
  assert.deepEqual(
    derivations.retention_1_second_percent.lower_observation,
    {
      audience_watch_ratio: 1,
      elapsed_video_time_ratio: 0,
    },
  );
  assert.deepEqual(
    derivations.retention_1_second_percent.upper_observation,
    {
      audience_watch_ratio: 0.92,
      elapsed_video_time_ratio: 0.04,
    },
  );
  db.close();
});

test("a no-data Analytics response remains explicit and does not create a metric row", async () => {
  const { db, snapshots } = fixture();
  const service = createYouTubeAnalyticsIngestionService({
    snapshots,
    now: () => NOW,
    analyticsAdapter: {
      async fetchVideoSnapshot() {
        return {
          status: "no_data",
          channelId: "UC_PULSE_GAMING",
          videoId: "youtube-video-1",
          snapshotWindow: "24h",
          metrics: {},
          sourceRequest: {
            summary: {
              ids: "channel==UC_PULSE_GAMING",
              filters: "video==youtube-video-1",
            },
          },
          sourcePayload: { summary: { columnHeaders: [], rows: [] } },
        };
      },
    },
  });

  const result = await service.ingestSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    status: "no_data",
    persisted: false,
    identity: {
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      storyId: "story-1",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
    },
  });
  assert.equal(
    snapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
    }),
    null,
  );
  db.close();
});

test("ingestion refuses an early review window before calling the Analytics boundary", async () => {
  const { db, snapshots } = fixture();
  let adapterCalled = false;
  const service = createYouTubeAnalyticsIngestionService({
    snapshots,
    now: () => new Date("2026-07-27T11:59:59.000Z"),
    analyticsAdapter: {
      async fetchVideoSnapshot() {
        adapterCalled = true;
        throw new Error("adapter must not be called early");
      },
    },
  });

  await assert.rejects(
    service.ingestSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      storyId: "story-1",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
      publishedAt: "2026-07-26T12:00:00.000Z",
    }),
    /youtube_analytics_snapshot_window_not_due/,
  );
  assert.equal(adapterCalled, false);
  db.close();
});

test("ingestion rejects adapter identity mismatch without persisting metrics", async () => {
  const { db, snapshots } = fixture();
  const service = createYouTubeAnalyticsIngestionService({
    snapshots,
    now: () => NOW,
    analyticsAdapter: {
      async fetchVideoSnapshot() {
        return {
          status: "collected",
          channelId: "UC_WRONG_CHANNEL",
          videoId: "youtube-video-1",
          snapshotWindow: "24h",
          metrics: { views: 999 },
          sourceRequest: {},
          sourcePayload: { rows: [["youtube-video-1", 999]] },
        };
      },
    },
  });

  await assert.rejects(
    service.ingestSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      storyId: "story-1",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
      publishedAt: "2026-07-26T12:00:00.000Z",
    }),
    /youtube_analytics_adapter_identity_mismatch/,
  );
  assert.equal(
    snapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
    }),
    null,
  );
  db.close();
});
