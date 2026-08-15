"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { withRetry } = require("../../lib/retry");

function breaker() {
  const events = [];
  return {
    events,
    beforeAttempt() {
      events.push(["before"]);
      return { allowed: true, probeToken: "probe" };
    },
    recordFailure(error, attempt) {
      events.push(["failure", error.code || error.message, attempt.probeToken]);
    },
    recordSuccess(attempt) {
      events.push(["success", attempt.probeToken]);
    },
  };
}

test("durable breaker wraps a successful retry sequence once", async () => {
  const durable = breaker();
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary");
    return "GREEN";
  }, {
    breaker: durable,
    maxAttempts: 2,
    delays: [0],
    label: "test",
  });
  assert.equal(result, "GREEN");
  assert.equal(calls, 2);
  assert.deepEqual(durable.events, [["before"], ["success", "probe"]]);
});

test("final failure is recorded exactly once", async () => {
  const durable = breaker();
  await assert.rejects(
    () => withRetry(async () => {
      throw Object.assign(new Error("network"), { code: "ETIMEDOUT" });
    }, {
      breaker: durable,
      maxAttempts: 2,
      delays: [0],
      label: "test",
    }),
    /failed after 2 attempts/,
  );
  assert.deepEqual(durable.events, [
    ["before"],
    ["failure", "ETIMEDOUT", "probe"],
  ]);
});

test("non-retriable client error is recorded and rethrown", async () => {
  const durable = breaker();
  const error = new Error("forbidden");
  error.response = { status: 403 };
  await assert.rejects(
    () => withRetry(async () => {
      throw error;
    }, { breaker: durable, maxAttempts: 3, delays: [0], label: "test" }),
    /forbidden/,
  );
  assert.equal(durable.events.length, 2);
  assert.equal(durable.events[1][0], "failure");
});
