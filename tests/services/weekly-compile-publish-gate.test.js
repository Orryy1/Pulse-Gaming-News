"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const weeklyCompile = require("../../weekly_compile");
const { handlers } = require("../../lib/job-handlers");

test("weekly longform upload is not unlocked by AUTO_PUBLISH alone", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "weekly_roundup",
      env: { AUTO_PUBLISH: "true" },
    }),
    false,
  );
});

test("weekly longform upload requires explicit longform and weekly consent", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "weekly_roundup",
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        WEEKLY_ROUNDUP_AUTO_PUBLISH: "true",
      },
    }),
    true,
  );
});

test("topic longform upload requires explicit longform and topic consent", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "topic_compilation",
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        TOPIC_COMPILATION_AUTO_PUBLISH: "true",
      },
    }),
    true,
  );
});

test("scheduled weekly job is disabled unless explicitly enabled", () => {
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: { AUTO_PUBLISH: "true" },
      payload: {},
    }),
    false,
  );
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: { WEEKLY_ROUNDUP_JOB_ENABLED: "true" },
      payload: {},
    }),
    true,
  );
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: {},
      payload: { operator_approved: true },
    }),
    true,
  );
});

test("roundup_weekly job handler skips scheduled legacy compiler by default", async () => {
  const before = {
    WEEKLY_ROUNDUP_JOB_ENABLED: process.env.WEEKLY_ROUNDUP_JOB_ENABLED,
  };
  delete process.env.WEEKLY_ROUNDUP_JOB_ENABLED;
  try {
    const logs = [];
    const result = await handlers.roundup_weekly(
      { payload: {} },
      { log: (line) => logs.push(line), repos: {} },
    );

    assert.deepEqual(result, {
      skipped: true,
      reason: "weekly_roundup_job_not_enabled",
    });
    assert.match(logs.join("\n"), /weekly_roundup_job_not_enabled/);
  } finally {
    if (before.WEEKLY_ROUNDUP_JOB_ENABLED === undefined) {
      delete process.env.WEEKLY_ROUNDUP_JOB_ENABLED;
    } else {
      process.env.WEEKLY_ROUNDUP_JOB_ENABLED = before.WEEKLY_ROUNDUP_JOB_ENABLED;
    }
  }
});
