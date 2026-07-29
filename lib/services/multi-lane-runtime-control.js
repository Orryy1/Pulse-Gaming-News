"use strict";

const {
  SCHEDULER_LEASE_NAME,
} = require("./scheduler-lock");

const MULTI_LANE_PROFILE = "governed_multi_lane";

function text(value) {
  return String(value ?? "").trim();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function explicitlyFalse(value) {
  return ["0", "false", "no", "off"].includes(
    text(value).toLowerCase(),
  );
}

function iso(value) {
  const parsed = Date.parse(value instanceof Date ? value.toISOString() : text(value));
  if (!Number.isFinite(parsed)) {
    throw new Error("multi_lane_runtime_control_now_invalid");
  }
  return new Date(parsed).toISOString();
}

function inspectSchedulerOwner({
  runtimeLeases,
  now = new Date(),
} = {}) {
  const observedAt = iso(now);
  if (!runtimeLeases || typeof runtimeLeases.get !== "function") {
    return {
      healthy: false,
      blocker: "durable_scheduler_lease_repository_required",
      observed_at: observedAt,
      lease_name: SCHEDULER_LEASE_NAME,
      owner_id: null,
      heartbeat_at: null,
      expires_at: null,
    };
  }

  let lease;
  try {
    lease = runtimeLeases.get(SCHEDULER_LEASE_NAME);
  } catch {
    return {
      healthy: false,
      blocker: "scheduler_owner_lease_read_failed",
      observed_at: observedAt,
      lease_name: SCHEDULER_LEASE_NAME,
      owner_id: null,
      heartbeat_at: null,
      expires_at: null,
    };
  }
  if (!lease) {
    return {
      healthy: false,
      blocker: "scheduler_owner_lease_missing",
      observed_at: observedAt,
      lease_name: SCHEDULER_LEASE_NAME,
      owner_id: null,
      heartbeat_at: null,
      expires_at: null,
    };
  }

  const ownerId = text(lease.owner_id);
  const expiresAt = text(lease.expires_at);
  const expiryMs = Date.parse(expiresAt);
  let blocker = null;
  if (!ownerId) blocker = "scheduler_owner_id_missing";
  else if (!Number.isFinite(expiryMs)) {
    blocker = "scheduler_owner_lease_expiry_invalid";
  } else if (expiryMs <= Date.parse(observedAt)) {
    blocker = "scheduler_owner_lease_expired";
  }

  return {
    healthy: blocker === null,
    blocker,
    observed_at: observedAt,
    lease_name: SCHEDULER_LEASE_NAME,
    owner_id: ownerId || null,
    heartbeat_at: text(lease.heartbeat_at) || null,
    expires_at: expiresAt || null,
  };
}

function governedLivePublishRequested({
  env = process.env,
  schedulerProfile =
    env.PULSE_SCHEDULER_PROFILE || "",
} = {}) {
  if (text(schedulerProfile) !== MULTI_LANE_PROFILE) {
    return false;
  }
  const {
    resolveOperatingContract,
  } = require("../stabilisation/operating-contract");
  const contract = resolveOperatingContract({ env });
  return (
    contract.mode === "LIVE_GUARDED" &&
    contract.valid === true &&
    contract.live_mutation_allowed === true
  );
}

function deriveMultiLaneRuntimeControl({
  payload = {},
  repos = {},
  env = process.env,
  now = new Date(),
  operatingContract = {},
} = {}) {
  const schedulerLease = inspectSchedulerOwner({
    runtimeLeases: repos?.runtimeLeases,
    now,
  });
  const schedulerProfile = text(
    payload.scheduler_profile ||
      env.PULSE_SCHEDULER_PROFILE ||
      "stabilisation_30d",
  );
  const primaryInstance = !explicitlyFalse(env.PULSE_PRIMARY_INSTANCE);
  const multiLaneWorkersEnabled =
    !explicitlyFalse(env.PULSE_MULTI_LANE_WORKERS);
  const killSwitchHealthy =
    !truthy(env.PULSE_EMERGENCY_KILL_SWITCH) &&
    !truthy(env.PULSE_KILL_SWITCH);
  const operatingContractValid = operatingContract.valid === true;
  const autonomousProductionEnabled =
    schedulerProfile === MULTI_LANE_PROFILE &&
    primaryInstance &&
    multiLaneWorkersEnabled &&
    schedulerLease.healthy;
  const livePublishEnabled =
    autonomousProductionEnabled &&
    killSwitchHealthy &&
    operatingContractValid &&
    operatingContract.live_mutation_allowed === true &&
    payload.live_publish_enabled === true;

  return {
    kill_switch_healthy: killSwitchHealthy,
    operating_contract_valid: operatingContractValid,
    scheduler_owner_healthy: schedulerLease.healthy,
    autonomous_production_enabled: autonomousProductionEnabled,
    live_publish_enabled: livePublishEnabled,
    evidence: {
      schema_version: "pulse-multi-lane-runtime-control-evidence-v1",
      observed_at: schedulerLease.observed_at,
      scheduler_profile: schedulerProfile,
      multi_lane_profile_active:
        schedulerProfile === MULTI_LANE_PROFILE,
      primary_instance: primaryInstance,
      multi_lane_workers_enabled: multiLaneWorkersEnabled,
      scheduler_lease: schedulerLease,
      untrusted_runtime_control_ignored:
        Boolean(payload.runtime_control) &&
        typeof payload.runtime_control === "object",
    },
  };
}

module.exports = {
  MULTI_LANE_PROFILE,
  deriveMultiLaneRuntimeControl,
  governedLivePublishRequested,
  inspectSchedulerOwner,
};
