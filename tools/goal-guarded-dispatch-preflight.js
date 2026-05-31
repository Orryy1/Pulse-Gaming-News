#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGuardedDispatchPreflight,
  renderGuardedDispatchPreflightMarkdown,
  writeGuardedDispatchPreflight,
} = require("../lib/goal-guarded-dispatch-preflight");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    approvalGateReportPath: null,
    strictDryRunPlanPath: null,
    platformStatusMatrixPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--approval-gate-report") args.approvalGateReportPath = argv[++i] || "";
    else if (arg === "--strict-dry-run-plan") args.strictDryRunPlanPath = argv[++i] || "";
    else if (arg === "--platform-status-matrix") args.platformStatusMatrixPath = argv[++i] || "";
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
    "Usage: npm run ops:goal-guarded-dispatch-preflight -- [options]",
    "",
    "Options:",
    "  --root <dir>                    Workspace root",
    "  --approval-gate-report <path>    human_review_approval_gate_report.json",
    "  --strict-dry-run-plan <path>     dry_run_publish_plan.json",
    "  --platform-status-matrix <path>  platform_status_matrix.json",
    "  --out-dir <dir>                  Output directory",
    "  --generated-at <iso>             Fixed timestamp",
    "  --json                           Print JSON",
    "",
    "Final no-posting preflight for operator-approved HUMAN_REVIEW actions.",
    "This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const approvalGateReportPath = args.approvalGateReportPath
    ? path.resolve(root, args.approvalGateReportPath)
    : path.join(root, "output", "goal-contract", "human_review_approval_gate_report.json");
  const strictDryRunPlanPath = args.strictDryRunPlanPath
    ? path.resolve(root, args.strictDryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const platformStatusMatrixPath = args.platformStatusMatrixPath
    ? path.resolve(root, args.platformStatusMatrixPath)
    : path.join(root, "output", "goal-contract", "platform_status_matrix.json");

  const report = buildGuardedDispatchPreflight({
    approvalGateReport: await readJson(approvalGateReportPath, "human review approval gate report"),
    strictDryRunPlan: await readJson(strictDryRunPlanPath, "strict dry-run plan"),
    platformStatusMatrix: await readJson(platformStatusMatrixPath, "platform status matrix"),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGuardedDispatchPreflight(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedDispatchPreflightMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-guarded-dispatch-preflight] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
