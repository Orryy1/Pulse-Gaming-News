"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const {
  buildCutoverPlan,
  executeCutoverApply,
  inspectDatabase,
  verifyBackupEvidence,
} = require("../../lib/ops/stabilisation-cutover-reconcile");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "stabilisation-cutover-reconcile.js");

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pulse-cutover-"));
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function createFixture(directory) {
  const dbPath = path.join(directory, "pulse.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations
      (version, filename, checksum, applied_at)
    VALUES
      ('004', '004_jobs.sql', 'fixture', '2026-07-27T08:00:00.000Z'),
      ('020', '020_stabilisation_governance.sql', 'fixture', '2026-07-27T08:00:00.000Z');

    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      channel_id TEXT,
      story_id TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 50,
      run_at TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      last_error TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      lease_until TEXT,
      requires_gpu INTEGER DEFAULT 0,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      worker_id TEXT,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      log_excerpt TEXT
    );
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      channel_id TEXT,
      cron_expr TEXT NOT NULL,
      payload TEXT,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT,
      next_run_at TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50
    );
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT,
    fencing_token INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, created_at, updated_at)
    VALUES
      ('publish', 'pending', ?, 0, 3, ?, ?)
  `,
  ).run(
    "2026-07-27T07:00:00.000Z",
    "2026-07-27T07:00:00.000Z",
    "2026-07-27T07:00:00.000Z",
  );
  db.prepare(
    `
    INSERT INTO schedules (name, kind, cron_expr, payload, enabled)
    VALUES
      ('publish_legacy_one', 'publish', '0 7 * * *', '{}', 1),
      ('publish_legacy_two', 'publish', '0 11 * * *', '{}', 1),
      ('publish_legacy_three', 'publish', '0 15 * * *', '{}', 1),
      ('publish_legacy_four', 'publish', '0 19 * * *', '{}', 1),
      ('publish_legacy_five', 'publish', '0 23 * * *', '{}', 1)
  `,
  ).run();
  db.close();
  return dbPath;
}

function runTool(args, env = {}) {
  return execFileSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ...env,
    },
    encoding: "utf8",
  });
}

function runToolAllowFailure(args, env = {}) {
  try {
    return {
      status: 0,
      stdout: runTool(args, env),
      stderr: "",
    };
  } catch (error) {
    return {
      status: error.status,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

function createBackupEvidence(directory, dbPath, overrides = {}) {
  const backupPath = path.join(directory, "pulse-before-cutover.db");
  fs.copyFileSync(dbPath, backupPath);
  const evidencePath = path.join(directory, "backup-evidence.json");
  const evidence = {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: "backup-cutover-test",
    backup_path: backupPath,
    backup_sha256: sha256(backupPath),
    source_database_path: dbPath,
    source_database_sha256: sha256(dbPath),
    verified_at: "2026-07-27T09:45:00.000Z",
    verified_by: "operator-test",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
    ...overrides,
  };
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  return evidencePath;
}

function authorisedEnvironment(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_CUTOVER_RECONCILIATION_ENABLED: "true",
    PULSE_RECONCILIATION_MAINTENANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
    PULSE_CUTOVER_WORKERS_STOPPED: "true",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_PRIMARY_INSTANCE: "false",
    USE_SQLITE: "true",
    USE_JOB_QUEUE: "true",
    PULSE_SCHEDULER_PROFILE: "stabilisation_30d",
    PULSE_CUTOVER_OPERATOR_ID: "operator-test",
    PULSE_CUTOVER_CHANGE_WINDOW_ID: "change-window-test",
    TIKTOK_ENABLED: "false",
    TIKTOK_AUTO_PUBLISH: "false",
    INSTAGRAM_AUTO_PUBLISH: "false",
    FACEBOOK_AUTO_PUBLISH: "false",
    TWITTER_ENABLED: "false",
    X_AUTO_PUBLISH: "false",
    THREADS_AUTO_PUBLISH: "false",
    PINTEREST_AUTO_PUBLISH: "false",
    ...overrides,
  };
}

function authorisedApplyArgs({
  dbPath,
  evidencePath,
  outDir,
  cutoverId,
  commit = "a".repeat(40),
}) {
  return [
    "--database",
    dbPath,
    "--backup-evidence",
    evidencePath,
    "--out-dir",
    outDir,
    "--cutover-id",
    cutoverId,
    "--confirm-cutover-id",
    cutoverId,
    "--generated-at",
    "2026-07-27T10:00:00.000Z",
    "--source-commit-sha",
    commit,
    "--runtime-commit-sha",
    commit,
    "--apply",
  ];
}

test("default cutover inspection is a read-only HOLD with JSON and Markdown proof", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const beforeHash = sha256(dbPath);

  try {
    runTool([
      "--database",
      dbPath,
      "--out-dir",
      outDir,
      "--cutover-id",
      "cutover-test-001",
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "a".repeat(40),
      "--runtime-commit-sha",
      "a".repeat(40),
    ]);

    const plan = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_plan.json"),
        "utf8",
      ),
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    const markdown = fs.readFileSync(
      path.join(outDir, "stabilisation_cutover_result.md"),
      "utf8",
    );

    assert.equal(plan.verdict, "HOLD");
    assert.equal(plan.apply_requested, false);
    assert.equal(plan.apply_authorised, false);
    assert.equal(result.mode, "DRY_RUN");
    assert.equal(result.mutations_performed.length, 0);
    assert.equal(result.safety.production_database_mutated, false);
    assert.equal(result.safety.external_objects_created, false);
    assert.equal(result.safety.oauth_or_tokens_mutated, false);
    assert.equal(result.safety.scheduler_lease_claimed, false);
    assert.match(markdown, /# Stabilisation Cutover Result/);
    assert.match(markdown, /HOLD/);
    assert.equal(sha256(dbPath), beforeHash);

    const db = new Database(dbPath, { readonly: true });
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = 1").get().status,
      "pending",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      0,
    );
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("inspection plans quarantines, safe stale reaping and exactly two governed publish windows", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  const insertJob = db.prepare(`
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, claimed_by,
       claimed_at, lease_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const past = "2026-07-27T08:00:00.000Z";
  const future = "2026-07-27T11:00:00.000Z";
  insertJob.run(
    "engage_first_hour",
    "pending",
    past,
    0,
    3,
    null,
    null,
    null,
    past,
    past,
  );
  const analytics = insertJob.run(
    "analytics",
    "running",
    past,
    1,
    3,
    "worker-old",
    past,
    past,
    past,
    past,
  );
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'worker-old', 1, 'running', ?)
  `,
  ).run(analytics.lastInsertRowid, past);
  insertJob.run(
    "mystery_task",
    "running",
    past,
    1,
    3,
    "worker-old",
    past,
    past,
    past,
    past,
  );
  insertJob.run(
    "hunt",
    "running",
    past,
    1,
    3,
    "worker-live",
    past,
    future,
    past,
    past,
  );
  insertJob.run("publish", "done", past, 1, 3, null, null, null, past, past);
  db.prepare(
    `
    INSERT INTO schedules (name, kind, cron_expr, payload, enabled)
    VALUES ('engage_first_hour_sweep', 'engage_first_hour',
            '*/15 * * * *', '{}', 1)
  `,
  ).run();
  db.close();

  try {
    runTool([
      "--database",
      dbPath,
      "--out-dir",
      outDir,
      "--cutover-id",
      "cutover-test-002",
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "b".repeat(40),
      "--runtime-commit-sha",
      "b".repeat(40),
    ]);
    const plan = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_plan.json"),
        "utf8",
      ),
    );
    const actionForJob = (id) =>
      plan.actions.find(
        (action) => action.target_type === "job" && action.target_id === id,
      );

    assert.equal(actionForJob(1).action, "QUARANTINE");
    assert.equal(actionForJob(2).action, "QUARANTINE");
    assert.equal(actionForJob(3).action, "REQUEUE_EXPIRED_SAFE_LEASE");
    assert.equal(actionForJob(4).action, "HOLD_MANUAL_REVIEW");
    assert.equal(actionForJob(5).action, "HOLD_ACTIVE_LEASE");
    assert.equal(actionForJob(6), undefined);
    assert.ok(
      plan.blockers.includes("manual_job_review_required:4:mystery_task"),
    );
    assert.ok(plan.blockers.includes("active_job_lease_present:5:hunt"));

    const scheduleActions = plan.actions.filter(
      (action) => action.target_type === "schedule",
    );
    assert.equal(
      scheduleActions.filter((action) => action.action === "DISABLE").length,
      6,
    );
    assert.deepEqual(
      scheduleActions
        .filter((action) => action.action === "UPSERT_GOVERNED_WINDOW")
        .map((action) => action.target)
        .sort(),
      ["publish_morning", "publish_primary"],
    );
    assert.deepEqual(plan.canonical_publish_windows, [
      {
        name: "publish_morning",
        cron_expr: "0 9 * * *",
        target_platform: "youtube",
      },
      {
        name: "publish_primary",
        cron_expr: "0 19 * * *",
        target_platform: "youtube",
      },
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("dry-run classifies observed recovery and retired automation job kinds as legacy non-governed debt", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  const insertJob = db.prepare(
    `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, created_at,
       updated_at)
    VALUES
      (?, 'pending', ?, 0, 3, ?, ?)
  `,
  );
  const observedJobs = [
    [
      "local_tts_retry_recovery",
      insertJob.run(
        "local_tts_retry_recovery",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
      ),
    ],
    [
      "fresh_production_refill",
      insertJob.run(
        "fresh_production_refill",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
      ),
    ],
    [
      "growth_autopilot",
      insertJob.run(
        "growth_autopilot",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
      ),
    ],
    [
      "oauth_uptime_maintenance",
      insertJob.run(
        "oauth_uptime_maintenance",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
        "2026-07-27T08:00:00.000Z",
      ),
    ],
  ];
  db.close();

  try {
    runTool([
      "--database",
      dbPath,
      "--out-dir",
      outDir,
      "--cutover-id",
      "cutover-test-local-tts-debt",
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "b".repeat(40),
      "--runtime-commit-sha",
      "b".repeat(40),
    ]);
    const plan = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_plan.json"),
        "utf8",
      ),
    );
    for (const [kind, inserted] of observedJobs) {
      const id = Number(inserted.lastInsertRowid);
      const action = plan.actions.find(
        (candidate) =>
          candidate.target_type === "job" && candidate.target_id === id,
      );

      assert.deepEqual(action, {
        action: "QUARANTINE",
        target_type: "job",
        target_id: id,
        target: `job:${id}:${kind}`,
        reason: "non_governed_autonomous_debt_frozen",
        from_status: "pending",
        to_status: "cancelled",
      });
      assert.ok(
        !plan.blockers.includes(`manual_job_review_required:${id}:${kind}`),
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an unknown pending job kind remains a fail-closed manual-review blocker", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  const inserted = db
    .prepare(
      `
      INSERT INTO jobs
        (kind, status, run_at, attempt_count, max_attempts, created_at,
         updated_at)
      VALUES
        ('fresh_production_refill_v2', 'pending', ?, 0, 3, ?, ?)
    `,
    )
    .run(
      "2026-07-27T08:00:00.000Z",
      "2026-07-27T08:00:00.000Z",
      "2026-07-27T08:00:00.000Z",
    );
  db.close();

  try {
    runTool([
      "--database",
      dbPath,
      "--out-dir",
      outDir,
      "--cutover-id",
      "cutover-test-unknown-active-kind",
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "b".repeat(40),
      "--runtime-commit-sha",
      "b".repeat(40),
    ]);
    const plan = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_plan.json"),
        "utf8",
      ),
    );
    const id = Number(inserted.lastInsertRowid);
    const action = plan.actions.find(
      (candidate) =>
        candidate.target_type === "job" && candidate.target_id === id,
    );

    assert.deepEqual(action, {
      action: "HOLD_MANUAL_REVIEW",
      target_type: "job",
      target_id: id,
      target: `job:${id}:fresh_production_refill_v2`,
      reason: "unknown_job_kind_requires_operator_review",
      from_status: "pending",
      to_status: "pending",
    });
    assert.ok(
      plan.blockers.includes(
        `manual_job_review_required:${id}:fresh_production_refill_v2`,
      ),
    );
    assert.equal(plan.apply_authorised, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("authorised apply atomically cancels observed legacy recovery jobs with operator-audit evidence", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  const insertJob = db.prepare(`
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, claimed_by,
       claimed_at, lease_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const past = "2026-07-27T08:00:00.000Z";
  const localTts = insertJob.run(
    "local_tts_retry_recovery",
    "pending",
    past,
    0,
    3,
    null,
    null,
    null,
    past,
    past,
  );
  const refill = insertJob.run(
    "fresh_production_refill",
    "running",
    past,
    1,
    3,
    "refill-worker",
    past,
    past,
    past,
    past,
  );
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'refill-worker', 1, 'running', ?)
  `,
  ).run(refill.lastInsertRowid, past);
  db.close();
  const evidencePath = createBackupEvidence(directory, dbPath);

  try {
    runTool(
      [
        "--database",
        dbPath,
        "--backup-evidence",
        evidencePath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-observed-legacy-debt",
        "--confirm-cutover-id",
        "cutover-test-observed-legacy-debt",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "b".repeat(40),
        "--runtime-commit-sha",
        "b".repeat(40),
        "--apply",
      ],
      authorisedEnvironment(),
    );

    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "APPLIED");
    const expectedJobIds = [
      Number(localTts.lastInsertRowid),
      Number(refill.lastInsertRowid),
    ];
    const resultMutations = result.mutations_performed.filter(
      (entry) =>
        entry.action === "QUARANTINE" &&
        expectedJobIds.includes(entry.target_id),
    );
    assert.deepEqual(
      resultMutations.map((entry) => entry.target).sort(),
      [
        `job:${localTts.lastInsertRowid}:local_tts_retry_recovery`,
        `job:${refill.lastInsertRowid}:fresh_production_refill`,
      ].sort(),
    );
    assert.ok(
      resultMutations.every(
        (entry) => entry.reason === "non_governed_autonomous_debt_frozen",
      ),
    );

    const check = new Database(dbPath, { readonly: true });
    const quarantined = check
      .prepare(
        `SELECT id, kind, status, last_error, claimed_by, lease_until
         FROM jobs
         WHERE id IN (?, ?)
         ORDER BY id`,
      )
      .all(...expectedJobIds);
    assert.deepEqual(
      quarantined.map((row) => [row.kind, row.status]),
      [
        ["local_tts_retry_recovery", "cancelled"],
        ["fresh_production_refill", "cancelled"],
      ],
    );
    for (const row of quarantined) {
      assert.match(
        row.last_error,
        /stabilisation_cutover_quarantine:cutover-test-observed-legacy-debt:non_governed_autonomous_debt_frozen/,
      );
      assert.equal(row.claimed_by, null);
      assert.equal(row.lease_until, null);
    }
    const activeRun = check
      .prepare("SELECT * FROM job_runs WHERE job_id = ?")
      .get(refill.lastInsertRowid);
    assert.equal(activeRun.status, "failed");
    assert.equal(
      activeRun.error_message,
      "stabilisation_cutover_quarantined",
    );

    const audit = check
      .prepare(
        `SELECT evidence_json
         FROM operator_audit_log
         WHERE action = 'stabilisation_cutover_reconcile'
           AND target_id = 'cutover-test-observed-legacy-debt'`,
      )
      .get();
    const auditEvidence = JSON.parse(audit.evidence_json);
    const auditedMutations = auditEvidence.mutations_performed.filter(
      (entry) =>
        entry.action === "QUARANTINE" &&
        expectedJobIds.includes(entry.target_id),
    );
    assert.deepEqual(auditedMutations, resultMutations);
    check.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("--apply without backup and fail-closed HUMAN_REVIEW gates remains read-only HOLD", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const beforeHash = sha256(dbPath);

  try {
    runTool(
      [
        "--database",
        dbPath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-003",
        "--confirm-cutover-id",
        "cutover-test-003",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "c".repeat(40),
        "--runtime-commit-sha",
        "c".repeat(40),
        "--apply",
      ],
      {
        PULSE_OPERATING_MODE: "LIVE_GUARDED",
        AUTO_PUBLISH: "true",
      },
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );

    assert.equal(result.mode, "DRY_RUN");
    assert.equal(result.apply_requested, true);
    assert.equal(result.apply_authorised, false);
    assert.equal(result.verdict, "HOLD");
    assert.ok(result.blockers.includes("backup_evidence_file_required"));
    assert.ok(result.blockers.includes("cutover_human_review_mode_required"));
    assert.ok(result.blockers.includes("cutover_reconciliation_gate_required"));
    assert.ok(result.blockers.includes("auto_publish_must_be_false"));
    assert.equal(sha256(dbPath), beforeHash);

    const db = new Database(dbPath, { readonly: true });
    assert.equal(
      db.prepare("SELECT status FROM jobs WHERE id = 1").get().status,
      "pending",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      0,
    );
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a live scheduler lease blocks apply and is never stolen or released", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  db.prepare(
    `
    INSERT INTO runtime_leases
      (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
    VALUES
      ('scheduler:primary', 'live-scheduler', ?, ?, ?, ?)
  `,
  ).run(
    "2026-07-27T09:50:00.000Z",
    "2026-07-27T09:59:00.000Z",
    "2026-07-27T10:05:00.000Z",
    JSON.stringify({ purpose: "single_owner_scheduler_dispatch" }),
  );
  db.close();
  const evidencePath = createBackupEvidence(directory, dbPath);
  const beforeHash = sha256(dbPath);

  try {
    runTool(
      [
        "--database",
        dbPath,
        "--backup-evidence",
        evidencePath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-live-lease",
        "--confirm-cutover-id",
        "cutover-test-live-lease",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "c".repeat(40),
        "--runtime-commit-sha",
        "c".repeat(40),
        "--apply",
      ],
      authorisedEnvironment(),
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.apply_authorised, false);
    assert.ok(result.blockers.includes("active_scheduler_lease_present"));
    assert.equal(result.safety.scheduler_lease_claimed, false);
    assert.equal(sha256(dbPath), beforeHash);

    const check = new Database(dbPath, { readonly: true });
    const lease = check
      .prepare("SELECT * FROM runtime_leases WHERE name = 'scheduler:primary'")
      .get();
    assert.equal(lease.owner_id, "live-scheduler");
    assert.equal(lease.expires_at, "2026-07-27T10:05:00.000Z");
    check.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("tampered backup evidence blocks apply before the database write boundary", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const evidencePath = createBackupEvidence(directory, dbPath);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  fs.appendFileSync(evidence.backup_path, "tampered", "utf8");
  const beforeHash = sha256(dbPath);

  try {
    runTool(
      [
        "--database",
        dbPath,
        "--backup-evidence",
        evidencePath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-bad-backup",
        "--confirm-cutover-id",
        "cutover-test-bad-backup",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "c".repeat(40),
        "--runtime-commit-sha",
        "c".repeat(40),
        "--apply",
      ],
      authorisedEnvironment(),
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.apply_authorised, false);
    assert.ok(result.blockers.includes("backup_sha256_mismatch"));
    assert.equal(result.safety.production_database_mutated, false);
    assert.equal(sha256(dbPath), beforeHash);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("authorised apply supports a clean checkpointed WAL database after every handle closes", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const setup = new Database(dbPath);
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();
  const evidencePath = createBackupEvidence(directory, dbPath);

  try {
    assert.equal(fs.existsSync(`${dbPath}-wal`), false);
    assert.equal(fs.existsSync(`${dbPath}-shm`), false);

    runTool(
      authorisedApplyArgs({
        dbPath,
        evidencePath,
        outDir,
        cutoverId: "cutover-test-clean-wal",
        commit: "1".repeat(40),
      }),
      authorisedEnvironment(),
    );

    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "APPLIED");
    assert.equal(result.safety.production_database_mutated, true);
    assert.equal(fs.existsSync(`${dbPath}-wal`), false);
    assert.equal(fs.existsSync(`${dbPath}-shm`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("authorised apply rejects shared memory held by a reader even when the WAL is empty", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const setup = new Database(dbPath);
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();
  const evidencePath = createBackupEvidence(directory, dbPath);
  const reader = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    reader.prepare("SELECT COUNT(*) FROM schedules").pluck().get();
    assert.equal(fs.statSync(`${dbPath}-wal`).size, 0);
    assert.ok(fs.statSync(`${dbPath}-shm`).size > 0);

    runTool(
      authorisedApplyArgs({
        dbPath,
        evidencePath,
        outDir,
        cutoverId: "cutover-test-shared-memory",
        commit: "2".repeat(40),
      }),
      authorisedEnvironment(),
    );

    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.apply_authorised, false);
    assert.ok(
      result.blockers.includes("source_database_shared_memory_present"),
      JSON.stringify(result),
    );
    assert.equal(
      reader
        .prepare(
          `SELECT COUNT(*) FROM operator_audit_log
           WHERE action = 'stabilisation_cutover_reconcile'`,
        )
        .pluck()
        .get(),
      0,
    );
  } finally {
    reader.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("authorised apply revalidates a racing WAL after BEGIN IMMEDIATE and before its first query", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const setup = new Database(dbPath);
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();
  const evidencePath = createBackupEvidence(directory, dbPath);
  const generatedAt = "2026-07-27T10:00:00.000Z";
  const env = authorisedEnvironment();
  const inspection = inspectDatabase({
    databasePath: dbPath,
    generatedAt,
  });
  const backupVerification = verifyBackupEvidence({
    evidencePath,
    databasePath: dbPath,
    generatedAt,
  });
  const plan = buildCutoverPlan({
    inspection,
    applyRequested: true,
    cutoverId: "cutover-test-racing-wal",
    sourceCommitSha: "3".repeat(40),
    runtimeCommitSha: "3".repeat(40),
    confirmationId: "cutover-test-racing-wal",
    backupVerification,
    env,
  });
  assert.equal(plan.verdict, "READY_TO_APPLY");

  let racingWriter = null;
  function RacingDatabase(filePath, databaseOptions) {
    const db = new Database(filePath, databaseOptions);
    if (databaseOptions?.readonly !== true) {
      racingWriter = new Database(filePath, { fileMustExist: true });
      racingWriter.pragma("wal_autocheckpoint = 0");
      racingWriter
        .prepare(
          `INSERT INTO operator_audit_log
             (actor_id, action, target_type, target_id, decision, reason,
              evidence_json, created_at)
           VALUES ('race', 'external_racing_write', 'sqlite_database',
                   'race', 'OBSERVED', 'test race', '{}', ?)`,
        )
        .run(generatedAt);
      assert.ok(fs.statSync(`${filePath}-wal`).size > 0);
    }
    return db;
  }

  try {
    assert.throws(
      () =>
        executeCutoverApply({
          databasePath: dbPath,
          plan,
          env,
          DatabaseImpl: RacingDatabase,
        }),
      /source_database_wal_not_checkpointed/,
    );
    assert.equal(
      racingWriter
        .prepare(
          `SELECT COUNT(*) FROM operator_audit_log
           WHERE action = 'stabilisation_cutover_reconcile'`,
        )
        .pluck()
        .get(),
      0,
    );
  } finally {
    if (racingWriter) racingWriter.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("authorised apply quarantines unsafe debt, reaps only safe stale work and installs the canonical windows atomically", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  const past = "2026-07-27T08:00:00.000Z";
  const engage = db
    .prepare(
      `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, claimed_by,
       claimed_at, lease_until, created_at, updated_at)
    VALUES
      ('engage', 'running', ?, 1, 3, 'growth-worker', ?, ?, ?, ?)
  `,
    )
    .run(past, past, past, past, past);
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'growth-worker', 1, 'running', ?)
  `,
  ).run(engage.lastInsertRowid, past);
  const analytics = db
    .prepare(
      `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, claimed_by,
       claimed_at, lease_until, created_at, updated_at)
    VALUES
      ('analytics', 'claimed', ?, 1, 3, 'safe-worker', ?, ?, ?, ?)
  `,
    )
    .run(past, past, past, past, past);
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'safe-worker', 1, 'running', ?)
  `,
  ).run(analytics.lastInsertRowid, past);
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'unrelated-worker', 1, 'running', ?)
  `,
  ).run(analytics.lastInsertRowid, past);
  const terminalAnalytics = db
    .prepare(
      `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, claimed_by,
       claimed_at, lease_until, created_at, updated_at)
    VALUES
      ('analytics', 'running', ?, 3, 3, 'terminal-worker', ?, ?, ?, ?)
  `,
    )
    .run(past, past, past, past, past);
  db.prepare(
    `
    INSERT INTO job_runs
      (job_id, worker_id, attempt, status, started_at)
    VALUES (?, 'terminal-worker', 3, 'running', ?)
  `,
  ).run(terminalAnalytics.lastInsertRowid, past);
  db.prepare(
    `
    INSERT INTO jobs
      (kind, status, run_at, attempt_count, max_attempts, created_at,
       updated_at, completed_at)
    VALUES
      ('publish', 'done', ?, 1, 3, ?, ?, ?)
  `,
  ).run(past, past, past, past);
  db.prepare(
    `
    INSERT INTO schedules (name, kind, cron_expr, payload, enabled)
    VALUES ('engage_after_publish', 'engage', '30 19 * * *', '{}', 1)
  `,
  ).run();
  db.prepare(
    `
    INSERT INTO runtime_leases
      (name, owner_id, acquired_at, heartbeat_at, expires_at, metadata)
    VALUES
      ('scheduler:primary', 'stopped-scheduler', ?, ?, ?, ?)
  `,
  ).run(
    "2026-07-27T07:00:00.000Z",
    "2026-07-27T07:05:00.000Z",
    "2026-07-27T08:00:00.000Z",
    JSON.stringify({ purpose: "single_owner_scheduler_dispatch" }),
  );
  db.close();
  const evidencePath = createBackupEvidence(directory, dbPath);

  try {
    runTool(
      [
        "--database",
        dbPath,
        "--backup-evidence",
        evidencePath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-004",
        "--confirm-cutover-id",
        "cutover-test-004",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "d".repeat(40),
        "--runtime-commit-sha",
        "d".repeat(40),
        "--apply",
      ],
      authorisedEnvironment(),
    );
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );

    assert.equal(result.mode, "APPLY");
    assert.equal(result.verdict, "APPLIED");
    assert.equal(result.apply_authorised, true);
    assert.equal(result.safety.production_database_mutated, true);
    assert.equal(result.safety.external_objects_created, false);
    assert.equal(result.safety.oauth_or_tokens_mutated, false);
    assert.equal(result.safety.scheduler_lease_claimed, false);
    assert.ok(
      result.mutations_performed.some((entry) => entry.action === "QUARANTINE"),
    );
    assert.ok(
      result.mutations_performed.some(
        (entry) => entry.action === "REQUEUE_EXPIRED_SAFE_LEASE",
      ),
    );

    const check = new Database(dbPath, { readonly: true });
    const pendingPublish = check
      .prepare("SELECT * FROM jobs WHERE id = 1")
      .get();
    const heldEngage = check
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(engage.lastInsertRowid);
    const requeuedAnalytics = check
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(analytics.lastInsertRowid);
    const historicalDone = check
      .prepare("SELECT * FROM jobs WHERE kind = 'publish' AND status = 'done'")
      .get();
    const terminalFailure = check
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(terminalAnalytics.lastInsertRowid);
    assert.equal(pendingPublish.status, "cancelled");
    assert.match(pendingPublish.last_error, /stabilisation_cutover_quarantine/);
    assert.equal(heldEngage.status, "cancelled");
    assert.equal(heldEngage.claimed_by, null);
    assert.equal(requeuedAnalytics.status, "pending");
    assert.equal(requeuedAnalytics.claimed_by, null);
    assert.equal(requeuedAnalytics.lease_until, null);
    assert.equal(historicalDone.status, "done");
    assert.equal(terminalFailure.status, "failed");
    assert.equal(terminalFailure.completed_at, "2026-07-27T10:00:00.000Z");

    const engageRun = check
      .prepare("SELECT * FROM job_runs WHERE job_id = ?")
      .get(engage.lastInsertRowid);
    const analyticsRun = check
      .prepare(
        `SELECT * FROM job_runs
         WHERE job_id = ? AND worker_id = 'safe-worker'`,
      )
      .get(analytics.lastInsertRowid);
    const unrelatedRun = check
      .prepare(
        `SELECT * FROM job_runs
         WHERE job_id = ? AND worker_id = 'unrelated-worker'`,
      )
      .get(analytics.lastInsertRowid);
    assert.equal(engageRun.status, "failed");
    assert.equal(engageRun.error_message, "stabilisation_cutover_quarantined");
    assert.equal(analyticsRun.status, "failed");
    assert.equal(analyticsRun.error_message, "job_lease_expired_and_reaped");
    assert.equal(unrelatedRun.status, "running");
    assert.equal(unrelatedRun.finished_at, null);

    const activePublishSchedules = check
      .prepare(
        `SELECT * FROM schedules
         WHERE kind = 'publish' AND enabled = 1
         ORDER BY name`,
      )
      .all();
    assert.deepEqual(
      activePublishSchedules.map((row) => [row.name, row.cron_expr]),
      [
        ["publish_morning", "0 9 * * *"],
        ["publish_primary", "0 19 * * *"],
      ],
    );
    for (const schedule of activePublishSchedules) {
      const payload = JSON.parse(schedule.payload);
      assert.equal(payload.target_platform, "youtube");
      assert.equal(payload.scheduler_profile, "stabilisation_30d");
      assert.deepEqual(payload.cadence_policy, {
        rolling_window_hours: 24,
        max_publish_windows: 2,
        minimum_gap_hours: 4,
        catch_up: false,
      });
    }
    assert.equal(
      check
        .prepare(
          "SELECT enabled FROM schedules WHERE name = 'engage_after_publish'",
        )
        .get().enabled,
      0,
    );
    const preservedLease = check
      .prepare("SELECT * FROM runtime_leases WHERE name = 'scheduler:primary'")
      .get();
    assert.equal(preservedLease.owner_id, "stopped-scheduler");
    assert.equal(preservedLease.expires_at, "2026-07-27T08:00:00.000Z");

    const audits = check
      .prepare(
        `SELECT * FROM operator_audit_log
         WHERE action = 'stabilisation_cutover_reconcile'`,
      )
      .all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].target_id, "cutover-test-004");
    assert.equal(audits[0].decision, "APPLIED");
    const auditEvidence = JSON.parse(audits[0].evidence_json);
    assert.equal(auditEvidence.backup.backup_id, "backup-cutover-test");
    assert.equal(auditEvidence.safety.external_objects_created, false);
    assert.equal(auditEvidence.safety.oauth_or_tokens_mutated, false);
    assert.equal(auditEvidence.safety.scheduler_lease_claimed, false);
    check.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("repeating the same authorised cutover ID is an audited idempotent no-op", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const evidencePath = createBackupEvidence(directory, dbPath);
  const args = [
    "--database",
    dbPath,
    "--backup-evidence",
    evidencePath,
    "--out-dir",
    outDir,
    "--cutover-id",
    "cutover-test-005",
    "--confirm-cutover-id",
    "cutover-test-005",
    "--generated-at",
    "2026-07-27T10:00:00.000Z",
    "--source-commit-sha",
    "e".repeat(40),
    "--runtime-commit-sha",
    "e".repeat(40),
    "--apply",
  ];

  try {
    runTool(args, authorisedEnvironment());
    runTool(args, authorisedEnvironment());
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );

    assert.equal(result.mode, "APPLY");
    assert.equal(result.verdict, "IDEMPOTENT_NOOP");
    assert.equal(result.safety.production_database_mutated, false);
    assert.deepEqual(result.mutations_performed, []);
    assert.ok(result.prior_mutations.length > 0);

    const db = new Database(dbPath, { readonly: true });
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'stabilisation_cutover_reconcile'
             AND target_id = 'cutover-test-005'`,
        )
        .get().count,
      1,
    );
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an idempotent retry holds if risky state reappeared after the audited cutover", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const evidencePath = createBackupEvidence(directory, dbPath);
  const args = [
    "--database",
    dbPath,
    "--backup-evidence",
    evidencePath,
    "--out-dir",
    outDir,
    "--cutover-id",
    "cutover-test-005-drift",
    "--confirm-cutover-id",
    "cutover-test-005-drift",
    "--generated-at",
    "2026-07-27T10:00:00.000Z",
    "--source-commit-sha",
    "e".repeat(40),
    "--runtime-commit-sha",
    "e".repeat(40),
    "--apply",
  ];

  try {
    runTool(args, authorisedEnvironment());
    const db = new Database(dbPath);
    db.prepare(
      `
      INSERT INTO jobs
        (kind, status, run_at, attempt_count, max_attempts, created_at,
         updated_at)
      VALUES
        ('publish', 'pending', ?, 0, 3, ?, ?)
    `,
    ).run(
      "2026-07-27T10:01:00.000Z",
      "2026-07-27T10:01:00.000Z",
      "2026-07-27T10:01:00.000Z",
    );
    const driftedJobId = Number(
      db.prepare("SELECT last_insert_rowid() AS id").get().id,
    );
    db.close();

    runTool(args, authorisedEnvironment());
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.apply_authorised, false);
    assert.ok(result.blockers.includes("cutover_idempotent_state_drift"));
    assert.deepEqual(result.mutations_performed, []);

    const check = new Database(dbPath, { readonly: true });
    assert.equal(
      check.prepare("SELECT status FROM jobs WHERE id = ?").get(driftedJobId)
        .status,
      "pending",
    );
    assert.equal(
      check
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'stabilisation_cutover_reconcile'
             AND target_id = 'cutover-test-005-drift'`,
        )
        .get().count,
      1,
    );
    check.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an apply failure rolls every database change back and still writes failure proof", () => {
  const directory = workspace();
  const dbPath = createFixture(directory);
  const outDir = path.join(directory, "proof");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TRIGGER fail_cutover_schedule_disable
    BEFORE UPDATE OF enabled ON schedules
    WHEN OLD.name = 'publish_legacy_three' AND NEW.enabled = 0
    BEGIN
      SELECT RAISE(ABORT, 'fixture_schedule_disable_failed');
    END;
  `);
  db.close();
  const evidencePath = createBackupEvidence(directory, dbPath);
  const beforeHash = sha256(dbPath);

  try {
    const execution = runToolAllowFailure(
      [
        "--database",
        dbPath,
        "--backup-evidence",
        evidencePath,
        "--out-dir",
        outDir,
        "--cutover-id",
        "cutover-test-006",
        "--confirm-cutover-id",
        "cutover-test-006",
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "f".repeat(40),
        "--runtime-commit-sha",
        "f".repeat(40),
        "--apply",
      ],
      authorisedEnvironment(),
    );
    assert.equal(execution.status, 1);
    const result = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "stabilisation_cutover_result.json"),
        "utf8",
      ),
    );
    assert.equal(result.mode, "APPLY");
    assert.equal(result.verdict, "ROLLED_BACK");
    assert.equal(result.rollback_verified, true);
    assert.equal(result.safety.production_database_mutated, false);
    assert.deepEqual(result.mutations_performed, []);
    assert.ok(
      result.blockers.includes("apply_failed:fixture_schedule_disable_failed"),
    );
    assert.equal(sha256(dbPath), beforeHash);

    const check = new Database(dbPath, { readonly: true });
    assert.equal(
      check.prepare("SELECT status FROM jobs WHERE id = 1").get().status,
      "pending",
    );
    assert.equal(
      check
        .prepare(
          `SELECT COUNT(*) AS count
           FROM schedules
           WHERE enabled = 0`,
        )
        .get().count,
      0,
    );
    assert.equal(
      check.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      0,
    );
    check.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
