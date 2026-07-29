"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Worker } = require("node:worker_threads");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const { bind } = require("../../lib/repositories/jobs");
const {
  MULTI_LANE_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");
const {
  buildGovernedYoutubeT60PrestageJob,
  buildGovernedYoutubeWindowCheckpointPlan,
  evaluateGovernedYoutubeCheckpointExecutionTime,
  governedYoutubeWindowCheckpointPrimingContract,
  primeGovernedYoutubeWindowCheckpoints,
} = require("../../lib/services/governed-youtube-window-checkpoint-primer");

function memoryFixture() {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  return { db, jobs: bind(db) };
}

test("startup priming durably schedules every future T-90 and T+15 checkpoint in the next 36 hours", () => {
  const { db, jobs } = memoryFixture();

  const result = primeGovernedYoutubeWindowCheckpoints({
    jobs,
    schedulerProfile: "governed_multi_lane",
    now: "2026-07-28T12:00:00.000Z",
  });

  assert.equal(result.status, "PRIMED");
  assert.deepEqual(
    result.queued_jobs.map((job) => [
      job.kind,
      job.phase,
      job.scheduled_for,
      job.run_at,
      job.idempotency_key,
    ]),
    [
      [
        "governed_youtube_runway_t90",
        "T-90",
        "2026-07-28T19:00:00.000Z",
        "2026-07-28T17:30:00.000Z",
        "governed_youtube_runway_t90:2026-07-28:19",
      ],
      [
        "governed_youtube_runway_tplus15",
        "T+15",
        "2026-07-28T19:00:00.000Z",
        "2026-07-28T19:15:00.000Z",
        "governed_youtube_runway_tplus15:2026-07-28:19",
      ],
      [
        "governed_youtube_runway_t90",
        "T-90",
        "2026-07-29T09:00:00.000Z",
        "2026-07-29T07:30:00.000Z",
        "governed_youtube_runway_t90:2026-07-29:09",
      ],
      [
        "governed_youtube_runway_tplus15",
        "T+15",
        "2026-07-29T09:00:00.000Z",
        "2026-07-29T09:15:00.000Z",
        "governed_youtube_runway_tplus15:2026-07-29:09",
      ],
      [
        "governed_youtube_runway_t90",
        "T-90",
        "2026-07-29T19:00:00.000Z",
        "2026-07-29T17:30:00.000Z",
        "governed_youtube_runway_t90:2026-07-29:19",
      ],
      [
        "governed_youtube_runway_tplus15",
        "T+15",
        "2026-07-29T19:00:00.000Z",
        "2026-07-29T19:15:00.000Z",
        "governed_youtube_runway_tplus15:2026-07-29:19",
      ],
    ],
  );

  const persisted = db
    .prepare(
      `SELECT kind, run_at, payload, idempotency_key
       FROM jobs
       ORDER BY datetime(run_at), id`,
    )
    .all();
  assert.equal(persisted.length, 6);
  assert.deepEqual(
    persisted.map((job) => job.run_at),
    [
      "2026-07-28 17:30:00",
      "2026-07-28 19:15:00",
      "2026-07-29 07:30:00",
      "2026-07-29 09:15:00",
      "2026-07-29 17:30:00",
      "2026-07-29 19:15:00",
    ],
  );
  assert.ok(
    persisted.every((job) => {
      const payload = JSON.parse(job.payload);
      return (
        payload.catch_up_allowed === false &&
        payload.publish_authority === false &&
        payload.external_posting === false &&
        payload.live_publish_enabled === false
      );
    }),
  );
  assert.deepEqual(result.safety, {
    database_jobs_enqueued: true,
    network_used: false,
    oauth_mutated: false,
    platform_contacted: false,
    external_posting: false,
    publish_authority_created: false,
    catch_up_allowed: false,
  });
  db.close();
});

test("an elapsed checkpoint is never catch-up queued and is exposed for incident-only evidence handling", () => {
  const plan = buildGovernedYoutubeWindowCheckpointPlan({
    now: "2026-07-28T08:00:00.000Z",
    horizonHours: 24,
  });

  assert.ok(
    !plan.requests.some(
      (request) =>
        request.phase === "T-90" &&
        request.scheduled_for ===
          "2026-07-28T09:00:00.000Z",
    ),
  );
  assert.ok(
    plan.requests.some(
      (request) =>
        request.phase === "T+15" &&
        request.scheduled_for ===
          "2026-07-28T09:00:00.000Z" &&
        request.run_at ===
          "2026-07-28T09:15:00.000Z",
    ),
  );
  assert.deepEqual(plan.elapsed_checkpoints, [
    {
      kind: "governed_youtube_runway_t90",
      phase: "T-90",
      scheduled_for: "2026-07-28T09:00:00.000Z",
      run_at: "2026-07-28T07:30:00.000Z",
      idempotency_key:
        "governed_youtube_runway_t90:2026-07-28:09",
      queue_action: "SKIP_PAST",
      recovery_action: "VERIFY_EVIDENCE_THEN_INCIDENT_ONLY",
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
  ]);
});

test("priming-before-cron replay reuses the exact durable jobs without conflicts or duplicates", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-primer-"),
  );
  t.after(() =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  const databasePath = path.join(directory, "pulse.db");
  const firstDb = new Database(databasePath);
  runMigrations(firstDb, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  const firstJobs = bind(firstDb);
  const first = primeGovernedYoutubeWindowCheckpoints({
    jobs: firstJobs,
    schedulerProfile: "governed_multi_lane",
    now: "2026-07-28T12:00:00.000Z",
  });
  firstDb.close();

  const restartedDb = new Database(databasePath);
  const restartedJobs = bind(restartedDb);
  const replay = primeGovernedYoutubeWindowCheckpoints({
    jobs: restartedJobs,
    schedulerProfile: "governed_multi_lane",
    now: "2026-07-28T12:30:00.000Z",
  });
  assert.deepEqual(
    replay.queued_jobs.map((job) => job.id),
    first.queued_jobs.map((job) => job.id),
  );
  assert.equal(
    restartedDb
      .prepare("SELECT COUNT(*) AS count FROM jobs")
      .get().count,
    6,
  );

  const cronRequest =
    buildGovernedYoutubeWindowCheckpointPlan({
      now: "2026-07-28T12:00:00.000Z",
    }).requests[0];
  const {
    phase: _phase,
    scheduled_for: _scheduledFor,
    run_at: _runAt,
    ...cronFire
  } = cronRequest;
  const cronReplay = restartedJobs.enqueue(cronFire);
  assert.equal(cronReplay.id, first.queued_jobs[0].id);
  assert.equal(
    restartedDb
      .prepare("SELECT COUNT(*) AS count FROM jobs")
      .get().count,
    6,
  );
  restartedDb.close();
});

test("cron-at-due before priming reuses the same window job", () => {
  const { db, jobs } = memoryFixture();
  const plan = buildGovernedYoutubeWindowCheckpointPlan({
    now: "2026-07-28T07:30:00.000Z",
    horizonHours: 24,
  });
  const firstRequest = plan.requests[0];
  const {
    phase: _phase,
    scheduled_for: _scheduledFor,
    ...cronFire
  } = firstRequest;
  const cronJob = jobs.enqueue(cronFire);

  const primed = primeGovernedYoutubeWindowCheckpoints({
    jobs,
    schedulerProfile: "governed_multi_lane",
    now: "2026-07-28T07:30:00.000Z",
    horizonHours: 24,
  });

  assert.equal(primed.queued_jobs[0].id, cronJob.id);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE idempotency_key =
           'governed_youtube_runway_t90:2026-07-28:09'`,
      )
      .get().count,
    1,
  );
  db.close();
});

test("cron-at-due racing startup priming produces one window job without an idempotency conflict", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-primer-race-"),
  );
  t.after(() =>
    fs.rmSync(directory, { recursive: true, force: true }),
  );
  const databasePath = path.join(directory, "pulse.db");
  const setup = new Database(databasePath);
  runMigrations(setup, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  setup.close();

  const start = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT,
  );
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    const Database = require(workerData.databaseModule);
    const { bind } = require(workerData.jobsModule);
    const {
      buildGovernedYoutubeWindowCheckpointPlan,
      primeGovernedYoutubeWindowCheckpoints,
    } = require(workerData.primerModule);
    const db = new Database(workerData.databasePath);
    db.pragma("busy_timeout = 5000");
    const jobs = bind(db);
    const start = new Int32Array(workerData.start);
    parentPort.postMessage({ ready: true });
    Atomics.wait(start, 0, 0);
    try {
      if (workerData.mode === "primer") {
        const result = primeGovernedYoutubeWindowCheckpoints({
          jobs,
          schedulerProfile: "governed_multi_lane",
          now: "2026-07-28T07:30:00.000Z",
          horizonHours: 24,
        });
        parentPort.postMessage({
          mode: workerData.mode,
          id: result.queued_jobs[0].id,
        });
      } else {
        const request = buildGovernedYoutubeWindowCheckpointPlan({
          now: "2026-07-28T07:30:00.000Z",
          horizonHours: 24,
        }).requests[0];
        delete request.phase;
        delete request.scheduled_for;
        const result = jobs.enqueue(request);
        parentPort.postMessage({
          mode: workerData.mode,
          id: result.id,
        });
      }
    } catch (error) {
      parentPort.postMessage({
        mode: workerData.mode,
        error: error.message,
      });
    } finally {
      db.close();
    }
  `;
  const workers = ["primer", "cron"].map(
    (mode) =>
      new Worker(workerSource, {
        eval: true,
        workerData: {
          mode,
          databasePath,
          start,
          databaseModule: require.resolve(
            "better-sqlite3",
          ),
          jobsModule: require.resolve(
            "../../lib/repositories/jobs",
          ),
          primerModule: require.resolve(
            "../../lib/services/governed-youtube-window-checkpoint-primer",
          ),
        },
      }),
  );
  const results = [];
  let ready = 0;
  await new Promise((resolve, reject) => {
    for (const worker of workers) {
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (message.ready) {
          ready += 1;
          if (ready === workers.length) {
            Atomics.store(new Int32Array(start), 0, 1);
            Atomics.notify(
              new Int32Array(start),
              0,
              workers.length,
            );
          }
          return;
        }
        results.push(message);
        if (results.length === workers.length) resolve();
      });
    }
  });

  assert.deepEqual(
    results.map((result) => result.error).filter(Boolean),
    [],
  );
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  const verify = new Database(databasePath);
  assert.equal(
    verify
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE idempotency_key =
           'governed_youtube_runway_t90:2026-07-28:09'`,
      )
      .get().count,
    1,
  );
  verify.close();
});

test("the scheduler and handlers receive a fail-closed integration contract for restart-safe UTC checkpoints", () => {
  const contract =
    governedYoutubeWindowCheckpointPrimingContract();

  assert.deepEqual(contract, {
    schema_version:
      "pulse-governed-youtube-window-checkpoint-priming-contract-v1",
    scheduler_profile: "governed_multi_lane",
    invocation: {
      startup_required: true,
      daily_refresh_required: true,
      daily_refresh_cron_utc: "5 0 * * *",
      timezone: "UTC",
      horizon_hours: 36,
      durable_jobs_repository_required: true,
      execute_checkpoints_inline: false,
    },
    windows: {
      publish_hours_utc: [9, 19],
      checkpoint_kinds: [
        "governed_youtube_runway_t90",
        "governed_youtube_runway_tplus15",
      ],
      exact_offsets_minutes_from_t0: {
        "T-90": -90,
        "T+15": 15,
      },
    },
    enqueue: {
      canonical_utc_run_at_required: true,
      explicit_run_at_required: true,
      window_scoped_idempotency_required: true,
      cron_payload_and_idempotency_compatibility_required: true,
      already_past_queue_action: "SKIP_PAST",
    },
    handler: {
      authoritative_due_field: "job.run_at",
      maximum_start_lateness_seconds: 60,
      late_disposition:
        "WRITE_MISSED_INTERNAL_INCIDENT_ONLY",
      retry_late_checkpoint: false,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    downstream_from_t90: {
      durable_t60_job_required: true,
      kind: "governed_youtube_runway_t60",
      exact_offset_minutes_from_t0: -60,
      authoritative_due_field: "job.run_at",
      deterministic_enqueue_required: true,
      private_only: true,
      unarmed_disposition: "HOLD",
      unarmed_blocker:
        "runway_t60_private_prestage_not_armed",
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    payload_invariants: {
      scheduler_profile: "governed_multi_lane",
      governed_multi_lane: true,
      live_publish_enabled: false,
      human_admission_required: true,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
  });
});

test("UTC checkpoint times do not move across UK DST changes and the exact due instant is not treated as past", () => {
  for (const transitionDay of [
    "2026-03-29",
    "2026-10-25",
  ]) {
    const plan = buildGovernedYoutubeWindowCheckpointPlan({
      now: `${transitionDay}T00:00:00.000Z`,
      horizonHours: 24,
    });
    assert.deepEqual(
      plan.requests
        .filter(
          (request) =>
            request.scheduled_for.slice(0, 10) ===
            transitionDay,
        )
        .map((request) => request.run_at),
      [
        `${transitionDay}T07:30:00.000Z`,
        `${transitionDay}T09:15:00.000Z`,
        `${transitionDay}T17:30:00.000Z`,
        `${transitionDay}T19:15:00.000Z`,
      ],
    );
  }

  const exactBoundary =
    buildGovernedYoutubeWindowCheckpointPlan({
      now: "2026-07-28T07:30:00.000Z",
      horizonHours: 24,
    });
  assert.ok(
    exactBoundary.requests.some(
      (request) =>
        request.phase === "T-90" &&
        request.scheduled_for ===
          "2026-07-28T09:00:00.000Z",
    ),
  );
  const justLate =
    buildGovernedYoutubeWindowCheckpointPlan({
      now: "2026-07-28T07:30:00.001Z",
      horizonHours: 24,
    });
  assert.ok(
    !justLate.requests.some(
      (request) =>
        request.phase === "T-90" &&
        request.scheduled_for ===
          "2026-07-28T09:00:00.000Z",
    ),
  );
});

test("primed requests are byte-compatible with the governed cron payload and window key", () => {
  const schedules = schedulesForProfile(
    MULTI_LANE_SCHEDULER_PROFILE,
  ).filter((schedule) =>
    [
      "governed_youtube_runway_t90",
      "governed_youtube_runway_tplus15",
    ].includes(schedule.kind),
  );
  const plan = buildGovernedYoutubeWindowCheckpointPlan({
    now: "2026-07-28T12:00:00.000Z",
  });

  for (const request of plan.requests) {
    const schedule = schedules.find(
      (candidate) =>
        candidate.kind === request.kind &&
        candidate.payload.publish_hour_utc ===
          new Date(request.scheduled_for).getUTCHours(),
    );
    assert.ok(schedule);
    assert.deepEqual(request.payload, schedule.payload);
    const expectedKey = schedule.idempotencyTemplate
      .replace(
        "{date}",
        request.scheduled_for.slice(0, 10),
      );
    assert.equal(request.idempotency_key, expectedKey);
  }
});

test("startup priming returns elapsed checkpoints to the incident lane without enqueuing them", () => {
  const { db, jobs } = memoryFixture();
  const result = primeGovernedYoutubeWindowCheckpoints({
    jobs,
    schedulerProfile: "governed_multi_lane",
    now: "2026-07-28T08:00:00.000Z",
    horizonHours: 24,
  });

  assert.equal(result.elapsed_checkpoints.length, 1);
  assert.equal(
    result.elapsed_checkpoints[0].recovery_action,
    "VERIFY_EVIDENCE_THEN_INCIDENT_ONLY",
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE idempotency_key =
           'governed_youtube_runway_t90:2026-07-28:09'`,
      )
      .get().count,
    0,
  );
  db.close();
});

test("priming is profile-gated and rejects ambiguous local time or an unsafe horizon", () => {
  const { db, jobs } = memoryFixture();
  const skipped = primeGovernedYoutubeWindowCheckpoints({
    jobs,
    schedulerProfile: "stabilisation_30d",
    now: "2026-07-28T08:00:00.000Z",
  });
  assert.equal(skipped.status, "SKIPPED");
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM jobs")
      .get().count,
    0,
  );
  assert.throws(
    () =>
      buildGovernedYoutubeWindowCheckpointPlan({
        now: "2026-07-28T08:00:00",
      }),
    /window_checkpoint_primer_time_timezone_required/,
  );
  assert.throws(
    () =>
      buildGovernedYoutubeWindowCheckpointPlan({
        now: "2026-07-28T08:00:00.000Z",
        horizonHours: 23,
      }),
    /window_checkpoint_primer_horizon_must_be_24_to_36_hours/,
  );
  assert.throws(
    () =>
      primeGovernedYoutubeWindowCheckpoints({
        jobs: {},
        schedulerProfile: "governed_multi_lane",
        now: "2026-07-28T08:00:00.000Z",
      }),
    /window_checkpoint_primer_jobs_repository_required/,
  );
  db.close();
});

test("checkpoint execution accepts at most 60 seconds of runner jitter and fails late work into incident-only mode", () => {
  assert.deepEqual(
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind: "governed_youtube_runway_t90",
      runAt: "2026-07-28 17:30:00",
      now: "2026-07-28T17:31:00.000Z",
    }),
    {
      status: "ACCEPTED",
      classification: null,
      due_at: "2026-07-28T17:30:00.000Z",
      evaluated_at: "2026-07-28T17:31:00.000Z",
      lateness_ms: 60000,
      maximum_lateness_ms: 60000,
      execute_checkpoint: true,
      catch_up_allowed: false,
      recovery_action: null,
    },
  );
  assert.deepEqual(
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind: "governed_youtube_runway_tplus15",
      runAt: "2026-07-28T19:15:00.000Z",
      now: "2026-07-28T19:16:00.001Z",
    }),
    {
      status: "MISSED",
      classification: "MISSED_INTERNAL",
      due_at: "2026-07-28T19:15:00.000Z",
      evaluated_at: "2026-07-28T19:16:00.001Z",
      lateness_ms: 60001,
      maximum_lateness_ms: 60000,
      execute_checkpoint: false,
      catch_up_allowed: false,
      recovery_action: "WRITE_MISSED_INTERNAL_INCIDENT_ONLY",
    },
  );
});

test("autonomous pre-T90 preparation is a strict T-94 checkpoint with no early or late catch-up", () => {
  const kind = "prepare_governed_autonomous_pre_t90_window";
  const runAt = "2026-07-28T17:26:00.000Z";

  assert.deepEqual(
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind,
      runAt,
      now: "2026-07-28T17:26:00.000Z",
    }),
    {
      status: "ACCEPTED",
      classification: null,
      due_at: "2026-07-28T17:26:00.000Z",
      evaluated_at: "2026-07-28T17:26:00.000Z",
      lateness_ms: 0,
      maximum_lateness_ms: 60000,
      execute_checkpoint: true,
      catch_up_allowed: false,
      recovery_action: null,
    },
  );
  assert.deepEqual(
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind,
      runAt,
      now: "2026-07-28T17:25:59.999Z",
    }),
    {
      status: "NOT_DUE",
      classification: null,
      due_at: "2026-07-28T17:26:00.000Z",
      evaluated_at: "2026-07-28T17:25:59.999Z",
      lateness_ms: -1,
      maximum_lateness_ms: 60000,
      execute_checkpoint: false,
      catch_up_allowed: false,
      recovery_action: "WAIT_UNTIL_DUE",
    },
  );
  assert.deepEqual(
    evaluateGovernedYoutubeCheckpointExecutionTime({
      kind,
      runAt,
      now: "2026-07-28T17:27:00.001Z",
    }),
    {
      status: "MISSED",
      classification: "MISSED_INTERNAL",
      due_at: "2026-07-28T17:26:00.000Z",
      evaluated_at: "2026-07-28T17:27:00.001Z",
      lateness_ms: 60001,
      maximum_lateness_ms: 60000,
      execute_checkpoint: false,
      catch_up_allowed: false,
      recovery_action: "WRITE_MISSED_INTERNAL_INCIDENT_ONLY",
    },
  );
});

test("an immutable T-90 lock deterministically creates one exact T-60 verification job without upload authority", () => {
  assert.deepEqual(
    buildGovernedYoutubeT60PrestageJob({
      lock: {
        scheduled_for: "2026-07-28T19:00:00.000Z",
        lock_sha256: "a".repeat(64),
        primary: {
          story_id: "story-primary",
          lane_id: "breaking_short",
        },
      },
      channelId: "pulse-gaming",
    }),
    {
      kind: "governed_youtube_runway_t60",
      channel_id: "pulse-gaming",
      story_id: "story-primary",
      payload: {
        phase: "T-60",
        scheduled_for: "2026-07-28T19:00:00.000Z",
        story_id: "story-primary",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduler_profile: "governed_multi_lane",
        runway_lock_sha256: "a".repeat(64),
        private_only: true,
        private_prestage_authority: false,
        readiness_verification_authority: true,
        human_review_required: true,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
      priority: 3,
      requires_gpu: false,
      max_attempts: 46,
      run_at: "2026-07-28T18:00:00.000Z",
      idempotency_key:
        `governed_youtube_runway_t60:2026-07-28:19:${"a".repeat(64)}`,
    },
  );
});
