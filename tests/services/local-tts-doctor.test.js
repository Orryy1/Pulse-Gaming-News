"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  parseArgs,
  resolveLocalTtsSmokeTimeoutMs,
  runDoctor,
  writeReport,
} = require("../../tools/local-tts-doctor");

test("local TTS doctor parses generation smoke checks", () => {
  assert.equal(parseArgs(["--restart", "--prewarm", "--smoke"]).smoke, true);
  assert.equal(parseArgs(["--restart", "--prewarm"]).smoke, false);
  assert.equal(
    parseArgs(["--force-native-crash-retry"]).forceNativeCrashRetry,
    true,
  );
});

test("local TTS doctor gives resident local generation the ten minute proof budget", () => {
  assert.equal(resolveLocalTtsSmokeTimeoutMs({}), 600000);
  assert.equal(
    resolveLocalTtsSmokeTimeoutMs({ LOCAL_TTS_DOCTOR_SMOKE_TIMEOUT_MS: "720000" }),
    720000,
  );
});

test("local TTS doctor downgrades green health when generation smoke fails", async () => {
  const report = await runDoctor({
    restart: false,
    prewarm: false,
    smoke: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return {
          ok: true,
          status: "ok",
          phase: "ready",
          ready: true,
          engineCount: 1,
          voice: {
            alias: "Sleepy Liam",
            loaded: true,
            refResolved: true,
            reference: { id: "accepted", referenceHash: "hash" },
          },
          reasons: [],
        };
      },
      classifyLocalTtsDoctorAction(summary) {
        return summary.ok
          ? {
              action: "none",
              verdict: "green",
              reason: "local TTS is ready with the accepted voice loaded",
            }
          : {
              action: "manual_restart_required",
              verdict: "red",
              reason: "not ready",
            };
      },
      classifyLocalTtsHealthFailure() {
        return { code: null };
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
      async runGenerationSmoke() {
        throw new Error("local_tts_generation_failed:server_error");
      },
    },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.action, "manual_restart_required");
  assert.equal(report.failure_code, "generation_smoke_failed");
  assert.equal(report.generation_smoke.ok, false);
  assert.match(report.reason, /generation smoke failed/i);
});

test("local TTS doctor passes resident health into the GPU pressure check", async () => {
  let inspectedHealth = null;
  const health = {
    ok: true,
    status: "ok",
    phase: "ready",
    ready: true,
    engineCount: 1,
    voice: {
      alias: "Sleepy Liam",
      loaded: true,
      refResolved: true,
      reference: { id: "accepted", referenceHash: "hash" },
    },
    reasons: [],
  };

  const report = await runDoctor({
    restart: false,
    prewarm: false,
    smoke: false,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return health;
      },
      classifyLocalTtsDoctorAction(summary) {
        return summary.ok
          ? {
              action: "none",
              verdict: "green",
              reason: "local TTS is ready with the accepted voice loaded",
            }
          : {
              action: "manual_restart_required",
              verdict: "red",
              reason: "not ready",
            };
      },
      classifyLocalTtsHealthFailure() {
        return { code: null };
      },
      async inspectLocalGpuPressure(options) {
        inspectedHealth = options.localTtsHealth;
        return {
          ok: true,
          status: "ok",
          reason: "resident server threshold passed",
          thresholds: { localTtsResidentReady: true },
        };
      },
    },
  });

  assert.equal(inspectedHealth, health);
  assert.equal(report.verdict, "green");
  assert.equal(report.gpu.thresholds.localTtsResidentReady, true);
});

test("local TTS doctor blocks recovery side effects while the shared GPU is reserved", async () => {
  let startCount = 0;
  let prewarmCount = 0;
  let smokeCount = 0;
  const unreachable = {
    ok: false,
    status: "unreachable",
    phase: "unknown",
    ready: false,
    engineCount: 0,
    voice: { loaded: false, refResolved: false, present: false },
    reasons: ["health endpoint unreachable"],
  };

  const report = await runDoctor({
    restart: true,
    prewarm: true,
    smoke: true,
    forceNativeCrashRetry: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return unreachable;
      },
      async inspectLocalTtsNativeCrash() {
        return { detected: false };
      },
      async readPersistedNativeCrash() {
        return null;
      },
      classifyLocalTtsDoctorAction(summary, options = {}) {
        if (summary.status === "unreachable" && options.allowRestart) {
          return {
            action: "restart",
            verdict: "red",
            reason: "local TTS restart requested",
          };
        }
        return {
          action: "manual_restart_required",
          verdict: "red",
          reason: "local TTS is unreachable",
        };
      },
      classifyLocalTtsHealthFailure() {
        return { code: "local_tts_unreachable" };
      },
      async inspectLocalGpuPressure() {
        return {
          ok: false,
          status: "busy",
          failure_code: "shared_gpu_reserved",
          reason: "shared GPU is reserved by sleepy-stories",
          shared_gpu: {
            status: "reserved",
            owner: {
              studio: "sleepy-stories",
              hard_expires_at: "2026-07-23T13:23:28.599Z",
            },
          },
        };
      },
      async startLocalTtsServer() {
        startCount += 1;
        return {
          pid: 24685,
          spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" },
        };
      },
      async waitForLocalTtsHealth() {
        return unreachable;
      },
      async prewarmLocalTtsVoice() {
        prewarmCount += 1;
        return { ok: true };
      },
      async runGenerationSmoke() {
        smokeCount += 1;
        return { ok: true, provider: "local", size_bytes: 4096 };
      },
    },
  });

  assert.equal(startCount, 0);
  assert.equal(prewarmCount, 0);
  assert.equal(smokeCount, 0);
  assert.equal(report.verdict, "red");
  assert.equal(report.action, "wait_for_gpu");
  assert.equal(report.failure_code, "shared_gpu_reserved");
  assert.equal(report.gpu.shared_gpu.owner.studio, "sleepy-stories");
});

test("local TTS doctor retries generation smoke after an allowed restart", async () => {
  let startCount = 0;
  let startOptions = null;
  let smokeCount = 0;
  const report = await runDoctor({
    restart: true,
    prewarm: false,
    smoke: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return {
          ok: true,
          status: "ok",
          phase: "ready",
          ready: true,
          engineCount: 1,
          voice: {
            alias: "Sleepy Liam",
            loaded: true,
            refResolved: true,
            reference: { id: "accepted", referenceHash: "hash" },
          },
          reasons: [],
        };
      },
      classifyLocalTtsDoctorAction(summary) {
        return summary.ok
          ? {
              action: "none",
              verdict: "green",
              reason: "local TTS is ready with the accepted voice loaded",
            }
          : {
              action: "manual_restart_required",
              verdict: "red",
              reason: "not ready",
            };
      },
      classifyLocalTtsHealthFailure() {
        return { code: null };
      },
      async startLocalTtsServer(options) {
        startCount += 1;
        startOptions = options;
        return { pid: 24680, spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" } };
      },
      async waitForLocalTtsHealth() {
        return {
          ok: true,
          status: "ok",
          phase: "ready",
          ready: true,
          engineCount: 1,
          voice: {
            alias: "Sleepy Liam",
            loaded: true,
            refResolved: true,
            reference: { id: "accepted", referenceHash: "hash" },
          },
          reasons: [],
        };
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
      async runGenerationSmoke() {
        smokeCount += 1;
        if (smokeCount === 1) throw new Error("local_tts_generation_failed:server_error");
        return { ok: true, provider: "local", size_bytes: 4096, attempts: 1 };
      },
    },
  });

  assert.equal(startCount, 1);
  assert.equal(smokeCount, 2);
  assert.equal(report.verdict, "green");
  assert.equal(report.failure_code, null);
  assert.equal(report.started.pid, 24680);
  assert.equal(startOptions.allowRecentBootBypassWhenNoListener, true);
  assert.equal(report.generation_smoke.ok, true);
});

test("local TTS doctor quarantines a native inference crash without restarting it", async () => {
  let startCount = 0;
  let smokeCount = 0;
  const report = await runDoctor({
    restart: true,
    prewarm: false,
    smoke: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return {
          ok: true,
          status: "ok",
          phase: "ready",
          ready: true,
          engineCount: 1,
          voice: {
            alias: "Sleepy Liam",
            loaded: true,
            refResolved: true,
            reference: { id: "accepted", referenceHash: "hash" },
          },
          reasons: [],
        };
      },
      classifyLocalTtsDoctorAction(summary) {
        return summary.ok
          ? {
              action: "none",
              verdict: "green",
              reason: "local TTS is ready with the accepted voice loaded",
            }
          : {
              action: "manual_restart_required",
              verdict: "red",
              reason: "not ready",
            };
      },
      classifyLocalTtsHealthFailure() {
        return { code: null };
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
      async runGenerationSmoke() {
        smokeCount += 1;
        throw new Error("local_tts_generation_failed:connection_reset");
      },
      async inspectLocalTtsNativeCrash() {
        return {
          detected: true,
          failure_code: "native_inference_access_violation",
          signature: "Windows fatal exception: access violation",
          stage: "voxcpm_cuda_inference",
          evidence_path: "tts_server/diag/faulthandler.test.log",
          upstream_issue_url: "https://github.com/OpenBMB/VoxCPM/issues/300",
        };
      },
      async startLocalTtsServer() {
        startCount += 1;
        return { pid: 24682, spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" } };
      },
    },
  });

  assert.equal(smokeCount, 1);
  assert.equal(startCount, 0);
  assert.equal(report.verdict, "red");
  assert.equal(report.action, "quarantine_native_crash");
  assert.equal(report.failure_code, "native_inference_access_violation");
  assert.equal(report.native_crash.detected, true);
  assert.match(report.reason, /native access violation/i);
});

test("local TTS doctor keeps a crashed offline runtime quarantined before start", async () => {
  let startCount = 0;
  const report = await runDoctor({
    restart: true,
    prewarm: true,
    smoke: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return {
          ok: false,
          status: "unreachable",
          phase: "unknown",
          ready: false,
          engineCount: 0,
          voice: { loaded: false, refResolved: false, present: false },
          reasons: ["health endpoint unreachable"],
        };
      },
      async inspectLocalTtsNativeCrash() {
        return {
          detected: true,
          failure_code: "native_inference_access_violation",
          signature: "Windows fatal exception: access violation",
          stage: "voxcpm_cuda_inference",
          evidence_path: "tts_server/diag/faulthandler.test.log",
        };
      },
      async startLocalTtsServer() {
        startCount += 1;
        return { pid: 24683, spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" } };
      },
      async waitForLocalTtsHealth() {
        return {
          ok: false,
          status: "unreachable",
          phase: "unknown",
          ready: false,
          engineCount: 0,
          voice: { loaded: false, refResolved: false, present: false },
          reasons: ["health endpoint unreachable"],
        };
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
    },
  });

  assert.equal(startCount, 0);
  assert.equal(report.verdict, "red");
  assert.equal(report.action, "quarantine_native_crash");
  assert.equal(report.failure_code, "native_inference_access_violation");
  assert.equal(report.native_crash.detected, true);
});

test("local TTS doctor preserves native-crash quarantine when a later boot log is empty", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tts-quarantine-"));
  const previousCwd = process.cwd();
  const diagDir = path.join(dir, "tts_server", "diag");
  const reportDir = path.join(dir, "test", "output");
  const historicEvidencePath = path.join(diagDir, "faulthandler.crashed.log");
  const latestEvidencePath = path.join(diagDir, "faulthandler.latest.log");
  const unreachable = {
    ok: false,
    status: "unreachable",
    phase: "unknown",
    ready: false,
    engineCount: 0,
    voice: { loaded: false, refResolved: false, present: false },
    reasons: ["health endpoint unreachable"],
  };
  let startCount = 0;

  await fs.ensureDir(diagDir);
  await fs.ensureDir(reportDir);
  await fs.writeFile(
    historicEvidencePath,
    [
      "Windows fatal exception: access violation",
      "voxcpm_engine.py",
      "solve_euler",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(latestEvidencePath, "", "utf8");
  await fs.writeJson(path.join(diagDir, "boot_state.json"), {
    phase: "module_imported",
    faulthandler_log: latestEvidencePath,
  });
  await fs.writeJson(path.join(reportDir, "local_tts_doctor.json"), {
    verdict: "red",
    action: "quarantine_native_crash",
    failure_code: "native_inference_access_violation",
    native_crash: {
      detected: true,
      failure_code: "native_inference_access_violation",
      signature: "Windows fatal exception: access violation",
      stage: "voxcpm_cuda_inference",
      evidence_path: historicEvidencePath,
    },
  });

  process.chdir(dir);
  try {
    const report = await runDoctor({
      restart: true,
      prewarm: true,
      smoke: true,
      setExitCode: false,
      writeReport: false,
      deps: {
        async fetchLocalTtsHealth() {
          return unreachable;
        },
        classifyLocalTtsDoctorAction(summary, options = {}) {
          if (summary.status === "unreachable" && options.allowRestart) {
            return {
              action: "restart",
              verdict: "red",
              reason: "local TTS restart requested",
            };
          }
          return {
            action: "manual_restart_required",
            verdict: "red",
            reason: "local TTS is unreachable",
          };
        },
        classifyLocalTtsHealthFailure() {
          return { code: "local_tts_unreachable" };
        },
        async startLocalTtsServer() {
          startCount += 1;
          return {
            pid: 24684,
            spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" },
          };
        },
        async waitForLocalTtsHealth() {
          return unreachable;
        },
        async inspectLocalGpuPressure() {
          return { ok: true, reason: "gpu ok" };
        },
      },
    });

    assert.equal(startCount, 0);
    assert.equal(report.verdict, "red");
    assert.equal(report.action, "quarantine_native_crash");
    assert.equal(report.failure_code, "native_inference_access_violation");
    assert.equal(report.native_crash.detected, true);
    assert.equal(report.native_crash.evidence_path, historicEvidencePath);
  } finally {
    process.chdir(previousCwd);
    await fs.remove(dir);
  }
});

test("local TTS doctor prewarms an unloaded voice before retrying smoke after restart", async () => {
  let fetchCount = 0;
  let prewarmCount = 0;
  let smokeCount = 0;
  const ready = {
    ok: true,
    status: "ok",
    phase: "ready",
    ready: true,
    engineCount: 1,
    voice: {
      alias: "Sleepy Liam",
      loaded: true,
      refResolved: true,
      reference: { id: "accepted", referenceHash: "hash" },
    },
    reasons: [],
  };
  const unloaded = {
    ok: false,
    status: "ok",
    phase: "idle",
    ready: false,
    engineCount: 0,
    voice: {
      alias: "Sleepy Liam",
      loaded: false,
      refResolved: true,
      reference: { id: "accepted", referenceHash: "hash" },
    },
    reasons: ["accepted voice is not loaded"],
  };

  const report = await runDoctor({
    restart: true,
    prewarm: true,
    smoke: true,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        fetchCount += 1;
        return ready;
      },
      classifyLocalTtsDoctorAction(summary, options = {}) {
        if (summary.voice?.loaded) {
          return {
            action: "none",
            verdict: "green",
            reason: "local TTS is ready with the accepted voice loaded",
          };
        }
        if (options.allowPrewarm) {
          return {
            action: "prewarm",
            verdict: "amber",
            reason: "accepted voice needs prewarming",
          };
        }
        return {
          action: "manual_prewarm_required",
          verdict: "amber",
          reason: "accepted voice is not loaded",
        };
      },
      classifyLocalTtsHealthFailure(summary) {
        return { code: summary.voice?.loaded ? null : "voice_not_loaded" };
      },
      async startLocalTtsServer() {
        return { pid: 24681, spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" } };
      },
      async waitForLocalTtsHealth() {
        return unloaded;
      },
      async prewarmLocalTtsVoice() {
        prewarmCount += 1;
        return { ok: true, reused: false, loadedMs: 250 };
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
      async runGenerationSmoke() {
        smokeCount += 1;
        if (smokeCount === 1) throw new Error("local_tts_generation_failed:server_error");
        return { ok: true, provider: "local", size_bytes: 4096, attempts: 1 };
      },
    },
  });

  assert.equal(prewarmCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(smokeCount, 2);
  assert.equal(report.verdict, "green");
  assert.equal(report.failure_code, null);
  assert.equal(report.prewarm.ok, true);
  assert.equal(report.generation_smoke.ok, true);
});

test("local TTS doctor retries once when the first allowed start dies before binding", async () => {
  let startCount = 0;
  let healthWaitCount = 0;
  const unreachable = {
    ok: false,
    status: "unreachable",
    phase: "unknown",
    ready: false,
    engineCount: 0,
    voice: { loaded: false, refResolved: false, present: false },
    reasons: ["health endpoint unreachable"],
  };
  const ready = {
    ok: true,
    status: "ok",
    phase: "ready",
    ready: true,
    engineCount: 1,
    voice: {
      alias: "Sleepy Liam",
      loaded: true,
      refResolved: true,
      present: true,
      reference: { id: "accepted", referenceHash: "hash" },
    },
    reasons: [],
  };

  const report = await runDoctor({
    restart: true,
    prewarm: false,
    smoke: false,
    setExitCode: false,
    writeReport: false,
    deps: {
      async fetchLocalTtsHealth() {
        return unreachable;
      },
      async inspectLocalTtsNativeCrash() {
        return { detected: false };
      },
      async readPersistedNativeCrash() {
        return null;
      },
      async startLocalTtsServer() {
        startCount += 1;
        return {
          pid: startCount === 1 ? 11111 : 22222,
          spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" },
        };
      },
      async waitForLocalTtsHealth() {
        healthWaitCount += 1;
        return healthWaitCount === 1 ? unreachable : ready;
      },
      async inspectLocalGpuPressure() {
        return { ok: true, reason: "gpu ok" };
      },
    },
  });

  assert.equal(startCount, 2);
  assert.equal(report.verdict, "green");
  assert.equal(report.started.pid, 22222);
  assert.deepEqual(
    report.start_attempts.map((attempt) => attempt.pid),
    [11111, 22222],
  );
});

test("local TTS doctor JSON includes its report paths", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tts-doctor-"));
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    const paths = await writeReport({
      generated_at: "2026-05-06T00:00:00.000Z",
      verdict: "green",
      action: "none",
      failure_code: null,
      reason: "ready",
      before: { status: "ok", phase: "ready", ready: true, voice: {} },
    });
    const json = await fs.readJson(paths.jsonPath);
    assert.equal(json.report_paths.jsonPath, paths.jsonPath);
    assert.equal(json.report_paths.mdPath, paths.mdPath);
  } finally {
    process.chdir(previousCwd);
    await fs.remove(dir);
  }
});
