"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const Database = require("better-sqlite3");

// 2026-04-30 safety regression. Phase 1 mirror startup briefly fired
// `scheduler=true runner=true` despite USE_JOB_QUEUE=false in .env —
// because lib/dispatch-mode.js forces production mode when
// RAILWAY_PUBLIC_URL is set. The fix is in lib/bootstrap-queue.js:
// PULSE_PRIMARY_INSTANCE=false MUST refuse to start the scheduler +
// runner regardless of any other flag. This file pins that contract.

const path = require("node:path");
const SERVER_PATH = path.resolve(__dirname, "..", "..", "server.js");
const RUN_PATH = path.resolve(__dirname, "..", "..", "run.js");

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

test("bootstrap-queue reports inactive lease handles truthfully", async () => {
  const previousSqlite = process.env.USE_SQLITE;
  const previousPrimary = process.env.PULSE_PRIMARY_INSTANCE;
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  const bootstrap = loadFreshBootstrap();
  try {
    const state = await bootstrap.start({
      autoSeed: false,
      runRunner: false,
      runBreakingWatcher: false,
      repos: {},
      schedulerStarter() {
        return {
          active: false,
          blocked_reason: "scheduler_lease_unavailable",
          stop() {},
        };
      },
      log() {},
    });
    assert.equal(state.schedulerHandle.active, false);
    assert.equal(state.schedulerActive, false);
    assert.equal(bootstrap.schedulerActive(), false);
  } finally {
    await bootstrap.stop();
    if (previousSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousSqlite;
    if (previousPrimary === undefined) delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = previousPrimary;
  }
});

test("live-guarded bootstrap self-binds the child runtime generation before scheduler start", async () => {
  await withEnv(
    {
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      OPERATING_MODE: "LIVE_GUARDED",
      PULSE_LIVE_RUNTIME_INSTANCE_ID: "ri-11111111-2222-4333-8444-555555555555",
      PULSE_LIVE_AUTHORITY_FINGERPRINT: "a".repeat(64),
    },
    async () => {
      const bootstrap = loadFreshBootstrap();
      let schedulerOptions = null;
      const observed = [];
      try {
        const state = await bootstrap.start({
          workerId: "legacy-unbound-worker",
          autoSeed: false,
          runRunner: false,
          runBreakingWatcher: false,
          repos: {},
          runtimeAuthorityProvider({ env, pid }) {
            observed.push({
              runtime_instance_id: env.PULSE_LIVE_RUNTIME_INSTANCE_ID,
              authority_fingerprint: env.PULSE_LIVE_AUTHORITY_FINGERPRINT,
              pid,
            });
            return {
              runtime_instance_id: env.PULSE_LIVE_RUNTIME_INSTANCE_ID,
              child_pid: pid,
              child_started_at: "2026-08-02T10:00:00.000Z",
              authority_fingerprint: env.PULSE_LIVE_AUTHORITY_FINGERPRINT,
            };
          },
          schedulerStarter(options) {
            schedulerOptions = options;
            return { active: true, stop() {} };
          },
          log() {},
        });

        assert.equal(observed.length, 1);
        assert.equal(observed[0].pid, process.pid);
        assert.deepEqual(schedulerOptions.runtimeAuthority, {
          runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
          child_pid: process.pid,
          child_started_at: "2026-08-02T10:00:00.000Z",
          authority_fingerprint: "a".repeat(64),
        });
        assert.equal(
          state.workerId,
          "server-ri-11111111-2222-4333-8444-555555555555",
        );
      } finally {
        await bootstrap.stop();
      }
    },
  );
});

test("live runtime authority takes PID and canonical start time only from the child process probe", () => {
  const bootstrap = loadFreshBootstrap();
  const probed = [];
  const authority = bootstrap.resolveLiveRuntimeAuthority({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      PULSE_LIVE_RUNTIME_INSTANCE_ID: "ri-11111111-2222-4333-8444-555555555555",
      PULSE_LIVE_AUTHORITY_FINGERPRINT: "a".repeat(64),
      PULSE_LIVE_CHILD_PID: "9999",
      PULSE_LIVE_CHILD_STARTED_AT: "2099-01-01T00:00:00.000Z",
    },
    pid: 4200,
    processIdentityInspector(options) {
      probed.push(options);
      return {
        available: true,
        exists: true,
        process_id: 4200,
        process_started_at: "2026-08-02T10:00:00.000Z",
      };
    },
  });

  assert.deepEqual(probed, [{ pid: 4200 }]);
  assert.deepEqual(authority, {
    runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
    child_pid: 4200,
    child_started_at: "2026-08-02T10:00:00.000Z",
    authority_fingerprint: "a".repeat(64),
  });
  assert.throws(
    () =>
      bootstrap.resolveLiveRuntimeAuthority({
        env: {
          PULSE_OPERATING_MODE: "LIVE_GUARDED",
          PULSE_LIVE_RUNTIME_INSTANCE_ID:
            "ri-11111111-2222-4333-8444-555555555555",
          PULSE_LIVE_AUTHORITY_FINGERPRINT: "a".repeat(64),
        },
        pid: 4200,
        processIdentityInspector() {
          return {
            available: false,
            exists: null,
            process_id: 4200,
            process_started_at: null,
          };
        },
      }),
    /live_runtime_generation_authority_unavailable/,
  );
});

test("bootstrap-queue autoSeed writes through the injected repository", async () => {
  const previousSqlite = process.env.USE_SQLITE;
  const previousPrimary = process.env.PULSE_PRIMARY_INSTANCE;
  const previousDbPath = process.env.SQLITE_DB_PATH;
  const previousProfile = process.env.PULSE_SCHEDULER_PROFILE;
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  process.env.SQLITE_DB_PATH = tempSqlitePath(
    "pulse-bootstrap-injected-repo-singleton-",
  );
  process.env.PULSE_SCHEDULER_PROFILE = "stabilisation_30d";

  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      channel_id TEXT,
      cron_expr TEXT NOT NULL,
      payload TEXT,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT,
      next_run_at TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50
    )
  `);
  const repos = { db };
  const bootstrap = loadFreshBootstrap();
  let receivedRepos = null;

  try {
    await bootstrap.start({
      autoSeed: true,
      runRunner: false,
      runBreakingWatcher: false,
      repos,
      schedulerStarter(options) {
        receivedRepos = options.repos;
        return { active: true, stop() {} };
      },
      log() {},
    });

    assert.equal(receivedRepos, repos);
    assert.ok(
      db.prepare("SELECT COUNT(*) AS count FROM schedules").get().count > 0,
      "the injected repository should receive the selected schedule profile",
    );
  } finally {
    await bootstrap.stop();
    db.close();
    if (previousSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousSqlite;
    if (previousPrimary === undefined)
      delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = previousPrimary;
    if (previousDbPath === undefined) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = previousDbPath;
    if (previousProfile === undefined)
      delete process.env.PULSE_SCHEDULER_PROFILE;
    else process.env.PULSE_SCHEDULER_PROFILE = previousProfile;
  }
});

test("bootstrap-queue releases scheduler ownership when runner startup fails", async () => {
  const previousSqlite = process.env.USE_SQLITE;
  const previousPrimary = process.env.PULSE_PRIMARY_INSTANCE;
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  const bootstrap = loadFreshBootstrap();
  let schedulerStops = 0;
  try {
    await assert.rejects(
      bootstrap.start({
        autoSeed: false,
        repos: {},
        schedulerStarter() {
          return {
            active: true,
            stop() {
              schedulerStops += 1;
            },
          };
        },
        runnerFactory() {
          return {
            async start() {
              throw new Error("runner_start_failed");
            },
            async stop() {},
          };
        },
        log() {},
      }),
      /runner_start_failed/,
    );
    assert.equal(schedulerStops, 1);
    assert.equal(bootstrap.state(), null);
  } finally {
    await bootstrap.stop();
    if (previousSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousSqlite;
    if (previousPrimary === undefined) delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = previousPrimary;
  }
});

test("bootstrap-queue can own the governed continuous breaking watcher and stops it on shutdown", async () => {
  const previousSqlite = process.env.USE_SQLITE;
  const previousPrimary = process.env.PULSE_PRIMARY_INSTANCE;
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  const bootstrap = loadFreshBootstrap();
  let watcherStarts = 0;
  let watcherStops = 0;
  try {
    const state = await bootstrap.start({
      autoSeed: false,
      runScheduler: false,
      runRunner: false,
      runBreakingWatcher: true,
      repos: { jobs: { enqueue() {} } },
      breakingWatcherFactory(options) {
        watcherStarts += 1;
        assert.equal(typeof options.jobs.enqueue, "function");
        return {
          active: true,
          stop() {
            this.active = false;
            watcherStops += 1;
          },
        };
      },
      log() {},
    });

    assert.equal(watcherStarts, 1);
    assert.equal(state.breakingWatcherHandle.active, true);
    await bootstrap.stop();
    assert.equal(watcherStops, 1);
  } finally {
    await bootstrap.stop();
    if (previousSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousSqlite;
    if (previousPrimary === undefined) delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = previousPrimary;
  }
});

test("bootstrap-queue owns the read-only ElevenLabs credit monitor for the managed runtime lifecycle", async () => {
  const previousSqlite = process.env.USE_SQLITE;
  const previousPrimary = process.env.PULSE_PRIMARY_INSTANCE;
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  const bootstrap = loadFreshBootstrap();
  let starts = 0;
  let stops = 0;
  try {
    const state = await bootstrap.start({
      autoSeed: false,
      runScheduler: false,
      runRunner: false,
      runBreakingWatcher: false,
      runCreditMonitor: true,
      repos: {},
      creditMonitorFactory() {
        return {
          async start() {
            starts += 1;
          },
          async stop() {
            stops += 1;
          },
          status() {
            return {
              verdict: "WARN",
              allow_paid_synthesis: true,
            };
          },
        };
      },
      log() {},
    });

    assert.equal(starts, 1);
    assert.equal(
      state.elevenLabsCreditMonitor.status().verdict,
      "WARN",
    );
    await bootstrap.stop();
    assert.equal(stops, 1);
  } finally {
    await bootstrap.stop();
    if (previousSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousSqlite;
    if (previousPrimary === undefined)
      delete process.env.PULSE_PRIMARY_INSTANCE;
    else process.env.PULSE_PRIMARY_INSTANCE = previousPrimary;
  }
});

test("bootstrap-queue leaves the credit monitor disabled unless production explicitly opts in", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    USE_SQLITE: process.env.USE_SQLITE,
    PULSE_PRIMARY_INSTANCE: process.env.PULSE_PRIMARY_INSTANCE,
    ELEVENLABS_CREDIT_MONITOR_ENABLED:
      process.env.ELEVENLABS_CREDIT_MONITOR_ENABLED,
  };
  process.env.NODE_ENV = "production";
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  delete process.env.ELEVENLABS_CREDIT_MONITOR_ENABLED;
  const bootstrap = loadFreshBootstrap();
  let monitorFactoryCalls = 0;

  try {
    const state = await bootstrap.start({
      autoSeed: false,
      runScheduler: false,
      runRunner: false,
      runBreakingWatcher: false,
      repos: {},
      creditMonitorFactory() {
        monitorFactoryCalls += 1;
        throw new Error("unconfigured_monitor_must_not_start");
      },
      log() {},
    });

    assert.equal(monitorFactoryCalls, 0);
    assert.equal(state.elevenLabsCreditMonitor, null);
  } finally {
    await bootstrap.stop();
    for (const [key, oldValue] of Object.entries(previous)) {
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("bootstrap-queue honours the managed production profile's explicit credit-monitor opt-in", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    USE_SQLITE: process.env.USE_SQLITE,
    PULSE_PRIMARY_INSTANCE: process.env.PULSE_PRIMARY_INSTANCE,
    ELEVENLABS_CREDIT_MONITOR_ENABLED:
      process.env.ELEVENLABS_CREDIT_MONITOR_ENABLED,
  };
  process.env.NODE_ENV = "production";
  process.env.USE_SQLITE = "true";
  process.env.PULSE_PRIMARY_INSTANCE = "true";
  process.env.ELEVENLABS_CREDIT_MONITOR_ENABLED = "true";
  const bootstrap = loadFreshBootstrap();
  let monitorStarts = 0;

  try {
    const state = await bootstrap.start({
      autoSeed: false,
      runScheduler: false,
      runRunner: false,
      runBreakingWatcher: false,
      repos: {},
      creditMonitorFactory() {
        return {
          async start() {
            monitorStarts += 1;
          },
          async stop() {},
        };
      },
      log() {},
    });

    assert.equal(monitorStarts, 1);
    assert.ok(state.elevenLabsCreditMonitor);
  } finally {
    await bootstrap.stop();
    for (const [key, oldValue] of Object.entries(previous)) {
      if (oldValue === undefined) delete process.env[key];
      else process.env[key] = oldValue;
    }
  }
});

test("server.js: schedulerActive follows the live scheduler lease state", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  assert.match(src, /const\s+bootstrapState\s*=\s*await\s+bootstrap\.start/);
  assert.match(
    src,
    /schedulerRunning\s*=\s*bootstrapState\?\.schedulerHandle\?\.active\s*===\s*true/,
  );
  assert.match(
    src,
    /function\s+currentSchedulerActive\(\)[\s\S]*schedulerHandle\?\.active\s*===\s*true/,
  );
  assert.match(
    src,
    /schedulerActive:\s*currentSchedulerActive\(\)/,
  );
  assert.doesNotMatch(
    src,
    /await\s+bootstrap\.start\([\s\S]{0,300}?\);\s*schedulerRunning\s*=\s*true/,
    "server.js must not report schedulerActive=true when bootstrap returned observation-only state",
  );
  assert.match(
    src,
    /status:\s*schedulerExpected\s*&&\s*!schedulerActive\s*\?\s*"degraded"\s*:\s*"ok"/,
  );
  assert.match(
    src,
    /const\s+schedulerExpected\s*=\s*dispatchMode\?\.mode\s*===\s*"queue"/,
    "health must derive scheduler expectation from resolved dispatch mode",
  );
});

test("server.js: autonomous status derives its schedule from the active runtime profile", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  assert.match(src, /buildAutonomousScheduleSummary/);
  assert.match(src, /const multiLaneRuntime\s*=/);
  assert.match(
    src,
    /schedule:\s*buildAutonomousScheduleSummary\(multiLaneRuntime\)/,
  );
  assert.match(src, /operator_disabled/);
  assert.doesNotMatch(
    src,
    /profile:\s*"stabilisation_30d"|youtube_only_guarded/,
  );
});

test("server.js: broad autonomous publish endpoint is disabled during stabilisation", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const start = src.indexOf('"/api/autonomous/publish"');
  const end = src.indexOf("// --- Autonomous status ---", start);
  const route = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /res\.status\(423\)\.json/);
  assert.match(route, /stabilisation_multi_platform_publish_disabled/);
  assert.doesNotMatch(route, /publishToAllPlatforms/);
});

test("server.js: broad autonomous cycle and auto-approval endpoints are disabled", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  for (const [routeName, forbiddenCall] of [
    ["/api/autonomous/run", "fullAutonomousCycle"],
    ["/api/autonomous/approve", "autoApprove"],
  ]) {
    const start = src.indexOf(`"${routeName}"`);
    const nextRoute = src.indexOf("\napp.", start);
    const route = src.slice(start, nextRoute);
    assert.ok(start > 0 && nextRoute > start, routeName);
    assert.match(route, /res\.status\(423\)\.json/, routeName);
    assert.match(route, /human_review_required/, routeName);
    assert.doesNotMatch(route, new RegExp(forbiddenCall), routeName);
  }
});

test("server.js: guarded operator admission is the only scheduling mutation route", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const admitStart = src.indexOf('"/api/publication/admit"');
  const scheduleStart = src.indexOf('"/api/schedule"', admitStart);
  const retryStart = src.indexOf('"/api/retry-publish"', scheduleStart);
  const sharedStart = src.indexOf("// --- Shared:", retryStart);
  assert.ok(
    admitStart > 0 &&
      scheduleStart > admitStart &&
      retryStart > scheduleStart &&
      sharedStart > retryStart,
  );

  const admission = src.slice(admitStart, scheduleStart);
  assert.match(admission, /requireAuth/);
  assert.match(admission, /admitPublication/);
  assert.match(admission, /resolveExisting/);
  assert.match(admission, /platform:\s*"youtube"/);
  assert.doesNotMatch(admission, /uploadShort|publishNextStory/);

  const legacySchedule = src.slice(scheduleStart, retryStart);
  assert.match(legacySchedule, /res\.status\(423\)\.json/);
  assert.match(
    legacySchedule,
    /legacy_schedule_disabled_use_publication_admission/,
  );
  assert.doesNotMatch(legacySchedule, /updateStory/);

  const blindRetry = src.slice(retryStart, sharedStart);
  assert.match(blindRetry, /res\.status\(423\)\.json/);
  assert.match(blindRetry, /blind_publish_retry_disabled/);
  assert.doesNotMatch(blindRetry, /updateStory|publishNextStory/);
});

test("server.js: queue bootstrap is not disabled by a missing script-generation key", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const start = src.indexOf(
    "async function startAutonomousScheduler",
  );
  const end = src.indexOf(
    "async function _registerLegacyDevCronRegistry",
    start,
  );
  const bootstrap = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(bootstrap, /bootstrap\.start/);
  assert.doesNotMatch(
    bootstrap,
    /if\s*\(\s*!process\.env\.ANTHROPIC_API_KEY/,
  );
});

test("canonical server and schedule entrypoints start governed breaking discovery by default", () => {
  for (const entrypoint of [SERVER_PATH, RUN_PATH]) {
    const src = fs.readFileSync(entrypoint, "utf8");
    assert.match(
      src,
      /runBreakingWatcher:\s*process\.env\.BREAKING_WATCHER_ENABLED\s*!==\s*"false"/,
      entrypoint,
    );
  }
});

test("server.js: strict scheduler bootstrap failure closes the HTTP listener", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const start = src.lastIndexOf("startAutonomousScheduler().catch");
  const block = src.slice(start, start + 700);
  assert.ok(start > 0);
  assert.match(block, /process\.exitCode\s*=\s*1/);
  assert.match(block, /server\.close/);
});

test("server shutdown releases scheduler ownership before closing SQLite", () => {
  const src = fs.readFileSync(SERVER_PATH, "utf8");
  const start = src.indexOf("async function gracefulShutdown");
  const stop = src.indexOf(
    'await require("./lib/bootstrap-queue").stop()',
    start,
  );
  const close = src.indexOf("db.close()", start);
  assert.ok(start >= 0, "gracefulShutdown must be async");
  assert.ok(stop > start, "queue bootstrap stop must be awaited");
  assert.ok(
    close > stop,
    "SQLite must close only after scheduler/runner leases are released",
  );
});
