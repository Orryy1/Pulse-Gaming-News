#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  signOffFinalAvReview,
} = require("../lib/goal-final-av-review-signoff");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyId: null,
    artifactDir: null,
    finalMp4Path: null,
    reviewerId: null,
    reviewedAt: null,
    signedAt: null,
    observations: {
      full_watch: false,
      full_listen: false,
      av_sync: false,
      caption_readability: false,
      subject_match: false,
      no_freeze: false,
      no_black: false,
      no_blur: false,
      no_repetition: false,
    },
    noDefects: false,
    operatorConfirmed: false,
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-id") args.storyId = argv[++index] || null;
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--artifact-dir") args.artifactDir = argv[++index] || null;
    else if (arg.startsWith("--artifact-dir=")) {
      args.artifactDir = arg.slice("--artifact-dir=".length);
    }
    else if (arg === "--final-mp4") args.finalMp4Path = argv[++index] || null;
    else if (arg.startsWith("--final-mp4=")) {
      args.finalMp4Path = arg.slice("--final-mp4=".length);
    }
    else if (arg === "--reviewer-id") args.reviewerId = argv[++index] || null;
    else if (arg.startsWith("--reviewer-id=")) {
      args.reviewerId = arg.slice("--reviewer-id=".length);
    }
    else if (arg === "--reviewed-at") args.reviewedAt = argv[++index] || null;
    else if (arg.startsWith("--reviewed-at=")) {
      args.reviewedAt = arg.slice("--reviewed-at=".length);
    }
    else if (arg === "--signed-at") args.signedAt = argv[++index] || null;
    else if (arg.startsWith("--signed-at=")) args.signedAt = arg.slice("--signed-at=".length);
    else if (arg === "--full-watch") args.observations.full_watch = true;
    else if (arg === "--full-listen") args.observations.full_listen = true;
    else if (arg === "--av-sync") args.observations.av_sync = true;
    else if (arg === "--caption-readable") args.observations.caption_readability = true;
    else if (arg === "--subject-match") args.observations.subject_match = true;
    else if (arg === "--no-freeze") args.observations.no_freeze = true;
    else if (arg === "--no-black") args.observations.no_black = true;
    else if (arg === "--no-blur") args.observations.no_blur = true;
    else if (arg === "--no-repetition") args.observations.no_repetition = true;
    else if (arg === "--no-defects") args.noDefects = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/goal-final-av-review-signoff.js --artifact-dir <dir> --final-mp4 <path> [options]",
    "",
    "Approve one bound final AV review only after an actual clean human watch and listen.",
    "",
    "Required approval flags:",
    "  --reviewer-id <id> --full-watch --full-listen --av-sync",
    "  --caption-readable --subject-match --no-freeze --no-black",
    "  --no-blur --no-repetition --no-defects --operator-confirmed --apply",
    "",
    "Optional:",
    "  --story-id <id> --reviewed-at <iso> --signed-at <iso> --json",
  ].join("\n");
}

function requiredArgs(args) {
  const missing = [];
  if (!args.artifactDir) missing.push("--artifact-dir");
  if (!args.finalMp4Path) missing.push("--final-mp4");
  if (!args.reviewerId) missing.push("--reviewer-id");
  if (!args.noDefects) missing.push("--no-defects");
  if (missing.length) throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
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
  const finalMp4Path = path.isAbsolute(args.finalMp4Path)
    ? path.resolve(args.finalMp4Path)
    : path.resolve(artifactDir, args.finalMp4Path);
  const now = new Date().toISOString();
  const result = await signOffFinalAvReview({
    storyId: args.storyId,
    artifactDir,
    finalMp4Path,
    reviewerId: args.reviewerId,
    reviewedAt: args.reviewedAt || now,
    signedAt: args.signedAt || args.reviewedAt || now,
    observations: args.observations,
    defects: [],
    operatorConfirmed: args.operatorConfirmed,
    apply: args.apply,
  });
  if (args.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write([
      `[goal-final-av-review-signoff] ${result.verdict} story=${result.story_id}`,
      `applied=${result.applied}`,
      `reviewer=${result.reviewer_id}`,
      `can_auto_publish=${result.can_auto_publish}`,
      "",
    ].join("\n"));
  }
  return result;
}

async function runCli(argv = process.argv.slice(2)) {
  try {
    await main(argv);
  } catch (error) {
    process.stderr.write(
      `[goal-final-av-review-signoff] FAILED: ${error.stack || error.message}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  main,
  parseArgs,
  requiredArgs,
  runCli,
  usage,
};
