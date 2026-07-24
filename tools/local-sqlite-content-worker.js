#!/usr/bin/env node
"use strict";

const os = require("node:os");

const CONTENT_WORKER_THREAD_ENV_KEYS = Object.freeze([
  "OMP_NUM_THREADS",
  "OPENBLAS_NUM_THREADS",
  "MKL_NUM_THREADS",
  "NUMEXPR_NUM_THREADS",
  "VECLIB_MAXIMUM_THREADS",
  "VIPS_CONCURRENCY",
]);
const CONTENT_WORKER_RESOURCE_ENV_KEYS = Object.freeze([
  "PULSE_CONTENT_WORKER_RESOURCE_CLASS",
  "PULSE_CONTENT_WORKER_THREAD_BUDGET",
  ...CONTENT_WORKER_THREAD_ENV_KEYS,
  "TOKENIZERS_PARALLELISM",
]);

function captureResourceEnvironment(env = process.env) {
  return Object.fromEntries(
    CONTENT_WORKER_RESOURCE_ENV_KEYS.map((key) => [key, env[key]]),
  );
}

function reassertResourceEnvironment(inheritedEnv, env = process.env) {
  for (const key of CONTENT_WORKER_RESOURCE_ENV_KEYS) {
    if (inheritedEnv[key] === undefined) delete env[key];
    else env[key] = inheritedEnv[key];
  }
}

const INHERITED_CONTENT_WORKER_RESOURCE_ENV = captureResourceEnvironment();

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

reassertResourceEnvironment(INHERITED_CONTENT_WORKER_RESOURCE_ENV);

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

function assertContentWorkerResourceContract(env = process.env) {
  const violations = [];
  const threadBudget = String(env.PULSE_CONTENT_WORKER_THREAD_BUDGET || "");

  if (env.PULSE_CONTENT_WORKER_RESOURCE_CLASS !== "background") {
    violations.push("resource class must be background");
  }
  if (!/^\d+$/.test(threadBudget) || Number(threadBudget) < 1) {
    violations.push("thread budget must be a positive integer");
  } else {
    for (const key of CONTENT_WORKER_THREAD_ENV_KEYS) {
      if (String(env[key] || "") !== threadBudget) {
        violations.push(`${key} must match the thread budget`);
      }
    }
  }
  if (env.TOKENIZERS_PARALLELISM !== "false") {
    violations.push("TOKENIZERS_PARALLELISM must be false");
  }

  if (violations.length) {
    throw new Error(
      "Direct live content-worker execution requires the approved Windows wrapper and resource contract. " +
        `Run npm run ops:local-sqlite-content-worker. Invalid contract: ${violations.join("; ")}`,
    );
  }
}

function createContentWorkerClaimGuard({
  env = process.env,
  evaluateQuietPeriod = null,
  kinds = [],
} = {}) {
  if (/^(false|0|no|off)$/i.test(
    String(env.PULSE_CONTENT_WORKER_QUIET_PERIOD || "").trim(),
  )) {
    return null;
  }
  const evaluate = evaluateQuietPeriod ||
    require("../lib/ops/publish-worker-quiet-period").evaluatePublishWorkerQuietPeriod;
  const beforeMinutes = env.PULSE_CONTENT_WORKER_QUIET_BEFORE_MINUTES;
  const afterMinutes = env.PULSE_CONTENT_WORKER_QUIET_AFTER_MINUTES;
  return ({ now = new Date(), kinds: claimedKinds = kinds } = {}) => evaluate({
    now,
    beforeMinutes,
    afterMinutes,
    kinds: claimedKinds,
  });
}

function contentWorkerHandlerTimeouts(kinds = [], env = process.env) {
  if (!kinds.includes("candidate_supply_monitor")) return {};
  const configured = Number(
    env.PULSE_CANDIDATE_SUPPLY_HANDLER_TIMEOUT_MS || 15 * 60 * 1000,
  );
  const timeoutMs = Math.min(
    30 * 60 * 1000,
    Math.max(
      60 * 1000,
      Number.isFinite(configured) ? configured : 15 * 60 * 1000,
    ),
  );
  return { candidate_supply_monitor: timeoutMs };
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const configuredLeaseMs = Number(env.PULSE_CONTENT_WORKER_LEASE_MS || 30 * 60 * 1000);
  const args = {
    help: false,
    workerId: env.PULSE_CONTENT_WORKER_ID || `content-${os.hostname()}-${process.pid}`,
    kinds: parseCsv(env.PULSE_CONTENT_WORKER_KINDS).length
      ? parseCsv(env.PULSE_CONTENT_WORKER_KINDS)
      : [...DEFAULT_CONTENT_KINDS],
    gpu: /^(true|1|yes|on)$/i.test(String(env.PULSE_CONTENT_WORKER_GPU || "")),
    leaseMs: Math.min(
      2 * 60 * 60 * 1000,
      Math.max(5 * 60 * 1000, Number.isFinite(configuredLeaseMs) ? configuredLeaseMs : 30 * 60 * 1000),
    ),
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

async function main(
  argv = process.argv.slice(2),
  io = { stdout: process.stdout, stderr: process.stderr },
  options = {},
) {
  const env = options.env || process.env;
  const args = parseArgs(argv, env);
  if (args.help) {
    io.stdout.write(`${usage()}\n`);
    return { status: "help", args };
  }
  if (options.requireResourceContract) {
    assertContentWorkerResourceContract(
      options.resourceEnv || INHERITED_CONTENT_WORKER_RESOURCE_ENV,
    );
  }

  if (!process.env.USE_SQLITE) process.env.USE_SQLITE = "true";
  if (!process.env.PULSE_PRIMARY_INSTANCE) process.env.PULSE_PRIMARY_INSTANCE = "true";
  process.env.PULSE_PUBLISH_CRITICAL_RUNNER = "false";
  process.env.PULSE_MAINTENANCE_RUNNER = "false";

  const claimGuard = options.claimGuard === undefined
    ? createContentWorkerClaimGuard({ env, kinds: args.kinds })
    : options.claimGuard;
  const bootstrap = options.bootstrap || require("../lib/bootstrap-queue");
  const exit = options.exit || ((code) => process.exit(code));
  const handlerTimeoutMsByKind = contentWorkerHandlerTimeouts(args.kinds, env);
  const state = await bootstrap.start({
    workerId: args.workerId,
    runScheduler: false,
    runRunner: true,
    runGeneralRunner: true,
    kinds: args.kinds,
    gpu: args.gpu,
    leaseMs: args.leaseMs,
    claimGuard,
    handlerTimeoutMsByKind,
    stopOnHandlerTimeout: Object.keys(handlerTimeoutMsByKind).length > 0,
    onHandlerTimeout: async (error, job) => {
      io.stderr.write(
        `[local-sqlite-content-worker] fatal handler timeout ` +
          `job=${job?.id ?? "unknown"} kind=${job?.kind || "unknown"} ` +
          `timeout_ms=${error?.timeoutMs || handlerTimeoutMsByKind[job?.kind] || "unknown"}; exiting\n`,
      );
      exit(70);
    },
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
  main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr }, {
    requireResourceContract: true,
  }).catch((err) => {
    process.stderr.write(`[local-sqlite-content-worker] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CONTENT_KINDS,
  FORBIDDEN_CONTENT_WORKER_KINDS,
  assertContentOnlyKinds,
  assertContentWorkerResourceContract,
  contentWorkerHandlerTimeouts,
  createContentWorkerClaimGuard,
  parseArgs,
  usage,
  main,
};
