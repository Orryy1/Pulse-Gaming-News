#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const {
  runRevenuePathEngine,
} = require("../lib/revenue-path-engine");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    commercialManifestDir: path.join(ROOT, "output", "commercial"),
    clickLogPath: path.join(ROOT, "data", "commercial_clicks.jsonl"),
    outputDir: path.join(ROOT, "output", "revenue"),
    storiesPath: path.join(ROOT, "daily_news.json"),
    retentionIntelligencePath: null,
    generatedAt: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--commercial-dir") {
      options.commercialManifestDir = path.resolve(argv[++i]);
    } else if (arg === "--click-log") {
      options.clickLogPath = path.resolve(argv[++i]);
    } else if (arg === "--out-dir") {
      options.outputDir = path.resolve(argv[++i]);
    } else if (arg === "--stories") {
      options.storiesPath = path.resolve(argv[++i]);
    } else if (arg === "--retention-intelligence") {
      options.retentionIntelligencePath = path.resolve(argv[++i]);
    } else if (arg === "--generated-at") {
      options.generatedAt = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run ops:revenue-paths -- [options]",
    "",
    "Options:",
    "  --commercial-dir <dir>   Directory with affiliate link manifests",
    "  --click-log <path>        Privacy-safe commercial click log",
    "  --out-dir <dir>           Output directory for revenue path manifests",
    "  --stories <path>          Story JSON file for titles and view counts",
    "  --retention-intelligence <path>",
    "                            Retention intelligence JSON to shape commercial posture",
    "  --generated-at <iso>      Fixed generated timestamp for tests",
  ].join("\n");
}

async function readRetentionIntelligence(filePath) {
  if (!filePath) return {};
  try {
    return await fs.readJson(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw err;
  }
}

async function readStories(storiesPath) {
  try {
    const parsed = await fs.readJson(storiesPath);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { help: true };
  }

  const stories = await readStories(options.storiesPath);
  const retentionIntelligenceByStory = await readRetentionIntelligence(
    options.retentionIntelligencePath,
  );
  const result = await runRevenuePathEngine({
    generatedAt: options.generatedAt || new Date().toISOString(),
    commercialManifestDirs: [options.commercialManifestDir],
    clickLogPath: options.clickLogPath,
    outputDir: options.outputDir,
    stories,
    retentionIntelligenceByStory,
  });
  return {
    digest: result.digest,
    artefacts: {
      json: path.relative(ROOT, result.artefacts.jsonPath),
      md: path.relative(ROOT, result.artefacts.mdPath),
    },
  };
}

if (require.main === module) {
  main()
    .then((result) => {
      if (result.help) return;
      console.log(`[revenue-paths] status=${result.digest.status}`);
      console.log(`[revenue-paths] paths=${result.digest.totals.paths}`);
      console.log(`[revenue-paths] pass=${result.digest.totals.pass}`);
      console.log(`[revenue-paths] review=${result.digest.totals.review}`);
      console.log(`[revenue-paths] blocked=${result.digest.totals.blocked_for_compliance}`);
      console.log(`[revenue-paths] md=${result.artefacts.md}`);
      console.log(`[revenue-paths] json=${result.artefacts.json}`);
    })
    .catch((err) => {
      console.error(`[revenue-paths] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  main,
  parseArgs,
  readRetentionIntelligence,
};
