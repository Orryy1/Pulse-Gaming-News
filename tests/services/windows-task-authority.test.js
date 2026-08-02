"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  compareStableAuthorityObservations,
  inspectCurrentWindowsJobMembership,
  inspectExactWindowsTaskInstances,
  observeBoundedWindowsAuthority,
} = require("../../lib/stabilisation/windows-task-authority");

function fakePowerShell(value) {
  return async ({ script }) => {
    assert.match(script, /GetInstances\(0\)/);
    return value;
  };
}

function commandSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const SUPERVISOR_COMMAND =
  '"D:\\pulse-tools\\node-v22.17.1\\node.exe" tools\\windows-live-guarded-runtime.js supervise';
const CHILD_COMMAND = '"D:\\pulse-tools\\node-v22.17.1\\node.exe" server.js';

function authorityExpected() {
  return {
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    taskInstanceGuid: "guid-1",
    supervisorPid: 4100,
    supervisorCreationTimeUtc: "2026-08-02T10:00:00.000Z",
    supervisorExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    supervisorCommandSha256: commandSha256(SUPERVISOR_COMMAND),
    childPid: 4200,
    childCreationTimeUtc: "2026-08-02T10:00:01.000Z",
    childExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
    childCommandSha256: commandSha256(CHILD_COMMAND),
  };
}

function boundedPowerShell({ instances, jobPids = [4100, 4200] } = {}) {
  const requestedPids = [];
  const rows = {
    4100: {
      ProcessId: 4100,
      ParentProcessId: 700,
      CreationDate: "2026-08-02T10:00:00.000Z",
      ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
      CommandLine: SUPERVISOR_COMMAND,
    },
    4200: {
      ProcessId: 4200,
      ParentProcessId: 4100,
      CreationDate: "2026-08-02T10:00:01.000Z",
      ExecutablePath: "D:\\pulse-tools\\node-v22.17.1\\node.exe",
      CommandLine: CHILD_COMMAND,
    },
    9999: {
      ProcessId: 9999,
      ParentProcessId: 1,
      CreationDate: "2026-08-02T10:00:02.000Z",
      ExecutablePath: "D:\\unrelated\\node.exe",
      CommandLine: "unrelated secret command",
    },
  };
  return {
    requestedPids,
    async runPowerShell({ script }) {
      if (script.includes("Schedule.Service")) {
        return (
          instances ?? [{ InstanceGuid: "guid-1", EnginePID: 4100, State: 4 }]
        );
      }
      if (script.includes("Win32_Process")) {
        const pid = Number(script.match(/ProcessId\s*=\s*(\d+)/)?.[1]);
        requestedPids.push(pid);
        return rows[pid] || null;
      }
      if (script.includes("QueryInformationJobObject")) {
        return { ProcessIds: jobPids };
      }
      throw new Error("unexpected probe");
    },
  };
}

test("binds the exact task instance to its EnginePID", async () => {
  const result = await inspectExactWindowsTaskInstances({
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    runPowerShell: fakePowerShell([
      { InstanceGuid: "guid-1", EnginePID: 4100, State: 4 },
    ]),
  });

  assert.deepEqual(result.instances, [
    { instance_guid: "guid-1", engine_pid: 4100, state: 4 },
  ]);
});

test("rejects every non-exact task name before the Task Scheduler probe", async () => {
  for (const taskName of [
    "PulseGaming-Stabilisation-Runtime",
    " PulseGaming-LiveGuarded-YouTube-Runtime",
  ]) {
    let probeCalls = 0;
    const result = await inspectExactWindowsTaskInstances({
      taskName,
      runPowerShell: async () => {
        probeCalls += 1;
        return [{ InstanceGuid: "legacy-guid", EnginePID: 4100, State: 4 }];
      },
    });

    assert.equal(probeCalls, 0, taskName);
    assert.deepEqual(result, {
      ok: false,
      task_name: taskName,
      instances: [],
      blockers: ["windows_task_name_not_authorised"],
    });
  }
});

test("queries only the exact task path and rejects an incomplete instance", async () => {
  let scriptSeen = null;
  const result = await inspectExactWindowsTaskInstances({
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    runPowerShell: async ({ script }) => {
      scriptSeen = script;
      return [{ InstanceGuid: "guid-1", EnginePID: null, State: 4 }];
    },
  });

  assert.match(
    scriptSeen,
    /\.GetTask\('PulseGaming-LiveGuarded-YouTube-Runtime'\)/,
  );
  assert.doesNotMatch(
    scriptSeen,
    /Get-ScheduledTask|GetProcesses|Win32_Process/,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers, [
    "windows_task_instance_identity_incomplete",
  ]);
});

test("fails closed when the exact Task Scheduler probe throws", async () => {
  const result = await inspectExactWindowsTaskInstances({
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    runPowerShell: async () => {
      throw new Error("sensitive Task Scheduler failure");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    instances: [],
    blockers: ["windows_task_instance_probe_failed"],
  });
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
});

test("reads the current Windows Job membership with fixed probe code", async () => {
  let scriptSeen = null;
  const result = await inspectCurrentWindowsJobMembership({
    runPowerShell: async ({ script }) => {
      scriptSeen = script;
      return { ProcessIds: [4100, 4200] };
    },
  });

  assert.match(scriptSeen, /Add-Type/);
  assert.match(scriptSeen, /QueryInformationJobObject/);
  assert.match(scriptSeen, /JobObjectBasicProcessIdList/);
  assert.deepEqual(result, {
    ok: true,
    process_ids: [4100, 4200],
    blockers: [],
  });
});

test("fails closed when current Job membership cannot be probed", async () => {
  const result = await inspectCurrentWindowsJobMembership({
    runPowerShell: async () => {
      throw new Error("raw failure detail");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    process_ids: [],
    blockers: ["windows_job_membership_probe_failed"],
  });
  assert.equal(JSON.stringify(result).includes("raw failure detail"), false);
});

test("rejects missing or null Job membership data without rejecting an explicit empty list", async () => {
  for (const value of [{}, { ProcessIds: null }]) {
    const result = await inspectCurrentWindowsJobMembership({
      runPowerShell: async () => value,
    });

    assert.deepEqual(result, {
      ok: false,
      process_ids: [],
      blockers: ["windows_job_membership_invalid"],
    });
  }

  const explicitEmpty = await inspectCurrentWindowsJobMembership({
    runPowerShell: async () => ({ ProcessIds: [] }),
  });
  assert.deepEqual(explicitEmpty, {
    ok: true,
    process_ids: [],
    blockers: [],
  });
});

test("compares canonical authority observations without key-order drift", () => {
  const stable = compareStableAuthorityObservations(
    { task: { engine_pid: 4100, instance_guid: "guid-1" }, ok: true },
    { ok: true, task: { instance_guid: "guid-1", engine_pid: 4100 } },
  );
  const changed = compareStableAuthorityObservations(
    { task: { engine_pid: 4100 } },
    { task: { engine_pid: 4101 } },
  );

  assert.equal(stable.ok, true);
  assert.match(stable.observation_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(changed, {
    ok: false,
    blockers: ["bounded_authority_observation_unstable"],
  });
});

test("observes only the exact task, supervisor and child authority chain", async () => {
  const powershell = boundedPowerShell();
  const result = await observeBoundedWindowsAuthority({
    expected: authorityExpected(),
    runPowerShell: powershell.runPowerShell,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(powershell.requestedPids, [4100, 4200]);
  assert.deepEqual(result.task_instance, {
    instance_guid: "guid-1",
    engine_pid: 4100,
    state: 4,
  });
  assert.equal(result.job_membership.child_present, true);
  assert.equal(
    JSON.stringify(result).includes("unrelated secret command"),
    false,
  );
  assert.equal(JSON.stringify(result).includes(SUPERVISOR_COMMAND), false);
  assert.equal(JSON.stringify(result).includes(CHILD_COMMAND), false);
});

test("bounded observation rejects a legacy authority before any probe", async () => {
  for (const taskName of [
    "PulseGaming-Stabilisation-Runtime",
    "PulseGaming-LiveGuarded-YouTube-Runtime ",
  ]) {
    let probeCalls = 0;
    const result = await observeBoundedWindowsAuthority({
      expected: {
        ...authorityExpected(),
        taskName,
      },
      probes: {
        async inspectExactWindowsTaskInstances() {
          probeCalls += 1;
          return {
            ok: true,
            task_name: taskName,
            instances: [
              { instance_guid: "guid-1", engine_pid: 4100, state: 4 },
            ],
            blockers: [],
          };
        },
      },
    });

    assert.equal(probeCalls, 0, taskName);
    assert.deepEqual(result.blockers, ["windows_task_name_not_authorised"]);
  }
});

test("bounded observation requires every targeted identity binding before probing", async () => {
  const requiredFields = [
    "taskInstanceGuid",
    "supervisorPid",
    "supervisorCreationTimeUtc",
    "supervisorExecutablePath",
    "supervisorCommandSha256",
    "childPid",
    "childCreationTimeUtc",
    "childExecutablePath",
    "childCommandSha256",
  ];
  const invalidValues = [
    ["taskInstanceGuid", ""],
    ["supervisorPid", 0],
    ["supervisorCreationTimeUtc", "not-a-time"],
    ["supervisorExecutablePath", "node.exe"],
    ["supervisorCommandSha256", "not-a-hash"],
    ["childCreationTimeUtc", "not-a-time"],
    ["childPid", 4100],
    ["childExecutablePath", "server.js"],
    ["childCommandSha256", "f".repeat(63)],
  ];

  for (const field of requiredFields) {
    const expected = authorityExpected();
    delete expected[field];
    let probeCalls = 0;
    const result = await observeBoundedWindowsAuthority({
      expected,
      runPowerShell: async () => {
        probeCalls += 1;
        throw new Error("must not probe");
      },
    });

    assert.equal(probeCalls, 0, `missing ${field}`);
    assert.deepEqual(
      result.blockers,
      ["windows_authority_expected_identity_invalid"],
      `missing ${field}`,
    );
  }

  for (const [field, value] of invalidValues) {
    const expected = { ...authorityExpected(), [field]: value };
    let probeCalls = 0;
    const result = await observeBoundedWindowsAuthority({
      expected,
      runPowerShell: async () => {
        probeCalls += 1;
        throw new Error("must not probe");
      },
    });

    assert.equal(probeCalls, 0, `malformed ${field}`);
    assert.deepEqual(
      result.blockers,
      ["windows_authority_expected_identity_invalid"],
      `malformed ${field}`,
    );
  }
});

test("fails closed for zero or multiple exact task instances", async () => {
  for (const instances of [
    [],
    [
      { InstanceGuid: "guid-1", EnginePID: 4100, State: 4 },
      { InstanceGuid: "guid-2", EnginePID: 4101, State: 4 },
    ],
  ]) {
    const powershell = boundedPowerShell({ instances });
    const result = await observeBoundedWindowsAuthority({
      expected: authorityExpected(),
      runPowerShell: powershell.runPowerShell,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers, ["windows_task_instance_count_invalid"]);
    assert.deepEqual(powershell.requestedPids, []);
  }
});

test("fails closed when the task engine, process chain or Job membership drifts", async () => {
  const engineDrift = boundedPowerShell({
    instances: [{ InstanceGuid: "guid-1", EnginePID: 9998, State: 4 }],
  });
  const wrongEngine = await observeBoundedWindowsAuthority({
    expected: authorityExpected(),
    runPowerShell: engineDrift.runPowerShell,
  });
  const jobDrift = boundedPowerShell({ jobPids: [4100] });
  const missingChild = await observeBoundedWindowsAuthority({
    expected: authorityExpected(),
    runPowerShell: jobDrift.runPowerShell,
  });

  assert.deepEqual(wrongEngine.blockers, ["windows_task_engine_pid_mismatch"]);
  assert.deepEqual(engineDrift.requestedPids, []);
  assert.deepEqual(missingChild.blockers, [
    "windows_authority_child_not_in_job",
  ]);
});
