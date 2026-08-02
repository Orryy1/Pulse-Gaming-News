"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const {
  buildPublisherRuntimeGenerationLeaseMetadata,
} = require("../stabilisation/bounded-runtime-db-authority");

const DEFAULT_PUBLISHER_LEASE_MS = 15 * 60 * 1000;
const PUBLISHER_LEASE_NAME = "publisher:global";

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

function acquirePublisherLease({
  leases,
  ownerId = defaultPublisherOwnerId(),
  channelId = "pulse-gaming",
  operation,
  now = new Date(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
  metadata = null,
  runtimeAuthority = null,
  admissionContext = null,
  env = process.env,
} = {}) {
  if (!leases || typeof leases.acquire !== "function") {
    throw new Error("durable_runtime_lease_repository_required");
  }
  const name = leaseName(channelId);
  const boundPublisherLease =
    runtimeAuthority || admissionContext || liveGuardedRuntime(env)
      ? buildPublisherRuntimeGenerationLeaseMetadata({
          runtimeAuthority,
          operation,
          admissionContext,
        })
      : null;
  if (
    boundPublisherLease &&
    Number(boundPublisherLease.process_id) !== process.pid
  ) {
    throw new Error("publisher_runtime_process_identity_mismatch");
  }
  const result = leases.acquire({
    name,
    ownerId,
    now,
    leaseMs,
    metadata: {
      channel_id: channelId,
      ...(metadata || {}),
      operation: String(operation || "publish"),
      process_id: process.pid,
      purpose: "single_flight_platform_dispatch",
      ...(boundPublisherLease || {}),
    },
  });
  return {
    ...result,
    lease_name: name,
    owner_id: result.owner_id || ownerId,
  };
}

function heartbeatPublisherLease({
  leases,
  lease,
  now = new Date(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
} = {}) {
  if (
    !leases ||
    typeof leases.heartbeat !== "function" ||
    !lease?.lease_name ||
    !lease?.owner_id
  ) {
    return false;
  }
  return leases.heartbeat({
    name: lease.lease_name,
    ownerId: lease.owner_id,
    now,
    leaseMs,
  });
}

function releasePublisherLease({ leases, lease } = {}) {
  if (
    !leases ||
    typeof leases.release !== "function" ||
    !lease?.lease_name ||
    !lease?.owner_id
  ) {
    return false;
  }
  return leases.release(lease.lease_name, lease.owner_id);
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
  const externalId = String(error?.externalId || "").trim();
  if (externalId) {
    compensation.externalId = externalId.slice(0, 512);
  }
  return {
    publish_dispatch_blocked: true,
    status: "blocked",
    top_reason: reason,
    current_lock_owner_sha256: lease?.current_owner_id
      ? crypto
          .createHash("sha256")
          .update(String(lease.current_owner_id))
          .digest("hex")
      : null,
    lock_expires_at: lease?.expires_at || null,
    ...compensation,
  };
}

async function runWithPublisherLease({
  leases,
  channelId = "pulse-gaming",
  operation = "publish",
  ownerId = defaultPublisherOwnerId(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
  heartbeatIntervalMs = Math.floor(leaseMs / 3),
  metadata = null,
  runtimeAuthority = null,
  admissionContext = null,
  env = process.env,
  log = () => {},
  task,
} = {}) {
  if (typeof task !== "function") throw new Error("publisher_task_required");
  let lease;
  try {
    lease = acquirePublisherLease({
      leases,
      ownerId,
      channelId,
      operation,
      leaseMs,
      metadata,
      runtimeAuthority,
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
  let heartbeat = null;
  const heartbeatNow = () => {
    if (!healthy) return false;
    try {
      healthy = heartbeatPublisherLease({
        leases,
        lease,
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
      lease,
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
