"use strict";

const assert = require("node:assert/strict");
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

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");

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

test("snapshot persistence stores observed metrics and leaves unavailable metrics null", () => {
  const { db, snapshots } = fixture();

  const row = snapshots.recordSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
    collectedAt: "2026-07-27T12:00:00.000Z",
    metrics: {
      average_percentage_viewed: 63.5,
      engaged_views: 80,
      views: 120,
    },
    sourcePayload: {
      columnHeaders: [
        { name: "video" },
        { name: "views" },
        { name: "engagedViews" },
        { name: "averageViewPercentage" },
      ],
      rows: [["youtube-video-1", 120, 80, 63.5]],
    },
  });

  assert.equal(row.snapshot_window, "24h");
  assert.equal(row.experiment_id, "pulse-v1-controlled-12");
  assert.equal(row.channel_id, "pulse-gaming");
  assert.equal(row.youtube_channel_id, "UC_PULSE_GAMING");
  assert.equal(row.story_id, "story-1");
  assert.equal(row.video_id, "youtube-video-1");
  assert.equal(row.views, 120);
  assert.equal(row.engaged_views, 80);
  assert.equal(row.average_percentage_viewed, 63.5);
  assert.equal(row.shown_in_feed, null);
  assert.equal(row.retention_3_second_percent, null);
  assert.deepEqual(JSON.parse(row.observed_metrics_json), [
    "average_percentage_viewed",
    "engaged_views",
    "views",
  ]);
  assert.match(row.source_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    snapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
    }).id,
    row.id,
  );
  db.close();
});

test("retention derivation never extrapolates beyond observed curve evidence", () => {
  const { db, snapshots } = fixture();
  const row = snapshots.recordSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
    collectedAt: "2026-07-27T12:00:00.000Z",
    metrics: {
      engaged_views: 80,
      views: 120,
    },
    breakdowns: {
      retention_curve: [
        {
          elapsed_video_time_ratio: 0.2,
          audience_watch_ratio: 0.7,
        },
        {
          elapsed_video_time_ratio: 0.4,
          audience_watch_ratio: 0.5,
        },
      ],
    },
    sourcePayload: {
      retention: {
        columnHeaders: [
          { name: "elapsedVideoTimeRatio" },
          { name: "audienceWatchRatio" },
        ],
        rows: [
          [0.2, 0.7],
          [0.4, 0.5],
        ],
      },
    },
  });

  assert.equal(row.retention_1_second_percent, null);
  assert.equal(row.retention_3_second_percent, null);
  assert.equal(row.retention_10_second_percent, 58);
  assert.equal(row.stayed_to_watch_percent, null);
  assert.equal(row.swiped_away_percent, null);
  assert.deepEqual(
    Object.keys(JSON.parse(row.metric_derivations_json)),
    ["retention_10_second_percent"],
  );
  db.close();
});

test("snapshot ledger allows only due 24h, 48h and 7d evidence windows", () => {
  const { db, snapshots } = fixture();
  const base = {
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    publishedAt: "2026-07-26T12:00:00.000Z",
    metrics: { views: 120 },
    sourcePayload: {
      columnHeaders: [{ name: "video" }, { name: "views" }],
      rows: [["youtube-video-1", 120]],
    },
  };

  for (const [snapshotWindow, collectedAt] of [
    ["24h", "2026-07-27T12:00:00.000Z"],
    ["48h", "2026-07-28T12:00:00.000Z"],
    ["7d", "2026-08-02T12:00:00.000Z"],
  ]) {
    assert.equal(
      snapshots.recordSnapshot({
        ...base,
        snapshotWindow,
        collectedAt,
      }).snapshot_window,
      snapshotWindow,
    );
  }
  assert.throws(
    () =>
      snapshots.recordSnapshot({
        ...base,
        snapshotWindow: "72h",
        collectedAt: "2026-07-29T12:00:00.000Z",
      }),
    /youtube_analytics_snapshot_window_invalid/,
  );
  assert.throws(
    () =>
      snapshots.recordSnapshot({
        ...base,
        snapshotWindow: "7d",
        collectedAt: "2026-08-02T11:59:59.000Z",
      }),
    /youtube_analytics_snapshot_window_not_due/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM youtube_analytics_experiment_snapshots",
      )
      .get().count,
    3,
  );
  db.close();
});

test("analytics windows are anchored to the assignment's observed publish time", () => {
  const { db, snapshots } = fixture();

  assert.throws(
    () =>
      snapshots.recordSnapshot({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        youtubeChannelId: "UC_PULSE_GAMING",
        storyId: "story-1",
        videoId: "youtube-video-1",
        snapshotWindow: "24h",
        publishedAt: "2026-07-26T12:01:00.000Z",
        collectedAt: "2026-07-27T12:01:00.000Z",
        metrics: { views: 120 },
        sourcePayload: {
          columnHeaders: [{ name: "video" }, { name: "views" }],
          rows: [["youtube-video-1", 120]],
        },
      }),
    /youtube_analytics_published_at_assignment_mismatch/,
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

test("analytics refuses assignments created under the obsolete ordinal policy", () => {
  const { db, snapshots } = fixture();
  db.exec(
    "DROP TRIGGER trg_controlled_video_experiments_immutable_update",
  );
  db.prepare(
    `UPDATE controlled_video_experiments
     SET assignment_policy = ?
     WHERE experiment_id = ?`,
  ).run(
    "canonical-ordinal-v1",
    "pulse-v1-controlled-12",
  );

  assert.throws(
    () =>
      snapshots.recordSnapshot({
        experimentId: "pulse-v1-controlled-12",
        channelId: "pulse-gaming",
        youtubeChannelId: "UC_PULSE_GAMING",
        storyId: "story-1",
        videoId: "youtube-video-1",
        snapshotWindow: "24h",
        publishedAt: "2026-07-26T12:00:00.000Z",
        collectedAt: "2026-07-27T12:00:00.000Z",
        metrics: { views: 120 },
        sourcePayload: {
          columnHeaders: [{ name: "video" }, { name: "views" }],
          rows: [["youtube-video-1", 120]],
        },
      }),
    /youtube_analytics_experiment_assignment_policy_invalid/,
  );
  db.close();
});

test("snapshot identity and evidence are immutable for each review window", () => {
  const { db, snapshots } = fixture();
  const input = {
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UC_PULSE_GAMING",
    storyId: "story-1",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    publishedAt: "2026-07-26T12:00:00.000Z",
    collectedAt: "2026-07-27T12:00:00.000Z",
    metrics: { views: 120 },
    sourcePayload: {
      columnHeaders: [{ name: "video" }, { name: "views" }],
      rows: [["youtube-video-1", 120]],
    },
  };
  const first = snapshots.recordSnapshot(input);
  assert.equal(snapshots.recordSnapshot(input).id, first.id);
  assert.throws(
    () =>
      snapshots.recordSnapshot({
        ...input,
        metrics: { views: 121 },
        sourcePayload: {
          columnHeaders: [{ name: "video" }, { name: "views" }],
          rows: [["youtube-video-1", 121]],
        },
      }),
    /youtube_analytics_snapshot_conflict/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE youtube_analytics_experiment_snapshots SET views = 999 WHERE id = ?",
        )
        .run(first.id),
    /immutable_youtube_experiment_snapshots/,
  );
  db.close();
});
