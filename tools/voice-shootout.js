"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  buildVoiceShootoutReport,
  generateLocalLiamBenchmarkSamples,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
} = require("../lib/studio/v2/voice-shootout");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = []) {
  const args = {
    outDir: OUT,
    updateRoot: true,
    generateLocalLiam: false,
    applyLocal: false,
    engine: "voxcpm2",
    rate: 1.0,
    baseUrl: process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765",
    voiceId: null,
    limit: null,
    approvedLocalVoice: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      const value = argv[++i] || OUT;
      args.outDir = path.resolve(ROOT, value);
    } else if (arg === "--no-root") {
      args.updateRoot = false;
    } else if (arg === "--update-root") {
      args.updateRoot = true;
    } else if (arg === "--generate-local-liam" || arg === "--generate-local") {
      args.generateLocalLiam = true;
    } else if (arg === "--apply-local") {
      args.applyLocal = true;
    } else if (arg === "--dry-run") {
      args.applyLocal = false;
    } else if (arg === "--engine") {
      args.engine = argv[++i] || args.engine;
    } else if (arg === "--rate") {
      args.rate = Number(argv[++i] || args.rate);
    } else if (arg === "--base-url") {
      args.baseUrl = argv[++i] || args.baseUrl;
    } else if (arg === "--voice-id") {
      args.voiceId = argv[++i] || null;
    } else if (arg === "--limit") {
      const parsed = Number(argv[++i]);
      args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (arg === "--approved-local-voice") {
      args.approvedLocalVoice = true;
    } else if (arg === "--no-approved-local-voice") {
      args.approvedLocalVoice = false;
    }
  }
  if (args.generateLocalLiam) {
    args.updateRoot = false;
  }
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

async function readLocalTtsStatus(outDir = OUT) {
  const localTtsDoctorReport =
    (await readJsonIfExists(path.join(outDir, "local_tts_doctor.json"))) ||
    (await readJsonIfExists(path.join(OUT, "local_tts_doctor.json")));
  const overnightReport =
    (await readJsonIfExists(path.join(outDir, "local_tts_overnight_report.json"))) ||
    (await readJsonIfExists(path.join(OUT, "local_tts_overnight_report.json")));
  const doctor = localTtsDoctorReport || {};
  const overnight = overnightReport || {};
  return {
    ...doctor,
    overnightReport: overnight,
    expected_local_voice_id:
      doctor.expected_local_voice_id || overnight.expected_local_voice_id,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  await fs.ensureDir(args.outDir);
  const localTtsDoctorReport = await readLocalTtsStatus(args.outDir);
  let localGeneration = null;
  let samples = [];
  if (args.generateLocalLiam) {
    localGeneration = await generateLocalLiamBenchmarkSamples({
      localTtsDoctorReport,
      outputRoot: path.join(args.outDir, "audio"),
      applyLocal: args.applyLocal,
      engine: args.engine,
      rate: args.rate,
      baseUrl: args.baseUrl,
      voiceId: args.voiceId,
      approvedLocalVoice: args.approvedLocalVoice,
      limit: args.limit,
      env: process.env,
    });
    samples = localGeneration.samples || [];
  }
  const report = buildVoiceShootoutReport({
    localTtsDoctorReport,
    env: process.env,
    samples,
    localGeneration,
  });
  const markdown = renderVoiceShootoutMarkdown(report);
  const reviewSheet = renderVoiceReviewSheet(report.blindReviewPack);

  const reportJsonPath = path.join(args.outDir, "voice_shootout_overnight_report.json");
  const reportMdPath = path.join(args.outDir, "voice_shootout_overnight_report.md");
  const manifestOutPath = path.join(args.outDir, "voice_benchmark_manifest.json");
  const reviewOutPath = path.join(args.outDir, "voice_review_sheet.md");
  const generationOutPath = path.join(args.outDir, "voice_shootout_local_generation.json");
  const rootReportPath = path.join(ROOT, "VOICE_SHOOTOUT_OVERNIGHT_REPORT.md");
  const rootManifestPath = path.join(ROOT, "voice_benchmark_manifest.json");
  const rootReviewPath = path.join(ROOT, "voice_review_sheet.md");

  await fs.writeJson(reportJsonPath, report, { spaces: 2 });
  await fs.writeFile(reportMdPath, markdown, "utf8");
  await fs.writeJson(manifestOutPath, report.benchmarkManifest, { spaces: 2 });
  await fs.writeFile(reviewOutPath, reviewSheet, "utf8");
  if (localGeneration) await fs.writeJson(generationOutPath, localGeneration, { spaces: 2 });
  if (args.updateRoot) {
    await fs.writeFile(rootReportPath, markdown, "utf8");
    await fs.writeJson(rootManifestPath, report.benchmarkManifest, { spaces: 2 });
    await fs.writeFile(rootReviewPath, reviewSheet, "utf8");
  }

  console.log(`[voice-shootout] verdict=${report.verdict}`);
  console.log(
    `[voice-shootout] report=${path.relative(ROOT, args.updateRoot ? rootReportPath : reportMdPath)}`,
  );
  console.log(
    `[voice-shootout] manifest=${path.relative(ROOT, args.updateRoot ? rootManifestPath : manifestOutPath)}`,
  );
  console.log(
    `[voice-shootout] review=${path.relative(ROOT, args.updateRoot ? rootReviewPath : reviewOutPath)}`,
  );
  if (localGeneration) {
    console.log(
      `[voice-shootout] local-generation=${path.relative(ROOT, generationOutPath)} status=${localGeneration.status}`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[voice-shootout] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, readLocalTtsStatus };
