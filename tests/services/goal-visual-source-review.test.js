"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildVisualSourceReviewReport,
  writeVisualSourceReviewReport,
  REJECT_DECISION,
  DEFER_DECISION,
} = require("../../lib/goal-visual-source-review");
const {
  parseArgs,
  main: runVisualSourceReviewCli,
} = require("../../tools/goal-visual-source-review");

test("visual source review writes defer and reject artefacts from render-input jobs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-visual-source-review-"));
  const deferDir = path.join(root, "defer");
  const rejectDir = path.join(root, "reject");
  const workOrder = {
    jobs: [
      {
        story_id: "needs-media",
        artifact_dir: deferDir,
        blockers: ["visual_evidence:generated_only_motion_deck", "visual_evidence:no_real_visual_media_asset"],
        actions: [
          {
            action_id: "materialise_validated_real_motion_clips",
            repair_lane: "official_direct_media_search_after_generated_only_benchmark_failure",
            operator_approval_required: true,
          },
        ],
      },
      {
        story_id: "dead-end-image",
        artifact_dir: rejectDir,
        blockers: ["public_copy_repair_required", "source_label_consistency_repair_required"],
        actions: [
          {
            action_id: "repair_public_output_coherence",
            repair_lane: "reject_or_human_review_non_news_image_post",
            dead_end_blocker: true,
          },
        ],
      },
    ],
  };

  const { report } = await writeVisualSourceReviewReport({
    workOrder,
    outputDir: root,
    generatedAt: "2026-05-28T23:55:00.000Z",
  });

  assert.equal(report.summary.visual_source_review_count, 2);
  assert.equal(report.summary.defer_count, 1);
  assert.equal(report.summary.reject_count, 1);
  assert.equal((await fs.readJson(path.join(deferDir, "visual_source_review.json"))).decision, DEFER_DECISION);
  assert.equal((await fs.readJson(path.join(rejectDir, "visual_source_review.json"))).decision, REJECT_DECISION);
  assert.equal(await fs.pathExists(path.join(root, "visual_source_review_report.json")), true);
});

test("visual source review CLI reads a render-input work order and emits a report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-visual-source-review-cli-"));
  const artifactDir = path.join(root, "story");
  const workOrderPath = path.join(root, "render_input_work_order.json");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "needs-media",
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:generated_only_motion_deck"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      },
    ],
  });

  const args = parseArgs(["--work-order", workOrderPath, "--out-dir", root, "--json"]);
  assert.equal(args.workOrder, workOrderPath);
  assert.equal(args.outDir, root);
  assert.equal(args.json, true);

  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk, encoding, callback) => {
    output += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  let result;
  try {
    result = await runVisualSourceReviewCli(["--work-order", workOrderPath, "--out-dir", root, "--json"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(result.report.summary.visual_source_review_count, 1);
  assert.match(output, /VISUAL_SOURCE_REVIEW/);
  assert.equal(await fs.pathExists(path.join(artifactDir, "visual_source_review.json")), true);
});

test("visual source review report can be built without writing files", () => {
  const report = buildVisualSourceReviewReport({
    workOrder: {
      jobs: [
        {
          story_id: "needs-media",
          artifact_dir: "C:\\tmp\\needs-media",
          blockers: ["visual_evidence:no_real_visual_media_asset"],
          actions: [],
        },
      ],
    },
    generatedAt: "2026-05-28T23:58:00.000Z",
  });

  assert.equal(report.summary.visual_source_review_count, 1);
  assert.equal(report.reviews[0].review.decision, DEFER_DECISION);
});

test("visual source review ignores ready final-render jobs", () => {
  const report = buildVisualSourceReviewReport({
    workOrder: {
      jobs: [
        {
          story_id: "ready-render",
          artifact_dir: "C:\\tmp\\ready-render",
          status: "ready_for_final_render_job",
          blockers: [],
          actions: [
            {
              action_id: "run_visual_v4_production_render",
              repair_lane: "final_visual_v4_render_materialisation",
            },
          ],
        },
      ],
    },
    generatedAt: "2026-05-29T02:48:00.000Z",
  });

  assert.equal(report.summary.visual_source_review_count, 0);
  assert.equal(report.reviews.length, 0);
});
