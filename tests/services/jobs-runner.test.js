const test = require("node:test");
const assert = require("node:assert/strict");

function loadJobsRunnerWithRepos(t, repos) {
  const repositoriesPath = require.resolve("../../lib/repositories");
  const runnerPath = require.resolve("../../lib/services/jobs-runner");
  const originalRepositories = require.cache[repositoriesPath];
  const originalRunner = require.cache[runnerPath];

  delete require.cache[runnerPath];
  require.cache[repositoriesPath] = {
    id: repositoriesPath,
    filename: repositoriesPath,
    loaded: true,
    exports: { getRepos: () => repos },
  };

  const loaded = require("../../lib/services/jobs-runner");

  t.after(() => {
    delete require.cache[runnerPath];
    if (originalRunner) {
      require.cache[runnerPath] = originalRunner;
    }
    if (originalRepositories) {
      require.cache[repositoriesPath] = originalRepositories;
    } else {
      delete require.cache[repositoriesPath];
    }
  });

  return loaded;
}

function fakeRepos() {
  const calls = {
    claims: [],
    jobHeartbeats: [],
    workerHeartbeats: [],
  };
  return {
    calls,
    repos: {
      jobs: {
        claim: (workerId, options) => {
          calls.claims.push({ workerId, options });
          return null;
        },
        heartbeat: (jobId, workerId, leaseMs) => {
          calls.jobHeartbeats.push({ jobId, workerId, leaseMs });
        },
      },
      workers: {
        heartbeat: (workerId, patch) => {
          calls.workerHeartbeats.push({ workerId, patch });
        },
      },
    },
  };
}

test("JobsRunner heartbeat keeps idle worker rows fresh", (t) => {
  const { calls, repos } = fakeRepos();
  const { JobsRunner } = loadJobsRunnerWithRepos(t, repos);

  const runner = new JobsRunner({
    workerId: "local-content-runway",
    handlers: {},
    log: () => {},
  });
  runner.running = true;
  runner.current = null;

  runner._heartbeat();

  assert.deepEqual(calls.jobHeartbeats, []);
  assert.deepEqual(calls.workerHeartbeats, [
    {
      workerId: "local-content-runway",
      patch: { status: "idle" },
    },
  ]);
});

test("JobsRunner heartbeat renews current job lease while busy", (t) => {
  const { calls, repos } = fakeRepos();
  const { JobsRunner } = loadJobsRunnerWithRepos(t, repos);

  const runner = new JobsRunner({
    workerId: "local-content-repair",
    handlers: {},
    log: () => {},
  });
  runner.running = true;
  runner.current = { id: 42 };

  runner._heartbeat();

  assert.deepEqual(calls.jobHeartbeats, [
    {
      jobId: 42,
      workerId: "local-content-repair",
      leaseMs: undefined,
    },
  ]);
  assert.deepEqual(calls.workerHeartbeats, [
    {
      workerId: "local-content-repair",
      patch: { status: "busy" },
    },
  ]);
});

test("JobsRunner uses its configured lease for claims and heartbeats", async (t) => {
  const { calls, repos } = fakeRepos();
  const { JobsRunner } = loadJobsRunnerWithRepos(t, repos);
  const runner = new JobsRunner({
    workerId: "local-content-runway",
    handlers: {},
    leaseMs: 30 * 60 * 1000,
    log: () => {},
  });
  runner.running = true;
  runner._schedule = () => {};

  await runner._tick();
  runner.current = { id: 73 };
  runner._heartbeat();

  assert.equal(calls.claims[0].options.leaseMs, 30 * 60 * 1000);
  assert.deepEqual(calls.jobHeartbeats[0], {
    jobId: 73,
    workerId: "local-content-runway",
    leaseMs: 30 * 60 * 1000,
  });
});

test("JobsRunner does not claim while its claim guard is closed", async (t) => {
  const { calls, repos } = fakeRepos();
  const { JobsRunner } = loadJobsRunnerWithRepos(t, repos);
  const runner = new JobsRunner({
    workerId: "local-content-runway",
    handlers: {},
    claimGuard: () => ({ allow_claim: false, retry_after_ms: 5000 }),
    log: () => {},
  });
  runner.running = true;
  let scheduledDelay = null;
  runner._schedule = (delay) => {
    scheduledDelay = delay;
  };

  await runner._tick();

  assert.equal(calls.claims.length, 0);
  assert.equal(scheduledDelay, 5000);
});

test("JobsRunner fails closed and stops after a bounded handler timeout", async (t) => {
  const timedOutJob = {
    id: 91,
    kind: "publish_schedule_recovery_monitor",
    attempt_count: 0,
  };
  const calls = {
    claims: 0,
    failures: [],
    workerHeartbeats: [],
    timeouts: [],
  };
  const repos = {
    jobs: {
      claim: () => {
        calls.claims += 1;
        return calls.claims === 1 ? timedOutJob : null;
      },
      fail: (jobId, error, options) => {
        calls.failures.push({ jobId, error, options });
        return { status: "pending" };
      },
    },
    workers: {
      heartbeat: (workerId, patch) => {
        calls.workerHeartbeats.push({ workerId, patch });
      },
    },
  };
  const { JobsRunner } = loadJobsRunnerWithRepos(t, repos);
  const runner = new JobsRunner({
    workerId: "pulse-live-publish-critical",
    handlers: {
      publish_schedule_recovery_monitor: () => new Promise(() => {}),
    },
    handlerTimeoutMsByKind: {
      publish_schedule_recovery_monitor: 15,
    },
    stopOnHandlerTimeout: true,
    onHandlerTimeout: (error, job) => {
      calls.timeouts.push({ error, job });
    },
    log: () => {},
  });
  runner.running = true;
  runner._heartbeatHandle = setInterval(() => {}, 60_000);
  let scheduled = 0;
  runner._schedule = () => {
    scheduled += 1;
  };

  await runner._tick();

  assert.equal(calls.claims, 1);
  assert.equal(calls.failures.length, 1);
  assert.equal(calls.failures[0].jobId, timedOutJob.id);
  assert.equal(calls.failures[0].error.code, "JOB_HANDLER_TIMEOUT");
  assert.equal(calls.failures[0].error.jobId, timedOutJob.id);
  assert.equal(calls.failures[0].error.kind, timedOutJob.kind);
  assert.equal(calls.timeouts.length, 1);
  assert.equal(calls.timeouts[0].job, timedOutJob);
  assert.equal(runner.running, false);
  assert.equal(runner.current, null);
  assert.equal(runner._heartbeatHandle, null);
  assert.equal(scheduled, 0);
});
