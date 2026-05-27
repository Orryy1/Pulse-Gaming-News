#!/usr/bin/env node
"use strict";

/*
 * Visual V3 still-deck runner.
 *
 * Local-only: refreshes plan-only assets and official-only motion validation,
 * then renders a diagnostic still-deck proof with Visual V3 overlays enabled.
 * It does not publish, mutate OAuth, write production DB rows or change scheduler state.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const ASSET_REPORT = path.join(OUT, "asset_acquisition_pro.json");
const ENRICHED_STILLS_REPORT = path.join(OUT, "asset_acquisition_v16_gameplay_stills_apply_local.json");
const TRUSTED_FOOTAGE_REGISTRY = path.join(ROOT, "config", "trusted-footage-registry.json");
const TRUSTED_FOOTAGE_REPORT = path.join(OUT, "trusted_footage_registry_report.json");
const TRUSTED_FOOTAGE_MARKDOWN = path.join(OUT, "trusted_footage_registry_report.md");
const TRAILER_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");
const FRAME_PLAN_REPORT = path.join(OUT, "controlled_frame_extraction_v1.json");
const FRAME_WORKER_REPORT = path.join(OUT, "controlled_frame_extraction_worker_apply_local.json");
const SEGMENT_VALIDATION_REPORT = path.join(OUT, "official_trailer_segment_validation_apply_local.json");
const MOTION_REFRESH_EXPLORATORY_STARTS = Array.from(
  { length: 58 },
  (_, index) => 36 + index * 2,
).join(",");

function retentionJsonMatchesStory(filePath, storyId, readFileSync = fs.readFileSync) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return !parsed.story_id || parsed.story_id === storyId;
  } catch {
    return false;
  }
}

function resolveAutoRetentionIntelligencePath(
  storyId,
  { env = process.env, existsSync = fs.existsSync, readFileSync = fs.readFileSync } = {},
) {
  if (!storyId) return null;
  if (/^(false|0|no|off)$/i.test(String(env.STUDIO_V3_AUTO_RETENTION_INTELLIGENCE || ""))) {
    return null;
  }

  let learningPaths = null;
  try {
    learningPaths = require("../lib/intelligence/continuous-learning-loop").resolveLearningPaths({
      env,
    });
  } catch {
    learningPaths = null;
  }

  const dirs = [
    env.PULSE_RETENTION_INTELLIGENCE_DIR,
    learningPaths && learningPaths.retentionDir,
    path.join(OUT, "retention-intelligence"),
  ].filter(Boolean);

  for (const dir of dirs) {
    const resolvedDir = path.isAbsolute(dir) ? dir : path.resolve(ROOT, dir);
    const candidate = path.join(resolvedDir, `${storyId}.json`);
    if (
      existsSync(candidate) &&
      retentionJsonMatchesStory(candidate, storyId, readFileSync)
    ) {
      return candidate;
    }
  }
  return null;
}

function parseArgs(argv = process.argv.slice(2), opts = {}) {
  const env = opts.env || process.env;
  const args = {
    storyId: null,
    storyJsonPath: null,
    passThrough: [],
    refreshAcquisition: true,
    refreshMotion: true,
    retentionIntelligenceExplicit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story" || arg === "--story-id") {
      args.storyId = argv[++i] || null;
      args.passThrough.push("--story", args.storyId);
    } else if (arg === "--retention-intelligence") {
      const value = argv[++i] || "";
      args.passThrough.push("--retention-intelligence", value);
      args.retentionIntelligenceExplicit = true;
    } else if (arg === "--story-json") {
      const value = argv[++i] || "";
      args.storyJsonPath = value;
      args.passThrough.push("--story-json", value);
    } else if (arg.startsWith("--retention-intelligence=")) {
      args.passThrough.push("--retention-intelligence", arg.slice(25));
      args.retentionIntelligenceExplicit = true;
    } else if (arg === "--no-acquire") {
      args.refreshAcquisition = false;
    } else if (arg === "--no-motion-refresh") {
      args.refreshMotion = false;
    } else if (!arg.startsWith("-") && !args.storyId) {
      args.storyId = arg;
      args.passThrough.push("--story", args.storyId);
    } else {
      args.passThrough.push(arg);
    }
  }
  args.storyId = args.storyId || "1te1oq7";
  if (!args.passThrough.some((arg) => arg === "--story")) {
    args.passThrough.unshift("--story", args.storyId);
  }
  if (!args.retentionIntelligenceExplicit) {
    const autoRetention = resolveAutoRetentionIntelligencePath(args.storyId, {
      env,
    });
    if (autoRetention) {
      args.passThrough.push("--retention-intelligence", autoRetention);
    }
  }
  if (
    !args.passThrough.includes("--visual-v4") &&
    !args.passThrough.includes("--no-visual-v4")
  ) {
    args.passThrough.push("--visual-v4");
  }
  return args;
}

function runNode(script, args, env = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function existingFileArg(flag, filePath) {
  return fs.existsSync(filePath) ? [flag, filePath] : [];
}

function refreshTrustedFootageRegistry(storyId) {
  runNode("tools/trusted-footage-registry.js", [
    "--registry",
    TRUSTED_FOOTAGE_REGISTRY,
    "--story-id",
    storyId,
    "--output-json",
    TRUSTED_FOOTAGE_REPORT,
    "--output-md",
    TRUSTED_FOOTAGE_MARKDOWN,
  ]);
}

function refreshOfficialMotionInventory(storyId, opts = {}) {
  const storyJsonArgs = opts.storyJsonPath ? ["--story-json", opts.storyJsonPath] : [];
  const stillsReport = fs.existsSync(ENRICHED_STILLS_REPORT) ? ENRICHED_STILLS_REPORT : ASSET_REPORT;

  refreshTrustedFootageRegistry(storyId);

  runNode("tools/official-trailer-reference-resolver.js", [
    "--story-id",
    storyId,
    ...storyJsonArgs,
    "--stills-report",
    stillsReport,
    ...existingFileArg("--segment-validation-report", SEGMENT_VALIDATION_REPORT),
    ...existingFileArg("--trusted-footage-registry-report", TRUSTED_FOOTAGE_REPORT),
    "--no-exclude-exhausted-source-families",
    "--write-latest-report",
  ]);

  runNode("tools/controlled-frame-extraction-plan.js", [
    "--story-id",
    storyId,
    ...storyJsonArgs,
    "--trailer-references",
    TRAILER_REFERENCE_REPORT,
    "--max-references",
    "6",
    "--max-references-per-entity",
    "3",
    "--max-target-frames",
    "18",
  ]);

  runNode("tools/controlled-frame-extraction-worker.js", [
    "--story-id",
    storyId,
    "--frame-plan",
    FRAME_PLAN_REPORT,
    "--apply-local",
    "--merge-previous",
    "--max-frames-per-story",
    "18",
  ]);

  runNode("tools/official-trailer-segment-validator.js", [
    "--story",
    storyId,
    "--apply-local",
    "--frame-report",
    FRAME_WORKER_REPORT,
    "--reference-report",
    TRAILER_REFERENCE_REPORT,
    ...existingFileArg("--previous-validation-report", SEGMENT_VALIDATION_REPORT),
    "--merge-previous",
    "--deep-scan",
    "--include-frame-anchored-windows",
    "--candidate-windows-per-source",
    "8",
    "--max-segments",
    "72",
    "--no-exhausted-source-family-filter",
    "--exploratory-starts",
    MOTION_REFRESH_EXPLORATORY_STARTS,
  ]);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.refreshAcquisition) {
    runNode("tools/asset-acquisition-pro.js", [
      "--story-id",
      args.storyId,
      ...(args.storyJsonPath ? ["--story-json", args.storyJsonPath] : []),
    ]);
    runNode("tools/still-image-enrichment.js", [
      "--story",
      args.storyId,
      ...(args.storyJsonPath ? ["--story-json", args.storyJsonPath] : []),
      "--apply-local",
      "--verified-store-metadata",
      "--require-verified-store",
      "--multi-entity-store-search",
      "--prefer-gameplay-stills",
      "--max-store-search-entities",
      "1",
      "--max-store-assets-per-entity",
      "6",
      "--max-downloads-per-story",
      "6",
    ]);
  }

  if (args.refreshMotion) {
    refreshOfficialMotionInventory(args.storyId, { storyJsonPath: args.storyJsonPath });
  }

  const reportForRender =
    args.refreshAcquisition && fs.existsSync(ENRICHED_STILLS_REPORT)
      ? ENRICHED_STILLS_REPORT
      : ASSET_REPORT;
  const stillDeckArgs = [
    "--report",
    reportForRender,
    "--generate-local-tts",
    "--with-sound-design",
    "--allow-flash-diagnostic-render",
    "--allow-local-voice-diagnostic",
    "--visual-v3",
    "--use-official-trailer-clips",
    "--frame-report",
    FRAME_WORKER_REPORT,
    "--segment-validation-report",
    SEGMENT_VALIDATION_REPORT,
    ...args.passThrough,
  ];

  runNode("tools/studio-v2-still-deck-ingestion.js", stillDeckArgs, {
    STUDIO_V3_VISUALS: "true",
    STUDIO_V2_FORCE_TTS: process.env.STUDIO_V2_FORCE_TTS || "false",
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  resolveAutoRetentionIntelligencePath,
};
