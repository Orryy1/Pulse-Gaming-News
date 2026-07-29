"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AUTHORITY_TYPE,
  DECISION_AUTHORITY,
  VISUAL_GATE_FAILURE,
  hasGovernedAutonomousContentQaEvidence,
  reconcileGovernedAutonomousContentQa,
  resolveGovernedAutonomousContentQaAuthority,
} = require("../../lib/services/governed-autonomous-content-qa");

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function hash(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function visualGate() {
  return {
    decision_file_sha256: hash("visual-decision-file"),
    decision_self_sha256: hash("visual-decision-self"),
    decision_authority: "SYSTEM_POLICY",
    authority_scope: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    policy_id: "pulse-visual-review-policy",
    policy_version: "2",
    gate: "AUTONOMOUS_OFFICIAL_UNANIMOUS",
    required_report_schema:
      "pulse-local-multimodal-visual-review-v1",
    required_aggregation: "UNANIMOUS_PASS",
    minimum_distinct_vision_models: 2,
    distinct_model_count: 2,
    human_approval: false,
    models_treated_as_humans: false,
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    oauth_or_token_authority: false,
    platform_contacted: false,
    network_used: false,
  };
}

function releaseBoundary() {
  return {
    boundary: "T_MINUS_15",
    official_source_revalidation_required: true,
    kill_switch_revalidation_required: true,
    single_owner_revalidation_required: true,
    exact_binding_revalidation_required: true,
    max_control_age_ms: 60_000,
    disarm_on_failure: true,
  };
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-content-qa-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mediaPath = path.join(root, "final.mp4");
  const mediaBytes = Buffer.from(
    "exact governed autonomous final media",
    "utf8",
  );
  await fs.writeFile(mediaPath, mediaBytes);

  const storyId = "story-autonomous-qa";
  const scheduledFor = "2026-07-29T19:00:00.000Z";
  const eventId = 417;
  const dispatchIdempotencyKey =
    `youtube:${storyId}:${scheduledFor}`;
  const requestFingerprint = hash("request-fingerprint");
  const runwayLockSha256 = hash("runway-lock");
  const mediaSha256 = sha256(mediaBytes);
  const qaReportSha256 = hash("qa-report");
  const authorityBindingSha256 = hash("authority-binding");
  const authorityId =
    `autonomous-official-publication:${hash("authority-id")}`;
  const gate = visualGate();
  const boundary = releaseBoundary();
  const publicationEvidence = {
    source_evidence_sha256: hash("source-evidence"),
    rights_ledger_sha256: hash("rights-ledger"),
    qa_report_sha256: qaReportSha256,
    publication_metadata_sha256: hash("publication-metadata"),
    renderer_manifest_sha256: hash("renderer-manifest"),
  };
  const projection = {
    approval_type: AUTHORITY_TYPE,
    authority_id: authorityId,
    authority_sha256: authorityBindingSha256,
    approved_at: "2026-07-29T18:44:30.000Z",
    autonomous_visual_gate_decision_sha256:
      gate.decision_file_sha256,
    autonomous_visual_gate: structuredClone(gate),
    media_sha256: mediaSha256,
    qa_report_sha256: qaReportSha256,
  };
  const story = {
    id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    approved: true,
    auto_approved: true,
    exported_path: mediaPath,
    autonomous_publication_approval: projection,
  };
  const auditEvidence = {
    exact_candidate_bound: true,
    authority_id: authorityId,
    authority_type: AUTHORITY_TYPE,
    authority_scope: "PUBLICATION_ADMISSION_ONLY",
    verifier_id:
      "pulse-autonomous-official-publication-authority-v3",
    authority_binding_sha256: authorityBindingSha256,
    issued_at: projection.approved_at,
    valid_until: "2026-07-29T18:45:30.000Z",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    runway_lock_sha256: runwayLockSha256,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    publication_evidence_sha256:
      canonicalSha256(publicationEvidence),
    source_evidence_sha256:
      publicationEvidence.source_evidence_sha256,
    rights_ledger_sha256:
      publicationEvidence.rights_ledger_sha256,
    qa_report_sha256: qaReportSha256,
    publication_metadata_sha256:
      publicationEvidence.publication_metadata_sha256,
    autonomous_green_supplement_sha256: hash(
      "green-supplement",
    ),
    autonomous_visual_gate_decision_sha256:
      gate.decision_file_sha256,
    autonomous_visual_gate: structuredClone(gate),
    renderer_manifest_sha256:
      publicationEvidence.renderer_manifest_sha256,
    media_sha256: mediaSha256,
    script_sha256: hash("script"),
    source_report_sha256: hash("source-report"),
    kill_switch_proof_sha256: hash("kill-switch"),
    single_owner_proof_sha256: hash("single-owner"),
    required_release_boundary: structuredClone(boundary),
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
  };
  const audit = {
    id: 91,
    story_id: storyId,
    platform: "youtube",
    authority_type: AUTHORITY_TYPE,
    decision: "APPROVED",
    reason: "Exact governed candidate passed",
    evidence_json: JSON.stringify(auditEvidence),
    authority_binding_sha256: authorityBindingSha256,
    lifecycle_idempotency_key:
      `${dispatchIdempotencyKey}:lifecycle:AUTONOMOUSLY_APPROVED`,
    idempotency_key:
      `${dispatchIdempotencyKey}:autonomous-authority`,
  };
  const scheduledEvidence = {
    schedule_verified: true,
    control_tower_verdict: "GREEN",
    control_tower_checked_at: "2026-07-29T18:44:45.000Z",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    kill_switch_healthy: true,
    operating_contract_valid: true,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    runway_lock_sha256: runwayLockSha256,
    publication_evidence: structuredClone(publicationEvidence),
    publication_authority_audit_id: audit.id,
    autonomous_authority_type: AUTHORITY_TYPE,
    autonomous_authority_binding_sha256:
      authorityBindingSha256,
    autonomous_visual_gate_decision_sha256:
      gate.decision_file_sha256,
    autonomous_visual_gate: structuredClone(gate),
    required_release_boundary: structuredClone(boundary),
    media_sha256: mediaSha256,
    qa_report_sha256: qaReportSha256,
  };
  const scheduledDispatch = {
    event: {
      id: eventId,
      story_id: storyId,
      platform: "youtube",
      evidence_json: JSON.stringify(scheduledEvidence),
    },
    evidence: scheduledEvidence,
    idempotencyKey: dispatchIdempotencyKey,
    requestFingerprint,
    publicationEvidence: structuredClone(publicationEvidence),
    scheduledFor,
  };
  const exactDispatchBinding = {
    storyId,
    channelId: "pulse-gaming",
    laneId: "breaking_short",
    platform: "youtube",
    scheduledFor,
    scheduledEventId: String(eventId),
    dispatchIdempotencyKey,
    requestFingerprint,
    runwayLockSha256,
    databaseDataVersion: 1,
  };
  const publicationGovernance = {
    getPublicationAuthorityDecision(id) {
      return id === audit.id ? audit : null;
    },
  };
  return {
    root,
    mediaPath,
    mediaBytes,
    story,
    projection,
    audit,
    auditEvidence,
    scheduledEvidence,
    scheduledDispatch,
    exactDispatchBinding,
    publicationGovernance,
  };
}

async function resolve(input) {
  return resolveGovernedAutonomousContentQaAuthority({
    story: input.story,
    scheduledDispatch: input.scheduledDispatch,
    exactDispatchBinding: input.exactDispatchBinding,
    publicationGovernance: input.publicationGovernance,
    resolveMediaPath: async () => input.mediaPath,
  });
}

test("resolves an exact nonhuman SYSTEM_POLICY authority from the immutable admission audit and current MP4", async (t) => {
  const input = await fixture(t);

  assert.equal(
    hasGovernedAutonomousContentQaEvidence(
      input.story,
      input.scheduledDispatch,
    ),
    true,
  );
  const authority = await resolve(input);

  assert.equal(authority.authorityType, AUTHORITY_TYPE);
  assert.equal(authority.decisionAuthority, DECISION_AUTHORITY);
  assert.equal(authority.storyId, input.story.id);
  assert.equal(authority.authorityAuditId, input.audit.id);
  assert.equal(
    authority.visualDecisionSha256,
    input.scheduledEvidence
      .autonomous_visual_gate_decision_sha256,
  );
  assert.equal(
    authority.mediaSha256,
    input.auditEvidence.media_sha256,
  );
  assert.deepEqual(authority.controls, {
    humanApproval: false,
    modelsTreatedAsHumans: false,
    publishAuthority: false,
    schedulerAuthority: false,
    databaseAuthority: false,
    oauthOrTokenAuthority: false,
    platformContacted: false,
    networkUsed: false,
  });
  assert.equal(Object.isFrozen(authority), true);
  assert.equal(Object.isFrozen(authority.controls), true);
});

test("reconciles only the exact Studio v21 human visual-review failure and retains every unrelated failure", async (t) => {
  const input = await fixture(t);
  const authority = await resolve(input);
  const result = reconcileGovernedAutonomousContentQa(
    {
      result: "fail",
      failures: [
        VISUAL_GATE_FAILURE,
        "rights_ledger_incomplete",
        "prefix:human_visual_review_required:studio-v21",
      ],
      warnings: ["existing_warning"],
    },
    authority,
  );

  assert.equal(result.result, "fail");
  assert.deepEqual(result.resolved, [VISUAL_GATE_FAILURE]);
  assert.deepEqual(result.failures, [
    "rights_ledger_incomplete",
    "prefix:human_visual_review_required:studio-v21",
  ]);
  assert.ok(result.warnings.includes("existing_warning"));
  assert.ok(
    result.warnings.includes(
      `governed_autonomous_visual_policy_resolved:${VISUAL_GATE_FAILURE}`,
    ),
  );

  assert.throws(
    () =>
      reconcileGovernedAutonomousContentQa(
        {
          result: "fail",
          failures: [VISUAL_GATE_FAILURE],
          warnings: [],
        },
        { ...authority },
      ),
    (error) =>
      error?.code ===
      "governed_autonomous_content_qa_authority_required",
  );
});

test("fails closed when the current MP4 hash drifts after admission", async (t) => {
  const input = await fixture(t);
  await fs.writeFile(input.mediaPath, "tampered media");

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_current_media_hash_mismatch",
      ),
  );
});

test("fails closed when the immutable authority audit evidence drifts", async (t) => {
  const input = await fixture(t);
  const drifted = structuredClone(input.auditEvidence);
  drifted.qa_report_sha256 = hash("different-qa");
  input.audit.evidence_json = JSON.stringify(drifted);

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_audit_qa_mismatch",
      ),
  );
});

test("fails closed when media resolution points at a different path even with identical bytes", async (t) => {
  const input = await fixture(t);
  const otherPath = path.join(input.root, "other.mp4");
  await fs.writeFile(otherPath, input.mediaBytes);

  await assert.rejects(
    resolveGovernedAutonomousContentQaAuthority({
      story: input.story,
      scheduledDispatch: input.scheduledDispatch,
      exactDispatchBinding: input.exactDispatchBinding,
      publicationGovernance: input.publicationGovernance,
      resolveMediaPath: async () => otherPath,
    }),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_current_media_path_mismatch",
      ),
  );
});

test("fails closed on exact dispatch and runway binding drift", async (t) => {
  const input = await fixture(t);
  input.exactDispatchBinding.requestFingerprint = hash(
    "different-request",
  );
  input.exactDispatchBinding.runwayLockSha256 = hash(
    "different-runway",
  );

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_exact_request_mismatch",
      ) &&
      error.codes.includes(
        "governed_autonomous_exact_runway_mismatch",
      ),
  );
});

test("fails closed when scheduled evidence identity differs from its lifecycle event", async (t) => {
  const input = await fixture(t);
  input.scheduledEvidence.story_id = "another-story";
  input.scheduledEvidence.platform = "tiktok";

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_scheduled_evidence_story_mismatch",
      ) &&
      error.codes.includes(
        "governed_autonomous_scheduled_evidence_platform_mismatch",
      ),
  );
});

test("fails closed when the authority repository is missing", async (t) => {
  const input = await fixture(t);
  input.publicationGovernance = null;

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_publication_authority_repository_required",
      ),
  );
});

test("fails closed when visual policy semantics differ across persisted surfaces", async (t) => {
  const input = await fixture(t);
  input.story.autonomous_publication_approval
    .autonomous_visual_gate.distinct_model_count = 3;

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_visual_gate_projection_mismatch",
      ),
  );
});

test("fails closed when release-boundary evidence differs from the immutable audit", async (t) => {
  const input = await fixture(t);
  input.scheduledEvidence.required_release_boundary
    .max_control_age_ms = 30_000;

  await assert.rejects(
    resolve(input),
    (error) =>
      error?.codes?.includes(
        "governed_autonomous_release_boundary_audit_mismatch",
      ),
  );
});

test("evidence detection stays false for ordinary stories and true for partial autonomous evidence so callers fail closed", () => {
  assert.equal(
    hasGovernedAutonomousContentQaEvidence(
      { id: "ordinary" },
      { evidence: {} },
    ),
    false,
  );
  assert.equal(
    hasGovernedAutonomousContentQaEvidence(
      { id: "partial" },
      {
        evidence: {
          autonomous_authority_type: AUTHORITY_TYPE,
        },
      },
    ),
    true,
  );
});
