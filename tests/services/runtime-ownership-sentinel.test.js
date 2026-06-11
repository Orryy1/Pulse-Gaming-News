"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRuntimeOwnershipSentinel,
  formatRuntimeOwnershipSentinelMarkdown,
  normaliseProcessSnapshot,
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
