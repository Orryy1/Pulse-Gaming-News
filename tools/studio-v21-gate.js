"use strict";

const path = require("node:path");
const { runStudioGateV21 } = require("../lib/studio/v2/studio-rejection-gate-v21");

const ROOT = path.resolve(__dirname, "..");

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function envFlag(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return /^(true|1|yes|on)$/i.test(String(value));
}

async function main() {
  const storyId = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "1sn9xhe";
  const variant = arg("--variant", "v21");
  const outputDir = process.env.STUDIO_V2_OUTPUT_DIR
    ? path.resolve(ROOT, process.env.STUDIO_V2_OUTPUT_DIR)
    : undefined;
  const requireCanonical = envFlag("STUDIO_V21_REQUIRE_CANONICAL", true);
  console.log("==============================================");
  console.log("  STUDIO V2.1 REJECTION GATE");
  console.log("==============================================");
  const report = await runStudioGateV21({
    storyId,
    variant,
    outputDir,
    requireCanonical,
  });
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
