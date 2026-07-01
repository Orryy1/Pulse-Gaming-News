"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const test = require("node:test");

const path = require("node:path");

const {
  activeStoryPackageOverridesFromDryRunPlan,
  defaultDryRunPlanPathForArgs,
  main,
  parseArgs,
} = require("../../tools/goal-platform-duration-contract");

test("goal platform duration contract CLI stays dry-run safe by default", () => {
  const args = parseArgs([
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--out-dir",
    "output/goal-contract",
    "--generated-at",
    "2026-05-22T02:30:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "output/goal-contract/story-packages.json");
  assert.equal(args.outDir, "output/goal-contract");
  assert.equal(args.generatedAt, "2026-05-22T02:30:00.000Z");
  assert.equal(args.json, true);
  assert.equal(args.help, false);
});

test("goal platform duration contract CLI derives active artifact dirs from current dry-run media paths", () => {
  const root = path.join("C:", "repo", "pulse-gaming");
  const overrides = activeStoryPackageOverridesFromDryRunPlan(
    {
      actions: [
        {
          story_id: "rss_current",
          canonical_manifest_path: "output/current/rss_current/canonical_manifest.json",
        },
        {
          story_id: "rss_current",
          video_path: "output/older/rss_current/visual_v4_render.mp4",
        },
        {
          storyId: "rss_video_only",
          video_path: "output/current/rss_video_only/visual_v4_render.mp4",
        },
      ],
    },
    root,
  );

  assert.equal(overrides.size, 2);
  assert.deepEqual(overrides.get("rss_current"), {
    story_id: "rss_current",
    artifact_dir: path.resolve(root, "output/current/rss_current"),
  });
  assert.deepEqual(overrides.get("rss_video_only"), {
    story_id: "rss_video_only",
    artifact_dir: path.resolve(root, "output/current/rss_video_only"),
  });
});

test("goal platform duration contract CLI does not apply stale default dry-run overrides to explicit packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-duration-contract-cli-explicit-"));
  const storyId = "rss_marvel_tokon";
  const staleDir = path.join(root, "output", "stale", storyId);
  const freshDir = path.join(root, "output", "fresh", storyId);
  await fs.ensureDir(staleDir);
  await fs.ensureDir(freshDir);
  await fs.outputJson(path.join(staleDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: 42,
  });
  await fs.outputJson(path.join(staleDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: { youtube_shorts: { duration_seconds: { min: 35, max: 60 } } },
  });
  await fs.outputJson(path.join(freshDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: 63.633,
  });
  await fs.outputJson(path.join(freshDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: { youtube_shorts: { duration_seconds: { min: 35, max: 60 } } },
  });
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.outputJson(storyPackagesPath, [{ story_id: storyId, artifact_dir: freshDir }]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "dry_run_publish_plan.json"), {
    actions: [
      {
        story_id: storyId,
        video_path: path.join(staleDir, "visual_v4_render.mp4"),
      },
    ],
  });

  const { report } = await main([
    "--root",
    root,
    "--story-packages",
    storyPackagesPath,
    "--out-dir",
    path.join(root, "out"),
    "--generated-at",
    "2026-07-02T00:30:00.000Z",
    "--json",
  ]);

  assert.equal(report.updated[0].artifact_dir, freshDir);
  assert.equal(report.updated[0].rendered_duration_s, 63.633);
  assert.equal(report.summary.variant_repair_required_count, 1);
  assert.equal(defaultDryRunPlanPathForArgs(parseArgs(["--story-packages", storyPackagesPath]), root), null);
});
