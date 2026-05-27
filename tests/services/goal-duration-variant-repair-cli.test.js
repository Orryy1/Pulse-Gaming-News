"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/goal-duration-variant-repair");

test("duration variant repair CLI parses work order arguments", () => {
  const args = parseArgs([
    "--work-order",
    "duration.json",
    "--out-dir",
    "out",
    "--workspace",
    "workspace",
    "--generated-at",
    "2026-05-22T08:10:00.000Z",
    "--limit",
    "4",
    "--story-id",
    "story-one",
    "--story-id",
    "story-two",
    "--provider",
    "elevenlabs",
    "--inspect-only",
    "--json",
  ]);

  assert.equal(args.workOrderPath, "duration.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.workspaceRoot, "workspace");
  assert.equal(args.generatedAt, "2026-05-22T08:10:00.000Z");
  assert.equal(args.limit, 4);
  assert.deepEqual(args.storyIds, ["story-one", "story-two"]);
  assert.equal(args.provider, "elevenlabs");
  assert.equal(args.alignmentMode, "whisper");
  assert.equal(args.inspectOnly, true);
  assert.equal(args.json, true);
});

test("duration variant repair CLI can target the normal-production work order explicitly", () => {
  const args = parseArgs(["--normal-production", "--provider", "local"]);

  assert.match(args.workOrderPath, /normal_duration_repair_work_order\.json$/);
  assert.equal(args.normalProduction, true);
  assert.equal(args.provider, "local");
  assert.equal(args.alignmentMode, "whisper");
});

test("duration variant repair CLI accepts an explicit timestamp alignment mode", () => {
  const args = parseArgs(["--normal-production", "--provider", "local", "--alignment", "auto"]);

  assert.equal(args.normalProduction, true);
  assert.equal(args.provider, "local");
  assert.equal(args.alignmentMode, "auto");
});

test("duration variant repair CLI writes inspect-only reports without rendering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-cli-"));
  const workOrderPath = path.join(root, "duration_variant_rerender_work_order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        artifact_dir: path.join(root, "missing-package"),
        status: "needs_duration_variant_rerender",
        current_duration_s: 18.25,
        target_duration_seconds: { min: 22, max: 30 },
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--out-dir",
      path.join(root, "out"),
      "--workspace",
      root,
      "--generated-at",
      "2026-05-22T08:11:00.000Z",
      "--inspect-only",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.inspect_only_count, 1);
  assert.equal(result.report.safety.renderer_invoked, false);
  assert.equal(await fs.pathExists(path.join(root, "out", "duration_variant_repair_report.json")), true);
});

test("duration variant repair CLI scopes inspect-only repair to requested stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-variant-cli-scope-"));
  const workOrderPath = path.join(root, "duration_variant_rerender_work_order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "blocked-motion",
        title: "Star Wars Still Needs Motion",
        artifact_dir: path.join(root, "blocked-motion"),
        status: "needs_duration_variant_rerender",
        current_duration_s: 18.25,
        target_duration_seconds: { min: 35, max: 59 },
      },
      {
        story_id: "ready-duration",
        title: "PS5 Prices Need More Runtime",
        artifact_dir: path.join(root, "ready-duration"),
        status: "needs_duration_variant_rerender",
        current_duration_s: 27.5,
        target_duration_seconds: { min: 35, max: 59 },
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--out-dir",
      path.join(root, "out"),
      "--workspace",
      root,
      "--story-id",
      "ready-duration",
      "--inspect-only",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.candidate_count, 1);
  assert.deepEqual(result.report.jobs.map((job) => job.story_id), ["ready-duration"]);
});

test("duration variant repair CLI does not silently skip TikTok creator rewards jobs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-creator-rewards-cli-"));
  const artifactDir = path.join(root, "creator-rewards-story");
  await fs.ensureDir(artifactDir);
  const clipPath = path.join(artifactDir, "motion.mp4");
  await fs.outputFile(clipPath, Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "creator-rewards-story",
    canonical_subject: "Forza Horizon 6",
    narration_script:
      "Forza Horizon 6 just made Xbox's Steam plan harder to ignore. The Steam launch changes how players compare access.",
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    matched_assets: [
      {
        path: clipPath,
        asset_type: "video_clip",
        approval_status: "approved",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "creator-rewards-story",
    rendered_duration_s: 44.2,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
  });
  const workOrderPath = path.join(root, "tiktok_creator_rewards_variant_work_order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "creator-rewards-story",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        artifact_dir: artifactDir,
        status: "needs_tiktok_creator_rewards_variant",
        platform: "tiktok",
        current_duration_s: 44.2,
        target_duration_seconds: { min: 61, max: 75 },
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--out-dir",
      path.join(root, "out"),
      "--workspace",
      root,
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.candidate_count, 1);
  assert.equal(result.report.summary.blocked_count, 1);
  assert.equal(result.report.safety.renderer_invoked, false);
  assert.equal(result.report.jobs[0].story_id, "creator-rewards-story");
  assert.equal(result.report.jobs[0].status, "blocked");
  assert.ok(
    result.report.jobs[0].blockers.includes("tiktok_creator_rewards_platform_variant_materializer_required"),
  );
});
