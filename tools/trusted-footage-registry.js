#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  buildTrustedFootageRegistryReport,
  renderTrustedFootageRegistryMarkdown,
} = require("../lib/trusted-footage-registry");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_REGISTRY = path.join(ROOT, "config", "trusted-footage-registry.json");
const DEFAULT_OUTPUT_JSON = path.join(OUT, "trusted_footage_registry_report.json");
const DEFAULT_OUTPUT_MD = path.join(OUT, "trusted_footage_registry_report.md");

function parseArgs(argv) {
  const args = {
    registry: null,
    stories: null,
    storyId: null,
    fixture: false,
    json: false,
    help: false,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--registry" || arg === "--input") args.registry = argv[++i] || null;
    else if (arg === "--stories") args.stories = argv[++i] || null;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--output-json") args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
    else if (arg === "--output-md") args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }

  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/trusted-footage-registry.js --registry <json> [options]",
      "",
      "Options:",
      "  --registry <p>    JSON array or object with entries/items/sources",
      "  --stories <p>     Optional local story JSON file",
      "  --story-id <id>   Limit story matching to one story id",
      "  --fixture         Use built-in demo stories when local DB is unavailable",
      "  --output-json <p> Write local JSON report",
      "  --output-md <p>   Write local Markdown report",
      "  --json            Print JSON instead of Markdown",
      "",
      "This command is autonomous and local report-only. It plans trusted source use, local transcript packs and timeline self-eval artefacts, but never downloads media, extracts frames, mutates the DB, triggers OAuth, calls cloud transcription or posts.",
    ].join("\n") + "\n",
  );
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    downloaded_images: Array.isArray(row.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row.downloaded_images) || [],
    game_images: Array.isArray(row.game_images) ? row.game_images : parseJsonField(row.game_images) || [],
    media_candidates: Array.isArray(row.media_candidates)
      ? row.media_candidates
      : parseJsonField(row.media_candidates) || [],
    igdb_assets: Array.isArray(row.igdb_assets) ? row.igdb_assets : parseJsonField(row.igdb_assets) || [],
  };
}

async function loadStories(args) {
  if (args.stories) {
    const payload = await fs.readJson(path.resolve(ROOT, args.stories));
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.stories)
        ? payload.stories
        : Array.isArray(payload.items)
          ? payload.items
          : [payload];
    return rows.map(normaliseStory).filter((story) => !args.storyId || story.id === args.storyId);
  }

  if (args.fixture) {
    const stories = buildDemoStories();
    return args.storyId ? stories.filter((story) => story.id === args.storyId) : stories;
  }

  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    if (args.storyId) return rows.filter((story) => story.id === args.storyId);
    return rows;
  } catch {
    const stories = buildDemoStories();
    return args.storyId ? stories.filter((story) => story.id === args.storyId) : stories;
  }
}

async function loadRegistry(registryPath) {
  const resolved = path.resolve(ROOT, registryPath || DEFAULT_REGISTRY);
  if (!(await fs.pathExists(resolved))) return [];
  const payload = await fs.readJson(resolved);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.sources)) return payload.sources;
  return [payload];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const stories = await loadStories(args);
  const entries = await loadRegistry(args.registry);
  const report = buildTrustedFootageRegistryReport({ stories, entries });
  const markdown = renderTrustedFootageRegistryMarkdown(report);

  await fs.ensureDir(path.dirname(path.resolve(ROOT, args.outputJson)));
  await fs.ensureDir(path.dirname(path.resolve(ROOT, args.outputMd)));
  await fs.writeJson(path.resolve(ROOT, args.outputJson), report, { spaces: 2 });
  await fs.writeFile(path.resolve(ROOT, args.outputMd), markdown);

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[trusted-footage-registry] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};
