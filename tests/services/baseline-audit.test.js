"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildBaselineAudit,
  evaluateMigrationChain,
} = require("../../lib/runtime/baseline-audit");
const {
  assertExpectedCliVerdict,
} = require("../../lib/ops/exact-cli-expectation");

function files(count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const version = String(index + 1).padStart(3, "0");
    return {
      version,
      filename: `${version}_migration.sql`,
      checksum: String(index + 1).repeat(64).slice(0, 64),
    };
  });
}

function rows(count = 3) {
  return files(count).map((row) => ({ ...row }));
}

function gitState(overrides = {}) {
  return {
    head: "a".repeat(40),
    branch: "codex/green-autopilot-20260815",
    detached: false,
    status: "",
    ...overrides,
  };
}

test("fixture baseline is GREEN with contiguous immutable migrations", () => {
  const audit = buildBaselineAudit({
    databaseMode: "fixture",
    databasePath: "D:/Temp/fixture.db",
    migrationFiles: files(),
    migrationRows: rows(),
    gitState: gitState(),
    expectedBranch: "codex/green-autopilot-20260815",
  });
  assert.equal(audit.result, "GREEN");
  assert.deepEqual(audit.blockers, []);
  assert.deepEqual(audit.pending, []);
});

test("duplicate migration numbers fail closed", () => {
  const migrationFiles = files();
  migrationFiles.push({ ...migrationFiles[0], filename: "001_duplicate.sql" });
  const result = evaluateMigrationChain(migrationFiles, rows(), "fixture");
  assert.ok(result.blockers.includes("duplicate_committed_migration_version"));
});

test("a missing version in the committed sequence fails closed", () => {
  const migrationFiles = [files()[0], files()[2]];
  const result = evaluateMigrationChain(migrationFiles, migrationFiles, "fixture");
  assert.ok(result.blockers.includes("migration_002_missing"));
});

test("applied checksum drift fails closed", () => {
  const migrationRows = rows();
  migrationRows[1].checksum = "f".repeat(64);
  const result = evaluateMigrationChain(files(), migrationRows, "fixture");
  assert.ok(result.blockers.includes("migration_002_drift"));
});

test("production reports unapplied committed migrations as PENDING", () => {
  const audit = buildBaselineAudit({
    databaseMode: "production",
    databasePath: "D:/pulse-data/pulse.db",
    migrationFiles: files(),
    migrationRows: rows(2),
    gitState: gitState(),
    expectedBranch: "codex/green-autopilot-20260815",
  });
  assert.equal(audit.result, "PENDING");
  assert.ok(audit.pending.includes("production_migration_cutover_pending"));
  assert.ok(audit.pending.includes("migration_003_cutover_pending"));
});

test("fixture rejects an unapplied migration", () => {
  const audit = buildBaselineAudit({
    databaseMode: "fixture",
    databasePath: "D:/Temp/fixture.db",
    migrationFiles: files(),
    migrationRows: rows(2),
    gitState: gitState(),
    expectedBranch: "codex/green-autopilot-20260815",
  });
  assert.equal(audit.result, "BLOCKED");
  assert.ok(audit.blockers.includes("migration_003_unapplied_in_fixture"));
});

test("dirty or unexpected Git state blocks the baseline", () => {
  const dirty = buildBaselineAudit({
    databaseMode: "fixture",
    databasePath: "D:/Temp/fixture.db",
    migrationFiles: files(),
    migrationRows: rows(),
    gitState: gitState({ status: " M file.js" }),
    expectedBranch: "codex/green-autopilot-20260815",
  });
  assert.ok(dirty.blockers.includes("git_worktree_dirty"));
  const wrongBranch = buildBaselineAudit({
    databaseMode: "fixture",
    databasePath: "D:/Temp/fixture.db",
    migrationFiles: files(),
    migrationRows: rows(),
    gitState: gitState({ branch: "main" }),
    expectedBranch: "codex/green-autopilot-20260815",
  });
  assert.ok(wrongBranch.blockers.includes("git_branch_mismatch"));
});

test("exact CLI expectation returns 0, 2 and 64 deterministically", () => {
  const allowed = ["GREEN", "PENDING", "BLOCKED"];
  assert.deepEqual(
    assertExpectedCliVerdict({ actual: "GREEN", expected: "GREEN", allowed, required: true }),
    { matched: true, exitCode: 0 },
  );
  assert.deepEqual(
    assertExpectedCliVerdict({ actual: "PENDING", expected: "GREEN", allowed, required: true }),
    { matched: false, exitCode: 2 },
  );
  assert.deepEqual(
    assertExpectedCliVerdict({ actual: "GREEN", expected: "unknown", allowed, required: true }),
    { matched: false, exitCode: 64 },
  );
  assert.deepEqual(
    assertExpectedCliVerdict({ actual: "GREEN", allowed, required: true }),
    { matched: false, exitCode: 64 },
  );
});
