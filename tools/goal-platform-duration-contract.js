#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  repairGoalPlatformDurationContracts,
  renderGoalPlatformDurationContractMarkdown,
  writeGoalPlatformDurationContractReport,
} = require("../lib/goal-platform-duration-contract");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    dryRunPlanPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-platform-duration-contract -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --story-packages <path>   Story package manifest",
    "  --dry-run-plan <path>      Strict dry-run plan for active/quarantined scope",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Repairs platform duration contracts only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readStoryPackages(root, explicitPath = null) {
  const filePath = explicitPath
    ? path.resolve(root, explicitPath)
    : path.join(root, "output", "goal-contract", "story-packages.json");
  const value = await fs.readJson(filePath);
  if (!Array.isArray(value)) throw new Error(`story package file is not an array: ${filePath}`);
  return value;
}

async function readJsonIfExists(filePath) {
  if (!filePath) return null;
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return null;
}

function activeStoryIdsFromDryRunPlan(plan = null) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  return [...new Set(actions.map((action) => String(action?.story_id || action?.storyId || "").trim()).filter(Boolean))];
}

function resolveActionArtifactDir(root, action = {}) {
  const candidates = [
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
    action.video_path,
    action.cover_frame_source,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const resolved = path.isAbsolute(value) ? value : path.resolve(root, value);
    return path.dirname(resolved);
  }
  return "";
}

function activeStoryPackageOverridesFromDryRunPlan(plan = null, root = process.cwd()) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const overrides = new Map();
  for (const action of actions) {
    const storyId = String(action?.story_id || action?.storyId || "").trim();
    if (!storyId || overrides.has(storyId)) continue;
    const artifactDir = resolveActionArtifactDir(root, action);
    if (!artifactDir) continue;
    overrides.set(storyId, {
      story_id: storyId,
      artifact_dir: artifactDir,
    });
  }
  return overrides;
}

function defaultDryRunPlanPathForArgs(args = {}, root = process.cwd()) {
  if (args.dryRunPlanPath) return path.resolve(root, args.dryRunPlanPath);
  if (args.storyPackagesPath) return null;
  return path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const storyPackages = await readStoryPackages(root, args.storyPackagesPath);
  const dryRunPlanPath = defaultDryRunPlanPathForArgs(args, root);
  const dryRunPlan = await readJsonIfExists(dryRunPlanPath);
  const report = await repairGoalPlatformDurationContracts({
    storyPackages,
    generatedAt: args.generatedAt || new Date().toISOString(),
    activeStoryIds: dryRunPlan ? activeStoryIdsFromDryRunPlan(dryRunPlan) : null,
    activeStoryPackageOverrides: dryRunPlan ? activeStoryPackageOverridesFromDryRunPlan(dryRunPlan, root) : null,
  });
  const artefacts = await writeGoalPlatformDurationContractReport(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalPlatformDurationContractMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-platform-duration-contract] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  activeStoryIdsFromDryRunPlan,
  activeStoryPackageOverridesFromDryRunPlan,
  defaultDryRunPlanPathForArgs,
  parseArgs,
  readStoryPackages,
  main,
};
