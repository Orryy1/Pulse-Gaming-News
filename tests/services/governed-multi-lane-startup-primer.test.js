"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  primeGovernedMultiLaneStartup,
} = require("../../lib/services/governed-multi-lane-startup-primer");

function fakeJobs() {
  const queued = [];
  return {
    queued,
    enqueue(input) {
      const row = { id: queued.length + 1, ...input };
      queued.push(row);
      return row;
    },
  };
}

test("governed startup primes every editorial lane immediately with no publish authority", () => {
  const jobs = fakeJobs();
  const result = primeGovernedMultiLaneStartup({
    jobs,
    schedulerProfile: "governed_multi_lane",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:07:30.000Z",
  });

  assert.equal(result.status, "PRIMED");
  assert.equal(result.bootstrap_bucket, "2026-07-28T12:00:00.000Z");
  assert.deepEqual(
    jobs.queued.map((job) => job.kind),
    [
      "governed_youtube_window_inventory_monitor",
      "hunt",
      "governed_editorial_evidence_backfill",
      "reconcile_editorial_inventory",
      "governed_multi_lane_plan",
      "evergreen_candidate_builder",
      "plan_weekly_longform",
    ],
  );
  assert.ok(
    jobs.queued.every(
      (job) =>
        job.channel_id === "pulse-gaming" &&
        job.requires_gpu === false &&
        job.payload.scheduler_profile === "governed_multi_lane" &&
        job.payload.governed_multi_lane === true &&
        job.payload.live_publish_enabled === false &&
        job.payload.publish_authority === false &&
        job.payload.human_admission_required === true &&
        job.payload.human_review_required === true,
    ),
  );
  assert.equal(
    new Set(jobs.queued.map((job) => job.idempotency_key)).size,
    jobs.queued.length,
  );
  assert.deepEqual(result.safety, {
    database_jobs_enqueued: true,
    network_used: false,
    oauth_mutated: false,
    platform_contacted: false,
    publish_authority_created: false,
  });
});

test("governed startup immediately queues exact-window inventory monitoring with a fail-closed payload", () => {
  const jobs = fakeJobs();
  primeGovernedMultiLaneStartup({
    jobs,
    schedulerProfile: "governed_multi_lane",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:07:30.000Z",
  });

  const monitor = jobs.queued.find(
    (job) => job.kind === "governed_youtube_window_inventory_monitor",
  );

  assert.ok(monitor);
  assert.equal(monitor.priority, 5);
  assert.equal(monitor.payload.planning_only, true);
  assert.equal(monitor.payload.bootstrap_catch_up, false);
  assert.equal(monitor.payload.catch_up_allowed, false);
  assert.equal(monitor.payload.external_posting, false);
  assert.equal(monitor.payload.publish_authority, false);
  assert.equal(monitor.payload.human_review_required, true);
  assert.match(
    monitor.idempotency_key,
    /^governed-startup:pulse-gaming:20260728T120000000Z:/,
  );
});

test("the same quarter-hour produces byte-stable idempotent job requests", () => {
  const first = fakeJobs();
  const second = fakeJobs();

  primeGovernedMultiLaneStartup({
    jobs: first,
    schedulerProfile: "governed_multi_lane",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:01:00.000Z",
  });
  primeGovernedMultiLaneStartup({
    jobs: second,
    schedulerProfile: "governed_multi_lane",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:14:59.999Z",
  });

  assert.deepEqual(first.queued, second.queued);
});

test("startup planner requests live routing only when every explicit guarded-live control is armed", () => {
  const jobs = fakeJobs();
  const result = primeGovernedMultiLaneStartup({
    jobs,
    schedulerProfile: "governed_multi_lane",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:07:30.000Z",
    env: {
      PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "false",
      PULSE_KILL_SWITCH: "false",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "f".repeat(64),
    },
  });

  assert.equal(result.status, "PRIMED");
  assert.ok(
    jobs.queued.every((job) => job.payload.live_publish_enabled === true),
  );
});

test("non-governed profiles do not mutate the job queue", () => {
  const jobs = fakeJobs();
  const result = primeGovernedMultiLaneStartup({
    jobs,
    schedulerProfile: "stabilisation_30d",
    channelId: "pulse-gaming",
    now: "2026-07-28T12:07:30.000Z",
  });

  assert.equal(result.status, "SKIPPED");
  assert.equal(result.reason, "governed_multi_lane_profile_not_active");
  assert.deepEqual(jobs.queued, []);
});

test("governed priming fails closed without a durable job queue", () => {
  assert.throws(
    () =>
      primeGovernedMultiLaneStartup({
        jobs: {},
        schedulerProfile: "governed_multi_lane",
        channelId: "pulse-gaming",
        now: "2026-07-28T12:07:30.000Z",
      }),
    /governed_multi_lane_startup_jobs_repository_required/,
  );
});
