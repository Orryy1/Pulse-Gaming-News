"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOvernightFreshGreenBufferReports,
  formatOvernightFreshGreenBufferMarkdown,
} = require("../../lib/ops/overnight-fresh-green-buffer-report");

test("overnight buffer reports pass only with five preflight-green stories and clean enabled actions", () => {
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    id: `fresh_${index + 1}`,
    title: `Fresh story ${index + 1}`,
    status: "publish_ready",
    source: { exported_path: `C:/proof/fresh_${index + 1}/visual_v4_render.mp4` },
    preflight_qa: {
      status: "pass",
      blockers: [],
      warnings: [],
      checks: {
        source_age: {
          result: "pass",
          evidence: { age_hours: 24 + index, policy_hours: 168 },
        },
      },
    },
  }));
  const packageEvidence = candidates.map((candidate) => ({
    story_id: candidate.id,
    coherence_verdict: "pass",
    transcript_blockers: [],
    visual_verdict: "pass",
    visual_blockers: [],
    tts_caption_verdict: "pass",
    tts_caption_blockers: [],
    asr_inserted_words: 0,
    asr_trailing_words: 0,
  }));

  const reports = buildOvernightFreshGreenBufferReports({
    generatedAt: "2026-07-14T02:00:00.000Z",
    candidateReport: {
      totals: { stories_seen: 5, candidates: 5, returned: 5 },
      candidates,
      excluded: [],
      preflight_qa: { enabled: true, checked: 5, pass: 5, blocked: 0, warning: 0 },
    },
    dryRunPlan: {
      overall_verdict: "AMBER",
      summary: {
        ready_story_count: 5,
        blocked_story_count: 0,
        held_story_count: 0,
        platform_enabled_dry_run_action_count: 15,
        platform_deferred_action_count: 20,
        blocked_action_count: 0,
      },
      blocked_stories: [],
    },
    cutoverPlan: { summary: { ready_final_render_count: 5, blocked_count: 0 } },
    renderHealth: { bridge: { candidate_count: 5, stamped: 5, thin_count: 0 } },
    platformStatus: { overall_verdict: "AMBER" },
    platformDoctor: { verdict: "AMBER" },
    runtimeSentinel: { verdict: "green", blockers: [] },
    queueInspect: { verdict: "review", blockers: [] },
    packageEvidence,
  });

  assert.equal(reports.summary.verdict, "PASS");
  assert.equal(reports.summary.green_candidate_count, 5);
  assert.equal(reports.summary.enabled_action_count, 15);
  assert.equal(reports.blockedCandidateReport.summary.blocked_count, 0);
  assert.equal(reports.staleSourceRejectionReport.summary.stale_rejection_count, 0);
  assert.equal(reports.transcriptCoherenceReport.summary.pass_count, 5);
  assert.equal(reports.visualMotionRepairReport.summary.pass_count, 5);
  assert.equal(reports.ttsCaptionRepairReport.summary.pass_count, 5);
  assert.match(formatOvernightFreshGreenBufferMarkdown(reports), /Verdict: PASS/);
});

test("overnight buffer reports return PARTIAL when fewer than five stories pass", () => {
  const reports = buildOvernightFreshGreenBufferReports({
    candidateReport: {
      candidates: [{ id: "fresh_1", status: "publish_ready", preflight_qa: { status: "pass", blockers: [] } }],
      excluded: [],
    },
    dryRunPlan: {
      summary: {
        ready_story_count: 1,
        blocked_story_count: 0,
        held_story_count: 0,
        platform_enabled_dry_run_action_count: 3,
        blocked_action_count: 0,
      },
      blocked_stories: [],
    },
    packageEvidence: [],
  });

  assert.equal(reports.summary.verdict, "PARTIAL");
});
