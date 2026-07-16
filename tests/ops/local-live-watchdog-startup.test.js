"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const installerPath = path.join(ROOT, "tools", "install-local-live-watchdog-startup.ps1");

test("startup installer is dry-run by default and confirmation gated", () => {
  const source = fs.readFileSync(installerPath, "utf8");
  assert.match(source, /\[switch\]\$Apply/);
  assert.match(source, /\[switch\]\$OperatorConfirmed/);
  assert.match(source, /if \(\$Apply -and -not \$OperatorConfirmed\)/);
});

test("startup installer creates a windowless shortcut and launches through WMI", () => {
  const source = fs.readFileSync(installerPath, "utf8");
  assert.match(source, /GetFolderPath\("Startup"\)/);
  assert.match(source, /PulseGaming-LiveWatchdog\.lnk/);
  assert.match(source, /CreateShortcut/);
  assert.match(source, /local_live_watchdog_host\.py/);
  assert.match(source, /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/);
  assert.match(source, /host_already_running/);
  assert.match(source, /Copy-Item/);
});

test("startup installer also registers a restartable Task Scheduler supervisor", () => {
  const source = fs.readFileSync(installerPath, "utf8");
  assert.match(source, /PulseGaming-LiveWatchdog-Supervisor/);
  assert.match(source, /New-ScheduledTaskAction/);
  assert.match(source, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(source, /New-ScheduledTaskTrigger -Once/);
  assert.match(source, /New-ScheduledTaskSettingsSet/);
  assert.match(source, /-RestartCount 99/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /Register-ScheduledTask/);
  assert.match(source, /Start-ScheduledTask/);
});

test("windowless host supervises the approved watchdog", () => {
  const host = fs.readFileSync(path.join(ROOT, "tools", "local_live_watchdog_host.py"), "utf8");
  assert.match(host, /local-live-watchdog\.ps1/);
  assert.match(host, /CREATE_NO_WINDOW/);
  assert.match(host, /while True:/);
  assert.match(host, /child\.wait\(\)/);
  assert.match(host, /watchdog_host_error/);
});

test("windowless host enforces one supervisor instance across Task Scheduler and Startup fallback", () => {
  const host = fs.readFileSync(path.join(ROOT, "tools", "local_live_watchdog_host.py"), "utf8");
  assert.match(host, /PulseGamingLiveWatchdogHost/);
  assert.match(host, /CreateMutexW/);
  assert.match(host, /ERROR_ALREADY_EXISTS/);
  assert.match(host, /CloseHandle/);
});

test("live watchdog evaluates publish windows as scalar minute values", () => {
  const watchdog = fs.readFileSync(path.join(ROOT, "tools", "local-live-watchdog.ps1"), "utf8");
  assert.match(watchdog, /@\(\(9 \* 60\), \(11 \* 60\), \(14 \* 60\), \(16 \* 60\), \(19 \* 60\)\)/);
  assert.doesNotMatch(watchdog, /@\(9 \* 60, 11 \* 60/);
});

test("startup installer is exposed as the live watchdog operator command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["ops:install-live-watchdog"], "powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-local-live-watchdog-startup.ps1");
});
