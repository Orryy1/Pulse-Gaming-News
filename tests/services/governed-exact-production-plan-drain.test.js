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
    quiescenceInspector: () => ({
      available: true,
      owner_pids: [],
      listener_pids: [],
      scheduler_process_pids: [],
      enabled_tasks: [],
      running_tasks: [],
    }),
    ...overrides,
  };
}

function greenProductionResult() {
  return {
    status: "autonomous_candidate_materialised",
    production: {
      status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
      verdict: "GREEN",
    },
    no_publish: true,
    no_external_posting: true,
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
          quiescenceInspector: () => ({
            available: true,
            owner_pids: [4123],
            listener_pids: [],
            scheduler_process_pids: [],
            enabled_tasks: [],
            running_tasks: [],
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
        return "[4321]";
      }
      if (source.includes("Win32_Process")) {
        return JSON.stringify([
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
        ]);
      }
      if (source.includes("Get-ScheduledTask")) {
        return JSON.stringify([
          {
            TaskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
            State: "Ready",
            Enabled: true,
          },
        ]);
      }
      throw new Error("unexpected inspection command");
    },
  });

  assert.deepEqual(result.listener_pids, [4321]);
  assert.deepEqual(result.owner_pids, [5000, 5001]);
  assert.deepEqual(result.scheduler_process_pids, [5001]);
  assert.deepEqual(result.enabled_tasks, [
    "PulseGaming-LiveGuarded-YouTube-Runtime",
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result, "command_line"),
    false,
  );
});
