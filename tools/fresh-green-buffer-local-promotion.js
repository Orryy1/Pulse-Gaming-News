#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildFreshGreenBufferLocalPromotionReport,
  writeFreshGreenBufferLocalPromotionArtifacts,
  renderMarkdown,
} = require("../lib/fresh-green-buffer-local-promotion");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STORIES = path.join(ROOT, "output", "overnight-fresh-green-buffer", "fresh_source_intake_stories.json");
const DEFAULT_OUT = path.join(ROOT, "output", "overnight-fresh-green-buffer");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storiesPath: DEFAULT_STORIES,
    outDir: DEFAULT_OUT,
    generatedAt: new Date().toISOString(),
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stories" || arg === "--story-json") args.storiesPath = path.resolve(ROOT, argv[++i] || args.storiesPath);
    else if (arg.startsWith("--stories=")) args.storiesPath = path.resolve(ROOT, arg.slice("--stories=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || args.generatedAt;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/fresh-green-buffer-local-promotion.js [options]",
    "",
    "Builds local-only package/work-order artefacts from fresh source-backed story drafts.",
    "It does not publish, mutate production DB rows, touch OAuth/tokens or enable disabled platforms.",
    "",
    "Options:",
    "  --stories <path>       Fresh story draft JSON array",
    "  --out-dir <path>       Output directory",
    "  --generated-at <iso>   Fixed timestamp",
    "  --json                 Print JSON report",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return { args, report: null, written: null };
  }
  const stories = await fs.readJson(args.storiesPath);
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories,
    generatedAt: args.generatedAt,
  });
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, {
    outputDir: args.outDir,
  });
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  process.stderr.write(`[fresh-buffer-promotion] out=${path.relative(ROOT, args.outDir)}\n`);
  return { args, report, written };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[fresh-buffer-promotion] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
