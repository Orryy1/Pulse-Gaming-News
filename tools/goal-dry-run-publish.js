#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGoalDryRunPublishPlan,
  renderGoalDryRunPublishPlanMarkdown,
  writeGoalDryRunPublishPlan,
} = require("../lib/goal-dry-run-publisher");
const { buildPlatformOperationalConfig } = require("../lib/ops/platform-status");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    candidateReportPath: null,
    platformStatusPath: null,
    repairWorkOrderPath: null,
    motionPackRoot: null,
    requireSchedulerPreflight: true,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--candidate-report" || arg === "--preflight-report") {
      args.candidateReportPath = argv[++i] || "";
    }
    else if (arg === "--platform-status") args.platformStatusPath = argv[++i] || "";
    else if (arg === "--repair-work-order") args.repairWorkOrderPath = argv[++i] || "";
    else if (arg === "--motion-pack-root") args.motionPackRoot = argv[++i] || "";
    else if (arg === "--no-scheduler-preflight") args.requireSchedulerPreflight = false;
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
    "Usage: npm run ops:goal-dry-run-publish -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --story-packages <path>   Story package manifest",
    "  --candidate-report <path> Scheduler next-publish preflight report",
    "  --platform-status <path>  Platform operational status report",
    "  --repair-work-order <path> Render input repair work order",
    "  --motion-pack-root <dir>  Story-scoped V4 motion pack manifest directory",
    "  --no-scheduler-preflight  Diagnostic mode only; do not require scheduler preflight evidence",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Dry-run only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readStoryPackages(root, explicitPath = null) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : [
        path.join(root, "output", "goal-contract", "production_cutover_story_packages.json"),
        path.join(root, "output", "goal-contract", "story-packages.json"),
      ];
  let filePath = null;
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      filePath = candidate;
      break;
    }
  }
  if (!filePath) throw new Error(`story package file not found: ${candidates[0]}`);
  const value = await fs.readJson(filePath);
  if (!Array.isArray(value)) throw new Error(`story package file is not an array: ${filePath}`);
  return value;
}

async function readCandidateReport(root, explicitPath = null) {
  const explicit = Boolean(explicitPath);
  const candidates = explicit
    ? [path.resolve(root, explicitPath)]
    : [
        path.join(root, "test", "output", "next_publish_candidates.json"),
        path.join(root, "output", "goal-contract", "next_publish_candidates.json"),
      ];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    const report = await fs.readJson(filePath);
    if (!explicit && candidateReportIsStoryFiltered(report)) continue;
    if (!explicit && await candidateReportIsStaleAgainstBridge(root, report, filePath)) continue;
    return report;
  }
  return null;
}

function candidateReportIsStoryFiltered(report = {}) {
  if (!report || typeof report !== "object") return false;
  if (report.story_filter && typeof report.story_filter === "object") return true;
  if (report.story_preflight?.enabled === true && Array.isArray(report.candidates)) {
    const storyId = String(report.story_preflight.story_id || "").trim();
    return Boolean(storyId) && report.candidates.every((candidate) => String(candidate?.id || "") === storyId);
  }
  return false;
}

function parseTimeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

async function reportGeneratedAtMs(report = {}, filePath = "") {
  const generatedAt = parseTimeMs(report.generated_at || report.generatedAt);
  if (generatedAt != null) return generatedAt;
  try {
    const stat = await fs.stat(filePath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

async function candidateReportIsStaleAgainstBridge(root, report = {}, filePath = "") {
  const bridgePath = path.join(root, "output", "goal-contract", "scheduler_bridge_candidates.json");
  if (!(await fs.pathExists(bridgePath))) return false;
  const bridge = await fs.readJson(bridgePath).catch(() => null);
  const bridgeGeneratedAt = await reportGeneratedAtMs(bridge, bridgePath);
  if (bridgeGeneratedAt == null) return false;
  const reportGeneratedAt = await reportGeneratedAtMs(report, filePath);
  if (reportGeneratedAt == null) return false;
  return reportGeneratedAt + 1000 < bridgeGeneratedAt;
}

async function readPlatformOperationalConfig(root, explicitPath = null) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : [
        path.join(root, "test", "output", "platform_status.json"),
        path.join(root, "output", "goal-contract", "platform_status.json"),
      ];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    const report = await fs.readJson(filePath);
    return report.operational || report.platform_operational_config || platformStatusMatrixToOperational(report) || null;
  }
  return buildPlatformOperationalConfig(process.env);
}

async function readRepairWorkOrder(root, explicitPath = null) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : [path.join(root, "output", "goal-contract", "render_input_work_order.json")];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    return fs.readJson(filePath);
  }
  return null;
}

function matrixStateToOperationalState(value = "") {
  const state = String(value || "").trim();
  if (state === "ready_now") return "enabled";
  if (state === "deferred_until_platform_enabled") return "blocked_external";
  if (state === "no_ready_actions") return "blocked_external";
  return state || "unknown";
}

function platformStatusMatrixToOperational(report = {}) {
  const platforms = report?.platforms;
  if (!platforms || typeof platforms !== "object") return null;
  const mapping = {
    youtube_shorts: "youtube",
    tiktok: "tiktok",
    instagram_reels: "instagram_reel",
    facebook_reels: "facebook_reel",
    x: "twitter",
    threads: "threads",
    pinterest: "pinterest",
  };
  const operational = {};
  for (const [platform, key] of Object.entries(mapping)) {
    const row = platforms[platform];
    if (!row || typeof row !== "object") continue;
    operational[key] = {
      state: matrixStateToOperationalState(row.operational_state || row.status),
      reason: String(row.operational_reason || row.reason || "derived_from_platform_status_matrix").trim(),
    };
  }
  return Object.keys(operational).length ? operational : null;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const [storyPackages, candidatePreflightReport, platformOperationalConfig, repairWorkOrder] = await Promise.all([
    readStoryPackages(root, args.storyPackagesPath),
    readCandidateReport(root, args.candidateReportPath),
    readPlatformOperationalConfig(root, args.platformStatusPath),
    readRepairWorkOrder(root, args.repairWorkOrderPath),
  ]);
  const plan = await buildGoalDryRunPublishPlan({
    storyPackages,
    candidatePreflightReport,
    requireSchedulerPreflight: args.requireSchedulerPreflight,
    platformOperationalConfig,
    repairWorkOrder,
    motionPackRoot: path.resolve(root, args.motionPackRoot || path.join("output", "studio-v4", "motion-packs")),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGoalDryRunPublishPlan(plan, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(renderGoalDryRunPublishPlanMarkdown(plan).trimEnd());
  return { plan, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-dry-run-publish] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  readCandidateReport,
  readPlatformOperationalConfig,
  readRepairWorkOrder,
  readStoryPackages,
  platformStatusMatrixToOperational,
  main,
};
