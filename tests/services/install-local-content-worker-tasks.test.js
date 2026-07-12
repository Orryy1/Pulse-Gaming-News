"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const script = fs.readFileSync(
  path.join(__dirname, "..", "..", "tools", "install-local-content-worker-tasks.ps1"),
  "utf8",
);
const host = fs.readFileSync(
  path.join(__dirname, "..", "..", "tools", "local-content-workers-host.ps1"),
  "utf8",
);
const taskWrapper = fs.readFileSync(
  path.join(__dirname, "..", "..", "tools", "local-content-worker-task.ps1"),
  "utf8",
);

test("content worker task installer is confirmation gated and restartable", () => {
  assert.match(script, /\[switch\]\$Apply/);
  assert.match(script, /\[switch\]\$OperatorConfirmed/);
  assert.match(script, /Refusing to install/);
  assert.match(script, /Register-ScheduledTask/);
  assert.match(script, /Start-ScheduledTask/);
  assert.match(script, /New-ScheduledTaskTrigger -Once/);
  assert.match(script, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(script, /-Trigger @\(\$logonTrigger, \$independentStartTrigger\)/);
  assert.match(script, /Unregister-ScheduledTask -TaskName \$taskName/);
  assert.match(script, /-RestartCount 99/);
  assert.match(script, /-AllowStartIfOnBatteries/);
  assert.match(script, /-DontStopIfGoingOnBatteries/);
});

test("content worker tasks cover all non-publish lanes", () => {
  for (const lane of ["runway", "repair", "ops", "learning"]) {
    assert.match(script, new RegExp(`PulseGaming-Content-${lane}`, "i"));
  }
  assert.match(host, /local-live-content-workers\.ps1/);
  assert.match(script, /local-content-worker-task\.ps1/);
  assert.match(script, /powershell\.exe/);
  assert.match(script, /Register-ScheduledTask -TaskName \$lane\.Task/);
  assert.match(taskWrapper, /local-sqlite-content-worker\.js/);
  assert.match(taskWrapper, /"--worker-id"/);
  assert.match(taskWrapper, /"--kinds"/);
  assert.match(script, /PulseGaming-Content-Host/);
  assert.match(host, /Start-Sleep -Seconds 15/);
  assert.match(taskWrapper, /USE_SQLITE\s*=\s*"true"/);
  assert.match(taskWrapper, /SQLITE_DB_PATH\s*=\s*"D:\/pulse-data\/pulse\.db"/);
  assert.match(taskWrapper, /PULSE_PRIMARY_INSTANCE\s*=\s*"true"/);
  assert.match(taskWrapper, /RedirectStandardOutput/);
  assert.match(taskWrapper, /RedirectStandardError/);
  assert.doesNotMatch(`${script}\n${host}`, /publish_window_watchdog|instagram_token_refresh|tiktok_auth_check/);
});
