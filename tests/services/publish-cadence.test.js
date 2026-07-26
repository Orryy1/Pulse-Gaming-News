"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_EXPECTED_HOURS_UTC,
  buildPublishCadenceReport,
  classifyPublishEvent,
  computeNextSafePublishWindow,
  formatPublishCadenceMarkdown,
} = require("../../lib/ops/publish-cadence");
const {
  STABILISATION_PROFILE,
} = require("../../lib/stabilisation/scheduler-profile");

test("default cadence policy uses exactly two guarded YouTube windows with a rolling cap of two", () => {
  assert.deepEqual(DEFAULT_EXPECTED_HOURS_UTC, [9, 19]);
  assert.deepEqual(STABILISATION_PROFILE.automated_platforms, ["youtube"]);
  assert.equal(STABILISATION_PROFILE.max_public_posts_rolling_24h, 2);

  const report = buildPublishCadenceReport({
    now: "2026-06-13T10:22:00.000Z",
    stories: [],
    jobs: [],
    platformPosts: [],
  });
  assert.deepEqual(report.thresholds.expected_hours_utc, [9, 19]);
  assert.equal(report.thresholds.max_recommended_posts_per_24h, 2);

  const next = computeNextSafePublishWindow({
    nowDate: "2026-06-13T10:22:00.000Z",
    publishEvents: [],
  });
  assert.equal(next.next_safe_publish_at_utc, "2026-06-13T19:00:00.000Z");
});

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

test("buildPublishCadenceReport: repaired script fallback rows stay in failed cleanup, not invalid public rows", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "repaired_script",
        title: "Already repaired script fallback",
        publish_status: "failed",
        qa_failed: true,
        published_at: "2026-05-14T23:10:00.000Z",
        youtube_post_id: "yt_repaired",
        publish_error: "script_validation_review_required_public_row_repair",
        body: "Script validation failed. Manual review required before production.",
      },
    ],
    jobs: [],
  });

  assert.equal(report.summary.published_count, 0);
  assert.equal(report.invalid_public_story_rows.length, 0);
  assert.equal(report.failed_rows_with_platform_ids.length, 0);
  assert.equal(report.summary.failed_rows_with_platform_ids_recent, 0);
  assert.equal(report.summary.repaired_failed_rows_with_platform_ids, 1);
  assert.equal(report.repaired_failed_rows_with_platform_ids.length, 1);
  assert.equal(report.verdict, "green");
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

test("buildPublishCadenceReport: local TTS repair failures on fully published rows do not become cadence advisories", () => {
  const report = buildPublishCadenceReport({
    now: "2026-06-29T15:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "published_then_tts_failed",
        title: "Sea Of Thieves Custom Seas Could Split Crews",
        publish_status: "failed",
        publish_error: "audio_generation_failed: server_down: local TTS server is not reachable",
        qa_failed: true,
        qa_failures: ["audio_generation_failed:server_down"],
        qa_failed_at: "2026-06-29T13:49:45.747Z",
        published_at: "2026-06-21T14:00:00.000Z",
        youtube_post_id: "yt_real",
        instagram_media_id: "ig_real",
        facebook_post_id: "fb_real",
      },
    ],
    jobs: [],
    env: {
      TIKTOK_ENABLED: "false",
      TIKTOK_AUTO_UPLOAD_ENABLED: "false",
    },
  });

  assert.equal(report.summary.failed_rows_with_platform_ids, 0);
  assert.equal(report.summary.failed_rows_with_platform_ids_recent, 0);
  assert.equal(report.summary.tts_repair_polluted_public_rows_with_platform_ids, 1);
  assert.equal(report.tts_repair_polluted_public_rows_with_platform_ids[0].id, "published_then_tts_failed");
  assert.equal(report.advisory.some((line) => /failed row\(s\).*platform IDs/i.test(line)), false);
});

test("buildPublishCadenceReport: DUPE sentinels do not count as real platform IDs", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "failed_dupe_only",
        title: "Legacy duplicate sentinel only",
        publish_status: "failed",
        updated_at: "2026-05-14T23:30:00.000Z",
        youtube_post_id: "DUPE_YOUTUBE",
        instagram_media_id: "DUPE_INSTAGRAM",
      },
      {
        id: "invalid_dupe_only",
        title: "Script fallback but no real public target",
        published_at: "2026-05-14T23:45:00.000Z",
        youtube_post_id: "DUPE_BLOCKED",
        body: "Script validation failed. Manual review required before production.",
      },
    ],
    jobs: [],
  });

  assert.equal(report.summary.published_count, 0);
  assert.equal(report.failed_rows_with_platform_ids.length, 0);
  assert.equal(report.invalid_public_story_rows.length, 0);
  assert.equal(report.verdict, "green");
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

test("buildPublishCadenceReport: counts published platform_posts when story timestamps are missing", () => {
  const report = buildPublishCadenceReport({
    now: "2026-05-15T00:00:00.000Z",
    windowHours: 24,
    stories: [
      {
        id: "story-without-stamp",
        title: "Posted but story row was not stamped",
      },
    ],
    platformPosts: [
      {
        id: 42,
        story_id: "story-without-stamp",
        title: "Posted but story row was not stamped",
        platform: "instagram_reel",
        status: "published",
        external_id: "ig_42",
        published_at: "2026-05-14T23:00:00.000Z",
      },
    ],
    jobs: [],
  });

  assert.equal(report.summary.published_count, 1);
  assert.equal(report.summary.platform_post_events, 1);
  assert.equal(report.publish_events[0].source, "platform_posts");
  assert.deepEqual(report.publish_events[0].platforms, ["instagram"]);
});

test("buildPublishCadenceReport: counts multi-platform rows for one story as one video publish", () => {
  const report = buildPublishCadenceReport({
    now: "2026-06-15T09:30:00.000Z",
    windowHours: 24,
    minRecommendedGapMinutes: 120,
    maxRecommendedPostsPer24h: 5,
    stories: [
      {
        id: "halo-remake",
        title: "Halo: Campaign Evolved Shows The Real Remake Test",
      },
    ],
    platformPosts: [
      {
        id: 8,
        story_id: "halo-remake",
        title: "Halo: Campaign Evolved Shows The Real Remake Test",
        platform: "youtube",
        status: "published",
        external_id: "yt_halo",
        published_at: "2026-06-14T21:47:11.000Z",
      },
      {
        id: 9,
        story_id: "halo-remake",
        title: "Halo: Campaign Evolved Shows The Real Remake Test",
        platform: "instagram_reel",
        status: "published",
        external_id: "ig_halo",
        published_at: "2026-06-14T21:48:49.000Z",
      },
      {
        id: 10,
        story_id: "halo-remake",
        title: "Halo: Campaign Evolved Shows The Real Remake Test",
        platform: "facebook_reel",
        status: "published",
        external_id: "fb_halo",
        published_at: "2026-06-14T21:50:15.000Z",
      },
    ],
    jobs: [
      { id: 41680, kind: "publish", run_at: "2026-06-14 19:00:00", status: "done" },
    ],
  });

  assert.equal(report.summary.published_count, 1);
  assert.equal(report.summary.platform_post_events, 1);
  assert.equal(report.summary.burst_pairs, 0);
  assert.equal(report.publish_events.length, 1);
  assert.deepEqual(report.publish_events[0].platforms, ["youtube", "instagram", "facebook"]);
  assert.deepEqual(report.publish_events[0].platform_post_ids, [8, 9, 10]);
  assert.equal(report.next_safe_publish.blockers.length, 0);
});

test("buildPublishCadenceReport: zero recent DB posts is telemetry-incomplete when platform IDs exist", () => {
  const report = buildPublishCadenceReport({
    now: "2026-06-08T09:00:00.000Z",
    windowHours: 48,
    stories: [
      {
        id: "old-public",
        title: "Historical public row",
        published_at: "2026-05-22T14:00:00.000Z",
        youtube_post_id: "yt_old",
      },
    ],
    jobs: [],
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.summary.published_count, 0);
  assert.equal(report.telemetry.story_rows_with_platform_ids, 1);
  assert.equal(report.telemetry.platform_truth_checked, false);
  assert.ok(report.telemetry.limitations.includes("external_platform_inventory_not_checked"));
  assert.match(report.advisory.join("\n"), /not proof that no platform posts happened/i);
  assert.match(formatPublishCadenceMarkdown(report), /Telemetry Scope/);
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

test("computeNextSafePublishWindow: omits cap blockers that already cleared", () => {
  const next = computeNextSafePublishWindow({
    nowDate: "2026-06-15T09:34:00.000Z",
    expectedHoursUtc: [9, 11, 14, 16, 19],
    minRecommendedGapMinutes: 120,
    maxRecommendedPostsPer24h: 5,
    publishEvents: [
      { id: "old_a", published_at: "2026-06-13T14:00:10.000Z" },
      { id: "old_b", published_at: "2026-06-13T16:00:00.000Z" },
      { id: "recent_a", published_at: "2026-06-14T16:00:07.000Z" },
      { id: "recent_b", published_at: "2026-06-14T21:47:11.000Z" },
      { id: "recent_c", published_at: "2026-06-14T23:07:06.000Z" },
    ],
  });

  assert.equal(next.next_safe_publish_at_utc, "2026-06-15T11:00:00.000Z");
  assert.deepEqual(next.blockers, []);
});

test("computeNextSafePublishWindow: keeps the next canonical window when the previous scheduled publish completed seconds late", () => {
  const next = computeNextSafePublishWindow({
    nowDate: "2026-06-29T15:10:00.000Z",
    expectedHoursUtc: [9, 11, 14, 16, 19],
    minRecommendedGapMinutes: 120,
    maxRecommendedPostsPer24h: 5,
    publishEvents: [
      {
        id: "invincible-vs",
        published_at: "2026-06-29T14:00:38.804Z",
        classification: "scheduled_window",
      },
    ],
  });

  assert.equal(next.earliest_possible_at_utc, "2026-06-29T16:00:00.000Z");
  assert.equal(next.next_safe_publish_at_utc, "2026-06-29T16:00:00.000Z");
  assert.deepEqual(next.blockers, []);
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
