#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  materializeGoalRealMotion,
  renderGoalRealMotionMarkdown,
  writeGoalRealMotionReport,
} = require("../lib/goal-real-motion-materializer");
const {
  filterPremiumDirectMotionClips,
} = require("../lib/studio/v5/direct-motion-visual-selector");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    root: ROOT,
    artifactRoot: "",
    segmentReportPath: null,
    generatedAt: null,
    limit: 0,
    storyIds: [],
    minClips: 5,
    minFamilies: 4,
    maxClips: 8,
    maxDirectClipsPerBaseSource: null,
    minBaseSources: 0,
    strictBaseSourceDiversity: false,
    premiumVisualSelection: false,
    refreshReady: false,
    refreshArtifactDir: "",
    refreshWindowPlanPath: null,
    excludedClipIds: [],
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--out-dir" || arg === "--output-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--artifact-root") args.artifactRoot = argv[++i] || args.artifactRoot;
    else if (arg === "--segment-report" || arg === "--segment-validation-report") {
      args.segmentReportPath = argv[++i] || null;
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--min-clips") args.minClips = Number(argv[++i] || args.minClips);
    else if (arg === "--min-families") args.minFamilies = Number(argv[++i] || args.minFamilies);
    else if (arg === "--max-clips") args.maxClips = Number(argv[++i] || args.maxClips);
    else if (arg === "--max-direct-clips-per-base-source") {
      args.maxDirectClipsPerBaseSource = Number(argv[++i] || 0) || null;
    }
    else if (arg === "--min-base-sources") args.minBaseSources = Number(argv[++i] || 0);
    else if (arg === "--strict-base-source-diversity") args.strictBaseSourceDiversity = true;
    else if (arg === "--premium-visual-selection") args.premiumVisualSelection = true;
    else if (arg === "--refresh-ready") args.refreshReady = true;
    else if (arg === "--refresh-artifact-dir") args.refreshArtifactDir = argv[++i] || "";
    else if (arg === "--refresh-window-plan") args.refreshWindowPlanPath = argv[++i] || null;
    else if (arg === "--exclude-clip-id") args.excludedClipIds.push(argv[++i] || "");
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-real-motion -- [options]",
    "",
    "Materialises validated direct gameplay/trailer media into local V4 motion clips.",
    "No publishing, DB mutation, OAuth or token changes are performed.",
    "",
    "Options:",
    "  --work-order <path>     Render input work-order JSON",
    "  --out-dir <dir>         Output report directory",
    "  --root <dir>            Workspace root",
    "  --artifact-root <dir>   Artifact root for segment-report-only fresh packages",
    "  --segment-report <path> Read validated direct-video segments as repair candidates",
    "  --limit <n>             Process at most n stories",
    "  --story-id <id>         Process only the matching story; repeatable",
    "  --min-clips <n>         Required successful clips per story",
    "  --min-families <n>      Required distinct source families",
    "  --max-clips <n>         Maximum clips to materialise per story",
    "  --max-direct-clips-per-base-source <n>  Maximum clips from the same direct-video base source",
    "  --min-base-sources <n>  Required genuine immutable base-source identities",
    "  --strict-base-source-diversity  Enforce the ultimate professional identity tier",
    "  --premium-visual-selection  Reject weak frames before clips consume source slots",
    "  --refresh-ready         Refresh requested ready stories from the current motion pack",
    "  --refresh-artifact-dir <path>  Explicit package directory for one ready story refresh",
    "  --refresh-window-plan <path>  Materialise exact governed replacement windows from JSON",
    "  --exclude-clip-id <id>  Exclude a known-bad package clip during refresh; repeatable",
    "  --json                  Print JSON",
  ].join("\n");
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function buildExplicitRefreshWorkOrder({
  workOrder = {},
  root = ROOT,
  refreshArtifactDir = "",
  refreshReady = false,
  storyIds = [],
} = {}) {
  if (!String(refreshArtifactDir || "").trim()) return workOrder;
  if (!refreshReady) {
    throw new Error("--refresh-artifact-dir requires --refresh-ready");
  }
  const requestedStoryIds = [...new Set(storyIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (requestedStoryIds.length !== 1) {
    throw new Error("--refresh-artifact-dir requires exactly one --story-id");
  }

  const resolvedRoot = path.resolve(root);
  const artifactDir = path.resolve(resolvedRoot, refreshArtifactDir);
  if (!pathIsWithin(resolvedRoot, artifactDir)) {
    throw new Error("--refresh-artifact-dir must stay within --root");
  }
  const canonicalManifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalManifestPath))) {
    throw new Error("--refresh-artifact-dir must contain canonical_story_manifest.json");
  }
  const canonicalManifest = await fs.readJson(canonicalManifestPath);
  const storyId = requestedStoryIds[0];
  if (String(canonicalManifest.story_id || "").trim() !== storyId) {
    throw new Error("--refresh-artifact-dir canonical story_id does not match --story-id");
  }

  const existingJobs = Array.isArray(workOrder.jobs) ? workOrder.jobs : [];
  return {
    ...workOrder,
    jobs: [
      {
        story_id: storyId,
        title: String(canonicalManifest.title || canonicalManifest.public_title || "").trim(),
        artifact_dir: artifactDir,
        status: "explicit_local_motion_refresh_target",
        publish_ready: false,
      },
      ...existingJobs.filter((job) => String(job?.story_id || "").trim() !== storyId),
    ],
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const workOrder = await buildExplicitRefreshWorkOrder({
    workOrder: await fs.readJson(path.resolve(args.workOrderPath)),
    root: args.root,
    refreshArtifactDir: args.refreshArtifactDir,
    refreshReady: args.refreshReady,
    storyIds: args.storyIds,
  });
  const segmentValidationReport = args.segmentReportPath
    ? await fs.readJson(path.resolve(args.segmentReportPath))
    : {};
  const refreshWindowPlan = args.refreshWindowPlanPath
    ? await fs.readJson(path.resolve(args.refreshWindowPlanPath))
    : {};
  const report = await materializeGoalRealMotion({
    root: path.resolve(args.root),
    workOrder,
    generatedAt: args.generatedAt || new Date().toISOString(),
    limit: args.limit,
    storyIds: args.storyIds,
    minClips: args.minClips,
    minFamilies: args.minFamilies,
    maxClips: args.maxClips,
    maxDirectClipsPerBaseSource: args.maxDirectClipsPerBaseSource,
    minBaseSources: args.minBaseSources,
    strictBaseSourceDiversity: args.strictBaseSourceDiversity,
    clipVisualEligibility: args.premiumVisualSelection
      ? async (clip, context = {}) => {
          const selection = await filterPremiumDirectMotionClips([clip], {
            outputDir: path.join(
              path.resolve(args.outDir),
              "premium-motion-visual-selection",
              String(context.storyId || "unknown-story").replace(/[^a-z0-9_-]+/gi, "_"),
            ),
          });
          const accepted = selection.accepted[0] || null;
          const rejected = selection.rejected[0] || null;
          const selectedClip = selection.clips[0] || null;
          const selectedPath = String(
            selectedClip?.local_materialized_path || selectedClip?.path || "",
          ).trim();
          const originalPath = String(
            clip?.local_materialized_path || clip?.path || "",
          ).trim();
          const replacementClip =
            selectedClip &&
            selectedPath &&
            originalPath &&
            path.resolve(selectedPath) !== path.resolve(originalPath)
              ? selectedClip
              : null;
          return {
            eligible: Boolean(accepted && selectedClip),
            reasons: accepted?.reasons || rejected?.reasons || selection.blockers,
            metrics: accepted?.metrics || rejected?.metrics,
            replacement_clip: replacementClip,
            visual_repair: accepted?.visual_repair || rejected?.visual_repair || null,
            repairs: selection.repairs,
          };
        }
      : undefined,
    segmentValidationReport,
    artifactRoot: args.artifactRoot,
    includeReadyStories: args.refreshReady,
    refreshWindowPlan,
    excludedClipIds: args.excludedClipIds,
  });
  const written = await writeGoalRealMotionReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalRealMotionMarkdown(report).trimEnd());
  return { args, report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-real-motion-materializer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildExplicitRefreshWorkOrder,
  main,
  parseArgs,
  usage,
};
