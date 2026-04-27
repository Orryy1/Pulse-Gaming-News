"use strict";

const {
  runChannelReadiness,
} = require("../lib/studio/v2/channel-readiness-v2");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function main() {
  console.log("==============================================");
  console.log("  STUDIO V2 CHANNEL READINESS");
  console.log("==============================================");

  const report = await runChannelReadiness({
    gauntletPath: argValue("--gauntlet") || undefined,
  });

  console.log("");
  console.log(`[channel-readiness] verdict: ${report.summary.verdict}`);
  console.log(
    `[channel-readiness] release-ready: ${report.summary.releaseReadyCount}/${report.summary.channelCount}`,
  );
  console.log(`[channel-readiness] best: ${report.summary.bestChannel || "none"}`);
  for (const channel of report.channels) {
    console.log(
      `  - ${channel.channelId}: ${channel.verdict} (${channel.score}) ` +
        `${channel.hardFailures.length} blockers / ${channel.warnings.length} warnings`,
    );
  }
  console.log("");
  console.log(`[channel-readiness] json: ${report.outputs.json}`);
  console.log(`[channel-readiness] md:   ${report.outputs.markdown}`);
  console.log(`[channel-readiness] html: ${report.outputs.html}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
