#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  GovernedFinalCompositeError,
  executeGovernedFinalComposite,
} = require("../lib/services/governed-final-composite");

const VALUE_FLAGS = Object.freeze({
  "--story-intake": "storyIntakePath",
  "--owned-motion-manifest": "ownedMotionManifestPath",
  "--video": "videoPath",
  "--audio": "audioPath",
  "--narration-manifest": "narrationManifestPath",
  "--narration-manifest-sha256":
    "expectedNarrationManifestSha256",
  "--source-media-manifest": "sourceMediaManifestPath",
  "--source-media-manifest-sha256":
    "expectedSourceMediaManifestSha256",
  "--timestamps": "timestampsPath",
  "--out-dir": "outDir",
  "--generated-at": "generatedAt",
  "--ffmpeg": "ffmpegPath",
  "--ffprobe": "ffprobePath",
  "--render-timeout-ms": "renderTimeoutMs",
  "--hyperframes-generator": "hyperframesGeneratorIdentity",
  "--hyperframes-source-commit": "hyperframesSourceCommit",
});
const FORBIDDEN_FLAGS = new Set([
  "--apply",
  "--publish",
  "--live",
  "--database",
  "--db",
  "--oauth",
  "--token",
  "--auto-publish",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyIntakePath: null,
    ownedMotionManifestPath: null,
    videoPath: null,
    audioPath: null,
    narrationManifestPath: null,
    expectedNarrationManifestSha256: null,
    sourceMediaManifestPath: null,
    expectedSourceMediaManifestSha256: null,
    timestampsPath: null,
    outDir: null,
    generatedAt: new Date().toISOString(),
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    renderTimeoutMs: 600000,
    hyperframesProjectFiles: [],
    hyperframesGeneratorIdentity: "hyperframes@0.7.76",
    hyperframesSourceCommit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--help" ||
      argument === "-h" ||
      argument === "-?"
    ) {
      args.help = true;
      continue;
    }
    if (FORBIDDEN_FLAGS.has(argument)) {
      throw new Error(`forbidden_argument:${argument}`);
    }
    if (argument === "--hyperframes-project-file") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`missing_value:${argument}`);
      }
      args.hyperframesProjectFiles.push(value);
      index += 1;
      continue;
    }
    const mapped = VALUE_FLAGS[argument];
    if (!mapped) throw new Error(`unknown_argument:${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${argument}`);
    }
    args[mapped] = value;
    index += 1;
  }
  const timeout = Number(args.renderTimeoutMs);
  if (
    !Number.isInteger(timeout) ||
    timeout < 10000 ||
    timeout > 1800000
  ) {
    throw new Error("render_timeout_ms_invalid");
  }
  args.renderTimeoutMs = timeout;
  return args;
}

function usage() {
  return [
    "Governed Pulse Gaming final composite",
    "",
    "Usage:",
    "  node tools/governed-final-composite.js [options]",
    "",
    "Required:",
    "  --story-intake <path>            Governed official story intake",
    "  --owned-motion-manifest <path>   Combined owned manifest containing the HyperFrames intermediate",
    "  --video <path>                   Exact HyperFrames-rendered intermediate",
    "  --audio <path>                   Exact governed narration audio",
    "  --narration-manifest <path>      Governed narration and licence evidence",
    "  --narration-manifest-sha256 <h>  Independently supplied exact manifest SHA-256",
    "  --timestamps <path>              Exact governed word timestamps",
    "  --out-dir <path>                 Explicit LOCAL_PROOF output root",
    "",
    "Optional:",
    "  --generated-at <iso>             Fixed evidence timestamp",
    "  --ffmpeg <path>                  FFmpeg executable",
    "  --ffprobe <path>                 FFprobe executable",
    "  --render-timeout-ms <ms>         10000-1800000 (default 600000)",
    "  --source-media-manifest <path>   Governed licensed source-media manifest",
    "  --source-media-manifest-sha256 <h>  Independently supplied exact source-media SHA-256",
    "  --hyperframes-project-file <p>   Repeat for exact project files when deriving the combined manifest",
    "  --hyperframes-generator <id>     Generator identity (default hyperframes@0.7.76)",
    "  --hyperframes-source-commit <h>  Exact 40-character source commit",
    "",
    "The command binds a real HyperFrames material stage, then creates the",
    "studio-v21 H264/AAC final with FFmpeg. It never opens a database,",
    "never changes OAuth or tokens and never uses a network provider.",
    "It never publishes or creates a platform object. Human visual review remains required.",
  ].join("\n");
}

function requiredValue(value, code) {
  if (!String(value || "").trim()) throw new Error(code);
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  requiredValue(args.storyIntakePath, "story_intake_required");
  requiredValue(
    args.ownedMotionManifestPath,
    "owned_motion_manifest_required",
  );
  requiredValue(args.videoPath, "hyperframes_video_required");
  requiredValue(args.audioPath, "narration_audio_required");
  requiredValue(
    args.narrationManifestPath,
    "narration_manifest_required",
  );
  requiredValue(
    args.expectedNarrationManifestSha256,
    "narration_manifest_sha256_required",
  );
  if (
    !/^[a-f0-9]{64}$/i.test(
      args.expectedNarrationManifestSha256,
    )
  ) {
    throw new Error("narration_manifest_sha256_invalid");
  }
  requiredValue(
    args.timestampsPath,
    "narration_timestamps_required",
  );
  requiredValue(args.outDir, "out_dir_required");
  const hasSourceMediaManifest = Boolean(
    String(args.sourceMediaManifestPath || "").trim(),
  );
  const hasSourceMediaManifestSha256 = Boolean(
    String(
      args.expectedSourceMediaManifestSha256 || "",
    ).trim(),
  );
  if (
    hasSourceMediaManifest &&
    !hasSourceMediaManifestSha256
  ) {
    throw new Error(
      "source_media_manifest_sha256_required",
    );
  }
  if (
    !hasSourceMediaManifest &&
    hasSourceMediaManifestSha256
  ) {
    throw new Error(
      "source_media_manifest_path_required",
    );
  }
  if (
    hasSourceMediaManifestSha256 &&
    !/^[a-f0-9]{64}$/i.test(
      args.expectedSourceMediaManifestSha256,
    )
  ) {
    throw new Error(
      "source_media_manifest_sha256_invalid",
    );
  }

  const execute =
    deps.execute || executeGovernedFinalComposite;
  const result = await execute({
    storyIntakePath: path.resolve(args.storyIntakePath),
    ownedMotionManifestPath: path.resolve(
      args.ownedMotionManifestPath,
    ),
    videoPath: path.resolve(args.videoPath),
    audioPath: path.resolve(args.audioPath),
    narrationManifestPath: path.resolve(
      args.narrationManifestPath,
    ),
    expectedNarrationManifestSha256:
      args.expectedNarrationManifestSha256.toLowerCase(),
    ...(hasSourceMediaManifest
      ? {
          sourceMediaManifestPath: path.resolve(
            args.sourceMediaManifestPath,
          ),
          expectedSourceMediaManifestSha256:
            args.expectedSourceMediaManifestSha256.toLowerCase(),
        }
      : {}),
    timestampsPath: path.resolve(args.timestampsPath),
    outDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt,
    ffmpegPath: args.ffmpegPath,
    ffprobePath: args.ffprobePath,
    renderTimeoutMs: args.renderTimeoutMs,
    hyperframesProjectFiles: args.hyperframesProjectFiles.map(
      (filePath) => path.resolve(filePath),
    ),
    hyperframesGeneratorIdentity:
      args.hyperframesGeneratorIdentity,
    hyperframesSourceCommit: args.hyperframesSourceCommit,
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function runCli() {
  try {
    const result = await main();
    if (result?.verdict === "HOLD") process.exitCode = 2;
  } catch (error) {
    const codes =
      error instanceof GovernedFinalCompositeError
        ? error.codes
        : [String(error?.message || "governed_final_composite_failed")];
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version:
            "pulse-governed-final-composite-cli-error-v1",
          verdict: "ERROR",
          errors: codes,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  FORBIDDEN_FLAGS,
  VALUE_FLAGS,
  main,
  parseArgs,
  usage,
};
