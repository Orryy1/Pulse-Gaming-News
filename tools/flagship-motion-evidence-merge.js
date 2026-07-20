#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  mergeFlagshipMotionEvidence,
} = require("../lib/flagship-motion-evidence-merge");

function inlineValue(arg, name) {
  const prefix = `${name}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyId: "",
    primaryManifestPath: "",
    primaryClipIds: [],
    donorManifestPath: "",
    donorClipIds: [],
    outputDir: "",
    generatedAt: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    let value;
    if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if ((value = inlineValue(arg, "--story-id")) !== null) args.storyId = value;
    else if (arg === "--primary-manifest") args.primaryManifestPath = argv[++index] || "";
    else if ((value = inlineValue(arg, "--primary-manifest")) !== null) {
      args.primaryManifestPath = value;
    } else if (arg === "--primary-clip-id") args.primaryClipIds.push(argv[++index] || "");
    else if ((value = inlineValue(arg, "--primary-clip-id")) !== null) {
      args.primaryClipIds.push(value);
    } else if (arg === "--donor-manifest") args.donorManifestPath = argv[++index] || "";
    else if ((value = inlineValue(arg, "--donor-manifest")) !== null) {
      args.donorManifestPath = value;
    } else if (arg === "--donor-clip-id") args.donorClipIds.push(argv[++index] || "");
    else if ((value = inlineValue(arg, "--donor-clip-id")) !== null) {
      args.donorClipIds.push(value);
    } else if (arg === "--output-dir") args.outputDir = argv[++index] || "";
    else if ((value = inlineValue(arg, "--output-dir")) !== null) args.outputDir = value;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || "";
    else if ((value = inlineValue(arg, "--generated-at")) !== null) args.generatedAt = value;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h" || arg === "-?") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function required(value, flag) {
  if (!String(value || "").trim()) throw new Error(`${flag} is required`);
  return value;
}

function usage() {
  return [
    "Usage:",
    "  node tools/flagship-motion-evidence-merge.js --story-id <id> --primary-manifest <file> --donor-manifest <file> --donor-clip-id <id> --output-dir <dir> [options]",
    "",
    "Builds an isolated, hash-bound motion-only evidence set from selected governed sources.",
    "The command never renders, publishes, mutates a database or changes OAuth/token state.",
    "",
    "Options:",
    "  --primary-clip-id <id>  Select a primary clip; repeat to override all-manifest default",
    "  --donor-clip-id <id>    Select a donor clip; repeat for multiple donor clips",
    "  --generated-at <iso>    Fixed evidence timestamp",
    "  --json                  Print the machine-readable report",
    "  --help                  Show this help",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const stdout = dependencies.stdout || ((value) => process.stdout.write(String(value)));
  if (args.help) {
    stdout(`${usage()}\n`);
    return { help: true };
  }
  const cwd = path.resolve(dependencies.cwd || process.cwd());
  const result = await mergeFlagshipMotionEvidence({
    storyId: required(args.storyId, "--story-id"),
    primaryManifestPath: path.resolve(
      cwd,
      required(args.primaryManifestPath, "--primary-manifest"),
    ),
    primaryClipIds: args.primaryClipIds,
    donorManifestPath: path.resolve(
      cwd,
      required(args.donorManifestPath, "--donor-manifest"),
    ),
    donorClipIds: args.donorClipIds,
    outputDir: path.resolve(cwd, required(args.outputDir, "--output-dir")),
    generatedAt: args.generatedAt || undefined,
  }, {
    probeMedia: dependencies.probeMedia,
  });
  stdout(args.json
    ? `${JSON.stringify(result.report, null, 2)}\n`
    : `[flagship-motion-evidence-merge] status=${result.report.status} story=${result.report.story_id} clips=${result.report.selected_motion_clip_count}\n`);
  return result;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const stderr = dependencies.stderr || ((value) => process.stderr.write(`${value}\n`));
  const exit = dependencies.exit || ((code) => { process.exitCode = code; });
  try {
    const result = await main(argv, dependencies);
    exit(0);
    return result;
  } catch (error) {
    stderr(`[flagship-motion-evidence-merge] FAILED: ${error.stack || error.message}`);
    exit(1);
    return null;
  }
}

if (require.main === module) runCli();

module.exports = {
  main,
  parseArgs,
  runCli,
  usage,
};
