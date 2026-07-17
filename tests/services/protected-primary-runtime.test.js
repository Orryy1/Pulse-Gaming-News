"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const LAUNCHER_PATH = path.join(ROOT, "tools", "local-live-primary-runtime.ps1");

test("protected primary mode is authoritative after dotenv loading", () => {
  const {
    applyProtectedPrimaryRuntime,
  } = require("../../lib/protected-primary-runtime");
  const env = {
    PULSE_SERVER_GENERAL_QUEUE_RUNNER: "true",
    PULSE_GENERAL_QUEUE_RUNNER: "true",
    PULSE_SERVER_CONTENT_RUNNERS: "true",
  };

  const state = applyProtectedPrimaryRuntime({
    argv: ["node", "server.js", "--protected-primary-runtime"],
    env,
  });

  assert.equal(state.enabled, true);
  assert.equal(env.PULSE_PROTECTED_PRIMARY_RUNTIME, "true");
  assert.equal(env.PULSE_SERVER_GENERAL_QUEUE_RUNNER, "false");
  assert.equal(env.PULSE_GENERAL_QUEUE_RUNNER, "false");
  assert.equal(env.PULSE_SERVER_CONTENT_RUNNERS, "false");
});

test("ordinary development runtime is not silently converted to protected mode", () => {
  const {
    applyProtectedPrimaryRuntime,
  } = require("../../lib/protected-primary-runtime");
  const env = { PULSE_SERVER_CONTENT_RUNNERS: "true" };

  const state = applyProtectedPrimaryRuntime({
    argv: ["node", "server.js"],
    env,
  });

  assert.equal(state.enabled, false);
  assert.equal(env.PULSE_SERVER_CONTENT_RUNNERS, "true");
});

test("protected API jobs are bounded, idempotent queue requests", () => {
  const {
    enqueueProtectedApiJob,
  } = require("../../lib/protected-primary-runtime");
  const calls = [];
  const repos = {
    jobs: {
      enqueue(job) {
        calls.push(job);
        return { id: 42, ...job };
      },
    },
  };

  const result = enqueueProtectedApiJob({
    repos,
    kind: "produce",
    now: new Date("2026-07-17T07:42:19.000Z"),
    payload: { source: "api_publish" },
  });

  assert.equal(result.id, 42);
  assert.deepEqual(calls, [{
    kind: "produce",
    payload: { source: "api_publish" },
    priority: 30,
    run_at: null,
    max_attempts: 3,
    requires_gpu: 0,
    idempotency_key: "protected_api:produce:2026-07-17T07:42Z",
  }]);
  assert.throws(
    () => enqueueProtectedApiJob({ repos, kind: "publish" }),
    /protected primary API job kind is not allowed/,
  );
});

test("server and approved launcher enforce protected-primary execution", () => {
  const server = fs.readFileSync(SERVER_PATH, "utf8");
  const launcher = fs.readFileSync(LAUNCHER_PATH, "utf8");

  assert.match(server, /applyProtectedPrimaryRuntime/);
  assert.match(server, /protected_primary_runtime:\s*PROTECTED_PRIMARY_RUNTIME\.enabled/);
  assert.match(server, /runGeneralRunner:\s*PROTECTED_PRIMARY_RUNTIME\.enabled\s*\?\s*false/);
  assert.match(server, /additionalRunnerLanes:\s*PROTECTED_PRIMARY_RUNTIME\.enabled\s*\?\s*\[\]/);
  assert.match(server, /enqueueProtectedApiJob/);
  assert.match(launcher, /--protected-primary-runtime/);
});
