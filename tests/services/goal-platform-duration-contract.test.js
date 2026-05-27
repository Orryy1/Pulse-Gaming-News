"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildRetentionRepairDurationContracts,
  repairGoalPlatformDurationContracts,
  writeGoalPlatformDurationContractReport,
} = require("../../lib/goal-platform-duration-contract");

async function makePackage(root, id, durationS, manifestOverrides = {}) {
  const artifactDir = path.join(root, id);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: id,
    rendered_duration_s: durationS,
    final_publish_render: true,
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    schema_version: 1,
    story_id: id,
    operating_mode: "LOCAL_PROOF",
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: { duration_seconds: { min: 35, max: 60 } },
      tiktok: { duration_seconds: { min: 61, max: 90 } },
      instagram_reels: { duration_seconds: { min: 25, max: 45 } },
      facebook_reels: { duration_seconds: { min: 35, max: 60 } },
      x: { duration_seconds: { min: 25, max: 60 } },
      ...manifestOverrides.outputs,
    },
    ...manifestOverrides,
  });
  return { story_id: id, artifact_dir: artifactDir, verdict: "GREEN" };
}

test("retention repair duration contracts separate hard publish windows from target windows", () => {
  const contracts = buildRetentionRepairDurationContracts(22.08);

  assert.deepEqual(contracts.youtube_shorts.publish_duration_seconds, { min: 15, max: 60 });
  assert.deepEqual(contracts.youtube_shorts.target_duration_seconds, { min: 22, max: 30 });
  assert.equal(contracts.youtube_shorts.duration_strategy, "retention_repair_short_cut");
  assert.equal(contracts.tiktok.creator_rewards_eligible, false);
  assert.deepEqual(contracts.tiktok.creator_rewards_duration_seconds, { min: 61, max: 90 });
  assert.ok(contracts.tiktok.duration_warnings.includes("below_creator_rewards_duration"));
});

test("platform duration contract repair updates package manifests without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-"));
  const storyPackage = await makePackage(root, "forza-short", 22.08);

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T02:20:00.000Z",
  });

  assert.equal(report.summary.package_count, 1);
  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);

  const updated = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  assert.equal(updated.operating_mode, "DRY_RUN_PUBLISH");
  assert.equal(updated.duration_contract_strategy, "retention_repair_short_cut");
  assert.equal(updated.outputs.youtube_shorts.publish_duration_seconds.min, 15);
  assert.equal(updated.outputs.tiktok.creator_rewards_eligible, false);
  assert.ok(updated.outputs.tiktok.duration_warnings.includes("below_creator_rewards_duration"));
});

test("platform duration contract repair emits rerender work orders for sub-target cuts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-rerender-"));
  const storyPackage = await makePackage(root, "short-but-valid", 18.25);

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T02:22:00.000Z",
  });

  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.variant_repair_required_count, 1);
  assert.equal(report.variant_repair_work_order.jobs.length, 1);
  assert.equal(report.variant_repair_work_order.jobs[0].story_id, "short-but-valid");
  assert.equal(report.variant_repair_work_order.jobs[0].status, "needs_duration_variant_rerender");
  assert.equal(report.variant_repair_work_order.jobs[0].current_duration_s, 18.25);
  assert.ok(
    report.variant_repair_work_order.jobs[0].actions.includes("regenerate_audio_and_word_timestamps"),
  );
});

test("platform duration contract repair emits platform variant jobs when a platform max is exceeded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-platform-variant-"));
  const storyPackage = await makePackage(root, "ps5-price", 46.733);

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T02:35:00.000Z",
  });

  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.variant_repair_required_count, 1);
  assert.equal(report.variant_repair_work_order.jobs.length, 1);
  assert.equal(report.variant_repair_work_order.jobs[0].story_id, "ps5-price");
  assert.equal(report.variant_repair_work_order.jobs[0].status, "needs_platform_duration_variant");
  assert.equal(report.variant_repair_work_order.jobs[0].platform, "instagram_reels");
  assert.equal(report.variant_repair_work_order.jobs[0].target_duration_s, 44.8);
  assert.ok(
    report.variant_repair_work_order.jobs[0].actions.includes("materialize_platform_specific_duration_variant"),
  );
});

test("platform duration contract repair does not request platform variant already materialized in window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-platform-ready-"));
  const artifactDir = path.join(root, "ps5-price-ready");
  const variantPath = path.join(artifactDir, "platform_variants", "instagram_reels", "visual_v4_render_instagram_reels.mp4");
  const storyPackage = await makePackage(root, "ps5-price-ready", 46.733, {
    outputs: {
      instagram_reels: {
        duration_seconds: { min: 25, max: 45 },
        variant_video_path: variantPath,
        platform_variant_render: {
          output_path: variantPath,
          duration_s: 44.8,
        },
      },
    },
  });
  await fs.ensureDir(path.dirname(variantPath));
  await fs.writeFile(variantPath, Buffer.alloc(2048));

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T02:36:00.000Z",
  });

  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.variant_repair_required_count, 0);
  assert.equal(report.variant_repair_work_order.jobs.length, 0);
});

test("platform duration contract repair emits TikTok creator rewards variant work orders separately from hard publish repairs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-tiktok-rewards-"));
  const storyPackage = await makePackage(root, "expanse-gameplay", 44.8);

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T04:20:00.000Z",
  });

  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(report.summary.variant_repair_required_count, 0);
  assert.equal(report.summary.tiktok_creator_rewards_variant_required_count, 1);
  assert.equal(report.variant_repair_work_order.jobs.length, 0);

  const job = report.tiktok_creator_rewards_variant_work_order.jobs[0];
  assert.equal(job.story_id, "expanse-gameplay");
  assert.equal(job.status, "needs_tiktok_creator_rewards_variant");
  assert.equal(job.platform, "tiktok");
  assert.deepEqual(job.target_duration_seconds, { min: 61, max: 75 });
  assert.equal(job.minimum_extension_seconds, 16.2);
  assert.ok(job.actions.includes("write_tiktok_specific_script_extension_source_safely"));
  assert.equal(job.safety.no_publish_triggered, true);
});

test("platform duration contract repair preserves ready TikTok creator rewards variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-tiktok-ready-"));
  const artifactDir = path.join(root, "expanse-gameplay-ready");
  const variantPath = path.join(
    artifactDir,
    "platform_variants",
    "tiktok_creator_rewards",
    "visual_v4_render_tiktok_creator_rewards.mp4",
  );
  const storyPackage = await makePackage(root, "expanse-gameplay-ready", 44.8, {
    outputs: {
      tiktok: {
        duration_seconds: { min: 61, max: 90 },
        creator_rewards_eligible: true,
        duration_warnings: [],
        technical_duration_seconds: 67.549,
        variant_video_path: variantPath,
        platform_variant_render: {
          status: "ready",
          variant_type: "tiktok_creator_rewards",
          output_path: variantPath,
          duration_s: 67.549,
          base_render_mutated: false,
        },
      },
    },
  });
  await fs.ensureDir(path.dirname(variantPath));
  await fs.writeFile(variantPath, Buffer.alloc(2048));

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-27T19:55:00.000Z",
  });

  assert.equal(report.summary.updated_count, 1);
  assert.equal(report.summary.tiktok_creator_rewards_variant_required_count, 0);
  assert.equal(report.tiktok_creator_rewards_variant_work_order.jobs.length, 0);
  const updated = await fs.readJson(path.join(storyPackage.artifact_dir, "platform_publish_manifest.json"));
  assert.equal(updated.outputs.tiktok.creator_rewards_eligible, true);
  assert.equal(updated.outputs.tiktok.technical_duration_seconds, 67.549);
  assert.deepEqual(updated.outputs.tiktok.duration_warnings, []);
  assert.equal(updated.outputs.tiktok.platform_variant_render.variant_type, "tiktok_creator_rewards");
});

test("platform duration contract repair blocks too-short renders instead of bending the gate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-block-"));
  const storyPackage = await makePackage(root, "too-short", 11.5);

  const report = await repairGoalPlatformDurationContracts({
    storyPackages: [storyPackage],
    generatedAt: "2026-05-22T02:25:00.000Z",
  });

  assert.equal(report.summary.updated_count, 0);
  assert.equal(report.summary.blocked_count, 1);
  assert.ok(report.blocked[0].blockers.includes("render_duration_below_retention_repair_min:15"));
});

test("platform duration contract repair writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-write-"));
  const storyPackage = await makePackage(root, "forza-short", 24.5);
  const report = await repairGoalPlatformDurationContracts({ storyPackages: [storyPackage] });
  const written = await writeGoalPlatformDurationContractReport(report, { outputDir: path.join(root, "out") });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /Goal Platform Duration Contract/);
});

test("platform duration contract report writes platform trim jobs with scalar target durations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-platform-write-"));
  const storyPackage = await makePackage(root, "forza-platform-trim", 45.133);
  const report = await repairGoalPlatformDurationContracts({ storyPackages: [storyPackage] });

  assert.equal(report.variant_repair_work_order.jobs[0].status, "needs_platform_duration_variant");
  assert.equal(report.variant_repair_work_order.jobs[0].target_duration_s, 44.8);

  const written = await writeGoalPlatformDurationContractReport(report, { outputDir: path.join(root, "out") });
  const markdown = await fs.readFile(written.markdownPath, "utf8");

  assert.match(markdown, /forza-platform-trim: 45\.133s -> 44\.8s/);
});
