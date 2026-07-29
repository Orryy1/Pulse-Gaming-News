"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildGovernedLaneRoutingPlan,
} = require("../../lib/services/multi-lane-job-routing");
const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");

const NOW = "2026-07-29T17:30:00.000Z";
const SCHEDULED_FOR = "2026-07-29T19:00:00.000Z";
const HASHES = Object.freeze({
  media_sha256: "1".repeat(64),
  script_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
  rights_ledger_sha256: "4".repeat(64),
  source_evidence_sha256: "5".repeat(64),
});

function greenRuntimeControl() {
  return {
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduler_owner_healthy: true,
    autonomous_production_enabled: true,
    live_publish_enabled: true,
  };
}

function autonomousCandidate(role) {
  const storyId =
    role === "PRIMARY" ? "routing-primary" : "routing-standby";
  const candidateRevisionSha256 =
    role === "PRIMARY" ? "6".repeat(64) : "7".repeat(64);
  const requestFingerprint =
    role === "PRIMARY" ? "8".repeat(64) : "9".repeat(64);
  const preparation =
    createAutonomousOfficialJitPreparationManifest({
      story_id: storyId,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role,
      candidate_revision_sha256: candidateRevisionSha256,
      request_fingerprint: requestFingerprint,
      artifacts: Object.fromEntries(
        STATIC_ARTIFACT_FIELDS.map((field, index) => [
          field,
          {
            path: `D:/pulse-data/${storyId}/${field}`,
            sha256: (index + 10)
              .toString(16)
              .padStart(2, "0")
              .repeat(32),
          },
        ]),
      ),
      owned_visual_assets: [],
      publication_evidence_gate_input: {
        originality_transformation: {},
        rights_ledger: {
          ledger_version: 1,
          decision: "CLEARED",
          items: [],
        },
        rights_ledger_sha256: HASHES.rights_ledger_sha256,
        synthetic_media_disclosure: {
          decision_authority: "SYSTEM_POLICY",
          decision_provenance: {
            policy_id: "pulse-synthetic-media-policy",
            policy_version: "v1",
            evaluated_at: NOW,
            evidence_sha256: "a".repeat(64),
          },
          altered_content: true,
          policy_basis: "DISCLOSE",
          youtube_field_value: true,
        },
      },
    });
  const greenBody = {
    result_schema_version:
      "pulse-autonomous-green-admission-result-v2",
    evaluator_schema_version:
      "pulse-autonomous-green-admission-evaluator-v2",
    policy_version: "pulse-autonomous-green-policy-v2",
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at: NOW,
    valid_until: "2026-07-29T18:00:00.000Z",
    story_id: storyId,
    final_mp4_sha256: HASHES.media_sha256,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "b".repeat(64),
  };
  const attestation =
    createAutonomousWindowEligibilityAttestation({
      now: new Date(NOW),
      story_id: storyId,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role,
      evidence_hashes: HASHES,
      source_report: {
        path: `D:/pulse-data/${storyId}/t90-report.json`,
        file_sha256: "c".repeat(64),
        report_sha256: "d".repeat(64),
        request_sha256: "e".repeat(64),
        generated_at: "2026-07-29T17:29:30.000Z",
        valid_until: "2026-07-29T18:00:00.000Z",
      },
      green_admission: {
        ...greenBody,
        decision_sha256: canonicalSha256(greenBody),
      },
      jit_preparation: preparation,
    });
  const admission = {
    approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    human_admission_required: false,
    confirmation_story_id: storyId,
    scheduled_for: SCHEDULED_FOR,
    autonomous_eligibility_attestation_sha256:
      attestation.attestation_sha256,
    jit_preparation_sha256: preparation.preparation_sha256,
    autonomous_window_eligibility_attestation: attestation,
    jit_preparation: preparation,
  };
  return {
    lane_id: "breaking_short",
    story_id: storyId,
    stage: "AUTONOMOUS_ELIGIBLE",
    approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    score: role === "PRIMARY" ? 100 : 90,
    eligibility_verdict: "GREEN",
    standby_authorised: role === "STANDBY",
    candidate_revision_sha256: candidateRevisionSha256,
    candidate_binding_sha256:
      attestation.candidate_binding_sha256,
    request_fingerprint: requestFingerprint,
    autonomous_eligibility_attestation_sha256:
      attestation.attestation_sha256,
    ...HASHES,
    admission,
  };
}

test("only autonomous PRIMARY routes a T-75 JIT admission job and carries no preissued authority", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    candidates: [autonomousCandidate("PRIMARY")],
    runtimeControl: greenRuntimeControl(),
    queueState: {},
  });
  const lane = plan.lanes.find(
    (item) => item.lane_id === "breaking_short",
  );
  assert.equal(lane.verdict, "GREEN", JSON.stringify(lane.blockers));
  assert.equal(lane.next_job.kind, "admit_governed_publication");
  assert.equal(
    lane.next_job.run_at,
    "2026-07-29T17:45:00.000Z",
  );
  assert.equal(
    lane.next_job.payload.autonomous_jit_materialisation_required,
    true,
  );
  assert.equal(
    Object.hasOwn(
      lane.next_job.payload.admission,
      "autonomous_publication_authority",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(lane.next_job).includes('"operator"'),
    false,
  );
});

test("autonomous STANDBY remains eligible but schedules no T-75 admission job", () => {
  const plan = buildGovernedLaneRoutingPlan({
    now: NOW,
    candidates: [autonomousCandidate("STANDBY")],
    runtimeControl: greenRuntimeControl(),
    queueState: {},
  });
  const lane = plan.lanes.find(
    (item) => item.lane_id === "breaking_short",
  );
  assert.equal(lane.next_job, null);
  assert.ok(
    lane.blockers.includes(
      "standby_candidate_locked_pending_authorised_promotion",
    ),
  );
});
