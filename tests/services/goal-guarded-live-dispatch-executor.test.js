"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  defaultActionQualityGate,
  selectNextGuardedLiveAction,
  runGuardedLiveDispatchExecutor,
} = require("../../lib/goal-guarded-live-dispatch-executor");

const ROOT = path.resolve(__dirname, "..", "..");

function executorPlan(overrides = {}) {
  const handoffReadyActions = overrides.handoff_ready_actions || [
    {
      action_id: "story-one:youtube_shorts",
      story_id: "story-one",
      platform: "youtube_shorts",
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      video_path: "output/final/story-one/youtube.mp4",
      captions_path: "output/final/story-one/captions.srt",
      first_frame_source: "output/final/story-one/frame.png",
      canonical_manifest_path: "output/final/story-one/canonical.json",
      platform_publish_manifest_path: "output/final/story-one/platform.json",
      live_publish_allowed_from_preflight_only: false,
      requires_live_executor_command: true,
      requires_last_second_kill_switch_check: true,
      requires_last_second_platform_recheck: true,
    },
  ];
  return {
    schema_version: 1,
    generated_at: "2026-06-08T09:30:00.000Z",
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    ready_for_live_executor_handoff: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor",
    handoff_ready_action_count: handoffReadyActions.length,
    blocked_selected_action_count: 0,
    handoff_ready_actions: handoffReadyActions,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
    ...overrides,
  };
}

function action(platform, overrides = {}) {
  return {
    action_id: `story-one:${platform}`,
    story_id: "story-one",
    platform,
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    video_path: `output/final/story-one/${platform}.mp4`,
    captions_path: "output/final/story-one/captions.srt",
    first_frame_source: "output/final/story-one/frame.png",
    canonical_manifest_path: "output/final/story-one/canonical.json",
    platform_publish_manifest_path: `output/final/story-one/${platform}.json`,
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
    ...overrides,
  };
}

function story(overrides = {}) {
  return {
    id: "story-one",
    title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    approved: true,
    exported_path: "legacy.mp4",
    full_script: "A clean public narration script.",
    ...overrides,
  };
}

async function passActionQualityGate() {
  return { result: "pass", blockers: [], checks: {} };
}

test("guarded live dispatch executor dry-run never uploads or mutates DB", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [story()],
    actionIds: ["story-one:youtube_shorts"],
    apply: false,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1", url: "https://youtube.com/shorts/yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt: "2026-06-08T09:35:00.000Z",
  });

  assert.equal(report.mode, "GUARDED_LIVE_DISPATCH_EXECUTOR");
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.selected_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.equal(report.actions[0].outcome, "dry_run_ready");
  assert.equal(report.safety.no_network_uploads, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
});

test("guarded live dispatch executor refuses apply when not armed or kill switch is not clear", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [story()],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "engaged",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1", url: "https://youtube.com/shorts/yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.ok(report.blocked_actions[0].blockers.includes("guarded_live_dispatch_not_armed"));
  assert.ok(report.blocked_actions[0].blockers.includes("emergency_kill_switch_not_clear"));
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
});

test("guarded live dispatch executor applies only the selected Instagram action and persists its media id", async () => {
  let instagramCalls = 0;
  let youtubeCalls = 0;
  let facebookCalls = 0;
  let persisted = null;
  const platformPostCalls = [];
  const generatedAt = "2026-06-08T10:00:00.000Z";

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels", {
          description:
            "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch.",
          caption:
            "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch. Source: Eurogamer.",
          page_caption:
            "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch. More context: /p/forza",
          cover_headline: "FORZA PC BET TEST",
        }),
        action("facebook_reels"),
      ],
    }),
    stories: [story()],
    actionIds: ["story-one:instagram_reels"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          youtubeCalls += 1;
          throw new Error("youtube must not be called");
        },
      },
      instagram_reels: {
        uploadShort: async (uploadedStory) => {
          instagramCalls += 1;
          assert.equal(uploadedStory.exported_path, "output/final/story-one/instagram_reels.mp4");
          assert.equal(
            uploadedStory.description,
            "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch.",
          );
          assert.equal(
            uploadedStory.platform_caption,
            "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch. Source: Eurogamer.",
          );
          assert.equal(uploadedStory.instagram_caption, uploadedStory.platform_caption);
          assert.equal(uploadedStory.facebook_page_caption, "Forza Horizon 6 just turned Xbox's PC strategy into something players can judge before launch. More context: /p/forza");
          assert.equal(uploadedStory.suggested_thumbnail_text, "FORZA PC BET TEST");
          return { platform: "instagram", mediaId: "ig_media_1" };
        },
      },
      facebook_reels: {
        uploadShort: async () => {
          facebookCalls += 1;
          throw new Error("facebook must not be called");
        },
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persisted = nextStory;
      },
    },
    platformPosts: {
      ensurePending(storyId, platform, options = {}) {
        platformPostCalls.push(["ensurePending", storyId, platform, options.idempotencyKey]);
        return { id: 17 };
      },
      markPublished(id, result = {}) {
        platformPostCalls.push(["markPublished", id, result.externalId, result.externalUrl || null]);
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.selected_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 1);
  assert.equal(report.summary.db_mutation_count, 1);
  assert.equal(report.actions[0].outcome, "new_upload");
  assert.equal(report.actions[0].external_id, "ig_media_1");
  assert.equal(instagramCalls, 1);
  assert.equal(youtubeCalls, 0);
  assert.equal(facebookCalls, 0);
  assert.equal(persisted.instagram_media_id, "ig_media_1");
  assert.equal(persisted.instagram_error, null);
  assert.equal(persisted.instagram_published_at, generatedAt);
  assert.equal(persisted.published_at, generatedAt);
  assert.deepEqual(platformPostCalls, [
    ["ensurePending", "story-one", "instagram_reel", "story-one:instagram_reels"],
    ["markPublished", 17, "ig_media_1", null],
  ]);
});

test("guarded live dispatch executor does not report GREEN when one selected enabled platform duplicate-blocks", async () => {
  const persistedStories = [];
  const generatedAt = "2026-06-22T14:00:00.000Z";

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
        action("facebook_reels"),
      ],
    }),
    stories: [story()],
    actionIds: [
      "story-one:youtube_shorts",
      "story-one:instagram_reels",
      "story-one:facebook_reels",
    ],
    apply: true,
    maxActions: 3,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => ({
          blocked: true,
          reason: "Similar to existing: Cyberpunk 2077's Trust Debt",
        }),
      },
      instagram_reels: {
        uploadShort: async () => ({ platform: "instagram", mediaId: "ig_ok_1" }),
      },
      facebook_reels: {
        uploadShort: async () => ({ platform: "facebook", videoId: "fb_ok_1" }),
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persistedStories.push({ ...nextStory });
      },
    },
    platformPosts: {
      ensurePending(storyId, platform, options = {}) {
        return { id: `${storyId}:${platform}:${options.idempotencyKey}` };
      },
      markPublished() {},
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.ready_for_live_dispatch_boolean, false);
  assert.equal(report.summary.selected_action_count, 3);
  assert.equal(report.summary.completed_action_count, 2);
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 2);
  assert.equal(report.summary.db_mutation_count, 3);
  assert.deepEqual(report.actions.map((item) => item.outcome), ["new_upload", "new_upload"]);
  assert.equal(report.blocked_actions[0].action_id, "story-one:youtube_shorts");
  assert.equal(report.blocked_actions[0].outcome, "duplicate_blocked");
  assert.deepEqual(report.blocked_actions[0].blockers, ["duplicate_blocked"]);
  assert.match(report.blocked_actions[0].error, /Similar to existing/);
  assert.equal(report.required_next_step, "repair_guarded_live_dispatch_blockers");
  assert.equal(persistedStories.length, 3);
});

test("guarded live dispatch executor posts Discord handoff alerts after a new guarded upload", async () => {
  const persistedSnapshots = [];
  const discordCalls = [];
  const generatedAt = "2026-06-08T10:05:00.000Z";

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [story()],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => ({
          platform: "youtube",
          videoId: "yt_1",
          url: "https://youtube.com/shorts/yt_1",
        }),
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persistedSnapshots.push({ ...nextStory });
      },
    },
    discordPoster: {
      postVideoUpload: async (nextStory) => {
        discordCalls.push(["video_drop", nextStory.id, nextStory.youtube_url]);
        return { id: "discord_video_1" };
      },
      postStoryPoll: async (nextStory) => {
        discordCalls.push(["story_poll", nextStory.id, nextStory.published_at]);
        return { id: "discord_poll_1" };
      },
    },
    discordGate: {
      shouldPostVideoDrop(nextStory) {
        return !!nextStory.youtube_url && !nextStory.discord_video_drop_posted_at;
      },
      shouldPostStoryPoll(nextStory) {
        return !!nextStory.published_at && !nextStory.discord_story_poll_posted_at;
      },
      markVideoDropPosted(nextStory, now) {
        nextStory.discord_video_drop_posted_at = now.toISOString();
      },
      markStoryPollPosted(nextStory, now) {
        nextStory.discord_story_poll_posted_at = now.toISOString();
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.upload_attempt_count, 1);
  assert.equal(report.summary.db_mutation_count, 1);
  assert.equal(report.summary.discord_alert_attempt_count, 2);
  assert.equal(report.summary.discord_alert_post_count, 2);
  assert.deepEqual(discordCalls, [
    ["video_drop", "story-one", "https://youtube.com/shorts/yt_1"],
    ["story_poll", "story-one", generatedAt],
  ]);
  assert.equal(persistedSnapshots.length, 3);
  assert.equal(persistedSnapshots[0].youtube_post_id, "yt_1");
  assert.equal(persistedSnapshots[0].discord_video_drop_posted_at, undefined);
  assert.equal(persistedSnapshots[1].discord_video_drop_posted_at, generatedAt);
  assert.equal(persistedSnapshots[2].discord_story_poll_posted_at, generatedAt);
  assert.deepEqual(report.actions[0].discord_alerts, [
    { kind: "video_drop", outcome: "posted", db_mutated: true },
    { kind: "story_poll", outcome: "posted", db_mutated: true },
  ]);
});

test("guarded live dispatch executor applies Instagram Story cards through the image uploader", async () => {
  let instagramStoryCalls = 0;
  const persistedSnapshots = [];
  const platformPostCalls = [];
  const generatedAt = "2026-06-08T11:20:00.000Z";

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_story", {
          video_path: "",
          captions_path: "",
          first_frame_source: "",
          image_path: "output/stories/story-one_story.png",
          story_image_path: "output/stories/story-one_story.png",
        }),
      ],
    }),
    stories: [story({ youtube_post_id: "yt_existing" })],
    actionIds: ["story-one:instagram_story"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      instagram_story: {
        uploadStoryImage: async (storyForUpload) => {
          instagramStoryCalls += 1;
          assert.equal(storyForUpload.story_image_path, "output/stories/story-one_story.png");
          assert.equal(persistedSnapshots[0].story_image_path, "output/stories/story-one_story.png");
          return { platform: "instagram_story", mediaId: "ig_story_1" };
        },
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persistedSnapshots.push({ ...nextStory });
      },
    },
    platformPosts: {
      ensurePending(storyId, platform, options = {}) {
        platformPostCalls.push(["ensurePending", storyId, platform, options.idempotencyKey]);
        return { id: 23 };
      },
      markPublished(id, result = {}) {
        platformPostCalls.push(["markPublished", id, result.externalId, result.externalUrl || null]);
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.actions[0].outcome, "new_upload");
  assert.equal(report.actions[0].external_id, "ig_story_1");
  assert.equal(instagramStoryCalls, 1);
  assert.equal(persistedSnapshots.length, 2);
  assert.equal(persistedSnapshots[1].instagram_story_id, "ig_story_1");
  assert.equal(persistedSnapshots[1].instagram_story_error, null);
  assert.equal(persistedSnapshots[1].instagram_story_published_at, generatedAt);
  assert.deepEqual(platformPostCalls, [
    ["ensurePending", "story-one", "instagram_story", "story-one:instagram_story"],
    ["markPublished", 23, "ig_story_1", null],
  ]);
});

test("guarded live dispatch executor skips already-published selected actions without upload", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [story({ youtube_post_id: "yt_existing" })],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_new", url: "https://youtube.com/shorts/yt_new" };
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.actions[0].outcome, "already_published");
  assert.equal(report.actions[0].external_id, "yt_existing");
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
});

test("guarded live dispatch executor blocks unsupported platforms from live apply", async () => {
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [action("tiktok_video")],
    }),
    stories: [story()],
    actionIds: ["story-one:tiktok_video"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {},
    db: {
      upsertStory: async () => {
        throw new Error("unsupported platform must not mutate DB");
      },
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.ok(report.blocked_actions[0].blockers.includes("unsupported_or_disabled_platform:tiktok_video"));
});

test("guarded live dispatch executor hydrates missing DB stories from canonical manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-manifest-"));
  const manifestPath = path.join(root, "canonical_story_manifest.json");
  await fs.writeJson(manifestPath, {
    story_id: "story-one",
    selected_title: "The Expanse Shows Real Gameplay",
    primary_source_url: "https://www.youtube.com/watch?v=example",
    narration_script: "The Expanse: Osiris Reborn finally has real gameplay on screen.",
    thumbnail_text: "EXPANSE GAMEPLAY REVEAL",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    pinned_comment: "Source: Xbox.",
    canonical_angle: "Confirmed Drop",
  });

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", { canonical_manifest_path: manifestPath }),
      ],
    }),
    stories: [],
    actionIds: ["story-one:youtube_shorts"],
    apply: false,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt: "2026-06-08T10:20:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.completed_action_count, 1);
  assert.equal(report.actions[0].outcome, "dry_run_ready");
  assert.equal(report.actions[0].story_source, "canonical_manifest");
  assert.equal(report.summary.db_mutation_count, 0);
});

test("guarded live dispatch executor persists canonical story before structured platform evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-fk-"));
  const manifestPath = path.join(root, "canonical_story_manifest.json");
  await fs.writeJson(manifestPath, {
    story_id: "story-one",
    selected_title: "Deus Ex Composer Says The Jobs Vanished",
    primary_source_url: "https://www.example.com/deus-ex",
    narration_script: "The Deus Ex composer says the jobs vanished after the studio cuts.",
    thumbnail_text: "DEUS EX JOBS VANISHED",
    description: "A source-backed Deus Ex update. Source: Example.",
    pinned_comment: "Source: Example.",
    canonical_angle: "Source Breakdown",
  });

  const persistedIds = new Set();
  const persistedSnapshots = [];
  const platformPostCalls = [];

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", { canonical_manifest_path: manifestPath }),
      ],
    }),
    stories: [],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => ({
          platform: "youtube",
          videoId: "yt_fk_safe",
          url: "https://youtube.com/shorts/yt_fk_safe",
        }),
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persistedIds.add(nextStory.id);
        persistedSnapshots.push({ ...nextStory });
      },
    },
    platformPosts: {
      ensurePending(storyId, platform, options = {}) {
        if (!persistedIds.has(storyId)) {
          throw new Error("FOREIGN KEY constraint failed");
        }
        platformPostCalls.push(["ensurePending", storyId, platform, options.idempotencyKey]);
        return { id: 29 };
      },
      markPublished(id, result = {}) {
        platformPostCalls.push(["markPublished", id, result.externalId, result.externalUrl || null]);
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt: "2026-06-11T14:00:02.003Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.actions[0].outcome, "new_upload");
  assert.equal(report.actions[0].external_id, "yt_fk_safe");
  assert.equal(report.actions[0].platform_post_recorded, true);
  assert.equal(report.summary.upload_attempt_count, 1);
  assert.equal(report.summary.db_mutation_count, 1);
  assert.equal(persistedSnapshots[0].youtube_post_id, "yt_fk_safe");
  assert.deepEqual(platformPostCalls, [
    ["ensurePending", "story-one", "youtube", "story-one:youtube_shorts"],
    ["markPublished", 29, "yt_fk_safe", "https://youtube.com/shorts/yt_fk_safe"],
  ]);
});

test("guarded live dispatch executor supplements DB rows with canonical manifest source labels before upload", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-source-label-"));
  const manifestPath = path.join(root, "canonical_story_manifest.json");
  await fs.writeJson(manifestPath, {
    story_id: "story-one",
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_game: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    primary_source: "Xbox",
    source_card_label: "Xbox",
    primary_source_url: "https://www.youtube.com/watch?v=example",
    narration_script:
      "The Expanse: Osiris Reborn finally has real gameplay on screen. Xbox showed combat, dialogue choices and the ship setting in one focused reveal.",
    thumbnail_text: "EXPANSE GAMEPLAY",
    description:
      "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    pinned_comment: "Source: Xbox.",
    canonical_angle: "Confirmed Drop",
  });

  let uploadedStory = null;
  let preUploadInstagramError = null;
  let persisted = null;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_reels", { canonical_manifest_path: manifestPath }),
      ],
    }),
    stories: [
      story({
        url: "https://www.youtube.com/watch?v=example",
        source_card_label: "",
        primary_source: "",
        instagram_error:
          "instagram upload failed after 3 attempts: Public metadata QA failed for instagram: public_copy:malformed_primary_source_label",
      }),
    ],
    actionIds: ["story-one:instagram_reels"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      instagram_reels: {
        uploadShort: async (storyForUpload) => {
          uploadedStory = storyForUpload;
          preUploadInstagramError = storyForUpload.instagram_error;
          assert.equal(storyForUpload.primary_source, "Xbox");
          assert.equal(storyForUpload.source_card_label, "Xbox");
          assert.equal(storyForUpload.primary_source_url, "https://www.youtube.com/watch?v=example");
          assert.equal(storyForUpload._guarded_story_source, "db+canonical_manifest");
          return { platform: "instagram", mediaId: "ig_media_1" };
        },
      },
    },
    db: {
      upsertStory: async (nextStory) => {
        persisted = nextStory;
      },
    },
    runActionQualityGate: passActionQualityGate,
    generatedAt: "2026-06-08T10:25:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.actions[0].outcome, "new_upload");
  assert.equal(preUploadInstagramError, "instagram upload failed after 3 attempts: Public metadata QA failed for instagram: public_copy:malformed_primary_source_label");
  assert.equal(uploadedStory.instagram_error, null);
  assert.equal(persisted.instagram_error, null);
  assert.equal(persisted.instagram_media_id, "ig_media_1");
});

test("selectNextGuardedLiveAction skips already-stamped platforms and returns the next unpublished action", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
        action("facebook_reels"),
      ],
    }),
    stories: [
      story({
        youtube_post_id: "yt_existing",
        instagram_media_id: null,
        facebook_post_id: null,
      }),
    ],
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "story-one:instagram_reels");
  assert.equal(selection.skipped_actions[0].reason, "already_published");
  assert.equal(selection.skipped_actions[0].action_id, "story-one:youtube_shorts");
});

test("selectNextGuardedLiveAction skips platforms already published in structured platform_posts", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
        action("facebook_reels"),
      ],
    }),
    stories: [
      story({
        youtube_post_id: null,
        instagram_media_id: null,
        facebook_post_id: null,
      }),
    ],
    platformPosts: {
      getByStoryPlatform(storyId, platform) {
        if (storyId === "story-one" && platform === "youtube") {
          return {
            story_id: "story-one",
            platform: "youtube",
            status: "published",
            external_id: "yt_structured",
          };
        }
        return null;
      },
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "story-one:instagram_reels");
  assert.equal(selection.skipped_actions[0].reason, "already_published");
  assert.equal(selection.skipped_actions[0].external_id, "yt_structured");
  assert.equal(selection.skipped_actions[0].evidence_source, "platform_posts");
});

test("selectNextGuardedLiveAction prioritises a fresh story over residual cross-post catch-up", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_reels"),
        action("youtube_shorts", {
          action_id: "fresh-story:youtube_shorts",
          story_id: "fresh-story",
          video_path: "output/final/fresh-story/youtube_shorts.mp4",
          platform_publish_manifest_path: "output/final/fresh-story/youtube_shorts.json",
        }),
        action("facebook_reels", {
          action_id: "fresh-story:facebook_reels",
          story_id: "fresh-story",
          video_path: "output/final/fresh-story/facebook_reels.mp4",
          platform_publish_manifest_path: "output/final/fresh-story/facebook_reels.json",
        }),
      ],
    }),
    stories: [
      story({
        youtube_post_id: "yt_existing",
        instagram_media_id: null,
        facebook_post_id: null,
      }),
      story({
        id: "fresh-story",
        title: "Steam Next Fest Turns Demos Into A Trust Fight",
        youtube_post_id: null,
        instagram_media_id: null,
        facebook_post_id: null,
      }),
    ],
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "fresh-story:youtube_shorts");
  assert.deepEqual(selection.selected_action_ids, [
    "fresh-story:youtube_shorts",
    "fresh-story:facebook_reels",
  ]);
  assert.equal(selection.priority.reason, "fresh_story_youtube_first");
});

test("selectNextGuardedLiveAction skips previous hard platform failures", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
        action("facebook_reels"),
      ],
    }),
    stories: [
      story({
        youtube_error: "duplicate_blocked: Similar to existing upload",
        instagram_error:
          "instagram upload failed after 3 attempts: Meta container processing failed",
        facebook_post_id: null,
      }),
    ],
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "story-one:facebook_reels");
  assert.deepEqual(
    selection.skipped_actions.map((item) => item.reason),
    ["duplicate_blocked", "previous_platform_failure"],
  );
  assert.match(selection.skipped_actions[1].error, /Meta container processing failed/);
});

test("selectNextGuardedLiveAction quarantines story-level public copy failures across platforms", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
        action("facebook_reels"),
        action("youtube_shorts", {
          action_id: "story-two:youtube_shorts",
          story_id: "story-two",
          video_path: "output/final/story-two/youtube.mp4",
          platform_publish_manifest_path: "output/final/story-two/youtube_shorts.json",
        }),
      ],
    }),
    stories: [
      story({
        instagram_error:
          "instagram upload failed after 3 attempts: Public metadata QA failed for instagram: script_coherence:repeated_sentence:the useful followup is a named update",
        facebook_post_id: null,
      }),
      story({
        id: "story-two",
        title: "Halo Campaign Evolved Makes PS5 The Real Story",
      }),
    ],
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "story-two:youtube_shorts");
  assert.deepEqual(
    selection.skipped_actions.map((item) => item.reason),
    [
      "previous_story_public_copy_failure",
      "previous_story_public_copy_failure",
      "previous_story_public_copy_failure",
    ],
  );
  assert.match(selection.skipped_actions[0].error, /Public metadata QA failed/);
});

test("selectNextGuardedLiveAction skips actions blocked by the last-second quality gate", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_reels", {
          action_id: "bad-story:instagram_reels",
          story_id: "bad-story",
          video_path: "output/final/bad-story/instagram_reels.mp4",
        }),
        action("youtube_shorts", {
          action_id: "good-story:youtube_shorts",
          story_id: "good-story",
          video_path: "output/final/good-story/youtube_shorts.mp4",
        }),
      ],
    }),
    stories: [
      story({ id: "bad-story", title: "Deus Ex Composer Says The Jobs Vanished" }),
      story({ id: "good-story", title: "Halo Campaign Evolved Makes PS5 The Real Story" }),
    ],
    runActionQualityGate: async ({ action }) => {
      if (action.story_id === "bad-story") {
        return {
          result: "fail",
          blockers: [
            "content:script_coherence:vague_filler:abstract_industry_bridge",
            "video:black_segment_too_long (1.70s @ 21.90s)",
          ],
          checks: { video: { result: "fail" } },
        };
      }
      return passActionQualityGate();
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "good-story:youtube_shorts");
  assert.equal(selection.skipped_actions[0].reason, "last_second_quality_gate_failed");
  assert.deepEqual(selection.skipped_actions[0].blockers, [
    "content:script_coherence:vague_filler:abstract_industry_bridge",
    "video:black_segment_too_long (1.70s @ 21.90s)",
  ]);
});

test("selectNextGuardedLiveAction carries normal-production duration metadata into the last-second quality story", async () => {
  let capturedStory = null;
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          action_id: "gta-story:youtube_shorts",
          story_id: "gta-story",
          duration_strategy: "normal_production_safe_script_expansion",
          video_duration_s: 35.25,
          video_path: "output/final/gta-story/youtube_shorts.mp4",
        }),
      ],
    }),
    stories: [story({ id: "gta-story", title: "Fable Demo Has A Runtime Risk" })],
    runActionQualityGate: async ({ story: qualityStory }) => {
      capturedStory = qualityStory;
      const valid =
        qualityStory.duration_lane === "normal_production" &&
        qualityStory.duration_seconds === 35.25 &&
        qualityStory.min_video_duration_seconds === 35 &&
        qualityStory.max_video_duration_seconds === 60;
      return valid
        ? passActionQualityGate()
        : {
            result: "fail",
            blockers: ["duration_contract_not_hydrated"],
            checks: { qualityStory },
          };
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "gta-story:youtube_shorts");
  assert.equal(capturedStory.duration_lane, "normal_production");
  assert.equal(capturedStory.duration_seconds, 35.25);
  assert.equal(capturedStory.min_video_duration_seconds, 35);
  assert.equal(capturedStory.max_video_duration_seconds, 60);
});

test("selectNextGuardedLiveAction restores normal-production duration metadata from canonical and render manifests", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-manifest-"));
  t.after(() => fs.remove(tmp));
  const packageDir = path.join(tmp, "gta-story");
  await fs.ensureDir(packageDir);
  const videoPath = path.join(packageDir, "visual_v4_render.mp4");
  const canonicalManifestPath = path.join(packageDir, "canonical_story_manifest.json");
  await fs.writeJson(canonicalManifestPath, {
    story_id: "gta-story",
    selected_title: "Fable Demo Has A Runtime Risk",
    canonical_subject: "Fable",
    narration_script: "Fable's demo has a runtime risk.",
    primary_source: "GameSpot",
    primary_source_url: "https://example.test/fable-demo",
    source_published_at: "2026-06-22T14:04:25.000Z",
    duration_variant_repair_strategy: "normal_production_safe_script_expansion",
    duration_variant_target_duration_seconds: {
      min: 35,
      max: 59,
    },
  });
  await fs.writeJson(path.join(packageDir, "render_manifest.json"), {
    rendered_duration_s: 35.25,
    final_publish_render: true,
  });

  let capturedStory = null;
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          action_id: "gta-story:youtube_shorts",
          story_id: "gta-story",
          video_path: videoPath,
          canonical_manifest_path: canonicalManifestPath,
          duration_strategy: null,
          duration_lane: null,
          video_duration_s: null,
        }),
      ],
    }),
    stories: [],
    runActionQualityGate: async ({ story: qualityStory }) => {
      capturedStory = qualityStory;
      const valid =
        qualityStory.duration_lane === "normal_production" &&
        qualityStory.duration_seconds === 35.25 &&
        qualityStory.min_video_duration_seconds === 35 &&
        qualityStory.max_video_duration_seconds === 59;
      return valid
        ? passActionQualityGate()
        : {
            result: "fail",
            blockers: ["manifest_duration_contract_not_hydrated"],
            checks: { qualityStory },
          };
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "gta-story:youtube_shorts");
  assert.equal(capturedStory.duration_lane, "normal_production");
  assert.equal(capturedStory.duration_seconds, 35.25);
  assert.equal(capturedStory.min_video_duration_seconds, 35);
  assert.equal(capturedStory.max_video_duration_seconds, 59);
});

test("selectNextGuardedLiveAction uses current package caption and thumbnail proof over stale DB QA fields", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-current-package-proof-"));
  t.after(() => fs.remove(tmp));
  const packageDir = path.join(tmp, "sf6-story");
  await fs.ensureDir(packageDir);
  const videoPath = path.join(packageDir, "visual_v4_render.mp4");
  const captionsPath = path.join(packageDir, "captions.srt");
  const canonicalManifestPath = path.join(packageDir, "canonical_story_manifest.json");
  const platformPublishManifestPath = path.join(packageDir, "platform_publish_manifest.json");

  await fs.writeFile(videoPath, "fake mp4 bytes");
  await fs.writeFile(captionsPath, "1\n00:00:00,000 --> 00:00:01,000\nStreet Fighter 6\n");
  await fs.writeJson(canonicalManifestPath, {
    story_id: "sf6-story",
    selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
    canonical_subject: "Street Fighter 6",
    primary_source: "GameSpot",
    primary_source_url: "https://www.gamespot.com/videos/street-fighter-6-yasmine-character-gameplay-reveal-trailer/",
    source_published_at: "2026-06-22T14:04:25.000Z",
    narration_script:
      "Street Fighter 6 just made Yasmine look like a ranked-mode problem. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "YASMINE PRESSURE",
  });
  await fs.writeJson(path.join(packageDir, "render_manifest.json"), {
    rendered_duration_s: 37.1,
    final_publish_render: true,
    post_render_forensic_result: "pass",
    input_evidence: {
      word_timestamps_path: path.join(packageDir, "timestamps.json"),
    },
    input_fingerprint: {
      canonical_snapshot: {
        canonical_subject: "Street Fighter 6",
        narration_script:
          "Street Fighter 6 just made Yasmine look like a ranked-mode problem. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. Follow Pulse Gaming so you never miss a beat.",
        thumbnail_headline: "YASMINE PRESSURE",
      },
    },
  });
  await fs.writeJson(path.join(packageDir, "caption_manifest.json"), {
    status: "ready",
    caption_srt_path: captionsPath,
    resolved_caption_srt_path: captionsPath,
    word_count: 107,
    captions_source: "word_timestamps",
    blockers: [],
    checks: {
      caption_file_present: true,
      captions_well_formed: true,
      caption_word_count_available: true,
    },
    timestamp_whisper_alignment: {
      script_inserted_actual_word_count: 0,
      script_trailing_actual_word_count: 0,
    },
  });
  await fs.writeJson(platformPublishManifestPath, {
    outputs: {
      youtube_shorts: {
        duration_seconds: 37.1,
        cover_frame: {
          headline: "YASMINE PRESSURE",
          subject: "Street Fighter 6",
          source_label: "GameSpot",
        },
      },
    },
  });

  let capturedStory = null;
  let capturedVideoOptions = null;
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          action_id: "sf6-story:youtube_shorts",
          story_id: "sf6-story",
          video_path: videoPath,
          captions_path: captionsPath,
          canonical_manifest_path: canonicalManifestPath,
          platform_publish_manifest_path: platformPublishManifestPath,
        }),
      ],
    }),
    stories: [
      story({
        id: "sf6-story",
        title: "Street Fighter 6 Just Revealed A Rushdown Problem",
        canonical_subject: "Street Fighter 6",
        duration_lane: "pulse_flash_short",
        min_video_duration_seconds: 40,
        max_video_duration_seconds: 75,
        full_script:
          "Street Fighter 6 just made Yasmine look like a ranked-mode problem. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. Follow Pulse Gaming so you never miss a beat.",
        suggested_thumbnail_text: "YASMINE PRESSURE",
        subtitle_timing_inspection: {
          usable: false,
          reason: "too_few_words",
        },
      }),
    ],
    actionQualityGateOptions: {
      runContentQa: async (qualityStory) => {
        capturedStory = qualityStory;
        const valid =
          qualityStory.clean_manual_captions === true &&
          qualityStory.manual_caption_generated === true &&
          qualityStory.subtitle_timing_inspection?.usable === true &&
          qualityStory.suggested_thumbnail_text === "Street Fighter 6 YASMINE PRESSURE" &&
          qualityStory.duration_lane === "normal_production" &&
          qualityStory.min_video_duration_seconds === 35 &&
          qualityStory.max_video_duration_seconds === 60;
        return valid
          ? passActionQualityGate()
          : {
              result: "fail",
              blockers: ["current_package_proof_not_hydrated"],
              checks: { qualityStory },
            };
      },
      runPublicMetadataQa: async (qualityStory) =>
        qualityStory.suggested_thumbnail_text === "Street Fighter 6 YASMINE PRESSURE"
          ? passActionQualityGate()
          : {
              result: "fail",
              blockers: ["thumbnail_subject_not_hydrated"],
            },
      runVideoQa: async (_mp4Path, options) => {
        capturedVideoOptions = options;
        return options.minDuration === 35 && options.maxDuration === 60 ? passActionQualityGate() : {
          result: "fail",
          blockers: ["duration_floor_not_hydrated"],
        };
      },
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "sf6-story:youtube_shorts");
  assert.equal(capturedStory.clean_manual_captions, true);
  assert.equal(capturedStory.subtitle_timing_inspection.usable, true);
  assert.equal(capturedStory.duration_lane, "normal_production");
  assert.equal(capturedVideoOptions.minDuration, 35);
  assert.equal(capturedVideoOptions.maxDuration, 60);
});

test("selectNextGuardedLiveAction skips pre-fix local TTS packages with slowed narration", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-slow-local-tts-"));
  t.after(() => fs.remove(tmp));
  const slowTimestampsPath = path.join(tmp, "slow_timestamps.json");
  await fs.writeJson(slowTimestampsPath, {
    meta: {
      source: "local_whisper_word_alignment",
      localTts: { speakingRate: 0.82 },
      voiceDiagnostics: { effective_rate: 0.82 },
    },
    words: [{ word: "GTA", start: 0, end: 0.2 }],
  });

  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("facebook_reels", {
          action_id: "slow-story:facebook_reels",
          story_id: "slow-story",
          video_path: path.join(tmp, "slow-facebook.mp4"),
          word_timestamps_path: slowTimestampsPath,
        }),
        action("youtube_shorts", {
          action_id: "clean-story:youtube_shorts",
          story_id: "clean-story",
          video_path: path.join(tmp, "clean-youtube.mp4"),
        }),
      ],
    }),
    stories: [
      story({ id: "slow-story", title: "GTA 5 Became Rockstar's GTA 6 Warm-Up" }),
      story({ id: "clean-story", title: "Halo Campaign Evolved Makes PS5 The Real Story" }),
    ],
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "clean-story:youtube_shorts");
  assert.equal(selection.skipped_actions[0].reason, "local_tts_speed_below_native");
  assert.deepEqual(selection.skipped_actions[0].blockers, [
    "local_tts_speaking_rate_below_native:0.82",
  ]);
  assert.equal(selection.skipped_actions[0].evidence.local_tts_speaking_rate, 0.82);
});

test("selectNextGuardedLiveAction skips stale source-age actions and advances to fresh candidates", async () => {
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_reels", {
          action_id: "stale-story:instagram_reels",
          story_id: "stale-story",
          video_path: "output/final/stale-story/instagram_reels.mp4",
        }),
        action("youtube_shorts", {
          action_id: "fresh-story:youtube_shorts",
          story_id: "fresh-story",
          video_path: "output/final/fresh-story/youtube_shorts.mp4",
        }),
      ],
    }),
    stories: [
      story({
        id: "stale-story",
        title: "Forza Horizon 6 Scores 84 On PC Gamer",
        timestamp: "2026-05-14T12:02:03.000Z",
      }),
      story({
        id: "fresh-story",
        title: "Halo Campaign Evolved Makes PS5 The Real Story",
        timestamp: "2026-06-11T18:50:00.000Z",
      }),
    ],
    runActionQualityGate: passActionQualityGate,
    actionQualityGateOptions: {
      now: "2026-06-11T19:16:00.000Z",
      maxSourceAgeHours: 168,
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "fresh-story:youtube_shorts");
  assert.equal(selection.skipped_actions[0].reason, "stale_source_age");
  assert.ok(
    selection.skipped_actions[0].blockers.includes("source_age_exceeds_limit"),
    JSON.stringify(selection.skipped_actions[0].blockers),
  );
});

test("selectNextGuardedLiveAction uses canonical source age before DB touch timestamps", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-canonical-source-age-"));
  t.after(() => fs.remove(tmp));
  const staleCanonicalPath = path.join(tmp, "stale-canonical.json");
  await fs.writeJson(staleCanonicalPath, {
    story_id: "stale-crosspost",
    selected_title: "Beastro Turns Deckbuilding Into A Game Pass Test",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/example",
    source_published_at: "2026-06-11T00:00:00.000Z",
    narration_script:
      "Beastro is the Game Pass test for players who normally avoid card games. Follow Pulse Gaming so you never miss a beat.",
  });

  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("instagram_reels", {
          action_id: "stale-crosspost:instagram_reels",
          story_id: "stale-crosspost",
          canonical_manifest_path: staleCanonicalPath,
        }),
        action("youtube_shorts", {
          action_id: "fresh-story:youtube_shorts",
          story_id: "fresh-story",
        }),
      ],
    }),
    stories: [
      story({
        id: "stale-crosspost",
        title: "Beastro Has A Cozy Deckbuilding Test",
        timestamp: "2026-06-18T07:00:00.000Z",
      }),
      story({
        id: "fresh-story",
        title: "Gears E-Day Has A 130GB Problem",
        timestamp: "2026-06-16T13:00:00.000Z",
      }),
    ],
    runActionQualityGate: passActionQualityGate,
    actionQualityGateOptions: {
      now: "2026-06-18T07:30:00.000Z",
      maxSourceAgeHours: 168,
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "fresh-story:youtube_shorts");
  assert.equal(selection.skipped_actions[0].reason, "stale_source_age");
  assert.equal(selection.skipped_actions[0].checks.source_freshness.source_timestamp, "2026-06-11T00:00:00.000Z");
  assert.ok(selection.skipped_actions[0].blockers.includes("source_age_exceeds_limit"));
});

test("selectNextGuardedLiveAction treats a clean canonical package as source of truth over stale DB script review state", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-canonical-script-state-"));
  t.after(() => fs.remove(tmp));
  const canonicalPath = path.join(tmp, "canonical.json");
  await fs.writeJson(canonicalPath, {
    story_id: "repaired-story",
    selected_title: "Cyberpunk 2077's Trust Debt",
    primary_source: "PC Gamer",
    primary_source_url: "https://www.pcgamer.com/games/rpg/cyberpunk-2077-trust-debt",
    source_published_at: "2026-06-22T09:00:00.000Z",
    narration_script:
      "Cyberpunk 2077 still has one problem CD Projekt Red cannot patch. The studio says some players may never fully trust it again after launch. That matters because the sequel is not just selling a new city. It is selling proof that the old promises finally mean something. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_text: "TRUST DEBT",
  });

  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          action_id: "repaired-story:youtube_shorts",
          story_id: "repaired-story",
          canonical_manifest_path: canonicalPath,
        }),
      ],
    }),
    stories: [
      story({
        id: "repaired-story",
        title: "Old weak backlog title",
        script_generation_status: "review_required",
        script_review_reason: "script_validation_review_required",
        full_script: "the hook here is weak internal QA language",
      }),
    ],
    runActionQualityGate: async ({ story: hydratedStory }) => {
      assert.equal(hydratedStory.script_generation_status, "approved");
      assert.equal(hydratedStory.script_review_reason, "");
      assert.match(hydratedStory.full_script, /Cyberpunk 2077 still has one problem/);
      assert.doesNotMatch(hydratedStory.full_script, /the hook here is/i);
      return passActionQualityGate();
    },
    actionQualityGateOptions: {
      now: "2026-06-22T10:00:00.000Z",
      maxSourceAgeHours: 168,
    },
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "repaired-story:youtube_shorts");
  assert.equal(selection.skipped_actions.length, 0);
});

test("guarded live dispatch executor blocks explicit live actions that fail last-second quality", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [story({ title: "Deus Ex Composer Says The Jobs Vanished" })],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          throw new Error("uploader must not be called after quality gate failure");
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: async () => ({
      result: "fail",
      blockers: ["video:freeze_segment_too_long (0.80s @ 32.67s)"],
      checks: { video: { result: "fail" } },
    }),
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_quality_gate_failed",
    "video:freeze_segment_too_long (0.80s @ 32.67s)",
  ]);
});

test("guarded live dispatch executor blocks explicit slowed local TTS actions before upload", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-explicit-slow-local-tts-"));
  t.after(() => fs.remove(tmp));
  const slowTimestampsPath = path.join(tmp, "story-one_timestamps.json");
  await fs.writeJson(slowTimestampsPath, {
    meta: {
      source: "local_whisper_word_alignment",
      localTts: { speakingRate: 0.82 },
      voiceDiagnostics: { effective_rate: 0.82 },
    },
    words: [{ word: "GTA", start: 0, end: 0.2 }],
  });

  let uploadCalls = 0;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("facebook_reels", {
          word_timestamps_path: slowTimestampsPath,
          video_path: path.join(tmp, "facebook.mp4"),
        }),
      ],
    }),
    stories: [story({ title: "Forza Horizon Became Xbox's Steam Warm-Up" })],
    actionIds: ["story-one:facebook_reels"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      facebook_reels: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "facebook", videoId: "fb_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {},
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_local_tts_speed_failed",
    "local_tts_speaking_rate_below_native:0.82",
  ]);
});

test("guarded live dispatch executor blocks non-native managed TTS rates before upload", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-explicit-managed-tts-rate-"));
  t.after(() => fs.remove(tmp));
  const timestampsPath = path.join(tmp, "story-one_timestamps.json");
  await fs.writeJson(timestampsPath, {
    meta: {
      source: "elevenlabs-production-path",
      elevenlabs: { speakingRate: 1.1 },
    },
    words: [{ word: "GTA", start: 0, end: 0.2 }],
  });

  let uploadCalls = 0;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          word_timestamps_path: timestampsPath,
          video_path: path.join(tmp, "youtube.mp4"),
        }),
      ],
    }),
    stories: [story({ title: "Forza Horizon Starts The Preorder Fight" })],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {},
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_local_tts_speed_failed",
    "tts_speaking_rate_non_native:1.10",
  ]);
});

test("guarded live dispatch executor blocks GTA VI split ASR stutter evidence before upload", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-explicit-gta-s-i-six-"));
  t.after(() => fs.remove(tmp));
  const timestampsPath = path.join(tmp, "story-one_timestamps.json");
  const spoken =
    "GTA s i six just turned pre orders into a buy wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(timestampsPath, {
    meta: {
      source: "elevenlabs-production-path",
      transcript: spoken,
      spoken_text: spoken,
      ttsPronunciationProfileVersion: "gta-safe-next-title-v8",
    },
    words: spoken
      .replace(/[.]/g, "")
      .split(/\s+/)
      .map((word, index) => ({
        word,
        start: Number((index * 0.35).toFixed(2)),
        end: Number((index * 0.35 + 0.18).toFixed(2)),
      })),
  });

  let uploadCalls = 0;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          word_timestamps_path: timestampsPath,
          video_path: path.join(tmp, "youtube.mp4"),
        }),
      ],
    }),
    stories: [
      story({
        title: "GTA VI Starts The Preorder Fight",
        canonical_subject: "Grand Theft Auto VI",
        tts_script:
          "Rockstar's next Grand Theft Auto just turned pre orders into a buy wait or skip argument. " +
          "Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {},
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_gta_vi_pronunciation_failed",
    "gta_vi_spoken_stutter",
    "gta_vi_opening_spoken_six_risk",
  ]);
});

test("guarded live dispatch executor blocks GTA VI actions without recorded pronunciation proof", async () => {
  let uploadCalls = 0;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          title: "GTA VI Starts The Preorder Fight",
          video_path: "output/final/story-one/youtube.mp4",
        }),
      ],
    }),
    stories: [
      story({
        title: "GTA VI Starts The Preorder Fight",
        canonical_subject: "Grand Theft Auto VI",
        tts_script:
          "Rockstar's next Grand Theft Auto just turned pre orders into a buy wait or skip argument. " +
          "Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {},
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_gta_vi_pronunciation_failed",
    "gta_vi_pronunciation_evidence_missing",
  ]);
});

test("guarded live dispatch executor blocks GTA VI timestamp evidence without current pronunciation profile", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-explicit-gta-missing-profile-"));
  t.after(() => fs.remove(tmp));
  const timestampsPath = path.join(tmp, "story-one_timestamps.json");
  const spoken =
    "Rockstar's next Grand Theft Auto just turned pre orders into a buy wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(timestampsPath, {
    meta: {
      source: "elevenlabs-production-path",
      transcript: spoken,
      spoken_text: spoken,
    },
    words: spoken
      .replace(/[.]/g, "")
      .split(/\s+/)
      .map((word, index) => ({
        word,
        start: Number((index * 0.35).toFixed(2)),
        end: Number((index * 0.35 + 0.18).toFixed(2)),
      })),
  });

  let uploadCalls = 0;
  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          title: "GTA VI Starts The Preorder Fight",
          word_timestamps_path: timestampsPath,
          video_path: path.join(tmp, "youtube.mp4"),
        }),
      ],
    }),
    stories: [
      story({
        title: "GTA VI Starts The Preorder Fight",
        canonical_subject: "Grand Theft Auto VI",
        tts_script: spoken,
      }),
    ],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_1" };
        },
      },
    },
    db: {
      upsertStory: async () => {},
    },
    runActionQualityGate: passActionQualityGate,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(uploadCalls, 0);
  assert.deepEqual(report.blocked_actions[0].blockers, [
    "last_second_gta_vi_pronunciation_failed",
    "gta_vi_timestamp_profile_stale",
  ]);
});

test("guarded live dispatch executor blocks public metadata QA failures before upload", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const unsafeHaloStory = story({
    title: "Halo: Campaign Evolved Shows The Real Remake Test",
    suggested_title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    source_type: "Xbox Wire",
    subreddit: "Xbox Wire",
    url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    full_script:
      "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    suggested_thumbnail_text: "HALO'S REAL TEST",
    subtitle_timing_source: "timestamps",
    subtitle_timing_inspection: { usable: true },
  });

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [unsafeHaloStory],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          throw new Error("uploader must not be called after public metadata QA fails");
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: defaultActionQualityGate,
    actionQualityGateOptions: {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      buildVideoQaOptionsForStory: () => ({}),
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.ok(
    report.blocked_actions[0].blockers.includes("last_second_quality_gate_failed"),
  );
  assert.ok(
    report.blocked_actions[0].blockers.includes(
      "public_metadata:public_copy:unanchored_premium_edition_claim",
    ),
    JSON.stringify(report.blocked_actions[0].blockers),
  );
});

test("guarded live dispatch executor hydrates canonical claim evidence before public metadata QA", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-claims-"));
  const canonicalManifestPath = path.join(tmp, "canonical_story_manifest.json");
  await fs.writeJson(canonicalManifestPath, {
    story_id: "story-one",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_title: "Halo: Campaign Evolved Shows The Real Remake Test",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    source_published_at: "2026-06-24T00:00:00.000Z",
    narration_script:
      "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    first_spoken_line: "Halo Campaign Evolved's remake debate finally has a real stress test.",
    thumbnail_text: "HALO'S REAL TEST",
    claim_inventory: {
      confirmed: [
        "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
        "Xbox Wire says Halo: Campaign Evolved launches on July 28, 2026 with early access beginning July 23, 2026 for Premium Edition owners.",
      ],
      unconfirmed: [],
      prohibited: [],
    },
    confirmed_claims: [
      "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
      "Xbox Wire says Halo: Campaign Evolved launches on July 28, 2026 with early access beginning July 23, 2026 for Premium Edition owners.",
    ],
  }, { spaces: 2 });

  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          title: "Halo: Campaign Evolved Shows The Real Remake Test",
          canonical_manifest_path: canonicalManifestPath,
        }),
      ],
    }),
    stories: [story()],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          return { platform: "youtube", videoId: "yt_claims", url: "https://youtube.com/shorts/yt_claims" };
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: defaultActionQualityGate,
    actionQualityGateOptions: {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      buildVideoQaOptionsForStory: () => ({}),
    },
    discord: { post: async () => ({ ok: true }) },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.completed_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 1);
  assert.equal(report.summary.db_mutation_count, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(upsertCalls, 1);
  assert.equal(report.actions[0].outcome, "new_upload");
});

test("guarded live dispatch executor blocks explicit stale source-age actions before upload", async () => {
  let uploadCalls = 0;
  let upsertCalls = 0;

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan(),
    stories: [
      story({
        timestamp: "2026-05-14T12:02:03.000Z",
      }),
    ],
    actionIds: ["story-one:youtube_shorts"],
    apply: true,
    env: {
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "clear",
    },
    uploaders: {
      youtube_shorts: {
        uploadShort: async () => {
          uploadCalls += 1;
          throw new Error("uploader must not be called for stale source actions");
        },
      },
    },
    db: {
      upsertStory: async () => {
        upsertCalls += 1;
      },
    },
    runActionQualityGate: passActionQualityGate,
    actionQualityGateOptions: {
      now: "2026-06-11T19:16:00.000Z",
      maxSourceAgeHours: 168,
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocked_action_count, 1);
  assert.equal(report.summary.upload_attempt_count, 0);
  assert.equal(report.summary.db_mutation_count, 0);
  assert.equal(uploadCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.ok(report.blocked_actions[0].blockers.includes("last_second_source_freshness_failed"));
  assert.ok(report.blocked_actions[0].blockers.includes("source_age_exceeds_limit"));
});

test("default action quality gate hydrates render-manifest proof before content QA", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-quality-hydrate-"));
  const manifestPath = path.join(root, "canonical_story_manifest.json");
  const mp4Path = path.join(root, "visual_v4_render.mp4");
  const audioPath = path.join(root, "voice.mp3");
  const timestampsPath = path.join(root, "voice_timestamps.json");
  await fs.writeFile(mp4Path, "fake mp4");
  await fs.writeFile(audioPath, "fake audio");
  await fs.writeJson(timestampsPath, []);
  await fs.writeJson(manifestPath, {
    story_id: "story-one",
    selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    narration_script:
      "Forza Horizon 6 just landed a strong PC Gamer review. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "FORZA HORIZON 6 SCORES 84",
    primary_source: "PC Gamer",
    primary_source_url: "https://www.pcgamer.com/example",
  });
  await fs.writeJson(path.join(root, "render_manifest.json"), {
    story_id: "story-one",
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    rendered_duration_s: 51.409,
    input_evidence: {
      narration_audio_path: audioPath,
      word_timestamps_path: timestampsPath,
    },
  });

  const seenStories = [];
  const selection = await selectNextGuardedLiveAction({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts", {
          canonical_manifest_path: manifestPath,
          video_path: mp4Path,
        }),
      ],
    }),
    stories: [
      story({
        audio_path: "",
        render_lane: "",
        render_quality_class: "",
        suggested_thumbnail_text: "PC GAMER REVIEW",
        thumbnail_text: "PC GAMER REVIEW",
      }),
    ],
    runActionQualityGate: defaultActionQualityGate,
    actionQualityGateOptions: {
      runContentQa: async (qaStory) => {
        seenStories.push(qaStory);
        return { result: "pass", failures: [], warnings: [] };
      },
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      buildVideoQaOptionsForStory: () => ({}),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  });

  assert.equal(selection.action_id, "story-one:youtube_shorts");
  assert.equal(seenStories.length, 1);
  assert.equal(seenStories[0].audio_path, audioPath);
  assert.equal(seenStories[0].word_timestamps_path, timestampsPath);
  assert.equal(seenStories[0].render_lane, "production_v4_motion");
  assert.equal(seenStories[0].render_quality_class, "production_v4_motion");
  assert.equal(seenStories[0].duration_seconds, 51.409);
  assert.equal(seenStories[0].suggested_thumbnail_text, "FORZA HORIZON 6 SCORES 84");
});

test("default action quality gate blocks repeated direct motion package evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-quality-repeat-motion-"));
  const manifestPath = path.join(root, "canonical_story_manifest.json");
  const mp4Path = path.join(root, "visual_v4_render.mp4");
  await fs.writeFile(mp4Path, "fake mp4");
  await fs.writeJson(manifestPath, {
    story_id: "story-one",
    selected_title: "Halo Campaign Evolved Shows The Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    narration_script:
      "Halo Campaign Evolved finally has a real remake test. Xbox Wire's footage shows the level in motion. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "HALO REMAKE TEST",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/halo-campaign-evolved",
  });
  await fs.writeJson(path.join(root, "render_manifest.json"), {
    story_id: "story-one",
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    final_publish_render: true,
    rendered_duration_s: 42,
    clips: 6,
  });
  const repeatedClip = {
    id: "halo-window-a",
    path: "motion/halo-window-a.mp4",
    source_url: "https://cdn.example.com/halo-campaign-evolved/trailer.mp4",
    media_kind: "official_trailer_segment",
    source_type: "official_trailer_segment",
    source_family: "halo_campaign_evolved_trailer_window_1",
    media_start_s: 12,
    duration_s: 4,
  };
  await fs.writeJson(path.join(root, "visual_v4_render_story.json"), {
    id: "story-one",
    video_clips: [
      repeatedClip,
      {
        ...repeatedClip,
        id: "halo-window-a-repeat",
        path: "motion/halo-window-a-repeat.mp4",
      },
    ],
    visual_v4_bridge_video_clips: [],
  });

  const result = await defaultActionQualityGate({
    story: story({
      id: "story-one",
      title: "Halo Campaign Evolved Shows The Remake Test",
    }),
    action: action("youtube_shorts", {
      canonical_manifest_path: manifestPath,
      video_path: mp4Path,
    }),
    config: { publicName: "youtube", mediaKind: "video" },
    options: {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      buildVideoQaOptionsForStory: () => ({}),
    },
  });

  assert.equal(result.result, "fail");
  assert.ok(
    result.blockers.includes("visual_evidence:repeated_direct_motion_segment"),
    JSON.stringify(result.blockers),
  );
  assert.equal(
    result.checks.visual_cadence.evidence.repeated_direct_motion_segment_count,
    1,
  );
});

test("guarded live dispatch executor CLI writes dry-run reports and package script is registered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-cli-"));
  const planPath = path.join(root, "guarded_dispatch_executor_plan.json");
  const storiesPath = path.join(root, "stories.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(planPath, executorPlan(), { spaces: 2 });
  await fs.writeJson(storiesPath, [story()], { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    [
      "tools/goal-guarded-live-dispatch-executor.js",
      "--executor-plan",
      planPath,
      "--stories",
      storiesPath,
      "--action-id",
      "story-one:youtube_shorts",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-06-08T10:10:00.000Z",
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PULSE_SKIP_DOTENV: "1",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.verdict, "GREEN");
  assert.equal(parsed.actions[0].outcome, "dry_run_ready");
  assert.equal(parsed.safety.no_network_uploads, true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_live_dispatch_executor_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "guarded_live_dispatch_executor.md")), true);

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:goal-guarded-live-dispatch"],
    "node tools/goal-guarded-live-dispatch-executor.js",
  );
});

test("scheduler publish handler uses guarded executor when live guarded auto-publish is armed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-handler-"));
  const planPath = path.join(root, "guarded_dispatch_executor_plan.json");
  await fs.writeJson(planPath, executorPlan({
    handoff_ready_actions: [
      action("youtube_shorts"),
      action("instagram_reels"),
      action("facebook_reels"),
    ],
  }), { spaces: 2 });

  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const publisherPath = require.resolve("../../publisher");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [executorPath, require.cache[executorPath]],
    [publisherPath, require.cache[publisherPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
    [watchdogPath, require.cache[watchdogPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
    PULSE_EMERGENCY_KILL_SWITCH_CLEAR: process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR,
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
    PULSE_GUARDED_DISPATCH_PLAN_PATH: process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH,
  };

  let selected = false;
  let executed = false;
  const platformPosts = {
    getByStoryPlatform() {
      return null;
    },
  };
  try {
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    delete process.env.PULSE_EMERGENCY_KILL_SWITCH;
    process.env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR = "true";
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = planPath;
    process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = path.join(root, "missing_guarded_dispatch_plan.json");

    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction({ executorPlan: plan, stories, platformPosts: selectorPlatformPosts }) {
          selected = true;
          assert.equal(selectorPlatformPosts, platformPosts);
          assert.equal(plan.ready_for_live_executor_handoff, true);
          assert.equal(plan.handoff_ready_actions.length, 3);
          assert.equal(stories[0].id, "story-one");
          return {
            exhausted: false,
            action_id: "story-one:youtube_shorts",
            action: plan.handoff_ready_actions[0],
            selected_action_ids: [
              "story-one:youtube_shorts",
              "story-one:instagram_reels",
              "story-one:facebook_reels",
            ],
            skipped_actions: [],
          };
        },
        async runGuardedLiveDispatchExecutor(options) {
          executed = true;
          assert.equal(options.apply, true);
          assert.equal(options.platformPosts, platformPosts);
          assert.deepEqual(options.actionIds, [
            "story-one:youtube_shorts",
            "story-one:instagram_reels",
            "story-one:facebook_reels",
          ]);
          assert.equal(options.maxActions, 3);
          return {
            verdict: "GREEN",
            actions: [
              {
                action_id: "story-one:youtube_shorts",
                story_id: "story-one",
                platform: "youtube_shorts",
                outcome: "new_upload",
                external_id: "yt_1",
              },
              {
                action_id: "story-one:instagram_reels",
                story_id: "story-one",
                platform: "instagram_reels",
                outcome: "new_upload",
                external_id: "ig_1",
              },
              {
                action_id: "story-one:facebook_reels",
                story_id: "story-one",
                platform: "facebook_reels",
                outcome: "new_upload",
                external_id: "fb_1",
              },
            ],
            blocked_actions: [],
            summary: {
              upload_attempt_count: 3,
              db_mutation_count: 3,
            },
          };
        },
        async writeGuardedLiveDispatchExecutorReport() {
          return {};
        },
      },
    };
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        platformPosts,
        async getStories() {
          return [story()];
        },
      },
    };
    require.cache[publisherPath] = {
      id: publisherPath,
      filename: publisherPath,
      loaded: true,
      exports: {
        async publishNextStory() {
          throw new Error("legacy publisher must not run when guarded live dispatch is armed");
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async () => {},
    };
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog() {
          return {
            verdict: "green",
            safe_to_publish_window: true,
            blockers: [],
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 42 }, { log() {} });

    assert.equal(selected, true);
    assert.equal(executed, true);
    assert.equal(result.guarded_live_dispatch, true);
    assert.equal(result.status, "green");
    assert.equal(result.action_id, "story-one:youtube_shorts");
    assert.deepEqual(result.action_ids, [
      "story-one:youtube_shorts",
      "story-one:instagram_reels",
      "story-one:facebook_reels",
    ]);
    assert.deepEqual(result.platforms, [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ]);
    assert.equal(result.outcome, "new_upload");
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("scheduler publish handler adapts scheduler dispatch plan when explicit executor plan is empty", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-scheduler-plan-"));
  const executorPlanPath = path.join(root, "guarded_dispatch_executor_plan.json");
  const schedulerPlanPath = path.join(root, "guarded_dispatch_plan.json");
  await fs.writeJson(executorPlanPath, executorPlan({
    ready_for_live_executor_handoff: false,
    required_next_step: "select_explicit_dispatch_action_ids",
    handoff_ready_action_count: 0,
    handoff_ready_actions: [],
  }), { spaces: 2 });
  await fs.writeJson(schedulerPlanPath, {
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    generated_at: "2026-06-11T18:47:41.635Z",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
    dispatch_ready_actions: [
      {
        story_id: "story-one",
        platform: "youtube_shorts",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: "output/final/story-one/youtube.mp4",
        captions_path: "output/final/story-one/captions.srt",
        first_frame_source: "output/final/story-one/frame.png",
        canonical_manifest_path: "output/final/story-one/canonical.json",
        platform_publish_manifest_path: "output/final/story-one/platform.json",
        live_publish_allowed_from_preflight: false,
        requires_guarded_live_dispatch_executor: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
  }, { spaces: 2 });

  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const publisherPath = require.resolve("../../publisher");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [executorPath, require.cache[executorPath]],
    [publisherPath, require.cache[publisherPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
    [watchdogPath, require.cache[watchdogPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
    PULSE_GUARDED_DISPATCH_PLAN_PATH: process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH,
  };

  let selected = false;
  let executed = false;
  try {
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    process.env.PULSE_EMERGENCY_KILL_SWITCH = "clear";
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = executorPlanPath;
    process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = schedulerPlanPath;

    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction({ executorPlan: plan, stories }) {
          selected = true;
          assert.equal(plan.source_mode, "scheduler_scoped_guarded_dispatch_plan");
          assert.equal(plan.ready_for_live_executor_handoff, true);
          assert.equal(plan.handoff_ready_actions.length, 1);
          assert.equal(plan.handoff_ready_actions[0].action_id, "story-one:youtube_shorts");
          assert.equal(plan.handoff_ready_actions[0].requires_live_executor_command, true);
          assert.equal(stories[0].id, "story-one");
          return {
            exhausted: false,
            action_id: "story-one:youtube_shorts",
            action: plan.handoff_ready_actions[0],
            skipped_actions: [],
          };
        },
        async runGuardedLiveDispatchExecutor(options) {
          executed = true;
          assert.equal(options.apply, true);
          assert.deepEqual(options.actionIds, ["story-one:youtube_shorts"]);
          return {
            verdict: "GREEN",
            actions: [
              {
                action_id: "story-one:youtube_shorts",
                story_id: "story-one",
                platform: "youtube_shorts",
                outcome: "new_upload",
                external_id: "yt_1",
              },
            ],
            blocked_actions: [],
            summary: {
              upload_attempt_count: 1,
              db_mutation_count: 1,
            },
          };
        },
        async writeGuardedLiveDispatchExecutorReport() {
          return {};
        },
      },
    };
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        async getStories() {
          return [story()];
        },
      },
    };
    require.cache[publisherPath] = {
      id: publisherPath,
      filename: publisherPath,
      loaded: true,
      exports: {
        async publishNextStory() {
          throw new Error("legacy publisher must not run when scheduler dispatch plan is available");
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async () => {},
    };
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog() {
          return {
            verdict: "green",
            safe_to_publish_window: true,
            blockers: [],
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 43 }, { log() {} });

    assert.equal(selected, true);
    assert.equal(executed, true);
    assert.equal(result.guarded_live_dispatch, true);
    assert.equal(result.status, "green");
    assert.equal(result.action_id, "story-one:youtube_shorts");
    assert.equal(result.outcome, "new_upload");
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("scheduler publish handler prefers newer scheduler dispatch plan over stale executor handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-live-newer-plan-"));
  const executorPlanPath = path.join(root, "guarded_dispatch_executor_plan.json");
  const schedulerPlanPath = path.join(root, "guarded_dispatch_plan.json");
  await fs.writeJson(executorPlanPath, executorPlan({
    generated_at: "2026-06-12T20:45:17.520Z",
    handoff_ready_action_count: 1,
    handoff_ready_actions: [
      {
        action_id: "stale-story:youtube_shorts",
        story_id: "stale-story",
        platform: "youtube_shorts",
        title: "Stale Story",
        video_path: "output/final/stale/youtube.mp4",
        live_publish_allowed_from_preflight_only: false,
        requires_live_executor_command: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
  }), { spaces: 2 });
  await fs.writeJson(schedulerPlanPath, {
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    generated_at: "2026-06-12T23:23:04.194Z",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
    dispatch_ready_actions: [
      {
        story_id: "story-one",
        platform: "youtube_shorts",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: "output/final/story-one/youtube.mp4",
        captions_path: "output/final/story-one/captions.srt",
        first_frame_source: "output/final/story-one/frame.png",
        canonical_manifest_path: "output/final/story-one/canonical.json",
        platform_publish_manifest_path: "output/final/story-one/platform.json",
        live_publish_allowed_from_preflight: false,
        requires_guarded_live_dispatch_executor: true,
        requires_last_second_kill_switch_check: true,
        requires_last_second_platform_recheck: true,
      },
    ],
  }, { spaces: 2 });

  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const publisherPath = require.resolve("../../publisher");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const watchdogPath = require.resolve("../../lib/ops/publish-window-watchdog");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [executorPath, require.cache[executorPath]],
    [publisherPath, require.cache[publisherPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
    [watchdogPath, require.cache[watchdogPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
    PULSE_GUARDED_DISPATCH_PLAN_PATH: process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH,
  };

  let selected = false;
  let executed = false;
  try {
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    process.env.PULSE_EMERGENCY_KILL_SWITCH = "clear";
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = executorPlanPath;
    process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = schedulerPlanPath;

    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction({ executorPlan: plan }) {
          selected = true;
          assert.equal(plan.source_mode, "scheduler_scoped_guarded_dispatch_plan");
          assert.equal(plan.handoff_ready_actions.length, 1);
          assert.equal(plan.handoff_ready_actions[0].action_id, "story-one:youtube_shorts");
          return {
            exhausted: false,
            action_id: "story-one:youtube_shorts",
            action: plan.handoff_ready_actions[0],
            skipped_actions: [],
          };
        },
        async runGuardedLiveDispatchExecutor(options) {
          executed = true;
          assert.deepEqual(options.actionIds, ["story-one:youtube_shorts"]);
          return {
            verdict: "GREEN",
            actions: [
              {
                action_id: "story-one:youtube_shorts",
                story_id: "story-one",
                platform: "youtube_shorts",
                outcome: "new_upload",
                external_id: "yt_1",
              },
            ],
            blocked_actions: [],
            summary: {
              upload_attempt_count: 1,
              db_mutation_count: 1,
            },
          };
        },
        async writeGuardedLiveDispatchExecutorReport() {
          return {};
        },
      },
    };
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        async getStories() {
          return [story()];
        },
      },
    };
    require.cache[publisherPath] = {
      id: publisherPath,
      filename: publisherPath,
      loaded: true,
      exports: {
        async publishNextStory() {
          throw new Error("legacy publisher must not run when guarded live dispatch is armed");
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async () => {},
    };
    require.cache[watchdogPath] = {
      id: watchdogPath,
      filename: watchdogPath,
      loaded: true,
      exports: {
        async runPublishWindowWatchdog() {
          return {
            verdict: "green",
            safe_to_publish_window: true,
            blockers: [],
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 44 }, { log() {} });

    assert.equal(selected, true);
    assert.equal(executed, true);
    assert.equal(result.action_id, "story-one:youtube_shorts");
    assert.equal(result.outcome, "new_upload");
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
