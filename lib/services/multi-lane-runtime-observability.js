"use strict";

const crypto = require("node:crypto");

const {
  POOLS,
  buildMultiLaneWorkerDefinitions,
} = require("./multi-lane-worker-topology");

const KNOWN_POOL_IDS = new Set(POOLS.map((pool) => pool.pool_id));
const EXPECTED_LANE_SCHEDULES = Object.freeze({
  breaking_short: Object.freeze([
    Object.freeze({
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
    }),
  ]),
  evergreen_short: Object.freeze([
    Object.freeze({
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
    }),
    Object.freeze({
      name: "evergreen_candidate_builder",
      kind: "evergreen_candidate_builder",
    }),
  ]),
  weekly_longform: Object.freeze([
    Object.freeze({
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
    }),
    Object.freeze({
      name: "weekly_longform_planner",
      kind: "plan_weekly_longform",
    }),
  ]),
});

function explicitPoolId(runner) {
  const candidate = runner?.poolId || runner?.options?.poolId || null;
  return KNOWN_POOL_IDS.has(candidate) ? candidate : null;
}

function inferredPoolId(runner) {
  const kinds = Array.isArray(runner?.kinds)
    ? runner.kinds
    : Array.isArray(runner?.options?.kinds)
      ? runner.options.kinds
      : null;
  if (!kinds?.length) return null;
  const handlers = Object.fromEntries(kinds.map((kind) => [kind, () => {}]));
  const definitions = buildMultiLaneWorkerDefinitions({ handlers, kinds });
  return definitions.length === 1 ? definitions[0].pool_id : null;
}

function buildRunningWorkerSetSha256(workerIds) {
  const ids = Array.isArray(workerIds)
    ? [
        ...new Set(workerIds.filter((id) => typeof id === "string" && id)),
      ].sort()
    : [];
  return crypto.createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}

function summariseWorkerPools(bootstrapState, env) {
  const configuredRunners = Array.isArray(bootstrapState?.runners)
    ? bootstrapState.runners
    : bootstrapState?.runner
      ? [bootstrapState.runner]
      : [];
  const runners = configuredRunners.filter(
    (runner) => runner?.running === true,
  );
  const counts = new Map();
  let compatibilityRunnerCount = 0;

  for (const runner of runners) {
    const poolId = explicitPoolId(runner) || inferredPoolId(runner);
    if (!poolId) {
      compatibilityRunnerCount += 1;
      continue;
    }
    counts.set(poolId, (counts.get(poolId) || 0) + 1);
  }

  const pools = POOLS.filter((pool) => counts.has(pool.pool_id)).map(
    (pool) => ({
      pool_id: pool.pool_id,
      active_instances: counts.get(pool.pool_id),
    }),
  );

  return {
    default_enabled: env?.PULSE_MULTI_LANE_WORKERS !== "false",
    active_runner_count: runners.length,
    active_pool_count: pools.length,
    compatibility_runner_count: compatibilityRunnerCount,
    pools,
    running_worker_set_sha256: buildRunningWorkerSetSha256(
      runners.map((runner) => runner.workerId),
    ),
  };
}

function safeCronExpression(value) {
  const cron = typeof value === "string" ? value.trim() : "";
  return cron.length > 0 && cron.length <= 64 && /^[0-9*/,\-\s]+$/.test(cron)
    ? cron
    : null;
}

function summariseLaneSchedules(schedules) {
  const byName = new Map(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => schedule && typeof schedule === "object")
      .map((schedule) => [schedule.name, schedule]),
  );

  return Object.entries(EXPECTED_LANE_SCHEDULES).map(
    ([laneId, expectedSchedules]) => {
      const laneSchedules = expectedSchedules.flatMap((expected) => {
        const schedule = byName.get(expected.name);
        if (!schedule || schedule.kind !== expected.kind) return [];
        const cronExpr = safeCronExpression(schedule.cron_expr);
        if (!cronExpr) return [];
        return [
          {
            name: expected.name,
            kind: expected.kind,
            cron_expr: cronExpr,
          },
        ];
      });
      return {
        lane_id: laneId,
        schedule_count: laneSchedules.length,
        schedules: laneSchedules,
      };
    },
  );
}

function safeIso(value) {
  const input = typeof value === "string" ? value.trim() : "";
  const parsed = Date.parse(input);
  return input && Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : null;
}

function safeFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function summariseElevenLabsCreditMonitor(bootstrapState) {
  const blocked = {
    schema_version: "pulse-elevenlabs-credit-runtime-health-v1",
    active: false,
    verdict: "BLOCKED",
    allow_paid_synthesis: false,
    included_credits_remaining: 0,
    remaining_percent: 0,
    safe_spendable_credits: 0,
    next_reset_at: null,
    last_attempt_at: null,
    last_success_at: null,
    next_refresh_at: null,
    refresh_interval_ms: 0,
    threshold_state_key: null,
    last_error_code: "elevenlabs_credit_monitor_not_active",
    evidence: {
      json: "elevenlabs-credit-status.json",
      markdown: "elevenlabs-credit-status.md",
    },
  };
  let status;
  try {
    status = bootstrapState?.elevenLabsCreditMonitor?.status?.();
  } catch {
    return blocked;
  }
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return blocked;
  }
  const verdict = ["GREEN", "WARN", "BLOCKED"].includes(status.verdict)
    ? status.verdict
    : "BLOCKED";
  const active = status.active === true;
  const thresholdStateKey = /^sha256:[a-f0-9]{16}$/i.test(
    String(status.threshold_state_key || ""),
  )
    ? String(status.threshold_state_key)
    : null;
  const lastErrorCode =
    status.last_error_code === null || status.last_error_code === undefined
      ? null
      : /^elevenlabs_[a-z0-9_]{1,120}$/.test(String(status.last_error_code))
        ? String(status.last_error_code)
        : "elevenlabs_credit_monitor_refresh_failed";

  return {
    schema_version: "pulse-elevenlabs-credit-runtime-health-v1",
    active,
    verdict,
    allow_paid_synthesis:
      active && verdict !== "BLOCKED" && status.allow_paid_synthesis === true,
    included_credits_remaining: safeFinite(status.included_credits_remaining),
    remaining_percent: safeFinite(status.remaining_percent),
    safe_spendable_credits: safeFinite(status.safe_spendable_credits),
    next_reset_at: safeIso(status.next_reset_at),
    last_attempt_at: safeIso(status.last_attempt_at),
    last_success_at: safeIso(status.last_success_at),
    next_refresh_at: safeIso(status.next_refresh_at),
    refresh_interval_ms: safeFinite(status.refresh_interval_ms),
    threshold_state_key: thresholdStateKey,
    last_error_code: lastErrorCode,
    evidence: {
      json: "elevenlabs-credit-status.json",
      markdown: "elevenlabs-credit-status.md",
    },
  };
}

function buildMultiLaneRuntimeObservability({
  bootstrapState = null,
  env = process.env,
  schedulerActive,
  schedulerProfile = null,
  schedules = [],
} = {}) {
  const active =
    typeof schedulerActive === "boolean"
      ? schedulerActive
      : bootstrapState?.schedulerHandle?.active === true;
  const safeProfile = new Set([
    "legacy",
    "stabilisation_30d",
    "governed_multi_lane",
  ]).has(schedulerProfile)
    ? schedulerProfile
    : null;
  return {
    isolated_worker_pools: summariseWorkerPools(bootstrapState, env),
    breaking_watcher: {
      default_enabled: env?.BREAKING_WATCHER_ENABLED !== "false",
      active: bootstrapState?.breakingWatcherHandle?.active === true,
    },
    scheduler: {
      active,
      state: active ? "active" : "inactive",
      profile: safeProfile,
      configured_schedule_count: Array.isArray(schedules)
        ? schedules.length
        : 0,
    },
    elevenlabs_credit_monitor: summariseElevenLabsCreditMonitor(bootstrapState),
    lane_schedule_summary: summariseLaneSchedules(schedules),
  };
}

function buildAutonomousScheduleSummary(runtime = {}) {
  const profile = runtime?.scheduler?.profile || null;
  if (profile === "governed_multi_lane") {
    return {
      profile,
      hunts: ["Continuous breaking watcher plus governed discovery windows"],
      lanes: ["breaking_short", "evergreen_short", "weekly_longform"],
      publish: [],
      maximum: "No autonomous external publish windows",
      minimumGap: null,
      catchUp: true,
      humanReviewRequired: true,
      strategy: "governed_multi_lane_human_review",
    };
  }
  if (profile === "stabilisation_30d") {
    return {
      profile,
      hunts: ["Five read-only discovery windows per day"],
      publish: [
        "09:00 UTC - guarded YouTube window",
        "19:00 UTC - guarded YouTube window",
      ],
      maximum: "2 YouTube Shorts per rolling 24 hours",
      minimumGap: "4 hours",
      catchUp: false,
      humanReviewRequired: true,
      strategy: "youtube_only_guarded",
    };
  }
  return {
    profile: null,
    hunts: [],
    publish: [],
    maximum: "No autonomous external publish windows",
    minimumGap: null,
    catchUp: false,
    humanReviewRequired: true,
    strategy: "unknown_profile_held",
  };
}

module.exports = {
  buildAutonomousScheduleSummary,
  buildMultiLaneRuntimeObservability,
  buildRunningWorkerSetSha256,
};
