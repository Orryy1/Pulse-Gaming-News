#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildStudioGovernanceReport,
  writeStudioGovernanceArtifacts,
} = require("../lib/studio-governance-engine");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv) {
  const args = {
    json: false,
    help: false,
    storyFile: null,
    storyId: null,
    rightsLedger: null,
    commercialManifest: null,
    recentFile: null,
    outDir: null,
    generatedAt: null,
  };
  const items = argv.slice(2);
  for (let i = 0; i < items.length; i += 1) {
    const arg = items[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-file") args.storyFile = items[++i] || null;
    else if (arg.startsWith("--story-file=")) args.storyFile = arg.slice("--story-file=".length);
    else if (arg === "--story-id" || arg === "--story") args.storyId = items[++i] || null;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--rights-ledger") args.rightsLedger = items[++i] || null;
    else if (arg.startsWith("--rights-ledger=")) args.rightsLedger = arg.slice("--rights-ledger=".length);
    else if (arg === "--commercial-manifest") args.commercialManifest = items[++i] || null;
    else if (arg.startsWith("--commercial-manifest=")) args.commercialManifest = arg.slice("--commercial-manifest=".length);
    else if (arg === "--recent-file") args.recentFile = items[++i] || null;
    else if (arg.startsWith("--recent-file=")) args.recentFile = arg.slice("--recent-file=".length);
    else if (arg === "--out-dir") args.outDir = items[++i] || null;
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--generated-at") args.generatedAt = items[++i] || null;
    else if (arg.startsWith("--generated-at=")) args.generatedAt = arg.slice("--generated-at=".length);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-governance.js --story-file story.json [options]",
      "",
      "Options:",
      "  --story-id ID                 Load a story from the local DB instead of --story-file",
      "  --rights-ledger rights.json    Rights ledger JSON array/object",
      "  --commercial-manifest file     Affiliate/commercial manifest JSON",
      "  --recent-file recent.json      Recent videos/stories JSON array/object",
      "  --out-dir DIR                  Output directory for governance artefacts",
      "  --generated-at ISO             Deterministic report timestamp",
      "  --json                         Emit JSON report",
      "",
      "Writes publish_manifest.json, risk_report.json, rejection_reasons.json, correction_plan.json and audit_log.json.",
    ].join("\n") + "\n",
  );
}

async function readJsonFile(filePath, fallback = null) {
  if (!filePath) return fallback;
  const raw = await fs.readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw);
}

async function loadStory(args) {
  if (args.storyFile) return readJsonFile(args.storyFile);
  if (!args.storyId) {
    throw new Error("studio-governance requires --story-file or --story-id");
  }
  const db = require("../lib/db");
  const stories = await db.getStories();
  const story = stories.find((item) => String(item.id || "") === String(args.storyId));
  if (!story) throw new Error(`story not found: ${args.storyId}`);
  return story;
}

function storyOutputDir(story = {}, explicitOutDir) {
  if (explicitOutDir) return path.resolve(explicitOutDir);
  const safeId =
    String(story.id || "story")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "story";
  return path.join(ROOT, "output", "governance", safeId);
}

async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const story = await loadStory(args);
  const rightsLedger = await readJsonFile(args.rightsLedger, undefined);
  const commercialManifest = await readJsonFile(args.commercialManifest, undefined);
  const recent = await readJsonFile(args.recentFile, []);
  const recentVideos = Array.isArray(recent) ? recent : recent?.recentVideos || recent?.stories || [];

  const report = buildStudioGovernanceReport({
    story,
    rightsLedger,
    commercialManifest,
    recentVideos,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const outDir = storyOutputDir(story, args.outDir);
  const written = await writeStudioGovernanceArtifacts(report, { outputDir: outDir });
  report.outputs = written;

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        `Studio Governance: ${report.publish_manifest.publish_status}`,
        `Story: ${report.story_id || "(unknown)"}`,
        `Reasons: ${report.rejection_reasons.reason_codes.join(", ") || "none"}`,
        `Output: ${outDir}`,
      ].join("\n") + "\n",
    );
  }

  return {
    exitCode: report.publish_manifest.publish_status === "GREEN" ? 0 : 2,
    report,
    outputs: written,
  };
}

if (require.main === module) {
  require("dotenv").config({ override: true });
  runCli().then((result) => {
    process.exitCode = result.exitCode;
  }).catch((err) => {
    process.stderr.write(`[studio-governance] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  runCli,
};
