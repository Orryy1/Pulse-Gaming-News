#!/usr/bin/env node
"use strict";

/**
 * tools/publish-readiness.js — single operator command that gives
 * one GREEN/AMBER/RED verdict for "is it safe to publish right now?"
 *
 * Per the 2026-04-30 mission brief — extends the earlier
 * ops:control-room with the full 20-input pillar set.
 *
 * Usage:
 *   node tools/publish-readiness.js              # markdown
 *   node tools/publish-readiness.js --json
 *   node tools/publish-readiness.js --discord
 *
 * Read-only. Never mutates production. Exits non-zero (2) when
 * verdict is RED, so this can be wired into a pre-deploy preflight
 * chain.
 */

const fs = require("fs-extra");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
require("dotenv").config({ override: false });
const {
  buildPublishReadinessReport,
  formatPublishReadinessMarkdown,
} = require("../lib/ops/publish-readiness");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const CONTRACT_OUT = path.join(ROOT, "output", "goal-contract");

function parseArgs(argv) {
  const args = {
    json: false,
    discord: false,
    help: false,
    refreshLocalPostingArtifacts: true,
    strictDryRunPlanPath: null,
    schedulerBridgeCandidatesPath: null,
    platformDurationContractPath: null,
  };
  const values = Array.isArray(argv) && argv[0]?.startsWith("--") ? argv : argv.slice(2);
  for (let index = 0; index < values.length; index += 1) {
    const a = values[index];
    if (a === "--json") args.json = true;
    else if (a === "--discord") args.discord = true;
    else if (a === "--no-local-posting-refresh") args.refreshLocalPostingArtifacts = false;
    else if (a === "--dry-run-plan" || a === "--strict-dry-run-plan") {
      args.strictDryRunPlanPath = path.resolve(ROOT, values[++index] || "");
    } else if (a.startsWith("--dry-run-plan=")) {
      args.strictDryRunPlanPath = path.resolve(ROOT, a.slice("--dry-run-plan=".length));
    } else if (a.startsWith("--strict-dry-run-plan=")) {
      args.strictDryRunPlanPath = path.resolve(ROOT, a.slice("--strict-dry-run-plan=".length));
    } else if (a === "--bridge-candidates" || a === "--scheduler-bridge-candidates") {
      args.schedulerBridgeCandidatesPath = path.resolve(ROOT, values[++index] || "");
    } else if (a.startsWith("--bridge-candidates=")) {
      args.schedulerBridgeCandidatesPath = path.resolve(ROOT, a.slice("--bridge-candidates=".length));
    } else if (a.startsWith("--scheduler-bridge-candidates=")) {
      args.schedulerBridgeCandidatesPath = path.resolve(ROOT, a.slice("--scheduler-bridge-candidates=".length));
    } else if (a === "--platform-duration-contract") {
      args.platformDurationContractPath = path.resolve(ROOT, values[++index] || "");
    } else if (a.startsWith("--platform-duration-contract=")) {
      args.platformDurationContractPath = path.resolve(ROOT, a.slice("--platform-duration-contract=".length));
    }
    else if (a === "--help" || a === "-?") args.help = true;
  }
  return args;
}

function tailLines(value, maxLines = 8) {
  return String(value || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines);
}

function runRefreshScript(scriptName, args = []) {
  const scriptPath = path.join(ROOT, "tools", scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
  });
  return {
    script: scriptName,
    args,
    exit_code: result.status,
    signal: result.signal || null,
    error: result.error ? result.error.message : null,
    stdout_tail: tailLines(result.stdout),
    stderr_tail: tailLines(result.stderr),
  };
}

async function refreshLocalPostingArtifacts() {
  const commands = [
    runRefreshScript("local-primary-readiness.js", ["--json"]),
    runRefreshScript("local-tunnel-readiness.js", ["--json"]),
    runRefreshScript("local-cutover-plan.js", ["--json"]),
    runRefreshScript("local-tts-doctor.js"),
    runRefreshScript("local-posting-readiness.js", ["--json"]),
  ];
  return {
    refreshed_at: new Date().toISOString(),
    safety: "read-only local proof refresh; no publish, DB edit, OAuth, token, billing or platform-setting mutation",
    commands,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/publish-readiness.js [--json] [--discord]\n" +
        "  --json     Emit the full JSON report to stdout\n" +
        "  --discord  Also post the markdown verdict to Discord\n" +
        "  --no-local-posting-refresh  Do not refresh local posting/TTS evidence before verdict\n" +
        "  --dry-run-plan <path>  Strict dry-run plan to evaluate\n" +
        "  --bridge-candidates <path>  Scheduler bridge candidates to evaluate\n" +
        "  --platform-duration-contract <path>  Platform duration contract report\n",
    );
    return;
  }

  const report = await buildPublishReadinessReport({
    strictDryRunPlanPath: args.strictDryRunPlanPath || undefined,
    schedulerBridgeCandidatesPath: args.schedulerBridgeCandidatesPath || undefined,
    platformDurationContractPath: args.platformDurationContractPath || undefined,
    refreshLocalPostingArtifacts: args.refreshLocalPostingArtifacts,
    localPostingArtifactRefresh: args.refreshLocalPostingArtifacts
      ? refreshLocalPostingArtifacts
      : undefined,
  });
  const markdown = formatPublishReadinessMarkdown(report);

  try {
    await fs.ensureDir(OUT);
    await fs.ensureDir(CONTRACT_OUT);
    await fs.writeJson(path.join(OUT, "publish_readiness.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "publish_readiness.md"),
      markdown,
      "utf-8",
    );
    await fs.writeJson(
      path.join(CONTRACT_OUT, "publish_readiness_report.json"),
      report,
      { spaces: 2 },
    );
    await fs.writeFile(
      path.join(CONTRACT_OUT, "publish_readiness_report.md"),
      markdown,
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(
      `[publish-readiness] persist failed: ${err.message}\n`,
    );
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }

  if (args.discord) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(markdown);
    } catch (err) {
      process.stderr.write(
        `[publish-readiness] discord post failed: ${err.message}\n`,
      );
    }
  }

  if (report.overall_verdict === "red") process.exit(2);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[publish-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  refreshLocalPostingArtifacts,
  main,
};
