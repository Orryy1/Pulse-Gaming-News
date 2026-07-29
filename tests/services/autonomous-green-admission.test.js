"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  EVIDENCE_SCHEMA_VERSION,
  EVALUATOR_SCHEMA_VERSION,
  POLICY_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  evaluateAutonomousGreenAdmission: evaluateAdmission,
} = require("../../lib/services/autonomous-green-admission");

const EVALUATED_AT = "2026-07-28T12:00:00.000Z";

function evaluateAutonomousGreenAdmission(
  evidence,
  evaluatedAt = EVALUATED_AT,
) {
  return evaluateAdmission(evidence, {
    clock: () => new Date(evaluatedAt),
  });
}

function hash(label) {
  return crypto.createHash("sha256").update(label).digest("hex");
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

function greenEvidence() {
  const storyId = "official-xbox-001";
  const hashes = {
    source_intake_sha256: hash("source-intake"),
    claim_map_sha256: hash("claim-map"),
    script_sha256: hash("script"),
    narration_sha256: hash("narration"),
    timestamps_sha256: hash("timestamps"),
    media_inventory_sha256: hash("media-inventory"),
    rights_ledger_sha256: hash("rights-ledger"),
    motion_manifest_sha256: hash("motion-manifest"),
    render_manifest_sha256: hash("render-manifest"),
    final_mp4_sha256: hash("final-mp4"),
    qa_report_sha256: hash("qa-report"),
    publication_metadata_sha256: hash("publication-metadata"),
    package_manifest_sha256: hash("package-manifest"),
  };
  const evidence = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    story: {
      story_id: storyId,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      source_type: "OFFICIAL",
      primary_source: true,
      verification_status: "CONFIRMED",
      content_classification: "CONFIRMED_NEWS",
      rumour: false,
    },
    freshness: {
      discovered_at: "2026-07-28T11:00:00.000Z",
      source_last_checked_at: "2026-07-28T11:45:00.000Z",
      publish_by: "2026-07-28T15:00:00.000Z",
      stale_after: "2026-07-28T18:00:00.000Z",
      valid_until: "2026-07-28T12:15:00.000Z",
      reverification_required: true,
      stale_reframe_option: {
        allowed: true,
        reason: "Reframe as a confirmed platform-change explainer.",
      },
    },
    prompt_injection: {
      verdict: "PASS",
    },
    hashes,
    qa: {
      story_id: storyId,
      report_sha256: hashes.qa_report_sha256,
      final_mp4_sha256: hashes.final_mp4_sha256,
      verdict: "PASS",
      blockers: [],
    },
    renderer: {
      story_id: storyId,
      manifest_sha256: hashes.render_manifest_sha256,
      final_mp4_sha256: hashes.final_mp4_sha256,
      script_sha256: hashes.script_sha256,
      narration_sha256: hashes.narration_sha256,
      timestamps_sha256: hashes.timestamps_sha256,
      media_inventory_sha256: hashes.media_inventory_sha256,
      rights_ledger_sha256: hashes.rights_ledger_sha256,
      motion_manifest_sha256: hashes.motion_manifest_sha256,
      verdict: "PASS",
      publishable: true,
      blockers: [],
    },
    package_binding: {
      story_id: storyId,
      ...hashes,
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      disclosure_required: true,
      decision: "DISCLOSE",
      youtube_field_value: true,
    },
    commercial_scope: {
      destinations: ["YOUTUBE"],
      revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
      territory: "WORLDWIDE",
      account_id: "pulse-gaming-youtube",
      sponsor: false,
      affiliate: false,
      client: false,
      paid_access: false,
    },
    media_items: [
      {
        item_id: "owned-motion",
        asset_sha256: hash("owned-motion-asset"),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence_sha256: hash("owned-motion-rights"),
        licence_document_sha256: null,
        review_status: "VERIFIED",
        risk_decision: null,
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
        scope: {
          destinations: ["YOUTUBE"],
          revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
          territory: "WORLDWIDE",
          account_id: "pulse-gaming-youtube",
        },
      },
    ],
  };
  return evidence;
}

test("returns GREEN for an exact official, current and evidence-cleared YouTube breaking Short", () => {
  const result = evaluateAutonomousGreenAdmission(greenEvidence());

  assert.equal(result.result_schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.decision_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evaluated_at, EVALUATED_AT);
});

test("strict closed schemas classify hidden authority-shaped input as SKIP_UNSAFE", () => {
  const evidence = greenEvidence();
  evidence.story.publish_immediately = true;

  const result = evaluateAutonomousGreenAdmission(evidence);

  assert.equal(result.verdict, "SKIP_UNSAFE");
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("story_schema_closed"));
});

test("non-official, rumour or prompt-injection-failing stories are SKIP_UNSAFE", () => {
  const cases = [
    {
      mutate(evidence) {
        evidence.story.source_type = "SOCIAL_POST";
      },
      blocker: "official_primary_non_rumour_story_required",
    },
    {
      mutate(evidence) {
        evidence.story.rumour = true;
      },
      blocker: "official_primary_non_rumour_story_required",
    },
    {
      mutate(evidence) {
        evidence.prompt_injection.verdict = "FAIL";
      },
      blocker: "prompt_injection_pass_required",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    scenario.mutate(evidence);
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "SKIP_UNSAFE");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes(scenario.blocker));
  }
});

test("expired or no-longer-recent evidence is SKIP_STALE", () => {
  const cases = [
    {
      mutate(evidence) {
        evidence.freshness.source_last_checked_at = "2026-07-28T11:29:59.999Z";
      },
      blocker: "source_reverification_stale",
    },
    {
      mutate(evidence) {
        return evidence.freshness.publish_by;
      },
      blocker: "story_stale",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    const evaluatedAt = scenario.mutate(evidence);
    const result = evaluateAutonomousGreenAdmission(
      evidence,
      evaluatedAt ?? EVALUATED_AT,
    );

    assert.equal(result.verdict, "SKIP_STALE");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes(scenario.blocker));
  }
});

test("mixed evidence-cleared and unsafe media returns SUBSTITUTE_OWNED", () => {
  const evidence = greenEvidence();
  evidence.media_items.push({
    ...evidence.media_items[0],
    item_id: "third-party-gameplay",
    asset_sha256: hash("third-party-gameplay"),
    rights_evidence_sha256: hash("third-party-gameplay-rights"),
    rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
    review_status: "HUMAN_REVIEW",
    risk_decision: "RISK_ACCEPTED",
  });

  const result = evaluateAutonomousGreenAdmission(evidence);

  assert.equal(result.verdict, "SUBSTITUTE_OWNED");
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("media_item_1_automatic_rights_required"));
});

test("fresh evidence does not require a stale-reframe route to be GREEN", () => {
  const evidence = greenEvidence();
  evidence.freshness.stale_reframe_option = {
    allowed: false,
    reason: "This announcement has no durable owned-only angle.",
  };

  const result = evaluateAutonomousGreenAdmission(evidence);

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
});

test("an all-unsafe media set returns REFRAME_OWNED_ONLY", () => {
  const cases = [
    {
      field: "rights_basis",
      value: "TRANSFORMATIVE_EDITORIAL_USE",
    },
    {
      field: "rights_basis",
      value: "ATTRIBUTION_ONLY",
    },
    {
      field: "review_status",
      value: "HUMAN_REVIEW",
    },
    {
      field: "risk_decision",
      value: "RISK_ACCEPTED",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    evidence.media_items[0][scenario.field] = scenario.value;

    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "REFRAME_OWNED_ONLY");
    assert.equal(result.eligible, false);
    assert.ok(
      result.blockers.includes("media_item_0_automatic_rights_required"),
    );
  }
});

test("an explicitly licensed, proof-bound media item can be GREEN", () => {
  const evidence = greenEvidence();
  evidence.media_items[0] = {
    ...evidence.media_items[0],
    item_id: "licensed-publisher-art",
    rights_basis: "EXPLICIT_LICENCE",
    asset_sha256: hash("licensed-publisher-art"),
    rights_evidence_sha256: hash("licensed-rights-evidence"),
    licence_document_sha256: hash("licensed-document"),
    review_status: "VERIFIED",
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: "Publisher media used under explicit licence.",
  };

  const result = evaluateAutonomousGreenAdmission(evidence);

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
});

test("missing proof, failed QA, failed render, disclosure or scope evidence returns HOLD", () => {
  const cases = [
    {
      mutate(evidence) {
        evidence.hashes.rights_ledger_sha256 = "";
      },
      blocker: "rights_ledger_sha256_required",
    },
    {
      mutate(evidence) {
        evidence.qa.verdict = "RED";
      },
      blocker: "qa_green_required",
    },
    {
      mutate(evidence) {
        evidence.renderer.publishable = false;
      },
      blocker: "renderer_green_required",
    },
    {
      mutate(evidence) {
        evidence.synthetic_media_disclosure.youtube_field_value = false;
      },
      blocker: "deterministic_synthetic_disclosure_required",
    },
    {
      mutate(evidence) {
        evidence.commercial_scope.revenue_modes = ["ORGANIC"];
      },
      blocker: "commercial_scope_organic_platform_ad_scope_required",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    scenario.mutate(evidence);
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes(scenario.blocker));
  }
});

test("every evidence object is closed and missing required fields remain HOLD", () => {
  const extraFieldCases = [
    {
      mutate(evidence) {
        evidence.unexpected = true;
      },
      blocker: "evidence_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.freshness.unexpected = true;
      },
      blocker: "freshness_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.freshness.stale_reframe_option.unexpected = true;
      },
      blocker: "freshness_stale_reframe_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.prompt_injection.unexpected = true;
      },
      blocker: "prompt_injection_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.hashes.unexpected = hash("8");
      },
      blocker: "hashes_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.qa.unexpected = true;
      },
      blocker: "qa_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.renderer.unexpected = true;
      },
      blocker: "renderer_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.synthetic_media_disclosure.unexpected = true;
      },
      blocker: "synthetic_media_disclosure_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.commercial_scope.unexpected = true;
      },
      blocker: "commercial_scope_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.media_items[0].unexpected = true;
      },
      blocker: "media_item_0_schema_closed",
    },
    {
      mutate(evidence) {
        evidence.media_items[0].scope.unexpected = true;
      },
      blocker: "media_item_0_scope_schema_closed",
    },
  ];

  for (const scenario of extraFieldCases) {
    const evidence = greenEvidence();
    scenario.mutate(evidence);
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "SKIP_UNSAFE");
    assert.ok(result.blockers.includes(scenario.blocker));
  }

  const incomplete = greenEvidence();
  delete incomplete.story.story_id;
  const incompleteResult = evaluateAutonomousGreenAdmission(incomplete);

  assert.equal(incompleteResult.verdict, "HOLD");
  assert.ok(incompleteResult.blockers.includes("story_story_id_required"));
});

test("evidence and decision SHAs are canonical, repeatable and sensitive to evidence changes", () => {
  const evidence = greenEvidence();
  const first = evaluateAutonomousGreenAdmission(evidence);
  const repeated = evaluateAutonomousGreenAdmission(evidence);
  const reordered = evaluateAutonomousGreenAdmission(
    reverseObjectKeys(evidence),
  );
  const changedEvidence = greenEvidence();
  changedEvidence.freshness.stale_reframe_option.reason =
    "A different safe evergreen reframe.";
  const changed = evaluateAutonomousGreenAdmission(changedEvidence);

  assert.deepEqual(repeated, first);
  assert.equal(reordered.evidence_sha256, first.evidence_sha256);
  assert.equal(reordered.decision_sha256, first.decision_sha256);
  assert.notEqual(changed.evidence_sha256, first.evidence_sha256);
  assert.notEqual(changed.decision_sha256, first.decision_sha256);
  assert.equal(changed.verdict, "GREEN");
});

test("result shape is closed, machine-only and uses only canonical verdicts", () => {
  const results = [];

  results.push(evaluateAutonomousGreenAdmission(greenEvidence()));

  const stale = greenEvidence();
  results.push(
    evaluateAutonomousGreenAdmission(stale, stale.freshness.publish_by),
  );

  const unsafe = greenEvidence();
  unsafe.story.rumour = true;
  results.push(evaluateAutonomousGreenAdmission(unsafe));

  const hold = greenEvidence();
  hold.hashes.source_intake_sha256 = "";
  results.push(evaluateAutonomousGreenAdmission(hold));

  const substitute = greenEvidence();
  substitute.media_items.push({
    ...substitute.media_items[0],
    item_id: "unsafe-secondary",
    asset_sha256: hash("unsafe-secondary"),
    rights_evidence_sha256: hash("unsafe-secondary-rights"),
    rights_basis: "ATTRIBUTION_ONLY",
  });
  results.push(evaluateAutonomousGreenAdmission(substitute));

  const reframe = greenEvidence();
  reframe.media_items[0].review_status = "HUMAN_REVIEW";
  results.push(evaluateAutonomousGreenAdmission(reframe));

  assert.deepEqual(
    new Set(results.map((result) => result.verdict)),
    new Set([
      "GREEN",
      "SUBSTITUTE_OWNED",
      "REFRAME_OWNED_ONLY",
      "SKIP_STALE",
      "SKIP_UNSAFE",
      "HOLD",
    ]),
  );

  for (const result of results) {
    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "decision_scope",
      "decision_sha256",
      "dispatch_revalidation_required",
      "eligible",
      "evaluated_at",
      "evaluator_schema_version",
      "evidence_sha256",
      "final_mp4_sha256",
      "operational_publish_authority",
      "policy_version",
      "result_schema_version",
      "story_id",
      "trust_semantics",
      "valid_until",
      "verdict",
    ]);
    for (const key of Object.keys(result)) {
      assert.doesNotMatch(key, /human|operator|actor|reviewed_by/i);
    }
  }
});

test("malformed root evidence is deterministic HOLD evidence, not an exception", () => {
  const first = evaluateAutonomousGreenAdmission(null);
  const repeated = evaluateAutonomousGreenAdmission(null);

  assert.equal(first.verdict, "HOLD");
  assert.equal(first.eligible, false);
  assert.match(first.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.match(first.decision_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(repeated, first);
});

test("uses an injected trusted clock instead of evidence time for freshness authority", () => {
  const evidence = greenEvidence();

  const result = evaluateAdmission(evidence, {
    clock: () => new Date("2026-07-28T15:00:00.000Z"),
  });

  assert.equal(result.evaluated_at, "2026-07-28T15:00:00.000Z");
  assert.equal(result.verdict, "SKIP_STALE");
  assert.ok(result.blockers.includes("story_stale"));
});

test("requires a trusted clock and rejects evidence-supplied evaluation time", () => {
  const withoutClock = evaluateAdmission(greenEvidence());

  assert.equal(withoutClock.verdict, "HOLD");
  assert.equal(withoutClock.eligible, false);
  assert.ok(withoutClock.blockers.includes("trusted_clock_required"));

  const backdated = greenEvidence();
  backdated.evaluated_at = "2026-07-28T11:46:00.000Z";
  const withTrustedClock = evaluateAutonomousGreenAdmission(backdated);

  assert.equal(withTrustedClock.verdict, "SKIP_UNSAFE");
  assert.equal(withTrustedClock.eligible, false);
  assert.ok(withTrustedClock.blockers.includes("evidence_schema_closed"));
});

test("expires evidence at its hash-bound valid_until boundary to prevent replay", () => {
  const evidence = greenEvidence();

  const beforeExpiry = evaluateAutonomousGreenAdmission(
    evidence,
    "2026-07-28T12:14:59.999Z",
  );
  const atExpiry = evaluateAutonomousGreenAdmission(
    evidence,
    evidence.freshness.valid_until,
  );

  assert.equal(beforeExpiry.verdict, "GREEN");
  assert.equal(beforeExpiry.valid_until, evidence.freshness.valid_until);
  assert.equal(atExpiry.verdict, "SKIP_STALE");
  assert.equal(atExpiry.eligible, false);
  assert.ok(atExpiry.blockers.includes("evidence_validity_expired"));
});

test("valid_until cannot outlive its reverification, publish or stale boundary", () => {
  const evidence = greenEvidence();
  evidence.freshness.valid_until = "2026-07-28T12:15:00.001Z";

  const result = evaluateAutonomousGreenAdmission(evidence);

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("freshness_valid_until_invalid"));
});

test("accepts only canonical UTC RFC3339 evidence timestamps", () => {
  const cases = [
    {
      field: "discovered_at",
      value: "2026-07-28T11:00:00",
      blocker: "freshness_discovered_at_invalid",
    },
    {
      field: "source_last_checked_at",
      value: "2026-07-28T12:45:00.000+01:00",
      blocker: "freshness_source_last_checked_at_invalid",
    },
    {
      field: "publish_by",
      value: "2026-07-28T15:00:00Z",
      blocker: "freshness_publish_by_invalid",
    },
    {
      field: "stale_after",
      value: "2026-02-30T18:00:00.000Z",
      blocker: "freshness_stale_after_invalid",
    },
    {
      field: "valid_until",
      value: " 2026-07-28T12:15:00.000Z ",
      blocker: "freshness_valid_until_invalid",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    evidence.freshness[scenario.field] = scenario.value;
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes(scenario.blocker));
  }
});

test("rejects non-canonical JSON input before hashing or evaluation", () => {
  const factories = [
    () => undefined,
    () => {
      const evidence = greenEvidence();
      evidence.hashes.script_sha256 = undefined;
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence.media_items = new Array(1);
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence.story.rumour = Number.NaN;
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence.hashes.script_sha256 = 1n;
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence.story.primary_source = () => true;
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      Object.setPrototypeOf(evidence.story, { inherited: true });
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence.self = evidence;
      return evidence;
    },
    () => {
      const evidence = greenEvidence();
      evidence[Symbol("hidden")] = true;
      return evidence;
    },
    () => new Proxy(greenEvidence(), {}),
  ];

  for (const buildEvidence of factories) {
    const result = evaluateAutonomousGreenAdmission(buildEvidence());

    assert.equal(result.verdict, "SKIP_UNSAFE");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes("evidence_not_canonical_json"));
  }
});

test("requires every cross-bound lineage digest and rejects sentinel hashes", () => {
  const sentinelHashes = [
    "0".repeat(64),
    "f".repeat(64),
    "deadbeef".repeat(8),
    crypto.createHash("sha256").update("").digest("hex"),
    hash("uppercase-digest").toUpperCase(),
    ` ${hash("whitespace-digest")}`,
  ];

  for (const sentinel of sentinelHashes) {
    const evidence = greenEvidence();
    evidence.hashes.final_mp4_sha256 = sentinel;
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes("final_mp4_sha256_required"));
  }

  const missing = greenEvidence();
  delete missing.hashes.claim_map_sha256;
  const missingResult = evaluateAutonomousGreenAdmission(missing);

  assert.equal(missingResult.verdict, "HOLD");
  assert.ok(
    missingResult.blockers.includes("hashes_claim_map_sha256_required"),
  );

  const reusedDigest = greenEvidence();
  const oneDigest = hash("one-fake-digest");
  for (const field of Object.keys(reusedDigest.hashes)) {
    reusedDigest.hashes[field] = oneDigest;
    reusedDigest.package_binding[field] = oneDigest;
  }
  reusedDigest.qa.report_sha256 = oneDigest;
  reusedDigest.qa.final_mp4_sha256 = oneDigest;
  for (const field of [
    "manifest_sha256",
    "final_mp4_sha256",
    "script_sha256",
    "narration_sha256",
    "timestamps_sha256",
    "media_inventory_sha256",
    "rights_ledger_sha256",
    "motion_manifest_sha256",
  ]) {
    reusedDigest.renderer[field] = oneDigest;
  }
  const reusedDigestResult = evaluateAutonomousGreenAdmission(reusedDigest);

  assert.equal(reusedDigestResult.verdict, "HOLD");
  assert.ok(reusedDigestResult.blockers.includes("lineage_digest_reuse"));
});

test("rejects mixed-story, mixed-render and mixed-package lineage", () => {
  const cases = [
    {
      mutate(evidence) {
        evidence.qa.story_id = "different-story";
      },
      blocker: "qa_lineage_mismatch",
    },
    {
      mutate(evidence) {
        evidence.renderer.script_sha256 = hash("other-script");
      },
      blocker: "renderer_lineage_mismatch",
    },
    {
      mutate(evidence) {
        evidence.package_binding.final_mp4_sha256 = hash("other-final");
      },
      blocker: "package_binding_lineage_mismatch",
    },
  ];

  for (const scenario of cases) {
    const evidence = greenEvidence();
    scenario.mutate(evidence);
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes(scenario.blocker));
  }
});

test("derives asset clearance from proof and rejects self-authorising flags", () => {
  const selfAuthorised = greenEvidence();
  selfAuthorised.media_items[0].automatic_clearance = true;
  const selfAuthorisedResult = evaluateAutonomousGreenAdmission(selfAuthorised);

  assert.equal(selfAuthorisedResult.verdict, "SKIP_UNSAFE");
  assert.ok(
    selfAuthorisedResult.blockers.includes("media_item_0_schema_closed"),
  );

  const licensed = greenEvidence();
  licensed.media_items[0] = {
    ...licensed.media_items[0],
    item_id: "licensed-publisher-art",
    asset_sha256: hash("licensed-publisher-art"),
    rights_basis: "EXPLICIT_LICENCE",
    rights_evidence_sha256: hash("publisher-rights-evidence"),
    licence_document_sha256: hash("publisher-licence-document"),
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: "Publisher media used under explicit licence.",
  };
  const licensedResult = evaluateAutonomousGreenAdmission(licensed);

  assert.equal(licensedResult.verdict, "GREEN");
  assert.deepEqual(licensedResult.blockers, []);

  licensed.media_items[0].licence_document_sha256 = null;
  const missingLicenceResult = evaluateAutonomousGreenAdmission(licensed);

  assert.equal(missingLicenceResult.verdict, "REFRAME_OWNED_ONLY");
  assert.ok(
    missingLicenceResult.blockers.includes(
      "media_item_0_automatic_rights_required",
    ),
  );

  const reusedProofDigest = greenEvidence();
  reusedProofDigest.media_items[0].rights_evidence_sha256 =
    reusedProofDigest.media_items[0].asset_sha256;
  const reusedProofResult = evaluateAutonomousGreenAdmission(reusedProofDigest);

  assert.equal(reusedProofResult.verdict, "REFRAME_OWNED_ONLY");
  assert.ok(
    reusedProofResult.blockers.includes(
      "media_item_0_automatic_rights_required",
    ),
  );

  const duplicatedAsset = greenEvidence();
  duplicatedAsset.media_items.push({
    ...duplicatedAsset.media_items[0],
    item_id: "duplicate-owned-motion",
    rights_evidence_sha256: hash("duplicate-owned-motion-rights"),
  });
  const duplicatedAssetResult =
    evaluateAutonomousGreenAdmission(duplicatedAsset);

  assert.equal(duplicatedAssetResult.verdict, "HOLD");
  assert.ok(
    duplicatedAssetResult.blockers.includes("media_asset_sha256_duplicate"),
  );
});

test("allows only ordinary platform ads and verifies each asset licence scope", () => {
  for (const flag of ["sponsor", "affiliate", "client", "paid_access"]) {
    const evidence = greenEvidence();
    evidence.commercial_scope[flag] = true;
    const result = evaluateAutonomousGreenAdmission(evidence);

    assert.equal(result.verdict, "HOLD");
    assert.equal(result.eligible, false);
    assert.ok(
      result.blockers.includes("commercial_scope_non_ad_revenue_prohibited"),
    );
  }

  const wrongTerritory = greenEvidence();
  wrongTerritory.media_items[0].scope.territory = "GB";
  const wrongTerritoryResult = evaluateAutonomousGreenAdmission(wrongTerritory);

  assert.equal(wrongTerritoryResult.verdict, "REFRAME_OWNED_ONLY");
  assert.ok(
    wrongTerritoryResult.blockers.includes(
      "media_item_0_automatic_rights_required",
    ),
  );

  const wrongAccount = greenEvidence();
  wrongAccount.media_items[0].scope.account_id = "other-channel";
  const wrongAccountResult = evaluateAutonomousGreenAdmission(wrongAccount);

  assert.equal(wrongAccountResult.verdict, "REFRAME_OWNED_ONLY");
  assert.ok(
    wrongAccountResult.blockers.includes(
      "media_item_0_automatic_rights_required",
    ),
  );

  const restrictedTerritory = greenEvidence();
  restrictedTerritory.commercial_scope.territory = "GB";
  restrictedTerritory.media_items[0].scope.territory = "GB";
  const restrictedTerritoryResult =
    evaluateAutonomousGreenAdmission(restrictedTerritory);

  assert.equal(restrictedTerritoryResult.verdict, "HOLD");
  assert.ok(
    restrictedTerritoryResult.blockers.includes(
      "commercial_scope_worldwide_territory_required",
    ),
  );

  const differentAccount = greenEvidence();
  differentAccount.commercial_scope.account_id = "other-channel";
  differentAccount.media_items[0].scope.account_id = "other-channel";
  const differentAccountResult =
    evaluateAutonomousGreenAdmission(differentAccount);

  assert.equal(differentAccountResult.verdict, "HOLD");
  assert.ok(
    differentAccountResult.blockers.includes(
      "commercial_scope_pulse_account_required",
    ),
  );
});

test("returns a hash-bound editorial decision that cannot authorise publication", () => {
  const evidence = greenEvidence();
  const result = evaluateAutonomousGreenAdmission(evidence);
  const { decision_sha256: decisionSha256, ...decisionPayload } = result;

  assert.match(EVIDENCE_SCHEMA_VERSION, /-v2$/);
  assert.match(EVALUATOR_SCHEMA_VERSION, /-v2$/);
  assert.match(RESULT_SCHEMA_VERSION, /-v2$/);
  assert.match(POLICY_VERSION, /-v2$/);
  assert.equal(result.result_schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.evaluator_schema_version, EVALUATOR_SCHEMA_VERSION);
  assert.equal(result.policy_version, POLICY_VERSION);
  assert.equal(result.decision_scope, "EDITORIAL_ELIGIBILITY_ONLY");
  assert.equal(result.operational_publish_authority, false);
  assert.equal(result.trust_semantics, "AUTHORITATIVE_MATERIALISER_REQUIRED");
  assert.equal(result.dispatch_revalidation_required, true);
  assert.equal(result.story_id, evidence.story.story_id);
  assert.equal(result.final_mp4_sha256, evidence.hashes.final_mp4_sha256);
  assert.match(result.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.match(decisionSha256, /^[a-f0-9]{64}$/);
  assert.equal(decisionSha256, canonicalSha256(decisionPayload));
});
