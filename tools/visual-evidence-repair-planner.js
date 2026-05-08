#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildVisualEvidenceRepairPlan,
  renderVisualEvidenceRepairMarkdown,
} = require("../lib/ops/visual-evidence-repair-planner");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FLASH_STATE = path.join(OUT, "flash_lane_current_state.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "VISUAL_EVIDENCE_REPAIR_PLAN.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    limit: 20,
    flashState: DEFAULT_FLASH_STATE,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (arg === "--flash-state") args.flashState = path.resolve(ROOT, argv[++i] || "");
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/visual-evidence-repair-planner.js [options]",
      "",
      "Options:",
      "  --flash-state <path>     Flash Lane current-state report",
      "  --limit <n>              Limit inspected rows",
      "  --json                   Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth.",
    ].join("\n") + "\n",
  );
}

async function readJson(filePath, label) {
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) {
    throw new Error(`${label} not found: ${resolved}`);
  }
  return fs.readJson(resolved);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const currentStateReport = await readJson(args.flashState, "Flash Lane current-state report");
  const report = buildVisualEvidenceRepairPlan({
    currentStateReport,
    limit: args.limit,
  });
  const markdown = renderVisualEvidenceRepairMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "visual_evidence_repair_plan.json");
  const mdPath = path.join(OUT, "visual_evidence_repair_plan.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  process.stderr.write(
    `[visual-repair] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")}, ${path.relative(
      ROOT,
      mdPath,
    ).replace(/\\/g, "/")} and ${path.relative(ROOT, DEFAULT_ROOT_REPORT).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[visual-repair] ${err.stack || err.message}\n`);
  process.exit(1);
});
