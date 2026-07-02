"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  buildPlatformVariantFfmpegArgs,
  materializeGoalPlatformVariants,
} = require("../../lib/goal-platform-variant-materializer");
const {
  parseArgs: parseGoalPlatformVariantArgs,
} = require("../../tools/goal-platform-variant-materializer");

async function makePackage(root, id = "ig-overlong", durationS = 61.2) {
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
        publish_duration_seconds: { min: 15, max: 60 },
        duration_seconds: { min: 25, max: 60 },
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
      "00:00:58,500 --> 00:01:01,000",
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
    probeDuration: async () => 59,
  });

  assert.equal(report.summary.variant_job_count, 2);
  assert.equal(report.summary.materialized_count, 2);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const manifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;

  assert.equal(instagram.technical_duration_seconds, 59);
  assert.match(instagram.variant_video_path, /visual_v4_render_instagram_reels\.mp4$/);
  assert.match(instagram.variant_captions_path, /captions_instagram_reels\.srt$/);
  assert.equal(instagram.platform_variant_render.status, "ready");
  assert.equal(await fs.pathExists(instagram.variant_video_path), true);
  assert.equal(await fs.pathExists(instagram.variant_captions_path), true);
  const captions = await fs.readFile(instagram.variant_captions_path, "utf8");
  assert.match(captions, /00:00:58,500 --> 00:00:59,000/);
  assert.doesNotMatch(captions, /00:01:01,000/);

  const youtube = manifest.outputs.youtube_shorts;
  assert.equal(youtube.technical_duration_seconds, 59);
  assert.match(youtube.variant_video_path, /visual_v4_render_youtube_shorts\.mp4$/);
  assert.equal(youtube.platform_variant_render.status, "ready");
  assert.equal(await fs.pathExists(youtube.variant_video_path), true);
});

test("platform variant materializer writes resolvable variant paths for relative artifact dirs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-variant-relative-"));
  const storyPackage = await makePackage(root, "ig-relative-dir", 61.2);
  const relativeArtifactDir = path.relative(process.cwd(), storyPackage.artifact_dir);

  const report = await materializeGoalPlatformVariants({
    storyPackages: [{ ...storyPackage, artifact_dir: relativeArtifactDir }],
    generatedAt: "2026-05-23T00:22:30.000Z",
    variantRenderer: async ({ outputPath }) => {
      await fs.outputFile(outputPath, Buffer.alloc(2200, 2));
    },
    probeDuration: async () => 59,
  });

  assert.equal(report.summary.variant_job_count, 2);
  assert.equal(report.summary.materialized_count, 2);

  const manifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;

  assert.equal(path.isAbsolute(instagram.variant_video_path), true);
  assert.equal(path.isAbsolute(instagram.platform_variant_render.output_path), true);
  assert.equal(await fs.pathExists(instagram.variant_video_path), true);
  assert.equal(await fs.pathExists(instagram.platform_variant_render.output_path), true);

  const youtube = manifest.outputs.youtube_shorts;
  assert.equal(path.isAbsolute(youtube.variant_video_path), true);
  assert.equal(path.isAbsolute(youtube.platform_variant_render.output_path), true);
  assert.equal(await fs.pathExists(youtube.variant_video_path), true);
  assert.equal(await fs.pathExists(youtube.platform_variant_render.output_path), true);
});

test("platform variant materializer accepts scheduler bridge artifact dirs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-variant-bridge-"));
  const storyPackage = await makePackage(root, "ig-bridge-dir", 61.4);

  const report = await materializeGoalPlatformVariants({
    storyPackages: [
      {
        story_id: storyPackage.story_id,
        scheduler_bridge_artifact_dir: storyPackage.artifact_dir,
      },
    ],
    generatedAt: "2026-06-16T21:20:00.000Z",
    variantRenderer: async ({ outputPath, targetDurationS }) => {
      assert.equal(targetDurationS, 59);
      await fs.outputFile(outputPath, Buffer.alloc(2300, 2));
    },
    probeDuration: async () => 59,
  });

  assert.equal(report.summary.blocked_count, 0);
  assert.equal(report.summary.variant_job_count, 2);
  assert.equal(report.summary.materialized_count, 2);

  const manifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;
  assert.match(instagram.variant_video_path, /visual_v4_render_instagram_reels\.mp4$/);
  assert.equal(instagram.platform_variant_render.source_duration_s, 61.4);
  assert.equal(instagram.platform_variant_render.duration_s, 59);

  const youtube = manifest.outputs.youtube_shorts;
  assert.match(youtube.variant_video_path, /visual_v4_render_youtube_shorts\.mp4$/);
  assert.equal(youtube.platform_variant_render.source_duration_s, 61.4);
  assert.equal(youtube.platform_variant_render.duration_s, 59);
});

test("platform variant materializer creates Instagram-safe variants for in-window renders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-variant-none-"));
  const storyPackage = await makePackage(root, "ig-in-window", 39.2);
  const rendered = [];

  const report = await materializeGoalPlatformVariants({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-23T00:23:00.000Z",
    variantRenderer: async ({ outputPath, platform, targetDurationS }) => {
      rendered.push({ outputPath, platform, targetDurationS });
      await fs.outputFile(outputPath, Buffer.alloc(2200, 2));
    },
    probeDuration: async () => 39.2,
  });

  assert.equal(report.summary.variant_job_count, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.deepEqual(rendered.map((item) => item.platform), ["instagram_reels"]);
  assert.equal(rendered[0].targetDurationS, 39.2);

  const manifest = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;
  assert.match(instagram.variant_video_path, /visual_v4_render_instagram_reels\.mp4$/);
  assert.equal(instagram.platform_variant_render.encoder_profile, "instagram_reels_meta_safe_h264_aac_v3");

  const youtube = manifest.outputs.youtube_shorts;
  assert.equal(youtube.variant_video_path, undefined);
});

test("platform variant materializer refreshes stale in-window platform variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-stale-variant-"));
  const storyPackage = await makePackage(root, "ig-stale-variant", 40.333);
  const artifactDir = storyPackage.artifact_dir;
  const variantDir = path.join(artifactDir, "platform_variants", "instagram_reels");
  const oldVariantPath = path.join(variantDir, "visual_v4_render_instagram_reels.mp4");
  const oldCaptionsPath = path.join(variantDir, "captions_instagram_reels.srt");
  await fs.outputFile(oldVariantPath, Buffer.alloc(2200, 2));
  await fs.outputFile(oldCaptionsPath, "1\n00:00:00,000 --> 00:00:01,000\nOld caption.\n");
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "ig-stale-variant",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    rendered_duration_s: 40.333,
    final_publish_render: true,
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    generated_at: "2026-05-31T07:03:20.707Z",
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "ig-stale-variant",
    publish_status: "GREEN",
    outputs: {
      instagram_reels: {
        publish_duration_seconds: { min: 15, max: 60 },
        variant_video_path: oldVariantPath,
        variant_captions_path: oldCaptionsPath,
        technical_duration_seconds: 59.8,
        platform_variant_render: {
          status: "ready",
          output_path: oldVariantPath,
          captions_path: oldCaptionsPath,
          duration_s: 59.8,
          source_duration_s: 47.04,
          generated_at: "2026-05-27T13:19:04.119Z",
        },
      },
    },
  });

  const report = await materializeGoalPlatformVariants({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-31T09:30:00.000Z",
    variantRenderer: async ({ outputPath, targetDurationS }) => {
      assert.equal(targetDurationS, 40.333);
      await fs.outputFile(outputPath, Buffer.alloc(2400, 3));
    },
    probeDuration: async () => 40.333,
  });

  assert.equal(report.summary.variant_job_count, 1);
  assert.equal(report.summary.materialized_count, 1);
  const manifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const instagram = manifest.outputs.instagram_reels;
  assert.equal(instagram.platform_variant_render.generated_at, "2026-05-31T09:30:00.000Z");
  assert.equal(instagram.platform_variant_render.source_duration_s, 40.333);
  assert.equal(instagram.technical_duration_seconds, 40.333);
  assert.doesNotMatch(await fs.readFile(instagram.variant_captions_path, "utf8"), /Old caption/);
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
        publish_duration_seconds: { min: 15, max: 60 },
        variant_video_path: variantVideoPath,
        variant_captions_path: variantCaptionsPath,
        technical_duration_seconds: 39.2,
        platform_variant_render: {
          status: "ready",
          platform: "instagram_reels",
          encoder_profile: "instagram_reels_meta_safe_h264_aac_v3",
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

test("platform variant materializer uses conservative Instagram Reels encoding args", () => {
  const args = buildPlatformVariantFfmpegArgs({
    inputPath: "input.mp4",
    outputPath: "output.mp4",
    targetDurationS: 58.4,
    platform: "instagram_reels",
  });

  assert.deepEqual(args.slice(0, 5), ["-y", "-i", "input.mp4", "-t", "58.4"]);
  assert.ok(args.includes("-r"));
  assert.equal(args[args.indexOf("-r") + 1], "30");
  assert.ok(args.includes("-maxrate"));
  assert.equal(args[args.indexOf("-maxrate") + 1], "12000k");
  assert.ok(args.includes("-bufsize"));
  assert.equal(args[args.indexOf("-bufsize") + 1], "24000k");
  assert.ok(args.includes("-b:a"));
  assert.equal(args[args.indexOf("-b:a") + 1], "128k");
  assert.ok(args.includes("-ac"));
  assert.equal(args[args.indexOf("-ac") + 1], "2");
  assert.ok(args.includes("-movflags"));
  assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
});
