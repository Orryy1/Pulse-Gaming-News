"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");
const {
  cleanCloseGovernedSourceWal,
  samePath,
} = require("../../lib/ops/governed-source-wal-clean-close");
const {
  acquireLiveRuntimeTransitionLease,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");
const {
  rehearseSqliteRestore,
} = require("../../lib/ops/sqlite-restore-rehearsal");
const {
  composeCutoverBackupEvidence,
} = require("../../lib/ops/cutover-backup-evidence");
const {
  verifyBackupEvidence,
} = require("../../lib/ops/stabilisation-cutover-reconcile");
const {
  main: runGovernedSourceWalCli,
} = require("../../tools/governed-source-wal-clean-close");
const TEST_START = new Date(Date.now() - 1000),
  NOW = TEST_START.toISOString(),
  EXPIRES = new Date(TEST_START.getTime() + 10 * 60 * 1000).toISOString(),
  COMMIT = "8cb587bcdaa8590181b5aec71fddbf2385d59783",
  TOOL = path.resolve(
    __dirname,
    "../../tools/governed-source-wal-clean-close.js",
  ),
  MODULE = path.resolve(
    __dirname,
    "../../lib/ops/governed-source-wal-clean-close.js",
  );
function sha(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-wal-v4-")),
    databasePath = path.join(root, "pulse.db"),
    db = new Database(databasePath);
  db.exec(
    `CREATE TABLE proof_rows (id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO proof_rows VALUES (1,'preserved'); CREATE TABLE sequence_rows (id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT NOT NULL); INSERT INTO sequence_rows(value) VALUES ('one'); CREATE TABLE schema_migrations (version TEXT NOT NULL,filename TEXT NOT NULL); INSERT INTO schema_migrations VALUES ('1','fixture.sql'); CREATE TABLE runtime_leases (name TEXT PRIMARY KEY,owner_id TEXT NOT NULL,acquired_at TEXT NOT NULL,heartbeat_at TEXT NOT NULL,expires_at TEXT NOT NULL,metadata TEXT);`,
  );
  db.pragma("journal_mode = WAL");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  const receiptPath = path.join(root, "state", "activation-receipt.json"),
    profilePath = path.join(root, "runtime-profile.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      schema_version: "pulse-windows-live-guarded-runtime-profile-v1",
      profile_id: "pulse-v1-governed-multi-lane-live-guarded-youtube",
      database_path: databasePath,
      activation_receipt_path: receiptPath,
      port: 3001,
      task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
      conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
      environment: {},
    }),
  );
  t.after(() =>
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }),
  );
  return { root, databasePath, receiptPath, profilePath };
}
function request(v, o = {}) {
  return {
    schema_version: "pulse-governed-source-wal-clean-close-request-v4",
    mode: "LOCAL_PROOF",
    maintenance_mode: "HUMAN_REVIEW",
    apply: true,
    generated_at: NOW,
    expires_at: EXPIRES,
    confirmation_id: "change-1",
    change_id: "change-1",
    operator_id: "operator-1",
    database_path: v.databasePath,
    expected_database_sha256: sha(v.databasePath),
    runtime_profile_path: v.profilePath,
    expected_runtime_profile_file_sha256: sha(v.profilePath),
    activation_receipt_path: v.receiptPath,
    executor_workspace_root: v.root,
    expected_executor_checkout_commit: COMMIT,
    output_dir: path.join(v.root, "evidence"),
    ...o,
  };
}
function deps(o = {}) {
  return {
    now: () => new Date(NOW),
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_PRIMARY_INSTANCE: "false",
      PULSE_KILL_SWITCH: "true",
    },
    inspectExecutor: () => ({ commit: COMMIT, status: "" }),
    inspectQuiescence: async () => ({
      available: true,
      probe_attestations: {
        listeners: true,
        processes: true,
        scheduled_tasks: true,
      },
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
      absent_task_names: [
        "PulseGaming-LiveGuarded-YouTube-Runtime",
        "PulseGaming-Stabilisation-Runtime",
      ],
    }),
    runtimeProfileValidator: () => ({ valid: true }),
    acquireLease: () => ({
      renew() {
        return true;
      },
      release() {
        return true;
      },
    }),
    ...o,
  };
}
function zeroOrAbsentWal(v) {
  return (
    !fs.existsSync(`${v.databasePath}-wal`) ||
    fs.statSync(`${v.databasePath}-wal`).size === 0
  );
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

test("an absent activation receipt beneath junction ancestry holds before maintenance", async (t) => {
  const v = fixture(t);
  const linkedParent = path.dirname(v.receiptPath);
  const targetParent = path.join(v.root, "receipt-target");
  const nestedReceipt = path.join(
    linkedParent,
    "existing-parent",
    "not-created",
    "activation-receipt.json",
  );
  fs.rmSync(linkedParent, { recursive: true });
  fs.mkdirSync(path.join(targetParent, "existing-parent"), {
    recursive: true,
  });
  fs.symlinkSync(
    targetParent,
    linkedParent,
    process.platform === "win32" ? "junction" : "dir",
  );
  const profile = JSON.parse(fs.readFileSync(v.profilePath, "utf8"));
  profile.activation_receipt_path = nestedReceipt;
  fs.writeFileSync(v.profilePath, JSON.stringify(profile));

  const result = await cleanCloseGovernedSourceWal(
    request(v, { activation_receipt_path: nestedReceipt }),
    deps({
      acquireLease() {
        throw new Error("maintenance_must_not_begin");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "source_wal_activation_receipt_parent_link_forbidden",
    ),
  );
});

test("an intermediate output junction holds before any outside directory is created", async (t) => {
  const v = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-wal-output-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const linkedOutput = path.join(v.root, "linked-output");
  const escapedDirectory = path.join(outside, "must-not-be-created");
  fs.symlinkSync(
    outside,
    linkedOutput,
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      output_dir: path.join(linkedOutput, "must-not-be-created"),
    }),
    deps({
      acquireLease() {
        throw new Error("maintenance_must_not_begin");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_wal_evidence_output_invalid"));
  assert.equal(fs.existsSync(escapedDirectory), false);
});

function transitionLeaseCount(databasePath) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM runtime_leases WHERE name = ?")
        .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    );
  } finally {
    database.close();
  }
}

function mutateFinalComponent(file, mutation, root) {
  if (mutation === "tamper") {
    fs.appendFileSync(file, "tampered-final-component");
    return;
  }
  if (mutation === "delete") {
    fs.unlinkSync(file);
    return;
  }
  if (mutation === "replace-same-bytes") {
    const bytes = fs.readFileSync(file);
    fs.renameSync(file, `${file}.detached`);
    fs.writeFileSync(file, bytes);
    return;
  }
  if (mutation === "hardlink") {
    fs.linkSync(
      file,
      path.join(root, `final-component-${path.basename(file)}`),
    );
    return;
  }
  throw new Error(`unknown test mutation: ${mutation}`);
}

function operationDirectory(v) {
  const root = path.join(v.root, "evidence");
  const directories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.equal(directories.length, 1);
  return path.join(root, directories[0].name);
}

function canonicalPaths(result) {
  return [
    result.canonical_artifacts.backup_identity.path,
    result.canonical_artifacts.backup_verification_identity.path,
    result.canonical_artifacts.restore_identity.path,
    result.canonical_artifacts.restore_evidence_identity.path,
  ];
}

function crashChildAtAfterFinalCommit(v, exactRequest) {
  const requestPath = path.join(v.root, "child-request.json");
  fs.writeFileSync(requestPath, JSON.stringify(exactRequest));
  const script = String.raw`
    const fs = require("node:fs");
    const { cleanCloseGovernedSourceWal } = require(process.argv[1]);
    const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    cleanCloseGovernedSourceWal(request, {
      now: () => new Date(request.generated_at),
      env: {
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
        OPERATING_MODE: "LOCAL_PROOF",
        AUTO_PUBLISH: "false",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
        PULSE_PRIMARY_INSTANCE: "false",
        PULSE_KILL_SWITCH: "true",
      },
      inspectExecutor: () => ({ commit: "${COMMIT}", status: "" }),
      inspectQuiescence: async () => ({
        available: true,
        probe_attestations: {
          listeners: true,
          processes: true,
          scheduled_tasks: true,
        },
        owner_pids: [],
        listener_pids: [],
        scheduler_process_pids: [],
        enabled_tasks: [],
        running_tasks: [],
        absent_task_names: [
          "PulseGaming-LiveGuarded-YouTube-Runtime",
          "PulseGaming-Stabilisation-Runtime",
        ],
      }),
      runtimeProfileValidator: () => ({ valid: true }),
      acquireLease: () => ({
        renew: () => true,
        release: () => true,
      }),
      afterFinalCommit: () => process.exit(88),
    }).then(() => process.exit(89), () => process.exit(90));
  `;
  return spawnSync(process.execPath, ["-e", script, MODULE, requestPath], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "../.."),
  });
}

function cliArguments(v, { includeTool = false } = {}) {
  const generated = new Date();
  const expires = new Date(generated.getTime() + 60_000);
  return [
    ...(includeTool ? [TOOL] : []),
    "--mode",
    "LOCAL_PROOF",
    "--maintenance-mode",
    "HUMAN_REVIEW",
    "--apply",
    "--generated-at",
    generated.toISOString(),
    "--expires-at",
    expires.toISOString(),
    "--change-id",
    "change-1",
    "--confirm",
    "change-1",
    "--operator",
    "operator-1",
    "--database",
    v.databasePath,
    "--database-sha256",
    sha(v.databasePath),
    "--runtime-profile",
    v.profilePath,
    "--runtime-profile-file-sha256",
    sha(v.profilePath),
    "--activation-receipt",
    v.receiptPath,
    "--executor-workspace-root",
    v.root,
    "--expected-executor-commit",
    COMMIT,
    "--out-dir",
    path.join(v.root, "evidence"),
  ];
}

test("checkpoints, governs SHM cleanup and produces verified backup plus restore evidence", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(request(v), deps());
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  assert.equal(zeroOrAbsentWal(v), true);
  assert.equal(fs.existsSync(`${v.databasePath}-shm`), false);
  const evidence = JSON.parse(
    fs.readFileSync(result.backup_evidence_json, "utf8"),
  );
  assert.equal(evidence.schema_version, "pulse-cutover-backup-evidence-v1");
  assert.equal(evidence.restore_test_status, "PASS");
  assert.equal(evidence.production_database_mutated, false);
  const operationEvidence = JSON.parse(
    fs.readFileSync(result.evidence_json, "utf8"),
  );
  assert.equal(operationEvidence.source_maintenance_performed, true);
  assert.equal(
    operationEvidence.protected_validation.classification,
    "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY",
  );
  assert.equal(
    operationEvidence.protected_validation.canonical_evidence_input,
    false,
  );
  assert.equal(operationEvidence.protected_validation.restore_eligible, false);
  assert.equal(
    operationEvidence.canonical_artifacts.classification,
    "CANONICAL_POST_TRANSITION_LEASE_RELEASE",
  );
  assert.equal(operationEvidence.canonical_artifacts.restore_eligible, true);
  assert.equal(
    operationEvidence.transition_lease_boundary.post_release_lease_gap_exists,
    true,
  );
  assert.equal(
    operationEvidence.canonical_backup_evidence_scope
      .production_database_mutated_false_means,
    "restore_rehearsal_did_not_mutate_production_source",
  );
  assert.equal(
    operationEvidence.canonical_backup_evidence_scope
      .final_marker_is_snapshot_authority_only,
    true,
  );
  assert.equal(
    operationEvidence.canonical_backup_evidence_scope
      .consumer_must_revalidate_source_identity_and_logical_state,
    true,
  );
  assert.equal(
    operationEvidence.canonical_backup_evidence_scope
      .consumer_must_revalidate_quiescence_receipt_and_sidecars,
    true,
  );
  assert.deepEqual(
    operationEvidence.final_completion_authority,
    result.final_completion_authority,
  );
  assert.equal(
    operationEvidence.final_completion_authority.role,
    "CANONICAL_BACKUP_EVIDENCE_FINAL_MARKER",
  );
  assert.equal(
    operationEvidence.final_completion_authority.path,
    result.backup_evidence_json,
  );
  assert.equal(
    operationEvidence.final_completion_authority.sha256,
    sha(result.backup_evidence_json),
  );
  assert.deepEqual(operationEvidence.external_authority, {
    live_publish_performed: false,
    oauth_or_token_mutation_performed: false,
    scheduled_task_mutation_performed: false,
  });
  assert.equal(
    operationEvidence.lease_released_before_post_release_evidence,
    true,
  );
  assert.equal(
    operationEvidence.continuous_transition_lease_coverage_claimed,
    false,
  );
  assert.equal(
    operationEvidence.post_release_maintenance_window
      .activation_receipt_absent_before_checkpoint,
    true,
  );
  assert.equal(
    operationEvidence.post_release_maintenance_window
      .authoritative_quiescence_before_checkpoint,
    true,
  );
  assert.match(
    operationEvidence.post_release_maintenance_window.started_at,
    /Z$/,
  );
  assert.ok(operationEvidence.post_release_compensating_fences.length >= 4);
  for (const fence of operationEvidence.post_release_compensating_fences) {
    assert.equal(fence.request_unexpired, true);
    assert.equal(fence.activation_receipt_absent, true);
    assert.equal(fence.authoritative_quiescence, true);
    assert.equal(fence.source_identity.nlink, "1");
    assert.equal(fence.wal.size, 0);
    assert.equal(fence.shm.status, "ABSENT");
    assert.match(fence.completed_at, /Z$/);
  }
  const commitEvidence = JSON.parse(
    fs.readFileSync(result.evidence_commit, "utf8"),
  );
  assert.equal(
    commitEvidence.lease_released_before_post_release_evidence,
    true,
  );
  assert.equal(
    commitEvidence.continuous_transition_lease_coverage_claimed,
    false,
  );
  assert.deepEqual(
    commitEvidence.final_completion_authority,
    operationEvidence.final_completion_authority,
  );
  assert.equal(
    commitEvidence.post_commit_fence_policy
      .no_callback_await_or_fence_after_marker_install,
    true,
  );
  assert.deepEqual(
    commitEvidence.post_release_compensating_fences.map((fence) => fence.stage),
    [
      "before_post_maintenance_phase_write",
      "before_canonical_backup",
      "after_canonical_backup",
      "before_backup_evidence_compose",
      "after_backup_evidence_compose",
      "before_backup_evidence_write",
      "before_json_evidence_write",
      "before_markdown_evidence_write",
      "before_commit_write",
    ],
  );
  assert.equal(
    result.post_release_compensating_fences.at(-1).stage,
    "after_final_commit",
  );
});

test("writer in lease-release checkpoint gap holds and emits no usable backup evidence", async (t) => {
  const v = fixture(t),
    reader = new Database(v.databasePath, { readonly: true });
  reader.exec("BEGIN");
  reader.prepare("SELECT * FROM proof_rows").all();
  try {
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        afterLeaseRelease: async () => {
          const writer = new Database(v.databasePath);
          writer.prepare("INSERT INTO proof_rows(value) VALUES ('gap')").run();
          writer.close();
        },
      }),
    );
    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("source_wal_checkpoint_busy") ||
        result.blockers.includes("source_wal_logical_drift_after_checkpoint"),
    );
    assert.equal(result.backup_evidence_json, undefined);
  } finally {
    reader.close();
  }
});

test("writer during backup invalidates and removes fresh backup evidence", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      afterBackup: async () => {
        const writer = new Database(v.databasePath);
        writer
          .prepare("INSERT INTO proof_rows(value) VALUES ('backup-race')")
          .run();
        writer.close();
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_wal_source_drift_during_backup"));
  assert.equal(
    fs.existsSync(
      path.join(path.dirname(result.evidence_json), "backup-evidence.json"),
    ),
    false,
  );
});

test("activation receipt and process races hold before a backup is trusted", async (t) => {
  const v = fixture(t);
  const receipt = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      afterLeaseRelease: async () => fs.writeFileSync(v.receiptPath, "active"),
    }),
  );
  assert.equal(receipt.verdict, "HOLD");
  assert.ok(receipt.blockers.includes("source_wal_activation_receipt_present"));
  fs.rmSync(v.receiptPath);
  let checks = 0;
  const process = await cleanCloseGovernedSourceWal(
    request(v, { change_id: "change-2", confirmation_id: "change-2" }),
    deps({
      inspectQuiescence: async () => {
        checks += 1;
        return {
          ...(await deps().inspectQuiescence()),
          owner_pids: checks > 2 ? [4242] : [],
        };
      },
    }),
  );
  assert.equal(process.verdict, "HOLD");
  assert.ok(process.blockers.includes("source_wal_not_quiescent"));
});

test("transient unavailable quiescence probes are retried without weakening a real hold", async (t) => {
  const transient = fixture(t);
  let transientChecks = 0;
  const recovered = await cleanCloseGovernedSourceWal(
    request(transient),
    deps({
      inspectQuiescence: async () => {
        transientChecks += 1;
        if (transientChecks <= 2) {
          return {
            available: false,
            probe_attestations: {
              listeners: false,
              processes: false,
              scheduled_tasks: false,
            },
          };
        }
        return deps().inspectQuiescence();
      },
    }),
  );
  assert.equal(recovered.verdict, "PASS", JSON.stringify(recovered));
  assert.ok(transientChecks >= 3);

  const occupied = fixture(t);
  let occupiedChecks = 0;
  const held = await cleanCloseGovernedSourceWal(
    request(occupied, {
      change_id: "occupied-change",
      confirmation_id: "occupied-change",
    }),
    deps({
      inspectQuiescence: async () => {
        occupiedChecks += 1;
        return {
          ...(await deps().inspectQuiescence()),
          owner_pids: [4242],
        };
      },
    }),
  );
  assert.equal(held.verdict, "HOLD");
  assert.deepEqual(held.blockers, ["source_wal_not_quiescent"]);
  assert.equal(occupiedChecks, 1);

  const unavailable = fixture(t);
  const unavailableSha = sha(unavailable.databasePath);
  let unavailableChecks = 0,
    unavailableLeaseAcquires = 0;
  const unavailableResult = await cleanCloseGovernedSourceWal(
    request(unavailable, {
      change_id: "unavailable-change",
      confirmation_id: "unavailable-change",
    }),
    deps({
      inspectQuiescence: async () => {
        unavailableChecks += 1;
        return {
          available: false,
          probe_attestations: {
            listeners: false,
            processes: false,
            scheduled_tasks: false,
          },
        };
      },
      acquireLease: () => {
        unavailableLeaseAcquires += 1;
        throw new Error("must not acquire");
      },
    }),
  );
  assert.equal(unavailableResult.verdict, "HOLD");
  assert.deepEqual(unavailableResult.blockers, [
    "source_wal_quiescence_unavailable",
  ]);
  assert.equal(unavailableResult.status, "HELD");
  assert.equal(unavailableChecks, 3);
  assert.equal(unavailableLeaseAcquires, 0);
  assert.equal(sha(unavailable.databasePath), unavailableSha);

  const transientOccupied = fixture(t);
  let transientOccupiedChecks = 0;
  const transientOccupiedResult = await cleanCloseGovernedSourceWal(
    request(transientOccupied, {
      change_id: "transient-occupied-change",
      confirmation_id: "transient-occupied-change",
    }),
    deps({
      inspectQuiescence: async () => {
        transientOccupiedChecks += 1;
        const base = await deps().inspectQuiescence();
        if (transientOccupiedChecks === 1) {
          return {
            available: false,
            probe_attestations: {
              listeners: false,
              processes: false,
              scheduled_tasks: false,
            },
          };
        }
        return { ...base, owner_pids: [77] };
      },
    }),
  );
  assert.equal(transientOccupiedResult.verdict, "HOLD");
  assert.deepEqual(transientOccupiedResult.blockers, [
    "source_wal_not_quiescent",
  ]);
  assert.equal(transientOccupiedChecks, 2);

  const receiptRace = fixture(t);
  let receiptRaceChecks = 0;
  const receiptRaceResult = await cleanCloseGovernedSourceWal(
    request(receiptRace, {
      change_id: "retry-receipt-race",
      confirmation_id: "retry-receipt-race",
    }),
    deps({
      inspectQuiescence: async () => {
        receiptRaceChecks += 1;
        fs.writeFileSync(receiptRace.receiptPath, "active");
        return {
          available: false,
          probe_attestations: {
            listeners: false,
            processes: false,
            scheduled_tasks: false,
          },
        };
      },
    }),
  );
  assert.equal(receiptRaceResult.verdict, "HOLD");
  assert.deepEqual(receiptRaceResult.blockers, [
    "source_wal_activation_receipt_present",
  ]);
  assert.equal(receiptRaceChecks, 1);
});

test("hard-linked sources and partial directories are rejected without overwrite", async (t) => {
  const v = fixture(t),
    link = path.join(v.root, "pulse-hardlink.db");
  fs.linkSync(v.databasePath, link);
  const hard = await cleanCloseGovernedSourceWal(
    request(v, { database_path: link }),
    deps(),
  );
  assert.equal(hard.verdict, "HOLD");
  assert.ok(hard.blockers.includes("source_wal_database_unsafe"));
  fs.unlinkSync(link);
  const partialRequest = request(v, {
    change_id: "partial",
    confirmation_id: "partial",
  });
  const primed = await cleanCloseGovernedSourceWal(partialRequest, deps());
  assert.equal(primed.verdict, "PASS");
  const partialDir = path.dirname(primed.evidence_json);
  fs.rmSync(partialDir, { recursive: true, force: true });
  fs.mkdirSync(partialDir, { recursive: true });
  fs.writeFileSync(path.join(partialDir, "partial"), "x");
  const out = await cleanCloseGovernedSourceWal(partialRequest, deps());
  assert.equal(out.verdict, "HOLD");
  assert.ok(
    out.blockers.includes("source_wal_partial_output_recovery_required"),
  );
});

test("source drift after backup-evidence composition is held and its evidence is removed", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      afterBackupEvidenceCompose: async () => {
        const writer = new Database(v.databasePath);
        writer
          .prepare("INSERT INTO proof_rows(value) VALUES ('composer-race')")
          .run();
        writer.close();
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_wal_source_drift_after_composer"));
  assert.equal(
    fs.existsSync(
      path.join(path.dirname(result.evidence_json), "backup-evidence.json"),
    ),
    false,
  );
});

test("real default transition lease works on disposable WAL database", (t) => {
  const v = fixture(t);
  const lease = acquireLiveRuntimeTransitionLease({
    databasePath: v.databasePath,
    action: "wal-v4",
    binding: "fixture",
    now: new Date(NOW),
  });
  assert.equal(lease.renew(new Date(TEST_START.getTime() + 1000)), true);
  assert.equal(lease.release(), true);
});

test("CLI has an exact apply confirmation and expiry contract", (t) => {
  const v = fixture(t);
  const args = cliArguments(v, { includeTool: true });
  const sentinel = "sentinel-secret-must-never-appear";
  const refused = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ANTHROPIC_API_KEY: sentinel },
  });
  assert.equal(refused.status, 2);
  assert.equal(`${refused.stdout}${refused.stderr}`.includes(sentinel), false);
  const missing = [...args],
    index = missing.indexOf("--confirm");
  missing.splice(index, 2);
  assert.equal(
    spawnSync(process.execPath, missing, { encoding: "utf8" }).status,
    1,
  );
});

test("dependency failures redact secret sentinels from results and evidence", async (t) => {
  const v = fixture(t);
  const sentinel = "sentinel-secret-must-never-appear";
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      composeCutoverBackupEvidence: async () => {
        throw new Error(sentinel);
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  const publicBytes = [
    JSON.stringify(result),
    result.evidence_json && fs.readFileSync(result.evidence_json, "utf8"),
    result.evidence_markdown &&
      fs.readFileSync(result.evidence_markdown, "utf8"),
    result.evidence_commit && fs.readFileSync(result.evidence_commit, "utf8"),
  ]
    .filter(Boolean)
    .join("\n");
  assert.equal(publicBytes.includes(sentinel), false);
  assert.ok(
    result.blockers.includes("source_wal_clean_close_maintenance_error"),
  );
});

test("CLI surfaces the complete post-release fence ledger without extra authority", async (t) => {
  const v = fixture(t);
  let stdout = "";
  const code = await runGovernedSourceWalCli(cliArguments(v), {
    cleanClose: async () => ({
      verdict: "PASS",
      blockers: [],
      status: "COMMITTED",
      source_maintenance_performed: true,
      external_authority: {
        live_publish_performed: false,
        oauth_or_token_mutation_performed: false,
        scheduled_task_mutation_performed: false,
      },
      lease_released_before_post_release_evidence: true,
      continuous_transition_lease_coverage_claimed: false,
      phase_journals: {
        initial_path: "phase-initial.json",
        post_maintenance_path: "phase-post-maintenance.json",
      },
      protected_validation: {
        classification: "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY",
        restore_eligible: false,
      },
      canonical_artifacts: {
        classification: "CANONICAL_POST_TRANSITION_LEASE_RELEASE",
        restore_eligible: true,
      },
      transition_lease_boundary: {
        post_release_lease_gap_exists: true,
      },
      final_completion_authority: {
        role: "CANONICAL_BACKUP_EVIDENCE_FINAL_MARKER",
      },
      no_clobber_crash_recovery: [],
      post_release_maintenance_window: { checkpoint_mode: "TRUNCATE" },
      post_release_compensating_fences: [
        { stage: "after_final_commit", completed_at: NOW },
      ],
    }),
    stdout: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  const publicResult = JSON.parse(stdout);
  assert.equal(publicResult.source_maintenance_performed, true);
  assert.deepEqual(publicResult.external_authority, {
    live_publish_performed: false,
    oauth_or_token_mutation_performed: false,
    scheduled_task_mutation_performed: false,
  });
  assert.equal(publicResult.lease_released_before_post_release_evidence, true);
  assert.equal(
    publicResult.continuous_transition_lease_coverage_claimed,
    false,
  );
  assert.equal(publicResult.protected_validation.restore_eligible, false);
  assert.equal(publicResult.canonical_artifacts.restore_eligible, true);
  assert.equal(
    publicResult.transition_lease_boundary.post_release_lease_gap_exists,
    true,
  );
  assert.equal(
    publicResult.final_completion_authority.role,
    "CANONICAL_BACKUP_EVIDENCE_FINAL_MARKER",
  );
  assert.deepEqual(publicResult.no_clobber_crash_recovery, []);
  assert.equal(
    publicResult.post_release_compensating_fences.at(-1).stage,
    "after_final_commit",
  );
});

test("v4 emits the canonical composer evidence accepted by the quarantine contract", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(request(v), deps());
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  const evidence = JSON.parse(
    fs.readFileSync(result.backup_evidence_json, "utf8"),
  );
  for (const field of [
    "backup_id",
    "verified_at",
    "verified_by",
    "verification",
    "provenance",
  ])
    assert.ok(evidence[field], field);
  assert.equal(evidence.backup_restore_hashes_match, true);
  assert.match(evidence.verified_at, /Z$/);
  assert.notEqual(evidence.verified_at, NOW);
  const consumed = verifyBackupEvidence({
    evidencePath: result.backup_evidence_json,
    databasePath: v.databasePath,
    generatedAt: evidence.verified_at,
  });
  assert.equal(consumed.verified, true, JSON.stringify(consumed));
  assert.deepEqual(consumed.blockers, []);
});

test("source mutation at the first final evidence write cannot return PASS", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      beforeEvidenceCommit: async () => {
        const writer = new Database(v.databasePath);
        writer
          .prepare("INSERT INTO proof_rows(value) VALUES ('final-write-race')")
          .run();
        writer.close();
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("source_wal_source_drift_before_evidence_commit"),
  );
});

test("a late source hardlink is detected before evidence commit", async (t) => {
  const v = fixture(t),
    link = path.join(v.root, "late-link.db");
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      beforeEvidenceCommit: async () => fs.linkSync(v.databasePath, link),
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_wal_source_identity_drift"));
});

test("tampered restore hashes_match false cannot return PASS", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      rehearseSqliteRestore: async (options) => {
        const restored = await rehearseSqliteRestore(options);
        const tampered = { ...restored, hashes_match: false };
        fs.writeFileSync(
          options.evidencePath,
          `${JSON.stringify(tampered, null, 2)}\n`,
        );
        return tampered;
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("source_wal_restore_verification_invalid") ||
      result.blockers.includes("source_wal_cutover_evidence_invalid"),
  );
});

test("lease release false after a post-acquire fence failure is RECOVERY_REQUIRED", async (t) => {
  const v = fixture(t);
  let checks = 0,
    releases = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      inspectQuiescence: async () => {
        checks += 1;
        const base = await deps().inspectQuiescence();
        return checks === 3 ? { ...base, owner_pids: [42] } : base;
      },
      acquireLease: () => ({
        renew() {
          return true;
        },
        release() {
          releases += 1;
          return false;
        },
      }),
    }),
  );
  assert.equal(releases, 1);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.ok(result.blockers.includes("source_wal_lease_release_failed"));
});

test("sqlite_sequence is part of the logical digest", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      afterLeaseRelease: async () => {
        const writer = new Database(v.databasePath);
        writer
          .prepare(
            "UPDATE sqlite_sequence SET seq=seq+10 WHERE name='sequence_rows'",
          )
          .run();
        writer.close();
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("source_wal_logical_drift_after_checkpoint"),
  );
});

test("the fenced request window permits twenty-minute real-database proofs but no longer", async (t) => {
  const accepted = fixture(t);
  const generated = new Date(Date.now() - 1000);
  const acceptedResult = await cleanCloseGovernedSourceWal(
    request(accepted, {
      generated_at: generated.toISOString(),
      expires_at: new Date(
        generated.getTime() + 20 * 60 * 1000,
      ).toISOString(),
    }),
    deps({ now: () => generated, completionNow: () => new Date() }),
  );
  assert.equal(
    acceptedResult.verdict,
    "PASS",
    JSON.stringify(acceptedResult),
  );

  const rejected = fixture(t);
  const rejectedResult = await cleanCloseGovernedSourceWal(
    request(rejected, {
      generated_at: generated.toISOString(),
      expires_at: new Date(
        generated.getTime() + 20 * 60 * 1000 + 1,
      ).toISOString(),
      change_id: "too-long-window",
      confirmation_id: "too-long-window",
    }),
    deps({ now: () => generated }),
  );
  assert.equal(rejectedResult.verdict, "HOLD");
  assert.deepEqual(rejectedResult.blockers, ["source_wal_timestamp_invalid"]);
});

test("request generation may precede the operation and backup verification clocks", async (t) => {
  const v = fixture(t),
    operationClock = new Date(Date.now() - 30_000),
    generated = new Date(operationClock.getTime() - 60_000),
    expires = new Date(Date.now() + 5 * 60_000);
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      generated_at: generated.toISOString(),
      expires_at: expires.toISOString(),
    }),
    deps({ now: () => operationClock, completionNow: () => new Date() }),
  );
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  const evidence = JSON.parse(
    fs.readFileSync(result.backup_evidence_json, "utf8"),
  );
  assert.ok(
    Date.parse(evidence.verified_at) > Date.parse(generated.toISOString()),
  );
});

test("expiry at the final commit boundary preserves its precise HOLD blocker", async (t) => {
  const v = fixture(t);
  let completions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      completionNow: () => {
        completions += 1;
        return completions === 1 ? new Date() : new Date(EXPIRES);
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "source_wal_request_expired_before_commit",
  ]);
  assert.equal(
    result.blockers.includes("source_wal_clean_close_maintenance_error"),
    false,
  );
});

test("post-acquire fence failure releases once and preserves the underlying blocker", async (t) => {
  const v = fixture(t);
  let checks = 0,
    releases = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      inspectQuiescence: async () => {
        checks += 1;
        const base = await deps().inspectQuiescence();
        return checks === 3 ? { ...base, owner_pids: [77] } : base;
      },
      acquireLease: () => ({
        renew() {
          return true;
        },
        release() {
          releases += 1;
          return true;
        },
      }),
    }),
  );
  assert.equal(releases, 1);
  assert.deepEqual(result.blockers, ["source_wal_not_quiescent"]);
  assert.equal(result.status, "HELD");
});

test("committed evidence replays only when every bound component hash matches", async (t) => {
  const v = fixture(t),
    exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS");
  const marker = JSON.parse(fs.readFileSync(first.evidence_commit, "utf8"));
  assert.equal(marker.json_sha256, sha(first.evidence_json));
  assert.equal(marker.markdown_sha256, sha(first.evidence_markdown));
  assert.equal(marker.backup_evidence_sha256, sha(first.backup_evidence_json));
  const replay = await cleanCloseGovernedSourceWal(
    exactRequest,
    deps({
      acquireLease: () => {
        throw new Error("replay_must_not_acquire");
      },
    }),
  );
  assert.equal(replay.status, "REPLAYED");
  const canonicalPaths = [
    first.canonical_artifacts.backup_identity.path,
    first.canonical_artifacts.backup_verification_identity.path,
    first.canonical_artifacts.restore_identity.path,
    first.canonical_artifacts.restore_evidence_identity.path,
  ];
  fs.appendFileSync(first.evidence_json, "tampered");
  const tampered = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(tampered.verdict, "HOLD");
  assert.ok(tampered.blockers.includes("source_wal_evidence_commit_invalid"));
  assert.equal(fs.existsSync(first.evidence_commit), false);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

test("replay repairs an exact commit temp-only no-clobber crash", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const temporary = `${first.evidence_commit}.${sha(first.evidence_commit)}.tmp`;
  fs.renameSync(first.evidence_commit, temporary);

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "PASS", JSON.stringify(replay));
  assert.equal(replay.status, "REPLAYED");
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.statSync(first.evidence_commit).nlink, 1);
});

test("replay repairs an exact commit target-plus-temp no-clobber crash", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const temporary = `${first.evidence_commit}.${sha(first.evidence_commit)}.tmp`;
  fs.linkSync(first.evidence_commit, temporary);
  assert.equal(fs.statSync(first.evidence_commit).nlink, 2);

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "PASS", JSON.stringify(replay));
  assert.equal(replay.status, "REPLAYED");
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.statSync(first.evidence_commit).nlink, 1);
});

for (const crashState of ["temp-only", "target-plus-temp"]) {
  test(`a ${crashState} final marker stays noncanonical until recovery revokes it`, async (t) => {
    const v = fixture(t);
    const exactRequest = request(v);
    const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
    assert.equal(first.verdict, "PASS", JSON.stringify(first));
    const temporary = `${first.backup_evidence_json}.${sha(first.backup_evidence_json)}.tmp`;
    if (crashState === "temp-only") {
      fs.renameSync(first.backup_evidence_json, temporary);
    } else {
      fs.linkSync(first.backup_evidence_json, temporary);
      assert.equal(fs.statSync(first.backup_evidence_json).nlink, 2);
    }

    const recovered = await cleanCloseGovernedSourceWal(exactRequest, deps());
    assert.equal(recovered.verdict, "HOLD", JSON.stringify(recovered));
    assert.notEqual(recovered.status, "REPLAYED");
    assert.equal(fs.existsSync(first.backup_evidence_json), false);
    assert.equal(fs.existsSync(temporary), false);
    assert.equal(fs.existsSync(first.evidence_commit), false);
    for (const artifactPath of canonicalPaths(first)) {
      assert.equal(fs.existsSync(artifactPath), false, artifactPath);
    }
  });
}

test("real transition lease remains compatible with the full disposable operation", async (t) => {
  const v = fixture(t),
    realDeps = deps();
  delete realDeps.acquireLease;
  const result = await cleanCloseGovernedSourceWal(request(v), realDeps);
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  assert.equal(zeroOrAbsentWal(v), true);
  assert.equal(fs.existsSync(`${v.databasePath}-shm`), false);
  assert.equal(transitionLeaseCount(result.backup.backupPath), 0);
  assert.equal(transitionLeaseCount(result.restore.restored_copy), 0);
  assert.equal(result.protected_validation.restore_eligible, false);
  assert.equal(result.protected_validation.canonical_evidence_input, false);
  assert.equal(result.protected_validation.backup_transition_lease_rows, 1);
  assert.equal(result.protected_validation.restore_transition_lease_rows, 1);
  assert.equal(result.canonical_artifacts.restore_eligible, true);
  assert.equal(result.canonical_artifacts.backup_transition_lease_rows, 0);
  assert.equal(result.canonical_artifacts.restore_transition_lease_rows, 0);
  assert.notEqual(
    path.dirname(result.protected_validation.backup_path),
    path.dirname(result.backup.backupPath),
  );
  const evidence = JSON.parse(
    fs.readFileSync(result.backup_evidence_json, "utf8"),
  );
  const consumed = verifyBackupEvidence({
    evidencePath: result.backup_evidence_json,
    databasePath: v.databasePath,
    generatedAt: evidence.verified_at,
  });
  assert.equal(consumed.verified, true, JSON.stringify(consumed));
});

test("an immutable real-lease result securely replays from its post-maintenance source state", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const realDependencies = deps();
  delete realDependencies.acquireLease;
  let composition = null;
  realDependencies.composeCutoverBackupEvidence = async (options) => {
    composition = await composeCutoverBackupEvidence(options);
    return composition;
  };
  const first = await cleanCloseGovernedSourceWal(
    exactRequest,
    realDependencies,
  );
  assert.equal(first.verdict, "PASS", JSON.stringify({ first, composition }));
  assert.notEqual(sha(v.databasePath), exactRequest.expected_database_sha256);
  const replay = await cleanCloseGovernedSourceWal(
    exactRequest,
    realDependencies,
  );
  assert.equal(replay.verdict, "PASS", JSON.stringify(replay));
  assert.equal(replay.status, "REPLAYED");
});

test("a valid committed result securely replays after the exact request expires", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const staleNow = new Date(Date.parse(exactRequest.expires_at) + 1);
  const replay = await cleanCloseGovernedSourceWal(
    exactRequest,
    deps({ now: () => staleNow, completionNow: () => staleNow }),
  );
  assert.equal(replay.verdict, "PASS", JSON.stringify(replay));
  assert.equal(replay.status, "REPLAYED");
});

test("an exit-88 child crash before final authority is revoked after expiry when activation returns", async (t) => {
  const v = fixture(t);
  const generated = new Date();
  const exactRequest = request(v, {
    generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 60_000).toISOString(),
    change_id: "child-crash",
    confirmation_id: "child-crash",
  });
  const child = crashChildAtAfterFinalCommit(v, exactRequest);
  assert.equal(child.status, 88, `${child.stdout}\n${child.stderr}`);
  const directory = operationDirectory(v);
  const commitPath = path.join(directory, "clean-close.commit.json");
  const backupEvidencePath = path.join(directory, "backup-evidence.json");
  assert.equal(fs.existsSync(commitPath), true);
  assert.equal(
    fs.existsSync(backupEvidencePath),
    false,
    "the canonical consumer completion marker must be written last",
  );
  const discoveredCanonical = fs
    .readdirSync(path.join(directory, "backup"))
    .map((name) => path.join(directory, "backup", name));
  assert.ok(discoveredCanonical.length >= 4);

  fs.writeFileSync(v.receiptPath, JSON.stringify({ active: true }));
  const staleNow = new Date(Date.parse(exactRequest.expires_at) + 1);
  const recovered = await cleanCloseGovernedSourceWal(
    exactRequest,
    deps({ now: () => staleNow, completionNow: () => staleNow }),
  );
  assert.equal(recovered.verdict, "HOLD", JSON.stringify(recovered));
  assert.notEqual(recovered.status, "REPLAYED");
  assert.ok(
    recovered.blockers.includes("source_wal_activation_receipt_present"),
  );
  for (const name of [
    "backup-evidence.json",
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(directory, name)), false, name);
  }
  for (const artifactPath of discoveredCanonical) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

test("real-lease replay refuses source drift and invalidates committed canonical authority", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const realDependencies = deps();
  delete realDependencies.acquireLease;
  const first = await cleanCloseGovernedSourceWal(
    exactRequest,
    realDependencies,
  );
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonicalBackupPath = first.backup.backupPath;
  const writer = new Database(v.databasePath);
  writer
    .prepare("INSERT INTO proof_rows(value) VALUES ('post-commit-drift')")
    .run();
  writer.close();
  const replay = await cleanCloseGovernedSourceWal(
    exactRequest,
    realDependencies,
  );
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.equal(replay.status, "EVIDENCE_PENDING");
  assert.equal(fs.existsSync(first.evidence_commit), false);
  assert.equal(fs.existsSync(canonicalBackupPath), false);
});

test("a corrupt commit invalidates every discoverable canonical artifact", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonicalPaths = [
    first.canonical_artifacts.backup_identity.path,
    first.canonical_artifacts.backup_verification_identity.path,
    first.canonical_artifacts.restore_identity.path,
    first.canonical_artifacts.restore_evidence_identity.path,
  ];
  fs.appendFileSync(first.evidence_commit, "corrupt");

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.equal(fs.existsSync(first.evidence_commit), false);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

test("restart invalidates canonical partials when no commit authority remains", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonical = canonicalPaths(first);
  for (const finalPath of [
    first.evidence_commit,
    first.evidence_json,
    first.evidence_markdown,
    first.backup_evidence_json,
  ]) {
    fs.unlinkSync(finalPath);
  }

  const restarted = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(restarted.verdict, "HOLD", JSON.stringify(restarted));
  assert.equal(restarted.status, "RECOVERY_REQUIRED");
  assert.ok(
    restarted.blockers.includes("source_wal_partial_output_recovery_required"),
  );
  for (const artifactPath of canonical) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
  assert.equal(
    fs.existsSync(first.protected_validation.classification_path),
    true,
  );
  assert.equal(first.protected_validation.restore_eligible, false);
});

test("replay artifact tamper invalidates the complete canonical set", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonicalPaths = [
    first.canonical_artifacts.backup_identity.path,
    first.canonical_artifacts.backup_verification_identity.path,
    first.canonical_artifacts.restore_identity.path,
    first.canonical_artifacts.restore_evidence_identity.path,
  ];
  fs.appendFileSync(first.canonical_artifacts.restore_identity.path, "tamper");

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.equal(fs.existsSync(first.evidence_commit), false);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

test("forged recovery identities cannot invalidate files outside the canonical directory", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const outside = path.join(v.root, "must-survive.txt");
  fs.writeFileSync(outside, "operator-owned-sentinel");
  const outsideStat = fs.statSync(outside, { bigint: true });
  const body = JSON.parse(fs.readFileSync(first.evidence_json, "utf8"));
  body.canonical_artifacts.backup_identity = {
    path: outside,
    real_path: fs.realpathSync.native(outside),
    dev: outsideStat.dev.toString(),
    ino: outsideStat.ino.toString(),
    nlink: outsideStat.nlink.toString(),
    size: Number(outsideStat.size),
    sha256: sha(outside),
    key: `${outsideStat.dev}:${outsideStat.ino}`,
  };
  fs.writeFileSync(first.evidence_json, `${JSON.stringify(body, null, 2)}\n`);
  const commit = JSON.parse(fs.readFileSync(first.evidence_commit, "utf8"));
  commit.json_sha256 = sha(first.evidence_json);
  fs.writeFileSync(
    first.evidence_commit,
    `${JSON.stringify(commit, null, 2)}\n`,
  );

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.equal(fs.readFileSync(outside, "utf8"), "operator-owned-sentinel");
  assert.equal(fs.existsSync(first.evidence_commit), false);
});

test("replay source hardlink invalidates committed canonical authority", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonicalPaths = [
    first.canonical_artifacts.backup_identity.path,
    first.canonical_artifacts.backup_verification_identity.path,
    first.canonical_artifacts.restore_identity.path,
    first.canonical_artifacts.restore_evidence_identity.path,
  ];
  fs.linkSync(v.databasePath, path.join(v.root, "source-hardlink.db"));

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.ok(replay.blockers.includes("source_wal_database_unsafe"));
  assert.equal(fs.existsSync(first.evidence_commit), false);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

test("replay unsafe WAL sidecar invalidates committed canonical authority", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonicalPaths = [
    first.canonical_artifacts.backup_identity.path,
    first.canonical_artifacts.backup_verification_identity.path,
    first.canonical_artifacts.restore_identity.path,
    first.canonical_artifacts.restore_evidence_identity.path,
  ];
  const walPath = `${v.databasePath}-wal`;
  fs.writeFileSync(walPath, "");
  fs.linkSync(walPath, path.join(v.root, "wal-hardlink"));

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.ok(replay.blockers.includes("source_wal_sidecar_unsafe"));
  assert.equal(fs.existsSync(first.evidence_commit), false);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), false, artifactPath);
  }
});

for (const [component, mutation] of [
  ["backup-evidence.json", "tamper"],
  ["clean-close.json", "delete"],
  ["clean-close.md", "replace-same-bytes"],
  ["clean-close.commit.json", "hardlink"],
]) {
  test(`fresh PASS is refused when ${component} suffers a ${mutation} race after commit`, async (t) => {
    const v = fixture(t);
    let canonical = [];
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        composeCutoverBackupEvidence: async (options) => {
          const composed = await composeCutoverBackupEvidence(options);
          canonical = [
            composed.evidence.backup_path,
            `${composed.evidence.backup_path}.verification.json`,
            composed.evidence.restore_path,
            path.join(
              path.dirname(composed.evidence.restore_path),
              "restore.rehearsal.json",
            ),
          ];
          return composed;
        },
        afterFinalCommit: async () => {
          mutateFinalComponent(
            path.join(operationDirectory(v), component),
            mutation,
            v.root,
          );
        },
      }),
    );
    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    const directory = operationDirectory(v);
    for (const name of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(fs.existsSync(path.join(directory, name)), false, name);
    }
    for (const artifactPath of canonical) {
      assert.equal(fs.existsSync(artifactPath), false, artifactPath);
    }
  });
}

for (const [boundary, component] of [
  ["beforeJsonEvidenceWrite", "backup-evidence.json"],
  ["beforeMarkdownEvidenceWrite", "clean-close.json"],
  ["beforeCommitWrite", "clean-close.md"],
]) {
  test(`${boundary} revalidates the already-written ${component}`, async (t) => {
    const v = fixture(t);
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        [boundary]: async () => {
          fs.appendFileSync(
            path.join(operationDirectory(v), component),
            `tampered:${boundary}`,
          );
        },
      }),
    );
    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    const directory = operationDirectory(v);
    for (const name of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(fs.existsSync(path.join(directory, name)), false, name);
    }
  });
}

for (const [component, mutation] of [
  ["backup-evidence.json", "tamper"],
  ["clean-close.json", "delete"],
  ["clean-close.md", "replace-same-bytes"],
  ["clean-close.commit.json", "hardlink"],
]) {
  test(`replay is refused when ${component} suffers a ${mutation} race after an async fence`, async (t) => {
    const v = fixture(t);
    const exactRequest = request(v);
    const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
    assert.equal(first.verdict, "PASS", JSON.stringify(first));
    const canonical = canonicalPaths(first);
    let inspections = 0;
    const replay = await cleanCloseGovernedSourceWal(
      exactRequest,
      deps({
        inspectQuiescence: async () => {
          inspections += 1;
          if (inspections === 2) {
            mutateFinalComponent(
              path.join(path.dirname(first.evidence_commit), component),
              mutation,
              v.root,
            );
          }
          return deps().inspectQuiescence();
        },
      }),
    );
    assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
    for (const name of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(
        fs.existsSync(path.join(path.dirname(first.evidence_commit), name)),
        false,
        name,
      );
    }
    for (const artifactPath of canonical) {
      assert.equal(fs.existsSync(artifactPath), false, artifactPath);
    }
  });
}

for (const boundary of [
  "beforeBackupEvidenceWrite",
  "beforeJsonEvidenceWrite",
  "beforeMarkdownEvidenceWrite",
  "beforeCommitWrite",
  "afterFinalCommit",
]) {
  test(`post-release source mutation at ${boundary} invalidates usable evidence`, async (t) => {
    const v = fixture(t);
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        [boundary]: async () => {
          const writer = new Database(v.databasePath);
          writer
            .prepare("INSERT INTO proof_rows(value) VALUES (?)")
            .run(boundary);
          writer.close();
        },
      }),
    );
    assert.equal(
      result.verdict,
      "HOLD",
      `${boundary}:${JSON.stringify(result)}`,
    );
    assert.equal(result.status, "EVIDENCE_PENDING");
    const evidenceDirectory = path.dirname(result.evidence_json);
    for (const canonicalName of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(
        fs.existsSync(path.join(evidenceDirectory, canonicalName)),
        false,
        `${boundary}:${canonicalName}`,
      );
    }
  });
}

for (const [boundary, role, mutation] of [
  ["afterBackupEvidenceCompose", "backup", "tamper"],
  ["beforeBackupEvidenceWrite", "restore", "delete"],
  ["beforeJsonEvidenceWrite", "backup", "delete"],
  ["beforeMarkdownEvidenceWrite", "restore", "tamper"],
  ["beforeCommitWrite", "backup", "tamper"],
  ["afterFinalCommit", "restore", "delete"],
]) {
  test(`${role} ${mutation} at ${boundary} invalidates every usable canonical component`, async (t) => {
    const v = fixture(t);
    let artifactPath = null;
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        composeCutoverBackupEvidence: async (options) => {
          const composed = await composeCutoverBackupEvidence(options);
          artifactPath =
            role === "backup"
              ? composed.evidence?.backup_path
              : composed.evidence?.restore_path;
          return composed;
        },
        [boundary]: async () => {
          assert.ok(artifactPath, `${boundary}:${role}`);
          if (mutation === "delete") fs.unlinkSync(artifactPath);
          else fs.appendFileSync(artifactPath, `tampered:${boundary}`);
        },
      }),
    );
    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    assert.equal(result.status, "EVIDENCE_PENDING");
    assert.equal(fs.existsSync(artifactPath), false);
    const evidenceDirectory = path.dirname(result.evidence_json);
    for (const canonicalName of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(
        fs.existsSync(path.join(evidenceDirectory, canonicalName)),
        false,
        `${boundary}:${canonicalName}`,
      );
    }
  });
}

for (const releaseFailure of ["false", "throw"]) {
  test(`post-restore lease release ${releaseFailure} is surfaced before evidence composition`, async (t) => {
    const v = fixture(t);
    let releases = 0,
      compositions = 0;
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        acquireLease: () => ({
          renew() {
            return true;
          },
          release() {
            releases += 1;
            if (releaseFailure === "throw")
              throw new Error("injected release failure");
            return false;
          },
        }),
        composeCutoverBackupEvidence: async () => {
          compositions += 1;
          throw new Error("composer must not run");
        },
      }),
    );
    assert.equal(releases, 1);
    assert.equal(compositions, 0);
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.ok(result.blockers.includes("source_wal_lease_release_failed"));
    assert.equal(result.backup_evidence_json, undefined);
  });
}

test("lease loss at the post-restore renewal blocks evidence and releases once", async (t) => {
  const v = fixture(t);
  let renewals = 0;
  let releases = 0;
  let compositions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      acquireLease: () => ({
        renew() {
          renewals += 1;
          if (renewals === 4) throw new Error("injected lease loss");
          return true;
        },
        release() {
          releases += 1;
          return true;
        },
      }),
      composeCutoverBackupEvidence: async () => {
        compositions += 1;
        throw new Error("composer must not run");
      },
    }),
  );
  assert.equal(renewals, 4);
  assert.equal(releases, 1);
  assert.equal(compositions, 0);
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_wal_lease_lost"));
  assert.equal(result.backup_evidence_json, undefined);
});

for (const [label, mutate] of [
  [
    "schema object",
    (db) => db.exec("CREATE INDEX proof_rows_value_idx ON proof_rows(value)"),
  ],
  ["stable pragma", (db) => db.pragma("user_version = 23")],
]) {
  test(`post-release ${label} drift is fenced before canonical evidence`, async (t) => {
    const v = fixture(t);
    const result = await cleanCloseGovernedSourceWal(
      request(v),
      deps({
        beforeBackupEvidenceWrite: async () => {
          const writer = new Database(v.databasePath);
          mutate(writer);
          writer.close();
        },
      }),
    );
    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    assert.equal(result.status, "EVIDENCE_PENDING");
    assert.equal(result.backup_evidence_json, undefined);
    assert.ok(
      result.blockers.includes(
        "source_wal_source_drift_before_evidence_commit",
      ),
    );
  });
}
