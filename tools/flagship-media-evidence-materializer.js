#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  createTrustedRenderInputInventory,
  materializeFlagshipMediaEvidence,
  renderFlagshipMediaEvidenceSummary,
} = require("../lib/flagship-media-evidence-materializer");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    packageDir: "",
    inventoryPath: "",
    outDir: "",
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--package-dir") args.packageDir = argv[++index] || "";
    else if (arg.startsWith("--package-dir=")) args.packageDir = arg.slice("--package-dir=".length);
    else if (arg === "--inventory") args.inventoryPath = argv[++index] || "";
    else if (arg.startsWith("--inventory=")) args.inventoryPath = arg.slice("--inventory=".length);
    else if (arg === "--out-dir") args.outDir = argv[++index] || "";
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg.startsWith("--generated-at=")) args.generatedAt = arg.slice("--generated-at=".length) || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/flagship-media-evidence-materializer.js --package-dir <dir> --inventory <file> --out-dir <dir> [options]",
    "",
    "Materialises file-backed flagship media evidence from an immutable package and explicit used-asset inventory.",
    "Local proof only: never publishes or mutates databases, tokens, OAuth state or live outputs.",
    "The proof output directory must be outside the immutable package directory.",
    "",
    "Required:",
    "  --package-dir <dir>   Immutable package containing every declared input and evidence file",
    "  --inventory <file>    Explicit used-asset inventory JSON",
    "  --out-dir <dir>       Separate local proof output directory",
    "",
    "Options:",
    "  --generated-at <iso>  Fixed report timestamp",
    "  --json                Print machine-readable evidence",
    "  --help                Show this help",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (["materialize", "readJson"].some((key) => Object.hasOwn(dependencies, key))) {
    throw new Error("CLI verifier dependency injection is forbidden");
  }
  const args = parseArgs(argv);
  const stdout = dependencies.stdout || ((value) => process.stdout.write(String(value)));
  if (args.help) {
    stdout(`${usage()}\n`);
    return { help: true };
  }
  if (!args.packageDir) throw new Error("--package-dir is required");
  if (!args.inventoryPath) throw new Error("--inventory is required");
  if (!args.outDir) throw new Error("--out-dir is required");

  const cwd = path.resolve(dependencies.cwd || process.cwd());
  const packageDir = path.resolve(cwd, args.packageDir);
  const inventoryPath = path.resolve(cwd, args.inventoryPath);
  const outputDir = path.resolve(cwd, args.outDir);
  const inventory = await fs.readJson(inventoryPath);
  const trustedRenderInputs = await createTrustedRenderInputInventory({ packageDir, inventory });
  const report = await materializeFlagshipMediaEvidence({
    packageDir,
    inventory,
    outputDir,
    generatedAt: args.generatedAt || new Date().toISOString(),
    trustedRenderInputs,
  });
  if (args.json) {
    stdout(`${JSON.stringify({ ...report, publish_ready: false }, null, 2)}\n`);
  } else {
    stdout(renderFlagshipMediaEvidenceSummary({ ...report, publish_ready: false }));
  }
  return { report, written: report.written || null };
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const exit = dependencies.exit || ((code) => { process.exitCode = code; });
  const stderr = dependencies.stderr || ((value) => process.stderr.write(`${value}\n`));
  try {
    const result = await main(argv, dependencies);
    const evidenceComplete = result?.help === true || (
      result?.report?.complete === true &&
      String(result?.report?.verdict || "").toUpperCase() === "GREEN"
    );
    exit(evidenceComplete ? 0 : 2);
    return result;
  } catch (error) {
    stderr(`[flagship-media-evidence-materializer] FAILED: ${error.stack || error.message}`);
    exit(1);
    return null;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  main,
  parseArgs,
  runCli,
  usage,
};
