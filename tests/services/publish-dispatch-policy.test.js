"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPublishDispatchPolicy,
  truthy,
} = require("../../lib/services/publish-dispatch-policy");
const { renderPublishSummary } = require("../../lib/job-handlers");

const ROOT = path.resolve(__dirname, "..", "..");

function liveEnv(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_CONTROL_TOWER_VERDICT: "GREEN",
    PULSE_KILL_SWITCH_HEALTHY: "true",
    ...overrides,
  };
}

test("publish dispatch policy blocks publish when AUTO_PUBLISH is disabled", () => {
  const policy = buildPublishDispatchPolicy({
    dispatchSource: "api_autonomous_publish",
    env: { AUTO_PUBLISH: "false" },
  });

  assert.equal(policy.verdict, "red");
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockers.includes("auto_publish_disabled"));
});

test("manual override cannot bypass the authoritative operating mode", () => {
  const policy = buildPublishDispatchPolicy({
    dispatchSource: "operator_test",
    env: { AUTO_PUBLISH: "false" },
    allowManualOverride: true,
  });

  assert.equal(policy.verdict, "red");
  assert.equal(policy.blocked, true);
  assert.equal(policy.allowManualOverride, true);
  assert.ok(policy.blockers.includes("live_guarded_mode_required"));
});

test("publish dispatch policy warns on unspecified source", () => {
  const policy = buildPublishDispatchPolicy({
    env: liveEnv(),
  });

  assert.equal(policy.verdict, "amber");
  assert.equal(policy.blocked, false);
  assert.match(policy.advisory.join("\n"), /unspecified/);
});

test("publish dispatch policy permits a fully evidenced LIVE_GUARDED route", () => {
  const policy = buildPublishDispatchPolicy({
    dispatchSource: "scheduler_job",
    env: liveEnv(),
  });

  assert.equal(policy.verdict, "green");
  assert.equal(policy.blocked, false);
  assert.equal(policy.operatingContract.mode, "LIVE_GUARDED");
});

test("renderPublishSummary explains dispatch-policy blocks", () => {
  const summary = renderPublishSummary({
    publish_dispatch_blocked: true,
    top_reason: "auto_publish_disabled",
    publish_dispatch: {
      dispatchSource: "cli_publish",
      autoPublish: false,
    },
  }, { jobId: 99 });

  assert.equal(summary.status, "failed");
  assert.match(summary.message, /Publish blocked by dispatch policy/);
  assert.match(summary.message, /AUTO_PUBLISH: false/);
  assert.match(summary.message, /auto_publish_disabled/);
});

test("publisher direct routes are centrally gated and carry precise source metadata", () => {
  const publisher = fs.readFileSync(path.join(ROOT, "publisher.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const run = fs.readFileSync(path.join(ROOT, "run.js"), "utf8");
  const breaking = fs.readFileSync(path.join(ROOT, "breaking_queue.js"), "utf8");

  assert.match(publisher, /buildPublishDispatchPolicy/);
  assert.match(publisher, /publish_dispatch_blocked/);
  assert.match(server, /dispatchSource:\s*"api_autonomous_run"/);
  assert.match(server, /dispatchSource:\s*"api_autonomous_publish"/);
  assert.match(server, /guardedLivePublishArmed\(process\.env\)/);
  assert.match(server, /handleGuardedLiveDispatchPublish/);
  assert.ok(
    server.indexOf("guardedLivePublishArmed(process.env)") <
      server.indexOf("publishToAllPlatforms({ dispatchSource: \"api_autonomous_publish\" })"),
    "guarded live dispatch branch must run before legacy API publish fallback",
  );
  assert.match(run, /dispatchSource:\s*"cli_full"/);
  assert.match(run, /dispatchSource:\s*"cli_publish"/);
  assert.match(breaking, /dispatchSource:\s*"breaking_fast_lane"/);
  assert.match(breaking, /storyId:\s*story\.id/);
});

test("truthy handles publish env flag spellings", () => {
  assert.equal(truthy("true"), true);
  assert.equal(truthy("1"), true);
  assert.equal(truthy("yes"), true);
  assert.equal(truthy("false"), false);
  assert.equal(truthy(""), false);
});
