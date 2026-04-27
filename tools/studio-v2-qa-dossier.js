"use strict";

const { runQaDossier } = require("../lib/studio/v2/qa-dossier-v2");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  console.log("==============================================");
  console.log("  STUDIO V2 QA DOSSIER");
  console.log("==============================================");

  const report = await runQaDossier({
    gauntletPath: argValue("--gauntlet") || undefined,
    readinessPath: argValue("--readiness") || undefined,
  });

  console.log("");
  console.log(`[qa-dossier] gauntlet: ${report.summary.gauntletVerdict}`);
  console.log(`[qa-dossier] current channels: ${report.summary.currentChannelVerdict}`);
  console.log(
    `[qa-dossier] release-ready: ${report.summary.currentReleaseReadyCount}/${report.summary.currentChannelCount}`,
  );
  console.log(
    `[qa-dossier] historical failures retained: ${report.summary.historicalFailureCount}`,
  );
  console.log("");
  console.log(`[qa-dossier] json: ${report.outputs.json}`);
  console.log(`[qa-dossier] md:   ${report.outputs.markdown}`);
  console.log(`[qa-dossier] html: ${report.outputs.html}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
