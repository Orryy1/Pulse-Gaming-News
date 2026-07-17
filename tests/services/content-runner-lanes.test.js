"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CONTENT_RUNNER_LANES,
  assertSafeContentRunnerLanes,
} = require("../../lib/content-runner-lanes");

test("server-owned content lanes cover durable supply, repair, operations and learning", () => {
  assert.deepEqual(CONTENT_RUNNER_LANES.map((lane) => lane.id), [
    "content-runway",
    "content-repair",
    "content-ops",
    "content-learning",
  ]);
  assert.ok(CONTENT_RUNNER_LANES.flatMap((lane) => lane.kinds).includes("fresh_production_refill"));
  assert.ok(CONTENT_RUNNER_LANES.flatMap((lane) => lane.kinds).includes("autonomous_feedback_monitor"));
  assert.doesNotThrow(() => assertSafeContentRunnerLanes(CONTENT_RUNNER_LANES));
});

test("server-owned content lanes reject live publish and credential jobs", () => {
  for (const kind of ["publish", "publish_window_watchdog", "instagram_token_refresh", "tiktok_auth_check"]) {
    assert.throws(
      () => assertSafeContentRunnerLanes([{ id: "unsafe", kinds: [kind] }]),
      new RegExp(`forbidden.*${kind}`, "i"),
    );
  }
});

test("primary runtime keeps content lanes out of the scheduler process", () => {
  const root = path.resolve(__dirname, "..", "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const launcher = fs.readFileSync(path.join(root, "tools", "local-live-primary-runtime.ps1"), "utf8");
  assert.match(server, /function serverContentRunnerLanesEnabled/);
  assert.match(
    server,
    /additionalRunnerLanes:\s*PROTECTED_PRIMARY_RUNTIME\.enabled\s*\?\s*\[\]\s*:\s*serverContentRunnerLanesEnabled\(process\.env\)/,
  );
  assert.match(server, /CONTENT_RUNNER_LANES/);
  assert.match(launcher, /\$env:PULSE_SERVER_CONTENT_RUNNERS = "false"/);
  assert.doesNotMatch(launcher, /\$env:PULSE_SERVER_CONTENT_RUNNERS = "true"/);
});
