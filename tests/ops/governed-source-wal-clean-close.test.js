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
  DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");
const {
  inspectLiveDatabaseIdentity,
} = require("../../lib/stabilisation/windows-live-guarded-runtime");
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
  BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1",
  AUTHORITY_FINGERPRINT = "9".repeat(64),
  OBSERVATION_SHA256 = "8".repeat(64),
  DATABASE_SNAPSHOT_SHA256 = "7".repeat(64),
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
function fileEvidence(file) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved, { bigint: true });
  return {
    path: resolved,
    real_path: fs.realpathSync.native(resolved),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    nlink: stat.nlink.toString(),
    size: Number(stat.size),
    sha256: sha(resolved),
    key: `${stat.dev}:${stat.ino}`,
  };
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
function exactWalLease({
  databasePath,
  metadata,
  now,
  authorityContextSha256,
  authorityContextProvider,
}) {
  const ownerId = "fixture-source-wal-transition-owner";
  const leaseMs = DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS;
  const participantIdentity = Object.freeze({
    participant_id: "fixture-source-wal-transition-participant",
    role: "owner",
    process_id: process.pid,
    process_started_at: NOW,
    process_start_source: "injected",
  });
  const write = (callback) => {
    const db = new Database(databasePath);
    try {
      return callback(db);
    } finally {
      db.close();
    }
  };
  const acquiredAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
  write((db) =>
    db
      .prepare(
        `INSERT INTO runtime_leases
         (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        LIVE_RUNTIME_TRANSITION_LEASE_NAME,
        ownerId,
        acquiredAt,
        acquiredAt,
        expiresAt,
        JSON.stringify({
          transition_owner_schema_version:
            "pulse-live-runtime-transition-owner-v2",
          authority_context_sha256: authorityContextSha256,
          admission_state: "OPEN",
          context: { ...metadata },
          participants: [{ ...participantIdentity }],
        }),
      ),
  );
  return {
    name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
    owner_id: ownerId,
    participant_id: participantIdentity.participant_id,
    participant_identity: participantIdentity,
    lease_ms: leaseMs,
    authority_context_sha256: authorityContextSha256,
    borrowed: false,
    assertCurrentAuthority() {
      const measured = authorityContextProvider();
      if (measured !== authorityContextSha256) {
        throw new Error("source_wal_lease_lost");
      }
      return measured;
    },
    renew(renewedAt) {
      const heartbeatAt = renewedAt.toISOString();
      const renewedExpiresAt = new Date(
        renewedAt.getTime() + leaseMs,
      ).toISOString();
      return (
        write((db) =>
          db
            .prepare(
              `UPDATE runtime_leases
                  SET heartbeat_at=?, expires_at=?
                WHERE name=? AND owner_id=?`,
            )
            .run(
              heartbeatAt,
              renewedExpiresAt,
              LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId,
            ),
        ).changes === 1
      );
    },
    release() {
      return (
        write((db) =>
          db
            .prepare("DELETE FROM runtime_leases WHERE name=? AND owner_id=?")
            .run(LIVE_RUNTIME_TRANSITION_LEASE_NAME, ownerId),
        ).changes === 1
      );
    },
  };
}
function exactWalLeaseWith(options, hooks = {}) {
  const lease = exactWalLease(options);
  return {
    ...lease,
    async renew(renewedAt) {
      const decision = hooks.renew
        ? await hooks.renew({ lease, renewedAt })
        : undefined;
      if (decision === false) return false;
      return lease.renew(renewedAt);
    },
    async release() {
      const decision = hooks.release
        ? await hooks.release({ lease })
        : undefined;
      if (decision === false) return false;
      return lease.release();
    },
  };
}
function deps(o = {}) {
  let quiescenceClockMs = Date.parse(NOW);
  return {
    now: () => new Date(NOW),
    quiescenceNow: () => new Date(quiescenceClockMs),
    waitForQuiescenceRetry: async ({ delay_ms }) => {
      quiescenceClockMs += delay_ms;
    },
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
      schema: BOUNDED_AUTHORITY_SCHEMA,
      verdict: "GREEN",
      state: "STOPPED_BOUND",
      authority_fingerprint: AUTHORITY_FINGERPRINT,
      runtime_instance_id: null,
      observation_sha256: OBSERVATION_SHA256,
      database_snapshot_sha256: DATABASE_SNAPSHOT_SHA256,
      blockers: [],
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
      task_states: [],
      absent_task_names: [
        "PulseGaming-LiveGuarded-YouTube-Runtime",
        "PulseGaming-Stabilisation-Runtime",
      ],
      diagnostics: null,
    }),
    runtimeProfileValidator: () => ({ valid: true }),
    acquireLease: exactWalLease,
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
    const Database = require("better-sqlite3");
    const { cleanCloseGovernedSourceWal } = require(process.argv[1]);
    const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const acquireLease = ({
      databasePath,
      metadata,
      now,
      authorityContextSha256,
      authorityContextProvider,
    }) => {
      const leaseName = "${LIVE_RUNTIME_TRANSITION_LEASE_NAME}";
      const ownerId = "child-source-wal-transition-owner";
      const leaseMs = ${DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS};
      const participantIdentity = Object.freeze({
        participant_id: "child-source-wal-transition-participant",
        role: "owner",
        process_id: process.pid,
        process_started_at: request.generated_at,
        process_start_source: "injected",
      });
      const write = (callback) => {
        const db = new Database(databasePath);
        try { return callback(db); } finally { db.close(); }
      };
      const acquiredAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
      write((db) => db.prepare(
        "INSERT INTO runtime_leases (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        leaseName,
        ownerId,
        acquiredAt,
        acquiredAt,
        expiresAt,
        JSON.stringify({
          transition_owner_schema_version: "pulse-live-runtime-transition-owner-v2",
          authority_context_sha256: authorityContextSha256,
          admission_state: "OPEN",
          context: { ...metadata },
          participants: [{ ...participantIdentity }],
        }),
      ));
      return {
        name: leaseName,
        owner_id: ownerId,
        participant_id: participantIdentity.participant_id,
        participant_identity: participantIdentity,
        lease_ms: leaseMs,
        authority_context_sha256: authorityContextSha256,
        borrowed: false,
        assertCurrentAuthority() {
          const measured = authorityContextProvider();
          if (measured !== authorityContextSha256) throw new Error("lease_lost");
          return measured;
        },
        renew(renewedAt) {
          const heartbeatAt = renewedAt.toISOString();
          const renewedExpiresAt = new Date(
            renewedAt.getTime() + leaseMs,
          ).toISOString();
          return write((db) => db.prepare(
            "UPDATE runtime_leases SET heartbeat_at=?, expires_at=? WHERE name=? AND owner_id=?",
          ).run(
            heartbeatAt,
            renewedExpiresAt,
            leaseName,
            ownerId,
          )).changes === 1;
        },
        release() {
          return write((db) => db.prepare(
            "DELETE FROM runtime_leases WHERE name=? AND owner_id=?",
          ).run(leaseName, ownerId)).changes === 1;
        },
      };
    };
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
        schema: "${BOUNDED_AUTHORITY_SCHEMA}",
        verdict: "GREEN",
        state: "STOPPED_BOUND",
        authority_fingerprint: "${AUTHORITY_FINGERPRINT}",
        runtime_instance_id: null,
        observation_sha256: "${OBSERVATION_SHA256}",
        database_snapshot_sha256: "${DATABASE_SNAPSHOT_SHA256}",
        blockers: [],
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
        task_states: [],
        absent_task_names: [
          "PulseGaming-LiveGuarded-YouTube-Runtime",
          "PulseGaming-Stabilisation-Runtime",
        ],
        diagnostics: null,
      }),
      runtimeProfileValidator: () => ({ valid: true }),
      acquireLease,
      afterFinalCommit: () => process.exit(88),
    }).then((result) => {
      process.stderr.write(JSON.stringify(result));
      process.exit(89);
    }, () => process.exit(90));
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
  const baseDependencies = deps();
  let boundDatabaseProbes = 0;
  let snapshotAuthorityProbes = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      inspectQuiescence: async ({ db }) => {
        const main = db
          .prepare("PRAGMA database_list")
          .all()
          .find((row) => row.name === "main");
        assert.equal(
          samePath(main?.file, v.databasePath),
          true,
          "each authority probe must remain bound to the physical source database",
        );
        boundDatabaseProbes += 1;
        const transitionLeaseCount = db
          .prepare("SELECT COUNT(*) AS count FROM runtime_leases WHERE name=?")
          .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count;
        if (transitionLeaseCount === 0) snapshotAuthorityProbes += 1;
        return baseDependencies.inspectQuiescence();
      },
    }),
  );
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  assert.ok(boundDatabaseProbes > 10);
  assert.ok(
    snapshotAuthorityProbes >= 2,
    "pre-acquire and post-release snapshot probes must retain exact DB identity",
  );
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
  const runtimeAuthority = operationEvidence.runtime_authority;
  assert.deepEqual(runtimeAuthority, result.runtime_authority);
  assert.equal(runtimeAuthority.schema, BOUNDED_AUTHORITY_SCHEMA);
  assert.equal(runtimeAuthority.authority_fingerprint, AUTHORITY_FINGERPRINT);
  assert.equal(runtimeAuthority.observation_sha256, OBSERVATION_SHA256);
  assert.equal(
    runtimeAuthority.database_snapshot_sha256,
    DATABASE_SNAPSHOT_SHA256,
  );
  assert.match(runtimeAuthority.database_identity_sha256, /^[0-9a-f]{64}$/);
  for (const evidencePath of [
    result.phase_initial,
    result.phase_post_maintenance,
    result.protected_validation_classification,
  ]) {
    assert.deepEqual(
      JSON.parse(fs.readFileSync(evidencePath, "utf8")).runtime_authority,
      runtimeAuthority,
    );
  }
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
    assert.deepEqual(fence.runtime_authority, runtimeAuthority);
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
  assert.deepEqual(commitEvidence.runtime_authority, runtimeAuthority);
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

test("a receipt appearing during a successful quiescence inspection holds before the phase journal", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  let leaseAcquisitions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "receipt-during-successful-inspection",
      confirmation_id: "receipt-during-successful-inspection",
    }),
    deps({
      inspectQuiescence: async () => {
        inspections += 1;
        const observed = await deps().inspectQuiescence();
        if (inspections === 2) {
          fs.writeFileSync(v.receiptPath, "active");
        }
        return observed;
      },
      acquireLease: () => {
        leaseAcquisitions += 1;
        throw new Error("lease_must_not_be_acquired");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_activation_receipt_present"]);
  assert.equal(result.status, "HELD");
  assert.equal(inspections, 2);
  assert.equal(leaseAcquisitions, 0);
  assert.equal(fs.existsSync(path.join(v.root, "evidence")), false);
});

test("expiry during an early successful quiescence inspection holds before the phase journal", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  let expireOnNextClockRead = false;
  let leaseAcquisitions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "expiry-during-early-successful-inspection",
      confirmation_id: "expiry-during-early-successful-inspection",
    }),
    deps({
      quiescenceNow: () => {
        if (!expireOnNextClockRead) return new Date(NOW);
        expireOnNextClockRead = false;
        return new Date(EXPIRES);
      },
      inspectQuiescence: async () => {
        inspections += 1;
        const observed = await deps().inspectQuiescence();
        if (inspections === 2) expireOnNextClockRead = true;
        return observed;
      },
      acquireLease: () => {
        leaseAcquisitions += 1;
        throw new Error("lease_must_not_be_acquired");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_request_expired"]);
  assert.equal(result.status, "HELD");
  assert.equal(inspections, 2);
  assert.equal(leaseAcquisitions, 0);
  assert.equal(fs.existsSync(path.join(v.root, "evidence")), false);
});

test("a receipt appearing during a successful lease renewal holds before checkpoint maintenance", async (t) => {
  const v = fixture(t);
  let renewals = 0;
  let releases = 0;
  let checkpointCalls = 0;
  const originalPrepare = Database.prototype.prepare;
  Database.prototype.prepare = function observedPrepare(source, ...args) {
    if (
      String(source).trim().toLowerCase() === "pragma wal_checkpoint(truncate)"
    ) {
      checkpointCalls += 1;
    }
    return originalPrepare.call(this, source, ...args);
  };

  try {
    const result = await cleanCloseGovernedSourceWal(
      request(v, {
        change_id: "receipt-during-successful-renewal",
        confirmation_id: "receipt-during-successful-renewal",
      }),
      deps({
        acquireLease: (options) =>
          exactWalLeaseWith(options, {
            async renew() {
            renewals += 1;
            if (renewals === 1) {
              await Promise.resolve();
              fs.writeFileSync(v.receiptPath, "active");
            }
            },
            release() {
            releases += 1;
            },
          }),
      }),
    );

    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    assert.deepEqual(result.blockers, [
      "source_wal_activation_receipt_present",
      "source_wal_hold_evidence_pending",
      "source_wal_lease_release_failed",
    ]);
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(renewals, 1);
    assert.equal(releases, 0);
    assert.equal(checkpointCalls, 0, "checkpoint maintenance must not start");
    assert.equal(
      fs.existsSync(
        path.join(
          operationDirectory(v),
          "noncanonical-lease-protected-validation",
        ),
      ),
      false,
    );
  } finally {
    Database.prototype.prepare = originalPrepare;
  }
});

test("expiry during a successful lease renewal holds before checkpoint maintenance", async (t) => {
  const v = fixture(t);
  let quiescenceClockMs = Date.parse(NOW);
  let renewals = 0;
  let releases = 0;
  let checkpointCalls = 0;
  const originalPrepare = Database.prototype.prepare;
  Database.prototype.prepare = function observedPrepare(source, ...args) {
    if (
      String(source).trim().toLowerCase() === "pragma wal_checkpoint(truncate)"
    ) {
      checkpointCalls += 1;
    }
    return originalPrepare.call(this, source, ...args);
  };

  try {
    const result = await cleanCloseGovernedSourceWal(
      request(v, {
        change_id: "expiry-during-successful-renewal",
        confirmation_id: "expiry-during-successful-renewal",
      }),
      deps({
        quiescenceNow: () => new Date(quiescenceClockMs),
        acquireLease: (options) =>
          exactWalLeaseWith(options, {
            async renew() {
            renewals += 1;
            if (renewals === 1) {
              await Promise.resolve();
              quiescenceClockMs = Date.parse(EXPIRES);
            }
            },
            release() {
            releases += 1;
            },
          }),
      }),
    );

    assert.equal(result.verdict, "HOLD", JSON.stringify(result));
    assert.deepEqual(result.blockers, [
      "source_wal_request_expired",
      "source_wal_hold_evidence_pending",
      "source_wal_lease_release_failed",
    ]);
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(renewals, 1);
    assert.equal(releases, 0);
    assert.equal(checkpointCalls, 0, "checkpoint maintenance must not start");
    assert.equal(
      fs.existsSync(
        path.join(
          operationDirectory(v),
          "noncanonical-lease-protected-validation",
        ),
      ),
      false,
    );
  } finally {
    Database.prototype.prepare = originalPrepare;
  }
});

test("lease loss after a successful quiescence inspection stops before checkpoint maintenance", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  let renewals = 0;
  let releases = 0;
  let compositions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "lease-loss-after-successful-inspection",
      confirmation_id: "lease-loss-after-successful-inspection",
    }),
    deps({
      inspectQuiescence: async () => {
        inspections += 1;
        return deps().inspectQuiescence();
      },
      acquireLease: (options) =>
        exactWalLeaseWith(options, {
          renew() {
          renewals += 1;
          return renewals === 2 ? false : undefined;
          },
          release() {
          releases += 1;
          },
        }),
      composeCutoverBackupEvidence: async (options) => {
        compositions += 1;
        return composeCutoverBackupEvidence(options);
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_lease_lost"]);
  assert.ok(inspections >= 8, String(inspections));
  assert.equal(renewals, 2);
  assert.equal(releases, 1);
  assert.equal(compositions, 0);
  assert.equal(
    fs.existsSync(
      path.join(
        operationDirectory(v),
        "noncanonical-lease-protected-validation",
      ),
    ),
    false,
  );
});

test("lease loss after a transient quiescence wait stops before another inspection", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  let renewals = 0;
  let releases = 0;
  let waits = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "lease-loss-after-quiescence-wait",
      confirmation_id: "lease-loss-after-quiescence-wait",
    }),
    deps({
      inspectQuiescence: async () => {
        inspections += 1;
        if (inspections !== 7) return deps().inspectQuiescence();
        return {
          available: false,
          probe_attestations: {
            listeners: false,
            processes: false,
            scheduled_tasks: false,
          },
        };
      },
      waitForQuiescenceRetry: async () => {
        waits += 1;
      },
      acquireLease: (options) =>
        exactWalLeaseWith(options, {
          renew() {
          renewals += 1;
          return renewals === 3 ? false : undefined;
          },
          release() {
          releases += 1;
          },
        }),
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_lease_lost"]);
  assert.ok(inspections >= 8);
  assert.equal(waits, 1);
  assert.equal(renewals, 3);
  assert.equal(releases, 1);
});

test("expiry during final quiescence retains only noncanonical recovery artefacts", async (t) => {
  const v = fixture(t);
  let quiescenceClockMs = Date.parse(NOW);
  let inspectionsUntilExpiry = null;
  let canonical = [];
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "expiry-during-final-inspection",
      confirmation_id: "expiry-during-final-inspection",
    }),
    deps({
      quiescenceNow: () => new Date(quiescenceClockMs),
      inspectQuiescence: async () => {
        const observed = await deps().inspectQuiescence();
        if (inspectionsUntilExpiry !== null) {
          inspectionsUntilExpiry -= 1;
        }
        if (inspectionsUntilExpiry === 0) {
          inspectionsUntilExpiry = null;
          quiescenceClockMs = Date.parse(EXPIRES);
        }
        return observed;
      },
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
        inspectionsUntilExpiry = 2;
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "source_wal_request_expired_before_commit",
    "source_wal_hold_evidence_pending",
    "source_wal_evidence_invalidation_failed",
  ]);
  assert.equal(result.status, "RECOVERY_REQUIRED");
  const directory = operationDirectory(v);
  for (const name of [
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(directory, name)), true, name);
  }
  assert.equal(
    fs.existsSync(path.join(directory, "backup-evidence.json")),
    false,
  );
  for (const artifactPath of canonical) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
  }
});

test("late unavailable quiescence retains noncanonical artefacts and exposes only safe diagnostics", async (t) => {
  const v = fixture(t);
  let lateUnavailable = false;
  let canonical = [];
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "late-unavailable-quiescence",
      confirmation_id: "late-unavailable-quiescence",
    }),
    deps({
      inspectQuiescence: async () => {
        if (!lateUnavailable) return deps().inspectQuiescence();
        return {
          available: false,
          probe_attestations: {
            listeners: false,
            processes: false,
            scheduled_tasks: false,
          },
          diagnostics: {
            probe: "processes",
            kind: "AMBIGUOUS",
            pids: [7801],
            task_identities: [],
            reasons: [
              "OPAQUE_ENCODED_POWERSHELL_HOST",
              "UNSAFE_REASON_SECRET",
            ],
            command_line: "OPAQUE_PAYLOAD_SECRET",
            error: "PROBE_ERROR_SECRET",
          },
        };
      },
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
        lateUnavailable = true;
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "source_wal_quiescence_unavailable",
    "source_wal_hold_evidence_pending",
    "source_wal_evidence_invalidation_failed",
  ]);
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.deepEqual(result.quiescence_diagnostics, {
    probe: "processes",
    kind: "AMBIGUOUS",
    pids: [7801],
    task_identities: [],
    reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
  });
  const serialised = JSON.stringify(result);
  for (const secret of [
    "UNSAFE_REASON_SECRET",
    "OPAQUE_PAYLOAD_SECRET",
    "PROBE_ERROR_SECRET",
    "command_line",
    "error",
  ]) {
    assert.equal(serialised.includes(secret), false, secret);
  }
  const directory = operationDirectory(v);
  for (const name of [
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(directory, name)), true, name);
  }
  assert.equal(
    fs.existsSync(path.join(directory, "backup-evidence.json")),
    false,
  );
  for (const artifactPath of canonical) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
  }
});

test("a late activation receipt retains only noncanonical recovery artefacts", async (t) => {
  const v = fixture(t);
  let injectReceipt = false;
  let canonical = [];
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "late-activation-receipt",
      confirmation_id: "late-activation-receipt",
    }),
    deps({
      inspectQuiescence: async () => {
        const observed = await deps().inspectQuiescence();
        if (injectReceipt) {
          injectReceipt = false;
          fs.writeFileSync(v.receiptPath, "active");
        }
        return observed;
      },
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
        injectReceipt = true;
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "source_wal_activation_receipt_present",
    "source_wal_hold_evidence_pending",
    "source_wal_evidence_invalidation_failed",
  ]);
  assert.equal(result.status, "RECOVERY_REQUIRED");
  const directory = operationDirectory(v);
  for (const name of [
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(directory, name)), true, name);
  }
  assert.equal(
    fs.existsSync(path.join(directory, "backup-evidence.json")),
    false,
  );
  for (const artifactPath of canonical) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
  }
});

test("quiescence retries share one four-wait budget across the operation", async (t) => {
  const v = fixture(t);
  let clockMs = Date.parse(NOW);
  let inspections = 0;
  let unavailableInspections = 0;
  const waits = [];
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "operation-wide-wait-budget",
      confirmation_id: "operation-wide-wait-budget",
    }),
    deps({
      quiescenceNow: () => new Date(clockMs),
      waitForQuiescenceRetry: async ({ delay_ms }) => {
        waits.push(delay_ms);
        clockMs += delay_ms;
      },
      inspectQuiescence: async () => {
        inspections += 1;
        if (inspections === 3) return deps().inspectQuiescence();
        unavailableInspections += 1;
        return {
          available: false,
          probe_attestations: {
            listeners: false,
            processes: false,
            scheduled_tasks: false,
          },
          diagnostics: {
            probe: "processes",
            kind: "AMBIGUOUS",
            pids: [7702],
            task_identities: [],
            reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
          },
        };
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, ["source_wal_quiescence_unavailable"]);
  assert.deepEqual(waits, [5000, 5000, 5000, 5000]);
  assert.equal(inspections, 6);
  assert.equal(unavailableInspections, 5);
});

test("quiescence retry never sleeps across the exact request expiry", async (t) => {
  const v = fixture(t);
  const generatedMs = Date.parse(NOW);
  let waits = 0;
  let inspections = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "quiescence-expiry-boundary",
      confirmation_id: "quiescence-expiry-boundary",
      expires_at: new Date(generatedMs + 4_000).toISOString(),
    }),
    deps({
      quiescenceNow: () => new Date(generatedMs),
      waitForQuiescenceRetry: async () => {
        waits += 1;
      },
      inspectQuiescence: async () => {
        inspections += 1;
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

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, ["source_wal_quiescence_unavailable"]);
  assert.equal(inspections, 1);
  assert.equal(waits, 0);
});

test("transient unavailable quiescence probes are retried without weakening a real hold", async (t) => {
  const transient = fixture(t);
  const transientStartedAt = Date.parse(NOW);
  let transientClockMs = transientStartedAt;
  const transientWaits = [];
  let transientChecks = 0;
  let transientUnavailableChecks = 0;
  const recovered = await cleanCloseGovernedSourceWal(
    request(transient),
    deps({
      quiescenceNow: () => new Date(transientClockMs),
      waitForQuiescenceRetry: async ({ delay_ms }) => {
        transientWaits.push(delay_ms);
        transientClockMs += delay_ms;
      },
      inspectQuiescence: async () => {
        transientChecks += 1;
        if (transientClockMs - transientStartedAt < 17_000) {
          transientUnavailableChecks += 1;
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
  assert.deepEqual(transientWaits, [5000, 5000, 5000, 5000]);
  assert.equal(transientUnavailableChecks, 4);
  assert.ok(transientChecks >= 5);
  assert.equal(recovered.quiescence_diagnostics, null);
  assert.equal(
    JSON.parse(fs.readFileSync(recovered.evidence_json, "utf8"))
      .quiescence_diagnostics,
    null,
  );

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
  assert.equal(held.evidence_json, undefined);
  assert.deepEqual(held.quiescence_diagnostics, {
    probe: "aggregate",
    kind: "OCCUPIED",
    pids: [4242],
    task_identities: [],
    reasons: ["OWNER_PIDS_PRESENT"],
  });

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
          diagnostics: {
            probe: "processes",
            kind: "AMBIGUOUS",
            pids: [77, 0, -3, "88"],
            task_identities: [
              "PulseGaming-LiveGuarded-YouTube-Runtime",
              "TASK_IDENTITY_SECRET\nleak",
              "AWS_SECRET_ACCESS_KEY_ABC",
            ],
            reasons: [
              "OPAQUE_ENCODED_POWERSHELL_HOST",
              "ARBITRARY_SECRET_REASON",
            ],
            command_line: "PROCESS_COMMAND_SECRET",
            error: "PROBE_ERROR_SECRET",
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
  assert.equal(unavailableChecks, 5);
  assert.equal(unavailableLeaseAcquires, 0);
  assert.equal(sha(unavailable.databasePath), unavailableSha);
  assert.equal(unavailableResult.evidence_json, undefined);
  assert.deepEqual(unavailableResult.quiescence_diagnostics, {
    probe: "processes",
    kind: "AMBIGUOUS",
    pids: [77],
    task_identities: ["PulseGaming-LiveGuarded-YouTube-Runtime"],
    reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
  });
  const unavailableSerialised = JSON.stringify(unavailableResult);
  for (const secret of [
    "TASK_IDENTITY_SECRET",
    "AWS_SECRET_ACCESS_KEY_ABC",
    "ARBITRARY_SECRET_REASON",
    "PROCESS_COMMAND_SECRET",
    "PROBE_ERROR_SECRET",
    "command_line",
    "error",
  ]) {
    assert.equal(unavailableSerialised.includes(secret), false);
  }

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
  let receiptRaceClockMs = Date.parse(NOW);
  const receiptRaceWaits = [];
  const receiptRaceResult = await cleanCloseGovernedSourceWal(
    request(receiptRace, {
      change_id: "retry-receipt-race",
      confirmation_id: "retry-receipt-race",
    }),
    deps({
      quiescenceNow: () => new Date(receiptRaceClockMs),
      waitForQuiescenceRetry: async ({ delay_ms }) => {
        receiptRaceWaits.push(delay_ms);
        receiptRaceClockMs += delay_ms;
        fs.writeFileSync(receiptRace.receiptPath, "active");
      },
      inspectQuiescence: async () => {
        receiptRaceChecks += 1;
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
  assert.deepEqual(receiptRaceWaits, [5000]);
});

test("a same-inode database write during a quiescence retry cannot become the maintenance baseline", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v, {
    change_id: "quiescence-database-drift",
    confirmation_id: "quiescence-database-drift",
  });
  const before = fs.statSync(v.databasePath, { bigint: true });
  let checks = 0;
  let mutated = false;

  const result = await cleanCloseGovernedSourceWal(
    exactRequest,
    deps({
      inspectQuiescence: async () => {
        checks += 1;
        if (checks === 1) {
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
      waitForQuiescenceRetry: async () => {
        const writer = new Database(v.databasePath);
        writer
          .prepare("INSERT INTO proof_rows(value) VALUES (?)")
          .run("quiescence-retry-drift");
        writer.pragma("wal_checkpoint(TRUNCATE)");
        writer.close();
        mutated = true;
      },
    }),
  );

  const after = fs.statSync(v.databasePath, { bigint: true });
  assert.equal(mutated, true);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.notEqual(sha(v.databasePath), exactRequest.expected_database_sha256);
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "source_wal_database_changed_during_quiescence",
  ]);
});

test("runtime profile drift during a quiescence retry is re-inspected before maintenance", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v, {
    change_id: "quiescence-profile-drift",
    confirmation_id: "quiescence-profile-drift",
  });
  let checks = 0;

  const result = await cleanCloseGovernedSourceWal(
    exactRequest,
    deps({
      inspectQuiescence: async () => {
        checks += 1;
        if (checks === 1) {
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
      waitForQuiescenceRetry: async () => {
        const changed = JSON.parse(fs.readFileSync(v.profilePath, "utf8"));
        changed.environment = { MUTATED_DURING_QUIESCENCE: "true" };
        fs.writeFileSync(v.profilePath, JSON.stringify(changed));
      },
    }),
  );

  assert.notEqual(
    sha(v.profilePath),
    exactRequest.expected_runtime_profile_file_sha256,
  );
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "source_wal_runtime_profile_changed_during_quiescence",
  ]);
});

test("executor drift during a quiescence retry is re-inspected before maintenance", async (t) => {
  const v = fixture(t);
  let checks = 0;
  let executorCommit = COMMIT;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "quiescence-executor-drift",
      confirmation_id: "quiescence-executor-drift",
    }),
    deps({
      inspectExecutor: () => ({ commit: executorCommit, status: "" }),
      inspectQuiescence: async () => {
        checks += 1;
        if (checks === 1) {
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
      waitForQuiescenceRetry: async () => {
        executorCommit = "d".repeat(40);
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_executor_not_clean"]);
});

test("WAL maintenance consumes fail-closed reconciled task evidence", async (t) => {
  const secret = "AWS_SECRET_ACCESS_KEY_WAL_TASK_STATE";
  const benignTaskStates = Array.from({ length: 16 }, (_, index) => ({
    task_name: `Custom-Pulse-Benign-${index}`,
    task_path: `\\Hidden\\Custom-Pulse-Benign-${index}`,
    state: "Ready",
    enabled: false,
  }));
  const cases = [
    {
      label: "missing task-state attestation",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        delete base.task_states;
        return base;
      },
    },
    {
      label: "non-array absence evidence",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        base.absent_task_names = secret;
        return base;
      },
    },
    {
      label: "oversized task-state evidence",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        base.task_states = [
          ...benignTaskStates,
          {
            task_name: secret,
            task_path: `\\Hidden\\${secret}`,
            state: "Running",
            enabled: true,
          },
        ];
        return base;
      },
    },
    {
      label: "enabled state omitted from summary",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        base.task_states = [
          {
            task_name: secret,
            task_path: `\\Hidden\\${secret}`,
            state: "Ready",
            enabled: true,
          },
        ];
        return base;
      },
    },
    {
      label: "running state omitted from summary",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        base.task_states = [
          {
            task_name: secret,
            task_path: `\\Hidden\\${secret}`,
            state: "Running",
            enabled: false,
          },
        ];
        return base;
      },
    },
    {
      label: "present exact task falsely claimed absent",
      blocker: "source_wal_not_quiescent",
      observation(base) {
        base.task_states = [
          {
            task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
            task_path: "PulseGaming-LiveGuarded-YouTube-Runtime",
            state: "Ready",
            enabled: false,
          },
        ];
        return base;
      },
    },
    {
      label: "non-null ambiguity contradicts quiescent summaries",
      blocker: "source_wal_quiescence_unavailable",
      observation(base) {
        base.diagnostics = {
          probe: "processes",
          kind: "AMBIGUOUS",
          pids: [999],
          task_identities: [secret],
          reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
        };
        return base;
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async (t) => {
      const values = fixture(t);
      const databaseSha256 = sha(values.databasePath);
      let leaseAcquires = 0;
      const baseDependencies = deps();
      const result = await cleanCloseGovernedSourceWal(
        request(values, {
          change_id: `task-evidence-${entry.label}`,
          confirmation_id: `task-evidence-${entry.label}`,
        }),
        deps({
          inspectQuiescence: async () =>
            entry.observation(await baseDependencies.inspectQuiescence()),
          acquireLease: () => {
            leaseAcquires += 1;
            throw new Error("maintenance_must_not_begin");
          },
        }),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.deepEqual(result.blockers, [entry.blocker]);
      assert.equal(leaseAcquires, 0);
      assert.equal(sha(values.databasePath), databaseSha256);
      assert.equal(JSON.stringify(result).includes(secret), false);
    });
  }
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
    JSON.stringify(out),
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
  assert.ok(
    result.blockers.includes("source_wal_database_identity_drift"),
    JSON.stringify(result),
  );
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
  let acquired = false,
    failNextInspection = true,
    releases = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      inspectQuiescence: async () => {
        const base = await deps().inspectQuiescence();
        if (acquired && failNextInspection) {
          failNextInspection = false;
          return { ...base, owner_pids: [42] };
        }
        return base;
      },
      acquireLease: (options) => {
        const lease = exactWalLeaseWith(options, {
          release() {
            releases += 1;
            return false;
          },
        });
        acquired = true;
        return lease;
      },
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

test("the fenced request window permits twenty-five-minute real-database proofs but no longer", async (t) => {
  const accepted = fixture(t);
  const generated = new Date(Date.now() - 1000);
  const acceptedResult = await cleanCloseGovernedSourceWal(
    request(accepted, {
      generated_at: generated.toISOString(),
      expires_at: new Date(
        generated.getTime() + 25 * 60 * 1000,
      ).toISOString(),
    }),
    deps({
      now: () => generated,
      quiescenceNow: () => generated,
      completionNow: () => new Date(),
    }),
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
        generated.getTime() + 25 * 60 * 1000 + 1,
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
    lateStartBase = new Date(Date.parse(NOW) + 60 * 1000),
    operationClock = new Date(lateStartBase),
    generated = new Date(operationClock.getTime() - 60_000),
    quiescenceClock = new Date(operationClock.getTime() + 1_000),
    completionClock = new Date(operationClock.getTime() + 2_000),
    expires = new Date(operationClock.getTime() + 5 * 60_000);
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      generated_at: generated.toISOString(),
      expires_at: expires.toISOString(),
    }),
    deps({
      now: () => operationClock,
      quiescenceNow: () => quiescenceClock,
      completionNow: () => completionClock,
    }),
  );
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  const evidence = JSON.parse(
    fs.readFileSync(result.backup_evidence_json, "utf8"),
  );
  assert.ok(
    Date.parse(evidence.verified_at) > Date.parse(generated.toISOString()),
  );
});

test("a backwards quiescence clock remains a fail-closed lease HOLD", async (t) => {
  const v = fixture(t),
    testBase = new Date(Date.parse(NOW) + 60 * 1000),
    generated = new Date(testBase.getTime() - 60_000),
    backwardsQuiescenceClock = new Date(testBase.getTime() - 1_000),
    completionClock = new Date(testBase.getTime() + 2_000),
    expires = new Date(testBase.getTime() + 5 * 60_000);
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      generated_at: generated.toISOString(),
      expires_at: expires.toISOString(),
      change_id: "backwards-quiescence-clock",
      confirmation_id: "backwards-quiescence-clock",
    }),
    deps({
      now: () => testBase,
      quiescenceNow: () => backwardsQuiescenceClock,
      completionNow: () => completionClock,
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(result.blockers.includes("source_wal_lease_lost"));
  assert.equal(result.backup_evidence_json, undefined);
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
  let acquired = false,
    failNextInspection = true,
    releases = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      inspectQuiescence: async () => {
        const base = await deps().inspectQuiescence();
        if (acquired && failNextInspection) {
          failNextInspection = false;
          return { ...base, owner_pids: [77] };
        }
        return base;
      },
      acquireLease: (options) => {
        const lease = exactWalLeaseWith(options, {
          release() {
            releases += 1;
          },
        });
        acquired = true;
        return lease;
      },
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

test("replay rejects a PASS body with non-null quiescence diagnostics even when its component hash is rebound", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));
  const canonical = canonicalPaths(first);

  const body = JSON.parse(fs.readFileSync(first.evidence_json, "utf8"));
  body.quiescence_diagnostics = {
    probe: "scheduled_tasks",
    kind: "OCCUPIED",
    task_identities: ["AWS_SECRET_ACCESS_KEY_REPLAY"],
    reasons: ["ENABLED_TASKS_PRESENT"],
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
  assert.ok(replay.blockers.includes("source_wal_evidence_commit_invalid"));
  assert.equal(JSON.stringify(replay).includes("AWS_SECRET_ACCESS_KEY_REPLAY"), false);
  for (const artifactPath of canonical) {
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

test("an exit-88 child crash remains noncanonical without authority to mutate after activation returns", async (t) => {
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
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(directory, name)), true, name);
  }
  assert.equal(fs.existsSync(backupEvidencePath), false);
  for (const artifactPath of discoveredCanonical) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
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

test("forged protected replay paths cannot delete an external SQLite sidecar", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));

  const outsideDirectory = path.join(v.root, "operator-owned-sqlite");
  fs.mkdirSync(outsideDirectory);
  const outsideBackup = path.join(outsideDirectory, "protected.db");
  const outsideVerification = path.join(
    outsideDirectory,
    "protected.verification.json",
  );
  const outsideRestore = path.join(outsideDirectory, "restore.db");
  const outsideRestoreEvidence = path.join(
    outsideDirectory,
    "restore.rehearsal.json",
  );
  fs.copyFileSync(
    first.protected_validation.backup_identity.path,
    outsideBackup,
  );
  fs.copyFileSync(outsideBackup, outsideRestore);

  const verification = JSON.parse(
    fs.readFileSync(
      first.protected_validation.backup_verification_identity.path,
      "utf8",
    ),
  );
  verification.backupPath = outsideBackup;
  verification.evidencePath = outsideVerification;
  verification.sha256 = sha(outsideBackup);
  verification.sizeBytes = fs.statSync(outsideBackup).size;
  fs.writeFileSync(outsideVerification, `${JSON.stringify(verification)}\n`);

  const restoreEvidence = JSON.parse(
    fs.readFileSync(
      first.protected_validation.restore_evidence_identity.path,
      "utf8",
    ),
  );
  restoreEvidence.source_backup = outsideBackup;
  restoreEvidence.restored_copy = outsideRestore;
  restoreEvidence.source_sha256 = sha(outsideBackup);
  restoreEvidence.restored_sha256 = sha(outsideRestore);
  fs.writeFileSync(
    outsideRestoreEvidence,
    `${JSON.stringify(restoreEvidence)}\n`,
  );

  const outsideShm = `${outsideBackup}-shm`;
  fs.writeFileSync(outsideShm, "operator-owned-sidecar");

  const body = JSON.parse(fs.readFileSync(first.evidence_json, "utf8"));
  Object.assign(body.protected_validation, {
    backup_identity: fileEvidence(outsideBackup),
    backup_path: outsideBackup,
    backup_sha256: sha(outsideBackup),
    backup_verification_identity: fileEvidence(outsideVerification),
    backup_verification_path: outsideVerification,
    backup_verification_sha256: sha(outsideVerification),
    restore_identity: fileEvidence(outsideRestore),
    restore_path: outsideRestore,
    restore_sha256: sha(outsideRestore),
    restore_evidence_identity: fileEvidence(outsideRestoreEvidence),
    restore_evidence_path: outsideRestoreEvidence,
    restore_evidence_sha256: sha(outsideRestoreEvidence),
  });
  fs.writeFileSync(first.evidence_json, `${JSON.stringify(body, null, 2)}\n`);

  const commit = JSON.parse(fs.readFileSync(first.evidence_commit, "utf8"));
  Object.assign(commit, {
    json_sha256: sha(first.evidence_json),
    protected_backup_sha256: sha(outsideBackup),
    protected_backup_verification_sha256: sha(outsideVerification),
    protected_restore_sha256: sha(outsideRestore),
    protected_restore_evidence_sha256: sha(outsideRestoreEvidence),
  });
  fs.writeFileSync(
    first.evidence_commit,
    `${JSON.stringify(commit, null, 2)}\n`,
  );

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.equal(
    fs.readFileSync(outsideShm, "utf8"),
    "operator-owned-sidecar",
  );
});

test("a self-consistent protected replay is rejected when its databases do not contain the transition lease", async (t) => {
  const v = fixture(t);
  const exactRequest = request(v);
  const first = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(first.verdict, "PASS", JSON.stringify(first));

  const protectedValidation = first.protected_validation;
  const canonicalArtifacts = first.canonical_artifacts;
  fs.copyFileSync(
    canonicalArtifacts.backup_identity.path,
    protectedValidation.backup_identity.path,
  );
  fs.copyFileSync(
    canonicalArtifacts.restore_identity.path,
    protectedValidation.restore_identity.path,
  );
  assert.equal(transitionLeaseCount(protectedValidation.backup_identity.path), 0);
  assert.equal(transitionLeaseCount(protectedValidation.restore_identity.path), 0);

  const protectedBackupIdentity = fileEvidence(
    protectedValidation.backup_identity.path,
  );
  const backupVerification = JSON.parse(
    fs.readFileSync(protectedValidation.backup_verification_identity.path, "utf8"),
  );
  Object.assign(backupVerification, {
    backupPath: protectedBackupIdentity.path,
    evidencePath: protectedValidation.backup_verification_identity.path,
    sha256: protectedBackupIdentity.sha256,
    sizeBytes: protectedBackupIdentity.size,
  });
  fs.writeFileSync(
    protectedValidation.backup_verification_identity.path,
    `${JSON.stringify(backupVerification)}\n`,
  );
  const protectedBackupVerificationIdentity = fileEvidence(
    protectedValidation.backup_verification_identity.path,
  );

  const protectedRestoreIdentity = fileEvidence(
    protectedValidation.restore_identity.path,
  );
  const restoreEvidence = JSON.parse(
    fs.readFileSync(protectedValidation.restore_evidence_identity.path, "utf8"),
  );
  Object.assign(restoreEvidence, {
    source_backup: protectedBackupIdentity.path,
    restored_copy: protectedRestoreIdentity.path,
    source_sha256: protectedBackupIdentity.sha256,
    restored_sha256: protectedRestoreIdentity.sha256,
  });
  fs.writeFileSync(
    protectedValidation.restore_evidence_identity.path,
    `${JSON.stringify(restoreEvidence)}\n`,
  );
  const protectedRestoreEvidenceIdentity = fileEvidence(
    protectedValidation.restore_evidence_identity.path,
  );

  const classification = JSON.parse(
    fs.readFileSync(protectedValidation.classification_identity.path, "utf8"),
  );
  Object.assign(classification, {
    protected_by_standard_transition_lease: true,
    backup_identity: protectedBackupIdentity,
    backup_path: protectedBackupIdentity.path,
    backup_sha256: protectedBackupIdentity.sha256,
    backup_verification_identity: protectedBackupVerificationIdentity,
    backup_verification_path: protectedBackupVerificationIdentity.path,
    backup_verification_sha256: protectedBackupVerificationIdentity.sha256,
    backup_transition_lease_rows: 1,
    restore_identity: protectedRestoreIdentity,
    restore_path: protectedRestoreIdentity.path,
    restore_sha256: protectedRestoreIdentity.sha256,
    restore_evidence_identity: protectedRestoreEvidenceIdentity,
    restore_evidence_path: protectedRestoreEvidenceIdentity.path,
    restore_evidence_sha256: protectedRestoreEvidenceIdentity.sha256,
    restore_transition_lease_rows: 1,
  });
  fs.writeFileSync(
    protectedValidation.classification_identity.path,
    `${JSON.stringify(classification, null, 2)}\n`,
  );
  const classificationIdentity = fileEvidence(
    protectedValidation.classification_identity.path,
  );

  const body = JSON.parse(fs.readFileSync(first.evidence_json, "utf8"));
  body.protected_validation = {
    ...classification,
    classification_identity: classificationIdentity,
    classification_path: classificationIdentity.path,
    classification_sha256: classificationIdentity.sha256,
  };
  fs.writeFileSync(first.evidence_json, `${JSON.stringify(body, null, 2)}\n`);

  const commit = JSON.parse(fs.readFileSync(first.evidence_commit, "utf8"));
  Object.assign(commit, {
    json_sha256: sha(first.evidence_json),
    protected_validation_classification_sha256:
      classificationIdentity.sha256,
    protected_backup_sha256: protectedBackupIdentity.sha256,
    protected_backup_verification_sha256:
      protectedBackupVerificationIdentity.sha256,
    protected_restore_sha256: protectedRestoreIdentity.sha256,
    protected_restore_evidence_sha256:
      protectedRestoreEvidenceIdentity.sha256,
  });
  fs.writeFileSync(
    first.evidence_commit,
    `${JSON.stringify(commit, null, 2)}\n`,
  );

  const replay = await cleanCloseGovernedSourceWal(exactRequest, deps());
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.ok(
    replay.blockers.includes("source_wal_protected_backup_lease_invalid") ||
      replay.blockers.includes("source_wal_protected_restore_lease_invalid"),
    JSON.stringify(replay.blockers),
  );
});

test("replay source hardlink holds before mutating committed canonical authority", async (t) => {
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
  assert.equal(fs.existsSync(first.evidence_commit), true);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
  }
});

test("replay unsafe WAL sidecar holds before mutating committed canonical authority", async (t) => {
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
  assert.equal(fs.existsSync(first.evidence_commit), true);
  for (const artifactPath of canonicalPaths) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
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

const retainedFinalComponentsAtProfileDrift = Object.freeze({
  afterBackupEvidenceCompose: [],
  beforeBackupEvidenceWrite: [],
  beforeJsonEvidenceWrite: [],
  beforeMarkdownEvidenceWrite: ["clean-close.json"],
  beforeCommitWrite: ["clean-close.json", "clean-close.md"],
  afterFinalCommit: [
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ],
});

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

for (const boundary of [
  "afterBackupEvidenceCompose",
  "beforeBackupEvidenceWrite",
  "beforeJsonEvidenceWrite",
  "beforeMarkdownEvidenceWrite",
  "beforeCommitWrite",
  "afterFinalCommit",
]) {
  test(`runtime-profile drift at ${boundary} holds without mutating recovery artefacts`, async (t) => {
    const v = fixture(t);
    const exactRequest = request(v, {
      change_id: `late-profile-${boundary}`,
      confirmation_id: `late-profile-${boundary}`,
    });
    const result = await cleanCloseGovernedSourceWal(
      exactRequest,
      deps({
        [boundary]: async () => {
          const changed = JSON.parse(fs.readFileSync(v.profilePath, "utf8"));
          changed.environment = { LATE_FINALISATION_DRIFT: boundary };
          fs.writeFileSync(v.profilePath, `${JSON.stringify(changed)}\n`);
        },
      }),
    );

    assert.equal(
      result.verdict,
      "HOLD",
      `${boundary}:${JSON.stringify(result)}`,
    );
    assert.ok(
      result.blockers.includes(
        "source_wal_runtime_profile_changed_during_finalisation",
      ),
      `${boundary}:${JSON.stringify(result.blockers)}`,
    );
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.ok(result.blockers.includes("source_wal_hold_evidence_pending"));
    assert.ok(
      result.blockers.includes("source_wal_evidence_invalidation_failed"),
    );
    const evidenceDirectory = operationDirectory(v);
    for (const canonicalName of [
      "backup-evidence.json",
      "clean-close.json",
      "clean-close.md",
      "clean-close.commit.json",
    ]) {
      assert.equal(
        fs.existsSync(path.join(evidenceDirectory, canonicalName)),
        retainedFinalComponentsAtProfileDrift[boundary].includes(canonicalName),
        `${boundary}:${canonicalName}`,
      );
    }
    const retainedCanonical = fs.readdirSync(
      path.join(evidenceDirectory, "backup"),
    );
    assert.ok(retainedCanonical.length >= 4, boundary);
  });
}

test("executor checkout drift after backup-evidence composition holds without mutating recovery artefacts", async (t) => {
  const v = fixture(t);
  let dirty = false;
  let inspections = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "late-executor-drift",
      confirmation_id: "late-executor-drift",
    }),
    deps({
      inspectExecutor: () => {
        inspections += 1;
        return { commit: COMMIT, status: dirty ? " M tracked.js" : "" };
      },
      afterBackupEvidenceCompose: async () => {
        dirty = true;
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(result.blockers.includes("source_wal_executor_not_clean"));
  assert.ok(inspections > 2, String(inspections));
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.ok(result.blockers.includes("source_wal_hold_evidence_pending"));
  assert.ok(result.blockers.includes("source_wal_evidence_invalidation_failed"));
  const evidenceDirectory = operationDirectory(v);
  assert.equal(
    fs.existsSync(path.join(evidenceDirectory, "backup-evidence.json")),
    false,
  );
  assert.ok(
    fs.readdirSync(path.join(evidenceDirectory, "backup")).length >= 4,
  );
});

test("an output-directory junction swap during final-marker installation cannot redirect canonical authority", async (t) => {
  const v = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-wal-final-output-outside-"),
  );
  let operationDirectory = null;
  let parkedDirectory = null;
  let swapped = false;
  const originalWriteFile = fs.promises.writeFile;
  fs.promises.writeFile = async (file, ...args) => {
    if (
      !swapped &&
      path.basename(String(file)).startsWith("backup-evidence.json.") &&
      path.basename(String(file)).endsWith(".tmp")
    ) {
      operationDirectory = path.dirname(String(file));
      parkedDirectory = `${operationDirectory}.parked`;
      fs.renameSync(operationDirectory, parkedDirectory);
      fs.symlinkSync(
        outside,
        operationDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
      swapped = true;
    }
    return originalWriteFile.call(fs.promises, file, ...args);
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
    if (operationDirectory) {
      try {
        fs.rmSync(operationDirectory, { force: true });
      } catch {}
    }
    if (parkedDirectory && fs.existsSync(parkedDirectory)) {
      try {
        fs.renameSync(parkedDirectory, operationDirectory);
      } catch {}
    }
    fs.rmSync(outside, { recursive: true, force: true, maxRetries: 3 });
  });

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "late-output-junction-swap",
      confirmation_id: "late-output-junction-swap",
    }),
    deps(),
  );

  assert.equal(swapped, true);
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes(
      "source_wal_evidence_output_changed_during_finalisation",
    ),
    JSON.stringify(result.blockers),
  );
  for (const canonicalName of [
    "backup-evidence.json",
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(fs.existsSync(path.join(outside, canonicalName)), false);
  }
});

test("canonical artefact drift during final-marker staging is rebound immediately before install", async (t) => {
  const v = fixture(t);
  let canonicalBackupPath = null;
  let tampered = false;
  const originalWriteFile = fs.promises.writeFile;
  fs.promises.writeFile = async (file, ...args) => {
    const written = await originalWriteFile.call(fs.promises, file, ...args);
    if (
      !tampered &&
      canonicalBackupPath &&
      path.basename(String(file)).startsWith("backup-evidence.json.") &&
      path.basename(String(file)).endsWith(".tmp")
    ) {
      fs.appendFileSync(canonicalBackupPath, "tampered-during-final-staging");
      tampered = true;
    }
    return written;
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
  });

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "final-staging-canonical-drift",
      confirmation_id: "final-staging-canonical-drift",
    }),
    deps({
      composeCutoverBackupEvidence: async (options) => {
        const composed = await composeCutoverBackupEvidence(options);
        canonicalBackupPath = composed.evidence?.backup_path || null;
        return composed;
      },
    }),
  );

  assert.equal(tampered, true);
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("source_wal_canonical_backup_invalid"),
    JSON.stringify(result.blockers),
  );
  assert.equal(
    fs.existsSync(path.join(operationDirectory(v), "backup-evidence.json")),
    false,
  );
  assert.equal(fs.existsSync(canonicalBackupPath), false);
});

test("final evidence drift during final-marker staging is rebound immediately before install", async (t) => {
  const v = fixture(t);
  let tampered = false;
  const originalWriteFile = fs.promises.writeFile;
  fs.promises.writeFile = async (file, ...args) => {
    const written = await originalWriteFile.call(fs.promises, file, ...args);
    if (
      !tampered &&
      path.basename(String(file)).startsWith("backup-evidence.json.") &&
      path.basename(String(file)).endsWith(".tmp")
    ) {
      fs.appendFileSync(
        path.join(path.dirname(String(file)), "clean-close.json"),
        "tampered-during-final-staging",
      );
      tampered = true;
    }
    return written;
  };
  t.after(() => {
    fs.promises.writeFile = originalWriteFile;
  });

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "final-staging-evidence-drift",
      confirmation_id: "final-staging-evidence-drift",
    }),
    deps(),
  );

  assert.equal(tampered, true);
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("source_wal_final_evidence_component_invalid"),
    JSON.stringify(result.blockers),
  );
  for (const canonicalName of [
    "backup-evidence.json",
    "clean-close.json",
    "clean-close.md",
    "clean-close.commit.json",
  ]) {
    assert.equal(
      fs.existsSync(path.join(operationDirectory(v), canonicalName)),
      false,
      canonicalName,
    );
  }
});

test("the final completion marker install has no authority callback after its hard link", async (t) => {
  const v = fixture(t);
  let authorityLost = false;
  let postLossExecutorInspections = 0;
  const originalLinkSync = fs.linkSync;
  fs.linkSync = (existingPath, newPath) => {
    const linked = originalLinkSync.call(fs, existingPath, newPath);
    if (path.basename(String(newPath)) === "backup-evidence.json") {
      authorityLost = true;
    }
    return linked;
  };
  t.after(() => {
    fs.linkSync = originalLinkSync;
  });

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "authority-loss-after-final-link",
      confirmation_id: "authority-loss-after-final-link",
    }),
    deps({
      inspectExecutor: () => {
        if (authorityLost) postLossExecutorInspections += 1;
        return { commit: COMMIT, status: "" };
      },
    }),
  );

  assert.equal(authorityLost, true);
  assert.equal(result.verdict, "PASS", JSON.stringify(result));
  assert.equal(postLossExecutorInspections, 0);
  const marker = path.join(operationDirectory(v), "backup-evidence.json");
  assert.equal(fs.statSync(marker, { bigint: true }).nlink, 1n);
  assert.equal(fileEvidence(marker).sha256, result.final_completion_authority.sha256);
});

test("a foreign hard link created inside the final marker critical section cannot become canonical", async (t) => {
  const v = fixture(t);
  const foreignLink = path.join(v.root, "foreign-final-marker-link.json");
  let foreignLinkCreated = false;
  const originalLinkSync = fs.linkSync;
  fs.linkSync = (existingPath, newPath) => {
    const linked = originalLinkSync.call(fs, existingPath, newPath);
    if (path.basename(String(newPath)) === "backup-evidence.json") {
      originalLinkSync.call(fs, newPath, foreignLink);
      foreignLinkCreated = true;
    }
    return linked;
  };
  t.after(() => {
    fs.linkSync = originalLinkSync;
  });

  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "foreign-link-final-marker",
      confirmation_id: "foreign-link-final-marker",
    }),
    deps(),
  );

  assert.equal(foreignLinkCreated, true);
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("source_wal_final_marker_install_incomplete"),
    JSON.stringify(result.blockers),
  );
  assert.equal(
    fs.existsSync(path.join(operationDirectory(v), "backup-evidence.json")),
    false,
  );
  assert.equal(fs.statSync(foreignLink, { bigint: true }).nlink, 1n);
});

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
    acquireLease: (options) =>
      exactWalLeaseWith(options, {
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
  let protectedRestoreCompleted = false;
  const result = await cleanCloseGovernedSourceWal(
    request(v),
    deps({
      acquireLease: (options) =>
        exactWalLeaseWith(options, {
          renew() {
          renewals += 1;
          if (protectedRestoreCompleted) throw new Error("injected lease loss");
          },
          release() {
          releases += 1;
          },
        }),
      composeCutoverBackupEvidence: async () => {
        compositions += 1;
        throw new Error("composer must not run");
      },
      rehearseSqliteRestore: async (options) => {
        const restored = await rehearseSqliteRestore(options);
        protectedRestoreCompleted = true;
        return restored;
      },
    }),
  );
  assert.ok(renewals >= 1);
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

test("bounded authority drift holds before the initial phase mutation", async (t) => {
  for (const [field, changed] of [
    ["authority_fingerprint", "1".repeat(64)],
    ["observation_sha256", "2".repeat(64)],
    ["database_snapshot_sha256", "3".repeat(64)],
  ]) {
    await t.test(field, async (t) => {
      const v = fixture(t);
      let inspections = 0;
      let leaseAcquisitions = 0;
      const result = await cleanCloseGovernedSourceWal(
        request(v, {
          change_id: `authority-drift-${field}`,
          confirmation_id: `authority-drift-${field}`,
        }),
        deps({
          inspectQuiescence: async () => {
            inspections += 1;
            const base = await deps().inspectQuiescence();
            return inspections === 1 ? base : { ...base, [field]: changed };
          },
          acquireLease: () => {
            leaseAcquisitions += 1;
            throw new Error("lease_must_not_be_acquired");
          },
        }),
      );
      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.deepEqual(result.blockers, [
        "source_wal_quiescence_authority_drift",
      ]);
      assert.equal(inspections, 2);
      assert.equal(leaseAcquisitions, 0);
      assert.equal(fs.existsSync(request(v).output_dir), false);
      const db = new Database(v.databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        assert.deepEqual(
          db.prepare("SELECT value FROM proof_rows ORDER BY id").all(),
          [{ value: "preserved" }],
        );
      } finally {
        db.close();
      }
    });
  }
});

test("a changed exact live database identity holds before output or lease mutation", async (t) => {
  const v = fixture(t);
  const admitted = inspectLiveDatabaseIdentity({
    databasePath: v.databasePath,
  });
  let identityInspections = 0;
  let leaseAcquisitions = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "database-identity-drift",
      confirmation_id: "database-identity-drift",
    }),
    deps({
      inspectDatabaseIdentity: () => {
        identityInspections += 1;
        return identityInspections === 1
          ? admitted
          : {
              ...admitted,
              database_identity_sha256: "4".repeat(64),
            };
      },
      acquireLease: () => {
        leaseAcquisitions += 1;
        throw new Error("lease_must_not_be_acquired");
      },
    }),
  );
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.deepEqual(result.blockers, ["source_wal_database_identity_drift"]);
  assert.equal(identityInspections, 2);
  assert.equal(leaseAcquisitions, 0);
  assert.equal(fs.existsSync(request(v).output_dir), false);
  assert.equal(zeroOrAbsentWal(v), true);
});

test("a transition lease without admitted authority context holds before checkpoint", async (t) => {
  const v = fixture(t);
  let renewals = 0;
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "missing-transition-context",
      confirmation_id: "missing-transition-context",
    }),
    deps({
      acquireLease: () => ({
        renew() {
          renewals += 1;
          return true;
        },
        release() {
          return true;
        },
      }),
    }),
  );
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(result.blockers.includes("source_wal_lease_lost"));
  assert.equal(renewals, 0);
  assert.equal(zeroOrAbsentWal(v), true);
  assert.equal(
    fs.existsSync(path.join(operationDirectory(v), "backup")),
    false,
  );
});

test("legacy and failed-probe reports hold before creating an operation directory", async (t) => {
  for (const [name, report] of [
    [
      "legacy",
      {
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
        diagnostics: null,
      },
    ],
    [
      "probe",
      {
        ...(await deps().inspectQuiescence()),
        probe_attestations: {
          listeners: true,
          processes: false,
          scheduled_tasks: true,
        },
        diagnostics: {
          probe: "processes",
          raw: "SUPER_SECRET_SENTINEL",
        },
      },
    ],
  ]) {
    await t.test(name, async (t) => {
      const v = fixture(t);
      const result = await cleanCloseGovernedSourceWal(
        request(v, {
          change_id: `invalid-report-${name}`,
          confirmation_id: `invalid-report-${name}`,
        }),
        deps({ inspectQuiescence: async () => report }),
      );
      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.deepEqual(result.blockers, ["source_wal_quiescence_unavailable"]);
      assert.equal(fs.existsSync(request(v).output_dir), false);
      assert.equal(JSON.stringify(result).includes("SUPER_SECRET_SENTINEL"), false);
    });
  }
});

test("a foreign transition after release holds before post-release maintenance", async (t) => {
  const v = fixture(t);
  const result = await cleanCloseGovernedSourceWal(
    request(v, {
      change_id: "foreign-transition-after-release",
      confirmation_id: "foreign-transition-after-release",
    }),
    deps({
      afterLeaseRelease: async () => {
        const db = new Database(v.databasePath);
        try {
          db.prepare(
            `INSERT INTO runtime_leases
             (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(
            LIVE_RUNTIME_TRANSITION_LEASE_NAME,
            "foreign-transition-owner",
            NOW,
            NOW,
            EXPIRES,
            "{}",
          );
        } finally {
          db.close();
        }
      },
    }),
  );
  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(result.blockers.includes("source_wal_transition_lease_present"));
  assert.equal(result.backup_evidence_json, undefined);
  assert.equal(
    fs.existsSync(path.join(operationDirectory(v), "backup-evidence.json")),
    false,
  );
});
