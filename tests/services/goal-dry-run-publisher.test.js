"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");

const {
  buildGoalDryRunPublishPlan,
  writeGoalDryRunPublishPlan,
} = require("../../lib/goal-dry-run-publisher");
const {
  parseArgs,
  readCandidateReport,
  readPlatformOperationalConfig,
  readRepairWorkOrder,
  readStoryPackages,
} = require("../../tools/goal-dry-run-publish");
const { currentRenderPolicyManifest } = require("../../lib/studio/v4/render-policy");

function inferFixtureSubject(title = "Forza Horizon 6") {
  const match = String(title).match(
    /^(.+?)\s+(?:Already|Brings|Exposes|Finally|Has|Is|Just|May|Now|Reaches|Will|Gets|Raises|Walked)\b/,
  );
  return (match ? match[1] : title).trim();
}

function allPlatformsEnabled() {
  return {
    youtube: { state: "enabled", reason: "test_enabled" },
    tiktok: { state: "enabled", reason: "test_enabled" },
    instagram_reel: { state: "enabled", reason: "test_enabled" },
    facebook_reel: { state: "enabled", reason: "test_enabled" },
    twitter: { state: "enabled", reason: "test_enabled" },
    threads: { state: "enabled", reason: "test_enabled" },
    pinterest: { state: "enabled", reason: "test_enabled" },
  };
}

async function makeStoryPackage(
  root,
  id = "story-one",
  verdict = "GREEN",
  title = "Forza Horizon 6 Exposes Xbox's Steam Bet",
  options = {},
) {
  const artifactDir = path.join(root, id);
  await fs.ensureDir(artifactDir);
  const subject = options.canonicalSubject || inferFixtureSubject(title);
  const renderGeneratedAt = options.renderGeneratedAt || "2026-05-24T20:00:00.000Z";
  const audioSegmentGeneratedAt = options.audioSegmentGeneratedAt || "2026-05-24T20:05:00.000Z";
  const audioMaterializedAt = options.audioMaterializedAt || "2026-05-24T19:55:00.000Z";
  const captionGeneratedAt = options.captionGeneratedAt || "2026-05-24T20:06:00.000Z";
  const voiceQualityGeneratedAt = options.voiceQualityGeneratedAt || "2026-05-24T20:07:00.000Z";
  const audioWordCount = options.audioWordCount || 3;
  const captionWordCount = options.captionWordCount || audioWordCount;
  const voiceQualityWordCount = options.voiceQualityWordCount || audioWordCount;
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: id,
    canonical_subject: subject,
    canonical_title: `${subject} - the long raw article headline with extra source words`,
    short_title: title,
    selected_title: title,
    first_spoken_line: `${subject} just exposed a sharper gaming story.`,
    narration_script:
      `${subject} just exposed a sharper gaming story. The source points to a clear player signal that is worth watching before the next upload cycle.`,
    description: `${subject} has a new source-safe gaming angle. Source: Eurogamer.`,
    thumbnail_headline: `${subject.toUpperCase()} ANGLE`,
    primary_source: { name: "Eurogamer", url: "https://www.eurogamer.net/example" },
    discovery_source: { name: "RSS", url: "https://www.eurogamer.net/feed" },
    ...(options.canonicalPatch || {}),
  });
  await fs.outputJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict,
    can_auto_publish: verdict === "GREEN",
    reason_codes: verdict === "GREEN" ? [] : ["fixture_block"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: id,
    publish_status: verdict,
    platform_native_evidence: {
      verdict: "pass",
      checked_platforms: ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels", "x", "threads", "pinterest"],
    },
    outputs: {
      youtube_shorts: { duration_seconds: { min: 35, max: 60 }, cta: "Open the story page for sources and platform notes." },
      tiktok: { duration_seconds: { min: 61, max: 90 } },
      instagram_reels: { duration_seconds: { min: 25, max: 45 } },
      facebook_reels: { duration_seconds: { min: 35, max: 60 } },
      x: { duration_seconds: { min: 25, max: 60 } },
    },
  });
  await fs.outputJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: "/p/forza-horizon-6-steam-bet",
  });
  await fs.outputJson(path.join(artifactDir, "platform_policy_report.json"), {
    status: "pass",
    disclosure_requirements: { affiliate: false },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: id,
    renderer: options.renderer || "visual_v4_production",
    ...currentRenderPolicyManifest(),
    output: "visual_v4_render.mp4",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    generated_at: renderGeneratedAt,
    final_publish_render: options.finalPublishRender !== false,
    visual_tier: options.visualTier || "production_v4_motion",
    render_lane: options.renderLane || "visual_v4_production",
    render_quality_class: options.renderQualityClass || "premium",
    visual_count: options.visualCount || 8,
    rendered_duration_s: options.renderedDurationS,
  });
  const visualScores = {
    motion_density_score: options.motionDensityScore ?? 92,
    first_3_seconds_hook_score: options.firstThreeSecondsHookScore ?? 88,
    source_lock_quality_score: options.sourceLockQualityScore ?? 86,
    caption_legibility_score: options.captionLegibilityScore ?? 94,
    card_hierarchy_score: options.cardHierarchyScore ?? 84,
    media_house_polish_score: options.mediaHousePolishScore ?? 90,
  };
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: options.visualQualityResult || "pass",
    scores: visualScores,
    frame_rules: {
      first_frame_subject: subject,
      first_frame_text: `${subject.toUpperCase()} ANGLE`,
      source_locks_readable: options.sourceLocksReadable !== false,
      no_empty_rectangles: true,
      no_text_on_text: true,
    },
    failures: options.visualQualityFailures || [],
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), {
    result: options.benchmarkResult || "pass",
    scores: visualScores,
    failures: options.benchmarkFailures || [],
  });
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    result: options.coherenceResult || "pass",
    failures: options.coherenceFailures || [],
    warnings: [],
    manifest: {
      selected_title: title,
      thumbnail_headline: `${subject.toUpperCase()} ANGLE`,
      first_spoken_line: `${subject} just exposed a sharper gaming story.`,
      narration_script:
        `${subject} just exposed a sharper gaming story. The source points to a clear player signal that is worth watching before the next upload cycle.`,
      description: `${subject} has a new source-safe gaming angle. Source: Eurogamer.`,
      source_card_label: "Eurogamer",
    },
  });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: {
        status: "pass",
        blockers: [],
      },
      selected_assets: [
        {
          asset_id: "boom-impact-01",
          role: "impact",
          provider_id: "boom_library",
          rights_basis: "boom_library_media_license",
        },
        {
          asset_id: "soundly-transition-01",
          role: "transition",
          provider_id: "soundly",
          rights_basis: "soundly_pro_commercial_use",
        },
        {
          asset_id: "sonniss-tick-01",
          role: "ui_tick",
          provider_id: "sonniss",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
        },
      ],
    },
  });
  if (options.renderStorySfxAssets) {
    await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
      sfx_asset_inventory: options.renderStorySfxAssets,
    });
  }
  if (options.audioSegmentReport !== false) {
    await fs.outputJson(path.join(artifactDir, "audio_segment_loudness_report.json"), {
      verdict: options.audioSegmentVerdict || "pass",
      generated_at: audioSegmentGeneratedAt,
      input_path: path.join(artifactDir, "visual_v4_render.mp4"),
      blockers: options.audioSegmentBlockers || [],
      warnings: [],
      metrics: {
        valid_segment_count: 6,
        mean_range_db: 1.4,
        max_adjacent_rise_db: 0.7,
        max_peak_db: -2.6,
      },
    });
  }
  await fs.outputFile(path.join(artifactDir, "narration.mp3"), Buffer.alloc(1500, 2));
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    status: "ready",
    audio_path: "narration.mp3",
    transcript:
      `${subject} just exposed a sharper gaming story. The source points to a clear player signal that is worth watching before the next upload cycle.`,
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: audioWordCount,
    materialized_at: audioMaterializedAt,
    word_timestamp_source: "local_whisper_word_alignment",
  });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    schema_version: 1,
    story_id: id,
    generated_at: captionGeneratedAt,
    caption_srt_path: path.join(artifactDir, "captions.srt"),
    word_timestamps_path: path.join(artifactDir, "word_timestamps.json"),
    timing_source: "word_timestamps",
    word_count: captionWordCount,
  });
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    story_id: id,
    generated_at: voiceQualityGeneratedAt,
    verdict: options.voiceQualityVerdict || "PASS",
    checks: {
      narration_audio_present: true,
      narration_audio_usable: true,
      word_timestamps_present: true,
      captions_well_formed: true,
      transcript_available: true,
    },
    warnings: [],
    audio_size_bytes: 1500,
    word_timestamp_count: voiceQualityWordCount,
    caption_chunk_count: 1,
  });
  await fs.outputJson(path.join(artifactDir, "word_timestamps.json"), {
    words: [
      { word: "Forza", start: 0, end: 0.2 },
      { word: "Horizon", start: 0.21, end: 0.42 },
      { word: "6", start: 0.43, end: 0.5 },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "owned_motion_manifest.json"), {
    status: "ready",
    materialised_clips: [
      { path: "motion-hook.mp4", motion_family: "kinetic_title", duration_s: 1.2 },
      { path: "motion-source.mp4", motion_family: "source_card", duration_s: 1.4 },
      { path: "motion-stat.mp4", motion_family: "stat_card", duration_s: 1.3 },
    ],
    distinct_motion_families: ["kinetic_title", "source_card", "stat_card"],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      {
        asset_id: `${id}-motion-hook`,
        asset_type: "video_clip",
        path: `output/video_cache/${id}-official-trailer-segment-1.mp4`,
        source_url: "https://cdn.example.com/official-trailer-segment-1.mp4",
        source_type: "official_trailer_segment",
        source_family: "official_trailer_segment_1",
        licence_basis: "official_store_trailer_transformative_editorial_use",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
        commercial_use_allowed: true,
        approval_status: "approved",
      },
    ],
  });
  await fs.outputFile(path.join(artifactDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(1500, 1));
  return {
    story_id: id,
    verdict,
    artefacts: [
      "canonical_story_manifest.json",
      "visual_v4_render.mp4",
      "captions.srt",
      "narration_manifest.json",
      "word_timestamps.json",
      "owned_motion_manifest.json",
      "rights_ledger.json",
      "platform_publish_manifest.json",
      "publish_verdict.json",
      "landing_page_manifest.json",
      "platform_policy_report.json",
      "visual_quality_report.json",
      "benchmark_report.json",
      "coherence_report.json",
      "render_manifest.json",
    ],
    artifact_dir: artifactDir,
  };
}

test("goal dry-run publisher emits exact platform actions without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T00:20:00.000Z",
  });

  assert.equal(plan.mode, "DRY_RUN_PUBLISH");
  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.planned_action_count, 7);
  assert.equal(plan.summary.platform_publish_now_action_count, 0);
  assert.equal(plan.summary.platform_deferred_action_count, 7);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.equal(plan.ready_for_unattended_publish, false);
  assert.equal(plan.safety.no_publish_triggered, true);
  assert.equal(plan.safety.no_network_uploads, true);
  assert.deepEqual(
    plan.actions.map((action) => action.platform),
    ["youtube_shorts", "tiktok", "instagram_reels", "facebook_reels", "x", "threads", "pinterest"],
  );
  assert.equal(plan.actions[0].title, "Forza Horizon 6 Exposes Xbox's Steam Bet");
  assert.ok(plan.actions.every((action) => action.action === "would_queue_when_enabled"));
  assert.ok(plan.actions.every((action) => action.video_path.endsWith("visual_v4_render.mp4")));
});

test("goal dry-run publisher treats assumed-enabled platform status as not publishable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-assumed-platform-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T23:10:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "assumed_enabled", reason: "derived_from_old_dry_run_matrix" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "assumed_enabled", reason: "derived_from_old_dry_run_matrix" },
    },
  });

  assert.equal(plan.overall_verdict, "AMBER");
  assert.equal(plan.summary.platform_publish_now_action_count, 3);
  assert.equal(plan.summary.platform_deferred_action_count, 4);
  assert.equal(plan.actions.find((action) => action.platform === "tiktok").action, "would_queue_when_enabled");
  assert.equal(plan.actions.find((action) => action.platform === "x").action, "would_queue_when_enabled");
  assert.equal(plan.platform_status_matrix.platforms.tiktok.status, "deferred_until_platform_enabled");
  assert.equal(plan.platform_status_matrix.platforms.x.operational_state, "assumed_enabled");
});

test("goal dry-run publisher blocks renders whose mixed SFX do not match the approved SFX manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-sfx-"));
  const storyPackage = await makeStoryPackage(
    root,
    "stale-sfx-story",
    "GREEN",
    "Hades II Just Broke PlayStation's Silence",
    {
      canonicalSubject: "Hades II",
      renderStorySfxAssets: [
        {
          asset_id: "old-water-impact",
          role: "impact",
          provider_id: "sonniss",
          source_url: "file://audio/sonniss/designed_water_impact.wav",
        },
      ],
    },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T20:10:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_render_asset_mismatch"));
});

test("goal dry-run publisher defers externally blocked or operator-disabled platforms without blocking the story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-state-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T15:05:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.blocked_action_count, 0);
  assert.equal(plan.summary.planned_action_count, 7);
  assert.equal(plan.summary.platform_publish_now_action_count, 3);
  assert.equal(plan.summary.platform_enabled_dry_run_action_count, 3);
  assert.equal(plan.summary.human_review_required_action_count, 3);
  assert.equal(plan.summary.live_publish_allowed_action_count, 0);
  assert.equal(plan.summary.platform_deferred_action_count, 4);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.equal(plan.ready_for_unattended_publish, false);
  assert.ok(plan.readiness_reasons.includes("platform_actions_deferred_until_enabled"));
  assert.equal(plan.safe_publish_plan.live_publish_allowed_from_this_plan, false);
  assert.equal(plan.safe_publish_plan.required_next_step, "operator_human_review_for_enabled_actions");

  const tiktok = plan.actions.find((action) => action.platform === "tiktok");
  const x = plan.actions.find((action) => action.platform === "x");
  const enabledActions = plan.actions.filter((action) => action.action === "would_publish");

  assert.equal(enabledActions.length, 3);
  assert.ok(enabledActions.every((action) => action.live_publish_allowed_from_dry_run === false));
  assert.ok(enabledActions.every((action) => action.requires_human_review_before_live_publish === true));
  assert.ok(enabledActions.every((action) => action.live_execution_gate === "operator_human_review_required"));
  assert.deepEqual(
    plan.platform_status_matrix.platforms.youtube_shorts.live_execution_gate_reasons,
    ["platform_actions_deferred_until_enabled"],
  );

  assert.equal(tiktok.action, "would_queue_when_enabled");
  assert.equal(tiktok.platform_enabled, false);
  assert.equal(tiktok.requires_human_review_before_live_publish, false);
  assert.equal(tiktok.live_execution_gate, "platform_enablement_required");
  assert.equal(tiktok.platform_operational_state, "blocked_external");
  assert.equal(tiktok.platform_operational_reason, "tiktok_direct_post_app_review");
  assert.equal(x.action, "would_queue_when_enabled");
  assert.equal(x.platform_operational_state, "disabled");
  assert.equal(plan.actions.find((action) => action.platform === "threads").action, "would_queue_when_enabled");
  assert.equal(plan.actions.find((action) => action.platform === "pinterest").action, "would_queue_when_enabled");
  assert.ok(plan.actions.every((action) => action.no_network_upload === true));
});

test("goal dry-run markdown separates enabled actions from deferred platform enablement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-action-copy-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T07:15:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  await writeGoalDryRunPublishPlan(plan, { outputDir: root });
  const markdown = await fs.readFile(path.join(root, "dry_run_publish_plan.md"), "utf8");

  assert.equal(plan.summary.planned_action_count, 7);
  assert.equal(plan.summary.platform_publish_now_action_count, 3);
  assert.equal(plan.summary.platform_deferred_action_count, 4);
  assert.doesNotMatch(markdown, /^Planned actions:/m);
  assert.match(markdown, /^Candidate platform actions \(enabled \+ deferred\): 7$/m);
  assert.match(markdown, /^Enabled actions requiring human review: 3$/m);
  assert.match(markdown, /^Deferred until platform enablement: 4$/m);
  assert.match(markdown, /^Live publish actions allowed by this dry run: 0$/m);
});

test("goal dry-run publisher surfaces deferred platform enablement gaps without blocking clean enabled platforms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-enablement-gaps-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T07:05:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: {
        state: "needs_credentials",
        reason: "tiktok_local_token_refresh_or_sync_required",
        enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
        enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: {
        state: "disabled",
        reason: "x_optional_disabled",
        enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
        enablement_next_action: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
      },
    },
  });

  assert.equal(plan.summary.platform_publish_now_action_count, 3);
  assert.equal(plan.summary.blocked_action_count, 0);
  assert.equal(plan.summary.warning_action_count, 0);

  const tiktok = plan.actions.find((action) => action.platform === "tiktok");
  const x = plan.actions.find((action) => action.platform === "x");
  assert.equal(tiktok.action, "would_queue_when_enabled");
  assert.deepEqual(tiktok.platform_enablement_gaps, ["tiktok_local_token_refresh_or_sync_required"]);
  assert.match(tiktok.platform_enablement_next_action, /refresh_or_sync_local_token/);
  assert.deepEqual(x.platform_enablement_gaps, ["x_operator_disabled", "x_api_billing_not_declared"]);

  assert.deepEqual(
    plan.platform_status_matrix.platforms.tiktok.enablement_gaps,
    ["tiktok_local_token_refresh_or_sync_required"],
  );
  assert.match(
    plan.platform_status_matrix.platforms.tiktok.enablement_next_action,
    /refresh_or_sync_local_token/,
  );
  assert.deepEqual(
    plan.platform_status_matrix.platforms.x.enablement_gaps,
    ["x_operator_disabled", "x_api_billing_not_declared"],
  );

  await writeGoalDryRunPublishPlan(plan, { outputDir: root });
  const markdown = await fs.readFile(path.join(root, "dry_run_publish_plan.md"), "utf8");
  assert.match(markdown, /tiktok_local_token_refresh_or_sync_required/);
  assert.match(markdown, /refresh_or_sync_local_token/);
  assert.match(markdown, /x_api_billing_not_declared/);
});

test("goal dry-run publisher does not treat disabled-platform optimisation warnings as live publish warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-deferred-warning-"));
  const storyPackage = await makeStoryPackage(root, "deferred-warning", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.tiktok.publish_duration_seconds = { min: 15, max: 90 };
  manifest.outputs.tiktok.creator_rewards_eligible = false;
  manifest.outputs.tiktok.duration_warnings = ["below_creator_rewards_duration"];
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T18:10:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "disabled", reason: "operator_disabled" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.equal(plan.summary.warning_action_count, 1);
  assert.equal(plan.summary.publish_now_warning_action_count, 0);
  assert.equal(plan.summary.deferred_warning_action_count, 1);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.ok(plan.readiness_reasons.includes("platform_actions_deferred_until_enabled"));
  assert.ok(!plan.readiness_reasons.includes("platform_or_preflight_warnings"));
  assert.ok(plan.platform_status_matrix.platforms.tiktok.warnings.includes("below_creator_rewards_duration"));
});

test("goal dry-run publisher still surfaces enabled-platform publish warnings in readiness", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-live-warning-"));
  const storyPackage = await makeStoryPackage(root, "live-warning", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.tiktok.publish_duration_seconds = { min: 15, max: 90 };
  manifest.outputs.tiktok.creator_rewards_eligible = false;
  manifest.outputs.tiktok.duration_warnings = ["below_creator_rewards_duration"];
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T18:15:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
  });

  assert.equal(plan.summary.warning_action_count, 1);
  assert.equal(plan.summary.publish_now_warning_action_count, 1);
  assert.equal(plan.summary.deferred_warning_action_count, 0);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.ok(plan.readiness_reasons.includes("platform_or_preflight_warnings"));
});

test("goal dry-run publisher clears stale TikTok creator-rewards warnings when the long variant is materialised", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-tiktok-variant-warning-"));
  const storyPackage = await makeStoryPackage(root, "tiktok-long-ready", "GREEN", "Forza Horizon 6 Tops Metacritic This Year");
  const artifactDir = storyPackage.artifact_dir;
  const variantDir = path.join(artifactDir, "platform_variants", "tiktok_creator_rewards");
  await fs.ensureDir(variantDir);
  const variantVideoPath = path.join(variantDir, "visual_v4_render_tiktok_creator_rewards.mp4");
  const variantCaptionsPath = path.join(variantDir, "captions_tiktok_creator_rewards.srt");
  await fs.outputFile(variantVideoPath, Buffer.alloc(1500, 3));
  await fs.outputFile(variantCaptionsPath, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");

  const manifestPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.tiktok = {
    ...manifest.outputs.tiktok,
    publish_duration_seconds: { min: 15, max: 90 },
    duration_warnings: ["below_creator_rewards_duration"],
    creator_rewards_eligible: false,
    creator_rewards_duration_seconds: { min: 61, max: 90 },
    technical_duration_seconds: 64.483,
    variant_video_path: variantVideoPath,
    variant_captions_path: variantCaptionsPath,
    platform_variant_render: {
      status: "ready",
      platform: "tiktok",
      variant_type: "tiktok_creator_rewards",
      output_path: variantVideoPath,
      captions_path: variantCaptionsPath,
      duration_s: 64.483,
      creator_rewards_duration_seconds: { min: 61, max: 90 },
    },
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T06:20:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
  });

  const tiktok = plan.actions.find((action) => action.platform === "tiktok");
  assert.equal(tiktok.video_duration_s, 64.483);
  assert.equal(tiktok.creator_rewards_eligible, true);
  assert.deepEqual(tiktok.warnings, []);
  assert.equal(plan.summary.warning_action_count, 0);
  assert.ok(!plan.readiness_reasons.includes("platform_or_preflight_warnings"));
});

test("goal dry-run publisher emits standalone platform preflight and status matrix evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-matrix-"));
  const storyPackage = await makeStoryPackage(root);

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T16:45:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.equal(plan.platform_upload_preflight_report.overall_verdict, "AMBER");
  assert.equal(plan.platform_upload_preflight_report.safety.no_network_uploads, true);
  assert.equal(
    plan.platform_upload_preflight_report.platforms.tiktok.status,
    "deferred_until_platform_enabled",
  );
  assert.equal(plan.platform_upload_preflight_report.platforms.tiktok.publishable_now_count, 0);
  assert.equal(plan.platform_upload_preflight_report.platforms.tiktok.queued_when_enabled_count, 1);
  assert.equal(plan.platform_upload_preflight_report.platforms.x.status, "deferred_until_platform_enabled");
  assert.equal(plan.platform_status_matrix.platforms.tiktok.operational_state, "blocked_external");
  assert.equal(plan.platform_status_matrix.platforms.tiktok.publish_now_action_count, 0);
  assert.equal(plan.platform_status_matrix.platforms.tiktok.deferred_action_count, 1);
  assert.equal(plan.platform_status_matrix.platforms.x.operational_state, "disabled");
  assert.equal(plan.platform_status_matrix.platforms.youtube_shorts.status, "ready_now");
  assert.equal(plan.platform_status_matrix.platforms.threads.status, "deferred_until_platform_enabled");
  assert.equal(plan.platform_status_matrix.platforms.pinterest.status, "deferred_until_platform_enabled");

  const artefacts = await writeGoalDryRunPublishPlan(plan, { outputDir: root });
  const markdown = await fs.readFile(path.join(root, "dry_run_publish_plan.md"), "utf8");
  assert.match(markdown, /Overall verdict: AMBER/);
  assert.match(markdown, /Ready for unattended publish: false/);
  assert.equal(await fs.pathExists(path.join(root, "platform_upload_preflight_report.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "platform_status_matrix.json")), true);
  assert.equal(path.basename(artefacts.platformUploadPreflightPath), "platform_upload_preflight_report.json");
  assert.equal(path.basename(artefacts.platformStatusMatrixPath), "platform_status_matrix.json");
});

test("goal dry-run platform preflight does not report GREEN when disabled platforms have no actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-no-actions-"));
  const storyPackage = await makeStoryPackage(root, "blocked-before-actions", "RED");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T23:30:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
      tiktok: { state: "disabled", reason: "operator_disabled" },
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
      facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  assert.equal(plan.summary.planned_action_count, 0);
  assert.equal(plan.platform_upload_preflight_report.overall_verdict, "AMBER");
  assert.equal(plan.platform_upload_preflight_report.summary.disabled_platform_count, 2);
  assert.equal(plan.platform_upload_preflight_report.summary.unknown_platform_count, 2);
});

test("goal dry-run publisher blocks repeated title patterns beyond the batch cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-repeat-"));
  const storyPackages = [];
  for (let index = 0; index < 4; index += 1) {
    storyPackages.push(await makeStoryPackage(
      root,
      `repeat-${index + 1}`,
      "GREEN",
      `Game ${index + 1} May Have A Price Problem`,
    ));
  }

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages,
    generatedAt: "2026-05-22T01:45:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 3);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 21);
  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.ready_for_unattended_publish, false);
  assert.ok(plan.readiness_reasons.includes("stories_blocked"));
  assert.ok(plan.blocked_stories[0].blockers.includes("title_pattern_repeated:May Have A Price Problem"));
});

test("goal dry-run publisher blocks exact duplicate public titles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-title-dupe-"));
  const storyPackages = [
    await makeStoryPackage(root, "boltgun-preview", "GREEN", "Boltgun 2 Leaves The Corridors"),
    await makeStoryPackage(root, "boltgun-demo", "GREEN", "Boltgun 2 Leaves The Corridors"),
  ];

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages,
    generatedAt: "2026-05-22T05:35:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(
    plan.blocked_stories[0].blockers.includes("title_duplicate:Boltgun 2 Leaves The Corridors"),
  );
});

test("goal dry-run publisher blocks near-duplicate public titles while allowing same-subject new angles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-title-similar-"));
  const storyPackages = [
    await makeStoryPackage(root, "dawn-roadmap", "GREEN", "Dawn Of War 4 Already Has A Roadmap"),
    await makeStoryPackage(root, "dawn-roadmap-copy", "GREEN", "Dawn Of War 4 Has A Roadmap Already"),
    await makeStoryPackage(root, "dawn-date", "GREEN", "Dawn Of War 4 Has A Date"),
  ];

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages,
    generatedAt: "2026-05-22T05:40:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 2);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(
    plan.blocked_stories[0].blockers.some((blocker) =>
      blocker.startsWith("title_too_similar:Dawn Of War 4 Already Has A Roadmap"),
    ),
  );
});

test("goal dry-run publisher blocks platform actions when final render duration misses the platform window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-duration-"));
  const storyPackage = await makeStoryPackage(
    root,
    "duration-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
    { renderedDurationS: 22 },
  );
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.retention_short_approved = true;
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T01:50:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 2);
  assert.equal(plan.summary.blocked_action_count, 5);
  assert.deepEqual(
    plan.actions.map((action) => action.platform),
    ["threads", "pinterest"],
  );
  assert.ok(
    plan.blocked_actions.some(
      (action) =>
        action.platform === "tiktok" &&
        action.blockers.includes("platform_duration_below_min:tiktok:61"),
    ),
  );
});

test("goal dry-run publisher uses a platform-specific variant render when duration evidence is present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-variant-"));
  const storyPackage = await makeStoryPackage(
    root,
    "instagram-variant-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
    { renderedDurationS: 47.3, canonicalSubject: "Forza Horizon 6" },
  );
  const variantPath = path.join(storyPackage.artifact_dir, "platform_variants", "instagram_reels", "visual_v4_render_instagram_reels.mp4");
  const variantCaptionsPath = path.join(storyPackage.artifact_dir, "platform_variants", "instagram_reels", "captions_instagram_reels.srt");
  await fs.outputFile(variantPath, Buffer.alloc(1500, 3));
  await fs.outputFile(variantCaptionsPath, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.instagram_reels = {
    ...manifest.outputs.instagram_reels,
    variant_video_path: variantPath,
    variant_captions_path: variantCaptionsPath,
    technical_duration_seconds: 44.8,
    platform_variant_render: {
      status: "ready",
      source_video_path: path.join(storyPackage.artifact_dir, "visual_v4_render.mp4"),
      captions_path: variantCaptionsPath,
      duration_s: 44.8,
    },
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:18:00.000Z",
    platformOperationalConfig: {
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
    },
  });

  const instagram = plan.actions.find((action) => action.platform === "instagram_reels");

  assert.equal(plan.summary.ready_story_count, 1);
  assert.ok(instagram);
  assert.equal(instagram.action, "would_publish");
  assert.equal(instagram.video_duration_s, 44.8);
  assert.equal(instagram.video_path, variantPath);
  assert.equal(instagram.captions_path, variantCaptionsPath);
  assert.deepEqual(instagram.blockers, []);
  assert.equal(plan.blocked_actions.some((action) => action.platform === "instagram_reels"), false);
});

test("goal dry-run publisher blocks platform-specific variant renders that lack matching captions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-variant-captions-"));
  const storyPackage = await makeStoryPackage(
    root,
    "instagram-variant-no-captions",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
    { renderedDurationS: 47.3, canonicalSubject: "Forza Horizon 6" },
  );
  const variantPath = path.join(storyPackage.artifact_dir, "platform_variants", "instagram_reels", "visual_v4_render_instagram_reels.mp4");
  await fs.outputFile(variantPath, Buffer.alloc(1500, 3));
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.instagram_reels = {
    ...manifest.outputs.instagram_reels,
    variant_video_path: variantPath,
    technical_duration_seconds: 44.8,
    platform_variant_render: {
      status: "ready",
      source_video_path: path.join(storyPackage.artifact_dir, "visual_v4_render.mp4"),
      duration_s: 44.8,
    },
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:19:00.000Z",
    platformOperationalConfig: {
      instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
    },
  });

  const instagram = plan.blocked_actions.find((action) => action.platform === "instagram_reels");

  assert.ok(instagram);
  assert.ok(instagram.blockers.includes("platform_variant_captions_missing:instagram_reels"));
});

test("goal dry-run publisher uses hard publish duration separately from strategic target duration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-publish-duration-"));
  const storyPackage = await makeStoryPackage(
    root,
    "short-cut-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
    { renderedDurationS: 22 },
  );
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.youtube_shorts.publish_duration_seconds = { min: 15, max: 60 };
  manifest.outputs.tiktok.publish_duration_seconds = { min: 15, max: 90 };
  manifest.outputs.tiktok.creator_rewards_eligible = false;
  manifest.outputs.tiktok.duration_warnings = ["below_creator_rewards_duration"];
  manifest.retention_short_approved = true;
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T01:55:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.ok(plan.actions.some((action) => action.platform === "youtube_shorts"));
  assert.ok(plan.actions.some((action) => action.platform === "tiktok"));
  assert.ok(
    plan.actions
      .find((action) => action.platform === "tiktok")
      .warnings.includes("below_creator_rewards_duration"),
  );
});

test("goal dry-run publisher blocks sub-35s normal-production renders without retention approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-short-normal-"));
  const storyPackage = await makeStoryPackage(
    root,
    "boltgun-short",
    "GREEN",
    "Boltgun 2 Leaves The Corridors",
    {
      canonicalSubject: "Warhammer 40,000: Boltgun 2",
      renderedDurationS: 29,
    },
  );
  const manifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const manifest = await fs.readJson(manifestPath);
  manifest.outputs.youtube_shorts.publish_duration_seconds = { min: 15, max: 60 };
  manifest.outputs.instagram_reels.publish_duration_seconds = { min: 15, max: 60 };
  manifest.outputs.facebook_reels.publish_duration_seconds = { min: 15, max: 60 };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T18:50:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("normal_production_duration_below_quality_floor:29"));
});

test("goal dry-run publisher requires scheduler preflight pass when a candidate report is supplied", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-preflight-"));
  const passPackage = await makeStoryPackage(root, "preflight-pass", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const warnPackage = await makeStoryPackage(root, "preflight-warn", "GREEN", "State Of Play Has One Catch");
  const blockedPackage = await makeStoryPackage(root, "preflight-blocked", "GREEN", "Deathmaster Brings Stealth To Consoles");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [passPackage, warnPackage, blockedPackage],
    generatedAt: "2026-05-22T06:55:00.000Z",
    candidatePreflightReport: {
      candidates: [
        {
          id: "preflight-pass",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
        {
          id: "preflight-warn",
          status: "review",
          preflight_qa: {
            status: "warn",
            blockers: [],
            warnings: ["content:video_duration_below_tiktok_target"],
          },
        },
        {
          id: "preflight-blocked",
          status: "review",
          preflight_qa: {
            status: "blocked",
            blockers: ["content:gold_standard:first_3_seconds_hook_below_reference"],
            warnings: [],
          },
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 2);
  assert.equal(plan.summary.preflight_checked_story_count, 3);
  assert.equal(plan.summary.planned_action_count, 7);
  assert.ok(
    plan.blocked_stories
      .find((story) => story.story_id === "preflight-warn")
      .blockers.includes("preflight_candidate_not_publish_ready:review"),
  );
  assert.ok(
    plan.actions.some((action) =>
      action.warnings.includes("preflight_qa_warn:content:video_duration_below_tiktok_target"),
    ) === false,
  );
  assert.ok(
    plan.blocked_stories
      .find((story) => story.story_id === "preflight-blocked")
      .blockers.includes("preflight_qa_blocked:content:gold_standard:first_3_seconds_hook_below_reference"),
  );
});

test("goal dry-run publisher deduplicates repeated story blockers in reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-dedupe-blockers-"));
  const storyPackage = await makeStoryPackage(root, "duplicate-blockers", "GREEN", "Forza Horizon 6 Reaches Steam");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T16:35:00.000Z",
    candidatePreflightReport: {
      candidates: [
        {
          id: "duplicate-blockers",
          status: "review",
          preflight_qa: {
            status: "blocked",
            blockers: [
              "content:gold_standard:motion_density_below_reference",
              "content:gold_standard:motion_density_below_reference",
            ],
            warnings: [],
          },
        },
      ],
    },
  });

  const blockers = plan.blocked_stories[0].blockers;
  assert.equal(
    blockers.filter((blocker) => blocker === "preflight_qa_blocked:content:gold_standard:motion_density_below_reference").length,
    1,
  );
  assert.equal(new Set(blockers).size, blockers.length);
});

test("goal dry-run publisher preserves scheduler QA check failures on blocked stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-preflight-checks-"));
  const storyPackage = await makeStoryPackage(
    root,
    "aggregate-blocked",
    "GREEN",
    "Star Wars Zero Company Is More Than XCOM",
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T12:07:00.000Z",
    requireSchedulerPreflight: true,
    candidatePreflightReport: {
      candidates: [
        {
          id: "aggregate-blocked",
          status: "review",
          preflight_qa: {
            status: "blocked",
            blockers: ["aggregate_benchmark:upstream:goal09_sound_design_engine_blocked"],
            checks: {
              aggregate_benchmark: {
                result: "fail",
                failures: [
                  "upstream:goal09_sound_design_engine_blocked",
                  "upstream:goal08_visual_v4_renderer_blocked",
                  "director:unsuitable_duration",
                  "render:sfx_mix_policy_stale",
                  "render:visual_design_policy_stale",
                  "visual:gold_standard:motion_density_below_reference",
                ],
              },
            },
          },
        },
      ],
    },
  });

  const blocked = plan.blocked_stories.find((story) => story.story_id === "aggregate-blocked");
  assert.ok(blocked);
  assert.deepEqual(blocked.scheduler_preflight.checks.aggregate_benchmark.failures, [
    "upstream:goal09_sound_design_engine_blocked",
    "upstream:goal08_visual_v4_renderer_blocked",
    "director:unsuitable_duration",
    "render:sfx_mix_policy_stale",
    "render:visual_design_policy_stale",
    "visual:gold_standard:motion_density_below_reference",
  ]);
});

test("goal dry-run publisher blocks clean packages when scheduler preflight is required but missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-required-preflight-missing-"));
  const storyPackage = await makeStoryPackage(
    root,
    "missing-required-preflight",
    "GREEN",
    "Forza Horizon 6 Reaches Steam",
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T14:05:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    requireSchedulerPreflight: true,
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.summary.scheduler_preflight_required, true);
  assert.equal(plan.summary.scheduler_preflight_report_loaded, false);
  assert.equal(plan.summary.preflight_checked_story_count, 0);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.equal(plan.overall_verdict, "RED");
  assert.ok(plan.blocked_stories[0].blockers.includes("scheduler_preflight_report_missing"));
});

test("goal dry-run publisher quarantines unsafe packages excluded from scheduler preflight without vetoing clean candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-quarantine-"));
  const readyPackage = await makeStoryPackage(root, "preflight-ready", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const unsafePackage = await makeStoryPackage(root, "source-held", "RED", "Capturing Has One Player Question");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, unsafePackage],
    generatedAt: "2026-05-26T08:15:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "preflight-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.equal(plan.ready_for_unattended_publish, false);
  assert.ok(plan.readiness_reasons.includes("stories_quarantined_or_operator_held"));
  assert.ok(!plan.readiness_reasons.includes("stories_blocked"));
  assert.ok(!plan.readiness_reasons.includes("incident_guard_failed"));
  assert.equal(plan.held_stories[0].story_id, "source-held");
  assert.ok(plan.held_stories[0].hold_reasons.includes("preflight_candidate_missing"));
  assert.ok(plan.held_stories[0].blockers.includes("publish_verdict_not_green"));
  assert.equal(plan.summary.planned_action_count, 7);
});

test("goal dry-run publisher quarantines work-order dead-end blockers without hiding clean candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-work-order-quarantine-"));
  const readyPackage = await makeStoryPackage(root, "bridge-ready", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const deadEndPackage = await makeStoryPackage(root, "image-post-dead-end", "RED", "Capturing Has One Player Question");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, deadEndPackage],
    generatedAt: "2026-05-26T11:40:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    repairWorkOrder: {
      jobs: [
        {
          story_id: "image-post-dead-end",
          status: "blocked_on_render_inputs",
          actions: [
            {
              action_id: "repair_public_output_coherence",
              status: "reject_recommended",
              repair_lane: "reject_or_human_review_non_news_image_post",
              dead_end_blocker: true,
              operator_approval_required: true,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.summary.incident_guard_failed_story_count, 0);
  assert.equal(plan.summary.quarantined_incident_guard_failed_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 7);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.ok(plan.readiness_reasons.includes("stories_quarantined_or_operator_held"));
  assert.ok(!plan.readiness_reasons.includes("incident_guard_failed"));
  assert.equal(plan.held_stories[0].story_id, "image-post-dead-end");
  assert.equal(plan.held_stories[0].status, "quarantined_by_repair_work_order");
  assert.ok(plan.held_stories[0].hold_reasons.includes("dead_end_repair_work_order"));
  assert.ok(plan.held_stories[0].repair_lanes.includes("reject_or_human_review_non_news_image_post"));
});

test("goal dry-run publisher keeps dead-end repair lanes visible on stories already held by scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-work-order-preheld-"));
  const readyPackage = await makeStoryPackage(root, "bridge-ready", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const deadEndPackage = await makeStoryPackage(root, "image-post-preheld", "RED", "Capturing Has One Player Question");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, deadEndPackage],
    generatedAt: "2026-05-27T12:05:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
    repairWorkOrder: {
      jobs: [
        {
          story_id: "image-post-preheld",
          status: "blocked_on_render_inputs",
          blockers: ["public_copy_repair_required"],
          actions: [
            {
              action_id: "repair_public_output_coherence",
              status: "reject_recommended",
              repair_lane: "reject_or_human_review_non_news_image_post",
              dead_end_blocker: true,
              operator_approval_required: true,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.held_stories[0].story_id, "image-post-preheld");
  assert.equal(plan.held_stories[0].status, "quarantined_before_scheduler_preflight");
  assert.ok(plan.held_stories[0].hold_reasons.includes("preflight_candidate_missing"));
  assert.ok(plan.held_stories[0].hold_reasons.includes("dead_end_repair_work_order"));
  assert.ok(plan.held_stories[0].hold_reasons.includes("operator_required"));
  assert.ok(plan.held_stories[0].repair_lanes.includes("reject_or_human_review_non_news_image_post"));
});

test("goal dry-run publisher still blocks a clean package that is missing scheduler preflight evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-missing-preflight-"));
  const storyPackage = await makeStoryPackage(root, "missing-preflight", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T08:20:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [],
    },
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.held_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.overall_verdict, "RED");
  assert.ok(plan.blocked_stories[0].blockers.includes("preflight_candidate_missing"));
});

test("goal dry-run publisher treats upstream anti-spam preflight exclusions as skipped", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-upstream-skipped-"));
  const storyPackage = await makeStoryPackage(root, "duplicate-deferred", "GREEN", "Forza Horizon 6 Reviews Are In");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-29T00:45:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [],
      excluded: [
        {
          id: "duplicate-deferred",
          reason: "upstream_skipped:anti_spam_duplicate_deferred:deferred_by_goal20_duplicate_cluster",
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.skipped_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.equal(plan.skipped_stories[0].story_id, "duplicate-deferred");
  assert.equal(plan.skipped_stories[0].status, "anti_spam_duplicate_deferred");
  assert.equal(plan.skipped_stories[0].reason, "deferred_by_goal20_duplicate_cluster");
});

test("goal dry-run publisher honours Goal20 skipped rows when scheduler only lists active bridge candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-goal20-report-skip-"));
  const activeStory = await makeStoryPackage(root, "active-story", "GREEN", "Hades II Just Broke PlayStation's Silence");
  const skippedStory = await makeStoryPackage(root, "duplicate-deferred", "GREEN", "Forza Horizon 6 Reviews Are In", {
    renderStorySfxAssets: [
      { asset_id: "old-impact", role: "impact", provider_id: "sonniss", rights_basis: "sonniss_game_audio_gdc_bundle_license" },
    ],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [activeStory, skippedStory],
    generatedAt: "2026-05-29T01:10:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    requireSchedulerPreflight: true,
    candidatePreflightReport: {
      candidates: [
        {
          id: "active-story",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
      excluded: [],
    },
    upstreamAntiSpamReport: {
      stories: [
        {
          story_id: "duplicate-deferred",
          status: "skipped",
          skipped_status: "anti_spam_duplicate_deferred",
          skipped_reason: "deferred_by_goal20_duplicate_cluster",
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.held_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.skipped_story_count, 1);
  assert.equal(plan.skipped_stories[0].story_id, "duplicate-deferred");
  assert.equal(plan.skipped_stories[0].status, "anti_spam_duplicate_deferred");
  assert.equal(plan.skipped_stories[0].reason, "deferred_by_goal20_duplicate_cluster");
});

test("goal dry-run publisher holds operator-gated direct-video media gaps with render-input repair requirements", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-missing-preflight-workorder-"));
  const storyPackage = await makeStoryPackage(root, "motion-floor-missing", "GREEN", "Forza Horizon 6 Scores 84 On PC Gamer");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T11:45:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [],
    },
    repairWorkOrder: {
      jobs: [
        {
          story_id: "motion-floor-missing",
          status: "blocked_on_render_inputs",
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              status: "operator_required",
              repair_lane: "additional_direct_video_motion_required",
              exact_missing_input: "at least 5 direct-video motion clips",
              recommended_command: "npm run ops:v4-motion-pack -- --story-id motion-floor-missing",
              auto_repairable: false,
              operator_approval_required: true,
              dead_end_blocker: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.ok(plan.held_stories[0].hold_reasons.includes("preflight_candidate_missing"));
  assert.ok(plan.held_stories[0].hold_reasons.includes("operator_source_review_required"));
  assert.ok(plan.held_stories[0].blockers.includes("render_input_blocked:direct_video_motion_clip_floor_not_met"));
  assert.equal(plan.held_stories[0].render_input_requirements.length, 1);
  assert.equal(plan.held_stories[0].render_input_requirements[0].repair_lane, "additional_direct_video_motion_required");
  assert.equal(plan.held_stories[0].render_input_requirements[0].operator_approval_required, true);
});

test("goal dry-run publisher holds generated-only benchmark failures for operator source review", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-operator-source-hold-"));
  const readyPackage = await makeStoryPackage(root, "bridge-ready", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const sourceReviewPackage = await makeStoryPackage(
    root,
    "source-review-needed",
    "GREEN",
    "Super Mario RPG Drops To $15",
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, sourceReviewPackage],
    generatedAt: "2026-05-28T06:05:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
    repairWorkOrder: {
      jobs: [
        {
          story_id: "source-review-needed",
          status: "blocked_on_render_inputs",
          blockers: ["visual_evidence:generated_only_motion_deck", "visual_evidence:no_real_visual_media_asset"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              status: "operator_required",
              repair_lane: "real_visual_media_required_after_owned_explainer_deck_failed_benchmark",
              exact_missing_input:
                "official or licensed real visual media, or human-review rejection for a generated-only explainer deck that failed benchmark",
              auto_repairable: false,
              operator_approval_required: true,
              dead_end_blocker: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.ok(plan.readiness_reasons.includes("stories_quarantined_or_operator_held"));
  assert.ok(!plan.readiness_reasons.includes("stories_blocked"));
  assert.equal(plan.held_stories[0].story_id, "source-review-needed");
  assert.equal(plan.held_stories[0].status, "held_for_operator_source_review");
  assert.ok(plan.held_stories[0].hold_reasons.includes("preflight_candidate_missing"));
  assert.ok(plan.held_stories[0].hold_reasons.includes("operator_source_review_required"));
  assert.ok(plan.held_stories[0].repair_lanes.includes("real_visual_media_required_after_owned_explainer_deck_failed_benchmark"));
  assert.equal(plan.held_stories[0].operator_approval_required, true);
  assert.deepEqual(plan.held_stories[0].blockers, [
    "preflight_candidate_missing",
    "render_input_blocked:visual_evidence:generated_only_motion_deck",
    "render_input_blocked:visual_evidence:no_real_visual_media_asset",
  ]);
});

test("goal dry-run publisher skips visually unsupported stories after a source-review artefact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-visual-source-reject-"));
  const readyPackage = await makeStoryPackage(root, "bridge-ready", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const sourceReviewPackage = await makeStoryPackage(
    root,
    "source-review-needed",
    "GREEN",
    "Super Mario RPG Drops To $15",
  );
  await fs.outputJson(path.join(sourceReviewPackage.artifact_dir, "visual_source_review.json"), {
    schema_version: 1,
    story_id: "source-review-needed",
    decision: "defer_until_rights_backed_media_available",
    reason: "no rights-backed real visual media is available",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, sourceReviewPackage],
    generatedAt: "2026-05-28T23:50:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
    repairWorkOrder: {
      jobs: [
        {
          story_id: "source-review-needed",
          status: "blocked_on_render_inputs",
          blockers: ["visual_evidence:generated_only_motion_deck", "visual_evidence:no_real_visual_media_asset"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              status: "operator_required",
              repair_lane: "real_visual_media_required_after_owned_explainer_deck_failed_benchmark",
              auto_repairable: false,
              operator_approval_required: true,
              dead_end_blocker: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.held_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.skipped_story_count, 1);
  assert.equal(plan.skipped_stories[0].story_id, "source-review-needed");
  assert.equal(plan.skipped_stories[0].status, "visual_source_deferred");
  assert.equal(plan.skipped_stories[0].reason, "defer_until_rights_backed_media_available");
  assert.equal(plan.overall_verdict, "GREEN");
});

test("goal dry-run publisher holds stale current-news incident failures when a repair lane exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-temporal-hold-"));
  const readyPackage = await makeStoryPackage(
    root,
    "bridge-ready",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
  );
  const stalePackage = await makeStoryPackage(
    root,
    "stale-current-news",
    "GREEN",
    "Crimson Desert Is Already Live",
    {
      canonicalPatch: {
        canonical_subject: "Crimson Desert",
        selected_title: "Crimson Desert Is Already Live",
        first_spoken_line: "Crimson Desert is already live on PC and console.",
        narration_script:
          "Crimson Desert is already live, and the player question is whether the launch timing still matters.",
        confirmed_claims: ["Crimson Desert launched on March 19, 2026."],
        allowed_public_wording: ["Crimson Desert is already live."],
      },
    },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, stalePackage],
    generatedAt: "2026-05-28T22:57:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
        {
          id: "stale-current-news",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
    repairWorkOrder: {
      jobs: [
        {
          story_id: "stale-current-news",
          status: "blocked_on_render_inputs",
          blockers: ["stale_temporal_story_review_required"],
          actions: [
            {
              action_id: "review_stale_temporal_story",
              status: "human_review_required",
              repair_lane: "stale_temporal_story_human_review",
              exact_missing_input: "reject, defer or source-backed reframe",
              auto_repairable: false,
              operator_approval_required: true,
              dead_end_blocker: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.summary.incident_guard_failed_story_count, 0);
  assert.equal(plan.summary.quarantined_incident_guard_failed_story_count, 1);
  assert.equal(plan.summary.total_incident_guard_failed_story_count, 1);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.ok(plan.readiness_reasons.includes("stories_quarantined_or_operator_held"));
  assert.ok(!plan.readiness_reasons.includes("incident_guard_failed"));
  assert.equal(plan.held_stories[0].story_id, "stale-current-news");
  assert.equal(plan.held_stories[0].status, "held_for_operator_source_review");
  assert.ok(plan.held_stories[0].repair_lanes.includes("stale_temporal_story_human_review"));
  assert.ok(plan.held_stories[0].blockers.includes("incident:stale_temporal_claim"));
  assert.ok(plan.held_stories[0].blockers.includes("incident:current_wording_on_old_event"));
});

test("goal dry-run publisher skips stale current-news stories after a reject review artefact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-temporal-reject-"));
  const readyPackage = await makeStoryPackage(
    root,
    "bridge-ready",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
  );
  const stalePackage = await makeStoryPackage(
    root,
    "stale-current-news",
    "GREEN",
    "Crimson Desert Is Already Live",
    {
      canonicalPatch: {
        canonical_subject: "Crimson Desert",
        selected_title: "Crimson Desert Is Already Live",
        first_spoken_line: "Crimson Desert is already live on PC and console.",
        narration_script:
          "Crimson Desert is already live, and the player question is whether the launch timing still matters.",
        confirmed_claims: ["Crimson Desert launched on March 19, 2026."],
        allowed_public_wording: ["Crimson Desert is already live."],
      },
    },
  );
  await fs.outputJson(path.join(stalePackage.artifact_dir, "stale_temporal_review.json"), {
    schema_version: 1,
    story_id: "stale-current-news",
    decision: "reject_stale_current_news_candidate",
    reason: "current-news wording relies on an old dated event",
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [readyPackage, stalePackage],
    generatedAt: "2026-05-28T23:30:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
        {
          id: "stale-current-news",
          status: "review",
          preflight_qa: {
            status: "blocked",
            blockers: ["incident_guard:incident:stale_temporal_claim"],
            warnings: [],
          },
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.held_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.skipped_story_count, 1);
  assert.equal(plan.summary.incident_guard_failed_story_count, 0);
  assert.equal(plan.skipped_stories[0].story_id, "stale-current-news");
  assert.equal(plan.skipped_stories[0].status, "stale_temporal_rejected");
  assert.equal(plan.skipped_stories[0].reason, "reject_stale_current_news_candidate");
  assert.equal(plan.overall_verdict, "GREEN");
});

test("goal dry-run publisher accepts legacy publish-ready scheduler reports without embedded preflight QA", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-legacy-preflight-"));
  const storyPackage = await makeStoryPackage(root, "bridge-ready-story", "GREEN", "Forza Horizon 6 Reaches Steam");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T14:10:00.000Z",
    candidatePreflightReport: {
      candidates: [
        {
          id: "bridge-ready-story",
          status: "publish_ready",
          reasons: [
            "scheduler_bridge_candidate",
            "mp4_present",
            "audio_evidence_present",
            "thumbnail_or_cover_present",
            "caption_or_description_present",
          ],
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.preflight_checked_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 7);
});

test("goal dry-run publisher holds bridge candidates with stale source-family preflight warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-preflight-warning-"));
  const storyPackage = await makeStoryPackage(root, "warning-ready-story", "GREEN", "Steam Controller Date May Have Leaked");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T20:45:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
    candidatePreflightReport: {
      candidates: [
        {
          id: "warning-ready-story",
          status: "publish_ready",
          preflight_qa: {
            status: "warn",
            blockers: [],
            warnings: ["bridge_motion_governance:stale_source_family_evidence_ignored"],
          },
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.held_story_count, 1);
  assert.equal(plan.overall_verdict, "AMBER");
  assert.equal(plan.held_stories[0].story_id, "warning-ready-story");
  assert.equal(plan.held_stories[0].status, "held_for_scheduler_warning");
  assert.ok(plan.held_stories[0].hold_reasons.includes("preflight_warning_requires_operator_review"));
  assert.ok(plan.held_stories[0].blockers.includes("preflight_qa_warn:bridge_motion_governance:stale_source_family_evidence_ignored"));
  assert.equal(plan.summary.planned_action_count, 0);
});

test("goal dry-run publisher trusts refreshed artefact verdict over stale package snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-package-"));
  const storyPackage = await makeStoryPackage(root, "stale-package-ready", "RED", "Forza Horizon 6 Reaches Steam");
  await fs.writeJson(
    path.join(storyPackage.artifact_dir, "publish_verdict.json"),
    {
      verdict: "GREEN",
      can_auto_publish: true,
      reason_codes: [],
    },
    { spaces: 2 },
  );
  const platformManifestPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const platformManifest = await fs.readJson(platformManifestPath);
  await fs.writeJson(
    platformManifestPath,
    {
      ...platformManifest,
      publish_status: "GREEN",
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T09:05:00.000Z",
    candidatePreflightReport: {
      candidates: [
        {
          id: "stale-package-ready",
          status: "publish_ready",
          preflight_qa: { status: "pass", blockers: [], warnings: [] },
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.preflight_checked_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 7);
});

test("goal dry-run publisher skips stories the scheduler excluded because they are already public", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-already-public-"));
  const storyPackage = await makeStoryPackage(root, "already-public-story", "GREEN", "Boltgun 2 Already Feels Loud");

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T14:15:00.000Z",
    candidatePreflightReport: {
      candidates: [],
      excluded: [
        {
          id: "already-public-story",
          reason: "already_has_public_platform_id:youtube_post_id,youtube_url",
        },
      ],
    },
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.summary.skipped_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.equal(plan.skipped_stories[0].reason, "already_has_public_platform_id:youtube_post_id,youtube_url");
});

test("goal dry-run publisher blocks non-GREEN or incomplete packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-blocked-"));
  const blocked = await makeStoryPackage(root, "blocked-story", "RED");
  const missing = await makeStoryPackage(root, "missing-story", "GREEN");
  await fs.remove(path.join(missing.artifact_dir, "captions.srt"));

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [blocked, missing],
    generatedAt: "2026-05-22T00:21:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 2);
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("publish_verdict_not_green"));
  assert.ok(plan.blocked_stories[1].blockers.includes("missing_artefact:captions.srt"));
});

test("goal dry-run publisher blocks packages without post-render visual QA proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-visual-qa-missing-"));
  const storyPackage = await makeStoryPackage(root, "visual-qa-missing", "GREEN", "Boltgun 2 Leaves The Corridors", {
    canonicalSubject: "Warhammer 40,000: Boltgun 2",
  });
  await fs.remove(path.join(storyPackage.artifact_dir, "visual_quality_report.json"));

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T01:10:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("missing_artefact:visual_quality_report.json"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:post_render_visual_qa_missing"));
});

test("goal dry-run publisher blocks stale on-disk public coherence reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-coherence-"));
  const storyPackage = await makeStoryPackage(root, "stale-coherence-story");
  await fs.outputJson(path.join(storyPackage.artifact_dir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    manifest: {
      selected_title: "Old title that used to pass",
      thumbnail_headline: "OLD THUMB",
      first_spoken_line: "Old opening line.",
      narration_script: "Old script that does not match the canonical manifest.",
      description: "Old description.",
      source_card_label: "Reddit",
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-30T23:20:00.000Z",
    platformOperationalConfig: allPlatformsEnabled(),
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("stale_public_output_coherence_report"));
  assert.ok(
    plan.blocked_stories[0].blockers.includes("stale_public_output_coherence_field:first_spoken_line"),
  );
  assert.equal(plan.public_output_coherence_report?.verdict, "fail");
  assert.ok(
    plan.public_output_coherence_report.stories[0].blockers.includes("stale_public_output_coherence_report"),
  );
});

test("goal dry-run publisher blocks packages with weak first-frame visual evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-visual-qa-weak-"));
  const storyPackage = await makeStoryPackage(root, "visual-qa-weak", "GREEN", "Boltgun 2 Leaves The Corridors", {
    canonicalSubject: "Warhammer 40,000: Boltgun 2",
    motionDensityScore: 61,
    firstThreeSecondsHookScore: 58,
    sourceLockQualityScore: 42,
    captionLegibilityScore: 64,
    cardHierarchyScore: 51,
    mediaHousePolishScore: 57,
    sourceLocksReadable: false,
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T01:12:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:first_frame_weak"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:source_lock_unreadable"));
});

test("goal dry-run publisher blocks generated-only orange-card motion decks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-generated-only-"));
  const storyPackage = await makeStoryPackage(
    root,
    "generated-only-story",
    "GREEN",
    "PlayStation's Pricing Test Has A Legal Problem",
    { canonicalSubject: "PlayStation Store" },
  );
  const artifactDir = storyPackage.artifact_dir;
  const generatedClips = Array.from({ length: 8 }, (_, index) => ({
    id: `generated-only-story-owned-motion-${index + 1}`,
    path: `output/generated-motion/generated-only-story/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/generated-only-story/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    source_family: `orange_card_${index + 1}`,
  }));
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    id: "generated-only-story",
    video_clips: generatedClips.map((clip) => clip.path),
    visual_v4_bridge_video_clips: generatedClips,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: generatedClips.map((clip) => ({
      ...clip,
      licence_basis: "owned_generated_editorial_motion_graphic",
      commercial_use_allowed: true,
      approval_status: "approved",
    })),
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T12:40:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("visual_evidence:generated_only_motion_deck"));
  assert.ok(plan.blocked_stories[0].blockers.includes("visual_evidence:no_real_visual_media_asset"));
});

test("goal dry-run publisher blocks owned explainer decks unless a verified source exception is recorded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-owned-explainer-"));
  const storyPackage = await makeStoryPackage(
    root,
    "owned-explainer-story",
    "GREEN",
    "Xbox Fans Used Feedback To Demand Exclusives",
    { canonicalSubject: "Xbox" },
  );
  const artifactDir = storyPackage.artifact_dir;
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `owned-explainer-story-owned-motion-${index + 1}`,
    path: `output/generated-motion/owned-explainer-story/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/owned-explainer-story/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    rights_risk_class: "owned_generated_motion",
    source_family: `owned_explainer_${index + 1}`,
    motion_family: `owned_explainer_${index + 1}`,
    owned_explainer_visual_plan: true,
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  await Promise.all(
    clips.map((clip) => fs.outputFile(path.join(root, clip.path), Buffer.alloc(1600, 3))),
  );
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    id: "owned-explainer-story",
    video_clips: clips.map((clip) => clip.path),
    visual_v4_bridge_video_clips: clips,
  });
  await fs.outputJson(path.join(artifactDir, "owned_motion_manifest.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    materialised_clips: clips,
    distinct_motion_families: clips.map((clip) => clip.motion_family),
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    owned_explainer_visual_plan: true,
    clips,
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
      distinct_source_families: clips.map((clip) => clip.source_family),
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [],
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "generated_motion",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: 0.03,
    })),
  });
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    primary_source: "Reddit",
    primary_source_url: "https://www.reddit.com/r/GamingLeaksAndRumours/comments/example/xbox/",
    source_card_label: "Reddit",
  });

  let plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T16:10:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("visual_evidence:generated_only_motion_deck"));

  await fs.writeJson(canonicalPath, {
    ...canonical,
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/example",
    source_card_label: "Eurogamer",
  });

  plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T16:12:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.equal(plan.ready_stories[0].visual_evidence_profile.owned_explainer_motion_ready, true);
  assert.equal(plan.ready_stories[0].visual_evidence_profile.owned_explainer_exception_approved, true);
});

test("goal dry-run publisher blocks screenshot-derived-only V4 packages as not rich gameplay motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-screenshot-only-"));
  const storyPackage = await makeStoryPackage(
    root,
    "screenshot-only-story",
    "GREEN",
    "The Expanse Shows A Risky First Look",
    { canonicalSubject: "The Expanse: Osiris Reborn" },
  );
  const artifactDir = storyPackage.artifact_dir;
  const screenshotClips = Array.from({ length: 8 }, (_, index) => ({
    id: `screenshot-only-story-still-motion-${index + 1}`,
    path: `output/video_cache/screenshot-only-story-still-motion-${index + 1}.mp4`,
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/app/screenshot-${index + 1}.jpg`,
    source_type: "screenshot",
    source_family: `steam_screenshot_${index + 1}`,
    media_kind: "visual_still",
  }));
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    id: "screenshot-only-story",
    video_clips: screenshotClips.map((clip) => clip.path),
    visual_v4_bridge_video_clips: screenshotClips,
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: screenshotClips.map((clip) => ({
      ...clip,
      asset_type: "screenshot_derived_motion_clip",
      kind: "video",
      licence_basis: "source_documented_transformative_editorial_use",
      allowed_use: "screenshot_derived_editorial_motion",
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
    })),
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T15:30:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("visual_evidence:direct_video_motion_missing"));
});

test("goal dry-run publisher blocks newer external V4 motion-pack blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-motion-pack-blocked-"));
  const storyPackage = await makeStoryPackage(
    root,
    "motion-pack-blocked-story",
    "GREEN",
    "Hades II Broke PlayStation's Silence",
    {
      canonicalSubject: "Hades II",
      renderGeneratedAt: "2026-05-23T13:50:00.000Z",
      audioSegmentGeneratedAt: "2026-05-23T13:55:00.000Z",
    },
  );
  const motionPackRoot = path.join(root, "motion-packs");
  await fs.outputJson(path.join(motionPackRoot, "motion-pack-blocked-story_motion_pack_manifest.json"), {
    story_id: "motion-pack-blocked-story",
    generated_at: "2026-05-23T14:00:00.000Z",
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
      ],
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T14:05:00.000Z",
    motionPackRoot,
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("visual_v4_motion_pack_blocked:v4_motion_blocked"));
  assert.ok(
    plan.blocked_stories[0].blockers.includes(
      "visual_v4_motion_pack:actual_motion_clip_minimum_not_met",
    ),
  );
});

test("goal dry-run publisher lets final render evidence supersede stale motion-pack minimum blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-motion-pack-final-evidence-"));
  const storyPackage = await makeStoryPackage(
    root,
    "final-evidence-story",
    "GREEN",
    "Subnautica 2 Dev Calls Out Leakers",
    {
      canonicalSubject: "Subnautica 2",
      renderGeneratedAt: "2026-05-23T13:50:00.000Z",
      audioSegmentGeneratedAt: "2026-05-23T13:55:00.000Z",
    },
  );
  const artifactDir = storyPackage.artifact_dir;
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `subnautica-real-motion-${index + 1}`,
    type: "motion_clip",
    path: `output/video_cache/subnautica-real-motion-${index + 1}.mp4`,
    source_url:
      index < 2
        ? `https://cdn.example.test/subnautica-official-video-${index + 1}.mp4`
        : `https://cdn.example.test/subnautica-official-screenshot-motion-${index + 1}.mp4`,
    source_type: index < 2 ? "official_trailer_segment" : "official_screenshot_motion",
    source_url_kind: "direct_video",
    media_kind: "direct_video",
    source_family: `subnautica_official_family_${index + 1}`,
    rights_risk_class: "official_reference_only",
    validated: true,
    segmentValidationPassed: true,
  }));
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: clips,
    visual_v4_bridge_video_clips: clips,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
    },
    motion_inventory: {
      production_motion_clips: clips,
      accepted_local_clips: clips,
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
  const motionPackRoot = path.join(root, "motion-packs");
  await fs.outputJson(path.join(motionPackRoot, "final-evidence-story_motion_pack_manifest.json"), {
    story_id: "final-evidence-story",
    generated_at: "2026-05-23T14:00:00.000Z",
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
      ],
    },
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T14:05:00.000Z",
    motionPackRoot,
  });

  assert.equal(plan.summary.ready_story_count, 1);
  assert.equal(plan.summary.blocked_story_count, 0);
  assert.ok(
    plan.ready_stories[0].warnings.includes(
      "external_motion_pack_minimums_superseded_by_final_render_evidence",
    ),
  );
});

test("goal dry-run publisher blocks packages with rough public copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-copy-"));
  const storyPackage = await makeStoryPackage(
    root,
    "bad-copy-story",
    "GREEN",
    'Honestly? We botched it" Just Raised The Stakes',
  );
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      canonical_subject: 'Honestly? We botched it"',
      first_spoken_line: "Honestly?",
      narration_script: 'Honestly? We botched it" just gave players the update they needed.',
      description: 'Honestly? We botched it": Kickstarter apologised. Read more Source: Eurogamer.',
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T02:55:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("public_copy:malformed_quote_title"));
});

test("goal dry-run publisher blocks stale platform packs before publish actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-stale-copy-"));
  const storyPackage = await makeStoryPackage(
    root,
    "stale-platform-pack",
    "GREEN",
    "Subnautica 2 Is Keeping Its Peaceful Rule",
    { canonicalSubject: "Subnautica 2" },
  );
  const platformPath = path.join(storyPackage.artifact_dir, "platform_publish_manifest.json");
  const platform = await fs.readJson(platformPath);
  platform.outputs.x = {
    hot_take_post:
      "Forza Horizon 6 is the part of this story everyone will argue about.",
    source_safe_post: "Forza Horizon 6 Just Got A Date\n\nSource: Respawnfirst.",
    thread_posts: [
      "Forza Horizon 6 Just Got A Date",
      "Source: Respawnfirst.",
    ],
  };
  platform.outputs.threads = {
    discussion_post:
      "Forza Horizon 6 is worth watching for the player impact, not just the headline.",
  };
  platform.outputs.pinterest = {
    pin_title: "Forza Horizon 6 story guide",
    pin_description: "Racing setup notes are on the story page.",
  };
  await fs.writeJson(platformPath, platform, { spaces: 2 });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T12:55:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("public_copy:platform_copy_missing_canonical_subject"));
  assert.equal(plan.summary.planned_action_count, 0);
});

test("goal dry-run publisher blocks malformed article-fragment descriptions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-desc-fragment-"));
  const storyPackage = await makeStoryPackage(
    root,
    "kickstarter-fragment-story",
    "GREEN",
    "Kickstarter Just Walked Back Its Rules",
  );
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      canonical_subject: "Kickstarter",
      first_spoken_line: "Kickstarter just walked back one of its most controversial rule changes.",
      narration_script:
        "Kickstarter just walked back one of its most controversial rule changes. Eurogamer reports the company apologised after backlash from game creators.",
      description: '"Honestly?. Source: Eurogamer.',
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T11:25:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("public_copy:malformed_quote_description"));
});

test("goal dry-run publisher blocks placeholder story landing slugs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-placeholder-slug-"));
  const storyPackage = await makeStoryPackage(
    root,
    "placeholder-slug-story",
    "GREEN",
    "V Rising Devs Are Making Another Vampire Game",
    { canonicalSubject: "V Rising" },
  );
  await fs.writeJson(
    path.join(storyPackage.artifact_dir, "landing_page_manifest.json"),
    {
      landing_page_slug: "this-story-placeholder-slug-story",
      landing_page_route: "/p/this-story-placeholder-slug-story",
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T18:50:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.summary.planned_action_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("landing_page:placeholder_slug"));
});

test("goal dry-run publisher blocks repaired copy until the final render is regenerated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-copy-"));
  const storyPackage = await makeStoryPackage(
    root,
    "stale-copy-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
  );
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      public_copy_repaired_at: "2026-05-22T03:15:00.000Z",
    },
    { spaces: 2 },
  );
  const renderPath = path.join(storyPackage.artifact_dir, "render_manifest.json");
  const render = await fs.readJson(renderPath);
  await fs.writeJson(
    renderPath,
    {
      ...render,
      generated_at: "2026-05-22T03:10:00.000Z",
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:20:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("public_copy_newer_than_render"));
});

test("goal dry-run publisher blocks duration-repaired scripts until the final render is regenerated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-duration-"));
  const storyPackage = await makeStoryPackage(
    root,
    "stale-duration-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
  );
  const canonicalPath = path.join(storyPackage.artifact_dir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(
    canonicalPath,
    {
      ...canonical,
      duration_variant_repaired_at: "2026-05-22T03:15:00.000Z",
    },
    { spaces: 2 },
  );
  const renderPath = path.join(storyPackage.artifact_dir, "render_manifest.json");
  const render = await fs.readJson(renderPath);
  await fs.writeJson(
    renderPath,
    {
      ...render,
      generated_at: "2026-05-22T03:10:00.000Z",
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T03:20:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("duration_variant_newer_than_render"));
});

test("goal dry-run publisher blocks local proof renders from publish actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-local-proof-"));
  const storyPackage = await makeStoryPackage(
    root,
    "local-proof-story",
    "GREEN",
    "Forza Horizon 6 Exposes Xbox's Steam Bet",
    {
      finalPublishRender: false,
      renderer: "visual_v4_local_proof",
      visualTier: "local_proof_motion_graphic",
    },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T02:10:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("render_not_final_publish_ready"));
});

test("goal dry-run publisher blocks stale production renderer policy versions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-policy-"));
  const storyPackage = await makeStoryPackage(root, "stale-policy-story", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const renderPath = path.join(storyPackage.artifact_dir, "render_manifest.json");
  const render = await fs.readJson(renderPath);
  await fs.writeJson(
    renderPath,
    {
      ...render,
      sfx_mix_policy_version: "legacy_placeholder_sfx_v1",
      voice_mix_policy_version: "legacy_voice_chain_v1",
      visual_design_policy_version: "legacy_flat_cards_v1",
    },
    { spaces: 2 },
  );

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T17:50:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.equal(plan.actions.length, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:sfx_mix_policy_stale"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:voice_mix_policy_stale"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:visual_design_policy_stale"));
});

test("goal dry-run publisher blocks rendered packages that lack final narration, timestamps or motion evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-incident-inputs-"));
  const storyPackage = await makeStoryPackage(root, "missing-final-inputs", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  await fs.remove(path.join(storyPackage.artifact_dir, "narration_manifest.json"));
  await fs.remove(path.join(storyPackage.artifact_dir, "audio_manifest.json"));
  await fs.remove(path.join(storyPackage.artifact_dir, "word_timestamps.json"));
  await fs.remove(path.join(storyPackage.artifact_dir, "owned_motion_manifest.json"));

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T16:40:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:narration_missing"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:word_timestamps_missing"));
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:materialised_motion_missing"));
  assert.ok(plan.summary.incident_guard_failed_story_count >= 1);
});

test("goal dry-run publisher blocks final packages without licensed creator-studio SFX evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-sfx-source-"));
  const storyPackage = await makeStoryPackage(root, "local-sfx-only", "GREEN", "Helldivers 2 Won't Get Space Marines", {
    canonicalSubject: "Helldivers 2",
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: {
        status: "blocked",
        blockers: ["sfx_source:local_bespoke_or_generated_only"],
      },
      selected_assets: [],
    },
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T18:40:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:sfx_source_quality_unresolved"));
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_source:local_bespoke_or_generated_only"));
  assert.equal(plan.summary.planned_action_count, 0);
});

test("goal dry-run publisher blocks rendered SFX cues that lack sourced creator-studio roles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-sfx-role-coverage-"));
  const storyPackage = await makeStoryPackage(root, "thin-sfx-roles", "GREEN", "Hades II Just Broke PlayStation's Silence", {
    canonicalSubject: "Hades II",
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      required_roles: ["ui_tick"],
      covered_roles: ["ui_tick"],
      selected_assets: [
        {
          asset_id: "sonniss-tick-01",
          role: "ui_tick",
          provider_id: "sonniss",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
        },
      ],
    },
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "visual_v4_render_story.json"), {
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact" },
          { target_kind: "motion_clip", family: "whoosh" },
          { target_kind: "source_lock", family: "source_tick" },
          { target_kind: "context_caveat", family: "sub_hit" },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "sonniss-tick-01",
        role: "ui_tick",
        provider_id: "sonniss",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T08:05:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("incident:sfx_source_quality_unresolved"));
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_source:missing_role:impact"));
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_source:missing_role:transition"));
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_source:missing_role:sub_hit"));
  assert.equal(plan.summary.planned_action_count, 0);
});

test("goal dry-run publisher blocks stale renders missing newly approved SFX assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-sfx-stale-render-"));
  const storyPackage = await makeStoryPackage(root, "stale-sfx-render", "GREEN", "Hades II Just Broke PlayStation's Silence", {
    canonicalSubject: "Hades II",
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "sfx_manifest.json"), {
    cue_count: 8,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      required_roles: ["impact", "transition", "ui_tick"],
      covered_roles: ["impact", "transition", "ui_tick"],
      selected_assets: [
        { asset_id: "boom-impact-01", role: "impact", provider_id: "boom_library", rights_basis: "boom_library_media_license" },
        { asset_id: "soundly-transition-01", role: "transition", provider_id: "soundly", rights_basis: "soundly_pro_commercial_use" },
        { asset_id: "sonniss-tick-01", role: "ui_tick", provider_id: "sonniss", rights_basis: "sonniss_game_audio_gdc_bundle_license" },
      ],
    },
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "visual_v4_render_story.json"), {
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact" },
          { target_kind: "motion_clip", family: "whoosh" },
          { target_kind: "source_lock", family: "source_tick" },
        ],
      },
    },
    sfx_asset_inventory: [
      { asset_id: "sonniss-tick-01", role: "ui_tick", provider_id: "sonniss", rights_basis: "sonniss_game_audio_gdc_bundle_license" },
    ],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-28T08:10:00.000Z",
  });

  assert.equal(plan.summary.ready_story_count, 0);
  assert.equal(plan.summary.blocked_story_count, 1);
  assert.ok(plan.blocked_stories[0].blockers.includes("sfx_render_asset_mismatch"));
  assert.equal(plan.summary.planned_action_count, 0);
});

test("goal dry-run publisher blocks final renders with unstable spoken audio levels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-audio-jump-"));
  const storyPackage = await makeStoryPackage(root, "audio-jump-story", "GREEN", "Forza Horizon 6 Finally Hit Steam", {
    audioSegmentVerdict: "fail",
    audioSegmentBlockers: ["voice_segment_loudness_jump"],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-24T20:45:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(
    plan.blocked_stories[0].blockers.includes(
      "audio_segment_loudness:voice_segment_loudness_jump",
    ),
  );
});

test("goal dry-run publisher blocks stale audio loudness reports after final render regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-audio-report-"));
  const storyPackage = await makeStoryPackage(root, "stale-audio-report-story", "GREEN", "Hades II Finally Hits Console", {
    canonicalSubject: "Hades II",
    renderGeneratedAt: "2026-05-29T02:45:50.865Z",
    audioSegmentGeneratedAt: "2026-05-28T20:01:50.601Z",
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-30T23:50:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("audio_segment_loudness_report_stale_after_render"));
});

test("goal dry-run publisher blocks stale voice QA reports after audio regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-voice-report-"));
  const storyPackage = await makeStoryPackage(root, "stale-voice-report-story", "GREEN", "Hades II Finally Hits Console", {
    canonicalSubject: "Hades II",
    audioMaterializedAt: "2026-05-29T02:42:52.956Z",
    captionGeneratedAt: "2026-05-29T02:46:21.461Z",
    voiceQualityGeneratedAt: "2026-05-28T23:40:22.491Z",
    audioWordCount: 125,
    captionWordCount: 125,
    voiceQualityWordCount: 129,
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-31T00:20:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("voice_quality_report_stale_after_audio"));
  assert.ok(plan.blocked_stories[0].blockers.includes("voice_quality_report_stale_after_captions"));
  assert.ok(plan.blocked_stories[0].blockers.includes("voice_quality_word_count_mismatch"));
});

test("goal dry-run publisher blocks caption manifests that drift from final word timestamps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-caption-word-drift-"));
  const storyPackage = await makeStoryPackage(root, "caption-word-drift-story", "GREEN", "Forza Horizon 6 Finally Hit Steam", {
    audioWordCount: 125,
    captionWordCount: 118,
    voiceQualityWordCount: 125,
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-31T00:21:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("caption_manifest_word_count_mismatch"));
});

test("goal dry-run publisher blocks local voice timestamps that are not ASR-aligned", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-local-timing-"));
  const storyPackage = await makeStoryPackage(root, "local-timing-story", "GREEN", "Forza Horizon 6 Finally Hit Steam");
  await fs.outputJson(path.join(storyPackage.artifact_dir, "audio_manifest.json"), {
    status: "ready",
    provider: "local",
    voice_provider: "local_voicebox",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: 3,
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "word_timestamps.json"), {
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
      transcript:
        "Forza Horizon 6 just exposed a sharper gaming story. The source points to a clear player signal.",
    },
    words: [
      { word: "Forza", start: 0, end: 0.2 },
      { word: "Horizon", start: 0.21, end: 0.42 },
      { word: "6", start: 0.43, end: 0.5 },
    ],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T09:10:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("word_timestamps_not_asr_aligned"));
  assert.equal(
    plan.incident_guard_report.stories[0].file_evidence.word_timestamps_asr_aligned,
    false,
  );
});

test("goal dry-run publisher blocks local Whisper misrecognising Hades II as Hades tattoo", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-hades-timing-"));
  const storyPackage = await makeStoryPackage(root, "hades-timing-story", "GREEN", "Hades II Finally Hits Console", {
    canonicalSubject: "Hades II",
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "audio_manifest.json"), {
    status: "ready",
    provider: "local",
    voice_provider: "local_voicebox",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: 5,
  });
  await fs.outputJson(path.join(storyPackage.artifact_dir, "word_timestamps.json"), {
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      transcript:
        "Hades, two just exposed a sharper gaming story. The source points to a clear player signal.",
    },
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "tattoo", start: 0.21, end: 0.52 },
      { word: "just", start: 0.53, end: 0.7 },
      { word: "exposed", start: 0.71, end: 0.95 },
      { word: "a", start: 0.96, end: 1.04 },
    ],
  });

  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-26T09:20:00.000Z",
    platformOperationalConfig: {
      youtube: { state: "enabled", reason: "core_upload_path" },
    },
  });

  assert.equal(plan.overall_verdict, "RED");
  assert.equal(plan.summary.ready_story_count, 0);
  assert.ok(plan.blocked_stories[0].blockers.includes("word_timestamps_semantic_misrecognition"));
  assert.deepEqual(
    plan.incident_guard_report.stories[0].file_evidence.word_timestamp_semantic_misrecognitions,
    ["hades_two_as_hades_tattoo"],
  );
});

test("goal dry-run publisher recognises narration and timestamps stored under MEDIA_ROOT", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-media-root-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-media-root-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const storyPackage = await makeStoryPackage(root, "media-root-audio", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
    await fs.remove(path.join(storyPackage.artifact_dir, "narration.mp3"));
    await fs.remove(path.join(storyPackage.artifact_dir, "word_timestamps.json"));
    await fs.outputJson(path.join(storyPackage.artifact_dir, "narration_manifest.json"), {
      status: "ready",
      audio_path: "output/audio/media-root-audio.mp3",
      transcript:
        "Forza Horizon 6 just exposed a sharper gaming story. The source points to a clear player signal.",
    });
    await fs.outputJson(path.join(storyPackage.artifact_dir, "audio_manifest.json"), {
      status: "ready",
      narration_audio_path: "output/audio/media-root-audio.mp3",
      word_timestamps_path: "output/audio/media-root-audio_timestamps.json",
      word_timestamp_count: 3,
    });
    await fs.outputFile(
      path.join(mediaRoot, "output", "audio", "media-root-audio.mp3"),
      Buffer.alloc(1500, 2),
    );
    await fs.outputJson(path.join(mediaRoot, "output", "audio", "media-root-audio_timestamps.json"), {
      words: [
        { word: "Forza", start: 0, end: 0.2 },
        { word: "Horizon", start: 0.21, end: 0.42 },
        { word: "6", start: 0.43, end: 0.5 },
      ],
    });

    const plan = await buildGoalDryRunPublishPlan({
      storyPackages: [storyPackage],
      generatedAt: "2026-05-22T17:00:00.000Z",
    });

    assert.equal(plan.summary.ready_story_count, 1);
    assert.equal(plan.summary.blocked_story_count, 0);
    assert.equal(plan.incident_guard_report.stories[0].file_evidence.narration_ready, true);
    assert.equal(plan.incident_guard_report.stories[0].file_evidence.word_timestamps_ready, true);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal dry-run publisher writes JSON and CLI args stay dry-run by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-write-"));
  const outDir = path.join(root, "out");
  const storyPackage = await makeStoryPackage(root);
  const plan = await buildGoalDryRunPublishPlan({ storyPackages: [storyPackage] });
  const written = await writeGoalDryRunPublishPlan(plan, { outputDir: outDir });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  assert.equal(await fs.pathExists(path.join(outDir, "incident_guard_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "disaster_upload_blockers.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "public_output_coherence_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "publish_verdict.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "safe_to_publish_boolean.json")), true);
  const safeToPublish = await fs.readJson(path.join(outDir, "safe_to_publish_boolean.json"));
  assert.equal(safeToPublish.safe_to_publish_boolean, false);

  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--candidate-report",
    "next_publish_candidates.json",
    "--out-dir",
    "out",
    "--json",
  ]);
  assert.equal(args.storyPackagesPath, "packages.json");
  assert.equal(args.candidateReportPath, "next_publish_candidates.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.json, true);
  assert.equal(args.requireSchedulerPreflight, true);

  const diagnosticArgs = parseArgs(["--no-scheduler-preflight"]);
  assert.equal(diagnosticArgs.requireSchedulerPreflight, false);
});

test("goal dry-run CLI auto-loads scheduler preflight report when present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-preflight-default-"));
  const reportPath = path.join(root, "test", "output", "next_publish_candidates.json");
  await fs.outputJson(reportPath, {
    candidates: [
      {
        id: "story-one",
        status: "publish_ready",
        preflight_qa: { status: "pass", blockers: [] },
      },
    ],
  });

  const report = await readCandidateReport(root);

  assert.equal(report.candidates[0].id, "story-one");
});

test("goal dry-run CLI skips story-filtered scheduler preflight reports by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-story-filter-preflight-"));
  const reportPath = path.join(root, "test", "output", "next_publish_candidates.json");
  await fs.outputJson(reportPath, {
    generated_at: "2026-05-26T11:58:00.000Z",
    story_filter: {
      story_id: "hades-only",
      matched: 1,
      input_stories_seen: 28,
    },
    candidates: [
      {
        id: "hades-only",
        status: "publish_ready",
        preflight_qa: { status: "pass", blockers: [] },
      },
    ],
  });

  const report = await readCandidateReport(root);

  assert.equal(report, null);
});

test("goal dry-run CLI auto-loads the render input work order when present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-work-order-default-"));
  await fs.outputJson(path.join(root, "output", "goal-contract", "render_input_work_order.json"), {
    jobs: [
      {
        story_id: "dead-end-story",
        actions: [{ dead_end_blocker: true, repair_lane: "alternate_official_source_required" }],
      },
    ],
  });

  const workOrder = await readRepairWorkOrder(root);

  assert.equal(workOrder.jobs[0].story_id, "dead-end-story");
  assert.equal(workOrder.jobs[0].actions[0].dead_end_blocker, true);
});

test("goal dry-run CLI prefers current production cutover story packages by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-current-cutover-packages-"));
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "stale-package", artifact_dir: "stale" },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "production_cutover_story_packages.json"), [
    { story_id: "fresh-cutover-package", artifact_dir: "fresh" },
  ]);

  const packages = await readStoryPackages(root);

  assert.equal(packages.length, 1);
  assert.equal(packages[0].story_id, "fresh-cutover-package");
});

test("goal dry-run CLI skips stale auto-loaded scheduler preflight reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-stale-preflight-"));
  await fs.outputJson(path.join(root, "output", "goal-contract", "scheduler_bridge_candidates.json"), {
    generated_at: "2026-05-23T08:15:00.000Z",
    candidates: [{ id: "story-one" }],
  });
  await fs.outputJson(path.join(root, "test", "output", "next_publish_candidates.json"), {
    generated_at: "2026-05-23T08:00:00.000Z",
    candidates: [
      {
        id: "story-one",
        status: "review",
        preflight_qa: { status: "blocked", blockers: ["incident_guard:incident:captions_missing_or_dirty"] },
      },
    ],
  });

  const report = await readCandidateReport(root);

  assert.equal(report, null);
});

test("goal dry-run CLI treats array bridge candidates as freshness evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-array-bridge-freshness-"));
  const bridgePath = path.join(root, "output", "goal-contract", "scheduler_bridge_candidates.json");
  const reportPath = path.join(root, "test", "output", "next_publish_candidates.json");
  await fs.outputJson(bridgePath, [{ id: "story-one" }]);
  await fs.outputJson(reportPath, {
    generated_at: "2026-05-23T08:00:00.000Z",
    candidates: [
      {
        id: "story-one",
        status: "review",
        preflight_qa: { status: "blocked", blockers: ["stale_preflight"] },
      },
    ],
  });

  const freshTime = new Date("2026-05-23T08:15:00.000Z");
  await fs.utimes(bridgePath, freshTime, freshTime);

  const report = await readCandidateReport(root);

  assert.equal(report, null);
});

test("goal dry-run CLI honours explicitly supplied preflight reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-explicit-preflight-"));
  const reportPath = path.join(root, "preflight.json");
  await fs.outputJson(reportPath, {
    generated_at: "2026-05-23T08:00:00.000Z",
    candidates: [{ id: "story-one", status: "publish_ready" }],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "scheduler_bridge_candidates.json"), {
    generated_at: "2026-05-23T08:15:00.000Z",
    candidates: [{ id: "story-one" }],
  });

  const report = await readCandidateReport(root, reportPath);

  assert.equal(report.candidates[0].id, "story-one");
});

test("goal dry-run CLI auto-loads platform operational state when present", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-default-"));
  const reportPath = path.join(root, "test", "output", "platform_status.json");
  await fs.outputJson(reportPath, {
    operational: {
      tiktok: { state: "blocked_external", reason: "tiktok_direct_post_app_review" },
      twitter: { state: "disabled", reason: "x_optional_disabled" },
    },
  });

  const config = await readPlatformOperationalConfig(root);

  assert.equal(config.tiktok.state, "blocked_external");
  assert.equal(config.twitter.reason, "x_optional_disabled");
});

test("goal dry-run CLI auto-loads platform readiness doctor enablement gaps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-doctor-"));
  const reportPath = path.join(root, "test", "output", "platform_readiness_doctor.json");
  await fs.outputJson(reportPath, {
    verdict: "AMBER",
    blockers: ["tiktok_local_token_refresh_or_sync_required"],
    platforms: {
      tiktok: {
        status: "needs_local_token_refresh_or_sync",
        recommendation: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      },
      x: {
        status: "operator_disabled",
        reason: "x_optional_disabled",
        enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
        recommendation: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
      },
    },
  });

  const config = await readPlatformOperationalConfig(root);

  assert.equal(config.tiktok.state, "needs_credentials");
  assert.equal(config.tiktok.reason, "tiktok_local_token_refresh_or_sync_required");
  assert.deepEqual(config.tiktok.enablement_gaps, ["tiktok_local_token_refresh_or_sync_required"]);
  assert.match(config.tiktok.enablement_next_action, /refresh_or_sync_local_token/);
  assert.equal(config.twitter.state, "disabled");
  assert.deepEqual(config.twitter.enablement_gaps, ["x_operator_disabled", "x_api_billing_not_declared"]);
});

test("goal dry-run CLI parses prior platform status matrix without treating assumed-enabled as enabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-platform-matrix-input-"));
  const reportPath = path.join(root, "output", "goal-contract", "platform_status_matrix.json");
  await fs.outputJson(reportPath, {
    platforms: {
      youtube_shorts: { operational_state: "ready_now", operational_reason: "core_upload_path" },
      tiktok: { operational_state: "assumed_enabled", operational_reason: null },
      instagram_reels: { operational_state: "blocked", operational_reason: "recent_upload_container_failure" },
      facebook_reels: { operational_state: "ready_now", operational_reason: "facebook_reels_enabled" },
      x: { operational_state: "assumed_enabled", operational_reason: null },
      threads: { operational_state: "assumed_enabled", operational_reason: null },
      pinterest: { operational_state: "assumed_enabled", operational_reason: null },
    },
  });

  const config = await readPlatformOperationalConfig(root, reportPath);

  assert.equal(config.youtube.state, "enabled");
  assert.equal(config.tiktok.state, "assumed_enabled");
  assert.equal(config.instagram_reel.state, "blocked");
  assert.equal(config.twitter.state, "assumed_enabled");
  assert.equal(config.threads.state, "assumed_enabled");
  assert.equal(config.pinterest.state, "assumed_enabled");
});

test("goal dry-run CLI --json emits clean parseable JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-dry-run-cli-json-"));
  const storyPackage = await makeStoryPackage(root, "cli-json-story", "GREEN", "Forza Horizon 6 Exposes Xbox's Steam Bet");
  const packagesPath = path.join(root, "packages.json");
  const preflightPath = path.join(root, "preflight.json");
  const platformStatusPath = path.join(root, "platform_status.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(packagesPath, [storyPackage], { spaces: 2 });
  await fs.writeJson(
    preflightPath,
    {
      candidates: [{ id: "cli-json-story", status: "publish_ready" }],
    },
    { spaces: 2 },
  );
  await fs.writeJson(
    platformStatusPath,
    {
      operational: {
        youtube: { state: "enabled", reason: "core_upload_path" },
        tiktok: { state: "enabled", reason: "direct_post_approved" },
        instagram_reel: { state: "enabled", reason: "graph_credentials_present" },
        facebook_reel: { state: "enabled", reason: "facebook_reels_enabled" },
        twitter: { state: "enabled", reason: "x_video_enabled" },
        threads: { state: "enabled", reason: "threads_enabled_for_fixture" },
        pinterest: { state: "enabled", reason: "pinterest_enabled_for_fixture" },
      },
    },
    { spaces: 2 },
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-dry-run-publish.js",
      "--story-packages",
      packagesPath,
      "--candidate-report",
      preflightPath,
      "--platform-status",
      platformStatusPath,
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimStart().startsWith("{"), result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.ready_story_count, 1);
  assert.equal(parsed.overall_verdict, "GREEN");
  assert.equal(await fs.pathExists(path.join(outDir, "platform_status_matrix.json")), true);
});
