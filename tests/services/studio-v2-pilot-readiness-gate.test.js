"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildStudioV2PilotReadinessGate,
  renderStudioV2PilotReadinessMarkdown,
} = require("../../lib/ops/studio-v2-pilot-readiness-gate");

const ROOT = path.resolve(__dirname, "..", "..");

function blockedPromotionPacket(overrides = {}) {
  return {
    story_id: "story_blocked",
    title: "Blocked Studio V2 proof",
    verdict: "RED_BLOCKED",
    production_ready: false,
    morning_approval_needed: false,
    blockers: [
      "forensic_warnings_remaining",
      "visual_repeat_pairs_remaining",
      "voice_grade_unknown",
    ],
    warnings: ["thin_official_clip_reference_count"],
    evidence: {
      mp4: "test/output/studio-v2-still-deck/studio_v2_story_blocked_enriched.mp4",
      contact_sheet: "test/output/studio-v2-still-deck/story_blocked_contact_sheet.jpg",
      qa_json: "test/output/studio-v2-still-deck/story_blocked_qa.json",
      forensic_json: "test/output/studio-v2-still-deck/qa_forensic_story_blocked.json",
    },
    metrics: {
      runtime_s: 72.4,
      qa_lane: "unknown",
      voice_grade: "unknown",
      current_validated_clip_refs: 2,
      current_validated_clip_sources: 1,
      forensic_fail_count: 0,
      forensic_warn_count: 2,
      visual_repeat_pairs_after: 2,
    },
    safety: {
      local_only: true,
      production_renderer_switch_allowed: false,
      production_publish_allowed: false,
      railway_change_allowed: false,
      oauth_change_allowed: false,
      production_render_default_changed: false,
      posted_to_platforms: false,
    },
    ...overrides,
  };
}

function readyPromotionPacket(overrides = {}) {
  return blockedPromotionPacket({
    story_id: "story_ready",
    title: "Clean Studio V2 local proof",
    verdict: "AMBER_LOCAL_PROOF",
    production_ready: false,
    morning_approval_needed: true,
    blockers: [],
    warnings: ["thin_official_frame_count"],
    evidence: {
      mp4: "test/output/studio-v2-still-deck/studio_v2_story_ready_enriched.mp4",
      contact_sheet: "test/output/studio-v2-still-deck/story_ready_contact_sheet.jpg",
      qa_json: "test/output/studio-v2-still-deck/story_ready_qa.json",
      forensic_json: "test/output/studio-v2-still-deck/qa_forensic_story_ready.json",
      media_package: "test/output/studio-v2-still-deck/enriched_media_package.json",
    },
    metrics: {
      runtime_s: 66.2,
      qa_lane: "pass",
      voice_grade: "green",
      current_validated_clip_refs: 4,
      current_validated_clip_sources: 3,
      forensic_fail_count: 0,
      forensic_warn_count: 0,
      visual_repeat_pairs_after: 0,
    },
    ...overrides,
  });
}

function proofCandidate(overrides = {}) {
  return {
    story_id: "story_blocked",
    title: "Blocked Studio V2 proof",
    verdict: "needs_motion_or_exact_assets",
    blockers: [
      "approved_liam_audio_missing",
      "flash_proof_requires_three_validated_clip_sources",
    ],
    proof_readiness: {
      final_recommendation: "repair_media_first",
    },
    audio: {
      ready: false,
      status: "approved_local_liam_audio_missing",
    },
    visuals: {
      exact_subject_count: 5,
      validated_clip_ref_count: 2,
      validated_clip_source_count: 1,
    },
    ...overrides,
  };
}

function motionGap(overrides = {}) {
  return {
    story_id: "story_blocked",
    render_recommendation: "do_not_render_yet",
    blockers: ["flash_proof_requires_three_validated_clip_sources"],
    audio_gap: { ready: false, status: "approved_local_liam_audio_missing" },
    motion_gap: {
      missing_validated_clip_refs: 1,
      missing_validated_clip_sources: 2,
      missing_validated_entities: ["GTA"],
    },
    latest_render_proof: {
      status: "available",
      verdict: "warn",
      needs_human_visual_review: true,
    },
    priority_next_steps: [
      "find_one_more_validated_gameplay_clip_window",
      "generate_approved_sleepy_liam_audio_after_visuals_are_ready",
    ],
    ...overrides,
  };
}

function visualRepairRow(overrides = {}) {
  return {
    story_id: "story_blocked",
    title: "Blocked Studio V2 proof",
    primary_action_type: "validated_clip_windows_needed",
    repair_class: "motion_evidence_gap",
    render_recommendation: "do_not_render_yet",
    audio_ready: false,
    validated_motion_ready: false,
    commands: [
      {
        purpose: "validate_gameplay_windows",
        command:
          "npm run media:validate-trailer-segments -- --story-id story_blocked --apply-local --deep-scan",
        safety: "apply_local_under_test_output_only",
      },
    ],
    ...overrides,
  };
}

test("pilot readiness gate blocks production default and spells out current blockers", () => {
  const report = buildStudioV2PilotReadinessGate({
    promotionPacket: blockedPromotionPacket(),
    proofCandidateReport: { candidates: [proofCandidate()] },
    motionGapReport: { gaps: [motionGap()] },
    visualRepairReport: { rows: [visualRepairRow()] },
    now: "2026-05-16T10:00:00.000Z",
  });

  assert.equal(report.production_default.allowed, false);
  assert.equal(report.production_default.verdict, "RED_BLOCKED");
  assert.ok(report.production_default.blockers.includes("clean_one_story_promotion_packet_missing"));
  assert.ok(report.production_default.blockers.includes("manual_one_story_pilot_approval_missing"));
  assert.ok(report.production_default.blockers.includes("completed_one_story_pilot_metrics_missing"));
  assert.ok(report.production_default.blockers.includes("promotion:forensic_warnings_remaining"));
  assert.ok(report.production_default.blockers.includes("proof:approved_liam_audio_missing"));
  assert.ok(report.production_default.blockers.includes("motion:flash_proof_requires_three_validated_clip_sources"));
  assert.ok(report.production_default.blockers.includes("visual_repair:validated_clip_windows_needed"));
  assert.equal(report.one_story_pilot.status, "blocked");
  assert.ok(report.one_story_pilot.requirements.some((item) => item.status === "block" && /clean promotion packet/.test(item.detail)));
  assert.ok(report.one_story_pilot.requirements.some((item) => item.status === "block" && /validated motion/.test(item.detail)));
  assert.ok(report.one_story_pilot.next_actions.includes("repair_or_regenerate_studio_v2_promotion_packet"));

  const markdown = renderStudioV2PilotReadinessMarkdown(report);
  assert.match(markdown, /Production default: `RED_BLOCKED`/);
  assert.match(markdown, /promotion:forensic_warnings_remaining/);
  assert.match(markdown, /One-story pilot requires/);
  assert.match(markdown, /Do not switch production renderer/);
  assert.match(markdown, /No posting or deployment action is performed/);
});

test("pilot readiness gate allows only manual one-story review for a clean proof", () => {
  const report = buildStudioV2PilotReadinessGate({
    promotionPacket: readyPromotionPacket(),
    proofCandidateReport: {
      candidates: [
        proofCandidate({
          story_id: "story_ready",
          title: "Clean Studio V2 local proof",
          verdict: "ready_flash_proof",
          blockers: [],
          proof_readiness: { final_recommendation: "render_local_proof" },
          audio: { ready: true, status: "approved_local_liam_audio_ready" },
          visuals: {
            exact_subject_count: 8,
            validated_clip_ref_count: 4,
            validated_clip_source_count: 3,
          },
        }),
      ],
    },
    motionGapReport: {
      gaps: [
        motionGap({
          story_id: "story_ready",
          render_recommendation: "ready_for_local_flash_proof",
          blockers: [],
          audio_gap: { ready: true, status: "approved_local_liam_audio_ready" },
          motion_gap: {
            missing_validated_clip_refs: 0,
            missing_validated_clip_sources: 0,
            missing_validated_entities: [],
          },
          latest_render_proof: {
            status: "available",
            verdict: "pass",
            needs_human_visual_review: false,
          },
          priority_next_steps: ["ready_for_local_flash_render_preflight"],
        }),
      ],
    },
    visualRepairReport: { rows: [] },
    now: "2026-05-16T10:30:00.000Z",
  });

  assert.equal(report.production_default.allowed, false);
  assert.equal(report.production_default.verdict, "AMBER_PILOT_REVIEW_ONLY");
  assert.deepEqual(report.production_default.blockers, [
    "manual_one_story_pilot_approval_missing",
    "completed_one_story_pilot_metrics_missing",
    "multi_story_regression_window_missing",
    "production_default_change_not_allowed_by_this_gate",
  ]);
  assert.equal(report.one_story_pilot.status, "ready_for_manual_approval");
  assert.equal(report.one_story_pilot.story_id, "story_ready");
  assert.ok(report.one_story_pilot.requirements.every((item) => item.status === "pass" || item.status === "manual"));
  assert.ok(report.one_story_pilot.next_actions.includes("queue_manual_one_story_pilot_decision"));
  assert.equal(report.safety.report_only, true);
  assert.equal(report.safety.posts_to_platforms, false);

  const markdown = renderStudioV2PilotReadinessMarkdown(report);
  assert.match(markdown, /Production default: `AMBER_PILOT_REVIEW_ONLY`/);
  assert.match(markdown, /One-story pilot status: `ready_for_manual_approval`/);
  assert.match(markdown, /queue_manual_one_story_pilot_decision/);
  assert.doesNotMatch(markdown, /production default is allowed/i);
});

test("pilot readiness gate tool is read-only", () => {
  const tool = fs.readFileSync(path.join(ROOT, "tools", "studio-v2-pilot-readiness-gate.js"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  assert.equal(pkg.scripts["studio:v2:pilot-readiness"], "node tools/studio-v2-pilot-readiness-gate.js");
  assert.match(tool, /studio_v2_pilot_readiness_gate\.json/);
  assert.match(tool, /--test-output-only/);
  assert.match(tool, /--stdout-only/);
  assert.match(tool, /STUDIO_V2_PILOT_READINESS_GATE\.md/);
  assert.match(tool, /read-only/);
  assert.doesNotMatch(tool, /publishAll|uploadShort|postShort|autonomous\/publish/);
  assert.doesNotMatch(tool, /UPDATE\s+stories|INSERT\s+INTO\s+stories|DELETE\s+FROM/i);
});
