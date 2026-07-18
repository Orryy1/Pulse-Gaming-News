#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  applyPinnedFfmpegUpgrade,
  buildPinnedFfmpegUpgradePlan,
  downloadPinnedFfmpegArchive,
  extractPinnedFfmpegArchive,
} = require("../lib/pinned-ffmpeg-upgrade");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_FILENAME = "pinned_ffmpeg_upgrade_evidence.json";
const SUMMARY_FILENAME = "pinned_ffmpeg_upgrade_summary.md";

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    ffmpegPath: null,
    ffprobePath: null,
    outDir: path.join(ROOT, "output", "toolchain"),
    generatedAt: new Date().toISOString(),
    apply: false,
    operatorConfirmed: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ffmpeg") {
      args.ffmpegPath = takeValue(argv, index, arg);
      index += 1;
    } else if (arg === "--ffprobe") {
      args.ffprobePath = takeValue(argv, index, arg);
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

function defaultBinaryPaths(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    return {
      ffmpegPath: path.resolve(
        env.FFMPEG_PATH || "C:/ffmpeg/bin/ffmpeg.exe",
      ),
      ffprobePath: path.resolve(
        env.FFPROBE_PATH || "C:/ffmpeg/bin/ffprobe.exe",
      ),
    };
  }
  return {
    ffmpegPath: path.resolve(env.FFMPEG_PATH || "/usr/local/bin/ffmpeg"),
    ffprobePath: path.resolve(env.FFPROBE_PATH || "/usr/local/bin/ffprobe"),
  };
}

function usage() {
  return [
    "Usage: node tools/pinned-ffmpeg-upgrade.js [options]",
    "",
    "Verifies an ffmpeg.exe and ffprobe.exe pair against the pinned Gyan FFmpeg 8.1.2 build.",
    "The default is read-only PLAN_VERIFY. Replacement requires both --apply and --operator-confirmed.",
    "Apply verifies the pinned archive and both executables before creating backups or replacing either file.",
    "The pair is installed with per-file same-volume renames and verified rollback; the pair operation is not globally atomic.",
    "",
    "Options:",
    "  --ffmpeg <path>        ffmpeg.exe to verify or replace",
    "  --ffprobe <path>       ffprobe.exe paired with ffmpeg.exe",
    "  --out-dir <dir>        JSON and Markdown evidence directory",
    "  --generated-at <iso>   Fixed evidence timestamp",
    "  --apply                Request replacement when the plan requires it",
    "  --operator-confirmed   Independent confirmation required with --apply",
    "  --json                 Print the full JSON evidence to stdout",
    "  --help, -h             Show this help",
  ].join("\n");
}

function formatSummary(report, evidencePath) {
  return [
    "# Pinned FFmpeg Upgrade",
    "",
    `Mode: ${report.mode}`,
    `Verdict: ${report.verdict}`,
    `FFmpeg: ${report.current.ffmpeg.detected_version || "unavailable"}`,
    `FFprobe: ${report.current.ffprobe.detected_version || "unavailable"}`,
    `Target: ${report.target.version} ${report.target.build_variant}`,
    `Action: ${report.apply?.status || report.plan.action}`,
    `Evidence: ${evidencePath}`,
    "",
    "Final binary state, transient replacements and rollbacks are recorded in the JSON evidence. No media, credentials or OAuth data are changed by this command.",
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
  const directoryStat = await fsPromises.lstat(resolvedOutDir);
  if (directoryStat.isSymbolicLink?.() || !directoryStat.isDirectory?.()) {
    throw new Error("evidence_directory_not_regular");
  }

  const evidencePath = path.join(resolvedOutDir, EVIDENCE_FILENAME);
  const summaryPath = path.join(resolvedOutDir, SUMMARY_FILENAME);
  await writeAtomicFile(
    evidencePath,
    `${JSON.stringify(report, null, 2)}\n`,
    fsPromises,
  );
  await writeAtomicFile(
    summaryPath,
    `${formatSummary(report, evidencePath)}\n`,
    fsPromises,
  );
  return evidencePath;
}

async function writeAtomicFile(targetPath, contents, fsPromises) {
  try {
    const existing = await fsPromises.lstat(targetPath);
    if (existing.isSymbolicLink?.() || !existing.isFile?.()) {
      throw new Error("evidence_target_not_regular_file");
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await fsPromises.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsPromises.rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { args, help: true, exitCode: 0 };
  }

  const platform = deps.platform || process.platform;
  const defaults = defaultBinaryPaths(deps.env || process.env, platform);
  const ffmpegPath = path.resolve(args.ffmpegPath || defaults.ffmpegPath);
  const ffprobePath = path.resolve(args.ffprobePath || defaults.ffprobePath);
  const plan = await buildPinnedFfmpegUpgradePlan({
    ffmpegPath,
    ffprobePath,
    generatedAt: args.generatedAt,
    platform,
    execFileSync: deps.execFileSync,
    fsPromises: deps.fsPromises,
    hashFile: deps.hashFile,
  });
  const report = args.apply
    ? await applyPinnedFfmpegUpgrade(plan, {
        operatorConfirmed: args.operatorConfirmed,
        download: deps.download || downloadPinnedFfmpegArchive,
        extractArchive: deps.extractArchive || extractPinnedFfmpegArchive,
        execFileSync: deps.execFileSync,
        fsPromises: deps.fsPromises,
        hashFile: deps.hashFile,
        platform,
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
        `[pinned-ffmpeg-upgrade] FAILED: ${safeCliFailure(error)}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  EVIDENCE_FILENAME,
  SUMMARY_FILENAME,
  defaultBinaryPaths,
  formatSummary,
  main,
  parseArgs,
  safeCliFailure,
  usage,
  writeEvidence,
};
