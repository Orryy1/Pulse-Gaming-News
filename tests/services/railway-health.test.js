"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRailwayHealthReport,
  parseRailwayJsonLines,
  redactSensitive,
  renderRailwayHealthMarkdown,
  resolveExpectedCommit,
} = require("../../lib/ops/railway-health");

test("parseRailwayJsonLines tolerates Railway UTF-16-ish NUL output", () => {
  const raw = '{\u0000"\u0000m\u0000e\u0000s\u0000s\u0000a\u0000g\u0000e\u0000"\u0000:\u0000"\u0000o\u0000k\u0000"\u0000}\u0000\n';
  assert.deepEqual(parseRailwayJsonLines(raw), [{ message: "ok" }]);
});

test("railway health passes a clean latest deployment and healthy app", () => {
  const report = buildRailwayHealthReport({
    generatedAt: "2026-04-28T00:00:00.000Z",
    expectedCommit: "abc123",
    deployments: [
      {
        id: "dep_1",
        status: "SUCCESS",
        meta: {
          commitHash: "abc123",
          branch: "main",
          commitMessage: "Deploy fix",
        },
      },
    ],
    health: {
      ok: true,
      status: 200,
      body: {
        status: "ok",
        build: { commit_sha: "abc123", deployment_id: "dep_1" },
        runtime: {
          sqlite_db_path: "/data/pulse.db",
          sqlite_db_path_looks_ephemeral: false,
          dispatch: { mode: "queue", strict: true },
        },
      },
    },
    appLogs: [{ level: "info", message: "[server] started" }],
  });
  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.hardFails, []);
  assert.ok(report.green.includes("latest_deployment_success"));
  assert.ok(report.green.includes("sqlite_path_persistent"));
});

test("railway health fails on migration checksum errors", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    appLogs: [
      {
        level: "error",
        message:
          "[db] migration runner failed: [migrate] checksum mismatch for 005_workers.sql",
      },
    ],
  });
  assert.equal(report.verdict, "fail");
  assert.equal(report.hardFails[0].code, "migration_checksum_error");
});

test("railway health reports deprecations as advisories without changing verdict", () => {
  const report = buildRailwayHealthReport({
    expectedCommit: "abc123",
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    buildLogs: [
      {
        level: "info",
        message: "npm warn deprecated node-domexception@1.0.0: Use native DOMException",
      },
    ],
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.warnings.length, 0);
  assert.equal(report.advisories.length, 1);
  assert.equal(report.advisories[0].code, "build_advisory");
});

test("railway health treats optional queue stats 401 http log as advisory", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    httpLogs: [
      {
        status: 401,
        method: "GET",
        path: "/api/queue/stats",
        message: "",
      },
    ],
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.warnings.length, 0);
  assert.ok(report.advisories.some((a) => a.code === "queue_stats_auth_advisory"));
});

test("railway health includes clean authenticated queue stats as green signal", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStats: {
      jobs: {
        total: 8,
        by_status: { done: 8 },
        stale_claims: 0,
        oldest_pending_minutes: null,
      },
      derivatives: { total: 2, by_status: { rendered: 2 } },
      generated_at: "2026-04-29T00:00:00.000Z",
    },
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.queue.checked, true);
  assert.equal(report.queue.jobs.total, 8);
  assert.ok(report.green.includes("queue_stats_ok"));

  const md = renderRailwayHealthMarkdown(report);
  assert.match(md, /## Queue/);
  assert.match(md, /jobsTotal: 8/);
});

test("railway health warns on failed or stale production queue jobs", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStats: {
      jobs: {
        total: 3,
        by_status: { failed: 1, pending: 2 },
        stale_claims: 1,
        oldest_pending_minutes: 140,
        recent_failed: [
          {
            id: 99,
            kind: "engage_first_hour",
            story_id: "story1",
            attempt_count: 3,
            max_attempts: 3,
            last_error: "Request had insufficient authentication scopes.",
            updated_at: "2026-04-29T10:00:00.000Z",
          },
        ],
      },
      derivatives: { total: 0, by_status: {} },
    },
  });
  assert.equal(report.verdict, "review");
  assert.ok(report.warnings.some((w) => w.code === "queue_failed_jobs_present"));
  assert.ok(report.warnings.some((w) => w.code === "queue_stale_claims_present"));
  assert.ok(report.warnings.some((w) => w.code === "queue_old_pending_jobs"));

  const md = renderRailwayHealthMarkdown(report);
  assert.match(md, /recentFailed/);
  assert.match(md, /engage_first_hour/);
  assert.match(md, /insufficient authentication scopes/);
});

test("railway health treats sampled pre-deploy queue failures as historical advisories", () => {
  const report = buildRailwayHealthReport({
    deployments: [
      {
        id: "dep_1",
        status: "SUCCESS",
        createdAt: "2026-04-29T11:00:00.000Z",
        meta: { commitHash: "abc123" },
      },
    ],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStats: {
      jobs: {
        total: 10,
        by_status: { done: 9, failed: 1 },
        stale_claims: 0,
        oldest_pending_minutes: null,
        recent_failed: [
          {
            id: 99,
            kind: "studio_analytics_loop",
            last_error: "Cannot open database because the directory does not exist",
            updated_at: "2026-04-29T10:00:00.000Z",
          },
        ],
      },
      derivatives: { total: 0, by_status: {} },
    },
  });

  assert.equal(report.verdict, "pass");
  assert.equal(report.warnings.length, 0);
  assert.ok(
    report.advisories.some((a) => a.code === "queue_historical_failed_jobs_present"),
  );
  assert.ok(report.green.includes("queue_no_active_failed_jobs"));

  const md = renderRailwayHealthMarkdown(report);
  assert.match(md, /updated=2026-04-29T10:00:00\.000Z/);
});

test("railway health still reviews queue failures after the latest deployment", () => {
  const report = buildRailwayHealthReport({
    deployments: [
      {
        id: "dep_1",
        status: "SUCCESS",
        createdAt: "2026-04-29T11:00:00.000Z",
        meta: { commitHash: "abc123" },
      },
    ],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStats: {
      jobs: {
        total: 10,
        by_status: { done: 9, failed: 1 },
        stale_claims: 0,
        oldest_pending_minutes: null,
        recent_failed: [
          {
            id: 100,
            kind: "publish",
            last_error: "Graph API timeout",
            updated_at: "2026-04-29T11:05:00.000Z",
          },
        ],
      },
      derivatives: { total: 0, by_status: {} },
    },
  });

  assert.equal(report.verdict, "review");
  assert.ok(report.warnings.some((w) => w.code === "queue_failed_jobs_present"));
  assert.match(report.warnings[0].message, /after the latest deployment/);
});

test("railway health redacts queue failed-job token-shaped errors", () => {
  const md = renderRailwayHealthMarkdown(
    buildRailwayHealthReport({
      deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
      health: { ok: true, status: 200, body: { status: "ok" } },
      queueStats: {
        jobs: {
          total: 1,
          by_status: { failed: 1 },
          stale_claims: 0,
          oldest_pending_minutes: null,
          recent_failed: [
            {
              id: 10,
              kind: "publish",
              last_error: "Bearer abc.def.ghi access_token=supersecret",
            },
          ],
        },
        derivatives: { total: 0, by_status: {} },
      },
    }),
  );
  assert.doesNotMatch(md, /abc\.def\.ghi/);
  assert.doesNotMatch(md, /supersecret/);
  assert.match(md, /\[REDACTED\]/);
});

test("railway health treats missing local queue auth as advisory", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStatsIssue:
      "API_TOKEN not available locally; authenticated queue stats skipped.",
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.queue.checked, false);
  assert.ok(report.advisories.some((a) => a.code === "queue_stats_not_checked"));
});

test("railway health treats queue stats auth failure as advisory", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStatsIssue: "HTTP 401 auth failed",
  });
  assert.equal(report.verdict, "pass");
  assert.ok(report.advisories.some((w) => w.code === "queue_stats_not_checked"));
});

test("railway health warns when queue stats endpoint fails server-side", () => {
  const report = buildRailwayHealthReport({
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "abc123" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
    queueStatsIssue: "HTTP 500",
  });
  assert.equal(report.verdict, "review");
  assert.ok(report.warnings.some((w) => w.code === "queue_stats_not_checked"));
});

test("railway health fails when an explicit expected deployment commit mismatches", () => {
  const report = buildRailwayHealthReport({
    expectedCommit: "local",
    deployments: [{ id: "dep_1", status: "SUCCESS", meta: { commitHash: "remote" } }],
    health: { ok: true, status: 200, body: { status: "ok" } },
  });
  assert.equal(report.verdict, "fail");
  assert.equal(report.hardFails[0].code, "deployment_commit_mismatch");
});

test("railway health expected commit can be overridden for deployed checks", () => {
  assert.equal(
    resolveExpectedCommit({
      env: { RAILWAY_EXPECTED_COMMIT: "deployed_sha" },
      gitHead: () => "local_sha",
    }),
    "deployed_sha",
  );
  assert.equal(
    resolveExpectedCommit({
      env: {},
      gitHead: () => "local_sha",
    }),
    null,
  );
  assert.equal(
    resolveExpectedCommit({
      env: { RAILWAY_HEALTH_EXPECT_LOCAL_COMMIT: "true" },
      gitHead: () => "local_sha",
    }),
    "local_sha",
  );
});

test("railway health redacts secrets in report text", () => {
  assert.equal(redactSensitive("Bearer abc.def.ghi"), "Bearer [REDACTED]");
  const md = renderRailwayHealthMarkdown(
    buildRailwayHealthReport({
      deployments: [
        {
          id: "dep_1",
          status: "FAILED",
          meta: { commitMessage: "TOKEN=very-secret-token-value" },
        },
      ],
      health: { ok: false, status: 500, error: "Bearer abc.def.ghi failed" },
    }),
  );
  assert.doesNotMatch(md, /very-secret-token-value/);
  assert.doesNotMatch(md, /abc\.def\.ghi/);
  assert.match(md, /\[REDACTED\]/);
});
