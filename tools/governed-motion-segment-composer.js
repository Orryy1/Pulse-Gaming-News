#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

const {
  composeGovernedMotionSegmentReport,
  mirrorSegmentSourceMasters,
} = require("../lib/governed-motion-segment-composer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    storyId: "",
    title: "",
    narrationDurationSeconds: 0,
    transitionDurationSeconds: 0.25,
    minClips: 1,
    minBaseSources: 1,
    maxScenesPerSource: 2,
    maxSourceShare: 0.25,
    materializerRoot: "",
    bundles: [],
    outputPath: path.join(
      ROOT,
      "output",
      "goal-contract",
      "governed_motion_segment_report.json",
    ),
    generatedAt: null,
    json: false,
    help: false,
  };
  let currentBundle = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg === "--title") args.title = argv[++index] || "";
    else if (arg === "--narration-duration") {
      args.narrationDurationSeconds = Number(argv[++index] || 0);
    } else if (arg === "--transition-duration") {
      args.transitionDurationSeconds = Number(argv[++index] || 0);
    } else if (arg === "--min-clips") args.minClips = Number(argv[++index] || 0);
    else if (arg === "--min-base-sources") args.minBaseSources = Number(argv[++index] || 0);
    else if (arg === "--max-scenes-per-source") {
      args.maxScenesPerSource = Number(argv[++index] || 0);
    } else if (arg === "--max-source-share") {
      args.maxSourceShare = Number(argv[++index] || 0);
    } else if (arg === "--materializer-root") {
      args.materializerRoot = argv[++index] || "";
    } else if (arg === "--motion-manifest") {
      currentBundle = {
        motionManifestPath: argv[++index] || "",
        rightsLedgerPath: "",
        selectorReportPath: "",
        clipIds: [],
      };
      args.bundles.push(currentBundle);
    } else if (arg === "--rights-ledger") {
      if (!currentBundle) throw new Error("--rights-ledger requires a preceding --motion-manifest");
      currentBundle.rightsLedgerPath = argv[++index] || "";
    } else if (arg === "--selector-report") {
      if (!currentBundle) throw new Error("--selector-report requires a preceding --motion-manifest");
      currentBundle.selectorReportPath = argv[++index] || "";
    } else if (arg === "--clip-id") {
      if (!currentBundle) throw new Error("--clip-id requires a preceding --motion-manifest");
      currentBundle.clipIds.push(argv[++index] || "");
    } else if (arg === "--output" || arg === "--out") args.outputPath = argv[++index] || "";
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/governed-motion-segment-composer.js [options]",
    "",
    "Composes exact visually accepted, rights-backed motion clips into a validated segment report.",
    "Repeat --motion-manifest to start another evidence bundle.",
    "",
    "Required:",
    "  --story-id <id>",
    "  --narration-duration <seconds>",
    "  --motion-manifest <path>",
    "  --rights-ledger <path>",
    "  --selector-report <path>",
    "  --clip-id <id>             Repeat for every selected clip in the current bundle",
    "",
    "Quality controls:",
    "  --min-clips <n>",
    "  --min-base-sources <n>",
    "  --transition-duration <seconds>",
    "  --max-scenes-per-source <n>",
    "  --max-source-share <ratio>",
    "  --materializer-root <dir>  Hard-link exact source masters into an isolated root",
    "",
    "Output:",
    "  --output <path>",
    "  --json",
    "",
    "This tool performs local proof composition only. It never publishes or mutates the DB.",
  ].join("\n");
}

function resolveFromRoot(root, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function fileEvidence(filePath) {
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    sha256: await sha256File(filePath),
    size_bytes: stat.size,
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Governed Motion Segment Composition",
    "",
    `Generated: ${report.generated_at || ""}`,
    `Story: ${report.story_id || ""}`,
    `Verdict: ${report.verdict || "RED"}`,
    `Selected clips: ${report.metrics?.selected_clip_count || 0}`,
    `Genuine sources: ${report.metrics?.genuine_base_source_count || 0}`,
    `Repeat-free coverage: ${report.metrics?.repeat_free_coverage_seconds || 0}s`,
    "",
    "## Source Balance",
  ];
  for (const source of report.metrics?.source_scene_shares || []) {
    lines.push(
      `- ${source.base_source_asset_id}: ${source.scene_count} scenes (${Math.round(
        Number(source.scene_share || 0) * 100,
      )}%)`,
    );
  }
  if (!(report.metrics?.source_scene_shares || []).length) lines.push("- none");
  lines.push("", "## Blockers");
  for (const blocker of report.blockers || []) lines.push(`- ${blocker}`);
  if (!(report.blockers || []).length) lines.push("- none");
  lines.push(
    "",
    "Safety: local proof only. No publishing, DB mutation, OAuth or token change.",
  );
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const root = path.resolve(args.root);
  const bundles = [];
  const sourceBundleEvidence = [];
  for (const bundle of args.bundles) {
    const motionManifestPath = resolveFromRoot(root, bundle.motionManifestPath);
    const rightsLedgerPath = resolveFromRoot(root, bundle.rightsLedgerPath);
    const selectorReportPath = resolveFromRoot(root, bundle.selectorReportPath);
    if (!motionManifestPath || !rightsLedgerPath || !selectorReportPath) {
      throw new Error("Every motion bundle requires manifest, rights ledger and selector report");
    }
    const [manifest, rightsLedger, selectorReport, manifestEvidence, rightsEvidence, selectorEvidence] =
      await Promise.all([
        fs.readJson(motionManifestPath),
        fs.readJson(rightsLedgerPath),
        fs.readJson(selectorReportPath),
        fileEvidence(motionManifestPath),
        fileEvidence(rightsLedgerPath),
        fileEvidence(selectorReportPath),
      ]);
    bundles.push({
      manifest,
      rightsLedger,
      selectorReport,
      clipIds: bundle.clipIds,
    });
    sourceBundleEvidence.push({
      motion_manifest: manifestEvidence,
      rights_ledger: rightsEvidence,
      selector_report: selectorEvidence,
      selected_clip_ids: bundle.clipIds,
    });
  }
  let report = await composeGovernedMotionSegmentReport({
    root,
    storyId: args.storyId,
    title: args.title,
    narrationDurationSeconds: args.narrationDurationSeconds,
    transitionDurationSeconds: args.transitionDurationSeconds,
    minClips: args.minClips,
    minBaseSources: args.minBaseSources,
    maxScenesPerSource: args.maxScenesPerSource,
    maxSourceShare: args.maxSourceShare,
    bundles,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  report.source_bundle_evidence = sourceBundleEvidence;
  if (args.materializerRoot) {
    report = await mirrorSegmentSourceMasters(report, {
      root,
      materializerRoot: resolveFromRoot(root, args.materializerRoot),
    });
  }

  const outputPath = resolveFromRoot(root, args.outputPath);
  const relativeOutput = path.relative(root, outputPath);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw new Error("Output path must stay within the workspace root");
  }
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeJson(outputPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `${report.verdict}: clips=${report.metrics.selected_clip_count}; ` +
      `sources=${report.metrics.genuine_base_source_count}; ` +
      `coverage=${report.metrics.repeat_free_coverage_seconds}s; ` +
      `blockers=${report.blockers.length}`,
    );
  }
  return {
    args,
    report,
    outputPath,
    markdownPath,
  };
}

if (require.main === module) {
  main().then(({ report } = {}) => {
    if (report && report.verdict !== "PASS") process.exitCode = 1;
  }).catch((error) => {
    console.error(`[governed-motion-segment-composer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
  usage,
};
