#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  refreshCandidateAuthority,
} = require("../lib/candidate-authority-refresh");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    artifactDir: "",
    storyId: "",
    aggregatePaths: [],
    generatedAt: "",
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-dir") args.artifactDir = argv[++index] || "";
    else if (arg.startsWith("--artifact-dir=")) args.artifactDir = arg.slice("--artifact-dir=".length);
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--aggregate") args.aggregatePaths.push(argv[++index] || "");
    else if (arg.startsWith("--aggregate=")) {
      args.aggregatePaths.push(arg.slice("--aggregate=".length));
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || "";
    else if (arg.startsWith("--generated-at=")) args.generatedAt = arg.slice("--generated-at=".length);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/candidate-authority-refresh.js --artifact-dir <dir> --story-id <id> [options]",
    "",
    "Refreshes only goal_package_summary.json, platform_publish_manifest.json and publish_verdict.json",
    "from current independently verified local artefact evidence.",
    "",
    "Default mode is dry-run. --apply is required to write the three authority files.",
    "Apply writes atomic replacements with byte-for-byte backups and rejects any change to the",
    "current render, narration audio, word timestamps or rights-ledger SHA-256 fingerprints.",
    "",
    "This command never publishes, never mutates the database and never changes OAuth, tokens,",
    "credentials, billing or platform settings.",
    "",
    "Options:",
    "  --artifact-dir <dir>   Candidate artefact directory",
    "  --story-id <id>        Exact candidate story ID",
    "  --aggregate <path>      Atomically refresh the matching aggregate row; repeatable",
    "  --generated-at <ISO>   Deterministic evidence timestamp",
    "  --apply                Apply the atomic authority-only transaction",
    "  --json                 Print the complete machine-readable report",
    "  --help                 Show this help",
  ].join("\n");
}

function markdown(report = {}) {
  const lines = [
    "# Candidate Authority Refresh",
    "",
    `Story: ${report.story_id || "unknown"}`,
    `Mode: ${report.mode || "DRY_RUN"}`,
    `Verdict: ${report.verdict || "RED"}`,
    `Auto-publish: ${report.can_auto_publish === true ? "yes" : "no"}`,
    `Applied: ${report.applied === true ? "yes" : "no"}`,
    `Frozen hashes preserved: ${report.frozen_hashes?.preserved === true ? "yes" : "no"}`,
    "",
    "## Blockers",
    ...((report.blockers || []).length
      ? report.blockers.map((blocker) => `- ${blocker}`)
      : ["- none"]),
    "",
    "## Warnings",
    ...((report.warnings || []).length
      ? report.warnings.map((warning) => `- ${warning}`)
      : ["- none"]),
    "",
    "## Files",
    ...((report.changed_files || []).length
      ? report.changed_files.map((filePath) => `- changed: ${filePath}`)
      : ["- no authority files changed"]),
    ...((report.backups || []).map((item) => `- backup: ${item.backup_path}`)),
    "",
    "## Safety",
    "No publishing, database mutation, OAuth/token change or platform-setting change is available in this lane.",
  ];
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  if (!args.storyId) throw new Error("--story-id is required");
  if (args.generatedAt && Number.isNaN(Date.parse(args.generatedAt))) {
    throw new Error("--generated-at must be a valid ISO timestamp");
  }

  const report = await refreshCandidateAuthority({
    artifactDir: path.resolve(process.cwd(), args.artifactDir),
    storyId: args.storyId,
    aggregatePaths: args.aggregatePaths.filter(Boolean).map((aggregatePath) =>
      path.resolve(process.cwd(), aggregatePath)),
    apply: args.apply,
    ...(args.generatedAt ? { generatedAt: new Date(args.generatedAt).toISOString() } : {}),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(markdown(report).trimEnd());
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[candidate-authority-refresh] FAILED: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  markdown,
  parseArgs,
  usage,
};
