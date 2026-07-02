const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const watchdogPath = path.join(__dirname, "..", "..", "tools", "local-live-watchdog.ps1");

test("local live watchdog checks runtime health and polls quickly enough for publish windows", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /\[int\]\$IntervalSeconds\s*=\s*15\b/);
  assert.match(source, /Invoke-RestMethod[\s\S]+\/api\/health/);
  assert.match(source, /runtime_unhealthy starting_primary_runtime/);
  assert.match(source, /"-Restart"/);
});

test("local live watchdog does not restart an existing runtime on a transient publish-window health timeout", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /\[int\]\$UnhealthyRestartThreshold\s*=\s*3\b/);
  assert.match(source, /\[int\]\$PublishWindowGuardBeforeMinutes\s*=\s*10\b/);
  assert.match(source, /\[int\]\$PublishWindowGuardAfterMinutes\s*=\s*35\b/);
  assert.match(source, /function Test-InCriticalPublishWindow/);
  assert.match(source, /runtime_unhealthy_publish_window_guard skip_restart/);
  assert.match(source, /\$consecutiveUnhealthy\s+-lt\s+\$UnhealthyRestartThreshold/);
});

test("local live watchdog keeps non-publish content workers alive", () => {
  const source = fs.readFileSync(watchdogPath, "utf8");

  assert.match(source, /local-live-content-workers\.ps1/);
  assert.match(source, /\$contentWorkersScript/);
  assert.match(source, /content_workers_check ensuring_content_workers/);
  assert.match(source, /-File",\s*\$contentWorkersScript/);
  assert.doesNotMatch(source, /content_workers_check[\s\S]{0,400}"-Restart"/);
});
