"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  inspectWindowsAuthorityProcess,
} = require("../../lib/stabilisation/windows-process-identity");

const fakeProcessProbe = async ({ script }) => {
  assert.match(script, /ProcessId\s*=\s*4200/);
  return {
    ProcessId: 4200,
    ParentProcessId: 4100,
    CreationDate: "2026-08-02T10:00:00.000Z",
    ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    CommandLine: '"D:\\pulse-tools\\node-v22.17.1\\node.exe" server.js',
  };
};

function commandSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("process identity includes parent, executable and a command hash only", async () => {
  const result = await inspectWindowsAuthorityProcess({
    pid: 4200,
    runPowerShell: fakeProcessProbe,
  });

  assert.equal(result.parent_pid, 4100);
  assert.equal(
    result.executable_path,
    "D:\\pulse-tools\\node-v22.17.1\\node.exe",
  );
  assert.match(result.command_sha256, /^[a-f0-9]{64}$/);
  assert.equal("command_line" in result, false);
});

test("fails closed when a bound process identity drifts", async () => {
  const commandLine = '"D:\\pulse-tools\\node-v22.17.1\\node.exe" server.js';
  const expected = {
    creation_time_utc: "2026-08-02T10:00:00.000Z",
    parent_pid: 4100,
    executable_path: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    command_sha256: commandSha256(commandLine),
  };
  const cases = [
    {
      field: "CreationDate",
      value: "2026-08-02T10:00:01.000Z",
      blocker: "windows_authority_process_creation_time_mismatch",
    },
    {
      field: "ParentProcessId",
      value: 9999,
      blocker: "windows_authority_process_parent_pid_mismatch",
    },
    {
      field: "ExecutablePath",
      value: "D:\\other\\node.exe",
      blocker: "windows_authority_process_executable_path_mismatch",
    },
    {
      field: "CommandLine",
      value: '"D:\\pulse-tools\\node-v22.17.1\\node.exe" other.js',
      blocker: "windows_authority_process_command_sha256_mismatch",
    },
  ];

  for (const testCase of cases) {
    const row = {
      ProcessId: 4200,
      ParentProcessId: 4100,
      CreationDate: "2026-08-02T10:00:00.000Z",
      ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
      CommandLine: commandLine,
      [testCase.field]: testCase.value,
    };
    const result = await inspectWindowsAuthorityProcess({
      pid: 4200,
      expected,
      runPowerShell: async () => row,
    });

    assert.equal(result.ok, false, testCase.field);
    assert.deepEqual(result.blockers, [testCase.blocker], testCase.field);
    assert.equal(JSON.stringify(result).includes(commandLine), false);
  }
});

test("fails closed when the exact PID is absent or the probe fails", async () => {
  const absent = await inspectWindowsAuthorityProcess({
    pid: 4200,
    runPowerShell: async () => ({
      ProcessId: 7777,
      ParentProcessId: 1,
      CreationDate: "2026-08-02T10:00:00.000Z",
      ExecutablePath: "D:\\other\\unrelated.exe",
      CommandLine: "unrelated secret command",
    }),
  });
  const failed = await inspectWindowsAuthorityProcess({
    pid: 4200,
    runPowerShell: async () => {
      throw new Error("sensitive workstation detail");
    },
  });

  assert.deepEqual(absent.blockers, ["windows_authority_process_not_found"]);
  assert.deepEqual(failed.blockers, ["windows_authority_process_probe_failed"]);
  assert.equal(JSON.stringify(absent).includes("unrelated"), false);
  assert.equal(JSON.stringify(failed).includes("sensitive"), false);
});
