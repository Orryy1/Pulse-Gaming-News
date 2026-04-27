"use strict";

const path = require("node:path");
const { runForensicQa } = require("../lib/studio/v2/forensic-qa-v2");

const ROOT = path.resolve(__dirname, "..");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const storyId = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "1sn9xhe";
  const mp4Path = argValue("--mp4");
  const reportPath = argValue("--report");
  const assPath = argValue("--ass");

  console.log("==============================================");
  console.log("  STUDIO V2 FORENSIC QA");
  console.log(`  story: ${storyId}`);
  console.log("==============================================");

  const report = await runForensicQa({
    storyId,
    mp4Path: mp4Path ? path.resolve(ROOT, mp4Path) : undefined,
    reportPath: reportPath ? path.resolve(ROOT, reportPath) : undefined,
    assPath: assPath ? path.resolve(ROOT, assPath) : undefined,
  });

  console.log("");
  console.log(`[qa] verdict: ${report.summary.verdict}`);
  console.log(`[qa] issues: ${report.summary.issueCount}`);
  console.log(`[qa] duration: ${report.runtime.mp4DurationS}s`);
  console.log(
    `[qa] audio recurrence: ${report.audio.verdict} (${report.audio.declaredSfxCueCount} declared SFX cues)`,
  );
  console.log(
    `[qa] visual repetition: ${report.visual.verdict} (${report.visual.repeatPairCount} possible repeat pairs)`,
  );
  console.log(`[qa] subtitles: ${report.subtitles.verdict}`);
  for (const issue of report.issues) {
    console.log(`  - ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  }
  console.log("");
  console.log(`[qa] json: ${report.outputs.jsonPath}`);
  console.log(`[qa] html: ${report.outputs.htmlPath}`);
  console.log(`[qa] md:   ${report.outputs.markdownPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
