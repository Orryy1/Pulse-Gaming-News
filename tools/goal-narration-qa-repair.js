#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const { repairNarrationQaArtifacts } = require("../lib/goal-narration-qa-repair");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    dryRunPlanPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-narration-qa-repair -- [options]",
    "",
    "Options:",
    "  --root <dir>             Workspace root",
    "  --dry-run-plan <path>    Strict dry-run publish plan",
    "  --out-dir <dir>          Output report directory",
    "  --generated-at <iso>     Fixed timestamp",
    "  --apply                  Rewrite stale voice_quality_report.json files",
    "  --json                   Print JSON",
    "",
    "Repairs narration QA reports only. It does not publish, mutate DB rows, alter media or touch OAuth/token settings.",
  ].join("\n");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Narration QA Repair",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Mode: ${report.mode || "unknown"}`,
    `Targets: ${report.summary?.target_count || 0}`,
    `Written: ${report.summary?.written_count || 0}`,
    `Fresh after repair: ${report.summary?.freshness_pass_count || 0}`,
    `Still blocked: ${report.summary?.remaining_blocked_count || 0}`,
    "",
    "No uploads, DB mutations, OAuth changes, token writes or media rewrites are performed.",
    "",
  ];
  for (const row of report.rows || []) {
    lines.push(
      `- ${row.story_id}: ${row.freshness_after_repair}; result=${row.repaired_report_result}; written=${row.written}`,
    );
    if (row.remaining_blockers?.length) {
      lines.push(`  blockers: ${row.remaining_blockers.join(", ")}`);
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
  const root = path.resolve(args.root);
  const dryRunPlanPath = args.dryRunPlanPath
    ? path.resolve(root, args.dryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const dryRunPlan = await fs.readJson(dryRunPlanPath);
  const report = await repairNarrationQaArtifacts({
    dryRunPlan,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apply: args.apply,
  });
  const outDir = path.resolve(root, args.outDir);
  await fs.ensureDir(outDir);
  await fs.writeJson(path.join(outDir, "narration_qa_repair_report.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(outDir, "narration_qa_repair_report.md"), renderMarkdown(report), "utf8");
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderMarkdown(report).trimEnd());
  return { report };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-narration-qa-repair] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
};
