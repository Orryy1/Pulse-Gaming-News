"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const VOXCPM_WINDOWS_CRASH_ISSUE =
  "https://github.com/OpenBMB/VoxCPM/issues/300";

async function readJsonIfPresent(filePath) {
  try {
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function inspectLocalTtsNativeCrash(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const serverDir = path.resolve(options.serverDir || path.join(cwd, "tts_server"));
  const bootStatePath = path.join(serverDir, "diag", "boot_state.json");
  const bootState = await readJsonIfPresent(bootStatePath);
  const evidencePath = String(bootState?.faulthandler_log || "").trim();
  if (!evidencePath || !(await fs.pathExists(evidencePath))) {
    return { detected: false };
  }

  const stat = await fs.stat(evidencePath);
  const startedAt = Number(options.startedAtMs || 0);
  if (startedAt > 0 && stat.mtimeMs + 1000 < startedAt) {
    return { detected: false };
  }

  const text = await fs.readFile(evidencePath, "utf8");
  const accessViolation = /Windows fatal exception:\s*access violation/i.test(text);
  const inferenceStack =
    /voxcpm[\\/](?:model|modules)|voxcpm_engine\.py|unified_cfm\.py|solve_euler/i.test(
      text,
    );
  if (!accessViolation || !inferenceStack) {
    return { detected: false };
  }

  return {
    detected: true,
    failure_code: "native_inference_access_violation",
    signature: "Windows fatal exception: access violation",
    stage: "voxcpm_cuda_inference",
    evidence_path: evidencePath,
    boot_state_path: bootStatePath,
    upstream_issue_url: VOXCPM_WINDOWS_CRASH_ISSUE,
  };
}

module.exports = {
  VOXCPM_WINDOWS_CRASH_ISSUE,
  inspectLocalTtsNativeCrash,
};
