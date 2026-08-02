"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { bindRepositories } = require("../../lib/repositories");
const { acquirePublisherLease } = require("../../lib/services/publisher-lock");
const {
  inspectBoundedRuntimeDbAuthority,
} = require("../../lib/stabilisation/bounded-runtime-db-authority");
const {
  inspectLiveDatabaseIdentity,
} = require("../../lib/stabilisation/windows-live-guarded-runtime");

const START = "2026-08-02T10:00:00.000Z";
const AUTHORITY_FINGERPRINT = "a".repeat(64);
const RUNTIME_INSTANCE_ID = "ri-11111111-2222-4333-8444-555555555555";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-authority-"),
  );
  const dbPath = path.join(root, "pulse-test.db");
  const db = new Database(dbPath);
  runMigrations(db, {
    env: {
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
    },
    log() {},
  });
  const repos = bindRepositories(db);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { db, dbPath, repos };
}

function expected(overrides = {}) {
  return {
    runtime_instance_id: RUNTIME_INSTANCE_ID,
    child_pid: 4200,
    child_started_at: START,
    authority_fingerprint: AUTHORITY_FINGERPRINT,
    worker_topology: [
      {
        pool_id: "critical_publication",
        instances: 1,
        kinds: ["publish"],
      },
    ],
    ...overrides,
  };
}

function databaseIdentitySha256(dbPath) {
  return inspectLiveDatabaseIdentity({ databasePath: dbPath })
    .database_identity_sha256;
}

function liveFixture(t, overrides = {}) {
  const state = fixture(t);
  const now = overrides.now || new Date();
  const workerId =
    overrides.workerId ||
    `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  state.repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-owner-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata(overrides.schedulerMetadata),
  });
  state.repos.workers.register({ id: workerId, status: "idle" });
  const queued = state.repos.jobs.enqueue({
    kind: "publish",
    payload: { admitted: true },
  });
  const claimed = state.repos.jobs.claim(workerId, {
    kinds: ["publish"],
    leaseMs: 90_000,
  });
  assert.equal(claimed.id, queued.id);
  return {
    ...state,
    now,
    workerId,
    claimed,
    expected: expected({
      database_identity_sha256: databaseIdentitySha256(state.dbPath),
      ...(overrides.expected || {}),
    }),
  };
}

function schedulerMetadata(overrides = {}) {
  return {
    schema_version: "pulse-runtime-generation-lease-v1",
    runtime_instance_id: RUNTIME_INSTANCE_ID,
    process_id: 4200,
    process_started_at: START,
    authority_fingerprint: AUTHORITY_FINGERPRINT,
    purpose: "single_owner_scheduler_dispatch",
    ...overrides,
  };
}

function addScheduledAdmission(
  db,
  {
    storyId = "story-73",
    scheduledFor = "2026-08-02T19:00:00.000Z",
    dispatchIdempotencyKey = "publish:2026-08-02:19",
    requestFingerprint = "b".repeat(64),
    runwayLockSha256 = "c".repeat(64),
  } = {},
) {
  db.prepare("INSERT OR IGNORE INTO stories (id, title) VALUES (?, ?)").run(
    storyId,
    "Bounded runtime fixture story",
  );
  const evidence = {
    schedule_verified: true,
    control_tower_verdict: "GREEN",
    control_tower_checked_at: "2026-08-02T18:55:00.000Z",
    scheduled_for: scheduledFor,
    kill_switch_healthy: true,
    operating_contract_valid: true,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
  };
  const inserted = db
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, event_reason,
          retryability_class, actor_type, actor_id, evidence_json,
          idempotency_key)
       VALUES (?, 'youtube', 'READY', 'SCHEDULED', ?, 'none',
               'system', 'bounded-runtime-fixture', ?, ?)`,
    )
    .run(
      storyId,
      "Bounded runtime fixture admission",
      JSON.stringify(evidence),
      `${dispatchIdempotencyKey}:lifecycle:SCHEDULED`,
    );
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state)
     VALUES (?, 'youtube', 'SCHEDULED')
     ON CONFLICT(story_id, platform) DO UPDATE SET
       lifecycle_state = excluded.lifecycle_state`,
  ).run(storyId);
  return {
    story_id: storyId,
    platform: "youtube",
    scheduled_event_id: Number(inserted.lastInsertRowid),
    scheduled_for: scheduledFor,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
  };
}

test("accepts only scheduler lease and workers from the bound runtime", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  const workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-owner-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata(),
  });
  repos.workers.register({ id: workerId, status: "idle" });
  const queued = repos.jobs.enqueue({
    kind: "publish",
    payload: { admitted: true },
  });
  const claimed = repos.jobs.claim(workerId, {
    kinds: ["publish"],
    leaseMs: 90_000,
  });
  assert.equal(claimed.id, queued.id);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: expected({
      database_identity_sha256: databaseIdentitySha256(dbPath),
    }),
    now,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.evidence.scheduler_lease.owner_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(result).includes("scheduler-owner-private-fixture"),
    false,
  );
});

test("rejects an active job claimed by a predecessor worker", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  const currentWorkerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-owner-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata(),
  });
  repos.workers.register({ id: currentWorkerId, status: "idle" });
  repos.jobs.enqueue({ kind: "publish", payload: { admitted: true } });
  const predecessorClaim = repos.jobs.claim(
    "server-ri-predecessor-critical_publication-1",
    { kinds: ["publish"], leaseMs: 90_000 },
  );
  assert.ok(predecessorClaim);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: expected({
      database_identity_sha256: databaseIdentitySha256(dbPath),
    }),
    now,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["runtime_db_active_job_foreign_worker"]);
});

test("rejects a publisher lease bound to a superseded SCHEDULED admission", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  const currentExpected = expected({
    child_pid: process.pid,
    database_identity_sha256: databaseIdentitySha256(dbPath),
  });
  const workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-owner-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata({ process_id: process.pid }),
  });
  repos.workers.register({ id: workerId, status: "idle" });
  repos.jobs.enqueue({ kind: "publish", payload: { admitted: true } });
  assert.ok(
    repos.jobs.claim(workerId, {
      kinds: ["publish"],
      leaseMs: 90_000,
    }),
  );
  const supersededAdmission = addScheduledAdmission(db);
  acquirePublisherLease({
    leases: repos.runtimeLeases,
    ownerId: "publisher-owner-private-fixture",
    operation: "publish_next_story",
    now,
    leaseMs: 90_000,
    runtimeAuthority: {
      runtime_instance_id: RUNTIME_INSTANCE_ID,
      child_pid: process.pid,
      child_started_at: START,
      authority_fingerprint: AUTHORITY_FINGERPRINT,
    },
    admissionContext: supersededAdmission,
  });
  addScheduledAdmission(db, {
    dispatchIdempotencyKey: "publish:2026-08-02:19:replacement",
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: currentExpected,
    now,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    "runtime_db_publisher_admission_mismatch",
  ]);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("scheduler-owner-private-fixture"), false);
  assert.equal(serialised.includes("publisher-owner-private-fixture"), false);
});

test("accepts an active publisher lease only for the current durable admission", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  const workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-current-private-owner",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata({ process_id: process.pid }),
  });
  repos.workers.register({ id: workerId, status: "idle" });
  repos.jobs.enqueue({ kind: "publish", payload: { admitted: true } });
  assert.ok(
    repos.jobs.claim(workerId, {
      kinds: ["publish"],
      leaseMs: 90_000,
    }),
  );
  const admission = addScheduledAdmission(db);
  acquirePublisherLease({
    leases: repos.runtimeLeases,
    ownerId: "publisher-current-private-owner",
    operation: "publish_next_story",
    now,
    leaseMs: 90_000,
    runtimeAuthority: {
      runtime_instance_id: RUNTIME_INSTANCE_ID,
      child_pid: process.pid,
      child_started_at: START,
      authority_fingerprint: AUTHORITY_FINGERPRINT,
    },
    admissionContext: admission,
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: expected({
      child_pid: process.pid,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    }),
    now,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.evidence.scheduler_lease.owner_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.publisher_lease.owner_sha256, /^[a-f0-9]{64}$/);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("scheduler-current-private-owner"), false);
  assert.equal(serialised.includes("publisher-current-private-owner"), false);

  for (const lifecycleState of [
    "READY",
    "ADMISSION_CANCELLED_BEFORE_DISPATCH",
    "RETRACTED",
    "ARBITRARY_UNKNOWN_STATE",
  ]) {
    db.prepare(
      `UPDATE platform_publication_state
       SET lifecycle_state = ?
       WHERE story_id = ? AND platform = 'youtube'`,
    ).run(lifecycleState, admission.story_id);
    const held = inspectBoundedRuntimeDbAuthority({
      db,
      mode: "LIVE",
      expected: expected({
        child_pid: process.pid,
        database_identity_sha256: databaseIdentitySha256(dbPath),
      }),
      now,
    });
    assert.equal(held.ok, false, lifecycleState);
    assert.deepEqual(
      held.blockers,
      ["runtime_db_publisher_admission_mismatch"],
      lifecycleState,
    );
  }
});

test("accepts a quiescent database with no live lease or active claim", (t) => {
  const { db, dbPath } = fixture(t);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now: new Date(),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
});

test("quiescent authority rejects every live lease and open execution", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  for (const [name, ownerId] of [
    ["scheduler:primary", "quiescent-scheduler-private-owner"],
    ["publisher:global", "quiescent-publisher-private-owner"],
  ]) {
    repos.runtimeLeases.acquire({
      name,
      ownerId,
      now,
      leaseMs: 90_000,
      metadata: { legacy: true },
    });
  }
  repos.jobs.enqueue({ kind: "publish", payload: { admitted: true } });
  assert.ok(
    repos.jobs.claim("server-predecessor-worker", {
      kinds: ["publish"],
      leaseMs: 90_000,
    }),
  );

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    "runtime_db_quiescent_scheduler_lease_active",
    "runtime_db_quiescent_publisher_lease_active",
    "runtime_db_quiescent_active_job_present",
    "runtime_db_quiescent_open_job_run_present",
  ]);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("quiescent-scheduler-private-owner"), false);
  assert.equal(serialised.includes("quiescent-publisher-private-owner"), false);
});

test("refuses to inspect a different SQLite file than Task 2 bound", (t) => {
  const first = fixture(t);
  const second = fixture(t);

  const result = inspectBoundedRuntimeDbAuthority({
    db: first.db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(second.dbPath),
    },
    now: new Date(),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["runtime_db_identity_mismatch"]);
});

test("refuses a hard-linked SQLite handle even when its inode hash was previously bound", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-link-"),
  );
  const originalPath = path.join(root, "original.db");
  const linkedPath = path.join(root, "linked.db");
  let setupDb = new Database(originalPath);
  runMigrations(setupDb, {
    env: {
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
    },
    log() {},
  });
  const identityBeforeLink = databaseIdentitySha256(originalPath);
  setupDb.close();
  setupDb = null;
  fs.linkSync(originalPath, linkedPath);
  const linkedDb = new Database(linkedPath);
  t.after(() => {
    linkedDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: linkedDb,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: identityBeforeLink,
    },
    now: new Date(),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["runtime_db_identity_mismatch"]);
});

test("refuses a replacement database installed at the previously bound path", (t) => {
  const original = fixture(t);
  const originalIdentity = databaseIdentitySha256(original.dbPath);
  original.db.close();
  const displacedPath = `${original.dbPath}.displaced`;
  fs.renameSync(original.dbPath, displacedPath);
  const replacement = new Database(original.dbPath);
  runMigrations(replacement, {
    env: {
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
    },
    log() {},
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: replacement,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: originalIdentity,
    },
    now: new Date(),
  });
  replacement.close();

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, ["runtime_db_identity_mismatch"]);
});

test("rejects TEMP tables that shadow unsafe main authority rows", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "unsafe-main-owner",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata(),
  });
  db.exec(`
    CREATE TEMP TABLE runtime_leases (
      name TEXT, owner_id TEXT, expires_at TEXT, metadata TEXT
    );
    CREATE TEMP TABLE jobs (status TEXT);
    CREATE TEMP TABLE job_runs (finished_at TEXT);
  `);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_schema_invalid"));
});

test("rejects TEMP views even when they expose apparently safe authority rows", (t) => {
  const { db, dbPath } = fixture(t);
  db.exec(`
    CREATE TEMP VIEW runtime_leases AS
      SELECT name, owner_id, expires_at, metadata
      FROM main.runtime_leases WHERE 0;
  `);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_schema_invalid"));
});

test("rejects every attached database including an in-memory attachment", (t) => {
  const { db, dbPath } = fixture(t);
  db.exec("ATTACH ':memory:' AS auxiliary_authority");

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_schema_invalid"));
});

test("rejects main-schema views laundering the required authority table names", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-view-launder-"),
  );
  const dbPath = path.join(root, "pulse-view-launder.db");
  const db = new Database(dbPath);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  db.exec(`
    CREATE TABLE backing_runtime_leases (
      name TEXT, owner_id TEXT, expires_at TEXT, metadata TEXT
    );
    CREATE TABLE backing_workers (
      id TEXT, status TEXT, last_seen_at TEXT
    );
    CREATE TABLE backing_jobs (
      id INTEGER, kind TEXT, status TEXT, claimed_by TEXT,
      lease_until TEXT, attempt_count INTEGER
    );
    CREATE TABLE backing_job_runs (
      id INTEGER, job_id INTEGER, worker_id TEXT, attempt INTEGER,
      status TEXT, finished_at TEXT
    );
    CREATE TABLE backing_lifecycle (
      id INTEGER, story_id TEXT, platform TEXT, to_state TEXT,
      evidence_json TEXT, idempotency_key TEXT
    );
    CREATE TABLE backing_publication_state (
      story_id TEXT, platform TEXT, lifecycle_state TEXT
    );
    CREATE VIEW runtime_leases AS SELECT * FROM backing_runtime_leases;
    CREATE VIEW workers AS SELECT * FROM backing_workers;
    CREATE VIEW jobs AS SELECT * FROM backing_jobs;
    CREATE VIEW job_runs AS SELECT * FROM backing_job_runs;
    CREATE VIEW publication_lifecycle_events AS SELECT * FROM backing_lifecycle;
    CREATE VIEW platform_publication_state AS SELECT * FROM backing_publication_state;
  `);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_schema_invalid"));
});

test("uses one WAL snapshot so cross-connection mutation cannot manufacture GREEN", (t) => {
  const state = liveFixture(t);
  state.db.pragma("journal_mode = WAL");
  const writer = new Database(state.dbPath);
  writer.pragma("journal_mode = WAL");

  state.db
    .prepare("UPDATE main.workers SET id = ? WHERE id = ?")
    .run("server-predecessor-critical_publication-1", state.workerId);
  let mutated = false;
  const db = new Proxy(state.db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          if (!mutated && /\bFROM\s+(?:main\.)?workers\b/i.test(sql)) {
            mutated = true;
            writer.transaction(() => {
              writer
                .prepare(
                  "UPDATE main.runtime_leases SET metadata = ? WHERE name = 'scheduler:primary'",
                )
                .run(
                  JSON.stringify(
                    schedulerMetadata({
                      runtime_instance_id:
                        "ri-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    }),
                  ),
                );
              writer
                .prepare("UPDATE main.workers SET id = ? WHERE id = ?")
                .run(
                  state.workerId,
                  "server-predecessor-critical_publication-1",
                );
              writer
                .prepare("UPDATE main.job_runs SET worker_id = ?")
                .run(state.workerId);
              writer
                .prepare("UPDATE main.jobs SET claimed_by = ?")
                .run(state.workerId);
            })();
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  writer.close();

  assert.equal(mutated, true);
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_worker_topology_mismatch"));
});

test("emits a deterministic secret-safe digest for the complete authority snapshot", (t) => {
  const state = liveFixture(t);

  const first = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  const second = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(first.ok, true);
  assert.match(first.snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.equal(second.snapshot_sha256, first.snapshot_sha256);
  assert.equal(
    JSON.stringify(first).includes("scheduler-owner-private-fixture"),
    false,
  );

  state.db
    .prepare("UPDATE main.workers SET status = 'busy' WHERE id = ?")
    .run(state.workerId);
  const changed = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  assert.equal(changed.ok, true);
  assert.match(changed.snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(changed.snapshot_sha256, first.snapshot_sha256);
});

for (const mutation of [
  {
    name: "missing unfinished run",
    apply(db, state) {
      db.prepare("DELETE FROM main.job_runs WHERE id = ?").run(
        state.claimed.claim_token,
      );
    },
    blocker: "runtime_db_active_job_run_missing",
  },
  {
    name: "duplicate unfinished run",
    apply(db, state) {
      db.prepare(
        `INSERT INTO main.job_runs
           (job_id, worker_id, attempt, status, started_at)
         VALUES (?, ?, ?, 'running', datetime('now'))`,
      ).run(state.claimed.id, state.workerId, state.claimed.attempt_count);
    },
    blocker: "runtime_db_active_job_run_duplicate",
  },
  {
    name: "mismatched run worker",
    apply(db, state) {
      db.prepare("UPDATE main.job_runs SET worker_id = ? WHERE id = ?").run(
        "server-predecessor-critical_publication-1",
        state.claimed.claim_token,
      );
    },
    blocker: "runtime_db_active_job_run_binding_mismatch",
  },
  {
    name: "wrong-pool run worker",
    apply(db, state) {
      db.prepare("UPDATE main.job_runs SET worker_id = ? WHERE id = ?").run(
        `server-${RUNTIME_INSTANCE_ID}-maintenance-1`,
        state.claimed.claim_token,
      );
    },
    blocker: "runtime_db_active_job_run_binding_mismatch",
  },
  {
    name: "mismatched run attempt",
    apply(db, state) {
      db.prepare(
        "UPDATE main.job_runs SET attempt = attempt + 1 WHERE id = ?",
      ).run(state.claimed.claim_token);
    },
    blocker: "runtime_db_active_job_run_binding_mismatch",
  },
]) {
  test(`rejects an active claim with ${mutation.name}`, (t) => {
    const state = liveFixture(t);
    mutation.apply(state.db, state);

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: state.now,
    });

    assert.equal(result.ok, false);
    assert.ok(result.blockers.includes(mutation.blocker));
  });
}

test("rejects an orphan unfinished run even when its worker ID is current", (t) => {
  const state = liveFixture(t);
  const orphan = state.repos.jobs.enqueue({
    kind: "publish",
    payload: { admitted: true },
  });
  state.db
    .prepare(
      `INSERT INTO main.job_runs
       (job_id, worker_id, attempt, status, started_at)
     VALUES (?, ?, 1, 'running', datetime('now'))`,
    )
    .run(orphan.id, state.workerId);

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_open_job_run_orphan"));
});

test("rejects stale or non-live exact worker rows", (t) => {
  for (const mutation of [
    { status: "locked", last_seen_at: "2099-01-01 00:00:00" },
    { status: "idle", last_seen_at: "2000-01-01 00:00:00" },
  ]) {
    const state = liveFixture(t);
    state.db
      .prepare(
        "UPDATE main.workers SET status = ?, last_seen_at = ? WHERE id = ?",
      )
      .run(mutation.status, mutation.last_seen_at, state.workerId);

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: state.now,
    });

    assert.equal(result.ok, false, JSON.stringify(mutation));
    assert.ok(
      result.blockers.includes("runtime_db_worker_liveness_mismatch"),
      JSON.stringify(mutation),
    );
  }
});

test("sanitises every untrusted lease metadata field before returning evidence", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date();
  const secret = "sk-live-metadata-token-must-not-leak";
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: secret,
    now,
    leaseMs: 90_000,
    metadata: {
      schema_version: secret,
      runtime_instance_id: `ri-${secret}`,
      process_id: secret,
      process_started_at: secret,
      authority_fingerprint: secret,
      operation: secret,
      admitted_operation_sha256: secret,
    },
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(
    {
      schema_version: result.evidence.scheduler_lease.schema_version,
      runtime_instance_id: result.evidence.scheduler_lease.runtime_instance_id,
      process_id: result.evidence.scheduler_lease.process_id,
      process_started_at: result.evidence.scheduler_lease.process_started_at,
      authority_fingerprint:
        result.evidence.scheduler_lease.authority_fingerprint,
      operation: result.evidence.scheduler_lease.operation,
      admitted_operation_sha256:
        result.evidence.scheduler_lease.admitted_operation_sha256,
    },
    {
      schema_version: null,
      runtime_instance_id: null,
      process_id: null,
      process_started_at: null,
      authority_fingerprint: null,
      operation: null,
      admitted_operation_sha256: null,
    },
  );
});

test("rejects newer cancellation or reconciliation hidden by a stale SCHEDULED projection", (t) => {
  for (const newerState of [
    "ADMISSION_CANCELLED_BEFORE_DISPATCH",
    "RECONCILIATION_REQUIRED",
  ]) {
    const { db, dbPath, repos } = fixture(t);
    const now = new Date();
    const workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
    repos.runtimeLeases.acquire({
      name: "scheduler:primary",
      ownerId: "scheduler-current-private-owner",
      now,
      leaseMs: 90_000,
      metadata: schedulerMetadata({ process_id: process.pid }),
    });
    repos.workers.register({ id: workerId, status: "idle" });
    repos.jobs.enqueue({ kind: "publish", payload: { admitted: true } });
    assert.ok(
      repos.jobs.claim(workerId, { kinds: ["publish"], leaseMs: 90_000 }),
    );
    const admission = addScheduledAdmission(db);
    acquirePublisherLease({
      leases: repos.runtimeLeases,
      ownerId: "publisher-current-private-owner",
      operation: "publish_next_story",
      now,
      leaseMs: 90_000,
      runtimeAuthority: {
        runtime_instance_id: RUNTIME_INSTANCE_ID,
        child_pid: process.pid,
        child_started_at: START,
        authority_fingerprint: AUTHORITY_FINGERPRINT,
      },
      admissionContext: admission,
    });
    db.prepare(
      `INSERT INTO main.publication_lifecycle_events
       (story_id, platform, from_state, to_state, event_reason,
        retryability_class, actor_type, evidence_json, idempotency_key)
     VALUES (?, 'youtube', 'SCHEDULED', ?,
             'authority changed', 'none', 'system', '{}', ?)`,
    ).run(
      admission.story_id,
      newerState,
      `${admission.dispatch_idempotency_key}:${newerState}`,
    );

    const result = inspectBoundedRuntimeDbAuthority({
      db,
      mode: "LIVE",
      expected: expected({
        child_pid: process.pid,
        database_identity_sha256: databaseIdentitySha256(dbPath),
      }),
      now,
    });

    assert.equal(result.ok, false, newerState);
    assert.ok(
      result.blockers.includes("runtime_db_publisher_admission_mismatch"),
      newerState,
    );
  }
});

test("publisher lease binds the canonical finite operation set", (t) => {
  const { db, repos } = fixture(t);
  const now = new Date();
  const admission = addScheduledAdmission(db);
  acquirePublisherLease({
    leases: repos.runtimeLeases,
    ownerId: "publisher-current-private-owner",
    operation: "publish_next_story",
    now,
    leaseMs: 90_000,
    runtimeAuthority: {
      runtime_instance_id: RUNTIME_INSTANCE_ID,
      child_pid: process.pid,
      child_started_at: START,
      authority_fingerprint: AUTHORITY_FINGERPRINT,
    },
    admissionContext: admission,
  });
  const metadata = JSON.parse(
    db
      .prepare(
        "SELECT metadata FROM main.runtime_leases WHERE name = 'publisher:global'",
      )
      .get().metadata,
  );

  assert.match(metadata.publisher_operation_set_sha256, /^[a-f0-9]{64}$/);
});
