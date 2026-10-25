"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");
const boundedAuthority = require("../../lib/stabilisation/bounded-runtime-db-authority");

const RUNTIME_AUTHORITY = Object.freeze({
  runtime_instance_id: "ri-33333333-4444-4555-8666-777777777777",
  child_pid: process.pid,
  child_started_at: "2026-08-02T10:00:00.000Z",
  authority_fingerprint: "a".repeat(64),
});

const OPERATION_JOB_PAIRS = Object.freeze([
  [
    "governed_autonomous_pre_t90_window_preparation",
    "prepare_governed_autonomous_pre_t90_window",
  ],
  ["autonomous_t75_jit_admission", "admit_governed_publication"],
  [
    "promote_governed_youtube_reserve_release",
    "prestage_governed_youtube_release",
  ],
  [
    "promote_confirmed_disarm_youtube_reserve_release",
    "governed_youtube_runway_t60",
  ],
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function service() {
  return require("../../lib/services/publication-admission-lock");
}

function fixture({
  jobKind = "admit_governed_publication",
  operation = "autonomous_t75_jit_admission",
  attemptCount = 1,
  ownerId = "publication-admission-private-owner",
  channelId = "pulse-gaming",
  storyId = "task-3c-story",
} = {}) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
    );
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
      claimed_at TEXT,
      lease_until TEXT,
      idempotency_key TEXT NOT NULL
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
  `);
  const leases = bind(db);
  const workerId = "server-ri-33333333-critical_publication-1";
  const job = {
    id: 701,
    kind: jobKind,
    channel_id: channelId,
    story_id: storyId,
    payload: JSON.stringify({
      scheduled_for: "2026-08-03T09:00:00.000Z",
      publish_hour_utc: 9,
      operation_from_payload_must_not_grant_authority: "publish_next_story",
    }),
    run_at: "2026-08-03T07:45:00.000Z",
    status: "claimed",
    attempt_count: attemptCount,
    claimed_by: workerId,
    claimed_at: null,
    lease_until: null,
    idempotency_key: `task-3c:${jobKind}:701`,
    claim_token: "1701",
  };
  db.prepare(
    `INSERT INTO jobs
       (id, kind, channel_id, story_id, payload, run_at, status,
        attempt_count, claimed_by, claimed_at, lease_until, idempotency_key)
     VALUES
       (@id, @kind, @channel_id, @story_id, @payload, @run_at, @status,
        @attempt_count, @claimed_by, datetime('now'),
        datetime('now', '+5 minutes'), @idempotency_key)`,
  ).run(job);
  db.prepare(
    `INSERT INTO job_runs
       (id, job_id, worker_id, attempt, status, started_at, finished_at)
     VALUES (?, ?, ?, ?, 'running', datetime('now'), NULL)`,
  ).run(Number(job.claim_token), job.id, workerId, attemptCount);
  const scheduler = leases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-private-owner",
    now: new Date(),
    leaseMs: 90_000,
    metadata: {
      purpose: "single_owner_scheduler_dispatch",
      ...boundedAuthority.buildRuntimeGenerationLeaseMetadata(
        RUNTIME_AUTHORITY,
      ),
    },
    replaceSameOwner: false,
  });
  assert.equal(scheduler.acquired, true);
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId,
    claimToken: job.claim_token,
  });
  return {
    db,
    leases,
    job,
    ownerId,
    operation,
    claimedJobAuthority,
  };
}

function acquire(state, overrides = {}) {
  return service().acquirePublicationAdmissionLease({
    db: state.db,
    leases: state.leases,
    ownerId: state.ownerId,
    operation: state.operation,
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority: state.claimedJobAuthority,
    leaseMs: 90_000,
    ...overrides,
  });
}

test("publication admission authority accepts only the closed operation-to-job map", (t) => {
  for (const [operation, jobKind] of OPERATION_JOB_PAIRS) {
    const state = fixture({
      operation,
      jobKind,
      ...(jobKind === "prepare_governed_autonomous_pre_t90_window"
        ? { channelId: null, storyId: null }
        : {}),
    });
    t.after(() => state.db.close());
    const lease = acquire(state);
    assert.equal(lease.acquired, true, `${operation} -> ${jobKind}`);
    assert.equal(
      lease.claimed_job_authority_sha256,
      state.claimedJobAuthority.claimed_job_authority_sha256,
    );
  }

  for (const [operation, jobKind] of [
    ["autonomous_t75_jit_admission", "prestage_governed_youtube_release"],
    ["publish_next_story", "admit_governed_publication"],
    ["autonomous_t75_jit_admission", "dispatch_governed_publication"],
  ]) {
    const state = fixture({ operation, jobKind });
    t.after(() => state.db.close());
    assert.throws(
      () => acquire(state),
      /publication_admission_claimed_job_authority_invalid/,
      `${operation} must not be authorised by ${jobKind}`,
    );
    assert.equal(
      state.leases.get("publication-admission:global"),
      null,
    );
  }
});

test("the production-shaped pre-T90 window claim is exact without inventing a candidate story", (t) => {
  const state = fixture({
    jobKind: "prepare_governed_autonomous_pre_t90_window",
    operation: "governed_autonomous_pre_t90_window_preparation",
    channelId: null,
    storyId: null,
  });
  t.after(() => state.db.close());

  const lease = acquire(state);
  const row = state.leases.get("publication-admission:global");
  const metadata = JSON.parse(row.metadata);

  assert.equal(lease.acquired, true);
  assert.equal(
    state.claimedJobAuthority.job_kind,
    "prepare_governed_autonomous_pre_t90_window",
  );
  assert.equal(state.claimedJobAuthority.channel_id, null);
  assert.equal(state.claimedJobAuthority.story_id, null);
  assert.equal(metadata.claim_scope, "WINDOW");
  assert.equal(
    metadata.job_kind,
    "prepare_governed_autonomous_pre_t90_window",
  );
  assert.equal(metadata.channel_id, null);
  assert.equal(metadata.story_id, null);
});

test("WINDOW and STORY claimed-authority scopes cannot substitute for each other", (t) => {
  const windowState = fixture({
    jobKind: "prepare_governed_autonomous_pre_t90_window",
    operation: "governed_autonomous_pre_t90_window_preparation",
    channelId: null,
    storyId: null,
  });
  t.after(() => windowState.db.close());
  windowState.db
    .prepare(
      "UPDATE jobs SET channel_id = 'pulse-gaming', story_id = 'invented' WHERE id = ?",
    )
    .run(windowState.job.id);
  assert.throws(
    () => acquire(windowState),
    /publication_admission_claimed_job_authority_invalid/,
  );

  const storyState = fixture();
  t.after(() => storyState.db.close());
  storyState.db
    .prepare(
      "UPDATE jobs SET channel_id = NULL, story_id = NULL WHERE id = ?",
    )
    .run(storyState.job.id);
  assert.throws(
    () => acquire(storyState),
    /publication_admission_claimed_job_authority_invalid/,
  );
});

test("a WINDOW claim binds the canonical full payload and window identity", (t) => {
  const state = fixture({
    jobKind: "prepare_governed_autonomous_pre_t90_window",
    operation: "governed_autonomous_pre_t90_window_preparation",
    channelId: null,
    storyId: null,
  });
  t.after(() => state.db.close());
  state.db
    .prepare(
      `UPDATE jobs
       SET payload = json_set(payload, '$.publish_hour_utc', 10)
       WHERE id = ?`,
    )
    .run(state.job.id);

  assert.throws(
    () => acquire(state),
    /publication_admission_claimed_job_authority_invalid/,
  );
});

test("payload-selected operations never grant publication admission authority", (t) => {
  const state = fixture({
    jobKind: "governed_youtube_runway_t60",
    operation: "promote_governed_youtube_reserve_release",
  });
  t.after(() => state.db.close());
  assert.throws(
    () => acquire(state),
    /publication_admission_claimed_job_authority_invalid/,
  );
});

test("stale or unbounded scheduler time evidence cannot mint admission authority", (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  state.db
    .prepare(
      `UPDATE runtime_leases
       SET acquired_at = '2020-01-01T00:00:00.000Z',
           heartbeat_at = '2020-01-01T00:00:01.000Z',
           expires_at = '2999-01-01T00:00:00.000Z'
       WHERE name = 'scheduler:primary'`,
    )
    .run();

  assert.throws(
    () => acquire(state),
    /publication_admission_runtime_generation_authority_invalid/,
  );
  assert.equal(state.leases.get("publication-admission:global"), null);
});

test("scheduler expiry span accepts exactly 90 seconds and rejects any excess", (t) => {
  const exact = fixture();
  t.after(() => exact.db.close());
  exact.db
    .prepare(
      `UPDATE runtime_leases
       SET acquired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           heartbeat_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 seconds')
       WHERE name = 'scheduler:primary'`,
    )
    .run();
  assert.equal(acquire(exact).acquired, true);

  const excess = fixture();
  t.after(() => excess.db.close());
  excess.db
    .prepare(
      `UPDATE runtime_leases
       SET acquired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           heartbeat_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90.001 seconds')
       WHERE name = 'scheduler:primary'`,
    )
    .run();
  assert.throws(
    () => acquire(excess),
    /publication_admission_runtime_generation_authority_invalid/,
  );
});

test("publication admission acquisition rejects every exact claimed-job drift", (t) => {
  const cases = [
    ["payload", `'{"story_id":"drifted"}'`],
    ["story_id", "'drifted-story'"],
    ["channel_id", "'stacked'"],
    ["run_at", "'2026-08-03T07:46:00.000Z'"],
    ["attempt_count", "attempt_count + 1"],
    ["idempotency_key", "'drifted-key'"],
  ];
  for (const [column, expression] of cases) {
    const state = fixture();
    t.after(() => state.db.close());
    state.db
      .prepare(`UPDATE jobs SET ${column} = ${expression} WHERE id = ?`)
      .run(state.job.id);
    assert.throws(
      () => acquire(state),
      /publication_admission_claimed_job_authority_invalid/,
      column,
    );
  }

  for (const mutate of [
    (state) =>
      state.db
        .prepare("UPDATE job_runs SET finished_at = datetime('now')")
        .run(),
    (state) =>
      state.db
        .prepare(
          `INSERT INTO job_runs
             (id, job_id, worker_id, attempt, status, started_at, finished_at)
           VALUES (1702, ?, ?, ?, 'running', datetime('now'), NULL)`,
        )
        .run(state.job.id, state.job.claimed_by, state.job.attempt_count),
  ]) {
    const state = fixture();
    t.after(() => state.db.close());
    mutate(state);
    assert.throws(
      () => acquire(state),
      /publication_admission_claimed_job_authority_invalid/,
    );
  }
});

test("SQLite time caps admission authority to the exact remaining job claim", (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  state.db
    .prepare(
      `UPDATE jobs
       SET lease_until = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 seconds')
       WHERE id = ?`,
    )
    .run(state.job.id);
  state.claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db: state.db,
    jobId: state.job.id,
    workerId: state.job.claimed_by,
    claimToken: state.job.claim_token,
  });
  const lease = acquire(state, {
    leaseMs: 90_000,
    now: new Date("2999-01-01T00:00:00.000Z"),
  });
  const row = state.leases.get("publication-admission:global");
  const jobLease = state.db
    .prepare("SELECT lease_until FROM jobs WHERE id = ?")
    .get(state.job.id).lease_until;
  assert.equal(lease.acquired, true);
  assert.ok(Date.parse(row.expires_at) <= Date.parse(jobLease));
  assert.ok(Date.parse(row.expires_at) > Date.now());

  service().releasePublicationAdmissionLease({
    leases: state.leases,
    lease,
  });
  state.db
    .prepare(
      `UPDATE jobs
       SET lease_until = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    )
    .run(state.job.id);
  assert.throws(
    () => acquire(state),
    /publication_admission_claimed_job_authority_invalid|publication_admission_claim_expired/,
  );
});

test("same-owner replacement, metadata drift and an old release all fail exact CAS", (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  const first = acquire(state);
  const competing = acquire(state);
  assert.equal(first.acquired, true);
  assert.equal(competing.acquired, false);
  assert.equal(
    competing.current_lock_owner_sha256,
    sha256(state.ownerId),
  );
  assert.equal(
    Object.values(competing).includes(state.ownerId),
    false,
  );

  state.db
    .prepare(
      `UPDATE runtime_leases
       SET metadata = json_set(metadata, '$.operation', 'tampered')
       WHERE name = 'publication-admission:global'`,
    )
    .run();
  assert.equal(
    service().heartbeatPublicationAdmissionLease({
      db: state.db,
      leases: state.leases,
      lease: first,
      leaseMs: 90_000,
    }),
    false,
  );
  assert.throws(
    () => first.assertHealthy(),
    /publication_admission_lease_lost/,
  );

  state.db
    .prepare(
      `UPDATE runtime_leases
       SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second')
       WHERE name = 'publication-admission:global'`,
    )
    .run();
  const successor = acquire(state);
  assert.equal(successor.acquired, true);
  assert.equal(
    service().releasePublicationAdmissionLease({
      leases: state.leases,
      lease: first,
    }),
    false,
  );
  assert.notEqual(
    state.leases.get("publication-admission:global"),
    null,
  );
});

test("a heartbeat keeps the authenticated handle expiry equal to the current DB lease", (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  const lease = acquire(state);
  state.db
    .prepare(
      `UPDATE runtime_leases
       SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 seconds')
       WHERE name = 'publication-admission:global'`,
    )
    .run();

  assert.equal(
    service().heartbeatPublicationAdmissionLease({
      db: state.db,
      leases: state.leases,
      lease,
      leaseMs: 60_000,
    }),
    true,
  );
  assert.equal(
    lease.expires_at,
    state.leases.get("publication-admission:global").expires_at,
  );
  assert.equal(lease.assertHealthy(), true);
});

test("the handle exposes only secret-safe evidence and in-transaction assertions", (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  const lease = acquire(state);
  assert.deepEqual(Object.keys(lease).sort(), [
    "acquired",
    "claimed_job_authority_sha256",
    "current_lock_owner_sha256",
    "expires_at",
    "lease_name",
  ]);
  assert.equal(JSON.stringify(lease).includes(state.ownerId), false);
  assert.equal(JSON.stringify(lease).includes(state.job.claim_token), false);
  assert.equal(typeof lease.assertHealthy, "function");
  assert.equal(typeof lease.assertHealthyInTransaction, "function");
  assert.throws(
    () => lease.assertHealthyInTransaction(),
    /publication_admission_transaction_required/,
  );
  const asserted = state.db.transaction(() => {
    assert.equal(lease.assertHealthyInTransaction(), true);
    return true;
  });
  assert.equal(asserted.immediate(), true);

  state.db
    .prepare("UPDATE job_runs SET finished_at = datetime('now')")
    .run();
  assert.throws(
    () =>
      state.db.transaction(() => lease.assertHealthyInTransaction()).immediate(),
    /publication_admission_lease_lost/,
  );
});

test("runWithPublicationAdmissionLease blocks irreversible work after claim loss", async (t) => {
  const state = fixture();
  t.after(() => state.db.close());
  let irreversibleCalls = 0;
  const result = await service().runWithPublicationAdmissionLease({
    db: state.db,
    leases: state.leases,
    ownerId: state.ownerId,
    operation: state.operation,
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority: state.claimedJobAuthority,
    heartbeatIntervalMs: 60_000,
    task: async ({ assertHealthy }) => {
      state.db
        .prepare("UPDATE job_runs SET finished_at = datetime('now')")
        .run();
      assertHealthy();
      irreversibleCalls += 1;
    },
  });
  assert.equal(irreversibleCalls, 0);
  assert.equal(result.status, "held");
  assert.equal(result.top_reason, "publication_admission_lease_lost");
  assert.equal(result.platform_contacted, false);
  assert.equal(result.external_create_attempted, false);
  assert.equal(result.platform_mutation_attempted, false);
});
