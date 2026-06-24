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
    storiesFile: "",
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
    else if (arg === "--no-repair-evidence") args.repairEvidence = false;
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 12;
  if (!Number.isFinite(args.rssPerFeed) || args.rssPerFeed <= 0) args.rssPerFeed = 4;
  args.limit = Math.max(1, Math.min(30, Math.round(args.limit)));
  args.rssPerFeed = Math.max(1, Math.min(10, Math.round(args.rssPerFeed)));
  args.channelId = String(args.channelId || "pulse-gaming").trim() || "pulse-gaming";
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
        repair_evidence: args.repairEvidence,
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
