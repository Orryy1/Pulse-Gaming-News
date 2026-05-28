"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildNormalDurationRepairWorkOrder,
  renderNormalDurationRepairWorkOrderMarkdown,
  writeNormalDurationRepairWorkOrder,
} = require("../../lib/goal-normal-duration-repair-workorder");
const packageJson = require("../../package.json");

async function makeArtifact(root, storyId = "short-story", duration = 24.333) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Boltgun 2 Leaves The Corridors",
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    rendered_duration_s: duration,
  });
  return artifactDir;
}

test("normal duration repair work order routes dry-run duration floor blockers to the scheduler-safe duration window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-workorder-"));
  const artifactDir = await makeArtifact(root);
  const longArtifactDir = await makeArtifact(root, "long-story", 69.767);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-22T10:00:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-22T09:55:00.000Z",
      blocked_stories: [
        {
          story_id: "short-story",
          artifact_dir: artifactDir,
          blockers: [
            "normal_production_duration_below_quality_floor:24",
            "preflight_candidate_not_publish_ready:review",
          ],
        },
        {
          story_id: "long-story",
          artifact_dir: longArtifactDir,
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:content:audio_duration_too_long (69.77s, max 59.00s)",
            "preflight_qa_blocked:video:duration_too_long (69.77s)",
          ],
        },
        {
          story_id: "rights-story",
          artifact_dir: artifactDir,
          blockers: ["missing_rights_record"],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.blocked_story_count, 3);
  assert.equal(workOrder.summary.repair_required_count, 2);
  assert.equal(workOrder.summary.skipped_count, 1);
  assert.equal(workOrder.jobs[0].story_id, "short-story");
  assert.equal(workOrder.jobs[0].title, "Boltgun 2 Leaves The Corridors");
  assert.equal(workOrder.jobs[0].status, "needs_duration_variant_rerender");
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_floor");
  assert.equal(workOrder.jobs[0].current_duration_s, 24.333);
  assert.deepEqual(workOrder.jobs[0].target_duration_seconds, { min: 35, max: 59 });
  assert.equal(workOrder.jobs[0].minimum_extension_seconds, 10.667);
  assert.equal(workOrder.jobs[1].story_id, "long-story");
  assert.equal(workOrder.jobs[1].repair_lane, "normal_production_duration_ceiling");
  assert.deepEqual(workOrder.jobs[1].target_duration_seconds, { min: 35, max: 59 });
  assert.equal(workOrder.jobs[1].duration_reduction_required_seconds, 10.767);
  assert.equal(workOrder.safety.no_publish_triggered, true);
  assert.equal(workOrder.safety.no_gate_weakened, true);
});

test("normal duration repair work order writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-write-"));
  const workOrder = {
    generated_at: "2026-05-22T10:05:00.000Z",
    target_duration_seconds: { min: 35, max: 59 },
    summary: { repair_required_count: 0, skipped_count: 0 },
    jobs: [],
  };

  const written = await writeNormalDurationRepairWorkOrder(workOrder, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  assert.match(renderNormalDurationRepairWorkOrderMarkdown(workOrder), /Normal Production Duration Repair/);
});

test("normal duration repair work order CLI is wired into package scripts", () => {
  assert.equal(
    packageJson.scripts["ops:goal-normal-duration-repair-workorder"],
    "node tools/goal-normal-duration-repair-workorder.js",
  );
});

test("normal duration repair work order routes post-compaction topic and outro blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-content-"));
  const artifactDir = await makeArtifact(root, "content-story", 47.68);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-22T10:10:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-22T10:09:00.000Z",
      blocked_stories: [
        {
          story_id: "content-story",
          artifact_dir: artifactDir,
          blockers: [
            "preflight_candidate_not_publish_ready:review",
            "preflight_qa_blocked:content:pulse_gaming_no_gaming_topic_signal",
            "preflight_qa_blocked:content:approved_voice:spoken_outro_missing",
          ],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_content_signal_repair");
  assert.deepEqual(workOrder.jobs[0].target_duration_seconds, { min: 35, max: 59 });
});

test("normal duration repair work order routes scheduler-missing overlong renders by manifest duration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-missing-candidate-"));
  const artifactDir = await makeArtifact(root, "excluded-overlong-story", 115.2);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-22T10:15:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-22T10:14:00.000Z",
      blocked_stories: [
        {
          story_id: "excluded-overlong-story",
          artifact_dir: artifactDir,
          blockers: ["preflight_candidate_missing"],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.summary.skipped_count, 0);
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_ceiling");
  assert.equal(workOrder.jobs[0].current_duration_s, 115.2);
  assert.equal(workOrder.jobs[0].duration_reduction_required_seconds, 56.2);
});

test("normal duration repair work order routes held duration-floor stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-held-"));
  const artifactDir = await makeArtifact(root, "held-short-story", 20.48);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-26T19:00:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-26T18:55:00.000Z",
      blocked_stories: [],
      held_stories: [
        {
          story_id: "held-short-story",
          artifact_dir: artifactDir,
          status: "quarantined_before_scheduler_preflight",
          hold_reasons: ["preflight_candidate_missing"],
          blockers: ["normal_production_duration_below_quality_floor:20"],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.blocked_story_count, 0);
  assert.equal(workOrder.summary.held_story_count, 1);
  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.summary.skipped_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "held-short-story");
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_floor");
  assert.equal(workOrder.jobs[0].current_duration_s, 20.48);
  assert.deepEqual(workOrder.jobs[0].source_hold_reasons, ["preflight_candidate_missing"]);
});

test("normal duration repair work order routes cutover duration-floor queue entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-cutover-"));
  const artifactDir = await makeArtifact(root, "cutover-short-story", 25.6);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-27T01:10:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-27T01:00:00.000Z",
      blocked_stories: [],
      held_stories: [],
    },
    cutoverPlan: {
      generated_at: "2026-05-27T01:05:00.000Z",
      queue: [
        {
          story_id: "cutover-short-story",
          artifact_dir: artifactDir,
          blockers: ["normal_production_duration_below_quality_floor:26"],
          render_input_blockers: [],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.cutover_queue_story_count, 1);
  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.summary.skipped_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "cutover-short-story");
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_floor");
  assert.equal(workOrder.jobs[0].current_duration_s, 25.6);
  assert.equal(workOrder.source_cutover_generated_at, "2026-05-27T01:05:00.000Z");
});

test("normal duration repair work order prefers fresh cutover rerender jobs over stale held blockers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-cutover-rerender-"));
  const artifactDir = await makeArtifact(root, "fresh-cutover-short", 15.04);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-28T11:30:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-28T10:55:00.000Z",
      blocked_stories: [],
      held_stories: [
        {
          story_id: "fresh-cutover-short",
          artifact_dir: artifactDir,
          blockers: [
            "visual_v4_motion_pack_blocked:v4_motion_blocked",
            "public_copy_newer_than_render",
          ],
        },
      ],
    },
    cutoverPlan: {
      generated_at: "2026-05-28T11:22:56.655Z",
      normal_duration_rerender_work_order: {
        jobs: [
          {
            story_id: "fresh-cutover-short",
            artifact_dir: artifactDir,
            status: "needs_duration_variant_rerender",
            current_duration_s: 15.04,
            source_blockers: ["normal_production_duration_below_quality_floor:15"],
          },
        ],
      },
    },
  });

  assert.equal(workOrder.summary.cutover_duration_job_count, 1);
  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.summary.skipped_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "fresh-cutover-short");
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_floor");
  assert.equal(workOrder.jobs[0].current_duration_s, 15.04);
  assert.deepEqual(workOrder.jobs[0].source_blockers, ["normal_production_duration_below_quality_floor:15"]);
});

test("normal duration repair work order routes held duration-floor stories with co-blockers without clearing them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-normal-duration-held-incident-"));
  const artifactDir = await makeArtifact(root, "held-motion-incident", 19.2);

  const workOrder = await buildNormalDurationRepairWorkOrder({
    generatedAt: "2026-05-26T19:05:00.000Z",
    dryRunPlan: {
      generated_at: "2026-05-26T19:00:00.000Z",
      held_stories: [
        {
          story_id: "held-motion-incident",
          artifact_dir: artifactDir,
          hold_reasons: ["preflight_candidate_missing"],
          blockers: [
            "normal_production_duration_below_quality_floor:19",
            "visual_evidence:direct_video_motion_missing",
            "incident:benchmark_qa_failed",
          ],
        },
      ],
    },
  });

  assert.equal(workOrder.summary.repair_required_count, 1);
  assert.equal(workOrder.summary.skipped_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "held-motion-incident");
  assert.equal(workOrder.jobs[0].repair_lane, "normal_production_duration_floor");
  assert.equal(workOrder.jobs[0].has_non_duration_blockers, true);
  assert.deepEqual(workOrder.jobs[0].co_blockers, [
    "visual_evidence:direct_video_motion_missing",
    "incident:benchmark_qa_failed",
  ]);
  assert.equal(
    workOrder.jobs[0].publish_gate,
    "do_not_publish_until_normal_duration_rerender_strict_dry_run_and_remaining_non_duration_blockers_clear",
  );
});
