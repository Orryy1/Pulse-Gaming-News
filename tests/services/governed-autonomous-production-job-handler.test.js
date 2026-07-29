"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  ARTIFACT_SCHEMA_VERSION: RESERVATION_SCHEMA_VERSION,
  MODE,
  canonicalSha256,
} = require("../../lib/services/governed-autonomous-window-reservation-set");
const {
  BUILDER_SCHEMA_VERSION,
  RUNTIME_POLICY_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");

const OFFICIAL_SOURCE_URL =
  "https://news.xbox.com/en-us/2026/07/30/classics-return/";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function reservationSet(
  primaryStoryId = "story-primary",
  standbyStoryId = "story-standby",
) {
  const body = {
    schema_version: RESERVATION_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: "2026-07-30T07:20:00.000Z",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: primaryStoryId },
      { role: "STANDBY", story_id: standbyStoryId },
    ],
    safety: safety(),
  };
  return {
    ...body,
    reservation_set_sha256: canonicalSha256(body),
  };
}

function buildInput(
  workspaceRoot,
  script,
  {
    storyId = "story-primary",
    databaseStoryId = storyId,
    inventoryPath = path.join(workspaceRoot, "inventory.json"),
    inventoryFileSha256 = sha256("inventory"),
  } = {},
) {
  return {
    schema_version: BUILDER_SCHEMA_VERSION,
    mode: MODE,
    reservation_set: reservationSet(
      storyId,
      `${storyId}-standby`,
    ),
    selected_role: "PRIMARY",
    story_id: storyId,
    locked_intake_binding: {
      story_id: storyId,
      locked_intake: {
        database_story_binding:
          createGovernedAutonomousDatabaseStoryBinding({
            canonical_story_id: storyId,
            database_story_id: databaseStoryId,
            canonical_identity_url: OFFICIAL_SOURCE_URL,
            inventory_file_sha256: inventoryFileSha256,
            final_script_sha256: sha256(script),
          }),
        inventory_path: inventoryPath,
        inventory_file_sha256: inventoryFileSha256,
        inventory_root: workspaceRoot,
        allowed_roots: [workspaceRoot],
        canonical_identity_url: OFFICIAL_SOURCE_URL,
        final_script: script,
        final_script_sha256: sha256(script),
        script_claim_bindings: [
          { claim_key: "return", source_index: 0 },
        ],
        presentation_claim_bindings: [
          { claim_key: "achievement", scene_index: 0 },
        ],
        supplemental_official_sources: [],
        contract: { editorial_lane_id: "breaking_short" },
        freshness: {
          publish_by: "2026-07-30T09:00:00.000Z",
        },
        visual_brief: { format: "game_native_news" },
        experiment_dimensions: { eligible: false },
      },
    },
    creative_package: {
      scenes: [{ asset_id: "official-xbox", role: "hook_slam" }],
      title: "Four Xbox Classics Are Coming Back",
      description:
        "Four classics are returning with achievement support.",
      official_source_url: OFFICIAL_SOURCE_URL,
      required_attributions: ["Official source: Xbox Wire"],
      subject_terms: ["Xbox classics"],
    },
    runtime_policy: {
      schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
      mode: MODE,
      generated_at: "2026-07-30T07:25:00.000Z",
      workspace_root: workspaceRoot,
      candidate_source_root: path.join(
        workspaceRoot,
        "candidate-source-primary",
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
    candidate_revision_sha256: sha256("revision"),
    request_fingerprint: sha256("request"),
  };
}

function story(script, storyId = "story-primary") {
  return {
    id: storyId,
    title: "Xbox confirms four classics are returning",
    approved: 1,
    full_script: script,
    breaking_score: 130,
    publish_status: "review",
    _extra: JSON.stringify({
      primary_source_url:
        OFFICIAL_SOURCE_URL,
      source_evidence_sha256: sha256("source-evidence"),
      verification_status: "CONFIRMED",
    }),
  };
}

function writeLockedInventory(
  workspaceRoot,
  legacyStoryId,
) {
  const inventoryPath = path.join(
    workspaceRoot,
    "inventory",
    legacyStoryId,
    "governed-editorial-inventory.json",
  );
  const inventory = {
    schema_version: "pulse-governed-editorial-inventory-v1",
    story: {
      id: legacyStoryId,
      primary_source_url: OFFICIAL_SOURCE_URL,
    },
    verdict: "READY",
    blockers: [],
  };
  const bytes = Buffer.from(
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
  fs.mkdirSync(path.dirname(inventoryPath), {
    recursive: true,
  });
  fs.writeFileSync(inventoryPath, bytes);
  return {
    inventoryPath,
    inventoryFileSha256: sha256(bytes),
  };
}

test("canonical autonomous identity resolves only the exact hash-bound legacy inventory story row", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-alias-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const legacyStoryId = "rss_exact_inventory_story";
  const canonicalStoryId =
    `official_${canonicalHash(OFFICIAL_SOURCE_URL)}`;
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const inventory = writeLockedInventory(
    workspaceRoot,
    legacyStoryId,
  );
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script, {
        storyId: canonicalStoryId,
        databaseStoryId: legacyStoryId,
        ...inventory,
      }),
    );
  const lookups = [];
  const calls = [];

  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      story_id: legacyStoryId,
      payload: {
        lane_id: "breaking_short",
        story_id: canonicalStoryId,
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedAutonomousProductionJobDependencies: {
        marker: "closed-test-dependencies",
      },
      repos: {
        stories: {
          get(storyId) {
            lookups.push(storyId);
            return storyId === legacyStoryId
              ? story(script, legacyStoryId)
              : null;
          },
        },
      },
      async runGovernedAutonomousProductionJob(request) {
        calls.push(request);
        return {
          status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
          verdict: "GREEN",
          blockers: [],
        };
      },
    },
  );

  assert.deepEqual(lookups, [legacyStoryId]);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].builder_result.story_id,
    canonicalStoryId,
  );
  assert.equal(result.story_id, canonicalStoryId);
  assert.equal(result.status, "autonomous_candidate_materialised");
});

test("a consumed legacy alias cannot be re-entered through an already queued autonomous production job", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-consumed-alias-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const legacyStoryId = "rss_consumed_inventory_story";
  const canonicalStoryId =
    `official_${canonicalHash(OFFICIAL_SOURCE_URL)}`;
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const inventory = writeLockedInventory(
    workspaceRoot,
    legacyStoryId,
  );
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script, {
        storyId: canonicalStoryId,
        databaseStoryId: legacyStoryId,
        ...inventory,
      }),
    );
  let runnerCalled = false;

  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      story_id: legacyStoryId,
      payload: {
        lane_id: "breaking_short",
        story_id: canonicalStoryId,
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedAutonomousProductionJobDependencies: {},
      repos: {
        stories: {
          get(storyId) {
            if (storyId !== legacyStoryId) return null;
            return {
              ...story(script, legacyStoryId),
              approved: 0,
              auto_approved: 0,
              publish_status: "canonical_projection_consumed",
              _extra: JSON.stringify({
                governed_autonomous_canonical_projection: {
                  role: "LEGACY_ALIAS_CONSUMED",
                },
              }),
            };
          },
        },
      },
      async runGovernedAutonomousProductionJob() {
        runnerCalled = true;
      },
    },
  );

  assert.equal(result.status, "held");
  assert.deepEqual(result.blockers, [
    "governed_autonomous_database_story_projection_consumed",
  ]);
  assert.equal(runnerCalled, false);
  assert.equal(result.human_review_required, false);
  assert.equal(result.no_publish, true);
});

test("breaking production runs the closed autonomous job without human review", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-"),
  );
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script),
    );
  const calls = [];
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: "story-primary",
        candidate_revision_sha256:
          builderResult.production_request
            .candidate_revision_sha256,
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedAutonomousProductionJobDependencies: {
        marker: "closed-test-dependencies",
      },
      repos: {
        stories: { get: () => story(script) },
      },
      async runGovernedAutonomousProductionJob(request, dependencies) {
        calls.push({ request, dependencies });
        return {
          status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
          verdict: "GREEN",
          blockers: [],
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].request.workspace_root,
    workspaceRoot,
  );
  assert.equal(
    calls[0].request.builder_result.builder_sha256,
    builderResult.builder_sha256,
  );
  assert.equal(
    calls[0].request.coordinator_result_output_path,
    path.join(
      workspaceRoot,
      "output",
      "canary",
      "story-primary",
      "governed-autonomous-coordinator-result.json",
    ),
  );
  assert.deepEqual(calls[0].dependencies, {
    marker: "closed-test-dependencies",
  });
  assert.equal(result.status, "autonomous_candidate_materialised");
  assert.equal(result.human_review_required, false);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
});

test("autonomous production builds the default runtime and composes the closed runner dependencies", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-runtime-"),
  );
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script),
    );
  const runtimeDependencies = {
    ownedProgramme: async () => {},
    finalComposite: async () => {},
  };
  const database = { marker: "runtime-db" };
  const runtimeCalls = [];
  const runnerCalls = [];
  const env = { PULSE_RUNTIME_TEST: "true" };

  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: "story-primary",
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      env,
      repos: {
        db: database,
        stories: { get: () => story(script) },
      },
      buildGovernedAutonomousProductionRuntime(options) {
        runtimeCalls.push(options);
        return {
          capabilities: {
            ready: true,
            blockers: [],
            safety: {
              external_publish_authority: false,
            },
          },
          dependencies: runtimeDependencies,
        };
      },
      async runGovernedAutonomousProductionJob(
        request,
        dependencies,
      ) {
        runnerCalls.push({ request, dependencies });
        return {
          status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
          verdict: "GREEN",
          blockers: [],
        };
      },
    },
  );

  assert.equal(runtimeCalls.length, 1);
  assert.equal(
    runtimeCalls[0].builderResult.builder_sha256,
    builderResult.builder_sha256,
  );
  assert.equal(runtimeCalls[0].env, env);
  assert.equal(runnerCalls.length, 1);
  assert.equal(
    runnerCalls[0].dependencies.productionDependencies,
    runtimeDependencies,
  );
  assert.equal(runnerCalls[0].dependencies.db, database);
  assert.equal(
    typeof runnerCalls[0].dependencies
      .materialiseGovernedAutonomousOfficialCandidate,
    "function",
  );
  assert.equal(
    typeof runnerCalls[0].dependencies
      .materialiseGovernedAutonomousCandidateCompletionReceipt,
    "function",
  );
  assert.equal(
    typeof runnerCalls[0].dependencies
      .indexGovernedAutonomousCandidateCompletionReceipt,
    "function",
  );
  assert.equal(result.status, "autonomous_candidate_materialised");
  assert.equal(result.human_review_required, false);
  assert.equal(result.no_publish, true);
});

test("autonomous production remains held without invoking the runner when runtime capabilities are not ready", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-runtime-hold-"),
  );
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script),
    );
  let runnerCalled = false;

  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: "story-primary",
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      repos: {
        db: { marker: "runtime-db" },
        stories: { get: () => story(script) },
      },
      buildGovernedAutonomousProductionRuntime() {
        return {
          capabilities: {
            ready: false,
            blockers: ["ffmpeg_binary_unavailable"],
          },
          dependencies: {},
        };
      },
      async runGovernedAutonomousProductionJob() {
        runnerCalled = true;
      },
    },
  );

  assert.equal(runnerCalled, false);
  assert.equal(result.status, "held");
  assert.deepEqual(result.blockers, [
    "ffmpeg_binary_unavailable",
  ]);
  assert.equal(result.runtime_capabilities.ready, false);
  assert.equal(result.human_review_required, false);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
  assert.equal(result.no_oauth_or_token_change, true);
  assert.equal(result.no_database_mutation, true);
});

test("tampered autonomous builder is held before production or legacy rendering", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-autonomous-handler-tamper-"),
  );
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  const builderResult =
    buildGovernedAutonomousProductionRequest(
      buildInput(workspaceRoot, script),
    );
  builderResult.production_request.role = "STANDBY";
  let autonomousCalled = false;
  let legacyCalled = false;
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: "story-primary",
        autonomous_production_job: {
          schema_version:
            "pulse-governed-autonomous-production-job-payload-v1",
          builder_result: builderResult,
        },
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      governedAutonomousProductionJobDependencies: {},
      repos: { stories: { get: () => story(script) } },
      async runGovernedAutonomousProductionJob() {
        autonomousCalled = true;
      },
      async produceExactStory() {
        legacyCalled = true;
      },
    },
  );

  assert.equal(result.status, "held");
  assert.ok(
    result.blockers.includes(
      "production_request_builder_sha256_mismatch",
    ),
  );
  assert.equal(autonomousCalled, false);
  assert.equal(legacyCalled, false);
});

test("legacy breaking production remains the fallback when no autonomous contract exists", async () => {
  const script =
    "Xbox confirmed four classics are returning with modern achievement support.";
  let legacyCalled = 0;
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: "story-primary",
      },
    },
    {
      repos: { stories: { get: () => story(script) } },
      async produceExactStory() {
        legacyCalled += 1;
        return { story_ids: ["story-primary"] };
      },
    },
  );

  assert.equal(legacyCalled, 1);
  assert.equal(result.status, "prepared_for_human_review");
  assert.equal(result.human_review_required, true);
});
