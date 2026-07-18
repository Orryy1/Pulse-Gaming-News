#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  buildLongformFlagshipRepairPlan,
  writeLongformFlagshipRepairPlan,
} = require("../lib/longform-flagship-repair-plan");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "output", "release-radar", "current");
const DEFAULT_CANDIDATE_PACKAGE = path.join(DEFAULT_ARTIFACT_DIR, "pulse_release_radar_package.json");
const DEFAULT_FINAL_MP4 = path.join(DEFAULT_ARTIFACT_DIR, "pulse_release_radar_longform.mp4");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output", "longform-flagship-repair-plan");
const DEFAULT_SOURCE_INPUT = path.join(
  ROOT,
  "output",
  "longform-candidate-intake",
  "release_radar_candidates.json",
);

function resolveArg(value, flag) {
  if (!value) throw new Error(`${flag} requires a path`);
  return path.resolve(ROOT, value);
}

function parseArgs(argv = []) {
  const args = {
    candidatePackagePath: DEFAULT_CANDIDATE_PACKAGE,
    finalMp4Path: DEFAULT_FINAL_MP4,
    artifactDir: DEFAULT_ARTIFACT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    repairRoot: null,
    sourceInputPath: DEFAULT_SOURCE_INPUT,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--candidate-package") {
      args.candidatePackagePath = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--candidate-package=")) {
      args.candidatePackagePath = resolveArg(arg.slice("--candidate-package=".length), "--candidate-package");
    } else if (arg === "--final-mp4") {
      args.finalMp4Path = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--final-mp4=")) {
      args.finalMp4Path = resolveArg(arg.slice("--final-mp4=".length), "--final-mp4");
    } else if (arg === "--artifact-dir") {
      args.artifactDir = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--artifact-dir=")) {
      args.artifactDir = resolveArg(arg.slice("--artifact-dir=".length), "--artifact-dir");
    } else if (arg === "--output-dir" || arg === "--out-dir") {
      args.outputDir = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--output-dir=")) {
      args.outputDir = resolveArg(arg.slice("--output-dir=".length), "--output-dir");
    } else if (arg.startsWith("--out-dir=")) {
      args.outputDir = resolveArg(arg.slice("--out-dir=".length), "--out-dir");
    } else if (arg === "--repair-root") {
      args.repairRoot = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--repair-root=")) {
      args.repairRoot = resolveArg(arg.slice("--repair-root=".length), "--repair-root");
    } else if (arg === "--source-input") {
      args.sourceInputPath = resolveArg(argv[++index], arg);
    } else if (arg.startsWith("--source-input=")) {
      args.sourceInputPath = resolveArg(arg.slice("--source-input=".length), "--source-input");
    } else if (arg === "--generated-at") {
      args.generatedAt = argv[++index] || null;
    } else if (arg.startsWith("--generated-at=")) {
      args.generatedAt = arg.slice("--generated-at=".length) || null;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h" || arg === "-?") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.generatedAt && !Number.isFinite(Date.parse(args.generatedAt))) {
    throw new Error("--generated-at must be an ISO-8601 timestamp");
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/longform-flagship-repair-plan.js [options]",
    "",
    "Options:",
    "  --candidate-package <path>  Candidate package JSON",
    "  --final-mp4 <path>           Existing final longform MP4",
    "  --artifact-dir <path>        Adjacent evidence directory",
    "  --output-dir <path>          Disjoint JSON/Markdown proof directory",
    "  --repair-root <path>         Disjoint staging directory named in repair commands",
    "  --source-input <path>        Release Radar candidate input used by the safe render command",
    "  --generated-at <iso>         Fixed proof timestamp",
    "  --json                       Print a bounded JSON completion summary",
    "  --help                       Show this help",
    "",
    "This command only inspects files and writes proof. It cannot publish, mutate a database or token,",
    "change existing production artefacts or create human AV signoff.",
    "",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(usage());
    return { status: "HELP", args };
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  const report = await buildLongformFlagshipRepairPlan({
    candidatePackagePath: args.candidatePackagePath,
    finalMp4Path: args.finalMp4Path,
    artifactDir: args.artifactDir,
    repairRoot: args.repairRoot,
    sourceInputPath: args.sourceInputPath,
    workspaceRoot: ROOT,
    generatedAt,
    ...(dependencies.probeMedia ? { probeMedia: dependencies.probeMedia } : {}),
    ...(dependencies.probeAudio ? { probeAudio: dependencies.probeAudio } : {}),
  });
  const written = await writeLongformFlagshipRepairPlan(report, { outputDir: args.outputDir });
  const summary = {
    status: written.report.status,
    verdict: written.report.verdict,
    green_claimed: false,
    publish_authorised: false,
    blocker_count: written.report.blocker_codes.length,
    repair_action_count: written.report.repair_actions.length,
    final_mp4_duration_seconds: written.report.final_mp4.duration_seconds,
    final_mp4_meets_contract: written.report.final_mp4.meets_flagship_contract,
    json_path: written.jsonPath,
    markdown_path: written.markdownPath,
  };
  if (args.json) stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    stdout.write(
      `Longform flagship repair proof: ${summary.status}; blockers=${summary.blocker_count}; ` +
      `JSON=${summary.json_path}; Markdown=${summary.markdown_path}\n`,
    );
  }
  return { args, report: written.report, written, summary };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[longform-flagship-repair-plan] FAILED: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_CANDIDATE_PACKAGE,
  DEFAULT_FINAL_MP4,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_SOURCE_INPUT,
  main,
  parseArgs,
  usage,
};
