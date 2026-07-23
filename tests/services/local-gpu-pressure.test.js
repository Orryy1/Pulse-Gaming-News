"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertLocalTtsGpuReady,
  formatLocalGpuPressure,
  inspectLocalGpuPressure,
  parseNvidiaSmiCsv,
} = require("../../lib/studio/local-gpu-pressure");

function mockExecFile({ stdout = "", err = null } = {}) {
  return (_file, _args, _options, callback) => {
    callback(err, stdout, "");
  };
}

test("parseNvidiaSmiCsv reads memory and utilisation rows", () => {
  const rows = parseNvidiaSmiCsv("23519, 24564, 100\n1000, 24564, 15\n");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].memoryUsedMb, 23519);
  assert.equal(rows[0].memoryTotalMb, 24564);
  assert.equal(rows[0].memoryFreeMb, 1045);
  assert.equal(rows[0].utilizationGpuPercent, 100);
});

test("inspectLocalGpuPressure blocks saturated local GPU", async () => {
  const report = await inspectLocalGpuPressure({
    env: {
      LOCAL_TTS_MIN_GPU_FREE_MB: "3072",
      LOCAL_TTS_MAX_GPU_UTIL_PERCENT: "95",
    },
    execFileImpl: mockExecFile({ stdout: "23519, 24564, 100\n" }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "busy");
  assert.equal(report.failure_code, "gpu_saturated");
  assert.match(report.reason, /free memory/);
  assert.match(report.reason, /utilisation/);
  assert.match(formatLocalGpuPressure(report), /failure=gpu_saturated/);
});

test("inspectLocalGpuPressure blocks Pulse while another studio owns the shared GPU", async () => {
  const report = await inspectLocalGpuPressure({
    env: {},
    coordinateSharedGpu: true,
    inspectSharedGpu: async () => ({
      ok: false,
      status: "reserved",
      owner: { studio: "sleepy-stories", pid: 1234 },
      reason: "shared GPU is reserved by sleepy-stories",
    }),
    execFileImpl: mockExecFile({ stdout: "9000, 24564, 21\n" }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "busy");
  assert.equal(report.failure_code, "shared_gpu_reserved");
  assert.equal(report.shared_gpu.owner.studio, "sleepy-stories");
  assert.match(formatLocalGpuPressure(report), /shared_owner=sleepy-stories/);
});

test("inspectLocalGpuPressure uses a resident-server threshold when local TTS is already loaded", async () => {
  const report = await inspectLocalGpuPressure({
    env: {
      LOCAL_TTS_MIN_GPU_FREE_MB: "3072",
      LOCAL_TTS_RESIDENT_MIN_GPU_FREE_MB: "2048",
      LOCAL_TTS_MAX_GPU_UTIL_PERCENT: "95",
    },
    localTtsResidentReady: true,
    execFileImpl: mockExecFile({ stdout: "21914, 24564, 6\n" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ok");
  assert.equal(report.thresholds.minFreeMb, 2048);
  assert.equal(report.thresholds.coldMinFreeMb, 3072);
  assert.equal(report.thresholds.localTtsResidentReady, true);
});

test("inspectLocalGpuPressure defaults preserve model-load and resident inference headroom", async () => {
  const report = await inspectLocalGpuPressure({
    env: {},
    localTtsResidentReady: true,
    execFileImpl: mockExecFile({ stdout: "19564, 24564, 10\n" }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "busy");
  assert.equal(report.thresholds.coldMinFreeMb, 12288);
  assert.equal(report.thresholds.residentMinFreeMb, 6144);
  assert.equal(report.thresholds.minFreeMb, 6144);
  assert.match(report.reason, /below 6144MB/);
});

test("inspectLocalGpuPressure still blocks resident local TTS when free memory drops below the resident floor", async () => {
  const report = await inspectLocalGpuPressure({
    env: {
      LOCAL_TTS_MIN_GPU_FREE_MB: "3072",
      LOCAL_TTS_RESIDENT_MIN_GPU_FREE_MB: "2048",
      LOCAL_TTS_MAX_GPU_UTIL_PERCENT: "95",
    },
    localTtsResidentReady: true,
    execFileImpl: mockExecFile({ stdout: "23000, 24564, 7\n" }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "busy");
  assert.equal(report.failure_code, "gpu_saturated");
  assert.match(report.reason, /below 2048MB/);
});

test("inspectLocalGpuPressure allows a GPU with enough headroom", async () => {
  const report = await inspectLocalGpuPressure({
    env: {
      LOCAL_TTS_MIN_GPU_FREE_MB: "3072",
      LOCAL_TTS_MAX_GPU_UTIL_PERCENT: "95",
    },
    execFileImpl: mockExecFile({ stdout: "9000, 24564, 21\n" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ok");
  assert.equal(report.failure_code, null);
});

test("inspectLocalGpuPressure does not block when nvidia-smi is unavailable", async () => {
  const report = await inspectLocalGpuPressure({
    execFileImpl: mockExecFile({ err: new Error("spawn nvidia-smi ENOENT") }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "unavailable");
});

test("assertLocalTtsGpuReady throws a classifiable GPU busy error", async () => {
  await assert.rejects(
    assertLocalTtsGpuReady({
      env: {
        LOCAL_TTS_MIN_GPU_FREE_MB: "3072",
        LOCAL_TTS_MAX_GPU_UTIL_PERCENT: "95",
      },
      execFileImpl: mockExecFile({ stdout: "23519, 24564, 100\n" }),
    }),
    /local_tts_gpu_busy/,
  );
});

test("inspectLocalGpuPressure can be disabled for controlled diagnostics", async () => {
  const report = await inspectLocalGpuPressure({
    env: { LOCAL_TTS_GPU_PRESSURE_CHECK: "false" },
    execFileImpl: mockExecFile({ stdout: "23519, 24564, 100\n" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "skipped");
});
