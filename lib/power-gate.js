/**
 * lib/power-gate.js — the claim predicate used by the local worker.
 *
 * Decides "is right now a safe time to run a GPU job on this box?".
 * Exposed as `isAllowed()`; LocalWorker calls it on every tick and
 * refuses to claim work when it returns false.
 *
 * Gates, all configurable via env:
 *   WORKER_MIN_IDLE_SEC=600   user must be idle at least this long
 *   WORKER_PROTECTED_APPS     comma-separated exe names; if any is
 *                              running, pause (e.g. "obs64.exe,Cyberpunk2077.exe")
 *   WORKER_BATTERY_OK=1       if set, allow running on battery. Default
 *                              (unset) = pause while on battery.
 *   WORKER_IGNORE_POWER=1     disable every gate entirely (testing).
 *   WORKER_WINDOW_START       "HH:MM" (UTC) — don't run before this
 *   WORKER_WINDOW_END         "HH:MM" (UTC) — don't run after this
 *                              (e.g. 01:00–07:00 for overnight only)
 *
 * On non-Windows hosts the PowerShell shell-outs are skipped and the
 * gate resolves to "allowed" (minus any time-window check). This keeps
 * the module useful on the cloud side for tests without forcing a
 * Windows prerequisite.
 */

const { execFile } = require("child_process");
const os = require("os");

const PS_PATH = process.env.POWERSHELL_EXE || "powershell.exe"; // resolves via PATH on Windows

function runPowerShell(script, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(
      PS_PATH,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || "").trim());
      },
    );
  });
}

async function getIdleSeconds() {
  if (os.platform() !== "win32") return Number.MAX_SAFE_INTEGER;
  // GetLastInputInfo via P/Invoke. Returns seconds since last keyboard/mouse input.
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IdleTime {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  public static uint Seconds() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    return (GetTickCount() - lii.dwTime) / 1000;
  }
}
"@
[IdleTime]::Seconds()
`;
  const out = await runPowerShell(script);
  const n = Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : 0;
}

async function getRunningProcessNames() {
  if (os.platform() !== "win32") return new Set();
  const out = await runPowerShell(
    `Get-Process | ForEach-Object { $_.ProcessName + '.exe' } | Sort-Object -Unique`,
  );
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  return new Set(lines);
}

async function isOnBattery() {
  if (os.platform() !== "win32") return false;
  const out = await runPowerShell(
    `(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty BatteryStatus)`,
  );
  // BatteryStatus: 1=Other, 2=Unknown, 3=Fully Charged, 4=Low, 5=Critical,
  //   6=Charging, 7=Charging High, 8=Charging Low, 9=Charging Critical,
  //   10=Undefined, 11=Partially Charged.
  // Status 2 (Unknown) typically means no battery present -> desktop PC.
  const n = Number.parseInt(out, 10);
  if (!Number.isFinite(n)) return false;
  // Running on battery = discharging = 1, 4, 5. On AC when charging/full.
  return n === 1 || n === 4 || n === 5;
}

function withinWindow(now = new Date()) {
  const start = process.env.WORKER_WINDOW_START;
  const end = process.env.WORKER_WINDOW_END;
  if (!start || !end) return true;
  const [sh, sm] = start.split(":").map((n) => Number(n));
  const [eh, em] = end.split(":").map((n) => Number(n));
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin === endMin) return true;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Window crosses midnight (e.g. 22:00 -> 07:00)
  return nowMin >= startMin || nowMin < endMin;
}

function parseProtectedList() {
  const raw = process.env.WORKER_PROTECTED_APPS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.endsWith(".exe") ? s : s + ".exe"));
}

/**
 * Evaluate every gate and return {allowed, reason, signals}.
 * signals is the full telemetry object so worker_events can log why
 * the gate closed.
 */
async function evaluate(now = new Date()) {
  const signals = {
    platform: os.platform(),
    idle_seconds: null,
    on_battery: null,
    running_protected: null,
    within_window: null,
    now_utc: now.toISOString(),
  };

  if (process.env.WORKER_IGNORE_POWER === "1") {
    return { allowed: true, reason: "ignore_power_set", signals };
  }

  signals.within_window = withinWindow(now);
  if (!signals.within_window) {
    return { allowed: false, reason: "outside_window", signals };
  }

  if (os.platform() !== "win32") {
    return { allowed: true, reason: "non_windows_host", signals };
  }

  const minIdle = Number(process.env.WORKER_MIN_IDLE_SEC || 600);
  try {
    signals.idle_seconds = await getIdleSeconds();
  } catch (err) {
    signals.idle_error = err.message;
  }
  if (signals.idle_seconds !== null && signals.idle_seconds < minIdle) {
    return { allowed: false, reason: "user_active", signals };
  }

  try {
    signals.on_battery = await isOnBattery();
  } catch (err) {
    signals.battery_error = err.message;
  }
  if (signals.on_battery && process.env.WORKER_BATTERY_OK !== "1") {
    return { allowed: false, reason: "on_battery", signals };
  }

  const protectedApps = parseProtectedList();
  if (protectedApps.length) {
    try {
      const running = await getRunningProcessNames();
      const match = protectedApps.find((p) => running.has(p));
      signals.running_protected = match || null;
      if (match) {
        return { allowed: false, reason: "protected_app", signals };
      }
    } catch (err) {
      signals.process_error = err.message;
    }
  }

  return { allowed: true, reason: "ok", signals };
}

/**
 * Convenience wrapper for LocalWorker's isAllowed hook. Logs a transition
 * message each time the gate flips state and forwards the event to the
 * worker_events table via the HTTP /api/workers/event endpoint when a
 * `reporter` (async (kind, payload) => void) is supplied.
 */
function createGate({ reporter = null, log = console.log } = {}) {
  let lastAllowed = null;
  let lastReason = null;

  return async function isAllowed() {
    const result = await evaluate().catch((err) => ({
      allowed: true,
      reason: `gate_error:${err.message}`,
      signals: { error: err.message },
    }));

    if (
      lastAllowed !== result.allowed ||
      (lastReason !== result.reason && !result.allowed)
    ) {
      const msg = result.allowed
        ? `[power-gate] unlocked (${result.reason})`
        : `[power-gate] locked: ${result.reason}`;
      log(msg);
      if (reporter) {
        try {
          await reporter(result.allowed ? "unlocked" : "locked", result);
        } catch (err) {
          log(`[power-gate] reporter error: ${err.message}`);
        }
      }
      lastAllowed = result.allowed;
      lastReason = result.reason;
    }
    return result.allowed;
  };
}

module.exports = {
  evaluate,
  createGate,
  getIdleSeconds,
  isOnBattery,
  getRunningProcessNames,
  withinWindow,
};

// CLI: `node lib/power-gate.js` — single-shot diagnostic.
if (require.main === module) {
  evaluate()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.allowed ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(2);
    });
}
