"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  buildPrimaryRuntimeHoldEnv,
  buildPrimaryRuntimeHoldPowerShellScript,
} = require("../lib/ops/local-primary-runtime-hold-launcher");

function psSingleQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    json: false,
    start: false,
    scriptPath: path.join(process.cwd(), "test", "output", "start_local_server_primary_runtime_hold.ps1"),
    logPath: path.join(process.cwd(), "test", "output", "local_server_primary_runtime_hold.log"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--start") opts.start = true;
    else if (arg === "--script-path") opts.scriptPath = path.resolve(argv[++i] || "");
    else if (arg === "--log-path") opts.logPath = path.resolve(argv[++i] || "");
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function usage() {
  return [
    "Usage: node tools/local-primary-runtime-hold-server.js [--json] [--start] [--script-path PATH] [--log-path PATH]",
    "",
    "Writes a PowerShell launcher that reports local primary while holding scheduler, Discord bot and posting side effects off.",
    "Default mode writes the script only. --start launches it hidden without enabling publishing.",
  ].join("\n");
}

function writePrimaryRuntimeHoldScript({ cwd = process.cwd(), scriptPath, logPath }) {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  const script = buildPrimaryRuntimeHoldPowerShellScript({ cwd, logPath });
  fs.writeFileSync(scriptPath, script, "utf8");
  return {
    script_path: scriptPath,
    log_path: logPath,
    script,
  };
}

function startPrimaryRuntimeHoldScript({
  cwd = process.cwd(),
  scriptPath,
  spawnImpl = spawn,
}) {
  const command = [
    "Start-Process",
    "-FilePath",
    psSingleQuote("powershell.exe"),
    "-ArgumentList",
    `@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ${psSingleQuote(scriptPath)})`,
    "-WindowStyle Hidden",
    "-WorkingDirectory",
    psSingleQuote(cwd),
  ].join(" ");
  const child = spawnImpl(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      cwd,
      detached: false,
      env: buildPrimaryRuntimeHoldEnv(process.env),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  return {
    pid: child.pid,
    windows_hide: true,
    detached: false,
    launch_method: "windows_start_process_hidden",
  };
}

function buildReport({ opts, writeResult, startResult = null }) {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: opts.start ? "write_and_start_primary_runtime_hold" : "write_script_only",
    script_path: writeResult.script_path,
    log_path: writeResult.log_path,
    started: !!startResult,
    start_result: startResult,
    forced_env: {
      PULSE_PRIMARY_RUNTIME_HOLD: "true",
      PULSE_SAFE_OBSERVATION_MODE: "false",
      PULSE_PRIMARY_INSTANCE: "true",
      AUTO_PUBLISH: "false",
      DEPLOYMENT_MODE: "local",
      USE_JOB_QUEUE: "true",
      PULSE_DISABLE_DISCORD_BOT: "true",
    },
    safety: {
      no_publish_enabled: true,
      primary_health_signal: true,
      scheduler_runner_disabled: true,
      discord_bot_disabled: true,
      no_oauth_or_token_change: true,
      no_network_uploads: true,
    },
    validation_command: "npm run ops:local-restart-readiness -- --json",
  };
}

async function main() {
  const opts = parseArgs();
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const writeResult = writePrimaryRuntimeHoldScript({
    cwd: process.cwd(),
    scriptPath: opts.scriptPath,
    logPath: opts.logPath,
  });
  const startResult = opts.start
    ? startPrimaryRuntimeHoldScript({ cwd: process.cwd(), scriptPath: opts.scriptPath })
    : null;
  const report = buildReport({ opts, writeResult, startResult });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Primary runtime hold script: ${report.script_path}\n`);
    process.stdout.write(`Log path: ${report.log_path}\n`);
    process.stdout.write(`Started: ${String(report.started)}\n`);
    process.stdout.write(`Validate: ${report.validation_command}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-primary-runtime-hold-server] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReport,
  parseArgs,
  startPrimaryRuntimeHoldScript,
  writePrimaryRuntimeHoldScript,
};
