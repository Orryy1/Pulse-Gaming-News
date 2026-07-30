"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  CANDIDATE_REVISION_SCHEMA_VERSION,
  createGovernedAutonomousCompiledCandidateRevision,
  validateGovernedAutonomousCompiledCandidateBinding,
} = require("../../lib/services/governed-autonomous-compiled-candidate-binding");
const {
  createGovernedFastNewsLaneDecision,
} = require("../../lib/services/governed-fast-news-lane-decision");

function canonicalSha256(value) {
  const stable = (entry) => {
    if (Array.isArray(entry)) return entry.map(stable);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.keys(entry)
          .filter((field) => entry[field] !== undefined)
          .sort()
          .map((field) => [field, stable(entry[field])]),
      );
    }
    return entry;
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function fixture() {
  const storyId = "official_compiled-binding";
  const databaseStoryId = "rss_compiled_binding";
  const scheduledFor = "2026-07-30T09:00:00.000Z";
  const inventoryFileSha256 = "a".repeat(64);
  const sourceEvidenceSha256 = "b".repeat(64);
  const finalScriptSha256 = "c".repeat(64);
  const fastNewsLaneDecision =
    createGovernedFastNewsLaneDecision({
      story_id: databaseStoryId,
      evaluated_at: "2026-07-30T07:20:00.000Z",
      scheduled_for: scheduledFor,
      source_published_at: "2026-07-30T06:00:00.000Z",
      verification_status: "CONFIRMED",
      source_class: "OFFICIAL_FIRST_PARTY",
      inventory_file_sha256: inventoryFileSha256,
      source_evidence_sha256: sourceEvidenceSha256,
      explicit_formats: [],
    });
  const lockedIntakeBinding = {
    story_id: storyId,
    locked_intake: {
      database_story_binding: {
        canonical_story_id: storyId,
        database_story_id: databaseStoryId,
      },
      inventory_file_sha256: inventoryFileSha256,
      final_script_sha256: finalScriptSha256,
      fast_news_lane_decision: fastNewsLaneDecision,
    },
  };
  const creativePackage = {
    title: "Exact creative",
    scenes: [{ asset_id: "owned-hook" }],
  };
  const runtimePolicy = {
    schema_version:
      "pulse-governed-autonomous-production-runtime-policy-v1",
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-30T07:20:00.000Z",
  };
  const candidateRevision =
    createGovernedAutonomousCompiledCandidateRevision({
      schema_version: CANDIDATE_REVISION_SCHEMA_VERSION,
      legacy_story_id: databaseStoryId,
      story_id: storyId,
      scheduled_for: scheduledFor,
      inventory_file_sha256: inventoryFileSha256,
      inventory_canonical_sha256: "d".repeat(64),
      primary_source_packet_sha256: sourceEvidenceSha256,
      publication_source_evidence_sha256: "e".repeat(64),
      rights_ledger_sha256: "f".repeat(64),
      supplemental_source_packet_sha256: [],
      final_script_sha256: finalScriptSha256,
      fast_news_lane_decision_sha256:
        fastNewsLaneDecision.decision_sha256,
      locked_intake_sha256: canonicalSha256(
        lockedIntakeBinding.locked_intake,
      ),
      creative_package_sha256:
        canonicalSha256(creativePackage),
      runtime_policy_sha256: canonicalSha256(runtimePolicy),
    });
  const candidateRevisionSha256 =
    canonicalSha256(candidateRevision);
  const requestFingerprint = canonicalSha256({
    schema_version:
      "pulse-governed-autonomous-breaking-production-request-fingerprint-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    candidate_revision_sha256: candidateRevisionSha256,
    locked_intake_sha256:
      candidateRevision.locked_intake_sha256,
    creative_package_sha256:
      candidateRevision.creative_package_sha256,
    runtime_policy_sha256:
      candidateRevision.runtime_policy_sha256,
  });
  return {
    candidate_revision: candidateRevision,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    source_evidence_sha256: sourceEvidenceSha256,
    locked_intake_binding: lockedIntakeBinding,
    creative_package: creativePackage,
    runtime_policy: runtimePolicy,
  };
}

test("validates the closed candidate revision against every mutable compiled candidate surface", () => {
  const value = fixture();

  const validated =
    validateGovernedAutonomousCompiledCandidateBinding(value);

  assert.deepEqual(
    validated.candidate_revision,
    value.candidate_revision,
  );
  assert.equal(
    validated.candidate_revision_sha256,
    value.candidate_revision_sha256,
  );
  assert.equal(
    validated.request_fingerprint,
    value.request_fingerprint,
  );
});

test("rejects a newly valid replacement decision when the original revision and fingerprint are retained", () => {
  const value = fixture();
  const tampered = structuredClone(value);
  tampered.locked_intake_binding.locked_intake
    .fast_news_lane_decision =
    createGovernedFastNewsLaneDecision({
      story_id:
        tampered.candidate_revision.legacy_story_id,
      evaluated_at: "2026-07-30T07:21:00.000Z",
      scheduled_for: tampered.scheduled_for,
      source_published_at: "2026-07-30T06:01:00.000Z",
      verification_status: "CONFIRMED",
      source_class: "OFFICIAL_FIRST_PARTY",
      inventory_file_sha256:
        tampered.candidate_revision.inventory_file_sha256,
      source_evidence_sha256:
        tampered.source_evidence_sha256,
      explicit_formats: ["short"],
    });

  assert.throws(
    () =>
      validateGovernedAutonomousCompiledCandidateBinding(
        tampered,
      ),
    (error) =>
      error?.code ===
      "compiled_candidate_fast_news_decision_sha256_mismatch",
  );
});

test("rejects rehashed locked intake, creative, runtime, revision and request-fingerprint drift", () => {
  const mutations = [
    (value) => {
      value.locked_intake_binding.locked_intake.extra = true;
    },
    (value) => {
      value.creative_package.title = "Changed creative";
    },
    (value) => {
      value.runtime_policy.generated_at =
        "2026-07-30T07:21:00.000Z";
    },
    (value) => {
      value.candidate_revision.primary_source_packet_sha256 =
        "0".repeat(64);
    },
    (value) => {
      value.request_fingerprint = "1".repeat(64);
    },
  ];

  for (const mutate of mutations) {
    const value = structuredClone(fixture());
    mutate(value);
    assert.throws(
      () =>
        validateGovernedAutonomousCompiledCandidateBinding(value),
      (error) =>
        String(error?.code || "").startsWith(
          "compiled_candidate_",
        ),
    );
  }
});
