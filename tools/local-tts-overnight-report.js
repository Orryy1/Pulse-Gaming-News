#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalTtsOvernightReport,
  renderLocalTtsOvernightMarkdown,
} = require("../lib/studio/local-tts-overnight-report");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function main() {
  await fs.ensureDir(OUT);
  const doctorReport = await readJsonIfExists(path.join(OUT, "local_tts_doctor.json"));
  const repairQueue = await readJsonIfExists(path.join(OUT, "local_media_repair_queue.json"));
  const audioApply = await readJsonIfExists(path.join(OUT, "local_media_repair_audio_apply.json"));
  const scriptExtensionAudioApply = await readJsonIfExists(
    path.join(OUT, "local_script_extension_audio_apply.json"),
  );

  const report = buildLocalTtsOvernightReport({
    doctorReport,
    repairQueue,
    audioApplyReports: [
      { source: "local_media_repair", report: audioApply },
      { source: "local_script_extension", report: scriptExtensionAudioApply },
    ],
  });
  const markdown = renderLocalTtsOvernightMarkdown(report);

  const jsonPath = path.join(OUT, "local_tts_overnight_report.json");
  const mdPath = path.join(OUT, "local_tts_overnight_report.md");
  const rootPath = path.join(ROOT, "LOCAL_TTS_OVERNIGHT_REPORT.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(rootPath, markdown, "utf8");

  console.log(`[local-tts-overnight] verdict=${report.verdict}`);
  console.log(`[local-tts-overnight] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[local-tts-overnight] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[local-tts-overnight] report=${path.relative(ROOT, rootPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-tts-overnight] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
