"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Worker } = require("node:worker_threads");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { bind } = require("../../lib/repositories/jobs");

function memoryFixture() {
  const db = new Database(":memory:");
  runMigrations(db, { log() {}, env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" } });
  return { db, jobs: bind(db) };
}

test("exactly one worker can claim a pending job", () => {
  const { db, jobs } = memoryFixture();
  const queued = jobs.enqueue({
    kind: "hunt",
    payload: { window: "morning" },
    idempotency_key: "hunt:2026-07-27:morning",
  });
  const first = jobs.claim("worker-a");
  const second = jobs.claim("worker-b");
  assert.equal(first.id, queued.id);
  assert.equal(first.claimed_by, "worker-a");
  assert.equal(second, null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM job_runs").get().count,
    1,
  );
  db.close();
});

test("claim and run-record creation roll back together", () => {
  const { db, jobs } = memoryFixture();
  const queued = jobs.enqueue({
    kind: "hunt",
    idempotency_key: "hunt:rollback",
  });
  db.exec("DROP TABLE job_runs");
  assert.throws(() => jobs.claim("worker-a"), /no such table: job_runs/);
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(queued.id);
  assert.equal(row.status, "pending");
  assert.equal(row.claimed_by, null);
  assert.equal(row.attempt_count, 0);
  db.close();
});

test("worker identity and lease duration are mandatory", () => {
  const { db, jobs } = memoryFixture();
  jobs.enqueue({ kind: "hunt", idempotency_key: "hunt:validation" });
  assert.throws(() => jobs.claim(" "), /job_worker_id_required/);
  assert.throws(
    () => jobs.claim("worker-a", { leaseMs: 0 }),
    /positive_job_lease_duration_required/,
  );
  assert.throws(
    () => jobs.claim("worker-a", { leaseMs: 10 * 365 * 24 * 60 * 60 * 1000 }),
    /job_lease_duration_exceeds_limit/,
  );
  db.close();
});

test("claim exclusion persists across independent database connections", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-job-claim-"));
  const filename = path.join(directory, "jobs.db");
  const firstDb = new Database(filename);
  runMigrations(firstDb, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  const secondDb = new Database(filename);
  const first = bind(firstDb);
  const second = bind(secondDb);
  first.enqueue({ kind: "hunt", idempotency_key: "hunt:cross-connection" });
  assert.ok(first.claim("worker-a"));
  assert.equal(second.claim("worker-b"), null);
  firstDb.close();
  secondDb.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("simultaneous process-style claims yield one owner without lock errors", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-job-race-"));
  const filename = path.join(directory, "jobs.db");
  const setup = new Database(filename);
  runMigrations(setup, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  bind(setup).enqueue({
    kind: "hunt",
    idempotency_key: "hunt:simultaneous-race",
  });
  setup.close();

  const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const Database = require(workerData.databaseModule);
    const { bind } = require(workerData.jobsModule);
    const db = new Database(workerData.filename);
    const jobs = bind(db);
    const start = new Int32Array(workerData.start);
    parentPort.postMessage({ ready: true });
    Atomics.wait(start, 0, 0);
    try {
      const claimed = jobs.claim(workerData.workerId);
      parentPort.postMessage({
        claimed: claimed ? claimed.id : null,
        token: claimed ? claimed.claim_token : null,
      });
    } catch (error) {
      parentPort.postMessage({ error: error.message });
    } finally {
      db.close();
    }
  `;
  const inputs = ["worker-a", "worker-b"].map(
    (workerId) =>
      new Worker(workerSource, {
        eval: true,
        workerData: {
          filename,
          workerId,
          start,
          databaseModule: require.resolve("better-sqlite3"),
          jobsModule: require.resolve("../../lib/repositories/jobs"),
        },
      }),
  );
  const results = [];
  let ready = 0;
  await new Promise((resolve, reject) => {
    for (const worker of inputs) {
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (message.ready) {
          ready += 1;
          if (ready === inputs.length) {
            Atomics.store(new Int32Array(start), 0, 1);
            Atomics.notify(new Int32Array(start), 0, inputs.length);
          }
          return;
        }
        results.push(message);
        if (results.length === inputs.length) resolve();
      });
    }
  });
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => result.claimed === null).length, 1);
  assert.deepEqual(
    results.filter((result) => result.error),
    [],
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("enqueue idempotency keys reuse exact work and reject changed work", () => {
  const { db, jobs } = memoryFixture();
  const original = jobs.enqueue({
    kind: "publish",
    payload: { platform: "youtube", variant: "short" },
    priority: 10,
    max_attempts: 2,
    requires_gpu: false,
    idempotency_key: "publish:story-idempotent:youtube",
  });
  const exactRetry = jobs.enqueue({
    kind: "publish",
    payload: { variant: "short", platform: "youtube" },
    priority: 10,
    max_attempts: 2,
    requires_gpu: false,
    idempotency_key: "publish:story-idempotent:youtube",
  });
  assert.equal(exactRetry.id, original.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 1);
  assert.throws(
    () =>
      jobs.enqueue({
        kind: "publish",
        payload: { platform: "instagram", variant: "reel" },
        priority: 10,
        max_attempts: 2,
        requires_gpu: false,
        idempotency_key: "publish:story-idempotent:youtube",
      }),
    /job_idempotency_conflict/,
  );
  db.close();
});

test("expired or superseded workers cannot heartbeat, complete or fail a job", () => {
  const { db, jobs } = memoryFixture();
  const queued = jobs.enqueue({
    kind: "publish",
    idempotency_key: "publish:fenced-owner",
  });
  const firstClaim = jobs.claim("worker-a");
  assert.equal(firstClaim.id, queued.id);
  assert.throws(
    () => jobs.complete(queued.id, "worker-b", firstClaim.claim_token),
    /job_lease_not_held/,
  );
  assert.throws(
    () =>
      jobs.fail(
        queued.id,
        "worker-b",
        firstClaim.claim_token,
        new Error("stale"),
      ),
    /job_lease_not_held/,
  );

  db.prepare(
    `UPDATE jobs
     SET lease_until = datetime('now', '-1 minute')
     WHERE id = ?`,
  ).run(queued.id);
  assert.equal(
    jobs.heartbeat(queued.id, "worker-a", firstClaim.claim_token),
    false,
  );
  assert.throws(
    () => jobs.complete(queued.id, "worker-a", firstClaim.claim_token),
    /job_lease_not_held/,
  );
  assert.throws(
    () =>
      jobs.fail(
        queued.id,
        "worker-a",
        firstClaim.claim_token,
        new Error("late"),
      ),
    /job_lease_not_held/,
  );

  assert.equal(jobs.reapStaleClaims(), 1);
  const reapedRun = db
    .prepare(
      `SELECT status, error_message, finished_at
       FROM job_runs
       WHERE job_id = ? AND worker_id = ?`,
    )
    .get(queued.id, "worker-a");
  assert.equal(reapedRun.status, "failed");
  assert.equal(reapedRun.error_message, "job_lease_expired_and_reaped");
  assert.ok(reapedRun.finished_at);
  const secondClaim = jobs.claim("worker-b");
  assert.equal(secondClaim.claimed_by, "worker-b");
  assert.throws(
    () => jobs.complete(queued.id, "worker-a", firstClaim.claim_token),
    /job_lease_not_held/,
  );
  assert.throws(
    () =>
      jobs.fail(
        queued.id,
        "worker-a",
        firstClaim.claim_token,
        new Error("superseded"),
      ),
    /job_lease_not_held/,
  );
  const completed = jobs.complete(
    queued.id,
    "worker-b",
    secondClaim.claim_token,
  );
  assert.equal(completed.status, "done");
  assert.equal(jobs.get(queued.id).status, "done");
  db.close();
});

test("a lease expiry on the final allowed attempt is terminal and cannot be reclaimed", () => {
  const { db, jobs } = memoryFixture();
  const queued = jobs.enqueue({
    kind: "publish",
    max_attempts: 1,
    idempotency_key: "publish:final-expired-attempt",
  });
  const claim = jobs.claim("worker-final");
  assert.equal(claim.id, queued.id);
  assert.equal(claim.attempt_count, 1);
  db.prepare(
    `UPDATE jobs
     SET lease_until = datetime('now', '-1 minute')
     WHERE id = ?`,
  ).run(queued.id);

  assert.equal(jobs.reapStaleClaims(), 1);
  const terminal = jobs.get(queued.id);
  assert.equal(terminal.status, "failed");
  assert.ok(terminal.completed_at);
  assert.equal(jobs.claim("worker-unsafe-retry"), null);
  const run = db
    .prepare(
      `SELECT status, error_message, finished_at
       FROM job_runs
       WHERE id = ?`,
    )
    .get(claim.claim_token);
  assert.equal(run.status, "failed");
  assert.equal(run.error_message, "job_lease_expired_and_reaped");
  assert.ok(run.finished_at);
  db.close();
});

test("claim token fences a stale generation even when worker identity is reused", () => {
  const { db, jobs } = memoryFixture();
  const queued = jobs.enqueue({
    kind: "publish",
    idempotency_key: "publish:claim-generation",
  });
  const first = jobs.claim("same-worker");
  assert.match(first.claim_token, /^\d+$/);
  db.prepare(
    `UPDATE jobs
     SET lease_until = datetime('now', '-1 minute')
     WHERE id = ?`,
  ).run(queued.id);
  assert.equal(jobs.reapStaleClaims(), 1);
  const second = jobs.claim("same-worker");
  assert.notEqual(second.claim_token, first.claim_token);
  assert.throws(
    () => jobs.complete(queued.id, "same-worker", first.claim_token),
    /job_lease_not_held/,
  );
  const completed = jobs.complete(
    queued.id,
    "same-worker",
    second.claim_token,
  );
  assert.equal(completed.status, "done");
  db.close();
});
