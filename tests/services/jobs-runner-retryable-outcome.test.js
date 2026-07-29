"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  JobsRunner,
  RetryableJobOutcomeError,
} = require("../../lib/services/jobs-runner");
const {
  classifyYouTubeAnalyticsSnapshotCompleteness,
} = require("../../lib/services/youtube-analytics-snapshot-jobs");

function claimedJob(id, kind) {
  return {
    id,
    kind,
    attempt_count: 1,
    claim_token: String(id * 10),
  };
}

function runnerFixture({ jobs, handlers }) {
  const calls = [];
  let claimIndex = 0;
  const repos = {
    jobs: {
      claim() {
        return jobs[claimIndex++] || null;
      },
      complete(...args) {
        calls.push(["complete", ...args]);
        return { status: "done" };
      },
      fail(...args) {
        calls.push(["fail", ...args]);
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat() {},
    },
  };
  const runner = new JobsRunner({
    workerId: "retryable-outcome-worker",
    handlers,
    reposProvider: () => repos,
    log() {},
  });
  runner.running = true;
  runner._schedule = () => {};
  return { calls, runner };
}

test("JobsRunner retries an explicit retryable handler outcome instead of poisoning the idempotent job as done", async () => {
  const job = claimedJob(91, "await_material");
  const { calls, runner } = runnerFixture({
    jobs: [job],
    handlers: {
      async await_material() {
        return {
          status: "held",
          job_outcome: "RETRY",
          retryable: true,
          retry_after_seconds: 60,
          blockers: ["final_audio_not_materialised"],
        };
      },
    },
  });

  await runner._tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "fail");
  assert.equal(calls[0][1], job.id);
  assert.equal(calls[0][2], "retryable-outcome-worker");
  assert.equal(calls[0][3], job.claim_token);
  assert.ok(calls[0][4] instanceof RetryableJobOutcomeError);
  assert.equal(calls[0][4].code, "retryable_job_outcome");
  assert.deepEqual(calls[0][4].blockers, [
    "final_audio_not_materialised",
  ]);
  assert.match(
    calls[0][4].message,
    /retryable_job_outcome:final_audio_not_materialised/,
  );
  assert.equal(calls[0][5].retryAfterSeconds, 60);
});

test("JobsRunner still completes an ordinary policy HOLD that does not explicitly request a retry", async () => {
  const job = claimedJob(92, "policy_hold");
  const { calls, runner } = runnerFixture({
    jobs: [job],
    handlers: {
      async policy_hold() {
        return {
          status: "held",
          blockers: ["human_review_pending"],
        };
      },
    },
  });

  await runner._tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "complete");
  assert.equal(calls[0][1], job.id);
});

test("JobsRunner recognises the Analytics reporting-lag classifier as a bounded retry", async () => {
  const job = {
    ...claimedJob(93, "youtube_analytics_snapshot"),
    max_attempts: 4,
  };
  const { calls, runner } = runnerFixture({
    jobs: [job],
    handlers: {
      async youtube_analytics_snapshot() {
        return classifyYouTubeAnalyticsSnapshotCompleteness({
          ingestionResult: {
            status: "no_data",
            sourceRequest: { summary: {} },
            sourcePayload: { summary: { rows: [] } },
            warnings: [],
          },
          job,
          snapshotWindow: "24h",
        });
      },
    },
  });

  await runner._tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "fail");
  assert.equal(calls[0][4].code, "retryable_job_outcome");
  assert.deepEqual(calls[0][4].blockers, [
    "youtube_analytics_summary_reporting_lag",
  ]);
  assert.equal(calls[0][5].retryAfterSeconds, 3600);
});

test("JobsRunner records the exhausted Analytics result as terminal incomplete audit evidence", async () => {
  const job = {
    ...claimedJob(94, "youtube_analytics_snapshot"),
    attempt_count: 4,
    max_attempts: 4,
  };
  const { calls, runner } = runnerFixture({
    jobs: [job],
    handlers: {
      async youtube_analytics_snapshot() {
        return classifyYouTubeAnalyticsSnapshotCompleteness({
          ingestionResult: {
            status: "no_data",
            sourceRequest: { summary: {} },
            sourcePayload: { summary: { rows: [] } },
            warnings: [],
          },
          job,
          snapshotWindow: "24h",
        });
      },
    },
  });

  await runner._tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "complete");
  const auditLog = JSON.parse(calls[0][4].log);
  assert.equal(auditLog.status, "incomplete");
  assert.equal(auditLog.job_outcome, "TERMINAL");
  assert.equal(
    auditLog.completeness_audit.status,
    "TERMINAL_INCOMPLETE",
  );
  assert.equal(auditLog.completeness_audit.terminal, true);
});
