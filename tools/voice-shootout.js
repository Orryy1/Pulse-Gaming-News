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

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function main() {
  await fs.ensureDir(OUT);
  const localTtsDoctorReport = await readJsonIfExists(
    path.join(OUT, "local_tts_doctor.json"),
  );
  const report = buildVoiceShootoutReport({
    localTtsDoctorReport,
    env: process.env,
  });
  const markdown = renderVoiceShootoutMarkdown(report);
  const reviewSheet = renderVoiceReviewSheet(report.blindReviewPack);

  const reportJsonPath = path.join(OUT, "voice_shootout_overnight_report.json");
  const reportMdPath = path.join(OUT, "voice_shootout_overnight_report.md");
  const manifestOutPath = path.join(OUT, "voice_benchmark_manifest.json");
  const reviewOutPath = path.join(OUT, "voice_review_sheet.md");
  const rootReportPath = path.join(ROOT, "VOICE_SHOOTOUT_OVERNIGHT_REPORT.md");
  const rootManifestPath = path.join(ROOT, "voice_benchmark_manifest.json");
  const rootReviewPath = path.join(ROOT, "voice_review_sheet.md");

  await fs.writeJson(reportJsonPath, report, { spaces: 2 });
  await fs.writeFile(reportMdPath, markdown, "utf8");
  await fs.writeJson(manifestOutPath, report.benchmarkManifest, { spaces: 2 });
  await fs.writeFile(reviewOutPath, reviewSheet, "utf8");
  await fs.writeFile(rootReportPath, markdown, "utf8");
  await fs.writeJson(rootManifestPath, report.benchmarkManifest, { spaces: 2 });
  await fs.writeFile(rootReviewPath, reviewSheet, "utf8");

  console.log(`[voice-shootout] verdict=${report.verdict}`);
  console.log(`[voice-shootout] report=${path.relative(ROOT, rootReportPath)}`);
  console.log(`[voice-shootout] manifest=${path.relative(ROOT, rootManifestPath)}`);
  console.log(`[voice-shootout] review=${path.relative(ROOT, rootReviewPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[voice-shootout] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
