#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildOfficialSearchIntakeAutofillReport,
  renderOfficialSearchIntakeAutofillMarkdown,
} = require("../lib/official-search-intake-autofill");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_INPUT = path.join(TEST_OUT, "visual_v4_official_search_template.json");
const DEFAULT_MERGE_INPUT = path.join(TEST_OUT, "visual_v4_source_family_intake_template.json");
const DEFAULT_OUTPUT_JSON = path.join(TEST_OUT, "official_search_intake_autofill.json");
const DEFAULT_OUTPUT_MD = path.join(TEST_OUT, "official_search_intake_autofill.md");
const DEFAULT_OUTPUT_TEMPLATE = path.join(TEST_OUT, "visual_v4_source_family_intake_template_autofill.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    input: DEFAULT_INPUT,
    mergeInput: null,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
    storyId: null,
    timeoutMs: 10000,
    minimumSteamScore: 0.9,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--input") args.input = argv[++i] || DEFAULT_INPUT;
    else if (arg === "--merge-input") args.mergeInput = argv[++i] || DEFAULT_MERGE_INPUT;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--output-json") args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
    else if (arg === "--output-md") args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    else if (arg === "--output-template") args.outputTemplate = argv[++i] || DEFAULT_OUTPUT_TEMPLATE;
    else if (arg === "--timeout-ms") args.timeoutMs = Math.max(1000, Number(argv[++i]) || 10000);
    else if (arg === "--minimum-steam-score") {
      args.minimumSteamScore = Math.min(1, Math.max(0.5, Number(argv[++i]) || 0.9));
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/official-search-intake-autofill.js --input <official-search-template.json> [options]",
      "",
      "Options:",
      "  --input <path>           Official search template JSON",
      "  --merge-input <path>     Existing source-family intake rows to preserve",
      "  --story-id <id>          Limit to one story",
      "  --output-json <path>     Write local report JSON",
      "  --output-md <path>       Write local report Markdown",
      "  --output-template <path> Write filled official-source intake template",
      "  --timeout-ms <n>         Per-provider metadata fetch timeout",
      "  --minimum-steam-score <n>",
      "                           Minimum exact/strong match score, default 0.9",
      "  --json                   Print JSON instead of Markdown",
      "",
      "This command only fetches official Steam storefront metadata and writes local reports/templates.",
      "It never downloads videos, uses yt-dlp, mutates the DB, touches OAuth, restarts services or posts.",
    ].join("\n") + "\n",
  );
}

function resolveFromRoot(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.output_template?.entries)) return payload.output_template.entries;
  return [];
}

async function readRows(filePath, storyId = null) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved || !(await fs.pathExists(resolved))) return [];
  const rows = rowsFromPayload(await fs.readJson(resolved));
  if (!storyId) return rows;
  return rows.filter((row) => String(row.story_id || "") === storyId);
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

  const entries = await readRows(args.input, args.storyId);
  const existingEntries = args.mergeInput ? await readRows(args.mergeInput, args.storyId) : [];
  const report = await buildOfficialSearchIntakeAutofillReport({
    entries,
    existingEntries,
    timeoutMs: args.timeoutMs,
    minimumSteamScore: args.minimumSteamScore,
  });
  const markdown = renderOfficialSearchIntakeAutofillMarkdown(report);
  await writeOutputs(args, report, markdown);
  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[official-search-intake-autofill] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  rowsFromPayload,
};
