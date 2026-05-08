"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true, quiet: true });

const { inspectTokenStatus } = require("../upload_tiktok");
const { buildPlatformOperationalConfig } = require("../lib/ops/platform-status");
const {
  buildPlatformReadinessDoctor,
  renderPlatformReadinessDoctorMarkdown,
} = require("../lib/ops/platform-readiness-doctor");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function main() {
  await fs.ensureDir(OUT);
  const tiktokTokenStatus = await inspectTokenStatus();
  const tiktokAutomationReport = await readJsonIfExists(
    path.join(OUT, "tiktok_overnight_automation_report.json"),
  );
  const instagramLastError = getArg("--instagram-error") || process.env.PLATFORM_DOCTOR_INSTAGRAM_ERROR || null;
  const facebookManualProof = {
    observed:
      hasFlag("--facebook-manual-proof") ||
      String(process.env.FACEBOOK_REELS_MANUAL_PROOF || "").toLowerCase() === "true",
    note:
      getArg("--facebook-manual-proof-note") ||
      process.env.FACEBOOK_REELS_MANUAL_PROOF_NOTE ||
      null,
  };
  const report = buildPlatformReadinessDoctor({
    tiktokTokenStatus,
    tiktokAutomationReport,
    platformConfig: buildPlatformOperationalConfig(process.env),
    instagramLastError,
    facebookManualProof,
  });
  const jsonPath = path.join(OUT, "platform_readiness_doctor.json");
  const mdPath = path.join(OUT, "platform_readiness_doctor.md");
  const rootPath = path.join(ROOT, "PLATFORM_READINESS_DOCTOR.md");
  const markdown = renderPlatformReadinessDoctorMarkdown(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(rootPath, markdown, "utf8");
  console.log(`[platform-doctor] verdict=${report.verdict}`);
  console.log(`[platform-doctor] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[platform-doctor] md=${path.relative(ROOT, mdPath)}`);
  console.log("[platform-doctor] no OAuth, token mutation, uploads or posts");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[platform-doctor] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
