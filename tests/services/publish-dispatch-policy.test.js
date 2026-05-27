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

test("publish dispatch policy blocks publish when AUTO_PUBLISH is disabled", () => {
  const policy = buildPublishDispatchPolicy({
    dispatchSource: "api_autonomous_publish",
    env: { AUTO_PUBLISH: "false" },
  });

  assert.equal(policy.verdict, "red");
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockers.includes("auto_publish_disabled"));
});

test("publish dispatch policy allows explicit manual override only when requested", () => {
  const policy = buildPublishDispatchPolicy({
    dispatchSource: "operator_test",
    env: { AUTO_PUBLISH: "false" },
    allowManualOverride: true,
  });

  assert.equal(policy.verdict, "green");
  assert.equal(policy.blocked, false);
  assert.equal(policy.allowManualOverride, true);
});

test("publish dispatch policy warns on unspecified source", () => {
  const policy = buildPublishDispatchPolicy({
    env: { AUTO_PUBLISH: "true" },
  });

  assert.equal(policy.verdict, "amber");
  assert.equal(policy.blocked, false);
  assert.match(policy.advisory.join("\n"), /unspecified/);
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
