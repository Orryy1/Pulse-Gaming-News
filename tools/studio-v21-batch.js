"use strict";

try {
  if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
    require("dotenv").config({ override: true });
  }
} catch {}

const { runStudioV21ReviewBatch } = require("../lib/studio/v2/studio-v21-review-batch");

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const limit = Number(argValue("--limit", process.env.STUDIO_V21_BATCH_LIMIT || 5));
  const dryRun = hasFlag("--dry-run");
  const result = await runStudioV21ReviewBatch({
    limit,
    dryRun,
    env: process.env,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
