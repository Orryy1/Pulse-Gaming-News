"use strict";

const { runStudioGateV21 } = require("../lib/studio/v2/studio-rejection-gate-v21");

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function main() {
  const storyId = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "1sn9xhe";
  const variant = arg("--variant", "v21");
  console.log("==============================================");
  console.log("  STUDIO V2.1 REJECTION GATE");
  console.log("==============================================");
  const report = await runStudioGateV21({ storyId, variant });
  console.log("");
  console.log(`[gate:v21] candidate: ${report.candidateKey}`);
  console.log(`[gate:v21] verdict: ${report.verdict}`);
  console.log(
    `[gate:v21] hard fails: ${report.hardFailReasons.length} · warnings: ${report.amberWarnings.length}`,
  );
  console.log(`[gate:v21] next: ${report.recommendedNextAction}`);
  console.log("");
  console.log(`[gate:v21] json: ${report.outputs.json}`);
  console.log(`[gate:v21] md:   ${report.outputs.markdown}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
