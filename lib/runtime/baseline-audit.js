"use strict";

function normaliseVersion(value) {
  const version = String(value || "").trim();
  return /^\d{3}$/.test(version) ? version : null;
}

function duplicateValues(rows, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = String(row?.[field] || "").trim();
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function evaluateMigrationChain(migrationFiles, migrationRows, databaseMode) {
  const blockers = [];
  const pending = [];
  const files = Array.isArray(migrationFiles) ? migrationFiles : [];
  const rows = Array.isArray(migrationRows) ? migrationRows : [];
  const duplicateFileVersions = duplicateValues(files, "version");
  const duplicateFileNames = duplicateValues(files, "filename");
  const duplicateRowVersions = duplicateValues(rows, "version");
  const duplicateRowNames = duplicateValues(rows, "filename");
  if (duplicateFileVersions.length) blockers.push("duplicate_committed_migration_version");
  if (duplicateFileNames.length) blockers.push("duplicate_committed_migration_filename");
  if (duplicateRowVersions.length) blockers.push("duplicate_applied_migration_version");
  if (duplicateRowNames.length) blockers.push("duplicate_applied_migration_filename");

  const committed = new Map();
  for (const file of files) {
    const version = normaliseVersion(file?.version);
    if (!version) {
      blockers.push("committed_migration_version_invalid");
      continue;
    }
    if (!String(file.filename || "").startsWith(`${version}_`)) {
      blockers.push(`migration_${version}_filename_invalid`);
    }
    if (!/^[a-f0-9]{64}$/i.test(String(file.checksum || ""))) {
      blockers.push(`migration_${version}_checksum_invalid`);
    }
    committed.set(version, file);
  }

  const highest = committed.size
    ? Math.max(...[...committed.keys()].map(Number))
    : 0;
  for (let index = 1; index <= highest; index += 1) {
    const version = String(index).padStart(3, "0");
    if (!committed.has(version)) blockers.push(`migration_${version}_missing`);
  }

  const applied = new Map();
  for (const row of rows) {
    const version = normaliseVersion(row?.version);
    if (!version) {
      blockers.push("applied_migration_version_invalid");
      continue;
    }
    applied.set(version, row);
    const file = committed.get(version);
    if (!file) {
      blockers.push(`migration_${version}_file_missing`);
      continue;
    }
    if (file.filename !== row.filename || file.checksum !== row.checksum) {
      blockers.push(`migration_${version}_drift`);
    }
  }

  for (const [version] of committed) {
    if (applied.has(version)) continue;
    if (databaseMode === "production") {
      pending.push(`migration_${version}_cutover_pending`);
    } else {
      blockers.push(`migration_${version}_unapplied_in_fixture`);
    }
  }
  if (pending.length) pending.unshift("production_migration_cutover_pending");
  return {
    blockers: [...new Set(blockers)],
    pending: [...new Set(pending)],
    committedCount: committed.size,
    appliedCount: applied.size,
    highestVersion: highest ? String(highest).padStart(3, "0") : null,
  };
}

function evaluateGitState(gitState, expectedBranch) {
  const blockers = [];
  if (!gitState || !/^[a-f0-9]{40}$/i.test(String(gitState.head || ""))) {
    blockers.push("git_head_invalid");
  }
  if (String(gitState.status || "").trim()) blockers.push("git_worktree_dirty");
  if (expectedBranch && gitState.branch !== expectedBranch) {
    blockers.push("git_branch_mismatch");
  }
  if (gitState.detached === true && expectedBranch) {
    blockers.push("git_detached_head");
  }
  return blockers;
}

function buildBaselineAudit({
  databaseMode,
  databasePath,
  migrationFiles,
  migrationRows,
  gitState,
  expectedBranch,
  generatedAt = new Date().toISOString(),
}) {
  if (!['fixture', 'production'].includes(databaseMode)) {
    throw new Error("database_mode_invalid");
  }
  const migration = evaluateMigrationChain(
    migrationFiles,
    migrationRows,
    databaseMode,
  );
  const blockers = [
    ...migration.blockers,
    ...evaluateGitState(gitState, expectedBranch),
  ];
  const pending = [...migration.pending];
  const result = blockers.length
    ? "BLOCKED"
    : pending.length
      ? "PENDING"
      : "GREEN";
  return {
    schema_version: "pulse-autopilot-baseline-v1",
    generated_at: generatedAt,
    result,
    blockers: [...new Set(blockers)],
    pending: [...new Set(pending)],
    database: {
      mode: databaseMode,
      path: databasePath,
      migration_count: migration.appliedCount,
      committed_migration_count: migration.committedCount,
      highest_migration_version: migration.highestVersion,
    },
    git: {
      head: gitState?.head || null,
      branch: gitState?.branch || null,
      detached: gitState?.detached === true,
      clean: !String(gitState?.status || "").trim(),
      expected_branch: expectedBranch || null,
    },
  };
}

module.exports = {
  buildBaselineAudit,
  duplicateValues,
  evaluateGitState,
  evaluateMigrationChain,
};
