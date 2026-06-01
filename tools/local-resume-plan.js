#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalResumePlan,
  formatLocalResumePlanMarkdown,
} = require("../lib/ops/local-resume-plan");
const { buildLocalPostingReadiness } = require("../lib/ops/local-posting-readiness");
const { buildLocalRestartReadiness } = require("../lib/ops/local-restart-readiness");
const { loadLocalTtsProofReports } = require("../lib/studio/local-tts-proof-report-loader");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function readJsonIfExists(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return {};
    return await fs.readJson(filePath);
  } catch {
    return {};
  }
}

function hasUsablePostingReadiness(report = {}) {
  return Boolean(report && report.verdict && report.readiness);
}

async function resolveLocalPostingReadiness(outDir = OUT) {
  const cutoverPlan = await readJsonIfExists(path.join(outDir, "local_cutover_plan.json"));
  const primaryReadiness = await readJsonIfExists(path.join(outDir, "local_primary_readiness.json"));
  const ttsReport = await readJsonIfExists(path.join(outDir, "local_tts_overnight_report.json"));
  const ttsDoctorReport = await readJsonIfExists(path.join(outDir, "local_tts_doctor.json"));
  if (
    cutoverPlan?.generated_at ||
    primaryReadiness?.generated_at ||
    ttsReport?.generated_at ||
    ttsDoctorReport?.generated_at
  ) {
    return buildLocalPostingReadiness({
      cutoverPlan,
      primaryReadiness,
      ttsReport,
      ttsDoctorReport,
    });
  }

  const current = await readJsonIfExists(path.join(outDir, "local_posting_readiness.json"));
  if (hasUsablePostingReadiness(current)) return current;

  return buildLocalPostingReadiness({
    cutoverPlan,
    primaryReadiness,
    ttsReport,
    ttsDoctorReport,
  });
}

async function resolveLocalTtsProofReports(outDir = OUT) {
  return loadLocalTtsProofReports({ outDir });
}

async function main() {
  const jsonOnly = process.argv.includes("--json");
  await fs.ensureDir(OUT);

  const report = buildLocalResumePlan({
    localPostingReadiness: await resolveLocalPostingReadiness(OUT),
    localRestartReadiness: await buildLocalRestartReadiness({ cwd: ROOT }),
    platformDoctor: await readJsonIfExists(path.join(OUT, "platform_readiness_doctor.json")),
    socialOps: await readJsonIfExists(path.join(OUT, "social_platform_operations.json")),
    proofCandidates: await readJsonIfExists(path.join(OUT, "studio_v2_proof_candidates.json")),
    ttsReport: await readJsonIfExists(path.join(OUT, "local_tts_overnight_report.json")),
    localTtsProofReports: await resolveLocalTtsProofReports(OUT),
  });

  const markdown = formatLocalResumePlanMarkdown(report);
  const jsonPath = path.join(OUT, "local_resume_posting_plan.json");
  const mdPath = path.join(OUT, "local_resume_posting_plan.md");
  const rootPath = path.join(ROOT, "LOCAL_RESUME_POSTING_PLAN.md");

  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(rootPath, markdown, "utf8");

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
    process.stderr.write(`[local-resume-plan] json=${jsonPath}\n`);
    process.stderr.write(`[local-resume-plan] md=${mdPath}\n`);
    process.stderr.write(`[local-resume-plan] report=${rootPath}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-resume-plan] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  hasUsablePostingReadiness,
  readJsonIfExists,
  resolveLocalPostingReadiness,
  resolveLocalTtsProofReports,
};
