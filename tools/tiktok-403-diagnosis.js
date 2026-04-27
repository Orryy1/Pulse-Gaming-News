"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  diagnoseTikTok403,
  renderTikTokDiagnosisMarkdown,
} = require("../lib/platforms/tiktok-403-diagnosis");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "test", "output");

async function readTextIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return "";
  return fs.readFile(filePath, "utf8");
}

async function main() {
  await fs.ensureDir(OUTPUT_DIR);
  const uploadSource = await readTextIfExists(path.join(ROOT, "upload_tiktok.js"));
  const privacyTestSource = await readTextIfExists(
    path.join(ROOT, "tests", "services", "tiktok-privacy-level.test.js"),
  );
  const browserFallbackSource = await readTextIfExists(
    path.join(ROOT, "tests", "services", "tiktok-browser-fallback.test.js"),
  );
  const report = diagnoseTikTok403({ uploadSource, privacyTestSource, browserFallbackSource });
  const jsonPath = path.join(OUTPUT_DIR, "tiktok_403_diagnosis.json");
  const mdPath = path.join(OUTPUT_DIR, "tiktok_403_diagnosis.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokDiagnosisMarkdown(report), "utf8");
  console.log(`[tiktok] wrote ${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok] wrote ${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
