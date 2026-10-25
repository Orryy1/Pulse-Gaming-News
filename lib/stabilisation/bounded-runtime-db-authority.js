"use strict";

const crypto = require("node:crypto");
const {
  buildRunningClaimSetSha256,
} = require("../services/multi-lane-runtime-observability");

const BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA =
  "pulse-bounded-runtime-db-authority-v1";
const RUNTIME_GENERATION_LEASE_SCHEMA = "pulse-runtime-generation-lease-v1";
const PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA =
  "pulse-runtime-generation-publisher-lease-v1";
const PUBLICATION_ADMISSION_RUNTIME_GENERATION_LEASE_SCHEMA =
  "pulse-runtime-generation-publication-admission-lease-v1";
const PUBLICATION_ADMISSION_LEASE_SCOPE = "PUBLICATION_ADMISSION_ONLY";
const ADMITTED_PUBLICATION_OPERATION_SCHEMA =
  "pulse-admitted-publication-operation-v2";
const CLAIMED_JOB_AUTHORITY_SCHEMA = "pulse-claimed-job-authority-v1";
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
    "PLATFORM_SCHEDULE_DISARMED",
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
const CLAIMED_JOB_OPERATION_MAP = Object.freeze({
  dispatch_governed_publication: new Set(["publish_next_story"]),
  prestage_governed_youtube_release: new Set([
    "prestage_governed_youtube_release",
  ]),
  governed_youtube_runway_t60: new Set([
    "verify_governed_youtube_private_prestage",
    "disarm_governed_youtube_scheduled_release",
  ]),
  verify_governed_youtube_release_tminus15: new Set([
    "arm_governed_youtube_scheduled_release",
    "verify_governed_youtube_scheduled_replay",
    "disarm_governed_youtube_scheduled_release",
  ]),
  verify_governed_youtube_release_t0: new Set([
    "confirm_governed_youtube_scheduled_release",
  ]),
});
const PUBLICATION_ADMISSION_OPERATION_JOB_MAP = Object.freeze({
  governed_autonomous_pre_t90_window_preparation:
    "prepare_governed_autonomous_pre_t90_window",
  autonomous_t75_jit_admission: "admit_governed_publication",
  promote_governed_youtube_reserve_release:
    "prestage_governed_youtube_release",
  promote_confirmed_disarm_youtube_reserve_release:
    "governed_youtube_runway_t60",
});
const WINDOW_SCOPED_PUBLICATION_ADMISSION_JOB_KINDS = new Set([
  "prepare_governed_autonomous_pre_t90_window",
]);

function publicationAdmissionClaimScope(jobKind) {
  return WINDOW_SCOPED_PUBLICATION_ADMISSION_JOB_KINDS.has(jobKind)
    ? "WINDOW"
    : "STORY";
}

function claimedJobKindRequiresPublisherAuthority(jobKind) {
  return (
    typeof jobKind === "string" &&
    Object.hasOwn(CLAIMED_JOB_OPERATION_MAP, jobKind)
  );
}

function claimedJobKindRequiresPublicationAdmissionAuthority(jobKind) {
  return (
    typeof jobKind === "string" &&
    Object.values(PUBLICATION_ADMISSION_OPERATION_JOB_MAP).includes(jobKind)
  );
}
const LIVE_LEASE_NAMES = Object.freeze([
  "scheduler:primary",
  "publisher:global",
  "publication-admission:global",
]);
const RUNTIME_INSTANCE_ID_PATTERN =
  /^ri-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DEFAULT_WORKER_HEARTBEAT_MS = 30_000;
const MAX_WORKER_FRESHNESS_MS = 5 * 60_000;
const LIVE_WORKER_STATUSES = new Set(["idle", "busy"]);
const AUTHORITY_TABLE_NAMES = Object.freeze([
  "runtime_leases",
  "workers",
  "jobs",
  "job_runs",
  "publication_lifecycle_events",
  "platform_dispatch_ledger",
  "platform_publication_state",
  "publication_authority_audit_log",
]);
const AUTHORITY_MIGRATION_VERSIONS = Object.freeze([
  "004",
  "005",
  "020",
  "023",
  "024",
]);
// Generated from a fresh Node 22 database after migrations 001..024. The
// manifest binds exact table SQL, table_xinfo, every index (including its SQL
// predicate), foreign keys, the database-wide trigger set and the authority
// migrations.
const CANONICAL_AUTHORITY_SCHEMA_SHA256 =
  "fb0e992d71fe7a991bc0b106ca4b5320f9ff72c80992505cffd79540600100fb";
const SCHEDULER_LEASE_TTL_MS = 90_000;
const PUBLISHER_LEASE_TTL_MS = 15 * 60_000;
const PUBLICATION_ADMISSION_LEASE_TTL_MS = 15 * 60_000;
const SCHEDULER_LEASE_FRESHNESS_MS = 90_000;
const PUBLISHER_LEASE_FRESHNESS_MS = 15 * 60_000;
const PUBLICATION_ADMISSION_LEASE_FRESHNESS_MS = 15 * 60_000;

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
  const runtimeClaimSetCount = Number(expected?.runtime_claim_set_count);
  const runtimeClaimSetSha256 = String(
    expected?.runtime_claim_set_sha256 || "",
  ).trim();
  if (
    !RUNTIME_INSTANCE_ID_PATTERN.test(runtimeInstanceId) ||
    !Number.isInteger(childPid) ||
    childPid <= 0 ||
    !childStartedAt ||
    !/^[a-f0-9]{64}$/.test(authorityFingerprint) ||
    !/^[a-f0-9]{64}$/.test(databaseIdentitySha256) ||
    !workerTopology ||
    !Number.isSafeInteger(runtimeClaimSetCount) ||
    runtimeClaimSetCount < 0 ||
    runtimeClaimSetCount > 100 ||
    !/^[a-f0-9]{64}$/.test(runtimeClaimSetSha256)
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
    runtime_claim_set_count: runtimeClaimSetCount,
    runtime_claim_set_sha256: runtimeClaimSetSha256,
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
  const channelId = String(
    admissionContext?.channel_id ?? admissionContext?.channelId ?? "",
  ).trim();
  const storyId = String(
    admissionContext?.story_id ?? admissionContext?.storyId ?? "",
  ).trim();
  const platform = String(admissionContext?.platform || "").trim();
  const rawScheduledEventId =
    admissionContext?.scheduled_event_id ?? admissionContext?.scheduledEventId;
  const scheduledEventId = rawScheduledEventId;
  const scheduledFor = canonicalInstant(
    admissionContext?.scheduled_for ?? admissionContext?.scheduledFor,
  );
  const dispatchIdempotencyKey = String(
    admissionContext?.dispatch_idempotency_key ??
      admissionContext?.dispatchIdempotencyKey ??
      "",
  ).trim();
  const requestFingerprint = String(
    admissionContext?.request_fingerprint ??
      admissionContext?.requestFingerprint ??
      "",
  ).trim();
  const runwayLockSha256 = String(
    admissionContext?.runway_lock_sha256 ??
      admissionContext?.runwayLockSha256 ??
      "",
  ).trim();
  if (
    !ADMITTED_PUBLISHER_OPERATIONS.has(selectedOperation) ||
    !channelId ||
    channelId.length > 128 ||
    !storyId ||
    storyId.length > 512 ||
    platform !== "youtube" ||
    typeof scheduledEventId !== "number" ||
    !Number.isSafeInteger(scheduledEventId) ||
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
    channel_id: channelId,
    story_id: storyId,
    platform,
    scheduled_event_id: scheduledEventId,
    scheduled_for: scheduledFor,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
  };
}

function readExactClaimedJob(db, jobId) {
  if (!db || typeof db.prepare !== "function") return null;
  if (
    typeof jobId !== "number" ||
    !Number.isSafeInteger(jobId) ||
    jobId <= 0
  ) {
    return null;
  }
  const selectedJobId = jobId;
  const job = db
    .prepare(
      `SELECT id, kind, channel_id, story_id, payload, run_at, status,
              attempt_count, claimed_by, idempotency_key
       FROM main.jobs
       WHERE id = ?
         AND lease_until IS NOT NULL
          AND julianday(lease_until) > julianday('now')`,
    )
    .get(selectedJobId);
  if (!job) return null;
  const runs = db
    .prepare(
      `SELECT id, job_id, worker_id, attempt, status
       FROM main.job_runs
       WHERE job_id = ? AND finished_at IS NULL
       ORDER BY id`,
    )
    .all(selectedJobId);
  if (runs.length !== 1) return null;
  const run = runs[0];
  let payload;
  try {
    payload = JSON.parse(job.payload);
  } catch {
    return null;
  }
  const runAtMs = sqliteInstantMs(job.run_at);
  const windowScoped =
    WINDOW_SCOPED_PUBLICATION_ADMISSION_JOB_KINDS.has(job.kind);
  const channelId =
    typeof job.channel_id === "string" ? job.channel_id.trim() : null;
  const storyId =
    typeof job.story_id === "string" ? job.story_id.trim() : null;
  const exactClaimIdentity = windowScoped
    ? job.channel_id === null && job.story_id === null
    : !!channelId &&
      channelId === job.channel_id &&
      !!storyId &&
      storyId === job.story_id;
  if (
    !Number.isSafeInteger(job.id) ||
    job.id <= 0 ||
    !/^[a-z][a-z0-9_]{0,127}$/.test(String(job.kind || "")) ||
    !exactClaimIdentity ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    runAtMs === null ||
    !new Set(["claimed", "running"]).has(job.status) ||
    !Number.isSafeInteger(job.attempt_count) ||
    job.attempt_count <= 0 ||
    !String(job.claimed_by || "").trim() ||
    !String(job.idempotency_key || "").trim() ||
    !Number.isSafeInteger(run.id) ||
    run.id <= 0 ||
    run.job_id !== job.id ||
    run.worker_id !== job.claimed_by ||
    run.attempt !== job.attempt_count ||
    run.status !== "running"
  ) {
    return null;
  }
  const binding = {
    job_id: job.id,
    job_kind: job.kind,
    channel_id: windowScoped ? null : channelId,
    story_id: windowScoped ? null : storyId,
    run_at: new Date(runAtMs).toISOString(),
    payload,
    attempt_count: job.attempt_count,
    claimed_worker_id: job.claimed_by,
    claim_run_id: run.id,
    idempotency_key_sha256: sha256(job.idempotency_key),
  };
  return {
    binding,
    authority: Object.freeze({
      schema_version: CLAIMED_JOB_AUTHORITY_SCHEMA,
      job_id: binding.job_id,
      job_kind: binding.job_kind,
      channel_id: binding.channel_id,
      story_id: binding.story_id,
      run_at: binding.run_at,
      attempt_count: binding.attempt_count,
      claimed_job_authority_sha256: sha256(stableJson(binding)),
    }),
  };
}

function buildClaimedJobAuthority({ db, jobId, workerId, claimToken } = {}) {
  const read = readExactClaimedJob(db, jobId);
  const selectedClaimToken =
    typeof claimToken === "number"
      ? Number.isSafeInteger(claimToken) && claimToken > 0
        ? claimToken
        : null
      : typeof claimToken === "string" && /^[1-9]\d*$/.test(claimToken)
        ? Number(claimToken)
        : null;
  if (
    !read ||
    read.binding.claimed_worker_id !== String(workerId || "") ||
    !Number.isSafeInteger(selectedClaimToken) ||
    read.binding.claim_run_id !== selectedClaimToken
  ) {
    throw new Error("publisher_claimed_job_authority_invalid");
  }
  return read.authority;
}

function assertClaimedJobAuthority({
  db,
  authority,
  operation,
  admissionContext = null,
} = {}) {
  const selectedOperation = String(operation || "").trim();
  const read = readExactClaimedJob(db, authority?.job_id);
  let admitted = null;
  if (admissionContext) {
    try {
      admitted = buildAdmittedPublicationOperation(
        selectedOperation,
        admissionContext,
      );
    } catch {
      admitted = null;
    }
  }
  if (
    authority?.schema_version !== CLAIMED_JOB_AUTHORITY_SCHEMA ||
    !read ||
    stableJson(read.authority) !== stableJson(authority) ||
    (admissionContext &&
      (!admitted ||
        read.authority.channel_id !== admitted.channel_id ||
        read.authority.story_id !== admitted.story_id)) ||
    (selectedOperation &&
      CLAIMED_JOB_OPERATION_MAP[read.authority.job_kind]?.has(
        selectedOperation,
      ) !== true)
  ) {
    throw new Error("publisher_claimed_job_authority_invalid");
  }
  return true;
}

function assertPublicationAdmissionClaimedJobAuthority({
  db,
  authority,
  operation,
} = {}) {
  const selectedOperation = String(operation || "").trim();
  const expectedJobKind =
    PUBLICATION_ADMISSION_OPERATION_JOB_MAP[selectedOperation] || null;
  const read = readExactClaimedJob(db, authority?.job_id);
  if (
    !expectedJobKind ||
    authority?.schema_version !== CLAIMED_JOB_AUTHORITY_SCHEMA ||
    !read ||
    stableJson(read.authority) !== stableJson(authority) ||
    read.authority.job_kind !== expectedJobKind
  ) {
    throw new Error("publication_admission_claimed_job_authority_invalid");
  }
  return true;
}

function buildPublicationAdmissionRuntimeGenerationLeaseMetadata({
  runtimeAuthority,
  operation,
  claimedJobAuthority,
} = {}) {
  const runtime = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
  const selectedOperation = String(operation || "").trim();
  const claimedJobAuthoritySha256 = String(
    claimedJobAuthority?.claimed_job_authority_sha256 || "",
  ).trim();
  const expectedJobKind =
    PUBLICATION_ADMISSION_OPERATION_JOB_MAP[selectedOperation] || null;
  const claimScope = publicationAdmissionClaimScope(expectedJobKind);
  const channelId = claimedJobAuthority?.channel_id ?? null;
  const storyId = claimedJobAuthority?.story_id ?? null;
  const exactClaimIdentity =
    claimScope === "WINDOW"
      ? channelId === null && storyId === null
      : typeof channelId === "string" &&
        !!channelId.trim() &&
        channelId === channelId.trim() &&
        typeof storyId === "string" &&
        !!storyId.trim() &&
        storyId === storyId.trim();
  if (
    !expectedJobKind ||
    claimedJobAuthority?.job_kind !== expectedJobKind ||
    !exactClaimIdentity ||
    !/^[a-f0-9]{64}$/.test(claimedJobAuthoritySha256)
  ) {
    throw new Error("publication_admission_claimed_job_authority_invalid");
  }
  return {
    ...runtime,
    schema_version: PUBLICATION_ADMISSION_RUNTIME_GENERATION_LEASE_SCHEMA,
    scope: PUBLICATION_ADMISSION_LEASE_SCOPE,
    operation: selectedOperation,
    job_kind: expectedJobKind,
    claim_scope: claimScope,
    channel_id: channelId,
    story_id: storyId,
    claimed_job_authority_sha256: claimedJobAuthoritySha256,
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_create_authority: false,
    platform_mutation_authority: false,
    platform_contact_authority: false,
  };
}

function publicationLifecycleEventSha256(event) {
  return sha256(
    stableJson({
      id: Number(event.id),
      story_id: event.story_id,
      platform: event.platform,
      from_state: event.from_state,
      to_state: event.to_state,
      evidence_json: event.evidence_json,
      idempotency_key: event.idempotency_key,
      created_at: event.created_at,
    }),
  );
}

function readPublicationLifecycleEvent(db, eventId) {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return null;
  return (
    db
      .prepare(
        `SELECT id, story_id, platform, from_state, to_state, evidence_json,
                idempotency_key, created_at
         FROM main.publication_lifecycle_events
         WHERE id = ?`,
      )
      .get(eventId) || null
  );
}

function scheduledAdmissionEvent(db, admitted) {
  const scheduled = readPublicationLifecycleEvent(
    db,
    Number(admitted.scheduled_event_id),
  );
  const latestScheduled = db
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
    Number(latestScheduled?.id) !== Number(scheduled.id) ||
    scheduled.story_id !== admitted.story_id ||
    scheduled.platform !== admitted.platform ||
    scheduled.to_state !== "SCHEDULED" ||
    scheduled.idempotency_key !==
      `${admitted.dispatch_idempotency_key}:lifecycle:SCHEDULED`
  ) {
    return null;
  }
  const evidence = parseMetadata(scheduled.evidence_json);
  if (
    evidence?.schedule_verified !== true ||
    evidence.channel_id !== admitted.channel_id ||
    evidence.control_tower_verdict !== "GREEN" ||
    !canonicalInstant(evidence.control_tower_checked_at) ||
    evidence.scheduled_for !== admitted.scheduled_for ||
    evidence.kill_switch_healthy !== true ||
    evidence.operating_contract_valid !== true ||
    evidence.dispatch_idempotency_key !== admitted.dispatch_idempotency_key ||
    evidence.request_fingerprint !== admitted.request_fingerprint ||
    evidence.runway_lock_sha256 !== admitted.runway_lock_sha256
  ) {
    return null;
  }
  return scheduled;
}

function latestPublicationLifecycle(db, admitted) {
  const latest = db
    .prepare(
      `SELECT id, story_id, platform, from_state, to_state, evidence_json,
              idempotency_key, created_at
       FROM main.publication_lifecycle_events
       WHERE story_id = ? AND platform = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(admitted.story_id, admitted.platform);
  const projection = db
    .prepare(
      `SELECT lifecycle_state
       FROM main.platform_publication_state
       WHERE story_id = ? AND platform = ?`,
    )
    .get(admitted.story_id, admitted.platform);
  return latest && projection?.lifecycle_state === latest.to_state
    ? latest
    : null;
}

function publisherPhaseForStart(operation, startState) {
  if (operation === "publish_next_story") {
    return startState === "SCHEDULED" ? "FRESH_DISPATCH" : null;
  }
  if (startState === "RECONCILIATION_REQUIRED") {
    return "RECOVERY_COMPENSATION";
  }
  return PUBLISHER_OPERATION_STATES[operation]?.has(startState)
    ? "CONTINUATION"
    : null;
}

function buildPublisherStartLifecycleBinding({
  db,
  operation,
  admissionContext,
} = {}) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("publisher_start_lifecycle_authority_invalid");
  }
  const admitted = buildAdmittedPublicationOperation(
    operation,
    admissionContext,
  );
  const scheduled = scheduledAdmissionEvent(db, admitted);
  const latest = latestPublicationLifecycle(db, admitted);
  const phase = latest
    ? publisherPhaseForStart(String(operation || "").trim(), latest.to_state)
    : null;
  if (
    !scheduled ||
    !latest ||
    !phase ||
    !Number.isSafeInteger(Number(latest.id)) ||
    Number(latest.id) < Number(scheduled.id) ||
    (phase === "FRESH_DISPATCH" &&
      Number(latest.id) !== Number(scheduled.id))
  ) {
    throw new Error("publisher_start_lifecycle_authority_invalid");
  }
  return {
    publisher_phase: phase,
    start_lifecycle_event_id: Number(latest.id),
    start_lifecycle_state: latest.to_state,
    start_lifecycle_sha256: publicationLifecycleEventSha256(latest),
  };
}

function buildPublisherRuntimeGenerationLeaseMetadata({
  runtimeAuthority,
  operation,
  admissionContext,
  startLifecycleBinding,
  claimedJobAuthority,
} = {}) {
  const runtime = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
  const admittedOperation = buildAdmittedPublicationOperation(
    operation,
    admissionContext,
  );
  const publisherPhase = String(
    startLifecycleBinding?.publisher_phase || "",
  ).trim();
  const startLifecycleEventId = Number(
    startLifecycleBinding?.start_lifecycle_event_id,
  );
  const startLifecycleState = String(
    startLifecycleBinding?.start_lifecycle_state || "",
  ).trim();
  const startLifecycleSha256 = String(
    startLifecycleBinding?.start_lifecycle_sha256 || "",
  ).trim();
  if (
    !["FRESH_DISPATCH", "CONTINUATION", "RECOVERY_COMPENSATION"].includes(
      publisherPhase,
    ) ||
    !Number.isSafeInteger(startLifecycleEventId) ||
    startLifecycleEventId <= 0 ||
    !/^[A-Z][A-Z0-9_]{0,127}$/.test(startLifecycleState) ||
    !/^[a-f0-9]{64}$/.test(startLifecycleSha256) ||
    publisherPhaseForStart(String(operation || "").trim(), startLifecycleState) !==
      publisherPhase ||
    (publisherPhase === "FRESH_DISPATCH" &&
      startLifecycleEventId !== admittedOperation.scheduled_event_id)
  ) {
    throw new Error("publisher_start_lifecycle_authority_invalid");
  }
  const startLifecycle = {
    publisher_phase: publisherPhase,
    start_lifecycle_event_id: startLifecycleEventId,
    start_lifecycle_state: startLifecycleState,
    start_lifecycle_sha256: startLifecycleSha256,
  };
  const claimedJobAuthoritySha256 = String(
    claimedJobAuthority?.claimed_job_authority_sha256 || "",
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(claimedJobAuthoritySha256)) {
    throw new Error("publisher_claimed_job_authority_invalid");
  }
  return {
    ...runtime,
    schema_version: PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
    operation: String(operation || "").trim(),
    admitted_operation: admittedOperation,
    claimed_job_authority_sha256: claimedJobAuthoritySha256,
    ...startLifecycle,
    admitted_operation_sha256: sha256(
      stableJson({
        operation: String(operation || "").trim(),
        admitted_operation: admittedOperation,
        start_lifecycle: startLifecycle,
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
    if (
      main.length !== 1 ||
      !String(main[0]?.file || "").trim() ||
      nonMain.length !== 0
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

function normaliseSchemaSql(input) {
  const value = String(input || "");
  let output = "";
  let mode = "normal";
  let pendingWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (mode === "line_comment") {
      if (character === "\n" || character === "\r") {
        mode = "normal";
        pendingWhitespace = true;
      }
      continue;
    }
    if (mode === "block_comment") {
      if (character === "*" && next === "/") {
        mode = "normal";
        index += 1;
        pendingWhitespace = true;
      }
      continue;
    }
    if (["single", "double", "backtick"].includes(mode)) {
      output += character;
      const quote = mode === "single" ? "'" : mode === "double" ? '"' : "`";
      if (character === quote) {
        if (next === quote) {
          output += next;
          index += 1;
        } else {
          mode = "normal";
        }
      }
      continue;
    }
    if (mode === "bracket") {
      output += character;
      if (character === "]") {
        if (next === "]") {
          output += next;
          index += 1;
        } else {
          mode = "normal";
        }
      }
      continue;
    }
    if (character === "-" && next === "-") {
      mode = "line_comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      mode = "block_comment";
      index += 1;
      continue;
    }
    if (/\s/.test(character)) {
      pendingWhitespace = true;
      continue;
    }
    if (pendingWhitespace && output) output += " ";
    pendingWhitespace = false;
    output += character;
    if (character === "'") mode = "single";
    else if (character === '"') mode = "double";
    else if (character === "`") mode = "backtick";
    else if (character === "[") mode = "bracket";
  }
  return output.trim();
}

function schemaObjectSql(db, type, name) {
  return (
    db
      .prepare(
        `SELECT sql
         FROM main.sqlite_schema
         WHERE type = ? AND name = ?`,
      )
      .get(type, name)?.sql ?? null
  );
}

function authoritySchemaManifest(db) {
  const tables = AUTHORITY_TABLE_NAMES.map((tableName) => {
    const indexes = db
      .prepare(`PRAGMA main.index_list(${JSON.stringify(tableName)})`)
      .all()
      .map((index) => {
        const sql = schemaObjectSql(db, "index", index.name);
        return {
          name: index.name,
          unique: index.unique,
          origin: index.origin,
          partial: index.partial,
          sql: sql === null ? null : normaliseSchemaSql(sql),
          columns: db
            .prepare(`PRAGMA main.index_xinfo(${JSON.stringify(index.name)})`)
            .all()
            .map(({ seqno, cid, name, desc, coll, key }) => ({
              seqno,
              cid,
              name,
              desc,
              coll,
              key,
            })),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      name: tableName,
      sql: normaliseSchemaSql(schemaObjectSql(db, "table", tableName)),
      columns: db
        .prepare(`PRAGMA main.table_xinfo(${JSON.stringify(tableName)})`)
        .all()
        .map(({ cid, name, type, notnull, dflt_value, pk, hidden }) => ({
          cid,
          name,
          type,
          notnull,
          dflt_value,
          pk,
          hidden,
        })),
      indexes,
      foreign_keys: db
        .prepare(`PRAGMA main.foreign_key_list(${JSON.stringify(tableName)})`)
        .all()
        .map(
          ({ id, seq, table, from, to, on_update, on_delete, match }) => ({
            id,
            seq,
            table,
            from,
            to,
            on_update,
            on_delete,
            match,
          }),
        )
        .sort((left, right) => left.id - right.id || left.seq - right.seq),
    };
  });
  const triggers = db
    .prepare(
      `SELECT name, tbl_name, sql
       FROM main.sqlite_schema
       WHERE type = 'trigger'
       ORDER BY name, tbl_name`,
    )
    .all()
    .map((trigger) => ({
      name: trigger.name,
      tbl_name: trigger.tbl_name,
      sql: normaliseSchemaSql(trigger.sql),
    }));
  const placeholders = AUTHORITY_MIGRATION_VERSIONS.map(() => "?").join(", ");
  const migrations = db
    .prepare(
      `SELECT version, filename, checksum
       FROM main.schema_migrations
       WHERE version IN (${placeholders})
       ORDER BY version`,
    )
    .all(...AUTHORITY_MIGRATION_VERSIONS);
  return { tables, triggers, migrations };
}

function inspectMainAuthoritySchema(db) {
  if (Number(db.pragma("foreign_keys", { simple: true })) !== 1) {
    return {
      ok: false,
      blocker: "runtime_db_foreign_keys_disabled",
      schema_sha256: null,
    };
  }
  try {
    const schemaSha256 = sha256(stableJson(authoritySchemaManifest(db)));
    return {
      ok: schemaSha256 === CANONICAL_AUTHORITY_SCHEMA_SHA256,
      blocker:
        schemaSha256 === CANONICAL_AUTHORITY_SCHEMA_SHA256
          ? null
          : "runtime_db_schema_invalid",
      schema_sha256: schemaSha256,
    };
  } catch {
    return {
      ok: false,
      blocker: "runtime_db_schema_invalid",
      schema_sha256: null,
    };
  }
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

function inspectLeaseTimeContract(row, nowMs, { ttlMs, freshnessMs }) {
  if (!row) return { valid: true, active: false, times: null };
  const acquiredAt = canonicalInstant(row.acquired_at);
  const heartbeatAt = canonicalInstant(row.heartbeat_at);
  const expiresAt = canonicalInstant(row.expires_at);
  if (!acquiredAt || !heartbeatAt || !expiresAt) {
    return { valid: false, active: false, times: null };
  }
  const acquiredAtMs = Date.parse(acquiredAt);
  const heartbeatAtMs = Date.parse(heartbeatAt);
  const expiresAtMs = Date.parse(expiresAt);
  const active = expiresAtMs > nowMs;
  const valid =
    acquiredAtMs <= heartbeatAtMs &&
    heartbeatAtMs <= nowMs &&
    expiresAtMs > heartbeatAtMs &&
    expiresAtMs - heartbeatAtMs <= ttlMs &&
    (!active || nowMs - heartbeatAtMs <= freshnessMs);
  return {
    valid,
    active: valid && active,
    times: valid
      ? {
          acquired_at: acquiredAt,
          heartbeat_at: heartbeatAt,
          expires_at: expiresAt,
        }
      : null,
  };
}

function leaseEvidence(
  row,
  timeContract,
  { mode, metadataTrusted = false, expected = null } = {},
) {
  if (!row) {
    return { present: false, active: false };
  }
  const evidence = {
    present: true,
    active: timeContract.active,
    time_contract_valid: timeContract.valid,
    ...(timeContract.times || {}),
    owner_sha256: sha256(row.owner_id),
  };
  if (mode === "LIVE" && metadataTrusted && expected) {
    evidence.metadata_binding_matches = true;
    evidence.runtime_instance_id = expected.runtime_instance_id;
    evidence.process_id = expected.child_pid;
    evidence.process_started_at = expected.child_started_at;
    evidence.authority_fingerprint = expected.authority_fingerprint;
  }
  return evidence;
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

function schedulerRuntimeAuthorityMatches(db, runtimeAuthority) {
  if (!db || typeof db.prepare !== "function") return false;
  let runtime;
  try {
    runtime = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
  } catch {
    return false;
  }
  let row;
  try {
    row = db
      .prepare(
        `SELECT acquired_at, heartbeat_at, expires_at, metadata
         FROM main.runtime_leases
         WHERE name = 'scheduler:primary'
           AND datetime(expires_at) > datetime('now')`,
      )
      .get();
  } catch {
    return false;
  }
  const timeContract = inspectLeaseTimeContract(row, Date.now(), {
    ttlMs: SCHEDULER_LEASE_TTL_MS,
    freshnessMs: SCHEDULER_LEASE_FRESHNESS_MS,
  });
  if (!row || !timeContract.valid || !timeContract.active) return false;
  const expectedMetadata = {
    purpose: "single_owner_scheduler_dispatch",
    ...runtime,
  };
  return stableJson(parseMetadata(row.metadata)) === stableJson(expectedMetadata);
}

function publisherAdmissionMatches(db, metadata) {
  const admitted = metadata?.admitted_operation;
  const startLifecycle = {
    publisher_phase: metadata?.publisher_phase,
    start_lifecycle_event_id: Number(metadata?.start_lifecycle_event_id),
    start_lifecycle_state: metadata?.start_lifecycle_state,
    start_lifecycle_sha256: metadata?.start_lifecycle_sha256,
  };
  if (
    !ADMITTED_PUBLISHER_OPERATIONS.has(metadata?.operation) ||
    admitted?.schema_version !== ADMITTED_PUBLICATION_OPERATION_SCHEMA ||
    !admitted.channel_id ||
    metadata?.channel_id !== admitted.channel_id ||
    !admitted.story_id ||
    admitted.platform !== "youtube" ||
    typeof admitted.scheduled_event_id !== "number" ||
    !Number.isSafeInteger(admitted.scheduled_event_id) ||
    admitted.scheduled_event_id <= 0 ||
    !canonicalInstant(admitted.scheduled_for) ||
    !admitted.dispatch_idempotency_key ||
    !/^[a-f0-9]{64}$/.test(String(admitted.request_fingerprint || "")) ||
    !/^[a-f0-9]{64}$/.test(String(admitted.runway_lock_sha256 || "")) ||
    !/^[a-f0-9]{64}$/.test(
      String(metadata?.lease_instance_sha256 || ""),
    ) ||
    !/^[a-f0-9]{64}$/.test(
      String(metadata.claimed_job_authority_sha256 || ""),
    ) ||
    metadata.publisher_operation_set_sha256 !==
      PUBLISHER_OPERATION_SET_SHA256 ||
    !["FRESH_DISPATCH", "CONTINUATION", "RECOVERY_COMPENSATION"].includes(
      startLifecycle.publisher_phase,
    ) ||
    !Number.isSafeInteger(startLifecycle.start_lifecycle_event_id) ||
    startLifecycle.start_lifecycle_event_id <= 0 ||
    !/^[A-Z][A-Z0-9_]{0,127}$/.test(
      String(startLifecycle.start_lifecycle_state || ""),
    ) ||
    !/^[a-f0-9]{64}$/.test(
      String(startLifecycle.start_lifecycle_sha256 || ""),
    ) ||
    metadata.admitted_operation_sha256 !==
      sha256(
        stableJson({
          operation: metadata.operation,
          admitted_operation: admitted,
          start_lifecycle: startLifecycle,
        }),
      )
  ) {
    return false;
  }
  let activeClaimMatches = [];
  try {
    activeClaimMatches = db
      .prepare(
        `SELECT id
         FROM main.jobs
         WHERE status IN ('claimed', 'running')
           AND lease_until IS NOT NULL
           AND datetime(lease_until) > datetime('now')
         ORDER BY id`,
      )
      .all()
      .map((row) => readExactClaimedJob(db, row.id))
      .filter(
        (read) =>
          read &&
          read.authority.claimed_job_authority_sha256 ===
            metadata.claimed_job_authority_sha256 &&
          read.authority.channel_id === admitted.channel_id &&
          read.authority.story_id === admitted.story_id &&
          CLAIMED_JOB_OPERATION_MAP[read.authority.job_kind]?.has(
            metadata.operation,
          ) === true,
      );
  } catch {
    return false;
  }
  if (activeClaimMatches.length !== 1) return false;
  const scheduled = scheduledAdmissionEvent(db, admitted);
  const start = readPublicationLifecycleEvent(
    db,
    startLifecycle.start_lifecycle_event_id,
  );
  if (
    !scheduled ||
    !start ||
    start.story_id !== admitted.story_id ||
    start.platform !== admitted.platform ||
    start.to_state !== startLifecycle.start_lifecycle_state ||
    publicationLifecycleEventSha256(start) !==
      startLifecycle.start_lifecycle_sha256 ||
    publisherPhaseForStart(metadata.operation, start.to_state) !==
      startLifecycle.publisher_phase ||
    Number(start.id) < Number(scheduled.id) ||
    (startLifecycle.publisher_phase === "FRESH_DISPATCH" &&
      Number(start.id) !== Number(scheduled.id))
  ) {
    return false;
  }
  const latestOverall = latestPublicationLifecycle(db, admitted);
  return (
    !!latestOverall &&
    Number(latestOverall.id) >= Number(start.id) &&
    PUBLISHER_OPERATION_STATES[metadata.operation]?.has(
      latestOverall.to_state,
    ) === true
  );
}

function publicationAdmissionClaimMatches(db, metadata) {
  const operation = String(metadata?.operation || "").trim();
  const expectedJobKind =
    PUBLICATION_ADMISSION_OPERATION_JOB_MAP[operation] || null;
  const closedFields = [
    "authority_fingerprint",
    "channel_id",
    "claim_scope",
    "claimed_job_authority_sha256",
    "dispatch_authorised",
    "external_create_authority",
    "lease_instance_sha256",
    "job_kind",
    "operation",
    "operational_publish_authority",
    "platform_contact_authority",
    "platform_mutation_authority",
    "process_id",
    "process_started_at",
    "runtime_instance_id",
    "schema_version",
    "scope",
    "story_id",
  ].sort();
  if (
    !metadata ||
    Object.keys(metadata).sort().join("\0") !== closedFields.join("\0") ||
    metadata.schema_version !==
      PUBLICATION_ADMISSION_RUNTIME_GENERATION_LEASE_SCHEMA ||
    metadata.scope !== PUBLICATION_ADMISSION_LEASE_SCOPE ||
    !expectedJobKind ||
    metadata.job_kind !== expectedJobKind ||
    metadata.claim_scope !==
      publicationAdmissionClaimScope(expectedJobKind) ||
    (metadata.claim_scope === "WINDOW"
      ? metadata.channel_id !== null || metadata.story_id !== null
      : !String(metadata.channel_id || "").trim() ||
        !String(metadata.story_id || "").trim()) ||
    !/^[a-f0-9]{64}$/.test(
      String(metadata.claimed_job_authority_sha256 || ""),
    ) ||
    !/^[a-f0-9]{64}$/.test(
      String(metadata.lease_instance_sha256 || ""),
    ) ||
    metadata.operational_publish_authority !== false ||
    metadata.dispatch_authorised !== false ||
    metadata.external_create_authority !== false ||
    metadata.platform_mutation_authority !== false ||
    metadata.platform_contact_authority !== false
  ) {
    return false;
  }
  try {
    const activeClaimMatches = db
      .prepare(
        `SELECT id
         FROM main.jobs
         WHERE status IN ('claimed', 'running')
           AND lease_until IS NOT NULL
           AND julianday(lease_until) > julianday('now')
         ORDER BY id`,
      )
      .all()
      .map((row) => readExactClaimedJob(db, row.id))
      .filter(
        (read) =>
          read &&
          read.authority.job_kind === expectedJobKind &&
          read.authority.channel_id === metadata.channel_id &&
          read.authority.story_id === metadata.story_id &&
          read.authority.claimed_job_authority_sha256 ===
            metadata.claimed_job_authority_sha256,
      );
    return activeClaimMatches.length === 1;
  } catch {
    return false;
  }
}

function inspectLive({ db, expected, nowMs }) {
  const blockers = [];
  const leaseRows = db
    .prepare(
      `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at, metadata
       FROM main.runtime_leases
       WHERE name IN (?, ?, ?)
       ORDER BY name`,
    )
    .all(...LIVE_LEASE_NAMES);
  const leases = new Map(leaseRows.map((row) => [row.name, row]));
  const schedulerRow = leases.get("scheduler:primary") || null;
  const schedulerMetadata = parseMetadata(schedulerRow?.metadata);
  const schedulerTimeContract = inspectLeaseTimeContract(schedulerRow, nowMs, {
    ttlMs: SCHEDULER_LEASE_TTL_MS,
    freshnessMs: SCHEDULER_LEASE_FRESHNESS_MS,
  });
  const schedulerMetadataMatches = runtimeLeaseMetadataMatches(
    schedulerMetadata,
    expected,
  );
  const schedulerLease = leaseEvidence(schedulerRow, schedulerTimeContract, {
    mode: "LIVE",
    metadataTrusted: schedulerMetadataMatches,
    expected,
  });
  if (!schedulerRow) {
    blockers.push("runtime_db_scheduler_lease_missing");
  } else if (!schedulerTimeContract.valid) {
    blockers.push("runtime_db_scheduler_lease_time_invalid");
  } else if (!schedulerLease.active) {
    blockers.push("runtime_db_scheduler_lease_expired");
  } else if (!schedulerMetadataMatches) {
    blockers.push("runtime_db_scheduler_lease_binding_mismatch");
  }
  const publisherRow = leases.get("publisher:global") || null;
  const publisherMetadata = parseMetadata(publisherRow?.metadata);
  const publisherTimeContract = inspectLeaseTimeContract(publisherRow, nowMs, {
    ttlMs: PUBLISHER_LEASE_TTL_MS,
    freshnessMs: PUBLISHER_LEASE_FRESHNESS_MS,
  });
  const publisherMetadataMatches = runtimeLeaseMetadataMatches(
    publisherMetadata,
    expected,
    PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
  );
  const publisherLease = leaseEvidence(publisherRow, publisherTimeContract, {
    mode: "LIVE",
    metadataTrusted: publisherMetadataMatches,
    expected,
  });
  if (publisherRow && !publisherTimeContract.valid) {
    blockers.push("runtime_db_publisher_lease_time_invalid");
  } else if (publisherLease.active) {
    if (!publisherMetadataMatches) {
      blockers.push("runtime_db_publisher_lease_binding_mismatch");
    } else if (!publisherAdmissionMatches(db, publisherMetadata)) {
      blockers.push("runtime_db_publisher_admission_mismatch");
    }
  }
  const publicationAdmissionRow =
    leases.get("publication-admission:global") || null;
  const publicationAdmissionMetadata = parseMetadata(
    publicationAdmissionRow?.metadata,
  );
  const publicationAdmissionTimeContract = inspectLeaseTimeContract(
    publicationAdmissionRow,
    nowMs,
    {
      ttlMs: PUBLICATION_ADMISSION_LEASE_TTL_MS,
      freshnessMs: PUBLICATION_ADMISSION_LEASE_FRESHNESS_MS,
    },
  );
  const publicationAdmissionMetadataMatches =
    runtimeLeaseMetadataMatches(
      publicationAdmissionMetadata,
      expected,
      PUBLICATION_ADMISSION_RUNTIME_GENERATION_LEASE_SCHEMA,
    );
  const publicationAdmissionLease = leaseEvidence(
    publicationAdmissionRow,
    publicationAdmissionTimeContract,
    {
      mode: "LIVE",
      metadataTrusted: publicationAdmissionMetadataMatches,
      expected,
    },
  );
  if (
    publicationAdmissionRow &&
    !publicationAdmissionTimeContract.valid
  ) {
    blockers.push(
      "runtime_db_publication_admission_lease_time_invalid",
    );
  } else if (publicationAdmissionLease.active) {
    if (!publicationAdmissionMetadataMatches) {
      blockers.push(
        "runtime_db_publication_admission_lease_binding_mismatch",
      );
    } else if (
      !publicationAdmissionClaimMatches(
        db,
        publicationAdmissionMetadata,
      )
    ) {
      blockers.push(
        "runtime_db_publication_admission_claim_mismatch",
      );
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
      `SELECT id, kind, channel_id, story_id, payload, run_at, status,
              claimed_by, lease_until, attempt_count, idempotency_key
       FROM main.jobs
       WHERE status IN ('claimed', 'running')
       ORDER BY id`,
    )
    .all();
  const foreignClaimJobIds = new Set();
  for (const claim of activeClaims) {
    if (
      !Number.isSafeInteger(claim.id) ||
      claim.id <= 0 ||
      !Number.isSafeInteger(claim.attempt_count) ||
      claim.attempt_count <= 0 ||
      typeof claim.kind !== "string" ||
      !/^[a-z][a-z0-9_]{0,127}$/.test(claim.kind)
    ) {
      blockers.push("runtime_db_active_job_run_binding_mismatch");
    }
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
      !Number.isSafeInteger(run.id) ||
      run.id <= 0 ||
      !Number.isSafeInteger(run.job_id) ||
      run.job_id <= 0 ||
      !Number.isSafeInteger(run.attempt) ||
      run.attempt <= 0 ||
      run.worker_id !== claim.claimed_by ||
      run.attempt !== claim.attempt_count ||
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

  const claimBindingBlockers = new Set([
    "runtime_db_active_job_foreign_worker",
    "runtime_db_active_job_run_missing",
    "runtime_db_active_job_run_duplicate",
    "runtime_db_active_job_run_binding_mismatch",
    "runtime_db_open_job_run_orphan",
    "runtime_db_open_job_run_foreign_worker",
  ]);
  const canCompareClaimSet = !blockers.some((blocker) =>
    claimBindingBlockers.has(blocker),
  );
  let runtimeClaimSetSha256 = null;
  if (canCompareClaimSet) {
    runtimeClaimSetSha256 = buildRunningClaimSetSha256(
      activeClaims.map((claim) => {
        const run = runsByJobId.get(claim.id)?.[0];
        return {
          worker_id: claim.claimed_by,
          job_id: claim.id,
          kind: claim.kind,
          run_id: run?.id,
          attempt: claim.attempt_count,
        };
      }),
    );
    if (
      activeClaims.length !== expected.runtime_claim_set_count ||
      runtimeClaimSetSha256 === null ||
      runtimeClaimSetSha256 !== expected.runtime_claim_set_sha256
    ) {
      blockers.push("runtime_db_runtime_claim_set_mismatch");
    }
  }

  return {
    blockers: [...new Set(blockers)],
    evidence: {
      scheduler_lease: schedulerLease,
      publisher_lease: publisherLease,
      publication_admission_lease: publicationAdmissionLease,
      worker_topology: {
        expected_count: expected.worker_ids.length,
        active_count: actualWorkerIds.length,
      },
      active_claim_count: activeClaims.length,
      runtime_claim_set_sha256: runtimeClaimSetSha256,
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
         WHERE name IN (?, ?, ?)
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
        `SELECT id, kind, channel_id, story_id, payload, run_at, status,
                claimed_by, lease_until, attempt_count, idempotency_key
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
      `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at, metadata
       FROM main.runtime_leases
       WHERE name IN (?, ?, ?)
       ORDER BY name`,
    )
    .all(...LIVE_LEASE_NAMES);
  const leases = new Map(leaseRows.map((row) => [row.name, row]));
  const schedulerRow = leases.get("scheduler:primary") || null;
  const publisherRow = leases.get("publisher:global") || null;
  const publicationAdmissionRow =
    leases.get("publication-admission:global") || null;
  const schedulerTimeContract = inspectLeaseTimeContract(schedulerRow, nowMs, {
    ttlMs: SCHEDULER_LEASE_TTL_MS,
    freshnessMs: SCHEDULER_LEASE_FRESHNESS_MS,
  });
  const publisherTimeContract = inspectLeaseTimeContract(publisherRow, nowMs, {
    ttlMs: PUBLISHER_LEASE_TTL_MS,
    freshnessMs: PUBLISHER_LEASE_FRESHNESS_MS,
  });
  const publicationAdmissionTimeContract = inspectLeaseTimeContract(
    publicationAdmissionRow,
    nowMs,
    {
      ttlMs: PUBLICATION_ADMISSION_LEASE_TTL_MS,
      freshnessMs: PUBLICATION_ADMISSION_LEASE_FRESHNESS_MS,
    },
  );
  const schedulerLease = leaseEvidence(schedulerRow, schedulerTimeContract, {
    mode: "QUIESCENT",
  });
  const publisherLease = leaseEvidence(publisherRow, publisherTimeContract, {
    mode: "QUIESCENT",
  });
  const publicationAdmissionLease = leaseEvidence(
    publicationAdmissionRow,
    publicationAdmissionTimeContract,
    { mode: "QUIESCENT" },
  );
  if (schedulerRow && !schedulerTimeContract.valid) {
    blockers.push("runtime_db_scheduler_lease_time_invalid");
  }
  if (publisherRow && !publisherTimeContract.valid) {
    blockers.push("runtime_db_publisher_lease_time_invalid");
  }
  if (
    publicationAdmissionRow &&
    !publicationAdmissionTimeContract.valid
  ) {
    blockers.push(
      "runtime_db_publication_admission_lease_time_invalid",
    );
  }
  if (schedulerLease.active) {
    blockers.push("runtime_db_quiescent_scheduler_lease_active");
  }
  if (publisherLease.active) {
    blockers.push("runtime_db_quiescent_publisher_lease_active");
  }
  if (publicationAdmissionLease.active) {
    blockers.push(
      "runtime_db_quiescent_publication_admission_lease_active",
    );
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
      publication_admission_lease: publicationAdmissionLease,
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
      const schemaInspection = inspectMainAuthoritySchema(db);
      if (!schemaInspection.ok) {
        return {
          schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
          ok: false,
          mode: selectedMode,
          database_identity_sha256: databaseIdentity.database_identity_sha256,
          blockers: [schemaInspection.blocker],
          evidence: {
            database_identity_sha256: databaseIdentity.database_identity_sha256,
            authority_schema_sha256: schemaInspection.schema_sha256,
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
  CLAIMED_JOB_AUTHORITY_SCHEMA,
  PUBLICATION_ADMISSION_LEASE_SCOPE,
  PUBLICATION_ADMISSION_OPERATION_JOB_MAP,
  PUBLICATION_ADMISSION_RUNTIME_GENERATION_LEASE_SCHEMA,
  PUBLISHER_RUNTIME_GENERATION_LEASE_SCHEMA,
  RUNTIME_GENERATION_LEASE_SCHEMA,
  assertClaimedJobAuthority,
  assertPublicationAdmissionClaimedJobAuthority,
  buildAdmittedPublicationOperation,
  buildClaimedJobAuthority,
  buildPublisherStartLifecycleBinding,
  buildPublisherRuntimeGenerationLeaseMetadata,
  buildPublicationAdmissionRuntimeGenerationLeaseMetadata,
  buildRuntimeGenerationLeaseMetadata,
  claimedJobKindRequiresPublisherAuthority,
  claimedJobKindRequiresPublicationAdmissionAuthority,
  inspectBoundedRuntimeDbAuthority,
  publisherAdmissionMatches,
  schedulerRuntimeAuthorityMatches,
};
