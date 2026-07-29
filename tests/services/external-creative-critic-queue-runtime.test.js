"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  schedulesForProfile,
} = require("../../lib/scheduler");

test("governed multi-lane scheduler reconciles the optional critic queue every minute", () => {
  const schedule = schedulesForProfile("governed_multi_lane").find(
    (entry) =>
      entry.name ===
      "external_creative_critic_queue_reconcile",
  );

  assert.ok(schedule);
  assert.equal(
    schedule.kind,
    "external_creative_critic_queue_reconcile",
  );
  assert.equal(schedule.cron_expr, "* * * * *");
  assert.equal(schedule.payload.publish_authority, false);
  assert.equal(schedule.payload.external_posting, false);
});

test("critic queue runtime handler is a no-op when the optional bridge is disabled", async () => {
  let called = false;
  const result =
    await handlers.external_creative_critic_queue_reconcile(
      {
        payload: {
          now: "2026-07-29T09:00:00.000Z",
        },
      },
      {
        env: {
          PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED: "false",
        },
        sweepExternalCreativeCriticQueue: async () => {
          called = true;
        },
      },
    );

  assert.equal(called, false);
  assert.deepEqual(result, {
    enabled: false,
    status: "DISABLED",
    publish_authority: false,
    external_posting: false,
  });
});

test("critic queue runtime handler sweeps only inside PULSE_STATE_ROOT", async () => {
  const stateRoot = path.join(
    os.tmpdir(),
    "pulse-critic-runtime-state",
  );
  const queueRoot = path.join(
    stateRoot,
    "external-creative-critic",
  );
  const calls = [];
  let leaseChecks = 0;
  const result =
    await handlers.external_creative_critic_queue_reconcile(
      {
        payload: {
          now: "2026-07-29T09:00:00.000Z",
        },
      },
      {
        env: {
          PULSE_STATE_ROOT: stateRoot,
          PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED: "true",
          PULSE_EXTERNAL_CRITIC_QUEUE_ROOT: queueRoot,
        },
        sweepExternalCreativeCriticQueue: async (options) => {
          calls.push(options);
          return {
            requested: 1,
            critique_ready: 0,
            timed_out: 0,
            invalid_response: 0,
            already_terminal: 0,
            errors: [],
          };
        },
        assertLeaseHealthy: () => {
          leaseChecks += 1;
        },
      },
    );

  assert.equal(calls.length, 1);
  assert.equal(leaseChecks, 2);
  assert.equal(calls[0].queueRoot, path.resolve(queueRoot));
  assert.deepEqual(calls[0].allowedRoots, [
    path.resolve(stateRoot),
  ]);
  assert.equal(
    calls[0].now,
    "2026-07-29T09:00:00.000Z",
  );
  assert.equal(result.enabled, true);
  assert.equal(result.status, "RECONCILED");
  assert.equal(result.requested, 1);
  assert.equal(result.publish_authority, false);
  assert.equal(result.external_posting, false);
});

test("critic queue runtime handler rejects a queue outside its durable state root", async () => {
  const stateRoot = path.join(
    os.tmpdir(),
    "pulse-critic-runtime-state",
  );
  const outsideRoot = path.join(
    os.tmpdir(),
    "pulse-critic-runtime-outside",
  );

  await assert.rejects(
    handlers.external_creative_critic_queue_reconcile(
      { payload: {} },
      {
        env: {
          PULSE_STATE_ROOT: stateRoot,
          PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED: "true",
          PULSE_EXTERNAL_CRITIC_QUEUE_ROOT: outsideRoot,
        },
      },
    ),
    /critic_queue_root_outside_state_root/,
  );
});

test("critic queue runtime handler requires an absolute durable state root", async () => {
  await assert.rejects(
    handlers.external_creative_critic_queue_reconcile(
      { payload: {} },
      {
        env: {
          PULSE_STATE_ROOT: "relative-state",
          PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED: "true",
        },
      },
    ),
    /critic_queue_state_root_required/,
  );
});

test("critic queue runtime handler never treats the whole state root as its queue", async () => {
  const stateRoot = path.join(
    os.tmpdir(),
    "pulse-critic-runtime-state",
  );

  await assert.rejects(
    handlers.external_creative_critic_queue_reconcile(
      { payload: {} },
      {
        env: {
          PULSE_STATE_ROOT: stateRoot,
          PULSE_EXTERNAL_CRITIC_QUEUE_ENABLED: "true",
          PULSE_EXTERNAL_CRITIC_QUEUE_ROOT: stateRoot,
        },
      },
    ),
    /critic_queue_root_outside_state_root/,
  );
});
