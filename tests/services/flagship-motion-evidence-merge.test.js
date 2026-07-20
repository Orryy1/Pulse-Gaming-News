"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  mergeFlagshipMotionEvidence,
} = require("../../lib/flagship-motion-evidence-merge");
const {
  main: runMergeCli,
  parseArgs,
} = require("../../tools/flagship-motion-evidence-merge");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeMotionPackage({
  root,
  name,
  storyId,
  clips,
  transition = false,
  transitionStaleBindings = false,
}) {
  const packageDir = path.join(root, name);
  await fs.ensureDir(packageDir);
  const materialisedClips = [];
  const records = [];
  const usedAssets = [];

  for (const clip of clips) {
    const clipPath = path.join(packageDir, `${clip.id}.mp4`);
    const bytes = Buffer.alloc(2_048 + materialisedClips.length, clip.byte || 0x31);
    await fs.writeFile(clipPath, bytes);
    const evidencePath = path.join(packageDir, `${clip.id}.rights.txt`);
    const evidenceBytes = Buffer.from(`rights:${clip.id}`);
    await fs.writeFile(evidencePath, evidenceBytes);
    const fileHash = sha256(bytes);
    const fileSize = bytes.length;
    const row = {
      id: clip.id,
      path: clipPath,
      local_materialized_path: clipPath,
      media_kind: "direct_video",
      source_type: "official_youtube_channel_url",
      source_family: `youtube:${clip.youtubeId}_window_0_5`,
      motion_family: `youtube:${clip.youtubeId}_window_0_5`,
      base_source_asset_id: `sha256:${clip.masterHash}`,
      source_master_sha256: clip.masterHash,
      canonical_source_url: `https://www.youtube.com/watch?v=${clip.youtubeId}`,
      youtube_video_id: clip.youtubeId,
      asset_sha256: fileHash,
      asset_size_bytes: fileSize,
      materialized_duration_s: 5,
      materialized_file_evidence: {
        sha256: fileHash,
        size_bytes: fileSize,
        duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
      counts_towards_motion_readiness: true,
      materialized: true,
    };
    const record = {
      asset_id: clip.id,
      asset_type: "motion_clip",
      kind: "video",
      path: clipPath,
      source_url: row.canonical_source_url,
      source_type: row.source_type,
      licence_basis: "publisher_video_policy_transformative_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: [
        "youtube_shorts",
        "instagram_reels",
        "facebook_reels",
      ],
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      rights_grant: true,
      transformative_rights_evidence_verified: true,
      evidence_file: evidencePath,
      evidence_sha256: sha256(evidenceBytes),
      evidence_size_bytes: evidenceBytes.length,
      asset_sha256: fileHash,
      asset_size_bytes: fileSize,
      materialized_file_evidence: { ...row.materialized_file_evidence },
    };
    const usedAsset = {
      asset_id: clip.id,
      kind: "video",
      path: clipPath,
      source_url: row.canonical_source_url,
      source_type: row.source_type,
      asset_sha256: fileHash,
      asset_size_bytes: fileSize,
    };
    if (transition && transitionStaleBindings) {
      record.path = path.join(packageDir, `${clip.id}.stale.mp4`);
      record.asset_sha256 = "f".repeat(64);
      record.asset_size_bytes = fileSize + 1;
      usedAsset.path = record.path;
      usedAsset.asset_sha256 = record.asset_sha256;
      usedAsset.asset_size_bytes = record.asset_size_bytes;
    }
    materialisedClips.push(row);
    records.push(record);
    usedAssets.push(usedAsset);
  }

  const manifestPath = path.join(packageDir, "materialised_motion_clips.json");
  await fs.writeJson(manifestPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    clips: materialisedClips,
    materialised_clips: materialisedClips,
    clip_count: materialisedClips.length,
    distinct_motion_family_count: materialisedClips.length,
    distinct_genuine_base_source_count: materialisedClips.length,
  }, { spaces: 2 });

  const audioId = `${storyId}_audio_path`;
  await fs.writeJson(path.join(packageDir, "rights_ledger.json"), transition
    ? {
        schema_version: 2,
        story_id: storyId,
        verdict: "RED",
        status: "blocked",
        blockers: [
          `narration_commercial_rights_evidence_not_green:${audioId}`,
          "used_asset_rights_coverage_incomplete",
          `flagship_rights_sidecar_source_record_missing:${audioId}`,
          "narration_and_render_regeneration_required_after_script_repair",
        ],
        failures: [],
        records: [
          {
            asset_id: audioId,
            asset_type: "narration_audio",
            kind: "audio",
          },
          ...records,
        ],
        used_assets: usedAssets,
        metrics: {
          used_asset_count: usedAssets.length + 1,
          rights_record_count: usedAssets.length,
          missing_asset_count: 1,
          duplicate_record_count: 0,
        },
        reconciliation: {
          safe_demotion_applied: true,
          authoritative_publish_verdict_unchanged: true,
        },
      }
    : {
        schema_version: 1,
        story_id: storyId,
        verdict: "pass",
        status: "ready",
        blockers: [],
        failures: [],
        records,
        used_assets: usedAssets,
        metrics: {
          used_asset_count: usedAssets.length,
          rights_record_count: records.length,
          missing_asset_count: 0,
          duplicate_record_count: 0,
        },
      }, { spaces: 2 });

  return { packageDir, manifestPath, materialisedClips };
}

test("merges exact current motion with one pass-ledger donor without promoting narration debt", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-evidence-merge-"));
  t.after(() => fs.remove(root));
  const storyId = "official-black-flag-story";
  const primary = await writeMotionPackage({
    root,
    name: "primary",
    storyId,
    transition: true,
    clips: [
      { id: "primary-a", youtubeId: "PrimaryA01", masterHash: "1".repeat(64) },
      { id: "primary-b", youtubeId: "PrimaryB02", masterHash: "2".repeat(64) },
      { id: "primary-c", youtubeId: "PrimaryC03", masterHash: "3".repeat(64) },
      { id: "primary-d", youtubeId: "PrimaryD04", masterHash: "4".repeat(64) },
    ],
  });
  const donor = await writeMotionPackage({
    root,
    name: "donor",
    storyId,
    clips: [
      { id: "donor-e", youtubeId: "DonorE0005", masterHash: "5".repeat(64) },
    ],
  });
  const outputDir = path.join(root, "merged");

  const result = await mergeFlagshipMotionEvidence({
    storyId,
    primaryManifestPath: primary.manifestPath,
    donorManifestPath: donor.manifestPath,
    donorClipIds: ["donor-e"],
    outputDir,
    generatedAt: "2026-07-20T01:30:00.000Z",
  }, {
    probeMedia: async () => ({
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    }),
  });

  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.publish_authorised, false);
  assert.equal(result.report.selected_motion_clip_count, 5);
  assert.equal(result.report.distinct_genuine_base_source_count, 5);
  const manifest = await fs.readJson(result.manifestPath);
  const rights = await fs.readJson(result.rightsLedgerPath);
  assert.deepEqual(
    manifest.materialised_clips.map((clip) => clip.id),
    ["primary-a", "primary-b", "primary-c", "primary-d", "donor-e"],
  );
  assert.equal(manifest.clip_count, 5);
  assert.equal(manifest.distinct_genuine_base_source_count, 5);
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.status, "ready");
  assert.equal(rights.records.length, 5);
  assert.equal(rights.used_assets.length, 5);
  assert.equal(rights.motion_only_scope, true);
  assert.equal(rights.can_auto_publish, false);
  assert.equal(
    rights.source_ledger_reconciliation.primary_narration_debt_preserved,
    true,
  );
});

test("CLI materialises a local-proof merge report and never authorises publishing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-merge-cli-"));
  t.after(() => fs.remove(root));
  const storyId = "official-black-flag-cli-story";
  const primary = await writeMotionPackage({
    root,
    name: "primary",
    storyId,
    transition: true,
    clips: [
      { id: "primary-a", youtubeId: "PrimaryA01", masterHash: "1".repeat(64) },
      { id: "primary-b", youtubeId: "PrimaryB02", masterHash: "2".repeat(64) },
      { id: "primary-c", youtubeId: "PrimaryC03", masterHash: "3".repeat(64) },
      { id: "primary-d", youtubeId: "PrimaryD04", masterHash: "4".repeat(64) },
    ],
  });
  const donor = await writeMotionPackage({
    root,
    name: "donor",
    storyId,
    clips: [
      { id: "donor-e", youtubeId: "DonorE0005", masterHash: "5".repeat(64) },
    ],
  });
  const outputDir = path.join(root, "merged");
  const output = [];
  const args = [
    "--story-id", storyId,
    "--primary-manifest", primary.manifestPath,
    "--donor-manifest", donor.manifestPath,
    "--donor-clip-id", "donor-e",
    "--output-dir", outputDir,
    "--generated-at", "2026-07-20T01:45:00.000Z",
    "--json",
  ];

  const parsed = parseArgs(args);
  assert.equal(parsed.storyId, storyId);
  assert.deepEqual(parsed.donorClipIds, ["donor-e"]);
  const result = await runMergeCli(args, {
    cwd: root,
    stdout: (value) => output.push(String(value)),
    probeMedia: async () => ({
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    }),
  });

  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.publish_authorised, false);
  assert.match(output.join(""), /"publish_authorised": false/);
  assert.equal(
    await fs.pathExists(
      path.join(outputDir, "flagship_motion_evidence_merge_report.json"),
    ),
    true,
  );
});

test("rebinds stale motion paths only from exact current materialised evidence in a narration transition ledger", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-transition-"));
  t.after(() => fs.remove(root));
  const storyId = "official-black-flag-transition-story";
  const primary = await writeMotionPackage({
    root,
    name: "primary",
    storyId,
    transition: true,
    transitionStaleBindings: true,
    clips: [
      { id: "primary-a", youtubeId: "PrimaryA01", masterHash: "1".repeat(64) },
      { id: "primary-b", youtubeId: "PrimaryB02", masterHash: "2".repeat(64) },
      { id: "primary-c", youtubeId: "PrimaryC03", masterHash: "3".repeat(64) },
      { id: "primary-d", youtubeId: "PrimaryD04", masterHash: "4".repeat(64) },
    ],
  });
  const donor = await writeMotionPackage({
    root,
    name: "donor",
    storyId,
    clips: [
      { id: "donor-e", youtubeId: "DonorE0005", masterHash: "5".repeat(64) },
    ],
  });

  const result = await mergeFlagshipMotionEvidence({
    storyId,
    primaryManifestPath: primary.manifestPath,
    donorManifestPath: donor.manifestPath,
    donorClipIds: ["donor-e"],
    outputDir: path.join(root, "merged"),
  }, {
    probeMedia: async () => ({
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    }),
  });

  const rights = await fs.readJson(result.rightsLedgerPath);
  assert.equal(rights.verdict, "pass");
  assert.equal(
    rights.records.find((row) => row.asset_id === "primary-a").asset_sha256,
    primary.materialisedClips[0].asset_sha256,
  );
  assert.equal(
    rights.source_ledger_reconciliation.transition_motion_rebinding_count,
    4,
  );
});

test("rejects transition rebinding when nested current materialised evidence is stale", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-transition-stale-"));
  t.after(() => fs.remove(root));
  const storyId = "official-black-flag-stale-transition";
  const primary = await writeMotionPackage({
    root,
    name: "primary",
    storyId,
    transition: true,
    transitionStaleBindings: true,
    clips: [
      { id: "primary-a", youtubeId: "PrimaryA01", masterHash: "1".repeat(64) },
      { id: "primary-b", youtubeId: "PrimaryB02", masterHash: "2".repeat(64) },
      { id: "primary-c", youtubeId: "PrimaryC03", masterHash: "3".repeat(64) },
      { id: "primary-d", youtubeId: "PrimaryD04", masterHash: "4".repeat(64) },
    ],
  });
  const donor = await writeMotionPackage({
    root,
    name: "donor",
    storyId,
    clips: [
      { id: "donor-e", youtubeId: "DonorE0005", masterHash: "5".repeat(64) },
    ],
  });
  const primaryRightsPath = path.join(primary.packageDir, "rights_ledger.json");
  const primaryRights = await fs.readJson(primaryRightsPath);
  primaryRights.records.find(
    (record) => record.asset_id === "primary-a",
  ).materialized_file_evidence.sha256 = "0".repeat(64);
  await fs.writeJson(primaryRightsPath, primaryRights, { spaces: 2 });
  const outputDir = path.join(root, "merged");

  await assert.rejects(
    () => mergeFlagshipMotionEvidence({
      storyId,
      primaryManifestPath: primary.manifestPath,
      donorManifestPath: donor.manifestPath,
      donorClipIds: ["donor-e"],
      outputDir,
    }, {
      probeMedia: async () => ({
        duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      }),
    }),
    /primary:primary-a_rights_file_binding_mismatch/,
  );
  assert.equal(await fs.pathExists(outputDir), false);
});
