#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");

/**
 * tools/render-health.js — print the render-health digest on demand.
 *
 * Same digest the daily 09:30 UTC scheduler posts to Discord. Useful
 * when an operator wants to inspect render quality after a produce
 * cycle without waiting for tomorrow morning.
 *
 * Usage:
 *   node tools/render-health.js              # last 24h, markdown to stdout
 *   node tools/render-health.js --hours 72   # custom window
 *   node tools/render-health.js --json       # machine-readable summary
 *
 * Reads the same canonical store the production cron job uses
 * (lib/db.getStories) so local dev and Railway both work.
 */

const {
  runRenderHealthDigest,
} = require("../lib/intelligence/render-health-digest");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BRIDGE_CANDIDATES_PATH = path.join(
  ROOT,
  "output",
  "goal-contract",
  "scheduler_bridge_candidates.json",
);

function parseArgs(argv) {
  const args = {
    hours: 24,
    json: false,
    bridgeCandidatesPath: DEFAULT_BRIDGE_CANDIDATES_PATH,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      args.json = true;
    } else if (a === "--hours" || a === "-h") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) args.hours = n;
    } else if (a.startsWith("--hours=")) {
      const n = Number(a.slice("--hours=".length));
      if (Number.isFinite(n) && n > 0) args.hours = n;
    } else if (a === "--bridge-candidates" || a === "--bridge") {
      args.bridgeCandidatesPath = argv[++i] || "";
    } else if (a.startsWith("--bridge-candidates=")) {
      args.bridgeCandidatesPath = a.slice("--bridge-candidates=".length);
    } else if (a.startsWith("--bridge=")) {
      args.bridgeCandidatesPath = a.slice("--bridge=".length);
    } else if (a === "--no-bridge-candidates" || a === "--no-bridge") {
      args.bridgeCandidatesPath = "";
    } else if (a === "--help" || a === "-?") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/render-health.js [--hours N] [--json]\n" +
      "  --hours N   Look-back window in hours (default 24)\n" +
      "  --json      Print the summary as JSON instead of markdown\n" +
      "  --bridge-candidates PATH  Include governed V4 bridge candidates\n" +
      "  --no-bridge-candidates    Ignore bridge candidates\n",
  );
}

function resolveCandidatePath(candidatePath) {
  if (!candidatePath) return "";
  return path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(ROOT, candidatePath);
}

function readBridgeCandidates(candidatePath) {
  const resolved = resolveCandidatePath(candidatePath);
  if (!resolved || !fs.existsSync(resolved)) return [];

  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.candidates)
      ? parsed.candidates
      : Array.isArray(parsed.scheduler_bridge_candidates)
        ? parsed.scheduler_bridge_candidates
        : [];

  const loadedAt = new Date().toISOString();
  return candidates.map((candidate) => ({
    ...candidate,
    _bridge_loaded_at: loadedAt,
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  // Keep the operator artefact clean; lib/db logs connection details via
  // console.log during module initialisation.
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  const bridgeCandidates = readBridgeCandidates(args.bridgeCandidatesPath);
  const result = await runRenderHealthDigest({
    windowHours: args.hours,
    bridgeCandidates,
  });
  const { summary, markdown } = result;
  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }
}

main().catch((err) => {
  // Stay non-zero on hard failures so callers (cron, ad-hoc shell
  // scripts) can detect a broken digest.
  process.stderr.write(`[render-health] ${err.stack || err.message}\n`);
  process.exit(1);
});
