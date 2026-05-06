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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const pythonPath =
    env.LOCAL_TTS_PYTHON ||
    env.STUDIO_V2_LOCAL_TTS_PYTHON ||
    (fs.existsSync(venvPython) ? venvPython : "python");
  const logsDir = path.join(serverDir, "logs");
  return {
    root: path.resolve(root),
    serverDir,
    pythonPath,
    logsDir,
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
  spawnImpl = childProcess.spawn,
} = {}) {
  const spec = buildLocalTtsStartSpec({ root, env, platform });
  fs.mkdirSync(spec.logsDir, { recursive: true });
  const stdout = fs.openSync(spec.stdoutPath, "a");
  const stderr = fs.openSync(spec.stderrPath, "a");
  const child = spawnImpl(spec.pythonPath, spec.args, {
    cwd: spec.serverDir,
    detached: true,
    env: spec.env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  if (typeof child.unref === "function") child.unref();
  return {
    pid: child.pid || null,
    spec: {
      pythonPath: spec.pythonPath,
      args: spec.args,
      serverDir: spec.serverDir,
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
  lines.push(`- reason: ${report.reason}`);
  lines.push(`- before: ${formatLocalTtsStatus(report.before)}`);
  if (report.after) lines.push(`- after: ${formatLocalTtsStatus(report.after)}`);
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
  renderLocalTtsDoctorMarkdown,
  resolveLocalTtsRuntimePaths,
  startLocalTtsServer,
  waitForLocalTtsHealth,
};
