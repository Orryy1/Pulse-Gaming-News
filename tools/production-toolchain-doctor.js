#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const {
  evaluateProductionToolchain,
} = require("../lib/production-toolchain-policy");

function firstLine(value) {
  return String(value || "").trim().split(/\r?\n/, 1)[0] || null;
}

function probe(binary, args, execFileSync) {
  try {
    return {
      binary,
      ok: true,
      output: firstLine(
        execFileSync(binary, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    };
  } catch (error) {
    return {
      binary,
      ok: false,
      output: null,
      error: String(error && error.message ? error.message : error).slice(0, 240),
    };
  }
}

function buildToolchainReport({
  env = process.env,
  execFileSync = defaultExecFileSync,
  generatedAt = new Date().toISOString(),
} = {}) {
  const binaries = {
    ffmpeg: probe(env.FFMPEG_PATH || "ffmpeg", ["-version"], execFileSync),
    ffprobe: probe(env.FFPROBE_PATH || "ffprobe", ["-version"], execFileSync),
    yt_dlp: probe(env.YTDLP_PATH || "yt-dlp", ["--version"], execFileSync),
  };
  const policy = evaluateProductionToolchain({
    ffmpegOutput: binaries.ffmpeg.output,
    ffprobeOutput: binaries.ffprobe.output,
    ytDlpOutput: binaries.yt_dlp.output,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    read_only: true,
    production_safe: policy.production_safe,
    verdict: policy.verdict,
    blockers: policy.blockers,
    policy: policy.policy,
    components: policy.components,
    binaries,
  };
}

function formatMarkdown(report) {
  const lines = [
    "# Production Toolchain Doctor",
    "",
    `Verdict: **${report.verdict}**`,
    `Production safe: **${report.production_safe ? "yes" : "no"}**`,
    "",
    "| Component | Detected | Minimum | Status |",
    "| --- | --- | --- | --- |",
  ];
  for (const [name, component] of Object.entries(report.components || {})) {
    lines.push(
      `| ${name} | ${component.detected_version || "missing"} | ${component.minimum_version} | ${component.current === false ? "RED" : "GREEN"} |`,
    );
  }
  if (report.blockers.length) {
    lines.push("", "## Blockers", "");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  lines.push(
    "",
    "This report is read-only. It does not install binaries, change runtime settings or publish media.",
  );
  return `${lines.join("\n")}\n`;
}

async function writeReports(report, outDir) {
  const resolved = path.resolve(outDir);
  await fs.ensureDir(resolved);
  await fs.writeJson(path.join(resolved, "production_toolchain_status.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(resolved, "production_toolchain_status.md"),
    formatMarkdown(report),
  );
  return resolved;
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

async function main() {
  const args = process.argv.slice(2);
  const report = buildToolchainReport();
  const outDir = getArgValue(args, "--out-dir");
  if (outDir) await writeReports(report, outDir);
  process.stdout.write(
    args.includes("--json")
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatMarkdown(report),
  );
  if (!report.production_safe) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[production-toolchain-doctor] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildToolchainReport,
  formatMarkdown,
  writeReports,
};
