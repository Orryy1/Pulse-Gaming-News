"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  GovernedLaneReviewPacketError,
  PACKET_SCHEMA,
  materializeGovernedLaneReviewPacket,
} = require("../../lib/services/governed-lane-review-packet");

const GENERATED_AT = "2026-07-28T12:00:00.000Z";
const LANE_ID = "evergreen_short";
const STORY_ID = "story-evergreen-001";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeJson(root, name, value) {
  const filePath = path.join(root, name);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
    story_id: value.story_id || STORY_ID,
    lane_id: value.lane_id || value.format?.lane_id || LANE_ID,
  };
}

function createReadyInputs(
  root,
  { laneId = LANE_ID, storyId = STORY_ID } = {},
) {
  const finalMediaPath = path.join(root, "final.mp4");
  const finalMediaBytes = Buffer.from("governed-final-media", "utf8");
  fs.writeFileSync(finalMediaPath, finalMediaBytes);
  const finalMedia = {
    path: finalMediaPath,
    sha256: sha256(finalMediaBytes),
    story_id: storyId,
    lane_id: laneId,
  };

  const workOrder = writeJson(root, "production-work-order.json", {
    schema_version: "pulse-test-production-work-order-v1",
    story_id: storyId,
    lane_id: laneId,
    status: "READY_FOR_LOCAL_PRODUCTION",
    blockers: [],
  });
  const sourceEvidence = writeJson(root, "source-evidence.json", {
    schema_version: "pulse-test-source-evidence-v1",
    story_id: storyId,
    lane_id: laneId,
    verification_status: "CONFIRMED",
  });
  const rightsLedgerValue = {
    schema_version: "pulse-test-rights-ledger-v1",
    story_id: storyId,
    lane_id: laneId,
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "final-media",
        source_url: "https://example.com/licensed/final-media",
        asset_sha256: finalMedia.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "LICENSED",
        rights_evidence: {
          reference: "licence-record",
          sha256: sourceEvidence.sha256,
        },
        attribution_decision: "NOT_REQUIRED",
      },
    ],
  };
  const rightsLedger = {
    ...writeJson(root, "rights-ledger.json", rightsLedgerValue),
    canonical_sha256: hashRightsLedger(rightsLedgerValue),
  };
  const originality = writeJson(root, "originality.json", {
    schema_version: "pulse-test-originality-v1",
    story_id: storyId,
    lane_id: laneId,
    verdict: "STRONG",
    rationale:
      "Original reporting, narration, designed motion and editorial analysis materially transform the evidence.",
    evidence_ref: sourceEvidence.path,
    evidence_sha256: sourceEvidence.sha256,
  });
  const syntheticDisclosure = writeJson(
    root,
    "synthetic-disclosure-proposal.json",
    {
      schema_version: "pulse-synthetic-disclosure-proposal-v1",
      story_id: storyId,
      lane_id: laneId,
      proposal: {
        contains_synthetic_media: true,
        decision: "DISCLOSE",
        rationale:
          "The edit contains synthetic narration and designed visual elements.",
        disclosure_text:
          "Includes AI-generated narration and synthetic visual elements.",
        youtube_field_value: true,
        proposed_at: GENERATED_AT,
      },
    },
  );
  const rendererManifest = writeJson(root, "renderer-manifest.json", {
    schema_version: "pulse-test-renderer-manifest-v1",
    story_id: storyId,
    lane_id: laneId,
    verdict: "PASS",
    bindings: {
      production_work_order_sha256: workOrder.sha256,
    },
    output: {
      path: finalMedia.path,
      sha256: finalMedia.sha256,
    },
  });
  const qa = writeJson(root, "qa.json", {
    schema_version: "pulse-test-final-qa-v1",
    story_id: storyId,
    lane_id: laneId,
    verdict: "GREEN",
    blockers: [],
    media_sha256: finalMedia.sha256,
    renderer_manifest_sha256: rendererManifest.sha256,
  });

  return {
    lane_id: laneId,
    story_id: storyId,
    production_work_order_ref: workOrder,
    final_media_ref: finalMedia,
    renderer_manifest_ref: rendererManifest,
    qa_ref: qa,
    source_evidence_ref: sourceEvidence,
    rights_ledger_ref: rightsLedger,
    originality_transformation_ref: originality,
    synthetic_disclosure_proposal_ref: syntheticDisclosure,
    generated_at: GENERATED_AT,
    output_dir: path.join(root, "review"),
  };
}

test("materialises an exact hash-bound packet that is ready only for human review", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-ready-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await materializeGovernedLaneReviewPacket(
    createReadyInputs(root),
  );

  assert.equal(result.packet.schema_version, PACKET_SCHEMA);
  assert.equal(result.packet.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(result.packet.blockers, []);
  assert.match(result.packet.immutable_fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.packet.human_review.status, "PENDING");
  assert.equal(result.packet.human_review.decision, null);
  assert.equal(result.packet.human_review.approval_inferred, false);
  assert.equal(result.packet.authority.approval_created, false);
  assert.equal(result.packet.authority.admission_created, false);
  assert.equal(result.packet.authority.publish_created, false);
  assert.equal(result.packet.authority.external_publish_authorised, false);
  assert.equal(result.packet.safety.network_used, false);
  assert.equal(result.packet.safety.database_mutated, false);
  assert.equal(result.packet.safety.oauth_mutated, false);
  assert.equal(
    Object.hasOwn(
      result.packet.assessments.synthetic_disclosure_proposal.proposal,
      "reviewed_at",
    ),
    false,
  );
  assert.equal(
    result.packet.assessments.synthetic_disclosure_proposal.proposal
      .proposed_decision,
    "DISCLOSE",
  );
  assert.equal(
    result.packet.assessments.synthetic_disclosure_proposal.proposal
      .proposed_at,
    GENERATED_AT,
  );
  assert.ok(fs.existsSync(result.paths.json));
  assert.ok(fs.existsSync(result.paths.markdown));
  assert.equal(
    sha256(fs.readFileSync(result.paths.json)),
    result.sha256.json,
  );
  assert.equal(
    sha256(fs.readFileSync(result.paths.markdown)),
    result.sha256.markdown,
  );
  assert.deepEqual(
    fs
      .readdirSync(path.dirname(result.paths.json))
      .filter((name) => name.includes(".tmp")),
    [],
  );
});

test("uses the same fail-closed packet contract for all three production lanes", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-all-lanes-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [index, laneId] of [
    "breaking_short",
    "evergreen_short",
    "weekly_longform",
  ].entries()) {
    const laneRoot = path.join(root, `lane-${index}`);
    fs.mkdirSync(laneRoot);
    const storyId = `story-${laneId}-001`;
    const result = await materializeGovernedLaneReviewPacket(
      createReadyInputs(laneRoot, { laneId, storyId }),
    );
    assert.equal(result.packet.lane_id, laneId);
    assert.equal(result.packet.story_id, storyId);
    assert.equal(result.packet.verdict, "READY_FOR_HUMAN_REVIEW");
    assert.equal(result.packet.human_review.decision, null);
  }
});

test("re-hashes every input and holds a packet when a production artefact changed", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-tampered-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  fs.appendFileSync(
    input.production_work_order_ref.path,
    Buffer.from("\n", "utf8"),
  );

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(
    result.packet.blockers.includes(
      "production_work_order_sha256_mismatch",
    ),
  );
  assert.ok(
    result.packet.blockers.includes(
      "renderer_production_work_order_sha256_mismatch",
    ),
  );
  assert.notEqual(
    result.packet.artifacts.production_work_order.sha256,
    input.production_work_order_ref.sha256,
  );
  assert.equal(result.packet.human_review.decision, null);
  assert.equal(result.packet.authority.approval_created, false);
});

test("requires QA GREEN or PASS against the exact rendered media and manifest", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-qa-hold-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  input.qa_ref = writeJson(root, "qa-failed.json", {
    schema_version: "pulse-test-final-qa-v1",
    story_id: STORY_ID,
    lane_id: LANE_ID,
    verdict: "FAIL",
    blockers: ["black_frames_detected"],
    media_sha256: "a".repeat(64),
    renderer_manifest_sha256: "b".repeat(64),
  });

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(result.packet.blockers.includes("qa_green_or_pass_required"));
  assert.ok(result.packet.blockers.includes("qa_blockers_present"));
  assert.ok(
    result.packet.blockers.includes("qa_final_media_sha256_mismatch"),
  );
  assert.ok(
    result.packet.blockers.includes(
      "qa_renderer_manifest_sha256_mismatch",
    ),
  );
  assert.equal(result.packet.exact_bindings.all_match, false);
});

test("uses publication evidence gates and never treats attribution as rights clearance", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-rights-hold-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const attributionOnlyLedger = {
    schema_version: "pulse-test-rights-ledger-v1",
    story_id: STORY_ID,
    lane_id: LANE_ID,
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "uncleared-media",
        source_url: "https://example.com/third-party/reupload",
        asset_sha256: input.final_media_ref.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "ATTRIBUTION_ONLY",
        rights_evidence: {
          reference: "screen-credit",
          sha256: input.source_evidence_ref.sha256,
        },
        attribution_decision: "REQUIRED_AND_SUPPLIED",
        attribution_text: "Credit: example.com",
      },
    ],
  };
  input.rights_ledger_ref = {
    ...writeJson(root, "rights-ledger-attribution-only.json", attributionOnlyLedger),
    canonical_sha256: hashRightsLedger(attributionOnlyLedger),
  };

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(
    result.packet.blockers.includes("rights:attribution_is_not_permission"),
  );
  assert.ok(
    result.packet.blockers.includes(
      "rights:rights_ledger_item_basis_required",
    ),
  );
  assert.equal(result.packet.assessments.rights.cleared, false);
  assert.equal(result.packet.authority.publish_created, false);
});

test("refuses secret-shaped evidence paths without leaking them into the packet", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-secret-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const secretRoot = path.join(root, "tokens");
  fs.mkdirSync(secretRoot);
  const secretPath = path.join(secretRoot, "source-evidence.json");
  fs.copyFileSync(input.source_evidence_ref.path, secretPath);
  input.source_evidence_ref = {
    ...input.source_evidence_ref,
    path: secretPath,
  };

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(
    result.packet.blockers.includes(
      "source_evidence_secret_path_forbidden",
    ),
  );
  assert.equal(result.packet.artifacts.source_evidence.path, null);
  assert.equal(JSON.stringify(result.packet).includes(secretPath), false);
});

test("holds non-regular or symlinked artefacts instead of following them", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-symlink-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const regularQaRef = input.qa_ref;
  input.qa_ref = {
    ...regularQaRef,
    path: root,
  };
  const nonRegular = await materializeGovernedLaneReviewPacket(input);
  assert.equal(nonRegular.packet.verdict, "HOLD");
  assert.ok(
    nonRegular.packet.blockers.includes("qa_regular_file_required"),
  );
  assert.equal(nonRegular.packet.artifacts.qa.sha256, null);

  const symlinkPath = path.join(root, "qa-link.json");
  try {
    fs.symlinkSync(regularQaRef.path, symlinkPath, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      return;
    }
    throw error;
  }
  input.qa_ref = {
    ...regularQaRef,
    path: symlinkPath,
  };
  input.output_dir = path.join(root, "review-symlink");

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(result.packet.blockers.includes("qa_symlink_forbidden"));
  assert.equal(result.packet.artifacts.qa.sha256, null);
  assert.equal(result.packet.human_review.status, "BLOCKED_BY_MACHINE_EVIDENCE");
});

test("holds any cross-story or cross-lane artefact identity", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-identity-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  input.source_evidence_ref = writeJson(root, "wrong-source.json", {
    schema_version: "pulse-test-source-evidence-v1",
    story_id: "different-story",
    lane_id: "breaking_short",
    verification_status: "CONFIRMED",
  });

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(
    result.packet.blockers.includes(
      "source_evidence_embedded_story_id_mismatch",
    ),
  );
  assert.ok(
    result.packet.blockers.includes(
      "source_evidence_embedded_lane_id_mismatch",
    ),
  );
  assert.equal(result.packet.lane_id, LANE_ID);
  assert.equal(result.packet.story_id, STORY_ID);
});

test("fingerprint is deterministic and changes with any bound evidence bytes", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-fingerprint-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const first = await materializeGovernedLaneReviewPacket(input);
  const second = await materializeGovernedLaneReviewPacket({
    ...input,
    output_dir: path.join(root, "review-second"),
  });
  assert.equal(
    first.packet.immutable_fingerprint_sha256,
    second.packet.immutable_fingerprint_sha256,
  );

  fs.appendFileSync(input.source_evidence_ref.path, " ");
  input.source_evidence_ref.sha256 = sha256(
    fs.readFileSync(input.source_evidence_ref.path),
  );
  const changed = await materializeGovernedLaneReviewPacket({
    ...input,
    output_dir: path.join(root, "review-changed"),
  });

  assert.notEqual(
    first.packet.immutable_fingerprint_sha256,
    changed.packet.immutable_fingerprint_sha256,
  );
});

test("refuses a secret-shaped output directory before writing any packet", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-output-secret-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  input.output_dir = path.join(root, "tokens", "review");

  await assert.rejects(
    materializeGovernedLaneReviewPacket(input),
    (error) =>
      error instanceof GovernedLaneReviewPacketError &&
      error.code ===
        "governed_lane_review_packet_secret_output_dir_forbidden",
  );
  assert.equal(fs.existsSync(input.output_dir), false);
});

test("accepts a declared in-file work-order fingerprint while still re-hashing its file", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-work-order-fingerprint-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const canonicalWorkOrderSha256 = "c".repeat(64);
  input.production_work_order_ref = {
    ...writeJson(root, "canonical-production-work-order.json", {
      schema_version: "pulse-test-production-work-order-v1",
      story_id: STORY_ID,
      lane_id: LANE_ID,
      status: "READY_FOR_LOCAL_PRODUCTION",
      blockers: [],
      work_order_sha256: canonicalWorkOrderSha256,
    }),
    canonical_sha256: canonicalWorkOrderSha256,
  };
  input.renderer_manifest_ref = writeJson(
    root,
    "canonical-renderer-manifest.json",
    {
      schema_version: "pulse-test-renderer-manifest-v1",
      story_id: STORY_ID,
      lane_id: LANE_ID,
      verdict: "PASS",
      bindings: {
        production_work_order_sha256: canonicalWorkOrderSha256,
      },
      output: {
        path: input.final_media_ref.path,
        sha256: input.final_media_ref.sha256,
      },
    },
  );
  input.qa_ref = writeJson(root, "canonical-qa.json", {
    schema_version: "pulse-test-final-qa-v1",
    story_id: STORY_ID,
    lane_id: LANE_ID,
    verdict: "PASS",
    blockers: [],
    media_sha256: input.final_media_ref.sha256,
    renderer_manifest_sha256: input.renderer_manifest_ref.sha256,
  });

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.equal(
    result.packet.exact_bindings.production_work_order_file_sha256,
    input.production_work_order_ref.sha256,
  );
  assert.equal(
    result.packet.exact_bindings.production_work_order_canonical_sha256,
    canonicalWorkOrderSha256,
  );
});

test("binds an existing transformation evidence file as its own reviewed evidence reference", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-transformation-ref-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  input.originality_transformation_ref = writeJson(
    root,
    "existing-transformation-evidence.json",
    {
      schema_version: "pulse-originality-transformation-v1",
      story_id: STORY_ID,
      lane_id: LANE_ID,
      verdict: "ADEQUATE",
      rationale:
        "The evidence demonstrates original editorial structure, analysis, narration and designed motion.",
      bindings: {
        source_evidence_sha256: input.source_evidence_ref.sha256,
        final_media_sha256: input.final_media_ref.sha256,
      },
    },
  );

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.equal(
    result.packet.assessments.originality_transformation.decision
      .evidence_sha256,
    input.originality_transformation_ref.sha256,
  );
  assert.equal(
    result.packet.assessments.originality_transformation.decision.evidence_ref,
    input.originality_transformation_ref.path,
  );
});

test("rejects a renderer canonical fingerprint that does not match the re-read manifest", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-review-renderer-canonical-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createReadyInputs(root);
  const falseCanonicalSha256 = "d".repeat(64);
  input.renderer_manifest_ref.canonical_sha256 = falseCanonicalSha256;
  input.qa_ref = writeJson(root, "qa-false-renderer-canonical.json", {
    schema_version: "pulse-test-final-qa-v1",
    story_id: STORY_ID,
    lane_id: LANE_ID,
    verdict: "GREEN",
    blockers: [],
    media_sha256: input.final_media_ref.sha256,
    renderer_manifest_sha256: falseCanonicalSha256,
  });

  const result = await materializeGovernedLaneReviewPacket(input);

  assert.equal(result.packet.verdict, "HOLD");
  assert.ok(
    result.packet.blockers.includes(
      "renderer_manifest_canonical_sha256_mismatch",
    ),
  );
  assert.equal(result.packet.exact_bindings.all_match, false);
});
