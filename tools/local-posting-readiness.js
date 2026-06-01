#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalPostingReadiness,
  formatLocalPostingReadinessMarkdown,
} = require("../lib/ops/local-posting-readiness");

function readJsonIfExists(filePath) {
  try {
    if (!fs.pathExistsSync(filePath)) return null;
    return fs.readJsonSync(filePath);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { json: false, help: false, writeRootReport: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--write-root-report") args.writeRootReport = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/local-posting-readiness.js [--json] [--write-root-report]\n" +
      "  --json               Print JSON instead of markdown\n" +
      "  --write-root-report  Also update tracked LOCAL_POSTING_READINESS.md\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const root = process.cwd();
  const outDir = path.join(root, "test", "output");
  const report = buildLocalPostingReadiness({
    cutoverPlan: readJsonIfExists(path.join(outDir, "local_cutover_plan.json")),
    primaryReadiness: readJsonIfExists(path.join(outDir, "local_primary_readiness.json")),
    tunnelReadiness: readJsonIfExists(path.join(outDir, "local_tunnel_readiness.json")),
    ttsReport: readJsonIfExists(path.join(outDir, "local_tts_overnight_report.json")),
    ttsDoctorReport: readJsonIfExists(path.join(outDir, "local_tts_doctor.json")),
  });

  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "local_posting_readiness.json");
  const mdPath = path.join(outDir, "local_posting_readiness.md");
  const rootPath = path.join(root, "LOCAL_POSTING_READINESS.md");
  const markdown = formatLocalPostingReadinessMarkdown(report);

  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (args.writeRootReport) {
    await fs.writeFile(rootPath, markdown, "utf8");
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
    process.stderr.write(`[local-posting-readiness] json=${jsonPath}\n`);
    process.stderr.write(`[local-posting-readiness] md=${mdPath}\n`);
    if (args.writeRootReport) {
      process.stderr.write(`[local-posting-readiness] report=${rootPath}\n`);
    }
  }
  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-posting-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, readJsonIfExists };
