"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRuntimeOwnershipSentinel,
  formatRuntimeOwnershipSentinelMarkdown,
  normaliseProcessSnapshot,
  queryRuntimeProcessSnapshot,
} = require("../../lib/ops/runtime-ownership-sentinel");

function health(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: {
      status: "ok",
      schedulerActive: true,
      deployment: { mode: "local", primary: true },
      build: {
        commit_sha: "abcdef1234567890",
        commit_short: "abcdef1",
        branch: "codex/live",
      },
      runtime: {
        auto_publish: true,
        use_job_queue_explicit: "true",
        guarded_live_dispatch_enabled: true,
        emergency_kill_switch_clear: true,
        safe_observation_mode: false,
        controlled_restart_no_scheduler_mode: false,
        dispatch: {
          mode: "queue",
          strict: true,
          reason: "queue_guarded",
        },
      },
      ...overrides.json,
    },
    ...overrides,
  };
}

const goodProcessSnapshot = {
  port: 3001,
  port_owner_pid: 34076,
  processes: [
    {
      pid: 34076,
      name: "node.exe",
      command_line:
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\server.js',
      working_directory: "C:\\Users\\MORR\\gaming-studio\\pulse-gaming",
    },
    {
      pid: 31436,
      name: "cloudflared.exe",
      command_line: "cloudflared tunnel --url http://localhost:3001",
    },
  ],
};

test("runtime sentinel passes only when live owner, commit and scheduler mode match", () => {
  const report = buildRuntimeOwnershipSentinel({
    now: new Date("2026-06-11T10:30:00Z"),
    expectedBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      LOCAL_PUBLIC_URL: "https://pulse.example.test",
    },
    localHealth: health(),
    publicHealth: health(),
    processSnapshot: goodProcessSnapshot,
  });

  assert.equal(report.verdict, "green");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.summary.port_owner_pid, 34076);
  assert.equal(report.summary.cloudflared_present, true);
  assert.equal(report.summary.scheduler_active, true);
  assert.equal(report.summary.dispatch_mode, "queue");
  assert.equal(report.safety.read_only, true);

  const md = formatRuntimeOwnershipSentinelMarkdown(report);
  assert.match(md, /Runtime Ownership Sentinel/);
  assert.match(md, /Verdict: GREEN/);
  assert.match(md, /Port owner PID: 34076/);
});

test("runtime sentinel fails red when queue auto-publish is not guarded-live armed", () => {
  const unguardedHealth = health({
    json: {
      runtime: {
        auto_publish: true,
        use_job_queue_explicit: "true",
        guarded_live_dispatch_enabled: false,
        emergency_kill_switch_clear: false,
        safe_observation_mode: false,
        controlled_restart_no_scheduler_mode: false,
        dispatch: {
          mode: "queue",
          strict: true,
          reason: "queue_guarded",
        },
      },
    },
  });
  const report = buildRuntimeOwnershipSentinel({
    now: new Date("2026-06-11T19:05:00Z"),
    expectedBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
    localHealth: unguardedHealth,
    publicHealth: unguardedHealth,
    processSnapshot: goodProcessSnapshot,
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.some((line) => /guarded live dispatch/i.test(line)));
  assert.ok(report.blockers.some((line) => /kill switch/i.test(line)));
  assert.equal(report.scheduler_window_readiness.safe_to_observe_next_window, false);
});

test("runtime sentinel fails red for wrong runtime drift and legacy dispatch", () => {
  const driftedHealth = health({
    json: {
      schedulerActive: false,
      build: {
        commit_sha: "021b26abcdef0000",
        commit_short: "021b26a",
        branch: "codex/pulse-next-level-growth",
      },
      runtime: {
        auto_publish: false,
        use_job_queue_explicit: "false",
        dispatch: { mode: "legacy_dev", strict: false, reason: "dev_escape" },
      },
    },
  });
  const report = buildRuntimeOwnershipSentinel({
    expectedBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
    localHealth: driftedHealth,
    publicHealth: driftedHealth,
    processSnapshot: {
      port: 3001,
      port_owner_pid: 34176,
      processes: [
        {
          pid: 34176,
          name: "node.exe",
          command_line: "node C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\server.js",
        },
      ],
    },
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.some((line) => /commit/i.test(line)));
  assert.ok(report.blockers.some((line) => /branch/i.test(line)));
  assert.ok(report.blockers.some((line) => /AUTO_PUBLISH/i.test(line)));
  assert.ok(report.blockers.some((line) => /USE_JOB_QUEUE/i.test(line)));
  assert.ok(report.blockers.some((line) => /schedulerActive/i.test(line)));
  assert.ok(report.blockers.some((line) => /legacy_dev/i.test(line)));
  assert.ok(report.blockers.some((line) => /cloudflared/i.test(line)));
  assert.equal(report.recommendation, "hold_scheduler_and_recover_runtime_ownership");
});

test("runtime sentinel does not hold publishing for report-only commit drift", () => {
  const reportOnlyHealth = health();
  reportOnlyHealth.json.build = {
    commit_sha: "1111111111111111111111111111111111111111",
    commit_short: "1111111",
    branch: "codex/live",
  };
  const report = buildRuntimeOwnershipSentinel({
    expectedBuild: {
      commit_sha: "2222222222222222222222222222222222222222",
      commit_short: "2222222",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
    localHealth: reportOnlyHealth,
    publicHealth: reportOnlyHealth,
    processSnapshot: goodProcessSnapshot,
    execFileSyncImpl(file, args) {
      assert.equal(file, "git");
      assert.deepEqual(args, [
        "diff",
        "--name-only",
        "1111111111111111111111111111111111111111",
        "2222222222222222222222222222222222222222",
        "--",
      ]);
      return "LOCAL_TTS_OVERNIGHT_REPORT.md\n";
    },
  });

  assert.equal(report.verdict, "green");
  assert.deepEqual(report.blockers, []);
  assert.ok(
    report.advisory.some((line) =>
      /commit drift is non-runtime-only/i.test(line),
    ),
  );
  assert.equal(report.scheduler_window_readiness.safe_to_observe_next_window, true);
  assert.equal(report.health.local.facts.commit_drift.safe_to_ignore, true);
  assert.deepEqual(report.health.local.facts.commit_drift.runtime_relevant_files, []);
});

test("runtime sentinel still blocks commit drift when runtime files changed", () => {
  const staleRuntimeHealth = health();
  staleRuntimeHealth.json.build = {
    commit_sha: "1111111111111111111111111111111111111111",
    commit_short: "1111111",
    branch: "codex/live",
  };
  const report = buildRuntimeOwnershipSentinel({
    expectedBuild: {
      commit_sha: "2222222222222222222222222222222222222222",
      commit_short: "2222222",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
    localHealth: staleRuntimeHealth,
    publicHealth: staleRuntimeHealth,
    processSnapshot: goodProcessSnapshot,
    execFileSyncImpl() {
      return "LOCAL_TTS_OVERNIGHT_REPORT.md\nlib/job-handlers.js\n";
    },
  });

  assert.equal(report.verdict, "red");
  assert.ok(
    report.blockers.some((line) =>
      /runtime-relevant files changed/i.test(line),
    ),
  );
  assert.equal(report.scheduler_window_readiness.safe_to_observe_next_window, false);
  assert.deepEqual(report.health.local.facts.commit_drift.runtime_relevant_files, [
    "lib/job-handlers.js",
  ]);
});

test("runtime sentinel fails red when guarded executor handoff is stale against current dry-run proof", () => {
  const report = buildRuntimeOwnershipSentinel({
    now: new Date("2026-06-14T13:55:00Z"),
    expectedBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/live",
    },
    env: {
      PORT: "3001",
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      LOCAL_PUBLIC_URL: "https://pulse.example.test",
    },
    localHealth: health(),
    publicHealth: health(),
    processSnapshot: goodProcessSnapshot,
    schedulerProof: {
      dryRunPlan: {
        generated_at: "2026-06-14T12:51:40.487Z",
        safety: {
          dry_run_only: true,
          no_network_uploads: true,
          no_db_mutation: true,
          no_oauth_or_token_change: true,
        },
        actions: [
          {
            story_id: "fresh-story",
            platform: "youtube_shorts",
            action: "would_publish",
            platform_enabled: true,
            blockers: [],
          },
          {
            story_id: "fresh-story",
            platform: "instagram_reels",
            action: "would_publish",
            platform_enabled: true,
            blockers: [],
          },
        ],
      },
      executorPlan: {
        generated_at: "2026-06-13T12:53:13.916Z",
        handoff_ready_actions: [
          {
            story_id: "old-story",
            platform: "youtube_shorts",
            action_id: "old-story:youtube_shorts",
          },
        ],
      },
    },
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.some((line) => /guarded executor handoff stale/i.test(line)));
  assert.ok(report.blockers.some((line) => /missing current enabled dry-run actions/i.test(line)));
  assert.equal(report.scheduler_window_readiness.safe_to_observe_next_window, false);
  assert.equal(report.scheduler_window_readiness.next_action, "refresh_guarded_dispatch_handoff_before_window");
});

test("process snapshots normalise PID, server ownership and tunnel evidence", () => {
  const snapshot = normaliseProcessSnapshot({
    port: "3001",
    port_owner_pid: "1234",
    processes: [
      { ProcessId: "1234", Name: "node.exe", CommandLine: "node server.js" },
      { ProcessId: "4321", Name: "cloudflared.exe", CommandLine: "cloudflared tunnel run pulse" },
    ],
  });

  assert.equal(snapshot.port, 3001);
  assert.equal(snapshot.port_owner_pid, 1234);
  assert.equal(snapshot.port_owner?.is_server_js, true);
  assert.equal(snapshot.cloudflared.length, 1);
});

test("runtime process query uses configurable timeout to avoid false RED probes", () => {
  if (process.platform !== "win32") return;
  let timeoutSeen = 0;
  const snapshot = queryRuntimeProcessSnapshot({
    port: 3001,
    env: { PULSE_RUNTIME_PROCESS_QUERY_TIMEOUT_MS: "30000" },
    execFileSyncImpl(_file, _args, options) {
      timeoutSeen = options.timeout;
      return JSON.stringify({
        port: 3001,
        port_owner_pid: 88768,
        processes: [
          { pid: 88768, name: "node.exe", command_line: "node server.js" },
          { pid: 9476, name: "cloudflared.exe", command_line: "cloudflared tunnel run pulse" },
        ],
        query_status: "ok",
      });
    },
  });

  assert.equal(timeoutSeen, 30000);
  assert.equal(snapshot.port_owner_pid, 88768);
});
