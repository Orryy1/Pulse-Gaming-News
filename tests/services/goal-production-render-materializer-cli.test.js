"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/goal-production-render-materializer");

test("goal production render materializer CLI parses final render arguments", () => {
  const args = parseArgs([
    "--work-order",
    "render_input_work_order.json",
    "--out-dir",
    "out",
    "--workspace",
    "workspace",
    "--generated-at",
    "2026-05-22T07:10:00.000Z",
    "--limit",
    "3",
    "--inspect-only",
    "--json",
  ]);

  assert.equal(args.workOrderPath, "render_input_work_order.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.workspaceRoot, "workspace");
  assert.equal(args.generatedAt, "2026-05-22T07:10:00.000Z");
  assert.equal(args.limit, 3);
  assert.equal(args.inspectOnly, true);
  assert.equal(args.json, true);
});

test("goal production render materializer CLI writes inspect-only reports without rendering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-production-render-cli-"));
  const artifactDir = path.join(root, "package");
  const workOrderPath = path.join(root, "render_input_work_order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        artifact_dir: artifactDir,
        status: "ready_for_final_render_job",
        evidence: {
          narration_audio_path: path.join(artifactDir, "audio.mp3"),
          word_timestamps_path: path.join(artifactDir, "timestamps.json"),
          materialised_motion_clip_paths: [path.join(artifactDir, "clip.mp4")],
        },
        actions: [
          {
            action_id: "run_visual_v4_production_render",
            target_render_manifest: {
              output_path: path.join(artifactDir, "visual_v4_render.mp4"),
              manifest_path: path.join(artifactDir, "render_manifest.json"),
            },
          },
        ],
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
      "2026-05-22T07:11:00.000Z",
      "--inspect-only",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.inspect_only_count, 1);
  assert.equal(result.report.safety.renderer_invoked, false);
  assert.equal(
    await fs.pathExists(path.join(root, "out", "production_render_materialization_report.json")),
    true,
  );
});
