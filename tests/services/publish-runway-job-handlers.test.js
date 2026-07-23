"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function cacheEntry(id, exports) {
  return {
    id,
    filename: id,
    loaded: true,
    exports,
  };
}

function sqliteUtcMs(value) {
  return new Date(`${String(value).replace(" ", "T")}Z`).getTime();
}

async function withHandlerStubs(stubs, run) {
  const handlersPath = require.resolve("../../lib/job-handlers");
  const runtimePath = require.resolve("../../lib/ops/publish-runway-job-runtime");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const ids = [handlersPath, runtimePath, watchdogPath, executorPath, dbPath, notifyPath];
  const originals = new Map(ids.map((id) => [id, require.cache[id]]));
  try {
    require.cache[runtimePath] = cacheEntry(runtimePath, stubs.runtime || {});
    require.cache[watchdogPath] = cacheEntry(watchdogPath, stubs.watchdog || {});
    require.cache[executorPath] = cacheEntry(executorPath, stubs.executor || {});
    require.cache[dbPath] = cacheEntry(dbPath, stubs.db || {
      async getStories() {
        return [];
      },
    });
    require.cache[notifyPath] = cacheEntry(notifyPath, async () => {});
    delete require.cache[handlersPath];
    return await run(require("../../lib/job-handlers"));
  } finally {
    for (const [id, original] of originals) {
      if (original) require.cache[id] = original;
      else delete require.cache[id];
    }
  }
}

test("T-180 scheduler handler creates one immutable runway generation", async () => {
  let received = null;
  await withHandlerStubs({
    runtime: {
      async generateRunwayForJob(options) {
        received = options;
        return {
          verdict: "GREEN",
          phase: "T-180",
          generation: { generation_id: "runway-1" },
          selected_action_ids: ["story-1:youtube_shorts"],
          reserve_story_ids: ["story-6"],
        };
      },
    },
  }, async ({ handlers }) => {
    const job = {
      id: 10,
      payload: {
        phase: "T-180",
        window_label: "publish_morning",
        publish_hour_utc: 9,
      },
    };
    const result = await handlers.publish_runway_generate(job, { log() {} });
    assert.equal(received.job, job);
    assert.equal(result.status, "green");
    assert.equal(result.generation_id, "runway-1");
  });
});

test("T-180 strict runway deficit starts one window-scoped candidate recovery and still fails closed", async () => {
  const enqueued = [];
  const deficit = new Error(
    "RUNWAY_RECONCILIATION_NOT_STRICT_GREEN: immutable generation requires strict GREEN reconciliation",
  );
  deficit.code = "RUNWAY_RECONCILIATION_NOT_STRICT_GREEN";
  deficit.reconciliation = {
    generated_at: "2026-07-17T06:00:00.000Z",
    window: { id: "publish-20260717T090000Z" },
    summary: {
      runway_shortfall: 2,
      reserve_shortfall: 3,
    },
    exact_next_action: {
      code: "SYNCHRONOUSLY_REPAIR_OR_PROMOTE_RUNWAY",
      required_story_count: 2,
    },
  };

  await withHandlerStubs({
    runtime: {
      async generateRunwayForJob() {
        throw deficit;
      },
    },
  }, async ({ handlers }) => {
    await assert.rejects(
      () =>
        handlers.publish_runway_generate(
          {
            id: 11,
            channel_id: "pulse-gaming",
            payload: {
              phase: "T-180",
              window_label: "publish_morning",
              publish_hour_utc: 9,
            },
          },
          {
            log() {},
            repos: {
              jobs: {
                enqueue(row) {
                  enqueued.push(row);
                  return { id: 701, status: "pending", ...row };
                },
              },
            },
          },
        ),
      (error) => error === deficit,
    );
  });

  const recoveries = enqueued.filter(
    (row) => row.kind === "candidate_supply_monitor",
  );
  assert.equal(recoveries.length, 1);
  assert.equal(
    recoveries[0].payload.source_window_id,
    "publish-20260717T090000Z",
  );
  assert.equal(
    recoveries[0].payload.reason,
    "publish_runway_strict_deficit_recovery",
  );
  assert.equal(
    recoveries[0].idempotency_key,
    "publish_window_candidate_recovery:publish-20260717T090000Z",
  );
  const verifications = enqueued.filter(
    (row) => row.kind === "publish_runway_generate",
  );
  assert.equal(verifications.length, 1);
  assert.ok(
    sqliteUtcMs(verifications[0].run_at) >
      new Date(
        recoveries[0].payload.expected_production_completion_at,
      ).getTime(),
  );
  assert.equal(
    verifications[0].payload.candidate_recovery_job_id,
    701,
  );
  assert.equal(
    verifications[0].payload.enqueue_candidate_refill_on_runway,
    false,
  );
  assert.match(
    verifications[0].idempotency_key,
    /publish-20260717T090000Z.*701/,
  );
});

test("publish recovery monitor supersedes an older queued occurrence before expensive recovery", async () => {
  const calls = [];
  const { handlePublishScheduleRecoveryMonitor } = require("../../lib/job-handlers");
  const result = await handlePublishScheduleRecoveryMonitor(
    { id: 99, kind: "publish_schedule_recovery_monitor", payload: { phase: "RECOVERY_MONITOR" } },
    {
      repos: {
        jobs: {
          findNewerActiveByKind(kind, jobId) {
            assert.equal(kind, "publish_schedule_recovery_monitor");
            assert.equal(jobId, 99);
            return { id: 101, kind, status: "pending" };
          },
        },
        db: {},
      },
      publishSchedules: [],
      log() {},
      async reconcileCriticalPublishSchedules() {
        calls.push("prep");
      },
      async recoverMissedPublishWindows() {
        calls.push("t0");
      },
    },
  );

  assert.deepEqual(calls, []);
  assert.equal(result.status, "superseded");
  assert.equal(result.superseded_by_job_id, 101);
  assert.equal(result.external_publish_attempted, false);
});

test("publish recovery monitor restores prep debt and invokes only guarded T0 recovery", async () => {
  const calls = [];
  const { handlePublishScheduleRecoveryMonitor } = require("../../lib/job-handlers");
  const result = await handlePublishScheduleRecoveryMonitor(
    { id: 99, payload: { phase: "RECOVERY_MONITOR" } },
    {
      repos: { jobs: {}, db: {} },
      publishSchedules: [],
      log() {},
      async reconcileCriticalPublishSchedules(options) {
        calls.push(["prep", options]);
        return { verdict: "amber", enqueued_count: 2, enqueued_jobs: [{ job_id: 1 }, { job_id: 2 }] };
      },
      async recoverMissedPublishWindows(options) {
        calls.push(["t0", options]);
        return { verdict: "green", missed_window_count: 1, enqueued: true, queued_job_id: 3 };
      },
    },
  );

  assert.deepEqual(calls.map(([kind]) => kind), ["prep", "t0"]);
  assert.equal(calls[1][1].notify, false);
  assert.equal(result.status, "recovered");
  assert.equal(result.prep_jobs_enqueued, 2);
  assert.equal(result.guarded_publish_recovery_enqueued, true);
  assert.equal(result.live_publish_bypass_used, false);
});

test("T-90 watchdog locks the exact immutable generation only after a safe watchdog verdict", async () => {
  let locked = false;
  await withHandlerStubs({
    runtime: {
      async lockRunwayForJob() {
        locked = true;
        return {
          verdict: "GREEN",
          phase: "T-90",
          generation: { generation_id: "runway-1" },
          lock: { window_id: "window-1" },
          selected_action_ids: ["story-1:youtube_shorts"],
        };
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          verdict: "green",
          safe_to_publish_window: true,
          blockers: [],
        };
      },
      watchdogNeedsRunwayRepair() {
        return false;
      },
    },
  }, async ({ handlers }) => {
    const result = await handlers.publish_window_watchdog({
      payload: {
        phase: "T-90",
        window_label: "publish_morning",
        publish_hour_utc: 9,
      },
    }, { log() {} });
    assert.equal(locked, true);
    assert.equal(result.runway_lock_status, "green");
    assert.equal(result.runway_generation_id, "runway-1");
  });
});

test("T-90 watchdog fails closed without a lock when the watchdog is unsafe", async () => {
  await withHandlerStubs({
    runtime: {
      async lockRunwayForJob() {
        throw new Error("must not lock an unsafe window");
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          verdict: "red",
          safe_to_publish_window: false,
          blockers: ["strict_green_runway_missing"],
        };
      },
      watchdogNeedsRunwayRepair() {
        return false;
      },
    },
  }, async ({ handlers }) => {
    await assert.rejects(
      () =>
        handlers.publish_window_watchdog(
          {
            payload: {
              phase: "T-90",
              window_label: "publish_morning",
              publish_hour_utc: 9,
            },
          },
          { log() {} },
        ),
      /PUBLISH_RUNWAY_LOCK_REQUIRED/,
    );
  });
});

test("a recovered T-90 watchdog fails the queue job until a real lock exists", async () => {
  await withHandlerStubs({
    runtime: {
      async lockRunwayForJob() {
        return {
          verdict: "RED",
          phase: "T-90",
          reason_codes: ["NO_VALID_GENERATION_FOR_WINDOW"],
        };
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          verdict: "green",
          safe_to_publish_window: true,
          blockers: [],
        };
      },
      watchdogNeedsRunwayRepair() {
        return false;
      },
    },
  }, async ({ handlers }) => {
    await assert.rejects(
      () => handlers.publish_window_watchdog({
        payload: {
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          require_runway_lock: true,
        },
      }, { log() {} }),
      /PUBLISH_RUNWAY_LOCK_REQUIRED/,
    );
  });
});

test("T-90 watchdog does not report a terminal idempotent candidate recovery as active", async () => {
  const enqueued = [];
  await withHandlerStubs({
    runtime: {
      async lockRunwayForJob() {
        return {
          verdict: "GREEN",
          phase: "T-90",
          generation: { generation_id: "runway-1" },
          lock: { window_id: "publish-20260717T090000Z" },
          selected_action_ids: ["story-1:youtube_shorts"],
        };
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          generated_at: "2026-07-17T07:30:00.000Z",
          window_label: "publish_morning",
          verdict: "amber",
          safe_to_publish_window: true,
          blockers: [],
          action_runway: {
            status: "covered_no_reserve",
            reserve_actions: 0,
          },
        };
      },
      watchdogNeedsRunwayRepair() {
        return true;
      },
    },
  }, async ({ handlers }) => {
    const result = await handlers.publish_window_watchdog(
      {
        id: 14,
        channel_id: "pulse-gaming",
        payload: {
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          enqueue_repair_on_runway: false,
          enqueue_candidate_refill_on_runway: true,
        },
      },
      {
        log() {},
        repos: {
          jobs: {
            enqueue(row) {
              enqueued.push(row);
              return {
                id: 801,
                status: "done",
                idempotency_key: row.idempotency_key,
              };
            },
          },
        },
      },
    );

    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].kind, "candidate_supply_monitor");
    assert.equal(result.candidate_refill_enqueued, false);
    assert.equal(result.candidate_refill_job_id, 801);
    assert.equal(result.candidate_refill_job_status, "done");
    assert.equal(result.candidate_refill_verification_enqueued, false);
  });
});

test("T-90 watchdog schedules verification after active recovery production completion", async () => {
  const enqueued = [];
  await withHandlerStubs({
    runtime: {
      async lockRunwayForJob() {
        return {
          verdict: "GREEN",
          phase: "T-90",
          generation: { generation_id: "runway-1" },
          lock: { window_id: "publish-20260717T090000Z" },
          selected_action_ids: ["story-1:youtube_shorts"],
        };
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          generated_at: "2026-07-17T07:30:00.000Z",
          window_label: "publish_morning",
          verdict: "amber",
          safe_to_publish_window: true,
          blockers: [],
          action_runway: {
            status: "covered_no_reserve",
            reserve_actions: 0,
          },
        };
      },
      watchdogNeedsRunwayRepair() {
        return true;
      },
    },
  }, async ({ handlers }) => {
    const result = await handlers.publish_window_watchdog(
      {
        id: 15,
        channel_id: "pulse-gaming",
        payload: {
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          enqueue_repair_on_runway: false,
          enqueue_candidate_refill_on_runway: true,
          candidate_recovery_expected_completion_at:
            "2026-07-17T08:15:00.000Z",
          candidate_recovery_verification_delay_minutes: 5,
        },
      },
      {
        log() {},
        repos: {
          jobs: {
            enqueue(row) {
              enqueued.push(row);
              if (row.kind === "candidate_supply_monitor") {
                return {
                  id: 901,
                  status: "pending",
                  idempotency_key: row.idempotency_key,
                };
              }
              return {
                id: 902,
                status: "pending",
                idempotency_key: row.idempotency_key,
              };
            },
          },
        },
      },
    );

    assert.equal(result.candidate_refill_enqueued, true);
    assert.equal(result.candidate_refill_verification_enqueued, true);
    assert.equal(result.candidate_refill_verification_job_id, 902);
    assert.ok(
      sqliteUtcMs(result.candidate_refill_verification_run_at) >
        new Date(
          "2026-07-17T08:15:00.000Z",
        ).getTime(),
    );
  });

  assert.equal(enqueued.length, 2);
  const recovery = enqueued[0];
  const verification = enqueued[1];
  assert.equal(recovery.kind, "candidate_supply_monitor");
  assert.equal(verification.kind, "publish_window_watchdog");
  assert.equal(
    recovery.idempotency_key,
    "publish_window_candidate_recovery:publish-20260717T090000Z",
  );
  assert.match(
    verification.run_at,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  );
  assert.ok(
    sqliteUtcMs(verification.run_at) >
      new Date(recovery.payload.expected_production_completion_at).getTime(),
  );
  assert.equal(
    verification.payload.candidate_recovery_job_id,
    901,
  );
  assert.equal(
    verification.payload.enqueue_candidate_refill_on_runway,
    false,
  );
  assert.match(
    verification.idempotency_key,
    /publish-20260717T090000Z.*901/,
  );
});

test("T0 guarded publish consumes only the immutable executor plan", async () => {
  const immutablePlan = {
    ready_for_live_executor_handoff: true,
    handoff_ready_actions: [{
      action_id: "story-1:youtube_shorts",
      story_id: "story-1",
      platform: "youtube_shorts",
    }],
  };
  let selectedPlan = null;
  await withHandlerStubs({
    runtime: {
      immutableRunwayRequired() {
        return true;
      },
      async resolveRunwayForJob() {
        return {
          verdict: "GREEN",
          phase: "T0",
          can_publish: true,
          generation: { generation_id: "runway-1" },
          selected_action_ids: ["story-1:youtube_shorts"],
          executor_plan: immutablePlan,
          mutable_global_fallback_used: false,
        };
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          verdict: "green",
          safe_to_publish_window: true,
          blockers: [],
        };
      },
    },
    executor: {
      async selectNextGuardedLiveAction({ executorPlan }) {
        selectedPlan = executorPlan;
        return {
          exhausted: false,
          action_id: "story-1:youtube_shorts",
          selected_action_ids: ["story-1:youtube_shorts"],
          action: immutablePlan.handoff_ready_actions[0],
        };
      },
      async runGuardedLiveDispatchExecutor() {
        return {
          verdict: "GREEN",
          actions: [{
            action_id: "story-1:youtube_shorts",
            story_id: "story-1",
            platform: "youtube_shorts",
            outcome: "new_upload",
          }],
          blocked_actions: [],
          summary: {
            upload_attempt_count: 1,
            db_mutation_count: 1,
          },
        };
      },
      async writeGuardedLiveDispatchExecutorReport() {},
    },
  }, async ({ handlers }) => {
    const original = {
      AUTO_PUBLISH: process.env.AUTO_PUBLISH,
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED:
        process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
      PULSE_EMERGENCY_KILL_SWITCH_CLEAR:
        process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR,
    };
    try {
      process.env.AUTO_PUBLISH = "true";
      process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
      process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR = "true";
      const result = await handlers.publish({
        id: 12,
        payload: {
          phase: "T0",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          immutable_runway_required: true,
        },
      }, { log() {} });
      assert.equal(selectedPlan, immutablePlan);
      assert.equal(result.status, "green");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test("T0 immutable runway failure blocks before the mutable executor selector", async () => {
  await withHandlerStubs({
    runtime: {
      immutableRunwayRequired() {
        return true;
      },
      async resolveRunwayForJob() {
        throw new Error("T90_GENERATION_LOCK_MISSING");
      },
    },
    watchdog: {
      async runPublishWindowWatchdog() {
        return {
          verdict: "green",
          safe_to_publish_window: true,
          blockers: [],
        };
      },
    },
    executor: {
      async selectNextGuardedLiveAction() {
        throw new Error("mutable selector must not run");
      },
    },
  }, async ({ handlers }) => {
    const original = {
      AUTO_PUBLISH: process.env.AUTO_PUBLISH,
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED:
        process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
      PULSE_EMERGENCY_KILL_SWITCH_CLEAR:
        process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR,
    };
    try {
      process.env.AUTO_PUBLISH = "true";
      process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
      process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR = "true";
      await assert.rejects(
        () => handlers.publish({
          id: 13,
          payload: {
            phase: "T0",
            window_label: "publish_morning",
            publish_hour_utc: 9,
            immutable_runway_required: true,
          },
        }, { log() {} }),
        /T90_GENERATION_LOCK_MISSING/,
      );
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
