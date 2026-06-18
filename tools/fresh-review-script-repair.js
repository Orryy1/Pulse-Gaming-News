#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const {
  buildFreshReviewScriptRepairPlan,
  fetchFreshReviewScriptRepairRows,
  formatFreshReviewScriptRepairMarkdown,
} = require("../lib/ops/fresh-review-script-repair");
const {
  buildAutoRepairRunPlan,
  executeAutoRepairRunPlan,
  renderAutoRepairRunMarkdown,
} = require("../lib/ops/auto-repair-runner");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "candidate-supply", "fresh-review-script-repair");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
    execute: false,
    limit: 6,
    maxAgeHours: 7 * 24,
    minScore: 65,
    outDir: OUT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--dry-run") args.execute = false;
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--max-age-hours") args.maxAgeHours = Number(argv[++i] || args.maxAgeHours);
    else if (arg.startsWith("--max-age-hours=")) args.maxAgeHours = Number(arg.slice("--max-age-hours=".length));
    else if (arg === "--min-score") args.minScore = Number(argv[++i] || args.minScore);
    else if (arg.startsWith("--min-score=")) args.minScore = Number(arg.slice("--min-score=".length));
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 6;
  if (!Number.isFinite(args.maxAgeHours) || args.maxAgeHours <= 0) args.maxAgeHours = 7 * 24;
  if (!Number.isFinite(args.minScore) || args.minScore <= 0) args.minScore = 65;
  return args;
}

async function runFreshReviewScriptRepair({
  limit = 6,
  maxAgeHours = 7 * 24,
  minScore = 65,
  execute = false,
  outDir = OUT,
  now = new Date(),
} = {}) {
  const rows = fetchFreshReviewScriptRepairRows({
    now,
    maxAgeHours,
    limit: Math.max(40, Number(limit || 6) * 10),
  });
  let transcriptAudienceReport = null;
  let candidateReport = {};
  try {
    const {
      auditGeneratedTranscripts,
      writeTranscriptAudienceAudit,
    } = require("../lib/ops/transcript-audience-audit");
    transcriptAudienceReport = await auditGeneratedTranscripts({ root: ROOT });
    await writeTranscriptAudienceAudit(transcriptAudienceReport, {
      outputDir: path.join(ROOT, "output", "transcript-audience-audit"),
    });
  } catch (err) {
    transcriptAudienceReport = {
      generated_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      summary: { total: 0, pass: 0, rewrite_required: 0 },
      stories: [],
      error: err.message || "transcript_audience_audit_failed",
    };
  }
  try {
    const candidateReportPath = path.join(ROOT, "test", "output", "next_publish_candidates.json");
    if (await fs.pathExists(candidateReportPath)) {
      candidateReport = await fs.readJson(candidateReportPath);
    }
  } catch {
    candidateReport = {};
  }
  const plan = buildFreshReviewScriptRepairPlan({
    rows,
    transcriptAudienceReport,
    candidateReport,
    now,
    maxAgeHours,
    minScore,
    limit,
  });
  const runPlan = buildAutoRepairRunPlan(plan, {
    lane: "source_bound_script_rewrite",
    limit,
    generatedAt: plan.generated_at,
  });
  const execution = await executeAutoRepairRunPlan(runPlan, {
    execute,
    generatedAt: new Date().toISOString(),
  });

  await fs.ensureDir(outDir);
  await Promise.all([
    fs.writeJson(path.join(outDir, "fresh_review_script_repair_plan.json"), plan, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "fresh_review_script_repair_plan.md"), formatFreshReviewScriptRepairMarkdown(plan), "utf8"),
    fs.writeJson(path.join(outDir, "fresh_review_script_repair_run_plan.json"), runPlan, { spaces: 2 }),
    fs.writeJson(path.join(outDir, "fresh_review_script_repair_results.json"), execution, { spaces: 2 }),
    fs.writeFile(path.join(outDir, "fresh_review_script_repair_results.md"), renderAutoRepairRunMarkdown(runPlan, execution), "utf8"),
  ]);

  return {
    status: "completed",
    out_dir: path.relative(ROOT, outDir),
    safety: execution.safety,
    plan_summary: plan.summary,
    run_summary: runPlan.summary,
    execution_summary: execution.summary,
  };
}

async function main(argv = process.argv) {
  const args = parseArgs(argv.slice(2));
  const result = await runFreshReviewScriptRepair(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        "# Fresh Review Script Repair",
        "",
        `Selected: ${result.plan_summary.selected_count}`,
        `Safe executable: ${result.run_summary.safe_executable_items}`,
        `Executed: ${result.execution_summary.executed}`,
        `No effect: ${result.execution_summary.no_effect}`,
        `Failed: ${result.execution_summary.failed}`,
        `Output: ${result.out_dir}`,
        "",
      ].join("\n"),
    );
  }
  return { exitCode: 0, result };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[fresh-review-script-repair] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runFreshReviewScriptRepair,
};
