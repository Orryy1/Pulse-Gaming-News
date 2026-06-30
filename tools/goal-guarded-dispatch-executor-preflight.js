#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGuardedDispatchExecutorPreflight,
  renderGuardedDispatchExecutorPreflightMarkdown,
  writeGuardedDispatchExecutorPreflight,
} = require("../lib/goal-guarded-dispatch-executor-preflight");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    guardedDispatchPlanPath: null,
    platformStatusMatrixPath: null,
    runtimeHealthUrl: process.env.PULSE_RUNTIME_HEALTH_URL || "http://127.0.0.1:3001/api/health",
    runtimeHealthTimeoutMs: Number(process.env.PULSE_RUNTIME_HEALTH_TIMEOUT_MS || 1500),
    useRuntimeHealth: true,
    actionIds: [],
    selectAllDispatchReady: false,
    allowNonGreenPlanOverwrite: false,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--guarded-dispatch-plan") args.guardedDispatchPlanPath = argv[++i] || "";
    else if (arg === "--platform-status-matrix") args.platformStatusMatrixPath = argv[++i] || "";
    else if (arg === "--runtime-health-url") args.runtimeHealthUrl = argv[++i] || "";
    else if (arg === "--runtime-health-timeout-ms") {
      args.runtimeHealthTimeoutMs = Number(argv[++i] || args.runtimeHealthTimeoutMs);
    } else if (arg === "--no-runtime-health") {
      args.useRuntimeHealth = false;
    }
    else if (arg === "--action-id") args.actionIds.push(argv[++i] || "");
    else if (arg === "--action-ids") {
      args.actionIds.push(...String(argv[++i] || "").split(","));
    } else if (arg === "--select-all-dispatch-ready") {
      args.selectAllDispatchReady = true;
    } else if (arg === "--allow-non-green-plan-overwrite") {
      args.allowNonGreenPlanOverwrite = true;
    } else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.actionIds = args.actionIds.map((item) => String(item || "").trim()).filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-guarded-dispatch-executor-preflight -- [options]",
    "",
    "Options:",
    "  --root <dir>                    Workspace root",
    "  --guarded-dispatch-plan <path>   guarded_dispatch_plan.json",
    "  --platform-status-matrix <path>  platform_status_matrix.json",
    "  --runtime-health-url <url>        Optional local /api/health source for diagnostic executor state",
    "  --runtime-health-timeout-ms <ms>  Runtime health timeout (default 1500)",
    "  --no-runtime-health               Do not use live runtime health as a diagnostic fallback",
    "  --action-id <story:platform>     Explicit action to hand off; repeatable",
    "  --action-ids <csv>               Explicit action IDs as comma-separated values",
    "  --select-all-dispatch-ready      Explicitly hand off every dispatch-ready action",
    "  --allow-non-green-plan-overwrite Allow AMBER/RED context-only diagnostics to replace an existing GREEN executor plan",
    "  --out-dir <dir>                  Output directory",
    "  --generated-at <iso>             Fixed timestamp",
    "  --json                           Print JSON",
    "",
    "Final no-posting handoff preflight before any guarded live dispatch executor.",
    "This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function readRuntimeHealth({ url, timeoutMs = 1500, enabled = true } = {}) {
  if (!enabled || !url || typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs) || 1500);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const guardedDispatchPlanPath = args.guardedDispatchPlanPath
    ? path.resolve(root, args.guardedDispatchPlanPath)
    : path.join(root, "output", "goal-contract", "guarded_dispatch_plan.json");
  const platformStatusMatrixPath = args.platformStatusMatrixPath
    ? path.resolve(root, args.platformStatusMatrixPath)
    : path.join(root, "output", "goal-contract", "platform_status_matrix.json");

  const runtimeHealth = await readRuntimeHealth({
    url: args.runtimeHealthUrl,
    timeoutMs: args.runtimeHealthTimeoutMs,
    enabled: args.useRuntimeHealth,
  });
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: await readJson(guardedDispatchPlanPath, "guarded dispatch plan"),
    platformStatusMatrix: await readJson(platformStatusMatrixPath, "platform status matrix"),
    selectedActionIds: args.actionIds,
    selectAllDispatchReady: args.selectAllDispatchReady,
    env: process.env,
    runtimeHealth,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGuardedDispatchExecutorPreflight(report, {
    outputDir: path.resolve(root, args.outDir),
    preserveExistingReadyExecutorPlanOnContextOnlyNonGreen: !args.allowNonGreenPlanOverwrite,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedDispatchExecutorPreflightMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-guarded-dispatch-executor-preflight] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  readRuntimeHealth,
};
