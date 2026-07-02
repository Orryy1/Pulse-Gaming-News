"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuardedDispatchQualityAudit,
} = require("../../lib/guarded-dispatch-quality-audit");
const packageJson = require("../../package.json");

async function makeStory(root, id, {
  title = "Test Story",
  hyperframesCardCount = 4,
  sceneRoots = ["clip-a", "clip-b", "clip-c"],
  instagramVariant = true,
} = {}) {
  const artifactDir = path.join(root, id);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: id,
    selected_title: title,
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: id,
    rendered_duration_s: 42,
    renderer: "visual_v4_production",
    hyperframesCardCount,
    hyperframesPremiumShellGate: {
      verdict: "pass",
      passCount: hyperframesCardCount,
      blockers: [],
    },
    clip_scene_plan: {
      scenes: sceneRoots.map((rootKey, index) => ({
        id: `scene-${index}`,
        sourceRootKey: rootKey,
      })),
    },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: id,
    outputs: {
      instagram_reels: instagramVariant
        ? {
            variant_video_path: path.join(
              artifactDir,
              "platform_variants",
              "instagram_reels",
              "visual_v4_render_instagram_reels.mp4",
            ),
            variant_captions_path: path.join(
              artifactDir,
              "platform_variants",
              "instagram_reels",
              "captions_instagram_reels.srt",
            ),
            platform_variant_render: {
              encoder_profile: "instagram_reels_meta_safe_h264_aac_v3",
            },
          }
        : {},
    },
  });
  return artifactDir;
}

test("guarded dispatch quality audit warns on thin HyperFrames handoff videos", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-dispatch-quality-thin-"));
  const artifactDir = await makeStory(root, "thin-story", {
    hyperframesCardCount: 1,
    sceneRoots: ["source-a-window-1", "source-b-window-1", "source-c-window-1"],
  });

  const report = await buildGuardedDispatchQualityAudit({
    guardedDispatchExecutorPreflight: {
      handoff_ready_actions: [
        {
          story_id: "thin-story",
          platform: "youtube_shorts",
          title: "Thin Story",
          canonical_manifest_path: path.join(artifactDir, "canonical_story_manifest.json"),
          video_path: path.join(artifactDir, "visual_v4_render.mp4"),
        },
      ],
    },
    generatedAt: "2026-07-02T10:20:00.000Z",
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.warning_count, 1);
  assert.deepEqual(report.stories[0].warnings, [
    "hyperframes_card_count_below_target:1/4",
  ]);
});

test("guarded dispatch quality audit blocks repeated visual source roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-dispatch-quality-repeat-"));
  const artifactDir = await makeStory(root, "repeat-story", {
    sceneRoots: [
      "steam_trailer_123_window_12_5",
      "steam_trailer_123_window_18_5",
      "steam_trailer_456_window_20_5",
    ],
  });

  const report = await buildGuardedDispatchQualityAudit({
    guardedDispatchExecutorPreflight: {
      handoff_ready_actions: [
        {
          story_id: "repeat-story",
          platform: "youtube_shorts",
          title: "Repeat Story",
          canonical_manifest_path: path.join(artifactDir, "canonical_story_manifest.json"),
          video_path: path.join(artifactDir, "visual_v4_render.mp4"),
        },
      ],
    },
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.blocker_count, 1);
  assert.match(report.stories[0].blockers[0], /^repeated_visual_source_root:steam_trailer_123/);
});

test("guarded dispatch quality audit blocks Instagram actions without native safe variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-dispatch-quality-ig-"));
  const artifactDir = await makeStory(root, "ig-story", {
    instagramVariant: false,
  });

  const report = await buildGuardedDispatchQualityAudit({
    guardedDispatchExecutorPreflight: {
      handoff_ready_actions: [
        {
          story_id: "ig-story",
          platform: "instagram_reels",
          title: "IG Story",
          canonical_manifest_path: path.join(artifactDir, "canonical_story_manifest.json"),
          video_path: path.join(artifactDir, "visual_v4_render.mp4"),
        },
      ],
    },
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.stories[0].blockers.includes("instagram_reels_native_variant_missing"));
});

test("guarded dispatch quality audit command is registered as read-only ops proof", () => {
  assert.equal(
    packageJson.scripts["ops:guarded-dispatch-quality-audit"],
    "node tools/guarded-dispatch-quality-audit.js",
  );
});
