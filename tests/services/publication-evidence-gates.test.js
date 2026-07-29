"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assessOriginalityTransformation,
  assessPublicationEvidence,
  assessRightsLedger,
  assessSyntheticMediaDisclosure,
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

function transformation(overrides = {}) {
  return {
    verdict: "STRONG",
    rationale:
      "Original reporting, analysis, sequencing and motion design materially transform the source references.",
    evidence_ref: "output/qa/story-1-transformation.json",
    evidence_sha256: "1".repeat(64),
    ...overrides,
  };
}

function rightsLedger() {
  return {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion-package",
        source_url: "pulse-owned://story-1/motion-package",
        asset_sha256: "2".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "output/rights/story-1-owned-motion.json",
          sha256: "3".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
}

test("originality/transformation requires evidence and accepts only STRONG or ADEQUATE", () => {
  assert.deepEqual(
    assessOriginalityTransformation(transformation()).blockers,
    [],
  );
  assert.deepEqual(
    assessOriginalityTransformation(transformation({ verdict: "ADEQUATE" }))
      .blockers,
    [],
  );
  assert.ok(
    assessOriginalityTransformation(
      transformation({ verdict: "WEAK" }),
    ).blockers.includes("originality_transformation_weak"),
  );
  assert.ok(
    assessOriginalityTransformation(
      transformation({ evidence_ref: "" }),
    ).blockers.includes("originality_transformation_evidence_required"),
  );
});

test("per-item rights decisions are hash-bound and attribution alone is never permission", () => {
  const valid = rightsLedger();
  assert.deepEqual(
    assessRightsLedger(valid, hashRightsLedger(valid)).blockers,
    [],
  );
  const originalHash = hashRightsLedger(valid);
  const changedAfterReview = structuredClone(valid);
  changedAfterReview.items[0].source_url =
    "pulse-owned://story-1/different-package";
  assert.ok(
    assessRightsLedger(changedAfterReview, originalHash).blockers.includes(
      "rights_ledger_hash_mismatch",
    ),
  );

  const attributionOnly = structuredClone(valid);
  attributionOnly.items[0].rights_basis = "ATTRIBUTION";
  attributionOnly.items[0].attribution_decision = "REQUIRED_AND_SUPPLIED";
  attributionOnly.items[0].attribution_text = "Credit: Example publisher";
  const assessed = assessRightsLedger(
    attributionOnly,
    hashRightsLedger(attributionOnly),
  );

  assert.ok(assessed.blockers.includes("attribution_is_not_permission"));
  assert.ok(assessed.blockers.includes("rights_ledger_item_basis_required"));

  const missingAttributionDecision = structuredClone(valid);
  delete missingAttributionDecision.items[0].attribution_decision;
  assert.ok(
    assessRightsLedger(
      missingAttributionDecision,
      hashRightsLedger(missingAttributionDecision),
    ).blockers.includes("rights_ledger_attribution_decision_required"),
  );
});

test("transformative editorial use is accepted with a hash-bound review record, not attribution alone", () => {
  const editorialUse = rightsLedger();
  editorialUse.items[0] = {
    ...editorialUse.items[0],
    item_id: "publisher-reference-clip",
    source_url: "https://publisher.example/game/trailer",
    rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
    rights_evidence: {
      reference: "output/rights/story-1-editorial-use-review.json",
      sha256: "4".repeat(64),
    },
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: "Source: Example Publisher",
  };

  assert.deepEqual(
    assessRightsLedger(editorialUse, hashRightsLedger(editorialUse)).blockers,
    [],
  );

  delete editorialUse.items[0].rights_evidence;
  const missingReviewEvidence = assessRightsLedger(
    editorialUse,
    hashRightsLedger(editorialUse),
  );
  assert.ok(
    missingReviewEvidence.blockers.includes(
      "rights_ledger_basis_evidence_required",
    ),
  );
  assert.ok(
    !missingReviewEvidence.blockers.includes(
      "rights_ledger_permission_evidence_required",
    ),
  );
});

test("synthetic media always has an explicit, evidence-bearing disclosure decision", () => {
  const disclosed = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale:
      "The final edit contains synthetic narration and generated motion elements.",
    disclosure_text:
      "Includes AI-generated narration and synthetic visual elements.",
    youtube_field_value: true,
    reviewed_at: "2026-07-27T08:45:00.000Z",
  });
  assert.deepEqual(disclosed.blockers, []);

  const implicit = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    rationale: "Synthetic narration is present.",
  });
  assert.ok(
    implicit.blockers.includes("synthetic_media_disclosure_decision_required"),
  );

  const missingLabel = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale: "Synthetic narration is present.",
    disclosure_text: "",
  });
  assert.ok(
    missingLabel.blockers.includes("synthetic_media_disclosure_text_required"),
  );

  const unexplainedNonDisclosure = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    decision: "NO_DISCLOSURE_REQUIRED",
    rationale: "The operator decided not to apply a platform label.",
  });
  assert.ok(
    unexplainedNonDisclosure.blockers.includes(
      "synthetic_media_non_disclosure_policy_basis_required",
    ),
  );

  const contradictoryPlatformField = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale: "Synthetic narration is present.",
    disclosure_text: "Includes AI-generated narration.",
    youtube_field_value: false,
    reviewed_at: "2026-07-27T08:45:00.000Z",
  });
  assert.ok(
    contradictoryPlatformField.blockers.includes(
      "synthetic_media_youtube_field_mismatch",
    ),
  );
});

test("system policy disclosure normalises to a closed provenance-bound decision without human fields", () => {
  const disclosed = assessSyntheticMediaDisclosure({
    decision_authority: "SYSTEM_POLICY",
    altered_content: true,
    policy_basis: "DISCLOSE",
    youtube_field_value: true,
    decision_provenance: {
      policy_id: "pulse-youtube-synthetic-disclosure",
      policy_version: "1",
      evaluated_at: "2026-07-29T09:59:45.000Z",
      evidence_sha256: "a".repeat(64),
    },
  });

  assert.deepEqual(disclosed.blockers, []);
  assert.deepEqual(disclosed.decision, {
    schema_version: "pulse-system-policy-synthetic-media-disclosure-v1",
    decision_authority: "SYSTEM_POLICY",
    altered_content: true,
    policy_basis: "DISCLOSE",
    youtube_field_value: true,
    decision_provenance: {
      policy_id: "pulse-youtube-synthetic-disclosure",
      policy_version: "1",
      evaluated_at: "2026-07-29T09:59:45.000Z",
      evidence_sha256: "a".repeat(64),
    },
  });
  assert.equal(Object.hasOwn(disclosed.decision, "operator_decision"), false);
  assert.equal(Object.hasOwn(disclosed.decision, "reviewed_at"), false);
});

test("system policy disclosure rejects human fields, open provenance and policy-to-YouTube mismatches", () => {
  const input = {
    decision_authority: "SYSTEM_POLICY",
    altered_content: true,
    policy_basis: "NO_DISCLOSURE_REQUIRED",
    youtube_field_value: false,
    decision_provenance: {
      policy_id: "pulse-youtube-synthetic-disclosure",
      policy_version: "1",
      evaluated_at: "2026-07-29T09:59:45.000Z",
      evidence_sha256: "a".repeat(64),
    },
  };
  assert.deepEqual(assessSyntheticMediaDisclosure(input).blockers, []);

  const operatorField = assessSyntheticMediaDisclosure({
    ...input,
    operator_decision: "NO_DISCLOSURE_REQUIRED",
  });
  assert.ok(
    operatorField.blockers.includes(
      "synthetic_media_system_policy_fields_invalid",
    ),
  );

  const openProvenance = assessSyntheticMediaDisclosure({
    ...input,
    decision_provenance: {
      ...input.decision_provenance,
      reviewed_by: "operator",
    },
  });
  assert.ok(
    openProvenance.blockers.includes(
      "synthetic_media_system_policy_provenance_required",
    ),
  );

  const mismatchedYouTubeField = assessSyntheticMediaDisclosure({
    ...input,
    youtube_field_value: true,
  });
  assert.ok(
    mismatchedYouTubeField.blockers.includes(
      "synthetic_media_youtube_field_mismatch",
    ),
  );
});

test("legacy human disclosure retains its existing normalised shape", () => {
  const reviewed = assessSyntheticMediaDisclosure({
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale: "The final edit contains synthetic narration.",
    disclosure_text: "Includes AI-generated narration.",
    youtube_field_value: true,
    reviewed_at: "2026-07-27T08:45:00.000Z",
  });

  assert.deepEqual(reviewed.blockers, []);
  assert.deepEqual(reviewed.decision, {
    contains_synthetic_media: true,
    synthetic_disclosure_required: true,
    decision: "DISCLOSE",
    operator_decision: "DISCLOSE",
    rationale: "The final edit contains synthetic narration.",
    reason: "The final edit contains synthetic narration.",
    disclosure_text: "Includes AI-generated narration.",
    policy_basis: null,
    youtube_field_value: true,
    reviewed_at: "2026-07-27T08:45:00.000Z",
  });
});

test("combined publication evidence returns admission-ready immutable state evidence", () => {
  const ledger = rightsLedger();
  const assessment = assessPublicationEvidence({
    originality_transformation: transformation({ verdict: "ADEQUATE" }),
    rights_ledger: ledger,
    rights_ledger_sha256: hashRightsLedger(ledger),
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "The final edit contains synthetic narration.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  });

  assert.equal(assessment.eligible, true);
  assert.deepEqual(assessment.blockers, []);
  assert.equal(
    assessment.stateEvidence.ASSETS_CLEARED.originality_transformation.verdict,
    "ADEQUATE",
  );
  assert.equal(
    assessment.stateEvidence.ASSETS_CLEARED.rights_ledger.items[0].rights_basis,
    "OWNED",
  );
  assert.equal(
    assessment.stateEvidence.HUMAN_APPROVED.synthetic_media_disclosure.decision,
    "DISCLOSE",
  );
});
