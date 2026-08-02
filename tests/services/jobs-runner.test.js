"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { JobsRunner } = require("../../lib/services/jobs-runner");

const TRUSTED_RUNTIME_AUTHORITY = {
  runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
  child_pid: process.pid,
  child_started_at: "2026-08-02T10:00:00.000Z",
  authority_fingerprint: "a".repeat(64),
};

function claimedJobFixture({
  jobKind = "dispatch_governed_publication",
  storyId = "runner-story",
  channelId = "pulse-gaming",
} = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      channel_id TEXT,
      story_id TEXT,
      payload TEXT NOT NULL,
      run_at TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      claimed_by TEXT NOT NULL,
      lease_until TEXT,
      idempotency_key TEXT NOT NULL
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      finished_at TEXT
    );
  `);
  const workerId =
    "server-ri-11111111-2222-4333-8444-555555555555-critical_publication-1";
  const payload = {
    ...(storyId ? { story_id: storyId } : {}),
    ...(jobKind === "prepare_governed_autonomous_pre_t90_window"
      ? {
          scheduled_for: "2026-08-03T09:00:00.000Z",
          publish_hour_utc: 9,
        }
      : {}),
    runtimeAuthority: { authority_fingerprint: "f".repeat(64) },
    claimedJobAuthority: { claimed_job_authority_sha256: "e".repeat(64) },
  };
  const job = {
    id: 71,
    kind: jobKind,
    channel_id: channelId,
    story_id: storyId,
    payload,
    run_at: "2026-08-02 18:55:00",
    status: "claimed",
    attempt_count: 1,
    claimed_by: workerId,
    claimed_at: new Date().toISOString(),
    lease_until: new Date(Date.now() + 120_000).toISOString(),
    idempotency_key: "dispatch:runner-story:2026-08-02T19:00:00.000Z",
    claim_token: "101",
  };
  db.prepare(
    `INSERT INTO jobs
       (id, kind, channel_id, story_id, payload, run_at, status,
        attempt_count, claimed_by, lease_until, idempotency_key)
     VALUES
       (@id, @kind, @channel_id, @story_id, @payload, @run_at, @status,
        @attempt_count, @claimed_by, @lease_until, @idempotency_key)`,
  ).run({ ...job, payload: JSON.stringify(payload) });
  db.prepare(
    `INSERT INTO job_runs
       (id, job_id, worker_id, attempt, status, finished_at)
     VALUES (101, @id, @claimed_by, @attempt_count, 'running', NULL)`,
  ).run(job);
  return { db, job, workerId };
}

test("runner supplies frozen bootstrap runtime and exact repository-backed claimed-job authority", async (t) => {
  const { db, job, workerId } = claimedJobFixture();
  t.after(() => db.close());
  let claimed = false;
  let handlerContext = null;
  const jobs = {
    claim() {
      if (claimed) return null;
      claimed = true;
      return structuredClone(job);
    },
    complete() {
      return true;
    },
    fail() {
      throw new Error("runner_handler_must_not_fail");
    },
  };
  const workers = {
    register() {},
    heartbeat() {},
  };
  const runner = new JobsRunner({
    workerId,
    handlers: {
      async dispatch_governed_publication(_job, ctx) {
        handlerContext = ctx;
        return { held: true };
      },
    },
    runtimeAuthority: TRUSTED_RUNTIME_AUTHORITY,
    reposProvider: () => ({ db, jobs, workers }),
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};
  await runner._tick();
  assert.ok(handlerContext);
  assert.equal(typeof handlerContext.runtimeAuthority, "object");
  assert.equal(Object.isFrozen(handlerContext.runtimeAuthority), true);
  assert.deepEqual(handlerContext.runtimeAuthority, TRUSTED_RUNTIME_AUTHORITY);
  assert.notDeepEqual(
    handlerContext.runtimeAuthority,
    job.payload.runtimeAuthority,
  );
  assert.equal(typeof handlerContext.claimedJobAuthority, "object");
  assert.equal(Object.isFrozen(handlerContext.claimedJobAuthority), true);
  assert.match(
    handlerContext.claimedJobAuthority.claimed_job_authority_sha256,
    /^[a-f0-9]{64}$/,
  );
  const serialised = JSON.stringify(handlerContext.claimedJobAuthority);
  assert.equal(serialised.includes(job.claim_token), false);
  assert.equal(serialised.includes(job.idempotency_key), false);
  assert.equal(typeof handlerContext.assertClaimedJobAuthority, "function");
  assert.equal(handlerContext.assertClaimedJobAuthority(), true);
  db.prepare("UPDATE jobs SET story_id = 'drifted-story' WHERE id = ?").run(
    job.id,
  );
  assert.throws(
    () => handlerContext.assertClaimedJobAuthority(),
    /publisher_claimed_job_authority_invalid/,
  );
});

test("runner supplies exact claimed-job authority to each pre-admission job kind", async (t) => {
  for (const jobKind of [
    "prepare_governed_autonomous_pre_t90_window",
    "admit_governed_publication",
    "prestage_governed_youtube_release",
    "governed_youtube_runway_t60",
  ]) {
    const windowScoped =
      jobKind === "prepare_governed_autonomous_pre_t90_window";
    const { db, job, workerId } = claimedJobFixture({
      jobKind,
      ...(windowScoped
        ? { channelId: null, storyId: null }
        : {}),
    });
    t.after(() => db.close());
    let claimed = false;
    let handlerContext = null;
    const runner = new JobsRunner({
      workerId,
      handlers: {
        [jobKind]: async (_job, ctx) => {
          handlerContext = ctx;
          return { held: true };
        },
      },
      runtimeAuthority: TRUSTED_RUNTIME_AUTHORITY,
      reposProvider: () => ({
        db,
        jobs: {
          claim() {
            if (claimed) return null;
            claimed = true;
            return structuredClone(job);
          },
          complete() {
            return true;
          },
          fail() {
            throw new Error("pre_admission_job_must_not_fail");
          },
        },
        workers: { register() {}, heartbeat() {} },
      }),
      log() {},
    });
    runner.running = true;
    runner._schedule = () => {};

    await runner._tick();

    assert.ok(handlerContext, jobKind);
    assert.match(
      handlerContext.claimedJobAuthority?.claimed_job_authority_sha256 || "",
      /^[a-f0-9]{64}$/,
      jobKind,
    );
    assert.equal(
      handlerContext.claimedJobAuthority.channel_id,
      windowScoped ? null : "pulse-gaming",
      jobKind,
    );
    assert.equal(
      handlerContext.claimedJobAuthority.story_id,
      windowScoped ? null : "runner-story",
      jobKind,
    );
    assert.equal(handlerContext.assertClaimedJobAuthority(), true, jobKind);
  }
});

test("trusted runtime executes null-story non-publication work without publisher claim authority", async (t) => {
  const { db, job, workerId } = claimedJobFixture({
    jobKind: "hunt",
    storyId: null,
  });
  t.after(() => db.close());
  let claimed = false;
  let completed = false;
  let handlerContext = null;
  const jobs = {
    claim() {
      if (claimed) return null;
      claimed = true;
      return structuredClone(job);
    },
    complete() {
      completed = true;
      return true;
    },
    fail() {
      throw new Error("ordinary_runtime_job_must_not_fail");
    },
  };
  const runner = new JobsRunner({
    workerId,
    handlers: {
      async hunt(_job, ctx) {
        handlerContext = ctx;
        return { hunted: true };
      },
    },
    runtimeAuthority: TRUSTED_RUNTIME_AUTHORITY,
    reposProvider: () => ({
      db,
      jobs,
      workers: { register() {}, heartbeat() {} },
    }),
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};

  await runner._tick();

  assert.equal(completed, true);
  assert.ok(handlerContext);
  assert.deepEqual(handlerContext.runtimeAuthority, TRUSTED_RUNTIME_AUTHORITY);
  assert.equal(handlerContext.claimedJobAuthority, null);
  assert.equal(handlerContext.assertClaimedJobAuthority, null);
});
