"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalSfxRerenderWorkOrder,
  writeGoalSfxRerenderWorkOrder,
} = require("../../lib/goal-sfx-rerender-workorder");

async function makeBridgePackage(root, storyId = "story-sfx") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputFile(path.join(root, "output", "audio", `${storyId}.mp3`), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(root, "output", "audio", `${storyId}_timestamps.json`), {
    words: [{ word: "Hades", start: 0, end: 0.2 }],
  });
  await fs.outputFile(path.join(artifactDir, "clip-1.mp4"), Buffer.alloc(2048, 2));
  await fs.outputFile(path.join(artifactDir, "clip-2.mp4"), Buffer.alloc(2048, 3));
  await fs.outputFile(path.join(artifactDir, "clip-3.mp4"), Buffer.alloc(2048, 4));
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      selected_assets: [
        { asset_id: "cinematic-impact-new", role: "impact" },
        { asset_id: "tight-transition-new", role: "transition" },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    sfx_asset_inventory: [
      { asset_id: "flat-impact-old", role: "impact" },
      { asset_id: "same-transition-old", role: "transition" },
    ],
  });
  return artifactDir;
}

test("SFX rerender work order turns bridge SFX mismatches into forced final render jobs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-workorder-"));
  const artifactDir = await makeBridgePackage(root, "story-ready");

  const workOrder = await buildGoalSfxRerenderWorkOrder({
    workspaceRoot: root,
    generatedAt: "2026-05-23T22:30:00.000Z",
    bridgeCandidates: [
      {
        id: "story-ready",
        title: "Hades II Just Broke PlayStation's Silence",
        exported_path: path.join(artifactDir, "visual_v4_render.mp4"),
        render_manifest_path: path.join(artifactDir, "render_manifest.json"),
        audio_path: "output/audio/story-ready.mp3",
        timestamps_path: "output/audio/story-ready_timestamps.json",
        visual_v4_bridge_video_clips: [
          { path: path.join(artifactDir, "clip-1.mp4") },
          { path: path.join(artifactDir, "clip-2.mp4") },
          { path: path.join(artifactDir, "clip-3.mp4") },
        ],
      },
    ],
    dryRunPlan: {
      blocked_stories: [
        {
          story_id: "story-ready",
          blockers: ["sfx_render_asset_mismatch"],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.summary.blocked_on_rerender_inputs_count, 0);
  assert.equal(workOrder.summary.sfx_render_asset_mismatch_count, 1);
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.equal(workOrder.jobs[0].force_final_render, true);
  assert.equal(workOrder.jobs[0].evidence.materialised_motion_clip_count, 3);
  assert.deepEqual(workOrder.jobs[0].evidence.current_sfx_asset_ids, [
    "cinematic-impact-new",
    "tight-transition-new",
  ]);
  assert.deepEqual(workOrder.jobs[0].evidence.rendered_sfx_asset_ids, [
    "flat-impact-old",
    "same-transition-old",
  ]);
  assert.equal(workOrder.jobs[0].actions[0].action_id, "run_visual_v4_production_render");
  assert.equal(workOrder.jobs[0].actions[0].force, true);
  assert.equal(workOrder.safety.no_publish_triggered, true);
  assert.equal(workOrder.safety.no_db_mutation, true);
});

test("SFX rerender work order blocks candidates that still lack final render inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-workorder-blocked-"));
  const artifactDir = await makeBridgePackage(root, "story-blocked");
  await fs.remove(path.join(root, "output", "audio", "story-blocked_timestamps.json"));

  const workOrder = await buildGoalSfxRerenderWorkOrder({
    workspaceRoot: root,
    generatedAt: "2026-05-23T22:31:00.000Z",
    includeAllBridgeCandidates: true,
    bridgeCandidates: [
      {
        id: "story-blocked",
        title: "Forza Horizon 6 Reviews Are In",
        render_manifest_path: path.join(artifactDir, "render_manifest.json"),
        audio_path: "output/audio/story-blocked.mp3",
        timestamps_path: "output/audio/story-blocked_timestamps.json",
        visual_v4_bridge_video_clips: [{ path: path.join(artifactDir, "clip-1.mp4") }],
      },
    ],
  });

  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(workOrder.summary.blocked_on_rerender_inputs_count, 1);
  assert.equal(workOrder.jobs[0].status, "blocked_on_rerender_inputs");
  assert.ok(workOrder.jobs[0].blockers.includes("word_timestamps_path_missing"));
  assert.ok(workOrder.jobs[0].blockers.includes("materialised_motion_clip_paths_insufficient"));
  assert.equal(workOrder.jobs[0].actions[0].action_id, "repair_sfx_rerender_inputs");
});

test("SFX rerender work order writes JSON and markdown artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-workorder-write-"));
  const outDir = path.join(root, "out");
  const written = await writeGoalSfxRerenderWorkOrder(
    {
      schema_version: 1,
      generated_at: "2026-05-23T22:32:00.000Z",
      mode: "LOCAL_SFX_RERENDER_WORK_ORDER",
      summary: { story_count: 0 },
      jobs: [],
      safety: { no_publish_triggered: true },
    },
    { outputDir: outDir },
  );

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
});
