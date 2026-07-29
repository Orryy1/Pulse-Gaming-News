"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveMultiLaneRuntimeControl,
  inspectSchedulerOwner,
} = require("../../lib/services/multi-lane-runtime-control");

const NOW = "2026-07-28T12:00:00.000Z";

function baseEnv(overrides = {}) {
  return {
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    PULSE_MULTI_LANE_WORKERS: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
    ...overrides,
  };
}

test("scheduler ownership is healthy only for a fresh durable lease", () => {
  const healthy = inspectSchedulerOwner({
    runtimeLeases: {
      get(name) {
        assert.equal(name, "scheduler:primary");
        return {
          name,
          owner_id: "scheduler-production-1",
          heartbeat_at: "2026-07-28T11:59:30.000Z",
          expires_at: "2026-07-28T12:01:00.000Z",
        };
      },
    },
    now: NOW,
  });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.blocker, null);

  const expired = inspectSchedulerOwner({
    runtimeLeases: {
      get() {
        return {
          owner_id: "scheduler-old",
          expires_at: "2026-07-28T11:59:59.999Z",
        };
      },
    },
    now: NOW,
  });
  assert.equal(expired.healthy, false);
  assert.equal(expired.blocker, "scheduler_owner_lease_expired");
});

test("missing durable lease cannot be reported as a healthy scheduler owner", () => {
  for (const runtimeLeases of [
    null,
    {},
    { get: () => null },
    { get: () => ({ owner_id: "", expires_at: "2026-07-28T12:10:00.000Z" }) },
  ]) {
    const result = inspectSchedulerOwner({ runtimeLeases, now: NOW });
    assert.equal(result.healthy, false);
    assert.ok(result.blocker);
  }
});

test("multi-lane production truth is derived from the active profile and worker controls", () => {
  const result = deriveMultiLaneRuntimeControl({
    payload: { live_publish_enabled: true },
    repos: {
      runtimeLeases: {
        get: () => ({
          owner_id: "scheduler-production-1",
          heartbeat_at: "2026-07-28T11:59:30.000Z",
          expires_at: "2026-07-28T12:01:00.000Z",
        }),
      },
    },
    env: baseEnv(),
    now: NOW,
    operatingContract: {
      valid: true,
      live_mutation_allowed: false,
    },
  });

  assert.equal(result.scheduler_owner_healthy, true);
  assert.equal(result.autonomous_production_enabled, true);
  assert.equal(result.live_publish_enabled, false);
  assert.equal(result.evidence.scheduler_profile, "governed_multi_lane");
  assert.equal(result.evidence.scheduler_lease.owner_id, "scheduler-production-1");
});

test("stabilisation profile, disabled workers or observation-only instances hold production", () => {
  for (const env of [
    baseEnv({ PULSE_SCHEDULER_PROFILE: "stabilisation_30d" }),
    baseEnv({ PULSE_MULTI_LANE_WORKERS: "false" }),
    baseEnv({ PULSE_PRIMARY_INSTANCE: "false" }),
  ]) {
    const result = deriveMultiLaneRuntimeControl({
      repos: {
        runtimeLeases: {
          get: () => ({
            owner_id: "scheduler-production-1",
            expires_at: "2026-07-28T12:01:00.000Z",
          }),
        },
      },
      env,
      now: NOW,
      operatingContract: {
        valid: true,
        live_mutation_allowed: false,
      },
    });
    assert.equal(result.autonomous_production_enabled, false);
  }
});

test("caller supplied runtime_control cannot invent lease or worker health", () => {
  const result = deriveMultiLaneRuntimeControl({
    payload: {
      runtime_control: {
        scheduler_owner_healthy: true,
        autonomous_production_enabled: true,
        live_publish_enabled: true,
      },
      live_publish_enabled: true,
    },
    repos: { runtimeLeases: { get: () => null } },
    env: baseEnv({ PULSE_MULTI_LANE_WORKERS: "false" }),
    now: NOW,
    operatingContract: {
      valid: true,
      live_mutation_allowed: true,
    },
  });

  assert.equal(result.scheduler_owner_healthy, false);
  assert.equal(result.autonomous_production_enabled, false);
  assert.equal(result.live_publish_enabled, false);
  assert.equal(result.evidence.untrusted_runtime_control_ignored, true);
});
