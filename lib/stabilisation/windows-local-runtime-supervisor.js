"use strict";

const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Database = require("better-sqlite3");
const { parseRuntimeConfig } = require("./runtime-config");

const DEFAULT_PROFILE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "config",
  "windows-local-runtime.stabilisation.json",
);

const REQUIRED_ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_MODE: "local",
  PORT: "3001",
  CHANNEL: "pulse-gaming",
  SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
  MEDIA_ROOT: "D:/pulse-data/media",
  USE_SQLITE: "true",
  USE_JOB_QUEUE: "true",
  PULSE_PRIMARY_INSTANCE: "true",
  PULSE_OPERATING_MODE: "HUMAN_REVIEW",
  OPERATING_MODE: "HUMAN_REVIEW",
  PULSE_SCHEDULER_PROFILE: "stabilisation_30d",
  PULSE_STANDARD_RENDERER: "studio-v21",
  PULSE_EXPERIMENTAL_RENDERER: "disabled",
  AUTO_PUBLISH: "false",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
  PULSE_EMERGENCY_KILL_SWITCH: "true",
  PULSE_KILL_SWITCH: "true",
  YOUTUBE_AUTO_PUBLISH: "false",
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
const LIFECYCLE_CONFIRMATION = "SAFE_HUMAN_REVIEW_RUNTIME";
const LIFECYCLE_ACTIONS = Object.freeze([
  "plan",
  "status",
  "install",
  "start",
  "restart",
  "stop",
  "uninstall",
]);

function normaliseWindowsPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function loadSafeRuntimeProfile({ profilePath = DEFAULT_PROFILE_PATH } = {}) {
  return JSON.parse(fs.readFileSync(profilePath, "utf8"));
}

function validateSafeRuntimeProfile(profile) {
  const blockers = [];
  if (
    profile?.schema_version !== "pulse-windows-local-runtime-profile-v1"
  ) {
    blockers.push("profile_schema_invalid");
  }
  if (profile?.profile_id !== "pulse-v1-stabilisation-human-review") {
    blockers.push("profile_identity_invalid");
  }
  if (profile?.runtime_owner_id !== "pulse-v1-windows-local-primary") {
    blockers.push("runtime_owner_invalid");
  }
  if (profile?.task_name !== "PulseGaming-Stabilisation-Runtime") {
    blockers.push("task_name_invalid");
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
    normaliseWindowsPath(profile?.media_root) !== "D:/pulse-data/media"
  ) {
    blockers.push("media_root_invalid");
  }
  if (
    normaliseWindowsPath(profile?.state_root) !==
    "D:/pulse-data/runtime/pulse-v1"
  ) {
    blockers.push("state_root_invalid");
  }

  const environment =
    profile?.environment && typeof profile.environment === "object"
      ? profile.environment
      : {};
  for (const [key, expected] of Object.entries(REQUIRED_ENVIRONMENT)) {
    if (environment[key] !== expected) {
      blockers.push(`unsafe_environment:${key}`);
    }
  }
  for (const key of Object.keys(environment)) {
    if (!Object.prototype.hasOwnProperty.call(REQUIRED_ENVIRONMENT, key)) {
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

function gitText(args, { repoRoot, execFileSyncImpl = execFileSync } = {}) {
  return String(
    execFileSyncImpl("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).trim();
}

function inspectCheckout({
  repoRoot,
  expectedCommit,
  expectedBranch = "release/pulse-v1",
  allowDetachedHead = true,
  execFileSyncImpl = execFileSync,
} = {}) {
  const blockers = [];
  const resolvedRoot = path.resolve(String(repoRoot || ""));
  const report = {
    ready: false,
    repo_root: resolvedRoot,
    commit_sha: null,
    expected_commit_sha: expectedCommit || null,
    branch: null,
    expected_branch: expectedBranch,
    clean: false,
    dirty_entry_count: null,
    repository_root_matches: false,
    entrypoint_present: false,
    supervisor_present: false,
    blockers,
  };
  if (!repoRoot || !fs.existsSync(resolvedRoot)) {
    blockers.push("repository_root_missing");
    return report;
  }
  if (!/^[a-f0-9]{40,64}$/i.test(String(expectedCommit || ""))) {
    blockers.push("expected_commit_required");
  }

  try {
    const gitRoot = path.resolve(
      gitText(["rev-parse", "--show-toplevel"], {
        repoRoot: resolvedRoot,
        execFileSyncImpl,
      }),
    );
    report.repository_root_matches =
      normaliseWindowsPath(gitRoot).toLowerCase() ===
      normaliseWindowsPath(resolvedRoot).toLowerCase();
    if (!report.repository_root_matches) {
      blockers.push("repository_root_mismatch");
    }

    report.commit_sha = gitText(["rev-parse", "HEAD"], {
      repoRoot: resolvedRoot,
      execFileSyncImpl,
    });
    if (
      /^[a-f0-9]{40,64}$/i.test(String(expectedCommit || "")) &&
      report.commit_sha.toLowerCase() !== String(expectedCommit).toLowerCase()
    ) {
      blockers.push("source_commit_mismatch");
    }

    const branch = gitText(["rev-parse", "--abbrev-ref", "HEAD"], {
      repoRoot: resolvedRoot,
      execFileSyncImpl,
    });
    report.branch = branch === "HEAD" ? "DETACHED" : branch;
    if (
      report.branch !== expectedBranch &&
      !(allowDetachedHead && report.branch === "DETACHED")
    ) {
      blockers.push("source_branch_mismatch");
    }

    const status = gitText(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      {
        repoRoot: resolvedRoot,
        execFileSyncImpl,
      },
    );
    report.dirty_entry_count = status
      ? status.split(/\r?\n/).filter(Boolean).length
      : 0;
    report.clean = report.dirty_entry_count === 0;
    if (!report.clean) blockers.push("source_checkout_dirty");
  } catch {
    blockers.push("git_inspection_failed");
  }

  report.entrypoint_present =
    fs.existsSync(path.join(resolvedRoot, "server.js")) &&
    fs.existsSync(path.join(resolvedRoot, "package.json"));
  if (!report.entrypoint_present) blockers.push("runtime_entrypoint_missing");
  report.supervisor_present = fs.existsSync(
    path.join(
      resolvedRoot,
      "tools",
      "windows-local-runtime-supervisor.js",
    ),
  );
  if (!report.supervisor_present) blockers.push("runtime_supervisor_missing");
  report.blockers = [...new Set(blockers)];
  report.ready = report.blockers.length === 0;
  return report;
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath, "utf8"))
    .digest("hex");
}

function firstPragmaValue(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const values = Object.values(rows[0] || {});
  return values.length ? String(values[0]).trim().toLowerCase() : null;
}

function inspectDatabase({
  dbPath,
  migrationsDir,
  DatabaseImpl = Database,
} = {}) {
  const resolvedDbPath = path.resolve(String(dbPath || ""));
  const resolvedMigrationsDir = path.resolve(String(migrationsDir || ""));
  const blockers = [];
  const report = {
    ready: false,
    read_only: true,
    database_path: normaliseWindowsPath(dbPath),
    exists: false,
    quick_check: "not_run",
    integrity_check: "not_run",
    foreign_key_check: "not_run",
    expected_migration_count: 0,
    applied_migration_count: 0,
    latest_expected_version: null,
    latest_applied_version: null,
    pending: [],
    checksum_mismatches: [],
    unexpected_applied: [],
    blockers,
  };
  if (!dbPath || !fs.existsSync(resolvedDbPath)) {
    blockers.push("database_file_missing");
    return report;
  }
  report.exists = fs.statSync(resolvedDbPath).isFile();
  if (!report.exists) {
    blockers.push("database_path_not_file");
    return report;
  }
  if (
    !migrationsDir ||
    !fs.existsSync(resolvedMigrationsDir) ||
    !fs.statSync(resolvedMigrationsDir).isDirectory()
  ) {
    blockers.push("migrations_directory_missing");
    return report;
  }

  const migrationFiles = fs
    .readdirSync(resolvedMigrationsDir)
    .filter((filename) => /^\d{3}_.+\.sql$/.test(filename))
    .sort();
  const expected = migrationFiles.map((filename) => ({
    version: filename.slice(0, 3),
    filename,
    checksum: sha256File(path.join(resolvedMigrationsDir, filename)),
  }));
  report.expected_migration_count = expected.length;
  report.latest_expected_version = expected.at(-1)?.version || null;
  if (!expected.length) blockers.push("migration_set_empty");
  if (new Set(expected.map((row) => row.version)).size !== expected.length) {
    blockers.push("duplicate_migration_version");
  }

  let db;
  try {
    db = new DatabaseImpl(resolvedDbPath, {
      readonly: true,
      fileMustExist: true,
    });
    db.pragma("query_only = ON");
    report.quick_check = firstPragmaValue(
      db.prepare("PRAGMA quick_check").all(),
    );
    report.integrity_check = firstPragmaValue(
      db.prepare("PRAGMA integrity_check").all(),
    );
    report.foreign_key_check =
      db.prepare("PRAGMA foreign_key_check").all().length === 0
        ? "ok"
        : "failed";
    if (report.quick_check !== "ok") blockers.push("database_quick_check_failed");
    if (report.integrity_check !== "ok") {
      blockers.push("database_integrity_check_failed");
    }
    if (report.foreign_key_check !== "ok") {
      blockers.push("database_foreign_key_check_failed");
    }

    const table = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get();
    if (!table) {
      blockers.push("schema_migrations_table_missing");
    } else {
      const applied = db
        .prepare(
          `SELECT version, filename, checksum
           FROM schema_migrations
           ORDER BY version`,
        )
        .all()
        .map((row) => ({
          version: String(row.version),
          filename: String(row.filename),
          checksum: String(row.checksum),
        }));
      report.applied_migration_count = applied.length;
      report.latest_applied_version = applied.at(-1)?.version || null;
      const appliedByVersion = new Map(
        applied.map((row) => [row.version, row]),
      );
      const expectedByVersion = new Map(
        expected.map((row) => [row.version, row]),
      );
      report.pending = expected
        .filter((row) => !appliedByVersion.has(row.version))
        .map((row) => row.filename);
      report.checksum_mismatches = expected
        .filter((row) => {
          const current = appliedByVersion.get(row.version);
          return (
            current &&
            (current.filename !== row.filename ||
              current.checksum !== row.checksum)
          );
        })
        .map((row) => row.filename);
      report.unexpected_applied = applied
        .filter((row) => !expectedByVersion.has(row.version))
        .map((row) => row.filename);
      if (report.pending.length) blockers.push("database_migrations_pending");
      if (report.checksum_mismatches.length) {
        blockers.push("database_migration_checksum_mismatch");
      }
      if (report.unexpected_applied.length) {
        blockers.push("database_schema_ahead_of_source");
      }
    }
  } catch {
    blockers.push("database_read_only_inspection_failed");
  } finally {
    try {
      db?.close();
    } catch {
      blockers.push("database_close_failed");
    }
  }

  report.blockers = [...new Set(blockers)];
  report.ready = report.blockers.length === 0;
  return report;
}

function profileFingerprint(profile) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex");
}

function buildChildEnvironment({
  profile,
  expectedCommit,
  systemEnvironment = process.env,
} = {}) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(expectedCommit || ""))) {
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
    RAILWAY_GIT_COMMIT_SHA: String(expectedCommit).toLowerCase(),
    RAILWAY_GIT_BRANCH: profile.expected_branch,
  });
  const parsed = parseRuntimeConfig(environment);
  if (!parsed.valid) {
    throw new Error(
      `safe_runtime_profile_invalid:${parsed.errors.join(",")}`,
    );
  }
  if (parsed.operating_contract.live_mutation_allowed) {
    throw new Error("safe_runtime_profile_can_mutate_live_platform");
  }
  return environment;
}

function classifyPortOwnership({
  listeningPids = [],
  ownerState = null,
  processObservations = [],
  health = null,
  expectedCommit,
  repoRoot,
  profile,
} = {}) {
  const listenerPids = [
    ...new Set(
      listeningPids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ].sort((left, right) => left - right);
  const blockers = [];
  const report = {
    state: "unknown",
    port: profile?.port || 3001,
    listener_pids: listenerPids,
    owner_pid: Number(ownerState?.pid) || null,
    process_identity_safe: false,
    health_safe: false,
    blockers,
  };

  if (listenerPids.length === 0) {
    if (ownerState) {
      blockers.push("stale_runtime_owner_receipt");
      report.state = "stale_owner";
    } else {
      report.state = "free";
    }
    return report;
  }
  if (listenerPids.length !== 1) {
    blockers.push("multiple_port_owners");
    report.state = "foreign";
    return report;
  }
  if (!ownerState || typeof ownerState !== "object") {
    blockers.push("runtime_owner_receipt_missing");
    report.state = "foreign";
    return report;
  }

  const ownerPid = Number(ownerState.pid);
  const processObservation = processObservations.find(
    (entry) => Number(entry?.pid) === ownerPid,
  );
  const ownerMatches =
    ownerState.schema_version === "pulse-windows-local-runtime-owner-v1" &&
    ownerState.runtime_owner_id === profile?.runtime_owner_id &&
    ownerPid === listenerPids[0] &&
    Number(ownerState.port) === Number(profile?.port) &&
    String(ownerState.commit_sha || "").toLowerCase() ===
      String(expectedCommit || "").toLowerCase() &&
    normaliseWindowsPath(ownerState.repo_root).toLowerCase() ===
      normaliseWindowsPath(repoRoot).toLowerCase() &&
    ownerState.profile_fingerprint === profileFingerprint(profile);
  if (!ownerMatches) blockers.push("runtime_owner_receipt_mismatch");

  report.process_identity_safe =
    processObservation?.running === true &&
    processObservation.command_identity === "node_server_js";
  if (!report.process_identity_safe) {
    blockers.push("runtime_process_identity_mismatch");
  }

  report.health_safe =
    String(health?.build?.commit_sha || "").toLowerCase() ===
      String(expectedCommit || "").toLowerCase() &&
    health?.deployment?.mode === "local" &&
    health?.deployment?.primary === true &&
    health?.runtime?.operating_mode === "HUMAN_REVIEW" &&
    health?.runtime?.auto_publish === false &&
    health?.runtime?.legacy_auto_publish_armed === false &&
    health?.runtime?.use_sqlite === true &&
    String(health?.runtime?.use_job_queue_explicit).toLowerCase() === "true";
  if (!report.health_safe) blockers.push("runtime_health_identity_mismatch");

  if (ownerMatches && report.process_identity_safe) {
    report.state = report.health_safe ? "managed_current" : "managed_unhealthy";
  } else {
    report.state = "foreign";
  }
  report.blockers = [...new Set(blockers)];
  return report;
}

function powershellJson(
  source,
  { execFileSyncImpl = execFileSync } = {},
) {
  const output = String(
    execFileSyncImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        source,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ) || "",
  ).trim();
  return output ? JSON.parse(output) : null;
}

function inspectWindowsListeners({
  port = 3001,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (process.platform !== "win32") {
    return { listeningPids: [], available: false };
  }
  try {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort !== 3001) {
      return { listeningPids: [], available: false };
    }
    const result = powershellJson(
      `$items = @(Get-NetTCPConnection -LocalPort ${numericPort} ` +
        "-State Listen -ErrorAction SilentlyContinue | " +
        "Select-Object -ExpandProperty OwningProcess -Unique); " +
        "@($items) | ConvertTo-Json -Compress",
      { execFileSyncImpl },
    );
    return {
      listeningPids: Array.isArray(result)
        ? result
        : result === null
          ? []
          : [result],
      available: true,
    };
  } catch {
    return { listeningPids: [], available: false };
  }
}

function inspectWindowsProcesses(
  pids,
  { execFileSyncImpl = execFileSync } = {},
) {
  const safePids = [
    ...new Set(
      (pids || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];
  if (process.platform !== "win32" || !safePids.length) return [];
  try {
    const filter = safePids.map((pid) => `$_.ProcessId -eq ${pid}`).join(" -or ");
    const result = powershellJson(
      `$items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ` +
        `Where-Object { ${filter} } | ForEach-Object { ` +
        "$identity = if ($_.Name -ieq 'node.exe' -and " +
        "$_.CommandLine -match '(^|[\\\\/\\s])server\\.js([\\s\"'']|$)') " +
        "{ 'node_server_js' } else { 'other' }; " +
        "[pscustomobject]@{ pid = [int]$_.ProcessId; running = $true; " +
        "command_identity = $identity } }); " +
        "@($items) | ConvertTo-Json -Compress",
      { execFileSyncImpl },
    );
    if (Array.isArray(result)) return result;
    return result ? [result] : [];
  } catch {
    return [];
  }
}

function requestLocalHealth({ port = 3001, timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length <= 1_000_000) body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200 || body.length > 1_000_000) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

function readOwnerState(profile) {
  const ownerPath = path.join(profile.state_root, "owner.json");
  try {
    return {
      path: normaliseWindowsPath(ownerPath),
      value: JSON.parse(fs.readFileSync(ownerPath, "utf8")),
    };
  } catch {
    return { path: normaliseWindowsPath(ownerPath), value: null };
  }
}

function quoteWindowsArgument(value) {
  const text = String(value || "");
  if (/[\r\n\0]/.test(text)) throw new Error("unsafe_windows_argument");
  return `"${text.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function buildScheduledTaskCommand({
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
} = {}) {
  if (!/^[a-f0-9]{40,64}$/i.test(String(expectedCommit || ""))) {
    throw new Error("expected_commit_required");
  }
  const toolPath = path.join(
    path.resolve(repoRoot),
    "tools",
    "windows-local-runtime-supervisor.js",
  );
  return [
    quoteWindowsArgument(nodeExecutable),
    quoteWindowsArgument(toolPath),
    "start",
    "-a",
    "-c",
    LIFECYCLE_CONFIRMATION,
    "-r",
    quoteWindowsArgument(path.resolve(repoRoot)),
    "-e",
    String(expectedCommit).toLowerCase(),
  ].join(" ");
}

function assertWindowsLifecycleHost() {
  if (process.platform !== "win32") {
    throw new Error("windows_lifecycle_host_required");
  }
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

function writeLifecycleReceipt({
  profile,
  action,
  expectedCommit,
  details = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  const receipt = {
    schema_version: "pulse-windows-local-runtime-lifecycle-receipt-v1",
    generated_at: generatedAt,
    action,
    runtime_owner_id: profile.runtime_owner_id,
    profile_id: profile.profile_id,
    profile_fingerprint: profileFingerprint(profile),
    commit_sha: String(expectedCommit || "").toLowerCase(),
    operating_mode: profile.environment.PULSE_OPERATING_MODE,
    auto_publish: false,
    guarded_live_dispatch: false,
    kill_switch_tripped: true,
    external_publish_authorised: false,
    oauth_mutation_authorised: false,
    details,
  };
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

function installScheduledTask({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  assertWindowsLifecycleHost();
  const current = inspectWindowsTask({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
    execFileSyncImpl,
  });
  if (current.state === "managed_current") {
    return writeLifecycleReceipt({
      profile,
      action: "install",
      expectedCommit,
      details: {
        task_name: profile.task_name,
        outcome: "no_op_already_current",
        command_fingerprint: current.command_fingerprint,
      },
    });
  }
  if (current.state !== "absent") {
    throw new Error("refusing_to_replace_unmanaged_scheduled_task");
  }
  const command = buildScheduledTaskCommand({
    repoRoot,
    expectedCommit,
    nodeExecutable,
  });
  execFileSyncImpl(
    "schtasks.exe",
    [
      "/Create",
      "/TN",
      profile.task_name,
      "/SC",
      "ONLOGON",
      "/TR",
      command,
      "/RL",
      "LIMITED",
      "/F",
    ],
    {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const task = inspectWindowsTask({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable,
    execFileSyncImpl,
  });
  if (task.state !== "managed_current") {
    throw new Error("scheduled_task_post_install_identity_failed");
  }
  return writeLifecycleReceipt({
    profile,
    action: "install",
    expectedCommit,
    details: {
      task_name: profile.task_name,
      trigger: "operator_logon",
      run_level: "limited",
      command_fingerprint: task.command_fingerprint,
    },
  });
}

function setScheduledTaskEnabled({
  profile,
  repoRoot,
  expectedCommit,
  enabled,
  execFileSyncImpl = execFileSync,
} = {}) {
  assertWindowsLifecycleHost();
  const task = inspectWindowsTask({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  if (task.state !== "managed_current") {
    throw new Error("refusing_to_change_unmanaged_scheduled_task");
  }
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
}

function uninstallScheduledTask({
  profile,
  repoRoot,
  expectedCommit,
  execFileSyncImpl = execFileSync,
} = {}) {
  assertWindowsLifecycleHost();
  const task = inspectWindowsTask({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  if (task.state !== "managed_current") {
    throw new Error("refusing_to_delete_unmanaged_scheduled_task");
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
  return writeLifecycleReceipt({
    profile,
    action: "uninstall",
    expectedCommit,
    details: { task_name: profile.task_name },
  });
}

function inspectWindowsTask({
  profile,
  repoRoot,
  expectedCommit,
  nodeExecutable = process.execPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (process.platform !== "win32") {
    return {
      state: "unavailable",
      task_name: profile.task_name,
      blockers: ["windows_task_inspection_unavailable"],
    };
  }
  if (!/^[a-f0-9]{40,64}$/i.test(String(expectedCommit || ""))) {
    return {
      state: "unverified",
      task_name: profile.task_name,
      blockers: ["expected_commit_required"],
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
  const expectedCommand = buildScheduledTaskCommand({
    repoRoot,
    expectedCommit,
    nodeExecutable,
  });
  const decoded = xml
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'");
  const toolPath = path.join(
    path.resolve(repoRoot),
    "tools",
    "windows-local-runtime-supervisor.js",
  );
  const managed =
    decoded.toLowerCase().includes(nodeExecutable.toLowerCase()) &&
    decoded.toLowerCase().includes(toolPath.toLowerCase()) &&
    decoded.toLowerCase().includes(String(expectedCommit).toLowerCase()) &&
    decoded.includes(LIFECYCLE_CONFIRMATION) &&
    !/AUTO_PUBLISH[=\s"']+true/i.test(decoded) &&
    !/PULSE_GUARDED_LIVE_DISPATCH_ENABLED[=\s"']+true/i.test(decoded) &&
    !/PULSE_EMERGENCY_KILL_SWITCH[=\s"']+(?:false|clear)/i.test(decoded);
  return {
    state: managed ? "managed_current" : "foreign",
    task_name: profile.task_name,
    command_fingerprint: crypto
      .createHash("sha256")
      .update(expectedCommand)
      .digest("hex"),
    blockers: managed ? [] : ["scheduled_task_identity_mismatch"],
  };
}

async function inspectSystemPort({
  profile,
  expectedCommit,
  repoRoot,
  execFileSyncImpl = execFileSync,
  healthRequester = requestLocalHealth,
} = {}) {
  const listeners = inspectWindowsListeners({
    port: profile.port,
    execFileSyncImpl,
  });
  if (!listeners.available) {
    return {
      state: "unavailable",
      port: profile.port,
      listener_pids: [],
      owner_pid: null,
      process_identity_safe: false,
      health_safe: false,
      blockers: ["windows_port_inspection_unavailable"],
    };
  }
  const owner = readOwnerState(profile);
  const processes = inspectWindowsProcesses(listeners.listeningPids, {
    execFileSyncImpl,
  });
  const health = listeners.listeningPids.length
    ? await healthRequester({ port: profile.port })
    : null;
  return {
    ...classifyPortOwnership({
      listeningPids: listeners.listeningPids,
      ownerState: owner.value,
      processObservations: processes,
      health,
      expectedCommit,
      repoRoot,
      profile,
    }),
    owner_receipt_path: owner.path,
  };
}

function safeHealthIdentity(health, expectedCommit) {
  return (
    String(health?.build?.commit_sha || "").toLowerCase() ===
      String(expectedCommit || "").toLowerCase() &&
    health?.deployment?.mode === "local" &&
    health?.deployment?.primary === true &&
    health?.runtime?.operating_mode === "HUMAN_REVIEW" &&
    health?.runtime?.auto_publish === false &&
    health?.runtime?.legacy_auto_publish_armed === false &&
    health?.runtime?.use_sqlite === true &&
    String(health?.runtime?.use_job_queue_explicit).toLowerCase() === "true"
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, { timeoutMs = 30_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await check();
    if (result) return result;
    await delay(intervalMs);
  } while (Date.now() < deadline);
  return null;
}

async function startRuntime({
  profile,
  repoRoot,
  expectedCommit,
  runtimeEnvironment,
  execFileSyncImpl = execFileSync,
  spawnImpl = spawn,
  healthRequester = requestLocalHealth,
} = {}) {
  assertWindowsLifecycleHost();
  const checkout = inspectCheckout({
    repoRoot,
    expectedCommit,
    expectedBranch: profile.expected_branch,
    allowDetachedHead: profile.allow_detached_head,
    execFileSyncImpl,
  });
  if (!checkout.ready) {
    throw new Error(`start_checkout_not_ready:${checkout.blockers.join(",")}`);
  }
  const database = inspectDatabase({
    dbPath: profile.database_path,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
  });
  if (!database.ready) {
    throw new Error(`start_database_not_ready:${database.blockers.join(",")}`);
  }
  const listeners = inspectWindowsListeners({
    port: profile.port,
    execFileSyncImpl,
  });
  if (!listeners.available || listeners.listeningPids.length !== 0) {
    throw new Error("start_port_not_free");
  }
  if (readOwnerState(profile).value) {
    throw new Error("start_owner_receipt_already_exists");
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
      env: runtimeEnvironment,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  if (!child?.pid) throw new Error("runtime_process_start_failed");
  child.unref?.();

  const health = await waitFor(
    async () => {
      const current = await healthRequester({ port: profile.port });
      if (!safeHealthIdentity(current, expectedCommit)) return null;
      const currentListeners = inspectWindowsListeners({
        port: profile.port,
        execFileSyncImpl,
      });
      if (
        !currentListeners.available ||
        currentListeners.listeningPids.length !== 1 ||
        Number(currentListeners.listeningPids[0]) !== Number(child.pid)
      ) {
        return null;
      }
      return current;
    },
    { timeoutMs: 30_000, intervalMs: 750 },
  );
  if (!health) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // The child may already have exited; never target another process.
    }
    throw new Error("runtime_safe_health_verification_failed");
  }

  const ownerState = {
    schema_version: "pulse-windows-local-runtime-owner-v1",
    runtime_owner_id: profile.runtime_owner_id,
    pid: Number(child.pid),
    port: profile.port,
    repo_root: normaliseWindowsPath(path.resolve(repoRoot)),
    commit_sha: String(expectedCommit).toLowerCase(),
    profile_fingerprint: profileFingerprint(profile),
    operating_mode: "HUMAN_REVIEW",
    external_publish_authorised: false,
    oauth_mutation_authorised: false,
    started_at: new Date().toISOString(),
  };
  const ownerPath = path.join(profile.state_root, "owner.json");
  writeJsonAtomic(ownerPath, ownerState);
  const evidence = writeLifecycleReceipt({
    profile,
    action: "start",
    expectedCommit,
    details: {
      pid: Number(child.pid),
      port: profile.port,
      owner_receipt_path: normaliseWindowsPath(ownerPath),
      stdout_path: normaliseWindowsPath(stdoutPath),
      stderr_path: normaliseWindowsPath(stderrPath),
    },
  });
  return {
    pid: Number(child.pid),
    port: profile.port,
    owner_receipt_path: normaliseWindowsPath(ownerPath),
    evidence_path: evidence.receipt_path,
  };
}

async function stopRuntime({
  profile,
  repoRoot,
  expectedCommit,
  execFileSyncImpl = execFileSync,
  healthRequester = requestLocalHealth,
  processKillImpl = process.kill.bind(process),
} = {}) {
  assertWindowsLifecycleHost();
  const owner = readOwnerState(profile);
  const pid = Number(owner.value?.pid);
  const currentPort = await inspectSystemPort({
    profile,
    expectedCommit,
    repoRoot,
    execFileSyncImpl,
    healthRequester,
  });
  if (
    !owner.value ||
    owner.value.schema_version !== "pulse-windows-local-runtime-owner-v1" ||
    owner.value.runtime_owner_id !== profile.runtime_owner_id ||
    owner.value.profile_fingerprint !== profileFingerprint(profile) ||
    String(owner.value.commit_sha || "").toLowerCase() !==
      String(expectedCommit || "").toLowerCase() ||
    !Number.isInteger(pid) ||
    !["managed_current", "managed_unhealthy"].includes(
      currentPort.state,
    ) ||
    Number(currentPort.owner_pid) !== pid
  ) {
    throw new Error("refusing_to_stop_unowned_runtime");
  }
  processKillImpl(pid, "SIGTERM");
  const stopped = await waitFor(
    () => {
      const listeners = inspectWindowsListeners({
        port: profile.port,
        execFileSyncImpl,
      });
      return listeners.available && listeners.listeningPids.length === 0;
    },
    { timeoutMs: 15_000, intervalMs: 500 },
  );
  if (!stopped) throw new Error("managed_runtime_stop_not_confirmed");
  fs.rmSync(path.join(profile.state_root, "owner.json"), { force: true });
  const evidence = writeLifecycleReceipt({
    profile,
    action: "stop",
    expectedCommit,
    details: { pid, port: profile.port },
  });
  return {
    pid,
    port: profile.port,
    evidence_path: evidence.receipt_path,
  };
}

function buildLifecycleDecision({
  action = "plan",
  applyRequested = false,
  confirmation = null,
  profileValidation = { valid: false, blockers: ["profile_not_inspected"] },
  checkout = { ready: false, blockers: ["checkout_not_inspected"] },
  database = { ready: false, blockers: ["database_not_inspected"] },
  port = { state: "unknown", blockers: ["port_not_inspected"] },
  task = { state: "unknown", blockers: [] },
} = {}) {
  const selectedAction = String(action || "plan").trim().toLowerCase();
  const blockers = [];
  if (!LIFECYCLE_ACTIONS.includes(selectedAction)) {
    blockers.push("unknown_lifecycle_action");
  }
  if (!profileValidation.valid) {
    blockers.push(...(profileValidation.blockers || ["profile_invalid"]));
  }

  const sourceAndDatabaseRequired = [
    "plan",
    "install",
    "start",
    "restart",
  ].includes(selectedAction);
  if (sourceAndDatabaseRequired) {
    if (!checkout.ready) {
      blockers.push(...(checkout.blockers || ["checkout_not_ready"]));
    }
    if (!database.ready) {
      blockers.push(...(database.blockers || ["database_not_ready"]));
    }
  }

  if (["plan", "install", "start"].includes(selectedAction)) {
    if (!["free", "managed_current"].includes(port.state)) {
      blockers.push(...(port.blockers || []), "port_not_available_or_managed");
    }
  }
  if (["restart", "stop"].includes(selectedAction)) {
    if (!["managed_current", "managed_unhealthy"].includes(port.state)) {
      blockers.push(...(port.blockers || []), "managed_runtime_required");
    }
  }
  if (
    selectedAction === "install" &&
    !["absent", "managed_current"].includes(task.state)
  ) {
    blockers.push(...(task.blockers || []), "task_must_be_absent_or_managed");
  }
  if (selectedAction === "uninstall" && task.state !== "managed_current") {
    blockers.push(...(task.blockers || []), "managed_task_required");
  }

  const mutating = ["install", "start", "restart", "stop", "uninstall"].includes(
    selectedAction,
  );
  if (
    mutating &&
    applyRequested &&
    confirmation !== LIFECYCLE_CONFIRMATION
  ) {
    blockers.push("lifecycle_confirmation_required");
  }
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  const ready = uniqueBlockers.length === 0;
  const alreadyRunning =
    selectedAction === "start" && port.state === "managed_current";
  const alreadyInstalled =
    selectedAction === "install" && task.state === "managed_current";
  const noOp = alreadyRunning || alreadyInstalled;

  return {
    action: selectedAction,
    ready,
    dry_run: mutating ? !applyRequested : true,
    mutation_authorised:
      mutating &&
      applyRequested &&
      confirmation === LIFECYCLE_CONFIRMATION &&
      ready &&
      !noOp,
    planned_effect: noOp ? "no_op_already_current" : selectedAction,
    production_green: false,
    external_publish_possible: false,
    oauth_mutation_possible: false,
    blockers: uniqueBlockers,
  };
}

async function buildSupervisorReport({
  action = "plan",
  applyRequested = false,
  confirmation = null,
  repoRoot = path.resolve(__dirname, "..", ".."),
  expectedCommit = null,
  dbPath = null,
  generatedAt = new Date().toISOString(),
  profilePath = DEFAULT_PROFILE_PATH,
  execFileSyncImpl = execFileSync,
  healthRequester = requestLocalHealth,
} = {}) {
  const profile = loadSafeRuntimeProfile({ profilePath });
  const profileValidation = validateSafeRuntimeProfile(profile);
  const effectiveDbPath = dbPath || profile.database_path;
  const checkout = inspectCheckout({
    repoRoot,
    expectedCommit,
    expectedBranch: profile.expected_branch,
    allowDetachedHead: profile.allow_detached_head,
    execFileSyncImpl,
  });
  const database = inspectDatabase({
    dbPath: effectiveDbPath,
    migrationsDir: path.join(repoRoot, "db", "migrations"),
  });
  const port = await inspectSystemPort({
    profile,
    expectedCommit,
    repoRoot,
    execFileSyncImpl,
    healthRequester,
  });
  const task = inspectWindowsTask({
    profile,
    repoRoot,
    expectedCommit,
    execFileSyncImpl,
  });
  const optionBlockers = [];
  if (
    applyRequested &&
    normaliseWindowsPath(effectiveDbPath).toLowerCase() !==
      normaliseWindowsPath(profile.database_path).toLowerCase()
  ) {
    optionBlockers.push("apply_database_override_forbidden");
  }
  const effectiveProfileValidation = {
    valid: profileValidation.valid && optionBlockers.length === 0,
    blockers: [...profileValidation.blockers, ...optionBlockers],
  };
  const decision = buildLifecycleDecision({
    action,
    applyRequested,
    confirmation,
    profileValidation: effectiveProfileValidation,
    checkout,
    database,
    port,
    task,
  });
  return {
    schema_version: "pulse-windows-local-runtime-plan-v1",
    generated_at: generatedAt,
    authoritative: false,
    environment: "windows-local-readiness",
    action: decision.action,
    target: {
      repo_root: normaliseWindowsPath(path.resolve(repoRoot)),
      expected_commit_sha: expectedCommit,
      expected_branch: profile.expected_branch,
      database_path: normaliseWindowsPath(effectiveDbPath),
      port: profile.port,
      task_name: profile.task_name,
      runtime_owner_id: profile.runtime_owner_id,
    },
    profile: {
      schema_version: profile.schema_version,
      profile_id: profile.profile_id,
      profile_fingerprint: profileFingerprint(profile),
      environment: { ...profile.environment },
    },
    checks: {
      profile: effectiveProfileValidation,
      checkout,
      database,
      port,
      task,
    },
    decision,
    evidence_boundary: [
      "This report does not establish production GREEN.",
      "No OAuth or token material was read, copied or mutated.",
      "No external platform action is authorised by this profile.",
      applyRequested
        ? "Mutation still requires every gate and the exact lifecycle confirmation."
        : "Default plan mode performed no lifecycle mutation.",
    ],
  };
}

async function executeLifecycleAction({
  report,
  profile,
  options = {},
  lifecycle = {},
} = {}) {
  const effect = report?.decision?.planned_effect || report?.action || "unknown";
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
  const handler = lifecycle[report.action];
  if (typeof handler !== "function") {
    throw new Error(`lifecycle_handler_unavailable:${report.action}`);
  }
  const runtimeEnvironment = ["install", "start", "restart"].includes(
    report.action,
  )
    ? buildChildEnvironment({
        profile,
        expectedCommit: options.expectedCommit,
        systemEnvironment: options.systemEnvironment || process.env,
      })
    : null;
  const result = await handler({
    report,
    profile,
    options,
    runtimeEnvironment,
  });
  return {
    executed: true,
    effect,
    result: result || null,
  };
}

function createDefaultLifecycleHandlers({
  execFileSyncImpl = execFileSync,
  spawnImpl = spawn,
  healthRequester = requestLocalHealth,
  processKillImpl = process.kill.bind(process),
} = {}) {
  return {
    async install({ profile, options }) {
      return installScheduledTask({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        execFileSyncImpl,
      });
    },
    async start({ report, profile, options, runtimeEnvironment }) {
      if (report.checks.task.state === "managed_current") {
        setScheduledTaskEnabled({
          profile,
          repoRoot: options.repoRoot,
          expectedCommit: options.expectedCommit,
          enabled: true,
          execFileSyncImpl,
        });
      }
      return startRuntime({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        runtimeEnvironment,
        execFileSyncImpl,
        spawnImpl,
        healthRequester,
      });
    },
    async restart({ report, profile, options, runtimeEnvironment }) {
      const stopped = await stopRuntime({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        execFileSyncImpl,
        healthRequester,
        processKillImpl,
      });
      const started = await startRuntime({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        runtimeEnvironment,
        execFileSyncImpl,
        spawnImpl,
        healthRequester,
      });
      return { stopped, started };
    },
    async stop({ report, profile, options }) {
      if (report.checks.task.state === "managed_current") {
        setScheduledTaskEnabled({
          profile,
          repoRoot: options.repoRoot,
          expectedCommit: options.expectedCommit,
          enabled: false,
          execFileSyncImpl,
        });
      }
      return stopRuntime({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        execFileSyncImpl,
        healthRequester,
        processKillImpl,
      });
    },
    async uninstall({ profile, options }) {
      return uninstallScheduledTask({
        profile,
        repoRoot: options.repoRoot,
        expectedCommit: options.expectedCommit,
        execFileSyncImpl,
      });
    },
  };
}

module.exports = {
  DEFAULT_PROFILE_PATH,
  LIFECYCLE_ACTIONS,
  LIFECYCLE_CONFIRMATION,
  REQUIRED_ENVIRONMENT,
  buildChildEnvironment,
  buildLifecycleDecision,
  buildSupervisorReport,
  buildScheduledTaskCommand,
  classifyPortOwnership,
  createDefaultLifecycleHandlers,
  executeLifecycleAction,
  inspectCheckout,
  inspectDatabase,
  inspectSystemPort,
  inspectWindowsTask,
  inspectWindowsListeners,
  inspectWindowsProcesses,
  installScheduledTask,
  loadSafeRuntimeProfile,
  normaliseWindowsPath,
  profileFingerprint,
  quoteWindowsArgument,
  readOwnerState,
  requestLocalHealth,
  safeHealthIdentity,
  setScheduledTaskEnabled,
  startRuntime,
  stopRuntime,
  uninstallScheduledTask,
  validateSafeRuntimeProfile,
  writeLifecycleReceipt,
};
