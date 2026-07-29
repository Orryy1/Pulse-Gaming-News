"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

function loadFreshBootstrap() {
  const modulePath = path.resolve(
    __dirname,
    "..",
    "..",
    "lib",
    "bootstrap-queue.js",
  );
  delete require.cache[modulePath];
  return require(modulePath);
}

async function withQueueEnvironment(fn) {
  const names = [
    "USE_SQLITE",
    "PULSE_PRIMARY_INSTANCE",
    "PULSE_MULTI_LANE_WORKERS",
    "PULSE_MULTI_LANE_STARTUP_PRIME",
    "PULSE_SCHEDULER_PROFILE",
    "BREAKING_WATCHER_ENABLED",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  delete process.env.PULSE_MULTI_LANE_WORKERS;
  process.env.BREAKING_WATCHER_ENABLED = "false";
  try {
    return await fn();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function fakeRunnerFactory(created) {
  return (options) => {
    const runner = {
      options,
      starts: 0,
      stops: 0,
      async start() {
        this.starts += 1;
      },
      async stop() {
        this.stops += 1;
        return { drained: true };
      },
    };
    created.push(runner);
    return runner;
  };
}

test("multi-lane workers are the safe default when the primary queue runner starts", async () => {
  await withQueueEnvironment(async () => {
    const bootstrap = loadFreshBootstrap();
    const created = [];
    try {
      const state = await bootstrap.start({
        workerId: "multi-lane-default",
        autoSeed: false,
        runScheduler: false,
        kinds: [
          "publish",
          "governed_editorial_evidence_discovery",
          "prepare_editorial_inventory",
          "reconcile_editorial_inventory",
          "produce_breaking_short",
          "produce_evergreen_short",
          "produce_weekly_longform",
        ],
        extraHandlers: {
          produce_weekly_longform() {},
        },
        repos: {},
        runnerFactory: fakeRunnerFactory(created),
        log() {},
      });

      assert.equal(state.runners.length, 9);
      assert.deepEqual(
        state.runners.map((runner) => runner.options.poolId),
        [
          "editorial_evidence_capture",
          "editorial_evidence_capture",
          "editorial_preparation",
          "critical_publication",
          "critical_publication",
          "breaking_production",
          "breaking_production",
          "evergreen_production",
          "longform_production",
        ],
      );
      const criticalPublication = state.runners.find(
        (runner) =>
          runner.options.poolId === "critical_publication",
      );
      assert.equal(
        criticalPublication.options.leaseMs,
        90_000,
      );
      assert.equal(
        criticalPublication.options.heartbeatMs,
        20_000,
      );
    } finally {
      await bootstrap.stop();
    }
  });
});

test("the governed breaking watcher is default-on unless the operator explicitly disables it", async () => {
  await withQueueEnvironment(async () => {
    delete process.env.BREAKING_WATCHER_ENABLED;
    const bootstrap = loadFreshBootstrap();
    let starts = 0;
    try {
      const state = await bootstrap.start({
        workerId: "watcher-default",
        autoSeed: false,
        runScheduler: false,
        runRunner: false,
        repos: {},
        breakingWatcherFactory() {
          starts += 1;
          return {
            active: true,
            stop() {},
          };
        },
        log() {},
      });

      assert.equal(starts, 1);
      assert.equal(state.breakingWatcherHandle.active, true);
    } finally {
      await bootstrap.stop();
    }
  });
});

test("an operator can explicitly fall back to one compatibility runner", async () => {
  await withQueueEnvironment(async () => {
    process.env.PULSE_MULTI_LANE_WORKERS = "false";
    const bootstrap = loadFreshBootstrap();
    const created = [];
    try {
      const state = await bootstrap.start({
        workerId: "single-runner-override",
        autoSeed: false,
        runScheduler: false,
        kinds: [
          "produce_breaking_short",
          "produce_evergreen_short",
          "produce_weekly_longform",
        ],
        extraHandlers: {
          produce_weekly_longform() {},
        },
        repos: {},
        runnerFactory: fakeRunnerFactory(created),
        log() {},
      });

      assert.equal(state.runners.length, 1);
      assert.equal(state.runners[0].options.poolId, undefined);
    } finally {
      await bootstrap.stop();
    }
  });
});

test("opt-in multi-lane bootstrap starts isolated kind-filtered runners and preserves runner compatibility", async () => {
  await withQueueEnvironment(async () => {
    const bootstrap = loadFreshBootstrap();
    const created = [];
    try {
      const state = await bootstrap.start({
        workerId: "multi-lane-test",
        autoSeed: false,
        runScheduler: false,
        multiLaneWorkers: true,
        kinds: [
          "produce_breaking_short",
          "produce_weekly_longform",
          "publish",
        ],
        extraHandlers: {
          produce_weekly_longform() {},
        },
        repos: {},
        runnerFactory: fakeRunnerFactory(created),
        log() {},
      });

      assert.equal(created.length, 5);
      assert.equal(state.runners.length, 5);
      assert.equal(state.runner, state.runners[0]);
      assert.equal(
        new Set(created.map((runner) => runner.options.workerId)).size,
        5,
      );
      assert.deepEqual(
        created.map((runner) => runner.options.kinds),
        [
          ["publish"],
          ["publish"],
          ["produce_breaking_short"],
          ["produce_breaking_short"],
          ["produce_weekly_longform"],
        ],
      );
      assert.ok(created.every((runner) => runner.starts === 1));

      const stopped = await bootstrap.stop();
      assert.equal(stopped.runnerDrained, true);
      assert.ok(created.every((runner) => runner.stops === 1));
    } finally {
      await bootstrap.stop();
    }
  });
});

test("partial multi-runner startup failure stops every created runner and releases the scheduler", async () => {
  await withQueueEnvironment(async () => {
    const bootstrap = loadFreshBootstrap();
    const created = [];
    let schedulerStops = 0;
    try {
      await assert.rejects(
        bootstrap.start({
          workerId: "multi-lane-partial-start",
          autoSeed: false,
          runScheduler: true,
          multiLaneWorkers: true,
          kinds: [
            "publish",
            "produce_breaking_short",
            "produce_weekly_longform",
          ],
          extraHandlers: {
            produce_weekly_longform() {},
          },
          repos: {},
          schedulerStarter() {
            return {
              active: true,
              stop() {
                schedulerStops += 1;
              },
            };
          },
          runnerFactory(options) {
            const ordinal = created.length + 1;
            const runner = {
              options,
              stops: 0,
              async start() {
                if (ordinal === 3) {
                  throw new Error("third_runner_start_failed");
                }
              },
              async stop() {
                this.stops += 1;
                return { drained: true };
              },
            };
            created.push(runner);
            return runner;
          },
          log() {},
        }),
        /third_runner_start_failed/,
      );

      assert.equal(created.length, 3);
      assert.ok(created.every((runner) => runner.stops === 1));
      assert.equal(schedulerStops, 1);
      assert.equal(bootstrap.state(), null);
    } finally {
      await bootstrap.stop();
    }
  });
});

test("shutdown attempts every runner and reports an aggregate drain failure", async () => {
  await withQueueEnvironment(async () => {
    const bootstrap = loadFreshBootstrap();
    const created = [];
    try {
      await bootstrap.start({
        workerId: "multi-lane-drain",
        autoSeed: false,
        runScheduler: false,
        multiLaneWorkers: true,
        kinds: ["publish", "produce_breaking_short"],
        repos: {},
        runnerFactory(options) {
          const ordinal = created.length + 1;
          const runner = {
            options,
            stops: 0,
            async start() {},
            async stop() {
              this.stops += 1;
              if (ordinal === 2) {
                throw new Error("runner_stop_failed");
              }
              return { drained: ordinal !== 1 };
            },
          };
          created.push(runner);
          return runner;
        },
        log() {},
      });

      const result = await bootstrap.stop();

      assert.equal(created.length, 4);
      assert.ok(created.every((runner) => runner.stops === 1));
      assert.equal(result.runnerDrained, false);
      assert.equal(bootstrap.state(), null);
    } finally {
      await bootstrap.stop();
    }
  });
});

test("governed scheduler startup immediately primes lane work, window inventory monitoring and the durable YouTube checkpoint horizon", async () => {
  await withQueueEnvironment(async () => {
    process.env.PULSE_SCHEDULER_PROFILE = "governed_multi_lane";
    const bootstrap = loadFreshBootstrap();
    const queued = [];
    let schedulerStops = 0;
    try {
      const state = await bootstrap.start({
        workerId: "governed-prime",
        autoSeed: false,
        runScheduler: true,
        runRunner: false,
        runBreakingWatcher: false,
        startupNow: "2026-07-28T12:07:30.000Z",
        repos: {
          jobs: {
            enqueue(request) {
              const row = { id: queued.length + 1, ...request };
              queued.push(row);
              return row;
            },
          },
        },
        schedulerStarter() {
          return {
            active: true,
            stop() {
              schedulerStops += 1;
            },
          };
        },
        log() {},
      });

      assert.equal(state.startupPrime.status, "PRIMED");
      assert.equal(
        state.windowCheckpointPrime.status,
        "PRIMED",
      );
      assert.deepEqual(
        queued
          .filter((job) =>
            [
              "governed_youtube_window_inventory_monitor",
              "hunt",
              "governed_editorial_evidence_backfill",
              "reconcile_editorial_inventory",
              "governed_multi_lane_plan",
              "evergreen_candidate_builder",
              "plan_weekly_longform",
            ].includes(job.kind),
          )
          .map((job) => job.kind),
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
      const startupMonitor = queued.find(
        (job) =>
          job.kind ===
          "governed_youtube_window_inventory_monitor",
      );
      assert.equal(startupMonitor.payload.catch_up_allowed, false);
      assert.equal(startupMonitor.payload.external_posting, false);
      assert.equal(startupMonitor.payload.publish_authority, false);
      assert.deepEqual(
        queued
          .filter((job) =>
            [
              "governed_youtube_runway_t90",
              "governed_youtube_runway_tplus15",
            ].includes(job.kind),
          )
          .map((job) => [
            job.kind,
            job.run_at,
            job.idempotency_key,
          ]),
        [
          [
            "governed_youtube_runway_t90",
            "2026-07-28T17:30:00.000Z",
            "governed_youtube_runway_t90:2026-07-28:19",
          ],
          [
            "governed_youtube_runway_tplus15",
            "2026-07-28T19:15:00.000Z",
            "governed_youtube_runway_tplus15:2026-07-28:19",
          ],
          [
            "governed_youtube_runway_t90",
            "2026-07-29T07:30:00.000Z",
            "governed_youtube_runway_t90:2026-07-29:09",
          ],
          [
            "governed_youtube_runway_tplus15",
            "2026-07-29T09:15:00.000Z",
            "governed_youtube_runway_tplus15:2026-07-29:09",
          ],
          [
            "governed_youtube_runway_t90",
            "2026-07-29T17:30:00.000Z",
            "governed_youtube_runway_t90:2026-07-29:19",
          ],
          [
            "governed_youtube_runway_tplus15",
            "2026-07-29T19:15:00.000Z",
            "governed_youtube_runway_tplus15:2026-07-29:19",
          ],
        ],
      );
      assert.ok(
        queued.every(
          (job) =>
            job.payload.live_publish_enabled === false &&
            job.payload.publish_authority === false,
        ),
      );
    } finally {
      await bootstrap.stop();
    }
    assert.equal(schedulerStops, 1);
  });
});
