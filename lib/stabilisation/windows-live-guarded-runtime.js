"use strict";

const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
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
const {
  acquireLiveRuntimeTransitionLease,
  borrowLiveRuntimeTransitionLease,
} = require("./live-runtime-transition-lease");
const {
  commandArgumentsSha256,
  inspectWindowsProcessIdentity,
} = require("./windows-process-identity");
const {
  compareStableAuthorityObservations,
  inspectCurrentWindowsJobMembership,
  inspectExactWindowsTaskInstances,
  inspectWindowsAuthorityProcess,
  observeBoundedWindowsAuthority,
} = require("./windows-task-authority");

const DEFAULT_LIVE_GUARDED_PROFILE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "config",
  "windows-local-runtime.live-guarded-youtube.json",
);

const LIVE_PROFILE_SCHEMA = "pulse-windows-live-guarded-runtime-profile-v1";
const LIVE_PROFILE_ID = "pulse-v1-governed-multi-lane-live-guarded-youtube";
const LIVE_RUNTIME_OWNER_ID = "pulse-v1-windows-live-guarded-youtube-primary";
const LIVE_TASK_NAME = "PulseGaming-LiveGuarded-YouTube-Runtime";
const LIVE_ACTIVATION_SCHEMA =
  "pulse-windows-live-guarded-activation-receipt-v2";
const LIVE_ACTIVATION_DECISION = "LIVE_GUARDED_YOUTUBE_ACTIVATION_APPROVED";
const LIVE_LIFECYCLE_CONFIRMATION = "LIVE_GUARDED_YOUTUBE_SYSTEM_RUNTIME";
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
const YOUTUBE_OAUTH_CLIENT_SHA256_ENV = "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1";
const LIVE_OWNER_SCHEMA = "pulse-windows-live-guarded-owner-v2";

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
  PULSE_STATE_ROOT: "D:/pulse-data/runtime/pulse-live-guarded-youtube",
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
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex");
}

function executePowerShellJson({
  script,
  execFileSyncImpl = execFileSync,
} = {}) {
  return String(
    execFileSyncImpl(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  ).trim();
}

function canonicalPath(value) {
  const supplied = String(value || "").trim();
  if (!supplied) return "";
  return normaliseWindowsPath(path.win32.normalize(supplied));
}

function inspectLiveDatabaseIdentity({
  databasePath,
  realpathSync = fs.realpathSync.native,
  lstatSync = fs.lstatSync,
  statSync = fs.statSync,
} = {}) {
  const resolvedPath = path.resolve(String(databasePath || ""));
  const linkStats = lstatSync(resolvedPath, { bigint: true });
  if (
    linkStats.isSymbolicLink() ||
    !linkStats.isFile() ||
    linkStats.nlink !== 1n
  ) {
    throw new Error("live_database_identity_link_forbidden");
  }
  const realPath = realpathSync(resolvedPath);
  if (
    canonicalPath(realPath).toLowerCase() !==
    canonicalPath(resolvedPath).toLowerCase()
  ) {
    throw new Error("live_database_identity_link_forbidden");
  }
  const fileStats = statSync(realPath, { bigint: true });
  if (
    !fileStats.isFile() ||
    fileStats.nlink !== 1n ||
    typeof fileStats.dev !== "bigint" ||
    typeof fileStats.ino !== "bigint"
  ) {
    throw new Error("live_database_identity_invalid");
  }
  const identity = {
    canonical_real_path: canonicalPath(realPath),
    device_id: fileStats.dev.toString(10),
    file_id: fileStats.ino.toString(10),
  };
  return {
    ...identity,
    database_identity_sha256: sha256(stableJson(identity)),
  };
}

function samePhysicalFileStats(left, right) {
  return (
    left?.isFile() === true &&
    right?.isFile() === true &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function inspectLiveProfileFileIdentity({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
} = {}) {
  const resolvedPath = path.resolve(String(profilePath || ""));
  let linkStats;
  let realPath;
  let beforeStats;
  let afterStats;
  let bytes;
  try {
    linkStats = fs.lstatSync(resolvedPath, { bigint: true });
    realPath = fs.realpathSync.native(resolvedPath);
    beforeStats = fs.statSync(realPath, { bigint: true });
    bytes = fs.readFileSync(realPath);
    afterStats = fs.statSync(realPath, { bigint: true });
  } catch {
    throw new Error("live_transition_profile_identity_invalid");
  }
  if (
    linkStats.isSymbolicLink() ||
    !linkStats.isFile() ||
    linkStats.nlink !== 1n ||
    canonicalPath(realPath).toLowerCase() !==
      canonicalPath(resolvedPath).toLowerCase() ||
    !samePhysicalFileStats(beforeStats, afterStats)
  ) {
    throw new Error("live_transition_profile_identity_invalid");
  }
  let measuredProfile;
  try {
    measuredProfile = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("live_transition_profile_identity_invalid");
  }
  const operativeProfileSha256 = profileFingerprint(profile);
  const measuredProfileSha256 = profileFingerprint(measuredProfile);
  if (measuredProfileSha256 !== operativeProfileSha256) {
    throw new Error("live_transition_profile_identity_invalid");
  }
  const identity = {
    canonical_real_path: canonicalPath(realPath),
    device_id: afterStats.dev.toString(10),
    file_id: afterStats.ino.toString(10),
    file_sha256: sha256(bytes),
    profile_sha256: measuredProfileSha256,
  };
  return {
    ...identity,
    profile_identity_sha256: sha256(stableJson(identity)),
  };
}

function inspectLiveCheckoutIdentity({ repoRoot } = {}) {
  const resolvedPath = path.resolve(String(repoRoot || ""));
  let linkStats;
  let realPath;
  let fileStats;
  try {
    linkStats = fs.lstatSync(resolvedPath, { bigint: true });
    realPath = fs.realpathSync.native(resolvedPath);
    fileStats = fs.statSync(realPath, { bigint: true });
  } catch {
    throw new Error("live_transition_checkout_identity_invalid");
  }
  if (
    linkStats.isSymbolicLink() ||
    !linkStats.isDirectory() ||
    !fileStats.isDirectory() ||
    canonicalPath(realPath).toLowerCase() !==
      canonicalPath(resolvedPath).toLowerCase() ||
    typeof fileStats.dev !== "bigint" ||
    typeof fileStats.ino !== "bigint"
  ) {
    throw new Error("live_transition_checkout_identity_invalid");
  }
  const identity = {
    canonical_real_path: canonicalPath(realPath),
    device_id: fileStats.dev.toString(10),
    file_id: fileStats.ino.toString(10),
  };
  return {
    ...identity,
    checkout_identity_sha256: sha256(stableJson(identity)),
  };
}

function buildLiveTaskAuthorityBinding(expected = {}) {
  return Object.freeze({
    task_name: expected.taskName,
    node_path: canonicalPath(expected.nodePath),
    checkout_real_path: canonicalPath(expected.checkoutRealPath),
    release_sha: expected.releaseSha,
    profile_sha256: expected.profileSha256,
    database_identity_sha256: expected.databaseIdentitySha256,
  });
}

function boundedAuthorityHold(blockers, values = {}) {
  const runtimeInstanceId = validRuntimeInstanceId(values.runtime_instance_id)
    ? values.runtime_instance_id
    : null;
  return {
    schema: BOUNDED_AUTHORITY_SCHEMA,
    verdict: "HOLD",
    state: "HOLD",
    authority_fingerprint: values.authority_fingerprint || null,
    runtime_instance_id: runtimeInstanceId,
    observation_sha256: null,
    blockers: [...new Set(blockers)],
  };
}

function expectedAuthorityValue(expected, camelName, snakeName) {
  return expected?.[camelName] ?? expected?.[snakeName];
}

function validRuntimeInstanceId(value) {
  return (
    typeof value === "string" &&
    /^ri-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
  );
}

function validateStaticAuthorityBinding(binding) {
  return (
    binding?.task_name === LIVE_TASK_NAME &&
    path.win32.isAbsolute(String(binding?.node_path || "")) &&
    path.win32.isAbsolute(String(binding?.checkout_real_path || "")) &&
    /^[a-f0-9]{40,64}$/.test(String(binding?.release_sha || "")) &&
    SHA256_PATTERN.test(String(binding?.profile_sha256 || "")) &&
    SHA256_PATTERN.test(String(binding?.database_identity_sha256 || ""))
  );
}

function validateExpectedLiveAuthority(expected) {
  const taskInstanceGuid = expectedAuthorityValue(
    expected,
    "taskInstanceGuid",
    "task_instance_guid",
  );
  const supervisorPid = expectedAuthorityValue(
    expected,
    "supervisorPid",
    "supervisor_pid",
  );
  const childPid = expectedAuthorityValue(expected, "childPid", "child_pid");
  const supervisorCreatedAt = expectedAuthorityValue(
    expected,
    "supervisorCreationTimeUtc",
    "supervisor_creation_time_utc",
  );
  const childCreatedAt = expectedAuthorityValue(
    expected,
    "childCreationTimeUtc",
    "child_creation_time_utc",
  );
  const supervisorExecutablePath = canonicalPath(
    expectedAuthorityValue(
      expected,
      "supervisorExecutablePath",
      "supervisor_executable_path",
    ),
  );
  const childExecutablePath = canonicalPath(
    expectedAuthorityValue(
      expected,
      "childExecutablePath",
      "child_executable_path",
    ),
  );
  return (
    validTaskInstanceGuid(taskInstanceGuid) &&
    Number.isInteger(supervisorPid) &&
    supervisorPid > 0 &&
    Number.isInteger(childPid) &&
    childPid > 0 &&
    childPid !== supervisorPid &&
    normaliseProcessStartedAt(supervisorCreatedAt) === supervisorCreatedAt &&
    normaliseProcessStartedAt(childCreatedAt) === childCreatedAt &&
    validAbsoluteWindowsPath(supervisorExecutablePath) &&
    validAbsoluteWindowsPath(childExecutablePath) &&
    SHA256_PATTERN.test(
      String(
        expectedAuthorityValue(
          expected,
          "supervisorCommandSha256",
          "supervisor_command_sha256",
        ) || "",
      ),
    ) &&
    SHA256_PATTERN.test(
      String(
        expectedAuthorityValue(
          expected,
          "childCommandSha256",
          "child_command_sha256",
        ) || "",
      ),
    )
  );
}

function validTaskInstanceGuid(value) {
  return /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|\{[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\})$/i.test(
    String(value || ""),
  );
}

function validPositivePid(value) {
  return Number.isInteger(value) && value > 0;
}

function validCanonicalTimestamp(value) {
  return normaliseProcessStartedAt(value) === value;
}

function validAbsoluteWindowsPath(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    path.win32.isAbsolute(canonicalPath(value))
  );
}

function hasNoBlockers(value, { optional = false } = {}) {
  if (value?.blockers === undefined && optional) return true;
  return Array.isArray(value?.blockers) && value.blockers.length === 0;
}

function expectedConfiguredConflictNames(expected) {
  const names = expectedAuthorityValue(
    expected,
    "conflictingTaskNames",
    "conflicting_task_names",
  );
  return Array.isArray(names) ? names : [];
}

function validateConfiguredConflictEvidence(conflicts, expected) {
  const configured = expectedConfiguredConflictNames(expected);
  if (
    configured.length === 0 ||
    configured.some(
      (name) =>
        typeof name !== "string" || !name.trim() || name !== name.trim(),
    ) ||
    new Set(configured).size !== configured.length ||
    conflicts?.clear !== true ||
    !hasNoBlockers(conflicts) ||
    !Array.isArray(conflicts?.tasks) ||
    conflicts.tasks.length !== configured.length
  ) {
    return false;
  }
  const observedNames = conflicts.tasks.map((entry) => entry?.task_name);
  return (
    new Set(observedNames).size === observedNames.length &&
    configured.every((name) => observedNames.includes(name)) &&
    conflicts.tasks.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        configured.includes(entry.task_name) &&
        ["absent", "disabled"].includes(entry.state),
    )
  );
}

function validateLiveOwnerAuthorityEvidence(owner) {
  return (
    owner &&
    typeof owner === "object" &&
    validTaskInstanceGuid(owner.task_instance_guid) &&
    validPositivePid(owner.engine_pid) &&
    validPositivePid(owner.supervisor_pid) &&
    validCanonicalTimestamp(owner.supervisor_creation_time_utc) &&
    validAbsoluteWindowsPath(owner.supervisor_executable_path) &&
    SHA256_PATTERN.test(String(owner.supervisor_command_sha256 || "")) &&
    validPositivePid(owner.child_pid) &&
    validCanonicalTimestamp(owner.child_creation_time_utc) &&
    validPositivePid(owner.child_parent_pid) &&
    validAbsoluteWindowsPath(owner.child_executable_path) &&
    SHA256_PATTERN.test(String(owner.child_command_sha256 || "")) &&
    owner.child_in_job === true &&
    Number.isInteger(owner.listener_port) &&
    owner.listener_port === 3001 &&
    validPositivePid(owner.listener_pid) &&
    Array.isArray(owner.blockers)
  );
}

function validateExactStaleOwnerV2Authority({
  owner,
  profile,
  repoRoot,
  expectedCommit,
  activation,
  reviewedProcessAuthority,
} = {}) {
  const binding = activation?.authority_binding;
  const commit = String(expectedCommit || "").toLowerCase();
  return (
    activation?.valid === true &&
    validateStaticAuthorityBinding(binding) &&
    owner?.schema_version === LIVE_OWNER_SCHEMA &&
    validRuntimeInstanceId(owner.runtime_instance_id) &&
    owner.runtime_instance_id === activation.runtime_instance_id &&
    owner.task_name === profile?.task_name &&
    validateLiveOwnerAuthorityEvidence(owner) &&
    hasNoBlockers(owner) &&
    owner.engine_pid === owner.supervisor_pid &&
    owner.child_parent_pid === owner.supervisor_pid &&
    owner.listener_port === profile?.port &&
    owner.listener_pid === owner.child_pid &&
    owner.port === profile?.port &&
    owner.supervisor_process_started_at ===
      owner.supervisor_creation_time_utc &&
    owner.child_process_started_at === owner.child_creation_time_utc &&
    canonicalPath(owner.repo_root).toLowerCase() ===
      canonicalPath(path.resolve(repoRoot)).toLowerCase() &&
    owner.commit_sha === commit &&
    owner.release_sha === commit &&
    owner.profile_sha256 === profileFingerprint(profile) &&
    owner.database_identity_sha256 === binding.database_identity_sha256 &&
    stableJson(owner.authority_binding) === stableJson(binding) &&
    owner.authority_fingerprint === activation.authority_fingerprint &&
    owner.authority_fingerprint === sha256(stableJson(binding)) &&
    owner.activation_receipt_sha256 === activation.receipt_sha256 &&
    owner.platform === "youtube" &&
    reviewedProcessAuthority &&
    validAbsoluteWindowsPath(
      reviewedProcessAuthority.expectedSupervisorExecutablePath,
    ) &&
    canonicalPath(owner.supervisor_executable_path).toLowerCase() ===
      canonicalPath(
        reviewedProcessAuthority.expectedSupervisorExecutablePath,
      ).toLowerCase() &&
    SHA256_PATTERN.test(
      String(reviewedProcessAuthority.expectedSupervisorCommandSha256 || ""),
    ) &&
    owner.supervisor_command_sha256 ===
      reviewedProcessAuthority.expectedSupervisorCommandSha256 &&
    validAbsoluteWindowsPath(
      reviewedProcessAuthority.expectedChildExecutablePath,
    ) &&
    canonicalPath(owner.child_executable_path).toLowerCase() ===
      canonicalPath(
        reviewedProcessAuthority.expectedChildExecutablePath,
      ).toLowerCase() &&
    SHA256_PATTERN.test(
      String(reviewedProcessAuthority.expectedChildCommandSha256 || ""),
    ) &&
    owner.child_command_sha256 ===
      reviewedProcessAuthority.expectedChildCommandSha256
  );
}

function validateObservedLiveAuthorityEvidence(authority) {
  const supervisorPid = authority?.supervisor?.pid;
  const childPid = authority?.child?.pid;
  const processIds = authority?.job_membership?.process_ids;
  return (
    authority &&
    typeof authority === "object" &&
    authority.ok === true &&
    authority.task_name === LIVE_TASK_NAME &&
    hasNoBlockers(authority) &&
    validTaskInstanceGuid(authority?.task_instance?.instance_guid) &&
    validPositivePid(authority?.task_instance?.engine_pid) &&
    authority?.task_instance?.state === 4 &&
    authority?.supervisor?.ok === true &&
    validPositivePid(supervisorPid) &&
    validCanonicalTimestamp(authority?.supervisor?.creation_time_utc) &&
    validAbsoluteWindowsPath(authority?.supervisor?.executable_path) &&
    SHA256_PATTERN.test(String(authority?.supervisor?.command_sha256 || "")) &&
    hasNoBlockers(authority?.supervisor) &&
    authority?.child?.ok === true &&
    validPositivePid(childPid) &&
    validPositivePid(authority?.child?.parent_pid) &&
    validCanonicalTimestamp(authority?.child?.creation_time_utc) &&
    validAbsoluteWindowsPath(authority?.child?.executable_path) &&
    SHA256_PATTERN.test(String(authority?.child?.command_sha256 || "")) &&
    hasNoBlockers(authority?.child) &&
    Array.isArray(processIds) &&
    processIds.every(validPositivePid) &&
    processIds.includes(supervisorPid) &&
    processIds.includes(childPid) &&
    hasNoBlockers(authority?.job_membership) &&
    authority?.job_membership?.child_present === true
  );
}

function validateGovernedStaleOwnerEvidence(
  owner,
  binding,
  authorityFingerprint,
  expected,
) {
  return (
    owner?.state === "governed_stale" &&
    owner?.schema_version === LIVE_OWNER_SCHEMA &&
    validRuntimeInstanceId(owner?.runtime_instance_id) &&
    owner?.task_name === binding.task_name &&
    validateLiveOwnerAuthorityEvidence(owner) &&
    stableJson(owner?.authority_binding) === stableJson(binding) &&
    owner?.authority_fingerprint === authorityFingerprint &&
    owner?.release_sha === binding.release_sha &&
    owner?.profile_sha256 === binding.profile_sha256 &&
    owner?.database_identity_sha256 === binding.database_identity_sha256 &&
    canonicalPath(owner?.supervisor_executable_path).toLowerCase() ===
      canonicalPath(
        expectedAuthorityValue(
          expected,
          "supervisorExecutablePath",
          "supervisor_executable_path",
        ),
      ).toLowerCase() &&
    owner?.supervisor_command_sha256 ===
      expectedAuthorityValue(
        expected,
        "supervisorCommandSha256",
        "supervisor_command_sha256",
      ) &&
    canonicalPath(owner?.child_executable_path).toLowerCase() ===
      canonicalPath(
        expectedAuthorityValue(
          expected,
          "childExecutablePath",
          "child_executable_path",
        ),
      ).toLowerCase() &&
    owner?.child_command_sha256 ===
      expectedAuthorityValue(
        expected,
        "childCommandSha256",
        "child_command_sha256",
      ) &&
    owner?.archived === true &&
    owner?.archive_policy_applied === true &&
    SHA256_PATTERN.test(String(owner?.archive_receipt_sha256 || ""))
  );
}

async function inspectLiveBoundedAuthorityObservation({ expected, probes }) {
  const binding = buildLiveTaskAuthorityBinding(expected);
  const authorityFingerprint = sha256(stableJson(binding));
  const runtimeInstanceId = expectedAuthorityValue(
    expected,
    "runtimeInstanceId",
    "runtime_instance_id",
  );
  if (
    !validateStaticAuthorityBinding(binding) ||
    !validRuntimeInstanceId(runtimeInstanceId) ||
    !validateExpectedLiveAuthority(expected)
  ) {
    return {
      ok: false,
      authority_fingerprint: authorityFingerprint,
      runtime_instance_id: runtimeInstanceId || null,
      blockers: ["live_task_authority_expected_identity_invalid"],
    };
  }

  let taskDefinition;
  let conflicts;
  let activation;
  let owner;
  let authority;
  let listeners;
  let health;
  let database;
  try {
    taskDefinition = await probes.taskDefinitionInspector({ expected });
    conflicts = await probes.conflictInspector({ expected });
    activation = await probes.activationReceiptInspector({ expected });
    owner = await probes.ownerReceiptInspector({ expected });
    authority = await probes.authorityObserver({ expected });
    listeners = await probes.listenerInspector({ port: 3001 });
    health = await probes.healthRequester({ port: 3001 });
    const runningClaims =
      health?.multiLaneRuntime?.isolated_worker_pools || null;
    database = await probes.databaseAuthorityInspector({
      mode: "LIVE",
      expected: {
        runtime_instance_id: runtimeInstanceId,
        child_pid: Number(
          expectedAuthorityValue(expected, "childPid", "child_pid"),
        ),
        child_started_at: expectedAuthorityValue(
          expected,
          "childCreationTimeUtc",
          "child_creation_time_utc",
        ),
        authority_fingerprint: authorityFingerprint,
        database_identity_sha256: binding.database_identity_sha256,
        worker_topology: expectedAuthorityValue(
          expected,
          "workerTopology",
          "worker_topology",
        ),
        runtime_claim_set_count: Number.isSafeInteger(
          runningClaims?.active_claim_count,
        )
          ? runningClaims.active_claim_count
          : -1,
        runtime_claim_set_sha256: SHA256_PATTERN.test(
          String(runningClaims?.running_claim_set_sha256 || ""),
        )
          ? runningClaims.running_claim_set_sha256
          : null,
      },
    });
  } catch {
    return {
      ok: false,
      authority_fingerprint: authorityFingerprint,
      runtime_instance_id: runtimeInstanceId,
      blockers: ["bounded_authority_probe_failed"],
    };
  }

  const blockers = [];
  if (
    !validateLiveOwnerAuthorityEvidence(owner) ||
    !validateObservedLiveAuthorityEvidence(authority)
  ) {
    blockers.push("live_task_authority_evidence_malformed");
  }
  if (
    taskDefinition?.task_name !== binding.task_name ||
    taskDefinition?.state !== "managed_current" ||
    !hasNoBlockers(taskDefinition)
  ) {
    blockers.push("live_task_definition_mismatch");
  }
  if (!validateConfiguredConflictEvidence(conflicts, expected)) {
    blockers.push("live_conflicting_task_authority_untrusted");
  }
  if (
    activation?.valid !== true ||
    activation?.schema_version !== LIVE_ACTIVATION_SCHEMA ||
    activation?.runtime_instance_id !== runtimeInstanceId ||
    activation?.authority_fingerprint !== authorityFingerprint ||
    stableJson(activation?.authority_binding) !== stableJson(binding) ||
    !hasNoBlockers(activation)
  ) {
    blockers.push("live_activation_task_authority_mismatch");
  }
  if (
    owner?.valid !== true ||
    owner?.schema_version !== LIVE_OWNER_SCHEMA ||
    owner?.runtime_instance_id !== runtimeInstanceId ||
    owner?.authority_fingerprint !== authorityFingerprint ||
    stableJson(owner?.authority_binding) !== stableJson(binding) ||
    !hasNoBlockers(owner)
  ) {
    blockers.push("live_owner_task_authority_mismatch");
  }
  if (
    owner?.task_name !== binding.task_name ||
    owner?.task_instance_guid !== authority?.task_instance?.instance_guid ||
    Number(owner?.engine_pid) !==
      Number(authority?.task_instance?.engine_pid) ||
    Number(owner?.supervisor_pid) !== Number(authority?.supervisor?.pid) ||
    owner?.supervisor_creation_time_utc !==
      authority?.supervisor?.creation_time_utc ||
    Number(owner?.child_pid) !== Number(authority?.child?.pid) ||
    owner?.child_creation_time_utc !== authority?.child?.creation_time_utc ||
    Number(owner?.child_parent_pid) !== Number(authority?.child?.parent_pid) ||
    canonicalPath(owner?.supervisor_executable_path).toLowerCase() !==
      canonicalPath(authority?.supervisor?.executable_path).toLowerCase() ||
    owner?.supervisor_command_sha256 !==
      authority?.supervisor?.command_sha256 ||
    canonicalPath(owner?.child_executable_path).toLowerCase() !==
      canonicalPath(authority?.child?.executable_path).toLowerCase() ||
    owner?.child_command_sha256 !== authority?.child?.command_sha256 ||
    owner?.child_in_job !== true ||
    authority?.job_membership?.child_present !== true
  ) {
    blockers.push("live_task_instance_receipt_mismatch");
  }
  const expectedTaskInstanceGuid = expectedAuthorityValue(
    expected,
    "taskInstanceGuid",
    "task_instance_guid",
  );
  if (authority?.task_instance?.instance_guid !== expectedTaskInstanceGuid) {
    blockers.push("live_task_instance_receipt_mismatch");
  }
  const expectedSupervisorPid = Number(
    expectedAuthorityValue(expected, "supervisorPid", "supervisor_pid"),
  );
  const expectedChildPid = Number(
    expectedAuthorityValue(expected, "childPid", "child_pid"),
  );
  if (
    Number(authority?.task_instance?.engine_pid) !== expectedSupervisorPid ||
    Number(authority?.supervisor?.pid) !== expectedSupervisorPid ||
    authority?.supervisor?.creation_time_utc !==
      expectedAuthorityValue(
        expected,
        "supervisorCreationTimeUtc",
        "supervisor_creation_time_utc",
      ) ||
    canonicalPath(authority?.supervisor?.executable_path).toLowerCase() !==
      canonicalPath(
        expectedAuthorityValue(
          expected,
          "supervisorExecutablePath",
          "supervisor_executable_path",
        ),
      ).toLowerCase() ||
    authority?.supervisor?.command_sha256 !==
      expectedAuthorityValue(
        expected,
        "supervisorCommandSha256",
        "supervisor_command_sha256",
      ) ||
    Number(authority?.child?.pid) !== expectedChildPid ||
    authority?.child?.creation_time_utc !==
      expectedAuthorityValue(
        expected,
        "childCreationTimeUtc",
        "child_creation_time_utc",
      ) ||
    Number(authority?.child?.parent_pid) !== expectedSupervisorPid ||
    canonicalPath(authority?.child?.executable_path).toLowerCase() !==
      canonicalPath(
        expectedAuthorityValue(
          expected,
          "childExecutablePath",
          "child_executable_path",
        ),
      ).toLowerCase() ||
    authority?.child?.command_sha256 !==
      expectedAuthorityValue(
        expected,
        "childCommandSha256",
        "child_command_sha256",
      )
  ) {
    blockers.push("live_task_process_identity_mismatch");
  }
  if (authority?.ok !== true) {
    blockers.push("live_task_authority_mismatch");
  }
  const childPid = Number(
    expectedAuthorityValue(expected, "childPid", "child_pid"),
  );
  if (
    listeners?.available !== true ||
    !Array.isArray(listeners?.listeningPids) ||
    listeners.listeningPids.length !== 1 ||
    Number(listeners.listeningPids[0]) !== childPid ||
    Number(owner?.listener_port) !== 3001 ||
    Number(owner?.listener_pid) !== childPid ||
    !hasNoBlockers(listeners)
  ) {
    blockers.push("live_task_listener_mismatch");
  }
  if (
    !safeLiveHealthIdentity(health, binding.release_sha, {
      runtime_instance_id: runtimeInstanceId,
      worker_topology: expectedAuthorityValue(
        expected,
        "workerTopology",
        "worker_topology",
      ),
    }) ||
    !hasNoBlockers(health)
  ) {
    blockers.push("live_task_health_mismatch");
  }
  if (
    database?.ok !== true ||
    database?.database_identity_sha256 !== binding.database_identity_sha256 ||
    !SHA256_PATTERN.test(String(database?.snapshot_sha256 || "")) ||
    !hasNoBlockers(database)
  ) {
    blockers.push("live_database_authority_mismatch");
  }
  if (
    owner?.release_sha !== binding.release_sha ||
    owner?.profile_sha256 !== binding.profile_sha256 ||
    owner?.database_identity_sha256 !== binding.database_identity_sha256
  ) {
    blockers.push("live_owner_static_authority_mismatch");
  }

  return {
    ok: blockers.length === 0,
    authority_fingerprint: authorityFingerprint,
    runtime_instance_id: runtimeInstanceId,
    task_state: taskDefinition?.state || "unknown",
    task_instance_guid: authority?.task_instance?.instance_guid || null,
    supervisor_pid: Number(authority?.supervisor?.pid) || null,
    supervisor_creation_time_utc:
      authority?.supervisor?.creation_time_utc || null,
    child_pid: Number(authority?.child?.pid) || null,
    child_creation_time_utc: authority?.child?.creation_time_utc || null,
    listener_pid:
      listeners?.listeningPids?.length === 1
        ? Number(listeners.listeningPids[0])
        : null,
    database_identity_sha256: database?.database_identity_sha256 || null,
    database_snapshot_sha256: SHA256_PATTERN.test(
      String(database?.snapshot_sha256 || ""),
    )
      ? database.snapshot_sha256
      : null,
    blockers: [...new Set(blockers)],
  };
}

async function inspectQuiescentBoundedAuthorityObservation({
  expected,
  probes,
}) {
  const binding = buildLiveTaskAuthorityBinding(expected);
  const authorityFingerprint = sha256(stableJson(binding));
  if (!validateStaticAuthorityBinding(binding)) {
    return {
      ok: false,
      authority_fingerprint: authorityFingerprint,
      blockers: ["live_task_authority_expected_identity_invalid"],
    };
  }
  let taskDefinition;
  let taskInstances;
  let conflicts;
  let activation;
  let owner;
  let listeners;
  let database;
  try {
    taskDefinition = await probes.taskDefinitionInspector({ expected });
    taskInstances = await probes.taskInstancesInspector({
      taskName: binding.task_name,
    });
    conflicts = await probes.conflictInspector({ expected });
    activation = await probes.activationReceiptInspector({ expected });
    owner = await probes.ownerReceiptInspector({ expected });
    listeners = await probes.listenerInspector({ port: 3001 });
    database = await probes.databaseAuthorityInspector({
      mode: "QUIESCENT",
      expected: {
        authority_fingerprint: authorityFingerprint,
        database_identity_sha256: binding.database_identity_sha256,
      },
    });
  } catch {
    return {
      ok: false,
      authority_fingerprint: authorityFingerprint,
      blockers: ["bounded_authority_probe_failed"],
    };
  }
  const blockers = [];
  if (
    taskDefinition?.task_name !== binding.task_name ||
    !["absent", "managed_disabled"].includes(taskDefinition?.state)
  ) {
    blockers.push("quiescent_task_definition_not_disabled");
  }
  if (!hasNoBlockers(taskDefinition)) {
    blockers.push("quiescent_task_definition_untrusted");
  }
  if (
    taskInstances?.ok !== true ||
    !Array.isArray(taskInstances?.instances) ||
    taskInstances.instances.length !== 0 ||
    !hasNoBlockers(taskInstances)
  ) {
    blockers.push("quiescent_task_instance_present");
  }
  if (!validateConfiguredConflictEvidence(conflicts, expected)) {
    blockers.push("quiescent_conflicting_task_active");
  }
  if (activation?.present !== false) {
    blockers.push("quiescent_activation_receipt_present");
  }
  if (!hasNoBlockers(activation)) {
    blockers.push("quiescent_activation_receipt_untrusted");
  }
  if (
    owner?.state !== "absent" &&
    !validateGovernedStaleOwnerEvidence(
      owner,
      binding,
      authorityFingerprint,
      expected,
    )
  ) {
    blockers.push("quiescent_owner_receipt_not_governed_stale");
  }
  if (!hasNoBlockers(owner)) {
    blockers.push("quiescent_owner_receipt_untrusted");
  }
  if (
    listeners?.available !== true ||
    !Array.isArray(listeners?.listeningPids) ||
    listeners.listeningPids.length !== 0 ||
    !hasNoBlockers(listeners)
  ) {
    blockers.push("quiescent_listener_present");
  }
  if (
    database?.ok !== true ||
    database?.database_identity_sha256 !== binding.database_identity_sha256 ||
    !SHA256_PATTERN.test(String(database?.snapshot_sha256 || "")) ||
    !hasNoBlockers(database)
  ) {
    blockers.push("quiescent_database_authority_mismatch");
  }
  return {
    ok: blockers.length === 0,
    authority_fingerprint: authorityFingerprint,
    task_state: taskDefinition?.state || "unknown",
    task_instance_count: Array.isArray(taskInstances?.instances)
      ? taskInstances.instances.length
      : null,
    conflicts_clear: conflicts?.clear === true,
    activation_absent: activation?.present === false,
    owner_state: owner?.state || "unknown",
    listener_count: Array.isArray(listeners?.listeningPids)
      ? listeners.listeningPids.length
      : null,
    database_identity_sha256: database?.database_identity_sha256 || null,
    database_snapshot_sha256: SHA256_PATTERN.test(
      String(database?.snapshot_sha256 || ""),
    )
      ? database.snapshot_sha256
      : null,
    blockers: [...new Set(blockers)],
  };
}

async function inspectBoundedWindowsAuthority({
  mode,
  expected = {},
  probes = {},
} = {}) {
  const selectedMode = String(mode || "").toUpperCase();
  if (!["LIVE", "QUIESCENT"].includes(selectedMode)) {
    return boundedAuthorityHold(["bounded_authority_mode_invalid"]);
  }
  if (selectedMode === "QUIESCENT") {
    const resolvedProbes = {
      taskDefinitionInspector: probes.taskDefinitionInspector,
      taskInstancesInspector: probes.taskInstancesInspector,
      conflictInspector: probes.conflictInspector,
      activationReceiptInspector: probes.activationReceiptInspector,
      ownerReceiptInspector: probes.ownerReceiptInspector,
      listenerInspector:
        probes.listenerInspector ||
        (async (options) => {
          const result = await inspectWindowsListeners(options);
          return {
            ...result,
            blockers:
              result?.available === true
                ? []
                : ["windows_listener_inspection_unavailable"],
          };
        }),
      databaseAuthorityInspector: probes.databaseAuthorityInspector,
    };
    if (
      Object.values(resolvedProbes).some((probe) => typeof probe !== "function")
    ) {
      return boundedAuthorityHold(["bounded_authority_probe_unavailable"]);
    }
    const first = await inspectQuiescentBoundedAuthorityObservation({
      expected,
      probes: resolvedProbes,
    });
    const second = await inspectQuiescentBoundedAuthorityObservation({
      expected,
      probes: resolvedProbes,
    });
    const stable = compareStableAuthorityObservations(first, second);
    if (!stable.ok) {
      return boundedAuthorityHold(stable.blockers, second);
    }
    if (!second.ok) {
      return boundedAuthorityHold(second.blockers, second);
    }
    return {
      schema: BOUNDED_AUTHORITY_SCHEMA,
      verdict: "GREEN",
      state: "STOPPED_BOUND",
      authority_fingerprint: second.authority_fingerprint,
      runtime_instance_id: null,
      observation_sha256: stable.observation_sha256,
      database_snapshot_sha256: second.database_snapshot_sha256,
      blockers: [],
    };
  }
  const resolvedProbes = {
    taskDefinitionInspector: probes.taskDefinitionInspector,
    conflictInspector: probes.conflictInspector,
    activationReceiptInspector: probes.activationReceiptInspector,
    ownerReceiptInspector: probes.ownerReceiptInspector,
    authorityObserver:
      probes.authorityObserver ||
      ((options) => observeBoundedWindowsAuthority(options)),
    listenerInspector:
      probes.listenerInspector ||
      (async (options) => {
        const result = await inspectWindowsListeners(options);
        return {
          ...result,
          blockers:
            result?.available === true
              ? []
              : ["windows_listener_inspection_unavailable"],
        };
      }),
    healthRequester:
      probes.healthRequester ||
      (async (options) => ({
        ...(await requestLocalHealth(options)),
        blockers: [],
      })),
    databaseAuthorityInspector: probes.databaseAuthorityInspector,
  };
  if (
    Object.values(resolvedProbes).some((probe) => typeof probe !== "function")
  ) {
    return boundedAuthorityHold(["bounded_authority_probe_unavailable"]);
  }
  const first = await inspectLiveBoundedAuthorityObservation({
    expected,
    probes: resolvedProbes,
  });
  const second = await inspectLiveBoundedAuthorityObservation({
    expected,
    probes: resolvedProbes,
  });
  const stable = compareStableAuthorityObservations(first, second);
  if (!stable.ok) {
    return boundedAuthorityHold(stable.blockers, second);
  }
  if (!second.ok) {
    return boundedAuthorityHold(second.blockers, second);
  }
  return {
    schema: BOUNDED_AUTHORITY_SCHEMA,
    verdict: "GREEN",
    state: "ACTIVE_BOUND",
    authority_fingerprint: second.authority_fingerprint,
    runtime_instance_id: second.runtime_instance_id,
    observation_sha256: stable.observation_sha256,
    database_snapshot_sha256: second.database_snapshot_sha256,
    blockers: [],
  };
}

const SAFE_LIVE_START_FAILURE_CODES = new Set([
  "live_task_start_verification_failed",
  "post_launch_activation_receipt_drift",
  "post_launch_managed_task_identity_drift",
  "post_launch_runtime_identity_drift",
  "post_launch_start_operation_lock_drift",
]);
const SAFE_ACTIVATION_REVOCATION_BLOCKERS = new Set([
  "activation_receipt_commit_mismatch",
  "activation_receipt_control_policy_invalid",
  "activation_receipt_database_mismatch",
  "activation_receipt_decision_invalid",
  "activation_receipt_fingerprint_mismatch",
  "activation_receipt_invalid_json",
  "activation_receipt_migration_manifest_mismatch",
  "activation_receipt_missing",
  "activation_receipt_operator_missing",
  "activation_receipt_profile_mismatch",
  "activation_receipt_reason_missing",
  "activation_receipt_runtime_contract_invalid",
  "activation_receipt_schema_invalid",
  "activation_receipt_youtube_oauth_client_binding_invalid",
]);

function secretSafeLifecycleFailure(stage, error, { safeCodes = null } = {}) {
  const stageCode = String(stage || "").trim();
  if (!/^[a-z0-9_]+$/.test(stageCode)) {
    throw new Error("live_lifecycle_failure_stage_invalid");
  }
  const message = String(error?.message || error || "unknown_error");
  if (safeCodes?.has(message)) return message;
  return `${stageCode}:${sha256(
    `${String(error?.name || "Error")}:${String(error?.code || "")}:${message}`,
  )}`;
}

function secretSafeActivationRevocationReason(blockers) {
  const supplied = Array.isArray(blockers)
    ? blockers.map((blocker) => String(blocker || "").trim())
    : [];
  const allKnown =
    supplied.length > 0 &&
    supplied.every(
      (blocker) =>
        SAFE_ACTIVATION_REVOCATION_BLOCKERS.has(blocker) ||
        /^activation_receipt_migration_inspection_failed:[a-f0-9]{64}$/.test(
          blocker,
        ),
    );
  if (allKnown) return `activation_revoked:${supplied.join(",")}`;
  return secretSafeLifecycleFailure(
    "activation_revoked",
    new Error(stableJson(supplied)),
  );
}

function normaliseProcessStartedAt(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function inspectBoundProcessIdentity({
  pid,
  processStartedAt,
  processIdentityInspector = inspectWindowsProcessIdentity,
} = {}) {
  const processId = Number(pid);
  const expectedStartedAt = normaliseProcessStartedAt(processStartedAt);
  if (!Number.isInteger(processId) || processId <= 0 || !expectedStartedAt) {
    return { available: false, alive: null };
  }
  let inspected;
  try {
    inspected = processIdentityInspector({ pid: processId });
  } catch {
    return { available: false, alive: null };
  }
  if (
    inspected?.available !== true ||
    ![true, false].includes(inspected?.exists) ||
    Number(inspected?.process_id) !== processId
  ) {
    return { available: false, alive: null };
  }
  if (inspected.exists === false) {
    return { available: true, alive: false };
  }
  const actualStartedAt = normaliseProcessStartedAt(
    inspected.process_started_at,
  );
  if (!actualStartedAt) {
    return { available: false, alive: null };
  }
  return {
    available: true,
    alive: actualStartedAt === expectedStartedAt,
  };
}

function captureProcessIdentity({
  pid,
  processIdentityInspector = inspectWindowsProcessIdentity,
  unavailableCode = "windows_process_identity_unavailable",
} = {}) {
  const processId = Number(pid);
  let inspected;
  try {
    inspected = processIdentityInspector({ pid: processId });
  } catch {
    throw new Error(unavailableCode);
  }
  const processStartedAt = normaliseProcessStartedAt(
    inspected?.process_started_at,
  );
  if (
    inspected?.available !== true ||
    inspected?.exists !== true ||
    Number(inspected?.process_id) !== processId ||
    !Number.isInteger(processId) ||
    processId <= 0 ||
    !processStartedAt
  ) {
    throw new Error(unavailableCode);
  }
  return {
    process_id: processId,
    process_started_at: processStartedAt,
  };
}

function exactOwnerRecordFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    return sha256(stableJson(value));
  } catch {
    return null;
  }
}

function removeExactLiveSupervisorOwner({ ownerPath, ownerRecord } = {}) {
  const expectedFingerprint = exactOwnerRecordFingerprint(ownerRecord);
  if (!expectedFingerprint) {
    throw new Error("live_supervisor_owner_cleanup_mismatch");
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    throw new Error("live_supervisor_owner_cleanup_mismatch");
  }
  if (exactOwnerRecordFingerprint(current) !== expectedFingerprint) {
    throw new Error("live_supervisor_owner_cleanup_mismatch");
  }
  fs.unlinkSync(ownerPath);
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
  const normalised = String(value || "")
    .trim()
    .toLowerCase();
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
  runtimeInstanceId,
  nodePath,
  checkoutRealPath,
  databaseIdentitySha256,
  generatedAt = new Date().toISOString(),
} = {}) {
  const profileValidation = validateLiveGuardedRuntimeProfile(profile);
  if (!profileValidation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${profileValidation.blockers.join(",")}`,
    );
  }
  const commit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
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
  const expectedYoutubeOAuthClientSha256 = requireYoutubeOAuthClientSha256(
    youtubeOAuthClientSha256,
  );
  const authorityBinding = buildLiveTaskAuthorityBinding({
    taskName: profile.task_name,
    nodePath,
    checkoutRealPath,
    releaseSha: commit,
    profileSha256: profileFingerprint(profile),
    databaseIdentitySha256,
  });
  if (
    !validRuntimeInstanceId(runtimeInstanceId) ||
    !validateStaticAuthorityBinding(authorityBinding)
  ) {
    throw new Error("activation_task_authority_binding_invalid");
  }
  const taskDefinitionSha256 = buildLiveProcessCommandAuthority({
    profile,
    repoRoot: authorityBinding.checkout_real_path,
    expectedCommit: commit,
    nodeExecutable: authorityBinding.node_path,
  }).supervisor_command_sha256;
  const authorityFingerprint = sha256(stableJson(authorityBinding));
  const receipt = {
    schema_version: LIVE_ACTIVATION_SCHEMA,
    decision: LIVE_ACTIVATION_DECISION,
    issued_at: issuedAt.toISOString(),
    operator_id: actor,
    reason: justification,
    commit_sha: commit,
    runtime_instance_id: runtimeInstanceId,
    task_name: profile.task_name,
    task_path: `\\${profile.task_name}`,
    task_definition_sha256: taskDefinitionSha256,
    authority_binding: authorityBinding,
    authority_fingerprint: authorityFingerprint,
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
      expected_oauth_client_sha256: expectedYoutubeOAuthClientSha256,
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

function measureCurrentLiveActivationAuthority({ profile, repoRoot } = {}) {
  const measured = {
    nodePath: null,
    checkoutRealPath: null,
    databaseIdentitySha256: null,
  };
  try {
    measured.nodePath = canonicalPath(fs.realpathSync.native(process.execPath));
  } catch {
    // The receipt inspector fails closed when an independent value is absent.
  }
  try {
    measured.checkoutRealPath = canonicalPath(
      fs.realpathSync.native(path.resolve(repoRoot)),
    );
  } catch {
    // The receipt inspector fails closed when an independent value is absent.
  }
  try {
    measured.databaseIdentitySha256 = inspectLiveDatabaseIdentity({
      databasePath: profile?.database_path,
    }).database_identity_sha256;
  } catch {
    // The receipt inspector fails closed when an independent value is absent.
  }
  return measured;
}

function currentLiveTransitionAuthorityContext({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  checkoutInspector = inspectCheckout,
} = {}) {
  const physicalCheckout = inspectLiveCheckoutIdentity({ repoRoot });
  const physicalProfile = inspectLiveProfileFileIdentity({
    profile,
    profilePath,
  });
  const checkout = checkoutInspector({
    repoRoot,
    expectedCommit,
    expectedBranch: profile?.expected_branch,
    allowDetachedHead: profile?.allow_detached_head,
  });
  const measuredReleaseSha = String(checkout?.commit_sha || "")
    .trim()
    .toLowerCase();
  if (
    checkout?.ready !== true ||
    !/^[a-f0-9]{40,64}$/.test(measuredReleaseSha) ||
    measuredReleaseSha !== String(expectedCommit || "").trim().toLowerCase()
  ) {
    throw new Error("live_transition_release_authority_invalid");
  }
  const measured = measureCurrentLiveActivationAuthority({
    profile,
    repoRoot,
  });
  const binding = buildLiveTaskAuthorityBinding({
    taskName: profile?.task_name,
    nodePath: measured.nodePath,
    checkoutRealPath: physicalCheckout.canonical_real_path,
    releaseSha: measuredReleaseSha,
    profileSha256: profileFingerprint(profile),
    databaseIdentitySha256: measured.databaseIdentitySha256,
  });
  if (!validateStaticAuthorityBinding(binding)) {
    throw new Error("live_transition_authority_context_invalid");
  }
  if (
    canonicalPath(measured.checkoutRealPath).toLowerCase() !==
    canonicalPath(physicalCheckout.canonical_real_path).toLowerCase()
  ) {
    throw new Error("live_transition_checkout_identity_invalid");
  }
  return sha256(
    stableJson({
      authority_binding: binding,
      checkout_identity_sha256: physicalCheckout.checkout_identity_sha256,
      profile_identity_sha256: physicalProfile.profile_identity_sha256,
    }),
  );
}

function liveTransitionAuthorityContextProvider({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  transitionAuthorityContextProvider = currentLiveTransitionAuthorityContext,
} = {}) {
  if (typeof transitionAuthorityContextProvider !== "function") {
    throw new Error("live_transition_authority_context_provider_invalid");
  }
  return () =>
    transitionAuthorityContextProvider({
      profile,
      profilePath,
      repoRoot,
      expectedCommit,
    });
}

function assertLiveTransitionLeaseAuthority(transitionLease) {
  if (typeof transitionLease?.assertCurrentAuthority === "function") {
    return transitionLease.assertCurrentAuthority();
  }
  if (typeof transitionLease?.renew === "function") {
    return transitionLease.renew();
  }
  throw new Error("live_runtime_transition_lease_lost");
}

function assertLiveTransitionAuthorityContext(
  authorityContextProvider,
  admittedAuthorityContextSha256,
) {
  let currentAuthorityContextSha256;
  try {
    currentAuthorityContextSha256 = authorityContextProvider();
  } catch {
    throw new Error("live_runtime_transition_lease_lost");
  }
  if (currentAuthorityContextSha256 !== admittedAuthorityContextSha256) {
    throw new Error("live_runtime_transition_lease_lost");
  }
  return currentAuthorityContextSha256;
}

function liveActivationInspectionOptions({
  profile,
  repoRoot,
  expectedCommit,
  receiptPath,
} = {}) {
  return {
    profile,
    expectedCommit,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
    receiptPath,
    ...measureCurrentLiveActivationAuthority({ profile, repoRoot }),
  };
}

function inspectLiveActivationReceipt({
  profile,
  expectedCommit,
  migrationsDir,
  receiptPath = profile?.activation_receipt_path,
  nodePath = null,
  checkoutRealPath = null,
  databaseIdentitySha256 = null,
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
    runtime_instance_id: null,
    authority_fingerprint: null,
    authority_binding: null,
    task_definition_sha256: null,
    blockers,
  };
  if (!receiptPath || !fs.existsSync(path.resolve(receiptPath))) {
    blockers.push("activation_receipt_missing");
    return result;
  }
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), "utf8"));
  } catch {
    blockers.push("activation_receipt_invalid_json");
    return result;
  }
  let migrationManifest = null;
  try {
    migrationManifest = buildMigrationManifest({ migrationsDir });
  } catch (error) {
    blockers.push(
      secretSafeLifecycleFailure(
        "activation_receipt_migration_inspection_failed",
        error,
      ),
    );
  }
  const commit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  if (receipt?.schema_version !== LIVE_ACTIVATION_SCHEMA) {
    blockers.push("activation_receipt_schema_invalid");
  }
  const receiptAuthorityBinding = receipt?.authority_binding;
  const independentAuthorityAvailable =
    validAbsoluteWindowsPath(nodePath) &&
    validAbsoluteWindowsPath(checkoutRealPath) &&
    SHA256_PATTERN.test(String(databaseIdentitySha256 || ""));
  if (!independentAuthorityAvailable) {
    blockers.push("activation_receipt_independent_authority_required");
  }
  const expectedAuthorityBinding = buildLiveTaskAuthorityBinding({
    taskName: profile?.task_name,
    nodePath,
    checkoutRealPath,
    releaseSha: commit,
    profileSha256: profileFingerprint(profile),
    databaseIdentitySha256,
  });
  const expectedAuthorityFingerprint = sha256(
    stableJson(expectedAuthorityBinding),
  );
  let expectedTaskDefinitionSha256 = null;
  try {
    expectedTaskDefinitionSha256 = buildLiveProcessCommandAuthority({
      profile,
      repoRoot: expectedAuthorityBinding.checkout_real_path,
      expectedCommit: commit,
      nodeExecutable: expectedAuthorityBinding.node_path,
    }).supervisor_command_sha256;
  } catch {
    // The stable task-authority blocker below covers malformed receipt input.
  }
  if (
    !validRuntimeInstanceId(receipt?.runtime_instance_id) ||
    receipt?.task_name !== LIVE_TASK_NAME ||
    receipt?.task_path !== `\\${LIVE_TASK_NAME}` ||
    !validateStaticAuthorityBinding(receiptAuthorityBinding) ||
    stableJson(receiptAuthorityBinding) !==
      stableJson(expectedAuthorityBinding) ||
    receipt?.authority_fingerprint !== expectedAuthorityFingerprint ||
    receipt?.task_definition_sha256 !== expectedTaskDefinitionSha256
  ) {
    blockers.push("activation_receipt_task_authority_invalid");
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
  if (!/^[a-f0-9]{40,64}$/.test(commit) || receipt?.commit_sha !== commit) {
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
    receipt?.youtube_account_binding?.expected_oauth_client_sha256 || "",
  )
    .trim()
    .toLowerCase();
  if (
    receipt?.youtube_account_binding?.env_key !==
      YOUTUBE_OAUTH_CLIENT_SHA256_ENV ||
    !SHA256_PATTERN.test(receiptYoutubeOAuthClientSha256)
  ) {
    blockers.push("activation_receipt_youtube_oauth_client_binding_invalid");
  }
  if (
    receipt?.control?.kill_switch_healthy !== true ||
    receipt?.control?.emergency_kill_switch_tripped !== false ||
    receipt?.control?.primary_kill_switch_tripped !== false ||
    receipt?.control?.control_tower_required !== true ||
    receipt?.control?.fresh_green_required_per_release !== true ||
    receipt?.control?.control_tower_max_age_ms !== 15 * 60 * 1000 ||
    receipt?.control?.durable_release_commitment !== "youtube_remote_publishAt"
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
  result.receipt_sha256 = String(receipt?.receipt_sha256 || "").trim() || null;
  result.issued_at = String(receipt?.issued_at || "").trim() || null;
  result.operator_id = String(receipt?.operator_id || "").trim() || null;
  result.youtube_oauth_client_sha256 = SHA256_PATTERN.test(
    receiptYoutubeOAuthClientSha256,
  )
    ? receiptYoutubeOAuthClientSha256
    : null;
  result.runtime_instance_id = validRuntimeInstanceId(
    receipt?.runtime_instance_id,
  )
    ? receipt.runtime_instance_id
    : null;
  result.authority_fingerprint = SHA256_PATTERN.test(
    String(receipt?.authority_fingerprint || ""),
  )
    ? receipt.authority_fingerprint
    : null;
  result.authority_binding = validateStaticAuthorityBinding(
    receipt?.authority_binding,
  )
    ? buildLiveTaskAuthorityBinding({
        taskName: receipt.authority_binding.task_name,
        nodePath: receipt.authority_binding.node_path,
        checkoutRealPath: receipt.authority_binding.checkout_real_path,
        releaseSha: receipt.authority_binding.release_sha,
        profileSha256: receipt.authority_binding.profile_sha256,
        databaseIdentitySha256:
          receipt.authority_binding.database_identity_sha256,
      })
    : null;
  result.task_definition_sha256 = SHA256_PATTERN.test(
    String(receipt?.task_definition_sha256 || ""),
  )
    ? receipt.task_definition_sha256
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
  const commit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected_commit_required");
  }
  if (
    !validRuntimeInstanceId(activation.runtime_instance_id) ||
    !SHA256_PATTERN.test(String(activation.authority_fingerprint || ""))
  ) {
    throw new Error("live_activation_runtime_authority_invalid");
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
    PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256: activation.receipt_sha256,
    PULSE_LIVE_RUNTIME_INSTANCE_ID: activation.runtime_instance_id,
    PULSE_LIVE_AUTHORITY_FINGERPRINT: activation.authority_fingerprint,
    [YOUTUBE_OAUTH_CLIENT_SHA256_ENV]: requireYoutubeOAuthClientSha256(
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

function buildLiveSupervisorArgumentVector({ profile, repoRoot, commit } = {}) {
  const resolvedRoot = resolvePortablePath(process.cwd(), repoRoot);
  const toolPath = resolvePortablePath(
    resolvedRoot,
    path.join("tools", "windows-live-guarded-runtime.js"),
  );
  return [
    toolPath,
    "supervise",
    "--noninteractive",
    "--repo-root",
    resolvedRoot,
    "--expected-commit",
    commit,
    "--activation-receipt",
    profile.activation_receipt_path,
  ];
}

function buildLiveScheduledTaskArguments({ profile, repoRoot, commit } = {}) {
  return buildLiveSupervisorArgumentVector({ profile, repoRoot, commit })
    .map((argument, index) =>
      [0, 4, 8].includes(index) ? quoteWindowsArgument(argument) : argument,
    )
    .join(" ");
}

function buildLiveScheduledTaskCommand({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
} = {}) {
  const commit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("expected_commit_required");
  }
  const validation = validateLiveGuardedRuntimeProfile(profile);
  if (!validation.valid) {
    throw new Error(
      `live_guarded_profile_invalid:${validation.blockers.join(",")}`,
    );
  }
  return buildLiveScheduledTaskArguments({ profile, repoRoot, commit });
}

function buildLiveProcessCommandAuthority({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
} = {}) {
  const canonicalNodePath = canonicalPath(nodeExecutable);
  if (!validAbsoluteWindowsPath(canonicalNodePath)) {
    throw new Error("live_process_command_node_path_invalid");
  }
  const commit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  if (
    !/^[a-f0-9]{40,64}$/.test(commit) ||
    !validAbsoluteWindowsPath(repoRoot) ||
    !validAbsoluteWindowsPath(profile?.activation_receipt_path)
  ) {
    throw new Error("live_process_command_authority_invalid");
  }
  const supervisorArguments = buildLiveSupervisorArgumentVector({
    profile,
    repoRoot,
    commit,
  });
  return Object.freeze({
    supervisor_command_sha256: commandArgumentsSha256(supervisorArguments),
    child_command_sha256: commandArgumentsSha256(["server.js"]),
  });
}

function reviewedLiveProcessAuthority({
  profile,
  repoRoot,
  expectedCommit,
  activation,
} = {}) {
  if (
    activation?.valid !== true ||
    !validateStaticAuthorityBinding(activation?.authority_binding)
  ) {
    return null;
  }
  const commands = buildLiveProcessCommandAuthority({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable: activation.authority_binding.node_path,
  });
  if (
    activation.task_definition_sha256 !== commands.supervisor_command_sha256
  ) {
    return null;
  }
  return {
    expectedSupervisorExecutablePath: activation.authority_binding.node_path,
    expectedSupervisorCommandSha256: commands.supervisor_command_sha256,
    expectedChildExecutablePath: activation.authority_binding.node_path,
    expectedChildCommandSha256: commands.child_command_sha256,
  };
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
    '  <Principals><Principal id="PulseLiveGuarded"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\r\n' +
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
  const settings = decoded.match(/<Settings\b[\s\S]*?<\/Settings>/i)?.[0] || "";
  const restartOnFailure =
    settings.match(
      /<RestartOnFailure\b[^>]*>[\s\S]*?<\/RestartOnFailure>/i,
    )?.[0] || "";
  const enabledMatch = settings.match(/<Enabled>(true|false)<\/Enabled>/i);
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
    canonical.includes(String(toolPath).replace(/\\/g, "/").toLowerCase()),
    "task_tool_identity_invalid",
  );
  requireMatch(
    actionArguments.trim() === expectedCommand,
    "task_supervision_command_invalid",
  );
  requireMatch(
    /\bsupervise\b/.test(decoded) && /--noninteractive\b/.test(decoded),
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
    command_fingerprint: buildLiveProcessCommandAuthority({
      profile,
      repoRoot,
      expectedCommit,
      nodeExecutable,
    }).supervisor_command_sha256,
    blockers: validation.valid
      ? []
      : ["scheduled_task_identity_mismatch", ...validation.blockers],
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
      const literalTaskName = `'${String(taskName).replace(/'/g, "''")}'`;
      const script =
        "$ErrorActionPreference = 'Stop'; " +
        "$result = try { " +
        "$service = New-Object -ComObject 'Schedule.Service'; " +
        "$service.Connect(); $folder = $service.GetFolder('\\'); " +
        `$task = $folder.GetTask(${literalTaskName}); ` +
        "[pscustomobject]@{ Found = $true; Enabled = [bool]$task.Enabled; HResult = 0 } " +
        "} catch [System.Runtime.InteropServices.COMException] { " +
        "[pscustomobject]@{ Found = $false; Enabled = $null; HResult = [int]$_.Exception.HResult } " +
        "} catch { " +
        "[pscustomobject]@{ Found = $false; Enabled = $null; HResult = [int]$_.Exception.HResult } " +
        "}; $result | ConvertTo-Json -Compress";
      const output = String(
        execFileSyncImpl(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
          ],
          {
            encoding: "utf8",
            timeout: 5000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      ).trim();
      const result = output ? JSON.parse(output) : null;
      let state = "inspection_error";
      if (result?.Found === true && result?.Enabled === false) {
        state = "disabled";
      } else if (result?.Found === true && result?.Enabled === true) {
        state = "enabled";
      } else if (
        result?.Found === false &&
        Number(result?.HResult) === -2147024894
      ) {
        state = "absent";
      }
      return {
        task_name: taskName,
        state,
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
  processIdentityInspector = inspectWindowsProcessIdentity,
  expectedSupervisorExecutablePath = null,
  expectedSupervisorCommandSha256 = null,
  expectedChildExecutablePath = null,
  expectedChildCommandSha256 = null,
} = {}) {
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
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
      const reviewedProcessAuthority = {
        expectedSupervisorExecutablePath,
        expectedSupervisorCommandSha256,
        expectedChildExecutablePath,
        expectedChildCommandSha256,
      };
      const commonExact =
        ["pulse-windows-live-guarded-owner-v1", LIVE_OWNER_SCHEMA].includes(
          owner.schema_version,
        ) &&
        Number(owner.port) === Number(profile.port) &&
        normaliseWindowsPath(owner.repo_root).toLowerCase() ===
          normaliseWindowsPath(path.resolve(repoRoot)).toLowerCase() &&
        String(owner.commit_sha || "").toLowerCase() ===
          String(expectedCommit || "").toLowerCase() &&
        owner.profile_sha256 === profileFingerprint(profile) &&
        owner.activation_receipt_sha256 === activation?.receipt_sha256 &&
        Number.isInteger(Number(owner.supervisor_pid)) &&
        Number(owner.supervisor_pid) > 0 &&
        normaliseProcessStartedAt(owner.supervisor_process_started_at) !==
          null &&
        Number.isInteger(Number(owner.child_pid)) &&
        Number(owner.child_pid) > 0 &&
        normaliseProcessStartedAt(owner.child_process_started_at) !== null &&
        owner.platform === "youtube";
      const exact =
        commonExact &&
        (owner.schema_version !== LIVE_OWNER_SCHEMA ||
          validateExactStaleOwnerV2Authority({
            owner,
            profile,
            repoRoot,
            expectedCommit,
            activation,
            reviewedProcessAuthority,
          }));
      if (!exact) {
        ownerState = "mismatch";
        blockers.push("live_supervisor_owner_receipt_mismatch");
      } else {
        const identities = [
          inspectBoundProcessIdentity({
            pid: owner.supervisor_pid,
            processStartedAt: owner.supervisor_process_started_at,
            processIdentityInspector,
          }),
          inspectBoundProcessIdentity({
            pid: owner.child_pid,
            processStartedAt: owner.child_process_started_at,
            processIdentityInspector,
          }),
        ];
        if (identities.some((identity) => identity.available !== true)) {
          ownerState = "identity_unavailable";
          blockers.push("live_supervisor_owner_process_identity_unavailable");
        } else if (identities.some((identity) => identity.alive === true)) {
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
  const selected = String(action || "")
    .trim()
    .toLowerCase();
  const blockers = [];
  if (!LIVE_LIFECYCLE_ACTIONS.includes(selected)) {
    blockers.push("live_lifecycle_action_invalid");
  }
  if (!profileValidation.valid) {
    blockers.push(...(profileValidation.blockers || ["live_profile_invalid"]));
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
        ...(activation.blockers || ["exact_live_activation_receipt_required"]),
      );
    }
    if (!["managed_disabled", "managed_current"].includes(task.state)) {
      blockers.push(...(task.blockers || []), "managed_task_required");
    }
    if (conflicts.clear !== true) {
      blockers.push(
        ...(conflicts.blockers || ["conflicting_runtime_task_enabled"]),
      );
    }
  }
  if (selected === "start") {
    if (task.state !== "managed_current") {
      blockers.push(...(task.blockers || []), "enabled_managed_task_required");
    }
    if (runtime.stopped !== true) {
      blockers.push(...(runtime.blockers || ["live_runtime_must_be_stopped"]));
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
  if (selected === "uninstall" && task.state !== "managed_disabled") {
    blockers.push(...(task.blockers || []), "disabled_managed_task_required");
  }
  if (
    selected === "revoke-activation" &&
    !["absent", "managed_disabled"].includes(task.state)
  ) {
    blockers.push(...(task.blockers || []), "task_absent_or_disabled_required");
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
  const baseProfileValidation = validateLiveGuardedRuntimeProfile(profile);
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
    optionBlockers.push("apply_activation_receipt_override_forbidden");
  }
  if (action === "issue-activation" && !String(operatorId || "").trim()) {
    optionBlockers.push("activation_operator_id_required");
  }
  if (action === "issue-activation" && !String(reason || "").trim()) {
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
    valid: baseProfileValidation.valid && optionBlockers.length === 0,
    blockers: [...baseProfileValidation.blockers, ...optionBlockers],
  };
  const checkoutInspector = dependencies.inspectCheckout || inspectCheckout;
  const databaseInspector = dependencies.inspectDatabase || inspectDatabase;
  const activationInspector =
    dependencies.inspectActivation || inspectLiveActivationReceipt;
  const taskInspector = dependencies.inspectTask || inspectLiveWindowsTask;
  const conflictInspector =
    dependencies.inspectConflicts || inspectLiveTaskConflicts;
  const runtimeInspector =
    dependencies.inspectRuntime || inspectStoppedLiveRuntime;
  const startLockInspector =
    dependencies.inspectStartLock || inspectLiveStartOperationLock;
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
  const activation = activationInspector(
    liveActivationInspectionOptions({
      profile,
      repoRoot,
      expectedCommit,
      receiptPath: activationReceiptPath || profile.activation_receipt_path,
    }),
  );
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
          ...(reviewedLiveProcessAuthority({
            profile,
            repoRoot,
            expectedCommit,
            activation,
          }) || {}),
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
          activationReceiptSha256: activation.receipt_sha256,
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
      (runtime.stopped === true && startOperationLock.clear === true));
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
      scheduler_profile: profile.environment.PULSE_SCHEDULER_PROFILE,
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
        durable_release_commitment: "youtube_remote_publishAt",
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
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
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
    schema_version: "pulse-windows-live-guarded-lifecycle-receipt-v1",
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
  const profileValidation = validateLiveGuardedRuntimeProfile(profile);
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
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  enabled = false,
  nodeExecutable = process.execPath,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
  taskInspector = inspectLiveWindowsTask,
  lifecycleReceiptWriter = writeLiveLifecycleReceipt,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
} = {}) {
  assertWindowsLifecycleHost(platform);
  if (enabled !== false) {
    throw new Error("live_task_install_must_be_disabled");
  }
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    action: "live-install",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  try {
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
      assertLiveTransitionLeaseAuthority(transitionLease);
      return lifecycleReceiptWriter({
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
    assertLiveTransitionLeaseAuthority(transitionLease);
    fs.mkdirSync(profile.state_root, { recursive: true });
    const xmlPath = path.join(
      profile.state_root,
      `scheduled-task-${process.pid}-${Date.now()}.xml`,
    );
    try {
      assertLiveTransitionLeaseAuthority(transitionLease);
      fs.writeFileSync(
        xmlPath,
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(xml, "utf16le"),
        ]),
      );
      transitionLease.renew();
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
    assertLiveTransitionLeaseAuthority(transitionLease);
    return lifecycleReceiptWriter({
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
  } finally {
    transitionLease.release();
  }
}

function setLiveScheduledTaskEnabled({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
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
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
} = {}) {
  assertWindowsLifecycleHost(platform);
  if (typeof enabled !== "boolean") {
    throw new Error("live_task_enabled_boolean_required");
  }
  if (startImmediately !== false) {
    throw new Error("live_task_immediate_start_forbidden");
  }
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    action: enabled ? "live-enable" : "live-disable",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  try {
    if (enabled === true) {
      sourceDatabaseInspector({
        profile,
        repoRoot,
        expectedCommit,
      });
      const currentActivation = activationInspector(
        liveActivationInspectionOptions({
          profile,
          repoRoot,
          expectedCommit,
          receiptPath: profile.activation_receipt_path,
        }),
      );
      if (
        activation?.valid !== true ||
        currentActivation.valid !== true ||
        activation.receipt_sha256 !== currentActivation.receipt_sha256
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
    const targetState = enabled ? "managed_current" : "managed_disabled";
    if (current.state === targetState) {
      assertLiveTransitionLeaseAuthority(transitionLease);
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
    transitionLease.renew();
    execFileSyncImpl(
      "schtasks.exe",
      ["/Change", "/TN", profile.task_name, enabled ? "/ENABLE" : "/DISABLE"],
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
    transitionLease.renew();
    return lifecycleReceiptWriter({
      profile,
      action: enabled ? "enable" : "disable",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: enabled ? "enabled_for_next_boot" : "disabled",
        start_immediately: false,
        activation_receipt_sha256: enabled ? activation.receipt_sha256 : null,
      },
    });
  } finally {
    transitionLease.release();
  }
}

function readLiveSupervisorOwner({ profile } = {}) {
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
  if (!fs.existsSync(ownerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    return null;
  }
}

function exactStoppedRuntimeForLockRecovery(runtime) {
  return (
    runtime?.stopped === true &&
    Array.isArray(runtime?.listening_pids) &&
    runtime.listening_pids.length === 0 &&
    ["absent", "exact_stale"].includes(runtime?.owner_state)
  );
}

function startLockEvidencePath({ profile, generatedAt, label, identity } = {}) {
  return path.join(
    profile.state_root,
    "evidence",
    `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
      `-${label}-${identity}.json`,
  );
}

function recoverIncompleteStartLockArtifacts({
  profile,
  lockPath,
  staleRuntime,
  generatedAt,
  processIdentityInspector,
  fileSystemSync,
  boundaryAuthorityAsserter = null,
} = {}) {
  const parent = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.`;
  const names = fileSystemSync
    .readdirSync(parent)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".pending"))
    .sort();
  const recovered = [];
  for (const name of names) {
    const match = name.match(
      /^start-operation\.lock\.json\.(\d+)\.([a-f0-9]{64})\.([a-f0-9-]{36})\.pending$/,
    );
    if (!match) throw new Error("live_start_operation_locked");
    const pendingPath = path.join(parent, name);
    const stat = fileSystemSync.lstatSync(pendingPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("live_start_operation_locked");
    }
    let current;
    try {
      current = processIdentityInspector({ pid: Number(match[1]) });
    } catch {
      throw new Error("live_start_operation_locked");
    }
    if (
      current?.available !== true ||
      ![true, false].includes(current?.exists) ||
      Number(current?.process_id) !== Number(match[1])
    ) {
      throw new Error("live_start_operation_locked");
    }
    if (current.exists === true) {
      const currentStartedAt = normaliseProcessStartedAt(
        current.process_started_at,
      );
      if (!currentStartedAt) {
        throw new Error("live_start_operation_locked");
      }
      if (sha256(currentStartedAt) === match[2]) {
        throw new Error("live_start_operation_locked");
      }
    }
    if (!exactStoppedRuntimeForLockRecovery(staleRuntime)) {
      throw new Error("live_start_operation_locked");
    }
    const evidencePath = startLockEvidencePath({
      profile,
      generatedAt,
      label: "incomplete-start-operation",
      identity: `${match[3]}-${sha256(name).slice(0, 16)}`,
    });
    boundaryAuthorityAsserter?.();
    fileSystemSync.mkdirSync(path.dirname(evidencePath), {
      recursive: true,
    });
    if (fileSystemSync.existsSync(evidencePath)) {
      throw new Error("live_start_operation_locked");
    }
    boundaryAuthorityAsserter?.();
    fileSystemSync.renameSync(pendingPath, evidencePath);
    recovered.push(evidencePath);
  }
  return recovered;
}

function quarantineIncompleteFinalStartLock({
  profile,
  lockPath,
  staleRuntime,
  generatedAt,
  fileSystemSync,
  boundaryAuthorityAsserter = null,
} = {}) {
  if (!exactStoppedRuntimeForLockRecovery(staleRuntime)) return null;
  const stat = fileSystemSync.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  const bytes = fileSystemSync.readFileSync(lockPath);
  const evidencePath = startLockEvidencePath({
    profile,
    generatedAt,
    label: "incomplete-start-operation",
    identity: sha256(bytes).slice(0, 32),
  });
  boundaryAuthorityAsserter?.();
  fileSystemSync.mkdirSync(path.dirname(evidencePath), {
    recursive: true,
  });
  if (fileSystemSync.existsSync(evidencePath)) return null;
  boundaryAuthorityAsserter?.();
  fileSystemSync.renameSync(lockPath, evidencePath);
  return evidencePath;
}

function acquireLiveStartOperationLock({
  profile,
  expectedCommit,
  activationReceiptSha256,
  operationNonce = crypto.randomUUID(),
  processId = process.pid,
  generatedAt = new Date().toISOString(),
  staleRuntime = null,
  processIdentityInspector = inspectWindowsProcessIdentity,
  fileSystemSync = fs,
  boundaryAuthorityAsserter = null,
} = {}) {
  const nonce = String(operationNonce || "")
    .trim()
    .toLowerCase();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      nonce,
    )
  ) {
    throw new Error("live_start_operation_nonce_invalid");
  }
  if (!SHA256_PATTERN.test(String(activationReceiptSha256 || ""))) {
    throw new Error("live_start_operation_activation_receipt_sha256_invalid");
  }
  const lockPath = path.join(profile.state_root, "start-operation.lock.json");
  const identity = captureProcessIdentity({
    pid: processId,
    processIdentityInspector,
    unavailableCode: "live_start_operation_process_identity_unavailable",
  });
  boundaryAuthorityAsserter?.();
  fileSystemSync.mkdirSync(path.dirname(lockPath), {
    recursive: true,
  });
  const recoveredIncompleteEvidencePaths = recoverIncompleteStartLockArtifacts({
    profile,
    lockPath,
    staleRuntime,
    generatedAt,
    processIdentityInspector,
    fileSystemSync,
    boundaryAuthorityAsserter,
  });
  let recoveredLockEvidencePath = null;
  if (fileSystemSync.existsSync(lockPath)) {
    const existing = inspectLiveStartOperationLock({
      profile,
      expectedCommit,
      activationReceiptSha256,
      runtime: staleRuntime,
      processIdentityInspector,
      fileSystemSync,
    });
    if (existing.state === "exact_stale_recoverable") {
      recoveredLockEvidencePath = startLockEvidencePath({
        profile,
        generatedAt,
        label: "stale-start-operation",
        identity: existing.operation_nonce,
      });
      boundaryAuthorityAsserter?.();
      fileSystemSync.mkdirSync(path.dirname(recoveredLockEvidencePath), {
        recursive: true,
      });
      if (fileSystemSync.existsSync(recoveredLockEvidencePath)) {
        throw new Error("live_start_operation_locked");
      }
      try {
        boundaryAuthorityAsserter?.();
        fileSystemSync.renameSync(lockPath, recoveredLockEvidencePath);
      } catch {
        throw new Error("live_start_operation_locked");
      }
    } else if (existing.state === "invalid") {
      const quarantined = quarantineIncompleteFinalStartLock({
        profile,
        lockPath,
        staleRuntime,
        generatedAt,
        fileSystemSync,
        boundaryAuthorityAsserter,
      });
      if (!quarantined) {
        throw new Error("live_start_operation_locked");
      }
      recoveredIncompleteEvidencePaths.push(quarantined);
    } else {
      throw new Error("live_start_operation_locked");
    }
  }
  const record = {
    schema_version: LIVE_START_OPERATION_SCHEMA,
    acquired_at: new Date(generatedAt).toISOString(),
    operation_nonce: nonce,
    process_id: identity.process_id,
    process_started_at: identity.process_started_at,
    commit_sha: String(expectedCommit || "").toLowerCase(),
    profile_sha256: profileFingerprint(profile),
    activation_receipt_sha256: activationReceiptSha256,
  };
  const pendingPath =
    `${lockPath}.${identity.process_id}.` +
    `${sha256(identity.process_started_at)}.${nonce}.pending`;
  let descriptor;
  try {
    boundaryAuthorityAsserter?.();
    descriptor = fileSystemSync.openSync(pendingPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("live_start_operation_locked");
    }
    throw error;
  }
  try {
    boundaryAuthorityAsserter?.();
    fileSystemSync.writeFileSync(
      descriptor,
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
    fileSystemSync.fsyncSync(descriptor);
  } finally {
    fileSystemSync.closeSync(descriptor);
  }
  try {
    boundaryAuthorityAsserter?.();
    fileSystemSync.linkSync(pendingPath, lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      try {
        fileSystemSync.unlinkSync(pendingPath);
      } catch {
        // The pending file remains non-authoritative recovery evidence.
      }
      throw new Error("live_start_operation_locked");
    }
    throw error;
  }
  try {
    boundaryAuthorityAsserter?.();
    fileSystemSync.unlinkSync(pendingPath);
  } catch {
    // The fully synced final hard link is authoritative. A surviving
    // pending link is deterministic recovery evidence, never authority.
  }
  return {
    lock_path: lockPath,
    operation_nonce: nonce,
    record,
    recovered_lock_evidence_path: recoveredLockEvidencePath,
    recovered_incomplete_evidence_paths: recoveredIncompleteEvidencePaths,
  };
}

function releaseLiveStartOperationLock({
  lock,
  generatedAt = new Date().toISOString(),
  boundaryAuthorityAsserter = null,
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
  boundaryAuthorityAsserter?.();
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  boundaryAuthorityAsserter?.();
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
  processIdentityInspector = inspectWindowsProcessIdentity,
  fileSystemSync = fs,
} = {}) {
  const lockPath = path.join(profile.state_root, "start-operation.lock.json");
  if (!fileSystemSync.existsSync(lockPath)) {
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
    record = JSON.parse(fileSystemSync.readFileSync(lockPath, "utf8"));
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
  if (record.activation_receipt_sha256 !== activationReceiptSha256) {
    blockers.push("live_start_operation_lock_activation_mismatch");
  }
  if (
    !Number.isInteger(Number(record.process_id)) ||
    Number(record.process_id) <= 0
  ) {
    blockers.push("live_start_operation_lock_process_id_invalid");
  }
  if (!normaliseProcessStartedAt(record.process_started_at)) {
    blockers.push("live_start_operation_lock_process_started_at_invalid");
  }
  let state = blockers.length ? "mismatch" : "unknown";
  let clear = false;
  let processAlive = null;
  if (blockers.length === 0) {
    const identity = inspectBoundProcessIdentity({
      pid: record.process_id,
      processStartedAt: record.process_started_at,
      processIdentityInspector,
    });
    if (identity.available !== true) {
      state = "identity_unavailable";
      blockers.push("live_start_operation_lock_process_identity_unavailable");
    } else if (identity.alive === true) {
      processAlive = true;
      state = "active";
      blockers.push("live_start_operation_lock_active");
    } else {
      processAlive = false;
      if (exactStoppedRuntimeForLockRecovery(runtime)) {
        state = "exact_stale_recoverable";
        clear = true;
      } else {
        state = "stale_recovery_blocked";
        blockers.push("live_start_operation_stale_recovery_unsafe");
      }
    }
  }
  return {
    present: true,
    valid: !["mismatch", "invalid", "identity_unavailable"].includes(state),
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
  processIdentityInspector = inspectWindowsProcessIdentity,
  startLockInspector = inspectLiveStartOperationLock,
  generatedAt = new Date().toISOString(),
  expectedSupervisorExecutablePath = null,
  expectedSupervisorCommandSha256 = null,
  expectedChildExecutablePath = null,
  expectedChildCommandSha256 = null,
  boundaryAuthorityAsserter = null,
} = {}) {
  const lockState = startLockInspector({
    profile,
    expectedCommit,
    activationReceiptSha256: activation?.receipt_sha256,
    processIdentityInspector,
  });
  if (
    lockState.valid !== true ||
    lockState.operation_nonce !== operationNonce
  ) {
    throw new Error("stale_owner_archive_start_operation_lock_required");
  }
  const stopped = inspectStoppedLiveRuntime({
    profile,
    repoRoot,
    expectedCommit,
    activation,
    listenerInspector,
    processIdentityInspector,
    expectedSupervisorExecutablePath,
    expectedSupervisorCommandSha256,
    expectedChildExecutablePath,
    expectedChildCommandSha256,
  });
  if (stopped.owner_state === "absent") {
    return { outcome: "no_stale_owner" };
  }
  if (stopped.stopped !== true || stopped.owner_state !== "exact_stale") {
    throw new Error("exact_dead_stale_owner_required");
  }
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
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
  boundaryAuthorityAsserter?.();
  fs.mkdirSync(path.dirname(archivedPath), { recursive: true });
  boundaryAuthorityAsserter?.();
  fs.renameSync(ownerPath, archivedPath);
  return {
    outcome: "exact_stale_owner_archived",
    archived_path: archivedPath,
    owner_receipt_sha256: stopped.owner_receipt_sha256,
  };
}

async function startLiveScheduledTask({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
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
  processIdentityInspector = inspectWindowsProcessIdentity,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
  workerTopologyProvider = defaultLiveWorkerTopologyProvider,
} = {}) {
  assertWindowsLifecycleHost(platform);
  const expectedRuntime = trustedExpectedLiveRuntime({
    runtimeInstanceId: activation?.runtime_instance_id,
    workerTopologyProvider,
  });
  if (!expectedRuntime) {
    throw new Error("live_worker_topology_authority_invalid");
  }
  const preLockReviewedProcessAuthority = reviewedLiveProcessAuthority({
    profile,
    repoRoot,
    expectedCommit,
    activation,
  });
  const operationNonce = operationNonceFactory();
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    ownerId: `live-start:${operationNonce}`,
    action: "live-start",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  let lock = null;
  try {
    const preLockRuntime = runtimeInspector({
      profile,
      repoRoot,
      expectedCommit,
      activation,
      listenerInspector,
      processIdentityInspector,
      ...(preLockReviewedProcessAuthority || {}),
    });
    if (preLockRuntime.stopped !== true) {
      throw new Error(
        `live_runtime_not_stopped:${(
          preLockRuntime.blockers || ["live_runtime_stop_state_not_verified"]
        ).join(",")}`,
      );
    }
    transitionLease.renew();
    lock = startLockAcquirer({
      profile,
      expectedCommit,
      activationReceiptSha256: activation?.receipt_sha256,
      operationNonce,
      staleRuntime: preLockRuntime,
      processIdentityInspector,
      boundaryAuthorityAsserter: () =>
        assertLiveTransitionLeaseAuthority(transitionLease),
    });
  } catch (error) {
    try {
      transitionLease.release();
    } catch {
      // Expiry remains the fail-safe when initialisation cannot release.
    }
    throw error;
  }
  let launched = false;
  let currentActivation = null;
  let failureStage = "start_prelaunch_authority_failed";

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
      processIdentityInspector,
    });
  const taskCommand = (args) =>
    execFileSyncImpl("schtasks.exe", args, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const assertBoundaryAuthority = ({ postLaunch = false } = {}) => {
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
    const inspectedActivation = activationInspector(
      liveActivationInspectionOptions({
        profile,
        repoRoot,
        expectedCommit,
        receiptPath: profile.activation_receipt_path,
      }),
    );
    if (
      activation?.valid !== true ||
      inspectedActivation.valid !== true ||
      activation.receipt_sha256 !== inspectedActivation.receipt_sha256
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
          `conflicting_runtime_task_state:${(conflicts.blockers || []).join(
            ",",
          )}`,
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
  const inspectExactRuntimeIdentity = async (inspectedActivation) => {
    const owner = ownerReader({ profile });
    const health = await healthRequester({ port: profile.port });
    const listeners = listenerInspector({ port: profile.port });
    const childPid = Number(owner?.child_pid) || null;
    const supervisorIdentity = inspectBoundProcessIdentity({
      pid: owner?.supervisor_pid,
      processStartedAt: owner?.supervisor_process_started_at,
      processIdentityInspector,
    });
    const childIdentity = inspectBoundProcessIdentity({
      pid: owner?.child_pid,
      processStartedAt: owner?.child_process_started_at,
      processIdentityInspector,
    });
    if (
      safeLiveHealthIdentity(health, expectedCommit, expectedRuntime) &&
      owner?.schema_version === LIVE_OWNER_SCHEMA &&
      Number(owner?.port) === Number(profile.port) &&
      normaliseWindowsPath(owner?.repo_root).toLowerCase() ===
        normaliseWindowsPath(path.resolve(repoRoot)).toLowerCase() &&
      owner?.commit_sha === String(expectedCommit).toLowerCase() &&
      owner?.profile_sha256 === profileFingerprint(profile) &&
      owner?.activation_receipt_sha256 === inspectedActivation.receipt_sha256 &&
      owner?.start_operation_nonce === operationNonce &&
      owner?.platform === "youtube" &&
      Number.isInteger(Number(owner?.supervisor_pid)) &&
      supervisorIdentity.available === true &&
      supervisorIdentity.alive === true &&
      childPid &&
      childIdentity.available === true &&
      childIdentity.alive === true &&
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
      cleanup.blockers.push("start_cleanup_operation_lock_ownership_lost");
      return cleanup;
    }
    if (ownerBefore && ownerBefore.start_operation_nonce !== operationNonce) {
      cleanup.blockers.push("start_cleanup_owner_operation_nonce_mismatch");
      return cleanup;
    }
    const beforeEndTask = inspectExactTask();
    if (beforeEndTask.state !== "managed_current") {
      cleanup.blockers.push("start_cleanup_managed_task_identity_lost");
      return cleanup;
    }
    cleanup.operation_owned = true;
    cleanup.end_attempted = true;
    try {
      assertLiveTransitionLeaseAuthority(transitionLease);
      taskCommand(["/End", "/TN", profile.task_name]);
      cleanup.end_succeeded = true;
    } catch (error) {
      cleanup.blockers.push(
        secretSafeLifecycleFailure("start_cleanup_end_failed", error),
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
      cleanup.blockers.push("start_cleanup_disable_authority_lost");
    } else {
      cleanup.disable_attempted = true;
      try {
        assertLiveTransitionLeaseAuthority(transitionLease);
        taskCommand(["/Change", "/TN", profile.task_name, "/DISABLE"]);
        cleanup.disable_succeeded = true;
      } catch (error) {
        cleanup.blockers.push(
          secretSafeLifecycleFailure("start_cleanup_disable_failed", error),
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
    cleanup.orphan_listener_pids = Array.isArray(afterListeners?.listeningPids)
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
    failureStage = "start_prelaunch_authority_failed";
    currentActivation = assertBoundaryAuthority();
    const reviewedProcessAuthority = reviewedLiveProcessAuthority({
      profile,
      repoRoot,
      expectedCommit,
      activation: currentActivation,
    });
    failureStage = "start_prelaunch_runtime_inspection_failed";
    const stoppedRuntime = runtimeInspector({
      profile,
      repoRoot,
      expectedCommit,
      activation: currentActivation,
      listenerInspector,
      processIdentityInspector,
      ...(reviewedProcessAuthority || {}),
    });
    if (stoppedRuntime.stopped !== true) {
      throw new Error(
        `live_runtime_not_stopped:${(
          stoppedRuntime.blockers || ["live_runtime_stop_state_not_verified"]
        ).join(",")}`,
      );
    }
    if (stoppedRuntime.owner_state === "exact_stale") {
      assertLiveTransitionLeaseAuthority(transitionLease);
      const archivedOwner = staleOwnerArchiver({
        profile,
        repoRoot,
        expectedCommit,
        activation: currentActivation,
        operationNonce,
        listenerInspector,
        startLockInspector,
        processIdentityInspector,
        boundaryAuthorityAsserter: () =>
          assertLiveTransitionLeaseAuthority(transitionLease),
        ...(reviewedProcessAuthority || {}),
      });
      if (archivedOwner.outcome !== "exact_stale_owner_archived") {
        throw new Error("exact_stale_owner_archive_failed");
      }
    }

    failureStage = "start_prelaunch_transition_renew_failed";
    transitionLease.renew();
    failureStage = "start_task_run_failed";
    launched = true;
    taskCommand(["/Run", "/TN", profile.task_name]);

    failureStage = "start_runtime_verification_failed";
    const deadline = Date.now() + timeoutMs;
    let verified = null;
    do {
      transitionLease.renew();
      verified = await inspectExactRuntimeIdentity(currentActivation);
      if (verified) break;
      await delayImpl(750);
    } while (Date.now() < deadline);
    if (!verified) {
      throw new Error("live_task_start_verification_failed");
    }

    failureStage = "start_post_launch_authority_failed";
    const postActivation = assertBoundaryAuthority({
      postLaunch: true,
    });
    failureStage = "start_post_launch_lock_failed";
    const lockBeforeAttestation = inspectCurrentLock();
    if (
      lockBeforeAttestation.valid !== true ||
      lockBeforeAttestation.operation_nonce !== operationNonce
    ) {
      throw new Error("post_launch_start_operation_lock_drift");
    }
    failureStage = "start_post_launch_runtime_identity_failed";
    verified = await inspectExactRuntimeIdentity(postActivation);
    if (!verified) {
      throw new Error("post_launch_runtime_identity_drift");
    }
    failureStage = "start_post_launch_transition_renew_failed";
    transitionLease.renew();
    failureStage = "start_success_receipt_write_failed";
    return lifecycleReceiptWriter({
      profile,
      action: "start",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "started_verified",
        operation_nonce: operationNonce,
        activation_receipt_sha256: postActivation.receipt_sha256,
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
    const primaryError = secretSafeLifecycleFailure(failureStage, error, {
      safeCodes: SAFE_LIVE_START_FAILURE_CODES,
    });
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
          secretSafeLifecycleFailure(
            "start_cleanup_unhandled_error",
            cleanupError,
          ),
        ],
        orphan_listener_pids: [],
      };
    }
    assertLiveTransitionLeaseAuthority(transitionLease);
    lifecycleReceiptWriter({
      profile,
      action: "start-failed",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "start_failed",
        operation_nonce: operationNonce,
        activation_receipt_sha256: activation?.receipt_sha256 || null,
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
    const finalizationFailures = [];
    if (lock) {
      try {
        startLockReleaser({
          lock,
          boundaryAuthorityAsserter: () =>
            assertLiveTransitionLeaseAuthority(transitionLease),
        });
      } catch (error) {
        finalizationFailures.push(
          secretSafeLifecycleFailure(
            "start_operation_lock_release_failed",
            error,
          ),
        );
      }
    }
    try {
      transitionLease.release();
    } catch (error) {
      finalizationFailures.push(
        secretSafeLifecycleFailure(
          "start_transition_lease_release_failed",
          error,
        ),
      );
    }
    if (finalizationFailures.length > 0) {
      throw new Error(
        `live_task_start_finalization_failed:${finalizationFailures.join(",")}`,
      );
    }
  }
}

function uninstallLiveScheduledTask({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  execFileSyncImpl = execFileSync,
  platform = process.platform,
  taskInspector = inspectLiveWindowsTask,
  lifecycleReceiptWriter = writeLiveLifecycleReceipt,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
} = {}) {
  assertWindowsLifecycleHost(platform);
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    action: "live-uninstall",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  try {
    const current = taskInspector({
      profile,
      repoRoot,
      expectedCommit,
      execFileSyncImpl,
    });
    if (current.state !== "managed_disabled") {
      throw new Error("disabled_managed_live_task_required");
    }
    transitionLease.renew();
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
    assertLiveTransitionLeaseAuthority(transitionLease);
    return lifecycleReceiptWriter({
      profile,
      action: "uninstall",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "uninstalled",
      },
    });
  } finally {
    transitionLease.release();
  }
}

function issueLiveActivationReceipt({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  operatorId,
  reason,
  youtubeOAuthClientSha256,
  generatedAt = new Date().toISOString(),
  sourceDatabaseInspector = assertLiveSourceDatabaseReady,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
  activationReceiptBuilder = buildLiveActivationReceipt,
  activationReceiptInspector = inspectLiveActivationReceipt,
  receiptExists = fs.existsSync,
  receiptWriter = writeJsonAtomic,
  runtimeInstanceIdFactory = () => `ri-${crypto.randomUUID()}`,
  nodeExecutable = process.execPath,
  checkoutRealPath = null,
  databaseIdentitySha256 = null,
} = {}) {
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    action: "live-activation",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  try {
    sourceDatabaseInspector({
      profile,
      repoRoot,
      expectedCommit,
    });
    const resolvedCheckoutRealPath = canonicalPath(
      checkoutRealPath || fs.realpathSync.native(path.resolve(repoRoot)),
    );
    const resolvedDatabaseIdentitySha256 = String(
      databaseIdentitySha256 ||
        inspectLiveDatabaseIdentity({ databasePath: profile.database_path })
          .database_identity_sha256,
    ).toLowerCase();
    const receiptPath = path.resolve(profile.activation_receipt_path);
    if (receiptExists(receiptPath)) {
      const current = activationReceiptInspector({
        profile,
        expectedCommit,
        migrationsDir: path.join(repoRoot, "db", "migrations"),
        receiptPath,
        nodePath: nodeExecutable,
        checkoutRealPath: resolvedCheckoutRealPath,
        databaseIdentitySha256: resolvedDatabaseIdentitySha256,
      });
      if (current.valid !== true) {
        throw new Error("refusing_to_replace_existing_activation_receipt");
      }
      assertLiveTransitionLeaseAuthority(transitionLease);
      return {
        outcome: "no_op_exact_activation_receipt_exists",
        receipt_path: normaliseWindowsPath(receiptPath),
        receipt_sha256: current.receipt_sha256,
      };
    }
    const receipt = activationReceiptBuilder({
      profile,
      expectedCommit,
      migrationsDir: path.join(repoRoot, "db", "migrations"),
      operatorId,
      reason,
      youtubeOAuthClientSha256,
      generatedAt,
      runtimeInstanceId: runtimeInstanceIdFactory(),
      nodePath: nodeExecutable,
      checkoutRealPath: resolvedCheckoutRealPath,
      databaseIdentitySha256: resolvedDatabaseIdentitySha256,
    });
    transitionLease.renew();
    receiptWriter(receiptPath, receipt);
    return {
      outcome: "activation_receipt_issued",
      receipt_path: normaliseWindowsPath(receiptPath),
      receipt_sha256: receipt.receipt_sha256,
    };
  } finally {
    transitionLease.release();
  }
}

function revokeLiveActivationReceipt({
  profile,
  profilePath = DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  repoRoot,
  expectedCommit,
  generatedAt = new Date().toISOString(),
  taskDisabledConfirmed = false,
  execFileSyncImpl = execFileSync,
  taskInspector = inspectLiveWindowsTask,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
} = {}) {
  if (taskDisabledConfirmed !== true) {
    throw new Error("disabled_managed_task_required");
  }
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = transitionLeaseAcquirer({
    databasePath: profile.database_path,
    action: "live-revoke-activation",
    binding: expectedCommit,
    authorityContextSha256,
    authorityContextProvider,
    runtimeTransitionLeaseFactory,
  });
  try {
    const currentTask = taskInspector({
      profile,
      repoRoot,
      expectedCommit,
      execFileSyncImpl,
    });
    if (!["absent", "managed_disabled"].includes(currentTask?.state)) {
      throw new Error("disabled_managed_task_required");
    }
    const receiptPath = path.resolve(profile.activation_receipt_path);
    if (!fs.existsSync(receiptPath)) {
      assertLiveTransitionLeaseAuthority(transitionLease);
      return {
        outcome: "no_op_activation_receipt_absent",
        receipt_path: normaliseWindowsPath(receiptPath),
      };
    }
    const evidenceRoot = path.join(profile.state_root, "evidence");
    assertLiveTransitionLeaseAuthority(transitionLease);
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const archivedPath = path.join(
      evidenceRoot,
      `${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}` +
        "-revoked-activation-receipt.json",
    );
    if (fs.existsSync(archivedPath)) {
      throw new Error("activation_revocation_archive_exists");
    }
    transitionLease.renew();
    fs.renameSync(receiptPath, archivedPath);
    assertLiveTransitionLeaseAuthority(transitionLease);
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
  } finally {
    transitionLease.release();
  }
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
        profilePath: options.profilePath,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        operatorId: options.operatorId,
        reason: options.reason,
        youtubeOAuthClientSha256: options.youtubeOAuthClientSha256,
        generatedAt: options.generatedAt,
      });
    },
    async install({ profile, options }) {
      return installImpl({
        profile,
        profilePath: options.profilePath,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        enabled: false,
      });
    },
    async "revoke-activation"({ report, profile, options }) {
      return revokeActivationImpl({
        profile,
        profilePath: options.profilePath,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        taskDisabledConfirmed: ["absent", "managed_disabled"].includes(
          report?.checks?.task?.state,
        ),
      });
    },
    async enable({ report, profile, options }) {
      return setEnabledImpl({
        profile,
        profilePath: options.profilePath,
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
        profilePath: options.profilePath,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        activation: report.checks.activation,
      });
    },
    async disable({ profile, options }) {
      return setEnabledImpl({
        profile,
        profilePath: options.profilePath,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        enabled: false,
        startImmediately: false,
      });
    },
    async uninstall({ profile, options }) {
      return uninstallImpl({
        profile,
        profilePath: options.profilePath,
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
    activation_receipt_sha256: report.checks.activation.receipt_sha256,
    runtime_environment: runtimeEnvironment,
  };
}

function defaultLiveWorkerTopologyProvider() {
  const { handlers } = require("../job-handlers");
  const {
    buildMultiLaneWorkerDefinitions,
  } = require("../services/multi-lane-worker-topology");
  return buildMultiLaneWorkerDefinitions({ handlers }).map((definition) => ({
    pool_id: definition.pool_id,
    instances: definition.instances,
    heartbeat_ms: definition.heartbeat_ms || 30_000,
    kinds: [...definition.kinds].sort(),
  }));
}

function trustedExpectedLiveRuntime({
  runtimeInstanceId,
  workerTopologyProvider = defaultLiveWorkerTopologyProvider,
} = {}) {
  if (typeof workerTopologyProvider !== "function") return null;
  let workerTopology;
  try {
    workerTopology = workerTopologyProvider();
  } catch {
    return null;
  }
  const expectedRuntime = {
    runtime_instance_id: runtimeInstanceId,
    worker_topology: workerTopology,
  };
  return expectedRunningWorkerHealth(expectedRuntime) ? expectedRuntime : null;
}

function expectedRunningWorkerHealth(expectedRuntime) {
  const runtimeInstanceId = String(
    expectedRuntime?.runtime_instance_id ||
      expectedRuntime?.runtimeInstanceId ||
      "",
  );
  const topology =
    expectedRuntime?.worker_topology || expectedRuntime?.workerTopology;
  if (!validRuntimeInstanceId(runtimeInstanceId) || !Array.isArray(topology)) {
    return null;
  }
  const workerIds = [];
  const pools = [];
  const seenPools = new Set();
  for (const entry of topology) {
    const poolId = String(entry?.pool_id || "");
    const instances = Number(entry?.instances);
    const heartbeatMs =
      entry?.heartbeat_ms === undefined
        ? 30_000
        : Number(entry.heartbeat_ms);
    const kinds = Array.isArray(entry?.kinds) ? entry.kinds : null;
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(poolId) ||
      !Number.isInteger(instances) ||
      instances < 1 ||
      instances > 100 ||
      seenPools.has(poolId) ||
      !Number.isInteger(heartbeatMs) ||
      heartbeatMs < 1000 ||
      heartbeatMs > 300_000 ||
      !kinds?.length ||
      kinds.some(
        (kind) =>
          typeof kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(kind),
      ) ||
      new Set(kinds).size !== kinds.length
    ) {
      return null;
    }
    seenPools.add(poolId);
    pools.push({
      pool_id: poolId,
      active_instances: instances,
      heartbeat_ms: heartbeatMs,
      kinds: [...kinds].sort(),
    });
    for (let instance = 1; instance <= instances; instance += 1) {
      workerIds.push(`server-${runtimeInstanceId}-${poolId}-${instance}`);
    }
  }
  const {
    buildRunningWorkerSetSha256,
  } = require("../services/multi-lane-runtime-observability");
  return {
    default_enabled: true,
    active_runner_count: workerIds.length,
    active_pool_count: pools.length,
    compatibility_runner_count: 0,
    pools: pools.sort((left, right) =>
      left.pool_id.localeCompare(right.pool_id),
    ),
    running_worker_set_sha256: buildRunningWorkerSetSha256(workerIds),
  };
}

function safeLiveWorkerHealth(health, expectedRuntime) {
  const observed = health?.multiLaneRuntime?.isolated_worker_pools;
  const expected = expectedRunningWorkerHealth(expectedRuntime);
  if (
    !expected ||
    !observed ||
    observed.default_enabled !== true ||
    !Number.isInteger(observed.active_runner_count) ||
    observed.active_runner_count < 1 ||
    !Number.isInteger(observed.active_pool_count) ||
    observed.active_pool_count < 1 ||
    !Number.isInteger(observed.compatibility_runner_count) ||
    observed.compatibility_runner_count !== 0 ||
    !SHA256_PATTERN.test(String(observed.running_worker_set_sha256 || "")) ||
    !Number.isSafeInteger(observed.active_claim_count) ||
    observed.active_claim_count < 0 ||
    observed.active_claim_count > 100 ||
    !SHA256_PATTERN.test(String(observed.running_claim_set_sha256 || "")) ||
    !Array.isArray(observed.pools) ||
    observed.pools.length !== observed.active_pool_count
  ) {
    return false;
  }
  const seenPools = new Set();
  const observedPools = [];
  for (const pool of observed.pools) {
    const poolId = String(pool?.pool_id || "");
    const activeInstances = Number(pool?.active_instances);
    const heartbeatMs = Number(pool?.heartbeat_ms);
    const kinds = pool?.kinds;
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(poolId) ||
      seenPools.has(poolId) ||
      !Number.isInteger(activeInstances) ||
      activeInstances < 1 ||
      activeInstances > 100 ||
      !Number.isInteger(heartbeatMs) ||
      heartbeatMs < 1000 ||
      heartbeatMs > 300_000 ||
      !Array.isArray(kinds) ||
      kinds.length === 0 ||
      kinds.some(
        (kind) =>
          typeof kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(kind),
      ) ||
      new Set(kinds).size !== kinds.length ||
      stableJson(kinds) !== stableJson([...kinds].sort())
    ) {
      return false;
    }
    seenPools.add(poolId);
    observedPools.push({
      pool_id: poolId,
      active_instances: activeInstances,
      heartbeat_ms: heartbeatMs,
      kinds,
    });
  }
  observedPools.sort((left, right) =>
    left.pool_id.localeCompare(right.pool_id),
  );
  const emptyClaimSetSha256 = require("../services/multi-lane-runtime-observability")
    .buildRunningClaimSetSha256([]);
  return (
    observed.default_enabled === expected.default_enabled &&
    observed.active_runner_count === expected.active_runner_count &&
    observed.active_pool_count === expected.active_pool_count &&
    observed.compatibility_runner_count === 0 &&
    observed.running_worker_set_sha256 === expected.running_worker_set_sha256 &&
    (observed.active_claim_count !== 0 ||
      observed.running_claim_set_sha256 === emptyClaimSetSha256) &&
    stableJson(observedPools) === stableJson(expected.pools)
  );
}

function safeLiveHealthIdentity(health, expectedCommit, expectedRuntime) {
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
    String(health?.runtime?.use_job_queue_explicit).toLowerCase() === "true" &&
    safeLiveWorkerHealth(health, expectedRuntime)
  );
}

async function inspectLiveTaskBoundHandoff({
  profile,
  supervisorPid,
  childPid,
  expectedSupervisorCreationTimeUtc,
  expectedSupervisorExecutablePath,
  expectedSupervisorCommandSha256,
  expectedChildCreationTimeUtc,
  expectedChildExecutablePath,
  expectedChildCommandSha256,
  execFileSyncImpl = execFileSync,
  runPowerShell = async ({ script }) =>
    executePowerShellJson({ script, execFileSyncImpl }),
} = {}) {
  const task = await inspectExactWindowsTaskInstances({
    taskName: profile?.task_name,
    runPowerShell,
  });
  if (
    task?.ok !== true ||
    task?.task_name !== profile?.task_name ||
    !hasNoBlockers(task) ||
    task.instances?.length !== 1
  ) {
    return { ok: false, blockers: ["live_task_instance_count_invalid"] };
  }
  const taskInstance = task.instances[0];
  if (
    !validTaskInstanceGuid(taskInstance?.instance_guid) ||
    taskInstance?.state !== 4 ||
    Number(taskInstance.engine_pid) !== Number(supervisorPid)
  ) {
    return { ok: false, blockers: ["live_task_engine_pid_mismatch"] };
  }
  const supervisor = await inspectWindowsAuthorityProcess({
    pid: supervisorPid,
    expected: {
      creation_time_utc: expectedSupervisorCreationTimeUtc,
      executable_path: expectedSupervisorExecutablePath,
      command_sha256: expectedSupervisorCommandSha256,
    },
    runPowerShell,
  });
  const child = await inspectWindowsAuthorityProcess({
    pid: childPid,
    expected: {
      creation_time_utc: expectedChildCreationTimeUtc,
      parent_pid: Number(supervisorPid),
      executable_path: expectedChildExecutablePath,
      command_sha256: expectedChildCommandSha256,
    },
    runPowerShell,
  });
  const job = await inspectCurrentWindowsJobMembership({ runPowerShell });
  if (
    supervisor?.ok !== true ||
    !hasNoBlockers(supervisor) ||
    child?.ok !== true ||
    !hasNoBlockers(child) ||
    job?.ok !== true ||
    !hasNoBlockers(job)
  ) {
    return {
      ok: false,
      blockers: ["live_task_process_authority_unavailable"],
    };
  }
  if (
    !job.process_ids.includes(Number(supervisorPid)) ||
    !job.process_ids.includes(Number(childPid))
  ) {
    return { ok: false, blockers: ["live_task_process_not_in_job"] };
  }
  return {
    ok: true,
    task_name: profile.task_name,
    task_instance: taskInstance,
    supervisor,
    child,
    job_membership: {
      process_ids: [...job.process_ids],
      supervisor_present: true,
      child_present: true,
      blockers: [],
    },
    blockers: [],
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForAbortableTimer({
  milliseconds,
  shutdownSignal = null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (shutdownSignal?.aborted) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (completed, { cancelTimer = false } = {}) => {
      if (settled) return;
      settled = true;
      shutdownSignal?.removeEventListener("abort", onAbort);
      if (cancelTimer && timer) clearTimeoutImpl(timer);
      resolve(completed);
    };
    const onAbort = () => finish(false, { cancelTimer: true });
    shutdownSignal?.addEventListener("abort", onAbort, {
      once: true,
    });
    try {
      timer = setTimeoutImpl(() => finish(true), milliseconds);
      // Recovery and health-poll waits may outlive the child/socket that
      // previously kept Node running. Keep this timer referenced until it
      // completes; an explicit shutdown still clears it through onAbort.
      if (shutdownSignal?.aborted) {
        finish(false, { cancelTimer: true });
      }
    } catch (error) {
      shutdownSignal?.removeEventListener("abort", onAbort);
      reject(error);
    }
  });
}

function waitForAbortableResult(promise, shutdownSignal) {
  if (!shutdownSignal) return Promise.resolve(promise);
  if (shutdownSignal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      shutdownSignal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => finish(null);
    shutdownSignal.addEventListener("abort", onAbort, {
      once: true,
    });
    Promise.resolve(promise).then(
      (value) => finish(value),
      (error) => finish(null, error),
    );
  });
}

async function waitForLiveHealth({
  port,
  expectedCommit,
  expectedRuntime,
  healthRequester = requestLocalHealth,
  timeoutMs = 60_000,
  intervalMs = 1000,
  shutdownSignal = null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (shutdownSignal?.aborted) return null;
    const health = await waitForAbortableResult(
      healthRequester({
        port,
        signal: shutdownSignal,
        shutdownSignal,
      }),
      shutdownSignal,
    );
    if (shutdownSignal?.aborted) return null;
    if (safeLiveHealthIdentity(health, expectedCommit, expectedRuntime)) {
      return health;
    }
    const delayCompleted = await waitForAbortableTimer({
      milliseconds: intervalMs,
      shutdownSignal,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    if (!delayCompleted) return null;
  } while (Date.now() < deadline);
  return null;
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
    throw new Error(
      terminationReason ||
        secretSafeLifecycleFailure("live_runtime_child_error", childError),
    );
  }
  throw new Error(
    terminationReason ||
      `live_runtime_exited:${code ?? "signal"}:${signal || ""}`,
  );
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
  ownerRecord = null,
  profile,
  repoRoot,
  expectedCommit,
  expectedRuntime,
  activationReceiptPath = null,
  activationInspector = inspectLiveActivationReceipt,
  healthRequester = requestLocalHealth,
  monitorIntervalMs = 15_000,
  signalEmitter = process,
  shutdownSignal = null,
  writeExitReceiptImpl,
  terminationGraceMs = 5_000,
} = {}) {
  let boundOwnerRecord = ownerRecord;
  if (!exactOwnerRecordFingerprint(boundOwnerRecord)) {
    try {
      boundOwnerRecord = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    } catch {
      throw new Error("live_supervisor_owner_cleanup_mismatch");
    }
  }
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
      removeExactLiveSupervisorOwner({
        ownerPath,
        ownerRecord: boundOwnerRecord,
      });
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
        secretSafeLifecycleFailure("live_runtime_child_error", error),
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
        writeExitReceiptImpl: writeExitReceiptImpl || (() => undefined),
      }).then(resolve, reject);
    };

    monitor = setInterval(async () => {
      if (settled || monitorInFlight) return;
      monitorInFlight = true;
      try {
        const activation = activationInspector(
          liveActivationInspectionOptions({
            profile,
            repoRoot,
            expectedCommit,
            receiptPath:
              activationReceiptPath || profile.activation_receipt_path,
          }),
        );
        if (activation.valid !== true) {
          terminateChild(
            secretSafeActivationRevocationReason(activation.blockers),
          );
          return;
        }
        if (terminationRequested) return;
        const currentHealth = await healthRequester({
          port: profile.port,
        });
        if (settled) return;
        if (
          safeLiveHealthIdentity(
            currentHealth,
            expectedCommit,
            expectedRuntime,
          )
        ) {
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
          secretSafeLifecycleFailure("live_runtime_monitor_error", error),
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
  delayImpl = null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (!delayImpl || delayImpl === delay) {
    return waitForAbortableTimer({
      milliseconds,
      shutdownSignal,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
  }
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
  delayImpl = null,
  maxRestartGenerations = 3,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
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
      let generationSession;
      try {
        generationSession = await startGenerationImpl({
          generation,
          shutdownSignal: shutdownController.signal,
        });
      } catch (error) {
        if (shutdownController.signal.aborted) {
          return {
            outcome: "stopped",
            reason: "supervisor_shutdown_during_start",
            generation,
          };
        }
        throw error;
      }
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
        setTimeoutImpl,
        clearTimeoutImpl,
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

function waitForConfirmedChildExit(child) {
  return new Promise((resolve) => {
    let settled = false;
    const onExit = (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        exit_code: code,
        signal: signal || null,
      });
    };
    child.once("exit", onExit);
    if (
      child.exitCode !== undefined &&
      (child.exitCode !== null || child.signalCode)
    ) {
      queueMicrotask(() => onExit(child.exitCode, child.signalCode || null));
    }
  });
}

async function terminateStartingLiveChild({
  child,
  terminationGraceMs = 5_000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const exit = waitForConfirmedChildExit(child);
  const onChildError = () => undefined;
  child.on("error", onChildError);
  let forceTimer = null;
  try {
    forceTimer = setTimeoutImpl(
      () => {
        forceTimer = null;
        try {
          child.kill("SIGKILL");
        } catch {
          // Exit confirmation remains authoritative.
        }
      },
      Math.max(0, Number(terminationGraceMs) || 0),
    );
    forceTimer?.unref?.();
    try {
      child.kill("SIGTERM");
    } catch {
      // Forced termination still has a bounded opportunity to run.
    }
    return await exit;
  } finally {
    if (forceTimer) clearTimeoutImpl(forceTimer);
    child.off("error", onChildError);
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
  monitorIntervalMs = 15_000,
  terminationGraceMs = 5_000,
  shutdownSignal = null,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  transitionLeaseBorrower = borrowLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  transitionAuthorityContextProvider,
  processIdentityInspector = inspectWindowsProcessIdentity,
  platform = process.platform,
  profileLoader = loadLiveGuardedRuntimeProfile,
  doctorBuilder = buildLiveRuntimeDoctorReport,
  supervisionPreparer = prepareLiveSupervision,
  activationInspector = inspectLiveActivationReceipt,
  startOperationInspector = inspectLiveStartOperationLock,
  ownerWriter = writeJsonAtomic,
  lifecycleReceiptWriter = writeLiveLifecycleReceipt,
  taskAuthorityObserver = inspectLiveTaskBoundHandoff,
  workerTopologyProvider = defaultLiveWorkerTopologyProvider,
} = {}) {
  assertWindowsLifecycleHost(platform);
  if (listenerInspector === inspectWindowsListeners) {
    listenerInspector = (options) => {
      const result = inspectWindowsListeners(options);
      return {
        ...result,
        blockers:
          result?.available === true
            ? []
            : ["windows_listener_inspection_unavailable"],
      };
    };
  }
  if (shutdownSignal?.aborted) {
    throw new Error("live_supervision_start_aborted");
  }
  const profile = profileLoader({ profilePath });
  const report = doctorBuilder({
    action: "doctor",
    repoRoot,
    expectedCommit,
    profilePath,
    activationReceiptPath,
  });
  const prepared = supervisionPreparer({
    report,
    profile,
    expectedCommit,
    systemEnvironment,
  });
  const freshActivation = activationInspector(
    liveActivationInspectionOptions({
      profile,
      repoRoot,
      expectedCommit,
      receiptPath: activationReceiptPath || profile.activation_receipt_path,
    }),
  );
  if (
    freshActivation.valid !== true ||
    freshActivation.receipt_sha256 !== prepared.activation_receipt_sha256
  ) {
    throw new Error("exact_live_activation_receipt_required");
  }
  const expectedRuntime = trustedExpectedLiveRuntime({
    runtimeInstanceId: freshActivation.runtime_instance_id,
    workerTopologyProvider,
  });
  if (!expectedRuntime) {
    throw new Error("live_worker_topology_authority_invalid");
  }
  const startOperation = startOperationInspector({
    profile,
    expectedCommit,
    activationReceiptSha256: freshActivation.receipt_sha256,
  });
  if (startOperation.present && startOperation.valid !== true) {
    throw new Error(
      `live_start_operation_lock_invalid:${(startOperation.blockers || []).join(
        ",",
      )}`,
    );
  }
  const authorityContextProvider = liveTransitionAuthorityContextProvider({
    profile,
    profilePath,
    repoRoot,
    expectedCommit,
    transitionAuthorityContextProvider,
  });
  const authorityContextSha256 = authorityContextProvider();
  const transitionLease = startOperation.present
    ? transitionLeaseBorrower({
        databasePath: profile.database_path,
        expectedOwnerId: `live-start:${startOperation.operation_nonce}`,
        authorityContextSha256,
        authorityContextProvider,
        runtimeTransitionLeaseFactory,
      })
    : transitionLeaseAcquirer({
        databasePath: profile.database_path,
        action: "live-supervise",
        binding: expectedCommit,
        authorityContextSha256,
        authorityContextProvider,
        runtimeTransitionLeaseFactory,
      });
  let child = null;
  let childHandedOff = false;
  let childTerminationAttempted = false;
  let transitionLeaseReleased = false;
  let ownerPath = null;
  let ownerRecord = null;
  let supervisorIdentity = null;
  const assertLeasedAuthority = () => {
    transitionLease.renew();
    const currentActivation = activationInspector(
      liveActivationInspectionOptions({
        profile,
        repoRoot,
        expectedCommit,
        receiptPath: activationReceiptPath || profile.activation_receipt_path,
      }),
    );
    if (
      currentActivation.valid !== true ||
      currentActivation.receipt_sha256 !== prepared.activation_receipt_sha256
    ) {
      throw new Error("exact_live_activation_receipt_required");
    }
    const currentStartOperation = startOperationInspector({
      profile,
      expectedCommit,
      activationReceiptSha256: currentActivation.receipt_sha256,
    });
    if (
      currentStartOperation.present !== startOperation.present ||
      (startOperation.present &&
        (currentStartOperation.valid !== true ||
          currentStartOperation.operation_nonce !==
            startOperation.operation_nonce))
    ) {
      throw new Error("live_start_operation_lock_drift");
    }
    return currentActivation;
  };
  try {
    assertLeasedAuthority();
    supervisorIdentity = captureProcessIdentity({
      pid: process.pid,
      processIdentityInspector,
      unavailableCode: "live_supervisor_process_identity_unavailable",
    });
    const listeners = listenerInspector({ port: profile.port });
    if (
      listeners?.available !== true ||
      !Array.isArray(listeners.listeningPids) ||
      listeners.listeningPids.length !== 0
    ) {
      throw new Error("live_supervisor_port_not_free");
    }

    ownerPath = path.join(profile.state_root, "supervisor-owner.json");
    if (fs.existsSync(ownerPath)) {
      let staleOwner = null;
      try {
        staleOwner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      } catch {
        throw new Error("live_supervisor_owner_receipt_invalid");
      }
      const staleReviewedProcessAuthority = reviewedLiveProcessAuthority({
        profile,
        repoRoot,
        expectedCommit,
        activation: freshActivation,
      });
      const staleOwnerCommonExact =
        ["pulse-windows-live-guarded-owner-v1", LIVE_OWNER_SCHEMA].includes(
          staleOwner?.schema_version,
        ) &&
        staleOwner?.profile_sha256 === profileFingerprint(profile) &&
        staleOwner?.commit_sha === String(expectedCommit).toLowerCase() &&
        staleOwner?.activation_receipt_sha256 ===
          report.checks.activation.receipt_sha256 &&
        normaliseProcessStartedAt(staleOwner?.supervisor_process_started_at) !==
          null &&
        normaliseProcessStartedAt(staleOwner?.child_process_started_at) !==
          null;
      const staleOwnerExact =
        staleOwnerCommonExact &&
        (staleOwner.schema_version !== LIVE_OWNER_SCHEMA ||
          validateExactStaleOwnerV2Authority({
            owner: staleOwner,
            profile,
            repoRoot,
            expectedCommit,
            activation: freshActivation,
            reviewedProcessAuthority: staleReviewedProcessAuthority,
          }));
      if (!staleOwnerExact) {
        throw new Error("live_supervisor_owner_receipt_mismatch");
      }
      const staleSupervisorIdentity = inspectBoundProcessIdentity({
        pid: staleOwner.supervisor_pid,
        processStartedAt: staleOwner.supervisor_process_started_at,
        processIdentityInspector,
      });
      const staleChildIdentity = inspectBoundProcessIdentity({
        pid: staleOwner.child_pid,
        processStartedAt: staleOwner.child_process_started_at,
        processIdentityInspector,
      });
      if (
        staleSupervisorIdentity.available !== true ||
        staleChildIdentity.available !== true
      ) {
        throw new Error("live_supervisor_owner_process_identity_unavailable");
      }
      if (
        staleSupervisorIdentity.alive === true ||
        staleChildIdentity.alive === true
      ) {
        throw new Error("live_supervisor_previous_child_still_running");
      }
      const archivedPath = path.join(
        profile.state_root,
        "evidence",
        `${new Date().toISOString().replace(/[:.]/g, "-")}` +
          `-stale-supervisor-owner-${staleOwner.child_pid}.json`,
      );
      assertLiveTransitionLeaseAuthority(transitionLease);
      fs.mkdirSync(path.dirname(archivedPath), { recursive: true });
      assertLiveTransitionLeaseAuthority(transitionLease);
      fs.renameSync(ownerPath, archivedPath);
    }

    const logRoot = path.join(profile.state_root, "logs");
    assertLiveTransitionLeaseAuthority(transitionLease);
    fs.mkdirSync(logRoot, { recursive: true });
    const stdoutPath = path.join(logRoot, "runtime.stdout.log");
    const stderrPath = path.join(logRoot, "runtime.stderr.log");
    let stdoutFd = null;
    let stderrFd = null;
    try {
      assertLiveTransitionLeaseAuthority(transitionLease);
      stdoutFd = fs.openSync(stdoutPath, "a");
      assertLiveTransitionLeaseAuthority(transitionLease);
      stderrFd = fs.openSync(stderrPath, "a");
      assertLiveTransitionLeaseAuthority(transitionLease);
      child = spawnImpl(process.execPath, ["server.js"], {
        cwd: fs.realpathSync.native(path.resolve(repoRoot)),
        env: prepared.runtime_environment,
        detached: false,
        windowsHide: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } finally {
      if (stdoutFd !== null) fs.closeSync(stdoutFd);
      if (stderrFd !== null) fs.closeSync(stderrFd);
    }
    if (!child?.pid) {
      throw new Error("live_runtime_process_start_failed");
    }
    let health = null;
    let healthError = null;
    try {
      health = await waitForLiveHealth({
        port: profile.port,
        expectedCommit,
        expectedRuntime,
        healthRequester,
        shutdownSignal,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
    } catch (error) {
      healthError = error;
    }
    if (!health || healthError || shutdownSignal?.aborted) {
      childTerminationAttempted = true;
      await terminateStartingLiveChild({
        child,
        terminationGraceMs,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
      if (shutdownSignal?.aborted) {
        throw new Error("live_supervision_start_aborted");
      }
      if (healthError) throw healthError;
      throw new Error("live_runtime_health_verification_failed");
    }

    const handoffActivation = assertLeasedAuthority();
    const handoffSupervisorIdentity = captureProcessIdentity({
      pid: process.pid,
      processIdentityInspector,
      unavailableCode: "live_supervisor_process_identity_unavailable",
    });
    if (
      handoffSupervisorIdentity.process_started_at !==
      supervisorIdentity.process_started_at
    ) {
      throw new Error("live_supervisor_process_identity_drift");
    }
    const childIdentity = captureProcessIdentity({
      pid: child.pid,
      processIdentityInspector,
      unavailableCode: "live_child_process_identity_unavailable",
    });
    if (
      handoffActivation?.schema_version !== LIVE_ACTIVATION_SCHEMA ||
      !validRuntimeInstanceId(handoffActivation?.runtime_instance_id) ||
      !SHA256_PATTERN.test(
        String(handoffActivation?.authority_fingerprint || ""),
      ) ||
      !validateStaticAuthorityBinding(handoffActivation?.authority_binding) ||
      !SHA256_PATTERN.test(
        String(handoffActivation?.task_definition_sha256 || ""),
      )
    ) {
      throw new Error("live_activation_task_authority_required");
    }
    const expectedSupervisorExecutablePath =
      handoffActivation.authority_binding.node_path;
    const expectedSupervisorCommandSha256 =
      handoffActivation.task_definition_sha256;
    const expectedChildExecutablePath =
      handoffActivation.authority_binding.node_path;
    const expectedProcessCommands = buildLiveProcessCommandAuthority({
      profile,
      repoRoot: handoffActivation.authority_binding.checkout_real_path,
      expectedCommit,
      nodeExecutable: expectedChildExecutablePath,
    });
    if (
      expectedProcessCommands.supervisor_command_sha256 !==
      expectedSupervisorCommandSha256
    ) {
      throw new Error("live_activation_task_command_authority_mismatch");
    }
    const expectedChildCommandSha256 =
      expectedProcessCommands.child_command_sha256;
    const taskAuthority = await taskAuthorityObserver({
      profile,
      supervisorPid: process.pid,
      childPid: Number(child.pid),
      expectedSupervisorCreationTimeUtc:
        handoffSupervisorIdentity.process_started_at,
      expectedSupervisorExecutablePath,
      expectedSupervisorCommandSha256,
      expectedChildCreationTimeUtc: childIdentity.process_started_at,
      expectedChildExecutablePath,
      expectedChildCommandSha256,
    });
    const handoffListeners = listenerInspector({ port: profile.port });
    if (
      taskAuthority?.ok !== true ||
      !validateObservedLiveAuthorityEvidence(taskAuthority) ||
      Number(taskAuthority?.task_instance?.engine_pid) !== process.pid ||
      Number(taskAuthority?.supervisor?.pid) !== process.pid ||
      taskAuthority?.supervisor?.creation_time_utc !==
        handoffSupervisorIdentity.process_started_at ||
      canonicalPath(
        taskAuthority?.supervisor?.executable_path,
      ).toLowerCase() !==
        canonicalPath(expectedSupervisorExecutablePath).toLowerCase() ||
      taskAuthority?.supervisor?.command_sha256 !==
        expectedSupervisorCommandSha256 ||
      Number(taskAuthority?.child?.pid) !== Number(child.pid) ||
      taskAuthority?.child?.creation_time_utc !==
        childIdentity.process_started_at ||
      Number(taskAuthority?.child?.parent_pid) !== process.pid ||
      canonicalPath(taskAuthority?.child?.executable_path).toLowerCase() !==
        canonicalPath(expectedChildExecutablePath).toLowerCase() ||
      taskAuthority?.child?.command_sha256 !== expectedChildCommandSha256 ||
      !Array.isArray(taskAuthority?.job_membership?.process_ids) ||
      !taskAuthority.job_membership.process_ids.includes(process.pid) ||
      !taskAuthority.job_membership.process_ids.includes(Number(child.pid)) ||
      taskAuthority?.job_membership?.supervisor_present !== true ||
      taskAuthority?.job_membership?.child_present !== true ||
      handoffListeners?.available !== true ||
      !Array.isArray(handoffListeners?.listeningPids) ||
      handoffListeners.listeningPids.length !== 1 ||
      Number(handoffListeners.listeningPids[0]) !== Number(child.pid) ||
      !hasNoBlockers(handoffListeners)
    ) {
      throw new Error("live_task_handoff_authority_mismatch");
    }
    assertLiveTransitionLeaseAuthority(transitionLease);
    lifecycleReceiptWriter({
      profile,
      action: "supervise-start",
      expectedCommit,
      details: {
        supervisor_pid: process.pid,
        supervisor_process_started_at:
          handoffSupervisorIdentity.process_started_at,
        child_pid: Number(child.pid),
        child_process_started_at: childIdentity.process_started_at,
        owner_receipt_path: normaliseWindowsPath(ownerPath),
        activation_receipt_sha256: handoffActivation.receipt_sha256,
        start_operation_nonce: startOperation.operation_nonce || null,
      },
    });
    assertLiveTransitionLeaseAuthority(transitionLease);
    ownerRecord = {
      schema_version: LIVE_OWNER_SCHEMA,
      generated_at: new Date().toISOString(),
      runtime_instance_id: handoffActivation.runtime_instance_id,
      task_name: profile.task_name,
      task_instance_guid: taskAuthority.task_instance.instance_guid,
      engine_pid: taskAuthority.task_instance.engine_pid,
      supervisor_pid: process.pid,
      supervisor_process_started_at:
        handoffSupervisorIdentity.process_started_at,
      supervisor_creation_time_utc: taskAuthority.supervisor.creation_time_utc,
      supervisor_executable_path: taskAuthority.supervisor.executable_path,
      supervisor_command_sha256: taskAuthority.supervisor.command_sha256,
      child_pid: Number(child.pid),
      child_process_started_at: childIdentity.process_started_at,
      child_creation_time_utc: taskAuthority.child.creation_time_utc,
      child_parent_pid: taskAuthority.child.parent_pid,
      child_executable_path: taskAuthority.child.executable_path,
      child_command_sha256: taskAuthority.child.command_sha256,
      child_in_job: true,
      listener_port: profile.port,
      listener_pid: Number(child.pid),
      port: profile.port,
      repo_root: normaliseWindowsPath(path.resolve(repoRoot)),
      commit_sha: String(expectedCommit).toLowerCase(),
      release_sha: String(expectedCommit).toLowerCase(),
      profile_sha256: profileFingerprint(profile),
      database_identity_sha256:
        handoffActivation.authority_binding.database_identity_sha256,
      authority_binding: handoffActivation.authority_binding,
      authority_fingerprint: handoffActivation.authority_fingerprint,
      activation_receipt_sha256: handoffActivation.receipt_sha256,
      start_operation_nonce: startOperation.operation_nonce || null,
      platform: "youtube",
    };
    try {
      transitionLease.sealForHandoff({
        childParticipantIdentity: {
          process_id: childIdentity.process_id,
          process_started_at: childIdentity.process_started_at,
          process_start_source: "windows-cim",
        },
      });
      if (transitionLease.borrowed === true) {
        transitionLeaseReleased = true;
      }
    } catch {
      throw new Error("live_runtime_transition_handoff_seal_failed");
    }
    assertLiveTransitionAuthorityContext(
      authorityContextProvider,
      authorityContextSha256,
    );
    ownerWriter(ownerPath, ownerRecord);
    if (transitionLease.borrowed !== true) {
      try {
        transitionLease.release();
        transitionLeaseReleased = true;
      } catch {
        throw new Error("live_runtime_transition_lease_release_failed");
      }
    }
    childHandedOff = true;
    return {
      child,
      ownerPath,
      ownerRecord,
      profile,
      repoRoot,
      expectedCommit,
      expectedRuntime,
      activationReceiptPath,
      healthRequester,
      monitorIntervalMs,
      writeExitReceiptImpl(details) {
        assertLiveTransitionAuthorityContext(
          authorityContextProvider,
          authorityContextSha256,
        );
        writeLiveLifecycleReceipt({
          profile,
          action: "supervise-exit",
          expectedCommit,
          details,
        });
      },
      terminationGraceMs,
    };
  } catch (error) {
    if (child?.pid && !childHandedOff && !childTerminationAttempted) {
      childTerminationAttempted = true;
      await terminateStartingLiveChild({
        child,
        terminationGraceMs,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
    }
    if (ownerPath && ownerRecord && fs.existsSync(ownerPath)) {
      try {
        removeExactLiveSupervisorOwner({ ownerPath, ownerRecord });
      } catch (cleanupError) {
        throw new Error(
          secretSafeLifecycleFailure(
            "live_supervision_start_cleanup_failed",
            cleanupError,
          ),
        );
      }
    }
    throw error;
  } finally {
    if (!transitionLeaseReleased) {
      try {
        transitionLease.release();
        transitionLeaseReleased = true;
      } catch {
        // The durable transition fence remains fail-safe. Any live child
        // has already been terminated by the guarded catch path.
      }
    }
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
  monitorIntervalMs = 15_000,
  restartDelayMs = 15_000,
  delayImpl = null,
  terminationGraceMs = 5_000,
  maxRestartGenerations = 3,
  signalEmitter = process,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  transitionLeaseAcquirer = acquireLiveRuntimeTransitionLease,
  transitionLeaseBorrower = borrowLiveRuntimeTransitionLease,
  runtimeTransitionLeaseFactory,
  processIdentityInspector = inspectWindowsProcessIdentity,
} = {}) {
  return runLiveSupervisionLifecycle({
    signalEmitter,
    restartDelayMs,
    delayImpl,
    maxRestartGenerations,
    setTimeoutImpl,
    clearTimeoutImpl,
    startGenerationImpl: ({ shutdownSignal }) =>
      startLiveSupervisionGeneration({
        repoRoot,
        expectedCommit,
        profilePath,
        activationReceiptPath,
        systemEnvironment,
        spawnImpl,
        listenerInspector,
        healthRequester,
        monitorIntervalMs,
        terminationGraceMs,
        shutdownSignal,
        setTimeoutImpl,
        clearTimeoutImpl,
        transitionLeaseAcquirer,
        transitionLeaseBorrower,
        runtimeTransitionLeaseFactory,
        processIdentityInspector,
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
    throw new Error(`live_lifecycle_handler_unavailable:${report.action}`);
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
    profile.conflicting_task_names[0] !== "PulseGaming-Stabilisation-Runtime"
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
    normaliseWindowsPath(profile?.database_path) !== "D:/pulse-data/pulse.db"
  ) {
    blockers.push("database_path_invalid");
  }
  if (normaliseWindowsPath(profile?.media_root) !== "D:/pulse-data/media") {
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
    profile?.platform_policy?.oauth_client_sha256_bound_to_activation !== true
  ) {
    blockers.push("youtube_only_control_policy_invalid");
  }

  const environment =
    profile?.environment &&
    typeof profile.environment === "object" &&
    !Array.isArray(profile.environment)
      ? profile.environment
      : {};
  for (const [key, expected] of Object.entries(LIVE_REQUIRED_ENVIRONMENT)) {
    if (environment[key] !== expected) {
      blockers.push(`unsafe_environment:${key}`);
    }
  }
  for (const key of Object.keys(environment)) {
    if (!Object.prototype.hasOwnProperty.call(LIVE_REQUIRED_ENVIRONMENT, key)) {
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
  buildLiveProcessCommandAuthority,
  buildLiveScheduledTaskCommand,
  buildLiveScheduledTaskXml,
  buildLiveRuntimeDoctorReport,
  buildLiveTaskAuthorityBinding,
  buildMigrationManifest,
  acquireLiveStartOperationLock,
  archiveExactStaleLiveOwner,
  createDefaultLiveLifecycleHandlers,
  currentLiveTransitionAuthorityContext,
  executeLiveLifecycleAction,
  inspectLiveActivationReceipt,
  inspectLiveDatabaseIdentity,
  inspectBoundedWindowsAuthority,
  inspectWindowsProcessIdentity,
  inspectLiveStartOperationLock,
  inspectStoppedLiveRuntime,
  inspectLiveTaskConflicts,
  inspectLiveTaskBoundHandoff,
  inspectLiveWindowsTask,
  installLiveScheduledTask,
  issueLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile,
  prepareLiveSupervision,
  receiptFingerprint,
  releaseLiveStartOperationLock,
  safeLiveHealthIdentity,
  superviseLiveChildSession,
  waitForLiveHealth,
  runLiveSupervisionLifecycle,
  runLiveSupervision,
  revokeLiveActivationReceipt,
  setLiveScheduledTaskEnabled,
  startLiveScheduledTask,
  startLiveSupervisionGeneration,
  uninstallLiveScheduledTask,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
};
