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
    jobHeartbeats: [],
    workerHeartbeats: [],
  };
  return {
    calls,
    repos: {
      jobs: {
        heartbeat: (jobId, workerId) => {
          calls.jobHeartbeats.push({ jobId, workerId });
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
    },
  ]);
  assert.deepEqual(calls.workerHeartbeats, [
    {
      workerId: "local-content-repair",
      patch: { status: "busy" },
    },
  ]);
});
