#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

const {
  filterPremiumDirectMotionClips,
} = require("../lib/studio/v5/direct-motion-visual-selector");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    motionManifestPath: "",
    clipIds: [],
    outputPath: path.join(ROOT, "output", "goal-contract", "direct_motion_selector_report.json"),
    outputDir: path.join(ROOT, "output", "goal-contract", "direct-motion-selector-frames"),
    policyTier: "normal_strict_green",
    minBaseSources: 1,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--motion-manifest") args.motionManifestPath = argv[++index] || "";
    else if (arg === "--clip-id") args.clipIds.push(argv[++index] || "");
    else if (arg === "--output" || arg === "--out") args.outputPath = argv[++index] || "";
    else if (arg === "--output-dir") args.outputDir = argv[++index] || "";
    else if (arg === "--policy-tier") args.policyTier = argv[++index] || "";
    else if (arg === "--min-base-sources") args.minBaseSources = Number(argv[++index] || 0);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/direct-motion-visual-selector.js [options]",
    "",
    "Runs the production v5 visual selector against exact materialised motion files.",
    "",
    "Required:",
    "  --motion-manifest <path>",
    "  --clip-id <id>            Repeatable",
    "",
    "Options:",
    "  --output <path>",
    "  --output-dir <dir>",
    "  --policy-tier <tier>",
    "  --min-base-sources <n>",
    "  --json",
    "",
    "Local proof only. No publishing or database mutation.",
  ].join("\n");
}

function resolveFromRoot(root, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function clipId(clip = {}) {
  return String(clip.id || clip.clip_id || clip.asset_id || "").trim();
}

function manifestClipRows(manifest = {}) {
  const rows = [
    ...(Array.isArray(manifest.clips) ? manifest.clips : []),
    ...(Array.isArray(manifest.materialised_clips) ? manifest.materialised_clips : []),
    ...(Array.isArray(manifest.materialized_clips) ? manifest.materialized_clips : []),
  ];
  const byExactClip = new Map();
  for (const row of rows) {
    const key = [
      clipId(row),
      String(row.path || row.local_materialized_path || "").trim().toLowerCase(),
      String(row.asset_sha256 || row.materialized_file_evidence?.sha256 || "").trim().toLowerCase(),
    ].join("|");
    if (!byExactClip.has(key)) byExactClip.set(key, row);
  }
  return [...byExactClip.values()];
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true, args };
  }
  const root = path.resolve(args.root);
  const manifestPath = resolveFromRoot(root, args.motionManifestPath);
  if (!manifestPath) throw new Error("--motion-manifest is required");
  const requestedIds = args.clipIds.map((value) => String(value || "").trim()).filter(Boolean);
  if (!requestedIds.length) throw new Error("At least one --clip-id is required");
  const manifest = await fs.readJson(manifestPath);
  const rows = manifestClipRows(manifest);
  const selected = [];
  for (const requestedId of requestedIds) {
    const matches = rows.filter((row) => clipId(row) === requestedId);
    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? `duplicate_manifest_clip:${requestedId}`
          : `manifest_clip_missing:${requestedId}`,
      );
    }
    const clip = matches[0];
    const clipPath = resolveFromRoot(
      root,
      clip.path || clip.local_materialized_path || clip.local_materialised_path,
    );
    if (!clipPath || !(await fs.pathExists(clipPath))) {
      throw new Error(`materialised_clip_missing:${requestedId}`);
    }
    selected.push({
      ...clip,
      path: clipPath,
      local_materialized_path: clipPath,
    });
  }
  const outputDir = resolveFromRoot(root, args.outputDir);
  const report = await filterPremiumDirectMotionClips(selected, {
    outputDir,
    policyTier: args.policyTier,
    minimumBaseSources: args.minBaseSources,
  });
  report.schema_version = 1;
  report.generated_at = new Date().toISOString();
  report.mode = "EXACT_MATERIALISED_DIRECT_MOTION_VISUAL_SELECTION";
  report.story_id = String(manifest.story_id || "").trim();
  report.motion_manifest_path = manifestPath;
  report.motion_manifest_sha256 = await sha256File(manifestPath);
  report.selected_clip_evidence = await Promise.all(
    selected.map(async (clip) => {
      const stat = await fs.stat(clip.path);
      return {
        clip_id: clipId(clip),
        path: clip.path,
        sha256: await sha256File(clip.path),
        size_bytes: stat.size,
      };
    }),
  );
  report.verdict = report.blockers.length || report.rejected.length ? "RED" : "PASS";
  report.can_use_for_motion_composition = report.verdict === "PASS";
  report.safety = {
    local_proof_only: true,
    no_publish_triggered: true,
    no_db_mutation: true,
    no_oauth_or_token_change: true,
    no_gate_weakened: true,
  };

  const outputPath = resolveFromRoot(root, args.outputPath);
  const relativeOutput = path.relative(root, outputPath);
  if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw new Error("Output path must stay within the workspace root");
  }
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeJson(outputPath, report, { spaces: 2 });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `${report.verdict}: accepted=${report.accepted.length}; ` +
      `rejected=${report.rejected.length}; blockers=${report.blockers.length}`,
    );
  }
  return { args, report, outputPath };
}

if (require.main === module) {
  main().then(({ report } = {}) => {
    if (report && report.verdict !== "PASS") process.exitCode = 1;
  }).catch((error) => {
    console.error(`[direct-motion-visual-selector] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
