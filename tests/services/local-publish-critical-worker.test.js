"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "tools",
  "local-publish-critical-worker.js",
);

function loadFresh() {
  delete require.cache[SCRIPT_PATH];
  return require(SCRIPT_PATH);
}

test("publish-critical worker exposes only guarded publish job kinds", () => {
  const worker = loadFresh();

  assert.deepEqual(worker.PUBLISH_WORKER_KINDS, [
    "publish_schedule_recovery_monitor",
    "publish_window_watchdog",
    "publish",
  ]);
});

test("publish-critical worker fails closed unless the guarded runtime contract is explicit", () => {
  const worker = loadFresh();

  assert.throws(
    () => worker.assertGuardedRuntimeContract({}),
    /AUTO_PUBLISH=true/,
  );
  assert.throws(
    () =>
      worker.assertGuardedRuntimeContract({
        AUTO_PUBLISH: "true",
        USE_JOB_QUEUE: "true",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        PULSE_EMERGENCY_KILL_SWITCH: "engaged",
      }),
    /kill switch must be clear/i,
  );
  assert.doesNotThrow(() =>
    worker.assertGuardedRuntimeContract({
      AUTO_PUBLISH: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    }),
  );
});

test("publish-critical worker starts a runner-only restricted queue process", async () => {
  const worker = loadFresh();
  const calls = [];
  const exitCodes = [];
  const bootstrap = {
    async start(options) {
      calls.push(options);
      return { runner: { running: true } };
    },
    async stop() {},
  };
  const env = {
    AUTO_PUBLISH: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "clear",
  };

  const result = await worker.main(
    ["--worker-id", "pulse-live-publish-critical"],
    { stdout: { write() {} }, stderr: { write() {} } },
    {
      bootstrap,
      env,
      exit: (code) => exitCodes.push(code),
      installSignalHandlers: false,
    },
  );

  assert.equal(result.status, "running");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runScheduler, false);
  assert.equal(calls[0].runRunner, true);
  assert.equal(calls[0].runGeneralRunner, true);
  assert.equal(calls[0].autoSeed, false);
  assert.deepEqual(calls[0].kinds, worker.PUBLISH_WORKER_KINDS);
  assert.deepEqual(calls[0].handlerTimeoutMsByKind, {
    publish_schedule_recovery_monitor: 120_000,
  });
  assert.equal(calls[0].stopOnHandlerTimeout, true);
  assert.equal(typeof calls[0].onHandlerTimeout, "function");

  const timeoutError = Object.assign(new Error("bounded timeout"), {
    code: "JOB_HANDLER_TIMEOUT",
  });
  await calls[0].onHandlerTimeout(timeoutError, {
    id: 91,
    kind: "publish_schedule_recovery_monitor",
  });
  assert.deepEqual(exitCodes, [70]);
});
