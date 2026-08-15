"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const { startLeaseHeartbeat } = require("./lease-heartbeat");

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

function controlBlockReason(error) {
  const code = String(error?.code || error?.message || "").trim();
  if (["kill_switch_engaged", "kill_switch_version_changed"].includes(code)) {
    return code;
  }
  if (code === "durable_circuit_open") return code;
  return null;
}

function acquirePublisherLease({
  leases,
  ownerId = defaultPublisherOwnerId(),
  channelId = "pulse-gaming",
  operation,
  now = new Date(),
  leaseMs = DEFAULT_PUBLISHER_LEASE_MS,
  metadata = null,
} = {}) {
  if (!leases || typeof leases.acquire !== "function") {
    throw new Error("durable_runtime_lease_repository_required");
  }
  const name = leaseName(channelId);
  const result = leases.acquire({
    name,
    ownerId,
    now,
    leaseMs,
    metadata: {
      channel_id: channelId,
      operation: String(operation || "publish"),
      process_id: process.pid,
      purpose: "single_flight_platform_dispatch",
      ...(metadata || {}),
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
    !lease?.owner_id ||
    !lease?.fencing_token
  ) {
    return false;
  }
  return leases.heartbeat({
    name: lease.lease_name,
    ownerId: lease.owner_id,
    fencingToken: lease.fencing_token,
    now,
    leaseMs,
  });
}

function releasePublisherLease({ leases, lease } = {}) {
  if (
    !leases ||
    typeof leases.release !== "function" ||
    !lease?.lease_name ||
    !lease?.owner_id ||
    !lease?.fencing_token
  ) {
    return false;
  }
  return leases.release(
    lease.lease_name,
    lease.owner_id,
    lease.fencing_token,
  );
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
    current_lock_owner: lease?.current_owner_id || null,
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
  killSwitch = null,
  expectedKillSwitchVersion = null,
  circuitBreaker = null,
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
    });
  } catch (error) {
    log(`[publisher] durable publish lock unavailable: ${error.message}`);
    return blocked("durable_publish_lock_unavailable");
  }
  if (!lease.acquired) {
    return blocked("durable_publish_lock_unavailable", lease);
  }

  let killSwitchVersion = expectedKillSwitchVersion;
  let circuitAttempt = null;
  try {
    if (killSwitch) {
      if (typeof killSwitch.assertExternalMutationAllowed !== "function") {
        throw new Error("durable_kill_switch_service_invalid");
      }
      const current = killSwitch.assertExternalMutationAllowed({
        expectedVersion: killSwitchVersion,
      });
      if (killSwitchVersion === null) killSwitchVersion = current.version;
    }
    if (circuitBreaker) {
      if (
        typeof circuitBreaker.beforeAttempt !== "function"
        || typeof circuitBreaker.recordFailure !== "function"
        || typeof circuitBreaker.recordSuccess !== "function"
      ) {
        throw new Error("durable_circuit_breaker_invalid");
      }
      circuitAttempt = circuitBreaker.beforeAttempt();
    }
  } catch (error) {
    releasePublisherLease({ leases, lease });
    const reason = controlBlockReason(error);
    if (reason) return blocked(reason, lease, error);
    throw error;
  }

  const abortController = new AbortController();
  const abortForLeaseLoss = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new PublisherLeaseLostError());
    }
  };
  const heartbeatHandle = startLeaseHeartbeat({
    heartbeat: () => heartbeatPublisherLease({
      leases,
      lease,
      leaseMs,
    }),
    intervalMs: Math.max(1000, Number(heartbeatIntervalMs) || 60_000),
    onLost: () => {
      abortForLeaseLoss();
      log("[publisher] durable publish lease lost");
    },
    log: {
      error(message) {
        log(message);
      },
    },
  });
  const heartbeatNow = () => {
    const result = heartbeatHandle.heartbeatNow();
    if (result && typeof result.then === "function") {
      log("[publisher] asynchronous mutation-boundary heartbeat is unsupported");
      abortForLeaseLoss();
      heartbeatHandle.stop();
      return false;
    }
    return result;
  };
  const assertHealthy = () => {
    if (
      abortController.signal.aborted ||
      !heartbeatHandle.active ||
      !heartbeatNow()
    ) {
      abortForLeaseLoss();
      throw new PublisherLeaseLostError();
    }
    if (killSwitch) {
      killSwitch.assertExternalMutationAllowed({
        expectedVersion: killSwitchVersion,
      });
    }
    return true;
  };

  try {
    const result = await task({
      assertHealthy,
      heartbeatNow,
      lease,
      signal: abortController.signal,
      killSwitchVersion,
      circuitAttempt,
    });
    assertHealthy();
    if (circuitBreaker) circuitBreaker.recordSuccess(circuitAttempt);
    return result;
  } catch (error) {
    if (
      abortController.signal.aborted ||
      isPublisherLeaseLostError(error)
    ) {
      return blocked(
        "durable_publish_lease_lost",
        lease,
        error,
      );
    }
    const reason = controlBlockReason(error);
    if (reason) return blocked(reason, lease, error);
    if (circuitBreaker) {
      circuitBreaker.recordFailure(error, circuitAttempt);
    }
    throw error;
  } finally {
    heartbeatHandle.stop();
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
