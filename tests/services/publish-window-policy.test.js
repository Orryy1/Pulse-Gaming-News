"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPublishCooldownPolicy,
  buildPublishWindowPolicy,
  nearestPublishWindow,
} = require("../../lib/services/publish-window-policy");

test("nearestPublishWindow finds the closest canonical publish window", () => {
  const nearest = nearestPublishWindow({
    now: "2026-05-14T19:04:00.000Z",
    expectedHoursUtc: [9, 14, 19],
  });

  assert.equal(nearest.windowUtc, "19:00");
  assert.equal(nearest.minutesFromWindow, 4);
});

test("publish window policy marks scheduler dispatch inside window as green", () => {
  const policy = buildPublishWindowPolicy({
    now: "2026-05-14T19:04:00.000Z",
    dispatchSource: "scheduler_job",
    env: { PUBLISH_REQUIRE_WINDOW: "true" },
  });

  assert.equal(policy.verdict, "green");
  assert.equal(policy.blocked, false);
  assert.equal(policy.insideWindow, true);
  assert.equal(policy.dispatchSource, "scheduler_job");
});

test("publish window policy is warn-only for direct off-window routes by default", () => {
  const policy = buildPublishWindowPolicy({
    now: "2026-05-14T22:33:00.000Z",
    dispatchSource: "api_autonomous_publish",
    env: {},
  });

  assert.equal(policy.verdict, "amber");
  assert.equal(policy.blocked, false);
  assert.equal(policy.insideWindow, false);
  assert.match(policy.advisory.join("\n"), /outside the canonical publish windows/);
});

test("publish window policy can hard-block off-window direct routes behind explicit env", () => {
  const policy = buildPublishWindowPolicy({
    now: "2026-05-14T22:33:00.000Z",
    dispatchSource: "api_autonomous_publish",
    env: { PUBLISH_REQUIRE_WINDOW: "true" },
  });

  assert.equal(policy.verdict, "red");
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockers.includes("publish_window_blocked"));
});

test("publish cooldown policy is green when no recent public post exists", () => {
  const policy = buildPublishCooldownPolicy({
    now: "2026-05-14T19:00:00.000Z",
    stories: [
      {
        id: "old",
        title: "Old post",
        youtube_post_id: "yt_123",
        published_at: "2026-05-14T14:00:00.000Z",
      },
    ],
    minGapMinutes: 120,
    env: { PUBLISH_REQUIRE_MIN_GAP: "true" },
  });

  assert.equal(policy.verdict, "green");
  assert.equal(policy.blocked, false);
  assert.equal(policy.minutesSinceLastPost, 300);
});

test("publish cooldown policy is warn-only by default for recent public posts", () => {
  const policy = buildPublishCooldownPolicy({
    now: "2026-05-14T19:10:00.000Z",
    stories: [
      {
        id: "recent",
        title: "Recent public post",
        instagram_media_id: "ig_123",
        published_at: "2026-05-14T19:03:00.000Z",
      },
    ],
    minGapMinutes: 120,
    env: {},
  });

  assert.equal(policy.verdict, "amber");
  assert.equal(policy.blocked, false);
  assert.equal(policy.minutesSinceLastPost, 7);
  assert.match(policy.advisory.join("\n"), /posted 7 minutes ago/);
});

test("publish cooldown policy hard-blocks behind explicit env only", () => {
  const policy = buildPublishCooldownPolicy({
    now: "2026-05-14T19:10:00.000Z",
    stories: [
      {
        id: "recent",
        title: "Recent public post",
        youtube_post_id: "yt_123",
        published_at: "2026-05-14T19:03:00.000Z",
      },
    ],
    minGapMinutes: 120,
    env: { PUBLISH_REQUIRE_MIN_GAP: "true" },
  });

  assert.equal(policy.verdict, "red");
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockers.includes("publish_cooldown_blocked"));
});

test("publish cooldown ignores sentinel duplicate IDs and undated rows", () => {
  const policy = buildPublishCooldownPolicy({
    now: "2026-05-14T19:10:00.000Z",
    stories: [
      {
        id: "dupe",
        youtube_post_id: "DUPE_BLOCKED",
        published_at: "2026-05-14T19:03:00.000Z",
      },
      {
        id: "undated",
        youtube_post_id: "yt_undated",
      },
    ],
    minGapMinutes: 120,
    env: { PUBLISH_REQUIRE_MIN_GAP: "true" },
  });

  assert.equal(policy.verdict, "green");
  assert.equal(policy.blocked, false);
  assert.equal(policy.lastPublishedAt, null);
});

test("publisher direct routes pass dispatch provenance into publish calls", () => {
  const publisher = fs.readFileSync(
    path.join(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  const server = fs.readFileSync(
    path.join(__dirname, "..", "..", "server.js"),
    "utf8",
  );
  const jobs = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "job-handlers.js"),
    "utf8",
  );
  const breaking = fs.readFileSync(
    path.join(__dirname, "..", "..", "breaking_queue.js"),
    "utf8",
  );

  assert.match(publisher, /buildPublishWindowPolicy/);
  assert.match(publisher, /buildPublishCooldownPolicy/);
  assert.match(server, /dispatchSource:\s*"api_autonomous_publish"/);
  assert.match(jobs, /dispatchSource:\s*"scheduler_job"/);
  assert.match(breaking, /dispatchSource:\s*"breaking_fast_lane"/);
});
