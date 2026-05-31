"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal09SoundDesignEngine,
  writeGoal09SoundDesignEngine,
} = require("../../lib/goal09-sound-design-engine");

async function makeSoundStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    narration_audio_path: "output/audio/story.mp3",
    word_timestamps_path: "output/audio/story_timestamps.json",
    voice_status: "materialized",
    word_timestamp_count: 80,
    sfx_cue_count: overrides.audioCueCount ?? 8,
    mix_rules: {
      narration_priority: true,
      duck_under_narration: true,
      sidechain_release_ms: 420,
      limiter: true,
      target_peak_db: -1.5,
    },
    safety: {
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    story_id: storyId,
    cue_count: overrides.sfxCueCount ?? 8,
    source_plan: {
      required_roles: ["impact", "transition", "ui_tick"],
      covered_roles: overrides.coveredRoles || ["impact", "transition", "ui_tick"],
      selected_assets: overrides.selectedAssets || [
        { asset_id: "impact", role: "impact", provider_id: "sonniss", commercial_use_allowed: true, approval_status: "approved_for_commercial_editorial_use" },
        { asset_id: "transition", role: "transition", provider_id: "sonniss", commercial_use_allowed: true, approval_status: "approved_for_commercial_editorial_use" },
        { asset_id: "ui", role: "ui_tick", provider_id: "sonniss", commercial_use_allowed: true, approval_status: "approved_for_commercial_editorial_use" },
      ],
      readiness: {
        status: overrides.sfxStatus || "pass",
        blockers: overrides.sfxBlockers || [],
        warnings: [],
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "audio_segment_loudness_report.json"), {
    story_id: storyId,
    verdict: overrides.loudnessVerdict || "pass",
    blockers: overrides.loudnessBlockers || [],
    warnings: [],
    metrics: {
      valid_segment_count: overrides.validSegments ?? 6,
      mean_range_db: overrides.meanRange ?? 1.2,
      max_adjacent_rise_db: overrides.maxAdjacentRise ?? 0.6,
      max_peak_db: overrides.maxPeak ?? -1.8,
    },
    safety: {
      read_only: true,
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
    },
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    sound_transition_plan: {
      duration_s: 42,
      sfx: {
        cue_count: overrides.directorCueCount ?? 8,
        max_same_family_run: overrides.maxSameFamilyRun ?? 1,
        cues: overrides.cues || [
          { id: "impact", target_kind: "hook_slam", family: "impact", atS: 0, gainDb: -7.5, duckGroup: "under_narration" },
          { id: "whoosh", target_kind: "motion_clip", family: "whoosh", atS: 0.35, gainDb: -10, duckGroup: "under_narration" },
          { id: "tick", target_kind: "source_lock", family: "source_tick", atS: 2.4, gainDb: -12, duckGroup: "under_narration" },
          { id: "hit", target_kind: "motion_clip", family: "transition_hit", atS: 4.5, gainDb: -10, duckGroup: "under_narration" },
        ],
      },
      readiness: {
        verdict: "pass",
        blockers: [],
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    sfx_mix_policy_version: overrides.sfxMixPolicyVersion || "source_lock_news_tick_v6",
    voice_mix_policy_version: overrides.voiceMixPolicyVersion || "local_voice_levelled_v2",
    rendered_duration_s: 42,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });
  return {
    story_id: storyId,
    title: `${storyId} title`,
    artifact_dir: artifactDir,
  };
}

test("Goal 09 blocks full sound readiness when upstream Visual V4 is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-upstream-"));
  const story = await makeSoundStory(root, "story-upstream");

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [story],
    upstreamVisualReport: {
      stories: [
        {
          story_id: "story-upstream",
          status: "blocked",
          blockers: ["upstream:goal07_director_brain_blocked"],
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T23:05:36.619Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.direct_sound_pass_story_count, 1);
  assert.equal(report.summary.sound_ready_story_count, 0);
  assert.deepEqual(report.stories[0].blockers, [
    "upstream:goal08_visual_v4_renderer_blocked",
    "upstream:goal07_director_brain_blocked",
  ]);
  assert.equal(report.audio_plan.stories[0].direct_sound_status, "pass");
  assert.equal(report.loudness_report.stories[0].status, "pass");
});

test("Goal 09 excludes strict dry-run skipped stories from active sound blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-skipped-"));
  const readyStory = await makeSoundStory(root, "story-ready");
  const skippedStory = await makeSoundStory(root, "story-skipped", {
    loudnessVerdict: "fail",
    loudnessBlockers: ["audio_segment_loudness_unverified"],
    validSegments: 0,
  });

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [readyStory, skippedStory],
    upstreamVisualReport: {
      stories: [
        { story_id: "story-ready", status: "ready", blockers: [] },
        { story_id: "story-skipped", status: "blocked", blockers: ["visual:generated_only_motion_deck"] },
      ],
    },
    dryRunPlan: {
      skipped_stories: [
        {
          story_id: "story-skipped",
          status: "visual_source_deferred",
          reason: "defer_until_rights_backed_media_available",
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-28T23:45:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.story_count, 2);
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.stories.find((story) => story.story_id === "story-skipped").status, "skipped");
  assert.equal(report.audio_plan.stories.find((story) => story.story_id === "story-skipped").status, "skipped");
  assert.equal(report.sfx_manifest.stories.find((story) => story.story_id === "story-skipped").status, "skipped");
  assert.equal(report.loudness_report.stories.find((story) => story.story_id === "story-skipped").status, "skipped");
  assert.equal(report.audio_quality_scorecard.stories.find((story) => story.story_id === "story-skipped").status, "skipped");
  assert.deepEqual(report.blocker_counts, {});
});

test("Goal 09 ignores stale strict dry-run skips once current Visual V4 evidence is ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-stale-skip-"));
  const repairedStory = await makeSoundStory(root, "story-repaired");

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [repairedStory],
    upstreamVisualReport: {
      stories: [
        { story_id: "story-repaired", status: "ready", blockers: [] },
      ],
    },
    dryRunPlan: {
      skipped_stories: [
        {
          story_id: "story-repaired",
          status: "visual_source_deferred",
          reason: "defer_until_rights_backed_media_available",
        },
      ],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-31T06:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.active_story_count, 1);
  assert.equal(report.summary.skipped_story_count, 0);
  assert.equal(report.summary.sound_ready_story_count, 1);
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.stories[0].direct_sound_status, "pass");
});

test("Goal 09 accepts compact source-lock SFX manifests when all required roles are covered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-source-lock-sfx-"));
  const story = await makeSoundStory(root, "story-source-lock-sfx", {
    selectedAssets: [
      {
        asset_id: "plain-editorial-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        editorial_sfx_score: 0.65,
      },
    ],
    coveredRoles: ["ui_tick"],
    cues: [
      { id: "impact", target_kind: "hook_slam", family: "impact", atS: 0, gainDb: -7.5, duckGroup: "under_narration" },
      { id: "whoosh", target_kind: "motion_clip", family: "whoosh", atS: 0.35, gainDb: -10, duckGroup: "under_narration" },
      { id: "tick", target_kind: "source_lock", family: "source_tick", atS: 2.4, gainDb: -12, duckGroup: "under_narration" },
      { id: "hit", target_kind: "motion_clip", family: "transition_hit", atS: 4.5, gainDb: -10, duckGroup: "under_narration" },
    ],
  });
  const manifestPath = path.join(story.artifact_dir, "sfx_manifest.json");
  const sfxManifest = await fs.readJson(manifestPath);
  sfxManifest.source_plan.required_roles = ["ui_tick"];
  sfxManifest.cue_count = 4;
  await fs.writeJson(manifestPath, sfxManifest, { spaces: 2 });

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [story],
    upstreamVisualReport: {
      stories: [{ story_id: "story-source-lock-sfx", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-27T14:10:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.direct_sound_pass_story_count, 1);
  assert.equal(report.stories[0].direct_sound_status, "pass");
  assert.ok(!report.stories[0].direct_sound_blockers.includes("sound:sfx_selected_assets_missing"));
  assert.equal(report.sfx_manifest.stories[0].status, "pass");
});

test("Goal 09 reports loudness, policy and repeated SFX failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-hard-fail-"));
  const story = await makeSoundStory(root, "story-sound-fail", {
    sfxMixPolicyVersion: "legacy_placeholder_sfx_v1",
    voiceMixPolicyVersion: "legacy_voice_chain_v1",
    loudnessVerdict: "fail",
    loudnessBlockers: ["voice_peak_too_hot"],
    validSegments: 2,
    maxPeak: -0.2,
    maxSameFamilyRun: 3,
    directorCueCount: 3,
    sfxCueCount: 3,
    coveredRoles: ["impact"],
  });

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [story],
    upstreamVisualReport: {
      stories: [{ story_id: "story-sound-fail", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-25T23:05:36.619Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_mix_policy_stale/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:voice_mix_policy_stale/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:loudness_failed/);
  assert.match(report.stories[0].blockers.join("\n"), /loudness:voice_peak_too_hot/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_role_not_covered:transition/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_role_not_covered:ui_tick/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:repeated_sfx_pattern/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:too_few_sfx_cues/);
  assert.equal(report.sfx_manifest.stories[0].status, "blocked");
  assert.equal(report.audio_quality_scorecard.stories[0].status, "blocked");
});

test("Goal 09 blocks semantically wrong SFX even when role coverage passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-sfx-taste-"));
  const story = await makeSoundStory(root, "story-bad-sfx", {
    selectedAssets: [
      {
        asset_id: "dragon-reveal",
        role: "impact",
        family: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Fantasy/DragonReveal.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        editorial_sfx_score: 0.08,
      },
      {
        asset_id: "boat-pass-by",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Lake Boat/BOATMotr_Boat_Pass_By.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        editorial_sfx_score: 0.18,
      },
      {
        asset_id: "lighter-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/High Voltage/lighter_button_click_on_off.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        editorial_sfx_score: 0.1,
      },
    ],
  });

  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [story],
    upstreamVisualReport: {
      stories: [{ story_id: "story-bad-sfx", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-26T15:10:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_asset_below_editorial_floor:impact/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_asset_below_editorial_floor:transition/);
  assert.match(report.stories[0].blockers.join("\n"), /sound:sfx_asset_below_editorial_floor:ui_tick/);
  assert.equal(report.sfx_manifest.stories[0].status, "blocked");
});

test("Goal 09 writes the required sound design artefacts as JSON and Markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal09-write-"));
  const story = await makeSoundStory(root, "story-ready");
  const outputDir = path.join(root, "out");
  const report = await buildGoal09SoundDesignEngine({
    storyPackages: [story],
    upstreamVisualReport: {
      stories: [{ story_id: "story-ready", status: "ready", blockers: [] }],
    },
    workspaceRoot: root,
    outputDir,
    generatedAt: "2026-05-25T23:05:36.619Z",
  });

  const written = await writeGoal09SoundDesignEngine(report, { outputDir });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.audioPlan), true);
  assert.equal(await fs.pathExists(written.sfxManifest), true);
  assert.equal(await fs.pathExists(written.loudnessReport), true);
  assert.equal(await fs.pathExists(written.audioQualityScorecard), true);
  const audioPlan = await fs.readJson(written.audioPlan);
  assert.equal(audioPlan.ready_story_count, 1);
});
