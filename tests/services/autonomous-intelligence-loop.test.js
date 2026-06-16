"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");
const {
  buildAutonomousFeedbackReport,
  formatAutonomousFeedbackDiscord,
} = require("../../lib/ops/autonomous-feedback-monitor");

function schedule(name) {
  return DEFAULT_SCHEDULES.find((item) => item.name === name);
}

test("scheduler registers the full autonomous intelligence loop", () => {
  assert.equal(schedule("candidate_supply_monitor_2h")?.kind, "candidate_supply_monitor");
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.post_discord_on_amber, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_repair_on_amber, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.repair_limit, 8);
  assert.equal(schedule("competitor_forensics_daily")?.kind, "competitor_forensics_lab");
  assert.equal(schedule("competitor_quality_gate_daily")?.kind, "competitor_quality_gate");
  assert.equal(schedule("commercial_learning_daily")?.kind, "commercial_learning_loop");
  assert.equal(schedule("safe_auto_repair_runner_2h")?.kind, "safe_auto_repair_runner");

  assert.equal(typeof handlers.candidate_supply_monitor, "function");
  assert.equal(typeof handlers.competitor_forensics_lab, "function");
  assert.equal(typeof handlers.competitor_quality_gate, "function");
  assert.equal(typeof handlers.commercial_learning_loop, "function");
  assert.equal(typeof handlers.safe_auto_repair_runner, "function");
});

test("autonomous feedback surfaces market intelligence without blocking publishing by itself", () => {
  const report = buildAutonomousFeedbackReport({
    generatedAt: "2026-06-16T18:00:00.000Z",
    normalOperationsReport: {
      overall_verdict: "amber",
      layers: {
        runtime_ownership: {
          verdict: "green",
          facts: { auto_publish: true, use_job_queue: "true", scheduler_active: true, dispatch_mode: "queue" },
          blockers: [],
        },
        publish_readiness: { verdict: "amber", blockers: [], advisory: ["cadence_wait"] },
        queue_health: { verdict: "green", hard_fails: [] },
        candidate_buffer: {
          verdict: "amber",
          counts: { ready_candidates: 2, source_safe_candidates: 2, v4_ready_candidates: 2 },
          blockers: [],
          warnings: ["ready_candidates_below_target:2/10"],
          top_candidates: [],
        },
        post_window_verification: { verdict: "amber" },
      },
      guarded_selection: { action_id: "story1:youtube_shorts", exhausted: false },
    },
    candidateSupplyReport: {
      verdict: "amber",
      generated_at: "2026-06-16T17:45:00.000Z",
      summary: {
        fresh_source_backed_stories_24h: 10,
        green_ready_candidates: 2,
        v4_ready_candidates: 2,
      },
      warnings: ["green_ready_candidates_below_target:2/10"],
      blockers: [],
    },
    competitorForensicsReport: {
      verdict: "PASS",
      generated_at: "2026-06-16T05:10:00.000Z",
      summary: {
        reviewed_channel_count: 20,
        assessed_video_count: 100,
        recent_outlier_count: 60,
      },
    },
    competitorQualityGateReport: {
      verdict: "PASS",
      summary: { green_story_count: 2, amber_story_count: 0, red_story_count: 0 },
    },
    commercialLearningReport: {
      status: "learning_active",
      totals: { clicks: 5, clicked_stories: 2 },
    },
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.market_intelligence.competitor_forensics.verdict, "green");
  assert.equal(report.market_intelligence.blocks_publishing, false);
  assert.deepEqual(report.blockers, []);
  assert.match(formatAutonomousFeedbackDiscord(report), /Market: candidate=amber/);
  assert.match(formatAutonomousFeedbackDiscord(report), /competitors=green/);
});
