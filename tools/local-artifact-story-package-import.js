#!/usr/bin/env node
"use strict";

const {
  importLocalArtifactStoryPackage,
} = require("../lib/local-artifact-story-package-import");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    artifactDir: "",
    storyId: "",
    outPath: "",
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-dir") args.artifactDir = argv[++index] || "";
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg === "--out") args.outPath = argv[++index] || "";
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/local-artifact-story-package-import.js --artifact-dir <dir> [options]",
    "",
    "Builds a fail-closed one-story package manifest from current local artefact evidence.",
    "Default mode is a no-write dry-run. --apply writes only the explicit local --out file.",
    "It never publishes, loads credentials, mutates a database or changes the runtime.",
    "",
    "Options:",
    "  --artifact-dir <dir>  Governed candidate artefact directory",
    "  --story-id <id>       Exact story id; defaults to the canonical manifest id",
    "  --out <path>          Isolated story-packages.json destination",
    "  --generated-at <ISO>  Deterministic evidence timestamp",
    "  --apply               Write the isolated local manifest",
    "  --json                Print the complete report",
    "  --help                 Show this help",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  const report = await importLocalArtifactStoryPackage({
    artifactDir: args.artifactDir,
    storyId: args.storyId,
    outPath: args.outPath,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apply: args.apply,
  });
  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    stdout.write(
      [
        `Local artifact package import: ${report.story_packages[0]?.story_id || "unknown"}`,
        `Mode: ${report.mode}`,
        `Verdict: ${report.story_packages[0]?.verdict || "RED"}`,
        `Output: ${report.output_path || "not written"}`,
        "Safety: local proof only; no publish, DB, credential or runtime action.",
        "",
      ].join("\n"),
    );
  }
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[local-artifact-story-package-import] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
