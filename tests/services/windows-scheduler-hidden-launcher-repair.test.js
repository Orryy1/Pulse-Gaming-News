"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  applyWindowsSchedulerHiddenLauncherRepair,
  buildWindowsSchedulerHiddenLauncherRepairPlan,
  formatWindowsSchedulerHiddenLauncherRepairMarkdown,
} = require("../../lib/ops/windows-scheduler-hidden-launcher-repair");
const {
  parseArgs,
  validateApplyArgs,
} = require("../../tools/windows-scheduler-hidden-launcher-repair");

const ROOT = path.resolve(__dirname, "..", "..");

function riskyTask() {
  return {
    task_name: "Orryy-PulseGaming",
    task_path: "\\",
    state: "Ready",
    execute: "python",
    arguments: "\"C:\\Claude\\orryy-expansion\\agents\\run_daily.py\" pulse_gaming",
    working_directory: "",
  };
}

test("scheduler hidden launcher repair plans visible-console tasks without OS mutation", () => {
  const plan = buildWindowsSchedulerHiddenLauncherRepairPlan({
    cwd: ROOT,
    platform: "win32",
    generatedAt: "2026-06-01T07:10:00.000Z",
    scheduledTasks: [
      riskyTask(),
      {
        task_name: "PulseHiddenTts",
        task_path: "\\",
        state: "Ready",
        execute:
          "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server\\venv\\Scripts\\pythonw.exe",
        arguments: "-m uvicorn server:app",
        working_directory:
          "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tts_server",
      },
    ],
  });

  assert.equal(plan.mode, "dry_run_no_os_mutation");
  assert.equal(plan.verdict, "red");
  assert.equal(plan.summary.visible_console_risk_count, 1);
  assert.equal(plan.summary.repairable_count, 1);
  assert.equal(plan.work_orders[0].task_name, "Orryy-PulseGaming");
  assert.equal(plan.work_orders[0].os_mutation_required, true);
  assert.equal(plan.work_orders[0].external_posting_risk, false);
  assert.match(plan.work_orders[0].apply_command, /--apply --operator-confirmed/);
  assert.match(plan.safety, /does not mutate Task Scheduler/i);
});

test("scheduler hidden launcher markdown exposes backups, apply command and elevated-shell requirement", () => {
  const plan = buildWindowsSchedulerHiddenLauncherRepairPlan({
    cwd: ROOT,
    platform: "win32",
    generatedAt: "2026-06-01T07:11:00.000Z",
    scheduledTasks: [riskyTask()],
  });
  const md = formatWindowsSchedulerHiddenLauncherRepairMarkdown(plan);

  assert.match(md, /Windows Scheduler Hidden Launcher Repair/);
  assert.match(md, /Dry-run/);
  assert.match(md, /Orryy-PulseGaming/);
  assert.match(md, /scheduler_task_backups/);
  assert.match(md, /Requires elevated PowerShell: true/);
  assert.match(md, /ops:windows-scheduler-repair -- --apply --operator-confirmed/);
});

test("scheduler hidden launcher apply refuses broad OS mutation without confirmation", () => {
  assert.throws(
    () => validateApplyArgs({ apply: true, operatorConfirmed: false }),
    /windows_scheduler_repair_apply_requires_operator_confirmed_flag/,
  );
});

test("scheduler hidden launcher apply backs up before changing task actions", () => {
  const plan = buildWindowsSchedulerHiddenLauncherRepairPlan({
    cwd: ROOT,
    platform: "win32",
    generatedAt: "2026-06-01T07:12:00.000Z",
    scheduledTasks: [riskyTask()],
  });
  const calls = [];
  const result = applyWindowsSchedulerHiddenLauncherRepair({
    plan,
    operatorConfirmed: true,
    execFileSyncImpl(file, args, opts) {
      calls.push({ file, args, opts });
      return "";
    },
  });

  assert.equal(result.mode, "apply_os_task_scheduler_mutation");
  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.blocked, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "powershell.exe");
  assert.equal(calls[0].opts.windowsHide, true);
  const command = calls[0].args[calls[0].args.length - 1];
  assert.match(command, /Export-ScheduledTask[\s\S]+Set-ScheduledTask/);
  assert.match(command, /New-ScheduledTaskAction -Execute 'pythonw\.exe'/);
  assert.match(command, /scheduler_task_backups/);
});

test("scheduler hidden launcher apply classifies access denied as elevated-shell blocker", () => {
  const plan = buildWindowsSchedulerHiddenLauncherRepairPlan({
    cwd: ROOT,
    platform: "win32",
    generatedAt: "2026-06-01T07:13:00.000Z",
    scheduledTasks: [riskyTask()],
  });
  const result = applyWindowsSchedulerHiddenLauncherRepair({
    plan,
    operatorConfirmed: true,
    execFileSyncImpl() {
      const err = new Error("Set-ScheduledTask : Access is denied.");
      err.stderr = Buffer.from("Access is denied.");
      throw err;
    },
  });

  assert.equal(result.counts.applied, 0);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.results[0].status, "blocked_requires_elevated_powershell");
  assert.equal(result.results[0].requires_elevated_shell, true);
  assert.match(result.results[0].operator_action, /elevated PowerShell/i);
});

test("ops:windows-scheduler-repair command is registered", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:windows-scheduler-repair"],
    "node tools/windows-scheduler-hidden-launcher-repair.js",
  );
});

test("windows scheduler repair CLI parses safe apply controls", () => {
  assert.deepEqual(
    parseArgs(["node", "tool", "--json", "--apply", "--operator-confirmed"]),
    { json: true, help: false, apply: true, operatorConfirmed: true },
  );
});
