"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
  formatLocalTtsStatus,
  prewarmLocalTtsVoice,
} = require("./local-tts-readiness");
const {
  formatLocalGpuPressure,
} = require("./local-gpu-pressure");

const DEFAULT_START_LOCK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_RECENT_BOOT_COOLDOWN_MS = 30 * 60 * 1000;
const BOOT_LOG_TAIL_BYTES = 256 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function resolveWindowlessPythonPath(
  pythonPath,
  {
    env = process.env,
    platform = process.platform,
  } = {},
) {
  const resolved = pythonPath || "python";
  if (platform !== "win32" || envFlagEnabled(env.LOCAL_TTS_ALLOW_CONSOLE)) return resolved;
  const basename = path.basename(resolved).toLowerCase();
  if (basename !== "python.exe" && basename !== "python") return resolved;
  const pythonwPath =
    basename === "python"
      ? path.join(path.dirname(resolved), "pythonw")
      : path.join(path.dirname(resolved), "pythonw.exe");
  return pythonwPath;
}

function resolveLocalTtsRuntimePaths({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
} = {}) {
  const serverDir = path.resolve(root, "tts_server");
  const venvPython =
    platform === "win32"
      ? path.join(serverDir, "venv", "Scripts", "python.exe")
      : path.join(serverDir, "venv", "bin", "python");
  const venvPythonw =
    platform === "win32"
      ? path.join(serverDir, "venv", "Scripts", "pythonw.exe")
      : null;
  const allowConsole = envFlagEnabled(env.LOCAL_TTS_ALLOW_CONSOLE);
  const defaultPython =
    platform === "win32" && !allowConsole && venvPythonw && fs.existsSync(venvPythonw)
      ? venvPythonw
      : fs.existsSync(venvPython)
        ? venvPython
        : "python";
  const pythonPath =
    resolveWindowlessPythonPath(
      env.LOCAL_TTS_PYTHON ||
        env.STUDIO_V2_LOCAL_TTS_PYTHON ||
        defaultPython,
      { env, platform },
    );
  const logsDir = path.join(serverDir, "logs");
  return {
    root: path.resolve(root),
    serverDir,
    pythonPath,
    logsDir,
    startLockPath: path.join(logsDir, "server_start.lock"),
    stdoutPath: path.join(logsDir, "server_stdout.log"),
    stderrPath: path.join(logsDir, "server_stderr.log"),
  };
}

function buildLocalTtsStartSpec({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
  host = env.LOCAL_TTS_HOST || "127.0.0.1",
  port = env.LOCAL_TTS_PORT || "8765",
  logLevel = env.LOCAL_TTS_LOG_LEVEL || "info",
} = {}) {
  const paths = resolveLocalTtsRuntimePaths({ root, env, platform });
  return {
    ...paths,
    args: [
      "-m",
      "uvicorn",
      "server:app",
      "--host",
      String(host),
      "--port",
      String(port),
      "--log-level",
      String(logLevel),
    ],
    env: {
      ...env,
      HOST: String(host),
      PORT: String(port),
    },
  };
}

function parsePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFileTail(filePath, maxBytes = BOOT_LOG_TAIL_BYTES) {
  if (!fs.existsSync(filePath)) return "";
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxBytes);
  if (bytesToRead <= 0) return "";
  const buffer = Buffer.alloc(bytesToRead);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString("utf8");
}

function parseLocalTtsBootTimestampMs(line) {
  const explicit = String(line || "").match(/\bts=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z)\b/);
  if (explicit) {
    const parsed = Date.parse(explicit[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  const leading = String(line || "").match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})[ T]([0-9]{2}:[0-9]{2}:[0-9]{2})(?:[,.][0-9]+)?/);
  if (leading) {
    const parsed = Date.parse(`${leading[1]}T${leading[2]}`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function findLatestLocalTtsBootMs(stderrPath) {
  const tail = readFileTail(stderrPath);
  let latest = null;
  for (const line of tail.split(/\r?\n/)) {
    if (!line.includes("[boot] pulse-gaming tts_server starting")) continue;
    const parsed = parseLocalTtsBootTimestampMs(line);
    if (Number.isFinite(parsed) && (latest === null || parsed > latest)) latest = parsed;
  }
  return latest;
}

function hasRecentLocalTtsBootAttempt(
  stderrPath,
  {
    now = Date.now(),
    cooldownMs = DEFAULT_RECENT_BOOT_COOLDOWN_MS,
  } = {},
) {
  const lastBootMs = findLatestLocalTtsBootMs(stderrPath);
  if (!Number.isFinite(lastBootMs)) {
    return {
      recent: false,
      lastBootAt: null,
      ageMs: null,
      cooldownMs,
    };
  }
  const ageMs = now - lastBootMs;
  return {
    recent: ageMs >= 0 && ageMs < cooldownMs,
    lastBootAt: new Date(lastBootMs).toISOString(),
    ageMs,
    cooldownMs,
  };
}

function isFreshStartLock(lockPath, { now = Date.now(), ttlMs = DEFAULT_START_LOCK_TTL_MS } = {}) {
  if (!fs.existsSync(lockPath)) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const startedAt = Date.parse(lock.started_at || lock.startedAt || "");
    return Number.isFinite(startedAt) && now - startedAt < ttlMs;
  } catch {
    try {
      const stat = fs.statSync(lockPath);
      return now - stat.mtimeMs < ttlMs;
    } catch {
      return false;
    }
  }
}

function acquireStartLock(lockPath, { now = Date.now(), ttlMs = DEFAULT_START_LOCK_TTL_MS } = {}) {
  if (isFreshStartLock(lockPath, { now, ttlMs })) return false;
  if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify({ started_at: new Date(now).toISOString(), pid: null }),
    );
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  }
}

function stampStartLockPid(lockPath, pid, now = Date.now()) {
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ started_at: new Date(now).toISOString(), pid: pid || null }),
    );
  } catch {}
}

function classifyLocalTtsDoctorAction(summary, options = {}) {
  const allowRestart = options.allowRestart === true;
  const allowPrewarm = options.allowPrewarm === true;
  const status = String(summary?.status || "unknown");
  const phase = String(summary?.phase || "unknown");
  const voice = summary?.voice || {};

  if (summary?.ok) {
    return {
      action: "none",
      verdict: "green",
      reason: "local TTS is ready with the accepted voice loaded",
    };
  }

  if (status === "unreachable") {
    return {
      action: allowRestart ? "start" : "manual_start_required",
      verdict: allowRestart ? "amber" : "red",
      reason: "local TTS HTTP health is unreachable",
    };
  }

  if (phase === "failed") {
    return {
      action: allowRestart ? "restart" : "manual_restart_required",
      verdict: allowRestart ? "amber" : "red",
      reason: "local TTS service reports failed phase",
    };
  }

  if (
    status === "ok" &&
    summary?.ready === true &&
    voice.present === true &&
    voice.refResolved === true &&
    voice.loaded !== true
  ) {
    return {
      action: allowPrewarm ? "prewarm" : "manual_prewarm_required",
      verdict: "amber",
      reason: "accepted voice reference is present but the voice is not loaded",
    };
  }

  return {
    action: "inspect",
    verdict: "red",
    reason: (summary?.reasons || []).join("; ") || "local TTS is not ready",
  };
}

async function startLocalTtsServer({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
  now = Date.now(),
  spawnImpl = childProcess.spawn,
} = {}) {
  const spec = buildLocalTtsStartSpec({ root, env, platform });
  fs.mkdirSync(spec.logsDir, { recursive: true });
  const lockTtlMs = parsePositiveMs(env.LOCAL_TTS_START_LOCK_TTL_MS, DEFAULT_START_LOCK_TTL_MS);
  const recentBootCooldownMs = parsePositiveMs(
    env.LOCAL_TTS_RECENT_BOOT_COOLDOWN_MS,
    DEFAULT_RECENT_BOOT_COOLDOWN_MS,
  );
  const recentBoot = hasRecentLocalTtsBootAttempt(spec.stderrPath, {
    now,
    cooldownMs: recentBootCooldownMs,
  });
  if (recentBoot.recent) {
    return {
      pid: null,
      skipped: true,
      reason: "recent_boot_cooldown",
      recent_boot: recentBoot,
      spec: {
        pythonPath: spec.pythonPath,
        args: spec.args,
        serverDir: spec.serverDir,
        startLockPath: spec.startLockPath,
        stdoutPath: spec.stdoutPath,
        stderrPath: spec.stderrPath,
      },
    };
  }
  if (!acquireStartLock(spec.startLockPath, { now, ttlMs: lockTtlMs })) {
    return {
      pid: null,
      skipped: true,
      reason: "start_lock_active",
      spec: {
        pythonPath: spec.pythonPath,
        args: spec.args,
        serverDir: spec.serverDir,
        startLockPath: spec.startLockPath,
        stdoutPath: spec.stdoutPath,
        stderrPath: spec.stderrPath,
      },
    };
  }
  const stdout = fs.openSync(spec.stdoutPath, "a");
  const stderr = fs.openSync(spec.stderrPath, "a");
  let child;
  try {
    child = spawnImpl(spec.pythonPath, spec.args, {
      cwd: spec.serverDir,
      detached: true,
      env: spec.env,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
  } catch (err) {
    fs.rmSync(spec.startLockPath, { force: true });
    throw err;
  }
  stampStartLockPid(spec.startLockPath, child.pid, now);
  if (typeof child.unref === "function") child.unref();
  return {
    pid: child.pid || null,
    spec: {
      pythonPath: spec.pythonPath,
      args: spec.args,
      serverDir: spec.serverDir,
      startLockPath: spec.startLockPath,
      stdoutPath: spec.stdoutPath,
      stderrPath: spec.stderrPath,
    },
  };
}

async function waitForLocalTtsHealth({
  baseUrl = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
  voiceId,
  timeoutMs = 30000,
  intervalMs = 1000,
  fetchImpl = fetch,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastSummary = null;
  while (Date.now() <= deadline) {
    lastSummary = await fetchLocalTtsHealth({
      baseUrl,
      voiceId,
      timeoutMs: Math.min(5000, intervalMs),
      fetchImpl,
    });
    if (lastSummary.status !== "unreachable") return lastSummary;
    await sleep(intervalMs);
  }
  return lastSummary;
}

function renderLocalTtsDoctorMarkdown(report) {
  const lines = [];
  lines.push("# Local TTS Doctor");
  lines.push("");
  lines.push(`- verdict: ${report.verdict}`);
  lines.push(`- action: ${report.action}`);
  if (report.failure_code) lines.push(`- failure code: ${report.failure_code}`);
  lines.push(`- reason: ${report.reason}`);
  lines.push(`- before: ${formatLocalTtsStatus(report.before)}`);
  if (report.after) lines.push(`- after: ${formatLocalTtsStatus(report.after)}`);
  if (report.gpu) lines.push(`- gpu: ${formatLocalGpuPressure(report.gpu)}`);
  if (report.prewarm) {
    lines.push(
      `- prewarm: ok=${report.prewarm.ok === true} reused=${report.prewarm.reused === true} loaded_ms=${report.prewarm.loadedMs ?? "-"}`,
    );
  }
  if (report.started) {
    lines.push(`- started pid: ${report.started.pid || "unknown"}`);
    lines.push(`- stdout: ${report.started.spec.stdoutPath}`);
    lines.push(`- stderr: ${report.started.spec.stderrPath}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local-only: starts `tts_server` on 127.0.0.1.");
  lines.push("- Does not mutate Railway, OAuth, tokens, the production database or social platforms.");
  lines.push("- Prewarm only loads the accepted local Liam voice into the local process.");
  return lines.join("\n");
}

module.exports = {
  buildLocalTtsStartSpec,
  classifyLocalTtsDoctorAction,
  hasRecentLocalTtsBootAttempt,
  isFreshStartLock,
  renderLocalTtsDoctorMarkdown,
  resolveLocalTtsRuntimePaths,
  resolveWindowlessPythonPath,
  startLocalTtsServer,
  waitForLocalTtsHealth,
};
