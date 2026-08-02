"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonicalWindowsPath(value) {
  const text = String(value || "").trim();
  return text ? path.win32.normalize(text) : "";
}

function normaliseUtc(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parsePowerShellValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text ? JSON.parse(text) : null;
}

function unavailableAuthorityProcess(pid, blocker) {
  return {
    ok: false,
    pid: Number.isInteger(Number(pid)) ? Number(pid) : null,
    creation_time_utc: null,
    parent_pid: null,
    executable_path: null,
    command_sha256: null,
    blockers: [blocker],
  };
}

async function inspectWindowsAuthorityProcess({
  pid,
  expected = null,
  runPowerShell,
} = {}) {
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) {
    return unavailableAuthorityProcess(
      pid,
      "windows_authority_process_pid_invalid",
    );
  }
  if (typeof runPowerShell !== "function") {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_probe_unavailable",
    );
  }

  const script =
    "$ErrorActionPreference = 'Stop'; " +
    `$item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${processId}\" ` +
    "-ErrorAction Stop | Select-Object ProcessId,ParentProcessId," +
    "CreationDate,ExecutablePath,CommandLine; " +
    "if ($null -eq $item) { $null } else { $item | ConvertTo-Json -Compress }";

  let row;
  try {
    row = parsePowerShellValue(await runPowerShell({ script }));
  } catch {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_probe_failed",
    );
  }
  if (Array.isArray(row)) {
    row = row.length === 1 ? row[0] : null;
  }
  if (!row || typeof row !== "object" || Number(row.ProcessId) !== processId) {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_not_found",
    );
  }

  const creationDate = new Date(row.CreationDate);
  const parentPid = Number(row.ParentProcessId);
  const executablePath = String(row.ExecutablePath || "").trim();
  const commandLine =
    typeof row.CommandLine === "string" ? row.CommandLine : null;
  if (
    Number.isNaN(creationDate.getTime()) ||
    row.ParentProcessId === null ||
    row.ParentProcessId === undefined ||
    !Number.isInteger(parentPid) ||
    parentPid < 0 ||
    !executablePath ||
    !commandLine
  ) {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_identity_incomplete",
    );
  }

  const creationTimeUtc = creationDate.toISOString();
  const canonicalExecutablePath = canonicalWindowsPath(executablePath);
  const commandSha256 = sha256(commandLine);
  const blockers = [];
  if (expected && typeof expected === "object") {
    if (
      expected.creation_time_utc !== undefined &&
      normaliseUtc(expected.creation_time_utc) !== creationTimeUtc
    ) {
      blockers.push("windows_authority_process_creation_time_mismatch");
    }
    if (
      expected.parent_pid !== undefined &&
      Number(expected.parent_pid) !== parentPid
    ) {
      blockers.push("windows_authority_process_parent_pid_mismatch");
    }
    if (
      expected.executable_path !== undefined &&
      canonicalWindowsPath(expected.executable_path).toLowerCase() !==
        canonicalExecutablePath.toLowerCase()
    ) {
      blockers.push("windows_authority_process_executable_path_mismatch");
    }
    if (
      expected.command_sha256 !== undefined &&
      String(expected.command_sha256).toLowerCase() !== commandSha256
    ) {
      blockers.push("windows_authority_process_command_sha256_mismatch");
    }
  }

  return {
    ok: blockers.length === 0,
    pid: processId,
    creation_time_utc: creationTimeUtc,
    parent_pid: parentPid,
    executable_path: canonicalExecutablePath,
    command_sha256: commandSha256,
    blockers,
  };
}

function unavailableProcessIdentity(pid) {
  return {
    available: false,
    exists: null,
    process_id: Number(pid) || null,
    process_started_at: null,
  };
}

function inspectWindowsProcessIdentity({
  pid,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  const processId = Number(pid);
  if (platform !== "win32" || !Number.isInteger(processId) || processId <= 0) {
    return unavailableProcessIdentity(processId);
  }

  const source =
    "$ErrorActionPreference = 'Stop'; try { " +
    `$item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${processId}\" ` +
    "-ErrorAction Stop; " +
    "if ($null -eq $item) { " +
    `[pscustomobject]@{probe='process_identity';attested=$true;` +
    `process_id=${processId};process_started_at=$null} ` +
    "} else { " +
    "$started = $item.CreationDate.ToUniversalTime().ToString(" +
    "'o',[Globalization.CultureInfo]::InvariantCulture); " +
    `[pscustomobject]@{probe='process_identity';attested=$true;` +
    `process_id=${processId};process_started_at=$started} }; ` +
    "} catch { [Console]::Error.WriteLine('process_identity_probe_failed'); exit 17 }";

  try {
    const output = String(
      execFileSyncImpl(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `& { ${source} } | ConvertTo-Json -Compress`,
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ) || "",
    ).trim();
    if (!output) return unavailableProcessIdentity(processId);
    const parsed = JSON.parse(output);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.probe !== "process_identity" ||
      parsed.attested !== true ||
      Number(parsed.process_id) !== processId
    ) {
      return unavailableProcessIdentity(processId);
    }
    if (parsed.process_started_at === null) {
      return {
        available: true,
        exists: false,
        process_id: processId,
        process_started_at: null,
      };
    }
    const startedAt = new Date(parsed.process_started_at);
    if (Number.isNaN(startedAt.getTime())) {
      return unavailableProcessIdentity(processId);
    }
    return {
      available: true,
      exists: true,
      process_id: processId,
      process_started_at: startedAt.toISOString(),
    };
  } catch {
    return unavailableProcessIdentity(processId);
  }
}

module.exports = {
  inspectWindowsAuthorityProcess,
  inspectWindowsProcessIdentity,
  unavailableProcessIdentity,
};
