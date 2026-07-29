"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ARTIFACT_SCHEMA_VERSION: RESERVATION_SCHEMA_VERSION,
  MODE,
  canonicalSha256: reservationSha256,
} = require("../../lib/services/governed-autonomous-window-reservation-set");
const {
  BUILDER_SCHEMA_VERSION,
  RUNTIME_POLICY_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  RECEIPT_SCHEMA_VERSION,
  canonicalSha256: receiptSha256,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt");
const {
  INDEX_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt-index");
const {
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  runGovernedAutonomousProductionJob,
} = require("../../lib/services/governed-autonomous-production-job-runner");
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("../../lib/services/governed-autonomous-database-story-binding");

const GENERATED_AT = "2026-07-30T07:25:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const STORY_ID = "story-primary";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reservationSet() {
  const body = {
    schema_version: RESERVATION_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: "2026-07-30T07:20:00.000Z",
    scheduled_for: SCHEDULED_FOR,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: STORY_ID },
      { role: "STANDBY", story_id: "story-standby" },
    ],
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
  };
  return {
    ...body,
    reservation_set_sha256: reservationSha256(body),
  };
}

function buildRequest(workspaceRoot) {
  const script =
    "Xbox just confirmed four classics are returning with achievement support.";
  const canonicalIdentityUrl =
    "https://news.xbox.com/en-us/2026/07/30/classics-return/";
  const inventoryFileSha256 = sha256("inventory");
  return buildGovernedAutonomousProductionRequest({
    schema_version: BUILDER_SCHEMA_VERSION,
    mode: MODE,
    reservation_set: reservationSet(),
    selected_role: "PRIMARY",
    story_id: STORY_ID,
    locked_intake_binding: {
      story_id: STORY_ID,
      locked_intake: {
        database_story_binding:
          createGovernedAutonomousDatabaseStoryBinding({
            canonical_story_id: STORY_ID,
            database_story_id: STORY_ID,
            canonical_identity_url: canonicalIdentityUrl,
            inventory_file_sha256: inventoryFileSha256,
            final_script_sha256: sha256(script),
          }),
        inventory_path: path.join(workspaceRoot, "inventory.json"),
        inventory_file_sha256: inventoryFileSha256,
        inventory_root: workspaceRoot,
        allowed_roots: [workspaceRoot],
        canonical_identity_url: canonicalIdentityUrl,
        final_script: script,
        final_script_sha256: sha256(script),
        script_claim_bindings: [
          { claim_key: "return", source_index: 0 },
        ],
        presentation_claim_bindings: [],
        supplemental_official_sources: [],
        contract: { target_duration_seconds: 30 },
        freshness: { publish_by: SCHEDULED_FOR },
        visual_brief: { format: "game_native_news" },
        experiment_dimensions: { eligible: false },
      },
    },
    creative_package: {
      scenes: [{ asset_id: "xbox-classics", role: "hook" }],
      title: "Four Xbox Classics Are Coming Back",
      description: "Four classics return with achievements.",
      official_source_url:
        "https://news.xbox.com/en-us/2026/07/30/classics-return/",
      required_attributions: ["Official source: Xbox Wire"],
      subject_terms: ["Xbox classics"],
    },
    runtime_policy: {
      schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
      mode: MODE,
      generated_at: GENERATED_AT,
      workspace_root: workspaceRoot,
      candidate_source_root: path.join(
        workspaceRoot,
        "source",
        STORY_ID,
      ),
      narration: {
        provider: "elevenlabs",
        voice_id: "pulse-approved",
        model_id: "eleven_multilingual_v2",
        speed: 1,
      },
      visual_qa: {
        reviewers: [
          { provider: "ollama", model: "gemma3:12b" },
          { provider: "ollama", model: "qwen2.5vl:7b" },
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
    candidate_revision_sha256: sha256("revision"),
    request_fingerprint: sha256("fingerprint"),
  });
}

function coordinatorResult(builder, overrides = {}) {
  const request = builder.production_request;
  const result = {
    schema_version: "pulse-governed-autonomous-production-result-v1",
    mode: MODE,
    verdict: "GREEN",
    blockers: [],
    story_id: builder.story_id,
    intake: {},
    programme: {},
    narration: {},
    composite: {
      schema_version: "pulse-governed-final-composite-result-v1",
      mode: MODE,
      verdict: "MATERIALIZED_LOCAL_PROOF",
      story_id: builder.story_id,
      channel_id: "pulse-gaming",
      publish_authorised: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      live_publish_attempted: false,
      network_used: false,
    },
    visual_qa: {},
    visual_gate_decision: {},
    publication_metadata: {},
    green_supplement: {
      verdict: "GREEN",
      authority_scope: "LOCAL_PROOF_EVIDENCE_ONLY",
      story_id: builder.story_id,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      safety: {
        local_proof_only: true,
        publish_authority: false,
        scheduler_authority: false,
        database_authority: false,
        oauth_or_token_authority: false,
        network_authority: false,
        network_used: false,
        platform_contacted: false,
      },
    },
    staging: {
      mode: MODE,
      verdict: "GREEN",
      blockers: [],
      story_id: builder.story_id,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: builder.scheduled_for,
      role: builder.role,
      preparation_manifest: {
        story_id: builder.story_id,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: builder.scheduled_for,
        role: builder.role,
        candidate_revision_sha256:
          request.candidate_revision_sha256,
        request_fingerprint: request.request_fingerprint,
      },
      safety: {
        local_proof_only: true,
        publish_authority: false,
        external_publish_authorised: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        network_used: false,
      },
    },
    safety: {
      publish_authority: false,
      scheduler_authority: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      narration_network_used: true,
      external_publish_authorised: false,
    },
  };
  return Object.assign(result, overrides);
}

function completionReceipt(request) {
  const body = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    mode: MODE,
    verdict: "GREEN",
    blockers: [],
    generated_at: request.generated_at,
    story_id: request.story_id,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    platform: request.platform,
    scheduled_for: request.scheduled_for,
    role: request.role,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    request_fingerprint: request.request_fingerprint,
    coordinator_result: request.coordinator_result_ref,
    staging_result: {
      path: `output/canary/${STORY_ID}/proof/staging.json`,
      file_sha256: sha256("staging-file"),
      canonical_sha256: sha256("staging-canonical"),
    },
    preparation_manifest: {
      path: `output/canary/${STORY_ID}/jit/preparation.json`,
      file_sha256: sha256("preparation-file"),
      canonical_sha256: sha256("preparation-canonical"),
    },
    final_mp4: {
      path: `output/canary/${STORY_ID}/final/${STORY_ID}.mp4`,
      file_sha256: sha256("final-mp4"),
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
  return {
    ...body,
    receipt_sha256: receiptSha256(body),
  };
}

async function fixture(t) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-job-runner-"),
  );
  t.after(() =>
    fs.rm(workspaceRoot, { recursive: true, force: true }),
  );
  const builderResult = buildRequest(workspaceRoot);
  const proofRoot = path.join(
    workspaceRoot,
    "output",
    "canary",
    STORY_ID,
    "proof",
  );
  const coordinatorResultOutputPath = path.join(
    proofRoot,
    "production-result.json",
  );
  const completionReceiptOutputPath = path.join(
    proofRoot,
    "completion-receipt.json",
  );
  const calls = {
    coordinator: 0,
    receipt: 0,
    index: 0,
  };
  let coordinatorValue = coordinatorResult(builderResult);
  let receiptFailure = null;
  let indexFailure = null;
  const dependencies = {
    db: { marker: "test-db" },
    productionDependencies: { marker: "production-dependencies" },
    async materialiseGovernedAutonomousOfficialCandidate(
      request,
      productionDependencies,
    ) {
      calls.coordinator += 1;
      await assert.rejects(
        () =>
          fs.access(
            path.join(
              workspaceRoot,
              ...request.candidate_workspace_relative_root.split(
                "/",
              ),
            ),
          ),
        (error) => error?.code === "ENOENT",
      );
      assert.deepEqual(request, builderResult.production_request);
      assert.equal(
        productionDependencies,
        dependencies.productionDependencies,
      );
      return structuredClone(coordinatorValue);
    },
    async materialiseGovernedAutonomousCandidateCompletionReceipt(
      request,
    ) {
      calls.receipt += 1;
      if (receiptFailure) throw receiptFailure;
      const receipt = completionReceipt(request);
      const bytes = jsonBytes(receipt);
      await fs.mkdir(path.dirname(request.output_path), {
        recursive: true,
      });
      let status = "CREATED";
      try {
        await fs.writeFile(request.output_path, bytes, {
          flag: "wx",
        });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await fs.readFile(request.output_path);
        assert.deepEqual(existing, bytes);
        status = "REPLAYED";
      }
      return {
        status,
        path: request.output_path,
        file_sha256: sha256(bytes),
        receipt,
        safety: receipt.safety,
      };
    },
    async indexGovernedAutonomousCandidateCompletionReceipt(
      options,
    ) {
      calls.index += 1;
      assert.equal(options.db, dependencies.db);
      if (indexFailure) throw indexFailure;
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(
            options.workspaceRoot,
            ...options.receiptRef.path.split("/"),
          ),
          "utf8",
        ),
      );
      return {
        status: calls.index === 1 ? "INDEXED" : "REPLAYED",
        audit_id: 7,
        idempotency_key: "completion-index-key",
        evidence: {
          schema_version: INDEX_SCHEMA_VERSION,
          receipt_ref: {
            ...options.receiptRef,
            receipt_sha256: receipt.receipt_sha256,
          },
          story_id: receipt.story_id,
          channel_id: receipt.channel_id,
          lane_id: receipt.lane_id,
          platform: receipt.platform,
          scheduled_for: receipt.scheduled_for,
          role: receipt.role,
          candidate_revision_sha256:
            receipt.candidate_revision_sha256,
          request_fingerprint: receipt.request_fingerprint,
        },
        receipt,
      };
    },
  };
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    builder_result: builderResult,
    workspace_root: workspaceRoot,
    coordinator_result_output_path:
      coordinatorResultOutputPath,
    completion_receipt_output_path:
      completionReceiptOutputPath,
  };
  return {
    workspaceRoot,
    builderResult,
    coordinatorResultOutputPath,
    completionReceiptOutputPath,
    calls,
    dependencies,
    request,
    setCoordinator(value) {
      coordinatorValue = value;
    },
    failReceipt(error) {
      receiptFailure = error;
    },
    failIndex(error) {
      indexFailure = error;
    },
  };
}

test("materialises and indexes once, then resumes idempotently without rerunning production", async (t) => {
  const input = await fixture(t);

  const first = await runGovernedAutonomousProductionJob(
    input.request,
    input.dependencies,
  );
  const replay = await runGovernedAutonomousProductionJob(
    input.request,
    input.dependencies,
  );

  assert.equal(first.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(first.status, "AUTONOMOUS_CANDIDATE_MATERIALISED");
  assert.equal(first.verdict, "GREEN");
  assert.deepEqual(first.blockers, []);
  assert.equal(first.coordinator_result.status, "CREATED");
  assert.equal(first.completion_receipt.status, "CREATED");
  assert.equal(first.completion_index.status, "INDEXED");
  assert.equal(replay.coordinator_result.status, "REPLAYED");
  assert.equal(replay.completion_receipt.status, "REPLAYED");
  assert.equal(replay.completion_index.status, "REPLAYED");
  assert.deepEqual(input.calls, {
    coordinator: 1,
    receipt: 2,
    index: 2,
  });
  assert.equal(first.story_id, STORY_ID);
  assert.equal(first.role, "PRIMARY");
  assert.equal(first.scheduled_for, SCHEDULED_FOR);
  assert.equal(first.safety.local_proof_only, true);
  assert.equal(first.safety.database_mutated, true);
  assert.equal(
    first.safety.database_mutation_scope,
    "IMMUTABLE_COMPLETION_RECEIPT_INDEX",
  );
  assert.equal(first.safety.narration_network_used, true);
  for (const field of [
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "publish_authority",
    "scheduler_authority",
    "external_publish_authorised",
  ]) {
    assert.equal(first.safety[field], false);
    assert.equal(replay.safety[field], false);
  }
});

test("rejects HOLD and authority-bearing coordinator results before writing or indexing", async (t) => {
  for (const variant of ["HOLD", "AUTHORITY"]) {
    const input = await fixture(t);
    const changed = coordinatorResult(input.builderResult);
    if (variant === "HOLD") {
      changed.verdict = "HOLD";
      changed.blockers = ["visual_qa_hold"];
    } else {
      changed.safety.publish_authority = true;
    }
    input.setCoordinator(changed);

    await assert.rejects(
      () =>
        runGovernedAutonomousProductionJob(
          input.request,
          input.dependencies,
        ),
      (error) =>
        error?.code ===
        (variant === "HOLD"
          ? "autonomous_production_job_coordinator_not_green"
          : "autonomous_production_job_publish_authority_forbidden"),
    );
    assert.deepEqual(input.calls, {
      coordinator: 1,
      receipt: 0,
      index: 0,
    });
    await assert.rejects(
      () => fs.access(input.coordinatorResultOutputPath),
      (error) => error?.code === "ENOENT",
    );
  }
});

test("detects coordinator-result drift on replay against the immutable completion receipt", async (t) => {
  const input = await fixture(t);
  await runGovernedAutonomousProductionJob(
    input.request,
    input.dependencies,
  );
  await fs.appendFile(
    input.coordinatorResultOutputPath,
    " \n",
    "utf8",
  );

  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        input.request,
        input.dependencies,
      ),
    (error) =>
      error?.code ===
      "autonomous_production_job_coordinator_result_drift",
  );
  assert.deepEqual(input.calls, {
    coordinator: 1,
    receipt: 1,
    index: 1,
  });
});

test("rejects path escape, linked output ancestors and conflicting pre-existing evidence", async (t) => {
  const escaped = await fixture(t);
  escaped.request.coordinator_result_output_path = path.join(
    path.dirname(escaped.workspaceRoot),
    "escaped-production-result.json",
  );
  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        escaped.request,
        escaped.dependencies,
      ),
    (error) =>
      error?.code ===
      "autonomous_production_job_coordinator_output_outside_workspace",
  );
  assert.equal(escaped.calls.coordinator, 0);

  const linked = await fixture(t);
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-job-outside-"),
  );
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const candidateRoot = path.dirname(
    path.dirname(linked.coordinatorResultOutputPath),
  );
  await fs.mkdir(candidateRoot, { recursive: true });
  const proofLink = path.join(candidateRoot, "proof");
  try {
    await fs.symlink(
      outside,
      proofLink,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
      t.skip(`symlink or junction unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        linked.request,
        linked.dependencies,
      ),
    (error) =>
      error?.code ===
      "autonomous_production_job_output_link_forbidden",
  );
  assert.equal(linked.calls.coordinator, 0);

  const conflicting = await fixture(t);
  await fs.mkdir(
    path.dirname(conflicting.coordinatorResultOutputPath),
    { recursive: true },
  );
  await fs.writeFile(
    conflicting.coordinatorResultOutputPath,
    "{}\n",
    "utf8",
  );
  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        conflicting.request,
        conflicting.dependencies,
      ),
    (error) =>
      error?.code ===
      "autonomous_production_job_existing_coordinator_invalid",
  );
  assert.equal(
    await fs.readFile(
      conflicting.coordinatorResultOutputPath,
      "utf8",
    ),
    "{}\n",
  );
  assert.equal(conflicting.calls.coordinator, 0);
});

test("never indexes a failed receipt and resumes an index failure without rerunning production", async (t) => {
  const receiptFailure = await fixture(t);
  receiptFailure.failReceipt(new Error("receipt failed"));
  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        receiptFailure.request,
        receiptFailure.dependencies,
      ),
    /receipt failed/,
  );
  assert.deepEqual(receiptFailure.calls, {
    coordinator: 1,
    receipt: 1,
    index: 0,
  });

  const indexFailure = await fixture(t);
  indexFailure.failIndex(new Error("index failed"));
  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        indexFailure.request,
        indexFailure.dependencies,
      ),
    /index failed/,
  );
  assert.deepEqual(indexFailure.calls, {
    coordinator: 1,
    receipt: 1,
    index: 1,
  });
  indexFailure.failIndex(null);
  const recovered = await runGovernedAutonomousProductionJob(
    indexFailure.request,
    indexFailure.dependencies,
  );
  assert.equal(recovered.status, "AUTONOMOUS_CANDIDATE_MATERIALISED");
  assert.deepEqual(indexFailure.calls, {
    coordinator: 1,
    receipt: 2,
    index: 2,
  });
});

test("rejects a tampered builder result before any production side effect", async (t) => {
  const input = await fixture(t);
  input.request.builder_result.production_request.role = "STANDBY";

  await assert.rejects(
    () =>
      runGovernedAutonomousProductionJob(
        input.request,
        input.dependencies,
      ),
    (error) =>
      error?.code ===
      "production_request_builder_sha256_mismatch",
  );
  assert.deepEqual(input.calls, {
    coordinator: 0,
    receipt: 0,
    index: 0,
  });
});
