"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  buildSafeObservationEnv,
  buildSafeObservationPowerShellScript,
} = require("../lib/ops/local-safe-observation-launcher");

function psSingleQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    json: false,
    start: false,
    scriptPath: path.join(process.cwd(), "test", "output", "start_local_server_safe_observation.ps1"),
    logPath: path.join(process.cwd(), "test", "output", "local_server_safe_observation.log"),
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
    "Usage: node tools/local-safe-observation-server.js [--json] [--start] [--script-path PATH] [--log-path PATH]",
    "",
    "Writes a PowerShell launcher that forces local safe-observation mode.",
    "Default mode writes the script only. --start launches it hidden without enabling publishing.",
  ].join("\n");
}

function writeSafeObservationScript({ cwd = process.cwd(), scriptPath, logPath }) {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  const script = buildSafeObservationPowerShellScript({ cwd, logPath });
  fs.writeFileSync(scriptPath, script, "utf8");
  return {
    script_path: scriptPath,
    log_path: logPath,
    script,
  };
}

function startSafeObservationScript({
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
      env: buildSafeObservationEnv(process.env),
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
    mode: opts.start ? "write_and_start_safe_observation" : "write_script_only",
    script_path: writeResult.script_path,
    log_path: writeResult.log_path,
    started: !!startResult,
    start_result: startResult,
    forced_env: {
      PULSE_SAFE_OBSERVATION_MODE: "true",
      AUTO_PUBLISH: "false",
      PULSE_PRIMARY_INSTANCE: "false",
      DEPLOYMENT_MODE: "local",
      USE_JOB_QUEUE: "true",
    },
    safety: {
      no_publish_enabled: true,
      no_primary_enabled: true,
      no_oauth_or_token_change: true,
      no_db_mutation: true,
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
  const writeResult = writeSafeObservationScript({
    cwd: process.cwd(),
    scriptPath: opts.scriptPath,
    logPath: opts.logPath,
  });
  const startResult = opts.start
    ? startSafeObservationScript({ cwd: process.cwd(), scriptPath: opts.scriptPath })
    : null;
  const report = buildReport({ opts, writeResult, startResult });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Safe observation script: ${report.script_path}\n`);
    process.stdout.write(`Log path: ${report.log_path}\n`);
    process.stdout.write(`Started: ${String(report.started)}\n`);
    process.stdout.write(`Validate: ${report.validation_command}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-safe-observation-server] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReport,
  parseArgs,
  startSafeObservationScript,
  writeSafeObservationScript,
};
