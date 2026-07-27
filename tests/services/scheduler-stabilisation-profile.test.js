"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  DEFAULT_SCHEDULES,
  LEGACY_SCHEDULER_PROFILE,
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");

function dailyUtcHour(schedule) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    schedule.cron_expr.split(/\s+/);
  assert.equal(minute, "0");
  assert.equal(dayOfMonth, "*");
  assert.equal(month, "*");
  assert.equal(dayOfWeek, "*");
  return Number(hour);
}

test("stabilisation profile exposes two spaced YouTube-only publish windows and no frozen automation", () => {
  const schedules = schedulesForProfile(STABILISATION_SCHEDULER_PROFILE);
  const publish = schedules.filter((schedule) => schedule.kind === "publish");
  assert.equal(publish.length, 2);
  assert.deepEqual(
    publish.map((schedule) => schedule.name),
    ["publish_morning", "publish_primary"],
  );

  const hours = publish.map(dailyUtcHour).sort((left, right) => left - right);
  const gaps = [hours[1] - hours[0], 24 - hours[1] + hours[0]];
  assert.ok(gaps.every((gap) => gap >= 4), `unsafe publish gaps: ${gaps}`);

  for (const schedule of publish) {
    assert.equal(schedule.payload?.target_platform, "youtube");
    assert.equal(
      schedule.payload?.scheduler_profile,
      STABILISATION_SCHEDULER_PROFILE,
    );
    assert.deepEqual(schedule.payload?.cadence_policy, {
      rolling_window_hours: 24,
      max_publish_windows: 2,
      minimum_gap_hours: 4,
      catch_up: false,
    });
  }

  assert.deepEqual(
    schedules
      .filter((schedule) => schedule.kind === "produce")
      .map((schedule) => schedule.name),
    ["produce_morning", "produce_primary"],
  );

  const frozenKinds = new Set([
    "tiktok_auth_check",
    "instagram_token_refresh",
    "instagram_pending_verify",
    "engage",
    "engage_first_hour",
    "roundup_weekly",
    "roundup_monthly_topics",
    "blog_rebuild",
  ]);
  assert.deepEqual(
    schedules.filter((schedule) => frozenKinds.has(schedule.kind)),
    [],
  );
});

test("legacy profile preserves the complete existing schedule contract", () => {
  const legacy = schedulesForProfile(LEGACY_SCHEDULER_PROFILE);
  assert.deepEqual(legacy, DEFAULT_SCHEDULES);
  assert.notEqual(legacy, DEFAULT_SCHEDULES);
});
