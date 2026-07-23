"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildGrowthAutopilotPlan,
} = require("../../lib/ops/growth-autopilot");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");

function currentSnapshot(overrides = {}) {
  return {
    generated_at: "2026-07-23T20:00:00.000Z",
    channel_id: "pulse-gaming",
    channel: {
      subscribers: 23,
      views_28d: 8400,
      watch_hours_28d: 28.4,
      latest_post_at: "2026-07-19T10:00:00.000Z",
    },
    weekly_cohorts: [
      {
        week_start: "2026-07-06",
        posts: 7,
        views: 4467,
        median_views: 587,
        subscribers_gained: null,
      },
    ],
    pipeline: {
      scheduler_candidate_count: 0,
      publish_readiness: {
        verdict: "RED",
        blockers: ["runtime_commit_drift"],
      },
      control_tower: { verdict: "RED" },
      platforms: {
        youtube: { enabled: true },
        x: { enabled: false },
      },
    },
    ...overrides,
  };
}

function healthyCohorts() {
  return [
    { week_start: "2026-06-22", posts: 7, median_views: 510, subscribers_gained: 2 },
    { week_start: "2026-06-29", posts: 8, median_views: 560, subscribers_gained: 3 },
    { week_start: "2026-07-06", posts: 9, median_views: 620, subscribers_gained: 4 },
    { week_start: "2026-07-13", posts: 8, median_views: 680, subscribers_gained: 5 },
  ];
}

test("current outage enters governed cadence recovery", () => {
  const plan = buildGrowthAutopilotPlan(currentSnapshot());

  assert.equal(plan.growth_phase, "cadence_recovery");
  assert.equal(plan.execution_status, "blocked");
  assert.deepEqual(plan.cadence.target_weekly, [7, 10]);
  assert.equal(plan.cadence.recovery_floor_weekly, 3);
  assert.equal(plan.cadence.max_daily, 2);
  assert.equal(plan.cadence.min_gap_hours, 4);
  assert.equal(plan.next_action, "restore_scheduler_candidate");
  assert.equal(plan.work_orders[0].work_order_id, "restore_scheduler_candidate");

  const incidentCodes = plan.incidents.map((incident) => incident.code);
  assert.ok(incidentCodes.includes("post_gap_over_48h"));
  assert.ok(incidentCodes.includes("zero_scheduler_candidates"));
  assert.ok(incidentCodes.includes("strict_publish_readiness_red"));
  assert.ok(incidentCodes.includes("runtime_commit_drift"));
  assert.ok(incidentCodes.includes("subscriber_conversion_unobserved"));
  assert.ok(plan.experiments.every((experiment) => experiment.status !== "active"));
  assert.equal(plan.safety.no_publish_triggered, true);
  assert.equal(plan.safety.no_external_posting, true);
});

test("stable reach without subscriber evidence advances only to traction validation", () => {
  const cohorts = healthyCohorts().map((cohort) => ({
    ...cohort,
    subscribers_gained: null,
  }));
  const plan = buildGrowthAutopilotPlan(currentSnapshot({
    channel: {
      latest_post_at: "2026-07-23T10:00:00.000Z",
    },
    weekly_cohorts: cohorts,
    pipeline: {
      scheduler_candidate_count: 4,
      publish_readiness: { verdict: "GREEN", blockers: [] },
      control_tower: { verdict: "GREEN" },
      platforms: { youtube: { enabled: true }, x: { enabled: false } },
    },
  }));

  assert.equal(plan.growth_phase, "traction_validation");
  assert.equal(plan.execution_status, "review_required");
  assert.ok(
    plan.work_orders.some(
      (workOrder) => workOrder.work_order_id === "instrument_subscriber_conversion",
    ),
  );
  assert.equal(plan.scale_gates.positive_conversion_cohorts.passed, false);
});

test("scale requires stable cadence, positive conversion evidence and clean safety", () => {
  const plan = buildGrowthAutopilotPlan(currentSnapshot({
    channel: {
      latest_post_at: "2026-07-23T10:00:00.000Z",
    },
    weekly_cohorts: healthyCohorts(),
    pipeline: {
      scheduler_candidate_count: 6,
      publish_readiness: { verdict: "GREEN", blockers: [] },
      control_tower: { verdict: "GREEN" },
      platforms: { youtube: { enabled: true }, x: { enabled: false } },
    },
  }));

  assert.equal(plan.growth_phase, "scale");
  assert.equal(plan.execution_status, "eligible");
  assert.equal(plan.scale_gates.positive_conversion_cohorts.passed, true);

  const xWorkOrder = plan.work_orders.find(
    (workOrder) => workOrder.work_order_id === "x_distribution_pilot",
  );
  assert.equal(xWorkOrder.status, "blocked_platform_disabled");

  for (const workOrder of plan.work_orders) {
    assert.ok(["LOCAL_PROOF", "DRY_RUN_PUBLISH", "HUMAN_REVIEW"].includes(workOrder.operating_mode));
    assert.equal(workOrder.safety.no_publish_triggered, true);
    assert.equal(workOrder.safety.no_external_posting, true);
    assert.equal(workOrder.safety.no_db_mutation, true);
    assert.equal(workOrder.safety.no_oauth_or_token_change, true);
  }
});

test("a RED safety verdict blocks execution even when growth metrics are strong", () => {
  const plan = buildGrowthAutopilotPlan(currentSnapshot({
    channel: {
      latest_post_at: "2026-07-23T10:00:00.000Z",
    },
    weekly_cohorts: healthyCohorts(),
    pipeline: {
      scheduler_candidate_count: 6,
      publish_readiness: { verdict: "RED", blockers: ["rights_ledger_incomplete"] },
      control_tower: { verdict: "GREEN" },
      platforms: { youtube: { enabled: true }, x: { enabled: true } },
    },
  }));

  assert.equal(plan.execution_status, "blocked");
  assert.ok(plan.incidents.some((incident) => incident.code === "strict_publish_readiness_red"));
  assert.ok(plan.experiments.every((experiment) => experiment.status !== "active"));
});

test("scheduler runs a bounded growth autopilot heartbeat every 30 minutes", () => {
  const schedule = DEFAULT_SCHEDULES.find(
    (item) => item.name === "growth_autopilot_30m",
  );
  assert.equal(schedule.kind, "growth_autopilot");
  assert.equal(schedule.cron_expr, "10,40 * * * *");
  assert.equal(schedule.payload.execute_safe_followups, true);
  assert.equal(schedule.payload.no_publish, true);
  assert.equal(typeof handlers.growth_autopilot, "function");
});

test("growth handler enqueues only whitelisted evidence and recovery work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-growth-handler-"));
  const snapshotPath = path.join(root, "snapshot.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(snapshotPath, currentSnapshot());
  const enqueued = [];

  const result = await handlers.growth_autopilot(
    {
      payload: {
        snapshot_path: snapshotPath,
        out_dir: outDir,
        generated_at: "2026-07-23T20:00:00.000Z",
        execute_safe_followups: true,
      },
    },
    {
      log() {},
      repos: {
        jobs: {
          enqueue(job) {
            enqueued.push(job);
            return { id: enqueued.length, ...job };
          },
        },
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.no_publish, true);
  assert.deepEqual(
    enqueued.map((job) => job.kind),
    ["candidate_supply_monitor", "continuous_learning_loop"],
  );
  assert.ok(enqueued.every((job) => job.kind !== "publish"));
  assert.ok(enqueued.every((job) => job.payload.no_publish === true));
});
