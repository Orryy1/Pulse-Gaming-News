"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
  validateAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");

const NOW = new Date("2026-07-29T17:30:00.000Z");
const SCHEDULED_FOR = "2026-07-29T19:00:00.000Z";
const HASHES = Object.freeze({
  media_sha256: "1".repeat(64),
  script_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
  rights_ledger_sha256: "4".repeat(64),
  source_evidence_sha256: "5".repeat(64),
});

function eligibilityInput(role = "PRIMARY", overrides = {}) {
  const jitPreparation =
    createAutonomousOfficialJitPreparationManifest({
      story_id: "attestation-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role,
      candidate_revision_sha256: "6".repeat(64),
      request_fingerprint: "7".repeat(64),
      artifacts: Object.fromEntries(
        STATIC_ARTIFACT_FIELDS.map((field, index) => [
          field,
          {
            path: `D:/pulse-data/attestation-story/${field}`,
            sha256: (index.toString(16).padStart(2, "0")).repeat(32),
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
            evaluated_at: NOW.toISOString(),
            evidence_sha256: "8".repeat(64),
          },
          altered_content: true,
          policy_basis: "DISCLOSE",
          youtube_field_value: true,
        },
      },
    });
  const greenAdmission = {
    result_schema_version:
      "pulse-autonomous-green-admission-result-v2",
    evaluator_schema_version:
      "pulse-autonomous-green-admission-evaluator-v2",
    policy_version: "pulse-autonomous-green-policy-v2",
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at: NOW.toISOString(),
    valid_until: "2026-07-29T17:50:00.000Z",
    story_id: "attestation-story",
    final_mp4_sha256: HASHES.media_sha256,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "7".repeat(64),
  };
  greenAdmission.decision_sha256 = canonicalSha256(greenAdmission);
  return {
    now: NOW,
    story_id: "attestation-story",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    evidence_hashes: HASHES,
    source_report: {
      path: "D:/pulse-data/attestation-story/t90-report.json",
      file_sha256: "8".repeat(64),
      report_sha256: "9".repeat(64),
      request_sha256: "a".repeat(64),
      generated_at: "2026-07-29T17:29:30.000Z",
      valid_until: "2026-07-29T17:50:00.000Z",
    },
    green_admission: greenAdmission,
    jit_preparation: jitPreparation,
    ...overrides,
  };
}

test("T-90 creates non-consumptive PRIMARY and STANDBY eligibility attestations without publication authority", () => {
  for (const role of ["PRIMARY", "STANDBY"]) {
    const input = eligibilityInput(role);
    const attestation =
      createAutonomousWindowEligibilityAttestation(input);
    const validated =
      validateAutonomousWindowEligibilityAttestation(
        attestation,
        {
          now: NOW,
          expected: {
            story_id: input.story_id,
            channel_id: input.channel_id,
            lane_id: input.lane_id,
            platform: input.platform,
            scheduled_for: input.scheduled_for,
            role,
            evidence_hashes: HASHES,
            jit_preparation: input.jit_preparation,
          },
        },
      );

    assert.equal(validated.role, role);
    assert.equal(validated.attestation_scope, "WINDOW_ELIGIBILITY_ONLY");
    assert.equal(validated.non_consumptive, true);
    assert.equal(validated.admission_authorised, false);
    assert.equal(validated.operational_publish_authority, false);
    assert.equal(validated.dispatch_authorised, false);
    assert.equal(validated.external_publish_authorised, false);
    assert.equal(validated.human_approval, false);
    assert.equal(validated.may_impersonate_human, false);
    assert.equal(Object.hasOwn(validated, "operator"), false);
    assert.equal(
      Object.hasOwn(validated, "autonomous_publication_authority"),
      false,
    );
    assert.equal(
      validated.source_report.report_sha256,
      input.source_report.report_sha256,
    );
    assert.equal(
      validated.jit_preparation_sha256,
      input.jit_preparation.preparation_sha256,
    );
  }
});

test("T-90 eligibility fails closed on stale, role-mismatched, mixed or hash-tampered evidence", () => {
  const primary =
    createAutonomousWindowEligibilityAttestation(
      eligibilityInput("PRIMARY"),
    );
  assert.throws(
    () =>
      validateAutonomousWindowEligibilityAttestation(primary, {
        now: new Date("2026-07-29T17:50:00.000Z"),
      }),
    { code: "autonomous_window_eligibility_stale" },
  );
  assert.throws(
    () =>
      validateAutonomousWindowEligibilityAttestation(primary, {
        now: NOW,
        expected: { role: "STANDBY" },
      }),
    { code: "autonomous_window_eligibility_binding_mismatch" },
  );
  assert.throws(
    () =>
      validateAutonomousWindowEligibilityAttestation(
        {
          ...primary,
          human_review_audit_id: 42,
        },
        { now: NOW },
      ),
    { code: "autonomous_window_eligibility_fields_invalid" },
  );
  assert.throws(
    () =>
      validateAutonomousWindowEligibilityAttestation(
        {
          ...primary,
          source_report: {
            ...primary.source_report,
            report_sha256: "b".repeat(64),
          },
        },
        { now: NOW },
      ),
    { code: "autonomous_window_eligibility_sha256_mismatch" },
  );
});

test("a final 60-second publication authority is not accepted as a T-90 eligibility attestation", () => {
  assert.throws(
    () =>
      validateAutonomousWindowEligibilityAttestation(
        {
          authority_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
          authority_scope: "PUBLICATION_ADMISSION_ONLY",
          single_use: true,
          authority_sha256: "c".repeat(64),
        },
        { now: NOW },
      ),
    { code: "autonomous_window_eligibility_fields_invalid" },
  );
});
