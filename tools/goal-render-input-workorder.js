#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoalRenderInputWorkOrder,
  renderGoalRenderInputWorkOrderMarkdown,
  writeGoalRenderInputWorkOrder,
} = require("../lib/goal-render-input-workorder");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    cutoverPlanPath: path.join(ROOT, "output", "goal-contract", "production_render_cutover_plan.json"),
    dryRunPlanPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
    dryRunPlanExplicit: false,
    publishBlockerResolutionPath: path.join(ROOT, "test", "output", "publish_blocker_resolution.json"),
    publishBlockerResolutionExplicit: false,
    incidentGuardPath: path.join(ROOT, "output", "goal-contract", "incident_guard_report.json"),
    incidentGuardExplicit: false,
    sourceFamilyAcquisitionPath: null,
    sourceFamilyEvidenceDir: path.join(ROOT, "output", "goal-contract"),
    sourceFamilyEvidenceDirExplicit: false,
    segmentValidationPaths: [],
    segmentValidationDir: path.join(ROOT, "test", "output"),
    segmentValidationDirExplicit: false,
    realMotionMaterializationPath: path.join(ROOT, "output", "studio-v4", "motion-packs", "real_motion_materialization_report.json"),
    realMotionMaterializationExplicit: false,
    autoDiscoverRepairEvidence: true,
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cutover-plan") args.cutoverPlanPath = argv[++i] || args.cutoverPlanPath;
    else if (arg === "--dry-run-plan") {
      args.dryRunPlanPath = argv[++i] || args.dryRunPlanPath;
      args.dryRunPlanExplicit = true;
    }
    else if (arg === "--no-dry-run-plan") args.dryRunPlanPath = null;
    else if (arg === "--publish-blocker-resolution") {
      args.publishBlockerResolutionPath = argv[++i] || args.publishBlockerResolutionPath;
      args.publishBlockerResolutionExplicit = true;
    }
    else if (arg === "--no-publish-blocker-resolution") args.publishBlockerResolutionPath = null;
    else if (arg === "--incident-guard") {
      args.incidentGuardPath = argv[++i] || args.incidentGuardPath;
      args.incidentGuardExplicit = true;
    }
    else if (arg === "--source-family-acquisition") {
      args.sourceFamilyAcquisitionPath = argv[++i] || null;
    }
    else if (arg === "--source-family-evidence-dir") {
      args.sourceFamilyEvidenceDir = argv[++i] || args.sourceFamilyEvidenceDir;
      args.sourceFamilyEvidenceDirExplicit = true;
    }
    else if (arg === "--segment-validation-report") {
      const value = argv[++i] || null;
      if (value) args.segmentValidationPaths.push(value);
    }
    else if (arg === "--segment-validation-dir") {
      args.segmentValidationDir = argv[++i] || args.segmentValidationDir;
      args.segmentValidationDirExplicit = true;
    }
    else if (arg === "--real-motion-materialization") {
      args.realMotionMaterializationPath = argv[++i] || args.realMotionMaterializationPath;
      args.realMotionMaterializationExplicit = true;
    }
    else if (arg === "--no-auto-discover-repair-evidence") args.autoDiscoverRepairEvidence = false;
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
    "Usage: npm run ops:goal-render-inputs -- [options]",
    "",
    "Options:",
    "  --cutover-plan <path>   Production cutover plan JSON",
    "  --dry-run-plan <path>   Strict dry-run publish plan JSON",
    "  --no-dry-run-plan       Do not merge strict dry-run blocked candidates",
    "  --publish-blocker-resolution <path>",
    "                          Merge publish-unblock repair backlog context",
    "  --no-publish-blocker-resolution",
    "                          Do not merge publish-unblock repair backlog context",
    "  --incident-guard <path> Incident guard report JSON",
    "  --source-family-acquisition <path>",
    "                          Visual V4 source-family acquisition report",
    "  --source-family-evidence-dir <dir>",
    "                          Directory for auto-discovered source-family repair reports",
    "  --segment-validation-report <path>",
    "                          Official trailer segment validation report; repeatable",
    "  --segment-validation-dir <dir>",
    "                          Directory for auto-discovered segment validation reports",
    "  --real-motion-materialization <path>",
    "                          Real-motion materialisation report used to avoid stale auto-repair loops",
    "  --no-auto-discover-repair-evidence",
    "                          Do not auto-load local repair evidence reports",
    "  --out-dir <dir>         Output directory for the work order",
    "  --generated-at <iso>    Fixed timestamp for deterministic reports",
    "  --json                  Print JSON summary",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function discoverJsonFiles(dirPath, matcher) {
  const resolved = path.resolve(dirPath);
  if (!(await fs.pathExists(resolved))) return [];
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(resolved, entry.name))
    .filter((filePath) => matcher(path.basename(filePath)))
    .sort((a, b) => a.localeCompare(b));
}

function sourceFamilyEvidenceFile(name = "") {
  const lower = String(name || "").toLowerCase();
  return (
    lower.endsWith(".json") &&
    !lower.endsWith(".stdout.json") &&
    (
      lower.startsWith("source_family_acquisition_") ||
      lower.startsWith("studio_v4_source_family_acquisition") ||
      lower.startsWith("visual_v4_source_family_acquisition")
    )
  );
}

function segmentValidationEvidenceFile(name = "") {
  const lower = String(name || "").toLowerCase();
  return lower.endsWith(".json") && lower.startsWith("official_trailer_segment_validation");
}

async function readJsonReports(paths = []) {
  const reports = [];
  for (const reportPath of paths) {
    const report = await readJsonIfPresent(path.resolve(reportPath), null);
    if (report) reports.push(report);
  }
  return reports;
}

function mergeSourceFamilyReports(reports = []) {
  const loaded = asArray(reports);
  if (!loaded.length) return null;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    rows: loaded.flatMap((report) => asArray(report.rows)),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const cutoverPlan = await readJsonIfPresent(path.resolve(args.cutoverPlanPath));
  const defaultCutoverPath = path.join(ROOT, "output", "goal-contract", "production_render_cutover_plan.json");
  const usingDefaultCutoverPath = path.resolve(args.cutoverPlanPath) === path.resolve(defaultCutoverPath);
  const shouldLoadDryRunPlan =
    args.dryRunPlanPath &&
    (args.dryRunPlanExplicit || usingDefaultCutoverPath);
  const dryRunPlan = shouldLoadDryRunPlan
    ? await readJsonIfPresent(path.resolve(args.dryRunPlanPath), null)
    : null;
  const shouldLoadPublishBlockerResolution =
    args.publishBlockerResolutionPath &&
    (args.publishBlockerResolutionExplicit || usingDefaultCutoverPath);
  const publishBlockerResolutionPlan = shouldLoadPublishBlockerResolution
    ? await readJsonIfPresent(path.resolve(args.publishBlockerResolutionPath), null)
    : null;
  const shouldLoadDefaultIncidentGuard =
    args.incidentGuardExplicit || usingDefaultCutoverPath;
  const incidentGuardReport = shouldLoadDefaultIncidentGuard
    ? await readJsonIfPresent(path.resolve(args.incidentGuardPath), null)
    : null;
  const sourceFamilyReportPaths = args.sourceFamilyAcquisitionPath
    ? [args.sourceFamilyAcquisitionPath]
    : args.autoDiscoverRepairEvidence && (usingDefaultCutoverPath || args.sourceFamilyEvidenceDirExplicit)
      ? await discoverJsonFiles(args.sourceFamilyEvidenceDir, sourceFamilyEvidenceFile)
      : [];
  const sourceFamilyAcquisitionReport = mergeSourceFamilyReports(await readJsonReports(sourceFamilyReportPaths));
  const segmentValidationPaths = args.segmentValidationPaths.length
    ? args.segmentValidationPaths
    : args.autoDiscoverRepairEvidence && (usingDefaultCutoverPath || args.segmentValidationDirExplicit)
      ? await discoverJsonFiles(args.segmentValidationDir, segmentValidationEvidenceFile)
      : [];
  const segmentValidationReports = await readJsonReports(segmentValidationPaths);
  const shouldLoadDefaultRealMotion =
    args.realMotionMaterializationExplicit || usingDefaultCutoverPath;
  const realMotionMaterializationReport = shouldLoadDefaultRealMotion
    ? await readJsonIfPresent(path.resolve(args.realMotionMaterializationPath), null)
    : null;
  const workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan,
    dryRunPlan,
    publishBlockerResolutionPlan,
    incidentGuardReport,
    sourceFamilyAcquisitionReport,
    segmentValidationReports: segmentValidationReports.filter(Boolean),
    realMotionMaterializationReport,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoalRenderInputWorkOrder(workOrder, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(workOrder, null, 2));
  else console.log(renderGoalRenderInputWorkOrderMarkdown(workOrder).trimEnd());
  return { workOrder, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-render-input-workorder] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
