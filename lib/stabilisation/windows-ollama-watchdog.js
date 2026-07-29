"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const REQUIRED_MODEL = "qwen3.5:27b";
const MAX_PROBE_BODY_BYTES = 256 * 1024;
const WATCHDOG_LOCK_STALE_MS = 10 * 60 * 1000;
const WATCHDOG_TASK_NAME = "PulseGaming-Ollama-Watchdog";
const WATCHDOG_TASK_INSTALL_CONFIRMATION =
  "INSTALL_PULSE_OLLAMA_WATCHDOG";
const WINDOWS_TASK_ACTION_LIMIT = 262;
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "OLLAMA_MODELS",
]);

function writeJsonAtomic(filePath, value, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsImpl.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  fsImpl.renameSync(temporaryPath, filePath);
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function recoverStaleWatchdogLock({
  lockPath,
  stateDirectory,
  generatedAt,
  processAlive,
  fsImpl,
} = {}) {
  let observedBytes;
  let observed;
  try {
    observedBytes = fsImpl.readFileSync(lockPath, "utf8");
    if (Buffer.byteLength(observedBytes, "utf8") > 4096) return false;
    observed = JSON.parse(observedBytes);
  } catch {
    return false;
  }
  const generatedMs = new Date(generatedAt).getTime();
  const acquiredMs = new Date(observed?.acquired_at).getTime();
  const priorPid = Number(observed?.pid);
  if (
    observed?.schema_version !==
      "pulse-windows-ollama-watchdog-lock-v1" ||
    !Number.isInteger(priorPid) ||
    priorPid <= 0 ||
    !Number.isFinite(generatedMs) ||
    !Number.isFinite(acquiredMs) ||
    generatedMs - acquiredMs < WATCHDOG_LOCK_STALE_MS ||
    processAlive(priorPid)
  ) {
    return false;
  }

  // Revalidate immediately before an atomic rename. The renamed file is then
  // re-read before it is accepted as stale, so a changed/replaced lock is
  // restored and never treated as recovery authority.
  let currentBytes;
  try {
    currentBytes = fsImpl.readFileSync(lockPath, "utf8");
  } catch {
    return false;
  }
  if (currentBytes !== observedBytes) return false;

  const staleDirectory = path.join(stateDirectory, "stale-locks");
  fsImpl.mkdirSync(staleDirectory, { recursive: true });
  const temporaryPath = path.join(
    staleDirectory,
    `.recovering-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  try {
    fsImpl.renameSync(lockPath, temporaryPath);
    const movedBytes = fsImpl.readFileSync(temporaryPath, "utf8");
    if (movedBytes !== observedBytes) {
      if (!fsImpl.existsSync(lockPath)) {
        fsImpl.renameSync(temporaryPath, lockPath);
      }
      return false;
    }
    const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
    writeJsonAtomic(
      path.join(
        staleDirectory,
        `${safeTimestamp}-${priorPid}.json`,
      ),
      {
        schema_version:
          "pulse-windows-ollama-watchdog-stale-lock-v1",
        recovered_at: generatedAt,
        prior_pid: priorPid,
        prior_acquired_at: observed.acquired_at,
        reason: "owner_not_running_after_stale_threshold",
      },
      { fsImpl },
    );
    fsImpl.unlinkSync(temporaryPath);
    return true;
  } catch {
    try {
      if (
        fsImpl.existsSync(temporaryPath) &&
        !fsImpl.existsSync(lockPath)
      ) {
        fsImpl.renameSync(temporaryPath, lockPath);
      }
    } catch {
      // Fail closed: the next invocation will inspect whichever lock remains.
    }
    return false;
  }
}

function tryAcquireWatchdogLock({
  stateDirectory,
  generatedAt,
  processAlive = defaultProcessAlive,
  fsImpl = fs,
  allowStaleRecovery = true,
} = {}) {
  fsImpl.mkdirSync(stateDirectory, { recursive: true });
  const lockPath = path.join(stateDirectory, "watchdog.lock");
  const nonce = crypto.randomUUID();
  let descriptor;
  try {
    descriptor = fsImpl.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      if (
        allowStaleRecovery &&
        recoverStaleWatchdogLock({
          lockPath,
          stateDirectory,
          generatedAt,
          processAlive,
          fsImpl,
        })
      ) {
        return tryAcquireWatchdogLock({
          stateDirectory,
          generatedAt,
          processAlive,
          fsImpl,
          allowStaleRecovery: false,
        });
      }
      return {
        acquired: false,
        release() {},
      };
    }
    throw error;
  }
  try {
    fsImpl.writeFileSync(
      descriptor,
      `${JSON.stringify({
        schema_version: "pulse-windows-ollama-watchdog-lock-v1",
        pid: process.pid,
        acquired_at: generatedAt,
        nonce,
      })}\n`,
      "utf8",
    );
  } finally {
    fsImpl.closeSync(descriptor);
  }
  return {
    acquired: true,
    release() {
      try {
        const current = JSON.parse(fsImpl.readFileSync(lockPath, "utf8"));
        if (current?.nonce === nonce && Number(current?.pid) === process.pid) {
          fsImpl.unlinkSync(lockPath);
        }
      } catch {
        // Never remove a lock whose exact ownership cannot be revalidated.
      }
    },
  };
}

function validateProfile(profile) {
  if (!profile?.state_root) throw new Error("runtime_state_root_required");
  if (profile?.environment?.PULSE_OLLAMA_BASE_URL !== OLLAMA_BASE_URL) {
    throw new Error("ollama_base_url_must_be_exact_loopback");
  }
  if (profile?.environment?.PULSE_OLLAMA_MODEL !== REQUIRED_MODEL) {
    throw new Error("ollama_required_model_mismatch");
  }
}

function buildOllamaEnvironment(systemEnvironment = process.env) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (
      systemEnvironment?.[key] !== undefined &&
      systemEnvironment?.[key] !== null
    ) {
      environment[key] = String(systemEnvironment[key]);
    }
  }
  environment.OLLAMA_HOST = `${OLLAMA_HOST}:${OLLAMA_PORT}`;
  return environment;
}

function summariseListeners(inspection) {
  const listeners = Array.isArray(inspection?.listeners)
    ? inspection.listeners
    : [];
  return {
    inspection_available: inspection?.available === true,
    count: listeners.length,
    exact_loopback_only:
      inspection?.available === true &&
      listeners.length > 0 &&
      listeners.every(
        (entry) =>
          entry.local_address === OLLAMA_HOST &&
          Number(entry.local_port) === OLLAMA_PORT,
      ),
  };
}

function requestOllamaTags({
  requestImpl = http.request,
  timeoutMs = 1500,
} = {}) {
  const boundedTimeoutMs = Math.max(
    250,
    Math.min(5000, Number(timeoutMs) || 1500),
  );
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({
        reachable: value.reachable === true,
        status_code: Number.isInteger(value.status_code)
          ? value.status_code
          : null,
        valid_json: value.valid_json === true,
        model_present: value.model_present === true,
        failure_code: value.failure_code || null,
      });
    };
    const request = requestImpl(
      {
        protocol: "http:",
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        method: "GET",
        path: "/api/tags",
        agent: false,
        headers: {
          Accept: "application/json",
          Connection: "close",
        },
      },
      (response) => {
        const statusCode = Number(response.statusCode) || null;
        let body = "";
        let bodyBytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (settled) return;
          bodyBytes += Buffer.byteLength(chunk, "utf8");
          if (bodyBytes > MAX_PROBE_BODY_BYTES) {
            finish({
              reachable: true,
              status_code: statusCode,
              valid_json: false,
              model_present: false,
              failure_code: "response_too_large",
            });
            request.destroy();
            return;
          }
          body += chunk;
        });
        response.on("end", () => {
          if (settled) return;
          if (statusCode !== 200) {
            finish({
              reachable: true,
              status_code: statusCode,
              valid_json: false,
              model_present: false,
              failure_code: "http_status_unexpected",
            });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            finish({
              reachable: true,
              status_code: statusCode,
              valid_json: false,
              model_present: false,
              failure_code: "invalid_json",
            });
            return;
          }
          if (!Array.isArray(parsed?.models)) {
            finish({
              reachable: true,
              status_code: statusCode,
              valid_json: true,
              model_present: false,
              failure_code: "invalid_tags_shape",
            });
            return;
          }
          const modelPresent = parsed.models.some(
            (entry) =>
              entry?.name === REQUIRED_MODEL ||
              entry?.model === REQUIRED_MODEL,
          );
          finish({
            reachable: true,
            status_code: statusCode,
            valid_json: true,
            model_present: modelPresent,
            failure_code: modelPresent
              ? null
              : "required_model_missing",
          });
        });
        response.on("error", () => {
          finish({
            reachable: true,
            status_code: statusCode,
            valid_json: false,
            model_present: false,
            failure_code: "response_failed",
          });
        });
      },
    );
    request.setTimeout(boundedTimeoutMs, () => {
      finish({
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "request_timeout",
      });
      request.destroy();
    });
    request.on("error", () => {
      finish({
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "connection_failed",
      });
    });
    request.end();
  });
}

function inspectOllamaListeners({
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (platform !== "win32") {
    return { available: false, listeners: [] };
  }
  const command =
    "$items = @(Get-NetTCPConnection -State Listen -LocalPort 11434 " +
    "-ErrorAction SilentlyContinue | " +
    "Select-Object LocalAddress,LocalPort,OwningProcess); " +
    "@($items) | ConvertTo-Json -Compress";
  try {
    const raw = execFileSyncImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsed = JSON.parse(String(raw || "[]"));
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const listeners = rows.map((entry) => ({
      local_address: String(entry?.LocalAddress || ""),
      local_port: Number(entry?.LocalPort),
      owning_process: Number(entry?.OwningProcess),
    }));
    if (
      listeners.some(
        (entry) =>
          !entry.local_address ||
          entry.local_port !== OLLAMA_PORT ||
          !Number.isInteger(entry.owning_process) ||
          entry.owning_process <= 0,
      )
    ) {
      return { available: false, listeners: [] };
    }
    return { available: true, listeners };
  } catch {
    return { available: false, listeners: [] };
  }
}

function resolveInstalledOllamaExecutable({
  platform = process.platform,
  systemEnvironment = process.env,
  fsImpl = fs,
  realpathImpl = fs.realpathSync.native,
} = {}) {
  if (platform !== "win32") throw new Error("windows_host_required");
  const localAppData = String(
    systemEnvironment?.LOCALAPPDATA || "",
  ).trim();
  if (
    !/^[a-z]:\\[^<>:"|?*\r\n]+$/i.test(localAppData) ||
    !path.win32.isAbsolute(localAppData)
  ) {
    throw new Error("local_app_data_path_invalid");
  }
  const expected = path.win32.resolve(
    localAppData,
    "Programs",
    "Ollama",
    "ollama.exe",
  );
  if (
    !fsImpl.existsSync(expected) ||
    !fsImpl.statSync(expected).isFile()
  ) {
    throw new Error("ollama_executable_missing");
  }
  const canonical = path.win32.normalize(String(realpathImpl(expected)));
  if (canonical.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("ollama_executable_not_canonical");
  }
  return expected;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function quoteWindowsArgument(value) {
  const text = String(value || "");
  if (!text || /[\r\n\0]/.test(text)) {
    throw new Error("unsafe_windows_argument");
  }
  return `"${text
    .replace(/(\\*)"/g, "$1$1\\\"")
    .replace(/(\\+)$/g, "$1$1")}"`;
}

function resolveWatchdogTaskBindings({
  repoRoot,
  nodeExecutable = process.execPath,
  platform = process.platform,
  fsImpl = fs,
  realpathImpl = fs.realpathSync.native,
} = {}) {
  if (platform !== "win32") throw new Error("windows_host_required");
  const rawRoot = String(repoRoot || "").trim();
  const rawNode = String(nodeExecutable || "").trim();
  if (
    !path.win32.isAbsolute(rawRoot) ||
    !path.win32.isAbsolute(rawNode) ||
    /[\r\n\0]/.test(rawRoot) ||
    /[\r\n\0]/.test(rawNode)
  ) {
    throw new Error("absolute_windows_paths_required");
  }
  const resolvedRoot = path.win32.normalize(rawRoot);
  const resolvedNode = path.win32.normalize(rawNode);
  if (
    path.win32.basename(resolvedNode).toLowerCase() !== "node.exe" ||
    !fsImpl.existsSync(resolvedNode) ||
    !fsImpl.statSync(resolvedNode).isFile()
  ) {
    throw new Error("canonical_node_executable_required");
  }
  if (
    !fsImpl.existsSync(resolvedRoot) ||
    !fsImpl.statSync(resolvedRoot).isDirectory()
  ) {
    throw new Error("canonical_repo_root_required");
  }
  const canonicalNode = path.win32.normalize(
    String(realpathImpl(resolvedNode)),
  );
  const canonicalRoot = path.win32.normalize(
    String(realpathImpl(resolvedRoot)),
  );
  if (canonicalNode.toLowerCase() !== resolvedNode.toLowerCase()) {
    throw new Error("node_executable_not_canonical");
  }
  if (canonicalRoot.toLowerCase() !== resolvedRoot.toLowerCase()) {
    throw new Error("repo_root_not_canonical");
  }
  const toolPath = path.win32.join(
    resolvedRoot,
    "tools",
    "windows-ollama-watchdog.js",
  );
  if (
    !fsImpl.existsSync(toolPath) ||
    !fsImpl.statSync(toolPath).isFile()
  ) {
    throw new Error("watchdog_tool_missing");
  }
  const canonicalTool = path.win32.normalize(
    String(realpathImpl(toolPath)),
  );
  if (canonicalTool.toLowerCase() !== toolPath.toLowerCase()) {
    throw new Error("watchdog_tool_not_canonical");
  }
  return {
    repo_root: resolvedRoot,
    node_executable: resolvedNode,
    tool_path: toolPath,
    arguments: [
      quoteWindowsArgument(toolPath),
      "ensure",
      "--profile",
      "governed_multi_lane",
    ].join(" "),
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function localTaskBoundary(value = new Date().toISOString()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("scheduled_task_boundary_invalid");
  }
  const pad = (part) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function validateWatchdogTaskBindingsShape(bindings) {
  const repoRoot = path.win32.normalize(
    String(bindings?.repo_root || ""),
  );
  const nodeExecutable = path.win32.normalize(
    String(bindings?.node_executable || ""),
  );
  const toolPath = path.win32.normalize(
    String(bindings?.tool_path || ""),
  );
  if (
    !path.win32.isAbsolute(repoRoot) ||
    !path.win32.isAbsolute(nodeExecutable) ||
    !path.win32.isAbsolute(toolPath) ||
    /[\r\n\0]/.test(`${repoRoot}${nodeExecutable}${toolPath}`)
  ) {
    throw new Error("watchdog_task_bindings_invalid");
  }
  if (path.win32.basename(nodeExecutable).toLowerCase() !== "node.exe") {
    throw new Error("canonical_node_executable_required");
  }
  const expectedToolPath = path.win32.join(
    repoRoot,
    "tools",
    "windows-ollama-watchdog.js",
  );
  if (toolPath.toLowerCase() !== expectedToolPath.toLowerCase()) {
    throw new Error("watchdog_tool_repo_binding_invalid");
  }
  const expectedArguments = [
    quoteWindowsArgument(toolPath),
    "ensure",
    "--profile",
    "governed_multi_lane",
  ].join(" ");
  if (String(bindings?.arguments || "") !== expectedArguments) {
    throw new Error("watchdog_task_arguments_invalid");
  }
  const actionLength =
    quoteWindowsArgument(nodeExecutable).length +
    1 +
    expectedArguments.length;
  if (actionLength > WINDOWS_TASK_ACTION_LIMIT) {
    throw new Error(
      `scheduled_task_action_too_long:${actionLength}>${WINDOWS_TASK_ACTION_LIMIT}`,
    );
  }
  return {
    repo_root: repoRoot,
    node_executable: nodeExecutable,
    tool_path: toolPath,
    arguments: expectedArguments,
    action_length: actionLength,
  };
}

function buildWatchdogScheduledTaskXml({
  bindings,
  currentUserSid,
  generatedAt = new Date().toISOString(),
} = {}) {
  const sid = String(currentUserSid || "").trim();
  if (
    !/^S-1-5-(?:\d+-)+\d+$/i.test(sid) ||
    /^S-1-5-18$/i.test(sid)
  ) {
    throw new Error("interactive_user_sid_required");
  }
  const resolved = validateWatchdogTaskBindingsShape(bindings);
  const boundary = localTaskBoundary(generatedAt);
  return (
    '<?xml version="1.0" encoding="UTF-16"?>\r\n' +
    '<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n' +
    "  <RegistrationInfo><Description>Pulse Gaming local Ollama availability watchdog</Description></RegistrationInfo>\r\n" +
    "  <Triggers>\r\n" +
    `    <LogonTrigger><Enabled>true</Enabled><UserId>${escapeXml(sid)}</UserId></LogonTrigger>\r\n` +
    `    <TimeTrigger><Enabled>true</Enabled><StartBoundary>${escapeXml(boundary)}</StartBoundary><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>\r\n` +
    "  </Triggers>\r\n" +
    `  <Principals><Principal id="PulseOllamaWatchdog"><UserId>${escapeXml(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n` +
    "  <Settings>\r\n" +
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n" +
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n" +
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n" +
    "    <StartWhenAvailable>true</StartWhenAvailable>\r\n" +
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\r\n" +
    "    <AllowHardTerminate>true</AllowHardTerminate>\r\n" +
    "    <Enabled>true</Enabled>\r\n" +
    "    <Hidden>true</Hidden>\r\n" +
    "    <WakeToRun>false</WakeToRun>\r\n" +
    "    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>\r\n" +
    "    <Priority>7</Priority>\r\n" +
    "  </Settings>\r\n" +
    `  <Actions Context="PulseOllamaWatchdog"><Exec><Command>${escapeXml(resolved.node_executable)}</Command><Arguments>${escapeXml(resolved.arguments)}</Arguments><WorkingDirectory>${escapeXml(resolved.repo_root)}</WorkingDirectory></Exec></Actions>\r\n` +
    "</Task>\r\n"
  );
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function validateWatchdogScheduledTaskXml({
  xml,
  bindings,
  currentUserSid,
  currentUserAccountName = null,
} = {}) {
  const resolved = validateWatchdogTaskBindingsShape(bindings);
  const decoded = decodeXml(xml);
  const blockers = [];
  const requireMatch = (condition, blocker) => {
    if (!condition) blockers.push(blocker);
  };
  const tagCount = (tag) =>
    (decoded.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
  const valueOf = (tag, within = decoded) =>
    within.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"))?.[1]?.trim() ||
    "";
  const valueOfOrDefault = (tag, within, defaultValue) =>
    new RegExp(`<${tag}\\b`, "i").test(within)
      ? valueOf(tag, within)
      : defaultValue;
  const logonTrigger =
    decoded.match(/<LogonTrigger\b[\s\S]*?<\/LogonTrigger>/i)?.[0] || "";
  const timeTrigger =
    decoded.match(/<TimeTrigger\b[\s\S]*?<\/TimeTrigger>/i)?.[0] || "";
  const principal =
    decoded.match(/<Principal\b[\s\S]*?<\/Principal>/i)?.[0] || "";
  const settings =
    decoded.match(/<Settings\b[\s\S]*?<\/Settings>/i)?.[0] || "";
  const exec =
    decoded.match(/<Exec\b[\s\S]*?<\/Exec>/i)?.[0] || "";
  const allowedUsers = new Set(
    [currentUserSid, currentUserAccountName]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const sid = String(currentUserSid || "").trim();
  requireMatch(
    /^S-1-5-(?:\d+-)+\d+$/i.test(sid) && !/^S-1-5-18$/i.test(sid),
    "current_user_sid_invalid",
  );
  requireMatch(
    !/<!DOCTYPE|<!ENTITY/i.test(decoded),
    "task_xml_external_entity_forbidden",
  );
  requireMatch(tagCount("LogonTrigger") === 1, "logon_trigger_invalid");
  requireMatch(tagCount("TimeTrigger") === 1, "time_trigger_invalid");
  requireMatch(
    valueOfOrDefault("Enabled", logonTrigger, "true").toLowerCase() ===
      "true",
    "logon_trigger_disabled",
  );
  requireMatch(
    valueOfOrDefault("Enabled", timeTrigger, "true").toLowerCase() ===
        "true" &&
      /<Interval>PT1M<\/Interval>/i.test(timeTrigger),
    "one_minute_trigger_invalid",
  );
  requireMatch(
    allowedUsers.has(valueOf("UserId", logonTrigger).toLowerCase()),
    "logon_trigger_user_invalid",
  );
  requireMatch(tagCount("Principal") === 1, "task_principal_count_invalid");
  requireMatch(
    allowedUsers.has(valueOf("UserId", principal).toLowerCase()),
    "task_principal_user_invalid",
  );
  requireMatch(
    valueOf("LogonType", principal).toLowerCase() === "interactivetoken",
    "task_logon_type_invalid",
  );
  requireMatch(
    valueOfOrDefault("RunLevel", principal, "LeastPrivilege").toLowerCase() ===
      "leastprivilege",
    "task_run_level_invalid",
  );
  requireMatch(
    valueOf("MultipleInstancesPolicy", settings).toLowerCase() ===
      "ignorenew",
    "task_overlap_policy_invalid",
  );
  requireMatch(
    valueOf("StartWhenAvailable", settings).toLowerCase() === "true",
    "task_catchup_policy_invalid",
  );
  requireMatch(
    valueOf("Hidden", settings).toLowerCase() === "true",
    "task_hidden_policy_invalid",
  );
  requireMatch(
    valueOf("ExecutionTimeLimit", settings).toUpperCase() === "PT1M",
    "task_execution_limit_invalid",
  );
  const enabledValue = valueOfOrDefault(
    "Enabled",
    settings,
    "true",
  ).toLowerCase();
  const enabled = enabledValue === "true";
  requireMatch(
    ["true", "false"].includes(enabledValue),
    "task_enabled_state_invalid",
  );
  requireMatch(tagCount("Actions") === 1, "task_actions_count_invalid");
  requireMatch(tagCount("Exec") === 1, "task_exec_count_invalid");
  requireMatch(
    tagCount("ComHandler") === 0 &&
      tagCount("ShowMessage") === 0 &&
      tagCount("SendEmail") === 0,
    "task_non_exec_action_forbidden",
  );
  requireMatch(
    path.win32.normalize(valueOf("Command", exec)).toLowerCase() ===
      resolved.node_executable.toLowerCase(),
    "task_node_identity_invalid",
  );
  requireMatch(
    valueOf("Arguments", exec) === resolved.arguments,
    "task_arguments_identity_invalid",
  );
  requireMatch(
    path.win32.normalize(valueOf("WorkingDirectory", exec)).toLowerCase() ===
      resolved.repo_root.toLowerCase(),
    "task_working_directory_invalid",
  );
  return {
    valid: blockers.length === 0,
    enabled,
    blockers: [...new Set(blockers)],
  };
}

function watchdogTaskActionSha256(bindings) {
  const resolved = validateWatchdogTaskBindingsShape(bindings);
  return crypto
    .createHash("sha256")
    .update(resolved.node_executable)
    .update("\0")
    .update(resolved.arguments)
    .update("\0")
    .update(resolved.repo_root)
    .digest("hex");
}

function inspectWatchdogScheduledTask({
  bindings,
  currentUserSid,
  currentUserAccountName = null,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  const actionSha256 = watchdogTaskActionSha256(bindings);
  if (platform !== "win32") {
    return {
      state: "unavailable",
      task_name: WATCHDOG_TASK_NAME,
      enabled: null,
      action_sha256: actionSha256,
      blockers: ["windows_task_inspection_unavailable"],
    };
  }
  let xml;
  try {
    xml = String(
      execFileSyncImpl(
        "schtasks.exe",
        ["/Query", "/TN", WATCHDOG_TASK_NAME, "/XML"],
        {
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ) || "",
    );
  } catch (error) {
    const absent = Number(error?.status) === 1;
    return {
      state: absent ? "absent" : "unavailable",
      task_name: WATCHDOG_TASK_NAME,
      enabled: null,
      action_sha256: actionSha256,
      blockers: absent ? [] : ["windows_task_query_failed"],
    };
  }
  const validation = validateWatchdogScheduledTaskXml({
    xml,
    bindings,
    currentUserSid,
    currentUserAccountName,
  });
  return {
    state: validation.valid
      ? validation.enabled
        ? "managed_current"
        : "managed_disabled"
      : "foreign",
    task_name: WATCHDOG_TASK_NAME,
    enabled: validation.enabled,
    action_sha256: actionSha256,
    blockers: validation.valid
      ? []
      : ["scheduled_task_identity_mismatch", ...validation.blockers],
  };
}

function plannedWatchdogTaskEffect(state) {
  return (
    {
      absent: "create_exact_managed_task",
      managed_current: "no_op_already_current",
      managed_disabled: "blocked_managed_task_disabled",
      foreign: "blocked_foreign_task",
      unavailable: "blocked_inspection_unavailable",
    }[state] || "blocked_unverified_task_state"
  );
}

function installWatchdogScheduledTask({
  repoRoot,
  nodeExecutable = process.execPath,
  stateRoot,
  apply = false,
  confirmation = null,
  generatedAt = new Date().toISOString(),
  platform = process.platform,
  currentUserSid,
  currentUserAccountName = null,
  bindingResolver = resolveWatchdogTaskBindings,
  inspectionImpl = inspectWatchdogScheduledTask,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
} = {}) {
  const generatedDate = new Date(generatedAt);
  if (Number.isNaN(generatedDate.getTime())) {
    throw new Error("generated_at_invalid");
  }
  const resolvedStateRoot = path.resolve(String(stateRoot || ""));
  if (!path.isAbsolute(resolvedStateRoot) || !String(stateRoot || "").trim()) {
    throw new Error("watchdog_task_state_root_required");
  }
  const bindings = bindingResolver({
    repoRoot,
    nodeExecutable,
    platform,
    fsImpl,
  });
  const actionSha256 = watchdogTaskActionSha256(bindings);
  const before = inspectionImpl({
    bindings,
    currentUserSid,
    currentUserAccountName,
    platform,
    execFileSyncImpl,
  });
  const applyRequested = apply === true;
  const exactConfirmation =
    confirmation === WATCHDOG_TASK_INSTALL_CONFIRMATION;
  const plannedEffect = plannedWatchdogTaskEffect(before?.state);
  const blockers = [...(before?.blockers || [])];
  if (applyRequested && !exactConfirmation) {
    blockers.push("explicit_apply_confirmation_required");
  }
  if (
    applyRequested &&
    !["absent", "managed_current"].includes(before?.state)
  ) {
    blockers.push(`task_state_not_installable:${before?.state || "unknown"}`);
  }
  const mutationAuthorised =
    applyRequested &&
    exactConfirmation &&
    blockers.length === 0 &&
    before?.state === "absent";
  let after = before;
  let installPerformed = false;
  if (mutationAuthorised) {
    const taskXml = buildWatchdogScheduledTaskXml({
      bindings,
      currentUserSid,
      generatedAt: generatedDate.toISOString(),
    });
    const selfValidation = validateWatchdogScheduledTaskXml({
      xml: taskXml,
      bindings,
      currentUserSid,
      currentUserAccountName,
    });
    if (!selfValidation.valid) {
      blockers.push("generated_task_contract_invalid");
    } else {
      const taskRoot = path.join(
        resolvedStateRoot,
        "ollama-watchdog",
      );
      fsImpl.mkdirSync(taskRoot, { recursive: true });
      const temporaryXmlPath = path.join(
        taskRoot,
        `.scheduled-task-${process.pid}-${crypto.randomUUID()}.xml`,
      );
      try {
        fsImpl.writeFileSync(
          temporaryXmlPath,
          Buffer.concat([
            Buffer.from([0xff, 0xfe]),
            Buffer.from(taskXml, "utf16le"),
          ]),
        );
        execFileSyncImpl(
          "schtasks.exe",
          [
            "/Create",
            "/TN",
            WATCHDOG_TASK_NAME,
            "/XML",
            temporaryXmlPath,
          ],
          {
            encoding: "utf8",
            timeout: 15_000,
            windowsHide: true,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        installPerformed = true;
      } catch {
        blockers.push("scheduled_task_create_failed");
      } finally {
        fsImpl.rmSync(temporaryXmlPath, { force: true });
      }
      if (installPerformed) {
        after = inspectionImpl({
          bindings,
          currentUserSid,
          currentUserAccountName,
          platform,
          execFileSyncImpl,
        });
        if (after?.state !== "managed_current") {
          blockers.push("scheduled_task_post_install_identity_failed");
        }
      }
    }
  }
  const safeTimestamp = generatedDate
    .toISOString()
    .replace(/[:.]/g, "-");
  const evidenceFile = `${safeTimestamp}-task-install-${crypto.randomUUID()}.json`;
  const report = {
    schema_version: "pulse-windows-ollama-watchdog-task-evidence-v1",
    generated_at: generatedDate.toISOString(),
    task_name: WATCHDOG_TASK_NAME,
    action: "task_install",
    dry_run: !applyRequested,
    apply_requested: applyRequested,
    mutation_authorised: mutationAuthorised,
    install_performed: installPerformed,
    state_before: before?.state || "unverified",
    state_after: after?.state || "unverified",
    planned_effect: plannedEffect,
    action_sha256: actionSha256,
    contract: {
      triggers: ["current_user_logon", "one_minute_repetition"],
      cadence: "PT1M",
      overlap_policy: "IgnoreNew",
      logon_type: "InteractiveToken",
      run_level: "LeastPrivilege",
      hidden: true,
      noninteractive_action: true,
      execution_time_limit: "PT1M",
      required_model: REQUIRED_MODEL,
      network_scope: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
    },
    authority: {
      scheduled_task_install: mutationAuthorised,
      oauth_mutation: false,
      external_publishing: false,
      database_mutation: false,
    },
    blockers: [...new Set(blockers)],
    evidence_boundary: [
      "This evidence covers only the local Ollama watchdog task.",
      "It grants no credential, publishing or database authority.",
      applyRequested
        ? "Task mutation requires the exact install confirmation and a verified absent task."
        : "Default dry-run mode performed no Scheduled Task mutation.",
    ],
    evidence_file: evidenceFile,
  };
  writeJsonAtomic(
    path.join(
      resolvedStateRoot,
      "ollama-watchdog",
      "task-evidence",
      evidenceFile,
    ),
    report,
    { fsImpl },
  );
  return report;
}

function buildWatchdogScheduledTaskPlan({
  repoRoot,
  nodeExecutable = process.execPath,
} = {}) {
  const resolvedRoot = path.win32.resolve(String(repoRoot || ""));
  const resolvedNode = path.win32.resolve(String(nodeExecutable || ""));
  if (
    !path.win32.isAbsolute(resolvedRoot) ||
    !path.win32.isAbsolute(resolvedNode)
  ) {
    throw new Error("absolute_windows_paths_required");
  }
  const toolPath = path.win32.join(
    resolvedRoot,
    "tools",
    "windows-ollama-watchdog.js",
  );
  const command = [
    quoteWindowsArgument(resolvedNode),
    quoteWindowsArgument(toolPath),
    "ensure",
    "--profile",
    "governed_multi_lane",
  ].join(" ");
  return {
    schema_version: "pulse-windows-ollama-watchdog-task-plan-v1",
    task_name: "PulseGaming-Ollama-Watchdog",
    cadence: "PT1M",
    multiple_instances: "IgnoreNew",
    start_when_available: true,
    logon_type: "InteractiveToken",
    run_level: "LeastPrivilege",
    command,
    network_scope: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
    required_model: REQUIRED_MODEL,
    install_performed: false,
    mutation_authorised: false,
  };
}

async function waitForOllamaReadiness({
  listenerInspector = inspectOllamaListeners,
  probeImpl = requestOllamaTags,
  maxAttempts = 6,
  intervalMs = 500,
  delayImpl = delay,
} = {}) {
  const boundedAttempts = Math.max(
    1,
    Math.min(10, Number(maxAttempts) || 6),
  );
  const boundedIntervalMs = Math.max(
    100,
    Math.min(1000, Number(intervalMs) || 500),
  );
  let probe = {
    reachable: false,
    status_code: null,
    valid_json: false,
    model_present: false,
    failure_code: "not_yet_probed",
  };
  let listener = {
    inspection_available: false,
    count: 0,
    exact_loopback_only: false,
  };
  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const inspection = listenerInspector();
    listener = summariseListeners(inspection);
    probe = await probeImpl();
    if (
      listener.exact_loopback_only &&
      probe.reachable === true &&
      probe.status_code === 200 &&
      probe.valid_json === true &&
      probe.model_present === true
    ) {
      return { ready: true, listener, probe, attempts: attempt };
    }
    if (attempt < boundedAttempts) {
      await delayImpl(boundedIntervalMs);
    }
  }
  return {
    ready: false,
    listener,
    probe,
    attempts: boundedAttempts,
  };
}

async function runOllamaWatchdog({
  mode = "ensure",
  profile,
  generatedAt = new Date().toISOString(),
  listenerInspector,
  probeImpl,
  spawnImpl,
  executableResolver,
  readinessWaiter,
  systemEnvironment = process.env,
  processAlive = defaultProcessAlive,
  fsImpl = fs,
} = {}) {
  if (!["ensure", "status"].includes(mode)) {
    throw new Error("ollama_watchdog_mode_invalid");
  }
  validateProfile(profile);
  const inspectListeners = listenerInspector || inspectOllamaListeners;
  const probeTags = probeImpl || requestOllamaTags;
  const resolveExecutable =
    executableResolver ||
    (() =>
      resolveInstalledOllamaExecutable({
        systemEnvironment,
        fsImpl,
      }));
  const spawnProcess = spawnImpl || spawn;
  const waitForReadiness =
    readinessWaiter ||
    (() =>
      waitForOllamaReadiness({
        listenerInspector: inspectListeners,
        probeImpl: probeTags,
      }));
  const stateDirectory = path.join(
    profile.state_root,
    "ollama-watchdog",
  );
  const statusPath = path.join(stateDirectory, "status.json");
  const lock = tryAcquireWatchdogLock({
    stateDirectory,
    generatedAt,
    processAlive,
    fsImpl,
  });
  if (!lock.acquired) {
    const report = {
      schema_version: "pulse-windows-ollama-watchdog-status-v1",
      generated_at: generatedAt,
      endpoint: OLLAMA_BASE_URL,
      required_model: REQUIRED_MODEL,
      mode,
      ready: false,
      outcome: "lock_busy",
      listener: {
        inspection_available: false,
        count: 0,
        exact_loopback_only: false,
      },
      probe: {
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "not_run_lock_busy",
      },
      action: {
        spawn_attempted: false,
        started_pid: null,
      },
    };
    const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
    writeJsonAtomic(
      path.join(
        stateDirectory,
        "contention",
        `${safeTimestamp}-${process.pid}.json`,
      ),
      report,
      { fsImpl },
    );
    return report;
  }
  let finalProbe = {
    reachable: false,
    status_code: null,
    valid_json: false,
    model_present: false,
    failure_code: "not_run",
  };
  let finalListener = {
    inspection_available: false,
    count: 0,
    exact_loopback_only: false,
  };
  let spawnAttempted = false;
  let startedPid = null;
  try {
    const inspection = inspectListeners();
    const listeners = Array.isArray(inspection?.listeners)
      ? inspection.listeners
      : [];
    const listener = summariseListeners(inspection);
    const probe = await probeTags();
    let ready =
      listener.exact_loopback_only &&
      probe?.reachable === true &&
      probe?.status_code === 200 &&
      probe?.valid_json === true &&
      probe?.model_present === true;
    let outcome = ready ? "healthy_no_action" : "unhealthy";
    finalProbe = probe;
    finalListener = listener;

    if (!ready && !listener.inspection_available) {
      outcome = "blocked_listener_inspection_unavailable";
    } else if (!ready && listeners.length > 0) {
      outcome = listener.exact_loopback_only
        ? "blocked_existing_listener"
        : "blocked_unsafe_listener_binding";
    } else if (
      !ready &&
      listener.inspection_available &&
      listeners.length === 0 &&
      mode === "status"
    ) {
      outcome = "status_unavailable";
    }

    if (
      mode === "ensure" &&
      !ready &&
      listener.inspection_available &&
      listeners.length === 0
    ) {
      const prestart = inspectListeners();
      const prestartListeners = Array.isArray(prestart?.listeners)
      ? prestart.listeners
      : [];
      if (prestart?.available === true && prestartListeners.length === 0) {
        const executable = resolveExecutable();
        spawnAttempted = true;
        const child = spawnProcess(executable, ["serve"], {
          detached: true,
          windowsHide: true,
          shell: false,
          stdio: "ignore",
          cwd: path.dirname(executable),
          env: buildOllamaEnvironment(systemEnvironment),
        });
        startedPid =
          Number.isInteger(Number(child?.pid)) && Number(child?.pid) > 0
            ? Number(child.pid)
            : null;
        if (!startedPid) throw new Error("ollama_process_start_failed");
        child?.once?.("error", () => {});
        child?.unref?.();
        const readiness = await waitForReadiness();
        ready = readiness?.ready === true;
        finalProbe = readiness?.probe || probe;
        finalListener = readiness?.listener || listener;
        outcome = ready ? "started_and_ready" : "start_pending";
      } else {
        outcome = "blocked_listener_appeared";
        finalListener = summariseListeners(prestart);
      }
    }
    const report = {
      schema_version: "pulse-windows-ollama-watchdog-status-v1",
      generated_at: generatedAt,
      endpoint: OLLAMA_BASE_URL,
      required_model: REQUIRED_MODEL,
      mode,
      ready,
      outcome,
      listener: finalListener,
      probe: finalProbe,
      action: {
        spawn_attempted: spawnAttempted,
        started_pid: startedPid,
      },
    };
    writeJsonAtomic(statusPath, report, { fsImpl });
    return report;
  } catch (error) {
    const safeFailureCodes = new Set([
      "windows_host_required",
      "local_app_data_path_invalid",
      "ollama_executable_missing",
      "ollama_executable_not_canonical",
      "ollama_process_start_failed",
    ]);
    const candidate = String(error?.message || "");
    const failureCode = safeFailureCodes.has(candidate)
      ? candidate
      : "watchdog_internal_error";
    const startPreflightCodes = new Set([
      "windows_host_required",
      "local_app_data_path_invalid",
      "ollama_executable_missing",
      "ollama_executable_not_canonical",
    ]);
    const report = {
      schema_version: "pulse-windows-ollama-watchdog-status-v1",
      generated_at: generatedAt,
      endpoint: OLLAMA_BASE_URL,
      required_model: REQUIRED_MODEL,
      mode,
      ready: false,
      outcome: startPreflightCodes.has(failureCode)
        ? "blocked_start_preflight"
        : "start_failed",
      listener: finalListener,
      probe: {
        ...finalProbe,
        failure_code: failureCode,
      },
      action: {
        spawn_attempted: spawnAttempted,
        started_pid: startedPid,
      },
    };
    writeJsonAtomic(statusPath, report, { fsImpl });
    return report;
  } finally {
    lock.release();
  }
}

module.exports = {
  OLLAMA_BASE_URL,
  OLLAMA_HOST,
  OLLAMA_PORT,
  REQUIRED_MODEL,
  WATCHDOG_TASK_INSTALL_CONFIRMATION,
  WATCHDOG_TASK_NAME,
  buildWatchdogScheduledTaskXml,
  buildWatchdogScheduledTaskPlan,
  buildOllamaEnvironment,
  inspectOllamaListeners,
  inspectWatchdogScheduledTask,
  installWatchdogScheduledTask,
  requestOllamaTags,
  resolveInstalledOllamaExecutable,
  resolveWatchdogTaskBindings,
  runOllamaWatchdog,
  validateWatchdogScheduledTaskXml,
  waitForOllamaReadiness,
};
