const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildPublishWindowWatchdogReport,
  formatPublishWindowWatchdogDiscord,
  watchdogNeedsRunwayRepair,
} = require("../../lib/ops/publish-window-watchdog");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

function byName(name) {
  return DEFAULT_SCHEDULES.find((s) => s.name === name);
}

test("publish window watchdog turns runtime sentinel RED into a hold verdict", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "red",
      blockers: ["public runtime commit f293b24 does not match approved f4d7a87"],
      scheduler_window_readiness: {
        hold_scheduler_or_dispatch: true,
        next_action: "hold_scheduler_and_recover_runtime_ownership",
      },
    },
    publishReadiness: {
      overall_verdict: "amber",
      blockers: [],
      next_action: "Guarded enabled-platform dispatch is ready.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "pass",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.safe_to_publish_window, false);
  assert.equal(report.hold_scheduler_or_dispatch, true);
  assert.deepEqual(report.blockers, [
    "runtime_sentinel: public runtime commit f293b24 does not match approved f4d7a87",
  ]);
  assert.equal(report.next_action, "hold_scheduler_and_recover_runtime_ownership");
});

test("publish window watchdog is GREEN only when runtime, queue and readiness agree", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "green",
      blockers: [],
      scheduler_window_readiness: {
        safe_to_observe_next_window: true,
        hold_scheduler_or_dispatch: false,
        next_action: "observe_guarded_scheduler_window",
      },
      scheduler_proof: {
        enabled_dry_run_action_count: 18,
        executor_handoff_action_count: 18,
        enabled_dry_run_story_count: 6,
        executor_handoff_story_count: 6,
        missing_from_executor_count: 0,
      },
    },
    publishReadiness: {
      overall_verdict: "green",
      blockers: [],
      next_action:
        "Guarded enabled-platform dispatch is ready. Let the scheduler run.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "pass",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.safe_to_publish_window, true);
  assert.equal(report.enabled_dry_run_action_count, 18);
  assert.equal(report.executor_handoff_action_count, 18);
  assert.equal(report.enabled_dry_run_story_count, 6);
  assert.equal(report.executor_handoff_story_count, 6);
  assert.equal(report.action_runway.ready_for_next_24h_boolean, true);
  assert.equal(report.action_runway.covered_publish_windows_24h, 5);
  assert.equal(report.action_runway.reserve_actions, 1);
});

test("publish window watchdog uses unique story runway instead of platform action count", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "green",
      blockers: [],
      scheduler_window_readiness: {
        safe_to_observe_next_window: true,
        hold_scheduler_or_dispatch: false,
        next_action: "observe_guarded_scheduler_window",
      },
      scheduler_proof: {
        enabled_dry_run_action_count: 15,
        executor_handoff_action_count: 15,
        enabled_dry_run_story_count: 5,
        executor_handoff_story_count: 5,
        missing_from_executor_count: 0,
      },
    },
    publishReadiness: {
      overall_verdict: "green",
      blockers: [],
      next_action: "Guarded enabled-platform dispatch is ready.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "pass",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.safe_to_publish_window, true);
  assert.equal(report.action_runway.ready_for_next_24h_boolean, true);
  assert.equal(report.action_runway.uncovered_publish_windows_24h, 0);
  assert.equal(report.action_runway.reserve_actions, 0);
  assert.ok(report.advisory.includes("scheduler_runway: executor_action_reserve_empty"));
  assert.equal(watchdogNeedsRunwayRepair(report), true);
});

test("publish window watchdog warns when executor handoff cannot cover the next day", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "green",
      blockers: [],
      scheduler_window_readiness: {
        safe_to_observe_next_window: true,
        hold_scheduler_or_dispatch: false,
        next_action: "observe_guarded_scheduler_window",
      },
      scheduler_proof: {
        enabled_dry_run_action_count: 9,
        executor_handoff_action_count: 9,
        enabled_dry_run_story_count: 3,
        executor_handoff_story_count: 3,
        missing_from_executor_count: 0,
      },
    },
    publishReadiness: {
      overall_verdict: "green",
      blockers: [],
      next_action: "Guarded enabled-platform dispatch is ready.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "pass",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.safe_to_publish_window, true);
  assert.equal(report.action_runway.ready_for_next_24h_boolean, false);
  assert.equal(report.action_runway.uncovered_publish_windows_24h, 2);
  assert.ok(report.advisory.includes("scheduler_runway: executor_action_runway_short:3/5"));
  assert.equal(watchdogNeedsRunwayRepair(report), true);
});

test("publish window watchdog surfaces advisory AMBER without blocking guarded publishing", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "green",
      blockers: [],
      scheduler_window_readiness: {
        safe_to_observe_next_window: true,
        hold_scheduler_or_dispatch: false,
        next_action: "observe_guarded_scheduler_window",
      },
      scheduler_proof: {
        enabled_dry_run_action_count: 9,
        executor_handoff_action_count: 9,
        missing_from_executor_count: 0,
      },
    },
    publishReadiness: {
      overall_verdict: "amber",
      blockers: [],
      advisory: ["cadence: observe normal publish window"],
      next_action:
        "Guarded enabled-platform dispatch is ready. Let the scheduler run.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "pass",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.safe_to_publish_window, true);
  assert.equal(report.hold_scheduler_or_dispatch, false);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.advisory, [
    "publish_readiness: cadence: observe normal publish window",
  ]);
});

test("publish window watchdog does not call skipped queue proof GREEN", () => {
  const report = buildPublishWindowWatchdogReport({
    generatedAt: "2026-06-14T13:55:00.000Z",
    windowLabel: "publish_afternoon",
    runtimeSentinel: {
      verdict: "green",
      blockers: [],
      scheduler_window_readiness: {
        safe_to_observe_next_window: true,
        hold_scheduler_or_dispatch: false,
        next_action: "observe_guarded_scheduler_window",
      },
      scheduler_proof: {
        enabled_dry_run_action_count: 9,
        executor_handoff_action_count: 9,
        missing_from_executor_count: 0,
      },
    },
    publishReadiness: {
      overall_verdict: "green",
      blockers: [],
      next_action: "Guarded enabled-platform dispatch is ready.",
      readiness_scope: { name: "enabled_platform_guarded_handoff", guard_ready: true },
    },
    queueReport: {
      verdict: "skip",
      reason: "USE_SQLITE_not_enabled",
      blockers: [],
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.safe_to_publish_window, true);
  assert.equal(report.hold_scheduler_or_dispatch, false);
  assert.equal(report.queue_verdict, "skip");
  assert.equal(report.queue_inspect_reason, "USE_SQLITE_not_enabled");
  assert.deepEqual(report.advisory, [
    "queue_inspect: queue proof unavailable: USE_SQLITE_not_enabled",
  ]);
});

test("publish window watchdog Discord message is operator-readable", () => {
  const message = formatPublishWindowWatchdogDiscord({
    generated_at: "2026-06-14T13:55:00.000Z",
    verdict: "green",
    window_label: "publish_afternoon",
    safe_to_publish_window: true,
    runtime_verdict: "green",
    queue_verdict: "pass",
    publish_readiness_verdict: "amber",
    enabled_dry_run_action_count: 9,
    executor_handoff_action_count: 9,
    blockers: [],
    next_action: "observe_guarded_scheduler_window",
  });

  assert.match(message, /Pulse Gaming Pre-Window Watchdog/);
  assert.match(message, /Status:\s+green/);
  assert.match(message, /Safe:\s+yes/);
  assert.match(message, /Actions:\s+9 dry-run \/ 9 handoff/);
  assert.match(message, /Stories:\s+0 dry-run \/ 0 handoff/);
  assert.match(message, /Runway:\s+5\/5 windows/);
});

test("scheduler registers watchdog checks before every guarded publish window", () => {
  const pairs = [
    ["publish_watchdog_morning", "55 8 * * *", "publish_window_watchdog:{date}:08-55"],
    ["publish_watchdog_late_morning", "55 10 * * *", "publish_window_watchdog:{date}:10-55"],
    ["publish_watchdog_afternoon", "55 13 * * *", "publish_window_watchdog:{date}:13-55"],
    ["publish_watchdog_mid_afternoon", "55 15 * * *", "publish_window_watchdog:{date}:15-55"],
    ["publish_watchdog_primary", "55 18 * * *", "publish_window_watchdog:{date}:18-55"],
  ];
  for (const [name, cron, key] of pairs) {
    const entry = byName(name);
    assert.ok(entry, `missing ${name}`);
    assert.equal(entry.kind, "publish_window_watchdog");
    assert.equal(entry.cron_expr, cron);
    assert.equal(entry.idempotencyTemplate, key);
  }
});

test("job handler runs publish window watchdog before publish windows", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const originalHandlers = require.cache[jobHandlersPath];
  const originalWatchdog = require.cache[watchdogPath];
  let called = false;
  try {
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog(options) {
          called = true;
          assert.equal(options.windowLabel, "publish_afternoon");
          assert.equal(options.postDiscord, true);
          assert.equal(options.notifyGreen, true);
          return {
            verdict: "green",
            safe_to_publish_window: true,
            enabled_dry_run_action_count: 9,
            executor_handoff_action_count: 9,
            enabled_dry_run_story_count: 6,
            executor_handoff_story_count: 6,
            action_runway: { status: "covered_with_reserve", reserve_actions: 1 },
            blockers: [],
          };
        },
        watchdogNeedsRunwayRepair() {
          return false;
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish_window_watchdog(
      { payload: { window_label: "publish_afternoon" } },
      { log() {} },
    );

    assert.equal(called, true);
    assert.equal(result.status, "green");
    assert.equal(result.safe_to_publish_window, true);
    assert.equal(result.executor_handoff_action_count, 9);
    assert.equal(result.executor_handoff_story_count, 6);
    assert.equal(result.repair_enqueued, false);
  } finally {
    if (originalHandlers) require.cache[jobHandlersPath] = originalHandlers;
    else delete require.cache[jobHandlersPath];
    if (originalWatchdog) require.cache[watchdogPath] = originalWatchdog;
    else delete require.cache[watchdogPath];
  }
});

test("job handler enqueues safe repair when pre-window story reserve is empty", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const originalHandlers = require.cache[jobHandlersPath];
  const originalWatchdog = require.cache[watchdogPath];
  const enqueued = [];
  try {
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog(options) {
          assert.equal(options.windowLabel, "publish_afternoon");
          return {
            generated_at: "2026-06-17T13:55:00.000Z",
            window_label: "publish_afternoon",
            verdict: "amber",
            safe_to_publish_window: true,
            enabled_dry_run_action_count: 15,
            executor_handoff_action_count: 15,
            enabled_dry_run_story_count: 5,
            executor_handoff_story_count: 5,
            action_runway: { status: "covered_no_reserve", reserve_actions: 0 },
            blockers: [],
          };
        },
        watchdogNeedsRunwayRepair(report) {
          return report.action_runway?.status === "covered_no_reserve";
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish_window_watchdog(
      { payload: { window_label: "publish_afternoon", repair_limit: 8 }, channel_id: "pulse-gaming" },
      { log() {}, repos: { jobs: { enqueue(job) { enqueued.push(job); return { id: 123 }; } } } },
    );

    assert.equal(result.status, "amber");
    assert.equal(result.safe_to_publish_window, true);
    assert.equal(result.repair_enqueued, true);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].kind, "safe_auto_repair_runner");
    assert.equal(enqueued[0].payload.reason, "publish_window_watchdog_runway_refill");
    assert.equal(enqueued[0].idempotency_key, "publish_window_watchdog_repair:2026-06-17:publish_afternoon");
  } finally {
    if (originalHandlers) require.cache[jobHandlersPath] = originalHandlers;
    else delete require.cache[jobHandlersPath];
    if (originalWatchdog) require.cache[watchdogPath] = originalWatchdog;
    else delete require.cache[watchdogPath];
  }
});

test("guarded publish handler blocks before upload when watchdog is RED", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const publisherPath = require.resolve("../../publisher");
  const notifyPath = require.resolve("../../notify");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [watchdogPath, require.cache[watchdogPath]],
    [executorPath, require.cache[executorPath]],
    [publisherPath, require.cache[publisherPath]],
    [notifyPath, require.cache[notifyPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
  };
  const sent = [];
  try {
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    process.env.PULSE_EMERGENCY_KILL_SWITCH = "clear";
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog(options) {
          assert.equal(options.windowLabel, "live_publish_job");
          assert.equal(options.postDiscord, false);
          assert.equal(options.notifyGreen, false);
          return {
            verdict: "red",
            safe_to_publish_window: false,
            hold_scheduler_or_dispatch: true,
            blockers: ["runtime_sentinel: wrong commit"],
            next_action: "hold_scheduler_and_recover_runtime_ownership",
          };
        },
      },
    };
    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction() {
          throw new Error("executor selector must not run while watchdog is red");
        },
      },
    };
    require.cache[publisherPath] = {
      id: publisherPath,
      filename: publisherPath,
      loaded: true,
      exports: {
        async publishNextStory() {
          throw new Error("legacy publisher must not run while guarded watchdog is red");
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async (message) => sent.push(message),
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 77 }, { log() {} });

    assert.equal(result.status, "blocked");
    assert.equal(result.publish_window_blocked, true);
    assert.equal(result.top_reason, "publish_window_watchdog_red");
    assert.deepEqual(result.blockers, ["runtime_sentinel: wrong commit"]);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Publish held before upload/);
    assert.match(sent[0], /wrong commit/);
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("guarded publish handler reports exhausted selector blockers", async () => {
  const os = require("node:os");
  const fs = require("fs-extra");
  const path = require("node:path");
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [watchdogPath, require.cache[watchdogPath]],
    [executorPath, require.cache[executorPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
  };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-exhausted-"));
  const planPath = path.join(tmp, "guarded_dispatch_executor_plan.json");
  const sent = [];
  try {
    await fs.writeJson(planPath, {
      mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
      handoff_ready_actions: [
        {
          action_id: "story1:youtube_shorts",
          story_id: "story1",
          platform: "youtube_shorts",
        },
      ],
    });
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    process.env.PULSE_EMERGENCY_KILL_SWITCH = "clear";
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = planPath;

    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog() {
          return {
            verdict: "green",
            safe_to_publish_window: true,
            blockers: [],
          };
        },
      },
    };
    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction() {
          return {
            exhausted: true,
            reason: "no_unpublished_guarded_actions",
            skipped_actions: [
              {
                action_id: "story1:youtube_shorts",
                story_id: "story1",
                platform: "youtube_shorts",
                reason: "last_second_quality_gate_failed",
                blockers: ["video:duration_too_short (38.58s)"],
              },
            ],
          };
        },
      },
    };
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        async getStories() {
          return [];
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async (message) => sent.push(message),
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 88 }, { log() {} });

    assert.equal(result.guarded_live_dispatch, true);
    assert.equal(result.skipped, true);
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "no_unpublished_guarded_actions");
    assert.equal(result.skipped_action_count, 1);
    assert.deepEqual(result.skipped_actions, [
      {
        action_id: "story1:youtube_shorts",
        story_id: "story1",
        platform: "youtube_shorts",
        reason: "last_second_quality_gate_failed",
        blockers: ["video:duration_too_short (38.58s)"],
      },
    ]);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Guarded Publish Held/);
    assert.match(sent[0], /video:duration_too_short \(38\.58s\)/);
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.remove(tmp);
  }
});
