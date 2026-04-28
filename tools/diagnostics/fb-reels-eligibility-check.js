#!/usr/bin/env node
"use strict";

const {
  fetchFacebookReelsEvidence,
  writeFacebookReelsEligibilityReport,
} = require("../../lib/platforms/facebook-reels-eligibility");

async function main() {
  const evidence = await fetchFacebookReelsEvidence();
  const { report, jsonPath, mdPath } = await writeFacebookReelsEligibilityReport({
    evidence,
  });
  const c = report.classification;
  console.log(`[fb-reels-eligibility] verdict=${c.verdict} reason=${c.reason}`);
  console.log(
    `[fb-reels-eligibility] counts videos=${c.counts.videos} reels=${c.counts.reels} posts=${c.counts.posts}`,
  );
  console.log(`[fb-reels-eligibility] json=${jsonPath}`);
  console.log(`[fb-reels-eligibility] md=${mdPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[fb-reels-eligibility] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
