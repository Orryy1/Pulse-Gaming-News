"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
