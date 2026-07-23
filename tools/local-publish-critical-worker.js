#!/usr/bin/env node
"use strict";

const os = require("node:os");

const PUBLISH_WORKER_KINDS = Object.freeze([
  "publish_schedule_recovery_monitor",
  "publish_window_watchdog",
  "publish",
]);
const DEFAULT_RECOVERY_MONITOR_TIMEOUT_MS = 120_000;
const MIN_RECOVERY_MONITOR_TIMEOUT_MS = 30_000;
const MAX_RECOVERY_MONITOR_TIMEOUT_MS = 10 * 60_000;

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function assertGuardedRuntimeContract(env = process.env) {
  const failures = [];
  if (!truthy(env.AUTO_PUBLISH)) failures.push("AUTO_PUBLISH=true");
  if (!truthy(env.USE_JOB_QUEUE)) failures.push("USE_JOB_QUEUE=true");
  if (!truthy(env.USE_SQLITE)) failures.push("USE_SQLITE=true");
  if (!truthy(env.PULSE_PRIMARY_INSTANCE)) failures.push("PULSE_PRIMARY_INSTANCE=true");
  if (!truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED)) {
    failures.push("PULSE_GUARDED_LIVE_DISPATCH_ENABLED=true");
  }
  if (String(env.PULSE_EMERGENCY_KILL_SWITCH || "").trim().toLowerCase() !== "clear") {
    failures.push("kill switch must be clear");
  }
  if (failures.length) {
    throw new Error(
      `Refusing guarded publish worker startup: ${failures.join("; ")}`,
    );
  }
}

function recoveryMonitorTimeoutMs(env = process.env) {
  const raw = String(
    env.PULSE_PUBLISH_RECOVERY_MONITOR_TIMEOUT_MS || "",
  ).trim();
  if (!raw) return DEFAULT_RECOVERY_MONITOR_TIMEOUT_MS;

  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_RECOVERY_MONITOR_TIMEOUT_MS ||
    timeoutMs > MAX_RECOVERY_MONITOR_TIMEOUT_MS
  ) {
    throw new Error(
      "PULSE_PUBLISH_RECOVERY_MONITOR_TIMEOUT_MS must be an integer " +
        `between ${MIN_RECOVERY_MONITOR_TIMEOUT_MS} and ` +
        `${MAX_RECOVERY_MONITOR_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    help: false,
    workerId:
      String(env.PULSE_PUBLISH_CRITICAL_WORKER_ID || "").trim() ||
      `pulse-live-publish-critical-${os.hostname()}-${process.pid}`,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "-?") args.help = true;
    else if (arg === "--worker-id") args.workerId = argv[++index] || args.workerId;
    else if (arg.startsWith("--worker-id=")) {
      args.workerId = arg.slice("--worker-id=".length) || args.workerId;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/local-publish-critical-worker.js [options]",
    "",
    "Runs the guarded publish/recovery queue lanes outside the HTTP scheduler process.",
    "The worker cannot widen its job kinds from the command line.",
    "",
    "Options:",
    "  --worker-id <id>   Stable worker id",
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

  assertGuardedRuntimeContract(env);
  env.PULSE_PUBLISH_CRITICAL_RUNNER = "false";
  env.PULSE_MAINTENANCE_RUNNER = "false";

  const bootstrap = options.bootstrap || require("../lib/bootstrap-queue");
  const exit = options.exit || ((code) => process.exit(code));
  const monitorTimeoutMs = recoveryMonitorTimeoutMs(env);
  const state = await bootstrap.start({
    workerId: args.workerId,
    runScheduler: false,
    runRunner: true,
    runGeneralRunner: true,
    kinds: [...PUBLISH_WORKER_KINDS],
    gpu: false,
    autoSeed: false,
    handlerTimeoutMsByKind: {
      publish_schedule_recovery_monitor: monitorTimeoutMs,
    },
    stopOnHandlerTimeout: true,
    onHandlerTimeout: async (error, job) => {
      io.stderr.write(
        `[local-publish-critical-worker] fatal handler timeout ` +
          `job=${job?.id ?? "unknown"} kind=${job?.kind || "unknown"} ` +
          `timeout_ms=${error?.timeoutMs || monitorTimeoutMs}; exiting\n`,
      );
      exit(70);
    },
    log: (message) => io.stderr.write(`${message}\n`),
  });

  io.stderr.write(
    `[local-publish-critical-worker] running worker=${args.workerId} kinds=${PUBLISH_WORKER_KINDS.join(",")}\n`,
  );

  if (options.installSignalHandlers !== false) {
    const stop = async (signal) => {
      io.stderr.write(
        `[local-publish-critical-worker] ${signal} received; stopping\n`,
      );
      await bootstrap.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
  }

  return { status: "running", args, state };
}

if (require.main === module) {
  require("dotenv").config({ override: false, quiet: true });
  main().catch((error) => {
    process.stderr.write(
      `[local-publish-critical-worker] ${error.stack || error.message}\n`,
    );
    process.exit(1);
  });
}

module.exports = {
  PUBLISH_WORKER_KINDS,
  DEFAULT_RECOVERY_MONITOR_TIMEOUT_MS,
  assertGuardedRuntimeContract,
  recoveryMonitorTimeoutMs,
  parseArgs,
  usage,
  main,
};
