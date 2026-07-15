#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  REQUIRED_SYSTEMS,
  REQUIRED_ARTEFACTS,
  REQUIRED_TESTS,
  buildGoalContractReport,
  renderGoalContractMarkdown,
  writeGoalContractArtifacts,
} = require("../lib/goal-contract");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    storyPackagesPath: null,
    flagshipMediaPortfolioPath: null,
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--flagship-media-portfolio") {
      args.flagshipMediaPortfolioPath = argv[++i] || "";
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root to scan",
    "  --out-dir <dir>           Output directory for goal artefacts",
    "  --story-packages <path>   Optional 30-story package manifest",
    "  --flagship-media-portfolio <path>  Raw materialised flagship portfolio manifest",
    "  --generated-at <iso>      Fixed timestamp for deterministic reports",
    "  --json                    Print JSON instead of Markdown",
  ].join("\n");
}

async function pathExists(root, relativePath) {
  return fs.pathExists(path.join(root, relativePath));
}

async function buildModuleIndex(root) {
  const modules = new Set(REQUIRED_SYSTEMS.flatMap((system) => system.modules));
  const entries = {};
  for (const modulePath of modules) {
    entries[modulePath] = await pathExists(root, modulePath);
  }
  return entries;
}

async function walkFiles(dir, { filesystem = fs } = {}) {
  if (!(await filesystem.pathExists(dir))) return [];
  const out = [];
  const pending = [path.resolve(dir)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const entries = await filesystem.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink?.()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else out.push(fullPath);
    }
  }
  return out;
}

async function findRequiredArtefactNames(root, requiredNames, { filesystem = fs } = {}) {
  const found = new Set();
  const pending = [
    path.join(root, "output"),
    path.join(root, "test", "output"),
  ];
  const visited = new Set();
  while (pending.length && found.size < requiredNames.size) {
    const current = path.resolve(pending.pop());
    if (visited.has(current) || !(await filesystem.pathExists(current))) continue;
    visited.add(current);
    const entries = await filesystem.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink?.()) continue;
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else if (requiredNames.has(entry.name)) found.add(entry.name);
    }
  }
  return found;
}

async function buildArtefactIndex(root, { filesystem = fs } = {}) {
  const requiredNames = new Set([
    ...REQUIRED_ARTEFACTS,
    ...REQUIRED_SYSTEMS.flatMap((system) => system.outputs || []),
  ]);
  const names = await findRequiredArtefactNames(root, requiredNames, { filesystem });
  const entries = {};
  for (const artefact of requiredNames) entries[artefact] = names.has(artefact);
  return entries;
}

async function buildTestIndex(root) {
  const testFiles = await walkFiles(path.join(root, "tests"));
  const testText = (
    await Promise.all(
      testFiles
        .filter((file) => /\.test\.js$/i.test(file))
        .map(async (file) => {
          try {
            return fs.readFile(file, "utf8");
          } catch {
            return "";
          }
        }),
    )
  ).join("\n");
  const entries = {};
  for (const testId of REQUIRED_TESTS) {
    const marker = new RegExp(`(?:^|\\n)\\s*//\\s*goal-test:${testId}\\b`);
    entries[testId] = marker.test(testText);
  }
  return entries;
}

async function readStoryPackages(root, explicitPath = null) {
  const candidates = [
    explicitPath,
    path.join(root, "output", "goal-contract", "story-packages.json"),
    path.join(root, "test", "output", "goal_story_packages.json"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (await fs.pathExists(candidate)) {
        const value = await fs.readJson(candidate);
        return Array.isArray(value) ? value : [];
      }
    } catch {
      return [];
    }
  }
  return [];
}

async function readFlagshipMediaPortfolio(explicitPath = null) {
  if (!explicitPath) return null;
  return fs.readJson(explicitPath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const outDir = path.resolve(args.outDir);
  const storyPackagesPath = args.storyPackagesPath
    ? path.resolve(args.storyPackagesPath)
    : null;
  const flagshipMediaPortfolioPath = args.flagshipMediaPortfolioPath
    ? path.resolve(args.flagshipMediaPortfolioPath)
    : null;

  const [
    moduleIndex,
    artefactIndex,
    testIndex,
    storyPackages,
    flagshipMediaPortfolio,
  ] = await Promise.all([
    buildModuleIndex(root),
    buildArtefactIndex(root),
    buildTestIndex(root),
    readStoryPackages(root, storyPackagesPath),
    readFlagshipMediaPortfolio(flagshipMediaPortfolioPath),
  ]);

  const report = await buildGoalContractReport({
    generatedAt: args.generatedAt || new Date().toISOString(),
    moduleIndex,
    artefactIndex,
    testIndex,
    storyPackages,
    flagshipMediaPortfolio,
    flagshipMediaPortfolioOptions: { workspaceRoot: root },
  });
  const artefacts = await writeGoalContractArtifacts(report, { outputDir: outDir });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalContractMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[run-goal] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
  buildModuleIndex,
  buildArtefactIndex,
  buildTestIndex,
  readStoryPackages,
  readFlagshipMediaPortfolio,
};
