"use strict";

const { runGauntlet, discoverGauntletCandidates } = require("../lib/studio/v2/gauntlet-v2");

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  console.log("==============================================");
  console.log("  STUDIO V2 GAUNTLET");
  console.log("==============================================");

  const candidates = await discoverGauntletCandidates();
  console.log(`[gauntlet] discovered ${candidates.length} rendered candidate(s)`);
  for (const candidate of candidates) {
    console.log(
      `  - ${candidate.storyId}:${candidate.variant} (${candidate.kind})`,
    );
  }

  const report = await runGauntlet({
    candidates,
    skipLoudness: hasFlag("--skip-loudness"),
  });

  console.log("");
  console.log(`[gauntlet] verdict: ${report.summary.verdict}`);
  console.log(`[gauntlet] best: ${report.summary.bestCandidate || "none"}`);
  console.log(
    `[gauntlet] findings: ${report.summary.failCount} fail / ${report.summary.warnCount} warn`,
  );
  for (const finding of report.findings) {
    console.log(`  - ${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  }
  console.log("");
  console.log(`[gauntlet] json: ${report.outputs.json}`);
  console.log(`[gauntlet] md:   ${report.outputs.markdown}`);
  console.log(`[gauntlet] html: ${report.outputs.html}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
