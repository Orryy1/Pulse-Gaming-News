"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDailyStudioReport,
  buildCandidateBuffer,
  buildDiscordOperationsSummary,
  buildNormalOperationsReport,
  buildPlatformPerformance,
  buildRuntimeOwnership,
  buildSchedulerWindowReadiness,
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
  assert.equal(report.publish_window_runway.ready_for_next_24h_boolean, true);
  assert.equal(report.publish_window_runway.covered_publish_windows_24h, 5);
  assert.equal(report.publish_window_runway.reserve_candidates, 5);
  assert.equal(report.blockers.length, 0);
});

test("buildCandidateBuffer exposes daily publish-window runway separately from reserve depth", () => {
  const report = buildCandidateBuffer({
    generated_at: "2026-06-16T22:00:00.000Z",
    totals: { stories_seen: 9, returned: 5, pending_audio: 0, excluded: 0 },
    candidates: Array.from({ length: 5 }, (_, index) => candidate(`window-${index + 1}`)),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.counts.ready_candidates, 5);
  assert.equal(report.publish_window_runway.publish_windows_24h, 5);
  assert.equal(report.publish_window_runway.ready_for_next_24h_boolean, true);
  assert.equal(report.publish_window_runway.covered_publish_windows_24h, 5);
  assert.equal(report.publish_window_runway.uncovered_publish_windows_24h, 0);
  assert.equal(report.publish_window_runway.reserve_candidates, 0);
  assert.ok(report.warnings.includes("ready_candidates_below_target:5/10"));
  assert.ok(report.warnings.includes("publish_window_reserve_empty"));
});

test("buildCandidateBuffer warns when the next 24h publish windows are under-covered", () => {
  const report = buildCandidateBuffer({
    generated_at: "2026-06-16T22:00:00.000Z",
    totals: { stories_seen: 9, returned: 4, pending_audio: 0, excluded: 0 },
    candidates: Array.from({ length: 4 }, (_, index) => candidate(`thin-${index + 1}`)),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.publish_window_runway.ready_for_next_24h_boolean, false);
  assert.equal(report.publish_window_runway.covered_publish_windows_24h, 4);
  assert.equal(report.publish_window_runway.uncovered_publish_windows_24h, 1);
  assert.ok(report.warnings.includes("publish_window_runway_short:4/5"));
});

test("buildCandidateBuffer distinguishes covered expiring runway from missed windows", () => {
  const report = buildCandidateBuffer({
    generated_at: "2026-06-16T22:00:00.000Z",
    totals: { stories_seen: 9, returned: 5, pending_audio: 0, excluded: 0 },
    candidates: Array.from({ length: 5 }, (_, index) =>
      candidate(`expiring-${index + 1}`, {
        source_age_expires_in_hours: index < 2 ? 12 : 72,
      }),
    ),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.publish_window_runway.ready_for_next_24h_boolean, false);
  assert.equal(report.publish_window_runway.covered_publish_windows_24h, 5);
  assert.equal(report.publish_window_runway.uncovered_publish_windows_24h, 0);
  assert.equal(report.publish_window_runway.status, "covered_with_expiring_candidates");
  assert.equal(report.publish_window_runway.ready_candidates_expiring_within_24h, 2);
  assert.ok(report.warnings.includes("ready_candidates_expiring_within_24h:2"));
  assert.ok(!report.warnings.includes("publish_window_runway_short:5/5"));
});

test("buildCandidateBuffer flags an empty buffer red", () => {
  const report = buildCandidateBuffer({
    totals: { stories_seen: 0, returned: 0, pending_audio: 0 },
    candidates: [],
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("candidate_buffer_empty"));
  assert.equal(report.publish_window_runway.ready_for_next_24h_boolean, false);
});

test("buildPlatformPerformance separates measured YouTube from under-instrumented Meta channels", () => {
  const report = buildPlatformPerformance({
    generatedAt: "2026-06-22T13:30:00.000Z",
    platformPosts: [
      { platform: "youtube", status: "published", stats_fetched_at: null, published_at: "2026-06-22 10:00:00" },
      { platform: "instagram_reel", status: "published", stats_fetched_at: null, published_at: "2026-06-22 10:01:00" },
      { platform: "facebook_reel", status: "published", stats_fetched_at: null, published_at: "2026-06-22 10:02:00" },
    ],
    metricSnapshots: [
      { story_id: "story-a", platform: "youtube", views: 320, likes: 4, comments: 1, snapshot_at: "2026-06-22T12:00:00.000Z" },
      { story_id: "story-b", platform: "youtube", views: 640, likes: 10, comments: 2, snapshot_at: "2026-06-22T12:00:00.000Z" },
      { story_id: "story-a", platform: "instagram", views: 0, likes: 18, comments: 2, snapshot_at: "2026-06-22T12:00:00.000Z" },
    ],
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.platforms.youtube_shorts.measurement_status, "measured");
  assert.equal(report.platforms.youtube_shorts.performance_signal, "needs_title_hook_and_first_frame_iteration");
  assert.equal(report.platforms.instagram_reels.measurement_status, "engagement_without_play_counts");
  assert.equal(report.platforms.instagram_reels.performance_signal, "traction_signal_under_instrumented");
  assert.equal(report.platforms.facebook_reels.measurement_status, "no_metric_snapshots");
  assert.equal(report.platforms.facebook_reels.performance_signal, "published_but_unverified_distribution");
  assert.ok(report.next_actions.includes("Repair Meta Reels insights ingestion before treating local Instagram/Facebook zero-view counters as truth."));
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

test("buildRuntimeOwnership can consume the runtime sentinel PID and tunnel report", () => {
  const report = buildRuntimeOwnership(null, {
    verdict: "green",
    expected: {
      commit_short: "abc1234",
      branch: "codex/live",
    },
    summary: {
      commit_short: "abc1234",
      branch: "codex/live",
      primary: true,
      auto_publish: true,
      use_job_queue_explicit: "true",
      scheduler_active: true,
      dispatch_mode: "queue",
      port_owner_pid: 34076,
      cloudflared_present: true,
    },
    blockers: [],
    warnings: [],
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.expected_commit, "abc1234");
  assert.equal(report.facts.port_owner_pid, 34076);
  assert.equal(report.facts.cloudflared_present, true);
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
    platformPerformanceReport: {
      verdict: "amber",
      platform_strategy: {
        primary_learning_platform: "youtube_shorts",
        traction_signal_platform: "instagram_reels",
        verification_platform: "facebook_reels",
      },
      platforms: {
        youtube_shorts: { performance_signal: "needs_title_hook_and_first_frame_iteration" },
        instagram_reels: { performance_signal: "traction_signal_under_instrumented" },
        facebook_reels: { performance_signal: "published_but_unverified_distribution" },
      },
      next_actions: ["Repair Meta Reels insights ingestion."],
    },
  });

  assert.equal(report.overall_verdict, "amber");
  assert.equal(report.operating_posture, "normal_operations");
  assert.equal(report.layers.candidate_buffer.verdict, "green");
  assert.equal(report.layers.runtime_ownership.verdict, "green");
  assert.equal(report.layers.platform_performance.platform_strategy.traction_signal_platform, "instagram_reels");
  assert.ok(report.next_actions.some((action) => action.includes("story-1:youtube_shorts")));
  assert.match(formatNormalOperationsMarkdown(report), /Normal Operations Report/);
  assert.match(formatNormalOperationsMarkdown(report), /Platform Performance/);
});

test("buildDailyStudioReport turns normal operations into an operator handoff", () => {
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

  const daily = buildDailyStudioReport(report);
  const discord = buildDiscordOperationsSummary(report);

  assert.equal(daily.verdict, "amber");
  assert.equal(daily.scheduler_window.ready_for_next_window_boolean, true);
  assert.equal(daily.candidate_buffer.ready_candidates, 10);
  assert.equal(daily.candidate_buffer.publish_window_runway.ready_for_next_24h_boolean, true);
  assert.equal(daily.post_evidence.publish_jobs_seen, 4);
  assert.equal(daily.guarded_scheduler.selected_action, "story-1:youtube_shorts");
  assert.deepEqual(daily.safety.do_not_touch.includes("Do not mutate OAuth, tokens, credentials or billing."), true);
  assert.match(discord.message, /Pulse Gaming Daily Studio/);
  assert.match(discord.message, /Next window: 2026-06-11T14:00:00.000Z/);
  assert.ok(discord.message.length <= 1900);
});

test("buildSchedulerWindowReadiness allows advisory-only amber windows", () => {
  const report = buildNormalOperationsReport({
    generatedAt: "2026-06-11T09:30:00.000Z",
    readinessReport: {
      overall_verdict: "amber",
      blockers: [],
      advisory: ["tiktok_deferred", "cadence_wait"],
      next_action: "Let the scheduler resume.",
      pillars: { recent_publish: { raw: { age_hours: 4 } } },
    },
    queueReport: { verdict: "pass", counts: { done: 4 }, pendingJobs: [], recentFailedJobs: [], staleClaims: [] },
    cadenceReport: {
      verdict: "amber",
      summary: { publish_jobs_seen: 4, next_safe_publish_at_utc: "2026-06-11T14:00:00.000Z" },
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

  const readiness = buildSchedulerWindowReadiness(report);

  assert.equal(readiness.verdict, "amber");
  assert.equal(readiness.ready_for_next_window_boolean, true);
  assert.equal(readiness.next_action, "observe_next_scheduler_window");
  assert.equal(readiness.selected_action.platform, "youtube_shorts");
  assert.equal(readiness.publish_window_runway.ready_for_next_24h_boolean, true);
  assert.deepEqual(readiness.blockers, []);
  assert.ok(readiness.advisory.includes("publish_readiness_amber"));
  assert.ok(readiness.advisory.includes("platform_health_amber"));
});

test("buildSchedulerWindowReadiness blocks runtime drift and disabled selected platforms", () => {
  const report = buildNormalOperationsReport({
    generatedAt: "2026-06-11T09:30:00.000Z",
    readinessReport: { overall_verdict: "green", blockers: [], advisory: [] },
    queueReport: { verdict: "pass", counts: { done: 4 }, pendingJobs: [], recentFailedJobs: [], staleClaims: [] },
    cadenceReport: {
      verdict: "green",
      summary: { next_safe_publish_at_utc: "2026-06-11T14:00:00.000Z" },
      blockers: [],
      advisory: [],
      next_safe_publish: { next_safe_publish_at_utc: "2026-06-11T14:00:00.000Z" },
    },
    localRestartReport: {
      expected_build: { commit_short: "abc1234" },
      blockers: [],
      running: {
        local: { ok: true, build: { commit_short: "abc1234" }, matches_current_commit: true, runtime_ownership: { blockers: [] } },
        public: {
          ok: true,
          build: { commit_short: "old9999" },
          matches_current_commit: false,
          runtime_ownership: { blockers: [], facts: { primary: true, auto_publish: true, use_job_queue_explicit: "true", schedulerActive: true, dispatch_mode: "queue" } },
        },
      },
    },
    platformReport: {
      verdict: "GREEN",
      blockers: [],
      platforms: {
        instagram_reel: { status: "enabled_monitor_next_publish" },
        facebook_reel: { status: "enabled_verify_after_upload" },
      },
    },
    candidateReport: {
      totals: { stories_seen: 12, returned: 10 },
      candidates: Array.from({ length: 10 }, (_, index) => candidate(`story-${index + 1}`)),
    },
    guardedSelection: { action_id: "story-1:tiktok", exhausted: false, skipped_actions: [] },
  });

  const readiness = buildSchedulerWindowReadiness(report);

  assert.equal(readiness.verdict, "red");
  assert.equal(readiness.ready_for_next_window_boolean, false);
  assert.ok(readiness.blockers.includes("runtime_ownership_not_green"));
  assert.ok(readiness.blockers.includes("selected_platform_not_enabled:tiktok"));
  assert.equal(readiness.next_action, "hold_scheduler_and_repair_blockers");
});
