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

test("railway health fails when latest deployment commit is not local HEAD", () => {
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
