"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");
const packageJson = require("../../package.json");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");

const {
  buildCreatorStudioMetricSnapshotRows,
  buildContinuousLearningSummary,
  resolveLearningPaths,
  runContinuousLearningLoop,
  selectPublishedVideoTargets,
  writeRetentionIntelligenceOutputs,
} = require("../../lib/intelligence/continuous-learning-loop");

test("continuous learning selects recent published YouTube targets safely", () => {
  const now = Date.parse("2026-05-17T12:00:00.000Z");
  const stories = [
    {
      id: "newer",
      title: "Newer published short",
      youtube_post_id: "yt_new",
      youtube_published_at: "2026-05-16T20:00:00.000Z",
    },
    {
      id: "dupe",
      title: "Duplicate sentinel",
      youtube_post_id: "DUPE_yt_old",
      youtube_published_at: "2026-05-16T18:00:00.000Z",
    },
    {
      id: "old",
      title: "Too old",
      youtube_post_id: "yt_old",
      youtube_published_at: "2026-03-01T10:00:00.000Z",
    },
    {
      id: "draft",
      title: "Not published",
      exported_path: "out.mp4",
    },
  ];

  const targets = selectPublishedVideoTargets(stories, {
    now,
    maxAgeDays: 30,
    limit: 5,
  });

  assert.deepEqual(
    targets.map((target) => target.story_id),
    ["newer"],
  );
  assert.equal(targets[0].video_id, "yt_new");
});

test("continuous learning summary exposes public-model state without claiming token changes", () => {
  const summary = buildContinuousLearningSummary({
    generatedAt: "2026-05-17T12:00:00.000Z",
    targets: [{ story_id: "s1", video_id: "yt1", title: "Short" }],
    tokenStatus: { exists: true, yt_analytics_scope: "missing" },
    env: {},
    liveSummary: {
      enabled: true,
      analysed: 2,
      updates_persisted: 12,
      signals_logged: 1,
      notified: 0,
      errors: [],
    },
    retentionOutputs: [],
  });

  assert.equal(summary.status, "public_counter_learning_active");
  assert.ok(summary.blockers.includes("youtube_analytics_scope_not_granted"));
  assert.equal(summary.automatic_adjustments.script_hooks, true);
  assert.equal(summary.automatic_adjustments.visual_v3_retention_beats, false);
  assert.equal(summary.safety.oauth_triggered, false);
  assert.equal(summary.safety.token_values_printed, false);
  assert.equal(summary.safety.story_rows_mutated, false);
  assert.equal(summary.safety.derived_learning_tables_mutated, true);
});

test("continuous learning writes per-story retention intelligence for Visual V3", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-retention-"));
  try {
    const outputs = await writeRetentionIntelligenceOutputs({
      outputDir: dir,
      generatedAt: "2026-05-17T12:00:00.000Z",
      targets: [
        {
          story_id: "story1",
          video_id: "yt_story1",
          title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
          story: {
            id: "story1",
            title:
              "Forza Horizon 6 hits 130,000 concurrent players on Steam",
            full_script:
              "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
          },
        },
      ],
      retentionInputsByVideo: new Map([
        [
          "yt_story1",
          {
            videoId: "yt_story1",
            fixture: true,
            retentionRows: [
              { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
              { elapsed_video_time_ratio: 0.05, audience_watch_ratio: 0.72 },
              { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.61 },
            ],
            trafficRows: [
              {
                traffic_source_type: "SHORTS",
                views: 1000,
                average_percentage_viewed: 55,
              },
            ],
          },
        ],
      ]),
    });

    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].story_id, "story1");
    assert.equal(outputs[0].fixture, true);
    const json = await fs.readJson(path.join(dir, "story1.json"));
    assert.equal(json.story_id, "story1");
    assert.equal(json.video_id, "yt_story1");
    assert.ok(json.visual_v3_adjustments.timeline_events.length >= 1);
    const index = await fs.readJson(path.join(dir, "index.json"));
    assert.equal(index.entries[0].json_path.endsWith("story1.json"), true);
  } finally {
    fs.removeSync(dir);
  }
});

test("continuous learning converts Creator Studio traffic into rich metric snapshots", () => {
  const rows = buildCreatorStudioMetricSnapshotRows({
    generatedAt: "2026-05-17T12:00:00.000Z",
    targets: [
      {
        story_id: "story1",
        video_id: "yt_story1",
        story: { channel_id: "pulse-gaming" },
      },
    ],
    retentionInputsByVideo: new Map([
      [
        "yt_story1",
        {
          fixture: false,
          retentionRows: [
            { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.62 },
          ],
          trafficRows: [
            {
              traffic_source_type: "SHORTS",
              views: 100,
              estimated_minutes_watched: 8,
              average_percentage_viewed: 56,
            },
            {
              traffic_source_type: "BROWSE",
              views: 50,
              average_view_duration_seconds: 20,
              average_percentage_viewed: 0.42,
            },
          ],
        },
      ],
    ]),
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].story_id, "story1");
  assert.equal(rows[0].platform, "youtube");
  assert.equal(rows[0].external_id, "yt_story1");
  assert.equal(rows[0].views, 150);
  assert.equal(rows[0].watch_time_seconds, 1480);
  assert.equal(rows[0].retention_percent, 51.3333);
  assert.equal(rows[0].raw_json.retention_rows, 1);
  assert.equal(rows[0].raw_json.traffic_rows, 2);
  assert.equal(JSON.stringify(rows[0]).includes("access_token"), false);
});

test("resolveLearningPaths defaults beside the canonical database", () => {
  const paths = resolveLearningPaths({
    env: {},
    cwd: "C:\\repo",
    resolveDbPath: () => "D:\\pulse-data\\pulse.db",
  });

  assert.equal(paths.root, "D:\\pulse-data\\learning");
  assert.equal(
    paths.retentionDir,
    "D:\\pulse-data\\learning\\retention-intelligence",
  );
});

test("continuous learning loop is registered for operators and scheduler", () => {
  assert.equal(
    packageJson.scripts["ops:learning-loop"],
    "node tools/continuous-learning-loop.js",
  );
  const schedule = DEFAULT_SCHEDULES.find(
    (item) => item.name === "continuous_learning_loop_hourly",
  );
  assert.ok(schedule);
  assert.equal(schedule.kind, "continuous_learning_loop");
  assert.equal(schedule.cron_expr, "15 * * * *");
  assert.equal(typeof handlers.continuous_learning_loop, "function");
});

test("continuous learning real mode can write Visual V3 retention files with injected read-only auth", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-learning-real-"));
  try {
    const result = await runContinuousLearningLoop({
      stories: [
        {
          id: "story1",
          title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
          youtube_post_id: "yt_story1",
          youtube_published_at: "2026-05-17T10:00:00.000Z",
          full_script:
            "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
        },
      ],
      env: {
        INTELLIGENCE_ANALYTICS_MODE: "real",
        INTELLIGENCE_REAL_MODE: "true",
        PULSE_LEARNING_DIR: dir,
      },
      now: Date.parse("2026-05-17T12:00:00.000Z"),
      dry: true,
      readTokenStatus: async () => ({
        exists: true,
        has_access_token: true,
        yt_analytics_scope: "granted",
      }),
      runLiveModel: async () => ({ enabled: true, analysed: 1, errors: [] }),
      authClientProvider: async () => ({ authClient: { fake: true } }),
      analyticsClientFactory: () => ({
        async pullRetentionIntelligenceInputsForVideos(videoIds) {
          return videoIds.map((videoId) => ({
            videoId,
            fixture: false,
            retentionRows: [
              { elapsed_video_time_ratio: 0, audience_watch_ratio: 1 },
              { elapsed_video_time_ratio: 0.05, audience_watch_ratio: 0.73 },
              { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.62 },
            ],
            trafficRows: [
              {
                traffic_source_type: "SHORTS",
                views: 1000,
                average_percentage_viewed: 56,
              },
            ],
          }));
        },
      }),
      log: () => {},
    });

    assert.equal(
      result.summary.status,
      "creator_studio_retention_learning_active",
    );
    assert.equal(
      result.summary.automatic_adjustments.visual_v3_retention_beats,
      true,
    );
    assert.equal(result.summary.safety.oauth_triggered, false);
    assert.equal(result.summary.safety.token_values_printed, false);
    assert.equal(await fs.pathExists(path.join(dir, "retention-intelligence", "story1.json")), true);
  } finally {
    fs.removeSync(dir);
  }
});

test("continuous learning persists real Creator Studio snapshots to derived tables", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-learning-persist-"));
  const inserted = [];
  try {
    const result = await runContinuousLearningLoop({
      stories: [
        {
          id: "story1",
          title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
          youtube_post_id: "yt_story1",
          youtube_published_at: "2026-05-17T10:00:00.000Z",
        },
      ],
      env: {
        INTELLIGENCE_ANALYTICS_MODE: "real",
        INTELLIGENCE_REAL_MODE: "true",
        PULSE_LEARNING_DIR: dir,
      },
      now: Date.parse("2026-05-17T12:00:00.000Z"),
      readTokenStatus: async () => ({
        exists: true,
        has_access_token: true,
        yt_analytics_scope: "granted",
      }),
      readDbSignals: () => ({ rich_retention_rows: inserted.length }),
      runLiveModel: async () => ({ enabled: true, analysed: 1, errors: [] }),
      authClientProvider: async () => ({ authClient: { fake: true } }),
      repos: {
        db: {
          prepare() {
            return {
              run(row) {
                inserted.push(row);
                return { lastInsertRowid: inserted.length };
              },
            };
          },
        },
      },
      analyticsClientFactory: () => ({
        async pullRetentionIntelligenceInputsForVideos(videoIds) {
          return videoIds.map((videoId) => ({
            videoId,
            fixture: false,
            retentionRows: [
              { elapsed_video_time_ratio: 0.1, audience_watch_ratio: 0.62 },
            ],
            trafficRows: [
              {
                traffic_source_type: "SHORTS",
                views: 1000,
                estimated_minutes_watched: 42,
                average_percentage_viewed: 56,
              },
            ],
          }));
        },
      }),
      log: () => {},
    });

    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].story_id, "story1");
    assert.equal(
      result.summary.learning_surfaces.creator_studio_snapshots.persisted,
      1,
    );
    assert.equal(result.summary.safety.derived_learning_tables_mutated, true);
  } finally {
    fs.removeSync(dir);
  }
});
