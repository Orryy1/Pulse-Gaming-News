"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const {
  samePath,
  validateCanonicalCutoverBackupEvidenceV1,
} = require("../../lib/ops/cutover-backup-evidence");
const {
  verifyBackupEvidence,
} = require("../../lib/ops/stabilisation-cutover-reconcile");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "cutover-backup-evidence.js");
const TEST_NOW_MS = Date.now();
const GENERATED_AT = new Date(TEST_NOW_MS).toISOString();
const VERIFIED_AT = new Date(TEST_NOW_MS - 40 * 60 * 1000).toISOString();
const RESTORED_AT = new Date(TEST_NOW_MS - 35 * 60 * 1000).toISOString();

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

test("path identity folds case and separators only for Windows semantics", () => {
  assert.equal(
    samePath("C:\\Pulse\\Path-Identity", "c:/pulse/path-identity", "win32"),
    true,
  );
  assert.equal(
    samePath("/tmp/Pulse-Path-Identity", "/tmp/pulse-path-identity", "linux"),
    false,
  );
  assert.equal(
    samePath("/tmp/pulse\\asset", "/tmp/pulse/asset", "linux"),
    false,
  );
});

test("canonical v1 structural validator binds identity, verification and provenance", (t) => {
  const proofRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-canonical-evidence-"),
  );
  t.after(() => fs.rmSync(proofRoot, { recursive: true, force: true }));
  const backupVerificationFile = path.join(
    proofRoot,
    "backup.verification.json",
  );
  const restoreRehearsalFile = path.join(proofRoot, "restore.rehearsal.json");
  fs.writeFileSync(backupVerificationFile, "{}\n");
  fs.writeFileSync(restoreRehearsalFile, "{}\n");
  const passed = {
    openedReadOnly: true,
    quick_check: "ok",
    integrity_check: "ok",
    foreign_key_check: "ok",
    foreign_key_violation_count: 0,
  };
  const evidence = {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: "backup-1",
    backup_path: path.join(proofRoot, "backup.db"),
    backup_sha256: "a".repeat(64),
    source_database_path: path.join(proofRoot, "source.db"),
    source_database_sha256: "b".repeat(64),
    verified_at: "2026-08-01T12:00:00.000Z",
    verified_by: "operator-1",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
    quick_check: "ok",
    restore_path: path.join(proofRoot, "restore.db"),
    restore_sha256: "a".repeat(64),
    backup_restore_hashes_match: true,
    production_database_mutated: false,
    verification: {
      source: { ...passed },
      backup: { ...passed },
      restore: { ...passed },
    },
    provenance: {
      backup_verification_file: backupVerificationFile,
      backup_verification_schema: "pulse-sqlite-backup-verification-v1",
      backup_verified_at: "2026-08-01T11:55:00.000Z",
      restore_rehearsal_file: restoreRehearsalFile,
      restore_rehearsal_schema: "pulse-restore-rehearsal-v1",
      restore_verified_at: "2026-08-01T11:58:00.000Z",
    },
  };
  assert.deepEqual(validateCanonicalCutoverBackupEvidenceV1(evidence), {
    valid: true,
    blockers: [],
  });
  for (const mutate of [
    (value) => {
      delete value.backup_id;
    },
    (value) => {
      delete value.verified_by;
    },
    (value) => {
      value.verification.backup.quick_check = "failed";
    },
    (value) => {
      value.provenance.restore_rehearsal_schema = "wrong";
    },
    (value) => {
      value.provenance.backup_verified_at = "2026-08-01T11:59:00.000Z";
      value.provenance.restore_verified_at = "2026-08-01T11:58:00.000Z";
    },
    (value) => {
      value.provenance.restore_verified_at = "2026-08-01T12:01:00.000Z";
    },
    (value) => {
      value.provenance.backup_verification_file = path.join(
        proofRoot,
        "absent.json",
      );
    },
    (value) => {
      value.provenance.backup_verification_file = `${proofRoot}${path.sep}.${path.sep}backup.verification.json`;
    },
  ]) {
    const invalid = structuredClone(evidence);
    mutate(invalid);
    assert.equal(
      validateCanonicalCutoverBackupEvidenceV1(invalid).valid,
      false,
    );
  }
  const hardLink = path.join(proofRoot, "backup.verification.hard-link.json");
  fs.linkSync(backupVerificationFile, hardLink);
  const linked = structuredClone(evidence);
  linked.provenance.backup_verification_file = hardLink;
  assert.equal(validateCanonicalCutoverBackupEvidenceV1(linked).valid, false);
});

function createFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-cutover-backup-evidence-"),
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));

  const databasePath = path.join(directory, "pulse.db");
  const database = new Database(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE proof_rows (
      id INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO proof_rows (value) VALUES ('protected');
  `);
  database.close();

  const backupPath = path.join(directory, "pulse_backup.db");
  const restorePath = path.join(directory, "pulse_restore.db");
  fs.copyFileSync(databasePath, backupPath);
  fs.copyFileSync(backupPath, restorePath);

  const backupVerificationPath = `${backupPath}.verification.json`;
  const backupVerification = {
    backup_id: "pulse_2026-07-27T09-20-24-950Z",
    backupPath,
    createdAt: VERIFIED_AT,
    evidencePath: backupVerificationPath,
    method: "better-sqlite3-online-backup",
    mutationPerformed: true,
    prunedBackups: [],
    schemaVersion: "pulse-sqlite-backup-verification-v1",
    sha256: sha256(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
    sourcePath: databasePath,
    s3: {
      attempted: false,
      configured: false,
      key: null,
      status: "not_configured",
    },
    verification: {
      openedReadOnly: true,
      quick_check: "ok",
      integrity_check: "ok",
      foreign_key_check: "ok",
      foreign_key_violation_count: 0,
    },
    verified: true,
    verifiedAt: VERIFIED_AT,
  };
  fs.writeFileSync(
    backupVerificationPath,
    `${JSON.stringify(backupVerification, null, 2)}\n`,
    "utf8",
  );

  const restoreRehearsalPath = `${restorePath}.rehearsal.json`;
  const restoreRehearsal = {
    schema_version: "pulse-restore-rehearsal-v1",
    generated_at: RESTORED_AT,
    source_backup: backupPath,
    restored_copy: restorePath,
    source_sha256: sha256(backupPath),
    restored_sha256: sha256(restorePath),
    hashes_match: true,
    verification: {
      openedReadOnly: true,
      quick_check: "ok",
      integrity_check: "ok",
      foreign_key_check: "ok",
      foreign_key_violation_count: 0,
    },
    latest_migration: "023",
    latest_migration_filename: "023_stabilisation_governance_hardening.sql",
    migration_count: 23,
    row_counts: {
      stories: 1,
      platform_posts: 0,
      jobs: 0,
      job_runs: 0,
      publication_lifecycle_events: 0,
    },
    production_database_mutated: false,
    restored_copy_opened_read_only: true,
  };
  fs.writeFileSync(
    restoreRehearsalPath,
    `${JSON.stringify(restoreRehearsal, null, 2)}\n`,
    "utf8",
  );

  return {
    backupPath,
    backupVerificationPath,
    databasePath,
    directory,
    restorePath,
    restoreRehearsalPath,
  };
}

function argsFor(fixture, outDir, overrides = []) {
  return [
    "--database",
    fixture.databasePath,
    "--backup-verification",
    fixture.backupVerificationPath,
    "--restore-rehearsal",
    fixture.restoreRehearsalPath,
    "--out-dir",
    outDir,
    "--generated-at",
    GENERATED_AT,
    "--verified-by",
    "cutover-operator",
    ...overrides,
  ];
}

function runTool(args) {
  return execFileSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

function runToolAllowFailure(args) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
}

test("operator composes independently verified backup and restore proofs into reconciliation evidence", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const before = {
    database: sha256(fixture.databasePath),
    backup: sha256(fixture.backupPath),
    restore: sha256(fixture.restorePath),
  };
  const stdout = JSON.parse(runTool(argsFor(fixture, outDir)));
  const evidencePath = path.join(outDir, "pulse_cutover_backup_evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

  assert.equal(stdout.ok, true);
  assert.equal(stdout.verdict, "PASS");
  assert.equal(evidence.schema_version, "pulse-cutover-backup-evidence-v1");
  assert.equal(evidence.backup_id, "pulse_2026-07-27T09-20-24-950Z");
  assert.equal(evidence.backup_path, fixture.backupPath);
  assert.equal(evidence.backup_sha256, before.backup);
  assert.equal(evidence.source_database_path, fixture.databasePath);
  assert.equal(evidence.source_database_sha256, before.database);
  assert.equal(evidence.verified_at, GENERATED_AT);
  assert.equal(evidence.verified_by, "cutover-operator");
  assert.equal(evidence.restore_test_status, "PASS");
  assert.equal(evidence.integrity_check, "ok");
  assert.equal(evidence.foreign_key_check, "ok");
  assert.equal(evidence.quick_check, "ok");
  assert.equal(evidence.restore_path, fixture.restorePath);
  assert.equal(evidence.restore_sha256, before.restore);
  assert.equal(evidence.backup_restore_hashes_match, true);
  assert.equal(evidence.production_database_mutated, false);
  const reconciliationVerification = verifyBackupEvidence({
    evidencePath,
    databasePath: fixture.databasePath,
    generatedAt: GENERATED_AT,
  });
  assert.equal(reconciliationVerification.verified, true);
  assert.deepEqual(reconciliationVerification.blockers, []);
  assert.ok(
    fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.md")),
  );
  assert.deepEqual(
    {
      database: sha256(fixture.databasePath),
      backup: sha256(fixture.backupPath),
      restore: sha256(fixture.restorePath),
    },
    before,
  );
});

test("a clean checkpointed WAL source remains eligible and the composer leaves no source sidecars", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);

  const stdout = JSON.parse(runTool(argsFor(fixture, outDir)));

  assert.equal(stdout.verdict, "PASS");
  assert.equal(fs.existsSync(`${fixture.databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${fixture.databasePath}-shm`), false);
});

test("the composer rejects source changes committed only to a non-empty WAL", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();
  const checkpointedMainHash = sha256(fixture.databasePath);

  const writer = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  try {
    writer.pragma("wal_autocheckpoint = 0");
    writer
      .prepare("INSERT INTO proof_rows (value) VALUES ('only in WAL')")
      .run();
    assert.equal(sha256(fixture.databasePath), checkpointedMainHash);
    assert.ok(fs.statSync(`${fixture.databasePath}-wal`).size > 0);
    assert.ok(fs.statSync(`${fixture.databasePath}-shm`).size > 0);

    const execution = runToolAllowFailure(argsFor(fixture, outDir));

    assert.equal(execution.status, 2);
    const summary = JSON.parse(execution.stdout);
    assert.equal(summary.verdict, "HOLD");
    assert.ok(
      summary.blockers.includes("source_database_wal_not_checkpointed"),
      execution.stdout,
    );
    assert.equal(
      fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
      false,
    );
  } finally {
    writer.close();
  }
});

test("the composer rejects shared memory held by a reader even when the source WAL is empty", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const setup = new Database(fixture.databasePath, {
    fileMustExist: true,
  });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  const reader = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    reader.prepare("SELECT COUNT(*) FROM proof_rows").pluck().get();
    assert.equal(fs.statSync(`${fixture.databasePath}-wal`).size, 0);
    assert.ok(fs.statSync(`${fixture.databasePath}-shm`).size > 0);

    const execution = runToolAllowFailure(argsFor(fixture, outDir));

    assert.equal(execution.status, 2);
    const summary = JSON.parse(execution.stdout);
    assert.equal(summary.verdict, "HOLD");
    assert.ok(
      summary.blockers.includes("source_database_shared_memory_present"),
      execution.stdout,
    );
    assert.equal(
      fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
      false,
    );
  } finally {
    reader.close();
  }
});

test("tampered backup or restore bytes produce only HOLD attempt evidence", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  fs.appendFileSync(fixture.backupPath, "tampered", "utf8");

  const execution = runToolAllowFailure(argsFor(fixture, outDir));
  assert.equal(execution.status, 2);
  const summary = JSON.parse(execution.stdout);
  assert.equal(summary.ok, false);
  assert.equal(summary.verdict, "HOLD");
  assert.ok(summary.blockers.includes("backup_sha256_mismatch"));
  assert.ok(summary.blockers.includes("backup_restore_hash_mismatch"));
  assert.equal(
    fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
    false,
  );
  const attempt = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "pulse_cutover_backup_evidence_attempt.json"),
      "utf8",
    ),
  );
  assert.equal(
    attempt.schema_version,
    "pulse-cutover-backup-evidence-attempt-v1",
  );
  assert.equal(attempt.verdict, "HOLD");
  assert.deepEqual(attempt.safety, {
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    scheduled_tasks_mutated: false,
    platforms_contacted: false,
    external_objects_created: false,
  });
});

test("operator output cannot overwrite any input evidence file", (t) => {
  const fixture = createFixture(t);
  const collidingSidecar = path.join(
    fixture.directory,
    "pulse_cutover_backup_evidence.json",
  );
  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.evidencePath = collidingSidecar;
  fs.writeFileSync(
    collidingSidecar,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );
  fs.rmSync(fixture.backupVerificationPath);
  const beforeHash = sha256(collidingSidecar);

  const execution = runToolAllowFailure(
    argsFor(
      { ...fixture, backupVerificationPath: collidingSidecar },
      fixture.directory,
    ),
  );

  assert.equal(execution.status, 1);
  assert.match(
    execution.stderr,
    /cutover_backup_evidence_output_collides_with_input/,
  );
  assert.equal(sha256(collidingSidecar), beforeHash);
});

test("a recent sidecar cannot disguise a stale backup creation time", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.createdAt = new Date(TEST_NOW_MS - 48 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    fixture.backupVerificationPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );

  const execution = runToolAllowFailure(argsFor(fixture, outDir));

  assert.equal(execution.status, 2);
  const summary = JSON.parse(execution.stdout);
  assert.ok(summary.blockers.includes("backup_created_stale"));
  assert.equal(
    fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
    false,
  );
});

test("the sidecar must protect the exact source database requested by the operator", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const decoyPath = path.join(fixture.directory, "decoy.db");
  fs.copyFileSync(fixture.databasePath, decoyPath);
  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.sourcePath = decoyPath;
  fs.writeFileSync(
    fixture.backupVerificationPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );

  const execution = runToolAllowFailure(argsFor(fixture, outDir));

  assert.equal(execution.status, 2);
  const summary = JSON.parse(execution.stdout);
  assert.ok(summary.blockers.includes("backup_source_database_mismatch"));
  assert.equal(
    fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
    false,
  );
});

test("green proof claims cannot replace independent read-only SQLite checks", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  fs.writeFileSync(fixture.backupPath, "not a SQLite database", "utf8");
  fs.copyFileSync(fixture.backupPath, fixture.restorePath);

  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.sha256 = sha256(fixture.backupPath);
  sidecar.sizeBytes = fs.statSync(fixture.backupPath).size;
  fs.writeFileSync(
    fixture.backupVerificationPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );

  const rehearsal = JSON.parse(
    fs.readFileSync(fixture.restoreRehearsalPath, "utf8"),
  );
  rehearsal.source_sha256 = sha256(fixture.backupPath);
  rehearsal.restored_sha256 = sha256(fixture.restorePath);
  rehearsal.hashes_match = true;
  fs.writeFileSync(
    fixture.restoreRehearsalPath,
    `${JSON.stringify(rehearsal, null, 2)}\n`,
    "utf8",
  );

  const execution = runToolAllowFailure(argsFor(fixture, outDir));

  assert.equal(execution.status, 2);
  const summary = JSON.parse(execution.stdout);
  assert.ok(
    summary.blockers.includes("backup_database_integrity_checks_failed"),
  );
  assert.ok(
    summary.blockers.includes("restore_database_integrity_checks_failed"),
  );
  assert.equal(
    fs.existsSync(path.join(outDir, "pulse_cutover_backup_evidence.json")),
    false,
  );
});

test("a non-mutating dry-run report cannot masquerade as a completed online backup", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.mutationPerformed = false;
  fs.writeFileSync(
    fixture.backupVerificationPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );

  const execution = runToolAllowFailure(argsFor(fixture, outDir));

  assert.equal(execution.status, 2);
  assert.ok(
    JSON.parse(execution.stdout).blockers.includes(
      "online_backup_completion_required",
    ),
  );
});

test("backdating generated-at cannot make old proof look recent", (t) => {
  const fixture = createFixture(t);
  const outDir = path.join(fixture.directory, "proof");
  const backdatedGeneratedAt = new Date(
    TEST_NOW_MS - 47 * 60 * 60 * 1000,
  ).toISOString();
  const backdatedVerifiedAt = new Date(
    TEST_NOW_MS - 48 * 60 * 60 * 1000,
  ).toISOString();
  const sidecar = JSON.parse(
    fs.readFileSync(fixture.backupVerificationPath, "utf8"),
  );
  sidecar.createdAt = backdatedVerifiedAt;
  sidecar.verifiedAt = backdatedVerifiedAt;
  fs.writeFileSync(
    fixture.backupVerificationPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );
  const rehearsal = JSON.parse(
    fs.readFileSync(fixture.restoreRehearsalPath, "utf8"),
  );
  rehearsal.generated_at = backdatedGeneratedAt;
  fs.writeFileSync(
    fixture.restoreRehearsalPath,
    `${JSON.stringify(rehearsal, null, 2)}\n`,
    "utf8",
  );

  const execution = runToolAllowFailure(
    argsFor(fixture, outDir, ["--generated-at", backdatedGeneratedAt]),
  );

  assert.equal(execution.status, 2);
  assert.ok(
    JSON.parse(execution.stdout).blockers.includes("generated_at_not_current"),
  );
});
