"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildBaselineAuditReport,
  buildBlockerTaxonomy,
  buildCutoverReadinessMatrix,
  buildImmediateRepairOrder,
  writeBaselineAuditArtifacts,
} = require("../../lib/goal-baseline-audit");

function fixtureInputs() {
  return {
    generatedAt: "2026-05-24T09:25:39.279Z",
    storyPackages: [
      {
        story_id: "story-a",
        verdict: "RED",
        blockers: [
          "incident:missing_narration_audio",
          "incident:missing_word_timestamps",
          "incident:missing_materialised_motion_clips",
          "incident:missing_distinct_motion_families",
          "incident:missing_rights_record",
          "incident:missing_final_mp4",
        ],
        artifact_dir: "output/goal-proof/batch/story-a",
      },
      {
        story_id: "story-b",
        verdict: "AMBER",
        blockers: ["platform:instagram_url_processing_failure"],
        artifact_dir: "output/goal-proof/batch/story-b",
      },
    ],
    dryRunPlan: {
      summary: {
        story_count: 2,
        ready_story_count: 0,
        blocked_story_count: 2,
        skipped_story_count: 0,
        planned_action_count: 0,
        incident_guard_failed_story_count: 2,
        preflight_checked_story_count: 1,
      },
      blocked_stories: [
        {
          story_id: "story-a",
          blockers: [
            "incident:missing_narration_audio",
            "incident:missing_word_timestamps",
            "incident:missing_materialised_motion_clips",
            "incident:missing_distinct_motion_families",
            "incident:missing_rights_record",
            "incident:missing_final_mp4",
          ],
        },
        {
          story_id: "story-b",
          blockers: ["platform:instagram_url_processing_failure"],
        },
      ],
      incident_guard_report: {
        stories: [
          {
            story_id: "story-a",
            verdict: "fail",
            file_evidence: {
              mp4_ready: false,
              narration_ready: false,
              word_timestamps_ready: false,
              captions_ready: false,
              materialised_motion_ready: false,
              distinct_motion_families_ready: false,
              rights_ledger_ready: false,
            },
          },
          {
            story_id: "story-b",
            verdict: "fail",
            file_evidence: {
              mp4_ready: true,
              narration_ready: true,
              word_timestamps_ready: true,
              captions_ready: true,
              materialised_motion_ready: true,
              distinct_motion_families_ready: true,
              rights_ledger_ready: true,
            },
          },
        ],
      },
    },
    renderInputWorkOrder: {
      summary: {
        story_count: 2,
        ready_for_final_render_job_count: 0,
        blocked_on_render_inputs_count: 2,
        auto_repairable_jobs: 1,
        operator_required_jobs: 0,
        dead_end_blocker_jobs: 1,
      },
      work_orders: [
        {
          story_id: "story-a",
          blocker_type: "missing_final_narration_audio",
          repair_lane: "audio_timestamps",
          recommended_command: "npm run ops:goal-audio-timestamps",
        },
        {
          story_id: "story-a",
          blocker_type: "missing_materialised_motion_clips",
          repair_lane: "owned_motion_materialiser",
          recommended_command: "npm run ops:goal-owned-motion",
        },
      ],
    },
    schedulerBridgeCandidates: [
      {
        story_id: "story-a",
        control_tower_verdict: "RED",
        final_render_path: "output/final/story-a.mp4",
      },
      {
        story_id: "story-b",
        control_tower_verdict: "AMBER",
        final_render_path: "output/final/story-b.mp4",
      },
    ],
    renderHealthReport: {
      stamped: 3,
      unstamped: 5,
      total_in_window: 8,
      thin_count: 2,
      lane: { legacy_multi_image: 3 },
    },
    platformStatusMatrix: {
      summary: {
        platform_count: 4,
        disabled_platform_count: 2,
        blocked_action_count: 1,
        publish_now_action_count: 0,
      },
      platforms: {
        youtube_shorts: { state: "ready_now" },
        tiktok: { state: "disabled" },
        x: { state: "disabled" },
        instagram_reels: {
          state: "blocked",
          failures: ["URL processing failure"],
        },
      },
    },
    publishVerdict: {
      verdict: "RED",
      safe_to_publish_boolean: false,
      planned_action_count: 0,
    },
    analyticsReport: {
      status: "failed",
      failures: ["local_llm_timeout"],
      fallback_used: true,
    },
    localLlmReport: {
      status: "failed",
      failures: ["ollama_unavailable"],
    },
  };
}

test("buildBaselineAuditReport separates live DB, bridge, dry-run, platform and publish-control truth", () => {
  const report = buildBaselineAuditReport(fixtureInputs());

  assert.equal(report.report_type, "current_state_baseline_audit");
  assert.equal(report.readiness_verdict, "RED");
  assert.deepEqual(report.truth_surfaces, [
    "live_db_truth",
    "bridge_artefact_truth",
    "dry_run_package_truth",
    "platform_upload_truth",
    "publish_control_truth",
  ]);

  assert.equal(report.live_db_truth.stamped_render_count, 3);
  assert.equal(report.live_db_truth.unstamped_legacy_row_count, 5);
  assert.equal(report.live_db_truth.thin_legacy_render_count, 2);

  assert.equal(report.production_render_truth.package_count, 2);
  assert.equal(report.production_render_truth.red_count, 1);
  assert.equal(report.production_render_truth.amber_count, 1);
  assert.equal(report.production_render_truth.dry_run_ready_story_count, 0);
  assert.equal(report.production_render_truth.dry_run_blocked_story_count, 2);
  assert.equal(report.production_render_truth.scheduler_bridge_candidate_count, 2);
  assert.equal(report.production_render_truth.scheduler_bridge_final_render_evidence_count, 2);

  assert.equal(report.bridge_artefact_truth.candidate_count, 2);
  assert.equal(report.bridge_artefact_truth.red_count, 1);
  assert.equal(report.bridge_artefact_truth.amber_count, 1);
  assert.equal(report.bridge_artefact_truth.green_count, 0);

  assert.equal(report.dry_run_package_truth.story_count, 2);
  assert.equal(report.dry_run_package_truth.ready_story_count, 0);
  assert.equal(report.dry_run_package_truth.missing_final_mp4_count, 1);
  assert.equal(report.dry_run_package_truth.missing_narration_audio_count, 1);
  assert.equal(report.dry_run_package_truth.missing_word_timestamps_count, 1);
  assert.equal(report.dry_run_package_truth.missing_materialised_motion_clips_count, 1);
  assert.equal(report.dry_run_package_truth.missing_distinct_motion_families_count, 1);
  assert.equal(report.dry_run_package_truth.incomplete_rights_record_count, 1);

  assert.equal(report.platform_upload_truth.disabled_platform_count, 2);
  assert.equal(report.platform_upload_truth.platforms.tiktok.state, "disabled");
  assert.equal(report.platform_upload_truth.platforms.x.state, "disabled");
  assert.equal(report.platform_upload_truth.instagram_meta_failure_count, 1);

  assert.equal(report.publish_control_truth.verdict, "RED");
  assert.equal(report.publish_control_truth.safe_to_publish_boolean, false);
  assert.equal(report.analytics_loop_truth.status, "failed");
  assert.equal(report.local_llm_truth.status, "failed");
  assert.equal(report.repair_backlog.auto_repairable_blocker_count, 1);
  assert.equal(report.repair_backlog.dead_end_blocker_count, 1);
});

test("derived audit artefacts prioritise render-input repairs and preserve hard cutover blockers", () => {
  const report = buildBaselineAuditReport(fixtureInputs());
  const taxonomy = buildBlockerTaxonomy(report);
  const repairOrder = buildImmediateRepairOrder(report);
  const matrix = buildCutoverReadinessMatrix(report);

  assert.equal(taxonomy.categories.render_inputs.count >= 1, true);
  assert.equal(taxonomy.categories.platform_upload.count >= 1, true);
  assert.equal(repairOrder[0].blocker_type, "missing_final_narration_audio");
  assert.equal(repairOrder[0].recommended_command, "npm run ops:goal-audio-timestamps");
  assert.equal(matrix.live_db_truth.status, "AMBER");
  assert.equal(matrix.bridge_artefact_truth.status, "RED");
  assert.equal(matrix.dry_run_package_truth.status, "RED");
  assert.equal(matrix.platform_upload_truth.status, "RED");
  assert.equal(matrix.publish_control_truth.status, "RED");
});

test("writeBaselineAuditArtifacts emits the required Goal 02 JSON and Markdown artefacts", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-baseline-audit-"));
  const outDir = path.join(tmp, "goal-02");
  const report = buildBaselineAuditReport(fixtureInputs());

  const result = await writeBaselineAuditArtifacts(report, { outDir });

  assert.deepEqual(Object.keys(result.files).sort(), [
    "baseline_audit_report_json",
    "baseline_audit_report_md",
    "blocker_taxonomy_json",
    "cutover_readiness_matrix_json",
    "immediate_repair_order_json",
  ]);

  const auditJson = await fs.readJson(path.join(outDir, "baseline_audit_report.json"));
  const auditMd = await fs.readFile(path.join(outDir, "baseline_audit_report.md"), "utf8");
  const taxonomy = await fs.readJson(path.join(outDir, "blocker_taxonomy.json"));
  const repairOrder = await fs.readJson(path.join(outDir, "immediate_repair_order.json"));
  const matrix = await fs.readJson(path.join(outDir, "cutover_readiness_matrix.json"));

  assert.equal(auditJson.report_type, "current_state_baseline_audit");
  assert.match(auditMd, /Live DB truth/);
  assert.match(auditMd, /Bridge artefact truth/);
  assert.equal(taxonomy.categories.render_inputs.count >= 1, true);
  assert.equal(repairOrder[0].blocker_type, "missing_final_narration_audio");
  assert.equal(matrix.publish_control_truth.status, "RED");
});
