#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildHumanReviewConsole,
  renderHumanReviewConsoleHtml,
  writeHumanReviewConsole,
} = require("../lib/goal-human-review-console");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    operatorIndexPath: null,
    strictDryRunPlanPath: null,
    strictDryRunPlanEnabled: true,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--operator-index") args.operatorIndexPath = argv[++i] || "";
    else if (arg === "--strict-dry-run-plan") args.strictDryRunPlanPath = argv[++i] || "";
    else if (arg === "--no-strict-dry-run-plan") args.strictDryRunPlanEnabled = false;
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
    "Usage: npm run ops:goal-human-review-console -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --operator-index <path>   human_review_operator_index.json",
    "  --strict-dry-run-plan <path> dry_run_publish_plan.json freshness source",
    "  --no-strict-dry-run-plan  Disable strict dry-run freshness comparison",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Builds a local-only HTML/JSON human review console. It cannot approve, publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function readOptionalJson(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const operatorIndexPath = args.operatorIndexPath
    ? path.resolve(root, args.operatorIndexPath)
    : path.join(root, "output", "goal-contract", "human_review_operator_index.json");
  const strictDryRunPlanPath = args.strictDryRunPlanPath
    ? path.resolve(root, args.strictDryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const consoleBundle = buildHumanReviewConsole({
    operatorIndex: await readJson(operatorIndexPath, "human review operator index"),
    strictDryRunPlan: args.strictDryRunPlanEnabled
      ? await readOptionalJson(strictDryRunPlanPath)
      : null,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeHumanReviewConsole(consoleBundle, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(consoleBundle, null, 2));
  else {
    console.log("Human review console written.");
    console.log(`JSON: ${artefacts.jsonPath}`);
    console.log(`HTML: ${artefacts.htmlPath}`);
    console.log("This tool does not approve, publish, mutate DB rows or touch OAuth/token settings.");
    if (!args.json && process.env.PULSE_PRINT_REVIEW_HTML === "1") {
      console.log(renderHumanReviewConsoleHtml(consoleBundle));
    }
  }
  return { consoleBundle, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-console] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
