#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  OFFICIAL_XBOX_RULES_URL,
  materializePublisherVideoPolicyEvidence,
} = require("../lib/publisher-video-policy-evidence");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    segmentReportPath: "",
    outputDir: "",
    storyId: "",
    gameName: "",
    itemTitle: "",
    sourceAppId: "",
    targetPlatforms: ["youtube"],
    generatedAt: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--policy-url") args.policyUrl = argv[++index] || "";
    else if (arg === "--segment-report") args.segmentReportPath = argv[++index] || "";
    else if (arg === "--out-dir" || arg === "--output-dir") args.outputDir = argv[++index] || "";
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++index] || "";
    else if (arg === "--game-name") args.gameName = argv[++index] || "";
    else if (arg === "--item-title") args.itemTitle = argv[++index] || "";
    else if (arg === "--steam-app-id" || arg === "--source-app-id") {
      args.sourceAppId = argv[++index] || "";
    } else if (arg === "--platforms") {
      args.targetPlatforms = String(argv[++index] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--generated-at") args.generatedAt = argv[++index] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:publisher-video-policy-evidence -- [options]",
    "",
    "Fetches the official Microsoft Game Content Usage Rules, stores a raw",
    "hash-bound snapshot and binds its conditional YouTube ad-program scope",
    "only to validated Steam trailer windows for one declared app and story.",
    "The result permits local, source-audio-free materialisation only and keeps",
    "live publishing AMBER pending explicit human/legal review.",
    "",
    "Options:",
    "  --segment-report <path>  Validated segment report JSON",
    "  --out-dir <dir>          Evidence and bound-report output directory",
    "  --story-id <id>          Exact story ID",
    "  --game-name <name>       Microsoft-owned game name for the notice",
    "  --item-title <title>     Pulse item title for the notice",
    "  --steam-app-id <id>      Exact Steam app ID in source media URLs",
    "  --platforms <keys>       Must resolve only to youtube",
    "  --policy-url <url>       Exact official Xbox rules URL",
    "  --generated-at <iso>     Deterministic evidence time",
    "  --root <dir>             Workspace root for relative paths",
    "  --json                   Print machine-readable result",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), { fetchImpl = globalThis.fetch } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  for (const [flag, value] of [
    ["--segment-report", args.segmentReportPath],
    ["--out-dir", args.outputDir],
    ["--story-id", args.storyId],
    ["--game-name", args.gameName],
    ["--item-title", args.itemTitle],
    ["--steam-app-id", args.sourceAppId],
  ]) {
    if (!String(value || "").trim()) throw new Error(`${flag} is required`);
  }
  const root = path.resolve(args.root);
  const segmentReportPath = path.resolve(root, args.segmentReportPath);
  const outputDir = path.resolve(root, args.outputDir);
  const segmentReport = await fs.readJson(segmentReportPath);
  const result = await materializePublisherVideoPolicyEvidence({
    outputDir,
    policyUrl: args.policyUrl,
    segmentReport,
    storyId: args.storyId,
    gameName: args.gameName,
    itemTitle: args.itemTitle,
    sourceAppId: args.sourceAppId,
    targetPlatforms: args.targetPlatforms,
    generatedAt: args.generatedAt || new Date().toISOString(),
    fetchImpl,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Publisher policy evidence: ${result.decision.verdict}`);
    console.log(`Bound segments: ${result.summary.bound_segment_count}`);
    console.log(`Bound report: ${result.bound_segment_report_path}`);
    console.log("Live publish: held for explicit human/legal review");
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[publisher-video-policy-evidence] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
