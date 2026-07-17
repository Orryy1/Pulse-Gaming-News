"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCriticalPublishScheduleCatchupPlan,
  reconcileCriticalPublishSchedules,
} = require("../../lib/ops/critical-publish-schedule-reconciler");

test("critical schedule catch-up recreates missed T-180 and T-90 jobs with canonical keys", () => {
  const report = buildCriticalPublishScheduleCatchupPlan({
    now: new Date("2026-07-17T08:05:00.000Z"),
    schedules: [
      {
        id: 1,
        name: "publish_runway_generate_morning",
        kind: "publish_runway_generate",
        cron_expr: "0 6 * * *",
        priority: 14,
        payload: JSON.stringify({
          phase: "T-180",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          idempotencyTemplate: "publish_runway_generate:{date}:06",
        }),
      },
      {
        id: 2,
        name: "publish_watchdog_morning",
        kind: "publish_window_watchdog",
        cron_expr: "30 7 * * *",
        priority: 15,
        payload: JSON.stringify({
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          idempotencyTemplate: "publish_window_watchdog:{date}:07-30",
        }),
      },
      {
        id: 3,
        name: "publish_morning",
        kind: "publish",
        cron_expr: "0 9 * * *",
        priority: 20,
        payload: JSON.stringify({
          phase: "T0",
          idempotencyTemplate: "publish:{date}:09",
        }),
      },
    ],
    jobs: [],
  });

  assert.equal(report.verdict, "amber");
  assert.deepEqual(
    report.catchup_jobs.map((job) => [job.kind, job.idempotency_key]),
    [
      ["publish_runway_generate", "publish_runway_generate:2026-07-17:06"],
      ["publish_window_watchdog", "publish_window_watchdog:2026-07-17:07-30"],
    ],
  );
  assert.equal(report.catchup_jobs.some((job) => job.kind === "publish"), false);
  assert.equal(report.safety.publish_recovery_delegated_to_guarded_path, true);
});

test("critical schedule reconciler enqueues prep debt through the canonical queue", async () => {
  const enqueued = [];
  const updatedScheduleIds = [];
  const schedules = [
    {
      id: 11,
      name: "publish_runway_generate_morning",
      kind: "publish_runway_generate",
      cron_expr: "0 6 * * *",
      priority: 14,
      payload: JSON.stringify({
        phase: "T-180",
        idempotencyTemplate: "publish_runway_generate:{date}:06",
      }),
    },
  ];
  const report = await reconcileCriticalPublishSchedules({
    now: new Date("2026-07-17T06:02:00.000Z"),
    schedules,
    repos: {
      jobs: {
        enqueue(job) {
          enqueued.push(job);
          return { id: 901, ...job };
        },
      },
      db: {
        prepare(sql) {
          if (/SELECT[\s\S]+FROM jobs/i.test(sql)) {
            assert.doesNotMatch(
              sql,
              /\bresult_summary\b/i,
              "recovery query must use only columns present in the jobs table",
            );
            return { all: () => [] };
          }
          if (/UPDATE schedules/i.test(sql)) {
            return { run: (id) => updatedScheduleIds.push(id) };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
    },
    persist: false,
  });

  assert.equal(report.enqueued_count, 1);
  assert.equal(report.enqueued_jobs[0].job_id, 901);
  assert.equal(enqueued[0].idempotency_key, "publish_runway_generate:2026-07-17:06");
  assert.deepEqual(updatedScheduleIds, [11]);
  assert.equal(report.safety.live_publish_attempted, false);
});

test("a completed T-90 watchdog without a verified lock remains recoverable", () => {
  const report = buildCriticalPublishScheduleCatchupPlan({
    now: new Date("2026-07-17T08:05:00.000Z"),
    schedules: [
      {
        id: 21,
        name: "publish_watchdog_morning",
        kind: "publish_window_watchdog",
        cron_expr: "30 7 * * *",
        priority: 15,
        payload: JSON.stringify({
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          idempotencyTemplate: "publish_window_watchdog:{date}:07-30",
        }),
      },
    ],
    jobs: [
      {
        id: 7756,
        kind: "publish_window_watchdog",
        status: "done",
        idempotency_key: "publish_window_watchdog:2026-07-17:07-30",
      },
    ],
    runwayCoverage: {
      21: {
        generation_valid: true,
        generation_id: "runway-20260717T090000Z-a1b2c3",
        lock_valid: false,
      },
    },
  });

  assert.equal(report.catchup_job_count, 1);
  assert.equal(report.catchup_jobs[0].kind, "publish_window_watchdog");
  assert.match(
    report.catchup_jobs[0].idempotency_key,
    /^publish_window_watchdog:2026-07-17:07-30:recovery:/,
  );
  assert.equal(report.catchup_jobs[0].payload.phase, "T-90");
  assert.equal(
    report.catchup_jobs[0].payload.phase_scheduled_at_utc,
    "2026-07-17T07:30:00.000Z",
  );
  assert.equal(report.catchup_jobs[0].payload.require_runway_lock, true);
  assert.equal(
    report.catchup_jobs[0].payload.runway_generation_id,
    "runway-20260717T090000Z-a1b2c3",
  );
});

test("a materially verified T-90 lock suppresses redundant recovery", () => {
  const report = buildCriticalPublishScheduleCatchupPlan({
    now: new Date("2026-07-17T08:05:00.000Z"),
    schedules: [
      {
        id: 22,
        name: "publish_watchdog_morning",
        kind: "publish_window_watchdog",
        cron_expr: "30 7 * * *",
        priority: 15,
        payload: JSON.stringify({
          phase: "T-90",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          idempotencyTemplate: "publish_window_watchdog:{date}:07-30",
        }),
      },
    ],
    jobs: [
      {
        id: 7757,
        kind: "publish_window_watchdog",
        status: "done",
        idempotency_key: "publish_window_watchdog:2026-07-17:07-30",
      },
    ],
    runwayCoverage: {
      22: {
        generation_valid: true,
        generation_id: "runway-20260717T090000Z-a1b2c3",
        lock_valid: true,
        lock_generation_id: "runway-20260717T090000Z-a1b2c3",
      },
    },
  });

  assert.equal(report.catchup_job_count, 0);
});

test("a failed T-180 job without a valid generation remains recoverable", () => {
  const report = buildCriticalPublishScheduleCatchupPlan({
    now: new Date("2026-07-17T06:05:00.000Z"),
    schedules: [
      {
        id: 23,
        name: "publish_runway_generate_morning",
        kind: "publish_runway_generate",
        cron_expr: "0 6 * * *",
        priority: 14,
        payload: JSON.stringify({
          phase: "T-180",
          window_label: "publish_morning",
          publish_hour_utc: 9,
          idempotencyTemplate: "publish_runway_generate:{date}:06",
        }),
      },
    ],
    jobs: [
      {
        id: 7804,
        kind: "publish_runway_generate",
        status: "failed",
        idempotency_key: "publish_runway_generate:2026-07-17:06",
      },
    ],
    runwayCoverage: {
      23: {
        generation_valid: false,
        lock_valid: false,
      },
    },
  });

  assert.equal(report.catchup_job_count, 1);
  assert.match(
    report.catchup_jobs[0].idempotency_key,
    /^publish_runway_generate:2026-07-17:06:recovery:/,
  );
});
