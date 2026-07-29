"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  COMPLETION_FILENAME,
  COMPLETION_SCHEMA_VERSION,
  buildEvergreenMotionCoverageCompletionManifest,
  findEvergreenMotionCoverageCompletionReference,
  hashEvergreenMotionCoverageCompletion,
  materializeEvergreenMotionCoverageCompletion,
  validateEvergreenMotionCoverageCompletion,
} = require("../../lib/services/evergreen-motion-coverage-completion");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("../../lib/services/evergreen-motion-repair-work-order");

const NOW = "2026-07-28T12:00:00.000Z";
const STORY_ID = "rss_3f966f811271b5f2";
const CANDIDATE_ID = "evergreen-dragon-ball-limit-breaker";
const SOURCE_URL =
  "https://blog.playstation.com/2026/07/23/dragon-ball-sparking-zeros-super-limit-breaking-neo-dlc-out-july-30/";
const MEDIA_URL = "https://www.youtube.com/watch?v=022l3iJMBAg";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function workOrderHash(value) {
  return hashEvergreenMotionRepairWorkOrder(value);
}

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-evergreen-motion-completion-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const archiveBytes = Buffer.from(
    `<article><a href="${MEDIA_URL}">official trailer</a></article>`,
    "utf8",
  );
  const archivePath = path.join(root, "official-source.html");
  fs.writeFileSync(archivePath, archiveBytes);
  const source = {
    status: "CAPTURED",
    source_id: "playstation-blog",
    source_class: "OFFICIAL_FIRST_PARTY",
    publisher: "Sony Interactive Entertainment",
    final_url: SOURCE_URL,
    bytes_sha256: sha256(archiveBytes),
    provenance_sha256: "a".repeat(64),
    provenance: {
      archive_path: archivePath,
      bytes_sha256: sha256(archiveBytes),
    },
  };
  const packet = {
    schema_version: "pulse-breaking-source-evidence-v1",
    story_id: STORY_ID,
    verification_status: "CONFIRMED",
    verified_for_planning: true,
    verdict: "OFFICIAL_CONFIRMED",
    confirmation_basis: "official_first_party",
    primary_source_url: SOURCE_URL,
    sources: [source],
    confirmed_claims: [],
    packet_sha256: "b".repeat(64),
  };
  const sourcePath = path.join(root, "source-evidence.json");
  const sourceFileSha256 = writeJson(sourcePath, packet);

  const baselineAssetPath = path.join(root, "baseline.mp4");
  const baselineBytes = Buffer.from("baseline-owned-motion", "utf8");
  fs.writeFileSync(baselineAssetPath, baselineBytes);
  const baselineLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: STORY_ID,
    media_plan: {
      exact_subject_motion_seconds: 28,
      clip_count: 1,
      distinct_motion_families: 1,
      unknown_reuploads: 0,
      third_party_music: false,
    },
    items: [
      {
        item_id: "owned-motion-backbone",
        source_url:
          `pulse-owned://pulse-gaming/${STORY_ID}/owned-motion-backbone`,
        local_path: baselineAssetPath,
        asset_sha256: sha256(baselineBytes),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "owned-motion-manifest.json",
          sha256: "c".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        owner: "Pulse Gaming",
        usage: "owned_motion_backbone",
        motion_family: "owned_motion_backbone",
        exact_subject_motion_seconds: 28,
      },
    ],
  };
  baselineLedger.ledger_sha256 = hashRightsLedger(baselineLedger);
  const baselinePath = path.join(root, "rights-ledger.json");
  const baselineFileSha256 = writeJson(baselinePath, baselineLedger);

  const workOrder = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: STORY_ID,
    candidate_id: CANDIDATE_ID,
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 53.3,
    verified_materialised_motion_seconds: 28,
    additional_motion_seconds_required: 25.3,
    baseline_rights_ledger_sha256: baselineLedger.ledger_sha256,
    baseline_rights_asset_ids: ["owned-motion-backbone"],
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
  workOrder.work_order_sha256 = workOrderHash(workOrder);
  const workOrderDir = path.join(
    root,
    "motion-repair",
    STORY_ID,
    workOrder.work_order_sha256,
  );
  fs.mkdirSync(workOrderDir, { recursive: true });
  const workOrderPath = path.join(
    workOrderDir,
    "evergreen-motion-coverage-repair-work-order.json",
  );
  const workOrderFileSha256 = writeJson(workOrderPath, workOrder);

  const clipPath = path.join(workOrderDir, "official-trailer-excerpt.mp4");
  const clipBytes = Buffer.from("local-muted-video-fixture", "utf8");
  fs.writeFileSync(clipPath, clipBytes);
  const parentSourcePath = path.join(
    workOrderDir,
    "official-trailer-source.mp4",
  );
  const parentSourceBytes = Buffer.from(
    "local-official-parent-video-fixture",
    "utf8",
  );
  fs.writeFileSync(parentSourcePath, parentSourceBytes);
  const materialisationReceipt = {
    schema_version: "pulse-evergreen-motion-materialisation-v1",
    generated_at: NOW,
    mode: "APPLY_LOCAL",
    verdict: "MATERIALISED",
    story_id: STORY_ID,
    candidate_id: CANDIDATE_ID,
    work_order_sha256: workOrder.work_order_sha256,
    work_order_ref: {
      path: workOrderPath,
      file_sha256: workOrderFileSha256,
    },
    source: {
      local_path: parentSourcePath,
      file_sha256: sha256(parentSourceBytes),
      source_media_url: MEDIA_URL,
      source_duration_seconds: 513,
      width: 1920,
      height: 1080,
      video_stream_count: 1,
      audio_stream_count: 1,
    },
    segments: [
      {
        index: 1,
        start_seconds: 135,
        duration_seconds: 35,
        end_seconds: 170,
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
  const amendedLedger = {
    ledger_version: 2,
    decision: "CLEARED",
    story_id: STORY_ID,
    media_plan: {
      exact_subject_motion_seconds: 63,
      clip_count: 2,
      distinct_motion_families: 2,
      unknown_reuploads: 0,
      third_party_music: false,
    },
    items: [
      ...structuredClone(baselineLedger.items),
      {
        item_id: "official-playstation-trailer-135-170",
        source_url: MEDIA_URL,
        local_path: clipPath,
        asset_sha256: sha256(clipBytes),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
        rights_evidence: {
          reference: SOURCE_URL,
          sha256: packet.packet_sha256,
        },
        attribution_decision: "REQUIRED_AND_SUPPLIED",
        attribution_text: "Source: PlayStation",
        owner: "Sony Interactive Entertainment",
        usage: "bounded_exact_subject_editorial_excerpt",
        motion_family: "official_trailer_gameplay",
        exact_subject_motion_seconds: 35,
        source_segment: {
          start_seconds: 135,
          end_seconds: 170,
          source_duration_seconds: 513,
        },
      },
    ],
  };
  amendedLedger.ledger_sha256 = hashRightsLedger(amendedLedger);
  const amendedLedgerPath = path.join(
    workOrderDir,
    "amended-rights-ledger.json",
  );
  const amendedLedgerFileSha256 = writeJson(
    amendedLedgerPath,
    amendedLedger,
  );
  const manifest = {
    schema_version: COMPLETION_SCHEMA_VERSION,
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: STORY_ID,
    candidate_id: CANDIDATE_ID,
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
      source_evidence_path: sourcePath,
      source_evidence_file_sha256: sourceFileSha256,
      source_evidence_packet_sha256: packet.packet_sha256,
      source_id: source.source_id,
      source_url: SOURCE_URL,
      source_provenance_sha256: source.provenance_sha256,
      media_url: MEDIA_URL,
      media_owner: "Sony Interactive Entertainment",
      source_file_sha256: sha256(parentSourceBytes),
    },
    baseline_rights_ledger: {
      path: baselinePath,
      file_sha256: baselineFileSha256,
      ledger_sha256: baselineLedger.ledger_sha256,
    },
    amended_rights_ledger: {
      path: amendedLedgerPath,
      file_sha256: amendedLedgerFileSha256,
      ledger_sha256: amendedLedger.ledger_sha256,
    },
    segments: [
      {
        asset_id: "official-playstation-trailer-135-170",
        local_path: clipPath,
        asset_sha256: sha256(clipBytes),
        media_type: "video",
        source_start_seconds: 135,
        source_end_seconds: 170,
        source_duration_seconds: 513,
        exact_subject_motion_seconds: 35,
        exact_subject_story_id: STORY_ID,
        exact_subject_verified: true,
        exact_subject_evidence:
          "The bounded official trailer excerpt visibly depicts the exact Dragon Ball story subject.",
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
        rights_evidence: {
          reference: SOURCE_URL,
          sha256: packet.packet_sha256,
        },
        attribution_decision: "REQUIRED_AND_SUPPLIED",
        attribution_text: "Source: PlayStation",
        owner: "Sony Interactive Entertainment",
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
  const manifestPath = path.join(workOrderDir, COMPLETION_FILENAME);
  const manifestFileSha256 = writeJson(manifestPath, manifest);

  return {
    root,
    packet,
    baselineLedger,
    amendedLedger,
    amendedLedgerPath,
    workOrder,
    manifest,
    manifestPath,
    manifestFileSha256,
    materialisationReceipt,
    materialisationReceiptPath,
    materialisationReceiptFileSha256,
    parentSourcePath,
  };
}

function rewriteManifest(fx, mutate) {
  mutate(fx.manifest);
  fx.manifest.manifest_sha256 =
    hashEvergreenMotionCoverageCompletion(fx.manifest);
  fx.manifestFileSha256 = writeJson(
    fx.manifestPath,
    fx.manifest,
  );
}

function rewriteAmendedLedger(fx, mutate) {
  mutate(fx.amendedLedger);
  fx.amendedLedger.ledger_sha256 =
    hashRightsLedger(fx.amendedLedger);
  const fileSha256 = writeJson(
    fx.amendedLedgerPath,
    fx.amendedLedger,
  );
  rewriteManifest(fx, (manifest) => {
    manifest.amended_rights_ledger.file_sha256 = fileSha256;
    manifest.amended_rights_ledger.ledger_sha256 =
      fx.amendedLedger.ledger_sha256;
  });
}

test("accepts one hash-bound local video completion only after exact work-order, story, source and baseline-ledger verification", async (t) => {
  const fx = fixture(t);
  const probeCalls = [];

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async (filePath) => {
      probeCalls.push(filePath);
      return {
        duration_seconds: 35.001,
        video_stream_count: 1,
        audio_stream_count: 0,
        width: 1920,
        height: 1080,
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      };
    },
  });

  assert.equal(result.verdict, "READY");
  assert.deepEqual(result.blockers, []);
  assert.equal(probeCalls.length, 1);
  assert.equal(result.rights_records.length, 1);
  assert.equal(
    result.rights_records[0].rights_basis,
    "bounded_editorial_excerpt",
  );
  assert.equal(result.rights_records[0].exact_subject_motion_seconds, 35);
  assert.equal(result.verified_exact_subject_motion_seconds, 35);
  assert.equal(result.candidate_id, CANDIDATE_ID);
  assert.equal(result.baseline_rights_ledger_sha256,
    fx.baselineLedger.ledger_sha256);
  assert.equal(
    result.amended_rights_ledger_sha256,
    fx.amendedLedger.ledger_sha256,
  );
  assert.notEqual(
    result.amended_rights_ledger_sha256,
    result.baseline_rights_ledger_sha256,
  );
  assert.equal(
    result.materialisation_receipt_path,
    fx.materialisationReceiptPath,
  );
  assert.equal(
    result.materialisation_receipt_file_sha256,
    fx.materialisationReceiptFileSha256,
  );
  assert.equal(
    result.materialisation_source_path,
    fx.parentSourcePath,
  );
  assert.equal(
    result.materialisation_source_sha256,
    fx.materialisationReceipt.source.file_sha256,
  );
  assert.equal(result.safety.network_used, false);
  assert.equal(result.safety.download_performed, false);
  assert.equal(result.safety.publish_authority_created, false);
});

test("fails closed when the completion does not bind a hash-validated materialisation receipt", async (t) => {
  const fx = fixture(t);
  rewriteManifest(fx, (manifest) => {
    delete manifest.materialisation_receipt;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_materialisation_receipt_path_required",
    ),
  );
  assert.deepEqual(result.rights_records, []);
});

test("rejects a hash-valid materialisation receipt that references a different repair work order", async (t) => {
  const fx = fixture(t);
  fx.materialisationReceipt.work_order_ref.path = path.join(
    fx.root,
    "different-work-order.json",
  );
  const receiptFileSha256 = writeJson(
    fx.materialisationReceiptPath,
    fx.materialisationReceipt,
  );
  rewriteManifest(fx, (manifest) => {
    manifest.materialisation_receipt.file_sha256 =
      receiptFileSha256;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_materialisation_receipt_work_order_ref_mismatch",
    ),
  );
});

test("fails closed without a full hash-bound amended rights ledger", async (t) => {
  const fx = fixture(t);
  rewriteManifest(fx, (manifest) => {
    delete manifest.amended_rights_ledger;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_amended_rights_ledger_path_required",
    ),
  );
  assert.equal(result.amended_rights_ledger_sha256, null);
});

test("rejects an amended ledger that rewrites any baseline rights item", async (t) => {
  const fx = fixture(t);
  rewriteAmendedLedger(fx, (ledger) => {
    ledger.items[0].usage = "rewritten_baseline_usage";
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_amended_baseline_item_mismatch",
    ),
  );
  assert.equal(result.amended_rights_ledger_sha256, null);
});

test("rejects an amended ledger whose new item is not exactly bound to the materialised segment", async (t) => {
  const fx = fixture(t);
  rewriteAmendedLedger(fx, (ledger) => {
    ledger.items[1].asset_sha256 = "d".repeat(64);
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_amended_segment_item_mismatch",
    ),
  );
  assert.equal(result.amended_rights_ledger_sha256, null);
});

test("rejects an amended ledger whose complete media plan does not match its final item inventory", async (t) => {
  const fx = fixture(t);
  rewriteAmendedLedger(fx, (ledger) => {
    ledger.media_plan.clip_count = 99;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_amended_media_plan_mismatch",
    ),
  );
  assert.equal(result.amended_rights_ledger_sha256, null);
});

test("rejects a hash-valid receipt whose parent source URL is not the bound official media URL", async (t) => {
  const fx = fixture(t);
  fx.materialisationReceipt.source.source_media_url =
    "https://www.youtube.com/watch?v=unrelatedUpload";
  const receiptFileSha256 = writeJson(
    fx.materialisationReceiptPath,
    fx.materialisationReceipt,
  );
  rewriteManifest(fx, (manifest) => {
    manifest.materialisation_receipt.file_sha256 =
      receiptFileSha256;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_materialisation_source_url_mismatch",
    ),
  );
});

test("rejects parent source bytes that no longer match the receipt and completion binding", async (t) => {
  const fx = fixture(t);
  fs.appendFileSync(
    fx.parentSourcePath,
    Buffer.from("-swapped-parent-source", "utf8"),
  );

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_materialisation_source_file_sha256_mismatch",
    ),
  );
});

test("rejects a manifest extraction window that does not exactly match the materialisation receipt", async (t) => {
  const fx = fixture(t);
  rewriteManifest(fx, (manifest) => {
    manifest.segments[0].source_start_seconds = 136;
    manifest.segments[0].source_end_seconds = 171;
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_materialisation_window_mismatch",
    ),
  );
});

test("rejects swapped clip bytes even when the completion manifest is rehashed around the replacement", async (t) => {
  const fx = fixture(t);
  const replacementBytes = Buffer.from(
    "different-local-muted-video-fixture",
    "utf8",
  );
  fs.writeFileSync(
    fx.manifest.segments[0].local_path,
    replacementBytes,
  );
  rewriteManifest(fx, (manifest) => {
    manifest.segments[0].asset_sha256 =
      sha256(replacementBytes);
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mp4",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_materialisation_output_sha256_mismatch",
    ),
  );
});

test("discovers exactly one completion only beneath the fixed story-bound local repair root", async (t) => {
  const fx = fixture(t);
  const deterministicDir = path.join(
    fx.root,
    "output",
    "evergreen-verdict-candidates",
    "current",
    "motion-repair",
    STORY_ID,
    fx.workOrder.work_order_sha256,
  );
  fs.mkdirSync(deterministicDir, { recursive: true });
  const deterministicPath = path.join(
    deterministicDir,
    COMPLETION_FILENAME,
  );
  fs.copyFileSync(fx.manifestPath, deterministicPath);

  const result =
    await findEvergreenMotionCoverageCompletionReference({
      story_id: STORY_ID,
      root_dir: fx.root,
    });

  assert.equal(result.mode, "deterministic_local");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.reference, {
    path: deterministicPath,
    file_sha256: null,
  });
  assert.equal(result.safety.network_used, false);
  assert.equal(result.safety.database_mutated, false);
});

test("fails closed on multiple deterministic completions while an exact hash-bound explicit reference overrides discovery", async (t) => {
  const fx = fixture(t);
  const storyRoot = path.join(
    fx.root,
    "output",
    "evergreen-verdict-candidates",
    "current",
    "motion-repair",
    STORY_ID,
  );
  for (const hash of ["1".repeat(64), "2".repeat(64)]) {
    const targetDir = path.join(storyRoot, hash);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(
      fx.manifestPath,
      path.join(targetDir, COMPLETION_FILENAME),
    );
  }

  const ambiguous =
    await findEvergreenMotionCoverageCompletionReference({
      story_id: STORY_ID,
      root_dir: fx.root,
    });
  assert.equal(ambiguous.reference, null);
  assert.deepEqual(ambiguous.blockers, [
    "motion_completion_manifest_ambiguous",
  ]);
  assert.equal(ambiguous.candidates.length, 2);

  const explicit =
    await findEvergreenMotionCoverageCompletionReference({
      story_id: STORY_ID,
      root_dir: fx.root,
      explicit_reference: {
        path: fx.manifestPath,
        file_sha256: fx.manifestFileSha256,
      },
    });
  assert.equal(explicit.mode, "explicit");
  assert.deepEqual(explicit.blockers, []);
  assert.deepEqual(explicit.reference, {
    path: fx.manifestPath,
    file_sha256: fx.manifestFileSha256,
  });
});

test("never counts a static image as exact-subject motion", async (t) => {
  const fx = fixture(t);
  const imagePath = path.join(
    path.dirname(fx.manifestPath),
    "official-key-art.png",
  );
  const imageBytes = Buffer.from("static-image-fixture", "utf8");
  fs.writeFileSync(imagePath, imageBytes);
  rewriteManifest(fx, (manifest) => {
    manifest.segments[0].local_path = imagePath;
    manifest.segments[0].asset_sha256 = sha256(imageBytes);
    manifest.segments[0].media_type = "image";
  });
  let probeCalls = 0;

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => {
      probeCalls += 1;
      return {
        duration_seconds: 35,
        video_stream_count: 1,
        audio_stream_count: 0,
      };
    },
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.verified_exact_subject_motion_seconds, 0);
  assert.deepEqual(result.rights_records, []);
  assert.equal(probeCalls, 0);
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_video_file_required",
    ),
  );
});

test("rejects duplicate or overlapping trailer ranges instead of double-counting their seconds", async (t) => {
  const fx = fixture(t);
  const first = fx.manifest.segments[0];
  const secondPath = path.join(
    path.dirname(fx.manifestPath),
    "second-official-trailer-excerpt.mp4",
  );
  const secondBytes = Buffer.from("second-local-muted-video", "utf8");
  fs.writeFileSync(secondPath, secondBytes);
  rewriteManifest(fx, (manifest) => {
    manifest.segments.push({
      ...structuredClone(first),
      asset_id: "official-playstation-trailer-150-180",
      local_path: secondPath,
      asset_sha256: sha256(secondBytes),
      source_start_seconds: 150,
      source_end_seconds: 180,
      exact_subject_motion_seconds: 30,
    });
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async (filePath) => ({
      duration_seconds: filePath === secondPath ? 30 : 35,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.verified_exact_subject_motion_seconds, 0);
  assert.ok(
    result.blockers.includes(
      "motion_completion_source_window_overlap",
    ),
  );
});

test("rejects source, clip and baseline byte drift even when the manifest remains internally self-hashed", async (t) => {
  const fx = fixture(t);
  fs.appendFileSync(
    fx.manifest.segments[0].local_path,
    Buffer.from("-tampered", "utf8"),
  );
  fs.appendFileSync(
    fx.manifest.baseline_rights_ledger.path,
    Buffer.from(" ", "utf8"),
  );
  rewriteManifest(fx, (manifest) => {
    manifest.source_binding.media_url =
      "https://www.youtube.com/watch?v=DifferentTrailer";
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35,
      video_stream_count: 1,
      audio_stream_count: 0,
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_media_not_embedded_in_official_source",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_asset_file_sha256_mismatch",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "motion_completion_baseline_rights_ledger_file_sha256_mismatch",
    ),
  );
});

test("the explicit operator materialiser writes one immutable validated manifest beside an existing local repair work order", async (t) => {
  const fx = fixture(t);
  const request = structuredClone(fx.manifest);
  delete request.manifest_sha256;
  delete request.safety;
  fs.rmSync(fx.manifestPath);

  const built =
    buildEvergreenMotionCoverageCompletionManifest(request);
  assert.equal(built.safety.network_used, false);
  assert.equal(built.safety.download_performed, false);
  assert.match(built.manifest_sha256, /^[a-f0-9]{64}$/);

  const result = await materializeEvergreenMotionCoverageCompletion({
    request,
    output_path: fx.manifestPath,
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35.001,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    }),
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.created, true);
  assert.equal(result.output_path, fx.manifestPath);
  assert.equal(fs.existsSync(fx.manifestPath), true);
  assert.equal(
    hashEvergreenMotionCoverageCompletion(
      JSON.parse(fs.readFileSync(fx.manifestPath, "utf8")),
    ),
    result.manifest_sha256,
  );

  const replay = await materializeEvergreenMotionCoverageCompletion({
    request,
    output_path: fx.manifestPath,
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35.001,
      video_stream_count: 1,
      audio_stream_count: 0,
    }),
  });
  assert.equal(replay.created, false);
  assert.equal(replay.immutable_replay, true);
});

test("a nominally allowed editorial-use basis still fails unless owner and rights evidence bind to the exact official source", async (t) => {
  const fx = fixture(t);
  rewriteManifest(fx, (manifest) => {
    manifest.segments[0].owner = "Unrelated uploader";
    manifest.segments[0].rights_evidence = {
      reference: "https://example.com/unrelated",
      sha256: "d".repeat(64),
    };
  });

  const result = await validateEvergreenMotionCoverageCompletion({
    reference: {
      path: fx.manifestPath,
      file_sha256: fx.manifestFileSha256,
    },
    expected_story_id: STORY_ID,
    expected_source_packet_sha256: fx.packet.packet_sha256,
    expected_baseline_rights_ledger_sha256:
      fx.baselineLedger.ledger_sha256,
    root_dir: fx.root,
    probe_video: async () => ({
      duration_seconds: 35.001,
      video_stream_count: 1,
      audio_stream_count: 0,
      width: 1920,
      height: 1080,
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_owner_source_binding_mismatch",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "motion_completion_segment_1_editorial_rights_evidence_binding_invalid",
    ),
  );
});
