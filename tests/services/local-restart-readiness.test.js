"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildGitStatus,
  buildLocalRestartReadiness,
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
    env: {
      PUBLISH_REQUIRE_WINDOW: null,
      PUBLISH_WINDOW_HARD_GATE: null,
      PUBLISH_REQUIRE_MIN_GAP: null,
      PUBLISH_COOLDOWN_HARD_GATE: null,
      PUBLISH_REQUIRE_DAILY_CAP: null,
      PUBLISH_DAILY_CAP_HARD_GATE: null,
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
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.restart_recommendation, "controlled_restart_ready");
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
