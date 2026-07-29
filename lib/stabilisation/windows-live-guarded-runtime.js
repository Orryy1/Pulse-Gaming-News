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
const LIVE_LIFECYCLE_ACTIONS = Object.freeze([
  "plan",
  "doctor",
  "issue-activation",
  "revoke-activation",
  "install",
  "enable",
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
    /<RestartOnFailure>[\s\S]*<Interval>PT1M<\/Interval>[\s\S]*<Count>999<\/Count>[\s\S]*<\/RestartOnFailure>/i.test(
      settings,
    ),
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
  execFileSyncImpl = execFileSync,
} = {}) {
  const names = Array.isArray(profile?.conflicting_task_names)
    ? profile.conflicting_task_names
    : [];
  if (process.platform !== "win32") {
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
      return { task_name: taskName, state: "absent" };
    }
  });
  const active = tasks.filter((entry) => entry.state === "enabled");
  return {
    clear: active.length === 0,
    tasks,
    blockers: active.length
      ? ["conflicting_runtime_task_enabled"]
      : [],
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
  if (selected === "enable") {
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
  });
  const bootProfileReady =
    profileValidation.valid &&
    checkout.ready === true &&
    database.ready === true &&
    activation.valid === true &&
    task.state === "managed_current" &&
    conflicts.clear === true;
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
      control_policy: {
        kill_switch_healthy_required: true,
        fresh_green_control_tower_required_per_release: true,
        durable_release_commitment:
          "youtube_remote_publishAt",
      },
    },
    verdict: bootProfileReady ? "READY" : "HOLD",
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
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let healthFailures = 0;
    let terminationReason = null;
    const cleanup = () => {
      clearInterval(monitor);
      process.off("SIGTERM", onTerminate);
      process.off("SIGINT", onTerminate);
      fs.rmSync(ownerPath, { force: true });
    };
    const terminateChild = (reason) => {
      if (terminationReason) return;
      terminationReason = reason;
      try {
        child.kill("SIGTERM");
      } catch {
        // Child-exit handling below remains authoritative.
      }
    };
    const onTerminate = () => {
      terminateChild("supervisor_shutdown");
    };
    const monitor = setInterval(async () => {
      if (settled) return;
      const activation = inspectLiveActivationReceipt({
        profile,
        expectedCommit,
        migrationsDir: path.join(repoRoot, "db", "migrations"),
        receiptPath:
          activationReceiptPath || profile.activation_receipt_path,
      });
      if (activation.valid !== true) {
        terminateChild(
          `activation_revoked:${activation.blockers.join(",")}`,
        );
        return;
      }
      const currentHealth = await healthRequester({
        port: profile.port,
      });
      if (safeLiveHealthIdentity(currentHealth, expectedCommit)) {
        healthFailures = 0;
      } else {
        healthFailures += 1;
        if (healthFailures >= 3) {
          terminateChild("live_runtime_health_lost");
        }
      }
    }, monitorIntervalMs);
    monitor.unref?.();
    process.on("SIGTERM", onTerminate);
    process.on("SIGINT", onTerminate);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      writeLiveLifecycleReceipt({
        profile,
        action: "supervise-exit",
        expectedCommit,
        details: {
          child_pid: Number(child.pid),
          exit_code: code,
          signal,
          reason: terminationReason || "unexpected_child_exit",
        },
      });
      if (terminationReason === "supervisor_shutdown" && code === 0) {
        resolve({
          outcome: "stopped",
          child_pid: Number(child.pid),
        });
      } else {
        reject(
          new Error(
            terminationReason ||
              `live_runtime_exited:${code ?? "signal"}:${signal || ""}`,
          ),
        );
      }
    });
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
  createDefaultLiveLifecycleHandlers,
  executeLiveLifecycleAction,
  inspectLiveActivationReceipt,
  inspectLiveTaskConflicts,
  inspectLiveWindowsTask,
  installLiveScheduledTask,
  issueLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile,
  prepareLiveSupervision,
  receiptFingerprint,
  safeLiveHealthIdentity,
  runLiveSupervision,
  revokeLiveActivationReceipt,
  setLiveScheduledTaskEnabled,
  uninstallLiveScheduledTask,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
};
