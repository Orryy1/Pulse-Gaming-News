"use strict";

const { execFileSync } = require("node:child_process");

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
  inspectWindowsProcessIdentity,
  unavailableProcessIdentity,
};
