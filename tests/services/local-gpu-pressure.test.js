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
