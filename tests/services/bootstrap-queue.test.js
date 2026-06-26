const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PUBLISH_CRITICAL_JOB_KINDS,
  publishCriticalRunnerEnabled,
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
