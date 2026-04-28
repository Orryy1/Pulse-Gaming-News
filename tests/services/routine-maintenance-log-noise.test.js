"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldLogJobLifecycle } = require("../../lib/services/jobs-runner");
const { shouldLogScheduleEnqueue } = require("../../lib/scheduler");

test("routine jobs_reap lifecycle logs are suppressed on success", () => {
  assert.equal(shouldLogJobLifecycle({ kind: "jobs_reap" }), false);
  assert.equal(shouldLogScheduleEnqueue({ kind: "jobs_reap" }), false);
});

test("non-maintenance jobs still log lifecycle and scheduler enqueue", () => {
  for (const kind of ["publish", "produce", "hunt", "analytics"]) {
    assert.equal(shouldLogJobLifecycle({ kind }), true);
    assert.equal(shouldLogScheduleEnqueue({ kind }), true);
  }
});

test("unknown jobs default to visible logging", () => {
  assert.equal(shouldLogJobLifecycle({ kind: "new_future_job" }), true);
  assert.equal(shouldLogScheduleEnqueue({ kind: "new_future_job" }), true);
});
