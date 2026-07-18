#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  generateFinalAvReviewPack,
} = require("../lib/goal-final-av-review-pack");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyId: null,
    artifactDir: null,
    finalMp4Path: null,
    generatedAt: null,
    sampleCount: undefined,
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-id") args.storyId = argv[++index] || null;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length) || null;
    else if (arg === "--artifact-dir") args.artifactDir = argv[++index] || null;
    else if (arg.startsWith("--artifact-dir=")) {
      args.artifactDir = arg.slice("--artifact-dir=".length) || null;
    }
    else if (arg === "--final-mp4") args.finalMp4Path = argv[++index] || null;
    else if (arg.startsWith("--final-mp4=")) {
      args.finalMp4Path = arg.slice("--final-mp4=".length) || null;
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg.startsWith("--generated-at=")) {
      args.generatedAt = arg.slice("--generated-at=".length) || null;
    }
    else if (arg === "--sample-count" || arg === "--samples") {
      args.sampleCount = Number(argv[++index]);
    }
    else if (arg.startsWith("--sample-count=")) {
      args.sampleCount = Number(arg.slice("--sample-count=".length));
    }
    else if (arg === "--ffmpeg") args.ffmpegPath = argv[++index] || args.ffmpegPath;
    else if (arg.startsWith("--ffmpeg=")) args.ffmpegPath = arg.slice("--ffmpeg=".length);
    else if (arg === "--ffprobe") args.ffprobePath = argv[++index] || args.ffprobePath;
    else if (arg.startsWith("--ffprobe=")) args.ffprobePath = arg.slice("--ffprobe=".length);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-final-av-review-pack.js --artifact-dir <dir> --final-mp4 <path> [options]",
    "",
    "Generate local final-AV evidence and an unsigned PENDING review template.",
    "",
    "Options:",
    "  --story-id <id>         Story id; defaults to the artifact directory name",
    "  --artifact-dir <dir>    Existing canonical story artifact directory (required)",
    "  --final-mp4 <path>      Current final MP4 inside the story directory (required)",
    "  --sample-count <4-24>   Uniform full-duration sample count; default 9",
    "  --generated-at <iso>    Fixed evidence-generation timestamp",
    "  --ffmpeg <path>         ffmpeg executable override",
    "  --ffprobe <path>        ffprobe executable override",
    "  --json                  Print the machine-readable PENDING summary",
    "  -h, --help              Show this help",
  ].join("\n");
}

function requiredArgs(args) {
  const missing = [];
  if (!args.artifactDir) missing.push("--artifact-dir");
  if (!args.finalMp4Path) missing.push("--final-mp4");
  if (missing.length) throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
}

function pathIsWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolveFinalMp4Path(cwd, artifactDir, declaredPath) {
  if (path.isAbsolute(declaredPath)) return path.resolve(declaredPath);

  const cwdCandidate = path.resolve(cwd, declaredPath);
  try {
    const [canonicalArtifactDir, canonicalCandidate] = await Promise.all([
      fs.realpath(artifactDir),
      fs.realpath(cwdCandidate),
    ]);
    if (pathIsWithin(canonicalCandidate, canonicalArtifactDir)) {
      return canonicalCandidate;
    }
  } catch {
    // The generator owns missing-path and artifact-directory validation.
  }
  return declaredPath;
}

function summaryFromResult(result) {
  return {
    schema_version: result.schema_version,
    story_id: result.story_id,
    status: result.status,
    publish_ready: false,
    artifact_dir: result.artifact_dir,
    final_mp4: result.final_mp4,
    duration_seconds: result.duration_seconds,
    sample_count: result.sample_count,
    paths: result.paths,
    fingerprints: result.fingerprints,
  };
}

async function main(argv = process.argv.slice(2), {
  cwd = process.cwd(),
  stdout = process.stdout,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  requiredArgs(args);
  const artifactDir = path.resolve(cwd, args.artifactDir);
  const finalMp4Path = await resolveFinalMp4Path(cwd, artifactDir, args.finalMp4Path);
  const result = await generateFinalAvReviewPack({
    storyId: args.storyId,
    artifactDir,
    finalMp4Path,
    generatedAt: args.generatedAt,
    sampleCount: args.sampleCount,
    ffmpegPath: args.ffmpegPath,
    ffprobePath: args.ffprobePath,
  });
  const summary = summaryFromResult(result);
  if (args.json) {
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    stdout.write([
      `[goal-final-av-review-pack] ${summary.status} story=${summary.story_id}`,
      `publish_ready=${summary.publish_ready}`,
      `contact_sheet=${summary.paths.contact_sheet}`,
      `decoded_forensic_report=${summary.paths.decoded_forensic_report}`,
      `final_av_review=${summary.paths.final_av_review}`,
      "",
    ].join("\n"));
  }
  return summary;
}

async function runCli(argv = process.argv.slice(2), {
  exit = (code) => {
    process.exitCode = code;
  },
  stderr = process.stderr,
} = {}) {
  try {
    await main(argv);
    exit(0);
  } catch (error) {
    stderr.write(`[goal-final-av-review-pack] FAILED: ${error.stack || error.message}\n`);
    exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  main,
  parseArgs,
  runCli,
  summaryFromResult,
  usage,
};
