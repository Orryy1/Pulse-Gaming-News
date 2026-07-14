"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");

// 2026-04-30 safety regression. Phase 1 mirror startup briefly fired
// `scheduler=true runner=true` despite USE_JOB_QUEUE=false in .env —
// because lib/dispatch-mode.js forces production mode when
// RAILWAY_PUBLIC_URL is set. The fix is in lib/bootstrap-queue.js:
// PULSE_PRIMARY_INSTANCE=false MUST refuse to start the scheduler +
// runner regardless of any other flag. This file pins that contract.

const path = require("node:path");
const SERVER_PATH = path.resolve(__dirname, "..", "..", "server.js");

// We exercise the public start() function via dependency injection
// of a custom log so we can assert without touching real DB / runner.
// The function returns _state for inspection.

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

function withEnv(env, fn) {
  const previous = {};
  for (const k of Object.keys(env)) {
    previous[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(previous)) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

function tempSqlitePath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "pulse-test.db");
}

test("bootstrap-queue: env flag resets persisted schedule payloads on boot", async () => {
  const bootstrapPath = path.resolve(__dirname, "..", "..", "lib", "bootstrap-queue.js");
  const schedulerPath = path.resolve(__dirname, "..", "..", "lib", "scheduler.js");
  const reposPath = path.resolve(__dirname, "..", "..", "lib", "repositories", "index.js");
  const originalCache = new Map([
    [bootstrapPath, require.cache[bootstrapPath]],
    [schedulerPath, require.cache[schedulerPath]],
    [reposPath, require.cache[reposPath]],
  ]);
  const seedCalls = [];
  try {
    require.cache[schedulerPath] = {
      id: schedulerPath,
      filename: schedulerPath,
      loaded: true,
      exports: {
        seed(options) {
          seedCalls.push(options);
        },
        start() {
          throw new Error("scheduler should not start in this test");
        },
      },
    };
    require.cache[reposPath] = {
      id: reposPath,
      filename: reposPath,
      loaded: true,
      exports: {
        getRepos() {
          return {};
        },
      },
    };

    await withEnv(
      {
        USE_SQLITE: "true",
        PULSE_PRIMARY_INSTANCE: "true",
        PULSE_RESET_SCHEDULES_ON_BOOT: "true",
      },
      async () => {
        const bootstrap = loadFreshBootstrap();
        try {
          await bootstrap.start({
            runScheduler: false,
            runRunner: false,
            autoSeed: true,
            log() {},
          });
          assert.equal(seedCalls.length, 1);
          assert.equal(seedCalls[0].reset, true);
        } finally {
          await bootstrap.stop().catch(() => {});
        }
      },
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
});

test("bootstrap-queue: critical maintenance schedules are reconciled without broad reset", async () => {
  const bootstrapPath = path.resolve(__dirname, "..", "..", "lib", "bootstrap-queue.js");
  const schedulerPath = path.resolve(__dirname, "..", "..", "lib", "scheduler.js");
  const reposPath = path.resolve(__dirname, "..", "..", "lib", "repositories", "index.js");
  const originalCache = new Map([
    [bootstrapPath, require.cache[bootstrapPath]],
    [schedulerPath, require.cache[schedulerPath]],
    [reposPath, require.cache[reposPath]],
  ]);
  const seedCalls = [];
  const schedulerRows = new Map([
    [
      "jobs_reap_stale",
      {
        name: "jobs_reap_stale",
        kind: "jobs_reap",
        cron_expr: "*/1 * * * *",
        payload: JSON.stringify({ idempotencyTemplate: "jobs_reap:{date}:{hour}:{minute}" }),
        priority: 99,
      },
    ],
    [
      "publish_primary",
      {
        name: "publish_primary",
        kind: "publish",
        cron_expr: "0 19 * * *",
        payload: JSON.stringify({ idempotencyTemplate: "publish:{date}:19" }),
        priority: 20,
      },
    ],
  ]);
  try {
    require.cache[schedulerPath] = {
      id: schedulerPath,
      filename: schedulerPath,
      loaded: true,
      exports: {
        DEFAULT_SCHEDULES: [
          {
            name: "jobs_reap_stale",
            kind: "jobs_reap",
            cron_expr: "*/1 * * * *",
            priority: 1,
            idempotencyTemplate: "jobs_reap:{date}:{hour}:{minute}",
          },
          {
            name: "publish_primary",
            kind: "publish",
            cron_expr: "0 19 * * *",
            priority: 20,
            idempotencyTemplate: "publish:{date}:19",
          },
        ],
        seed(options) {
          seedCalls.push(options);
        },
        start() {
          throw new Error("scheduler should not start in this test");
        },
      },
    };
    require.cache[reposPath] = {
      id: reposPath,
      filename: reposPath,
      loaded: true,
      exports: {
        getRepos() {
          return {
            db: {
              prepare(sql) {
                if (/SELECT \* FROM schedules WHERE name = \?/i.test(sql)) {
                  return { get: (name) => schedulerRows.get(name) || null };
                }
                if (/UPDATE schedules/i.test(sql)) {
                  return {
                    run(cronExpr, payload, priority, kind, name) {
                      const row = schedulerRows.get(name);
                      schedulerRows.set(name, {
                        ...row,
                        cron_expr: cronExpr,
                        payload,
                        priority,
                        kind,
                      });
                      return { changes: row ? 1 : 0 };
                    },
                  };
                }
                throw new Error(`unexpected SQL: ${sql}`);
              },
            },
          };
        },
      },
    };

    await withEnv(
      {
        USE_SQLITE: "true",
        PULSE_PRIMARY_INSTANCE: "true",
        PULSE_RESET_SCHEDULES_ON_BOOT: undefined,
      },
      async () => {
        const bootstrap = loadFreshBootstrap();
        try {
          await bootstrap.start({
            runScheduler: false,
            runRunner: false,
            autoSeed: true,
            log() {},
          });
        } finally {
          await bootstrap.stop().catch(() => {});
        }
      },
    );

    assert.equal(seedCalls.length, 1);
    assert.equal(seedCalls[0].reset, false);
    assert.equal(schedulerRows.get("jobs_reap_stale").priority, 1);
    assert.equal(schedulerRows.get("publish_primary").priority, 20);
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
});

test("bootstrap-queue: primary runtime starts a dedicated stale-claim maintenance runner", async () => {
  const bootstrapPath = path.resolve(__dirname, "..", "..", "lib", "bootstrap-queue.js");
  const schedulerPath = path.resolve(__dirname, "..", "..", "lib", "scheduler.js");
  const reposPath = path.resolve(__dirname, "..", "..", "lib", "repositories", "index.js");
  const jobsRunnerPath = path.resolve(
    __dirname,
    "..",
    "..",
    "lib",
    "services",
    "jobs-runner.js",
  );
  const originalCache = new Map([
    [bootstrapPath, require.cache[bootstrapPath]],
    [schedulerPath, require.cache[schedulerPath]],
    [reposPath, require.cache[reposPath]],
    [jobsRunnerPath, require.cache[jobsRunnerPath]],
  ]);
  const runnerStarts = [];

  class FakeJobsRunner {
    constructor(options) {
      this.options = options;
    }
    async start() {
      runnerStarts.push(this.options);
    }
    async stop() {}
  }

  try {
    require.cache[schedulerPath] = {
      id: schedulerPath,
      filename: schedulerPath,
      loaded: true,
      exports: {
        DEFAULT_SCHEDULES: [],
        seed() {},
        start() {
          return { stop() {} };
        },
      },
    };
    require.cache[reposPath] = {
      id: reposPath,
      filename: reposPath,
      loaded: true,
      exports: {
        getRepos() {
          return {};
        },
      },
    };
    require.cache[jobsRunnerPath] = {
      id: jobsRunnerPath,
      filename: jobsRunnerPath,
      loaded: true,
      exports: {
        JobsRunner: FakeJobsRunner,
      },
    };

    await withEnv(
      {
        USE_SQLITE: "true",
        PULSE_PRIMARY_INSTANCE: "true",
        PULSE_PUBLISH_CRITICAL_RUNNER: "true",
        PULSE_MAINTENANCE_RUNNER: "true",
      },
      async () => {
        const bootstrap = loadFreshBootstrap();
        try {
          const state = await bootstrap.start({
            workerId: "server-test-123",
            autoSeed: true,
            log() {},
          });

          assert.ok(state.runner, "expected general queue runner");
          assert.ok(state.publishCriticalRunner, "expected publish-critical runner");
          assert.ok(state.maintenanceRunner, "expected dedicated maintenance runner");
          assert.equal(runnerStarts.length, 3);
          assert.deepEqual(runnerStarts.map((runner) => runner.kinds), [
            null,
            ["jobs_reap"],
            [
              "publish_window_watchdog",
              "publish",
              "instagram_token_refresh",
              "tiktok_auth_check",
            ],
          ]);
          assert.equal(runnerStarts[1].workerId, "server-test-123-maintenance");
        } finally {
          await bootstrap.stop().catch(() => {});
        }
      },
    );
  } finally {
    for (const [cachePath, entry] of originalCache.entries()) {
      if (entry) require.cache[cachePath] = entry;
      else delete require.cache[cachePath];
    }
  }
});

test("bootstrap-queue: PULSE_PRIMARY_INSTANCE=false refuses to start scheduler+runner", async () => {
  await withEnv(
    {
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "false",
      RAILWAY_PUBLIC_URL: "https://example.railway.app",
      SQLITE_DB_PATH: tempSqlitePath("pulse-bootstrap-primary-false-"),
    },
    async () => {
      const bootstrap = loadFreshBootstrap();
      const logged = [];
      const log = (msg) => logged.push(msg);
      try {
        const state = await bootstrap.start({
          autoSeed: false,
          log,
          // Even though defaults are scheduler=true and runner=true,
          // primary=false should HARD-OVERRIDE both.
        });
        assert.equal(state.schedulerHandle, null);
        assert.equal(state.runner, null);
        const refusal = logged.find((m) =>
          /PULSE_PRIMARY_INSTANCE=false.*refusing/i.test(m),
        );
        assert.ok(refusal, "expected refusal log line");
      } finally {
        await bootstrap.stop().catch(() => {});
      }
    },
  );
});

test("bootstrap-queue: PULSE_PRIMARY_INSTANCE=false logs the refusal and returns observation-only state", async () => {
  await withEnv(
    {
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "false",
      SQLITE_DB_PATH: tempSqlitePath("pulse-bootstrap-observation-"),
    },
    async () => {
      const bootstrap = loadFreshBootstrap();
      const logged = [];
      try {
        const state = await bootstrap.start({
          autoSeed: false,
          log: (m) => logged.push(m),
        });
        assert.equal(state.schedulerHandle, null);
        assert.equal(state.runner, null);
        // The state still carries the workerId so health/diagnostics
        // can identify the mirror process.
        assert.ok(
          typeof state.workerId === "string" && state.workerId.length > 0,
        );
      } finally {
        await bootstrap.stop().catch(() => {});
      }
    },
  );
});

test("bootstrap-queue: PULSE_PRIMARY_INSTANCE unset defaults to primary=true (Railway behaviour preserved)", () => {
  // We do NOT actually start the bootstrap here (would require a real
  // SQLite handle) — we just verify that lib/deployment-mode.isPrimary
  // returns true when the flag is absent, which is the contract that
  // bootstrap-queue relies on for the unchanged-on-Railway behaviour.
  const original = process.env.PULSE_PRIMARY_INSTANCE;
  delete process.env.PULSE_PRIMARY_INSTANCE;
  try {
    delete require.cache[require.resolve("../../lib/deployment-mode")];
    const dm = require("../../lib/deployment-mode");
    assert.equal(dm.isPrimary(), true);
  } finally {
    if (original === undefined) delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = original;
  }
});

test("bootstrap-queue: PULSE_PRIMARY_INSTANCE=true allows scheduler/runner (does not block the legitimate path)", () => {
  // Same posture as the previous test — verifies the helper alone.
  // Full bootstrap.start() with primary=true requires a SQLite DB,
  // tested implicitly via existing bootstrap callsites.
  const original = process.env.PULSE_PRIMARY_INSTANCE;
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  try {
    delete require.cache[require.resolve("../../lib/deployment-mode")];
    const dm = require("../../lib/deployment-mode");
    assert.equal(dm.isPrimary(), true);
  } finally {
    if (original === undefined) delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = original;
  }
});

test("server.js: schedulerActive follows the actual bootstrap state", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  assert.match(src, /const\s+bootstrapState\s*=\s*await\s+bootstrap\.start/);
  assert.match(
    src,
    /schedulerRunning\s*=\s*!!\(\s*bootstrapState\s*&&\s*\(\s*bootstrapState\.schedulerHandle\s*\|\|\s*bootstrapState\.runner\s*\)/,
  );
  assert.doesNotMatch(
    src,
    /await\s+bootstrap\.start\([\s\S]{0,300}?\);\s*schedulerRunning\s*=\s*true/,
    "server.js must not report schedulerActive=true when bootstrap returned observation-only state",
  );
});
