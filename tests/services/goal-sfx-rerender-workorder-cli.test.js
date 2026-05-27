"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-sfx-rerender-workorder");

test("SFX rerender work-order CLI parses local safe arguments", () => {
  const args = parseArgs([
    "--root",
    "C:/repo",
    "--bridge-candidates",
    "bridge.json",
    "--dry-run-plan",
    "dry-run.json",
    "--include-all-bridge-candidates",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-23T22:40:00.000Z",
    "--json",
  ]);

  assert.equal(args.root, "C:/repo");
  assert.equal(args.bridgeCandidatesPath, "bridge.json");
  assert.equal(args.dryRunPlanPath, "dry-run.json");
  assert.equal(args.includeAllBridgeCandidates, true);
  assert.equal(args.outDir, "out");
  assert.equal(args.json, true);
});

test("SFX rerender work-order CLI writes local-only artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-workorder-cli-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-cli");
  const outDir = path.join(root, "out");
  await fs.outputFile(path.join(root, "output", "audio", "story-cli.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(root, "output", "audio", "story-cli_timestamps.json"), {
    words: [{ word: "Forza", start: 0, end: 0.2 }],
  });
  for (let index = 1; index <= 3; index += 1) {
    await fs.outputFile(path.join(artifactDir, `clip-${index}.mp4`), Buffer.alloc(2048, index));
  }
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: { selected_assets: [{ asset_id: "new-impact", role: "impact" }] },
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    sfx_asset_inventory: [{ asset_id: "old-impact", role: "impact" }],
  });
  await fs.outputJson(path.join(root, "bridge.json"), [
    {
      id: "story-cli",
      title: "Forza Horizon 6 Reviews Are In",
      render_manifest_path: path.join(artifactDir, "render_manifest.json"),
      audio_path: "output/audio/story-cli.mp3",
      timestamps_path: "output/audio/story-cli_timestamps.json",
      visual_v4_bridge_video_clips: [
        { path: path.join(artifactDir, "clip-1.mp4") },
        { path: path.join(artifactDir, "clip-2.mp4") },
        { path: path.join(artifactDir, "clip-3.mp4") },
      ],
    },
  ]);
  await fs.outputJson(path.join(root, "dry-run.json"), {
    blocked_stories: [{ story_id: "story-cli", blockers: ["sfx_render_asset_mismatch"] }],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--root",
      root,
      "--bridge-candidates",
      path.join(root, "bridge.json"),
      "--dry-run-plan",
      path.join(root, "dry-run.json"),
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-23T22:41:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(result.workOrder.safety.no_publish_triggered, true);
  assert.equal(await fs.pathExists(path.join(outDir, "sfx_variant_rerender_work_order.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "sfx_variant_rerender_work_order.md")), true);
});
