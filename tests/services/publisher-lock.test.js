"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");
const {
  acquirePublisherLease,
  defaultPublisherOwnerId,
  heartbeatPublisherLease,
  releasePublisherLease,
  runWithPublisherLease,
} = require("../../lib/services/publisher-lock");
const { handlers, renderPublishSummary } = require("../../lib/job-handlers");
const boundedAuthority = require("../../lib/stabilisation/bounded-runtime-db-authority");

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
    )
  `);
  return { db, leases: bind(db) };
}

function boundPublisherFixture() {
  const state = fixture();
  state.db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT,
      from_state TEXT,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  const admission = {
    channel_id: "pulse-gaming",
    story_id: "story-73",
    platform: "youtube",
    scheduled_for: "2026-08-02T19:00:00.000Z",
    dispatch_idempotency_key: "publish:2026-08-02:19",
    request_fingerprint: "b".repeat(64),
    runway_lock_sha256: "c".repeat(64),
  };
  const inserted = state.db
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, evidence_json,
          idempotency_key, created_at)
       VALUES (?, 'youtube', 'READY', 'SCHEDULED', ?, ?, ?)`,
    )
    .run(
      admission.story_id,
      JSON.stringify({
        channel_id: admission.channel_id,
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: "2026-08-02T18:55:00.000Z",
        scheduled_for: admission.scheduled_for,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: admission.dispatch_idempotency_key,
        request_fingerprint: admission.request_fingerprint,
        runway_lock_sha256: admission.runway_lock_sha256,
      }),
      `${admission.dispatch_idempotency_key}:lifecycle:SCHEDULED`,
      "2026-08-02T18:55:00.000Z",
    );
  admission.scheduled_event_id = Number(inserted.lastInsertRowid);
  state.db
    .prepare(
      `INSERT INTO platform_publication_state
         (story_id, platform, lifecycle_state)
       VALUES (?, 'youtube', 'SCHEDULED')`,
    )
    .run(admission.story_id);
  return { ...state, admission };
}

function exactClaimedPublisherFixture({
  jobKind = "dispatch_governed_publication",
} = {}) {
  const state = boundPublisherFixture();
  state.db.exec(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      story_id TEXT NOT NULL,
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
  const job = {
    id: 73,
    kind: jobKind,
    channel_id: state.admission.channel_id,
    story_id: state.admission.story_id,
    payload: JSON.stringify({
      story_id: state.admission.story_id,
      scheduled_event_id: state.admission.scheduled_event_id,
    }),
    run_at: "2026-08-02 18:55:00",
    status: "claimed",
    attempt_count: 1,
    claimed_by: "server-ri-11111111-critical_publication-1",
    lease_until: "2999-08-02 19:30:00",
    idempotency_key: `job:${jobKind}:73`,
    claim_token: "97",
  };
  state.db
    .prepare(
      `INSERT INTO jobs
         (id, kind, channel_id, story_id, payload, run_at, status,
         attempt_count, claimed_by, lease_until, idempotency_key)
       VALUES
         (@id, @kind, @channel_id, @story_id, @payload, @run_at, @status,
          @attempt_count, @claimed_by, @lease_until, @idempotency_key)`,
    )
    .run(job);
  state.db
    .prepare(
      `INSERT INTO job_runs
         (id, job_id, worker_id, attempt, status, finished_at)
       VALUES (?, ?, ?, ?, 'running', NULL)`,
    )
    .run(97, job.id, job.claimed_by, job.attempt_count);
  installSchedulerAuthority(state);
  return { ...state, job };
}

const RUNTIME_AUTHORITY = Object.freeze({
  runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
  child_pid: process.pid,
  child_started_at: "2026-08-02T10:00:00.000Z",
  authority_fingerprint: "a".repeat(64),
});

function schedulerMetadata(authority = RUNTIME_AUTHORITY) {
  return {
    purpose: "single_owner_scheduler_dispatch",
    ...boundedAuthority.buildRuntimeGenerationLeaseMetadata(authority),
  };
}

function installSchedulerAuthority(
  state,
  {
    authority = RUNTIME_AUTHORITY,
    ownerId = "scheduler-private-current-generation",
    now = new Date(),
  } = {},
) {
  const acquired = state.leases.acquire({
    name: "scheduler:primary",
    ownerId,
    now,
    leaseMs: 90_000,
    metadata: schedulerMetadata(authority),
    replaceSameOwner: false,
  });
  assert.equal(acquired.acquired, true);
}

function scheduledDispatchFixture({
  storyId = "publisher-lock-story",
  scheduledFor = "2026-07-27T09:00:00.000Z",
} = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  db.prepare(
    `
    INSERT INTO publication_lifecycle_events
      (story_id, platform, to_state, evidence_json, created_at)
    VALUES (?, 'youtube', 'SCHEDULED', ?, ?)
  `,
  ).run(
    storyId,
    JSON.stringify({
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: "2026-07-27T08:55:00.000Z",
      scheduled_for: scheduledFor,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: `youtube:${storyId}:${scheduledFor}`,
      request_fingerprint: "a".repeat(64),
    }),
    "2026-07-27T08:55:00.000Z",
  );
  db.prepare(
    `
    INSERT INTO platform_publication_state
      (story_id, platform, lifecycle_state)
    VALUES (?, 'youtube', 'SCHEDULED')
  `,
  ).run(storyId);
  return db;
}

test("publisher owner identity is unique for every operation session", () => {
  const first = defaultPublisherOwnerId();
  const second = defaultPublisherOwnerId();
  assert.notEqual(first, second);
  assert.match(first, /^publisher:.+:\d+:[0-9a-f-]{36}$/i);
});

test("admitted publication v2 canonicalises both field shapes and rejects every unsafe event id", () => {
  assert.equal(
    typeof boundedAuthority.buildAdmittedPublicationOperation,
    "function",
    "Task 3b must expose the single production normaliser used by every publisher path",
  );
  const snake = {
    channel_id: "pulse-gaming",
    story_id: "story-73",
    platform: "youtube",
    scheduled_event_id: 73,
    scheduled_for: "2026-08-02T19:00:00.000Z",
    dispatch_idempotency_key: "publish:2026-08-02:19",
    request_fingerprint: "b".repeat(64),
    runway_lock_sha256: "c".repeat(64),
  };
  const camel = {
    channelId: snake.channel_id,
    storyId: snake.story_id,
    platform: snake.platform,
    scheduledEventId: snake.scheduled_event_id,
    scheduledFor: snake.scheduled_for,
    dispatchIdempotencyKey: snake.dispatch_idempotency_key,
    requestFingerprint: snake.request_fingerprint,
    runwayLockSha256: snake.runway_lock_sha256,
  };
  const expected = {
    schema_version: "pulse-admitted-publication-operation-v2",
    ...snake,
  };
  assert.deepEqual(
    boundedAuthority.buildAdmittedPublicationOperation(
      "publish_next_story",
      snake,
    ),
    expected,
  );
  assert.deepEqual(
    boundedAuthority.buildAdmittedPublicationOperation(
      "publish_next_story",
      camel,
    ),
    expected,
  );
  for (const invalid of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "73",
    true,
    "junk",
  ]) {
    for (const shape of [
      { ...snake, scheduled_event_id: invalid },
      { ...camel, scheduledEventId: invalid },
    ]) {
      assert.throws(
        () =>
          boundedAuthority.buildAdmittedPublicationOperation(
            "publish_next_story",
            shape,
          ),
        /publisher_admitted_operation_authority_invalid/,
        `event id ${String(invalid)} must fail closed`,
      );
    }
  }
});

test("claimed durable jobs authorise exactly the closed post-admission operation map", () => {
  assert.equal(
    typeof boundedAuthority.buildClaimedJobAuthority,
    "function",
  );
  assert.equal(
    typeof boundedAuthority.assertClaimedJobAuthority,
    "function",
  );
  assert.equal(
    typeof boundedAuthority.claimedJobKindRequiresPublisherAuthority,
    "function",
  );
  const allowed = [
    ["dispatch_governed_publication", "publish_next_story"],
    ["prestage_governed_youtube_release", "prestage_governed_youtube_release"],
    ["governed_youtube_runway_t60", "verify_governed_youtube_private_prestage"],
    ["governed_youtube_runway_t60", "disarm_governed_youtube_scheduled_release"],
    ["verify_governed_youtube_release_tminus15", "arm_governed_youtube_scheduled_release"],
    ["verify_governed_youtube_release_tminus15", "verify_governed_youtube_scheduled_replay"],
    ["verify_governed_youtube_release_tminus15", "disarm_governed_youtube_scheduled_release"],
    ["verify_governed_youtube_release_t0", "confirm_governed_youtube_scheduled_release"],
  ];
  const allOperations = [...new Set(allowed.map(([, operation]) => operation))];
  for (const jobKind of new Set(allowed.map(([jobKind]) => jobKind))) {
    assert.equal(
      boundedAuthority.claimedJobKindRequiresPublisherAuthority(jobKind),
      true,
    );
  }
  for (const jobKind of ["hunt", "publish", "", null, true]) {
    assert.equal(
      boundedAuthority.claimedJobKindRequiresPublisherAuthority(jobKind),
      false,
    );
  }
  for (const [jobKind, operation] of allowed) {
    const { db, job } = exactClaimedPublisherFixture({ jobKind });
    const authority = boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: job.claim_token,
    });
    assert.equal(Object.isFrozen(authority), true);
    assert.equal(Object.hasOwn(authority, "claim_token"), false);
    assert.equal(Object.hasOwn(authority, "claim_run_id"), false);
    assert.equal(
      boundedAuthority.assertClaimedJobAuthority({
        db,
        authority,
        operation,
      }),
      true,
    );
    for (const rejectedOperation of allOperations.filter(
      (candidate) =>
        !allowed.some(
          ([allowedKind, allowedOperation]) =>
            allowedKind === jobKind && allowedOperation === candidate,
        ),
    )) {
      assert.throws(
        () =>
          boundedAuthority.assertClaimedJobAuthority({
            db,
            authority,
            operation: rejectedOperation,
          }),
        /publisher_claimed_job_authority_invalid/,
      );
    }
    db.close();
  }

  const { db, job } = exactClaimedPublisherFixture({ jobKind: "publish" });
  const legacy = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  assert.throws(
    () =>
      boundedAuthority.assertClaimedJobAuthority({
        db,
        authority: legacy,
        operation: "publish_next_story",
      }),
    /publisher_claimed_job_authority_invalid/,
  );
  db.close();
});

test("expired or NULL claimed-job leases never produce publisher authority", () => {
  for (const leaseUntil of [null, "2000-01-01 00:00:00"]) {
    const { db, job } = exactClaimedPublisherFixture();
    db.prepare("UPDATE jobs SET lease_until = ? WHERE id = ?").run(
      leaseUntil,
      job.id,
    );
    assert.throws(
      () =>
        boundedAuthority.buildClaimedJobAuthority({
          db,
          jobId: job.id,
          workerId: job.claimed_by,
          claimToken: job.claim_token,
        }),
      /publisher_claimed_job_authority_invalid/,
    );
    db.close();
  }
});

test("claimed-job authority enforces strict job-id type and every closed exposed field", () => {
  const { db, job } = exactClaimedPublisherFixture();
  const authority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  for (const jobId of ["73", true, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        boundedAuthority.assertClaimedJobAuthority({
          db,
          authority: { ...authority, job_id: jobId },
          operation: "publish_next_story",
        }),
      /publisher_claimed_job_authority_invalid/,
    );
  }
  for (const drift of [
    { channel_id: "stacked" },
    { story_id: "another-story" },
    { run_at: "2026-08-02T19:00:00.000Z" },
    { attempt_count: 2 },
    { unexpected: true },
  ]) {
    assert.throws(
      () =>
        boundedAuthority.assertClaimedJobAuthority({
          db,
          authority: { ...authority, ...drift },
          operation: "publish_next_story",
        }),
      /publisher_claimed_job_authority_invalid/,
    );
  }
  db.close();
});

test("claimed-job authority accepts only canonical positive claim tokens", () => {
  const { db, job } = exactClaimedPublisherFixture();
  assert.doesNotThrow(() =>
    boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: job.claim_token,
    }),
  );
  assert.doesNotThrow(() =>
    boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: Number(job.claim_token),
    }),
  );
  for (const claimToken of [
    ` ${job.claim_token}`,
    `${job.claim_token} `,
    `+${job.claim_token}`,
    `${job.claim_token}.0`,
    `${job.claim_token}e0`,
    true,
    false,
    null,
    undefined,
  ]) {
    assert.throws(
      () =>
        boundedAuthority.buildClaimedJobAuthority({
          db,
          jobId: job.id,
          workerId: job.claimed_by,
          claimToken,
        }),
      /publisher_claimed_job_authority_invalid/,
      `${String(claimToken)} must not coerce to a claim generation`,
    );
  }
  db.close();
});

test("bound publisher task requires the current active scheduler generation", async () => {
  const mutations = [
    {
      name: "missing",
      mutate(db) {
        db.prepare("DELETE FROM runtime_leases WHERE name = ?").run(
          "scheduler:primary",
        );
      },
    },
    {
      name: "expired",
      mutate(db) {
        db.prepare(
          `UPDATE runtime_leases
           SET acquired_at = ?, heartbeat_at = ?, expires_at = ?
           WHERE name = ?`,
        ).run(
          "2000-01-01T00:00:00.000Z",
          "2000-01-01T00:00:00.000Z",
          "2000-01-01T00:01:30.000Z",
          "scheduler:primary",
        );
      },
    },
    {
      name: "metadata-drifted",
      mutate(db) {
        const row = db
          .prepare("SELECT metadata FROM runtime_leases WHERE name = ?")
          .get("scheduler:primary");
        const metadata = JSON.parse(row.metadata);
        metadata.authority_fingerprint = "d".repeat(64);
        db.prepare("UPDATE runtime_leases SET metadata = ? WHERE name = ?").run(
          JSON.stringify(metadata),
          "scheduler:primary",
        );
      },
    },
    {
      name: "replacement-generation",
      mutate(db) {
        const now = new Date();
        const replacement = {
          ...RUNTIME_AUTHORITY,
          runtime_instance_id:
            "ri-99999999-8888-4777-8666-555555555555",
          authority_fingerprint: "e".repeat(64),
        };
        db.prepare(
          `UPDATE runtime_leases
           SET owner_id = ?, acquired_at = ?, heartbeat_at = ?,
               expires_at = ?, metadata = ?
           WHERE name = ?`,
        ).run(
          "scheduler-private-replacement-generation",
          now.toISOString(),
          now.toISOString(),
          new Date(now.getTime() + 90_000).toISOString(),
          JSON.stringify(schedulerMetadata(replacement)),
          "scheduler:primary",
        );
      },
    },
  ];

  for (const mutation of mutations) {
    const { db, leases, admission, job } = exactClaimedPublisherFixture();
    const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: job.claim_token,
    });
    mutation.mutate(db);
    let taskCalls = 0;

    const result = await runWithPublisherLease({
      db,
      leases,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
      task: async () => {
        taskCalls += 1;
      },
    });

    assert.equal(taskCalls, 0, mutation.name);
    assert.equal(result.top_reason, "durable_publish_lock_unavailable");
    assert.equal(leases.get("publisher:global"), null);
    db.close();
  }
});

test("publisher heartbeat fails when the scheduler generation is replaced", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const lease = acquirePublisherLease({
    db,
    leases,
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
  });
  const replacement = {
    ...RUNTIME_AUTHORITY,
    runtime_instance_id: "ri-99999999-8888-4777-8666-555555555555",
    authority_fingerprint: "e".repeat(64),
  };
  db.prepare("UPDATE runtime_leases SET owner_id = ?, metadata = ? WHERE name = ?")
    .run(
      "scheduler-private-heartbeat-replacement",
      JSON.stringify(schedulerMetadata(replacement)),
      "scheduler:primary",
    );

  assert.equal(
    heartbeatPublisherLease({
      db,
      leases,
      lease,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      bound: true,
    }),
    false,
  );
  releasePublisherLease({ leases, lease });
  db.close();
});

test("outer publisher channel must equal the claimed and admitted channel", async () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  let taskCalls = 0;
  const result = await runWithPublisherLease({
    db,
    leases,
    channelId: "stacked",
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
    env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
    task: async () => {
      taskCalls += 1;
    },
  });

  assert.equal(taskCalls, 0);
  assert.equal(result.top_reason, "durable_publish_lock_unavailable");
  assert.equal(leases.get("publisher:global"), null);
  db.close();
});

test("same-owner replacement and metadata drift fence the old handle and preserve its successor", async () => {
  const { db, leases } = fixture();
  const ownerId = "publisher-same-owner-generation";
  let irreversibleCalls = 0;
  const result = await runWithPublisherLease({
    leases,
    ownerId,
    channelId: "pulse-gaming",
    operation: "publish_next_story",
    task: async ({ assertHealthy }) => {
      assertHealthy();
      const successor = leases.acquire({
        name: "publisher:global",
        ownerId,
        leaseMs: 60_000,
        metadata: { generation: "successor" },
      });
      assert.equal(successor.acquired, true);
      assertHealthy();
      irreversibleCalls += 1;
    },
  });
  assert.equal(irreversibleCalls, 0);
  assert.equal(result.top_reason, "durable_publish_lease_lost");
  const successor = leases.get("publisher:global");
  assert.equal(JSON.parse(successor.metadata).generation, "successor");
  db.close();
});

test("expired same-owner reacquisition fences the old handle even for identical bound authority", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const ownerId = "publisher-stable-owner-reacquisition";
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const authority = {
    db,
    leases,
    ownerId,
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
  };
  const first = acquirePublisherLease(authority);
  assert.equal(first.acquired, true);
  db.prepare("UPDATE runtime_leases SET expires_at = ? WHERE name = ?").run(
    "2000-01-01T00:00:00.000Z",
    "publisher:global",
  );

  const successor = acquirePublisherLease(authority);
  assert.equal(successor.acquired, true);
  const successorRow = leases.get("publisher:global");
  assert.match(
    JSON.parse(successorRow.metadata).lease_instance_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    heartbeatPublisherLease({
      ...authority,
      lease: first,
      bound: true,
    }),
    false,
  );
  assert.equal(releasePublisherLease({ leases, lease: first }), false);
  assert.deepEqual(leases.get("publisher:global"), successorRow);
  assert.equal(releasePublisherLease({ leases, lease: successor }), true);
  db.close();
});

test("publisher acquisition never replaces a live lease held by the same owner", () => {
  const { db, leases } = fixture();
  const ownerId = "publisher-no-same-owner-replacement";
  const first = acquirePublisherLease({ leases, ownerId });
  const second = acquirePublisherLease({ leases, ownerId });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  db.close();
});

test("exported publisher lease handles keep all raw lease identity closure-private", () => {
  const { db, leases } = fixture();
  const ownerId = "publisher-exported-handle-private-owner";
  const lease = acquirePublisherLease({
    leases,
    ownerId,
    metadata: { oauth_access_token: "must-not-serialise" },
  });
  const serialised = JSON.stringify(lease);
  assert.equal(serialised.includes(ownerId), false);
  assert.equal(serialised.includes("must-not-serialise"), false);
  assert.deepEqual(Reflect.ownKeys(lease).sort(), [
    "acquired",
    "current_lock_owner_sha256",
    "expires_at",
  ]);
  assert.equal(lease.owner_id, undefined);
  assert.equal(lease.metadata, undefined);
  assert.equal(lease.current_owner_id, undefined);
  assert.equal(lease.lease_name, undefined);
  assert.equal(String(lease).includes(ownerId), false);
  assert.equal(String(lease).includes("must-not-serialise"), false);
  releasePublisherLease({ leases, lease });
  assert.equal(leases.get("publisher:global"), null);
  db.close();
});

test("publisher task context cannot serialise raw lease owner or metadata", async () => {
  const { db, leases } = fixture();
  const privateOwner = "publisher-owner-must-stay-private";
  const result = await runWithPublisherLease({
    leases,
    ownerId: privateOwner,
    metadata: {
      claim_token: "raw-claim-token",
      oauth_access_token: "oauth-shaped-secret",
      environment_value: "private-env-value",
    },
    task: async (context) => ({ context }),
  });
  const serialised = JSON.stringify(result);
  assert.equal(Object.hasOwn(result.context, "lease"), false);
  assert.equal(serialised.includes(privateOwner), false);
  assert.equal(serialised.includes("raw-claim-token"), false);
  assert.equal(serialised.includes("oauth-shaped-secret"), false);
  assert.equal(serialised.includes("private-env-value"), false);
  db.close();
});

test("concurrent publish operations are excluded by the durable lease", async () => {
  const { db, leases } = fixture();
  let releaseFirst;
  const firstCanFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_next_story",
    task: async ({ assertHealthy }) => {
      assertHealthy();
      await firstCanFinish;
      return { completed: true };
    },
  });
  const second = await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_batch",
    task: async () => {
      throw new Error("second_task_must_not_run");
    },
  });
  assert.equal(second.publish_dispatch_blocked, true);
  assert.equal(second.top_reason, "durable_publish_lock_unavailable");
  releaseFirst();
  assert.deepEqual(await first, { completed: true });
  db.close();
});

test("lease loss blocks subsequent irreversible work and releases cleanly", async () => {
  const { db, leases } = fixture();
  let effects = 0;
  const ownerId = "publisher-loss-test-owner";
  const result = await runWithPublisherLease({
    leases,
    ownerId,
    channelId: "pulse-gaming",
    operation: "publish_next_story",
    task: async ({ assertHealthy }) => {
      assertHealthy();
      effects += 1;
      leases.release("publisher:global", ownerId);
      assertHealthy();
      effects += 1;
    },
  });
  assert.equal(effects, 1);
  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lease_lost");
  db.close();
});

test("lease-loss blocking preserves only the compensation metadata needed after an irreversible boundary", async () => {
  const { db, leases } = fixture();
  const ownerId = "publisher-compensation-loss-owner";
  const result = await runWithPublisherLease({
    leases,
    ownerId,
    channelId: "pulse-gaming",
    operation: "arm_governed_youtube_scheduled_release",
    task: async ({ assertHealthy }) => {
      leases.release("publisher:global", ownerId);
      try {
        assertHealthy();
      } catch (error) {
        error.updateAttemptStarted = true;
        error.createAttemptStarted = true;
        error.remoteDisarmRequired = true;
        error.platformContacted = true;
        error.reconciliationRequired = true;
        error.externalId = "ytOrphan_01";
        error.secret = "must-not-cross-lock-boundary";
        throw error;
      }
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lease_lost");
  assert.equal(result.updateAttemptStarted, true);
  assert.equal(result.createAttemptStarted, true);
  assert.equal(result.remoteDisarmRequired, true);
  assert.equal(result.platformContacted, true);
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.externalId, "ytOrphan_01");
  assert.equal(Object.hasOwn(result, "secret"), false);
  db.close();
});

test("lease-loss blocking omits token-shaped compensation identifiers", async () => {
  const { db, leases } = fixture();
  const privateExternalIds = [
    "ya29rawOAuthSecretMaterial_ABCDEF-0123456789",
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    "AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz",
    "ya29.raw-oauth-shaped-secret",
  ];
  for (const [index, privateExternalId] of privateExternalIds.entries()) {
    const ownerId = `publisher-unsafe-external-id-owner-${index}`;
    const result = await runWithPublisherLease({
      leases,
      ownerId,
      operation: "arm_governed_youtube_scheduled_release",
      task: async ({ assertHealthy }) => {
        leases.release("publisher:global", ownerId);
        try {
          assertHealthy();
        } catch (error) {
          error.updateAttemptStarted = true;
          error.remoteDisarmRequired = true;
          error.externalId = privateExternalId;
          throw error;
        }
      },
    });

    assert.equal(result.updateAttemptStarted, true);
    assert.equal(result.remoteDisarmRequired, true);
    assert.equal(Object.hasOwn(result, "externalId"), false);
    assert.equal(JSON.stringify(result).includes(privateExternalId), false);
  }
  db.close();
});

test("publisher lease metadata describes the real operation only", async () => {
  const { db, leases } = fixture();
  await runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    operation: "publish_batch",
    task: async () => {
      const metadata = JSON.parse(leases.get("publisher:global").metadata);
      assert.equal(metadata.operation, "publish_batch");
      assert.equal(metadata.purpose, "single_flight_platform_dispatch");
      assert.equal(Object.hasOwn(metadata, "profile"), false);
    },
  });
  db.close();
});

test("publisher lease metadata binds one runtime generation to one admitted operation", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  assert.equal(
    typeof boundedAuthority.buildClaimedJobAuthority,
    "function",
  );
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const lease = acquirePublisherLease({
    db,
    leases,
    ownerId: "publisher-runtime-private-owner",
    operation: "publish_next_story",
    runtimeAuthority: {
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      child_pid: process.pid,
      child_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
    },
    admissionContext: admission,
    claimedJobAuthority,
    metadata: {
      channel_id: "stacked",
      operation: "publish_batch",
      process_id: 1,
      purpose: "caller_override",
      schema_version: "caller-schema",
      runtime_instance_id: "ri-99999999-9999-4999-8999-999999999999",
      admitted_operation: { caller: "forged" },
      claim_token: "must-not-be-stored",
      oauth_access_token: "must-not-be-stored",
    },
  });

  const metadata = JSON.parse(leases.get("publisher:global").metadata);
  assert.deepEqual(
    {
      ...metadata,
      admitted_operation_sha256: undefined,
      start_lifecycle_sha256: undefined,
      lease_instance_sha256: undefined,
    },
    {
      channel_id: "pulse-gaming",
      operation: "publish_next_story",
      process_id: process.pid,
      purpose: "single_flight_platform_dispatch",
      schema_version: "pulse-runtime-generation-publisher-lease-v1",
      runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
      process_started_at: "2026-08-02T10:00:00.000Z",
      authority_fingerprint: "a".repeat(64),
      admitted_operation: {
        schema_version: "pulse-admitted-publication-operation-v2",
        channel_id: "pulse-gaming",
        story_id: "story-73",
        platform: "youtube",
        scheduled_event_id: 1,
        scheduled_for: "2026-08-02T19:00:00.000Z",
        dispatch_idempotency_key: "publish:2026-08-02:19",
        request_fingerprint: "b".repeat(64),
        runway_lock_sha256: "c".repeat(64),
      },
      claimed_job_authority_sha256:
        claimedJobAuthority.claimed_job_authority_sha256,
      publisher_operation_set_sha256:
        "d703bda9c8e6c97ca0a68e0c45bc9a54d6e8bb3543b6002ea766a74781d1f333",
      publisher_phase: "FRESH_DISPATCH",
      start_lifecycle_event_id: 1,
      start_lifecycle_state: "SCHEDULED",
      start_lifecycle_sha256: undefined,
      admitted_operation_sha256: undefined,
      lease_instance_sha256: undefined,
    },
  );
  assert.match(metadata.admitted_operation_sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.start_lifecycle_sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.lease_instance_sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(metadata, "claim_token"), false);
  assert.equal(Object.hasOwn(metadata, "oauth_access_token"), false);

  releasePublisherLease({ leases, lease });
  db.close();
});

test("publisher metadata inspection and heartbeat reject a string event id even with recomputed hashes", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const lease = acquirePublisherLease({
    db,
    leases,
    ownerId: "publisher-metadata-type-fence",
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
  });
  const metadata = JSON.parse(leases.get("publisher:global").metadata);
  metadata.admitted_operation.scheduled_event_id = String(
    metadata.admitted_operation.scheduled_event_id,
  );
  metadata.admitted_operation_sha256 = sha256(
    stableJson({
      operation: metadata.operation,
      admitted_operation: metadata.admitted_operation,
      start_lifecycle: {
        publisher_phase: metadata.publisher_phase,
        start_lifecycle_event_id: metadata.start_lifecycle_event_id,
        start_lifecycle_state: metadata.start_lifecycle_state,
        start_lifecycle_sha256: metadata.start_lifecycle_sha256,
      },
    }),
  );
  const tamperedRaw = JSON.stringify(metadata);
  db.prepare("UPDATE runtime_leases SET metadata = ? WHERE name = ?").run(
    tamperedRaw,
    "publisher:global",
  );
  assert.equal(boundedAuthority.publisherAdmissionMatches(db, metadata), false);
  assert.equal(
    heartbeatPublisherLease({
      db,
      leases,
      lease,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      bound: true,
    }),
    false,
  );
  db.close();
});

test("publisher metadata inspection and heartbeat require the exact active claimed-job digest", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const lease = acquirePublisherLease({
    db,
    leases,
    ownerId: "publisher-claimed-digest-fence",
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
  });
  const metadata = JSON.parse(leases.get("publisher:global").metadata);
  metadata.claimed_job_authority_sha256 = "f".repeat(64);
  const tamperedRaw = JSON.stringify(metadata);
  db.prepare("UPDATE runtime_leases SET metadata = ? WHERE name = ?").run(
    tamperedRaw,
    "publisher:global",
  );
  assert.equal(boundedAuthority.publisherAdmissionMatches(db, metadata), false);
  assert.equal(
    heartbeatPublisherLease({
      db,
      leases,
      lease,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      bound: true,
    }),
    false,
  );
  db.close();
});

test("publisher metadata inspection rejects an outer channel contradiction", () => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  const lease = acquirePublisherLease({
    db,
    leases,
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
  });
  const metadata = JSON.parse(leases.get("publisher:global").metadata);
  metadata.channel_id = "stacked";

  assert.equal(boundedAuthority.publisherAdmissionMatches(db, metadata), false);
  releasePublisherLease({ leases, lease });
  db.close();
});

test("durable PLATFORM_SCHEDULE_DISARMED is a terminal continuation only for disarm", () => {
  const { db, admission } = boundPublisherFixture();
  db.prepare(
    `INSERT INTO publication_lifecycle_events
       (story_id, platform, from_state, to_state, evidence_json,
        idempotency_key, created_at)
     VALUES (?, 'youtube', 'PLATFORM_SCHEDULED',
             'PLATFORM_SCHEDULE_DISARMED', ?, ?, ?)`,
  ).run(
    admission.story_id,
    JSON.stringify({
      schedule_disarm_confirmed: true,
      channel_id: admission.channel_id,
      runway_lock_sha256: admission.runway_lock_sha256,
    }),
    `${admission.dispatch_idempotency_key}:lifecycle:PLATFORM_SCHEDULE_DISARMED`,
    "2026-08-02T18:59:00.000Z",
  );
  db.prepare(
    `UPDATE platform_publication_state
     SET lifecycle_state = 'PLATFORM_SCHEDULE_DISARMED'
     WHERE story_id = ? AND platform = 'youtube'`,
  ).run(admission.story_id);

  let continuation = null;
  assert.doesNotThrow(() => {
    continuation = boundedAuthority.buildPublisherStartLifecycleBinding({
      db,
      operation: "disarm_governed_youtube_scheduled_release",
      admissionContext: admission,
    });
  });
  assert.equal(continuation.publisher_phase, "CONTINUATION");
  assert.equal(
    continuation.start_lifecycle_state,
    "PLATFORM_SCHEDULE_DISARMED",
  );
  for (const operation of [
    "publish_next_story",
    "prestage_governed_youtube_release",
    "verify_governed_youtube_private_prestage",
    "arm_governed_youtube_scheduled_release",
    "confirm_governed_youtube_scheduled_release",
    "verify_governed_youtube_scheduled_replay",
  ]) {
    assert.throws(
      () =>
        boundedAuthority.buildPublisherStartLifecycleBinding({
          db,
          operation,
          admissionContext: admission,
        }),
      /publisher_start_lifecycle_authority_invalid/,
    );
  }
  db.close();
});

test("scheduled admission cannot substitute another channel with otherwise identical evidence", () => {
  const { db, admission } = boundPublisherFixture();
  const row = db
    .prepare("SELECT evidence_json FROM publication_lifecycle_events WHERE id = ?")
    .get(admission.scheduled_event_id);
  const evidence = JSON.parse(row.evidence_json);
  evidence.channel_id = "stacked";
  db.prepare(
    "UPDATE publication_lifecycle_events SET evidence_json = ? WHERE id = ?",
  ).run(JSON.stringify(evidence), admission.scheduled_event_id);
  assert.throws(
    () =>
      boundedAuthority.buildPublisherStartLifecycleBinding({
        db,
        operation: "publish_next_story",
        admissionContext: admission,
      }),
    /publisher_start_lifecycle_authority_invalid/,
  );
  db.close();
});

test("bound publisher acquisition rejects a lease repository from another database before either database is written", (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publisher-lock-cross-db-"),
  );
  const authorityDb = new Database(path.join(root, "authority.db"));
  const leaseDb = new Database(path.join(root, "lease.db"));
  t.after(() => {
    authorityDb.close();
    leaseDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const db of [authorityDb, leaseDb]) {
    db.exec(`
      CREATE TABLE runtime_leases (
        name TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        metadata TEXT
      );
      CREATE TABLE publication_lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id TEXT NOT NULL,
        platform TEXT,
        from_state TEXT,
        to_state TEXT NOT NULL,
        evidence_json TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE platform_publication_state (
        story_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        PRIMARY KEY (story_id, platform)
      );
    `);
  }
  const admission = {
    story_id: "cross-db-story",
    platform: "youtube",
    scheduled_for: "2026-08-02T19:00:00.000Z",
    dispatch_idempotency_key: "publish:cross-db:19",
    request_fingerprint: "b".repeat(64),
    runway_lock_sha256: "c".repeat(64),
  };
  const inserted = authorityDb
    .prepare(
      `INSERT INTO publication_lifecycle_events
         (story_id, platform, from_state, to_state, evidence_json,
          idempotency_key, created_at)
       VALUES (?, 'youtube', 'READY', 'SCHEDULED', ?, ?, ?)`,
    )
    .run(
      admission.story_id,
      JSON.stringify({
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: "2026-08-02T18:55:00.000Z",
        scheduled_for: admission.scheduled_for,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: admission.dispatch_idempotency_key,
        request_fingerprint: admission.request_fingerprint,
        runway_lock_sha256: admission.runway_lock_sha256,
      }),
      `${admission.dispatch_idempotency_key}:lifecycle:SCHEDULED`,
      "2026-08-02T18:55:00.000Z",
    );
  admission.scheduled_event_id = Number(inserted.lastInsertRowid);
  authorityDb
    .prepare(
      `INSERT INTO platform_publication_state
         (story_id, platform, lifecycle_state)
       VALUES (?, 'youtube', 'SCHEDULED')`,
    )
    .run(admission.story_id);

  let caught = null;
  try {
    acquirePublisherLease({
      db: authorityDb,
      leases: bind(leaseDb),
      ownerId: "cross-db-owner",
      operation: "publish_next_story",
      runtimeAuthority: {
        runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
        child_pid: process.pid,
        child_started_at: "2026-08-02T10:00:00.000Z",
        authority_fingerprint: "a".repeat(64),
      },
      admissionContext: admission,
    });
  } catch (error) {
    caught = error;
  }

  assert.equal(
    authorityDb.prepare("SELECT COUNT(*) AS count FROM runtime_leases").get()
      .count,
    0,
  );
  assert.equal(
    leaseDb.prepare("SELECT COUNT(*) AS count FROM runtime_leases").get().count,
    0,
  );
  assert.match(
    String(caught?.message || ""),
    /publisher_runtime_lease_repository_database_mismatch/,
  );
});

test("same-database publisher acquisition rolls back lease and trigger writes atomically", (t) => {
  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE publisher_lease_write_probe (id INTEGER PRIMARY KEY);
    CREATE TRIGGER abort_publisher_lease_acquisition
    AFTER INSERT ON runtime_leases
    BEGIN
      INSERT INTO publisher_lease_write_probe(id) VALUES (NULL);
      SELECT RAISE(ABORT, 'forced publisher lease rollback');
    END;
  `);

  assert.throws(
    () =>
      acquirePublisherLease({
        db,
        leases,
        ownerId: "same-db-rollback-owner",
        operation: "publish_next_story",
        runtimeAuthority: {
          runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
          child_pid: process.pid,
          child_started_at: "2026-08-02T10:00:00.000Z",
          authority_fingerprint: "a".repeat(64),
        },
        claimedJobAuthority,
        admissionContext: admission,
      }),
    /forced publisher lease rollback/,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM runtime_leases").get().count,
    1,
  );
  assert.equal(leases.get("publisher:global"), null);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publisher_lease_write_probe")
      .get().count,
    0,
  );
});

test("live-guarded publisher fails closed before acquiring an unbound lease", async () => {
  const { db, leases } = fixture();
  let taskCalls = 0;

  const result = await runWithPublisherLease({
    leases,
    env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
    task: async () => {
      taskCalls += 1;
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "durable_publish_lock_unavailable");
  assert.equal(taskCalls, 0);
  assert.equal(leases.get("publisher:global"), null);
  db.close();
});

test("missing or drifted runtime, claimed-job or admission authority prevents the publisher task", async () => {
  assert.equal(
    typeof boundedAuthority.buildClaimedJobAuthority,
    "function",
  );
  for (const missing of ["runtimeAuthority", "claimedJobAuthority", "admissionContext"]) {
    const { db, leases, admission, job } = exactClaimedPublisherFixture();
    const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: job.claim_token,
    });
    const input = {
      db,
      leases,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
    };
    delete input[missing];
    let taskCalls = 0;
    const result = await runWithPublisherLease({
      ...input,
      task: async () => {
        taskCalls += 1;
      },
    });
    assert.equal(taskCalls, 0, `${missing} cannot be omitted`);
    assert.equal(result.top_reason, "durable_publish_lock_unavailable");
    db.close();
  }

  const { db, leases, admission, job } = exactClaimedPublisherFixture();
  const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
    db,
    jobId: job.id,
    workerId: job.claimed_by,
    claimToken: job.claim_token,
  });
  db.prepare("UPDATE jobs SET payload = ? WHERE id = ?").run(
    JSON.stringify({ story_id: "drifted-after-claim" }),
    job.id,
  );
  let driftedTaskCalls = 0;
  const drifted = await runWithPublisherLease({
    db,
    leases,
    operation: "publish_next_story",
    runtimeAuthority: RUNTIME_AUTHORITY,
    claimedJobAuthority,
    admissionContext: admission,
    env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
    task: async () => {
      driftedTaskCalls += 1;
    },
  });
  assert.equal(driftedTaskCalls, 0);
  assert.equal(drifted.top_reason, "durable_publish_lock_unavailable");
  db.close();
});

test("claimed job identity cannot be paired with another admitted channel or story", async () => {
  for (const [column, value] of [
    ["channel_id", "stacked"],
    ["story_id", "another-story"],
  ]) {
    const { db, leases, admission, job } = exactClaimedPublisherFixture();
    db.prepare(`UPDATE jobs SET ${column} = ? WHERE id = ?`).run(value, job.id);
    const claimedJobAuthority = boundedAuthority.buildClaimedJobAuthority({
      db,
      jobId: job.id,
      workerId: job.claimed_by,
      claimToken: job.claim_token,
    });
    let taskCalls = 0;
    const result = await runWithPublisherLease({
      db,
      leases,
      operation: "publish_next_story",
      runtimeAuthority: RUNTIME_AUTHORITY,
      claimedJobAuthority,
      admissionContext: admission,
      env: { PULSE_OPERATING_MODE: "LIVE_GUARDED" },
      task: async () => {
        taskCalls += 1;
      },
    });
    assert.equal(taskCalls, 0, `${column} substitution cannot run the task`);
    assert.equal(result.top_reason, "durable_publish_lock_unavailable");
    db.close();
  }
});

test("publisher lock hashes a competing private owner instead of exposing it", async () => {
  const { db, leases } = fixture();
  const first = acquirePublisherLease({
    leases,
    ownerId: "publisher-private-first-owner",
  });
  const privateExpiry = "ya29.raw-oauth-shaped-secret";
  db.prepare(
    "UPDATE runtime_leases SET expires_at = ? WHERE name = 'publisher:global'",
  ).run(privateExpiry);

  const blocked = await runWithPublisherLease({
    leases,
    ownerId: "publisher-private-second-owner",
    task: async () => {
      throw new Error("blocked_publisher_task_must_not_run");
    },
  });

  assert.equal(blocked.publish_dispatch_blocked, true);
  assert.equal(
    blocked.current_lock_owner_sha256,
    "62821acd839cc593a24b3d6033ef6b9ece9911e8a9750baf9b08f7d5e54098f3",
  );
  assert.equal(Object.hasOwn(blocked, "current_lock_owner"), false);
  assert.equal(blocked.lock_expires_at, null);
  assert.equal(
    JSON.stringify(blocked).includes("publisher-private-first-owner"),
    false,
  );
  assert.equal(JSON.stringify(blocked).includes(privateExpiry), false);

  leases.release(first.lease_name, first.owner_id);
  db.close();
});

test("publisher ownership is global even when callers name different channels", async () => {
  const { db, leases } = fixture();
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstLease;
  const first = runWithPublisherLease({
    leases,
    channelId: "pulse-gaming",
    task: async () => {
      firstLease = leases.get("publisher:global");
      await gate;
    },
  });
  const second = await runWithPublisherLease({
    leases,
    channelId: "stacked",
    task: async () => {
      throw new Error("cross_channel_task_must_not_run");
    },
  });
  assert.equal(firstLease.name, "publisher:global");
  assert.equal(second.publish_dispatch_blocked, true);
  releaseFirst();
  await first;
  db.close();
});

test("blocked publisher results are held without an off-window job retry", async (t) => {
  const db = scheduledDispatchFixture();
  t.after(() => db.close());
  let receivedBinding = null;
  const result = await handlers.publish(
    {
      id: 73,
      channel_id: "pulse-gaming",
      idempotency_key: "publish:2026-07-27:09",
      payload: {
        scheduler_profile: "stabilisation_30d",
        target_platform: "youtube",
      },
    },
    {
      repos: { db },
      now: () => new Date("2026-07-27T09:00:00.000Z"),
      assertLeaseHealthy() {
        return true;
      },
      async publishNextStory({ exactDispatchBinding }) {
        receivedBinding = exactDispatchBinding;
        return {
          publish_dispatch_blocked: true,
          top_reason: "durable_publish_lock_unavailable",
        };
      },
      log() {},
    },
  );
  assert.equal(receivedBinding.storyId, "publisher-lock-story");
  assert.deepEqual(result, {
    deferred: true,
    status: "held",
    reason: "durable_publish_lock_unavailable",
    cadence: null,
  });
  const summary = renderPublishSummary({
    publish_dispatch_blocked: true,
    top_reason: "durable_publish_lock_unavailable",
  });
  assert.equal(summary.status, "deferred");
  assert.doesNotMatch(summary.message, /Published/);
});

test("legacy or off-window publish jobs are discarded before publisher execution", async () => {
  for (const job of [
    {
      id: 81,
      idempotency_key: "publish:2026-07-27:14",
      payload: {
        scheduler_profile: "legacy",
        target_platform: "youtube",
      },
    },
    {
      id: 82,
      idempotency_key: "publish:2026-07-27:14",
      payload: {
        scheduler_profile: "stabilisation_30d",
        target_platform: "youtube",
      },
    },
  ]) {
    let called = false;
    const result = await handlers.publish(job, {
      async publishNextStory() {
        called = true;
      },
    });
    assert.equal(called, false);
    assert.equal(result.skipped, true);
    assert.equal(result.status, "held");
  }
});

test("disabled batch publish returns before resolving a lease repository or any platform adapter", async () => {
  const publisher = require("../../publisher");
  let leaseTouches = 0;
  let platformTouches = 0;
  const options = {
    platformAdapters: new Proxy(
      {},
      {
        get() {
          platformTouches += 1;
          throw new Error("disabled_batch_platform_adapter_must_not_be_read");
        },
      },
    ),
  };
  Object.defineProperty(options, "leases", {
    enumerable: true,
    get() {
      leaseTouches += 1;
      return {
        acquire({ name, ownerId, metadata }) {
          leaseTouches += 1;
          return {
            acquired: true,
            name,
            owner_id: ownerId,
            metadata: JSON.stringify(metadata),
          };
        },
        heartbeat() {
          leaseTouches += 1;
          return true;
        },
        release() {
          leaseTouches += 1;
          return true;
        },
      };
    },
  });
  const result = await publisher.publishToAllPlatforms(options);
  assert.deepEqual(result, {
    youtube: [],
    tiktok: [],
    instagram: [],
    publish_dispatch_blocked: true,
    status: "blocked",
    top_reason: "legacy_batch_publish_disabled_use_durable_single_story_queue",
  });
  assert.equal(leaseTouches, 0);
  assert.equal(platformTouches, 0);
});

test("every live publisher entrypoint uses one durable coordinator", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "publisher.js"),
    "utf8",
  );
  assert.match(
    source,
    /async function publishToAllPlatforms\(options = \{\}\)[\s\S]*runWithPublisherLease/,
  );
  assert.match(
    source,
    /async function publishNextStory\(options = \{\}\)[\s\S]*runWithPublisherLease/,
  );
  assert.match(source, /_publishToAllPlatformsUnlocked\(assertLeaseHealthy\)/);
  assert.match(
    source,
    /_publishNextStoryInner\(assertLeaseHealthy,\s*runtime\)/,
  );
  assert.ok(
    (source.match(/assertLeaseHealthy\(\)/g) || []).length >= 10,
    "platform and fallback side effects must re-check lease ownership",
  );
  assert.match(
    source,
    /const\s+dispatchResult\s*=\s*await\s+governedDispatch\([\s\S]{0,2500}?\);\s*assertLeaseHealthy\(\)/,
    "YouTube result handling must re-check ownership after governed dispatch",
  );
  assert.doesNotMatch(
    source,
    /setTimeout\([\s\S]{0,500}?engageFirstHour/,
    "engagement must run through its separately leased scheduler job",
  );
  const batchStart = source.indexOf(
    "async function _publishToAllPlatformsUnlocked",
  );
  const batchEnd = source.indexOf(
    "async function publishToAllPlatforms",
    batchStart,
  );
  const batchSource = source.slice(batchStart, batchEnd);
  assert.match(
    batchSource,
    /legacy_batch_publish_disabled_use_durable_single_story_queue/,
  );
  assert.doesNotMatch(
    batchSource,
    /uploadAll/,
    "legacy batch uploaders cannot perform unfenced multi-item effects",
  );
});
