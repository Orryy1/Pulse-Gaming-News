"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  candidateRows,
  materializeGoalRealMotion: materializeGoalRealMotionProduction,
  writeGoalRealMotionReport,
  _private: {
    dynamicMaxDirectClipsPerBaseSource,
    governedStaleInventoryRecoveryRows,
    materializedSourceIdentityFields,
    reconcileMaterializedRightsRecords,
  },
} = require("../../lib/goal-real-motion-materializer");
const { parseArgs } = require("../../tools/goal-real-motion-materializer");

const ENABLED_LIVE_PLATFORM_RIGHTS = Object.freeze([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

function commercialEditorialRights(evidenceReference) {
  return {
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: evidenceReference,
    risk_score: 0.2,
  };
}

function materializeGoalRealMotion(options = {}) {
  return materializeGoalRealMotionProduction({
    ...options,
    materializedClipProbe: options.materializedClipProbe || ((filePath, expectedMedia = {}) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: Number(expectedMedia.duration_seconds || 5),
      video: { codec: "h264", width: 1080, height: 1920 },
    })),
    materializedClipDecode: options.materializedClipDecode || ((filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      full_clip: true,
    })),
  });
}

async function makeGovernedSelectorClip(root, storyId, index) {
  const clipPath = path.join(
    root,
    "output",
    "video_cache",
    `${storyId}-selector-${index + 1}.mp4`,
  );
  const contents = Buffer.alloc(4096, index + 1);
  await fs.outputFile(clipPath, contents);
  const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
  const sourceUrl = `https://official.example.com/${storyId}/trailer-${index + 1}.mp4`;
  const baseSourceId = `sha256:${sha256}`;
  return {
    id: `selector_direct_motion_${index + 1}`,
    path: clipPath,
    local_materialized_path: clipPath,
    source_url: sourceUrl,
    canonical_source_url: sourceUrl,
    source_family: `selector_window_${index + 1}`,
    base_source_family: `selector_base_${index + 1}`,
    motion_family: `selector_window_${index + 1}`,
    source_type: "official_publisher_promotional_video",
    media_kind: "direct_video",
    durationS: 5,
    mediaStartS: index * 6,
    rights_basis: "official_reference_only",
    licence_basis: "official_reference_only",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: sourceUrl,
    risk_score: 0.2,
    counts_towards_motion_readiness: true,
    materialized: true,
    validated: true,
    segmentValidationPassed: true,
    asset_sha256: sha256,
    asset_size_bytes: contents.length,
    probed_duration_seconds: 5,
    video_codec: "h264",
    width: 1080,
    height: 1920,
    materialized_file_evidence: {
      sha256,
      size_bytes: contents.length,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
    base_source_asset_id: baseSourceId,
    base_source_identity_basis: "source_master_sha256",
    source_master_sha256: sha256,
    motion_source_identity: {
      schema_version: 1,
      status: "resolved",
      strict_pass: true,
      canonical_source_url: sourceUrl,
      source_master_sha256: sha256,
      base_source_asset_id: baseSourceId,
      base_source_identity_basis: "source_master_sha256",
      blockers: [],
    },
    validation_provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "gameplay_action_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
    provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "gameplay_action_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
  };
}

async function makePackage(root, storyId = "forza-real-motion") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    thumbnail_headline: "XBOX STEAM BET",
    primary_source: "The Phrasemaker",
  });
  const assets = Array.from({ length: 5 }, (_, index) => ({
    id: `${storyId}-direct-${index + 1}`,
    type: "motion_clip",
    kind: "video",
    source_family: `forza_official_family_${index + 1}`,
    path: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`,
    source_url: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "official_social_media_video",
    entity: "Forza Horizon 6",
    mediaStartS: 8 + index,
    durationS: 2.85,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: true,
    rights_risk_class: "official_reference_only",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`,
    risk_score: 0.2,
    provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "segment_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
      media_start_s: 8 + index,
      duration_s: 2.85,
    },
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });
  return {
    story_id: storyId,
    title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    artifact_dir: artifactDir,
    status: "blocked_on_render_inputs",
    actions: [{ action_id: "materialise_validated_real_motion_clips" }],
  };
}

test("real motion materializer selects only validated direct media candidates", async () => {
  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          id: "good",
          path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/good.mp4?tag=14",
          source_family: "official_x",
          source_kind: "direct_video",
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
        {
          id: "watch",
          path: "https://www.youtube.com/watch?v=abc123",
          source_family: "youtube_watch_page",
          source_kind: "page",
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
        {
          id: "untrusted",
          path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/bad.mp4?tag=14",
          source_family: "untrusted",
          source_kind: "direct_video",
          segmentValidationPassed: true,
          trusted_source_matched: false,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "good");
});

test("real motion materializer can scope repair to selected story ids", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-scope-"));
  const selectedJob = await makePackage(root, "selected-story");
  const skippedJob = await makePackage(root, "skipped-story");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [skippedJob, selectedJob] },
    storyIds: ["selected-story"],
    generatedAt: "2026-05-23T19:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.deepEqual(report.jobs.map((job) => job.story_id), ["selected-story"]);
  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0], null, 2),
  );
  assert.equal(await fs.pathExists(path.join(selectedJob.artifact_dir, "materialised_motion_clips.json")), true);
  assert.equal(await fs.pathExists(path.join(selectedJob.artifact_dir, "distinct_motion_family_report.json")), true);
  assert.equal(await fs.pathExists(path.join(skippedJob.artifact_dir, "materialised_motion_clips.json")), false);
  assert.equal(await fs.pathExists(path.join(skippedJob.artifact_dir, "distinct_motion_family_report.json")), false);
});

test("real motion materializer rejects a rights ledger bound to another story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-identity-"));
  const job = await makePackage(root, "rights-identity-story");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.story_id = "different-story";
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-17T21:45:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_ledger_story_id_mismatch"));
  assert.equal((await fs.readJson(rightsPath)).story_id, "different-story");
});

test("real motion materializer CLI accepts repeatable story-id filters", () => {
  const args = parseArgs([
    "--story-id",
    "story-a",
    "--story",
    "story-b",
    "--segment-report",
    "test/output/segments.json",
    "--artifact-root",
    "output/candidate-supply/fresh-refill/goal-proof-batch",
    "--limit",
    "2",
    "--refresh-ready",
  ]);

  assert.deepEqual(args.storyIds, ["story-a", "story-b"]);
  assert.equal(args.segmentReportPath, "test/output/segments.json");
  assert.equal(args.artifactRoot, "output/candidate-supply/fresh-refill/goal-proof-batch");
  assert.equal(args.limit, 2);
  assert.equal(args.refreshReady, true);
});

test("real motion materializer CLI accepts explicit direct base-source clip cap", () => {
  const args = parseArgs([
    "--max-direct-clips-per-base-source",
    "1",
  ]);

  assert.equal(args.maxDirectClipsPerBaseSource, 1);
});

test("real motion materializer CLI exposes the ultimate professional source-diversity tier", () => {
  const args = parseArgs([
    "--strict-base-source-diversity",
    "--min-base-sources",
    "7",
  ]);

  assert.equal(args.strictBaseSourceDiversity, true);
  assert.equal(args.minBaseSources, 7);
});

test("real motion materializer CLI can require premium frame selection before source caps", () => {
  const args = parseArgs(["--premium-visual-selection"]);

  assert.equal(args.premiumVisualSelection, true);
});

test("real motion materializer CLI accepts an exact refresh-window plan and repeatable exclusions", () => {
  const args = parseArgs([
    "--refresh-window-plan",
    "output/local-proof/refresh-window-plan.json",
    "--exclude-clip-id",
    "bad-window-one",
    "--exclude-clip-id",
    "bad-window-two",
  ]);

  assert.equal(
    args.refreshWindowPlanPath,
    "output/local-proof/refresh-window-plan.json",
  );
  assert.deepEqual(args.excludedClipIds, ["bad-window-one", "bad-window-two"]);
});

test("real motion materializer forwards an explicit base-source window cap to story materialisation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-explicit-window-cap-"));
  const job = await makePackage(root, "explicit-window-cap");
  const sourceUrl = "https://cdn.example.com/official/gameplay-trailer.mp4";
  await fs.outputJson(path.join(job.artifact_dir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [10, 24, 38].map((start, index) => ({
      id: `official-window-${index + 1}`,
      type: "motion_clip",
      kind: "video",
      source_family: `official_gameplay_window_${start}_5`,
      base_source_family: "official_gameplay_trailer",
      path: sourceUrl,
      source_url: sourceUrl,
      source_kind: "direct_video",
      source_url_kind: "direct_video",
      source_type: "official_platform_product_page",
      entity: "Explicit Window Cap",
      mediaStartS: start,
      durationS: 5,
      validated: true,
      segmentValidationPassed: true,
      trusted_source_matched: true,
      rights_risk_class: "official_reference_only",
    })),
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    minClips: 3,
    minFamilies: 3,
    maxClips: 3,
    maxDirectClipsPerBaseSource: 3,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 3);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 0);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
});

test("real motion materializer can refresh a requested ready story from its motion pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-ready-"));
  const storyId = "ps5-refresh-ready";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });
  const clips = Array.from({ length: 6 }, (_, index) => ({
    id: `ps5-official-product-${index + 1}`,
    type: "motion_clip",
    source_family: `official_playstation_family_${index + 1}`,
    path: `https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-${index + 1}.mp4`,
    source_url: `https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-${index + 1}.mp4`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "official_platform_product_page",
    entity: "PS5",
    mediaStartS: 1 + index,
    durationS: 3,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: false,
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    ...commercialEditorialRights(
      `https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-${index + 1}.mp4`,
    ),
    provenance: {
      source_report: "official_trailer_segment_validation",
      validation_reason: "official_product_motion_samples_passed",
    },
  }));
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_ready", ready: true, can_publish: true, blockers: [] },
    clips,
  });
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          title: "PS5 Prices Went Up In Europe",
          artifact_dir: artifactDir,
          status: "ready_for_final_render_job",
          actions: [{ action_id: "run_visual_v4_production_render" }],
        },
      ],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 6,
    generatedAt: "2026-05-26T11:10:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.equal(report.summary.materialized_clip_count, 6);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.distinct_motion_family_count, 6);
  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.summary.distinct_motion_family_count, 6);
  assert.equal(familyReport.summary.direct_video_motion_family_count, 6);
  assert.deepEqual(familyReport.distinct_motion_families, materialised.distinct_motion_families);
});

test("refresh-ready exact plans can materialize newly validated segment-report sources", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-real-motion-refresh-segment-report-"),
  );
  const storyId = "black-flag-refresh-segment-report";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const policyPath = path.join(root, "output", "rights", "publisher-video-policy.pdf");
  const policyBytes = Buffer.alloc(4096, 31);
  await fs.outputFile(policyPath, policyBytes);
  const policySha256 = crypto.createHash("sha256").update(policyBytes).digest("hex");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
    },
  });

  const sourcePaths = [];
  const segments = [];
  const windows = [];
  for (let index = 0; index < 5; index += 1) {
    const youtubeVideoId = `OfficialR0${index + 1}`;
    const sourcePath = path.join(
      root,
      "output",
      "official-source-masters",
      `${youtubeVideoId}.mp4`,
    );
    const sourceBytes = Buffer.alloc(12288, index + 41);
    await fs.outputFile(sourcePath, sourceBytes);
    sourcePaths.push(sourcePath);
    const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
    const canonicalSourceUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    const identitySidecarPath = path.join(
      root,
      "output",
      "official-source-masters",
      `${youtubeVideoId}.source-identity.json`,
    );
    const identitySidecarBytes = Buffer.from(
      JSON.stringify({
        schema: "pulse_motion_source_identity_sidecar_v1",
        schema_version: 1,
        producer: "pulse_source_identity_oembed_verifier_v1",
        canonical_source_url: canonicalSourceUrl,
        youtube_video_id: youtubeVideoId,
        channel_identity: {
          author_name: "Official Publisher",
          author_url: "https://www.youtube.com/@officialpublisher",
        },
        source_master_sha256: sourceSha256,
        identity_scope: "source_identity_only",
        rights_grant: false,
        evidence: {
          provider: "youtube_oembed",
          verified_at: "2026-07-19T16:00:00.000Z",
          title: `Official gameplay source ${index + 1}`,
        },
      }),
    );
    await fs.outputFile(identitySidecarPath, identitySidecarBytes);
    const identitySidecarSha256 = crypto
      .createHash("sha256")
      .update(identitySidecarBytes)
      .digest("hex");
    const segmentId = `validated-official-source-${index + 1}`;
    segments.push({
      id: segmentId,
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "independent_frame_review_passed",
      source_url: sourcePath,
      source_master_path: sourcePath,
      source_type: "official_youtube_channel_url",
      source_url_kind: "local_video_file",
      provider: "official_youtube_channel",
      entity: "Assassin's Creed Black Flag Resynced",
      source_owner: "Ubisoft",
      canonical_source_url: canonicalSourceUrl,
      youtube_video_id: youtubeVideoId,
      source_master_sha256: sourceSha256,
      source_identity_provenance: {
        schema_version: 1,
        kind: "source_identity_evidence_bundle",
        status: "resolved",
        identity_scope: "source_identity_only",
        rights_grant: false,
        sources: [{
          schema_version: 1,
          kind: "pulse_source_identity_sidecar",
          status: "resolved",
          sidecar_path: identitySidecarPath,
          sidecar_sha256: identitySidecarSha256,
          canonical_source_url: canonicalSourceUrl,
          youtube_video_id: youtubeVideoId,
          source_master_sha256: sourceSha256,
          identity_scope: "source_identity_only",
          rights_grant: false,
        }],
      },
      source_identity_conflicts: [],
      source_family: `youtube:${youtubeVideoId}`,
      media_start_s: 0,
      duration_s: 5,
      source_duration_s: 25,
      licence_basis: "publisher_video_policy_transformative_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
      platform_restrictions: { source_audio: "must_not_be_used" },
      commercial_use_allowed: true,
      credit_required: false,
      evidence_reference: canonicalSourceUrl,
      evidence_file: policyPath,
      rights_evidence_file: policyPath,
      evidence_kind: "publisher_video_policy",
      evidence_sha256: policySha256,
      rights_evidence_sha256: policySha256,
      evidence_size_bytes: policyBytes.length,
      rights_evidence_size_bytes: policyBytes.length,
      transformative_rights_evidence_verified: true,
      rights_grant: true,
      risk_score: 0.18,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_duration_s: 25,
      },
    });
    windows.push({
      id: `replacement-window-${index + 1}`,
      source_clip_id: segmentId,
      source_family: `youtube:${youtubeVideoId}_window_${index * 3}_5`,
      media_start_s: index * 3,
      duration_s: 5,
    });
  }
  const firstSegment = segments[0];
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [{
      asset_id: "legacy-policy-window",
      asset_type: "motion_clip",
      kind: "video",
      path: path.join(root, "output", "video-cache", "legacy-policy-window.mp4"),
      source_url: firstSegment.source_url,
      canonical_source_url: firstSegment.canonical_source_url,
      youtube_video_id: firstSegment.youtube_video_id,
      source_master_sha256: firstSegment.source_master_sha256,
      source_type: firstSegment.source_type,
      source_owner: firstSegment.source_owner,
      licence_basis: "ubisoft_video_policy_transformative_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube", "instagram", "facebook"],
      commercial_use_allowed: true,
      credit_required: true,
      evidence_reference: path.join(root, "rights", "legacy-policy.html"),
      rights_grant: false,
      risk_score: 0.18,
      source_media_start_s: 0,
      source_window_duration_s: 5,
      approval_status: "approved_for_transformative_editorial_use",
      source_identity_provenance: {
        schema_version: 1,
        kind: "source_identity_evidence_bundle",
        status: "resolved",
        identity_scope: "source_identity_only",
        rights_grant: false,
        sources: [{
          ...firstSegment.source_identity_provenance,
        }],
      },
      validation_provenance: {
        source: "legacy_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    }],
  });

  const ffmpegInputs = [];
  const repairedClipPath = path.join(
    artifactDir,
    "visual-repairs",
    "replacement-window-5.footer-crop.mp4",
  );
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Passes Three Million Sales",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    segmentValidationReport: { segments },
    refreshWindowPlan: { story_id: storyId, windows },
    minClips: 5,
    minFamilies: 5,
    minBaseSources: 5,
    strictBaseSourceDiversity: true,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 1,
    generatedAt: "2026-07-19T16:00:00.000Z",
    execFileSync: (_bin, args) => {
      ffmpegInputs.push(path.resolve(args[args.indexOf("-i") + 1]));
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(8192, 53));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualEligibility: async (clip) => {
      if (clip.id !== windows[4].id) {
        return { eligible: true, reasons: [] };
      }
      await fs.copy(clip.path, repairedClipPath);
      return {
        eligible: true,
        reasons: [],
        replacement_clip: {
          ...clip,
          path: repairedClipPath,
          local_materialized_path: repairedClipPath,
          visual_repair: {
            status: "pass",
            kind: "crop_legal_footer_bottom_10_percent",
            source_path: clip.path,
            output_path: repairedClipPath,
          },
        },
      };
    },
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.deepEqual(ffmpegInputs.sort(), sourcePaths.map((value) => path.resolve(value)).sort());
  const materialised = await fs.readJson(
    path.join(artifactDir, "materialised_motion_clips.json"),
  );
  assert.equal(
    materialised.status,
    "ready",
    JSON.stringify({
      blockers: materialised.blockers,
      rights_reconciliation: materialised.rights_reconciliation,
    }),
  );
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_genuine_base_source_count, 5);
  assert.deepEqual(
    materialised.clips.map((clip) => clip.id).sort(),
    windows.map((window) => window.id).sort(),
  );
  const repairedClip = materialised.clips.find((clip) => clip.id === windows[4].id);
  assert.equal(path.resolve(repairedClip.path), path.resolve(repairedClipPath));
  assert.equal(
    repairedClip.visual_repair.kind,
    "crop_legal_footer_bottom_10_percent",
  );

  const rejectedWindowId = windows[4].id;
  const rejectedRefresh = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Passes Three Million Sales",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    segmentValidationReport: { segments },
    refreshWindowPlan: { story_id: storyId, windows },
    minClips: 5,
    minFamilies: 5,
    minBaseSources: 5,
    strictBaseSourceDiversity: true,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 1,
    generatedAt: "2026-07-19T16:05:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(8192, 59));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `fingerprint:${clip.id}`,
    clipVisualEligibility: async (clip) => clip.id === rejectedWindowId
      ? {
          eligible: false,
          reasons: ["direct_motion_frame_taste_failed"],
          metrics: { decoded_sample_count: 20, failed_taste_sample_count: 20 },
        }
      : {
          eligible: true,
          reasons: [],
          metrics: { decoded_sample_count: 20, failed_taste_sample_count: 0 },
        },
  });

  assert.equal(
    rejectedRefresh.summary.materialized_story_count,
    0,
    JSON.stringify(rejectedRefresh.jobs[0]),
  );
  assert.equal(rejectedRefresh.summary.blocked_story_count, 1);
  assert.ok(
    rejectedRefresh.jobs[0].blockers.includes("refresh_window_plan_incomplete"),
  );
  assert.equal(rejectedRefresh.jobs[0].refresh_window_plan_requested_count, 5);
  assert.equal(rejectedRefresh.jobs[0].refresh_window_plan_materialized_count, 4);
  assert.deepEqual(
    rejectedRefresh.jobs[0].refresh_window_plan_failed_window_ids,
    [rejectedWindowId],
  );
  const blockedRefresh = await fs.readJson(
    path.join(artifactDir, "materialised_motion_clips.json"),
  );
  assert.equal(blockedRefresh.status, "blocked");
  assert.equal(blockedRefresh.not_publishable, true);
  assert.equal(
    blockedRefresh.clips.some((clip) => clip.id === rejectedWindowId),
    false,
  );
});

test("real motion materializer rebalances validated package clips when refreshing a ready story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-artifact-"));
  const storyId = "ascend-refresh-artifact";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Ascend to ZERO",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const rootCounts = [4, 2, 2, 2];
  const clips = [];
  for (const [rootIndex, count] of rootCounts.entries()) {
    for (let windowIndex = 0; windowIndex < count; windowIndex += 1) {
      const localPath = path.join(root, "output", "video_cache", `${storyId}-${rootIndex}-${windowIndex}.mp4`);
      await fs.outputFile(localPath, Buffer.alloc(4096, rootIndex + 1));
      const sourceUrl = `https://video.akamai.steamstatic.com/store_trailers/2697940/${rootIndex + 1}/hash-${rootIndex}/hls_264_master.m3u8`;
      clips.push({
        id: `clip-${rootIndex}-${windowIndex}`,
        path: localPath,
        local_materialized_path: localPath,
        source_url: sourceUrl,
        source_family: `steam-${rootIndex}-window-${windowIndex}`,
        base_source_family: `steam-${rootIndex}`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
        mediaStartS: 12 + windowIndex * 6,
        rights_basis: "official_direct_media",
        ...commercialEditorialRights(sourceUrl),
        counts_towards_motion_readiness: true,
        materialized: true,
        validated: true,
        segmentValidationPassed: true,
        provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "official_storefront_trailer_motion_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
          base_source_family: `steam-${rootIndex}`,
        },
      });
    }
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Ascend to ZERO Turns Time Into A Weapon",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 8,
    minFamilies: 4,
    maxClips: 8,
    maxDirectClipsPerBaseSource: 2,
    generatedAt: "2026-07-13T17:45:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.equal(report.jobs[0].repair_scope, "artifact_materialized_motion_rebalance");
  assert.equal(report.jobs[0].materialized_count, 8);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const countsByRoot = new Map();
  for (const clip of materialised.clips) {
    countsByRoot.set(clip.base_source_family, (countsByRoot.get(clip.base_source_family) || 0) + 1);
    assert.equal(clip.entity, "Ascend to ZERO");
  }
  assert.deepEqual([...countsByRoot.values()].sort((a, b) => a - b), [2, 2, 2, 2]);
});

test("real motion refresh replaces stale selected clips with stable collision-safe current identities", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-replace-"));
  const storyId = "rss_a6f055abed9a1488";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Arknights: Endfield",
  });

  const staleClips = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `stale-run-${index + 1}.mp4`);
    const bytes = Buffer.alloc(4096, index + 1);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await fs.outputFile(clipPath, bytes);
    staleClips.push({
      id: `segment_direct_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.publisher.example/arknights/stale-${index + 1}.mp4`,
      source_family: `stale_run_window_${index + 1}`,
      base_source_family: `stale_run_base_${index + 1}`,
      source_type: "official_publisher_promotional_video",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: index * 6,
      licence_basis: "official_publisher_promotional_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      credit_required: true,
      evidence_reference: `https://publisher.example/arknights/stale-${index + 1}`,
      risk_score: 0.2,
      counts_towards_motion_readiness: true,
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      materialized_file_evidence: {
        sha256,
        size_bytes: bytes.length,
        duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_publisher_motion_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
        base_source_family: `stale_run_base_${index + 1}`,
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    status: "ready",
    motion_inventory: {
      accepted_local_clips: staleClips,
      production_motion_clips: staleClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    clips: staleClips,
    clip_count: staleClips.length,
  });
  const ownedCardPath = path.join(artifactDir, "owned-source-card.mp4");
  await fs.outputFile(ownedCardPath, Buffer.alloc(4096, 41));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    failures: [],
    records: [
      ...staleClips.map((clip) => ({
        asset_id: clip.id,
        asset_type: "motion_clip",
        kind: "video",
        path: clip.path,
        source_url: clip.source_url,
        source_type: clip.source_type,
        source_family: clip.source_family,
        source_owner: "Arknights: Endfield",
        licence_basis: clip.licence_basis,
        allowed_use: clip.allowed_use,
        allowed_platforms: clip.allowed_platforms,
        commercial_use_allowed: true,
        credit_required: true,
        evidence_reference: clip.evidence_reference,
        risk_score: clip.risk_score,
        approval_status: "approved_for_transformative_editorial_use",
        source_media_start_s: clip.mediaStartS,
        source_window_duration_s: clip.durationS,
      })),
      {
        asset_id: "owned_hyperframes_source_card",
        asset_type: "video",
        kind: "video",
        path: ownedCardPath,
        source_url: `local://hyperframes/${storyId}/source-card`,
        source_type: "selected_render_motion_clip",
        source_family: "hyperframes_source_card",
        source_owner: "Pulse Gaming",
        provider_id: "pulse_hyperframes",
        licence_basis: "owned_generated_editorial_motion_graphic",
        allowed_use: "finished_editorial_video",
        allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
        commercial_use_allowed: true,
        credit_required: false,
        evidence_reference: ownedCardPath,
        risk_score: 0,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  const currentSegments = Array.from({ length: 5 }, (_, index) => ({
    id: "segment_direct_motion_2",
    story_id: storyId,
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    validation_reason: "official_publisher_motion_samples_passed",
    source_url: `https://cdn.publisher.example/arknights/current-${index + 1}.mp4`,
    source_url_kind: "direct_video",
    source_type: "official_publisher_promotional_video",
    provider: "official_publisher",
    source_owner: "Arknights: Endfield",
    entity: "Arknights: Endfield",
    source_family: `current_run_window_${index + 1}`,
    base_source_family: `current_run_base_${index + 1}`,
    media_start_s: 10 + index * 6,
    duration_s: 5,
    source_duration_s: 90,
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: `https://publisher.example/arknights/current-${index + 1}`,
    risk_score: 0.2,
    provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "official_publisher_motion_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
      base_source_family: `current_run_base_${index + 1}`,
    },
  }));
  const workOrder = {
    jobs: [{
      story_id: storyId,
      title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
      artifact_dir: artifactDir,
      status: "ready_for_final_render_job",
      actions: [{ action_id: "run_visual_v4_production_render" }],
    }],
  };
  let materializeCall = 0;
  const runRefresh = (segments, generatedAt) => materializeGoalRealMotion({
    root,
    workOrder,
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 5,
    minFamilies: 5,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 1,
    segmentValidationReport: { segments },
    generatedAt,
    execFileSync: (_bin, args) => {
      materializeCall += 1;
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 50 + materializeCall));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `${clip.source_url}|${clip.mediaStartS}`,
  });

  const firstReport = await runRefresh(currentSegments, "2026-07-18T12:00:00.000Z");
  assert.equal(firstReport.summary.materialized_story_count, 1, JSON.stringify(firstReport.jobs[0]));
  assert.equal(firstReport.jobs[0].repair_scope, "refreshed_same_run_selected_pack");
  const firstManifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(firstManifest.clip_count, 5);
  assert.equal(new Set(firstManifest.clips.map((clip) => clip.id)).size, 5);
  assert.deepEqual(
    new Set(firstReport.jobs[0].clips.map((clip) => clip.id)),
    new Set(firstManifest.clips.map((clip) => clip.id)),
  );
  assert.ok(firstManifest.clips.every((clip) => clip.source_family.startsWith("current_run_")));
  assert.ok(firstManifest.clips.every((clip) => !clip.path.includes("stale-run-")));
  const firstIdsBySource = Object.fromEntries(
    firstManifest.clips.map((clip) => [clip.source_url, clip.id]),
  );

  const firstRights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  const firstClipIds = new Set(firstManifest.clips.map((clip) => clip.id));
  const firstMotionRecords = firstRights.records.filter(
    (record) => record.asset_type === "motion_clip",
  );
  assert.equal(firstMotionRecords.length, 5);
  assert.deepEqual(
    new Set(firstMotionRecords.map((record) => record.asset_id)),
    firstClipIds,
  );
  assert.equal(firstRights.records.some(
    (record) => record.asset_id === "owned_hyperframes_source_card",
  ), true);
  assert.equal(firstRights.used_assets.filter(
    (asset) => firstClipIds.has(asset.asset_id),
  ).length, 5);
  assert.ok(firstRights.records.every((record) => !String(record.path).includes("stale-run-")));

  const secondReport = await runRefresh(
    [...currentSegments].reverse(),
    "2026-07-18T12:05:00.000Z",
  );
  assert.equal(secondReport.summary.materialized_story_count, 1, JSON.stringify(secondReport.jobs[0]));
  const secondManifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(secondManifest.clip_count, 5);
  assert.deepEqual(
    Object.fromEntries(secondManifest.clips.map((clip) => [clip.source_url, clip.id])),
    firstIdsBySource,
  );
});

test("real motion materializer preserves exact materialised source identities during ready refresh", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-identity-"));
  const storyId = "black-flag-refresh-identity";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed IV Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const clips = [];
  for (let sourceIndex = 0; sourceIndex < 4; sourceIndex += 1) {
    for (let windowIndex = 0; windowIndex < 2; windowIndex += 1) {
      const id = `identity-source-${sourceIndex + 1}-window-${windowIndex + 1}`;
      const localPath = path.join(root, "output", "video_cache", `${id}.mp4`);
      const bytes = Buffer.alloc(4096, sourceIndex + 21);
      await fs.outputFile(localPath, bytes);
      const sourceUrl = path.join(root, "source-masters", `official-${sourceIndex + 1}.mp4`);
      await fs.outputFile(sourceUrl, Buffer.alloc(8192, sourceIndex + 31));
      clips.push({
        id,
        path: localPath,
        local_materialized_path: localPath,
        source_url: sourceUrl,
        source_family: `official-source-${sourceIndex + 1}-window-${windowIndex + 1}`,
        base_source_family: `official-source-${sourceIndex + 1}`,
        source_type: "official_trailer_video",
        media_kind: "direct_video",
        durationS: 5,
        mediaStartS: 6 + windowIndex * 8,
        source_duration_s: 60,
        rights_basis: "official_direct_media",
        ...commercialEditorialRights(sourceUrl),
        counts_towards_motion_readiness: true,
        materialized: true,
        validated: true,
        segmentValidationPassed: true,
        materialized_file_evidence: {
          schema_version: 1,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          size_bytes: bytes.length,
          duration_seconds: 5,
          video_codec: "h264",
          width: 1080,
          height: 1920,
        },
        provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "official_trailer_motion_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
          base_source_family: `official-source-${sourceIndex + 1}`,
        },
      });
    }
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    story_id: storyId,
    clips: clips.map((clip, index) => ({
      ...clip,
      canonical_source_url: `https://www.youtube.com/watch?v=Official${Math.floor(index / 2) + 1}`,
      youtube_video_id: `Official${Math.floor(index / 2) + 1}`,
      source_master_sha256: crypto
        .createHash("sha256")
        .update(`official-master-${Math.floor(index / 2) + 1}`)
        .digest("hex"),
      sampled_visual_fingerprint: `official-source-${Math.floor(index / 2) + 1}-visual-signature`,
    })),
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Finally Has A Release Date",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 8,
    minFamilies: 4,
    maxClips: 8,
    maxDirectClipsPerBaseSource: 2,
    strictBaseSourceDiversity: true,
    minBaseSources: 4,
    generatedAt: "2026-07-15T12:20:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.professional_source_diversity.observed_genuine_base_source_count, 4);
  assert.equal(materialised.professional_source_diversity.unresolved_clips.length, 0);
  for (const clip of materialised.clips) {
    assert.match(clip.source_master_sha256, /^[a-f0-9]{64}$/);
    assert.match(clip.canonical_source_url, /^https:\/\/www\.youtube\.com\/watch\?v=Official/);
    assert.match(clip.youtube_video_id, /^Official/);
    assert.match(clip.sampled_visual_fingerprint, /^official-source-/);
  }
});

test("real motion ready refresh rehydrates blocked legacy clips from adjacent yt-dlp identity sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-sidecars-"));
  const storyId = "black-flag-refresh-sidecars";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed IV Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const clips = [];
  for (let sourceIndex = 0; sourceIndex < 5; sourceIndex += 1) {
    const videoId = `OfficialBF${sourceIndex + 1}`;
    const masterPath = path.join(root, "output", "source-masters", `${videoId}.mp4`);
    await fs.outputFile(masterPath, Buffer.alloc(8192, sourceIndex + 31));
    await fs.outputJson(path.join(path.dirname(masterPath), `${videoId}.info.json`), {
      id: videoId,
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
      original_url: `https://www.youtube.com/watch?v=${videoId}`,
      extractor_key: "Youtube",
      extractor: "youtube",
      uploader: "Assassin's Creed",
      channel: "Assassin's Creed",
      title: `Black Flag Resynced Official Trailer ${sourceIndex + 1}`,
    });
    const id = `legacy-source-${sourceIndex + 1}`;
    const localPath = path.join(root, "output", "video_cache", `${id}.mp4`);
    const bytes = Buffer.alloc(4096, sourceIndex + 51);
    await fs.outputFile(localPath, bytes);
    clips.push({
      id,
      path: localPath,
      local_materialized_path: localPath,
      source_url: masterPath,
      source_family: `legacy-source-${sourceIndex + 1}-window-1`,
      source_type: "official_trailer_video",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: 5 + sourceIndex * 7,
      source_duration_s: 60,
      rights_basis: "official_direct_media",
      ...commercialEditorialRights(masterPath),
      counts_towards_motion_readiness: true,
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      sampled_visual_fingerprint: `legacy-source-${sourceIndex + 1}-fingerprint`,
      materialized_file_evidence: {
        schema_version: 1,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        size_bytes: bytes.length,
        duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_trailer_motion_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "blocked",
    ready: false,
    motion_ready: false,
    blockers: ["professional_motion_source_identity_unresolved"],
    story_id: storyId,
    clips,
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Finally Has A Release Date",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    strictBaseSourceDiversity: true,
    minBaseSources: 5,
    generatedAt: "2026-07-15T13:20:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.professional_source_diversity.observed_genuine_base_source_count, 5);
  assert.equal(materialised.professional_source_diversity.unresolved_clips.length, 0);
  assert.ok(materialised.clips.every((clip) => clip.motion_source_identity?.status === "resolved"));
  assert.ok(materialised.clips.every(
    (clip) => clip.source_identity_provenance?.kind === "yt_dlp_info_sidecar",
  ));
});

test("real motion materializer applies an exact refresh plan with independent derivative evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-derivative-evidence-"));
  const storyId = "black-flag-refresh-derivative-evidence";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed IV Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const clips = [];
  for (let sourceIndex = 0; sourceIndex < 5; sourceIndex += 1) {
    const masterPath = `https://cdn.publisher.example/black-flag/official-${sourceIndex + 1}.mp4`;
    for (let windowIndex = 0; windowIndex < 1; windowIndex += 1) {
      const id = `refresh-source-${sourceIndex + 1}-window-${windowIndex + 1}`;
      const localPath = path.join(root, "output", "video_cache", `${id}.mp4`);
      const bytes = Buffer.alloc(4096, sourceIndex + windowIndex + 51);
      await fs.outputFile(localPath, bytes);
      clips.push({
        id,
        path: localPath,
        local_materialized_path: localPath,
        source_url: masterPath,
        source_family: `refresh-source-${sourceIndex + 1}-window-${windowIndex + 1}`,
        base_source_family: `refresh-source-${sourceIndex + 1}`,
        source_type: "official_trailer_video",
        media_kind: "direct_video",
        durationS: 5,
        mediaStartS: 5 + windowIndex * 8,
        source_duration_s: 80,
        rights_basis: "official_direct_media",
        ...commercialEditorialRights(masterPath),
        counts_towards_motion_readiness: true,
        materialized: true,
        validated: true,
        segmentValidationPassed: true,
        asset_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        asset_size_bytes: bytes.length,
        probed_duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
        materialized_file_evidence: {
          schema_version: 1,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          size_bytes: bytes.length,
          duration_seconds: 5,
          video_codec: "h264",
          width: 1080,
          height: 1920,
        },
        provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "official_trailer_motion_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
          base_source_family: `refresh-source-${sourceIndex + 1}`,
          source_duration_s: 80,
        },
      });
    }
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Finally Has A Release Date",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 6,
    minFamilies: 5,
    maxClips: 6,
    maxDirectClipsPerBaseSource: 2,
    excludedClipIds: ["refresh-source-5-window-1"],
    refreshWindowPlan: {
      story_id: storyId,
      windows: [
        {
          id: "approved-source-5-window-24",
          source_clip_id: "refresh-source-5-window-1",
          source_family: "approved-source-5-window-24-5",
          media_start_s: 24,
          duration_s: 5,
          source_crop_top_px: 40,
          source_crop_bottom_px: 80,
        },
        {
          id: "approved-source-1-window-24",
          source_clip_id: "refresh-source-1-window-1",
          source_family: "approved-source-1-window-24-5",
          media_start_s: 24,
          duration_s: 5,
        },
      ],
    },
    generatedAt: "2026-07-15T12:25:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(8192, 61));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.jobs[0].materialized_count, 6);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clips.some((clip) => clip.id === "refresh-source-5-window-1"), false);
  const supplemental = materialised.clips.filter((clip) => /^approved-source-/.test(clip.id));
  assert.equal(supplemental.length, 2);
  for (const clip of supplemental) {
    assert.equal(clip.asset_size_bytes, 8192);
    assert.equal(clip.materialized_file_evidence.size_bytes, 8192);
    assert.equal(clip.asset_sha256, clip.materialized_file_evidence.sha256);
  }
  assert.equal(
    supplemental.find((clip) => clip.id === "approved-source-5-window-24")
      .source_crop_bottom_px,
    80,
  );
  assert.equal(
    supplemental.find((clip) => clip.id === "approved-source-5-window-24")
      .source_crop_top_px,
    40,
  );
  assert.deepEqual(
    supplemental.map((clip) => clip.mediaStartS).sort((a, b) => a - b),
    [24, 24],
  );
});

test("real motion materializer accepts segment-validated official Steam motion-pack clips", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [
        {
          id: "hades-official-steam-hls",
          type: "motion_clip",
          source_family: "steam_1145350_695850",
          path: "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703",
          source_kind: "hls_manifest",
          source_url_kind: "hls_manifest",
          source_type: "steam_movie",
          provider: "steam",
          entity: "Hades II",
          mediaStartS: 54,
          durationS: 5,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
        },
        {
          id: "unsafe-watch-page",
          path: "https://store.steampowered.com/app/1145350/Hades_II/",
          source_type: "steam_page",
          segmentValidationPassed: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "hades-official-steam-hls");
  assert.equal(rows[0].source_type, "steam_movie");
  assert.equal(rows[0].source_family, "steam_1145350_695850");
});

test("real motion materializer keeps segment-validated direct clips from blocked partial motion packs", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: {
        status: "v4_motion_blocked",
        blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
      },
      clips: [
        {
          id: "subnautica-official-steam-window",
          type: "motion_clip",
          source_family: "steam_1962700_1381761660",
          path: "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818",
          source_kind: "hls_manifest",
          source_url_kind: "hls_manifest",
          source_type: "steam_movie",
          entity: "Subnautica 2",
          mediaStartS: 58.95,
          durationS: 2.85,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
        },
        {
          id: "unsafe-store-page",
          path: "https://store.steampowered.com/app/1962700/Subnautica_2/",
          source_type: "steam_page",
          validated: true,
          segmentValidationPassed: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "subnautica-official-steam-window");
  assert.equal(rows[0].media_kind, "direct_video");
});

test("real motion materializer accepts segment-validated official direct-media intake clips", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [
        {
          id: "forza-official-x-window",
          type: "motion_clip",
          source_family: "forza_horizon_official_x_fh6_coast_video",
          path: "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          source_url: "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          source_kind: "direct_video",
          source_url_kind: "direct_video",
          source_type: "licensed_direct_media_url",
          entity: "Forza Horizon 6",
          mediaStartS: 10.28,
          durationS: 5,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
          provenance: {
            source: "visual_v4_motion_pack",
            source_report: "official_trailer_segment_validation",
            validation_reason: "short_direct_media_detail_motion_samples_passed",
          },
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "forza-official-x-window");
  assert.equal(rows[0].media_kind, "direct_video");
  assert.equal(rows[0].mediaStartS, 10.28);
});

test("real motion materializer does not materialize validated segment rows from another story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-story-scope-"));
  const storyId = "target-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: "different-story",
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: sourceUrl,
      source_url_kind: "hls_manifest",
      source_type: "licensed_direct_media_url",
      provider: "official_intake",
      source_family: `other_story_family_${index + 1}`,
      entity: "Other Game",
      media_start_s: index * 5,
      duration_s: 5,
      source_duration_s: 90,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-06-12T02:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].story_id, storyId);
  assert.deepEqual(report.jobs[0].blockers, [
    "validated_direct_media_candidates_missing",
    "real_motion_clip_minimum_not_met",
    "real_motion_family_minimum_not_met",
  ]);
  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
});

test("real motion materializer hydrates ready V4 motion packs into local direct-video clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-pack-"));
  const storyId = "hades-motion-pack";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1962700/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_1962700_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `hades-steam-hls-${index + 1}`,
    type: "motion_clip",
    source_family: `steam_1145350_${index + 1}`,
    path: `https://video.akamai.steamstatic.com/store_trailers/1145350/${index + 1}/hash/hls_264_master.m3u8?t=171502170${index}`,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/1145350/${index + 1}/hash/hls_264_master.m3u8?t=171502170${index}`,
    source_kind: "hls_manifest",
    source_url_kind: "hls_manifest",
    source_type: "steam_movie",
    provider: "steam",
    entity: "Hades II",
    mediaStartS: 12 + index,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: false,
    rights_risk_class: "official_reference_only",
    ...commercialEditorialRights(
      `https://video.akamai.steamstatic.com/store_trailers/1145350/${index + 1}/hash/hls_264_master.m3u8?t=171502170${index}`,
    ),
  }));
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-23T16:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.args[call.args.indexOf("-i") + 1].includes("video.akamai.steamstatic.com")));

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.media_kind === "direct_video"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.production_motion_clips.length, 5);
  assert.ok(footage.motion_inventory.production_motion_clips.every((clip) => clip.source_type === "steam_movie"));

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.source_url.includes("video.akamai.steamstatic.com")));
});

test("real motion materializer restores package evidence from an already materialized central motion pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-central-restore-"));
  const storyId = "sf6-central-restore";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/164062000/hash/hls_264_master.m3u8?t=1782095041";
  const clips = Array.from({ length: 6 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-clip-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `sf6-window-${index + 1}`,
      type: "motion_clip",
      source_family: `steam_1364780_164062000_window_${index + 1}`,
      motion_family: `steam_1364780_164062000_window_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrl,
      source_kind: "hls_manifest",
      source_url_kind: "hls_manifest",
      source_type: "steam_movie",
      provider: "steam",
      entity: "Street Fighter 6",
      mediaStartS: 36 + index * 3,
      durationS: 3,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      trusted_source_matched: false,
      rights_basis: "official_direct_media",
      rights_risk_class: "official_reference_only",
      ...commercialEditorialRights(sourceUrl),
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_storefront_trailer_motion_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    source: "validated_real_motion_materializer",
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Street Fighter 6 Yasmine Gameplay Reveal",
        artifact_dir: artifactDir,
        status: "blocked_on_render_inputs",
        blockers: ["materialised_motion_clips_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-06-23T18:20:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 6);
  assert.equal(report.jobs[0].repair_scope, "central_materialized_motion_restore");
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.clips.every((clip) => clip.media_kind === "direct_video"), true);
  for (const [index, clip] of materialised.clips.entries()) {
    const expectedSha256 = crypto
      .createHash("sha256")
      .update(Buffer.alloc(4096, index + 1))
      .digest("hex");
    assert.equal(clip.materialized_file_evidence?.sha256, expectedSha256);
    assert.equal(clip.materialized_file_evidence?.size_bytes, 4096);
    assert.equal(clip.materialized_file_evidence?.duration_seconds, 3);
    assert.equal(clip.materialized_file_evidence?.video_codec, "h264");
    assert.equal(clip.materialized_file_evidence?.width, 1080);
    assert.equal(clip.materialized_file_evidence?.height, 1920);
    assert.equal(clip.source_url, sourceUrl);
    assert.equal(
      clip.base_source_family,
      "steamstatic:/store_trailers/1364780/164062000/hash",
    );
    assert.equal(clip.mediaStartS, 36 + index * 3);
    assert.equal(clip.durationS, 3);
    assert.equal(clip.source_media_start_s, 36 + index * 3);
    assert.equal(clip.source_window_duration_s, 3);
    assert.equal(clip.provenance?.source, "official_trailer_segment_validation");
    assert.equal(clip.provenance?.segment_validated, true);
    assert.equal(clip.provenance?.allowed_for_flash_lane, true);
  }
  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.status, "ready");
  assert.equal(familyReport.summary.clip_count, 6);
});

test("real motion materializer restores package evidence from a strict governed selector after central invalidation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-selector-restore-"));
  const storyId = "black-flag-selector-restore";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(path.join(artifactDir, "qa", "direct-motion"));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "blocked",
    clips: [],
    blockers: ["stale_ready_central_motion_pack_unvalidated"],
  });

  const policyPath = path.join(root, "rights", "publisher-video-policy.html");
  const policyBytes = Buffer.from("Official publisher video policy evidence");
  await fs.outputFile(policyPath, policyBytes);
  const policySha256 = crypto.createHash("sha256").update(policyBytes).digest("hex");
  const clips = [];
  for (let index = 0; index < 6; index += 1) {
    clips.push({
      ...await makeGovernedSelectorClip(root, storyId, index),
      evidence_reference: "",
      evidence_file: policyPath,
      rights_evidence_file: policyPath,
      evidence_sha256: policySha256,
      rights_evidence_sha256: policySha256,
      evidence_size_bytes: policyBytes.length,
      rights_evidence_size_bytes: policyBytes.length,
      rights_grant: true,
    });
  }
  await fs.outputJson(
    path.join(artifactDir, "qa", "direct-motion", "final_selection_dense_selector_report.json"),
    {
      version: "pulse_direct_motion_visual_selector_v5",
      policy_tier: "ultimate_professional",
      blockers: [],
      selected_clip_count: clips.length,
      clips,
      source_diversity: {
        strict_pass: true,
        reasons: [],
        blockers: [],
      },
      professional_source_diversity: {
        status: "pass",
        strict_pass: true,
        blockers: [],
      },
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Crosses Three Million Sales",
        artifact_dir: artifactDir,
        status: "blocked_on_render_inputs",
        blockers: ["materialised_motion_clips_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-19T20:20:00.000Z",
    minClips: 6,
    minFamilies: 6,
    maxClips: 6,
    minBaseSources: 6,
    strictBaseSourceDiversity: true,
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.materialized_clip_count, 6);
  assert.equal(report.jobs[0].repair_scope, "selector_materialized_motion_restore");
  assert.equal(report.jobs[0].recovered_selector_clip_count, 6);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.distinct_motion_family_count, 6);
  assert.equal(
    materialised.professional_source_diversity.observed_genuine_base_source_count,
    6,
  );
  assert.ok(
    materialised.clips.every((clip) => clip.motion_source_identity?.strict_pass === true),
  );
});

test("real motion materializer rejects stale immutable evidence on restored clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-stale-restore-evidence-"));
  const storyId = "stale-restore-evidence";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    const staleEvidence = {
      schema_version: 1,
      captured_at: "2026-07-14T23:00:00.000Z",
      sha256: "0".repeat(64),
      size_bytes: 999,
      duration_seconds: 4.5,
      video_codec: "vp9",
      width: 720,
      height: 1280,
    };
    return {
      id: `${storyId}-${index + 1}`,
      source_family: `official_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/official-${index + 1}.mp4`,
      source_type: "official_trailer",
      mediaStartS: index * 5,
      durationS: 5,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      ...(index === 0
        ? {
            asset_sha256: staleEvidence.sha256,
            asset_size_bytes: staleEvidence.size_bytes,
            probed_duration_seconds: staleEvidence.duration_seconds,
            video_codec: staleEvidence.video_codec,
            width: staleEvidence.width,
            height: staleEvidence.height,
          }
        : { materialized_file_evidence: staleEvidence }),
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips,
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-15T04:00:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_mismatch"));
  assert.equal(
    report.jobs[0].failed[0].error,
    "materialized_clip_evidence_mismatch:sha256,size_bytes",
  );
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.not_publishable, true);
});

test("real motion materializer does not let empty nested evidence suppress stale top-level evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-empty-nested-evidence-"));
  const storyId = "empty-nested-evidence";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `${storyId}-${index + 1}`,
      source_family: `official_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/official-${index + 1}.mp4`,
      source_type: "official_trailer",
      mediaStartS: index * 5,
      durationS: 5,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      ...(index === 0
        ? {
            materialized_file_evidence: {},
            asset_sha256: "0".repeat(64),
            asset_size_bytes: 999,
            probed_duration_seconds: 4.5,
            video_codec: "vp9",
            width: 720,
            height: 1280,
          }
        : {}),
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips,
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-15T05:40:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_mismatch"));
  assert.match(report.jobs[0].failed[0].error, /sha256/);
});

test("real motion materializer rejects conflicting nested and top-level immutable evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-conflicting-evidence-"));
  const storyId = "conflicting-evidence";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const payload = Buffer.alloc(4096, index + 1);
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, payload);
    return {
      id: `${storyId}-${index + 1}`,
      source_family: `official_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/official-${index + 1}.mp4`,
      source_type: "official_trailer",
      mediaStartS: index * 5,
      durationS: 5,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      materialized_file_evidence: {
        sha256: crypto.createHash("sha256").update(payload).digest("hex"),
        size_bytes: payload.length,
        duration_seconds: 5,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
      ...(index === 0 ? { asset_sha256: "0".repeat(64) } : {}),
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips,
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-15T05:42:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_mismatch"));
  assert.match(report.jobs[0].failed[0].error, /nested_top_level:sha256/);
});

test("real motion materializer invalidates a restored ready pack when same-run probing fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-restore-probe-fail-"));
  const storyId = "restore-probe-fail";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `${storyId}-${index + 1}`,
      source_family: `official_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/official-${index + 1}.mp4`,
      source_type: "official_trailer",
      mediaStartS: index * 5,
      durationS: 5,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips,
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["materialised_motion_clips_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-15T03:30:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
    materializedClipProbe: () => {
      throw new Error("probe_failed");
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.deepEqual(report.jobs[0].blockers, ["materialized_clip_evidence_unavailable"]);
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.not_publishable, true);
  assert.deepEqual(manifest.blockers, ["materialized_clip_evidence_unavailable"]);
});

test("real motion materializer blocks visually duplicated clips restored from a ready central pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-central-visual-dedupe-"));
  const storyId = "central-visual-dedupe";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `central-clip-${index + 1}`,
      type: "motion_clip",
      source_family: `central_family_${index + 1}`,
      motion_family: `central_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/100/200/hash-${index + 1}/hls_264_master.m3u8`,
      source_kind: "hls_manifest",
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: index * 6,
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      trusted_source_matched: false,
      rights_basis: "official_direct_media",
      provenance: {
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    source: "validated_real_motion_materializer",
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    clips,
    clip_count: clips.length,
  });
  await fs.outputJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    families: clips.map((clip) => clip.source_family),
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["materialised_motion_clips_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-07-14T18:45:00.000Z",
    clipVisualFingerprint: async (clip) =>
      ["central-clip-1", "central-clip-2"].includes(clip.id) ? "same-content" : clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].skipped_visual_duplicate_count, 1);
  assert.ok(report.jobs[0].blockers.includes("visual_motion_duplicate_content_detected"));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.not_publishable, true);
  assert.equal(materialised.clip_count, 4);
  assert.ok(materialised.blockers.includes("visual_motion_duplicate_content_detected"));
  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.status, "blocked");
});

test("real motion materializer audits and demotes an artifact-only stale ready manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-artifact-only-audit-"));
  const storyId = "artifact-only-visual-dedupe";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  const clips = Array.from({ length: 5 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `artifact-clip-${index + 1}`,
      source_family: `artifact_family_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://vulcan.dl.playstation.net/img/rnd/202607/clip-${index + 1}.mp4`,
      source_type: "official_game_site_news_page",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: index * 6,
      materialized: true,
      counts_towards_motion_readiness: true,
    };
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    clips,
    clip_count: clips.length,
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    generatedAt: "2026-07-14T19:00:00.000Z",
    clipVisualFingerprint: async (clip) =>
      ["artifact-clip-1", "artifact-clip-2"].includes(clip.id) ? "same-content" : clip.id,
  });

  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].skipped_visual_duplicate_count, 1);
  assert.ok(report.jobs[0].blockers.includes("visual_motion_duplicate_content_detected"));
  assert.equal(report.jobs[0].stale_ready_evidence_invalidated, true);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.clip_count, 4);
});

test("real motion materializer blocks one official trailer from masquerading as many direct-video windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-window-floor-"));
  const storyId = "subnautica-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818";
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [
      {
        id: "subnautica-official-steam-window",
        type: "motion_clip",
        source_family: "steam_1962700_1381761660",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "steam_movie",
        provider: "steam",
        entity: "Subnautica 2",
        mediaStartS: 0,
        durationS: 3,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1962700/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_1962700_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          title: "Subnautica 2 Reportedly Leaked Early",
          artifact_dir: artifactDir,
          status: "blocked_on_render_inputs",
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: {
                direct_video_motion_clip_floor: 5,
              },
            },
          ],
        },
      ],
    },
    minClips: 5,
    generatedAt: "2026-05-29T02:05:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.map((call) => call.args[call.args.indexOf("-ss") + 1]), [
    "0",
  ]);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));

  const blockedManifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);
  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.direct_video_motion_asset_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.equal(partial.clips[0].counts_towards_motion_readiness, false);
});

test("real motion materializer fills five-clip floors with balanced non-overlapping official windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-multi-source-windows-"));
  const storyId = "multi-official-window-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://video.fastly.steamstatic.com/store_trailers/100/111/hash-a/hls_264_master.m3u8?t=1780000001",
    "https://video.fastly.steamstatic.com/store_trailers/100/222/hash-b/hls_264_master.m3u8?t=1780000002",
    "https://video.fastly.steamstatic.com/store_trailers/100/333/hash-c/hls_264_master.m3u8?t=1780000003",
  ];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "licensed_direct_media_acquisition",
        entity: "GTA VI",
        source_family: `gta_vi_official_source_${sourceIndex + 1}`,
        media_start_s: 12 + sourceIndex * 18 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
              evidence: { direct_video_motion_clip_floor: 5 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 5,
    maxClips: 5,
    generatedAt: "2026-06-26T02:10:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].materialized_count, 5);
  assert.equal(report.jobs[0].distinct_motion_family_count, 5);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 5);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 2);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [2, 2, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 0);
  assert.equal(calls.length, 5);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.direct_video_motion_family_count, 5);
  assert.equal(new Set(materialised.clips.map((clip) => clip.base_source_family)).size, 3);
  const windowKeys = new Set(
    materialised.clips.map((clip) =>
      `${clip.source_url}|${Number(clip.mediaStartS || 0).toFixed(2)}|${Number(clip.durationS || 0).toFixed(2)}`,
    ),
  );
  assert.equal(windowKeys.size, 5);
});

test("real motion materializer skips overlapping windows and continues to the next distinct beat", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-overlap-skip-"));
  const storyId = "overlap-skip-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sources = [
    {
      sourceUrl:
        "https://video.fastly.steamstatic.com/store_trailers/200/111/hash-a/hls_264_master.m3u8",
      starts: [10, 12.5, 18],
    },
    {
      sourceUrl:
        "https://video.fastly.steamstatic.com/store_trailers/200/222/hash-b/hls_264_master.m3u8",
      starts: [30, 36],
    },
    {
      sourceUrl:
        "https://video.fastly.steamstatic.com/store_trailers/200/333/hash-c/hls_264_master.m3u8",
      starts: [50, 56],
    },
  ];
  const segmentValidationReport = {
    segments: sources.flatMap(({ sourceUrl, starts }, sourceIndex) =>
      starts.map((start, windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 90 - windowIndex,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "licensed_direct_media_acquisition",
        entity: "Distinct Beat Game",
        source_family: `official_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: start,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };
  let renderCount = 0;

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
          evidence: { direct_video_motion_clip_floor: 5 },
        }],
      }],
    },
    segmentValidationReport,
    minClips: 5,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 3,
    generatedAt: "2026-07-17T20:55:00.000Z",
    execFileSync: (_bin, args) => {
      renderCount += 1;
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, renderCount));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.jobs[0].materialized_count, 5);
  assert.equal(report.jobs[0].skipped_duplicate_direct_window_count, 1);
  assert.ok(
    report.jobs[0].skipped_duplicate_direct_windows.some(
      (row) => row.reason === "source_window_overlaps_selected_window",
    ),
  );
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const selectedFromFirstSource = manifest.clips
    .filter((clip) => clip.base_source_family.includes("/200/111/"))
    .map((clip) => Number(clip.mediaStartS))
    .sort((a, b) => a - b);
  assert.deepEqual(selectedFromFirstSource, [10]);
  assert.ok(!manifest.clips.some((clip) => Number(clip.mediaStartS) === 12.5));
});

test("real motion rematerialization removes a superseded overlapping prior-run window from every authoritative surface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-overlap-rematerialize-"));
  const storyId = "overlap-rematerialize-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const priorClips = [];
  const canonicalYouTubeId = "OfficialShared123";
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `prior-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 1));
    const sharedSource = index === 0;
    priorClips.push({
      id: sharedSource ? "superseded-prior-window" : `governed-prior-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sharedSource
        ? `https://www.youtube.com/watch?v=${canonicalYouTubeId}`
        : `https://official.example.com/trailer-${index + 1}.mp4`,
      canonical_source_url: sharedSource
        ? `https://www.youtube.com/watch?v=${canonicalYouTubeId}`
        : `https://official.example.com/trailer-${index + 1}.mp4`,
      youtube_video_id: sharedSource ? canonicalYouTubeId : `DistinctOfficial${index + 1}`,
      source_family: sharedSource ? "old_shared_window_label" : `governed_prior_family_${index + 1}`,
      base_source_family: sharedSource
        ? `youtube:${canonicalYouTubeId}`
        : `youtube:DistinctOfficial${index + 1}`,
      motion_family: sharedSource ? "old_shared_window_label" : `governed_prior_family_${index + 1}`,
      source_type: "official_publisher_promotional_video",
      media_kind: "direct_video",
      mediaStartS: sharedSource ? 10.5 : 20 + index * 6,
      durationS: sharedSource ? 3 : 5,
      materialized: true,
      counts_towards_motion_readiness: true,
      rights_basis: "official_reference_only",
      licence_basis: "official_reference_only",
      allowed_use: "transformative_editorial_short_form",
      commercial_use_allowed: true,
      ...commercialEditorialRights(
        sharedSource
          ? `https://www.youtube.com/watch?v=${canonicalYouTubeId}`
          : `https://official.example.com/trailer-${index + 1}.mp4`,
      ),
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "gameplay_action_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    readiness: {
      status: "blocked",
      blockers: ["real_motion_clip_minimum_not_met"],
    },
    motion_inventory: {
      accepted_local_clips: priorClips,
      production_motion_clips: priorClips,
      distinct_source_families: priorClips.map((clip) => clip.base_source_family),
    },
  });

  const currentSourcePath = path.join(root, "output", "source-sections", "current-shared.mp4");
  await fs.outputFile(currentSourcePath, Buffer.alloc(8192, 29));
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["real_motion_clip_minimum_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["real_motion_clip_minimum_not_met"],
        }],
      }],
    },
    segmentValidationReport: {
      segments: [{
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "gameplay_action_samples_passed",
        segment_motion_class: "gameplay_action",
        source_url: currentSourcePath,
        canonical_source_url: `https://www.youtube.com/watch?v=${canonicalYouTubeId}`,
        youtube_video_id: canonicalYouTubeId,
        source_type: "official_publisher_promotional_video",
        source_url_kind: "local_video_file",
        provider: "youtube",
        entity: "Overlap Rematerialize Game",
        source_family: "current_shared_window_label",
        media_start_s: 8.15,
        duration_s: 2.85,
        source_duration_s: 90,
        rights_risk_class: "official_publisher_promotional_video",
        allowed_render_use: "transformative_editorial_short_form",
        ...commercialEditorialRights(
          `https://www.youtube.com/watch?v=${canonicalYouTubeId}`,
        ),
      }],
    },
    generatedAt: "2026-07-17T21:10:00.000Z",
    minClips: 5,
    minFamilies: 4,
    maxClips: 1,
    maxDirectClipsPerBaseSource: 2,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 19));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.jobs[0].repair_scope, "incremental_motion_completion");
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].total_motion_clip_count, 5);

  const surfaces = [
    (await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"))).clips,
    (await fs.readJson(path.join(artifactDir, "footage_inventory.json")))
      .motion_inventory.production_motion_clips,
    (await fs.readJson(path.join(artifactDir, "owned_motion_manifest.json"))).materialised_clips,
    (await fs.readJson(path.join(
      root,
      "output",
      "studio-v4",
      "motion-packs",
      `${storyId}_motion_pack_manifest.json`,
    ))).clips,
  ];
  for (const clips of surfaces) {
    assert.equal(clips.length, 5);
    assert.equal(clips.some((clip) => clip.id === "superseded-prior-window"), false);
    const replacement = clips.find((clip) =>
      clip.youtube_video_id === canonicalYouTubeId ||
      clip.base_source_family === `youtube:${canonicalYouTubeId}`);
    assert.ok(replacement);
    assert.equal(Number(replacement.mediaStartS ?? replacement.media_start_s), 8.15);
    assert.equal(Number(replacement.durationS ?? replacement.duration_s), 2.85);
  }
  const familyReport = await fs.readJson(
    path.join(artifactDir, "distinct_motion_family_report.json"),
  );
  assert.equal(familyReport.summary.clip_count, 5);
});

test("real motion materializer honours explicit direct base-source clip cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-explicit-base-cap-"));
  const storyId = "explicit-base-cap-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://video.fastly.steamstatic.com/store_trailers/100/111/hash-a/hls_264_master.m3u8?t=1780000001",
    "https://video.fastly.steamstatic.com/store_trailers/100/222/hash-b/hls_264_master.m3u8?t=1780000002",
    "https://video.fastly.steamstatic.com/store_trailers/100/333/hash-c/hls_264_master.m3u8?t=1780000003",
    "https://video.fastly.steamstatic.com/store_trailers/100/444/hash-d/hls_264_master.m3u8?t=1780000004",
    "https://video.fastly.steamstatic.com/store_trailers/100/555/hash-e/hls_264_master.m3u8?t=1780000005",
  ];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "licensed_direct_media_acquisition",
        entity: "The Crew Motorfest",
        source_family: `crew_official_source_${sourceIndex + 1}`,
        media_start_s: 12 + sourceIndex * 18 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_motion_repeat_repair_required"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_motion_repeat_repair_required"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 5,
    minFamilies: 4,
    maxClips: 10,
    maxDirectClipsPerBaseSource: 1,
    generatedAt: "2026-07-07T15:20:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].materialized_count, 5);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 5);
  assert.equal(calls.length, 5);
});

test("real motion materializer can use a third official Steam window when needed for duration floor", () => {
  const sourceUrls = [
    "https://video.fastly.steamstatic.com/store_trailers/1623730/1468980435/a9fa/hls_264_master.m3u8?t=1765946111",
    "https://video.fastly.steamstatic.com/store_trailers/1623730/1650163623/c275/hls_264_master.m3u8?t=1765946112",
    "https://video.fastly.steamstatic.com/store_trailers/1623730/768837/5e54/hls_264_master.m3u8?t=1728458616",
    "https://video.fastly.steamstatic.com/store_trailers/1623730/1835768144/fe4d/hls_264_master.m3u8?t=1780701306",
  ];
  const candidates = sourceUrls.flatMap((sourceUrl, sourceIndex) => {
    const windows = sourceIndex === 1 ? [36, 42, 48] : [36, 48];
    return windows.map((start) => ({
      id: `steam-window-${sourceIndex}-${start}`,
      media_kind: "direct_video",
      source_url: sourceUrl,
      source_family: `palworld_steam_${sourceIndex}_${start}`,
      source_type: "official_platform_product_page",
      source_url_kind: "hls_manifest",
      mediaStartS: start,
      durationS: 5,
      segmentValidationPassed: true,
      trusted_source_matched: true,
    }));
  });

  assert.equal(
    dynamicMaxDirectClipsPerBaseSource(candidates, {
      minClips: 6,
      minFamilies: 5,
      maxClips: 10,
    }),
    3,
  );
  assert.equal(
    dynamicMaxDirectClipsPerBaseSource(candidates, {
      minClips: 6,
      minFamilies: 5,
      maxClips: 10,
      explicitMax: 2,
    }),
    2,
  );
});

test("real motion materializer treats Steam extras mp4 and webm encodes as one base source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-steam-extra-encodes-"));
  const storyId = "age-of-empires-mobile-extra-encode";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const steamExtra =
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2783360/extras/eae21c9cf6b089af182287247493f59d";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => {
      const extension = index % 2 === 0 ? "webm" : "mp4";
      return {
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: `${steamExtra}.${extension}?t=1782262815`,
        source_type: "official_game_site_news_page",
        source_url_kind: "direct_video",
        provider: "licensed_direct_media_acquisition",
        entity: "Age of Empires Mobile",
        source_family: `age_of_empires_mobile_extra_${extension}_${index + 1}`,
        media_start_s: 2.58 + index,
        duration_s: 5,
        source_duration_s: 12,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
      };
    }),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    generatedAt: "2026-06-28T22:15:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.equal(calls.length, 1);

  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.match(
    partial.clips[0].base_source_family,
    /^steamstatic:\/store_item_assets\/steam\/apps\/2783360\/extras\/eae21c9cf6b089af182287247493f59d$/,
  );
});

test("real motion materializer blocks eight-clip floors when only three official base sources exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-eight-official-windows-"));
  const storyId = "gta-vi-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  ];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1, 2, 3].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_game_website_media_page",
        source_url_kind: "direct_video",
        provider: "licensed_direct_media_acquisition",
        entity: "Grand Theft Auto VI",
        source_family: `rockstar_gtavi_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 20 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 160,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 8 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 8,
    maxClips: 8,
    generatedAt: "2026-06-26T02:30:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 3);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 9);
  assert.equal(report.jobs[0].skipped_duplicate_direct_window_count, 0);
  assert.equal(calls.length, 3);
});

test("real motion materializer fills eight-clip floors from enough official base sources without overusing one source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-balanced-official-windows-"));
  const storyId = "marvel-tokon-balanced-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = Array.from({ length: 5 }, (_, sourceIndex) =>
    `https://video.fastly.steamstatic.com/store_trailers/3787240/${sourceIndex + 100}/hash_${sourceIndex}/hls_264_master.m3u8?t=177000000${sourceIndex}`,
  );
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 91,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "steam",
        entity: "MARVEL Tokon",
        source_family: `steam_marvel_tokon_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 14 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 130,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 8 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 8,
    minFamilies: 5,
    maxClips: 8,
    generatedAt: "2026-06-27T16:45:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].materialized_count, 8);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 8);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 8);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 2);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [2, 2, 2, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 0);
  assert.equal(calls.length, 8);
});

test("real motion materializer fills long-narration floors with balanced third official windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-long-official-windows-"));
  const storyId = "marvel-tokon-long-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = Array.from({ length: 5 }, (_, sourceIndex) =>
    `https://video.fastly.steamstatic.com/store_trailers/3787240/${sourceIndex + 200}/hash_${sourceIndex}/hls_264_master.m3u8?t=178000000${sourceIndex}`,
  );
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1, 2].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 91,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "steam",
        entity: "MARVEL Tokon",
        source_family: `steam_marvel_tokon_long_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 18 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 160,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
        ...commercialEditorialRights(sourceUrl),
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 12 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 12,
    minFamilies: 5,
    maxClips: 12,
    generatedAt: "2026-06-27T17:30:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].materialized_count, 12);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 12);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 12);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 3);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [3, 3, 2, 2, 2],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 0);
  assert.equal(calls.length, 12);
});

test("real motion materializer blocks uneven official-window sets instead of overusing one source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-uneven-official-windows-"));
  const storyId = "gta-vi-uneven-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  ];
  const windowsBySource = [3, 8, 1];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      Array.from({ length: windowsBySource[sourceIndex] }, (_, windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_game_website_media_page",
        source_url_kind: "direct_video",
        provider: "licensed_direct_media_acquisition",
        entity: "Grand Theft Auto VI",
        source_family: `rockstar_gtavi_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 20 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 170,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["real_motion_clip_minimum_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["real_motion_clip_minimum_not_met"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 8,
    maxClips: 8,
    generatedAt: "2026-06-26T02:55:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 9);
  assert.equal(calls.length, 3);
});

test("real motion materializer samples before a late official trailer window when forward windows fail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-late-window-"));
  const storyId = "late-official-trailer-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2075800/876175/hash/hls_264_master.m3u8?t=1745411378";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "late-steam-trailer-window",
        type: "motion_clip",
        source_family: "steam_2075800_876175",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "steam_movie",
        provider: "steam",
        entity: "Star Wars Zero Company",
        mediaStartS: 120,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2075800/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_2075800_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          status: "blocked_on_render_inputs",
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 5 },
            },
          ],
        },
      ],
    },
    minClips: 5,
    maxClips: 8,
    generatedAt: "2026-05-29T02:20:00.000Z",
    execFileSync: (bin, args) => {
      const start = Number(args[args.indexOf("-ss") + 1]);
      starts.push(start);
      if (start > 131) return;
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, Math.max(1, Math.round(start))));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
  assert.deepEqual(starts, [120]);
});

test("real motion materializer includes pending original direct candidates while expanding the direct-video floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-pending-original-"));
  const storyId = "pending-original-direct-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/4078430/1546933311/hash/hls_264_master.m3u8";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "official-window-a",
        type: "motion_clip",
        source_family: "steam_4078430_1546933311",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "igdb_video",
        provider: "steam",
        mediaStartS: 42,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        id: "official-window-b",
        type: "motion_clip",
        source_family: "steam_4078430_1546933311",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "igdb_video",
        provider: "steam",
        mediaStartS: 52,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4078430/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_4078430_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        materialized: true,
      })),
    },
  });

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["direct_video_motion_clip_floor_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["direct_video_motion_clip_floor_not_met"],
          evidence: { direct_video_motion_clip_floor: 5 },
        }],
      }],
    },
    minClips: 5,
    generatedAt: "2026-05-29T02:45:00.000Z",
    execFileSync: (bin, args) => {
      const start = Number(args[args.indexOf("-ss") + 1]);
      starts.push(start);
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, Math.max(1, Math.round(start))));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
  assert.deepEqual(starts, [42]);
});

test("real motion materializer expands official product-page direct MP4 windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-product-page-"));
  const storyId = "official-product-page-direct-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl = "https://assets.xboxservices.com/assets/example-controller-product-page.mp4";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "xbox-product-page-window",
        type: "motion_clip",
        source_family: "xbox_controller_product_page",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "direct_video",
        source_url_kind: "direct_video",
        source_type: "official_platform_product_page",
        provider: "xbox",
        mediaStartS: 4,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://assets.xboxservices.com/assets/controller-still-${index + 1}.jpg`,
        source_family: `xbox_controller_still_${index + 1}`,
        media_kind: "visual_still",
        source_type: "official_press_kit_stills",
        durationS: 3,
        materialized: true,
      })),
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["direct_video_motion_clip_floor_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["direct_video_motion_clip_floor_not_met"],
          evidence: { direct_video_motion_clip_floor: 3 },
        }],
      }],
    },
    minClips: 5,
    generatedAt: "2026-05-29T03:00:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 2);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
});

test("real motion materializer does not re-count its own materialized rights records as fresh candidates", async () => {
  const directUrl = "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/good.mp4?tag=14";
  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          id: "official-source-window",
          path: directUrl,
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          source_kind: "direct_video",
          mediaStartS: 12.25,
          durationS: 2.85,
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
      ],
      records: [
        {
          asset_id: "materialised_official-source-window",
          kind: "video",
          path: path.join("output", "video_cache", "story_v4_clip_1.mp4"),
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          source_type: "validated_direct_media",
          approval_status: "approved_for_transformative_editorial_use",
          transformation_notes: "Trimmed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render.",
        },
      ],
      matched_assets: [
        {
          asset_id: "materialised_official-source-window",
          kind: "video",
          path: path.join("output", "video_cache", "story_v4_clip_1.mp4"),
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          materialized: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "official-source-window");
  assert.equal(rows[0].mediaStartS, 12.25);
});

test("real motion materializer writes local clips, motion manifests and explicit rights records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-"));
  const job = await makePackage(root);
  const calls = [];
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const footagePath = path.join(job.artifact_dir, "footage_inventory.json");
  const staleFootage = await fs.readJson(footagePath);
  await fs.writeJson(footagePath, {
    ...staleFootage,
    status: "blocked",
    ready: false,
    motion_ready: false,
    not_publishable: true,
    counts_towards_final_render_readiness: false,
    readiness: {
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers: ["rights_evidence_contradiction"],
    },
    motion_budget: {
      status: "blocked",
      ready: false,
      motion_ready: false,
    },
    motion_inventory: {
      ...(staleFootage.motion_inventory || {}),
      status: "blocked",
      ready: false,
      motion_ready: false,
      counts_towards_final_render_readiness: false,
    },
  }, { spaces: 2 });
  const staleRights = await fs.readJson(rightsPath);
  const ownedCardPath = path.join(job.artifact_dir, "owned-hyperframes-card.mp4");
  await fs.writeFile(ownedCardPath, Buffer.alloc(4096, 9));
  staleRights.records = [
    {
      asset_id: `${job.story_id}-direct-1`,
      asset_type: "motion_clip",
      path: staleRights.assets[0].source_url,
      source_url: staleRights.assets[0].source_url,
      approval_status: "approved_for_transformative_editorial_use",
    },
    {
      asset_id: `${job.story_id}-unused-segment`,
      asset_type: "motion_clip",
      kind: "video",
      path: "output/video_cache/unused-segment.mp4",
      source_url: "https://publisher.example/unused-segment.mp4",
      source_type: "validated_direct_media",
      source_family: "unused_segment_family",
      approval_status: "approved_for_transformative_editorial_use",
    },
    {
      asset_id: `${job.story_id}-owned-hyperframes-card`,
      asset_type: "video",
      kind: "video",
      path: ownedCardPath,
      source_url: `local://hyperframes/${job.story_id}/source-card`,
      source_type: "selected_render_motion_clip",
      source_family: "hyperframes_source_card",
      source_owner: "Pulse Gaming",
      provider_id: "pulse_hyperframes",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_use: "finished_editorial_video",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels", "tiktok"],
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
      risk_score: 0,
      evidence_reference: ownedCardPath,
    },
  ];
  staleRights.used_assets = [{
    asset_id: `${job.story_id}-owned-hyperframes-card`,
    kind: "video",
    path: ownedCardPath,
    source_url: `local://hyperframes/${job.story_id}/source-card`,
    source_type: "selected_render_motion_clip",
    source_family: "hyperframes_source_card",
  }];
  await fs.writeJson(rightsPath, staleRights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T08:10:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 3));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(calls.length, 5);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const materialised = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.path.includes(`${job.story_id}_v4_clip_`)));
  const expectedSha256 = crypto.createHash("sha256").update(Buffer.alloc(4096, 3)).digest("hex");
  for (const [index, clip] of materialised.clips.entries()) {
    assert.deepEqual(clip.materialized_file_evidence, {
      schema_version: 1,
      captured_at: "2026-05-23T08:10:00.000Z",
      sha256: expectedSha256,
      size_bytes: 4096,
      duration_seconds: 2.85,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    });
    assert.equal(clip.source_url, `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`);
    assert.equal(clip.base_source_family, `url:https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4`);
    assert.equal(clip.mediaStartS, 8 + index);
    assert.equal(clip.durationS, 2.85);
    assert.equal(clip.source_media_start_s, 8 + index);
    assert.equal(clip.source_window_duration_s, 2.85);
    const expectedValidationProvenance = {
      source: "official_trailer_segment_validation",
      validation_reason: "segment_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
    };
    assert.deepEqual(clip.validation_provenance, expectedValidationProvenance);
    assert.deepEqual(clip.provenance, expectedValidationProvenance);
    assert.deepEqual(clip.transformation_provenance, {
      media_start_s: 8 + index,
      duration_s: 2.85,
      base_source_family: clip.base_source_family,
    });
  }

  const ownedMotion = await fs.readJson(path.join(job.artifact_dir, "owned_motion_manifest.json"));
  assert.equal(ownedMotion.status, "ready");
  assert.match(ownedMotion.note, /Real source motion clips/);

  const rights = await fs.readJson(path.join(job.artifact_dir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.failures.length, 0);
  assert.equal(rights.records.length, 6);
  assert.equal(Object.hasOwn(rights, "rights_ledger"), false);
  assert.equal(Object.hasOwn(rights, "rights_records"), false);
  assert.equal(Object.hasOwn(rights, "matched_assets"), false);
  assert.equal(rights.metrics.used_asset_count, 6);
  assert.equal(rights.metrics.rights_record_count, 6);
  assert.equal(rights.metrics.missing_asset_count, 0);
  assert.equal(rights.metrics.duplicate_record_count, 0);
  assert.equal(rights.records.some((record) => record.asset_id.endsWith("-unused-segment")), false);
  assert.ok(
    rights.records.every((record) =>
      ENABLED_LIVE_PLATFORM_RIGHTS.every((platform) =>
        record.allowed_platforms.includes(platform),
      ),
    ),
  );
  const motionRecords = rights.records.filter((record) => record.asset_type === "motion_clip");
  assert.equal(motionRecords.length, 5);
  assert.ok(motionRecords.every((record) => record.source_url.startsWith("https://video.twimg.com/")));
  assert.equal(
    rights.records.some((record) => record.asset_id === `${job.story_id}-owned-hyperframes-card`),
    true,
  );
  for (const [index, record] of motionRecords.entries()) {
    assert.equal(record.asset_sha256, expectedSha256);
    assert.equal(record.asset_size_bytes, 4096);
    assert.equal(record.probed_duration_seconds, 2.85);
    assert.equal(record.video_codec, "h264");
    assert.equal(record.width, 1080);
    assert.equal(record.height, 1920);
    assert.equal(record.base_source_family, materialised.clips[index].base_source_family);
    assert.equal(record.source_media_start_s, 8 + index);
    assert.equal(record.source_window_duration_s, 2.85);
    assert.deepEqual(record.validation_provenance, materialised.clips[index].validation_provenance);
    assert.deepEqual(record.transformation_provenance, materialised.clips[index].transformation_provenance);
  }

  const footage = await fs.readJson(footagePath);
  assert.equal(footage.status, "ready");
  assert.equal(footage.ready, true);
  assert.equal(footage.motion_ready, true);
  assert.equal(footage.not_publishable, false);
  assert.equal(footage.counts_towards_final_render_readiness, true);
  assert.deepEqual(footage.readiness, {
    status: "v4_motion_ready",
    ready: true,
    motion_ready: true,
    can_publish: true,
    blockers: [],
    warnings: [],
    publish_blockers: [],
  });
  assert.equal(footage.motion_budget.status, "ready");
  assert.equal(footage.motion_budget.ready, true);
  assert.equal(footage.motion_budget.motion_ready, true);
  assert.equal(footage.motion_inventory.status, "ready");
  assert.equal(footage.motion_inventory.ready, true);
  assert.equal(footage.motion_inventory.motion_ready, true);
  assert.equal(footage.motion_inventory.counts_towards_final_render_readiness, true);
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 5);
});

test("real motion materializer preserves restrictive rights fields instead of regenerating permissive records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-preservation-"));
  const job = await makePackage(root, "rights-preservation");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = rights.assets.map((asset) => ({
    ...asset,
    licence_basis: "official_press_licence_v2",
    allowed_use: "editorial_short_form_only",
    allowed_platforms: ["youtube", "instagram"],
    platform_restrictions: {
      facebook: "not_licensed",
      tiktok: "not_licensed",
    },
    commercial_use_allowed: true,
    risk_score: 0.41,
    credit_required: true,
    evidence_reference: `licence://${asset.id}`,
  }));
  rights.records = rights.assets.map((asset) => ({
    asset_id: asset.id,
    asset_type: "motion_clip",
    kind: "video",
    path: asset.source_url,
    source_url: asset.source_url,
    licence_basis: asset.licence_basis,
    allowed_use: asset.allowed_use,
    allowed_platforms: asset.allowed_platforms,
    platform_restrictions: asset.platform_restrictions,
    commercial_use_allowed: asset.commercial_use_allowed,
    risk_score: asset.risk_score,
    credit_required: asset.credit_required,
    evidence_reference: asset.evidence_reference,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:10:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  const updated = await fs.readJson(rightsPath);
  assert.equal(updated.records.length, 5);
  for (const record of updated.records) {
    assert.equal(record.licence_basis, "official_press_licence_v2");
    assert.equal(record.allowed_use, "editorial_short_form_only");
    assert.deepEqual(record.allowed_platforms, ["youtube", "instagram"]);
    assert.deepEqual(record.platform_restrictions, {
      facebook: "not_licensed",
      tiktok: "not_licensed",
    });
    assert.equal(record.commercial_use_allowed, true);
    assert.equal(record.risk_score, 0.41);
    assert.equal(record.credit_required, true);
    assert.equal(record.evidence_reference, `licence://${record.asset_id}`);
  }
});

test("real motion materializer fails closed when immutable rights records contradict source rights", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-conflict-"));
  const job = await makePackage(root, "rights-conflict");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = rights.assets.map((asset) => ({
    ...asset,
    licence_basis: "official_press_licence_v2",
    allowed_use: "editorial_short_form_only",
    allowed_platforms: ["youtube", "instagram"],
    commercial_use_allowed: true,
    risk_score: 0.31,
    credit_required: true,
    evidence_reference: `licence://${asset.id}`,
  }));
  rights.records = rights.assets.map((asset, index) => ({
    asset_id: asset.id,
    source_url: asset.source_url,
    licence_basis: index === 0 ? "third_party_reupload_unknown" : asset.licence_basis,
    allowed_use: asset.allowed_use,
    allowed_platforms: asset.allowed_platforms,
    commercial_use_allowed: asset.commercial_use_allowed,
    risk_score: asset.risk_score,
    credit_required: asset.credit_required,
    evidence_reference: asset.evidence_reference,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:15:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_evidence_contradiction"));
  assert.match(report.jobs[0].failed[0].error, /licence_basis/);
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion rights reconciliation keeps distinct windows from one official master as separate assets", () => {
  const sourceUrl = "https://cdn.example.com/official/ascend-to-zero-launch-trailer.mp4";
  const baseClip = {
    id: "segment_direct_motion_5",
    media_kind: "direct_video",
    source_url: sourceUrl,
    source_owner: "Flyway Games",
    source_type: "official_youtube_channel",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: "https://www.youtube.com/watch?v=nAfFe2nds-4",
    materialized_file_evidence: {
      sha256: "a".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const clips = [
    {
      ...baseClip,
      path: "C:/pulse/segment-36.mp4",
      mediaStartS: 36,
      durationS: 5,
      validation_provenance: {
        validation_reason: "trimmed_segment_samples_passed",
        segment_validated: true,
        source_duration_s: 82.361,
      },
    },
    {
      ...baseClip,
      path: "C:/pulse/segment-75.mp4",
      mediaStartS: 75,
      durationS: 4,
      validation_provenance: {
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        source_duration_s: 82.361,
      },
      materialized_file_evidence: {
        ...baseClip.materialized_file_evidence,
        sha256: "b".repeat(64),
        duration_seconds: 4,
      },
    },
  ];

  const result = reconcileMaterializedRightsRecords(clips, {
    verdict: "pass",
    records: [],
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 2);
  assert.equal(new Set(result.records.map((record) => record.asset_id)).size, 2);
  assert.deepEqual(
    result.records
      .map((record) => [record.source_media_start_s, record.source_window_duration_s])
      .sort((left, right) => left[0] - right[0]),
    [
      [36, 5],
      [75, 4],
    ],
  );
});

test("real motion rights reconciliation does not invent commercial permission for a clip that omits it", () => {
  const clip = {
    id: "official-window-without-commercial-grant",
    media_kind: "direct_video",
    path: "C:/pulse/official-window-without-commercial-grant.mp4",
    source_url: "https://cdn.example.com/official/gameplay-trailer.mp4",
    source_owner: "Official Publisher",
    source_type: "official_youtube_channel",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    evidence_reference: "https://www.youtube.com/watch?v=OfficialGameplay1",
    mediaStartS: 12,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "d".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [],
  });

  assert.deepEqual(result.records, []);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "commercial_rights_evidence_missing");
  assert.equal(
    result.failures[0].error,
    "commercial_rights_evidence_missing:commercial_use_allowed_not_affirmative",
  );
});

test("real motion rights reconciliation keeps equal windows from different YouTube videos distinct", () => {
  const common = {
    media_kind: "direct_video",
    source_owner: "Official Publisher",
    source_type: "official_publisher_gameplay_clip",
    licence_basis: "publisher_video_policy_transformative_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: true,
    risk_score: 0.2,
    mediaStartS: 12.5,
    durationS: 6.9,
  };
  const clips = [
    {
      ...common,
      id: "official-video-a-window",
      path: "C:/pulse/materialized/official-video-a-window.mp4",
      source_url: "https://www.youtube.com/watch?v=OfficialVidA",
      evidence_reference: "C:/pulse/rights/publisher-video-policy.html",
      materialized_file_evidence: {
        sha256: "a".repeat(64),
        size_bytes: 4096,
        duration_seconds: 6.9,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
    },
    {
      ...common,
      id: "official-video-b-window",
      path: "C:/pulse/materialized/official-video-b-window.mp4",
      source_url: "https://www.youtube.com/watch?v=OfficialVidB",
      evidence_reference: "C:/pulse/rights/publisher-video-policy.html",
      materialized_file_evidence: {
        sha256: "b".repeat(64),
        size_bytes: 4096,
        duration_seconds: 6.9,
        video_codec: "h264",
        width: 1080,
        height: 1920,
      },
    },
  ];

  const existingRecords = clips.map((clip) => ({
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    path: clip.path,
    source_url: clip.source_url,
    source_owner: clip.source_owner,
    source_type: clip.source_type,
    licence_basis: clip.licence_basis,
    allowed_use: clip.allowed_use,
    allowed_platforms: clip.allowed_platforms,
    commercial_use_allowed: clip.commercial_use_allowed,
    credit_required: clip.credit_required,
    evidence_reference: clip.evidence_reference,
    risk_score: clip.risk_score,
    source_media_start_s: clip.mediaStartS,
    source_window_duration_s: clip.durationS,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  const result = reconcileMaterializedRightsRecords(clips, {
    verdict: "pass",
    records: existingRecords,
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    result.records.map((record) => record.asset_id).sort(),
    ["official-video-a-window", "official-video-b-window"],
  );
});

test("real motion rights reconciliation carries an explicit source policy grant to a new window", () => {
  const canonicalSourceUrl = "https://www.youtube.com/watch?v=PolicyVideo1";
  const sourceMasterSha256 = "c".repeat(64);
  const policyPath = "C:/pulse/rights/publisher-video-policy.html";
  const policySha256 = "d".repeat(64);
  const common = {
    media_kind: "direct_video",
    source_owner: "Official Publisher",
    source_type: "official_publisher_gameplay_clip",
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: "PolicyVideo1",
    source_master_sha256: sourceMasterSha256,
    licence_basis: "publisher_video_policy_transformative_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: true,
    risk_score: 0.2,
    evidence_sha256: policySha256,
    rights_evidence_sha256: policySha256,
  };
  const original = {
    ...common,
    id: "policy-source-window-original",
    path: "C:/pulse/materialized/policy-source-window-original.mp4",
    source_url: canonicalSourceUrl,
    mediaStartS: 12.5,
    durationS: 6.9,
    evidence_reference: policyPath,
    evidence_file: policyPath,
    rights_evidence_file: policyPath,
    rights_grant: true,
    materialized_file_evidence: {
      sha256: "e".repeat(64),
      size_bytes: 4096,
      duration_seconds: 6.9,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const refreshed = {
    ...common,
    id: "policy-source-window-refreshed",
    path: "C:/pulse/materialized/policy-source-window-refreshed.mp4",
    source_url: "C:/pulse/masters/PolicyVideo1.mp4",
    mediaStartS: 5.5,
    durationS: 5,
    evidence_reference: "",
    rights_evidence_file: policyPath,
    materialized_file_evidence: {
      sha256: "f".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const originalRights = {
    asset_id: original.id,
    asset_type: "motion_clip",
    kind: "video",
    ...original,
    source_media_start_s: original.mediaStartS,
    source_window_duration_s: original.durationS,
    asset_sha256: original.materialized_file_evidence.sha256,
  };
  const incompleteRefreshedRights = {
    ...originalRights,
    asset_id: refreshed.id,
    id: refreshed.id,
    path: refreshed.path,
    source_url: refreshed.source_url,
    source_media_start_s: refreshed.mediaStartS,
    source_window_duration_s: refreshed.durationS,
    asset_sha256: refreshed.materialized_file_evidence.sha256,
    evidence_file: undefined,
    rights_evidence_file: policyPath,
    rights_grant: undefined,
  };

  const result = reconcileMaterializedRightsRecords(
    [original, refreshed],
    {
      verdict: "pass",
      records: [originalRights, incompleteRefreshedRights],
      assets: [{
        ...originalRights,
        evidence_file: undefined,
      }],
    },
  );

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 2);
  const refreshedRights = result.records.find(
    (record) => record.asset_id === refreshed.id,
  );
  assert.ok(refreshedRights);
  assert.equal(refreshedRights.evidence_file, policyPath);
  assert.equal(refreshedRights.evidence_sha256, policySha256);
  assert.equal(refreshedRights.rights_grant, true);
  assert.equal(refreshedRights.asset_sha256, refreshed.materialized_file_evidence.sha256);
  assert.equal(refreshedRights.source_media_start_s, 5.5);
});

test("real motion rights reconciliation lets hash-verified publisher policy supersede non-restrictive legacy metadata for the same window", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-real-motion-policy-upgrade-"),
  );
  const policyPath = path.join(root, "rights", "publisher-video-policy.pdf");
  const policyBytes = Buffer.alloc(4096, 73);
  await fs.outputFile(policyPath, policyBytes);
  const policySha256 = crypto
    .createHash("sha256")
    .update(policyBytes)
    .digest("hex");
  const sourceMasterPath = path.join(root, "masters", "PolicyUpg01.mp4");
  const sourceMasterBytes = Buffer.alloc(12288, 29);
  await fs.outputFile(sourceMasterPath, sourceMasterBytes);
  const sourceMasterSha256 = crypto
    .createHash("sha256")
    .update(sourceMasterBytes)
    .digest("hex");
  const identitySidecarPath = path.join(
    root,
    "identity",
    "PolicyUpg01.json",
  );
  const canonicalSourceUrl =
    "https://www.youtube.com/watch?v=PolicyUpg01";
  const identitySidecarBytes = Buffer.from(
    JSON.stringify({
      schema: "pulse_motion_source_identity_sidecar_v1",
      schema_version: 1,
      producer: "pulse_source_identity_oembed_verifier_v1",
      canonical_source_url: canonicalSourceUrl,
      youtube_video_id: "PolicyUpg01",
      channel_identity: {
        author_name: "Official Publisher",
        author_url: "https://www.youtube.com/@officialpublisher",
      },
      source_master_sha256: sourceMasterSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
      evidence: {
        provider: "youtube_oembed",
        verified_at: "2026-07-19T16:00:00.000Z",
        title: "Official gameplay source",
      },
    }),
  );
  await fs.outputFile(identitySidecarPath, identitySidecarBytes);
  const identitySidecarSha256 = crypto
    .createHash("sha256")
    .update(identitySidecarBytes)
    .digest("hex");
  const clip = {
    id: "publisher-policy-upgraded-window",
    media_kind: "direct_video",
    path: path.join(root, "materialized", "publisher-policy-window.mp4"),
    local_materialized_path: path.join(
      root,
      "materialized",
      "publisher-policy-window.mp4",
    ),
    source_url: sourceMasterPath,
    source_master_path: sourceMasterPath,
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: "PolicyUpg01",
    source_master_sha256: sourceMasterSha256,
    source_type: "official_youtube_channel_url",
    source_owner: "Official Publisher",
    licence_basis: "publisher_video_policy_transformative_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
    platform_restrictions: { source_audio: "must_not_be_used" },
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: "https://publisher.example/legal/video-policy",
    evidence_file: policyPath,
    rights_evidence_file: policyPath,
    evidence_kind: "publisher_video_policy",
    evidence_sha256: policySha256,
    rights_evidence_sha256: policySha256,
    evidence_size_bytes: policyBytes.length,
    rights_evidence_size_bytes: policyBytes.length,
    transformative_rights_evidence_verified: true,
    rights_grant: true,
    risk_score: 0.18,
    mediaStartS: 14,
    durationS: 5,
    source_identity_provenance: {
      schema_version: 1,
      kind: "pulse_source_identity_sidecar",
      status: "resolved",
      sidecar_path: identitySidecarPath,
      sidecar_sha256: identitySidecarSha256,
      canonical_source_url: canonicalSourceUrl,
      youtube_video_id: "PolicyUpg01",
      source_master_sha256: sourceMasterSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
    },
    validation_provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
      review_method: "independent_contact_sheet_review",
    },
    materialized_file_evidence: {
      sha256: "a".repeat(64),
      size_bytes: 8192,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  await fs.outputFile(clip.path, Buffer.alloc(8192, 31));
  const legacyRecord = {
    asset_id: "legacy-publisher-policy-window",
    asset_type: "motion_clip",
    kind: "video",
    path: clip.path,
    source_url: clip.source_url,
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: clip.youtube_video_id,
    source_master_sha256: sourceMasterSha256,
    source_type: clip.source_type,
    source_owner: clip.source_owner,
    licence_basis: "official_direct_media",
    allowed_use: "official_direct_media_segment_candidate",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: path.join(root, "rights", "old-policy.html"),
    risk_score: 0.2,
    source_media_start_s: 14,
    source_window_duration_s: 5,
    approval_status: "approved_for_transformative_editorial_use",
    validation_provenance: {
      source: "legacy_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [legacyRecord],
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].asset_id, clip.id);
  assert.equal(result.records[0].evidence_file, policyPath);
  assert.equal(result.records[0].evidence_sha256, policySha256);
  assert.equal(result.records[0].credit_required, false);
  assert.deepEqual(
    result.records[0].platform_restrictions,
    clip.platform_restrictions,
  );
  assert.deepEqual(
    result.records[0].validation_provenance,
    clip.validation_provenance,
  );

  await fs.outputFile(policyPath, Buffer.alloc(policyBytes.length, 74));
  const tampered = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [legacyRecord],
  });
  assert.equal(tampered.records.length, 0);
  assert.equal(tampered.failures.length, 1);
  assert.equal(tampered.failures[0].reason, "rights_evidence_contradiction");

  await fs.outputFile(policyPath, policyBytes);
  await fs.outputFile(
    identitySidecarPath,
    Buffer.from(
      JSON.stringify({
        canonical_source_url: canonicalSourceUrl,
        youtube_video_id: "Different01",
      }),
    ),
  );
  const tamperedIdentity = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [legacyRecord],
  });
  assert.equal(tamperedIdentity.records.length, 0);
  assert.equal(tamperedIdentity.failures.length, 1);
  assert.equal(
    tamperedIdentity.failures[0].reason,
    "rights_evidence_contradiction",
  );
});

test("real motion rights reconciliation canonicalises local-master and watch-url evidence references for one verified source", () => {
  const canonicalSourceUrl = "https://www.youtube.com/watch?v=PolicyVideo1";
  const localMasterPath = "C:/pulse/masters/PolicyVideo1.mp4";
  const sourceMasterSha256 = "c".repeat(64);
  const policyPath = "C:/pulse/rights/publisher-video-policy.html";
  const policySha256 = "d".repeat(64);
  const common = {
    media_kind: "direct_video",
    source_owner: "Official Publisher",
    source_type: "official_publisher_gameplay_clip",
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: "PolicyVideo1",
    source_master_sha256: sourceMasterSha256,
    licence_basis: "publisher_video_policy_transformative_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    risk_score: 0.2,
    evidence_file: policyPath,
    rights_evidence_file: policyPath,
    evidence_sha256: policySha256,
    rights_evidence_sha256: policySha256,
    rights_grant: true,
  };
  const watchUrlWindow = {
    ...common,
    id: "policy-source-watch-url-window",
    path: "C:/pulse/materialized/policy-source-watch-url-window.mp4",
    source_url: canonicalSourceUrl,
    evidence_reference: canonicalSourceUrl,
    mediaStartS: 12.5,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "e".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const localMasterWindow = {
    ...common,
    id: "policy-source-local-master-window",
    path: "C:/pulse/materialized/policy-source-local-master-window.mp4",
    source_url: localMasterPath,
    evidence_reference: localMasterPath,
    mediaStartS: 0,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "f".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const existingRecords = [watchUrlWindow, localMasterWindow].map((clip) => ({
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    ...clip,
    source_media_start_s: clip.mediaStartS,
    source_window_duration_s: clip.durationS,
    asset_sha256: clip.materialized_file_evidence.sha256,
  }));

  const result = reconcileMaterializedRightsRecords(
    [watchUrlWindow, localMasterWindow],
    {
      verdict: "pass",
      records: existingRecords,
      assets: existingRecords,
    },
  );

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((record) => record.evidence_file === policyPath));
  assert.ok(result.records.every((record) => record.evidence_sha256 === policySha256));
  assert.ok(result.records.every((record) => record.rights_grant === true));
});

test("real motion rights reconciliation still rejects conflicting provenance for the same source window", () => {
  const sourceUrl = "https://cdn.example.com/official/ascend-to-zero-launch-trailer.mp4";
  const clip = {
    id: "segment_direct_motion_5",
    media_kind: "direct_video",
    path: "C:/pulse/segment-36.mp4",
    source_url: sourceUrl,
    source_owner: "Flyway Games",
    source_type: "official_youtube_channel",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: "https://www.youtube.com/watch?v=nAfFe2nds-4",
    mediaStartS: 36,
    durationS: 5,
    validation_provenance: {
      validation_reason: "segment_samples_passed",
      segment_validated: true,
    },
    materialized_file_evidence: {
      sha256: "c".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const conflicting = {
    ...clip,
    validation_provenance: {
      validation_reason: "different_same_window_decision",
      segment_validated: true,
    },
  };

  const result = reconcileMaterializedRightsRecords([clip, conflicting], {
    verdict: "pass",
    records: [],
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "rights_evidence_contradiction");
  assert.match(result.failures[0].error, /validation_provenance/);
});

test("real motion rights reconciliation treats enabled platform aliases as equivalent", () => {
  const clip = {
    id: "platform-alias-window",
    media_kind: "direct_video",
    path: "C:/pulse/materialized/platform-alias-window.mp4",
    source_url: "https://cdn.example.com/official/platform-alias-trailer.mp4",
    source_owner: "Official Publisher",
    source_type: "official_publisher_promotional_video",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: "https://publisher.example/platform-alias-trailer",
    risk_score: 0.2,
    mediaStartS: 14,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "8".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const existingRecord = {
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    ...clip,
    allowed_platforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    source_media_start_s: clip.mediaStartS,
    source_window_duration_s: clip.durationS,
    asset_sha256: clip.materialized_file_evidence.sha256,
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [existingRecord],
    assets: [existingRecord],
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.records[0].allowed_platforms, [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]);
});

test("real motion rights reconciliation upgrades a generic official row from strict same-window publisher evidence", () => {
  const sourcePath = "C:/pulse/official/Arknights-Endfield-gameplay.mp4";
  const canonicalSourceUrl = "https://www.youtube.com/watch?v=PpyzMnjSuZo";
  const sourceMasterSha256 = "4".repeat(64);
  const clip = {
    id: "segment_direct_motion_1",
    media_kind: "direct_video",
    path: "C:/pulse/materialized/Arknights-Endfield-window.mp4",
    source_url: sourcePath,
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: "PpyzMnjSuZo",
    source_master_sha256: sourceMasterSha256,
    source_owner: "Arknights: Endfield",
    source_type: "official_youtube_channel_url",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: canonicalSourceUrl,
    risk_score: 0.28,
    mediaStartS: 6.45,
    durationS: 2.95,
    source_identity_provenance: {
      schema_version: 1,
      kind: "pulse_source_identity_sidecar",
      status: "resolved",
      sidecar_path: `${sourcePath}.source-identity.json`,
      sidecar_sha256: "5".repeat(64),
      canonical_source_url: canonicalSourceUrl,
      youtube_video_id: "PpyzMnjSuZo",
      source_master_sha256: sourceMasterSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
      channel_identity: {
        author_name: "Arknights: Endfield",
        author_url: "https://www.youtube.com/@arknightsendfieldEN",
      },
    },
    validation_provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "trimmed_segment_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
    materialized_file_evidence: {
      sha256: "6".repeat(64),
      size_bytes: 4096,
      duration_seconds: 2.95,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const genericExisting = {
    asset_id: clip.id,
    path: clip.path,
    source_url: sourcePath,
    canonical_source_url: canonicalSourceUrl,
    youtube_video_id: clip.youtube_video_id,
    source_master_sha256: sourceMasterSha256,
    source_media_start_s: clip.mediaStartS,
    source_window_duration_s: clip.durationS,
    licence_basis: "official_direct_media",
    rights_basis: "official_direct_media",
    allowed_use: "official_direct_media_segment_candidate",
    allowed_platforms: [...clip.allowed_platforms],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: canonicalSourceUrl,
    risk_score: 0.28,
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    assets: [genericExisting],
    records: [genericExisting],
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 1);
  assert.equal(
    result.records[0].licence_basis,
    "official_publisher_promotional_editorial_use",
  );
  assert.equal(
    result.records[0].allowed_use,
    "transformative_editorial_short_form",
  );
});

test("real motion rights reconciliation replaces a stale same-id motion row during refresh", () => {
  const clip = {
    id: "segment_direct_motion_2",
    media_kind: "direct_video",
    path: "C:/pulse/materialized/current-window.mp4",
    source_url: "https://cdn.example.com/official/current-trailer.mp4",
    source_owner: "Official Publisher",
    source_type: "official_publisher_promotional_video",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: "https://publisher.example/current-trailer",
    risk_score: 0.2,
    mediaStartS: 30,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "a".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const staleRecord = {
    asset_id: clip.id,
    asset_type: "motion_clip",
    kind: "video",
    path: "C:/pulse/materialized/stale-window.mp4",
    source_url: "https://cdn.example.com/official/stale-trailer.mp4",
    source_owner: "Official Publisher",
    source_type: clip.source_type,
    licence_basis: clip.licence_basis,
    allowed_use: clip.allowed_use,
    allowed_platforms: clip.allowed_platforms,
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: "https://publisher.example/stale-trailer",
    risk_score: 0.2,
    source_media_start_s: 10,
    source_window_duration_s: 5,
    approval_status: "approved_for_transformative_editorial_use",
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [staleRecord],
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].asset_id, clip.id);
  assert.equal(result.records[0].path, clip.path);
  assert.equal(result.records[0].source_media_start_s, 30);
});

test("real motion rights reconciliation restores the current clip id from a stale disambiguated row", () => {
  const clip = {
    id: "segment_direct_motion_6",
    media_kind: "direct_video",
    path: "C:/pulse/materialized/current-window.mp4",
    source_url: "https://cdn.example.com/official/current-trailer.mp4",
    source_owner: "Official Publisher",
    source_type: "official_publisher_promotional_video",
    licence_basis: "official_publisher_promotional_editorial_use",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: "https://publisher.example/current-trailer",
    risk_score: 0.2,
    mediaStartS: 30,
    durationS: 5,
    materialized_file_evidence: {
      sha256: "b".repeat(64),
      size_bytes: 4096,
      duration_seconds: 5,
      video_codec: "h264",
      width: 1080,
      height: 1920,
    },
  };
  const priorRecord = {
    asset_id: `${clip.id}__window_101bb0b8da`,
    asset_type: "motion_clip",
    kind: "video",
    path: clip.path,
    source_url: clip.source_url,
    source_owner: clip.source_owner,
    source_type: clip.source_type,
    licence_basis: clip.licence_basis,
    allowed_use: clip.allowed_use,
    allowed_platforms: clip.allowed_platforms,
    commercial_use_allowed: true,
    credit_required: true,
    evidence_reference: clip.evidence_reference,
    risk_score: 0.2,
    source_media_start_s: 30,
    source_window_duration_s: 5,
    approval_status: "approved_for_transformative_editorial_use",
  };

  const result = reconcileMaterializedRightsRecords([clip], {
    verdict: "pass",
    records: [priorRecord],
  });

  assert.deepEqual(result.failures, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].asset_id, clip.id);
});

test("real motion materializer preserves and blocks a non-commercial existing rights restriction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-non-commercial-rights-"));
  const job = await makePackage(root, "non-commercial-rights");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.records = rights.assets.map((asset) => ({
    asset_id: asset.id,
    source_url: asset.source_url,
    licence_basis: "official_reference_licence",
    allowed_use: "editorial_short_form_only",
    allowed_platforms: ["youtube"],
    commercial_use_allowed: false,
    risk_score: 0.2,
    credit_required: true,
    evidence_reference: `licence://${asset.id}`,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:18:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.ok(report.jobs[0].blockers.includes("rights_evidence_restricts_commercial_use"));
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion materializer preserves a rejected rights-ledger verdict as blocking", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rejected-ledger-"));
  const job = await makePackage(root, "rejected-ledger");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "rejected";
  rights.failures = [];
  rights.records = [];
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:00:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_ledger_rejected"));
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion materializer reconciles fresh motion rights while a script-repair render hold remains", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-script-repair-hold-"));
  const job = await makePackage(root, "script-repair-render-hold");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const audioDir = path.join(job.artifact_dir, "audio");
  const audioPath = path.join(audioDir, "narration.mp3");
  const timestampsPath = path.join(audioDir, "word_timestamps.json");
  const audioBytes = Buffer.alloc(4096, 31);
  const timestampBytes = Buffer.from(JSON.stringify({
    words: [{ word: "Forza", start: 0, end: 0.4 }],
  }));
  const audioSha256 = crypto.createHash("sha256").update(audioBytes).digest("hex");
  const timestampsSha256 = crypto
    .createHash("sha256")
    .update(timestampBytes)
    .digest("hex");
  const invalidatedAt = "2026-07-18T11:41:23.425Z";
  const regeneratedAt = "2026-07-18T11:41:37.231Z";
  const freshTimestamp = new Date(regeneratedAt);
  await fs.outputFile(audioPath, audioBytes);
  await fs.outputFile(timestampsPath, timestampBytes);
  await fs.utimes(audioPath, freshTimestamp, freshTimestamp);
  await fs.utimes(timestampsPath, freshTimestamp, freshTimestamp);
  await fs.writeJson(path.join(job.artifact_dir, "audio_manifest.json"), {
    schema_version: 1,
    story_id: job.story_id,
    narration_audio_path: "audio/narration.mp3",
    word_timestamps_path: "audio/word_timestamps.json",
    voice_status: "materialized",
    materialized_at: regeneratedAt,
    narration_audio_sha256: audioSha256,
    narration_audio_size_bytes: audioBytes.length,
    word_timestamps_sha256: timestampsSha256,
    word_timestamps_size_bytes: timestampBytes.length,
    word_timestamp_provenance: {
      strict_whisper_aligned: true,
    },
  }, { spaces: 2 });

  const rights = await fs.readJson(rightsPath);
  rights.story_id = job.story_id;
  rights.status = "blocked";
  rights.verdict = "RED";
  rights.blockers = [
    "narration_and_render_regeneration_required_after_script_repair",
  ];
  rights.failures = [];
  rights.script_repair_invalidated_at = invalidatedAt;
  rights.narration_rights_updated_at = regeneratedAt;
  rights.result = "PASS";
  rights.reconciliation = {
    current_files_hashed: true,
    final_render_decoded: true,
  };
  rights.assets = rights.assets.map((asset) => ({
    ...asset,
    licence_basis: "official_press_licence_v2",
    allowed_use: "editorial_short_form_only",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: `licence://${asset.id}`,
  }));
  rights.records = [
    {
      asset_id: `${job.story_id}_audio_path`,
      asset_type: "narration_audio",
      kind: "audio",
      path: "audio/narration.mp3",
      source_url: `local-tts://${job.story_id}`,
      source_type: "local_tts_voice",
      licence_basis: "owned_local_tts_voice",
      allowed_use: "short_form_editorial_narration",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      approval_status: "approved",
      asset_sha256: audioSha256,
      asset_size_bytes: audioBytes.length,
      risk_score: 0.08,
    },
    ...rights.assets.map((asset) => ({
      asset_id: asset.id,
      asset_type: "motion_clip",
      kind: "video",
      path: asset.source_url,
      source_url: asset.source_url,
      licence_basis: asset.licence_basis,
      allowed_use: asset.allowed_use,
      allowed_platforms: asset.allowed_platforms,
      commercial_use_allowed: asset.commercial_use_allowed,
      credit_required: asset.credit_required,
      evidence_reference: asset.evidence_reference,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  ];
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-18T12:52:54.700Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 17));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(
    report.jobs[0].publish_hold,
    "narration_and_render_regeneration_required_after_script_repair",
  );
  assert.equal(
    report.jobs[0].rights_transition_status,
    "awaiting_fresh_render",
  );
  const updatedRights = await fs.readJson(rightsPath);
  const motionRecords = updatedRights.records.filter(
    (record) => record.asset_type === "motion_clip",
  );
  assert.equal(motionRecords.length, 5);
  assert.ok(motionRecords.every((record) => /^[a-f0-9]{64}$/.test(record.asset_sha256)));
  assert.equal(updatedRights.status, "blocked");
  assert.equal(updatedRights.verdict, "RED");
  assert.deepEqual(updatedRights.blockers, [
    "narration_and_render_regeneration_required_after_script_repair",
  ]);
  assert.equal(updatedRights.can_auto_publish, false);
  assert.equal(updatedRights.result, "BLOCKED");
  assert.equal(updatedRights.reconciliation.final_render_decoded, false);
  assert.equal(
    updatedRights.script_repair_media_transition.status,
    "awaiting_fresh_render",
  );
  assert.equal(updatedRights.script_repair_media_transition.narration_fresh, true);
  assert.equal(updatedRights.script_repair_media_transition.render_fresh, false);
  const footage = await fs.readJson(path.join(job.artifact_dir, "footage_inventory.json"));
  assert.equal(footage.motion_ready, true);
  assert.equal(footage.counts_towards_final_render_readiness, true);
  assert.equal(footage.not_publishable, true);
  assert.equal(footage.readiness.can_publish, false);

  const canonical = await fs.readJson(
    path.join(job.artifact_dir, "canonical_story_manifest.json"),
  );
  const canonicalSnapshot = {
    story_id: canonical.story_id || "",
    selected_title: canonical.selected_title || canonical.short_title || "",
    thumbnail_headline:
      canonical.thumbnail_headline || canonical.thumbnail_text || "",
    first_spoken_line:
      canonical.first_spoken_line || canonical.narration_hook || "",
    narration_script: canonical.narration_script || "",
    canonical_subject:
      canonical.canonical_subject || canonical.canonical_game || "",
    canonical_angle: canonical.canonical_angle || "",
    primary_source:
      canonical.primary_source || canonical.source_card_label || "",
    public_copy_repaired_at: canonical.public_copy_repaired_at || "",
    duration_variant_repaired_at:
      canonical.duration_variant_repaired_at || "",
  };
  const stableJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const fingerprintSource = {
    canonical_snapshot: canonicalSnapshot,
    audio_sha256: audioSha256,
    word_timestamps_sha256: timestampsSha256,
    audio_size_bytes: audioBytes.length,
    word_timestamps_size_bytes: timestampBytes.length,
  };
  const renderPath = path.join(job.artifact_dir, "visual_v4_render.mp4");
  const renderBytes = Buffer.alloc(8192, 41);
  const renderGeneratedAt = "2026-07-18T13:02:00.000Z";
  const renderTimestamp = new Date(renderGeneratedAt);
  await fs.outputFile(renderPath, renderBytes);
  await fs.utimes(renderPath, renderTimestamp, renderTimestamp);
  await fs.writeJson(path.join(job.artifact_dir, "render_manifest.json"), {
    schema_version: 1,
    story_id: job.story_id,
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: renderPath,
    generated_at: renderGeneratedAt,
    file_size_bytes: renderBytes.length,
    input_fingerprint: {
      algorithm: "sha256",
      signature: crypto
        .createHash("sha256")
        .update(stableJson(fingerprintSource))
        .digest("hex"),
      audio_sha256: audioSha256,
      word_timestamps_sha256: timestampsSha256,
      audio_size_bytes: audioBytes.length,
      word_timestamps_size_bytes: timestampBytes.length,
      canonical_snapshot: canonicalSnapshot,
    },
    quality_gate_status: "post_render_forensics_passed",
  }, { spaces: 2 });

  const rerun = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-18T13:03:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 17));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(rerun.summary.materialized_story_count, 1, JSON.stringify(rerun.jobs[0]));
  assert.equal(rerun.jobs[0].publish_hold, null);
  assert.equal(rerun.jobs[0].rights_transition_status, "reconciled");
  const clearedRights = await fs.readJson(rightsPath);
  assert.equal(clearedRights.status, "ready");
  assert.equal(clearedRights.verdict, "pass");
  assert.deepEqual(clearedRights.blockers, []);
  assert.equal(clearedRights.can_auto_publish, false);
  assert.equal(clearedRights.result, "PASS");
  assert.equal(clearedRights.reconciliation.final_render_decoded, true);
  assert.equal(clearedRights.script_repair_media_transition.status, "reconciled");
  assert.equal(clearedRights.script_repair_media_transition.narration_fresh, true);
  assert.equal(clearedRights.script_repair_media_transition.render_fresh, true);
  const clearedFootage = await fs.readJson(
    path.join(job.artifact_dir, "footage_inventory.json"),
  );
  assert.equal(
    clearedFootage.not_publishable,
    false,
    JSON.stringify(clearedRights.script_repair_media_transition, null, 2),
  );
  assert.equal(clearedFootage.readiness.can_publish, true);
});

test("real motion materializer does not let a pass verdict mask a rejected ledger approval status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rejected-ledger-approval-"));
  const job = await makePackage(root, "rejected-ledger-approval");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.approval_status = "rejected";
  rights.failures = [];
  rights.records = [];
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:02:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_ledger_rejected"));
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion materializer preserves a rejected rights-record approval status as blocking", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rejected-record-"));
  const job = await makePackage(root, "rejected-record");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.records = rights.assets.map((asset, index) => ({
    asset_id: asset.id,
    source_url: asset.source_url,
    licence_basis: "official_press_licence_v2",
    allowed_use: "editorial_short_form_only",
    commercial_use_allowed: true,
    approval_status: index === 0 ? "rejected" : "approved_for_transformative_editorial_use",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:05:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"));
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion materializer blocks equivalent restrictive rights-record statuses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-failed-rights-record-"));
  const job = await makePackage(root, "failed-rights-record");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.records = rights.assets.map((asset, index) => ({
    asset_id: asset.id,
    source_url: asset.source_url,
    licence_basis: "official_press_licence_v2",
    allowed_use: "editorial_short_form_only",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    rights_status: index === 0 ? "failed_rights_review" : "verified",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const before = await fs.readFile(rightsPath, "utf8");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:10:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"));
  assert.equal(await fs.readFile(rightsPath, "utf8"), before);
});

test("real motion materializer binds complete same-run evidence to screenshot-derived MP4s", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-still-evidence-"));
  const storyId = "still-evidence";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imagePaths = Array.from(
    { length: 5 },
    (_, index) => path.join(root, "inputs", `official-shot-${index + 1}.png`),
  );
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(imagePaths[0]));
  await Promise.all(
    imagePaths.map((imagePath, index) => fs.writeFile(imagePath, Buffer.alloc(2048, index + 2))),
  );
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: imagePaths.map((imagePath, index) => ({
      id: `official-shot-${index + 1}`,
      type: "official_press_kit_stills",
      kind: "screenshot",
      source_type: "official_press_kit_stills",
      source_family: `official_press_shot_${index + 1}`,
      path: imagePath,
      source_url: `https://cdn.example.com/official-shot-${index + 1}.png`,
      durationS: 3,
      licence_basis: "official_press_licence_v2",
      allowed_use: "editorial_short_form_only",
      allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
      commercial_use_allowed: true,
      credit_required: true,
      risk_score: 0.2,
      evidence_reference: `licence://official-shot-${index + 1}`,
    })),
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    generatedAt: "2026-07-15T04:20:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 3,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.clips.length, 5);
  assert.ok(manifest.clips.every((clip) => clip.media_kind === "visual_still"));
  assert.deepEqual(manifest.clips[0].materialized_file_evidence, {
    schema_version: 1,
    captured_at: "2026-07-15T04:20:00.000Z",
    sha256: crypto.createHash("sha256").update(Buffer.alloc(4096, 5)).digest("hex"),
    size_bytes: 4096,
    duration_seconds: 3,
    video_codec: "h264",
    width: 1080,
    height: 1920,
  });
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.asset_type === "screenshot_derived_motion_clip"));
  assert.equal(rights.records[0].asset_sha256, manifest.clips[0].materialized_file_evidence.sha256);
});

test("real motion materializer keeps one screenshot blocked despite lowered invocation thresholds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-one-still-floor-"));
  const storyId = "one-still-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imagePath = path.join(root, "inputs", "official-shot.png");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(imagePath));
  await fs.writeFile(imagePath, Buffer.alloc(2048, 2));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    assets: [{
      id: "official-shot",
      type: "official_press_kit_stills",
      kind: "screenshot",
      source_type: "official_press_kit_stills",
      source_family: "official_press_shot_1",
      path: imagePath,
      source_url: "https://cdn.example.com/official-shot.png",
      durationS: 3,
      licence_basis: "official_press_licence_v2",
      allowed_use: "editorial_short_form_only",
      commercial_use_allowed: true,
      allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
      credit_required: true,
      risk_score: 0.2,
      evidence_reference: "licence://official-shot",
    }],
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 1,
    minFamilies: 1,
    maxClips: 1,
    generatedAt: "2026-07-15T05:45:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.not_publishable, true);
  const centralPack = await fs.readJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
  );
  assert.equal(centralPack.status, "blocked");
  assert.equal(centralPack.readiness.status, "v4_motion_blocked");
  assert.equal(centralPack.motion_budget.required_motion_scenes, 5);
  assert.equal(centralPack.motion_budget.required_distinct_families, 4);
});

test("real motion materializer demotes an undersized ready central pack despite lowered thresholds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-undersized-central-pack-"));
  const storyId = "undersized-central-pack";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const clipPath = path.join(root, "output", "video_cache", `${storyId}.mp4`);
  const motionPackPath = path.join(
    root,
    "output",
    "studio-v4",
    "motion-packs",
    `${storyId}_motion_pack_manifest.json`,
  );
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, Buffer.alloc(4096, 7));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(motionPackPath, {
    story_id: storyId,
    status: "ready",
    source: "validated_real_motion_materializer",
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips: [{
      id: "undersized-official-window",
      source_family: "official_window_1",
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: "https://cdn.example.com/official-window.mp4",
      source_type: "official_trailer",
      mediaStartS: 0,
      durationS: 3,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    }],
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 1,
    minFamilies: 1,
    maxClips: 1,
    generatedAt: "2026-07-15T05:50:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  const centralPack = await fs.readJson(motionPackPath);
  assert.equal(centralPack.status, "blocked");
  assert.equal(centralPack.readiness.status, "v4_motion_blocked");
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.not_publishable, true);
});

test("real motion materializer rejects probe evidence that does not match the output contract or requested window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-probe-contract-"));
  const job = await makePackage(root, "probe-contract");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:25:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 1.2,
      video: { codec: "vp9", width: 720, height: 1280 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(
    report.jobs[0].blockers.includes("materialized_clip_probe_contract_mismatch"),
    JSON.stringify(report.jobs[0]),
  );
  assert.match(report.jobs[0].failed[0].rejected[0].error, /duration_seconds/);
  assert.match(report.jobs[0].failed[0].rejected[0].error, /video_codec/);
  assert.match(report.jobs[0].failed[0].rejected[0].error, /width/);
  assert.match(report.jobs[0].failed[0].rejected[0].error, /height/);
});

test("real motion materializer requires explicit available and decodable probe truth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-probe-truth-"));
  const job = await makePackage(root, "probe-truth");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:27:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: () => ({
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_unavailable"));
  assert.equal(report.jobs[0].failed[0].rejected[0].error, "materialized_clip_probe_incomplete");
});

test("real motion materializer accepts a real tiny H.264 fixture only after production ffprobe verifies it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-real-ffprobe-"));
  const storyId = "real-ffprobe";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const sourcePaths = Array.from(
    { length: 5 },
    (_, index) => path.join(root, "test", "output", "fixtures", `official-source-${index + 1}.mp4`),
  );
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(sourcePaths[0]));
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "testsrc=size=320x180:rate=30",
    "-t", "1.8",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    sourcePaths[0],
  ], { windowsHide: true });
  for (const sourcePath of sourcePaths.slice(1)) {
    await fs.copy(sourcePaths[0], sourcePath);
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: sourcePaths.map((sourcePath, index) => ({
      id: `official-source-window-${index + 1}`,
      type: "motion_clip",
      kind: "video",
      source_family: `official_source_window_${index + 1}`,
      path: sourcePath,
      source_url: sourcePath,
      source_url_kind: "local_video_file",
      source_kind: "local_video_file",
      source_type: "official_trailer_segment_validator",
      materialize_source_window: true,
      mediaStartS: 0,
      durationS: 1.5,
      source_duration_s: 1.8,
      validated: true,
      segmentValidationPassed: true,
      commercial_use_allowed: true,
      risk_score: 0.2,
      licence_basis: "official_press_licence_v2",
      allowed_use: "editorial_short_form_only",
      allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
      credit_required: true,
      evidence_reference: sourcePath,
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_segment_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    })),
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });

  const report = await materializeGoalRealMotionProduction({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    generatedAt: "2026-07-15T04:30:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const manifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(manifest.clips.length, 5);
  const clip = manifest.clips[0];
  assert.equal(clip.materialized_file_evidence.video_codec, "h264");
  assert.equal(clip.materialized_file_evidence.width, 1080);
  assert.equal(clip.materialized_file_evidence.height, 1920);
  assert.ok(Math.abs(clip.materialized_file_evidence.duration_seconds - 1.5) <= 0.12);
  assert.equal(clip.materialized_duration_s, clip.materialized_file_evidence.duration_seconds);
  execFileSync("ffprobe", ["-v", "error", "-show_format", clip.path], {
    windowsHide: true,
    stdio: "ignore",
  });
  assert.ok(manifest.clips.every((entry) => entry.materialized_file_evidence.video_codec === "h264"));
});

test("real motion materializer rejects malformed MP4 bytes through production ffprobe", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-malformed-ffprobe-"));
  const storyId = "malformed-ffprobe";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const clipPath = path.join(root, "output", "video_cache", `${storyId}.mp4`);
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, Buffer.from("not-an-mp4"));
  const validClipPaths = Array.from(
    { length: 4 },
    (_, index) => path.join(root, "output", "video_cache", `${storyId}-valid-${index + 2}.mp4`),
  );
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "color=c=blue:size=1080x1920:rate=24",
    "-t", "2",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    validClipPaths[0],
  ], { windowsHide: true });
  for (const validClipPath of validClipPaths.slice(1)) {
    await fs.copy(validClipPaths[0], validClipPath);
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [clipPath, ...validClipPaths].map((localPath, index) => ({
        id: index === 0 ? "malformed-official-window" : `valid-official-window-${index + 1}`,
        source_family: `official_window_${index + 1}`,
        path: localPath,
        local_materialized_path: localPath,
        source_url: `https://cdn.example.com/official-window-${index + 1}.mp4`,
        source_type: "official_trailer",
        mediaStartS: 0,
        durationS: 2,
        media_kind: "direct_video",
        materialized: true,
        counts_towards_motion_readiness: true,
        validated: true,
        segmentValidationPassed: true,
        provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "segment_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
        },
      })),
    },
  );

  const report = await materializeGoalRealMotionProduction({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    generatedAt: "2026-07-15T04:35:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_unavailable"));
  assert.match(report.jobs[0].failed[0].error, /ffprobe|Command failed/i);
});

test("real motion materializer rejects a valid MP4 container whose video payload cannot be decoded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-corrupt-payload-"));
  const storyId = "corrupt-payload";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const clipPath = path.join(root, "output", "video_cache", `${storyId}.mp4`);
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(path.dirname(clipPath));
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "testsrc2=size=1080x1920:rate=24",
    "-t", "1.5",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    clipPath,
  ], { windowsHide: true });
  const validClipPaths = Array.from(
    { length: 4 },
    (_, index) => path.join(root, "output", "video_cache", `${storyId}-valid-${index + 2}.mp4`),
  );
  for (const validClipPath of validClipPaths) {
    await fs.copy(clipPath, validClipPath);
  }
  const bytes = await fs.readFile(clipPath);
  const mdatTypeOffset = bytes.indexOf(Buffer.from("mdat"));
  assert.ok(mdatTypeOffset >= 4, "fixture must contain an mdat atom");
  const declaredMdatSize = bytes.readUInt32BE(mdatTypeOffset - 4);
  const payloadStart = mdatTypeOffset + 4;
  const payloadEnd = Math.min(bytes.length, mdatTypeOffset - 4 + declaredMdatSize);
  assert.ok(payloadEnd - payloadStart > 256, "fixture must contain a material video payload");
  bytes.fill(0, payloadStart, payloadEnd);
  await fs.writeFile(clipPath, bytes);
  execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", clipPath], {
    windowsHide: true,
    stdio: "ignore",
  });
  assert.throws(() => execFileSync("ffmpeg", [
    "-v", "error",
    "-xerror",
    "-i", clipPath,
    "-map", "0:v:0",
    "-f", "null",
    "-",
  ], { windowsHide: true, stdio: "ignore" }));

  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [] },
  });
  await fs.outputJson(
    path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`),
    {
      story_id: storyId,
      source: "validated_real_motion_materializer",
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [clipPath, ...validClipPaths].map((localPath, index) => ({
        id: index === 0 ? "corrupt-official-window" : `valid-official-window-${index + 1}`,
        source_family: `official_window_${index + 1}`,
        path: localPath,
        local_materialized_path: localPath,
        source_url: `https://cdn.example.com/official-window-${index + 1}.mp4`,
        source_type: "official_trailer",
        mediaStartS: 0,
        durationS: 1.5,
        media_kind: "direct_video",
        materialized: true,
        counts_towards_motion_readiness: true,
        validated: true,
        segmentValidationPassed: true,
        provenance: {
          source: "official_trailer_segment_validation",
          validation_reason: "segment_samples_passed",
          segment_validated: true,
          allowed_for_flash_lane: true,
        },
      })),
    },
  );

  const report = await materializeGoalRealMotionProduction({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    generatedAt: "2026-07-15T05:30:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_decode_failed"));
  assert.match(report.jobs[0].failed[0].error, /materialized_clip_decode_failed/);
});

test("real motion materializer rejects conflicting validator provenance instead of synthesising it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-validator-conflict-"));
  const job = await makePackage(root, "validator-conflict");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    validation_provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: index === 0 ? "different_validator_verdict" : "segment_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:40:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => ({
      available: fs.existsSync(filePath),
      decodable: fs.existsSync(filePath),
      duration_seconds: 2.85,
      video: { codec: "h264", width: 1080, height: 1920 },
    }),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("validation_provenance_conflict"));
  assert.match(report.jobs[0].failed[0].rejected[0].error, /validation_reason/);
});

test("real motion materializer preserves rejected segment-report validation provenance and blocks conflicts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-segment-provenance-rejected-"));
  const job = await makePackage(root, "segment-provenance-rejected");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  await fs.writeJson(rightsPath, { verdict: "pass", failures: [], records: [] }, { spaces: 2 });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: job.story_id,
      id: `segment-${index + 1}`,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/segment_${index + 1}.mp4?tag=14`,
      source_url_kind: "direct_video",
      source_type: "licensed_direct_media_url",
      source_family: `official_segment_family_${index + 1}`,
      provider: "official_trailer_segment_validation",
      entity: "Forza Horizon 6",
      media_start_s: index * 4,
      duration_s: 3,
      source_duration_s: 60,
      validation_reason: "top_level_claims_validated",
      validation_provenance: index === 0
        ? {
            source: "independent_segment_validator",
            verdict: "rejected",
            segment_validated: false,
            allowed_for_flash_lane: false,
            validation_reason: "decoder_frame_check_failed",
          }
        : {
            source: "independent_segment_validator",
            verdict: "pass",
            segment_validated: true,
            allowed_for_flash_lane: true,
            validation_reason: "decoder_frame_check_passed",
          },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    segmentValidationReport,
    generatedAt: "2026-07-15T05:20:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("validation_provenance_conflict"));
  assert.match(JSON.stringify(report.jobs[0].failed), /decoder_frame_check_failed/);
});

test("real motion materializer fails the story closed when any selected direct clip cannot be probed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-probe-fail-"));
  const job = await makePackage(root, "probe-fail-closed");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets.push({
    ...rights.assets[0],
    id: "probe-fail-closed-direct-6",
    source_family: "forza_official_family_6",
    path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_6.mp4?tag=14",
    source_url: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_6.mp4?tag=14",
    mediaStartS: 13,
    provenance: {
      ...rights.assets[0].provenance,
      media_start_s: 13,
    },
  });
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  let probeCalls = 0;

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T03:00:00.000Z",
    maxClips: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => {
      probeCalls += 1;
      if (probeCalls === 1) throw new Error("probe_failed");
      return {
        available: fs.existsSync(filePath),
        decodable: true,
        duration_seconds: 2.85,
        video: { codec: "h264", width: 1080, height: 1920 },
      };
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].status, "blocked");
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_unavailable"));
  const blockedManifest = await fs.readJson(
    path.join(job.artifact_dir, "materialised_motion_clips.json"),
  );
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);
  assert.ok(blockedManifest.blockers.includes("materialized_clip_evidence_unavailable"));
});

test("real motion materializer rejects a clip that changes while same-run evidence is captured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-evidence-race-"));
  const job = await makePackage(root, "evidence-race");
  let probeCalls = 0;

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T03:15:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => {
      probeCalls += 1;
      if (probeCalls === 1) fs.writeFileSync(filePath, Buffer.alloc(4096, 9));
      return {
        available: true,
        decodable: true,
        duration_seconds: 2.85,
        video: { codec: "h264", width: 1080, height: 1920 },
      };
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.jobs[0].status, "blocked");
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_unavailable"));
  assert.equal(
    report.jobs[0].failed[0].rejected[0].error,
    "materialized_clip_changed_during_evidence_capture",
  );
});

test("real motion materializer rejects inconsistent repeated evidence captures for fresh clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-repeat-capture-"));
  const job = await makePackage(root, "repeat-capture");
  const callsByPath = new Map();

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T04:45:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: (filePath) => {
      const call = (callsByPath.get(filePath) || 0) + 1;
      callsByPath.set(filePath, call);
      return {
        available: fs.existsSync(filePath),
        decodable: fs.existsSync(filePath),
        duration_seconds: call === 1 ? 2.85 : 2.77,
        video: { codec: "h264", width: 1080, height: 1920 },
      };
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("materialized_clip_evidence_mismatch"));
  assert.match(report.jobs[0].failed[0].error, /duration_seconds/);
  assert.ok([...callsByPath.values()].every((count) => count === 2));
});

test("real motion materializer blocks repeated validated official segments when the rights ledger is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-segment-rights-"));
  const job = await makePackage(root, "hellraiser-segment-motion");
  await fs.remove(path.join(job.artifact_dir, "rights_ledger.json"));
  const calls = [];
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: job.story_id,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url:
        "https://video.fastly.steamstatic.com/store_trailers/1551980/965080935/hash/hls_264_master.m3u8",
      source_url_kind: "hls_manifest",
      source_type: "licensed_direct_media_url",
      source_family: "steam_1551980_clive_barker_s_hellraiser_revival",
      provider: "official_intake",
      entity: "Hellraiser: Revival",
      media_start_s: 36 + index * 4,
      duration_s: 5,
      source_duration_s: 81.7,
      validation_reason: "official_storefront_cinematic_motion_samples_passed",
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-22T01:20:00.000Z",
    segmentValidationReport,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  assert.equal(calls.length, 1);

  const partial = await fs.readJson(path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.distinct_motion_family_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  const blockedManifest = await fs.readJson(
    path.join(job.artifact_dir, "materialised_motion_clips.json"),
  );
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);
});

test("real motion materializer keeps two validated rights-backed windows from one official trailer without making a looped candidate ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-two-official-windows-"));
  const job = await makePackage(root, "avatar-legends-two-official-windows");
  await fs.outputJson(path.join(job.artifact_dir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/2424420/1420437155/hash/1780517930/hls_264_master.m3u8?t=1780519515";
  const segmentValidationReport = {
    segments: [36, 48, 54, 60, 66].map((start, index) => ({
      story_id: job.story_id,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: sourceUrl,
      source_url_kind: "hls_manifest",
      source_type: "licensed_direct_media_url",
      source_family: `steam_avatar_legends_window_${index + 1}`,
      provider: "licensed_direct_media_acquisition",
      entity: "Avatar Legends",
      media_start_s: start,
      duration_s: 5,
      source_duration_s: 55,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      validation_reason: index < 2
        ? "official_storefront_trailer_motion_samples_passed"
        : "official_storefront_cinematic_motion_samples_passed",
    })),
  };
  const calls = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          ...job,
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["validated_segment_report_artifact_root_repair"],
            },
          ],
        },
      ],
    },
    generatedAt: "2026-07-06T22:45:00.000Z",
    minClips: 6,
    minFamilies: 5,
    maxClips: 8,
    segmentValidationReport,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 2);
  assert.equal(report.jobs[0].distinct_motion_family_count, 2);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 2);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 2);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 3);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  assert.equal(calls.length, 2);

  const partial = await fs.readJson(path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(partial.clip_count, 2);
  assert.equal(partial.counts_towards_final_render_readiness, false);
  const blockedManifest = await fs.readJson(
    path.join(job.artifact_dir, "materialised_motion_clips.json"),
  );
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);
});

test("real motion materializer replenishes visually rejected windows before applying the source cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-visual-replenish-"));
  const job = await makePackage(root, "visual-replenish-story");
  await fs.outputJson(path.join(job.artifact_dir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const sources = [
    "https://cdn.publisher.example/official/source-a.mp4",
    "https://cdn.publisher.example/official/source-b.mp4",
    "https://cdn.publisher.example/official/source-c.mp4",
  ];
  const segments = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
      segments.push({
        id: `source-${sourceIndex + 1}-window-${windowIndex + 1}`,
        story_id: job.story_id,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_url: sources[sourceIndex],
        source_url_kind: "direct_video",
        source_type: "official_publisher_promotional_video",
        provider: "official_publisher",
        entity: "Visual Replenish Game",
        source_family: `source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        base_source_family: `source_${sourceIndex + 1}`,
        media_start_s: 9 + windowIndex * 12,
        duration_s: 5,
        source_duration_s: 90,
        validation_reason: "official_publisher_motion_samples_passed",
        licence_basis: "official_publisher_promotional_editorial_use",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
        commercial_use_allowed: true,
        credit_required: true,
        evidence_reference: sources[sourceIndex],
        risk_score: 0.2,
      });
    }
  }
  const rejectedIds = new Set([
    "source-1-window-1",
    "source-2-window-1",
    "source-3-window-1",
  ]);
  const inspectedIds = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-18T13:00:00.000Z",
    minClips: 5,
    minFamilies: 5,
    maxClips: 6,
    maxDirectClipsPerBaseSource: 2,
    segmentValidationReport: { segments },
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 31));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `fingerprint:${clip.id}`,
    clipVisualEligibility: async (clip) => {
      inspectedIds.push(clip.id);
      return rejectedIds.has(clip.id)
        ? { eligible: false, reasons: ["direct_motion_frame_taste_failed"] }
        : { eligible: true, reasons: [] };
    },
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.jobs[0].materialized_count, 6);
  assert.equal(report.jobs[0].skipped_visual_quality_count, 3);
  assert.deepEqual(
    new Set(report.jobs[0].skipped_visual_quality.map((row) => row.id)),
    rejectedIds,
  );
  assert.ok([...rejectedIds].every((id) => inspectedIds.includes(id)));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  const selectedIds = new Set(manifest.clips.map((clip) => clip.id));
  assert.equal(selectedIds.has("source-1-window-1"), false);
  assert.equal(selectedIds.has("source-2-window-1"), false);
  assert.deepEqual(selectedIds, new Set([
    "source-1-window-2",
    "source-1-window-3",
    "source-2-window-2",
    "source-2-window-3",
    "source-3-window-2",
    "source-3-window-3",
  ]));
});

test("real motion materializer can use second validated windows across a diverse official source pool", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-diverse-segments-"));
  const job = await makePackage(root, "diverse-segment-motion");
  await fs.remove(path.join(job.artifact_dir, "rights_ledger.json"));
  const sourceUrls = [
    "https://cdn.example.com/official/trailer-a.mp4",
    "https://cdn.example.com/official/trailer-b.mp4",
    "https://cdn.example.com/official/trailer-c.mp4",
    "https://cdn.example.com/official/trailer-d.mp4",
  ];
  const starts = [12, 28, 14, 31, 20, 18];
  const segmentValidationReport = {
    segments: starts.map((start, index) => ({
      story_id: job.story_id,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: sourceUrls[index % sourceUrls.length],
      source_url_kind: "direct_video",
      source_type: "licensed_direct_media_url",
      source_family: `official_source_${(index % sourceUrls.length) + 1}`,
      provider: "official_intake",
      entity: "Diverse Official Trailer Pool",
      media_start_s: start,
      duration_s: 5,
      source_duration_s: 90,
      validation_reason: "segment_samples_passed",
      ...commercialEditorialRights(sourceUrls[index % sourceUrls.length]),
    })),
  };
  const calls = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-29T04:15:00.000Z",
    minClips: 6,
    minFamilies: 5,
    maxClips: 8,
    segmentValidationReport,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 6);
  assert.equal(calls.length, 6);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 2);
  assert.equal(report.jobs[0].skipped_duplicate_direct_window_count, 0);
  assert.ok(report.jobs[0].direct_motion_base_source_clip_counts.every((row) => row.count <= 2));

  const materialised = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.distinct_motion_family_count, 6);
  const windowKeys = new Set(
    materialised.clips.map((clip) =>
      `${clip.source_url}|${Number(clip.mediaStartS || 0).toFixed(2)}|${Number(clip.durationS || 0).toFixed(2)}`,
    ),
  );
  assert.equal(windowKeys.size, 6);
  for (const sourceUrl of sourceUrls) {
    const windows = materialised.clips
      .filter((clip) => clip.source_url === sourceUrl)
      .map((clip) => ({
        start: Number(clip.mediaStartS || 0),
        duration: Number(clip.durationS || 0),
      }))
      .sort((left, right) => left.start - right.start);
    for (let index = 1; index < windows.length; index += 1) {
      assert.ok(windows[index - 1].start + windows[index - 1].duration <= windows[index].start);
    }
  }
});

test("real motion materializer can use distinct Steam trailer windows without repeating clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-steam-window-pool-"));
  const job = await makePackage(root, "steam-window-pool");
  await fs.remove(path.join(job.artifact_dir, "rights_ledger.json"));
  const sourceUrls = [
    "https://video.fastly.steamstatic.com/store_trailers/4508340/1063067670/124f9933661f1d67c8ec56e87a1c39d6bf13cba2/1782964104/hls_264_master.m3u8?t=1782977946",
    "https://video.fastly.steamstatic.com/store_trailers/4508340/1402388194/6d07028ab86498b9ccc87ab8a736ca1928d9df57/1778038743/hls_264_master.m3u8?t=1779501599",
  ];
  const segmentValidationReport = {
    segments: [8, 20, 32, 10, 24, 38].map((start, index) => ({
      story_id: job.story_id,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: sourceUrls[index % sourceUrls.length],
      source_url_kind: "hls_manifest",
      source_type: "steam_movie",
      source_family: `steam_trailer_${(index % sourceUrls.length) + 1}_window_${start}_5`,
      provider: "steam_storefront",
      entity: "NTE: Neverness to Everness",
      media_start_s: start,
      duration_s: 5,
      source_duration_s: 90,
      validation_reason: "official_storefront_trailer_motion_samples_passed",
      ...commercialEditorialRights(sourceUrls[index % sourceUrls.length]),
    })),
  };
  const calls = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-08T22:20:00.000Z",
    minClips: 6,
    minFamilies: 5,
    maxClips: 8,
    segmentValidationReport,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 6);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 3);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [3, 3],
  );
  assert.equal(report.jobs[0].skipped_duplicate_direct_window_count, 0);
  assert.equal(calls.length, 6);

  const materialised = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.distinct_motion_family_count, 6);
  const windowKeys = new Set(
    materialised.clips.map((clip) =>
      `${clip.source_url}|${Number(clip.mediaStartS || 0).toFixed(2)}|${Number(clip.durationS || 0).toFixed(2)}`,
    ),
  );
  assert.equal(windowKeys.size, 6);
});

test("real motion materializer turns rights-recorded screenshots into motion clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-stills-"));
  const storyId = "steam-still-motion";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imageDir = path.join(root, "output", "image_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(imageDir);
  const assets = [];
  for (let index = 0; index < 5; index += 1) {
    const imagePath = path.join(imageDir, `${storyId}_${index + 1}.jpg`);
    await fs.writeFile(imagePath, Buffer.alloc(2048, index + 1));
    assets.push({
      asset_id: `${storyId}-screenshot-${index + 1}`,
      kind: "visual",
      asset_type: "visual",
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      path: imagePath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/ss_${index + 1}.jpg`,
      licence_basis: "official_storefront_screenshot_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
      commercial_use_allowed: true,
      credit_required: true,
      evidence_reference: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/ss_${index + 1}.jpg`,
      risk_score: 0.2,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {},
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-23T08:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(report.summary.screenshot_derived_motion_clip_count, 5);
  assert.equal(report.safety.direct_media_only, false);
  assert.equal(report.safety.direct_video_or_screenshot_derived_only, true);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.media_kind === "visual_still"));

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.ok(rights.records.every((record) => record.asset_type === "screenshot_derived_motion_clip"));
});

test("real motion materializer does not count screenshot-derived MP4s as genuine base video sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-stills-base-source-"));
  const storyId = "strict-still-base-source";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imageDir = path.join(root, "output", "image_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(imageDir);
  const assets = [];
  for (let index = 0; index < 5; index += 1) {
    const imagePath = path.join(imageDir, `${storyId}_${index + 1}.jpg`);
    await fs.writeFile(imagePath, Buffer.alloc(2048, index + 1));
    assets.push({
      asset_id: `${storyId}-screenshot-${index + 1}`,
      kind: "visual",
      asset_type: "visual",
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      path: imagePath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/456/ss_${index + 1}.jpg`,
      commercial_use_allowed: true,
      risk_score: 0.2,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {},
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        ultimate_quality_bar: true,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    strictBaseSourceDiversity: true,
    minBaseSources: 2,
    generatedAt: "2026-07-15T06:05:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 16));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(
    report.jobs[0].blockers.includes("genuine_base_source_minimum_not_met"),
    JSON.stringify(report.jobs[0]),
  );
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.distinct_motion_families.length, 5);
  assert.deepEqual(materialised.distinct_source_families, []);
});

test("real motion materializer accepts official stills with extensionless CDN source URLs when a local file exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-official-stills-"));
  const localStill = path.join(root, "official-stills", "mega_mewtwo_x.jpg");
  await fs.outputFile(localStill, Buffer.alloc(2048, 4));
  const sourceUrl = "https://lh3.googleusercontent.com/example-image%3Ds0-e365";

  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          asset_id: "pokemon-go-mega-mewtwo-official-still",
          asset_type: "visual_still",
          source_type: "official_press_kit_stills",
          source_family: "pokemon_go_mega_mewtwo_x",
          path: localStill,
          source_url: sourceUrl,
          approval_status: "approved_for_transformative_editorial_use",
          commercial_use_allowed: true,
          risk_score: 0.28,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].media_kind, "visual_still");
  assert.equal(rows[0].path, localStill);
  assert.equal(rows[0].source_url, sourceUrl);
});

test("real motion materializer does not satisfy direct-video repair with screenshot-only motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-direct-block-"));
  const storyId = "direct-video-required";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imageDir = path.join(root, "output", "image_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(imageDir);
  const assets = [];
  for (let index = 0; index < 5; index += 1) {
    const imagePath = path.join(imageDir, `${storyId}_${index + 1}.jpg`);
    await fs.writeFile(imagePath, Buffer.alloc(2048, index + 1));
    assets.push({
      asset_id: `${storyId}-screenshot-${index + 1}`,
      kind: "visual",
      asset_type: "visual",
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      path: imagePath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/ss_${index + 1}.jpg`,
      commercial_use_allowed: true,
      risk_score: 0.2,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", assets });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), { story_id: storyId, motion_inventory: {} });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    generatedAt: "2026-05-23T16:25:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.summary.attempted_materialized_clip_count, 5);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_missing"));
  const blockedManifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);
});

test("real motion materializer can repair only the direct-video gap without discarding existing motion families", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-direct-only-"));
  const storyId = "steam-controller-direct-gap";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const existingClips = Array.from({ length: 4 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    path: path.join(root, "output", "owned-motion", `${storyId}-${index + 1}.mp4`),
    source_url: `generated://owned-motion/${storyId}/${index + 1}`,
    source_family: `owned_graphics_family_${index + 1}`,
    motion_family: `owned_graphics_family_${index + 1}`,
    source_type: "owned_generated_motion",
    media_kind: "owned_motion",
    durationS: 3,
    mediaStartS: 0,
    validated: true,
    materialized: true,
    counts_towards_motion_readiness: true,
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "finished_editorial_video",
    allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: `generated://owned-motion/${storyId}/${index + 1}`,
    risk_score: 0,
  }));
  existingClips.push({
    id: "stale-direct-motion",
    path: path.join(root, "output", "video_cache", `${storyId}_old_collision.mp4`),
    source_url: "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282",
    source_family: "steam_353370_37301",
    motion_family: "steam_353370_37301",
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    durationS: 5,
    mediaStartS: 36,
    validated: true,
    materialized: true,
    counts_towards_motion_readiness: true,
  });
  for (const [index, clip] of existingClips.entries()) {
    await fs.outputFile(clip.path, Buffer.alloc(4096, index + 1));
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });
  const directUrl =
    "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: {
      status: "v4_motion_blocked",
      blockers: ["distinct_motion_families_minimum_not_met"],
    },
    clips: [
      {
        id: "steam-controller-direct-window",
        type: "motion_clip",
        source_family: "steam_353370_37301",
        path: directUrl,
        source_url: directUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "official_platform_product_page",
        provider: "steam",
        entity: "Steam Controller",
        mediaStartS: 36,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
        ...commercialEditorialRights(directUrl),
        provenance: {
          source_report: "official_trailer_segment_validation",
          validation_reason: "official_product_motion_samples_passed",
        },
      },
    ],
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        evidence: {
          file_evidence: {
            materialised_motion_ready: true,
            distinct_motion_families_ready: true,
            materialised_motion_clip_count: 5,
            distinct_motion_family_count: 5,
          },
        },
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    generatedAt: "2026-05-26T20:00:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].repair_scope, "direct_video_gap_only");
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 1);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "owned_motion").length, 4);
  assert.ok(materialised.clips.every((clip) => !clip.path.includes("old_collision")));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.production_motion_clips.length, 5);
  assert.equal(footage.motion_inventory.direct_video_motion_asset_count, 1);
});

test("real motion materializer completes a motion floor by merging governed existing and new validated clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-incremental-motion-"));
  const storyId = "ascend-incremental-motion";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const existingClips = [];
  const sharedOfficialTrailerUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2697940/launch.m3u8";
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `${storyId}-existing-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 1));
    existingClips.push({
      id: `segment_direct_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sharedOfficialTrailerUrl,
      source_family: `steam_launch_window_${index + 1}`,
      base_source_family: "steam_launch",
      motion_family: `steam_launch_window_${index + 1}`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: 12 + index * 6,
      rights_basis: "official_direct_media",
      ...commercialEditorialRights(sharedOfficialTrailerUrl),
      counts_towards_motion_readiness: true,
      materialized: true,
      validated: false,
      segmentValidationPassed: false,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "gameplay_action_samples_passed",
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    readiness: {
      status: "blocked",
      blockers: ["real_motion_clip_minimum_not_met"],
    },
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });

  const segmentValidationReport = {
    segments: Array.from({ length: 3 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "trimmed_segment_samples_passed",
      segment_motion_class: "gameplay_action",
      source_url: sharedOfficialTrailerUrl,
      source_type: "steam_movie",
      source_url_kind: "direct_video",
      provider: "steam",
      entity: "Ascend to ZERO",
      source_family: `youtube_official_${index + 1}`,
      media_start_s: 48 + index * 12,
      duration_s: 5,
      source_duration_s: 90,
      rights_risk_class: "official_publisher_promotional_video",
      allowed_render_use: "transformative_editorial_short_form",
      ...commercialEditorialRights(sharedOfficialTrailerUrl),
      provenance: {
        source: "official_trailer_segment_validator",
        base_source_family: "steam_launch",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["real_motion_clip_minimum_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["real_motion_clip_minimum_not_met"],
        }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-07-13T16:00:00.000Z",
    minClips: 8,
    minFamilies: 8,
    maxClips: 3,
    maxDirectClipsPerBaseSource: 8,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0], null, 2),
  );
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].repair_scope, "incremental_motion_completion");
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].total_motion_clip_count, 8);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 8);
  assert.equal(materialised.distinct_motion_family_count, 8);
  assert.equal(new Set(materialised.clips.map((clip) => clip.id)).size, 8);
  const preserved = materialised.clips.find(
    (clip) => Number(clip.mediaStartS) === 12,
  );
  assert.ok(preserved);
  assert.match(preserved.id, /^segment_direct_motion_1(?:__window_[a-f0-9]+)?$/);
  assert.equal(preserved.validated, true);
  assert.equal(preserved.provenance.segment_validated, true);
  assert.equal(preserved.provenance.allowed_for_flash_lane, true);
});

test("real motion materializer excludes rejected existing clips during incremental replacement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-incremental-exclusion-"));
  const storyId = "black-flag-incremental-exclusion";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });

  const existingClips = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(
      root,
      "output",
      "video_cache",
      `${storyId}-existing-${index + 1}.mp4`,
    );
    const sourceUrl =
      `https://video.akamai.steamstatic.com/store_trailers/2697940/source-${index + 1}.m3u8`;
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 1));
    existingClips.push({
      id: `existing-motion-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrl,
      source_family: `existing_official_window_${index + 1}`,
      base_source_family: `existing_official_source_${index + 1}`,
      motion_family: `existing_official_window_${index + 1}`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: 12 + index * 6,
      rights_basis: "official_direct_media",
      ...commercialEditorialRights(sourceUrl),
      counts_towards_motion_readiness: true,
      materialized: true,
      validated: true,
      segmentValidationPassed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "gameplay_action_samples_passed",
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    readiness: {
      status: "blocked",
      blockers: ["visual_motion_repeat_repair_required"],
    },
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });

  const replacementSource =
    "https://video.akamai.steamstatic.com/store_trailers/2697940/replacement.m3u8";
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_motion_repeat_repair_required"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_motion_repeat_repair_required"],
        }],
      }],
    },
    segmentValidationReport: {
      segments: [
        {
          id: "existing-motion-2",
          story_id: storyId,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "rejected_segment_must_not_be_reintroduced",
          segment_motion_class: "gameplay_action",
          source_url:
            "https://video.akamai.steamstatic.com/store_trailers/2697940/rejected.m3u8",
          source_type: "steam_movie",
          source_url_kind: "direct_video",
          provider: "steam",
          entity: "Assassin's Creed Black Flag",
          source_family: "rejected_official_window",
          media_start_s: 36,
          duration_s: 5,
          source_duration_s: 90,
          rights_risk_class: "official_publisher_promotional_video",
          allowed_render_use: "transformative_editorial_short_form",
          ...commercialEditorialRights(
            "https://video.akamai.steamstatic.com/store_trailers/2697940/rejected.m3u8",
          ),
        },
        {
          id: "replacement-motion",
          story_id: storyId,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "replacement_segment_samples_passed",
          segment_motion_class: "gameplay_action",
          source_url: replacementSource,
          source_type: "steam_movie",
          source_url_kind: "direct_video",
          provider: "steam",
          entity: "Assassin's Creed Black Flag",
          source_family: "replacement_official_window",
          media_start_s: 48,
          duration_s: 5,
          source_duration_s: 90,
          rights_risk_class: "official_publisher_promotional_video",
          allowed_render_use: "transformative_editorial_short_form",
          ...commercialEditorialRights(replacementSource),
        },
        {
          id: "replacement-motion-2",
          story_id: storyId,
          status: "validated",
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "second_replacement_segment_samples_passed",
          segment_motion_class: "gameplay_action",
          source_url:
            "https://video.akamai.steamstatic.com/store_trailers/2697940/replacement-2.m3u8",
          source_type: "steam_movie",
          source_url_kind: "direct_video",
          provider: "steam",
          entity: "Assassin's Creed Black Flag",
          source_family: "replacement_official_window_2",
          media_start_s: 60,
          duration_s: 5,
          source_duration_s: 90,
          rights_risk_class: "official_publisher_promotional_video",
          allowed_render_use: "transformative_editorial_short_form",
          ...commercialEditorialRights(
            "https://video.akamai.steamstatic.com/store_trailers/2697940/replacement-2.m3u8",
          ),
        },
      ],
    },
    generatedAt: "2026-07-19T21:15:00.000Z",
    minClips: 5,
    minFamilies: 5,
    maxClips: 3,
    excludedClipIds: ["existing-motion-2"],
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 29));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.equal(report.jobs[0].repair_scope, "incremental_motion_completion");
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.equal(report.jobs[0].total_motion_clip_count, 5);
  assert.equal(
    materialised.clips.some((clip) => clip.id === "existing-motion-2"),
    false,
  );
  assert.ok(
    materialised.clips.some((clip) => clip.source_url === replacementSource),
  );
  assert.ok(
    materialised.clips.some((clip) =>
      clip.source_url.endsWith("/replacement-2.m3u8"),
    ),
  );
});

test("real motion materializer recovers strict selector clips after a partial repair invalidates the footage inventory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-selector-recovery-"));
  const storyId = "arknights-selector-recovery";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(path.join(artifactDir, "qa", "direct-motion"));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    status: "blocked",
    readiness: {
      status: "blocked",
      blockers: ["real_motion_clip_minimum_not_met"],
    },
    motion_inventory: {
      production_motion_clips: [],
      accepted_local_clips: [],
    },
  });

  const recoveredClips = [];
  for (let index = 0; index < 7; index += 1) {
    recoveredClips.push(await makeGovernedSelectorClip(root, storyId, index));
  }
  await fs.outputJson(
    path.join(artifactDir, "qa", "direct-motion", "final_selection_dense_selector_report.json"),
    {
      version: "pulse_direct_motion_visual_selector_v5",
      policy_tier: "ultimate_professional",
      blockers: [],
      input_clip_count: recoveredClips.length,
      selected_clip_count: recoveredClips.length,
      clips: recoveredClips,
      source_diversity: {
        strict_pass: true,
        reasons: [],
        blockers: [],
      },
      professional_source_diversity: {
        status: "pass",
        strict_pass: true,
        blockers: [],
      },
    },
  );

  const segmentValidationReport = {
    segments: Array.from({ length: 3 }, (_, index) => {
      const directUrl = `https://cdn.official.example.com/arknights/trailer-${index + 1}.mp4`;
      return {
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "trimmed_segment_samples_passed",
        segment_motion_class: "gameplay_action",
        source_url: directUrl,
        canonical_source_url: directUrl,
        youtube_video_id: `official-${index + 1}`,
        source_master_sha256: `${index + 8}`.repeat(64).slice(0, 64),
        source_type: "official_publisher_promotional_video",
        source_url_kind: "direct_video",
        provider: "youtube",
        entity: "Arknights: Endfield",
        source_family: `official_youtube_window_${index + 1}`,
        media_start_s: 18 + index * 12,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_publisher_promotional_video",
        allowed_render_use: "transformative_editorial_short_form",
        ...commercialEditorialRights(directUrl),
        provenance: {
          source: "official_trailer_segment_validator",
          base_source_family: `official_youtube_base_${index + 1}`,
        },
      };
    }),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["real_motion_clip_minimum_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["real_motion_clip_minimum_not_met"],
        }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-07-17T00:15:00.000Z",
    minClips: 10,
    minFamilies: 10,
    minBaseSources: 8,
    strictBaseSourceDiversity: true,
    maxClips: 3,
    maxDirectClipsPerBaseSource: 2,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0], null, 2),
  );
  assert.equal(report.jobs[0].repair_scope, "incremental_motion_completion");
  assert.equal(report.jobs[0].recovered_selector_clip_count, 7);
  assert.equal(report.jobs[0].total_motion_clip_count, 10);
  assert.equal(
    report.jobs[0].professional_source_diversity.observed_genuine_base_source_count,
    10,
  );

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 10);
  assert.equal(materialised.distinct_motion_family_count, 10);
  assert.ok(
    materialised.clips.some((clip) => clip.id === "selector_direct_motion_1"),
    "strict selector clip should be recovered into the authoritative inventory",
  );
});

test("real motion refresh rebuilds a stale blocked inventory only from the exact hash-bound ready pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-stale-inventory-recovery-"));
  const storyId = "black-flag-stale-inventory-recovery";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const rightsEvidencePath = path.join(root, "rights", "publisher-video-policy.pdf");
  const rightsEvidenceBytes = Buffer.alloc(4096, 71);
  await fs.outputFile(rightsEvidencePath, rightsEvidenceBytes);
  const rightsEvidenceSha256 = crypto
    .createHash("sha256")
    .update(rightsEvidenceBytes)
    .digest("hex");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed Black Flag Resynced",
  });

  const clips = [];
  for (let index = 0; index < 5; index += 1) {
    clips.push({
      ...(await makeGovernedSelectorClip(root, storyId, index)),
      evidence_file: rightsEvidencePath,
      rights_evidence_file: rightsEvidencePath,
      evidence_kind: "publisher_video_policy",
      evidence_sha256: rightsEvidenceSha256,
      rights_evidence_sha256: rightsEvidenceSha256,
      evidence_size_bytes: rightsEvidenceBytes.length,
      rights_evidence_size_bytes: rightsEvidenceBytes.length,
      transformative_rights_evidence_verified: true,
      rights_grant: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: "2026-07-19T19:25:00.000Z",
    clips,
    materialised_clips: clips,
    clip_count: clips.length,
    distinct_motion_family_count: clips.length,
    distinct_genuine_base_source_count: clips.length,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    status: "blocked",
    ready: false,
    motion_ready: false,
    readiness: {
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers: [
        "validation_provenance_conflict",
        "refresh_window_plan_incomplete",
        "real_motion_clip_minimum_not_met",
        "real_motion_family_minimum_not_met",
        "stale_ready_footage_inventory_unvalidated",
      ],
    },
    motion_inventory: {
      status: "blocked",
      ready: false,
      motion_ready: false,
      counts_towards_final_render_readiness: false,
      production_motion_clips: clips.map((clip) => ({
        ...clip,
        counts_towards_motion_readiness: false,
        validation_provenance_conflicts: ["older_validation_snapshot"],
      })),
      accepted_local_clips: clips.map((clip) => ({
        ...clip,
        counts_towards_motion_readiness: false,
        validation_provenance_conflicts: ["older_validation_snapshot"],
      })),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    status: "ready",
    records: clips.map((clip) => ({
      ...clip,
      asset_id: clip.id,
      kind: "video",
      asset_type: "motion_clip",
    })),
    failures: [],
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Passed Three Million Sales",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        ultimate_quality_bar: true,
        strict_base_source_diversity: true,
        required_genuine_base_source_count: 5,
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    generatedAt: "2026-07-19T19:30:00.000Z",
    minClips: 5,
    minFamilies: 5,
    minBaseSources: 5,
    strictBaseSourceDiversity: true,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 1,
    clipVisualFingerprint: async (clip) => `fingerprint:${clip.id}`,
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0], null, 2),
  );
  assert.equal(report.jobs[0].repair_scope, "stale_inventory_authority_reconciliation");
  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.status, "ready");
  assert.equal(footage.readiness.status, "v4_motion_ready");
  assert.deepEqual(footage.readiness.blockers, []);
  assert.equal(footage.motion_inventory.production_motion_clips.length, 5);
  assert.ok(
    footage.motion_inventory.production_motion_clips.every(
      (clip) =>
        clip.counts_towards_motion_readiness === true &&
        clip.recovery_provenance?.mode ===
          "hash_bound_ready_materialised_inventory_reconciliation",
    ),
  );
});

test("stale inventory recovery rejects changed media bytes and non-reconcilable blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-stale-inventory-reject-"));
  const storyId = "black-flag-stale-inventory-reject";
  const evidencePath = path.join(root, "rights", "publisher-video-policy.pdf");
  const evidenceBytes = Buffer.alloc(4096, 81);
  await fs.outputFile(evidencePath, evidenceBytes);
  const evidenceSha256 = crypto
    .createHash("sha256")
    .update(evidenceBytes)
    .digest("hex");
  const clip = {
    ...(await makeGovernedSelectorClip(root, storyId, 0)),
    evidence_file: evidencePath,
    rights_evidence_file: evidencePath,
    evidence_kind: "publisher_video_policy",
    evidence_sha256: evidenceSha256,
    rights_evidence_sha256: evidenceSha256,
    evidence_size_bytes: evidenceBytes.length,
    rights_evidence_size_bytes: evidenceBytes.length,
    transformative_rights_evidence_verified: true,
    rights_grant: true,
  };
  const materialised = {
    story_id: storyId,
    status: "ready",
    clips: [clip],
  };
  const footage = {
    story_id: storyId,
    status: "blocked",
    readiness: {
      status: "v4_motion_blocked",
      blockers: ["stale_ready_footage_inventory_unvalidated"],
    },
    motion_inventory: {
      production_motion_clips: [{
        ...clip,
        counts_towards_motion_readiness: false,
      }],
    },
  };

  assert.equal(
    governedStaleInventoryRecoveryRows(footage, materialised, { root }).length,
    1,
  );

  const originalBytes = await fs.readFile(clip.path);
  await fs.writeFile(clip.path, Buffer.alloc(originalBytes.length, 82));
  assert.deepEqual(
    governedStaleInventoryRecoveryRows(footage, materialised, { root }),
    [],
  );

  await fs.writeFile(clip.path, originalBytes);
  footage.readiness.blockers.push("operator_subject_review_required");
  assert.deepEqual(
    governedStaleInventoryRecoveryRows(footage, materialised, { root }),
    [],
  );
});

test("real motion materializer refuses incomplete or non-green selector recovery evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-selector-reject-"));
  const storyId = "arknights-selector-reject";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(path.join(artifactDir, "qa", "direct-motion"));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      production_motion_clips: [],
      accepted_local_clips: [],
    },
  });
  const incompleteClip = await makeGovernedSelectorClip(root, storyId, 0);
  delete incompleteClip.materialized_file_evidence.sha256;
  delete incompleteClip.asset_sha256;
  await fs.outputJson(
    path.join(artifactDir, "qa", "direct-motion", "final_selection_dense_selector_report.json"),
    {
      policy_tier: "ultimate_professional",
      blockers: ["independent_visual_review_amber"],
      selected_clip_count: 1,
      clips: [incompleteClip],
      source_diversity: {
        strict_pass: true,
        blockers: [],
      },
      professional_source_diversity: {
        status: "pass",
        strict_pass: true,
        blockers: [],
      },
    },
  );

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["real_motion_clip_minimum_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["real_motion_clip_minimum_not_met"],
        }],
      }],
    },
    segmentValidationReport: {
      segments: [{
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "trimmed_segment_samples_passed",
        source_url: "https://official.example.com/new.mp4",
        source_type: "official_publisher_promotional_video",
        source_url_kind: "direct_video",
        provider: "official",
        entity: "Arknights: Endfield",
        source_family: "new_window",
        media_start_s: 18,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_publisher_promotional_video",
        allowed_render_use: "transformative_editorial_short_form",
        provenance: {
          source: "official_trailer_segment_validator",
          base_source_family: "new_base",
        },
      }],
    },
    generatedAt: "2026-07-17T00:20:00.000Z",
    minClips: 2,
    minFamilies: 2,
    maxClips: 1,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].recovered_selector_clip_count, 0);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
});

test("real motion materializer can use validated segment reports to repair a direct-video gap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-report-"));
  const storyId = "pokemon-segment-direct-gap";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const existingClips = Array.from({ length: 4 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    path: path.join(root, "output", "owned-motion", `${storyId}-${index + 1}.mp4`),
    source_url: `generated://owned-motion/${storyId}/${index + 1}`,
    source_family: `owned_graphics_family_${index + 1}`,
    motion_family: `owned_graphics_family_${index + 1}`,
    source_type: "owned_generated_motion",
    media_kind: "owned_motion",
    durationS: 3,
    mediaStartS: 0,
    validated: true,
    materialized: true,
    counts_towards_motion_readiness: true,
    licence_basis: "pulse_owned_original_graphics",
    allowed_use: "owned_editorial_motion",
    allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
    commercial_use_allowed: true,
    credit_required: false,
    evidence_reference: `owned://motion/${storyId}/${index + 1}`,
    risk_score: 0,
  }));
  for (const [index, clip] of existingClips.entries()) {
    await fs.outputFile(clip.path, Buffer.alloc(4096, index + 1));
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "short_direct_media_detail_motion_samples_passed",
      source_url:
        `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
      source_type: "licensed_direct_media_url",
      source_url_kind: "direct_video",
      provider: "licensed_direct_media_acquisition",
      entity: "Pokemon Go",
      source_family: `pokemon_go_official_direct_${index + 1}`,
      media_start_s: 4 + index * 2,
      duration_s: 5,
      source_duration_s: 42,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      ...commercialEditorialRights(
        `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
      ),
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-05-27T16:40:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  assert.equal(report.jobs[0].repair_scope, "direct_video_gap_only");
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 5);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.direct_video_motion_asset_count, 5);
  assert.equal(materialised.direct_video_motion_family_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "owned_motion").length, 4);
});

test("real motion materializer cuts validator-approved windows from an in-repo official local master", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-local-official-master-"));
  const storyId = "paleo-pines-local-official";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const localMaster = path.join(root, "test", "output", `${storyId}-official-xbox.mp4`);
  await fs.ensureDir(artifactDir);
  await fs.outputFile(localMaster, "official Xbox master fixture");
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: { accepted_local_clips: [], production_motion_clips: [] },
  });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "official_product_motion_samples_passed",
      segment_motion_class: "official_product_motion",
      source_url: localMaster,
      source_type: "official_platform_product_page",
      source_url_kind: "local_video_file",
      provider: "xbox_official_youtube_local_editorial_intake",
      entity: "Paleo Pines",
      source_family: "xbox_official_paleo_pines_major_update",
      media_start_s: 12 + index * 7,
      duration_s: 5,
      source_duration_s: 66.4,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      risk_score: 0.28,
      ...commercialEditorialRights(localMaster),
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    })),
  };
  const calls = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    segmentValidationReport,
    minClips: 5,
    minFamilies: 4,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.outputFileSync(args[args.length - 1], `cropped-window-${calls.length}`);
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.args[call.args.indexOf("-i") + 1] === localMaster));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.path !== localMaster));
  assert.ok(materialised.clips.every((clip) => clip.source_url === localMaster));
});

test("real motion materializer rejects unofficial or out-of-repo local masters", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-local-source-safety-"));
  const inRepoFile = path.join(root, "test", "output", "creator-reupload.mp4");
  const outsideFile = path.join(os.tmpdir(), `pulse-outside-${Date.now()}.mp4`);
  await fs.outputFile(inRepoFile, "unofficial fixture");
  await fs.outputFile(outsideFile, "outside fixture");
  const segment = (sourceUrl, overrides = {}) => ({
    story_id: "local-source-safety",
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    validation_reason: "segment_samples_passed",
    source_url: sourceUrl,
    source_type: "official_platform_product_page",
    source_url_kind: "local_video_file",
    provider: "xbox_official_youtube_local_editorial_intake",
    entity: "Safety Fixture",
    media_start_s: 10,
    duration_s: 5,
    risk_score: 0.28,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
    },
    ...overrides,
  });

  const rows = candidateRows({
    root,
    storyId: "local-source-safety",
    segmentValidationReport: {
      segments: [
        segment(inRepoFile, {
          source_type: "creator_reupload",
          provider: "unofficial_creator_reference",
        }),
        segment(outsideFile),
      ],
    },
  });

  assert.deepEqual(rows, []);
});

test("segment-report candidates preserve governed crop, rights and source identity evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-governance-"));
  const storyId = "segment-governance";
  const sourcePath = path.join(root, "test", "output", "official-master.mp4");
  await fs.outputFile(sourcePath, "official fixture");
  const sourceIdentityProvenance = {
    schema_version: 1,
    kind: "pulse_source_identity_sidecar",
    status: "resolved",
    sidecar_path: `${sourcePath}.source-identity.json`,
    sidecar_sha256: "a".repeat(64),
    identity_scope: "source_identity_only",
    rights_grant: false,
  };

  const rows = candidateRows({
    root,
    storyId,
    segmentValidationReport: {
      segments: [{
        id: "official-window",
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "independent_twenty_frame_review_passed",
        source_url: sourcePath,
        canonical_source_url: "https://www.youtube.com/watch?v=OfficialVideo1",
        youtube_video_id: "OfficialVideo1",
        source_master_sha256: "b".repeat(64),
        source_identity_provenance: sourceIdentityProvenance,
        source_type: "official_youtube_channel_url",
        source_url_kind: "local_video_file",
        provider: "official_youtube_channel",
        source_owner: "Official Publisher",
        entity: "Flagship Game",
        source_family: "youtube:OfficialVideo1",
        media_start_s: 30,
        duration_s: 5,
        source_duration_s: 90,
        source_crop_top_px: 80,
        source_crop_bottom_px: 120,
        licence_basis: "official_publisher_promotional_editorial_use",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
        commercial_use_allowed: true,
        credit_required: true,
        evidence_reference: "https://www.youtube.com/watch?v=OfficialVideo1",
        risk_score: 0.25,
        provenance: {
          source: "official_trailer_segment_validation",
          segment_validated: true,
          allowed_for_flash_lane: true,
        },
      }],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_crop_top_px, 80);
  assert.equal(rows[0].source_crop_bottom_px, 120);
  assert.equal(rows[0].licence_basis, "official_publisher_promotional_editorial_use");
  assert.equal(rows[0].allowed_use, "transformative_editorial_short_form");
  assert.deepEqual(
    rows[0].allowed_platforms,
    ["youtube_shorts", "instagram_reels", "facebook_reels"],
  );
  assert.equal(rows[0].commercial_use_allowed, true);
  assert.equal(rows[0].credit_required, true);
  assert.equal(rows[0].evidence_reference, "https://www.youtube.com/watch?v=OfficialVideo1");
  assert.equal(rows[0].source_owner, "Official Publisher");
  assert.deepEqual(rows[0].source_identity_provenance, sourceIdentityProvenance);
  assert.equal(rows[0].rights_field_presence.allowed_platforms, true);
  assert.equal(rows[0].rights_field_presence.credit_required, true);
});

test("real motion materializer can synthesize jobs from segment reports and an artifact root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-artifact-root-"));
  const storyId = "fresh-refill-yooka";
  const artifactRoot = path.join(root, "output", "candidate-supply", "fresh-refill", "goal-proof-batch");
  const artifactDir = path.join(artifactRoot, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 82 + index,
      source_url:
        `https://video.fastly.steamstatic.com/store_trailers/3348210/${1321458709 + index}/hash/hls_264_master.m3u8`,
      source_type: "platform_storefront",
      source_url_kind: "hls_manifest",
      provider: "official_intake",
      entity: "Super Yooka-Laylee Kart",
      source_family: `steam_3348210_super_yooka_laylee_kart_${index + 1}`,
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 72,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      ...commercialEditorialRights(
        `https://video.fastly.steamstatic.com/store_trailers/3348210/${1321458709 + index}/hash/hls_264_master.m3u8`,
      ),
      provenance: {
        source: "official_trailer_segment_validation",
      },
    })),
  };

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [] },
    storyIds: [storyId],
    artifactRoot,
    segmentValidationReport,
    minClips: 5,
    minFamilies: 1,
    maxClips: 5,
    generatedAt: "2026-06-21T23:30:00.000Z",
    execFileSync: (bin, args) => {
      starts.push(args[args.indexOf("-ss") + 1]);
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, starts.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });
  const materializedRights = await fs.readJson(
    path.join(artifactDir, "rights_ledger.json"),
  );

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.jobs[0].story_id, storyId);
  assert.equal(materializedRights.story_id, storyId);
  assert.equal(report.jobs[0].artifact_dir, artifactDir);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(
    await fs.pathExists(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`)),
    true,
  );
  assert.deepEqual(starts, ["36", "42", "48", "54", "60"]);
});

test("real motion materializer blocks repeated windows from one direct video source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-window-families-"));
  const storyId = "granblue-official-window-families";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrl =
    "https://vulcan.dl.playstation.net/img/rnd/202606/1802/granblue-relink-demo.mp4";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 82,
      source_url: sourceUrl,
      source_type: "official_game_site_news_page",
      source_url_kind: "direct_video",
      provider: "official_intake",
      entity: "Granblue Fantasy: Relink",
      source_family: "playstation_blog_granblue_relink_demo",
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 104.92,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    generatedAt: "2026-06-20T09:45:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  const blockedManifest = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);

  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.not_publishable, true);
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.distinct_motion_family_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.equal(partial.clips.length, 1);
  assert.match(partial.clips[0].base_source_family, /^url:https:\/\/vulcan\.dl\.playstation\.net\/img\/rnd\/202606\/1802\/granblue-relink-demo\.mp4$/);
  assert.equal(
    partial.clips[0].transformation_provenance?.base_source_family,
    partial.clips[0].base_source_family,
  );
});

test("real motion materializer treats Steam HLS and DASH variants from one trailer as one source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-steam-variant-families-"));
  const storyId = "steam-variant-family";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const base =
    "https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626";
  const urls = [
    `${base}/hls_264_master.m3u8?t=1781798240`,
    `${base}/dash_av1.mpd?t=1781798240`,
    `${base}/dash_h264.mpd?t=1781798240`,
    `${base}/hls_264_master.m3u8?t=1781798240`,
    `${base}/dash_av1.mpd?t=1781798240`,
  ];
  const segmentValidationReport = {
    segments: urls.map((sourceUrl, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 88,
      source_url: sourceUrl,
      source_type: "official_platform_product_page",
      source_url_kind: sourceUrl.includes("hls_") ? "hls_manifest" : "dash_manifest",
      provider: "licensed_direct_media_acquisition",
      entity: "The Adventures Of Elliot",
      source_family: `steam_3483510_elliot_variant_${index + 1}`,
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 130,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    generatedAt: "2026-06-25T01:05:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));

  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.match(
    partial.clips[0].base_source_family,
    /^steamstatic:\/store_trailers\/3483510\/632943268\/ab5efa5d538a2c90f09927047b2df6199cf5e9d6\/1780277626$/,
  );
});

test("real motion materializer reconciles stale owned-motion distinct family budgets after real media repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-budget-reconcile-"));
  const storyId = "pokemon-budget-reconcile";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const assets = Array.from({ length: 6 }, (_, index) => ({
    id: `${storyId}-direct-${index + 1}`,
    type: "motion_clip",
    kind: "video",
    source_family: `pokemon_go_official_family_${index + 1}`,
    path: `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
    source_url: `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "licensed_direct_media_url",
    entity: "Pokemon Go",
    mediaStartS: 4 + index * 2,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: true,
    rights_risk_class: "official_direct_media",
    allowed_render_use: "official_direct_media_segment_candidate",
    ...commercialEditorialRights(
      `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
    ),
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
        "no_trusted_footage_references_for_story",
      ],
      warnings: [],
    },
    motion_budget: {
      required_motion_scenes: 6,
      available_motion_clips: 0,
      required_distinct_families: 9,
      available_distinct_families: 0,
      steam_metric_story: false,
      review_score_story: false,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-28T13:10:00.000Z",
    maxClips: 6,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_budget.required_motion_scenes, 6);
  assert.equal(footage.motion_budget.available_motion_clips, 6);
  assert.equal(footage.motion_budget.required_distinct_families, 6);
  assert.equal(footage.motion_budget.available_distinct_families, 6);
  assert.equal(footage.readiness.status, "v4_motion_ready");
  assert.deepEqual(footage.readiness.blockers, []);
});

test("real motion materializer refuses to mark a story ready below motion thresholds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-block-"));
  const job = await makePackage(root, "under-threshold");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = rights.assets.slice(0, 2);
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T08:11:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.equal(report.jobs[0].partial_evidence_path, path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  const blockedManifest = await fs.readJson(
    path.join(job.artifact_dir, "materialised_motion_clips.json"),
  );
  assert.equal(blockedManifest.status, "blocked");
  assert.equal(blockedManifest.not_publishable, true);

  const partial = await fs.readJson(path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.not_publishable, true);
  assert.equal(partial.counts_towards_final_render_readiness, false);
  assert.equal(partial.clip_count, 2);
  assert.equal(partial.direct_video_motion_asset_count, 2);
  assert.equal(partial.distinct_motion_family_count, 2);
  assert.ok(partial.blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(partial.clips.every((clip) => clip.materialized === true));
  assert.ok(partial.clips.every((clip) => clip.counts_towards_motion_readiness === false));
});

test("real motion materializer skips visually duplicate clips from different source URLs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-visual-dedupe-"));
  const job = await makePackage(root, "visual-dedupe");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = Array.from({ length: 6 }, (_, index) => ({
    ...rights.assets[index % rights.assets.length],
    id: `visual-dedupe-direct-${index + 1}`,
    source_family: `visual_dedupe_family_${index + 1}`,
    path: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/visual-${index + 1}.mp4?tag=14`,
    source_url: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/visual-${index + 1}.mp4?tag=14`,
    mediaStartS: index * 5,
    visual_test_signature: index < 2 ? "same-visual-content" : `unique-visual-${index + 1}`,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-14T18:30:00.000Z",
    maxClips: 5,
    clipVisualFingerprint: async (clip) =>
      ["visual-dedupe-direct-1", "visual-dedupe-direct-2"].includes(clip.id)
        ? "same-visual-content"
        : `unique-${clip.id}`,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0], null, 2));
  assert.equal(report.jobs[0].materialized_count, 5);
  assert.equal(report.jobs[0].distinct_motion_family_count, 5);
  assert.equal(report.jobs[0].skipped_visual_duplicate_count, 1);
  assert.equal(report.jobs[0].skipped_visual_duplicates[0].id, "visual-dedupe-direct-2");
  assert.equal(report.jobs[0].clips.some((clip) => clip.id === "visual-dedupe-direct-6"), true);
});

test("real motion materializer preserves and blocks restrictive candidate rights statuses from assets and matched assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-candidate-rights-status-"));
  const job = await makePackage(root, "candidate-rights-status");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const restrictiveFields = [
    ["approval_status", "rejected"],
    ["rights_status", "failed_rights_review"],
    ["usage_status", "blocked"],
    ["status", "denied"],
    ["verdict", "red"],
  ];
  const candidates = rights.assets.map((asset, index) => ({
    ...asset,
    [restrictiveFields[index][0]]: restrictiveFields[index][1],
  }));
  rights.assets = candidates.slice(0, 3);
  rights.matched_assets = candidates.slice(3);
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const normalised = candidateRows({ rightsLedger: rights });
  assert.equal(normalised.length, 5);
  for (const [field, value] of restrictiveFields) {
    assert.equal(normalised.some((candidate) => candidate[field] === value), true, field);
  }

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:00:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_candidate_rejected"));
  assert.equal(
    report.jobs[0].failed.filter((failure) => failure.blockers?.includes("rights_candidate_rejected")).length,
    5,
  );
});

test("real motion materializer never waives an explicit failed ledger approval as missing-record repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-ledger-approval-failed-"));
  const job = await makePackage(root, "ledger-approval-failed");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.approval_status = "failed";
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:05:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_ledger_rejected"));
  const preserved = await fs.readJson(rightsPath);
  assert.equal(preserved.approval_status, "failed");
  assert.equal(preserved.verdict, "fail");
});

test("real motion materializer merges incomplete explicit provenance with every legacy negative", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-provenance-merge-negative-"));
  const job = await makePackage(root, "provenance-merge-negative");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const legacyNegatives = [
    { segment_validated: false },
    { allowed_for_flash_lane: false },
    { validation_status: "validation_failed" },
    { review: { status: "rejected" } },
    { decision: { verdict: "failed" } },
  ];
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    provenance: {
      ...asset.provenance,
      ...legacyNegatives[index],
    },
    validation_provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "explicit_record_is_incomplete",
    },
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const normalised = candidateRows({ rightsLedger: rights });
  assert.equal(normalised.length, 5);
  assert.equal(normalised[0].validation_provenance.segment_validated, false);
  assert.equal(normalised[1].validation_provenance.allowed_for_flash_lane, false);
  assert.equal(normalised[2].validation_provenance.validation_status, "validation_failed");
  assert.equal(normalised[3].validation_provenance.review.status, "rejected");
  assert.equal(normalised[4].validation_provenance.decision.verdict, "failed");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:10:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("validation_provenance_conflict"));
  assert.equal(
    report.jobs[0].failed.filter((failure) => failure.blockers?.includes("validation_provenance_conflict")).length,
    5,
  );
});

test("real motion materializer excludes false-count identical preserved clips from every readiness floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-false-preserved-clips-"));
  const storyId = "false-preserved-clips";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const cacheDir = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(cacheDir);
  const preservedClips = [];
  for (let index = 0; index < 4; index += 1) {
    const clipPath = path.join(cacheDir, `identical-screenshot-${index + 1}.mp4`);
    await fs.writeFile(clipPath, Buffer.alloc(4096, 4));
    preservedClips.push({
      id: `identical-screenshot-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/screenshot-${index + 1}.jpg`,
      source_family: `fake_screenshot_family_${index + 1}`,
      motion_family: `fake_screenshot_family_${index + 1}`,
      source_type: "screenshot_derived_motion_clip",
      media_kind: "visual_still",
      durationS: 3,
      mediaStartS: 0,
      materialized: true,
      counts_towards_motion_readiness: false,
    });
  }
  const directUrl = "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/direct.mp4?tag=14";
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [{
      id: "only-direct-clip",
      type: "motion_clip",
      source_family: "only_direct_family",
      path: directUrl,
      source_url: directUrl,
      source_kind: "direct_video",
      source_type: "official_social_media_video",
      mediaStartS: 8,
      durationS: 5,
      validated: true,
      segmentValidationPassed: true,
      trusted_source_matched: true,
      commercial_use_allowed: true,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    }],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: preservedClips,
      production_motion_clips: preservedClips,
      distinct_source_families: preservedClips.map((clip) => clip.source_family),
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    generatedAt: "2026-07-15T05:15:00.000Z",
    clipVisualFingerprint: async (clip) =>
      String(clip.id || "").startsWith("identical-screenshot") ? "same-screenshot" : clip.id,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "blocked");
  assert.equal(materialised.clips.filter((clip) => clip.counts_towards_motion_readiness === true).length, 0);
});

test("real motion materializer demotes stale ready manifests when every existing candidate fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-all-candidates-fail-stale-"));
  const storyId = "all-candidates-fail-stale";
  const job = await makePackage(root, storyId);
  const staleClip = {
    id: "stale-undersized-clip",
    path: path.join(root, "output", "video_cache", "stale-undersized.mp4"),
    local_materialized_path: path.join(root, "output", "video_cache", "stale-undersized.mp4"),
    source_url: "https://cdn.example.com/stale-undersized.mp4",
    source_family: "stale_family",
    media_kind: "direct_video",
    durationS: 5,
    materialized: true,
    counts_towards_motion_readiness: true,
  };
  await fs.outputFile(staleClip.path, Buffer.alloc(4096, 3));
  await fs.outputJson(path.join(job.artifact_dir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "ready",
    clips: [staleClip],
    clip_count: 1,
  });
  const centralPath = path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`);
  await fs.outputJson(centralPath, {
    story_id: storyId,
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips: [],
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:20:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: () => {
      throw new Error("candidate_probe_failed");
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].stale_ready_evidence_invalidated, true);
  assert.ok(report.jobs[0].blockers.includes("stale_ready_motion_manifest_unvalidated"));
  assert.ok(report.jobs[0].blockers.includes("stale_ready_central_motion_pack_unvalidated"));
  assert.equal((await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"))).status, "blocked");
  assert.equal((await fs.readJson(centralPath)).readiness.status, "v4_motion_blocked");
});

test("real motion materializer requires affirmative candidate validation and preserves validator state", () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/620/99999/hash/movie_max.mp4";
  const common = {
    type: "motion_clip",
    source_url: sourceUrl,
    path: sourceUrl,
    source_type: "official_steam_trailer_video",
    source_kind: "direct_video",
    provider: "steam",
    source_family: "steam_620_99999",
    mediaStartS: 4,
    durationS: 5,
    commercial_use_allowed: true,
    risk_score: 0.2,
  };
  const candidates = candidateRows({
    rightsLedger: {
      assets: [
        {
          ...common,
          id: "missing-affirmative-validation",
        },
        {
          ...common,
          id: "affirmatively-validated",
          validated: true,
          segmentValidationPassed: true,
          segment_validation_status: "validated",
          validation_provenance_conflicts: ["validator:legacy_source_conflict"],
          validation_provenance: {
            source: "official_trailer_segment_validator",
            segment_validated: true,
            allowed_for_flash_lane: true,
          },
        },
      ],
    },
  });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["affirmatively-validated"]);
  assert.equal(candidates[0].segment_validation_status, "validated");
  assert.deepEqual(
    candidates[0].validation_provenance_conflicts,
    ["validator:legacy_source_conflict"],
  );
});

test("real motion materializer does not let positive flags override a rejected top-level segment status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rejected-segment-status-"));
  const job = await makePackage(root, "rejected-segment-status");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset) => ({
    ...asset,
    segment_validation_status: "rejected",
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T06:00:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 14));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("candidate_segment_validation_rejected"));
  assert.equal(report.jobs[0].failed[0].candidate.segment_validation_status, "rejected");
});

test("real motion materializer preserves and rejects top-level segment-report validation conflicts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-segment-report-conflict-"));
  const job = await makePackage(root, "segment-report-conflict");
  await fs.writeJson(path.join(job.artifact_dir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    records: [],
  }, { spaces: 2 });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: job.story_id,
      id: `segment-report-${index + 1}`,
      status: "validated",
      segment_validation_status: index === 0 ? "rejected" : "validated",
      validation_provenance_conflicts: index === 0 ? ["validator:source_identity_conflict"] : [],
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/report_${index + 1}.mp4?tag=14`,
      source_url_kind: "direct_video",
      source_type: "licensed_direct_media_url",
      source_family: `official_report_family_${index + 1}`,
      provider: "official_trailer_segment_validation",
      entity: "Forza Horizon 6",
      media_start_s: index * 4,
      duration_s: 3,
      source_duration_s: 60,
      validation_reason: "top_level_claims_validated",
      provenance: {
        source: "official_trailer_segment_validator",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    segmentValidationReport,
    generatedAt: "2026-07-15T06:10:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 16));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("validation_provenance_conflict"));
  const rejected = report.jobs[0].failed.find(
    (failure) => failure.candidate?.id === "segment-report-1",
  );
  assert.equal(rejected.candidate.segment_validation_status, "rejected");
  assert.deepEqual(
    rejected.candidate.validation_provenance_conflicts,
    ["validator:source_identity_conflict"],
  );
});

test("real motion materializer rejects restrictive and high-risk preserved clips during rights reconciliation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-preserved-rights-"));
  const job = await makePackage(root, "preserved-rights-rejection");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.slice(0, 1);
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const preserved = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "owned-motion", `preserved-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 1));
    preserved.push({
      id: `preserved-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://cdn.example.com/official/preserved-${index + 1}.mp4`,
      source_family: `preserved_family_${index + 1}`,
      source_type: "official_social_media_video",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: index * 5,
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      commercial_use_allowed: true,
      risk_score: index === 1 ? 0.9 : 0.2,
      approval_status: index === 0 ? "rejected" : "approved_for_transformative_editorial_use",
      rights_verdict: index === 2 ? "RED" : undefined,
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    });
  }
  await fs.outputJson(path.join(job.artifact_dir, "footage_inventory.json"), {
    story_id: job.story_id,
    motion_inventory: {
      accepted_local_clips: preserved,
      production_motion_clips: preserved,
      distinct_source_families: preserved.map((clip) => clip.source_family),
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:30:00.000Z",
    maxClips: 1,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"));
  assert.ok(report.jobs[0].blockers.includes("rights_evidence_high_risk"));
  assert.equal(report.jobs[0].failed.some((failure) => failure.id === "preserved-1"), true);
  assert.equal(report.jobs[0].failed.some((failure) => failure.id === "preserved-2"), true);
  assert.equal(report.jobs[0].failed.some((failure) => failure.id === "preserved-3"), true);
});

test("real motion materializer cannot hide rejected preserved rights behind a permissive duplicate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-preserved-rights-duplicate-"));
  const job = await makePackage(root, "preserved-rights-duplicate");
  await fs.writeJson(path.join(job.artifact_dir, "rights_ledger.json"), {
    verdict: "pass",
    failures: [],
    assets: [],
    records: [],
  }, { spaces: 2 });

  const permissive = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "owned-motion", `preserved-duplicate-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(4096, index + 21));
    permissive.push({
      id: `preserved-duplicate-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/2697940/${index + 1}/hash-${index}/hls_264_master.m3u8`,
      source_family: `preserved_duplicate_family_${index + 1}`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      mediaStartS: index * 5,
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      rights_basis: "official_direct_media",
      commercial_use_allowed: true,
      risk_score: 0.2,
      approval_status: "approved_for_transformative_editorial_use",
      provenance: {
        source: "official_trailer_segment_validation",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    });
  }
  await fs.outputJson(path.join(job.artifact_dir, "footage_inventory.json"), {
    story_id: job.story_id,
    motion_inventory: {
      production_motion_clips: permissive,
      accepted_local_clips: [{
        ...permissive[0],
        approval_status: "rejected",
      }],
      distinct_source_families: permissive.map((clip) => clip.source_family),
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T06:20:00.000Z",
    includeReadyStories: true,
    storyIds: [job.story_id],
    maxClips: 5,
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(
    report.jobs[0].blockers.includes("rights_record_rejected"),
    JSON.stringify(report.jobs[0]),
  );
});

test("real motion materializer aggregates duplicate source-window rights fail-closed across every ledger collection", async (t) => {
  const collections = ["assets", "records", "matched_assets", "rights_ledger"];
  for (const collection of collections) {
    await t.test(collection, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `pulse-real-motion-rights-${collection}-`));
      const job = await makePackage(root, `duplicate-rights-${collection}`);
      const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
      const rights = await fs.readJson(rightsPath);
      rights.verdict = "pass";
      rights.failures = [];
      const duplicate = {
        ...rights.assets[0],
        id: `${rights.assets[0].id}-${collection}-rejection`,
        asset_id: `${rights.assets[0].id}-${collection}-rejection`,
        approval_status: "rejected",
      };
      if (collection === "assets") rights.assets.push(duplicate);
      else rights[collection] = [duplicate];
      await fs.writeJson(rightsPath, rights, { spaces: 2 });

      const report = await materializeGoalRealMotion({
        root,
        workOrder: { jobs: [job] },
        generatedAt: "2026-07-15T05:35:00.000Z",
        execFileSync: (_bin, args) => {
          fs.ensureFileSync(args[args.length - 1]);
          fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 10));
        },
        ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
      });

      assert.equal(report.summary.materialized_story_count, 0, collection);
      assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"), collection);
    });
  }

  await t.test("rights_verdict alias on a duplicate window", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-verdict-alias-"));
    const job = await makePackage(root, "duplicate-rights-verdict-alias");
    const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
    const rights = await fs.readJson(rightsPath);
    rights.verdict = "pass";
    rights.failures = [];
    rights.matched_assets = [{
      ...rights.assets[0],
      id: `${rights.assets[0].id}-rights-verdict-rejection`,
      asset_id: `${rights.assets[0].id}-rights-verdict-rejection`,
      rights_verdict: "RED",
    }];
    await fs.writeJson(rightsPath, rights, { spaces: 2 });

    const report = await materializeGoalRealMotion({
      root,
      workOrder: { jobs: [job] },
      generatedAt: "2026-07-15T05:35:30.000Z",
      execFileSync: (_bin, args) => {
        fs.ensureFileSync(args[args.length - 1]);
        fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 15));
      },
      ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    });

    assert.equal(report.summary.materialized_story_count, 0);
    assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"));
  });

  await t.test("rotated query token on the same source window", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-query-token-"));
    const job = await makePackage(root, "duplicate-rights-query-token");
    const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
    const rights = await fs.readJson(rightsPath);
    rights.verdict = "pass";
    rights.failures = [];
    const original = rights.assets[0];
    const rotatedUrl = original.source_url.replace(/\?.*$/, "?token=rotated-signature");
    rights.matched_assets = [{
      ...original,
      id: `${original.id}-rotated-query-rejection`,
      asset_id: `${original.id}-rotated-query-rejection`,
      path: rotatedUrl,
      source_url: rotatedUrl,
      approval_status: "rejected",
    }];
    await fs.writeJson(rightsPath, rights, { spaces: 2 });

    const report = await materializeGoalRealMotion({
      root,
      workOrder: { jobs: [job] },
      generatedAt: "2026-07-15T06:25:00.000Z",
      execFileSync: (_bin, args) => {
        fs.ensureFileSync(args[args.length - 1]);
        fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 17));
      },
      ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    });

    assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
    assert.equal(report.summary.blocked_story_count, 1);
    assert.ok(report.jobs[0].blockers.includes("rights_record_rejected"));
  });

  await t.test("conflicting duplicate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-rights-conflict-"));
    const job = await makePackage(root, "duplicate-rights-conflict");
    const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
    const rights = await fs.readJson(rightsPath);
    rights.verdict = "pass";
    rights.failures = [];
    rights.assets[0].allowed_use = "transformative_editorial_short_form";
    rights.matched_assets = [{
      ...rights.assets[0],
      id: `${rights.assets[0].id}-conflicting-use`,
      asset_id: `${rights.assets[0].id}-conflicting-use`,
      allowed_use: "internal_reference_only",
    }];
    await fs.writeJson(rightsPath, rights, { spaces: 2 });

    const report = await materializeGoalRealMotion({
      root,
      workOrder: { jobs: [job] },
      generatedAt: "2026-07-15T05:36:00.000Z",
      execFileSync: (_bin, args) => {
        fs.ensureFileSync(args[args.length - 1]);
        fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 11));
      },
      ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    });

    assert.equal(report.summary.materialized_story_count, 0);
    assert.ok(report.jobs[0].blockers.includes("rights_evidence_contradiction"));
  });
});

test("real motion materializer demotes stale owned-motion and footage readiness when all candidates fail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-stale-owned-footage-"));
  const job = await makePackage(root, "stale-owned-footage");
  const ownedPath = path.join(job.artifact_dir, "owned_motion_manifest.json");
  const footagePath = path.join(job.artifact_dir, "footage_inventory.json");
  await fs.outputJson(ownedPath, {
    story_id: job.story_id,
    status: "ready",
    ready: true,
    motion_ready: true,
    counts_towards_final_render_readiness: true,
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips: [],
  });
  await fs.outputJson(footagePath, {
    story_id: job.story_id,
    status: "ready",
    ready: true,
    motion_ready: true,
    counts_towards_final_render_readiness: true,
    readiness: { status: "v4_motion_ready", ready: true, can_publish: true, blockers: [] },
    motion_budget: {
      status: "ready",
      ready: true,
      motion_ready: true,
      available_motion_clips: 5,
      available_distinct_families: 5,
    },
    motion_inventory: {
      status: "ready",
      ready: true,
      motion_ready: true,
      counts_towards_final_render_readiness: true,
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: ["stale_a", "stale_b", "stale_c", "stale_d", "stale_e"],
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T05:40:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 12));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: () => {
      throw new Error("candidate_probe_failed");
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].stale_ready_evidence_invalidated, true);
  assert.ok(report.jobs[0].blockers.includes("stale_ready_owned_motion_manifest_unvalidated"));
  assert.ok(report.jobs[0].blockers.includes("stale_ready_footage_inventory_unvalidated"));
  const owned = await fs.readJson(ownedPath);
  const footage = await fs.readJson(footagePath);
  assert.equal(owned.status, "blocked");
  assert.equal(owned.ready, false);
  assert.equal(owned.motion_ready, false);
  assert.equal(owned.counts_towards_final_render_readiness, false);
  assert.equal(owned.readiness.status, "v4_motion_blocked");
  assert.equal(owned.readiness.ready, false);
  assert.equal(owned.readiness.can_publish, false);
  assert.equal(footage.status, "blocked");
  assert.equal(footage.ready, false);
  assert.equal(footage.motion_ready, false);
  assert.equal(footage.counts_towards_final_render_readiness, false);
  assert.equal(footage.readiness.status, "v4_motion_blocked");
  assert.equal(footage.readiness.ready, false);
  assert.equal(footage.readiness.can_publish, false);
  assert.equal(footage.motion_budget.status, "blocked");
  assert.equal(footage.motion_budget.ready, false);
  assert.equal(footage.motion_budget.motion_ready, false);
  assert.equal(footage.motion_budget.available_motion_clips, 0);
  assert.equal(footage.motion_budget.available_distinct_families, 0);
  assert.equal(footage.motion_inventory.status, "blocked");
  assert.equal(footage.motion_inventory.ready, false);
  assert.equal(footage.motion_inventory.motion_ready, false);
  assert.equal(footage.motion_inventory.counts_towards_final_render_readiness, false);
});

test("real motion materializer detects and demotes nested-only owned and footage readiness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-stale-nested-readiness-"));
  const job = await makePackage(root, "stale-nested-readiness");
  const ownedPath = path.join(job.artifact_dir, "owned_motion_manifest.json");
  const footagePath = path.join(job.artifact_dir, "footage_inventory.json");
  await fs.outputJson(ownedPath, {
    story_id: job.story_id,
    readiness: {
      ready: true,
      motion_ready: true,
      can_publish: true,
      blockers: [],
    },
    clips: [],
  });
  await fs.outputJson(footagePath, {
    story_id: job.story_id,
    motion_inventory: {
      status: "ready",
      ready: true,
      motion_ready: true,
      counts_towards_final_render_readiness: true,
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: ["stale_nested_family"],
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T06:30:00.000Z",
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 18));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    materializedClipProbe: () => {
      throw new Error("candidate_probe_failed");
    },
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].stale_ready_evidence_invalidated, true, JSON.stringify(report.jobs[0]));
  assert.ok(report.jobs[0].blockers.includes("stale_ready_owned_motion_manifest_unvalidated"));
  assert.ok(report.jobs[0].blockers.includes("stale_ready_footage_inventory_unvalidated"));
  const owned = await fs.readJson(ownedPath);
  const footage = await fs.readJson(footagePath);
  assert.equal(owned.readiness.ready, false);
  assert.equal(owned.readiness.can_publish, false);
  assert.equal(footage.motion_inventory.status, "blocked");
  assert.equal(footage.motion_inventory.ready, false);
  assert.equal(footage.motion_inventory.counts_towards_final_render_readiness, false);
});

test("real motion materializer persists compound base identities, collapses mirrors and blocks concentrated professional proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-immutable-sources-"));
  const job = await makePackage(root, "immutable-source-proof");
  job.ultimate_quality_bar = true;
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const sourceIndexes = [0, 0, 1, 1, 2];
  const masterHashes = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const canonicalUrls = [
    "https://www.youtube.com/watch?v=TrailerA01",
    "https://publisher.example.com/trailers/gameplay-b",
    "https://publisher.example.com/trailers/gameplay-c",
  ];
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => {
    const sourceIndex = sourceIndexes[index];
    return {
      ...asset,
      id: `immutable-window-${index + 1}`,
      path: `https://media${index + 1}.example.com/gameplay/master-${sourceIndex + 1}.mp4`,
      source_url: `https://media${index + 1}.example.com/gameplay/master-${sourceIndex + 1}.mp4`,
      canonical_source_url: canonicalUrls[sourceIndex],
      youtube_video_id: sourceIndex === 0 ? "TrailerA01" : undefined,
      source_master_sha256: masterHashes[sourceIndex],
      source_family: `mutable_window_name_${index + 1}`,
      base_source_family: `mutable_base_name_${index + 1}`,
      mediaStartS: index * 6,
      durationS: 5,
    };
  });
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T07:00:00.000Z",
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 23));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(
    report.jobs[0].blockers.includes(
      "professional_motion_source_concentration_above_floor",
    ),
  );
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.professional_source_diversity.status, "blocked");
  assert.equal(report.jobs[0].professional_source_diversity.status, "blocked");
  assert.equal(report.jobs[0].professional_source_diversity.observed_genuine_base_source_count, 3);
  assert.equal(manifest.professional_source_diversity.observed_genuine_base_source_count, 3);
  assert.equal(manifest.professional_source_diversity.unresolved_clips.length, 0);
  assert.equal(manifest.professional_source_diversity.identity_evidence.length, 3);
  assert.ok(manifest.clips.every((clip) => clip.motion_source_identity?.status === "resolved"));
  assert.ok(manifest.clips.every((clip) => clip.base_source_asset_id?.startsWith("sha256:")));
  const mirroredSource = manifest.professional_source_diversity.identity_evidence.find(
    (source) => source.base_source_asset_id === `sha256:${masterHashes[0]}`,
  );
  assert.equal(mirroredSource.clip_ids.length, 2);
  assert.ok(mirroredSource.aliases.includes("youtube:TrailerA01"));
});

test("real motion materializer fails an ultimate job closed when source URLs lack content identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-unresolved-identity-"));
  const job = await makePackage(root, "unresolved-source-identity");
  job.ultimate_quality_bar = true;
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T07:05:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 2,
    maxClips: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 24));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("professional_motion_source_identity_unresolved"));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.professional_source_diversity.status, "blocked");
  assert.equal(manifest.professional_source_diversity.unresolved_clips.length, 5);
  assert.ok(manifest.clips.every((clip) => clip.motion_source_identity?.status === "blocked"));
});

test("real motion materializer hashes validated local masters behind official canonical URLs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-local-master-hash-"));
  const job = await makePackage(root, "local-master-identity");
  const masterDir = path.join(root, "output", "official-masters");
  const masterPaths = [];
  const expectedHashes = [];
  for (let index = 0; index < 5; index += 1) {
    const masterPath = path.join(masterDir, `official-master-${index + 1}.mp4`);
    const bytes = Buffer.alloc(8192, index + 31);
    await fs.outputFile(masterPath, bytes);
    masterPaths.push(masterPath);
    expectedHashes.push(crypto.createHash("sha256").update(bytes).digest("hex"));
  }
  const sourceIndexes = [0, 1, 2, 3, 4];
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => {
    const sourceIndex = sourceIndexes[index];
    return {
      ...asset,
      id: `local-master-window-${index + 1}`,
      path: masterPaths[sourceIndex],
      source_url: masterPaths[sourceIndex],
      canonical_source_url: `https://publisher.example.com/official/master-${sourceIndex + 1}`,
      source_identity_provenance: {
        schema_version: 1,
        kind: "canonical_rights_record",
        status: "resolved",
        evidence_sha256: `${sourceIndex + 4}`.repeat(64),
      },
      source_kind: "local_video_file",
      source_url_kind: "local_video_file",
      materialize_source_window: true,
      source_family: `mutable_local_window_${index + 1}`,
      base_source_family: `mutable_local_master_${sourceIndex + 1}`,
      mediaStartS: index * 5,
      durationS: 4,
    };
  });
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const footagePath = path.join(job.artifact_dir, "footage_inventory.json");
  const footage = await fs.readJson(footagePath);
  footage.readiness = {
    ...(footage.readiness || {}),
    status: "v4_motion_blocked",
    ready: false,
    motion_ready: false,
    can_publish: false,
    blockers: ["professional_genuine_base_source_minimum_not_met"],
  };
  await fs.writeJson(footagePath, footage, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T07:10:00.000Z",
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 25));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 4 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  const reconciledFootage = await fs.readJson(footagePath);
  assert.equal(reconciledFootage.status, "ready");
  assert.equal(reconciledFootage.readiness.status, "v4_motion_ready");
  assert.deepEqual(reconciledFootage.readiness.blockers, []);
  assert.equal(manifest.professional_source_diversity.status, "pass");
  assert.equal(manifest.professional_source_diversity.observed_genuine_base_source_count, 5);
  assert.deepEqual(
    [...new Set(manifest.clips.map((clip) => clip.source_master_sha256))].sort(),
    expectedHashes.sort(),
  );
  assert.ok(manifest.clips.every((clip) => clip.motion_source_identity?.strict_pass === true));
  assert.ok(
    manifest.clips.every(
      (clip) => clip.source_identity_provenance?.kind === "canonical_rights_record",
    ),
  );
});

test("real motion materializer derives canonical identities from yt-dlp sidecars, collapses mirrors and blocks concentration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-sidecar-identity-"));
  const job = await makePackage(root, "sidecar-source-identity");
  job.ultimate_quality_bar = true;
  const masterRoot = path.join(root, "output", "official-masters");
  const sourceSpecs = [
    { directory: "primary-a", id: "OfficialA01", bytes: Buffer.alloc(8192, 41) },
    { directory: "mirror-a", id: "OfficialA01", bytes: Buffer.alloc(8192, 41) },
    { directory: "primary-b", id: "OfficialB02", bytes: Buffer.alloc(8192, 42) },
    { directory: "primary-c", id: "OfficialC03", bytes: Buffer.alloc(8192, 43) },
  ];
  const masterPaths = [];
  for (const spec of sourceSpecs) {
    const directory = path.join(masterRoot, spec.directory);
    const masterPath = path.join(directory, `${spec.id}.mp4`);
    await fs.outputFile(masterPath, spec.bytes);
    await fs.outputJson(path.join(directory, `${spec.id}.info.json`), {
      id: spec.id,
      webpage_url: `https://www.youtube.com/watch?v=${spec.id}`,
      extractor: "youtube",
      extractor_key: "Youtube",
      uploader: "Official Publisher",
      channel: "Official Publisher",
      title: `Official trailer ${spec.id}`,
    });
    masterPaths.push(masterPath);
  }

  const assetSources = [0, 1, 2, 2, 3];
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    id: `sidecar-window-${index + 1}`,
    path: masterPaths[assetSources[index]],
    source_url: masterPaths[assetSources[index]],
    source_kind: "local_video_file",
    source_url_kind: "local_video_file",
    materialize_source_window: true,
    source_family: `mutable_sidecar_window_${index + 1}`,
    base_source_family: `mutable_sidecar_base_${index + 1}`,
    mediaStartS: index * 5,
    durationS: 4,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T07:12:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 3,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 26));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 4 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(
    report.jobs[0].blockers.includes(
      "professional_motion_source_concentration_above_floor",
    ),
  );
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.professional_source_diversity.status, "blocked");
  assert.equal(manifest.professional_source_diversity.observed_genuine_base_source_count, 3);
  assert.ok(manifest.clips.every((clip) => clip.youtube_video_id));
  assert.ok(manifest.clips.every((clip) => clip.canonical_source_url?.startsWith("https://www.youtube.com/watch?v=")));
  assert.ok(manifest.clips.every((clip) => clip.source_master_sha256));
  assert.ok(manifest.clips.every((clip) => clip.source_identity_provenance?.kind === "yt_dlp_info_sidecar"));
  assert.ok(manifest.clips.every((clip) => clip.source_identity_provenance?.sidecar_sha256));
  assert.equal(manifest.clips[0].base_source_asset_id, manifest.clips[1].base_source_asset_id);
  assert.equal(
    manifest.professional_source_diversity.identity_evidence.find(
      (row) => row.base_source_asset_id === manifest.clips[0].base_source_asset_id,
    ).clip_ids.length,
    2,
  );
});

test("real motion materializer exposes mismatched sidecar provenance and fails ultimate proof closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-sidecar-conflict-"));
  const job = await makePackage(root, "sidecar-conflict-proof");
  job.ultimate_quality_bar = true;
  const masterRoot = path.join(root, "output", "official-masters");
  const masterPaths = [];
  for (let index = 0; index < 5; index += 1) {
    const id = `TrustedSource${index + 1}`;
    const masterPath = path.join(masterRoot, `${id}.mp4`);
    await fs.outputFile(masterPath, Buffer.alloc(8192, index + 51));
    await fs.outputJson(path.join(masterRoot, `${id}.info.json`), {
      id,
      webpage_url: `https://www.youtube.com/watch?v=${index === 0 ? "WrongSource99" : id}`,
      extractor: "youtube",
      uploader: "Official Publisher",
      title: `Official trailer ${id}`,
    });
    masterPaths.push(masterPath);
  }

  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    id: `conflict-window-${index + 1}`,
    path: masterPaths[index],
    source_url: masterPaths[index],
    source_kind: "local_video_file",
    source_url_kind: "local_video_file",
    materialize_source_window: true,
    source_family: `mutable_conflict_window_${index + 1}`,
    mediaStartS: index * 5,
    durationS: 4,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T07:14:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 2,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 27));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 4 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("professional_motion_source_identity_unresolved"));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  const unresolved = manifest.professional_source_diversity.unresolved_clips.find(
    (clip) => clip.clip_id === "conflict-window-1",
  );
  assert.ok(unresolved);
  assert.ok(unresolved.blockers.includes("professional_motion_source_sidecar_youtube_identity_conflict"));
  assert.equal(unresolved.source_identity_provenance.kind, "yt_dlp_info_sidecar");
  assert.equal(unresolved.source_identity_provenance.status, "blocked");
  assert.ok(unresolved.source_identity_provenance.sidecar_sha256);
});

test("real motion materializer resolves complete Pulse source-identity sidecars without forging yt-dlp metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-explicit-identity-sidecar-"));
  const job = await makePackage(root, "pulse-source-identity-sidecar-proof");
  job.ultimate_quality_bar = true;
  const masterRoot = path.join(root, "output", "official-masters");
  const masterPaths = [];
  for (let index = 0; index < 5; index += 1) {
    const id = `PulseSource${index + 1}`;
    const bytes = Buffer.alloc(8192, index + 61);
    const masterPath = path.join(masterRoot, `${id}.mp4`);
    const masterSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await fs.outputFile(masterPath, bytes);
    await fs.outputJson(path.join(masterRoot, `${id}.source-identity.json`), {
      schema: "pulse_motion_source_identity_sidecar_v1",
      schema_version: 1,
      producer: "pulse_source_identity_oembed_verifier_v1",
      canonical_source_url: `https://www.youtube.com/watch?v=${id}`,
      youtube_video_id: id,
      channel_identity: {
        author_name: "Assassin's Creed",
        author_url: "https://www.youtube.com/@assassinscreed",
      },
      source_master_sha256: masterSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
      evidence: {
        provider: "youtube_oembed",
        verified_at: "2026-07-15T08:45:00.000Z",
        title: `Black Flag Resynced official source ${index + 1}`,
      },
    });
    masterPaths.push(masterPath);
  }

  const sourceIndexes = [0, 1, 2, 3, 4];
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    id: `pulse-identity-window-${index + 1}`,
    path: masterPaths[sourceIndexes[index]],
    source_url: masterPaths[sourceIndexes[index]],
    source_kind: "local_video_file",
    source_url_kind: "local_video_file",
    materialize_source_window: true,
    source_family: `mutable_pulse_identity_window_${index + 1}`,
    mediaStartS: index * 5,
    durationS: 4,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:46:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 3,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 28));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 4 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.professional_source_diversity.status, "pass");
  assert.equal(manifest.professional_source_diversity.observed_genuine_base_source_count, 5);
  assert.ok(manifest.clips.every((clip) => clip.canonical_source_url));
  assert.ok(manifest.clips.every((clip) => clip.youtube_video_id));
  assert.ok(manifest.clips.every((clip) => clip.source_master_sha256));
  assert.ok(
    manifest.clips.every(
      (clip) => clip.source_identity_provenance?.kind === "pulse_source_identity_sidecar",
    ),
  );
  assert.ok(manifest.clips.every((clip) => clip.source_identity_provenance?.rights_grant === false));
  assert.ok(
    manifest.professional_source_diversity.identity_evidence.every(
      (source) => source.source_identity_provenance?.[0]?.kind === "pulse_source_identity_sidecar",
    ),
  );
});

test("source identity accepts a renamed legacy master only when SHA-bound Pulse and yt-dlp evidence agree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-renamed-source-identity-"));
  const masterDir = path.join(root, "test", "output", "official-masters");
  const masterPath = path.join(masterDir, "official_xbox_major_update.mp4");
  const masterBytes = Buffer.from("renamed official master bytes");
  const masterSha256 = crypto.createHash("sha256").update(masterBytes).digest("hex");
  await fs.outputFile(masterPath, masterBytes);
  await fs.outputJson(path.join(masterDir, "official_xbox_major_update.info.json"), {
    id: "OfficialXbox123",
    webpage_url: "https://www.youtube.com/watch?v=OfficialXbox123",
    extractor: "youtube",
    extractor_key: "Youtube",
    uploader: "Xbox",
    channel: "Xbox",
    uploader_url: "https://www.youtube.com/@xbox",
    title: "Official Major Update Trailer",
  });
  await fs.outputJson(
    path.join(masterDir, "official_xbox_major_update.source-identity.json"),
    {
      schema: "pulse_motion_source_identity_sidecar_v1",
      schema_version: 1,
      producer: "pulse_source_identity_oembed_verifier_v1",
      canonical_source_url: "https://www.youtube.com/watch?v=OfficialXbox123",
      youtube_video_id: "OfficialXbox123",
      channel_identity: {
        author_name: "Xbox",
        author_url: "https://www.youtube.com/@xbox",
      },
      source_master_sha256: masterSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
      evidence: {
        provider: "youtube_oembed",
        verified_at: "2026-07-18T09:00:00.000Z",
        title: "Official Major Update Trailer",
      },
    },
  );

  const resolved = await materializedSourceIdentityFields(
    { source_url: masterPath },
    { root },
  );

  assert.equal(resolved.youtube_video_id, "OfficialXbox123");
  assert.equal(
    resolved.canonical_source_url,
    "https://www.youtube.com/watch?v=OfficialXbox123",
  );
  assert.equal(resolved.source_master_sha256, masterSha256);
  assert.deepEqual(resolved.source_identity_conflicts, []);
  assert.equal(resolved.source_identity_provenance.kind, "source_identity_evidence_bundle");
  assert.equal(resolved.source_identity_provenance.status, "resolved");
});

test("source identity keeps renamed legacy masters blocked when Pulse and yt-dlp identities disagree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-renamed-source-conflict-"));
  const masterDir = path.join(root, "test", "output", "official-masters");
  const masterPath = path.join(masterDir, "renamed-master.mp4");
  const masterBytes = Buffer.from("conflicting renamed master bytes");
  const masterSha256 = crypto.createHash("sha256").update(masterBytes).digest("hex");
  await fs.outputFile(masterPath, masterBytes);
  await fs.outputJson(path.join(masterDir, "renamed-master.info.json"), {
    id: "YtDlpIdentity1",
    webpage_url: "https://www.youtube.com/watch?v=YtDlpIdentity1",
    extractor: "youtube",
    uploader: "Publisher",
    uploader_url: "https://www.youtube.com/@publisher",
    title: "Official Trailer",
  });
  await fs.outputJson(path.join(masterDir, "renamed-master.source-identity.json"), {
    schema: "pulse_motion_source_identity_sidecar_v1",
    schema_version: 1,
    producer: "pulse_source_identity_oembed_verifier_v1",
    canonical_source_url: "https://www.youtube.com/watch?v=DifferentIdentity2",
    youtube_video_id: "DifferentIdentity2",
    channel_identity: {
      author_name: "Publisher",
      author_url: "https://www.youtube.com/@publisher",
    },
    source_master_sha256: masterSha256,
    identity_scope: "source_identity_only",
    rights_grant: false,
    evidence: {
      provider: "youtube_oembed",
      verified_at: "2026-07-18T09:05:00.000Z",
      title: "Official Trailer",
    },
  });

  const unresolved = await materializedSourceIdentityFields(
    { source_url: masterPath },
    { root },
  );

  assert.ok(unresolved.source_identity_conflicts.length > 0);
  assert.equal(unresolved.youtube_video_id, undefined);
});

test("real motion materializer rejects a Pulse source-identity sidecar whose master SHA is stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-stale-identity-sidecar-"));
  const job = await makePackage(root, "stale-pulse-source-identity-sidecar");
  job.ultimate_quality_bar = true;
  const masterRoot = path.join(root, "output", "official-masters");
  const masterPaths = [];
  for (let index = 0; index < 3; index += 1) {
    const id = `StaleSource${index + 1}`;
    const bytes = Buffer.alloc(8192, index + 71);
    const masterPath = path.join(masterRoot, `${id}.mp4`);
    const currentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    await fs.outputFile(masterPath, bytes);
    await fs.outputJson(path.join(masterRoot, `${id}.source-identity.json`), {
      schema: "pulse_motion_source_identity_sidecar_v1",
      schema_version: 1,
      producer: "pulse_source_identity_oembed_verifier_v1",
      canonical_source_url: `https://www.youtube.com/watch?v=${id}`,
      youtube_video_id: id,
      channel_identity: {
        author_name: "Assassin's Creed",
        author_url: "https://www.youtube.com/@assassinscreed",
      },
      source_master_sha256: index === 0 ? "f".repeat(64) : currentSha256,
      identity_scope: "source_identity_only",
      rights_grant: false,
      evidence: {
        provider: "youtube_oembed",
        verified_at: "2026-07-15T08:47:00.000Z",
      },
    });
    masterPaths.push(masterPath);
  }

  const sourceIndexes = [0, 0, 1, 1, 2];
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => ({
    ...asset,
    id: `stale-identity-window-${index + 1}`,
    path: masterPaths[sourceIndexes[index]],
    source_url: masterPaths[sourceIndexes[index]],
    source_kind: "local_video_file",
    source_url_kind: "local_video_file",
    materialize_source_window: true,
    source_family: `mutable_stale_identity_window_${index + 1}`,
    mediaStartS: index * 5,
    durationS: 4,
  }));
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:48:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 2,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 29));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 4 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  const unresolved = manifest.professional_source_diversity.unresolved_clips.find(
    (clip) => clip.clip_id === "stale-identity-window-1",
  );
  assert.ok(unresolved);
  assert.ok(unresolved.blockers.includes("professional_motion_source_sidecar_master_sha256_conflict"));
  assert.equal(unresolved.source_identity_provenance.kind, "pulse_source_identity_sidecar");
  assert.equal(unresolved.source_identity_provenance.status, "blocked");
  assert.equal(unresolved.source_identity_provenance.rights_grant, false);
});

test("real motion materializer preserves immutable identity fields from validated segment reports", () => {
  const masterHash = "a".repeat(64);
  const rows = candidateRows({
    storyId: "segment-identity-story",
    segmentValidationReport: {
      segments: [{
        id: "segment-with-identity",
        story_id: "segment-identity-story",
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        trusted_source_matched: true,
        source_url: "https://cdn.publisher.example/game/trailer-window.mp4",
        source_url_kind: "direct_video",
        source_type: "official_trailer_video",
        canonical_source_url: "https://www.youtube.com/watch?v=Official123",
        youtube_video_id: "Official123",
        source_master_sha256: masterHash,
        entity: "Identity Game",
        media_start_s: 12,
        duration_s: 5,
      }],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonical_source_url, "https://www.youtube.com/watch?v=Official123");
  assert.equal(rows[0].youtube_video_id, "Official123");
  assert.equal(rows[0].source_master_sha256, masterHash);
});

test("real motion materializer uses validator-approved trim timing instead of the rejected source window", () => {
  const rows = candidateRows({
    storyId: "segment-trim-story",
    segmentValidationReport: {
      segments: [{
        id: "segment-with-approved-trim",
        story_id: "segment-trim-story",
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        trusted_source_matched: true,
        source_url: "https://cdn.publisher.example/game/official-trailer.mp4",
        source_url_kind: "direct_video",
        source_type: "official_trailer_video",
        entity: "Trimmed Game",
        media_start_s: 132,
        duration_s: 5,
        trim_recommended: true,
        recommended_media_start_s: 134.15,
        recommended_duration_s: 2.85,
      }],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].mediaStartS, 134.15);
  assert.equal(rows[0].durationS, 2.85);
  assert.equal(rows[0].provenance.media_start_s, 134.15);
  assert.equal(rows[0].provenance.duration_s, 2.85);
  assert.equal(rows[0].provenance.original_media_start_s, 132);
  assert.equal(rows[0].provenance.original_duration_s, 5);
  assert.equal(rows[0].provenance.validator_trim_applied, true);
  assert.match(rows[0].source_family, /window_134_15_2_85$/);
});

test("real motion materializer rejects malformed validator trim timing instead of falling back to the unsafe window", () => {
  const rows = candidateRows({
    storyId: "segment-invalid-trim-story",
    segmentValidationReport: {
      segments: [{
        id: "segment-with-invalid-approved-trim",
        story_id: "segment-invalid-trim-story",
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        trusted_source_matched: true,
        source_url: "https://cdn.publisher.example/game/official-trailer.mp4",
        source_url_kind: "direct_video",
        source_type: "official_trailer_video",
        entity: "Trimmed Game",
        media_start_s: 132,
        duration_s: 5,
        trim_recommended: true,
        recommended_media_start_s: 140,
        recommended_duration_s: 2.85,
      }],
    },
  });

  assert.equal(rows.length, 0);
});

test("real motion materializer separates motion-window diversity from strict genuine base-source diversity", async (t) => {
  async function runCase(strict) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `pulse-real-motion-base-diversity-${strict}-`));
    const job = await makePackage(root, `base-diversity-${strict}`);
    const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
    const rights = await fs.readJson(rightsPath);
    const sharedUrl =
      "https://video.akamai.steamstatic.com/store_trailers/620/88888/hash/movie_max.mp4";
    rights.verdict = "pass";
    rights.failures = [];
    rights.assets = rights.assets.map((asset, index) => ({
      ...asset,
      id: `shared-trailer-window-${index + 1}`,
      path: sharedUrl,
      source_url: sharedUrl,
      source_type: "official_steam_trailer_video",
      source_kind: "direct_video",
      provider: "steam",
      evidence_reference: sharedUrl,
      source_family: `shared_trailer_window_${index + 1}`,
      base_source_family: "shared_trailer",
      mediaStartS: index * 6,
      durationS: 5,
      source_duration_s: 60,
    }));
    await fs.writeJson(rightsPath, rights, { spaces: 2 });

    const report = await materializeGoalRealMotion({
      root,
      workOrder: { jobs: [job] },
      generatedAt: strict ? "2026-07-15T05:46:00.000Z" : "2026-07-15T05:45:00.000Z",
      maxClips: 5,
      maxDirectClipsPerBaseSource: 5,
      strictBaseSourceDiversity: strict,
      minBaseSources: strict ? 2 : 0,
      execFileSync: (_bin, args) => {
        fs.ensureFileSync(args[args.length - 1]);
        fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 13));
      },
      ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    });
    return { root, job, report };
  }

  await t.test("normal motion-window readiness", async () => {
    const { job, report } = await runCase(false);
    assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
    const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
    const footage = await fs.readJson(path.join(job.artifact_dir, "footage_inventory.json"));
    assert.equal(manifest.distinct_motion_families.length, 5);
    assert.deepEqual(manifest.distinct_source_families, [
      "steamstatic:/store_trailers/620/88888/hash",
    ]);
    assert.deepEqual(
      footage.motion_inventory.distinct_source_families,
      manifest.distinct_source_families,
    );
  });

  await t.test("strict genuine base-source readiness", async () => {
    const { job, report } = await runCase(true);
    assert.equal(report.summary.materialized_story_count, 0);
    assert.equal(report.summary.blocked_story_count, 1);
    assert.ok(report.jobs[0].blockers.includes("genuine_base_source_minimum_not_met"));
    const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
    assert.equal(manifest.status, "blocked");
    assert.equal(manifest.distinct_motion_families.length, 5);
    assert.equal(manifest.distinct_source_families.length, 1);
    assert.equal(manifest.minimum_requirements.min_genuine_base_sources, 2);
  });
});

test("real motion materializer collapses downloaded sections with one canonical YouTube identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-youtube-identity-"));
  const job = await makePackage(root, "youtube-identity-diversity");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  const sourceBytes = Buffer.alloc(8192, 27);
  const sourceMasterSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const youtubeVideoId = "SharedOfficial123";
  const canonicalSourceUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;

  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = await Promise.all(
    rights.assets.map(async (asset, index) => {
      const localPath = path.join(root, "output", "source-sections", `section-${index + 1}.mp4`);
      await fs.outputFile(localPath, sourceBytes);
      return {
        ...asset,
        id: `youtube-section-${index + 1}`,
        path: localPath,
        source_url: localPath,
        source_type: "official_social_media_video",
        source_kind: "local_video_file",
        source_url_kind: "local_video_file",
        media_kind: "direct_video",
        materialize_source_window: true,
        provider: "youtube",
        source_family: `youtube_section_${index + 1}`,
        base_source_family: `downloaded_section_${index + 1}`,
        canonical_source_url: canonicalSourceUrl,
        youtube_video_id: youtubeVideoId,
        source_master_sha256: sourceMasterSha256,
        source_identity_provenance: {
          schema_version: 1,
          kind: "canonical_rights_record",
          status: "resolved",
          evidence_sha256: "a".repeat(64),
        },
        mediaStartS: index * 6,
        durationS: 5,
        source_duration_s: 60,
      };
    }),
  );
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-17T19:20:00.000Z",
    maxClips: 5,
    maxDirectClipsPerBaseSource: 5,
    strictBaseSourceDiversity: true,
    minBaseSources: 2,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 13));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `unique-${clip.id}`,
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.ok(
    report.jobs[0].blockers.includes("genuine_base_source_minimum_not_met"),
    JSON.stringify(report.jobs[0]),
  );
  const manifestPath = path.join(job.artifact_dir, "materialised_motion_clips.json");
  assert.equal(await fs.pathExists(manifestPath), true, JSON.stringify(report.jobs[0]));
  const manifest = await fs.readJson(manifestPath);
  assert.deepEqual(manifest.distinct_source_families, [`youtube:${youtubeVideoId}`]);
  assert.equal(manifest.professional_source_diversity.observed_genuine_base_source_count, 1);
});

test("real motion materializer cannot lower a configured strict base-source floor at invocation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-configured-base-floor-"));
  const job = await makePackage(root, "configured-base-floor");
  job.ultimate_quality_bar = true;
  job.required_genuine_base_source_count = 3;
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => {
    const sourceIndex = index < 3 ? 1 : 2;
    const sourceUrl =
      `https://video.akamai.steamstatic.com/store_trailers/620/${sourceIndex}/hash-${sourceIndex}/movie_max.mp4`;
    return {
      ...asset,
      id: `configured-base-window-${index + 1}`,
      path: sourceUrl,
      source_url: sourceUrl,
      source_type: "official_steam_trailer_video",
      source_kind: "direct_video",
      provider: "steam",
      source_family: `configured_base_${sourceIndex}_window_${index + 1}`,
      mediaStartS: index * 6,
      durationS: 5,
      source_duration_s: 60,
    };
  });
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T06:35:00.000Z",
    strictBaseSourceDiversity: true,
    minBaseSources: 1,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 3,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 19));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0, JSON.stringify(report.jobs[0]));
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("genuine_base_source_minimum_not_met"));
  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.distinct_source_families.length, 2);
  assert.equal(manifest.minimum_requirements.min_genuine_base_sources, 3);
});

test("real motion materializer cannot lower a strict base-source floor already recorded by the artefact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-recorded-base-floor-"));
  const job = await makePackage(root, "recorded-base-floor");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.verdict = "pass";
  rights.failures = [];
  rights.assets = rights.assets.map((asset, index) => {
    const sourceIndex = index + 1;
    const sourceUrl =
      `https://video.akamai.steamstatic.com/store_trailers/620/${sourceIndex}/hash-${sourceIndex}/movie_max.mp4`;
    return {
      ...asset,
      id: `recorded-base-window-${index + 1}`,
      path: sourceUrl,
      source_url: sourceUrl,
      source_type: "official_steam_trailer_video",
      source_kind: "direct_video",
      provider: "steam",
      source_family: `recorded_base_${sourceIndex}_window_${index + 1}`,
      canonical_source_url:
        `https://www.youtube.com/watch?v=RecordedOfficial${sourceIndex}`,
      youtube_video_id: `RecordedOfficial${sourceIndex}`,
      source_master_sha256: String(sourceIndex).repeat(64),
      source_identity_provenance: {
        schema_version: 1,
        kind: "canonical_rights_record",
        status: "resolved",
        evidence_sha256: String(sourceIndex + 3).repeat(64),
      },
      licence_basis: "official_publisher_promotional_editorial_use",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      credit_required: true,
      approval_status: "approved_for_transformative_editorial_use",
      evidence_reference:
        `https://www.youtube.com/watch?v=RecordedOfficial${sourceIndex}`,
      mediaStartS: index * 6,
      durationS: 5,
      source_duration_s: 60,
    };
  });
  await fs.writeJson(rightsPath, rights, { spaces: 2 });
  const materializerOptions = {
    root,
    workOrder: { jobs: [job] },
    strictBaseSourceDiversity: true,
    maxClips: 5,
    maxDirectClipsPerBaseSource: 2,
    execFileSync: (_bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 20));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    clipVisualFingerprint: async (clip) => `recorded-floor-${clip.id}`,
  };

  const initial = await materializeGoalRealMotion({
    ...materializerOptions,
    generatedAt: "2026-07-15T06:40:00.000Z",
    minBaseSources: 3,
  });
  assert.equal(initial.summary.materialized_story_count, 1, JSON.stringify(initial.jobs[0]));

  const refreshed = await materializeGoalRealMotion({
    ...materializerOptions,
    generatedAt: "2026-07-15T06:45:00.000Z",
    includeReadyStories: true,
    minBaseSources: 1,
  });
  assert.equal(refreshed.summary.materialized_story_count, 1, JSON.stringify(refreshed.jobs[0]));

  const manifest = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(manifest.minimum_requirements.min_genuine_base_sources, 3);
  assert.equal(manifest.professional_source_diversity.required_genuine_base_source_count, 3);
});

test("real motion materializer writes machine-readable and operator reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-write-"));
  const report = {
    generated_at: "2026-05-23T08:12:00.000Z",
    summary: {
      candidate_count: 0,
      materialized_story_count: 0,
      blocked_story_count: 0,
      failed_story_count: 0,
      materialized_clip_count: 0,
    },
    jobs: [],
  };
  const written = await writeGoalRealMotionReport(report, { outputDir: path.join(root, "out") });
  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
});

test("real motion materializer writes source acquisition work orders for blocked stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-source-work-"));
  const report = {
    generated_at: "2026-05-25T02:42:42.224Z",
    summary: {
      candidate_count: 2,
      materialized_story_count: 0,
      blocked_story_count: 2,
      failed_story_count: 0,
      materialized_clip_count: 0,
    },
    jobs: [
      {
        story_id: "direct-video-missing",
        title: "Star Wars Zero Company Needs Gameplay",
        artifact_dir: path.join(root, "output", "goal-proof", "batch", "direct-video-missing"),
        status: "blocked",
        blockers: ["direct_video_motion_clip_missing"],
        candidate_count: 5,
        materialized_count: 5,
        distinct_motion_family_count: 5,
        direct_video_motion_clip_count: 0,
      },
      {
        story_id: "no-candidates",
        title: "Kadokawa Stake Just Passed Sony",
        artifact_dir: path.join(root, "output", "goal-proof", "batch", "no-candidates"),
        status: "blocked",
        blockers: ["validated_direct_media_candidates_missing"],
        candidate_count: 0,
        materialized_count: 0,
        distinct_motion_family_count: 0,
        direct_video_motion_clip_count: 0,
      },
      {
        story_id: "visual-duplicates",
        title: "PS5 Games List Repeats The Same Footage",
        artifact_dir: path.join(root, "output", "goal-proof", "batch", "visual-duplicates"),
        status: "blocked",
        blockers: ["visual_motion_duplicate_content_detected"],
        candidate_count: 8,
        materialized_count: 6,
        distinct_motion_family_count: 6,
        direct_video_motion_clip_count: 6,
      },
    ],
  };

  const written = await writeGoalRealMotionReport(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.realMotionSourceAcquisitionWorkOrderPath), true);
  const workOrder = await fs.readJson(written.realMotionSourceAcquisitionWorkOrderPath);
  assert.equal(workOrder.mode, "REAL_MOTION_SOURCE_ACQUISITION_WORK_ORDER");
  assert.equal(workOrder.summary.story_count, 3);
  assert.equal(workOrder.summary.operator_required_count, 3);
  assert.equal(workOrder.summary.auto_repairable_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "direct-video-missing");
  assert.equal(workOrder.jobs[0].repair_lane, "direct_video_motion_source_acquisition");
  assert.match(workOrder.jobs[0].exact_missing_input, /direct-video/i);
  assert.match(workOrder.jobs[0].recommended_command, /ops:v4-source-family-acquisition/);
  assert.equal(workOrder.jobs[0].operator_approval_required, true);
  assert.equal(workOrder.jobs[0].db_mutation_required, false);
  assert.equal(workOrder.jobs[1].story_id, "no-candidates");
  assert.equal(workOrder.jobs[1].repair_lane, "validated_direct_media_candidate_acquisition");
  assert.match(workOrder.jobs[1].required_artefact_path, /motion-packs/);
  assert.equal(workOrder.jobs[2].story_id, "visual-duplicates");
  assert.equal(workOrder.jobs[2].repair_lane, "real_motion_depth_acquisition");
  assert.equal(workOrder.safety.no_publish_triggered, true);
  assert.equal(workOrder.safety.no_oauth_or_token_change, true);
});

test("real motion refresh trims planned windows from the hash-bound local source master", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-local-master-refresh-"));
  const storyId = "black-flag-local-master-refresh";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Assassin's Creed IV Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    records: [],
  });

  const clips = [];
  const sourceMasterPaths = [];
  for (let sourceIndex = 0; sourceIndex < 5; sourceIndex += 1) {
    const youtubeVideoId = `OfficialBlackFlag${sourceIndex + 1}`;
    const canonicalSourceUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    const sourceMasterPath = path.join(
      root,
      "output",
      "official-source-masters",
      `${youtubeVideoId}.mp4`,
    );
    const sourceMasterBytes = Buffer.alloc(12288, sourceIndex + 71);
    await fs.outputFile(sourceMasterPath, sourceMasterBytes);
    sourceMasterPaths.push(sourceMasterPath);
    const sourceMasterSha256 = crypto
      .createHash("sha256")
      .update(sourceMasterBytes)
      .digest("hex");
    const existingWindowCount = sourceIndex === 0 ? 1 : 2;
    for (let windowIndex = 0; windowIndex < existingWindowCount; windowIndex += 1) {
      const mediaStartS = 5 + windowIndex * 12;
      const clipPath = path.join(
        root,
        "output",
        "governed-segments",
        `black-flag-source-${sourceIndex + 1}-window-${windowIndex + 1}.mp4`,
      );
      const clipBytes = Buffer.alloc(8192, sourceIndex + 81 + windowIndex * 9);
      await fs.outputFile(clipPath, clipBytes);
      const clipSha256 = crypto.createHash("sha256").update(clipBytes).digest("hex");
      clips.push({
        id: `black-flag-source-${sourceIndex + 1}-window-${windowIndex + 1}`,
        path: clipPath,
        local_materialized_path: clipPath,
        source_url: canonicalSourceUrl,
        canonical_source_url: canonicalSourceUrl,
        youtube_video_id: youtubeVideoId,
        source_master_path: sourceMasterPath,
        source_master_sha256: sourceMasterSha256,
        motion_source_identity: {
          canonical_source_url: canonicalSourceUrl,
          youtube_video_id: youtubeVideoId,
          source_master_sha256: sourceMasterSha256,
          source_identity_conflicts: [],
        },
        source_duration_s: 80,
        source_family: `black_flag_source_${sourceIndex + 1}_window_${mediaStartS}`,
        base_source_family: `youtube_${youtubeVideoId}`,
        source_type: "official_publisher_gameplay_clip",
        source_kind: "local_video_file",
        media_kind: "direct_video",
        durationS: 5,
        mediaStartS,
        licence_basis: "publisher_video_policy_transformative_editorial_use",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: [...ENABLED_LIVE_PLATFORM_RIGHTS],
        commercial_use_allowed: true,
        credit_required: true,
        evidence_reference: canonicalSourceUrl,
        evidence_file: path.join(root, "rights", "publisher-video-policy.html"),
        rights_evidence_file: path.join(root, "rights", "publisher-video-policy.html"),
        evidence_kind: "publisher_video_policy",
        evidence_sha256: "f".repeat(64),
        rights_evidence_sha256: "f".repeat(64),
        evidence_size_bytes: 4096,
        rights_evidence_size_bytes: 4096,
        transformative_rights_evidence_verified: true,
        rights_grant: true,
        risk_score: 0.2,
        counts_towards_motion_readiness: true,
        materialized: true,
        validated: true,
        segmentValidationPassed: true,
        asset_sha256: clipSha256,
        asset_size_bytes: clipBytes.length,
        probed_duration_seconds: 5,
        materialized_file_evidence: {
          sha256: clipSha256,
          size_bytes: clipBytes.length,
          duration_seconds: 5,
        },
        provenance: {
          source: "official_trailer_segment_validation",
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "official_gameplay_samples_passed",
          base_source_family: `youtube_${youtubeVideoId}`,
          source_duration_s: 80,
        },
      });
    }
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "ready",
    clips,
  });

  const ffmpegInputs = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Crosses Three Million Sales",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 10,
    minFamilies: 5,
    maxClips: 10,
    maxDirectClipsPerBaseSource: 2,
    strictBaseSourceDiversity: true,
    minBaseSources: 5,
    refreshWindowPlan: {
      story_id: storyId,
      windows: [{
        id: "black-flag-source-1-window-14",
        source_clip_id: "black-flag-source-1-window-1",
        source_family: "black_flag_source_1_window_14",
        media_start_s: 14,
        duration_s: 5,
      }],
    },
    generatedAt: "2026-07-18T20:45:00.000Z",
    execFileSync: (_bin, args) => {
      const inputIndex = args.indexOf("-i");
      if (inputIndex >= 0) ffmpegInputs.push(path.resolve(args[inputIndex + 1]));
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(8192, 91));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
    materializedClipProbe: (filePath) => {
      const isPortraitDerivative = path.resolve(filePath).startsWith(
        path.join(root, "output", "video_cache") + path.sep,
      );
      return {
        available: true,
        decodable: true,
        duration_seconds: 5,
        video: {
          codec: "h264",
          width: isPortraitDerivative ? 1080 : 1920,
          height: isPortraitDerivative ? 1920 : 1080,
        },
      };
    },
    materializedClipDecode: () => ({
      available: true,
      decodable: true,
      full_clip: true,
    }),
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(report.summary.materialized_story_count, 1, JSON.stringify(report.jobs[0]));
  assert.deepEqual(ffmpegInputs, [path.resolve(sourceMasterPaths[0])]);
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  const refreshed = materialised.clips.find(
    (clip) => clip.id === "black-flag-source-1-window-14",
  );
  assert.ok(refreshed);
  assert.equal(refreshed.canonical_source_url, clips[0].canonical_source_url);
  assert.equal(refreshed.youtube_video_id, clips[0].youtube_video_id);
  assert.equal(refreshed.source_master_sha256, clips[0].source_master_sha256);
  assert.equal(refreshed.mediaStartS, 14);
  assert.equal(refreshed.durationS, 5);
  assert.equal(refreshed.evidence_file, clips[0].evidence_file);
  assert.equal(refreshed.rights_evidence_file, clips[0].rights_evidence_file);
  assert.equal(refreshed.evidence_kind, clips[0].evidence_kind);
  assert.equal(refreshed.evidence_sha256, clips[0].evidence_sha256);
  assert.equal(refreshed.rights_evidence_sha256, clips[0].rights_evidence_sha256);
  assert.equal(refreshed.transformative_rights_evidence_verified, true);
  assert.equal(refreshed.rights_grant, true);
  const repairedExisting = materialised.clips.find(
    (clip) => clip.id === "black-flag-source-2-window-1",
  );
  assert.equal(repairedExisting.materialized_file_evidence.video_codec, "h264");
  assert.equal(repairedExisting.materialized_file_evidence.width, 1920);
  assert.equal(repairedExisting.materialized_file_evidence.height, 1080);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  const motionRights = rights.records.filter(
    (record) => record.asset_type === "motion_clip",
  );
  assert.equal(motionRights.length, 10);
  assert.deepEqual(
    motionRights.map((record) => record.asset_id).sort(),
    materialised.clips.map((clip) => clip.id).sort(),
  );
  assert.ok(
    motionRights.every((record) => record.evidence_file === clips[0].evidence_file),
    JSON.stringify(motionRights, null, 2),
  );
  assert.ok(
    motionRights.every((record) => record.evidence_sha256 === clips[0].evidence_sha256),
    JSON.stringify(motionRights, null, 2),
  );
  assert.ok(
    motionRights.every((record) => record.evidence_kind === clips[0].evidence_kind),
    JSON.stringify(motionRights, null, 2),
  );
  assert.ok(
    motionRights.every((record) => record.transformative_rights_evidence_verified === true),
    JSON.stringify(motionRights, null, 2),
  );
  assert.ok(
    motionRights.every((record) => record.rights_grant === true),
    JSON.stringify(motionRights, null, 2),
  );
});

test("real motion materializer re-evaluates hash-bound clips invalidated only by a rights contradiction", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-real-motion-rights-recovery-"),
  );
  const storyId = "rights-recovery-after-code-fix";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Black Flag Resynced",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    story_id: storyId,
    verdict: "pass",
    records: [],
  });

  const clips = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      makeGovernedSelectorClip(root, storyId, index),
    ),
  );
  const invalidatedClips = clips.map((clip) => ({
    ...clip,
    counts_towards_motion_readiness: false,
  }));
  const blockers = ["rights_evidence_contradiction"];
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "blocked",
    ready: false,
    motion_ready: false,
    blockers,
    readiness: {
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers,
    },
    clips: invalidatedClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    status: "blocked",
    ready: false,
    motion_ready: false,
    readiness: {
      status: "v4_motion_blocked",
      ready: false,
      motion_ready: false,
      can_publish: false,
      blockers,
    },
    motion_inventory: {
      status: "blocked",
      ready: false,
      motion_ready: false,
      accepted_local_clips: invalidatedClips,
      production_motion_clips: invalidatedClips,
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Black Flag Resynced Crosses Three Million Sales",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        actions: [{ action_id: "run_visual_v4_production_render" }],
      }],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 5,
    minFamilies: 5,
    maxClips: 5,
    minBaseSources: 5,
    strictBaseSourceDiversity: true,
    generatedAt: "2026-07-19T06:30:00.000Z",
    clipVisualFingerprint: async (clip) => clip.id,
  });

  assert.equal(
    report.summary.materialized_story_count,
    1,
    JSON.stringify(report.jobs[0]),
  );
  const materialised = await fs.readJson(
    path.join(artifactDir, "materialised_motion_clips.json"),
  );
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.ok(
    materialised.clips.every(
      (clip) => clip.counts_towards_motion_readiness === true,
    ),
  );
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(
    rights.records.filter((record) => record.asset_type === "motion_clip").length,
    5,
  );
});
