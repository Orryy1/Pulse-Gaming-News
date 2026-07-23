"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inspectPulseGpuAvailability,
  releasePulseGpuTurn,
  waitForPulseGpuTurn,
} = require("../../lib/studio/shared-gpu-fairness");

test("Pulse only treats a lease owned by its current worker as available", () => {
  const schedulerStatus = () => ({
    owner: {
      studio: "pulse-gaming",
      pid: 200,
      hard_expires_at: "2026-07-23T12:00:00.000Z",
    },
  });

  const foreign = inspectPulseGpuAvailability({
    env: { STUDIO_GPU_SCHEDULER_ENABLED: "1" },
    pid: 100,
    schedulerStatus,
  });
  const own = inspectPulseGpuAvailability({
    env: { STUDIO_GPU_SCHEDULER_ENABLED: "1" },
    pid: 200,
    schedulerStatus,
  });

  assert.equal(foreign.ok, false);
  assert.equal(foreign.status, "reserved");
  assert.equal(own.ok, true);
  assert.equal(own.status, "available");
});

test("Pulse requests and releases one bounded shared GPU turn", async () => {
  const calls = [];
  const env = {
    STUDIO_GPU_SCHEDULER_ENABLED: "1",
    PULSE_SHARED_GPU_SLICE_MS: "1200000",
    PULSE_SHARED_GPU_MIN_HOLD_MS: "300000",
  };
  const turn = await waitForPulseGpuTurn({
    env,
    pid: 321,
    requestId: "pulse-test-turn",
    workload: "local-tts:test",
    acquireLease: (request) => {
      calls.push({ action: "acquire", request });
      return {
        granted: true,
        status: "granted",
        owner: request,
      };
    },
  });
  const released = releasePulseGpuTurn(turn, {
    env,
    reason: "test complete",
    releaseLease: (request) => {
      calls.push({ action: "release", request });
      return { released: true, status: "released" };
    },
  });

  assert.equal(turn.coordinated, true);
  assert.equal(turn.requestId, "pulse-test-turn");
  assert.equal(calls[0].request.studio, "pulse-gaming");
  assert.equal(calls[0].request.sliceMs, 1200000);
  assert.equal(calls[0].request.minHoldMs, 300000);
  assert.equal(calls[1].request.requestId, "pulse-test-turn");
  assert.equal(released.released, true);
});
