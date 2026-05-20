"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterLegacyRenderImageEntriesForSafety,
  isRenderableVideoClipPath,
  legacyRenderImageSafetyVerdict,
  planLegacyVisualSequence,
} = require("../../assemble");

test("legacy visual planner keeps slot 0 as still image by default", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png", "img2.png", "img3.png", "img4.png"],
    ["clip0.mp4", "clip1.mp4"],
  );

  assert.equal(plan.visualPaths[0], "img0.png");
  assert.equal(plan.isVideoSlot[0], false);
  assert.equal(plan.visualPaths[2], "clip0.mp4");
  assert.equal(plan.visualPaths[4], "clip1.mp4");
  assert.deepEqual(
    plan.placements.map((p) => p.slot),
    [2, 4],
  );
});

test("legacy visual planner uses the second slot when only two visuals exist", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png"],
    ["clip0.mp4"],
  );

  assert.equal(plan.visualPaths[0], "img0.png");
  assert.equal(plan.visualPaths[1], "clip0.mp4");
  assert.deepEqual(plan.isVideoSlot, [false, true]);
});

test("legacy visual planner can still opt into hook video placement explicitly", () => {
  const plan = planLegacyVisualSequence(
    ["img0.png", "img1.png", "img2.png"],
    ["clip0.mp4"],
    { allowHookVideoSlot: true },
  );

  assert.equal(plan.visualPaths[0], "clip0.mp4");
  assert.equal(plan.isVideoSlot[0], true);
  assert.equal(plan.placements[0].reason, "hook_video_slot");
});

test("assemble exposes Studio V4 render bridge helpers for the production handoff", () => {
  const {
    buildStudioV4RenderBridge,
    applyStudioV4RenderBridgeToStory,
  } = require("../../lib/studio/v4/render-bridge");

  const story = {
    id: "forza-v4-bridge",
    video_clips: ["legacy.mp4"],
    studio_v4_canonical_packet: {
      readiness: { status: "ready_for_studio_v4_render" },
      director_plan: {
        shot_plan: [
          {
            id: "motion",
            kind: "motion_clip",
            source_family: "steam",
            media_path: "C:/media/steam.mp4",
            startS: 0.35,
            durationS: 2.4,
          },
        ],
      },
    },
    visual_v4_motion_pack: {
      clips: [
        {
          id: "steam",
          source_family: "steam",
          path: "C:/media/steam.mp4",
          mediaStartS: 10,
          durationS: 3,
        },
      ],
    },
  };
  const bridge = buildStudioV4RenderBridge({
    story,
    pathExists: () => true,
  });

  applyStudioV4RenderBridgeToStory(story, bridge);

  assert.equal(bridge.readiness.status, "bridge_ready");
  assert.deepEqual(story.video_clips, ["C:/media/steam.mp4"]);
  assert.equal(story.render_lane, "studio_v4_director_bridge");
});

test("assemble accepts validated direct-media URLs as renderable V4 clips", () => {
  assert.equal(
    isRenderableVideoClipPath(
      "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/qksvu_H_ODjUC4em.mp4?tag=14",
    ),
    true,
  );
  assert.equal(isRenderableVideoClipPath("https://www.youtube.com/watch?v=abc123"), false);
  assert.equal(isRenderableVideoClipPath("C:/missing/local.mp4"), false);
});

test("legacy render image safety rejects low-relevance article inline portraits", () => {
  const verdict = legacyRenderImageSafetyVerdict(
    {
      title:
        "California bill backed by Stop Killing Games campaign clears committee",
    },
    {
      path: "output/image_cache/story_article_inline_1.jpg",
      type: "article_inline",
      source: "article",
      thumbnail_safety_score: 30,
      thumbnail_safety_warnings: ["article_image_relevance_review"],
    },
    { likely_has_face: true },
  );

  assert.equal(verdict.allow, false);
  assert.ok(verdict.reasons.includes("thumbnail_safety_low_score"));
  assert.ok(verdict.reasons.includes("low_relevance_article_inline"));
  assert.ok(verdict.reasons.includes("unsafe_face_like_render_image"));
});

test("legacy render image safety dedupes repeated article images", async () => {
  const result = await filterLegacyRenderImageEntriesForSafety(
    { title: "Stop Killing Games campaign update" },
    [
      {
        path: "C:/cache/article.jpg",
        image: {
          path: "output/image_cache/story_article.jpg",
          type: "article_hero",
          source: "article",
          thumbnail_safety_score: 100,
        },
      },
      {
        path: "C:/cache/article-copy.jpg",
        image: {
          path: "output/image_cache/story_article_inline_0.jpg",
          type: "article_inline",
          source: "article",
          thumbnail_safety_score: 90,
        },
      },
    ],
    {
      prescanImage: async () => ({ likely_has_face: false }),
      computeContentHash: async () => "same-hash",
    },
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.deepEqual(result.rejected[0].verdict.reasons, [
    "duplicate_render_image",
  ]);
});
