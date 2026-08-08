"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function commandArgumentsSha256(arguments_) {
  if (
    !Array.isArray(arguments_) ||
    arguments_.some((argument) => typeof argument !== "string")
  ) {
    throw new Error("windows_command_arguments_invalid");
  }
  return sha256(JSON.stringify(arguments_));
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

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies 'System.Web.Extensions.dll' -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

public static class PulseCommandLineIdentity
{
    [DllImport("shell32.dll", SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(
        [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
        out int argumentCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string HashArguments(string commandLine)
    {
        if (String.IsNullOrWhiteSpace(commandLine)) return null;
        int argumentCount = 0;
        IntPtr argumentPointers = CommandLineToArgvW(commandLine, out argumentCount);
        if (argumentPointers == IntPtr.Zero || argumentCount < 1) return null;
        try
        {
            string[] arguments = new string[Math.Max(0, argumentCount - 1)];
            for (int index = 1; index < argumentCount; index++)
            {
                IntPtr argumentPointer = Marshal.ReadIntPtr(
                    argumentPointers,
                    index * IntPtr.Size);
                string argument = Marshal.PtrToStringUni(argumentPointer);
                if (argument == null) return null;
                arguments[index - 1] = argument;
            }
            string stableJson = new JavaScriptSerializer().Serialize(arguments);
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(stableJson));
                return BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
            }
        }
        finally
        {
            LocalFree(argumentPointers);
        }
    }
}
'@
$item = Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}" -ErrorAction Stop
if ($null -eq $item) {
  $null
} else {
  $commandSha256 = [PulseCommandLineIdentity]::HashArguments($item.CommandLine)
  [pscustomobject]@{
    ProcessId = $item.ProcessId
    ParentProcessId = $item.ParentProcessId
    CreationDate = $item.CreationDate.ToUniversalTime().ToString(
      'o',
      [Globalization.CultureInfo]::InvariantCulture)
    ExecutablePath = $item.ExecutablePath
    CommandParsed = ($null -ne $commandSha256)
    CommandSha256 = $commandSha256
  } | ConvertTo-Json -Compress
}`.trim();

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
  if (
    Number.isNaN(creationDate.getTime()) ||
    row.ParentProcessId === null ||
    row.ParentProcessId === undefined ||
    !Number.isInteger(parentPid) ||
    parentPid < 0 ||
    !executablePath
  ) {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_identity_incomplete",
    );
  }

  if (
    row.CommandParsed !== true ||
    typeof row.CommandSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.CommandSha256)
  ) {
    return unavailableAuthorityProcess(
      processId,
      "windows_authority_process_command_parse_failed",
    );
  }

  const creationTimeUtc = creationDate.toISOString();
  const canonicalExecutablePath = canonicalWindowsPath(executablePath);
  const commandSha256 = row.CommandSha256;
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
  commandArgumentsSha256,
  inspectWindowsAuthorityProcess,
  inspectWindowsProcessIdentity,
  unavailableProcessIdentity,
};
