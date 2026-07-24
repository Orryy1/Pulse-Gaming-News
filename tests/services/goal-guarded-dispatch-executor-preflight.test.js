"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuardedDispatchExecutorPreflight,
  renderGuardedDispatchExecutorPreflightMarkdown,
  writeGuardedDispatchExecutorPreflight,
} = require("../../lib/goal-guarded-dispatch-executor-preflight");

const ROOT = path.resolve(__dirname, "..", "..");

async function evidenceFiles(root, storyId = "story-one") {
  const dir = path.join(root, "proof", storyId);
  await fs.ensureDir(dir);
  const video = path.join(dir, "visual_v4_render.mp4");
  const captions = path.join(dir, "captions.srt");
  const canonical = path.join(dir, "canonical_story_manifest.json");
  const platform = path.join(dir, "platform_publish_manifest.json");
  const render = path.join(dir, "render_manifest.json");
  await fs.writeFile(video, Buffer.alloc(2048, 1));
  await fs.writeFile(captions, "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.writeJson(canonical, { story_id: storyId, selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet" });
  await fs.writeJson(platform, {
    outputs: {
      youtube_shorts: {},
      instagram_reels: {
        variant_video_path: video,
        variant_captions_path: captions,
        platform_variant_render: {
          encoder_profile: "instagram_reels_meta_safe_h264_aac_v3",
        },
      },
    },
  });
  await fs.writeJson(render, {
    story_id: "story-one",
    premium_shell_verdict: "pass",
    hyperframes_card_count: 4,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 4,
      passCount: 4,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "forza-trailer-a" },
        { sourceRootKey: "forza-trailer-b" },
        { sourceRootKey: "forza-card-source", readableCardKind: "source" },
        { sourceRootKey: "forza-card-takeaway", readableCardKind: "takeaway" },
      ],
    },
  });
  return { video, captions, canonical, platform };
}

async function staleCaptionTimelineEvidenceFiles(root) {
  const files = await evidenceFiles(root);
  const audioDir = path.join(path.dirname(files.canonical), "audio");
  const timestamps = path.join(audioDir, "word_timestamps.json");
  await fs.ensureDir(audioDir);
  await fs.writeFile(
    files.captions,
    [
      "1",
      "00:00:00,000 --> 00:00:04,000",
      "Star Wars Monopoly sounds silly.",
      "",
      "2",
      "00:00:04,000 --> 00:00:08,000",
      "Xbox Wire says the powers matter.",
      "",
      "3",
      "00:00:08,000 --> 00:00:12,000",
      "Follow Pulse Gaming so you never miss a beat.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeJson(files.canonical, {
    story_id: "story-one",
    selected_title: "Star Wars Monopoly Could Ruin Game Night",
    word_timestamps_path: "audio/word_timestamps.json",
  });
  await fs.writeJson(timestamps, {
    words: [
      { word: "Star", start: 0, end: 0.3 },
      { word: "Wars", start: 0.31, end: 0.6 },
      { word: "Monopoly", start: 0.62, end: 1.1 },
      { word: "Follow", start: 39.4, end: 39.8 },
      { word: "Pulse", start: 39.82, end: 40.2 },
      { word: "Gaming", start: 40.22, end: 40.62 },
      { word: "beat.", start: 41.2, end: 41.58 },
    ],
  });
  return { ...files, timestamps };
}

async function gtaPronunciationEvidenceFiles(root) {
  const dir = path.join(root, "proof", "gta-vi-story");
  const audioDir = path.join(dir, "audio");
  await fs.ensureDir(audioDir);
  const video = path.join(dir, "visual_v4_render.mp4");
  const captions = path.join(dir, "captions.srt");
  const canonical = path.join(dir, "canonical_story_manifest.json");
  const platform = path.join(dir, "platform_publish_manifest.json");
  const timestamps = path.join(audioDir, "word_timestamps.json");
  const render = path.join(dir, "render_manifest.json");
  await fs.writeFile(video, Buffer.alloc(2048, 1));
  await fs.writeFile(captions, "1\n00:00:00,000 --> 00:00:01,000\nGTA VI.\n");
  await fs.writeJson(canonical, {
    story_id: "gta-vi-story",
    selected_title: "GTA VI Just Made PS5 The Version To Watch",
    canonical_game: "GTA VI",
    word_timestamps_path: "audio/word_timestamps.json",
  });
  await fs.writeJson(platform, { outputs: { youtube_shorts: {} } });
  await fs.writeJson(render, {
    story_id: "gta-vi-story",
    premium_shell_verdict: "pass",
    hyperframes_card_count: 4,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 4,
      passCount: 4,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "gta-vi-trailer-a" },
        { sourceRootKey: "gta-vi-trailer-b" },
        { sourceRootKey: "gta-vi-card-source", readableCardKind: "source" },
        { sourceRootKey: "gta-vi-card-takeaway", readableCardKind: "takeaway" },
      ],
    },
  });
  await fs.writeJson(timestamps, {
    meta: {
      transcript: "GTA see a six just made the PlayStation version the one to watch.",
      ttsPronunciationProfileVersion: "gta-safe-next-title-v8",
    },
    words: [
      { word: "GTA" },
      { word: "see" },
      { word: "a" },
      { word: "six" },
    ],
  });
  return { video, captions, canonical, platform, timestamps };
}

async function titleColonPronunciationEvidenceFiles(root) {
  const dir = path.join(root, "proof", "halo-campaign-evolved");
  const audioDir = path.join(dir, "audio");
  await fs.ensureDir(audioDir);
  const video = path.join(dir, "visual_v4_render.mp4");
  const captions = path.join(dir, "captions.srt");
  const canonical = path.join(dir, "canonical_story_manifest.json");
  const platform = path.join(dir, "platform_publish_manifest.json");
  const timestamps = path.join(audioDir, "word_timestamps.json");
  const render = path.join(dir, "render_manifest.json");
  await fs.writeFile(video, Buffer.alloc(2048, 1));
  await fs.writeFile(captions, "1\n00:00:00,000 --> 00:00:01,000\nHalo Campaign Evolved.\n");
  await fs.writeJson(canonical, {
    story_id: "halo-campaign-evolved",
    selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_game: "Halo: Campaign Evolved",
    tts_script: "Halo: Campaign Evolved just gave Xbox a real remake test.",
    word_timestamps_path: "audio/word_timestamps.json",
  });
  await fs.writeJson(platform, { outputs: { youtube_shorts: {} } });
  await fs.writeJson(render, {
    story_id: "halo-campaign-evolved",
    premium_shell_verdict: "pass",
    hyperframes_card_count: 4,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 4,
      passCount: 4,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "halo-trailer-a" },
        { sourceRootKey: "halo-trailer-b" },
        { sourceRootKey: "halo-card-source", readableCardKind: "source" },
        { sourceRootKey: "halo-card-takeaway", readableCardKind: "takeaway" },
      ],
    },
  });
  await fs.writeJson(timestamps, {
    meta: {
      transcript: "Halo Campaign Evolved just gave Xbox a real remake test.",
      spoken_text: "Halo Campaign Evolved just gave Xbox a real remake test.",
      ttsPronunciationProfileVersion: "gta-safe-next-title-comma-v17",
    },
    words: [
      { word: "Halo" },
      { word: "Campaign" },
      { word: "Evolved" },
    ],
  });
  return { video, captions, canonical, platform, timestamps };
}

function guardedDispatchPlan(files = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    dispatch_ready_action_count: 1,
    blocked_action_count: 0,
    dispatch_ready_actions: [
      {
        story_id: "story-one",
        platform: "youtube_shorts",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        operator: "MORR",
        operator_decided_at: "2026-05-31T18:50:00.000Z",
        video_path: files.video || "C:\\proof\\story-one\\visual_v4_render.mp4",
        captions_path: files.captions || "C:\\proof\\story-one\\captions.srt",
        first_frame_source: files.video || "C:\\proof\\story-one\\visual_v4_render.mp4",
        canonical_manifest_path: files.canonical || "C:\\proof\\story-one\\canonical_story_manifest.json",
        platform_publish_manifest_path: files.platform || "C:\\proof\\story-one\\platform_publish_manifest.json",
        live_publish_allowed_from_preflight: false,
        requires_guarded_live_dispatch_executor: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
    required_next_step: "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function gtaGuardedDispatchPlan(files = {}) {
  const base = guardedDispatchPlan(files);
  base.dispatch_ready_actions = [
    {
      ...base.dispatch_ready_actions[0],
      story_id: "gta-vi-story",
      title: "GTA VI Just Made PS5 The Version To Watch",
      video_path: files.video,
      captions_path: files.captions,
      first_frame_source: files.video,
      canonical_manifest_path: files.canonical,
      platform_publish_manifest_path: files.platform,
    },
  ];
  return base;
}

function titleColonGuardedDispatchPlan(files = {}) {
  const base = guardedDispatchPlan(files);
  base.dispatch_ready_actions = [
    {
      ...base.dispatch_ready_actions[0],
      story_id: "halo-campaign-evolved",
      title: "Halo: Campaign Evolved Shows The Real Remake Test",
      video_path: files.video,
      captions_path: files.captions,
      first_frame_source: files.video,
      canonical_manifest_path: files.canonical,
      platform_publish_manifest_path: files.platform,
    },
  ];
  return base;
}

function emptyGuardedDispatchPlan() {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: false,
    live_publish_allowed_from_this_tool: false,
    dispatch_ready_action_count: 0,
    blocked_action_count: 0,
    dispatch_ready_actions: [],
    required_next_step: "record_operator_approved_actions_before_guarded_dispatch",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function platformStatusMatrix(overrides = {}) {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T19:00:00.000Z",
    overall_verdict: "AMBER",
    platforms: {
      youtube_shorts: {
        platform: "youtube_shorts",
        status: "ready_now",
        operational_state: "enabled",
        blocked_action_count: 0,
        deferred_action_count: 0,
        planned_story_ids: ["story-one"],
        ...overrides.youtube_shorts,
      },
    },
    safety: {
      dry_run_only: true,
      no_network_uploads: true,
      no_public_posts: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

test("executor preflight stays AMBER when no dispatch-ready actions exist", () => {
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: emptyGuardedDispatchPlan(),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {},
    generatedAt: "2026-05-31T19:05:00.000Z",
  });

  assert.equal(report.mode, "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT");
  assert.equal(report.verdict, "AMBER");
  assert.equal(report.safe_to_publish_boolean, false);
  assert.equal(report.summary.dispatch_ready_action_count, 0);
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.advisory.includes("no_dispatch_ready_actions"));
  assert.equal(report.executor_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safety.no_network_uploads, true);
});

test("executor preflight carries forward empty guarded-plan refresh next step", () => {
  const plan = emptyGuardedDispatchPlan();
  plan.required_next_step = "refresh_candidate_supply_and_strict_dry_run_after_published_actions";
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: plan,
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {},
    generatedAt: "2026-06-21T22:45:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.executor_plan.required_next_step, "refresh_candidate_supply_and_strict_dry_run_after_published_actions");
});

test("executor preflight requires explicit action ids before any handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-no-selection-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.advisory.includes("explicit_action_ids_required"));
  assert.equal(report.executor_plan.required_next_step, "select_explicit_dispatch_action_ids");
});

test("executor preflight hands off only the scoped YouTube action while Meta remains disabled", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-youtube-scope-"));
  const storyId = "rss_5efb04ad7c4889e1";
  const files = await evidenceFiles(root, storyId);
  const plan = guardedDispatchPlan(files);
  plan.dispatch_ready_actions[0] = {
    ...plan.dispatch_ready_actions[0],
    story_id: storyId,
  };
  const matrix = platformStatusMatrix({
    youtube_shorts: {
      planned_story_ids: [storyId],
    },
  });
  for (const platform of ["instagram_reels", "facebook_reels"]) {
    matrix.platforms[platform] = {
      platform,
      status: "no_ready_actions",
      operational_state: "disabled",
      operational_reason: "microsoft_game_content_usage_rules_youtube_only",
      can_auto_publish: false,
      blocked_action_count: 0,
      deferred_action_count: 0,
      planned_story_ids: [],
      scope_disabled_story_ids: [storyId],
    };
  }

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: plan,
    platformStatusMatrix: matrix,
    selectAllDispatchReady: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(
    report.executor_plan.handoff_ready_actions.map((action) => action.action_id),
    [`${storyId}:youtube_shorts`],
  );
  assert.equal(
    report.executor_plan.handoff_ready_actions.some((action) =>
      ["instagram_reels", "facebook_reels"].includes(action.platform)),
    false,
  );
});

test("executor preflight can explicitly hand off the full dispatch-ready runway", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-full-runway-"));
  const files = await evidenceFiles(root);
  const plan = guardedDispatchPlan(files);
  plan.dispatch_ready_actions.push({
    ...plan.dispatch_ready_actions[0],
    story_id: "story-two",
    platform: "instagram_reels",
    title: "Phantom Blade Zero Turns Its Delay Into A Bigger Test",
  });
  const matrix = platformStatusMatrix({
    youtube_shorts: {
      planned_story_ids: ["story-one"],
    },
  });
  matrix.platforms.instagram_reels = {
    platform: "instagram_reels",
    status: "ready_now",
    operational_state: "enabled",
    blocked_action_count: 0,
    deferred_action_count: 0,
    planned_story_ids: ["story-two"],
  };

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: plan,
    platformStatusMatrix: matrix,
    selectAllDispatchReady: true,
    selectedActionIds: [],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.dispatch_ready_action_count, 2);
  assert.equal(report.summary.selected_action_count, 2);
  assert.equal(report.summary.handoff_ready_action_count, 2);
  assert.deepEqual(
    report.handoff_ready_actions.map((action) => action.action_id),
    ["story-one:youtube_shorts", "story-two:instagram_reels"],
  );
  assert.ok(report.advisory.includes("selected_all_dispatch_ready_actions"));
  assert.equal(report.executor_plan.ready_for_live_executor_handoff, true);
  assert.equal(report.safe_to_publish_boolean, false);
});

test("executor preflight blocks thin premium HyperFrames handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-thin-hf-"));
  const files = await evidenceFiles(root);
  await fs.writeJson(path.join(path.dirname(files.canonical), "render_manifest.json"), {
    story_id: "story-one",
    premium_shell_verdict: "pass",
    hyperframes_card_count: 1,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 1,
      passCount: 5,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "clip-a" },
        { sourceRootKey: "clip-b" },
        { sourceRootKey: "hyperframes-source", readableCardKind: "source" },
      ],
    },
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(
    report.blocked_selected_actions[0].blockers.includes("hyperframes_card_count_below_target:1/4"),
    JSON.stringify(report.blocked_selected_actions[0].blockers),
  );
});

test("executor preflight blocks stale caption SRTs that end before word timestamps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-stale-captions-"));
  const files = await staleCaptionTimelineEvidenceFiles(root);

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(
    report.blocked_selected_actions[0].blockers.includes("captions_srt_timeline_truncated_vs_word_timestamps"),
    JSON.stringify(report.blocked_selected_actions[0].blockers),
  );
});

test("executor preflight accepts duration-feasible one-card HyperFrames shorts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-duration-hf-"));
  const files = await evidenceFiles(root);
  await fs.writeJson(path.join(path.dirname(files.canonical), "render_manifest.json"), {
    story_id: "story-one",
    rendered_duration_s: 35.341,
    premium_shell_verdict: "pass",
    hyperframes_card_count: 1,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 1,
      passCount: 5,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "clip-a" },
        { sourceRootKey: "clip-b" },
        { sourceRootKey: "clip-c" },
        { sourceRootKey: "hyperframes-source", readableCardKind: "source" },
      ],
    },
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.equal(report.summary.blocked_selected_action_count, 0);
  assert.deepEqual(report.blocked_selected_actions, []);
});

test("executor preflight honours an explicit zero-card direct-motion substitution contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-direct-motion-"));
  const files = await evidenceFiles(root);
  await fs.writeJson(path.join(path.dirname(files.canonical), "render_manifest.json"), {
    story_id: "story-one",
    rendered_duration_s: 52.733,
    hyperframes_premium_shell_required: true,
    premium_shell_verdict: "pass",
    premium_shell_selected_card_count: 0,
    hyperframes_card_count: 0,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      requiredSelectedCardCount: 0,
      selectedCardCount: 0,
      passCount: 5,
      cardsOmittedForDirectMotion: true,
      selectionMode: "direct_motion_substitution",
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "official-trailer-a" },
        { sourceRootKey: "official-trailer-b" },
        { sourceRootKey: "official-gameplay-c" },
      ],
    },
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.deepEqual(report.blocked_selected_actions, []);
});

test("executor preflight accepts two balanced windows from the same visual source root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-balanced-repeat-"));
  const files = await evidenceFiles(root);
  await fs.writeJson(path.join(path.dirname(files.canonical), "render_manifest.json"), {
    story_id: "story-one",
    rendered_duration_s: 42.028,
    premium_shell_verdict: "pass",
    hyperframes_card_count: 4,
    hyperframes_premium_shell_gate: {
      verdict: "pass",
      selectedCardCount: 4,
      passCount: 4,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: [
        { sourceRootKey: "steam_trailer_alpha_window_12_5" },
        { sourceRootKey: "steam_trailer_alpha_window_42_5" },
        { sourceRootKey: "steam_trailer_beta_window_10_5" },
        { sourceRootKey: "steam_trailer_gamma_window_18_5" },
        { sourceRootKey: "steam_trailer_delta_window_24_5" },
        { sourceRootKey: "steam_trailer_epsilon_window_30_5" },
        { sourceRootKey: "source-card-window" },
        { sourceRootKey: "proof-card-window" },
      ],
    },
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.deepEqual(report.blocked_selected_actions, []);
});

test("executor preflight blocks stale GTA VI timestamp pronunciation evidence before handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-gta-profile-"));
  const files = await gtaPronunciationEvidenceFiles(root);
  const plan = gtaGuardedDispatchPlan(files);
  plan.dispatch_ready_actions[0].title = "GTAVI Starts The Preorder Fight";
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: plan,
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        planned_story_ids: ["gta-vi-story"],
      },
    }),
    selectedActionIds: ["gta-vi-story:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.equal(report.summary.blocked_selected_action_count, 1);
  assert.ok(report.blocked_selected_actions[0].blockers.includes("gta_vi_timestamp_profile_stale"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("gta_vi_spoken_stutter"));
});

test("executor preflight blocks stale colon-title timestamp pronunciation evidence before handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-title-colon-profile-"));
  const files = await titleColonPronunciationEvidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: titleColonGuardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        planned_story_ids: ["halo-campaign-evolved"],
      },
    }),
    selectedActionIds: ["halo-campaign-evolved:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.equal(report.summary.blocked_selected_action_count, 1);
  assert.ok(
    report.blocked_selected_actions[0].blockers.includes(
      "title_colon_timestamp_profile_stale",
    ),
  );
});

test("executor preflight treats compact GTAVI titles as pronunciation-sensitive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-gtavi-title-"));
  const files = await gtaPronunciationEvidenceFiles(root);
  await fs.writeJson(files.canonical, {
    story_id: "gta-vi-story",
    selected_title: "GTAVI Starts The Preorder Fight",
    canonical_game: "GTAVI",
    word_timestamps_path: "audio/word_timestamps.json",
  });
  await fs.writeJson(files.timestamps, {
    meta: {
      transcript: "Cover art starts the preorder fight.",
      spoken_text: "Cover art starts the preorder fight.",
      ttsPronunciationProfileVersion: "gta-safe-next-title-v8",
    },
    words: [
      { word: "Cover" },
      { word: "art" },
      { word: "starts" },
    ],
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: gtaGuardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        planned_story_ids: ["gta-vi-story"],
      },
    }),
    selectedActionIds: ["gta-vi-story:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocked_selected_actions[0].blockers.includes("gta_vi_timestamp_profile_stale"));
});

test("executor preflight blocks GTA VI timestamp payloads without word-level proof", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-gta-no-words-"));
  const files = await gtaPronunciationEvidenceFiles(root);
  await fs.writeJson(files.timestamps, {
    meta: {
      transcript:
        "Rockstar's next Grand Theft Auto just made the PlayStation version the one to watch.",
      spoken_text:
        "Rockstar's next Grand Theft Auto just made the PlayStation version the one to watch.",
      text:
        "Rockstar's next Grand Theft Auto just made the PlayStation version the one to watch.",
      ttsPronunciationProfileVersion: require("../../lib/tts-pronunciation")
        .TTS_PRONUNCIATION_PROFILE_VERSION,
      wordTimestampSource: "synthetic_character_alignment",
    },
    words: [],
  });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: gtaGuardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        planned_story_ids: ["gta-vi-story"],
      },
    }),
    selectedActionIds: ["gta-vi-story:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(
    report.blocked_selected_actions[0].blockers.includes(
      "gta_vi_word_timestamp_evidence_missing",
    ),
    JSON.stringify(report.blocked_selected_actions[0].blockers),
  );
});

test("executor preflight accepts runtime sentinel kill-switch clear flag", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-clear-flag-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH_CLEAR: "true",
    },
    generatedAt: "2026-05-31T19:05:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.equal(report.executor_state.emergency_kill_switch_state, "clear");
});

test("executor diagnostic preflight can use live runtime health when shell env is unset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-runtime-health-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {},
    runtimeHealth: {
      status: "ok",
      schedulerActive: true,
      runtime: {
        auto_publish: true,
        guarded_live_dispatch_enabled: true,
        emergency_kill_switch_clear: true,
        dispatch: { mode: "queue", strict: true },
      },
      deployment: { primary: true },
    },
    generatedAt: "2026-06-30T21:20:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.equal(report.executor_state.guarded_live_dispatch_enabled, true);
  assert.equal(report.executor_state.emergency_kill_switch_state, "clear");
  assert.equal(report.executor_state.source, "runtime_health");
});

test("executor diagnostic preflight does not let runtime health override an explicit local hold", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-env-wins-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "engaged",
    },
    runtimeHealth: {
      status: "ok",
      schedulerActive: true,
      runtime: {
        auto_publish: true,
        guarded_live_dispatch_enabled: true,
        emergency_kill_switch_clear: true,
        dispatch: { mode: "queue", strict: true },
      },
      deployment: { primary: true },
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.executor_state.source, "env");
  assert.ok(report.blocked_selected_actions[0].blockers.includes("guarded_live_dispatch_not_armed"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("emergency_kill_switch_not_clear"));
});

test("executor preflight rejects selected actions when executor is not armed or kill switch is not clear", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-unarmed-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "engaged",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_selected_action_count, 1);
  assert.equal(report.summary.handoff_ready_action_count, 0);
  assert.ok(report.blocked_selected_actions[0].blockers.includes("guarded_live_dispatch_not_armed"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("emergency_kill_switch_not_clear"));
});

test("executor preflight rejects selected actions if platform readiness drifts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-platform-drift-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        status: "deferred_until_platform_enabled",
        operational_state: "disabled",
        deferred_action_count: 1,
      },
    }),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_not_ready_now:youtube_shorts"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_not_enabled:youtube_shorts"));
  assert.ok(report.blocked_selected_actions[0].blockers.includes("platform_has_deferred_actions:youtube_shorts"));
});

test("executor preflight produces a non-posting handoff plan only after action ids, platform recheck and kill switch pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-green-"));
  const files = await evidenceFiles(root);
  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    generatedAt: "2026-05-31T19:05:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.selected_action_count, 1);
  assert.equal(report.summary.handoff_ready_action_count, 1);
  assert.equal(report.executor_state.guarded_live_dispatch_enabled, true);
  assert.equal(report.executor_state.emergency_kill_switch_state, "clear");
  assert.equal(report.handoff_ready_actions[0].action_id, "story-one:youtube_shorts");
  assert.equal(report.handoff_ready_actions[0].live_publish_allowed_from_preflight_only, false);
  assert.equal(report.handoff_ready_actions[0].requires_live_executor_command, true);
  assert.equal(report.executor_plan.ready_for_live_executor_handoff, true);
  assert.equal(report.executor_plan.live_publish_allowed_from_this_tool, false);
  assert.equal(report.safe_to_publish_boolean, false);

  const markdown = renderGuardedDispatchExecutorPreflightMarkdown(report);
  assert.match(markdown, /Guarded Dispatch Executor Preflight/);
  assert.match(markdown, /story-one -> youtube_shorts/);
  assert.match(markdown, /No uploads are triggered/);
});

test("executor preflight preserves governed Facebook metadata for live handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-facebook-copy-"));
  const files = await evidenceFiles(root);
  const nativeMetadata = {
    description: "Facebook description from the governed platform manifest.",
    caption: "Facebook caption from the governed platform manifest.",
    page_caption: "Facebook page caption from the governed platform manifest. More context: /p/forza",
    cover_headline: "FORZA PC BET TEST",
    landing_page_slug: "/p/forza",
    disclosure_requirements: { affiliate: false, source_attribution: true },
    disclosure_requirements_resolved: true,
    disclosures: { requirements_resolved: true, disclosure_flag: "not_required" },
    disclosure_status: { required: false, type: "none" },
    commercial_promotion: false,
    affiliate_links_allowed: false,
  };
  const plan = guardedDispatchPlan(files);
  plan.dispatch_ready_actions[0] = {
    ...plan.dispatch_ready_actions[0],
    platform: "facebook_reels",
    ...nativeMetadata,
  };
  const matrix = platformStatusMatrix();
  matrix.platforms.facebook_reels = {
    platform: "facebook_reels",
    status: "ready_now",
    operational_state: "enabled",
    blocked_action_count: 0,
    deferred_action_count: 0,
    planned_story_ids: ["story-one"],
  };

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: plan,
    platformStatusMatrix: matrix,
    selectedActionIds: ["story-one:facebook_reels"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(
    Object.fromEntries(Object.keys(nativeMetadata).map((field) => [field, report.handoff_ready_actions[0][field]])),
    nativeMetadata,
  );
  assert.deepEqual(report.executor_plan.handoff_ready_actions[0], report.handoff_ready_actions[0]);
});

test("executor preflight writes machine-readable reports and CLI emits JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-cli-"));
  const files = await evidenceFiles(root);
  const planPath = path.join(root, "guarded_dispatch_plan.json");
  const platformPath = path.join(root, "platform_status_matrix.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(planPath, guardedDispatchPlan(files), { spaces: 2 });
  await fs.writeJson(platformPath, platformStatusMatrix(), { spaces: 2 });

  const report = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });
  const written = await writeGuardedDispatchExecutorPreflight(report, { outputDir: outDir });
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight.md")), true);
  assert.equal(path.basename(written.executorPlanPath), "guarded_dispatch_executor_plan.json");

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-executor-preflight.js",
      "--guarded-dispatch-plan",
      planPath,
      "--platform-status-matrix",
      platformPath,
      "--action-id",
      "story-one:youtube_shorts",
      "--out-dir",
      outDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "1",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        PULSE_EMERGENCY_KILL_SWITCH: "clear",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.handoff_ready_action_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_preflight_report.json")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:goal-guarded-dispatch-executor-preflight"],
    "node tools/goal-guarded-dispatch-executor-preflight.js",
  );
});

test("executor preflight preserves an existing GREEN executor plan during non-live diagnostic runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-preserve-green-"));
  const files = await evidenceFiles(root);
  const outDir = path.join(root, "out");

  const green = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    generatedAt: "2026-06-16T08:45:00.000Z",
  });
  await writeGuardedDispatchExecutorPreflight(green, { outputDir: outDir });
  const executorPlanPath = path.join(outDir, "guarded_dispatch_executor_plan.json");
  const originalExecutorPlan = await fs.readJson(executorPlanPath);
  assert.equal(originalExecutorPlan.ready_for_live_executor_handoff, true);
  assert.equal(originalExecutorPlan.handoff_ready_action_count, 1);

  const diagnostic = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: [],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    generatedAt: "2026-06-16T08:50:00.000Z",
  });
  assert.equal(diagnostic.verdict, "AMBER");

  const written = await writeGuardedDispatchExecutorPreflight(diagnostic, {
    outputDir: outDir,
    preserveExistingReadyExecutorPlanOnContextOnlyNonGreen: true,
  });

  const preservedExecutorPlan = await fs.readJson(executorPlanPath);
  assert.equal(preservedExecutorPlan.generated_at, "2026-06-16T08:45:00.000Z");
  assert.equal(preservedExecutorPlan.ready_for_live_executor_handoff, true);
  assert.equal(preservedExecutorPlan.handoff_ready_action_count, 1);
  assert.equal(written.executorPlanPreserved, true);
  assert.equal(path.basename(written.nonGreenExecutorPlanPath), "guarded_dispatch_executor_plan.non_green.json");
  assert.equal(await fs.pathExists(written.nonGreenExecutorPlanPath), true);

  const report = await fs.readJson(path.join(outDir, "guarded_dispatch_executor_preflight_report.json"));
  assert.equal(report.verdict, "AMBER");
  assert.ok(report.advisory.includes("explicit_action_ids_required"));
});

test("executor preflight CLI preserves an existing GREEN plan unless overwrite is explicit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-cli-preserve-"));
  const files = await evidenceFiles(root);
  const planPath = path.join(root, "guarded_dispatch_plan.json");
  const platformPath = path.join(root, "platform_status_matrix.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(planPath, guardedDispatchPlan(files), { spaces: 2 });
  await fs.writeJson(platformPath, platformStatusMatrix(), { spaces: 2 });

  const greenResult = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-executor-preflight.js",
      "--guarded-dispatch-plan",
      planPath,
      "--platform-status-matrix",
      platformPath,
      "--action-id",
      "story-one:youtube_shorts",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-06-16T09:00:00.000Z",
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "1",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        PULSE_EMERGENCY_KILL_SWITCH: "clear",
      },
    },
  );
  assert.equal(greenResult.status, 0, greenResult.stderr);

  const diagnosticResult = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-dispatch-executor-preflight.js",
      "--guarded-dispatch-plan",
      planPath,
      "--platform-status-matrix",
      platformPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-06-16T09:05:00.000Z",
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "1",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        PULSE_EMERGENCY_KILL_SWITCH: "clear",
      },
    },
  );
  assert.equal(diagnosticResult.status, 0, diagnosticResult.stderr);
  assert.equal(JSON.parse(diagnosticResult.stdout).verdict, "AMBER");

  const executorPlan = await fs.readJson(path.join(outDir, "guarded_dispatch_executor_plan.json"));
  assert.equal(executorPlan.generated_at, "2026-06-16T09:00:00.000Z");
  assert.equal(executorPlan.ready_for_live_executor_handoff, true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_dispatch_executor_plan.non_green.json")), true);
});

test("executor preflight allows real platform drift to replace the executor plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-executor-platform-overwrite-"));
  const files = await evidenceFiles(root);
  const outDir = path.join(root, "out");

  const green = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix(),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });
  await writeGuardedDispatchExecutorPreflight(green, { outputDir: outDir });

  const platformDrift = buildGuardedDispatchExecutorPreflight({
    guardedDispatchPlan: guardedDispatchPlan(files),
    platformStatusMatrix: platformStatusMatrix({
      youtube_shorts: {
        status: "deferred_until_platform_enabled",
        operational_state: "disabled",
        deferred_action_count: 1,
      },
    }),
    selectedActionIds: ["story-one:youtube_shorts"],
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
  });
  assert.equal(platformDrift.verdict, "RED");

  const written = await writeGuardedDispatchExecutorPreflight(platformDrift, {
    outputDir: outDir,
    preserveExistingReadyExecutorPlanOnContextOnlyNonGreen: true,
  });

  const currentExecutorPlan = await fs.readJson(path.join(outDir, "guarded_dispatch_executor_plan.json"));
  assert.equal(written.executorPlanPreserved, false);
  assert.equal(currentExecutorPlan.ready_for_live_executor_handoff, false);
  assert.equal(currentExecutorPlan.blocked_selected_action_count, 1);
  assert.ok(currentExecutorPlan.blocked_selected_actions[0].blockers.includes("platform_not_ready_now:youtube_shorts"));
});
