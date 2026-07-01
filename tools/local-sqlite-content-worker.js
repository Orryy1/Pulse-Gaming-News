#!/usr/bin/env node
"use strict";

const os = require("node:os");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const DEFAULT_CONTENT_KINDS = Object.freeze([
  "hunt",
  "produce",
  "analytics",
  "scoring_digest",
  "engage",
  "engage_first_hour",
  "blog_rebuild",
  "db_backup",
  "instagram_pending_verify",
  "overnight_produce_sweep",
  "overnight_analytics_backfill",
  "overnight_claude_analyst",
  "overnight_morning_digest",
  "live_performance_analyst",
  "studio_analytics_loop",
  "commercial_learning_loop",
  "competitor_forensics_lab",
  "competitor_quality_gate",
  "candidate_supply_monitor",
  "fresh_production_refill",
  "fresh_review_script_repair",
  "safe_auto_repair_runner",
  "local_tts_doctor",
  "local_tts_retry_recovery",
  "autonomous_feedback_monitor",
  "continuous_learning_loop",
]);
const FORBIDDEN_CONTENT_WORKER_KINDS = Object.freeze([
  "publish",
  "publish_window_watchdog",
  "instagram_token_refresh",
  "tiktok_auth_check",
]);

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertContentOnlyKinds(kinds) {
  for (const kind of kinds || []) {
    if (FORBIDDEN_CONTENT_WORKER_KINDS.includes(kind)) {
      throw new Error(`Forbidden live publish or credential job kind: ${kind}`);
    }
  }
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    help: false,
    workerId: env.PULSE_CONTENT_WORKER_ID || `content-${os.hostname()}-${process.pid}`,
    kinds: parseCsv(env.PULSE_CONTENT_WORKER_KINDS).length
      ? parseCsv(env.PULSE_CONTENT_WORKER_KINDS)
      : [...DEFAULT_CONTENT_KINDS],
    gpu: /^(true|1|yes|on)$/i.test(String(env.PULSE_CONTENT_WORKER_GPU || "")),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "-?") args.help = true;
    else if (arg === "--worker-id") args.workerId = argv[++i] || args.workerId;
    else if (arg.startsWith("--worker-id=")) args.workerId = arg.slice("--worker-id=".length);
    else if (arg === "--kinds") args.kinds = parseCsv(argv[++i]);
    else if (arg.startsWith("--kinds=")) args.kinds = parseCsv(arg.slice("--kinds=".length));
    else if (arg === "--gpu") args.gpu = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assertContentOnlyKinds(args.kinds);
  return args;
}

function usage() {
  return [
    "Usage: node tools/local-sqlite-content-worker.js [options]",
    "",
    "Runs a runner-only local SQLite worker for non-publish content jobs.",
    "It does not start the HTTP server, scheduler, publish watchdog or publish runner.",
    "",
    "Options:",
    "  --worker-id <id>   Stable worker id",
    "  --kinds <csv>      Job kinds to claim; defaults to content/refill/repair jobs",
    "  --gpu              Claim GPU-required jobs only",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const args = parseArgs(argv);
  if (args.help) {
    io.stdout.write(`${usage()}\n`);
    return { status: "help", args };
  }

  if (!process.env.USE_SQLITE) process.env.USE_SQLITE = "true";
  if (!process.env.PULSE_PRIMARY_INSTANCE) process.env.PULSE_PRIMARY_INSTANCE = "true";
  process.env.PULSE_PUBLISH_CRITICAL_RUNNER = "false";
  process.env.PULSE_MAINTENANCE_RUNNER = "false";

  const bootstrap = require("../lib/bootstrap-queue");
  const state = await bootstrap.start({
    workerId: args.workerId,
    runScheduler: false,
    runRunner: true,
    runGeneralRunner: true,
    kinds: args.kinds,
    gpu: args.gpu,
    autoSeed: false,
    log: (message) => io.stderr.write(`${message}\n`),
  });

  io.stderr.write(
    `[local-sqlite-content-worker] running worker=${args.workerId} kinds=${args.kinds.join(",")} gpu=${args.gpu}\n`,
  );

  const stop = async (signal) => {
    io.stderr.write(`[local-sqlite-content-worker] ${signal} received; stopping\n`);
    await bootstrap.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  return { status: "running", args, state };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-sqlite-content-worker] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONTENT_KINDS,
  FORBIDDEN_CONTENT_WORKER_KINDS,
  assertContentOnlyKinds,
  parseArgs,
  usage,
  main,
};
