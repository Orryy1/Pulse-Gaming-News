"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  buildMultiLaneWorkerDefinitions,
} = require("../../lib/services/multi-lane-worker-topology");

test("pre-T90 preparation is registered on the isolated deadline workers", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      prepare_governed_autonomous_pre_t90_window:
        handlers.prepare_governed_autonomous_pre_t90_window,
    },
  });

  assert.deepEqual(definitions, [
    {
      pool_id: "window_deadline",
      instances: 2,
      lease_ms: 90_000,
      heartbeat_ms: 20_000,
      kinds: [
        "prepare_governed_autonomous_pre_t90_window",
      ],
    },
  ]);
});

test("pre-T90 handler derives a closed no-authority request from the durable window job", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-handler-"),
  );
  const calls = [];
  const preparation = await handlers[
    "prepare_governed_autonomous_pre_t90_window"
  ](
    {
      id: 431,
      kind: "prepare_governed_autonomous_pre_t90_window",
      channel_id: "pulse-gaming",
      payload: {
        scheduled_for: "2026-07-30T09:00:00.000Z",
        now: "2026-07-30T07:26:20.000Z",
        attempt_output_root: "C:\\attacker-controlled",
        catch_up_allowed: true,
        publish_authority: true,
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      repos: { db: {}, runtimeLeases: {} },
      governedAutonomousPreT90Dependencies: {
        marker: "injected-test-options",
      },
      async runGovernedAutonomousPreT90WindowPreparation(
        request,
        options,
      ) {
        calls.push({ request, options });
        return {
          verdict: "GREEN",
          blockers: [],
          publish_authority_created: false,
          external_posting: false,
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, {
    schema_version:
      "pulse-governed-autonomous-pre-t90-window-runner-request-v1",
    mode: "LOCAL_PROOF",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    attempt_output_root: path.join(
      workspaceRoot,
      "output",
      "governed-autonomous-pre-t90",
      "2026-07-30",
      "0900",
      "attempt-431",
    ),
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  });
  assert.equal(calls[0].options.workspaceRoot, workspaceRoot);
  assert.equal(
    calls[0].options.marker,
    "injected-test-options",
  );
  assert.equal(preparation.status, "pre_t90_window_prepared");
  assert.equal(preparation.verdict, "GREEN");
  assert.equal(preparation.publish_authority_created, false);
  assert.equal(preparation.no_external_posting, true);
  assert.equal(preparation.catch_up_allowed, false);
});

test("pre-T90 handler rejects a malformed or non-guarded window before orchestration", async () => {
  let called = false;
  const result = await handlers[
    "prepare_governed_autonomous_pre_t90_window"
  ](
    {
      id: 432,
      kind: "prepare_governed_autonomous_pre_t90_window",
      payload: {
        scheduled_for: "2026-07-30T11:00:00.000Z",
      },
    },
    {
      async runGovernedAutonomousPreT90WindowPreparation() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "governed_autonomous_pre_t90_window_invalid",
  ]);
  assert.equal(result.catch_up_allowed, false);
});

test("pre-T90 handler cannot reinterpret a non-GREEN result as prepared", async () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-handler-hold-"),
  );
  const result = await handlers[
    "prepare_governed_autonomous_pre_t90_window"
  ](
    {
      id: 433,
      kind: "prepare_governed_autonomous_pre_t90_window",
      payload: {
        scheduled_for: "2026-07-30T19:00:00.000Z",
        now: "2026-07-30T17:26:20.000Z",
      },
    },
    {
      autonomousProductionWorkspaceRoot: workspaceRoot,
      repos: { db: {}, runtimeLeases: {} },
      governedAutonomousPreT90Dependencies: {},
      async runGovernedAutonomousPreT90WindowPreparation() {
        return {
          verdict: "HOLD",
          blockers: ["missing_standby_receipt"],
          publish_authority_created: false,
          external_posting: false,
        };
      },
    },
  );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.deepEqual(result.blockers, [
    "missing_standby_receipt",
  ]);
  assert.equal(result.no_external_posting, true);
});
