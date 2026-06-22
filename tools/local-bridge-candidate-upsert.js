#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  upsertLocalBridgeCandidate,
} = require("../lib/local-bridge-candidate-upsert");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    bridgePath: path.join(ROOT, "output", "goal-contract", "scheduler_bridge_candidates.json"),
    artifactDir: "",
    outDir: path.join(ROOT, "output", "goal-contract"),
    backupDir: path.join(ROOT, "output", "goal-contract", "local-bridge-upsert-backups"),
    generatedAt: new Date().toISOString(),
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bridge") args.bridgePath = argv[++i] || args.bridgePath;
    else if (arg === "--artifact-dir") args.artifactDir = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--backup-dir") args.backupDir = argv[++i] || args.backupDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || args.generatedAt;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/local-bridge-candidate-upsert.js --artifact-dir <dir> [options]",
    "",
    "Adds or replaces one completed local package in scheduler_bridge_candidates.json.",
    "It does not publish, mutate DB rows, touch OAuth/tokens or enable disabled platforms.",
    "",
    "Options:",
    "  --bridge <path>",
    "  --artifact-dir <dir>",
    "  --out-dir <dir>",
    "  --backup-dir <dir>",
    "  --generated-at <iso>",
    "  --apply",
    "  --json",
  ].join("\n");
}

function markdown(report = {}) {
  const lines = [];
  lines.push("# Local Bridge Candidate Upsert");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Mode: ${report.mode || "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- before: ${report.summary?.before_count ?? 0}`);
  lines.push(`- after: ${report.summary?.after_count ?? 0}`);
  lines.push(`- story: ${report.summary?.upserted_story_id || "unknown"}`);
  lines.push(`- applied: ${report.summary?.applied === true ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- no publishing");
  lines.push("- no DB mutation");
  lines.push("- no OAuth/token changes");
  lines.push("- disabled platforms remain deferred");
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  const report = await upsertLocalBridgeCandidate({
    bridgePath: path.resolve(args.bridgePath),
    artifactDir: path.resolve(args.artifactDir),
    backupDir: path.resolve(args.backupDir),
    generatedAt: args.generatedAt,
    apply: args.apply,
  });
  const outDir = path.resolve(args.outDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, args.apply
    ? "local_bridge_candidate_upsert_report.json"
    : "local_bridge_candidate_upsert_dry_run.json");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(reportPath.replace(/\.json$/i, ".md"), markdown(report), "utf8");
  if (args.json) console.log(JSON.stringify({ report, reportPath }, null, 2));
  else console.log(markdown(report).trimEnd());
  return { report, reportPath };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[local-bridge-candidate-upsert] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
