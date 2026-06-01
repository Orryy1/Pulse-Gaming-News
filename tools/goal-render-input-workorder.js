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
    storyIds: [],
    dryRun: false,
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
    else if (arg === "--story-id" || arg === "--story") {
      const value = argv[++i] || "";
      args.storyIds.push(...String(value).split(",").map((item) => item.trim()).filter(Boolean));
    }
    else if (arg === "--dry-run") args.dryRun = true;
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
    "  --story-id <id>         Optional story id filter; repeatable or comma-separated",
    "  --dry-run               Explicit report-only mode; writes local proof artefacts only",
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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storyIdSet(storyIds = []) {
  return new Set(asArray(storyIds).map(cleanText).filter(Boolean));
}

function actionIds(job = {}) {
  return asArray(job.actions).map((action) => cleanText(action.action_id));
}

function countJobsWithAction(jobs = [], actionId) {
  return asArray(jobs).filter((job) => actionIds(job).includes(actionId)).length;
}

function rebuildRepairBacklogSummary(backlog = {}) {
  const items = asArray(backlog.items);
  return {
    ...(backlog || {}),
    summary: {
      ...(backlog.summary || {}),
      total_items: items.length,
      auto_repairable_items: items.filter((item) => item.auto_repairable).length,
      operator_required_items: items.filter((item) => item.operator_approval_required).length,
      dead_end_blocker_items: items.filter((item) => item.dead_end_blocker).length,
      publish_blocker_resolution_items: items.filter((item) => item.source === "publish_blocker_resolution").length,
    },
    items,
  };
}

function rebuildAutoRepairPlan(plan = {}, repairBacklog = {}) {
  const items = asArray(repairBacklog.items).filter((item) => item.auto_repairable === true);
  return {
    ...(plan || {}),
    status: items.length ? "auto_repairable_jobs_available" : "empty_no_auto_repairable_jobs",
    summary: {
      ...(plan.summary || {}),
      auto_repairable_items: items.length,
      blocked_or_operator_required_items: asArray(repairBacklog.items).length - items.length,
    },
    items,
  };
}

function rebuildPostRepairValidationPlan(plan = {}) {
  const items = asArray(plan.items);
  return {
    ...(plan || {}),
    summary: {
      ...(plan.summary || {}),
      validation_items: items.length,
      operator_approval_items: items.filter((item) => item.operator_approval_needed).length,
      db_mutation_items: items.filter((item) => item.db_mutation_needed).length,
    },
    items,
  };
}

function rebuildSummary(workOrder = {}) {
  const jobs = asArray(workOrder.jobs);
  const repairBacklog = rebuildRepairBacklogSummary(workOrder.repair_backlog || {});
  return {
    ...(workOrder.summary || {}),
    story_count: jobs.length,
    ready_for_final_render_job_count: jobs.filter((job) => job.status === "ready_for_final_render_job").length,
    blocked_on_render_inputs_count: jobs.filter((job) => job.status === "blocked_on_render_inputs").length,
    audio_timestamp_jobs: countJobsWithAction(jobs, "generate_final_narration_audio_and_word_timestamps"),
    real_motion_materialisation_jobs: countJobsWithAction(jobs, "materialise_real_motion_clips"),
    owned_motion_materialisation_jobs: countJobsWithAction(jobs, "materialise_owned_generated_motion_clips"),
    public_output_repair_jobs: countJobsWithAction(jobs, "repair_public_output_coherence"),
    duplicate_title_repair_jobs: countJobsWithAction(jobs, "resolve_duplicate_title_or_event"),
    script_scorecard_repair_jobs: countJobsWithAction(jobs, "repair_script_scorecard"),
    aggregate_benchmark_repair_jobs: countJobsWithAction(jobs, "repair_aggregate_benchmark"),
    sound_benchmark_repair_jobs: countJobsWithAction(jobs, "repair_sound_design_benchmark"),
    rights_ledger_repair_jobs: countJobsWithAction(jobs, "repair_rights_ledger_evidence"),
    commercial_disclosure_repair_jobs: countJobsWithAction(jobs, "repair_commercial_disclosure_evidence"),
    final_mp4_repair_jobs: countJobsWithAction(jobs, "materialise_final_mp4"),
    caption_repair_jobs: countJobsWithAction(jobs, "generate_caption_file"),
    audio_segment_qa_refresh_jobs: countJobsWithAction(jobs, "refresh_audio_segment_loudness_qa"),
    narration_qa_refresh_jobs: countJobsWithAction(jobs, "refresh_narration_voice_quality_qa"),
    manifest_repair_jobs: asArray(jobs).reduce(
      (count, job) =>
        count +
        actionIds(job).filter((id) => id === "repair_render_manifest" || id === "repair_audio_manifest").length,
      0,
    ),
    stale_qa_refresh_jobs: countJobsWithAction(jobs, "refresh_stale_render_qa_state"),
    normal_duration_repair_jobs: countJobsWithAction(jobs, "repair_normal_production_duration"),
    stale_temporal_review_jobs: countJobsWithAction(jobs, "review_stale_temporal_story"),
    publish_blocker_resolution_repair_items: repairBacklog.summary.publish_blocker_resolution_items,
    auto_repairable_jobs: repairBacklog.summary.auto_repairable_items,
    operator_required_jobs: repairBacklog.summary.operator_required_items,
    dead_end_blocker_jobs: repairBacklog.summary.dead_end_blocker_items,
  };
}

function filterGoalRenderInputWorkOrderByStoryIds(workOrder = {}, storyIds = []) {
  const wanted = storyIdSet(storyIds);
  if (!wanted.size) return workOrder;
  const storyWanted = (value) => wanted.has(cleanText(value));
  const jobs = asArray(workOrder.jobs).filter((job) => storyWanted(job.story_id));
  const repairBacklog = rebuildRepairBacklogSummary({
    ...(workOrder.repair_backlog || {}),
    items: asArray(workOrder.repair_backlog?.items).filter((item) => storyWanted(item.story_id)),
  });
  const autoRepairPlan = rebuildAutoRepairPlan(workOrder.auto_repair_plan || {}, repairBacklog);
  const postRepairValidationPlan = rebuildPostRepairValidationPlan({
    ...(workOrder.post_repair_validation_plan || {}),
    items: asArray(workOrder.post_repair_validation_plan?.items).filter((item) => storyWanted(item.story_id)),
  });
  const filtered = {
    ...workOrder,
    story_id_filter: [...wanted],
    jobs,
    repair_backlog: repairBacklog,
    auto_repair_plan: autoRepairPlan,
    post_repair_validation_plan: postRepairValidationPlan,
  };
  return {
    ...filtered,
    summary: rebuildSummary(filtered),
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
  let workOrder = buildGoalRenderInputWorkOrder({
    cutoverPlan,
    dryRunPlan,
    publishBlockerResolutionPlan,
    incidentGuardReport,
    sourceFamilyAcquisitionReport,
    segmentValidationReports: segmentValidationReports.filter(Boolean),
    realMotionMaterializationReport,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  workOrder = filterGoalRenderInputWorkOrderByStoryIds(workOrder, args.storyIds);
  if (args.dryRun) {
    workOrder = {
      ...workOrder,
      dry_run: true,
      mode: "LOCAL_RENDER_INPUT_WORK_ORDER_DRY_RUN",
      safety: {
        ...(workOrder.safety || {}),
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
        no_gate_weakened: true,
      },
    };
  }
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
  filterGoalRenderInputWorkOrderByStoryIds,
  main,
  parseArgs,
  usage,
};
