"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMissedPublishWindowRecoveryPlan,
  recoverMissedPublishWindows,
  recoverMissedPublishWindowsFromEnvironment,
} = require("../../lib/ops/missed-publish-window-recovery");

const schedules = [
  {
    name: "publish_morning",
    kind: "publish",
    cron_expr: "0 9 * * *",
    idempotencyTemplate: "publish:{date}:09",
  },
  {
    name: "publish_late_morning",
    kind: "publish",
    cron_expr: "0 11 * * *",
    idempotencyTemplate: "publish:{date}:11",
  },
  {
    name: "publish_afternoon",
    kind: "publish",
    cron_expr: "0 14 * * *",
    idempotencyTemplate: "publish:{date}:14",
  },
  {
    name: "publish_mid_afternoon",
    kind: "publish",
    cron_expr: "0 16 * * *",
    idempotencyTemplate: "publish:{date}:16",
  },
  {
    name: "publish_primary",
    kind: "publish",
    cron_expr: "0 19 * * *",
    idempotencyTemplate: "publish:{date}:19",
  },
];

test("missed-window recovery queues only the newest missed window for a fresh YouTube-first candidate", () => {
  const plan = buildMissedPublishWindowRecoveryPlan({
    now: new Date("2026-07-16T17:20:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:09",
        status: "done",
        created_at: "2026-07-16 09:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:11",
        status: "done",
        created_at: "2026-07-16 11:00:00",
      },
    ],
    runtimeArmed: true,
    watchdogReport: {
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    },
    selection: {
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      priority: { reason: "fresh_story_youtube_first" },
    },
  });

  assert.equal(plan.verdict, "green");
  assert.equal(plan.should_enqueue, true);
  assert.equal(plan.missed_windows.length, 2);
  assert.equal(plan.selected_window.name, "publish_mid_afternoon");
  assert.equal(plan.selected_window.scheduled_at_utc, "2026-07-16T16:00:00.000Z");
  assert.equal(plan.enqueue_job.idempotency_key, "publish_recovery:2026-07-16:16");
  assert.equal(plan.enqueue_job.max_attempts, 3);
  assert.equal(plan.enqueue_job.payload.missed_window_idempotency_key, "publish:2026-07-16:16");
  assert.equal(plan.enqueue_job.payload.phase, "T0");
  assert.equal(plan.enqueue_job.payload.publish_hour_utc, 16);
  assert.equal(
    plan.enqueue_job.payload.phase_scheduled_at_utc,
    "2026-07-16T16:00:00.000Z",
  );
  assert.equal(plan.enqueue_job.payload.immutable_runway_required, true);
  assert.equal(plan.enqueue_job.payload.require_runway_lock, true);
  assert.deepEqual(plan.enqueue_job.payload.selected_action_ids, [
    "fresh-story:youtube_shorts",
  ]);
});

test("a failed canonical publish job remains recoverable instead of counting as a completed window", () => {
  const plan = buildMissedPublishWindowRecoveryPlan({
    now: new Date("2026-07-16T17:20:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:09",
        status: "done",
        created_at: "2026-07-16 09:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:11",
        status: "done",
        created_at: "2026-07-16 11:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:14",
        status: "done",
        created_at: "2026-07-16 14:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:16",
        status: "failed",
        last_error: "publish_window_watchdog_blocked:publish_window_watchdog_red",
        created_at: "2026-07-16 16:00:00",
      },
    ],
    runtimeArmed: true,
    watchdogReport: {
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    },
    selection: {
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_action_ids: [
        "fresh-story:youtube_shorts",
        "fresh-story:instagram_reels",
        "fresh-story:facebook_reels",
      ],
      selected_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      priority: { reason: "fresh_story_youtube_first" },
    },
  });

  assert.equal(plan.should_enqueue, true);
  assert.equal(plan.missed_windows.length, 1);
  assert.equal(plan.selected_window.expected_idempotency_key, "publish:2026-07-16:16");
});

test("a completed queue row that held before upload remains recoverable", () => {
  const plan = buildMissedPublishWindowRecoveryPlan({
    now: new Date("2026-07-16T17:20:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:09",
        status: "done",
        created_at: "2026-07-16 09:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:11",
        status: "done",
        created_at: "2026-07-16 11:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:14",
        status: "done",
        created_at: "2026-07-16 14:00:00",
      },
      {
        idempotency_key: "publish:2026-07-16:16",
        status: "done",
        result_summary: JSON.stringify({
          publish_window_blocked: true,
          status: "held",
          safe_to_publish_window: false,
        }),
        created_at: "2026-07-16 16:00:00",
      },
    ],
    runtimeArmed: true,
    watchdogReport: {
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    },
    selection: {
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_action_ids: ["fresh-story:youtube_shorts"],
      selected_platforms: ["youtube_shorts"],
      priority: { reason: "fresh_story_youtube_first" },
    },
  });

  assert.equal(plan.should_enqueue, true);
  assert.equal(plan.selected_window.expected_idempotency_key, "publish:2026-07-16:16");
});

test("startup recovery enqueues the planned catch-up through the guarded publish queue", async () => {
  const enqueued = [];
  const report = await recoverMissedPublishWindows({
    now: new Date("2026-07-16T17:20:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
    ],
    runtimeArmed: true,
    runWatchdog: async () => ({
      verdict: "green",
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    }),
    resolveSelection: async () => ({
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_action_ids: [
        "fresh-story:youtube_shorts",
        "fresh-story:instagram_reels",
        "fresh-story:facebook_reels",
      ],
      selected_platforms: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      priority: { reason: "fresh_story_youtube_first" },
    }),
    enqueue(job) {
      enqueued.push(job);
      return { id: 99123, ...job };
    },
    persist: false,
    notify: false,
  });

  assert.equal(report.should_enqueue, true);
  assert.equal(report.enqueued, true);
  assert.equal(report.queued_job_id, 99123);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, "publish");
  assert.equal(enqueued[0].payload.recovery_policy, "single_guarded_catchup");
  assert.deepEqual(enqueued[0].payload.selected_action_ids, [
    "fresh-story:youtube_shorts",
    "fresh-story:instagram_reels",
    "fresh-story:facebook_reels",
  ]);
});

test("environment recovery reads queue history and enqueues through repositories", async () => {
  const enqueued = [];
  const report = await recoverMissedPublishWindowsFromEnvironment({
    now: new Date("2026-07-16T17:20:00.000Z"),
    env: { PULSE_BREAKING_EXCEPTION_OPERATOR_APPROVED: "true" },
    schedules,
    repos: {
      db: {
        prepare(sql) {
          assert.match(sql, /FROM jobs/i);
          return {
            all() {
              return [
                {
                  idempotency_key: "publish:2026-07-15:19",
                  status: "done",
                  created_at: "2026-07-15 19:00:00",
                },
              ];
            },
          };
        },
      },
      jobs: {
        enqueue(job) {
          enqueued.push(job);
          return { id: 99124, ...job };
        },
      },
    },
    runtimeArmed: true,
    runWatchdog: async () => ({
      verdict: "green",
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    }),
    resolveSelection: async () => ({
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_action_ids: ["fresh-story:youtube_shorts"],
      selected_platforms: ["youtube_shorts"],
      priority: { reason: "fresh_story_youtube_first" },
    }),
    persist: false,
    notify: false,
  });

  assert.equal(report.enqueued, true);
  assert.equal(report.queued_job_id, 99124);
  assert.equal(enqueued.length, 1);
});

test("recovery does not enqueue beside an imminent canonical window", () => {
  const plan = buildMissedPublishWindowRecoveryPlan({
    now: new Date("2026-07-16T18:50:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
    ],
    runtimeArmed: true,
    watchdogReport: {
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    },
    selection: {
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_action_ids: ["fresh-story:youtube_shorts"],
      selected_platforms: ["youtube_shorts"],
      priority: { reason: "fresh_story_youtube_first" },
    },
  });

  assert.equal(plan.should_enqueue, false);
  assert.equal(plan.reason, "next_canonical_window_imminent");
  assert.equal(plan.next_canonical_window.scheduled_at_utc, "2026-07-16T19:00:00.000Z");
  assert.equal(plan.minutes_until_next_canonical_window, 10);
});

test("stabilisation refuses catch-up publishing without an explicit operator exception", () => {
  const plan = buildMissedPublishWindowRecoveryPlan({
    now: new Date("2026-07-16T17:20:00.000Z"),
    schedules,
    jobs: [
      {
        idempotency_key: "publish:2026-07-15:19",
        status: "done",
        created_at: "2026-07-15 19:00:00",
      },
    ],
    runtimeArmed: true,
    operatorCatchupApproved: false,
    watchdogReport: {
      safe_to_publish_window: true,
      hold_scheduler_or_dispatch: false,
    },
    selection: {
      exhausted: false,
      action_id: "fresh-story:youtube_shorts",
      selected_platforms: ["youtube_shorts"],
      priority: { reason: "fresh_story_youtube_first" },
    },
  });

  assert.equal(plan.should_enqueue, false);
  assert.equal(plan.reason, "catch_up_requires_operator_approval");
  assert.equal(plan.operator_catchup_approved, false);
});
