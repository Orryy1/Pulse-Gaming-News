"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
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
  assert.equal(schedule("candidate_supply_monitor_2h")?.cron_expr, "5 * * * *");
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.post_discord_on_amber, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_repair_on_amber, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_hunt_on_runway_gap, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_fresh_review_script_repair, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.fresh_review_script_repair_limit, 6);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.repair_limit, 10);
  assert.equal(schedule("competitor_forensics_daily")?.kind, "competitor_forensics_lab");
  assert.equal(schedule("competitor_quality_gate_daily")?.kind, "competitor_quality_gate");
  assert.equal(schedule("commercial_learning_daily")?.kind, "commercial_learning_loop");
  assert.equal(schedule("safe_auto_repair_runner_2h")?.kind, "safe_auto_repair_runner");
  assert.equal(schedule("safe_auto_repair_runner_2h")?.cron_expr, "35 * * * *");
  assert.equal(schedule("safe_auto_repair_runner_2h")?.payload.limit, 8);
  assert.equal(schedule("local_tts_doctor_hourly")?.kind, "local_tts_doctor");
  assert.equal(schedule("local_tts_doctor_hourly")?.cron_expr, "25 * * * *");
  assert.equal(schedule("local_tts_doctor_hourly")?.payload.restart, true);
  assert.equal(schedule("local_tts_doctor_hourly")?.payload.prewarm, true);
  assert.equal(schedule("autonomous_feedback_monitor_30m")?.payload.enqueue_followups, true);

  assert.equal(typeof handlers.candidate_supply_monitor, "function");
  assert.equal(typeof handlers.competitor_forensics_lab, "function");
  assert.equal(typeof handlers.competitor_quality_gate, "function");
  assert.equal(typeof handlers.commercial_learning_loop, "function");
  assert.equal(typeof handlers.safe_auto_repair_runner, "function");
  assert.equal(typeof handlers.local_tts_doctor, "function");
  assert.equal(typeof handlers.fresh_review_script_repair, "function");
});

test("local TTS doctor handler restarts and prewarms through a safe child process", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-doctor-"));
  const reportPath = path.join(tmp, "local_tts_doctor.json");
  await fs.writeFile(reportPath, JSON.stringify({
    verdict: "green",
    action: "restart_and_prewarm",
    after: { status: { ready: true, phase: "ready" } },
    started: { pid: 12345 },
    prewarm: { ok: true },
    gpu: { ok: true },
  }));

  let captured = null;
  const result = await handlers.local_tts_doctor(
    { payload: { restart: true, prewarm: true, result_path: reportPath } },
    {
      log() {},
      async runNodeJobChildProcess(options) {
        captured = options;
        return { ok: true, stdout_tail: "doctor ok", stderr_tail: "" };
      },
    },
  );

  assert.deepEqual(captured.args, [
    "tools/local-tts-doctor.js",
    "--json",
    "--restart",
    "--prewarm",
  ]);
  assert.equal(captured.childKind, "local_tts_doctor");
  assert.equal(result.status, "green");
  assert.equal(result.ready, true);
  assert.equal(result.started_pid, 12345);
  assert.equal(result.prewarm_ok, true);
  assert.equal(result.gpu_ok, true);
});

test("candidate supply monitor enqueues fresh intake and repair when runway has no reserve", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const candidateSupplyPath = require.resolve("../../lib/ops/candidate-supply");
  const candidateEnginePath = require.resolve("../../tools/candidate-supply-engine");
  const fsExtraPath = require.resolve("fs-extra");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [candidateSupplyPath, require.cache[candidateSupplyPath]],
    [candidateEnginePath, require.cache[candidateEnginePath]],
    [fsExtraPath, require.cache[fsExtraPath]],
  ]);
  const enqueued = [];
  const fakeReport = {
    generated_at: "2026-06-17T08:05:00.000Z",
    verdict: "amber",
    summary: {
      fresh_source_backed_stories_24h: 11,
      green_ready_candidates: 5,
      durable_green_ready_candidates: 3,
      source_safe_candidates: 5,
      v4_ready_candidates: 5,
    },
    targets: {
      fresh_source_backed_stories_per_day: 10,
      green_ready_candidates: 10,
      source_safe_candidates: 6,
      v4_ready_candidates: 3,
    },
    candidate_buffer: {
      publish_window_runway: {
        status: "covered_no_reserve",
        publish_windows_24h: 5,
        covered_publish_windows_24h: 5,
        uncovered_publish_windows_24h: 0,
        reserve_candidates: 0,
        reserve_target: 5,
      },
    },
    official_source_watchlist: {},
    priority_scorecards: [],
    dedupe: {},
    blockers: [],
    warnings: ["publish_window_reserve_empty", "durable_green_ready_candidates_below_target:3/10"],
  };

  try {
    require.cache[fsExtraPath] = {
      id: fsExtraPath,
      filename: fsExtraPath,
      loaded: true,
      exports: {
        ensureDir: async () => {},
        writeJson: async () => {},
        writeFile: async () => {},
      },
    };
    require.cache[candidateEnginePath] = {
      id: candidateEnginePath,
      filename: candidateEnginePath,
      loaded: true,
      exports: {
        async buildFreshCandidateReport() {
          return { report: { totals: { returned: 5 }, candidates: [] }, stories: [] };
        },
      },
    };
    require.cache[candidateSupplyPath] = {
      id: candidateSupplyPath,
      filename: candidateSupplyPath,
      loaded: true,
      exports: {
        buildCandidateSupplyReport() {
          return fakeReport;
        },
        candidateSupplyMonitorNeedsRepair() {
          return true;
        },
        candidateSupplyMonitorNeedsFreshIntake() {
          return true;
        },
        candidateSupplyMonitorNeedsTranscriptRepair() {
          return false;
        },
        formatCandidateSupplyMonitorDiscord() {
          return "candidate monitor";
        },
        formatCandidateSupplyMarkdown() {
          return "# Candidate Supply";
        },
        shouldNotifyCandidateSupplyMonitor() {
          return false;
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.candidate_supply_monitor(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 30,
          enqueue_repair_on_amber: true,
          enqueue_hunt_on_runway_gap: true,
          enqueue_fresh_review_script_repair: true,
          fresh_review_script_repair_limit: 6,
          repair_limit: 10,
        },
      },
      {
        log() {},
        repos: {
          jobs: {
            enqueue(job) {
              enqueued.push(job);
              return { id: enqueued.length };
            },
          },
        },
      },
    );

    assert.equal(result.status, "amber");
    assert.equal(result.repair_enqueued, true);
    assert.equal(result.fresh_intake_enqueued, true);
    assert.equal(result.fresh_review_script_repair_enqueued, true);
    assert.equal(enqueued.length, 3);
    assert.equal(enqueued[0].kind, "hunt");
    assert.equal(enqueued[0].payload.reason, "candidate_supply_monitor_fresh_intake");
    assert.equal(enqueued[0].idempotency_key, "candidate_supply_hunt:2026-06-17:08");
    assert.equal(enqueued[1].kind, "fresh_review_script_repair");
    assert.equal(enqueued[1].payload.reason, "candidate_supply_monitor_fresh_review_script_repair");
    assert.equal(enqueued[1].payload.limit, 6);
    assert.equal(enqueued[1].idempotency_key, "candidate_supply_fresh_review_script_repair:2026-06-17:08");
    assert.equal(enqueued[2].kind, "safe_auto_repair_runner");
    assert.equal(enqueued[2].payload.reason, "candidate_supply_monitor_reserve_refill");
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
});

test("autonomous feedback monitor enqueues safe follow-ups for operational feedback", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const feedbackMonitorPath = require.resolve("../../lib/ops/autonomous-feedback-monitor");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [feedbackMonitorPath, require.cache[feedbackMonitorPath]],
  ]);
  const enqueued = [];

  try {
    require.cache[feedbackMonitorPath] = {
      id: feedbackMonitorPath,
      filename: feedbackMonitorPath,
      loaded: true,
      exports: {
        formatAutonomousFeedbackDiscord() {
          return "feedback discord";
        },
        async runAutonomousFeedbackMonitor() {
          return {
            generated_at: "2026-06-18T12:20:00.000Z",
            verdict: "amber",
            current_action: "repair_transcript_audience_blockers",
            runtime: {
              auto_publish: true,
              use_job_queue: "true",
              scheduler_active: true,
              dispatch_mode: "queue",
            },
            scheduler: {
              next_safe_publish_at_utc: "2026-06-18T14:00:00.000Z",
              selected_action: "story1:youtube_shorts",
            },
            candidate_buffer: {
              ready_candidates: 1,
              source_safe_candidates: 1,
              v4_ready_candidates: 1,
              warnings: ["ready_candidates_below_target:1/10"],
            },
            publish_runway_feedback: {
              repairable_backlog: 9,
              live_publish_candidates: 1,
            },
            discord_feedback: {
              real_blocker_count: 0,
              items: [],
            },
            ingested_discord_feedback: {
              summary: {
                actionable_count: 1,
                blocking_count: 1,
              },
            },
            transcript_audience_feedback: {
              summary: {
                rewrite_required: 91,
                current_blocking_count: 2,
              },
            },
            post_window_feedback: {
              anomaly_count: 1,
            },
            market_intelligence: {
              candidate_supply: {
                verdict: "amber",
              },
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.autonomous_feedback_monitor(
      {
        channel_id: "pulse-gaming",
        payload: {
          post_discord: false,
          enqueue_followups: true,
          repair_limit: 8,
          fresh_review_script_repair_limit: 6,
        },
      },
      {
        log() {},
        repos: {
          jobs: {
            enqueue(job) {
              enqueued.push(job);
              return { id: enqueued.length };
            },
          },
        },
      },
    );

    assert.equal(result.followups_enqueued.length, 3);
    assert.deepEqual(enqueued.map((item) => item.kind), [
      "candidate_supply_monitor",
      "fresh_review_script_repair",
      "safe_auto_repair_runner",
    ]);
    assert.equal(enqueued[0].payload.reason, "autonomous_feedback_monitor_candidate_supply_refill");
    assert.equal(enqueued[1].payload.reason, "autonomous_feedback_monitor_transcript_feedback");
    assert.equal(enqueued[2].payload.reason, "autonomous_feedback_monitor_safe_repair");
    assert.equal(enqueued[2].idempotency_key, "autonomous_feedback_safe_repair:2026-06-18:12");
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
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
