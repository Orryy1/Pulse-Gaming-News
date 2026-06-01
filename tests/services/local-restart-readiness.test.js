"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildGitStatus,
  buildLocalRestartReadiness,
  buildWindowsSchedulerHygiene,
  cadenceHardGateState,
  commitsMatch,
  formatLocalRestartReadinessMarkdown,
  summariseCadence,
} = require("../../lib/ops/local-restart-readiness");

const ROOT = path.resolve(__dirname, "..", "..");

function healthy(commit = "abcdef1234567890") {
  return {
    ok: true,
    status: 200,
    json: {
      status: "ok",
      deployment: { mode: "local", primary: true },
      build: {
        commit_sha: commit,
        commit_short: commit.slice(0, 7),
        branch: "codex/test",
      },
    },
  };
}

function cleanCadence(overrides = {}) {
  return {
    verdict: "green",
    thresholds: {
      max_recommended_posts_per_24h: overrides.max_recommended_posts_per_24h || 3,
    },
    summary: {
      published_count: 1,
      off_schedule_count: 0,
      burst_pairs: 0,
      min_gap_minutes: null,
      failed_rows_with_platform_ids: 0,
      invalid_public_story_rows: 0,
      ...overrides,
    },
  };
}

function cleanSchedulerHygiene() {
  return {
    platform: "win32",
    inspected: true,
    query_status: "provided",
    relevant_task_count: 0,
    visible_console_risk_count: 0,
    risk_task_names: [],
    tasks: [],
    recommendation: "scheduler_hygiene_clean",
  };
}

test("commitsMatch compares stable prefixes and rejects missing values", () => {
  assert.equal(commitsMatch("abcdef1234567890", "abcdef1234569999"), true);
  assert.equal(commitsMatch("abcdef1234567890", "1234567890abcdef"), false);
  assert.equal(commitsMatch(null, "abcdef1234567890"), false);
});

test("cadenceHardGateState recognises either hard-gate spelling", () => {
  assert.deepEqual(cadenceHardGateState({}), {
    require_window: false,
    require_min_gap: false,
    all_required: false,
    require_daily_cap: false,
    active_primary_auto_publisher: false,
    warn_only: false,
    env: {
      PUBLISH_REQUIRE_WINDOW: null,
      PUBLISH_WINDOW_HARD_GATE: null,
      PUBLISH_REQUIRE_MIN_GAP: null,
      PUBLISH_COOLDOWN_HARD_GATE: null,
      PUBLISH_REQUIRE_DAILY_CAP: null,
      PUBLISH_DAILY_CAP_HARD_GATE: null,
      PUBLISH_CADENCE_WARN_ONLY: null,
      PUBLISH_CADENCE_HARD_GATES: null,
    },
  });
  const state = cadenceHardGateState({
    PUBLISH_WINDOW_HARD_GATE: "true",
    PUBLISH_COOLDOWN_HARD_GATE: "1",
    PUBLISH_DAILY_CAP_HARD_GATE: "yes",
  });
  assert.equal(state.require_window, true);
  assert.equal(state.require_min_gap, true);
  assert.equal(state.require_daily_cap, true);
  assert.equal(state.all_required, true);
});

test("cadenceHardGateState enables all gates for active primary auto-publishers by default", () => {
  const state = cadenceHardGateState({
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PUBLISH_REQUIRE_WINDOW: "false",
    PUBLISH_REQUIRE_MIN_GAP: "false",
    PUBLISH_REQUIRE_DAILY_CAP: "false",
  });

  assert.equal(state.active_primary_auto_publisher, true);
  assert.equal(state.warn_only, false);
  assert.equal(state.require_window, true);
  assert.equal(state.require_min_gap, true);
  assert.equal(state.require_daily_cap, true);
  assert.equal(state.all_required, true);
});

test("cadenceHardGateState honours global warn-only override", () => {
  const state = cadenceHardGateState({
    AUTO_PUBLISH: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PUBLISH_CADENCE_WARN_ONLY: "true",
  });

  assert.equal(state.active_primary_auto_publisher, true);
  assert.equal(state.warn_only, true);
  assert.equal(state.all_required, false);
  assert.equal(state.require_window, false);
  assert.equal(state.require_min_gap, false);
  assert.equal(state.require_daily_cap, false);
});

test("summariseCadence exposes restart-critical publish counters", () => {
  const summary = summariseCadence(cleanCadence({
    published_count: 11,
    off_schedule_count: 10,
    burst_pairs: 7,
    min_gap_minutes: 2,
    max_recommended_posts_per_24h: 3,
    failed_rows_with_platform_ids: 24,
    invalid_public_story_rows: 2,
  }));

  assert.equal(summary.public_posts, 11);
  assert.equal(summary.off_schedule_posts, 10);
  assert.equal(summary.tight_spacing_pairs, 7);
  assert.equal(summary.max_recommended_posts_per_24h, 3);
  assert.equal(summary.invalid_public_story_rows, 2);
});

test("Windows scheduler hygiene flags Pulse tasks that launch visible python consoles", () => {
  const hygiene = buildWindowsSchedulerHygiene({
    platform: "win32",
    cwd: ROOT,
    scheduledTasks: [
      {
        task_name: "Orryy-PulseGaming",
        task_path: "\\",
        state: "Ready",
        execute: "python",
        arguments: "\"C:\\Claude\\orryy-expansion\\agents\\run_daily.py\" pulse_gaming",
        working_directory: "C:\\Claude\\orryy-expansion",
      },
      {
        task_name: "PulseHiddenTts",
        task_path: "\\",
        state: "Ready",
        execute:
          "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server\\venv\\Scripts\\pythonw.exe",
        arguments: "-m uvicorn server:app",
        working_directory:
          "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server",
      },
    ],
  });

  assert.equal(hygiene.inspected, true);
  assert.equal(hygiene.relevant_task_count, 2);
  assert.equal(hygiene.visible_console_risk_count, 1);
  assert.deepEqual(hygiene.risk_task_names, ["Orryy-PulseGaming"]);
  assert.match(
    hygiene.tasks[0].recommended_action,
    /pythonw\.exe or a hidden launcher/i,
  );
});

test("Windows scheduler hygiene does not report clean when Task Scheduler query fails", () => {
  const hygiene = buildWindowsSchedulerHygiene({
    platform: "win32",
    cwd: ROOT,
    execFileSyncImpl() {
      throw new Error("scheduled task query failed");
    },
  });

  assert.equal(hygiene.inspected, true);
  assert.equal(hygiene.query_status, "failed");
  assert.equal(hygiene.recommendation, "inspect_task_scheduler_manually");
});

test("local restart readiness blocks stale running build and disabled cadence gates", async () => {
  const report = await buildLocalRestartReadiness({
    cwd: ROOT,
    env: {
      PORT: "3001",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      PUBLISH_REQUIRE_WINDOW: "false",
      PUBLISH_REQUIRE_MIN_GAP: "false",
      PUBLISH_REQUIRE_DAILY_CAP: "false",
    },
    currentBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/test",
    },
    localHealth: healthy("1111111111111111"),
    publicHealth: healthy("1111111111111111"),
    cadenceReport: cleanCadence({
      off_schedule_count: 3,
      burst_pairs: 2,
      published_count: 11,
      invalid_public_story_rows: 1,
    }),
    gitStatus: { clean: true, changed_count: 0, changed_files: [] },
    windowsSchedulerHygiene: cleanSchedulerHygiene(),
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("running local server is not on the current git commit"));
  assert.ok(report.blockers.includes("public server is not on the current git commit"));
  assert.ok(
    report.blockers.includes(
      "off-schedule posts were detected but publish window hard gate is not enabled",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "tight publish spacing was detected but publish cooldown hard gate is not enabled",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "daily public post cap was exceeded but publish daily-cap hard gate is not enabled",
    ),
  );
  assert.ok(
    report.blockers.includes(
      "public script-validation fallback rows need repair before a clean resume",
    ),
  );
});

test("local restart readiness is green when build, health, cadence and gates are clean", async () => {
  const report = await buildLocalRestartReadiness({
    cwd: ROOT,
    env: {
      PORT: "3001",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      PUBLISH_REQUIRE_WINDOW: "true",
      PUBLISH_REQUIRE_MIN_GAP: "true",
      PUBLISH_REQUIRE_DAILY_CAP: "true",
    },
    currentBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/test",
    },
    localHealth: healthy("abcdef1234567890"),
    publicHealth: healthy("abcdef1234567890"),
    cadenceReport: cleanCadence(),
    gitStatus: { clean: true, changed_count: 0, changed_files: [] },
    windowsSchedulerHygiene: cleanSchedulerHygiene(),
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.restart_recommendation, "controlled_restart_ready");
});

test("local restart readiness warns when Windows scheduler can spawn visible TTS consoles", async () => {
  const report = await buildLocalRestartReadiness({
    cwd: ROOT,
    env: {
      PORT: "3001",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      PUBLISH_REQUIRE_WINDOW: "true",
      PUBLISH_REQUIRE_MIN_GAP: "true",
      PUBLISH_REQUIRE_DAILY_CAP: "true",
    },
    currentBuild: {
      commit_sha: "abcdef1234567890",
      commit_short: "abcdef1",
      branch: "codex/test",
    },
    localHealth: healthy("abcdef1234567890"),
    publicHealth: healthy("abcdef1234567890"),
    cadenceReport: cleanCadence(),
    gitStatus: { clean: true, changed_count: 0, changed_files: [] },
    windowsSchedulerHygiene: buildWindowsSchedulerHygiene({
      platform: "win32",
      cwd: ROOT,
      scheduledTasks: [
        {
          task_name: "PulseVisibleTts",
          execute:
            "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server\\venv\\Scripts\\python.exe",
          arguments: "-m uvicorn server:app",
          working_directory:
            "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server",
        },
      ],
    }),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.windows_scheduler_hygiene.visible_console_risk_count, 1);
  assert.ok(
    report.warnings.includes(
      "1 Pulse-related Windows scheduled task(s) can launch visible console windows",
    ),
  );
});

test("formatLocalRestartReadinessMarkdown is operator readable", async () => {
  const report = await buildLocalRestartReadiness({
    cwd: ROOT,
    env: {
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      PUBLISH_REQUIRE_WINDOW: "true",
      PUBLISH_REQUIRE_MIN_GAP: "true",
      PUBLISH_REQUIRE_DAILY_CAP: "true",
    },
    currentBuild: { commit_sha: "abcdef1234567890", commit_short: "abcdef1" },
    localHealth: healthy("abcdef1234567890"),
    publicHealth: healthy("abcdef1234567890"),
    cadenceReport: cleanCadence(),
    gitStatus: { clean: true, changed_count: 0, changed_files: [] },
    windowsSchedulerHygiene: cleanSchedulerHygiene(),
  });
  const md = formatLocalRestartReadinessMarkdown(report);
  assert.match(md, /# Local Restart Readiness/);
  assert.match(md, /Current commit: abcdef1/);
  assert.match(md, /Publish window hard gate: enabled/);
  assert.match(md, /Daily-cap hard gate: enabled/);
  assert.match(md, /Safety: read-only/);
});

test("buildGitStatus reports changed files without shell parsing", () => {
  const status = buildGitStatus({
    cwd: ROOT,
    execFileSyncImpl(cmd, args) {
      assert.equal(cmd, "git");
      assert.deepEqual(args, ["status", "--porcelain"]);
      return " M server.js\n?? scratch.txt\n";
    },
  });

  assert.equal(status.clean, false);
  assert.equal(status.changed_count, 2);
  assert.deepEqual(status.changed_files, [" M server.js", "?? scratch.txt"]);
});

test("ops:local-restart-readiness command is registered", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:local-restart-readiness"],
    "node tools/local-restart-readiness.js",
  );
});
