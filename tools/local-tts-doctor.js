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

function parseArgs(argv = process.argv.slice(2)) {
  return {
    restart: argv.includes("--restart"),
    prewarm: argv.includes("--prewarm"),
    writeReport: !argv.includes("--no-report"),
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
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const baseUrl = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL;
  const before = await fetchLocalTtsHealth({
    baseUrl,
    voiceId,
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });
  const plan = classifyLocalTtsDoctorAction(before, {
    allowRestart: options.restart === true,
    allowPrewarm: options.prewarm === true,
  });

  const report = {
    generated_at: new Date().toISOString(),
    voice_id: voiceId,
    base_url: baseUrl,
    verdict: plan.verdict,
    action: plan.action,
    failure_code: classifyLocalTtsHealthFailure(before).code,
    reason: plan.reason,
    before,
    after: null,
    started: null,
    prewarm: null,
    report_paths: null,
  };

  console.log(`[tts-doctor] before ${formatLocalTtsStatus(before)}`);
  console.log(`[tts-doctor] action=${plan.action} verdict=${plan.verdict}`);

  if (plan.action === "start" || plan.action === "restart") {
    report.started = await startLocalTtsServer();
    console.log(
      `[tts-doctor] started pid=${report.started.pid || "unknown"} stdout=${report.started.spec.stdoutPath}`,
    );
    report.after = await waitForLocalTtsHealth({
      baseUrl,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_START_WAIT_MS || 45000),
      intervalMs: Number(process.env.LOCAL_TTS_START_POLL_MS || 1500),
    });
    console.log(`[tts-doctor] after-start ${formatLocalTtsStatus(report.after)}`);
  }

  const current = report.after || before;
  const prewarmPlan = classifyLocalTtsDoctorAction(current, {
    allowRestart: false,
    allowPrewarm: options.prewarm === true,
  });
  if (prewarmPlan.action === "prewarm") {
    report.prewarm = await prewarmLocalTtsVoice({
      baseUrl,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_PREWARM_TIMEOUT_MS || 600000),
    });
    console.log(
      `[tts-doctor] prewarm ok reused=${report.prewarm.reused === true} loaded_ms=${report.prewarm.loadedMs}`,
    );
    report.after = await fetchLocalTtsHealth({
      baseUrl,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
    });
    console.log(`[tts-doctor] after-prewarm ${formatLocalTtsStatus(report.after)}`);
  }

  const finalSummary = report.after || before;
  const finalPlan = classifyLocalTtsDoctorAction(finalSummary, {
    allowRestart: false,
    allowPrewarm: false,
  });
  const finalFailure = classifyLocalTtsHealthFailure(finalSummary);
  report.verdict = finalPlan.verdict;
  report.action = finalPlan.action;
  report.failure_code = finalFailure.code;
  report.reason = finalPlan.reason;

  if (options.writeReport !== false) {
    report.report_paths = await writeReport(report);
    console.log(
      `[tts-doctor] report=${path.relative(process.cwd(), report.report_paths.mdPath)}`,
    );
  }

  if (report.verdict === "red") process.exitCode = 1;
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
  writeReport,
};
