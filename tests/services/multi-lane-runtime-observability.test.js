"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildAutonomousScheduleSummary,
  buildMultiLaneRuntimeObservability,
} = require("../../lib/services/multi-lane-runtime-observability");

test("runtime observability reports active isolated pool IDs and instance counts without worker identities", () => {
  const result = buildMultiLaneRuntimeObservability({
    bootstrapState: {
      workerId: "server-hostname-1234",
      runners: [
        {
          workerId: "server-hostname-1234-editorial_evidence_capture-1",
          kinds: ["governed_editorial_evidence_discovery"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-editorial_evidence_capture-2",
          kinds: ["governed_editorial_evidence_discovery"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-editorial_preparation-1",
          kinds: [
            "prepare_editorial_inventory",
            "reconcile_editorial_inventory",
          ],
          running: true,
        },
        {
          workerId: "server-hostname-1234-breaking_production-1",
          kinds: ["produce_breaking_short"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-breaking_production-2",
          kinds: ["produce_breaking_short"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-evergreen_production-1",
          kinds: ["produce_evergreen_short"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-longform_production-1",
          kinds: ["produce_weekly_longform"],
          running: true,
        },
        {
          workerId: "server-hostname-1234-longform_production-2",
          kinds: ["produce_weekly_longform"],
          running: false,
        },
      ],
      token: "must-not-leak",
    },
    env: {},
    schedulerActive: true,
    schedulerProfile: "stabilisation_30d",
    schedules: [],
  });

  assert.deepEqual(result.isolated_worker_pools, {
    default_enabled: true,
    active_runner_count: 7,
    active_pool_count: 5,
    compatibility_runner_count: 0,
    pools: [
      {
        pool_id: "editorial_evidence_capture",
        active_instances: 2,
      },
      { pool_id: "editorial_preparation", active_instances: 1 },
      { pool_id: "breaking_production", active_instances: 2 },
      { pool_id: "evergreen_production", active_instances: 1 },
      { pool_id: "longform_production", active_instances: 1 },
    ],
    running_worker_set_sha256: crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          [
            "server-hostname-1234-breaking_production-1",
            "server-hostname-1234-breaking_production-2",
            "server-hostname-1234-editorial_evidence_capture-1",
            "server-hostname-1234-editorial_evidence_capture-2",
            "server-hostname-1234-editorial_preparation-1",
            "server-hostname-1234-evergreen_production-1",
            "server-hostname-1234-longform_production-1",
          ].sort(),
        ),
      )
      .digest("hex"),
  });
  assert.doesNotMatch(JSON.stringify(result), /hostname|1234|must-not-leak/);
});

test("runtime observability reports the breaking watcher default and live scheduler state", () => {
  const result = buildMultiLaneRuntimeObservability({
    bootstrapState: {
      runners: [],
      breakingWatcherHandle: {
        active: true,
        emitter: { access_token: "must-not-leak" },
      },
      schedulerHandle: {
        active: true,
        owner: "host-and-pid-must-not-leak",
      },
    },
    env: {},
    schedulerActive: true,
    schedulerProfile: "stabilisation_30d",
    schedules: [{ name: "governed_multi_lane_plan" }],
  });

  assert.deepEqual(result.breaking_watcher, {
    default_enabled: true,
    active: true,
  });
  assert.deepEqual(result.scheduler, {
    active: true,
    state: "active",
    profile: "stabilisation_30d",
    configured_schedule_count: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /access_token|must-not-leak|host-and-pid/,
  );
});

test("runtime observability exposes only sanitised fail-closed ElevenLabs credit health", () => {
  const result = buildMultiLaneRuntimeObservability({
    bootstrapState: {
      runners: [],
      elevenLabsCreditMonitor: {
        status() {
          return {
            schema_version: "pulse-elevenlabs-credit-runtime-health-v1",
            active: true,
            verdict: "WARN",
            allow_paid_synthesis: true,
            included_credits_remaining: 397971,
            remaining_percent: 43.18,
            safe_spendable_credits: 213621,
            next_reset_at: "2026-08-03T23:30:31.000Z",
            last_attempt_at: "2026-07-28T09:00:00.000Z",
            last_success_at: "2026-07-28T09:00:00.000Z",
            next_refresh_at: "2026-07-28T13:00:00.000Z",
            refresh_interval_ms: 14400000,
            threshold_state_key: "sha256:1234567890abcdef",
            last_error_code: null,
            evidence: {
              json: "elevenlabs-credit-status.json",
              markdown: "elevenlabs-credit-status.md",
            },
            api_key: "must-not-leak",
            output_root: "C:\\private\\must-not-leak",
          };
        },
      },
    },
  });

  assert.deepEqual(result.elevenlabs_credit_monitor, {
    schema_version: "pulse-elevenlabs-credit-runtime-health-v1",
    active: true,
    verdict: "WARN",
    allow_paid_synthesis: true,
    included_credits_remaining: 397971,
    remaining_percent: 43.18,
    safe_spendable_credits: 213621,
    next_reset_at: "2026-08-03T23:30:31.000Z",
    last_attempt_at: "2026-07-28T09:00:00.000Z",
    last_success_at: "2026-07-28T09:00:00.000Z",
    next_refresh_at: "2026-07-28T13:00:00.000Z",
    refresh_interval_ms: 14400000,
    threshold_state_key: "sha256:1234567890abcdef",
    last_error_code: null,
    evidence: {
      json: "elevenlabs-credit-status.json",
      markdown: "elevenlabs-credit-status.md",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-leak|api.?key|output_root|C:\\private/i,
  );
});

test("runtime observability identifies the governed multi-lane scheduler profile exactly", () => {
  const result = buildMultiLaneRuntimeObservability({
    bootstrapState: {
      runners: [],
      breakingWatcherHandle: { active: true },
    },
    schedulerActive: true,
    schedulerProfile: "governed_multi_lane",
    schedules: [],
  });

  assert.equal(result.scheduler.profile, "governed_multi_lane");
  assert.equal(result.scheduler.active, true);
  assert.equal(result.breaking_watcher.active, true);
});

test("autonomous status describes governed multi-lane production without inventing publish windows", () => {
  const summary = buildAutonomousScheduleSummary({
    scheduler: { profile: "governed_multi_lane" },
  });

  assert.equal(summary.profile, "governed_multi_lane");
  assert.deepEqual(summary.lanes, [
    "breaking_short",
    "evergreen_short",
    "weekly_longform",
  ]);
  assert.deepEqual(summary.publish, []);
  assert.equal(summary.catchUp, true);
  assert.equal(summary.humanReviewRequired, true);
  assert.equal(summary.strategy, "governed_multi_lane_human_review");
});

test("autonomous status retains the guarded stabilisation cadence when that profile is active", () => {
  const summary = buildAutonomousScheduleSummary({
    scheduler: { profile: "stabilisation_30d" },
  });

  assert.equal(summary.profile, "stabilisation_30d");
  assert.equal(summary.publish.length, 2);
  assert.equal(summary.maximum, "2 YouTube Shorts per rolling 24 hours");
  assert.equal(summary.minimumGap, "4 hours");
  assert.equal(summary.strategy, "youtube_only_guarded");
});

test("runtime observability exposes a bounded schedule summary for each governed media lane", () => {
  const schedules = [
    {
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
      cron_expr: "*/15 * * * *",
      payload: { secret: "must-not-leak" },
      idempotencyTemplate: "must-not-leak",
    },
    {
      name: "evergreen_candidate_builder",
      kind: "evergreen_candidate_builder",
      cron_expr: "30 */6 * * *",
    },
    {
      name: "longform_evidence_refresh",
      kind: "longform_evidence_refresh",
      cron_expr: "15 5 * * *",
    },
    {
      name: "weekly_longform_planner",
      kind: "plan_weekly_longform",
      cron_expr: "0 7 * * 6",
    },
    {
      name: "db_backup_daily",
      kind: "db_backup",
      cron_expr: "0 4 * * *",
    },
  ];

  const result = buildMultiLaneRuntimeObservability({
    schedules,
    schedulerProfile: "stabilisation_30d",
  });

  assert.deepEqual(
    result.lane_schedule_summary.map((lane) => ({
      lane_id: lane.lane_id,
      schedule_count: lane.schedule_count,
      schedule_names: lane.schedules.map((schedule) => schedule.name),
    })),
    [
      {
        lane_id: "breaking_short",
        schedule_count: 1,
        schedule_names: ["governed_multi_lane_plan"],
      },
      {
        lane_id: "evergreen_short",
        schedule_count: 2,
        schedule_names: [
          "governed_multi_lane_plan",
          "evergreen_candidate_builder",
        ],
      },
      {
        lane_id: "weekly_longform",
        schedule_count: 2,
        schedule_names: ["governed_multi_lane_plan", "weekly_longform_planner"],
      },
    ],
  );
  assert.deepEqual(result.lane_schedule_summary[0].schedules[0], {
    name: "governed_multi_lane_plan",
    kind: "governed_multi_lane_plan",
    cron_expr: "*/15 * * * *",
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|idempotency|db_backup/);
});

test("server health and autonomous status expose the same read-only multi-lane runtime summary", () => {
  const serverPath = path.resolve(__dirname, "..", "..", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");
  const healthStart = source.indexOf('app.get("/api/health"');
  const healthEnd = source.indexOf("// Public, unauthenticated news feed");
  const autonomousStart = source.indexOf('app.get("/api/autonomous/status"');
  const autonomousEnd = source.indexOf("// --- Platform auth status ---");
  const helperStart = source.indexOf(
    "function currentMultiLaneRuntimeObservability()",
  );
  const helperEnd = source.indexOf("async function runHunter()", helperStart);

  assert.notEqual(healthStart, -1);
  assert.notEqual(autonomousStart, -1);
  assert.notEqual(helperStart, -1);

  const healthBlock = source.slice(healthStart, healthEnd);
  const autonomousBlock = source.slice(autonomousStart, autonomousEnd);
  const helperBlock = source.slice(helperStart, helperEnd);

  assert.match(
    healthBlock,
    /multiLaneRuntime:\s*currentMultiLaneRuntimeObservability\(\)/,
  );
  assert.match(
    autonomousBlock,
    /const multiLaneRuntime\s*=\s*currentMultiLaneRuntimeObservability\(\)/,
  );
  assert.match(autonomousBlock, /\bmultiLaneRuntime,\s/);
  assert.match(
    autonomousBlock,
    /buildAutonomousScheduleSummary\(multiLaneRuntime\)/,
  );
  assert.match(helperBlock, /buildMultiLaneRuntimeObservability/);
  assert.match(helperBlock, /schedulesForProfile/);
  assert.match(helperBlock, /bootstrap-queue/);
  assert.doesNotMatch(
    helperBlock,
    /API_TOKEN|ACCESS_TOKEN|DB_PATH|token[s]?\//i,
  );
});
