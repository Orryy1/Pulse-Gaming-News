const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  generalRunnerEnabled,
  launchMissedPublishWindowRecovery,
  PUBLISH_CRITICAL_JOB_KINDS,
  publishCriticalRunnerEnabled,
  normaliseAdditionalRunnerLanes,
} = require("../../lib/bootstrap-queue");

test("bootstrap launches missed-window recovery asynchronously for the primary scheduler", async () => {
  const calls = [];
  const logged = [];
  const report = await launchMissedPublishWindowRecovery({
    runScheduler: true,
    primary: true,
    env: {},
    recover: async () => {
      calls.push("recover");
      return {
        verdict: "green",
        missed_window_count: 3,
        enqueued: true,
        queued_job_id: 99125,
        reason: "missed_window_recovery_ready",
      };
    },
    log: (message) => logged.push(message),
  });

  assert.deepEqual(calls, ["recover"]);
  assert.equal(report.enqueued, true);
  assert.match(logged.join("\n"), /missed-window recovery.*queued job #99125/i);
});

test("bootstrap skips missed-window recovery for observation-only or explicitly disabled runtimes", async () => {
  let calls = 0;
  const recover = async () => {
    calls += 1;
    return {};
  };

  const mirror = await launchMissedPublishWindowRecovery({
    runScheduler: true,
    primary: false,
    env: {},
    recover,
    log() {},
  });
  const disabled = await launchMissedPublishWindowRecovery({
    runScheduler: true,
    primary: true,
    env: { PULSE_MISSED_WINDOW_RECOVERY: "false" },
    recover,
    log() {},
  });

  assert.equal(calls, 0);
  assert.equal(mirror.skipped, true);
  assert.equal(disabled.skipped, true);
});

test("bootstrap queue enables a protected publish lane by default", () => {
  assert.deepEqual(PUBLISH_CRITICAL_JOB_KINDS, [
    "publish_schedule_recovery_monitor",
    "publish_window_watchdog",
    "publish",
    "instagram_token_refresh",
    "tiktok_auth_check",
  ]);
  assert.equal(
    publishCriticalRunnerEnabled({
      runRunner: true,
      kinds: null,
      gpu: false,
      env: {},
    }),
    true,
  );
});

test("bootstrap queue does not add protected publish lane for restricted or GPU workers", () => {
  assert.equal(
    publishCriticalRunnerEnabled({
      runRunner: true,
      kinds: ["fresh_production_refill"],
      gpu: false,
      env: {},
    }),
    false,
  );
  assert.equal(
    publishCriticalRunnerEnabled({
      runRunner: true,
      kinds: null,
      gpu: true,
      env: {},
    }),
    false,
  );
  assert.equal(
    publishCriticalRunnerEnabled({
      runRunner: false,
      kinds: null,
      gpu: false,
      env: {},
    }),
    false,
  );
});

test("bootstrap queue lets operators disable the protected publish lane explicitly", () => {
  for (const value of ["false", "0", "off", "no"]) {
    assert.equal(
      publishCriticalRunnerEnabled({
        runRunner: true,
        kinds: null,
        gpu: false,
        env: { PULSE_PUBLISH_CRITICAL_RUNNER: value },
      }),
      false,
      value,
    );
  }
});

test("bootstrap queue can disable the general all-jobs runner while keeping protected lanes available", () => {
  assert.equal(
    generalRunnerEnabled({
      runRunner: true,
      runGeneralRunner: false,
      kinds: null,
      gpu: false,
      env: {},
    }),
    false,
  );
  assert.equal(
    publishCriticalRunnerEnabled({
      runRunner: true,
      kinds: null,
      gpu: false,
      env: {},
    }),
    true,
  );
});

test("bootstrap queue keeps restricted worker processes on the general runner path", () => {
  assert.equal(
    generalRunnerEnabled({
      runRunner: true,
      runGeneralRunner: false,
      kinds: ["fresh_production_refill"],
      gpu: false,
      env: {},
    }),
    true,
  );
});

test("server starts queue mode without the unrestricted all-jobs runner by default", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  assert.match(source, /function serverGeneralQueueRunnerEnabled/);
  assert.match(
    source,
    /runGeneralRunner:\s*PROTECTED_PRIMARY_RUNTIME\.enabled\s*\?\s*false\s*:\s*serverGeneralQueueRunnerEnabled\(process\.env\)/,
  );
  assert.match(source, /PULSE_SERVER_GENERAL_QUEUE_RUNNER/);
});

test("bootstrap forwards a content-worker claim guard to the restricted runner", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "bootstrap-queue.js"),
    "utf8",
  );
  assert.match(source, /claimGuard\s*=\s*null/);
  assert.match(
    source,
    /runner\s*=\s*new JobsRunner\(\{[\s\S]*?leaseMs,[\s\S]*?claimGuard,/,
  );
});

test("bootstrap forwards bounded handler controls to the restricted runner", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "bootstrap-queue.js"),
    "utf8",
  );

  assert.match(source, /handlerTimeoutMsByKind\s*=\s*null/);
  assert.match(source, /stopOnHandlerTimeout\s*=\s*false/);
  assert.match(source, /onHandlerTimeout\s*=\s*null/);
  assert.match(
    source,
    /runner\s*=\s*new JobsRunner\(\{[\s\S]*?handlerTimeoutMsByKind,[\s\S]*?stopOnHandlerTimeout,[\s\S]*?onHandlerTimeout,/,
  );
});

test("bootstrap validates restricted additional runners", () => {
  assert.deepEqual(
    normaliseAdditionalRunnerLanes([{ id: "runway", kinds: ["fresh_production_refill"] }]),
    [{ id: "runway", kinds: ["fresh_production_refill"], leaseMs: undefined }],
  );
  assert.throws(
    () => normaliseAdditionalRunnerLanes([{ id: "unsafe", kinds: ["publish"] }]),
    /forbidden.*publish/i,
  );
  assert.throws(
    () => normaliseAdditionalRunnerLanes([{ id: "empty", kinds: [] }]),
    /non-empty kinds/i,
  );
});
