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
