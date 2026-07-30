"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const { bind: bindJobs } = require("../../lib/repositories/jobs");
const { bind: bindWorkers } = require("../../lib/repositories/workers");
const {
  canonicalSha256,
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
  DRAIN_REQUEST_SCHEMA_VERSION,
  drainExactGovernedProductionPlan,
  inspectWindowsPulseQuiescence,
} = require("../../lib/ops/governed-exact-production-plan-drain");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const EXPECTED_COMMIT = "a".repeat(40);

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
  const finalScript =
    `${storyId} is a confirmed official gaming update with one clear player consequence.`;
  const inventoryFileSha256 = sha256(`${storyId}:inventory`);
  const canonicalIdentityUrl =
    `https://news.xbox.com/en-us/2026/07/30/${storyId}/`;
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
        database_story_binding:
          createGovernedAutonomousDatabaseStoryBinding({
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
                narration_timing_evidence_sha256:
                  timingEvidenceSha256,
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
  `);
  db.exec(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "db",
        "migrations",
        "004_jobs.sql",
      ),
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
    db.prepare("INSERT INTO stories (id, approved) VALUES (?, 0)").run(
      storyId,
    );
  }
  const jobs = bindJobs(db);
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
  const repos = { db, jobs, workers };
  t.after(() => {
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  return {
    workspaceRoot,
    databasePath,
    db,
    jobs,
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
    expected_runtime_profile_file_sha256:
      values.profileFileSha256,
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
    absent_task_names: [
      "PulseGaming-Fixture",
      "PulseGaming-Fixture-Legacy",
    ],
    ...overrides,
  };
}

function dependencies(values, productionHandler, overrides = {}) {
  return {
    db: values.db,
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
      file_sha256:
        attestation.completion_receipt.file_sha256,
      receipt_sha256:
        attestation.completion_receipt.receipt_sha256,
    }),
    ...overrides,
  };
}

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
        database_mutation_scope:
          "IMMUTABLE_COMPLETION_RECEIPT_INDEX",
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

function rewriteProfile(values, mutate) {
  const profile = JSON.parse(
    fs.readFileSync(values.profilePath, "utf8"),
  );
  mutate(profile);
  fs.writeFileSync(
    values.profilePath,
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  values.profileFileSha256 = sha256(
    fs.readFileSync(values.profilePath),
  );
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
        candidate(
          values.workspaceRoot,
          "story-primary",
          "db-primary",
          120,
          { timingEvidenceSha256: primaryTimingSha256 },
        ),
        candidate(
          values.workspaceRoot,
          "story-standby",
          "db-standby",
          110,
          { timingEvidenceSha256: standbyTimingSha256 },
        ),
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
          role:
            job.payload.autonomous_production_job.builder_result.role,
        });
        assert.equal(ctx.env.PULSE_OPERATING_MODE, "LOCAL_PROOF");
        assert.equal(ctx.env.PULSE_PRIMARY_INSTANCE, "false");
        assert.equal(ctx.env.AUTO_PUBLISH, "false");
        assert.equal(ctx.env.YOUTUBE_AUTO_PUBLISH, "false");
        assert.equal(
          ctx.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
          "false",
        );
        assert.equal(ctx.env.PULSE_KILL_SWITCH, "true");
        assert.equal(
          ctx.env.PULSE_EMERGENCY_KILL_SWITCH,
          "true",
        );
        assert.equal(ctx.env.BREAKING_WATCHER_ENABLED, "false");
        assert.equal(
          ctx.env.ELEVENLABS_CREDIT_MONITOR_ENABLED,
          "false",
        );
        assert.equal(processEnvironment.AUTO_PUBLISH, "false");
        assert.equal(
          processEnvironment.YOUTUBE_AUTO_PUBLISH,
          "false",
        );
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
  assert.match(
    fs.readFileSync(
      path.join(values.outputDir, "exact-plan-drain.md"),
      "utf8",
    ),
    /PRIMARY[\s\S]*STANDBY/,
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
            if (
              String(filePath).startsWith(
                `${values.outputDir}${path.sep}`,
              )
            ) {
              const error = new Error("evidence write denied");
              error.code = "EACCES";
              throw error;
            }
            return target.open(filePath, ...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function"
          ? value.bind(target)
          : value;
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
      fs.existsSync(
        path.join(values.outputDir, "exact-plan-drain.json"),
      ),
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
          roles.push(
            job.payload.autonomous_production_job.builder_result.role,
          );
          return greenProductionResult();
        },
        {
          afterDurableCompletion({ role }) {
            if (role === "PRIMARY") {
              throw new Error(
                "simulated_crash_after_primary_completion",
              );
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
        roles.push(
          job.payload.autonomous_production_job.builder_result.role,
        );
        return greenProductionResult();
      }),
    );

    assert.equal(replay.verdict, "GREEN");
    assert.equal(replay.execution.recovered_done_prefix, 1);
    assert.deepEqual(roles, ["PRIMARY", "STANDBY"]);
  });
});

test("durable recovery fails closed on attestation, receipt or prefix drift", async (t) => {
  await t.test("tampered job-run attestation", async (t) => {
    const values = await fixture(t);
    await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => greenProductionResult(),
        {
          beforeEvidenceFinalise() {
            throw new Error("simulated_crash_before_evidence");
          },
        },
      ),
    );
    const primaryId =
      values.planned.plan.production_jobs[0].job_id;
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
    assert.ok(
      replay.blockers.includes("exact_plan_job_attestation_invalid"),
    );
    assert.equal(called, 0);
  });

  await t.test("completion receipt cannot be re-attested", async (t) => {
    const values = await fixture(t);
    await drainExactGovernedProductionPlan(
      request(values),
      dependencies(
        values,
        async () => greenProductionResult(),
        {
          beforeEvidenceFinalise() {
            throw new Error("simulated_crash_before_evidence");
          },
        },
      ),
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
      replay.blockers.includes(
        "exact_plan_completion_receipt_invalid",
      ),
    );
    assert.equal(called, 0);
  });

  await t.test("a done suffix without a done prefix", async (t) => {
    const values = await fixture(t);
    const standbyId =
      values.planned.plan.production_jobs[1].job_id;
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
      result.blockers.includes(
        "exact_plan_database_job_status_invalid",
      ),
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
            path.basename(String(filePath)).includes(
              "exact-plan-drain.md",
            )
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
            path.basename(String(newPath)) ===
              "exact-plan-drain.md"
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
      return typeof value === "function"
        ? value.bind(target)
        : value;
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
  const jsonPath = path.join(
    values.outputDir,
    "exact-plan-drain.json",
  );
  const markdownPath = path.join(
    values.outputDir,
    "exact-plan-drain.md",
  );
  const originalJson = fs.readFileSync(jsonPath);
  assert.equal(fs.existsSync(markdownPath), false);

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

test("accepts an exact legacy v1 root plan without inventing lineage", async (t) => {
  const values = await fixture(t);
  const legacyPlan = structuredClone(values.planned.plan);
  legacyPlan.schema_version =
    "pulse-governed-autonomous-window-production-plan-v1";
  delete legacyPlan.candidate_set_revision;
  delete legacyPlan.lineage;
  delete legacyPlan.plan_sha256;
  legacyPlan.plan_sha256 = canonicalSha256(legacyPlan);
  const legacyBytes = Buffer.from(
    `${JSON.stringify(legacyPlan, null, 2)}\n`,
  );
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
  const {
    predecessor,
    successor,
    primaryTimingSha256,
    standbyTimingSha256,
  } = await createTimedSuccessor(values);
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
    successor.plan.candidate_set_revision
      .candidate_set_revision_sha256;
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(observedOrder, ["PRIMARY", "STANDBY"]);
  assert.equal(
    path.dirname(successor.path),
    path.join(
      path.dirname(path.dirname(successor.path)),
      candidateSetSha256,
    ),
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
      candidate_set_revision_sha256:
        entry.candidate_set_revision_sha256,
    })),
    [
      {
        plan_sha256: predecessor.plan.plan_sha256,
        file_sha256: predecessor.file_sha256,
        candidate_set_revision_sha256:
          predecessor.plan.candidate_set_revision
            .candidate_set_revision_sha256,
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
      expected:
        "exact_plan_lineage_predecessor_job_binding_mismatch",
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
      expected:
        "exact_plan_lineage_predecessor_job_binding_mismatch",
      mutate(values, predecessor) {
        const id = predecessor.plan.production_jobs[0].job_id;
        const row = values.jobs.get(id);
        row.payload.autonomous_production_job.builder_result.role =
          "STANDBY";
        values.db
          .prepare("UPDATE jobs SET payload = ? WHERE id = ?")
          .run(JSON.stringify(row.payload), id);
      },
    },
    {
      name: "predecessor is no longer terminal",
      expected:
        "exact_plan_lineage_predecessor_job_not_terminal",
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
      const { predecessor } =
        await createTimedSuccessor(values);
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
      result.blockers.includes(
        "exact_plan_lineage_successor_path_mismatch",
      ),
    );
    assert.equal(called, 0);
  });

  await t.test("root plan cannot masquerade as a revision", async (t) => {
    const values = await fixture(t);
    const candidateSetSha256 =
      values.planned.plan.candidate_set_revision
        .candidate_set_revision_sha256;
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
      result.blockers.includes(
        "exact_plan_lineage_root_path_mismatch",
      ),
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
      result.blockers.includes(
        "exact_plan_drain_input_link_forbidden",
      ),
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
    assert.ok(
      result.blockers.includes(
        "exact_plan_database_link_forbidden",
      ),
    );
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
      const bytes = Buffer.from(
        `${JSON.stringify(plan, null, 2)}\n`,
      );
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
        result.blockers.includes(
          "exact_plan_selection_contract_invalid",
        ),
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
      seen.push(
        job.payload.autonomous_production_job.builder_result.role,
      );
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
  assert.notEqual(
    values.jobs.get(expectedJobs[0].job_id).status,
    "done",
  );
  assert.equal(
    values.jobs.get(expectedJobs[1].job_id).status,
    "pending",
  );
  assert.equal(
    values.jobs.get(expectedJobs[1].job_id).attempt_count,
    0,
  );
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
          const handlerResult = structuredClone(
            greenProductionResult(),
          );
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
        values.jobs.get(
          values.planned.plan.production_jobs[1].job_id,
        ).attempt_count,
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
    result.blockers.includes(
      "exact_plan_active_breaking_job_set_mismatch",
    ),
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
    assert.ok(
      result.blockers.some((value) =>
        value.includes("builder"),
      ),
    );
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
      result.blockers.includes(
        "exact_plan_reservation_file_sha256_mismatch",
      ),
    );
    assert.equal(
      values.jobs.get(values.planned.plan.production_jobs[0].job_id)
        .status,
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
      result.blockers.includes(
        "exact_plan_live_runtime_not_quiescent",
      ),
    );
  });
});

test("requires the exact activation receipt path to remain absent before and throughout the drain", async (t) => {
  await t.test("present regular file blocks before claim", async (t) => {
    const values = await fixture(t);
    const profile = JSON.parse(
      fs.readFileSync(values.profilePath, "utf8"),
    );
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
      result.blockers.includes(
        "exact_plan_activation_receipt_present",
      ),
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
    const linkTarget = path.join(
      values.workspaceRoot,
      "activation-target",
    );
    fs.mkdirSync(path.dirname(profile.activation_receipt_path), {
      recursive: true,
    });
    fs.mkdirSync(linkTarget);
    fs.symlinkSync(
      linkTarget,
      profile.activation_receipt_path,
      "junction",
    );
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
      result.blockers.includes(
        "exact_plan_activation_receipt_present",
      ),
    );
    assert.equal(called, 0);
  });

  await t.test("receipt appearing inside the handler prevents completion", async (t) => {
    const values = await fixture(t);
    const profile = JSON.parse(
      fs.readFileSync(values.profilePath, "utf8"),
    );
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
      result.blockers.includes(
        "exact_plan_activation_receipt_present",
      ),
    );
    assert.equal(called, 1);
    assert.equal(
      values.jobs.get(
        values.planned.plan.production_jobs[0].job_id,
      ).status,
      "pending",
    );
    assert.equal(
      values.jobs.get(
        values.planned.plan.production_jobs[1].job_id,
      ).attempt_count,
      0,
    );
  });
});

test("a bounded timeout aborts and drains the runner without claiming STANDBY", async (t) => {
  const values = await fixture(t);
  const seen = [];
  const result = await drainExactGovernedProductionPlan(
    request(values, { timeout_ms: 30, poll_interval_ms: 5 }),
    dependencies(values, async (job, ctx) => {
      seen.push(
        job.payload.autonomous_production_job.builder_result.role,
      );
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
    values.jobs.get(values.planned.plan.production_jobs[1].job_id)
      .status,
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
    youtubeAutoPublish:
      processEnvironment.YOUTUBE_AUTO_PUBLISH,
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
  assert.ok(
    result.blockers.includes(
      "exact_plan_runner_drain_bound_exceeded",
    ),
  );
  assert.equal(result.execution.work_window_exceeded, true);
  assert.equal(result.execution.drain_bound_exceeded, true);
  assert.equal(result.execution.drained, true);
  assert.equal(processEnvironment.AUTO_PUBLISH, "true");
  assert.equal(processEnvironment.YOUTUBE_AUTO_PUBLISH, "true");
  assert.notEqual(
    values.jobs.get(
      values.planned.plan.production_jobs[0].job_id,
    ).status,
    "done",
  );
  assert.equal(
    values.jobs.get(
      values.planned.plan.production_jobs[1].job_id,
    ).attempt_count,
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
    fs.existsSync(
      path.join(values.outputDir, "exact-plan-drain.json"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(values.outputDir, "exact-plan-drain.md"),
    ),
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
  assert.equal(
    JSON.stringify(persistedRun).includes(secret),
    false,
  );
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
      seen.push(
        job.payload.autonomous_production_job.builder_result.role,
      );
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

test("the default runtime-profile gate accepts only the repository's exact reviewed live profile", async (t) => {
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
  assert.ok(
    result.blockers.includes("exact_plan_open_database_path_mismatch"),
  );
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
              command_line:
                "node C:\\Pulse\\pulse-gaming\\tools\\windows-local-runtime-supervisor.js ensure",
            },
            {
              pid: 5001,
              command_line:
                "node C:\\Pulse\\pulse-gaming\\server.js",
            },
            {
              pid: 6000,
              command_line: "node C:\\Other\\server.js",
            },
          ],
        });
      }
      if (source.includes("Schedule.Service")) {
        return JSON.stringify({
          probe: "scheduled_tasks",
          attested: true,
          items: [
            {
              TaskName:
                "PulseGaming-LiveGuarded-YouTube-Runtime",
              State: "Ready",
              Enabled: true,
            },
            {
              TaskName: "PulseGaming-Stabilisation-Runtime",
              State: 4,
              Enabled: false,
            },
          ],
          absent_task_names: [],
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
  assert.deepEqual(result.owner_pids, [5000, 5001]);
  assert.deepEqual(result.scheduler_process_pids, [5001]);
  assert.deepEqual(result.enabled_tasks, [
    "PulseGaming-LiveGuarded-YouTube-Runtime",
  ]);
  assert.deepEqual(result.running_tasks, [
    "PulseGaming-Stabilisation-Runtime",
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result, "command_line"),
    false,
  );
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
