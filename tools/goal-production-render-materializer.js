#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeGoalProductionRenders,
  refreshFinalRenderQualityOnly,
  writeGoalProductionRenderMaterializationReport,
} = require("../lib/goal-production-render-materializer");

const ROOT = path.resolve(__dirname, "..");

function loadDotenvForCli() {
  try {
    if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
      require("dotenv").config({ override: true });
    }
  } catch {}
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    workspaceRoot: ROOT,
    generatedAt: new Date().toISOString(),
    limit: 0,
    force: false,
    inspectOnly: false,
    refreshQualityOnly: false,
    storyId: "",
    artifactDir: "",
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || args.generatedAt;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--force") args.force = true;
    else if (arg === "--inspect-only") args.inspectOnly = true;
    else if (arg === "--refresh-quality-only") args.refreshQualityOnly = true;
    else if (arg === "--story-id") args.storyId = argv[++i] || "";
    else if (arg === "--artifact-dir") args.artifactDir = argv[++i] || "";
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/goal-production-render-materializer.js [--work-order path] [--limit n] [--json]",
      "       node tools/goal-production-render-materializer.js --refresh-quality-only --story-id id --artifact-dir path [--json]",
      "",
      "Materialises fresh Visual V4 final renders from the ready final-render work order.",
      "Quality-refresh mode rebuilds post-render benchmark/visual QA for an existing final MP4.",
      "No publishing, database mutation, OAuth or token changes are performed.",
    ].join("\n") + "\n",
  );
}

async function main(argv = process.argv.slice(2)) {
  loadDotenvForCli();
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { args, report: null, written: null };
  }
  if (args.refreshQualityOnly) {
    const job = await refreshFinalRenderQualityOnly({
      storyId: args.storyId,
      artifactDir: args.artifactDir,
      generatedAt: args.generatedAt,
    });
    const report = {
      schema_version: 1,
      generated_at: args.generatedAt,
      mode: "PRODUCTION_RENDER_QUALITY_REFRESH",
      summary: {
        candidate_count: 1,
        rendered_count: 0,
        failed_count: job.status === "blocked" ? 1 : 0,
        skipped_existing_count: 0,
        inspect_only_count: 0,
        quality_refreshed_count: job.status === "quality_refreshed" ? 1 : 0,
      },
      jobs: [job],
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
        no_local_proof_promoted_to_final: true,
        renderer_invoked: false,
      },
    };
    const written = await writeGoalProductionRenderMaterializationReport(report, {
      outputDir: path.resolve(args.outDir),
    });
    if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else {
      process.stdout.write(
        `[goal-production-render] quality_refreshed=${report.summary.quality_refreshed_count} failed=${report.summary.failed_count}\n`,
      );
    }
    return { args, report, written };
  }
  const workOrder = await fs.readJson(path.resolve(args.workOrderPath));
  const report = await materializeGoalProductionRenders({
    workOrder,
    workspaceRoot: path.resolve(args.workspaceRoot),
    generatedAt: args.generatedAt,
    limit: args.limit,
    force: args.force,
    inspectOnly: args.inspectOnly,
  });
  const written = await writeGoalProductionRenderMaterializationReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    process.stdout.write(
      `[goal-production-render] rendered=${report.summary.rendered_count} failed=${report.summary.failed_count} skipped=${report.summary.skipped_existing_count}\n`,
    );
  }
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[goal-production-render] ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  loadDotenvForCli,
  parseArgs,
  main,
};
