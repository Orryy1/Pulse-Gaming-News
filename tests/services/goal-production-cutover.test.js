"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildProductionRenderCutoverPlan,
  writeProductionRenderCutoverPlan,
} = require("../../lib/goal-production-cutover");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../../lib/studio/v4/render-policy");

async function makeCutoverPackage(root, id = "story-one", options = {}) {
  const artifactDir = path.join(root, id);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: id,
    canonical_subject: options.subject || "Forza Horizon 6",
    selected_title: options.title || "Forza Horizon 6 Exposes Xbox's Steam Bet",
    first_spoken_line:
      options.firstSpokenLine ||
      `${options.subject || "Forza Horizon 6"} exposes the player-facing bet before launch.`,
    narration_script:
      options.narrationScript ||
      `${options.subject || "Forza Horizon 6"} exposes the player-facing bet before launch. The source detail changes what players should watch next.`,
    description:
      options.description ||
      `${options.subject || "Forza Horizon 6"} changes the player watchlist. Source: IGN.`,
    primary_source: options.primarySource || "IGN",
    primary_source_url: options.primarySourceUrl || "",
    source_type: options.sourceType || "",
    source_card_label: options.sourceCardLabel || options.primarySource || "IGN",
  });
  const defaultShotPlan = Array.from({ length: 8 }, (_, index) => ({
    id: `motion_${index + 1}`,
    kind: "motion_clip",
    startS: index === 0 ? 0.2 : index * 3,
    durationS: 2.8,
    source_family: `${id}_official_motion_family_${index + 1}`,
  }));
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), options.directorPlan || {
    story_id: id,
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [
      ...defaultShotPlan,
      { id: "source_lock", kind: "source_lock", startS: 1.5, durationS: 1.6 },
      { id: "proof_card", kind: "proof_card", startS: 5.5, durationS: 2.4 },
      { id: "steam_chart", kind: "steam_chart", startS: 8.5, durationS: 2.4 },
    ],
    transition_plan: {
      max_same_transition_run: 1,
      planned: [
        { family: "speed_ramp" },
        { family: "whip_pan" },
        { family: "chart_slam" },
        { family: "source_wipe" },
        { family: "match_cut" },
        { family: "kinetic_push" },
        { family: "proof_snap" },
        { family: "brand_wipe" },
      ],
      rules: {
        forbid_text_on_text: true,
        chart_numbers_must_be_large: true,
      },
    },
    sfx_plan: {
      cue_count: 8,
      max_same_family_run: 1,
      cues: [
        { family: "impact" },
        { family: "whoosh" },
        { family: "transition_hit" },
        { family: "riser" },
        { family: "chart_tick" },
      ],
      mastering: {
        limiter: true,
        target_peak_db: -1.5,
      },
      source_plan: {
        readiness: { status: "pass", blockers: [] },
      },
    },
    sound_transition_plan: {
      sfx: {
        cue_count: 8,
        max_same_family_run: 1,
        cues: [
          { family: "impact" },
          { family: "whoosh" },
          { family: "transition_hit" },
          { family: "riser" },
          { family: "chart_tick" },
        ],
        mastering: {
          limiter: true,
          target_peak_db: -1.5,
        },
        source_plan: {
          readiness: { status: "pass", blockers: [] },
        },
      },
    },
    visual_obligations: {
      no_text_on_text_wipes: true,
      cards_are_context_only: true,
    },
    caption_policy: {
      subtitle_timing_source: "timestamps",
      clean_manual_captions: true,
      manual_caption_generated: true,
      max_caption_desync_ms: 80,
      avoid_lower_third_collisions: true,
    },
  });
  const sourceClipPath = path.join(artifactDir, "source-clip.mp4");
  await fs.outputFile(sourceClipPath, Buffer.alloc(3000, 9));
  const defaultRightsRecords = [
    {
      asset_id: `${id}_motion`,
      path: sourceClipPath,
      source_url: `https://cdn.example.test/${id}/official-gameplay.mp4`,
      source_type: "official_trailer_segment",
      source_family: `${id}_official_gameplay`,
      rights_risk_class: "official_reference_only",
      licence_basis: "official_reference_transformative_short",
      commercial_use_allowed: true,
      risk_score: 0.05,
      approval_status: "approved",
    },
  ];
  if (options.finalPublishRender === true) {
    const defaultMotionClips = [];
    for (let index = 1; index <= 8; index += 1) {
      const clipPath = path.join(artifactDir, "official-motion", `clip-${index}.mp4`);
      await fs.outputFile(clipPath, Buffer.alloc(3000, index + 10));
      const clip = {
        asset_id: `${id}_official_motion_${index}`,
        id: `${id}_official_motion_${index}`,
        path: clipPath,
        source_url: `https://cdn.example.test/${id}/official-gameplay-${index}.mp4`,
        source_type: "official_trailer_segment",
        media_kind: "direct_video",
        source_url_kind: "local_video_file",
        source_family: `${id}_official_motion_family_${index}`,
        rights_risk_class: "official_reference_only",
        licence_basis: "official_reference_transformative_short",
        commercial_use_allowed: true,
        risk_score: 0.05,
        approval_status: "approved",
        validated: true,
      };
      defaultMotionClips.push(clip);
      defaultRightsRecords.push(clip);
    }
    await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
      motion_inventory: {
        accepted_local_clips: defaultMotionClips,
        production_motion_clips: defaultMotionClips,
      },
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), defaultRightsRecords);
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: options.benchmarkResult || "pass",
    scores: {
      motion_density_score: options.motionDensityScore ?? 92,
      first_3_seconds_hook_score: options.hookScore ?? 86,
      caption_legibility_score: options.captionScore ?? 94,
      transition_energy_score: options.transitionScore ?? 82,
      sfx_impact_score: options.sfxScore ?? 88,
      media_house_polish_score: options.polishScore ?? 91,
    },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: { media_house_polish_score: options.polishScore ?? 91 },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    outputs: { youtube_shorts: { duration_seconds: { min: 35, max: 60 } } },
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "GREEN",
    can_auto_publish: true,
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [
        {
          asset_id: `${id}_impact`,
          role: "impact",
          provider_id: "sonniss",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
        },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: id,
    renderer: options.renderer || "visual_v4_local_proof",
    visual_tier: options.visualTier || "local_proof_motion_graphic",
    final_publish_render: options.finalPublishRender === true,
    sfx_mix_policy_version: options.sfxMixPolicyVersion || STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: options.voiceMixPolicyVersion || STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: options.visualDesignPolicyVersion || STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(path.join(artifactDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(2000, 1));
  return {
    story_id: id,
    verdict: "GREEN",
    artifact_dir: artifactDir,
  };
}

test("production cutover queues proof renders instead of treating them as publish-ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-proof-"));
  const storyPackage = await makeCutoverPackage(root, "proof-story");

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:00:00.000Z",
  });

  assert.equal(plan.summary.story_count, 1);
  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.final_render_input_ready_count, 0);
  assert.equal(plan.summary.final_render_input_blocked_count, 1);
  assert.equal(plan.summary.blocked_count, 0);
  assert.equal(plan.queue[0].story_id, "proof-story");
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].required_inputs.includes("canonical_story_manifest.json"));
  assert.ok(plan.queue[0].required_inputs.includes("director_beat_map.json"));
  assert.equal(plan.queue[0].target_render_manifest.final_publish_render, true);
  assert.equal(plan.safety.no_publish_triggered, true);
});

test("production cutover blocks final renders backed only by generated card motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-generated-only-"));
  const storyPackage = await makeCutoverPackage(root, "generated-only-final", {
    subject: "PlayStation Store",
    title: "PlayStation's Pricing Test Has A Legal Problem",
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const generatedClips = Array.from({ length: 8 }, (_, index) => ({
    id: `generated-only-final-owned-motion-${index + 1}`,
    path: `output/generated-motion/generated-only-final/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/generated-only-final/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    source_family: `orange_card_${index + 1}`,
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: generatedClips.map((clip) => ({
      ...clip,
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: generatedClips,
    },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T12:50:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.blocked_count, 1);
  assert.ok(plan.blocked[0].blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(plan.blocked[0].blockers.includes("visual_evidence:no_real_visual_media_asset"));
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
});

test("production cutover blocks stale benchmark passes when scheduler-candidate evidence lacks real source families", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-benchmark-"));
  const storyPackage = await makeCutoverPackage(root, "stale-benchmark-owned-final", {
    subject: "Kadokawa",
    title: "Kadokawa Stake Just Passed Sony",
    primarySource: "Automaton West",
    primarySourceUrl:
      "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const ownedClips = [];
  for (let index = 1; index <= 8; index += 1) {
    const clipPath = path.join(artifactDir, "owned-motion", `owned-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    ownedClips.push({
      id: `owned-explainer-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/stale-benchmark-owned-final/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      source_family: `owned_explainer_family_${index}`,
      owned_explainer_visual_plan: true,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: ownedClips,
      production_motion_clips: ownedClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      ...ownedClips.map((clip) => ({
        ...clip,
        asset_type: "owned_generated_motion_graphic",
        licence_basis: "owned_generated_editorial_motion_graphic",
        commercial_use_allowed: true,
        approval_status: "approved_for_transformative_editorial_use",
        risk_score: 0.01,
      })),
      {
        asset_id: "automaton-source-card",
        asset_type: "source_card_reference",
        source_url:
          "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
        source_owner: "Automaton West",
        source_type: "official_editorial_source_card",
        source_family: "automaton_west_kadokawa_oasis",
        licence_basis: "source_citation_transformative_reference",
        commercial_use_allowed: true,
        approval_status: "approved_for_source_lock_reference",
        risk_score: 0.05,
      },
    ],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T14:45:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.blocked_count, 1);
  assert.ok(
    plan.blocked[0].blockers.includes(
      "scheduler_candidate:gold_standard:visual_evidence:insufficient_real_visual_source_families",
    ),
  );
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
});

test("production cutover requeues final renders that lack direct-video motion evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-direct-video-missing-"));
  const storyPackage = await makeCutoverPackage(root, "direct-video-missing-final", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Hades", start: 0, end: 0.3 }] });
  const stillDerivedClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "motion", `still-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    stillDerivedClips.push({
      id: `steam-still-${index}`,
      path: clipPath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145350/ss_${index}.jpg`,
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index}`,
      media_kind: "visual_still",
      rights_risk_class: "steam_storefront_promotional_editorial_use",
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: stillDerivedClips,
      production_motion_clips: stillDerivedClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: stillDerivedClips.map((clip) => ({
      ...clip,
      asset_type: "screenshot_derived_motion_clip",
      licence_basis: "steam_storefront_promotional_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T16:15:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.ok(plan.queue[0].render_input_blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.equal(plan.queue[0].render_input_evidence.visual_evidence_profile.direct_video_motion_asset_count, 0);
});

test("production cutover requeues final renders when selected render deck missed available direct video", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-selected-direct-missing-"));
  const storyPackage = await makeCutoverPackage(root, "selected-direct-missing-final", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Forza", start: 0, end: 0.3 }] });

  const directClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "direct", `official-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    directClips.push({
      id: `official-direct-${index}`,
      path: clipPath,
      source_url: `https://video.akamai.steamstatic.com/store_trailers/1145350/direct-${index}.mp4`,
      source_type: "steam_movie",
      media_kind: "direct_video",
      source_url_kind: "hls_manifest",
      source_family: `official_direct_family_${index}`,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: directClips,
      production_motion_clips: directClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: directClips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "steam_storefront_promotional_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const selectedDeck = [];
  for (let index = 1; index <= 6; index += 1) {
    const clipPath = path.join(artifactDir, "selected", `screenshot-pan-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    selectedDeck.push({
      id: `selected-still-${index}`,
      path: clipPath,
      source_type: "selected_render_motion_clip",
      media_kind: "screenshot_derived_motion",
      source_family: `selected_screenshot_family_${index}`,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    story_id: "selected-direct-missing-final",
    visual_v4_bridge_video_clips: selectedDeck,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T16:42:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.final_render_input_ready_count, 1, JSON.stringify(plan.queue[0], null, 2));
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.ok(plan.queue[0].render_input_evidence.visual_evidence_profile.direct_video_motion_asset_count >= 5);
  assert.equal(plan.queue[0].selected_render_evidence.direct_video_motion_asset_count, 0);
});

test("production cutover requeues generated-only selected decks when real motion inputs exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-selected-generated-only-"));
  const storyPackage = await makeCutoverPackage(root, "selected-generated-only-final", {
    subject: "Kadokawa",
    title: "Kadokawa Stake Just Passed Sony",
    primarySource: "Automaton West",
    primarySourceUrl:
      "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Kadokawa", start: 0, end: 0.3 }] });

  const ownedClips = [];
  for (let index = 1; index <= 8; index += 1) {
    const clipPath = path.join(artifactDir, "owned-motion", `owned-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    ownedClips.push({
      id: `owned-explainer-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/selected-generated-only-final/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      source_family: `owned_explainer_family_${index}`,
      owned_explainer_visual_plan: true,
      validated: true,
    });
  }
  const realMotionClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "real-motion", `screenshot-pan-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index + 20));
    realMotionClips.push({
      id: `kadokawa-source-motion-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/kadokawa/source-screenshot-${index}.jpg`,
      source_type: "official_source_screenshot",
      media_kind: "screenshot_derived_motion",
      source_url_kind: "visual_still",
      source_family: `kadokawa_real_motion_family_${index}`,
      validated: true,
    });
  }
  const clips = [...ownedClips, ...realMotionClips];
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: clip.media_kind === "screenshot_derived_motion" ? "screenshot_derived_motion_clip" : "owned_generated_motion_graphic",
      licence_basis:
        clip.media_kind === "screenshot_derived_motion"
          ? "official_source_screenshot_transformative_motion"
          : "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: clip.media_kind === "screenshot_derived_motion" ? 0.05 : 0.01,
    })),
  });

  const selectedDeck = [];
  for (let index = 1; index <= 8; index += 1) {
    const clipPath = path.join(artifactDir, "selected", `orange-card-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index + 40));
    selectedDeck.push({
      id: `selected-owned-card-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/selected-deck/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_generated_motion",
      source_family: `selected_owned_card_${index}`,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    story_id: "selected-generated-only-final",
    visual_v4_bridge_video_clips: selectedDeck,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T17:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.final_render_input_ready_count, 0);
  assert.equal(plan.summary.final_render_input_blocked_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("visual_evidence:direct_video_motion_missing"));
  assert.ok(plan.queue[0].blockers.includes("selected_render_evidence:generated_only_motion_deck"));
  assert.equal(plan.queue[0].selected_render_evidence.generated_only_motion_deck, true);
  assert.ok(plan.queue[0].render_input_evidence.visual_evidence_profile.real_motion_asset_count >= 5);
  assert.equal(plan.queue[0].render_input_evidence.visual_evidence_profile.direct_video_motion_asset_count, 0);
});

test("production cutover accepts direct-video proof plus owned motion families as final render input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-direct-proof-plus-owned-"));
  const storyPackage = await makeCutoverPackage(root, "steam-controller-direct-proof", {
    subject: "Steam Controller",
    title: "Steam Controller Date May Have Leaked",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Steam", start: 0, end: 0.3 }] });

  const generatedClips = [];
  for (let index = 1; index <= 13; index += 1) {
    const clipPath = path.join(artifactDir, "owned-motion", `owned-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    generatedClips.push({
      id: `owned-motion-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/steam-controller/${index}`,
      source_type: "owned_generated_motion",
      media_kind: "owned_motion",
      source_family: `owned_motion_family_${index}`,
      durationS: 3,
      validated: true,
      materialized: true,
    });
  }
  const directClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "direct", `steam-controller-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index + 20));
    directClips.push({
      id: `steam-controller-direct-${index}`,
      path: clipPath,
      source_url: "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282",
      source_type: "official_platform_product_page",
      media_kind: "direct_video",
      source_url_kind: "hls_manifest",
      source_family: "steam_353370_37301",
      durationS: 5,
      validated: true,
      materialized: true,
    });
  }
  const clips = [...generatedClips, ...directClips];
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      required_motion_scenes: 13,
      required_distinct_families: 13,
    },
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      direct_video_motion_asset_count: 5,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: clip.media_kind === "direct_video" ? "motion_clip" : "owned_generated_motion_clip",
      licence_basis:
        clip.media_kind === "direct_video"
          ? "official_source_transformative_editorial_use"
          : "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T20:05:00.000Z",
  });

  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.final_render_input_ready_count, 1);
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.equal(plan.queue[0].render_input_blockers.includes("real_visual_motion_clips_missing"), false);
  assert.equal(plan.queue[0].render_input_blockers.includes("real_visual_motion_families_insufficient"), false);
  assert.equal(plan.queue[0].render_input_evidence.visual_evidence_profile.direct_video_motion_asset_count, 5);
});

test("production cutover separates direct-video floor failures from real-media clip count", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-direct-floor-"));
  const storyPackage = await makeCutoverPackage(root, "direct-floor-gap", {
    subject: "Forza Horizon 6",
    title: "Forza Horizon 6 Needs One More Direct Clip",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Forza", start: 0, end: 0.3 }] });

  const clips = [];
  for (let index = 1; index <= 4; index += 1) {
    const clipPath = path.join(artifactDir, "direct", `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    clips.push({
      id: `direct-clip-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/forza/direct-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_url_kind: "direct_video",
      source_family: `official_direct_family_${index}`,
      validated: true,
    });
  }
  const screenshotMotionPath = path.join(artifactDir, "screenshot-motion", "safe-pan.mp4");
  await fs.outputFile(screenshotMotionPath, Buffer.alloc(3000, 9));
  clips.push({
    id: "screenshot-derived-motion",
    path: screenshotMotionPath,
    source_url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1551360/ss_01.jpg",
    source_type: "official_storefront_screenshot_transform",
    media_kind: "screenshot_derived_motion",
    source_family: "steam_screenshot_family",
    validated: true,
  });

  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T10:15:00.000Z",
  });

  assert.equal(plan.summary.final_render_input_ready_count, 0);
  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.equal(plan.queue[0].render_input_evidence.real_visual_motion_clip_count, 5);
  assert.equal(
    plan.queue[0].render_input_evidence.real_motion_input_readiness.direct_video_motion_clip_floor_met,
    false,
  );
  assert.ok(plan.queue[0].render_input_blockers.includes("direct_video_motion_clip_floor_not_met"));
  assert.equal(plan.queue[0].render_input_blockers.includes("real_visual_motion_clips_missing"), false);
});

test("production cutover carries governed SFX evidence into scheduler bridge candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-sfx-bridge-"));
  const storyPackage = await makeCutoverPackage(root, "sfx-bridge-ready", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const clipPath = path.join(artifactDir, "official-motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(3000, 4));
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `official-motion-${index + 1}`,
    path: clipPath,
    source_url: `https://cdn.example.test/sfx-bridge-ready/official-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `official_family_${index + 1}`,
    media_kind: "direct_video",
    commercial_use_allowed: true,
    risk_score: 0.1,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:10:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 1);
  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.sfx_manifest.source_plan.readiness.status, "pass");
  assert.equal(candidate.sfx_manifest.source_plan.selected_assets[0].provider_id, "sonniss");
});

test("production cutover refreshes scheduler caption SRT from word timestamps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-word-captions-"));
  const storyPackage = await makeCutoverPackage(root, "caption-ready-final", {
    subject: "Hades II",
    title: "Hades II Just Hit Consoles",
    firstSpokenLine: "Hades II just hit consoles.",
    narrationScript: "Hades II just hit consoles. Follow Pulse Gaming.",
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const clipPath = path.join(artifactDir, "official-motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(3000, 4));
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `official-motion-${index + 1}`,
    path: clipPath,
    source_url: `https://cdn.example.test/caption-ready-final/official-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `official_family_${index + 1}`,
    media_kind: "direct_video",
    commercial_use_allowed: true,
    risk_score: 0.1,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  const timestampsPath = path.join(artifactDir, "word_timestamps.json");
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.42 },
      { word: "two", start: 0.42, end: 0.78 },
      { word: "just", start: 0.78, end: 1.02 },
      { word: "hit", start: 1.02, end: 1.22 },
      { word: "consoles.", start: 1.22, end: 1.7 },
      { word: "Follow", start: 3.5, end: 3.82 },
      { word: "Paul", start: 3.82, end: 4.04 },
      { word: "Skaming", start: 4.04, end: 4.48 },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: path.join(artifactDir, "narration.mp3"),
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:15:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 1);
  const captions = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  assert.match(captions, /00:00:00,000 --> 00:00:00,780\nHades II/);
  assert.match(captions, /00:00:00,780 --> 00:00:01,220\njust hit/);
  assert.match(captions, /00:00:03,500 --> 00:00:04,040\nFollow Pulse/);
  assert.match(captions, /00:00:04,040 --> 00:00:04,480\nGaming/);
  assert.doesNotMatch(captions, /Hades II just/);
  assert.doesNotMatch(captions, /Paul Skaming|00:00:00,000 --> 00:00:01,000\nForza/);
  const captionManifest = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));
  assert.equal(captionManifest.timing_source, "word_timestamps");
  assert.equal(plan.scheduler_bridge.candidates[0].caption_path, path.join(artifactDir, "captions.srt"));
});

test("production cutover requeues final renders when SFX evidence is newer than the MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-sfx-"));
  const storyPackage = await makeCutoverPackage(root, "stale-sfx-final", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const clipPath = path.join(artifactDir, "official-motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(3000, 4));
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `official-motion-${index + 1}`,
    path: clipPath,
    source_url: `https://cdn.example.test/stale-sfx-final/official-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `official_family_${index + 1}`,
    media_kind: "direct_video",
    commercial_use_allowed: true,
    risk_score: 0.1,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-sfx-final",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
    generated_at: "2026-05-23T20:00:00.000Z",
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    generated_at: "2026-05-23T20:30:00.000Z",
    cue_count: 1,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [
        {
          asset_id: "subtle-source-lock-click",
          role: "ui_tick",
          provider_id: "sonniss",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
        },
      ],
    },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:35:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("sfx_manifest_newer_than_render"));
});

test("production cutover requeues final renders when renderer mix policies are stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-render-policy-"));
  const storyPackage = await makeCutoverPackage(root, "stale-policy-final", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    sfxMixPolicyVersion: "legacy_placeholder_sfx_v1",
    voiceMixPolicyVersion: "legacy_voice_chain_v1",
    visualDesignPolicyVersion: "legacy_flat_cards_v1",
  });
  const artifactDir = storyPackage.artifact_dir;
  const clipPath = path.join(artifactDir, "official-motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(3000, 4));
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `official-motion-${index + 1}`,
    path: clipPath,
    source_url: `https://cdn.example.test/stale-policy-final/official-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `official_family_${index + 1}`,
    media_kind: "direct_video",
    commercial_use_allowed: true,
    risk_score: 0.1,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:45:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("sfx_mix_policy_stale"));
  assert.ok(plan.queue[0].blockers.includes("voice_mix_policy_stale"));
  assert.ok(plan.queue[0].blockers.includes("visual_design_policy_stale"));
});

test("production cutover requeues duration-repaired final renders until the MP4 is regenerated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-duration-"));
  const storyPackage = await makeCutoverPackage(root, "stale-duration-final", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      duration_variant_repaired_at: "2026-05-23T20:15:00.000Z",
    },
    { spaces: 2 },
  );
  const renderPath = path.join(artifactDir, "render_manifest.json");
  const render = await fs.readJson(renderPath);
  await fs.writeJson(
    renderPath,
    {
      ...render,
      generated_at: "2026-05-23T20:10:00.000Z",
    },
    { spaces: 2 },
  );

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:20:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("duration_variant_newer_than_render"));
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
});

test("production cutover bridge keeps canonical article source type over stale live reddit metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-source-type-"));
  const storyPackage = await makeCutoverPackage(root, "article-source-ready", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    primarySource: "Insider Gaming",
    sourceType: "reddit",
    primarySourceUrl: "https://insider-gaming.com/forza-horizon-6-has-made-over-140-million-from-premium-edition/",
  });
  const artifactDir = storyPackage.artifact_dir;
  const clipPath = path.join(artifactDir, "official-motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(3000, 4));
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `article-motion-${index + 1}`,
    path: clipPath,
    source_url: `https://cdn.example.test/article-source-ready/official-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    source_family: `article_source_family_${index + 1}`,
    media_kind: "direct_video",
    commercial_use_allowed: true,
    risk_score: 0.1,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_source_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:12:00.000Z",
  });

  assert.equal(plan.scheduler_bridge.candidate_count, 1);
  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.source_type, "rss");
  assert.equal(candidate.source_name, "Insider Gaming");
  assert.equal(candidate.subreddit, null);
  assert.equal(candidate.url, "https://insider-gaming.com/forza-horizon-6-has-made-over-140-million-from-premium-edition/");
  assert.equal(candidate.article_url, "https://insider-gaming.com/forza-horizon-6-has-made-over-140-million-from-premium-edition/");
});

test("production cutover blocks scheduler bridge candidates without governed SFX evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-missing-sfx-"));
  const storyPackage = await makeCutoverPackage(root, "missing-sfx-ready", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  await fs.remove(path.join(storyPackage.artifact_dir, "sfx_manifest.json"));

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:15:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.blocked_count, 1);
  assert.ok(plan.blocked[0].blockers.includes("missing_input:sfx_manifest.json"));
  assert.equal(plan.scheduler_bridge.candidate_count, 0);
});

test("production cutover does not queue generated card decks as final render input ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-generated-queue-"));
  const storyPackage = await makeCutoverPackage(root, "generated-queued-proof");
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "PlayStation", start: 0, end: 0.4 }] });
  const generatedClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "generated-motion", `card-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    generatedClips.push({
      id: `generated-card-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/generated-queued-proof/${index}`,
      source_type: "internally_generated_motion_graphic",
      rights_risk_class: "owned_generated_motion",
      source_family: `orange_card_${index}`,
      durationS: 2.8,
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: generatedClips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: generatedClips.map((clip) => ({
      ...clip,
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T15:00:00.000Z",
  });

  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.ok(plan.queue[0].render_input_blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(plan.queue[0].render_input_blockers.includes("real_visual_motion_clips_missing"));
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 5);
  assert.equal(plan.queue[0].render_input_evidence.real_visual_motion_clip_count, 0);
});

test("production cutover accepts explicit owned explainer motion for non-game source-card stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-owned-explainer-"));
  const storyPackage = await makeCutoverPackage(root, "owned-explainer-ready", {
    subject: "Kadokawa",
    title: "Kadokawa Stake Just Passed Sony",
    primarySource: "Automaton West",
    primarySourceUrl:
      "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Kadokawa", start: 0, end: 0.4 }] });
  const generatedClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "generated-motion", `explainer-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    generatedClips.push({
      id: `owned-explainer-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/owned-explainer-ready/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      source_family: `owned_explainer_family_${index}`,
      durationS: 2.8,
      validated: true,
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: generatedClips,
    materialised_clips: generatedClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: generatedClips,
      production_motion_clips: generatedClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      ...generatedClips.map((clip) => ({
        ...clip,
        asset_type: "owned_generated_motion_graphic",
        licence_basis: "owned_generated_editorial_motion_graphic",
        commercial_use_allowed: true,
        approval_status: "approved_for_transformative_editorial_use",
        evidence_reference: "owned_explainer_visual_plan",
        risk_score: 0.01,
      })),
      {
        asset_id: "automaton-kadokawa-source-lock",
        asset_type: "source_card_reference",
        source_url:
          "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
        source_owner: "Automaton West",
        source_type: "official_editorial_source_card",
        source_family: "automaton_west_kadokawa_oasis",
        licence_basis: "source_citation_transformative_reference",
        commercial_use_allowed: true,
        approval_status: "approved_for_source_lock_reference",
        risk_score: 0.05,
      },
      {
        asset_id: "kadokawa-corporate-source-lock",
        asset_type: "source_card_reference",
        source_url: "https://group.kadokawa.co.jp/global/",
        source_owner: "Kadokawa",
        source_type: "official_corporate_source_card",
        source_family: "kadokawa_corporate_site",
        licence_basis: "source_citation_transformative_reference",
        commercial_use_allowed: true,
        approval_status: "approved_for_source_lock_reference",
        risk_score: 0.05,
      },
    ],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T05:10:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.final_render_input_ready_count, 1);
  assert.equal(plan.summary.final_render_input_blocked_count, 0);
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.deepEqual(plan.queue[0].render_input_blockers, []);
  assert.equal(plan.queue[0].render_input_evidence.owned_explainer_motion_ready, true);
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 5);
  assert.equal(plan.queue[0].render_input_evidence.real_visual_motion_clip_count, 0);

  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "owned-explainer-ready",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 42,
  });

  const finalPlan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T05:20:00.000Z",
  });

  assert.equal(finalPlan.summary.ready_final_render_count, 1);
  assert.equal(finalPlan.summary.queued_final_render_count, 0);
  assert.equal(finalPlan.ready[0].status, "ready_for_dry_run_publish");
  assert.equal(finalPlan.ready[0].owned_explainer_motion_ready, true);
  assert.equal(finalPlan.ready[0].owned_explainer_exception_approved, true);
  assert.equal(finalPlan.scheduler_bridge.candidate_count, 1);
  assert.equal(finalPlan.scheduler_bridge.candidates[0].owned_explainer_motion_ready, true);
  assert.equal(
    finalPlan.scheduler_bridge.candidates[0].owned_explainer_motion_exception_approved,
    true,
  );
});

test("production cutover refuses final renders built from stale materialised motion clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-motion-"));
  const storyPackage = await makeCutoverPackage(root, "stale-owned-motion", {
    subject: "Nintendo",
    title: "Nintendo Professor Lawsuit Just Got Weird",
    primarySource: "Dexerto",
    primarySourceUrl: "https://www.dexerto.com/pokemon/man-sues-nintendo-for-denying-him-pokemon-professor-status-3366241/",
  });
  const artifactDir = storyPackage.artifact_dir;
  const staleDate = new Date("2026-05-24T05:00:00.000Z");
  const repairDate = "2026-05-25T06:04:35.000Z";
  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    ...canonical,
    public_copy_repaired_at: "2026-05-25T05:33:04.000Z",
    duration_variant_repaired_at: repairDate,
  });

  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Nintendo", start: 0, end: 0.4 }] });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });

  const generatedClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "generated-motion", `legacy-orange-card-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    await fs.utimes(clipPath, staleDate, staleDate);
    generatedClips.push({
      id: `stale-owned-motion-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/stale-owned-motion/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      source_family: `stale_owned_family_${index}`,
      durationS: 2.8,
      validated: true,
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: generatedClips,
    materialised_clips: generatedClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: generatedClips,
      production_motion_clips: generatedClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: generatedClips.map((clip) => ({
      ...clip,
      asset_type: "owned_generated_motion_graphic",
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: 0.01,
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-owned-motion",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 42,
    generated_at: "2026-05-25T06:10:00.000Z",
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T06:12:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].blockers.includes("materialised_motion_stale_after_duration_variant_repair"));
  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.ok(
    plan.queue[0].render_input_blockers.includes("materialised_motion_stale_after_duration_variant_repair"),
  );
  assert.deepEqual(
    plan.queue[0].render_input_evidence.stale_materialised_motion_clip_paths.sort(),
    generatedClips.map((clip) => clip.path).sort(),
  );
});

test("production cutover requeues final renders when materialised motion is newer than the MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-motion-newer-"));
  const storyPackage = await makeCutoverPackage(root, "motion-newer-than-render", {
    subject: "Pokémon Go",
    title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    primarySource: "Eurogamer",
    primarySourceUrl: "https://www.eurogamer.net/pokemon-go-mega-mewtwo-story",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Pokémon", start: 0, end: 0.4 }] });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });

  const generatedClips = [];
  const freshDate = new Date("2026-05-25T06:30:00.000Z");
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "generated-motion", `refreshed-card-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    await fs.utimes(clipPath, freshDate, freshDate);
    generatedClips.push({
      id: `fresh-owned-motion-${index}`,
      path: clipPath,
      source_url: `local://pulse-generated-motion/motion-newer-than-render/${index}`,
      source_type: "internally_generated_motion_graphic",
      media_kind: "owned_explainer_motion",
      rights_risk_class: "owned_generated_motion",
      source_family: `fresh_owned_family_${index}`,
      durationS: 2.8,
      validated: true,
      counts_towards_motion_readiness: true,
      owned_explainer_visual_plan: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clip_count: 5,
    distinct_motion_family_count: 5,
    clips: generatedClips,
    materialised_clips: generatedClips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: generatedClips,
      production_motion_clips: generatedClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: generatedClips.map((clip) => ({
      ...clip,
      asset_type: "owned_generated_motion_graphic",
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: 0.01,
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "motion-newer-than-render",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 43,
    generated_at: "2026-05-25T06:10:00.000Z",
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T06:35:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].blockers.includes("materialised_motion_newer_than_render"));
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 5);
});

test("production cutover explains missing final-render inputs on queued proof items", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-inputs-missing-"));
  const storyPackage = await makeCutoverPackage(root, "missing-input-story");
  const artifactDir = storyPackage.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: "missing-input-story",
    narration_audio_path: null,
    word_timestamps_path: null,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "missing-input-story",
    motion_inventory: {
      accepted_local_clips: [
        {
          id: "motion-01",
          path: path.join(artifactDir, "missing-motion.mp4"),
          validated: true,
          source_family: "missing-input-story_hook_slam",
        },
      ],
    },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:10:00.000Z",
  });

  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.ok(plan.queue[0].render_input_blockers.includes("final_narration_audio_missing"));
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_missing"));
  assert.ok(plan.queue[0].render_input_blockers.includes("materialised_motion_clips_missing"));
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 0);
});

test("production cutover marks queued proof item ready for a final render job when inputs exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-inputs-ready-"));
  const storyPackage = await makeCutoverPackage(root, "input-ready-story");
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Forza", start: 0, end: 0.4 },
      { word: "moves", start: 0.4, end: 0.8 },
    ],
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `input-ready-story_family_${index}`,
      source_url: `https://cdn.example.test/input-ready-story/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
      durationS: 2.8,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: "input-ready-story",
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: "input-ready-story",
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:15:00.000Z",
  });

  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.equal(plan.summary.final_render_input_ready_count, 1);
  assert.equal(plan.summary.final_render_input_blocked_count, 0);
  assert.deepEqual(plan.queue[0].render_input_blockers, []);
  assert.equal(plan.queue[0].render_input_evidence.narration_audio_path, audioPath);
  assert.equal(plan.queue[0].render_input_evidence.word_timestamps_path, timestampsPath);
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 5);
});

test("production cutover prefers fresh MEDIA_ROOT audio over stale workspace legacy paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-media-root-audio-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-media-root-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const storyPackage = await makeCutoverPackage(root, "media-root-audio-story");
    const artifactDir = storyPackage.artifact_dir;
    await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
      story_id: "media-root-audio-story",
      canonical_subject: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. IGN reports the Steam launch is drawing heavy attention. If Steam is where Forza takes off, Xbox has a different launch story on its hands.",
      description: "Forza Horizon 6 is drawing heavy Steam attention. Source: IGN.",
      primary_source: "IGN",
      source_card_label: "IGN",
      public_copy_repaired_at: "2026-05-22T09:00:00.000Z",
    });
    const workspaceAudioPath = path.join(root, "output", "audio", "media-root-audio-story.mp3");
    const workspaceTimestampPath = path.join(root, "output", "audio", "media-root-audio-story_timestamps.json");
    const mediaAudioPath = path.join(mediaRoot, "output", "audio", "media-root-audio-story.mp3");
    const mediaTimestampPath = path.join(mediaRoot, "output", "audio", "media-root-audio-story_timestamps.json");
    await fs.outputFile(workspaceAudioPath, Buffer.alloc(4000, 1));
    await fs.outputJson(workspaceTimestampPath, {
      words: [{ word: "Old", start: 0, end: 0.2 }],
    });
    await fs.utimes(workspaceAudioPath, new Date("2026-05-22T08:30:00.000Z"), new Date("2026-05-22T08:30:00.000Z"));
    await fs.utimes(workspaceTimestampPath, new Date("2026-05-22T08:30:00.000Z"), new Date("2026-05-22T08:30:00.000Z"));
    await fs.outputFile(mediaAudioPath, Buffer.alloc(5000, 2));
    await fs.outputJson(mediaTimestampPath, {
      words: [{ word: "Fresh", start: 0, end: 0.2 }],
    });
    await fs.utimes(mediaAudioPath, new Date("2026-05-22T09:05:00.000Z"), new Date("2026-05-22T09:05:00.000Z"));
    await fs.utimes(mediaTimestampPath, new Date("2026-05-22T09:05:00.000Z"), new Date("2026-05-22T09:05:00.000Z"));
    const motionDir = path.join(artifactDir, "motion");
    const acceptedLocalClips = [];
    for (let index = 1; index <= 5; index += 1) {
      const clipPath = path.join(motionDir, `clip-${index}.mp4`);
      await fs.outputFile(clipPath, Buffer.alloc(3000, index));
      acceptedLocalClips.push({
        id: `motion-${index}`,
        path: clipPath,
        validated: true,
        source_family: `media-root-audio-story_family_${index}`,
        source_url: `https://cdn.example.test/media-root-audio-story/${index}.mp4`,
        source_type: "official_trailer_segment",
        rights_risk_class: "official_reference_only",
      });
    }
    await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
      narration_audio_path: workspaceAudioPath,
      word_timestamps_path: workspaceTimestampPath,
    });
    await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
      motion_inventory: { accepted_local_clips: acceptedLocalClips },
    });

    const plan = await buildProductionRenderCutoverPlan({
      storyPackages: [storyPackage],
      generatedAt: "2026-05-22T09:10:00.000Z",
    });

    assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
    assert.deepEqual(plan.queue[0].render_input_blockers, []);
    assert.equal(plan.queue[0].render_input_evidence.narration_audio_path, mediaAudioPath);
    assert.equal(plan.queue[0].render_input_evidence.word_timestamps_path, mediaTimestampPath);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("production cutover uses standard output audio paths when the audio manifest is sparse", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-standard-audio-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-standard-media-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const storyPackage = await makeCutoverPackage(root, "standard-audio-story");
    const artifactDir = storyPackage.artifact_dir;
    await fs.outputFile(path.join(mediaRoot, "output", "audio", "standard-audio-story.mp3"), Buffer.alloc(5000, 2));
    await fs.outputJson(path.join(mediaRoot, "output", "audio", "standard-audio-story_timestamps.json"), {
      words: [{ word: "Forza", start: 0, end: 0.4 }],
    });
    const motionDir = path.join(artifactDir, "motion");
    const acceptedLocalClips = [];
    for (let index = 1; index <= 5; index += 1) {
      const clipPath = path.join(motionDir, `clip-${index}.mp4`);
      await fs.outputFile(clipPath, Buffer.alloc(3000, index));
      acceptedLocalClips.push({
        id: `motion-${index}`,
        path: clipPath,
        validated: true,
        source_family: `standard-audio-story_family_${index}`,
        source_url: `https://cdn.example.test/standard-audio-story/${index}.mp4`,
        source_type: "official_trailer_segment",
        rights_risk_class: "official_reference_only",
      });
    }
    await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
      story_id: "standard-audio-story",
      voice_status: "materialized",
    });
    await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
      motion_inventory: { accepted_local_clips: acceptedLocalClips },
    });

    const plan = await buildProductionRenderCutoverPlan({
      storyPackages: [storyPackage],
      generatedAt: "2026-05-22T09:12:00.000Z",
    });

    assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
    assert.equal(
      plan.queue[0].render_input_evidence.narration_audio_path,
      path.join(mediaRoot, "output", "audio", "standard-audio-story.mp3"),
    );
    assert.equal(
      plan.queue[0].render_input_evidence.word_timestamps_path,
      path.join(mediaRoot, "output", "audio", "standard-audio-story_timestamps.json"),
    );
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("production cutover blocks local TTS timestamps that are not ASR aligned", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-local-asr-required-"));
  const storyPackage = await makeCutoverPackage(root, "local-asr-required", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "word_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Forza", start: 0, end: 0.3 },
      { word: "changed", start: 0.34, end: 0.72 },
      { word: "everything", start: 0.76, end: 1.2 },
    ],
    meta: { wordTimestampSource: "local_audio_silence_anchored" },
  });
  const clips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "motion", `official-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    clips.push({
      id: `official-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/local-asr-required/official-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: `official_family_${index}`,
      rights_risk_class: "official_reference_transformative_short",
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
    voice_provider: "local_tts",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips, production_motion_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_reference_transformative_short",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T10:10:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_not_asr_aligned"));
  assert.equal(
    plan.queue[0].render_input_evidence.word_timestamp_source,
    "local_audio_silence_anchored",
  );
});

test("production cutover requeues final renders when public copy is newer than the render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-copy-"));
  const storyPackage = await makeCutoverPackage(root, "stale-final-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "stale-final-story",
    canonical_subject: "Lego Batman",
    selected_title: "Lego Batman Is Packed With Deep Cuts",
    first_spoken_line: "Lego Batman is packed with deep cuts for Arkham fans.",
    narration_script:
      "Lego Batman is packed with deep cuts for Arkham fans. GameSpot reports the production detail and the player question is whether it turns into a stronger Batman game.",
    description: "Lego Batman is packed with Arkham-era references. Source: GameSpot.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
    public_copy_repaired_at: "2026-05-22T09:00:00.000Z",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-final-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    generated_at: "2026-05-22T08:30:00.000Z",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [{ word: "Lego", start: 0, end: 0.4 }],
  });
  const staleTime = new Date("2026-05-22T08:45:00.000Z");
  await fs.utimes(audioPath, staleTime, staleTime);
  await fs.utimes(timestampsPath, staleTime, staleTime);
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `stale-final-story_family_${index}`,
      source_url: `https://cdn.example.test/stale-final-story/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T09:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].blockers.includes("public_copy_newer_than_render"));
  assert.equal(plan.queue[0].force_final_render, true);
  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.ok(plan.queue[0].render_input_blockers.includes("final_narration_audio_stale_after_public_copy_repair"));
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_stale_after_public_copy_repair"));
  assert.equal(plan.queue[0].render_input_evidence.public_copy_repaired_at, "2026-05-22T09:00:00.000Z");
});

test("production cutover requeues final renders when render-side transcript is stale bad public copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-render-transcript-"));
  const storyPackage = await makeCutoverPackage(root, "stale-render-transcript", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "stale-render-transcript",
    canonical_subject: "Warhammer 40,000: Boltgun 2",
    selected_title: "Boltgun 2 Leaves The Corridors",
    first_spoken_line: "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces.",
    narration_script:
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces. IGN says the sequel moves the retro shooter into wider arenas. Those spaces need to make the sequel feel less boxed in, not just louder. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces. IGN says the sequel moves the retro shooter into wider arenas. Those spaces need to make the sequel feel less boxed in, not just louder. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces. IGN says the sequel moves the retro shooter into wider arenas. Those spaces need to make the sequel feel less boxed in, not just louder. Follow Pulse Gaming so you never miss a beat.",
    description: "Warhammer 40,000: Boltgun 2 is moving into bigger arenas. Source: IGN.",
    primary_source: "IGN",
    source_card_label: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    story_id: "stale-render-transcript",
    full_script:
      "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. IGN is the source for the confirmed claim. Boltgun 2 stays a gaming story because it changes what players check around the game, platform or launch window. Before you spend, check the live price, the platform listing and whether the deal is still active.",
    tts_script:
      "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. IGN is the source for the confirmed claim. Boltgun 2 stays a gaming story because it changes what players check around the game, platform or launch window. Before you spend, check the live price, the platform listing and whether the deal is still active.",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-render-transcript",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
    generated_at: "2026-05-24T12:00:00.000Z",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [{ word: "Warhammer", start: 0, end: 0.4 }],
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `stale-render-transcript_family_${index}`,
      source_url: `https://cdn.example.test/stale-render-transcript/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T12:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].blockers.includes("render_story_transcript_diverges_from_canonical"));
  assert.ok(plan.queue[0].blockers.includes("render_story_public_copy_failed"));
  assert.equal(plan.queue[0].force_final_render, true);
});

test("production cutover requeues final renders when duration repair is newer than audio inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-duration-audio-"));
  const storyPackage = await makeCutoverPackage(root, "stale-duration-audio-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "stale-duration-audio-story",
    canonical_subject: "Hades II",
    selected_title: "Hades II Finally Has A Console Date",
    duration_variant_repaired_at: "2026-05-22T10:00:00.000Z",
    narration_script: "Hades II finally has a console date players can plan around.",
    first_spoken_line: "Hades II finally has a console date players can plan around.",
    description: "Hades II finally has a console date. Source: Xbox.",
    primary_source: "Xbox",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-duration-audio-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    generated_at: "2026-05-22T09:30:00.000Z",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [{ word: "Hades", start: 0, end: 0.4 }],
  });
  const staleTime = new Date("2026-05-22T09:55:00.000Z");
  await fs.utimes(audioPath, staleTime, staleTime);
  await fs.utimes(timestampsPath, staleTime, staleTime);
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `stale-duration-family-${index}`,
      source_url: `https://cdn.example.test/hades/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T10:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.ok(plan.queue[0].blockers.includes("duration_variant_newer_than_render"));
  assert.equal(plan.queue[0].force_final_render, true);
  assert.equal(plan.queue[0].render_input_status, "blocked");
  assert.ok(plan.queue[0].render_input_blockers.includes("final_narration_audio_stale_after_duration_variant_repair"));
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_stale_after_duration_variant_repair"));
  assert.equal(plan.queue[0].render_input_evidence.duration_variant_repaired_at, "2026-05-22T10:00:00.000Z");
});

test("production cutover requeues final renders when TTS pronunciation policy makes audio stale", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-pronunciation-audio-"));
  const storyPackage = await makeCutoverPackage(root, "stale-pronunciation-audio-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Hades II",
    title: "Hades II Finally Has A Console Date",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "stale-pronunciation-audio-story",
    canonical_subject: "Hades II",
    selected_title: "Hades II Finally Has A Console Date",
    narration_script: "Hades II finally has a console date players can plan around.",
    first_spoken_line: "Hades II finally has a console date players can plan around.",
    description: "Hades II finally has a console date. Source: Xbox.",
    primary_source: "Xbox",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-pronunciation-audio-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.4 },
      { word: "number", start: 0.4, end: 0.55 },
      { word: "two", start: 0.55, end: 0.7 },
    ],
    meta: {
      transcript: "Hades, number two finally has a console date players can plan around.",
    },
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `stale-pronunciation-family-${index}`,
      source_url: `https://cdn.example.test/hades-pronunciation/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T07:55:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].render_input_blockers.includes("final_narration_audio_stale_after_pronunciation_repair"));
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_stale_after_pronunciation_repair"));
  assert.equal(plan.queue[0].render_input_evidence.tts_pronunciation_expected_transcript, "Hades sequel finally has a console date players can plan around.");
});

test("production cutover requeues final renders when ASR word timestamps contain semantic misrecognitions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-asr-semantic-drift-"));
  const storyPackage = await makeCutoverPackage(root, "asr-semantic-drift-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Hades II",
    title: "Hades II Just Broke PlayStation's Silence",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  const script =
    "Hades II just put PlayStation and Xbox players on the same April countdown. If the port lands crisp, both console communities get the same obsession at once. Follow Pulse Gaming so you never miss a beat.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "asr-semantic-drift-story",
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    narration_script: script,
    first_spoken_line: "Hades II just put PlayStation and Xbox players on the same April countdown.",
    description: "Xbox listed Hades II for Xbox and PlayStation. Source: Xbox.",
    primary_source: "Xbox",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "asr-semantic-drift-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.32 },
      { word: "number", start: 0.32, end: 0.54 },
      { word: "two", start: 0.54, end: 0.76 },
      { word: "just", start: 0.76, end: 0.94 },
      { word: "put", start: 0.94, end: 1.1 },
      { word: "PlayStation", start: 1.1, end: 1.52 },
      { word: "and", start: 1.52, end: 1.68 },
      { word: "Xbox", start: 1.68, end: 2.02 },
      { word: "players", start: 2.02, end: 2.36 },
      { word: "on", start: 2.36, end: 2.5 },
      { word: "the", start: 2.5, end: 2.62 },
      { word: "same", start: 2.62, end: 2.86 },
      { word: "April", start: 2.86, end: 3.16 },
      { word: "countdown.", start: 3.16, end: 3.68 },
      { word: "If", start: 3.9, end: 4.02 },
      { word: "the", start: 4.02, end: 4.14 },
      { word: "Portland's", start: 4.14, end: 4.56 },
      { word: "crisp,", start: 4.56, end: 4.9 },
      { word: "both", start: 4.9, end: 5.12 },
      { word: "console", start: 5.12, end: 5.42 },
      { word: "communities", start: 5.42, end: 5.94 },
      { word: "get", start: 5.94, end: 6.12 },
      { word: "the", start: 6.12, end: 6.24 },
      { word: "same", start: 6.24, end: 6.48 },
      { word: "obsession", start: 6.48, end: 6.9 },
      { word: "at", start: 6.9, end: 7.04 },
      { word: "once.", start: 7.04, end: 7.3 },
      { word: "Follow", start: 7.5, end: 7.82 },
      { word: "Pulse", start: 7.82, end: 8.1 },
      { word: "Gaming", start: 8.1, end: 8.46 },
    ],
    meta: {
      transcript: "Hades number two just put PlayStation and Xbox players on the same April countdown. If the port lands crisp, both console communities get the same obsession at once. Follow Pulse Gaming so you never miss a beat.",
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
    },
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `asr-semantic-family-${index}`,
      source_url: `https://cdn.example.test/asr-semantic/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
    voice_provider: "local_tts",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T09:15:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_semantic_misrecognition"));
  assert.deepEqual(plan.queue[0].render_input_evidence.word_timestamp_semantic_misrecognitions, ["port_lands_as_portland"]);
});

test("production cutover requeues final renders when ASR word timestamp coverage is incomplete", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-asr-coverage-drift-"));
  const storyPackage = await makeCutoverPackage(root, "asr-coverage-drift-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Subnautica 2",
    title: "Subnautica 2 Reportedly Leaked Early",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  const script =
    "Subnautica 2 reportedly leaked before launch. Respawnfirst reports Subnautica 2 reportedly appeared online before launch. Rough leaked material can travel faster than the official build, and that is brutal for a sequel still trying to set its own tone. Follow Pulse Gaming so you never miss a beat.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "asr-coverage-drift-story",
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Reportedly Leaked Early",
    narration_script: script,
    first_spoken_line: "Subnautica 2 reportedly leaked before launch.",
    description: "Respawnfirst reports Subnautica 2 reportedly appeared online before launch. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "asr-coverage-drift-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Subnautica", start: 0, end: 0.34 },
      { word: "2", start: 0.34, end: 0.48 },
      { word: "reportedly", start: 0.48, end: 0.9 },
      { word: "leaked", start: 0.9, end: 1.18 },
      { word: "before", start: 1.18, end: 1.46 },
      { word: "launch.", start: 1.46, end: 1.78 },
      { word: "Respawn", start: 1.78, end: 2.12 },
    ],
    meta: {
      transcript: script,
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
    },
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `asr-coverage-family-${index}`,
      source_url: `https://cdn.example.test/asr-coverage/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
    voice_provider: "local_tts",
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T10:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.ok(plan.queue[0].render_input_blockers.includes("word_timestamps_asr_coverage_incomplete"));
  assert.equal(plan.queue[0].render_input_evidence.word_timestamp_coverage_ratio < 0.85, true);
});

test("production cutover does not requeue final renders for harmless dash and hyphen TTS normalisation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-pronunciation-punctuation-"));
  const storyPackage = await makeCutoverPackage(root, "punctuation-fresh-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Star Wars Zero Company",
    title: "Star Wars Zero Company Is More Than XCOM",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  const script =
    "Star Wars Zero Company is more than just 'Star Wars XCOM'—it feels like Mass Effect but with turn-based tactics.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "punctuation-fresh-story",
    canonical_subject: "Star Wars Zero Company",
    selected_title: "Star Wars Zero Company Is More Than XCOM",
    narration_script: script,
    first_spoken_line: "Star Wars Zero Company is more than Star Wars XCOM.",
    description: "PC Gamer previewed Star Wars Zero Company. Source: PC Gamer.",
    primary_source: "PC Gamer",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "punctuation-fresh-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output: "visual_v4_render.mp4",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Star", start: 0, end: 0.2 },
      { word: "Wars", start: 0.2, end: 0.4 },
    ],
    meta: {
      transcript:
        "Star Wars Zero Company is more than just 'Star Wars XCOM'—it feels like Mass Effect but with turn-based tactics.",
    },
  });
  const acceptedLocalClips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    acceptedLocalClips.push({
      id: `motion-${index}`,
      path: clipPath,
      validated: true,
      source_family: `punctuation-family-${index}`,
      source_url: `https://cdn.example.test/star-wars-punctuation/${index}.mp4`,
      source_type: "official_trailer_segment",
      rights_risk_class: "official_reference_only",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: acceptedLocalClips },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T07:56:00.000Z",
  });

  assert.equal(plan.summary.queued_final_render_count, 0);
  assert.equal(plan.summary.ready_final_render_count, 1);
  assert.equal(plan.validation_report[0].render_input_evidence.tts_pronunciation_expected_transcript, undefined);
});

test("production cutover requeues final renders when audio and timestamp fingerprints changed after render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-fingerprint-"));
  const storyPackage = await makeCutoverPackage(root, "stale-fingerprint-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Hades II",
    title: "Hades II Finally Has A Console Date",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  const oldAudio = Buffer.alloc(4000, 2);
  const oldTimestamps = Buffer.from(JSON.stringify({ words: [{ word: "Hades", start: 0, end: 0.4 }] }));
  await fs.outputFile(audioPath, oldAudio);
  await fs.outputFile(timestampsPath, oldTimestamps);
  const clips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(motionDir, `official-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    clips.push({
      id: `official-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/stale-fingerprint-story/official-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: `official_family_${index}`,
      rights_risk_class: "official_reference_transformative_short",
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips, production_motion_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_reference_transformative_short",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "stale-fingerprint-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 43.2,
    input_fingerprint: {
      algorithm: "sha256",
      audio_sha256: crypto.createHash("sha256").update(oldAudio).digest("hex"),
      word_timestamps_sha256: crypto.createHash("sha256").update(oldTimestamps).digest("hex"),
      audio_size_bytes: oldAudio.length,
      word_timestamps_size_bytes: oldTimestamps.length,
    },
  });

  await fs.outputFile(audioPath, Buffer.alloc(5000, 7));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.44 },
      { word: "two", start: 0.44, end: 0.78 },
    ],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-25T21:00:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.scheduler_bridge_candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("final_render_audio_fingerprint_mismatch"));
  assert.ok(plan.queue[0].blockers.includes("final_render_word_timestamps_fingerprint_mismatch"));
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.equal(plan.queue[0].render_input_evidence.audio_fingerprint_matches_render, false);
  assert.equal(plan.queue[0].render_input_evidence.word_timestamps_fingerprint_matches_render, false);
});

test("production cutover does not route stale final renders to source acquisition when selected render deck satisfies motion budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-selected-render-motion-ready-"));
  const storyPackage = await makeCutoverPackage(root, "selected-render-motion-ready", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Pokémon Go",
    title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const motionDir = path.join(artifactDir, "motion");
  const selectedDir = path.join(artifactDir, "selected-render");
  const oldAudio = Buffer.alloc(4000, 2);
  const oldTimestamps = Buffer.from(JSON.stringify({ words: [{ word: "Mega", start: 0, end: 0.4 }] }));
  await fs.outputFile(audioPath, oldAudio);
  await fs.outputFile(timestampsPath, oldTimestamps);

  const inventoryClips = [];
  for (let index = 1; index <= 13; index += 1) {
    const clipPath = path.join(motionDir, `clip-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    inventoryClips.push({
      id: `inventory-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/pokemon-go/inventory-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: `reused_family_${(index % 7) + 1}`,
      rights_risk_class: "official_reference_transformative_short",
      validated: true,
    });
  }

  const selectedRenderClips = [];
  for (let index = 1; index <= 13; index += 1) {
    const clipPath = path.join(selectedDir, `selected-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index + 20));
    selectedRenderClips.push({
      id: `selected-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/pokemon-go/selected-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: `selected_family_${index}`,
      rights_risk_class: "official_reference_transformative_short",
      validated: true,
    });
  }

  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      required_motion_scenes: 13,
      required_distinct_families: 13,
    },
    motion_inventory: {
      accepted_local_clips: inventoryClips,
      production_motion_clips: inventoryClips,
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [...inventoryClips, ...selectedRenderClips].map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_reference_transformative_short",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    selected_render_clips: selectedRenderClips,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "selected-render-motion-ready",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 43.2,
    input_fingerprint: {
      algorithm: "sha256",
      audio_sha256: crypto.createHash("sha256").update(oldAudio).digest("hex"),
      word_timestamps_sha256: crypto.createHash("sha256").update(oldTimestamps).digest("hex"),
      audio_size_bytes: oldAudio.length,
      word_timestamps_size_bytes: oldTimestamps.length,
    },
  });

  await fs.outputFile(audioPath, Buffer.alloc(5000, 7));
  await fs.outputJson(timestampsPath, {
    words: [
      { word: "Mega", start: 0, end: 0.36 },
      { word: "Mewtwo", start: 0.36, end: 0.82 },
    ],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T05:45:00.000Z",
  });

  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.ok(plan.queue[0].blockers.includes("final_render_word_timestamps_fingerprint_mismatch"));
  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.deepEqual(plan.queue[0].render_input_blockers, []);
  assert.equal(plan.queue[0].render_input_evidence.selected_render_input_motion_ready, true);
  assert.deepEqual(
    plan.queue[0].render_input_evidence.selected_render_input_motion_blockers_cleared.sort(),
    [
      "materialised_motion_families_insufficient",
      "real_visual_motion_families_insufficient",
    ].sort(),
  );
});

test("production cutover does not inflate materialised motion counts with duplicate paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-duplicate-motion-"));
  const storyPackage = await makeCutoverPackage(root, "duplicate-motion-story");
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  const clipPath = path.join(artifactDir, "motion", "clip.mp4");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Forza", start: 0, end: 0.4 }] });
  await fs.outputFile(clipPath, Buffer.alloc(3000, 3));
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      accepted_local_clips: [
        {
          id: "clip-a",
          path: clipPath,
          validated: true,
          source_family: "same_family",
          source_url: "https://cdn.example.test/duplicate-motion/clip.mp4",
          source_type: "official_trailer_segment",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    shot_budget: { min_actual_motion_clips: 1, min_distinct_motion_families: 1 },
    shot_plan: [
      {
        id: "shot-a",
        kind: "motion_clip",
        media_path: clipPath,
        source_family: "same_family",
        source_url: "https://cdn.example.test/duplicate-motion/clip.mp4",
        source_type: "official_trailer_segment",
        rights_risk_class: "official_reference_only",
      },
    ],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:16:00.000Z",
  });

  assert.equal(plan.queue[0].render_input_status, "ready_for_final_render_job");
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_count, 1);
  assert.equal(plan.queue[0].render_input_evidence.distinct_motion_family_count, 1);
  assert.equal(plan.queue[0].render_input_evidence.materialised_motion_clip_paths.length, 1);
});

test("production cutover validates final render provenance and benchmark floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-final-"));
  const ready = await makeCutoverPackage(root, "ready-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const weak = await makeCutoverPackage(root, "weak-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    polishScore: 60,
  });
  const fake = await makeCutoverPackage(root, "fake-story", {
    finalPublishRender: true,
    renderer: "visual_v4_local_proof",
    visualTier: "local_proof_motion_graphic",
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready, weak, fake],
    generatedAt: "2026-05-22T03:05:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 1);
  assert.equal(plan.ready[0].story_id, "ready-story");
  assert.equal(plan.ready[0].dry_run_publish_eligible, true);
  assert.equal(plan.summary.blocked_count, 2);
  assert.ok(plan.blocked.find((item) => item.story_id === "weak-story").blockers.includes("benchmark_below_production_threshold:media_house_polish_score"));
  assert.ok(plan.blocked.find((item) => item.story_id === "fake-story").blockers.includes("render_renderer_not_production"));
  assert.ok(plan.blocked.find((item) => item.story_id === "fake-story").blockers.includes("render_tier_not_production"));
});

test("production cutover requeues short final renders without retention-short approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-short-final-"));
  const storyPackage = await makeCutoverPackage(root, "short-final-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "short-final-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 24.4,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T21:20:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.queued_final_render_count, 1);
  assert.equal(plan.summary.scheduler_bridge_candidate_count, 0);
  assert.equal(plan.queue[0].status, "needs_final_render");
  assert.equal(plan.queue[0].force_final_render, true);
  assert.ok(plan.queue[0].blockers.includes("normal_production_duration_below_quality_floor:24"));
});

test("production cutover emits normal-duration repair work orders for short renders with ready inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-normal-workorder-"));
  const storyPackage = await makeCutoverPackage(root, "short-ready-inputs", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  const timestampsPath = path.join(artifactDir, "narration_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(timestampsPath, { words: [{ word: "Forza", start: 0, end: 0.3 }] });
  const clips = [];
  for (let index = 1; index <= 5; index += 1) {
    const clipPath = path.join(artifactDir, "motion", `official-${index}.mp4`);
    await fs.outputFile(clipPath, Buffer.alloc(3000, index));
    clips.push({
      id: `official-${index}`,
      path: clipPath,
      source_url: `https://cdn.example.test/short-ready-inputs/official-${index}.mp4`,
      source_type: "official_trailer_segment",
      media_kind: "direct_video",
      source_family: `official_family_${index}`,
      rights_risk_class: "official_reference_transformative_short",
      validated: true,
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: timestampsPath,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: { accepted_local_clips: clips, production_motion_clips: clips },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "motion_clip",
      licence_basis: "official_reference_transformative_short",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "short-ready-inputs",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 18.2,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T21:45:00.000Z",
  });

  assert.equal(plan.summary.normal_duration_repair_ready_count, 1);
  assert.equal(plan.normal_duration_rerender_work_order.jobs.length, 1);
  assert.equal(plan.normal_duration_rerender_work_order.jobs[0].story_id, "short-ready-inputs");
  assert.deepEqual(plan.normal_duration_rerender_work_order.jobs[0].target_duration_seconds, {
    min: 35,
    max: 59,
  });
  assert.equal(plan.normal_duration_rerender_work_order.jobs[0].status, "needs_duration_variant_rerender");
});

test("production cutover blocks bridge candidates with unsafe public-copy source attribution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-public-copy-"));
  const storyPackage = await makeCutoverPackage(root, "unsafe-public-copy", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "unsafe-public-copy",
    canonical_subject: "Valorant Vanguard",
    selected_title: "Valorant Vanguard Just Bricked Cheaters' PCs",
    first_spoken_line: "Valorant Vanguard just bricked cheaters' PCs after Riot's update.",
    narration_script:
      "Valorant Vanguard just bricked cheaters' PCs after Riot's update. IGN reports the key claim, while Reddit is only the discovery trail.",
    description: "Valorant Vanguard has a PC-breaking claim. Source: Reddit.",
    primary_source: { name: "Reddit", url: "https://www.reddit.com/r/pcgaming/comments/example" },
    discovery_source: { name: "Reddit", url: "https://www.reddit.com/r/pcgaming/comments/example" },
    secondary_sources: [{ name: "IGN", url: "https://www.ign.com/articles/valorant-vanguard-update" }],
    source_card_label: "Reddit",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "unsafe-public-copy",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 42.1,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T21:30:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 0);
  assert.equal(plan.summary.blocked_count, 1);
  assert.equal(plan.summary.scheduler_bridge_candidate_count, 0);
  assert.ok(plan.blocked[0].blockers.includes("public_copy:reddit_discovery_label_used_as_primary_source"));
});

test("production cutover blocks bad transcript copy before queuing a final render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-bad-transcript-"));
  const storyPackage = await makeCutoverPackage(root, "bad-transcript-pre-render", {
    finalPublishRender: false,
    renderer: "visual_v4_local_proof",
    visualTier: "local_proof",
  });
  const artifactDir = storyPackage.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "bad-transcript-pre-render",
    canonical_subject: "Nintendo Switch 2",
    selected_title: "Nintendo Switch 2 Just Got More Expensive",
    first_spoken_line: "Nintendo Switch 2 just got more expensive for players.",
    narration_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17. The real test is whether Nintendo Switch 2 changes play, not whether the patch note sounds bigger. A useful update should fix a real friction point, not just add a louder headline.",
    description: "Nintendo Switch 2 has a new accessory deal. Source: IGN.",
    primary_source: "IGN",
    source_card_label: "IGN",
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T13:10:00.000Z",
  });

  assert.equal(plan.summary.queued_final_render_count, 0);
  assert.equal(plan.summary.blocked_count, 1);
  assert.ok(plan.blocked[0].blockers.includes("public_copy:formulaic_public_narration"));
});

test("production cutover allows short final renders only with explicit retention-short approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-approved-short-"));
  const storyPackage = await makeCutoverPackage(root, "approved-short-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
  });
  const artifactDir = storyPackage.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "approved-short-story",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    narration_script:
      "Forza Horizon 6 exposes Xbox's Steam bet before launch. IGN reports the player-facing detail that changes the watchlist.",
    description: "Forza Horizon 6 changes the player watchlist. Source: IGN.",
    primary_source: "IGN",
    source_card_label: "IGN",
    retention_short_approved: true,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "approved-short-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 24.4,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T21:24:00.000Z",
  });

  assert.equal(plan.summary.ready_final_render_count, 1);
  assert.equal(plan.summary.scheduler_bridge_candidate_count, 1);
  assert.deepEqual(plan.ready[0].blockers, []);
  assert.equal(plan.scheduler_bridge.candidates[0].duration_seconds, 24.4);
});

test("production cutover emits scheduler bridge candidates for ready final renders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-bridge-"));
  const ready = await makeCutoverPackage(root, "bridge-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Forza Horizon 6",
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
  });
  const artifactDir = ready.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "bridge-story",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "Steam launch hit a new Xbox ceiling",
    primary_source: "SteamDB",
    primary_source_url: "https://steamdb.info/app/123456/charts/",
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    thumbnail_headline: "FORZA BROKE STEAM",
    narration_script:
      "Forza Horizon 6 just gave Xbox the Steam number it needed. SteamDB shows a huge launch peak. Follow Pulse Gaming so you never miss a beat.",
    description: "Hit a major Steam launch peak. Source: SteamDB.",
    pinned_comment: "Source: SteamDB.",
    source_card_label: "SteamDB",
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: path.join(artifactDir, "narration.mp3"),
    word_timestamps_path: path.join(artifactDir, "narration_timestamps.json"),
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), {
    story_id: "bridge-story",
    disclosure_required: true,
    primary_link: {
      id: "forza-racing-wheel",
      label: "Racing wheel",
      url: "https://www.amazon.co.uk/s?k=racing+wheel&tag=pulsegaming-21",
    },
    disclosure_copy: {
      short: "Affiliate links may earn us a commission.",
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    story_id: "bridge-story",
    disclosure_requirements: {
      affiliate: true,
      commercial: true,
      disclosure_text: "Affiliate links may earn us a commission.",
    },
    disclosure_text: "Affiliate links may earn us a commission.",
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    story_id: "bridge-story",
    disclosure_block: {
      required: true,
      short: "Affiliate links may earn us a commission.",
    },
  });
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), Buffer.alloc(4000, 2));
  await fs.outputJson(path.join(artifactDir, "narration_timestamps.json"), {
    words: [{ word: "Forza", start: 0, end: 0.3 }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "bridge-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 44.4,
    clips: 8,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: [
        {
          id: "bridge-story-motion",
          path: path.join(artifactDir, "source-clip.mp4"),
          source_url: "https://cdn.example.test/bridge-story/official-gameplay.mp4",
          source_type: "official_trailer_segment",
          source_family: "bridge-story-official-gameplay",
          rights_risk_class: "official_reference_only",
          rights_basis: "official_reference_transformative_short",
          counts_towards_motion_readiness: true,
          validated: true,
        },
      ],
    },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready],
    generatedAt: "2026-05-22T03:30:00.000Z",
  });

  assert.equal(plan.summary.scheduler_bridge_candidate_count, 1);
  assert.equal(plan.scheduler_bridge.status, "ready_for_dry_run_preflight");
  assert.equal(plan.scheduler_bridge.candidates.length, 1);
  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.id, "bridge-story");
  assert.equal(candidate.approved, true);
  assert.equal(candidate.auto_approved, true);
  assert.equal(candidate.render_lane, "visual_v4_production");
  assert.equal(candidate.render_quality_class, "premium");
  assert.equal(candidate.allow_retention_short_video, true);
  assert.equal(candidate.duration_lane, "pulse_retention_short");
  assert.equal(candidate.duration_seconds, 44.4);
  assert.equal(candidate.qa_visual_count, 8);
  assert.equal(candidate.visual_quality_report.result, "pass");
  assert.equal(candidate.media_house_benchmark.result, "pass");
  assert.equal(candidate.benchmark_report.result, "pass");
  assert.equal(candidate.manual_caption_generated, true);
  assert.equal(candidate.clean_manual_captions, true);
  assert.ok(candidate.exported_path.endsWith("visual_v4_render.mp4"));
  assert.ok(Array.isArray(candidate.rights_ledger));
  assert.equal(candidate.affiliate_link_manifest.disclosure_required, true);
  assert.match(candidate.affiliate_url, /amazon\.co\.uk/);
  assert.equal(candidate.affiliate_links.length, 1);
  assert.match(candidate.affiliate_disclosure, /Affiliate links may earn us a commission/);
  assert.equal(candidate.platform_policy_report.disclosure_requirements.affiliate, true);
  assert.equal(candidate.landing_page_manifest.disclosure_block.required, true);
  assert.ok(Array.isArray(candidate.video_clips));
  assert.equal(candidate.video_clips.length, 1);
  assert.equal(candidate.video_clips[0].source_url, "https://cdn.example.test/bridge-story/official-gameplay.mp4");
  assert.equal(candidate.video_clips[0].source_type, "official_trailer_segment");
  assert.equal(candidate.video_clips[0].rights_risk_class, "official_reference_only");
  assert.equal(candidate.footage_inventory.motion_inventory.production_motion_clips.length, 1);
  assert.match(candidate.description, /Forza Horizon 6/);
  assert.match(candidate.description, /SteamDB/);
});

test("production cutover preserves normal production duration lane in bridge candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-normal-duration-"));
  const ready = await makeCutoverPackage(root, "normal-duration-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Star Fox",
    title: "Star Fox Just Got A Switch 2 Route",
  });
  const artifactDir = ready.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "normal-duration-story",
    canonical_subject: "Star Fox",
    canonical_game: "Star Fox",
    canonical_angle: "Switch 2 camera support changed the practical route",
    primary_source: "Nintendo",
    selected_title: "Star Fox Just Got A Switch 2 Route",
    thumbnail_headline: "STAR FOX SWITCH 2",
    narration_script:
      "Star Fox just got a Switch 2 camera route. Nintendo listed the detail, and the player decision is whether it changes your setup.",
    description: "Star Fox has a Switch 2 camera route. Source: Nintendo.",
    source_card_label: "Nintendo",
    duration_variant_repair_strategy: "normal_production_safe_script_expansion",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    duration_lane: "normal_production",
    duration_contract_strategy: "normal_production_safe_script_expansion",
    outputs: { youtube_shorts: { duration_seconds: { min: 35, max: 60 } } },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: path.join(artifactDir, "narration.mp3"),
    word_timestamps_path: path.join(artifactDir, "narration_timestamps.json"),
  });
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), Buffer.alloc(4000, 2));
  await fs.outputJson(path.join(artifactDir, "narration_timestamps.json"), {
    words: [{ word: "Star", start: 0, end: 0.3 }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "normal-duration-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 46.4,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready],
    generatedAt: "2026-05-22T10:30:00.000Z",
  });

  assert.equal(plan.summary.scheduler_bridge_candidate_count, 1);
  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.duration_lane, "normal_production");
  assert.equal(candidate.allow_retention_short_video, false);
  assert.equal(candidate.affiliate_url, null);
  assert.deepEqual(candidate.affiliate_links, []);
  assert.equal(candidate.min_video_duration_seconds, 35);
  assert.equal(candidate.duration_seconds, 46.4);
});

test("production cutover exposes the actual selected render deck to scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-render-deck-"));
  const ready = await makeCutoverPackage(root, "selected-render-deck", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Deathmaster",
    title: "Deathmaster Brings Stealth To Consoles",
  });
  const artifactDir = ready.artifact_dir;
  const selectedClips = Array.from({ length: 8 }, (_, index) => ({
    id: `selected-render-deck-clip-${index + 1}`,
    path: path.join(artifactDir, `selected-render-deck-clip-${index + 1}.mp4`),
    source_url: index < 5
      ? `https://video.akamai.steamstatic.com/store_trailers/deathmaster-${index + 1}.mp4`
      : `local://pulse-generated-motion/selected-render-deck/${index + 1}`,
    source_type: index < 5 ? "official_trailer_segment" : "internally_generated_motion_graphic",
    media_kind: index < 5 ? "direct_video" : "owned_generated_motion",
    source_url_kind: index < 5 ? "direct_video" : "owned_generated_motion",
    source_family: index < 5 ? `official_trailer_${index + 1}` : `owned_motion_${index + 1}`,
    rights_risk_class: index < 5 ? "official_reference_transformative_short" : "owned_generated_motion",
  }));
  for (const clip of selectedClips) {
    await fs.outputFile(clip.path, Buffer.alloc(3000, 3));
  }
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "selected-render-deck",
    canonical_subject: "Warhammer Age Of Sigmar: Deathmaster",
    canonical_game: "Warhammer Age Of Sigmar: Deathmaster",
    primary_source: "GameSpot",
    selected_title: "Deathmaster Brings Stealth To Consoles",
    thumbnail_headline: "DEATHMASTER ON CONSOLES",
    first_spoken_line: "Deathmaster brings stealth to consoles next year.",
    narration_script:
      "Deathmaster brings stealth to consoles next year. GameSpot reports the launch window and the player decision is whether this belongs on the wishlist.",
    description: "Deathmaster is coming to consoles. Source: GameSpot.",
    source_card_label: "GameSpot",
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: path.join(artifactDir, "narration.mp3"),
    word_timestamps_path: path.join(artifactDir, "narration_timestamps.json"),
  });
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), Buffer.alloc(4000, 2));
  await fs.outputJson(path.join(artifactDir, "narration_timestamps.json"), {
    words: [{ word: "Deathmaster", start: 0, end: 0.3 }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "selected-render-deck",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 46.579,
    clips: 8,
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    story_id: "selected-render-deck",
    visual_v4_bridge_video_clips: selectedClips,
    video_clips: selectedClips.map((clip) => clip.path),
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_inventory: {
      production_motion_clips: selectedClips.slice(0, 5),
    },
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready],
    generatedAt: "2026-05-23T12:20:00.000Z",
  });

  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.visual_v4_render_bridge_clip_count, 8);
  assert.equal(candidate.video_clips.length, 8);
  assert.equal(candidate.visual_v4_bridge_video_clips.length, 8);
  assert.equal(candidate.video_clips[0].media_kind, "direct_video");
  assert.equal(candidate.video_clips[0].source_url_kind, "direct_video");
  assert.notEqual(candidate.video_clips[0].rights_risk_class, "owned_generated_motion");
  assert.match(candidate.video_clips[0].rights_basis, /official_reference/);
  assert.equal(candidate.video_clips[0].counts_towards_motion_readiness, true);
  assert.equal(candidate.video_clips[5].source_type, "internally_generated_motion_graphic");
});

test("production cutover records ElevenLabs narration rights when final audio uses ElevenLabs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-elevenlabs-"));
  const ready = await makeCutoverPackage(root, "elevenlabs-audio-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Forza Horizon 6",
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
  });
  const artifactDir = ready.artifact_dir;
  const audioPath = path.join(artifactDir, "narration.mp3");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "elevenlabs-audio-story",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "Steam interest changed the Xbox story",
    primary_source: "IGN",
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    thumbnail_headline: "FORZA BROKE STEAM",
    narration_script:
      "Forza Horizon 6 just broke the Xbox ceiling that usually matters on Steam. IGN says the Steam launch is changing how the game is being judged.",
    description: "Forza Horizon 6 has a Steam attention spike. Source: IGN.",
    source_card_label: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    outputs: { youtube_shorts: { duration_seconds: { min: 35, max: 60 } } },
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: audioPath,
    word_timestamps_path: path.join(artifactDir, "narration_timestamps.json"),
    voice_provider: "elevenlabs",
  });
  await fs.outputFile(audioPath, Buffer.alloc(4000, 2));
  await fs.outputJson(path.join(artifactDir, "narration_timestamps.json"), {
    words: [{ word: "Forza", start: 0, end: 0.3 }],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "elevenlabs-audio-story",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: STUDIO_V4_SFX_MIX_POLICY_VERSION,
    voice_mix_policy_version: STUDIO_V4_VOICE_MIX_POLICY_VERSION,
    visual_design_policy_version: STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 43,
    clips: 8,
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready],
    generatedAt: "2026-05-23T07:10:00.000Z",
  });

  const candidate = plan.scheduler_bridge.candidates[0];
  const audioRecord = candidate.rights_ledger.find((record) => record.asset_id === "elevenlabs-audio-story_audio_path");
  assert.equal(audioRecord.source_type, "elevenlabs_tts_voice");
  assert.equal(audioRecord.licence_basis, "elevenlabs_commercial_tts_generation");
  assert.match(audioRecord.evidence_file, /elevenlabs/i);
});

test("production cutover refreshes stale RED control-tower verdicts for clean final renders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-stale-verdict-"));
  const ready = await makeCutoverPackage(root, "stale-verdict-story", {
    finalPublishRender: true,
    renderer: "visual_v4_production",
    visualTier: "production_v4_motion",
    subject: "Forza Horizon 6",
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
  });
  const artifactDir = ready.artifact_dir;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "stale-verdict-story",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "Steam demand changed the Xbox launch story",
    primary_source: "IGN",
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    thumbnail_headline: "FORZA BROKE STEAM",
    first_spoken_line: "Forza Horizon 6 just broke the Xbox ceiling that usually matters on Steam.",
    narration_script:
      "Forza Horizon 6 just broke the Xbox ceiling that usually matters on Steam. IGN says the Steam launch is changing how the game is being judged. Follow Pulse Gaming so you never miss a beat.",
    description: "Forza Horizon 6 has a Steam attention spike. Source: IGN.",
    source_card_label: "IGN",
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: ["rights:no_rights_record"],
  });

  const plan = await buildProductionRenderCutoverPlan({
    storyPackages: [ready],
    generatedAt: "2026-05-23T07:20:00.000Z",
  });

  const candidate = plan.scheduler_bridge.candidates[0];
  assert.equal(candidate.publish_verdict.verdict, "GREEN");
  assert.equal(candidate.publish_verdict.can_auto_publish, true);
  assert.equal(candidate.platform_publish_manifest.publish_status, "GREEN");
  assert.deepEqual(candidate.publish_verdict.reason_codes, []);
  assert.equal((await fs.readJson(path.join(artifactDir, "publish_verdict.json"))).verdict, "GREEN");
  assert.equal((await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"))).publish_status, "GREEN");
});

test("production cutover writes queue and validation reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-cutover-write-"));
  const outputDir = path.join(root, "out");
  const storyPackage = await makeCutoverPackage(root, "queued-story");
  const plan = await buildProductionRenderCutoverPlan({ storyPackages: [storyPackage] });

  const written = await writeProductionRenderCutoverPlan(plan, { outputDir });

  assert.equal(await fs.pathExists(written.planPath), true);
  assert.equal(await fs.pathExists(written.queuePath), true);
  assert.equal(await fs.pathExists(written.validationPath), true);
  assert.equal(await fs.pathExists(written.schedulerBridgePath), true);
  assert.equal(await fs.pathExists(written.schedulerBridgeCandidatesPath), true);
  assert.equal((await fs.readJson(written.queuePath))[0].story_id, "queued-story");
  assert.equal((await fs.readJson(written.validationPath))[0].render_input_status, "blocked");
  assert.ok(
    (await fs.readJson(written.validationPath))[0].render_input_blockers.includes("final_narration_audio_missing"),
  );
});
