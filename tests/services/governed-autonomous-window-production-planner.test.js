"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const {
  bind: bindJobs,
} = require("../../lib/repositories/jobs");
const {
  RUNTIME_POLICY_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  CANDIDATE_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  planGovernedAutonomousWindowProduction,
} = require("../../lib/services/governed-autonomous-window-production-planner");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");
const {
  createGovernedFastNewsLaneDecision,
} = require("../../lib/services/governed-fast-news-lane-decision");
const {
  CANDIDATE_REVISION_SCHEMA_VERSION,
  canonicalSha256,
  createGovernedAutonomousCompiledCandidateRevision,
} = require("../../lib/services/governed-autonomous-compiled-candidate-binding");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";

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
  selectionScore,
  {
    databaseStoryId = storyId,
    canonicalIdentityUrl =
      `https://news.xbox.com/en-us/2026/07/30/${storyId}/`,
  } = {},
) {
  const finalScript =
    `${storyId} is a confirmed official gaming update with a clear player consequence.`;
  const inventoryFileSha256 =
    sha256(`${storyId}:inventory`);
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
    source_evidence_sha256: sha256(`${storyId}:source-evidence`),
    source_published_at: "2026-07-30T07:00:00.000Z",
    verified_at: "2026-07-30T07:10:00.000Z",
    selection_score: selectionScore,
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
        freshness: {
          publish_by: "2026-07-30T12:00:00.000Z",
        },
        visual_brief: { format: "game_native_news" },
        experiment_dimensions: { eligible: false },
      },
    },
    creative_package: {
      scenes: [
        {
          asset_id: `${storyId}:official-hero`,
          role: "hook_slam",
        },
      ],
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

function compiledFastNewsCandidate(
  workspaceRoot,
  storyId,
  selectionScore,
) {
  const value = candidate(
    workspaceRoot,
    storyId,
    selectionScore,
  );
  const locked = value.locked_intake_binding.locked_intake;
  const databaseStoryId =
    locked.database_story_binding.database_story_id;
  const decision = createGovernedFastNewsLaneDecision({
    story_id: databaseStoryId,
    evaluated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    source_published_at: value.source_published_at,
    verification_status: "CONFIRMED",
    source_class: "OFFICIAL_FIRST_PARTY",
    inventory_file_sha256: locked.inventory_file_sha256,
    source_evidence_sha256: value.source_evidence_sha256,
    explicit_formats: [],
  });
  locked.fast_news_lane_decision = decision;
  const revision =
    createGovernedAutonomousCompiledCandidateRevision({
      schema_version: CANDIDATE_REVISION_SCHEMA_VERSION,
      legacy_story_id: databaseStoryId,
      story_id: storyId,
      scheduled_for: SCHEDULED_FOR,
      inventory_file_sha256: locked.inventory_file_sha256,
      inventory_canonical_sha256: sha256(
        `${storyId}:inventory-canonical`,
      ),
      primary_source_packet_sha256:
        value.source_evidence_sha256,
      publication_source_evidence_sha256: sha256(
        `${storyId}:publication-source`,
      ),
      rights_ledger_sha256: sha256(
        `${storyId}:rights-ledger`,
      ),
      supplemental_source_packet_sha256: [],
      final_script_sha256: locked.final_script_sha256,
      fast_news_lane_decision_sha256:
        decision.decision_sha256,
      locked_intake_sha256: canonicalSha256(locked),
      creative_package_sha256: canonicalSha256(
        value.creative_package,
      ),
      runtime_policy_sha256: canonicalSha256(
        value.runtime_policy,
      ),
    });
  value.candidate_revision = revision;
  value.candidate_revision_sha256 =
    canonicalSha256(revision);
  value.request_fingerprint = canonicalSha256({
    schema_version:
      "pulse-governed-autonomous-breaking-production-request-fingerprint-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    candidate_revision_sha256:
      value.candidate_revision_sha256,
    locked_intake_sha256: revision.locked_intake_sha256,
    creative_package_sha256:
      revision.creative_package_sha256,
    runtime_policy_sha256:
      revision.runtime_policy_sha256,
  });
  return value;
}

function fixture(t) {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-planner-"),
  );
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      approved INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(
    fs.readFileSync(
      path.resolve(__dirname, "..", "..", "db", "migrations", "004_jobs.sql"),
      "utf8",
    ),
  );
  db.prepare("INSERT INTO channels (id) VALUES (?)").run(
    "pulse-gaming",
  );
  for (const storyId of ["story-alpha", "story-beta", "story-gamma"]) {
    db.prepare(
      "INSERT INTO stories (id, approved) VALUES (?, 0)",
    ).run(storyId);
  }
  const jobs = bindJobs(db);
  t.after(() => {
    db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  return {
    workspaceRoot,
    db,
    jobs,
    reservationOutputPath: path.join(
      workspaceRoot,
      "output",
      "autonomous-plans",
      "09-00-reservation.json",
    ),
    planOutputPath: path.join(
      workspaceRoot,
      "output",
      "autonomous-plans",
      "09-00-production-plan.json",
    ),
  };
}

function request(values, overrides = {}) {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    workspace_root: values.workspaceRoot,
    reservation_output_path: values.reservationOutputPath,
    plan_output_path: values.planOutputPath,
    candidates: [
      candidate(values.workspaceRoot, "story-alpha", 85),
      candidate(values.workspaceRoot, "story-beta", 120),
      candidate(values.workspaceRoot, "story-gamma", 120),
    ],
    ...overrides,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error?.code === code,
  );
}

test("deterministically reserves distinct PRIMARY/STANDBY and atomically queues two autonomous jobs", async (t) => {
  const values = fixture(t);
  const result = await planGovernedAutonomousWindowProduction(
    request(values),
    { jobs: values.jobs },
  );

  assert.equal(result.status, "CREATED");
  assert.equal(result.plan.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.plan.verdict, "QUEUED_LOCAL_PROOF");
  assert.deepEqual(
    result.plan.selected_candidates.map(({ story_id, role }) => ({
      story_id,
      role,
    })),
    [
      { story_id: "story-beta", role: "PRIMARY" },
      { story_id: "story-gamma", role: "STANDBY" },
    ],
  );
  assert.deepEqual(result.plan.not_selected_story_ids, [
    "story-alpha",
  ]);

  const queued = values.jobs.listPending();
  assert.equal(queued.length, 2);
  assert.notEqual(queued[0].id, queued[1].id);
  assert.deepEqual(
    queued.map((job) => [job.kind, job.story_id]),
    [
      ["produce_breaking_short", "story-beta"],
      ["produce_breaking_short", "story-gamma"],
    ],
  );
  for (const job of queued) {
    assert.equal(job.channel_id, "pulse-gaming");
    assert.equal(job.payload.lane_id, "breaking_short");
    assert.equal(job.payload.story_id, job.story_id);
    assert.deepEqual(
      Object.keys(job.payload).sort(),
      [
        "autonomous_production_job",
        "candidate_revision_sha256",
        "lane_id",
        "story_id",
      ],
    );
    assert.deepEqual(
      Object.keys(job.payload.autonomous_production_job).sort(),
      ["builder_result", "schema_version"],
    );
    assert.equal(
      job.payload.autonomous_production_job.schema_version,
      "pulse-governed-autonomous-production-job-payload-v1",
    );
    assert.equal(
      job.payload.autonomous_production_job.builder_result.story_id,
      job.story_id,
    );
    assert.equal(
      Object.hasOwn(job.payload, "human_review_required"),
      false,
    );
    assert.equal(
      Object.hasOwn(job.payload, "publish_authority"),
      false,
    );
  }
  assert.equal(result.plan.human_approval_dependency, false);
  assert.equal(result.plan.story_approval_mutated, false);
  assert.equal(result.plan.external_posting, false);
  assert.equal(result.plan.platform_contacted, false);
});

test("canonical RSS candidates use the legacy row only for the durable job FK", async (t) => {
  const values = fixture(t);
  const definitions = [
    {
      databaseStoryId: "rss_planner_primary",
      canonicalIdentityUrl:
        "https://news.xbox.com/en-us/2026/07/30/rss-primary/",
      score: 200,
    },
    {
      databaseStoryId: "rss_planner_standby",
      canonicalIdentityUrl:
        "https://news.xbox.com/en-us/2026/07/30/rss-standby/",
      score: 190,
    },
  ].map((entry) => ({
    ...entry,
    storyId:
      `official_${require("../../lib/services/url-canonical").canonicalHash(
        entry.canonicalIdentityUrl,
      )}`,
  }));
  for (const definition of definitions) {
    values.db
      .prepare(
        "INSERT INTO stories (id, approved) VALUES (?, 1)",
      )
      .run(definition.databaseStoryId);
  }

  const result =
    await planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: definitions.map((definition) =>
          candidate(
            values.workspaceRoot,
            definition.storyId,
            definition.score,
            definition,
          ),
        ),
      }),
      { jobs: values.jobs },
    );

  assert.equal(result.status, "CREATED");
  const queued = values.jobs.listPending();
  assert.deepEqual(
    queued.map((job) => ({
      database_story_id: job.story_id,
      canonical_story_id: job.payload.story_id,
    })),
    definitions.map((definition) => ({
      database_story_id: definition.databaseStoryId,
      canonical_story_id: definition.storyId,
    })),
  );
  assert.deepEqual(
    result.plan.production_jobs.map((job) => ({
      story_id: job.story_id,
      database_story_id: job.database_story_id,
    })),
    definitions.map((definition) => ({
      story_id: definition.storyId,
      database_story_id: definition.databaseStoryId,
    })),
  );
});

test("exact replay keeps one reservation, one plan and exactly two jobs", async (t) => {
  const values = fixture(t);
  const exactRequest = request(values);
  const first = await planGovernedAutonomousWindowProduction(
    exactRequest,
    { jobs: values.jobs },
  );
  const second = await planGovernedAutonomousWindowProduction(
    exactRequest,
    { jobs: values.jobs },
  );

  assert.equal(first.status, "CREATED");
  assert.equal(second.status, "REPLAYED");
  assert.equal(first.file_sha256, second.file_sha256);
  assert.deepEqual(
    first.plan.production_jobs.map((job) => job.job_id),
    second.plan.production_jobs.map((job) => job.job_id),
  );
  assert.equal(values.jobs.listPending().length, 2);
});

test("fails closed before reservation or queue mutation when two complete candidates are unavailable", async (t) => {
  const values = fixture(t);
  const oneCandidate = request(values, {
    candidates: [
      candidate(values.workspaceRoot, "story-alpha", 85),
    ],
  });
  await rejectsCode(
    planGovernedAutonomousWindowProduction(oneCandidate, {
      jobs: values.jobs,
    }),
    "autonomous_window_planner_two_complete_candidates_required",
  );
  assert.equal(values.jobs.listPending().length, 0);
  assert.equal(fs.existsSync(values.reservationOutputPath), false);
  assert.equal(fs.existsSync(values.planOutputPath), false);

  const incomplete = candidate(
    values.workspaceRoot,
    "story-beta",
    120,
  );
  delete incomplete.creative_package;
  await rejectsCode(
    planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: [
          candidate(values.workspaceRoot, "story-alpha", 85),
          incomplete,
        ],
      }),
      { jobs: values.jobs },
    ),
    "autonomous_window_planner_candidate_incomplete",
  );
  assert.equal(values.jobs.listPending().length, 0);

  const structurallyPresentButIncomplete = candidate(
    values.workspaceRoot,
    "story-beta",
    120,
  );
  structurallyPresentButIncomplete.creative_package.scenes = [];
  await rejectsCode(
    planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: [
          candidate(values.workspaceRoot, "story-alpha", 85),
          structurallyPresentButIncomplete,
        ],
      }),
      { jobs: values.jobs },
    ),
    "autonomous_window_planner_candidate_incomplete",
  );
  assert.equal(values.jobs.listPending().length, 0);
  assert.equal(fs.existsSync(values.reservationOutputPath), false);
});

test("rejects candidate tampering and nested authority smuggling before durable mutation", async (t) => {
  const values = fixture(t);
  const tampered = candidate(
    values.workspaceRoot,
    "story-beta",
    120,
  );
  tampered.scheduled_for = "2026-07-30T19:00:00.000Z";
  await rejectsCode(
    planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: [
          candidate(values.workspaceRoot, "story-alpha", 85),
          tampered,
        ],
      }),
      { jobs: values.jobs },
    ),
    "autonomous_window_planner_candidate_binding_mismatch",
  );

  const authority = candidate(
    values.workspaceRoot,
    "story-beta",
    120,
  );
  authority.creative_package.scenes[0].publish_authority = true;
  await rejectsCode(
    planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: [
          candidate(values.workspaceRoot, "story-alpha", 85),
          authority,
        ],
      }),
      { jobs: values.jobs },
    ),
    "autonomous_window_planner_authority_forbidden",
  );
  assert.equal(values.jobs.listPending().length, 0);
  assert.equal(fs.existsSync(values.reservationOutputPath), false);
});

test("rejects a newly valid replacement fast-news decision before reservation or queue mutation", async (t) => {
  const values = fixture(t);
  const primary = compiledFastNewsCandidate(
    values.workspaceRoot,
    "story-beta",
    120,
  );
  const standby = compiledFastNewsCandidate(
    values.workspaceRoot,
    "story-gamma",
    110,
  );
  const original =
    primary.locked_intake_binding.locked_intake
      .fast_news_lane_decision;
  primary.locked_intake_binding.locked_intake
    .fast_news_lane_decision =
    createGovernedFastNewsLaneDecision({
      story_id: original.story_id,
      evaluated_at: "2026-07-30T07:19:00.000Z",
      scheduled_for: original.scheduled_for,
      source_published_at: "2026-07-30T06:59:00.000Z",
      verification_status: "CONFIRMED",
      source_class: "OFFICIAL_FIRST_PARTY",
      inventory_file_sha256:
        original.inventory_file_sha256,
      source_evidence_sha256:
        original.source_evidence_sha256,
      explicit_formats: ["short"],
    });

  await rejectsCode(
    planGovernedAutonomousWindowProduction(
      request(values, {
        candidates: [primary, standby],
      }),
      { jobs: values.jobs },
    ),
    "autonomous_window_planner_candidate_revision_invalid",
  );
  assert.equal(values.jobs.listPending().length, 0);
  assert.equal(fs.existsSync(values.reservationOutputPath), false);
  assert.equal(fs.existsSync(values.planOutputPath), false);
});

test("queue batch failure cannot leave only one production role enqueued", async (t) => {
  const values = fixture(t);
  const observed = [];
  await rejectsCode(
    planGovernedAutonomousWindowProduction(request(values), {
      jobs: {
        enqueueBatch(batch) {
          observed.push(...batch);
          throw new Error("job_idempotency_conflict");
        },
      },
    }),
    "autonomous_window_planner_job_batch_failed",
  );
  assert.equal(observed.length, 2);
  assert.equal(fs.existsSync(values.planOutputPath), false);
});

test("planning never reads or mutates story approval and requires no human approval field", async (t) => {
  const values = fixture(t);
  const before = values.db
    .prepare("SELECT id, approved FROM stories ORDER BY id")
    .all();
  const result = await planGovernedAutonomousWindowProduction(
    request(values),
    { jobs: values.jobs },
  );
  const after = values.db
    .prepare("SELECT id, approved FROM stories ORDER BY id")
    .all();

  assert.deepEqual(after, before);
  assert.equal(result.plan.human_approval_dependency, false);
  assert.equal(
    JSON.stringify(result.plan).includes("human_review_required"),
    false,
  );
  assert.equal(
    JSON.stringify(result.plan).includes('"approved"'),
    false,
  );
});
