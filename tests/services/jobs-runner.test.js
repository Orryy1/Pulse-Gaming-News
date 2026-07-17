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
