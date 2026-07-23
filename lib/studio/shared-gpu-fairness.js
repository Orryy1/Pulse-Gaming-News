"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");

const scheduler = require(path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "shared_gpu_scheduler.cjs",
));

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function coordinationEnabled(env = process.env) {
  if (String(env.STUDIO_GPU_SCHEDULER_ENABLED || "").trim() === "0") {
    return false;
  }
  if (
    (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT) &&
    !truthy(env.STUDIO_GPU_SCHEDULER_ENABLED)
  ) {
    return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function schedulerOptions(env = process.env) {
  return {
    schedulerDir: env.STUDIO_GPU_SCHEDULER_DIR || undefined,
  };
}

function inspectPulseGpuAvailability({
  env = process.env,
  pid = process.pid,
  schedulerStatus = scheduler.schedulerStatus,
} = {}) {
  if (!coordinationEnabled(env)) {
    return {
      ok: true,
      status: "disabled",
      owner: null,
    };
  }
  const status = schedulerStatus(schedulerOptions(env));
  const owner = status.owner || null;
  const available =
    !owner ||
    (owner.studio === "pulse-gaming" && Number(owner.pid) === Number(pid));
  return {
    ok: available,
    status: available ? "available" : "reserved",
    owner,
    reason: available
      ? "shared GPU is available to this Pulse Gaming worker"
      : `shared GPU is reserved by ${owner.studio} until ${owner.hard_expires_at}`,
  };
}

async function waitForPulseGpuTurn({
  env = process.env,
  workload = "local-tts",
  requestId = null,
  pid = process.pid,
  pollMs = Number(env.PULSE_SHARED_GPU_POLL_MS || 15_000),
  timeoutMs = Number(env.PULSE_SHARED_GPU_MAX_WAIT_MS || 12 * 60 * 60 * 1000),
  acquireLease = scheduler.acquireLease,
} = {}) {
  if (!coordinationEnabled(env)) {
    return {
      coordinated: false,
      granted: true,
      requestId: null,
      owner: null,
    };
  }
  const stableRequestId =
    requestId ||
    `pulse-gaming-${pid}-${crypto.randomBytes(6).toString("hex")}`;
  const startedAt = Date.now();
  for (;;) {
    const result = acquireLease(
      {
        studio: "pulse-gaming",
        requestId: stableRequestId,
        pid,
        workload,
        sliceMs: Number(env.PULSE_SHARED_GPU_SLICE_MS || 20 * 60 * 1000),
        minHoldMs: Number(
          env.PULSE_SHARED_GPU_MIN_HOLD_MS || 5 * 60 * 1000,
        ),
        maxWaitMs: Number(
          env.PULSE_SHARED_GPU_STARVATION_MS || 75 * 60 * 1000,
        ),
        heartbeatRequired: false,
      },
      schedulerOptions(env),
    );
    if (result.granted) {
      return {
        ...result,
        coordinated: true,
        requestId: stableRequestId,
      };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      scheduler.cancelRequest(
        { requestId: stableRequestId },
        schedulerOptions(env),
      );
      throw new Error(`pulse_shared_gpu_wait_timeout:${workload}`);
    }
    await sleep(Math.max(250, pollMs));
  }
}

function releasePulseGpuTurn(
  turn,
  {
    env = process.env,
    reason = "Pulse Gaming GPU work complete",
    releaseLease = scheduler.releaseLease,
  } = {},
) {
  if (!turn?.coordinated || !turn.requestId) {
    return { released: false, status: "not_coordinated" };
  }
  return releaseLease(
    { requestId: turn.requestId, reason },
    schedulerOptions(env),
  );
}

function stopPulseLocalTtsServer({
  env = process.env,
  execFileSync = childProcess.execFileSync,
} = {}) {
  if (process.platform !== "win32") {
    return { stopped: false, status: "unsupported_platform" };
  }
  const port = Number(env.LOCAL_TTS_PORT || 8765);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid_local_tts_port:${env.LOCAL_TTS_PORT}`);
  }
  const command =
    `Get-NetTCPConnection -LocalPort ${port} -State Listen ` +
    "-ErrorAction SilentlyContinue | " +
    "Select-Object -ExpandProperty OwningProcess -Unique | " +
    "ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }";
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { stdio: "ignore", windowsHide: true },
  );
  return { stopped: true, status: "stop_requested", port };
}

module.exports = {
  coordinationEnabled,
  inspectPulseGpuAvailability,
  releasePulseGpuTurn,
  stopPulseLocalTtsServer,
  waitForPulseGpuTurn,
};
