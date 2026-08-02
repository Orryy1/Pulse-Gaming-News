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

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function positiveSafeInteger(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildRunningClaimSetSha256(claims) {
  if (!Array.isArray(claims)) return null;
  const canonical = [];
  for (const claim of claims) {
    const workerId = String(claim?.worker_id || "").trim();
    const kind = String(claim?.kind || "").trim();
    const jobId = positiveSafeInteger(claim?.job_id);
    const runId = positiveSafeInteger(claim?.run_id);
    const attempt = positiveSafeInteger(claim?.attempt);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(workerId) ||
      !/^[a-z][a-z0-9_]{0,127}$/.test(kind) ||
      jobId === null ||
      runId === null ||
      attempt === null
    ) {
      return null;
    }
    canonical.push({
      attempt,
      claim_token_sha256: crypto
        .createHash("sha256")
        .update(`job-claim-token:${runId}`)
        .digest("hex"),
      job_id: jobId,
      kind,
      run_id: runId,
      worker_id: workerId,
    });
  }
  canonical.sort(
    (left, right) =>
      left.worker_id.localeCompare(right.worker_id) ||
      left.job_id - right.job_id ||
      left.run_id - right.run_id,
  );
  return crypto
    .createHash("sha256")
    .update(stableJson(canonical))
    .digest("hex");
}

function normaliseRunnerKinds(runner) {
  const kinds = Array.isArray(runner?.kinds)
    ? runner.kinds
    : Array.isArray(runner?.options?.kinds)
      ? runner.options.kinds
      : null;
  if (
    !kinds?.length ||
    kinds.some(
      (kind) =>
        typeof kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(kind),
    )
  ) {
    return null;
  }
  const unique = [...new Set(kinds)].sort();
  return unique.length === kinds.length ? unique : null;
}

function normaliseRunnerHeartbeatMs(runner) {
  const value =
    runner?.heartbeatMs === undefined
      ? runner?.options?.heartbeatMs === undefined
        ? 30_000
        : Number(runner.options.heartbeatMs)
      : Number(runner.heartbeatMs);
  return Number.isInteger(value) && value >= 1000 && value <= 300_000
    ? value
    : null;
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
  const poolsById = new Map();
  let compatibilityRunnerCount = 0;
  const activeClaims = [];

  for (const runner of runners) {
    const poolId = explicitPoolId(runner) || inferredPoolId(runner);
    const kinds = normaliseRunnerKinds(runner);
    const heartbeatMs = normaliseRunnerHeartbeatMs(runner);
    if (!poolId || !kinds || heartbeatMs === null) {
      compatibilityRunnerCount += 1;
      continue;
    }
    const currentPool = poolsById.get(poolId);
    if (
      currentPool &&
      (currentPool.heartbeat_ms !== heartbeatMs ||
        stableJson(currentPool.kinds) !== stableJson(kinds))
    ) {
      compatibilityRunnerCount += 1;
      continue;
    }
    poolsById.set(poolId, {
      pool_id: poolId,
      active_instances: (currentPool?.active_instances || 0) + 1,
      heartbeat_ms: heartbeatMs,
      kinds,
    });
    if (runner.current !== null && runner.current !== undefined) {
      activeClaims.push({
        worker_id: runner.workerId,
        job_id: runner.current.id,
        kind: runner.current.kind,
        run_id: runner.current.claim_token,
        attempt: runner.current.attempt_count,
      });
    }
  }

  const pools = POOLS.flatMap((pool) => {
    const observed = poolsById.get(pool.pool_id);
    return observed ? [observed] : [];
  });
  const runningClaimSetSha256 = buildRunningClaimSetSha256(activeClaims);

  return {
    default_enabled: env?.PULSE_MULTI_LANE_WORKERS !== "false",
    active_runner_count: runners.length,
    active_pool_count: pools.length,
    compatibility_runner_count: compatibilityRunnerCount,
    pools,
    running_worker_set_sha256: buildRunningWorkerSetSha256(
      runners.map((runner) => runner.workerId),
    ),
    active_claim_count: activeClaims.length,
    running_claim_set_sha256: runningClaimSetSha256,
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
  buildRunningClaimSetSha256,
  buildRunningWorkerSetSha256,
};
