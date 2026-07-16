"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  materializeGoalProductionRenders,
  refreshFlagshipInventoryEvidence,
  refreshFinalRenderQualityOnly,
  shouldSkipReadableShellCardsForAudioBudget,
  writeGoalProductionRenderMaterializationReport,
  _private,
} = require("../../lib/goal-production-render-materializer");
const {
  createTrustedRenderInputInventory,
  materializeFlagshipMediaEvidence,
} = require("../../lib/flagship-media-evidence-materializer");
const { directMotionBaseSourceOveruseEvidence } = require("../../lib/goal-dry-run-publisher");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../../lib/studio/v4/render-policy");
const {
  assessProfessionalSourceDiversity,
} = require("../../lib/studio/motion-source-identity");

function passingPostRenderForensicInputs(overrides = {}) {
  const clips = Array.from({ length: 3 }, (_, index) => ({
    id: `clip-${index + 1}`,
    path: `clip-${index + 1}.mp4`,
    source_family: `official-source-${index + 1}`,
  }));
  const runId = "production-render:strict-post-render-forensics:2026-07-15T09:10:00.000Z";
  const generationManifestSha256 = "a".repeat(64);
  const lineage = {
    generation_manifest: {
      path: "flagship/generation_manifest.json",
      sha256: generationManifestSha256,
      verdict: "GREEN",
    },
    final_video_sha256: "b".repeat(64),
    final_audio_sha256: "c".repeat(64),
    source_word_timestamps_sha256: "d".repeat(64),
    frozen_word_timestamps_sha256: "e".repeat(64),
    display_script_sha256: "f".repeat(64),
    spoken_script_sha256: "1".repeat(64),
    captions_sha256: "2".repeat(64),
  };
  return {
    storyId: "strict-post-render-forensics",
    renderManifest: {
      story_id: "strict-post-render-forensics",
      final_publish_render: true,
      creative_system_version: "pulse_visual_identity_v5",
    },
    renderReport: {
      creative_system_version: "pulse_visual_identity_v5",
      decoded_visual_gate: {
        status: "pass",
        decoded_media_evidence: true,
        frame_count: 3,
        blockers: [],
      },
    },
    outputPath: "visual_v4_render.mp4",
    scriptScorecard: { verdict: "viral_ready", blockers: [] },
    coherenceReport: { result: "pass", blockers: [], failures: [] },
    rightsLedger: {
      verdict: "pass",
      records: clips.map((clip) => ({
        asset_id: clip.id,
        path: clip.path,
        source_url: `https://official.example/${clip.id}`,
        licence_basis: "official_publisher_editorial_use",
      })),
    },
    directorPlan: {
      readiness: { status: "pass", blockers: [] },
      shot_plan: clips,
      shot_budget: { min_actual_motion_clips: 3, min_distinct_motion_families: 3 },
    },
    benchmark: { result: "pass", failures: [], warnings: [] },
    visualQuality: {
      result: "pass",
      failures: [],
      warnings: [],
      visual_evidence_profile: {
        motion_asset_count: 3,
        real_media_family_count: 3,
        generated_motion_family_count: 0,
        blockers: [],
      },
    },
    clips,
    audioSegmentReport: { verdict: "pass", blockers: [], warnings: [] },
    flagshipGenerationManifest: {
      story_id: "strict-post-render-forensics",
      complete: true,
      verdict: "GREEN",
      run_id: runId,
      artifacts: {
        final_video: { sha256: lineage.final_video_sha256 },
        final_audio: { sha256: lineage.final_audio_sha256 },
        word_timestamps: { sha256: lineage.frozen_word_timestamps_sha256 },
        script: { sha256: lineage.display_script_sha256 },
        spoken_script: { sha256: lineage.spoken_script_sha256 },
        captions: { sha256: lineage.captions_sha256 },
      },
    },
    flagshipGenerationManifestSha256: generationManifestSha256,
    voiceQualityReport: {
      verdict: "pass",
      authoritative: true,
      producer_id: "pulse-gaming-post-render-narration-qa",
      story_id: "strict-post-render-forensics",
      run_id: runId,
      lineage,
      checks: { generation_lineage_verified: true, spoken_alignment_exact: true },
      cadence: { status: "pass" },
      blockers: [],
      warnings: [],
    },
    captionManifest: {
      verdict: "pass",
      authoritative: true,
      producer_id: "pulse-gaming-post-render-narration-qa",
      story_id: "strict-post-render-forensics",
      run_id: runId,
      lineage,
      checks: { generation_lineage_verified: true, display_alignment_exact: true },
      blockers: [],
    },
    ...overrides,
  };
}

test("post-render forensics fails closed when captions were not checked", () => {
  const report = _private.buildPostRenderForensicQaReport(
    passingPostRenderForensicInputs({ captionManifest: {} }),
  );

  assert.equal(report.result, "fail");
  assert.equal(report.verdict, "blocked_or_rewrite_required");
  assert.ok(report.blockers.includes("caption_manifest_not_passed"));
});

test("post-render forensics rejects bare passing voice and caption flags without same-run lineage", () => {
  const report = _private.buildPostRenderForensicQaReport(
    passingPostRenderForensicInputs({
      voiceQualityReport: { verdict: "pass", blockers: [] },
      captionManifest: { status: "ready", blockers: [] },
    }),
  );

  assert.equal(report.result, "fail");
  assert.ok(report.blockers.includes("voice_quality_not_authoritative"));
  assert.ok(report.blockers.includes("caption_manifest_not_authoritative"));
});

test("post-render forensics rejects a bare passing rights flag", () => {
  const report = _private.buildPostRenderForensicQaReport(
    passingPostRenderForensicInputs({ rightsLedger: { verdict: "pass" } }),
  );

  assert.equal(report.result, "fail");
  assert.ok(report.blockers.includes("rights_ledger_not_passed"));
});

test("post-render forensics cannot promote a critical AMBER check", () => {
  const report = _private.buildPostRenderForensicQaReport(
    passingPostRenderForensicInputs({ benchmark: { result: "amber" } }),
  );

  assert.equal(report.result, "fail");
  assert.ok(report.blockers.includes("benchmark_not_passed"));
});

test("post-render forensics accepts a blocker-free publishable cadence warning only when QA marks cadence passed", () => {
  const inputs = passingPostRenderForensicInputs();
  inputs.voiceQualityReport = {
    ...inputs.voiceQualityReport,
    checks: {
      ...inputs.voiceQualityReport.checks,
      cadence_passed: true,
    },
    cadence: {
      status: "warn",
      blockers: [],
      warnings: ["wpm_outside_target_but_within_publishable_limit"],
    },
  };
  const report = _private.buildPostRenderForensicQaReport(inputs);

  assert.equal(report.result, "pass", JSON.stringify(report, null, 2));
  assert.equal(report.checks.voice_quality, "pass");
  assert.ok(!report.blockers.includes("voice_quality_not_authoritative"));
});

test("goal production render materializer preserves YouTube video IDs in source keys", () => {
  assert.equal(
    _private.clipBaseSourceKey({
      source_url: "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
      source_type: "official_youtube_channel",
      media_kind: "direct_video",
    }),
    "youtube:bu6bpfctkbq",
  );
  assert.notEqual(
    _private.clipBaseSourceKey({
      source_url: "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
      source_type: "official_youtube_channel",
      media_kind: "direct_video",
    }),
    _private.clipBaseSourceKey({
      source_url: "https://www.youtube.com/watch?v=Fmdd2nojs4g",
      source_type: "official_youtube_channel",
      media_kind: "direct_video",
    }),
  );
});

test("goal production render materializer preserves official segment-validation provenance for renderer clips", () => {
  const bridged = _private.rendererBridgeClipFromProductionClip({
    id: "validated-window-24",
    path: "output/video_cache/validated-window-24.mp4",
    source_url: "https://video.akamai.steamstatic.com/store_trailers/2697940/1128286692/hash/build/hls_264_master.m3u8",
    source_type: "steam_movie",
    source_family: "steamstatic:/store_trailers/2697940/1128286692/hash/build_window_24_5",
    base_source_family: "steamstatic:/store_trailers/2697940/1128286692/hash/build",
    media_kind: "direct_video",
    mediaStartS: 24,
    durationS: 5,
    provenance: {
      source: "official_trailer_segment_validation",
      validation_reason: "official_storefront_trailer_motion_samples_passed",
      segment_validated: true,
      allowed_for_flash_lane: true,
      base_source_family: "steamstatic:/store_trailers/2697940/1128286692/hash/build",
    },
  });

  assert.deepEqual(bridged.provenance, {
    source: "official_trailer_segment_validation",
    validation_reason: "official_storefront_trailer_motion_samples_passed",
    segment_validated: true,
    allowed_for_flash_lane: true,
    base_source_family: "steamstatic:/store_trailers/2697940/1128286692/hash/build",
  });
});

test("goal production render materializer hydrates generic fallback clips from governed evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hydrate-"));
  const clipPath = path.join(root, "segment_direct_motion_15.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(2048, 1));
  await fs.outputJson(`${clipPath}.json`, {
    clip_id: "segment_direct_motion_15",
    source_family: "steam_master_one_window_48_5",
    base_source_family: "steam_master_one",
    source_url: "https://video.example.test/master-one.m3u8",
    source_type: "steam_movie",
    source_url_kind: "hls_manifest",
    media_start_s: 48,
    duration_s: 5,
  });
  const governedEvidence = {
    id: "segment_direct_motion_15",
    path: clipPath,
    source_family: "steam_master_one_window_48_5",
    base_source_family: "steam_master_one",
    motion_family: "steam_master_one_window_48_5",
    mediaStartS: 48,
    durationS: 5,
    provenance: {
      source: "official_trailer_segment_validation",
      segment_validated: true,
      allowed_for_flash_lane: true,
      media_start_s: 48,
      duration_s: 5,
    },
  };

  const hydrated = _private.hydrateClipWithGovernedEvidence(
    {
      id: "segment_direct_motion_15",
      path: clipPath,
      source_family: "segment_direct_motion_15",
      durationS: 2.4,
    },
    [governedEvidence],
  );

  assert.equal(hydrated.source_family, "steam_master_one_window_48_5");
  assert.equal(hydrated.base_source_family, "steam_master_one");
  assert.equal(hydrated.mediaStartS, 48);
  assert.equal(hydrated.durationS, 5);
  assert.deepEqual(hydrated.provenance, governedEvidence.provenance);
});

test("goal production render materializer preserves governed subject identity for renderer clips", () => {
  const bridged = _private.rendererBridgeClipFromProductionClip({
    id: "official-denshattack-window",
    path: "output/video_cache/official-denshattack-window.mp4",
    source_url: "https://store.steampowered.com/app/2524850/Denshattack/",
    source_type: "official_storefront_trailer",
    source_family: "steam_2524850_denshattack_window_12_5",
    media_kind: "direct_video",
    entity: "Denshattack",
    entities: ["Denshattack", "Fireshine Games"],
    durationS: 5,
  });

  assert.equal(bridged.entity, "Denshattack");
  assert.deepEqual(bridged.entities, ["Denshattack", "Fireshine Games"]);
});

test("goal production render materializer supplies the canonical subject when clip identity is absent", () => {
  const bridged = _private.rendererBridgeClipFromProductionClip(
    {
      id: "official-denshattack-window",
      path: "output/video_cache/official-denshattack-window.mp4",
      source_url: "https://store.steampowered.com/app/2524850/Denshattack/",
      source_type: "official_storefront_trailer",
      source_family: "steam_2524850_denshattack_window_12_5",
      media_kind: "direct_video",
      durationS: 5,
    },
    0,
    "Denshattack",
  );

  assert.equal(bridged.entity, "Denshattack");
  assert.deepEqual(bridged.entities, ["Denshattack"]);
});

test("goal production render materializer selects the V5 source and strongest two narrative cards", () => {
  const cards = [
    { kind: "source", readability: { planned_visible_duration_s: 2.6 } },
    { kind: "context", readability: { planned_visible_duration_s: 4.3 } },
    { kind: "timeline", readability: { planned_visible_duration_s: 6.4 } },
    { kind: "quote", readability: { planned_visible_duration_s: 5.4 } },
    { kind: "takeaway", readability: { planned_visible_duration_s: 4.1 } },
  ];

  const selected = _private.selectReadableHyperframesCardsForMotionBalance(
    cards,
    8,
    51.909,
  );

  assert.deepEqual(selected.map((card) => card.kind), ["source", "takeaway", "context"]);
  assert.ok(
    selected.reduce(
      (total, card) => total + (card.kind === "source" ? 2.6 : card.readability.planned_visible_duration_s),
      0,
    ) <= 51.909 * 0.25 + 0.01,
  );
});

test("goal production render materializer never selects more than two narrative cards", () => {
  const selected = _private.selectReadableHyperframesCardsForMotionBalance(
    [
      { kind: "context", readability: { planned_visible_duration_s: 3.4 } },
      { kind: "timeline", readability: { planned_visible_duration_s: 3.4 } },
      { kind: "quote", readability: { planned_visible_duration_s: 3.4 } },
      { kind: "takeaway", readability: { planned_visible_duration_s: 3.4 } },
    ],
    10,
    60,
  );

  assert.deepEqual(selected.map((card) => card.kind), ["takeaway", "context"]);
});

test("goal production render materializer clamps lingering narrative cards to the V5 ceiling", () => {
  assert.equal(
    _private.readableHyperframesCardDurationS({
      kind: "takeaway",
      readability: {
        minimum_visible_duration_s: 6.4,
        planned_visible_duration_s: 6.4,
      },
    }),
    5.2,
  );
  assert.equal(
    _private.readableHyperframesCardDurationS({
      kind: "source",
      readability: { planned_visible_duration_s: 9 },
    }),
    2.6,
  );
});

test("goal production render materializer caps trailer windows when four roots can sustain premium motion", () => {
  const clips = ["a", "b", "c", "d"].flatMap((root) =>
    [0, 10, 20].map((start) => ({
      id: `${root}-${start}`,
      path: `output/video_cache/${root}-${start}.mp4`,
      source_family: `steam-trailer:${root}_window_${start}_5`,
      base_source_family: `steam-trailer:${root}_window_${start}_5`,
      media_kind: "direct_video",
    })),
  );
  const selected = _private.preferStrictDirectMotionBaseUniquenessWhenEnough(clips);
  assert.equal(selected.length, 8);
  const counts = new Map();
  for (const clip of selected) {
    const root = clip.id.split("-")[0];
    counts.set(root, (counts.get(root) || 0) + 1);
  }
  assert.ok([...counts.values()].every((count) => count <= 2));
});

test("goal production render materializer preserves two validated windows from four official roots", () => {
  const clips = Array.from({ length: 8 }, (_, index) => {
    const root = Math.floor(index / 2) + 1;
    const start = 36 + (index % 2) * 6;
    return {
      id: `official-${root}-${start}`,
      path: `output/video_cache/official-${root}-${start}.mp4`,
      local_materialized_path: `output/video_cache/official-${root}-${start}.mp4`,
      source_url: `C:/proof/official-source-${root}.mp4`,
      source_type: "official_platform_product_page",
      source_kind: "video_file",
      base_source_family: `official-platform-root-${root}`,
      source_family: `official-platform-root-${root}_window_${start}_5`,
      motion_family: `official-platform-root-${root}_window_${start}_5`,
      media_kind: "direct_video",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    };
  });

  const selected = _private.preferredMaterialisedClips({
    materialisedMotion: {
      status: "ready",
      clips,
      materialised_clips: clips,
    },
  });

  assert.equal(selected.length, 8);
  const roots = new Map();
  for (const clip of selected) {
    const root = _private.strictDirectMotionBaseSourceKey(clip);
    roots.set(root, (roots.get(root) || 0) + 1);
  }
  assert.equal(roots.size, 4);
  assert.ok([...roots.values()].every((count) => count === 2));
});

test("goal production render materializer never classifies an official source card as direct motion", () => {
  const directClips = Array.from({ length: 8 }, (_, index) => ({
    id: `official-direct-${index + 1}`,
    path: `output/video_cache/official-direct-${index + 1}.mp4`,
    source_url: `https://www.youtube.com/watch?v=OfficialDirect${index + 1}`,
    source_type: "official_publisher_trailer_segment",
    base_source_family: `official-direct-base-${index + 1}`,
    source_family: `official-direct-base-${index + 1}_window_0_5`,
    media_kind: "direct_video",
    counts_towards_motion_readiness: true,
    validated: true,
    durationS: 5,
  }));
  const sourceCard = {
    id: "official-source-card",
    path: "test/output/hf_source_card_story.mp4",
    source_url: "local://hyperframes/story/source",
    source_family: "hyperframes_official_source_card",
    media_kind: "generated_card",
    counts_towards_motion_readiness: true,
    durationS: 2.8,
  };

  const selected = _private.preferredMaterialisedClips({
    materialisedMotion: {
      status: "ready",
      clips: [
        ...directClips.slice(0, 2),
        sourceCard,
        ...directClips.slice(2),
      ],
    },
  });

  assert.equal(selected.length, directClips.length);
  assert.equal(selected.some((clip) => clip.id === sourceCard.id), false);
  assert.deepEqual(selected.map((clip) => clip.id), directClips.map((clip) => clip.id));
});

test("goal production render materializer selects non-overlapping windows from one official source", () => {
  const sourceUrl = "C:/proof/fogpiercer-demo-trailer.mp4";
  const clips = [3, 0, 6].map((start) => ({
    id: `fogpiercer-demo-${start}`,
    path: `output/video_cache/fogpiercer-demo-${start}.mp4`,
    source_url: sourceUrl,
    source_type: "official_developer_youtube_local_editorial_intake",
    base_source_family: "madcookies_official_fogpiercer_demo_trailer",
    source_family: `madcookies_official_fogpiercer_demo_trailer_window_${start}_5`,
    motion_family: `madcookies_official_fogpiercer_demo_trailer_window_${start}_5`,
    media_kind: "direct_video",
    validated: true,
    durationS: 5,
  }));

  const selected = _private.preferStrictDirectMotionBaseUniquenessWhenEnough(clips);

  assert.deepEqual(selected.map((clip) => clip.id), ["fogpiercer-demo-0", "fogpiercer-demo-6"]);
});

test("goal production render materializer completes rights for selected official storefront scenes", () => {
  const ledger = [{
    asset_id: "owned-card",
    path: "output/generated/owned-card.mp4",
    source_url: "local://owned-card",
    licence_basis: "owned_generated_editorial_motion_graphic",
  }];
  const clips = [
    {
      id: "steam-scene-1",
      path: "output/video_cache/steam-scene-1.mp4",
      source_url: "https://video.akamai.steamstatic.com/store_trailers/306130/123/master.m3u8",
      source_type: "steam_movie",
      source_family: "steam-trailer-1",
      media_kind: "direct_video",
    },
    {
      id: "owned-card",
      path: "output/generated/owned-card.mp4",
      source_url: "local://owned-card",
      media_kind: "owned_editorial_motion_graphic",
    },
  ];

  const completed = _private.augmentRightsLedgerForSelectedClips(ledger, clips);
  assert.equal(completed.length, 2);
  const steam = completed.find((record) => record.asset_id === "steam-scene-1");
  assert.equal(steam.licence_basis, "steam_storefront_promotional_editorial_use");
  assert.deepEqual(steam.allowed_platforms, ["youtube", "instagram", "facebook"]);
  assert.equal(completed.filter((record) => record.asset_id === "owned-card").length, 1);
});

test("goal production render materializer never invents commercial rights for local-proof trailers", () => {
  const completed = _private.augmentRightsLedgerForSelectedClips([], [{
    id: "official-trailer-local-proof",
    path: "output/video_cache/official-trailer-local-proof.mp4",
    source_url: "https://www.youtube.com/watch?v=OfficialTrailer1",
    source_type: "official_publisher_trailer_segment",
    source_family: "official_trailer_window_20_4",
    media_kind: "direct_video",
    rights_basis: "official_source_transformative_editorial_local_proof_only",
    rights_grant: false,
    rights_status: "operator_legal_review_required",
    usage_scope: "local_proof_only",
  }]);

  assert.equal(completed.length, 1);
  assert.equal(completed[0].commercial_use_allowed, false);
  assert.deepEqual(completed[0].allowed_platforms, []);
  assert.equal(completed[0].approval_status, "operator_legal_review_required");
  assert.equal(completed[0].risk_score, 1);
  assert.equal(
    completed[0].rights_decision_basis,
    "provisional_renderer_local_proof_pending_policy_reconciliation",
  );
});

test("goal production render materializer preserves a current hash-bound reconciled official rights row", () => {
  const clipPath = "output/video_cache/current-official-window.mp4";
  const clipSha256 = "a".repeat(64);
  const completed = _private.augmentRightsLedgerForSelectedClips({
    verdict: "pass",
    result: "pass",
    blockers: [],
    can_auto_publish: false,
    records: [{
      asset_id: "current-official-window",
      path: clipPath,
      sha256: clipSha256,
      asset_sha256: clipSha256,
      asset_size_bytes: 16384,
      source_url: "https://www.youtube.com/watch?v=CurrentOfficial1",
      source_type: "official_youtube_channel",
      source_owner: "Official Publisher",
      licence_basis: "official_publisher_promotional_video",
      allowed_use: "transformative_editorial_short_form",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      rights_status: "approved_under_transformative_editorial_policy",
      usage_scope: "transformative_editorial_short_form",
      rights_verdict: "GREEN",
      rights_decision_basis: "validated_official_direct_media_editorial_policy",
      reconciliation_basis: "current_validated_official_materialised_clip",
      risk_score: 0.28,
      evidence_file: "output/current/materialised_motion_clips.json",
      evidence_sha256: "b".repeat(64),
      evidence_size_bytes: 4096,
    }],
  }, [{
    id: "current-official-window",
    path: clipPath,
    source_url: "https://www.youtube.com/watch?v=CurrentOfficial1",
    source_type: "official_youtube_channel",
    source_family: "official_window_20_4",
    media_kind: "direct_video",
    rights_basis: "official_publisher_promotional_video",
    rights_grant: false,
    rights_status: "operator_legal_review_required",
    usage_scope: "local_proof_only",
    sha256: clipSha256,
    size_bytes: 16384,
  }]);

  assert.equal(completed.verdict, "PASS");
  assert.equal(completed.result, "PASS");
  assert.deepEqual(completed.blockers, []);
  assert.equal(completed.records[0].commercial_use_allowed, true);
  assert.equal(completed.records[0].rights_verdict, "GREEN");
  assert.equal(
    completed.records[0].rights_decision_basis,
    "validated_official_direct_media_editorial_policy",
  );
  assert.equal(
    completed.records[0].reconciliation_basis,
    "current_validated_official_materialised_clip",
  );
});

test("goal production render materializer records every selected trailer window with exact hashes", () => {
  const sharedSource = "https://www.youtube.com/watch?v=OfficialTrailer1";
  const ledger = {
    verdict: "pass",
    result: "pass",
    blockers: [
      "official_trailer_commercial_reuse_evidence_missing",
      "selected_asset_rights_sha256_missing",
    ],
    records: [{
      asset_id: "official-trailer-window-a",
      path: "output/video_cache/official-trailer-window-a.mp4",
      source_url: sharedSource,
      source_family: "official_trailer_window_10_4",
      licence_basis: "official_source_transformative_editorial_local_proof_only",
      commercial_use_allowed: false,
      approval_status: "operator_legal_review_required",
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
    }],
  };
  const clips = [
    {
      id: "official-trailer-window-a",
      path: "output/video_cache/official-trailer-window-a.mp4",
      source_url: sharedSource,
      source_family: "official_trailer_window_10_4",
      media_kind: "direct_video",
      rights_basis: "official_source_transformative_editorial_local_proof_only",
      rights_grant: false,
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
      sha256: "a".repeat(64),
      size_bytes: 4096,
      start_s: 10,
      duration_s: 4,
    },
    {
      id: "official-trailer-window-b",
      asset_id: "official-trailer-window-a",
      path: "output/video_cache/official-trailer-window-b.mp4",
      source_url: sharedSource,
      source_family: "official_trailer_window_30_4",
      media_kind: "direct_video",
      rights_basis: "official_source_transformative_editorial_local_proof_only",
      rights_grant: false,
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
      sha256: "b".repeat(64),
      size_bytes: 8192,
      start_s: 30,
      duration_s: 4,
    },
  ];

  const completed = _private.augmentRightsLedgerForSelectedClips(ledger, clips);
  assert.equal(completed.records.length, 2);
  for (const clip of clips) {
    const record = completed.records.find((row) => row.asset_id === clip.id && row.path === clip.path);
    assert.ok(record, clip.id);
    assert.equal(record.sha256, clip.sha256);
    assert.equal(record.size_bytes, clip.size_bytes);
    assert.equal(record.source_start_s, clip.start_s);
    assert.equal(record.source_duration_s, clip.duration_s);
    assert.equal(record.commercial_use_allowed, false);
  }
  assert.equal(completed.verdict, "RED");
  assert.equal(completed.result, "RED");
  assert.equal(completed.can_auto_publish, false);
  assert.equal(completed.blockers.includes("selected_asset_rights_sha256_missing"), false);
  assert.equal(completed.blockers.includes("selected_asset_commercial_rights_unverified"), true);
});

test("goal production render materializer preserves governed owned-card rights over stale review rows", () => {
  const pathValue = "output/generated/source-card.mp4";
  const completed = _private.augmentRightsLedgerForSelectedClips({
    verdict: "pass",
    result: "pass",
    records: [{
      asset_id: "source-card",
      path: pathValue,
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: false,
      approval_status: "operator_legal_review_required",
      rights_status: "operator_legal_review_required",
      usage_scope: "local_proof_only",
    }],
  }, [{
    id: "source-card",
    kind: "generated_card",
    path: pathValue,
    source_url: "local://hyperframes/source-card",
    media_kind: "generated_card",
    rights_basis: "owned_generated_editorial_motion_graphic",
    licence_basis: "official_publisher_trailer_local_proof_only_no_commercial_grant",
    rights_grant: true,
    rights_status: "operator_legal_review_required",
    approval_status: "operator_legal_review_required",
    usage_scope: "local_proof_only",
    sha256: "c".repeat(64),
    size_bytes: 16384,
    duration_s: 2.8,
  }]);

  assert.equal(completed.records.length, 1);
  assert.equal(completed.records[0].asset_id, "source-card");
  assert.equal(completed.records[0].commercial_use_allowed, true);
  assert.equal(completed.records[0].approval_status, "approved_for_transformative_editorial_use");
  assert.equal(completed.records[0].rights_status, "approved");
  assert.equal(completed.records[0].usage_scope, "declared_licensed_scope");
  assert.equal(completed.records[0].rights_verdict, "pass");
  assert.equal(completed.records[0].risk_score, 0);
  assert.equal(completed.records[0].sha256, "c".repeat(64));
});

test("goal production render materializer treats Steam HLS and DASH delivery as one trailer root", () => {
  const hls = {
    source_url: "https://video.akamai.steamstatic.com/store_trailers/306130/396046/hash/1750504333/hls_264_master.m3u8?t=1",
    source_family: "steam_hls_window_42_5",
    media_kind: "direct_video",
  };
  const dash = {
    source_url: "https://video.akamai.steamstatic.com/store_trailers/306130/396046/hash/1750504333/dash_h264.mpd?t=1",
    source_family: "steam_dash_window_54_5",
    media_kind: "direct_video",
  };
  assert.equal(
    _private.strictDirectMotionBaseSourceKey(hls),
    _private.strictDirectMotionBaseSourceKey(dash),
  );
});

test("goal production render materializer tops eight direct clips with one non-readable kinetic bridge", () => {
  const direct = Array.from({ length: 8 }, (_, index) => ({
    id: `direct-${index}`,
    path: `output/video_cache/direct-${index}.mp4`,
    media_kind: "direct_video",
  }));
  const owned = [
    {
      id: "motion-background",
      path: "output/generated-motion/story/motion-background.mp4",
      media_kind: "owned_explainer_motion",
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_explainer_motion_surface",
      durationS: 12,
    },
  ];
  assert.equal(
    _private.selectNonReadableOwnedExplainerTopUpForMotionBalance(owned, direct).length,
    1,
  );
});

test("goal production render materializer removes readable cards from primary clips and fills with kinetic bridges", () => {
  const direct = Array.from({ length: 7 }, (_, index) => ({
    id: `direct-${index}`,
    path: `output/video_cache/direct-${index}.mp4`,
    media_kind: "direct_video",
  }));
  const readable = {
    id: "source-card",
    path: "test/output/source-card.mp4",
    media_kind: "owned_explainer_motion",
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    readable_card_kind: "source",
    approval_status: "approved_for_transformative_editorial_use",
    owned_explainer_visual_plan: true,
    durationS: 12,
  };
  const kinetic = ["background", "signal"].map((id) => ({
    id,
    path: `output/generated-motion/story/${id}.mp4`,
    media_kind: "owned_explainer_motion",
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_explainer_motion_surface",
    approval_status: "approved_for_transformative_editorial_use",
    owned_explainer_visual_plan: true,
    durationS: 12,
  }));
  const selected = _private.premiumShellPrimaryClipsForRender(
    [...direct, readable],
    { clips: [...direct, readable, ...kinetic] },
  );
  assert.equal(selected.length, 9);
  assert.equal(selected.includes(readable), false);
  assert.equal(selected.filter((clip) => kinetic.includes(clip)).length, 2);
});

test("goal production render materializer clamps stale inventory floors to the selected final scene set", () => {
  const clips = Array.from({ length: 10 }, (_, index) => ({
    id: `clip-${index}`,
    path: `output/video_cache/clip-${index}.mp4`,
    source_family: `family-${index}`,
    media_kind: "direct_video",
  }));
  const plan = _private.footagePlanForDirector({
    footageInventory: {
      motion_inventory: {
        accepted_local_clips: Array.from({ length: 28 }, (_, index) => ({
          path: `output/video_cache/stale-${index}.mp4`,
          source_family: `stale-family-${index}`,
        })),
      },
      motion_budget: {
        required_motion_scenes: 28,
        required_distinct_families: 28,
      },
    },
    clips,
  });
  assert.equal(plan.motion_budget.required_motion_scenes, 10);
  assert.equal(plan.motion_budget.required_distinct_families, 10);
  assert.equal(plan.readiness.status, "ready");
});

test("goal production render materializer retries a locked Windows final before atomic promotion", async () => {
  const calls = [];
  let lockedAttempts = 0;
  const files = new Set(["temp.mp4", "final.mp4"]);
  const fsImpl = {
    pathExists: async (file) => files.has(file),
    rename: async (source, destination) => {
      calls.push([source, destination]);
      if (source === "final.mp4" && lockedAttempts++ < 1) {
        const error = new Error("locked");
        error.code = "EPERM";
        throw error;
      }
      files.delete(source);
      files.add(destination);
    },
    remove: async (file) => files.delete(file),
  };
  await _private.promoteRenderedOutputAtomically({
    temporaryPath: "temp.mp4",
    outputPath: "final.mp4",
    fsImpl,
    sleepImpl: async () => {},
  });
  assert.equal(files.has("final.mp4"), true);
  assert.equal(files.has("temp.mp4"), false);
  assert.ok(calls.filter(([source]) => source === "final.mp4").length >= 2);
});

test("goal production render materializer preserves distinct governed windows from one YouTube source", () => {
  const first = _private.clipBaseSourceKey({
    source_url: "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
    source_type: "official_youtube_channel",
    media_kind: "direct_video",
    source_family: "official_bu6bpfctkbq",
    mediaStartS: 12,
    durationS: 8,
  });
  const second = _private.clipBaseSourceKey({
    source_url: "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
    source_type: "official_youtube_channel",
    media_kind: "direct_video",
    source_family: "official_bu6bpfctkbq",
    mediaStartS: 48,
    durationS: 8,
  });

  assert.equal(first, "youtube:bu6bpfctkbq_window_12_8");
  assert.equal(second, "youtube:bu6bpfctkbq_window_48_8");
  assert.notEqual(first, second);
});

test("goal production render materializer carries governed window timing into renderer bridge clips", () => {
  const clip = _private.rendererBridgeClipFromProductionClip({
    id: "official-window-2",
    path: "official-window-2.mp4",
    source_url: "https://www.youtube.com/watch?v=Bu6BPfCtKBQ",
    source_type: "official_youtube_channel",
    source_family: "official_bu6bpfctkbq",
    media_kind: "direct_video",
    mediaStartS: 48,
    durationS: 8,
  });

  assert.equal(clip.mediaStartS, 48);
  assert.equal(clip.media_start_s, 48);
  assert.equal(clip.start_s, 48);
  assert.equal(clip.durationS, 8);
});

test("goal production render resolves narration duration from governed evidence before probing media", () => {
  let probeCalls = 0;
  const probe = () => {
    probeCalls += 1;
    return 47.554;
  };

  assert.equal(
    _private.resolveNarrationDurationS({
      voiceQualityReport: { cadence: { duration_seconds: 48.1 } },
      audioManifest: { duration_s: 47.9 },
      narrationAudioPath: "narration.mp3",
      ffprobeDurationImpl: probe,
    }),
    48.1,
  );
  assert.equal(probeCalls, 0);

  assert.equal(
    _private.resolveNarrationDurationS({
      audioManifest: { technical_duration_seconds: 47.8 },
      narrationAudioPath: "narration.mp3",
      ffprobeDurationImpl: probe,
    }),
    47.8,
  );
  assert.equal(probeCalls, 0);

  assert.equal(
    _private.resolveNarrationDurationS({
      narrationAudioPath: "narration.mp3",
      ffprobeDurationImpl: probe,
    }),
    47.554,
  );
  assert.equal(probeCalls, 1);
});

test("goal production render uses decoded current audio duration over stale voice metadata", () => {
  let probeCalls = 0;
  const duration = _private.resolveNarrationDurationS({
    voiceQualityReport: {
      generated_at: "2026-07-12T04:06:24.820Z",
      cadence: { duration_seconds: 57.625, duration_source: "ffprobe" },
    },
    audioManifest: {
      narration_audio_path: "flagship/final_audio.mp3",
      audio_sha256: "current-audio-sha",
    },
    narrationAudioPath: "flagship/final_audio.mp3",
    ffprobeDurationImpl: () => {
      probeCalls += 1;
      return 64.859;
    },
  });

  assert.equal(duration, 64.859);
  assert.equal(probeCalls, 1);
});

test("goal production render skips readable shell cards when short direct motion covers audio", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 17.6,
      primaryClips: Array.from({ length: 6 }, (_, index) => ({
        path: `direct-${index + 1}.mp4`,
        source_url: `https://video.akamai.steamstatic.com/store_trailers/4508340/source-${index < 3 ? 1 : 2}/hls_264_master.m3u8`,
        base_source_family: `steamstatic:/store_trailers/4508340/source-${index < 3 ? 1 : 2}`,
        source_family: `steamstatic:/store_trailers/4508340/source-${index < 3 ? 1 : 2}_window_${36 + index * 6}_5`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    true,
  );
});

test("goal production render skips source cards when eight independent clips cover a full short", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 47.55,
      primaryClips: Array.from({ length: 8 }, (_, index) => ({
        path: `albion-official-${index + 1}.mp4`,
        source_url: `https://www.youtube.com/watch?v=AlbionOfficial${index + 1}`,
        source_type: "official_youtube_channel",
        media_kind: "direct_video",
        source_family: `albion_official_${index + 1}`,
        durationS: 7,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    true,
  );
});

test("goal production render skips readable shell cards when distinct official motion covers compact audio", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 22.5,
      primaryClips: [
        {
          path: "source-card.mp4",
          kind: "approved_owned_explainer",
          durationS: 5,
        },
      ],
      fallbackClips: Array.from({ length: 7 }, (_, index) => ({
        path: `official-steam-window-${index + 1}.mp4`,
        source_url: `https://video.akamai.steamstatic.com/store_trailers/1623730/movie${index + 1}/hls_264_master.m3u8`,
        source_family: `steamstatic:/store_trailers/1623730/movie${index + 1}_window_${index * 5}_5`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    true,
  );
});

test("goal production render keeps readable shell cards when crossfades leave official windows short of audio", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 39.8,
      primaryClips: [
        {
          path: "source-card.mp4",
          kind: "approved_owned_explainer",
          durationS: 5,
        },
      ],
      fallbackClips: Array.from({ length: 7 }, (_, index) => ({
        path: `palworld-official-steam-window-${index + 1}.mp4`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/1623730/movie${index + 1}/hls_264_master.m3u8`,
        source_family: `steamstatic:/store_trailers/1623730/movie${index + 1}_window_${36 + index * 6}_5`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    false,
  );
});

test("goal production render keeps readable shell cards when eight compact windows do not cover audio after crossfades", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 41.12,
      fallbackClips: Array.from({ length: 8 }, (_, index) => ({
        path: `mound-official-steam-window-${index + 1}.mp4`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/2878250/movie${index + 1}/hls_264_master.m3u8`,
        source_family: `steamstatic:/store_trailers/2878250/movie${index + 1}_window_${index * 5}_5`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    false,
  );
});

test("goal production render keeps readable shell cards when official motion is too sparse", () => {
  assert.equal(
    shouldSkipReadableShellCardsForAudioBudget({
      audioDurationS: 39.8,
      fallbackClips: Array.from({ length: 5 }, (_, index) => ({
        path: `sparse-official-steam-window-${index + 1}.mp4`,
        source_url: `https://video.fastly.steamstatic.com/store_trailers/1623730/movie${index + 1}/hls_264_master.m3u8`,
        source_family: `steamstatic:/store_trailers/1623730/movie${index + 1}_window_${36 + index * 6}_5`,
        source_type: "steam_movie",
        media_kind: "direct_video",
        durationS: 5,
      })),
      wordTimestampSource: "local_whisper_word_alignment",
    }),
    false,
  );
});

function licensedSfxAssets() {
  return [
    {
      asset_id: "boom-impact-01",
      role: "impact",
      family: "impact",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/impact-01.wav",
      rights_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "soundly-transition-01",
      role: "transition",
      family: "whoosh",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/transition-01.wav",
      rights_basis: "soundly_pro_commercial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-ui-01",
      role: "ui_tick",
      family: "source_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
      rights_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-chart-01",
      role: "ui_tick",
      family: "chart_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/chart-01.wav",
      rights_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "pse-riser-01",
      role: "riser",
      family: "riser",
      provider_id: "pro_sound_effects",
      source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
      rights_basis: "pro_sound_effects_subscription_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "boom-sub-01",
      role: "sub_hit",
      family: "sub_hit",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/sub-01.wav",
      rights_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
  ];
}

function readyJob(storyId, artifactDir, overrides = {}) {
  return {
    story_id: storyId,
    title: "Lego Batman Has One Arkham Catch",
    artifact_dir: artifactDir,
    status: "ready_for_final_render_job",
    blockers: [],
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 5,
      distinct_motion_family_count: 5,
      materialised_motion_clip_paths: [
        path.join(artifactDir, "clip-1.mp4"),
        path.join(artifactDir, "clip-2.mp4"),
      ],
    },
    actions: [
      {
        action_id: "run_visual_v4_production_render",
        status: "ready_after_inputs",
        target_render_manifest: {
          renderer: "visual_v4_production",
          visual_tier: "production_v4_motion",
          final_publish_render: true,
          output: "visual_v4_render.mp4",
          output_path: path.join(artifactDir, "visual_v4_render.mp4"),
          manifest_path: path.join(artifactDir, "render_manifest.json"),
          story_id: storyId,
        },
      },
    ],
    ...overrides,
  };
}

async function makePackage(root, storyId = "story-final", canonicalOverrides = {}) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Has One Arkham Catch",
    thumbnail_headline: "ARKHAM DNA",
    canonical_angle: "Rocksteady is listed on the production",
    primary_source: "GameSpot",
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
    first_spoken_line: "Lego Batman has more Arkham DNA than it first looks.",
    description: "Lego Batman has more Arkham DNA than it first looks. Source: GameSpot.",
    ...canonicalOverrides,
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [{ kind: "proof_card", label: "ROCKSTEADY LISTED", detail: "ARKHAM-LITE COMBAT" }],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: "audio.mp3",
    word_timestamps_path: "timestamps.json",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: licensedSfxAssets(),
    },
  });
  await fs.outputFile(path.join(artifactDir, "audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: [{ word: "Lego", start: 0, end: 0.3 }],
  });
  await fs.outputFile(path.join(artifactDir, "clip-1.mp4"), Buffer.alloc(2048, 2));
  await fs.outputFile(path.join(artifactDir, "clip-2.mp4"), Buffer.alloc(2048, 3));
  return artifactDir;
}

async function writePassingHyperframesCard(root, storyId, kind, overrides = {}) {
  const outDir = path.join(root, "test", "output");
  const cardPath = path.join(outDir, `hf_${kind}_card_${storyId}.mp4`);
  const sidecarPath = cardPath.replace(/\.[^.]+$/i, ".shell.json");
  const readableText = overrides.readableText || `${kind} proof card`;
  const isSource = kind === "source";
  const minimumDurationS = Number(overrides.minimumDurationS || (isSource ? 1.6 : 3.6));
  const plannedDurationS = Number(overrides.plannedDurationS || (isSource ? 2.6 : 4.1));
  const maxDurationS = Number(overrides.maxDurationS || (isSource ? 3.1 : 5.2));
  await fs.outputFile(cardPath, Buffer.alloc(2048, 8));
  await fs.outputJson(sidecarPath, {
    story_id: storyId,
    card_kind: kind,
    channel_id: "pulse-gaming",
    hyperframes_premium_shell: {
      status: "pass",
      story_id: storyId,
      card_kind: kind,
      channel_id: "pulse-gaming",
      checks: {
        lint: { status: "pass" },
        validate: { status: "pass" },
        inspect: { status: "pass" },
        render: { status: "pass" },
      },
      visual_identity: {
        status: "pass",
        evidence: {
          vertical_reel_viewport: true,
          tracked_clip: true,
          html_path: "index.html",
          hyperframes_config_path: "hyperframes.json",
        },
      },
      animation_contract: {
        status: "pass",
        evidence: {
          timeline_registry: true,
          paused_gsap_timeline: true,
          main_timeline_registered: true,
          timeline_animation_steps: 4,
        },
      },
      readability_contract: {
        status: "pass",
        evidence: {
          readable_text: readableText,
          word_count: readableText.split(/\s+/).filter(Boolean).length,
          planned_visible_duration_s: plannedDurationS,
          minimum_visible_duration_s: minimumDurationS,
          max_readable_card_duration_s: maxDurationS,
        },
      },
      blockers: [],
    },
  });
  return cardPath;
}

async function addMotionEvidence(artifactDir, job, count = 7, prefix = "motion") {
  const clipPaths = Array.from({ length: count }, (_, index) =>
    path.join(artifactDir, `${prefix}-${index + 1}.mp4`),
  );
  await Promise.all(clipPaths.map((clipPath, index) =>
    fs.outputFile(clipPath, Buffer.alloc(2048, 40 + index)),
  ));
  job.evidence = {
    ...(job.evidence || {}),
    materialised_motion_clip_count: count,
    distinct_motion_family_count: count,
    materialised_motion_clip_paths: clipPaths,
  };
  return clipPaths;
}

function cleanRepeatFreeScenePlan() {
  return {
    repeatFree: true,
    blockers: [],
    repeatedBaseSources: [],
    repeatedReadableCardKinds: [],
    scenes: [
      { path: "clip-1.mp4", durationS: 12, baseSourceKey: "clip_1" },
      { path: "clip-2.mp4", durationS: 12, baseSourceKey: "clip_2" },
    ],
    cardVisibleWindows: [],
  };
}

test("goal production render materializer renders ready jobs and writes a final production manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-"));
  const artifactDir = await makePackage(root);
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T07:00:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push({ storyJson, output, story });
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        creative_system_version: "pulse_visual_identity_v5",
        creative_identity: { category: "reveal", segment_name: "FIRST LOOK" },
        decoded_visual_gate: {
          version: "decoded_visual_gate_v5",
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 24,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].story.canonical_subject, "Lego Batman");
  assert.equal(calls[0].story.primary_source, "GameSpot");
  assert.equal(calls[0].story.audio_path, path.join(artifactDir, "audio.mp3"));
  assert.equal(calls[0].story.timestamps_path, path.join(artifactDir, "timestamps.json"));
  assert.equal(calls[0].story.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(calls[0].story.word_timestamp_alignment_required, "local_whisper_word_alignment");
  assert.deepEqual(calls[0].story.video_clips, [
    path.join(artifactDir, "clip-1.mp4"),
    path.join(artifactDir, "clip-2.mp4"),
  ]);
  assert.equal(calls[0].story.proof_card_primary, "ROCKSTEADY LISTED");
  assert.equal(calls[0].story.proof_card_secondary, "ARKHAM-LITE COMBAT");
  assert.equal(calls[0].story.sfx_asset_inventory.length, 6);
  assert.equal(calls[0].story.sfx_asset_inventory[0].provider_id, "boom_library");
  assert.equal(await fs.pathExists(path.join(artifactDir, "visual_v4_render.mp4")), true);

  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.renderer, "visual_v4_production");
  assert.equal(manifest.visual_tier, "production_v4_motion");
  assert.equal(manifest.final_publish_render, true);
  assert.equal(manifest.render_basis, "fresh visual v4 production render generated from final render inputs");
  assert.equal(manifest.sfx_mix_policy_version, STUDIO_V4_SFX_MIX_POLICY_VERSION);
  assert.equal(manifest.voice_mix_policy_version, STUDIO_V4_VOICE_MIX_POLICY_VERSION);
  assert.equal(manifest.visual_design_policy_version, STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION);
  assert.equal(manifest.creative_system_version, "pulse_visual_identity_v5");
  assert.equal(manifest.creative_identity.category, "reveal");
  assert.equal(manifest.decoded_visual_gate.status, "pass");
  assert.equal(manifest.decoded_visual_gate.decoded_media_evidence, true);
  assert.equal(manifest.overlay_card_windows.length >= 3, true);
  assert.deepEqual(manifest.card_visible_windows, manifest.overlay_card_windows);
  assert.ok(
    manifest.overlay_card_windows.every((window) => {
      const kind = String(window.kind || window.id || "").toLowerCase();
      const duration = Number(window.duration_s);
      if (/source/.test(kind)) return duration === 2.6;
      return duration >= 2.6 && duration <= 4.2;
    }),
  );
  assert.equal(manifest.safety.no_local_proof_promoted_to_final, true);
});

test("goal production render materializer preserves verified base-source identity through the public render interface", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-source-identity-"));
  const artifactDir = await makePackage(root, "source-identity-story");
  const clips = [];

  for (let sourceIndex = 1; sourceIndex <= 3; sourceIndex += 1) {
    const sourceMasterSha256 = crypto
      .createHash("sha256")
      .update(`verified-source-${sourceIndex}`)
      .digest("hex");
    for (let windowIndex = 1; windowIndex <= 2; windowIndex += 1) {
      const clipPath = path.join(
        artifactDir,
        `source-${sourceIndex}-window-${windowIndex}.mp4`,
      );
      await fs.outputFile(clipPath, Buffer.alloc(2048, sourceIndex * 10 + windowIndex));
      clips.push({
        id: `source-${sourceIndex}-window-${windowIndex}`,
        path: clipPath,
        source_url: clipPath,
        canonical_source_url: `https://www.youtube.com/watch?v=PulseSource${sourceIndex}`,
        youtube_video_id: `PulseSource${sourceIndex}`,
        source_master_sha256: sourceMasterSha256,
        sampled_visual_fingerprint: `pulse-source-${sourceIndex}-fingerprint`,
        base_source_asset_id: `verified-source-${sourceIndex}`,
        base_source_identity_basis: "source_master_sha256",
        source_type: "official_publisher_trailer",
        source_family: `verified_source_${sourceIndex}_window_${windowIndex}`,
        base_source_family: `verified_source_${sourceIndex}`,
        motion_family: `verified_source_${sourceIndex}_window_${windowIndex}`,
        media_kind: "direct_video",
        durationS: 5,
        provenance: {
          source: "official_trailer_segment_validation",
          segment_validated: true,
        },
      });
    }
  }

  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  const job = readyJob("source-identity-story", artifactDir, {
    evidence: {
      ...readyJob("source-identity-story", artifactDir).evidence,
      materialised_motion_clip_count: clips.length,
      distinct_motion_family_count: clips.length,
      materialised_motion_clip_paths: clips.map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T10:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return {
        story_id: renderStory.id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 30,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.ok(renderStory);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  assert.equal(directClips.length, clips.length);
  assert.ok(directClips.every((clip) => clip.source_master_sha256));
  assert.ok(directClips.every((clip) => clip.canonical_source_url));
  assert.ok(directClips.every((clip) => clip.youtube_video_id));
  assert.ok(directClips.every((clip) => clip.sampled_visual_fingerprint));
  assert.ok(directClips.every((clip) => !/^https?:/i.test(clip.source_url)));

  const diversity = assessProfessionalSourceDiversity({
    clips: directClips,
    scenes: directClips,
    requiredBaseSources: 3,
  });
  assert.equal(diversity.status, "pass");
  assert.equal(diversity.observed_genuine_base_source_count, 3);
  assert.equal(diversity.unresolved_clips.length, 0);
});

test("production renderer writes hash-bound same-run flagship generation evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-evidence-"));
  const artifactDir = await makePackage(root, "flagship-evidence-story", {
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
  });
  const job = readyJob("flagship-evidence-story", artifactDir, {
    evidence: {
      ...readyJob("flagship-evidence-story", artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nLego Batman has more Arkham DNA than it first looks.\n",
  );
  const timestampWords = "Lego Batman has more Arkham DNA than it first looks."
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    }));
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), { words: timestampWords });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    verdict: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:00:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const evidenceDir = path.join(artifactDir, "flagship");
  const generation = await fs.readJson(path.join(evidenceDir, "generation_manifest.json"));
  const script = await fs.readFile(path.join(evidenceDir, "final_script.txt"));
  const timestamps = await fs.readJson(path.join(evidenceDir, "word_timestamps.json"));
  const captions = await fs.readFile(path.join(evidenceDir, "captions.srt"));
  const video = await fs.readFile(path.join(artifactDir, "visual_v4_render.mp4"));
  const audio = await fs.readFile(path.join(artifactDir, "audio.mp3"));
  const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

  assert.equal(generation.complete, true, JSON.stringify(generation.blockers, null, 2));
  assert.equal(generation.producer_id, "pulse-gaming-flagship-renderer");
  assert.equal(generation.run_id, "production-render:flagship-evidence-story:2026-07-15T08:00:00.000Z");
  assert.equal(generation.script_sha256, sha256(script));
  assert.equal(generation.artifacts.final_video.sha256, sha256(video));
  assert.equal(generation.artifacts.final_audio.sha256, sha256(audio));
  assert.equal(generation.artifacts.word_timestamps.sha256, sha256(Buffer.from(JSON.stringify(timestamps, null, 2) + "\n")));
  assert.equal(generation.artifacts.captions.sha256, sha256(captions));
  assert.equal(timestamps.complete, true);
  assert.equal(timestamps.audio_sha256, sha256(audio));
  assert.equal(timestamps.script_sha256, sha256(script));
  assert.equal(timestamps.captions_sha256, sha256(captions));

  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(renderManifest.flagship_generation_evidence.complete, true);
  assert.equal(
    renderManifest.flagship_generation_evidence.manifest_path,
    path.join(evidenceDir, "generation_manifest.json"),
  );
});

test("production renderer preserves collocated timestamp input and freezes bound evidence separately", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-collocated-timestamps-"));
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  const artifactDir = await makePackage(root, "flagship-collocated-timestamps", {
    narration_script: script,
  });
  const flagshipDir = path.join(artifactDir, "flagship");
  const renderInputTimestampPath = path.join(flagshipDir, "word_timestamps.json");
  await fs.ensureDir(flagshipDir);
  await fs.outputJson(renderInputTimestampPath, {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    verdict: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const baseJob = readyJob("flagship-collocated-timestamps", artifactDir);
  const job = readyJob("flagship-collocated-timestamps", artifactDir, {
    evidence: {
      ...baseJob.evidence,
      word_timestamps_path: renderInputTimestampPath,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });
  const sha256File = async (filePath) => crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
  let rendererTimestampSha256 = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:01:00.000Z",
    narrationQaDurationProbe: async () => 1,
    narrationQaSilenceProbe: async () => [],
    renderProof: async ({ output }) => {
      rendererTimestampSha256 = await sha256File(renderInputTimestampPath);
      await fs.outputFile(output, Buffer.alloc(4096, 12));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const finalRenderInputSha256 = await sha256File(renderInputTimestampPath);
  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  const generationManifest = await fs.readJson(path.join(flagshipDir, "generation_manifest.json"));
  const captionManifest = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));
  assert.equal(finalRenderInputSha256, rendererTimestampSha256);
  assert.equal(renderManifest.input_fingerprint.word_timestamps_sha256, finalRenderInputSha256);
  assert.equal(generationManifest.artifacts.word_timestamps.path, "flagship/generation_word_timestamps.json");
  assert.equal(captionManifest.word_timestamps_path, generationManifest.artifacts.word_timestamps.path);
  assert.equal(await fs.pathExists(path.join(artifactDir, generationManifest.artifacts.word_timestamps.path)), true);
});

test("production renderer freezes validated external audio and timestamps into flagship evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-freeze-"));
  const artifactDir = await makePackage(root, "flagship-freeze-story", {
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
  });
  const sourceDir = path.join(root, "governed-source-inputs");
  const sourceAudioPath = path.join(sourceDir, "narration.mp3");
  const sourceTimestampsPath = path.join(sourceDir, "word_timestamps.json");
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  await fs.outputFile(sourceAudioPath, Buffer.alloc(4096, 17));
  await fs.outputJson(sourceTimestampsPath, {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    verdict: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const baseJob = readyJob("flagship-freeze-story", artifactDir);
  const job = readyJob("flagship-freeze-story", artifactDir, {
    evidence: {
      ...baseJob.evidence,
      narration_audio_path: sourceAudioPath,
      word_timestamps_path: sourceTimestampsPath,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:02:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 18));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const evidenceDir = path.join(artifactDir, "flagship");
  const generation = await fs.readJson(path.join(evidenceDir, "generation_manifest.json"));
  const frozenAudioPath = path.join(artifactDir, generation.artifacts.final_audio.path);
  const frozenTimestampsPath = path.join(artifactDir, generation.artifacts.word_timestamps.path);
  assert.equal(generation.complete, true, JSON.stringify(generation.blockers, null, 2));
  assert.equal(path.resolve(frozenAudioPath).startsWith(path.resolve(evidenceDir)), true);
  assert.equal(path.resolve(frozenTimestampsPath).startsWith(path.resolve(evidenceDir)), true);
  assert.deepEqual(await fs.readFile(frozenAudioPath), await fs.readFile(sourceAudioPath));
  assert.equal(
    generation.artifacts.final_audio.sha256,
    crypto.createHash("sha256").update(await fs.readFile(sourceAudioPath)).digest("hex"),
  );
  const frozenTimestamps = await fs.readJson(frozenTimestampsPath);
  assert.equal(frozenTimestamps.flagship_generation_run_id, generation.run_id);
  assert.equal(frozenTimestamps.audio_sha256, generation.artifacts.final_audio.sha256);
});

test("production renderer binds display script and expanded spoken alignment without false mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-spoken-display-"));
  const displayScript = "Steam lists nine packs at $84.91, above the game's $59.99 price.";
  const spokenScript = "Steam lists nine packs at 84 dollars 91, above the game's 59 dollars 99 price.";
  const artifactDir = await makePackage(root, "flagship-spoken-display", {
    narration_script: displayScript,
  });
  const timestampWords = spokenScript.split(/\s+/).map((word, index) => ({
    word,
    start: Number((index * 0.25).toFixed(2)),
    end: Number(((index + 1) * 0.25).toFixed(2)),
  }));
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: timestampWords,
    meta: {
      display_text: displayScript,
      spoken_text: spokenScript,
      transcript: spokenScript,
    },
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${displayScript}\n`,
  );
  const job = readyJob("flagship-spoken-display", artifactDir);

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:04:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 19));
      return {
        clips: 2,
        rendered_duration_s: timestampWords.at(-1).end,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const evidenceDir = path.join(artifactDir, "flagship");
  const generation = await fs.readJson(path.join(evidenceDir, "generation_manifest.json"));
  const frozenTimestamps = await fs.readJson(path.join(evidenceDir, "word_timestamps.json"));
  const captions = await fs.readFile(path.join(evidenceDir, "captions.srt"), "utf8");
  assert.equal(generation.complete, true, JSON.stringify(generation.blockers, null, 2));
  assert.equal(await fs.readFile(path.join(evidenceDir, "final_script.txt"), "utf8"), `${displayScript}\n`);
  assert.equal(await fs.readFile(path.join(evidenceDir, "final_spoken_script.txt"), "utf8"), `${spokenScript}\n`);
  assert.equal(generation.spoken_script_sha256, generation.artifacts.spoken_script.sha256);
  assert.equal(frozenTimestamps.script_sha256, generation.script_sha256);
  assert.equal(frozenTimestamps.spoken_script_sha256, generation.spoken_script_sha256);
  assert.match(captions, /\$84\.91/);
  assert.match(captions, /\$59\.99/);
  assert.doesNotMatch(captions, /84 dollars|59 dollars/i);
  assert.match(captions, /00:00:03,750/);
});

test("production renderer refuses flagship generation evidence when timestamps do not match narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-timestamp-mismatch-"));
  const artifactDir = await makePackage(root, "flagship-timestamp-mismatch", {
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nLego Batman has more Arkham DNA than it first looks.\n",
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const job = readyJob("flagship-timestamp-mismatch", artifactDir, {
    evidence: {
      ...readyJob("flagship-timestamp-mismatch", artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:05:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 10));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const generation = await fs.readJson(
    path.join(artifactDir, "flagship", "generation_manifest.json"),
  );
  assert.equal(generation.complete, false);
  assert.equal(generation.verdict, "RED");
  assert.ok(generation.blockers.includes("word_timestamps_do_not_match_final_script"));
  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(renderManifest.flagship_generation_evidence.complete, false);
});

test("production renderer accepts compact display tokens split by strict Whisper rows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-compact-token-"));
  const script = "Choose 4K or 1080p.";
  const artifactDir = await makePackage(root, "flagship-compact-token-alignment", {
    narration_script: script,
  });
  const words = ["Choose", "4", "K", "or", "1080", "p"];
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: words.map((word, index) => ({
      word,
      start: Number((index * 0.15).toFixed(2)),
      end: Number(((index + 1) * 0.15).toFixed(2)),
    })),
    meta: {
      display_text: script,
      spoken_text: script,
      transcript: script,
    },
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const job = readyJob("flagship-compact-token-alignment", artifactDir, {
    evidence: {
      ...readyJob("flagship-compact-token-alignment", artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:06:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 12));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const generation = await fs.readJson(
    path.join(artifactDir, "flagship", "generation_manifest.json"),
  );
  assert.equal(generation.complete, true, JSON.stringify(generation.blockers, null, 2));
  assert.equal(generation.verdict, "GREEN");
});

test("production renderer accepts deterministic spoken currency alignment for numeric display copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-currency-"));
  const script = "Steam lists the bundle at $84.91.";
  const artifactDir = await makePackage(root, "flagship-currency-alignment", {
    narration_script: script,
  });
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: "Steam lists the bundle at 84 dollars 91".split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const job = readyJob("flagship-currency-alignment", artifactDir, {
    evidence: {
      ...readyJob("flagship-currency-alignment", artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:07:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 14));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const generation = await fs.readJson(
    path.join(artifactDir, "flagship", "generation_manifest.json"),
  );
  assert.equal(generation.complete, true, JSON.stringify(generation.blockers, null, 2));
  assert.equal(generation.verdict, "GREEN");
});

test("production renderer refuses flagship generation evidence when captions do not match narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-caption-mismatch-"));
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  const artifactDir = await makePackage(root, "flagship-caption-mismatch", {
    narration_script: script,
  });
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nCompletely unrelated caption text.\n",
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const job = readyJob("flagship-caption-mismatch", artifactDir, {
    evidence: {
      ...readyJob("flagship-caption-mismatch", artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:10:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 11));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const generation = await fs.readJson(
    path.join(artifactDir, "flagship", "generation_manifest.json"),
  );
  assert.equal(generation.complete, false);
  assert.equal(generation.verdict, "RED");
  assert.ok(generation.blockers.includes("captions_do_not_match_final_script"));
});

test("production renderer writes an immutable used-asset inventory with file-backed rights evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-rights-"));
  const storyId = "flagship-rights-story";
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  const artifactDir = await makePackage(root, storyId, { narration_script: script });
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  const rightsRows = [
    {
      asset_id: "clip-one",
      kind: "video",
      path: path.join(artifactDir, "clip-1.mp4"),
      source_url: "https://official.example/trailer-one",
      creator: "Official Publisher",
      licence_basis: "transformative_editorial_short_form",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      risk_score: 0.2,
      credit_required: false,
    },
    {
      asset_id: "clip-two",
      kind: "video",
      path: path.join(artifactDir, "clip-2.mp4"),
      source_url: "https://official.example/trailer-two",
      creator: "Official Publisher",
      licence_basis: "transformative_editorial_short_form",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      risk_score: 0.2,
      credit_required: false,
    },
    {
      asset_id: "narration",
      kind: "narration",
      path: path.join(artifactDir, "audio.mp3"),
      source_url: "elevenlabs://pulse-gaming/flagship-rights-story",
      creator: "Pulse Gaming via ElevenLabs",
      licence_basis: "elevenlabs_commercial_tts_generation",
      commercial_use_allowed: true,
      approval_status: "approved",
      allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      risk_score: 0.05,
      credit_required: false,
    },
  ];
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    used_assets: rightsRows.map(({ asset_id, kind, path: filePath, source_url }) => ({
      asset_id,
      kind,
      path: filePath,
      source_url,
    })),
    records: rightsRows,
    blockers: [],
  });
  const job = readyJob(storyId, artifactDir, {
    evidence: {
      ...readyJob(storyId, artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:15:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 12));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        selected_input_assets: {
          schema_version: 1,
          authoritative: true,
          producer_id: "pulse-gaming-studio-v4-renderer",
          assets: rightsRows.map(({ asset_id, kind, path: filePath, source_url }) => ({
            asset_id,
            kind,
            path: filePath,
            source_url,
          })),
        },
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const inventoryPath = path.join(artifactDir, "flagship", "inventory.json");
  const inventory = await fs.readJson(inventoryPath);
  assert.equal(inventory.complete, true, JSON.stringify(inventory.blockers, null, 2));
  assert.equal(inventory.story_id, storyId);
  assert.equal(inventory.generation_manifest.path, "flagship/generation_manifest.json");
  assert.equal(inventory.used_assets.length, 3);
  for (const asset of inventory.used_assets) {
    const copiedAssetPath = path.join(artifactDir, asset.path);
    const rightsEvidencePath = path.join(artifactDir, asset.evidence_file);
    assert.equal(await fs.pathExists(copiedAssetPath), true);
    assert.equal(await fs.pathExists(rightsEvidencePath), true);
    const assetBytes = await fs.readFile(copiedAssetPath);
    const evidence = await fs.readJson(rightsEvidencePath);
    const digest = crypto.createHash("sha256").update(assetBytes).digest("hex");
    assert.equal(evidence.asset_id, asset.asset_id);
    assert.equal(evidence.asset_sha256, digest);
    assert.equal(evidence.rights_verdict, "GREEN");
    assert.equal(evidence.commercial_use_allowed, true);
    assert.deepEqual(evidence.allowed_platforms, asset.allowed_platforms);
    assert.match(evidence.source_ledger_sha256, /^[a-f0-9]{64}$/);
  }
});

test("flagship inventory refresh captures platform variants materialised after the master render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-inventory-refresh-"));
  const storyId = "flagship-platform-variant-refresh";
  const artifactDir = path.join(root, "package");
  const flagshipDir = path.join(artifactDir, "flagship");
  const variantPath = path.join(
    artifactDir,
    "platform_variants",
    "instagram_reels",
    "visual_v4_render_instagram_reels.mp4",
  );
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 1));
  await fs.outputFile(variantPath, Buffer.alloc(4096, 2));
  await fs.outputJson(path.join(flagshipDir, "generation_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    complete: true,
    verdict: "GREEN",
    artifacts: {
      final_video: { path: "visual_v4_render.mp4", sha256: "a".repeat(64) },
    },
  });
  const platformVariant = {
    asset_id: "platform-native-instagram_reels",
    kind: "platform_native",
    path: variantPath,
    source_url: `local://pulse-gaming/${storyId}/platform-native/instagram_reels`,
    source_type: "platform_native_render",
    owner: "Pulse Gaming",
    provider_id: "legacy_variant_catalogue",
    licence_basis: "derived_platform_variant_of_fully_rights_covered_final_render",
    commercial_use_allowed: true,
    approval_status: "approved_for_commercial_editorial_use",
    allowed_platforms: ["instagram_reels"],
    risk_score: 0.2,
    credit_required: false,
  };
  const historicalAlias = {
    ...platformVariant,
    asset_id: `${platformVariant.asset_id}-historical-alias`,
    creator: "Legacy variant catalogue",
    licence_basis: "legacy_variant_catalogue_import",
    allowed_platforms: ["youtube_shorts"],
  };
  const rightsLedgerPath = path.join(artifactDir, "rights_ledger.json");
  await fs.outputJson(rightsLedgerPath, {
    verdict: "pass",
    used_assets: [{
      asset_id: platformVariant.asset_id,
      kind: platformVariant.kind,
      path: platformVariant.path,
      source_url: platformVariant.source_url,
    }],
    records: [platformVariant],
    matched_assets: [historicalAlias],
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    selected_input_assets: {
      schema_version: 1,
      authoritative: true,
      producer_id: "pulse-gaming-studio-v4-renderer",
      assets: [{
        asset_id: platformVariant.asset_id,
        kind: platformVariant.kind,
        path: platformVariant.path,
        source_url: platformVariant.source_url,
      }],
    },
  });

  const refreshed = await refreshFlagshipInventoryEvidence({
    artifactDir,
    storyId,
    generatedAt: "2026-07-15T09:30:00.000Z",
  });

  assert.equal(refreshed.status, "inventory_refreshed", JSON.stringify(refreshed, null, 2));
  assert.equal(refreshed.complete, true);
  assert.equal(refreshed.safety.renderer_invoked, false);
  assert.equal(refreshed.safety.no_publish_triggered, true);
  const inventory = await fs.readJson(path.join(flagshipDir, "inventory.json"));
  assert.equal(inventory.used_assets.length, 1);
  assert.equal(inventory.used_assets[0].asset_id, platformVariant.asset_id);
  assert.equal(inventory.used_assets[0].source_url, platformVariant.source_url);
  assert.equal(inventory.used_assets[0].creator, "Pulse Gaming");
  const sidecar = await fs.readJson(
    path.join(artifactDir, inventory.used_assets[0].evidence_file),
  );
  const sourceLedgerSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(rightsLedgerPath))
    .digest("hex");
  const canonicalJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const sourceRecordSha256 = crypto
    .createHash("sha256")
    .update(canonicalJson([platformVariant]))
    .digest("hex");
  assert.equal(sidecar.source_ledger_sha256, sourceLedgerSha256);
  assert.equal(sidecar.source_record_sha256, sourceRecordSha256);

  const trustedRenderInputs = await createTrustedRenderInputInventory({
    packageDir: artifactDir,
    inventory,
  });
  const verification = await materializeFlagshipMediaEvidence({
    packageDir: artifactDir,
    inventory,
    outputDir: path.join(root, "flagship-proof"),
    generatedAt: "2026-07-15T09:31:00.000Z",
    trustedRenderInputs,
  });
  const verifiedVariant = verification.used_assets.find(
    (asset) => asset.asset_id === platformVariant.asset_id,
  );
  assert.equal(
    verifiedVariant.evidence_file.source_ledger.verified,
    true,
    JSON.stringify(verifiedVariant.evidence_file.source_ledger.blockers, null, 2),
  );
});

test("production inventory fails closed when renderer-selected media is absent from the rights ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-selected-rights-gap-"));
  const storyId = "renderer-selected-rights-gap";
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  const artifactDir = await makePackage(root, storyId, {
    narration_script: script,
    first_spoken_line: script,
  });
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    verdict: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  const narration = {
    asset_id: `${storyId}_audio_path`,
    kind: "narration",
    path: path.join(artifactDir, "audio.mp3"),
    source_url: `pulse-generated://${storyId}/narration`,
    creator: "Pulse Gaming renderer",
    licence_basis: "owned generated narration",
    commercial_use_allowed: true,
    approval_status: "approved",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    risk_score: 0.05,
    credit_required: false,
  };
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    used_assets: [narration],
    records: [narration],
    blockers: [],
  });
  const job = readyJob(storyId, artifactDir, {
    evidence: {
      ...readyJob(storyId, artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T09:40:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 21));
      return {
        clips: 1,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 2,
        },
        selected_input_assets: {
          schema_version: 1,
          authoritative: true,
          producer_id: "pulse-gaming-studio-v4-renderer",
          assets: [
            {
              asset_id: `${storyId}_audio_path`,
              kind: "narration",
              path: path.join(artifactDir, "audio.mp3"),
            },
            {
              asset_id: "clip-one",
              kind: "video",
              path: path.join(artifactDir, "clip-1.mp4"),
              source_url: "https://official.example/trailer-one",
            },
          ],
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const inventory = await fs.readJson(path.join(artifactDir, "flagship", "inventory.json"));
  assert.equal(inventory.complete, false);
  assert.equal(inventory.verdict, "RED");
  assert.ok(inventory.blockers.includes("renderer_selected_asset_rights_record_missing:clip-one"));
  assert.equal(inventory.renderer_selected_inputs.authoritative, true);
  assert.equal(inventory.renderer_selected_inputs.asset_count, 2);
});

test("flagship inventory refresh refuses creator fallbacks outside the verifier record contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-inventory-creator-"));
  const storyId = "flagship-provider-only-creator";
  const assetId = `${storyId}_audio_path`;
  const artifactDir = path.join(root, "package");
  const flagshipDir = path.join(artifactDir, "flagship");
  const assetPath = path.join(artifactDir, "audio.mp3");
  await fs.outputFile(assetPath, Buffer.alloc(4096, 3));
  await fs.outputJson(path.join(flagshipDir, "generation_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    complete: true,
    verdict: "GREEN",
    artifacts: {},
  });
  const sourceRecord = {
    asset_id: assetId,
    kind: "narration",
    path: assetPath,
    source_url: `elevenlabs://pulse-gaming/${storyId}`,
    provider_id: "pulse_gaming",
    licence_basis: "owned_local_voice_model",
    commercial_use_allowed: true,
    approval_status: "approved",
    allowed_platforms: ["youtube_shorts"],
    risk_score: 0.08,
    credit_required: false,
  };
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    used_assets: [{
      asset_id: assetId,
      kind: sourceRecord.kind,
      path: sourceRecord.path,
      source_url: sourceRecord.source_url,
    }],
    records: [sourceRecord],
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    selected_input_assets: {
      schema_version: 1,
      authoritative: true,
      producer_id: "pulse-gaming-studio-v4-renderer",
      assets: [{
        asset_id: assetId,
        kind: sourceRecord.kind,
        path: sourceRecord.path,
        source_url: sourceRecord.source_url,
      }],
    },
  });

  const refreshed = await refreshFlagshipInventoryEvidence({
    artifactDir,
    storyId,
    generatedAt: "2026-07-15T09:35:00.000Z",
  });

  assert.equal(refreshed.status, "blocked");
  assert.ok(refreshed.blockers.includes(`used_asset_creator_missing:${assetId}`));
  const inventory = await fs.readJson(path.join(flagshipDir, "inventory.json"));
  assert.deepEqual(inventory.used_assets, []);
  assert.equal(
    await fs.pathExists(path.join(flagshipDir, "rights", `${assetId}.json`)),
    false,
  );
});

test("production renderer fails flagship rights closed across duplicate asset aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-rights-alias-"));
  const storyId = "flagship-rights-alias";
  const script = "Lego Batman has more Arkham DNA than it first looks.";
  const artifactDir = await makePackage(root, storyId, { narration_script: script });
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), {
    words: script.split(/\s+/).map((word, index) => ({
      word,
      start: Number((index * 0.1).toFixed(2)),
      end: Number(((index + 1) * 0.1).toFixed(2)),
    })),
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  const sourcePath = path.join(artifactDir, "clip-1.mp4");
  const sourceUrl = "https://official.example/trailer-one";
  const approved = {
    asset_id: "clip-one",
    kind: "video",
    path: sourcePath,
    source_url: sourceUrl,
    creator: "Official Publisher",
    licence_basis: "transformative_editorial_short_form",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    risk_score: 0.2,
    credit_required: false,
  };
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    used_assets: [{
      asset_id: approved.asset_id,
      kind: approved.kind,
      path: sourcePath,
      source_url: sourceUrl,
    }],
    records: [approved],
    matched_assets: [{
      ...approved,
      asset_id: "clip-one-rejected-alias",
      approval_status: "rejected",
    }],
    blockers: [],
  });
  const job = readyJob(storyId, artifactDir, {
    evidence: {
      ...readyJob(storyId, artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:20:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 13));
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        selected_input_assets: {
          schema_version: 1,
          authoritative: true,
          producer_id: "pulse-gaming-studio-v4-renderer",
          assets: [{
            asset_id: approved.asset_id,
            kind: approved.kind,
            path: approved.path,
            source_url: approved.source_url,
          }],
        },
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const inventory = await fs.readJson(path.join(artifactDir, "flagship", "inventory.json"));
  assert.equal(inventory.complete, false);
  assert.equal(inventory.verdict, "RED");
  assert.ok(inventory.blockers.includes("used_asset_rights_rejected:clip-one"));
  assert.equal(inventory.used_assets.length, 0);
});

test("production renderer emits a real decodable package accepted by flagship evidence verification", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-flagship-integration-"));
  const storyId = "flagship-render-integration";
  const script = "Pulse Gaming proves the renderer evidence path.";
  const artifactDir = await makePackage(root, storyId, { narration_script: script });
  const runFfmpeg = (args) => execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "ignore", windowsHide: true },
  );
  runFfmpeg([
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
    "-c:a", "libmp3lame", "-ar", "48000", "-ac", "1",
    path.join(artifactDir, "audio.mp3"),
  ]);
  for (const [fileName, colour] of [["clip-1.mp4", "red"], ["clip-2.mp4", "blue"]]) {
    runFfmpeg([
      "-f", "lavfi", "-i", `color=c=${colour}:s=320x180:r=5:d=0.4`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an", "-movflags", "+faststart", path.join(artifactDir, fileName),
    ]);
  }
  const words = script.split(/\s+/).map((word, index) => ({
    word,
    start: Number((index * 0.12).toFixed(2)),
    end: Number(((index + 1) * 0.12).toFixed(2)),
  }));
  await fs.outputJson(path.join(artifactDir, "timestamps.json"), { words });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    `1\n00:00:00,000 --> 00:00:01,000\n${script}\n`,
  );
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "pass",
    caption_srt_path: path.join(artifactDir, "captions.srt"),
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [] },
  });
  const rightsRows = [
    ["clip-one", "video", "clip-1.mp4", "https://official.example/trailer-one", "Official Publisher", 0.2],
    ["clip-two", "video", "clip-2.mp4", "https://official.example/trailer-two", "Official Publisher", 0.2],
    ["narration", "narration", "audio.mp3", `pulse-generated://${storyId}/narration`, "Pulse Gaming renderer", 0.05],
  ].map(([assetId, kind, relativePath, sourceUrl, creator, riskScore]) => ({
    asset_id: assetId,
    kind,
    path: path.join(artifactDir, relativePath),
    source_url: sourceUrl,
    creator,
    licence_basis: kind === "narration"
      ? "owned generated narration"
      : "transformative editorial use of official publisher media",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    allowed_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    risk_score: riskScore,
    credit_required: false,
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    used_assets: rightsRows.map(({ asset_id, kind, path: filePath, source_url }) => ({
      asset_id,
      kind,
      path: filePath,
      source_url,
    })),
    records: rightsRows,
    blockers: [],
  });
  const job = readyJob(storyId, artifactDir, {
    evidence: {
      ...readyJob(storyId, artifactDir).evidence,
      captions_path: path.join(artifactDir, "captions.srt"),
    },
  });

  const renderReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:25:00.000Z",
    renderProof: async ({ output }) => {
      runFfmpeg([
        "-f", "lavfi", "-i", "color=c=0x121820:s=1080x1920:r=5:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest",
        "-movflags", "+faststart", output,
      ]);
      return {
        clips: 2,
        rendered_duration_s: 1,
        creative_system_version: "pulse_visual_identity_v5",
        selected_input_assets: {
          schema_version: 1,
          authoritative: true,
          producer_id: "pulse-gaming-studio-v4-renderer",
          assets: rightsRows.map(({ asset_id, kind, path: filePath, source_url }) => ({
            asset_id,
            kind,
            path: filePath,
            source_url,
          })),
        },
        decoded_visual_gate: {
          status: "pass",
          decoded_media_evidence: true,
          blockers: [],
          frame_count: 5,
        },
      };
    },
  });

  assert.equal(renderReport.summary.rendered_count, 1, JSON.stringify(renderReport.jobs, null, 2));
  const inventory = await fs.readJson(path.join(artifactDir, "flagship", "inventory.json"));
  assert.equal(inventory.complete, true, JSON.stringify(inventory.blockers, null, 2));
  const trustedRenderInputs = await createTrustedRenderInputInventory({
    packageDir: artifactDir,
    inventory,
  });
  const evidence = await materializeFlagshipMediaEvidence({
    packageDir: artifactDir,
    inventory,
    outputDir: path.join(root, "flagship-proof"),
    generatedAt: "2026-07-15T08:26:00.000Z",
    trustedRenderInputs,
  });

  assert.equal(evidence.complete, true, JSON.stringify(evidence.blockers, null, 2));
  assert.equal(evidence.verdict, "GREEN");
  const finalVideo = evidence.final_outputs.final_video;
  const videoStream = finalVideo.technical_metadata.streams.find((stream) => stream.codec_type === "video");
  const audioStream = finalVideo.technical_metadata.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(finalVideo.media_readable, true);
  assert.equal(finalVideo.decode_verified, true);
  assert.equal(videoStream.width, 1080);
  assert.equal(videoStream.height, 1920);
  assert.equal(videoStream.codec_name, "h264");
  assert.equal(audioStream.codec_name, "aac");
  assert.equal(audioStream.sample_rate, 48000);
  assert.equal(evidence.used_assets.length, 3);
  assert.ok(evidence.used_assets.every((asset) => asset.verified));
});

test("goal production render materializer passes repaired first-frame cover text to renderer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-repaired-cover-"));
  const artifactDir = await makePackage(root, "fatal-fury-cover-render", {
    canonical_subject: "Fatal Fury City Of The Wolves",
    canonical_game: "Fatal Fury City Of The Wolves",
    selected_title: "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight",
    thumbnail_headline: "FATAL FURY CITY",
    thumbnail_text: "FATAL FURY CITY",
    suggested_thumbnail_text: "KENSHIRO ROSTER FIGHT",
    first_frame_text: "KENSHIRO ROSTER FIGHT",
    primary_source: "Xbox Wire",
    narration_script:
      "City of the Wolves just pulled in Kenshiro. Xbox Wire says the Fist of the North Star icon is joining Fatal Fury, so players have one real question. Follow Pulse Gaming so you never miss a beat.",
    first_spoken_line: "City of the Wolves just pulled in Kenshiro.",
    description: "Fatal Fury City Of The Wolves just turned a crossover into a real roster argument. Source: Xbox Wire.",
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("fatal-fury-cover-render", artifactDir)] },
    generatedAt: "2026-06-30T14:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 40,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls[0].first_frame_text, "KENSHIRO ROSTER FIGHT");
  assert.equal(calls[0].thumbnail_headline, "KENSHIRO ROSTER FIGHT");
});

test("goal production render materializer passes safe GTA VI TTS script to renderer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-gta-tts-"));
  const publicScript =
    "Sony just made GTA VI's console pitch very direct. " +
    "PlayStation Blog says Grand Theft Auto VI plays best on PS5 on November 19. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "gta-vi-final", {
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    selected_title: "GTA VI Just Made PS5 The Version To Watch",
    thumbnail_headline: "GTA VI PS5 TEST",
    primary_source: "PlayStation Blog",
    narration_script: publicScript,
    first_spoken_line: "Sony just made GTA VI's console pitch very direct.",
    description: "PlayStation Blog says Grand Theft Auto VI plays best on PS5. Source: PlayStation Blog.",
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("gta-vi-final", artifactDir)] },
    generatedAt: "2026-06-28T21:15:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].full_script, publicScript);
  assert.equal(
    calls[0].tts_script,
    "Sony just made Rockstar's next Grand Theft Auto console pitch very direct. " +
      "PlayStation Blog says Rockstar's next Grand Theft Auto plays best on PlayStation five on November 19. " +
      "Follow Pulse Gaming so you never miss a beat.",
  );
  assert.doesNotMatch(calls[0].tts_script, /\b(?:GTA|Grand Theft Auto)\s+(?:VI|six|6)\b/i);
});

test("goal production render materializer repairs explicit stale GTA VI TTS script before render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-gta-explicit-"));
  const narrationScript =
    "Rockstar's next Grand Theft Auto just made pre-orders a trust test. " +
    "Xbox Wire says Grand Theft Auto VI pre-orders open on June 25. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const staleTtsScript =
    "GTA si-six just made pre-orders a trust test. " +
    "Xbox Wire says GTA VI pre-orders open on June 25. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "gta-vi-explicit", {
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    selected_title: "GTA VI Starts The Preorder Fight",
    thumbnail_headline: "GTA VI PREORDER FIGHT",
    primary_source: "Xbox Wire",
    narration_script: narrationScript,
    full_script: narrationScript,
    tts_script: staleTtsScript,
    first_spoken_line: "Rockstar's next Grand Theft Auto just made pre-orders a trust test.",
    description: "Xbox Wire says GTA VI pre-orders open on June 25. Source: Xbox Wire.",
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("gta-vi-explicit", artifactDir)] },
    generatedAt: "2026-06-28T21:35:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].tts_script,
    "Rockstar's next Grand Theft Auto just made pre-orders a trust test. " +
      "Xbox Wire says Rockstar's next Grand Theft Auto pre-orders open on June 25. " +
      "Follow Pulse Gaming so you never miss a beat.",
  );
  assert.doesNotMatch(calls[0].tts_script, /\b(?:GTA|Grand Theft Auto)\s+(?:VI|six|6|si[-\s]*six)\b/i);
});

test("goal production render materializer preserves HyperFrames premium-shell target proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-shell-"));
  const artifactDir = await makePackage(root, "story-hf-shell");
  const job = readyJob("story-hf-shell", artifactDir);
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
    hyperframes_card_count: 4,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      requiredPassCount: 4,
      passCount: 4,
      blockers: [],
    },
    premium_shell_verdict: "pass",
    premium_shell_pass_count: 4,
    premium_shell_blockers: [],
  };

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:05:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-hf-shell",
        output,
        clips: 4,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.hyperframes_premium_shell_required, true);
  assert.equal(manifest.hyperframes_premium_shell_required_pass_count, 4);
  assert.equal(manifest.premium_shell_required_pass_count, 4);
  assert.equal(manifest.hyperframes_card_count, 4);
  assert.equal(manifest.premium_shell_verdict, "pass");
  assert.equal(manifest.premium_shell_pass_count, 4);
  assert.deepEqual(manifest.premium_shell_blockers, []);
  assert.equal(manifest.hyperframes_premium_shell_gate.verdict, "pass");
  assert.equal(manifest.hyperframes_premium_shell_gate.passCount, 4);
});

test("goal production render materializer preserves rendered card-visible windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-visible-cards-"));
  const artifactDir = await makePackage(root, "story-visible-cards");
  const visibleWindows = [
      {
        id: "scene_1_quote",
        kind: "quote",
        text: "THIS QUOTE CHANGES THE STORY",
        start_s: 5,
        end_s: 17,
        duration_s: 12,
        minimum_readable_duration_s: 12,
        source: "visual_v4_scene_plan",
      },
      {
        id: "scene_2_proof",
        kind: "proof",
        text: "SOURCE LOCKED",
        start_s: 17.35,
        end_s: 29.35,
        duration_s: 12,
        minimum_readable_duration_s: 12,
        source: "visual_v4_scene_plan",
      },
  ];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-visible-cards", artifactDir)] },
    generatedAt: "2026-05-22T07:04:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-visible-cards",
        output,
        clips: 5,
        rendered_duration_s: 28,
        size_bytes: 4096,
        clip_scene_plan: {
          repeat_free: true,
          repeated_base_sources: [],
          scenes: [
            { index: 0, path: "direct-a.mp4", baseSourceKey: "direct_a", durationS: 5 },
            { index: 1, path: "quote.mp4", readableCardKind: "quote", durationS: 8 },
          ],
        },
        card_visible_windows: visibleWindows,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.deepEqual(manifest.card_visible_windows, visibleWindows);
  assert.equal(manifest.clip_scene_plan.repeat_free, true);
  assert.deepEqual(manifest.clip_scene_plan.repeated_base_sources, []);
  assert.equal(manifest.overlay_card_windows.length >= 3, true);
});

test("goal production render materializer prefers unique direct motion bases for short-ready renders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-unique-direct-bases-"));
  const artifactDir = await makePackage(root, "story-unique-direct-bases");
  const clipRows = [
    ["clip-a-36.mp4", "steamstatic:/store_trailers/1/a/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/a/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-b-36.mp4", "steamstatic:/store_trailers/1/b/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/b/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-c-36.mp4", "steamstatic:/store_trailers/1/c/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/c/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-d-36.mp4", "steamstatic:/store_trailers/1/d/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/d/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-e-36.mp4", "steamstatic:/store_trailers/1/e/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/e/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-f-36.mp4", "steamstatic:/store_trailers/1/f/hash/video_window_36_5", "https://video.akamai.steamstatic.com/store_trailers/1/f/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-b-42.mp4", "steamstatic:/store_trailers/1/b/hash/video_window_42_5", "https://video.akamai.steamstatic.com/store_trailers/1/b/hash/video/hls_264_master.m3u8?t=1"],
    ["clip-c-42.mp4", "steamstatic:/store_trailers/1/c/hash/video_window_42_5", "https://video.akamai.steamstatic.com/store_trailers/1/c/hash/video/hls_264_master.m3u8?t=1"],
  ];
  const clips = [];
  for (const [fileName, sourceFamily, sourceUrl] of clipRows) {
    const clipPath = path.join(artifactDir, fileName);
    await fs.outputFile(clipPath, Buffer.alloc(2048, clips.length + 20));
    clips.push({
      id: fileName.replace(/\.mp4$/i, ""),
      path: clipPath,
      source_family: sourceFamily,
      motion_family: sourceFamily,
      source_url: sourceUrl,
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });

  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-unique-direct-bases", artifactDir)] },
    generatedAt: "2026-05-22T07:08:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-unique-direct-bases",
        output,
        clips: story.visual_v4_bridge_video_clips.length,
        rendered_duration_s: 36,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visual_v4_bridge_video_clips.length, 6);
  assert.deepEqual(directMotionBaseSourceOveruseEvidence(calls[0].visual_v4_bridge_video_clips).blockers, []);
  assert.equal(calls[0].visual_v4_bridge_video_clips.some((clip) => /clip-b-42|clip-c-42/.test(clip.path)), false);
});

test("goal production render materializer drops minority Steam app outlier clips before render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-steam-app-outlier-"));
  const artifactDir = await makePackage(root, "story-steam-app-outlier");
  const clips = [];
  const appRows = [
    ["dark-ages-a.mp4", "3017860", "a"],
    ["dark-ages-b.mp4", "3017860", "b"],
    ["dark-ages-c.mp4", "3017860", "c"],
    ["dark-ages-d.mp4", "3017860", "d"],
    ["dark-ages-e.mp4", "3017860", "e"],
    ["old-doom.mp4", "379720", "old"],
  ];
  for (const [fileName, appId, key] of appRows) {
    const clipPath = path.join(artifactDir, fileName);
    await fs.outputFile(clipPath, Buffer.alloc(2048, clips.length + 33));
    clips.push({
      id: fileName.replace(/\.mp4$/i, ""),
      path: clipPath,
      source_family: `steam_${appId}_doom_media_${key}_window_36_5`,
      motion_family: `steam_${appId}_doom_media_${key}_window_36_5`,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/${appId}/${key}/hash/video/hls_264_master.m3u8?t=1`,
      source_asset_key: `steam:${appId}:${key}`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      durationS: 5,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      trusted_local_source_families: clips.map((clip) => clip.source_family),
    },
    motion_budget: {
      required_motion_scenes: 5,
      available_motion_clips: clips.length,
      required_distinct_families: 4,
      available_distinct_motion_families: clips.length,
    },
    readiness: {
      status: "ready",
      blockers: [],
    },
  });
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 29,
      spoken_wpm: 150,
    },
  });

  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("story-steam-app-outlier", artifactDir, {
          title: "Doom The Dark Ages Chain Spear Changes The Fight",
          canonical_subject: "Doom: The Dark Ages",
          canonical_game: "Doom: The Dark Ages",
        }),
      ],
    },
    generatedAt: "2026-07-02T17:25:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-steam-app-outlier",
        output,
        clips: story.visual_v4_bridge_video_clips.length,
        rendered_duration_s: 38,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visual_v4_bridge_video_clips.length, 5);
  assert.ok(
    calls[0].visual_v4_bridge_video_clips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0) < 29,
  );
  assert.equal(calls[0].visual_v4_bridge_video_clips.some((clip) => /379720|old-doom/i.test(JSON.stringify(clip))), false);
  assert.equal(calls[0].visual_v4_director_plan.shot_plan.some((shot) => /379720|old-doom/i.test(JSON.stringify(shot))), false);
});

test("goal production render materializer preserves nested actual card-visible windows over overlay fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-nested-visible-cards-"));
  const artifactDir = await makePackage(root, "story-nested-visible-cards");
  const actualWindows = [
    {
      id: "scene_3_source",
      kind: "source",
      text: "XBOX WIRE",
      start_s: 12,
      end_s: 24,
      duration_s: 12,
      minimum_readable_duration_s: 12,
      source: "visual_v4_scene_plan",
    },
  ];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-nested-visible-cards", artifactDir)] },
    generatedAt: "2026-06-25T13:40:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-nested-visible-cards",
        output,
        clips: 6,
        rendered_duration_s: 32,
        size_bytes: 4096,
        clip_scene_plan: {
          repeat_free: true,
          repeated_base_sources: [],
          card_visible_windows: actualWindows,
          scenes: [
            { index: 0, path: "direct-a.mp4", baseSourceKey: "direct_a", durationS: 5 },
            { index: 3, path: "source-card.mp4", readableCardKind: "source", durationS: 1.6 },
          ],
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.deepEqual(manifest.card_visible_windows, actualWindows);
  assert.notDeepEqual(manifest.card_visible_windows, manifest.overlay_card_windows);
});

test("goal production render materializer rejects repeated clips and too-fast card windows from renderer reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-repeat-card-reject-"));
  const artifactDir = await makePackage(root, "story-repeat-card-reject");

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-repeat-card-reject", artifactDir)] },
    generatedAt: "2026-06-25T16:20:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: "story-repeat-card-reject",
        output,
        clips: 6,
        rendered_duration_s: 42,
        size_bytes: 4096,
        clip_scene_plan: {
          repeat_free: true,
          blockers: ["readable_card_kind_repeated"],
          repeated_base_sources: [{ key: "official_trailer_a", count: 3 }],
          repeated_readable_card_kinds: [{ kind: "proof", count: 2 }],
          card_visible_windows: [
            {
              id: "scene_2_proof",
              kind: "proof",
              text: "SOURCE LOCKED",
              start_s: 5,
              end_s: 8.2,
              duration_s: 3.2,
              minimum_readable_duration_s: 12,
              source: "visual_v4_scene_plan",
            },
          ],
        },
      };
    },
  });

  assert.equal(report.summary.rendered_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /production_render_visual_cadence_blocked/);
  assert.match(report.jobs[0].error, /direct_motion_base_source_repeated/);
  assert.match(report.jobs[0].error, /readable_card_kind_repeated/);
  assert.match(report.jobs[0].error, /card_visible_window_below_readable_floor/);
  assert.equal(await fs.pathExists(path.join(artifactDir, "render_manifest.json")), false);
});

test("goal production render materializer feeds passing HyperFrames shell cards into the V4 render story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-card-use-"));
  const artifactDir = await makePackage(root, "story-hf-card-use");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-card-use", kind),
  ));
  const job = readyJob("story-hf-card-use", artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-card-use-motion");
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
  };
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:06:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        hyperframes_premium_shell_required: renderStory.hyperframes_premium_shell_required,
        hyperframes_card_count: renderStory.hyperframes_card_count,
        hyperframes_premium_shell_gate: renderStory.hyperframes_premium_shell_gate,
        premium_shell_verdict: renderStory.premium_shell_verdict,
        premium_shell_pass_count: renderStory.premium_shell_pass_count,
        premium_shell_required_pass_count: renderStory.premium_shell_required_pass_count,
        premium_shell_blockers: renderStory.premium_shell_blockers,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(renderStory.hyperframes_premium_shell_required, true);
  assert.equal(renderStory.hyperframes_card_count, 3);
  assert.equal(renderStory.premium_shell_verdict, "pass");
  assert.equal(renderStory.premium_shell_pass_count, 5);
  assert.deepEqual(renderStory.premium_shell_blockers, []);
  assert.ok(renderStory.video_clips.some((clip) => /hf_source_card_story-hf-card-use\.mp4$/.test(clip)));
  assert.ok(
    renderStory.visual_v4_bridge_video_clips.some(
      (clip) => clip.source_type === "hyperframes_premium_shell_card",
    ),
  );
  const shellClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  const sourceCard = shellClips.find((clip) => clip.source_family === "hyperframes_source_card");
  const readableCards = shellClips.filter((clip) => clip.source_family !== "hyperframes_source_card");
  assert.equal(sourceCard.durationS, 2.6);
  assert.equal(sourceCard.duration_s, 2.6);
  assert.equal(sourceCard.maximum_visible_duration_s, 3.1);
  assert.ok(readableCards.every((clip) => clip.durationS >= 3.6 && clip.duration_s >= 3.6));
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.hyperframes_premium_shell_required, true);
  assert.equal(manifest.hyperframes_card_count, 3);
  assert.equal(manifest.premium_shell_verdict, "pass");
  assert.equal(manifest.premium_shell_pass_count, 5);
});

test("goal production render materializer rejects a stale HyperFrames source-card label before render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-source-label-"));
  const storyId = "story-hf-source-label-mismatch";
  const artifactDir = await makePackage(root, storyId, {
    primary_source: "Steam",
    source_card_label: "Steam",
  });
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, storyId, kind, {
      readableText: kind === "source" ? "KOTAKU NEWS SOURCE" : `${kind} proof card`,
    }),
  ));
  const job = readyJob(storyId, artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-source-label-motion");
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
  };
  let renderCalled = false;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T13:35:00.000Z",
    renderProof: async () => {
      renderCalled = true;
      throw new Error("render must not run for a stale source-card label");
    },
  });

  assert.equal(renderCalled, false);
  assert.equal(report.summary.rendered_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /production_render_source_card_identity_blocked/);
  assert.match(report.jobs[0].error, /source_card_label_mismatch:kotaku:steam/);
});

test("goal production render materializer allows an explicitly governed discovery-source card", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-source-allow-"));
  const storyId = "story-hf-source-label-allowed";
  const artifactDir = await makePackage(root, storyId, {
    primary_source: "Steam",
    source_card_label: "Steam",
    source_card_allowed_labels: ["Kotaku"],
  });
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, storyId, kind, {
      readableText: kind === "source" ? "KOTAKU NEWS SOURCE" : `${kind} proof card`,
    }),
  ));
  const job = readyJob(storyId, artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-source-allowed-motion");
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
  };

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T13:36:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.story_id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        hyperframes_premium_shell_required: story.hyperframes_premium_shell_required,
        hyperframes_card_count: story.hyperframes_card_count,
        hyperframes_premium_shell_gate: story.hyperframes_premium_shell_gate,
        premium_shell_verdict: story.premium_shell_verdict,
        premium_shell_pass_count: story.premium_shell_pass_count,
        premium_shell_required_pass_count: story.premium_shell_required_pass_count,
        premium_shell_blockers: story.premium_shell_blockers,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.summary.failed_count, 0);
});

test("goal production render materializer prefers the nearest complete sandbox card set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-nearest-"));
  const sandboxRoot = path.join(root, "output", "blackflag-sandbox");
  const storyId = "story-hf-nearest-sandbox";
  const artifactDir = await makePackage(sandboxRoot, storyId);
  const kinds = ["source", "context", "timeline", "quote", "takeaway"];
  await Promise.all(kinds.flatMap((kind) => [
    writePassingHyperframesCard(root, storyId, kind, {
      readableText: `STALE WORKSPACE ${kind} CARD`,
    }),
    writePassingHyperframesCard(sandboxRoot, storyId, kind, {
      readableText: `FRESH SANDBOX ${kind} CARD`,
    }),
  ]));
  const job = readyJob(storyId, artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-nearest-sandbox-motion");
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
  };
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-15T08:04:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 19));
      return {
        story_id: storyId,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        hyperframes_premium_shell_required: renderStory.hyperframes_premium_shell_required,
        hyperframes_card_count: renderStory.hyperframes_card_count,
        hyperframes_premium_shell_gate: renderStory.hyperframes_premium_shell_gate,
        premium_shell_verdict: renderStory.premium_shell_verdict,
        premium_shell_pass_count: renderStory.premium_shell_pass_count,
        premium_shell_required_pass_count: renderStory.premium_shell_required_pass_count,
        premium_shell_blockers: renderStory.premium_shell_blockers,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs, null, 2));
  const shellClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(shellClips.length > 0, true);
  assert.equal(shellClips.every((clip) => path.resolve(clip.path).startsWith(path.resolve(sandboxRoot))), true);
  assert.equal(shellClips.every((clip) => /FRESH SANDBOX/.test(clip.readable_text)), true);
});

test("goal production render materializer preserves readable HyperFrames card dwell from shell sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-card-dwell-"));
  const artifactDir = await makePackage(root, "story-hf-readable-dwell");
  await Promise.all([
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "source"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "context"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "takeaway", {
      readableText: "GTA VI cover art is live but the price and edition decision is not",
      minimumDurationS: 6.4,
      plannedDurationS: 6.4,
      maxDurationS: 6.4,
    }),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "quote"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "timeline"),
  ]);
  const job = readyJob("story-hf-readable-dwell", artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-readable-dwell-motion");
  job.actions[0].target_render_manifest = {
    ...job.actions[0].target_render_manifest,
    hyperframes_premium_shell_required: true,
    hyperframes_premium_shell_required_pass_count: 4,
  };
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-24T12:55:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 44,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const takeawayCard = renderStory.visual_v4_bridge_video_clips.find(
    (clip) => clip.source_family === "hyperframes_takeaway_card",
  );
  assert.equal(takeawayCard.durationS, 5.2);
  assert.equal(takeawayCard.minimum_readable_duration_s, 5.2);
  assert.equal(takeawayCard.maximum_visible_duration_s, 5.2);
  assert.match(takeawayCard.text, /price and edition decision/i);
});

test("goal production render materializer preserves validated official trailer windows from the same source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-official-window-dedupe-"));
  const artifactDir = await makePackage(root, "story-official-window-dedupe");
  const clipPaths = [];
  const clips = [];
  for (let index = 0; index < 8; index += 1) {
    const windowStart = 36 + index * 6;
    const clipPath = path.join(artifactDir, `gta-window-${windowStart}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, 60 + index));
    clipPaths.push(clipPath);
    clips.push({
      id: `segment_direct_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
      source_type: "official_game_website_media_page",
      source_kind: "video_file",
      source_family: `rockstar_gta_vi_official_videos__media_02_gtavi_trailer_2_window_${windowStart}_5`,
      motion_family: `rockstar_gta_vi_official_videos__media_02_gtavi_trailer_2_window_${windowStart}_5`,
      media_kind: "direct_video",
      source_url_kind: "direct_video",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  const job = readyJob("story-official-window-dedupe", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 8,
      distinct_motion_family_count: 8,
      materialised_motion_clip_paths: clipPaths,
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-26T03:45:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 37,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  assert.equal(directClips.length, 8);
  assert.equal(new Set(directClips.map((clip) => clip.source_url)).size, 1);
  assert.equal(new Set(directClips.map((clip) => clip.source_family)).size, 8);
  assert.ok(directClips.every(
    (clip) => clip.source_url === "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
  ));
});

test("goal production render materializer preserves PlayStation Blog news-page direct video windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-ps-blog-window-dedupe-"));
  const artifactDir = await makePackage(root, "story-ps-blog-window-dedupe");
  const clipPaths = [];
  const clips = [];
  for (let index = 0; index < 8; index += 1) {
    const windowStart = 36 + index * 6;
    const clipPath = path.join(artifactDir, `ps-blog-window-${windowStart}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, 80 + index));
    clipPaths.push(clipPath);
    clips.push({
      id: `segment_direct_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: "https://vulcan.dl.playstation.net/img/rnd/202606/0505/marvel-tokon-roster.mp4",
      source_type: "official_game_site_news_page",
      source_kind: "video_file",
      source_family: `playstation_blog_marvel_tokon_roster_window_${windowStart}_5`,
      motion_family: `playstation_blog_marvel_tokon_roster_window_${windowStart}_5`,
      media_kind: "direct_video",
      source_url_kind: "direct_video",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  const job = readyJob("story-ps-blog-window-dedupe", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 8,
      distinct_motion_family_count: 8,
      materialised_motion_clip_paths: clipPaths,
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-01T04:45:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 37,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  assert.equal(directClips.length, 8);
  assert.equal(new Set(directClips.map((clip) => clip.source_url)).size, 1);
  assert.equal(new Set(directClips.map((clip) => clip.source_family)).size, 8);
});

test("goal production render materializer preserves validated Steam trailer windows from the same source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-steam-window-dedupe-"));
  const artifactDir = await makePackage(root, "story-steam-window-dedupe");
  const clipPaths = [];
  const clips = [];
  for (let index = 0; index < 8; index += 1) {
    const windowStart = 36 + index * 6;
    const clipPath = path.join(artifactDir, `steam-window-${windowStart}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, 70 + index));
    clipPaths.push(clipPath);
    clips.push({
      id: `segment_steam_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: "https://video.akamai.steamstatic.com/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008/hls_264_master.m3u8",
      source_type: "steam_movie",
      source_kind: "video_file",
      source_family: `steamstatic:/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008_window_${windowStart}_5`,
      media_kind: "direct_video",
      source_url_kind: "hls_manifest",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  const job = readyJob("story-steam-window-dedupe", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 8,
      distinct_motion_family_count: 8,
      materialised_motion_clip_paths: clipPaths,
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-26T04:15:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 37,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  assert.equal(directClips.length, 8);
  assert.equal(new Set(directClips.map((clip) => clip.source_url)).size, 1);
  assert.equal(new Set(directClips.map((clip) => clip.source_family)).size, 8);
});

test("goal production render materializer limits HyperFrames cards to a readable motion-balanced subset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-balanced-"));
  const artifactDir = await makePackage(root, "story-hf-balanced");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-balanced", kind),
  ));
  const clipPaths = Array.from({ length: 5 }, (_, index) =>
    path.join(artifactDir, `balanced-clip-${index + 1}.mp4`),
  );
  await Promise.all(clipPaths.map((clipPath, index) =>
    fs.outputFile(clipPath, Buffer.alloc(2048, 30 + index)),
  ));
  const job = readyJob("story-hf-balanced", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 5,
      distinct_motion_family_count: 5,
      materialised_motion_clip_paths: clipPaths,
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-25T10:15:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 48,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(cardClips.length, 3);
  assert.equal(renderStory.hyperframes_card_count, 3);
  assert.equal(renderStory.hyperframes_available_card_count, 5);
  const sourceCards = cardClips.filter((clip) => clip.source_family === "hyperframes_source_card");
  const readableCards = cardClips.filter((clip) => clip.source_family !== "hyperframes_source_card");
  assert.ok(sourceCards.every((clip) => clip.durationS === 2.6 && clip.minimum_readable_duration_s <= 2.6));
  assert.ok(readableCards.every((clip) => clip.durationS >= 3.6 && clip.minimum_readable_duration_s >= 3.6));
  assert.deepEqual(
    [...new Set(cardClips.map((clip) => clip.source_family))],
    cardClips.map((clip) => clip.source_family),
  );
});

test("goal production render materializer limits HyperFrames cards by narration duration budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-duration-budget-"));
  const artifactDir = await makePackage(root, "story-hf-duration-budget");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-duration-budget", kind, {
      ...(kind === "source" ? {} : { minimumDurationS: 4.1, plannedDurationS: 4.1 }),
    }),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 34.6,
      spoken_wpm: 160,
    },
  });
  const clipPaths = Array.from({ length: 5 }, (_, index) =>
    path.join(artifactDir, `duration-budget-clip-${index + 1}.mp4`),
  );
  await Promise.all(clipPaths.map((clipPath, index) =>
    fs.outputFile(clipPath, Buffer.alloc(2048, 50 + index)),
  ));
  const durationBudgetClips = clipPaths.map((clipPath, index) => ({
    id: `duration-budget-clip-${index + 1}`,
    path: clipPath,
    local_materialized_path: clipPath,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/3017860/${index + 1}/duration-budget/hls_264_master.m3u8`,
    source_type: "steam_movie",
    source_kind: "video_file",
    source_family: `steamstatic:/store_trailers/3017860/${index + 1}/duration_budget_window_${36 + index * 6}_5`,
    motion_family: `steamstatic:/store_trailers/3017860/${index + 1}/duration_budget_window_${36 + index * 6}_5`,
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    counts_towards_motion_readiness: true,
    validated: true,
    durationS: 5,
  }));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: durationBudgetClips,
    materialised_clips: durationBudgetClips,
  });
  const job = readyJob("story-hf-duration-budget", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 5,
      distinct_motion_family_count: 5,
      materialised_motion_clip_paths: clipPaths,
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-25T20:40:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 34.6,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(cardClips.length, 2);
  assert.equal(renderStory.hyperframes_card_count, 2);
  assert.equal(renderStory.hyperframes_available_card_count, 5);
  assert.equal(renderStory.premium_shell_required_selected_card_count, 2);
  assert.equal(renderStory.premium_shell_verdict, "pass");
  assert.deepEqual(renderStory.premium_shell_blockers, []);
  assert.equal(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS,
    Number(cardClips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0).toFixed(3)),
  );
  assert.equal(renderStory.hyperframes_premium_shell_gate.maxReadableCardDurationS, 8.65);
  assert.ok(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS <= 34.6 * 0.25 + 0.01,
  );
  assert.equal(renderStory.hyperframes_premium_shell_gate.requiredSelectedCardCount, 2);
});

test("goal production render materializer applies the V5 card budget to a 52 second narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-v4-budget-"));
  const artifactDir = await makePackage(root, "story-hf-v4-budget");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-v4-budget", kind, {
      ...(kind === "source"
        ? {}
        : { minimumDurationS: 6, plannedDurationS: 6, maxDurationS: 6.4 }),
    }),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 51.909,
      spoken_wpm: 154,
    },
  });
  const directClips = Array.from({ length: 8 }, (_, index) => ({
    id: `v4-budget-direct-${index + 1}`,
    path: path.join(artifactDir, `v4-budget-direct-${index + 1}.mp4`),
    local_materialized_path: path.join(artifactDir, `v4-budget-direct-${index + 1}.mp4`),
    source_url: `C:/proof/official-source-${Math.floor(index / 2) + 1}.mp4`,
    source_type: "official_platform_product_page",
    source_kind: "video_file",
    base_source_family: `official-platform-root-${Math.floor(index / 2) + 1}`,
    source_family: `official-platform-root-${Math.floor(index / 2) + 1}_window_${36 + (index % 2) * 6}_5`,
    motion_family: `official-platform-root-${Math.floor(index / 2) + 1}_window_${36 + (index % 2) * 6}_5`,
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    counts_towards_motion_readiness: true,
    validated: true,
    durationS: 5.5,
  }));
  await Promise.all(directClips.map((clip, index) =>
    fs.outputFile(clip.path, Buffer.alloc(2048, 110 + index)),
  ));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: directClips,
    materialised_clips: directClips,
  });
  const job = readyJob("story-hf-v4-budget", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: directClips.length,
      distinct_motion_family_count: directClips.length,
      materialised_motion_clip_paths: directClips.map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-13T18:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 51.909,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(cardClips.length, 2);
  assert.equal(renderStory.hyperframes_premium_shell_gate.maxReadableCardDurationRatio, 0.25);
  assert.equal(renderStory.hyperframes_premium_shell_gate.maxReadableCardDurationS, 12.977);
  assert.ok(
    cardClips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0) <=
      51.909 * 0.25 + 0.01,
  );
});

test("goal production render materializer keeps selected HyperFrames dwell within the V4 narration budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-dwell-extension-"));
  const artifactDir = await makePackage(root, "story-hf-dwell-extension");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-dwell-extension", kind, {
      ...(kind === "source" ? {} : { minimumDurationS: 4.1, plannedDurationS: 4.1, maxDurationS: 6.4 }),
    }),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 42.028,
      spoken_wpm: 154,
    },
  });
  const directClips = Array.from({ length: 6 }, (_, index) => ({
    id: `direct-motion-${index + 1}`,
    path: path.join(artifactDir, `direct-${index + 1}.mp4`),
    source_url: `https://video.akamai.steamstatic.com/store_trailers/3017860/${index + 1}/official/hls_264_master.m3u8`,
    source_type: "steam_movie",
    source_kind: "video_file",
    source_family: `steamstatic:/store_trailers/3017860/${index + 1}/official_window_${36 + index * 6}_5`,
    motion_family: `steamstatic:/store_trailers/3017860/${index + 1}/official_window_${36 + index * 6}_5`,
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    counts_towards_motion_readiness: true,
    validated: true,
    durationS: 5,
  }));
  await Promise.all(directClips.map((clip, index) =>
    fs.outputFile(clip.path, Buffer.alloc(2048, 90 + index)),
  ));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: directClips.length,
    distinct_motion_family_count: directClips.length,
    direct_video_motion_asset_count: directClips.length,
    direct_video_motion_family_count: directClips.length,
    clips: directClips,
    materialised_clips: directClips,
  });
  const job = readyJob("story-hf-dwell-extension", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: directClips.length,
      distinct_motion_family_count: directClips.length,
      materialised_motion_clip_paths: directClips.map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-02T17:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 42.028,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const directClipCount = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  ).length;
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(directClipCount, 6);
  assert.equal(cardClips.length, 2);
  const sourceCard = cardClips.find((clip) => clip.source_family === "hyperframes_source_card");
  const readableCards = cardClips.filter((clip) => clip.source_family !== "hyperframes_source_card");
  assert.ok(sourceCard.durationS >= 1.6);
  assert.ok(sourceCard.durationS <= 3.1);
  assert.ok(readableCards.every((clip) => clip.durationS >= 4.1));
  assert.ok(readableCards.every((clip) => clip.durationS <= 6.4));
  assert.ok(
    cardClips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0) <=
      42.028 * 0.25 + 0.01,
  );
  assert.equal(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS,
    Number(cardClips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0).toFixed(3)),
  );
});

test("goal production render materializer tops up balanced direct windows when HyperFrames duration would under-cover narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-coverage-topup-"));
  const artifactDir = await makePackage(root, "story-hf-coverage-topup");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-coverage-topup", kind, {
      ...(kind === "source" ? {} : { minimumDurationS: 4.1, plannedDurationS: 4.1 }),
    }),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 44.8,
      spoken_wpm: 158,
    },
  });
  const clipRows = [
    ["clip-a-36.mp4", "a", 36],
    ["clip-b-36.mp4", "b", 36],
    ["clip-c-36.mp4", "c", 36],
    ["clip-d-36.mp4", "d", 36],
    ["clip-e-36.mp4", "e", 36],
    ["clip-f-36.mp4", "f", 36],
    ["clip-b-42.mp4", "b", 42],
    ["clip-c-42.mp4", "c", 42],
  ];
  const clips = [];
  for (const [fileName, rootKey, windowStart] of clipRows) {
    const clipPath = path.join(artifactDir, fileName);
    await fs.outputFile(clipPath, Buffer.alloc(2048, clips.length + 30));
    clips.push({
      id: fileName.replace(/\.mp4$/i, ""),
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/3936610/${rootKey}/trailer/hls_264_master.m3u8`,
      source_type: "steam_movie",
      source_kind: "video_file",
      source_family: `steamstatic:/store_trailers/3936610/${rootKey}/trailer_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/3936610/${rootKey}/trailer_window_${windowStart}_5`,
      media_kind: "direct_video",
      source_url_kind: "hls_manifest",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
    materialised_clips: clips,
  });
  const job = readyJob("story-hf-coverage-topup", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: clips.length,
      distinct_motion_family_count: clips.length,
      materialised_motion_clip_paths: clips.map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-02T11:45:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 44.8,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  const coverage = [...directClips, ...cardClips].reduce(
    (sum, clip) => sum + Number(clip.durationS || 0),
    0,
  ) - 0.25 * Math.max(0, directClips.length + cardClips.length - 1);
  assert.ok(directClips.length >= 6);
  assert.ok(cardClips.length >= 2);
  assert.equal(cardClips.some((clip) => clip.source_family === "hyperframes_source_card"), true);
  assert.ok(cardClips.filter((clip) => clip.source_family !== "hyperframes_source_card").length >= 1);
  assert.ok(coverage + 0.12 >= 44.8);
});

test("goal production render materializer does not top up when adaptive crossfades already cover narration", () => {
  const directDurations = [5, 5, 5, 5, 5, 5, 3, 3, 3];
  const primaryClips = directDurations.map((durationS, index) => ({
    id: `fog-primary-${index + 1}`,
    path: `fog-primary-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    media_kind: "direct_video",
    source_family: `fog_root_${index + 1}_window_0_${durationS}`,
    durationS,
  }));
  const shellClips = [2.7, 4.1, 6.4, 4.1].map((durationS, index) => ({
    id: `fog-card-${index + 1}`,
    path: `fog-card-${index + 1}.mp4`,
    source_type: "hyperframes_premium_shell_card",
    media_kind: "owned_editorial_motion_graphic",
    source_family: `hyperframes_card_${index + 1}`,
    durationS,
  }));
  const fallbackClips = [
    ...primaryClips,
    {
      id: "overlapping-demo-window",
      path: "overlapping-demo-window.mp4",
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: "fog_demo_window_3_5",
      durationS: 2.4,
    },
  ];

  const selected = _private.topUpPrimaryClipsForAudioCoverage({
    primaryClips,
    fallbackClips,
    shellClips,
    audioDurationS: 55.82,
  });

  assert.equal(selected.length, primaryClips.length);
  assert.equal(selected.some((clip) => clip.id === "overlapping-demo-window"), false);
});

test("goal production render materializer preserves premium direct runway when HyperFrames cards are added", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-direct-runway-"));
  const artifactDir = await makePackage(root, "story-hf-direct-runway");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-direct-runway", kind),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 58.514,
      spoken_wpm: 154.8,
    },
  });
  const directClips = Array.from({ length: 10 }, (_, index) => {
    const strictBaseIndex = index < 6 ? Math.floor(index / 2) + 1 : index - 2;
    const windowStart = index % 2 === 0 ? 36 : 42;
    const clipPath = path.join(artifactDir, `tokon-direct-${index + 1}.mp4`);
    return {
      id: `segment_direct_motion_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.steamstatic.example.com/store_trailers/3787240/${strictBaseIndex}/clip-${windowStart}.mp4`,
      source_type: "steam_movie",
      source_kind: "video_file",
      source_family: `steamstatic:/store_trailers/3787240/base_${strictBaseIndex}_window_${windowStart}_5`,
      motion_family: `steamstatic:/store_trailers/3787240/base_${strictBaseIndex}_window_${windowStart}_5`,
      media_kind: "direct_video",
      source_url_kind: "hls_manifest",
      counts_towards_motion_readiness: true,
      validated: true,
      durationS: 5,
    };
  });
  await Promise.all(directClips.map((clip, index) =>
    fs.outputFile(clip.path, Buffer.alloc(2048, 90 + index)),
  ));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: directClips.length,
    distinct_motion_family_count: directClips.length,
    direct_video_motion_asset_count: directClips.length,
    direct_video_motion_family_count: directClips.length,
    clips: directClips,
    materialised_clips: directClips,
  });
  const job = readyJob("story-hf-direct-runway", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: directClips.length,
      distinct_motion_family_count: directClips.length,
      materialised_motion_clip_paths: directClips.map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-01T22:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 58.514,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const selectedDirectClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  const selectedCardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(selectedDirectClips.length, 10);
  assert.equal(selectedCardClips.length, 3);
  assert.equal(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS,
    Number(selectedCardClips.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0).toFixed(3)),
  );
  assert.ok(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS <= 58.514 * 0.25 + 0.01,
  );
  assert.ok(
    selectedDirectClips.every((clip) => /window_(?:36|42)_5/.test(clip.source_family)),
  );
});

test("goal production render materializer does not stack legacy owned cards on premium HyperFrames cards", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-no-stack-"));
  const artifactDir = await makePackage(root, "story-hf-no-stack");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-no-stack", kind, {
      ...(kind === "source" ? {} : { minimumDurationS: 4.1, plannedDurationS: 4.1 }),
    }),
  ));
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 38.88,
      spoken_wpm: 150,
    },
  });
  const directClips = Array.from({ length: 8 }, (_, index) => ({
    id: `direct-motion-${index + 1}`,
    path: path.join(artifactDir, `direct-${index + 1}.mp4`),
    source_url: `https://media.example.com/trailer-window-${index + 1}.mp4`,
    source_type: "official_game_website_media_page",
    media_kind: "direct_video",
    source_family: `official_trailer_window_${index + 1}_5`,
    counts_towards_motion_readiness: true,
    durationS: 5,
  }));
  const legacyOwnedCards = [
    {
      id: "legacy-owned-source-card",
      path: path.join(artifactDir, "legacy-source-card.mp4"),
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      source_family: "legacy_animated_source_card",
      text: "SOURCE LOCKED",
      owned_explainer_visual_plan: true,
      counts_towards_motion_readiness: true,
      durationS: 12,
    },
    {
      id: "legacy-owned-quote-card",
      path: path.join(artifactDir, "legacy-quote-card.mp4"),
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      source_family: "legacy_animated_quote_card",
      text: "THE QUOTE NEEDS TIME TO READ",
      owned_explainer_visual_plan: true,
      counts_towards_motion_readiness: true,
      durationS: 12,
    },
  ];
  await Promise.all([...directClips, ...legacyOwnedCards].map((clip, index) =>
    fs.outputFile(clip.path, Buffer.alloc(2048, 70 + index)),
  ));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips: [...directClips, ...legacyOwnedCards],
  });
  const job = readyJob("story-hf-no-stack", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
      word_timestamp_source: "local_whisper_word_alignment",
      materialised_motion_clip_count: 10,
      distinct_motion_family_count: 10,
      materialised_motion_clip_paths: [...directClips, ...legacyOwnedCards].map((clip) => clip.path),
    },
  });
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-27T05:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 38.88,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const readableCards = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) =>
      clip.source_type === "hyperframes_premium_shell_card" ||
      clip.media_kind === "owned_explainer_motion",
  );
  assert.ok(readableCards.length >= 1);
  assert.ok(readableCards.every((clip) => clip.source_type === "hyperframes_premium_shell_card"));
  assert.equal(renderStory.hyperframes_card_count, readableCards.length);
  assert.equal(renderStory.hyperframes_available_card_count, 5);
  assert.ok(
    readableCards.reduce((sum, clip) => sum + Number(clip.durationS || 0), 0) <=
      38.88 * 0.25 + 0.01,
  );
});

test("goal production render materializer auto-preserves HyperFrames shell cards on rerender work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-auto-"));
  const artifactDir = await makePackage(root, "story-hf-auto");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-auto", kind),
  ));
  const job = readyJob("story-hf-auto", artifactDir);
  await addMotionEvidence(artifactDir, job, 7, "hf-auto-motion");
  let renderStory = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:06:30.000Z",
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        hyperframes_premium_shell_required: renderStory.hyperframes_premium_shell_required,
        hyperframes_card_count: renderStory.hyperframes_card_count,
        hyperframes_premium_shell_gate: renderStory.hyperframes_premium_shell_gate,
        premium_shell_verdict: renderStory.premium_shell_verdict,
        premium_shell_pass_count: renderStory.premium_shell_pass_count,
        premium_shell_required_pass_count: renderStory.premium_shell_required_pass_count,
        premium_shell_blockers: renderStory.premium_shell_blockers,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(renderStory.hyperframes_premium_shell_required, true);
  assert.equal(renderStory.hyperframes_card_count, 3);
  assert.equal(renderStory.premium_shell_verdict, "pass");
  assert.equal(renderStory.premium_shell_pass_count, 5);
  assert.deepEqual(renderStory.premium_shell_blockers, []);
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.hyperframes_premium_shell_required, true);
  assert.equal(manifest.hyperframes_card_count, 3);
  assert.equal(manifest.premium_shell_verdict, "pass");
  assert.equal(manifest.premium_shell_pass_count, 5);
  assert.equal(manifest.hyperframes_premium_shell_gate.verdict, "pass");
});

test("goal production render materializer prefers repaired materialised motion over stale rights-ledger motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-fresh-motion-"));
  const artifactDir = await makePackage(root, "fresh-motion-wins");
  const staleClips = ["stale-1.mp4", "stale-2.mp4", "stale-duplicate.mp4"];
  const freshClips = ["fresh-1.mp4", "fresh-2.mp4", "fresh-3.mp4"];
  await Promise.all(
    [...staleClips, ...freshClips].map((clipName) =>
      fs.outputFile(path.join(artifactDir, clipName), Buffer.alloc(2048, clipName.charCodeAt(0))),
    ),
  );
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: staleClips.map((clipName, index) => ({
      id: `stale-rights-${index + 1}`,
      path: path.join(artifactDir, clipName),
      source_url: index === 2
        ? "https://video.example.com/stale-trailer-1.m3u8"
        : `https://video.example.com/stale-trailer-${index + 1}.m3u8`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      asset_type: "direct_video_motion_clip",
      source_family: `stale_motion_${index + 1}`,
      licence_basis: "official_reference_transformative_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    repaired_at: "2026-06-22T12:45:00.000Z",
    clips: freshClips.map((clipName, index) => ({
      id: `fresh-motion-${index + 1}`,
      path: path.join(artifactDir, clipName),
      source_url: `https://video.example.com/fresh-trailer-${index + 1}.m3u8`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      source_family: `fresh_motion_${index + 1}`,
      counts_towards_motion_readiness: true,
      materialized: true,
      licence_basis: "official_reference_transformative_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved",
    })),
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("fresh-motion-wins", artifactDir)] },
    generatedAt: "2026-06-22T12:46:00.000Z",
    force: true,
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 42,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.deepEqual(calls[0].video_clips, freshClips.map((clipName) => path.join(artifactDir, clipName)));
  assert.deepEqual(
    calls[0].visual_v4_bridge_video_clips.map((clip) => clip.source_family),
    ["fresh_motion_1", "fresh_motion_2", "fresh_motion_3"],
  );
});

test("goal production render materializer rechecks repaired motion with decoded QA before rendering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-repaired-motion-qa-"));
  const artifactDir = await makePackage(root, "repaired-motion-qa");
  const clips = Array.from({ length: 8 }, (_, index) => {
    const clipPath = path.join(artifactDir, `repaired-motion-${index + 1}.mp4`);
    return {
      id: `repaired-motion-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://www.youtube.com/watch?v=official-source-${index + 1}`,
      source_type: "official_publisher_trailer_segment",
      source_family: `official_source_${index + 1}_window_${index * 5}_4`,
      base_source_family: `youtube:official-source-${index + 1}`,
      motion_family: `official_source_${index + 1}_window_${index * 5}_4`,
      media_kind: "direct_video",
      rights_basis: "official_publisher_editorial_reference",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 4,
    };
  });
  await Promise.all(
    clips.map((clip, index) => fs.outputFile(clip.path, Buffer.alloc(2048, index + 20))),
  );
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    repaired_at: "2026-07-16T09:10:00.000Z",
    clips,
  });

  const rejectedClip = clips[4];
  const selectorCalls = [];
  const renderCalls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("repaired-motion-qa", artifactDir)] },
    generatedAt: "2026-07-16T09:11:00.000Z",
    force: true,
    directMotionFilter: async (selectedClips, options) => {
      selectorCalls.push({ selectedClips, options });
      const acceptedClips = selectedClips.filter((clip) => clip.path !== rejectedClip.path);
      return {
        version: "pulse_direct_motion_visual_selector_v5",
        policy_tier: options.policyTier,
        clips: acceptedClips,
        accepted: acceptedClips.map((clip) => ({
          path: clip.path,
          eligible: true,
          reasons: [],
          metrics: { decoded_sample_count: 20 },
        })),
        rejected: [{
          path: rejectedClip.path,
          eligible: false,
          reasons: ["direct_motion_frame_taste_failed"],
          metrics: {
            decoded_sample_count: 20,
            failed_taste_sample_count: 1,
          },
        }],
        source_diversity: { strict_pass: true },
        professional_source_diversity: { status: "pass", blockers: [] },
        blockers: [],
      };
    },
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      renderCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 40,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs));
  assert.equal(selectorCalls.length, 1);
  assert.equal(selectorCalls[0].options.policyTier, "ultimate_professional");
  assert.equal(renderCalls[0].video_clips.includes(rejectedClip.path), false);
  assert.equal(renderCalls[0].visual_v4_bridge_video_clips.length, 7);
  const persisted = await fs.readJson(
    path.join(artifactDir, "qa", "direct-motion", "final_selection_dense_selector_report.json"),
  );
  assert.equal(persisted.rejected.length, 1);
  assert.equal(persisted.rejected[0].path, rejectedClip.path);
});

test("goal production render materializer restores readable card coverage after final motion QA rejects a clip", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-post-qa-coverage-"));
  const storyId = "post-qa-coverage";
  const artifactDir = await makePackage(root, storyId);
  await Promise.all(
    ["source", "context", "takeaway"].map((kind) =>
      writePassingHyperframesCard(root, storyId, kind),
    ),
  );
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    cadence: {
      duration_seconds: 30,
      spoken_wpm: 150,
    },
  });
  const clips = Array.from({ length: 8 }, (_, index) => {
    const clipPath = path.join(artifactDir, `post-qa-motion-${index + 1}.mp4`);
    return {
      id: `post-qa-motion-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://www.youtube.com/watch?v=post-qa-source-${index + 1}`,
      source_type: "official_publisher_trailer_segment",
      source_family: `post_qa_source_${index + 1}_window_${index * 4}_4`,
      base_source_family: `youtube:post-qa-source-${index + 1}`,
      motion_family: `post_qa_source_${index + 1}_window_${index * 4}_4`,
      media_kind: "direct_video",
      rights_basis: "official_publisher_editorial_reference",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 4,
    };
  });
  await Promise.all(
    clips.map((clip, index) => fs.outputFile(clip.path, Buffer.alloc(2048, index + 40))),
  );
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    repaired_at: "2026-07-16T10:00:00.000Z",
    clips,
  });

  const rejectedClip = clips[3];
  let selectorInputCount = 0;
  let renderStory = null;
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob(storyId, artifactDir, {
          evidence: {
            narration_audio_path: path.join(artifactDir, "audio.mp3"),
            word_timestamps_path: path.join(artifactDir, "timestamps.json"),
            word_timestamp_source: "local_whisper_word_alignment",
            materialised_motion_clip_count: clips.length,
            distinct_motion_family_count: clips.length,
            materialised_motion_clip_paths: clips.map((clip) => clip.path),
          },
        }),
      ],
    },
    generatedAt: "2026-07-16T10:01:00.000Z",
    force: true,
    directMotionFilter: async (selectedClips, options) => {
      selectorInputCount = selectedClips.length;
      const acceptedClips = selectedClips.filter((clip) => clip.path !== rejectedClip.path);
      return {
        version: "pulse_direct_motion_visual_selector_v5",
        policy_tier: options.policyTier,
        clips: acceptedClips,
        accepted: acceptedClips.map((clip) => ({
          path: clip.path,
          eligible: true,
          reasons: [],
          metrics: { decoded_sample_count: 20 },
        })),
        rejected: [{
          path: rejectedClip.path,
          eligible: false,
          reasons: ["direct_motion_portrait_crop_embedded_text_truncation_risk"],
          metrics: { decoded_sample_count: 20, failed_taste_sample_count: 3 },
        }],
        source_diversity: { strict_pass: true },
        professional_source_diversity: { status: "pass", blockers: [] },
        blockers: [],
      };
    },
    renderProof: async ({ storyJson, output }) => {
      renderStory = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return {
        story_id: renderStory.story_id,
        output,
        clips: renderStory.video_clips.length,
        rendered_duration_s: 30,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs));
  assert.equal(selectorInputCount, 8);
  assert.ok(renderStory);
  const directClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.media_kind === "direct_video",
  );
  const cardClips = renderStory.visual_v4_bridge_video_clips.filter(
    (clip) => clip.source_type === "hyperframes_premium_shell_card",
  );
  assert.equal(directClips.length, 7);
  assert.equal(directClips.some((clip) => clip.path === rejectedClip.path), false);
  assert.ok(cardClips.length >= 1);
  assert.ok(cardClips.length <= 2);
  assert.ok(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS > 0,
  );
  assert.ok(
    renderStory.hyperframes_premium_shell_gate.selectedCardDurationS <= 7.5,
  );
});

test("goal production render materializer persists renderer loudness evidence beside the story package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-loudness-"));
  const artifactDir = await makePackage(root, "story-loudness");
  const scratchReportPath = path.join(root, "scratch", "story-loudness_audio_segment_loudness_report.json");
  await fs.outputJson(scratchReportPath, {
    story_id: "story-loudness",
    verdict: "pass",
    generated_at: "2026-06-15T04:00:00.000Z",
    blockers: [],
    metrics: {
      max_segment_lufs_delta: 1.8,
    },
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-loudness", artifactDir)] },
    generatedAt: "2026-06-15T04:01:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        audio_segment_loudness_report: scratchReportPath,
      };
    },
  });

  const persistedPath = path.join(artifactDir, "audio_segment_loudness_report.json");
  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.jobs[0].audio_segment_loudness_report_path, persistedPath);
  assert.equal(await fs.pathExists(persistedPath), true);

  const persisted = await fs.readJson(persistedPath);
  assert.equal(persisted.verdict, "pass");
  assert.equal(persisted.story_id, "story-loudness");
  assert.equal(persisted.persisted_for_story_id, "story-loudness");
  assert.equal(persisted.persisted_from_render_report, true);
  assert.equal(persisted.input_path, path.join(artifactDir, "visual_v4_render.mp4"));
  assert.equal(persisted.renderer_report_input_path, null);
  assert.equal(persisted.final_render_binding.exact, true);
  assert.equal(persisted.final_render_binding.path, path.join(artifactDir, "visual_v4_render.mp4"));
  assert.equal(persisted.final_render_binding.size_bytes, 4096);
  assert.match(persisted.final_render_binding.sha256, /^[a-f0-9]{64}$/);
});

test("goal production render materializer resolves repo-relative renderer loudness evidence outside an isolated workspace", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-relative-loudness-"));
  const artifactDir = await makePackage(root, "story-relative-loudness");
  const scratchReportPath = path.join(
    process.cwd(),
    "test",
    "output",
    `${path.basename(root)}_audio_segment_loudness_report.json`,
  );
  t.after(() => fs.remove(scratchReportPath));
  await fs.outputJson(scratchReportPath, {
    story_id: "story-relative-loudness",
    verdict: "pass",
    generated_at: "2026-07-15T18:05:00.000Z",
    blockers: [],
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-relative-loudness", artifactDir)] },
    generatedAt: "2026-07-15T18:06:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
        audio_segment_loudness_report: path.relative(process.cwd(), scratchReportPath),
      };
    },
  });

  const persistedPath = path.join(artifactDir, "audio_segment_loudness_report.json");
  assert.equal(report.jobs[0].audio_segment_loudness_report_path, persistedPath);
  const persisted = await fs.readJson(persistedPath);
  assert.equal(persisted.story_id, "story-relative-loudness");
  assert.equal(persisted.input_path, path.join(artifactDir, "visual_v4_render.mp4"));
  assert.equal(persisted.renderer_report_input_path, null);
  assert.equal(persisted.final_render_binding.exact, true);
});

test("goal production render materializer passes visual safe-margin repair intent to renderer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-safe-margins-"));
  const artifactDir = await makePackage(root, "safe-margin-rerender");
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("safe-margin-rerender", artifactDir, {
          repair_lane: "visual_safe_text_margin_rerender",
          blocker_types: ["possible_edge_text_cutoff"],
        }),
      ],
    },
    generatedAt: "2026-06-01T00:18:00.000Z",
    force: true,
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 18));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls[0].render_safe_text_margins, true);
  assert.equal(calls[0].visual_repair_lane, "visual_safe_text_margin_rerender");
  assert.deepEqual(calls[0].visual_repair_blocker_types, ["possible_edge_text_cutoff"]);
});

test("goal production render materializer passes first-frame repair intent to renderer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-first-frame-"));
  const artifactDir = await makePackage(root, "first-frame-rerender");
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("first-frame-rerender", artifactDir, {
          repair_lane: "visual_first_frame_rerender",
          blocker_types: ["weak_first_frame_visual_taste:white_text_on_dark_card"],
        }),
      ],
    },
    generatedAt: "2026-06-22T17:25:00.000Z",
    force: true,
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 22));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls[0].render_safe_text_margins, false);
  assert.equal(calls[0].suppress_opening_story_cards, true);
  assert.equal(calls[0].visual_repair_lane, "visual_first_frame_rerender");
  assert.deepEqual(calls[0].visual_repair_blocker_types, [
    "weak_first_frame_visual_taste:white_text_on_dark_card",
  ]);
});

test("goal production render materializer rotates risky opener only for visual safe-margin repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-opener-rotation-"));
  const normalArtifactDir = await makePackage(root, "normal-opener-order");
  const repairArtifactDir = await makePackage(root, "safe-margin-opener-rotation");
  const clipNames = ["clip-1.mp4", "clip-2.mp4", "clip-3.mp4", "clip-4.mp4"];

  async function writeOfficialMotionPack(artifactDir) {
    for (const clipName of clipNames) {
      await fs.outputFile(path.join(artifactDir, clipName), Buffer.alloc(2048, clipName.charCodeAt(5)));
    }
    await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
      status: "ready",
      clips: clipNames.map((clipName, index) => ({
        id: `direct-motion-${index + 1}`,
        path: path.join(artifactDir, clipName),
        source_type: "official_trailer",
        source_url: `https://publisher.example/beastro/trailer-${index + 1}.mp4`,
        media_kind: "direct_video",
        source_family: `beastro_direct_motion_${index + 1}`,
      })),
    });
  }

  await writeOfficialMotionPack(normalArtifactDir);
  await writeOfficialMotionPack(repairArtifactDir);

  const normalCalls = [];
  const normalReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("normal-opener-order", normalArtifactDir)] },
    generatedAt: "2026-06-16T09:20:00.000Z",
    force: true,
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      normalCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 19));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  const repairCalls = [];
  const repairReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("safe-margin-opener-rotation", repairArtifactDir, {
          repair_lane: "visual_safe_text_margin_rerender",
          blocker_types: ["possible_edge_text_cutoff"],
        }),
      ],
    },
    generatedAt: "2026-06-16T09:21:00.000Z",
    force: true,
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      repairCalls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 20));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 24,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(normalReport.summary.rendered_count, 1);
  assert.equal(repairReport.summary.rendered_count, 1);
  assert.equal(normalCalls[0].video_clips[0], path.join(normalArtifactDir, "clip-1.mp4"));
  assert.equal(repairCalls[0].video_clips[0], path.join(repairArtifactDir, "clip-2.mp4"));
  assert.equal(repairCalls[0].video_clips.at(-1), path.join(repairArtifactDir, "clip-1.mp4"));
});

test("goal production render materializer replaces generic proof cards with story-specific source proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-proof-copy-"));
  const artifactDir = await makePackage(root, "hades-proof-card");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "hades-proof-card",
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    thumbnail_headline: "HADES II CONSOLE DATE",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
    ],
    narration_script:
      "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
    first_spoken_line: "Hades II just put PlayStation and Xbox players on the same April countdown.",
    description: "Xbox lists Hades II for Xbox and PlayStation with an April 14 date. Source: Xbox.",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_plan: [{ kind: "proof_card", label: "SOURCE LOCKED", detail: "One claim, one source" }],
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("hades-proof-card", artifactDir)] },
    generatedAt: "2026-05-25T18:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 14));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 42.5,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(calls[0].proof_card_primary, "APRIL 14 CONSOLE DATE");
  assert.equal(calls[0].proof_card_secondary, "XBOX + PLAYSTATION LISTED");
});

test("goal production render materializer prefers real motion clips carried only in rights ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-rights-motion-"));
  const artifactDir = await makePackage(root, "rights-only-real-motion");
  const generatedClipPaths = [
    path.join(artifactDir, "owned-card-1.mp4"),
    path.join(artifactDir, "owned-card-2.mp4"),
  ];
  for (const clipPath of generatedClipPaths) await fs.outputFile(clipPath, Buffer.alloc(2048, 7));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: generatedClipPaths.map((clipPath, index) => ({
      id: `owned-card-${index + 1}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/rights-only-real-motion/${index + 1}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      source_family: `owned_card_${index + 1}`,
    })),
  });

  const realClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, `rights-real-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 30));
    realClips.push({
      asset_id: `rights-real-${index}`,
      asset_type: "motion_clip",
      path: clipPath,
      source_url: `https://cdn.example.test/official-gameplay-${index}.mp4`,
      source_type: "licensed_direct_media_url",
      media_kind: "direct_video",
      source_family: `rights_real_family_${index}`,
      licence_basis: "official_source_transformative_editorial_use",
      approval_status: "approved_for_transformative_editorial_use",
      commercial_use_allowed: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: realClips,
  });

  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("rights-only-real-motion", artifactDir, {
          evidence: {
            ...readyJob("rights-only-real-motion", artifactDir).evidence,
            materialised_motion_clip_paths: generatedClipPaths,
          },
        }),
      ],
    },
    generatedAt: "2026-05-27T17:18:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 42, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips.slice(0, 5), realClips.map((clip) => clip.path));
  assert.equal(calls[0].visual_v4_bridge_video_clips[0].source_type, "licensed_direct_media_url");
});

test("goal production render materializer refreshes benchmark from actual materialised motion clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-benchmark-"));
  const artifactDir = await makePackage(root, "expanse-final");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "expanse-final",
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    thumbnail_headline: "EXPANSE GAMEPLAY",
    canonical_angle: "Official gameplay reveal",
    primary_source: "Xbox",
    confirmed_claims: ["The Expanse: Osiris Reborn showed official gameplay"],
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the first real look at the game in motion, which matters because licensed sci-fi games often hide the playable bit for too long.",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    description: "The Expanse: Osiris Reborn showed official gameplay during Xbox Partner Preview. Source: Xbox.",
  });
  const clips = [];
  for (let index = 0; index < 8; index += 1) {
    const clip = path.join(artifactDir, `steam-shot-${index + 1}.mp4`);
    await fs.outputFile(clip, Buffer.alloc(2048, index + 10));
    clips.push({
      id: `steam-shot-${index + 1}`,
      path: clip,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/app/shot-${index + 1}.jpg`,
      source_type: "screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      media_kind: "visual_still",
      durationS: 3,
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      trusted_local_source_families: clips.map((clip) => clip.source_family),
    },
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      asset_id: clip.id,
      asset_type: "screenshot_derived_motion_clip",
      kind: "video",
      path: clip.path,
      source_url: clip.source_url,
      source_type: "screenshot",
      licence_basis: "source_documented_transformative_editorial_use",
      allowed_use: "screenshot_derived_editorial_motion",
      commercial_use_allowed: true,
      risk_score: 0.32,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "warn",
    scores: { motion_density_score: 0, rights_risk_score: 0 },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "warn",
    scores: { motion_density_score: 0, rights_risk_score: 0 },
  });

  const job = readyJob("expanse-final", artifactDir, {
    evidence: {
      ...readyJob("expanse-final", artifactDir).evidence,
      materialised_motion_clip_count: clips.length,
      distinct_motion_family_count: clips.length,
      materialised_motion_clip_paths: clips.map((clip) => clip.path),
    },
  });
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T10:00:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 7));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 42,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  const refreshedDirector = await fs.readJson(path.join(artifactDir, "director_beat_map.json"));
  assert.equal(refreshedBenchmark.result, "pass");
  assert.ok(refreshedBenchmark.scores.motion_density_score >= 75);
  assert.ok(refreshedBenchmark.scores.rights_risk_score >= 90);
  assert.ok(refreshedDirector.shot_plan.some((shot) => shot.kind === "motion_clip"));
  assert.ok(refreshedDirector.transition_plan.planned.length >= 5);
});

test("goal production render quality refresh builds director motion shots from selected real clips when footage plan is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-derived-footage-plan-"));
  const artifactDir = await makePackage(root, "derived-footage-plan");
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 16));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "derived-footage-plan",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 38,
    clips: 8,
  });
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "derived-footage-plan",
    canonical_subject: "Grand Theft Auto VI",
    selected_title: "Grand Theft Auto VI Cover Art Just Made It Real",
    thumbnail_headline: "GTA 6 COVER",
    primary_source: "Rockstar Games",
    source_card_label: "Rockstar Games",
    confirmed_claims: ["Rockstar Games revealed the official Grand Theft Auto VI cover art."],
    narration_script:
      "Grand Theft Auto VI just got its official cover art, and that matters more than a normal box image. Rockstar Games revealed the artwork today, and pre orders open on June 25.",
    first_spoken_line:
      "Grand Theft Auto VI just got its official cover art, and that matters more than a normal box image.",
    description: "Rockstar Games revealed the official Grand Theft Auto VI cover art. Source: Rockstar Games.",
  });

  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `rockstar-motion-${index + 1}`,
    asset_id: `rockstar-motion-${index + 1}`,
    path: path.join(artifactDir, `rockstar-motion-${index + 1}.mp4`),
    local_materialized_path: path.join(artifactDir, `rockstar-motion-${index + 1}.mp4`),
    source_url: `https://media.rockstargames.com/VI/source-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `rockstar_cover_art_segment_${index + 1}`,
    base_source_family: `rockstar_official_motion_asset_${index + 1}`,
    media_kind: "official_video",
    licence_basis: "official_publisher_reference_editorial_commentary",
    rights_basis: "official_publisher_reference_editorial_commentary",
    allowed_use: "short_form_editorial_news_coverage",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    counts_towards_motion_readiness: true,
    risk_score: 0.12,
    durationS: 4,
  }));
  for (const clip of clips) await fs.outputFile(clip.path, Buffer.alloc(2048, 21));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips,
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: licensedSfxAssets(),
    },
  });

  const refresh = await refreshFinalRenderQualityOnly({
    storyId: "derived-footage-plan",
    artifactDir,
    generatedAt: "2026-06-18T15:20:00.000Z",
  });

  assert.equal(refresh.status, "quality_refreshed");
  assert.equal(refresh.director_motion_shot_count >= 5, true);
  const refreshedDirector = await fs.readJson(path.join(artifactDir, "director_beat_map.json"));
  assert.equal(refreshedDirector.shot_budget.available_motion_clips >= 5, true);
  assert.equal(
    refreshedDirector.shot_plan.filter((shot) => shot.kind === "motion_clip").length >= 5,
    true,
  );
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  assert.equal(refreshedBenchmark.visual_evidence_profile.direct_video_motion_asset_count >= 5, true);
});

test("goal production render quality refresh scores the final rendered scene plan instead of stale inventory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-quality-scene-plan-"));
  const artifactDir = await makePackage(root, "scene-plan-scored");
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 31));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "scene-plan-scored",
    canonical_subject: "Granblue Fantasy: Relink",
    selected_title: "Granblue Fantasy Relink Has A Free Demo Test",
    thumbnail_headline: "DEMO TEST",
    primary_source: "PlayStation Blog",
    source_card_label: "PlayStation Blog",
    confirmed_claims: ["PlayStation Blog highlighted a new Granblue Fantasy: Relink demo."],
    narration_script:
      "Granblue Fantasy Relink has a free demo test, and the useful part is what players can judge before buying. PlayStation Blog points to a hands-on slice that shows combat flow, party roles and boss pacing.",
    first_spoken_line:
      "Granblue Fantasy Relink has a free demo test, and the useful part is what players can judge before buying.",
    description: "PlayStation Blog highlighted a Granblue Fantasy: Relink demo. Source: PlayStation Blog.",
  });

  const directClips = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(artifactDir, `granblue-direct-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, 40 + index));
    directClips.push({
      id: `granblue-direct-${index + 1}`,
      asset_id: `granblue-direct-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.steamstatic.com/store_trailers/granblue/${index + 1}/hls_master.m3u8`,
      source_type: "official_trailer_segment",
      source_family: `granblue_direct_family_${index + 1}`,
      base_source_family: `granblue_direct_base_${index + 1}`,
      media_kind: "official_video",
      rights_basis: "official_publisher_reference_editorial_commentary",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      counts_towards_motion_readiness: true,
      durationS: 5,
    });
  }
  const hyperframesCardPath = path.join(artifactDir, "granblue-source-card.mp4");
  await fs.outputFile(hyperframesCardPath, Buffer.alloc(2048, 71));
  const clipScenePlan = {
    repeat_free: true,
    covered_duration_s: 36,
    repeated_base_sources: [],
    scenes: [
      ...directClips.slice(0, 4).map((clip, index) => ({
        index,
        path: clip.path,
        durationS: 4.8,
        sourceDurationS: 5,
        baseSourceKey: clip.base_source_family,
      })),
      {
        index: 4,
        path: hyperframesCardPath,
        durationS: 12,
        sourceDurationS: 12,
        minimumReadableDurationS: 12,
        baseSourceKey: "hyperframes_source_card",
        readableCardKind: "source",
        readableText: "PLAYSTATION BLOG SOURCE",
      },
      {
        index: 5,
        path: directClips[4].path,
        durationS: 4.8,
        sourceDurationS: 5,
        baseSourceKey: directClips[4].base_source_family,
      },
    ],
    card_visible_windows: [
      {
        id: "scene_4_source",
        kind: "source",
        start_s: 19.2,
        end_s: 31.2,
        duration_s: 12,
        source: "clip_scene_plan",
      },
    ],
  };
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: directClips,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: directClips,
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: licensedSfxAssets(),
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "scene-plan-scored",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 36,
    clips: 6,
    clip_scene_plan: clipScenePlan,
    card_visible_windows: clipScenePlan.card_visible_windows,
  });

  const refresh = await refreshFinalRenderQualityOnly({
    storyId: "scene-plan-scored",
    artifactDir,
    generatedAt: "2026-06-25T20:40:00.000Z",
  });

  assert.equal(refresh.status, "quality_refreshed");
  assert.equal(refresh.clip_count, 6);
  assert.equal(refresh.director_motion_shot_count >= 6, true);
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  assert.ok(refreshedBenchmark.scores.motion_density_score >= 75);
  assert.equal(refreshedBenchmark.visual_evidence_profile.motion_asset_count >= 6, true);
  const refreshedManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.deepEqual(refreshedManifest.clip_scene_plan.scenes.map((scene) => scene.path), clipScenePlan.scenes.map((scene) => scene.path));
});

test("goal production render materializer cannot mint final GREEN from legacy bare QA sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-quality-refresh-"));
  const artifactDir = await makePackage(root, "xbox-quality-refresh");
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 9));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "xbox-quality-refresh",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 41.6,
    clips: 8,
  });
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "xbox-quality-refresh",
    canonical_subject: "Xbox Controller",
    selected_title: "Xbox Controller Deal Has One Catch",
    thumbnail_headline: "XBOX DEAL CATCH",
    canonical_angle: "racing game accessory deal",
    primary_source: "Xbox",
    confirmed_claims: ["Xbox lists a limited-edition controller and headset"],
    narration_script:
      "Xbox Controller buyers just got one useful catch before they buy. Xbox lists a limited-edition controller and headset for Forza Horizon 6, and the source keeps the claim simple.",
    first_spoken_line: "Xbox Controller buyers just got one useful catch before they buy.",
    description: "Xbox lists a limited-edition controller and headset. Source: Xbox.",
  });

  const clips = Array.from({ length: 8 }, (_, index) => ({
    id: `steam-motion-${index + 1}`,
    asset_id: `steam-motion-${index + 1}`,
    path: path.join(artifactDir, `steam-motion-${index + 1}.mp4`),
    local_materialized_path: path.join(artifactDir, `steam-motion-${index + 1}.mp4`),
    source_url: `https://video.akamai.steamstatic.com/store_trailers/xbox-quality-refresh/${index + 1}/hls_264_master.m3u8`,
    source_type: "steam_movie",
    source_family: `steam_movie_xbox_quality_refresh_${index + 1}`,
    motion_family: `steam_movie_xbox_quality_refresh_${index + 1}`,
    media_kind: "direct_video",
    licence_basis: "official_storefront_reference_editorial_use",
    rights_basis: "official_storefront_reference_editorial_use",
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  for (const clip of clips) await fs.outputFile(clip.path, Buffer.alloc(1024, 4));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      allow_owned_explainer_motion_only: true,
    },
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      asset_id: clip.asset_id,
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      media_kind: clip.media_kind,
      source_family: clip.source_family,
      licence_basis: clip.licence_basis,
      allowed_use: "official_storefront_editorial_reference",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
      risk_score: 0.01,
    })),
    assets: clips.map((clip, index) => ({
      asset_id: `production_motion_${index + 1}`,
      path: clip.path,
      source_type: "video",
      rights_risk_class: "",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: licensedSfxAssets(),
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_segment_loudness_report.json"), {
    verdict: "pass",
    blockers: [],
    warnings: [],
  });
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "pass",
    blockers: [],
    warnings: [],
  });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    verdict: "pass",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "fail",
    scores: { rights_risk_score: 0 },
    failures: ["gold_standard:rights_risk_above_reference"],
  });
  await fs.outputJson(path.join(artifactDir, "forensic_qa_report.json"), {
    schema_version: 1,
    story_id: "xbox-quality-refresh",
    verdict: "blocked_or_rewrite_required",
    checks: {
      rights: "fail",
      footage: "v4_motion_blocked",
      benchmark: "fail",
    },
    blockers: [
      "rights:no_rights_record",
      "actual_motion_clip_minimum_not_met",
      "gold_standard:rights_risk_above_reference",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    schema_version: 1,
    result: "fail",
    verdict: "fail",
    failures: ["public_output:description_missing_canonical_subject"],
    manifest: {
      canonical_subject: "Xbox Controller",
      description: "Xbox lists a limited-edition controller and headset. Source: Xbox.",
    },
  });

  const refresh = await refreshFinalRenderQualityOnly({
    storyId: "xbox-quality-refresh",
    artifactDir,
    generatedAt: "2026-05-26T08:00:00.000Z",
  });

  assert.equal(refresh.status, "quality_refreshed");
  assert.equal(refresh.safety.renderer_invoked, false);
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  assert.ok(refreshedBenchmark.scores.rights_risk_score >= 90);
  assert.ok(!refreshedBenchmark.failures.includes("gold_standard:rights_risk_above_reference"));
  const refreshedForensics = await fs.readJson(path.join(artifactDir, "forensic_qa_report.json"));
  assert.equal(refreshedForensics.verdict, "blocked_or_rewrite_required");
  assert.equal(refreshedForensics.result, "fail");
  assert.ok(refreshedForensics.blockers.includes("voice_quality_not_authoritative"));
  assert.ok(refreshedForensics.blockers.includes("caption_manifest_not_authoritative"));
  assert.equal(refreshedForensics.checks.benchmark, "pass");
  assert.equal(refreshedForensics.checks.final_render_mp4, "pass");
  assert.equal(refreshedForensics.evidence.motion_clip_count >= 5, true);
  assert.equal(refreshedForensics.repair_source, "post_render_quality_refresh");
  const refreshedCoherence = await fs.readJson(path.join(artifactDir, "coherence_report.json"));
  assert.equal(refreshedCoherence.result, "pass");
  assert.deepEqual(refreshedCoherence.failures, []);
  assert.equal(refreshedCoherence.repair_source, "post_render_quality_refresh");
  const refreshedRenderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(refreshedRenderManifest.quality_gate_status, "post_render_forensics_failed");
  assert.equal(refreshedRenderManifest.post_render_quality_refreshed_at, "2026-05-26T08:00:00.000Z");
});

test("goal production render quality refresh repairs stale duration lineage without rerendering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-refresh-duration-stamp-"));
  const artifactDir = await makePackage(root, "refresh-duration-stamp");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "refresh-duration-stamp",
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    thumbnail_headline: "HADES II CONSOLE DATE",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
    ],
    narration_script: "Hades II finally has a console date players can plan around.",
    first_spoken_line: "Hades II finally has a console date players can plan around.",
    description: "Hades II finally has a console date. Source: Xbox.",
    duration_variant_status: "invalidated_requires_repair",
    duration_variant_invalidated_at: "2026-05-22T09:59:00.000Z",
    duration_variant_repaired_at: "2026-05-22T10:00:00.000Z",
  });
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "refresh-duration-stamp",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    generated_at: "2026-05-22T10:05:00.000Z",
    rendered_duration_s: 42,
    clips: 2,
  });
  const clips = Array.from({ length: 3 }, (_, index) => ({
    id: `duration-stamp-motion-${index + 1}`,
    asset_id: `duration-stamp-motion-${index + 1}`,
    path: path.join(artifactDir, `duration-stamp-motion-${index + 1}.mp4`),
    source_url: `local://pulse-generated-motion/duration-stamp/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    source_family: `duration_stamp_motion_${index + 1}`,
    motion_family: `duration_stamp_motion_${index + 1}`,
    media_kind: "owned_explainer_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    rights_basis: "owned_generated_editorial_motion_graphic",
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  for (const clip of clips) await fs.outputFile(clip.path, Buffer.alloc(1024, 6));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      allow_owned_explainer_motion_only: true,
    },
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      asset_id: clip.asset_id,
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      licence_basis: clip.licence_basis,
      allowed_use: "owned_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
      risk_score: 0.01,
    })),
  });

  const report = await refreshFinalRenderQualityOnly({
    artifactDir,
    storyId: "refresh-duration-stamp",
    generatedAt: "2026-05-22T10:06:00.000Z",
  });

  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(report.status, "quality_refreshed");
  assert.equal(report.safety.renderer_invoked, false);
  assert.equal(canonical.duration_variant_status, "repaired_rendered");
  assert.equal(canonical.duration_variant_final_render_regenerated_at, "2026-05-22T10:05:00.000Z");
  assert.equal(canonical.duration_variant_regeneration_status, "quality_refreshed");
});

test("goal production render materializer prefers real materialised clips over stale generated-card evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-real-clips-"));
  const artifactDir = await makePackage(root, "deathmaster-real-clips");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "deathmaster-real-clips",
    canonical_subject: "Warhammer Age of Sigmar: Deathmaster",
    selected_title: "Deathmaster Brings Stealth To Consoles",
    thumbnail_headline: "DEATHMASTER STEALTH",
    canonical_angle: "Official storefront media",
    primary_source: "GameSpot",
    confirmed_claims: ["Warhammer Age of Sigmar: Deathmaster is coming to PC and consoles"],
    narration_script:
      "Warhammer Age of Sigmar: Deathmaster brings stealth to consoles next year. GameSpot reports the official reveal, which matters because this is a new playable angle for Warhammer fans.",
    first_spoken_line: "Warhammer Age of Sigmar: Deathmaster brings stealth to consoles next year.",
    description: "Warhammer Age of Sigmar: Deathmaster is coming to PC and consoles. Source: GameSpot.",
  });

  const generatedClipPaths = ["hook_slam", "source_proof", "subject_motion"].map((name) =>
    path.join(root, "output", "generated-motion", "deathmaster-real-clips", `${name}.mp4`),
  );
  for (const clipPath of generatedClipPaths) await fs.outputFile(clipPath, Buffer.alloc(1024, 6));

  const realClips = [];
  for (let index = 0; index < 8; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `deathmaster-steam-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 20));
    realClips.push({
      id: `deathmaster-steam-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/deathmaster/shot-${index + 1}.jpg`,
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_deathmaster_${index + 1}`,
      motion_family: `steam_screenshot_deathmaster_${index + 1}`,
      media_kind: "visual_still",
      rights_basis: "steam_storefront_promotional_editorial_use",
      counts_towards_motion_readiness: true,
      materialized: true,
    });
  }

  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: realClips,
    materialised_clips: realClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: realClips,
      distinct_source_families: realClips.map((clip) => clip.source_family),
      trusted_local_source_families: realClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: realClips.map((clip) => ({
      asset_id: clip.id,
      asset_type: "screenshot_derived_motion_clip",
      kind: "video",
      source_family: clip.source_family,
      path: clip.path,
      source_url: clip.source_url,
      source_type: "steam_screenshot",
      licence_basis: "steam_storefront_promotional_editorial_use",
      allowed_use: "screenshot_derived_editorial_motion",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x"],
      commercial_use_allowed: true,
      risk_score: 0.28,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const staleJob = readyJob("deathmaster-real-clips", artifactDir, {
    evidence: {
      ...readyJob("deathmaster-real-clips", artifactDir).evidence,
      materialised_motion_clip_paths: generatedClipPaths,
      materialised_motion_clip_count: generatedClipPaths.length,
      distinct_motion_family_count: generatedClipPaths.length,
    },
  });
  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [staleJob] },
    generatedAt: "2026-05-22T10:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 40,
        size_bytes: 4096,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].video_clips, realClips.map((clip) => clip.path));
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  assert.ok(refreshedBenchmark.scores.rights_risk_score >= 90);
  assert.ok(!refreshedBenchmark.failures.includes("gold_standard:rights_risk_above_reference"));
  assert.equal(refreshedBenchmark.visual_evidence_profile.generated_only_motion_deck, false);
});

test("goal production render materializer normalises Steam storefront rights basis during refresh", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-steam-rights-"));
  const artifactDir = await makePackage(root, "steam-rights-normalise", {
    canonical_subject: "Game Pass",
    selected_title: "Game Pass July Wave Turns Into An Install Fight",
    narration_script:
      "Xbox Game Pass just made July feel like a download queue problem. Xbox Wire lists the first wave, and players now have to pick what earns the install.",
    first_spoken_line: "Xbox Game Pass just made July feel like a download queue problem.",
    description: "Xbox Wire lists the first July Game Pass wave. Source: Xbox Wire.",
  });
  const clips = Array.from({ length: 4 }, (_, index) => ({
    id: `steam-storefront-${index + 1}`,
    asset_id: `steam-storefront-${index + 1}`,
    path: path.join(artifactDir, `steam-storefront-${index + 1}.mp4`),
    local_materialized_path: path.join(artifactDir, `steam-storefront-${index + 1}.mp4`),
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1623730/shot-${index + 1}.jpg`,
    source_type: "steam_screenshot",
    source_family: `steam_screenshot_game_pass_${index + 1}`,
    media_kind: "visual_still",
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  for (const clip of clips) await fs.outputFile(clip.path, Buffer.alloc(2048, 4));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
    materialised_clips: clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      trusted_local_source_families: clips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:licence_basis_missing"],
    assets: clips.map((clip) => ({
      asset_id: clip.asset_id,
      kind: "visual",
      source_url: clip.source_url,
      source_type: clip.source_type,
      source_family: clip.source_family,
    })),
  });

  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("steam-rights-normalise", artifactDir)] },
    generatedAt: "2026-07-07T14:30:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return {
        story_id: story.id,
        output,
        clips: story.video_clips.length,
        rendered_duration_s: 40,
        size_bytes: 4096,
      };
    },
  });

  const repairedRights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(repairedRights.verdict, "pass");
  assert.equal(repairedRights.failures.includes("rights:licence_basis_missing"), false);
  assert.equal(
    repairedRights.assets.every((asset) => asset.licence_basis === "steam_storefront_promotional_editorial_use"),
    true,
  );
});

test("goal production render materializer puts direct video before still-derived motion for first-frame repairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-direct-first-"));
  const artifactDir = await makePackage(root, "direct-video-first-frame");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "direct-video-first-frame",
    canonical_subject: "Pragmata",
    selected_title: "Pragmata Stage Was Handmade",
    thumbnail_headline: "PRAGMATA STAGE HANDMADE",
    primary_source: "Automaton Media",
    confirmed_claims: ["Pragmata's stage was handmade by developers."],
    narration_script:
      "Pragmata's AI-looking stage was handmade by developers. That matters because players were already arguing about whether Capcom had used generative shortcuts.",
    first_spoken_line: "Pragmata's AI-looking stage was handmade by developers.",
    description:
      "Pragmata's stage was handmade by developers, according to Automaton Media. This short focuses on the player-facing art pipeline debate and source-safe context.",
  });

  const stillClips = [];
  for (let index = 0; index < 4; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `pragmata-still-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 10));
    stillClips.push({
      id: `pragmata-still-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/pragmata/shot-${index + 1}.jpg`,
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_pragmata_${index + 1}`,
      motion_family: `steam_screenshot_pragmata_${index + 1}`,
      media_kind: "visual_still",
      rights_basis: "steam_storefront_promotional_editorial_use",
      counts_towards_motion_readiness: true,
    });
  }

  const directClips = [];
  for (let index = 0; index < 4; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `pragmata-direct-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 30));
    directClips.push({
      id: `pragmata-direct-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/pragmata/movie-${index + 1}.mp4`,
      source_type: "steam_movie",
      source_family: `steam_movie_pragmata_${index + 1}`,
      motion_family: `steam_movie_pragmata_${index + 1}`,
      media_kind: "direct_video",
      rights_basis: "steam_storefront_promotional_editorial_use",
      counts_towards_motion_readiness: true,
    });
  }

  const allClips = [...stillClips, ...directClips];
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: allClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: allClips,
      distinct_source_families: allClips.map((clip) => clip.source_family),
      trusted_local_source_families: allClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: allClips.map((clip) => ({
      asset_id: clip.id,
      asset_type: clip.media_kind === "direct_video" ? "motion_clip" : "screenshot_derived_motion_clip",
      kind: "video",
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      source_family: clip.source_family,
      licence_basis: "steam_storefront_promotional_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("direct-video-first-frame", artifactDir, {
          evidence: {
            ...readyJob("direct-video-first-frame", artifactDir).evidence,
            materialised_motion_clip_paths: allClips.map((clip) => clip.path),
            materialised_motion_clip_count: allClips.length,
            distinct_motion_family_count: allClips.length,
          },
        }),
      ],
    },
    generatedAt: "2026-05-31T22:55:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 40, size_bytes: 4096 };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs));
  assert.deepEqual(calls[0].video_clips.slice(0, 4), directClips.map((clip) => clip.path));
  assert.deepEqual(calls[0].video_clips.slice(4, 8), stillClips.map((clip) => clip.path));
});

test("goal production render materializer filters tiny official YouTube slate clips when enough motion remains", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-filter-slates-"));
  const artifactDir = await makePackage(root, "filter-official-slates");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "filter-official-slates",
    canonical_subject: "Grand Theft Auto VI",
    selected_title: "Grand Theft Auto VI Cover Art Is The Biggest Clue Yet",
    thumbnail_headline: "GRAND THEFT AUTO VI",
    primary_source: "Rockstar Games",
    confirmed_claims: ["Rockstar Games revealed the official cover art."],
    narration_script:
      "Rockstar just made Grand Theft Auto VI feel real in one image. The official cover art is out, and pre orders open on June 25.",
    first_spoken_line: "Rockstar just made Grand Theft Auto VI feel real in one image.",
    description: "Rockstar Games revealed the official cover art. Source: Rockstar Games.",
  });

  const clips = [];
  for (let index = 0; index < 8; index += 1) {
    const isSlate = index === 0 || index === 1 || index >= 6;
    const clipPath = path.join(root, "output", "video_cache", `gta-official-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(isSlate ? 96_000 : 210_000, index + 1));
    clips.push({
      id: `gta-official-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: "https://www.youtube.com/watch?v=EiQEBYDox_k",
      source_type: "official_youtube_channel_url",
      source_family: `rockstar_official_cover_art_reveal_segment_${index + 1}`,
      media_kind: "official_trailer_motion_clip",
      rights_basis: "official_publisher_youtube_reference_for_editorial_news_coverage",
      counts_towards_motion_readiness: true,
    });
  }

  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
      trusted_local_source_families: clips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      asset_id: clip.id,
      asset_type: "motion_clip",
      kind: "video",
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      source_family: clip.source_family,
      licence_basis: "official_publisher_reference_editorial_commentary",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const calls = [];
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("filter-official-slates", artifactDir, {
          evidence: {
            ...readyJob("filter-official-slates", artifactDir).evidence,
            materialised_motion_clip_paths: clips.map((clip) => clip.path),
            materialised_motion_clip_count: clips.length,
            distinct_motion_family_count: clips.length,
          },
        }),
      ],
    },
    generatedAt: "2026-06-18T16:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 40, size_bytes: 4096 };
    },
  });

  assert.equal(report.summary.rendered_count, 1, JSON.stringify(report.jobs));
  assert.deepEqual(calls[0].video_clips, clips.slice(2, 6).map((clip) => clip.path));
});

test("goal production render materializer tops up limited real clips with owned kinetic motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-mixed-clips-"));
  const artifactDir = await makePackage(root, "mixed-real-owned-clips");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "mixed-real-owned-clips",
    canonical_subject: "Warhammer Age of Sigmar: Deathmaster",
    selected_title: "Deathmaster Brings Stealth To Consoles",
    thumbnail_headline: "DEATHMASTER STEALTH",
    canonical_angle: "Official storefront media",
    primary_source: "GameSpot",
    confirmed_claims: ["Warhammer Age of Sigmar: Deathmaster is coming to PC and consoles"],
    narration_script:
      "Warhammer Age of Sigmar: Deathmaster brings stealth to consoles next year. GameSpot reports the official reveal, which matters because this is a new playable angle for Warhammer fans.",
    first_spoken_line: "Warhammer Age of Sigmar: Deathmaster brings stealth to consoles next year.",
    description: "Warhammer Age of Sigmar: Deathmaster is coming to PC and consoles. Source: GameSpot.",
  });

  const generatedClipPaths = ["hook_slam", "source_proof", "subject_motion"].map((name) =>
    path.join(root, "output", "generated-motion", "mixed-real-owned-clips", `${name}.mp4`),
  );
  for (const clipPath of generatedClipPaths) await fs.outputFile(clipPath, Buffer.alloc(1024, 6));

  const realClips = [];
  for (let index = 0; index < 5; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `mixed-steam-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 30));
    realClips.push({
      id: `mixed-steam-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/mixed/shot-${index + 1}.jpg`,
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_mixed_${index + 1}`,
      motion_family: `steam_screenshot_mixed_${index + 1}`,
      media_kind: "visual_still",
      rights_basis: "steam_storefront_promotional_editorial_use",
      counts_towards_motion_readiness: true,
      materialized: true,
    });
  }

  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: realClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: realClips,
      distinct_source_families: realClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      ...realClips.map((clip) => ({
        asset_id: clip.id,
        asset_type: "screenshot_derived_motion_clip",
        kind: "video",
        source_family: clip.source_family,
        path: clip.path,
        source_url: clip.source_url,
        source_type: "steam_screenshot",
        licence_basis: "steam_storefront_promotional_editorial_use",
        allowed_use: "screenshot_derived_editorial_motion",
        commercial_use_allowed: true,
        risk_score: 0.28,
        approval_status: "approved_for_transformative_editorial_use",
      })),
      ...generatedClipPaths.map((clipPath, index) => ({
        asset_id: `owned-generated-${index + 1}`,
        asset_type: "motion_clip",
        kind: "video",
        path: clipPath,
        source_url: `local://pulse-generated-motion/mixed-real-owned-clips/${index + 1}`,
        source_type: "internally_generated_motion_graphic",
        rights_risk_class: "owned_generated_motion",
        licence_basis: "owned_generated_editorial_graphic",
        commercial_use_allowed: true,
        risk_score: 0.08,
        approval_status: "approved",
      })),
    ],
  });

  const mixedJob = readyJob("mixed-real-owned-clips", artifactDir, {
    evidence: {
      ...readyJob("mixed-real-owned-clips", artifactDir).evidence,
      materialised_motion_clip_paths: generatedClipPaths,
      materialised_motion_clip_count: generatedClipPaths.length,
      distinct_motion_family_count: generatedClipPaths.length,
    },
  });
  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [mixedJob] },
    generatedAt: "2026-05-22T10:45:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 8));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 40, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips.slice(0, 5), realClips.map((clip) => clip.path));
  assert.deepEqual(calls[0].video_clips.slice(5), generatedClipPaths);
  const refreshedBenchmark = await fs.readJson(path.join(artifactDir, "benchmark_report.json"));
  assert.ok(refreshedBenchmark.scores.motion_density_score >= 75);
  assert.equal(refreshedBenchmark.visual_evidence_profile.generated_only_motion_deck, false);
});

test("goal production render materializer rejects legacy readable cards that exceed the 25 percent motion budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-direct-owned-interleave-"));
  const artifactDir = await makePackage(root, "direct-owned-interleave");
  const directClips = [];
  for (let index = 0; index < 6; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `elliot-direct-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 40));
    directClips.push({
      id: `elliot-direct-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.fastly.steamstatic.com/store_trailers/elliot/${index + 1}/hls_264_master.m3u8`,
      source_type: "official_platform_product_page",
      source_family: `elliot_direct_family_${index + 1}`,
      motion_family: `elliot_direct_family_${index + 1}`,
      media_kind: "direct_video",
      rights_basis: "official_direct_media",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 5,
    });
  }
  const ownedClips = [12, 12, 12].map((durationS, index) => {
    const clipPath = path.join(root, "output", "generated-motion", `elliot-owned-${index + 1}.mp4`);
    return {
      id: `elliot-owned-${index + 1}`,
      asset_id: `elliot-owned-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-generated-motion/direct-owned-interleave/${index + 1}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_source_card_explainer_motion",
      asset_class: index === 0 ? "animated_quote_card" : "proof_card",
      source_family: `elliot_owned_family_${index + 1}`,
      motion_family: `elliot_owned_family_${index + 1}`,
      media_kind: "owned_explainer_motion",
      rights_basis: "owned_generated_editorial_motion_graphic",
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      materialized: true,
      durationS,
      minimum_readable_duration_s: durationS,
    };
  });
  for (const clip of ownedClips) await fs.outputFile(clip.path, Buffer.alloc(2048, 70));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: [...directClips, ...ownedClips],
    materialised_clips: [...directClips, ...ownedClips],
  });

  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("direct-owned-interleave", artifactDir)] },
    generatedAt: "2026-06-25T02:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 38, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips, directClips.map((clip) => clip.path));
  assert.equal(calls[0].video_clips.includes(ownedClips[1].path), false);
  assert.equal(calls[0].video_clips.includes(ownedClips[2].path), false);
  assert.equal(calls[0].video_clips.includes(ownedClips[0].path), false);
});

test("goal production render materializer balances scarce direct clips with non-readable owned motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-direct-owned-balance-"));
  const artifactDir = await makePackage(root, "direct-owned-balance");
  const directClips = [];
  for (let index = 0; index < 3; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `gta-direct-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 40));
    directClips.push({
      id: `gta-direct-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_${index + 1}/GTAVI_Trailer_${index + 1}.mp4`,
      source_type: "official_game_website_media_page",
      source_family: `gta_direct_family_${index + 1}`,
      motion_family: `gta_direct_family_${index + 1}`,
      media_kind: "direct_video",
      rights_basis: "official_direct_media",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 5,
    });
  }
  const ownedMotion = ["lower_third", "motion_background", "branded_wipe"].map((kind, index) => {
    const clipPath = path.join(root, "output", "generated-motion", `gta-${kind}.mp4`);
    return {
      id: `gta-${kind}`,
      asset_id: `gta-${kind}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-generated-motion/direct-owned-balance/${kind}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_source_card_explainer_motion",
      asset_class: kind,
      source_family: `gta_${kind}`,
      motion_family: `gta_${kind}`,
      media_kind: "owned_explainer_motion",
      rights_basis: "owned_generated_editorial_motion_graphic",
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      materialized: true,
      durationS: 12,
    };
  });
  const readableCardPath = path.join(root, "output", "generated-motion", "gta-source-card.mp4");
  const readableCard = {
    id: "gta-source-card",
    asset_id: "gta-source-card",
    path: readableCardPath,
    local_materialized_path: readableCardPath,
    source_url: "local://pulse-generated-motion/direct-owned-balance/source-card",
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    asset_class: "animated_source_card",
    source_family: "gta_source_card",
    motion_family: "gta_source_card",
    media_kind: "owned_explainer_motion",
    rights_basis: "owned_generated_editorial_motion_graphic",
    counts_towards_motion_readiness: true,
    owned_explainer_visual_plan: true,
    materialized: true,
    durationS: 12,
    minimum_readable_duration_s: 12,
  };
  for (const clip of [...ownedMotion, readableCard]) await fs.outputFile(clip.path, Buffer.alloc(2048, 70));
  await writePassingHyperframesCard(root, "direct-owned-balance", "source");
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips: [...directClips, ...ownedMotion, readableCard],
    materialised_clips: [...directClips, ...ownedMotion, readableCard],
  });

  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("direct-owned-balance", artifactDir)] },
    generatedAt: "2026-06-27T07:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 38, size_bytes: 4096 };
    },
  });

  const selected = calls[0].visual_v4_bridge_video_clips;
  assert.ok(selected.length >= 6);
  assert.deepEqual(selected.slice(0, 3).map((clip) => clip.path), directClips.map((clip) => clip.path));
  assert.ok(selected.some((clip) => clip.path === ownedMotion[0].path));
  assert.ok(selected.some((clip) => clip.path === ownedMotion[1].path));
  assert.equal(selected.some((clip) => clip.path === readableCard.path), false);
  assert.equal(selected.filter((clip) => clip.path === readableCard.path && clip.minimum_readable_duration_s).length, 0);
});

test("goal production render materializer recovers direct footage when materialised motion drifted to owned-only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-owned-drift-"));
  const artifactDir = await makePackage(root, "owned-drift-direct-recovery");
  const directClips = [];
  for (let index = 0; index < 8; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `black-ops-direct-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(220_000, index + 20));
    directClips.push({
      id: `black-ops-direct-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://www.callofduty.com/content/dam/atvi/callofduty/cod-touchui/blog/body/bo7/bo7-gameplay-${index + 1}.mp4`,
      source_type: "official_game_website_media_page",
      source_family: `callofduty_official_direct_${index + 1}`,
      motion_family: `callofduty_official_direct_${index + 1}`,
      media_kind: "direct_video",
      rights_basis: "official_direct_media_editorial_reference",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 5,
    });
  }
  const ownedClips = ["lower_third", "motion_background", "branded_wipe", "source_card"].map((kind, index) => {
    const clipPath = path.join(root, "output", "generated-motion", "owned-drift-direct-recovery", `${kind}.mp4`);
    return {
      id: `owned-${kind}`,
      asset_id: `owned-${kind}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-generated-motion/owned-drift-direct-recovery/${kind}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_source_card_explainer_motion",
      asset_class: kind === "source_card" ? "animated_source_card" : kind,
      source_family: `owned_${kind}`,
      motion_family: `owned_${kind}`,
      media_kind: "owned_explainer_motion",
      rights_basis: "owned_generated_editorial_motion_graphic",
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      materialized: true,
      durationS: kind === "source_card" ? 1.6 : 12,
      ...(kind === "source_card" ? { minimum_readable_duration_s: 1.2 } : {}),
    };
  });
  await Promise.all(ownedClips.map((clip, index) => fs.outputFile(clip.path, Buffer.alloc(2048, 90 + index))));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips: ownedClips,
    materialised_clips: ownedClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: directClips,
      accepted_local_clips: directClips,
      distinct_source_families: directClips.map((clip) => clip.source_family),
      trusted_local_source_families: directClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: directClips.map((clip) => ({
      asset_id: clip.id,
      asset_type: "motion_clip",
      kind: "video",
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      source_family: clip.source_family,
      media_kind: clip.media_kind,
      licence_basis: "official_direct_media_editorial_reference",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("owned-drift-direct-recovery", artifactDir, {
          evidence: {
            ...readyJob("owned-drift-direct-recovery", artifactDir).evidence,
            materialised_motion_clip_count: directClips.length,
            distinct_motion_family_count: directClips.length,
            materialised_motion_clip_paths: [path.join(artifactDir, "materialised_motion_clips.json")],
          },
        }),
      ],
    },
    generatedAt: "2026-06-27T08:45:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 12));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 47, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips.slice(0, 8), directClips.map((clip) => clip.path));
  assert.equal(
    calls[0].visual_v4_bridge_video_clips.some((clip) => clip.media_kind === "owned_explainer_motion"),
    false,
  );
});

test("goal production render materializer reuses previous direct scene windows when rerendering stale audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-scene-window-reuse-"));
  const artifactDir = await makePackage(root, "scene-window-reuse");
  const directClips = [];
  const sourceUrls = [
    "https://www.callofduty.com/cod/cdn/bo7/BO7_MP_Mastery_Camo.mp4",
    "https://www.callofduty.com/cod/cdn/bo7/BO7_MP_Weapons-weapons.mp4",
    "https://video.akamai.steamstatic.com/store_trailers/3606480/1043203640/920cef5f1e97f01e1fcb7a31bd8552587ddea323/1780522130/hls_264_master.m3u8",
    "https://www.callofduty.com/cod/cdn/bo7/BO7_MP_Mastery_Camo.mp4",
    "https://video.akamai.steamstatic.com/store_trailers/3606480/1043203640/920cef5f1e97f01e1fcb7a31bd8552587ddea323/1780522130/hls_264_master.m3u8",
    "https://www.callofduty.com/cod/cdn/bo7/BO7_MP_Weapons-weapons.mp4",
    "https://video.akamai.steamstatic.com/store_trailers/3606480/1200945818/709290607c4727b595dad45245a359ce0c0ac0d1/1762893198/hls_264_master.m3u8",
    "https://video.akamai.steamstatic.com/store_trailers/3606480/25223131/09df1c2fe13fbbbec035df7261dd522054cc6ed3/1762999072/hls_264_master.m3u8",
  ];
  for (let index = 0; index < sourceUrls.length; index += 1) {
    const clipPath = path.join(root, "output", "video_cache", `scene-window-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(220_000, index + 40));
    await fs.outputJson(`${clipPath}.json`, {
      schema_version: 1,
      source_family: `callofduty_scene_window_${index + 1}`,
      source_url: sourceUrls[index],
      source_type: index < 6 ? "official_game_website_media_page" : "steam_movie",
      duration_s: 5,
    });
    directClips.push({
      id: `scene-window-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrls[index],
      source_type: index < 6 ? "official_game_website_media_page" : "steam_movie",
      source_family: `callofduty_scene_window_${index + 1}`,
      base_source_family: `callofduty_scene_window_${index + 1}`,
      motion_family: `callofduty_scene_window_${index + 1}`,
      media_kind: "direct_video",
      rights_basis: "official_direct_media_editorial_reference",
      counts_towards_motion_readiness: true,
      materialized: true,
    });
  }
  const ownedClipPath = path.join(root, "output", "generated-motion", "scene-window-reuse", "lower_third.mp4");
  await fs.outputFile(ownedClipPath, Buffer.alloc(2048, 90));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips: [{
      id: "owned-lower-third",
      path: ownedClipPath,
      source_url: "local://pulse-generated-motion/scene-window-reuse/lower-third",
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      owned_explainer_visual_plan: true,
      counts_towards_motion_readiness: true,
      durationS: 12,
    }],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: directClips,
      distinct_source_families: directClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: directClips.map((clip) => ({
      asset_id: clip.id,
      asset_type: "motion_clip",
      kind: "video",
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      source_family: clip.source_family,
      base_source_family: clip.base_source_family,
      media_kind: clip.media_kind,
      licence_basis: "official_direct_media_editorial_reference",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    clip_scene_plan: {
      repeatFree: true,
      blockers: [],
      scenes: directClips.map((clip, index) => ({
        id: `previous_scene_${index + 1}`,
        path: clip.path,
        source_url: clip.source_url,
        source_type: clip.source_type,
        media_kind: clip.media_kind,
        baseSourceKey: clip.source_family,
        durationS: 4.3,
      })),
    },
  });

  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("scene-window-reuse", artifactDir)] },
    generatedAt: "2026-06-27T09:05:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 12));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 47, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips.slice(0, 8), directClips.map((clip) => clip.path));
  assert.deepEqual(
    calls[0].visual_v4_bridge_video_clips.slice(0, 8).map((clip) => clip.durationS),
    Array(8).fill(5),
  );
  assert.equal(calls[0].video_clips.includes(ownedClipPath), false);
});

test("goal production render materializer collapses repeated Steam delivery variants before card top-up", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-steam-variant-collapse-"));
  const artifactDir = await makePackage(root, "steam-variant-collapse");
  const firstTrailerRoot =
    "steamstatic:/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626";
  const secondTrailerRoot =
    "steamstatic:/store_trailers/3483510/387849926/60a658bbf5d52df79e13601620dd1ae0918b2c0a/1770160497";
  const variants = [
    [firstTrailerRoot, "hls_264_master.m3u8"],
    [secondTrailerRoot, "hls_264_master.m3u8"],
    [firstTrailerRoot, "dash_av1.mpd"],
    [firstTrailerRoot, "dash_h264.mpd"],
    [secondTrailerRoot, "dash_av1.mpd"],
    [secondTrailerRoot, "dash_h264.mpd"],
  ];
  const directClips = [];
  for (let index = 0; index < variants.length; index += 1) {
    const [rootUrl, variant] = variants[index];
    const clipPath = path.join(root, "output", "video_cache", `elliot-steam-variant-${index + 1}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(2048, index + 81));
    directClips.push({
      id: `elliot-steam-variant-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `https://video.fastly.steamstatic.com/${rootUrl.replace("steamstatic:/", "")}/${variant}?t=1781798240`,
      source_type: "official_platform_product_page",
      base_source_family: `${rootUrl}/${variant}`,
      source_family: `elliot_variant_${index + 1}_window_36_5`,
      motion_family: `elliot_variant_${index + 1}_window_36_5`,
      media_kind: "direct_video",
      rights_basis: "official_direct_media",
      counts_towards_motion_readiness: true,
      materialized: true,
      durationS: 5,
    });
  }
  const ownedClips = [12, 12, 12].map((durationS, index) => {
    const clipPath = path.join(root, "output", "generated-motion", `elliot-readable-owned-${index + 1}.mp4`);
    return {
      id: `elliot-readable-owned-${index + 1}`,
      asset_id: `elliot-readable-owned-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-generated-motion/steam-variant-collapse/${index + 1}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_source_card_explainer_motion",
      asset_class: index === 0 ? "animated_quote_card" : "proof_card",
      source_family: `elliot_readable_owned_${index + 1}`,
      motion_family: `elliot_readable_owned_${index + 1}`,
      media_kind: "owned_explainer_motion",
      rights_basis: "owned_generated_editorial_motion_graphic",
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      materialized: true,
      durationS,
      minimum_readable_duration_s: durationS,
    };
  });
  for (const clip of ownedClips) await fs.outputFile(clip.path, Buffer.alloc(2048, 96));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: [...directClips, ...ownedClips],
    materialised_clips: [...directClips, ...ownedClips],
  });

  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("steam-variant-collapse", artifactDir)] },
    generatedAt: "2026-06-25T02:25:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 36, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips, [directClips[0].path, directClips[1].path]);
  assert.equal(calls[0].video_clips.includes(directClips[2].path), false);
  assert.equal(calls[0].video_clips.includes(directClips[3].path), false);
  assert.equal(calls[0].video_clips.includes(directClips[4].path), false);
  assert.equal(calls[0].video_clips.includes(directClips[5].path), false);
  assert.equal(calls[0].video_clips.includes(ownedClips[0].path), false);
});

test("goal production render materializer accepts approved owned explainer motion without job path fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-owned-explainer-render-"));
  const artifactDir = await makePackage(root, "owned-explainer-render");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "owned-explainer-render",
    canonical_subject: "Xbox Publishing",
    selected_title: "Xbox Publishing Has One Awkward Review",
    thumbnail_headline: "XBOX REVIEW",
    canonical_angle: "platform strategy explainer",
    primary_source: "Eurogamer",
    confirmed_claims: ["Xbox says its publishing plans remain under review."],
    narration_script:
      "Xbox Publishing just made the platform question awkward again. Eurogamer reports that the plan is still under review, which means players should not treat every rumour as locked.",
    first_spoken_line: "Xbox Publishing just made the platform question awkward again.",
    description: "Xbox says its publishing plans remain under review. Source: Eurogamer.",
  });

  const ownedClips = Array.from({ length: 13 }, (_, index) => {
    const clipPath = path.join(artifactDir, `owned-explainer-${index + 1}.mp4`);
    return {
      id: `owned-explainer-${index + 1}`,
      asset_id: `owned-explainer-${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: `local://pulse-generated-motion/owned-explainer-render/${index + 1}`,
      source_type: "internally_generated_motion_graphic",
      source_kind: "owned_source_card_explainer_motion",
      asset_class: index === 0 ? "kinetic_title_card" : "animated_source_card",
      source_family: `owned_explainer_family_${index + 1}`,
      motion_family: `owned_explainer_family_${index + 1}`,
      media_kind: "owned_explainer_motion",
      licence_basis: "owned_generated_editorial_motion_graphic",
      rights_basis: "owned_generated_editorial_motion_graphic",
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
      materialized: true,
      durationS: 2.8,
    };
  });
  for (const clip of ownedClips) await fs.outputFile(clip.path, Buffer.alloc(2048, 12));
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips: ownedClips,
    distinct_motion_family_count: ownedClips.length,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
      required_motion_scenes: 13,
      required_distinct_families: 13,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: ownedClips,
      production_motion_clips: ownedClips,
      distinct_source_families: ownedClips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: ownedClips.map((clip) => ({
      asset_id: clip.asset_id,
      asset_type: "owned_generated_motion_graphic",
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      licence_basis: clip.licence_basis,
      allowed_use: "finished_editorial_video_only",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: 0.01,
    })),
  });

  const job = readyJob("owned-explainer-render", artifactDir, {
    evidence: {
      narration_audio_path: path.join(artifactDir, "audio.mp3"),
      word_timestamps_path: path.join(artifactDir, "timestamps.json"),
    },
  });
  const calls = [];
  await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T10:55:00.000Z",
    renderProof: async ({ storyJson, output }) => {
      const story = await fs.readJson(storyJson);
      calls.push(story);
      await fs.outputFile(output, Buffer.alloc(4096, 9));
      return { story_id: story.id, output, clips: story.video_clips.length, rendered_duration_s: 42, size_bytes: 4096 };
    },
  });

  assert.deepEqual(calls[0].video_clips, ownedClips.map((clip) => clip.path));
  assert.equal(calls[0].visual_v4_bridge_video_clips[0].durationS, 2.8);
  assert.equal(calls[0].visual_v4_bridge_video_clips[0].source_kind, "owned_source_card_explainer_motion");
  assert.equal(calls[0].visual_v4_bridge_video_clips[0].asset_class, "kinetic_title_card");
  assert.equal(calls[0].visual_v4_bridge_video_clips[0].owned_explainer_visual_plan, true);
  const refreshedDirector = await fs.readJson(path.join(artifactDir, "director_beat_map.json"));
  assert.equal(refreshedDirector.shot_budget.available_motion_clips, 13);
});

test("goal production render materializer skips an existing final production render unless forced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-skip-"));
  const artifactDir = await makePackage(root);
  const job = readyJob("story-final", artifactDir);
  const firstReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:02:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return {
        clips: 2,
        rendered_duration_s: 24,
        clip_scene_plan: cleanRepeatFreeScenePlan(),
      };
    },
  });
  assert.equal(firstReport.summary.rendered_count, 1);

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:03:00.000Z",
    renderProof: async () => {
      throw new Error("should not rerender final output");
    },
  });

  assert.equal(report.summary.skipped_existing_count, 1);
  assert.equal(report.jobs[0].status, "skipped_existing_final_render");
});

test("goal production render materializer promotes a completed temporary MP4 atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-atomic-"));
  const artifactDir = await makePackage(root);
  const finalPath = path.join(artifactDir, "visual_v4_render.mp4");
  const original = Buffer.alloc(4096, 3);
  const replacement = Buffer.alloc(8192, 7);
  await fs.outputFile(finalPath, original);

  let renderOutput = null;
  const decodedGatePath = path.join(artifactDir, "qa", "decoded-visual", "story-atomic_decoded_visual_gate.json");
  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-atomic", artifactDir)] },
    generatedAt: "2026-07-12T17:45:00.000Z",
    force: true,
    renderProof: async ({ output }) => {
      renderOutput = output;
      assert.notEqual(output, finalPath);
      assert.equal(path.dirname(output), artifactDir);
      assert.match(path.basename(output), /^visual_v4_render\.partial-[^.]+\.mp4$/);
      assert.deepEqual(await fs.readFile(finalPath), original);
      await fs.outputFile(output, replacement);
      const decodedVisualGate = {
        status: "pass",
        decoded_media_evidence: true,
        blockers: [],
        frame_count: 49,
        mp4_path: output,
        report_path: decodedGatePath,
      };
      await fs.outputJson(decodedGatePath, decodedVisualGate);
      return {
        clips: 8,
        rendered_duration_s: 49,
        decoded_visual_gate: decodedVisualGate,
      };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.deepEqual(await fs.readFile(finalPath), replacement);
  assert.equal(await fs.pathExists(renderOutput), false);
  assert.equal(await fs.pathExists(`${finalPath}.render.lock`), false);
  const expectedHash = crypto.createHash("sha256").update(replacement).digest("hex");
  const renderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  const decodedGate = await fs.readJson(decodedGatePath);
  assert.equal(renderManifest.decoded_visual_gate.mp4_path, finalPath);
  assert.equal(renderManifest.decoded_visual_gate.mp4_sha256, expectedHash);
  assert.equal(renderManifest.decoded_visual_gate.mp4_size_bytes, replacement.length);
  assert.equal(renderManifest.decoded_visual_gate.final_output_binding_verified, true);
  assert.equal(decodedGate.mp4_path, finalPath);
  assert.equal(decodedGate.mp4_sha256, expectedHash);
  assert.equal(decodedGate.mp4_size_bytes, replacement.length);
  assert.equal(decodedGate.final_output_binding_verified, true);
});

test("goal production render materializer rejects overlapping renders for one final MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-lock-"));
  const artifactDir = await makePackage(root);
  const job = readyJob("story-locked", artifactDir);
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const release = new Promise((resolve) => { releaseFirst = resolve; });

  const first = materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-12T17:46:00.000Z",
    force: true,
    renderProof: async ({ output }) => {
      firstStarted();
      await release;
      await fs.outputFile(output, Buffer.alloc(4096, 4));
      return { clips: 8, rendered_duration_s: 49 };
    },
  });
  await started;

  const second = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-07-12T17:46:01.000Z",
    force: true,
    renderProof: async () => {
      throw new Error("overlapping renderer must not start");
    },
  });

  assert.equal(second.summary.failed_count, 1);
  assert.match(second.jobs[0].error, /production_render_already_in_progress/);
  releaseFirst();
  const firstReport = await first;
  assert.equal(firstReport.summary.rendered_count, 1);
});

test("goal production render materializer preserves the final MP4 and cleans temporary files after failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-atomic-failure-"));
  const artifactDir = await makePackage(root);
  const finalPath = path.join(artifactDir, "visual_v4_render.mp4");
  const original = Buffer.alloc(4096, 2);
  await fs.outputFile(finalPath, original);
  let temporaryPath = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-atomic-failure", artifactDir)] },
    generatedAt: "2026-07-12T17:47:00.000Z",
    force: true,
    renderProof: async ({ output }) => {
      temporaryPath = output;
      await fs.outputFile(output, Buffer.alloc(2048, 8));
      throw new Error("simulated_renderer_failure");
    },
  });

  assert.equal(report.summary.failed_count, 1);
  assert.deepEqual(await fs.readFile(finalPath), original);
  assert.equal(await fs.pathExists(temporaryPath), false);
  assert.equal(await fs.pathExists(`${finalPath}.render.lock`), false);
});

test("goal production render materializer does not promote an MP4 that fails media integrity validation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-integrity-"));
  const artifactDir = await makePackage(root);
  const finalPath = path.join(artifactDir, "visual_v4_render.mp4");
  const original = Buffer.alloc(4096, 2);
  await fs.outputFile(finalPath, original);
  let validatedPath = null;

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-integrity-failure", artifactDir)] },
    generatedAt: "2026-07-12T17:48:00.000Z",
    force: true,
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(8192, 9));
      return { clips: 8, rendered_duration_s: 49 };
    },
    verifyRenderedMedia: async (candidatePath) => {
      validatedPath = candidatePath;
      throw new Error("production_render_media_integrity_failed:decode_error");
    },
  });

  assert.equal(report.summary.failed_count, 1);
  assert.notEqual(validatedPath, finalPath);
  assert.deepEqual(await fs.readFile(finalPath), original);
  assert.equal(await fs.pathExists(validatedPath), false);
});

test("goal production render materializer rerenders existing final MP4s without current repeat and card cadence evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-no-cadence-evidence-"));
  const artifactDir = await makePackage(root);
  const job = readyJob("story-final", artifactDir);
  const calls = [];

  const firstReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-25T09:00:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return { clips: 2, rendered_duration_s: 24 };
    },
  });
  assert.equal(firstReport.summary.rendered_count, 1);

  const secondReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-25T09:01:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return {
        clips: 2,
        rendered_duration_s: 24,
        clip_scene_plan: cleanRepeatFreeScenePlan(),
      };
    },
  });

  assert.equal(secondReport.summary.rendered_count, 1);
  assert.equal(secondReport.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 2);
});

test("goal production render materializer stamps public-copy regeneration when render is fresh", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-public-copy-stamp-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Has One Arkham Catch",
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
    first_spoken_line: "Lego Batman has more Arkham DNA than it first looks.",
    description: "Lego Batman has more Arkham DNA than it first looks. Source: GameSpot.",
    public_copy_repaired_at: "2026-05-22T07:01:00.000Z",
  });
  const job = readyJob("story-final", artifactDir);

  const firstReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:02:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return { clips: 2, rendered_duration_s: 42, clip_scene_plan: cleanRepeatFreeScenePlan() };
    },
  });
  const afterRender = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(firstReport.summary.rendered_count, 1);
  assert.equal(afterRender.public_copy_final_render_regenerated_at, "2026-05-22T07:02:00.000Z");
  assert.equal(afterRender.public_copy_regeneration_completed_at, "2026-05-22T07:02:00.000Z");

  delete afterRender.public_copy_final_render_regenerated_at;
  delete afterRender.public_copy_regeneration_completed_at;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), afterRender, { spaces: 2 });

  const secondReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:03:00.000Z",
    renderProof: async () => {
      throw new Error("should not rerender final output");
    },
  });
  const afterSkip = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(secondReport.summary.skipped_existing_count, 1);
  assert.equal(afterSkip.public_copy_final_render_regenerated_at, "2026-05-22T07:02:00.000Z");
  assert.equal(afterSkip.public_copy_regeneration_completed_at, "2026-05-22T07:02:00.000Z");
});

test("goal production render materializer clears stale duration invalidation after final render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-duration-stamp-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    narration_script: "Hades II finally has a console date players can plan around.",
    first_spoken_line: "Hades II finally has a console date players can plan around.",
    description: "Hades II finally has a console date. Source: Xbox.",
    primary_source: "Xbox",
    duration_variant_status: "invalidated_requires_repair",
    duration_variant_invalidated_at: "2026-05-22T07:00:00.000Z",
    duration_variant_invalidated_reason: "narration_script_changed_after_duration_variant_repair",
    duration_variant_repaired_at: "2026-05-22T07:01:00.000Z",
  });
  const job = readyJob("story-final", artifactDir);

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:02:00.000Z",
    renderProof: async ({ output }) => {
      await fs.outputFile(output, Buffer.alloc(4096, 5));
      return { clips: 2, rendered_duration_s: 42, clip_scene_plan: cleanRepeatFreeScenePlan() };
    },
  });

  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(report.summary.rendered_count, 1);
  assert.equal(canonical.duration_variant_status, "repaired_rendered");
  assert.equal(canonical.duration_variant_final_render_regenerated_at, "2026-05-22T07:02:00.000Z");
  assert.equal(canonical.duration_variant_regeneration_status, "rendered");

  delete canonical.duration_variant_status;
  delete canonical.duration_variant_final_render_regenerated_at;
  delete canonical.duration_variant_regeneration_status;
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    ...canonical,
    duration_variant_status: "invalidated_requires_repair",
  }, { spaces: 2 });

  const secondReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T07:03:00.000Z",
    renderProof: async () => {
      throw new Error("should not rerender final output");
    },
  });

  const afterSkip = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(secondReport.summary.skipped_existing_count, 1);
  assert.equal(afterSkip.duration_variant_status, "repaired_rendered");
  assert.equal(afterSkip.duration_variant_final_render_regenerated_at, "2026-05-22T07:02:00.000Z");
  assert.equal(afterSkip.duration_variant_regeneration_status, "skipped_existing_final_render");
});

test("goal production render materializer rerenders existing final MP4s without current input fingerprint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-no-fingerprint-"));
  const artifactDir = await makePackage(root);
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    generated_at: "2026-05-22T09:00:00.000Z",
  });
  const freshTime = new Date("2026-05-22T09:05:00.000Z");
  await fs.utimes(path.join(artifactDir, "visual_v4_render.mp4"), freshTime, freshTime);
  await fs.utimes(path.join(artifactDir, "audio.mp3"), freshTime, freshTime);
  await fs.utimes(path.join(artifactDir, "timestamps.json"), freshTime, freshTime);
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T09:06:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return { clips: 2, rendered_duration_s: 42 };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 1);
});

test("goal production render materializer rerenders existing final MP4s with stale mix policies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-stale-policy-"));
  const artifactDir = await makePackage(root);
  const job = readyJob("story-final", artifactDir);
  const calls = [];

  const firstReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T09:20:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return { clips: 2, rendered_duration_s: 42 };
    },
  });
  assert.equal(firstReport.summary.rendered_count, 1);

  const manifestPath = path.join(artifactDir, "render_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  await fs.writeJson(
    manifestPath,
    {
      ...manifest,
      sfx_mix_policy_version: "legacy_placeholder_sfx_v1",
      voice_mix_policy_version: "legacy_voice_chain_v1",
      visual_design_policy_version: "legacy_flat_cards_v1",
    },
    { spaces: 2 },
  );

  const secondReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-22T09:21:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 7));
      return { clips: 2, rendered_duration_s: 42 };
    },
  });

  assert.equal(secondReport.summary.rendered_count, 1);
  assert.equal(secondReport.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 2);
});

test("goal production render materializer rerenders v8 visuals before repeat-free readable-card publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-stale-v8-"));
  const artifactDir = await makePackage(root);
  const job = readyJob("story-final", artifactDir);
  const calls = [];

  const firstReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-24T23:01:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return { clips: 8, rendered_duration_s: 52 };
    },
  });
  assert.equal(firstReport.summary.rendered_count, 1);

  const manifestPath = path.join(artifactDir, "render_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  await fs.writeJson(
    manifestPath,
    {
      ...manifest,
      visual_design_policy_version: "newsroom_safe_vertical_compose_v8",
    },
    { spaces: 2 },
  );

  const secondReport = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-24T23:02:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 7));
      return { clips: 8, rendered_duration_s: 52 };
    },
  });

  assert.equal(secondReport.summary.rendered_count, 1);
  assert.equal(secondReport.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 2);
  const refreshed = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(refreshed.visual_design_policy_version, STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION);
});

test("goal production render materializer rerenders existing final MP4s that predate repaired public copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-stale-existing-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Has One Arkham Catch",
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
    first_spoken_line: "Lego Batman has more Arkham DNA than it first looks.",
    description: "Lego Batman has more Arkham DNA than it first looks. Source: GameSpot.",
    public_copy_repaired_at: "2026-05-22T08:00:00.000Z",
  });
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    generated_at: "2026-05-22T09:00:00.000Z",
  });
  const oldRenderTime = new Date("2026-05-22T07:50:00.000Z");
  const freshInputTime = new Date("2026-05-22T08:05:00.000Z");
  await fs.utimes(path.join(artifactDir, "visual_v4_render.mp4"), oldRenderTime, oldRenderTime);
  await fs.utimes(path.join(artifactDir, "audio.mp3"), freshInputTime, freshInputTime);
  await fs.utimes(path.join(artifactDir, "timestamps.json"), freshInputTime, freshInputTime);
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T08:10:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return { clips: 2, rendered_duration_s: 42 };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 1);
});

test("goal production render materializer honours force_final_render on stale-copy rerender jobs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-force-job-"));
  const artifactDir = await makePackage(root);
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
  });
  const calls = [];

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        readyJob("story-final", artifactDir, {
          force_final_render: true,
        }),
      ],
    },
    generatedAt: "2026-05-22T09:25:00.000Z",
    renderProof: async ({ output }) => {
      calls.push(output);
      await fs.outputFile(output, Buffer.alloc(4096, 6));
      return { clips: 2, rendered_duration_s: 24 };
    },
  });

  assert.equal(report.summary.rendered_count, 1);
  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(calls.length, 1);
});

test("goal production render materializer blocks stale audio after public copy repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-stale-audio-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Has One Arkham Catch",
    narration_script: "Lego Batman has more Arkham DNA than it first looks.",
    first_spoken_line: "Lego Batman has more Arkham DNA than it first looks.",
    description: "Lego Batman has more Arkham DNA than it first looks. Source: GameSpot.",
    public_copy_repaired_at: "2026-05-22T08:00:00.000Z",
  });
  const staleTime = new Date("2026-05-22T07:55:00.000Z");
  await fs.utimes(path.join(artifactDir, "audio.mp3"), staleTime, staleTime);
  await fs.utimes(path.join(artifactDir, "timestamps.json"), staleTime, staleTime);

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T08:05:00.000Z",
    renderProof: async () => {
      throw new Error("should not render with stale repaired-copy audio");
    },
  });

  assert.equal(report.summary.rendered_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /render_input_stale_after_public_copy_repair/);
});

test("goal production render materializer blocks stale audio after duration variant repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-stale-duration-audio-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Hades II",
    selected_title: "Hades II Finally Has A Console Date",
    narration_script: "Hades II finally has a console date players can plan around.",
    first_spoken_line: "Hades II finally has a console date players can plan around.",
    description: "Hades II finally has a console date. Source: Xbox.",
    primary_source: "Xbox",
    duration_variant_repaired_at: "2026-05-22T10:00:00.000Z",
  });
  const staleTime = new Date("2026-05-22T09:55:00.000Z");
  await fs.utimes(path.join(artifactDir, "audio.mp3"), staleTime, staleTime);
  await fs.utimes(path.join(artifactDir, "timestamps.json"), staleTime, staleTime);

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T10:05:00.000Z",
    renderProof: async () => {
      throw new Error("should not render with stale duration-variant audio");
    },
  });

  assert.equal(report.summary.rendered_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /render_input_stale_after_duration_variant_repair/);
});

test("goal production render materializer blocks instruction-like narration before final render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-bad-script-"));
  const artifactDir = await makePackage(root);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-final",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Just Got More Expensive",
    first_spoken_line: "Forza Horizon 6 just got more expensive for players.",
    narration_script:
      "Forza Horizon 6 just got more expensive for players. Insider Gaming reports Forza Horizon 6 Has Made Over $140 Million from Premium Edition. Before you spend, check the live price, the platform listing and whether the deal is still active. Forza Horizon 6 is the hook, but the decision is simpler: buy now, wait or skip it until the next confirmed listing. If the listing moves again, the recommendation moves with it. Treat the headline as a price check, not a victory lap. The next update that matters is a store page, official post or platform listing changing the practical call.",
    description:
      "Forza Horizon 6 has reportedly made over $140 million from its Premium Edition. Source: Insider Gaming.",
  });

  const report = await materializeGoalProductionRenders({
    workspaceRoot: root,
    workOrder: { jobs: [readyJob("story-final", artifactDir)] },
    generatedAt: "2026-05-22T08:08:00.000Z",
    renderProof: async () => {
      throw new Error("should not render instruction-like buyer advice narration");
    },
  });

  assert.equal(report.summary.rendered_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /render_input_public_copy_failed/);
  assert.match(report.jobs[0].error, /instruction_like_buyer_advice_narration/);
});

test("goal production render materializer resolves relative audio inputs from MEDIA_ROOT", async () => {
  const originalMediaRoot = process.env.MEDIA_ROOT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-media-root-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-media-files-"));
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = await makePackage(root);
    const audioPath = path.join(mediaRoot, "output", "audio", "story-final.mp3");
    const timestampsPath = path.join(mediaRoot, "output", "audio", "story-final_timestamps.json");
    await fs.outputFile(audioPath, Buffer.alloc(2048, 8));
    await fs.outputJson(timestampsPath, {
      words: [{ word: "Lego", start: 0, end: 0.3 }],
    });

    const job = readyJob("story-final", artifactDir, {
      evidence: {
        ...readyJob("story-final", artifactDir).evidence,
        narration_audio_path: "output/audio/story-final.mp3",
        word_timestamps_path: "output/audio/story-final_timestamps.json",
      },
    });
    const calls = [];

    const report = await materializeGoalProductionRenders({
      workspaceRoot: root,
      workOrder: { jobs: [job] },
      generatedAt: "2026-05-22T08:10:00.000Z",
      renderProof: async ({ storyJson, output }) => {
        const story = await fs.readJson(storyJson);
        calls.push(story);
        await fs.outputFile(output, Buffer.alloc(4096, 9));
        return {
          story_id: story.id,
          output,
          clips: story.video_clips.length,
          rendered_duration_s: 24,
        };
      },
    });

    assert.equal(report.summary.rendered_count, 1);
    assert.equal(report.summary.failed_count, 0);
    assert.equal(calls[0].audio_path, "output/audio/story-final.mp3");
    assert.equal(calls[0].timestamps_path, "output/audio/story-final_timestamps.json");
  } finally {
    if (originalMediaRoot === undefined) {
      delete process.env.MEDIA_ROOT;
    } else {
      process.env.MEDIA_ROOT = originalMediaRoot;
    }
  }
});

test("goal production render materializer writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-write-"));
  const report = {
    mode: "PRODUCTION_RENDER_MATERIALIZER",
    generated_at: "2026-05-22T07:05:00.000Z",
    summary: { rendered_count: 0, failed_count: 0, skipped_existing_count: 0 },
    jobs: [],
    safety: { no_publish_triggered: true },
  };

  const written = await writeGoalProductionRenderMaterializationReport(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /Production Render Materialization/);
});
