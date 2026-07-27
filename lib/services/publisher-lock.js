"use strict";

const os = require("node:os");

function defaultOwnerId() {
  return `publisher:${os.hostname()}:${process.pid}`;
}

function acquirePublisherLease({
  leases,
  ownerId = defaultOwnerId(),
  channelId = "pulse-gaming",
  now = new Date(),
  leaseMs = 15 * 60 * 1000,
  metadata = null,
} = {}) {
  if (!leases || typeof leases.acquire !== "function") {
    throw new Error("durable_runtime_lease_repository_required");
  }
  const leaseName = `publisher:${String(channelId || "pulse-gaming")}`;
  const result = leases.acquire({
    name: leaseName,
    ownerId,
    now,
    leaseMs,
    metadata: {
      channel_id: channelId,
      purpose: "single_flight_platform_dispatch",
      ...(metadata || {}),
    },
  });
  return {
    ...result,
    lease_name: leaseName,
    owner_id: result.owner_id || ownerId,
  };
}

function releasePublisherLease({ leases, leaseName, ownerId } = {}) {
  if (!leases || typeof leases.release !== "function") return false;
  if (!leaseName || !ownerId) return false;
  return leases.release(leaseName, ownerId);
}

module.exports = {
  acquirePublisherLease,
  defaultOwnerId,
  releasePublisherLease,
};
