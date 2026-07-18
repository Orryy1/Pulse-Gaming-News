#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  applyPinnedYtDlpUpgrade,
  buildPinnedYtDlpUpgradePlan,
  downloadPinnedYtDlpAsset,
} = require("../lib/pinned-ytdlp-upgrade");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_FILENAME = "pinned_ytdlp_upgrade_evidence.json";

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    binaryPath: null,
    outDir: path.join(ROOT, "output", "toolchain"),
    generatedAt: new Date().toISOString(),
    apply: false,
    operatorConfirmed: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--binary") {
      args.binaryPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--generated-at") {
      args.generatedAt = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function defaultBinaryPath(env = process.env, platform = process.platform) {
  if (env.YTDLP_PATH) return path.resolve(env.YTDLP_PATH);
  return platform === "win32"
    ? path.resolve("C:/yt-dlp/yt-dlp.exe")
    : path.resolve("/usr/local/bin/yt-dlp");
}

function usage() {
  return [
    "Usage: node tools/pinned-ytdlp-upgrade.js [options]",
    "",
    "Verifies the configured yt-dlp binary against the pinned 2026.06.09 release plan.",
    "The default is read-only PLAN_VERIFY. Replacement requires both --apply and --operator-confirmed.",
    "Apply downloads only the pinned official asset, verifies SHA-256 and --version, preserves a backup and uses a same-volume atomic rename.",
    "This command never publishes media, changes OAuth data or prints environment secrets.",
    "",
    "Options:",
    "  --binary <path>         yt-dlp.exe to verify or replace (defaults to YTDLP_PATH)",
    "  --out-dir <dir>         JSON evidence directory",
    "  --generated-at <iso>    Fixed evidence timestamp",
    "  --apply                 Request replacement when the plan requires it",
    "  --operator-confirmed    Independent confirmation required with --apply",
    "  --json                  Print the full JSON evidence to stdout",
    "  --help, -h              Show this help",
  ].join("\n");
}

function formatSummary(report, evidencePath) {
  return [
    "# Pinned yt-dlp Upgrade",
    "",
    `Mode: ${report.mode}`,
    `Verdict: ${report.verdict}`,
    `Current: ${report.current.detected_version || "unavailable"}`,
    `Minimum: ${report.target.minimum_version}`,
    `Action: ${report.apply?.status || report.plan.action}`,
    `Evidence: ${evidencePath}`,
    "",
    "No media was published and no credentials or OAuth data were changed.",
  ].join("\n");
}

function safeCliFailure(error) {
  const code = String((error && error.code) || "");
  if (/^E[A-Z0-9_]{1,30}$/.test(code)) return code;
  const message = String((error && error.message) || "");
  if (/^Unknown argument:/.test(message)) return "unknown_argument";
  if (/ requires a value$/.test(message)) return "argument_value_required";
  return "operation_failed";
}

async function writeEvidence(report, outDir, fsPromises = fs) {
  const resolvedOutDir = path.resolve(outDir);
  await fsPromises.mkdir(resolvedOutDir, { recursive: true });
  const evidencePath = path.join(resolvedOutDir, EVIDENCE_FILENAME);
  await fsPromises.writeFile(
    evidencePath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return evidencePath;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { args, help: true, exitCode: 0 };
  }

  const binaryPath = path.resolve(
    args.binaryPath || defaultBinaryPath(deps.env || process.env, deps.platform),
  );
  const plan = await buildPinnedYtDlpUpgradePlan({
    binaryPath,
    generatedAt: args.generatedAt,
    execFileSync: deps.execFileSync,
    fsPromises: deps.fsPromises,
    hashFile: deps.hashFile,
  });
  const report = args.apply
    ? await applyPinnedYtDlpUpgrade(plan, {
        operatorConfirmed: args.operatorConfirmed,
        download: deps.download || downloadPinnedYtDlpAsset,
        execFileSync: deps.execFileSync,
        fsPromises: deps.fsPromises,
        hashFile: deps.hashFile,
      })
    : plan;
  const evidencePath = await writeEvidence(
    report,
    args.outDir,
    deps.fsPromises || fs,
  );
  stdout.write(
    args.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatSummary(report, evidencePath)}\n`,
  );
  return {
    args,
    report,
    evidencePath,
    exitCode: report.verdict === "GREEN" ? 0 : 2,
  };
}

if (require.main === module) {
  main()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `[pinned-ytdlp-upgrade] FAILED: ${safeCliFailure(error)}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  EVIDENCE_FILENAME,
  defaultBinaryPath,
  formatSummary,
  main,
  parseArgs,
  safeCliFailure,
  usage,
  writeEvidence,
};
