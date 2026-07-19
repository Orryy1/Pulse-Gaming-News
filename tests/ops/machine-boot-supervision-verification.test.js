"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const doctorPath = path.join(ROOT, "tools", "machine-boot-supervision-doctor.ps1");
const policyPath = path.join(ROOT, "tools", "local-live-watchdog-policy.ps1");
const watchdogPath = path.join(ROOT, "tools", "local-live-watchdog.ps1");
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const POWERSHELL_TEST_TIMEOUT_MS = 120_000;

function runPowerShell(args) {
  return spawnSync(powershell, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: POWERSHELL_TEST_TIMEOUT_MS,
  });
}

function parseJsonResult(result) {
  assert.equal(
    result.status,
    0,
    `PowerShell failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout.trim());
}

function createTunnelFixture(directory) {
  const credentialsPath = path.join(directory, "cloudflared-credentials.json");
  const configPath = path.join(directory, "cloudflared-pulse.yml");
  fs.writeFileSync(credentialsPath, "{}\n");
  fs.writeFileSync(
    configPath,
    [
      "tunnel: pulse-test",
      `credentials-file: ${credentialsPath.replaceAll("\\", "/")}`,
      "ingress:",
      "  - hostname: pulse.orryy.com",
      "    service: http://localhost:3001",
      "  - service: http_status:404",
      "",
    ].join("\n"),
  );
  return configPath;
}

function approvedTask(configPath, overrides = {}) {
  return {
    task_name: "PulseGaming-LiveWatchdog-Supervisor",
    task_path: "\\",
    state: "Ready",
    triggers: ["AtStartup"],
    execute: powershell,
    arguments: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle Hidden",
      "-ExecutionPolicy Bypass",
      `-File "${watchdogPath}"`,
      `-RepoRoot "${ROOT}"`,
      "-Port 3001",
      `-TunnelConfigPath "${configPath}"`,
    ].join(" "),
    working_directory: ROOT,
    user_id: "SYSTEM",
    logon_type: "ServiceAccount",
    run_level: "Highest",
    settings: {
      multiple_instances: "IgnoreNew",
      start_when_available: true,
      restart_count: 999,
      restart_interval: "PT1M",
      execution_time_limit: "PT0S",
    },
    last_run_time_utc: "2026-07-17T06:31:00.000Z",
    last_task_result: 267009,
    ...overrides,
  };
}

function approvedWatchdogProcess(overrides = {}) {
  return {
    pid: 44732,
    parent_pid: 45248,
    name: "powershell.exe",
    executable_path: powershell,
    command_line: [
      powershell,
      "-NoProfile",
      "-ExecutionPolicy Bypass",
      `-File "${watchdogPath}"`,
      `-RepoRoot "${ROOT}"`,
      "-Port 3001",
    ].join(" "),
    ...overrides,
  };
}

function writeProbeFixture(directory, configPath, overrides = {}) {
  const fixture = {
    generated_at_utc: "2026-07-17T18:30:00.000Z",
    now_utc: "2026-07-17T18:30:00.000Z",
    boot_time_utc: "2026-07-17T06:30:00.000Z",
    scheduled_tasks: [approvedTask(configPath)],
    startup_shortcuts: [],
    supervision_start_times_utc: ["2026-07-17T06:31:00.000Z"],
    logoff_events_utc: ["2026-07-17T12:00:00.000Z"],
    runtime_health: {
      status: "ok",
      scheduler_active: true,
      auto_publish: true,
      use_job_queue: true,
      dispatch_mode: "queue",
    },
    tunnel_runtime: {
      status: "running",
      matching_process_count: 1,
    },
    watchdog_processes: [approvedWatchdogProcess()],
    probe_errors: [],
    ...overrides,
  };
  const fixturePath = path.join(directory, "probe.json");
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixturePath;
}

function runDoctor(directory, fixturePath, configPath) {
  return parseJsonResult(
    runPowerShell([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      doctorPath,
      "-RepoRoot",
      ROOT,
      "-ProbeFixturePath",
      fixturePath,
      "-TunnelConfigPath",
      configPath,
      "-StatusPath",
      path.join(directory, "status.json"),
      "-MissedWindowEvidencePath",
      path.join(directory, "missed.json"),
      "-Json",
    ]),
  );
}

test("watchdog log timestamps without an offset remain UTC", () => {
  const result = runPowerShell([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `. '${policyPath.replaceAll("'", "''")}'; ` +
      "[pscustomobject]@{" +
      "legacy = (Convert-WatchdogLogTimestampToUtcIso '2026-07-16T16:50:40'); " +
      "explicit = (Convert-WatchdogLogTimestampToUtcIso '2026-07-16T16:50:40+02:00'); " +
      "no_match = (Test-NoMatchingWindowsEventError ([pscustomobject]@{" +
      "FullyQualifiedErrorId = 'NoMatchingEventsFound,Microsoft.PowerShell.Commands.GetWinEventCommand'})); " +
      "other_error = (Test-NoMatchingWindowsEventError ([pscustomobject]@{" +
      "FullyQualifiedErrorId = 'AccessDenied,Microsoft.PowerShell.Commands.GetWinEventCommand'}))" +
      "} | ConvertTo-Json -Compress",
  ]);
  const parsed = parseJsonResult(result);

  assert.equal(parsed.legacy, "2026-07-16T16:50:40.000Z");
  assert.equal(parsed.explicit, "2026-07-16T14:50:40.000Z");
  assert.equal(parsed.no_match, true);
  assert.equal(parsed.other_error, false);
});

test("doctor verifies the exact SYSTEM AtStartup runtime and tunnel chain", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-autostart-proof-"));
  const configPath = createTunnelFixture(temp);
  const fixturePath = writeProbeFixture(temp, configPath);
  const status = runDoctor(temp, fixturePath, configPath);

  assert.equal(status.verdict, "green");
  assert.equal(status.autostart_configuration.verified, true);
  assert.equal(status.autostart_configuration.task_action_verified, true);
  assert.equal(status.autostart_configuration.runtime_entrypoint_verified, true);
  assert.equal(status.autostart_configuration.tunnel_entrypoint_verified, true);
  assert.equal(status.autostart_configuration.tunnel_config_verified, true);
  assert.equal(status.task.configuration_verified, true);
  assert.equal(status.task.state, "Ready");
  assert.equal(status.task.logoff_resilient, true);
  assert.equal(status.active_approved_watchdog_owner_count, 1);
  assert.equal(status.competing_process_owner_count, 0);
  assert.equal(status.continuity.supervisor_task_running, true);
  assert.equal(status.guard_ready, true);
  assert.equal(status.tunnel_config.credentials_file_present, true);
  assert.equal(status.tunnel_config.route_verified, true);
  assert.equal(status.boot_observation.status, "observed");
  assert.equal(status.continuity.task_last_run_since_boot, true);
  assert.equal(status.continuity.supervision_start_since_boot, true);
  assert.equal(status.logoff_observation.status, "observed");
  assert.equal(status.logoff_observation.event_count_since_boot, 1);
});

test("doctor keeps duplicate approved watchdog process owners non-GREEN", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-watchdog-duplicate-"));
  const configPath = createTunnelFixture(temp);
  const fixturePath = writeProbeFixture(temp, configPath, {
    watchdog_processes: [
      approvedWatchdogProcess(),
      approvedWatchdogProcess({ pid: 44733, parent_pid: 45249 }),
    ],
  });
  const status = runDoctor(temp, fixturePath, configPath);

  assert.equal(status.verdict, "red");
  assert.equal(status.guard_ready, false);
  assert.equal(status.active_approved_watchdog_owner_count, 2);
  assert.equal(status.competing_process_owner_count, 0);
  assert.equal(status.continuity.supervisor_task_running, false);
});

test("doctor reports and redacts a mismatched watchdog process owner", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-watchdog-mismatch-"));
  const configPath = createTunnelFixture(temp);
  const fixturePath = writeProbeFixture(temp, configPath, {
    watchdog_processes: [
      approvedWatchdogProcess({
        pid: 55001,
        command_line: [
          powershell,
          "-NoProfile",
          "-ExecutionPolicy Bypass",
          `-File "${watchdogPath}"`,
          '-RepoRoot "C:\\stale-pulse-checkout"',
          "-Port 3999",
          "-AccessToken do-not-print-this",
        ].join(" "),
      }),
    ],
  });
  const status = runDoctor(temp, fixturePath, configPath);
  const serialised = JSON.stringify(status);

  assert.equal(status.verdict, "red");
  assert.equal(status.guard_ready, false);
  assert.equal(status.active_approved_watchdog_owner_count, 0);
  assert.equal(status.competing_process_owner_count, 1);
  assert.equal(status.competing_process_owners[0].pid, 55001);
  assert.deepEqual(
    status.competing_process_owners[0].rejection_reasons,
    ["command_line_not_approved"],
  );
  assert.match(status.competing_process_owners[0].command_line, /<redacted>/);
  assert.doesNotMatch(serialised, /do-not-print-this/);
  assert.equal(status.continuity.supervisor_task_running, false);
});

test("doctor rejects a stale scheduled action even when runtime health is green", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-autostart-stale-"));
  const configPath = createTunnelFixture(temp);
  const staleTask = approvedTask(configPath, {
    arguments: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle Hidden",
      "-ExecutionPolicy Bypass",
      `-File "${watchdogPath}"`,
      '-RepoRoot "C:\\stale-pulse-checkout"',
      "-Port 3001",
      `-TunnelConfigPath "${configPath}"`,
    ].join(" "),
  });
  const fixturePath = writeProbeFixture(temp, configPath, {
    scheduled_tasks: [staleTask],
  });
  const status = runDoctor(temp, fixturePath, configPath);

  assert.equal(status.verdict, "red");
  assert.equal(status.autostart_configuration.verified, false);
  assert.equal(status.autostart_configuration.task_action_verified, false);
  assert.equal(status.task.configuration_verified, false);
});

test("unknown boot evidence stays unknown instead of fabricating a reboot time", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-unknown-"));
  const configPath = createTunnelFixture(temp);
  const fixturePath = writeProbeFixture(temp, configPath, {
    boot_time_utc: null,
    supervision_start_times_utc: [],
    logoff_events_utc: [],
    probe_errors: ["boot_time_probe_failed", "logoff_event_probe_failed"],
  });
  const status = runDoctor(temp, fixturePath, configPath);
  const evidence = JSON.parse(
    fs.readFileSync(path.join(temp, "missed.json"), "utf8"),
  );

  assert.equal(status.verdict, "amber");
  assert.equal(status.guard_ready, false);
  assert.equal(status.boot_time_utc, null);
  assert.equal(status.boot_observation.status, "unknown");
  assert.equal(status.continuity.task_last_run_since_boot, null);
  assert.equal(status.continuity.supervision_start_since_boot, null);
  assert.equal(status.logoff_observation.status, "unknown");
  assert.equal(evidence.evaluation_status, "not_evaluated");
  assert.equal(evidence.evaluated_count, 0);
  assert.equal(evidence.missed_count, 0);
});
