"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createAutonomousOfficialJitPreparationManifest,
  STATIC_ARTIFACT_FIELDS,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  canonicalSha256,
  validateAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  REQUEST_SCHEMA_VERSION,
  T75_VALIDITY_MARGIN_MS,
  composeGovernedAutonomousPreT90Candidates,
  validateGovernedAutonomousPreT90CandidateComposition,
} = require("../../lib/services/governed-autonomous-pre-t90-candidate-composition");

const NOW = "2026-07-30T07:28:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const T75 = "2026-07-30T07:45:00.000Z";
const REQUIRED_VALID_THROUGH = "2026-07-30T07:46:01.000Z";

function hash(label) {
  return crypto.createHash("sha256").update(label).digest("hex");
}

function coordinatorResult(storyId, role) {
  const artifacts = Object.fromEntries(
    STATIC_ARTIFACT_FIELDS.map((field) => [
      field,
      {
        path: `output/canary/${storyId}/artifacts/${field}`,
        sha256: hash(`${storyId}:${field}`),
      },
    ]),
  );
  artifacts.final_mp4.path =
    `output/canary/${storyId}/final/${storyId}.mp4`;
  const candidateRevisionSha256 = hash(`${storyId}:candidate-revision`);
  const requestFingerprint = hash(`${storyId}:request-fingerprint`);
  const rightsLedgerSha256 = hash(`${storyId}:jit-rights-ledger`);
  const preparation = createAutonomousOfficialJitPreparationManifest({
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
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
          evaluated_at: NOW,
          evidence_sha256: artifacts.final_composite_manifest.sha256,
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
  const lineage = {
    source_intake_sha256: artifacts.story_intake.sha256,
    claim_map_sha256: hash(`${storyId}:claim-map`),
    script_sha256: hash(`${storyId}:script`),
    narration_sha256: artifacts.narration_audio.sha256,
    timestamps_sha256: hash(`${storyId}:timestamps`),
    media_inventory_sha256: hash(`${storyId}:media-inventory`),
    rights_ledger_sha256: hash(`${storyId}:editorial-rights-ledger`),
    motion_manifest_sha256: artifacts.owned_motion_manifest.sha256,
    render_manifest_sha256: artifacts.renderer_manifest.sha256,
    final_mp4_sha256: artifacts.final_mp4.sha256,
    qa_report_sha256: artifacts.deterministic_qa.sha256,
    publication_metadata_sha256: artifacts.publication_metadata.sha256,
    package_manifest_sha256: hash(`${storyId}:package-manifest`),
  };
  const mediaItem = {
    item_id: "owned-motion",
    asset_sha256: hash(`${storyId}:owned-motion-asset`),
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: "OWNED",
    rights_evidence_sha256: hash(`${storyId}:owned-motion-rights`),
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
  };
  return {
    schema_version: "pulse-governed-autonomous-production-result-v1",
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    story_id: storyId,
    green_supplement: {
      verdict: "GREEN",
      authority_scope: "LOCAL_PROOF_EVIDENCE_ONLY",
      story_id: storyId,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      hashes: lineage,
      prompt_injection: {
        verdict: "PASS",
      },
      media_items: [mediaItem],
      safety: {
        publish_authority: false,
        scheduler_authority: false,
        database_authority: false,
        oauth_or_token_authority: false,
        network_authority: false,
        platform_contacted: false,
      },
    },
    staging: {
      schema_version: "pulse-autonomous-official-candidate-staging-result-v3",
      mode: "LOCAL_PROOF",
      verdict: "GREEN",
      blockers: [],
      story_id: storyId,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role,
      preparation_sha256: preparation.preparation_sha256,
      rights_ledger_sha256: rightsLedgerSha256,
      preparation_manifest: preparation,
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
      external_publish_authorised: false,
    },
  };
}

function sourceSnapshot(storyId, validUntil = "2026-07-30T07:50:00.000Z") {
  return {
    discovered_at: "2026-07-30T06:00:00.000Z",
    source_last_checked_at: "2026-07-30T07:27:30.000Z",
    publish_by: "2026-07-30T12:00:00.000Z",
    stale_after: "2026-07-30T13:00:00.000Z",
    stale_reframe_option: {
      allowed: true,
      reason: "Reframe as a confirmed player-impact explainer.",
    },
    source_report: {
      path: `output/canary/${storyId}/eligibility/t90-source-report.json`,
      file_sha256: hash(`${storyId}:source-report-file`),
      report_sha256: hash(`${storyId}:source-report`),
      request_sha256: hash(`${storyId}:source-report-request`),
      generated_at: "2026-07-30T07:27:30.000Z",
      valid_until: validUntil,
    },
  };
}

function request() {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    now: NOW,
    scheduled_for: SCHEDULED_FOR,
    primary: {
      coordinator_result: coordinatorResult("story-primary", "PRIMARY"),
      source_snapshot: sourceSnapshot("story-primary"),
    },
    reserve: {
      coordinator_result: coordinatorResult("story-reserve", "STANDBY"),
      source_snapshot: sourceSnapshot("story-reserve"),
    },
  };
}

test("composes distinct primary and reserve plans whose eligibility remains valid through T75", () => {
  const result = composeGovernedAutonomousPreT90Candidates(request());

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.scheduled_for, SCHEDULED_FOR);
  assert.equal(result.t75_at, T75);
  assert.equal(result.required_valid_through, REQUIRED_VALID_THROUGH);
  assert.equal(T75_VALIDITY_MARGIN_MS, 61_000);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.role),
    ["PRIMARY", "STANDBY"],
  );

  for (const candidate of result.candidates) {
    const preparation =
      candidate.eligibility.jit_preparation;
    assert.equal(
      candidate.eligibility.attestation.valid_until,
      REQUIRED_VALID_THROUGH,
    );
    assert.equal(
      candidate.eligibility.evidence_hashes.media_sha256,
      preparation.artifacts.final_mp4.sha256,
    );
    assert.equal(
      candidate.eligibility.evidence_hashes.qa_report_sha256,
      preparation.artifacts.deterministic_qa.sha256,
    );
    assert.equal(
      candidate.eligibility.evidence_hashes.rights_ledger_sha256,
      preparation.publication_evidence_gate_input.rights_ledger_sha256,
    );
    assert.equal(
      candidate.mutation_plan.story_media_binding.set.exported_path,
      preparation.artifacts.final_mp4.path,
    );
    assert.equal(
      candidate.mutation_plan.story_media_binding.preconditions
        .full_script_sha256,
      candidate.eligibility.evidence_hashes.script_sha256,
    );
    assert.equal(
      candidate.mutation_plan.window_candidate_admission.service,
      "admitAutonomousGovernedWindowCandidate",
    );
    assert.equal(candidate.mutation_plan.database_mutated, false);
    assert.equal(candidate.mutation_plan.mutation_authority, false);
    assert.equal(candidate.publish_authority, false);
    assert.equal(candidate.external_publish_authorised, false);

    const validated = validateAutonomousWindowEligibilityAttestation(
      candidate.eligibility.attestation,
      {
        now: new Date(T75),
        expected: {
          story_id: candidate.story_id,
          channel_id: "pulse-gaming",
          lane_id: "breaking_short",
          platform: "youtube",
          scheduled_for: SCHEDULED_FOR,
          role: candidate.role,
          candidate_binding_sha256:
            candidate.eligibility.attestation.candidate_binding_sha256,
          evidence_hashes: candidate.eligibility.evidence_hashes,
          jit_preparation: preparation,
        },
      },
    );
    assert.equal(validated.decision, "ELIGIBLE");
  }

  assert.equal(result.safety.database_mutated, false);
  assert.equal(result.safety.network_used, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.platform_contacted, false);
  assert.equal(result.safety.publish_authority, false);
  assert.match(result.composition_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.composition_sha256,
    canonicalSha256(
      Object.fromEntries(
        Object.entries(result).filter(
          ([key]) => key !== "composition_sha256",
        ),
      ),
    ),
  );
});

test("emits a JSON-stable machine-readable mutation plan", () => {
  const result = composeGovernedAutonomousPreT90Candidates(request());
  const roundTripped = JSON.parse(JSON.stringify(result));
  const {
    composition_sha256: compositionSha256,
    ...roundTrippedBody
  } = roundTripped;

  for (const candidate of roundTripped.candidates) {
    assert.equal(
      candidate.mutation_plan.window_candidate_admission
        .preparation_request.now,
      NOW,
    );
  }
  assert.equal(
    compositionSha256,
    canonicalSha256(roundTrippedBody),
  );
});

test("rejects authority smuggled through a green supplement", () => {
  const input = request();
  input.primary.coordinator_result.green_supplement.safety.publish_authority =
    true;

  assert.throws(
    () => composeGovernedAutonomousPreT90Candidates(input),
    (error) =>
      error?.code ===
      "pre_t90_green_publish_authority_forbidden",
  );
});

test("strict validator accepts the exact result and rejects persisted drift", () => {
  const result = composeGovernedAutonomousPreT90Candidates(request());
  const validated =
    validateGovernedAutonomousPreT90CandidateComposition(
      JSON.parse(JSON.stringify(result)),
    );

  assert.equal(validated.composition_sha256, result.composition_sha256);

  const drifted = JSON.parse(JSON.stringify(result));
  drifted.candidates[0].mutation_plan.story_media_binding.set.exported_path =
    "output/canary/story-primary/final/substitute.mp4";
  assert.throws(
    () =>
      validateGovernedAutonomousPreT90CandidateComposition(
        drifted,
      ),
    (error) => error?.code === "pre_t90_composition_sha256_mismatch",
  );

  const rehashedAuthorityDrift = JSON.parse(JSON.stringify(result));
  rehashedAuthorityDrift.candidates[0].mutation_plan.window_candidate_admission
    .preparation_request.approval.type = "HUMAN";
  const {
    composition_sha256: _oldCompositionSha256,
    ...rehashedAuthorityDriftBody
  } = rehashedAuthorityDrift;
  rehashedAuthorityDrift.composition_sha256 = canonicalSha256(
    rehashedAuthorityDriftBody,
  );
  assert.throws(
    () =>
      validateGovernedAutonomousPreT90CandidateComposition(
        rehashedAuthorityDrift,
      ),
    (error) =>
      error?.code === "pre_t90_result_mutation_plan_invalid",
  );

  const rehashedEligibilityDrift = JSON.parse(
    JSON.stringify(result),
  );
  rehashedEligibilityDrift.candidates[0].eligibility.attestation_input
    .source_report.report_sha256 = hash("substitute-source-report");
  const {
    composition_sha256: _oldEligibilityCompositionSha256,
    ...rehashedEligibilityDriftBody
  } = rehashedEligibilityDrift;
  rehashedEligibilityDrift.composition_sha256 = canonicalSha256(
    rehashedEligibilityDriftBody,
  );
  assert.throws(
    () =>
      validateGovernedAutonomousPreT90CandidateComposition(
        rehashedEligibilityDrift,
      ),
    (error) =>
      error?.code === "pre_t90_result_attestation_input_invalid",
  );

  const rehashedPlanSmuggling = JSON.parse(JSON.stringify(result));
  rehashedPlanSmuggling.candidates[0].mutation_plan.publish_now = true;
  const {
    composition_sha256: _oldPlanSmugglingSha256,
    ...rehashedPlanSmugglingBody
  } = rehashedPlanSmuggling;
  rehashedPlanSmuggling.composition_sha256 = canonicalSha256(
    rehashedPlanSmugglingBody,
  );
  assert.throws(
    () =>
      validateGovernedAutonomousPreT90CandidateComposition(
        rehashedPlanSmuggling,
      ),
    (error) =>
      error?.code === "pre_t90_result_mutation_plan_invalid",
  );
});

test("rejects a two-minute JIT source report because it cannot survive through T75 plus margin", () => {
  const input = request();
  input.primary.source_snapshot = sourceSnapshot(
    "story-primary",
    "2026-07-30T07:30:00.000Z",
  );

  assert.throws(
    () => composeGovernedAutonomousPreT90Candidates(input),
    (error) =>
      error?.code === "pre_t90_source_report_must_cover_t75" &&
      error?.required_valid_through === REQUIRED_VALID_THROUGH &&
      error?.observed_valid_until ===
        "2026-07-30T07:30:00.000Z",
  );
});

test("rejects green evidence whose story freshness cannot cover T75 plus margin", () => {
  const input = request();
  input.primary.source_snapshot.publish_by =
    "2026-07-30T07:45:30.000Z";

  assert.throws(
    () => composeGovernedAutonomousPreT90Candidates(input),
    (error) =>
      error?.code ===
        "pre_t90_green_admission_not_valid_through_t75" &&
      error?.required_valid_through === REQUIRED_VALID_THROUGH &&
      error?.blockers?.includes("freshness_valid_until_invalid"),
  );
});

test("rejects an old source report carrying a misleading long validity window", () => {
  const input = request();
  input.primary.source_snapshot.source_report.generated_at =
    "2026-07-30T07:20:00.000Z";

  assert.throws(
    () => composeGovernedAutonomousPreT90Candidates(input),
    (error) =>
      error?.code ===
      "pre_t90_source_report_freshness_binding_invalid",
  );
});

test("requires distinct stories and exact PRIMARY/STANDBY role bindings", async (t) => {
  await t.test("duplicate story", () => {
    const input = request();
    input.reserve = {
      coordinator_result: coordinatorResult(
        "story-primary",
        "STANDBY",
      ),
      source_snapshot: sourceSnapshot("story-primary"),
    };

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) =>
        error?.code ===
        "pre_t90_distinct_primary_and_reserve_required",
    );
  });

  await t.test("duplicate PRIMARY role", () => {
    const input = request();
    input.reserve.coordinator_result = coordinatorResult(
      "story-reserve",
      "PRIMARY",
    );

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) => error?.code === "pre_t90_role_mismatch",
    );
  });
});

test("fails closed on coordinator, staging and hash drift", async (t) => {
  await t.test("coordinator verdict drift", () => {
    const input = request();
    input.primary.coordinator_result.verdict = "HOLD";
    input.primary.coordinator_result.blockers = ["render_hold"];

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) =>
        error?.code === "pre_t90_coordinator_result_not_green",
    );
  });

  await t.test("staging schedule drift", () => {
    const input = request();
    input.primary.coordinator_result.staging.scheduled_for =
      "2026-07-30T19:00:00.000Z";

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) => error?.code === "pre_t90_schedule_mismatch",
    );
  });

  await t.test("final media hash drift", () => {
    const input = request();
    input.primary.coordinator_result.green_supplement.hashes.final_mp4_sha256 =
      hash("substitute-final-mp4");

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) => error?.code === "pre_t90_media_binding_mismatch",
    );
  });
});

test("fails closed on exact story, channel, lane and guarded-window drift", async (t) => {
  const cases = [
    {
      name: "story",
      mutate(input) {
        input.primary.coordinator_result.green_supplement.story_id =
          "substitute-story";
      },
      code: "pre_t90_green_story_mismatch",
    },
    {
      name: "channel",
      mutate(input) {
        input.primary.coordinator_result.green_supplement.channel_id =
          "other-channel";
      },
      code: "pre_t90_channel_mismatch",
    },
    {
      name: "lane",
      mutate(input) {
        input.primary.coordinator_result.staging.lane_id =
          "evergreen_short";
      },
      code: "pre_t90_lane_mismatch",
    },
  ];
  for (const binding of cases) {
    await t.test(binding.name, () => {
      const input = request();
      binding.mutate(input);

      assert.throws(
        () => composeGovernedAutonomousPreT90Candidates(input),
        (error) => error?.code === binding.code,
      );
    });
  }

  await t.test("guarded window", () => {
    const input = request();
    input.scheduled_for = "2026-07-30T10:00:00.000Z";
    input.now = "2026-07-30T08:28:00.000Z";

    assert.throws(
      () => composeGovernedAutonomousPreT90Candidates(input),
      (error) => error?.code === "pre_t90_guarded_window_required",
    );
  });
});

test("rejects authority fields at every coordinator boundary", async (t) => {
  for (const boundary of [
    {
      name: "coordinator",
      mutate(input) {
        input.primary.coordinator_result.safety.publish_authority =
          true;
      },
      code: "pre_t90_coordinator_publish_authority_forbidden",
    },
    {
      name: "staging",
      mutate(input) {
        input.primary.coordinator_result.staging.safety.database_mutated =
          true;
      },
      code: "pre_t90_staging_database_mutated_forbidden",
    },
    {
      name: "green supplement",
      mutate(input) {
        input.primary.coordinator_result.green_supplement.safety.scheduler_authority =
          true;
      },
      code: "pre_t90_green_scheduler_authority_forbidden",
    },
  ]) {
    await t.test(boundary.name, () => {
      const input = request();
      boundary.mutate(input);

      assert.throws(
        () => composeGovernedAutonomousPreT90Candidates(input),
        (error) => error?.code === boundary.code,
      );
    });
  }
});
