"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateGovernedBreakingLaneEligibility,
  latestGovernedDecisionFromRepositories,
} = require("../../lib/services/governed-breaking-lane-eligibility");
const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  createGovernedFastNewsLaneDecision,
} = require("../../lib/services/governed-fast-news-lane-decision");

const NOW = new Date("2026-07-30T07:28:00.000Z");
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const HASHES = Object.freeze({
  media_sha256: "1".repeat(64),
  script_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
  rights_ledger_sha256: "4".repeat(64),
  source_evidence_sha256: "5".repeat(64),
});

function eligibilityAttestation({
  includeFastNewsDecision = true,
  tamperFastNewsDecision = false,
} = {}) {
  const fastNewsLaneDecision = includeFastNewsDecision
    ? createGovernedFastNewsLaneDecision({
        story_id: "official-attested-story",
        evaluated_at: "2026-07-30T07:27:00.000Z",
        scheduled_for: SCHEDULED_FOR,
        source_published_at: "2026-07-30T01:00:00.000Z",
        verification_status: "CONFIRMED",
        source_class: "OFFICIAL_FIRST_PARTY",
        inventory_file_sha256: "d".repeat(64),
        source_evidence_sha256:
          HASHES.source_evidence_sha256,
        explicit_formats: [],
      })
    : null;
  let jitPreparation =
    createAutonomousOfficialJitPreparationManifest({
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      candidate_revision_sha256: "6".repeat(64),
      request_fingerprint: "7".repeat(64),
      ...(fastNewsLaneDecision
        ? {
            fast_news_lane_decision:
              fastNewsLaneDecision,
          }
        : {}),
      artifacts: Object.fromEntries(
        STATIC_ARTIFACT_FIELDS.map((field, index) => [
          field,
          {
            path: `D:/pulse-data/official-attested-story/${field}`,
            sha256: index.toString(16).padStart(2, "0").repeat(32),
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
  if (tamperFastNewsDecision) {
    const {
      decision_sha256: _decisionSha256,
      ...decisionBody
    } = jitPreparation.fast_news_lane_decision;
    const tamperedDecisionBody = {
      ...decisionBody,
      public_breaking_claim_authorised: true,
    };
    const {
      preparation_sha256: _preparationSha256,
      ...preparationBody
    } = jitPreparation;
    const tamperedPreparationBody = {
      ...preparationBody,
      fast_news_lane_decision: {
        ...tamperedDecisionBody,
        decision_sha256: canonicalSha256(
          tamperedDecisionBody,
        ),
      },
    };
    jitPreparation = {
      ...tamperedPreparationBody,
      preparation_sha256: canonicalSha256(
        tamperedPreparationBody,
      ),
    };
  }
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
    valid_until: "2026-07-30T07:50:00.000Z",
    story_id: "official-attested-story",
    final_mp4_sha256: HASHES.media_sha256,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "9".repeat(64),
  };
  greenAdmission.decision_sha256 =
    canonicalSha256(greenAdmission);
  const input = {
    now: NOW,
    story_id: "official-attested-story",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    evidence_hashes: HASHES,
    source_report: {
      path: "D:/pulse-data/official-attested-story/t90-report.json",
      file_sha256: "a".repeat(64),
      report_sha256: "b".repeat(64),
      request_sha256: "c".repeat(64),
      generated_at: "2026-07-30T07:27:30.000Z",
      valid_until: "2026-07-30T07:50:00.000Z",
    },
    green_admission: greenAdmission,
    jit_preparation: jitPreparation,
  };
  return {
    attestation:
      createAutonomousWindowEligibilityAttestation(input),
    fastNewsLaneDecision,
    jitPreparation,
  };
}

test("a lane label alone cannot classify ordinary news as breaking", () => {
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 20,
      classification: "[CONFIRMED]",
    },
    extra: {},
    attestedLaneId: "breaking_short",
    latestGovernedDecision: {
      total: 78,
      decision: "auto",
      hard_stops: [],
      scored_at: "2026-07-30T02:00:00.000Z",
    },
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_eligibility_required",
  ]);
});

test("a current governed auto decision admits an exact hash-bound window attestation despite a stale legacy score", () => {
  const exact = eligibilityAttestation();
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 20,
      classification: "[CONFIRMED]",
    },
    extra: {},
    eligibilityAttestation: exact.attestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
    expectedFastNewsStoryId: "official-attested-story",
    latestGovernedDecision: {
      total: 78,
      decision: "auto",
      hard_stops: [],
      scored_at: "2026-07-30T02:00:00.000Z",
    },
  });

  assert.equal(result.eligible, true);
  assert.equal(
    result.basis,
    "HASH_BOUND_GOVERNED_FAST_NEWS_DECISION",
  );
  assert.equal(
    result.fast_news_lane_decision_sha256,
    exact.fastNewsLaneDecision.decision_sha256,
  );
  assert.deepEqual(result.blockers, []);
});

test("a generic auto score and downstream lane attestation cannot substitute for the independent fast-news decision", () => {
  const exact = eligibilityAttestation({
    includeFastNewsDecision: false,
  });
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 20,
      classification: "[CONFIRMED]",
    },
    eligibilityAttestation: exact.attestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
    expectedFastNewsStoryId: "official-attested-story",
    latestGovernedDecision: {
      total: 100,
      decision: "auto",
      hard_stops: [],
    },
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_fast_news_decision_required",
  ]);
});

test("the independent fast-news decision must match the expected database story", () => {
  const exact = eligibilityAttestation();
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 20,
      classification: "[CONFIRMED]",
    },
    eligibilityAttestation: exact.attestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
    expectedFastNewsStoryId: "different-database-story",
    latestGovernedDecision: {
      total: 78,
      decision: "auto",
      hard_stops: [],
    },
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_fast_news_decision_invalid",
  ]);
});

test("a supplied cross-story fast-news decision blocks even a true legacy breaking signal", () => {
  const exact = eligibilityAttestation();
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 100,
      classification: "[BREAKING]",
    },
    extra: { breaking_fast_track: true },
    eligibilityAttestation: exact.attestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
    expectedFastNewsStoryId: "different-database-story",
  });

  assert.equal(result.eligible, false);
  assert.equal(
    result.fast_news_lane_decision.present,
    true,
  );
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_fast_news_decision_invalid",
  ]);
});

test("a hash-bound but semantically tampered fast-news decision blocks a true legacy breaking signal", () => {
  const exact = eligibilityAttestation({
    tamperFastNewsDecision: true,
  });
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 100,
      classification: "[BREAKING]",
    },
    extra: { breaking_fast_track: true },
    eligibilityAttestation: exact.attestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
    expectedFastNewsStoryId: "official-attested-story",
  });

  assert.equal(result.eligible, false);
  assert.equal(
    result.fast_news_lane_decision.present,
    true,
  );
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_fast_news_decision_invalid",
  ]);
});

test("a high general editorial score alone does not classify ordinary news as breaking", () => {
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 20,
      classification: "[CONFIRMED]",
    },
    extra: {},
    latestGovernedDecision: {
      total: 100,
      decision: "auto",
      hard_stops: [],
    },
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_eligibility_required",
  ]);
});

test("a current review or hard stop overrides stale legacy breaking signals", () => {
  for (const latestGovernedDecision of [
    {
      total: 99,
      decision: "review",
      hard_stops: [],
    },
    {
      total: 99,
      decision: "auto",
      hard_stops: ["advertiser_unfriendly"],
    },
  ]) {
    const result =
      evaluateGovernedBreakingLaneEligibility({
        story: {
          breaking_score: 100,
          classification: "[BREAKING]",
        },
        extra: { breaking_fast_track: true },
        latestGovernedDecision,
      });

    assert.equal(result.eligible, false);
    assert.deepEqual(result.blockers, [
      "governed_breaking_lane_current_auto_decision_required",
    ]);
  }
});

test("legacy breaking signals remain compatible when no governed score exists", () => {
  const result = evaluateGovernedBreakingLaneEligibility({
    story: { breaking_score: 80 },
    extra: {},
  });

  assert.equal(result.eligible, true);
  assert.equal(result.basis, "LEGACY_BREAKING_SIGNAL");
});

test("an invalid supplied downstream attestation blocks even a true legacy breaking signal", () => {
  const exact = eligibilityAttestation({
    includeFastNewsDecision: false,
  });
  const invalidAttestation = {
    ...exact.attestation,
    attestation_sha256: "f".repeat(64),
  };
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 100,
      classification: "[BREAKING]",
    },
    extra: { breaking_fast_track: true },
    eligibilityAttestation: invalidAttestation,
    attestationNow: NOW,
    expectedAttestation: {
      story_id: "official-attested-story",
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      jit_preparation: exact.jitPreparation,
    },
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_window_attestation_invalid",
  ]);
});

test("a governed score lookup error is distinct from no row and fails closed", () => {
  const unavailable =
    latestGovernedDecisionFromRepositories(
      {
        scoring: {
          latest() {
            throw new Error("database unavailable");
          },
        },
      },
      "official-attested-story",
    );
  const result = evaluateGovernedBreakingLaneEligibility({
    story: {
      breaking_score: 100,
      classification: "[BREAKING]",
    },
    extra: {},
    latestGovernedDecision: unavailable,
  });

  assert.equal(unavailable.lookup_status, "UNAVAILABLE");
  assert.equal(result.eligible, false);
  assert.equal(result.governed_decision.present, true);
  assert.equal(result.governed_decision.valid, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_current_auto_decision_required",
  ]);
});

test("an empty governed score lookup remains a genuine no-row result", () => {
  const missing = latestGovernedDecisionFromRepositories(
    {
      scoring: {
        latest() {
          return null;
        },
      },
    },
    "official-attested-story",
  );

  assert.equal(missing, null);
});

test("a direct SQL governed score lookup error also fails closed", () => {
  const unavailable =
    latestGovernedDecisionFromRepositories(
      {
        db: {
          prepare() {
            throw new Error("database unavailable");
          },
        },
      },
      "official-attested-story",
    );
  const result = evaluateGovernedBreakingLaneEligibility({
    story: { breaking_score: 100 },
    latestGovernedDecision: unavailable,
  });

  assert.equal(unavailable.lookup_status, "UNAVAILABLE");
  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers, [
    "governed_breaking_lane_current_auto_decision_required",
  ]);
});
