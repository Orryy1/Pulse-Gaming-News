"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  REQUIRED_READONLY_SCOPES,
  SUMMARY_METRICS,
  createYouTubeAnalyticsReadonlyAdapter,
} = require("../../lib/services/youtube-analytics-readonly-adapter");

test("read-only adapter declares only the scopes required to read YouTube analytics", () => {
  assert.deepEqual(REQUIRED_READONLY_SCOPES, [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);
  assert.equal(
    REQUIRED_READONLY_SCOPES.some((scope) =>
      /(upload|force-ssl|youtube$)/u.test(scope),
    ),
    false,
  );
});

test("read-only adapter queries explicit channel and video identity without inventing absent metrics", async () => {
  const requests = [];
  const sourcePayload = {
    columnHeaders: [
      { name: "video" },
      { name: "views" },
      { name: "engagedViews" },
      { name: "averageViewDuration" },
      { name: "averageViewPercentage" },
    ],
    rows: [["youtube-video-1", 120, 80, 31.5, 63.5]],
  };
  const adapter = createYouTubeAnalyticsReadonlyAdapter({
    queryReports: async (request) => {
      requests.push(request);
      return { data: sourcePayload };
    },
  });

  const result = await adapter.fetchVideoSnapshot({
    channelId: "UC_PULSE_GAMING",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    startDate: "2026-07-26",
    endDate: "2026-07-27",
  });

  assert.deepEqual(requests, [
    {
      dimensions: "video",
      endDate: "2026-07-27",
      filters: "video==youtube-video-1",
      ids: "channel==UC_PULSE_GAMING",
      metrics: [
        "views",
        "engagedViews",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "averageViewPercentage",
        "likes",
        "comments",
        "shares",
        "subscribersGained",
        "subscribersLost",
      ].join(","),
      startDate: "2026-07-26",
    },
  ]);
  assert.equal(result.status, "collected");
  assert.equal(result.channelId, "UC_PULSE_GAMING");
  assert.equal(result.videoId, "youtube-video-1");
  assert.deepEqual(result.metrics, {
    average_percentage_viewed: 63.5,
    average_view_duration_seconds: 31.5,
    engaged_views: 80,
    views: 120,
  });
  assert.equal(
    Object.hasOwn(result.metrics, "shown_in_feed"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.metrics, "stayed_to_watch_percent"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.metrics, "swiped_away_percent"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.metrics, "retention_1_second_percent"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.metrics, "retention_3_second_percent"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.metrics, "retention_10_second_percent"),
    false,
  );
  assert.deepEqual(result.sourcePayload, { summary: sourcePayload });
});

test("read-only adapter propagates the caller AbortSignal through the report boundary", async () => {
  const controller = new AbortController();
  const leaseLost = Object.assign(new Error("job_lease_lost"), {
    code: "job_lease_lost",
  });
  let observedSignal = null;
  const adapter = createYouTubeAnalyticsReadonlyAdapter({
    queryReports: async (_request, { signal } = {}) => {
      observedSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason),
          { once: true },
        );
      });
    },
  });

  const pending = adapter.fetchVideoSnapshot({
    channelId: "UC_PULSE_GAMING",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    startDate: "2026-07-26",
    endDate: "2026-07-27",
    signal: controller.signal,
  });
  await Promise.resolve();
  assert.ok(observedSignal);
  assert.equal(observedSignal.aborted, false);
  controller.abort(leaseLost);

  await assert.rejects(pending, (error) => {
    assert.equal(error, leaseLost);
    return true;
  });
  assert.equal(observedSignal.aborted, true);
});

test("read-only adapter aborts an unresponsive report request at the configured deadline", async () => {
  const adapter = createYouTubeAnalyticsReadonlyAdapter({
    requestTimeoutMs: 5,
    queryReports: async () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              columnHeaders: [
                { name: "video" },
                { name: "views" },
              ],
              rows: [["youtube-video-1", 120]],
            }),
          40,
        );
      }),
  });

  await assert.rejects(
    adapter.fetchVideoSnapshot({
      channelId: "UC_PULSE_GAMING",
      videoId: "youtube-video-1",
      snapshotWindow: "24h",
      startDate: "2026-07-26",
      endDate: "2026-07-27",
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_analytics_request_timeout",
      );
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("read-only adapter preserves observed retention and traffic-source evidence", async () => {
  const requests = [];
  const adapter = createYouTubeAnalyticsReadonlyAdapter({
    queryReports: async (request) => {
      requests.push(request);
      if (request.dimensions === "video") {
        return {
          data: {
            columnHeaders: [
              { name: "video" },
              { name: "views" },
              { name: "estimatedMinutesWatched" },
            ],
            rows: [["youtube-video-1", 120, 60]],
          },
        };
      }
      if (request.dimensions === "elapsedVideoTimeRatio") {
        return {
          data: {
            columnHeaders: [
              { name: "elapsedVideoTimeRatio" },
              { name: "audienceWatchRatio" },
              { name: "relativeRetentionPerformance" },
            ],
            rows: [
              [0, 1, 0.5],
              [0.25, 0.8, 0.4],
              [0.5, 0.6, 0.2],
              [0.75, 0.4, 0],
              [0.9, 0.25, -0.1],
              [1, 0.2, -0.2],
            ],
          },
        };
      }
      if (request.dimensions === "insightTrafficSourceType") {
        return {
          data: {
            columnHeaders: [
              { name: "insightTrafficSourceType" },
              { name: "views" },
              { name: "estimatedMinutesWatched" },
            ],
            rows: [
              ["SHORTS", 90, 45],
              ["YT_SEARCH", 30, 15],
            ],
          },
        };
      }
      if (request.dimensions === "country") {
        return {
          data: {
            columnHeaders: [
              { name: "country" },
              { name: "engagedViews" },
              { name: "views" },
              { name: "estimatedMinutesWatched" },
            ],
            rows: [
              ["GB", 50, 70, 35],
              ["US", 20, 30, 15],
            ],
          },
        };
      }
      if (request.dimensions === "ageGroup") {
        return {
          data: {
            columnHeaders: [
              { name: "ageGroup" },
              { name: "viewerPercentage" },
            ],
            rows: [
              ["age25-34", 62.5],
              ["age35-44", 37.5],
            ],
          },
        };
      }
      if (request.dimensions === "deviceType") {
        return {
          data: {
            columnHeaders: [
              { name: "deviceType" },
              { name: "engagedViews" },
              { name: "views" },
              { name: "estimatedMinutesWatched" },
            ],
            rows: [
              ["MOBILE", 60, 90, 45],
              ["TV", 10, 20, 10],
            ],
          },
        };
      }
      throw new Error("unexpected query");
    },
  });

  const result = await adapter.fetchVideoSnapshot({
    channelId: "UC_PULSE_GAMING",
    videoId: "youtube-video-1",
    snapshotWindow: "48h",
    startDate: "2026-07-25",
    endDate: "2026-07-27",
    includeBreakdowns: true,
  });

  assert.deepEqual(
    requests.map((request) => [
      request.dimensions,
      request.metrics,
      request.ids,
      request.filters,
    ]),
    [
      [
        "video",
        SUMMARY_METRICS.join(","),
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
      [
        "elapsedVideoTimeRatio",
        "audienceWatchRatio,relativeRetentionPerformance",
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
      [
        "insightTrafficSourceType",
        "views,estimatedMinutesWatched",
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
      [
        "country",
        "engagedViews,views,estimatedMinutesWatched",
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
      [
        "ageGroup",
        "viewerPercentage",
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
      [
        "deviceType",
        "engagedViews,views,estimatedMinutesWatched",
        "channel==UC_PULSE_GAMING",
        "video==youtube-video-1",
      ],
    ],
  );
  assert.deepEqual(result.metrics, {
    completion_percent: 20,
    retention_25_percent: 80,
    retention_50_percent: 60,
    retention_75_percent: 40,
    retention_90_percent: 25,
    views: 120,
    watch_hours: 1,
  });
  assert.equal(
    Object.hasOwn(result.metrics, "retention_3_second_percent"),
    false,
  );
  assert.deepEqual(result.breakdowns.traffic_sources, [
    { source: "SHORTS", views: 90, watch_minutes: 45 },
    { source: "YT_SEARCH", views: 30, watch_minutes: 15 },
  ]);
  assert.deepEqual(result.breakdowns.retention_curve[1], {
    elapsed_video_time_ratio: 0.25,
    audience_watch_ratio: 0.8,
    relative_retention_performance: 0.4,
  });
  assert.deepEqual(result.breakdowns.country, [
    {
      country: "GB",
      engaged_views: 50,
      views: 70,
      watch_minutes: 35,
    },
    {
      country: "US",
      engaged_views: 20,
      views: 30,
      watch_minutes: 15,
    },
  ]);
  assert.deepEqual(result.breakdowns.age, [
    { age_group: "age25-34", viewer_percentage: 62.5 },
    { age_group: "age35-44", viewer_percentage: 37.5 },
  ]);
  assert.deepEqual(result.breakdowns.device, [
    {
      device_type: "MOBILE",
      engaged_views: 60,
      views: 90,
      watch_minutes: 45,
    },
    {
      device_type: "TV",
      engaged_views: 10,
      views: 20,
      watch_minutes: 10,
    },
  ]);
});

test("a failed optional breakdown preserves warning evidence without discarding a valid summary", async () => {
  const requests = [];
  const adapter = createYouTubeAnalyticsReadonlyAdapter({
    queryReports: async (request) => {
      requests.push(request);
      if (request.dimensions === "video") {
        return {
          columnHeaders: [
            { name: "video" },
            { name: "views" },
          ],
          rows: [["youtube-video-1", 120]],
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

  const result = await adapter.fetchVideoSnapshot({
    channelId: "UC_PULSE_GAMING",
    videoId: "youtube-video-1",
    snapshotWindow: "24h",
    startDate: "2026-07-26",
    endDate: "2026-07-27",
    includeBreakdowns: true,
  });

  assert.equal(result.status, "collected");
  assert.deepEqual(result.metrics, { views: 120 });
  assert.equal(requests.length, 6);
  assert.deepEqual(result.warnings, [
    {
      code: "youtube_analytics_optional_breakdown_unavailable",
      breakdown: "retention",
      error_code: "backendError",
      retryable: true,
    },
  ]);
  assert.deepEqual(result.sourcePayload.retention, {
    status: "unavailable",
    error_code: "backendError",
    retryable: true,
  });
  assert.deepEqual(
    result.sourcePayload.optional_breakdown_warnings,
    result.warnings,
  );
  assert.equal(
    result.sourceRequest.retention.dimensions,
    "elapsedVideoTimeRatio",
  );
  assert.deepEqual(result.breakdowns.traffic_sources, []);
  assert.deepEqual(result.breakdowns.country, []);
  assert.deepEqual(result.breakdowns.age, []);
  assert.deepEqual(result.breakdowns.device, []);
  assert.equal(
    Object.hasOwn(result.breakdowns, "retention_curve"),
    false,
  );
});
