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
    "--smoke",
  ]);
  assert.equal(captured.childKind, "local_tts_doctor");
  assert.equal(result.status, "green");
  assert.equal(result.ready, true);
  assert.equal(result.started_pid, 12345);
  assert.equal(result.prewarm_ok, true);
  assert.equal(result.gpu_ok, true);
});

test("local TTS retry recovery handler runs bounded local-only preflight and apply", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-retry-recovery-"));
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
    assert.equal(enqueued[3].payload.repair_story_limit, 3);
    assert.equal(enqueued[3].payload.source_minimum_new_green_candidates, 9);
    assert.equal(
      enqueued[3].payload.source_refill_command,
      "npm run ops:fresh-production-refill -- --json --limit 18 --rss-per-feed 6 --repair-evidence-mode plan --repair-story-limit 3 --tts-provider elevenlabs",
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
      "--v4-motion-pack-dir",
      path.join(__dirname, "..", "..", "output", "studio-v4", "motion-packs"),
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
    assert.equal(result.repair_evidence.child_processes.length, 10);
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
    assert.ok(
      segmentValidatorCall.args.includes("--no-reference-duration-probe"),
      "fresh refill segment validation must not stall on remote duration probes",
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
      childCalls.some((call) => call.args[0] === "tools/studio-v2-build-story-cards.js"),
      "expected fresh refill to build story-specific HyperFrames premium shell cards before hydrating packages",
    );
    const storyCardCall = childCalls.find(
      (call) => call.args[0] === "tools/studio-v2-build-story-cards.js",
    );
    assert.equal(storyCardCall.args[storyCardCall.args.indexOf("--story-id") + 1], "fresh_xbox_story");
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
      "8",
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
      segmentValidationCall.args.includes("--checkpoint-report"),
      "fresh refill must checkpoint segment validation so a timeout cannot leave only stale global evidence",
    );
    assert.ok(segmentValidationCall.args.includes("--deep-scan"));
    assert.equal(segmentValidationCall.args.includes("--include-frame-anchored-windows"), true);
    assert.ok(segmentValidationCall.args.includes("--no-reference-duration-probe"));
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
    assert.equal(materializerCall.args[materializerCall.args.indexOf("--max-clips") + 1], "8");
    const repairReport = JSON.parse(await fs.readFile(result.repair_evidence.report_path, "utf8"));
    assert.equal(repairReport.summary.official_source_entries_count, 1);
    assert.equal(repairReport.summary.script_blocked_package_count, 1);
    assert.equal(repairReport.summary.script_rewrite_work_order_count, 1);
    assert.deepEqual(repairReport.summary.quarantined_package_ids, ["fresh_generic_story"]);
    assert.equal(repairReport.summary.direct_media_intake_accepted_count, 2);
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
    assert.equal(repairReport.summary.child_process_count, 10);
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
      ["fresh_xbox_story", "fresh_gamespot_story"],
      "non-script-blocked stories may enter supplemental official search; script-blocked generic packages must not",
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
              },
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

test("fresh production refill handler can run from a seeded official story file", async () => {
  const jobHandlersPath = require.resolve("../../lib/job-handlers");
  const goalBatchPath = require.resolve("../../tools/goal-batch-packages");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-seed-"));
  const outDir = path.join(tmp, "goal-proof-batch");
  const contractOutDir = path.join(tmp, "goal-contract");
  const seedStoriesFile = path.join(tmp, "official-direct-media-seeds.json");
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
      1,
      "a source-bound script rewrite that clears the scorecard must be re-filtered into motion repair",
    );
    assert.equal(result.repair_evidence.summary.repair_attempt_story_package_count, 1);
    assert.equal(result.repair_evidence.summary.script_blocked_package_count, 0);
    assert.equal(result.repair_evidence.summary.script_rewrite_promoted_count, 1);
    assert.ok(
      childCalls.some((call) => call.args[0] === "tools/studio-v4-motion-pack.js"),
      "repaired scripts must continue into the same refill run's motion evidence path",
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
