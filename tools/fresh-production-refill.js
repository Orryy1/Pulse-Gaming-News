#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ quiet: true, override: true });

const ROOT = path.resolve(__dirname, "..");

function stampFor(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  return `${date}-${time}`;
}

function resolveRepoPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(ROOT, text);
}

function parseArgs(argv = process.argv.slice(2), { now = new Date() } = {}) {
  const stamp = stampFor(now instanceof Date ? now : new Date(now));
  const args = {
    json: false,
    help: false,
    channelId: process.env.CHANNEL || "pulse-gaming",
    limit: 12,
    rssPerFeed: 4,
    outDir: path.join(ROOT, "output", "fresh-green-refill", stamp, "goal-proof-batch"),
    contractOutDir: path.join(ROOT, "output", "fresh-green-refill", stamp, "goal-contract"),
    repairEvidence: true,
    repairEvidenceMode: "plan",
    repairStoryLimit: 3,
    storiesFile: "",
    resumeStoryPackagesPath: "",
    segmentReportPath: "",
    realMotionOutDir: "",
    realMotionArtifactRoot: "",
    ttsProvider: "",
    targetPlatforms: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--channel-id") args.channelId = argv[++i] || args.channelId;
    else if (arg.startsWith("--channel-id=")) args.channelId = arg.slice("--channel-id=".length);
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--rss-per-feed") args.rssPerFeed = Number(argv[++i] || args.rssPerFeed);
    else if (arg.startsWith("--rss-per-feed=")) args.rssPerFeed = Number(arg.slice("--rss-per-feed=".length));
    else if (arg === "--out-dir") args.outDir = resolveRepoPath(argv[++i] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = resolveRepoPath(arg.slice("--out-dir=".length));
    else if (arg === "--contract-out-dir") args.contractOutDir = resolveRepoPath(argv[++i] || args.contractOutDir);
    else if (arg.startsWith("--contract-out-dir=")) args.contractOutDir = resolveRepoPath(arg.slice("--contract-out-dir=".length));
    else if (arg === "--stories-file") args.storiesFile = resolveRepoPath(argv[++i] || "");
    else if (arg.startsWith("--stories-file=")) args.storiesFile = resolveRepoPath(arg.slice("--stories-file=".length));
    else if (arg === "--resume-story-packages") args.resumeStoryPackagesPath = resolveRepoPath(argv[++i] || "");
    else if (arg.startsWith("--resume-story-packages=")) args.resumeStoryPackagesPath = resolveRepoPath(arg.slice("--resume-story-packages=".length));
    else if (arg === "--segment-report") args.segmentReportPath = resolveRepoPath(argv[++i] || "");
    else if (arg.startsWith("--segment-report=")) args.segmentReportPath = resolveRepoPath(arg.slice("--segment-report=".length));
    else if (arg === "--real-motion-out-dir") args.realMotionOutDir = resolveRepoPath(argv[++i] || "");
    else if (arg.startsWith("--real-motion-out-dir=")) args.realMotionOutDir = resolveRepoPath(arg.slice("--real-motion-out-dir=".length));
    else if (arg === "--real-motion-artifact-root") args.realMotionArtifactRoot = resolveRepoPath(argv[++i] || "");
    else if (arg.startsWith("--real-motion-artifact-root=")) args.realMotionArtifactRoot = resolveRepoPath(arg.slice("--real-motion-artifact-root=".length));
    else if (arg === "--tts-provider") args.ttsProvider = String(argv[++i] || "").trim().toLowerCase();
    else if (arg.startsWith("--tts-provider=")) args.ttsProvider = String(arg.slice("--tts-provider=".length) || "").trim().toLowerCase();
    else if (arg === "--platforms") {
      args.targetPlatforms = String(argv[++i] || "")
        .split(",")
        .map((platform) => platform.trim().toLowerCase())
        .filter(Boolean);
    }
    else if (arg.startsWith("--platforms=")) {
      args.targetPlatforms = String(arg.slice("--platforms=".length) || "")
        .split(",")
        .map((platform) => platform.trim().toLowerCase())
        .filter(Boolean);
    }
    else if (arg === "--repair-story-limit") args.repairStoryLimit = Number(argv[++i] || args.repairStoryLimit);
    else if (arg.startsWith("--repair-story-limit=")) args.repairStoryLimit = Number(arg.slice("--repair-story-limit=".length));
    else if (arg === "--repair-evidence-mode") args.repairEvidenceMode = String(argv[++i] || args.repairEvidenceMode).trim().toLowerCase();
    else if (arg.startsWith("--repair-evidence-mode=")) args.repairEvidenceMode = String(arg.slice("--repair-evidence-mode=".length) || "").trim().toLowerCase();
    else if (arg === "--full-repair-evidence") args.repairEvidenceMode = "full";
    else if (arg === "--no-repair-evidence") args.repairEvidence = false;
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 12;
  if (!Number.isFinite(args.rssPerFeed) || args.rssPerFeed <= 0) args.rssPerFeed = 4;
  args.limit = Math.max(1, Math.min(30, Math.round(args.limit)));
  args.rssPerFeed = Math.max(1, Math.min(10, Math.round(args.rssPerFeed)));
  if (!Number.isFinite(args.repairStoryLimit) || args.repairStoryLimit < 0) args.repairStoryLimit = 3;
  args.repairStoryLimit = Math.max(0, Math.min(30, Math.round(args.repairStoryLimit)));
  if (!["plan", "full"].includes(args.repairEvidenceMode)) args.repairEvidenceMode = "plan";
  args.channelId = String(args.channelId || "pulse-gaming").trim() || "pulse-gaming";
  if (!["", "local", "elevenlabs"].includes(args.ttsProvider)) args.ttsProvider = "";
  if (Array.isArray(args.targetPlatforms)) {
    args.targetPlatforms = [...new Set(args.targetPlatforms)];
    if (!args.targetPlatforms.length) args.targetPlatforms = null;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/fresh-production-refill.js [options]",
    "",
    "Runs the existing fresh_production_refill scheduler handler as a local-only proof/refill job.",
    "It does not publish, mutate production DB rows, touch OAuth/tokens or enable disabled platforms.",
    "",
    "Options:",
    "  --limit <n>              Max live-RSS stories to package, default 12",
    "  --rss-per-feed <n>       Live RSS rows per feed, default 4",
    "  --out-dir <path>         Proof-package output directory",
    "  --contract-out-dir <p>   Contract/report output directory",
    "  --stories-file <path>    Optional local fresh official/direct-media story seed file",
    "  --resume-story-packages <p> Resume materialisation from an existing motion-hydrated story-packages.json",
    "  --segment-report <path> Run-scoped validated segment report used by resume materialisation",
    "  --real-motion-out-dir <p> Existing motion-pack directory used by resume materialisation",
    "  --real-motion-artifact-root <p> Proof artefact root where resumed motion clips are materialised",
    "  --tts-provider <name>     Optional narration provider for repair continuation: local or elevenlabs",
    "  --platforms <csv>         Rights-gate scope for explicitly enabled publish platforms",
    "  --repair-evidence-mode    plan (default) writes fast work orders; full runs deep local repair",
    "  --full-repair-evidence    Alias for --repair-evidence-mode full",
    "  --repair-story-limit <n>  Limit heavy repair evidence to first n eligible RED packages, default 3; 0 = no limit",
    "  --no-repair-evidence     Skip local repair-evidence child commands",
    "  --json                   Print machine-readable result",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const args = parseArgs(argv);
  if (args.help) {
    io.stdout.write(`${usage()}\n`);
    return { args, status: "help" };
  }
  const { handlers } = require("../lib/job-handlers");
  const result = await handlers.fresh_production_refill(
    {
      kind: "fresh_production_refill",
      channel_id: args.channelId,
      payload: {
        limit: args.limit,
        rss_per_feed: args.rssPerFeed,
        out_dir: args.outDir,
        contract_out_dir: args.contractOutDir,
        seed_stories_file: args.storiesFile,
        resume_story_packages_path: args.resumeStoryPackagesPath,
        segment_report_path: args.segmentReportPath,
        real_motion_out_dir: args.realMotionOutDir,
        real_motion_artifact_root: args.realMotionArtifactRoot,
        repair_evidence: args.repairEvidence,
        repair_evidence_mode: args.repairEvidenceMode,
        repair_story_limit: args.repairStoryLimit,
        tts_provider_preference: args.ttsProvider || undefined,
        target_platforms: args.targetPlatforms || undefined,
        reason: "operator_safe_fresh_production_refill",
      },
    },
    {
      log(message) {
        io.stderr.write(`[fresh-production-refill] ${message}\n`);
      },
    },
  );
  if (args.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(
      [
        "# Fresh Production Refill",
        "",
        `Status: ${result.status}`,
        `Stories: ${result.story_count || 0}`,
        `GREEN: ${result.green_count || 0}`,
        `RED: ${result.red_count || 0}`,
        `Story packages: ${result.outputs?.storyPackagesPath || "n/a"}`,
        "",
      ].join("\n"),
    );
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[fresh-production-refill] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
