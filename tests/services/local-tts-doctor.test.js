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
