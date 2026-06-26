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

function normaliseGitPath(filePath) {
  return cleanText(filePath).replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isRuntimeRelevantCommitPath(filePath) {
  const file = normaliseGitPath(filePath);
  if (!file) return false;
  if (
    file.startsWith("docs/") ||
    file.startsWith("tests/") ||
    file.startsWith("test/") ||
    file.startsWith("output/") ||
    file.startsWith(".codex/") ||
    file.startsWith(".github/") ||
    file.endsWith(".md") ||
    file.endsWith(".txt")
  ) {
    return false;
  }
  return true;
}

function describeCommit(value) {
  const text = cleanText(value);
  return text ? text.slice(0, 8) : "unknown";
}

function classifyCommitDrift({
  expectedSha,
  runningSha,
  cwd = process.cwd(),
  execFileSyncImpl = execFileSync,
} = {}) {
  if (commitsMatch(expectedSha, runningSha)) {
    return {
      matches: true,
      safe_to_ignore: true,
      changed_files: [],
      runtime_relevant_files: [],
      non_runtime_files: [],
      reason: "commits_match",
    };
  }
  if (!expectedSha || !runningSha) {
    return {
      matches: false,
      safe_to_ignore: false,
      changed_files: [],
      runtime_relevant_files: [],
      non_runtime_files: [],
      reason: "commit_missing",
    };
  }

  try {
    const raw = String(
      execFileSyncImpl(
        "git",
        ["diff", "--name-only", runningSha, expectedSha, "--"],
        {
          cwd,
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ) || "",
    );
    const changedFiles = raw
      .split(/\r?\n/)
      .map(normaliseGitPath)
      .filter(Boolean);
    const runtimeRelevantFiles = changedFiles.filter(isRuntimeRelevantCommitPath);
    return {
      matches: false,
      safe_to_ignore: changedFiles.length > 0 && runtimeRelevantFiles.length === 0,
      changed_files: changedFiles.slice(0, 50),
      runtime_relevant_files: runtimeRelevantFiles.slice(0, 50),
      non_runtime_files: changedFiles
        .filter((file) => !isRuntimeRelevantCommitPath(file))
        .slice(0, 50),
      reason:
        changedFiles.length === 0
          ? "no_diff_files_found"
          : runtimeRelevantFiles.length
            ? "runtime_relevant_files_changed"
            : "non_runtime_only",
    };
  } catch (err) {
    return {
      matches: false,
      safe_to_ignore: false,
      changed_files: [],
      runtime_relevant_files: [],
      non_runtime_files: [],
      reason: "diff_failed",
      error: err?.message || String(err),
    };
  }
}

function asActionKey(action = {}) {
  const storyId = cleanText(action.story_id || action.storyId || action.id);
  const platform = cleanText(action.platform);
  return storyId && platform ? `${storyId}:${platform}` : "";
}

function parsedTimeMs(value) {
  const text = cleanText(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function dryRunSafetyOk(plan = {}) {
  const safety = plan.safety || {};
  return (
    safety.dry_run_only === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function enabledDryRunActionKeys(plan = {}) {
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  return new Set(actions
    .filter((action) =>
      cleanText(action.action) === "would_publish" &&
      action.platform_enabled === true &&
      Array.isArray(action.blockers) &&
      action.blockers.length === 0,
    )
    .map(asActionKey)
    .filter(Boolean));
}

function executorHandoffActionKeys(plan = {}) {
  const actions = Array.isArray(plan.handoff_ready_actions) ? plan.handoff_ready_actions : [];
  return new Set(actions.map(asActionKey).filter(Boolean));
}

function storyIdsFromActionKeys(keys = new Set()) {
  const storyIds = new Set();
  for (const key of keys) {
    const storyId = cleanText(String(key || "").split(":")[0]);
    if (storyId) storyIds.add(storyId);
  }
  return storyIds;
}

function actionKeysForPlatform(keys = new Set(), platform = "") {
  const target = cleanText(platform);
  if (!target) return new Set();
  const filtered = new Set();
  for (const key of keys) {
    const text = cleanText(key);
    if (!text) continue;
    const index = text.lastIndexOf(":");
    if (index < 0) continue;
    if (cleanText(text.slice(index + 1)) === target) filtered.add(text);
  }
  return filtered;
}

function inspectSchedulerProof({ schedulerProof = {}, env = {} } = {}) {
  const blockers = [];
  const warnings = [];
  const dryRunPlan = schedulerProof.dryRunPlan || null;
  const executorPlan = schedulerProof.executorPlan || null;
  const guardedDispatchPlan = schedulerProof.guardedDispatchPlan || null;
  const staleMinutes = numberOrNull(env.PULSE_SCHEDULER_HANDOFF_STALE_MINUTES) ?? 15;

  if (!dryRunPlan && !executorPlan && !guardedDispatchPlan) {
    return {
      blockers,
      warnings,
      facts: {
        checked: false,
      },
    };
  }

  const dryRunGeneratedMs = parsedTimeMs(dryRunPlan?.generated_at);
  const executorGeneratedMs = parsedTimeMs(executorPlan?.generated_at);
  const guardedGeneratedMs = parsedTimeMs(guardedDispatchPlan?.generated_at);
  const dryRunKeys = enabledDryRunActionKeys(dryRunPlan || {});
  const executorKeys = executorHandoffActionKeys(executorPlan || {});
  const missingFromExecutor = Array.from(dryRunKeys).filter((key) => !executorKeys.has(key));
  const dryRunStoryIds = storyIdsFromActionKeys(dryRunKeys);
  const executorStoryIds = storyIdsFromActionKeys(executorKeys);
  const missingFromExecutorStoryIds = storyIdsFromActionKeys(new Set(missingFromExecutor));
  const dryRunYoutubeKeys = actionKeysForPlatform(dryRunKeys, "youtube_shorts");
  const executorYoutubeKeys = actionKeysForPlatform(executorKeys, "youtube_shorts");
  const dryRunYoutubeStoryIds = storyIdsFromActionKeys(dryRunYoutubeKeys);
  const executorYoutubeStoryIds = storyIdsFromActionKeys(executorYoutubeKeys);

  if (dryRunPlan && !dryRunSafetyOk(dryRunPlan)) {
    blockers.push("current dry-run proof safety contract is not intact");
  }
  if (dryRunKeys.size > 0 && executorKeys.size === 0) {
    blockers.push("guarded executor handoff has no actions while current dry-run has enabled actions");
  }
  if (
    dryRunGeneratedMs !== null &&
    executorGeneratedMs !== null &&
    dryRunKeys.size > 0 &&
    missingFromExecutor.length > 0 &&
    dryRunGeneratedMs - executorGeneratedMs > staleMinutes * 60_000
  ) {
    blockers.push(
      `guarded executor handoff stale: dry-run is newer by ${Math.round((dryRunGeneratedMs - executorGeneratedMs) / 60_000)} minutes`,
    );
    blockers.push(
      `missing current enabled dry-run actions from executor handoff: ${missingFromExecutor.slice(0, 8).join(", ")}`,
    );
  }
  if (
    guardedGeneratedMs !== null &&
    executorGeneratedMs !== null &&
    guardedGeneratedMs - executorGeneratedMs > staleMinutes * 60_000
  ) {
    blockers.push(
      `guarded dispatch plan is newer than executor handoff by ${Math.round((guardedGeneratedMs - executorGeneratedMs) / 60_000)} minutes`,
    );
  }
  if (dryRunKeys.size === 0) {
    warnings.push("current dry-run proof has no enabled platform actions");
  }

  return {
    blockers,
    warnings,
    facts: {
      checked: true,
      dry_run_generated_at: dryRunPlan?.generated_at || null,
      executor_generated_at: executorPlan?.generated_at || null,
      guarded_dispatch_generated_at: guardedDispatchPlan?.generated_at || null,
      enabled_dry_run_action_count: dryRunKeys.size,
      executor_handoff_action_count: executorKeys.size,
      enabled_dry_run_story_count: dryRunStoryIds.size,
      executor_handoff_story_count: executorStoryIds.size,
      enabled_dry_run_youtube_action_count: dryRunYoutubeKeys.size,
      executor_handoff_youtube_action_count: executorYoutubeKeys.size,
      enabled_dry_run_youtube_story_count: dryRunYoutubeStoryIds.size,
      executor_handoff_youtube_story_count: executorYoutubeStoryIds.size,
      missing_from_executor_story_count: missingFromExecutorStoryIds.size,
      missing_from_executor_count: missingFromExecutor.length,
      missing_from_executor: missingFromExecutor.slice(0, 20),
      missing_from_executor_story_ids: Array.from(missingFromExecutorStoryIds).slice(0, 20),
    },
  };
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
  cwd = process.cwd(),
  execFileSyncImpl = execFileSync,
} = {}) {
  const blockers = [];
  const warnings = [];
  const advisory = [];
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

  const commitDrift =
    expectedBuild?.commit_sha && build?.commit_sha
      ? classifyCommitDrift({
          expectedSha: expectedBuild.commit_sha,
          runningSha: build.commit_sha,
          cwd,
          execFileSyncImpl,
        })
      : null;
  if (commitDrift && !commitDrift.matches) {
    if (commitDrift.safe_to_ignore) {
      advisory.push(
        `${prefix} commit drift is non-runtime-only: running ${describeCommit(build.commit_sha)} vs approved ${describeCommit(expectedBuild.commit_sha)} (${commitDrift.non_runtime_files.slice(0, 6).join(", ")})`,
      );
    } else if (commitDrift.runtime_relevant_files.length) {
      blockers.push(
        `${prefix} commit ${build.commit_short || build.commit_sha} does not match approved ${expectedBuild.commit_short || expectedBuild.commit_sha}; runtime-relevant files changed: ${commitDrift.runtime_relevant_files.slice(0, 6).join(", ")}`,
      );
    } else {
      blockers.push(
        `${prefix} commit ${build.commit_short || build.commit_sha} does not match approved ${expectedBuild.commit_short || expectedBuild.commit_sha}`,
      );
    }
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

  const expectedGuardedLiveDispatch = expectedRuntime?.PULSE_GUARDED_LIVE_DISPATCH_ENABLED;
  if (expectedGuardedLiveDispatch !== null && expectedGuardedLiveDispatch !== undefined) {
    const actual = boolFromRuntime(runtime?.guarded_live_dispatch_enabled);
    if (actual !== expectedGuardedLiveDispatch) {
      blockers.push(`${prefix} guarded live dispatch=${String(actual ?? "unknown")} but expected ${expectedGuardedLiveDispatch}`);
    }
  }

  const expectedKillSwitchClear = expectedRuntime?.PULSE_EMERGENCY_KILL_SWITCH_CLEAR;
  if (expectedKillSwitchClear !== null && expectedKillSwitchClear !== undefined) {
    const actual = boolFromRuntime(runtime?.emergency_kill_switch_clear);
    if (actual !== expectedKillSwitchClear) {
      blockers.push(`${prefix} kill switch clear=${String(actual ?? "unknown")} but expected ${expectedKillSwitchClear}`);
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
    advisory,
    facts: {
      status: health?.status ?? null,
      commit_sha: build?.commit_sha || null,
      commit_short: build?.commit_short || null,
      branch: build?.branch || null,
      commit_drift: commitDrift,
      primary: deployment?.primary ?? null,
      mode: deployment?.mode || null,
      auto_publish: runtime?.auto_publish ?? null,
      use_job_queue_explicit: runtime?.use_job_queue_explicit ?? null,
      guarded_live_dispatch_enabled: runtime?.guarded_live_dispatch_enabled ?? null,
      emergency_kill_switch_clear: runtime?.emergency_kill_switch_clear ?? null,
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
  schedulerProof = {},
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
    cwd,
    execFileSyncImpl,
  });
  const publicRuntime = inspectHealth({
    label: "public",
    health: publicHealth,
    expectedBuild: build,
    expectedRuntime,
    cwd,
    execFileSyncImpl,
  });
  const processOwnership = inspectProcessOwnership({ processSnapshot, env });
  const schedulerProofInspection = inspectSchedulerProof({ schedulerProof, env });

  const blockers = [
    ...local.blockers,
    ...publicRuntime.blockers,
    ...processOwnership.blockers,
    ...schedulerProofInspection.blockers,
  ];
  const warnings = [
    ...local.warnings,
    ...publicRuntime.warnings,
    ...processOwnership.warnings,
    ...schedulerProofInspection.warnings,
  ];
  const advisory = [
    ...asArray(local.advisory),
    ...asArray(publicRuntime.advisory),
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
      guarded_live_dispatch_enabled: selectedRuntime.facts?.guarded_live_dispatch_enabled ?? null,
      emergency_kill_switch_clear: selectedRuntime.facts?.emergency_kill_switch_clear ?? null,
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
    scheduler_proof: schedulerProofInspection.facts,
    blockers,
    warnings,
    advisory,
    scheduler_window_readiness: {
      verdict,
      safe_to_observe_next_window: verdict !== "red",
      hold_scheduler_or_dispatch: verdict === "red",
      dispatch_mode: selectedRuntime.facts?.dispatch_mode || null,
      scheduler_active: selectedRuntime.facts?.schedulerActive ?? null,
      enabled_platform_scope: ["youtube_shorts", "instagram_reels", "facebook_reels"],
      deferred_platform_scope: ["tiktok", "x", "threads", "pinterest"],
      next_action:
        schedulerProofInspection.blockers.length
          ? "refresh_guarded_dispatch_handoff_before_window"
          : 
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
      schedulerProofInspection.blockers.length
        ? "refresh_guarded_dispatch_handoff_before_window"
        :
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
  schedulerProof = {},
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
    env,
  });
  return buildRuntimeOwnershipSentinel({
    cwd,
    env,
    now,
    localHealth,
    publicHealth,
    processSnapshot,
    schedulerProof,
    execFileSyncImpl,
  });
}

function queryRuntimeProcessSnapshot({
  port = 3001,
  execFileSyncImpl = execFileSync,
  env = process.env,
} = {}) {
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
    const timeoutMs = Math.max(
      7_000,
      numberOrNull(env.PULSE_RUNTIME_PROCESS_QUERY_TIMEOUT_MS) || 25_000,
    );
    const raw = execFileSyncImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        encoding: "utf8",
        timeout: timeoutMs,
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
  lines.push(`- Guarded live dispatch: ${String(report.summary?.guarded_live_dispatch_enabled ?? "unknown")}`);
  lines.push(`- Kill switch clear: ${String(report.summary?.emergency_kill_switch_clear ?? "unknown")}`);
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
  if (report.advisory?.length) {
    lines.push("");
    lines.push("## Advisory");
    for (const item of report.advisory) lines.push(`- ${item}`);
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
  inspectSchedulerProof,
  inspectHealth,
  inspectProcessOwnership,
  classifyCommitDrift,
  isRuntimeRelevantCommitPath,
  normaliseProcessSnapshot,
  queryRuntimeProcessSnapshot,
};
