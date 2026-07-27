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
  assert.equal(result.snapshot.retention_3_second_percent, null);
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
