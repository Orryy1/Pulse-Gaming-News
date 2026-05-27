#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal22VersionedPromptModelRegistry,
  renderGoal22VersionedPromptModelRegistryMarkdown,
  writeGoal22VersionedPromptModelRegistry,
} = require("../lib/goal22-versioned-prompt-model-registry");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamObservabilityReportPath: path.join(ROOT, "output", "goal-21", "goal21_readiness_report.json"),
    outDir: path.join(ROOT, "output", "goal-22"),
    workspaceRoot: ROOT,
    generatedAt: null,
    gitCommit: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-observability-report") args.upstreamObservabilityReportPath = argv[++index] || args.upstreamObservabilityReportPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--git-commit") args.gitCommit = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal22-versioned-prompt-model-registry -- [options]",
    "",
    "Options:",
    "  --story-packages <path>                  Story package manifest",
    "  --upstream-observability-report <path>   Goal 21 readiness report",
    "  --out-dir <dir>                          Output directory for Goal 22 proof",
    "  --workspace <dir>                        Workspace root for relative package paths",
    "  --generated-at <iso>                     Fixed timestamp for deterministic reports",
    "  --git-commit <sha>                       Override git commit for deterministic tests",
    "  --json                                   Print JSON report",
    "",
    "LOCAL_PROOF only. This command compiles production audit, model/prompt registry and video lineage artefacts from existing proof files. It does not publish, post externally, mutate production rows, touch OAuth/token settings or inspect secrets.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function runGit(args, cwd) {
  try {
    return childProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function resolveGitContext(workspaceRoot, overrideCommit = null) {
  const commit = overrideCommit || runGit(["rev-parse", "HEAD"], workspaceRoot) || null;
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot) || null;
  const status = runGit(["status", "--short"], workspaceRoot);
  return {
    commit,
    branch,
    dirty: Boolean(status),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const workspaceRoot = path.resolve(args.workspaceRoot);
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const upstreamObservabilityReport = await readJsonIfPresent(path.resolve(args.upstreamObservabilityReportPath), {});
  const report = await buildGoal22VersionedPromptModelRegistry({
    storyPackages,
    upstreamObservabilityReport,
    workspaceRoot,
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
    gitContext: resolveGitContext(workspaceRoot, args.gitCommit),
  });
  const written = await writeGoal22VersionedPromptModelRegistry(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal22VersionedPromptModelRegistryMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal22-versioned-prompt-model-registry] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  resolveGitContext,
  usage,
};
