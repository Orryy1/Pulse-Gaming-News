"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const {
  isRuntimeLeaseRepositoryBoundToDatabase,
} = require("../repositories/runtime_leases");
const {
  assertClaimedJobAuthority,
  buildAdmittedPublicationOperation,
  buildPublisherStartLifecycleBinding,
  buildPublisherRuntimeGenerationLeaseMetadata,
  publisherAdmissionMatches,
  schedulerRuntimeAuthorityMatches,
} = require("../stabilisation/bounded-runtime-db-authority");

const DEFAULT_PUBLISHER_LEASE_MS = 15 * 60 * 1000;
const PUBLISHER_LEASE_NAME = "publisher:global";
const publisherLeasePrivateState = new WeakMap();

class PublisherLeaseLostError extends Error {
  constructor() {
    super("durable_publish_lease_lost");
    this.name = "PublisherLeaseLostError";
    this.code = "durable_publish_lease_lost";
  }
}

function defaultPublisherOwnerId() {
  return `publisher:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
}

function leaseName(channelId) {
  const channel = String(channelId || "").trim();
  if (!channel) throw new Error("publisher_channel_id_required");
  return PUBLISHER_LEASE_NAME;
}

function isPublisherLeaseLostError(error) {
  return (
    error instanceof PublisherLeaseLostError ||
    error?.code === "durable_publish_lease_lost"
  );
}

function liveGuardedRuntime(env = process.env) {
  return (
    String(env.PULSE_OPERATING_MODE || env.OPERATING_MODE || "")
      .trim()
      .toUpperCase() === "LIVE_GUARDED"
  );
}

function canonicalLeaseExpiry(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString() === value ? value : null;
}

function safePlatformObjectId(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

function acquirePublisherLease({
  db = null,
  leases,
  ownerId = defaultPublisherOwnerId(),
  channelId = "pulse-gaming",
  operation,
  now = new Date(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
  metadata = null,
  runtimeAuthority = null,
  claimedJobAuthority = null,
  admissionContext = null,
  env = process.env,
} = {}) {
  if (!leases || typeof leases.acquire !== "function") {
    throw new Error("durable_runtime_lease_repository_required");
  }
  const name = leaseName(channelId);
  const selectedChannelId = String(channelId || "").trim();
  const requiresBoundPublisherLease =
    runtimeAuthority ||
    claimedJobAuthority ||
    admissionContext ||
    liveGuardedRuntime(env);
  if (
    requiresBoundPublisherLease &&
    !isRuntimeLeaseRepositoryBoundToDatabase(leases, db)
  ) {
    throw new Error("publisher_runtime_lease_repository_database_mismatch");
  }
  if (
    requiresBoundPublisherLease &&
    (!runtimeAuthority || !claimedJobAuthority || !admissionContext)
  ) {
    throw new Error("publisher_complete_authority_required");
  }
  const acquire = () => {
    if (requiresBoundPublisherLease) {
      if (!schedulerRuntimeAuthorityMatches(db, runtimeAuthority)) {
        throw new Error("publisher_runtime_generation_authority_invalid");
      }
      const admittedOperation = buildAdmittedPublicationOperation(
        operation,
        admissionContext,
      );
      if (admittedOperation.channel_id !== selectedChannelId) {
        throw new Error("publisher_channel_authority_mismatch");
      }
      assertClaimedJobAuthority({
        db,
        authority: claimedJobAuthority,
        operation,
        admissionContext,
      });
    }
    const startLifecycleBinding = requiresBoundPublisherLease
      ? buildPublisherStartLifecycleBinding({
          db,
          operation,
          admissionContext,
        })
      : null;
    const boundPublisherLease = requiresBoundPublisherLease
      ? buildPublisherRuntimeGenerationLeaseMetadata({
          runtimeAuthority,
          operation,
          admissionContext,
          startLifecycleBinding,
          claimedJobAuthority,
        })
      : null;
    if (
      boundPublisherLease &&
      Number(boundPublisherLease.process_id) !== process.pid
    ) {
      throw new Error("publisher_runtime_process_identity_mismatch");
    }
    if (
      boundPublisherLease &&
      (!Number.isFinite(Number(leaseMs)) ||
        Number(leaseMs) <= 0 ||
        Number(leaseMs) > DEFAULT_PUBLISHER_LEASE_MS)
    ) {
      throw new Error("publisher_lease_duration_invalid");
    }
    return leases.acquire({
      name,
      ownerId,
      now,
      leaseMs,
      metadata: {
        channel_id: channelId,
        operation: String(operation || "publish"),
        process_id: process.pid,
        purpose: "single_flight_platform_dispatch",
        ...(boundPublisherLease || {}),
        lease_instance_sha256: crypto.randomBytes(32).toString("hex"),
      },
      replaceSameOwner: false,
    });
  };
  const result = requiresBoundPublisherLease
    ? (() => {
        if (!db || typeof db.transaction !== "function") {
          throw new Error("publisher_start_lifecycle_authority_invalid");
        }
        return db.transaction(acquire).immediate();
      })()
    : acquire();
  const currentOwnerId = result.current_owner_id || null;
  const handle = Object.freeze({
    acquired: result.acquired === true,
    expires_at: canonicalLeaseExpiry(result.expires_at),
    current_lock_owner_sha256: currentOwnerId
      ? crypto.createHash("sha256").update(String(currentOwnerId)).digest("hex")
      : null,
  });
  publisherLeasePrivateState.set(
    handle,
    Object.freeze({
      leaseName: name,
      ownerId: result.owner_id || ownerId,
      metadata: result.metadata || null,
      channelId: selectedChannelId,
    }),
  );
  return handle;
}

function heartbeatPublisherLease({
  db = null,
  leases,
  lease,
  operation = null,
  runtimeAuthority = null,
  claimedJobAuthority = null,
  admissionContext = null,
  bound = false,
  now = new Date(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
} = {}) {
  const privateState =
    lease && typeof lease === "object"
      ? publisherLeasePrivateState.get(lease)
      : null;
  if (
    !leases ||
    typeof leases.compareAndSwapMetadata !== "function" ||
    !privateState?.leaseName ||
    !privateState?.ownerId ||
    typeof privateState.metadata !== "string"
  ) {
    return false;
  }
  const compareAndSwap = () => {
    if (bound) {
      if (!schedulerRuntimeAuthorityMatches(db, runtimeAuthority)) return false;
      const admittedOperation = buildAdmittedPublicationOperation(
        operation,
        admissionContext,
      );
      if (admittedOperation.channel_id !== privateState.channelId) return false;
      assertClaimedJobAuthority({
        db,
        authority: claimedJobAuthority,
        operation,
        admissionContext,
      });
      const metadata = JSON.parse(privateState.metadata);
      if (!publisherAdmissionMatches(db, metadata)) return false;
    }
    return leases.compareAndSwapMetadata({
      name: privateState.leaseName,
      ownerId: privateState.ownerId,
      expectedMetadata: privateState.metadata,
      metadata: JSON.parse(privateState.metadata),
      now,
      leaseMs,
    });
  };
  if (!bound) return compareAndSwap();
  if (!db || typeof db.transaction !== "function") return false;
  return db.transaction(compareAndSwap).immediate();
}

function releasePublisherLease({ leases, lease } = {}) {
  const privateState =
    lease && typeof lease === "object"
      ? publisherLeasePrivateState.get(lease)
      : null;
  if (
    !leases ||
    typeof leases.releaseExactMetadata !== "function" ||
    !privateState?.leaseName ||
    !privateState?.ownerId ||
    typeof privateState.metadata !== "string"
  ) {
    return false;
  }
  return leases.releaseExactMetadata({
    name: privateState.leaseName,
    ownerId: privateState.ownerId,
    expectedMetadata: privateState.metadata,
  });
}

function blocked(reason, lease = null, error = null) {
  const compensation = {};
  for (const field of [
    "createAttemptStarted",
    "updateAttemptStarted",
    "platformContacted",
    "reconciliationRequired",
    "remoteDisarmRequired",
  ]) {
    if (error?.[field] === true) compensation[field] = true;
  }
  const externalId = safePlatformObjectId(error?.externalId);
  if (externalId) {
    compensation.externalId = externalId;
  }
  return {
    publish_dispatch_blocked: true,
    status: "blocked",
    top_reason: reason,
    current_lock_owner_sha256: lease?.current_lock_owner_sha256 || null,
    lock_expires_at: lease?.expires_at || null,
    ...compensation,
  };
}

async function runWithPublisherLease({
  db = null,
  leases,
  channelId = "pulse-gaming",
  operation = "publish",
  ownerId = defaultPublisherOwnerId(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
  heartbeatIntervalMs = Math.floor(leaseMs / 3),
  metadata = null,
  runtimeAuthority = null,
  claimedJobAuthority = null,
  admissionContext = null,
  env = process.env,
  log = () => {},
  task,
} = {}) {
  if (typeof task !== "function") throw new Error("publisher_task_required");
  let lease;
  try {
    lease = acquirePublisherLease({
      db,
      leases,
      ownerId,
      channelId,
      operation,
      leaseMs,
      metadata,
      runtimeAuthority,
      claimedJobAuthority,
      admissionContext,
      env,
    });
  } catch (error) {
    log(`[publisher] durable publish lock unavailable: ${error.message}`);
    return blocked("durable_publish_lock_unavailable");
  }
  if (!lease.acquired) {
    return blocked("durable_publish_lock_unavailable", lease);
  }

  let healthy = true;
  const bound = Boolean(
    runtimeAuthority ||
      claimedJobAuthority ||
      admissionContext ||
      liveGuardedRuntime(env),
  );
  let heartbeat = null;
  const heartbeatNow = () => {
    if (!healthy) return false;
    try {
      healthy = heartbeatPublisherLease({
        db,
        leases,
        lease,
        operation,
        runtimeAuthority,
        claimedJobAuthority,
        admissionContext,
        bound,
        leaseMs,
      });
    } catch (error) {
      healthy = false;
      log(`[publisher] durable publish heartbeat failed: ${error.message}`);
    }
    return healthy;
  };
  const assertHealthy = () => {
    if (!heartbeatNow()) throw new PublisherLeaseLostError();
    return true;
  };
  heartbeat = setInterval(
    heartbeatNow,
    Math.max(1000, Number(heartbeatIntervalMs) || 60_000),
  );
  heartbeat.unref?.();

  try {
    return await task({
      assertHealthy,
      heartbeatNow,
    });
  } catch (error) {
    if (isPublisherLeaseLostError(error)) {
      return blocked(
        "durable_publish_lease_lost",
        lease,
        error,
      );
    }
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    releasePublisherLease({ leases, lease });
  }
}

module.exports = {
  DEFAULT_PUBLISHER_LEASE_MS,
  PUBLISHER_LEASE_NAME,
  PublisherLeaseLostError,
  acquirePublisherLease,
  defaultPublisherOwnerId,
  heartbeatPublisherLease,
  isPublisherLeaseLostError,
  releasePublisherLease,
  runWithPublisherLease,
};
