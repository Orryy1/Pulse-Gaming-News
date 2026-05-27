#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildBaselineAuditReport,
  writeBaselineAuditArtifacts,
} = require("../lib/goal-baseline-audit");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: null,
    generatedAt: null,
    storyPackagesPath: null,
    dryRunPlanPath: null,
    renderInputWorkOrderPath: null,
    schedulerBridgeCandidatesPath: null,
    renderHealthReportPath: null,
    liveDbHealthReportPath: null,
    bridgeHealthReportPath: null,
    platformStatusMatrixPath: null,
    publishVerdictPath: null,
    analyticsReportPath: null,
    localLlmReportPath: null,
    pipelineBacklogPath: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || "";
    else if (arg === "--render-input-work-order") args.renderInputWorkOrderPath = argv[++i] || "";
    else if (arg === "--scheduler-bridge-candidates") args.schedulerBridgeCandidatesPath = argv[++i] || "";
    else if (arg === "--render-health-report") args.renderHealthReportPath = argv[++i] || "";
    else if (arg === "--live-db-health-report") args.liveDbHealthReportPath = argv[++i] || "";
    else if (arg === "--bridge-health-report") args.bridgeHealthReportPath = argv[++i] || "";
    else if (arg === "--platform-status-matrix") args.platformStatusMatrixPath = argv[++i] || "";
    else if (arg === "--publish-verdict") args.publishVerdictPath = argv[++i] || "";
    else if (arg === "--analytics-report") args.analyticsReportPath = argv[++i] || "";
    else if (arg === "--local-llm-report") args.localLlmReportPath = argv[++i] || "";
    else if (arg === "--pipeline-backlog") args.pipelineBacklogPath = argv[++i] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-baseline-audit -- [options]",
    "",
    "Options:",
    "  --root <dir>                         Workspace root",
    "  --out-dir <dir>                      Output directory",
    "  --generated-at <iso>                 Fixed timestamp",
    "  --story-packages <path>              Story package manifest",
    "  --dry-run-plan <path>                Strict dry-run publish plan",
    "  --render-input-work-order <path>     Render input work order",
    "  --scheduler-bridge-candidates <path> Scheduler bridge candidates",
    "  --render-health-report <path>        Render health report",
    "  --platform-status-matrix <path>      Platform status matrix",
    "  --publish-verdict <path>             Publish verdict report",
    "  --json                               Print generated report JSON",
    "",
    "LOCAL_PROOF only. Does not publish, post externally, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJsonIfPresent(root, explicitPath, fallbackPaths, fallbackValue) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : fallbackPaths.map((filePath) => path.resolve(root, filePath));

  for (const filePath of candidates) {
    try {
      if (!(await fs.pathExists(filePath))) continue;
      return await fs.readJson(filePath);
    } catch {}
  }
  return fallbackValue;
}

async function loadInputs(args) {
  const root = path.resolve(args.root);
  return {
    generatedAt: args.generatedAt || new Date().toISOString(),
    storyPackages: await readJsonIfPresent(root, args.storyPackagesPath, [
      "output/goal-contract/story-packages.json",
    ], []),
    dryRunPlan: await readJsonIfPresent(root, args.dryRunPlanPath, [
      "output/goal-01/dry_run_publish_plan.json",
      "output/goal-contract/dry_run_publish_plan.json",
    ], {}),
    renderInputWorkOrder: await readJsonIfPresent(root, args.renderInputWorkOrderPath, [
      "output/goal-contract/render_input_work_order.json",
      "output/goal-03/render_input_work_order.json",
    ], {}),
    schedulerBridgeCandidates: await readJsonIfPresent(root, args.schedulerBridgeCandidatesPath, [
      "output/goal-contract/scheduler_bridge_candidates.json",
      "output/goal-17/scheduler_bridge_candidates.json",
    ], []),
    renderHealthReport: await readJsonIfPresent(root, args.renderHealthReportPath, [
      "output/goal-contract/render_health_report.json",
      "output/goal-19/render_health_report.json",
      "test/output/render_health_report.json",
    ], {}),
    liveDbHealthReport: await readJsonIfPresent(root, args.liveDbHealthReportPath, [
      "output/goal-contract/live_db_health_report.json",
      "output/goal-19/live_db_health_report.json",
    ], {}),
    bridgeHealthReport: await readJsonIfPresent(root, args.bridgeHealthReportPath, [
      "output/goal-contract/bridge_health_report.json",
      "output/goal-19/bridge_health_report.json",
    ], {}),
    platformStatusMatrix: await readJsonIfPresent(root, args.platformStatusMatrixPath, [
      "output/goal-01/platform_status_matrix.json",
      "output/goal-contract/platform_status_matrix.json",
    ], {}),
    publishVerdict: await readJsonIfPresent(root, args.publishVerdictPath, [
      "output/goal-01/publish_verdict.json",
      "output/goal-contract/publish_verdict.json",
    ], {}),
    analyticsReport: await readJsonIfPresent(root, args.analyticsReportPath, [
      "output/goal-contract/retention_intelligence.json",
      "output/goal-contract/analytics_fallback_report.json",
      "output/retention_intelligence.json",
    ], {}),
    localLlmReport: await readJsonIfPresent(root, args.localLlmReportPath, [
      "output/goal-contract/local_llm_report.json",
      "output/local_llm_report.json",
      "output/local-mode-doctor.json",
    ], {}),
    pipelineBacklog: await readJsonIfPresent(root, args.pipelineBacklogPath, [
      "output/goal-contract/pipeline_backlog.json",
      "test/output/pipeline_backlog.json",
    ], {}),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const outDir = path.resolve(root, args.outDir || path.join("output", "goal-02"));
  const inputs = await loadInputs(args);
  const report = buildBaselineAuditReport(inputs);
  const written = await writeBaselineAuditArtifacts(report, { outDir });

  if (args.json) {
    console.log(JSON.stringify({ report, written }, null, 2));
  } else {
    console.log(`Goal 02 baseline audit: ${report.readiness_verdict}`);
    console.log(`Wrote ${Object.keys(written.files).length} artefacts to ${written.out_dir}`);
  }
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  loadInputs,
  main,
  parseArgs,
  readJsonIfPresent,
};
