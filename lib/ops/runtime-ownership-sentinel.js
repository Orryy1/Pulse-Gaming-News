"use strict";

const { execFileSync } = require("node:child_process");

const { getPublicUrl } = require("../deployment-mode");
const { fetchJson } = require("./local-primary-readiness");
const { commitsMatch, expectedRuntimeOwnership } = require("./local-restart-readiness");
const { resolveRuntimeBuildInfo } = require("../runtime-build-info");

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function boolFromRuntime(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normaliseProcess(process) {
  const pid = numberOrNull(
    process?.pid ??
      process?.ProcessId ??
      process?.Id ??
      process?.process_id,
  );
  const name = cleanText(
    process?.name ?? process?.Name ?? process?.ProcessName ?? process?.process_name,
  );
  const commandLine = cleanText(
    process?.command_line ?? process?.CommandLine ?? process?.commandLine,
  );
  const workingDirectory = cleanText(
    process?.working_directory ??
      process?.WorkingDirectory ??
      process?.workingDirectory,
  );
  const lowerCommand = commandLine.toLowerCase();
  const lowerName = name.toLowerCase();
  return {
    pid,
    name,
    command_line: commandLine,
    working_directory: workingDirectory || null,
    is_node: lowerName === "node.exe" || lowerName === "node" || /\bnode(\.exe)?\b/.test(lowerCommand),
    is_server_js: /(^|\s|\\|\/)server\.js(\s|$)/i.test(commandLine),
    is_cloudflared: lowerName === "cloudflared.exe" || lowerName === "cloudflared" || /\bcloudflared(\.exe)?\b/i.test(commandLine),
  };
}

function normaliseProcessSnapshot(snapshot = {}) {
  const processes = asArray(snapshot.processes).map(normaliseProcess);
  const portOwnerPid = numberOrNull(
    snapshot.port_owner_pid ??
      snapshot.portOwnerPid ??
      snapshot.owner_pid ??
      snapshot.pid,
  );
  const port = numberOrNull(snapshot.port) || 3001;
  const portOwner = processes.find((process) => process.pid === portOwnerPid) || null;
  return {
    port,
    port_owner_pid: portOwnerPid,
    port_owner: portOwner,
    processes,
    cloudflared: processes.filter((process) => process.is_cloudflared),
    server_processes: processes.filter((process) => process.is_node && process.is_server_js),
    query_status: snapshot.query_status || snapshot.queryStatus || "provided",
    query_error: snapshot.query_error || snapshot.queryError || null,
  };
}

function healthBuild(health) {
  return health?.json?.build || null;
}

function healthDeployment(health) {
  return health?.json?.deployment || null;
}

function healthRuntime(health) {
  return health?.json?.runtime || null;
}

function healthSchedulerActive(health) {
  return health?.json?.schedulerActive ?? null;
}

function inspectHealth({
  label,
  health,
  expectedBuild,
  expectedRuntime,
} = {}) {
  const blockers = [];
  const warnings = [];
  const build = healthBuild(health);
  const deployment = healthDeployment(health);
  const runtime = healthRuntime(health);
  const prefix = label === "public" ? "public runtime" : "local runtime";

  if (!health?.ok) {
    blockers.push(`${prefix} /api/health is not reachable`);
    return {
      label,
      ok: false,
      blockers,
      warnings,
      facts: {
        status: health?.status ?? null,
        error: health?.error || null,
      },
    };
  }

  if (expectedBuild?.commit_sha && build?.commit_sha && !commitsMatch(expectedBuild.commit_sha, build.commit_sha)) {
    blockers.push(
      `${prefix} commit ${build.commit_short || build.commit_sha} does not match approved ${expectedBuild.commit_short || expectedBuild.commit_sha}`,
    );
  }
  if (expectedBuild?.commit_sha && !build?.commit_sha) {
    blockers.push(`${prefix} commit is missing from health payload`);
  }
  if (expectedBuild?.branch && build?.branch && build.branch !== expectedBuild.branch) {
    blockers.push(`${prefix} branch ${build.branch} does not match approved ${expectedBuild.branch}`);
  }
  if (expectedRuntime?.PULSE_PRIMARY_INSTANCE === true && deployment?.primary !== true) {
    blockers.push(`${prefix} primary=${String(deployment?.primary ?? "unknown")}, expected true`);
  }

  const expectedAuto = expectedRuntime?.AUTO_PUBLISH;
  if (expectedAuto !== null && expectedAuto !== undefined) {
    const actual = boolFromRuntime(runtime?.auto_publish);
    if (actual !== expectedAuto) {
      blockers.push(`${prefix} AUTO_PUBLISH=${String(actual ?? "unknown")} but expected ${expectedAuto}`);
    }
  }

  const expectedQueue = expectedRuntime?.USE_JOB_QUEUE;
  if (expectedQueue !== null && expectedQueue !== undefined) {
    const actual = boolFromRuntime(runtime?.use_job_queue_explicit);
    if (actual !== expectedQueue) {
      blockers.push(`${prefix} USE_JOB_QUEUE=${String(actual ?? "unknown")} but expected ${expectedQueue}`);
    }
  }

  const expectedSafeObservation = expectedRuntime?.PULSE_SAFE_OBSERVATION_MODE;
  if (expectedSafeObservation !== null && expectedSafeObservation !== undefined) {
    const actual = boolFromRuntime(runtime?.safe_observation_mode);
    if (actual !== expectedSafeObservation) {
      blockers.push(`${prefix} safe_observation_mode=${String(actual ?? "unknown")} but expected ${expectedSafeObservation}`);
    }
  }

  if (expectedRuntime?.schedulerActive !== null && expectedRuntime?.schedulerActive !== undefined) {
    const actual = boolFromRuntime(healthSchedulerActive(health));
    if (actual !== expectedRuntime.schedulerActive) {
      blockers.push(`${prefix} schedulerActive=${String(actual ?? "unknown")} but expected ${expectedRuntime.schedulerActive}`);
    }
  }

  if (boolFromRuntime(runtime?.controlled_restart_no_scheduler_mode) === true) {
    blockers.push(`${prefix} is in controlled restart no-scheduler mode`);
  }

  if (runtime?.dispatch?.mode === "legacy_dev") {
    blockers.push(`${prefix} dispatch mode is legacy_dev`);
  } else if (expectedRuntime?.dispatch_mode && runtime?.dispatch?.mode !== expectedRuntime.dispatch_mode) {
    blockers.push(`${prefix} dispatch mode=${runtime?.dispatch?.mode || "unknown"}, expected ${expectedRuntime.dispatch_mode}`);
  }

  return {
    label,
    ok: true,
    blockers,
    warnings,
    facts: {
      status: health?.status ?? null,
      commit_sha: build?.commit_sha || null,
      commit_short: build?.commit_short || null,
      branch: build?.branch || null,
      primary: deployment?.primary ?? null,
      mode: deployment?.mode || null,
      auto_publish: runtime?.auto_publish ?? null,
      use_job_queue_explicit: runtime?.use_job_queue_explicit ?? null,
      schedulerActive: healthSchedulerActive(health),
      dispatch_mode: runtime?.dispatch?.mode || null,
      dispatch_strict: runtime?.dispatch?.strict ?? null,
      safe_observation_mode: runtime?.safe_observation_mode ?? null,
      no_scheduler_mode: runtime?.controlled_restart_no_scheduler_mode ?? null,
    },
  };
}

function inspectProcessOwnership({ processSnapshot, env = {} } = {}) {
  const snapshot = normaliseProcessSnapshot(processSnapshot);
  const blockers = [];
  const warnings = [];
  const expectedPid = numberOrNull(env.PULSE_EXPECTED_SERVER_PID || env.PULSE_APPROVED_SERVER_PID);

  if (snapshot.query_status === "failed") {
    blockers.push(`runtime process query failed: ${snapshot.query_error || "unknown"}`);
  }
  if (!snapshot.port_owner_pid) {
    blockers.push(`no process owns port ${snapshot.port}`);
  } else if (!snapshot.port_owner) {
    blockers.push(`port ${snapshot.port} owner PID ${snapshot.port_owner_pid} was not found in process snapshot`);
  } else if (!snapshot.port_owner.is_node || !snapshot.port_owner.is_server_js) {
    blockers.push(`port ${snapshot.port} owner PID ${snapshot.port_owner_pid} is not node server.js`);
  }
  if (expectedPid && snapshot.port_owner_pid && snapshot.port_owner_pid !== expectedPid) {
    blockers.push(`port ${snapshot.port} owner PID ${snapshot.port_owner_pid} does not match approved PID ${expectedPid}`);
  }
  if (!snapshot.cloudflared.length) {
    blockers.push("cloudflared tunnel process is not present");
  }
  if (snapshot.server_processes.length > 1) {
    warnings.push(`multiple node server.js processes detected: ${snapshot.server_processes.map((process) => process.pid).join(", ")}`);
  }

  return {
    blockers,
    warnings,
    snapshot,
  };
}

function buildRuntimeOwnershipSentinel({
  now = new Date(),
  cwd = process.cwd(),
  env = process.env,
  expectedBuild,
  localHealth,
  publicHealth,
  processSnapshot = {},
  execFileSyncImpl = execFileSync,
} = {}) {
  const build =
    expectedBuild || resolveRuntimeBuildInfo({ cwd, env, execFileSyncImpl });
  const expectedRuntime = expectedRuntimeOwnership({ env, expectedBuild: build });
  const local = inspectHealth({
    label: "local",
    health: localHealth,
    expectedBuild: build,
    expectedRuntime,
  });
  const publicRuntime = inspectHealth({
    label: "public",
    health: publicHealth,
    expectedBuild: build,
    expectedRuntime,
  });
  const processOwnership = inspectProcessOwnership({ processSnapshot, env });

  const blockers = [
    ...local.blockers,
    ...publicRuntime.blockers,
    ...processOwnership.blockers,
  ];
  const warnings = [
    ...local.warnings,
    ...publicRuntime.warnings,
    ...processOwnership.warnings,
  ];

  const verdict = blockers.length ? "red" : warnings.length ? "amber" : "green";
  const selectedRuntime = local.facts?.commit_sha ? local : publicRuntime;
  const snapshot = processOwnership.snapshot;

  return {
    generated_at: now.toISOString(),
    verdict,
    expected: {
      commit_sha: build?.commit_sha || null,
      commit_short: build?.commit_short || null,
      branch: build?.branch || null,
      runtime: expectedRuntime,
      port: Number(env.PORT || snapshot.port || 3001),
    },
    summary: {
      commit_sha: selectedRuntime.facts?.commit_sha || null,
      commit_short: selectedRuntime.facts?.commit_short || null,
      branch: selectedRuntime.facts?.branch || null,
      primary: selectedRuntime.facts?.primary ?? null,
      auto_publish: selectedRuntime.facts?.auto_publish ?? null,
      use_job_queue_explicit: selectedRuntime.facts?.use_job_queue_explicit ?? null,
      scheduler_active: selectedRuntime.facts?.schedulerActive ?? null,
      dispatch_mode: selectedRuntime.facts?.dispatch_mode || null,
      port: snapshot.port,
      port_owner_pid: snapshot.port_owner_pid,
      port_owner_command: snapshot.port_owner?.command_line || null,
      cloudflared_present: snapshot.cloudflared.length > 0,
      cloudflared_pids: snapshot.cloudflared.map((process) => process.pid).filter(Boolean),
      server_pids: snapshot.server_processes.map((process) => process.pid).filter(Boolean),
    },
    health: {
      local,
      public: publicRuntime,
    },
    process_ownership: snapshot,
    blockers,
    warnings,
    scheduler_window_readiness: {
      verdict,
      safe_to_observe_next_window: verdict !== "red",
      hold_scheduler_or_dispatch: verdict === "red",
      dispatch_mode: selectedRuntime.facts?.dispatch_mode || null,
      scheduler_active: selectedRuntime.facts?.schedulerActive ?? null,
      enabled_platform_scope: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      deferred_platform_scope: ["tiktok", "x", "threads", "pinterest"],
      next_action:
        verdict === "green"
          ? "observe_guarded_scheduler_window"
          : verdict === "amber"
            ? "review_runtime_warnings_before_window"
            : "hold_scheduler_and_recover_runtime_ownership",
    },
    safety: {
      read_only: true,
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
      disabled_platforms_counted_live: false,
    },
    recommendation:
      verdict === "green"
        ? "runtime_ownership_green_observe_scheduler"
        : verdict === "amber"
          ? "review_runtime_ownership_warnings"
          : "hold_scheduler_and_recover_runtime_ownership",
  };
}

async function buildRuntimeOwnershipSentinelFromEnvironment({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
  execFileSyncImpl = execFileSync,
} = {}) {
  const port = env.PORT || 3001;
  const publicUrl = getPublicUrl(env);
  const [localHealth, publicHealth] = await Promise.all([
    fetchJson(`http://localhost:${port}/api/health`),
    publicUrl ? fetchJson(`${publicUrl}/api/health`) : Promise.resolve({ ok: false, status: null, error: "public_url_not_configured" }),
  ]);
  const processSnapshot = queryRuntimeProcessSnapshot({
    port,
    execFileSyncImpl,
  });
  return buildRuntimeOwnershipSentinel({
    cwd,
    env,
    now,
    localHealth,
    publicHealth,
    processSnapshot,
    execFileSyncImpl,
  });
}

function queryRuntimeProcessSnapshot({ port = 3001, execFileSyncImpl = execFileSync } = {}) {
  if (process.platform !== "win32") {
    return {
      port: Number(port),
      query_status: "not_windows",
      query_error: null,
      processes: [],
      port_owner_pid: null,
    };
  }

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$port = ${Number(port) || 3001}`,
    "$owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess",
    "$ids = @()",
    "if ($owner) { $ids += [int]$owner }",
    "$server = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'server\\.js' -or $_.Name -match '^cloudflared(\\.exe)?$' }",
    "foreach ($p in @($server)) { if ($p.ProcessId) { $ids += [int]$p.ProcessId } }",
    "$ids = $ids | Sort-Object -Unique",
    "$items = @()",
    "foreach ($id in $ids) {",
    "  $p = Get-CimInstance Win32_Process -Filter \"ProcessId = $id\" -ErrorAction SilentlyContinue",
    "  if ($p) {",
    "    $items += [pscustomobject]@{",
    "      pid = [int]$p.ProcessId",
    "      name = [string]$p.Name",
    "      command_line = [string]$p.CommandLine",
    "      working_directory = $null",
    "    }",
    "  }",
    "}",
    "[pscustomobject]@{",
    "  port = $port",
    "  port_owner_pid = $(if ($owner) { [int]$owner } else { $null })",
    "  processes = $items",
    "  query_status = 'ok'",
    "} | ConvertTo-Json -Depth 5 -Compress",
  ].join("\n");

  try {
    const raw = execFileSyncImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf8",
        timeout: 7000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed;
  } catch (err) {
    return {
      port: Number(port),
      query_status: "failed",
      query_error: err?.message || String(err),
      processes: [],
      port_owner_pid: null,
    };
  }
}

function formatRuntimeOwnershipSentinelMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Ownership Sentinel");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push("");
  lines.push("## Expected");
  lines.push(`- Commit: ${report.expected?.commit_short || report.expected?.commit_sha || "unknown"}`);
  lines.push(`- Branch: ${report.expected?.branch || "unknown"}`);
  lines.push(`- Port: ${report.expected?.port || "unknown"}`);
  lines.push("");
  lines.push("## Live Summary");
  lines.push(`- Commit: ${report.summary?.commit_short || report.summary?.commit_sha || "unknown"}`);
  lines.push(`- Branch: ${report.summary?.branch || "unknown"}`);
  lines.push(`- Primary: ${String(report.summary?.primary ?? "unknown")}`);
  lines.push(`- AUTO_PUBLISH: ${String(report.summary?.auto_publish ?? "unknown")}`);
  lines.push(`- USE_JOB_QUEUE: ${String(report.summary?.use_job_queue_explicit ?? "unknown")}`);
  lines.push(`- Scheduler active: ${String(report.summary?.scheduler_active ?? "unknown")}`);
  lines.push(`- Dispatch mode: ${report.summary?.dispatch_mode || "unknown"}`);
  lines.push(`- Port owner PID: ${String(report.summary?.port_owner_pid ?? "unknown")}`);
  lines.push(`- Cloudflared present: ${report.summary?.cloudflared_present ? "yes" : "no"}`);
  if (report.summary?.cloudflared_pids?.length) {
    lines.push(`- Cloudflared PIDs: ${report.summary.cloudflared_pids.join(", ")}`);
  }
  if (report.summary?.server_pids?.length) {
    lines.push(`- Server PIDs: ${report.summary.server_pids.join(", ")}`);
  }
  lines.push("");
  lines.push("## Scheduler Window");
  lines.push(`- Safe to observe: ${report.scheduler_window_readiness?.safe_to_observe_next_window ? "yes" : "no"}`);
  lines.push(`- Hold scheduler/dispatch: ${report.scheduler_window_readiness?.hold_scheduler_or_dispatch ? "yes" : "no"}`);
  lines.push(`- Next action: ${report.scheduler_window_readiness?.next_action || "unknown"}`);
  if (report.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push(`Recommendation: ${report.recommendation}`);
  lines.push("");
  lines.push("Safety: read-only; no live publish, DB, OAuth, token, billing or platform-setting mutation.");
  return lines.join("\n");
}

module.exports = {
  buildRuntimeOwnershipSentinel,
  buildRuntimeOwnershipSentinelFromEnvironment,
  formatRuntimeOwnershipSentinelMarkdown,
  inspectHealth,
  inspectProcessOwnership,
  normaliseProcessSnapshot,
  queryRuntimeProcessSnapshot,
};
