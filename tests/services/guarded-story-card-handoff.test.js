"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuardedStoryCardHandoff,
} = require("../../lib/goal-guarded-story-card-handoff");

function action(storyId, platform, overrides = {}) {
  return {
    action_id: `${storyId}:${platform}`,
    story_id: storyId,
    platform,
    title: "The Expanse Shows Real Gameplay",
    video_path: `output/goal-proof/batch/${storyId}/visual_v4_render.mp4`,
    captions_path: `output/goal-proof/batch/${storyId}/captions.srt`,
    first_frame_source: `output/goal-proof/batch/${storyId}/visual_v4_render.mp4`,
    canonical_manifest_path: `output/goal-proof/batch/${storyId}/canonical_story_manifest.json`,
    platform_publish_manifest_path: `output/goal-proof/batch/${storyId}/platform_publish_manifest.json`,
    live_publish_allowed_from_preflight_only: false,
    requires_live_executor_command: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
    ...overrides,
  };
}

function executorPlan(storyId = "story-one") {
  const actions = [
    action(storyId, "youtube_shorts"),
    action(storyId, "instagram_reels"),
    action(storyId, "facebook_reels"),
  ];
  return {
    schema_version: 1,
    generated_at: "2026-06-08T11:30:00.000Z",
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    ready_for_live_executor_handoff: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor",
    handoff_ready_action_count: actions.length,
    blocked_selected_action_count: 0,
    handoff_ready_actions: actions,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

test("guarded story-card handoff appends derived Story actions after core video actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-story-card-handoff-"));
  const imageRel = path.join("output", "stories", "story-one_story.png");
  const imageAbs = path.join(root, imageRel);
  const generatedStories = [];

  const report = await buildGuardedStoryCardHandoff({
    root,
    executorPlan: executorPlan(),
    stories: [
      {
        id: "story-one",
        title: "The Expanse: Osiris Reborn",
        approved: true,
      },
    ],
    materializeCards: true,
    generatedAt: "2026-06-08T11:35:00.000Z",
    cardGenerator: async (stories) => {
      generatedStories.push(...stories.map((story) => story.id));
      await fs.outputFile(imageAbs, Buffer.alloc(2048, 1));
      stories[0].story_image_path = imageRel;
      return { generated: 1, considered: stories.length };
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(generatedStories, ["story-one"]);
  assert.equal(report.summary.appended_story_card_action_count, 2);
  assert.deepEqual(
    report.executor_plan.handoff_ready_actions.map((item) => item.action_id),
    [
      "story-one:youtube_shorts",
      "story-one:instagram_reels",
      "story-one:facebook_reels",
      "story-one:instagram_story",
      "story-one:facebook_story",
    ],
  );
  const instagramStory = report.executor_plan.handoff_ready_actions[3];
  assert.equal(instagramStory.platform, "instagram_story");
  assert.equal(instagramStory.story_image_path, imageRel);
  assert.equal(instagramStory.image_path, imageRel);
  assert.equal(instagramStory.derived_from_platform, "instagram_reels");
  assert.equal(instagramStory.live_publish_allowed_from_preflight_only, false);
  assert.equal(report.safety.no_network_uploads, true);
  assert.equal(report.safety.no_db_mutation, true);
});

test("guarded story-card handoff does not derive card actions without matching core platforms", async () => {
  const report = await buildGuardedStoryCardHandoff({
    root: process.cwd(),
    executorPlan: {
      ...executorPlan(),
      handoff_ready_actions: [action("story-one", "youtube_shorts")],
    },
    stories: [
      {
        id: "story-one",
        approved: true,
        story_image_path: "output/stories/story-one_story.png",
      },
    ],
    materializeCards: false,
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.appended_story_card_action_count, 0);
  assert.ok(report.advisory.includes("no_story_card_actions_appended"));
});

test("guarded story-card handoff is idempotent when Story actions already exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-story-card-handoff-ready-"));
  const imageRel = path.join("output", "stories", "story-one_story.png");
  await fs.outputFile(path.join(root, imageRel), Buffer.alloc(2048, 1));
  let generatorCalls = 0;

  const base = executorPlan();
  const existingActions = [
    ...base.handoff_ready_actions,
    action("story-one", "instagram_story", {
      image_path: imageRel,
      story_image_path: imageRel,
      video_path: "",
      captions_path: "",
      media_type: "story_image",
    }),
    action("story-one", "facebook_story", {
      image_path: imageRel,
      story_image_path: imageRel,
      video_path: "",
      captions_path: "",
      media_type: "story_image",
    }),
  ];

  const report = await buildGuardedStoryCardHandoff({
    root,
    executorPlan: {
      ...base,
      handoff_ready_action_count: existingActions.length,
      handoff_ready_actions: existingActions,
    },
    stories: [{ id: "story-one", approved: true }],
    materializeCards: true,
    cardGenerator: async () => {
      generatorCalls += 1;
      throw new Error("generator should not be called for existing cards");
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(generatorCalls, 0);
  assert.equal(report.summary.existing_story_card_action_count, 2);
  assert.equal(report.summary.appended_story_card_action_count, 0);
  assert.equal(report.summary.total_story_card_action_count, 2);
  assert.equal(report.executor_plan.handoff_ready_actions.length, existingActions.length);
});

test("guarded story-card handoff regenerates stale missing Story image paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-story-card-handoff-stale-"));
  const staleImageRel = path.join("output", "stories", "rss_story_story.png");
  const generatedImageRel = path.join("output", "stories", "rss_story_story.png");
  const generatedImageAbs = path.join(root, generatedImageRel);
  const generatedStories = [];

  const report = await buildGuardedStoryCardHandoff({
    root,
    executorPlan: executorPlan("rss_story"),
    stories: [
      {
        id: "rss_story",
        title: "Steam Controller Date May Have Leaked",
        approved: true,
        story_image_path: staleImageRel,
      },
    ],
    materializeCards: true,
    generatedAt: "2026-06-08T12:55:00.000Z",
    cardGenerator: async (stories) => {
      assert.equal(stories[0].story_image_path, "");
      generatedStories.push(...stories.map((story) => story.id));
      await fs.outputFile(generatedImageAbs, Buffer.alloc(2048, 1));
      stories[0].story_image_path = generatedImageRel;
      return { generated: 1, considered: stories.length };
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(generatedStories, ["rss_story"]);
  assert.equal(report.summary.generated_story_card_count, 1);
  assert.equal(report.summary.blocked_story_card_count, 0);
  assert.equal(report.summary.appended_story_card_action_count, 2);
  assert.equal(report.executor_plan.handoff_ready_actions[3].story_image_path, generatedImageRel);
});
