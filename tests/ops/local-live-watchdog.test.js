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
