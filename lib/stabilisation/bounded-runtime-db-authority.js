"use strict";

const crypto = require("node:crypto");

const BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA =
  "pulse-bounded-runtime-db-authority-v1";
const RUNTIME_GENERATION_LEASE_SCHEMA = "pulse-runtime-generation-lease-v1";
const PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA =
  "pulse-runtime-generation-publisher-lease-v1";
const ADMITTED_PUBLICATION_OPERATION_SCHEMA =
  "pulse-admitted-publication-operation-v1";
const ADMITTED_PUBLISHER_OPERATIONS = new Set([
  "publish_next_story",
  "disarm_governed_youtube_scheduled_release",
  "prestage_governed_youtube_release",
  "verify_governed_youtube_private_prestage",
  "arm_governed_youtube_scheduled_release",
  "confirm_governed_youtube_scheduled_release",
  "verify_governed_youtube_scheduled_replay",
]);
const PUBLISHER_OPERATION_STATES = Object.freeze({
  publish_next_story: new Set([
    "SCHEDULED",
    "DISPATCH_STARTED",
    "PLATFORM_OBJECT_CREATED",
    "PLATFORM_SCHEDULED",
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
    "PLATFORM_CREATED_METADATA_FAILED",
    "RECONCILIATION_REQUIRED",
    "PUBLISHED",
  ]),
  disarm_governed_youtube_scheduled_release: new Set([
    "PLATFORM_SCHEDULED",
    "PLATFORM_OBJECT_CREATED",
    "RECONCILIATION_REQUIRED",
  ]),
  prestage_governed_youtube_release: new Set([
    "SCHEDULED",
    "PLATFORM_OBJECT_CREATED",
    "RECONCILIATION_REQUIRED",
  ]),
  verify_governed_youtube_private_prestage: new Set([
    "PLATFORM_OBJECT_CREATED",
    "RECONCILIATION_REQUIRED",
  ]),
  arm_governed_youtube_scheduled_release: new Set([
    "PLATFORM_OBJECT_CREATED",
    "PLATFORM_SCHEDULED",
    "RECONCILIATION_REQUIRED",
  ]),
  confirm_governed_youtube_scheduled_release: new Set([
    "PLATFORM_SCHEDULED",
    "PUBLISHED",
    "RECONCILIATION_REQUIRED",
  ]),
  verify_governed_youtube_scheduled_replay: new Set([
    "PLATFORM_SCHEDULED",
    "PUBLISHED",
    "RECONCILIATION_REQUIRED",
  ]),
});
const PUBLISHER_OPERATION_SET_SHA256 = sha256(
  stableJson(
    Object.fromEntries(
      Object.entries(PUBLISHER_OPERATION_STATES)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([operation, states]) => [operation, [...states].sort()]),
    ),
  ),
);
const LIVE_LEASE_NAMES = Object.freeze([
  "scheduler:primary",
  "publisher:global",
]);
const RUNTIME_INSTANCE_ID_PATTERN =
  /^ri-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DEFAULT_WORKER_HEARTBEAT_MS = 30_000;
const MAX_WORKER_FRESHNESS_MS = 5 * 60_000;
const LIVE_WORKER_STATUSES = new Set(["idle", "busy"]);
const REQUIRED_AUTHORITY_TABLE_COLUMNS = Object.freeze({
  runtime_leases: Object.freeze(["name", "owner_id", "expires_at", "metadata"]),
  workers: Object.freeze(["id", "status", "last_seen_at"]),
  jobs: Object.freeze([
    "id",
    "kind",
    "status",
    "claimed_by",
    "lease_until",
    "attempt_count",
  ]),
  job_runs: Object.freeze([
    "id",
    "job_id",
    "worker_id",
    "attempt",
    "status",
    "finished_at",
  ]),
  publication_lifecycle_events: Object.freeze([
    "id",
    "story_id",
    "platform",
    "to_state",
    "evidence_json",
    "idempotency_key",
  ]),
  platform_publication_state: Object.freeze([
    "story_id",
    "platform",
    "lifecycle_state",
  ]),
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

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

function canonicalInstant(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString() === value ? value : null;
}

function sqliteInstantMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value,
  )
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseTopology(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const topology = [];
  const poolIds = new Set();
  for (const entry of value) {
    const poolId = String(entry?.pool_id || "").trim();
    const instances = Number(entry?.instances);
    const kinds = entry?.kinds;
    const heartbeatMs =
      entry?.heartbeat_ms === undefined
        ? DEFAULT_WORKER_HEARTBEAT_MS
        : Number(entry.heartbeat_ms);
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(poolId) ||
      !Number.isInteger(instances) ||
      instances < 1 ||
      instances > 100 ||
      poolIds.has(poolId) ||
      !Array.isArray(kinds) ||
      kinds.length === 0 ||
      !Number.isInteger(heartbeatMs) ||
      heartbeatMs < 1000 ||
      heartbeatMs > MAX_WORKER_FRESHNESS_MS ||
      kinds.some(
        (kind) =>
          typeof kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(kind),
      )
    ) {
      return null;
    }
    poolIds.add(poolId);
    topology.push({
      pool_id: poolId,
      instances,
      heartbeat_ms: heartbeatMs,
      kinds: [...new Set(kinds)].sort(),
    });
  }
  return topology.sort((left, right) =>
    left.pool_id.localeCompare(right.pool_id),
  );
}

function normaliseExpected(expected) {
  const runtimeInstanceId = String(expected?.runtime_instance_id || "").trim();
  const childPid = Number(expected?.child_pid);
  const childStartedAt = canonicalInstant(expected?.child_started_at);
  const authorityFingerprint = String(
    expected?.authority_fingerprint || "",
  ).trim();
  const databaseIdentitySha256 = String(
    expected?.database_identity_sha256 || "",
  ).trim();
  const workerTopology = normaliseTopology(expected?.worker_topology);
  if (
    !RUNTIME_INSTANCE_ID_PATTERN.test(runtimeInstanceId) ||
    !Number.isInteger(childPid) ||
    childPid <= 0 ||
    !childStartedAt ||
    !/^[a-f0-9]{64}$/.test(authorityFingerprint) ||
    !/^[a-f0-9]{64}$/.test(databaseIdentitySha256) ||
    !workerTopology
  ) {
    return null;
  }
  const workerIds = [];
  const kindToPool = new Map();
  const workerFreshnessMs = new Map();
  for (const pool of workerTopology) {
    for (let instance = 1; instance <= pool.instances; instance += 1) {
      const workerId = `server-${runtimeInstanceId}-${pool.pool_id}-${instance}`;
      workerIds.push(workerId);
      workerFreshnessMs.set(
        workerId,
        Math.min(
          MAX_WORKER_FRESHNESS_MS,
          Math.max(5000, pool.heartbeat_ms * 3),
        ),
      );
    }
    for (const kind of pool.kinds) {
      if (kindToPool.has(kind)) return null;
      kindToPool.set(kind, pool.pool_id);
    }
  }
  return {
    runtime_instance_id: runtimeInstanceId,
    child_pid: childPid,
    child_started_at: childStartedAt,
    authority_fingerprint: authorityFingerprint,
    database_identity_sha256: databaseIdentitySha256,
    worker_topology: workerTopology,
    worker_ids: workerIds.sort(),
    kind_to_pool: kindToPool,
    worker_freshness_ms: workerFreshnessMs,
  };
}

function normaliseQuiescentExpected(expected) {
  const authorityFingerprint = String(
    expected?.authority_fingerprint || "",
  ).trim();
  const databaseIdentitySha256 = String(
    expected?.database_identity_sha256 || "",
  ).trim();
  if (
    !/^[a-f0-9]{64}$/.test(authorityFingerprint) ||
    !/^[a-f0-9]{64}$/.test(databaseIdentitySha256)
  ) {
    return null;
  }
  return {
    authority_fingerprint: authorityFingerprint,
    database_identity_sha256: databaseIdentitySha256,
  };
}

function buildRuntimeGenerationLeaseMetadata(runtimeAuthority) {
  const runtimeInstanceId = String(
    runtimeAuthority?.runtime_instance_id || "",
  ).trim();
  const childPid = Number(runtimeAuthority?.child_pid);
  const childStartedAt = canonicalInstant(runtimeAuthority?.child_started_at);
  const authorityFingerprint = String(
    runtimeAuthority?.authority_fingerprint || "",
  ).trim();
  if (
    !RUNTIME_INSTANCE_ID_PATTERN.test(runtimeInstanceId) ||
    !Number.isInteger(childPid) ||
    childPid <= 0 ||
    !childStartedAt ||
    !/^[a-f0-9]{64}$/.test(authorityFingerprint)
  ) {
    throw new Error("runtime_generation_authority_invalid");
  }
  return {
    schema_version: RUNTIME_GENERATION_LEASE_SCHEMA,
    runtime_instance_id: runtimeInstanceId,
    process_id: childPid,
    process_started_at: childStartedAt,
    authority_fingerprint: authorityFingerprint,
  };
}

function buildAdmittedPublicationOperation(operation, admissionContext) {
  const selectedOperation = String(operation || "").trim();
  const storyId = String(admissionContext?.story_id || "").trim();
  const platform = String(admissionContext?.platform || "").trim();
  const scheduledEventId = Number(admissionContext?.scheduled_event_id);
  const scheduledFor = canonicalInstant(admissionContext?.scheduled_for);
  const dispatchIdempotencyKey = String(
    admissionContext?.dispatch_idempotency_key || "",
  ).trim();
  const requestFingerprint = String(
    admissionContext?.request_fingerprint || "",
  ).trim();
  const runwayLockSha256 = String(
    admissionContext?.runway_lock_sha256 || "",
  ).trim();
  if (
    !ADMITTED_PUBLISHER_OPERATIONS.has(selectedOperation) ||
    !storyId ||
    storyId.length > 512 ||
    platform !== "youtube" ||
    !Number.isInteger(scheduledEventId) ||
    scheduledEventId <= 0 ||
    !scheduledFor ||
    !dispatchIdempotencyKey ||
    dispatchIdempotencyKey.length > 512 ||
    !/^[a-f0-9]{64}$/.test(requestFingerprint) ||
    !/^[a-f0-9]{64}$/.test(runwayLockSha256)
  ) {
    throw new Error("publisher_admitted_operation_authority_invalid");
  }
  return {
    schema_version: ADMITTED_PUBLICATION_OPERATION_SCHEMA,
    story_id: storyId,
    platform,
    scheduled_event_id: scheduledEventId,
    scheduled_for: scheduledFor,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
  };
}

function buildPublisherRuntimeGenerationLeaseMetadata({
  runtimeAuthority,
  operation,
  admissionContext,
} = {}) {
  const runtime = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
  const admittedOperation = buildAdmittedPublicationOperation(
    operation,
    admissionContext,
  );
  return {
    ...runtime,
    schema_version: PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
    operation: String(operation || "").trim(),
    admitted_operation: admittedOperation,
    admitted_operation_sha256: sha256(
      stableJson({
        operation: String(operation || "").trim(),
        admitted_operation: admittedOperation,
      }),
    ),
    publisher_operation_set_sha256: PUBLISHER_OPERATION_SET_SHA256,
  };
}

function parseMetadata(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function inspectBoundDatabaseIdentity(db, expectedSha256) {
  try {
    const databases = db.prepare("PRAGMA database_list").all();
    const main = databases.filter((entry) => entry?.name === "main");
    const nonMain = databases.filter((entry) => entry?.name !== "main");
    const emptyTempSchemaOnly =
      nonMain.length === 1 &&
      nonMain[0]?.name === "temp" &&
      !String(nonMain[0]?.file || "").trim() &&
      Number(
        db.prepare("SELECT COUNT(*) AS count FROM temp.sqlite_schema").get()
          ?.count,
      ) === 0;
    if (
      main.length !== 1 ||
      !String(main[0]?.file || "").trim() ||
      (nonMain.length !== 0 && !emptyTempSchemaOnly)
    ) {
      return {
        ok: false,
        blocker: "runtime_db_schema_invalid",
        database_identity_sha256: null,
      };
    }
    const {
      inspectLiveDatabaseIdentity,
    } = require("./windows-live-guarded-runtime");
    const identity = inspectLiveDatabaseIdentity({
      databasePath: main[0].file,
    });
    return {
      ok: identity.database_identity_sha256 === expectedSha256,
      blocker:
        identity.database_identity_sha256 === expectedSha256
          ? null
          : "runtime_db_identity_mismatch",
      database_identity_sha256: identity.database_identity_sha256,
    };
  } catch {
    return {
      ok: false,
      blocker: "runtime_db_identity_mismatch",
      database_identity_sha256: null,
    };
  }
}

function inspectMainAuthoritySchema(db) {
  const tableNames = Object.keys(REQUIRED_AUTHORITY_TABLE_COLUMNS);
  const placeholders = tableNames.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT name, type, sql
       FROM main.sqlite_schema
       WHERE name IN (${placeholders})
       ORDER BY name`,
    )
    .all(...tableNames);
  if (rows.length !== tableNames.length) return false;
  const rowsByName = new Map(rows.map((row) => [row.name, row]));
  for (const tableName of tableNames) {
    const row = rowsByName.get(tableName);
    if (
      row?.type !== "table" ||
      !/^CREATE\s+TABLE\b/i.test(String(row.sql || "").trim()) ||
      /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(String(row.sql || "").trim())
    ) {
      return false;
    }
    const columns = new Set(
      db
        .prepare(`PRAGMA main.table_info(${JSON.stringify(tableName)})`)
        .all()
        .map((column) => column.name),
    );
    if (
      REQUIRED_AUTHORITY_TABLE_COLUMNS[tableName].some(
        (column) => !columns.has(column),
      )
    ) {
      return false;
    }
  }
  return true;
}

function withinDeferredReadSnapshot(db, inspect) {
  if (db.inTransaction === true) {
    throw new Error("runtime_db_authority_transaction_ambiguous");
  }
  db.exec("BEGIN DEFERRED");
  try {
    const result = inspect();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original fail-closed inspection error */
    }
    throw error;
  }
}

function leaseEvidence(row, metadata, nowMs) {
  if (!row) {
    return { present: false, active: false };
  }
  const expiresAtMs = sqliteInstantMs(row.expires_at);
  return {
    present: true,
    active: expiresAtMs !== null && expiresAtMs > nowMs,
    expires_at:
      expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    owner_sha256: sha256(row.owner_id),
    schema_version: [
      RUNTIME_GENERATION_LEASE_SCHEMA,
      PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
    ].includes(metadata?.schema_version)
      ? metadata.schema_version
      : null,
    runtime_instance_id: RUNTIME_INSTANCE_ID_PATTERN.test(
      String(metadata?.runtime_instance_id || ""),
    )
      ? metadata.runtime_instance_id
      : null,
    process_id:
      Number.isInteger(Number(metadata?.process_id)) &&
      Number(metadata.process_id) > 0
        ? Number(metadata.process_id)
        : null,
    process_started_at: canonicalInstant(metadata?.process_started_at),
    authority_fingerprint: /^[a-f0-9]{64}$/.test(
      String(metadata?.authority_fingerprint || ""),
    )
      ? metadata.authority_fingerprint
      : null,
    operation: ADMITTED_PUBLISHER_OPERATIONS.has(metadata?.operation)
      ? metadata.operation
      : null,
    admitted_operation_sha256: /^[a-f0-9]{64}$/.test(
      String(metadata?.admitted_operation_sha256 || ""),
    )
      ? metadata.admitted_operation_sha256
      : null,
    publisher_operation_set_sha256:
      metadata?.publisher_operation_set_sha256 ===
      PUBLISHER_OPERATION_SET_SHA256
        ? metadata.publisher_operation_set_sha256
        : null,
  };
}

function runtimeLeaseMetadataMatches(
  metadata,
  expected,
  schemaVersion = RUNTIME_GENERATION_LEASE_SCHEMA,
) {
  return (
    metadata?.schema_version === schemaVersion &&
    metadata.runtime_instance_id === expected.runtime_instance_id &&
    Number(metadata.process_id) === expected.child_pid &&
    metadata.process_started_at === expected.child_started_at &&
    metadata.authority_fingerprint === expected.authority_fingerprint
  );
}

function publisherAdmissionMatches(db, metadata) {
  const admitted = metadata?.admitted_operation;
  if (
    !ADMITTED_PUBLISHER_OPERATIONS.has(metadata?.operation) ||
    admitted?.schema_version !== ADMITTED_PUBLICATION_OPERATION_SCHEMA ||
    !admitted.story_id ||
    admitted.platform !== "youtube" ||
    !Number.isInteger(Number(admitted.scheduled_event_id)) ||
    Number(admitted.scheduled_event_id) <= 0 ||
    !canonicalInstant(admitted.scheduled_for) ||
    !admitted.dispatch_idempotency_key ||
    !/^[a-f0-9]{64}$/.test(String(admitted.request_fingerprint || "")) ||
    !/^[a-f0-9]{64}$/.test(String(admitted.runway_lock_sha256 || "")) ||
    metadata.publisher_operation_set_sha256 !==
      PUBLISHER_OPERATION_SET_SHA256 ||
    metadata.admitted_operation_sha256 !==
      sha256(
        stableJson({
          operation: metadata.operation,
          admitted_operation: admitted,
        }),
      )
  ) {
    return false;
  }
  const scheduled = db
    .prepare(
      `SELECT id, story_id, platform, to_state, evidence_json, idempotency_key
       FROM main.publication_lifecycle_events
       WHERE id = ?`,
    )
    .get(Number(admitted.scheduled_event_id));
  const latest = db
    .prepare(
      `SELECT id
       FROM main.publication_lifecycle_events
       WHERE story_id = ? AND platform = ? AND to_state = 'SCHEDULED'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(admitted.story_id, admitted.platform);
  if (
    !scheduled ||
    Number(latest?.id) !== Number(scheduled.id) ||
    scheduled.story_id !== admitted.story_id ||
    scheduled.platform !== admitted.platform ||
    scheduled.to_state !== "SCHEDULED" ||
    scheduled.idempotency_key !==
      `${admitted.dispatch_idempotency_key}:lifecycle:SCHEDULED`
  ) {
    return false;
  }
  const evidence = parseMetadata(scheduled.evidence_json);
  if (
    evidence?.schedule_verified !== true ||
    evidence.control_tower_verdict !== "GREEN" ||
    !canonicalInstant(evidence.control_tower_checked_at) ||
    evidence.scheduled_for !== admitted.scheduled_for ||
    evidence.kill_switch_healthy !== true ||
    evidence.operating_contract_valid !== true ||
    evidence.dispatch_idempotency_key !== admitted.dispatch_idempotency_key ||
    evidence.request_fingerprint !== admitted.request_fingerprint ||
    evidence.runway_lock_sha256 !== admitted.runway_lock_sha256
  ) {
    return false;
  }
  const state = db
    .prepare(
      `SELECT lifecycle_state
       FROM main.platform_publication_state
       WHERE story_id = ? AND platform = ?`,
    )
    .get(admitted.story_id, admitted.platform);
  const latestOverall = db
    .prepare(
      `SELECT id, to_state
       FROM main.publication_lifecycle_events
       WHERE story_id = ? AND platform = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(admitted.story_id, admitted.platform);
  return (
    !!state &&
    !!latestOverall &&
    latestOverall.to_state === state.lifecycle_state &&
    PUBLISHER_OPERATION_STATES[metadata.operation]?.has(
      state.lifecycle_state,
    ) === true
  );
}

function inspectLive({ db, expected, nowMs }) {
  const blockers = [];
  const leaseRows = db
    .prepare(
      `SELECT name, owner_id, expires_at, metadata
       FROM main.runtime_leases
       WHERE name IN (?, ?)
       ORDER BY name`,
    )
    .all(...LIVE_LEASE_NAMES);
  const leases = new Map(leaseRows.map((row) => [row.name, row]));
  const schedulerRow = leases.get("scheduler:primary") || null;
  const schedulerMetadata = parseMetadata(schedulerRow?.metadata);
  const schedulerLease = leaseEvidence(schedulerRow, schedulerMetadata, nowMs);
  if (!schedulerRow) {
    blockers.push("runtime_db_scheduler_lease_missing");
  } else if (!schedulerLease.active) {
    blockers.push("runtime_db_scheduler_lease_expired");
  } else if (!runtimeLeaseMetadataMatches(schedulerMetadata, expected)) {
    blockers.push("runtime_db_scheduler_lease_binding_mismatch");
  }
  const publisherRow = leases.get("publisher:global") || null;
  const publisherMetadata = parseMetadata(publisherRow?.metadata);
  const publisherLease = leaseEvidence(publisherRow, publisherMetadata, nowMs);
  if (publisherLease.active) {
    if (
      !runtimeLeaseMetadataMatches(
        publisherMetadata,
        expected,
        PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
      )
    ) {
      blockers.push("runtime_db_publisher_lease_binding_mismatch");
    } else if (!publisherAdmissionMatches(db, publisherMetadata)) {
      blockers.push("runtime_db_publisher_admission_mismatch");
    }
  }

  const expectedWorkerIds = new Set(expected.worker_ids);
  const activeWorkers = db
    .prepare(
      `SELECT id, status, last_seen_at
       FROM main.workers
       WHERE status <> 'offline'
       ORDER BY id`,
    )
    .all();
  const actualWorkerIds = activeWorkers.map((row) => row.id).sort();
  if (
    actualWorkerIds.length !== expected.worker_ids.length ||
    actualWorkerIds.some(
      (workerId, index) => workerId !== expected.worker_ids[index],
    )
  ) {
    blockers.push("runtime_db_worker_topology_mismatch");
  }
  for (const worker of activeWorkers) {
    const lastSeenAtMs = sqliteInstantMs(worker.last_seen_at);
    const freshnessMs = expected.worker_freshness_ms.get(worker.id);
    if (
      !expectedWorkerIds.has(worker.id) ||
      !LIVE_WORKER_STATUSES.has(worker.status) ||
      !Number.isInteger(freshnessMs) ||
      lastSeenAtMs === null ||
      lastSeenAtMs > nowMs + 5000 ||
      nowMs - lastSeenAtMs > freshnessMs
    ) {
      blockers.push("runtime_db_worker_liveness_mismatch");
    }
  }

  const activeClaims = db
    .prepare(
      `SELECT id, kind, status, claimed_by, lease_until, attempt_count
       FROM main.jobs
       WHERE status IN ('claimed', 'running')
       ORDER BY id`,
    )
    .all();
  const foreignClaimJobIds = new Set();
  for (const claim of activeClaims) {
    if (!expectedWorkerIds.has(claim.claimed_by)) {
      foreignClaimJobIds.add(claim.id);
      blockers.push("runtime_db_active_job_foreign_worker");
      continue;
    }
    if (
      sqliteInstantMs(claim.lease_until) === null ||
      sqliteInstantMs(claim.lease_until) <= nowMs
    ) {
      blockers.push("runtime_db_active_job_lease_expired");
    }
    const poolId = expected.kind_to_pool.get(claim.kind);
    if (
      !poolId ||
      !claim.claimed_by.startsWith(
        `server-${expected.runtime_instance_id}-${poolId}-`,
      )
    ) {
      blockers.push("runtime_db_active_job_wrong_pool");
    }
  }

  const openRuns = db
    .prepare(
      `SELECT id, job_id, worker_id, attempt, status
       FROM main.job_runs
       WHERE finished_at IS NULL
       ORDER BY id`,
    )
    .all();
  const claimsById = new Map(activeClaims.map((claim) => [claim.id, claim]));
  const runsByJobId = new Map();
  for (const run of openRuns) {
    const runs = runsByJobId.get(run.job_id) || [];
    runs.push(run);
    runsByJobId.set(run.job_id, runs);
  }
  for (const claim of activeClaims) {
    const matchingRuns = runsByJobId.get(claim.id) || [];
    if (matchingRuns.length === 0) {
      blockers.push("runtime_db_active_job_run_missing");
      continue;
    }
    if (matchingRuns.length !== 1) {
      blockers.push("runtime_db_active_job_run_duplicate");
      continue;
    }
    const run = matchingRuns[0];
    if (
      !Number.isInteger(Number(run.id)) ||
      Number(run.id) <= 0 ||
      run.worker_id !== claim.claimed_by ||
      Number(run.attempt) !== Number(claim.attempt_count) ||
      run.status !== "running"
    ) {
      blockers.push("runtime_db_active_job_run_binding_mismatch");
    }
  }
  for (const run of openRuns) {
    const claim = claimsById.get(run.job_id);
    if (
      !claim ||
      claim.claimed_by !== run.worker_id ||
      Number(claim.attempt_count) !== Number(run.attempt)
    ) {
      blockers.push("runtime_db_open_job_run_orphan");
    }
    if (
      !expectedWorkerIds.has(run.worker_id) &&
      !foreignClaimJobIds.has(run.job_id)
    ) {
      blockers.push("runtime_db_open_job_run_foreign_worker");
    }
  }

  return {
    blockers: [...new Set(blockers)],
    evidence: {
      scheduler_lease: schedulerLease,
      publisher_lease: publisherLease,
      worker_topology: {
        expected_count: expected.worker_ids.length,
        active_count: actualWorkerIds.length,
      },
      active_claim_count: activeClaims.length,
      open_job_run_count: openRuns.length,
    },
  };
}

function authoritySnapshotState(db, databaseIdentitySha256) {
  return {
    database_identity_sha256: databaseIdentitySha256,
    runtime_leases: db
      .prepare(
        `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at, metadata
         FROM main.runtime_leases
         WHERE name IN (?, ?)
         ORDER BY name`,
      )
      .all(...LIVE_LEASE_NAMES),
    workers: db
      .prepare(
        `SELECT id, status, last_seen_at
         FROM main.workers
         WHERE status <> 'offline'
         ORDER BY id`,
      )
      .all(),
    jobs: db
      .prepare(
        `SELECT id, kind, status, claimed_by, lease_until, attempt_count
         FROM main.jobs
         WHERE status IN ('claimed', 'running')
         ORDER BY id`,
      )
      .all(),
    job_runs: db
      .prepare(
        `SELECT id, job_id, worker_id, attempt, status, finished_at
         FROM main.job_runs
         WHERE finished_at IS NULL
         ORDER BY id`,
      )
      .all(),
    publication_lifecycle_events: db
      .prepare(
        `SELECT id, story_id, platform, to_state, evidence_json, idempotency_key
         FROM main.publication_lifecycle_events
         WHERE platform = 'youtube'
         ORDER BY id`,
      )
      .all(),
    platform_publication_state: db
      .prepare(
        `SELECT story_id, platform, lifecycle_state
         FROM main.platform_publication_state
         WHERE platform = 'youtube'
         ORDER BY story_id, platform`,
      )
      .all(),
  };
}

function inspectQuiescent({ db, nowMs }) {
  const blockers = [];
  const leaseRows = db
    .prepare(
      `SELECT name, owner_id, expires_at, metadata
       FROM main.runtime_leases
       WHERE name IN (?, ?)
       ORDER BY name`,
    )
    .all(...LIVE_LEASE_NAMES);
  const leases = new Map(leaseRows.map((row) => [row.name, row]));
  const schedulerRow = leases.get("scheduler:primary") || null;
  const publisherRow = leases.get("publisher:global") || null;
  const schedulerLease = leaseEvidence(
    schedulerRow,
    parseMetadata(schedulerRow?.metadata),
    nowMs,
  );
  const publisherLease = leaseEvidence(
    publisherRow,
    parseMetadata(publisherRow?.metadata),
    nowMs,
  );
  if (schedulerLease.active) {
    blockers.push("runtime_db_quiescent_scheduler_lease_active");
  }
  if (publisherLease.active) {
    blockers.push("runtime_db_quiescent_publisher_lease_active");
  }
  const activeClaimCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM main.jobs
       WHERE status IN ('claimed', 'running')`,
    )
    .get().count;
  if (activeClaimCount > 0) {
    blockers.push("runtime_db_quiescent_active_job_present");
  }
  const openJobRunCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM main.job_runs
       WHERE finished_at IS NULL`,
    )
    .get().count;
  if (openJobRunCount > 0) {
    blockers.push("runtime_db_quiescent_open_job_run_present");
  }
  return {
    blockers,
    evidence: {
      scheduler_lease: schedulerLease,
      publisher_lease: publisherLease,
      active_claim_count: activeClaimCount,
      open_job_run_count: openJobRunCount,
    },
  };
}

function inspectBoundedRuntimeDbAuthority({
  db,
  mode,
  expected: suppliedExpected,
  now = new Date(),
} = {}) {
  const selectedMode = String(mode || "")
    .trim()
    .toUpperCase();
  const expected =
    selectedMode === "LIVE"
      ? normaliseExpected(suppliedExpected)
      : selectedMode === "QUIESCENT"
        ? normaliseQuiescentExpected(suppliedExpected)
        : null;
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (
    !db ||
    typeof db.prepare !== "function" ||
    !["LIVE", "QUIESCENT"].includes(selectedMode) ||
    !expected ||
    Number.isNaN(effectiveNow.getTime())
  ) {
    return {
      schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
      ok: false,
      mode: ["LIVE", "QUIESCENT"].includes(selectedMode) ? selectedMode : null,
      database_identity_sha256: expected?.database_identity_sha256 || null,
      blockers: ["runtime_db_authority_input_invalid"],
      evidence: null,
    };
  }

  try {
    return withinDeferredReadSnapshot(db, () => {
      const databaseIdentity = inspectBoundDatabaseIdentity(
        db,
        expected.database_identity_sha256,
      );
      if (!databaseIdentity.ok) {
        return {
          schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
          ok: false,
          mode: selectedMode,
          database_identity_sha256: databaseIdentity.database_identity_sha256,
          blockers: [databaseIdentity.blocker],
          evidence: {
            database_identity_sha256: databaseIdentity.database_identity_sha256,
          },
        };
      }
      if (!inspectMainAuthoritySchema(db)) {
        return {
          schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
          ok: false,
          mode: selectedMode,
          database_identity_sha256: databaseIdentity.database_identity_sha256,
          blockers: ["runtime_db_schema_invalid"],
          evidence: {
            database_identity_sha256: databaseIdentity.database_identity_sha256,
          },
        };
      }
      const inspected =
        selectedMode === "LIVE"
          ? inspectLive({
              db,
              expected,
              nowMs: effectiveNow.getTime(),
            })
          : inspectQuiescent({
              db,
              nowMs: effectiveNow.getTime(),
            });
      const snapshotSha256 = sha256(
        stableJson(
          authoritySnapshotState(db, databaseIdentity.database_identity_sha256),
        ),
      );
      return {
        schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
        ok: inspected.blockers.length === 0,
        mode: selectedMode,
        database_identity_sha256: databaseIdentity.database_identity_sha256,
        snapshot_sha256: snapshotSha256,
        blockers: inspected.blockers,
        evidence: inspected.evidence,
      };
    });
  } catch {
    return {
      schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
      ok: false,
      mode: selectedMode,
      database_identity_sha256: null,
      blockers: ["runtime_db_authority_inspection_failed"],
      evidence: null,
    };
  }
}

module.exports = {
  ADMITTED_PUBLICATION_OPERATION_SCHEMA,
  BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
  PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
  RUNTIME_GENERATION_LEASE_SCHEMA,
  buildPublisherRuntimeGenerationLeaseMetadata,
  buildRuntimeGenerationLeaseMetadata,
  inspectBoundedRuntimeDbAuthority,
};
