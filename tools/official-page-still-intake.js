#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const {
  buildOfficialPageStillIntakeEntries,
  fetchOfficialPageHtml,
} = require("../lib/official-page-still-intake");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_JSON = path.join(ROOT, "output", "goal-contract", "official_page_still_intake_entries.json");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyJsonPath: null,
    pageUrl: null,
    htmlPath: null,
    outputJson: DEFAULT_OUTPUT_JSON,
    maxAssets: 6,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-json") args.storyJsonPath = argv[++i] || null;
    else if (arg === "--page-url") args.pageUrl = argv[++i] || null;
    else if (arg === "--html") args.htmlPath = argv[++i] || null;
    else if (arg === "--output-json") args.outputJson = argv[++i] || args.outputJson;
    else if (arg === "--max-assets") args.maxAssets = Number(argv[++i] || args.maxAssets);
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run media:official-page-stills -- [options]",
    "",
    "Extracts official first-party product-page stills into official-source intake rows.",
    "This does not download media, mutate the DB, post to platforms, trigger OAuth or change tokens.",
    "",
    "Options:",
    "  --story-json <path>   Governed story/canonical manifest JSON",
    "  --page-url <url>      Official product/media page URL; defaults to story primary_source_url",
    "  --html <path>         Optional saved HTML fixture instead of fetching page URL",
    "  --output-json <path>  Output intake entries JSON",
    "  --max-assets <n>      Maximum still rows to emit",
    "  --json                Print JSON",
  ].join("\n");
}

async function readStory(storyJsonPath) {
  if (!storyJsonPath) throw new Error("--story-json is required");
  const parsed = await fs.readJson(path.resolve(ROOT, storyJsonPath));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function readHtml(args, pageUrl) {
  if (args.htmlPath) return fs.readFile(path.resolve(ROOT, args.htmlPath), "utf8");
  return fetchOfficialPageHtml(pageUrl);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const story = await readStory(args.storyJsonPath);
  const pageUrl = cleanText(args.pageUrl || story.primary_source_url || story.official_source_url);
  if (!pageUrl) throw new Error("--page-url is required when story JSON has no primary_source_url");
  const html = await readHtml(args, pageUrl);
  const entries = buildOfficialPageStillIntakeEntries({
    story,
    pageUrl,
    html,
    maxAssets: args.maxAssets,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const outputJson = path.resolve(ROOT, args.outputJson);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.writeJson(outputJson, entries, { spaces: 2 });
  if (args.json) console.log(JSON.stringify({ entries, output_json: outputJson }, null, 2));
  else {
    console.log(`Official page still intake rows: ${entries.length}`);
    console.log(`Output: ${outputJson}`);
  }
  return { args, entries, outputJson };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[official-page-still-intake] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
