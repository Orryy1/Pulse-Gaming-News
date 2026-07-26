#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false });
}

const {
  buildPulseAvatarIdentitySystem,
  renderPulseAvatarIdentityMarkdown,
  writePulseAvatarIdentitySystem,
} = require("../lib/pulse-avatar-identity-system");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    channelId: "pulse-gaming",
    outDir: path.join(ROOT, "output", "pulse-avatar-identity"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--channel") args.channelId = argv[++index] || args.channelId;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:pulse-avatar-identity -- [options]",
    "",
    "Options:",
    "  --story-packages <path>  Story package manifest",
    "  --channel <id>           Channel config id, default pulse-gaming",
    "  --out-dir <dir>          Output directory for identity artefacts",
    "  --workspace <dir>        Workspace root for relative paths",
    "  --generated-at <iso>     Fixed timestamp for deterministic reports",
    "  --json                   Print JSON report",
    "",
    "LOCAL_PROOF only. This command builds Pulse-owned non-photorealistic identity rules and story segment assignments. It does not generate images, publish, post externally, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function loadChannelConfig(channelId) {
  const safeId = String(channelId || "pulse-gaming").replace(/[^a-z0-9_-]/gi, "");
  try {
    return require(path.join(ROOT, "channels", `${safeId}.js`));
  } catch {
    return {};
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const report = await buildPulseAvatarIdentitySystem({
    storyPackages,
    channelConfig: loadChannelConfig(args.channelId),
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writePulseAvatarIdentitySystem(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderPulseAvatarIdentityMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[pulse-avatar-identity-system] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
