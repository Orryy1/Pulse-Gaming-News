#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  refreshBridgeCandidateMetadata,
} = require("../lib/bridge-candidate-metadata-refresh");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BRIDGE = path.join(ROOT, "output", "goal-contract", "scheduler_bridge_candidates.json");
const DEFAULT_OUT = path.join(ROOT, "output", "goal-contract");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    bridgePath: DEFAULT_BRIDGE,
    outDir: DEFAULT_OUT,
    storyIds: [],
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bridge") args.bridgePath = argv[++i] || args.bridgePath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--story-id") {
      const storyId = argv[++i];
      if (storyId) args.storyIds.push(storyId);
    } else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(arg.slice("--story-id=".length));
    } else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:bridge-candidate-metadata-refresh -- [options]",
    "",
    "Options:",
    "  --bridge <path>       Scheduler bridge candidates JSON",
    "  --story-id <id>       Refresh one story; repeatable",
    "  --out-dir <dir>       Report output directory",
    "  --generated-at <iso>  Fixed timestamp",
    "  --apply               Rewrite the bridge candidates JSON",
    "  --json                Print JSON",
    "",
    "Refreshes bridge candidate duration metadata from current render/audio manifests.",
    "It does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Bridge Candidate Metadata Refresh",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Mode: ${report.mode || "unknown"}`,
    `Bridge: ${report.bridge_path || "unknown"}`,
    "",
    "## Summary",
    `- candidates: ${report.summary?.candidate_count || 0}`,
    `- inspected: ${report.summary?.inspected_count || 0}`,
    `- refreshed: ${report.summary?.refreshed_count || 0}`,
    `- blocked: ${report.summary?.blocked_count || 0}`,
    "",
    "## Rows",
  ];
  if (!report.rows?.length) lines.push("- none");
  for (const row of report.rows || []) {
    lines.push(`- ${row.story_id || "unknown"}: ${row.action || "unknown"}`);
    if (row.before || row.after) {
      lines.push(`  duration: ${row.before?.duration_seconds ?? "n/a"} -> ${row.after?.duration_seconds ?? "n/a"}`);
    }
    if (row.blockers?.length) lines.push(`  blockers: ${row.blockers.join(", ")}`);
  }
  lines.push("");
  lines.push("Safety: no publish, network upload, DB mutation, OAuth change, token change or gate weakening.");
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = await refreshBridgeCandidateMetadata({
    bridgePath: path.resolve(args.bridgePath),
    storyIds: args.storyIds,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apply: args.apply,
  });
  const outDir = path.resolve(args.outDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "bridge_candidate_metadata_refresh_report.json");
  const mdPath = path.join(outDir, "bridge_candidate_metadata_refresh_report.md");
  const markdown = renderMarkdown(report);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(markdown.trimEnd());
  return { report, jsonPath, mdPath };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[bridge-candidate-metadata-refresh] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
  usage,
};
