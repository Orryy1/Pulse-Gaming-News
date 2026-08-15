"use strict";

const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("node:test");

const { build } = require("../../lib/api/jobs-router");
const { JobsRunner } = require("../../lib/services/jobs-runner");
const { LocalWorker } = require("../../workers/local-worker");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function post(server, pathname, body) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      authorization: "Bearer worker-test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("JobsRunner supplies its worker identity on complete and fail", async () => {
  const calls = [];
  let claims = 0;
  const repos = {
    jobs: {
      claim() {
        claims += 1;
        return claims === 1
          ? { id: 41, kind: "ok", attempt_count: 1, claim_token: "401" }
          : {
              id: 42,
              kind: "broken",
              attempt_count: 1,
              claim_token: "402",
            };
      },
      complete(...args) {
        calls.push(["complete", ...args]);
        return { status: "done" };
      },
      fail(...args) {
        calls.push(["fail", ...args]);
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
      async ok() {
        return { ok: true };
      },
      async broken() {
        throw new Error("handler_failed");
      },
    },
    reposProvider: () => repos,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  await runner._tick();
  await runner._tick();

  assert.equal(calls[0][0], "complete");
  assert.equal(calls[0][1], 41);
  assert.equal(calls[0][2], "worker-a");
  assert.equal(calls[0][3], "401");
  assert.equal(calls[1][0], "fail");
  assert.equal(calls[1][1], 42);
  assert.equal(calls[1][2], "worker-a");
  assert.equal(calls[1][3], "402");
  assert.match(calls[1][4].message, /handler_failed/);
});

test("JobsRunner aborts cooperative work and never completes after lease loss", async () => {
  let releaseHandler;
  let handlerContext;
  let completed = false;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const repos = {
    jobs: {
      claim() {
        return {
          id: 51,
          kind: "guarded",
          attempt_count: 1,
          claim_token: "501",
        };
      },
      heartbeat() {
        return false;
      },
      complete() {
        completed = true;
      },
      fail() {
        throw new Error("job_lease_not_held");
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
      },
    },
    reposProvider: () => repos,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  const tick = runner._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  runner._heartbeat();
  releaseHandler();
  await tick;

  assert.equal(handlerContext.signal.aborted, true);
  assert.throws(() => handlerContext.assertLeaseHealthy(), /job_lease_lost/);
  assert.equal(completed, false);
});

test("JobsRunner stop drains an active cooperative handler", async () => {
  let started = false;
  let finished = false;
  const repos = {
    jobs: {
      claim() {
        return {
          id: 52,
          kind: "drain",
          attempt_count: 1,
          claim_token: "502",
        };
      },
      complete() {
        throw new Error("completion_must_not_run_after_stop");
      },
      fail() {
        throw new Error("job_lease_not_held");
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "worker-a",
    handlers: {
      async drain(job, ctx) {
        started = true;
        await new Promise((resolve) => {
          ctx.signal.addEventListener("abort", resolve, { once: true });
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        finished = true;
        ctx.assertLeaseHealthy();
      },
    },
    reposProvider: () => repos,
    log() {},
    drainTimeoutMs: 500,
  });
  runner.running = true;
  runner._schedule = () => {};
  const tick = runner._tick();
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  const stopped = await runner.stop();
  await tick;

  assert.equal(stopped.drained, true);
  assert.equal(finished, true);
  assert.equal(runner.current, null);
});

test("remote complete/fail require and forward fenced ownership", async (t) => {
  const previousToken = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = "worker-test-token";
  t.after(() => {
    if (previousToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = previousToken;
  });

  const calls = [];
  const repos = {
    jobs: {
      get(id) {
        return { id, claimed_by: "worker-a" };
      },
      complete(...args) {
        calls.push(["complete", ...args]);
        return { status: "done" };
      },
      fail(...args) {
        calls.push(["fail", ...args]);
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const app = express();
  app.use("/api", build({ getRepos: () => repos, log() {} }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const missing = await post(server, "/api/jobs/7/complete", {});
  assert.equal(missing.status, 400);

  const completed = await post(server, "/api/jobs/7/complete", {
    worker_id: "worker-a",
    claim_token: "701",
    result: { ok: true },
  });
  assert.equal(completed.status, 200);
  const failed = await post(server, "/api/jobs/8/fail", {
    worker_id: "worker-a",
    claim_token: "801",
    error: "failed safely",
  });
  assert.equal(failed.status, 200);

  assert.equal(calls[0][0], "complete");
  assert.equal(calls[0][1], 7);
  assert.equal(calls[0][2], "worker-a");
  assert.equal(calls[0][3], "701");
  assert.equal(calls[1][0], "fail");
  assert.equal(calls[1][1], 8);
  assert.equal(calls[1][2], "worker-a");
  assert.equal(calls[1][3], "801");
  assert.match(calls[1][4].message, /failed safely/);
});

test("remote stale-owner completion is a retryable conflict", async (t) => {
  const previousToken = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = "worker-test-token";
  t.after(() => {
    if (previousToken === undefined) delete process.env.WORKER_TOKEN;
    else process.env.WORKER_TOKEN = previousToken;
  });
  const repos = {
    jobs: {
      get(id) {
        return { id, claimed_by: "worker-b" };
      },
      complete() {
        throw new Error("job_lease_not_held");
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const app = express();
  app.use("/api", build({ getRepos: () => repos, log() {} }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await post(server, "/api/jobs/9/complete", {
    worker_id: "worker-a",
    claim_token: "901",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "job_lease_not_held" });
});

test("LocalWorker forwards claim tokens on completion, failure and heartbeat", async () => {
  const calls = [];
  const claims = [
    { id: 61, kind: "ok", claim_token: "601" },
    { id: 62, kind: "broken", claim_token: "602" },
  ];
  const worker = new LocalWorker({
    cloudUrl: "https://worker.invalid",
    workerId: "local-a",
    handlerMap: {
      async ok() {
        return { ok: true };
      },
      async broken() {
        throw new Error("broken");
      },
    },
    log() {},
  });
  worker.running = true;
  worker._schedule = () => {};
  worker._fetch = async (pathname, options = {}) => {
    calls.push([pathname, options]);
    if (pathname === "/api/jobs/claim") {
      return { job: claims.shift() || null };
    }
    return { ok: true };
  };

  await worker._tick();
  await worker._tick();
  worker.current = { id: 63, claim_token: "603" };
  await worker._heartbeat();

  const complete = calls.find(([pathname]) =>
    pathname.endsWith("/61/complete"),
  );
  const fail = calls.find(([pathname]) => pathname.endsWith("/62/fail"));
  const heartbeat = calls.find(([pathname]) =>
    pathname.endsWith("/63/heartbeat"),
  );
  assert.equal(complete[1].body.claim_token, "601");
  assert.equal(fail[1].body.claim_token, "602");
  assert.equal(heartbeat[1].body.claim_token, "603");
});

test("LocalWorker ignores a delayed heartbeat rejection from an older claim generation", async () => {
  let releaseFirst;
  let releaseSecond;
  let rejectFirstHeartbeat;
  let firstContext;
  let secondContext;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  const claims = [
    { id: 71, kind: "first", claim_token: "701" },
    { id: 72, kind: "second", claim_token: "702" },
  ];
  const worker = new LocalWorker({
    cloudUrl: "https://worker.invalid",
    workerId: "local-a",
    handlerMap: {
      async first(job, ctx) {
        firstContext = ctx;
        await firstGate;
      },
      async second(job, ctx) {
        secondContext = ctx;
        await secondGate;
      },
    },
    log() {},
  });
  worker.running = true;
  worker._schedule = () => {};
  worker._fetch = async (pathname) => {
    if (pathname === "/api/jobs/claim") {
      return { job: claims.shift() || null };
    }
    if (pathname === "/api/jobs/71/heartbeat") {
      return new Promise((resolve, reject) => {
        rejectFirstHeartbeat = reject;
      });
    }
    return { ok: true };
  };

  const firstTick = worker._tick();
  while (!firstContext) await new Promise((resolve) => setImmediate(resolve));
  const oldHeartbeat = worker._heartbeat();
  while (!rejectFirstHeartbeat) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  releaseFirst();
  await firstTick;
  const secondTick = worker._tick();
  while (!secondContext) await new Promise((resolve) => setImmediate(resolve));

  const staleConflict = new Error("old claim no longer owns the lease");
  staleConflict.status = 409;
  rejectFirstHeartbeat(staleConflict);
  await oldHeartbeat;

  const secondLeaseHealthy = worker._currentLeaseHealthy;
  const secondSignalAborted = secondContext.signal.aborted;
  releaseSecond();
  await secondTick;

  assert.equal(secondLeaseHealthy, true);
  assert.equal(secondSignalAborted, false);
});

test("LocalWorker fails closed when heartbeat failures outlast the server lease", async () => {
  let releaseHandler;
  let handlerContext;
  const handlerGate = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const claimedAt = new Date();
  const leaseUntil = new Date(claimedAt.getTime() + 50);
  let claimReturned = false;
  const worker = new LocalWorker({
    cloudUrl: "https://worker.invalid",
    workerId: "local-a",
    handlerMap: {
      async guarded(job, ctx) {
        handlerContext = ctx;
        await handlerGate;
      },
    },
    log() {},
  });
  worker.running = true;
  worker._schedule = () => {};
  worker._fetch = async (pathname) => {
    if (pathname === "/api/jobs/claim" && !claimReturned) {
      claimReturned = true;
      return {
        job: {
          id: 73,
          kind: "guarded",
          claim_token: "703",
          claimed_at: claimedAt.toISOString(),
          lease_until: leaseUntil.toISOString(),
        },
      };
    }
    if (pathname === "/api/workers/heartbeat") return { ok: true };
    if (pathname === "/api/jobs/73/heartbeat") {
      throw new Error("heartbeat network unavailable");
    }
    return { ok: true };
  };

  const tick = worker._tick();
  while (!handlerContext) await new Promise((resolve) => setImmediate(resolve));
  await worker._heartbeat();
  assert.equal(handlerContext.signal.aborted, false);

  const abortedBeforeTimeout = await Promise.race([
    new Promise((resolve) => {
      handlerContext.signal.addEventListener("abort", () => resolve(true), {
        once: true,
      });
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), 150)),
  ]);
  releaseHandler();
  await tick;

  assert.equal(abortedBeforeTimeout, true);
  assert.throws(() => handlerContext.assertLeaseHealthy(), /job_lease_lost/);
});

test("JobsRunner exposes the persisted fencing identity to handlers", async () => {
  let handlerContext = null;
  let claimed = false;
  const repos = {
    jobs: {
      claim() {
        if (claimed) return null;
        claimed = true;
        return {
          id: 99,
          kind: "inspect-fence",
          attempt_count: 3,
          claim_token: "909",
          claim_generation: 7,
        };
      },
      heartbeat(id, workerId, claimToken) {
        assert.equal(id, 99);
        assert.equal(workerId, "worker-fenced");
        assert.equal(claimToken, "909");
        return true;
      },
      complete() {
        return { status: "done" };
      },
      fail() {
        throw new Error("failure_must_not_run");
      },
    },
    workers: { heartbeat() {} },
  };
  const runner = new JobsRunner({
    workerId: "worker-fenced",
    leaseMs: 60000,
    handlers: {
      async "inspect-fence"(_job, context) {
        handlerContext = context;
        assert.equal(context.claimToken, "909");
        assert.equal(context.claimGeneration, 7);
        assert.equal(context.attempt, 3);
        assert.match(context.deadlineAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.equal(context.leaseDeadline, context.deadlineAt);
        assert.equal(context.assertLeaseActive(), true);
        assert.equal(await context.heartbeatNow(), true);
        assert.equal(context.signal.aborted, false);
        return { ok: true };
      },
    },
    reposProvider: () => repos,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};
  await runner._tick();
  assert.ok(handlerContext);
  assert.equal(runner.current, null);
});
