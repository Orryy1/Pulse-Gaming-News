const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  generalRunnerEnabled,
  PUBLISH_CRITICAL_JOB_KINDS,
  publishCriticalRunnerEnabled,
  normaliseAdditionalRunnerLanes,
} = require("../../lib/bootstrap-queue");

test("bootstrap queue enables a protected publish lane by default", () => {
  assert.deepEqual(PUBLISH_CRITICAL_JOB_KINDS, [
    "publish_window_watchdog",
    "publish",
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
  assert.match(source, /runGeneralRunner:\s*serverGeneralQueueRunnerEnabled\(process\.env\)/);
  assert.match(source, /PULSE_SERVER_GENERAL_QUEUE_RUNNER/);
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
