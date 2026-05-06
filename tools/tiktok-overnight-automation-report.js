"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildTikTokAutomationReport,
  renderTikTokAutomationMarkdown,
} = require("../lib/platforms/tiktok-automation-report");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function main() {
  await fs.ensureDir(OUT);
  const authDoctorReport = await readJsonIfExists(path.join(OUT, "tiktok_auth_doctor.json"));
  const dispatchManifest = await readJsonIfExists(
    path.join(OUT, "tiktok_dispatch_manifest.json"),
  );
  const freshDispatchPack = await readJsonIfExists(
    path.join(OUT, "tiktok-fresh-dispatch", "tiktok_fresh_dispatch_pack.json"),
  );
  const report = buildTikTokAutomationReport({
    authDoctorReport,
    dispatchManifest,
    freshDispatchPack,
  });
  const jsonPath = path.join(OUT, "tiktok_overnight_automation_report.json");
  const mdPath = path.join(OUT, "tiktok_overnight_automation_report.md");
  const rootPath = path.join(ROOT, "TIKTOK_OVERNIGHT_AUTOMATION_REPORT.md");
  const markdown = renderTikTokAutomationMarkdown(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(rootPath, markdown, "utf8");
  console.log(`[tiktok-overnight] verdict=${report.verdict}`);
  console.log(`[tiktok-overnight] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-overnight] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[tiktok-overnight] report=${path.relative(ROOT, rootPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-overnight] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
