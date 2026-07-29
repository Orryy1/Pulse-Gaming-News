"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createAutonomousOfficialJitPreparationManifest,
  STATIC_ARTIFACT_FIELDS,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousCandidateCompletionReceipt,
  validateGovernedAutonomousCandidateCompletionReceipt,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt");

const GENERATED_AT = "2026-07-30T07:20:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const STORY_ID = "official-xbox-story-001";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const ROLE = "PRIMARY";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJson(filePath, value) {
  const bytes = jsonBytes(value);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return {
    path: filePath,
    bytes,
    file_sha256: sha256(bytes),
  };
}

async function fixture(t) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-candidate-completion-"),
  );
  t.after(() =>
    fs.rm(workspaceRoot, { recursive: true, force: true }),
  );
  const candidateRoot = path.join(
    workspaceRoot,
    "output",
    "canary",
    STORY_ID,
  );
  const proofRoot = path.join(candidateRoot, "proof");
  const finalMp4Path = path.join(
    candidateRoot,
    "final",
    `${STORY_ID}.mp4`,
  );
  const finalMp4Bytes = Buffer.from(
    "exact-governed-final-mp4",
    "utf8",
  );
  await fs.mkdir(path.dirname(finalMp4Path), { recursive: true });
  await fs.writeFile(finalMp4Path, finalMp4Bytes);

  const artifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      {
        path: `output/canary/${STORY_ID}/artifacts/${field}`,
        sha256: sha256(`${STORY_ID}:${field}`),
      },
    ]),
  );
  artifacts.final_mp4 = {
    path: `output/canary/${STORY_ID}/final/${STORY_ID}.mp4`,
    sha256: sha256(finalMp4Bytes),
  };
  const candidateRevisionSha256 = sha256("candidate-revision");
  const requestFingerprint = sha256("request-fingerprint");
  const rightsLedgerSha256 = sha256("rights-ledger");
  const preparation = createAutonomousOfficialJitPreparationManifest({
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: SCHEDULED_FOR,
    role: ROLE,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    artifacts,
    owned_visual_assets: [],
    publication_evidence_gate_input: {
      originality_transformation: {
        verdict: "STRONG",
        rationale: "Story-specific owned motion.",
        evidence_ref: artifacts.owned_motion_manifest.path,
        evidence_sha256: artifacts.owned_motion_manifest.sha256,
      },
      rights_ledger: {
        ledger_version: 1,
        decision: "CLEARED",
        items: [],
      },
      rights_ledger_sha256: rightsLedgerSha256,
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        decision_provenance: {
          policy_id: "pulse-synthetic-media-policy",
          policy_version: "v1",
          evaluated_at: GENERATED_AT,
          evidence_sha256:
            artifacts.final_composite_manifest.sha256,
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
  const preparationPath = path.join(
    candidateRoot,
    "jit",
    "autonomous-official-preparation.json",
  );
  const preparationFile = await writeJson(
    preparationPath,
    preparation,
  );

  const stagingBase = {
    schema_version:
      "pulse-autonomous-official-candidate-staging-result-v3",
    generated_at: GENERATED_AT,
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: SCHEDULED_FOR,
    role: ROLE,
    workspace_root: workspaceRoot,
    candidate_workspace_relative_root:
      `output/canary/${STORY_ID}`,
    preparation_sha256: preparation.preparation_sha256,
    rights_ledger_sha256: rightsLedgerSha256,
    monetisation_scope: {
      platform_advertising: "CLEARED",
      sponsorship: "NOT_ESTABLISHED",
      affiliate_promotion: "NOT_ESTABLISHED",
      paid_access: "NOT_ESTABLISHED",
      client_production: "NOT_ESTABLISHED",
    },
    rights_evidence: {
      path: `output/canary/${STORY_ID}/evidence/rights.json`,
      sha256: sha256("rights-file"),
      canonical_sha256: sha256("rights-canonical"),
    },
    rights_ledger: {
      path: `output/canary/${STORY_ID}/evidence/ledger.json`,
      sha256: sha256("ledger-file"),
    },
    preparation_manifest: {
      path: path
        .relative(workspaceRoot, preparationPath)
        .split(path.sep)
        .join("/"),
      sha256: preparationFile.file_sha256,
    },
    copied_artifact_count: STATIC_ARTIFACT_FIELDS.length,
    safety: {
      local_proof_only: true,
      publish_authority: false,
      external_publish_authorised: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      network_used: false,
    },
  };
  const stagingProof = {
    ...stagingBase,
    result_sha256: canonicalSha256(stagingBase),
  };
  const stagingResultPath = path.join(
    proofRoot,
    "candidate-staging-result.json",
  );
  const stagingFile = await writeJson(
    stagingResultPath,
    stagingProof,
  );
  const summaryPath = path.join(
    proofRoot,
    "candidate-staging-result.md",
  );
  await fs.writeFile(summaryPath, "# GREEN\n", "utf8");

  const coordinatorResult = {
    schema_version:
      "pulse-governed-autonomous-production-result-v1",
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    story_id: STORY_ID,
    intake: {},
    programme: {},
    narration: {},
    composite: {
      schema_version: "pulse-governed-final-composite-result-v1",
      mode: "LOCAL_PROOF",
      verdict: "MATERIALIZED_LOCAL_PROOF",
      mutated: true,
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      final_mp4_path: finalMp4Path,
      media_sha256: sha256(finalMp4Bytes),
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
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      lane_id: LANE_ID,
      platform: PLATFORM,
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
      ...stagingBase,
      result_sha256: stagingProof.result_sha256,
      preparation_manifest: preparation,
      preparation_manifest_path: preparationPath,
      rights_evidence_path: path.join(
        candidateRoot,
        "evidence",
        "rights.json",
      ),
      rights_ledger_path: path.join(
        candidateRoot,
        "evidence",
        "ledger.json",
      ),
      result_path: stagingResultPath,
      summary_path: summaryPath,
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
  const coordinatorResultPath = path.join(
    proofRoot,
    "governed-autonomous-production-result.json",
  );
  const coordinatorFile = await writeJson(
    coordinatorResultPath,
    coordinatorResult,
  );
  const outputPath = path.join(
    proofRoot,
    "candidate-completion-receipt.json",
  );
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-30T07:25:00.000Z",
    workspace_root: workspaceRoot,
    output_path: outputPath,
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: SCHEDULED_FOR,
    role: ROLE,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    coordinator_result_ref: {
      path: path
        .relative(workspaceRoot, coordinatorResultPath)
        .split(path.sep)
        .join("/"),
      file_sha256: coordinatorFile.file_sha256,
      canonical_sha256: canonicalSha256(coordinatorResult),
    },
  };
  return {
    workspaceRoot,
    outputPath,
    coordinatorResultPath,
    stagingResultPath,
    finalMp4Bytes,
    preparation,
    stagingProof,
    coordinatorResult,
    request,
  };
}

test("materialises one immutable GREEN completion receipt and replays byte-identically", async (t) => {
  const input = await fixture(t);

  const first =
    await materialiseGovernedAutonomousCandidateCompletionReceipt(
      input.request,
    );
  const replay =
    await materialiseGovernedAutonomousCandidateCompletionReceipt(
      input.request,
    );

  assert.equal(first.status, "CREATED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.file_sha256, replay.file_sha256);
  assert.equal(first.receipt.receipt_sha256, replay.receipt.receipt_sha256);
  assert.equal(first.receipt.verdict, "GREEN");
  assert.deepEqual(first.receipt.blockers, []);
  assert.equal(first.receipt.story_id, STORY_ID);
  assert.equal(first.receipt.channel_id, CHANNEL_ID);
  assert.equal(first.receipt.lane_id, LANE_ID);
  assert.equal(first.receipt.platform, PLATFORM);
  assert.equal(first.receipt.scheduled_for, SCHEDULED_FOR);
  assert.equal(first.receipt.role, ROLE);
  assert.equal(
    first.receipt.candidate_revision_sha256,
    input.request.candidate_revision_sha256,
  );
  assert.equal(
    first.receipt.request_fingerprint,
    input.request.request_fingerprint,
  );
  assert.deepEqual(
    first.receipt.coordinator_result,
    input.request.coordinator_result_ref,
  );
  assert.equal(
    first.receipt.staging_result.canonical_sha256,
    input.stagingProof.result_sha256,
  );
  assert.equal(
    first.receipt.preparation_manifest.canonical_sha256,
    input.preparation.preparation_sha256,
  );
  assert.equal(
    first.receipt.final_mp4.file_sha256,
    sha256(input.finalMp4Bytes),
  );
  assert.equal(first.receipt.safety.local_proof_only, true);
  for (const field of [
    "database_mutated",
    "network_used",
    "oauth_or_tokens_mutated",
    "platform_contacted",
    "publish_authority",
    "scheduler_authority",
    "external_publish_authorised",
  ]) {
    assert.equal(first.receipt.safety[field], false);
  }
  assert.deepEqual(
    JSON.parse(await fs.readFile(input.outputPath, "utf8")),
    first.receipt,
  );
});

test("rejects rehashed coordinator evidence that smuggles a nested authority flag", async (t) => {
  const input = await fixture(t);
  const coordinator = structuredClone(input.coordinatorResult);
  coordinator.intake.network_authority = true;
  const rewritten = await writeJson(
    input.coordinatorResultPath,
    coordinator,
  );
  input.request.coordinator_result_ref.file_sha256 =
    rewritten.file_sha256;
  input.request.coordinator_result_ref.canonical_sha256 =
    canonicalSha256(coordinator);

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        input.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_network_authority_forbidden",
  );
  await assert.rejects(
    () => fs.access(input.outputPath),
    (error) => error?.code === "ENOENT",
  );
});

test("rejects a rehashed coordinator result whose final composite is not the staged MP4", async (t) => {
  const input = await fixture(t);
  const coordinator = structuredClone(input.coordinatorResult);
  coordinator.composite.media_sha256 = sha256("different-final");
  const rewritten = await writeJson(
    input.coordinatorResultPath,
    coordinator,
  );
  input.request.coordinator_result_ref.file_sha256 =
    rewritten.file_sha256;
  input.request.coordinator_result_ref.canonical_sha256 =
    canonicalSha256(coordinator);

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        input.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_final_composite_binding_mismatch",
  );
});

test("rejects a completion claim timestamped before its staging evidence", async (t) => {
  const input = await fixture(t);
  const stagingBody = structuredClone(input.stagingProof);
  delete stagingBody.result_sha256;
  stagingBody.generated_at = "2026-07-30T07:26:00.000Z";
  const stagingProof = {
    ...stagingBody,
    result_sha256: canonicalSha256(stagingBody),
  };
  await writeJson(input.stagingResultPath, stagingProof);

  const coordinator = structuredClone(input.coordinatorResult);
  coordinator.staging.generated_at = stagingBody.generated_at;
  coordinator.staging.result_sha256 = stagingProof.result_sha256;
  const rewritten = await writeJson(
    input.coordinatorResultPath,
    coordinator,
  );
  input.request.coordinator_result_ref.file_sha256 =
    rewritten.file_sha256;
  input.request.coordinator_result_ref.canonical_sha256 =
    canonicalSha256(coordinator);

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        input.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_evidence_from_future",
  );
});

test("fails closed when the physical final MP4 drifts after the coordinator result", async (t) => {
  const input = await fixture(t);
  const finalMp4Path = path.join(
    input.workspaceRoot,
    ...input.preparation.artifacts.final_mp4.path.split("/"),
  );
  await fs.writeFile(finalMp4Path, "drifted-final-mp4", "utf8");

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        input.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_final_mp4_sha256_mismatch",
  );
  await assert.rejects(
    () => fs.access(input.outputPath),
    (error) => error?.code === "ENOENT",
  );
});

test("rejects a stale coordinator file hash before trusting its GREEN claim", async (t) => {
  const input = await fixture(t);
  input.request.coordinator_result_ref.file_sha256 =
    sha256("not-the-coordinator-file");

  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        input.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_coordinator_result_invalid_sha256_mismatch",
  );
});

test("never writes outside the workspace and never overwrites a conflicting receipt", async (t) => {
  const external = await fixture(t);
  external.request.output_path = path.join(
    path.dirname(external.workspaceRoot),
    "external-completion-receipt.json",
  );
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        external.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_output_outside_workspace",
  );

  const conflicting = await fixture(t);
  await fs.writeFile(conflicting.outputPath, "{}\n", "utf8");
  await assert.rejects(
    () =>
      materialiseGovernedAutonomousCandidateCompletionReceipt(
        conflicting.request,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_receipt_conflict",
  );
  assert.equal(
    await fs.readFile(conflicting.outputPath, "utf8"),
    "{}\n",
  );
});

test("the exported validator rejects rehashed extra fields and rehashed authority escalation", async (t) => {
  const input = await fixture(t);
  const result =
    await materialiseGovernedAutonomousCandidateCompletionReceipt(
      input.request,
    );

  const extra = structuredClone(result.receipt);
  delete extra.receipt_sha256;
  extra.publish_now = true;
  extra.receipt_sha256 = canonicalSha256(extra);
  await assert.rejects(
    async () =>
      validateGovernedAutonomousCandidateCompletionReceipt(extra),
    (error) =>
      error?.code ===
      "candidate_completion_receipt_fields_invalid",
  );

  const escalated = structuredClone(result.receipt);
  delete escalated.receipt_sha256;
  escalated.safety.publish_authority = true;
  escalated.receipt_sha256 = canonicalSha256(escalated);
  await assert.rejects(
    async () =>
      validateGovernedAutonomousCandidateCompletionReceipt(
        escalated,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_publish_authority_forbidden",
  );
});
