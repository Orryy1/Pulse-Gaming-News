"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  DEFAULT_SCHEDULES,
  LEGACY_SCHEDULER_PROFILE,
  MULTI_LANE_SCHEDULER_PROFILE,
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

test("governed multi-lane profile cannot race generic production or publishing", () => {
  const schedules = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const kinds = new Set(schedules.map((schedule) => schedule.kind));

  assert.equal(kinds.has("produce"), false);
  assert.equal(kinds.has("publish"), false);
  assert.equal(kinds.has("longform_evidence_refresh"), false);
  assert.equal(kinds.has("governed_multi_lane_plan"), true);
  assert.equal(
    kinds.has("governed_editorial_evidence_backfill"),
    true,
  );
  assert.equal(kinds.has("reconcile_editorial_inventory"), true);
  assert.equal(kinds.has("evergreen_candidate_builder"), true);
  assert.equal(kinds.has("plan_weekly_longform"), true);
  assert.ok(
    schedules
      .filter((schedule) =>
        [
          "governed_multi_lane_plan",
          "governed_editorial_evidence_backfill",
          "reconcile_editorial_inventory",
          "evergreen_candidate_builder",
          "plan_weekly_longform",
        ].includes(schedule.kind),
      )
      .every(
        (schedule) =>
          schedule.payload?.scheduler_profile ===
            MULTI_LANE_SCHEDULER_PROFILE &&
          schedule.payload?.governed_multi_lane === true &&
          schedule.payload?.live_publish_enabled === false &&
          schedule.payload?.human_admission_required === true,
      ),
  );
});

test("governed editorial evidence backfill continuously seeds current official supply without publish authority", () => {
  const governed = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const backfill = governed.find(
    (schedule) =>
      schedule.kind ===
      "governed_editorial_evidence_backfill",
  );

  assert.ok(backfill);
  assert.equal(
    backfill.name,
    "governed_editorial_evidence_backfill",
  );
  assert.equal(backfill.cron_expr, "5 */2 * * *");
  assert.equal(backfill.payload?.planning_only, true);
  assert.equal(backfill.payload?.publish_authority, false);
  assert.equal(backfill.payload?.live_publish_enabled, false);
  assert.equal(backfill.payload?.human_review_required, true);
});

test("governed multi-lane inventory reconciliation runs every thirty minutes without publish authority", () => {
  const governed = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const reconcile = governed.find(
    (schedule) =>
      schedule.kind === "reconcile_editorial_inventory",
  );

  assert.ok(reconcile);
  assert.equal(reconcile.name, "editorial_inventory_reconcile");
  assert.equal(reconcile.cron_expr, "*/30 * * * *");
  assert.equal(reconcile.payload?.planning_only, true);
  assert.equal(reconcile.payload?.live_publish_enabled, false);
  assert.equal(reconcile.payload?.human_admission_required, true);
  assert.equal(
    reconcile.payload?.scheduler_profile,
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  assert.equal(
    schedulesForProfile(STABILISATION_SCHEDULER_PROFILE).some(
      (schedule) =>
        schedule.kind === "reconcile_editorial_inventory",
    ),
    false,
  );
});
