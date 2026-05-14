"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
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
  assert.match(server, /dispatchSource:\s*"api_autonomous_publish"/);
  assert.match(jobs, /dispatchSource:\s*"scheduler_job"/);
  assert.match(breaking, /dispatchSource:\s*"breaking_fast_lane"/);
});
