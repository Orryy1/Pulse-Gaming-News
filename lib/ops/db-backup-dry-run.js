"use strict";

const fs = require("fs-extra");
const path = require("node:path");

async function buildDbBackupDryRun({ dbPath, now = new Date() } = {}) {
  const resolvedDbPath =
    dbPath || require("../db").DB_PATH || path.join(process.cwd(), "data", "pulse.db");
  const backupDir = path.join(path.dirname(resolvedDbPath), "backups");
  const exists = await fs.pathExists(resolvedDbPath);
  let size = null;
  if (exists) {
    try {
      size = (await fs.stat(resolvedDbPath)).size;
    } catch {
      size = null;
    }
  }
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.join(backupDir, `pulse_${timestamp}.db`);
  return {
    generatedAt: new Date().toISOString(),
    verdict: exists && size > 0 ? "pass" : "review",
    dryRun: true,
    dbPath: resolvedDbPath,
    dbExists: exists,
    dbSizeBytes: size,
    backupDir,
    wouldWrite: target,
    wouldCheckpointWal: true,
    wouldPruneToLast: 7,
    s3Configured: Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID),
    mutationPerformed: false,
  };
}

function renderDbBackupDryRunMarkdown(report) {
  return [
    "# DB Backup Dry Run",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    `Dry run: ${report.dryRun}`,
    `DB path: ${report.dbPath}`,
    `DB exists: ${report.dbExists}`,
    `DB size: ${report.dbSizeBytes ?? "unknown"}`,
    `Would write: ${report.wouldWrite}`,
    `Would checkpoint WAL: ${report.wouldCheckpointWal}`,
    `Would prune to last: ${report.wouldPruneToLast}`,
    `S3 configured: ${report.s3Configured}`,
    `Mutation performed: ${report.mutationPerformed}`,
    "",
  ].join("\n");
}

module.exports = { buildDbBackupDryRun, renderDbBackupDryRunMarkdown };
