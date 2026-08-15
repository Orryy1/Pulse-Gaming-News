"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  startLeaseHeartbeat,
} = require("../../lib/services/lease-heartbeat");

function timerFixture() {
  let callback = null;
  let cleared = 0;
  return {
    setIntervalImpl(fn) {
      callback = fn;
      return { unref() {} };
    },
    clearIntervalImpl() {
      cleared += 1;
    },
    fire() {
      return callback?.();
    },
    get cleared() {
      return cleared;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a rejected heartbeat deactivates the lease exactly once", async () => {
  const timer = timerFixture();
  const losses = [];
  const handle = startLeaseHeartbeat({
    heartbeat: () => false,
    intervalMs: 1000,
    onLost(reason) {
      losses.push(reason);
    },
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  assert.equal(timer.fire(), false);
  assert.equal(await handle.lost, "lease_heartbeat_rejected");
  assert.equal(handle.active, false);
  assert.equal(handle.isLost, true);
  assert.deepEqual(losses, ["lease_heartbeat_rejected"]);
  assert.equal(timer.cleared, 1);
  assert.equal(timer.fire(), false);
  assert.deepEqual(losses, ["lease_heartbeat_rejected"]);
  assert.throws(() => handle.assertActive(), /lease_heartbeat_not_active/);
  assert.equal(handle.stop(), true);
  assert.equal(handle.stop(), false);
});

test("successful synchronous heartbeats stay active until explicitly stopped", () => {
  const timer = timerFixture();
  let heartbeats = 0;
  const handle = startLeaseHeartbeat({
    heartbeat() {
      heartbeats += 1;
      return true;
    },
    intervalMs: 1000,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  assert.equal(timer.fire(), true);
  assert.equal(handle.heartbeatNow(), true);
  assert.equal(heartbeats, 2);
  assert.equal(handle.active, true);
  assert.equal(handle.isLost, false);
  assert.equal(handle.stop(), true);
  assert.equal(handle.stop(), false);
  assert.equal(timer.cleared, 1);
  assert.equal(handle.active, false);
});

test("asynchronous rejection resolves the loss promise and clears the timer", async () => {
  const timer = timerFixture();
  const handle = startLeaseHeartbeat({
    heartbeat: async () => false,
    intervalMs: 1000,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  assert.equal(await timer.fire(), false);
  assert.equal(await handle.lost, "lease_heartbeat_rejected");
  assert.equal(handle.active, false);
  assert.equal(timer.cleared, 1);
});

test("overlapping asynchronous heartbeats share one in-flight operation", async () => {
  const timer = timerFixture();
  const pending = deferred();
  let calls = 0;
  const handle = startLeaseHeartbeat({
    heartbeat() {
      calls += 1;
      return pending.promise;
    },
    intervalMs: 1000,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  const first = handle.heartbeatNow();
  const second = handle.heartbeatNow();
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve(true);
  assert.equal(await first, true);
  assert.equal(handle.active, true);
  handle.stop();
});

test("heartbeat exceptions fail closed without leaking exception text", async () => {
  const timer = timerFixture();
  const logs = [];
  const handle = startLeaseHeartbeat({
    heartbeat() {
      throw new Error("database_busy_secret_detail");
    },
    intervalMs: 1000,
    log: {
      error(message) {
        logs.push(message);
      },
    },
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  assert.equal(handle.heartbeatNow(), false);
  assert.equal(await handle.lost, "lease_heartbeat_error");
  assert.deepEqual(logs, ["[lease] heartbeat failed"]);
  assert.equal(logs.join(" ").includes("database_busy_secret_detail"), false);
});

test("AbortSignal loss is immediate and does not call the heartbeat", async () => {
  const timer = timerFixture();
  const controller = new AbortController();
  let calls = 0;
  const handle = startLeaseHeartbeat({
    heartbeat() {
      calls += 1;
      return true;
    },
    intervalMs: 1000,
    signal: controller.signal,
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  controller.abort();
  assert.equal(await handle.lost, "lease_heartbeat_aborted");
  assert.equal(calls, 0);
  assert.equal(handle.active, false);
  assert.equal(timer.cleared, 1);
});

test("an already-aborted signal returns a lost handle without creating a timer", async () => {
  let timerCreated = false;
  const controller = new AbortController();
  controller.abort();
  const handle = startLeaseHeartbeat({
    heartbeat: () => true,
    intervalMs: 1000,
    signal: controller.signal,
    setIntervalImpl() {
      timerCreated = true;
      return { unref() {} };
    },
  });
  assert.equal(await handle.lost, "lease_heartbeat_aborted");
  assert.equal(timerCreated, false);
  assert.equal(handle.isLost, true);
});

test("an async onLost failure is redacted and does not reject the loss signal", async () => {
  const timer = timerFixture();
  const logs = [];
  const handle = startLeaseHeartbeat({
    heartbeat: () => false,
    intervalMs: 1000,
    async onLost() {
      throw new Error("private_on_lost_detail");
    },
    log: {
      error(message) {
        logs.push(message);
      },
    },
    setIntervalImpl: timer.setIntervalImpl,
    clearIntervalImpl: timer.clearIntervalImpl,
  });
  handle.heartbeatNow();
  assert.equal(await handle.lost, "lease_heartbeat_rejected");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(logs, ["[lease] onLost handler failed"]);
});

test("invalid heartbeat configuration is rejected before creating a timer", () => {
  assert.throws(
    () => startLeaseHeartbeat({ heartbeat: null, intervalMs: 1000 }),
    /lease_heartbeat_function_required/,
  );
  assert.throws(
    () => startLeaseHeartbeat({ heartbeat: () => true, intervalMs: 0 }),
    /lease_heartbeat_interval_invalid/,
  );
  assert.throws(
    () => startLeaseHeartbeat({ heartbeat: () => true, intervalMs: 1000, signal: {} }),
    /lease_heartbeat_signal_invalid/,
  );
});
