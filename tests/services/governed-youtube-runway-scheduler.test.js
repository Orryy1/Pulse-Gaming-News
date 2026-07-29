"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  MULTI_LANE_SCHEDULER_PROFILE,
  governedYoutubeRunwayScheduleContract,
  schedulesForProfile,
} = require("../../lib/scheduler");

test("governed profile enables exactly two T-90 locks and two T+15 verifications in UTC", () => {
  const schedules = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const runway = schedules.filter((schedule) =>
    [
      "governed_youtube_runway_t90",
      "governed_youtube_runway_tplus15",
    ].includes(schedule.kind),
  );

  assert.deepEqual(
    runway.map((schedule) => [
      schedule.name,
      schedule.kind,
      schedule.cron_expr,
      schedule.payload.publish_hour_utc,
    ]),
    [
      [
        "governed_youtube_runway_t90_morning",
        "governed_youtube_runway_t90",
        "30 7 * * *",
        9,
      ],
      [
        "governed_youtube_runway_t90_evening",
        "governed_youtube_runway_t90",
        "30 17 * * *",
        19,
      ],
      [
        "governed_youtube_runway_tplus15_morning",
        "governed_youtube_runway_tplus15",
        "15 9 * * *",
        9,
      ],
      [
        "governed_youtube_runway_tplus15_evening",
        "governed_youtube_runway_tplus15",
        "15 19 * * *",
        19,
      ],
    ],
  );
  assert.ok(
    runway.every(
      (schedule) =>
        schedule.payload.catch_up_allowed === false &&
        schedule.payload.publish_authority === false &&
        schedule.payload.external_posting === false &&
        schedule.payload.scheduler_profile ===
          MULTI_LANE_SCHEDULER_PROFILE,
    ),
  );
  const monitor = schedules.find(
    (schedule) =>
      schedule.name ===
      "governed_youtube_runway_slo_monitor",
  );
  assert.ok(monitor);
  assert.equal(
    monitor.kind,
    "governed_youtube_runway_slo_monitor",
  );
  assert.equal(monitor.cron_expr, "*/1 * * * *");
  assert.equal(monitor.payload.catch_up_allowed, false);
  assert.equal(monitor.payload.publish_authority, false);
  const inventoryMonitor = schedules.find(
    (schedule) =>
      schedule.name ===
      "governed_youtube_window_inventory_monitor",
  );
  assert.ok(inventoryMonitor);
  assert.equal(
    inventoryMonitor.kind,
    "governed_youtube_window_inventory_monitor",
  );
  assert.equal(inventoryMonitor.cron_expr, "*/5 * * * *");
  assert.equal(inventoryMonitor.payload.horizon_hours, 36);
  assert.equal(
    inventoryMonitor.payload.human_review_required,
    true,
  );
  assert.equal(
    inventoryMonitor.payload.publish_authority,
    false,
  );
  assert.equal(
    inventoryMonitor.payload.external_posting,
    false,
  );
  const dailyPrime = schedules.find(
    (schedule) =>
      schedule.name ===
      "governed_youtube_window_checkpoint_prime_daily",
  );
  assert.ok(dailyPrime);
  assert.equal(
    dailyPrime.kind,
    "prime_governed_youtube_window_checkpoints",
  );
  assert.equal(dailyPrime.cron_expr, "5 0 * * *");
  assert.equal(dailyPrime.payload.horizon_hours, 36);
  assert.equal(dailyPrime.payload.catch_up_allowed, false);
  assert.equal(dailyPrime.payload.publish_authority, false);
  assert.equal(dailyPrime.payload.external_posting, false);

  const contract = governedYoutubeRunwayScheduleContract(
    schedules,
  );
  assert.equal(contract.verdict, "GREEN");
  assert.equal(contract.schedule_count, 4);
  assert.deepEqual(contract.blockers, []);
  assert.equal(contract.utc_only, true);
  assert.equal(contract.catch_up_allowed, false);
  assert.equal(contract.publish_authority, false);
  assert.equal(contract.recovery_monitor_enabled, true);
  assert.equal(
    contract.candidate_inventory_monitor_enabled,
    true,
  );
  assert.equal(
    contract.daily_horizon_priming_enabled,
    true,
  );
});

test("governed profile plans both autonomous windows after inventory reconciliation and prepares both at T-94", () => {
  const schedules = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const autonomous = schedules.filter((schedule) =>
    [
      "plan_governed_autonomous_window_production",
      "prepare_governed_autonomous_pre_t90_window",
    ].includes(schedule.kind),
  );

  assert.deepEqual(
    autonomous.map((schedule) => [
      schedule.name,
      schedule.kind,
      schedule.cron_expr,
      schedule.payload.phase,
      schedule.payload.publish_hour_utc,
    ]),
    [
      [
        "plan_governed_autonomous_window_production_morning",
        "plan_governed_autonomous_window_production",
        "35 6 * * *",
        "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
        9,
      ],
      [
        "plan_governed_autonomous_window_production_evening",
        "plan_governed_autonomous_window_production",
        "35 16 * * *",
        "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
        19,
      ],
      [
        "prepare_governed_autonomous_pre_t90_window_morning",
        "prepare_governed_autonomous_pre_t90_window",
        "26 7 * * *",
        "T-94",
        9,
      ],
      [
        "prepare_governed_autonomous_pre_t90_window_evening",
        "prepare_governed_autonomous_pre_t90_window",
        "26 17 * * *",
        "T-94",
        19,
      ],
    ],
  );
  assert.ok(
    autonomous.every(
      (schedule) =>
        schedule.payload.scheduler_profile ===
          MULTI_LANE_SCHEDULER_PROFILE &&
        schedule.payload.catch_up_allowed === false &&
        schedule.payload.publish_authority === false &&
        schedule.payload.external_posting === false,
    ),
  );

  const contract = governedYoutubeRunwayScheduleContract(
    schedules,
  );
  assert.equal(contract.verdict, "GREEN");
  assert.equal(contract.schedule_count, 4);
  assert.equal(
    contract.autonomous_production_plan_schedule_count,
    2,
  );
  assert.equal(
    contract.autonomous_pre_t90_schedule_count,
    2,
  );
  assert.equal(
    contract.autonomous_production_planning_enabled,
    true,
  );
  assert.equal(
    contract.autonomous_pre_t90_preparation_enabled,
    true,
  );
});

test("runway schedule contract fails closed on a missing or drifted checkpoint", () => {
  const schedules = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  );
  const drifted = schedules
    .filter(
      (schedule) =>
        schedule.name !==
          "governed_youtube_runway_tplus15_evening" &&
        schedule.name !==
          "governed_youtube_window_checkpoint_prime_daily" &&
        schedule.name !==
          "governed_youtube_window_inventory_monitor" &&
        schedule.name !==
          "plan_governed_autonomous_window_production_evening",
    )
    .map((schedule) => {
      if (
        schedule.name ===
        "governed_youtube_runway_t90_morning"
      ) {
        return { ...schedule, cron_expr: "31 7 * * *" };
      }
      if (
        schedule.name ===
        "prepare_governed_autonomous_pre_t90_window_morning"
      ) {
        return { ...schedule, cron_expr: "27 7 * * *" };
      }
      return schedule;
    });
  const contract = governedYoutubeRunwayScheduleContract(
    drifted,
  );

  assert.equal(contract.verdict, "HOLD");
  assert.ok(
    contract.blockers.includes(
      "runway_schedule_missing:governed_youtube_runway_tplus15_evening",
    ),
  );
  assert.ok(
    contract.blockers.includes(
      "runway_schedule_drifted:governed_youtube_runway_t90_morning",
    ),
  );
  assert.ok(
    contract.blockers.includes(
      "runway_daily_horizon_priming_missing_or_drifted",
    ),
  );
  assert.ok(
    contract.blockers.includes(
      "runway_candidate_inventory_monitor_missing_or_drifted",
    ),
  );
  assert.ok(
    contract.blockers.includes(
      "autonomous_production_plan_schedule_missing:" +
        "plan_governed_autonomous_window_production_evening",
    ),
  );
  assert.ok(
    contract.blockers.includes(
      "autonomous_pre_t90_schedule_drifted:" +
        "prepare_governed_autonomous_pre_t90_window_morning",
    ),
  );
  assert.equal(
    contract.autonomous_production_planning_enabled,
    false,
  );
  assert.equal(
    contract.autonomous_pre_t90_preparation_enabled,
    false,
  );
  assert.equal(contract.catch_up_allowed, false);
  assert.equal(contract.publish_authority, false);
});
