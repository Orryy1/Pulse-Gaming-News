"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Database = require("better-sqlite3");
const { bind: bindJobs } = require("../../lib/repositories/jobs");
const {
  RUNTIME_POLICY_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  CANDIDATE_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION: PLANNER_REQUEST_SCHEMA_VERSION,
  planGovernedAutonomousWindowProduction,
} = require("../../lib/services/governed-autonomous-window-production-planner");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  inspectExactGovernedPlanQuarantineBindings,
} = require("../../lib/ops/governed-exact-production-plan-drain");
const {
  acquireLiveRuntimeTransitionLease,
  DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");
const {
  inspectLiveDatabaseIdentity,
} = require("../../lib/stabilisation/windows-live-guarded-runtime");

const {
  QUARANTINE_REQUEST_SCHEMA_VERSION,
  quarantineExactGovernedProductionPlan,
  safeBlocker,
} = require("../../lib/ops/governed-exact-plan-quarantine");

const NOW = "2026-08-01T11:35:00.000Z";
const COMMIT = "8cb587bcdaa8590181b5aec71fddbf2385d59783";
const PLAN_SHA = "c".repeat(64);
const PLAN_FILE_SHA = "d".repeat(64);
const RESERVATION_FILE_SHA = "e".repeat(64);
const RESERVATION_SHA = "f".repeat(64);
const TASK_NAME = "PulseGaming-Fixture";
const CONFLICTING_TASK_NAME = "PulseGaming-Fixture-Predecessor";
const BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1";
const AUTHORITY_FINGERPRINT = "9".repeat(64);
const OBSERVATION_SHA256 = "8".repeat(64);
const DATABASE_SNAPSHOT_SHA256 = "7".repeat(64);

function hash(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function canonicalBackupEvidence({ dbPath, backup, restore, root }) {
  const passed = {
    openedReadOnly: true,
    quick_check: "ok",
    integrity_check: "ok",
    foreign_key_check: "ok",
    foreign_key_violation_count: 0,
  };
  const backupVerificationFile = path.join(root, "backup.verification.json");
  const restoreRehearsalFile = path.join(root, "restore.rehearsal.json");
  fs.writeFileSync(backupVerificationFile, "{}\n");
  fs.writeFileSync(restoreRehearsalFile, "{}\n");
  return {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: "backup-1",
    backup_path: backup,
    backup_sha256: hash(backup),
    source_database_path: dbPath,
    source_database_sha256: hash(dbPath),
    verified_at: NOW,
    verified_by: "test-operator",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
    quick_check: "ok",
    restore_path: restore,
    restore_sha256: hash(restore),
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
      backup_verified_at: NOW,
      restore_rehearsal_file: restoreRehearsalFile,
      restore_rehearsal_schema: "pulse-restore-rehearsal-v1",
      restore_verified_at: NOW,
    },
  };
}

function refreshBackup(v) {
  fs.copyFileSync(v.dbPath, v.backup);
  fs.copyFileSync(v.backup, v.restore);
  const evidence = JSON.parse(fs.readFileSync(v.evidence));
  evidence.backup_sha256 = hash(v.backup);
  evidence.restore_sha256 = hash(v.restore);
  evidence.source_database_sha256 = hash(v.dbPath);
  fs.writeFileSync(v.evidence, JSON.stringify(evidence));
}

function fixtureExecutorModule(root) {
  const modulePath = path.join(
    root,
    "lib",
    "ops",
    "governed-exact-plan-quarantine.js",
  );
  fs.mkdirSync(path.dirname(modulePath), { recursive: true });
  fs.writeFileSync(modulePath, "// fixture executor module\n");
  const entrypointPath = path.join(
    root,
    "tools",
    "governed-exact-plan-quarantine.js",
  );
  fs.mkdirSync(path.dirname(entrypointPath), { recursive: true });
  fs.writeFileSync(entrypointPath, "// fixture executor entrypoint\n");
  return { modulePath, entrypointPath };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-quarantine-v2-"));
  const executorFiles = fixtureExecutorModule(root);
  const dbPath = path.join(root, "pulse.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, kind TEXT, channel_id TEXT, story_id TEXT, payload TEXT, status TEXT, priority INTEGER, run_at TEXT, attempt_count INTEGER, max_attempts INTEGER, last_error TEXT, claimed_by TEXT, claimed_at TEXT, lease_until TEXT, requires_gpu INTEGER, idempotency_key TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT);
    CREATE TABLE job_runs (id INTEGER PRIMARY KEY, job_id INTEGER, worker_id TEXT, attempt INTEGER, status TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER, error_message TEXT, log_excerpt TEXT);
    CREATE TABLE operator_audit_log (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, decision TEXT, reason TEXT, evidence_json TEXT, created_at TEXT, idempotency_key TEXT UNIQUE);
    CREATE TABLE runtime_leases (name TEXT PRIMARY KEY, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL, metadata TEXT);
    CREATE TABLE platform_dispatch_ledger (story_id TEXT); CREATE TABLE platform_publication_state (story_id TEXT); CREATE TABLE publication_lifecycle_events (story_id TEXT); CREATE TABLE platform_posts (story_id TEXT); CREATE TABLE publication_authority_audit_log (story_id TEXT);
  `);
  const primary = {
    job_id: 135780,
    kind: "produce_breaking_short",
    channel_id: "pulse-gaming",
    story_id: "official-primary",
    database_story_id: "db-primary",
    role: "PRIMARY",
    idempotency_key: "primary-key",
    builder_sha256: "1".repeat(64),
  };
  const standby = {
    job_id: 135781,
    kind: "produce_breaking_short",
    channel_id: "pulse-gaming",
    story_id: "official-standby",
    database_story_id: "db-standby",
    role: "STANDBY",
    idempotency_key: "standby-key",
    builder_sha256: "2".repeat(64),
  };
  const payload = (story, revision) =>
    JSON.stringify({
      lane_id: "breaking_short",
      story_id: story,
      candidate_revision_sha256: revision,
      autonomous_production_job: {
        schema_version: "pulse-governed-autonomous-production-job-payload-v1",
        builder_result: {},
      },
    });
  db.prepare(
    "INSERT INTO jobs VALUES (135780,'produce_breaking_short','pulse-gaming','db-primary',?,'failed',10,'2026-07-30 21:56:40',3,3,'redacted',NULL,NULL,NULL,0,'primary-key','2026-07-30','2026-08-01',NULL)",
  ).run(payload(primary.story_id, "a".repeat(64)));
  db.prepare(
    "INSERT INTO jobs VALUES (135781,'produce_breaking_short','pulse-gaming','db-standby',?,'pending',11,'2026-07-30 21:56:41',0,3,NULL,NULL,NULL,NULL,0,'standby-key','2026-07-30','2026-07-30',NULL)",
  ).run(payload(standby.story_id, "b".repeat(64)));
  for (let attempt = 1; attempt <= 3; attempt += 1)
    db.prepare("INSERT INTO job_runs VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      attempt,
      135780,
      "worker",
      attempt,
      "failed",
      "2026-08-01 10:00:00",
      "2026-08-01 10:01:00",
      1,
      "redacted",
      null,
    );
  const plan = path.join(root, "plan.json");
  const profile = path.join(root, "profile.json");
  const receipt = path.join(root, "activation-receipt.json");
  fs.writeFileSync(plan, "{}");
  fs.writeFileSync(
    profile,
    JSON.stringify({
      task_name: TASK_NAME,
      conflicting_task_names: [CONFLICTING_TASK_NAME],
      activation_receipt_path: receipt,
    }),
  );
  const backup = path.join(root, "backup.db");
  const restore = path.join(root, "restore.db");
  db.close();
  fs.copyFileSync(dbPath, backup);
  fs.copyFileSync(backup, restore);
  const evidence = path.join(root, "backup-evidence.json");
  fs.writeFileSync(
    evidence,
    JSON.stringify(canonicalBackupEvidence({ dbPath, backup, restore, root })),
  );
  const reopened = new Database(dbPath);
  t.after(() => {
    try {
      reopened.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    db: reopened,
    dbPath,
    plan,
    profile,
    receipt,
    backup,
    restore,
    evidence,
    executorModulePath: executorFiles.modulePath,
    executorEntrypointPath: executorFiles.entrypointPath,
    primary,
    standby,
  };
}

function validCandidate(workspaceRoot, storyId, databaseStoryId, score) {
  const finalScript = `${storyId} is a confirmed official gaming update with one clear player consequence.`;
  const inventoryFileSha256 = crypto
    .createHash("sha256")
    .update(`${storyId}:inventory`)
    .digest("hex");
  const canonicalIdentityUrl = `https://news.xbox.com/en-us/2026/07/30/${storyId}/`;
  const sha = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  return {
    schema_version: CANDIDATE_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    source_type: "official",
    verification_status: "CONFIRMED",
    eligibility_verdict: "GREEN",
    source_evidence_sha256: sha(`${storyId}:source`),
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
          final_script_sha256: sha(finalScript),
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
        final_script_sha256: sha(finalScript),
        script_claim_bindings: [
          { claim_key: `${storyId}:claim`, source_index: 0 },
        ],
        presentation_claim_bindings: [
          { claim_key: `${storyId}:claim`, scene_index: 0 },
        ],
        supplemental_official_sources: [],
        contract: { editorial_lane_id: "breaking_short" },
        freshness: { publish_by: "2026-07-30T12:00:00.000Z" },
        visual_brief: { format: "game_native_news" },
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
      generated_at: "2026-07-30T07:20:00.000Z",
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
      safety: {
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
      },
    },
    candidate_revision_sha256: sha(`${storyId}:revision`),
    request_fingerprint: sha(`${storyId}:request`),
  };
}

async function realBindingFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-real-quarantine-"));
  const executorFiles = fixtureExecutorModule(root);
  const dbPath = path.join(root, "pulse.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(
    `CREATE TABLE channels (id TEXT PRIMARY KEY); CREATE TABLE stories (id TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0); CREATE TABLE runtime_leases (name TEXT PRIMARY KEY, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL, metadata TEXT);`,
  );
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
  db.exec(
    "CREATE TABLE operator_audit_log (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT, target_type TEXT, target_id TEXT, decision TEXT, reason TEXT, evidence_json TEXT, created_at TEXT, idempotency_key TEXT UNIQUE); CREATE TABLE platform_dispatch_ledger (story_id TEXT); CREATE TABLE platform_publication_state (story_id TEXT); CREATE TABLE publication_lifecycle_events (story_id TEXT); CREATE TABLE platform_posts (story_id TEXT); CREATE TABLE publication_authority_audit_log (story_id TEXT);",
  );
  db.prepare("INSERT INTO channels VALUES ('pulse-gaming')").run();
  for (const id of ["db-primary", "db-standby"])
    db.prepare("INSERT INTO stories VALUES (?,0)").run(id);
  const plan = path.join(root, "production-plan.json");
  const reservation = path.join(root, "reservation.json");
  const planned = await planGovernedAutonomousWindowProduction(
    {
      schema_version: PLANNER_REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      generated_at: "2026-07-30T07:20:00.000Z",
      scheduled_for: "2026-07-30T09:00:00.000Z",
      workspace_root: root,
      reservation_output_path: reservation,
      plan_output_path: plan,
      candidates: [
        validCandidate(root, "story-primary", "db-primary", 120),
        validCandidate(root, "story-standby", "db-standby", 110),
      ],
    },
    { jobs: bindJobs(db) },
  );
  const [primary, standby] = planned.plan.production_jobs;
  db.prepare(
    "UPDATE jobs SET status='failed', attempt_count=3, claimed_by=NULL, claimed_at=NULL, lease_until=NULL WHERE id=?",
  ).run(primary.job_id);
  for (let attempt = 1; attempt <= 3; attempt += 1)
    db.prepare(
      "INSERT INTO job_runs (job_id,worker_id,attempt,status,started_at,finished_at,duration_ms,error_message) VALUES (?,? ,?,'failed','2026-07-30 10:00:00','2026-07-30 10:01:00',1,'failed')",
    ).run(primary.job_id, `worker-${attempt}`, attempt);
  const receipt = path.join(root, "state", "activation-receipt.json");
  const profile = path.join(root, "runtime-profile.json");
  fs.writeFileSync(
    profile,
    JSON.stringify({
      schema_version: "fixture-runtime-profile-v1",
      profile_id: "fixture",
      task_name: "PulseGaming-Fixture",
      conflicting_task_names: [],
      port: 3001,
      database_path: dbPath,
      state_root: path.join(root, "state"),
      activation_receipt_path: receipt,
      environment: {},
    }),
  );
  const backup = path.join(root, "backup.db");
  const restore = path.join(root, "restore.db");
  db.close();
  fs.copyFileSync(dbPath, backup);
  fs.copyFileSync(backup, restore);
  const evidence = path.join(root, "backup-evidence.json");
  fs.writeFileSync(
    evidence,
    JSON.stringify(canonicalBackupEvidence({ dbPath, backup, restore, root })),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath,
    plan,
    profile,
    receipt,
    backup,
    restore,
    evidence,
    executorModulePath: executorFiles.modulePath,
    executorEntrypointPath: executorFiles.entrypointPath,
    planned,
  };
}

function request(v, extra = {}) {
  return {
    schema_version: QUARANTINE_REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    maintenance_mode: "HUMAN_REVIEW",
    generated_at: NOW,
    apply: true,
    confirmation_id: "chg-1",
    change_id: "chg-1",
    operator_id: "operator-1",
    plan_path: v.plan,
    expected_plan_file_sha256: PLAN_FILE_SHA,
    expected_plan_sha256: PLAN_SHA,
    workspace_root: v.root,
    executor_workspace_root: v.root,
    database_path: v.dbPath,
    runtime_profile_path: v.profile,
    expected_runtime_profile_file_sha256: hash(v.profile),
    expected_checkout_commit: COMMIT,
    expected_executor_checkout_commit: COMMIT,
    expected_reservation_file_sha256: RESERVATION_FILE_SHA,
    expected_reservation_set_sha256: RESERVATION_SHA,
    expected_primary_job_id: 135780,
    expected_standby_job_id: 135781,
    expected_database_sha256: hash(v.dbPath),
    backup_evidence_path: v.evidence,
    expected_backup_evidence_file_sha256: hash(v.evidence),
    output_dir: path.join(v.root, "evidence"),
    ...extra,
  };
}

function realBindingRequest(v, extra = {}) {
  const [primary, standby] = v.planned.plan.production_jobs;
  return {
    schema_version: QUARANTINE_REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    maintenance_mode: "HUMAN_REVIEW",
    generated_at: NOW,
    apply: true,
    confirmation_id: "real-chg",
    change_id: "real-chg",
    operator_id: "operator-1",
    plan_path: v.plan,
    expected_plan_file_sha256: hash(v.plan),
    expected_plan_sha256: v.planned.plan.plan_sha256,
    workspace_root: v.root,
    executor_workspace_root: v.root,
    database_path: v.dbPath,
    runtime_profile_path: v.profile,
    expected_runtime_profile_file_sha256: hash(v.profile),
    expected_checkout_commit: COMMIT,
    expected_executor_checkout_commit: COMMIT,
    expected_reservation_file_sha256:
      v.planned.plan.reservation_set.file_sha256,
    expected_reservation_set_sha256:
      v.planned.plan.reservation_set.reservation_set_sha256,
    expected_primary_job_id: primary.job_id,
    expected_standby_job_id: standby.job_id,
    expected_database_sha256: hash(v.dbPath),
    backup_evidence_path: v.evidence,
    expected_backup_evidence_file_sha256: hash(v.evidence),
    output_dir: path.join(v.root, "evidence"),
    ...extra,
  };
}

function greenQuiescence(overrides = {}) {
  return {
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
    absent_task_names: [TASK_NAME, CONFLICTING_TASK_NAME],
    diagnostics: null,
    ...overrides,
  };
}

function exactDurableLease(v, options = {}) {
  return ({
    metadata,
    now,
    authorityContextSha256,
    authorityContextProvider,
  }) => {
    const ownerId = options.ownerId || "fixture-transition-owner";
    const acquiredAt = (options.acquiredAt || now).toISOString();
    const heartbeatAt = (options.heartbeatAt || now).toISOString();
    const leaseMs = options.leaseMs || DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS;
    const expiresAt = (
      options.expiresAt || new Date(now.getTime() + leaseMs)
    ).toISOString();
    const participantIdentity = Object.freeze({
      participant_id: "fixture-transition-participant",
      role: "owner",
      process_id: process.pid,
      process_started_at: NOW,
      process_start_source: "injected",
    });
    v.db
      .prepare(
        `INSERT INTO runtime_leases
         (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        LIVE_RUNTIME_TRANSITION_LEASE_NAME,
        ownerId,
        acquiredAt,
        heartbeatAt,
        expiresAt,
        JSON.stringify({
          transition_owner_schema_version:
            "pulse-live-runtime-transition-owner-v2",
          authority_context_sha256: authorityContextSha256,
          admission_state: "OPEN",
          context: { ...metadata },
          participants: [{ ...participantIdentity }],
        }),
      );
    return {
      owner_id: ownerId,
      lease_ms: leaseMs,
      participant_id: participantIdentity.participant_id,
      participant_identity: participantIdentity,
      authority_context_sha256: authorityContextSha256,
      assertCurrentAuthority() {
        const measured = authorityContextProvider();
        if (measured !== authorityContextSha256) {
          throw new Error("quarantine_lease_lost");
        }
        return measured;
      },
      renew() {
        return true;
      },
      release() {
        return (
          v.db
            .prepare("DELETE FROM runtime_leases WHERE name=? AND owner_id=?")
            .run(LIVE_RUNTIME_TRANSITION_LEASE_NAME, ownerId).changes === 1
        );
      },
    };
  };
}

function withForcedLeaseCleanup(v, lease) {
  return {
    ...lease,
    release() {
      v.db
        .prepare("DELETE FROM runtime_leases WHERE name=?")
        .run(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
      return true;
    },
  };
}

function mutateDurableLeaseParticipant(v, mutate) {
  const row = v.db
    .prepare("SELECT metadata FROM runtime_leases WHERE name=?")
    .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  const metadata = JSON.parse(row.metadata);
  mutate(metadata.participants[0]);
  v.db
    .prepare("UPDATE runtime_leases SET metadata=? WHERE name=?")
    .run(JSON.stringify(metadata), LIVE_RUNTIME_TRANSITION_LEASE_NAME);
}

function quarantineCommitExists(outputDir) {
  if (!fs.existsSync(outputDir)) return false;
  return fs
    .readdirSync(outputDir, { recursive: true })
    .some((entry) => String(entry).endsWith("quarantine.commit.json"));
}

async function testEvidenceDirectoryGuard() {
  let released = false;
  return {
    mode: "TEST_IDENTITY_BOUND",
    async assertBound() {
      return released === false;
    },
    async release() {
      released = true;
      return true;
    },
  };
}

async function commitWithoutEvidence(v, req = request(v)) {
  const pending = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      writeEvidence: async () => {
        throw new Error("fixture-write-failure");
      },
    }),
  );
  assert.equal(pending.status, "EVIDENCE_PENDING");
  assert.equal(quarantineCommitExists(req.output_dir), false);
  return req;
}

function deps(v, extra = {}) {
  let calls = 0;
  return {
    db: v.db,
    now: () => new Date(NOW),
    fs: fsp,
    inspectExecutor: () => ({ commit: COMMIT, tracked_clean: true }),
    executorModulePath: v.executorModulePath,
    executorEntrypointPath: v.executorEntrypointPath,
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_PRIMARY_INSTANCE: "false",
      PULSE_KILL_SWITCH: "true",
    },
    inspectBindings: async (input) => {
      calls += 1;
      const expected = input.expected_standby_status || "pending";
      const row = v.db.prepare("SELECT * FROM jobs WHERE id=135781").get();
      if (row.status !== expected)
        throw new Error("exact_plan_quarantine_standby_state_invalid");
      return {
        root: { path: v.root, real_path: v.root },
        plan: {
          plan_sha256: PLAN_SHA,
          scheduled_for: "2026-07-31T09:00:00.000Z",
          production_jobs: [v.primary, v.standby],
        },
        profile: {
          task_name: TASK_NAME,
          conflicting_task_names: [CONFLICTING_TASK_NAME],
          activation_receipt_path: v.receipt,
        },
        activation_receipt_path: v.receipt,
        workspace: { available: true, commit: COMMIT, tracked_clean: true },
        database: { path: v.dbPath, real_path: v.dbPath },
        reservation: {
          file_sha256: RESERVATION_FILE_SHA,
          reservation_set_sha256: RESERVATION_SHA,
        },
        jobs: [v.db.prepare("SELECT * FROM jobs WHERE id=135780").get(), row],
        job_runs: v.db
          .prepare(
            "SELECT * FROM job_runs WHERE job_id IN (135780,135781) ORDER BY id",
          )
          .all(),
      };
    },
    inspectQuiescence: greenQuiescence,
    acquireLease: exactDurableLease(v),
    acquireEvidenceDirectoryGuard: testEvidenceDirectoryGuard,
    get calls() {
      return calls;
    },
    ...extra,
  };
}

function realBindingDeps(v) {
  return {
    now: () => new Date(NOW),
    fs: fsp,
    inspectExecutor: () => ({ commit: COMMIT, tracked_clean: true }),
    executorModulePath: v.executorModulePath,
    executorEntrypointPath: v.executorEntrypointPath,
    workspaceInspector: () => ({
      available: true,
      commit: COMMIT,
      tracked_clean: true,
    }),
    runtimeProfileValidator: () => ({ valid: true, blockers: [] }),
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_PRIMARY_INSTANCE: "false",
      PULSE_KILL_SWITCH: "true",
    },
    inspectQuiescence: greenQuiescence,
    acquireEvidenceDirectoryGuard: testEvidenceDirectoryGuard,
  };
}

test("quarantines only the exact exhausted primary's standby and emits committed evidence", async (t) => {
  const v = fixture(t);
  const result = await quarantineExactGovernedProductionPlan(
    request(v),
    deps(v),
  );
  assert.equal(result.verdict, "QUARANTINED");
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135780").get().status,
    "failed",
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "cancelled",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM job_runs").get().count,
    3,
  );
  assert.equal(
    v.db.prepare("SELECT decision FROM operator_audit_log").get().decision,
    "QUARANTINED",
  );
  assert.equal(fs.existsSync(result.evidence.commit_path), true);
});

test("the loaded executor module and CLI entrypoint must belong to the attested checkout", async (t) => {
  const v = fixture(t);
  const otherRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-quarantine-other-executor-"),
  );
  const otherExecutor = fixtureExecutorModule(otherRoot);
  t.after(() => fs.rmSync(otherRoot, { recursive: true, force: true }));

  for (const mismatch of [
    { executorModulePath: otherExecutor.modulePath },
    { executorEntrypointPath: otherExecutor.entrypointPath },
  ]) {
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, mismatch),
        ),
      /quarantine_executor_workspace_mismatch/,
    );
  }
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("dry/no-authority requests cannot mutate", async (t) => {
  const v = fixture(t);
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v, { apply: false }),
        deps(v),
      ),
    /quarantine_explicit_apply_required/,
  );
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(request(v), deps(v, { env: {} })),
    /quarantine_authority_environment_invalid/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("payload history publication activation and quiescence drift fail closed", async (t) => {
  const v = fixture(t);
  for (const change of [
    () =>
      v.db.prepare("INSERT INTO platform_posts VALUES (?)").run("db-primary"),
    () => fs.writeFileSync(v.receipt, "active"),
  ]) {
    change();
    refreshBackup(v);
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
      /quarantine_(publication_state_present|activation_receipt_present)/,
    );
    if (fs.existsSync(v.receipt)) fs.unlinkSync(v.receipt);
    v.db.prepare("DELETE FROM platform_posts").run();
    refreshBackup(v);
  }
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { inspectQuiescence: async () => ({ available: false }) }),
      ),
    /quarantine_runtime_not_quiescent/,
  );
});

test("transaction audit failure and execute-time race roll back standby", async (t) => {
  const v = fixture(t);
  v.db.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON operator_audit_log BEGIN SELECT RAISE(ABORT, 'no'); END",
  );
  refreshBackup(v);
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
    /quarantine_apply_failed/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  v.db.exec("DROP TRIGGER reject_audit");
  refreshBackup(v);
  let inspected = 0;
  const d = deps(v, {
    inspectBindings: async (...args) => {
      inspected += 1;
      if (inspected === 2)
        v.db.prepare("UPDATE jobs SET claimed_by='race' WHERE id=135781").run();
      return deps(v).inspectBindings(...args);
    },
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_database_logical_state_mismatch/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("an activation receipt that appears inside the transaction aborts the exact quarantine", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  const d = deps(v, {
    inspectBindings: async (...args) => {
      inspections += 1;
      if (inspections === 2) fs.writeFileSync(v.receipt, "raced receipt");
      return deps(v).inspectBindings(...args);
    },
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_lease_release_failed/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("database hard-link races immediately before transaction and commit fail closed", async (t) => {
  await t.test("before transaction", async (t) => {
    const v = fixture(t);
    const acquireExactLease = exactDurableLease(v);
    const raceLease = (options) => {
      const lease = acquireExactLease(options);
      fs.linkSync(v.dbPath, path.join(v.root, "pre-transaction-link.db"));
      return lease;
    };
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, { acquireLease: raceLease }),
        ),
      /quarantine_lease_release_failed/,
    );
    assert.equal(
      v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
      "pending",
    );
  });

  await t.test("before commit", async (t) => {
    const v = fixture(t);
    let inspections = 0;
    const d = deps(v, {
      inspectBindings: async (...args) => {
        inspections += 1;
        if (inspections === 2)
          fs.linkSync(v.dbPath, path.join(v.root, "pre-commit-link.db"));
        return deps(v).inspectBindings(...args);
      },
    });
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(request(v), d),
      /quarantine_lease_release_failed/,
    );
    assert.equal(
      v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
      "pending",
    );
  });
});

test("backup sidecar mismatch and unsafe output reject before mutation", async (t) => {
  const v = fixture(t);
  fs.writeFileSync(`${v.backup}-wal`, "x");
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
    /quarantine_database_sidecar_present/,
  );
  fs.unlinkSync(`${v.backup}-wal`);
  fs.writeFileSync(path.join(v.root, "not-a-directory"), "x");
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v, { output_dir: path.join(v.root, "not-a-directory") }),
        deps(v),
      ),
    /quarantine_output_path_invalid/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("an intermediate output junction cannot create a fingerprint directory outside the workspace", async (t) => {
  const v = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-quarantine-output-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const linkedOutput = path.join(v.root, "linked-output");
  fs.symlinkSync(
    outside,
    linkedOutput,
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v, {
          output_dir: path.join(linkedOutput, "nested-evidence"),
        }),
        deps(v),
      ),
    /quarantine_output_path_invalid/,
  );

  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("backup and restore evidence containing a transition lease is rejected even when canonical digests match", async (t) => {
  const v = fixture(t);
  const insertLease = (file) => {
    const database = new Database(file);
    try {
      database
        .prepare(
          `INSERT INTO runtime_leases
             (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
           VALUES (?, 'stale-owner', ?, ?, ?, '{}')`,
        )
        .run(
          LIVE_RUNTIME_TRANSITION_LEASE_NAME,
          NOW,
          NOW,
          "2026-08-01T11:40:00.000Z",
        );
    } finally {
      database.close();
    }
  };
  insertLease(v.backup);
  insertLease(v.restore);
  const evidence = JSON.parse(fs.readFileSync(v.evidence));
  evidence.backup_sha256 = hash(v.backup);
  evidence.restore_sha256 = hash(v.restore);
  fs.writeFileSync(v.evidence, JSON.stringify(evidence));

  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v, {
          expected_backup_evidence_file_sha256: hash(v.evidence),
        }),
        deps(v),
      ),
    /quarantine_backup_transition_lease_present/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("hard-linked database, backup and backup-evidence inputs are rejected", async (t) => {
  await t.test("source database", async (t) => {
    const v = fixture(t);
    fs.linkSync(v.dbPath, path.join(v.root, "source-hard-link.db"));
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
      /quarantine_file_link_forbidden/,
    );
  });

  await t.test("backup database", async (t) => {
    const v = fixture(t);
    fs.linkSync(v.backup, path.join(v.root, "backup-hard-link.db"));
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
      /quarantine_file_link_forbidden/,
    );
  });

  await t.test("backup evidence", async (t) => {
    const v = fixture(t);
    fs.linkSync(v.evidence, path.join(v.root, "evidence-hard-link.json"));
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
      /quarantine_file_link_forbidden/,
    );
  });
});

test("an opened main database with a different file identity fails before mutation", async (t) => {
  const v = fixture(t);
  const otherPath = path.join(v.root, "other.db");
  fs.copyFileSync(v.dbPath, otherPath);
  const other = new Database(otherPath);
  try {
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, { db: other }),
        ),
      /quarantine_open_database_identity_mismatch/,
    );
  } finally {
    other.close();
  }
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("a pathname swap at lease acquisition cannot redirect the lease write", async (t) => {
  const v = fixture(t);
  const replacementPath = path.join(v.root, "lease-swap-replacement.db");
  fs.copyFileSync(v.backup, replacementPath);
  const replacement = new Database(replacementPath);
  replacement.exec(`
    CREATE TABLE lease_write_probe (writes INTEGER NOT NULL);
    INSERT INTO lease_write_probe VALUES (0);
    CREATE TRIGGER count_redirected_transition_lease
    AFTER INSERT ON runtime_leases
    BEGIN
      UPDATE lease_write_probe SET writes = writes + 1;
    END;
  `);
  replacement.close();

  const redirectAtAcquisition = (options) => {
    const lease = acquireLiveRuntimeTransitionLease({
      ...options,
      databasePath: replacementPath,
    });
    fs.linkSync(v.dbPath, path.join(v.root, "lease-swap-race-link.db"));
    return lease;
  };

  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { acquireLease: redirectAtAcquisition }),
      ),
    /quarantine_lease_release_failed/,
  );

  const replacementCheck = new Database(replacementPath, { readonly: true });
  try {
    assert.equal(
      replacementCheck.prepare("SELECT writes FROM lease_write_probe").get()
        .writes,
      0,
    );
    assert.equal(
      replacementCheck
        .prepare("SELECT COUNT(*) count FROM runtime_leases")
        .get().count,
      0,
    );
  } finally {
    replacementCheck.close();
  }
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM runtime_leases").get().count,
    1,
  );
});

test("unrelated database drift between backup proof and lease is rejected", async (t) => {
  const v = fixture(t);
  const acquireExactLease = exactDurableLease(v);
  const driftLease = (options) => {
    const lease = acquireExactLease(options);
    v.db.prepare("UPDATE jobs SET priority=priority+1 WHERE id=135780").run();
    return lease;
  };
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { acquireLease: driftLease }),
      ),
    /quarantine_database_logical_state_mismatch/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("schema objects and stable pragma drift after backup inspection fail closed", async (t) => {
  for (const [label, mutate] of [
    [
      "index",
      (db) => db.exec("CREATE INDEX raced_jobs_priority ON jobs(priority)"),
    ],
    [
      "view",
      (db) => db.exec("CREATE VIEW raced_jobs_view AS SELECT id FROM jobs"),
    ],
    [
      "trigger",
      (db) =>
        db.exec(
          "CREATE TRIGGER raced_jobs_trigger AFTER UPDATE ON jobs BEGIN SELECT 1; END",
        ),
    ],
    ["pragma", (db) => db.pragma("user_version = 77")],
  ]) {
    await t.test(label, async (t) => {
      const v = fixture(t);
      const acquireExactLease = exactDurableLease(v);
      const driftLease = (options) => {
        const lease = acquireExactLease(options);
        mutate(v.db);
        return lease;
      };
      await assert.rejects(
        () =>
          quarantineExactGovernedProductionPlan(
            request(v),
            deps(v, { acquireLease: driftLease }),
          ),
        /quarantine_database_(logical|physical)_state_mismatch/,
      );
      assert.equal(
        v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
        "pending",
      );
    });
  }
});

test("schema drift introduced inside the transaction is rejected before commit", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  const d = deps(v, {
    inspectBindings: async (...args) => {
      inspections += 1;
      if (inspections === 2)
        v.db.exec("CREATE INDEX raced_inside_transaction ON jobs(priority)");
      return deps(v).inspectBindings(...args);
    },
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_database_(logical|physical)_state_mismatch/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
});

test("every leased fence requires the exact live row and authoritative fresh time", async (t) => {
  await t.test("missing", async (t) => {
    const v = fixture(t);
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: () => ({
              owner_id: "missing-owner",
              lease_ms: DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
              renew() {
                return true;
              },
              release() {
                return true;
              },
            }),
          }),
        ),
      /quarantine_lease_release_failed/,
    );
  });

  await t.test("stolen", async (t) => {
    const v = fixture(t);
    const acquireExactLease = exactDurableLease(v);
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) => {
              const lease = acquireExactLease(options);
              v.db
                .prepare(
                  "UPDATE runtime_leases SET owner_id='stolen-owner' WHERE name=?",
                )
                .run(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
              return withForcedLeaseCleanup(v, lease);
            },
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
  });

  await t.test("expired", async (t) => {
    const v = fixture(t);
    const acquireExpiredLease = exactDurableLease(v, {
      expiresAt: new Date(Date.parse(NOW) - 1),
    });
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) =>
              withForcedLeaseCleanup(v, acquireExpiredLease(options)),
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
  });

  await t.test("future heartbeat", async (t) => {
    const v = fixture(t);
    const acquireFutureHeartbeat = exactDurableLease(v, {
      heartbeatAt: new Date(Date.parse(NOW) + 30_000),
    });
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) =>
              withForcedLeaseCleanup(v, acquireFutureHeartbeat(options)),
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
  });

  await t.test("overlong TTL", async (t) => {
    const v = fixture(t);
    const acquireOverlongLease = exactDurableLease(v, {
      expiresAt: new Date(
        Date.parse(NOW) + DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS + 1,
      ),
    });
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) =>
              withForcedLeaseCleanup(v, acquireOverlongLease(options)),
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
  });

  await t.test("lease expires after request validation", async (t) => {
    const v = fixture(t);
    const acquireShortLease = exactDurableLease(v, {
      leaseMs: 1_000,
    });
    let clockReads = 0;
    const freshClock = () =>
      new Date(clockReads++ < 3 ? NOW : "2026-08-01T11:35:02.000Z");
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            now: freshClock,
            acquireLease: acquireShortLease,
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
    assert.ok(clockReads >= 4);
  });
});

test("leased fences bind the full durable owner participant to the acquired handle", async (t) => {
  await t.test("participant id mismatch", async (t) => {
    const v = fixture(t);
    const acquireExactLease = exactDurableLease(v);
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) => {
              const lease = acquireExactLease(options);
              mutateDurableLeaseParticipant(v, (participant) => {
                participant.participant_id = "different-participant";
              });
              return withForcedLeaseCleanup(v, lease);
            },
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
    assert.equal(
      v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
      "pending",
    );
    assert.equal(
      v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
      0,
    );
  });

  await t.test("durable process identity mismatch", async (t) => {
    const v = fixture(t);
    const acquireExactLease = exactDurableLease(v);
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, {
            acquireLease: (options) => {
              const lease = acquireExactLease(options);
              mutateDurableLeaseParticipant(v, (participant) => {
                participant.process_id += 1;
                participant.process_started_at = "2026-08-01T11:35:01.000Z";
                participant.process_start_source = "mutated-fixture";
              });
              return withForcedLeaseCleanup(v, lease);
            },
          }),
        ),
      /quarantine_database_physical_state_mismatch/,
    );
    assert.equal(
      v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
      "pending",
    );
    assert.equal(
      v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
      0,
    );
  });
});

test("a real binding inspection uses a fresh clock and rolls back a stale operation", async (t) => {
  const v = await realBindingFixture(t);
  const req = realBindingRequest(v);
  let clockReads = 0;
  const dependencies = realBindingDeps(v);
  dependencies.now = () =>
    new Date(clockReads++ < 8 ? NOW : "2026-08-01T11:41:01.000Z");
  dependencies.acquireLease = (options) =>
    acquireLiveRuntimeTransitionLease({
      ...options,
      leaseMs: 10 * 60 * 1000,
    });

  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(req, dependencies),
    /quarantine_apply_failed/,
  );
  const check = new Database(v.dbPath, { readonly: true });
  try {
    assert.equal(
      check
        .prepare("SELECT status FROM jobs WHERE id=?")
        .get(req.expected_standby_job_id).status,
      "pending",
    );
    assert.equal(
      check.prepare("SELECT COUNT(*) count FROM operator_audit_log").get()
        .count,
      0,
    );
  } finally {
    check.close();
  }
  assert.ok(clockReads >= 9);
});

test("authoritative quiescence is re-probed immediately before commit", async (t) => {
  const v = fixture(t);
  let probes = 0;
  const d = deps(v, {
    inspectQuiescence: async () => {
      probes += 1;
      return probes === 3 ? { available: false } : greenQuiescence();
    },
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_runtime_not_quiescent/,
  );
  assert.equal(probes, 4);
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("quarantine reconciles task-state evidence and refuses a present disabled exact task", async (t) => {
  const v = fixture(t);
  const d = deps(v, {
    inspectQuiescence: async () =>
      greenQuiescence({
        task_states: [
          {
            task_name: TASK_NAME,
            task_path: TASK_NAME,
            state: "Ready",
            enabled: false,
          },
        ],
      }),
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_runtime_not_quiescent/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("quarantine requires explicit absence for every reviewed predecessor task", async (t) => {
  const v = fixture(t);
  const d = deps(v, {
    inspectQuiescence: async () =>
      greenQuiescence({ absent_task_names: [TASK_NAME] }),
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_runtime_not_quiescent/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("quarantine refuses a non-null ambiguity diagnostic that contradicts quiescent summaries", async (t) => {
  const v = fixture(t);
  const secretTaskIdentity = "AWS_SECRET_ACCESS_KEY_QUARANTINE_DIAGNOSTIC";
  const d = deps(v, {
    inspectQuiescence: async () =>
      greenQuiescence({
        diagnostics: {
          probe: "processes",
          kind: "AMBIGUOUS",
          pids: [999],
          task_identities: [secretTaskIdentity],
          reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
        },
      }),
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    /quarantine_runtime_not_quiescent/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("an activation receipt racing during the final source hash is fenced before commit", async (t) => {
  const v = fixture(t);
  let raced = false;
  const racingFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "readFile") return target[property];
      return async (file, ...args) => {
        const bytes = await target.readFile(file, ...args);
        if (
          !raced &&
          path.resolve(file) === path.resolve(v.dbPath) &&
          v.db.inTransaction &&
          v.db.prepare("SELECT status FROM jobs WHERE id=135781").get()
            .status === "cancelled" &&
          v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get()
            .count === 1
        ) {
          raced = true;
          fs.writeFileSync(v.receipt, "raced during final source hash");
        }
        return bytes;
      };
    },
  });

  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { fs: racingFs }),
      ),
    /quarantine_lease_release_failed/,
  );
  assert.equal(raced, true);
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("a pre-existing trigger cannot mutate an unauthorised standby column", async (t) => {
  const v = fixture(t);
  v.db.exec(`
    CREATE TRIGGER mutate_standby_priority
    AFTER UPDATE OF status ON jobs
    WHEN NEW.id = 135781
    BEGIN
      UPDATE jobs SET priority = priority + 100 WHERE id = NEW.id;
    END
  `);
  refreshBackup(v);
  const before = v.db.prepare("SELECT * FROM jobs WHERE id=135781").get();
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
    /quarantine_database_logical_state_mismatch/,
  );
  assert.deepEqual(
    v.db.prepare("SELECT * FROM jobs WHERE id=135781").get(),
    before,
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    0,
  );
});

test("a lease release that does not confirm success returns authoritative recovery HOLD", async (t) => {
  const v = fixture(t);
  const acquireExactLease = exactDurableLease(v);
  const result = await quarantineExactGovernedProductionPlan(
    request(v),
    deps(v, {
      acquireLease: (options) => {
        const lease = acquireExactLease(options);
        return {
          ...lease,
          release() {
            return false;
          },
        };
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.equal(result.blocker, "quarantine_lease_release_failed");
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "cancelled",
  );
});

test("replay reclaims only an expired transition lease whose participants are authoritatively dead", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const acquireExactLease = exactDurableLease(v, { leaseMs: 1_000 });
  const applied = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      acquireLease: (options) => {
        const durable = acquireExactLease(options);
        return {
          ...durable,
          release() {
            return false;
          },
        };
      },
    }),
  );
  assert.equal(applied.blocker, "quarantine_lease_release_failed");

  const replayNow = new Date(Date.parse(NOW) + 2_000);
  const replay = await quarantineExactGovernedProductionPlan(
    { ...req, generated_at: replayNow.toISOString() },
    deps(v, {
      now: () => new Date(replayNow),
      acquireRecoveryLease: acquireLiveRuntimeTransitionLease,
      participantProcessInspector: () => false,
    }),
  );
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    0,
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    1,
  );
});

test("replay keeps an expired transition lease on HOLD when participant liveness is ambiguous", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const acquireExactLease = exactDurableLease(v, { leaseMs: 1_000 });
  await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      acquireLease: (options) => {
        const durable = acquireExactLease(options);
        return { ...durable, release: () => false };
      },
    }),
  );

  const replayNow = new Date(Date.parse(NOW) + 2_000);
  const replay = await quarantineExactGovernedProductionPlan(
    { ...req, generated_at: replayNow.toISOString() },
    deps(v, {
      now: () => new Date(replayNow),
      acquireRecoveryLease: acquireLiveRuntimeTransitionLease,
      participantProcessInspector: () => null,
    }),
  );
  assert.equal(replay.verdict, "HOLD");
  assert.equal(replay.status, "RECOVERY_REQUIRED");
  assert.equal(replay.blocker, "quarantine_transition_lease_present");
  assert.equal(replay.evidence, null);
});

test("a stranded lease outranks a simultaneous operation error without leaking it", async (t) => {
  const v = fixture(t);
  let inspections = 0;
  const acquireExactLease = exactDurableLease(v);
  const d = deps(v, {
    acquireLease: (options) => {
      const lease = acquireExactLease(options);
      return {
        ...lease,
        release() {
          return false;
        },
      };
    },
    inspectBindings: async (...args) => {
      inspections += 1;
      if (inspections === 2)
        throw new Error("operation-secret-must-not-escape");
      return deps(v).inspectBindings(...args);
    },
  });
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), d),
    (error) =>
      error.message === "quarantine_lease_release_failed" &&
      !error.message.includes("operation-secret"),
  );
});

test("post-commit evidence failure returns HOLD and durable replay repairs it", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const pending = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      writeEvidence: async () => {
        throw new Error("disk-secret");
      },
    }),
  );
  assert.equal(pending.verdict, "HOLD");
  assert.equal(pending.status, "EVIDENCE_PENDING");
  assert.equal(pending.evidence, null);
  const replay = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(fs.existsSync(replay.evidence.commit_path), true);
});

test("audit is replay authority and repairs evidence after a post-commit crash", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const first = await quarantineExactGovernedProductionPlan(req, deps(v));
  fs.rmSync(path.dirname(first.evidence.commit_path), {
    recursive: true,
    force: true,
  });
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "cancelled",
  );
  const replay = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.equal(replay.status, "REPLAYED");
  assert.equal(fs.existsSync(replay.evidence.commit_path), true);
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    1,
  );
});

test("durable replay re-establishes every database and runtime fence before repair", async (t) => {
  await t.test("canonical row remainder", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    v.db.prepare("UPDATE jobs SET priority=priority+1 WHERE id=135780").run();
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(req, deps(v)),
      /quarantine_database_logical_state_mismatch/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });

  await t.test("exact standby postimage", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    v.db.prepare("UPDATE jobs SET priority=priority+1 WHERE id=135781").run();
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(req, deps(v)),
      /quarantine_database_logical_state_mismatch/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });

  await t.test("canonical structure", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    v.db.exec("CREATE INDEX replay_drift_index ON jobs(priority)");
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(req, deps(v)),
      /quarantine_database_logical_state_mismatch/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });

  await t.test("exact source identity", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    fs.linkSync(v.dbPath, path.join(v.root, "replay-source-alias.db"));
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(req, deps(v)),
      /quarantine_file_link_forbidden/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });

  await t.test("activation absence", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    fs.writeFileSync(v.receipt, "activated");
    await assert.rejects(
      () => quarantineExactGovernedProductionPlan(req, deps(v)),
      /quarantine_activation_receipt_present/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });

  await t.test("authoritative quiescence", async (t) => {
    const v = fixture(t);
    const req = await commitWithoutEvidence(v);
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          req,
          deps(v, {
            inspectQuiescence: async () => ({ available: false }),
          }),
        ),
      /quarantine_runtime_not_quiescent/,
    );
    assert.equal(quarantineCommitExists(req.output_dir), false);
  });
});

test("a fresh replay timestamp uses the durable audit timestamp, and invalid durable time fails closed", async (t) => {
  const v = fixture(t);
  const original = request(v);
  const applied = await quarantineExactGovernedProductionPlan(
    original,
    deps(v),
  );
  const later = { ...original, generated_at: "2026-08-01T11:36:00.000Z" };
  const replay = await quarantineExactGovernedProductionPlan(
    later,
    deps(v, { now: () => new Date(later.generated_at) }),
  );
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.operation_fingerprint, applied.operation_fingerprint);
  assert.notEqual(replay.request_fingerprint, applied.request_fingerprint);
  v.db
    .prepare("UPDATE operator_audit_log SET created_at='not-an-iso-timestamp'")
    .run();
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        later,
        deps(v, { now: () => new Date(later.generated_at) }),
      ),
    /quarantine_replay_audit_invalid/,
  );
});

test("durable audit replay remains recoverable after backup freshness expires", async (t) => {
  const v = fixture(t);
  const original = request(v);
  await quarantineExactGovernedProductionPlan(original, deps(v));
  const later = { ...original, generated_at: "2026-08-03T12:00:00.000Z" };
  const replay = await quarantineExactGovernedProductionPlan(
    later,
    deps(v, { now: () => new Date(later.generated_at) }),
  );
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
});

test("completion index uses its exact durable action and public errors never retain a raw cause", async (t) => {
  const v = fixture(t);
  v.db
    .prepare(
      "INSERT INTO operator_audit_log VALUES (1,?,'governed_autonomous_candidate_materialised','governed_autonomous_candidate',?,'RECORDED_GREEN','x','{}',?,?)",
    )
    .run("operator", "official-primary", NOW, "completion-key");
  refreshBackup(v);
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(request(v), deps(v)),
    (error) =>
      error.message === "quarantine_apply_failed" && error.cause === undefined,
  );
  assert.equal(
    safeBlocker({ code: "secret:never-return" }),
    "quarantine_apply_failed",
  );
  assert.equal(
    safeBlocker({ code: "quarantine_not_owned_secret" }),
    "quarantine_apply_failed",
  );
});

test("a first application cannot use pre-open hash drift, while replay requires the exact owned audit row", async (t) => {
  const v = fixture(t);
  const req = request(v);
  v.db
    .prepare("UPDATE jobs SET updated_at='pre-open-drift' WHERE id=135781")
    .run();
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(req, deps(v, { db: undefined })),
    /quarantine_database_sha256_mismatch/,
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );

  refreshBackup(v);
  const replayRequest = request(v);
  const applied = await quarantineExactGovernedProductionPlan(
    replayRequest,
    deps(v),
  );
  v.db
    .prepare("UPDATE operator_audit_log SET evidence_json='{}' WHERE id=?")
    .run(applied.audit_id);
  await assert.rejects(
    () => quarantineExactGovernedProductionPlan(replayRequest, deps(v)),
    /quarantine_replay_audit_invalid/,
  );
});

test("replay preserves canonical evidence bytes and refuses a conflicting no-replace target", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const first = await quarantineExactGovernedProductionPlan(req, deps(v));
  const canonical = fs.readFileSync(first.evidence.json_path);
  fs.rmSync(first.evidence.markdown_path);
  fs.rmSync(first.evidence.commit_path);
  const replay = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.deepEqual(fs.readFileSync(replay.evidence.json_path), canonical);
  fs.writeFileSync(replay.evidence.commit_path, "raced-conflict");
  const conflict = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.equal(conflict.verdict, "HOLD");
  assert.equal(conflict.status, "EVIDENCE_PENDING");
});

test("successful evidence records file fsync PASS and the platform directory result", async (t) => {
  const v = fixture(t);
  const result = await quarantineExactGovernedProductionPlan(
    request(v),
    deps(v),
  );
  assert.equal(result.evidence.json_fsync_status, "PASS");
  assert.equal(result.evidence.markdown_fsync_status, "PASS");
  assert.equal(result.evidence.commit_fsync_status, "PASS");
  const directoryFsyncStatus =
    process.platform === "win32" ? "UNSUPPORTED_WINDOWS_EPERM" : "SYNCED";
  assert.equal(
    result.evidence.directory_fsync_status,
    directoryFsyncStatus,
  );
  assert.equal(
    result.evidence.body_directory_fsync_status,
    directoryFsyncStatus,
  );
  assert.equal(
    result.evidence.commit_directory_fsync_status,
    directoryFsyncStatus,
  );
});

test("an identity-bound evidence guard stays held across body and commit writes", async (t) => {
  const v = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-quarantine-guard-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  let activeGuards = 0;
  let guardAcquired = 0;
  let guardReleased = 0;
  let swapAttempts = 0;
  const guardedFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "open") return Reflect.get(target, property);
      return async (file, ...args) => {
        if (
          swapAttempts === 0 &&
          String(file).includes("quarantine.json.") &&
          String(file).endsWith(".tmp")
        ) {
          swapAttempts += 1;
          if (activeGuards === 0) {
            const directory = path.dirname(file);
            fs.renameSync(directory, `${directory}-moved-by-race`);
            fs.symlinkSync(
              outside,
              directory,
              process.platform === "win32" ? "junction" : "dir",
            );
          }
        }
        return target.open(file, ...args);
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(request(v),
    deps(v, {
      fs: guardedFs,
      acquireEvidenceDirectoryGuard: async () => {
        activeGuards += 1;
        guardAcquired += 1;
        let released = false;
        return {
          mode: "TEST_IDENTITY_BOUND",
          async assertBound() {
            if (released) throw new Error("test_evidence_guard_not_held");
            return true;
          },
          async release() {
            if (!released) {
              released = true;
              activeGuards -= 1;
              guardReleased += 1;
            }
            return true;
          },
        };
      },
    }),
  );

  assert.equal(result.verdict, "QUARANTINED");
  assert.equal(result.status, "APPLIED");
  assert.equal(swapAttempts, 1);
  assert.ok(guardAcquired >= 3);
  assert.equal(guardReleased, guardAcquired);
  assert.equal(activeGuards, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(result.evidence.commit_path), true);
});

test("a directory swap before guard readiness is rejected before evidence can escape", async (t) => {
  const v = fixture(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-quarantine-pre-ready-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  let acquired = 0;
  let released = 0;
  let outsideOpenAttempts = 0;
  const guardedFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "open") return Reflect.get(target, property);
      return async (file, ...args) => {
        try {
          if (
            path.resolve(fs.realpathSync(path.dirname(file))) ===
            path.resolve(outside)
          ) {
            outsideOpenAttempts += 1;
          }
        } catch {}
        return target.open(file, ...args);
      };
    },
  });
  const req = request(v);
  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      fs: guardedFs,
      acquireEvidenceDirectoryGuard: async ({ directoryBinding }) => {
        acquired += 1;
        if (path.resolve(path.dirname(directoryBinding.path)) === path.resolve(req.output_dir)) {
          fs.renameSync(
            directoryBinding.path,
            `${directoryBinding.path}-moved-before-ready`,
          );
          fs.symlinkSync(
            outside,
            directoryBinding.path,
            process.platform === "win32" ? "junction" : "dir",
          );
        }
        let guardReleased = false;
        return {
          async assertBound() {
            return guardReleased === false;
          },
          async release() {
            if (!guardReleased) {
              guardReleased = true;
              released += 1;
            }
            return true;
          },
        };
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(acquired >= 3);
  assert.equal(released, acquired);
  assert.equal(outsideOpenAttempts, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(quarantineCommitExists(outside), false);
});

test("each output parent is guarded before a missing child directory is created", async (t) => {
  const v = fixture(t);
  const base = path.join(v.root, "guarded-output-base");
  const output = path.join(base, "nested-output");
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-quarantine-mkdir-outside-"),
  );
  fs.mkdirSync(base);
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  let activeGuards = 0;
  let attempted = false;
  const guardedFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "mkdir") return Reflect.get(target, property);
      return async (directory, ...args) => {
        if (!attempted && path.resolve(directory) === path.resolve(output)) {
          attempted = true;
          if (activeGuards === 0) {
            fs.renameSync(base, `${base}-moved-by-mkdir-race`);
            fs.symlinkSync(
              outside,
              base,
              process.platform === "win32" ? "junction" : "dir",
            );
          }
        }
        return target.mkdir(directory, ...args);
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(
    request(v, { output_dir: output }),
    deps(v, {
      fs: guardedFs,
      acquireEvidenceDirectoryGuard: async () => {
        activeGuards += 1;
        let released = false;
        return {
          async assertBound() {
            return released === false;
          },
          async release() {
            if (!released) {
              released = true;
              activeGuards -= 1;
            }
            return true;
          },
        };
      },
    }),
  );

  assert.equal(result.verdict, "QUARANTINED");
  assert.equal(result.status, "APPLIED");
  assert.equal(attempted, true);
  assert.equal(activeGuards, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(result.evidence.commit_path), true);
});

test("the default evidence guard fails closed when Windows delete exclusion is unavailable", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      acquireEvidenceDirectoryGuard: undefined,
      evidenceGuardPlatform: "linux",
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.equal(result.blocker, "quarantine_evidence_platform_unsupported");
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    1,
  );
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    0,
  );
});

test("the transition lease stays held through evidence and a new activation receipt prevents the commit marker", async (t) => {
  const v = fixture(t);
  const req = request(v);
  let leaseObservedDuringJsonInstall = false;
  const guardedFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "link") return Reflect.get(target, property);
      return async (existingPath, newPath) => {
        const result = await target.link(existingPath, newPath);
        if (String(newPath).endsWith("quarantine.json")) {
          leaseObservedDuringJsonInstall =
            v.db
              .prepare(
                "SELECT COUNT(*) count FROM runtime_leases WHERE name=?",
              )
              .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count === 1;
          fs.writeFileSync(v.receipt, "{}\n");
        }
        return result;
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, { fs: guardedFs }),
  );

  assert.equal(leaseObservedDuringJsonInstall, true);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.equal(result.blocker, "quarantine_lease_release_failed");
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    1,
  );
});

test("an activation receipt created immediately after the commit hard-link revokes the canonical marker", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const secretReceipt = "AWS_SECRET_ACCESS_KEY_COMMIT_LINK_BOUNDARY";
  let commitLinked = false;
  const racingFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "link") return Reflect.get(target, property);
      return async (existingPath, newPath) => {
        const result = await target.link(existingPath, newPath);
        if (String(newPath).endsWith("quarantine.commit.json")) {
          commitLinked = true;
          fs.writeFileSync(v.receipt, secretReceipt);
        }
        return result;
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, { fs: racingFs }),
  );

  assert.equal(commitLinked, true);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.equal(result.blocker, "quarantine_lease_release_failed");
  assert.equal(JSON.stringify(result).includes(secretReceipt), false);
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    1,
  );
});

test("a body component identity swap at the commit-link boundary revokes the canonical marker", async (t) => {
  const v = fixture(t);
  const req = request(v);
  let componentSwapped = false;
  const racingFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "link") return Reflect.get(target, property);
      return async (existingPath, newPath) => {
        const result = await target.link(existingPath, newPath);
        if (String(newPath).endsWith("quarantine.commit.json")) {
          const jsonPath = path.join(path.dirname(newPath), "quarantine.json");
          const displacedPath = `${jsonPath}.displaced-by-boundary-race`;
          const bytes = fs.readFileSync(jsonPath);
          fs.renameSync(jsonPath, displacedPath);
          fs.writeFileSync(jsonPath, bytes);
          componentSwapped = true;
        }
        return result;
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, { fs: racingFs }),
  );

  assert.equal(componentSwapped, true);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "EVIDENCE_PENDING");
  assert.equal(result.blocker, "quarantine_evidence_pending");
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    0,
  );
});

test("a post-link commit fsync failure revokes the canonical marker", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const secretFailure = "AWS_SECRET_ACCESS_KEY_COMMIT_FSYNC";
  let commitFsyncFailed = false;
  const failingFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "open") return Reflect.get(target, property);
      return async (file, flags, mode) => {
        const handle = await target.open(file, flags, mode);
        if (
          String(file).endsWith("quarantine.commit.json") &&
          flags === "r+"
        ) {
          return {
            sync: async () => {
              commitFsyncFailed = true;
              throw new Error(secretFailure);
            },
            close: handle.close.bind(handle),
          };
        }
        return handle;
      };
    },
  });

  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, { fs: failingFs }),
  );

  assert.equal(commitFsyncFailed, true);
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "EVIDENCE_PENDING");
  assert.equal(result.blocker, "quarantine_evidence_pending");
  assert.equal(JSON.stringify(result).includes(secretFailure), false);
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
    0,
  );
});

test(
  "the Windows helper pins the exact child directory before readiness is accepted",
  { skip: process.platform !== "win32" },
  async (t) => {
    const v = fixture(t);
    const req = request(v);
    let finalReadyCallbacks = 0;
    let renameError = null;
    const result = await quarantineExactGovernedProductionPlan(
      req,
      deps(v, {
        acquireEvidenceDirectoryGuard: undefined,
        async afterEvidenceGuardReady({ directoryBinding }) {
          if (
            path.resolve(path.dirname(directoryBinding.path)) !==
            path.resolve(req.output_dir)
          ) {
            return;
          }
          finalReadyCallbacks += 1;
          try {
            fs.renameSync(
              directoryBinding.path,
              `${directoryBinding.path}.moved-after-ready`,
            );
            renameError = "RENAMED";
          } catch (error) {
            renameError = error.code;
          }
        },
      }),
    );

    assert.equal(result.verdict, "QUARANTINED");
    assert.equal(finalReadyCallbacks, 1);
    assert.notEqual(renameError, "RENAMED");
    assert.equal(fs.existsSync(result.evidence.commit_path), true);
  },
);

test(
  "the Windows evidence guard denies marker, directory and ancestor rename during evidence writes",
  { skip: process.platform !== "win32" },
  async (t) => {
    const v = fixture(t);
    const renameErrors = [];
    let attempted = false;
    const guardedFs = new Proxy(fsp, {
      get(target, property) {
        if (property !== "open") return Reflect.get(target, property);
        return async (file, ...args) => {
          if (
            !attempted &&
            String(file).includes("quarantine.json.") &&
            String(file).endsWith(".tmp")
          ) {
            attempted = true;
            const directory = path.dirname(file);
            const marker = fs
              .readdirSync(directory)
              .find((entry) => entry.endsWith(".guard"));
            assert.ok(marker);
            for (const [source, targetPath] of [
              [
                path.join(directory, marker),
                path.join(path.dirname(directory), `${marker}.moved`),
              ],
              [directory, `${directory}.moved`],
              [
                path.dirname(directory),
                `${path.dirname(directory)}.moved`,
              ],
            ]) {
              try {
                fs.renameSync(source, targetPath);
                renameErrors.push("RENAMED");
              } catch (error) {
                renameErrors.push(error.code);
              }
            }
          }
          return target.open(file, ...args);
        };
      },
    });

    const result = await quarantineExactGovernedProductionPlan(
      request(v),
      deps(v, {
        fs: guardedFs,
        acquireEvidenceDirectoryGuard: undefined,
      }),
    );
    assert.equal(result.verdict, "QUARANTINED");
    assert.equal(result.status, "APPLIED");
    assert.deepEqual(renameErrors.length, 3);
    assert.equal(renameErrors.includes("RENAMED"), false);
    assert.equal(fs.existsSync(result.evidence.commit_path), true);
  },
);

test("a guard lost after the JSON body leaves replayable evidence pending without a commit marker", async (t) => {
  const v = fixture(t);
  let guardAlive = true;
  let acquisitions = 0;
  let releases = 0;
  const guardedFs = new Proxy(fsp, {
    get(target, property) {
      if (property !== "link") return Reflect.get(target, property);
      return async (existingPath, newPath) => {
        const result = await target.link(existingPath, newPath);
        if (String(newPath).endsWith("quarantine.json")) guardAlive = false;
        return result;
      };
    },
  });
  const req = request(v);
  const result = await quarantineExactGovernedProductionPlan(
    req,
    deps(v, {
      fs: guardedFs,
      acquireEvidenceDirectoryGuard: async () => {
        acquisitions += 1;
        let released = false;
        return {
          async assertBound() {
            if (released || !guardAlive) throw new Error("test_guard_lost");
            return true;
          },
          async release() {
            if (!released) {
              released = true;
              releases += 1;
            }
            return true;
          },
        };
      },
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.status, "EVIDENCE_PENDING");
  assert.equal(result.blocker, "quarantine_evidence_pending");
  assert.ok(acquisitions >= 3);
  assert.equal(releases, acquisitions);
  assert.equal(quarantineCommitExists(req.output_dir), false);
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "cancelled",
  );
  assert.equal(
    v.db.prepare("SELECT COUNT(*) count FROM operator_audit_log").get().count,
    1,
  );
});

test("linked evidence targets and evidence fsync failures produce repairable HOLD", async (t) => {
  await t.test("linked target", async (t) => {
    const v = fixture(t);
    const req = request(v);
    const first = await quarantineExactGovernedProductionPlan(req, deps(v));
    fs.linkSync(
      first.evidence.json_path,
      path.join(path.dirname(first.evidence.json_path), "linked-copy.json"),
    );
    const result = await quarantineExactGovernedProductionPlan(req, deps(v));
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.status, "EVIDENCE_PENDING");
  });

  await t.test("fsync failure", async (t) => {
    const v = fixture(t);
    const req = request(v);
    const syncingFs = Object.create(fsp);
    syncingFs.open = async (file, flags, mode) => {
      const handle = await fsp.open(file, flags, mode);
      return {
        writeFile: handle.writeFile.bind(handle),
        sync: async () => {
          if (String(file).endsWith("quarantine.json"))
            throw new Error("fsync-failed");
          return handle.sync();
        },
        close: handle.close.bind(handle),
      };
    };
    const result = await quarantineExactGovernedProductionPlan(
      req,
      deps(v, { fs: syncingFs }),
    );
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.status, "EVIDENCE_PENDING");
  });
});

test("replay deterministically recovers an exact orphan evidence temp file", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const first = await quarantineExactGovernedProductionPlan(req, deps(v));
  const markdown = fs.readFileSync(first.evidence.markdown_path);
  const temporary = `${first.evidence.markdown_path}.${crypto.createHash("sha256").update(markdown).digest("hex")}.tmp`;
  fs.rmSync(first.evidence.markdown_path);
  fs.writeFileSync(temporary, markdown);
  const replay = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
  assert.deepEqual(fs.readFileSync(replay.evidence.markdown_path), markdown);
  assert.equal(fs.existsSync(temporary), false);
});

test("replay repairs a crash after final hard-link installation but before temp unlink", async (t) => {
  const v = fixture(t);
  const req = request(v);
  const first = await quarantineExactGovernedProductionPlan(req, deps(v));
  const json = fs.readFileSync(first.evidence.json_path);
  const temporary = `${first.evidence.json_path}.${crypto.createHash("sha256").update(json).digest("hex")}.tmp`;
  fs.linkSync(first.evidence.json_path, temporary);
  assert.equal(
    fs.statSync(first.evidence.json_path, { bigint: true }).nlink,
    2n,
  );
  const replay = await quarantineExactGovernedProductionPlan(req, deps(v));
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.evidence.json_status, "RECOVERED");
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(
    fs.statSync(replay.evidence.json_path, { bigint: true }).nlink,
    1n,
  );
});

test("canonical backup evidence structure is mandatory", async (t) => {
  const v = fixture(t);
  const evidence = JSON.parse(fs.readFileSync(v.evidence));
  delete evidence.backup_id;
  fs.writeFileSync(v.evidence, JSON.stringify(evidence));
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v, { expected_backup_evidence_file_sha256: hash(v.evidence) }),
        deps(v),
      ),
    /quarantine_apply_failed/,
  );
});

test("a real WAL sidecar is rejected before the module opens its own database handle", async (t) => {
  const v = fixture(t);
  v.db.close();
  const writer = new Database(v.dbPath);
  writer.pragma("journal_mode = WAL");
  writer
    .prepare("UPDATE jobs SET updated_at='wal-write' WHERE id=135781")
    .run();
  try {
    await assert.rejects(
      () =>
        quarantineExactGovernedProductionPlan(
          request(v),
          deps(v, { db: undefined, inspectBindings: undefined }),
        ),
      /quarantine_database_sidecar_present/,
    );
  } finally {
    writer.close();
  }
});

test("an orphan no-audit WAL is rejected without changing the main file or either sidecar", async (t) => {
  const v = fixture(t);
  v.db.close();
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      [
        'const Database = require("better-sqlite3")',
        "const db = new Database(process.argv[1])",
        'db.pragma("journal_mode = WAL")',
        'db.pragma("wal_autocheckpoint = 0")',
        'db.prepare("UPDATE jobs SET updated_at=\'orphan-wal-write\' WHERE id=135781").run()',
        "process.exit(0)",
      ].join(";"),
      v.dbPath,
    ],
    { cwd: path.resolve(__dirname, "..", ".."), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.statSync(`${v.dbPath}-wal`).size > 0, true);

  const physicalState = () =>
    Object.fromEntries(
      [v.dbPath, `${v.dbPath}-wal`, `${v.dbPath}-shm`].map((file) => [
        file,
        fs.existsSync(file) ? fs.readFileSync(file).toString("base64") : null,
      ]),
    );
  const before = physicalState();

  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { db: undefined, inspectBindings: undefined }),
      ),
    /quarantine_database_sidecar_present/,
  );

  assert.deepEqual(physicalState(), before);
});

test("a post-COMMIT crash with durable WAL and an expired dead lease replays exactly once", async (t) => {
  const v = await realBindingFixture(t);
  const walSetup = new Database(v.dbPath);
  walSetup.pragma("journal_mode = WAL");
  walSetup.pragma("wal_checkpoint(TRUNCATE)");
  walSetup.close();
  for (const suffix of ["-wal", "-shm"])
    fs.rmSync(`${v.dbPath}${suffix}`, { force: true });
  refreshBackup(v);
  let keeper = null;
  t.after(() => {
    try {
      if (keeper?.inTransaction) keeper.exec("ROLLBACK");
      keeper?.close();
    } catch {}
  });

  const participantIdentity = Object.freeze({
    participant_id: "crashed-quarantine-owner",
    role: "owner",
    process_id: 424_242,
    process_started_at: "2026-08-01T10:00:00.000Z",
    process_start_source: "injected",
  });
  const crashAfterCommitLease = ({
    metadata,
    now,
    authorityContextSha256,
    authorityContextProvider,
  }) => {
    const ownerId = "crashed-quarantine-owner";
    const leaseMs = 1_000;
    const leaseDb = new Database(v.dbPath);
    try {
      leaseDb
        .prepare(
          `INSERT INTO runtime_leases
             (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          LIVE_RUNTIME_TRANSITION_LEASE_NAME,
          ownerId,
          now.toISOString(),
          now.toISOString(),
          new Date(now.getTime() + leaseMs).toISOString(),
           JSON.stringify({
             transition_owner_schema_version:
               "pulse-live-runtime-transition-owner-v2",
             authority_context_sha256: authorityContextSha256,
             admission_state: "OPEN",
            context: { ...metadata },
            participants: [{ ...participantIdentity }],
          }),
        );
    } finally {
      leaseDb.close();
    }
    return {
      owner_id: ownerId,
      lease_ms: leaseMs,
      participant_id: participantIdentity.participant_id,
      participant_identity: participantIdentity,
      authority_context_sha256: authorityContextSha256,
      assertCurrentAuthority() {
        return authorityContextProvider();
      },
      renew: () => true,
      release: () => false,
    };
  };

  const req = realBindingRequest(v);
  const baseDependencies = realBindingDeps(v);
  const crashed = await quarantineExactGovernedProductionPlan(req, {
    ...baseDependencies,
    inspectBindings: async (...args) => {
      if (!keeper) {
        keeper = new Database(v.dbPath);
        keeper.pragma("wal_autocheckpoint = 0");
        keeper.exec("BEGIN");
        keeper.prepare("SELECT COUNT(*) count FROM jobs").get();
      }
      return inspectExactGovernedPlanQuarantineBindings(...args);
    },
    acquireLease: crashAfterCommitLease,
  });
  assert.equal(crashed.verdict, "HOLD");
  assert.equal(crashed.blocker, "quarantine_lease_release_failed");
  assert.equal(fs.statSync(`${v.dbPath}-wal`).size > 0, true);
  const afterCrash = new Database(v.dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(
      afterCrash
        .prepare("SELECT COUNT(*) count FROM operator_audit_log")
        .get().count,
      1,
    );
  } finally {
    afterCrash.close();
  }

  const replayNow = new Date(Date.parse(NOW) + 2_000);
  let ownedDatabaseOpens = 0;
  let ownedDatabaseCloses = 0;
  const instrumentedDatabases = [];
  t.after(() => {
    for (const database of instrumentedDatabases) {
      try {
        database.close();
      } catch {}
    }
  });
  const ambiguousReplay = await quarantineExactGovernedProductionPlan(
    { ...req, generated_at: replayNow.toISOString() },
    {
      ...realBindingDeps(v),
      now: () => new Date(replayNow),
      acquireRecoveryLease: acquireLiveRuntimeTransitionLease,
      participantProcessInspector: () => null,
      openDatabase(databasePath, options) {
        const database = new Database(databasePath, options);
        instrumentedDatabases.push(database);
        ownedDatabaseOpens += 1;
        let closed = false;
        return new Proxy(database, {
          get(target, property) {
            if (property === "close") {
              return () => {
                if (!closed) {
                  closed = true;
                  ownedDatabaseCloses += 1;
                }
                return target.close();
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    },
  );
  assert.equal(ambiguousReplay.verdict, "HOLD");
  assert.equal(ambiguousReplay.status, "RECOVERY_REQUIRED");
  assert.equal(
    ambiguousReplay.blocker,
    "quarantine_transition_lease_present",
  );
  assert.equal(ownedDatabaseOpens, 1);
  assert.equal(ownedDatabaseCloses, 1);
  assert.deepEqual(
    [v.backup, v.restore].flatMap((file) =>
      ["-wal", "-shm"]
        .map((suffix) => `${file}${suffix}`)
        .filter((candidate) => fs.existsSync(candidate)),
    ),
    [],
  );
  const replay = await quarantineExactGovernedProductionPlan(
    { ...req, generated_at: replayNow.toISOString() },
    {
      ...realBindingDeps(v),
      now: () => new Date(replayNow),
      acquireRecoveryLease: acquireLiveRuntimeTransitionLease,
      participantProcessInspector: () => false,
    },
  );
  assert.equal(replay.verdict, "QUARANTINED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(fs.existsSync(replay.evidence.commit_path), true);
  const afterReplay = new Database(v.dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(
      afterReplay
        .prepare("SELECT COUNT(*) count FROM operator_audit_log")
        .get().count,
      1,
    );
    assert.equal(
      afterReplay
        .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
        .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
      0,
    );
  } finally {
    afterReplay.close();
  }
  if (keeper.inTransaction) keeper.exec("ROLLBACK");
  keeper.close();
  keeper = null;
});

test("a clean WAL-mode database remains eligible after module-owned SQLite creates its own sidecars", async (t) => {
  const v = await realBindingFixture(t);
  const writer = new Database(v.dbPath);
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_checkpoint(TRUNCATE)");
  writer.close();
  for (const suffix of ["-wal", "-shm"])
    fs.rmSync(`${v.dbPath}${suffix}`, { force: true });
  refreshBackup(v);
  assert.equal(fs.existsSync(`${v.dbPath}-shm`), false);
  const req = realBindingRequest(v);
  const dependencies = realBindingDeps(v);
  delete dependencies.acquireLease;
  const result = await quarantineExactGovernedProductionPlan(req, dependencies);
  assert.equal(result.status, "APPLIED");
  const check = new Database(v.dbPath, { readonly: true });
  try {
    assert.equal(
      check
        .prepare("SELECT status FROM jobs WHERE id=?")
        .get(req.expected_standby_job_id).status,
      "cancelled",
    );
  } finally {
    check.close();
  }
});

test("the quarantine operation composes with a genuinely valid exact-plan binding helper", async (t) => {
  const v = await realBindingFixture(t);
  const req = realBindingRequest(v);
  const result = await quarantineExactGovernedProductionPlan(
    req,
    realBindingDeps(v),
  );
  assert.equal(result.verdict, "QUARANTINED");
  assert.equal(result.plan_sha256, v.planned.plan.plan_sha256);
});

test("the real exact-binding helper is exercised rather than accepting a prebuilt readiness object", async (t) => {
  const v = fixture(t);
  const req = request(v);
  await assert.rejects(
    () =>
      inspectExactGovernedPlanQuarantineBindings(
        {
          generated_at: NOW,
          plan_path: v.plan,
          expected_plan_file_sha256: hash(v.plan),
          expected_plan_sha256: PLAN_SHA,
          workspace_root: v.root,
          database_path: v.dbPath,
          runtime_profile_path: v.profile,
          expected_runtime_profile_file_sha256: hash(v.profile),
          expected_checkout_commit: COMMIT,
          expected_reservation_file_sha256: RESERVATION_FILE_SHA,
          expected_reservation_set_sha256: RESERVATION_SHA,
          expected_primary_job_id: 135780,
          expected_standby_job_id: 135781,
          expected_standby_status: "pending",
          expected_standby_cancellation_reason: null,
        },
        {
          db: v.db,
          fileSystem: fsp,
          workspaceInspector: () => ({
            available: true,
            commit: COMMIT,
            tracked_clean: true,
          }),
          now: () => new Date(NOW),
        },
      ),
    /exact_plan_(structure|schema)_invalid/,
  );
  assert.equal(Object.hasOwn(req, "ready"), false);
});

test("bounded authority drift holds before the standby or audit mutation", async (t) => {
  for (const [field, changed] of [
    ["authority_fingerprint", "1".repeat(64)],
    ["observation_sha256", "2".repeat(64)],
    ["database_snapshot_sha256", "3".repeat(64)],
  ]) {
    await t.test(field, async (t) => {
      const v = fixture(t);
      let inspections = 0;
      await assert.rejects(
        () =>
          quarantineExactGovernedProductionPlan(
            request(v),
            deps(v, {
              inspectQuiescence: async () => {
                inspections += 1;
                return greenQuiescence(
                  inspections === 1 ? {} : { [field]: changed },
                );
              },
            }),
          ),
        { message: "quarantine_runtime_authority_context_drift" },
      );
      assert.equal(inspections, 2);
      assert.equal(
        v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
        "pending",
      );
      assert.equal(
        v.db
          .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
          .get().count,
        0,
      );
      assert.equal(quarantineCommitExists(request(v).output_dir), false);
    });
  }
});

test("a changed exact live database identity holds before transition lease acquisition", async (t) => {
  const v = fixture(t);
  const admitted = inspectLiveDatabaseIdentity({ databasePath: v.dbPath });
  let identityInspections = 0;
  let leaseAcquisitions = 0;
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, {
          inspectDatabaseIdentity: () => {
            identityInspections += 1;
            return identityInspections === 1
              ? admitted
              : {
                  ...admitted,
                  database_identity_sha256: "4".repeat(64),
                };
          },
          acquireLease: (options) => {
            leaseAcquisitions += 1;
            return exactDurableLease(v)(options);
          },
        }),
      ),
    { message: "quarantine_open_database_identity_mismatch" },
  );
  assert.equal(identityInspections, 2);
  assert.equal(leaseAcquisitions, 0);
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
      .get().count,
    0,
  );
});

test("a transition lease without the admitted authority context holds before database mutation", async (t) => {
  const v = fixture(t);
  const acquireLegacyLease = (options) => {
    const handle = exactDurableLease(v)(options);
    const row = v.db
      .prepare("SELECT metadata FROM runtime_leases WHERE name=?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
    const metadata = JSON.parse(row.metadata);
    delete metadata.authority_context_sha256;
    v.db
      .prepare("UPDATE runtime_leases SET metadata=? WHERE name=?")
      .run(JSON.stringify(metadata), LIVE_RUNTIME_TRANSITION_LEASE_NAME);
    delete handle.authority_context_sha256;
    delete handle.assertCurrentAuthority;
    return handle;
  };
  await assert.rejects(
    () =>
      quarantineExactGovernedProductionPlan(
        request(v),
        deps(v, { acquireLease: acquireLegacyLease }),
      ),
    { message: "quarantine_lease_release_failed" },
  );
  assert.equal(
    v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
    "pending",
  );
  assert.equal(
    v.db
      .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
      .get().count,
    0,
  );
  assert.equal(quarantineCommitExists(request(v).output_dir), false);
});

test("a legacy shape and a failed bounded probe are secret-safe holds before acquisition", async (t) => {
  for (const report of [
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
      absent_task_names: [TASK_NAME, CONFLICTING_TASK_NAME],
      diagnostics: null,
    },
    greenQuiescence({
      probe_attestations: {
        listeners: true,
        processes: false,
        scheduled_tasks: true,
      },
      diagnostics: { probe: "processes", raw: "SUPER_SECRET_SENTINEL" },
    }),
  ]) {
    await t.test(report.schema || "legacy", async (t) => {
      const v = fixture(t);
      let leaseAcquisitions = 0;
      await assert.rejects(
        () =>
          quarantineExactGovernedProductionPlan(
            request(v),
            deps(v, {
              inspectQuiescence: async () => report,
              acquireLease: (options) => {
                leaseAcquisitions += 1;
                return exactDurableLease(v)(options);
              },
            }),
          ),
        { message: "quarantine_runtime_not_quiescent" },
      );
      assert.equal(leaseAcquisitions, 0);
      assert.equal(
        v.db.prepare("SELECT status FROM jobs WHERE id=135781").get().status,
        "pending",
      );
    });
  }
});
