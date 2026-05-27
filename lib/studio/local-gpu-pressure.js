"use strict";

const childProcess = require("node:child_process");

function isExplicitlyFalse(value) {
  return /^(false|0|no|off)$/i.test(String(value || ""));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integerNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseNvidiaSmiCsv(stdout = "") {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [usedMb, totalMb, utilPercent] = line
        .split(",")
        .map((part) => Number(String(part).trim()));
      const freeMb = totalMb - usedMb;
      return {
        index,
        memoryUsedMb: Number.isFinite(usedMb) ? usedMb : null,
        memoryTotalMb: Number.isFinite(totalMb) ? totalMb : null,
        memoryFreeMb: Number.isFinite(freeMb) ? freeMb : null,
        utilizationGpuPercent: Number.isFinite(utilPercent) ? utilPercent : null,
      };
    });
}

function classifyGpuPressure(gpu, { minFreeMb, maxUtilPercent } = {}) {
  const reasons = [];
  if (
    Number.isFinite(gpu?.memoryFreeMb) &&
    Number.isFinite(minFreeMb) &&
    gpu.memoryFreeMb < minFreeMb
  ) {
    reasons.push(
      `GPU free memory ${Math.round(gpu.memoryFreeMb)}MB is below ${Math.round(minFreeMb)}MB`,
    );
  }
  if (
    Number.isFinite(gpu?.utilizationGpuPercent) &&
    Number.isFinite(maxUtilPercent) &&
    gpu.utilizationGpuPercent > maxUtilPercent
  ) {
    reasons.push(
      `GPU utilisation ${Math.round(gpu.utilizationGpuPercent)}% is above ${Math.round(maxUtilPercent)}%`,
    );
  }
  return reasons;
}

async function inspectLocalGpuPressure({
  env = process.env,
  execFileImpl = childProcess.execFile,
} = {}) {
  if (isExplicitlyFalse(env.LOCAL_TTS_GPU_PRESSURE_CHECK)) {
    return {
      ok: true,
      status: "skipped",
      failure_code: null,
      reason: "LOCAL_TTS_GPU_PRESSURE_CHECK disabled",
      selected: null,
      gpus: [],
      thresholds: {},
    };
  }

  const minFreeMb = positiveNumber(
    env.LOCAL_TTS_MIN_GPU_FREE_MB || env.STUDIO_V2_LOCAL_TTS_MIN_GPU_FREE_MB,
    3072,
  );
  const maxUtilPercent = positiveNumber(
    env.LOCAL_TTS_MAX_GPU_UTIL_PERCENT ||
      env.STUDIO_V2_LOCAL_TTS_MAX_GPU_UTIL_PERCENT,
    95,
  );
  const gpuIndex = integerNumber(env.LOCAL_TTS_GPU_INDEX, 0);

  const thresholds = {
    minFreeMb,
    maxUtilPercent,
    gpuIndex,
  };

  return new Promise((resolve) => {
    execFileImpl(
      "nvidia-smi",
      [
        "--query-gpu=memory.used,memory.total,utilization.gpu",
        "--format=csv,noheader,nounits",
      ],
      { timeout: positiveNumber(env.LOCAL_TTS_GPU_CHECK_TIMEOUT_MS, 5000) },
      (err, stdout) => {
        if (err) {
          resolve({
            ok: true,
            status: "unavailable",
            failure_code: null,
            reason: `GPU pressure unavailable: ${err.message || err}`,
            selected: null,
            gpus: [],
            thresholds,
          });
          return;
        }

        const gpus = parseNvidiaSmiCsv(stdout);
        const selected = gpus[gpuIndex] || gpus[0] || null;
        if (!selected) {
          resolve({
            ok: true,
            status: "unavailable",
            failure_code: null,
            reason: "GPU pressure unavailable: no GPU rows returned",
            selected: null,
            gpus,
            thresholds,
          });
          return;
        }

        const reasons = classifyGpuPressure(selected, thresholds);
        resolve({
          ok: reasons.length === 0,
          status: reasons.length === 0 ? "ok" : "busy",
          failure_code: reasons.length === 0 ? null : "gpu_saturated",
          reason: reasons.length === 0 ? "GPU has enough headroom for local TTS" : reasons.join("; "),
          selected,
          gpus,
          thresholds,
        });
      },
    );
  });
}

async function assertLocalTtsGpuReady(options = {}) {
  const report = await inspectLocalGpuPressure(options);
  if (report.ok !== true) {
    const err = new Error(`local_tts_gpu_busy:${report.reason}`);
    err.code = "LOCAL_TTS_GPU_BUSY";
    err.gpuPressure = report;
    throw err;
  }
  return report;
}

function formatLocalGpuPressure(report = {}) {
  const selected = report.selected || {};
  const parts = [`status=${report.status || "unknown"}`];
  if (selected.memoryUsedMb !== null && selected.memoryUsedMb !== undefined) {
    parts.push(`used=${Math.round(selected.memoryUsedMb)}MB`);
  }
  if (selected.memoryTotalMb !== null && selected.memoryTotalMb !== undefined) {
    parts.push(`total=${Math.round(selected.memoryTotalMb)}MB`);
  }
  if (selected.memoryFreeMb !== null && selected.memoryFreeMb !== undefined) {
    parts.push(`free=${Math.round(selected.memoryFreeMb)}MB`);
  }
  if (
    selected.utilizationGpuPercent !== null &&
    selected.utilizationGpuPercent !== undefined
  ) {
    parts.push(`util=${Math.round(selected.utilizationGpuPercent)}%`);
  }
  if (report.failure_code) parts.push(`failure=${report.failure_code}`);
  return parts.join(" ");
}

module.exports = {
  assertLocalTtsGpuReady,
  classifyGpuPressure,
  formatLocalGpuPressure,
  inspectLocalGpuPressure,
  parseNvidiaSmiCsv,
};
