"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildStaleTemporalReviewReport,
  writeStaleTemporalReviewReport,
} = require("../../lib/goal-stale-temporal-review");
const {
  parseArgs,
  main: runStaleTemporalReviewCli,
} = require("../../tools/goal-stale-temporal-review");

test("stale temporal review writes reject artefacts for stale current-news holds only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stale-temporal-review-"));
  const staleDir = path.join(root, "stale");
  const sourceDir = path.join(root, "source");
  const dryRunPlan = {
    held_stories: [
      {
        story_id: "stale-story",
        artifact_dir: staleDir,
        blockers: [
          "incident:stale_temporal_claim",
          "incident:current_wording_on_old_event",
        ],
      },
      {
        story_id: "source-story",
        artifact_dir: sourceDir,
        blockers: ["visual_v4_motion_pack:actual_motion_clip_minimum_not_met"],
      },
    ],
  };

  const { report } = await writeStaleTemporalReviewReport({
    dryRunPlan,
    outputDir: root,
    generatedAt: "2026-05-28T23:40:00.000Z",
  });

  assert.equal(report.summary.held_story_count, 2);
  assert.equal(report.summary.stale_temporal_review_count, 1);
  assert.equal(report.reviews[0].story_id, "stale-story");
  const review = await fs.readJson(path.join(staleDir, "stale_temporal_review.json"));
  assert.equal(review.decision, "reject_stale_current_news_candidate");
  assert.equal(review.safety.no_publish_triggered, true);
  assert.equal(await fs.pathExists(path.join(sourceDir, "stale_temporal_review.json")), false);
  assert.equal(await fs.pathExists(path.join(root, "stale_temporal_review_report.json")), true);
});

test("stale temporal review CLI reads a dry-run plan and emits a report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-stale-temporal-review-cli-"));
  const artifactDir = path.join(root, "story");
  const planPath = path.join(root, "dry_run_publish_plan.json");
  await fs.outputJson(planPath, {
    held_stories: [
      {
        story_id: "stale-story",
        artifact_dir: artifactDir,
        blockers: ["preflight_qa_blocked:incident_guard:incident:stale_temporal_claim"],
      },
    ],
  });

  const args = parseArgs(["--dry-run-plan", planPath, "--out-dir", root, "--json"]);
  assert.equal(args.dryRunPlan, planPath);
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
    result = await runStaleTemporalReviewCli(["--dry-run-plan", planPath, "--out-dir", root, "--json"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(result.report.summary.stale_temporal_review_count, 1);
  assert.match(output, /STALE_TEMPORAL_REVIEW/);
  assert.equal(await fs.pathExists(path.join(artifactDir, "stale_temporal_review.json")), true);
});

test("stale temporal review report can be built without writing files", () => {
  const report = buildStaleTemporalReviewReport({
    dryRunPlan: {
      held_stories: [
        {
          story_id: "stale-story",
          artifact_dir: "C:\\tmp\\stale-story",
          blockers: ["incident:current_wording_on_old_event"],
        },
      ],
    },
    generatedAt: "2026-05-28T23:42:00.000Z",
  });

  assert.equal(report.summary.stale_temporal_review_count, 1);
  assert.equal(report.reviews[0].review.decision, "reject_stale_current_news_candidate");
});
