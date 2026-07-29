"use strict";

const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");

const DEFAULT_EVIDENCE_HASHES = Object.freeze({
  media_sha256: "1".repeat(64),
  script_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
  rights_ledger_sha256: "4".repeat(64),
  source_evidence_sha256: "5".repeat(64),
});

function createAutonomousEligibleCandidateFixture({
  storyId,
  now = "2026-07-28T17:30:00.000Z",
  scheduledFor = "2026-07-28T19:00:00.000Z",
  validUntil = scheduledFor,
  role = "PRIMARY",
  laneId = "breaking_short",
  channelId = "pulse-gaming",
  candidateRevisionSha256 = "8".repeat(64),
  requestFingerprint = "9".repeat(64),
  evidenceHashes = DEFAULT_EVIDENCE_HASHES,
  score = role === "STANDBY" ? 90 : 110,
  candidateOverrides = {},
  admissionOverrides = {},
} = {}) {
  if (!storyId) {
    throw new Error("autonomous_fixture_story_id_required");
  }
  const evaluatedAt = new Date(now);
  const sourceGeneratedAt = new Date(
    evaluatedAt.getTime() - 10_000,
  ).toISOString();
  const preparation =
    createAutonomousOfficialJitPreparationManifest({
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      platform: "youtube",
      scheduled_for: scheduledFor,
      role,
      candidate_revision_sha256:
        candidateRevisionSha256,
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
        rights_ledger_sha256:
          evidenceHashes.rights_ledger_sha256,
        synthetic_media_disclosure: {
          decision_authority: "SYSTEM_POLICY",
          decision_provenance: {
            policy_id: "pulse-synthetic-media-policy",
            policy_version: "v1",
            evaluated_at: evaluatedAt.toISOString(),
            evidence_sha256: "a".repeat(64),
          },
          altered_content: true,
          policy_basis: "DISCLOSE",
          youtube_field_value: true,
        },
      },
    });
  const greenDecision = {
    result_schema_version:
      "pulse-autonomous-green-admission-result-v2",
    evaluator_schema_version:
      "pulse-autonomous-green-admission-evaluator-v2",
    policy_version: "pulse-autonomous-green-policy-v2",
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at: evaluatedAt.toISOString(),
    valid_until: new Date(validUntil).toISOString(),
    story_id: storyId,
    final_mp4_sha256: evidenceHashes.media_sha256,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "b".repeat(64),
  };
  const attestation =
    createAutonomousWindowEligibilityAttestation({
      now: evaluatedAt,
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      platform: "youtube",
      scheduled_for: scheduledFor,
      role,
      evidence_hashes: evidenceHashes,
      source_report: {
        path: `D:/pulse-data/${storyId}/t90-report.json`,
        file_sha256: "c".repeat(64),
        report_sha256: "d".repeat(64),
        request_sha256: "e".repeat(64),
        generated_at: sourceGeneratedAt,
        valid_until: new Date(validUntil).toISOString(),
      },
      green_admission: {
        ...greenDecision,
        decision_sha256: canonicalSha256(greenDecision),
      },
      jit_preparation: preparation,
    });
  const admission = {
    approval_type:
      "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    human_admission_required: false,
    confirmation_story_id: storyId,
    scheduled_for: scheduledFor,
    autonomous_eligibility_attestation_sha256:
      attestation.attestation_sha256,
    jit_preparation_sha256:
      preparation.preparation_sha256,
    autonomous_window_eligibility_attestation:
      attestation,
    jit_preparation: preparation,
    ...admissionOverrides,
  };
  return {
    story_id: storyId,
    lane_id: laneId,
    score,
    stage: "AUTONOMOUS_ELIGIBLE",
    approval_type:
      "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    eligibility_verdict: "GREEN",
    candidate_revision_sha256:
      candidateRevisionSha256,
    candidate_binding_sha256:
      attestation.candidate_binding_sha256,
    request_fingerprint: requestFingerprint,
    autonomous_eligibility_attestation_sha256:
      attestation.attestation_sha256,
    standby_authorised: role === "STANDBY",
    admission_evidence_sha256:
      canonicalSha256(admission),
    ...evidenceHashes,
    admission,
    ...candidateOverrides,
  };
}

module.exports = {
  DEFAULT_EVIDENCE_HASHES,
  createAutonomousEligibleCandidateFixture,
};
