"use strict";

const crypto = require("node:crypto");
const {
  execFileSync,
  spawn,
} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { resolvePortablePath } = require("../portable-path");
const {
  normaliseWindowsPath,
  inspectCheckout,
  inspectDatabase,
  inspectWindowsListeners,
  profileFingerprint,
  quoteWindowsArgument,
  requestLocalHealth,
} = require("./windows-local-runtime-supervisor");
const { parseRuntimeConfig } = require("./runtime-config");

const DEFAULT_LIVE_GUARDED_PROFILE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "config",
  "windows-local-runtime.live-guarded-youtube.json",
);

const LIVE_PROFILE_SCHEMA =
  "pulse-windows-live-guarded-runtime-profile-v1";
const LIVE_PROFILE_ID =
  "pulse-v1-governed-multi-lane-live-guarded-youtube";
const LIVE_RUNTIME_OWNER_ID =
  "pulse-v1-windows-live-guarded-youtube-primary";
const LIVE_TASK_NAME = "PulseGaming-LiveGuarded-YouTube-Runtime";
const LIVE_ACTIVATION_SCHEMA =
  "pulse-windows-live-guarded-activation-receipt-v1";
const LIVE_ACTIVATION_DECISION =
  "LIVE_GUARDED_YOUTUBE_ACTIVATION_APPROVED";
const LIVE_LIFECYCLE_CONFIRMATION =
  "LIVE_GUARDED_YOUTUBE_SYSTEM_RUNTIME";
const LIVE_START_OPERATION_SCHEMA =
  "pulse-windows-live-guarded-start-operation-v1";
const LIVE_LIFECYCLE_ACTIONS = Object.freeze([
  "plan",
  "doctor",
  "issue-activation",
  "revoke-activation",
  "install",
  "enable",
  "start",
  "disable",
  "uninstall",
]);
const YOUTUBE_OAUTH_CLIENT_SHA256_ENV =
  "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const LIVE_REQUIRED_ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_MODE: "local",
  PORT: "3001",
  CHANNEL: "pulse-gaming",
  SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
  MEDIA_ROOT: "D:/pulse-data/media",
  USE_SQLITE: "true",
  USE_JOB_QUEUE: "true",
  PULSE_PRIMARY_INSTANCE: "true",
  PULSE_OPERATING_MODE: "LIVE_GUARDED",
  OPERATING_MODE: "LIVE_GUARDED",
  PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
  PULSE_MULTI_LANE_WORKERS: "true",
  PULSE_MULTI_LANE_STARTUP_PRIME: "true",
  BREAKING_WATCHER_ENABLED: "true",
  PULSE_STANDARD_RENDERER: "studio-v21",
  PULSE_EXPERIMENTAL_RENDERER: "disabled",
  PULSE_EDITORIAL_PROVIDER: "ollama",
  PULSE_OLLAMA_MODEL: "qwen3.5:27b",
  PULSE_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  PULSE_OLLAMA_EDITORIAL_TIMEOUT_MS: "600000",
  PULSE_PAID_EDITORIAL_FALLBACK_ENABLED: "false",
  PULSE_PAID_AI_ENABLED: "false",
  TTS_PROVIDER: "elevenlabs",
  PULSE_STATE_ROOT:
    "D:/pulse-data/runtime/pulse-live-guarded-youtube",
  ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
  ELEVENLABS_ALLOW_OVERAGE: "false",
  ELEVENLABS_CREDIT_MONITOR_ENABLED: "true",
  ELEVENLABS_CREDIT_MONITOR_INTERVAL_MS: "14400000",
  ELEVENLABS_CREDIT_MONITOR_DISCORD_ALERTS: "false",
  AUTO_PUBLISH: "true",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
  PULSE_EMERGENCY_KILL_SWITCH: "false",
  PULSE_KILL_SWITCH: "false",
  YOUTUBE_AUTO_PUBLISH: "true",
  TIKTOK_ENABLED: "false",
  TIKTOK_AUTO_PUBLISH: "false",
  TIKTOK_AUTH_CHECK_ENABLED: "false",
  TIKTOK_BROWSER_FALLBACK: "false",
  USE_BUFFER_TIKTOK: "false",
  INSTAGRAM_AUTO_PUBLISH: "false",
  INSTAGRAM_PENDING_VERIFIER_ENABLED: "false",
  FACEBOOK_AUTO_PUBLISH: "false",
  FACEBOOK_REELS_ENABLED: "false",
  TWITTER_ENABLED: "false",
  X_AUTO_PUBLISH: "false",
  THREADS_AUTO_PUBLISH: "false",
  PINTEREST_AUTO_PUBLISH: "false",
  PULSE_MISSED_WINDOW_RECOVERY: "false",
  PULSE_RESET_SCHEDULES_ON_BOOT: "false",
  PULSE_PUBLISH_CRITICAL_RUNNER: "false",
  PULSE_MAINTENANCE_RUNNER: "false",
  PULSE_LOCAL_STARTUP_NOTIFICATION: "false",
});

const SECRET_KEY_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSCODE|API_KEY|WEBHOOK|CREDENTIAL)/i;

function loadLiveGuardedRuntimeProfile({
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
} = {}) {
  return JSON.parse(fs.readFileSync(profilePath, "utf8"));
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      Buffer.isBuffer(value) ? value : String(value),
    )
    .digest("hex");
}

function buildMigrationManifest({ migrationsDir } = {}) {
  const resolved = path.resolve(String(migrationsDir || ""));
  if (
    !migrationsDir ||
    !fs.existsSync(resolved) ||
    !fs.statSync(resolved).isDirectory()
  ) {
    throw new Error("migration_set_required");
  }
  const files = fs
    .readdirSync(resolved)
    .filter((filename) => /^\d{3}_.+\.sql$/.test(filename))
    .sort()
    .map((filename) => ({
      version: filename.slice(0, 3),
      filename,
      sha256: sha256(fs.readFileSync(path.join(resolved, filename))),
    }));
  if (!files.length) throw new Error("migration_set_required");
  if (new Set(files.map((entry) => entry.version)).size !== files.length) {
    throw new Error("migration_versions_must_be_unique");
  }
  return {
    count: files.length,
    latest_version: files.at(-1).version,
    sha256: sha256(stableJson(files)),
  };
}

function receiptFingerprint(receipt) {
  const copy = { ...(receipt || {}) };
  delete copy.receipt_sha256;
  return sha256(stableJson(copy));
}

function requireYoutubeOAuthClientSha256(value) {
  const normalised = String(value || "").trim().toLowerCase();
  if (!normalised) {
    throw new Error("youtube_oauth_client_sha256_required");
  }
  if (!SHA256_PATTERN.test(normalised)) {
    throw new Error("youtube_oauth_client_sha256_invalid");
  }
  return normalised;
}

function buildLiveActivationReceipt({
  profile,
  expectedCommit,
  migrationsDir,
  operatorId,
  reason,
  youtubeOAuthClientSha256,
  generatedAt = new Date().toISOString(),
} = {}) {
  const profileValidation = validateLiveGuardedRuntimeProfile(profile);
  if (!profileValidation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${profileValidation.blockers.join(",")}`,
    );
  }
  const commit = String(expectedCommit || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected_commit_required");
  }
  const actor = String(operatorId || "").trim();
  if (!actor) throw new Error("activation_operator_id_required");
  const justification = String(reason || "").trim();
  if (!justification) throw new Error("activation_reason_required");
  const issuedAt = new Date(generatedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new Error("activation_generated_at_invalid");
  }
  const migrations = buildMigrationManifest({ migrationsDir });
  const expectedYoutubeOAuthClientSha256 =
    requireYoutubeOAuthClientSha256(youtubeOAuthClientSha256);
  const receipt = {
    schema_version: LIVE_ACTIVATION_SCHEMA,
    decision: LIVE_ACTIVATION_DECISION,
    issued_at: issuedAt.toISOString(),
    operator_id: actor,
    reason: justification,
    commit_sha: commit,
    profile_id: profile.profile_id,
    profile_sha256: profileFingerprint(profile),
    database_path: normaliseWindowsPath(profile.database_path),
    migration_manifest: migrations,
    scheduler_profile: "governed_multi_lane",
    operating_mode: "LIVE_GUARDED",
    platform: "youtube",
    auto_publish: true,
    guarded_live_dispatch: true,
    secondary_automation_frozen: true,
    youtube_account_binding: {
      env_key: YOUTUBE_OAUTH_CLIENT_SHA256_ENV,
      expected_oauth_client_sha256:
        expectedYoutubeOAuthClientSha256,
    },
    control: {
      kill_switch_healthy: true,
      emergency_kill_switch_tripped: false,
      primary_kill_switch_tripped: false,
      control_tower_required: true,
      fresh_green_required_per_release: true,
      control_tower_max_age_ms: 15 * 60 * 1000,
      durable_release_commitment: "youtube_remote_publishAt",
    },
    expiry: {
      expires_at: null,
      invalidated_by: [
        "receipt_revocation",
        "source_commit_drift",
        "profile_drift",
        "migration_manifest_drift",
        "kill_switch_trip",
      ],
    },
  };
  receipt.receipt_sha256 = receiptFingerprint(receipt);
  return receipt;
}

function inspectLiveActivationReceipt({
  profile,
  expectedCommit,
  migrationsDir,
  receiptPath = profile?.activation_receipt_path,
} = {}) {
  const blockers = [];
  const result = {
    valid: false,
    receipt_path: receiptPath
      ? normaliseWindowsPath(path.resolve(receiptPath))
      : null,
    receipt_sha256: null,
    issued_at: null,
    operator_id: null,
    youtube_oauth_client_sha256: null,
    blockers,
  };
  if (!receiptPath || !fs.existsSync(path.resolve(receiptPath))) {
    blockers.push("activation_receipt_missing");
    return result;
  }
  let receipt;
  try {
    receipt = JSON.parse(
      fs.readFileSync(path.resolve(receiptPath), "utf8"),
    );
  } catch {
    blockers.push("activation_receipt_invalid_json");
    return result;
  }
  let migrationManifest = null;
  try {
    migrationManifest = buildMigrationManifest({ migrationsDir });
  } catch (error) {
    blockers.push(String(error?.message || error));
  }
  const commit = String(expectedCommit || "").trim().toLowerCase();
  if (receipt?.schema_version !== LIVE_ACTIVATION_SCHEMA) {
    blockers.push("activation_receipt_schema_invalid");
  }
  if (receipt?.decision !== LIVE_ACTIVATION_DECISION) {
    blockers.push("activation_receipt_decision_invalid");
  }
  if (!String(receipt?.operator_id || "").trim()) {
    blockers.push("activation_receipt_operator_missing");
  }
  if (!String(receipt?.reason || "").trim()) {
    blockers.push("activation_receipt_reason_missing");
  }
  if (
    !/^[a-f0-9]{40,64}$/.test(commit) ||
    receipt?.commit_sha !== commit
  ) {
    blockers.push("activation_receipt_commit_mismatch");
  }
  if (
    receipt?.profile_id !== profile?.profile_id ||
    receipt?.profile_sha256 !== profileFingerprint(profile)
  ) {
    blockers.push("activation_receipt_profile_mismatch");
  }
  if (
    normaliseWindowsPath(receipt?.database_path).toLowerCase() !==
    normaliseWindowsPath(profile?.database_path).toLowerCase()
  ) {
    blockers.push("activation_receipt_database_mismatch");
  }
  if (
    !migrationManifest ||
    receipt?.migration_manifest?.count !== migrationManifest.count ||
    receipt?.migration_manifest?.latest_version !==
      migrationManifest.latest_version ||
    receipt?.migration_manifest?.sha256 !== migrationManifest.sha256
  ) {
    blockers.push("activation_receipt_migration_manifest_mismatch");
  }
  if (
    receipt?.scheduler_profile !== "governed_multi_lane" ||
    receipt?.operating_mode !== "LIVE_GUARDED" ||
    receipt?.platform !== "youtube" ||
    receipt?.auto_publish !== true ||
    receipt?.guarded_live_dispatch !== true ||
    receipt?.secondary_automation_frozen !== true
  ) {
    blockers.push("activation_receipt_runtime_contract_invalid");
  }
  const receiptYoutubeOAuthClientSha256 = String(
    receipt?.youtube_account_binding?.expected_oauth_client_sha256 ||
      "",
  )
    .trim()
    .toLowerCase();
  if (
    receipt?.youtube_account_binding?.env_key !==
      YOUTUBE_OAUTH_CLIENT_SHA256_ENV ||
    !SHA256_PATTERN.test(receiptYoutubeOAuthClientSha256)
  ) {
    blockers.push(
      "activation_receipt_youtube_oauth_client_binding_invalid",
    );
  }
  if (
    receipt?.control?.kill_switch_healthy !== true ||
    receipt?.control?.emergency_kill_switch_tripped !== false ||
    receipt?.control?.primary_kill_switch_tripped !== false ||
    receipt?.control?.control_tower_required !== true ||
    receipt?.control?.fresh_green_required_per_release !== true ||
    receipt?.control?.control_tower_max_age_ms !== 15 * 60 * 1000 ||
    receipt?.control?.durable_release_commitment !==
      "youtube_remote_publishAt"
  ) {
    blockers.push("activation_receipt_control_policy_invalid");
  }
  const actualFingerprint = receiptFingerprint(receipt);
  if (
    !/^[a-f0-9]{64}$/.test(String(receipt?.receipt_sha256 || "")) ||
    receipt.receipt_sha256 !== actualFingerprint
  ) {
    blockers.push("activation_receipt_fingerprint_mismatch");
  }
  result.valid = blockers.length === 0;
  result.receipt_sha256 =
    String(receipt?.receipt_sha256 || "").trim() || null;
  result.issued_at = String(receipt?.issued_at || "").trim() || null;
  result.operator_id =
    String(receipt?.operator_id || "").trim() || null;
  result.youtube_oauth_client_sha256 =
    SHA256_PATTERN.test(receiptYoutubeOAuthClientSha256)
      ? receiptYoutubeOAuthClientSha256
      : null;
  result.blockers = [...new Set(blockers)];
  return result;
}

function buildLiveChildEnvironment({
  profile,
  expectedCommit,
  activation,
  systemEnvironment = process.env,
} = {}) {
  if (activation?.valid !== true) {
    throw new Error("exact_live_activation_receipt_required");
  }
  const profileValidation = validateLiveGuardedRuntimeProfile(profile);
  if (!profileValidation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${profileValidation.blockers.join(",")}`,
    );
  }
  const commit = String(expectedCommit || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected_commit_required");
  }
  const allowedSystemKeys = [
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
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramW6432",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "TZ",
  ];
  const environment = {};
  for (const key of allowedSystemKeys) {
    if (
      systemEnvironment[key] !== undefined &&
      systemEnvironment[key] !== null
    ) {
      environment[key] = String(systemEnvironment[key]);
    }
  }
  Object.assign(environment, profile.environment, {
    RAILWAY_GIT_COMMIT_SHA: commit,
    RAILWAY_GIT_BRANCH: profile.expected_branch,
    PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256:
      activation.receipt_sha256,
    [YOUTUBE_OAUTH_CLIENT_SHA256_ENV]:
      requireYoutubeOAuthClientSha256(
        activation.youtube_oauth_client_sha256,
      ),
  });
  const parsed = parseRuntimeConfig(environment);
  if (
    !parsed.valid ||
    parsed.operating_contract.mode !== "LIVE_GUARDED" ||
    parsed.operating_contract.live_mutation_allowed !== true
  ) {
    throw new Error(
      `live_guarded_runtime_environment_invalid:${parsed.errors.join(",")}`,
    );
  }
  return environment;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildLiveScheduledTaskCommand({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
} = {}) {
  const commit = String(expectedCommit || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected_commit_required");
  }
  const validation = validateLiveGuardedRuntimeProfile(profile);
  if (!validation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${validation.blockers.join(",")}`,
    );
  }
  const resolvedRoot = resolvePortablePath(process.cwd(), repoRoot);
  const toolPath = resolvePortablePath(
    resolvedRoot,
    path.join("tools", "windows-live-guarded-runtime.js"),
  );
  return [
    quoteWindowsArgument(toolPath),
    "supervise",
    "--noninteractive",
    "--repo-root",
    quoteWindowsArgument(resolvedRoot),
    "--expected-commit",
    commit,
    "--activation-receipt",
    quoteWindowsArgument(profile.activation_receipt_path),
  ].join(" ");
}

function buildLiveScheduledTaskXml({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
  enabled = false,
} = {}) {
  const resolvedRoot = resolvePortablePath(process.cwd(), repoRoot);
  const argumentsText = buildLiveScheduledTaskCommand({
    profile,
    repoRoot: resolvedRoot,
    expectedCommit,
    nodeExecutable,
  });
  return (
    '<?xml version="1.0" encoding="UTF-16"?>\r\n' +
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n' +
    "  <RegistrationInfo><Description>Pulse Gaming reviewed live guarded YouTube runtime</Description></RegistrationInfo>\r\n" +
    "  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger></Triggers>\r\n" +
    "  <Principals><Principal id=\"PulseLiveGuarded\"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\r\n" +
    "  <Settings>\r\n" +
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n" +
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n" +
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n" +
    "    <StartWhenAvailable>true</StartWhenAvailable>\r\n" +
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\r\n" +
    "    <AllowHardTerminate>true</AllowHardTerminate>\r\n" +
    `    <Enabled>${enabled ? "true" : "false"}</Enabled>\r\n` +
    "    <Hidden>true</Hidden>\r\n" +
    "    <WakeToRun>true</WakeToRun>\r\n" +
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n" +
    "    <Priority>4</Priority>\r\n" +
    "    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>\r\n" +
    "  </Settings>\r\n" +
    `  <Actions Context="PulseLiveGuarded"><Exec><Command>${escapeXml(nodeExecutable)}</Command><Arguments>${escapeXml(argumentsText)}</Arguments><WorkingDirectory>${escapeXml(resolvedRoot)}</WorkingDirectory></Exec></Actions>\r\n` +
    "</Task>\r\n"
  );
}

function validateLiveScheduledTaskXml({
  xml,
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
  expectedEnabled,
} = {}) {
  const decoded = String(xml || "")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const canonical = decoded.replace(/\\/g, "/").toLowerCase();
  const blockers = [];
  const requireMatch = (condition, blocker) => {
    if (!condition) blockers.push(blocker);
  };
  const count = (tag) =>
    (decoded.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
  const settings =
    decoded.match(/<Settings\b[\s\S]*?<\/Settings>/i)?.[0] || "";
  const restartOnFailure =
    settings.match(
      /<RestartOnFailure\b[^>]*>[\s\S]*?<\/RestartOnFailure>/i,
    )?.[0] || "";
  const enabledMatch =
    settings.match(/<Enabled>(true|false)<\/Enabled>/i);
  const enabled = enabledMatch
    ? enabledMatch[1].toLowerCase() === "true"
    : true;
  const actionArguments =
    decoded.match(/<Arguments>([\s\S]*?)<\/Arguments>/i)?.[1] || "";
  const expectedCommand = buildLiveScheduledTaskCommand({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
  });
  const resolvedRoot = resolvePortablePath(process.cwd(), repoRoot);
  const toolPath = resolvePortablePath(
    resolvedRoot,
    path.join("tools", "windows-live-guarded-runtime.js"),
  );

  requireMatch(count("BootTrigger") === 1, "boot_trigger_invalid");
  requireMatch(count("LogonTrigger") === 0, "logon_trigger_forbidden");
  requireMatch(count("TimeTrigger") === 0, "time_trigger_forbidden");
  requireMatch(
    /<BootTrigger>[\s\S]*<Delay>PT30S<\/Delay>[\s\S]*<\/BootTrigger>/i.test(
      decoded,
    ),
    "boot_trigger_delay_invalid",
  );
  requireMatch(
    /<UserId>S-1-5-18<\/UserId>/i.test(decoded),
    "system_identity_required",
  );
  requireMatch(
    count("LogonType") === 0,
    "explicit_logon_type_forbidden_for_system_xml",
  );
  requireMatch(
    /<RunLevel>HighestAvailable<\/RunLevel>/i.test(decoded),
    "highest_run_level_required",
  );
  requireMatch(
    /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/i.test(
      settings,
    ),
    "task_overlap_policy_invalid",
  );
  requireMatch(
    /<StartWhenAvailable>true<\/StartWhenAvailable>/i.test(settings),
    "task_catchup_policy_invalid",
  );
  requireMatch(
    /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/i.test(settings),
    "task_execution_limit_invalid",
  );
  requireMatch(
    /<Interval>PT1M<\/Interval>/i.test(restartOnFailure) &&
      /<Count>999<\/Count>/i.test(restartOnFailure),
    "task_restart_policy_invalid",
  );
  if (typeof expectedEnabled === "boolean") {
    requireMatch(enabled === expectedEnabled, "task_enabled_state_invalid");
  }
  requireMatch(count("Exec") === 1, "task_action_count_invalid");
  requireMatch(
    canonical.includes(
      String(nodeExecutable).replace(/\\/g, "/").toLowerCase(),
    ),
    "task_node_identity_invalid",
  );
  requireMatch(
    canonical.includes(
      String(toolPath).replace(/\\/g, "/").toLowerCase(),
    ),
    "task_tool_identity_invalid",
  );
  requireMatch(
    actionArguments.trim() === expectedCommand,
    "task_supervision_command_invalid",
  );
  requireMatch(
    /\bsupervise\b/.test(decoded) &&
      /--noninteractive\b/.test(decoded),
    "task_noninteractive_supervisor_invalid",
  );
  requireMatch(
    !SECRET_KEY_PATTERN.test(decoded),
    "task_secret_material_forbidden",
  );
  return {
    valid: blockers.length === 0,
    enabled,
    blockers: [...new Set(blockers)],
  };
}

function inspectLiveWindowsTask({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (process.platform !== "win32") {
    return {
      state: "unavailable",
      task_name: profile?.task_name || LIVE_TASK_NAME,
      blockers: ["windows_task_inspection_unavailable"],
    };
  }
  let xml;
  try {
    xml = String(
      execFileSyncImpl(
        "schtasks.exe",
        ["/Query", "/TN", profile.task_name, "/XML"],
        {
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    return {
      state: "absent",
      task_name: profile.task_name,
      blockers: [],
    };
  }
  const validation = validateLiveScheduledTaskXml({
    xml,
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
  });
  return {
    state: validation.valid
      ? validation.enabled
        ? "managed_current"
        : "managed_disabled"
      : "foreign",
    task_name: profile.task_name,
    command_fingerprint: sha256(
      buildLiveScheduledTaskCommand({
        profile,
        repoRoot,
        expectedCommit,
        nodeExecutable,
      }),
    ),
    blockers: validation.valid
      ? []
      : [
          "scheduled_task_identity_mismatch",
          ...validation.blockers,
        ],
  };
}

function inspectLiveTaskConflicts({
  profile,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
} = {}) {
  const names = Array.isArray(profile?.conflicting_task_names)
    ? profile.conflicting_task_names
    : [];
  if (platform !== "win32") {
    return {
      clear: false,
      tasks: [],
      blockers: ["windows_task_conflict_inspection_unavailable"],
    };
  }
  const tasks = names.map((taskName) => {
    try {
      const xml = String(
        execFileSyncImpl(
          "schtasks.exe",
          ["/Query", "/TN", taskName, "/XML"],
          {
            encoding: "utf8",
            timeout: 5000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
      const settings =
        xml.match(/<Settings\b[\s\S]*?<\/Settings>/i)?.[0] || "";
      const enabledMatch =
        settings.match(/<Enabled>(true|false)<\/Enabled>/i);
      return {
        task_name: taskName,
        state:
          enabledMatch &&
          enabledMatch[1].toLowerCase() === "false"
            ? "disabled"
            : "enabled",
      };
    } catch {
      return {
        task_name: taskName,
        state: "inspection_error",
      };
    }
  });
  const active = tasks.filter((entry) => entry.state === "enabled");
  const inspectionErrors = tasks.filter(
    (entry) => entry.state === "inspection_error",
  );
  return {
    clear: active.length === 0 && inspectionErrors.length === 0,
    tasks,
    blockers: [
      ...(active.length ? ["conflicting_runtime_task_enabled"] : []),
      ...inspectionErrors.map(
        (entry) =>
          `conflicting_runtime_task_inspection_failed:${entry.task_name}`,
      ),
    ],
  };
}

function inspectStoppedLiveRuntime({
  profile,
  repoRoot = null,
  expectedCommit = null,
  activation = null,
  listenerInspector = inspectWindowsListeners,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  processAliveInspector = processAppearsAlive,
} = {}) {
  const ownerPath = path.join(
    profile.state_root,
    "supervisor-owner.json",
  );
  const listeners = listenerInspector({ port: profile.port });
  const listeningPids = Array.isArray(listeners?.listeningPids)
    ? listeners.listeningPids.map(Number).filter(Number.isInteger)
    : [];
  const ownerReceiptPresent = existsSync(ownerPath);
  const blockers = [];
  let ownerState = "absent";
  let ownerRecord = null;
  let ownerReceiptSha256 = null;
  if (listeners?.available !== true) {
    blockers.push("live_supervisor_port_inspection_unavailable");
  } else if (listeningPids.length !== 0) {
    blockers.push("live_supervisor_port_not_free");
  }
  if (ownerReceiptPresent) {
    let owner = null;
    try {
      const ownerBytes = String(readFileSync(ownerPath, "utf8"));
      ownerReceiptSha256 = sha256(ownerBytes);
      owner = JSON.parse(ownerBytes);
      ownerRecord = owner;
    } catch {
      ownerState = "invalid";
      blockers.push("live_supervisor_owner_receipt_invalid");
    }
    if (owner) {
      const exact =
        owner.schema_version ===
          "pulse-windows-live-guarded-owner-v1" &&
        Number(owner.port) === Number(profile.port) &&
        normaliseWindowsPath(owner.repo_root).toLowerCase() ===
          normaliseWindowsPath(path.resolve(repoRoot)).toLowerCase() &&
        String(owner.commit_sha || "").toLowerCase() ===
          String(expectedCommit || "").toLowerCase() &&
        owner.profile_sha256 === profileFingerprint(profile) &&
        owner.activation_receipt_sha256 ===
          activation?.receipt_sha256 &&
        owner.platform === "youtube";
      if (!exact) {
        ownerState = "mismatch";
        blockers.push("live_supervisor_owner_receipt_mismatch");
      } else {
        const ownerAlive =
          processAliveInspector(owner.supervisor_pid) ||
          processAliveInspector(owner.child_pid);
        if (ownerAlive) {
          ownerState = "active";
          blockers.push("live_supervisor_owner_process_alive");
        } else {
          ownerState = "exact_stale";
        }
      }
    }
  }
  return {
    stopped: blockers.length === 0,
    inspected: true,
    port: profile.port,
    listening_pids: listeningPids,
    owner_receipt_path: normaliseWindowsPath(ownerPath),
    owner_receipt_present: ownerReceiptPresent,
    owner_state: ownerState,
    owner_record: ownerRecord,
    owner_receipt_sha256: ownerReceiptSha256,
    blockers,
  };
}

function buildLiveLifecycleDecision({
  action = "plan",
  applyRequested = false,
  confirmation = null,
  profileValidation = {
    valid: false,
    blockers: ["profile_not_inspected"],
  },
  checkout = {
    ready: false,
    blockers: ["checkout_not_inspected"],
  },
  database = {
    ready: false,
    blockers: ["database_not_inspected"],
  },
  activation = {
    valid: false,
    blockers: ["activation_receipt_not_inspected"],
  },
  conflicts = { clear: true, blockers: [] },
  task = { state: "unknown", blockers: [] },
  runtime = {
    stopped: false,
    blockers: ["live_runtime_not_inspected"],
  },
  startOperationLock = {
    clear: false,
    blockers: ["live_start_operation_lock_not_inspected"],
  },
} = {}) {
  const selected = String(action || "").trim().toLowerCase();
  const blockers = [];
  if (!LIVE_LIFECYCLE_ACTIONS.includes(selected)) {
    blockers.push("live_lifecycle_action_invalid");
  }
  if (!profileValidation.valid) {
    blockers.push(
      ...(profileValidation.blockers || ["live_profile_invalid"]),
    );
  }
  if (
    [
      "plan",
      "doctor",
      "issue-activation",
      "install",
      "enable",
      "start",
    ].includes(selected)
  ) {
    if (!checkout.ready) {
      blockers.push(...(checkout.blockers || ["checkout_not_ready"]));
    }
    if (!database.ready) {
      blockers.push(...(database.blockers || ["database_not_ready"]));
    }
  }
  if (selected === "install") {
    if (!["absent", "managed_disabled"].includes(task.state)) {
      blockers.push(
        ...(task.blockers || []),
        "task_must_be_absent_or_managed_disabled",
      );
    }
  }
  if (["enable", "start"].includes(selected)) {
    if (activation.valid !== true) {
      blockers.push(
        ...(activation.blockers || [
          "exact_live_activation_receipt_required",
        ]),
      );
    }
    if (!["managed_disabled", "managed_current"].includes(task.state)) {
      blockers.push(...(task.blockers || []), "managed_task_required");
    }
    if (conflicts.clear !== true) {
      blockers.push(
        ...(conflicts.blockers || [
          "conflicting_runtime_task_enabled",
        ]),
      );
    }
  }
  if (selected === "start") {
    if (task.state !== "managed_current") {
      blockers.push(
        ...(task.blockers || []),
        "enabled_managed_task_required",
      );
    }
    if (runtime.stopped !== true) {
      blockers.push(
        ...(runtime.blockers || ["live_runtime_must_be_stopped"]),
      );
    }
    if (startOperationLock.clear !== true) {
      blockers.push(
        ...(startOperationLock.blockers || [
          "live_start_operation_lock_not_clear",
        ]),
      );
    }
  }
  if (selected === "disable" && task.state !== "managed_current") {
    blockers.push(...(task.blockers || []), "enabled_managed_task_required");
  }
  if (
    selected === "uninstall" &&
    task.state !== "managed_disabled"
  ) {
    blockers.push(
      ...(task.blockers || []),
      "disabled_managed_task_required",
    );
  }
  if (
    selected === "revoke-activation" &&
    !["absent", "managed_disabled"].includes(task.state)
  ) {
    blockers.push(
      ...(task.blockers || []),
      "task_absent_or_disabled_required",
    );
  }
  const mutating = [
    "issue-activation",
    "revoke-activation",
    "install",
    "enable",
    "start",
    "disable",
    "uninstall",
  ].includes(selected);
  if (
    mutating &&
    applyRequested &&
    confirmation !== LIVE_LIFECYCLE_CONFIRMATION
  ) {
    blockers.push("live_lifecycle_confirmation_required");
  }
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const ready = uniqueBlockers.length === 0;
  const noOp =
    (selected === "install" && task.state === "managed_disabled") ||
    (selected === "enable" && task.state === "managed_current");
  const plannedEffect = noOp
    ? "no_op_already_current"
    : selected === "install"
      ? "install_disabled"
      : selected === "enable"
        ? "enable_at_next_boot"
        : selected === "start"
          ? "start_verified_runtime"
          : selected;
  return {
    action: selected,
    ready,
    dry_run: mutating ? !applyRequested : true,
    mutation_authorised:
      mutating &&
      applyRequested &&
      confirmation === LIVE_LIFECYCLE_CONFIRMATION &&
      ready &&
      !noOp,
    planned_effect: plannedEffect,
    production_green: false,
    external_publish_possible: false,
    oauth_mutation_possible: false,
    blockers: uniqueBlockers,
  };
}

function buildLiveRuntimeDoctorReport({
  action = "doctor",
  applyRequested = false,
  confirmation = null,
  repoRoot = path.resolve(__dirname, "..", ".."),
  expectedCommit = null,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  activationReceiptPath = null,
  operatorId = null,
  reason = null,
  youtubeOAuthClientSha256 = null,
  generatedAt = new Date().toISOString(),
  dependencies = {},
} = {}) {
  const profile = loadLiveGuardedRuntimeProfile({ profilePath });
  const baseProfileValidation =
    validateLiveGuardedRuntimeProfile(profile);
  const optionBlockers = [];
  if (
    applyRequested &&
    path.resolve(profilePath) !==
      path.resolve(DEFAULT_LIVE_GUARDED_PROFILE_PATH)
  ) {
    optionBlockers.push("apply_profile_override_forbidden");
  }
  if (
    applyRequested &&
    activationReceiptPath &&
    path.resolve(activationReceiptPath) !==
      path.resolve(profile.activation_receipt_path)
  ) {
    optionBlockers.push(
      "apply_activation_receipt_override_forbidden",
    );
  }
  if (
    action === "issue-activation" &&
    !String(operatorId || "").trim()
  ) {
    optionBlockers.push("activation_operator_id_required");
  }
  if (
    action === "issue-activation" &&
    !String(reason || "").trim()
  ) {
    optionBlockers.push("activation_reason_required");
  }
  if (action === "issue-activation") {
    try {
      requireYoutubeOAuthClientSha256(youtubeOAuthClientSha256);
    } catch (error) {
      optionBlockers.push(String(error?.message || error));
    }
  }
  const profileValidation = {
    valid:
      baseProfileValidation.valid &&
      optionBlockers.length === 0,
    blockers: [
      ...baseProfileValidation.blockers,
      ...optionBlockers,
    ],
  };
  const checkoutInspector =
    dependencies.inspectCheckout || inspectCheckout;
  const databaseInspector =
    dependencies.inspectDatabase || inspectDatabase;
  const activationInspector =
    dependencies.inspectActivation ||
    inspectLiveActivationReceipt;
  const taskInspector =
    dependencies.inspectTask || inspectLiveWindowsTask;
  const conflictInspector =
    dependencies.inspectConflicts || inspectLiveTaskConflicts;
  const runtimeInspector =
    dependencies.inspectRuntime || inspectStoppedLiveRuntime;
  const startLockInspector =
    dependencies.inspectStartLock ||
    inspectLiveStartOperationLock;
  const migrationsDir = path.join(repoRoot, "db", "migrations");
  const checkout = checkoutInspector({
    repoRoot,
    expectedCommit,
    expectedBranch: profile.expected_branch,
    allowDetachedHead: profile.allow_detached_head,
  });
  const database = databaseInspector({
    dbPath: profile.database_path,
    migrationsDir,
  });
  const activation = activationInspector({
    profile,
    expectedCommit,
    migrationsDir,
    receiptPath:
      activationReceiptPath || profile.activation_receipt_path,
  });
  const task = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
  });
  const conflicts = conflictInspector({ profile });
  const runtime =
    action === "start"
      ? runtimeInspector({
          profile,
          repoRoot,
          expectedCommit,
          activation,
        })
      : {
          stopped: null,
          inspected: false,
          blockers: [],
        };
  const startOperationLock =
    action === "start"
      ? startLockInspector({
          profile,
          expectedCommit,
          activationReceiptSha256:
            activation.receipt_sha256,
          runtime,
        })
      : {
          present: false,
          valid: true,
          clear: true,
          state: "not_inspected",
          blockers: [],
        };
  const decision = buildLiveLifecycleDecision({
    action,
    applyRequested,
    confirmation,
    profileValidation,
    checkout,
    database,
    activation,
    task,
    conflicts,
    runtime,
    startOperationLock,
  });
  const bootProfileReady =
    profileValidation.valid &&
    checkout.ready === true &&
    database.ready === true &&
    activation.valid === true &&
    task.state === "managed_current" &&
    conflicts.clear === true;
  const actionReady =
    bootProfileReady &&
    (action !== "start" ||
      (runtime.stopped === true &&
        startOperationLock.clear === true));
  return {
    schema_version: "pulse-windows-live-guarded-runtime-doctor-v1",
    generated_at: new Date(generatedAt).toISOString(),
    authoritative: false,
    action: decision.action,
    target: {
      repo_root: normaliseWindowsPath(path.resolve(repoRoot)),
      expected_commit_sha: expectedCommit,
      expected_branch: profile.expected_branch,
      database_path: normaliseWindowsPath(profile.database_path),
      task_name: profile.task_name,
      task_principal: "SYSTEM",
      task_trigger: "AtStartup",
      runtime_owner_id: profile.runtime_owner_id,
    },
    profile: {
      profile_id: profile.profile_id,
      profile_sha256: profileFingerprint(profile),
      scheduler_profile:
        profile.environment.PULSE_SCHEDULER_PROFILE,
      operating_mode: profile.environment.PULSE_OPERATING_MODE,
      platform: profile.platform_policy.primary,
      secondary_automation_frozen:
        profile.platform_policy.secondary_automation_frozen,
    },
    checks: {
      profile: profileValidation,
      checkout,
      database,
      activation,
      task,
      conflicts,
      runtime,
      start_operation_lock: startOperationLock,
      control_policy: {
        kill_switch_healthy_required: true,
        fresh_green_control_tower_required_per_release: true,
        durable_release_commitment:
          "youtube_remote_publishAt",
      },
    },
    verdict: actionReady ? "READY" : "HOLD",
    action_ready: actionReady,
    boot_profile_ready: bootProfileReady,
    production_green: false,
    decision,
    evidence_boundary: [
      "READY proves only the exact boot supervision profile.",
      "Every release still requires fresh GREEN governed control.",
      "No OAuth or token value was read, printed or mutated.",
      "No platform was contacted and no task was changed by doctor mode.",
    ],
  };
}

function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(temporaryPath, filePath);
}

function writeLiveLifecycleReceipt({
  profile,
  action,
  expectedCommit,
  details = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const receipt = {
    schema_version:
      "pulse-windows-live-guarded-lifecycle-receipt-v1",
    generated_at: new Date(generatedAt).toISOString(),
    action,
    profile_id: profile.profile_id,
    profile_sha256: profileFingerprint(profile),
    runtime_owner_id: profile.runtime_owner_id,
    commit_sha: String(expectedCommit || "").toLowerCase(),
    platform: "youtube",
    secondary_automation_frozen: true,
    production_green: false,
    oauth_or_token_material_mutated: false,
    platform_contacted: false,
    details,
  };
  const safeTimestamp = receipt.generated_at.replace(/[:.]/g, "-");
  const receiptPath = path.join(
    profile.state_root,
    "evidence",
    `${safeTimestamp}-${action}.json`,
  );
  writeJsonAtomic(receiptPath, receipt);
  return {
    receipt_path: normaliseWindowsPath(receiptPath),
    receipt,
  };
}

function assertWindowsLifecycleHost(platform = process.platform) {
  if (platform !== "win32") {
    throw new Error("windows_lifecycle_host_required");
  }
}

function assertLiveSourceDatabaseReady({
  profile,
  repoRoot,
  expectedCommit,
} = {}) {
  const profileValidation =
    validateLiveGuardedRuntimeProfile(profile);
  if (!profileValidation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${profileValidation.blockers.join(",")}`,
    );
  }
  const checkout = inspectCheckout({
    repoRoot,
    expectedCommit,
    expectedBranch: profile.expected_branch,
    allowDetachedHead: profile.allow_detached_head,
  });
  if (!checkout.ready) {
    throw new Error(
      `live_guarded_checkout_not_ready:${checkout.blockers.join(",")}`,
    );
  }
  const database = inspectDatabase({
    dbPath: profile.database_path,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
  });
  if (!database.ready) {
    throw new Error(
      `live_guarded_database_not_ready:${database.blockers.join(",")}`,
    );
  }
  return { checkout, database };
}

function installLiveScheduledTask({
  profile,
  repoRoot,
  expectedCommit,
  enabled = false,
  nodeExecutable = process.execPath,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
  taskInspector = inspectLiveWindowsTask,
} = {}) {
  assertWindowsLifecycleHost(platform);
  if (enabled !== false) {
    throw new Error("live_task_install_must_be_disabled");
  }
  sourceDatabaseInspector({
    profile,
    repoRoot,
    expectedCommit,
  });
  const current = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
    execFileSyncImpl,
  });
  if (current.state === "managed_disabled") {
    return writeLiveLifecycleReceipt({
      profile,
      action: "install",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "no_op_already_installed_disabled",
      },
    });
  }
  if (current.state !== "absent") {
    throw new Error("refusing_to_replace_live_scheduled_task");
  }
  const xml = buildLiveScheduledTaskXml({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
    enabled: false,
  });
  fs.mkdirSync(profile.state_root, { recursive: true });
  const xmlPath = path.join(
    profile.state_root,
    `scheduled-task-${process.pid}-${Date.now()}.xml`,
  );
  try {
    fs.writeFileSync(
      xmlPath,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(xml, "utf16le"),
      ]),
    );
    execFileSyncImpl(
      "schtasks.exe",
      ["/Create", "/TN", profile.task_name, "/XML", xmlPath, "/F"],
      {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } finally {
    fs.rmSync(xmlPath, { force: true });
  }
  const installed = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
    execFileSyncImpl,
  });
  if (installed.state !== "managed_disabled") {
    throw new Error("live_task_post_install_identity_failed");
  }
  return writeLiveLifecycleReceipt({
    profile,
    action: "install",
    expectedCommit,
    details: {
      task_name: profile.task_name,
      outcome: "installed_disabled",
      trigger: "AtStartup",
      principal: "SYSTEM",
      logon_type: "ServiceAccount",
      start_immediately: false,
      command_fingerprint: installed.command_fingerprint,
    },
  });
}

function setLiveScheduledTaskEnabled({
  profile,
  repoRoot,
  expectedCommit,
  enabled,
  startImmediately = false,
  activation = null,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
  activationInspector = inspectLiveActivationReceipt,
  conflictInspector = inspectLiveTaskConflicts,
  taskInspector = inspectLiveWindowsTask,
  lifecycleReceiptWriter = writeLiveLifecycleReceipt,
} = {}) {
  assertWindowsLifecycleHost(platform);
  if (startImmediately !== false) {
    throw new Error("live_task_immediate_start_forbidden");
  }
  if (enabled === true) {
    sourceDatabaseInspector({
      profile,
      repoRoot,
      expectedCommit,
    });
    const currentActivation = activationInspector({
      profile,
      expectedCommit,
      migrationsDir: path.join(repoRoot, "db", "migrations"),
      receiptPath: profile.activation_receipt_path,
    });
    if (
      activation?.valid !== true ||
      currentActivation.valid !== true ||
      activation.receipt_sha256 !==
        currentActivation.receipt_sha256
    ) {
      throw new Error("exact_live_activation_receipt_required");
    }
    const conflicts = conflictInspector({ profile });
    if (conflicts.clear !== true) {
      throw new Error(
        `conflicting_runtime_task_enabled:${conflicts.blockers.join(",")}`,
      );
    }
  }
  const current = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  if (!["managed_current", "managed_disabled"].includes(current.state)) {
    throw new Error("refusing_to_change_unmanaged_live_task");
  }
  const targetState = enabled
    ? "managed_current"
    : "managed_disabled";
  if (current.state === targetState) {
    return lifecycleReceiptWriter({
      profile,
      action: enabled ? "enable" : "disable",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "no_op_already_current",
        start_immediately: false,
      },
    });
  }
  execFileSyncImpl(
    "schtasks.exe",
    [
      "/Change",
      "/TN",
      profile.task_name,
      enabled ? "/ENABLE" : "/DISABLE",
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const updated = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  if (updated.state !== targetState) {
    throw new Error("live_task_enablement_verification_failed");
  }
  return lifecycleReceiptWriter({
    profile,
    action: enabled ? "enable" : "disable",
    expectedCommit,
    details: {
      task_name: profile.task_name,
      outcome: enabled
        ? "enabled_for_next_boot"
        : "disabled",
      start_immediately: false,
      activation_receipt_sha256:
        enabled ? activation.receipt_sha256 : null,
    },
  });
}

function readLiveSupervisorOwner({ profile } = {}) {
  const ownerPath = path.join(
    profile.state_root,
    "supervisor-owner.json",
  );
  if (!fs.existsSync(ownerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    return null;
  }
}

function acquireLiveStartOperationLock({
  profile,
  expectedCommit,
  activationReceiptSha256,
  operationNonce = crypto.randomUUID(),
  processId = process.pid,
  generatedAt = new Date().toISOString(),
  staleRuntime = null,
  processAliveInspector = processAppearsAlive,
} = {}) {
  const nonce = String(operationNonce || "").trim().toLowerCase();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      nonce,
    )
  ) {
    throw new Error("live_start_operation_nonce_invalid");
  }
  if (!SHA256_PATTERN.test(String(activationReceiptSha256 || ""))) {
    throw new Error(
      "live_start_operation_activation_receipt_sha256_invalid",
    );
  }
  const lockPath = path.join(
    profile.state_root,
    "start-operation.lock.json",
  );
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const record = {
    schema_version: LIVE_START_OPERATION_SCHEMA,
    acquired_at: new Date(generatedAt).toISOString(),
    operation_nonce: nonce,
    process_id: Number(processId),
    commit_sha: String(expectedCommit || "").toLowerCase(),
    profile_sha256: profileFingerprint(profile),
    activation_receipt_sha256: activationReceiptSha256,
  };
  let descriptor;
  let recoveredLockEvidencePath = null;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = inspectLiveStartOperationLock({
      profile,
      expectedCommit,
      activationReceiptSha256,
      runtime: staleRuntime,
      processAliveInspector,
    });
    if (existing.state !== "exact_stale_recoverable") {
      throw new Error("live_start_operation_locked");
    }
    recoveredLockEvidencePath = path.join(
      profile.state_root,
      "evidence",
      `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
        `-stale-start-operation-${existing.operation_nonce}.json`,
    );
    fs.mkdirSync(
      path.dirname(recoveredLockEvidencePath),
      { recursive: true },
    );
    try {
      fs.renameSync(lockPath, recoveredLockEvidencePath);
      descriptor = fs.openSync(lockPath, "wx");
    } catch {
      throw new Error("live_start_operation_locked");
    }
  }
  try {
    fs.writeFileSync(
      descriptor,
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    lock_path: lockPath,
    operation_nonce: nonce,
    record,
    recovered_lock_evidence_path: recoveredLockEvidencePath,
  };
}

function releaseLiveStartOperationLock({
  lock,
  generatedAt = new Date().toISOString(),
} = {}) {
  let current;
  try {
    current = JSON.parse(fs.readFileSync(lock.lock_path, "utf8"));
  } catch {
    throw new Error("live_start_operation_lock_unreadable");
  }
  if (
    current.schema_version !== LIVE_START_OPERATION_SCHEMA ||
    current.operation_nonce !== lock.operation_nonce
  ) {
    throw new Error("live_start_operation_lock_ownership_lost");
  }
  const evidencePath = path.join(
    path.dirname(lock.lock_path),
    "evidence",
    `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
      `-start-operation-${lock.operation_nonce}.json`,
  );
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.renameSync(lock.lock_path, evidencePath);
  return {
    outcome: "start_operation_lock_released",
    evidence_path: evidencePath,
    operation_nonce: lock.operation_nonce,
  };
}

function inspectLiveStartOperationLock({
  profile,
  expectedCommit,
  activationReceiptSha256,
  runtime = null,
  processAliveInspector = processAppearsAlive,
} = {}) {
  const lockPath = path.join(
    profile.state_root,
    "start-operation.lock.json",
  );
  if (!fs.existsSync(lockPath)) {
    return {
      present: false,
      valid: true,
      clear: true,
      state: "absent",
      operation_nonce: null,
      lock_path: lockPath,
      blockers: [],
    };
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return {
      present: true,
      valid: false,
      clear: false,
      state: "invalid",
      operation_nonce: null,
      lock_path: lockPath,
      blockers: ["live_start_operation_lock_invalid_json"],
    };
  }
  const blockers = [];
  if (record.schema_version !== LIVE_START_OPERATION_SCHEMA) {
    blockers.push("live_start_operation_lock_schema_invalid");
  }
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      String(record.operation_nonce || ""),
    )
  ) {
    blockers.push("live_start_operation_lock_nonce_invalid");
  }
  if (
    String(record.commit_sha || "").toLowerCase() !==
    String(expectedCommit || "").toLowerCase()
  ) {
    blockers.push("live_start_operation_lock_commit_mismatch");
  }
  if (record.profile_sha256 !== profileFingerprint(profile)) {
    blockers.push("live_start_operation_lock_profile_mismatch");
  }
  if (
    record.activation_receipt_sha256 !== activationReceiptSha256
  ) {
    blockers.push("live_start_operation_lock_activation_mismatch");
  }
  if (
    !Number.isInteger(Number(record.process_id)) ||
    Number(record.process_id) <= 0
  ) {
    blockers.push("live_start_operation_lock_process_id_invalid");
  }
  let state = blockers.length ? "mismatch" : "unknown";
  let clear = false;
  let processAlive = null;
  if (blockers.length === 0) {
    processAlive = processAliveInspector(record.process_id);
    if (processAlive) {
      state = "active";
      blockers.push("live_start_operation_lock_active");
    } else {
      const noLiveRuntime =
        runtime?.stopped === true &&
        Array.isArray(runtime?.listening_pids) &&
        runtime.listening_pids.length === 0 &&
        ["absent", "exact_stale"].includes(
          runtime?.owner_state,
        );
      if (noLiveRuntime) {
        state = "exact_stale_recoverable";
        clear = true;
      } else {
        state = "stale_recovery_blocked";
        blockers.push(
          "live_start_operation_stale_recovery_unsafe",
        );
      }
    }
  }
  return {
    present: true,
    valid:
      ![
        "mismatch",
        "invalid",
      ].includes(state),
    clear,
    state,
    process_alive: processAlive,
    operation_nonce: record.operation_nonce || null,
    lock_path: lockPath,
    record,
    blockers,
  };
}

function archiveExactStaleLiveOwner({
  profile,
  repoRoot,
  expectedCommit,
  activation,
  operationNonce,
  listenerInspector = inspectWindowsListeners,
  processAliveInspector = processAppearsAlive,
  startLockInspector = inspectLiveStartOperationLock,
  generatedAt = new Date().toISOString(),
} = {}) {
  const lockState = startLockInspector({
    profile,
    expectedCommit,
    activationReceiptSha256: activation?.receipt_sha256,
  });
  if (
    lockState.valid !== true ||
    lockState.operation_nonce !== operationNonce
  ) {
    throw new Error(
      "stale_owner_archive_start_operation_lock_required",
    );
  }
  const stopped = inspectStoppedLiveRuntime({
    profile,
    repoRoot,
    expectedCommit,
    activation,
    listenerInspector,
    processAliveInspector,
  });
  if (stopped.owner_state === "absent") {
    return { outcome: "no_stale_owner" };
  }
  if (stopped.stopped !== true || stopped.owner_state !== "exact_stale") {
    throw new Error("exact_dead_stale_owner_required");
  }
  const ownerPath = path.join(
    profile.state_root,
    "supervisor-owner.json",
  );
  const currentBytes = String(fs.readFileSync(ownerPath, "utf8"));
  if (sha256(currentBytes) !== stopped.owner_receipt_sha256) {
    throw new Error("stale_owner_changed_before_archive");
  }
  const archivedPath = path.join(
    profile.state_root,
    "evidence",
    `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
      `-stale-supervisor-owner-${stopped.owner_record.child_pid}.json`,
  );
  fs.mkdirSync(path.dirname(archivedPath), { recursive: true });
  fs.renameSync(ownerPath, archivedPath);
  return {
    outcome: "exact_stale_owner_archived",
    archived_path: archivedPath,
    owner_receipt_sha256: stopped.owner_receipt_sha256,
  };
}

async function startLiveScheduledTask({
  profile,
  repoRoot,
  expectedCommit,
  activation = null,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
  activationInspector = inspectLiveActivationReceipt,
  conflictInspector = inspectLiveTaskConflicts,
  taskInspector = inspectLiveWindowsTask,
  listenerInspector = inspectWindowsListeners,
  runtimeInspector = inspectStoppedLiveRuntime,
  healthRequester = requestLocalHealth,
  ownerReader = readLiveSupervisorOwner,
  delayImpl = delay,
  timeoutMs = 75_000,
  shutdownTimeoutMs = 15_000,
  lifecycleReceiptWriter = writeLiveLifecycleReceipt,
  operationNonceFactory = crypto.randomUUID,
  startLockAcquirer = acquireLiveStartOperationLock,
  startLockReleaser = releaseLiveStartOperationLock,
  startLockInspector = inspectLiveStartOperationLock,
  staleOwnerArchiver = archiveExactStaleLiveOwner,
} = {}) {
  assertWindowsLifecycleHost(platform);
  const preLockRuntime = runtimeInspector({
    profile,
    repoRoot,
    expectedCommit,
    activation,
    listenerInspector,
  });
  if (preLockRuntime.stopped !== true) {
    throw new Error(
      `live_runtime_not_stopped:${(
        preLockRuntime.blockers || [
          "live_runtime_stop_state_not_verified",
        ]
      ).join(",")}`,
    );
  }
  const operationNonce = operationNonceFactory();
  const lock = startLockAcquirer({
    profile,
    expectedCommit,
    activationReceiptSha256: activation?.receipt_sha256,
    operationNonce,
    staleRuntime: preLockRuntime,
  });
  let launched = false;
  let currentActivation = null;

  const inspectExactTask = () =>
    taskInspector({
      profile,
      repoRoot,
      expectedCommit,
      execFileSyncImpl,
    });
  const inspectCurrentLock = () =>
    startLockInspector({
      profile,
      expectedCommit,
      activationReceiptSha256: activation?.receipt_sha256,
    });
  const taskCommand = (args) =>
    execFileSyncImpl("schtasks.exe", args, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const assertBoundaryAuthority = ({
    postLaunch = false,
  } = {}) => {
    try {
      sourceDatabaseInspector({
        profile,
        repoRoot,
        expectedCommit,
      });
    } catch (error) {
      throw new Error(
        `${postLaunch ? "post_launch_" : ""}` +
          `source_authority_drift:${String(error?.message || error)}`,
      );
    }
    const inspectedActivation = activationInspector({
      profile,
      expectedCommit,
      migrationsDir: path.join(repoRoot, "db", "migrations"),
      receiptPath: profile.activation_receipt_path,
    });
    if (
      activation?.valid !== true ||
      inspectedActivation.valid !== true ||
      activation.receipt_sha256 !==
        inspectedActivation.receipt_sha256
    ) {
      throw new Error(
        postLaunch
          ? "post_launch_activation_receipt_drift"
          : "exact_live_activation_receipt_required",
      );
    }
    const conflicts = conflictInspector({ profile });
    if (conflicts.clear !== true) {
      throw new Error(
        `${postLaunch ? "post_launch_" : ""}` +
          `conflicting_runtime_task_state:${(
            conflicts.blockers || []
          ).join(",")}`,
      );
    }
    const task = inspectExactTask();
    if (task.state !== "managed_current") {
      throw new Error(
        postLaunch
          ? "post_launch_managed_task_identity_drift"
          : "enabled_managed_live_task_required",
      );
    }
    return inspectedActivation;
  };
  const inspectExactRuntimeIdentity = async (
    inspectedActivation,
  ) => {
    const owner = ownerReader({ profile });
    const health = await healthRequester({ port: profile.port });
    const listeners = listenerInspector({ port: profile.port });
    const childPid = Number(owner?.child_pid) || null;
    if (
      safeLiveHealthIdentity(health, expectedCommit) &&
      owner?.schema_version ===
        "pulse-windows-live-guarded-owner-v1" &&
      Number(owner?.port) === Number(profile.port) &&
      normaliseWindowsPath(owner?.repo_root).toLowerCase() ===
        normaliseWindowsPath(path.resolve(repoRoot)).toLowerCase() &&
      owner?.commit_sha === String(expectedCommit).toLowerCase() &&
      owner?.profile_sha256 === profileFingerprint(profile) &&
      owner?.activation_receipt_sha256 ===
        inspectedActivation.receipt_sha256 &&
      owner?.start_operation_nonce === operationNonce &&
      owner?.platform === "youtube" &&
      Number.isInteger(Number(owner?.supervisor_pid)) &&
      childPid &&
      listeners?.available === true &&
      Array.isArray(listeners.listeningPids) &&
      listeners.listeningPids.length === 1 &&
      Number(listeners.listeningPids[0]) === childPid
    ) {
      return {
        owner,
        health,
        listener_pid: childPid,
      };
    }
    return null;
  };

  const cleanupOwnAttempt = async () => {
    const cleanup = {
      operation_owned: false,
      end_attempted: false,
      end_succeeded: false,
      disable_attempted: false,
      disable_succeeded: false,
      task_state: "unknown",
      port_free: false,
      owner_cleared: false,
      stopped_verified: false,
      blockers: [],
      orphan_listener_pids: [],
    };
    const lockState = inspectCurrentLock();
    const ownerBefore = ownerReader({ profile });
    if (
      lockState.valid !== true ||
      lockState.operation_nonce !== operationNonce
    ) {
      cleanup.blockers.push(
        "start_cleanup_operation_lock_ownership_lost",
      );
      return cleanup;
    }
    if (
      ownerBefore &&
      ownerBefore.start_operation_nonce !== operationNonce
    ) {
      cleanup.blockers.push(
        "start_cleanup_owner_operation_nonce_mismatch",
      );
      return cleanup;
    }
    const beforeEndTask = inspectExactTask();
    if (beforeEndTask.state !== "managed_current") {
      cleanup.blockers.push(
        "start_cleanup_managed_task_identity_lost",
      );
      return cleanup;
    }
    cleanup.operation_owned = true;
    cleanup.end_attempted = true;
    try {
      taskCommand(["/End", "/TN", profile.task_name]);
      cleanup.end_succeeded = true;
    } catch (error) {
      cleanup.blockers.push(
        `start_cleanup_end_failed:${String(error?.message || error)}`,
      );
    }

    const lockBeforeDisable = inspectCurrentLock();
    const ownerBeforeDisable = ownerReader({ profile });
    const beforeDisableTask = inspectExactTask();
    if (
      lockBeforeDisable.valid !== true ||
      lockBeforeDisable.operation_nonce !== operationNonce ||
      (ownerBeforeDisable &&
        ownerBeforeDisable.start_operation_nonce !== operationNonce) ||
      beforeDisableTask.state !== "managed_current"
    ) {
      cleanup.blockers.push(
        "start_cleanup_disable_authority_lost",
      );
    } else {
      cleanup.disable_attempted = true;
      try {
        taskCommand([
          "/Change",
          "/TN",
          profile.task_name,
          "/DISABLE",
        ]);
        cleanup.disable_succeeded = true;
      } catch (error) {
        cleanup.blockers.push(
          `start_cleanup_disable_failed:${String(
            error?.message || error,
          )}`,
        );
      }
    }

    const shutdownDeadline = Date.now() + shutdownTimeoutMs;
    let afterListeners = {
      available: false,
      listeningPids: [],
    };
    let afterOwner = ownerReader({ profile });
    do {
      afterListeners = listenerInspector({ port: profile.port });
      afterOwner = ownerReader({ profile });
      const noListeners =
        afterListeners?.available === true &&
        Array.isArray(afterListeners.listeningPids) &&
        afterListeners.listeningPids.length === 0;
      if (noListeners && !afterOwner) break;
      await delayImpl(250);
    } while (Date.now() < shutdownDeadline);
    cleanup.port_free =
      afterListeners?.available === true &&
      Array.isArray(afterListeners.listeningPids) &&
      afterListeners.listeningPids.length === 0;
    cleanup.owner_cleared = !afterOwner;
    cleanup.orphan_listener_pids = Array.isArray(
      afterListeners?.listeningPids,
    )
      ? afterListeners.listeningPids.map(Number)
      : [];
    const afterTask = inspectExactTask();
    cleanup.task_state = afterTask.state;
    cleanup.stopped_verified =
      afterTask.state === "managed_disabled" &&
      cleanup.port_free &&
      cleanup.owner_cleared;
    if (!cleanup.port_free) {
      cleanup.blockers.push("start_cleanup_orphan_listener");
    }
    if (!cleanup.owner_cleared) {
      cleanup.blockers.push("start_cleanup_owner_not_cleared");
    }
    if (afterTask.state !== "managed_disabled") {
      cleanup.blockers.push("start_cleanup_task_not_disabled");
    }
    return cleanup;
  };

  try {
    currentActivation = assertBoundaryAuthority();
    const stoppedRuntime = runtimeInspector({
      profile,
      repoRoot,
      expectedCommit,
      activation: currentActivation,
      listenerInspector,
    });
    if (stoppedRuntime.stopped !== true) {
      throw new Error(
        `live_runtime_not_stopped:${(
          stoppedRuntime.blockers || [
            "live_runtime_stop_state_not_verified",
          ]
        ).join(",")}`,
      );
    }
    if (stoppedRuntime.owner_state === "exact_stale") {
      const archivedOwner = staleOwnerArchiver({
        profile,
        repoRoot,
        expectedCommit,
        activation: currentActivation,
        operationNonce,
        listenerInspector,
        startLockInspector,
      });
      if (archivedOwner.outcome !== "exact_stale_owner_archived") {
        throw new Error("exact_stale_owner_archive_failed");
      }
    }

    launched = true;
    taskCommand(["/Run", "/TN", profile.task_name]);

    const deadline = Date.now() + timeoutMs;
    let verified = null;
    do {
      verified = await inspectExactRuntimeIdentity(
        currentActivation,
      );
      if (verified) break;
      await delayImpl(750);
    } while (Date.now() < deadline);
    if (!verified) {
      throw new Error("live_task_start_verification_failed");
    }

    const postActivation = assertBoundaryAuthority({
      postLaunch: true,
    });
    const lockBeforeAttestation = inspectCurrentLock();
    if (
      lockBeforeAttestation.valid !== true ||
      lockBeforeAttestation.operation_nonce !== operationNonce
    ) {
      throw new Error("post_launch_start_operation_lock_drift");
    }
    verified = await inspectExactRuntimeIdentity(postActivation);
    if (!verified) {
      throw new Error("post_launch_runtime_identity_drift");
    }
    return lifecycleReceiptWriter({
      profile,
      action: "start",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "started_verified",
        operation_nonce: operationNonce,
        activation_receipt_sha256:
          postActivation.receipt_sha256,
        supervisor_pid: Number(verified.owner.supervisor_pid),
        child_pid: Number(verified.owner.child_pid),
        listener_pid: verified.listener_pid,
        owner_receipt_path: normaliseWindowsPath(
          path.join(profile.state_root, "supervisor-owner.json"),
        ),
      },
    });
  } catch (error) {
    if (!launched) throw error;
    const primaryError = String(error?.message || error);
    let cleanup;
    try {
      cleanup = await cleanupOwnAttempt();
    } catch (cleanupError) {
      cleanup = {
        operation_owned: false,
        end_attempted: false,
        end_succeeded: false,
        disable_attempted: false,
        disable_succeeded: false,
        task_state: "unknown",
        port_free: false,
        owner_cleared: false,
        stopped_verified: false,
        blockers: [
          `start_cleanup_unhandled_error:${String(
            cleanupError?.message || cleanupError,
          )}`,
        ],
        orphan_listener_pids: [],
      };
    }
    lifecycleReceiptWriter({
      profile,
      action: "start-failed",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "start_failed",
        operation_nonce: operationNonce,
        activation_receipt_sha256:
          activation?.receipt_sha256 || null,
        primary_error: primaryError,
        stopped_verified: cleanup.stopped_verified,
        cleanup,
      },
    });
    if (
      cleanup.blockers.length > 0 ||
      cleanup.end_succeeded !== true ||
      cleanup.disable_succeeded !== true ||
      cleanup.stopped_verified !== true
    ) {
      throw new Error(
        `live_task_start_fail_closed_incomplete:${primaryError}:` +
          cleanup.blockers.join(","),
      );
    }
    throw new Error(`live_task_start_failed:${primaryError}`);
  } finally {
    startLockReleaser({ lock });
  }
}

function uninstallLiveScheduledTask({
  profile,
  repoRoot,
  expectedCommit,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  taskInspector = inspectLiveWindowsTask,
} = {}) {
  assertWindowsLifecycleHost(platform);
  const current = taskInspector({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  if (current.state !== "managed_disabled") {
    throw new Error("disabled_managed_live_task_required");
  }
  execFileSyncImpl(
    "schtasks.exe",
    ["/Delete", "/TN", profile.task_name, "/F"],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return writeLiveLifecycleReceipt({
    profile,
    action: "uninstall",
    expectedCommit,
    details: {
      task_name: profile.task_name,
      outcome: "uninstalled",
    },
  });
}

function issueLiveActivationReceipt({
  profile,
  repoRoot,
  expectedCommit,
  operatorId,
  reason,
  youtubeOAuthClientSha256,
  generatedAt = new Date().toISOString(),
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
} = {}) {
  sourceDatabaseInspector({
    profile,
    repoRoot,
    expectedCommit,
  });
  const receipt = buildLiveActivationReceipt({
    profile,
    expectedCommit,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
    operatorId,
    reason,
    youtubeOAuthClientSha256,
    generatedAt,
  });
  const receiptPath = path.resolve(profile.activation_receipt_path);
  if (fs.existsSync(receiptPath)) {
    const current = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir: path.join(repoRoot, "db", "migrations"),
      receiptPath,
    });
    if (
      current.valid !== true ||
      current.receipt_sha256 !== receipt.receipt_sha256
    ) {
      throw new Error(
        "refusing_to_replace_existing_activation_receipt",
      );
    }
    return {
      outcome: "no_op_exact_activation_receipt_exists",
      receipt_path: normaliseWindowsPath(receiptPath),
      receipt_sha256: receipt.receipt_sha256,
    };
  }
  writeJsonAtomic(receiptPath, receipt);
  return {
    outcome: "activation_receipt_issued",
    receipt_path: normaliseWindowsPath(receiptPath),
    receipt_sha256: receipt.receipt_sha256,
  };
}

function revokeLiveActivationReceipt({
  profile,
  expectedCommit,
  generatedAt = new Date().toISOString(),
  taskDisabledConfirmed = false,
} = {}) {
  if (taskDisabledConfirmed !== true) {
    throw new Error("disabled_managed_task_required");
  }
  const receiptPath = path.resolve(profile.activation_receipt_path);
  if (!fs.existsSync(receiptPath)) {
    return {
      outcome: "no_op_activation_receipt_absent",
      receipt_path: normaliseWindowsPath(receiptPath),
    };
  }
  const evidenceRoot = path.join(profile.state_root, "evidence");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const archivedPath = path.join(
    evidenceRoot,
    `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
      "-revoked-activation-receipt.json",
  );
  if (fs.existsSync(archivedPath)) {
    throw new Error("activation_revocation_archive_exists");
  }
  fs.renameSync(receiptPath, archivedPath);
  const lifecycle = writeLiveLifecycleReceipt({
    profile,
    action: "revoke-activation",
    expectedCommit,
    generatedAt,
    details: {
      outcome: "activation_receipt_revoked",
      archived_receipt_path: normaliseWindowsPath(archivedPath),
      task_must_remain_disabled: true,
    },
  });
  return {
    outcome: "activation_receipt_revoked",
    archived_receipt_path: normaliseWindowsPath(archivedPath),
    evidence_path: lifecycle.receipt_path,
  };
}

function createDefaultLiveLifecycleHandlers({
  installImpl = installLiveScheduledTask,
  setEnabledImpl = setLiveScheduledTaskEnabled,
  startImpl = startLiveScheduledTask,
  uninstallImpl = uninstallLiveScheduledTask,
  issueActivationImpl = issueLiveActivationReceipt,
  revokeActivationImpl = revokeLiveActivationReceipt,
} = {}) {
  return {
    async "issue-activation"({ profile, options }) {
      return issueActivationImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        operatorId: options.operatorId,
        reason: options.reason,
        youtubeOAuthClientSha256:
          options.youtubeOAuthClientSha256,
        generatedAt: options.generatedAt,
      });
    },
    async install({ profile, options }) {
      return installImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        enabled: false,
      });
    },
    async "revoke-activation"({ report, profile, options }) {
      return revokeActivationImpl({
        profile,
        expectedCommit: options.expectedCommit,
        taskDisabledConfirmed:
          ["absent", "managed_disabled"].includes(
            report?.checks?.task?.state,
          ),
      });
    },
    async enable({ report, profile, options }) {
      return setEnabledImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        enabled: true,
        startImmediately: false,
        activation: report.checks.activation,
      });
    },
    async start({ report, profile, options }) {
      return startImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        activation: report.checks.activation,
      });
    },
    async disable({ profile, options }) {
      return setEnabledImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        enabled: false,
        startImmediately: false,
      });
    },
    async uninstall({ profile, options }) {
      return uninstallImpl({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
      });
    },
  };
}

function prepareLiveSupervision({
  report,
  profile,
  expectedCommit,
  systemEnvironment = process.env,
} = {}) {
  if (
    report?.boot_profile_ready !== true ||
    report?.checks?.activation?.valid !== true
  ) {
    throw new Error("live_boot_profile_not_ready");
  }
  const runtimeEnvironment = buildLiveChildEnvironment({
    profile,
    expectedCommit,
    activation: report.checks.activation,
    systemEnvironment,
  });
  return {
    profile_id: profile.profile_id,
    commit_sha: String(expectedCommit || "").toLowerCase(),
    activation_receipt_sha256:
      report.checks.activation.receipt_sha256,
    runtime_environment: runtimeEnvironment,
  };
}

function safeLiveHealthIdentity(health, expectedCommit) {
  return (
    String(health?.build?.commit_sha || "").toLowerCase() ===
      String(expectedCommit || "").toLowerCase() &&
    health?.status === "ok" &&
    health?.schedulerActive === true &&
    health?.deployment?.mode === "local" &&
    health?.deployment?.primary === true &&
    health?.runtime?.operating_mode === "LIVE_GUARDED" &&
    health?.runtime?.auto_publish === true &&
    health?.runtime?.legacy_auto_publish_armed === true &&
    health?.runtime?.use_sqlite === true &&
    String(
      health?.runtime?.use_job_queue_explicit,
    ).toLowerCase() === "true"
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForLiveHealth({
  port,
  expectedCommit,
  healthRequester = requestLocalHealth,
  timeoutMs = 60_000,
  intervalMs = 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const health = await healthRequester({ port });
    if (safeLiveHealthIdentity(health, expectedCommit)) {
      return health;
    }
    await delay(intervalMs);
  } while (Date.now() < deadline);
  return null;
}

function processAppearsAlive(pid, killImpl = process.kill.bind(process)) {
  try {
    killImpl(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function settleLiveChildExit({
  terminationReason,
  childError = null,
  childPid,
  code,
  signal,
  cleanupImpl,
  writeExitReceiptImpl,
} = {}) {
  cleanupImpl();
  const details = {
    child_pid: Number(childPid),
    exit_code: code,
    signal,
    reason: terminationReason || "unexpected_child_exit",
  };
  writeExitReceiptImpl(details);
  if (terminationReason === "live_runtime_health_lost") {
    return {
      outcome: "restart_required",
      ...details,
    };
  }
  if (terminationReason === "supervisor_shutdown") {
    return {
      outcome: "stopped",
      ...details,
    };
  }
  if (childError) {
    const error = new Error(
      terminationReason ||
        `live_runtime_child_error:${String(
          childError?.message || childError,
        )}`,
    );
    error.cause = childError;
    throw error;
  }
  throw new Error(
    terminationReason ||
      `live_runtime_exited:${code ?? "signal"}:${signal || ""}`,
  );
}

function cleanTerminationErrorMessage(error) {
  return String(error?.message || error || "unknown")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 160);
}

function terminationReasonPriority(reason) {
  if (reason === "supervisor_shutdown") return 100;
  if (String(reason).startsWith("activation_revoked:")) return 90;
  if (String(reason).startsWith("live_runtime_child_error:")) {
    return 80;
  }
  if (String(reason).startsWith("live_runtime_monitor_error:")) {
    return 70;
  }
  if (reason === "live_runtime_health_lost") return 60;
  return 50;
}

function superviseLiveChildSession({
  child,
  ownerPath,
  profile,
  repoRoot,
  expectedCommit,
  activationReceiptPath = null,
  activationInspector = inspectLiveActivationReceipt,
  healthRequester = requestLocalHealth,
  monitorIntervalMs = 15_000,
  signalEmitter = process,
  shutdownSignal = null,
  writeExitReceiptImpl,
  terminationGraceMs = 5_000,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let monitor = null;
    let monitorInFlight = false;
    let forceTimer = null;
    let healthFailures = 0;
    let terminationReason = null;
    let terminationRequested = false;
    let childError = null;
    let signalListenersAttached = false;
    const cleanup = () => {
      if (monitor) clearInterval(monitor);
      if (forceTimer) clearTimeout(forceTimer);
      if (signalListenersAttached) {
        signalEmitter.off("SIGTERM", onTerminate);
        signalEmitter.off("SIGINT", onTerminate);
      }
      shutdownSignal?.removeEventListener("abort", onTerminate);
      fs.rmSync(ownerPath, { force: true });
    };

    const attemptKill = (signal) => {
      try {
        child.kill(signal);
      } catch (error) {
        childError ||= error;
      }
    };

    const scheduleForcedTermination = () => {
      if (forceTimer) return;
      const graceMs = Number.isFinite(Number(terminationGraceMs))
        ? Math.max(0, Number(terminationGraceMs))
        : 5_000;
      forceTimer = setTimeout(() => {
        forceTimer = null;
        if (!settled) attemptKill("SIGKILL");
      }, graceMs);
      forceTimer.unref?.();
    };

    const terminateChild = (reason) => {
      if (settled) return;
      const shouldReplaceReason =
        !terminationReason ||
        terminationReasonPriority(reason) >
          terminationReasonPriority(terminationReason);
      if (shouldReplaceReason) terminationReason = reason;
      if (terminationRequested && !shouldReplaceReason) return;
      terminationRequested = true;
      attemptKill("SIGTERM");
      scheduleForcedTermination();
    };

    const onTerminate = () => {
      terminateChild("supervisor_shutdown");
    };

    const onChildError = (error) => {
      if (settled) return;
      childError ||= error;
      terminateChild(
        `live_runtime_child_error:${cleanTerminationErrorMessage(
          error,
        )}`,
      );
    };

    const onChildExit = (code, signal) => {
      if (settled) return;
      settled = true;
      settleLiveChildExit({
        terminationReason,
        childError,
        childPid: Number(child.pid),
        code,
        signal,
        cleanupImpl: cleanup,
        writeExitReceiptImpl:
          writeExitReceiptImpl || (() => undefined),
      }).then(resolve, reject);
    };

    monitor = setInterval(async () => {
      if (settled || monitorInFlight) return;
      monitorInFlight = true;
      try {
        const activation = activationInspector({
          profile,
          expectedCommit,
          migrationsDir: path.join(repoRoot, "db", "migrations"),
          receiptPath:
            activationReceiptPath ||
            profile.activation_receipt_path,
        });
        if (activation.valid !== true) {
          terminateChild(
            `activation_revoked:${activation.blockers.join(",")}`,
          );
          return;
        }
        if (terminationRequested) return;
        const currentHealth = await healthRequester({
          port: profile.port,
        });
        if (settled) return;
        if (safeLiveHealthIdentity(currentHealth, expectedCommit)) {
          healthFailures = 0;
        } else {
          healthFailures += 1;
          if (healthFailures >= 3) {
            terminateChild("live_runtime_health_lost");
          }
        }
      } catch (error) {
        childError ||= error;
        terminateChild(
          `live_runtime_monitor_error:${cleanTerminationErrorMessage(
            error,
          )}`,
        );
      } finally {
        monitorInFlight = false;
      }
    }, monitorIntervalMs);
    monitor.unref?.();
    if (shutdownSignal) {
      shutdownSignal.addEventListener("abort", onTerminate, {
        once: true,
      });
    } else {
      signalEmitter.on("SIGTERM", onTerminate);
      signalEmitter.on("SIGINT", onTerminate);
      signalListenersAttached = true;
    }
    child.once("error", onChildError);
    child.once("exit", onChildExit);
    if (shutdownSignal?.aborted) onTerminate();
    if (
      child.exitCode !== undefined &&
      (child.exitCode !== null || child.signalCode)
    ) {
      queueMicrotask(() =>
        onChildExit(child.exitCode, child.signalCode || null),
      );
    }
  });
}

function waitForAbortableDelay({
  milliseconds,
  shutdownSignal,
  delayImpl = delay,
} = {}) {
  if (shutdownSignal?.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      shutdownSignal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(false);
    shutdownSignal?.addEventListener("abort", onAbort, {
      once: true,
    });
    Promise.resolve()
      .then(() => delayImpl(milliseconds))
      .then(
        () => finish(!shutdownSignal?.aborted),
        (error) => finish(false, error),
      );
  });
}

async function runLiveSupervisionLifecycle({
  startGenerationImpl,
  superviseGenerationImpl = superviseLiveChildSession,
  signalEmitter = process,
  restartDelayMs = 15_000,
  delayImpl = delay,
  maxRestartGenerations = 3,
} = {}) {
  if (typeof startGenerationImpl !== "function") {
    throw new Error("live_supervision_generation_starter_required");
  }
  if (
    !Number.isInteger(maxRestartGenerations) ||
    maxRestartGenerations < 0 ||
    maxRestartGenerations > 100
  ) {
    throw new Error("live_supervision_restart_budget_invalid");
  }

  const shutdownController = new AbortController();
  const onTerminate = () => {
    if (!shutdownController.signal.aborted) {
      shutdownController.abort("supervisor_shutdown");
    }
  };
  signalEmitter.on("SIGTERM", onTerminate);
  signalEmitter.on("SIGINT", onTerminate);
  let generation = 0;
  try {
    while (!shutdownController.signal.aborted) {
      generation += 1;
      const generationSession = await startGenerationImpl({
        generation,
        shutdownSignal: shutdownController.signal,
      });
      const result = await superviseGenerationImpl({
        ...generationSession,
        shutdownSignal: shutdownController.signal,
      });
      if (result?.outcome === "stopped") {
        return result;
      }
      if (result?.outcome !== "restart_required") {
        throw new Error(
          `live_supervision_generation_outcome_invalid:${String(
            result?.outcome || "missing",
          )}`,
        );
      }
      if (shutdownController.signal.aborted) {
        return {
          outcome: "stopped",
          reason: "supervisor_shutdown_during_recovery",
          generation,
        };
      }
      if (generation > maxRestartGenerations) {
        throw new Error(
          `live_runtime_health_restart_budget_exhausted:${generation}`,
        );
      }
      const delayCompleted = await waitForAbortableDelay({
        milliseconds: restartDelayMs,
        shutdownSignal: shutdownController.signal,
        delayImpl,
      });
      if (!delayCompleted) {
        return {
          outcome: "stopped",
          reason: "supervisor_shutdown_during_recovery",
          generation,
        };
      }
    }
    return {
      outcome: "stopped",
      reason: "supervisor_shutdown",
      generation,
    };
  } finally {
    signalEmitter.off("SIGTERM", onTerminate);
    signalEmitter.off("SIGINT", onTerminate);
  }
}

async function startLiveSupervisionGeneration({
  repoRoot,
  expectedCommit,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  activationReceiptPath = null,
  systemEnvironment = process.env,
  spawnImpl = spawn,
  listenerInspector = inspectWindowsListeners,
  healthRequester = requestLocalHealth,
  killImpl = process.kill.bind(process),
  monitorIntervalMs = 15_000,
  terminationGraceMs = 5_000,
} = {}) {
  assertWindowsLifecycleHost();
  const profile = loadLiveGuardedRuntimeProfile({ profilePath });
  const report = buildLiveRuntimeDoctorReport({
    action: "doctor",
    repoRoot,
    expectedCommit,
    profilePath,
    activationReceiptPath,
  });
  const prepared = prepareLiveSupervision({
    report,
    profile,
    expectedCommit,
    systemEnvironment,
  });
  const freshActivation = inspectLiveActivationReceipt({
    profile,
    expectedCommit,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
    receiptPath:
      activationReceiptPath || profile.activation_receipt_path,
  });
  if (
    freshActivation.valid !== true ||
    freshActivation.receipt_sha256 !==
      prepared.activation_receipt_sha256
  ) {
    throw new Error("exact_live_activation_receipt_required");
  }
  const startOperation = inspectLiveStartOperationLock({
    profile,
    expectedCommit,
    activationReceiptSha256:
      freshActivation.receipt_sha256,
  });
  if (startOperation.present && startOperation.valid !== true) {
    throw new Error(
      `live_start_operation_lock_invalid:${(
        startOperation.blockers || []
      ).join(",")}`,
    );
  }
  const listeners = listenerInspector({ port: profile.port });
  if (
    listeners?.available !== true ||
    !Array.isArray(listeners.listeningPids) ||
    listeners.listeningPids.length !== 0
  ) {
    throw new Error("live_supervisor_port_not_free");
  }

  const ownerPath = path.join(
    profile.state_root,
    "supervisor-owner.json",
  );
  if (fs.existsSync(ownerPath)) {
    let staleOwner = null;
    try {
      staleOwner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    } catch {
      throw new Error("live_supervisor_owner_receipt_invalid");
    }
    if (
      staleOwner?.profile_sha256 !== profileFingerprint(profile) ||
      staleOwner?.commit_sha !== String(expectedCommit).toLowerCase() ||
      staleOwner?.activation_receipt_sha256 !==
        report.checks.activation.receipt_sha256
    ) {
      throw new Error("live_supervisor_owner_receipt_mismatch");
    }
    if (processAppearsAlive(staleOwner.child_pid, killImpl)) {
      throw new Error("live_supervisor_previous_child_still_running");
    }
    const archivedPath = path.join(
      profile.state_root,
      "evidence",
      `${new Date().toISOString().replace(/[:.]/g, "-")}` +
        `-stale-supervisor-owner-${staleOwner.child_pid}.json`,
    );
    fs.mkdirSync(path.dirname(archivedPath), { recursive: true });
    fs.renameSync(ownerPath, archivedPath);
  }

  const logRoot = path.join(profile.state_root, "logs");
  fs.mkdirSync(logRoot, { recursive: true });
  const stdoutPath = path.join(logRoot, "runtime.stdout.log");
  const stderrPath = path.join(logRoot, "runtime.stderr.log");
  const stdoutFd = fs.openSync(stdoutPath, "a");
  const stderrFd = fs.openSync(stderrPath, "a");
  let child;
  try {
    child = spawnImpl(process.execPath, ["server.js"], {
      cwd: path.resolve(repoRoot),
      env: prepared.runtime_environment,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  if (!child?.pid) {
    throw new Error("live_runtime_process_start_failed");
  }
  const health = await waitForLiveHealth({
    port: profile.port,
    expectedCommit,
    healthRequester,
  });
  if (!health) {
    try {
      child.kill("SIGTERM");
    } catch {
      // It may already have exited.
    }
    throw new Error("live_runtime_health_verification_failed");
  }

  writeJsonAtomic(ownerPath, {
    schema_version: "pulse-windows-live-guarded-owner-v1",
    generated_at: new Date().toISOString(),
    supervisor_pid: process.pid,
    child_pid: Number(child.pid),
    port: profile.port,
    repo_root: normaliseWindowsPath(path.resolve(repoRoot)),
    commit_sha: String(expectedCommit).toLowerCase(),
    profile_sha256: profileFingerprint(profile),
    activation_receipt_sha256:
      report.checks.activation.receipt_sha256,
    start_operation_nonce:
      startOperation.operation_nonce || null,
    platform: "youtube",
  });
  writeLiveLifecycleReceipt({
    profile,
    action: "supervise-start",
    expectedCommit,
    details: {
      supervisor_pid: process.pid,
      child_pid: Number(child.pid),
      owner_receipt_path: normaliseWindowsPath(ownerPath),
      activation_receipt_sha256:
        report.checks.activation.receipt_sha256,
      start_operation_nonce:
        startOperation.operation_nonce || null,
    },
  });
  return {
    child,
    ownerPath,
    profile,
    repoRoot,
    expectedCommit,
    activationReceiptPath,
    healthRequester,
    monitorIntervalMs,
    writeExitReceiptImpl(details) {
      writeLiveLifecycleReceipt({
        profile,
        action: "supervise-exit",
        expectedCommit,
        details,
      });
    },
    terminationGraceMs,
  };
}

async function runLiveSupervision({
  repoRoot,
  expectedCommit,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  activationReceiptPath = null,
  systemEnvironment = process.env,
  spawnImpl = spawn,
  listenerInspector = inspectWindowsListeners,
  healthRequester = requestLocalHealth,
  killImpl = process.kill.bind(process),
  monitorIntervalMs = 15_000,
  restartDelayMs = 15_000,
  delayImpl = delay,
  terminationGraceMs = 5_000,
  maxRestartGenerations = 3,
  signalEmitter = process,
} = {}) {
  return runLiveSupervisionLifecycle({
    signalEmitter,
    restartDelayMs,
    delayImpl,
    maxRestartGenerations,
    startGenerationImpl: () =>
      startLiveSupervisionGeneration({
        repoRoot,
        expectedCommit,
        profilePath,
        activationReceiptPath,
        systemEnvironment,
        spawnImpl,
        listenerInspector,
        healthRequester,
        killImpl,
        monitorIntervalMs,
        terminationGraceMs,
      }),
  });
}

async function executeLiveLifecycleAction({
  report,
  profile,
  options = {},
  handlers = {},
} = {}) {
  const effect =
    report?.decision?.planned_effect || report?.action || "unknown";
  if (
    report?.decision?.mutation_authorised !== true ||
    effect === "no_op_already_current"
  ) {
    return {
      executed: false,
      effect,
      reason:
        effect === "no_op_already_current"
          ? "already_current"
          : "dry_run_or_blocked",
    };
  }
  const handler = handlers[report.action];
  if (typeof handler !== "function") {
    throw new Error(
      `live_lifecycle_handler_unavailable:${report.action}`,
    );
  }
  const result = await handler({ report, profile, options });
  return {
    executed: true,
    effect,
    result: result || null,
  };
}

function validateLiveGuardedRuntimeProfile(profile) {
  const blockers = [];
  if (profile?.schema_version !== LIVE_PROFILE_SCHEMA) {
    blockers.push("profile_schema_invalid");
  }
  if (profile?.profile_id !== LIVE_PROFILE_ID) {
    blockers.push("profile_identity_invalid");
  }
  if (profile?.runtime_owner_id !== LIVE_RUNTIME_OWNER_ID) {
    blockers.push("runtime_owner_invalid");
  }
  if (profile?.task_name !== LIVE_TASK_NAME) {
    blockers.push("task_name_invalid");
  }
  if (
    !Array.isArray(profile?.conflicting_task_names) ||
    profile.conflicting_task_names.length !== 1 ||
    profile.conflicting_task_names[0] !==
      "PulseGaming-Stabilisation-Runtime"
  ) {
    blockers.push("conflicting_task_contract_invalid");
  }
  if (profile?.expected_branch !== "release/pulse-v1") {
    blockers.push("expected_branch_invalid");
  }
  if (profile?.allow_detached_head !== true) {
    blockers.push("detached_exact_commit_not_allowed");
  }
  if (profile?.port !== 3001) blockers.push("port_must_be_3001");
  if (
    normaliseWindowsPath(profile?.database_path) !==
    "D:/pulse-data/pulse.db"
  ) {
    blockers.push("database_path_invalid");
  }
  if (
    normaliseWindowsPath(profile?.media_root) !==
    "D:/pulse-data/media"
  ) {
    blockers.push("media_root_invalid");
  }
  if (
    normaliseWindowsPath(profile?.state_root) !==
    "D:/pulse-data/runtime/pulse-live-guarded-youtube"
  ) {
    blockers.push("state_root_invalid");
  }
  if (
    normaliseWindowsPath(profile?.activation_receipt_path) !==
    "D:/pulse-data/runtime/pulse-live-guarded-youtube/" +
      "activation-receipt.json"
  ) {
    blockers.push("activation_receipt_path_invalid");
  }
  if (
    profile?.platform_policy?.primary !== "youtube" ||
    profile?.platform_policy?.secondary_automation_frozen !== true ||
    profile?.platform_policy?.control_tower_required !== true ||
    profile?.platform_policy?.fresh_control_required_per_release !== true ||
    profile?.platform_policy
      ?.oauth_client_sha256_bound_to_activation !== true
  ) {
    blockers.push("youtube_only_control_policy_invalid");
  }

  const environment =
    profile?.environment &&
    typeof profile.environment === "object" &&
    !Array.isArray(profile.environment)
      ? profile.environment
      : {};
  for (const [key, expected] of Object.entries(
    LIVE_REQUIRED_ENVIRONMENT,
  )) {
    if (environment[key] !== expected) {
      blockers.push(`unsafe_environment:${key}`);
    }
  }
  for (const key of Object.keys(environment)) {
    if (
      !Object.prototype.hasOwnProperty.call(
        LIVE_REQUIRED_ENVIRONMENT,
        key,
      )
    ) {
      blockers.push(`unreviewed_environment:${key}`);
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      blockers.push(`secret_material_forbidden:${key}`);
    }
  }
  return {
    valid: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}

module.exports = {
  DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  LIVE_ACTIVATION_DECISION,
  LIVE_ACTIVATION_SCHEMA,
  LIVE_LIFECYCLE_ACTIONS,
  LIVE_LIFECYCLE_CONFIRMATION,
  LIVE_PROFILE_ID,
  LIVE_PROFILE_SCHEMA,
  LIVE_REQUIRED_ENVIRONMENT,
  LIVE_RUNTIME_OWNER_ID,
  LIVE_TASK_NAME,
  buildLiveActivationReceipt,
  buildLiveChildEnvironment,
  buildLiveLifecycleDecision,
  buildLiveScheduledTaskCommand,
  buildLiveScheduledTaskXml,
  buildLiveRuntimeDoctorReport,
  buildMigrationManifest,
  acquireLiveStartOperationLock,
  archiveExactStaleLiveOwner,
  createDefaultLiveLifecycleHandlers,
  executeLiveLifecycleAction,
  inspectLiveActivationReceipt,
  inspectLiveStartOperationLock,
  inspectStoppedLiveRuntime,
  inspectLiveTaskConflicts,
  inspectLiveWindowsTask,
  installLiveScheduledTask,
  issueLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile,
  prepareLiveSupervision,
  receiptFingerprint,
  releaseLiveStartOperationLock,
  safeLiveHealthIdentity,
  superviseLiveChildSession,
  runLiveSupervisionLifecycle,
  runLiveSupervision,
  revokeLiveActivationReceipt,
  setLiveScheduledTaskEnabled,
  startLiveScheduledTask,
  uninstallLiveScheduledTask,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
};
