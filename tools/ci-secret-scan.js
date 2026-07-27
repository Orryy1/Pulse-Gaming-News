#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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
  "AGENTS.md",
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

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "output",
  "tokens",
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|secret|password|webhook[_-]?url)\b\s*[:=]\s*["']([^"'\r\n]{16,})["']/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

function isExcluded(relativePath) {
  const normalised = relativePath.replace(/\\/g, "/");
  if (/^\.env(?:\.|$)/i.test(normalised)) return true;
  return normalised.split("/").some((part) => EXCLUDED_SEGMENTS.has(part));
}

async function collectFiles(workspaceRoot, sourceRoots) {
  const files = [];

  async function visit(absolutePath) {
    const relative = path.relative(workspaceRoot, absolutePath);
    if (isExcluded(relative)) return;
    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const entries = await fs.readdir(absolutePath);
      for (const entry of entries.sort()) {
        await visit(path.join(absolutePath, entry));
      }
      return;
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) return;
    const extension = path.extname(absolutePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(absolutePath) !== "Dockerfile") {
      return;
    }
    files.push(absolutePath);
  }

  for (const sourceRoot of sourceRoots) {
    await visit(path.resolve(workspaceRoot, sourceRoot));
  }
  return files;
}

function classifyLine(line) {
  if (PRIVATE_KEY.test(line)) {
    return { kind: "private_key", severity: "critical" };
  }
  const assignment = line.match(SECRET_ASSIGNMENT);
  if (!assignment) return null;
  const key = assignment[1].toLowerCase();
  return {
    kind: key.includes("token") ? "hardcoded_token" : "hardcoded_secret",
    severity: "high",
  };
}

async function runSecretScan({
  workspaceRoot = path.resolve(__dirname, ".."),
  sourceRoots = DEFAULT_SOURCE_ROOTS,
} = {}) {
  const root = path.resolve(workspaceRoot);
  const files = await collectFiles(root, sourceRoots);
  const findings = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const finding = classifyLine(lines[index]);
      if (!finding) continue;
      findings.push({
        file: path.relative(root, file).replace(/\\/g, "/"),
        line: index + 1,
        ...finding,
      });
    }
  }

  return {
    ok: findings.length === 0,
    scanned_file_count: files.length,
    finding_count: findings.length,
    findings,
    excluded_secret_paths: [".env", ".env.*", "tokens/**"],
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
  classifyLine,
  main,
  runSecretScan,
};
