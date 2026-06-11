#!/usr/bin/env node
"use strict";

const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  DEFAULT_REQUIRED_ROLES,
  buildElevenLabsSfxGovernanceEngine,
  renderElevenLabsSfxGovernanceMarkdown,
  writeElevenLabsSfxGovernanceEngine,
} = require("../lib/elevenlabs-sfx-governance-engine");

const ROOT = path.resolve(__dirname, "..");

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    roots: [path.join(ROOT, "audio", "elevenlabs", "sfx")],
    sidecarPaths: [],
    requiredRoles: DEFAULT_REQUIRED_ROLES,
    outDir: path.join(ROOT, "output", "elevenlabs-sfx-governance"),
    workspaceRoot: ROOT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.roots = [argv[++index] || args.roots[0]];
    else if (arg === "--roots") args.roots = splitList(argv[++index]);
    else if (arg === "--sidecar") args.sidecarPaths.push(argv[++index]);
    else if (arg === "--sidecars") args.sidecarPaths.push(...splitList(argv[++index]));
    else if (arg === "--required-roles") args.requiredRoles = splitList(argv[++index]);
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
    "Usage: npm run ops:elevenlabs-sfx-governance -- [options]",
    "",
    "Options:",
    "  --root <dir>              Root containing *.elevenlabs-sfx.json sidecars",
    "  --roots <a,b>             Comma-separated roots to scan",
    "  --sidecar <path>          Explicit sidecar path, repeatable",
    "  --sidecars <a,b>          Comma-separated sidecar paths",
    "  --required-roles <a,b>    Required generated SFX roles",
    "  --out-dir <dir>           Output directory for proof artefacts",
    "  --workspace <dir>         Workspace root for relative paths",
    "  --generated-at <iso>      Fixed timestamp for deterministic reports",
    "  --json                    Print JSON report",
    "",
    "LOCAL_PROOF only. This command validates retained ElevenLabs SFX sidecars and writes governance reports. It does not call ElevenLabs, generate audio, publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = await buildElevenLabsSfxGovernanceEngine({
    workspaceRoot: path.resolve(args.workspaceRoot),
    roots: args.roots,
    sidecarPaths: args.sidecarPaths,
    requiredRoles: args.requiredRoles,
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeElevenLabsSfxGovernanceEngine(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderElevenLabsSfxGovernanceMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[elevenlabs-sfx-governance] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
