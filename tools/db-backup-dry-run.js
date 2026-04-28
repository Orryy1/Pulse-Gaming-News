"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildDbBackupDryRun,
  renderDbBackupDryRunMarkdown,
} = require("../lib/ops/db-backup-dry-run");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

async function main() {
  await fs.ensureDir(OUT);
  const report = await buildDbBackupDryRun();
  const jsonPath = path.join(OUT, "db_backup_dry_run.json");
  const mdPath = path.join(OUT, "db_backup_dry_run.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderDbBackupDryRunMarkdown(report), "utf8");
  console.log(`[db-backup-dry-run] verdict=${report.verdict}`);
  console.log(`[db-backup-dry-run] mutation=${report.mutationPerformed}`);
  console.log(`[db-backup-dry-run] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[db-backup-dry-run] md=${path.relative(ROOT, mdPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
