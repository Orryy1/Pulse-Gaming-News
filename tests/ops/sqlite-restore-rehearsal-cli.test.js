"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  parseArgs,
  runCli,
} = require("../../tools/sqlite-restore-rehearsal");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "sqlite-restore-rehearsal.js");
const FIXED_NOW = "2026-07-27T16:30:00.000Z";

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

test("restore-rehearsal CLI help is read-only and documents every required path", async () => {
  let executions = 0;
  let output = "";
  const parsed = parseArgs(["--help"]);
  assert.equal(parsed.help, true);

  const result = await runCli({
    argv: ["--help"],
    execute: async () => {
      executions += 1;
    },
    stdout: {
      write(value) {
        output += value;
      },
    },
  });

  assert.equal(result.help, true);
  assert.equal(executions, 0);
  assert.match(
    output,
    /Usage: node tools\/sqlite-restore-rehearsal\.js/,
  );
  assert.match(output, /--backup <verified-backup\.db>/);
  assert.match(output, /--backup-verification <sidecar\.json>/);
  assert.match(output, /--restore <new-restored-copy\.db>/);
  assert.match(output, /--evidence <new-rehearsal-evidence\.json>/);
});

test("restore-rehearsal CLI creates one immutable restored copy and JSON proof", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-restore-rehearsal-cli-"),
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const sourcePath = path.join(root, "production-fixture.db");
  const backupPath = path.join(root, "verified-backup.db");
  const sidecarPath = `${backupPath}.verification.json`;
  const restorePath = path.join(root, "restored", "pulse.db");
  const evidencePath = `${restorePath}.rehearsal.json`;
  const database = new Database(sourcePath);
  database.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations
      (version, filename, checksum, applied_at)
    VALUES
      ('023', '023_stabilisation_governance_hardening.sql', 'proof', '${FIXED_NOW}');
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );
    INSERT INTO stories (id, title) VALUES ('cli-proof', 'CLI proof');
  `);
  await database.backup(backupPath);
  database.close();
  const backupHash = sha256(backupPath);
  const sidecar = {
    backup_id: "pulse_cli_proof",
    backupPath,
    createdAt: FIXED_NOW,
    evidencePath: sidecarPath,
    method: "better-sqlite3-online-backup",
    mutationPerformed: true,
    schemaVersion: "pulse-sqlite-backup-verification-v1",
    sha256: backupHash,
    sizeBytes: fs.statSync(backupPath).size,
    sourcePath,
    verification: {
      openedReadOnly: true,
      quick_check: "ok",
      integrity_check: "ok",
      foreign_key_check: "ok",
      foreign_key_violation_count: 0,
    },
    verified: true,
    verifiedAt: FIXED_NOW,
  };
  fs.writeFileSync(
    sidecarPath,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );
  const sourceHashBefore = sha256(sourcePath);

  const execution = spawnSync(
    process.execPath,
    [
      TOOL,
      "--backup",
      backupPath,
      "--backup-verification",
      sidecarPath,
      "--restore",
      restorePath,
      "--evidence",
      evidencePath,
      "--generated-at",
      FIXED_NOW,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );

  assert.equal(execution.status, 0, execution.stderr);
  const summary = JSON.parse(execution.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.backup_id, "pulse_cli_proof");
  assert.equal(summary.restored_copy, restorePath);
  assert.equal(summary.evidence_path, evidencePath);
  assert.equal(summary.sha256, backupHash);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.schema_version, "pulse-restore-rehearsal-v1");
  assert.equal(evidence.row_counts.stories, 1);
  assert.equal(evidence.verification.query_only, true);
  assert.equal(sha256(sourcePath), sourceHashBefore);
  assert.equal(sha256(backupPath), backupHash);
});

test("restore-rehearsal CLI is exposed through the operator npm contract", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:db:restore-rehearsal"],
    "node tools/sqlite-restore-rehearsal.js",
  );
});
