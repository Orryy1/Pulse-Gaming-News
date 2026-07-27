"use strict";

const os = require("node:os");

const SCHEDULER_LEASE_NAME = "scheduler:primary";
const DEFAULT_SCHEDULER_LEASE_MS = 90 * 1000;

function defaultSchedulerOwnerId() {
  return `scheduler:${os.hostname()}:${process.pid}`;
}

function acquireSchedulerLease({
  leases,
  ownerId = defaultSchedulerOwnerId(),
  now = new Date(),
  leaseMs = DEFAULT_SCHEDULER_LEASE_MS,
  metadata = null,
} = {}) {
  if (!leases || typeof leases.acquire !== "function") {
    throw new Error("durable_runtime_lease_repository_required");
  }
  const result = leases.acquire({
    name: SCHEDULER_LEASE_NAME,
    ownerId,
    now,
    leaseMs,
    metadata: {
      purpose: "single_owner_scheduler_dispatch",
      profile: "stabilisation_30d",
      ...(metadata || {}),
    },
  });
  return {
    ...result,
    lease_name: SCHEDULER_LEASE_NAME,
    owner_id: result.owner_id || ownerId,
  };
}

function heartbeatSchedulerLease({
  leases,
  ownerId,
  now = new Date(),
  leaseMs = DEFAULT_SCHEDULER_LEASE_MS,
} = {}) {
  if (!leases || typeof leases.heartbeat !== "function") return false;
  if (!ownerId) return false;
  return leases.heartbeat({
    name: SCHEDULER_LEASE_NAME,
    ownerId,
    now,
    leaseMs,
  });
}

function releaseSchedulerLease({ leases, ownerId } = {}) {
  if (!leases || typeof leases.release !== "function") return false;
  if (!ownerId) return false;
  return leases.release(SCHEDULER_LEASE_NAME, ownerId);
}

module.exports = {
  DEFAULT_SCHEDULER_LEASE_MS,
  SCHEDULER_LEASE_NAME,
  acquireSchedulerLease,
  defaultSchedulerOwnerId,
  heartbeatSchedulerLease,
  releaseSchedulerLease,
};
