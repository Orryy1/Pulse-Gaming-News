#!/usr/bin/env node
"use strict";

const {
  rehearseSqliteRestore,
} = require("../lib/ops/sqlite-restore-rehearsal");

const HELP = `Usage: node tools/sqlite-restore-rehearsal.js \\
  --backup <verified-backup.db> \\
  --backup-verification <sidecar.json> \\
  --restore <new-restored-copy.db> \\
  [--evidence <new-rehearsal-evidence.json>] \\
  [--generated-at <ISO-8601>]

Creates one distinct restored copy from an existing verified online SQLite
backup, opens only the restored copy as a read-only/query-only database and
writes pulse-restore-rehearsal-v1 evidence atomically. Existing restore or
evidence paths are never overwritten. No production database, OAuth token,
network service or platform is contacted.
`;

const VALUE_OPTIONS = new Set([
  "backup",
  "backup-verification",
  "restore",
  "evidence",
  "generated-at",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const result = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const name = token.slice(2);
    if (!VALUE_OPTIONS.has(name)) {
      throw new Error(`unknown_option:${name}`);
    }
    if (Object.prototype.hasOwnProperty.call(result, name)) {
      throw new Error(`duplicate_option:${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_value:${name}`);
    }
    result[name] = value;
    index += 1;
  }
  return result;
}

async function runCli({
  argv = process.argv.slice(2),
  execute = rehearseSqliteRestore,
  stdout = process.stdout,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(HELP);
    return { help: true };
  }
  const result = await execute({
    backupPath: args.backup,
    backupVerificationPath: args["backup-verification"],
    evidencePath: args.evidence,
    generatedAt: args["generated-at"],
    restorePath: args.restore,
  });
  const summary = {
    ok: true,
    schema_version: result.schema_version,
    backup_id: result.source_backup_id,
    source_backup: result.source_backup,
    restored_copy: result.restored_copy,
    evidence_path: result.evidence_path,
    sha256: result.restored_sha256,
    latest_migration: result.latest_migration,
    migration_count: result.migration_count,
  };
  stdout.write(`${JSON.stringify(summary)}\n`);
  return result;
}

async function main() {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: String(error?.code || error?.message || error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  HELP,
  main,
  parseArgs,
  runCli,
};
