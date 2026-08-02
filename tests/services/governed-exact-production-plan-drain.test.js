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
  inspectWindowsPulseQuiescence,
  normaliseQuiescence,
  quiescenceDiagnosticsForObservation,
} = require("../../lib/ops/governed-exact-production-plan-drain");
const {
  acquireLiveRuntimeTransitionLease,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");
const {
  BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
} = require("../../lib/stabilisation/bounded-runtime-db-authority");
const {
  profileFingerprint,
} = require("../../lib/stabilisation/windows-local-runtime-supervisor");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const EXPECTED_COMMIT = "a".repeat(40);
const BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1";
const STOPPED_AUTHORITY_FINGERPRINT = "4".repeat(64);
const STOPPED_OBSERVATION_SHA256 = "5".repeat(64);
const STOPPED_DATABASE_SNAPSHOT_SHA256 = "6".repeat(64);

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

function completeDatabaseState(db) {
  const tables = db
    .prepare(
      `SELECT name
       FROM main.sqlite_schema
       WHERE type = 'table'
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  return Object.fromEntries(
    tables.map((table) => {
      const quoted = String(table).replaceAll('"', '""');
      return [table, db.prepare(`SELECT * FROM "${quoted}" ORDER BY rowid`).all()];
    }),
  );
}

function databaseTotalChanges(db) {
  return db.prepare("SELECT total_changes() AS count").get().count;
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
    schema: BOUNDED_AUTHORITY_SCHEMA,
    verdict: "GREEN",
    state: "STOPPED_BOUND",
    authority_fingerprint: STOPPED_AUTHORITY_FINGERPRINT,
    runtime_instance_id: null,
    observation_sha256: STOPPED_OBSERVATION_SHA256,
    database_snapshot_sha256: STOPPED_DATABASE_SNAPSHOT_SHA256,
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
    absent_task_names: ["PulseGaming-Fixture", "PulseGaming-Fixture-Legacy"],
    ...overrides,
  };
}

function boundedWindowsFixture(overrides = {}) {
  const profile = {
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
    port: 3001,
    state_root: "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube",
    activation_receipt_path:
      "D:\\pulse-data\\runtime\\pulse-live-guarded-youtube\\activation-receipt.json",
  };
  const expected = {
    taskName: profile.task_name,
    nodePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    checkoutRealPath: "D:\\pulse-live",
    releaseSha: EXPECTED_COMMIT,
    profileSha256: profileFingerprint(profile),
    databaseIdentitySha256: "7".repeat(64),
  };
  const calls = [];
  const probes = {
    async taskDefinitionInspector() {
      calls.push("task-definition");
      return {
        task_name: profile.task_name,
        state: "managed_disabled",
        blockers: [],
      };
    },
    async taskInstancesInspector() {
      calls.push("task-instances");
      return { ok: true, instances: [], blockers: [] };
    },
    async conflictInspector() {
      calls.push("conflicts");
      return {
        clear: true,
        tasks: [
          {
            task_name: profile.conflicting_task_names[0],
            state: "disabled",
          },
        ],
        blockers: [],
      };
    },
    async activationReceiptInspector() {
      calls.push("activation");
      return { present: false, blockers: [] };
    },
    async ownerReceiptInspector() {
      calls.push("owner");
      return { state: "absent", blockers: [] };
    },
    async listenerInspector() {
      calls.push("listener");
      return { available: true, listeningPids: [], blockers: [] };
    },
    async databaseAuthorityInspector() {
      calls.push("database");
      return {
        ok: true,
        database_identity_sha256: expected.databaseIdentitySha256,
        snapshot_sha256: STOPPED_DATABASE_SNAPSHOT_SHA256,
        blockers: [],
      };
    },
    ...(overrides.probes || {}),
  };
  return { profile, expected, probes, calls };
}

async function inspectBoundedWindowsFixture(fixture, overrides = {}) {
  return inspectWindowsPulseQuiescence({
    platform: "win32",
    profile: fixture.profile,
    workspaceRoot: fixture.expected.checkoutRealPath,
    checkoutRealPath: fixture.expected.checkoutRealPath,
    expectedCommit: fixture.expected.releaseSha,
    nodeExecutable: fixture.expected.nodePath,
    nodeRealPath: fixture.expected.nodePath,
    databaseIdentitySha256: fixture.expected.databaseIdentitySha256,
    taskDefinitionInspector: fixture.probes.taskDefinitionInspector,
    taskInstancesInspector: fixture.probes.taskInstancesInspector,
    conflictInspector: fixture.probes.conflictInspector,
    activationReceiptInspector: fixture.probes.activationReceiptInspector,
    ownerReceiptInspector: fixture.probes.ownerReceiptInspector,
    listenerInspector: fixture.probes.listenerInspector,
    databaseAuthorityInspector: fixture.probes.databaseAuthorityInspector,
    ...overrides,
  });
}

test("bounded Windows quiescence adapts only an exact stable STOPPED_BOUND authority", async () => {
  const fixture = boundedWindowsFixture();
  const result = await inspectBoundedWindowsFixture(fixture);

  assert.equal(result.available, true);
  assert.equal(result.schema, BOUNDED_AUTHORITY_SCHEMA);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "STOPPED_BOUND");
  assert.match(result.authority_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.observation_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.database_snapshot_sha256,
    STOPPED_DATABASE_SNAPSHOT_SHA256,
  );
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.absent_task_names, [
    fixture.profile.task_name,
    fixture.profile.conflicting_task_names[0],
  ].sort());
  assert.deepEqual(
    Object.fromEntries(
      [...new Set(fixture.calls)].map((name) => [
        name,
        fixture.calls.filter((entry) => entry === name).length,
      ]),
    ),
    {
      activation: 2,
      conflicts: 2,
      database: 2,
      listener: 2,
      owner: 2,
      "task-definition": 2,
      "task-instances": 2,
    },
  );
});

test("bounded Windows quiescence maps every occupied or unstable targeted boundary to secret-safe HOLD", async (t) => {
  const cases = [
    {
      name: "exact task active",
      probes: {
        taskDefinitionInspector: async () => ({
          task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
          state: "managed_current",
          blockers: [],
        }),
      },
    },
    {
      name: "legacy conflict active",
      probes: {
        conflictInspector: async () => ({
          clear: false,
          tasks: [
            {
              task_name: "PulseGaming-Stabilisation-Runtime",
              state: "enabled",
            },
          ],
          blockers: ["SECRET_CONFLICT_DETAIL"],
        }),
      },
    },
    {
      name: "activation receipt present",
      probes: {
        activationReceiptInspector: async () => ({
          present: true,
          blockers: [],
          raw_secret: "SECRET_ACTIVATION",
        }),
      },
    },
    {
      name: "owner receipt present",
      probes: {
        ownerReceiptInspector: async () => ({
          state: "active",
          blockers: [],
          raw_secret: "SECRET_OWNER",
        }),
      },
    },
    {
      name: "listener present",
      probes: {
        listenerInspector: async () => ({
          available: true,
          listeningPids: [4400],
          blockers: [],
        }),
      },
    },
    {
      name: "database lease active",
      probes: {
        databaseAuthorityInspector: async () => ({
          ok: false,
          database_identity_sha256: "7".repeat(64),
          snapshot_sha256: "6".repeat(64),
          blockers: ["SECRET_DATABASE_LEASE_OWNER"],
        }),
      },
    },
    {
      name: "probe error",
      probes: {
        taskInstancesInspector: async () => {
          throw new Error("SECRET_PROBE_FAILURE");
        },
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fixture = boundedWindowsFixture({ probes: entry.probes });
      const result = await inspectBoundedWindowsFixture(fixture);
      assert.equal(result.available, false);
      assert.equal(result.schema, BOUNDED_AUTHORITY_SCHEMA);
      assert.equal(result.verdict, "HOLD");
      assert.equal(result.state, "HOLD");
      assert.deepEqual(result.blockers, [
        "exact_plan_runtime_quiescence_inspection_unavailable",
      ]);
      assert.equal(JSON.stringify(result).includes("SECRET"), false);
    });
  }

  await t.test("unstable double observation", async () => {
    let reads = 0;
    const fixture = boundedWindowsFixture({
      probes: {
        taskDefinitionInspector: async () => ({
          task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
          state: reads++ === 0 ? "managed_disabled" : "absent",
          blockers: [],
        }),
      },
    });
    const result = await inspectBoundedWindowsFixture(fixture);
    assert.equal(result.available, false);
    assert.equal(result.state, "HOLD");
    assert.deepEqual(result.blockers, [
      "exact_plan_runtime_quiescence_inspection_unavailable",
    ]);
  });
});

test("the compatibility adapter rejects malformed injected GREEN and thrown raw errors", async () => {
  const fixture = boundedWindowsFixture();
  for (const boundedAuthorityInspector of [
    async () => ({
      schema: "wrong-schema",
      verdict: "GREEN",
      state: "STOPPED_BOUND",
      authority_fingerprint: "4".repeat(64),
      observation_sha256: "5".repeat(64),
      database_snapshot_sha256: "6".repeat(64),
      blockers: [],
    }),
    async () => {
      throw new Error("SECRET_INJECTED_INSPECTOR_FAILURE");
    },
  ]) {
    const result = await inspectBoundedWindowsFixture(fixture, {
      boundedAuthorityInspector,
    });
    assert.equal(result.available, false);
    assert.equal(result.state, "HOLD");
    assert.deepEqual(result.blockers, [
      "exact_plan_runtime_quiescence_inspection_unavailable",
    ]);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
  }
});

test("the default bounded task-definition probe fails closed when task inspection is unavailable", async () => {
  const fixture = boundedWindowsFixture();
  const result = await inspectBoundedWindowsFixture(fixture, {
    taskDefinitionInspector: null,
    execFileSyncImpl() {
      throw new Error("SECRET_TASK_PROBE_FAILURE");
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.state, "HOLD");
  assert.deepEqual(result.blockers, [
    "exact_plan_runtime_quiescence_inspection_unavailable",
  ]);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("an authoritative root-task enumeration can prove the exact task absent", async () => {
  const fixture = boundedWindowsFixture();
  const result = await inspectBoundedWindowsFixture(fixture, {
    taskDefinitionInspector: null,
    taskInstancesInspector: null,
    execFileSyncImpl(executable) {
      assert.equal(executable, "powershell.exe");
      return JSON.stringify({
        Present: false,
        ExactName: null,
        MatchCount: 0,
      });
    },
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "STOPPED_BOUND");
  assert.deepEqual(result.blockers, []);
});

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

test("the real bounded double-read gates each exact claim while the database is quiescent", async (t) => {
  const values = await fixture(t);
  const roles = [];
  const activeClaimSamples = [];
  const preClaimSamples = [];
  const profile = rewriteProfile(values, (entry) => {
    entry.task_name = "PulseGaming-LiveGuarded-YouTube-Runtime";
    entry.conflicting_task_names = ["PulseGaming-Stabilisation-Runtime"];
  });
  const boundedProbeDependencies = {
    quiescenceInspector: null,
    platform: "win32",
    taskDefinitionInspector: async () => ({
        task_name: profile.task_name,
        state: "managed_disabled",
        blockers: [],
    }),
    taskInstancesInspector: async () => ({
        ok: true,
        instances: [],
        blockers: [],
    }),
    conflictInspector: async () => ({
        clear: true,
        tasks: profile.conflicting_task_names.map((taskName) => ({
          task_name: taskName,
          state: "disabled",
        })),
        blockers: [],
    }),
    activationReceiptInspector: async () => ({
        present: false,
        blockers: [],
    }),
    ownerReceiptInspector: async () => ({
        state: "absent",
        blockers: [],
    }),
    listenerInspector: async () => ({
        available: true,
        listeningPids: [],
        blockers: [],
    }),
    databaseAuthorityInspector: async ({ expected }) => {
        const activeClaimCount = values.db
          .prepare(
            "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('claimed', 'running')",
          )
          .get().count;
        const openJobRunCount = values.db
          .prepare(
            "SELECT COUNT(*) AS count FROM job_runs WHERE finished_at IS NULL",
          )
          .get().count;
        activeClaimSamples.push(activeClaimCount);
        const ok = activeClaimCount === 0 && openJobRunCount === 0;
        return {
          schema: BOUNDED_RUNTIME_DB_AUTHORITY_SCHEMA,
          ok,
          mode: "QUIESCENT",
          database_identity_sha256: expected.database_identity_sha256,
          snapshot_sha256: sha256(
            JSON.stringify({ activeClaimCount, openJobRunCount }),
          ),
          blockers: [
            ...(activeClaimCount > 0
              ? ["runtime_db_quiescent_active_job_present"]
              : []),
            ...(openJobRunCount > 0
              ? ["runtime_db_quiescent_open_job_run_present"]
              : []),
          ],
        };
    },
  };

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async (job) => {
        preClaimSamples.push(activeClaimSamples.slice(-2));
        roles.push(job.payload.autonomous_production_job.builder_result.role);
        return greenProductionResult();
      },
      boundedProbeDependencies,
    ),
  );

  assert.equal(
    result.verdict,
    "GREEN",
    JSON.stringify({
      blockers: result.blockers,
      roles,
      activeClaimSamples,
    }),
  );
  assert.deepEqual(roles, ["PRIMARY", "STANDBY"]);
  assert.deepEqual(preClaimSamples, [
    [0, 0],
    [0, 0],
  ]);
  assert.equal(activeClaimSamples.includes(1), true);
  assert.equal(
    activeClaimSamples.every((count) => count === 0 || count === 1),
    true,
  );
});

test("claim authority permits fail before database mutation on age or context drift", async (t) => {
  const cases = [
    {
      name: "expired before synchronous claim",
      dependencies: () => {
        let reads = 0;
        return {
          claimPermitClock() {
            reads += 1;
            return reads === 1 ? 0 : 5_001;
          },
        };
      },
    },
    {
      name: "authority context drift before synchronous claim",
      dependencies: () => ({
        claimPermitAuthorityContextProvider: () => "9".repeat(64),
      }),
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const values = await fixture(t);
      const initialDatabaseState = completeDatabaseState(values.db);
      let handlerCalls = 0;
      let stateAtPermitIssuance = null;
      let changesAtPermitIssuance = null;
      const scenarioDependencies = scenario.dependencies();
      const scenarioClock = scenarioDependencies.claimPermitClock || (() => 0);
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            handlerCalls += 1;
            return greenProductionResult();
          },
          {
            ...scenarioDependencies,
            claimPermitClock() {
              if (stateAtPermitIssuance === null) {
                stateAtPermitIssuance = completeDatabaseState(values.db);
                changesAtPermitIssuance = databaseTotalChanges(values.db);
              }
              return scenarioClock();
            },
          },
        ),
      );

      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes("exact_plan_claim_authority_permit_invalid"),
      );
      assert.equal(handlerCalls, 0);
      for (const planned of values.planned.plan.production_jobs) {
        const row = values.jobs.get(planned.job_id);
        assert.equal(row.status, "pending");
        assert.equal(row.attempt_count, 0);
      }
      assert.notEqual(stateAtPermitIssuance, null);
      const finalDatabaseState = completeDatabaseState(values.db);
      assert.deepEqual(
        Object.keys(finalDatabaseState).filter(
          (table) =>
            table !== "runtime_leases" &&
            canonicalSha256(finalDatabaseState[table]) !==
            canonicalSha256(stateAtPermitIssuance[table]),
        ),
        [],
      );
      assert.deepEqual(
        finalDatabaseState.runtime_leases,
        stateAtPermitIssuance.runtime_leases.filter(
          (row) => row.name !== LIVE_RUNTIME_TRANSITION_LEASE_NAME,
        ),
      );
      const finalDatabaseChanges = databaseTotalChanges(values.db);
      // Only the mandatory transition-lease renewal and fenced release may
      // write after permit issuance. A runner registration or heartbeat would
      // increase this count and leave worker state behind.
      assert.equal(finalDatabaseChanges - changesAtPermitIssuance, 2);
      assert.deepEqual(finalDatabaseState, initialDatabaseState);
    });
  }
});

test("each one-use claim permit authorises exactly one exact job claim", async (t) => {
  const values = await fixture(t);
  const secondClaims = [];
  const roles = [];

  class DoubleClaimRunner {
    constructor(options) {
      this.options = options;
      this.running = false;
      this.current = null;
      this.work = null;
    }

    async start() {
      this.running = true;
      this.work = (async () => {
        while (this.running && roles.length < 2) {
          const repos = this.options.reposProvider();
          const claimOptions = {
            kinds: this.options.kinds,
            gpu: this.options.gpu,
            leaseMs: this.options.leaseMs,
          };
          const first = repos.jobs.claim(
            this.options.workerId,
            claimOptions,
          );
          if (!first) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            continue;
          }
          secondClaims.push(
            repos.jobs.claim(this.options.workerId, claimOptions),
          );
          this.current = first;
          try {
            const result = await this.options.handlers[first.kind](first, {
              workerId: this.options.workerId,
              repos,
              signal: new AbortController().signal,
            });
            repos.jobs.complete(
              first.id,
              this.options.workerId,
              first.claim_token,
              { log: JSON.stringify(result) },
            );
          } catch (error) {
            repos.jobs.fail(
              first.id,
              this.options.workerId,
              first.claim_token,
              error,
            );
            await this.options.onError(error, first);
          } finally {
            this.current = null;
          }
        }
      })();
    }

    async stop() {
      this.running = false;
      await this.work;
      return { drained: true };
    }
  }

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async (job) => {
        roles.push(job.payload.autonomous_production_job.builder_result.role);
        return greenProductionResult();
      },
      { JobsRunnerClass: DoubleClaimRunner },
    ),
  );

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(roles, ["PRIMARY", "STANDBY"]);
  assert.deepEqual(secondClaims, [null, null]);
  for (const planned of values.planned.plan.production_jobs) {
    assert.equal(values.jobs.get(planned.job_id).attempt_count, 1);
  }
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
      schema: BOUNDED_AUTHORITY_SCHEMA,
      verdict: "HOLD",
      state: "HOLD",
      authority_fingerprint: null,
      runtime_instance_id: null,
      observation_sha256: null,
      database_snapshot_sha256: null,
      blockers: [
        "exact_plan_runtime_quiescence_inspection_unavailable",
      ],
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
      diagnostics: {
        probe: "aggregate",
        kind: "UNAVAILABLE",
        pids: [],
        task_identities: [],
        reasons: ["PROBE_ATTESTATION_INCOMPLETE"],
      },
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
  await t.test(
    "acquires only after STOPPED_BOUND and binds the exact authority fingerprint",
    async (t) => {
      const values = await fixture(t);
      let inspectionCount = 0;
      let acquiredOptions = null;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => greenProductionResult(), {
          quiescenceInspector() {
            inspectionCount += 1;
            return quiescentInspection();
          },
          transitionLeaseAcquirer(options) {
            acquiredOptions = {
              ...options,
              inspections_before_acquire: inspectionCount,
            };
            return {
              renew: () => true,
              release: () => true,
            };
          },
        }),
      );

      assert.equal(result.verdict, "GREEN", JSON.stringify(result));
      assert.equal(acquiredOptions.inspections_before_acquire, 1);
      assert.equal(
        acquiredOptions.authorityContextSha256,
        STOPPED_AUTHORITY_FINGERPRINT,
      );
      assert.equal(
        result.runtime_transition_lease.authority_context_sha256,
        STOPPED_AUTHORITY_FINGERPRINT,
      );
      assert.ok(inspectionCount >= 2);
    },
  );

  await t.test(
    "authority drift after acquire holds before reservation, claim or production",
    async (t) => {
      const values = await fixture(t);
      let inspectionCount = 0;
      let productionCalls = 0;
      let acquiredContext = null;

      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            productionCalls += 1;
            return greenProductionResult();
          },
          {
            quiescenceInspector() {
              inspectionCount += 1;
              return quiescentInspection({
                authority_fingerprint:
                  inspectionCount === 1
                    ? STOPPED_AUTHORITY_FINGERPRINT
                    : "8".repeat(64),
              });
            },
            transitionLeaseAcquirer(options) {
              acquiredContext = options.authorityContextSha256;
              return {
                renew: () => true,
                release: () => true,
              };
            },
          },
        ),
      );

      assert.equal(acquiredContext, STOPPED_AUTHORITY_FINGERPRINT);
      assert.equal(result.verdict, "HOLD");
      assert.ok(
        result.blockers.includes(
          "exact_plan_runtime_authority_context_drift",
        ),
      );
      assert.equal(productionCalls, 0);
      assert.equal(
        fs.existsSync(
          path.join(values.outputDir, "exact-plan-drain-reservation.json"),
        ),
        false,
      );
      for (const job of values.planned.plan.production_jobs) {
        assert.equal(values.jobs.get(job.job_id).status, "pending");
      }
    },
  );

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
        authority_context_sha256: STOPPED_AUTHORITY_FINGERPRINT,
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
    "release failure cannot return success after a post-link heartbeat loss invalidates GREEN evidence",
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
        false,
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
    request(values, { timeout_ms: 1500, poll_interval_ms: 5 }),
    dependencies(values, async (job, ctx) => {
      seen.push(job.payload.autonomous_production_job.builder_result.role);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
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
      timeout_ms: 500,
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
  await new Promise((resolve) => setTimeout(resolve, 2100));
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

test("a non-null raw ambiguity diagnostic cannot be normalised into a quiescent GREEN observation", () => {
  const secretTaskIdentity = "AWS_SECRET_ACCESS_KEY_DIAGNOSTIC_TASK";
  const profile = {
    task_name: "PulseGaming-Fixture",
    conflicting_task_names: ["PulseGaming-Fixture-Legacy"],
  };
  const report = normaliseQuiescence(
    quiescentInspection({
      diagnostics: {
        probe: "processes",
        kind: "AMBIGUOUS",
        pids: [999],
        task_identities: [secretTaskIdentity],
        reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
      },
    }),
    profile,
  );
  assert.equal(report.available, false);
  assert.deepEqual(report.probe_attestations, {
    listeners: false,
    processes: false,
    scheduled_tasks: false,
  });
  assert.deepEqual(report.diagnostics, {
    probe: "processes",
    kind: "AMBIGUOUS",
    pids: [999],
    task_identities: [],
    reasons: ["OPAQUE_ENCODED_POWERSHELL_HOST"],
  });
  assert.equal(JSON.stringify(report).includes(secretTaskIdentity), false);

  const consistentOccupied = normaliseQuiescence(
    quiescentInspection({
      owner_pids: [42],
      diagnostics: {
        probe: "aggregate",
        kind: "OCCUPIED",
        pids: [42],
        task_identities: [],
        reasons: ["OWNER_PIDS_PRESENT"],
      },
    }),
    profile,
  );
  assert.equal(consistentOccupied.available, true);
  assert.deepEqual(consistentOccupied.owner_pids, [42]);
  assert.deepEqual(consistentOccupied.diagnostics?.reasons, [
    "OWNER_PIDS_PRESENT",
  ]);
});

test("canonical drain evidence redacts and holds unreviewed task-state identities supplied by an inspector", async (t) => {
  const values = await fixture(t);
  const secretIdentity = "AWS_SECRET_ACCESS_KEY_CANONICAL_EVIDENCE";
  let productionCalls = 0;
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(
      values,
      async () => {
        productionCalls += 1;
        return greenProductionResult();
      },
      {
        quiescenceInspector: () =>
          quiescentInspection({
            task_states: [
              {
                task_name: secretIdentity,
                task_path: `\\Hidden\\${secretIdentity}`,
                state: "Ready",
                enabled: false,
              },
            ],
          }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes(
      "exact_plan_runtime_quiescence_inspection_unavailable",
    ),
  );
  assert.equal(productionCalls, 0);
  assert.ok(result.runtime_quiescence.checks.length > 0);
  assert.deepEqual(result.runtime_quiescence.checks[0].task_states, [
    {
      task_name: "UNREVIEWED_PULSE_TASK",
      task_path: "UNREVIEWED_PULSE_TASK",
      state: "Ready",
      enabled: false,
    },
  ]);
  assert.deepEqual(result.runtime_quiescence.checks[0].diagnostics, {
    probe: "scheduled_tasks",
    kind: "AMBIGUOUS",
    pids: [],
    task_identities: [],
    reasons: ["UNREVIEWED_PULSE_TASK_PRESENT"],
  });
  assert.equal(JSON.stringify(result).includes(secretIdentity), false);
});

test("malformed nonempty quiescence observations fail closed instead of normalising to GREEN", async (t) => {
  const cases = [
    {
      label: "string PID",
      observation: { owner_pids: ["4242"] },
      secret: "4242",
    },
    {
      label: "null enabled task identity",
      observation: { enabled_tasks: [null] },
      secret: null,
    },
    {
      label: "non-boolean task enabled state",
      observation: {
        task_states: [
          {
            task_name: "AWS_SECRET_ACCESS_KEY_MALFORMED_STATE",
            task_path: "\\Hidden\\AWS_SECRET_ACCESS_KEY_MALFORMED_STATE",
            state: "Ready",
            enabled: "false",
          },
        ],
      },
      secret: "AWS_SECRET_ACCESS_KEY_MALFORMED_STATE",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async (t) => {
      const values = await fixture(t);
      let productionCalls = 0;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            productionCalls += 1;
            return greenProductionResult();
          },
          {
            quiescenceInspector: () =>
              quiescentInspection(entry.observation),
          },
        ),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.ok(
        result.blockers.includes(
          "exact_plan_runtime_quiescence_inspection_unavailable",
        ),
      );
      assert.equal(productionCalls, 0);
      assert.deepEqual(result.runtime_quiescence.checks[0].diagnostics, {
        probe: "aggregate",
        kind: "UNAVAILABLE",
        pids: [],
        task_identities: [],
        reasons: ["PROBE_ATTESTATION_INCOMPLETE"],
      });
      if (entry.secret) {
        assert.equal(JSON.stringify(result).includes(entry.secret), false);
      }
    });
  }
});

test("task-state occupancy and presence cannot be erased by contradictory summary arrays", async (t) => {
  const cases = [
    {
      label: "enabled state missing from enabled summary",
      observation: {
        task_states: [
          {
            task_name: "Custom-Pulse-Enabled",
            task_path: "\\Hidden\\Custom-Pulse-Enabled",
            state: "Ready",
            enabled: true,
          },
        ],
      },
      expectedField: "enabled_tasks",
      expectedValue: "UNREVIEWED_PULSE_TASK",
      expectedBlocker: "exact_plan_runtime_quiescence_inspection_unavailable",
    },
    {
      label: "running state missing from running summary",
      observation: {
        task_states: [
          {
            task_name: "Custom-Pulse-Running",
            task_path: "\\Hidden\\Custom-Pulse-Running",
            state: "Running",
            enabled: false,
          },
        ],
      },
      expectedField: "running_tasks",
      expectedValue: "UNREVIEWED_PULSE_TASK",
      expectedBlocker: "exact_plan_runtime_quiescence_inspection_unavailable",
    },
    {
      label: "present exact task falsely listed absent",
      observation: {
        task_states: [
          {
            task_name: "PulseGaming-Fixture",
            task_path: "PulseGaming-Fixture",
            state: "Ready",
            enabled: false,
          },
        ],
      },
      expectedField: "absent_task_names",
      expectedValue: "PulseGaming-Fixture-Legacy",
      expectedBlocker: "exact_plan_live_runtime_not_quiescent",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async (t) => {
      const values = await fixture(t);
      let productionCalls = 0;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            productionCalls += 1;
            return greenProductionResult();
          },
          {
            quiescenceInspector: () =>
              quiescentInspection(entry.observation),
          },
        ),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.ok(result.blockers.includes(entry.expectedBlocker));
      assert.equal(productionCalls, 0);
      assert.deepEqual(result.runtime_quiescence.checks[0][entry.expectedField], [
        entry.expectedValue,
      ]);
    });
  }
});

test("oversized quiescence evidence fails closed before bounded persistence can hide occupancy", async (t) => {
  const benignTaskStates = Array.from({ length: 16 }, (_, index) => ({
    task_name: `Custom-Pulse-Benign-${index}`,
    task_path: `\\Hidden\\Custom-Pulse-Benign-${index}`,
    state: "Ready",
    enabled: false,
  }));
  const cases = [
    {
      label: "task state overflow",
      observation: {
        task_states: [
          ...benignTaskStates,
          {
            task_name: "PulseGaming-Fixture",
            task_path: "PulseGaming-Fixture",
            state: "Running",
            enabled: true,
          },
        ],
      },
    },
    {
      label: "PID overflow",
      observation: {
        owner_pids: Array.from({ length: 33 }, (_, index) => index + 1),
      },
    },
    {
      label: "task identity overflow",
      observation: {
        enabled_tasks: Array.from(
          { length: 17 },
          (_, index) => `Custom-Pulse-Enabled-${index}`,
        ),
      },
    },
    {
      label: "absence evidence overflow",
      observation: {
        absent_task_names: [
          "PulseGaming-Fixture",
          "PulseGaming-Fixture-Legacy",
          ...Array.from(
            { length: 15 },
            (_, index) => `Custom-Pulse-Absent-${index}`,
          ),
        ],
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.label, async (t) => {
      const values = await fixture(t);
      let productionCalls = 0;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => {
            productionCalls += 1;
            return greenProductionResult();
          },
          {
            quiescenceInspector: () =>
              quiescentInspection(entry.observation),
          },
        ),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.ok(
        result.blockers.includes(
          "exact_plan_runtime_quiescence_inspection_unavailable",
        ),
      );
      assert.equal(productionCalls, 0);
      assert.equal(result.runtime_quiescence.checks[0].available, false);
    });
  }
});

test("a successful authoritative quiescence inspection has null diagnostics", () => {
  const result = normaliseQuiescence(quiescentInspection(), {
    task_name: "PulseGaming-Fixture",
    conflicting_task_names: ["PulseGaming-Fixture-Legacy"],
  });

  assert.equal(result.available, true);
  assert.equal(result.schema, BOUNDED_AUTHORITY_SCHEMA);
  assert.equal(result.state, "STOPPED_BOUND");
  assert.deepEqual(result.owner_pids, []);
  assert.equal(result.diagnostics, null);
});

test("partial affirmative quiescence attestations retain an explicit unavailable diagnostic", () => {
  const diagnostics = quiescenceDiagnosticsForObservation(
    {
      available: true,
      probe_attestations: {
        listeners: true,
        processes: false,
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
    },
    {
      task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
      conflicting_task_names: ["PulseGaming-Stabilisation-Runtime"],
    },
  );

  assert.deepEqual(diagnostics, {
    probe: "aggregate",
    kind: "UNAVAILABLE",
    pids: [],
    task_identities: [],
    reasons: ["PROBE_ATTESTATION_INCOMPLETE"],
  });
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
        const lease = values.db
          .prepare(
            `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at,
                    metadata
               FROM runtime_leases
              WHERE name = ?`,
          )
          .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
        assert.ok(lease);
        const expiredAt = new Date(
          Date.parse(lease.acquired_at) + 1,
        ).toISOString();
        const aged = values.db
          .prepare(
            `UPDATE runtime_leases
                SET heartbeat_at = acquired_at,
                    expires_at = ?
              WHERE name = ?
                AND owner_id = ?
                AND acquired_at = ?
                AND heartbeat_at = ?
                AND expires_at = ?
                AND metadata IS ?`,
          )
          .run(
            expiredAt,
            lease.name,
            lease.owner_id,
            lease.acquired_at,
            lease.heartbeat_at,
            lease.expires_at,
            lease.metadata,
          );
        assert.equal(aged.changes, 1);
        while (Date.now() <= Date.parse(expiredAt)) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        assert.throws(
          () =>
            acquireLiveRuntimeTransitionLease({
              databasePath: values.databasePath,
              ownerId: "live-start:competitor",
              action: "live-start",
              authorityContextSha256: STOPPED_AUTHORITY_FINGERPRINT,
              leaseMs: 1000,
              runtimeTransitionLeaseFactory,
            }),
          /live_runtime_transition_lease_unavailable/,
        );
        competingBlocked = true;
        return greenProductionResult();
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

test("late immutable-authority drift cannot survive the final evidence boundary", async (t) => {
  const cases = [
    {
      name: "successor plan bytes",
      blocker: "exact_plan_file_sha256_mismatch",
      configure(values) {
        return {
          beforeEvidenceFinalise() {
            fs.appendFileSync(values.planPath, " ");
          },
        };
      },
    },
    {
      name: "reservation bytes",
      blocker: "exact_plan_reservation_file_sha256_mismatch",
      configure(values) {
        return {
          beforeEvidenceFinalise() {
            fs.appendFileSync(values.reservationPath, " ");
          },
        };
      },
    },
    {
      name: "runtime profile bytes",
      blocker: "exact_plan_runtime_profile_file_sha256_mismatch",
      configure(values) {
        return {
          beforeEvidenceFinalise() {
            const changed = JSON.parse(
              fs.readFileSync(values.profilePath, "utf8"),
            );
            changed.environment = { LATE_FINALISATION_DRIFT: "true" };
            fs.writeFileSync(
              values.profilePath,
              `${JSON.stringify(changed, null, 2)}\n`,
            );
          },
        };
      },
    },
    {
      name: "workspace checkout",
      blocker: "exact_plan_workspace_checkout_mismatch",
      configure() {
        let dirty = false;
        return {
          workspaceInspector() {
            return {
              available: true,
              commit: EXPECTED_COMMIT,
              tracked_clean: !dirty,
            };
          },
          beforeEvidenceFinalise() {
            dirty = true;
          },
        };
      },
    },
    {
      name: "completion receipt",
      blocker: "exact_plan_completion_receipt_invalid",
      configure() {
        let valid = true;
        return {
          completionReceiptInspector: async ({ attestation }) => ({
            valid,
            path: attestation.completion_receipt.path,
            file_sha256: attestation.completion_receipt.file_sha256,
            receipt_sha256: attestation.completion_receipt.receipt_sha256,
          }),
          beforeEvidenceFinalise() {
            valid = false;
          },
        };
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const values = await fixture(t);
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(
          values,
          async () => greenProductionResult(),
          entry.configure(values),
        ),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.ok(
        result.blockers.includes(entry.blocker),
        `${entry.name}:${JSON.stringify(result.blockers)}`,
      );
      assert.equal(
        fs.existsSync(
          path.join(values.outputDir, "exact-plan-drain.commit.json"),
        ),
        false,
      );
    });
  }
});

test("a late predecessor-plan byte change cannot survive the final evidence boundary", async (t) => {
  const values = await fixture(t);
  const { predecessor } = await createTimedSuccessor(values);
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      beforeEvidenceFinalise() {
        fs.appendFileSync(predecessor.path, " ");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("exact_plan_lineage_predecessor_file_sha256_mismatch"),
    JSON.stringify(result.blockers),
  );
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );
});

test("committed exact-drain evidence is rebound before GREEN is returned", async (t) => {
  const values = await fixture(t);
  let tampered = false;
  const fileSystem = new Proxy(fs.promises, {
    get(target, property, receiver) {
      if (property === "link") {
        return async (sourcePath, destinationPath) => {
          const linked = await target.link(sourcePath, destinationPath);
          if (
            String(destinationPath).endsWith("exact-plan-drain.commit.json")
          ) {
            fs.appendFileSync(
              path.join(values.outputDir, "exact-plan-drain.json"),
              "tampered-after-commit\n",
            );
            tampered = true;
          }
          return linked;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  await assert.rejects(
    drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), { fileSystem }),
    ),
    /exact_plan_drain_evidence_changed_during_commit/,
  );

  assert.equal(tampered, true);
  assert.equal(
    fs.existsSync(path.join(values.outputDir, "exact-plan-drain.commit.json")),
    false,
  );
});

test("hard-linked immutable plan inputs are rejected before any job claim", async (t) => {
  const inputs = [
    ["successor plan", "planPath"],
    ["reservation", "reservationPath"],
    ["runtime profile", "profilePath"],
  ];
  for (const [name, property] of inputs) {
    await t.test(name, async (t) => {
      const values = await fixture(t);
      const alias = path.join(values.workspaceRoot, `${property}.alias`);
      fs.linkSync(values[property], alias);
      let calls = 0;
      const result = await drainExactGovernedProductionPlan(
        request(values),
        dependencies(values, async () => {
          calls += 1;
          return greenProductionResult();
        }),
      );

      assert.equal(result.verdict, "HOLD", JSON.stringify(result));
      assert.ok(
        result.blockers.includes("exact_plan_drain_input_hardlink_forbidden"),
        JSON.stringify(result.blockers),
      );
      assert.equal(calls, 0);
    });
  }
});

test("a hard-linked predecessor plan is rejected before any successor claim", async (t) => {
  const values = await fixture(t);
  const { predecessor } = await createTimedSuccessor(values);
  fs.linkSync(
    predecessor.path,
    path.join(values.workspaceRoot, "predecessor-plan.alias.json"),
  );
  let calls = 0;
  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => {
      calls += 1;
      return greenProductionResult();
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("exact_plan_drain_input_hardlink_forbidden"),
    JSON.stringify(result.blockers),
  );
  assert.equal(calls, 0);
});

test("the evidence output directory cannot be swapped to an external junction", async (t) => {
  const values = await fixture(t);
  const outside = fs.mkdtempSync(
    path.join(path.dirname(values.workspaceRoot), "pulse-exact-output-outside-"),
  );
  const original = `${values.outputDir}.original`;
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  const result = await drainExactGovernedProductionPlan(
    request(values),
    dependencies(values, async () => greenProductionResult(), {
      beforeEvidenceFinalise() {
        fs.renameSync(values.outputDir, original);
        fs.symlinkSync(outside, values.outputDir, "junction");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD", JSON.stringify(result));
  assert.ok(
    result.blockers.includes("exact_plan_drain_output_root_changed"),
    JSON.stringify(result.blockers),
  );
  assert.equal(
    fs.existsSync(path.join(outside, "exact-plan-drain.commit.json")),
    false,
  );
});

test("a crash-left evidence staging marker is never accepted as replay authority", async (t) => {
  const values = await fixture(t);
  let interrupted = false;
  const crashFileSystem = new Proxy(fs.promises, {
    get(target, property, receiver) {
      if (property === "unlink") {
        return async (filePath) => {
          if (
            !interrupted &&
            String(filePath).includes("exact-plan-drain.commit.json.") &&
            String(filePath).endsWith(".tmp")
          ) {
            interrupted = true;
            const error = new Error("simulated commit-temp cleanup crash");
            error.code = "EIO";
            throw error;
          }
          return target.unlink(filePath);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  await assert.rejects(() =>
    drainExactGovernedProductionPlan(
      request(values),
      dependencies(values, async () => greenProductionResult(), {
        fileSystem: crashFileSystem,
      }),
    ),
  );
  assert.equal(interrupted, true);

  const replay = await drainExactGovernedProductionPlan(
    request(values, { generated_at: "2026-08-01T08:45:00.000Z" }),
    dependencies(values, async () => {
      throw new Error("crash-left replay must not produce again");
    }),
  );
  assert.equal(replay.verdict, "HOLD", JSON.stringify(replay));
  assert.ok(
    replay.blockers.includes("exact_plan_drain_evidence_staging_conflict"),
    JSON.stringify(replay.blockers),
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
