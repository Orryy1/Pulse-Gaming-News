"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const installerPath = path.join(ROOT, "tools", "install-local-live-watchdog-startup.ps1");
const doctorPath = path.join(ROOT, "tools", "machine-boot-supervision-doctor.ps1");
const watchdogPath = path.join(ROOT, "tools", "local-live-watchdog.ps1");
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const POWERSHELL_TEST_TIMEOUT_MS = 120_000;

function writeTunnelFixture(directory) {
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

function approvedWatchdogProcess() {
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
  };
}

function writeProbeFixture(directory, overrides = {}) {
  writeTunnelFixture(directory);
  const fixture = {
    generated_at_utc: "2026-07-17T18:30:00.000Z",
    now_utc: "2026-07-17T18:30:00.000Z",
    boot_time_utc: "2026-07-17T06:30:00.000Z",
    scheduled_tasks: [
      {
        task_name: "PulseGaming-LiveWatchdog-Supervisor",
        task_path: "\\",
        state: "Ready",
        triggers: ["AtLogOn", "Once"],
        execute: "powershell.exe",
        arguments:
          '-NoProfile -ExecutionPolicy Bypass -File "C:\\pulse\\tools\\local-live-watchdog.ps1"',
        working_directory: "C:\\pulse",
        user_id: "MORR",
        logon_type: "InteractiveToken",
        run_level: "Limited",
        last_run_time_utc: "2026-07-16T16:50:00.000Z",
        last_task_result: 0,
      },
    ],
    startup_shortcuts: [
      {
        path: "C:\\Startup\\Pulse Gaming Live Watchdog.lnk",
        target: "powershell.exe",
        arguments:
          '-File "C:\\pulse\\tools\\local-live-watchdog.ps1" -ApiToken "do-not-print-this"',
      },
      {
        path: "C:\\Startup\\PulseGaming-LiveWatchdog.lnk",
        target: "pythonw.exe",
        arguments:
          '"C:\\pulse\\tools\\local_live_watchdog_host.py"',
      },
    ],
    supervision_start_times_utc: ["2026-07-17T17:50:00.000Z"],
    logoff_events_utc: [],
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

function runPowerShell(scriptPath, args) {
  return spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: POWERSHELL_TEST_TIMEOUT_MS,
    },
  );
}

function parseJsonOutput(result) {
  assert.equal(
    result.status,
    0,
    `PowerShell failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout.trim());
}

test("startup installer defaults to a no-mutation AtStartup plan and reports competing owners", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-plan-"));
  const fixturePath = writeProbeFixture(temp);

  const result = runPowerShell(installerPath, [
    "-RepoRoot",
    ROOT,
    "-ProbeFixturePath",
    fixturePath,
    "-OutputDirectory",
    temp,
  ]);
  const plan = parseJsonOutput(result);

  assert.equal(plan.mode, "plan");
  assert.equal(plan.os_mutation_performed, false);
  assert.equal(plan.task.trigger, "AtStartup");
  assert.equal(plan.task.run_as, "SYSTEM");
  assert.match(plan.task.arguments, /-NonInteractive/);
  assert.match(plan.task.arguments, /-WindowStyle Hidden/);
  assert.match(plan.task.arguments, /local-live-watchdog\.ps1/);
  assert.match(plan.approved_runtime_entrypoint, /local-live-primary-runtime\.ps1$/);
  assert.equal(plan.current_state.competing_startup_shortcut_count, 2);
  assert.equal(plan.current_state.one_owner, false);
  assert.equal(plan.install_allowed, false);
  assert.match(plan.blockers.join(" "), /competing_startup_owners/);
  assert.ok(fs.existsSync(path.join(temp, "machine_boot_supervision_install_plan.json")));
  assert.ok(fs.existsSync(path.join(temp, "machine_boot_supervision_status.json")));
  assert.ok(fs.existsSync(path.join(temp, "machine_boot_missed_window_evidence.json")));
});

test("startup installer records a separately protected runtime checkout in the watchdog action", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-runtime-root-"));
  const fixturePath = writeProbeFixture(temp);

  const result = runPowerShell(installerPath, [
    "-RepoRoot",
    ROOT,
    "-RuntimeRepoRoot",
    ROOT,
    "-ProbeFixturePath",
    fixturePath,
    "-OutputDirectory",
    temp,
  ]);
  const plan = parseJsonOutput(result);

  assert.equal(path.resolve(plan.supervisor_repo_root), ROOT);
  assert.equal(path.resolve(plan.runtime_repo_root), ROOT);
  assert.match(plan.task.arguments, /-RuntimeRepoRoot/);
  assert.match(
    plan.task.arguments,
    new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  );
});

test("machine boot doctor records reboot-gap missed windows without exposing secret values", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-doctor-red-"));
  const fixturePath = writeProbeFixture(temp);
  const statusPath = path.join(temp, "status.json");
  const evidencePath = path.join(temp, "missed.json");

  const result = runPowerShell(doctorPath, [
    "-RepoRoot",
    ROOT,
    "-ProbeFixturePath",
    fixturePath,
    "-TunnelConfigPath",
    path.join(temp, "cloudflared-pulse.yml"),
    "-StatusPath",
    statusPath,
    "-MissedWindowEvidencePath",
    evidencePath,
    "-Json",
  ]);
  const status = parseJsonOutput(result);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

  assert.equal(status.verdict, "red");
  assert.equal(status.one_owner, false);
  assert.equal(status.task.at_startup, false);
  assert.equal(status.task.noninteractive, false);
  assert.equal(status.task.hidden, false);
  assert.equal(status.approved_runtime_entrypoint_verified, true);
  assert.equal(evidence.missed_count, 4);
  assert.deepEqual(
    evidence.windows.map((entry) => entry.window_utc),
    [
      "2026-07-17T09:00:00.000Z",
      "2026-07-17T11:00:00.000Z",
      "2026-07-17T14:00:00.000Z",
      "2026-07-17T16:00:00.000Z",
    ],
  );
  assert.ok(evidence.windows.every((entry) => entry.reason === "supervision_started_after_window"));
  const serialised = `${fs.readFileSync(statusPath, "utf8")}\n${fs.readFileSync(evidencePath, "utf8")}`;
  assert.doesNotMatch(serialised, /API_TOKEN|ACCESS_TOKEN|CLIENT_SECRET|WEBHOOK_URL/);
  assert.doesNotMatch(serialised, /do-not-print-this/);
  assert.match(status.competing_startup_shortcuts[0].arguments, /<redacted>/);
});

test("machine boot doctor returns GREEN only for one hidden noninteractive AtStartup owner", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-doctor-green-"));
  const fixturePath = writeProbeFixture(temp, {
    scheduled_tasks: [
      {
        task_name: "PulseGaming-LiveWatchdog-Supervisor",
        task_path: "\\",
        state: "Running",
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
          `-TunnelConfigPath "${path.join(temp, "cloudflared-pulse.yml")}"`,
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
      },
    ],
    startup_shortcuts: [],
    supervision_start_times_utc: ["2026-07-17T06:31:00.000Z"],
  });

  const result = runPowerShell(doctorPath, [
    "-RepoRoot",
    ROOT,
    "-ProbeFixturePath",
    fixturePath,
    "-TunnelConfigPath",
    path.join(temp, "cloudflared-pulse.yml"),
    "-StatusPath",
    path.join(temp, "status.json"),
    "-MissedWindowEvidencePath",
    path.join(temp, "missed.json"),
    "-Json",
  ]);
  const status = parseJsonOutput(result);

  assert.equal(status.verdict, "green");
  assert.equal(status.guard_ready, true);
  assert.equal(status.one_owner, true);
  assert.equal(status.task.at_startup, true);
  assert.equal(status.task.noninteractive, true);
  assert.equal(status.task.hidden, true);
  assert.equal(status.task.run_as_system, true);
  assert.equal(status.missed_window_count_since_boot, 0);
});

test("machine boot doctor keeps historical missed windows advisory after future supervision is ready", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-doctor-historical-"));
  const fixturePath = writeProbeFixture(temp, {
    scheduled_tasks: [
      {
        task_name: "PulseGaming-LiveWatchdog-Supervisor",
        task_path: "\\",
        state: "Running",
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
          `-TunnelConfigPath "${path.join(temp, "cloudflared-pulse.yml")}"`,
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
        last_run_time_utc: "2026-07-17T15:50:00.000Z",
        last_task_result: 267009,
      },
    ],
    startup_shortcuts: [],
    supervision_start_times_utc: ["2026-07-17T15:50:00.000Z"],
  });

  const result = runPowerShell(doctorPath, [
    "-RepoRoot",
    ROOT,
    "-ProbeFixturePath",
    fixturePath,
    "-TunnelConfigPath",
    path.join(temp, "cloudflared-pulse.yml"),
    "-StatusPath",
    path.join(temp, "status.json"),
    "-MissedWindowEvidencePath",
    path.join(temp, "missed.json"),
    "-Json",
  ]);
  const status = parseJsonOutput(result);

  assert.equal(status.verdict, "amber");
  assert.equal(status.guard_ready, true);
  assert.equal(status.one_owner, true);
  assert.ok(status.missed_window_count_since_boot > 0);
});

test("install mode is explicit, confirmation gated and never starts the task immediately", () => {
  const source = fs.readFileSync(installerPath, "utf8");
  assert.match(source, /\[ValidateSet\("Plan",\s*"Install"\)\]/);
  assert.match(source, /\[string\]\$Mode\s*=\s*"Plan"/);
  assert.match(source, /install_requires_operator_confirmation/);
  assert.match(source, /New-ScheduledTaskTrigger -AtStartup/);
  assert.match(source, /New-ScheduledTaskPrincipal[\s\S]+SYSTEM[\s\S]+ServiceAccount/);
  assert.match(source, /-NonInteractive/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /local-live-primary-runtime\.ps1/);
  assert.doesNotMatch(source, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.doesNotMatch(source, /CreateShortcut/);
  assert.doesNotMatch(source, /Start-ScheduledTask/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-boot-install-gate-"));
  const fixturePath = writeProbeFixture(temp, { startup_shortcuts: [] });
  const result = runPowerShell(installerPath, [
    "-RepoRoot",
    ROOT,
    "-Mode",
    "Install",
    "-ProbeFixturePath",
    fixturePath,
    "-OutputDirectory",
    temp,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /install_requires_operator_confirmation/);
});

test("startup installer remains exposed as the live watchdog operator command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:install-live-watchdog"],
    "powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-local-live-watchdog-startup.ps1",
  );
});
