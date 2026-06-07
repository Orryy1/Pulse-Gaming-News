#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCompetitorForensicsLab,
  renderCompetitorForensicsLabMarkdown,
  writeCompetitorForensicsLab,
} = require("../lib/competitor-forensics-lab");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    registryPath: null,
    metadataPath: null,
    transcriptsPath: null,
    outDir: path.join(ROOT, "output", "competitor-forensics-lab"),
    generatedAt: null,
    collectPublicFeeds: true,
    maxVideosPerChannel: 5,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry") args.registryPath = argv[++index] || null;
    else if (arg === "--metadata") {
      args.metadataPath = argv[++index] || null;
      args.collectPublicFeeds = false;
    } else if (arg === "--transcripts") args.transcriptsPath = argv[++index] || null;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--max-videos-per-channel") args.maxVideosPerChannel = Number(argv[++index] || args.maxVideosPerChannel);
    else if (arg === "--no-public-feed-collection") args.collectPublicFeeds = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:competitor-forensics-lab -- [options]",
    "",
    "Options:",
    "  --registry <path>                 Optional competitor registry JSON",
    "  --metadata <path>                 Optional pre-collected metadata inventory JSON",
    "  --transcripts <path>              Optional authorised/operator-supplied transcript snippets JSON",
    "  --out-dir <dir>                   Output directory",
    "  --generated-at <iso>              Fixed timestamp for deterministic reports",
    "  --max-videos-per-channel <n>      Public RSS entries per YouTube channel, default 5",
    "  --no-public-feed-collection       Do not attempt public RSS collection",
    "  --json                            Print JSON report",
    "",
    "LOCAL_PROOF only. This command reads public metadata or operator fixtures, writes internal research artefacts, does not download competitor videos, does not store competitor media assets, does not publish, does not post externally, does not mutate DB rows and does not touch OAuth or token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const registry = await readJsonIfPresent(args.registryPath, null);
  const metadataInventory = await readJsonIfPresent(args.metadataPath, null);
  const transcripts = await readJsonIfPresent(args.transcriptsPath, {});
  const report = await buildCompetitorForensicsLab({
    registry,
    metadataInventory,
    transcripts,
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
    collectPublicFeeds: args.collectPublicFeeds,
    maxVideosPerChannel: args.maxVideosPerChannel,
  });
  const written = await writeCompetitorForensicsLab(report, { outputDir: path.resolve(args.outDir) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderCompetitorForensicsLabMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[competitor-forensics-lab] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
