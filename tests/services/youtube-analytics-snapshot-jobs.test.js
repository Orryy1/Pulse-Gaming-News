"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bindRepositories } = require("../../lib/repositories");
const {
  classifyYouTubeAnalyticsSnapshotCompleteness,
  createLiveYouTubeAnalyticsQueryReports,
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs,
} = require("../../lib/services/youtube-analytics-snapshot-jobs");
const { handlers } = require("../../lib/job-handlers");

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
    "story-analytics-1",
    "A confirmed game update",
  );
  const repos = bindRepositories(db);
  repos.controlledExperiments.ensureExperiment({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
  });
  repos.controlledExperiments.assignNextVideo({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    storyId: "story-analytics-1",
    videoId: "youtube-video-analytics-1",
    assignedAt: "2026-07-28T19:00:05.000Z",
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
      published_at: "2026-07-28T19:00:05.000Z",
    },
  });
  return { db, repos };
}

test("a confirmed assigned YouTube publication durably schedules exactly 24h, 48h and 7d analytics snapshots once", () => {
  const { db, repos } = fixture();
  const publication = {
    confirmed: true,
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    storyId: "story-analytics-1",
    videoId: "youtube-video-analytics-1",
    publishedAt: "2026-07-28T19:00:05.000Z",
  };

  const first = enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication,
  });
  const replay = enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication,
  });

  assert.equal(first.verdict, "GREEN");
  assert.equal(first.jobs.length, 3);
  assert.deepEqual(
    replay.jobs.map((job) => job.id),
    first.jobs.map((job) => job.id),
  );
  assert.deepEqual(first.side_effects, {
    analytics_api_contacted: false,
    database_jobs_enqueued: true,
    external_posting: false,
    oauth_mutated: false,
  });

  const pending = repos.jobs.listPending();
  assert.equal(pending.length, 3);
  assert.deepEqual(
    pending.map((job) => ({
      kind: job.kind,
      run_at: job.run_at,
      snapshot_window: job.payload.snapshotWindow,
      idempotency_key: job.idempotency_key,
    })),
    [
      {
        kind: "youtube_analytics_snapshot",
        run_at: "2026-07-29 19:00:05",
        snapshot_window: "24h",
        idempotency_key:
          "youtube-analytics-snapshot:pulse-gaming:" +
          "youtube-video-analytics-1:24h",
      },
      {
        kind: "youtube_analytics_snapshot",
        run_at: "2026-07-30 19:00:05",
        snapshot_window: "48h",
        idempotency_key:
          "youtube-analytics-snapshot:pulse-gaming:" +
          "youtube-video-analytics-1:48h",
      },
      {
        kind: "youtube_analytics_snapshot",
        run_at: "2026-08-04 19:00:05",
        snapshot_window: "7d",
        idempotency_key:
          "youtube-analytics-snapshot:pulse-gaming:" +
          "youtube-video-analytics-1:7d",
      },
    ],
  );
  for (const job of pending) {
    assert.equal(job.story_id, "story-analytics-1");
    assert.equal(job.requires_gpu, 0);
    assert.equal(job.payload.read_only, true);
    assert.equal(job.payload.external_posting, false);
    assert.equal(job.payload.oauth_mutation, false);
  }
  db.close();
});

test("analytics fanout returns truthful HOLD evidence and no partial rows on a mid-batch idempotency conflict", () => {
  const { db, repos } = fixture();
  repos.jobs.enqueue({
    kind: "youtube_analytics_snapshot",
    channel_id: "pulse-gaming",
    story_id: "story-analytics-1",
    payload: {
      snapshotWindow: "48h",
      videoId: "different-video",
    },
    priority: 45,
    run_at: "2026-07-30T19:00:05.000Z",
    max_attempts: 4,
    requires_gpu: false,
    idempotency_key:
      "youtube-analytics-snapshot:pulse-gaming:" +
      "youtube-video-analytics-1:48h",
  });

  const result = enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "story-analytics-1",
      videoId: "youtube-video-analytics-1",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "youtube_analytics_snapshot_batch_enqueue_failed",
  ]);
  assert.deepEqual(result.jobs, []);
  assert.equal(result.side_effects.database_jobs_enqueued, false);
  assert.equal(
    repos.jobs.getByIdempotencyKey(
      "youtube-analytics-snapshot:pulse-gaming:" +
        "youtube-video-analytics-1:24h",
    ),
    null,
  );
  assert.equal(
    repos.jobs.getByIdempotencyKey(
      "youtube-analytics-snapshot:pulse-gaming:" +
        "youtube-video-analytics-1:7d",
    ),
    null,
  );
  assert.equal(repos.jobs.listPending().length, 1);
  db.close();
});

test("analytics fanout holds without durable writes when the immutable experiment assignment is absent", () => {
  const { db, repos } = fixture();

  const result = enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "different-story",
      videoId: "different-video",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "youtube_analytics_experiment_assignment_required",
  ]);
  assert.equal(result.jobs.length, 0);
  assert.equal(repos.jobs.listPending().length, 0);
  assert.equal(result.side_effects.database_jobs_enqueued, false);
  db.close();
});

test("the durable analytics handler runs the real ingestion seam with only a mocked read-only YouTube boundary", async () => {
  const { db, repos } = fixture();
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "story-analytics-1",
      videoId: "youtube-video-analytics-1",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });
  const job = repos.jobs.listPending()[0];
  const requests = [];

  const result = await handlers.youtube_analytics_snapshot(job, {
    repos,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    assertLeaseHealthy() {},
    async queryYoutubeAnalyticsReports(request) {
      requests.push(request);
      if (request.dimensions === "video") {
        return {
          columnHeaders: [
            { name: "video" },
            { name: "views" },
            { name: "engagedViews" },
            { name: "averageViewDuration" },
            { name: "averageViewPercentage" },
          ],
          rows: [["youtube-video-analytics-1", 1200, 860, 24.5, 78.4]],
        };
      }
      return {
        columnHeaders: [],
        rows: [],
      };
    },
  });

  assert.equal(result.status, "collected");
  assert.equal(result.persisted, true);
  assert.equal(result.completeness_status, "COMPLETE");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.snapshot_window, "24h");
  assert.equal(result.no_external_posting, true);
  assert.equal(result.no_oauth_or_token_change, true);
  assert.equal(requests.length, 6);
  const snapshot = repos.youtubeAnalyticsExperimentSnapshots.getSnapshot({
    experimentId: "pulse-v1-controlled-12",
    channelId: "pulse-gaming",
    youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    videoId: "youtube-video-analytics-1",
    snapshotWindow: "24h",
  });
  assert.equal(snapshot.views, 1200);
  assert.equal(snapshot.engaged_views, 860);
  assert.equal(snapshot.average_percentage_viewed, 78.4);
  db.close();
});

test("a no-data summary returns the runner-recognised reporting-lag retry outcome before the attempt budget is exhausted", async () => {
  const { db, repos } = fixture();
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "story-analytics-1",
      videoId: "youtube-video-analytics-1",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });
  const pending = repos.jobs.listPending()[0];
  const job = {
    ...pending,
    attempt_count: 1,
    max_attempts: 4,
  };

  const result = await handlers.youtube_analytics_snapshot(job, {
    repos,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    assertLeaseHealthy() {},
    async queryYoutubeAnalyticsReports() {
      return {
        columnHeaders: [{ name: "video" }, { name: "views" }],
        rows: [],
      };
    },
  });

  assert.equal(result.status, "held");
  assert.equal(result.job_outcome, "RETRY");
  assert.equal(result.retryable, true);
  assert.equal(
    result.completeness_status,
    "PENDING_REPORTING_LAG",
  );
  assert.equal(result.retry_after_seconds, 3600);
  assert.deepEqual(result.blockers, [
    "youtube_analytics_summary_reporting_lag",
  ]);
  assert.equal(result.persisted, false);
  assert.deepEqual(result.completeness_audit, {
    schema_version:
      "pulse-youtube-analytics-snapshot-completeness-v1",
    status: "PENDING_REPORTING_LAG",
    terminal: false,
    complete: false,
    reason: "youtube_analytics_summary_reporting_lag",
    snapshot_window: "24h",
    attempt_count: 1,
    max_attempts: 4,
    retry_after_seconds: 3600,
    reporting_lag_buffer_seconds: 10800,
    source_request: {
      summary: {
        dimensions: "video",
        endDate: "2026-07-29",
        filters: "video==youtube-video-analytics-1",
        ids: "channel==UCvgNDjtTezrpxL8oUe6mYwA",
        metrics:
          "views,engagedViews,estimatedMinutesWatched," +
          "averageViewDuration,averageViewPercentage,likes," +
          "comments,shares,subscribersGained,subscribersLost",
        startDate: "2026-07-28",
      },
    },
    source_payload: {
      summary: {
        columnHeaders: [
          { name: "video" },
          { name: "views" },
        ],
        rows: [],
      },
    },
    warnings: [],
  });
  db.close();
});

test("an exhausted no-data attempt returns an explicit terminal-incomplete audit artifact", () => {
  const result =
    classifyYouTubeAnalyticsSnapshotCompleteness({
      ingestionResult: {
        status: "no_data",
        sourceRequest: {
          summary: {
            ids: "channel==UCvgNDjtTezrpxL8oUe6mYwA",
          },
        },
        sourcePayload: {
          summary: { columnHeaders: [], rows: [] },
        },
        warnings: [],
      },
      job: {
        attempt_count: 4,
        max_attempts: 4,
      },
      snapshotWindow: "24h",
    });

  assert.equal(result.status, "incomplete");
  assert.equal(result.job_outcome, "TERMINAL");
  assert.equal(result.retryable, false);
  assert.equal(
    result.completeness_status,
    "TERMINAL_INCOMPLETE",
  );
  assert.equal(
    Object.hasOwn(result, "retry_after_seconds"),
    false,
  );
  assert.deepEqual(result.blockers, [
    "youtube_analytics_summary_reporting_lag_exhausted",
  ]);
  assert.equal(
    result.completeness_audit.status,
    "TERMINAL_INCOMPLETE",
  );
  assert.equal(result.completeness_audit.terminal, true);
  assert.equal(result.completeness_audit.complete, false);
  assert.equal(result.completeness_audit.attempt_count, 4);
  assert.equal(result.completeness_audit.max_attempts, 4);
  assert.equal(
    result.completeness_audit.retry_after_seconds,
    null,
  );
  assert.equal(
    result.completeness_audit.reporting_lag_buffer_seconds,
    10800,
  );
  assert.deepEqual(
    result.completeness_audit.source_payload,
    {
      summary: { columnHeaders: [], rows: [] },
    },
  );
});

test("reporting-lag retries use deterministic bounded buffers for each snapshot window", () => {
  const expected = [
    {
      snapshotWindow: "24h",
      retryAfterSeconds: 3600,
      reportingLagBufferSeconds: 10800,
    },
    {
      snapshotWindow: "48h",
      retryAfterSeconds: 1800,
      reportingLagBufferSeconds: 5400,
    },
    {
      snapshotWindow: "7d",
      retryAfterSeconds: 900,
      reportingLagBufferSeconds: 2700,
    },
  ];

  for (const row of expected) {
    const result =
      classifyYouTubeAnalyticsSnapshotCompleteness({
        ingestionResult: {
          status: "no_data",
          sourceRequest: { summary: {} },
          sourcePayload: { summary: { rows: [] } },
          warnings: [],
        },
        job: {
          attempt_count: 1,
          max_attempts: 4,
        },
        snapshotWindow: row.snapshotWindow,
      });

    assert.equal(
      result.retry_after_seconds,
      row.retryAfterSeconds,
    );
    assert.equal(
      result.completeness_audit.retry_after_seconds,
      row.retryAfterSeconds,
    );
    assert.equal(
      result.completeness_audit
        .reporting_lag_buffer_seconds,
      row.reportingLagBufferSeconds,
    );
  }
});

test("the durable analytics handler propagates the runner lease AbortSignal through ingestion", async () => {
  const { db, repos } = fixture();
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "story-analytics-1",
      videoId: "youtube-video-analytics-1",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });
  const job = repos.jobs.listPending()[0];
  const controller = new AbortController();
  const leaseLost = Object.assign(new Error("job_lease_lost"), {
    code: "job_lease_lost",
  });
  let queryStartedResolve;
  const queryStarted = new Promise((resolve) => {
    queryStartedResolve = resolve;
  });

  const pending = handlers.youtube_analytics_snapshot(job, {
    repos,
    signal: controller.signal,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    assertLeaseHealthy() {},
    async queryYoutubeAnalyticsReports(request) {
      if (request.dimensions !== "video") {
        return { columnHeaders: [], rows: [] };
      }
      queryStartedResolve();
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              columnHeaders: [
                { name: "video" },
                { name: "views" },
              ],
              rows: [["youtube-video-analytics-1", 120]],
            }),
          40,
        );
      });
    },
  });
  await queryStarted;
  controller.abort(leaseLost);

  await assert.rejects(pending, (error) => {
    assert.equal(error, leaseLost);
    return true;
  });
  assert.equal(
    repos.youtubeAnalyticsExperimentSnapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      videoId: "youtube-video-analytics-1",
      snapshotWindow: "24h",
    }),
    null,
  );
  db.close();
});

test("the durable analytics handler persists a valid summary with non-fatal optional-breakdown warning evidence", async () => {
  const { db, repos } = fixture();
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
    jobs: repos.jobs,
    controlledExperiments: repos.controlledExperiments,
    publication: {
      confirmed: true,
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      storyId: "story-analytics-1",
      videoId: "youtube-video-analytics-1",
      publishedAt: "2026-07-28T19:00:05.000Z",
    },
  });
  const job = repos.jobs.listPending()[0];

  const result = await handlers.youtube_analytics_snapshot(job, {
    repos,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    assertLeaseHealthy() {},
    async queryYoutubeAnalyticsReports(request) {
      if (request.dimensions === "video") {
        return {
          columnHeaders: [
            { name: "video" },
            { name: "views" },
          ],
          rows: [["youtube-video-analytics-1", 120]],
        };
      }
      if (request.dimensions === "elapsedVideoTimeRatio") {
        throw Object.assign(new Error("backend unavailable"), {
          code: "backendError",
          retryable: true,
        });
      }
      return { columnHeaders: [], rows: [] };
    },
  });

  assert.equal(result.status, "collected");
  assert.equal(result.persisted, true);
  assert.equal(
    result.completeness_status,
    "COMPLETE_WITH_WARNINGS",
  );
  assert.deepEqual(result.warnings, [
    {
      code: "youtube_analytics_optional_breakdown_unavailable",
      breakdown: "retention",
      error_code: "backendError",
      retryable: true,
    },
  ]);
  const snapshot =
    repos.youtubeAnalyticsExperimentSnapshots.getSnapshot({
      experimentId: "pulse-v1-controlled-12",
      channelId: "pulse-gaming",
      youtubeChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      videoId: "youtube-video-analytics-1",
      snapshotWindow: "24h",
    });
  const sourcePayload = JSON.parse(
    snapshot.source_payload_json,
  );
  assert.deepEqual(
    sourcePayload.optional_breakdown_warnings,
    result.warnings,
  );
  assert.deepEqual(sourcePayload.retention, {
    status: "unavailable",
    error_code: "backendError",
    retryable: true,
  });
  db.close();
});

test("the live read-only query boundary surfaces missing analytics consent before any report request", async () => {
  let authClientLoads = 0;
  let analyticsClientLoads = 0;
  const queryReports = createLiveYouTubeAnalyticsQueryReports({
    async createAccountBoundSession() {
      return {
        getBindingProof() {
          return {
            analytics: {
              learning_ready: false,
              read_scope_present: false,
            },
          };
        },
      };
    },
    async getAuthenticatedClient() {
      authClientLoads += 1;
      return {};
    },
    youtubeAnalyticsFactory() {
      analyticsClientLoads += 1;
      return {
        reports: {
          async query() {
            throw new Error("report request must not run without consent");
          },
        },
      };
    },
  });

  await assert.rejects(
    queryReports({
      ids: "channel==UCvgNDjtTezrpxL8oUe6mYwA",
    }),
    (error) => {
      assert.equal(error.code, "youtube_analytics_oauth_scope_required");
      return true;
    },
  );
  assert.equal(authClientLoads, 0);
  assert.equal(analyticsClientLoads, 0);
});

test("the live read-only query boundary uses the exact account-bound OAuth session for Analytics", async () => {
  const boundAuth = { identity: "account-bound-oauth" };
  let standaloneAuthLoads = 0;
  let boundAnalyticsCreates = 0;
  const requests = [];
  const requestOptions = [];
  const controller = new AbortController();
  const queryReports = createLiveYouTubeAnalyticsQueryReports({
    async createAccountBoundSession() {
      return {
        getBindingProof() {
          return {
            analytics: {
              learning_ready: true,
              read_scope_present: true,
            },
          };
        },
        createYoutubeAnalyticsClient(factory) {
          boundAnalyticsCreates += 1;
          return factory({
            version: "v2",
            auth: boundAuth,
          });
        },
      };
    },
    async getAuthenticatedClient() {
      standaloneAuthLoads += 1;
      throw new Error(
        "a second OAuth client must never be loaded",
      );
    },
    youtubeAnalyticsFactory(input) {
      assert.equal(input.version, "v2");
      assert.equal(input.auth, boundAuth);
        return {
          reports: {
          async query(request, options) {
            requests.push(request);
            requestOptions.push(options);
            return { data: { rows: [] } };
          },
        },
      };
    },
  });

  const result = await queryReports(
    {
      ids: "channel==UCvgNDjtTezrpxL8oUe6mYwA",
    },
    { signal: controller.signal },
  );

  assert.deepEqual(result, { data: { rows: [] } });
  assert.equal(boundAnalyticsCreates, 1);
  assert.equal(standaloneAuthLoads, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(requestOptions, [
    { signal: controller.signal },
  ]);
});
