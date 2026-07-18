"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluatePublishWorkerQuietPeriod,
} = require("../../lib/ops/publish-worker-quiet-period");

test("content workers pause before and during every guarded publish window", () => {
  const report = evaluatePublishWorkerQuietPeriod({
    now: new Date("2026-07-17T08:50:00.000Z"),
    kinds: ["fresh_production_refill"],
  });

  assert.equal(report.allow_claim, false);
  assert.equal(report.window_hour_utc, 9);
  assert.equal(report.resume_at, "2026-07-17T09:20:00.000Z");
});

test("lightweight runway monitoring remains claimable during a guarded publish window", () => {
  const report = evaluatePublishWorkerQuietPeriod({
    now: new Date("2026-07-17T08:50:00.000Z"),
    kinds: ["candidate_supply_monitor"],
  });

  assert.equal(report.allow_claim, true);
  assert.equal(report.reason, "guarded_publish_window_safe_kinds");
  assert.equal(report.window_hour_utc, 9);
});

test("content workers may claim outside the guarded quiet period", () => {
  const report = evaluatePublishWorkerQuietPeriod({
    now: new Date("2026-07-17T07:00:00.000Z"),
    kinds: ["fresh_production_refill"],
  });

  assert.equal(report.allow_claim, true);
  assert.equal(report.window_hour_utc, null);
});

test("quiet period calculation covers a midnight publish window", () => {
  const report = evaluatePublishWorkerQuietPeriod({
    now: new Date("2026-07-18T00:01:00.000Z"),
    publishHoursUtc: [0],
    beforeMinutes: 15,
    afterMinutes: 20,
    kinds: ["fresh_production_refill"],
  });

  assert.equal(report.allow_claim, false);
  assert.equal(report.resume_at, "2026-07-18T00:20:00.000Z");
});
