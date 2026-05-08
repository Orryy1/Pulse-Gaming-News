"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  buildVoiceShootoutReport,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
} = require("../lib/studio/v2/voice-shootout");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = []) {
  const args = {
    outDir: OUT,
    updateRoot: true,
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
    }
  }
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function readLocalTtsStatus(outDir = OUT) {
  const localTtsDoctorReport = await readJsonIfExists(
    path.join(outDir, "local_tts_doctor.json"),
  );
  const overnightReport = await readJsonIfExists(
    path.join(outDir, "local_tts_overnight_report.json"),
  );
  return {
    ...localTtsDoctorReport,
    overnightReport,
    expected_local_voice_id:
      localTtsDoctorReport.expected_local_voice_id || overnightReport.expected_local_voice_id,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.ensureDir(args.outDir);
  const localTtsDoctorReport = await readLocalTtsStatus(args.outDir);
  const report = buildVoiceShootoutReport({
    localTtsDoctorReport,
    env: process.env,
  });
  const markdown = renderVoiceShootoutMarkdown(report);
  const reviewSheet = renderVoiceReviewSheet(report.blindReviewPack);

  const reportJsonPath = path.join(args.outDir, "voice_shootout_overnight_report.json");
  const reportMdPath = path.join(args.outDir, "voice_shootout_overnight_report.md");
  const manifestOutPath = path.join(args.outDir, "voice_benchmark_manifest.json");
  const reviewOutPath = path.join(args.outDir, "voice_review_sheet.md");
  const rootReportPath = path.join(ROOT, "VOICE_SHOOTOUT_OVERNIGHT_REPORT.md");
  const rootManifestPath = path.join(ROOT, "voice_benchmark_manifest.json");
  const rootReviewPath = path.join(ROOT, "voice_review_sheet.md");

  await fs.writeJson(reportJsonPath, report, { spaces: 2 });
  await fs.writeFile(reportMdPath, markdown, "utf8");
  await fs.writeJson(manifestOutPath, report.benchmarkManifest, { spaces: 2 });
  await fs.writeFile(reviewOutPath, reviewSheet, "utf8");
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
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[voice-shootout] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, readLocalTtsStatus };
