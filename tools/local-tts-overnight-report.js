#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalTtsOvernightReport,
  renderLocalTtsOvernightMarkdown,
} = require("../lib/studio/local-tts-overnight-report");
const {
  loadLocalTtsProofReports,
} = require("../lib/studio/local-tts-proof-report-loader");
const {
  resolveLocalReadinessOutputDir,
} = require("../lib/ops/local-readiness-evidence-root");

const ROOT = path.resolve(__dirname, "..");
const OUT = resolveLocalReadinessOutputDir({ cwd: ROOT });

function shouldWriteRootReport({ argv = process.argv.slice(2), env = process.env } = {}) {
  return (
    argv.includes("--write-root-report") ||
    String(env.PULSE_WRITE_ROOT_TTS_OVERNIGHT_REPORT || "").trim().toLowerCase() === "true"
  );
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function runLocalTtsOvernightReport({
  root = ROOT,
  outDir = resolveLocalReadinessOutputDir({ cwd: root }),
  writeRootReport = false,
} = {}) {
  await fs.ensureDir(outDir);
  const doctorReport = await readJsonIfExists(path.join(outDir, "local_tts_doctor.json"));
  const repairQueue = await readJsonIfExists(path.join(outDir, "local_media_repair_queue.json"));
  const proofReports = await loadLocalTtsProofReports({ outDir });

  const report = buildLocalTtsOvernightReport({
    doctorReport,
    repairQueue,
    audioApplyReports: proofReports,
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  const jsonPath = path.join(outDir, "local_tts_overnight_report.json");
  const mdPath = path.join(outDir, "local_tts_overnight_report.md");
  const rootPath = path.join(root, "LOCAL_TTS_OVERNIGHT_REPORT.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (writeRootReport) {
    await fs.writeFile(rootPath, markdown, "utf8");
  }

  return {
    report,
    jsonPath,
    mdPath,
    rootPath: writeRootReport ? rootPath : null,
    writeRootReport,
  };
}

async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const result = await runLocalTtsOvernightReport({
    root: ROOT,
    outDir: OUT,
    writeRootReport: shouldWriteRootReport({ argv, env }),
  });

  console.log(`[local-tts-overnight] verdict=${result.report.verdict}`);
  console.log(`[local-tts-overnight] json=${path.relative(ROOT, result.jsonPath)}`);
  console.log(`[local-tts-overnight] md=${path.relative(ROOT, result.mdPath)}`);
  if (result.rootPath) {
    console.log(`[local-tts-overnight] report=${path.relative(ROOT, result.rootPath)}`);
  } else {
    console.log("[local-tts-overnight] report=skipped_root_report_use_--write-root-report");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-tts-overnight] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main, runLocalTtsOvernightReport, shouldWriteRootReport };
