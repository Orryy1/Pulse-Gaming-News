"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { JobsRunner } = require("../../lib/services/jobs-runner");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("JobsRunner refuses side effects after its local server-lease deadline", async () => {
  let releaseHandler;
  let handlerContext;
  let sideEffectRan = false;
  let completed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  let claimed = false;
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 81,
          kind: "guarded",
          attempt_count: 1,
          claim_token: "801",
        };
      },
      complete() {
        completed = true;
      },
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async guarded(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
        ctx.assertLeaseHealthy();
        sideEffectRan = true;
      },
    },
    reposProvider: () => repos,
    leaseMs: 40,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  await delay(80);
  releaseHandler();
  await tick;

  assert.equal(sideEffectRan, false);
  assert.equal(completed, false);
  assert.equal(handlerContext.signal.aborted, true);
  assert.throws(() => handlerContext.assertLeaseHealthy(), /job_lease_lost/);
});

test("JobsRunner aborts cooperative work when the local deadline elapses", async () => {
  let releaseHandler;
  let handlerContext;
  let completed = false;
  let claimed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 82,
          kind: "cooperative",
          attempt_count: 1,
          claim_token: "802",
        };
      },
      complete() {
        completed = true;
      },
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async cooperative(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
      },
    },
    reposProvider: () => repos,
    leaseMs: 50,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  const abortedBeforeTimeout = await Promise.race([
    new Promise((resolve) => {
      handlerContext.signal.addEventListener("abort", () => resolve(true), {
        once: true,
      });
    }),
    delay(150).then(() => false),
  ]);
  releaseHandler();
  await tick;

  assert.equal(abortedBeforeTimeout, true);
  assert.equal(completed, false);
});

test("a heartbeat that returns after the local deadline cannot renew authority", async () => {
  let releaseHandler;
  let resolveHeartbeat;
  let handlerContext;
  let heartbeatStarted = false;
  let claimed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 83,
          kind: "guarded",
          attempt_count: 1,
          claim_token: "803",
        };
      },
      heartbeat() {
        heartbeatStarted = true;
        return new Promise((resolve) => {
          resolveHeartbeat = resolve;
        });
      },
      complete() {
        throw new Error("completion_must_not_run");
      },
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async guarded(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
      },
    },
    reposProvider: () => repos,
    leaseMs: 50,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  const heartbeat = runner._heartbeat();
  while (!heartbeatStarted)
    await new Promise((resolve) => setImmediate(resolve));
  await delay(80);
  resolveHeartbeat(true);
  const heartbeatResult = await heartbeat;
  releaseHandler();
  await tick;

  assert.equal(heartbeatResult, false);
  assert.equal(handlerContext.signal.aborted, true);
  assert.throws(() => handlerContext.assertLeaseHealthy(), /job_lease_lost/);
});

test("a stale heartbeat generation cannot abort a newer claim", async () => {
  let releaseFirst;
  let releaseSecond;
  let resolveOldHeartbeat;
  let firstContext;
  let secondContext;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const claims = [
    {
      id: 84,
      kind: "first",
      attempt_count: 1,
      claim_token: "804",
    },
    {
      id: 84,
      kind: "second",
      attempt_count: 2,
      claim_token: "805",
    },
  ];
  const repos = {
    jobs: {
      claim() {
        return claims.shift() || null;
      },
      heartbeat(jobId, workerId, claimToken) {
        if (claimToken === "804") {
          return new Promise((resolve) => {
            resolveOldHeartbeat = resolve;
          });
        }
        return true;
      },
      complete() {},
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async first(job, ctx) {
        firstContext = ctx;
        await firstGate;
      },
      async second(job, ctx) {
        secondContext = ctx;
        await secondGate;
      },
    },
    reposProvider: () => repos,
    leaseMs: 500,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const firstTick = runner._tick();
  while (!firstContext) await new Promise((resolve) => setImmediate(resolve));
  const staleHeartbeat = runner._heartbeat();
  while (!resolveOldHeartbeat) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  releaseFirst();
  await firstTick;

  const secondTick = runner._tick();
  while (!secondContext) await new Promise((resolve) => setImmediate(resolve));
  resolveOldHeartbeat(false);
  const staleResult = await staleHeartbeat;

  assert.equal(staleResult, false);
  assert.equal(secondContext.signal.aborted, false);
  assert.equal(secondContext.assertLeaseHealthy(), true);

  releaseSecond();
  await secondTick;
});

test("the claimed row's shorter server lease bounds local authority", async () => {
  let releaseHandler;
  let handlerContext;
  let sideEffectRan = false;
  let claimed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const claimedAt = new Date();
  const leaseUntil = new Date(claimedAt.getTime() + 60);
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 85,
          kind: "guarded",
          attempt_count: 1,
          claim_token: "806",
          claimed_at: claimedAt.toISOString(),
          lease_until: leaseUntil.toISOString(),
        };
      },
      complete() {
        throw new Error("completion_must_not_run");
      },
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async guarded(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
        ctx.assertLeaseHealthy();
        sideEffectRan = true;
      },
    },
    reposProvider: () => repos,
    leaseMs: 500,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  await delay(100);
  releaseHandler();
  await tick;

  assert.equal(sideEffectRan, false);
  assert.equal(handlerContext.signal.aborted, true);
});

test("an event-loop stall cannot outrun the local lease assertion", async () => {
  let handlerContext;
  let sideEffectRan = false;
  let claimed = false;
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 86,
          kind: "stalled",
          attempt_count: 1,
          claim_token: "807",
        };
      },
      complete() {
        throw new Error("completion_must_not_run");
      },
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async stalled(job, ctx) {
        handlerContext = ctx;
        const stalledUntil = Date.now() + 80;
        while (Date.now() < stalledUntil) {
          // Deliberately block timers to model a saturated event loop.
        }
        ctx.assertLeaseHealthy();
        sideEffectRan = true;
      },
    },
    reposProvider: () => repos,
    leaseMs: 40,
    heartbeatMs: 1_000,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  await runner._tick();

  assert.ok(handlerContext);
  assert.equal(sideEffectRan, false);
  assert.equal(handlerContext.signal.aborted, true);
});

test("JobsRunner uses one lease duration for claim and heartbeat", async () => {
  let releaseHandler;
  let handlerContext;
  let claimOptions;
  let heartbeatLeaseMs;
  let claimed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const repos = {
    jobs: {
      claim(workerId, options) {
        claimOptions = options;
        if (claimed) return null;
        claimed = true;
        return {
          id: 87,
          kind: "guarded",
          attempt_count: 1,
          claim_token: "808",
        };
      },
      heartbeat(jobId, workerId, claimToken, leaseMs) {
        heartbeatLeaseMs = leaseMs;
        return true;
      },
      complete() {},
      fail() {
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async guarded(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
      },
    },
    reposProvider: () => repos,
    leaseMs: 400,
    heartbeatMs: 50,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runner._heartbeat(), true);
  releaseHandler();
  await tick;

  assert.equal(claimOptions.leaseMs, 400);
  assert.equal(heartbeatLeaseMs, 400);
});

test("JobsRunner refreshes its worker registry row while idle", async () => {
  const heartbeats = [];
  const runner = new JobsRunner({
    workerId: "worker-idle",
    handlers: {},
    reposProvider: () => ({
      jobs: {},
      workers: {
        heartbeat(workerId, details) {
          heartbeats.push({ workerId, details });
        },
      },
    }),
    log() {},
  });
  runner.running = true;
  runner.current = null;

  assert.equal(await runner._heartbeat(), true);
  assert.deepEqual(heartbeats, [
    { workerId: "worker-idle", details: { status: "idle" } },
  ]);
});
