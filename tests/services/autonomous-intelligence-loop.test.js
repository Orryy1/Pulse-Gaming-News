"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");
const {
  TTS_PRONUNCIATION_PROFILE_VERSION,
} = require("../../lib/tts-pronunciation");
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
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_fresh_production_refill, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.enqueue_local_tts_retry_recovery, true);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.fresh_review_script_repair_limit, 6);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.fresh_production_refill_limit, 12);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.fresh_production_refill_rss_per_feed, 4);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.fresh_production_refill_tts_provider, "elevenlabs");
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.local_tts_retry_limit, 6);
  assert.equal(schedule("candidate_supply_monitor_2h")?.payload.local_tts_retry_apply_limit, 3);
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
  assert.equal(schedule("local_tts_doctor_hourly")?.payload.smoke, true);
  assert.equal(schedule("autonomous_feedback_monitor_30m")?.payload.enqueue_followups, true);

  assert.equal(typeof handlers.candidate_supply_monitor, "function");
  assert.equal(typeof handlers.competitor_forensics_lab, "function");
  assert.equal(typeof handlers.competitor_quality_gate, "function");
  assert.equal(typeof handlers.commercial_learning_loop, "function");
  assert.equal(typeof handlers.safe_auto_repair_runner, "function");
  assert.equal(typeof handlers.local_tts_doctor, "function");
  assert.equal(typeof handlers.local_tts_retry_recovery, "function");
  assert.equal(typeof handlers.fresh_review_script_repair, "function");
  assert.equal(typeof handlers.fresh_production_refill, "function");
});

test("local TTS doctor handler restarts and prewarms through a safe child process", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-doctor-"));
  const reportPath = path.join(tmp, "local_tts_doctor.json");
  const lockPath = path.join(tmp, "local_tts_job_lease.json");
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
    {
      payload: {
        restart: true,
        prewarm: true,
        result_path: reportPath,
        local_tts_lock_path: lockPath,
      },
    },
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
    "--smoke",
  ]);
  assert.equal(captured.childKind, "local_tts_doctor");
  assert.equal(result.status, "green");
  assert.equal(result.ready, true);
  assert.equal(result.started_pid, 12345);
  assert.equal(result.prewarm_ok, true);
  assert.equal(result.gpu_ok, true);
});

test("local TTS doctor skips instead of stacking a smoke request while another local TTS job holds the lease", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-busy-doctor-"));
  const lockPath = path.join(tmp, "local_tts_job_lease.json");
  await fs.writeFile(lockPath, JSON.stringify({
    owner: "fresh_production_refill:active",
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }));

  let childCalled = false;
  const result = await handlers.local_tts_doctor(
    { id: 123, payload: { local_tts_lock_path: lockPath } },
    {
      log() {},
      async runNodeJobChildProcess() {
        childCalled = true;
        return { ok: true };
      },
    },
  );

  assert.equal(childCalled, false);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "local_tts_busy");
  assert.equal(result.local_tts_busy, true);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_db_mutation, true);
});

test("local TTS retry recovery handler runs bounded local-only preflight and apply", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-retry-recovery-"));
  const lockPath = path.join(tmp, "local_tts_job_lease.json");
  const queuePath = path.join(tmp, "local_media_repair_queue.json");
  const planPath = path.join(tmp, "local_script_extension_plan.json");
  const applyPath = path.join(tmp, "local_script_extension_audio_apply.json");
  const overnightPath = path.join(tmp, "local_tts_overnight_report.json");
  const childCalls = [];

  await fs.writeFile(queuePath, JSON.stringify({ items: [] }));
  await fs.writeFile(
    planPath,
    JSON.stringify({
      counts: { total: 3, ready: 2, review: 1 },
      drafts: [
        { story_id: "tts-one", action: "ready_for_local_liam_audio" },
        { story_id: "tts-two", action: "ready_for_local_liam_audio" },
      ],
    }),
  );
  await fs.writeFile(
    applyPath,
    JSON.stringify({
      applied: [{ story_id: "tts-one" }],
      skipped: [{ story_id: "tts-two", failure_code: "tts_timeout" }],
    }),
  );
  await fs.writeFile(
    overnightPath,
    JSON.stringify({
      verdict: "AMBER",
      autonomous_recovery: {
        status: "ready_for_local_tts_retry_apply",
        safe_retry_work_order_count: 2,
      },
    }),
  );

  const result = await handlers.local_tts_retry_recovery(
    {
      payload: {
        limit: 6,
        apply_limit: 1,
        out_dir: tmp,
        local_tts_lock_path: lockPath,
      },
    },
    {
      log() {},
      async runNodeJobChildProcess(options) {
        childCalls.push(options);
        return { ok: true, stdout_tail: `${options.childKind} ok`, stderr_tail: "" };
      },
    },
  );

  assert.deepEqual(childCalls.map((call) => call.childKind), [
    "local_tts_retry_doctor",
    "local_tts_retry_queue",
    "local_tts_retry_preflight",
    "local_tts_retry_apply",
    "local_tts_retry_report",
  ]);
  assert.deepEqual(childCalls[0].args, [
    "tools/local-tts-doctor.js",
    "--json",
    "--restart",
    "--prewarm",
    "--smoke",
  ]);
  assert.deepEqual(childCalls[1].args, [
    "tools/local-media-repair.js",
    "--dry-run",
    "--limit",
    "6",
    "--out-dir",
    tmp,
  ]);
  assert.deepEqual(childCalls[2].args, [
    "tools/local-script-extension.js",
    "--dry-run",
    "--limit",
    "6",
    "--out-dir",
    tmp,
    "--queue",
    queuePath,
  ]);
  assert.deepEqual(childCalls[3].args, [
    "tools/local-script-extension.js",
    "--apply-local-audio",
    "--apply-limit",
    "1",
    "--out-dir",
    tmp,
    "--queue",
    queuePath,
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.local_only, true);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_db_mutation, true);
  assert.equal(result.plan_ready_count, 2);
  assert.equal(result.applied_count, 1);
  assert.equal(result.skipped_count, 1);
  assert.equal(result.overnight_verdict, "AMBER");
});

test("local TTS retry recovery skips instead of competing with an active local TTS generation", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-busy-retry-"));
  const lockPath = path.join(tmp, "local_tts_job_lease.json");
  await fs.writeFile(lockPath, JSON.stringify({
    owner: "local_tts_doctor:active",
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }));

  const childCalls = [];
  const result = await handlers.local_tts_retry_recovery(
    {
      id: 456,
      payload: {
        limit: 6,
        apply_limit: 1,
        out_dir: tmp,
        local_tts_lock_path: lockPath,
      },
    },
    {
      log() {},
      async runNodeJobChildProcess(options) {
        childCalls.push(options);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(childCalls, []);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "local_tts_busy");
  assert.equal(result.local_tts_busy, true);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_db_mutation, true);
});

test("local TTS retry recovery skips crash-quarantined smoke failures", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-crash-retry-"));
  const doctorPath = path.join(tmp, "local_tts_doctor.json");
  await fs.writeFile(doctorPath, JSON.stringify({
    verdict: "red",
    action: "manual_start_required",
    failure_code: "server_down",
    reason: "local TTS HTTP health is unreachable",
    generation_smoke: {
      ok: false,
      provider: "local",
      error: "local_tts_generation_failed:connection_reset:local TTS connection reset during generation",
    },
  }));

  const childCalls = [];
  const result = await handlers.local_tts_retry_recovery(
    {
      id: 789,
      payload: {
        limit: 6,
        apply_limit: 1,
        out_dir: tmp,
        local_tts_doctor_report_path: doctorPath,
      },
    },
    {
      log() {},
      async runNodeJobChildProcess(options) {
        childCalls.push(options);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(childCalls, []);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "local_tts_crash_quarantined");
  assert.equal(result.local_tts_crash_quarantined, true);
  assert.equal(result.recommended_provider, "elevenlabs");
  assert.equal(result.local_tts_failure_code, "server_down");
  assert.match(result.local_tts_smoke_error, /connection_reset/);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_db_mutation, true);
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
  let receivedMotionCapacityReports = null;
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
    refill_action_plan: {
      status: "needed",
      recommended_refill_limit: 18,
      recommended_rss_per_feed: 6,
      minimum_new_green_candidates: 9,
      safe_refill_command: "npm run ops:fresh-production-refill -- --json --limit 18 --rss-per-feed 6",
    },
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
        async discoverMotionCapacityReportPaths() {
          return ["C:\\motion-capacity\\studio_v4_source_family_acquisition.json"];
        },
        async readMotionCapacityReports(paths) {
          assert.deepEqual(paths, ["C:\\motion-capacity\\studio_v4_source_family_acquisition.json"]);
          return [{ rows: [{ story_id: "motion-close", readiness_status: "v4_motion_blocked" }] }];
        },
      },
    };
    require.cache[candidateSupplyPath] = {
      id: candidateSupplyPath,
      filename: candidateSupplyPath,
      loaded: true,
      exports: {
        buildCandidateSupplyReport(options = {}) {
          receivedMotionCapacityReports = options.motionCapacityReports;
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
          enqueue_fresh_production_refill: true,
          enqueue_local_tts_retry_recovery: true,
          fresh_review_script_repair_limit: 6,
          fresh_production_refill_limit: 12,
          fresh_production_refill_rss_per_feed: 4,
          fresh_production_refill_tts_provider: "elevenlabs",
          local_tts_retry_limit: 6,
          local_tts_retry_apply_limit: 3,
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
    assert.equal(result.fresh_production_refill_enqueued, true);
    assert.equal(result.local_tts_retry_recovery_enqueued, true);
    assert.equal(Array.isArray(receivedMotionCapacityReports), true);
    assert.equal(receivedMotionCapacityReports.length, 1);
    assert.equal(enqueued.length, 5);
    assert.equal(enqueued[0].kind, "hunt");
    assert.equal(enqueued[0].payload.reason, "candidate_supply_monitor_fresh_intake");
    assert.equal(enqueued[0].idempotency_key, "candidate_supply_hunt:2026-06-17:08");
    assert.equal(enqueued[1].kind, "fresh_review_script_repair");
    assert.equal(enqueued[1].payload.reason, "candidate_supply_monitor_fresh_review_script_repair");
    assert.equal(enqueued[1].payload.limit, 6);
    assert.equal(enqueued[1].idempotency_key, "candidate_supply_fresh_review_script_repair:2026-06-17:08");
    assert.equal(enqueued[2].kind, "local_tts_retry_recovery");
    assert.equal(enqueued[2].payload.reason, "candidate_supply_monitor_local_tts_retry_recovery");
    assert.equal(enqueued[2].payload.limit, 6);
    assert.equal(enqueued[2].payload.apply_limit, 3);
    assert.equal(enqueued[2].idempotency_key, "candidate_supply_local_tts_retry_recovery:2026-06-17:08");
    assert.equal(enqueued[3].kind, "fresh_production_refill");
    assert.equal(enqueued[3].payload.reason, "candidate_supply_monitor_fresh_production_refill");
    assert.equal(enqueued[3].payload.limit, 18);
    assert.equal(enqueued[3].payload.rss_per_feed, 6);
    assert.equal(enqueued[3].payload.tts_provider_preference, "elevenlabs");
    assert.equal(enqueued[3].payload.repair_evidence_mode, "full");
    assert.equal(enqueued[3].payload.repair_story_limit, 9);
    assert.equal(enqueued[3].payload.source_minimum_new_green_candidates, 9);
    assert.equal(
      enqueued[3].payload.source_refill_command,
      "npm run ops:fresh-production-refill -- --json --limit 18 --rss-per-feed 6 --repair-evidence-mode full --repair-story-limit 9 --tts-provider elevenlabs",
    );
    assert.equal(
      enqueued[3].payload.out_dir,
      "output/candidate-supply/fresh-production-refill/2026-06-17-08/goal-proof-batch",
    );
    assert.equal(
      enqueued[3].payload.contract_out_dir,
      "output/candidate-supply/fresh-production-refill/2026-06-17-08/goal-contract",
    );
    assert.equal(enqueued[3].idempotency_key, "candidate_supply_fresh_production_refill:2026-06-17:08");
    assert.equal(enqueued[4].kind, "safe_auto_repair_runner");
    assert.equal(enqueued[4].payload.reason, "candidate_supply_monitor_reserve_refill");
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
});

test("job child process evidence preserves actionable failure diagnostics", () => {
  const { normaliseJobChildProcessEvidence } = require("../../lib/job-handlers");

  const timedOut = normaliseJobChildProcessEvidence({
    childKind: "fresh_refill_segment_validation",
    args: ["tools/official-trailer-segment-validator.js", "--json"],
    result: {
      ok: false,
      exit_code: 124,
      signal: "SIGTERM",
      timed_out: true,
      stdout_tail: "",
      stderr_tail: "",
    },
  });

  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.child_kind, "fresh_refill_segment_validation");
  assert.equal(timedOut.exit_code, 124);
  assert.equal(timedOut.signal, "SIGTERM");
  assert.equal(timedOut.timed_out, true);
  assert.equal(timedOut.failure_reason, "timed_out");
  assert.equal(timedOut.actionable_diagnostic, true);

  const error = new Error("segment validator child process failed with code 2: bad input");
  error.exit_code = 2;
  error.stdout_tail = "last stdout line";
  error.stderr_tail = "";

  const failedWithCode = normaliseJobChildProcessEvidence({
    childKind: "fresh_refill_segment_validation",
    args: ["tools/official-trailer-segment-validator.js", "--json"],
    error,
  });

  assert.equal(failedWithCode.ok, false);
  assert.equal(failedWithCode.exit_code, 2);
  assert.equal(failedWithCode.failure_reason, "exit_code_2");
  assert.equal(failedWithCode.stdout_tail, "last stdout line");
  assert.equal(failedWithCode.error, error.message);
  assert.equal(failedWithCode.actionable_diagnostic, true);
});

test("fresh refill repair filter skips already scheduler-ready stories", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-ready-skip-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const readyDir = path.join(tmp, "ready_story");
  const newDir = path.join(tmp, "new_story");

  try {
    await fs.mkdir(readyDir, { recursive: true });
    await fs.mkdir(newDir, { recursive: true });
    for (const [dir, storyId, title] of [
      [readyDir, "ready_story", "Already Ready Story"],
      [newDir, "new_story", "New Runway Story"],
    ]) {
      await fs.writeFile(
        path.join(dir, "canonical_story_manifest.json"),
        JSON.stringify({
          story_id: storyId,
          selected_title: title,
          narration_script: `${title} has a concrete player consequence. Follow Pulse Gaming so you never miss a beat.`,
        }),
      );
      await fs.writeFile(
        path.join(dir, "source_manifest.json"),
        JSON.stringify({
          story_id: storyId,
          freshness_gate: "pass",
          coherence_gate: "pass",
          blockers: [],
        }),
      );
      await fs.writeFile(
        path.join(dir, "script_scorecard.json"),
        JSON.stringify({
          story_id: storyId,
          verdict: "viral_ready",
          blockers: [],
          failures: [],
        }),
      );
    }
    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "ready_story",
          title: "Already Ready Story",
          artifact_dir: readyDir,
          blockers: ["footage:v4_motion_blocked"],
        },
        {
          story_id: "new_story",
          title: "New Runway Story",
          artifact_dir: newDir,
          blockers: ["footage:v4_motion_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
      alreadyReadyStoryIds: ["ready_story"],
    });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["new_story"]);
    assert.deepEqual(result.alreadyReadyRows.map((row) => row.story_id), ["ready_story"]);
    assert.equal(result.quarantinedRows.length, 0);
    const quarantineReport = JSON.parse(
      await fs.readFile(result.quarantineReportPath, "utf8"),
    );
    assert.equal(quarantineReport.summary.already_ready_skipped_story_package_count, 1);
    assert.deepEqual(
      JSON.parse(await fs.readFile(result.eligibleStoryPackagesPath, "utf8")).map((row) => row.story_id),
      ["new_story"],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter distrusts stale viral-ready evidence for generic narration", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-stale-script-score-"));
  const artifactDir = path.join(tmp, "generic-story");
  const storyPackagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "generic-story",
        canonical_subject: "We mean business",
        selected_title: "We Mean Business Needs One Real Proof Point",
        narration_script:
          "We mean business has one detail worth checking before it becomes background noise. Not every update deserves a spotlight. Use this as a watch signal, not a verdict. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: { name: "Eurogamer", url: "https://www.eurogamer.net/example" },
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({ verdict: "viral_ready", blockers: [], failures: [] }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([{ story_id: "generic-story", artifact_dir: artifactDir }]),
    );

    const result = await buildFreshRefillRepairPackageFilter({ storyPackagesPath, outputDir });
    assert.deepEqual(result.eligibleRows, []);
    assert.deepEqual(result.quarantinedRows[0].reasons, ["generic_source_signal_template"]);

    const sourceProofDir = path.join(tmp, "source-proof-story");
    await fs.mkdir(sourceProofDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceProofDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "source-proof-story",
        canonical_subject: "Starward",
        selected_title: "Starward Has A Source-Proof Risk",
        narration_script:
          "Starward has to answer one simple thing: why should players care now? A named source is only useful when it changes a real choice. If Xbox Wire gives that choice teeth, it becomes a story. If not, it belongs in the watch pile until stronger proof lands. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(sourceProofDir, "source_manifest.json"),
      await fs.readFile(path.join(artifactDir, "source_manifest.json")),
    );
    await fs.writeFile(
      path.join(sourceProofDir, "script_scorecard.json"),
      await fs.readFile(path.join(artifactDir, "script_scorecard.json")),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([{ story_id: "source-proof-story", artifact_dir: sourceProofDir }]),
    );
    const sourceProofResult = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: path.join(tmp, "source-proof-repair"),
    });
    assert.deepEqual(sourceProofResult.eligibleRows, []);
    assert.deepEqual(sourceProofResult.quarantinedRows[0].reasons, ["generic_source_signal_template"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter quarantines narration attributed to an unrecorded source", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-source-attribution-"));
  const artifactDir = path.join(tmp, "black-flag-story");
  const storyPackagesPath = path.join(tmp, "story-packages.json");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "black-flag-story",
        canonical_subject: "Assassin's Creed Black Flag Resynced",
        selected_title: "Black Flag Resynced Faces A Steam Trust Fight",
        narration_script:
          "Black Flag Resynced has to prove its complete edition claim. PlayStation Blog says PlayStation 5 Pro upgrades are coming. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/07/08/assassins-creed-black-flag-resynced-returns/",
        },
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({ verdict: "viral_ready", blockers: [], failures: [] }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([{ story_id: "black-flag-story", artifact_dir: artifactDir }]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: path.join(tmp, "repair"),
    });
    assert.deepEqual(result.eligibleRows, []);
    assert.deepEqual(result.quarantinedRows[0].reasons, ["source_attribution_mismatch"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter routes tighten-before-tts scripts through rewrite first", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-tighten-script-"));
  const artifactDir = path.join(tmp, "wreck-runners");
  const storyPackagesPath = path.join(tmp, "story-packages.json");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "wreck-runners",
        canonical_subject: "Wreck Runners",
        selected_title: "Wreck Runners Opens A New Xbox Playtest",
        narration_script:
          "Wreck Runners has a new Xbox Insider playtest. Xbox Wire says players can join now and test its co-op action loop before release. The first few minutes need to prove movement, hit feedback and team flow. If those click, this becomes a real watchlist game. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: { name: "Xbox Wire", url: "https://news.xbox.com/wreck-runners" },
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({ verdict: "tighten_before_tts", blockers: [], failures: [] }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([{ story_id: "wreck-runners", artifact_dir: artifactDir }]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: path.join(tmp, "repair"),
    });
    assert.deepEqual(result.eligibleRows, []);
    assert.deepEqual(result.quarantinedRows[0].reasons, ["script_tighten_required"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter quarantines motion-poor service stories without direct video runway", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-motion-runway-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const priceDir = path.join(tmp, "xbox_price_story");
  const directDir = path.join(tmp, "direct_motion_story");

  try {
    await fs.mkdir(priceDir, { recursive: true });
    await fs.mkdir(directDir, { recursive: true });
    await fs.writeFile(
      path.join(priceDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "xbox_price_story",
        selected_title: "Xbox Console Prices Just Became The Trust Test",
        canonical_subject: "Xbox console prices",
        narration_script:
          "Xbox console prices just became the trust test. Xbox Wire says hardware prices changed again, and that matters because players now have to decide whether buying in still makes sense. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(priceDir, "source_manifest.json"),
      JSON.stringify({
        story_id: "xbox_price_story",
        freshness_gate: "pass",
        coherence_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/25/xbox-console-price-update/",
        },
        direct_media_candidates: [],
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(priceDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: "xbox_price_story",
        verdict: "viral_ready",
        blockers: [],
        failures: [],
      }),
    );

    await fs.writeFile(
      path.join(directDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "direct_motion_story",
        selected_title: "MARVEL Tokon Finally Shows Real Gameplay",
        canonical_subject: "MARVEL Tokon",
        narration_script:
          "MARVEL Tokon finally has real gameplay on screen. The new trailer gives players something concrete to judge: team pace, tag chaos and whether the roster can carry a serious fighter. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(directDir, "source_manifest.json"),
      JSON.stringify({
        story_id: "direct_motion_story",
        freshness_gate: "pass",
        coherence_gate: "pass",
        direct_media_candidates: [
          {
            direct_media_url: "https://example.com/marvel-tokon-gameplay.mp4",
            source_type: "official_game_website_media_page",
            source_owner: "Arc System Works",
          },
        ],
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(directDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: "direct_motion_story",
        verdict: "viral_ready",
        blockers: [],
        failures: [],
      }),
    );

    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "xbox_price_story",
          title: "Xbox Console Prices Just Became The Trust Test",
          artifact_dir: priceDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
        {
          story_id: "direct_motion_story",
          title: "MARVEL Tokon Finally Shows Real Gameplay",
          artifact_dir: directDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
    });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["direct_motion_story"]);
    assert.deepEqual(result.quarantinedRows.map((row) => row.story_id), ["xbox_price_story"]);
    assert.deepEqual(result.quarantinedRows[0].reasons, ["motion_runway_unfit_for_automatic_refill"]);
    const quarantineReport = JSON.parse(await fs.readFile(result.quarantineReportPath, "utf8"));
    assert.equal(quarantineReport.summary.motion_runway_quarantined_story_package_count, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter recognises scalar approved direct media URLs as motion runway", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-scalar-motion-runway-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const artifactDir = path.join(tmp, "echoes_of_aincrad");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
        selected_title: "Echoes Of Aincrad Has A Launch Week Trust Test",
        canonical_subject: "Echoes of Aincrad",
        approved_direct_media_url:
          "https://video.akamai.steamstatic.com/store_trailers/2244210/169832134/hls_264_master.m3u8?t=1781687345",
        narration_script:
          "Echoes of Aincrad is walking into launch week with one awkward question. Steam's trailer shows a clean anime RPG loop, but licensed games live or die on the bit players cannot see in a store page: whether combat still feels good after the first hour. That means Steam's 10 July listing turns this trailer into a trust test: buy into the launch, or wait until players prove it is not just another licensed RPG. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
        freshness_gate: "pass",
        coherence_gate: "pass",
        approved_direct_media_url:
          "https://video.akamai.steamstatic.com/store_trailers/2244210/169832134/hls_264_master.m3u8?t=1781687345",
        direct_media_url_if_available:
          "https://video.akamai.steamstatic.com/store_trailers/2244210/169832134/hls_264_master.m3u8?t=1781687345",
        primary_source: {
          name: "Steam",
          url: "https://store.steampowered.com/app/2244210/Echoes_of_Aincrad/",
          direct_media_url_if_available:
            "https://video.akamai.steamstatic.com/store_trailers/2244210/169832134/hls_264_master.m3u8?t=1781687345",
        },
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
        verdict: "viral_ready",
        blockers: [],
        failures: [],
      }),
    );
    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "steam_echoes_of_aincrad_system_trailer_20260706",
          title: "Echoes Of Aincrad Has A Launch Week Trust Test",
          artifact_dir: artifactDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
    });

    assert.deepEqual(
      result.eligibleRows.map((row) => row.story_id),
      ["steam_echoes_of_aincrad_system_trailer_20260706"],
    );
    assert.deepEqual(result.quarantinedRows, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter keeps official primary source pages as discovery runway", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-official-page-runway-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const artifactDir = path.join(tmp, "wreck-runners");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "wreck-runners",
        canonical_subject: "Wreck Runners",
        selected_title: "Wreck Runners Opens Its Xbox Playtest",
        primary_source: "Xbox Wire",
        primary_source_url:
          "https://news.xbox.com/en-us/2026/07/09/wreck-runners-join-the-xbox-insider-playtest/",
        narration_script:
          "Wreck Runners has a useful Game Pass-style question before launch. Xbox Wire says up to four players can test its co-op extraction loop now. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        story_id: "wreck-runners",
        freshness_gate: "pass",
        coherence_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/07/09/wreck-runners-join-the-xbox-insider-playtest/",
        },
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({ story_id: "wreck-runners", verdict: "viral_ready", blockers: [], failures: [] }),
    );
    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "wreck-runners",
          title: "Wreck Runners Opens Its Xbox Playtest",
          artifact_dir: artifactDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({ storyPackagesPath: packagesPath, outputDir });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["wreck-runners"]);
    assert.deepEqual(result.quarantinedRows, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter lets service stories with official storefront pages enter discovery", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-service-storefront-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const artifactDir = path.join(tmp, "buckshot_game_pass");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "seed_buckshot_game_pass_20260708",
        selected_title: "Buckshot Roulette Just Turned Game Pass Into A Dare",
        canonical_subject: "Buckshot Roulette",
        narration_script:
          "Buckshot Roulette just turned Game Pass into a dare. Xbox Wire says it joined the service today, but the real question is whether a short horror gamble can become the kind of thing friends install instantly. Follow Pulse Gaming so you never miss a beat.",
        official_source_pages: [
          {
            official_source_url: "https://store.steampowered.com/app/2835570/Buckshot_Roulette/",
            source_type: "platform_storefront",
            source_owner: "Steam",
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/07/08/buckshot-roulette-xbox-game-pass/",
          type: "official_platform_news",
        },
        official_source_pages: [
          {
            official_source_url: "https://store.steampowered.com/app/2835570/Buckshot_Roulette/",
            source_type: "platform_storefront",
            source_owner: "Steam",
          },
        ],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: "seed_buckshot_game_pass_20260708",
        verdict: "viral_ready",
        blockers: [],
        failures: [],
      }),
    );
    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "seed_buckshot_game_pass_20260708",
          title: "Buckshot Roulette Just Turned Game Pass Into A Dare",
          artifact_dir: artifactDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
    });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["seed_buckshot_game_pass_20260708"]);
    assert.deepEqual(result.quarantinedRows, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair filter quarantines retro and collector stories without direct motion runway", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-retro-motion-runway-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");
  const collectorDir = path.join(tmp, "mario_64_collectible_story");
  const retrospectiveDir = path.join(tmp, "mario_kart_64_retrospective_story");
  const directDir = path.join(tmp, "retro_direct_motion_story");

  async function writePackage(dir, story) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: story.story_id,
        selected_title: story.title,
        canonical_subject: story.subject,
        narration_script: story.script,
        direct_media_candidates: story.direct_media_candidates || [],
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        story_id: story.story_id,
        freshness_gate: "pass",
        coherence_gate: "pass",
        primary_source: {
          name: story.source_name || "Nintendo Life",
          url: story.source_url || "https://www.nintendolife.com/news/2026/06/story",
        },
        direct_media_candidates: story.direct_media_candidates || [],
        blockers: [],
      }),
    );
    await fs.writeFile(
      path.join(dir, "script_scorecard.json"),
      JSON.stringify({
        story_id: story.story_id,
        verdict: "viral_ready",
        blockers: [],
        failures: [],
      }),
    );
  }

  try {
    await writePackage(collectorDir, {
      story_id: "mario_64_collectible_story",
      title: "Super Mario 64 Film Slides Are A Collector Test",
      subject: "Super Mario 64 film slides",
      script:
        "Super Mario 64 just turned a collector listing into a nostalgia test. The useful question is whether this is gaming history worth owning or scarcity hype. Follow Pulse Gaming so you never miss a beat.",
    });
    await writePackage(retrospectiveDir, {
      story_id: "mario_kart_64_retrospective_story",
      title: "Mario Kart 64 Made The Blueprint",
      subject: "Mario Kart 64",
      script:
        "Mario Kart 64 still matters because it changed the series blueprint. Players still debate whether it defined the formula or whether nostalgia is doing too much work. Follow Pulse Gaming so you never miss a beat.",
    });
    await writePackage(directDir, {
      story_id: "retro_direct_motion_story",
      title: "DOOM The Dark Ages Just Got New Gameplay",
      subject: "DOOM: The Dark Ages",
      source_name: "Bethesda",
      source_url: "https://bethesda.net/en/game/doom-the-dark-ages",
      direct_media_candidates: [
        {
          direct_media_url: "https://videos.example.com/doom-dark-ages-gameplay.mp4",
          source_type: "official_game_website_media_page",
          source_owner: "Bethesda",
        },
      ],
      script:
        "DOOM: The Dark Ages just put more combat on screen. That matters because players can judge shield saw pace, enemy density and whether the medieval turn still feels like DOOM. Follow Pulse Gaming so you never miss a beat.",
    });

    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "mario_64_collectible_story",
          title: "Super Mario 64 Film Slides Are A Collector Test",
          artifact_dir: collectorDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
        {
          story_id: "mario_kart_64_retrospective_story",
          title: "Mario Kart 64 Made The Blueprint",
          artifact_dir: retrospectiveDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
        {
          story_id: "retro_direct_motion_story",
          title: "DOOM The Dark Ages Just Got New Gameplay",
          artifact_dir: directDir,
          blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
    });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["retro_direct_motion_story"]);
    assert.deepEqual(
      result.quarantinedRows.map((row) => row.story_id),
      ["mario_64_collectible_story", "mario_kart_64_retrospective_story"],
    );
    assert.deepEqual(
      result.quarantinedRows.flatMap((row) => row.reasons),
      [
        "motion_runway_unfit_for_automatic_refill",
        "motion_runway_unfit_for_automatic_refill",
      ],
    );
    const quarantineReport = JSON.parse(await fs.readFile(result.quarantineReportPath, "utf8"));
    assert.equal(quarantineReport.summary.motion_runway_quarantined_story_package_count, 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope prioritises direct and official motion runway", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-priority-"));
  const repairDir = path.join(tmp, "repair");

  async function artifact(storyId, manifest) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: manifest.subject,
        selected_title: manifest.title,
        narration_script: `${manifest.subject} has a fresh official update. Follow Pulse Gaming so you never miss a beat.`,
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: manifest.primary_source,
        direct_media_candidates: manifest.direct_media_candidates || [],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    return dir;
  }

  try {
    const mediaOnlyDir = await artifact("media_only_story", {
      subject: "Example Fighter",
      title: "Example Fighter Gets A Media Preview",
      primary_source: {
        name: "IGN",
        url: "https://www.ign.com/articles/example-fighter-preview",
        type: "rss",
      },
    });
    const officialDir = await artifact("official_story", {
      subject: "Example Racer",
      title: "Example Racer Gets An Xbox Wire Update",
      primary_source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/30/example-racer-gameplay/",
        type: "rss",
      },
    });
    const directDir = await artifact("direct_motion_story", {
      subject: "Example Adventure",
      title: "Example Adventure Has Direct Footage",
      primary_source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/30/example-adventure-gameplay/",
        type: "rss",
      },
      direct_media_candidates: [
        {
          direct_media_url: "https://video.fastly.steamstatic.com/store_trailers/123/456/hls_264_master.m3u8",
          source_type: "official_game_site_news_page",
          source_title: "Example Adventure official gameplay",
        },
      ],
    });
    const governanceDir = await artifact("governance_red_story", {
      subject: "Example Console",
      title: "Example Console Deal Has A Governance Block",
      primary_source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/30/example-console-deal/",
        type: "rss",
      },
    });

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "media_only_story",
            artifact_dir: mediaOnlyDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "governance_red_story",
            artifact_dir: governanceDir,
            blockers: ["governance:RED", "footage:v4_motion_blocked"],
          },
          {
            story_id: "official_story",
            artifact_dir: officialDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "direct_motion_story",
            artifact_dir: directDir,
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 2,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["direct_motion_story", "official_story"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["media_only_story", "governance_red_story"],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope spends one slot per canonical story topic", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-topic-dedupe-"));
  const repairDir = path.join(tmp, "repair");

  async function artifact(storyId, subject, title) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: subject,
        canonical_game: subject,
        selected_title: title,
        narration_script: `${subject} has a fresh player-facing update. Follow Pulse Gaming so you never miss a beat.`,
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: `https://news.xbox.com/en-us/2026/07/10/${storyId}/`,
          type: "rss",
        },
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    return dir;
  }

  try {
    const blackFlagOne = await artifact(
      "black_flag_one",
      "Assassin's Creed Black Flag Resynced",
      "Assassin's Creed Black Flag Resynced Faces A Steam Backlash",
    );
    const blackFlagTwo = await artifact(
      "black_flag_two",
      "Ubisoft",
      "Assassin's Creed Black Flag Resynced Faces A Steam Backlash",
    );
    const wreckRunners = await artifact(
      "wreck_runners",
      "Wreck Runners",
      "Wreck Runners Opens A New Xbox Playtest",
    );

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          { story_id: "black_flag_one", artifact_dir: blackFlagOne },
          { story_id: "black_flag_two", artifact_dir: blackFlagTwo },
          { story_id: "wreck_runners", artifact_dir: wreckRunners },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 2,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["black_flag_one", "wreck_runners"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["black_flag_two"],
    );
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    const duplicate = priorityReport.ranked.find((row) => row.story_id === "black_flag_two");
    assert.equal(priorityReport.summary.duplicate_topic_variant_count, 1);
    assert.equal(duplicate.selected_for_attempt, false);
    assert.equal(duplicate.defer_reason, "duplicate_topic_variant");
    assert.equal(duplicate.duplicate_of_story_id, "black_flag_one");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair package filter quarantines repeat or already-public runway stories", async () => {
  const { buildFreshRefillRepairPackageFilter } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-repeat-quarantine-"));
  const packagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");

  try {
    await fs.writeFile(
      packagesPath,
      JSON.stringify([
        {
          story_id: "near_repeat_doom_story",
          title: "Doom The Dark Ages Chain Spear Changes The Fight Again",
          blockers: ["near_repeat_story_cluster:fresh_doom_chain_spear_dlc_20260703"],
        },
        {
          story_id: "already_public_story",
          title: "Game Pass July Wave Already Went Live",
          blockers: ["already_has_public_platform_id:youtube_post_id"],
        },
        {
          story_id: "fresh_new_story",
          title: "Marathon Durandal Has A New Player Test",
          blockers: ["footage:v4_motion_blocked"],
        },
      ]),
    );

    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath: packagesPath,
      outputDir,
    });

    assert.deepEqual(result.eligibleRows.map((row) => row.story_id), ["fresh_new_story"]);
    assert.deepEqual(
      result.quarantinedRows.map((row) => row.story_id),
      ["near_repeat_doom_story", "already_public_story"],
    );
    assert.deepEqual(
      result.quarantinedRows.map((row) => row.reasons[0]),
      ["repeat_or_stale_runway_candidate", "already_public_runway_candidate"],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope defers article-only stories when direct motion runway exists", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-motion-first-"));
  const repairDir = path.join(tmp, "repair");

  async function artifact(storyId, manifest) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: manifest.subject,
        selected_title: manifest.title,
        narration_script: `${manifest.subject} has a fresh official update. Follow Pulse Gaming so you never miss a beat.`,
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: manifest.primary_source,
        direct_media_candidates: manifest.direct_media_candidates || [],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    return dir;
  }

  try {
    const directDir = await artifact("direct_motion_story", {
      subject: "Example Adventure",
      title: "Example Adventure Has Direct Footage",
      primary_source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/07/07/example-adventure-gameplay/",
        type: "rss",
      },
      direct_media_candidates: [
        {
          direct_media_url: "https://video.fastly.steamstatic.com/store_trailers/123/456/hls_264_master.m3u8",
          source_type: "official_game_site_news_page",
          source_title: "Example Adventure official gameplay",
        },
      ],
    });
    const articleOnlyDir = await artifact("article_only_story", {
      subject: "Example Racer",
      title: "Example Racer Gets An Article Update",
      primary_source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/07/example-racer-update/",
        type: "rss",
      },
    });

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "article_only_story",
            artifact_dir: articleOnlyDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "direct_motion_story",
            artifact_dir: directDir,
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 2,
      requireDirectMotionRunway: true,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["direct_motion_story"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["article_only_story"],
    );
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    assert.equal(priorityReport.summary.motion_runway_required_for_attempt, true);
    assert.equal(priorityReport.summary.motion_runway_deferred_count, 1);
    assert.deepEqual(
      priorityReport.ranked.map((row) => ({
        story_id: row.story_id,
        selected_for_attempt: row.selected_for_attempt,
        defer_reason: row.defer_reason,
      })),
      [
        {
          story_id: "direct_motion_story",
          selected_for_attempt: true,
          defer_reason: null,
        },
        {
          story_id: "article_only_story",
          selected_for_attempt: false,
          defer_reason: "source_motion_first_required",
        },
      ],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope treats official YouTube references as source proof, not motion runway", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-youtube-proof-"));
  const repairDir = path.join(tmp, "repair");
  const artifactDir = path.join(tmp, "youtube_reference_story");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "youtube_reference_story",
        canonical_subject: "Example Direct",
        selected_title: "Example Direct Has Official Footage Proof",
        narration_script:
          "Example Direct has an official trailer reference, but the scheduler still needs materialised motion. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Nintendo",
          url: "https://www.nintendo.com/us/whatsnew/example-direct/",
          type: "official_game_site_news_page",
        },
        direct_media_candidates: [
          {
            direct_media_url: "https://www.youtube.com/watch?v=OfficialExample",
            source_type: "official_youtube_reference",
            source_title: "Example Direct official trailer",
            segment_validation_eligible: false,
            segment_validation_ineligible_reason: "segment_source_is_youtube_reference",
          },
        ],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "youtube_reference_story",
            artifact_dir: artifactDir,
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 1,
      requireDirectMotionRunway: true,
      allowOfficialSourceDiscoveryWithoutRunway: false,
      repairDir,
    });

    assert.deepEqual(result.storyPackageRows.map((row) => row.story_id), []);
    assert.deepEqual(result.repairDeferredByLimitRows.map((row) => row.story_id), [
      "youtube_reference_story",
    ]);
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    const row = priorityReport.ranked.find((entry) => entry.story_id === "youtube_reference_story");
    assert.equal(row.has_direct_motion_runway, false);
    assert.equal(row.defer_reason, "source_motion_first_required");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope can select official source stories for discovery when no direct runway exists", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-discovery-first-"));
  const repairDir = path.join(tmp, "repair");

  async function artifact(storyId, manifest) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: manifest.subject,
        selected_title: manifest.title,
        narration_script: `${manifest.subject} has a fresh official update. Follow Pulse Gaming so you never miss a beat.`,
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: manifest.primary_source,
        direct_media_candidates: [],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    return dir;
  }

  try {
    const xboxDir = await artifact("xbox_article_story", {
      subject: "Pit of Goblin",
      title: "Pit Of Goblin Lets Xbox Insiders Test The Pitch",
      primary_source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/07/07/pit-of-goblin-xbox-insiders/",
        type: "rss",
      },
    });
    const pcgamerDir = await artifact("pcgamer_article_story", {
      subject: "Bethesda",
      title: "Bethesda Layoffs Put Xbox RPG Trust Under Pressure",
      primary_source: {
        name: "PCGamer",
        url: "https://www.pcgamer.com/gaming-industry/bethesda-game-studios-and-zenimax-hit-hard-by-xbox-layoffs-says-union/",
        type: "rss",
      },
    });

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "pcgamer_article_story",
            artifact_dir: pcgamerDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "xbox_article_story",
            artifact_dir: xboxDir,
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 9,
      requireDirectMotionRunway: true,
      allowOfficialSourceDiscoveryWithoutRunway: true,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["xbox_article_story"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["pcgamer_article_story"],
    );
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    assert.equal(priorityReport.summary.motion_runway_required_for_attempt, true);
    assert.equal(priorityReport.summary.motion_runway_deferred_count, 1);
    const selected = priorityReport.ranked.find((row) => row.story_id === "xbox_article_story");
    assert.equal(selected.selected_for_attempt, true);
    assert.equal(selected.defer_reason, "official_source_discovery_required");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope can select major-media trailer stories for official media discovery", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-major-trailer-"));
  const repairDir = path.join(tmp, "repair");

  async function artifact(storyId, manifest) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: manifest.subject,
        selected_title: manifest.title,
        narration_script: `${manifest.subject} has a fresh trailer update. Follow Pulse Gaming so you never miss a beat.`,
      }),
    );
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: manifest.primary_source,
        direct_media_candidates: [],
        freshness_gate: "pass",
        coherence_gate: "pass",
        blockers: [],
      }),
    );
    return dir;
  }

  try {
    const trailerDir = await artifact("major_trailer_story", {
      subject: "Ninja Gaiden 4",
      title: "Ninja Gaiden 4 Gameplay Trailer Gives Fans Their First Look",
      primary_source: {
        name: "IGN",
        url: "https://www.ign.com/articles/ninja-gaiden-4-gameplay-trailer-first-look",
        type: "rss",
      },
    });
    const filmTrailerDir = await artifact("major_film_trailer_story", {
      subject: "Dune Part Three",
      title: "Dune Part Three Trailer Gives Fans Their First Look",
      primary_source: {
        name: "Polygon",
        url: "https://www.polygon.com/movies/dune-part-three-trailer-first-look",
        type: "rss",
      },
    });
    const genericDir = await artifact("major_generic_story", {
      subject: "Bethesda",
      title: "Bethesda Layoffs Put Xbox RPG Trust Under Pressure",
      primary_source: {
        name: "PCGamer",
        url: "https://www.pcgamer.com/gaming-industry/bethesda-game-studios-and-zenimax-hit-hard-by-xbox-layoffs-says-union/",
        type: "rss",
      },
    });

    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "major_generic_story",
            artifact_dir: genericDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "major_trailer_story",
            artifact_dir: trailerDir,
            blockers: ["footage:v4_motion_blocked"],
          },
          {
            story_id: "major_film_trailer_story",
            artifact_dir: filmTrailerDir,
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 9,
      requireDirectMotionRunway: true,
      allowOfficialSourceDiscoveryWithoutRunway: true,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["major_trailer_story"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["major_generic_story", "major_film_trailer_story"],
    );
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    const selected = priorityReport.ranked.find((row) => row.story_id === "major_trailer_story");
    const deferred = priorityReport.ranked.find((row) => row.story_id === "major_generic_story");
    const filmTrailer = priorityReport.ranked.find((row) => row.story_id === "major_film_trailer_story");
    assert.equal(selected.source_type, "major_media_trailer_or_reveal_discovery");
    assert.equal(selected.selected_for_attempt, true);
    assert.equal(selected.defer_reason, "official_source_discovery_required");
    assert.equal(deferred.source_type, null);
    assert.equal(deferred.selected_for_attempt, false);
    assert.equal(filmTrailer.source_type, null);
    assert.equal(filmTrailer.selected_for_attempt, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill repair attempt scope treats local video clips as direct motion runway", async () => {
  const { freshRefillRepairAttemptScope } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-local-clip-runway-"));
  const repairDir = path.join(tmp, "repair");

  try {
    const result = await freshRefillRepairAttemptScope({
      packageFilter: {
        eligibleRows: [
          {
            story_id: "local_clip_story",
            title: "Switch 2 Storage Has A Real Player Problem",
            blockers: ["footage:v4_motion_blocked"],
            video_clips: JSON.stringify([
              {
                path: "C:\\pulse\\output\\video_cache\\switch_2_storage_clip.mp4",
                source_type: "youtube_official_trailer",
              },
            ]),
          },
          {
            story_id: "article_only_story",
            title: "Switch 2 Storage Has A Retail Problem",
            blockers: ["footage:v4_motion_blocked"],
          },
        ],
        eligibleStoryPackagesPath: path.join(tmp, "eligible.json"),
      },
      repairStoryLimit: 2,
      requireDirectMotionRunway: true,
      repairDir,
    });

    assert.deepEqual(
      result.storyPackageRows.map((row) => row.story_id),
      ["local_clip_story"],
    );
    assert.deepEqual(
      result.repairDeferredByLimitRows.map((row) => row.story_id),
      ["article_only_story"],
    );
    const priorityReport = JSON.parse(await fs.readFile(result.repairPriorityReportPath, "utf8"));
    const selected = priorityReport.ranked.find((row) => row.story_id === "local_clip_story");
    assert.equal(selected.has_direct_motion_runway, true);
    assert.equal(selected.direct_media_candidate_count, 1);
    assert.equal(selected.selected_for_attempt, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill under-supported motion summary marks one-family stories as deferred", async () => {
  const { summarizeFreshRefillUnderSupportedMotion } = require("../../lib/job-handlers");

  const report = {
    summary: {
      materialized_story_count: 0,
      blocked_story_count: 1,
    },
    jobs: [
      {
        story_id: "flight_sim_story",
        title: "Microsoft Flight Simulator World Update Needs More Motion",
        status: "blocked",
        blockers: [
          "real_motion_family_minimum_not_met",
        ],
        materialized_count: 2,
        distinct_motion_family_count: 2,
        direct_video_motion_family_count: 2,
        partial_evidence_counts_towards_final_render_readiness: false,
      },
      {
        story_id: "ready_story",
        title: "Ready Story",
        status: "materialized",
        blockers: [],
        materialized_count: 6,
        distinct_motion_family_count: 5,
        partial_evidence_counts_towards_final_render_readiness: true,
      },
    ],
  };

  const summary = summarizeFreshRefillUnderSupportedMotion(report);

  assert.equal(summary.under_supported_motion_story_count, 1);
  assert.deepEqual(summary.under_supported_motion_story_ids, ["flight_sim_story"]);
  assert.equal(summary.under_supported_motion_needs_official_family_count, 1);
  assert.equal(summary.under_supported_motion_defer_reason, "insufficient_distinct_official_motion_families");
});

test("fresh refill official source evidence normalises article headlines to game search entities", async () => {
  const { buildFreshRefillOfficialSourceEvidence } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-entity-normalise-"));
  const outputDir = path.join(tmp, "repair");

  async function artifact(storyId, canonical) {
    const dir = path.join(tmp, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "canonical_story_manifest.json"), JSON.stringify(canonical));
    await fs.writeFile(
      path.join(dir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: canonical.primary_source_url,
          type: "rss",
          published_at: "Tue, 07 Jul 2026 09:00:00 +0000",
        },
        direct_media_candidates: [],
        freshness_gate: "pass",
        coherence_gate: "pass",
      }),
    );
    return dir;
  }

  try {
    const pitDir = await artifact("pit-story", {
      story_id: "pit-story",
      canonical_subject: "Enter The Pit",
      canonical_game: "Enter The Pit",
      selected_title: "Enter The Pit Lets Xbox Test Pit Of Goblin",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-us/2026/07/02/enter-the-pit-xbox-insiders-can-play-pit-of-goblin-today/",
      confirmed_claims: ["Enter The Pit: XBOX Insiders Can Play Pit of Goblin Today!"],
      narration_script: "Pit of Goblin just became something Xbox players can test. Follow Pulse Gaming so you never miss a beat.",
    });
    const flightDir = await artifact("flight-story", {
      story_id: "flight-story",
      canonical_subject: "Microsoft Flight Simulator Releases World Update 22",
      canonical_game: "Microsoft Flight Simulator Releases World",
      selected_title: "Flight Simulator Turns Parks Into A Reinstall Test",
      primary_source: "Xbox Wire",
      primary_source_url: "https://www.flightsimulator.com/world-update-22#new_tab",
      confirmed_claims: ["Microsoft Flight Simulator Releases World Update 22: United States National Parks"],
      narration_script: "Microsoft Flight Simulator just turned scenery into a reinstall test. Follow Pulse Gaming so you never miss a beat.",
    });
    const storyPackagesPath = path.join(tmp, "story-packages.json");
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([
        { story_id: "pit-story", artifact_dir: pitDir },
        { story_id: "flight-story", artifact_dir: flightDir },
      ]),
    );

    const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
    const stories = JSON.parse(await fs.readFile(result.candidateStoriesPath, "utf8"));
    assert.deepEqual(
      stories.map((story) => [story.story_id, story.canonical_subject]),
      [
        ["pit-story", "Pit of Goblin"],
        ["flight-story", "Microsoft Flight Simulator"],
      ],
    );
    const entries = JSON.parse(await fs.readFile(result.officialSourceEntriesPath, "utf8"));
    assert.deepEqual(
      entries.map((entry) => [entry.story_id, entry.entity]),
      [
        ["pit-story", "Pit of Goblin"],
        ["flight-story", "Microsoft Flight Simulator"],
      ],
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill official source evidence resolves generic season labels from recorded claims", async () => {
  const { buildFreshRefillOfficialSourceEvidence } = require("../../lib/job-handlers");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-season-entity-"));
  const artifactDir = path.join(tmp, "season-story");
  const storyPackagesPath = path.join(tmp, "story-packages.json");
  const outputDir = path.join(tmp, "repair");

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "season-story",
        canonical_subject: "Season One",
        canonical_game: "Season One",
        selected_title: "Season One Brings The Thieves Guild Back",
        confirmed_claims: [
          "Season One: Return of the Thieves Guild is now live in The Elder Scrolls Online",
        ],
        narration_script:
          "The Elder Scrolls Online just brought the Thieves Guild back into focus. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: "https://www.elderscrollsonline.com/en-us/news/post/70123",
          type: "official_game_site_news_page",
        },
        freshness_gate: "pass",
        coherence_gate: "pass",
      }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([{ story_id: "season-story", artifact_dir: artifactDir }]),
    );

    const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
    const stories = JSON.parse(await fs.readFile(result.candidateStoriesPath, "utf8"));
    const entries = JSON.parse(await fs.readFile(result.officialSourceEntriesPath, "utf8"));
    assert.equal(stories[0].canonical_subject, "The Elder Scrolls Online");
    assert.equal(entries[0].entity, "The Elder Scrolls Online");
    assert.doesNotMatch(entries[0].entity, /^Season One$/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill supplemental search prefers corrected canonical subject over stale canonical game", () => {
  const { freshRefillSupplementalSearchEntity } = require("../../lib/job-handlers");

  assert.equal(
    freshRefillSupplementalSearchEntity({
      canonical_subject: "Pit of Goblin",
      canonical_game: "Enter The Pit",
      selected_title: "Enter The Pit Lets Xbox Test Pit Of Goblin",
    }),
    "Pit of Goblin",
  );
  assert.equal(
    freshRefillSupplementalSearchEntity({
      canonical_subject: "Microsoft Flight Simulator",
      canonical_game: "Microsoft Flight Simulator Releases World",
      selected_title: "Flight Simulator Turns Parks Into A Reinstall Test",
    }),
    "Microsoft Flight Simulator",
  );
});

test("fresh refill supplemental search preserves a colonised game subtitle from the public title", () => {
  const { freshRefillSupplementalSearchEntity } = require("../../lib/job-handlers");

  assert.equal(
    freshRefillSupplementalSearchEntity({
      canonical_subject: "Arknights",
      canonical_game: "Arknights",
      title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
      selected_title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    }),
    "Arknights: Endfield",
  );
});

test("fresh refill official discovery runs from source-family search rows even without accepted source entries", () => {
  const { freshRefillShouldRunOfficialDiscovery } = require("../../lib/job-handlers");

  assert.equal(
    freshRefillShouldRunOfficialDiscovery({
      sourceEvidence: { official_source_entries_count: 0 },
      supplementalOfficialSearchEvidence: {
        existing_entry_count: 0,
        supplemental_entry_count: 0,
        total_entry_count: 0,
      },
      officialSearchTemplate: {
        entries: [
          {
            story_id: "rss_42c92208a8c02a65",
            entity: "GUILTY GEAR -STRIVE-",
            query: "GUILTY GEAR -STRIVE- official gameplay trailer",
            status: "official_search_required",
          },
        ],
      },
    }),
    true,
  );

  assert.equal(
    freshRefillShouldRunOfficialDiscovery({
      sourceEvidence: { official_source_entries_count: 0 },
      supplementalOfficialSearchEvidence: { total_entry_count: 0 },
      officialSearchTemplate: { entries: [] },
    }),
    false,
  );
});

test("fresh refill direct-media intake keeps official YouTube references as source proof only", () => {
  const { mergeFreshRefillDirectMediaIntakeEntries } = require("../../lib/job-handlers");

  const rows = mergeFreshRefillDirectMediaIntakeEntries({
    sourceManifestEntries: [],
    discoveredEntries: [
      {
        story_id: "fresh_flight_sim_story",
        source_family: "flight_sim_update",
        source_type: "official_game_site_news_page",
        official_source_url: "https://www.flightsimulator.com/world-update-22",
        direct_media_url_if_available: "",
      },
      {
        story_id: "fresh_flight_sim_story",
        source_family: "flight_sim_update__youtube_reference",
        source_type: "official_youtube_channel_url",
        official_source_url: "https://www.youtube.com/watch?v=yG-CHF7VHMI",
        direct_media_url_if_available: "",
        segment_validation_eligible: false,
        segment_validation_ineligible_reason: "segment_source_is_youtube_reference",
        evidence_of_officialness: "Embedded by the official Microsoft Flight Simulator source page.",
      },
      {
        story_id: "fresh_flight_sim_story",
        source_family: "flight_sim_update__direct_media",
        source_type: "official_game_site_direct_video",
        official_source_url: "https://www.flightsimulator.com/world-update-22",
        direct_media_url_if_available: "https://cdn.example.com/world-update-22.mp4",
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_type, "official_youtube_channel_url");
  assert.equal(rows[0].segment_validation_eligible, false);
  assert.equal(rows[0].direct_media_url_if_available, "");
  assert.equal(rows[1].direct_media_url_if_available, "https://cdn.example.com/world-update-22.mp4");
});

test("fresh production refill escalates zero yield once without creating a retry loop", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-zero-yield-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const enqueued = [];

  try {
    await fs.mkdir(contractOutDir, { recursive: true });
    await fs.writeFile(storyPackagesPath, JSON.stringify([
      { story_id: "fresh-zero-one", verdict: "RED", blockers: ["footage:v4_motion_blocked"] },
      { story_id: "fresh-zero-two", verdict: "RED", blockers: ["script:rewrite_required"] },
    ]));
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main() {
          return {
            batch: { summary: { story_count: 2, green_count: 0, red_count: 2 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];
    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const context = {
      log() {},
      async buildFreshReviewLocalPromotionIntake() {
        return {
          fresh_source_intake_stories: [
            {
              id: "review-local-alternate",
              title: "A Different Fresh Review Story",
              canonical_game: "Different Fresh Review Story",
              local_promotion_intake_only: true,
              source_published_at: new Date().toISOString(),
              source_url: "https://example.com/review-local-alternate",
              direct_media_candidates: [
                {
                  direct_media_url:
                    "https://cdn.example.com/different-fresh-review-story.mp4",
                  game_title: "Different Fresh Review Story",
                  source_family: "different_fresh_review_story_gameplay",
                },
              ],
              rights_eligibility: {
                eligible: true,
                status: "eligible",
              },
              motion_eligibility: {
                eligible: true,
                status: "eligible",
              },
            },
          ],
        };
      },
      repos: {
        jobs: {
          enqueue(row) {
            enqueued.push(row);
            return row;
          },
        },
      },
    };
    const basePayload = {
      limit: 12,
      rss_per_feed: 4,
      out_dir: outDir,
      contract_out_dir: contractOutDir,
      zero_yield_quarantine_path: path.join(
        tmp,
        "runtime",
        "zero-yield-quarantine.json",
      ),
      repair_evidence: false,
      skip_existing_ready: false,
      post_discord_on_zero_yield: false,
    };

    const first = await mockedHandlers.fresh_production_refill(
      { id: 901, channel_id: "pulse-gaming", payload: basePayload },
      context,
    );

    assert.equal(first.status, "zero_yield_recovery_enqueued");
    assert.equal(first.green_count, 0);
    assert.equal(first.zero_yield_incident.detected, true);
    assert.equal(first.zero_yield_incident.alternate_refill_enqueued, true);
    assert.deepEqual(
      enqueued.map((row) => row.kind),
      ["fresh_production_refill", "safe_auto_repair_runner", "candidate_supply_monitor"],
    );
    assert.equal(enqueued[0].payload.zero_yield_attempt, 1);
    assert.equal(
      path.resolve(enqueued[0].payload.seed_stories_file),
      path.resolve(first.zero_yield_incident.alternate_cohort_stories_path),
    );
    assert.equal(enqueued[0].payload.reason, "fresh_production_refill_zero_yield_alternate_cohort");
    assert.deepEqual(
      enqueued[0].payload.exclude_story_ids.sort(),
      ["fresh-zero-one", "fresh-zero-two"],
    );
    const alternateStories = JSON.parse(
      await fs.readFile(enqueued[0].payload.seed_stories_file, "utf8"),
    );
    assert.deepEqual(
      alternateStories.map((story) => story.story_id || story.id),
      ["review-local-alternate"],
    );
    assert.equal(first.zero_yield_incident.alternate_cohort_selected_count, 1);
    assert.match(
      first.zero_yield_incident.alternate_cohort_selection_fingerprint,
      /^[a-f0-9]{64}$/,
    );

    enqueued.length = 0;
    const second = await mockedHandlers.fresh_production_refill(
      {
        id: 902,
        channel_id: "pulse-gaming",
        payload: { ...basePayload, zero_yield_attempt: 1 },
      },
      context,
    );

    assert.equal(second.status, "zero_yield_blocked");
    assert.equal(second.zero_yield_incident.alternate_refill_enqueued, false);
    assert.deepEqual(
      enqueued.map((row) => row.kind),
      ["safe_auto_repair_runner", "candidate_supply_monitor"],
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("sequential parent refills durably quarantine a zero-yield source and rotate intake", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-quarantine-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
  const quarantinePath = path.join(tmp, "runtime", "zero-yield-quarantine.json");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const capturedArgs = [];
  const enqueued = [];

  try {
    await fs.mkdir(contractOutDir, { recursive: true });
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          capturedArgs.push([...args]);
          const quarantineArgIndex = args.indexOf("--zero-yield-quarantine");
          const quarantine =
            quarantineArgIndex >= 0
              ? JSON.parse(
                  await fs.readFile(args[quarantineArgIndex + 1], "utf8").catch(() => "{}"),
                )
              : {};
          const failedSourceIsQuarantined = (quarantine.entries || []).some(
            (entry) => (entry.story_ids || []).includes("failed-source-one"),
          );
          const story = failedSourceIsQuarantined
            ? {
                story_id: "fresh-source-two",
                title: "A Different Fresh Story",
                source_url: "https://official.example.com/fresh-source-two",
                source_name: "Official Two",
                verdict: "RED",
                blockers: ["motion:materialisation_pending"],
              }
            : {
                story_id: "failed-source-one",
                title: "The First Failed Story",
                source_url: "https://official.example.com/failed-source-one?utm_source=rss",
                source_name: "Official One",
                verdict: "RED",
                blockers: ["motion:materialisation_pending"],
              };
          await fs.writeFile(storyPackagesPath, JSON.stringify([story]));
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];
    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const context = {
      log() {},
      repos: {
        jobs: {
          enqueue(row) {
            enqueued.push(row);
            return { id: enqueued.length, status: "pending", ...row };
          },
        },
      },
    };
    const payload = {
      limit: 12,
      rss_per_feed: 4,
      out_dir: outDir,
      contract_out_dir: contractOutDir,
      zero_yield_attempt: 1,
      zero_yield_quarantine_path: quarantinePath,
      repair_evidence: false,
      skip_existing_ready: false,
      post_discord_on_zero_yield: false,
    };

    const first = await mockedHandlers.fresh_production_refill(
      { id: 910, channel_id: "pulse-gaming", payload },
      context,
    );
    const second = await mockedHandlers.fresh_production_refill(
      { id: 911, channel_id: "pulse-gaming", payload },
      context,
    );

    assert.equal(first.zero_yield_incident.quarantine.active_entry_count, 1);
    assert.equal(
      path.resolve(first.zero_yield_incident.quarantine.path),
      path.resolve(quarantinePath),
    );
    assert.deepEqual(second.zero_yield_incident.attempted_story_ids, [
      "fresh-source-two",
    ]);
    const secondQuarantineIndex = capturedArgs[1].indexOf(
      "--zero-yield-quarantine",
    );
    assert.notEqual(secondQuarantineIndex, -1);
    assert.equal(
      path.resolve(capturedArgs[1][secondQuarantineIndex + 1]),
      path.resolve(quarantinePath),
    );
    const persisted = JSON.parse(await fs.readFile(quarantinePath, "utf8"));
    assert.ok(
      persisted.entries.some((entry) =>
        entry.story_ids.includes("failed-source-one"),
      ),
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill does not retry the same RSS lane when no alternate cohort exists", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-no-alternate-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const enqueued = [];

  try {
    await fs.mkdir(contractOutDir, { recursive: true });
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([
        {
          story_id: "fresh-zero-primary",
          verdict: "RED",
          blockers: ["footage:v4_motion_blocked"],
        },
      ]),
    );
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main() {
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];
    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        id: 904,
        channel_id: "pulse-gaming",
        payload: {
          limit: 12,
          rss_per_feed: 4,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          zero_yield_quarantine_path: path.join(
            tmp,
            "runtime",
            "zero-yield-quarantine.json",
          ),
          repair_evidence: false,
          skip_existing_ready: false,
          post_discord_on_zero_yield: false,
        },
      },
      {
        log() {},
        async buildFreshReviewLocalPromotionIntake() {
          return { fresh_source_intake_stories: [] };
        },
        repos: {
          jobs: {
            enqueue(row) {
              enqueued.push(row);
              return row;
            },
          },
        },
      },
    );

    assert.equal(result.status, "zero_yield_blocked");
    assert.equal(result.zero_yield_incident.alternate_refill_enqueued, false);
    assert.equal(result.zero_yield_incident.alternate_cohort_selected_count, 0);
    assert.deepEqual(
      enqueued.map((row) => row.kind),
      ["safe_auto_repair_runner", "candidate_supply_monitor"],
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill treats local package GREEN as zero yield when strict scheduler proof is empty", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-strict-zero-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const enqueued = [];

  try {
    await fs.mkdir(contractOutDir, { recursive: true });
    await fs.writeFile(storyPackagesPath, JSON.stringify([
      { story_id: "fresh-local-only", verdict: "GREEN", blockers: [] },
    ]));
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main() {
          return {
            batch: { summary: { story_count: 1, green_count: 1, red_count: 0 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];
    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const context = {
      log() {},
      async buildFreshReviewLocalPromotionIntake() {
        return {
          fresh_source_intake_stories: [
            {
              id: "review-local-strict-alternate",
              title: "A Strict Alternate Review Story",
              canonical_game: "Strict Alternate Review Story",
              local_promotion_intake_only: true,
              source_published_at: new Date().toISOString(),
              source_url: "https://example.com/review-local-strict-alternate",
              direct_media_candidates: [
                {
                  direct_media_url:
                    "https://cdn.example.com/strict-alternate-review-story.mp4",
                  game_title: "Strict Alternate Review Story",
                  source_family: "strict_alternate_review_story_gameplay",
                },
              ],
              rights_eligibility: {
                eligible: true,
                status: "eligible",
              },
              motion_eligibility: {
                eligible: true,
                status: "eligible",
              },
            },
          ],
        };
      },
      async evaluateFreshProductionRefillOutcome(input) {
        assert.equal(input.localPackageGreenCount, 1);
        assert.equal(input.minimumNewGreenCandidates, 3);
        return {
          status: "incident",
          outcome: "zero_strict_green_yield",
          strict_green_count: 0,
          minimum_new_green_candidates: 3,
          shortfall: 3,
          target_met: false,
          attempted_story_ids: ["fresh-local-only"],
          strict_blockers: ["fresh-local-only:rights:incomplete"],
          incident_fingerprint: "strict-zero-fingerprint",
          outputs: {
            incident_report: path.join(contractOutDir, "incident_report.json"),
            incident_blockers: path.join(contractOutDir, "incident_blockers.json"),
          },
          safety: { publish_authorised: false },
        };
      },
      repos: {
        jobs: {
          enqueue(row) {
            enqueued.push(row);
            return row;
          },
        },
      },
    };

    const result = await mockedHandlers.fresh_production_refill(
      {
        id: 903,
        channel_id: "pulse-gaming",
        payload: {
          limit: 12,
          rss_per_feed: 4,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          zero_yield_quarantine_path: path.join(
            tmp,
            "runtime",
            "zero-yield-quarantine.json",
          ),
          repair_evidence: false,
          skip_existing_ready: false,
          source_minimum_new_green_candidates: 3,
          post_discord_on_zero_yield: false,
        },
      },
      context,
    );

    assert.equal(result.status, "zero_yield_recovery_enqueued");
    assert.equal(result.green_count, 0);
    assert.equal(result.local_package_green_count, 1);
    assert.equal(result.strict_outcome.outcome, "zero_strict_green_yield");
    assert.equal(result.zero_yield_incident.detected, true);
    assert.deepEqual(
      enqueued.map((row) => row.kind),
      ["fresh_production_refill", "safe_auto_repair_runner", "candidate_supply_monitor"],
    );
    assert.ok(enqueued.every((row) => row.max_attempts === 1));
    assert.equal(enqueued[2].payload.enqueue_hunt_on_runway_gap, false);
    assert.equal(enqueued[2].payload.enqueue_fresh_review_script_repair, false);
    assert.equal(enqueued[2].payload.enqueue_local_tts_retry_recovery, false);
    assert.equal(enqueued[2].payload.enqueue_fresh_production_refill, false);
    assert.equal(enqueued[2].payload.enqueue_repair_on_amber, false);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill handler builds live-RSS local proof packages", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const artifactDir = path.join(outDir, "fresh_xbox_story");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const capturedArgCalls = [];
  const childCalls = [];
  const events = [];
  let failSegmentValidation = false;

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          capturedArgCalls.push(args);
          const hydratedPass = args.includes("--v4-motion-pack-dir");
          events.push(hydratedPass ? "hydrated_package_generation" : "initial_package_generation");
          const outIndex = args.indexOf("--out-dir");
          const contractIndex = args.indexOf("--contract-out-dir");
          const effectiveOutDir = outIndex >= 0 ? args[outIndex + 1] : outDir;
          const effectiveContractOutDir = contractIndex >= 0 ? args[contractIndex + 1] : contractOutDir;
          const effectiveArtifactDir = path.join(effectiveOutDir, "fresh_xbox_story");
          await fs.mkdir(artifactDir, { recursive: true });
          await fs.mkdir(effectiveArtifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(hydratedPass ? effectiveArtifactDir : artifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "fresh_xbox_story",
              canonical_subject: "Halo Campaign Evolved",
              canonical_game: "Halo Campaign Evolved",
              canonical_title: "Halo Campaign Evolved Demo Lands",
              selected_title: "Halo Campaign Evolved Demo Lands",
              primary_source: "Xbox Wire",
              primary_source_url: "https://news.xbox.com/en-us/2026/06/19/halo-campaign-evolved-demo/",
              source_published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
              narration_script:
                "Halo Campaign Evolved just turned its demo into the real Xbox test. Xbox Wire says players can try the campaign slice today. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(hydratedPass ? effectiveArtifactDir : artifactDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "fresh_xbox_story",
              primary_source: {
                name: "Xbox Wire",
                url: "https://news.xbox.com/en-us/2026/06/19/halo-campaign-evolved-demo/",
                type: "rss",
                published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
                age_hours: 1,
                direct_media_candidates: [
                  {
                    direct_media_url:
                      "https://assets.xbox.com/halo-campaign-evolved/source-manifest-gameplay.mp4",
                    source_title: "Halo Campaign Evolved source-manifest gameplay",
                    source_family: "xbox_source_manifest_halo_campaign_evolved_gameplay",
                    source_type: "official_game_site_news_page",
                  },
                ],
              },
              direct_media_candidates: [
                {
                  direct_media_url:
                    "https://assets.xbox.com/halo-campaign-evolved/source-manifest-gameplay.mp4",
                  source_title: "Halo Campaign Evolved source-manifest gameplay",
                  source_family: "xbox_source_manifest_halo_campaign_evolved_gameplay",
                  source_type: "official_game_site_news_page",
                },
              ],
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          const gamespotDir = path.join(outDir, "fresh_gamespot_story");
          await fs.mkdir(gamespotDir, { recursive: true });
          await fs.writeFile(
            path.join(gamespotDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "fresh_gamespot_story",
              canonical_subject: "Steam Next Fest June 2026",
              canonical_game: "Steam Next Fest June 2026",
              canonical_title: "Steam Next Fest June 2026: Best Demos",
              selected_title: "Steam Next Fest June 2026: Best Demos",
              primary_source: "GameSpot",
              primary_source_url:
                "https://www.gamespot.com/articles/steam-next-fest-june-2026-25-of-the-best-demos-you-can-play-right-now/",
              source_published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
              narration_script:
                "Steam Next Fest has a demo problem players can actually test today. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(gamespotDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "fresh_gamespot_story",
              primary_source: {
                name: "GameSpot",
                url: "https://www.gamespot.com/articles/steam-next-fest-june-2026-25-of-the-best-demos-you-can-play-right-now/",
                type: "rss",
                published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
                age_hours: 1,
              },
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          const genericDir = path.join(outDir, "fresh_generic_story");
          await fs.mkdir(genericDir, { recursive: true });
          await fs.writeFile(
            path.join(genericDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "fresh_generic_story",
              canonical_subject: "GTA 6",
              canonical_game: "GTA 6",
              canonical_title: "Why GTA 6 Could Split Players",
              selected_title: "Why GTA 6 Could Split Players",
              primary_source: "Xbox Wire",
              primary_source_url: "https://news.xbox.com/en-us/2026/06/19/gta-6-demo/",
              source_published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
              narration_script:
                "The hook here is that GTA 6 could split players because this story finally has something specific to judge. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(genericDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "fresh_generic_story",
              primary_source: {
                name: "Xbox Wire",
                url: "https://news.xbox.com/en-us/2026/06/19/gta-6-demo/",
                type: "rss",
                published_at: "Fri, 19 Jun 2026 09:00:00 +0000",
                age_hours: 1,
              },
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          await fs.writeFile(
            path.join(genericDir, "script_scorecard.json"),
            JSON.stringify({
              story_id: "fresh_generic_story",
              verdict: "rewrite_required",
              blockers: [
                "generic_title_template",
                "generic_could_split_title_template",
                "generic_player_test_template",
              ],
            }),
          );
          await fs.writeFile(
            path.join(effectiveContractOutDir, "story-packages.json"),
            JSON.stringify(
              hydratedPass
                ? [
                    {
                      story_id: "fresh_xbox_story",
                      artifact_dir: effectiveArtifactDir,
                      verdict: "GREEN",
                      blockers: [],
                    },
                  ]
                : [
                    {
                      story_id: "fresh_xbox_story",
                      artifact_dir: artifactDir,
                      verdict: "RED",
                      blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
                    },
                    {
                      story_id: "fresh_gamespot_story",
                      artifact_dir: gamespotDir,
                      verdict: "RED",
                      blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
                    },
                    {
                      story_id: "fresh_generic_story",
                      artifact_dir: genericDir,
                      verdict: "RED",
                      blockers: [
                        "script:rewrite_required",
                        "footage:v4_motion_blocked",
                        "director:director_blocked",
                      ],
                    },
                  ],
            ),
          );
          return {
            batch: {
              summary: {
                story_count: hydratedPass ? 1 : 13,
                green_count: hydratedPass ? 1 : 2,
                red_count: hydratedPass ? 0 : 11,
              },
            },
            outputs: {
              storyPackagesPath: path.join(effectiveContractOutDir, "story-packages.json"),
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 12,
          rss_per_feed: 4,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          events.push(options.args[0]);
          childCalls.push(options);
          if (options.args[0] === "tools/official-search-intake-autofill.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) {
              await fs.writeFile(
                templatePath,
                JSON.stringify({
                  schema_version: 1,
                  entries: [
                    {
                      story_id: "fresh_xbox_story",
                      entity: "Halo Campaign Evolved",
                      source_type: "platform_storefront",
                      official_source_url:
                        "https://store.steampowered.com/app/1240440/Halo_Infinite/",
                      source_title: "Halo Infinite",
                      source_owner: "Steam storefront for Halo Infinite",
                      source_family: "steam_1240440_halo_infinite",
                      evidence_of_officialness:
                        "Steam official app matched the story entity strongly enough for media discovery.",
                      entity_match_notes:
                        "Autofilled from official-search template before direct media discovery.",
                      downloads_allowed: false,
                    },
                  ],
                }),
              );
            }
          }
          if (options.args[0] === "tools/official-direct-media-discovery.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) {
              await fs.writeFile(
                templatePath,
                JSON.stringify({
                  schema_version: 1,
                  entries: [
                    {
                      story_id: "fresh_xbox_story",
                      entity: "Halo Campaign Evolved",
                      source_type: "platform_storefront",
                      official_source_url: "https://store.steampowered.com/app/1240440/Halo_Infinite/",
                      direct_media_url_if_available:
                        "https://video.akamai.steamstatic.com/store_trailers/1240440/halo/hls_264_master.m3u8",
                      source_title: "Halo Campaign Evolved Steam trailer",
                      source_owner: "Steam storefront",
                      source_family: "steam_halo_campaign_evolved_discovered",
                      evidence_of_officialness:
                        "Steam storefront direct media discovered during supplemental motion search.",
                      entity_match_notes:
                        "Story entity is Halo Campaign Evolved; direct media URL and official source concern the same story.",
                      source_duration_s: 62,
                      downloads_allowed: false,
                    },
                  ],
                }),
              );
            }
          }
          if (options.args[0] === "tools/studio-v2-build-story-cards.js") {
            const storyId = options.args[options.args.indexOf("--story-id") + 1];
            const repoRoot = path.join(__dirname, "..", "..");
            const testOutputDir = path.join(repoRoot, "test", "output");
            await fs.mkdir(testOutputDir, { recursive: true });
            for (const kind of ["source", "context", "timeline", "quote", "takeaway", "outro"]) {
              const cardPath = path.join(testOutputDir, `hf_${kind}_card_${storyId}.mp4`);
              const sidecarPath = cardPath.replace(/\.[^.]+$/i, ".shell.json");
              await fs.writeFile(cardPath, "fake hyperframes card");
              await fs.writeFile(
                sidecarPath,
                JSON.stringify({
                  schema_version: 1,
                  story_id: storyId,
                  card_kind: kind,
                  channel_id: "pulse-gaming",
                  hyperframes_premium_shell: {
                    status: "pass",
                    shell_type: "story_specific_card",
                    story_id: storyId,
                    card_kind: kind,
                    channel_id: "pulse-gaming",
                    output_path: path.relative(repoRoot, cardPath).replace(/\\/g, "/"),
                    project_dir: `experiments/hf-${kind}-${storyId}`,
                    checks: {
                      lint: { status: "pass" },
                      validate: { status: "pass" },
                      inspect: { status: "pass" },
                      render: { status: "pass" },
                    },
                    visual_identity: {
                      status: "pass",
                      blockers: [],
                      evidence: {
                        vertical_reel_viewport: true,
                        tracked_clip: true,
                        html_path: `experiments/hf-${kind}-${storyId}/index.html`,
                        hyperframes_config_path: `experiments/hf-${kind}-${storyId}/hyperframes.json`,
                      },
                    },
                    animation_contract: {
                      status: "pass",
                      blockers: [],
                      evidence: {
                        timeline_registry: true,
                        paused_gsap_timeline: true,
                        main_timeline_registered: true,
                        timeline_animation_steps: 4,
                      },
                    },
                    readability_contract: {
                      status: "pass",
                      blockers: [],
                      evidence: {
                        readable_text: `${kind} card readable proof for ${storyId}`,
                        word_count: 6,
                        planned_visible_duration_s: 12,
                        minimum_visible_duration_s: 12,
                        min_readable_card_duration_s: 12,
                        max_readable_card_duration_s: 14,
                      },
                    },
                    blockers: [],
                  },
                }),
              );
            }
          }
          if (options.args[0] === "tools/official-trailer-segment-validator.js") {
            if (failSegmentValidation) {
              return {
                ok: false,
                exit_code: 2,
                signal: null,
                timed_out: false,
                stdout_tail: "",
                stderr_tail: "reference validation failed",
              };
            }
            const reportJsonIndex = options.args.indexOf("--report-json");
            const reportJsonPath = reportJsonIndex >= 0 ? options.args[reportJsonIndex + 1] : null;
            if (reportJsonPath) {
              await fs.mkdir(path.dirname(reportJsonPath), { recursive: true });
              await fs.writeFile(
                reportJsonPath,
                JSON.stringify({
                  schema_version: 1,
                  status: "completed",
                  summary: {
                    segments: 8,
                    segments_validated: 8,
                    segments_rejected: 0,
                  },
                  segments: Array.from({ length: 8 }, (_, index) => ({
                    story_id: "fresh_xbox_story",
                    status: "validated",
                    segment_validated: true,
                    allowed_for_flash_lane: true,
                    source_family: `official_halo_motion_${index + 1}`,
                  })),
                }),
              );
            }
          }
          if (options.args[0] === "tools/goal-real-motion-materializer.js") {
            const outDirIndex = options.args.indexOf("--out-dir");
            const motionOutDir = outDirIndex >= 0 ? options.args[outDirIndex + 1] : tmp;
            await fs.mkdir(motionOutDir, { recursive: true });
            await fs.writeFile(
              path.join(motionOutDir, "real_motion_materialization_report.json"),
              JSON.stringify({
                schema_version: 1,
                summary: {
                  materialized_story_count: 1,
                  materialized_clip_count: 8,
                  failed_story_count: 0,
                },
                jobs: [
                  {
                    story_id: "fresh_xbox_story",
                    status: "materialized",
                    materialized_count: 8,
                    direct_video_motion_family_count: 5,
                    blockers: [],
                  },
                  {
                    story_id: "fresh_gamespot_story",
                    status: "blocked",
                    materialized_count: 3,
                    direct_video_motion_family_count: 3,
                    blockers: ["real_motion_clip_minimum_not_met"],
                  },
                ],
              }),
            );
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.deepEqual(capturedArgCalls[0], [
      "--live-rss",
      "--live-rss-only",
      "--rss-per-feed",
      "4",
      "--limit",
      "12",
      "--out-dir",
      outDir,
      "--contract-out-dir",
      contractOutDir,
      "--zero-yield-quarantine",
      path.join(process.cwd(), "output", "runtime", "refill-zero-yield-quarantine.json"),
    ]);
    assert.deepEqual(capturedArgCalls[1], [
      "--stories-file",
      path.join(
        contractOutDir,
        "fresh_production_refill_repair",
        "official_source_candidate_stories.json",
      ),
      "--limit",
      "12",
      "--out-dir",
      path.join(outDir, "motion-hydrated"),
      "--contract-out-dir",
      path.join(contractOutDir, "motion-hydrated"),
      "--zero-yield-quarantine",
      path.join(process.cwd(), "output", "runtime", "refill-zero-yield-quarantine.json"),
      "--v4-motion-pack-dir",
      path.join(__dirname, "..", "..", "output", "studio-v4", "motion-packs"),
      "--allow-owned-motion-fallback",
      "--existing-artifact-root",
      outDir,
      "--story-id",
      "fresh_xbox_story",
    ]);
    assert.equal(result.status, "completed");
    assert.equal(result.story_count, 1);
    assert.equal(result.green_count, 1);
    assert.equal(result.red_count, 0);
    assert.equal(result.safety.local_only, true);
    assert.equal(result.safety.no_publish, true);
    assert.equal(
      result.outputs.storyPackagesPath,
      path.join(contractOutDir, "motion-hydrated", "story-packages.json"),
    );
    assert.equal(result.repair_evidence.status, "generated");
    assert.equal(result.repair_evidence.official_source_entries_count, 1);
    assert.equal(result.repair_evidence.child_processes.length, 11);
    assert.equal(result.motion_hydrated_refill.status, "completed");
    assert.equal(result.motion_hydrated_refill.green_count, 1);
    assert.match(result.motion_hydrated_refill.outputs.storyPackagesPath, /motion-hydrated[\\/]story-packages\.json$/);
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/studio-v4-motion-pack.js"),
      "expected fresh refill to create a V4 motion-pack repair index",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/studio-v4-source-family-acquisition.js"),
      "expected fresh refill to create a source-family repair report",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/official-search-intake-autofill.js"),
      "expected fresh refill to autofill official search rows before direct media discovery",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/official-direct-media-discovery.js"),
      "expected fresh refill to probe official source pages for direct media",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/official-trailer-reference-resolver.js"),
      "expected fresh refill to create trailer reference evidence",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/studio-v4-licensed-direct-media.js"),
      "expected fresh refill to promote official direct media into licensed-direct-media evidence",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/official-trailer-segment-validator.js"),
      "expected fresh refill to locally validate direct-media segment windows",
    );
    const segmentValidatorCall = childCalls.find(
      (call) => call.args[0] === "tools/official-trailer-segment-validator.js",
    );
    assert.equal(
      segmentValidatorCall.args.includes("--no-reference-duration-probe"),
      false,
      "fresh refill must probe unknown direct-media durations so short official clips are sampled on-timeline",
    );
    assert.equal(
      segmentValidatorCall.args[segmentValidatorCall.args.indexOf("--reference-duration-probe-timeout-ms") + 1],
      "10000",
      "fresh refill duration probes must remain individually bounded",
    );
    assert.equal(
      segmentValidatorCall.args[segmentValidatorCall.args.indexOf("--max-reference-duration-probes") + 1],
      "12",
      "fresh refill duration probes must remain batch-bounded",
    );
    assert.equal(
      segmentValidatorCall.args[segmentValidatorCall.args.indexOf("--max-segments") + 1],
      "96",
      "fresh refill should use a bounded wider scan so motion-rich official sources can satisfy no-repeat gates",
    );
    assert.equal(
      segmentValidatorCall.args[segmentValidatorCall.args.indexOf("--candidate-windows-per-source") + 1],
      "4",
      "fresh refill should inspect enough windows per source to find usable non-repeating motion before timeout",
    );
    assert.equal(
      segmentValidatorCall.args.includes("--include-frame-anchored-windows"),
      true,
      "fresh refill should include frame-anchored windows while downstream no-repeat gates prevent clip reuse",
    );
    assert.ok(
      childCalls.filter((call) => call.args[0] === "tools/studio-v4-motion-pack.js").length >= 2,
      "expected fresh refill to rebuild V4 motion packs after segment validation",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-real-motion-materializer.js"),
      "expected fresh refill to materialise validated official motion before hydrating packages",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-owned-motion-materializer.js"),
      "expected under-supported stories to enter the strict owned-motion fallback lane",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/studio-v2-build-story-cards.js"),
      "expected fresh refill to build story-specific HyperFrames premium shell cards before hydrating packages",
    );
    const storyCardCall = childCalls.find(
      (call) => call.args[0] === "tools/studio-v2-build-story-cards.js",
    );
    assert.equal(storyCardCall.args[storyCardCall.args.indexOf("--story-id") + 1], "fresh_xbox_story");
    assert.equal(
      storyCardCall.timeoutMs,
      180000,
      "fresh refill HyperFrames card generation must use a bounded per-story timeout so one card build cannot stall the refill worker",
    );
    assert.match(
      storyCardCall.args[storyCardCall.args.indexOf("--story-file") + 1],
      /official_source_candidate_stories\.json$/,
    );
    assert.ok(
      events.indexOf("tools/studio-v2-build-story-cards.js") >= 0 &&
        events.indexOf("tools/studio-v2-build-story-cards.js") <
          events.indexOf("hydrated_package_generation"),
      "expected HyperFrames card evidence before the motion-hydrated package pass",
    );
    const trailerReferenceCall = childCalls.find(
      (call) => call.args[0] === "tools/official-trailer-reference-resolver.js",
    );
    const officialSearchAutofillCall = childCalls.find(
      (call) => call.args[0] === "tools/official-search-intake-autofill.js",
    );
    const autofillMergeIndex = officialSearchAutofillCall.args.indexOf("--merge-input");
    assert.match(
      officialSearchAutofillCall.args[autofillMergeIndex + 1],
      /visual_v4_source_family_intake_template\.json$/,
      "expected autofill to preserve the source-family intake template rows",
    );
    const autofillInputIndex = officialSearchAutofillCall.args.indexOf("--input");
    const officialSearchInput = JSON.parse(
      await fs.readFile(officialSearchAutofillCall.args[autofillInputIndex + 1], "utf8"),
    );
    const officialSearchRows = Array.isArray(officialSearchInput)
      ? officialSearchInput
      : officialSearchInput.entries || officialSearchInput.rows || [];
    assert.ok(
      officialSearchRows.some(
        (row) =>
          row.story_id === "fresh_xbox_story" &&
          row.entity === "Halo Campaign Evolved" &&
          /official gameplay trailer/i.test(row.query || "") &&
          (row.accepted_sources || []).includes("Steam") &&
          (row.accepted_sources || []).includes("official game site") &&
          row.reason === "fresh_refill_motion_variety_deficit",
      ),
      "expected fresh refill to add a supplemental storefront search for motion-starved candidates",
    );
    const directMediaCall = childCalls.find(
      (call) => call.args[0] === "tools/official-direct-media-discovery.js",
    );
    const directMediaInputIndex = directMediaCall.args.indexOf("--input");
    assert.match(
      directMediaCall.args[directMediaInputIndex + 1],
      /official_direct_media_discovery_input\.json$/,
      "expected direct media discovery to consume merged source-manifest and official-search rows",
    );
    const directMediaInputRows = JSON.parse(
      await fs.readFile(directMediaCall.args[directMediaInputIndex + 1], "utf8"),
    );
    assert.ok(
      directMediaInputRows.some((row) => row.direct_media_url_if_available),
      "expected merged direct media discovery input to preserve source-manifest direct media rows",
    );
    assert.ok(
      directMediaInputRows.some(
        (row) => !row.direct_media_url_if_available && row.official_source_url,
      ),
      "expected merged direct media discovery input to preserve official-search rows",
    );
    const maxDirectMediaCandidatesIndex = directMediaCall.args.indexOf("--max-candidates-per-entry");
    assert.equal(
      directMediaCall.args[maxDirectMediaCandidatesIndex + 1],
      "12",
      "expected direct media discovery to carry enough official variants forward for no-repeat motion readiness",
    );
    const intakeArgIndex = trailerReferenceCall.args.indexOf("--official-source-intake-report");
    assert.match(
      trailerReferenceCall.args[intakeArgIndex + 1],
      /official_direct_media_intake_report\.json$/,
      "expected trailer resolver to consume the direct-media intake report, not the article-only intake report",
    );
    const segmentValidationCall = childCalls.find(
      (call) => call.args[0] === "tools/official-trailer-segment-validator.js",
    );
    assert.equal(
      segmentValidationCall.timeoutMs,
      720000,
      "fresh refill segment validation must have enough bounded time to finish official/direct-motion repair for the actual repair lane",
    );
    assert.ok(segmentValidationCall.args.includes("--apply-local"));
    assert.ok(
      segmentValidationCall.args.includes("--no-frame-report"),
      "fresh refill must validate its explicit run-scoped official references without depending on a stale global frame report",
    );
    assert.ok(
      segmentValidationCall.args.includes("--checkpoint-report"),
      "fresh refill must checkpoint segment validation so a timeout cannot leave only stale global evidence",
    );
    assert.ok(segmentValidationCall.args.includes("--deep-scan"));
    assert.equal(
      segmentValidationCall.args.includes("--allow-early-exploratory-windows"),
      true,
      "fresh refill should inspect QA-guarded early gameplay windows in bounded official masters",
    );
    const exploratoryStartsIndex = segmentValidationCall.args.indexOf("--exploratory-starts");
    assert.notEqual(
      exploratoryStartsIndex,
      -1,
      "fresh refill should provide an explicit bounded scan schedule",
    );
    assert.equal(
      segmentValidationCall.args[exploratoryStartsIndex + 1],
      "6,12,18,24,30,36,42,48,54,60",
      "fresh refill should cover early, middle and later official footage without sampling title-card intros",
    );
    assert.equal(segmentValidationCall.args.includes("--include-frame-anchored-windows"), true);
    assert.equal(segmentValidationCall.args.includes("--no-reference-duration-probe"), false);
    assert.equal(
      segmentValidationCall.args[segmentValidationCall.args.indexOf("--reference-duration-probe-timeout-ms") + 1],
      "10000",
    );
    assert.equal(
      segmentValidationCall.args[segmentValidationCall.args.indexOf("--max-reference-duration-probes") + 1],
      "12",
    );
    const reportJsonIndex = segmentValidationCall.args.indexOf("--report-json");
    assert.notEqual(reportJsonIndex, -1, "expected fresh refill to request a run-scoped segment report");
    assert.match(
      segmentValidationCall.args[reportJsonIndex + 1],
      /fresh-refill-segment-validation-.+official_trailer_segment_validation_apply_local\.json$/,
      "expected fresh refill segment validation to write a unique report under the run output root",
    );
    const segmentMaxIndex = segmentValidationCall.args.indexOf("--max-segments");
    assert.equal(
      Number(segmentValidationCall.args[segmentMaxIndex + 1]),
      96,
      "expected fresh refill to keep segment validation bounded while still sampling enough official/direct-motion windows",
    );
    const candidateWindowsIndex = segmentValidationCall.args.indexOf("--candidate-windows-per-source");
    assert.equal(
      Number(segmentValidationCall.args[candidateWindowsIndex + 1]),
      4,
      "expected fresh refill to sample enough windows from official source families before requiring better source material",
    );
    const segmentReferenceArgs = segmentValidationCall.args
      .map((arg, index) => (arg === "--reference-report" ? segmentValidationCall.args[index + 1] : null))
      .filter(Boolean);
    assert.equal(
      segmentReferenceArgs.length,
      2,
      "expected segment validation to merge trailer and licensed direct-media reports",
    );
    assert.match(
      segmentReferenceArgs[0],
      /official_trailer_references_fresh_refill\.json$/,
      "expected segment validation to consume the refreshed trailer reference report",
    );
    assert.match(
      segmentReferenceArgs[1],
      /studio_v4_licensed_direct_media_acquisition\.json$/,
      "expected segment validation to consume the licensed direct-media report",
    );
    const refreshedMotionCall = childCalls
      .filter((call) => call.args[0] === "tools/studio-v4-motion-pack.js")
      .at(-1);
    assert.ok(refreshedMotionCall.args.includes("--segment-report"));
    assert.ok(refreshedMotionCall.args.includes("--trusted-footage-report"));
    const trustedFootageIndex = refreshedMotionCall.args.indexOf("--trusted-footage-report");
    assert.match(
      refreshedMotionCall.args[trustedFootageIndex + 1],
      /official_trailer_references_fresh_refill\.json$/,
      "expected refreshed motion pack to trust the same trailer reference report used for validation",
    );
    const materializerCall = childCalls.find(
      (call) => call.args[0] === "tools/goal-real-motion-materializer.js",
    );
    const workOrderIndex = materializerCall.args.indexOf("--work-order");
    assert.match(
      materializerCall.args[workOrderIndex + 1],
      /fresh_refill_real_motion_work_order\.json$/,
      "expected real-motion materializer to use the fresh refill work-order shell",
    );
    const materializerSegmentIndex = materializerCall.args.indexOf("--segment-report");
    assert.match(
      materializerCall.args[materializerSegmentIndex + 1],
      /fresh-refill-segment-validation-.+official_trailer_segment_validation_apply_local\.json$/,
      "expected real-motion materializer to consume the run-scoped validated segment windows, not stale global state",
    );
    const materializerArtifactRootIndex = materializerCall.args.indexOf("--artifact-root");
    assert.equal(materializerCall.args[materializerArtifactRootIndex + 1], outDir);
    assert.ok(materializerCall.args.includes("--story-id"));
    assert.equal(materializerCall.args[materializerCall.args.indexOf("--story-id") + 1], "fresh_xbox_story");
    assert.equal(
      materializerCall.args[materializerCall.args.indexOf("--min-clips") + 1],
      "6",
      "fresh refill should accept six distinct direct-motion clips so motion-rich candidates do not miss windows solely because two extra clips timed out",
    );
    assert.equal(materializerCall.args[materializerCall.args.indexOf("--min-families") + 1], "5");
    assert.equal(
      materializerCall.args[materializerCall.args.indexOf("--max-clips") + 1],
      "10",
      "fresh refill should retain enough unique direct-motion clips for longer no-repeat Shorts renders",
    );
    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    const repairMarkdown = await fs.readFile(result.repair_evidence.markdown_path, "utf8");
    assert.equal(repairReport.summary.official_source_entries_count, 1);
    assert.equal(repairReport.summary.script_blocked_package_count, 1);
    assert.equal(repairReport.summary.script_rewrite_work_order_count, 1);
    assert.deepEqual(repairReport.summary.quarantined_package_ids, ["fresh_generic_story"]);
    assert.equal(repairReport.summary.direct_media_intake_accepted_count, 2);
    assert.equal(repairReport.summary.direct_media_intake_materializable_accepted_count, 2);
    assert.equal(repairReport.summary.direct_media_intake_reference_only_accepted_count, 0);
    const directMediaIntakeReport = JSON.parse(
      await fs.readFile(repairReport.outputs.direct_media_intake_report, "utf8"),
    );
    const acceptedDirectMediaUrls = directMediaIntakeReport.accepted_entries.map((entry) =>
      entry.direct_media_url_if_available,
    );
    assert.ok(
      acceptedDirectMediaUrls.includes(
        "https://assets.xbox.com/halo-campaign-evolved/source-manifest-gameplay.mp4",
      ),
      "expected fresh refill to preserve source-manifest official direct MP4 rows alongside discovered rows",
    );
    assert.ok(
      acceptedDirectMediaUrls.includes(
        "https://video.akamai.steamstatic.com/store_trailers/1240440/halo/hls_264_master.m3u8",
      ),
      "expected fresh refill to keep newly discovered storefront direct media rows",
    );
    assert.equal(repairReport.summary.child_process_count, 11);
    assert.match(repairMarkdown, /segment validation: validated/i);
    assert.match(repairMarkdown, /real motion materialisation: materialized/i);
    assert.equal(repairReport.summary.real_motion_materialization_status, "materialized");
    assert.equal(repairReport.summary.hyperframes_card_evidence_status, "generated");
    assert.equal(repairReport.summary.hyperframes_card_sets_completed, 1);
    assert.equal(repairReport.summary.hyperframes_card_sets_failed, 0);
    assert.equal(repairReport.summary.hyperframes_card_evidence_blocked_count, 0);
    assert.match(repairReport.outputs.official_search_autofill_report, /official_search_intake_autofill\.json$/);
    assert.match(
      repairReport.outputs.official_search_autofill_template,
      /visual_v4_source_family_intake_template_autofill\.json$/,
    );
    assert.match(repairReport.outputs.direct_media_intake_report, /official_direct_media_intake_report\.json$/);
    assert.match(repairReport.outputs.licensed_direct_media_report, /studio_v4_licensed_direct_media_acquisition\.json$/);
    assert.match(
      repairReport.outputs.segment_validation_report,
      /fresh-refill-segment-validation-.+official_trailer_segment_validation_apply_local\.json$/,
    );
    assert.match(repairReport.outputs.real_motion_materialization_report, /real_motion_materialization_report\.json$/);
    assert.match(repairReport.outputs.hyperframes_card_evidence_report, /fresh_refill_hyperframes_card_evidence\.json$/);
    assert.match(repairReport.outputs.materialized_motion_pack_dir, /output[\\/]studio-v4[\\/]motion-packs$/);
    assert.match(
      repairReport.outputs.script_rewrite_work_order,
      /fresh_refill_script_rewrite_work_order\.json$/,
    );
    assert.match(
      repairReport.outputs.script_rewrite_work_order_markdown,
      /fresh_refill_script_rewrite_work_order\.md$/,
    );
    assert.equal(repairReport.safety.no_publish, true);
    const scriptRewriteWorkOrder = JSON.parse(
      await fs.readFile(repairReport.outputs.script_rewrite_work_order, "utf8"),
    );
    const hyperframesCardEvidence = JSON.parse(
      await fs.readFile(repairReport.outputs.hyperframes_card_evidence_report, "utf8"),
    );
    assert.equal(hyperframesCardEvidence.summary.card_count, 6);
    assert.equal(hyperframesCardEvidence.summary.passing_card_count, 6);
    assert.equal(hyperframesCardEvidence.summary.failing_card_count, 0);
    assert.equal(hyperframesCardEvidence.summary.shortest_planned_visible_duration_s, 12);
    assert.equal(hyperframesCardEvidence.summary.longest_required_visible_duration_s, 12);
    assert.equal(hyperframesCardEvidence.stories[0].cards[0].readability.planned_visible_duration_s, 12);
    assert.deepEqual(scriptRewriteWorkOrder.jobs.map((job) => job.story_id), ["fresh_generic_story"]);
    assert.equal(scriptRewriteWorkOrder.jobs[0].repair_lane, "source_bound_script_rewrite");
    assert.equal(scriptRewriteWorkOrder.jobs[0].safety.no_publish, true);
    assert.equal(scriptRewriteWorkOrder.jobs[0].safety.no_db_mutation, true);
    assert.match(scriptRewriteWorkOrder.jobs[0].current_script, /The hook here is/i);
    assert.ok(
      scriptRewriteWorkOrder.jobs[0].scorecard_blockers.includes("generic_player_test_template"),
      JSON.stringify(scriptRewriteWorkOrder.jobs[0]),
    );
    const candidateStories = JSON.parse(
      await fs.readFile(repairReport.outputs.candidate_stories, "utf8"),
    );
    assert.deepEqual(
      candidateStories.map((story) => story.story_id),
      ["fresh_xbox_story"],
      "only direct-motion attempt stories enter full supplemental motion repair; script-blocked and article-only packages must not",
    );

    failSegmentValidation = true;
    const failureCallStart = childCalls.length;
    const failedResult = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 12,
          rss_per_feed: 4,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          events.push(options.args[0]);
          childCalls.push(options);
          if (options.args[0] === "tools/official-trailer-segment-validator.js") {
            return {
              ok: false,
              exit_code: 2,
              signal: null,
              timed_out: false,
              stdout_tail: "",
              stderr_tail: "reference validation failed",
            };
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );
    const failureCalls = childCalls.slice(failureCallStart);
    const failedRepairReport = JSON.parse(
      await fs.readFile(failedResult.repair_evidence.report_path, "utf8"),
    );
    assert.equal(
      failedRepairReport.summary.real_motion_materialization_status,
      "segment_validation_failed",
    );
    assert.equal(
      failureCalls.some((call) => call.args[0] === "tools/goal-real-motion-materializer.js"),
      false,
      "fresh refill must not launch real-motion materialisation after segment validation fails",
    );
    assert.equal(
      failureCalls.filter((call) => call.args[0] === "tools/studio-v4-motion-pack.js").length,
      1,
      "fresh refill must not launch the post-validation motion-pack refresh after segment validation fails",
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill motion-hydrated args replace original stories file", () => {
  const { hydratedFreshProductionRefillArgs } = require("../../lib/job-handlers");
  const originalStoriesFile = path.join("output", "pending_news.json");
  const repairedStoriesFile = path.join("output", "repair", "official_source_candidate_stories.json");
  const args = hydratedFreshProductionRefillArgs({
    baseArgs: [
      "--stories-file",
      originalStoriesFile,
      "--limit",
      "4",
      "--out-dir",
      path.join("output", "proof"),
      "--contract-out-dir",
      path.join("output", "contract"),
    ],
    candidateStoriesPath: repairedStoriesFile,
    repairMotionPackDir: path.join("output", "studio-v4", "motion-packs"),
    candidateStoryIds: ["fresh_repaired_story"],
    allowOwnedMotionFallback: true,
  });

  assert.equal(args.filter((arg) => arg === "--stories-file").length, 1);
  assert.equal(args[args.indexOf("--stories-file") + 1], repairedStoriesFile);
  assert.equal(args.includes(originalStoriesFile), false);
  assert.equal(
    args[args.indexOf("--contract-out-dir") + 1],
    path.join("output", "contract", "motion-hydrated"),
  );
  assert.equal(args[args.indexOf("--story-id") + 1], "fresh_repaired_story");
});

test("fresh refill official-source evidence deduplicates identical editorial angles before media production", () => {
  const { dedupeFreshRefillOfficialStories } = require("../../lib/job-handlers");
  const stories = [
    {
      id: "black-flag-kotaku",
      story_id: "black-flag-kotaku",
      title: "Black Flag Resynced's Steam Backlash Put Ubisoft On Defence",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      primary_source: "Kotaku",
      primary_source_url: "https://kotaku.com/black-flag-resynced",
    },
    {
      id: "black-flag-xbox",
      story_id: "black-flag-xbox",
      title: "Black Flag Resynced's Steam Backlash Put Ubisoft On Defence",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-us/black-flag-resynced",
    },
    {
      id: "black-flag-rps",
      story_id: "black-flag-rps",
      title: "Black Flag Resynced's Steam Backlash Put Ubisoft On Defence",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      primary_source: "Rock Paper Shotgun",
      primary_source_url: "https://rockpapershotgun.com/black-flag-resynced",
    },
    {
      id: "bethesda-roadmap",
      story_id: "bethesda-roadmap",
      title: "Bethesda's Layoffs Put Fallout 5 Under Pressure",
      canonical_subject: "Bethesda",
      primary_source: "IGN",
      primary_source_url: "https://ign.com/bethesda-layoffs",
    },
  ];

  const result = dedupeFreshRefillOfficialStories(stories);

  assert.deepEqual(result.stories.map((story) => story.story_id), ["black-flag-xbox", "bethesda-roadmap"]);
  assert.deepEqual(result.dropped.map((story) => story.story_id).sort(), ["black-flag-kotaku", "black-flag-rps"]);
  assert.ok(result.dropped.every((story) => story.reason === "duplicate_editorial_angle"));
});

test("fresh production refill continues motion-hydrated stories through audio and final render materialisation", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-continuation-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const capturedArgCalls = [];
  const childCalls = [];
  let hydratedCalls = 0;
  let hydratedArtifactDir = "";
  const strongGtaScript =
    "GTA VI just turned its cover art into a buyer pressure test. Rockstar Newswire revealed the new artwork, and the important bit is what it asks players to believe before the next gameplay trailer arrives. Jason, Lucia and Vice City are being sold as one story fantasy, not just a giant map. That creates the argument: do players pre order on Rockstar trust, or wait until the footage proves what the game actually feels like? If gameplay stays hidden, the cover art becomes the launch campaign's first real risk. Follow Pulse Gaming so you never miss a beat.";
  const publicDescription =
    "Rockstar's GTA VI cover art reveal matters because players can now judge how the pre-order campaign is being framed: Jason, Lucia, Vice City, story trust and whether to buy now or wait for gameplay proof. Source: Rockstar Newswire.";

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          capturedArgCalls.push(args);
          const hydratedPass = args.includes("--v4-motion-pack-dir");
          const outIndex = args.indexOf("--out-dir");
          const contractIndex = args.indexOf("--contract-out-dir");
          const effectiveOutDir = outIndex >= 0 ? args[outIndex + 1] : outDir;
          const effectiveContractOutDir = contractIndex >= 0 ? args[contractIndex + 1] : contractOutDir;
          const artifactDir = path.join(effectiveOutDir, "fresh_gta_vi_story");
          await fs.mkdir(artifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(artifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "fresh_gta_vi_story",
              canonical_subject: "Grand Theft Auto VI",
              canonical_game: "Grand Theft Auto VI",
              canonical_title: "GTA VI Cover Art Turns Into A Pre Order Test",
              selected_title: "GTA VI Cover Art Turns Into A Pre Order Test",
              primary_source: "Rockstar Newswire",
              primary_source_url:
                "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
              source_published_at: "Fri, 26 Jun 2026 09:00:00 +0000",
              description: publicDescription,
              public_description: publicDescription,
              narration_script: strongGtaScript,
              full_script: strongGtaScript,
              tts_script: strongGtaScript,
            }),
          );
          await fs.writeFile(
            path.join(artifactDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "fresh_gta_vi_story",
              primary_source: {
                name: "Rockstar Newswire",
                url:
                  "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
                type: "official_platform_news",
                published_at: "Fri, 26 Jun 2026 09:00:00 +0000",
                age_hours: 1,
                direct_media_candidates: [
                  {
                    direct_media_url: "https://videos.rockstargames.com/gta-vi/cover-art-reveal.mp4",
                    source_type: "official_game_website_media_page",
                    source_title: "Grand Theft Auto VI official cover art reveal",
                    source_owner: "Rockstar Games",
                  },
                ],
              },
              direct_media_candidates: [
                {
                  direct_media_url: "https://videos.rockstargames.com/gta-vi/cover-art-reveal.mp4",
                  source_type: "official_game_website_media_page",
                  source_title: "Grand Theft Auto VI official cover art reveal",
                  source_owner: "Rockstar Games",
                },
              ],
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          await fs.writeFile(
            path.join(artifactDir, "script_scorecard.json"),
            JSON.stringify({
              story_id: "fresh_gta_vi_story",
              verdict: "viral_ready",
              viral_score: 90,
              scores: {
                hook_strength: 82,
                curiosity_gap: 100,
                insight_density: 100,
                source_safety: 86,
                retention_pacing: 82,
              },
              blockers: [],
              warnings: [],
            }),
          );

          if (hydratedPass) {
            hydratedCalls += 1;
            hydratedArtifactDir = artifactDir;
            const audioDir = path.join(tmp, "output", "audio");
            await fs.mkdir(audioDir, { recursive: true });
            const audioPath = path.join(audioDir, "fresh_gta_vi_story.mp3");
            const timestampPath = path.join(audioDir, "fresh_gta_vi_story_timestamps.json");
            await fs.writeFile(audioPath, Buffer.alloc(4096, 2));
            await fs.writeFile(timestampPath, JSON.stringify({ words: [{ word: "GTA", start: 0, end: 0.2 }] }));
            await fs.writeFile(
              path.join(artifactDir, "audio_manifest.json"),
              JSON.stringify({
                narration_audio_path: audioPath,
                word_timestamps_path: timestampPath,
                word_timestamp_source: "local_whisper_word_alignment",
              }),
            );
            const clips = Array.from({ length: 8 }, (_, index) => ({
              path: path.join(artifactDir, `clip-${index + 1}.mp4`),
              source_family: `rockstar_gtavi_trailer_${index + 1}`,
              base_source_family: `rockstar_gtavi_trailer_${index < 3 ? "a" : index < 6 ? "b" : "c"}`,
              media_kind: "direct_video",
              counts_towards_motion_readiness: true,
            }));
            for (const clip of clips) await fs.writeFile(clip.path, Buffer.alloc(2048, 7));
            await fs.writeFile(
              path.join(artifactDir, "materialised_motion_clips.json"),
              JSON.stringify({
                status: "ready",
                clip_count: clips.length,
                distinct_motion_family_count: clips.length,
                direct_video_motion_asset_count: clips.length,
                direct_video_motion_family_count: clips.length,
                clips,
                materialised_clips: clips,
              }),
            );
          }

          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          const hydratedReady = hydratedPass && hydratedCalls > 1;
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: "fresh_gta_vi_story",
                artifact_dir: artifactDir,
                title: "GTA VI Cover Art Turns Into A Pre Order Test",
                public_title: "GTA VI Cover Art Turns Into A Pre Order Test",
                selected_title: "GTA VI Cover Art Turns Into A Pre Order Test",
                canonical_subject: "Grand Theft Auto VI",
                canonical_game: "Grand Theft Auto VI",
                primary_source: "Rockstar Newswire",
                source_name: "Rockstar Newswire",
                primary_source_url:
                  "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
                source_published_at: "Fri, 26 Jun 2026 09:00:00 +0000",
                description: publicDescription,
                public_description: publicDescription,
                full_script: strongGtaScript,
                narration_script: strongGtaScript,
                tts_script: strongGtaScript,
                verdict: hydratedReady ? "GREEN" : "RED",
                blockers: hydratedReady
                  ? []
                  : hydratedPass
                    ? [
                        "audio:narration_audio_missing",
                        "captions:word_timestamps_missing",
                        "render:final_publish_render_missing",
                      ]
                    : ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: {
              summary: {
                story_count: 1,
                green_count: hydratedReady ? 1 : 0,
                red_count: hydratedReady ? 0 : 1,
              },
            },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          rss_per_feed: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          tts_provider_preference: "elevenlabs",
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/goal-audio-timestamp-materializer.js") {
            const timestampPath = path.join(tmp, "output", "audio", "fresh_gta_vi_story_timestamps.json");
            const words = strongGtaScript.split(/\s+/).map((word, index) => ({
              word,
              text: word,
              start: Number((index * 0.18).toFixed(2)),
              end: Number((index * 0.18 + 0.12).toFixed(2)),
            }));
            await fs.writeFile(
              timestampPath,
              JSON.stringify({
                words,
                meta: {
                  text: strongGtaScript,
                  transcript: strongGtaScript,
                  wordTimestampSource: "local_whisper_word_alignment",
                  timestampWhisperAlignment: {
                    repaired: true,
                    strategy: "local_whisper_word_alignment",
                    transcript: strongGtaScript,
                  },
                  ttsPronunciationProfileVersion: TTS_PRONUNCIATION_PROFILE_VERSION,
                },
              }),
            );
            await fs.writeFile(
              path.join(hydratedArtifactDir, "audio_manifest.json"),
              JSON.stringify({
                narration_audio_path: path.join(tmp, "output", "audio", "fresh_gta_vi_story.mp3"),
                word_timestamps_path: timestampPath,
                word_timestamp_source: "local_whisper_word_alignment",
              }),
            );
            await fs.writeFile(
              path.join(hydratedArtifactDir, "captions.srt"),
              "1\n00:00:00,000 --> 00:00:01,000\nGTA VI\n",
            );
            await fs.writeFile(
              path.join(hydratedArtifactDir, "caption_manifest.json"),
              JSON.stringify({
                status: "ready",
                blockers: [],
                checks: {
                  caption_file_present: true,
                  captions_well_formed: true,
                },
              }),
            );
          }
          if (options.args[0] === "tools/goal-production-render-materializer.js") {
            await fs.writeFile(path.join(hydratedArtifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
            await fs.writeFile(
              path.join(hydratedArtifactDir, "render_manifest.json"),
              JSON.stringify({
                renderer: "visual_v4_production",
                final_publish_render: true,
                output_path: path.join(hydratedArtifactDir, "visual_v4_render.mp4"),
                quality_gate_status: "post_render_forensics_passed",
                post_render_forensic_result: "pass",
                post_render_forensic_blockers: [],
              }),
            );
            await fs.writeFile(
              path.join(hydratedArtifactDir, "captions.srt"),
              "1\n00:00:00,000 --> 00:00:01,000\nGTA VI\n",
            );
            await fs.writeFile(
              path.join(hydratedArtifactDir, "caption_manifest.json"),
              JSON.stringify({
                status: "ready",
                blockers: [],
                checks: {
                  caption_file_present: true,
                  captions_well_formed: true,
                },
              }),
            );
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.green_count, 1);
    assert.equal(result.red_count, 0);
    assert.equal(capturedArgCalls.length, 3);
    assert.equal(result.motion_hydrated_refill.green_count, 0);
    assert.equal(result.materialization_continuation.status, "completed");
    assert.equal(result.materialization_continuation.final_green_count, 1);
    assert.equal(result.materialization_continuation.narration_provider_preference, "elevenlabs");
    assert.ok(
      !childCalls.some((call) => call.args[0] === "tools/local-tts-doctor.js"),
      "explicit ElevenLabs refill must not start or prewarm local TTS",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/auto-repair-runner.js"),
      "expected continuation to execute its context-aware safe auto-repair plan before final readiness",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-audio-timestamp-workbench.js"),
      "expected continuation to plan fresh audio/timestamp generation",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-audio-timestamp-materializer.js"),
      "expected continuation to materialise local narration and Whisper timestamps",
    );
    for (const tool of [
      "tools/goal-audio-timestamp-workbench.js",
      "tools/goal-audio-timestamp-materializer.js",
    ]) {
      const call = childCalls.find((entry) => entry.args[0] === tool);
      assert.ok(call, `expected ${tool} child call`);
      assert.equal(call.args[call.args.indexOf("--provider") + 1], "elevenlabs");
    }
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-production-render-materializer.js"),
      "expected continuation to render the final Visual V4 MP4 after audio became ready",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-platform-native-pack-repair.js"),
      "expected continuation to refresh enabled-platform native package evidence",
    );
    assert.equal(result.safety.no_publish, true);
    assert.equal(result.safety.no_db_mutation, true);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill can resume stale motion-hydrated packages after audio materialisation", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-resume-"));
  const artifactDir = path.join(tmp, "goal-proof-batch", "motion-hydrated", "resume-story");
  const contractDir = path.join(tmp, "goal-contract", "motion-hydrated");
  const storyPackagesPath = path.join(contractDir, "story-packages.json");
  const audioDir = path.join(tmp, "audio");
  const childCalls = [];

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(contractDir, { recursive: true });
    await fs.mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, "resume-story.mp3");
    const timestampsPath = path.join(audioDir, "resume-story_timestamps.json");
    await fs.writeFile(audioPath, Buffer.alloc(4096, 2));
    await fs.writeFile(timestampsPath, JSON.stringify({ words: [{ word: "Marvel", start: 0, end: 0.2 }] }));
    await fs.writeFile(
      path.join(artifactDir, "audio_manifest.json"),
      JSON.stringify({
        status: "ready",
        narration_audio_path: audioPath,
        word_timestamps_path: timestampsPath,
        word_timestamp_source: "local_whisper_word_alignment",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "captions.srt"),
      "1\n00:00:00,000 --> 00:00:01,000\nMARVEL Tokon\n",
    );
    await fs.writeFile(
      path.join(artifactDir, "caption_manifest.json"),
      JSON.stringify({
        status: "ready",
        blockers: [],
        checks: {
          caption_file_present: true,
          captions_well_formed: true,
        },
      }),
    );
    const clips = Array.from({ length: 8 }, (_, index) => ({
      path: path.join(artifactDir, `clip-${index + 1}.mp4`),
      source_family: `steam_marvel_tokon_${index + 1}`,
      base_source_family: `steam_marvel_tokon_${index + 1}`,
      media_kind: "direct_video",
      counts_towards_motion_readiness: true,
    }));
    for (const clip of clips) await fs.writeFile(clip.path, Buffer.alloc(2048, 7));
    await fs.writeFile(
      path.join(artifactDir, "materialised_motion_clips.json"),
      JSON.stringify({
        status: "ready",
        clip_count: clips.length,
        distinct_motion_family_count: clips.length,
        direct_video_motion_asset_count: clips.length,
        direct_video_motion_family_count: clips.length,
        clips,
        materialised_clips: clips,
      }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([
        {
          story_id: "resume-story",
          artifact_dir: artifactDir,
          title: "MARVEL Tokon Finally Shows Real Gameplay",
          public_title: "MARVEL Tokon Finally Shows Real Gameplay",
          canonical_subject: "MARVEL Tokon",
          primary_source: "Steam",
          primary_source_url: "https://store.steampowered.com/app/3787240/MARVEL_Tokon_Fighting_Souls/",
          source_published_at: "Mon, 29 Jun 2026 15:00:00 +0000",
          full_script:
            "MARVEL Tokon finally has real gameplay to judge. The important part is not the logo. It is whether the four on four tag chaos stays readable when Magneto, Storm and Black Panther start filling the screen. Follow Pulse Gaming so you never miss a beat.",
          tts_script:
            "MARVEL Tokon finally has real gameplay to judge. The important part is not the logo. It is whether the four on four tag chaos stays readable when Magneto, Storm and Black Panther start filling the screen. Follow Pulse Gaming so you never miss a beat.",
          verdict: "RED",
          blockers: [
            "render:final_publish_render_missing",
            "audio:narration_audio_missing",
            "captions:word_timestamps_missing",
          ],
        },
      ]),
    );

    const result = await handlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          resume_story_packages_path: storyPackagesPath,
          tts_provider_preference: "elevenlabs",
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/goal-production-render-materializer.js") {
            await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 5));
            await fs.writeFile(
              path.join(artifactDir, "render_manifest.json"),
              JSON.stringify({
                renderer: "visual_v4_production",
                final_publish_render: true,
                output_path: path.join(artifactDir, "visual_v4_render.mp4"),
                quality_gate_status: "post_render_forensics_passed",
                post_render_forensic_result: "pass",
                post_render_forensic_blockers: [],
              }),
            );
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.resume_mode, true);
    assert.equal(result.materialization_continuation.status, "completed");
    assert.equal(result.materialization_continuation.summary.audio_story_count, 0);
    assert.equal(result.materialization_continuation.summary.render_ready_story_count, 1);
    assert.deepEqual(result.materialization_continuation.render_story_ids, ["resume-story"]);
    assert.ok(
      !childCalls.some((call) => call.args[0] === "tools/goal-audio-timestamp-materializer.js"),
      "resume must not regenerate narration when audio and timestamps are already present",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-production-render-materializer.js"),
      "resume should render the final Visual V4 MP4 from existing audio and motion evidence",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-platform-native-pack-repair.js"),
      "resume should refresh enabled-platform native package evidence once render proof exists",
    );
    assert.equal(result.safety.no_publish, true);
    assert.equal(result.safety.no_db_mutation, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill resume regenerates stale GTA pronunciation-profile audio", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-resume-gta-profile-"));
  const artifactDir = path.join(tmp, "goal-proof-batch", "motion-hydrated", "gta-profile-story");
  const contractDir = path.join(tmp, "goal-contract", "motion-hydrated");
  const storyPackagesPath = path.join(contractDir, "story-packages.json");
  const childCalls = [];
  const displayScript =
    "PlayStation just made the GTA VI argument simple: Sony says it plays best on PS5. Follow Pulse Gaming so you never miss a beat.";
  const spokenScript =
    "PlayStation just made Rockstar's next Grand Theft Auto argument simple: Sony says it plays best on PlayStation five. Follow Pulse Gaming so you never miss a beat.";

  try {
    await fs.mkdir(path.join(artifactDir, "audio"), { recursive: true });
    await fs.mkdir(contractDir, { recursive: true });
    const audioPath = path.join(artifactDir, "audio", "narration.mp3");
    const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
    const words = spokenScript.split(/\s+/).map((word, index) => ({
      word,
      text: word,
      start: Number((index * 0.18).toFixed(2)),
      end: Number((index * 0.18 + 0.12).toFixed(2)),
    }));
    await fs.writeFile(audioPath, Buffer.alloc(4096, 3));
    await fs.writeFile(
      timestampsPath,
      JSON.stringify({
        words,
        meta: {
          text: spokenScript,
          transcript: spokenScript,
          spoken_text: spokenScript,
          display_text: displayScript,
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            strategy: "local_whisper_word_alignment",
            transcript: spokenScript,
          },
          ttsPronunciationProfileVersion: "gta-safe-next-title-v11",
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "audio_manifest.json"),
      JSON.stringify({
        status: "ready",
        narration_audio_path: "audio/narration.mp3",
        word_timestamps_path: "audio/word_timestamps.json",
        resolved_narration_audio_path: audioPath,
        resolved_word_timestamps_path: timestampsPath,
        word_timestamp_source: "local_whisper_word_alignment",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "captions.srt"),
      "1\n00:00:00,000 --> 00:00:01,000\nGTA VI\n",
    );
    await fs.writeFile(
      path.join(artifactDir, "caption_manifest.json"),
      JSON.stringify({
        status: "ready",
        blockers: [],
        transcript: spokenScript,
        display_text: displayScript,
        word_timestamps_path: "audio/word_timestamps.json",
      }),
    );
    const clips = Array.from({ length: 8 }, (_, index) => ({
      path: path.join(artifactDir, `clip-${index + 1}.mp4`),
      source_family: `rockstar_gta_vi_${index + 1}`,
      base_source_family: `rockstar_gta_vi_${index + 1}`,
      media_kind: "direct_video",
      counts_towards_motion_readiness: true,
    }));
    for (const clip of clips) await fs.writeFile(clip.path, Buffer.alloc(2048, 8));
    await fs.writeFile(
      path.join(artifactDir, "materialised_motion_clips.json"),
      JSON.stringify({
        status: "ready",
        clip_count: clips.length,
        distinct_motion_family_count: clips.length,
        direct_video_motion_asset_count: clips.length,
        direct_video_motion_family_count: clips.length,
        clips,
        materialised_clips: clips,
      }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([
        {
          story_id: "gta-profile-story",
          artifact_dir: artifactDir,
          title: "GTA VI Just Made PS5 The Version To Watch",
          public_title: "GTA VI Just Made PS5 The Version To Watch",
          canonical_subject: "GTA VI",
          canonical_game: "GTA VI",
          primary_source: "PlayStation Blog",
          primary_source_url: "https://blog.playstation.com/example/gta-vi",
          source_published_at: "Mon, 29 Jun 2026 15:00:00 +0000",
          full_script: displayScript,
          narration_script: displayScript,
          tts_script: spokenScript,
          spoken_narration_script: spokenScript,
          verdict: "RED",
          blockers: ["render:final_publish_render_missing"],
        },
      ]),
    );

    const result = await handlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          resume_story_packages_path: storyPackagesPath,
          tts_provider_preference: "elevenlabs",
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/goal-audio-timestamp-materializer.js") {
            const freshPayload = {
              words,
              meta: {
                text: spokenScript,
                transcript: spokenScript,
                spoken_text: spokenScript,
                display_text: displayScript,
                wordTimestampSource: "local_whisper_word_alignment",
                timestampWhisperAlignment: {
                  repaired: true,
                  strategy: "local_whisper_word_alignment",
                  transcript: spokenScript,
                },
                ttsPronunciationProfileVersion: TTS_PRONUNCIATION_PROFILE_VERSION,
              },
            };
            await fs.writeFile(timestampsPath, JSON.stringify(freshPayload));
            await fs.writeFile(
              path.join(artifactDir, "audio_manifest.json"),
              JSON.stringify({
                status: "ready",
                narration_audio_path: "audio/narration.mp3",
                word_timestamps_path: "audio/word_timestamps.json",
                resolved_narration_audio_path: audioPath,
                resolved_word_timestamps_path: timestampsPath,
                word_timestamp_source: "local_whisper_word_alignment",
                timestamp_whisper_alignment: freshPayload.meta.timestampWhisperAlignment,
              }),
            );
          }
          if (options.args[0] === "tools/goal-production-render-materializer.js") {
            await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(4096, 6));
            await fs.writeFile(
              path.join(artifactDir, "render_manifest.json"),
              JSON.stringify({
                renderer: "visual_v4_production",
                final_publish_render: true,
                output_path: path.join(artifactDir, "visual_v4_render.mp4"),
                quality_gate_status: "post_render_forensics_passed",
                post_render_forensic_result: "pass",
                post_render_forensic_blockers: [],
              }),
            );
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.status, "completed");
    assert.equal(result.resume_mode, true);
    assert.deepEqual(result.materialization_continuation.audio_story_ids, ["gta-profile-story"]);
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-audio-timestamp-materializer.js"),
      "stale GTA pronunciation profile must force audio/timestamp regeneration",
    );
    assert.equal(result.materialization_continuation.summary.scheduler_ready_story_count, 1);
    const refreshedTimestamps = JSON.parse(await fs.readFile(timestampsPath, "utf8"));
    assert.equal(refreshedTimestamps.meta.ttsPronunciationProfileVersion, TTS_PRONUNCIATION_PROFILE_VERSION);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill resume rerenders existing MP4s after audio is regenerated", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-rerender-after-audio-"));
  const artifactDir = path.join(tmp, "goal-proof-batch", "motion-hydrated", "gta-existing-render");
  const contractDir = path.join(tmp, "goal-contract", "motion-hydrated");
  const storyPackagesPath = path.join(contractDir, "story-packages.json");
  const childCalls = [];
  const displayScript =
    "GTA VI just gave players one more reason to argue about the launch build. Follow Pulse Gaming so you never miss a beat.";
  const spokenScript =
    "Grand Theft Auto six just gave players one more reason to argue about the launch build. Follow Pulse Gaming so you never miss a beat.";

  try {
    await fs.mkdir(path.join(artifactDir, "audio"), { recursive: true });
    await fs.mkdir(contractDir, { recursive: true });
    const audioPath = path.join(artifactDir, "audio", "narration.mp3");
    const timestampsPath = path.join(artifactDir, "audio", "word_timestamps.json");
    const renderPath = path.join(artifactDir, "visual_v4_render.mp4");
    const words = spokenScript.split(/\s+/).map((word, index) => ({
      word,
      text: word,
      start: Number((index * 0.18).toFixed(2)),
      end: Number((index * 0.18 + 0.12).toFixed(2)),
    }));
    await fs.writeFile(audioPath, Buffer.alloc(4096, 3));
    await fs.writeFile(
      timestampsPath,
      JSON.stringify({
        words,
        meta: {
          text: spokenScript,
          transcript: spokenScript,
          spoken_text: spokenScript,
          display_text: displayScript,
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            strategy: "local_whisper_word_alignment",
            transcript: spokenScript,
          },
          ttsPronunciationProfileVersion: "gta-safe-next-title-v11",
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "audio_manifest.json"),
      JSON.stringify({
        status: "ready",
        narration_audio_path: "audio/narration.mp3",
        word_timestamps_path: "audio/word_timestamps.json",
        resolved_narration_audio_path: audioPath,
        resolved_word_timestamps_path: timestampsPath,
        word_timestamp_source: "local_whisper_word_alignment",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "captions.srt"),
      "1\n00:00:00,000 --> 00:00:01,000\nGTA VI\n",
    );
    await fs.writeFile(
      path.join(artifactDir, "caption_manifest.json"),
      JSON.stringify({
        status: "ready",
        blockers: [],
        transcript: spokenScript,
        display_text: displayScript,
        word_timestamps_path: "audio/word_timestamps.json",
      }),
    );
    const clips = Array.from({ length: 8 }, (_, index) => ({
      path: path.join(artifactDir, `clip-${index + 1}.mp4`),
      source_family: `rockstar_gta_vi_${index + 1}`,
      base_source_family: `rockstar_gta_vi_${index + 1}`,
      media_kind: "direct_video",
      counts_towards_motion_readiness: true,
    }));
    for (const clip of clips) await fs.writeFile(clip.path, Buffer.alloc(2048, 8));
    await fs.writeFile(
      path.join(artifactDir, "materialised_motion_clips.json"),
      JSON.stringify({
        status: "ready",
        clip_count: clips.length,
        distinct_motion_family_count: clips.length,
        direct_video_motion_asset_count: clips.length,
        direct_video_motion_family_count: clips.length,
        clips,
        materialised_clips: clips,
      }),
    );
    await fs.writeFile(renderPath, Buffer.alloc(4096, 4));
    await fs.writeFile(
      path.join(artifactDir, "render_manifest.json"),
      JSON.stringify({
        renderer: "visual_v4_production",
        final_publish_render: true,
        output_path: renderPath,
        rendered_at: "2026-06-01T10:00:00.000Z",
        duration_seconds: 34.04,
        quality_gate_status: "post_render_forensics_passed",
        post_render_forensic_result: "pass",
        post_render_forensic_blockers: [],
      }),
    );
    await fs.writeFile(
      storyPackagesPath,
      JSON.stringify([
        {
          story_id: "gta-existing-render",
          artifact_dir: artifactDir,
          title: "GTA VI Just Made PS5 The Version To Watch",
          public_title: "GTA VI Just Made PS5 The Version To Watch",
          canonical_subject: "GTA VI",
          canonical_game: "GTA VI",
          primary_source: "PlayStation Blog",
          primary_source_url: "https://blog.playstation.com/example/gta-vi",
          source_published_at: "Mon, 29 Jun 2026 15:00:00 +0000",
          full_script: displayScript,
          narration_script: displayScript,
          tts_script: spokenScript,
          spoken_narration_script: spokenScript,
          verdict: "RED",
          blockers: ["audio:stale_tts_pronunciation_profile"],
        },
      ]),
    );

    const result = await handlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          resume_story_packages_path: storyPackagesPath,
          tts_provider_preference: "elevenlabs",
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/goal-audio-timestamp-materializer.js") {
            const outDir = options.args[options.args.indexOf("--out-dir") + 1];
            const freshPayload = {
              words,
              meta: {
                text: spokenScript,
                transcript: spokenScript,
                spoken_text: spokenScript,
                display_text: displayScript,
                wordTimestampSource: "local_whisper_word_alignment",
                timestampWhisperAlignment: {
                  repaired: true,
                  strategy: "local_whisper_word_alignment",
                  transcript: spokenScript,
                },
                ttsPronunciationProfileVersion: TTS_PRONUNCIATION_PROFILE_VERSION,
              },
            };
            await fs.writeFile(timestampsPath, JSON.stringify(freshPayload));
            await fs.writeFile(
              path.join(artifactDir, "audio_manifest.json"),
              JSON.stringify({
                status: "ready",
                narration_audio_path: "audio/narration.mp3",
                word_timestamps_path: "audio/word_timestamps.json",
                resolved_narration_audio_path: audioPath,
                resolved_word_timestamps_path: timestampsPath,
                word_timestamp_source: "local_whisper_word_alignment",
                timestamp_whisper_alignment: freshPayload.meta.timestampWhisperAlignment,
              }),
            );
            await fs.writeFile(
              path.join(outDir, "audio_timestamp_materialization_report.json"),
              JSON.stringify({
                summary: { candidate_count: 2, materialized_count: 1, failed_count: 1 },
                jobs: [
                  {
                    story_id: "gta-existing-render",
                    status: "materialized",
                    provider: "elevenlabs",
                  },
                  {
                    story_id: "other-story",
                    status: "failed",
                    error: "whisper_inserted_asr_words_above_threshold",
                  },
                ],
              }),
            );
            return {
              ok: false,
              stdout_tail: "materialized=1 failed=1",
              stderr_tail: "partial audio materialization",
            };
          }
          if (options.args[0] === "tools/goal-production-render-materializer.js") {
            await fs.writeFile(renderPath, Buffer.alloc(8192, 9));
            await fs.writeFile(
              path.join(artifactDir, "render_manifest.json"),
              JSON.stringify({
                renderer: "visual_v4_production",
                final_publish_render: true,
                output_path: renderPath,
                rendered_at: new Date().toISOString(),
                duration_seconds: 45.88,
                quality_gate_status: "post_render_forensics_passed",
                post_render_forensic_result: "pass",
                post_render_forensic_blockers: [],
              }),
            );
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.status, "partial");
    assert.deepEqual(result.materialization_continuation.audio_story_ids, ["gta-existing-render"]);
    assert.deepEqual(result.materialization_continuation.render_story_ids, ["gta-existing-render"]);
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-audio-timestamp-materializer.js"),
      "stale pronunciation profile must regenerate audio before render proof is trusted",
    );
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/goal-production-render-materializer.js"),
      "existing Visual V4 render must be regenerated after fresh audio/timestamps",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill handler can run from a seeded official story file", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-seed-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const seedStoriesFile = path.join(tmp, "official-direct-media-seeds.json");
  const zeroYieldQuarantinePath = path.join(
    tmp,
    "runtime",
    "zero-yield-quarantine.json",
  );
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const capturedArgCalls = [];

  try {
    await fs.writeFile(seedStoriesFile, JSON.stringify([
      {
        id: "rockstar_gta_vi_cover_art_20260624",
        title: "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight",
        source_name: "Rockstar Newswire",
        primary_source_url:
          "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
        approved_direct_media_url:
          "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
      },
    ]));
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          capturedArgCalls.push(args);
          await fs.mkdir(contractOutDir, { recursive: true });
          const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
          await fs.writeFile(storyPackagesPath, JSON.stringify([
            {
              story_id: "rockstar_gta_vi_cover_art_20260624",
              verdict: "GREEN",
              blockers: [],
              artifact_dir: path.join(outDir, "rockstar_gta_vi_cover_art_20260624"),
            },
          ]));
          return {
            batch: {
              summary: {
                story_count: 1,
                green_count: 1,
                red_count: 0,
              },
            },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(contractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          rss_per_feed: 4,
          seed_stories_file: seedStoriesFile,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          zero_yield_quarantine_path: zeroYieldQuarantinePath,
        },
      },
      {
        log() {},
      },
    );

    assert.deepEqual(capturedArgCalls[0], [
      "--stories-file",
      seedStoriesFile,
      "--limit",
      "1",
      "--out-dir",
      outDir,
      "--contract-out-dir",
      contractOutDir,
      "--zero-yield-quarantine",
      zeroYieldQuarantinePath,
    ]);
    assert.equal(result.status, "completed");
    assert.equal(result.story_count, 1);
    assert.equal(result.green_count, 1);
    assert.equal(result.repair_evidence.status, "not_needed");
    assert.equal(result.safety.no_publish, true);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill plan mode writes repair work orders without heavy child repair", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-plan-mode-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const artifactDir = path.join(outDir, "fresh_plan_story");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const childCalls = [];

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: "fresh_plan_story",
        canonical_title: "Fresh Plan Story Gets Official Gameplay",
        selected_title: "Fresh Plan Story Gets Official Gameplay",
        canonical_game: "Fresh Plan Game",
        primary_source: "PlayStation Blog",
        primary_source_url: "https://blog.playstation.com/fresh-plan-story",
        narration_script: "Fresh Plan Game just got official gameplay with one concrete thing players can judge.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/fresh-plan-story",
          type: "official_platform_newsroom",
          published_at: "2026-06-30T09:30:00.000Z",
          direct_media_candidates: [
            {
              direct_media_url: "https://gmedia.playstation.com/fresh-plan-story/gameplay.mp4",
              source_type: "official_game_website_media_page",
              source_family: "fresh_plan_gameplay",
              source_title: "Fresh Plan Game Gameplay",
              source_owner: "PlayStation",
              official_source_url: "https://blog.playstation.com/fresh-plan-story",
            },
          ],
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({ story_id: "fresh_plan_story", verdict: "viral_ready", blockers: [] }),
    );
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main() {
          await fs.mkdir(contractOutDir, { recursive: true });
          const storyPackagesPath = path.join(contractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: "fresh_plan_story",
                title: "Fresh Plan Story Gets Official Gameplay",
                artifact_dir: artifactDir,
                verdict: "RED",
                blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          repair_evidence_mode: "plan",
          repair_story_limit: 1,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          throw new Error("plan mode must not run heavy child repair");
        },
      },
    );

    assert.equal(result.repair_evidence.status, "planned");
    assert.equal(result.repair_evidence.summary.child_process_count, 0);
    assert.equal(result.repair_evidence.summary.repair_attempt_story_package_count, 1);
    assert.equal(result.motion_hydrated_refill.status, "not_attempted");
    assert.equal(childCalls.length, 0);
    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    assert.match(repairReport.outputs.script_rewrite_work_order, /fresh_refill_script_rewrite_work_order\.json$/);
    assert.match(repairReport.outputs.candidate_stories, /official_source_candidate_stories\.json$/);
    assert.equal(repairReport.summary.official_source_entries_count, 1);
    assert.equal(repairReport.safety.no_publish, true);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill bounds heavy repair evidence to the requested story limit", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-repair-limit-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const childCalls = [];
  const capturedArgCalls = [];

  async function writeStoryPackage(storyId, index) {
    const artifactDir = path.join(outDir, storyId);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_title: `Fresh Limit Story ${index}`,
        selected_title: `Fresh Limit Story ${index}`,
        canonical_game: `Fresh Limit Game ${index}`,
        primary_source: "Xbox Wire",
        primary_source_url: `https://news.xbox.com/en-us/fresh-limit-${index}`,
        narration_script: `Fresh Limit Game ${index} just got a real update with a concrete player impact.`,
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Xbox Wire",
          url: `https://news.xbox.com/en-us/fresh-limit-${index}`,
          type: "official_platform_newsroom",
          published_at: "2026-06-30T09:00:00.000Z",
          direct_media_candidates: [
            {
              direct_media_url: `https://assets.xbox.com/fresh-limit-${index}/gameplay.mp4`,
              source_type: "official_game_website_media_page",
              source_family: `fresh_limit_gameplay_${index}`,
              source_title: `Fresh Limit Game ${index} Gameplay`,
              source_owner: "Xbox",
              official_source_url: `https://news.xbox.com/en-us/fresh-limit-${index}`,
            },
          ],
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: storyId,
        verdict: "viral_ready",
        blockers: [],
      }),
    );
    return {
      story_id: storyId,
      title: `Fresh Limit Story ${index}`,
      artifact_dir: artifactDir,
      verdict: "RED",
      blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
    };
  }

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          capturedArgCalls.push(args);
          const effectiveContractOutDir = args[args.indexOf("--contract-out-dir") + 1] || contractOutDir;
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          if (args.includes("--stories-file")) {
            const selectedStoryIds = [];
            for (let i = 0; i < args.length; i += 1) {
              if (args[i] === "--story-id") {
                selectedStoryIds.push(...String(args[i + 1] || "").split(",").filter(Boolean));
              }
            }
            await fs.writeFile(
              storyPackagesPath,
              JSON.stringify(selectedStoryIds.map((storyId) => ({
                story_id: storyId,
                verdict: "GREEN",
                blockers: [],
                artifact_dir: path.join(outDir, storyId),
              }))),
            );
            return {
              batch: {
                summary: {
                  story_count: selectedStoryIds.length,
                  green_count: selectedStoryIds.length,
                  red_count: 0,
                },
              },
              outputs: { storyPackagesPath },
            };
          }
          const rows = [];
          for (let i = 1; i <= 5; i += 1) {
            rows.push(await writeStoryPackage(`fresh_limit_story_${i}`, i));
          }
          await fs.writeFile(storyPackagesPath, JSON.stringify(rows));
          return {
            batch: {
              summary: {
                story_count: rows.length,
                green_count: 0,
                red_count: rows.length,
              },
            },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 5,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          repair_story_limit: 2,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/official-search-intake-autofill.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          if (options.args[0] === "tools/official-direct-media-discovery.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          if (options.args[0] === "tools/goal-real-motion-materializer.js") {
            const outDirIndex = options.args.indexOf("--out-dir");
            const repairDir = outDirIndex >= 0 ? options.args[outDirIndex + 1] : null;
            if (repairDir) {
              await fs.writeFile(
                path.join(repairDir, "real_motion_materialization_report.json"),
                JSON.stringify({
                  summary: { materialized_story_count: 2, materialized_clip_count: 12 },
                  jobs: [
                    { story_id: "fresh_limit_story_1", status: "materialized" },
                    { story_id: "fresh_limit_story_2", status: "materialized" },
                  ],
                }),
              );
            }
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    assert.equal(result.repair_evidence.summary.repair_eligible_story_package_count, 5);
    assert.equal(result.repair_evidence.summary.repair_attempt_story_package_count, 2);
    assert.equal(result.repair_evidence.summary.repair_deferred_by_limit_count, 3);
    assert.equal(result.repair_evidence.summary.repair_story_limit, 2);
    assert.deepEqual(result.repair_evidence.summary.repair_deferred_by_limit_story_ids, [
      "fresh_limit_story_3",
      "fresh_limit_story_4",
      "fresh_limit_story_5",
    ]);
    assert.match(
      repairReport.outputs.repair_attempt_story_packages,
      /story-packages-motion-repair-attempt-limit-2\.json$/,
    );
    const candidateStories = JSON.parse(await fs.readFile(repairReport.outputs.candidate_stories, "utf8"));
    assert.deepEqual(candidateStories.map((story) => story.story_id), [
      "fresh_limit_story_1",
      "fresh_limit_story_2",
    ]);
    const motionPackCall = childCalls.find((call) => call.args[0] === "tools/studio-v4-motion-pack.js");
    assert.equal(
      motionPackCall.args[motionPackCall.args.indexOf("--stories") + 1],
      repairReport.outputs.repair_attempt_story_packages,
    );
    assert.deepEqual(
      capturedArgCalls[1]
        .filter((arg, index, args) => args[index - 1] === "--story-id")
        .flatMap((value) => String(value).split(",").filter(Boolean)),
      ["fresh_limit_story_1", "fresh_limit_story_2"],
    );
    assert.equal(result.motion_hydrated_refill.green_count, 2);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill full repair auto-applies safe source-bound script rewrites", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-script-auto-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyId = "persona-netflix-story";
  const artifactDir = path.join(outDir, storyId);
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const childCalls = [];

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: "Netflix",
        canonical_game: "Netflix",
        canonical_title: "Netflix Finally Shows Real Gameplay",
        selected_title: "Netflix Finally Shows Real Gameplay",
        primary_source: "Polygon",
        primary_source_url: "https://www.polygon.com/persona-tv-series-netflix-atlus-sega/",
        source_published_at: "Mon, 29 Jun 2026 22:34:57 GMT",
        confirmed_claims: [
          "Netflix is adapting Atlus Persona for new live-action TV series",
        ],
        narration_script:
          "Netflix has a new source detail, but the real question is still what players can do with it. Polygon says Netflix is adapting Persona. The next official detail has to make that choice clear: play now, wait, skip or watch for gameplay. Follow Pulse Gaming so you never miss a beat.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "Polygon",
          url: "https://www.polygon.com/persona-tv-series-netflix-atlus-sega/",
          type: "rss",
          published_at: "Mon, 29 Jun 2026 22:34:57 GMT",
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: storyId,
        verdict: "rewrite_required",
        blockers: [
          "generic_title_template",
          "persuasive_authority_trope",
          "internal_audience_scaffold",
        ],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "coherence_report.json"),
      JSON.stringify({
        result: "fail",
        failures: ["script_coherence:vague_filler:internal_audience_scaffold"],
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "platform_publish_manifest.json"),
      JSON.stringify({
        schema_version: 1,
        story_id: storyId,
        outputs: {
          youtube_shorts: {
            title: "Netflix Finally Shows Real Gameplay",
            description: "Generic description.",
            cover_frame: { headline: "NETFLIX FINALLY SHOWS REAL GAMEPLAY" },
          },
          instagram_reels: {
            caption: "Generic caption.",
            cover_frame: { headline: "NETFLIX FINALLY SHOWS REAL GAMEPLAY" },
          },
          facebook_reels: {
            page_caption: "Generic page caption.",
          },
        },
      }),
    );

    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const effectiveContractOutDir =
            args[args.indexOf("--contract-out-dir") + 1] || contractOutDir;
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: storyId,
                title: "Netflix Finally Shows Real Gameplay",
                artifact_dir: artifactDir,
                verdict: "RED",
                blockers: [
                  "script_scorecard:script_verdict_rewrite_required",
                  "script_scorecard:generic_title_template",
                  "media_house:script_sounds_ai_generic",
                ],
              },
            ]),
          );
          return {
            batch: {
              summary: { story_count: 1, green_count: 0, red_count: 1 },
            },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          repair_story_limit: 1,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.repair_evidence.summary.script_rewrite_apply_status, "completed");
    assert.equal(result.repair_evidence.summary.script_rewrite_applied_count, 1);
    assert.equal(result.repair_evidence.summary.script_rewrite_blocked_count, 0);
    assert.equal(
      result.repair_evidence.summary.repair_eligible_story_package_count,
      0,
      "a source-bound script rewrite without direct motion must not enter heavy motion repair",
    );
    assert.equal(result.repair_evidence.summary.repair_attempt_story_package_count, 0);
    assert.equal(result.repair_evidence.summary.motion_runway_deferred_count, 1);
    assert.equal(result.repair_evidence.summary.script_blocked_package_count, 0);
    assert.equal(result.repair_evidence.summary.script_rewrite_promoted_count, 1);
    assert.ok(
      !childCalls.some((call) => call.args[0] === "tools/studio-v4-motion-pack.js"),
      "repaired scripts without direct media must wait for source-motion-first intake",
    );
    assert.match(
      result.repair_evidence.outputs.script_rewrite_apply_report,
      /fresh_refill_script_rewrite_report\.json$/,
    );

    const manifest = JSON.parse(
      await fs.readFile(path.join(artifactDir, "canonical_story_manifest.json"), "utf8"),
    );
    assert.equal(manifest.public_title, "Netflix Persona Has One Huge Trap");
    assert.match(manifest.narration_script, /^Persona going live-action on Netflix\b/);
    assert.doesNotMatch(manifest.narration_script, /Finally Shows Real Gameplay|new source detail|play now, wait, skip/i);
    assert.equal(manifest.script_repair.no_db_mutation, true);

    const scorecard = JSON.parse(await fs.readFile(path.join(artifactDir, "script_scorecard.json"), "utf8"));
    assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
    assert.deepEqual(scorecard.blockers, []);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill full repair reports source-drift script blockers as replace-story work", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const repoRoot = path.resolve(__dirname, "..", "..");
  const tmp = await fs.mkdtemp(path.join(repoRoot, "test", "output", "pulse-fresh-refill-source-drift-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyId = "rss_456229ed9244c942";
  const artifactDir = path.join(outDir, storyId);
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const childCalls = [];

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, "canonical_story_manifest.json"),
      JSON.stringify({
        story_id: storyId,
        canonical_subject: "Nintendo Switch",
        canonical_title: "Original Nintendo Switch Will Be Discontinued In Europe",
        selected_title: "Switch 2 Screen Rumour Has A Ghosting Test",
        primary_source: "GameSpot",
        primary_source_url:
          "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
        source_title: "Original Nintendo Switch Will Be Discontinued In Europe",
        article_title: "Original Nintendo Switch Will Be Discontinued In Europe",
        description: "Nintendo is discontinuing the original Switch model in Europe.",
        source_published_at: "Tue, 07 Jul 2026 00:18:17 +0000",
        confirmed_claims: [
          "Nintendo is discontinuing the original Switch model in Europe.",
        ],
        narration_script:
          "Switch 2's screen rumour is about the flaw players can actually see. GameSpot says an updated LCD panel may have surfaced online as fans keep pushing for a ghosting fix.",
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "source_manifest.json"),
      JSON.stringify({
        primary_source: {
          name: "GameSpot",
          url: "https://www.gamespot.com/articles/original-nintendo-switch-will-be-discontinued-in-europe/",
          type: "rss",
          published_at: "Tue, 07 Jul 2026 00:18:17 +0000",
          title: "Original Nintendo Switch Will Be Discontinued In Europe",
          description: "Nintendo is discontinuing the original Switch model in Europe.",
        },
      }),
    );
    await fs.writeFile(
      path.join(artifactDir, "script_scorecard.json"),
      JSON.stringify({
        story_id: storyId,
        verdict: "rewrite_required",
        blockers: ["missing_relatable_stakes", "media_house:script_sounds_ai_generic"],
      }),
    );
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const effectiveContractOutDir =
            args[args.indexOf("--contract-out-dir") + 1] || contractOutDir;
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: storyId,
                title: "Switch 2 Screen Rumour Has A Ghosting Test",
                artifact_dir: artifactDir,
                verdict: "RED",
                blockers: [
                  "script_scorecard:script_verdict_rewrite_required",
                  "media_house:script_sounds_ai_generic",
                ],
              },
            ]),
          );
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          repair_story_limit: 1,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    assert.equal(result.repair_evidence.summary.script_rewrite_blocked_count, 1);
    assert.deepEqual(result.repair_evidence.summary.script_rewrite_blocked_reasons, [
      "switch_2_screen_angle_missing_source_support",
      "ghosting_claim_missing_source_support",
      "oled_claim_missing_source_support",
    ]);
    assert.equal(
      result.repair_evidence.outputs.next_action,
      "replace_source_drift_story_with_fresh_supported_story",
    );
    assert.equal(childCalls.length, 0, "source-drift candidates should not enter heavy media repair");

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    assert.deepEqual(
      repairReport.summary.script_rewrite_blocked_reasons,
      result.repair_evidence.summary.script_rewrite_blocked_reasons,
    );
    const markdown = await fs.readFile(result.repair_evidence.markdown_path, "utf8");
    assert.match(markdown, /script rewrite blocked reasons: switch_2_screen_angle_missing_source_support/);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill HyperFrames card generation targets only real-motion materialized stories", async () => {
  const { freshRefillHyperframesStoryIdsAfterMotion } = require("../../lib/job-handlers");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-hyperframes-motion-"));
  try {
    const reportPath = path.join(tmp, "real_motion_materialization_report.json");
    await fs.writeFile(
      reportPath,
      JSON.stringify({
        schema_version: 1,
        summary: {
          materialized_story_count: 1,
          blocked_story_count: 1,
        },
        jobs: [
          {
            story_id: "motion-ready-story",
            status: "materialized",
            materialized_count: 8,
            total_direct_video_motion_family_count: 8,
            blockers: [],
          },
          {
            story_id: "motion-blocked-story",
            status: "blocked",
            materialized_count: 3,
            direct_video_motion_family_count: 3,
            blockers: ["real_motion_clip_minimum_not_met"],
          },
        ],
      }),
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["motion-ready-story", "motion-blocked-story"],
        realMotionReportPath: reportPath,
      }),
      ["motion-ready-story"],
    );

    await fs.writeFile(
      reportPath,
      JSON.stringify({
        schema_version: 1,
        summary: {
          materialized_story_count: 0,
          blocked_story_count: 2,
        },
        jobs: [
          {
            story_id: "motion-blocked-story",
            status: "blocked",
            materialized_count: 3,
            direct_video_motion_family_count: 3,
            blockers: ["real_motion_clip_minimum_not_met"],
          },
        ],
      }),
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["motion-blocked-story"],
        realMotionReportPath: reportPath,
      }),
      [],
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["motion-blocked-story", "unsafe-story"],
        realMotionReportPath: reportPath,
        sourceCardFallbackStoryIds: ["motion-blocked-story", "not-in-candidate-list"],
      }),
      [],
    );

    const motionPackDir = path.join(tmp, "motion-packs");
    await fs.mkdir(motionPackDir, { recursive: true });
    await fs.writeFile(
      path.join(motionPackDir, "motion-blocked-story_motion_pack_manifest.json"),
      JSON.stringify({
        story_id: "motion-blocked-story",
        status: "ready",
        readiness: {
          status: "v4_motion_ready",
          blockers: [],
        },
        clip_count: 6,
        distinct_base_source_family_count: 5,
        clips: Array.from({ length: 6 }, (_, index) => ({
          source_family: `official_trailer_family_${index + 1}`,
          base_source_family: `official_trailer_family_${index + 1}`,
        })),
      }),
    );
    await fs.writeFile(
      path.join(motionPackDir, "still-blocked-story_motion_pack_manifest.json"),
      JSON.stringify({
        story_id: "still-blocked-story",
        status: "ready",
        readiness: {
          status: "v4_motion_blocked",
          blockers: ["distinct_motion_families_minimum_not_met"],
        },
        clip_count: 3,
        distinct_base_source_family_count: 2,
      }),
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["motion-blocked-story", "still-blocked-story"],
        realMotionReportPath: reportPath,
        motionPackDir,
      }),
      ["motion-blocked-story"],
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["legacy-mock-story"],
        realMotionReportPath: path.join(tmp, "missing.json"),
      }),
      ["legacy-mock-story"],
    );

    assert.deepEqual(
      await freshRefillHyperframesStoryIdsAfterMotion({
        candidateStoryIds: ["owned-ready-story", "motion-blocked-story"],
        realMotionReportPath: path.join(tmp, "missing-owned-report.json"),
        ownedMotionReadyStoryIds: ["owned-ready-story"],
      }),
      ["owned-ready-story"],
      "strict owned-motion evidence must advance only the validated story when real-motion evidence is unavailable",
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh refill writes visual-source reject reviews for zero-validated segment stories", async () => {
  const {
    writeFreshRefillVisualSourceReviewsForRejectedSegments,
  } = require("../../lib/job-handlers");
  const { REJECT_DECISION } = require("../../lib/goal-visual-source-review");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-segment-review-"));
  try {
    const artifactDir = path.join(tmp, "story");
    await fs.mkdir(artifactDir, { recursive: true });
    const segmentReportPath = path.join(tmp, "official_trailer_segment_validation_apply_local.json");
    await fs.writeFile(
      segmentReportPath,
      JSON.stringify({
        schema_version: 1,
        summary: {
          segments: 4,
          segments_validated: 0,
          segments_rejected: 4,
        },
        segments: [
          { story_id: "visual-dead-end", status: "rejected", source_family: "official_trailer_a" },
          { story_id: "visual-dead-end", status: "rejected", source_family: "official_trailer_b" },
          { story_id: "other-story", status: "validated", source_family: "official_trailer_c" },
        ],
        safety: {
          no_publish_triggered: true,
          no_db_mutation: true,
        },
      }),
    );

    const result = await writeFreshRefillVisualSourceReviewsForRejectedSegments({
      segmentReportPath,
      storyPackageRows: [
        {
          story_id: "visual-dead-end",
          title: "Visual Dead End",
          artifact_dir: artifactDir,
        },
      ],
      outputDir: tmp,
      generatedAt: "2026-07-07T08:40:00.000Z",
    });

    assert.equal(result.summary.visual_source_review_count, 1);
    assert.equal(result.summary.reject_count, 1);
    assert.equal(result.summary.rejected_segment_story_count, 1);
    const review = JSON.parse(await fs.readFile(path.join(artifactDir, "visual_source_review.json"), "utf8"));
    assert.equal(review.decision, REJECT_DECISION);
    assert.equal(review.story_id, "visual-dead-end");
    assert.ok(review.visual_source_blockers.includes("actual_motion_clip_minimum_not_met"));
    assert.equal(review.safety.no_publish_triggered, true);
    assert.equal(review.safety.no_db_mutation, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill repair preserves Rockstar direct media candidates", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-rockstar-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const artifactDir = path.join(outDir, "rockstar_gta_vi_preorder_cover_art_20260624");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);
  const childCalls = [];

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const outIndex = args.indexOf("--out-dir");
          const contractIndex = args.indexOf("--contract-out-dir");
          const effectiveOutDir = outIndex >= 0 ? args[outIndex + 1] : outDir;
          const effectiveContractOutDir = contractIndex >= 0 ? args[contractIndex + 1] : contractOutDir;
          const effectiveArtifactDir = path.join(effectiveOutDir, "rockstar_gta_vi_preorder_cover_art_20260624");
          await fs.mkdir(effectiveArtifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(effectiveArtifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "rockstar_gta_vi_preorder_cover_art_20260624",
              canonical_subject: "Grand Theft Auto VI",
              canonical_game: "Grand Theft Auto VI",
              canonical_title: "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight",
              selected_title: "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight",
              primary_source: "Rockstar Newswire",
              primary_source_url:
                "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
              narration_script:
                "Rockstar just put Jason and Lucia back at the centre of Grand Theft Auto VI. Rockstar Newswire says the new cover art is live and pre-orders open on June 25. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "rockstar_gta_vi_preorder_cover_art_20260624",
              primary_source: {
                name: "Rockstar Newswire",
                url: "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
                type: "official",
                published_at: "2026-06-24T00:00:00.000Z",
                age_hours: 1,
                direct_media_candidates: [
                  {
                    direct_media_url:
                      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
                    source_title: "Official Cover Art Animation",
                    source_family: "rockstar_gta_vi_cover_art_animation",
                    source_type: "official_game_website_media_page",
                  },
                  {
                    direct_media_url:
                      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
                    source_title: "Grand Theft Auto VI Trailer 2",
                    source_family: "rockstar_gta_vi_trailer_2",
                    source_type: "official_game_website_media_page",
                  },
                  {
                    direct_media_url:
                      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
                    source_title: "Grand Theft Auto VI Trailer 1",
                    source_family: "rockstar_gta_vi_trailer_1",
                    source_type: "official_game_website_media_page",
                  },
                  {
                    direct_media_url:
                      "https://www.rockstargames.com/VI/_next/static/media/2160.06.kcaed--eoc.mp4",
                    source_title: "Rockstar GTA VI official site motion 2160.06.kcaed",
                    source_family: "rockstar_gta_vi_official_site_motion_2160_06_kcaed",
                    source_type: "official_game_website_media_page",
                  },
                  {
                    direct_media_url:
                      "https://www.rockstargames.com/VI/_next/static/media/2160.0.f7p3scjp9hn.mp4",
                    source_title: "Rockstar GTA VI official site motion 2160.0.f7p3",
                    source_family: "rockstar_gta_vi_official_site_motion_2160_0_f7p3",
                    source_type: "official_game_website_media_page",
                  },
                ],
              },
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "script_scorecard.json"),
            JSON.stringify({
              story_id: "rockstar_gta_vi_preorder_cover_art_20260624",
              verdict: "viral_ready",
              blockers: [],
            }),
          );
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: "rockstar_gta_vi_preorder_cover_art_20260624",
                artifact_dir: effectiveArtifactDir,
                verdict: "RED",
                blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: {
              summary: { story_count: 1, green_count: 0, red_count: 1 },
            },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          childCalls.push(options);
          if (options.args[0] === "tools/official-search-intake-autofill.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          if (options.args[0] === "tools/official-direct-media-discovery.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    const entries = JSON.parse(
      await fs.readFile(repairReport.outputs.official_source_entries, "utf8"),
    );
    assert.equal(result.repair_evidence.official_source_entries_count, 5);
    assert.equal(repairReport.summary.official_source_entries_count, 5);
    assert.deepEqual(
      entries.slice(0, 3).map((entry) => entry.source_family),
      [
        "rockstar_newswire_grand_theft_auto_vi_rockstar_gta_vi_preorder_cover_art_20260624_rockstar_gta_vi_cover_art_animation",
        "rockstar_newswire_grand_theft_auto_vi_rockstar_gta_vi_preorder_cover_art_20260624_rockstar_gta_vi_trailer_2",
        "rockstar_newswire_grand_theft_auto_vi_rockstar_gta_vi_preorder_cover_art_20260624_rockstar_gta_vi_trailer_1",
      ],
    );
    const officialSiteFamilies = entries.slice(3).map((entry) => entry.source_family);
    assert.equal(new Set(officialSiteFamilies).size, 2);
    assert.ok(officialSiteFamilies.every((family) => family.length <= 120));
    assert.ok(officialSiteFamilies[0].endsWith("rockstar_gta_vi_official_site_motion_2160_06_kcaed"));
    assert.ok(officialSiteFamilies[1].endsWith("rockstar_gta_vi_official_site_motion_2160_0_f7p3"));
    assert.equal(
      entries.every((entry) => entry.direct_media_provided === true && entry.downloads_allowed === false),
      true,
    );
    const directMediaCall = childCalls.find(
      (call) => call.args[0] === "tools/official-direct-media-discovery.js",
    );
    assert.equal(
      directMediaCall.args[directMediaCall.args.indexOf("--input") + 1],
      repairReport.outputs.official_source_entries,
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill repair uses official direct media from article-sourced packages", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-article-direct-media-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const outIndex = args.indexOf("--out-dir");
          const contractIndex = args.indexOf("--contract-out-dir");
          const effectiveOutDir = outIndex >= 0 ? args[outIndex + 1] : outDir;
          const effectiveContractOutDir = contractIndex >= 0 ? args[contractIndex + 1] : contractOutDir;
          const effectiveArtifactDir = path.join(effectiveOutDir, "rss_gta_vi_article_story");
          await fs.mkdir(effectiveArtifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(effectiveArtifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: "rss_gta_vi_article_story",
              canonical_subject: "Grand Theft Auto VI",
              canonical_game: "Grand Theft Auto VI",
              canonical_title: "GTA VI Launch Details Turn Into A Trust Test",
              selected_title: "GTA VI Launch Details Turn Into A Trust Test",
              primary_source: "GameSpot",
              primary_source_url:
                "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
              narration_script:
                "GTA VI just turned launch wording into a trust test. GameSpot reports the game is being described around its single-player experience at launch. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "source_manifest.json"),
            JSON.stringify({
              story_id: "rss_gta_vi_article_story",
              primary_source: {
                name: "GameSpot",
                url: "https://www.gamespot.com/articles/gta-6-features-a-single-player-experience-at-least-at-launch/",
                type: "rss",
                published_at: "2026-06-24T15:41:17.000Z",
                age_hours: 1,
              },
              direct_media_candidates: [
                {
                  direct_media_url:
                    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
                  source_title: "Official Cover Art Animation",
                  source_family: "rockstar_gta_vi_cover_art_animation",
                  source_type: "official_game_website_media_page",
                  source_owner: "Rockstar Games",
                },
                {
                  direct_media_url:
                    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
                  source_title: "Grand Theft Auto VI Trailer 2",
                  source_family: "rockstar_gta_vi_trailer_2",
                  source_type: "official_game_website_media_page",
                  source_owner: "Rockstar Games",
                },
              ],
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "script_scorecard.json"),
            JSON.stringify({
              story_id: "rss_gta_vi_article_story",
              verdict: "viral_ready",
              blockers: [],
            }),
          );
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: "rss_gta_vi_article_story",
                artifact_dir: effectiveArtifactDir,
                verdict: "RED",
                blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          if (options.args[0] === "tools/official-search-intake-autofill.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          if (options.args[0] === "tools/official-direct-media-discovery.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    const entries = JSON.parse(await fs.readFile(repairReport.outputs.official_source_entries, "utf8"));
    assert.equal(result.repair_evidence.official_source_entries_count, 2);
    assert.equal(repairReport.summary.official_source_entries_count, 2);
    assert.deepEqual(
      entries.map((entry) => entry.source_owner),
      ["Rockstar Games official source", "Rockstar Games official source"],
    );
    assert.equal(
      entries.every((entry) => entry.source_type === "official_game_website_media_page"),
      true,
    );
    assert.equal(
      entries.every((entry) => entry.official_source_url.includes("rockstargames.com")),
      true,
    );
    assert.equal(
      entries.every((entry) => entry.direct_media_provided === true && entry.downloads_allowed === false),
      true,
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill repair does not count accepted reference-only URLs as materializable motion", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-reference-only-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyId = "fresh_halo_campaign_evolved_demo_reference_only";
  const artifactDir = path.join(outDir, storyId);
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const effectiveOutDir = args[args.indexOf("--out-dir") + 1] || outDir;
          const effectiveContractOutDir =
            args[args.indexOf("--contract-out-dir") + 1] || contractOutDir;
          const effectiveArtifactDir = path.join(effectiveOutDir, storyId);
          await fs.mkdir(effectiveArtifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(effectiveArtifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: storyId,
              canonical_subject: "Halo Campaign Evolved",
              canonical_game: "Halo Campaign Evolved",
              canonical_title: "Halo Campaign Evolved Demo Has One Trust Test",
              selected_title: "Halo Campaign Evolved Demo Has One Trust Test",
              primary_source: "Xbox YouTube",
              primary_source_url: "https://www.youtube.com/watch?v=HaloCampaignEvolvedDemo",
              narration_script:
                "Halo Campaign Evolved has a demo problem Xbox can actually prove. The official Xbox channel shows the campaign demo, but the real question is whether this remake feels modern without sanding off the original. Follow Pulse Gaming so you never miss a beat.",
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "source_manifest.json"),
            JSON.stringify({
              story_id: storyId,
              primary_source: {
                name: "Xbox YouTube",
                url: "https://www.youtube.com/watch?v=HaloCampaignEvolvedDemo",
                type: "official",
                published_at: "2026-07-06T12:00:00.000Z",
                age_hours: 4,
              },
              direct_media_candidates: [
                {
                  direct_media_url: "https://www.youtube.com/watch?v=HaloCampaignEvolvedDemo",
                  source_type: "official_youtube_reference",
                  source_owner: "Xbox",
                  source_title: "Halo Campaign Evolved Official Campaign Demo",
                  source_family: "xbox_halo_campaign_evolved_official_youtube_demo",
                },
              ],
              freshness_gate: "pass",
              coherence_gate: "pass",
              blockers: [],
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "script_scorecard.json"),
            JSON.stringify({
              story_id: storyId,
              verdict: "viral_ready",
              blockers: [],
            }),
          );
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: storyId,
                artifact_dir: effectiveArtifactDir,
                verdict: "RED",
                blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: { storyPackagesPath },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
          repair_story_limit: 1,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          if (options.args[0] === "tools/official-search-intake-autofill.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          if (options.args[0] === "tools/official-direct-media-discovery.js") {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) {
              await fs.writeFile(
                templatePath,
                JSON.stringify({
                  schema_version: 1,
                  entries: [
                    {
                      story_id: storyId,
                      entity: "Halo Campaign Evolved",
                      official_source_url: "https://www.youtube.com/watch?v=HaloCampaignEvolvedDemo",
                      source_type: "official_youtube_channel_url",
                      source_owner: "Xbox official YouTube channel",
                      source_title: "Halo Campaign Evolved Official Campaign Demo",
                      source_family: "xbox_halo_campaign_evolved_official_youtube_demo",
                      evidence_of_officialness: "official Xbox YouTube channel reference",
                      entity_match_notes: "Halo Campaign Evolved named in the official title",
                      downloads_allowed: false,
                    },
                  ],
                }),
              );
            }
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    assert.equal(repairReport.summary.direct_media_intake_accepted_count, 1);
    assert.equal(repairReport.summary.direct_media_intake_materializable_accepted_count, 0);
    assert.equal(repairReport.summary.direct_media_intake_reference_only_accepted_count, 1);
    assert.equal(repairReport.summary.real_motion_materialized_clip_count, 0);
    const directMediaIntakeReport = JSON.parse(
      await fs.readFile(repairReport.outputs.direct_media_intake_report, "utf8"),
    );
    assert.equal(directMediaIntakeReport.summary.accepted, 1);
    assert.equal(directMediaIntakeReport.summary.materializable_accepted, 0);
    assert.equal(directMediaIntakeReport.summary.reference_only_accepted, 1);
    assert.equal(directMediaIntakeReport.accepted_entries[0].segment_validation_eligible, false);
    assert.equal(directMediaIntakeReport.accepted_entries[0].accepted_for, "reference_validation_only");
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("fresh production refill repair searches the actual game when headline starts with in-game faction wording", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-entity-clean-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const storyId = "rss_albion_keepers";
  const artifactDir = path.join(outDir, storyId);
  const originalCache = new Map([
    [jobHandlersPath, require.cache[jobHandlersPath]],
    [goalBatchPath, require.cache[goalBatchPath]],
  ]);

  try {
    require.cache[goalBatchPath] = {
      id: goalBatchPath,
      filename: goalBatchPath,
      loaded: true,
      exports: {
        async main(args) {
          const effectiveOutDir = args[args.indexOf("--out-dir") + 1] || outDir;
          const effectiveContractOutDir =
            args[args.indexOf("--contract-out-dir") + 1] || contractOutDir;
          const effectiveArtifactDir = path.join(effectiveOutDir, storyId);
          await fs.mkdir(effectiveArtifactDir, { recursive: true });
          await fs.mkdir(effectiveContractOutDir, { recursive: true });
          await fs.writeFile(
            path.join(effectiveArtifactDir, "canonical_story_manifest.json"),
            JSON.stringify({
              story_id: storyId,
              canonical_title: "In Albion Online the Keepers Has A Reinstall Test",
              selected_title: "In Albion Online the Keepers Has A Reinstall Test",
              narration_script:
                "Albion Online is turning the Keepers into a pressure test for its open world. Xbox Wire says the faction update changes what players fight over next.",
            }),
          );
          await fs.writeFile(
            path.join(effectiveArtifactDir, "source_manifest.json"),
            JSON.stringify({
              primary_source: {
                name: "Xbox Wire",
                url: "https://news.xbox.com/en-us/2026/07/07/in-albion-online/",
                type: "rss",
                published_at: "Tue, 07 Jul 2026 19:00:00 +0000",
              },
              source: {
                name: "Xbox Wire",
                url: "https://news.xbox.com/en-us/2026/07/07/in-albion-online/",
                type: "rss",
                published_at: "Tue, 07 Jul 2026 19:00:00 +0000",
              },
            }),
          );
          const storyPackagesPath = path.join(effectiveContractOutDir, "story-packages.json");
          await fs.writeFile(
            storyPackagesPath,
            JSON.stringify([
              {
                story_id: storyId,
                artifact_dir: effectiveArtifactDir,
                verdict: "RED",
                blockers: ["footage:v4_motion_blocked", "director:director_blocked"],
              },
            ]),
          );
          return {
            batch: { summary: { story_count: 1, green_count: 0, red_count: 1 } },
            outputs: {
              storyPackagesPath,
              batchReportPath: path.join(effectiveContractOutDir, "story-packages-report.json"),
            },
          };
        },
      },
    };
    delete require.cache[jobHandlersPath];

    const { handlers: mockedHandlers } = require("../../lib/job-handlers");
    const result = await mockedHandlers.fresh_production_refill(
      {
        channel_id: "pulse-gaming",
        payload: {
          limit: 1,
          out_dir: outDir,
          contract_out_dir: contractOutDir,
        },
      },
      {
        log() {},
        async runNodeJobChildProcess(options) {
          if (
            options.args[0] === "tools/official-search-intake-autofill.js" ||
            options.args[0] === "tools/official-direct-media-discovery.js"
          ) {
            const templateIndex = options.args.indexOf("--output-template");
            const templatePath = templateIndex >= 0 ? options.args[templateIndex + 1] : null;
            if (templatePath) await fs.writeFile(templatePath, JSON.stringify({ schema_version: 1, entries: [] }));
          }
          return { ok: true, stdout_tail: "ok", stderr_tail: "" };
        },
      },
    );

    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    const entries = JSON.parse(await fs.readFile(repairReport.outputs.official_source_entries, "utf8"));
    assert.equal(entries[0].entity, "Albion Online");
    assert.equal(entries[0].source_type, "official_game_site_news_page");
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
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
    assert.equal(enqueued[0].payload.enqueue_fresh_production_refill, true);
    assert.equal(enqueued[0].payload.enqueue_local_tts_retry_recovery, true);
    assert.equal(enqueued[0].payload.fresh_production_refill_tts_provider, "elevenlabs");
    assert.equal(enqueued[0].payload.fresh_production_refill_limit, 12);
    assert.equal(enqueued[0].payload.fresh_production_refill_rss_per_feed, 4);
    assert.equal(enqueued[0].payload.local_tts_retry_limit, 6);
    assert.equal(enqueued[0].payload.local_tts_retry_apply_limit, 3);
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
