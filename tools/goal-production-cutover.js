#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildProductionRenderCutoverPlan,
  writeProductionRenderCutoverPlan,
} = require("../lib/goal-production-cutover");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    storyPackagesPaths: [path.join(ROOT, "output", "goal-contract", "story-packages.json")],
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  let customStoryPackages = false;
  function addStoryPackagesPath(value) {
    const paths = String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!paths.length) return;
    if (!customStoryPackages) {
      args.storyPackagesPaths = [];
      customStoryPackages = true;
    }
    args.storyPackagesPaths.push(...paths);
    args.storyPackagesPath = args.storyPackagesPaths[0];
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") addStoryPackagesPath(argv[++i] || args.storyPackagesPath);
    else if (arg.startsWith("--story-packages=")) addStoryPackagesPath(arg.slice("--story-packages=".length));
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-production-cutover -- [options]",
    "",
    "Options:",
    "  --story-packages <path>   Story package manifest to inspect",
    "  --out-dir <dir>           Output directory for cutover reports",
    "  --generated-at <iso>      Fixed timestamp for deterministic reports",
    "  --json                    Print JSON summary",
  ].join("\n");
}

async function readStoryPackages(filePath) {
  if (!(await fs.pathExists(filePath))) return [];
  const value = await fs.readJson(filePath);
  return Array.isArray(value) ? value : [];
}

function storyPackageKey(entry = {}, index = 0) {
  return String(entry.story_id || entry.id || entry.artifact_dir || `story-package-${index}`).trim();
}

function dedupeStoryPackages(storyPackages = []) {
  const byKey = new Map();
  for (const [index, entry] of storyPackages.entries()) {
    if (!entry || typeof entry !== "object") continue;
    byKey.set(storyPackageKey(entry, index), entry);
  }
  return [...byKey.values()];
}

async function readStoryPackagesFromFiles(filePaths = []) {
  const all = [];
  for (const filePath of filePaths) {
    const rows = await readStoryPackages(path.resolve(filePath));
    all.push(...rows);
  }
  return dedupeStoryPackages(all);
}

function renderMarkdown(plan = {}) {
  const lines = [];
  lines.push("# Production Render Cutover");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || ""}`);
  lines.push(`Ready final renders: ${plan.summary?.ready_final_render_count || 0}`);
  lines.push(`Queued final renders: ${plan.summary?.queued_final_render_count || 0}`);
  lines.push(`Queue input-ready: ${plan.summary?.final_render_input_ready_count || 0}`);
  lines.push(`Queue input-blocked: ${plan.summary?.final_render_input_blocked_count || 0}`);
  lines.push(`Scheduler bridge candidates: ${plan.summary?.scheduler_bridge_candidate_count || 0}`);
  lines.push(`Blocked: ${plan.summary?.blocked_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No publishing was triggered.");
  lines.push("- No local proof render is promoted to final.");
  lines.push("- No database, token or OAuth mutation is performed.");
  lines.push("");
  if (Array.isArray(plan.queue) && plan.queue.length) {
    lines.push("## Next Render Queue");
    for (const item of plan.queue.slice(0, 10)) {
      const inputBlockers = Array.isArray(item.render_input_blockers)
        ? item.render_input_blockers.slice(0, 4)
        : [];
      const suffix = inputBlockers.length ? `; inputs blocked: ${inputBlockers.join(", ")}` : "";
      lines.push(`- ${item.story_id}: ${item.title}${suffix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const outDir = path.resolve(args.outDir);
  const storyPackages = await readStoryPackagesFromFiles(args.storyPackagesPaths || [args.storyPackagesPath]);
  const plan = await buildProductionRenderCutoverPlan({
    storyPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeProductionRenderCutoverPlan(plan, { outputDir: outDir });
  const combinedStoryPackagesPath = path.join(outDir, "production_cutover_story_packages.json");
  await fs.writeJson(combinedStoryPackagesPath, storyPackages, { spaces: 2 });
  written.combinedStoryPackagesPath = combinedStoryPackagesPath;
  const markdownPath = path.join(outDir, "production_render_cutover_plan.md");
  await fs.writeFile(markdownPath, renderMarkdown(plan), "utf8");
  written.markdownPath = markdownPath;

  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(renderMarkdown(plan).trimEnd());
  return { plan, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-production-cutover] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  dedupeStoryPackages,
  main,
  parseArgs,
  renderMarkdown,
};
