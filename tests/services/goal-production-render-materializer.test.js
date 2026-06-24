"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  materializeGoalProductionRenders,
  refreshFinalRenderQualityOnly,
  writeGoalProductionRenderMaterializationReport,
} = require("../../lib/goal-production-render-materializer");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../../lib/studio/v4/render-policy");

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

async function makePackage(root, storyId = "story-final") {
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
  const minimumDurationS = Number(overrides.minimumDurationS || 6.5);
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
          planned_visible_duration_s: minimumDurationS,
          minimum_visible_duration_s: minimumDurationS,
        },
      },
      blockers: [],
    },
  });
  return cardPath;
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
  assert.equal(manifest.safety.no_local_proof_promoted_to_final, true);
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

test("goal production render materializer feeds passing HyperFrames shell cards into the V4 render story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-card-use-"));
  const artifactDir = await makePackage(root, "story-hf-card-use");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-card-use", kind),
  ));
  const job = readyJob("story-hf-card-use", artifactDir);
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
  assert.equal(renderStory.hyperframes_card_count, 5);
  assert.equal(renderStory.premium_shell_verdict, "pass");
  assert.equal(renderStory.premium_shell_pass_count, 5);
  assert.deepEqual(renderStory.premium_shell_blockers, []);
  assert.ok(renderStory.video_clips.some((clip) => /hf_source_card_story-hf-card-use\.mp4$/.test(clip)));
  assert.ok(
    renderStory.visual_v4_bridge_video_clips.some(
      (clip) => clip.source_type === "hyperframes_premium_shell_card",
    ),
  );
  assert.ok(
    renderStory.visual_v4_bridge_video_clips
      .filter((clip) => clip.source_type === "hyperframes_premium_shell_card")
      .every((clip) => clip.durationS >= 6.5 && clip.duration_s >= 6.5),
  );
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.hyperframes_premium_shell_required, true);
  assert.equal(manifest.hyperframes_card_count, 5);
  assert.equal(manifest.premium_shell_verdict, "pass");
  assert.equal(manifest.premium_shell_pass_count, 5);
});

test("goal production render materializer preserves readable HyperFrames card dwell from shell sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-card-dwell-"));
  const artifactDir = await makePackage(root, "story-hf-readable-dwell");
  await Promise.all([
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "source"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "context"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "timeline", {
      readableText: "GTA VI cover art is live but the price and edition decision is not",
      minimumDurationS: 10,
    }),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "quote"),
    writePassingHyperframesCard(root, "story-hf-readable-dwell", "takeaway"),
  ]);
  const job = readyJob("story-hf-readable-dwell", artifactDir);
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
  const timelineCard = renderStory.visual_v4_bridge_video_clips.find(
    (clip) => clip.id === "hyperframes_premium_shell_timeline_3",
  );
  assert.equal(timelineCard.durationS, 10);
  assert.equal(timelineCard.minimum_readable_duration_s, 10);
  assert.match(timelineCard.text, /price and edition decision/i);
});

test("goal production render materializer auto-preserves HyperFrames shell cards on rerender work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-hf-auto-"));
  const artifactDir = await makePackage(root, "story-hf-auto");
  await Promise.all(["source", "context", "timeline", "quote", "takeaway"].map((kind) =>
    writePassingHyperframesCard(root, "story-hf-auto", kind),
  ));
  const job = readyJob("story-hf-auto", artifactDir);
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
  assert.equal(renderStory.hyperframes_card_count, 5);
  assert.equal(renderStory.premium_shell_verdict, "pass");
  assert.equal(renderStory.premium_shell_pass_count, 5);
  assert.deepEqual(renderStory.premium_shell_blockers, []);
  const manifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(manifest.hyperframes_premium_shell_required, true);
  assert.equal(manifest.hyperframes_card_count, 5);
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
    source_url: "https://www.youtube.com/watch?v=EiQEBYDox_k",
    source_type: "official_trailer_segment",
    source_family: `rockstar_cover_art_segment_${index + 1}`,
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

test("goal production render materializer refreshes stale quality reports without rerendering", async () => {
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
  assert.equal(refreshedForensics.verdict, "post_render_forensics_passed");
  assert.equal(refreshedForensics.result, "pass");
  assert.deepEqual(refreshedForensics.blockers, []);
  assert.equal(refreshedForensics.checks.benchmark, "pass");
  assert.equal(refreshedForensics.checks.final_render_mp4, "pass");
  assert.equal(refreshedForensics.evidence.motion_clip_count >= 5, true);
  assert.equal(refreshedForensics.repair_source, "post_render_quality_refresh");
  const refreshedRenderManifest = await fs.readJson(path.join(artifactDir, "render_manifest.json"));
  assert.equal(refreshedRenderManifest.quality_gate_status, "post_render_forensics_passed");
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
      return { clips: 2, rendered_duration_s: 24 };
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
      return { clips: 2, rendered_duration_s: 42 };
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
      return { clips: 2, rendered_duration_s: 42 };
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
