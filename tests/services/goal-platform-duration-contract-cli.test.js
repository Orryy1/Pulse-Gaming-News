"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const path = require("node:path");

const {
  activeStoryPackageOverridesFromDryRunPlan,
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
