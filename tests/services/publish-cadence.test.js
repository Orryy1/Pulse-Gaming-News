"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPublishCadenceReport,
  classifyPublishEvent,
  formatPublishCadenceMarkdown,
} = require("../../lib/ops/publish-cadence");

test("classifyPublishEvent: scheduled when close to a configured UTC window", () => {
  const event = classifyPublishEvent({
    story: {
      id: "story_1",
      title: "Scheduled post",
      published_at: "2026-05-14T19:04:00.000Z",
      youtube_post_id: "yt_1",
    },
    publishJobs: [
      { id: 1, kind: "publish", run_at: "2026-05-14 19:00:00", status: "done" },
    ],
    expectedHoursUtc: [9, 14, 19],
    toleranceMinutes: 20,
  });

  assert.equal(event.classification, "scheduled_window");
  assert.equal(event.nearest_window_utc, "19:00");
  assert.equal(event.minutes_from_window, 4);
});

test("classifyPublishEvent: off schedule when outside the expected windows", () => {
  const event = classifyPublishEvent({
    story: {
      id: "story_2",
      title: "Off-window post",
      published_at: "2026-05-14T22:33:00.000Z",
      youtube_post_id: "yt_2",
    },
    publishJobs: [],
    expectedHoursUtc: [9, 14, 19],
    toleranceMinutes: 20,
  });

  assert.equal(event.classification, "off_schedule_direct_or_fast_lane");
  assert.equal(event.nearest_window_utc, "19:00");
});

test("buildPublishCadenceReport: flags bursts, off-schedule posts and failed rows with platform IDs", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 30,
    expectedHoursUtc: [9, 14, 19],
    toleranceMinutes: 20,
    minRecommendedGapMinutes: 120,
    maxRecommendedPostsPer24h: 3,
    stories: [
      {
        id: "a",
        title: "First",
        published_at: "2026-05-14T22:00:00.000Z",
        youtube_post_id: "yt_a",
      },
      {
        id: "b",
        title: "Second",
        youtube_published_at: "2026-05-14T22:30:00.000Z",
        youtube_post_id: "yt_b",
      },
      {
        id: "c",
        title: "Third",
        published_at: "2026-05-14T23:00:00.000Z",
        instagram_media_id: "ig_c",
      },
      {
        id: "failed_has_ids",
        title: "Failed but uploaded somewhere",
        publish_status: "failed",
        updated_at: "2026-05-14T23:30:00.000Z",
        instagram_media_id: "ig_bad",
      },
    ],
    jobs: [
      { id: 10, kind: "publish", run_at: "2026-05-14 19:00:00", status: "done" },
    ],
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "true",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.summary.published_count, 3);
  assert.equal(report.summary.off_schedule_count, 3);
  assert.equal(report.summary.burst_pairs, 2);
  assert.equal(report.failed_rows_with_platform_ids.length, 1);
  assert.deepEqual(
    report.direct_publish_route_candidates.map((route) => route.id),
    [
      "breaking_fast_lane",
      "api_autonomous_publish",
      "api_autonomous_run",
      "cli_publish_or_full",
    ],
  );
  assert.match(report.advisory.join("\n"), /off-schedule/i);
  assert.match(report.advisory.join("\n"), /tight publish spacing/i);
});

test("buildPublishCadenceReport: failed rows with platform IDs are not counted as public cadence events", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "failed_only",
        title: "Failed but got a partial platform ID",
        publish_status: "failed",
        updated_at: "2026-05-14T23:30:00.000Z",
        instagram_media_id: "ig_partial",
      },
    ],
    jobs: [],
  });

  assert.equal(report.summary.published_count, 0);
  assert.equal(report.publish_events.length, 0);
  assert.equal(report.failed_rows_with_platform_ids.length, 1);
});

test("formatPublishCadenceMarkdown: renders operator-readable warnings", () => {
  const md = formatPublishCadenceMarkdown({
    verdict: "amber",
    generated_at: "2026-05-15T00:00:00.000Z",
    window_hours: 24,
    env: { AUTO_PUBLISH: "true", PULSE_PRIMARY_INSTANCE: "true" },
    summary: {
      published_count: 2,
      off_schedule_count: 1,
      scheduled_count: 1,
      burst_pairs: 1,
      min_gap_minutes: 31,
    },
    publish_events: [
      {
        id: "story",
        title: "Some Story",
        published_at: "2026-05-14T22:30:00.000Z",
        classification: "off_schedule_direct_or_fast_lane",
        platforms: ["youtube"],
      },
    ],
    failed_rows_with_platform_ids: [],
    advisory: ["off-schedule public posts detected"],
    next_action: "Review direct publish paths.",
  });

  assert.match(md, /Publish Cadence/);
  assert.match(md, /AMBER/);
  assert.match(md, /Some Story/);
  assert.match(md, /Likely Direct Publish Routes/);
  assert.match(md, /Review direct publish paths/);
});
