"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-render-input-workorder");

test("goal render input work-order CLI parses dry local arguments", () => {
  const args = parseArgs([
    "--cutover-plan",
    "cutover.json",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-22T04:15:00.000Z",
    "--real-motion-materialization",
    "real-motion.json",
    "--dry-run-plan",
    "dry-run.json",
    "--story-id",
    "story-cli",
    "--dry-run",
    "--json",
  ]);

  assert.equal(args.cutoverPlanPath, "cutover.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "2026-05-22T04:15:00.000Z");
  assert.equal(args.realMotionMaterializationPath, "real-motion.json");
  assert.equal(args.dryRunPlanPath, "dry-run.json");
  assert.deepEqual(args.storyIds, ["story-cli"]);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});

test("goal render input work-order CLI writes reports without side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-workorder-cli-"));
  const cutoverPath = path.join(root, "cutover.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(cutoverPath, {
    generated_at: "2026-05-22T04:20:00.000Z",
    queue: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        render_input_status: "blocked",
        render_input_blockers: ["final_narration_audio_missing", "word_timestamps_missing"],
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--cutover-plan",
      cutoverPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-22T04:21:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "render_input_work_order.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "render_input_work_order.md")), true);
  assert.equal(result.workOrder.safety.no_publish_triggered, true);
});

test("goal render input work-order CLI auto-discovers repair evidence reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-workorder-evidence-"));
  const cutoverPath = path.join(root, "cutover.json");
  const outDir = path.join(root, "out");
  const evidenceDir = path.join(root, "goal-contract");
  const segmentDir = path.join(root, "segment-reports");
  const realMotionPath = path.join(root, "real-motion.json");
  await fs.outputJson(cutoverPath, {
    generated_at: "2026-05-26T07:30:00.000Z",
    queue: [
      {
        story_id: "story-direct-evidence",
        title: "Star Wars Zero Company Is More Than XCOM",
        render_input_status: "blocked",
        render_input_blockers: ["visual_evidence:direct_video_motion_missing"],
      },
    ],
  });
  await fs.outputJson(path.join(evidenceDir, "source_family_acquisition_story-direct-evidence.json"), {
    rows: [
      {
        story_id: "story-direct-evidence",
        source_family_candidates: [{ source_family: "steam_star_wars_zero_company_announce_trailer" }],
      },
    ],
  });
  await fs.outputFile(
    path.join(evidenceDir, "studio_v4_source_family_acquisition_current.stdout.json"),
    "not a json report",
  );
  await fs.outputJson(path.join(segmentDir, "official_trailer_segment_validation_story_story-direct-evidence_apply_local.json"), {
    segments: Array.from({ length: 6 }, (_, index) => ({
      story_id: "story-direct-evidence",
      source_family: "steam_star_wars_zero_company_announce_trailer",
      status: "rejected",
      segment_validated: false,
      validation_reason: index % 2 ? "segment_lacks_gameplay_action_samples" : "segment_contains_low_detail_frame",
    })),
  });
  await fs.outputJson(realMotionPath, {
    jobs: [
      {
        story_id: "story-direct-evidence",
        status: "blocked",
        blockers: ["direct_video_motion_clip_missing"],
        candidate_count: 5,
        materialized_count: 5,
        direct_video_motion_clip_count: 0,
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--cutover-plan",
      cutoverPath,
      "--out-dir",
      outDir,
      "--source-family-evidence-dir",
      evidenceDir,
      "--segment-validation-dir",
      segmentDir,
      "--real-motion-materialization",
      realMotionPath,
      "--generated-at",
      "2026-05-26T07:31:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  const action = result.workOrder.jobs[0].actions[0];
  assert.equal(action.repair_lane, "alternate_official_source_required_after_segment_validation_exhausted");
  assert.equal(action.auto_repairable, false);
  assert.equal(action.dead_end_blocker, true);
  assert.equal(result.workOrder.summary.dead_end_blocker_jobs, 1);
});

test("goal render input work-order CLI includes strict dry-run blocked candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-dry-run-"));
  const cutoverPath = path.join(root, "cutover.json");
  const dryRunPath = path.join(root, "dry-run.json");
  const sourceFamilyPath = path.join(root, "source-family.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(cutoverPath, {
    generated_at: "2026-05-26T13:40:00.000Z",
    queue: [],
  });
  await fs.outputJson(dryRunPath, {
    generated_at: "2026-05-26T13:43:00.000Z",
    blocked_stories: [
      {
        story_id: "xbox-feedback",
        artifact_dir: "C:/repo/output/goal-proof/batch/xbox-feedback",
        blockers: [
          "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
        ],
        incident_guard: {
          evidence: {
            title: "Xbox Fans Used Feedback To Demand Exclusives",
            canonical_subject: "Xbox",
          },
        },
      },
    ],
  });
  await fs.outputJson(sourceFamilyPath, {
    rows: [
      {
        story_id: "xbox-feedback",
        source_search_blockers: ["broad_platform_story_requires_specific_visual_plan"],
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--cutover-plan",
      cutoverPath,
      "--dry-run-plan",
      dryRunPath,
      "--source-family-acquisition",
      sourceFamilyPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-26T13:44:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.workOrder.summary.story_count, 1);
  assert.equal(result.workOrder.summary.owned_motion_materialisation_jobs, 1);
  assert.equal(result.workOrder.repair_backlog.items[0].story_id, "xbox-feedback");
  assert.equal(result.workOrder.repair_backlog.items[0].repair_lane, "owned_generated_explainer_motion_materialisation");
});

test("goal render input work-order CLI scopes report output by story id", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-render-input-story-filter-"));
  const cutoverPath = path.join(root, "cutover.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(cutoverPath, {
    generated_at: "2026-06-01T09:00:00.000Z",
    queue: [
      {
        story_id: "story-keep",
        title: "Hades 2 Patch Changes Boons",
        render_input_status: "blocked",
        render_input_blockers: ["final_narration_audio_missing", "word_timestamps_missing"],
      },
      {
        story_id: "story-skip",
        title: "Valorant Vanguard Update Hits PCs",
        render_input_status: "blocked",
        render_input_blockers: ["materialised_motion_clips_missing"],
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--cutover-plan",
      cutoverPath,
      "--story-id",
      "story-keep",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-06-01T09:05:00.000Z",
      "--dry-run",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.workOrder.summary.story_count, 1);
  assert.equal(result.workOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(result.workOrder.summary.owned_motion_materialisation_jobs, 0);
  assert.deepEqual(result.workOrder.jobs.map((job) => job.story_id), ["story-keep"]);
  assert.deepEqual(result.workOrder.repair_backlog.items.map((item) => item.story_id), ["story-keep"]);
  assert.equal(result.workOrder.dry_run, true);
  assert.equal(result.workOrder.safety.no_publish_triggered, true);
});
