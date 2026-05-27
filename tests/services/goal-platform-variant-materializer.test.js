"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  materializeGoalPlatformVariants,
} = require("../../lib/goal-platform-variant-materializer");
const {
  parseArgs: parseGoalPlatformVariantArgs,
} = require("../../tools/goal-platform-variant-materializer");

async function makePackage(root, id = "ig-overlong", durationS = 47.2) {
  const artifactDir = path.join(root, id);
  await fs.ensureDir(artifactDir);
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(2000, 1));
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: id,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: durationS,
    final_publish_render: true,
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: id,
    publish_status: "GREEN",
    outputs: {
      instagram_reels: {
        publish_duration_seconds: { min: 15, max: 45 },
        duration_seconds: { min: 25, max: 45 },
      },
      youtube_shorts: {
        publish_duration_seconds: { min: 15, max: 60 },
      },
    },
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    [
      "1",
      "00:00:00,000 --> 00:00:02,000",
      "Hook caption.",
      "",
      "2",
      "00:00:44,500 --> 00:00:47,000",
      "Tail caption.",
      "",
    ].join("\n"),
  );
  return { story_id: id, artifact_dir: artifactDir };
}

test("platform variant materializer creates probe-backed overlong platform variants without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-variant-"));
  const storyPackage = await makePackage(root);

  const report = await materializeGoalPlatformVariants({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:22:00.000Z",
    variantRenderer: async ({ outputPath }) => {
      await fs.outputFile(outputPath, Buffer.alloc(2200, 2));
    },
    probeDuration: async () => 44.8,
  });

  assert.equal(report.summary.variant_job_count, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const manifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;

  assert.equal(instagram.technical_duration_seconds, 44.8);
  assert.match(instagram.variant_video_path, /visual_v4_render_instagram_reels\.mp4$/);
  assert.match(instagram.variant_captions_path, /captions_instagram_reels\.srt$/);
  assert.equal(instagram.platform_variant_render.status, "ready");
  assert.equal(await fs.pathExists(instagram.variant_video_path), true);
  assert.equal(await fs.pathExists(instagram.variant_captions_path), true);
  const captions = await fs.readFile(instagram.variant_captions_path, "utf8");
  assert.match(captions, /00:00:44,500 --> 00:00:44,800/);
  assert.doesNotMatch(captions, /00:00:47,000/);
});

test("platform variant materializer leaves in-window renders alone", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-variant-none-"));
  const storyPackage = await makePackage(root, "ig-in-window", 39.2);

  const report = await materializeGoalPlatformVariants({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:23:00.000Z",
    variantRenderer: async () => {
      throw new Error("renderer_should_not_run");
    },
    probeDuration: async () => {
      throw new Error("probe_should_not_run");
    },
  });

  assert.equal(report.summary.variant_job_count, 0);
  assert.equal(report.summary.materialized_count, 0);
});

test("platform variant materializer refreshes stale variant captions without rerendering in-window video", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-caption-refresh-"));
  const storyPackage = await makePackage(root, "ig-caption-refresh", 39.2);
  const artifactDir = storyPackage.artifact_dir;
  const variantDir = path.join(artifactDir, "platform_variants", "instagram_reels");
  const variantVideoPath = path.join(variantDir, "visual_v4_render_instagram_reels.mp4");
  const variantCaptionsPath = path.join(variantDir, "captions_instagram_reels.srt");
  await fs.outputFile(variantVideoPath, Buffer.alloc(2200, 2));
  await fs.outputFile(variantCaptionsPath, "1\n00:00:00,000 --> 00:00:01,000\nOld caption.\n");
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "ig-caption-refresh",
    publish_status: "GREEN",
    outputs: {
      instagram_reels: {
        publish_duration_seconds: { min: 15, max: 45 },
        variant_video_path: variantVideoPath,
        variant_captions_path: variantCaptionsPath,
        technical_duration_seconds: 39.2,
        platform_variant_render: {
          status: "ready",
          output_path: variantVideoPath,
          captions_path: variantCaptionsPath,
          duration_s: 39.2,
        },
      },
    },
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,200\nFresh timed caption.\n",
  );

  const report = await materializeGoalPlatformVariants({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:24:00.000Z",
    variantRenderer: async () => {
      throw new Error("renderer_should_not_run");
    },
    probeDuration: async () => {
      throw new Error("probe_should_not_run");
    },
  });

  assert.equal(report.summary.variant_job_count, 0);
  assert.equal(report.summary.caption_refresh_job_count, 1);
  assert.equal(report.summary.caption_refreshed_count, 1);
  const captions = await fs.readFile(variantCaptionsPath, "utf8");
  assert.match(captions, /Fresh timed caption/);
  assert.doesNotMatch(captions, /Old caption/);
});

test("platform variant materializer CLI is wired into package scripts", () => {
  const args = parseGoalPlatformVariantArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--out-dir",
    "output/goal-contract",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(packageJson.scripts["ops:goal-platform-variants"], "node tools/goal-platform-variant-materializer.js");
});
