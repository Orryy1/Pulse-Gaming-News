"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
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
  const generatedAt = "2026-06-08T10:00:00.000Z";

  const report = await runGuardedLiveDispatchExecutor({
    executorPlan: executorPlan({
      handoff_ready_actions: [
        action("youtube_shorts"),
        action("instagram_reels"),
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
    generatedAt: "2026-06-08T10:20:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.summary.completed_action_count, 1);
  assert.equal(report.actions[0].outcome, "dry_run_ready");
  assert.equal(report.actions[0].story_source, "canonical_manifest");
  assert.equal(report.summary.db_mutation_count, 0);
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
  });

  assert.equal(selection.exhausted, false);
  assert.equal(selection.action_id, "story-one:instagram_reels");
  assert.equal(selection.skipped_actions[0].reason, "already_published");
  assert.equal(selection.skipped_actions[0].action_id, "story-one:youtube_shorts");
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
  await fs.writeJson(planPath, executorPlan(), { spaces: 2 });

  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const publisherPath = require.resolve("../../publisher");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [executorPath, require.cache[executorPath]],
    [publisherPath, require.cache[publisherPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
  ]);
  const originalEnv = {
    AUTO_PUBLISH: process.env.AUTO_PUBLISH,
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    PULSE_EMERGENCY_KILL_SWITCH: process.env.PULSE_EMERGENCY_KILL_SWITCH,
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
  };

  let selected = false;
  let executed = false;
  try {
    process.env.AUTO_PUBLISH = "true";
    process.env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED = "true";
    process.env.PULSE_EMERGENCY_KILL_SWITCH = "clear";
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = planPath;

    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction({ executorPlan: plan, stories }) {
          selected = true;
          assert.equal(plan.ready_for_live_executor_handoff, true);
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
          assert.equal(options.maxActions, 1);
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
    delete require.cache[jobHandlersPath];

    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.publish({ id: 42 }, { log() {} });

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
