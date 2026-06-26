"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleGuardedLiveDispatchPublish,
  buildFreshRefillOfficialSourceEvidence,
  freshRefillNarrationProviderPreference,
  guardedPublishFailureMessage,
  guardedPublishResultShouldFailJob,
  readGuardedLiveExecutorPlanForScheduler,
} = require("../../lib/job-handlers");

const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

test("guarded publish result fails the job when a window has no upload", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 0,
    }),
    true,
  );
});

test("guarded publish result fails the job for red or blocked windows", () => {
  for (const status of ["red", "failed", "blocked"]) {
    assert.equal(
      guardedPublishResultShouldFailJob({
        guarded_live_dispatch: true,
        status,
        action_id: `story-1:${status}`,
        upload_attempt_count: 1,
      }),
      true,
      status,
    );
  }
});

test("guarded publish result allows successful upload windows", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 1,
    }),
    false,
  );
});

test("guarded publish failure message includes the action and reason", () => {
  assert.equal(
    guardedPublishFailureMessage({
      guarded_live_dispatch: true,
      status: "red",
      action_id: "story-1:instagram_reels",
      outcome: "failed",
    }),
    "guarded_publish_window_failed:story-1:instagram_reels:failed",
  );
});

test("guarded publish failure message includes a safe platform error detail", () => {
  const message = guardedPublishFailureMessage({
    guarded_live_dispatch: true,
    status: "red",
    action_id: "story-1:youtube_shorts",
    outcome: "failed",
    error: "YouTube upload failed: access_token=abc123 and quota exceeded",
  });

  assert.match(message, /^guarded_publish_window_failed:story-1:youtube_shorts:failed:/);
  assert.match(message, /youtube_upload_failed/);
  assert.match(message, /access_token_redacted/);
  assert.doesNotMatch(message, /abc123/);
});

test("fresh refill narration provider stays local unless ElevenLabs is explicitly enabled", () => {
  assert.equal(freshRefillNarrationProviderPreference({ payload: {}, env: {} }), "local");
  assert.equal(
    freshRefillNarrationProviderPreference({
      payload: { tts_provider_preference: "elevenlabs" },
      env: {},
    }),
    "elevenlabs",
  );
  assert.equal(
    freshRefillNarrationProviderPreference({
      payload: {},
      env: { PULSE_FRESH_REFILL_ALLOW_ELEVENLABS_TTS: "true" },
    }),
    "elevenlabs",
  );
});

test("fresh refill source evidence preserves official YouTube watch references as reference-only sources", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-youtube-"));
  const artifactDir = path.join(tmp, "seed_capcom_spotlight_pressure_20260625");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");

  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "seed_capcom_spotlight_pressure_20260625",
    selected_title: "Capcom Spotlight Has To Prove These Games Are More Than Names",
    canonical_title: "Capcom Spotlight Has To Prove These Games Are More Than Names",
    canonical_subject: "Capcom Spotlight",
    canonical_game: "Capcom Spotlight",
    narration_script:
      "Capcom has thirty minutes tonight to make three very different games feel urgent. Follow Pulse Gaming so you never miss a beat.",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "Capcom Spotlight",
      url: "https://www.capcom-games.com/showcase/spotlight/",
      type: "official_showcase_page",
    },
    direct_media_candidates: [
      {
        direct_media_url: "https://www.youtube.com/watch?v=cwpiuMofOeo",
        label: "Teaser: Capcom Spotlight US",
        source_family: "capcom_spotlight_us_teaser",
        source_type: "official_youtube_reference",
      },
      {
        direct_media_url_if_available: "https://www.youtube.com/watch?v=_m8DUO8gjnE",
        label: "Teaser: Capcom Spotlight UK",
        source_family: "capcom_spotlight_uk_teaser",
        source_type: "official_youtube_reference",
      },
    ],
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [
    {
      story_id: "seed_capcom_spotlight_pressure_20260625",
      artifact_dir: artifactDir,
    },
  ], { spaces: 2 });

  const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
  const entries = await fs.readJson(result.officialSourceEntriesPath);
  const intake = await fs.readJson(result.officialSourceIntakeJsonPath);

  assert.equal(result.story_count, 1);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.official_source_url), [
    "https://www.youtube.com/watch?v=cwpiuMofOeo",
    "https://www.youtube.com/watch?v=_m8DUO8gjnE",
  ]);
  assert.ok(entries.every((entry) => entry.source_type === "official_youtube_channel_url"));
  assert.ok(entries.every((entry) => entry.direct_media_url_if_available === ""));
  assert.equal(intake.summary.accepted, 2);
  assert.equal(intake.summary.rejected, 0);
  assert.ok(intake.accepted_references.every((reference) => reference.source_url_kind === "youtube_watch"));
  assert.ok(intake.accepted_references.every((reference) => reference.segment_validation_eligible === false));
});

test("guarded publish handler preserves failed platform error in thrown job message", async () => {
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const originalCache = new Map([
    [executorPath, require.cache[executorPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
  ]);
  const originalEnv = {
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-error-detail-"));
  const planPath = path.join(root, "guarded_dispatch_executor_plan.json");
  try {
    await fs.writeJson(planPath, {
      mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
      handoff_ready_actions: [
        {
          action_id: "story-1:youtube_shorts",
          story_id: "story-1",
          platform: "youtube_shorts",
          title: "A Failed Upload",
        },
      ],
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    });
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = planPath;
    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction() {
          return {
            exhausted: false,
            action_id: "story-1:youtube_shorts",
            selected_action_ids: ["story-1:youtube_shorts"],
            action: {
              action_id: "story-1:youtube_shorts",
              story_id: "story-1",
              platform: "youtube_shorts",
              title: "A Failed Upload",
            },
          };
        },
        async runGuardedLiveDispatchExecutor() {
          return {
            verdict: "RED",
            summary: {
              upload_attempt_count: 0,
              db_mutation_count: 1,
            },
            actions: [
              {
                action_id: "story-1:youtube_shorts",
                story_id: "story-1",
                platform: "youtube_shorts",
                outcome: "failed",
                error: "YouTube upload failed: quota exceeded",
                uploaded: false,
                db_mutated: true,
              },
            ],
            blocked_actions: [],
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
          return [];
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async () => {},
    };

    await assert.rejects(
      () => handleGuardedLiveDispatchPublish({ id: 123 }, { log() {} }),
      /guarded_publish_window_failed:story-1:youtube_shorts:failed:youtube_upload_failed_quota_exceeded/,
    );
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    if (originalEnv.PULSE_GUARDED_EXECUTOR_PLAN_PATH === undefined) {
      delete process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH;
    } else {
      process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = originalEnv.PULSE_GUARDED_EXECUTOR_PLAN_PATH;
    }
    await fs.remove(root);
  }
});

test("scheduler refreshes a stale partial executor handoff from the guarded dispatch plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-scheduler-executor-coverage-"));
  const guardedPlanPath = path.join(root, "guarded_dispatch_plan.json");
  const executorPlanPath = path.join(root, "guarded_dispatch_executor_plan.json");
  const previousPlanPath = process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH;

  const dispatchAction = (platform) => ({
    story_id: "story-1",
    platform,
    title: "A Full Story Bundle",
    video_path: "C:\\proof\\story-1\\visual_v4_render.mp4",
    captions_path: "C:\\proof\\story-1\\captions.srt",
    first_frame_source: "C:\\proof\\story-1\\visual_v4_render.mp4",
    canonical_manifest_path: "C:\\proof\\story-1\\canonical_story_manifest.json",
    platform_publish_manifest_path: "C:\\proof\\story-1\\platform_publish_manifest.json",
    live_publish_allowed_from_preflight: false,
    requires_guarded_live_dispatch_executor: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  });

  await fs.writeJson(guardedPlanPath, {
    schema_version: 1,
    generated_at: "2026-06-19T09:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck",
    dispatch_ready_actions: [
      dispatchAction("youtube_shorts"),
      dispatchAction("instagram_reels"),
      dispatchAction("facebook_reels"),
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  await fs.writeJson(executorPlanPath, {
    schema_version: 1,
    generated_at: "2026-06-19T09:05:00.000Z",
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    source_mode: "manual_single_action_preflight",
    ready_for_live_executor_handoff: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor",
    handoff_ready_action_count: 1,
    blocked_selected_action_count: 0,
    handoff_ready_actions: [{
      action_id: "story-1:youtube_shorts",
      story_id: "story-1",
      platform: "youtube_shorts",
      title: "A Full Story Bundle",
      live_publish_allowed_from_preflight_only: false,
      requires_live_executor_command: true,
      requires_last_second_kill_switch_check: true,
      requires_last_second_platform_recheck: true,
    }],
    blocked_selected_actions: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  try {
    process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = guardedPlanPath;
    const plan = await readGuardedLiveExecutorPlanForScheduler(
      executorPlanPath,
      "2026-06-19T09:06:00.000Z",
    );

    assert.equal(plan.source_mode, "scheduler_scoped_guarded_dispatch_plan");
    assert.equal(plan.handoff_ready_action_count, 3);
    assert.deepEqual(
      plan.handoff_ready_actions.map((action) => action.action_id),
      [
        "story-1:youtube_shorts",
        "story-1:instagram_reels",
        "story-1:facebook_reels",
      ],
    );
  } finally {
    if (previousPlanPath === undefined) delete process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH;
    else process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = previousPlanPath;
  }
});
