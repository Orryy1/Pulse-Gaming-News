"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCandidateBuffer,
  buildNormalOperationsReport,
  buildRuntimeOwnership,
  formatNormalOperationsMarkdown,
} = require("../../lib/ops/normal-operations");

function candidate(id, overrides = {}) {
  return {
    id,
    title: `Story ${id}`,
    status: "publish_ready",
    score: 100,
    duration_seconds: 48,
    reasons: ["preflight_qa_pass", "scheduler_bridge_candidate"],
    source: {
      source_type: "rss",
      exported_path: `output/goal-proof/batch/${id}/visual_v4_render.mp4`,
    },
    preflight_qa: {
      status: "pass",
      blockers: [],
    },
    ...overrides,
  };
}

test("buildCandidateBuffer marks a full ready V4 queue green", () => {
  const report = buildCandidateBuffer({
    generated_at: "2026-06-11T09:00:00.000Z",
    totals: { stories_seen: 12, returned: 10, pending_audio: 0, excluded: 2 },
    candidates: Array.from({ length: 10 }, (_, index) => candidate(`story-${index + 1}`)),
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.counts.ready_candidates, 10);
  assert.equal(report.counts.source_safe_candidates, 10);
  assert.equal(report.counts.v4_ready_candidates, 10);
  assert.equal(report.blockers.length, 0);
});

test("buildCandidateBuffer flags an empty buffer red", () => {
  const report = buildCandidateBuffer({
    totals: { stories_seen: 0, returned: 0, pending_audio: 0 },
    candidates: [],
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("candidate_buffer_empty"));
});

test("buildRuntimeOwnership requires current public primary queue runtime", () => {
  const report = buildRuntimeOwnership({
    expected_build: { commit_short: "abc1234" },
    blockers: [],
    running: {
      local: {
        ok: true,
        build: { commit_short: "abc1234" },
        matches_current_commit: true,
        runtime_ownership: { blockers: [] },
      },
      public: {
        ok: true,
        build: { commit_short: "abc1234" },
        matches_current_commit: true,
        runtime_ownership: {
          blockers: [],
          facts: {
            primary: true,
            auto_publish: true,
            use_job_queue_explicit: "true",
            schedulerActive: true,
            dispatch_mode: "queue",
          },
        },
      },
    },
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.facts.auto_publish, true);
  assert.equal(report.facts.dispatch_mode, "queue");
});

test("buildNormalOperationsReport composes a newsroom operations verdict", () => {
  const report = buildNormalOperationsReport({
    generatedAt: "2026-06-11T09:30:00.000Z",
    readinessReport: {
      overall_verdict: "amber",
      blockers: [],
      advisory: ["cadence_wait"],
      next_action: "Let the scheduler resume.",
      pillars: { recent_publish: { raw: { age_hours: 4 } } },
    },
    queueReport: { verdict: "pass", counts: { done: 4 }, pendingJobs: [], recentFailedJobs: [], staleClaims: [] },
    cadenceReport: {
      verdict: "amber",
      summary: { publish_jobs_seen: 4, next_safe_publish_at_utc: "2026-06-11T14:00:00.000Z" },
      publish_events: [{ id: "story-1", title: "Story 1", published_at: "2026-06-11T09:00:00.000Z", platforms: ["youtube"], publish_status: "published" }],
      blockers: [],
      advisory: ["wait_for_next_window"],
      next_safe_publish: { next_safe_publish_at_utc: "2026-06-11T14:00:00.000Z" },
    },
    localRestartReport: {
      expected_build: { commit_short: "abc1234" },
      blockers: [],
      running: {
        local: { ok: true, build: { commit_short: "abc1234" }, matches_current_commit: true, runtime_ownership: { blockers: [] } },
        public: {
          ok: true,
          build: { commit_short: "abc1234" },
          matches_current_commit: true,
          runtime_ownership: { blockers: [], facts: { primary: true, auto_publish: true, use_job_queue_explicit: "true", schedulerActive: true, dispatch_mode: "queue" } },
        },
      },
    },
    platformReport: {
      verdict: "AMBER",
      blockers: ["tiktok_local_token_refresh_or_sync_required"],
      platforms: {
        instagram_reel: { status: "enabled_monitor_next_publish" },
        facebook_reel: { status: "enabled_verify_after_upload" },
        tiktok: { status: "needs_local_token_refresh_or_sync" },
      },
    },
    candidateReport: {
      totals: { stories_seen: 12, returned: 10 },
      candidates: Array.from({ length: 10 }, (_, index) => candidate(`story-${index + 1}`)),
    },
    guardedSelection: { action_id: "story-1:youtube_shorts", exhausted: false, skipped_actions: [] },
  });

  assert.equal(report.overall_verdict, "amber");
  assert.equal(report.operating_posture, "normal_operations");
  assert.equal(report.layers.candidate_buffer.verdict, "green");
  assert.equal(report.layers.runtime_ownership.verdict, "green");
  assert.ok(report.next_actions.some((action) => action.includes("story-1:youtube_shorts")));
  assert.match(formatNormalOperationsMarkdown(report), /Normal Operations Report/);
});
