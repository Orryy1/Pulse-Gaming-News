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

test("T-90 watchdog never locks a runway when the watchdog is unsafe", async () => {
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
    const result = await handlers.publish_window_watchdog({
      payload: {
        phase: "T-90",
        window_label: "publish_morning",
        publish_hour_utc: 9,
      },
    }, { log() {} });
    assert.equal(result.runway_lock_status, "not_attempted");
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
