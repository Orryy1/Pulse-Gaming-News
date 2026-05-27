#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

const {
  buildLocalPrimaryReadiness,
  formatLocalPrimaryReadinessMarkdown,
} = require("../lib/ops/local-primary-readiness");

function findDuplicateEnvKeys(envPath) {
  if (!fs.pathExistsSync(envPath)) return [];
  const seen = new Set();
  const dupes = new Set();
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const key = line.slice(0, line.indexOf("=")).trim();
    if (!key) continue;
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return Array.from(dupes).sort();
}

async function main() {
  dotenv.config({ override: true });
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const outputDir = path.join(process.cwd(), "test", "output");
  const duplicateEnvKeys = findDuplicateEnvKeys(path.join(process.cwd(), ".env"));
  const report = await buildLocalPrimaryReadiness({ duplicateEnvKeys });

  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "local_primary_readiness.json");
  const mdPath = path.join(outputDir, "local_primary_readiness.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, formatLocalPrimaryReadinessMarkdown(report));

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatLocalPrimaryReadinessMarkdown(report) + "\n");
    process.stderr.write(`[local-primary-readiness] json=${jsonPath}\n`);
    process.stderr.write(`[local-primary-readiness] md=${mdPath}\n`);
  }

  if (report.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-primary-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = { findDuplicateEnvKeys };
