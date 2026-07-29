"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  captureBreakingSourceEvidence,
} = require("../../lib/services/breaking-source-evidence");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  buildEvergreenAutonomousDiscoveryInputs,
} = require("../../lib/services/evergreen-autonomous-input-adapter");
const {
  COMPLETION_FILENAME,
  COMPLETION_SCHEMA_VERSION,
  hashEvergreenMotionCoverageCompletion,
} = require("../../lib/services/evergreen-motion-coverage-completion");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("../../lib/services/evergreen-motion-repair-work-order");
const {
  discoverEvergreenVerdictPitches,
} = require("../../lib/services/evergreen-autonomous-discovery");

const NOW = "2026-07-28T12:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function workOrderSha256(value) {
  return hashEvergreenMotionRepairWorkOrder(value);
}

async function sourcePacket(storyId, archiveRoot) {
  const urls = [
    "https://news.xbox.com/en-us/halo-progression/",
    "https://www.ign.com/articles/halo-progression/",
  ];
  const claims = [
    "Halo multiplayer progression rewards every completed match.",
    "Halo multiplayer progression includes three daily challenges.",
    "Halo multiplayer progression carries unlocks between seasons.",
  ];
  const mediaUrl =
    "https://www.youtube.com/watch?v=fixtureHaloMotion01";
  const bodies = new Map(
    urls.map((url, index) => [
      url,
      Buffer.from(
        `<article>${claims.join(" ")}${
          index === 0 ? ` <a href="${mediaUrl}">Official trailer</a>` : ""
        }</article>`,
        "utf8",
      ),
    ]),
  );
  const archives = new Map();
  if (archiveRoot) {
    for (const [url, bytes] of bodies) {
      const archivePath = path.join(
        archiveRoot,
        `source-${sha256(Buffer.from(url, "utf8")).slice(0, 12)}.html`,
      );
      fs.writeFileSync(archivePath, bytes);
      archives.set(url, archivePath);
    }
  }
  return captureBreakingSourceEvidence({
    story: {
      id: storyId,
      title: "Halo multiplayer progression systems explained",
      subject_ids: ["xbox"],
      source_candidates: urls,
    },
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          owner: "Microsoft Gaming",
          hosts: ["news.xbox.com"],
          subject_ids: ["xbox"],
        },
      ],
      trusted_editorial: [
        {
          source_id: "ign",
          outlet: "IGN",
          hosts: ["ign.com"],
        },
      ],
    },
    fetchCapture: async ({ url }) => {
      const bytes = bodies.get(url);
      return {
        status: 200,
        final_url: url,
        content_type: "text/html",
        bytes,
        ...(archives.has(url)
          ? {
              archive_ref: `sha256:${sha256(bytes)}`,
              archive_path: archives.get(url),
            }
          : {}),
      };
    },
    extractClaims: async () => ({
      extractor: { id: "fixture-extractor", version: "1.0.0" },
      claims: claims.map((text, index) => ({
        claim_key: `halo.multiplayer.progression.${index + 1}`,
        text,
        location: "body",
      })),
    }),
    now: NOW,
  });
}

async function governedFixture(
  t,
  { governedOwnedSourceUrls = false } = {},
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-evergreen-input-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storyId = "halo-evergreen";
  const packet = await sourcePacket(storyId, root);
  const sourcePath = path.join(root, "source-evidence.json");
  const sourceFileSha256 = writeJson(sourcePath, packet);
  const items = [];
  for (let index = 0; index < 5; index += 1) {
    const assetPath = path.join(root, `clip-${index + 1}.mp4`);
    const bytes = Buffer.from(`materialised-halo-clip-${index + 1}`, "utf8");
    fs.writeFileSync(assetPath, bytes);
    const itemId = `halo-clip-${index + 1}`;
    items.push({
      item_id: itemId,
      source_url:
        governedOwnedSourceUrls && index < 3
          ? `pulse-owned://pulse-gaming/${storyId}/${itemId}`
          : packet.primary_source_url,
      local_path: assetPath,
      asset_sha256: sha256(bytes),
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: index < 3 ? "OWNED" : "LICENSED",
      rights_evidence: {
        reference: `fixture-licence-${index + 1}`,
        sha256: sha256(Buffer.from(`licence-${index + 1}`, "utf8")),
      },
      attribution_decision: "NOT_REQUIRED",
      owner: index < 3 ? "Pulse Gaming" : "Microsoft Gaming",
      usage: "gameplay_backbone",
      motion_family: index % 2 === 0 ? "gameplay" : "cinematic",
      exact_subject_motion_seconds: 12,
    });
  }
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: storyId,
    media_plan: {
      unknown_reuploads: 0,
      third_party_music: false,
    },
    items,
  };
  rightsLedger.ledger_sha256 = hashRightsLedger(rightsLedger);
  const rightsPath = path.join(root, "rights-ledger.json");
  const rightsFileSha256 = writeJson(rightsPath, rightsLedger);
  const advertiserReport = {
    schema_version: "pulse-advertiser-safety-report-v1",
    story_id: storyId,
    decision: "SAFE",
    advertiser_safety: 5,
    maximum_score: 5,
    hard_stops: [],
    policy_version: "pulse-advertiser-safe-v1",
  };
  const advertiserPath = path.join(root, "advertiser-safety.json");
  const advertiserFileSha256 = writeJson(
    advertiserPath,
    advertiserReport,
  );
  return {
    root,
    storyId,
    packet,
    rightsLedger,
    story: {
      id: storyId,
      title: "Halo multiplayer progression systems explained",
      franchise: "Halo",
      platform: "xbox",
      topic_key: "multiplayer-progression",
      _extra: JSON.stringify({
        source_evidence_path: sourcePath,
        source_evidence_file_sha256: sourceFileSha256,
        source_evidence_sha256: packet.packet_sha256,
        rights_ledger_path: rightsPath,
        rights_ledger_file_sha256: rightsFileSha256,
        rights_ledger_canonical_sha256: rightsLedger.ledger_sha256,
        advertiser_safety_report_path: advertiserPath,
        advertiser_safety_report_sha256: advertiserFileSha256,
      }),
    },
  };
}

function materialiseMotionCompletion(fixture) {
  const candidateId = "evergreen-halo-motion-completion";
  const workOrder = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: fixture.storyId,
    candidate_id: candidateId,
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 85.3,
    verified_materialised_motion_seconds: 60,
    additional_motion_seconds_required: 25.3,
    baseline_rights_ledger_sha256:
      fixture.rightsLedger.ledger_sha256,
    baseline_rights_asset_ids: fixture.rightsLedger.items
      .map((item) => item.item_id)
      .sort(),
    completion_contract: {
      schema_version: COMPLETION_SCHEMA_VERSION,
      materialised_video_probe_required: true,
      static_images_count_as_motion_seconds: false,
    },
    safety: {
      local_proof_only: true,
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      external_posting_authorised: false,
      publish_authority_created: false,
    },
  };
  workOrder.work_order_sha256 = workOrderSha256(workOrder);
  const workOrderDir = path.join(
    fixture.root,
    "output",
    "evergreen-verdict-candidates",
    "current",
    "motion-repair",
    fixture.storyId,
    workOrder.work_order_sha256,
  );
  fs.mkdirSync(workOrderDir, { recursive: true });
  const workOrderPath = path.join(
    workOrderDir,
    "evergreen-motion-coverage-repair-work-order.json",
  );
  const workOrderFileSha256 = writeJson(workOrderPath, workOrder);
  const clipPath = path.join(workOrderDir, "official-trailer.mp4");
  const clipBytes = Buffer.from("local-muted-halo-motion", "utf8");
  fs.writeFileSync(clipPath, clipBytes);
  const parentSourcePath = path.join(
    workOrderDir,
    "official-trailer-source.mp4",
  );
  const parentSourceBytes = Buffer.from(
    "local-official-halo-parent-motion",
    "utf8",
  );
  fs.writeFileSync(parentSourcePath, parentSourceBytes);
  const extra = JSON.parse(fixture.story._extra);
  const officialSource = fixture.packet.sources.find(
    (source) =>
      source.status === "CAPTURED" &&
      source.source_class === "OFFICIAL_FIRST_PARTY",
  );
  const mediaUrl =
    "https://www.youtube.com/watch?v=fixtureHaloMotion01";
  const materialisationReceipt = {
    schema_version: "pulse-evergreen-motion-materialisation-v1",
    generated_at: NOW,
    mode: "APPLY_LOCAL",
    verdict: "MATERIALISED",
    story_id: fixture.storyId,
    candidate_id: candidateId,
    work_order_sha256: workOrder.work_order_sha256,
    work_order_ref: {
      path: workOrderPath,
      file_sha256: workOrderFileSha256,
    },
    source: {
      local_path: parentSourcePath,
      file_sha256: sha256(parentSourceBytes),
      source_media_url: mediaUrl,
      source_duration_seconds: 100,
      width: 1920,
      height: 1080,
      video_stream_count: 1,
      audio_stream_count: 1,
    },
    segments: [
      {
        index: 1,
        start_seconds: 5,
        duration_seconds: 35,
        end_seconds: 40,
        status: "MATERIALISED",
        local_path: clipPath,
        file_sha256: sha256(clipBytes),
        probed_duration_seconds: 35,
        width: 1920,
        height: 1080,
        video_stream_count: 1,
        audio_stream_count: 0,
      },
    ],
    summary: {
      segment_count: 1,
      materialised_segment_count: 1,
      planned_motion_seconds: 35,
      required_additional_motion_seconds: 25.3,
      verified_materialised_motion_seconds: 35,
      static_motion_seconds: 0,
    },
    rights_decision: null,
    rights_basis: null,
    completion_manifest_created: false,
    safety: {
      local_proof_only: true,
      local_source_only: true,
      network_used: false,
      source_audio_removed: true,
      static_images_counted_as_motion: false,
      rights_decision_created: false,
      database_mutated: false,
      oauth_mutated: false,
      external_platform_contacted: false,
      scheduler_authority_created: false,
      publish_authority_created: false,
    },
  };
  const materialisationReceiptPath = path.join(
    workOrderDir,
    "evergreen-motion-materialisation-receipt.json",
  );
  const materialisationReceiptFileSha256 = writeJson(
    materialisationReceiptPath,
    materialisationReceipt,
  );
  const newRightsItem = {
    item_id: "official-halo-trailer-5-40",
    source_url: mediaUrl,
    local_path: clipPath,
    asset_sha256: sha256(clipBytes),
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
    rights_evidence: {
      reference: officialSource.final_url,
      sha256: fixture.packet.packet_sha256,
    },
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: "Source: Xbox",
    owner: officialSource.publisher,
    usage: "bounded_exact_subject_editorial_excerpt",
    motion_family: "official_trailer_gameplay",
    exact_subject_motion_seconds: 35,
    source_segment: {
      start_seconds: 5,
      end_seconds: 40,
      source_duration_seconds: 100,
    },
  };
  const amendedRightsLedger = {
    ledger_version: 2,
    decision: "CLEARED",
    story_id: fixture.storyId,
    media_plan: {
      exact_subject_motion_seconds: 95,
      clip_count: 6,
      distinct_motion_families: 3,
      unknown_reuploads: 0,
      third_party_music: false,
    },
    items: [
      ...structuredClone(fixture.rightsLedger.items),
      newRightsItem,
    ],
  };
  amendedRightsLedger.ledger_sha256 =
    hashRightsLedger(amendedRightsLedger);
  const amendedRightsLedgerPath = path.join(
    workOrderDir,
    "amended-rights-ledger.json",
  );
  const amendedRightsLedgerFileSha256 = writeJson(
    amendedRightsLedgerPath,
    amendedRightsLedger,
  );
  const manifest = {
    schema_version: COMPLETION_SCHEMA_VERSION,
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: fixture.storyId,
    candidate_id: candidateId,
    repair_work_order: {
      path: workOrderPath,
      file_sha256: workOrderFileSha256,
      work_order_sha256: workOrder.work_order_sha256,
    },
    materialisation_receipt: {
      path: materialisationReceiptPath,
      file_sha256: materialisationReceiptFileSha256,
    },
    source_binding: {
      source_evidence_path: extra.source_evidence_path,
      source_evidence_file_sha256:
        extra.source_evidence_file_sha256,
      source_evidence_packet_sha256:
        extra.source_evidence_sha256,
      source_id: officialSource.source_id,
      source_url: officialSource.final_url,
      source_provenance_sha256:
        officialSource.provenance_sha256,
      media_url: mediaUrl,
      media_owner: officialSource.publisher,
      source_file_sha256: sha256(parentSourceBytes),
    },
    baseline_rights_ledger: {
      path: extra.rights_ledger_path,
      file_sha256: extra.rights_ledger_file_sha256,
      ledger_sha256:
        extra.rights_ledger_canonical_sha256,
    },
    amended_rights_ledger: {
      path: amendedRightsLedgerPath,
      file_sha256: amendedRightsLedgerFileSha256,
      ledger_sha256: amendedRightsLedger.ledger_sha256,
    },
    segments: [
      {
        asset_id: "official-halo-trailer-5-40",
        local_path: clipPath,
        asset_sha256: sha256(clipBytes),
        media_type: "video",
        source_start_seconds: 5,
        source_end_seconds: 40,
        source_duration_seconds: 100,
        exact_subject_motion_seconds: 35,
        exact_subject_story_id: fixture.storyId,
        exact_subject_verified: true,
        exact_subject_evidence:
          "The exact Halo subject is visible throughout this official bounded excerpt.",
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
        rights_evidence: {
          reference: officialSource.final_url,
          sha256: fixture.packet.packet_sha256,
        },
        attribution_decision: "REQUIRED_AND_SUPPLIED",
        attribution_text: "Source: Xbox",
        owner: officialSource.publisher,
        usage: "bounded_exact_subject_editorial_excerpt",
        motion_family: "official_trailer_gameplay",
      },
    ],
    safety: {
      local_proof_only: true,
      local_files_only: true,
      network_used: false,
      download_performed: false,
      database_mutated: false,
      oauth_mutated: false,
      external_platform_contacted: false,
      publish_authority_created: false,
      external_posting_authorised: false,
    },
  };
  manifest.manifest_sha256 =
    hashEvergreenMotionCoverageCompletion(manifest);
  writeJson(path.join(workOrderDir, COMPLETION_FILENAME), manifest);
  return {
    candidateId,
    manifest,
    workOrder,
    materialisationReceipt,
    materialisationReceiptPath,
    materialisationReceiptFileSha256,
    parentSourcePath,
    amendedRightsLedger,
    amendedRightsLedgerPath,
    amendedRightsLedgerFileSha256,
  };
}

test("derives one exact discovery input only after every persisted evidence and asset hash revalidates", async (t) => {
  const fixture = await governedFixture(t);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(
    report.verdict,
    "READY_FOR_DISCOVERY",
    JSON.stringify(report.rejected_inputs),
  );
  assert.equal(report.discovery_inputs.stories.length, 1);
  assert.equal(report.discovery_inputs.manifests.length, 0);
  assert.equal(report.rejected_inputs.length, 0);
  const adapted = report.discovery_inputs.stories[0];
  assert.equal(adapted.id, fixture.storyId);
  assert.equal(adapted.franchise, "Halo");
  assert.equal(adapted.platform, "xbox");
  assert.equal(adapted.topic_key, "multiplayer-progression");
  assert.equal(adapted.source_evidence.verification_status, "CONFIRMED");
  assert.equal(adapted.source_evidence.verified_for_planning, true);
  assert.equal(
    adapted.source_evidence.packet_sha256,
    fixture.packet.packet_sha256,
  );
  assert.equal(adapted.source_evidence.claims.length, 3);
  assert.ok(
    adapted.source_evidence.claims.every((claim) =>
      fixture.packet.confirmed_claims.some((group) =>
        group.evidence.some(
          (evidence) =>
            evidence.text === claim.text &&
            evidence.final_url === claim.source_url,
        ),
      ),
    ),
  );
  assert.ok(
    adapted.source_evidence.claims.every(
      (claim) => claim.source_url === fixture.packet.primary_source_url,
    ),
    "captured but non-confirmed editorial quotes must not be flattened",
  );
  assert.equal(adapted.rights_evidence.decision, "CLEARED");
  assert.equal(
    adapted.rights_evidence.ledger_sha256,
    fixture.rightsLedger.ledger_sha256,
  );
  assert.equal(
    adapted.rights_evidence.media_plan.exact_subject_motion_seconds,
    60,
  );
  assert.equal(adapted.rights_evidence.media_plan.clip_count, 5);
  assert.equal(
    adapted.rights_evidence.media_plan.distinct_motion_families,
    2,
  );
  assert.equal(
    adapted.rights_evidence.media_plan.rights_records.length,
    5,
  );
  assert.equal(adapted.advertiser_safety.decision, "SAFE");
  assert.equal(
    adapted.advertiser_safety.policy_version,
    "pulse-advertiser-safe-v1",
  );
  assert.match(adapted.advertiser_safety.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.safety.read_only, true);
  assert.equal(report.safety.network_used, false);
  assert.equal(report.safety.database_mutated, false);
  assert.equal(report.safety.oauth_mutated, false);
  assert.equal(report.safety.publish_authority_created, false);
});

test("rebinds one deterministic local completion to its full amended ledger only after revalidating repair, source, baseline and video evidence", async (t) => {
  const fixture = await governedFixture(t);
  const completion = materialiseMotionCompletion(fixture);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
    probe_video: async () => ({
      duration_seconds: 35.001,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    }),
  });

  assert.equal(
    report.verdict,
    "READY_FOR_DISCOVERY",
    JSON.stringify(report.rejected_inputs),
  );
  assert.equal(report.rejected_inputs.length, 0);
  const adapted = report.discovery_inputs.stories[0];
  assert.equal(
    adapted.rights_evidence.media_plan.exact_subject_motion_seconds,
    95,
  );
  assert.equal(adapted.rights_evidence.media_plan.clip_count, 6);
  assert.equal(
    adapted.rights_evidence.media_plan.distinct_motion_families,
    3,
  );
  assert.equal(
    adapted.rights_evidence.media_plan.rights_records.at(-1)
      .rights_basis,
    "bounded_editorial_excerpt",
  );
  assert.equal(
    adapted.rights_evidence.ledger_sha256,
    completion.amendedRightsLedger.ledger_sha256,
  );
  assert.notEqual(
    adapted.rights_evidence.ledger_sha256,
    fixture.rightsLedger.ledger_sha256,
  );
  assert.equal(
    adapted.motion_completion.candidate_id,
    completion.candidateId,
  );
  assert.equal(
    adapted.motion_completion.amended_rights_ledger_sha256,
    completion.amendedRightsLedger.ledger_sha256,
  );
  assert.equal(
    adapted.motion_completion.materialisation_receipt_file_sha256,
    completion.materialisationReceiptFileSha256,
  );
  assert.equal(adapted.motion_completion.publish_authority, false);
  assert.deepEqual(
    report.accepted_inputs[0].evidence_provenance.rights_ledger,
    {
      path: completion.amendedRightsLedgerPath,
      file_sha256: completion.amendedRightsLedgerFileSha256,
      canonical_sha256:
        completion.amendedRightsLedger.ledger_sha256,
    },
  );
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.motion_completion
      .work_order_sha256,
    completion.workOrder.work_order_sha256,
  );
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.motion_completion
      .materialisation_receipt_file_sha256,
    completion.materialisationReceiptFileSha256,
  );
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.motion_completion
      .materialisation_source_sha256,
    completion.materialisationReceipt.source.file_sha256,
  );
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.motion_completion
      .baseline_rights_ledger_sha256,
    fixture.rightsLedger.ledger_sha256,
  );
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.motion_completion
      .amended_rights_ledger_sha256,
    completion.amendedRightsLedger.ledger_sha256,
  );
});

test("rejects an otherwise cleared ledger when materialised asset bytes no longer match", async (t) => {
  const fixture = await governedFixture(t);
  fs.appendFileSync(
    fixture.rightsLedger.items[0].local_path,
    Buffer.from("-tampered", "utf8"),
  );

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.discovery_inputs.stories.length, 0);
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "rights_asset_file_sha256_mismatch",
    ),
  );
});

test("binds advertiser safety from one explicit canonical green story-score row when no report file is supplied", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  delete extra.advertiser_safety_report_path;
  delete extra.advertiser_safety_report_sha256;
  fixture.story._extra = JSON.stringify(extra);
  const score = {
    id: 41,
    story_id: fixture.storyId,
    channel_id: "pulse-gaming",
    advertiser_safety: 5,
    hard_stops: [],
    scorer_version: "v1.0",
    scored_at: NOW,
  };

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    advertiser_safety_scores: [score],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "READY_FOR_DISCOVERY");
  const safety = report.discovery_inputs.stories[0].advertiser_safety;
  assert.equal(safety.decision, "SAFE");
  assert.equal(safety.policy_version, "v1.0");
  assert.equal(safety.score, 5);
  assert.match(safety.evidence_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    report.accepted_inputs[0].evidence_provenance.advertiser_safety.kind,
    "story_score",
  );
});

test("preserves manifest provenance while taking classification only from explicit manifest story fields", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  const manifest = {
    manifest_id: "manifest-halo-001",
    source_evidence_path: extra.source_evidence_path,
    source_evidence_file_sha256: extra.source_evidence_file_sha256,
    source_evidence_sha256: extra.source_evidence_sha256,
    rights_ledger_path: extra.rights_ledger_path,
    rights_ledger_file_sha256: extra.rights_ledger_file_sha256,
    rights_ledger_canonical_sha256:
      extra.rights_ledger_canonical_sha256,
    advertiser_safety_report_path:
      extra.advertiser_safety_report_path,
    advertiser_safety_report_sha256:
      extra.advertiser_safety_report_sha256,
    story: {
      id: fixture.storyId,
      title: fixture.story.title,
      franchise: "Halo",
      platform: "xbox",
      topic_key: "multiplayer-progression",
    },
  };

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    manifests: [manifest],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "READY_FOR_DISCOVERY");
  assert.equal(report.discovery_inputs.stories.length, 0);
  assert.equal(report.discovery_inputs.manifests.length, 1);
  assert.equal(
    report.discovery_inputs.manifests[0].manifest_id,
    manifest.manifest_id,
  );
  assert.equal(
    report.discovery_inputs.manifests[0].story.topic_key,
    "multiplayer-progression",
  );
  assert.deepEqual(report.accepted_inputs[0].origin, {
    kind: "manifest",
    manifest_id: manifest.manifest_id,
    story_id: fixture.storyId,
  });
});

test("does not infer franchise, platform or topic from a suggestive title", async (t) => {
  const fixture = await governedFixture(t);
  delete fixture.story.franchise;
  delete fixture.story.platform;
  delete fixture.story.topic_key;
  fixture.story.title =
    "Halo on Xbox: multiplayer progression explained";

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.deepEqual(
    report.rejected_inputs[0].blockers.filter((blocker) =>
      blocker.startsWith("story_"),
    ),
    [
      "story_franchise_required",
      "story_platform_required",
      "story_topic_key_required",
    ],
  );
});

test("rejects source evidence captured for a different story even when every hash is internally valid", async (t) => {
  const fixture = await governedFixture(t);
  fixture.story.id = "different-story";
  const extra = JSON.parse(fixture.story._extra);
  const advertiser = JSON.parse(
    fs.readFileSync(extra.advertiser_safety_report_path, "utf8"),
  );
  advertiser.story_id = fixture.story.id;
  extra.advertiser_safety_report_sha256 = writeJson(
    extra.advertiser_safety_report_path,
    advertiser,
  );
  fixture.story._extra = JSON.stringify(extra);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "source_evidence_story_id_mismatch",
    ),
  );
});

test("requires two explicit motion families instead of guessing diversity from file names", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  fixture.rightsLedger.items.forEach((item) => {
    item.motion_family = "gameplay";
  });
  extra.rights_ledger_file_sha256 = writeJson(
    extra.rights_ledger_path,
    fixture.rightsLedger,
  );
  fixture.story._extra = JSON.stringify(extra);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "rights_motion_diversity_too_low",
    ),
  );
});

test("requires explicit zero-unknown-reupload and no-third-party-music declarations from the bound ledger", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  delete fixture.rightsLedger.media_plan;
  extra.rights_ledger_file_sha256 = writeJson(
    extra.rights_ledger_path,
    fixture.rightsLedger,
  );
  fixture.story._extra = JSON.stringify(extra);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "rights_unknown_reuploads_zero_declaration_required",
    ),
  );
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "rights_third_party_music_false_declaration_required",
    ),
  );
});

test("rejects a hash-valid advertiser report unless its schema and 5-of-5 green decision are explicit", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  const advertiser = JSON.parse(
    fs.readFileSync(extra.advertiser_safety_report_path, "utf8"),
  );
  advertiser.schema_version = "unknown-safety-shape";
  advertiser.advertiser_safety = 4;
  extra.advertiser_safety_report_sha256 = writeJson(
    extra.advertiser_safety_report_path,
    advertiser,
  );
  fixture.story._extra = JSON.stringify(extra);

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "advertiser_safety_report_schema_invalid",
    ),
  );
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "advertiser_safety_not_explicitly_green",
    ),
  );
});

test("fails closed on duplicate canonical story identities across row and manifest inputs", async (t) => {
  const fixture = await governedFixture(t);
  const manifest = {
    manifest_id: "duplicate-manifest",
    story: structuredClone(fixture.story),
  };

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    manifests: [manifest],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.discovery_inputs.stories.length, 0);
  assert.equal(report.discovery_inputs.manifests.length, 0);
  assert.equal(report.rejected_inputs.length, 2);
  assert.ok(
    report.rejected_inputs.every((entry) =>
      entry.blockers.includes(`duplicate_story_input:${fixture.storyId}`),
    ),
  );
});

test("rejects persisted source and rights evidence when their exact file bytes drift", async (t) => {
  const fixture = await governedFixture(t);
  const extra = JSON.parse(fixture.story._extra);
  fs.appendFileSync(extra.source_evidence_path, " ");
  fs.appendFileSync(extra.rights_ledger_path, " ");

  const report = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "source_evidence_file_sha256_mismatch",
    ),
  );
  assert.ok(
    report.rejected_inputs[0].blockers.includes(
      "rights_ledger_file_sha256_mismatch",
    ),
  );
});

test("returns the exact stories and manifests interface consumed by autonomous evergreen discovery", async (t) => {
  const fixture = await governedFixture(t);
  const adapted = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });
  const story = adapted.discovery_inputs.stories[0];

  const discovery = await discoverEvergreenVerdictPitches({
    ...adapted.discovery_inputs,
    generator: async () => ({
      pitches: [
        {
          story_id: story.id,
          title: "Which Halo Progression Rule Still Matters Most?",
          format_shape: "ranked_lens",
          editorial_criteria: [
            "reward cadence",
            "returning-player clarity",
          ],
          item_rationales: story.source_evidence.claims.map((claim) => ({
            subject: claim.subject,
            judgement:
              "This verified progression detail changes the return experience.",
            claim_ids: [claim.id],
          })),
        },
      ],
    }),
    now: NOW,
  });

  assert.equal(
    discovery.verdict,
    "READY_FOR_CANDIDATE_ASSESSMENT",
  );
  assert.equal(discovery.selected_candidates.length, 1);
  assert.equal(
    discovery.selected_candidates[0].origin.story_id,
    fixture.storyId,
  );
});

test("passes exact governed pulse-owned rights records from the adapter into autonomous evergreen discovery", async (t) => {
  const fixture = await governedFixture(t, {
    governedOwnedSourceUrls: true,
  });
  const adapted = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });
  const story = adapted.discovery_inputs.stories[0];

  assert.ok(
    story.rights_evidence.media_plan.rights_records
      .filter((record) => record.rights_basis === "owned_capture")
      .every((record) =>
        record.source_url.startsWith(
          `pulse-owned://pulse-gaming/${fixture.storyId}/`,
        ),
      ),
  );

  const discovery = await discoverEvergreenVerdictPitches({
    ...adapted.discovery_inputs,
    generator: async () => ({
      pitches: [
        {
          story_id: story.id,
          title: "Which Halo Progression Rule Still Matters Most?",
          format_shape: "ranked_lens",
          editorial_criteria: [
            "reward cadence",
            "returning-player clarity",
          ],
          item_rationales: story.source_evidence.claims.map((claim) => ({
            subject: claim.subject,
            judgement:
              "This verified progression detail changes the return experience.",
            claim_ids: [claim.id],
          })),
        },
      ],
    }),
    now: NOW,
  });

  assert.equal(
    discovery.verdict,
    "READY_FOR_CANDIDATE_ASSESSMENT",
  );
  assert.equal(discovery.selected_candidates.length, 1);
});

test("rejects a pulse-owned rights URL that is not bound to the declared story and asset", async (t) => {
  const fixture = await governedFixture(t, {
    governedOwnedSourceUrls: true,
  });
  const adapted = await buildEvergreenAutonomousDiscoveryInputs({
    stories: [fixture.story],
    root_dir: fixture.root,
    now: NOW,
  });
  const story = adapted.discovery_inputs.stories[0];
  story.rights_evidence.media_plan.rights_records[0].source_url =
    `pulse-owned://pulse-gaming/${fixture.storyId}/another-asset`;
  let generatorCalls = 0;

  const discovery = await discoverEvergreenVerdictPitches({
    ...adapted.discovery_inputs,
    generator: async () => {
      generatorCalls += 1;
      return { pitches: [] };
    },
    now: NOW,
  });

  assert.equal(generatorCalls, 0);
  assert.equal(discovery.verdict, "HOLD");
  assert.deepEqual(discovery.rejected_inputs, [
    {
      origin: {
        kind: "story",
        story_id: fixture.storyId,
      },
      blockers: ["rights_record_invalid"],
    },
  ]);
});
