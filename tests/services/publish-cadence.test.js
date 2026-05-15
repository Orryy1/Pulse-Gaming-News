"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPublishCadenceReport,
  classifyPublishEvent,
  computeNextSafePublishWindow,
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
        id: "invalid_public",
        title: "Invalid public row",
        published_at: "2026-05-14T23:15:00.000Z",
        youtube_post_id: "yt_invalid",
        body: "Script validation failed. Manual review required before production.",
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
  assert.equal(report.failed_rows_with_platform_ids.length, 2);
  assert.equal(report.summary.failed_rows_with_platform_ids_recent, 2);
  assert.equal(report.summary.failed_rows_with_platform_ids_historical, 0);
  assert.equal(report.invalid_public_story_rows.length, 1);
  assert.equal(report.next_safe_publish.next_safe_publish_at_utc, "2026-05-16T09:00:00.000Z");
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
  assert.match(report.advisory.join("\n"), /script-validation fallback/i);
});

test("buildPublishCadenceReport: review-blocked platform rows are not public cadence events", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "review_blocked",
        title: "Review blocked but has a public ID",
        publish_status: "partial",
        qa_status: "failed",
        published_at: "2026-05-14T23:00:00.000Z",
        youtube_post_id: "yt_partial",
      },
      {
        id: "script_blocked",
        title: "Script fallback but has a public ID",
        publish_status: "partial",
        published_at: "2026-05-14T23:10:00.000Z",
        youtube_post_id: "yt_script",
        body: "Script validation failed. Manual review required before production.",
      },
    ],
    jobs: [],
  });

  assert.equal(report.summary.published_count, 0);
  assert.equal(report.publish_events.length, 0);
  assert.equal(report.invalid_public_story_rows.length, 1);
  assert.equal(report.invalid_public_story_rows[0].id, "script_blocked");
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
  assert.equal(report.summary.failed_rows_with_platform_ids_recent, 1);
});

test("buildPublishCadenceReport: historical failed rows with platform IDs are cleanup notes, not cadence advisories", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "old_failed_partial",
        title: "Old failed row with partial platform state",
        publish_status: "failed",
        updated_at: "2026-05-10T23:30:00.000Z",
        instagram_media_id: "ig_partial",
      },
    ],
    jobs: [],
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.summary.published_count, 0);
  assert.equal(report.summary.failed_rows_with_platform_ids, 1);
  assert.equal(report.summary.failed_rows_with_platform_ids_recent, 0);
  assert.equal(report.summary.failed_rows_with_platform_ids_historical, 1);
  assert.deepEqual(report.advisory, []);
  assert.match(
    formatPublishCadenceMarkdown(report),
    /do not block current cadence/i,
  );
});

test("computeNextSafePublishWindow: waits until cap clears then picks next canonical window", () => {
  const next = computeNextSafePublishWindow({
    nowDate: "2026-05-15T00:53:00.000Z",
    expectedHoursUtc: [9, 14, 19],
    minRecommendedGapMinutes: 120,
    maxRecommendedPostsPer24h: 3,
    publishEvents: [
      { id: "a", published_at: "2026-05-14T01:08:00.000Z" },
      { id: "b", published_at: "2026-05-14T03:49:00.000Z" },
      { id: "c", published_at: "2026-05-14T07:04:00.000Z" },
      { id: "d", published_at: "2026-05-14T08:03:00.000Z" },
      { id: "e", published_at: "2026-05-14T19:03:00.000Z" },
    ],
  });

  assert.equal(next.earliest_possible_at_utc, "2026-05-15T07:05:00.000Z");
  assert.equal(next.next_safe_publish_at_utc, "2026-05-15T09:00:00.000Z");
  assert.equal(next.blockers[0].type, "post_cap");
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
      failed_rows_with_platform_ids_recent: 0,
      failed_rows_with_platform_ids_historical: 0,
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
    invalid_public_story_rows: [
      {
        id: "bad",
        title: "Script validation failed row",
        platforms: ["youtube"],
      },
    ],
    advisory: ["off-schedule public posts detected"],
    next_action: "Review direct publish paths.",
  });

  assert.match(md, /Publish Cadence/);
  assert.match(md, /AMBER/);
  assert.match(md, /Some Story/);
  assert.match(md, /Invalid Public Story Rows/);
  assert.match(md, /Script validation failed row/);
  assert.match(md, /Likely Direct Publish Routes/);
  assert.match(md, /Review direct publish paths/);
});
