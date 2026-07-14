"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const brand = require("../brand");
const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
  formatLocalTtsStatus,
  prewarmLocalTtsVoice,
} = require("../lib/studio/local-tts-readiness");
const {
  classifyLocalTtsDoctorAction,
  renderLocalTtsDoctorMarkdown,
  startLocalTtsServer,
  waitForLocalTtsHealth,
} = require("../lib/studio/local-tts-supervisor");
const {
  classifyLocalTtsHealthFailure,
} = require("../lib/studio/local-tts-failures");
const {
  formatLocalGpuPressure,
  inspectLocalGpuPressure,
} = require("../lib/studio/local-gpu-pressure");

function parseArgs(argv = process.argv.slice(2)) {
  return {
    restart: argv.includes("--restart"),
    prewarm: argv.includes("--prewarm"),
    smoke: argv.includes("--smoke"),
    writeReport: !argv.includes("--no-report"),
  };
}

function smokeFailureMessage(error) {
  return String(error?.message || error || "unknown_generation_smoke_failure").trim();
}

async function runDefaultGenerationSmoke({ voiceId, baseUrl }) {
  process.env.TTS_PROVIDER = "local";
  process.env.LOCAL_TTS_URL = baseUrl || process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL;
  process.env.LOCAL_TTS_TIMEOUT_MS =
    process.env.LOCAL_TTS_DOCTOR_SMOKE_TIMEOUT_MS ||
    process.env.LOCAL_TTS_SMOKE_TIMEOUT_MS ||
    process.env.LOCAL_TTS_TIMEOUT_MS ||
    "180000";
  process.env.LOCAL_TTS_REQUEST_ATTEMPTS =
    process.env.LOCAL_TTS_DOCTOR_SMOKE_ATTEMPTS ||
    process.env.LOCAL_TTS_SMOKE_ATTEMPTS ||
    process.env.LOCAL_TTS_REQUEST_ATTEMPTS ||
    "1";
  process.env.PULSE_SKIP_DOTENV = "true";

  const mediaPaths = require("../lib/media-paths");
  const audio = require("../audio");
  const outputPath = "output/audio/__local_tts_doctor_smoke_sleepy_liam_latest.mp3";
  const timestampPath = outputPath.replace(/\.mp3$/, "_timestamps.json");
  await fs.remove(mediaPaths.writePath(outputPath)).catch(() => {});
  await fs.remove(mediaPaths.writePath(timestampPath)).catch(() => {});
  const attempt = await audio.generateTtsForStory({
    story: { id: "local-tts-doctor-smoke", title: "Local TTS doctor smoke proof" },
    text: "Pulse Gaming local TTS generation smoke check.",
    outputPath,
    rate: 1.0,
    label: "doctor-smoke",
    provider: "local",
  });
  const resolved = await mediaPaths.resolveExisting(outputPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1024) {
    throw new Error("local_tts_generation_failed:smoke_audio_too_small");
  }
  return {
    ok: true,
    provider: "local",
    voice_id: voiceId,
    output_path: resolved,
    size_bytes: stat.size,
    attempts: attempt?.attempts || 1,
  };
}

async function writeReport(report) {
  const outDir = path.join("test", "output");
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "local_tts_doctor.json");
  const mdPath = path.join(outDir, "local_tts_doctor.md");
  const reportPaths = {
    jsonPath: path.resolve(jsonPath),
    mdPath: path.resolve(mdPath),
  };
  const reportWithPaths = {
    ...report,
    report_paths: reportPaths,
  };
  await fs.writeJson(jsonPath, reportWithPaths, { spaces: 2 });
  await fs.writeFile(mdPath, renderLocalTtsDoctorMarkdown(reportWithPaths), "utf8");
  return reportPaths;
}

async function runDoctor(options = {}) {
  const deps = options.deps || {};
  const fetchHealth = deps.fetchLocalTtsHealth || fetchLocalTtsHealth;
  const classifyAction = deps.classifyLocalTtsDoctorAction || classifyLocalTtsDoctorAction;
  const classifyFailure = deps.classifyLocalTtsHealthFailure || classifyLocalTtsHealthFailure;
  const startServer = deps.startLocalTtsServer || startLocalTtsServer;
  const waitForHealth = deps.waitForLocalTtsHealth || waitForLocalTtsHealth;
  const prewarmVoice = deps.prewarmLocalTtsVoice || prewarmLocalTtsVoice;
  const inspectGpu = deps.inspectLocalGpuPressure || inspectLocalGpuPressure;
  const runGenerationSmoke = deps.runGenerationSmoke || runDefaultGenerationSmoke;
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const baseUrl = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL;
  const before = await fetchHealth({
    baseUrl,
    voiceId,
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });
  const plan = classifyAction(before, {
    allowRestart: options.restart === true,
    allowPrewarm: options.prewarm === true,
  });

  const report = {
    generated_at: new Date().toISOString(),
    voice_id: voiceId,
    base_url: baseUrl,
    verdict: plan.verdict,
    action: plan.action,
    failure_code: classifyFailure(before).code,
    reason: plan.reason,
    before,
    after: null,
    started: null,
    start_attempts: [],
    prewarm: null,
    generation_smoke: null,
    gpu: null,
    report_paths: null,
  };

  console.log(`[tts-doctor] before ${formatLocalTtsStatus(before)}`);
  console.log(`[tts-doctor] action=${plan.action} verdict=${plan.verdict}`);

  if (plan.action === "start" || plan.action === "restart") {
    const maxStartAttempts = Math.max(
      1,
      Math.min(5, Number(process.env.LOCAL_TTS_START_ATTEMPTS || 5) || 5),
    );
    for (let attempt = 1; attempt <= maxStartAttempts; attempt += 1) {
      report.started = await startServer({
        allowRecentBootBypassWhenNoListener: true,
      });
      report.start_attempts.push(report.started);
      console.log(
        `[tts-doctor] start-attempt=${attempt}/${maxStartAttempts} pid=${report.started.pid || "unknown"} stdout=${report.started.spec.stdoutPath}`,
      );
      report.after = await waitForHealth({
        baseUrl,
        voiceId,
        processId: report.started.pid,
        timeoutMs: Number(process.env.LOCAL_TTS_START_WAIT_MS || 45000),
        intervalMs: Number(process.env.LOCAL_TTS_START_POLL_MS || 1500),
      });
      console.log(`[tts-doctor] after-start ${formatLocalTtsStatus(report.after)}`);
      if (report.after?.status !== "unreachable") break;
    }
  }

  const current = report.after || before;
  const prewarmPlan = classifyAction(current, {
    allowRestart: false,
    allowPrewarm: options.prewarm === true,
  });
  if (prewarmPlan.action === "prewarm") {
    report.prewarm = await prewarmVoice({
      baseUrl,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_PREWARM_TIMEOUT_MS || 600000),
    });
    console.log(
      `[tts-doctor] prewarm ok reused=${report.prewarm.reused === true} loaded_ms=${report.prewarm.loadedMs}`,
    );
    report.after = await fetchHealth({
      baseUrl,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
    });
    console.log(`[tts-doctor] after-prewarm ${formatLocalTtsStatus(report.after)}`);
  }

  const finalSummary = report.after || before;
  const finalPlan = classifyAction(finalSummary, {
    allowRestart: false,
    allowPrewarm: false,
  });
  const finalFailure = classifyFailure(finalSummary);
  report.verdict = finalPlan.verdict;
  report.action = finalPlan.action;
  report.failure_code = finalFailure.code;
  report.reason = finalPlan.reason;

  report.gpu = await inspectGpu({ env: process.env, localTtsHealth: finalSummary });
  console.log(`[tts-doctor] gpu ${formatLocalGpuPressure(report.gpu)}`);
  if (report.verdict === "green" && report.gpu?.ok === false) {
    report.verdict = "amber";
    report.action = "wait_for_gpu";
    report.failure_code = report.gpu.failure_code || "gpu_saturated";
    report.reason = report.gpu.reason || "local GPU is too busy for clean TTS generation";
  }

  if (options.smoke === true && report.verdict === "green") {
    try {
      report.generation_smoke = await runGenerationSmoke({ voiceId, baseUrl });
      console.log(
        `[tts-doctor] smoke ok size=${report.generation_smoke.size_bytes || "unknown"} attempts=${report.generation_smoke.attempts || 1}`,
      );
    } catch (err) {
      const message = smokeFailureMessage(err);
      report.generation_smoke = {
        ok: false,
        provider: "local",
        error: message,
      };
      report.verdict = "red";
      report.action = options.restart === true ? "restart" : "manual_restart_required";
      report.failure_code = "generation_smoke_failed";
      report.reason = `local TTS generation smoke failed: ${message}`;
      console.log(`[tts-doctor] smoke failed ${message}`);
      if (options.restart === true) {
        report.started = await startServer({
          allowRecentBootBypassWhenNoListener: true,
        });
        console.log(
          `[tts-doctor] smoke-restart pid=${report.started.pid || "unknown"} stdout=${report.started.spec.stdoutPath}`,
        );
        report.after = await waitForHealth({
          baseUrl,
          voiceId,
          timeoutMs: Number(process.env.LOCAL_TTS_START_WAIT_MS || 45000),
          intervalMs: Number(process.env.LOCAL_TTS_START_POLL_MS || 1500),
        });
        console.log(`[tts-doctor] after-smoke-restart ${formatLocalTtsStatus(report.after)}`);
        const restartedPrewarmPlan = classifyAction(report.after, {
          allowRestart: false,
          allowPrewarm: options.prewarm === true,
        });
        if (restartedPrewarmPlan.action === "prewarm") {
          report.prewarm = await prewarmVoice({
            baseUrl,
            voiceId,
            timeoutMs: Number(process.env.LOCAL_TTS_PREWARM_TIMEOUT_MS || 600000),
          });
          console.log(
            `[tts-doctor] smoke-restart prewarm ok reused=${report.prewarm.reused === true} loaded_ms=${report.prewarm.loadedMs}`,
          );
          report.after = await fetchHealth({
            baseUrl,
            voiceId,
            timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
          });
          console.log(
            `[tts-doctor] after-smoke-restart-prewarm ${formatLocalTtsStatus(report.after)}`,
          );
        }
        const restartedPlan = classifyAction(report.after, {
          allowRestart: false,
          allowPrewarm: false,
        });
        const restartedFailure = classifyFailure(report.after);
        report.verdict = restartedPlan.verdict;
        report.action = restartedPlan.action;
        report.failure_code = restartedFailure.code;
        report.reason = restartedPlan.reason;
        if (report.verdict === "green") {
          try {
            report.generation_smoke = await runGenerationSmoke({ voiceId, baseUrl });
            console.log(
              `[tts-doctor] smoke retry ok size=${report.generation_smoke.size_bytes || "unknown"} attempts=${report.generation_smoke.attempts || 1}`,
            );
          } catch (retryErr) {
            const retryMessage = smokeFailureMessage(retryErr);
            report.generation_smoke = {
              ok: false,
              provider: "local",
              error: retryMessage,
            };
            report.verdict = "red";
            report.action = "manual_restart_required";
            report.failure_code = "generation_smoke_failed_after_restart";
            report.reason = `local TTS generation smoke failed after restart: ${retryMessage}`;
            console.log(`[tts-doctor] smoke retry failed ${retryMessage}`);
          }
        }
      }
    }
  }

  if (options.writeReport !== false) {
    report.report_paths = await writeReport(report);
    console.log(
      `[tts-doctor] report=${path.relative(process.cwd(), report.report_paths.mdPath)}`,
    );
  }

  if (report.verdict === "red" && options.setExitCode !== false) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  runDoctor(parseArgs()).catch((err) => {
    console.error(`[tts-doctor] ERROR: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runDoctor,
  runDefaultGenerationSmoke,
  smokeFailureMessage,
  writeReport,
};
