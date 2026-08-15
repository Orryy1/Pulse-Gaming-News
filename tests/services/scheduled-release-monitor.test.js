"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildScheduledReleaseMonitorRun,
  classifyReleaseState,
} = require("../../lib/runtime/scheduled-release-monitor");

const PUBLISH_AT = "2026-08-15T17:00:00.000Z";

function spec() {
  return {
    story: "system-trace-frame-pacing",
    id: "video-1",
    title: "Why 60 FPS Can Still Stutter",
    description: "Exact description",
    tags: ["frame pacing", "Shorts"],
    publishAt: PUBLISH_AT,
  };
}

function remote(overrides = {}) {
  return {
    snippet: {
      title: "Why 60 FPS Can Still Stutter",
      description: "Exact description",
      tags: ["Shorts", "frame pacing"],
      categoryId: "20",
      defaultLanguage: "en-GB",
      defaultAudioLanguage: "en-GB",
    },
    status: {
      privacyStatus: "private",
      publishAt: PUBLISH_AT,
      uploadStatus: "processed",
    },
    processingDetails: { processingStatus: "succeeded" },
    contentDetails: { duration: "PT59S", caption: "false" },
    fileDetails: { fileSize: "12345" },
    statistics: { viewCount: "0", likeCount: "0", commentCount: "0" },
    ...overrides,
  };
}

function plan() {
  return { videos: [spec()] };
}

function run({ now, video = remote(), priorState = {} }) {
  return buildScheduledReleaseMonitorRun({
    plan: plan(),
    expectedByVideoId: { "video-1": { bytes: 12345, sha256: "a".repeat(64) } },
    remoteByVideoId: { "video-1": video },
    priorState,
    now,
  });
}

test("a fully reconciled private schedule is GREEN before release", () => {
  const result = run({ now: "2026-08-15T06:00:00.000Z" });
  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.summary.pre_release, 1);
  assert.equal(result.events.length, 0);
  assert.equal(result.nextState.kill_switch_engaged, false);
});

test("an early public release is RED and engages the kill switch", () => {
  const video = remote({
    status: { privacyStatus: "public", uploadStatus: "processed" },
  });
  const result = run({ now: "2026-08-15T16:00:00.000Z", video });
  assert.equal(result.report.verdict, "RED");
  assert.equal(result.report.engage_kill_switch, true);
  assert.equal(result.nextState.kill_switch_engaged, true);
  assert.ok(result.events.some((event) => event.code === "released_before_scheduled_window"));
});

test("a missed public transition is RED after the grace window", () => {
  const result = run({ now: "2026-08-15T17:11:00.000Z" });
  assert.equal(result.report.verdict, "RED");
  assert.equal(result.report.summary.missed, 1);
  assert.ok(result.events.some((event) => event.code === "not_public_after_release_grace"));
});

test("public observation queues one release event and one-hour statistics once", () => {
  const video = remote({
    status: { privacyStatus: "public", uploadStatus: "processed" },
    statistics: { viewCount: "900", likeCount: "42", commentCount: "3" },
  });
  const first = run({ now: "2026-08-15T18:05:00.000Z", video });
  assert.ok(first.events.some((event) => event.kind === "RELEASE_PUBLIC"));
  assert.ok(first.events.some((event) => event.milestone === "1h"));
  const second = run({
    now: "2026-08-15T18:10:00.000Z",
    video,
    priorState: first.nextState,
  });
  assert.equal(second.events.filter((event) => event.kind === "RELEASE_PUBLIC").length, 0);
  assert.equal(second.events.filter((event) => event.milestone === "1h").length, 0);
});

test("metadata drift is AMBER and engages future-mutation suspension", () => {
  const video = remote({
    snippet: {
      ...remote().snippet,
      title: "Unexpected title",
    },
  });
  const result = run({ now: "2026-08-15T07:00:00.000Z", video });
  assert.equal(result.report.verdict, "AMBER");
  assert.equal(result.report.engage_kill_switch, true);
  assert.ok(result.events.some((event) => event.code === "metadata_title_drift"));
});

test("a region restriction is preserved as a high-severity incident", () => {
  const video = remote({
    contentDetails: {
      duration: "PT59S",
      caption: "false",
      regionRestriction: { blocked: ["GB"] },
    },
  });
  const result = run({ now: "2026-08-15T07:00:00.000Z", video });
  assert.equal(result.report.verdict, "AMBER");
  assert.ok(result.events.some((event) => event.code === "region_restriction_detected"));
});

test("the daily digest is queued once after 08:00 London time", () => {
  const first = run({ now: "2026-08-15T07:05:00.000Z" });
  const digest = first.events.find((event) => event.kind === "DAILY_DIGEST");
  assert.ok(digest);
  const second = run({
    now: "2026-08-15T08:00:00.000Z",
    priorState: first.nextState,
  });
  assert.equal(second.events.filter((event) => event.kind === "DAILY_DIGEST").length, 0);
});

test("all due analytics milestones are captured without duplicate events", () => {
  const video = remote({
    status: { privacyStatus: "public", uploadStatus: "processed" },
    statistics: { viewCount: "4000", likeCount: "180", commentCount: "12" },
  });
  const result = run({ now: "2026-08-18T18:00:00.000Z", video });
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "ANALYTICS_MILESTONE")
      .map((event) => event.milestone)
      .sort(),
    ["1h", "24h", "72h"],
  );
  assert.equal(result.nextState.videos["video-1"].statistics.views, 4000);
});

test("transition grace accepts a still-private exact schedule without an incident", () => {
  const observation = classifyReleaseState({
    spec: spec(),
    expected: { bytes: 12345 },
    remote: remote(),
    now: new Date("2026-08-15T17:05:00.000Z"),
  });
  assert.equal(observation.phase, "TRANSITION_GRACE");
  assert.equal(observation.verdict, "GREEN");
  assert.equal(observation.incidents.length, 0);
});
