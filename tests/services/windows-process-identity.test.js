"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { once } = require("node:events");
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
    CommandParsed: true,
    CommandSha256: commandSha256(JSON.stringify(["server.js"])),
  };
};

function commandSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const WINDOWS_HELPER_SOURCE =
  "process.send({argv:process.argv.slice(1)});setInterval(()=>{},1000)";

function runRealWindowsPowerShell({ script }) {
  return String(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  ).trim();
}

async function stopHelper(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit", { signal: AbortSignal.timeout(3000) });
  child.kill();
  await exited;
}

test(
  "real Windows process probe causally hashes equivalent raw quoting (regression-only)",
  {
    skip:
      process.platform === "win32"
        ? false
        : "requires Windows CIM and CommandLineToArgvW",
    timeout: 45000,
  },
  async () => {
    const helpers = [];
    const cases = [
      {
        rawArguments: ["-e", `"${WINDOWS_HELPER_SOURCE}"`, "--", '"two words"'],
        argument: "two words",
      },
      {
        rawArguments: [
          '"-e"',
          `"${WINDOWS_HELPER_SOURCE}"`,
          '"--"',
          '"two words"',
        ],
        argument: "two words",
      },
      {
        rawArguments: [
          "-e",
          `"${WINDOWS_HELPER_SOURCE}"`,
          "--",
          '"other words"',
        ],
        argument: "other words",
      },
    ];

    try {
      for (const testCase of cases) {
        const child = spawn(process.execPath, testCase.rawArguments, {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
          windowsVerbatimArguments: true,
        });
        helpers.push(child);
        assert.ok(Number.isInteger(child.pid) && child.pid > 0);
        const [ready] = await once(child, "message", {
          signal: AbortSignal.timeout(5000),
        });
        assert.deepEqual(ready, {
          argv: [testCase.argument],
        });
      }

      const results = [];
      for (const child of helpers) {
        results.push(
          await inspectWindowsAuthorityProcess({
            pid: child.pid,
            runPowerShell: runRealWindowsPowerShell,
          }),
        );
      }

      for (const result of results) {
        assert.equal(result.ok, true);
        assert.deepEqual(result.blockers, []);
        assert.equal(
          new Date(result.creation_time_utc).toISOString(),
          result.creation_time_utc,
        );
        assert.match(
          result.creation_time_utc,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
        assert.deepEqual(Object.keys(result).sort(), [
          "blockers",
          "command_sha256",
          "creation_time_utc",
          "executable_path",
          "ok",
          "parent_pid",
          "pid",
        ]);
        assert.equal(
          JSON.stringify(result).includes(WINDOWS_HELPER_SOURCE),
          false,
        );
        assert.equal("command_line" in result, false);
        assert.equal("argv" in result, false);
      }

      assert.notDeepEqual(cases[0].rawArguments, cases[1].rawArguments);
      assert.equal(results[0].command_sha256, results[1].command_sha256);
      assert.notEqual(results[2].command_sha256, results[0].command_sha256);
    } finally {
      const cleanup = await Promise.allSettled(
        helpers.map((helper) => stopHelper(helper)),
      );
      const cleanupFailure = cleanup.find(
        (result) => result.status === "rejected",
      );
      if (cleanupFailure) throw cleanupFailure.reason;
    }
  },
);

test("process command authority uses canonical parsed argv across equivalent Windows quoting", async () => {
  const expectedCommandSha256 = commandSha256(
    JSON.stringify(["server.js", "--label", "two words"]),
  );
  const changedCommandSha256 = commandSha256(
    JSON.stringify(["server.js", "--label", "other words"]),
  );
  const equivalentCommandLines = [
    '"D:\\pulse-tools\\node-v22.17.1\\node.exe" server.js --label "two words"',
    'D:\\pulse-tools\\node-v22.17.1\\node.exe "server.js" --label "two words"',
  ];

  const inspect = (commandLine, parsedSha256 = expectedCommandSha256) =>
    inspectWindowsAuthorityProcess({
      pid: 4200,
      expected: { command_sha256: expectedCommandSha256 },
      runPowerShell: async ({ script }) => {
        assert.match(script, /CommandLineToArgvW/);
        assert.match(script, /LocalFree/);
        return {
          ProcessId: 4200,
          ParentProcessId: 4100,
          CreationDate: "2026-08-02T10:00:00.000Z",
          ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
          CommandParsed: true,
          CommandSha256: parsedSha256,
          _test_only_observed_command_line: commandLine,
        };
      },
    });

  for (const commandLine of equivalentCommandLines) {
    const result = await inspect(commandLine);
    assert.equal(result.ok, true, commandLine);
    assert.equal(result.command_sha256, expectedCommandSha256);
    assert.equal(JSON.stringify(result).includes(commandLine), false);
    assert.equal("command_line" in result, false);
    assert.equal("argv" in result, false);
  }

  const changed = await inspect(
    'D:\\pulse-tools\\node-v22.17.1\\node.exe server.js --label "other words"',
    changedCommandSha256,
  );
  assert.deepEqual(changed.blockers, [
    "windows_authority_process_command_sha256_mismatch",
  ]);

  const malformed = await inspectWindowsAuthorityProcess({
    pid: 4200,
    runPowerShell: async () => ({
      ProcessId: 4200,
      ParentProcessId: 4100,
      CreationDate: "2026-08-02T10:00:00.000Z",
      ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
      CommandParsed: false,
      CommandSha256: null,
    }),
  });
  assert.deepEqual(malformed.blockers, [
    "windows_authority_process_command_parse_failed",
  ]);
});

test("process probe emits canonical invariant UTC creation identity before JSON transport", async () => {
  const result = await inspectWindowsAuthorityProcess({
    pid: 4200,
    runPowerShell: async ({ script }) => {
      assert.match(script, /CreationDate\.ToUniversalTime\(\)\.ToString\(/);
      assert.match(script, /InvariantCulture/);
      return {
        ProcessId: 4200,
        ParentProcessId: 4100,
        CreationDate: "2026-08-02T10:00:00.000Z",
        ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
        CommandParsed: true,
        CommandSha256: commandSha256(JSON.stringify(["server.js"])),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.creation_time_utc, "2026-08-02T10:00:00.000Z");
});

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
  const commandHash = commandSha256(JSON.stringify(["server.js"]));
  const expected = {
    creation_time_utc: "2026-08-02T10:00:00.000Z",
    parent_pid: 4100,
    executable_path: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    command_sha256: commandHash,
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
      field: "CommandSha256",
      value: commandSha256(JSON.stringify(["other.js"])),
      blocker: "windows_authority_process_command_sha256_mismatch",
    },
  ];

  for (const testCase of cases) {
    const row = {
      ProcessId: 4200,
      ParentProcessId: 4100,
      CreationDate: "2026-08-02T10:00:00.000Z",
      ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
      CommandParsed: true,
      CommandSha256: commandHash,
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
      CommandParsed: true,
      CommandSha256: "f".repeat(64),
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
