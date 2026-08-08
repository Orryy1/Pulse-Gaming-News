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
  acquirePublicationAdmissionLease,
} = require("../../lib/services/publication-admission-lock");
const {
  buildClaimedJobAuthority,
  inspectBoundedRuntimeDbAuthority,
} = require("../../lib/stabilisation/bounded-runtime-db-authority");
const {
  inspectLiveDatabaseIdentity,
} = require("../../lib/stabilisation/windows-live-guarded-runtime");

const START = "2026-08-02T10:00:00.000Z";
const AUTHORITY_FINGERPRINT = "a".repeat(64);
const RUNTIME_INSTANCE_ID = "ri-11111111-2222-4333-8444-555555555555";

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return require("node:crypto")
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function claimSetSha256(
  {
    workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`,
    jobId = 1,
    kind = "publish",
    runId = 1,
    attempt = 1,
  } = {},
) {
  return sha256(
    stableJson([
      {
        attempt,
        claim_token_sha256: sha256(`job-claim-token:${runId}`),
        job_id: jobId,
        kind,
        run_id: runId,
        worker_id: workerId,
      },
    ]),
  );
}

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-authority-"),
  );
  const dbPath = path.join(root, "pulse-test.db");
  let db = new Database(dbPath);
  runMigrations(db, {
    env: {
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
    },
    log() {},
  });
  // The governance migration verifier initialises SQLite's TEMP schema.
  // Live authority requires a clean connection with main as its sole schema.
  db.close();
  db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
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
    runtime_claim_set_count: 1,
    runtime_claim_set_sha256: claimSetSha256(),
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
  state.db
    .prepare("UPDATE main.workers SET last_seen_at = ? WHERE id = ?")
    .run(now.toISOString(), workerId);
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
    channelId = "pulse-gaming",
    storyId = "story-73",
    scheduledFor = "2026-08-02T19:00:00.000Z",
    dispatchIdempotencyKey = "publish:2026-08-02:19",
    requestFingerprint = "b".repeat(64),
    runwayLockSha256 = "c".repeat(64),
  } = {},
) {
  db.prepare(
    "INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)",
  ).run(channelId, "Bounded runtime fixture channel");
  db.prepare("INSERT OR IGNORE INTO stories (id, title) VALUES (?, ?)").run(
    storyId,
    "Bounded runtime fixture story",
  );
  const evidence = {
    schedule_verified: true,
    channel_id: channelId,
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
    channel_id: channelId,
    story_id: storyId,
    platform: "youtube",
    scheduled_event_id: Number(inserted.lastInsertRowid),
    scheduled_for: scheduledFor,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
  };
}

function runtimeAuthority() {
  return {
    runtime_instance_id: RUNTIME_INSTANCE_ID,
    child_pid: process.pid,
    child_started_at: START,
    authority_fingerprint: AUTHORITY_FINGERPRINT,
  };
}

function claimedJobKindForOperation(operation) {
  return {
    publish_next_story: "dispatch_governed_publication",
    verify_governed_youtube_scheduled_replay:
      "verify_governed_youtube_release_tminus15",
    verify_governed_youtube_private_prestage:
      "governed_youtube_runway_t60",
  }[operation];
}

function publisherFixture(
  t,
  {
    operation = "publish_next_story",
    now = new Date(),
    admission: admissionOverrides = {},
  } = {},
) {
  const state = fixture(t);
  const admission = addScheduledAdmission(state.db, admissionOverrides);
  const workerId = `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  const jobKind = claimedJobKindForOperation(operation);
  assert.ok(jobKind, `publisher fixture operation is mapped: ${operation}`);
  state.repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-owner-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata({ process_id: process.pid }),
  });
  state.repos.workers.register({ id: workerId, status: "idle" });
  state.db
    .prepare("UPDATE main.workers SET last_seen_at = ? WHERE id = ?")
    .run(now.toISOString(), workerId);
  const queued = state.repos.jobs.enqueue({
    kind: jobKind,
    channel_id: admission.channel_id,
    story_id: admission.story_id,
    payload: {
      operation,
      runway_lock_sha256: admission.runway_lock_sha256,
    },
    idempotency_key: `${admission.dispatch_idempotency_key}:job:${jobKind}`,
  });
  const claimed = state.repos.jobs.claim(workerId, {
    kinds: [jobKind],
    channelId: admission.channel_id,
    leaseMs: 90_000,
  });
  assert.equal(claimed.id, queued.id);
  const claimedJobAuthority = buildClaimedJobAuthority({
    db: state.db,
    jobId: claimed.id,
    workerId,
    claimToken: claimed.claim_token,
  });
  return {
    ...state,
    now,
    admission,
    workerId,
    claimed,
    claimedJobAuthority,
    runtimeAuthority: runtimeAuthority(),
    expected: expected({
      child_pid: process.pid,
      database_identity_sha256: databaseIdentitySha256(state.dbPath),
      worker_topology: [
        {
          pool_id: "critical_publication",
          instances: 1,
          kinds: [jobKind],
        },
      ],
      runtime_claim_set_count: 1,
      runtime_claim_set_sha256: claimSetSha256({
        workerId,
        jobId: claimed.id,
        kind: jobKind,
        runId: Number(claimed.claim_token),
        attempt: claimed.attempt_count,
      }),
    }),
  };
}

function publicationAdmissionFixture(t, { windowScoped = false } = {}) {
  const state = fixture(t);
  const now = new Date();
  const workerId =
    `server-${RUNTIME_INSTANCE_ID}-critical_publication-1`;
  const channelId = windowScoped ? null : "pulse-gaming";
  const storyId = windowScoped ? null : "admission-story-91";
  const jobKind = windowScoped
    ? "prepare_governed_autonomous_pre_t90_window"
    : "admit_governed_publication";
  const operation = windowScoped
    ? "governed_autonomous_pre_t90_window_preparation"
    : "autonomous_t75_jit_admission";
  if (!windowScoped) {
    state.db
      .prepare("INSERT OR IGNORE INTO channels (id, name) VALUES (?, ?)")
      .run(channelId, "Publication admission fixture channel");
    state.db
      .prepare("INSERT OR IGNORE INTO stories (id, title) VALUES (?, ?)")
      .run(storyId, "Publication admission fixture story");
  }
  state.repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "scheduler-admission-private-fixture",
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata({ process_id: process.pid }),
  });
  state.repos.workers.register({ id: workerId, status: "idle" });
  state.db
    .prepare("UPDATE main.workers SET last_seen_at = ? WHERE id = ?")
    .run(now.toISOString(), workerId);
  const queued = state.repos.jobs.enqueue({
    kind: jobKind,
    channel_id: channelId,
    story_id: storyId,
    payload: {
      scheduled_for: "2026-08-02T19:00:00.000Z",
      publish_hour_utc: 19,
    },
    idempotency_key: `admit:publication-admission:${jobKind}:91`,
  });
  const claimed = state.repos.jobs.claim(workerId, {
    kinds: [jobKind],
    ...(windowScoped ? {} : { channelId }),
    leaseMs: 90_000,
  });
  assert.equal(claimed.id, queued.id);
  const claimedJobAuthority = buildClaimedJobAuthority({
    db: state.db,
    jobId: claimed.id,
    workerId,
    claimToken: claimed.claim_token,
  });
  return {
    ...state,
    now,
    workerId,
    claimed,
    operation,
    claimedJobAuthority,
    runtimeAuthority: runtimeAuthority(),
    expected: expected({
      child_pid: process.pid,
      database_identity_sha256: databaseIdentitySha256(state.dbPath),
      worker_topology: [
        {
          pool_id: "critical_publication",
          instances: 1,
          kinds: [jobKind],
        },
      ],
      runtime_claim_set_count: 1,
      runtime_claim_set_sha256: claimSetSha256({
        workerId,
        jobId: claimed.id,
        kind: jobKind,
        runId: Number(claimed.claim_token),
        attempt: claimed.attempt_count,
      }),
    }),
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
  const state = publisherFixture(t);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-owner-private-fixture",
    operation: "publish_next_story",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });
  addScheduledAdmission(state.db, {
    dispatchIdempotencyKey: "publish:2026-08-02:19:replacement",
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: new Date(),
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
  const state = publisherFixture(t);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-current-private-owner",
    operation: "publish_next_story",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: new Date(),
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
    state.db.prepare(
      `UPDATE platform_publication_state
       SET lifecycle_state = ?
       WHERE story_id = ? AND platform = 'youtube'`,
    ).run(lifecycleState, state.admission.story_id);
    const held = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: new Date(),
    });
    assert.equal(held.ok, false, lifecycleState);
    assert.deepEqual(
      held.blockers,
      ["runtime_db_publisher_admission_mismatch"],
      lifecycleState,
    );
  }
});

test("accepts an active publication-admission lease only for its exact runtime and claimed job", (t) => {
  const state = publicationAdmissionFixture(t);
  acquirePublicationAdmissionLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publication-admission-current-private-owner",
    operation: "autonomous_t75_jit_admission",
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: new Date(),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.blockers, []);
  assert.match(
    result.evidence.publication_admission_lease.owner_sha256,
    /^[a-f0-9]{64}$/,
  );
  const serialised = JSON.stringify(result);
  assert.equal(
    serialised.includes("publication-admission-current-private-owner"),
    false,
  );
  assert.equal(serialised.includes(state.workerId), false);
});

test("inspector accepts the exact production-shaped WINDOW admission claim", (t) => {
  const state = publicationAdmissionFixture(t, { windowScoped: true });
  acquirePublicationAdmissionLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publication-admission-window-private-owner",
    operation: state.operation,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: new Date(),
  });
  const metadata = JSON.parse(
    state.repos.runtimeLeases.get("publication-admission:global").metadata,
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(metadata.claim_scope, "WINDOW");
  assert.equal(metadata.channel_id, null);
  assert.equal(metadata.story_id, null);
});

test("inspector rejects STORY/WINDOW metadata scope substitution both ways", (t) => {
  for (const windowScoped of [false, true]) {
    const state = publicationAdmissionFixture(t, { windowScoped });
    acquirePublicationAdmissionLease({
      db: state.db,
      leases: state.repos.runtimeLeases,
      ownerId: `publication-admission-scope-${windowScoped}-private-owner`,
      operation: state.operation,
      runtimeAuthority: state.runtimeAuthority,
      claimedJobAuthority: state.claimedJobAuthority,
    });
    const row = state.repos.runtimeLeases.get(
      "publication-admission:global",
    );
    const metadata = JSON.parse(row.metadata);
    metadata.claim_scope = windowScoped ? "STORY" : "WINDOW";
    state.db
      .prepare(
        "UPDATE main.runtime_leases SET metadata = ? WHERE name = 'publication-admission:global'",
      )
      .run(JSON.stringify(metadata));

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: new Date(),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(
      result.blockers.includes(
        "runtime_db_publication_admission_claim_mismatch",
      ),
      JSON.stringify(result),
    );
  }
});

test("rejects publisher/admission schema substitution and claimed-job digest drift", (t) => {
  for (const mutation of ["schema", "claim"]) {
    const state = publicationAdmissionFixture(t);
    acquirePublicationAdmissionLease({
      db: state.db,
      leases: state.repos.runtimeLeases,
      ownerId: `publication-admission-${mutation}-private-owner`,
      operation: "autonomous_t75_jit_admission",
      runtimeAuthority: state.runtimeAuthority,
      claimedJobAuthority: state.claimedJobAuthority,
    });
    const row = state.db
      .prepare(
        "SELECT metadata FROM main.runtime_leases WHERE name = 'publication-admission:global'",
      )
      .get();
    const metadata = JSON.parse(row.metadata);
    if (mutation === "schema") {
      metadata.schema_version =
        "pulse-runtime-generation-publisher-lease-v1";
    } else {
      metadata.claimed_job_authority_sha256 = "f".repeat(64);
    }
    state.db
      .prepare(
        "UPDATE main.runtime_leases SET metadata = ? WHERE name = 'publication-admission:global'",
      )
      .run(JSON.stringify(metadata));

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: new Date(),
    });

    assert.equal(result.ok, false, mutation);
    assert.ok(
      result.blockers.includes(
        mutation === "schema"
          ? "runtime_db_publication_admission_lease_binding_mismatch"
          : "runtime_db_publication_admission_claim_mismatch",
      ),
      `${mutation}: ${JSON.stringify(result)}`,
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
    [
      "publication-admission:global",
      "quiescent-publication-admission-private-owner",
    ],
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
    "runtime_db_quiescent_publication_admission_lease_active",
    "runtime_db_quiescent_active_job_present",
    "runtime_db_quiescent_open_job_run_present",
  ]);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("quiescent-scheduler-private-owner"), false);
  assert.equal(serialised.includes("quiescent-publisher-private-owner"), false);
  assert.equal(
    serialised.includes("quiescent-publication-admission-private-owner"),
    false,
  );
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
  replacement.close();
  const reopenedReplacement = new Database(original.dbPath);
  reopenedReplacement.pragma("foreign_keys = ON");

  const result = inspectBoundedRuntimeDbAuthority({
    db: reopenedReplacement,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: originalIdentity,
    },
    now: new Date(),
  });
  reopenedReplacement.close();

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
  for (const key of [
    "schema_version",
    "runtime_instance_id",
    "process_id",
    "process_started_at",
    "authority_fingerprint",
    "operation",
    "admitted_operation_sha256",
  ]) {
    assert.equal(Object.hasOwn(result.evidence.scheduler_lease, key), false, key);
  }
});

test("rejects newer cancellation or reconciliation hidden by a stale SCHEDULED projection", (t) => {
  for (const newerState of [
    "ADMISSION_CANCELLED_BEFORE_DISPATCH",
    "RECONCILIATION_REQUIRED",
  ]) {
    const state = publisherFixture(t);
    acquirePublisherLease({
      db: state.db,
      leases: state.repos.runtimeLeases,
      ownerId: "publisher-current-private-owner",
      operation: "publish_next_story",
      now: state.now,
      leaseMs: 90_000,
      runtimeAuthority: state.runtimeAuthority,
      claimedJobAuthority: state.claimedJobAuthority,
      admissionContext: state.admission,
    });
    state.db.prepare(
      `INSERT INTO main.publication_lifecycle_events
       (story_id, platform, from_state, to_state, event_reason,
        retryability_class, actor_type, evidence_json, idempotency_key)
     VALUES (?, 'youtube', 'SCHEDULED', ?,
             'authority changed', 'none', 'system', '{}', ?)`,
    ).run(
      state.admission.story_id,
      newerState,
      `${state.admission.dispatch_idempotency_key}:${newerState}`,
    );

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: state.now,
    });

    assert.equal(result.ok, false, newerState);
    assert.ok(
      result.blockers.includes("runtime_db_publisher_admission_mismatch"),
      newerState,
    );
  }
});

test("publisher lease binds the canonical finite operation set", (t) => {
  const state = publisherFixture(t);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-current-private-owner",
    operation: "publish_next_story",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });
  const metadata = JSON.parse(
    state.db
      .prepare(
        "SELECT metadata FROM main.runtime_leases WHERE name = 'publisher:global'",
      )
      .get().metadata,
  );

  assert.match(metadata.publisher_operation_set_sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.lease_instance_sha256, /^[a-f0-9]{64}$/);
});

test("rejects a publisher lease with a malformed lease instance digest", (t) => {
  const state = publisherFixture(t);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-instance-private-owner",
    operation: "publish_next_story",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });
  const row = state.db
    .prepare(
      "SELECT metadata FROM main.runtime_leases WHERE name = 'publisher:global'",
    )
    .get();
  const metadata = JSON.parse(row.metadata);
  metadata.lease_instance_sha256 = "malformed";
  state.db
    .prepare(
      "UPDATE main.runtime_leases SET metadata = ? WHERE name = 'publisher:global'",
    )
    .run(JSON.stringify(metadata));

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.blockers.includes("runtime_db_publisher_admission_mismatch"),
  );
});

test("rejects a duplicate scheduler decoy when the authority table lacks its canonical primary key", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-duplicate-decoy-"),
  );
  const dbPath = path.join(root, "pulse-test.db");
  let db = new Database(dbPath);
  runMigrations(db, {
    env: { NODE_ENV: "test", PULSE_OPERATING_MODE: "LOCAL_PROOF" },
    log() {},
  });
  db.exec(`
    ALTER TABLE runtime_leases RENAME TO runtime_leases_canonical;
    CREATE TABLE runtime_leases (
      name TEXT,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
    );
    DROP TABLE runtime_leases_canonical;
    CREATE INDEX idx_runtime_leases_expiry ON runtime_leases(expires_at);
  `);
  db.close();
  db = new Database(dbPath);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  db.exec(`
    INSERT INTO runtime_leases
      (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
    VALUES
      ('scheduler:primary', 'active-private-owner',
       '2026-08-02T10:00:00.000Z', '2026-08-02T10:00:00.000Z',
       '2026-08-02T10:01:00.000Z', '{}'),
      ('scheduler:primary', 'expired-private-decoy',
       '2026-08-02T09:00:00.000Z', '2026-08-02T09:00:00.000Z',
       '2026-08-02T09:01:00.000Z', '{}');
  `);

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now: new Date("2026-08-02T10:00:30.000Z"),
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_schema_invalid"));
  assert.doesNotMatch(JSON.stringify(result), /active-private|expired-private/);
});

for (const schemaMutation of [
  {
    name: "a required index is missing",
    apply(db) {
      db.exec("DROP INDEX main.idx_runtime_leases_expiry");
    },
  },
  {
    name: "a required lifecycle trigger is missing",
    apply(db) {
      db.exec(
        "DROP TRIGGER main.trg_publication_lifecycle_events_immutable_update",
      );
    },
  },
  {
    name: "a required lifecycle trigger is substituted by a lookalike",
    apply(db) {
      db.exec(`
        DROP TRIGGER main.trg_publication_lifecycle_events_immutable_update;
        CREATE TRIGGER trg_publication_lifecycle_events_immutable_update
        BEFORE UPDATE ON publication_lifecycle_events
        BEGIN SELECT 1; END;
      `);
    },
  },
  {
    name: "the partial idempotency predicate is substituted",
    apply(db) {
      db.exec(`
        DROP INDEX main.ux_jobs_idempotency;
        CREATE UNIQUE INDEX ux_jobs_idempotency
        ON jobs(idempotency_key)
        WHERE 0;
      `);
    },
  },
  {
    name: "the autonomous authority binding trigger is removed",
    apply(db) {
      db.exec("DROP TRIGGER main.trg_autonomous_lifecycle_authority_binding");
    },
  },
  {
    name: "the dispatch ledger immutability trigger is removed",
    apply(db) {
      db.exec("DROP TRIGGER main.trg_platform_dispatch_ledger_immutable_update");
    },
  },
  {
    name: "the dispatch ledger idempotency index is substituted",
    apply(db) {
      db.exec(`
        DROP INDEX main.ux_platform_dispatch_idempotency;
        CREATE UNIQUE INDEX ux_platform_dispatch_idempotency
        ON platform_dispatch_ledger(platform, idempotency_key)
        WHERE 0;
      `);
    },
  },
  {
    name: "the autonomous authority audit immutability trigger is removed",
    apply(db) {
      db.exec(
        "DROP TRIGGER main.trg_publication_authority_audit_immutable_update",
      );
    },
  },
  {
    name: "the autonomous authority audit binding index is removed",
    apply(db) {
      db.exec("DROP INDEX main.ux_publication_authority_audit_binding");
    },
  },
]) {
  test(`rejects the authority schema when ${schemaMutation.name}`, (t) => {
    const { db, dbPath } = fixture(t);
    schemaMutation.apply(db);

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
}

test("rejects an authority-mutating trigger attached to a non-authority table", (t) => {
  const { db, dbPath } = fixture(t);
  db.exec(`
    CREATE TRIGGER rogue_authority_mutator
    AFTER UPDATE ON stories
    BEGIN
      DELETE FROM runtime_leases;
    END;
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

test("rejects an authority-mutating INSTEAD OF trigger attached to a view", (t) => {
  const { db, dbPath } = fixture(t);
  db.exec(`
    CREATE VIEW rogue_authority_view AS SELECT id FROM stories;
    CREATE TRIGGER rogue_authority_view_mutator
    INSTEAD OF DELETE ON rogue_authority_view
    BEGIN
      DELETE FROM runtime_leases;
    END;
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

test("rejects disabled SQLite foreign-key enforcement explicitly", (t) => {
  const { db, dbPath } = fixture(t);
  db.pragma("foreign_keys = OFF");

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_foreign_keys_disabled"));
});

test("rejects a substituted authority migration checksum", (t) => {
  const { db, dbPath } = fixture(t);
  db.prepare(
    "UPDATE main.schema_migrations SET checksum = ? WHERE version = '024'",
  ).run("f".repeat(64));

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

test("rejects a jobs lookalike with the canonical columns but no foreign keys", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-bounded-runtime-db-missing-fk-"),
  );
  const dbPath = path.join(root, "pulse-test.db");
  let db = new Database(dbPath);
  runMigrations(db, {
    env: { NODE_ENV: "test", PULSE_OPERATING_MODE: "LOCAL_PROOF" },
    log() {},
  });
  db.unsafeMode(true);
  db.pragma("writable_schema = ON");
  const originalSql = db
    .prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='jobs'")
    .get().sql;
  const withoutForeignKeys = originalSql.replace(
    /,\s*FOREIGN KEY \(channel_id\)[\s\S]*?REFERENCES stories\(id\)\s*/i,
    "\n",
  );
  assert.notEqual(withoutForeignKeys, originalSql);
  db.prepare(
    "UPDATE sqlite_schema SET sql = ? WHERE type='table' AND name='jobs'",
  ).run(withoutForeignKeys);
  db.pragma("writable_schema = OFF");
  db.unsafeMode(false);
  db.close();
  db = new Database(dbPath);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

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

test("rejects an unrelated TEMP schema even after its final object is dropped", (t) => {
  const { db, dbPath } = fixture(t);
  db.exec("CREATE TEMP TABLE unrelated_temp_row (id INTEGER); DROP TABLE unrelated_temp_row;");

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

test("rejects malformed present lease times in LIVE and QUIESCENT modes", (t) => {
  const state = liveFixture(t);
  state.db
    .prepare(
      `UPDATE main.runtime_leases
       SET acquired_at = 'not-a-time', heartbeat_at = 'still-not-a-time',
           expires_at = 'also-not-a-time'
       WHERE name = 'scheduler:primary'`,
    )
    .run();

  const live = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  const quiescent = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: state.expected.database_identity_sha256,
    },
    now: state.now,
  });

  assert.equal(live.ok, false);
  assert.ok(live.blockers.includes("runtime_db_scheduler_lease_time_invalid"));
  assert.equal(quiescent.ok, false);
  assert.ok(
    quiescent.blockers.includes("runtime_db_scheduler_lease_time_invalid"),
  );
});

test("rejects an ancient scheduler heartbeat paired with a far-future expiry", (t) => {
  const state = liveFixture(t, {
    now: new Date("2026-08-02T10:00:00.000Z"),
  });
  state.db
    .prepare(
      `UPDATE main.runtime_leases
       SET acquired_at = '2026-08-02T08:00:00.000Z',
           heartbeat_at = '2026-08-02T08:00:01.000Z',
           expires_at = '2099-08-02T10:00:00.000Z'
       WHERE name = 'scheduler:primary'`,
    )
    .run();

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("runtime_db_scheduler_lease_time_invalid"));
});

test("accepts exact scheduler lease time boundaries", (t) => {
  const state = liveFixture(t, {
    now: new Date("2026-08-02T10:00:00.000Z"),
  });
  state.db
    .prepare(
      `UPDATE main.runtime_leases
       SET acquired_at = '2026-08-02T09:59:30.000Z',
           heartbeat_at = '2026-08-02T09:59:30.000Z',
           expires_at = '2026-08-02T10:01:00.000Z'
       WHERE name = 'scheduler:primary'`,
    )
    .run();

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, true);
});

test("enforces exact publisher lease freshness and TTL boundaries", (t) => {
  const now = new Date();
  const boundaryHeartbeat = new Date(now.getTime() - 5 * 60_000);
  const state = publisherFixture(t, { now });
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-time-private-owner",
    operation: "publish_next_story",
    now: boundaryHeartbeat,
    leaseMs: 900_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });

  const boundary = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  assert.equal(boundary.ok, true, JSON.stringify(boundary.blockers));

  state.db
    .prepare(
      `UPDATE main.runtime_leases
       SET heartbeat_at = ?,
           expires_at = ?
       WHERE name = 'publisher:global'`,
    )
    .run(
      new Date(boundaryHeartbeat.getTime() - 1).toISOString(),
      new Date(now.getTime() + 10 * 60_000).toISOString(),
    );
  const overTtl = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });
  assert.equal(overTtl.ok, false);
  assert.ok(overTtl.blockers.includes("runtime_db_publisher_lease_time_invalid"));
});

test("never returns correct-looking attacker lease metadata", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const now = new Date("2026-08-02T10:00:00.000Z");
  const attackers = {
    oauth: "ya29.attacker-refresh-token",
    sha: "f".repeat(64),
    runtime: "ri-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: attackers.oauth,
    now,
    leaseMs: 90_000,
    metadata: {
      schema_version: "pulse-runtime-generation-lease-v1",
      runtime_instance_id: attackers.runtime,
      process_id: 9999,
      process_started_at: "2026-08-02T09:59:59.000Z",
      authority_fingerprint: attackers.sha,
    },
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "LIVE",
    expected: expected({
      database_identity_sha256: databaseIdentitySha256(dbPath),
    }),
    now,
  });
  const serialised = JSON.stringify(result);

  assert.equal(result.ok, false);
  for (const attacker of Object.values(attackers)) {
    assert.equal(serialised.includes(attacker), false, attacker);
  }
});

test("QUIESCENT evidence never echoes lease metadata even when it is well formed", (t) => {
  const { db, dbPath, repos } = fixture(t);
  const runtime = "ri-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  repos.runtimeLeases.acquire({
    name: "scheduler:primary",
    ownerId: "expired-private-owner",
    now: new Date("2026-08-02T08:00:00.000Z"),
    leaseMs: 90_000,
    metadata: {
      schema_version: "pulse-runtime-generation-lease-v1",
      runtime_instance_id: runtime,
      process_id: 9999,
      process_started_at: "2026-08-02T07:59:59.000Z",
      authority_fingerprint: "f".repeat(64),
    },
  });

  const result = inspectBoundedRuntimeDbAuthority({
    db,
    mode: "QUIESCENT",
    expected: {
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      database_identity_sha256: databaseIdentitySha256(dbPath),
    },
    now: new Date("2026-08-02T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(runtime), false);
  for (const key of [
    "schema_version",
    "runtime_instance_id",
    "process_id",
    "process_started_at",
    "authority_fingerprint",
    "operation",
  ]) {
    assert.equal(Object.hasOwn(result.evidence.scheduler_lease, key), false, key);
  }
});

test("publisher acquisition rejects pre-existing reconciliation for a fresh dispatch", (t) => {
  const state = publisherFixture(t);
  state.db.prepare(
    `INSERT INTO publication_lifecycle_events
       (story_id, platform, from_state, to_state, event_reason,
        retryability_class, actor_type, evidence_json, idempotency_key)
     VALUES (?, 'youtube', 'SCHEDULED', 'RECONCILIATION_REQUIRED',
             'pre-existing reconciliation', 'manual_reconcile', 'system', '{}', ?)`,
  ).run(
    state.admission.story_id,
    `${state.admission.dispatch_idempotency_key}:reconcile`,
  );
  state.db.prepare(
    `UPDATE platform_publication_state
     SET lifecycle_state = 'RECONCILIATION_REQUIRED'
     WHERE story_id = ? AND platform = 'youtube'`,
  ).run(state.admission.story_id);

  assert.throws(
    () =>
      acquirePublisherLease({
        db: state.db,
        leases: state.repos.runtimeLeases,
        operation: "publish_next_story",
        runtimeAuthority: state.runtimeAuthority,
        claimedJobAuthority: state.claimedJobAuthority,
        admissionContext: state.admission,
      }),
    /publisher_start_lifecycle_authority_invalid/,
  );
  assert.equal(state.repos.runtimeLeases.get("publisher:global"), null);
});

test("publisher recovery binds a separate exact recovery phase", (t) => {
  const state = publisherFixture(t, {
    operation: "verify_governed_youtube_scheduled_replay",
  });
  const recoveryStart = state.db
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, event_reason,
          retryability_class, actor_type, evidence_json, idempotency_key)
       VALUES (?, 'youtube', 'SCHEDULED', 'RECONCILIATION_REQUIRED',
               'recovery required', 'manual_reconcile', 'system', '{}', ?)`,
    )
    .run(
      state.admission.story_id,
      `${state.admission.dispatch_idempotency_key}:recovery:start`,
    );
  state.db.prepare(
    `UPDATE platform_publication_state
     SET lifecycle_state = 'RECONCILIATION_REQUIRED'
     WHERE story_id = ? AND platform = 'youtube'`,
  ).run(state.admission.story_id);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-recovery-private-owner",
    operation: "verify_governed_youtube_scheduled_replay",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });
  const metadata = JSON.parse(
    state.db
      .prepare(
        "SELECT metadata FROM main.runtime_leases WHERE name = 'publisher:global'",
      )
      .get().metadata,
  );
  assert.equal(metadata.publisher_phase, "RECOVERY_COMPENSATION");
  assert.equal(
    metadata.start_lifecycle_event_id,
    Number(recoveryStart.lastInsertRowid),
  );
  assert.equal(metadata.start_lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.match(metadata.start_lifecycle_sha256, /^[a-f0-9]{64}$/);

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, true);
});

test("publisher continuation accepts a recovery event ordered after acquisition", (t) => {
  const state = publisherFixture(t, {
    operation: "verify_governed_youtube_private_prestage",
  });
  const objectCreated = state.db
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, event_reason,
          retryability_class, actor_type, evidence_json, idempotency_key)
       VALUES (?, 'youtube', 'SCHEDULED', 'PLATFORM_OBJECT_CREATED',
               'private object created', 'none', 'system', '{}', ?)`,
    )
    .run(
      state.admission.story_id,
      `${state.admission.dispatch_idempotency_key}:object-created`,
    );
  state.db.prepare(
    `UPDATE platform_publication_state
     SET lifecycle_state = 'PLATFORM_OBJECT_CREATED'
     WHERE story_id = ? AND platform = 'youtube'`,
  ).run(state.admission.story_id);
  acquirePublisherLease({
    db: state.db,
    leases: state.repos.runtimeLeases,
    ownerId: "publisher-continuation-private-owner",
    operation: "verify_governed_youtube_private_prestage",
    now: state.now,
    leaseMs: 90_000,
    runtimeAuthority: state.runtimeAuthority,
    claimedJobAuthority: state.claimedJobAuthority,
    admissionContext: state.admission,
  });
  const metadata = JSON.parse(
    state.db
      .prepare(
        "SELECT metadata FROM main.runtime_leases WHERE name = 'publisher:global'",
      )
      .get().metadata,
  );
  assert.equal(metadata.publisher_phase, "CONTINUATION");
  assert.equal(
    metadata.start_lifecycle_event_id,
    Number(objectCreated.lastInsertRowid),
  );

  state.db.prepare(
    `INSERT INTO publication_lifecycle_events
       (story_id, platform, from_state, to_state, event_reason,
        retryability_class, actor_type, evidence_json, idempotency_key)
     VALUES (?, 'youtube', 'PLATFORM_OBJECT_CREATED',
             'RECONCILIATION_REQUIRED', 'verification uncertain',
             'manual_reconcile', 'system', '{}', ?)`,
  ).run(
    state.admission.story_id,
    `${state.admission.dispatch_idempotency_key}:reconcile`,
  );
  state.db.prepare(
    `UPDATE platform_publication_state
     SET lifecycle_state = 'RECONCILIATION_REQUIRED'
     WHERE story_id = ? AND platform = 'youtube'`,
  ).run(state.admission.story_id);

  const result = inspectBoundedRuntimeDbAuthority({
    db: state.db,
    mode: "LIVE",
    expected: state.expected,
    now: state.now,
  });

  assert.equal(result.ok, true);
});

for (const invalidClaim of [
  {
    name: "attempt zero",
    apply(state) {
      state.db.prepare("UPDATE main.jobs SET attempt_count = 0").run();
      state.db.prepare("UPDATE main.job_runs SET attempt = 0").run();
    },
  },
  {
    name: "an unsafe job ID",
    apply(state) {
      state.db.pragma("defer_foreign_keys = ON");
      state.db
        .transaction(() => {
          state.db
            .prepare("UPDATE main.job_runs SET job_id = 9007199254740992")
            .run();
          state.db
            .prepare("UPDATE main.jobs SET id = 9007199254740992")
            .run();
        })
        .immediate();
    },
  },
  {
    name: "an unsafe run ID",
    apply(state) {
      state.db.prepare("UPDATE main.job_runs SET id = 9007199254740992").run();
    },
  },
  {
    name: "a changed current claim token",
    apply(state) {
      state.db.prepare("UPDATE main.job_runs SET id = 777").run();
    },
  },
]) {
  test(`rejects ${invalidClaim.name} in the runtime claim set`, (t) => {
    const state = liveFixture(t);
    invalidClaim.apply(state);

    const result = inspectBoundedRuntimeDbAuthority({
      db: state.db,
      mode: "LIVE",
      expected: state.expected,
      now: state.now,
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.blockers.includes("runtime_db_active_job_run_binding_mismatch") ||
        result.blockers.includes("runtime_db_runtime_claim_set_mismatch"),
      JSON.stringify(result.blockers),
    );
  });
}
