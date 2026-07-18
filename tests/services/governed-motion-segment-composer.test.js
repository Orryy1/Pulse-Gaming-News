"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  composeGovernedMotionSegmentReport,
  mirrorSegmentSourceMasters,
} = require("../../lib/governed-motion-segment-composer");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixtureBundle(root, {
  storyId = "story-1",
  sourceCount = 3,
  clipsPerSource = [2, 1, 1],
} = {}) {
  const clips = [];
  const records = [];
  const accepted = [];
  let clipNumber = 0;

  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
    const sourceBytes = Buffer.from(`official-source-${sourceIndex + 1}`);
    const sourcePath = path.join(root, `source-${sourceIndex + 1}.mp4`);
    await fs.outputFile(sourcePath, sourceBytes);
    const sourceHash = sha256(sourceBytes);

    for (let windowIndex = 0; windowIndex < clipsPerSource[sourceIndex]; windowIndex += 1) {
      clipNumber += 1;
      const clipBytes = Buffer.from(`materialised-clip-${clipNumber}`);
      const clipPath = path.join(root, `clip-${clipNumber}.mp4`);
      await fs.outputFile(clipPath, clipBytes);
      const clipHash = sha256(clipBytes);
      const clipId = `clip-${clipNumber}`;
      const youtubeId = `source${sourceIndex + 1}`;
      const start = windowIndex * 6;
      const duration = 5;
      const clip = {
        id: clipId,
        story_id: storyId,
        path: clipPath,
        local_materialized_path: clipPath,
        source_url: sourcePath,
        source_url_kind: "local_video_file",
        source_type: "official_youtube_channel_url",
        provider: "official_trailer_segment_validation",
        entity: "Fixture Game",
        source_owner: "Fixture Publisher",
        source_family: `youtube:${youtubeId}_window_${start}_${duration}`,
        motion_family: `youtube:${youtubeId}_window_${start}_${duration}`,
        base_source_family: `youtube:${youtubeId}`,
        media_kind: "direct_video",
        mediaStartS: start,
        durationS: duration,
        source_duration_s: 120,
        asset_sha256: clipHash,
        asset_size_bytes: clipBytes.length,
        canonical_source_url: `https://www.youtube.com/watch?v=${youtubeId}`,
        youtube_video_id: youtubeId,
        source_master_sha256: sourceHash,
        sampled_visual_fingerprint: `fingerprint-${clipNumber}`,
        base_source_asset_id: `sha256:${sourceHash}`,
        base_source_identity_basis: "master_sha256",
        source_identity_provenance: {
          status: "resolved",
          identity_scope: "source_identity_only",
          rights_grant: false,
        },
        validation_provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "segment_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
          source_duration_s: 120,
        },
        validated: true,
        segmentValidationPassed: true,
        licence_basis: "official_direct_media",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: [
          "youtube_shorts",
          "instagram_reels",
          "facebook_reels",
        ],
        commercial_use_allowed: true,
        credit_required: false,
        risk_score: 0.28,
      };
      clips.push(clip);
      accepted.push({ path: clipPath, eligible: true });
      records.push({
        asset_id: clipId,
        asset_type: "motion_clip",
        path: clipPath,
        asset_sha256: clipHash,
        asset_size_bytes: clipBytes.length,
        licence_basis: "official_direct_media",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: [
          "youtube_shorts",
          "instagram_reels",
          "facebook_reels",
        ],
        commercial_use_allowed: true,
        credit_required: false,
        risk_score: 0.28,
        rights_verdict: "GREEN",
      });
    }
  }

  return {
    manifest: {
      story_id: storyId,
      status: "ready",
      clips,
    },
    rightsLedger: {
      story_id: storyId,
      verdict: "PASS",
      blockers: [],
      records,
      used_assets: records.map((record) => ({
        asset_id: record.asset_id,
        path: record.path,
        asset_sha256: record.asset_sha256,
        asset_size_bytes: record.asset_size_bytes,
      })),
    },
    selectorReport: {
      version: "pulse_direct_motion_visual_selector_v5",
      policy_tier: "ultimate_professional",
      accepted,
      rejected: [],
      blockers: [],
    },
    clipIds: clips.map((clip) => clip.id),
  };
}

test("composes only independently selected, exact-rights motion into a balanced segment report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-"));
  const bundle = await fixtureBundle(root);

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    title: "Fixture Game Has A Real Test",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
    generatedAt: "2026-07-18T02:30:00.000Z",
  });

  assert.equal(report.verdict, "PASS", JSON.stringify(report.blockers));
  assert.equal(report.can_materialize, true);
  assert.equal(report.segments.length, 4);
  assert.equal(report.metrics.genuine_base_source_count, 3);
  assert.equal(report.metrics.repeat_free_coverage_seconds, 19.25);
  assert.deepEqual(report.blockers, []);
  assert.ok(report.segments.every((segment) => segment.status === "validated"));
  assert.ok(report.segments.every((segment) => segment.allowed_for_flash_lane === true));
});

test("accepts manifests that mirror the same exact clips under clips and materialised_clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-mirrored-"));
  const bundle = await fixtureBundle(root);
  bundle.manifest.materialised_clips = bundle.manifest.clips.map((clip) => ({ ...clip }));

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "PASS", JSON.stringify(report.blockers));
  assert.equal(report.segments.length, 4);
});

test("does not count alternate encodes of the same canonical YouTube video as separate sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-source-alias-"));
  const bundle = await fixtureBundle(root);
  const alternateBytes = Buffer.from("alternate encode of official source one");
  const alternatePath = path.join(root, "source-1-alternate.mp4");
  await fs.outputFile(alternatePath, alternateBytes);
  const alternateHash = sha256(alternateBytes);
  bundle.manifest.clips[1].source_url = alternatePath;
  bundle.manifest.clips[1].source_master_sha256 = alternateHash;
  bundle.manifest.clips[1].base_source_asset_id = `sha256:${alternateHash}`;

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "PASS", JSON.stringify(report.blockers));
  assert.equal(report.metrics.genuine_base_source_count, 3);
  assert.equal(
    report.metrics.source_scene_shares.find(
      (row) => row.base_source_asset_id === "youtube:source1",
    ).scene_count,
    2,
  );
});

test("fails closed when a selected clip was not accepted by the independent visual selector", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-selector-"));
  const bundle = await fixtureBundle(root);
  bundle.selectorReport.accepted = bundle.selectorReport.accepted.slice(1);

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 10,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_materialize, false);
  assert.ok(report.blockers.includes("independent_visual_selector_acceptance_missing:clip-1"));
});

test("fails closed when the source rights ledger is only a bare pass flag", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-rights-"));
  const bundle = await fixtureBundle(root);
  bundle.rightsLedger = { verdict: "PASS" };

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 10,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_materialize, false);
  assert.ok(report.blockers.includes("rights_ledger_used_asset_records_missing"));
});

test("permits only the recognised post-script motion repair transition while preserving the publish hold", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-transition-"));
  const bundle = await fixtureBundle(root);
  bundle.rightsLedger = {
    ...bundle.rightsLedger,
    verdict: "RED",
    status: "blocked",
    blockers: [
      "narration_and_render_regeneration_required_after_script_repair",
    ],
    failures: [],
    script_repair_media_transition: {
      recognised: true,
      reconciliation_allowed: true,
      narration_fresh: true,
      render_fresh: false,
      motion_rights_reconciled: true,
      status: "awaiting_fresh_render",
      blocker:
        "narration_and_render_regeneration_required_after_script_repair",
    },
  };

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "PASS", JSON.stringify(report.blockers));
  assert.equal(report.can_materialize, true);
  assert.equal(report.story_publishable, false);
  assert.deepEqual(report.upstream_publish_hold, {
    active: true,
    reason:
      "narration_and_render_regeneration_required_after_script_repair",
    release_condition:
      "fresh_render_and_authoritative_post_render_rights_reconciliation",
  });
});

test("does not accept an unrecognised script-repair transition as motion evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-bad-transition-"));
  const bundle = await fixtureBundle(root);
  bundle.rightsLedger = {
    ...bundle.rightsLedger,
    verdict: "RED",
    status: "blocked",
    blockers: [
      "narration_and_render_regeneration_required_after_script_repair",
    ],
    failures: [],
    script_repair_media_transition: {
      recognised: true,
      reconciliation_allowed: true,
      narration_fresh: true,
      render_fresh: false,
      motion_rights_reconciled: false,
      status: "awaiting_fresh_render",
    },
  };

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_materialize, false);
  assert.ok(report.blockers.includes("rights_ledger_not_pass"));
});

test("fails closed when a materialised clip hash is stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-hash-"));
  const bundle = await fixtureBundle(root);
  bundle.manifest.clips[0].asset_sha256 = "0".repeat(64);

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 10,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_materialize, false);
  assert.ok(report.blockers.includes("materialised_clip_hash_mismatch:clip-1"));
});

test("fails closed when one source exceeds the renderer concentration contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-concentration-"));
  const bundle = await fixtureBundle(root, {
    sourceCount: 2,
    clipsPerSource: [4, 1],
  });

  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 10,
    minClips: 5,
    minBaseSources: 2,
    maxScenesPerSource: 2,
    maxSourceShare: 0.25,
    bundles: [bundle],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.can_materialize, false);
  assert.ok(report.blockers.includes("professional_motion_source_concentration_above_floor"));
});

test("mirrors exact source masters into an isolated materializer root without changing hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-composer-mirror-source-"));
  const materializerRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-motion-composer-materializer-root-"),
  );
  const bundle = await fixtureBundle(root);
  const report = await composeGovernedMotionSegmentReport({
    root,
    storyId: "story-1",
    narrationDurationSeconds: 17,
    transitionDurationSeconds: 0.25,
    minClips: 4,
    minBaseSources: 3,
    bundles: [bundle],
  });

  const mirrored = await mirrorSegmentSourceMasters(report, {
    root,
    materializerRoot,
  });

  assert.equal(mirrored.verdict, "PASS", JSON.stringify(mirrored.blockers));
  assert.equal(mirrored.metrics.mirrored_source_master_count, 3);
  assert.ok(
    mirrored.segments.every((segment) =>
      path.resolve(segment.source_url).startsWith(path.resolve(materializerRoot)),
    ),
  );
  for (const segment of mirrored.segments) {
    assert.equal(await sha256(await fs.readFile(segment.source_url)), segment.source_master_sha256);
  }
});
