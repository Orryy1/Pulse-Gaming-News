#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  auditRenderedAudioSegments,
} = require("../lib/render-audio-segment-qa");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "goal-contract");

function parseArgs(argv = process.argv) {
  const args = {
    bridge: path.join(DEFAULT_OUT, "scheduler_bridge_candidates.json"),
    storyPackages: null,
    outDir: DEFAULT_OUT,
    limit: null,
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bridge") args.bridge = argv[++index];
    else if (arg === "--story-packages") args.storyPackages = argv[++index];
    else if (arg === "--out-dir") args.outDir = argv[++index];
    else if (arg === "--limit") args.limit = Number(argv[++index]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/render-audio-segment-audit.js [options]",
    "",
    "Options:",
    "  --bridge <file>   Scheduler bridge candidates JSON",
    "  --story-packages <file>  Story package manifest JSON; overrides --bridge",
    "  --out-dir <dir>   Output directory for aggregate report",
    "  --limit <n>       Inspect first n candidates",
    "  --json            Print aggregate JSON",
  ].join("\n");
}

async function readJson(file, fallback = null) {
  try {
    return await fs.readJson(path.resolve(file));
  } catch {
    return fallback;
  }
}

function normaliseCandidates(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.candidates)) return value.candidates;
  if (Array.isArray(value?.scheduler_bridge?.candidates)) return value.scheduler_bridge.candidates;
  if (Array.isArray(value?.story_packages)) return value.story_packages;
  if (Array.isArray(value?.packages)) return value.packages;
  return [];
}

function artifactDirFor(candidate = {}) {
  return (
    candidate.scheduler_bridge_artifact_dir ||
    candidate.artifact_dir ||
    candidate.output_dir ||
    candidate.package_dir ||
    ""
  );
}

async function writePerArtifactReport(candidate, report) {
  const artifactDir = artifactDirFor(candidate);
  if (!artifactDir) return null;
  const outputPath = path.join(path.resolve(artifactDir), "audio_segment_loudness_report.json");
  await fs.writeJson(outputPath, report, { spaces: 2 });
  return outputPath;
}

async function candidateFromStoryPackage(storyPackage = {}) {
  const artifactDir = artifactDirFor(storyPackage);
  const renderManifest = artifactDir
    ? await readJson(path.join(artifactDir, "render_manifest.json"), {})
    : {};
  return {
    ...storyPackage,
    id: storyPackage.story_id || storyPackage.id,
    exported_path:
      storyPackage.exported_path ||
      storyPackage.render_path ||
      storyPackage.final_render_path ||
      (artifactDir ? path.join(artifactDir, "visual_v4_render.mp4") : ""),
    duration_seconds:
      storyPackage.duration_seconds ||
      renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s ||
      null,
  };
}

async function buildRenderAudioSegmentAudit({
  bridgePath,
  storyPackagesPath = null,
  outDir = DEFAULT_OUT,
  limit = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const sourcePath = storyPackagesPath || bridgePath || path.join(DEFAULT_OUT, "scheduler_bridge_candidates.json");
  const source = await readJson(sourcePath, []);
  let candidates = normaliseCandidates(source);
  if (storyPackagesPath) candidates = await Promise.all(candidates.map(candidateFromStoryPackage));
  if (Number.isFinite(limit) && limit > 0) candidates = candidates.slice(0, limit);

  const rows = [];
  for (const candidate of candidates) {
    const storyId = candidate.story_id || candidate.id || "";
    const inputPath = candidate.exported_path || candidate.render_path || candidate.final_render_path || "";
    const durationS =
      candidate.duration_seconds ||
      candidate.runtime_seconds ||
      candidate.rendered_duration_s ||
      candidate.audio_duration ||
      null;
    const report = await auditRenderedAudioSegments({
      storyId,
      inputPath,
      durationS,
      generatedAt,
    });
    const perArtifactPath = await writePerArtifactReport(candidate, report);
    rows.push({
      story_id: storyId,
      title: candidate.title || candidate.public_title || "",
      artifact_dir: artifactDirFor(candidate) || null,
      report_path: perArtifactPath,
      ...report,
    });
  }

  const counts = {
    pass: rows.filter((row) => row.verdict === "pass").length,
    fail: rows.filter((row) => row.verdict === "fail").length,
  };
  return {
    schema_version: 1,
    generated_at: generatedAt,
    bridge_path: storyPackagesPath ? null : bridgePath ? path.resolve(bridgePath) : null,
    story_packages_path: storyPackagesPath ? path.resolve(storyPackagesPath) : null,
    verdict: counts.fail > 0 ? "RED" : "GREEN",
    counts: {
      inspected: rows.length,
      ...counts,
    },
    rows,
    safety: {
      read_only_audio_analysis: true,
      writes_reports_only: true,
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const outDir = path.resolve(args.outDir || DEFAULT_OUT);
  await fs.ensureDir(outDir);
  const report = await buildRenderAudioSegmentAudit({
    bridgePath: args.bridge,
    storyPackagesPath: args.storyPackages,
    outDir,
    limit: args.limit,
  });
  const jsonPath = path.join(outDir, "audio_segment_loudness_report.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[render-audio-segment-audit] verdict=${report.verdict} inspected=${report.counts.inspected} pass=${report.counts.pass} fail=${report.counts.fail}\n`,
    );
    process.stdout.write(`[render-audio-segment-audit] json=${path.relative(ROOT, jsonPath)}\n`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[render-audio-segment-audit] FAILED: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildRenderAudioSegmentAudit,
  candidateFromStoryPackage,
  normaliseCandidates,
  parseArgs,
};
