#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  scanSourceRootsForSecrets,
} = require("../lib/goal23-security-secrets-deployment-safety");

const DEFAULT_SOURCE_ROOTS = [
  ".github",
  "docs",
  "lib",
  "tools",
  "src",
  "channels",
  "config",
  "blog",
  "discord",
  "scripts",
  "server.js",
  "run.js",
  "publisher.js",
  "processor.js",
  "audio.js",
  "assemble.js",
  "upload_youtube.js",
  "upload_tiktok.js",
  "upload_instagram.js",
  "upload_facebook.js",
  "upload_twitter.js",
  "package.json",
];

async function runSecretScan({
  workspaceRoot = path.resolve(__dirname, ".."),
  sourceRoots = DEFAULT_SOURCE_ROOTS,
} = {}) {
  const report = await scanSourceRootsForSecrets({
    workspaceRoot,
    sourceRoots,
  });
  return {
    ok: report.finding_count === 0,
    scanned_file_count: report.scanned_file_count,
    finding_count: report.finding_count,
    findings: report.findings.map((finding) => ({
      file: finding.file,
      line: finding.line,
      kind: finding.kind,
      severity: finding.severity,
    })),
    excluded_secret_paths: report.excluded_secret_paths,
    secret_values_exposed: false,
  };
}

async function main() {
  const report = await runSecretScan();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[ci-secret-scan] ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SOURCE_ROOTS,
  main,
  runSecretScan,
};
