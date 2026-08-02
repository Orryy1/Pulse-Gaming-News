"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const {
  inspectWindowsAuthorityProcess,
} = require("./windows-process-identity");

const LIVE_GUARDED_TASK_NAME = "PulseGaming-LiveGuarded-YouTube-Runtime";

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function parsePowerShellValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text ? JSON.parse(text) : null;
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function inspectExactWindowsTaskInstances({
  taskName,
  runPowerShell,
} = {}) {
  const exactTaskName = typeof taskName === "string" ? taskName : "";
  if (exactTaskName !== LIVE_GUARDED_TASK_NAME) {
    return {
      ok: false,
      task_name: exactTaskName || null,
      instances: [],
      blockers: ["windows_task_name_not_authorised"],
    };
  }
  if (typeof runPowerShell !== "function") {
    return {
      ok: false,
      task_name: exactTaskName || null,
      instances: [],
      blockers: ["windows_task_instance_probe_unavailable"],
    };
  }

  const script =
    "$ErrorActionPreference = 'Stop'; " +
    "$service = New-Object -ComObject 'Schedule.Service'; " +
    "$service.Connect(); " +
    "$folder = $service.GetFolder('\\'); " +
    `$task = $folder.GetTask(${quotePowerShellLiteral(exactTaskName)}); ` +
    "$instances = @($task.GetInstances(0)); " +
    "$instances | ForEach-Object { [pscustomobject]@{" +
    "InstanceGuid=$_.InstanceGuid;EnginePID=$_.EnginePID;State=$_.State" +
    "} } | ConvertTo-Json -Compress";

  let rows;
  try {
    rows = parsePowerShellValue(await runPowerShell({ script }));
  } catch {
    return {
      ok: false,
      task_name: exactTaskName,
      instances: [],
      blockers: ["windows_task_instance_probe_failed"],
    };
  }
  if (rows === null || rows === undefined || rows === "") rows = [];
  if (!Array.isArray(rows)) rows = [rows];

  const instances = [];
  for (const row of rows) {
    const instanceGuid = String(row?.InstanceGuid || "").trim();
    const enginePid = Number(row?.EnginePID);
    const state = Number(row?.State);
    if (
      !instanceGuid ||
      !Number.isInteger(enginePid) ||
      enginePid <= 0 ||
      row?.State === null ||
      row?.State === undefined ||
      !Number.isInteger(state)
    ) {
      return {
        ok: false,
        task_name: exactTaskName,
        instances: [],
        blockers: ["windows_task_instance_identity_incomplete"],
      };
    }
    instances.push({
      instance_guid: instanceGuid,
      engine_pid: enginePid,
      state,
    });
  }

  return {
    ok: true,
    task_name: exactTaskName,
    instances,
    blockers: [],
  };
}

const CURRENT_JOB_MEMBERSHIP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PulseCurrentJobProbe
{
    public const int JobObjectBasicProcessIdList = 3;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryInformationJobObject(
        IntPtr hJob,
        int JobObjectInfoClass,
        IntPtr lpJobObjectInfo,
        uint cbJobObjectInfoLength,
        out uint lpReturnLength);
}
'@
$capacity = 65536
$buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($capacity)
try {
  $returned = 0
  $ok = [PulseCurrentJobProbe]::QueryInformationJobObject(
    [IntPtr]::Zero,
    [PulseCurrentJobProbe]::JobObjectBasicProcessIdList,
    $buffer,
    $capacity,
    [ref]$returned)
  if (-not $ok) {
    throw [ComponentModel.Win32Exception]::new(
      [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $count = [Runtime.InteropServices.Marshal]::ReadInt32($buffer, 4)
  $processIds = @()
  for ($index = 0; $index -lt $count; $index++) {
    $offset = 8 + ($index * [IntPtr]::Size)
    if ([IntPtr]::Size -eq 8) {
      $processIds += [Runtime.InteropServices.Marshal]::ReadInt64($buffer, $offset)
    } else {
      $processIds += [Runtime.InteropServices.Marshal]::ReadInt32($buffer, $offset)
    }
  }
  [pscustomobject]@{ ProcessIds = @($processIds) } | ConvertTo-Json -Compress
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
}`.trim();

async function inspectCurrentWindowsJobMembership({ runPowerShell } = {}) {
  if (typeof runPowerShell !== "function") {
    return {
      ok: false,
      process_ids: [],
      blockers: ["windows_job_membership_probe_unavailable"],
    };
  }
  let value;
  try {
    value = parsePowerShellValue(
      await runPowerShell({ script: CURRENT_JOB_MEMBERSHIP_SCRIPT }),
    );
  } catch {
    return {
      ok: false,
      process_ids: [],
      blockers: ["windows_job_membership_probe_failed"],
    };
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(value, "ProcessIds") ||
    value.ProcessIds === null ||
    value.ProcessIds === undefined
  ) {
    return {
      ok: false,
      process_ids: [],
      blockers: ["windows_job_membership_invalid"],
    };
  }
  let supplied = value.ProcessIds;
  if (!Array.isArray(supplied)) supplied = [supplied];
  const processIds = supplied.map(Number);
  if (
    processIds.some((pid) => !Number.isInteger(pid) || pid <= 0) ||
    new Set(processIds).size !== processIds.length
  ) {
    return {
      ok: false,
      process_ids: [],
      blockers: ["windows_job_membership_invalid"],
    };
  }
  return { ok: true, process_ids: processIds, blockers: [] };
}

function compareStableAuthorityObservations(first, second) {
  const firstHash = sha256(canonicalJson(first));
  const secondHash = sha256(canonicalJson(second));
  return firstHash === secondHash
    ? { ok: true, observation_sha256: secondHash }
    : { ok: false, blockers: ["bounded_authority_observation_unstable"] };
}

function expectedValue(expected, camelName, snakeName) {
  return expected?.[camelName] ?? expected?.[snakeName];
}

function validExpectedTaskInstanceGuid(value) {
  if (typeof value !== "string") return false;
  return /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|\{[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\})$/i.test(
    value,
  );
}

function validExpectedTimestamp(value) {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validExpectedExecutablePath(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    path.win32.isAbsolute(value.trim())
  );
}

function validExpectedCommandSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function failedAuthorityObservation(taskName, blockers, values = {}) {
  return {
    ok: false,
    task_name: taskName || null,
    task_instance: values.task_instance || null,
    supervisor: values.supervisor || null,
    child: values.child || null,
    job_membership: values.job_membership || null,
    blockers: [...new Set(blockers)],
  };
}

async function observeBoundedWindowsAuthority({
  expected = {},
  runPowerShell,
  probes = {},
} = {}) {
  const suppliedTaskName = expectedValue(expected, "taskName", "task_name");
  const taskName = typeof suppliedTaskName === "string" ? suppliedTaskName : "";
  const supervisorPid = Number(
    expectedValue(expected, "supervisorPid", "supervisor_pid"),
  );
  const childPid = Number(expectedValue(expected, "childPid", "child_pid"));
  const taskInstanceGuid = expectedValue(
    expected,
    "taskInstanceGuid",
    "task_instance_guid",
  );
  const supervisorCreationTimeUtc = expectedValue(
    expected,
    "supervisorCreationTimeUtc",
    "supervisor_creation_time_utc",
  );
  const supervisorExecutablePath = expectedValue(
    expected,
    "supervisorExecutablePath",
    "supervisor_executable_path",
  );
  const supervisorCommandSha256 = expectedValue(
    expected,
    "supervisorCommandSha256",
    "supervisor_command_sha256",
  );
  const childCreationTimeUtc = expectedValue(
    expected,
    "childCreationTimeUtc",
    "child_creation_time_utc",
  );
  const childExecutablePath = expectedValue(
    expected,
    "childExecutablePath",
    "child_executable_path",
  );
  const childCommandSha256 = expectedValue(
    expected,
    "childCommandSha256",
    "child_command_sha256",
  );
  if (taskName !== LIVE_GUARDED_TASK_NAME) {
    return failedAuthorityObservation(taskName, [
      "windows_task_name_not_authorised",
    ]);
  }
  if (
    !Number.isInteger(supervisorPid) ||
    supervisorPid <= 0 ||
    !Number.isInteger(childPid) ||
    childPid <= 0 ||
    childPid === supervisorPid ||
    !validExpectedTaskInstanceGuid(taskInstanceGuid) ||
    !validExpectedTimestamp(supervisorCreationTimeUtc) ||
    !validExpectedExecutablePath(supervisorExecutablePath) ||
    !validExpectedCommandSha256(supervisorCommandSha256) ||
    !validExpectedTimestamp(childCreationTimeUtc) ||
    !validExpectedExecutablePath(childExecutablePath) ||
    !validExpectedCommandSha256(childCommandSha256)
  ) {
    return failedAuthorityObservation(taskName, [
      "windows_authority_expected_identity_invalid",
    ]);
  }

  const taskInspector =
    probes.inspectExactWindowsTaskInstances || inspectExactWindowsTaskInstances;
  const processInspector =
    probes.inspectWindowsAuthorityProcess || inspectWindowsAuthorityProcess;
  const jobInspector =
    probes.inspectCurrentWindowsJobMembership ||
    inspectCurrentWindowsJobMembership;

  let task;
  try {
    task = await taskInspector({ taskName, runPowerShell });
  } catch {
    return failedAuthorityObservation(taskName, [
      "windows_task_instance_probe_failed",
    ]);
  }
  if (task?.ok !== true) {
    return failedAuthorityObservation(
      taskName,
      task?.blockers || ["windows_task_instance_probe_failed"],
    );
  }
  if (!Array.isArray(task.instances) || task.instances.length !== 1) {
    return failedAuthorityObservation(taskName, [
      "windows_task_instance_count_invalid",
    ]);
  }
  const taskInstance = task.instances[0];
  if (taskInstance.instance_guid !== taskInstanceGuid.trim()) {
    return failedAuthorityObservation(
      taskName,
      ["windows_task_instance_guid_mismatch"],
      { task_instance: taskInstance },
    );
  }
  if (taskInstance.engine_pid !== supervisorPid) {
    return failedAuthorityObservation(
      taskName,
      ["windows_task_engine_pid_mismatch"],
      { task_instance: taskInstance },
    );
  }
  const expectedTaskState = Number(
    expectedValue(expected, "taskState", "task_state") ?? 4,
  );
  if (taskInstance.state !== expectedTaskState) {
    return failedAuthorityObservation(
      taskName,
      ["windows_task_instance_state_mismatch"],
      { task_instance: taskInstance },
    );
  }

  const supervisorExpected = {
    creation_time_utc: supervisorCreationTimeUtc,
    executable_path: supervisorExecutablePath,
    command_sha256: supervisorCommandSha256,
  };
  let supervisor;
  try {
    supervisor = await processInspector({
      pid: supervisorPid,
      expected: supervisorExpected,
      runPowerShell,
    });
  } catch {
    supervisor = null;
  }
  if (supervisor?.ok !== true) {
    return failedAuthorityObservation(
      taskName,
      supervisor?.blockers || ["windows_authority_process_probe_failed"],
      { task_instance: taskInstance, supervisor },
    );
  }

  const childExpected = {
    creation_time_utc: childCreationTimeUtc,
    parent_pid: supervisorPid,
    executable_path: childExecutablePath,
    command_sha256: childCommandSha256,
  };
  let child;
  try {
    child = await processInspector({
      pid: childPid,
      expected: childExpected,
      runPowerShell,
    });
  } catch {
    child = null;
  }
  if (child?.ok !== true) {
    return failedAuthorityObservation(
      taskName,
      child?.blockers || ["windows_authority_process_probe_failed"],
      { task_instance: taskInstance, supervisor, child },
    );
  }

  let job;
  try {
    job = await jobInspector({ runPowerShell });
  } catch {
    job = null;
  }
  if (job?.ok !== true) {
    return failedAuthorityObservation(
      taskName,
      job?.blockers || ["windows_job_membership_probe_failed"],
      { task_instance: taskInstance, supervisor, child },
    );
  }
  const childPresent = job.process_ids.includes(childPid);
  const jobMembership = {
    process_ids: [...job.process_ids],
    child_present: childPresent,
  };
  if (!childPresent) {
    return failedAuthorityObservation(
      taskName,
      ["windows_authority_child_not_in_job"],
      {
        task_instance: taskInstance,
        supervisor,
        child,
        job_membership: jobMembership,
      },
    );
  }

  return {
    ok: true,
    task_name: taskName,
    task_instance: taskInstance,
    supervisor,
    child,
    job_membership: jobMembership,
    blockers: [],
  };
}

module.exports = {
  compareStableAuthorityObservations,
  inspectCurrentWindowsJobMembership,
  inspectExactWindowsTaskInstances,
  inspectWindowsAuthorityProcess,
  observeBoundedWindowsAuthority,
};
