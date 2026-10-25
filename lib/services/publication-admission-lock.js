"use strict";

const crypto = require("node:crypto");
const os = require("node:os");

const {
  isRuntimeLeaseRepositoryBoundToDatabase,
} = require("../repositories/runtime_leases");
const {
  assertPublicationAdmissionClaimedJobAuthority,
  buildPublicationAdmissionRuntimeGenerationLeaseMetadata,
  buildRuntimeGenerationLeaseMetadata,
} = require("../stabilisation/bounded-runtime-db-authority");

const PUBLICATION_ADMISSION_LEASE_NAME = "publication-admission:global";
const DEFAULT_PUBLICATION_ADMISSION_LEASE_MS = 90 * 1000;
const MAX_PUBLICATION_ADMISSION_LEASE_MS = 15 * 60 * 1000;
const SCHEDULER_LEASE_TTL_MS = 90 * 1000;
const privateLeaseState = new WeakMap();

class PublicationAdmissionLeaseLostError extends Error {
  constructor() {
    super("publication_admission_lease_lost");
    this.name = "PublicationAdmissionLeaseLostError";
    this.code = "publication_admission_lease_lost";
  }
}

function defaultPublicationAdmissionOwnerId() {
  return `publication-admission:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalInstant(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString() === value ? value : null;
}

function sqliteInstantMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalised =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

function sqliteNow(db) {
  const value = db
    .prepare(
      "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now_iso",
    )
    .get()?.now_iso;
  const nowIso = canonicalInstant(value);
  if (!nowIso) throw new Error("publication_admission_sqlite_time_invalid");
  return { nowIso, nowMs: Date.parse(nowIso) };
}

function requiredLeaseMs(value) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > MAX_PUBLICATION_ADMISSION_LEASE_MS
  ) {
    throw new Error("publication_admission_lease_duration_invalid");
  }
  return Math.floor(parsed);
}

function schedulerAuthorityMatches(db, runtimeAuthority, nowMs) {
  let runtime;
  try {
    runtime = buildRuntimeGenerationLeaseMetadata(runtimeAuthority);
  } catch {
    return false;
  }
  const row = db
    .prepare(
      `SELECT acquired_at, heartbeat_at, expires_at, metadata
       FROM main.runtime_leases
       WHERE name = 'scheduler:primary'`,
    )
    .get();
  const acquiredAt = canonicalInstant(row?.acquired_at);
  const heartbeatAt = canonicalInstant(row?.heartbeat_at);
  const expiresAt = canonicalInstant(row?.expires_at);
  const acquiredAtMs = Date.parse(acquiredAt);
  const heartbeatAtMs = Date.parse(heartbeatAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !row ||
    !acquiredAt ||
    !heartbeatAt ||
    !expiresAt ||
    acquiredAtMs > heartbeatAtMs ||
    heartbeatAtMs > nowMs + 1 ||
    nowMs - heartbeatAtMs > SCHEDULER_LEASE_TTL_MS ||
    expiresAtMs <= heartbeatAtMs ||
    expiresAtMs - heartbeatAtMs > SCHEDULER_LEASE_TTL_MS ||
    expiresAtMs <= nowMs
  ) {
    return false;
  }
  let metadata;
  try {
    metadata = JSON.parse(row.metadata);
  } catch {
    return false;
  }
  return (
    stableJson(metadata) ===
    stableJson({
      purpose: "single_owner_scheduler_dispatch",
      ...runtime,
    })
  );
}

function activeClaimExpiry({ db, authority, operation, nowMs }) {
  assertPublicationAdmissionClaimedJobAuthority({
    db,
    authority,
    operation,
  });
  const row = db
    .prepare(
      `SELECT lease_until
       FROM main.jobs
       WHERE id = ?
         AND status IN ('claimed', 'running')`,
    )
    .get(authority.job_id);
  const leaseUntilMs = sqliteInstantMs(row?.lease_until);
  if (leaseUntilMs === null || leaseUntilMs <= nowMs) {
    throw new Error("publication_admission_claim_expired");
  }
  return leaseUntilMs;
}

function cappedExpiry({ db, authority, operation, nowMs, leaseMs }) {
  const claimExpiryMs = activeClaimExpiry({
    db,
    authority,
    operation,
    nowMs,
  });
  const expiresAtMs = Math.min(nowMs + requiredLeaseMs(leaseMs), claimExpiryMs);
  if (expiresAtMs <= nowMs) {
    throw new Error("publication_admission_claim_expired");
  }
  return new Date(expiresAtMs).toISOString();
}

function acquiredHandle({ acquired, expiresAt, ownerSha256, claimSha256 }) {
  const initialExpiresAt = canonicalInstant(expiresAt);
  const handle = {
    acquired: acquired === true,
    lease_name: PUBLICATION_ADMISSION_LEASE_NAME,
    current_lock_owner_sha256: ownerSha256 || null,
    claimed_job_authority_sha256: claimSha256 || null,
  };
  Object.defineProperties(handle, {
    expires_at: {
      enumerable: true,
      get() {
        return privateLeaseState.get(handle)?.expiresAt || initialExpiresAt;
      },
    },
    assertHealthy: {
      enumerable: false,
      value() {
        if (!assertLeaseHealthy(handle, { inTransaction: false })) {
          throw new PublicationAdmissionLeaseLostError();
        }
        return true;
      },
    },
    assertHealthyInTransaction: {
      enumerable: false,
      value() {
        const state = privateLeaseState.get(handle);
        if (!state?.db?.inTransaction) {
          throw new Error("publication_admission_transaction_required");
        }
        if (!assertLeaseHealthy(handle, { inTransaction: true })) {
          throw new PublicationAdmissionLeaseLostError();
        }
        return true;
      },
    },
  });
  return Object.freeze(handle);
}

function acquirePublicationAdmissionLease({
  db,
  leases,
  ownerId = defaultPublicationAdmissionOwnerId(),
  operation,
  runtimeAuthority,
  claimedJobAuthority,
  leaseMs = DEFAULT_PUBLICATION_ADMISSION_LEASE_MS,
} = {}) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    !leases ||
    !isRuntimeLeaseRepositoryBoundToDatabase(leases, db)
  ) {
    throw new Error(
      "publication_admission_runtime_lease_repository_database_mismatch",
    );
  }
  const selectedOwnerId = String(ownerId || "").trim();
  const selectedOperation = String(operation || "").trim();
  if (!selectedOwnerId) {
    throw new Error("publication_admission_owner_required");
  }
  const durationMs = requiredLeaseMs(leaseMs);
  const transaction = db.transaction(() => {
    const { nowIso, nowMs } = sqliteNow(db);
    if (!schedulerAuthorityMatches(db, runtimeAuthority, nowMs)) {
      throw new Error("publication_admission_runtime_generation_authority_invalid");
    }
    assertPublicationAdmissionClaimedJobAuthority({
      db,
      authority: claimedJobAuthority,
      operation: selectedOperation,
    });
    const expiresAt = cappedExpiry({
      db,
      authority: claimedJobAuthority,
      operation: selectedOperation,
      nowMs,
      leaseMs: durationMs,
    });
    const metadata = {
      ...buildPublicationAdmissionRuntimeGenerationLeaseMetadata({
        runtimeAuthority,
        operation: selectedOperation,
        claimedJobAuthority,
      }),
      lease_instance_sha256: crypto.randomBytes(32).toString("hex"),
    };
    if (Number(metadata.process_id) !== process.pid) {
      throw new Error("publication_admission_runtime_process_identity_mismatch");
    }
    const metadataJson = JSON.stringify(metadata);
    const current = db
      .prepare(
        `SELECT owner_id, expires_at, metadata
         FROM main.runtime_leases
         WHERE name = ?`,
      )
      .get(PUBLICATION_ADMISSION_LEASE_NAME);
    if (current && sqliteInstantMs(current.expires_at) > nowMs) {
      return {
        acquired: false,
        expiresAt: current.expires_at,
        ownerSha256: sha256(current.owner_id),
        metadata: null,
      };
    }
    if (current) {
      db.prepare(
        `UPDATE main.runtime_leases
         SET owner_id = ?, acquired_at = ?, heartbeat_at = ?,
             expires_at = ?, metadata = ?
         WHERE name = ?`,
      ).run(
        selectedOwnerId,
        nowIso,
        nowIso,
        expiresAt,
        metadataJson,
        PUBLICATION_ADMISSION_LEASE_NAME,
      );
    } else {
      db.prepare(
        `INSERT INTO main.runtime_leases
           (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        PUBLICATION_ADMISSION_LEASE_NAME,
        selectedOwnerId,
        nowIso,
        nowIso,
        expiresAt,
        metadataJson,
      );
    }
    return {
      acquired: true,
      expiresAt,
      ownerSha256: sha256(selectedOwnerId),
      metadata: metadataJson,
    };
  });
  const result = transaction.immediate();
  const handle = acquiredHandle({
    acquired: result.acquired,
    expiresAt: result.expiresAt,
    ownerSha256: result.ownerSha256,
    claimSha256:
      claimedJobAuthority?.claimed_job_authority_sha256 || null,
  });
  privateLeaseState.set(
    handle,
    Object.freeze({
      db,
      leases,
      ownerId: result.acquired ? selectedOwnerId : null,
      metadata: result.metadata,
      operation: selectedOperation,
      runtimeAuthority,
      claimedJobAuthority,
      leaseMs: durationMs,
      expiresAt: result.expiresAt,
    }),
  );
  return handle;
}

function exactLeaseHealthy(state) {
  const { nowMs } = sqliteNow(state.db);
  if (!schedulerAuthorityMatches(state.db, state.runtimeAuthority, nowMs)) {
    return false;
  }
  try {
    const claimExpiryMs = activeClaimExpiry({
      db: state.db,
      authority: state.claimedJobAuthority,
      operation: state.operation,
      nowMs,
    });
    const row = state.db
      .prepare(
        `SELECT owner_id, expires_at, metadata
         FROM main.runtime_leases
         WHERE name = ?`,
      )
      .get(PUBLICATION_ADMISSION_LEASE_NAME);
    const expiresAtMs = sqliteInstantMs(row?.expires_at);
    return (
      !!row &&
      row.owner_id === state.ownerId &&
      row.metadata === state.metadata &&
      expiresAtMs !== null &&
      expiresAtMs > nowMs &&
      expiresAtMs <= claimExpiryMs
    );
  } catch {
    return false;
  }
}

function assertLeaseHealthy(lease, { inTransaction }) {
  const state = privateLeaseState.get(lease);
  if (
    !state?.ownerId ||
    typeof state.metadata !== "string" ||
    !state.db ||
    !state.leases
  ) {
    return false;
  }
  if (inTransaction) return exactLeaseHealthy(state);
  if (state.db.inTransaction) return false;
  return state.db.transaction(() => exactLeaseHealthy(state)).immediate();
}

function heartbeatPublicationAdmissionLease({
  db,
  leases,
  lease,
  leaseMs = null,
} = {}) {
  const state = privateLeaseState.get(lease);
  if (
    !state?.ownerId ||
    typeof state.metadata !== "string" ||
    state.db !== db ||
    state.leases !== leases ||
    !isRuntimeLeaseRepositoryBoundToDatabase(leases, db)
  ) {
    return false;
  }
  const durationMs = requiredLeaseMs(leaseMs ?? state.leaseMs);
  if (db.inTransaction) return false;
  try {
    const result = db.transaction(() => {
      if (!exactLeaseHealthy(state)) return false;
      const { nowIso, nowMs } = sqliteNow(db);
      const expiresAt = cappedExpiry({
        db,
        authority: state.claimedJobAuthority,
        operation: state.operation,
        nowMs,
        leaseMs: durationMs,
      });
      const changed = db
        .prepare(
          `UPDATE main.runtime_leases
           SET heartbeat_at = ?, expires_at = ?, metadata = ?
           WHERE name = ? AND owner_id = ? AND metadata IS ?
             AND julianday(expires_at) > julianday(?)`,
        )
        .run(
          nowIso,
          expiresAt,
          state.metadata,
          PUBLICATION_ADMISSION_LEASE_NAME,
          state.ownerId,
          state.metadata,
          nowIso,
        ).changes;
      return changed === 1 ? { expiresAt } : false;
    }).immediate();
    if (!result) return false;
    privateLeaseState.set(
      lease,
      Object.freeze({
        ...state,
        expiresAt: result.expiresAt,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function releasePublicationAdmissionLease({ leases, lease } = {}) {
  const state = privateLeaseState.get(lease);
  if (
    !state?.ownerId ||
    typeof state.metadata !== "string" ||
    state.leases !== leases ||
    typeof leases?.releaseExactMetadata !== "function"
  ) {
    return false;
  }
  return leases.releaseExactMetadata({
    name: PUBLICATION_ADMISSION_LEASE_NAME,
    ownerId: state.ownerId,
    expectedMetadata: state.metadata,
  });
}

function blocked(reason, lease = null) {
  return {
    publication_admission_blocked: true,
    status: "held",
    top_reason: reason,
    current_lock_owner_sha256:
      lease?.current_lock_owner_sha256 || null,
    lock_expires_at: lease?.expires_at || null,
    platform_contacted: false,
    external_create_attempted: false,
    platform_mutation_attempted: false,
    operational_publish_authority: false,
    dispatch_authorised: false,
  };
}

async function runWithPublicationAdmissionLease({
  db,
  leases,
  ownerId = defaultPublicationAdmissionOwnerId(),
  operation,
  runtimeAuthority,
  claimedJobAuthority,
  leaseMs = DEFAULT_PUBLICATION_ADMISSION_LEASE_MS,
  heartbeatIntervalMs = Math.floor(leaseMs / 3),
  log = () => {},
  task,
} = {}) {
  if (typeof task !== "function") {
    throw new Error("publication_admission_task_required");
  }
  let lease;
  try {
    lease = acquirePublicationAdmissionLease({
      db,
      leases,
      ownerId,
      operation,
      runtimeAuthority,
      claimedJobAuthority,
      leaseMs,
    });
  } catch (error) {
    log(`[publication-admission] lease unavailable: ${error.message}`);
    return blocked(
      error?.message || "publication_admission_lease_unavailable",
    );
  }
  if (!lease.acquired) {
    return blocked("publication_admission_lease_unavailable", lease);
  }
  let healthy = true;
  const heartbeatNow = () => {
    if (!healthy) return false;
    healthy = heartbeatPublicationAdmissionLease({
      db,
      leases,
      lease,
      leaseMs,
    });
    return healthy;
  };
  const assertHealthy = () => {
    if (!healthy || !lease.assertHealthy()) {
      healthy = false;
      throw new PublicationAdmissionLeaseLostError();
    }
    return true;
  };
  const heartbeat = setInterval(
    heartbeatNow,
    Math.max(1000, Number(heartbeatIntervalMs) || 30_000),
  );
  heartbeat.unref?.();
  try {
    return await task({
      assertHealthy,
      heartbeatNow,
      publicationAdmissionLease: lease,
      lease,
    });
  } catch (error) {
    if (
      error instanceof PublicationAdmissionLeaseLostError ||
      error?.code === "publication_admission_lease_lost"
    ) {
      return blocked("publication_admission_lease_lost", lease);
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    releasePublicationAdmissionLease({ leases, lease });
  }
}

module.exports = {
  DEFAULT_PUBLICATION_ADMISSION_LEASE_MS,
  MAX_PUBLICATION_ADMISSION_LEASE_MS,
  PUBLICATION_ADMISSION_LEASE_NAME,
  PublicationAdmissionLeaseLostError,
  acquirePublicationAdmissionLease,
  defaultPublicationAdmissionOwnerId,
  heartbeatPublicationAdmissionLease,
  releasePublicationAdmissionLease,
  runWithPublicationAdmissionLease,
};
