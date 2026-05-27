#!/usr/bin/env node
"use strict";

const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const {
  runContinuousLearningLoop,
  resolveLearningPaths,
} = require("../lib/intelligence/continuous-learning-loop");
const {
  readDbSignals,
  readTokenStatus,
  uploadScopeRequested,
} = require("./analytics-capability-doctor");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    fixture: false,
    dry: false,
    limit: 12,
    maxAgeDays: 45,
    outDir: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--dry") args.dry = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice(8));
    else if (arg === "--max-age-days" && argv[i + 1])
      args.maxAgeDays = Number(argv[++i]);
    else if (arg.startsWith("--max-age-days="))
      args.maxAgeDays = Number(arg.slice(15));
    else if (arg === "--out-dir" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice(10);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 12;
  if (!Number.isFinite(args.maxAgeDays) || args.maxAgeDays < 1)
    args.maxAgeDays = 45;
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const env = { ...process.env };
  if (args.outDir) {
    env.PULSE_LEARNING_DIR = path.isAbsolute(args.outDir)
      ? args.outDir
      : path.resolve(ROOT, args.outDir);
  }

  const paths = resolveLearningPaths({ env });
  const result = await runContinuousLearningLoop({
    env,
    fixture: args.fixture,
    dry: args.dry,
    limit: args.limit,
    maxAgeDays: args.maxAgeDays,
    paths,
    readTokenStatus,
    readDbSignals,
    uploadScopeRequested,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  } else {
    console.log(`[continuous-learning] status=${result.summary.status}`);
    console.log(`[continuous-learning] targets=${result.summary.target_count}`);
    console.log(
      `[continuous-learning] public_model=${result.summary.learning_surfaces.public_counter_model.enabled ? "enabled" : "off"}`,
    );
    console.log(
      `[continuous-learning] visual_v3_files=${result.summary.learning_surfaces.visual_v3_feedback.retention_files_written}`,
    );
    console.log(
      `[continuous-learning] md=${path.relative(ROOT, result.artefacts.mdPath)}`,
    );
    console.log(
      `[continuous-learning] json=${path.relative(ROOT, result.artefacts.jsonPath)}`,
    );
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[continuous-learning] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
