"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createAutonomousOfficialPublicationAuthority,
} = require("../../lib/services/autonomous-official-publication-authority");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");

const NOW = "2026-07-29T10:00:00.000Z";
const STORY_ID = "official_story_1";
const SCHEDULED_FOR = "2026-07-29T19:00:00.000Z";

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "authority_sha256")
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256Bytes(JSON.stringify(stableValue(value)));
}

function rightsLedger() {
  return {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion",
        source_url: `pulse-owned://${STORY_ID}/motion`,
        asset_sha256: "a".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "output/rights/owned-motion.json",
          sha256: "b".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
}

function gateInput() {
  const ledger = rightsLedger();
  return {
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Pulse authored the reporting, sequencing, narration and motion treatment.",
      evidence_ref: "output/qa/transformation.json",
      evidence_sha256: "c".repeat(64),
    },
    rights_ledger: ledger,
    rights_ledger_sha256: hashRightsLedger(ledger),
    synthetic_media_disclosure: {
      decision_authority: "SYSTEM_POLICY",
      altered_content: true,
      policy_basis: "DISCLOSE",
      youtube_field_value: true,
      decision_provenance: {
        policy_id: "pulse-youtube-synthetic-disclosure",
        policy_version: "1",
        evaluated_at: "2026-07-29T09:50:00.000Z",
        evidence_sha256: "ca".repeat(32),
      },
    },
  };
}

function officialSourceBinding(sourceEvidenceSha256) {
  const claim = "The official update is free to keep.";
  const claimSha256 = sha256Bytes(claim);
  const sourceUrl = "https://news.xbox.com/example";
  return buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256,
    sourceEvidence: {
      schema_version: "pulse-source-evidence-v1",
      story_id: STORY_ID,
      source_url: sourceUrl,
      source_type: "official",
      claims: [
        {
          claim_key: "official.free",
          text: claim,
          claim_text_sha256: claimSha256,
        },
      ],
      official_source_snapshot: {
        schema_version: "pulse-official-source-snapshot-v1",
        source_url: sourceUrl,
        source_id: "xbox-wire",
        source_class: "OFFICIAL_FIRST_PARTY",
        canonical_body_algorithm: "pulse-readable-body-v1",
        canonical_body_sha256: claimSha256,
        claims: [
          {
            claim_key: "official.free",
            text: claim,
            claim_text_sha256: claimSha256,
          },
        ],
      },
    },
  });
}

function fixtureValues() {
  const lineage = {
    story_intake_sha256: "1".repeat(64),
    source_evidence_sha256: "2".repeat(64),
    script_sha256: "3".repeat(64),
    owned_motion_manifest_sha256: "4".repeat(64),
    owned_motion_source_manifest_sha256: "5".repeat(64),
    owned_programme_sha256: "6".repeat(64),
    narration_audio_sha256: "7".repeat(64),
    narration_manifest_sha256: "8".repeat(64),
    narration_licence_evidence_sha256: "9".repeat(64),
    final_composite_manifest_sha256: "a".repeat(64),
    renderer_manifest_file_sha256: "b".repeat(64),
    renderer_manifest_canonical_sha256: "c".repeat(64),
    deterministic_qa_sha256: "d".repeat(64),
    multimodal_visual_qa_sha256: "e".repeat(64),
    final_mp4_sha256: "f".repeat(64),
    publication_metadata_sha256: "0".repeat(64),
    kill_switch_proof_sha256: "1a".repeat(32),
    single_owner_proof_sha256: "2b".repeat(32),
  };
  const gates = gateInput();
  const synthetic = {
    schema_version: "pulse-system-policy-synthetic-media-disclosure-v1",
    decision_authority: "SYSTEM_POLICY",
    altered_content: true,
    policy_basis: "DISCLOSE",
    youtube_field_value: true,
    decision_provenance: {
      policy_id: "pulse-youtube-synthetic-disclosure",
      policy_version: "1",
      evaluated_at: "2026-07-29T09:50:00.000Z",
      evidence_sha256: "ca".repeat(32),
    },
  };
  const publicationEvidence = {
    schema_version: "pulse-publication-evidence-v1",
    source_evidence_sha256: lineage.source_evidence_sha256,
    official_source_release_binding: officialSourceBinding(
      lineage.source_evidence_sha256,
    ),
    qa_report_sha256: lineage.deterministic_qa_sha256,
    publication_metadata_sha256: lineage.publication_metadata_sha256,
    publication_metadata: {
      path: "output/publication/youtube-shorts-metadata.json",
      sha256: lineage.publication_metadata_sha256,
      platform: "youtube_shorts",
      title: "The official update is free to keep",
      description: "Verified official gaming news.",
    },
    originality_transformation: {
      ...gates.originality_transformation,
    },
    rights_ledger_sha256: gates.rights_ledger_sha256,
    synthetic_media_disclosure: synthetic,
    renderer_manifest_sha256: lineage.renderer_manifest_canonical_sha256,
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "21.0.0",
    },
  };
  return { lineage, gates, publicationEvidence };
}

function autonomousReport(lineage) {
  const reportPayload = {
    schema_version: "pulse-autonomous-official-source-evidence-apply-report-v1",
    materialiser_id: "pulse-autonomous-official-source-evidence-apply-v1",
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-29T09:59:30.000Z",
    valid_until: "2026-07-29T10:01:30.000Z",
    request_sha256: "4d".repeat(32),
    story_id: STORY_ID,
    verdict: "GREEN",
    blockers: [],
    authority: {
      method: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      scope: "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY",
      human_approval: false,
      may_impersonate_human: false,
    },
    visual_policy: "OWNED_ONLY",
    audio_policy: "LICENSED_NARRATION_ONLY",
    source_revalidation: {
      policy: "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS",
      snapshot_count: 1,
      primary_count: 1,
      supporting_count: 0,
      sources: [
        {
          role: "PRIMARY",
          source_id: "xbox-wire",
          source_url: "https://news.xbox.com/example",
          snapshot_sha256: "5e".repeat(32),
          canonical_body_sha256: "6f".repeat(32),
          matched_claim_text_sha256: ["7a".repeat(32)],
          bytes_sha256: "8b".repeat(32),
          fetch_status: 200,
          revalidated_at: "2026-07-29T09:59:30.000Z",
          unchanged: true,
          claims_match: true,
        },
      ],
    },
    lineage,
    controls: {
      kill_switch: "FRESH_HEALTHY",
      scheduler_and_publisher_ownership: "SINGLE_OWNER",
      kill_switch_proof: {
        declared_path: "output/proof/kill-switch.json",
        resolved_path: "C:\\proof\\kill-switch.json",
        real_path: "C:\\proof\\kill-switch.json",
        observed_sha256: lineage.kill_switch_proof_sha256,
        size_bytes: 300,
      },
      single_owner_proof: {
        declared_path: "output/proof/single-owner.json",
        resolved_path: "C:\\proof\\single-owner.json",
        real_path: "C:\\proof\\single-owner.json",
        observed_sha256: lineage.single_owner_proof_sha256,
        size_bytes: 400,
      },
    },
    qa: {
      deterministic: "PASS",
      multimodal: "UNANIMOUS_PASS",
      deterministic_report: {
        declared_path: "output/qa/final-render-qa.json",
        resolved_path: "C:\\proof\\final-render-qa.json",
        real_path: "C:\\proof\\final-render-qa.json",
        observed_sha256: lineage.deterministic_qa_sha256,
        size_bytes: 4000,
      },
      multimodal_report: {
        declared_path: "output/qa/visual-review.json",
        resolved_path: "C:\\proof\\visual-review.json",
        real_path: "C:\\proof\\visual-review.json",
        observed_sha256: lineage.multimodal_visual_qa_sha256,
        size_bytes: 5000,
      },
    },
    input_files: {},
    owned_visual_files: [],
    operational_publish_authority: false,
    dispatch_authorised: false,
    dispatch_revalidation_required: true,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    local_files_written: 1,
    network_scope: "OFFICIAL_PRIMARY_AND_SUPPORTING_SOURCE_READS_ONLY",
  };
  return {
    ...reportPayload,
    report_sha256: canonicalSha256(reportPayload),
  };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-authority-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { lineage, gates, publicationEvidence } = fixtureValues();
  const report = autonomousReport(lineage);
  const reportPath = path.join(directory, "autonomous-report.json");
  const reportBytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(reportPath, reportBytes);
  return {
    report,
    reportPath,
    request: {
      source_report: {
        path: reportPath,
        file_sha256: sha256Bytes(reportBytes),
      },
      binding: {
        story_id: STORY_ID,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        runway_lock_sha256: "9c".repeat(32),
        dispatch_idempotency_key: `youtube:${STORY_ID}:${SCHEDULED_FOR}`,
        request_fingerprint: "ad".repeat(32),
      },
      publication_evidence: publicationEvidence,
      publication_evidence_gate_input: gates,
      admission_controls: {
        kill_switch_proof_sha256: lineage.kill_switch_proof_sha256,
        kill_switch_checked_at: "2026-07-29T09:59:40.000Z",
        single_owner_proof_sha256: lineage.single_owner_proof_sha256,
        single_owner_checked_at: "2026-07-29T09:59:45.000Z",
      },
    },
  };
}

async function replaceReport(request, report, { rehash = true } = {}) {
  const copy = structuredClone(report);
  if (rehash) {
    delete copy.report_sha256;
    copy.report_sha256 = canonicalSha256(copy);
  }
  const bytes = Buffer.from(`${JSON.stringify(copy, null, 2)}\n`, "utf8");
  await fs.writeFile(request.source_report.path, bytes);
  request.source_report.file_sha256 = sha256Bytes(bytes);
  return copy;
}

test("creates a closed immutable, single-use admission authority without dispatch or publish permission", async (t) => {
  const { request, report } = await fixture(t);
  const authority = await createAutonomousOfficialPublicationAuthority(
    request,
    { clock: () => new Date(NOW) },
  );

  assert.deepEqual(Object.keys(authority).sort(), [
    "admission_controls",
    "authority_id",
    "authority_scope",
    "authority_sha256",
    "authority_type",
    "channel_id",
    "decision",
    "dispatch_authorised",
    "dispatch_idempotency_key",
    "external_publish_authorised",
    "human_approval",
    "issued_at",
    "lane_id",
    "lineage",
    "may_impersonate_human",
    "operational_publish_authority",
    "platform",
    "publication_evidence",
    "request_fingerprint",
    "required_release_boundary",
    "runway_lock_sha256",
    "scheduled_for",
    "single_use",
    "source_report",
    "story_id",
    "valid_until",
    "verifier_id",
  ]);
  assert.equal(authority.decision, "APPROVED");
  assert.equal(authority.authority_type, "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE");
  assert.equal(authority.authority_scope, "PUBLICATION_ADMISSION_ONLY");
  assert.equal(authority.human_approval, false);
  assert.equal(authority.may_impersonate_human, false);
  assert.equal(authority.operational_publish_authority, false);
  assert.equal(authority.dispatch_authorised, false);
  assert.equal(authority.external_publish_authorised, false);
  assert.equal(authority.single_use, true);
  assert.equal(authority.issued_at, NOW);
  assert.equal(authority.valid_until, "2026-07-29T10:00:40.000Z");
  assert.equal(authority.source_report.report_sha256, report.report_sha256);
  assert.deepEqual(authority.required_release_boundary, {
    boundary: "T_MINUS_15",
    official_source_revalidation_required: true,
    kill_switch_revalidation_required: true,
    single_owner_revalidation_required: true,
    exact_binding_revalidation_required: true,
    max_control_age_ms: 60000,
    disarm_on_failure: true,
  });
  assert.equal(authority.lineage.media_sha256, report.lineage.final_mp4_sha256);
  assert.equal(
    authority.lineage.rights_ledger_sha256,
    request.publication_evidence.rights_ledger_sha256,
  );
  assert.equal(authority.authority_sha256, canonicalSha256(authority));
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.publication_evidence));
  assert.ok(Object.isFrozen(authority.required_release_boundary));
});

test("rejects legacy and explicit HUMAN_REVIEW disclosure provenance for autonomous authority", async (t) => {
  const { request } = await fixture(t);
  const legacyDisclosure = {
    contains_synthetic_media: true,
    synthetic_disclosure_required: true,
    decision: "DISCLOSE",
    operator_decision: "DISCLOSE",
    rationale: "The edit contains synthetic narration.",
    reason: "The edit contains synthetic narration.",
    disclosure_text: "Includes synthetic narration.",
    policy_basis: null,
    youtube_field_value: true,
    reviewed_at: "2026-07-29T09:50:00.000Z",
  };
  request.publication_evidence.synthetic_media_disclosure = legacyDisclosure;
  request.publication_evidence_gate_input.synthetic_media_disclosure = {
    contains_synthetic_media: true,
    decision: "DISCLOSE",
    rationale: "The edit contains synthetic narration.",
    disclosure_text: "Includes synthetic narration.",
    policy_basis: null,
    youtube_field_value: true,
    reviewed_at: "2026-07-29T09:50:00.000Z",
  };

  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_system_policy_disclosure_required",
    },
  );

  const explicitHumanReview = await fixture(t);
  explicitHumanReview.request.publication_evidence.synthetic_media_disclosure.decision_authority =
    "HUMAN_REVIEW";
  explicitHumanReview.request.publication_evidence_gate_input.synthetic_media_disclosure.decision_authority =
    "HUMAN_REVIEW";
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(explicitHumanReview.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_system_policy_disclosure_required",
    },
  );
});

test("rejects unknown request, nested binding and report fields instead of silently widening authority", async (t) => {
  const topLevel = await fixture(t);
  topLevel.request.issued_at = NOW;
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(topLevel.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_request_fields_invalid",
    },
  );

  const nested = await fixture(t);
  nested.request.binding.publish_authority = true;
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(nested.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_binding_fields_invalid",
    },
  );

  const reportFixture = await fixture(t);
  const changedReport = structuredClone(reportFixture.report);
  changedReport.unreviewed_extension = {
    dispatch_authorised: true,
  };
  await replaceReport(reportFixture.request, changedReport);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(reportFixture.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_fields_invalid",
    },
  );
});

test("binds both the exact raw report bytes and the report's independent canonical self-hash", async (t) => {
  const rawMismatch = await fixture(t);
  rawMismatch.request.source_report.file_sha256 = "ff".repeat(32);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(rawMismatch.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_file_hash_mismatch",
    },
  );

  const selfMismatch = await fixture(t);
  const changedReport = structuredClone(selfMismatch.report);
  changedReport.story_id = "forged-story";
  await replaceReport(selfMismatch.request, changedReport, { rehash: false });
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(selfMismatch.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_self_hash_mismatch",
    },
  );
});

test("rejects unnormalised or schema-extended publication evidence", async (t) => {
  const extended = await fixture(t);
  extended.request.publication_evidence.publish_authority = true;
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(extended.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_publication_evidence_fields_invalid",
    },
  );

  const unnormalised = await fixture(t);
  unnormalised.request.publication_evidence.synthetic_media_disclosure.policy_basis =
    "NO_DISCLOSURE_REQUIRED";
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(unnormalised.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_publication_evidence_not_normalized",
    },
  );
});

test("rejects nested report authority extensions and any attempt to inherit elevated permissions", async (t) => {
  const extended = await fixture(t);
  const extendedReport = structuredClone(extended.report);
  extendedReport.authority.dispatch_authorised = true;
  await replaceReport(extended.request, extendedReport);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(extended.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_authority_fields_invalid",
    },
  );

  const elevated = await fixture(t);
  const elevatedReport = structuredClone(elevated.report);
  elevatedReport.operational_publish_authority = true;
  await replaceReport(elevated.request, elevatedReport);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(elevated.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_scope_invalid",
    },
  );
});

test("uses only the injected trusted clock and rejects stale report, source and control evidence", async (t) => {
  const missingClock = await fixture(t);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(missingClock.request),
    {
      code: "autonomous_publication_authority_trusted_clock_required",
    },
  );

  const staleReport = await fixture(t);
  const staleReportValue = structuredClone(staleReport.report);
  staleReportValue.generated_at = "2026-07-29T09:57:59.999Z";
  await replaceReport(staleReport.request, staleReportValue);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(staleReport.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_report_stale",
    },
  );

  const staleSource = await fixture(t);
  const staleSourceReport = structuredClone(staleSource.report);
  staleSourceReport.source_revalidation.sources[0].revalidated_at =
    "2026-07-29T09:57:59.999Z";
  await replaceReport(staleSource.request, staleSourceReport);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(staleSource.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_source_revalidation_stale",
    },
  );

  const staleControl = await fixture(t);
  staleControl.request.admission_controls.kill_switch_checked_at =
    "2026-07-29T09:59:00.000Z";
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(staleControl.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_controls_stale",
    },
  );
});

test("requires the exact official breaking-Short YouTube schedule, runway, dispatch and request binding", async (t) => {
  for (const { mutate, code } of [
    {
      mutate(request) {
        request.binding.story_id = "another-story";
      },
      code: "autonomous_publication_authority_story_mismatch",
    },
    {
      mutate(request) {
        request.binding.channel_id = "stacked";
      },
      code: "autonomous_publication_authority_binding_scope_invalid",
    },
    {
      mutate(request) {
        request.binding.lane_id = "evergreen_short";
      },
      code: "autonomous_publication_authority_binding_scope_invalid",
    },
    {
      mutate(request) {
        request.binding.platform = "instagram";
      },
      code: "autonomous_publication_authority_binding_scope_invalid",
    },
    {
      mutate(request) {
        request.binding.scheduled_for = "2026-07-29T18:00:00.000Z";
      },
      code: "autonomous_publication_authority_schedule_not_guarded",
    },
    {
      mutate(request) {
        request.binding.runway_lock_sha256 = "not-a-hash";
      },
      code: "autonomous_publication_authority_runway_hash_invalid",
    },
    {
      mutate(request) {
        request.binding.request_fingerprint = "not-a-hash";
      },
      code: "autonomous_publication_authority_request_fingerprint_invalid",
    },
    {
      mutate(request) {
        request.binding.dispatch_idempotency_key = "youtube:wrong:window";
      },
      code: "autonomous_publication_authority_dispatch_identity_mismatch",
    },
  ]) {
    const current = await fixture(t);
    mutate(current.request);
    await assert.rejects(
      createAutonomousOfficialPublicationAuthority(current.request, {
        clock: () => new Date(NOW),
      }),
      { code },
    );
  }
});

test("runs the existing publication gates and rejects rights or lineage drift", async (t) => {
  const unsafeRights = await fixture(t);
  unsafeRights.request.publication_evidence_gate_input.rights_ledger.items[0].rights_basis =
    "ATTRIBUTION";
  unsafeRights.request.publication_evidence_gate_input.rights_ledger_sha256 =
    hashRightsLedger(
      unsafeRights.request.publication_evidence_gate_input.rights_ledger,
    );
  unsafeRights.request.publication_evidence.rights_ledger_sha256 =
    unsafeRights.request.publication_evidence_gate_input.rights_ledger_sha256;
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(unsafeRights.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_publication_evidence_not_green",
    },
  );

  const sourceDrift = await fixture(t);
  sourceDrift.request.publication_evidence.source_evidence_sha256 = "ef".repeat(
    32,
  );
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(sourceDrift.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_source_hash_mismatch",
    },
  );

  const controlDrift = await fixture(t);
  controlDrift.request.admission_controls.single_owner_proof_sha256 =
    "ef".repeat(32);
  await assert.rejects(
    createAutonomousOfficialPublicationAuthority(controlDrift.request, {
      clock: () => new Date(NOW),
    }),
    {
      code: "autonomous_publication_authority_control_hash_mismatch",
    },
  );
});

test("canonical authority identity and SHA bind every admission input while leaving caller objects untouched", async (t) => {
  const current = await fixture(t);
  const original = structuredClone(current.request);
  const first = await createAutonomousOfficialPublicationAuthority(
    current.request,
    { clock: () => new Date(NOW) },
  );
  assert.deepEqual(current.request, original);

  current.request.binding.runway_lock_sha256 = "bc".repeat(32);
  const second = await createAutonomousOfficialPublicationAuthority(
    current.request,
    { clock: () => new Date(NOW) },
  );

  assert.notEqual(first.authority_id, second.authority_id);
  assert.notEqual(first.authority_sha256, second.authority_sha256);
  assert.equal(second.authority_sha256, canonicalSha256(second));
});
