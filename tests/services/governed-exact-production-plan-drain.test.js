"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const { bind: bindJobs } = require("../../lib/repositories/jobs");
const {
  bind: bindRuntimeLeases,
} = require("../../lib/repositories/runtime_leases");
const { bind: bindWorkers } = require("../../lib/repositories/workers");
const {
  canonicalSha256,
  RUNTIME_POLICY_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  RECEIPT_SCHEMA_VERSION,
  canonicalSha256: canonicalReceiptSha256,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt");
const {
  indexGovernedAutonomousCandidateCompletionReceipt,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt-index");
const {
  CANDIDATE_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION: PLANNER_REQUEST_SCHEMA_VERSION,
  planGovernedAutonomousWindowProduction,
} = require("../../lib/services/governed-autonomous-window-production-planner");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  DRAIN_REQUEST_SCHEMA_VERSION,
  assertOpenedExactDatabaseIdentity,
  inspectExactDatabaseFile,
  drainExactGovernedProductionPlan,
  defaultCompletionReceiptInspector,
  inspectExactGovernedPlanQuarantineBindings,
  isCanonicalCodexPowerShellProcessIdentity,
  inspectWindowsPulseQuiescence,
} = require("../../lib/ops/governed-exact-production-plan-drain");
const {
  acquireLiveRuntimeTransitionLease,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");
const {
  profileFingerprint,
} = require("../../lib/stabilisation/windows-local-runtime-supervisor");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const EXPECTED_COMMIT = "a".repeat(40);

test("exact database identity rejects NTFS hard-link aliases", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-exact-database-identity-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const aliasPath = path.join(root, "pulse-alias.db");
  const db = new Database(databasePath);
  db.exec("CREATE TABLE identity_probe (id INTEGER PRIMARY KEY)");
  db.close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const identity = await inspectExactDatabaseFile(databasePath);
  assert.match(identity.identity.device, /^\d+$/);
  assert.match(identity.identity.inode, /^\d+$/);
  assert.equal(identity.identity.link_count, "1");
  assert.equal(
    identity.identity.key,
    `${identity.identity.device}:${identity.identity.inode}`,
  );

  fs.linkSync(databasePath, aliasPath);
  await assert.rejects(
    inspectExactDatabaseFile(databasePath),
    /exact_plan_database_hardlink_forbidden/,
  );
});

test("exact database identity preserves BigInt NTFS identifiers beyond Number precision", async () => {
  const databasePath = "D:\\pulse-data\\pulse.db";
  const device = 18_446_744_073_709_551_615n;
  const inode = 9_007_199_254_740_993n;
  const identity = await inspectExactDatabaseFile(databasePath, {
    async lstat(requestedPath, options) {
      assert.equal(requestedPath, databasePath);
      assert.deepEqual(options, { bigint: true });
      return {
        dev: device,
        ino: inode,
        nlink: 1n,
        size: 4096n,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
    },
    async realpath(requestedPath) {
      return requestedPath;
    },
  });

  assert.deepEqual(identity.identity, {
    device: device.toString(),
    inode: inode.toString(),
    key: `${device}:${inode}`,
    link_count: "1",
  });
});

test("opened better-sqlite3 main stays bound to its pre-open file identity", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-open-database-identity-"),
  );
  const databasePath = path.join(root, "pulse.db");
  let db = new Database(databasePath);
  db.exec("CREATE TABLE identity_probe (id INTEGER PRIMARY KEY)");
  db.close();
  const preopenFile = await inspectExactDatabaseFile(databasePath);
  db = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const opened = await assertOpenedExactDatabaseIdentity({
    db,
    databasePath,
    preopenFile,
  });

  assert.equal(opened.identity.key, preopenFile.identity.key);
  assert.equal(opened.identity.link_count, "1");
});

test("opened main rejects a different pre-open database identity", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-open-database-mismatch-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const otherPath = path.join(root, "other.db");
  let db = new Database(databasePath);
  db.exec("CREATE TABLE identity_probe (id INTEGER PRIMARY KEY)");
  db.close();
  const other = new Database(otherPath);
  other.exec("CREATE TABLE other_probe (id INTEGER PRIMARY KEY)");
  other.close();
  const wrongPreopenFile = await inspectExactDatabaseFile(otherPath);
  db = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await assert.rejects(
    assertOpenedExactDatabaseIdentity({
      db,
      databasePath,
      preopenFile: wrongPreopenFile,
    }),
    /exact_plan_open_database_identity_mismatch/,
  );
});

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex");
}

function safety() {
  return {
    local_proof_only: true,
    database_authority: false,
    database_mutated: false,
    network_authority: false,
    network_used: false,
    oauth_or_token_authority: false,
    oauth_or_tokens_mutated: false,
    platform_contacted: false,
    publish_authority: false,
    scheduler_authority: false,
    external_publish_authorised: false,
  };
}

function candidate(
  workspaceRoot,
  storyId,
  databaseStoryId,
  score,
  { timingEvidenceSha256 = null } = {},
) {
  const finalScript = `${storyId} is a confirmed official gaming update with one clear player consequence.`;
  const inventoryFileSha256 = sha256(`${storyId}:inventory`);
  const canonicalIdentityUrl = `https://news.xbox.com/en-us/2026/07/30/${storyId}/`;
  return {
    schema_version: CANDIDATE_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    source_type: "official",
    verification_status: "CONFIRMED",
    eligibility_verdict: "GREEN",
    source_evidence_sha256: sha256(`${storyId}:source`),
    source_published_at: "2026-07-30T07:00:00.000Z",
    verified_at: "2026-07-30T07:10:00.000Z",
    selection_score: score,
    locked_intake_binding: {
      story_id: storyId,
      locked_intake: {
        database_story_binding: createGovernedAutonomousDatabaseStoryBinding({
          canonical_story_id: storyId,
          database_story_id: databaseStoryId,
          canonical_identity_url: canonicalIdentityUrl,
          inventory_file_sha256: inventoryFileSha256,
          final_script_sha256: sha256(finalScript),
        }),
        inventory_path: path.join(
          workspaceRoot,
          "inventory",
          `${storyId}.json`,
        ),
        inventory_file_sha256: inventoryFileSha256,
        inventory_root: path.join(workspaceRoot, "inventory"),
        allowed_roots: [
          path.join(workspaceRoot, "inventory"),
          path.join(workspaceRoot, "candidate-source"),
        ],
        canonical_identity_url: canonicalIdentityUrl,
        final_script: finalScript,
        final_script_sha256: sha256(finalScript),
        script_claim_bindings: [
          { claim_key: `${storyId}:claim`, source_index: 0 },
        ],
        presentation_claim_bindings: [
          { claim_key: `${storyId}:claim`, scene_index: 0 },
        ],
        supplemental_official_sources: [],
        contract: { editorial_lane_id: "breaking_short" },
        freshness: { publish_by: "2026-07-30T12:00:00.000Z" },
        visual_brief: {
          format: "game_native_news",
          ...(timingEvidenceSha256
            ? {
                narration_timing_evidence_sha256: timingEvidenceSha256,
              }
            : {}),
        },
        experiment_dimensions: { eligible: false },
      },
    },
    creative_package: {
      scenes: [{ asset_id: `${storyId}:hero`, role: "hook_slam" }],
      title: `${storyId} Confirmed`,
      description: `${storyId} has been officially confirmed.`,
      official_source_url: canonicalIdentityUrl,
      required_attributions: ["Official source: Xbox Wire"],
      subject_terms: [storyId],
    },
    runtime_policy: {
      schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      generated_at: GENERATED_AT,
      workspace_root: workspaceRoot,
      candidate_source_root: path.join(
        workspaceRoot,
        "candidate-source",
        storyId,
      ),
      narration: {
        provider: "elevenlabs",
        voice_id: "pulse-approved",
        model_id: "eleven_multilingual_v2",
        speed: 1,
      },
      visual_qa: {
        reviewers: [
          {
            provider: "ollama",
            model: "gemma3:12b",
            endpoint_origin: "http://127.0.0.1:11434",
          },
          {
            provider: "ollama",
            model: "qwen2.5vl:7b",
            endpoint_origin: "http://127.0.0.1:11434",
          },
        ],
      },
      disclosure_policy: {
        policy_id: "pulse-youtube-synthetic-media",
        policy_version: "1",
      },
      safety: safety(),
    },
    candidate_revision_sha256: sha256(`${storyId}:revision`),
    request_fingerprint: sha256(`${storyId}:request`),
  };
}

async function fixture(t) {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-exact-plan-drain-"),
  );
  const databasePath = path.join(workspaceRoot, "pulse.db");
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE channels (id TEXT PRIMARY KEY);
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      approved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
    );
  `);
  db.exec(
    fs.readFileSync(
      path.resolve(__dirname, "..", "..", "db", "migrations", "004_jobs.sql"),
      "utf8",
    ),
  );
  db.exec(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "db",
        "migrations",
        "005_workers.sql",
      ),
      "utf8",
    ),
  );
  db.prepare("INSERT INTO channels (id) VALUES (?)").run("pulse-gaming");
  for (const storyId of ["db-primary", "db-standby", "db-extra"]) {
    db.prepare("INSERT INTO stories (id, approved) VALUES (?, 0)").run(storyId);
  }
  const jobs = bindJobs(db);
  const runtimeLeases = bindRuntimeLeases(db);
  const workers = bindWorkers(db);
  const planPath = path.join(workspaceRoot, "production-plan.json");
  const reservationPath = path.join(workspaceRoot, "reservation.json");
  const planned = await planGovernedAutonomousWindowProduction(
    {
      schema_version: PLANNER_REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      generated_at: GENERATED_AT,
      scheduled_for: SCHEDULED_FOR,
      workspace_root: workspaceRoot,
      reservation_output_path: reservationPath,
      plan_output_path: planPath,
      candidates: [
        candidate(workspaceRoot, "story-primary", "db-primary", 120),
        candidate(workspaceRoot, "story-standby", "db-standby", 110),
      ],
    },
    { jobs },
  );
  const profile = {
    schema_version: "fixture-runtime-profile-v1",
    profile_id: "fixture-profile",
    task_name: "PulseGaming-Fixture",
    conflicting_task_names: ["PulseGaming-Fixture-Legacy"],
    port: 3001,
    database_path: databasePath,
    state_root: path.join(workspaceRoot, "state"),
    activation_receipt_path: path.join(
      workspaceRoot,
      "state",
      "activation-receipt.json",
    ),
    environment: {},
  };
  const profilePath = path.join(workspaceRoot, "runtime-profile.json");
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  const outputDir = path.join(workspaceRoot, "drain-evidence");
  const planFileSha256 = sha256(fs.readFileSync(planPath));
  const profileFileSha256 = sha256(fs.readFileSync(profilePath));
  const databaseFileBinding = await inspectExactDatabaseFile(databasePath);
  const repos = { db, jobs, runtimeLeases, workers };
  t.after(() => {
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  return {
    workspaceRoot,
    databasePath,
    databaseFileBinding,
    db,
    jobs,
    runtimeLeases,
    repos,
    planPath,
    reservationPath,
    profilePath,
    outputDir,
    planned,
    planFileSha256,
    profileFileSha256,
  };
}

function request(values, overrides = {}) {
  return {
    schema_version: DRAIN_REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-30T20:00:00.000Z",
    plan_path: values.planPath,
    expected_plan_file_sha256: values.planFileSha256,
    expected_plan_sha256: values.planned.plan.plan_sha256,
    workspace_root: values.workspaceRoot,
    database_path: values.databasePath,
    runtime_profile_path: values.profilePath,
    expected_runtime_profile_file_sha256: values.profileFileSha256,
    expected_checkout_commit: EXPECTED_COMMIT,
    output_dir: values.outputDir,
    worker_id: "pulse-exact-plan-drain-test",
    timeout_ms: 5000,
    poll_interval_ms: 5,
    ...overrides,
  };
}

function quiescentInspection(overrides = {}) {
  return {
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
    absent_task_names: ["PulseGaming-Fixture", "PulseGaming-Fixture-Legacy"],
    ...overrides,
  };
}

function dependencies(values, productionHandler, overrides = {}) {
  return {
    db: values.db,
    databaseFileBinding: values.databaseFileBinding,
    repos: values.repos,
    productionHandler,
    runtimeProfileValidator: () => ({ valid: true, blockers: [] }),
    workspaceInspector: () => ({
      available: true,
      commit: EXPECTED_COMMIT,
      tracked_clean: true,
    }),
    quiescenceInspector: () => quiescentInspection(),
    completionReceiptInspector: async ({ attestation }) => ({
      valid: true,
      path: attestation.completion_receipt.path,
      file_sha256: attestation.completion_receipt.file_sha256,
      receipt_sha256: attestation.completion_receipt.receipt_sha256,
    }),
    ...overrides,
  };
}

function prepareQuarantineRows(values) {
  const [primary] = values.planned.plan.production_jobs;
  values.db
    .prepare(
      `UPDATE jobs
          SET status = 'failed', attempt_count = 3,
              claimed_by = NULL, claimed_at = NULL, lease_until = NULL
        WHERE id = ?`,
    )
    .run(primary.job_id);
  const insertRun = values.db.prepare(
    `INSERT INTO job_runs
       (job_id, worker_id, attempt, status, started_at, finished_at,
        duration_ms, error_message)
     VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)`,
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    insertRun.run(
      primary.job_id,
      `fixture-worker-${attempt}`,
      attempt,
      `2026-07-30 1${attempt}:00:00`,
      `2026-07-30 1${attempt}:00:01`,
      1000,
      `fixture_failure_${attempt}`,
    );
  }
}

function quarantineBindingRequest(values, overrides = {}) {
  const [primary, standby] = values.planned.plan.production_jobs;
  return {
    generated_at: "2026-07-30T20:00:00.000Z",
    plan_path: values.planPath,
    expected_plan_file_sha256: values.planFileSha256,
    expected_plan_sha256: values.planned.plan.plan_sha256,
    workspace_root: values.workspaceRoot,
    database_path: values.databasePath,
    runtime_profile_path: values.profilePath,
    expected_runtime_profile_file_sha256: values.profileFileSha256,
    expected_checkout_commit: EXPECTED_COMMIT,
    expected_reservation_file_sha256:
      values.planned.plan.reservation_set.file_sha256,
    expected_reservation_set_sha256:
      values.planned.plan.reservation_set.reservation_set_sha256,
    expected_primary_job_id: primary.job_id,
    expected_standby_job_id: standby.job_id,
    expected_standby_status: "pending",
    expected_standby_cancellation_reason: null,
    ...overrides,
  };
}

function quarantineBindingDependencies(values, overrides = {}) {
  return {
    db: values.db,
    databaseFileBinding: values.databaseFileBinding,
    runtimeProfileValidator: () => ({ valid: true, blockers: [] }),
    workspaceInspector: () => ({
      available: true,
      commit: EXPECTED_COMMIT,
      tracked_clean: true,
    }),
    now: () => new Date("2026-07-30T20:00:00.000Z"),
    ...overrides,
  };
}

test("quarantine inspection reuses the exact plan, reservation, profile, database and payload bindings", async (t) => {
  const values = await fixture(t);
  const [primary, standby] = values.planned.plan.production_jobs;
  prepareQuarantineRows(values);

  const inspected = await inspectExactGovernedPlanQuarantineBindings(
    quarantineBindingRequest(values),
    quarantineBindingDependencies(values),
  );

  assert.equal(inspected.plan.plan_sha256, values.planned.plan.plan_sha256);
  assert.equal(
    inspected.reservation.file_sha256,
    values.planned.plan.reservation_set.file_sha256,
  );
  assert.equal(inspected.database.opened_path_match, true);
  assert.deepEqual(
    inspected.jobs.map((row) => row.status),
    ["failed", "pending"],
  );
  assert.deepEqual(
    inspected.job_runs.map((row) => row.attempt),
    [1, 2, 3],
  );
  assert.equal(
    inspected.activation_receipt_path,
    path.join(values.workspaceRoot, "state", "activation-receipt.json"),
  );
});

test("quarantine inspection measures staleness against its authoritative clock", async (t) => {
  const values = await fixture(t);
  prepareQuarantineRows(values);

  await assert.rejects(
    inspectExactGovernedPlanQuarantineBindings(
      quarantineBindingRequest(values, {
        generated_at: "2026-08-01T20:00:00.000Z",
      }),
      quarantineBindingDependencies(values),
    ),
    /exact_plan_quarantine_inspection_time_not_current/,
  );
});

test("quarantine inspection output fingerprints rather than exposes job payloads and errors", async (t) => {
  const values = await fixture(t);
  const [primary] = values.planned.plan.production_jobs;
  prepareQuarantineRows(values);
  const payloadSecret = "fixture_payload_secret_must_not_escape";
  const errorSecret = "fixture_error_secret_must_not_escape";
  const row = values.jobs.get(primary.job_id);
  row.payload.fixture_secret = payloadSecret;
  values.db
    .prepare("UPDATE jobs SET payload = ?, last_error = ? WHERE id = ?")
    .run(JSON.stringify(row.payload), errorSecret, primary.job_id);

  const inspected = await inspectExactGovernedPlanQuarantineBindings(
    quarantineBindingRequest(values),
    quarantineBindingDependencies(values),
  );
  const serialised = JSON.stringify(inspected);

  assert.equal(serialised.includes(payloadSecret), false);
  assert.equal(serialised.includes(errorSecret), false);
  assert.match(inspected.jobs[0].payload_sha256, /^[a-f0-9]{64}$/);
  assert.match(inspected.jobs[0].last_error_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(inspected.jobs[0], "payload"), false);
  assert.equal(Object.hasOwn(inspected.jobs[0], "last_error"), false);
});

test("quarantine inspection binds a cancelled standby to exact terminal provenance", async (t) => {
  const cancellationReason = `governed_exact_plan_quarantined:${"b".repeat(64)}`;

  await t.test("accepts the exact durable cancellation", async (t) => {
    const values = await fixture(t);
    const [, standby] = values.planned.plan.production_jobs;
    prepareQuarantineRows(values);
    values.db
      .prepare(
        `UPDATE jobs
            SET status = 'cancelled', completed_at = ?, last_error = ?
          WHERE id = ?`,
      )
      .run("2026-07-30 20:00:00", cancellationReason, standby.job_id);

    const inspected = await inspectExactGovernedPlanQuarantineBindings(
      quarantineBindingRequest(values, {
        expected_standby_status: "cancelled",
        expected_standby_cancellation_reason: cancellationReason,
      }),
      quarantineBindingDependencies(values),
    );

    assert.equal(inspected.jobs[1].status, "cancelled");
    assert.equal(
      inspected.jobs[1].last_error_fingerprint,
      sha256(cancellationReason),
    );
  });

  await t.test(
    "rejects a cancellation without a completion time",
    async (t) => {
      const values = await fixture(t);
      const [, standby] = values.planned.plan.production_jobs;
      prepareQuarantineRows(values);
      values.db
        .prepare(
          `UPDATE jobs
            SET status = 'cancelled', completed_at = NULL, last_error = ?
          WHERE id = ?`,
        )
        .run(cancellationReason, standby.job_id);

      await assert.rejects(
        inspectExactGovernedPlanQuarantineBindings(
          quarantineBindingRequest(values, {
            expected_standby_status: "cancelled",
            expected_standby_cancellation_reason: cancellationReason,
          }),
          quarantineBindingDependencies(values),
        ),
        /exact_plan_quarantine_standby_state_invalid/,
      );
    },
  );

  await t.test("rejects different cancellation provenance", async (t) => {
    const values = await fixture(t);
    const [, standby] = values.planned.plan.production_jobs;
    const otherReason = `governed_exact_plan_quarantined:${"c".repeat(64)}`;
    prepareQuarantineRows(values);
    values.db
      .prepare(
        `UPDATE jobs
            SET status = 'cancelled', completed_at = ?, last_error = ?
          WHERE id = ?`,
      )
      .run("2026-07-30 20:00:00", otherReason, standby.job_id);

    await assert.rejects(
      inspectExactGovernedPlanQuarantineBindings(
        quarantineBindingRequest(values, {
          expected_standby_status: "cancelled",
          expected_standby_cancellation_reason: cancellationReason,
        }),
        quarantineBindingDependencies(values),
      ),
      /exact_plan_quarantine_standby_state_invalid/,
    );
  });
});

function greenProductionResult() {
  return {
    status: "autonomous_candidate_materialised",
    production: {
      mode: "LOCAL_PROOF",
      status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
      verdict: "GREEN",
      completion_receipt: {
        status: "CREATED",
        path: "candidate/completion-receipt.json",
        file_sha256: "c".repeat(64),
        receipt_sha256: "d".repeat(64),
      },
      completion_index: {
        status: "INDEXED",
        audit_id: 42,
        idempotency_key: "fixture-completion-index",
      },
      safety: {
        local_proof_only: true,
        database_mutated: true,
        database_mutation_scope: "IMMUTABLE_COMPLETION_RECEIPT_INDEX",
        narration_network_used: true,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        publish_authority: false,
        scheduler_authority: false,
        external_publish_authorised: false,
      },
    },
    no_publish: true,
    no_external_posting: true,
    no_oauth_or_token_change: true,
  };
}

test("default completion inspection binds the full canonical immutable audit row", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-drain-completion-audit-"),
  );
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      idempotency_key TEXT
    );
    CREATE UNIQUE INDEX ux_operator_audit_idempotency
      ON operator_audit_log(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TRIGGER trg_operator_audit_log_immutable_update
    BEFORE UPDATE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
    CREATE TRIGGER trg_operator_audit_log_immutable_delete
    BEFORE DELETE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
  `);
  t.after(() => {
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const receiptBody = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    generated_at: GENERATED_AT,
    story_id: "story-primary",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    candidate_revision_sha256: "a".repeat(64),
    request_fingerprint: "b".repeat(64),
    coordinator_result: {
      path: "output/story-primary/coordinator.json",
      file_sha256: "c".repeat(64),
      canonical_sha256: "d".repeat(64),
    },
    staging_result: {
      path: "output/story-primary/staging.json",
      file_sha256: "d".repeat(64),
      canonical_sha256: "e".repeat(64),
    },
    preparation_manifest: {
      path: "output/story-primary/preparation.json",
      file_sha256: "e".repeat(64),
      canonical_sha256: "c".repeat(64),
    },
    final_mp4: {
      path: "output/story-primary/final.mp4",
      file_sha256: "a".repeat(64),
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      network_used: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  const receipt = {
    ...receiptBody,
    receipt_sha256: canonicalReceiptSha256(receiptBody),
  };
  const relativePath = "candidate/completion-receipt.json";
  const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(absolutePath, receiptBytes);
  const indexed =
    await indexGovernedAutonomousCandidateCompletionReceipt({
      db,
      workspaceRoot,
      receiptRef: {
        path: relativePath,
        file_sha256: sha256(receiptBytes),
      },
    });
  const attestation = {
    story_id: receipt.story_id,
    role: receipt.role,
    channel_id: receipt.channel_id,
    lane_id: receipt.lane_id,
    platform: receipt.platform,
    scheduled_for: receipt.scheduled_for,
    candidate_revision_sha256: receipt.candidate_revision_sha256,
    request_fingerprint: receipt.request_fingerprint,
    completion_receipt: {
      path: relativePath,
      file_sha256: sha256(receiptBytes),
      receipt_sha256: receipt.receipt_sha256,
    },
    completion_index: {
      audit_id: indexed.audit_id,
      idempotency_key: indexed.idempotency_key,
    },
  };
  const options = {
    attestation,
    root: { path: workspaceRoot, real_path: workspaceRoot },
    db,
    fileSystem: fs.promises,
  };

  assert.equal(
    (await defaultCompletionReceiptInspector(options)).valid,
    true,
  );
  db.exec("DROP TRIGGER trg_operator_audit_log_immutable_update");
  db.prepare("UPDATE operator_audit_log SET actor_id='attacker'").run();
  await assert.rejects(
    () => defaultCompletionReceiptInspector(options),
    /exact_plan_completion_index_invalid/,
  );
});

function rewriteProfile(values, mutate) {
  const profile = JSON.parse(fs.readFileSync(values.profilePath, "utf8"));
  mutate(profile);
  fs.writeFileSync(values.profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  values.profileFileSha256 = sha256(fs.readFileSync(values.profilePath));
  return profile;
}

async function createTimedSuccessor(values) {
  const predecessor = values.planned;
  values.db
    .prepare(
      `UPDATE jobs
          SET status = 'failed',
              claimed_by = NULL,
              claimed_at = NULL,
              lease_until = NULL,
              completed_at = datetime('now')
        WHERE id IN (?, ?)`,
    )
    .run(
      predecessor.plan.production_jobs[0].job_id,
      predecessor.plan.production_jobs[1].job_id,
    );
  const primaryTimingSha256 = sha256("story-primary:timing:v2");
  const standbyTimingSha256 = sha256("story-standby:timing:v2");
  const successor = await planGovernedAutonomousWindowProduction(
    {
      schema_version: PLANNER_REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      generated_at: GENERATED_AT,
      scheduled_for: SCHEDULED_FOR,
      workspace_root: values.workspaceRoot,
      reservation_output_path: values.reservationPath,
      plan_output_path: values.planPath,
      candidates: [
        candidate(values.workspaceRoot, "story-primary", "db-primary", 120, {
          timingEvidenceSha256: primaryTimingSha256,
        }),
        candidate(values.workspaceRoot, "story-standby", "db-standby", 110, {
          timingEvidenceSha256: standbyTimingSha256,
        }),
      ],
    },
    { jobs: values.jobs },
  );
  values.planPath = successor.path;
  values.reservationPath = successor.plan.reservation_set.path;
  values.planFileSha256 = successor.file_sha256;
  values.planned = successor;
  return {
    predecessor,
    successor,
    primaryTimingSha256,
    standbyTimingSha256,
  };
}

test("drain requires a trusted pre-open database identity before claiming", async (t) => {
  const values = await fixture(t);
  let handlerCalls = 0;
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async () => {
        handlerCalls += 1;
        return greenProductionResult();
      },
      { databaseFileBinding: null },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("exact_plan_database_preopen_identity_required"),
  );
  assert.equal(handlerCalls, 0);
});

test("runs only the exact PRIMARY then STANDBY plan jobs through one ordinary runner and writes proof", async (t) => {
  const values = await fixture(t);
  const order = [];
  const processEnvironment = {
    AUTO_PUBLISH: "true",
    YOUTUBE_AUTO_PUBLISH: "true",
  };
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async (job, ctx) => {
        order.push({
          id: job.id,
          role: job.payload.autonomous_production_job.builder_result.role,
        });
        assert.equal(ctx.env.PULSE_OPERATING_MODE, "LOCAL_PROOF");
        assert.equal(ctx.env.PULSE_PRIMARY_INSTANCE, "false");
        assert.equal(ctx.env.AUTO_PUBLISH, "false");
        assert.equal(ctx.env.YOUTUBE_AUTO_PUBLISH, "false");
        assert.equal(ctx.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED, "false");
        assert.equal(ctx.env.PULSE_KILL_SWITCH, "true");
        assert.equal(ctx.env.PULSE_EMERGENCY_KILL_SWITCH, "true");
        assert.equal(ctx.env.BREAKING_WATCHER_ENABLED, "false");
        assert.equal(ctx.env.ELEVENLABS_CREDIT_MONITOR_ENABLED, "false");
        assert.equal(processEnvironment.AUTO_PUBLISH, "false");
        assert.equal(processEnvironment.YOUTUBE_AUTO_PUBLISH, "false");
        return greenProductionResult();
      },
      {
        processEnvironment,
        baseEnvironment: processEnvironment,
      },
    ),
  );

  const expectedJobs = values.planned.plan.production_jobs;
  assert.deepEqual(order, [
    { id: expectedJobs[0].job_id, role: "PRIMARY" },
    { id: expectedJobs[1].job_id, role: "STANDBY" },
  ]);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.status, "EXACT_PLAN_DRAIN_COMPLETED");
  assert.deepEqual(
    result.execution.jobs.map(({ job_id, role, final_status }) => ({
      job_id,
      role,
      final_status,
    })),
    [
      {
        job_id: expectedJobs[0].job_id,
        role: "PRIMARY",
        final_status: "done",
      },
      {
        job_id: expectedJobs[1].job_id,
        role: "STANDBY",
        final_status: "done",
      },
    ],
  );
  assert.equal(result.execution.runner_count, 1);
  assert.equal(result.execution.sequential_order_proven, true);
  assert.equal(result.execution.drained, true);
  assert.equal(result.safety.publish_authority, false);
  assert.equal(result.safety.oauth_or_token_authority, false);
  assert.equal(result.safety.scheduler_started, false);
  assert.equal(result.safety.watcher_started, false);
  assert.equal(result.safety.credit_monitor_started, false);
  assert.equal(result.database.preopen_identity_match, true);
  assert.equal(result.database.opened_identity_match, true);
  assert.deepEqual(
    result.database.identity,
    values.databaseFileBinding.identity,
  );
  assert.equal(processEnvironment.AUTO_PUBLISH, "true");
  assert.equal(processEnvironment.YOUTUBE_AUTO_PUBLISH, "true");
  for (const job of expectedJobs) {
    const run = values.db
      .prepare(
        `SELECT id, status, log_excerpt
           FROM job_runs
          WHERE job_id = ? AND status = 'done'`,
      )
      .get(job.job_id);
    assert.ok(run);
    assert.ok(Buffer.byteLength(run.log_excerpt, "utf8") <= 3000);
    const attestation = JSON.parse(run.log_excerpt);
    assert.equal(
      attestation.schema_version,
      "pulse-governed-exact-production-job-attestation-v1",
    );
    assert.equal(attestation.job_run_id, run.id);
    assert.equal(attestation.job_id, job.job_id);
    assert.equal(attestation.attempt_sha256, result.attempt_sha256);
  }
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.json")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    true,
  );
  assert.match(
    fs.readFileSync(path.join(values.outputDir, "exact-plan-drain.md"), "utf8"),
    /PRIMARY[\s\S]*STANDBY/,
  );
  const reservation = JSON.parse(
    fs.readFileSync(
      path.join(values.outputDir, "exact-plan-drain-reservation.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    reservation.attempt.database_file_identity,
    values.databaseFileBinding.identity,
  );
});

test("a database hard-link introduced during the drain prevents GREEN evidence", async (t) => {
  const values = await fixture(t);
  const aliasPath = path.join(values.workspaceRoot, "pulse-alias.db");
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      async beforeEvidenceFinalise() {
        fs.linkSync(values.databasePath, aliasPath);
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_plan_database_hardlink_forbidden"));
  assert.equal(result.evidence.final_json_path, null);
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );
});

test("evidence namespace conflicts or write denial are discovered before any claim", async (t) => {
  await t.test("conflicting final JSON", async (t) => {
    const values = await fixture(t);
    fs.mkdirSync(values.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(values.outputDir, "exact-plan-drain.json"),
      '{"unrelated":true}\n',
    );
    let called = 0;
    try {
      await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          called += 1;
          return greenProductionResult();
        }),
      );
    } catch {
      // A conflicting sink may not be able to carry a HOLD report.
    }
    assert.equal(called, 0);
    for (const job of values.planned.plan.production_jobs) {
      assert.equal(values.jobs.get(job.job_id).status, "pending");
    }
  });

  await t.test("output write denied", async (t) => {
    const values = await fixture(t);
    const realFileSystem = fs.promises;
    const fileSystem = new Proxy(realFileSystem, {
      get(target, property) {
        if (property === "open") {
          return async (filePath, ...args) => {
            if (String(filePath).startsWith(`${values.outputDir}${path.sep}`)) {
              const error = new Error("evidence write denied");
              error.code = "EACCES";
              throw error;
            }
            return target.open(filePath, ...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let called = 0;
    try {
      await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            called += 1;
            return greenProductionResult();
          },
          { fileSystem },
        ),
      );
    } catch {
      // A denied sink cannot persist a HOLD report.
    }
    assert.equal(called, 0);
    for (const job of values.planned.plan.production_jobs) {
      assert.equal(values.jobs.get(job.job_id).status, "pending");
    }
  });
});

test("durable attestations recover exact completed prefixes without duplicate production", async (t) => {
  await t.test("both completed before final evidence", async (t) => {
    const values = await fixture(t);
    let calls = 0;
    const first = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => {
          calls += 1;
          return greenProductionResult();
        },
        {
          beforeEvidenceFinalise() {
            throw new Error("simulated_crash_before_evidence");
          },
        },
      ),
    );
    assert.equal(first.verdict, "HOLD");
    assert.equal(calls, 2);
    assert.equal(
      fs.existsSync(path.join(values.outputDir, "exact-plan-drain.json")),
      false,
    );

    const replay = await drainExactGovernedProductionPlan(
      request(values, {
        generated_at: "2026-07-30T23:59:00.000Z",
      }),
      dependencies(values, async () => {
        throw new Error("completed jobs must not run again");
      }),
    );

    assert.equal(replay.verdict, "GREEN");
    assert.equal(replay.execution.recovered_done_prefix, 2);
    assert.equal(replay.generated_at, first.generated_at);
    assert.equal(calls, 2);
    assert.deepEqual(
      replay.execution.jobs.map((job) => job.final_status),
      ["done", "done"],
    );
  });

  await t.test("PRIMARY completed before final evidence", async (t) => {
    const values = await fixture(t);
    const roles = [];
    const first = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async (job) => {
          roles.push(job.payload.autonomous_production_job.builder_result.role);
          return greenProductionResult();
        },
        {
          afterDurableCompletion({ role }) {
            if (role === "PRIMARY") {
              throw new Error("simulated_crash_after_primary_completion");
            }
          },
        },
      ),
    );
    assert.equal(first.verdict, "HOLD");
    assert.deepEqual(roles, ["PRIMARY"]);

    const replay = await drainExactGovernedProductionPlan(
      request(values, {
        generated_at: "2026-07-30T23:58:00.000Z",
      }),
      dependencies(values, async (job) => {
        roles.push(job.payload.autonomous_production_job.builder_result.role);
        return greenProductionResult();
      }),
    );

    assert.equal(replay.verdict, "GREEN");
    assert.equal(replay.execution.recovered_done_prefix, 1);
    assert.deepEqual(roles, ["PRIMARY", "STANDBY"]);
  });
});

test("transition-lease evidence is deterministic across replay and legacy GREEN evidence is rejected", async (t) => {
  await t.test(
    "byte-identical replay contains no invocation owner",
    async (t) => {
      const values = await fixture(t);
      const first = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => greenProductionResult()),
      );
      const jsonPath = path.join(values.outputDir, "exact-plan-drain.json");
      const markdownPath = path.join(values.outputDir, "exact-plan-drain.md");
      const firstJson = fs.readFileSync(jsonPath);
      const firstMarkdown = fs.readFileSync(markdownPath);

      const replay = await drainExactGovernedProductionPlan(
        request(values, {
          generated_at: "2026-08-01T08:30:00.000Z",
        }),
        dependencies(values, async () => {
          throw new Error("completed jobs must not run again");
        }),
      );

      assert.equal(first.verdict, "GREEN");
      assert.equal(replay.verdict, "GREEN");
      assert.equal(first.report_sha256, replay.report_sha256);
      assert.deepEqual(fs.readFileSync(jsonPath), firstJson);
      assert.deepEqual(fs.readFileSync(markdownPath), firstMarkdown);
      assert.equal(firstJson.includes(Buffer.from("exact-plan-drain:")), false);
    },
  );

  await t.test(
    "a legacy GREEN report without transition proof cannot replay",
    async (t) => {
      const values = await fixture(t);
      await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => greenProductionResult()),
      );
      const jsonPath = path.join(values.outputDir, "exact-plan-drain.json");
      const markdownPath = path.join(values.outputDir, "exact-plan-drain.md");
      const legacy = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      delete legacy.runtime_transition_lease;
      delete legacy.report_sha256;
      legacy.report_sha256 = canonicalSha256(legacy);
      fs.writeFileSync(jsonPath, `${JSON.stringify(legacy, null, 2)}\n`);
      fs.rmSync(markdownPath, { force: true });

      const replay = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          throw new Error("legacy evidence must not execute jobs");
        }),
      );

      assert.equal(replay.verdict, "HOLD");
      assert.ok(replay.blockers.includes("exact_plan_drain_evidence_conflict"));
    },
  );
});

test("durable recovery fails closed on attestation, receipt or prefix drift", async (t) => {
  await t.test("tampered job-run attestation", async (t) => {
    const values = await fixture(t);
    await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), {
        beforeEvidenceFinalise() {
          throw new Error("simulated_crash_before_evidence");
        },
      }),
    );
    const primaryId = values.planned.plan.production_jobs[0].job_id;
    const run = values.db
      .prepare(
        `SELECT id, log_excerpt
           FROM job_runs
          WHERE job_id = ? AND status = 'done'`,
      )
      .get(primaryId);
    const attestation = JSON.parse(run.log_excerpt);
    attestation.role = "STANDBY";
    values.db
      .prepare("UPDATE job_runs SET log_excerpt = ? WHERE id = ?")
      .run(JSON.stringify(attestation), run.id);
    let called = 0;

    const replay = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(replay.verdict, "HOLD");
    assert.ok(replay.blockers.includes("exact_plan_job_attestation_invalid"));
    assert.equal(called, 0);
  });

  await t.test("completion receipt cannot be re-attested", async (t) => {
    const values = await fixture(t);
    await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), {
        beforeEvidenceFinalise() {
          throw new Error("simulated_crash_before_evidence");
        },
      }),
    );
    let called = 0;

    const replay = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => {
          called += 1;
          return greenProductionResult();
        },
        {
          completionReceiptInspector: async () => ({
            valid: false,
          }),
        },
      ),
    );

    assert.equal(replay.verdict, "HOLD");
    assert.ok(
      replay.blockers.includes("exact_plan_completion_receipt_invalid"),
    );
    assert.equal(called, 0);
  });

  await t.test("a done suffix without a done prefix", async (t) => {
    const values = await fixture(t);
    const standbyId = values.planned.plan.production_jobs[1].job_id;
    values.db
      .prepare(
        `UPDATE jobs
            SET status = 'done', completed_at = datetime('now')
          WHERE id = ?`,
      )
      .run(standbyId);
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_database_job_status_invalid"),
    );
    assert.equal(called, 0);
  });
});

test("JSON-before-Markdown interruption is finalised deterministically on replay", async (t) => {
  const values = await fixture(t);
  const realFileSystem = fs.promises;
  let denyMarkdownOnce = true;
  const fileSystem = new Proxy(realFileSystem, {
    get(target, property) {
      if (property === "open") {
        return async (filePath, ...args) => {
          if (
            denyMarkdownOnce &&
            path.basename(String(filePath)).includes("exact-plan-drain.md")
          ) {
            denyMarkdownOnce = false;
            const error = new Error("markdown interruption");
            error.code = "EIO";
            throw error;
          }
          return target.open(filePath, ...args);
        };
      }
      if (property === "link") {
        return async (existingPath, newPath) => {
          if (
            denyMarkdownOnce &&
            path.basename(String(newPath)) === "exact-plan-drain.md"
          ) {
            denyMarkdownOnce = false;
            const error = new Error("markdown interruption");
            error.code = "EIO";
            throw error;
          }
          return target.link(existingPath, newPath);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let calls = 0;
  await assert.rejects(
    drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => {
          calls += 1;
          return greenProductionResult();
        },
        { fileSystem },
      ),
    ),
    /markdown interruption|EIO/,
  );
  const jsonPath = path.join(values.outputDir, "exact-plan-drain.json");
  const markdownPath = path.join(values.outputDir, "exact-plan-drain.md");
  const originalJson = fs.readFileSync(jsonPath);
  assert.equal(fs.existsSync(markdownPath), false);

  let heartbeatCallback = null;
  let transitionLost = false;
  const replayFileSystem = new Proxy(realFileSystem, {
    get(target, property) {
      if (property === "link") {
        return async (existingPath, newPath) => {
          const result = await target.link(existingPath, newPath);
          if (path.basename(String(newPath)) === "exact-plan-drain.md") {
            transitionLost = true;
            heartbeatCallback();
          }
          return result;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await assert.rejects(
    drainExactGovernedProductionPlan(
      request(values, {
        generated_at: "2026-07-30T23:56:00.000Z",
      }),
      dependencies(
        values,
        async () => {
          throw new Error("completed jobs must not run again");
        },
        {
          fileSystem: replayFileSystem,
          transitionLeaseAcquirer: () => ({
            renew() {
              if (transitionLost) {
                throw new Error("fixture_transition_lost");
              }
              return true;
            },
            release: () => true,
          }),
          setInterval(callback) {
            heartbeatCallback = callback;
            return { unref() {} };
          },
          clearInterval() {},
        },
      ),
    ),
    /exact_plan_live_transition_lease_lost/,
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );

  const replay = await drainExactGovernedProductionPlan(
    request(values, {
      generated_at: "2026-07-30T23:57:00.000Z",
    }),
    dependencies(values, async () => {
      throw new Error("completed jobs must not run again");
    }),
  );

  assert.equal(replay.verdict, "GREEN");
  assert.equal(calls, 2);
  assert.deepEqual(fs.readFileSync(jsonPath), originalJson);
  assert.equal(fs.existsSync(markdownPath), true);
});

test("heartbeat loss during evidence staging cannot create replayable committed GREEN evidence", async (t) => {
  const values = await fixture(t);
  const realFileSystem = fs.promises;
  let heartbeatCallback = null;
  let leaseLost = false;
  let triggered = false;
  const fileSystem = new Proxy(realFileSystem, {
    get(target, property) {
      if (property === "link") {
        return async (existingPath, newPath) => {
          const result = await target.link(existingPath, newPath);
          if (
            !triggered &&
            path.basename(String(newPath)) === "exact-plan-drain.json"
          ) {
            triggered = true;
            leaseLost = true;
            heartbeatCallback();
          }
          return result;
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  await assert.rejects(
    drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), {
        fileSystem,
        transitionLeaseAcquirer: () => ({
          renew() {
            if (leaseLost) {
              throw new Error("fixture_transition_lost");
            }
            return true;
          },
          release: () => true,
        }),
        setInterval(callback) {
          heartbeatCallback = callback;
          return { unref() {} };
        },
        clearInterval() {},
      }),
    ),
    /exact_plan_live_transition_lease_lost/,
  );

  const commitPath = path.join(
    values.outputDir,
    "exact-plan-drain.commit.json",
  );
  assert.equal(triggered, true);
  assert.equal(fs.existsSync(commitPath), false);

  const recovered = await drainExactGovernedProductionPlan(
    request(values, {
      generated_at: "2026-08-01T08:45:00.000Z",
    }),
    dependencies(values, async () => {
      throw new Error("completed jobs must not run again");
    }),
  );
  assert.equal(recovered.verdict, "GREEN");
  assert.equal(fs.existsSync(commitPath), true);
});

test("accepts an exact legacy v1 root plan without inventing lineage", async (t) => {
  const values = await fixture(t);
  const legacyPlan = structuredClone(values.planned.plan);
  legacyPlan.schema_version =
    "pulse-governed-autonomous-window-production-plan-v1";
  delete legacyPlan.candidate_set_revision;
  delete legacyPlan.lineage;
  delete legacyPlan.plan_sha256;
  legacyPlan.plan_sha256 = canonicalSha256(legacyPlan);
  const legacyBytes = Buffer.from(`${JSON.stringify(legacyPlan, null, 2)}\n`);
  fs.writeFileSync(values.planPath, legacyBytes);
  values.planFileSha256 = sha256(legacyBytes);
  values.planned = {
    ...values.planned,
    plan: legacyPlan,
    file_sha256: values.planFileSha256,
  };

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult()),
  );

  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.plan.lineage.schema_version,
    "pulse-governed-autonomous-window-production-plan-v1",
  );
  assert.equal(result.plan.lineage.predecessor_count, 0);
  assert.deepEqual(result.plan.lineage.predecessors, []);
});

test("accepts only the immutable v2 successor path and proves its predecessor chain before draining", async (t) => {
  const values = await fixture(t);
  const { predecessor, successor, primaryTimingSha256, standbyTimingSha256 } =
    await createTimedSuccessor(values);
  const observedOrder = [];

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async (job) => {
      observedOrder.push(
        job.payload.autonomous_production_job.builder_result.role,
      );
      return greenProductionResult();
    }),
  );

  const candidateSetSha256 =
    successor.plan.candidate_set_revision.candidate_set_revision_sha256;
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(observedOrder, ["PRIMARY", "STANDBY"]);
  assert.equal(
    path.dirname(successor.path),
    path.join(path.dirname(path.dirname(successor.path)), candidateSetSha256),
  );
  assert.equal(
    result.plan.lineage.schema_version,
    "pulse-governed-autonomous-window-production-plan-v2",
  );
  assert.equal(result.plan.lineage.predecessor_count, 1);
  assert.deepEqual(
    result.plan.lineage.predecessors.map((entry) => ({
      plan_sha256: entry.plan_sha256,
      file_sha256: entry.file_sha256,
      candidate_set_revision_sha256: entry.candidate_set_revision_sha256,
    })),
    [
      {
        plan_sha256: predecessor.plan.plan_sha256,
        file_sha256: predecessor.file_sha256,
        candidate_set_revision_sha256:
          predecessor.plan.candidate_set_revision.candidate_set_revision_sha256,
      },
    ],
  );
  assert.deepEqual(
    successor.plan.candidate_set_revision.ordered_candidates.map(
      (entry) => entry.timing_evidence_hashes,
    ),
    [
      [
        {
          field_path:
            "locked_intake_binding.locked_intake.visual_brief.narration_timing_evidence_sha256",
          sha256: primaryTimingSha256,
        },
      ],
      [
        {
          field_path:
            "locked_intake_binding.locked_intake.visual_brief.narration_timing_evidence_sha256",
          sha256: standbyTimingSha256,
        },
      ],
    ],
  );
});

test("v2 lineage revalidates every predecessor job against the opened database before claiming", async (t) => {
  const cases = [
    {
      name: "predecessor idempotency drift",
      expected: "exact_plan_lineage_predecessor_job_binding_mismatch",
      mutate(values, predecessor) {
        values.db
          .prepare("UPDATE jobs SET idempotency_key = ? WHERE id = ?")
          .run(
            "forged-predecessor-idempotency",
            predecessor.plan.production_jobs[0].job_id,
          );
      },
    },
    {
      name: "predecessor payload and builder drift",
      expected: "exact_plan_lineage_predecessor_job_binding_mismatch",
      mutate(values, predecessor) {
        const id = predecessor.plan.production_jobs[0].job_id;
        const row = values.jobs.get(id);
        row.payload.autonomous_production_job.builder_result.role = "STANDBY";
        values.db
          .prepare("UPDATE jobs SET payload = ? WHERE id = ?")
          .run(JSON.stringify(row.payload), id);
      },
    },
    {
      name: "predecessor is no longer terminal",
      expected: "exact_plan_lineage_predecessor_job_not_terminal",
      mutate(values, predecessor) {
        values.db
          .prepare("UPDATE jobs SET status = 'paused' WHERE id = ?")
          .run(predecessor.plan.production_jobs[0].job_id);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const values = await fixture(t);
      const { predecessor } = await createTimedSuccessor(values);
      entry.mutate(values, predecessor);
      let called = 0;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          called += 1;
          return greenProductionResult();
        }),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(result.blockers.includes(entry.expected));
      assert.equal(called, 0);
      for (const job of values.planned.plan.production_jobs) {
        assert.equal(values.jobs.get(job.job_id).status, "pending");
      }
    });
  }
});

test("v2 plans are accepted only at canonical root or immutable successor paths", async (t) => {
  await t.test("successor basename cannot drift", async (t) => {
    const values = await fixture(t);
    const { successor } = await createTimedSuccessor(values);
    const noncanonicalPath = path.join(
      path.dirname(successor.path),
      "renamed-plan.json",
    );
    fs.copyFileSync(successor.path, noncanonicalPath);
    values.planPath = noncanonicalPath;
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_lineage_successor_path_mismatch"),
    );
    assert.equal(called, 0);
  });

  await t.test("root plan cannot masquerade as a revision", async (t) => {
    const values = await fixture(t);
    const candidateSetSha256 =
      values.planned.plan.candidate_set_revision.candidate_set_revision_sha256;
    const falseRevisionPath = path.join(
      values.workspaceRoot,
      "revisions",
      candidateSetSha256,
      "production-plan.json",
    );
    fs.mkdirSync(path.dirname(falseRevisionPath), {
      recursive: true,
    });
    fs.copyFileSync(values.planPath, falseRevisionPath);
    values.planPath = falseRevisionPath;
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_lineage_root_path_mismatch"),
    );
    assert.equal(called, 0);
  });
});

test("exact inputs and database reject traversal and in-root junction aliases", async (t) => {
  await t.test("lexical traversal is rejected", async (t) => {
    const values = await fixture(t);
    await assert.rejects(
      drainExactGovernedProductionPlan(
        request(values, {
          plan_path:
            `${values.workspaceRoot}${path.sep}missing` +
            `${path.sep}..${path.sep}production-plan.json`,
        }),
        dependencies(values, async () => greenProductionResult()),
      ),
      /exact_plan_drain_plan_path_invalid/,
    );
  });

  await t.test("plan parent junction alias is rejected", async (t) => {
    const values = await fixture(t);
    const aliasRoot = path.join(values.workspaceRoot, "plan-alias");
    fs.symlinkSync(values.workspaceRoot, aliasRoot, "junction");
    const aliasPath = path.join(aliasRoot, "production-plan.json");
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values, { plan_path: aliasPath }),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_drain_input_link_forbidden"),
    );
    assert.equal(called, 0);
  });

  await t.test("database parent junction alias is rejected", async (t) => {
    const values = await fixture(t);
    const aliasRoot = path.join(values.workspaceRoot, "database-alias");
    fs.symlinkSync(values.workspaceRoot, aliasRoot, "junction");
    const aliasDatabasePath = path.join(aliasRoot, "pulse.db");
    rewriteProfile(values, (profile) => {
      profile.database_path = aliasDatabasePath;
    });
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values, { database_path: aliasDatabasePath }),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(result.blockers.includes("exact_plan_database_link_forbidden"));
    assert.equal(called, 0);
  });
});

test("rejects self-consistent plans whose selection metadata does not describe the exact candidate set", async (t) => {
  const cases = [
    {
      name: "selection policy drift",
      mutate(plan) {
        plan.selection_policy = "UNREVIEWED_POLICY";
      },
    },
    {
      name: "eligible candidate count drift",
      mutate(plan) {
        plan.eligible_candidate_count = 3;
      },
    },
    {
      name: "not-selected set overlaps selection",
      mutate(plan) {
        plan.eligible_candidate_count = 3;
        plan.not_selected_story_ids = ["story-primary"];
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const values = await fixture(t);
      const plan = structuredClone(values.planned.plan);
      entry.mutate(plan);
      delete plan.plan_sha256;
      plan.plan_sha256 = canonicalSha256(plan);
      const bytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
      fs.writeFileSync(values.planPath, bytes);
      values.planFileSha256 = sha256(bytes);
      values.planned = {
        ...values.planned,
        plan,
        file_sha256: values.planFileSha256,
      };
      let called = 0;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          called += 1;
          return greenProductionResult();
        }),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_selection_contract_invalid"),
      );
      assert.equal(called, 0);
      for (const job of values.planned.plan.production_jobs) {
        assert.equal(values.jobs.get(job.job_id).status, "pending");
      }
    });
  }
});

test("a GREEN-shaped handler result cannot advance without explicit no-publish attestations", async (t) => {
  const values = await fixture(t);
  const expectedJobs = values.planned.plan.production_jobs;
  const seen = [];

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async (job) => {
      seen.push(job.payload.autonomous_production_job.builder_result.role);
      return {
        ...greenProductionResult(),
        no_publish: false,
        no_external_posting: false,
      };
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "exact_plan_job_result_authority_attestation_invalid",
    ),
  );
  assert.deepEqual(seen, ["PRIMARY"]);
  assert.notEqual(values.jobs.get(expectedJobs[0].job_id).status, "done");
  assert.equal(values.jobs.get(expectedJobs[1].job_id).status, "pending");
  assert.equal(values.jobs.get(expectedJobs[1].job_id).attempt_count, 0);
});

test("a GREEN-shaped result must carry exact LOCAL_PROOF and no-authority attestations", async (t) => {
  const cases = [
    {
      name: "top-level OAuth attestation missing",
      mutate(result) {
        result.no_oauth_or_token_change = false;
      },
    },
    {
      name: "inner mode is not LOCAL_PROOF",
      mutate(result) {
        result.production.mode = "LIVE_GUARDED";
      },
    },
    {
      name: "inner platform contact is true",
      mutate(result) {
        result.production.safety.platform_contacted = true;
      },
    },
    {
      name: "inner safety surface has an undeclared field",
      mutate(result) {
        result.production.safety.upload_authority = false;
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const values = await fixture(t);
      let called = 0;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          called += 1;
          const handlerResult = structuredClone(greenProductionResult());
          entry.mutate(handlerResult);
          return handlerResult;
        }),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes(
          "exact_plan_job_result_authority_attestation_invalid",
        ),
      );
      assert.equal(called, 1);
      assert.equal(
        values.jobs.get(values.planned.plan.production_jobs[1].job_id)
          .attempt_count,
        0,
      );
    });
  }
});

test("fails closed before runner start when another active breaking-production job exists", async (t) => {
  const values = await fixture(t);
  values.jobs.enqueue({
    kind: "produce_breaking_short",
    channel_id: "pulse-gaming",
    story_id: "db-extra",
    payload: { lane_id: "breaking_short", story_id: "story-extra" },
    priority: 1,
    run_at: GENERATED_AT,
    max_attempts: 3,
    idempotency_key: "extra-breaking-job",
  });
  let called = 0;
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => {
      called += 1;
      throw new Error("must_not_run");
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("exact_plan_active_breaking_job_set_mismatch"),
  );
  assert.equal(called, 0);
  for (const job of values.planned.plan.production_jobs) {
    assert.equal(values.jobs.get(job.job_id).status, "pending");
  }
});

test("rejects DB payload drift, profile hash drift and any live owner without claiming", async (t) => {
  await t.test("builder binding drift", async (t) => {
    const values = await fixture(t);
    const primary = values.planned.plan.production_jobs[0];
    const row = values.jobs.get(primary.job_id);
    row.payload.autonomous_production_job.builder_result.role = "STANDBY";
    values.db
      .prepare("UPDATE jobs SET payload = ? WHERE id = ?")
      .run(JSON.stringify(row.payload), primary.job_id);
    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        throw new Error("must_not_run");
      }),
    );
    assert.equal(result.verdict, "HOLD");
    assert.ok(result.blockers.some((value) => value.includes("builder")));
    assert.equal(values.jobs.get(primary.job_id).status, "pending");
  });

  await t.test("profile file hash drift", async (t) => {
    const values = await fixture(t);
    fs.appendFileSync(values.profilePath, " ");
    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        throw new Error("must_not_run");
      }),
    );
    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes(
        "exact_plan_runtime_profile_file_sha256_mismatch",
      ),
    );
  });

  await t.test("reservation evidence drift", async (t) => {
    const values = await fixture(t);
    fs.appendFileSync(values.reservationPath, " ");
    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        throw new Error("must_not_run");
      }),
    );
    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_reservation_file_sha256_mismatch"),
    );
    assert.equal(
      values.jobs.get(values.planned.plan.production_jobs[0].job_id).status,
      "pending",
    );
  });

  await t.test("live owner", async (t) => {
    const values = await fixture(t);
    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => {
          throw new Error("must_not_run");
        },
        {
          quiescenceInspector: () =>
            quiescentInspection({
              owner_pids: [4123],
            }),
        },
      ),
    );
    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_live_runtime_not_quiescent"),
    );
  });
});

test("records the unavailable post-PRIMARY quiescence observation before holding", async (t) => {
  const values = await fixture(t);
  const roles = [];
  let inspectionCount = 0;
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async (job) => {
        roles.push(job.payload.autonomous_production_job.builder_result.role);
        return greenProductionResult();
      },
      {
        quiescenceInspector: () => {
          inspectionCount += 1;
          return inspectionCount === 4
            ? quiescentInspection({
                available: false,
                probe_attestations: {
                  listeners: false,
                  processes: false,
                  scheduled_tasks: false,
                },
              })
            : quiescentInspection();
        },
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "exact_plan_runtime_quiescence_inspection_unavailable",
    ),
  );
  assert.deepEqual(roles, ["PRIMARY"]);
  assert.deepEqual(
    result.runtime_quiescence.checks.slice(0, 4).map((check) => ({
      sequence: check.sequence,
      available: check.available,
      all_probes_attested: Object.values(check.probe_attestations).every(
        Boolean,
      ),
    })),
    [
      {
        sequence: 1,
        available: true,
        all_probes_attested: true,
      },
      {
        sequence: 2,
        available: true,
        all_probes_attested: true,
      },
      {
        sequence: 3,
        available: true,
        all_probes_attested: true,
      },
      {
        sequence: 4,
        available: false,
        all_probes_attested: false,
      },
    ],
  );
});

test("records a sanitised unavailable quiescence observation when inspection throws", async (t) => {
  const values = await fixture(t);
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async () => {
        throw new Error("must_not_run");
      },
      {
        quiescenceInspector: () => {
          throw new Error("probe_transport_failed");
        },
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.some((blocker) =>
      /^exact_plan_unexpected_error:[a-f0-9]{64}$/.test(blocker),
    ),
  );
  assert.deepEqual(result.runtime_quiescence.checks, [
    {
      sequence: 1,
      available: false,
      probe_attestations: {
        listeners: false,
        processes: false,
        scheduled_tasks: false,
      },
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
      task_states: [],
      absent_task_names: [],
    },
  ]);
});

test("requires the exact activation receipt path to remain absent before and throughout the drain", async (t) => {
  await t.test("present regular file blocks before claim", async (t) => {
    const values = await fixture(t);
    const profile = JSON.parse(fs.readFileSync(values.profilePath, "utf8"));
    fs.mkdirSync(path.dirname(profile.activation_receipt_path), {
      recursive: true,
    });
    fs.writeFileSync(profile.activation_receipt_path, "{}\n");
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_activation_receipt_present"),
    );
    assert.equal(called, 0);
  });

  await t.test("present junction blocks before claim", async (t) => {
    const values = await fixture(t);
    const profile = rewriteProfile(values, (entry) => {
      entry.activation_receipt_path = path.join(
        values.workspaceRoot,
        "state",
        "activation-receipt-link",
      );
    });
    const linkTarget = path.join(values.workspaceRoot, "activation-target");
    fs.mkdirSync(path.dirname(profile.activation_receipt_path), {
      recursive: true,
    });
    fs.mkdirSync(linkTarget);
    fs.symlinkSync(linkTarget, profile.activation_receipt_path, "junction");
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_activation_receipt_present"),
    );
    assert.equal(called, 0);
  });

  await t.test(
    "receipt appearing inside the handler prevents completion",
    async (t) => {
      const values = await fixture(t);
      const profile = JSON.parse(fs.readFileSync(values.profilePath, "utf8"));
      let called = 0;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          called += 1;
          fs.mkdirSync(path.dirname(profile.activation_receipt_path), {
            recursive: true,
          });
          fs.writeFileSync(profile.activation_receipt_path, "{}\n");
          return greenProductionResult();
        }),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_activation_receipt_present"),
      );
      assert.equal(called, 1);
      assert.equal(
        values.jobs.get(values.planned.plan.production_jobs[0].job_id).status,
        "pending",
      );
      assert.equal(
        values.jobs.get(values.planned.plan.production_jobs[1].job_id)
          .attempt_count,
        0,
      );
    },
  );

  await t.test(
    "receipt appearing at the final evidence boundary prevents GREEN",
    async (t) => {
      const values = await fixture(t);
      const profile = JSON.parse(fs.readFileSync(values.profilePath, "utf8"));

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => greenProductionResult(), {
          beforeEvidenceFinalise() {
            fs.mkdirSync(path.dirname(profile.activation_receipt_path), {
              recursive: true,
            });
            fs.writeFileSync(profile.activation_receipt_path, "{}\n");
          },
        }),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_activation_receipt_present"),
      );
      assert.equal(
        fs.existsSync(path.join(values.outputDir, "exact-plan-drain.json")),
        false,
      );
    },
  );
});

test("the durable live-transition lease excludes activation and runtime start for the complete drain boundary", async (t) => {
  await t.test("a pre-held transition blocks before production", async (t) => {
    const values = await fixture(t);
    values.runtimeLeases.acquire({
      name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
      ownerId: "live-start:other",
      leaseMs: 60_000,
    });
    let called = 0;

    const result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => {
        called += 1;
        return greenProductionResult();
      }),
    );

    assert.equal(result.verdict, "HOLD");
    assert.ok(
      result.blockers.includes("exact_plan_live_transition_lease_unavailable"),
    );
    assert.equal(called, 0);
    assert.equal(
      values.runtimeLeases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME)?.owner_id,
      "live-start:other",
    );
  });

  await t.test(
    "competing acquisition is denied through final inspection and the lease is then released",
    async (t) => {
      const values = await fixture(t);
      const competing = [];
      const attemptCompetingAcquire = (boundary) => {
        const result = values.runtimeLeases.acquire({
          name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
          ownerId: `live-activation:${boundary}`,
          leaseMs: 60_000,
        });
        competing.push([boundary, result.acquired]);
      };

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            attemptCompetingAcquire("handler");
            return greenProductionResult();
          },
          {
            beforeEvidenceFinalise() {
              attemptCompetingAcquire("finalise");
            },
          },
        ),
      );

      assert.equal(result.verdict, "GREEN");
      assert.deepEqual(competing, [
        ["handler", false],
        ["handler", false],
        ["finalise", false],
      ]);
      assert.equal(
        values.runtimeLeases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME),
        null,
      );
      assert.deepEqual(result.runtime_transition_lease, {
        required: true,
        name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
        acquired: true,
        held_through_finalisation: true,
      });
      assert.equal(JSON.stringify(result).includes("exact-plan-drain:"), false);
    },
  );

  await t.test(
    "an explicit non-throwing false renewal fails closed before production",
    async (t) => {
      const values = await fixture(t);
      let productionCalls = 0;
      let releaseAttempts = 0;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            productionCalls += 1;
            return greenProductionResult();
          },
          {
            transitionLeaseAcquirer: () => ({
              renew: () => false,
              release() {
                releaseAttempts += 1;
                return true;
              },
            }),
          },
        ),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_live_transition_lease_lost"),
      );
      assert.equal(productionCalls, 0);
      assert.equal(releaseAttempts, 1);
    },
  );

  await t.test(
    "a non-throwing false heartbeat renewal remains lost and fails closed",
    async (t) => {
      const values = await fixture(t);
      let heartbeatCallback = null;
      let heartbeatRunning = false;
      let heartbeatRenewals = 0;
      let releaseAttempts = 0;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            heartbeatRunning = true;
            heartbeatCallback();
            heartbeatRunning = false;
            return greenProductionResult();
          },
          {
            transitionLeaseAcquirer: () => ({
              renew() {
                if (heartbeatRunning) {
                  heartbeatRenewals += 1;
                  return false;
                }
                return true;
              },
              release() {
                releaseAttempts += 1;
                return true;
              },
            }),
            setInterval(callback) {
              heartbeatCallback = callback;
              return { unref() {} };
            },
            clearInterval() {},
          },
        ),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_live_transition_lease_lost"),
      );
      assert.equal(heartbeatRenewals, 1);
      assert.equal(releaseAttempts, 1);
    },
  );

  await t.test(
    "background heartbeat loss converts the run to a fixed secret-safe HOLD",
    async (t) => {
      const values = await fixture(t);
      let heartbeatCallback = null;
      let lost = false;
      let released = false;
      let cleared = false;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            lost = true;
            heartbeatCallback();
            return greenProductionResult();
          },
          {
            transitionLeaseAcquirer() {
              return {
                renew() {
                  if (lost) {
                    throw new Error("must_not_escape_secret_transition_detail");
                  }
                  return true;
                },
                release() {
                  released = true;
                  return true;
                },
              };
            },
            setInterval(callback) {
              heartbeatCallback = callback;
              return { unref() {} };
            },
            clearInterval() {
              cleared = true;
            },
          },
        ),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_live_transition_lease_lost"),
      );
      assert.equal(
        result.blockers.some((value) =>
          value.includes("must_not_escape_secret_transition_detail"),
        ),
        false,
      );
      assert.equal(released, true);
      assert.equal(cleared, true);
    },
  );

  await t.test(
    "release failure after the GREEN commit link cannot return success even after heartbeat loss",
    async (t) => {
      const values = await fixture(t);
      const realFileSystem = fs.promises;
      let heartbeatCallback = null;
      let lost = false;
      let triggered = false;
      let releaseAttempts = 0;
      const fileSystem = new Proxy(realFileSystem, {
        get(target, property) {
          if (property === "link") {
            return async (existingPath, newPath) => {
              const result = await target.link(existingPath, newPath);
              if (
                !triggered &&
                path.basename(String(newPath)) ===
                  "exact-plan-drain.commit.json"
              ) {
                triggered = true;
                lost = true;
                heartbeatCallback();
              }
              return result;
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      let observedError = null;
      try {
        await drainExactGovernedProductionPlan(
          request(values),
          dependencies(values, async () => greenProductionResult(), {
            fileSystem,
            transitionLeaseAcquirer: () => ({
              renew() {
                if (lost) {
                  throw new Error("secret_renewal_detail");
                }
                return true;
              },
              release() {
                releaseAttempts += 1;
                throw new Error("secret_release_detail");
              },
            }),
            setInterval(callback) {
              heartbeatCallback = callback;
              return { unref() {} };
            },
            clearInterval() {},
          }),
        );
      } catch (error) {
        observedError = error;
      }

      assert.ok(observedError);
      assert.equal(
        observedError.message,
        "exact_plan_live_transition_lease_release_failed",
      );
      assert.equal(
        observedError.message.includes("secret_release_detail"),
        false,
      );
      assert.equal(triggered, true);
      assert.equal(releaseAttempts, 1);
      assert.equal(
        fs.existsSync(
          path.join(values.outputDir, "exact-plan-drain.commit.json"),
        ),
        true,
      );
    },
  );

  await t.test(
    "a non-throwing false release result fails closed with the fixed lease error",
    async (t) => {
      const values = await fixture(t);
      let releaseAttempts = 0;

      await assert.rejects(
        drainExactGovernedProductionPlan(
          request(values),
          dependencies(values, async () => greenProductionResult(), {
            transitionLeaseAcquirer: () => ({
              renew: () => true,
              release() {
                releaseAttempts += 1;
                return false;
              },
            }),
          }),
        ),
        (error) => {
          assert.equal(
            error.message,
            "exact_plan_live_transition_lease_release_failed",
          );
          return true;
        },
      );

      assert.equal(releaseAttempts, 1);
    },
  );
});

test("the final database fence validates a real lease without renewing through a competing SQLite writer", async (t) => {
  const values = await fixture(t);
  let leaseDatabase = null;

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      transitionLeaseAcquirer(options) {
        return acquireLiveRuntimeTransitionLease({
          ...options,
          runtimeTransitionLeaseFactory({ databasePath }) {
            leaseDatabase = new Database(databasePath, {
              fileMustExist: true,
              timeout: 25,
            });
            return {
              leases: bindRuntimeLeases(leaseDatabase),
              close() {
                leaseDatabase?.close();
                leaseDatabase = null;
              },
            };
          },
        });
      },
    }),
  );

  assert.equal(result.verdict, "GREEN", JSON.stringify(result));
  assert.deepEqual(result.blockers, []);
  assert.equal(leaseDatabase, null);
  assert.equal(
    values.runtimeLeases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME),
    null,
  );
});

test("a bounded timeout aborts and drains the runner without claiming STANDBY", async (t) => {
  const values = await fixture(t);
  const seen = [];
  const result = await drainExactGovernedProductionPlan(
    request(values, { timeout_ms: 30, poll_interval_ms: 5 }),
    dependencies(values, async (job, ctx) => {
      seen.push(job.payload.autonomous_production_job.builder_result.role);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("production_aborted"));
          },
          { once: true },
        );
      });
      return null;
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_plan_drain_timeout"));
  assert.deepEqual(seen, ["PRIMARY"]);
  assert.notEqual(
    values.jobs.get(values.planned.plan.production_jobs[1].job_id).status,
    "done",
  );
  assert.equal(result.execution.drained, true);
});

test("a non-cooperative handler keeps the environment and evidence sink fenced until actual quiescence", async (t) => {
  const values = await fixture(t);
  const processEnvironment = {
    AUTO_PUBLISH: "true",
    YOUTUBE_AUTO_PUBLISH: "true",
  };
  let releaseHandler;
  let markHandlerStarted;
  let markHandlerExited;
  const handlerRelease = new Promise((resolve) => {
    releaseHandler = resolve;
  });
  const handlerStarted = new Promise((resolve) => {
    markHandlerStarted = resolve;
  });
  const handlerExited = new Promise((resolve) => {
    markHandlerExited = resolve;
  });
  let settled = false;
  const drainPromise = drainExactGovernedProductionPlan(
    request(values, {
      timeout_ms: 20,
      poll_interval_ms: 5,
    }),
    dependencies(
      values,
      async () => {
        markHandlerStarted();
        await handlerRelease;
        markHandlerExited();
        return greenProductionResult();
      },
      {
        processEnvironment,
        baseEnvironment: processEnvironment,
      },
    ),
  );
  drainPromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await handlerStarted;
  await new Promise((resolve) => setTimeout(resolve, 1150));
  const beforeRelease = {
    settled,
    autoPublish: processEnvironment.AUTO_PUBLISH,
    youtubeAutoPublish: processEnvironment.YOUTUBE_AUTO_PUBLISH,
    jsonExists: fs.existsSync(
      path.join(values.outputDir, "exact-plan-drain.json"),
    ),
    markdownExists: fs.existsSync(
      path.join(values.outputDir, "exact-plan-drain.md"),
    ),
  };
  releaseHandler();
  await handlerExited;
  const result = await drainPromise;

  assert.deepEqual(beforeRelease, {
    settled: false,
    autoPublish: "false",
    youtubeAutoPublish: "false",
    jsonExists: false,
    markdownExists: false,
  });
  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_plan_drain_timeout"));
  assert.ok(result.blockers.includes("exact_plan_runner_drain_bound_exceeded"));
  assert.equal(result.execution.work_window_exceeded, true);
  assert.equal(result.execution.drain_bound_exceeded, true);
  assert.equal(result.execution.drained, true);
  assert.equal(processEnvironment.AUTO_PUBLISH, "true");
  assert.equal(processEnvironment.YOUTUBE_AUTO_PUBLISH, "true");
  assert.notEqual(
    values.jobs.get(values.planned.plan.production_jobs[0].job_id).status,
    "done",
  );
  assert.equal(
    values.jobs.get(values.planned.plan.production_jobs[1].job_id)
      .attempt_count,
    0,
  );
});

test("unexpected handler errors are redacted before blockers or evidence are emitted", async (t) => {
  const values = await fixture(t);
  const secret = "sk_live_DO_NOT_LEAK_7YH4Q9";

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => {
      throw new Error(`provider exploded with ${secret}`);
    }),
  );

  const serialised = JSON.stringify(result);
  assert.equal(result.verdict, "HOLD");
  assert.equal(serialised.includes(secret), false);
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.json")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.md")),
    false,
  );
  assert.ok(
    result.blockers.some((blocker) =>
      /^exact_plan_unexpected_error:[a-f0-9]{64}$/.test(blocker),
    ),
  );
  const persistedRun = values.db
    .prepare(
      `SELECT error_message, log_excerpt
         FROM job_runs
        WHERE job_id = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(values.planned.plan.production_jobs[0].job_id);
  assert.equal(JSON.stringify(persistedRun).includes(secret), false);
});

test("a retryable PRIMARY outcome never makes STANDBY claimable during PRIMARY backoff", async (t) => {
  const values = await fixture(t);
  const expectedJobs = values.planned.plan.production_jobs;
  const seen = [];
  const result = await drainExactGovernedProductionPlan(
    request(values, {
      timeout_ms: 500,
      poll_interval_ms: 200,
    }),
    dependencies(values, async (job) => {
      seen.push(job.payload.autonomous_production_job.builder_result.role);
      return {
        status: "held",
        job_outcome: "RETRY",
        retryable: true,
        retry_after_seconds: 60,
        blockers: ["primary_needs_immutable_replan"],
      };
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(seen, ["PRIMARY"]);
  const primary = values.jobs.get(expectedJobs[0].job_id);
  const standby = values.jobs.get(expectedJobs[1].job_id);
  assert.equal(primary.status, "pending");
  assert.equal(primary.attempt_count, 1);
  assert.equal(standby.status, "pending");
  assert.equal(standby.attempt_count, 0);
});

test("the default runtime-profile gate accepts only the repository's exact reviewed live profile", { skip: process.platform !== "win32" }, async (t) => {
  const values = await fixture(t);
  const reviewedProfile = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      "config",
      "windows-local-runtime.live-guarded-youtube.json",
    ),
  );
  fs.writeFileSync(values.profilePath, reviewedProfile);
  const deps = dependencies(values, async () => {
    throw new Error("must_not_run");
  });
  delete deps.runtimeProfileValidator;
  const result = await drainExactGovernedProductionPlan(
    request(values, {
      database_path: "D:\\pulse-data\\pulse.db",
      expected_runtime_profile_file_sha256: sha256(reviewedProfile),
    }),
    deps,
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_plan_open_database_path_mismatch"));
  assert.equal(
    result.blockers.some((blocker) =>
      blocker.startsWith("exact_plan_runtime_profile_invalid:"),
    ),
    false,
  );
});

test("Windows quiescence inspection reports listeners, Pulse owners, schedulers and enabled tasks without command lines", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    fileSystemSync: {
      existsSync: () => false,
    },
    execFileSyncImpl(executable, args) {
      assert.equal(executable, "powershell.exe");
      const source = args.at(-1);
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [4321],
        });
      }
      if (source.includes("Win32_Process")) {
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [
            {
              pid: 5000,
              name: "node.exe",
              command_line:
                "node C:\\Pulse\\pulse-gaming\\tools\\windows-local-runtime-supervisor.js ensure",
            },
            {
              pid: 5001,
              name: "node.exe",
              command_line: "node C:\\Pulse\\pulse-gaming\\server.js",
            },
            {
              pid: 5002,
              name: "node.exe",
              command_line: 'node "C:\\Pulse\\pulse-gaming\\run.js" full',
            },
            {
              pid: 5003,
              name: "node.exe",
              command_line: "node C:\\Pulse\\pulse-gaming\\publisher.js full",
            },
            {
              pid: 5004,
              name: "node.exe",
              command_line:
                "node C:\\Pulse\\pulse-gaming\\upload_youtube.js publish --token PROCESS_SECRET",
            },
            {
              pid: 5005,
              name: "node.exe",
              command_line:
                "node .\\workers\\local-worker.js --root C:\\Pulse\\pulse-gaming",
            },
            {
              pid: 5006,
              name: "powershell.exe",
              command_line:
                "powershell -File C:\\Pulse\\pulse-gaming\\tools\\local-live-watchdog.ps1",
            },
            {
              pid: 5007,
              name: "node.exe",
              command_line:
                "node C:\\Pulse\\pulse-gaming\\tools\\windows-ollama-watchdog.js ensure --profile governed_multi_lane",
            },
            {
              pid: 5008,
              name: "node.exe",
              command_line:
                "node C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js --workspace C:\\Pulse\\pulse-gaming --note run.js full",
            },
            {
              pid: 5009,
              name: "powershell.exe",
              command_line:
                "powershell -Command npx @wonderwhy-er/desktop-commander '&' node C:\\Pulse\\pulse-gaming\\run.js full",
            },
            {
              pid: 5010,
              name: "node.exe",
              command_line: "node server.js",
            },
            {
              pid: 5011,
              name: "node.exe",
              command_line: "node run.js full",
            },
            {
              pid: 5012,
              name: "node.exe",
              command_line: "node run.js publish",
            },
            {
              pid: 5013,
              name: "node.exe",
              command_line: "node run.js produce",
            },
            {
              pid: 5014,
              name: "node.exe",
              command_line: "node run.js schedule",
            },
            {
              pid: 5015,
              name: "node.exe",
              command_line:
                "node C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js --cwd C:\\Pulse\\pulse-gaming npm start",
            },
            {
              pid: 5016,
              name: "powershell.exe",
              command_line:
                "powershell -Command node C:\\Pulse\\pulse-gaming\\tools\\windows-ollama-watchdog.js ensure --profile governed_multi_lane ';' node -e \"require('./server')\"",
            },
            {
              pid: 5017,
              name: "node.exe",
              command_line:
                '"node" "C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js" remote',
            },
            {
              pid: 5018,
              name: "powershell.exe",
              command_line:
                'powershell -Command "node C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js $(node -e \\\"require(\'./server\')\\\")"',
            },
            {
              pid: 5019,
              name: "node.exe",
              command_line:
                "node C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js remote\nnode -e \"require('./server')\"",
            },
            {
              pid: 5020,
              name: "cmd.exe",
              command_line:
                'C:\\Windows\\System32\\cmd.exe /c ""C:\\Program Files\\nodejs\\npx.cmd" --yes @wonderwhy-er/desktop-commander@0.2.46 remote "',
            },
            {
              pid: 5021,
              name: "node.exe",
              command_line:
                '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" --yes @wonderwhy-er/desktop-commander@0.2.46 remote',
            },
            {
              pid: 5022,
              name: "cmd.exe",
              command_line:
                "C:\\Windows\\System32\\cmd.exe /d /s /c desktop-commander remote",
            },
            {
              pid: 5023,
              name: "powershell.exe",
              command_line:
                "powershell.exe -EncodedCommand SECRET_BASE64_PAYLOAD",
            },
            {
              pid: 5024,
              name: "cmd.exe",
              command_line: "cmd.exe /c powershell -enc:SECRET_BASE64_PAYLOAD",
            },
            {
              pid: 5025,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                "powershell.exe –EncodedCommand UNICODE_PROCESS_SECRET",
            },
            {
              pid: 5026,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                "powershell.exe —EncodedCommand UNICODE_EM_DASH_SECRET",
            },
            {
              pid: 5027,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line: "powershell.exe ―EncodedCommand UNICODE_BAR_SECRET",
            },
            {
              pid: 5028,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                'powershell.exe "-EncodedCommand" QUOTED_SWITCH_SECRET',
            },
            {
              pid: 5029,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line: 'powershell.exe "–enc" QUOTED_UNICODE_SECRET',
            },
            {
              pid: 5030,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                'powershell.exe "-"EncodedCommand SPLIT_QUOTE_1_SECRET',
            },
            {
              pid: 5031,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                'powershell.exe -Enc"odedCommand" SPLIT_QUOTE_2_SECRET',
            },
            {
              pid: 5032,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                'powershell.exe -Encoded"Command" SPLIT_QUOTE_3_SECRET',
            },
            {
              pid: 5033,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line:
                'powershell.exe "-Enc"odedCommand SPLIT_QUOTE_4_SECRET',
            },
            {
              pid: 5034,
              name: "cmd.exe",
              executable_path: "C:\\Windows\\System32\\cmd.exe",
              command_line:
                "cmd.exe /c powershell.exe -Enc^odedCommand CARET_SWITCH_SECRET",
            },
            {
              pid: 6000,
              name: "node.exe",
              command_line: "node C:\\Other\\server.js",
            },
          ],
        });
      }
      if (source.includes("Schedule.Service")) {
        assert.match(source, /GetTasks\(1\)/);
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [
            {
              TaskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
              TaskPath: "\\PulseGaming-LiveGuarded-YouTube-Runtime",
              State: "Ready",
              Enabled: true,
              Hidden: false,
              Actions: [],
            },
            {
              TaskName: "PulseGaming-Stabilisation-Runtime",
              TaskPath: "\\PulseGaming-Stabilisation-Runtime",
              State: 4,
              Enabled: false,
              Hidden: false,
              Actions: [],
            },
            {
              TaskName: "PulseGaming-LiveWatchdog-Supervisor",
              TaskPath: "\\Legacy\\PulseGaming-LiveWatchdog-Supervisor",
              State: 3,
              Enabled: true,
              Hidden: false,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments:
                    "-File C:\\Pulse\\pulse-gaming\\tools\\local-live-watchdog.ps1",
                  WorkingDirectory: "C:\\Pulse\\pulse-gaming",
                },
              ],
            },
            {
              TaskName: "Custom-Hidden-Pulse-Wrapper",
              TaskPath: "\\Custom\\Custom-Hidden-Pulse-Wrapper",
              State: 2,
              Enabled: false,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: "-EncodedCommand TASK_SECRET",
                  WorkingDirectory: "C:\\Pulse\\pulse-gaming",
                },
              ],
            },
            {
              TaskName: "PulseGaming-Ollama-Watchdog",
              TaskPath: "\\PulseGaming-Ollama-Watchdog",
              State: 3,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "node.exe",
                  Arguments:
                    "C:\\Pulse\\pulse-gaming\\tools\\windows-ollama-watchdog.js ensure --profile governed_multi_lane",
                  WorkingDirectory: "C:\\Pulse\\pulse-gaming",
                },
              ],
            },
            {
              TaskName: "Desktop-Commander-Bridge",
              TaskPath: "\\Tools\\Desktop-Commander-Bridge",
              State: 3,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "node.exe",
                  Arguments:
                    "C:\\cache\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js",
                  WorkingDirectory: "C:\\Pulse\\pulse-gaming",
                },
              ],
            },
            {
              TaskName: "Opaque-Maintenance",
              TaskPath: "\\Hidden\\Opaque-Maintenance",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: "-EnCo SECRET_TASK_PAYLOAD",
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Unicode-Maintenance",
              TaskPath: "\\Hidden\\Opaque-Unicode-Maintenance",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: "–EncodedCommand UNICODE_TASK_SECRET",
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Unicode-Em-Dash",
              TaskPath: "\\Hidden\\Opaque-Unicode-Em-Dash",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: "—EncodedCommand UNICODE_EM_TASK_SECRET",
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Unicode-Horizontal-Bar",
              TaskPath: "\\Hidden\\Opaque-Unicode-Horizontal-Bar",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: "―EncodedCommand UNICODE_BAR_TASK_SECRET",
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Encoded-Switch",
              TaskPath: "\\Hidden\\Opaque-Quoted-Encoded-Switch",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '"-EncodedCommand" QUOTED_TASK_SWITCH_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Unicode-Switch",
              TaskPath: "\\Hidden\\Opaque-Quoted-Unicode-Switch",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '"–enc" QUOTED_UNICODE_TASK_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Split-1",
              TaskPath: "\\Hidden\\Opaque-Quoted-Split-1",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '"-"EncodedCommand SPLIT_TASK_1_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Split-2",
              TaskPath: "\\Hidden\\Opaque-Quoted-Split-2",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '-Enc"odedCommand" SPLIT_TASK_2_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Split-3",
              TaskPath: "\\Hidden\\Opaque-Quoted-Split-3",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '-Encoded"Command" SPLIT_TASK_3_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Quoted-Split-4",
              TaskPath: "\\Hidden\\Opaque-Quoted-Split-4",
              State: 4,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "powershell.exe",
                  Arguments: '"-Enc"odedCommand SPLIT_TASK_4_SECRET',
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
            {
              TaskName: "Opaque-Caret-Encoded-Switch",
              TaskPath: "\\Hidden\\Opaque-Caret-Encoded-Switch",
              State: 3,
              Enabled: true,
              Hidden: true,
              Actions: [
                {
                  Type: 0,
                  Execute: "cmd.exe",
                  Arguments:
                    "/c powershell.exe -Enc^odedCommand CARET_TASK_SECRET",
                  WorkingDirectory: "C:\\Other",
                },
              ],
            },
          ],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.deepEqual(result.probe_attestations, {
    listeners: true,
    processes: true,
    scheduled_tasks: true,
  });
  assert.deepEqual(result.listener_pids, [4321]);
  assert.deepEqual(
    result.owner_pids,
    [
      5000, 5001, 5002, 5003, 5004, 5005, 5006, 5008, 5009, 5010, 5011, 5012,
      5013, 5014, 5015, 5016, 5018, 5019, 5023, 5024, 5025, 5026, 5027, 5028,
      5029, 5030, 5031, 5032, 5033, 5034,
    ],
  );
  assert.deepEqual(
    result.scheduler_process_pids,
    [5001, 5002, 5005, 5006, 5008, 5009, 5010, 5011, 5012, 5013, 5014, 5015],
  );
  assert.deepEqual(result.enabled_tasks, [
    "PulseGaming-LiveGuarded-YouTube-Runtime",
    "\\Hidden\\Opaque-Caret-Encoded-Switch",
    "\\Hidden\\Opaque-Maintenance",
    "\\Hidden\\Opaque-Quoted-Encoded-Switch",
    "\\Hidden\\Opaque-Quoted-Split-1",
    "\\Hidden\\Opaque-Quoted-Split-2",
    "\\Hidden\\Opaque-Quoted-Split-3",
    "\\Hidden\\Opaque-Quoted-Split-4",
    "\\Hidden\\Opaque-Quoted-Unicode-Switch",
    "\\Hidden\\Opaque-Unicode-Em-Dash",
    "\\Hidden\\Opaque-Unicode-Horizontal-Bar",
    "\\Hidden\\Opaque-Unicode-Maintenance",
    "\\Legacy\\PulseGaming-LiveWatchdog-Supervisor",
    "\\Tools\\Desktop-Commander-Bridge",
  ]);
  assert.deepEqual(result.running_tasks, [
    "PulseGaming-Stabilisation-Runtime",
    "\\Custom\\Custom-Hidden-Pulse-Wrapper",
    "\\Hidden\\Opaque-Maintenance",
    "\\Hidden\\Opaque-Quoted-Encoded-Switch",
    "\\Hidden\\Opaque-Quoted-Split-1",
    "\\Hidden\\Opaque-Quoted-Split-2",
    "\\Hidden\\Opaque-Quoted-Split-3",
    "\\Hidden\\Opaque-Quoted-Split-4",
    "\\Hidden\\Opaque-Quoted-Unicode-Switch",
    "\\Hidden\\Opaque-Unicode-Em-Dash",
    "\\Hidden\\Opaque-Unicode-Horizontal-Bar",
    "\\Hidden\\Opaque-Unicode-Maintenance",
  ]);
  const serialised = JSON.stringify(result);
  for (const sensitive of [
    "PROCESS_SECRET",
    "TASK_SECRET",
    "UNICODE_PROCESS_SECRET",
    "UNICODE_TASK_SECRET",
    "UNICODE_EM_DASH_SECRET",
    "UNICODE_EM_TASK_SECRET",
    "UNICODE_BAR_SECRET",
    "UNICODE_BAR_TASK_SECRET",
    "QUOTED_SWITCH_SECRET",
    "QUOTED_TASK_SWITCH_SECRET",
    "QUOTED_UNICODE_SECRET",
    "QUOTED_UNICODE_TASK_SECRET",
    "SPLIT_QUOTE_1_SECRET",
    "SPLIT_QUOTE_2_SECRET",
    "SPLIT_QUOTE_3_SECRET",
    "SPLIT_QUOTE_4_SECRET",
    "SPLIT_TASK_1_SECRET",
    "SPLIT_TASK_2_SECRET",
    "SPLIT_TASK_3_SECRET",
    "SPLIT_TASK_4_SECRET",
    "CARET_SWITCH_SECRET",
    "CARET_TASK_SECRET",
    "command_line",
    "Arguments",
    "WorkingDirectory",
    "Actions",
  ]) {
    assert.equal(serialised.includes(sensitive), false);
  }
});

test("the Codex parser exemption requires the authoritative canonical PowerShell process identity", () => {
  const canonical = {
    name: "powershell.exe",
    executable_path:
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  };

  assert.equal(isCanonicalCodexPowerShellProcessIdentity(canonical), true);
  assert.equal(
    isCanonicalCodexPowerShellProcessIdentity({
      ...canonical,
      name: "node.exe",
    }),
    false,
  );
  assert.equal(
    isCanonicalCodexPowerShellProcessIdentity({
      ...canonical,
      executable_path: "C:\\Temp\\powershell.exe",
    }),
    false,
  );
  assert.equal(
    isCanonicalCodexPowerShellProcessIdentity({
      ...canonical,
      executable_path:
        "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe",
    }),
    false,
  );
  assert.equal(
    isCanonicalCodexPowerShellProcessIdentity({
      ...canonical,
      executable_path: "",
    }),
    false,
  );
});

test("an expired transition fence stays exclusive and its exact live participant recovers after a non-cooperative handler", async (t) => {
  const values = await fixture(t);
  let competingBlocked = false;
  const runtimeTransitionLeaseFactory = () => ({
    leases: values.runtimeLeases,
    close() {},
  });
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        assert.throws(
          () =>
            acquireLiveRuntimeTransitionLease({
              databasePath: values.databasePath,
              ownerId: "live-start:competitor",
              action: "live-start",
              leaseMs: 1000,
              runtimeTransitionLeaseFactory,
            }),
          /live_runtime_transition_lease_unavailable/,
        );
        competingBlocked = true;
        return greenProductionResult();
      },
      {
        transitionLeaseAcquirer(options) {
          return acquireLiveRuntimeTransitionLease({
            ...options,
            leaseMs: 200,
          });
        },
      },
    ),
  );

  assert.equal(competingBlocked, true);
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    true,
  );
});

test("Windows quiescence fails closed when a script-capable host command line is unavailable", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const inspect = (processes) =>
    inspectWindowsPulseQuiescence({
      platform: "win32",
      profile,
      workspaceRoot: "C:\\Pulse\\pulse-gaming",
      fileSystemSync: { existsSync: () => false },
      execFileSyncImpl(_executable, args) {
        const source = args.at(-1);
        if (source.includes("Get-NetTCPConnection")) {
          return JSON.stringify({
            probe: "listeners",
            attested: true,
            items: [],
          });
        }
        if (source.includes("Win32_Process")) {
          return JSON.stringify({
            probe: "processes",
            attested: true,
            items: processes,
          });
        }
        if (source.includes("Schedule.Service")) {
          return JSON.stringify({
            probe: "scheduled_tasks",
            attested: true,
            items: [],
          });
        }
        throw new Error("unexpected inspection command");
      },
    });

  for (const [index, name] of [
    "node.exe",
    "powershell.exe",
    "pwsh.exe",
    "cmd.exe",
    "wscript.exe",
    "cscript.exe",
  ].entries()) {
    const result = inspect([
      {
        pid: 7000 + index,
        name,
        executable_path: `C:\\Windows\\System32\\${name}`,
        command_line: null,
      },
    ]);
    assert.equal(result.available, false, name);
  }
});

test("Windows quiescence discards an absent ambiguous script-host PID after one targeted recheck", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const processProbeSources = [];
  const probeOrder = [];
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    fileSystemSync: { existsSync: () => false },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-CimInstance Win32_Process")) {
        processProbeSources.push(source);
        if (source.includes("ProcessId = 701")) {
          probeOrder.push("process_by_pid");
          return JSON.stringify({
            probe: "process_by_pid",
            attested: true,
            items: [],
          });
        }
        probeOrder.push("processes");
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [
            {
              pid: 701,
              name: "powershell.exe",
              executable_path:
                "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
              command_line: null,
            },
          ],
        });
      }
      if (source.includes("Get-NetTCPConnection")) {
        probeOrder.push("listeners");
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Schedule.Service")) {
        probeOrder.push("scheduled_tasks");
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, true);
  assert.deepEqual(result.probe_attestations, {
    listeners: true,
    processes: true,
    scheduled_tasks: true,
  });
  assert.equal(processProbeSources.length, 2);
  assert.match(processProbeSources[1], /ProcessId = 701/);
  assert.deepEqual(probeOrder, [
    "processes",
    "process_by_pid",
    "scheduled_tasks",
    "listeners",
  ]);
});

test("a refreshed same-PID Pulse process holds the drain as a live owner", async (t) => {
  const values = await fixture(t);
  const roles = [];
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async (job) => {
        roles.push(job.payload.autonomous_production_job.builder_result.role);
        return greenProductionResult();
      },
      {
        quiescenceInspector: ({ profile, workspaceRoot, expectedCommit }) =>
          inspectWindowsPulseQuiescence({
            platform: "win32",
            profile,
            workspaceRoot,
            expectedCommit,
            fileSystemSync: { existsSync: () => false },
            execFileSyncImpl(_executable, args) {
              const source = args.at(-1);
              if (source.includes("Get-CimInstance Win32_Process")) {
                if (source.includes("ProcessId = 703")) {
                  return JSON.stringify({
                    probe: "process_by_pid",
                    attested: true,
                    items: [
                      {
                        pid: 703,
                        name: "node.exe",
                        executable_path: "C:\\Program Files\\nodejs\\node.exe",
                        command_line:
                          '"C:\\Program Files\\nodejs\\node.exe" "C:\\Pulse\\pulse-gaming\\run.js" schedule',
                      },
                    ],
                  });
                }
                return JSON.stringify({
                  probe: "processes",
                  attested: true,
                  items: [
                    {
                      pid: 703,
                      name: "node.exe",
                      executable_path: "C:\\Program Files\\nodejs\\node.exe",
                      command_line: null,
                    },
                  ],
                });
              }
              if (source.includes("Get-NetTCPConnection")) {
                return JSON.stringify({
                  probe: "listeners",
                  attested: true,
                  items: [],
                });
              }
              if (source.includes("Schedule.Service")) {
                return JSON.stringify({
                  probe: "scheduled_tasks",
                  attested: true,
                  items: [],
                });
              }
              throw new Error("unexpected inspection command");
            },
          }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_plan_live_runtime_not_quiescent"));
  assert.deepEqual(roles, []);
  assert.deepEqual(result.runtime_quiescence.checks[0].owner_pids, [703]);
});

test("Windows quiescence fails closed when a targeted recheck reports a different PID", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    fileSystemSync: { existsSync: () => false },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-CimInstance Win32_Process")) {
        if (source.includes("ProcessId = 704")) {
          return JSON.stringify({
            probe: "process_by_pid",
            attested: true,
            items: [
              {
                pid: 705,
                name: "node.exe",
                executable_path: "C:\\Program Files\\nodejs\\node.exe",
                command_line: "node.exe harmless.js",
              },
            ],
          });
        }
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [
            {
              pid: 704,
              name: "node.exe",
              executable_path: "C:\\Program Files\\nodejs\\node.exe",
              command_line: null,
            },
          ],
        });
      }
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.probe_attestations, {
    listeners: false,
    processes: false,
    scheduled_tasks: false,
  });
});

test("Windows quiescence holds when a targeted script-host recheck remains ambiguous", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const processProbeSources = [];
  const ambiguousRow = {
    pid: 702,
    name: "node.exe",
    executable_path: "C:\\Program Files\\nodejs\\node.exe",
    command_line: null,
  };
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    fileSystemSync: { existsSync: () => false },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-CimInstance Win32_Process")) {
        processProbeSources.push(source);
        if (source.includes("ProcessId = 702")) {
          return JSON.stringify({
            probe: "process_by_pid",
            attested: true,
            items: [ambiguousRow],
          });
        }
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [ambiguousRow],
        });
      }
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.probe_attestations, {
    listeners: false,
    processes: false,
    scheduled_tasks: false,
  });
  assert.equal(processProbeSources.length, 2);
  assert.match(processProbeSources[1], /ProcessId = 702/);
});

test("Windows quiescence binds the canonical owner receipt supervisor and child PIDs", { skip: process.platform !== "win32" }, () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    expectedCommit: EXPECTED_COMMIT,
    fileSystemSync: {
      existsSync: (candidate) => candidate === ownerPath,
      lstatSync: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
      }),
      realpathSync: (candidate) => candidate,
      readFileSync: () =>
        JSON.stringify({
          schema_version: "pulse-windows-live-guarded-owner-v1",
          generated_at: GENERATED_AT,
          supervisor_pid: 8100,
          supervisor_process_started_at: GENERATED_AT,
          child_pid: 8101,
          child_process_started_at: GENERATED_AT,
          port: 3001,
          repo_root: "C:/Pulse/pulse-gaming",
          commit_sha: EXPECTED_COMMIT,
          profile_sha256: profileFingerprint(profile),
          activation_receipt_sha256: "b".repeat(64),
          start_operation_nonce: null,
          platform: "youtube",
        }),
    },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Win32_Process")) {
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [
            {
              pid: 8100,
              name: "codex.exe",
              command_line: "codex safe-supervisor",
            },
            {
              pid: 8101,
              name: "other.exe",
              command_line: "other safe-child",
            },
          ],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, true);
  assert.deepEqual(result.owner_pids, [8100, 8101]);
});

test("Windows quiescence fails closed on an unbound canonical owner receipt", { skip: process.platform !== "win32" }, () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    expectedCommit: EXPECTED_COMMIT,
    fileSystemSync: {
      existsSync: (candidate) => candidate === ownerPath,
      lstatSync: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
      }),
      realpathSync: (candidate) => candidate,
      readFileSync: () => "{}",
    },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Win32_Process")) {
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.owner_pids, []);
});

test("Windows quiescence is unavailable when any independent probe lacks an affirmative attestation", () => {
  const profile = {
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
  };
  const result = inspectWindowsPulseQuiescence({
    platform: "win32",
    profile,
    workspaceRoot: "C:\\Pulse\\pulse-gaming",
    fileSystemSync: {
      existsSync: () => false,
    },
    execFileSyncImpl(_executable, args) {
      const source = args.at(-1);
      if (source.includes("Get-NetTCPConnection")) {
        return JSON.stringify({
          probe: "listeners",
          attested: false,
          items: [],
        });
      }
      if (source.includes("Win32_Process")) {
        return JSON.stringify({
          probe: "processes",
          attested: true,
          items: [],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [],
          absent_task_names: [
            "PulseGaming-LiveGuarded-YouTube-Runtime",
            "PulseGaming-Stabilisation-Runtime",
          ],
        });
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.probe_attestations, {
    listeners: false,
    processes: false,
    scheduled_tasks: false,
  });
});

test("final queue drift is rejected before a GREEN evidence commit is published", async (t) => {
  const values = await fixture(t);
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      beforeEvidenceFinalise() {
        values.jobs.enqueue({
          kind: "produce_breaking_short",
          channel_id: "pulse-gaming",
          story_id: "db-extra",
          payload: {
            lane_id: "breaking_short",
            story_id: "story-extra",
          },
          priority: 1,
          run_at: GENERATED_AT,
          max_attempts: 3,
          idempotency_key: "extra-breaking-job-at-final-boundary",
        });
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("exact_plan_active_breaking_job_set_mismatch"),
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );
});

test("final predecessor binding drift is rejected before a GREEN evidence commit is published", async (t) => {
  const values = await fixture(t);
  const { predecessor } = await createTimedSuccessor(values);
  const predecessorJobId = predecessor.plan.production_jobs[0].job_id;

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      beforeEvidenceFinalise() {
        values.db
          .prepare("UPDATE jobs SET max_attempts = 99 WHERE id = ?")
          .run(predecessorJobId);
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "exact_plan_lineage_predecessor_job_binding_mismatch",
    ),
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );
});

test("the final evidence commit is published while an authoritative database write lock is held", async (t) => {
  const values = await fixture(t);
  const primaryJobId = values.planned.plan.production_jobs[0].job_id;
  const competingDatabase = new Database(values.databasePath);
  competingDatabase.pragma("busy_timeout = 1");
  let competingWriteCode = null;
  let commitLinkObserved = false;
  const fileSystem = new Proxy(fs.promises, {
    get(target, property, receiver) {
      if (property === "link") {
        return async (sourcePath, destinationPath) => {
          if (
            String(destinationPath).endsWith("exact-plan-drain.commit.json")
          ) {
            commitLinkObserved = true;
            try {
              competingDatabase
                .prepare("UPDATE jobs SET max_attempts = 99 WHERE id = ?")
                .run(primaryJobId);
            } catch (error) {
              competingWriteCode = error?.code || null;
            }
          }
          return target.link(sourcePath, destinationPath);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  let result;
  try {
    result = await drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), {
        fileSystem,
      }),
    );
  } finally {
    if (competingDatabase.open) competingDatabase.close();
  }

  assert.equal(result.verdict, "GREEN");
  assert.equal(commitLinkObserved, true);
  assert.equal(competingWriteCode, "SQLITE_BUSY");
  assert.equal(values.jobs.get(primaryJobId).max_attempts, 3);
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    true,
  );
});
