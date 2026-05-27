#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildOfficialDirectMediaDiscoveryReport,
  probeDirectMediaMetadata,
  renderOfficialDirectMediaDiscoveryMarkdown,
} = require("../lib/official-direct-media-discovery");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_INPUT = path.join(TEST_OUT, "visual_v4_source_family_intake_template.json");
const DEFAULT_OUTPUT_JSON = path.join(TEST_OUT, "official_direct_media_discovery.json");
const DEFAULT_OUTPUT_MD = path.join(TEST_OUT, "official_direct_media_discovery.md");
const DEFAULT_OUTPUT_TEMPLATE = path.join(TEST_OUT, "official_direct_media_intake_template.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    input: DEFAULT_INPUT,
    storyId: null,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
    timeoutMs: 10000,
    maxCandidatesPerEntry: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--input") args.input = argv[++i] || DEFAULT_INPUT;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--output-json") args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
    else if (arg === "--output-md") args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    else if (arg === "--output-template") args.outputTemplate = argv[++i] || DEFAULT_OUTPUT_TEMPLATE;
    else if (arg === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 10000);
    else if (arg === "--max-candidates-per-entry") {
      args.maxCandidatesPerEntry = Math.max(1, Number(argv[++i]) || 1);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/official-direct-media-discovery.js --input <intake-template.json> [options]",
      "",
      "Options:",
      "  --input <path>           Official-source intake template JSON",
      "  --story-id <id>          Limit to one story",
      "  --output-json <path>     Write local report JSON",
      "  --output-md <path>       Write local report Markdown",
      "  --output-template <path> Write filled intake template",
      "  --timeout-ms <n>         Per-page fetch timeout",
      "  --max-candidates-per-entry <n>",
      "                           Expand each official page into up to n direct-media intake rows",
      "  --json                   Print JSON instead of Markdown",
      "",
      "This command fetches official page text only. It never downloads videos, uses yt-dlp, mutates the DB, touches OAuth or posts.",
    ].join("\n") + "\n",
  );
}

function resolveFromRoot(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

async function readEntries(inputPath, storyId = null) {
  const resolved = resolveFromRoot(inputPath);
  if (!(await fs.pathExists(resolved))) return [];
  const payload = await fs.readJson(resolved);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.entries)
      ? payload.entries
      : Array.isArray(payload.items)
        ? payload.items
        : [payload];
  return storyId ? rows.filter((entry) => String(entry.story_id || "") === storyId) : rows;
}

async function writeOutputs(args, report, markdown) {
  const outputJson = resolveFromRoot(args.outputJson);
  const outputMd = resolveFromRoot(args.outputMd);
  const outputTemplate = resolveFromRoot(args.outputTemplate);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.ensureDir(path.dirname(outputTemplate));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, markdown, "utf8");
  await fs.writeJson(outputTemplate, report.output_template.entries, { spaces: 2 });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const entries = await readEntries(args.input, args.storyId);
  const report = await buildOfficialDirectMediaDiscoveryReport({
    entries,
    timeoutMs: args.timeoutMs,
    probeMedia: probeDirectMediaMetadata,
    maxCandidatesPerEntry: args.maxCandidatesPerEntry,
  });
  const markdown = renderOfficialDirectMediaDiscoveryMarkdown(report);
  await writeOutputs(args, report, markdown);
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[official-direct-media-discovery] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};
