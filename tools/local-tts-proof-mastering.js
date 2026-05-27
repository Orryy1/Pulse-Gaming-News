#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const util = require("node:util");
const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true, quiet: true });

const {
  buildLocalTtsProofMasteringReport,
  renderLocalTtsProofMasteringMarkdown,
} = require("../lib/studio/local-tts-proof-mastering");
const { loadLocalTtsProofReports } = require("../lib/studio/local-tts-proof-report-loader");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const execFileAsync = util.promisify(cp.execFile);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    outDir: OUT,
    storyIds: [],
    limit: 20,
    applyLocal: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--out-dir") args.outDir = argv[++i] || OUT;
    else if (arg === "--story" || arg === "--story-id") args.storyIds.push(String(argv[++i] || "").trim());
    else if (arg.startsWith("--story=")) args.storyIds.push(arg.slice("--story=".length).trim());
    else if (arg.startsWith("--story-id=")) args.storyIds.push(arg.slice("--story-id=".length).trim());
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--apply-local") args.applyLocal = true;
    else if (arg === "--dry-run") args.applyLocal = false;
  }
  args.storyIds = args.storyIds.filter(Boolean);
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 20;
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);
  const proofReports = await loadLocalTtsProofReports({ outDir });
  const overnightReport = await readJsonIfExists(path.join(outDir, "local_tts_overnight_report.json"));
  const report = await buildLocalTtsProofMasteringReport({
    proofReports,
    overnightReport,
    storyIds: args.storyIds,
    limit: args.limit,
    applyLocal: args.applyLocal,
    deps: {
      execFileAsync,
      env: process.env,
      now: new Date(),
    },
  });
  const jsonPath = path.join(outDir, "local_tts_proof_mastering.json");
  const mdPath = path.join(outDir, "local_tts_proof_mastering.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderLocalTtsProofMasteringMarkdown(report), "utf8");
  console.log(
    `[local-tts-proof-mastering] mode=${report.mode} ready=${report.counts.ready_rows_seen} would=${report.counts.would_master} applied=${report.counts.applied} blocked=${report.counts.blocked}`,
  );
  console.log(`[local-tts-proof-mastering] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[local-tts-proof-mastering] md=${path.relative(ROOT, mdPath)}`);
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-tts-proof-mastering] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
