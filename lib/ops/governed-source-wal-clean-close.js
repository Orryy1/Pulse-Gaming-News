"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Database = require("better-sqlite3");

const { backupDatabase, verifyBackupDatabase } = require("../db_backup");
const {
  composeCutoverBackupEvidence,
  validateCanonicalCutoverBackupEvidenceV1,
} = require("./cutover-backup-evidence");
const { rehearseSqliteRestore } = require("./sqlite-restore-rehearsal");
const {
  canonicalSqliteSnapshotDigest,
} = require("./sqlite-canonical-logical-snapshot");
const {
  acquireLiveRuntimeTransitionLease,
  DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
  sameLiveRuntimeTransitionParticipant,
  validateLiveRuntimeTransitionLeaseRow,
} = require("../stabilisation/live-runtime-transition-lease");
const {
  inspectWindowsPulseQuiescence,
  normaliseQuiescence,
} = require("./governed-exact-production-plan-drain");
const {
  DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  LIVE_PROFILE_ID,
  LIVE_PROFILE_SCHEMA,
  inspectLiveDatabaseIdentity,
  loadLiveGuardedRuntimeProfile,
} = require("../stabilisation/windows-live-guarded-runtime");

const REQUEST_SCHEMA = "pulse-governed-source-wal-clean-close-request-v4";
const EVIDENCE_SCHEMA = "pulse-governed-source-wal-clean-close-evidence-v4";
const BACKUP_SCHEMA = "pulse-cutover-backup-evidence-v1";
const COMMIT_SCHEMA = "pulse-governed-source-wal-clean-close-commit-v4";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1";
const QUIESCENCE_PROBES = Object.freeze([
  "listeners",
  "processes",
  "scheduled_tasks",
]);
const QUIESCENCE_UNAVAILABLE_MAX_WAITS = 4;
const QUIESCENCE_UNAVAILABLE_WAIT_MS = 5_000;
const REQUEST_MAX_WINDOW_MS = 25 * 60 * 1000;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "maintenance_mode",
  "apply",
  "generated_at",
  "expires_at",
  "confirmation_id",
  "change_id",
  "operator_id",
  "database_path",
  "expected_database_sha256",
  "runtime_profile_path",
  "expected_runtime_profile_file_sha256",
  "activation_receipt_path",
  "executor_workspace_root",
  "expected_executor_checkout_commit",
  "output_dir",
]);

class Hold extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new Hold(code);
}

function text(value) {
  return String(value || "").trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function safeCode(error) {
  return error instanceof Hold
    ? error.code
    : "source_wal_clean_close_maintenance_error";
}

function pathKey(value, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const resolved = pathApi.resolve(String(value || ""));
  return platform === "win32"
    ? resolved.replace(/\\/g, "/").toLowerCase()
    : resolved;
}

function samePath(left, right, platform = process.platform) {
  return pathKey(left, platform) === pathKey(right, platform);
}

function exactIso(value, code) {
  const string = text(value);
  if (!string || new Date(string).toISOString() !== string) fail(code);
  return string;
}

function normaliseRequest(value, now) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== REQUEST_FIELDS.size ||
    Object.keys(value).some((key) => !REQUEST_FIELDS.has(key))
  ) {
    fail("source_wal_request_fields_invalid");
  }
  if (
    value.schema_version !== REQUEST_SCHEMA ||
    value.mode !== "LOCAL_PROOF" ||
    value.maintenance_mode !== "HUMAN_REVIEW"
  ) {
    fail("source_wal_mode_invalid");
  }
  if (value.apply !== true) fail("source_wal_explicit_apply_required");

  const request = { ...value };
  for (const key of REQUEST_FIELDS) {
    if (key !== "apply") request[key] = text(request[key]);
  }
  if (
    !request.change_id ||
    request.confirmation_id !== request.change_id ||
    !request.operator_id
  ) {
    fail("source_wal_confirmation_invalid");
  }
  request.generated_at = exactIso(
    request.generated_at,
    "source_wal_timestamp_invalid",
  );
  request.expires_at = exactIso(
    request.expires_at,
    "source_wal_timestamp_invalid",
  );
  const generatedAt = Date.parse(request.generated_at);
  const expiresAt = Date.parse(request.expires_at);
  if (
    generatedAt > now.getTime() ||
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > REQUEST_MAX_WINDOW_MS
  ) {
    fail("source_wal_timestamp_invalid");
  }
  for (const key of [
    "expected_database_sha256",
    "expected_runtime_profile_file_sha256",
  ]) {
    if (!SHA256.test(request[key])) fail("source_wal_request_hash_invalid");
    request[key] = request[key].toLowerCase();
  }
  if (!GIT_COMMIT.test(request.expected_executor_checkout_commit)) {
    fail("source_wal_executor_commit_invalid");
  }
  request.expected_executor_checkout_commit =
    request.expected_executor_checkout_commit.toLowerCase();
  for (const key of [
    "database_path",
    "runtime_profile_path",
    "activation_receipt_path",
    "executor_workspace_root",
    "output_dir",
  ]) {
    if (
      !path.isAbsolute(request[key]) ||
      path.resolve(request[key]) !== request[key]
    ) {
      fail("source_wal_request_path_invalid");
    }
  }
  return Object.freeze(request);
}

function requestIsCurrent(request, now) {
  return now.getTime() < Date.parse(request.expires_at);
}

function safeAuthorityEnvironment(env = {}) {
  const off = (value) => /^(false|0)$/i.test(text(value));
  return (
    text(env.PULSE_OPERATING_MODE).toUpperCase() === "LOCAL_PROOF" &&
    text(env.OPERATING_MODE).toUpperCase() === "LOCAL_PROOF" &&
    off(env.AUTO_PUBLISH) &&
    off(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED) &&
    off(env.PULSE_PRIMARY_INSTANCE) &&
    /^(true|1)$/i.test(
      text(env.PULSE_KILL_SWITCH || env.PULSE_EMERGENCY_KILL_SWITCH),
    )
  );
}

function defaultExecutorInspector(root) {
  try {
    const call = (args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    return {
      commit: call(["rev-parse", "HEAD"]).toLowerCase(),
      status: call(["status", "--porcelain", "--untracked-files=normal"]),
    };
  } catch {
    return { commit: null, status: "unavailable" };
  }
}

function inspectRegularFile(file, code) {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(file), file)
    ) {
      fail(code);
    }
    return Object.freeze({
      path: path.resolve(file),
      real_path: fs.realpathSync.native(file),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      nlink: stat.nlink.toString(),
      size: Number(stat.size),
      sha256: sha256File(file),
      key: `${stat.dev}:${stat.ino}`,
    });
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  }
}

function inspectFile(file, code) {
  const identity = inspectRegularFile(file, code);
  if (identity.nlink !== "1") fail(code);
  return identity;
}

function optionalRegularFile(file, code) {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code);
  }
  return inspectRegularFile(file, code);
}

function sameIdentity(left, right) {
  return (
    left?.path === right?.path &&
    left?.real_path === right?.real_path &&
    left?.dev === right?.dev &&
    left?.ino === right?.ino &&
    left?.nlink === "1" &&
    right?.nlink === "1"
  );
}

function sameFileEvidence(left, right) {
  return (
    sameIdentity(left, right) &&
    left?.size === right?.size &&
    left?.sha256 === right?.sha256
  );
}

function inspectDirectory(directory, code) {
  try {
    const stat = fs.lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(directory), directory)
    ) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  }
}

function inspectDirectoryIdentity(directory, code) {
  try {
    const resolved = path.resolve(directory);
    const stat = fs.lstatSync(resolved, { bigint: true });
    const realPath = fs.realpathSync.native(resolved);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(realPath, resolved)
    ) {
      fail(code);
    }
    return Object.freeze({
      path: resolved,
      real_path: realPath,
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
    });
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  }
}

function sameDirectoryIdentity(left, right) {
  return (
    samePath(left?.path, right?.path) &&
    samePath(left?.real_path, right?.real_path) &&
    left?.dev === right?.dev &&
    left?.ino === right?.ino
  );
}

function directoryChain(root, directory, code) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  if (
    !samePath(resolvedRoot, resolvedDirectory) &&
    !pathInside(resolvedRoot, resolvedDirectory)
  ) {
    fail(code);
  }
  const chain = [resolvedRoot];
  let current = resolvedRoot;
  for (const segment of path
    .relative(resolvedRoot, resolvedDirectory)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, segment);
    chain.push(current);
  }
  return chain;
}

function createOutputDirectoryAuthority(root, directory) {
  const code = "source_wal_evidence_output_changed_during_finalisation";
  const identities = new Map();
  for (const candidate of directoryChain(root, directory, code)) {
    const identity = inspectDirectoryIdentity(candidate, code);
    identities.set(pathKey(candidate), identity);
  }
  return {
    root: path.resolve(root),
    directory: path.resolve(directory),
    identities,
  };
}

function assertOutputDirectoryAuthority(authority, directory) {
  const code = "source_wal_evidence_output_changed_during_finalisation";
  if (!authority?.identities) fail(code);
  const resolvedDirectory = path.resolve(directory);
  if (
    !samePath(authority.directory, resolvedDirectory) &&
    !pathInside(authority.directory, resolvedDirectory)
  ) {
    fail(code);
  }
  for (const candidate of directoryChain(
    authority.root,
    resolvedDirectory,
    code,
  )) {
    const expected = authority.identities.get(pathKey(candidate));
    if (!expected) fail(code);
    const observed = inspectDirectoryIdentity(candidate, code);
    if (!sameDirectoryIdentity(expected, observed)) fail(code);
  }
  return true;
}

function assertOutputFileAuthority(authority, file) {
  return assertOutputDirectoryAuthority(authority, path.dirname(file));
}

function bindOutputDirectoryAuthority(authority, directory) {
  const code = "source_wal_evidence_output_changed_during_finalisation";
  const resolved = path.resolve(directory);
  if (!samePath(resolved, authority.directory)) {
    assertOutputDirectoryAuthority(authority, path.dirname(resolved));
  }
  const identity = inspectDirectoryIdentity(resolved, code);
  const key = pathKey(resolved);
  const expected = authority.identities.get(key);
  if (expected && !sameDirectoryIdentity(expected, identity)) fail(code);
  authority.identities.set(key, expected || identity);
  assertOutputDirectoryAuthority(authority, resolved);
  return identity;
}

function assertDistinctFiles(files, code) {
  if (new Set(files.map((file) => file.key)).size !== files.length) fail(code);
}

function activationReceiptAbsent(file) {
  const exactPath = path.resolve(String(file || ""));
  if (!path.isAbsolute(String(file || "")) || exactPath !== file) {
    fail("source_wal_activation_receipt_inspection_failed");
  }
  try {
    fs.lstatSync(exactPath);
    fail("source_wal_activation_receipt_present");
  } catch (error) {
    if (error instanceof Hold) throw error;
    if (error?.code !== "ENOENT") {
      fail("source_wal_activation_receipt_inspection_failed");
    }
  }

  let existingParent = path.dirname(exactPath);
  for (;;) {
    try {
      const stat = fs.lstatSync(existingParent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail("source_wal_activation_receipt_parent_link_forbidden");
      }
      const realParent = path.resolve(fs.realpathSync.native(existingParent));
      const relative = path.relative(existingParent, exactPath);
      if (
        !samePath(realParent, existingParent) ||
        path.isAbsolute(relative) ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`)
      ) {
        fail("source_wal_activation_receipt_parent_link_forbidden");
      }
      return;
    } catch (error) {
      if (error instanceof Hold) throw error;
      if (error?.code !== "ENOENT") {
        fail("source_wal_activation_receipt_inspection_failed");
      }
      const parent = path.dirname(existingParent);
      if (parent === existingParent) {
        fail("source_wal_activation_receipt_inspection_failed");
      }
      existingParent = parent;
    }
  }
}

function quiescenceInspectionAvailable(value) {
  return (
    value?.available === true &&
    QUIESCENCE_PROBES.every(
      (key) => value?.probe_attestations?.[key] === true,
    )
  );
}

function boundedAuthorityContext(report, databaseIdentitySha256) {
  return Object.freeze({
    schema: BOUNDED_AUTHORITY_SCHEMA,
    authority_fingerprint: report.authority_fingerprint,
    observation_sha256: report.observation_sha256,
    database_snapshot_sha256: report.database_snapshot_sha256,
    database_identity_sha256: databaseIdentitySha256,
  });
}

function sameBoundedAuthorityContext(left, right) {
  return (
    left?.schema === BOUNDED_AUTHORITY_SCHEMA &&
    right?.schema === BOUNDED_AUTHORITY_SCHEMA &&
    left.authority_fingerprint === right.authority_fingerprint &&
    left.observation_sha256 === right.observation_sha256 &&
    left.database_snapshot_sha256 === right.database_snapshot_sha256 &&
    left.database_identity_sha256 === right.database_identity_sha256
  );
}

function exactLiveDatabaseIdentity(value, databasePath, fileIdentity) {
  const observedPath = pathKey(value?.canonical_real_path);
  if (
    observedPath !== pathKey(databasePath) ||
    String(value?.device_id || "") !== String(fileIdentity?.dev || "") ||
    String(value?.file_id || "") !== String(fileIdentity?.ino || "") ||
    !SHA256.test(String(value?.database_identity_sha256 || ""))
  ) {
    fail("source_wal_database_identity_drift");
  }
  return Object.freeze({
    canonical_real_path: observedPath,
    device_id: String(value.device_id),
    file_id: String(value.file_id),
    database_identity_sha256: value.database_identity_sha256,
  });
}

function sameLiveDatabaseIdentity(left, right) {
  return (
    left?.canonical_real_path === right?.canonical_real_path &&
    left?.device_id === right?.device_id &&
    left?.file_id === right?.file_id &&
    left?.database_identity_sha256 === right?.database_identity_sha256
  );
}

function assertQuiescent(
  value,
  profile,
  databaseIdentitySha256,
  expectedContext = null,
) {
  if (!quiescenceInspectionAvailable(value)) {
    fail("source_wal_quiescence_unavailable");
  }
  if (
    value.schema !== BOUNDED_AUTHORITY_SCHEMA ||
    value.verdict !== "GREEN" ||
    value.state !== "STOPPED_BOUND" ||
    value.runtime_instance_id !== null ||
    !SHA256.test(String(value.authority_fingerprint || "")) ||
    !SHA256.test(String(value.observation_sha256 || "")) ||
    !SHA256.test(String(value.database_snapshot_sha256 || "")) ||
    !SHA256.test(String(databaseIdentitySha256 || "")) ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0 ||
    value.diagnostics !== null ||
    [
      "owner_pids",
      "listener_pids",
      "scheduler_process_pids",
      "enabled_tasks",
      "running_tasks",
    ].some((key) => !Array.isArray(value[key]) || value[key].length > 0)
  ) {
    fail("source_wal_not_quiescent");
  }
  const absent = new Set(value.absent_task_names || []);
  const required = [
    profile.task_name,
    ...(profile.conflicting_task_names || []),
  ];
  if (required.some((name) => !absent.has(name))) {
    fail("source_wal_not_quiescent");
  }
  const context = boundedAuthorityContext(value, databaseIdentitySha256);
  if (expectedContext && !sameBoundedAuthorityContext(context, expectedContext)) {
    fail("source_wal_quiescence_authority_drift");
  }
  return Object.freeze({ report: value, context });
}

function defaultRuntimeProfileValidator(profile, request) {
  try {
    const reviewed = loadLiveGuardedRuntimeProfile({
      profilePath: DEFAULT_LIVE_GUARDED_PROFILE_PATH,
    });
    return {
      valid:
        samePath(
          request.runtime_profile_path,
          DEFAULT_LIVE_GUARDED_PROFILE_PATH,
        ) &&
        profile?.schema_version === LIVE_PROFILE_SCHEMA &&
        profile?.profile_id === LIVE_PROFILE_ID &&
        JSON.stringify(stable(profile)) === JSON.stringify(stable(reviewed)) &&
        samePath(profile.database_path, request.database_path) &&
        samePath(
          profile.activation_receipt_path,
          request.activation_receipt_path,
        ),
    };
  } catch {
    return { valid: false };
  }
}

function mainDatabaseSnapshotBuffer(bytes) {
  const snapshot = Buffer.from(bytes);
  if (
    snapshot.length < 100 ||
    snapshot.subarray(0, 16).toString("binary") !== "SQLite format 3\0" ||
    ![1, 2].includes(snapshot[18]) ||
    ![1, 2].includes(snapshot[19])
  ) {
    fail("source_wal_database_identity_drift");
  }
  snapshot[18] = 1;
  snapshot[19] = 1;
  return snapshot;
}

function identityBoundSnapshotDatabase(database, databasePath) {
  const canonicalDatabasePath = path.resolve(databasePath);
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql, ...args) => {
          const statement = String(sql || "")
            .trim()
            .replace(/;$/, "")
            .replace(/\s+/g, " ")
            .toLowerCase();
          if (statement === "pragma database_list") {
            return {
              all() {
                return [
                  { seq: 0, name: "main", file: canonicalDatabasePath },
                ];
              },
            };
          }
          return target.prepare(sql, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function logicalDigest(databasePath) {
  const before = inspectFile(
    databasePath,
    "source_wal_database_identity_drift",
  );
  const beforeWal = inspectSidecar(databasePath, "-wal");
  const bytes =
    !beforeWal.exists || beforeWal.file.size === 0
      ? fs.readFileSync(databasePath)
      : null;
  const after = inspectFile(
    databasePath,
    "source_wal_database_identity_drift",
  );
  const afterWal = inspectSidecar(databasePath, "-wal");
  const canUseStableMainSnapshot =
    bytes &&
    sameFileEvidence(before, after) &&
    (!afterWal.exists || afterWal.file.size === 0);
  const db = canUseStableMainSnapshot
    ? new Database(mainDatabaseSnapshotBuffer(bytes), { readonly: true })
    : new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
      });
  let digest;
  try {
    digest = canonicalSqliteSnapshotDigest(db);
  } finally {
    db.close();
  }
  if (canUseStableMainSnapshot) {
    const finalIdentity = inspectFile(
      databasePath,
      "source_wal_database_identity_drift",
    );
    const finalWal = inspectSidecar(databasePath, "-wal");
    if (
      !sameFileEvidence(after, finalIdentity) ||
      (finalWal.exists && finalWal.file.size !== 0)
    ) {
      fail("source_wal_database_identity_drift");
    }
  }
  return digest;
}

function inspectSidecar(databasePath, suffix) {
  const file = `${databasePath}${suffix}`;
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
      fail("source_wal_sidecar_unsafe");
    }
    return {
      exists: true,
      file: inspectFile(file, "source_wal_sidecar_unsafe"),
    };
  } catch (error) {
    if (error instanceof Hold) throw error;
    if (error?.code === "ENOENT") return { exists: false, file: null };
    throw error;
  }
}

function assertCheckpointedSidecars(
  databasePath,
  code = "source_wal_sidecar_remaining",
) {
  const wal = inspectSidecar(databasePath, "-wal");
  if (wal.exists && wal.file.size !== 0) fail(code);
  if (inspectSidecar(databasePath, "-shm").exists) {
    fail(code);
  }
}

function assertOpenedMainIdentity(db, expectedIdentity) {
  const main = db
    .prepare("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main");
  if (!main?.file) fail("source_wal_opened_main_identity_invalid");
  const opened = inspectFile(
    path.resolve(main.file),
    "source_wal_opened_main_identity_invalid",
  );
  if (!sameIdentity(opened, expectedIdentity)) {
    fail("source_wal_opened_main_identity_invalid");
  }
}

function transitionLeaseRows(databasePath, expectedIdentity, code) {
  let database;
  try {
    const before = inspectFile(databasePath, code);
    if (!sameIdentity(before, expectedIdentity)) fail(code);
    const wal = inspectSidecar(databasePath, "-wal");
    if (!wal.exists || wal.file.size === 0) {
      const bytes = fs.readFileSync(databasePath);
      const after = inspectFile(databasePath, code);
      const afterWal = inspectSidecar(databasePath, "-wal");
      if (
        !sameFileEvidence(before, after) ||
        (afterWal.exists && afterWal.file.size !== 0)
      ) {
        fail(code);
      }
      database = new Database(mainDatabaseSnapshotBuffer(bytes), {
        readonly: true,
      });
    } else {
      database = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      assertOpenedMainIdentity(database, expectedIdentity);
    }
    return database
      .prepare(
        `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at, metadata
           FROM runtime_leases
          WHERE name = ?`,
      )
      .all(LIVE_RUNTIME_TRANSITION_LEASE_NAME)
      .map((row) => ({ ...row }));
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  } finally {
    database?.close();
  }
}

function transitionLeaseCount(databasePath, expectedIdentity, code) {
  return transitionLeaseRows(databasePath, expectedIdentity, code).length;
}

function inspectProtectedTransitionLeaseBinding(
  databasePath,
  expectedIdentity,
  {
    authorityContextSha256,
    operationFingerprint,
    expectedOwnerId = null,
    expectedParticipantIdentity = null,
    expectedBinding = null,
  },
  code,
) {
  if (
    !SHA256.test(String(authorityContextSha256 || "")) ||
    !SHA256.test(String(operationFingerprint || ""))
  ) {
    fail(code);
  }
  const rows = transitionLeaseRows(databasePath, expectedIdentity, code);
  if (rows.length !== 1) fail(code);
  const row = rows[0];
  const heartbeatAt = Date.parse(String(row.heartbeat_at || ""));
  const expiresAt = Date.parse(String(row.expires_at || ""));
  const leaseMs = expiresAt - heartbeatAt;
  if (leaseMs !== DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS) fail(code);
  const validated = validateLiveRuntimeTransitionLeaseRow(row, {
    ownerId: row.owner_id,
    now: new Date(heartbeatAt),
    leaseMs,
    authorityContextSha256,
  });
  const ownerParticipant = validated?.metadata?.participants?.[0];
  if (
    !validated ||
    validated.metadata.admission_state !== "OPEN" ||
    validated.metadata.participants.length !== 1 ||
    ownerParticipant?.role !== "owner" ||
    validated.metadata.context?.operation_fingerprint !== operationFingerprint ||
    Object.keys(validated.metadata.context).length !== 1 ||
    (expectedOwnerId !== null && row.owner_id !== expectedOwnerId) ||
    (expectedParticipantIdentity !== null &&
      !sameLiveRuntimeTransitionParticipant(
        ownerParticipant,
        expectedParticipantIdentity,
      ))
  ) {
    fail(code);
  }
  const metadataSha256 = sha256(Buffer.from(String(row.metadata || "")));
  const rowSha256 = sha256(
    Buffer.from(
      JSON.stringify(
        stable({
          name: row.name,
          owner_id: row.owner_id,
          acquired_at: row.acquired_at,
          heartbeat_at: row.heartbeat_at,
          expires_at: row.expires_at,
          metadata: row.metadata,
        }),
      ),
    ),
  );
  const binding = {
    schema_version: "pulse-protected-transition-lease-binding-v1",
    lease_name: row.name,
    owner_id: row.owner_id,
    acquired_at: row.acquired_at,
    heartbeat_at: row.heartbeat_at,
    expires_at: row.expires_at,
    lease_ms: leaseMs,
    metadata_sha256: metadataSha256,
    row_sha256: rowSha256,
    authority_context_sha256: authorityContextSha256,
    operation_fingerprint: operationFingerprint,
    admission_state: validated.metadata.admission_state,
    participant_identity: ownerParticipant,
  };
  if (
    expectedBinding !== null &&
    JSON.stringify(stable(binding)) !== JSON.stringify(stable(expectedBinding))
  ) {
    fail(code);
  }
  return binding;
}

function embeddedProtectedClassification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const embedded = { ...value };
  delete embedded.classification_identity;
  delete embedded.classification_path;
  delete embedded.classification_sha256;
  return embedded;
}

function sameProtectedClassification(value, classification) {
  const embedded = embeddedProtectedClassification(value);
  return (
    embedded !== null &&
    classification &&
    typeof classification === "object" &&
    !Array.isArray(classification) &&
    JSON.stringify(stable(embedded)) === JSON.stringify(stable(classification))
  );
}

function assertTransitionLeaseAbsent(databasePath, expectedIdentity, code) {
  if (transitionLeaseCount(databasePath, expectedIdentity, code) !== 0) {
    fail(code);
  }
}

function assertExactTransitionLeaseAuthority(
  db,
  lease,
  authorityContextSha256,
  now,
) {
  let row;
  try {
    row = db
      .prepare(
        `SELECT name, owner_id, acquired_at, heartbeat_at, expires_at, metadata
         FROM runtime_leases WHERE name=?`,
      )
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  } catch {
    fail("source_wal_lease_lost");
  }
  const validated = validateLiveRuntimeTransitionLeaseRow(row, {
    ownerId: lease?.owner_id,
    now,
    leaseMs: lease?.lease_ms,
    authorityContextSha256,
  });
  const handleParticipant = lease?.participant_identity;
  if (
    !validated ||
    validated.metadata.authority_context_sha256 !== authorityContextSha256 ||
    validated.metadata.admission_state !== "OPEN" ||
    !Array.isArray(validated.metadata.participants) ||
    validated.metadata.participants.length !== 1 ||
    validated.metadata.participants[0]?.role !== "owner" ||
    lease.authority_context_sha256 !== authorityContextSha256 ||
    typeof lease.assertCurrentAuthority !== "function" ||
    !handleParticipant ||
    !Object.isFrozen(handleParticipant) ||
    lease.participant_id !== handleParticipant.participant_id ||
    !sameLiveRuntimeTransitionParticipant(
      validated.metadata.participants[0],
      handleParticipant,
    )
  ) {
    fail("source_wal_lease_lost");
  }
  try {
    if (lease.assertCurrentAuthority() !== authorityContextSha256) {
      fail("source_wal_lease_lost");
    }
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail("source_wal_lease_lost");
  }
}

function checkpoint(databasePath, expectedIdentity) {
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    assertOpenedMainIdentity(db, expectedIdentity);
    db.pragma("busy_timeout = 0");
    if (
      String(db.pragma("journal_mode", { simple: true })).toLowerCase() !==
      "wal"
    ) {
      fail("source_wal_journal_mode_not_wal");
    }
    const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() || {};
    if (Number(row.busy || 0) !== 0 || Number(row.log || 0) !== 0) {
      fail("source_wal_checkpoint_busy");
    }
  } finally {
    db.close();
  }
}

async function cleanGovernedOrphanShm({
  databasePath,
  expectedDigest,
  expectedIdentity,
  fence,
  record,
  verifyDigest = true,
}) {
  const shm = inspectSidecar(databasePath, "-shm");
  if (!shm.exists) return;
  const wal = inspectSidecar(databasePath, "-wal");
  if (wal.exists && wal.file.size !== 0) {
    fail("source_wal_orphan_shm_wal_not_zero");
  }
  const database = inspectFile(
    databasePath,
    "source_wal_database_identity_invalid",
  );
  if (!sameIdentity(database, expectedIdentity)) {
    fail("source_wal_source_identity_drift");
  }
  await fence();
  if (logicalDigest(databasePath) !== expectedDigest) {
    fail("source_wal_logical_drift_before_shm_cleanup");
  }
  await fence();
  record.push({ database, shm: shm.file, wal: wal.file, expectedDigest });
  try {
    await fsp.unlink(shm.file.path);
  } catch {
    fail("source_wal_shm_unlink_failed");
  }
  if (inspectSidecar(databasePath, "-shm").exists) {
    fail("source_wal_shm_recreated");
  }
  if (!verifyDigest) return;
  if (logicalDigest(databasePath) !== expectedDigest) {
    fail("source_wal_logical_drift_after_shm_cleanup");
  }
  if (inspectSidecar(databasePath, "-shm").exists) {
    await cleanGovernedOrphanShm({
      databasePath,
      expectedDigest,
      expectedIdentity,
      fence,
      record,
      verifyDigest: false,
    });
  }
  if (inspectSidecar(databasePath, "-shm").exists) {
    fail("source_wal_shm_recreated");
  }
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

async function ensureOutputDirectory(
  root,
  output,
  fingerprint,
  beforeMutation = async () => {},
) {
  inspectDirectory(root, "source_wal_executor_root_unsafe");
  if (!pathInside(root, output)) fail("source_wal_evidence_output_invalid");
  const directory = path.join(output, fingerprint);
  if (!pathInside(root, directory)) {
    fail("source_wal_evidence_output_invalid");
  }
  let parent = root;
  for (const segment of path
    .relative(root, directory)
    .split(path.sep)
    .filter(Boolean)) {
    inspectDirectory(parent, "source_wal_evidence_output_invalid");
    const candidate = path.join(parent, segment);
    try {
      const existing = await fsp.lstat(candidate);
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        fail("source_wal_evidence_output_invalid");
      }
    } catch (error) {
      if (error instanceof Hold) throw error;
      if (error?.code !== "ENOENT") throw error;
      await beforeMutation();
      await fsp.mkdir(candidate, { recursive: false });
    }
    inspectDirectory(parent, "source_wal_evidence_output_invalid");
    inspectDirectory(candidate, "source_wal_evidence_output_invalid");
    parent = candidate;
  }
  return directory;
}

async function fsyncFile(
  file,
  authority = null,
  beforeMutation = async () => {},
) {
  if (authority) assertOutputFileAuthority(authority, file);
  const handle = await fsp.open(file, "r+");
  if (authority) assertOutputFileAuthority(authority, file);
  try {
    if (authority) assertOutputFileAuthority(authority, file);
    await beforeMutation();
    await handle.sync();
    if (authority) assertOutputFileAuthority(authority, file);
  } finally {
    await handle.close();
    if (authority) assertOutputFileAuthority(authority, file);
  }
  return {
    file_fsync: true,
    directory_fsync: "UNSUPPORTED_NTFS_EPERM",
  };
}

function noClobberTemporaryPaths(file, authority = null) {
  const directory = path.dirname(file);
  const basename = path.basename(file);
  try {
    fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    fail("source_wal_no_clobber_recovery_unsafe");
  }
  if (authority) bindOutputDirectoryAuthority(authority, directory);
  inspectDirectory(directory, "source_wal_no_clobber_recovery_unsafe");
  if (authority) assertOutputFileAuthority(authority, file);
  const names = fs.readdirSync(directory);
  if (authority) assertOutputFileAuthority(authority, file);
  return names
    .filter((name) => {
      if (!name.startsWith(`${basename}.`) || !name.endsWith(".tmp")) {
        return false;
      }
      return SHA256.test(name.slice(basename.length + 1, -4));
    })
    .map((name) => path.join(directory, name));
}

async function repairNoClobberCrashState(
  file,
  authority = null,
  beforeMutation = async () => {},
) {
  const code = "source_wal_no_clobber_recovery_unsafe";
  const temporaryPaths = noClobberTemporaryPaths(file, authority);
  if (temporaryPaths.length === 0) return null;
  if (temporaryPaths.length !== 1) fail(code);

  const temporaryPath = temporaryPaths[0];
  const temporary = inspectRegularFile(temporaryPath, code);
  const encodedHash = path
    .basename(temporaryPath)
    .slice(path.basename(file).length + 1, -4);
  if (temporary.sha256 !== encodedHash) fail(code);

  let target = optionalRegularFile(file, code);
  const recoveredState = target ? "TARGET_AND_TEMP" : "TEMP_ONLY";
  if (target) {
    if (
      target.nlink !== "2" ||
      temporary.nlink !== "2" ||
      target.key !== temporary.key ||
      target.sha256 !== temporary.sha256 ||
      target.size !== temporary.size
    ) {
      fail(code);
    }
  } else {
    if (temporary.nlink !== "1") fail(code);
    if (authority) assertOutputFileAuthority(authority, file);
    try {
      await beforeMutation();
      await fsp.link(temporaryPath, file);
    } catch {
      fail(code);
    }
    if (authority) assertOutputFileAuthority(authority, file);
    target = inspectRegularFile(file, code);
    const linkedTemporary = inspectRegularFile(temporaryPath, code);
    if (
      target.nlink !== "2" ||
      linkedTemporary.nlink !== "2" ||
      target.key !== linkedTemporary.key ||
      target.sha256 !== encodedHash
    ) {
      fail(code);
    }
  }

  await fsyncFile(file, authority, beforeMutation);
  if (authority) assertOutputFileAuthority(authority, file);
  try {
    await beforeMutation();
    await fsp.unlink(temporaryPath);
  } catch {
    fail(code);
  }
  if (authority) assertOutputFileAuthority(authority, file);
  const repaired = inspectFile(file, code);
  if (repaired.sha256 !== encodedHash) fail(code);
  return Object.freeze({
    target_path: repaired.path,
    temporary_path: path.resolve(temporaryPath),
    sha256: repaired.sha256,
    recovered_state: recoveredState,
  });
}

async function repairNoClobberCrashSet(
  directory,
  authority = null,
  beforeMutation = async () => {},
) {
  const final = finalPaths(directory);
  const targets = [
    final.json,
    final.markdown,
    final.commit,
    ...Object.values(phaseJournalPaths(directory)),
    ...Object.values(attemptPaths(directory)),
    protectedValidationPaths(directory).classification,
  ];
  const repairs = [];
  for (const target of targets) {
    const repair = await repairNoClobberCrashState(
      target,
      authority,
      beforeMutation,
    );
    if (repair) repairs.push(repair);
  }
  return repairs;
}

async function writeNoClobber(
  file,
  bytes,
  authority = null,
  {
    beforeInstall = null,
    beforeMutation = async () => {},
    finalMarkerCriticalInstall = false,
  } = {},
) {
  if (authority) assertOutputFileAuthority(authority, file);
  const repaired = await repairNoClobberCrashState(
    file,
    authority,
    beforeMutation,
  );
  if (authority) assertOutputFileAuthority(authority, file);
  try {
    const existing = await fsp.readFile(file);
    if (authority) assertOutputFileAuthority(authority, file);
    inspectFile(file, "source_wal_evidence_component_unsafe");
    if (finalMarkerCriticalInstall) fail("source_wal_evidence_conflict");
    if (!Buffer.from(existing).equals(bytes))
      fail("source_wal_evidence_conflict");
    return {
      status: repaired ? "RECOVERED" : "REPLAYED",
      durability: await fsyncFile(file, authority, beforeMutation),
    };
  } catch (error) {
    if (error instanceof Hold) throw error;
    if (authority) assertOutputFileAuthority(authority, file);
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${sha256(bytes)}.tmp`;
  if (authority) assertOutputFileAuthority(authority, temporary);
  try {
    await beforeMutation();
    await fsp.writeFile(temporary, bytes, { flag: "wx" });
    if (authority) assertOutputFileAuthority(authority, temporary);
  } catch (error) {
    if (authority) assertOutputFileAuthority(authority, temporary);
    if (error?.code !== "EEXIST") throw error;
    inspectFile(temporary, "source_wal_evidence_component_unsafe");
    const existingTemporary = await fsp.readFile(temporary);
    if (authority) assertOutputFileAuthority(authority, temporary);
    if (!existingTemporary.equals(bytes)) {
      fail("source_wal_evidence_conflict");
    }
  }
  const stagedDurability = await fsyncFile(
    temporary,
    authority,
    beforeMutation,
  );
  if (authority) assertOutputFileAuthority(authority, file);
  if (!finalMarkerCriticalInstall && beforeInstall) await beforeInstall();
  await beforeMutation();
  if (authority) assertOutputFileAuthority(authority, file);
  const temporaryBinding = inspectRegularFile(
    temporary,
    "source_wal_evidence_component_unsafe",
  );
  if (temporaryBinding.nlink !== "1" || temporaryBinding.sha256 !== sha256(bytes)) {
    fail("source_wal_evidence_component_unsafe");
  }
  if (finalMarkerCriticalInstall) {
    if (typeof beforeInstall !== "function") {
      fail("source_wal_final_marker_prelink_rebind_missing");
    }
    const prelinkRebind = beforeInstall();
    if (prelinkRebind && typeof prelinkRebind.then === "function") {
      fail("source_wal_final_marker_prelink_rebind_async");
    }
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if (error?.code === "EEXIST") fail("source_wal_evidence_conflict");
      throw error;
    }
    try {
      fs.unlinkSync(temporary);
    } catch (unlinkError) {
      let temporaryAbsent = false;
      try {
        fs.lstatSync(temporary);
      } catch (inspectionError) {
        temporaryAbsent = inspectionError?.code === "ENOENT";
      }
      if (!temporaryAbsent) {
        fail("source_wal_final_marker_install_incomplete");
      }
      const recoveredTarget = inspectRegularFile(
        file,
        "source_wal_final_marker_install_incomplete",
      );
      if (
        recoveredTarget.nlink !== "1" ||
        recoveredTarget.dev !== temporaryBinding.dev ||
        recoveredTarget.ino !== temporaryBinding.ino ||
        recoveredTarget.key !== temporaryBinding.key ||
        recoveredTarget.size !== temporaryBinding.size ||
        recoveredTarget.sha256 !== temporaryBinding.sha256
      ) {
        fail("source_wal_final_marker_install_incomplete");
      }
      return { status: "CREATED", durability: stagedDurability };
    }
    const installedTarget = inspectRegularFile(
      file,
      "source_wal_final_marker_install_incomplete",
    );
    if (
      installedTarget.nlink !== "1" ||
      installedTarget.dev !== temporaryBinding.dev ||
      installedTarget.ino !== temporaryBinding.ino ||
      installedTarget.key !== temporaryBinding.key ||
      installedTarget.size !== temporaryBinding.size ||
      installedTarget.sha256 !== temporaryBinding.sha256
    ) {
      fail("source_wal_final_marker_install_incomplete");
    }
    return { status: "CREATED", durability: stagedDurability };
  }
  try {
    await fsp.link(temporary, file);
  } catch (error) {
    if (authority) assertOutputFileAuthority(authority, file);
    if (error?.code !== "EEXIST") throw error;
    inspectFile(file, "source_wal_evidence_component_unsafe");
    const existingTarget = await fsp.readFile(file);
    if (authority) assertOutputFileAuthority(authority, file);
    if (!existingTarget.equals(bytes)) {
      fail("source_wal_evidence_conflict");
    }
  }
  try {
    if (authority) assertOutputFileAuthority(authority, file);
    const durability = await fsyncFile(file, authority, beforeMutation);
    if (authority) assertOutputFileAuthority(authority, file);
    await beforeMutation();
    await fsp.unlink(temporary);
    if (authority) assertOutputFileAuthority(authority, file);
    return { status: "CREATED", durability };
  } catch (error) {
    throw error;
  }
}

function finalPaths(directory) {
  return {
    backupEvidence: path.join(directory, "backup-evidence.json"),
    json: path.join(directory, "clean-close.json"),
    markdown: path.join(directory, "clean-close.md"),
    commit: path.join(directory, "clean-close.commit.json"),
  };
}

function protectedValidationPaths(directory) {
  const assetDirectory = path.join(
    directory,
    "noncanonical-lease-protected-validation",
  );
  return {
    assetDirectory,
    restore: path.join(assetDirectory, "restore.db"),
    restoreEvidence: path.join(assetDirectory, "restore.rehearsal.json"),
    classification: path.join(assetDirectory, "classification.json"),
  };
}

function phaseJournalPaths(directory) {
  return {
    initial: path.join(directory, "phase-initial.json"),
    postMaintenance: path.join(directory, "phase-post-maintenance.json"),
  };
}

function attemptPaths(directory) {
  return {
    json: path.join(directory, "clean-close.attempt.json"),
    markdown: path.join(directory, "clean-close.attempt.md"),
    commit: path.join(directory, "clean-close.attempt.commit.json"),
  };
}

function renderMarkdown(body) {
  return `# Governed source WAL clean close\n\nVerdict: ${body.verdict}\n`;
}

async function writeCommittedSet(
  paths,
  body,
  extra = {},
  authority = null,
  beforeMutation = async () => {},
) {
  const json = Buffer.from(`${JSON.stringify(stable(body), null, 2)}\n`);
  const markdown = Buffer.from(renderMarkdown(body));
  const jsonWrite = await writeNoClobber(paths.json, json, authority, {
    beforeMutation,
  });
  const markdownWrite = await writeNoClobber(
    paths.markdown,
    markdown,
    authority,
    { beforeMutation },
  );
  const commitBody = {
    schema_version: COMMIT_SCHEMA,
    operation_fingerprint: body.operation_fingerprint,
    json_sha256: sha256(json),
    markdown_sha256: sha256(markdown),
    ...extra,
    durability: {
      body_files_fsync: true,
      commit_file_fsync: true,
      directory_fsync: "UNSUPPORTED_NTFS_EPERM",
    },
  };
  const commit = Buffer.from(
    `${JSON.stringify(stable(commitBody), null, 2)}\n`,
  );
  const commitWrite = await writeNoClobber(paths.commit, commit, authority, {
    beforeMutation,
  });
  return { jsonWrite, markdownWrite, commitWrite };
}

function validateBackupReport(report, request, assetDirectory) {
  if (
    !report ||
    report.method !== "better-sqlite3-online-backup" ||
    report.verified !== true ||
    report.mutationPerformed !== true ||
    report.s3?.attempted !== false ||
    !Array.isArray(report.prunedBackups) ||
    report.prunedBackups.length !== 0 ||
    !samePath(report.sourcePath, request.database_path) ||
    !pathInside(assetDirectory, report.backupPath) ||
    !pathInside(assetDirectory, report.evidencePath) ||
    report.verification?.openedReadOnly !== true ||
    report.verification?.quick_check !== "ok" ||
    report.verification?.integrity_check !== "ok" ||
    report.verification?.foreign_key_check !== "ok" ||
    Number(report.verification?.foreign_key_violation_count) !== 0
  ) {
    fail("source_wal_backup_verification_invalid");
  }
  const backup = inspectFile(
    report.backupPath,
    "source_wal_backup_identity_invalid",
  );
  const verification = inspectFile(
    report.evidencePath,
    "source_wal_backup_evidence_identity_invalid",
  );
  if (report.sha256 !== backup.sha256 || report.sizeBytes !== backup.size) {
    fail("source_wal_backup_verification_invalid");
  }
  return { backup, verification };
}

function validateRestoreReport(report, paths, backupIdentity) {
  const onDisk = JSON.parse(fs.readFileSync(paths.evidence, "utf8"));
  if (
    !report ||
    report.hashes_match !== true ||
    onDisk.hashes_match !== true ||
    report.production_database_mutated !== false ||
    onDisk.production_database_mutated !== false ||
    !samePath(report.source_backup, paths.backup) ||
    !samePath(onDisk.source_backup, paths.backup) ||
    !samePath(report.restored_copy, paths.restore) ||
    !samePath(onDisk.restored_copy, paths.restore) ||
    report.source_sha256 !== backupIdentity.sha256 ||
    report.restored_sha256 !== backupIdentity.sha256 ||
    onDisk.source_sha256 !== backupIdentity.sha256 ||
    onDisk.restored_sha256 !== backupIdentity.sha256 ||
    report.verification?.openedReadOnly !== true ||
    report.verification?.quick_check !== "ok" ||
    report.verification?.integrity_check !== "ok" ||
    report.verification?.foreign_key_check !== "ok" ||
    Number(report.verification?.foreign_key_violation_count) !== 0
  ) {
    fail("source_wal_restore_verification_invalid");
  }
  const restore = inspectFile(
    paths.restore,
    "source_wal_restore_identity_invalid",
  );
  const evidence = inspectFile(
    paths.evidence,
    "source_wal_restore_evidence_identity_invalid",
  );
  if (restore.sha256 !== backupIdentity.sha256) {
    fail("source_wal_restore_verification_invalid");
  }
  return { restore, evidence };
}

async function validateSourceState({
  request,
  initialIdentity,
  expectedPhysicalHash,
  expectedLogicalDigest,
  fence,
  shmCleanup,
  completionNow,
  stage,
  attestations,
  runtimeAuthority,
  identityCode = "source_wal_source_identity_drift",
  driftCode = "source_wal_source_drift_before_evidence_commit",
}) {
  const startedAt = completionNow();
  if (!requestIsCurrent(request, startedAt)) {
    fail("source_wal_request_expired_before_commit");
  }

  await fence();
  let finalIdentity = null;
  for (let inspection = 0; inspection < 2; inspection += 1) {
    const current = inspectFile(request.database_path, identityCode);
    if (!sameIdentity(current, initialIdentity)) fail(identityCode);
    if (
      current.sha256 !== expectedPhysicalHash ||
      logicalDigest(request.database_path) !== expectedLogicalDigest
    ) {
      fail(driftCode);
    }
    assertTransitionLeaseAbsent(
      request.database_path,
      current,
      "source_wal_transition_lease_reappeared",
    );
    await cleanGovernedOrphanShm({
      databasePath: request.database_path,
      expectedDigest: expectedLogicalDigest,
      expectedIdentity: initialIdentity,
      fence,
      record: shmCleanup,
    });
    assertCheckpointedSidecars(request.database_path);
    finalIdentity = inspectFile(request.database_path, identityCode);
    if (
      !sameIdentity(finalIdentity, initialIdentity) ||
      finalIdentity.sha256 !== expectedPhysicalHash
    ) {
      fail(identityCode);
    }
    if (inspection === 0) await fence();
  }

  const completedAt = completionNow();
  if (!requestIsCurrent(request, completedAt)) {
    fail("source_wal_request_expired_before_commit");
  }
  const wal = inspectSidecar(request.database_path, "-wal");
  const shm = inspectSidecar(request.database_path, "-shm");
  if ((wal.exists && wal.file.size !== 0) || shm.exists) {
    fail("source_wal_sidecar_remaining");
  }
  attestations.push({
    stage,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    request_expires_at: request.expires_at,
    request_unexpired: true,
    activation_receipt_absent: true,
    authoritative_quiescence: true,
    runtime_authority: runtimeAuthority,
    source_identity: finalIdentity,
    expected_physical_sha256: expectedPhysicalHash,
    observed_physical_sha256: finalIdentity.sha256,
    expected_logical_sha256: expectedLogicalDigest,
    observed_logical_sha256: expectedLogicalDigest,
    transition_lease_rows: 0,
    wal: wal.exists
      ? { status: "ZERO_LENGTH", size: wal.file.size, identity: wal.file }
      : { status: "ABSENT", size: 0, identity: null },
    shm: { status: "ABSENT", identity: null },
  });
  return finalIdentity;
}

async function validateLeasedSourceState({
  request,
  initialIdentity,
  expectedLogicalDigest,
  fence,
  driftCode,
}) {
  await fence();
  const current = inspectFile(
    request.database_path,
    "source_wal_source_identity_drift",
  );
  if (!sameIdentity(current, initialIdentity)) {
    fail("source_wal_source_identity_drift");
  }
  if (logicalDigest(request.database_path) !== expectedLogicalDigest) {
    fail(driftCode);
  }
  inspectSidecar(request.database_path, "-wal");
  inspectSidecar(request.database_path, "-shm");
  return current;
}

function inspectBoundFile(expected, code) {
  if (!expected || typeof expected !== "object" || !expected.path) fail(code);
  const observed = inspectFile(expected.path, code);
  if (!sameFileEvidence(observed, expected)) fail(code);
  return observed;
}

function validateFinalEvidenceComponents(components) {
  for (const component of components) {
    inspectBoundFile(component, "source_wal_final_evidence_component_invalid");
  }
}

function readBoundJson(expected, code) {
  inspectBoundFile(expected, code);
  try {
    return JSON.parse(fs.readFileSync(expected.path, "utf8"));
  } catch {
    fail(code);
  }
}

async function cleanArtifactSidecars(
  databasePath,
  code,
  beforeMutation = async () => {},
) {
  const wal = inspectSidecar(databasePath, "-wal");
  if (wal.exists && wal.file.size !== 0) fail(code);
  const shm = inspectSidecar(databasePath, "-shm");
  if (shm.exists) {
    await beforeMutation();
    const rebound = inspectSidecar(databasePath, "-shm");
    if (!rebound.exists || !sameFileEvidence(rebound.file, shm.file)) {
      fail(code);
    }
    try {
      await fsp.unlink(rebound.file.path);
    } catch {
      fail(code);
    }
  }
  assertCheckpointedSidecars(databasePath);
}

async function assertArtifactIntegrity(
  expected,
  code,
  beforeMutation = async () => {},
) {
  await cleanArtifactSidecars(expected.path, code, beforeMutation);
  const before = inspectBoundFile(expected, code);
  const bytes = fs.readFileSync(expected.path);
  const stable = inspectBoundFile(expected, code);
  if (!sameFileEvidence(before, stable)) fail(code);
  try {
    class BoundSnapshotDatabase {
      constructor() {
        return new Database(mainDatabaseSnapshotBuffer(bytes), {
          readonly: true,
        });
      }
    }
    const verification = verifyBackupDatabase(expected.path, {
      DatabaseImpl: BoundSnapshotDatabase,
    });
    if (
      verification.openedReadOnly !== true ||
      verification.quick_check !== "ok" ||
      verification.integrity_check !== "ok" ||
      verification.foreign_key_check !== "ok" ||
      Number(verification.foreign_key_violation_count) !== 0
    ) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  }
  const after = inspectBoundFile(expected, code);
  if (!sameFileEvidence(before, after)) fail(code);
  await cleanArtifactSidecars(expected.path, code, beforeMutation);
}

function assertExactPersistedPath(expected, expectedPath, code) {
  if (
    typeof expected?.path !== "string" ||
    !expected.path ||
    typeof expectedPath !== "string" ||
    !expectedPath ||
    !samePath(path.resolve(expected.path), path.resolve(expectedPath))
  ) {
    fail(code);
  }
}

function assertPersistedDirectChild(expected, expectedDirectory, code) {
  if (
    typeof expected?.path !== "string" ||
    !expected.path ||
    typeof expectedDirectory !== "string" ||
    !expectedDirectory ||
    !samePath(
      path.dirname(path.resolve(expected.path)),
      path.resolve(expectedDirectory),
    )
  ) {
    fail(code);
  }
}

async function validateActiveArtifactSet({
  request,
  directory,
  canonicalEvidence,
  backupFiles,
  restoreFiles,
  protectedValidation,
  runtimeAuthority,
  beforeMutation,
}) {
  const expectedOperationFingerprint = sha256(
    JSON.stringify(stable(request)),
  );
  if (
    !sameBoundedAuthorityContext(
      protectedValidation?.runtime_authority,
      runtimeAuthority,
    ) ||
    protectedValidation?.operation_fingerprint !==
      expectedOperationFingerprint ||
    protectedValidation?.protected_by_standard_transition_lease !== true ||
    protectedValidation?.backup_transition_lease_rows !== 1 ||
    protectedValidation?.restore_transition_lease_rows !== 1
  ) {
    fail("source_wal_protected_validation_invalid");
  }
  const protectedPaths = protectedValidationPaths(directory);
  const canonicalDirectory = path.join(directory, "backup");
  assertPersistedDirectChild(
    protectedValidation.backup_identity,
    protectedPaths.assetDirectory,
    "source_wal_protected_backup_invalid",
  );
  assertPersistedDirectChild(
    protectedValidation.backup_verification_identity,
    protectedPaths.assetDirectory,
    "source_wal_protected_backup_verification_invalid",
  );
  assertExactPersistedPath(
    protectedValidation.restore_identity,
    protectedPaths.restore,
    "source_wal_protected_restore_invalid",
  );
  assertExactPersistedPath(
    protectedValidation.restore_evidence_identity,
    protectedPaths.restoreEvidence,
    "source_wal_protected_restore_evidence_invalid",
  );
  assertPersistedDirectChild(
    backupFiles.backup,
    canonicalDirectory,
    "source_wal_canonical_backup_invalid",
  );
  assertPersistedDirectChild(
    backupFiles.verification,
    canonicalDirectory,
    "source_wal_canonical_backup_verification_invalid",
  );
  assertExactPersistedPath(
    restoreFiles.restore,
    path.join(canonicalDirectory, "restore.db"),
    "source_wal_canonical_restore_invalid",
  );
  assertExactPersistedPath(
    restoreFiles.evidence,
    path.join(canonicalDirectory, "restore.rehearsal.json"),
    "source_wal_canonical_restore_evidence_invalid",
  );
  const backup = inspectBoundFile(
    backupFiles.backup,
    "source_wal_canonical_backup_invalid",
  );
  const backupVerification = inspectBoundFile(
    backupFiles.verification,
    "source_wal_canonical_backup_verification_invalid",
  );
  const restore = inspectBoundFile(
    restoreFiles.restore,
    "source_wal_canonical_restore_invalid",
  );
  const restoreEvidence = inspectBoundFile(
    restoreFiles.evidence,
    "source_wal_canonical_restore_evidence_invalid",
  );
  const protectedClassification = inspectBoundFile(
    protectedValidation.classification_identity,
    "source_wal_protected_classification_invalid",
  );
  const protectedClassificationBody = readBoundJson(
    protectedValidation.classification_identity,
    "source_wal_protected_classification_invalid",
  );
  if (
    !sameProtectedClassification(
      protectedValidation,
      protectedClassificationBody,
    )
  ) {
    fail("source_wal_protected_classification_invalid");
  }
  for (const [expected, code] of [
    [
      protectedValidation.backup_identity,
      "source_wal_protected_backup_invalid",
    ],
    [
      protectedValidation.backup_verification_identity,
      "source_wal_protected_backup_verification_invalid",
    ],
    [
      protectedValidation.restore_identity,
      "source_wal_protected_restore_invalid",
    ],
    [
      protectedValidation.restore_evidence_identity,
      "source_wal_protected_restore_evidence_invalid",
    ],
  ]) {
    inspectBoundFile(expected, code);
  }
  inspectProtectedTransitionLeaseBinding(
    protectedValidation.backup_identity.path,
    protectedValidation.backup_identity,
    {
      authorityContextSha256: runtimeAuthority.authority_fingerprint,
      operationFingerprint: expectedOperationFingerprint,
      expectedBinding: protectedValidation.transition_lease_binding,
    },
    "source_wal_protected_backup_lease_invalid",
  );
  inspectProtectedTransitionLeaseBinding(
    protectedValidation.restore_identity.path,
    protectedValidation.restore_identity,
    {
      authorityContextSha256: runtimeAuthority.authority_fingerprint,
      operationFingerprint: expectedOperationFingerprint,
      expectedBinding: protectedValidation.transition_lease_binding,
    },
    "source_wal_protected_restore_lease_invalid",
  );
  const canonicalValidation =
    validateCanonicalCutoverBackupEvidenceV1(canonicalEvidence);
  if (
    canonicalValidation?.valid !== true ||
    !samePath(canonicalEvidence.source_database_path, request.database_path) ||
    !samePath(canonicalEvidence.backup_path, backup.path) ||
    !samePath(canonicalEvidence.restore_path, restore.path) ||
    canonicalEvidence.backup_sha256 !== backup.sha256 ||
    canonicalEvidence.restore_sha256 !== restore.sha256
  ) {
    fail("source_wal_cutover_evidence_invalid");
  }
  const backupReport = readBoundJson(
    backupFiles.verification,
    "source_wal_canonical_backup_verification_invalid",
  );
  const observedBackupFiles = validateBackupReport(
    backupReport,
    request,
    path.dirname(backup.path),
  );
  const restoreReport = readBoundJson(
    restoreFiles.evidence,
    "source_wal_canonical_restore_evidence_invalid",
  );
  const observedRestoreFiles = validateRestoreReport(
    restoreReport,
    {
      backup: backup.path,
      restore: restore.path,
      evidence: restoreEvidence.path,
    },
    backup,
  );
  if (
    !sameFileEvidence(observedBackupFiles.backup, backup) ||
    !sameFileEvidence(observedBackupFiles.verification, backupVerification) ||
    !sameFileEvidence(observedRestoreFiles.restore, restore) ||
    !sameFileEvidence(observedRestoreFiles.evidence, restoreEvidence)
  ) {
    fail("source_wal_canonical_artifact_state_invalid");
  }
  assertTransitionLeaseAbsent(
    backup.path,
    backup,
    "source_wal_canonical_backup_contains_transition_lease",
  );
  assertTransitionLeaseAbsent(
    restore.path,
    restore,
    "source_wal_canonical_restore_contains_transition_lease",
  );
  await assertArtifactIntegrity(
    backup,
    "source_wal_canonical_backup_invalid",
    beforeMutation,
  );
  await assertArtifactIntegrity(
    restore,
    "source_wal_canonical_restore_invalid",
    beforeMutation,
  );
  inspectBoundFile(
    protectedValidation.classification_identity,
    "source_wal_protected_classification_invalid",
  );
  if (
    protectedClassification.sha256 !== protectedValidation.classification_sha256
  ) {
    fail("source_wal_protected_classification_invalid");
  }
}

async function validatePersistedArtifactSet({
  request,
  directory,
  body,
  commit,
  runtimeAuthority,
  beforeMutation,
}) {
  const paths = finalPaths(directory);
  const expectedOperationFingerprint = sha256(
    JSON.stringify(stable(request)),
  );
  const phases = body?.phase_journals;
  const canonical = body?.canonical_artifacts;
  const protectedValidation = body?.protected_validation;
  const leaseBoundary = body?.transition_lease_boundary;
  if (
    body?.schema_version !== EVIDENCE_SCHEMA ||
    body?.verdict !== "PASS" ||
    body?.quiescence_diagnostics !== null ||
    !phases ||
    !canonical ||
    !protectedValidation ||
    body?.operation_fingerprint !== expectedOperationFingerprint ||
    !sameBoundedAuthorityContext(body.runtime_authority, runtimeAuthority) ||
    !sameBoundedAuthorityContext(commit?.runtime_authority, runtimeAuthority) ||
    canonical.classification !== "CANONICAL_POST_TRANSITION_LEASE_RELEASE" ||
    canonical.canonical_evidence_input !== true ||
    canonical.restore_eligible !== true ||
    canonical.created_after_standard_transition_lease_release !== true ||
    protectedValidation.classification !==
      "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY" ||
    protectedValidation.canonical_evidence_input !== false ||
    protectedValidation.restore_eligible !== false ||
    protectedValidation.protected_by_standard_transition_lease !== true ||
    protectedValidation.backup_transition_lease_rows !== 1 ||
    protectedValidation.restore_transition_lease_rows !== 1 ||
    protectedValidation.operation_fingerprint !==
      expectedOperationFingerprint ||
    leaseBoundary?.standard_transition_lease_scope !==
      "SOURCE_CHECKPOINT_AND_NONCANONICAL_VALIDATION" ||
    leaseBoundary?.protected_validation_completed_before_release !== true ||
    leaseBoundary?.protected_validation_restore_eligible !== false ||
    leaseBoundary?.lease_released_before_post_release_maintenance !== true ||
    leaseBoundary?.canonical_artifacts_created_after_release !== true ||
    leaseBoundary?.post_release_lease_gap_exists !== true ||
    leaseBoundary?.continuous_transition_lease_coverage_claimed !== false ||
    leaseBoundary?.post_release_gap_control !==
      "REPEATED_QUIESCENCE_SOURCE_AND_ARTIFACT_FENCES" ||
    JSON.stringify(stable(commit?.transition_lease_boundary)) !==
      JSON.stringify(stable(leaseBoundary))
  ) {
    fail("source_wal_evidence_commit_invalid");
  }

  const phasePaths = phaseJournalPaths(directory);
  const protectedPaths = protectedValidationPaths(directory);
  const canonicalDirectory = path.join(directory, "backup");
  assertExactPersistedPath(
    phases.initial_identity,
    phasePaths.initial,
    "source_wal_initial_phase_invalid",
  );
  assertExactPersistedPath(
    phases.post_maintenance_identity,
    phasePaths.postMaintenance,
    "source_wal_post_maintenance_phase_invalid",
  );
  if (
    !samePath(phases.initial_path, phasePaths.initial) ||
    !samePath(phases.post_maintenance_path, phasePaths.postMaintenance)
  ) {
    fail("source_wal_evidence_commit_invalid");
  }
  assertExactPersistedPath(
    protectedValidation.classification_identity,
    protectedPaths.classification,
    "source_wal_protected_classification_invalid",
  );
  assertPersistedDirectChild(
    protectedValidation.backup_identity,
    protectedPaths.assetDirectory,
    "source_wal_protected_backup_invalid",
  );
  assertPersistedDirectChild(
    protectedValidation.backup_verification_identity,
    protectedPaths.assetDirectory,
    "source_wal_protected_backup_verification_invalid",
  );
  assertExactPersistedPath(
    protectedValidation.restore_identity,
    protectedPaths.restore,
    "source_wal_protected_restore_invalid",
  );
  assertExactPersistedPath(
    protectedValidation.restore_evidence_identity,
    protectedPaths.restoreEvidence,
    "source_wal_protected_restore_evidence_invalid",
  );
  assertPersistedDirectChild(
    canonical.backup_identity,
    canonicalDirectory,
    "source_wal_canonical_backup_invalid",
  );
  assertPersistedDirectChild(
    canonical.backup_verification_identity,
    canonicalDirectory,
    "source_wal_canonical_backup_verification_invalid",
  );
  assertExactPersistedPath(
    canonical.restore_identity,
    path.join(canonicalDirectory, "restore.db"),
    "source_wal_canonical_restore_invalid",
  );
  assertExactPersistedPath(
    canonical.restore_evidence_identity,
    path.join(canonicalDirectory, "restore.rehearsal.json"),
    "source_wal_canonical_restore_evidence_invalid",
  );
  for (const [persistedPath, identity, code] of [
    [protectedValidation.classification_path, protectedValidation.classification_identity, "source_wal_protected_classification_invalid"],
    [protectedValidation.backup_path, protectedValidation.backup_identity, "source_wal_protected_backup_invalid"],
    [protectedValidation.backup_verification_path, protectedValidation.backup_verification_identity, "source_wal_protected_backup_verification_invalid"],
    [protectedValidation.restore_path, protectedValidation.restore_identity, "source_wal_protected_restore_invalid"],
    [protectedValidation.restore_evidence_path, protectedValidation.restore_evidence_identity, "source_wal_protected_restore_evidence_invalid"],
  ]) {
    if (!samePath(persistedPath, identity.path)) fail(code);
  }

  const initialPhase = inspectBoundFile(
    phases.initial_identity,
    "source_wal_initial_phase_invalid",
  );
  const postMaintenancePhase = inspectBoundFile(
    phases.post_maintenance_identity,
    "source_wal_post_maintenance_phase_invalid",
  );
  const protectedClassification = inspectBoundFile(
    protectedValidation.classification_identity,
    "source_wal_protected_classification_invalid",
  );
  const canonicalBackup = inspectBoundFile(
    canonical.backup_identity,
    "source_wal_canonical_backup_invalid",
  );
  const canonicalBackupVerification = inspectBoundFile(
    canonical.backup_verification_identity,
    "source_wal_canonical_backup_verification_invalid",
  );
  const canonicalRestore = inspectBoundFile(
    canonical.restore_identity,
    "source_wal_canonical_restore_invalid",
  );
  const canonicalRestoreEvidence = inspectBoundFile(
    canonical.restore_evidence_identity,
    "source_wal_canonical_restore_evidence_invalid",
  );
  const protectedBackup = inspectBoundFile(
    protectedValidation.backup_identity,
    "source_wal_protected_backup_invalid",
  );
  const protectedBackupVerification = inspectBoundFile(
    protectedValidation.backup_verification_identity,
    "source_wal_protected_backup_verification_invalid",
  );
  const protectedRestore = inspectBoundFile(
    protectedValidation.restore_identity,
    "source_wal_protected_restore_invalid",
  );
  const protectedRestoreEvidence = inspectBoundFile(
    protectedValidation.restore_evidence_identity,
    "source_wal_protected_restore_evidence_invalid",
  );

  for (const [observed, expected] of [
    [initialPhase.sha256, commit.initial_phase_sha256],
    [postMaintenancePhase.sha256, commit.post_maintenance_phase_sha256],
    [
      protectedClassification.sha256,
      commit.protected_validation_classification_sha256,
    ],
    [protectedBackup.sha256, commit.protected_backup_sha256],
    [
      protectedBackupVerification.sha256,
      commit.protected_backup_verification_sha256,
    ],
    [protectedRestore.sha256, commit.protected_restore_sha256],
    [protectedRestoreEvidence.sha256, commit.protected_restore_evidence_sha256],
    [canonicalBackup.sha256, commit.canonical_backup_sha256],
    [
      canonicalBackupVerification.sha256,
      commit.canonical_backup_verification_sha256,
    ],
    [canonicalRestore.sha256, commit.canonical_restore_sha256],
    [canonicalRestoreEvidence.sha256, commit.canonical_restore_evidence_sha256],
  ]) {
    if (!SHA256.test(String(expected || "")) || observed !== expected) {
      fail("source_wal_evidence_commit_invalid");
    }
  }

  const initialPhaseBody = readBoundJson(
    phases.initial_identity,
    "source_wal_initial_phase_invalid",
  );
  const postMaintenancePhaseBody = readBoundJson(
    phases.post_maintenance_identity,
    "source_wal_post_maintenance_phase_invalid",
  );
  const protectedClassificationBody = readBoundJson(
    protectedValidation.classification_identity,
    "source_wal_protected_classification_invalid",
  );
  if (
    initialPhaseBody.schema_version !== "pulse-source-wal-phase-initial-v1" ||
    initialPhaseBody.operation_fingerprint !== body.operation_fingerprint ||
    postMaintenancePhaseBody.schema_version !==
      "pulse-source-wal-phase-post-maintenance-v1" ||
    postMaintenancePhaseBody.operation_fingerprint !==
      body.operation_fingerprint ||
    protectedClassificationBody.schema_version !==
      "pulse-noncanonical-lease-protected-validation-v1" ||
    protectedClassificationBody.operation_fingerprint !==
      body.operation_fingerprint ||
    !sameBoundedAuthorityContext(
      initialPhaseBody.runtime_authority,
      runtimeAuthority,
    ) ||
    !sameBoundedAuthorityContext(
      postMaintenancePhaseBody.runtime_authority,
      runtimeAuthority,
    ) ||
    !sameBoundedAuthorityContext(
      protectedClassificationBody.runtime_authority,
      runtimeAuthority,
    ) ||
    protectedClassificationBody.canonical_evidence_input !== false ||
    protectedClassificationBody.restore_eligible !== false ||
    protectedClassificationBody.protected_by_standard_transition_lease !==
      true ||
    protectedClassificationBody.backup_transition_lease_rows !== 1 ||
    protectedClassificationBody.restore_transition_lease_rows !== 1 ||
    !sameProtectedClassification(
      protectedValidation,
      protectedClassificationBody,
    )
  ) {
    fail("source_wal_evidence_commit_invalid");
  }

  const backupReport = readBoundJson(
    canonical.backup_verification_identity,
    "source_wal_canonical_backup_verification_invalid",
  );
  const backupFiles = validateBackupReport(
    backupReport,
    request,
    path.dirname(canonical.backup_identity.path),
  );
  if (
    !sameFileEvidence(backupFiles.backup, canonicalBackup) ||
    !sameFileEvidence(backupFiles.verification, canonicalBackupVerification)
  ) {
    fail("source_wal_canonical_backup_invalid");
  }
  const restoreReport = readBoundJson(
    canonical.restore_evidence_identity,
    "source_wal_canonical_restore_evidence_invalid",
  );
  const restoreFiles = validateRestoreReport(
    restoreReport,
    {
      backup: canonical.backup_identity.path,
      restore: canonical.restore_identity.path,
      evidence: canonical.restore_evidence_identity.path,
    },
    canonicalBackup,
  );
  if (
    !sameFileEvidence(restoreFiles.restore, canonicalRestore) ||
    !sameFileEvidence(restoreFiles.evidence, canonicalRestoreEvidence)
  ) {
    fail("source_wal_canonical_restore_invalid");
  }

  const protectedBackupReport = readBoundJson(
    protectedValidation.backup_verification_identity,
    "source_wal_protected_backup_verification_invalid",
  );
  const protectedBackupFiles = validateBackupReport(
    protectedBackupReport,
    request,
    path.dirname(protectedValidation.backup_identity.path),
  );
  const protectedRestoreReport = readBoundJson(
    protectedValidation.restore_evidence_identity,
    "source_wal_protected_restore_evidence_invalid",
  );
  const protectedRestoreFiles = validateRestoreReport(
    protectedRestoreReport,
    {
      backup: protectedValidation.backup_identity.path,
      restore: protectedValidation.restore_identity.path,
      evidence: protectedValidation.restore_evidence_identity.path,
    },
    protectedBackup,
  );
  if (
    !sameFileEvidence(protectedBackupFiles.backup, protectedBackup) ||
    !sameFileEvidence(
      protectedBackupFiles.verification,
      protectedBackupVerification,
    ) ||
    !sameFileEvidence(protectedRestoreFiles.restore, protectedRestore) ||
    !sameFileEvidence(protectedRestoreFiles.evidence, protectedRestoreEvidence)
  ) {
    fail("source_wal_protected_validation_invalid");
  }
  inspectProtectedTransitionLeaseBinding(
    protectedBackup.path,
    protectedBackup,
    {
      authorityContextSha256: runtimeAuthority.authority_fingerprint,
      operationFingerprint: expectedOperationFingerprint,
      expectedBinding: protectedValidation.transition_lease_binding,
    },
    "source_wal_protected_backup_lease_invalid",
  );
  inspectProtectedTransitionLeaseBinding(
    protectedRestore.path,
    protectedRestore,
    {
      authorityContextSha256: runtimeAuthority.authority_fingerprint,
      operationFingerprint: expectedOperationFingerprint,
      expectedBinding: protectedValidation.transition_lease_binding,
    },
    "source_wal_protected_restore_lease_invalid",
  );

  const canonicalEvidenceIdentity = inspectFile(
    paths.backupEvidence,
    "source_wal_backup_evidence_identity_invalid",
  );
  if (canonicalEvidenceIdentity.sha256 !== commit.backup_evidence_sha256) {
    fail("source_wal_evidence_commit_invalid");
  }
  let canonicalEvidence;
  try {
    canonicalEvidence = JSON.parse(
      fs.readFileSync(paths.backupEvidence, "utf8"),
    );
  } catch {
    fail("source_wal_cutover_evidence_invalid");
  }
  const canonicalValidation =
    validateCanonicalCutoverBackupEvidenceV1(canonicalEvidence);
  if (
    canonicalValidation?.valid !== true ||
    !samePath(canonicalEvidence.source_database_path, request.database_path) ||
    !samePath(canonicalEvidence.backup_path, canonicalBackup.path) ||
    !samePath(canonicalEvidence.restore_path, canonicalRestore.path) ||
    canonicalEvidence.backup_sha256 !== canonicalBackup.sha256 ||
    canonicalEvidence.restore_sha256 !== canonicalRestore.sha256
  ) {
    fail("source_wal_cutover_evidence_invalid");
  }

  assertTransitionLeaseAbsent(
    canonicalBackup.path,
    canonicalBackup,
    "source_wal_canonical_backup_contains_transition_lease",
  );
  assertTransitionLeaseAbsent(
    canonicalRestore.path,
    canonicalRestore,
    "source_wal_canonical_restore_contains_transition_lease",
  );
  for (const [artifact, code] of [
    [canonicalBackup, "source_wal_canonical_backup_invalid"],
    [canonicalRestore, "source_wal_canonical_restore_invalid"],
    [protectedBackup, "source_wal_protected_backup_invalid"],
    [protectedRestore, "source_wal_protected_restore_invalid"],
  ]) {
    await assertArtifactIntegrity(artifact, code, beforeMutation);
  }

  return {
    canonicalBackup,
    canonicalRestore,
    canonicalEvidence,
  };
}

async function validateReplaySource({ request, sourceIdentity, body, fence }) {
  const expected = body?.post_maintenance_source;
  if (
    !expected ||
    !sameFileEvidence(sourceIdentity, expected.identity) ||
    !SHA256.test(String(expected.logical_sha256 || ""))
  ) {
    fail("source_wal_replay_source_state_invalid");
  }
  for (let inspection = 0; inspection < 2; inspection += 1) {
    await fence();
    assertCheckpointedSidecars(request.database_path);
    const current = inspectFile(
      request.database_path,
      "source_wal_replay_source_state_invalid",
    );
    if (
      !sameFileEvidence(current, expected.identity) ||
      logicalDigest(request.database_path) !== expected.logical_sha256
    ) {
      fail("source_wal_replay_source_state_invalid");
    }
    assertTransitionLeaseAbsent(
      request.database_path,
      current,
      "source_wal_replay_source_state_invalid",
    );
    await cleanGovernedOrphanShm({
      databasePath: request.database_path,
      expectedDigest: expected.logical_sha256,
      expectedIdentity: expected.identity,
      fence,
      record: [],
    });
    assertCheckpointedSidecars(request.database_path);
  }
}

async function recoverCommittedResult({
  directory,
  fingerprint,
  request,
  sourceIdentity,
  fence,
  invalidationArtifacts,
  runtimeAuthority,
}) {
  const paths = finalPaths(directory);
  if (!fs.existsSync(paths.commit)) return null;
  const commitIdentity = inspectFile(
    paths.commit,
    "source_wal_evidence_commit_invalid",
  );
  let commit;
  try {
    commit = JSON.parse(fs.readFileSync(paths.commit, "utf8"));
  } catch {
    fail("source_wal_evidence_commit_invalid");
  }
  if (
    commit.schema_version !== COMMIT_SCHEMA ||
    commit.operation_fingerprint !== fingerprint
  ) {
    fail("source_wal_evidence_commit_invalid");
  }
  const finalEvidenceIdentities = {};
  for (const [role, file, expected] of [
    ["json", paths.json, commit.json_sha256],
    ["markdown", paths.markdown, commit.markdown_sha256],
    ["backupEvidence", paths.backupEvidence, commit.backup_evidence_sha256],
  ]) {
    if (!SHA256.test(String(expected || ""))) {
      fail("source_wal_evidence_commit_invalid");
    }
    const identity = inspectFile(file, "source_wal_evidence_commit_invalid");
    if (identity.sha256 !== expected)
      fail("source_wal_evidence_commit_invalid");
    finalEvidenceIdentities[role] = identity;
  }
  const finalEvidenceComponents = [
    finalEvidenceIdentities.json,
    finalEvidenceIdentities.markdown,
    commitIdentity,
    finalEvidenceIdentities.backupEvidence,
  ];
  let body;
  try {
    body = JSON.parse(fs.readFileSync(paths.json, "utf8"));
  } catch {
    fail("source_wal_evidence_commit_invalid");
  }
  if (
    body.schema_version !== EVIDENCE_SCHEMA ||
    body.operation_fingerprint !== fingerprint ||
    body.verdict !== "PASS" ||
    body.quiescence_diagnostics !== null ||
    !Array.isArray(body.blockers) ||
    body.blockers.length !== 0 ||
    !sameBoundedAuthorityContext(body.runtime_authority, runtimeAuthority) ||
    !sameBoundedAuthorityContext(commit.runtime_authority, runtimeAuthority) ||
    body.lease_released_before_post_release_evidence !== true ||
    body.continuous_transition_lease_coverage_claimed !== false ||
    body.final_completion_authority?.role !==
      "CANONICAL_BACKUP_EVIDENCE_FINAL_MARKER" ||
    !samePath(body.final_completion_authority?.path, paths.backupEvidence) ||
    body.final_completion_authority?.sha256 !== commit.backup_evidence_sha256 ||
    body.final_completion_authority?.installed_after_post_commit_fence !==
      true ||
    body.final_completion_authority?.required_by_canonical_consumers !== true ||
    JSON.stringify(stable(commit.final_completion_authority)) !==
      JSON.stringify(stable(body.final_completion_authority)) ||
    body.canonical_backup_evidence_scope
      ?.final_marker_is_snapshot_authority_only !== true ||
    body.canonical_backup_evidence_scope
      ?.consumer_must_revalidate_source_identity_and_logical_state !== true ||
    body.canonical_backup_evidence_scope
      ?.consumer_must_revalidate_quiescence_receipt_and_sidecars !== true ||
    body.post_commit_fence_policy
      ?.required_before_final_completion_marker_install !== true ||
    body.post_commit_fence_policy
      ?.no_callback_await_or_fence_after_marker_install !== true ||
    JSON.stringify(stable(commit.post_commit_fence_policy)) !==
      JSON.stringify(stable(body.post_commit_fence_policy))
  ) {
    fail("source_wal_evidence_commit_invalid");
  }
  for (const expected of [
    body.canonical_artifacts?.backup_identity,
    body.canonical_artifacts?.backup_verification_identity,
    body.canonical_artifacts?.restore_identity,
    body.canonical_artifacts?.restore_evidence_identity,
  ]) {
    if (
      !expected?.path ||
      !samePath(
        path.dirname(path.resolve(expected.path)),
        path.join(directory, "backup"),
      )
    ) {
      fail("source_wal_evidence_commit_invalid");
    }
    invalidationArtifacts.push(expected);
  }
  await validateReplaySource({ request, sourceIdentity, body, fence });
  validateFinalEvidenceComponents(finalEvidenceComponents);
  const artifacts = await validatePersistedArtifactSet({
    request,
    directory,
    body,
    commit,
    runtimeAuthority,
    beforeMutation: fence,
  });
  validateFinalEvidenceComponents(finalEvidenceComponents);
  await validateReplaySource({ request, sourceIdentity, body, fence });
  await validatePersistedArtifactSet({
    request,
    directory,
    body,
    commit,
    runtimeAuthority,
    beforeMutation: fence,
  });
  validateFinalEvidenceComponents(finalEvidenceComponents);
  return {
    verdict: body.verdict,
    blockers: body.blockers,
    status: "REPLAYED",
    quiescence_diagnostics: null,
    evidence_json: paths.json,
    evidence_markdown: paths.markdown,
    evidence_commit: commitIdentity.path,
    backup_evidence_json: paths.backupEvidence,
    phase_initial: body.phase_journals.initial_path,
    phase_post_maintenance: body.phase_journals.post_maintenance_path,
    protected_validation_classification:
      body.protected_validation.classification_path,
    phase_journals: body.phase_journals,
    protected_validation: body.protected_validation,
    canonical_artifacts: body.canonical_artifacts,
    transition_lease_boundary: body.transition_lease_boundary,
    final_completion_authority: body.final_completion_authority,
    operation_fingerprint: fingerprint,
    backup: JSON.parse(
      fs.readFileSync(
        body.canonical_artifacts.backup_verification_identity.path,
      ),
    ),
    restore: JSON.parse(
      fs.readFileSync(body.canonical_artifacts.restore_evidence_identity.path),
    ),
    source_maintenance_performed: true,
    external_authority: body.external_authority,
    lease_released_before_post_release_evidence: true,
    continuous_transition_lease_coverage_claimed: false,
    post_release_maintenance_window: body.post_release_maintenance_window,
    post_release_compensating_fences: body.post_release_compensating_fences,
    canonical_backup_sha256: artifacts.canonicalBackup.sha256,
    canonical_restore_sha256: artifacts.canonicalRestore.sha256,
    runtime_authority: runtimeAuthority,
  };
}

async function unlinkKnownAuthorityPath(
  file,
  authority = null,
  beforeMutation = async () => {},
) {
  try {
    if (authority) assertOutputFileAuthority(authority, file);
  } catch {
    return false;
  }
  try {
    const stat = await fsp.lstat(file);
    if (authority) assertOutputFileAuthority(authority, file);
    if (stat.isDirectory()) return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
  try {
    await beforeMutation();
    if (authority) assertOutputFileAuthority(authority, file);
    await fsp.unlink(file);
    if (authority) assertOutputFileAuthority(authority, file);
  } catch (error) {
    if (error?.code !== "ENOENT") return false;
  }
  try {
    await fsp.lstat(file);
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

async function invalidateFinalFiles(
  paths,
  authority = null,
  beforeMutation = async () => {},
) {
  let failed = false;
  for (const file of [
    paths.commit,
    paths.json,
    paths.markdown,
    paths.backupEvidence,
  ]) {
    if (!(await unlinkKnownAuthorityPath(file, authority, beforeMutation))) {
      failed = true;
    }
    let temporaryPaths = [];
    try {
      temporaryPaths = noClobberTemporaryPaths(file, authority);
    } catch {
      failed = true;
    }
    for (const temporaryPath of temporaryPaths) {
      if (
        !(await unlinkKnownAuthorityPath(
          temporaryPath,
          authority,
          beforeMutation,
        ))
      ) {
        failed = true;
      }
    }
  }
  if (failed) fail("source_wal_evidence_invalidation_failed");
}

async function invalidateBoundFiles(
  files,
  canonicalRoot,
  authority = null,
  beforeMutation = async () => {},
) {
  let failed = false;
  for (const expected of files) {
    if (
      !expected?.path ||
      !samePath(path.dirname(path.resolve(expected.path)), canonicalRoot)
    ) {
      failed = true;
      continue;
    }
    if (
      !(await unlinkKnownAuthorityPath(
        expected.path,
        authority,
        beforeMutation,
      ))
    ) {
      failed = true;
    }
  }
  if (failed) fail("source_wal_canonical_artifact_invalidation_unsafe");
}

function discoverCanonicalArtifactsForInvalidation(
  directory,
  authority = null,
) {
  const assetDirectory = path.join(directory, "backup");
  try {
    fs.lstatSync(assetDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    fail("source_wal_canonical_artifact_discovery_unsafe");
  }
  inspectDirectory(
    assetDirectory,
    "source_wal_canonical_artifact_discovery_unsafe",
  );
  if (authority) bindOutputDirectoryAuthority(authority, assetDirectory);
  return fs
    .readdirSync(assetDirectory)
    .map((name) => ({ path: path.join(assetDirectory, name) }));
}

async function cleanCloseGovernedSourceWal(value, dependencies = {}) {
  const operationNow = dependencies.now ? dependencies.now() : new Date();
  let request;
  try {
    request = normaliseRequest(value, operationNow);
  } catch (error) {
    return { verdict: "HOLD", blockers: [safeCode(error)] };
  }

  const fingerprint = sha256(JSON.stringify(stable(request)));
  const inspectQuiescence =
    dependencies.inspectQuiescence || inspectWindowsPulseQuiescence;
  const acquireLease =
    dependencies.acquireLease || acquireLiveRuntimeTransitionLease;
  const backup = dependencies.backupDatabase || backupDatabase;
  const rehearse = dependencies.rehearseSqliteRestore || rehearseSqliteRestore;
  const compose =
    dependencies.composeCutoverBackupEvidence || composeCutoverBackupEvidence;
  const inspectDatabaseIdentity =
    dependencies.inspectDatabaseIdentity || inspectLiveDatabaseIdentity;

  let directory = null;
  let lease = null;
  let leaseReleaseAttempted = false;
  let result = null;
  let committed = false;
  let postReleaseEvidencePhase = false;
  let finalEvidencePaths = null;
  let outputDirectoryAuthority = null;
  let postReleaseMaintenanceWindow = null;
  let protectedValidation = null;
  let initialPhaseIdentity = null;
  let postMaintenancePhaseIdentity = null;
  let quiescenceDiagnostics = null;
  let quiescenceWaitsUsed = 0;
  let databaseFileIdentity = null;
  let admittedDatabaseIdentity = null;
  let admittedRuntimeAuthority = null;
  let latestRuntimeAuthorityFingerprint = null;
  let transitionLeaseWasAcquired = false;
  let noClobberCrashRecovery = [];
  const canonicalArtifactsForInvalidation = [];
  const shmCleanup = [];
  const postReleaseAttestations = [];

  const completionNow = () => {
    const observed = dependencies.completionNow
      ? dependencies.completionNow()
      : new Date();
    const value = observed instanceof Date ? observed : new Date(observed);
    if (Number.isNaN(value.getTime())) fail("source_wal_timestamp_invalid");
    return value;
  };

  const quiescenceNow = () => {
    const observed = dependencies.quiescenceNow
      ? dependencies.quiescenceNow()
      : new Date();
    const value = observed instanceof Date ? observed : new Date(observed);
    if (Number.isNaN(value.getTime())) fail("source_wal_timestamp_invalid");
    return value;
  };

  const expiryBlocker = () =>
    postReleaseEvidencePhase
      ? "source_wal_request_expired_before_commit"
      : "source_wal_request_expired";

  const assertFenceContinuity = () => {
    activationReceiptAbsent(request.activation_receipt_path);
    const observedAt = quiescenceNow();
    if (!requestIsCurrent(request, observedAt)) {
      fail(expiryBlocker());
    }
    return observedAt;
  };

  const measureDatabaseIdentity = () => {
    if (!databaseFileIdentity) fail("source_wal_database_identity_drift");
    let measured;
    try {
      measured = exactLiveDatabaseIdentity(
        inspectDatabaseIdentity({ databasePath: request.database_path }),
        request.database_path,
        databaseFileIdentity,
      );
    } catch (error) {
      if (error instanceof Hold) throw error;
      fail("source_wal_database_identity_drift");
    }
    if (
      admittedDatabaseIdentity &&
      !sameLiveDatabaseIdentity(measured, admittedDatabaseIdentity)
    ) {
      fail("source_wal_database_identity_drift");
    }
    admittedDatabaseIdentity ||= measured;
    return admittedDatabaseIdentity;
  };
  const withAuthorityDatabase = async (callback) => {
    const wal = inspectSidecar(request.database_path, "-wal");
    if (!lease && (!wal.exists || wal.file.size === 0)) {
      const before = inspectFile(
        request.database_path,
        "source_wal_database_identity_drift",
      );
      if (!sameIdentity(before, databaseFileIdentity)) {
        fail("source_wal_database_identity_drift");
      }
      const bytes = fs.readFileSync(request.database_path);
      const after = inspectFile(
        request.database_path,
        "source_wal_database_identity_drift",
      );
      const afterWal = inspectSidecar(request.database_path, "-wal");
      if (
        !sameFileEvidence(before, after) ||
        (afterWal.exists && afterWal.file.size !== 0)
      ) {
        fail("source_wal_database_identity_drift");
      }
      const opened = new Database(mainDatabaseSnapshotBuffer(bytes), {
        readonly: true,
      });
      let value;
      try {
        value = await callback(
          identityBoundSnapshotDatabase(opened, request.database_path),
        );
      } finally {
        opened.close();
      }
      const finalIdentity = inspectFile(
        request.database_path,
        "source_wal_database_identity_drift",
      );
      const finalWal = inspectSidecar(request.database_path, "-wal");
      if (
        !sameFileEvidence(after, finalIdentity) ||
        (finalWal.exists && finalWal.file.size !== 0)
      ) {
        fail("source_wal_database_identity_drift");
      }
      return value;
    }
    const opened = new Database(request.database_path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertOpenedMainIdentity(opened, databaseFileIdentity);
      return await callback(opened);
    } finally {
      opened.close();
    }
  };

  const waitForQuiescenceRetry =
    dependencies.waitForQuiescenceRetry ||
    (({ delay_ms: delayMs }) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)));

  let fence = null;
  let assertMutationAuthority = null;

  const renewTransitionLease = async (renewedAt = null) => {
    if (!lease || typeof fence !== "function") fail("source_wal_lease_lost");
    const effectiveRenewedAt = renewedAt || quiescenceNow();
    await fence({ renewLease: false });
    await withAuthorityDatabase((opened) =>
      assertExactTransitionLeaseAuthority(
        opened,
        lease,
        admittedRuntimeAuthority.authority_fingerprint,
        effectiveRenewedAt,
      ),
    );
    let renewed;
    try {
      renewed = await lease.renew(effectiveRenewedAt);
    } catch {
      fail("source_wal_lease_lost");
    }
    if (renewed !== true) fail("source_wal_lease_lost");
    await withAuthorityDatabase((opened) =>
      assertExactTransitionLeaseAuthority(
        opened,
        lease,
        admittedRuntimeAuthority.authority_fingerprint,
        effectiveRenewedAt,
      ),
    );
    return assertFenceContinuity();
  };

  const releaseTransitionLease = async () => {
    const activeLease = lease;
    try {
      if (!activeLease || typeof fence !== "function") {
        fail("source_wal_lease_release_failed");
      }
      await fence({ renewLease: false });
      await withAuthorityDatabase((opened) =>
        assertExactTransitionLeaseAuthority(
          opened,
          activeLease,
          admittedRuntimeAuthority.authority_fingerprint,
          quiescenceNow(),
        ),
      );
      if ((await activeLease.release()) !== true) {
        fail("source_wal_lease_release_failed");
      }
    } catch {
      fail("source_wal_lease_release_failed");
    } finally {
      lease = null;
      leaseReleaseAttempted = true;
    }
  };

  const hold = async (code, status = "HELD") => {
    const blockers = [code];
    const diagnostic = [
      "source_wal_quiescence_unavailable",
      "source_wal_not_quiescent",
    ].includes(code)
      ? quiescenceDiagnostics
      : null;
    if (!directory) {
      return {
        verdict: "HOLD",
        blockers,
        status,
        quiescence_diagnostics: diagnostic,
        operation_fingerprint: fingerprint,
      };
    }
    if (!outputDirectoryAuthority) {
      return {
        verdict: "HOLD",
        blockers: [...blockers, "source_wal_hold_evidence_pending"],
        status: "RECOVERY_REQUIRED",
        quiescence_diagnostics: diagnostic,
        operation_fingerprint: fingerprint,
      };
    }
    const paths = attemptPaths(directory);
    const body = {
      schema_version: EVIDENCE_SCHEMA,
      operation_fingerprint: fingerprint,
      generated_at: request.generated_at,
      change_id: request.change_id,
      operator_id: request.operator_id,
      verdict: "HOLD",
      blockers,
      status,
      quiescence_diagnostics: diagnostic,
      backup_evidence_sha256: null,
      durability: {
        body_files_fsync: true,
        commit_file_fsync: true,
        directory_fsync: "UNSUPPORTED_NTFS_EPERM",
      },
    };
    try {
      if (typeof assertMutationAuthority !== "function") {
        fail("source_wal_hold_evidence_pending");
      }
      await writeCommittedSet(
        paths,
        body,
        {},
        outputDirectoryAuthority,
        assertMutationAuthority,
      );
      return {
        verdict: "HOLD",
        blockers,
        status,
        evidence_json: paths.json,
        evidence_markdown: paths.markdown,
        evidence_commit: paths.commit,
        quiescence_diagnostics: diagnostic,
        operation_fingerprint: fingerprint,
      };
    } catch {
      return {
        verdict: "HOLD",
        blockers: [...blockers, "source_wal_hold_evidence_pending"],
        status: "RECOVERY_REQUIRED",
        quiescence_diagnostics: diagnostic,
        operation_fingerprint: fingerprint,
      };
    }
  };

  try {
    if (!safeAuthorityEnvironment(dependencies.env || process.env)) {
      fail("source_wal_authority_environment_invalid");
    }
    const inspectExecutorCheckout = () => {
      inspectDirectory(
        request.executor_workspace_root,
        "source_wal_executor_root_unsafe",
      );
      const executor = (
        dependencies.inspectExecutor || defaultExecutorInspector
      )(request.executor_workspace_root);
      if (
        executor?.commit !== request.expected_executor_checkout_commit ||
        text(executor?.status) !== ""
      ) {
        fail("source_wal_executor_not_clean");
      }
      return executor;
    };
    inspectExecutorCheckout();

    const preFenceIdentity = inspectFile(
      request.database_path,
      "source_wal_database_unsafe",
    );
    const bindRuntimeProfile = (
      expectedIdentity = null,
      changedCode = "source_wal_runtime_profile_changed_during_quiescence",
    ) => {
      const before = inspectFile(
        request.runtime_profile_path,
        "source_wal_runtime_profile_unsafe",
      );
      if (expectedIdentity && !sameFileEvidence(before, expectedIdentity)) {
        fail(changedCode);
      }
      if (before.sha256 !== request.expected_runtime_profile_file_sha256) {
        if (expectedIdentity) fail(changedCode);
        fail("source_wal_preflight_sha_mismatch");
      }

      let candidate;
      try {
        candidate = JSON.parse(
          fs.readFileSync(request.runtime_profile_path, "utf8"),
        );
      } catch {
        fail("source_wal_runtime_profile_invalid");
      }
      const after = inspectFile(
        request.runtime_profile_path,
        "source_wal_runtime_profile_unsafe",
      );
      if (!sameFileEvidence(before, after)) {
        fail(
          expectedIdentity
            ? changedCode
            : "source_wal_runtime_profile_unsafe",
        );
      }
      const validation = (
        dependencies.runtimeProfileValidator || defaultRuntimeProfileValidator
      )(candidate, request);
      if (
        validation?.valid !== true ||
        validation?.blockers?.length ||
        !samePath(candidate.database_path, request.database_path) ||
        !samePath(
          candidate.activation_receipt_path,
          request.activation_receipt_path,
        )
      ) {
        fail("source_wal_runtime_profile_invalid");
      }
      return { identity: after, profile: candidate };
    };
    const preFenceRuntimeProfile = bindRuntimeProfile();
    let profile = preFenceRuntimeProfile.profile;
    let finalAuthorityValidator = null;
    databaseFileIdentity = preFenceIdentity;
    measureDatabaseIdentity();

    fence = async ({ renewLease = true } = {}) => {
      for (;;) {
        if (finalAuthorityValidator) finalAuthorityValidator();
        assertFenceContinuity();
        const databaseIdentity = measureDatabaseIdentity();
        const observed = await withAuthorityDatabase((opened) =>
          inspectQuiescence({
            profile,
            workspaceRoot: request.executor_workspace_root,
            checkoutRealPath: request.executor_workspace_root,
            expectedCommit: request.expected_executor_checkout_commit,
            databaseIdentitySha256:
              databaseIdentity.database_identity_sha256,
            db: opened,
          }),
        );
        if (finalAuthorityValidator) finalAuthorityValidator();
        const quiescence = normaliseQuiescence(
          observed,
          profile,
        );
        quiescenceDiagnostics = quiescence.diagnostics;
        const inspectionAvailable = quiescenceInspectionAvailable(quiescence);
        if (inspectionAvailable) {
          const accepted = assertQuiescent(
            quiescence,
            profile,
            databaseIdentity.database_identity_sha256,
            admittedRuntimeAuthority,
          );
          latestRuntimeAuthorityFingerprint =
            accepted.context.authority_fingerprint;
          admittedRuntimeAuthority ||= accepted.context;
        }
        let completedAt = assertFenceContinuity();
        if (lease && renewLease) {
          if (finalAuthorityValidator) finalAuthorityValidator();
          await withAuthorityDatabase((opened) =>
            assertExactTransitionLeaseAuthority(
              opened,
              lease,
              admittedRuntimeAuthority.authority_fingerprint,
              completedAt,
            ),
          );
          let renewed;
          try {
            renewed = await lease.renew(completedAt);
          } catch {
            fail("source_wal_lease_lost");
          }
          if (renewed !== true) fail("source_wal_lease_lost");
          await withAuthorityDatabase((opened) =>
            assertExactTransitionLeaseAuthority(
              opened,
              lease,
              admittedRuntimeAuthority.authority_fingerprint,
              completedAt,
            ),
          );
          completedAt = assertFenceContinuity();
          if (finalAuthorityValidator) finalAuthorityValidator();
        }
        if (inspectionAvailable) {
          if (transitionLeaseWasAcquired && !lease) {
            assertTransitionLeaseAbsent(
              request.database_path,
              databaseFileIdentity,
              "source_wal_transition_lease_present",
            );
          }
          quiescenceDiagnostics = null;
          if (finalAuthorityValidator) finalAuthorityValidator();
          return;
        }
        if (
          quiescenceWaitsUsed >= QUIESCENCE_UNAVAILABLE_MAX_WAITS ||
          completedAt.getTime() + QUIESCENCE_UNAVAILABLE_WAIT_MS >=
            Date.parse(request.expires_at)
        ) {
          assertQuiescent(
            quiescence,
            profile,
            databaseIdentity.database_identity_sha256,
            admittedRuntimeAuthority,
          );
        }
        quiescenceWaitsUsed += 1;
        if (finalAuthorityValidator) finalAuthorityValidator();
        await waitForQuiescenceRetry({
          attempt: quiescenceWaitsUsed,
          delay_ms: QUIESCENCE_UNAVAILABLE_WAIT_MS,
          deadline_at: request.expires_at,
        });
        if (finalAuthorityValidator) finalAuthorityValidator();
        const resumedAt = assertFenceContinuity();
        if (lease && renewLease) {
          if (finalAuthorityValidator) finalAuthorityValidator();
          await withAuthorityDatabase((opened) =>
            assertExactTransitionLeaseAuthority(
              opened,
              lease,
              admittedRuntimeAuthority.authority_fingerprint,
              resumedAt,
            ),
          );
          let renewed;
          try {
            renewed = await lease.renew(resumedAt);
          } catch {
            fail("source_wal_lease_lost");
          }
          if (renewed !== true) fail("source_wal_lease_lost");
          if (finalAuthorityValidator) finalAuthorityValidator();
        }
      }
    };

    assertMutationAuthority = async () => {
      if (typeof fence !== "function") {
        fail("source_wal_quiescence_unavailable");
      }
      await fence({ renewLease: false });
      const observedAt = assertFenceContinuity();
      if (!admittedRuntimeAuthority) {
        fail("source_wal_quiescence_unavailable");
      }
      if (lease) {
        await withAuthorityDatabase((opened) =>
          assertExactTransitionLeaseAuthority(
            opened,
            lease,
            admittedRuntimeAuthority.authority_fingerprint,
            observedAt,
          ),
        );
      }
      return admittedRuntimeAuthority;
    };

    await fence();
    directory = await ensureOutputDirectory(
      request.executor_workspace_root,
      request.output_dir,
      fingerprint,
      assertMutationAuthority,
    );
    outputDirectoryAuthority = createOutputDirectoryAuthority(
      request.executor_workspace_root,
      directory,
    );
    noClobberCrashRecovery = await repairNoClobberCrashSet(
      directory,
      outputDirectoryAuthority,
      assertMutationAuthority,
    );
    canonicalArtifactsForInvalidation.push(
      ...discoverCanonicalArtifactsForInvalidation(
        directory,
        outputDirectoryAuthority,
      ),
    );
    const discoveredFinalPaths = finalPaths(directory);
    if (
      Object.values(discoveredFinalPaths).some((file) => fs.existsSync(file)) ||
      canonicalArtifactsForInvalidation.length > 0
    ) {
      postReleaseEvidencePhase = true;
      finalEvidencePaths = discoveredFinalPaths;
    }
    const initialIdentity = inspectFile(
      request.database_path,
      "source_wal_database_unsafe",
    );
    if (!sameFileEvidence(preFenceIdentity, initialIdentity)) {
      fail("source_wal_database_changed_during_quiescence");
    }
    const initialRuntimeProfile = bindRuntimeProfile(
      preFenceRuntimeProfile.identity,
    );
    profile = initialRuntimeProfile.profile;
    inspectExecutorCheckout();
    assertFenceContinuity();
    const replay = await recoverCommittedResult({
      directory,
      fingerprint,
      request,
      sourceIdentity: initialIdentity,
      fence,
      invalidationArtifacts: canonicalArtifactsForInvalidation,
      runtimeAuthority: admittedRuntimeAuthority,
    });
    if (replay) {
      result = {
        ...replay,
        no_clobber_crash_recovery: noClobberCrashRecovery,
      };
    } else {
      if (!requestIsCurrent(request, operationNow)) {
        fail("source_wal_request_expired");
      }
      if (fs.readdirSync(directory).length > 0) {
        fail("source_wal_partial_output_recovery_required");
      }
      if (initialIdentity.sha256 !== request.expected_database_sha256) {
        fail("source_wal_preflight_sha_mismatch");
      }
      const initialWal = inspectSidecar(request.database_path, "-wal");
      if (initialWal.exists && initialWal.file.size !== 0) {
        fail("source_wal_preflight_wal_not_zero");
      }
      const initialDigest = logicalDigest(request.database_path);
      {
        const phasePaths = phaseJournalPaths(directory);
        const initialPhaseBody = {
          schema_version: "pulse-source-wal-phase-initial-v1",
          operation_fingerprint: fingerprint,
          request_database_sha256: request.expected_database_sha256,
          source_identity: initialIdentity,
          source_logical_sha256: initialDigest,
          runtime_authority: admittedRuntimeAuthority,
          activation_receipt_absent: true,
          authoritative_quiescence: true,
          external_authority: {
            live_publish_performed: false,
            oauth_or_token_mutation_performed: false,
            scheduled_task_mutation_performed: false,
          },
        };
        const initialPhaseBytes = Buffer.from(
          `${JSON.stringify(stable(initialPhaseBody), null, 2)}\n`,
        );
        await fence();
        await writeNoClobber(
          phasePaths.initial,
          initialPhaseBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        initialPhaseIdentity = inspectFile(
          phasePaths.initial,
          "source_wal_initial_phase_invalid",
        );
        await assertMutationAuthority();
        lease = acquireLease({
          databasePath: request.database_path,
          action: "governed_source_wal_clean_close",
          binding: fingerprint,
          metadata: { operation_fingerprint: fingerprint },
          now: operationNow,
          authorityContextSha256:
            admittedRuntimeAuthority.authority_fingerprint,
          authorityContextProvider: () =>
            latestRuntimeAuthorityFingerprint,
          runtimeTransitionLeaseFactory:
            dependencies.runtimeTransitionLeaseFactory,
          unavailableCode: "source_wal_lease_unavailable",
          lostCode: "source_wal_lease_lost",
        });
        transitionLeaseWasAcquired = true;
        if (!lease?.renew || !lease?.release) {
          fail("source_wal_lease_unavailable");
        }
        await withAuthorityDatabase((opened) =>
          assertExactTransitionLeaseAuthority(
            opened,
            lease,
            admittedRuntimeAuthority.authority_fingerprint,
            operationNow,
          ),
        );
        await renewTransitionLease(operationNow);
        await assertMutationAuthority();

        checkpoint(request.database_path, initialIdentity);
        await fence();
        if (logicalDigest(request.database_path) !== initialDigest) {
          fail("source_wal_logical_drift_after_checkpoint");
        }
        const postCheckpointIdentity = inspectFile(
          request.database_path,
          "source_wal_source_identity_drift",
        );
        if (!sameIdentity(postCheckpointIdentity, initialIdentity)) {
          fail("source_wal_source_identity_drift");
        }
        const checkpointWal = inspectSidecar(request.database_path, "-wal");
        if (checkpointWal.exists && checkpointWal.file.size !== 0) {
          fail("source_wal_checkpoint_busy");
        }

        const protectedPaths = protectedValidationPaths(directory);
        assertOutputDirectoryAuthority(outputDirectoryAuthority, directory);
        await assertMutationAuthority();
        await fsp.mkdir(protectedPaths.assetDirectory, { recursive: false });
        assertOutputDirectoryAuthority(outputDirectoryAuthority, directory);
        bindOutputDirectoryAuthority(
          outputDirectoryAuthority,
          protectedPaths.assetDirectory,
        );
        inspectDirectory(
          protectedPaths.assetDirectory,
          "source_wal_backup_directory_invalid",
        );
        const protectedSourceHandle = new Database(request.database_path, {
          fileMustExist: true,
        });
        let protectedBackupReport;
        try {
          await renewTransitionLease();
          assertOpenedMainIdentity(protectedSourceHandle, initialIdentity);
          await assertMutationAuthority();
          protectedBackupReport = await backup({
            dbPath: request.database_path,
            backupDir: protectedPaths.assetDirectory,
            dbHandle: protectedSourceHandle,
            env: {},
            logger: { log() {}, warn() {}, error() {} },
            maxLocalBackups: Number.MAX_SAFE_INTEGER,
            now: () => operationNow,
          });
        } finally {
          protectedSourceHandle.close();
        }
        const protectedBackupFiles = validateBackupReport(
          protectedBackupReport,
          request,
          protectedPaths.assetDirectory,
        );
        await fsyncFile(
          protectedBackupFiles.backup.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        await fsyncFile(
          protectedBackupFiles.verification.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        if (dependencies.afterBackup) await dependencies.afterBackup();
        await renewTransitionLease();

        await assertMutationAuthority();
        const protectedRestoreReport = await rehearse({
          backupPath: protectedBackupReport.backupPath,
          backupVerificationPath: protectedBackupReport.evidencePath,
          restorePath: protectedPaths.restore,
          evidencePath: protectedPaths.restoreEvidence,
          generatedAt: operationNow,
        });
        const protectedRestoreFiles = validateRestoreReport(
          protectedRestoreReport,
          {
            backup: protectedBackupReport.backupPath,
            restore: protectedPaths.restore,
            evidence: protectedPaths.restoreEvidence,
          },
          protectedBackupFiles.backup,
        );
        await fsyncFile(
          protectedRestoreFiles.restore.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        await fsyncFile(
          protectedRestoreFiles.evidence.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        await renewTransitionLease();

        const protectedBackupLeaseBinding =
          inspectProtectedTransitionLeaseBinding(
            protectedBackupFiles.backup.path,
            protectedBackupFiles.backup,
            {
              authorityContextSha256:
                admittedRuntimeAuthority.authority_fingerprint,
              operationFingerprint: fingerprint,
              expectedOwnerId: lease.owner_id,
              expectedParticipantIdentity: lease.participant_identity,
            },
            "source_wal_protected_backup_lease_invalid",
          );
        inspectProtectedTransitionLeaseBinding(
          protectedRestoreFiles.restore.path,
          protectedRestoreFiles.restore,
          {
            authorityContextSha256:
              admittedRuntimeAuthority.authority_fingerprint,
            operationFingerprint: fingerprint,
            expectedOwnerId: lease.owner_id,
            expectedParticipantIdentity: lease.participant_identity,
            expectedBinding: protectedBackupLeaseBinding,
          },
          "source_wal_protected_restore_lease_invalid",
        );
        await cleanArtifactSidecars(
          protectedBackupFiles.backup.path,
          "source_wal_protected_backup_invalid",
          assertMutationAuthority,
        );
        await cleanArtifactSidecars(
          protectedRestoreFiles.restore.path,
          "source_wal_protected_restore_invalid",
          assertMutationAuthority,
        );
        inspectProtectedTransitionLeaseBinding(
          protectedBackupFiles.backup.path,
          protectedBackupFiles.backup,
          {
            authorityContextSha256:
              admittedRuntimeAuthority.authority_fingerprint,
            operationFingerprint: fingerprint,
            expectedBinding: protectedBackupLeaseBinding,
          },
          "source_wal_protected_backup_lease_invalid",
        );
        inspectProtectedTransitionLeaseBinding(
          protectedRestoreFiles.restore.path,
          protectedRestoreFiles.restore,
          {
            authorityContextSha256:
              admittedRuntimeAuthority.authority_fingerprint,
            operationFingerprint: fingerprint,
            expectedBinding: protectedBackupLeaseBinding,
          },
          "source_wal_protected_restore_lease_invalid",
        );

        const protectedClassificationBody = {
          schema_version: "pulse-noncanonical-lease-protected-validation-v1",
          operation_fingerprint: fingerprint,
          classification: "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY",
          canonical_evidence_input: false,
          restore_eligible: false,
          protected_by_standard_transition_lease: true,
          runtime_authority: admittedRuntimeAuthority,
          backup_identity: protectedBackupFiles.backup,
          backup_path: protectedBackupFiles.backup.path,
          backup_sha256: protectedBackupFiles.backup.sha256,
          backup_verification_identity: protectedBackupFiles.verification,
          backup_verification_path: protectedBackupFiles.verification.path,
          backup_verification_sha256: protectedBackupFiles.verification.sha256,
          backup_transition_lease_rows: transitionLeaseCount(
            protectedBackupFiles.backup.path,
            protectedBackupFiles.backup,
            "source_wal_protected_backup_lease_inspection_failed",
          ),
          restore_identity: protectedRestoreFiles.restore,
          restore_path: protectedRestoreFiles.restore.path,
          restore_sha256: protectedRestoreFiles.restore.sha256,
          restore_evidence_identity: protectedRestoreFiles.evidence,
          restore_evidence_path: protectedRestoreFiles.evidence.path,
          restore_evidence_sha256: protectedRestoreFiles.evidence.sha256,
          restore_transition_lease_rows: transitionLeaseCount(
            protectedRestoreFiles.restore.path,
            protectedRestoreFiles.restore,
            "source_wal_protected_restore_lease_inspection_failed",
          ),
          transition_lease_binding: protectedBackupLeaseBinding,
        };
        const protectedClassificationBytes = Buffer.from(
          `${JSON.stringify(stable(protectedClassificationBody), null, 2)}\n`,
        );
        await fence();
        await writeNoClobber(
          protectedPaths.classification,
          protectedClassificationBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        const protectedClassificationIdentity = inspectFile(
          protectedPaths.classification,
          "source_wal_protected_classification_invalid",
        );
        protectedValidation = {
          ...protectedClassificationBody,
          classification_identity: protectedClassificationIdentity,
          classification_path: protectedClassificationIdentity.path,
          classification_sha256: protectedClassificationIdentity.sha256,
        };

        await validateLeasedSourceState({
          request,
          initialIdentity,
          expectedLogicalDigest: initialDigest,
          fence,
          driftCode: "source_wal_source_drift_during_backup",
        });

        await releaseTransitionLease();
        postReleaseEvidencePhase = true;
        if (dependencies.afterLeaseRelease) {
          await dependencies.afterLeaseRelease();
        }

        const postReleaseMaintenanceStartedAt = completionNow();
        if (!requestIsCurrent(request, postReleaseMaintenanceStartedAt)) {
          fail("source_wal_request_expired_before_commit");
        }
        await assertMutationAuthority();
        checkpoint(request.database_path, initialIdentity);
        await fence();
        const releasedIdentity = inspectFile(
          request.database_path,
          "source_wal_source_identity_drift",
        );
        if (!sameIdentity(releasedIdentity, initialIdentity)) {
          fail("source_wal_source_identity_drift");
        }
        if (logicalDigest(request.database_path) !== initialDigest) {
          fail("source_wal_logical_drift_after_checkpoint");
        }
        await cleanGovernedOrphanShm({
          databasePath: request.database_path,
          expectedDigest: initialDigest,
          expectedIdentity: initialIdentity,
          fence: assertMutationAuthority,
          record: shmCleanup,
        });
        assertCheckpointedSidecars(request.database_path);
        const postReleaseIdentity = inspectFile(
          request.database_path,
          "source_wal_source_identity_drift",
        );
        if (!sameIdentity(postReleaseIdentity, initialIdentity)) {
          fail("source_wal_source_identity_drift");
        }

        const assetDirectory = path.join(directory, "backup");
        assertOutputDirectoryAuthority(outputDirectoryAuthority, directory);
        await assertMutationAuthority();
        await fsp.mkdir(assetDirectory, { recursive: false });
        assertOutputDirectoryAuthority(outputDirectoryAuthority, directory);
        bindOutputDirectoryAuthority(outputDirectoryAuthority, assetDirectory);
        inspectDirectory(assetDirectory, "source_wal_backup_directory_invalid");
        await validateSourceState({
          request,
          initialIdentity,
          expectedPhysicalHash: postReleaseIdentity.sha256,
          expectedLogicalDigest: initialDigest,
          fence,
          shmCleanup,
          completionNow,
          stage: "before_post_maintenance_phase_write",
          attestations: postReleaseAttestations,
          runtimeAuthority: admittedRuntimeAuthority,
        });
        postReleaseMaintenanceWindow = {
          started_at: postReleaseMaintenanceStartedAt.toISOString(),
          completed_at: postReleaseAttestations.at(-1).completed_at,
          request_unexpired_at_start: true,
          activation_receipt_absent_before_checkpoint: true,
          authoritative_quiescence_before_checkpoint: true,
          checkpoint_mode: "TRUNCATE",
          governed_shm_cleanup: true,
        };
        const postMaintenancePhaseBody = {
          schema_version: "pulse-source-wal-phase-post-maintenance-v1",
          operation_fingerprint: fingerprint,
          runtime_authority: admittedRuntimeAuthority,
          source_identity: postReleaseIdentity,
          source_logical_sha256: initialDigest,
          transition_lease_rows: 0,
          wal: postReleaseAttestations.at(-1).wal,
          shm: postReleaseAttestations.at(-1).shm,
          maintenance_window: postReleaseMaintenanceWindow,
          protected_validation_classification_path:
            protectedClassificationIdentity.path,
          protected_validation_classification_sha256:
            protectedClassificationIdentity.sha256,
        };
        const postMaintenancePhaseBytes = Buffer.from(
          `${JSON.stringify(stable(postMaintenancePhaseBody), null, 2)}\n`,
        );
        await writeNoClobber(
          phasePaths.postMaintenance,
          postMaintenancePhaseBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        postMaintenancePhaseIdentity = inspectFile(
          phasePaths.postMaintenance,
          "source_wal_post_maintenance_phase_invalid",
        );
        await validateSourceState({
          request,
          initialIdentity,
          expectedPhysicalHash: postReleaseIdentity.sha256,
          expectedLogicalDigest: initialDigest,
          fence,
          shmCleanup,
          completionNow,
          stage: "before_canonical_backup",
          attestations: postReleaseAttestations,
          runtimeAuthority: admittedRuntimeAuthority,
        });

        const canonicalBackupAt = completionNow();
        if (!requestIsCurrent(request, canonicalBackupAt)) {
          fail("source_wal_request_expired_before_commit");
        }
        await assertMutationAuthority();
        const canonicalSourceHandle = new Database(request.database_path, {
          fileMustExist: true,
        });
        let backupReport;
        try {
          assertOpenedMainIdentity(canonicalSourceHandle, initialIdentity);
          backupReport = await backup({
            dbPath: request.database_path,
            backupDir: assetDirectory,
            dbHandle: canonicalSourceHandle,
            env: {},
            logger: { log() {}, warn() {}, error() {} },
            maxLocalBackups: Number.MAX_SAFE_INTEGER,
            now: () => canonicalBackupAt,
          });
        } finally {
          canonicalSourceHandle.close();
        }
        const backupFiles = validateBackupReport(
          backupReport,
          request,
          assetDirectory,
        );
        await fsyncFile(
          backupFiles.backup.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        await fsyncFile(
          backupFiles.verification.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        canonicalArtifactsForInvalidation.push(
          backupFiles.backup,
          backupFiles.verification,
        );
        assertTransitionLeaseAbsent(
          backupFiles.backup.path,
          backupFiles.backup,
          "source_wal_canonical_backup_contains_transition_lease",
        );
        if (dependencies.afterCanonicalBackup) {
          await dependencies.afterCanonicalBackup();
        }
        await validateSourceState({
          request,
          initialIdentity,
          expectedPhysicalHash: postReleaseIdentity.sha256,
          expectedLogicalDigest: initialDigest,
          fence,
          shmCleanup,
          completionNow,
          stage: "after_canonical_backup",
          attestations: postReleaseAttestations,
          runtimeAuthority: admittedRuntimeAuthority,
          driftCode: "source_wal_source_drift_during_canonical_backup",
        });

        const restorePath = path.join(assetDirectory, "restore.db");
        const restoreEvidencePath = path.join(
          assetDirectory,
          "restore.rehearsal.json",
        );
        const canonicalRestoreAt = new Date(
          Math.max(
            completionNow().getTime(),
            Date.parse(backupReport.verifiedAt),
          ),
        );
        if (!requestIsCurrent(request, canonicalRestoreAt)) {
          fail("source_wal_request_expired_before_commit");
        }
        await assertMutationAuthority();
        const restoreReport = await rehearse({
          backupPath: backupReport.backupPath,
          backupVerificationPath: backupReport.evidencePath,
          restorePath,
          evidencePath: restoreEvidencePath,
          generatedAt: canonicalRestoreAt,
        });
        const restoreFiles = validateRestoreReport(
          restoreReport,
          {
            backup: backupReport.backupPath,
            restore: restorePath,
            evidence: restoreEvidencePath,
          },
          backupFiles.backup,
        );
        await fsyncFile(
          restoreFiles.restore.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        await fsyncFile(
          restoreFiles.evidence.path,
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
        canonicalArtifactsForInvalidation.push(
          restoreFiles.restore,
          restoreFiles.evidence,
        );
        assertTransitionLeaseAbsent(
          restoreFiles.restore.path,
          restoreFiles.restore,
          "source_wal_canonical_restore_contains_transition_lease",
        );
        await validateSourceState({
          request,
          initialIdentity,
          expectedPhysicalHash: postReleaseIdentity.sha256,
          expectedLogicalDigest: initialDigest,
          fence,
          shmCleanup,
          completionNow,
          stage: "before_backup_evidence_compose",
          attestations: postReleaseAttestations,
          runtimeAuthority: admittedRuntimeAuthority,
          driftCode: "source_wal_source_drift_during_canonical_restore",
        });

        const completion = new Date(
          Math.max(
            completionNow().getTime(),
            Date.parse(backupReport.verifiedAt),
            Date.parse(restoreReport.generated_at),
          ),
        );
        if (!requestIsCurrent(request, completion)) {
          fail("source_wal_request_expired_before_commit");
        }
        const composed = await compose({
          databasePath: request.database_path,
          backupVerificationPath: backupReport.evidencePath,
          restoreRehearsalPath: restoreEvidencePath,
          generatedAt: completion.toISOString(),
          verifiedBy: request.operator_id,
        });
        if (composed?.verdict !== "PASS" || !composed.evidence) {
          fail("source_wal_cutover_evidence_invalid");
        }
        const canonicalBackupEvidence = composed.evidence;
        if (
          canonicalBackupEvidence.schema_version !== BACKUP_SCHEMA ||
          canonicalBackupEvidence.backup_restore_hashes_match !== true ||
          !samePath(
            canonicalBackupEvidence.source_database_path,
            request.database_path,
          ) ||
          !samePath(
            canonicalBackupEvidence.backup_path,
            backupReport.backupPath,
          ) ||
          !samePath(canonicalBackupEvidence.restore_path, restorePath) ||
          canonicalBackupEvidence.source_database_sha256 !==
            postReleaseIdentity.sha256 ||
          canonicalBackupEvidence.backup_sha256 !== backupFiles.backup.sha256 ||
          canonicalBackupEvidence.restore_sha256 !== restoreFiles.restore.sha256
        ) {
          fail("source_wal_cutover_evidence_invalid");
        }

        const assertFinalAuthorityBindings = () => {
          bindRuntimeProfile(
            initialRuntimeProfile.identity,
            "source_wal_runtime_profile_changed_during_finalisation",
          );
          inspectExecutorCheckout();
          assertOutputDirectoryAuthority(
            outputDirectoryAuthority,
            directory,
          );
          return true;
        };
        const awaitFinalCallback = async (callback) => {
          if (!callback) return;
          assertFinalAuthorityBindings();
          await callback();
          assertFinalAuthorityBindings();
        };
        finalAuthorityValidator = assertFinalAuthorityBindings;
        assertFinalAuthorityBindings();

        const finalEvidenceComponents = [];
        const bindFinalEvidenceComponent = (file, bytes) => {
          assertFinalAuthorityBindings();
          assertOutputFileAuthority(outputDirectoryAuthority, file);
          const identity = inspectFile(
            file,
            "source_wal_final_evidence_component_invalid",
          );
          if (identity.sha256 !== sha256(bytes)) {
            fail("source_wal_final_evidence_component_invalid");
          }
          finalEvidenceComponents.push(identity);
          assertFinalAuthorityBindings();
          assertOutputFileAuthority(outputDirectoryAuthority, file);
          return identity;
        };
        const validateFinalOperationState = async ({
          stage,
          driftCode = "source_wal_source_drift_before_evidence_commit",
        }) => {
          assertFinalAuthorityBindings();
          await validateActiveArtifactSet({
            request,
            directory,
            canonicalEvidence: canonicalBackupEvidence,
            backupFiles,
            restoreFiles,
            protectedValidation,
            runtimeAuthority: admittedRuntimeAuthority,
            beforeMutation: assertMutationAuthority,
          });
          await validateSourceState({
            request,
            initialIdentity,
            expectedPhysicalHash: postReleaseIdentity.sha256,
            expectedLogicalDigest: initialDigest,
            fence,
            shmCleanup,
            completionNow,
            stage,
            attestations: postReleaseAttestations,
            runtimeAuthority: admittedRuntimeAuthority,
            driftCode,
          });
          assertFinalAuthorityBindings();
          await validateActiveArtifactSet({
            request,
            directory,
            canonicalEvidence: canonicalBackupEvidence,
            backupFiles,
            restoreFiles,
            protectedValidation,
            runtimeAuthority: admittedRuntimeAuthority,
            beforeMutation: assertMutationAuthority,
          });
          validateFinalEvidenceComponents(finalEvidenceComponents);
          assertFinalAuthorityBindings();
        };
        const validateFinalPrelinkState = () => {
          assertFinalAuthorityBindings();
          activationReceiptAbsent(request.activation_receipt_path);
          if (!requestIsCurrent(request, completionNow())) {
            fail("source_wal_request_expired_before_commit");
          }

          const exactComponents = [
            [
              initialPhaseIdentity,
              "source_wal_initial_phase_invalid",
            ],
            [
              postMaintenancePhaseIdentity,
              "source_wal_post_maintenance_phase_invalid",
            ],
            [
              protectedClassificationIdentity,
              "source_wal_protected_classification_invalid",
            ],
            [
              protectedBackupFiles.backup,
              "source_wal_protected_backup_invalid",
            ],
            [
              protectedBackupFiles.verification,
              "source_wal_protected_backup_verification_invalid",
            ],
            [
              protectedRestoreFiles.restore,
              "source_wal_protected_restore_invalid",
            ],
            [
              protectedRestoreFiles.evidence,
              "source_wal_protected_restore_evidence_invalid",
            ],
            [backupFiles.backup, "source_wal_canonical_backup_invalid"],
            [
              backupFiles.verification,
              "source_wal_canonical_backup_verification_invalid",
            ],
            [restoreFiles.restore, "source_wal_canonical_restore_invalid"],
            [
              restoreFiles.evidence,
              "source_wal_canonical_restore_evidence_invalid",
            ],
          ];
          for (const [expected, code] of exactComponents) {
            assertOutputFileAuthority(outputDirectoryAuthority, expected.path);
            inspectBoundFile(expected, code);
          }

          const protectedClassificationBody = readBoundJson(
            protectedClassificationIdentity,
            "source_wal_protected_classification_invalid",
          );
          if (
            !sameProtectedClassification(
              protectedValidation,
              protectedClassificationBody,
            )
          ) {
            fail("source_wal_protected_classification_invalid");
          }
          inspectProtectedTransitionLeaseBinding(
            protectedBackupFiles.backup.path,
            protectedBackupFiles.backup,
            {
              authorityContextSha256:
                admittedRuntimeAuthority.authority_fingerprint,
              operationFingerprint: fingerprint,
              expectedBinding: protectedValidation.transition_lease_binding,
            },
            "source_wal_protected_backup_lease_invalid",
          );
          inspectProtectedTransitionLeaseBinding(
            protectedRestoreFiles.restore.path,
            protectedRestoreFiles.restore,
            {
              authorityContextSha256:
                admittedRuntimeAuthority.authority_fingerprint,
              operationFingerprint: fingerprint,
              expectedBinding: protectedValidation.transition_lease_binding,
            },
            "source_wal_protected_restore_lease_invalid",
          );
          assertCheckpointedSidecars(
            protectedBackupFiles.backup.path,
            "source_wal_protected_backup_sidecar_remaining",
          );
          inspectBoundFile(
            protectedBackupFiles.backup,
            "source_wal_protected_validation_invalid",
          );
          assertCheckpointedSidecars(
            protectedRestoreFiles.restore.path,
            "source_wal_protected_restore_sidecar_remaining",
          );
          inspectBoundFile(
            protectedRestoreFiles.restore,
            "source_wal_protected_validation_invalid",
          );

          assertTransitionLeaseAbsent(
            backupFiles.backup.path,
            backupFiles.backup,
            "source_wal_canonical_backup_contains_transition_lease",
          );
          assertTransitionLeaseAbsent(
            restoreFiles.restore.path,
            restoreFiles.restore,
            "source_wal_canonical_restore_contains_transition_lease",
          );
          for (const database of [backupFiles.backup, restoreFiles.restore]) {
            assertCheckpointedSidecars(
              database.path,
              "source_wal_canonical_artifact_sidecar_remaining",
            );
            inspectBoundFile(database, "source_wal_canonical_artifact_state_invalid");
          }

          if (finalEvidenceComponents.length !== 3) {
            fail("source_wal_final_evidence_component_invalid");
          }
          validateFinalEvidenceComponents(finalEvidenceComponents);

          const finalSource = inspectBoundFile(
            postReleaseIdentity,
            "source_wal_source_identity_drift",
          );
          assertTransitionLeaseAbsent(
            request.database_path,
            finalSource,
            "source_wal_transition_lease_reappeared",
          );
          assertCheckpointedSidecars(request.database_path);
          if (logicalDigest(request.database_path) !== initialDigest) {
            fail("source_wal_source_drift_before_evidence_commit");
          }
          inspectBoundFile(
            postReleaseIdentity,
            "source_wal_source_identity_drift",
          );
          assertCheckpointedSidecars(request.database_path);

          activationReceiptAbsent(request.activation_receipt_path);
          if (!requestIsCurrent(request, completionNow())) {
            fail("source_wal_request_expired_before_commit");
          }
          assertFinalAuthorityBindings();
          validateFinalEvidenceComponents(finalEvidenceComponents);
          for (const [expected, code] of exactComponents) {
            inspectBoundFile(expected, code);
          }
          return true;
        };

        await awaitFinalCallback(dependencies.afterBackupEvidenceCompose);
        await validateFinalOperationState({
          stage: "after_backup_evidence_compose",
          driftCode: "source_wal_source_drift_after_composer",
        });

        const paths = finalPaths(directory);
        finalEvidencePaths = paths;
        const backupEvidenceBytes = Buffer.from(
          `${JSON.stringify(stable(canonicalBackupEvidence), null, 2)}\n`,
        );
        const backupEvidenceSha256 = sha256(backupEvidenceBytes);
        await awaitFinalCallback(dependencies.beforeEvidenceCommit);
        await awaitFinalCallback(dependencies.beforeBackupEvidenceWrite);
        await validateFinalOperationState({
          stage: "before_backup_evidence_write",
        });
        assertDistinctFiles(
          [
            initialIdentity,
            initialPhaseIdentity,
            postMaintenancePhaseIdentity,
            protectedBackupFiles.backup,
            protectedBackupFiles.verification,
            protectedRestoreFiles.restore,
            protectedRestoreFiles.evidence,
            protectedClassificationIdentity,
            backupFiles.backup,
            backupFiles.verification,
            restoreFiles.restore,
            restoreFiles.evidence,
          ],
          "source_wal_artifact_identity_collision",
        );

        await awaitFinalCallback(dependencies.beforeJsonEvidenceWrite);
        await validateFinalOperationState({
          stage: "before_json_evidence_write",
        });

        const body = {
          schema_version: EVIDENCE_SCHEMA,
          operation_fingerprint: fingerprint,
          generated_at: completion.toISOString(),
          change_id: request.change_id,
          operator_id: request.operator_id,
          verdict: "PASS",
          blockers: [],
          runtime_authority: admittedRuntimeAuthority,
          quiescence_diagnostics: null,
          backup_evidence_path: paths.backupEvidence,
          backup_evidence_sha256: backupEvidenceSha256,
          final_completion_authority: {
            role: "CANONICAL_BACKUP_EVIDENCE_FINAL_MARKER",
            path: paths.backupEvidence,
            sha256: backupEvidenceSha256,
            installed_after_post_commit_fence: true,
            required_by_canonical_consumers: true,
          },
          source_identity: postReleaseIdentity,
          post_maintenance_source: {
            identity: postReleaseIdentity,
            logical_sha256: initialDigest,
            transition_lease_rows: 0,
            wal_status: "ABSENT_OR_ZERO_LENGTH",
            shm_status: "ABSENT",
          },
          phase_journals: {
            initial_identity: initialPhaseIdentity,
            initial_path: initialPhaseIdentity.path,
            initial_sha256: initialPhaseIdentity.sha256,
            post_maintenance_identity: postMaintenancePhaseIdentity,
            post_maintenance_path: postMaintenancePhaseIdentity.path,
            post_maintenance_sha256: postMaintenancePhaseIdentity.sha256,
          },
          source_maintenance_performed: true,
          source_maintenance_actions: [
            "transition_lease_acquire_release",
            "wal_checkpoint_truncate",
            "governed_orphan_shm_cleanup",
            "lease_protected_noncanonical_backup_restore",
            "post_release_canonical_backup_restore",
          ],
          protected_validation: protectedValidation,
          canonical_artifacts: {
            classification: "CANONICAL_POST_TRANSITION_LEASE_RELEASE",
            canonical_evidence_input: true,
            restore_eligible: true,
            created_after_standard_transition_lease_release: true,
            backup_identity: backupFiles.backup,
            backup_verification_identity: backupFiles.verification,
            backup_transition_lease_rows: 0,
            restore_identity: restoreFiles.restore,
            restore_evidence_identity: restoreFiles.evidence,
            restore_transition_lease_rows: 0,
          },
          transition_lease_boundary: {
            standard_transition_lease_scope:
              "SOURCE_CHECKPOINT_AND_NONCANONICAL_VALIDATION",
            protected_validation_completed_before_release: true,
            protected_validation_restore_eligible: false,
            lease_released_before_post_release_maintenance: true,
            canonical_artifacts_created_after_release: true,
            post_release_lease_gap_exists: true,
            continuous_transition_lease_coverage_claimed: false,
            post_release_gap_control:
              "REPEATED_QUIESCENCE_SOURCE_AND_ARTIFACT_FENCES",
          },
          canonical_backup_evidence_scope: {
            production_database_mutated_false_means:
              "restore_rehearsal_did_not_mutate_production_source",
            source_maintenance_is_attested_by_clean_close_evidence: true,
            final_marker_is_snapshot_authority_only: true,
            consumer_must_revalidate_source_identity_and_logical_state: true,
            consumer_must_revalidate_quiescence_receipt_and_sidecars: true,
          },
          external_authority: {
            live_publish_performed: false,
            oauth_or_token_mutation_performed: false,
            scheduled_task_mutation_performed: false,
          },
          lease_released_before_post_release_evidence: true,
          continuous_transition_lease_coverage_claimed: false,
          post_release_maintenance_window: postReleaseMaintenanceWindow,
          post_release_compensating_fences: [...postReleaseAttestations],
          post_commit_fence_policy: {
            required_before_final_completion_marker_install: true,
            invalidates_all_usable_evidence_on_failure: true,
            no_callback_await_or_fence_after_marker_install: true,
          },
          governed_orphan_shm_cleanup: shmCleanup,
          durability: {
            body_files_fsync: true,
            commit_file_fsync: true,
            directory_fsync: "UNSUPPORTED_NTFS_EPERM",
          },
        };
        const jsonBytes = Buffer.from(
          `${JSON.stringify(stable(body), null, 2)}\n`,
        );
        await writeNoClobber(
          paths.json,
          jsonBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        bindFinalEvidenceComponent(paths.json, jsonBytes);

        await awaitFinalCallback(dependencies.beforeMarkdownEvidenceWrite);
        await validateFinalOperationState({
          stage: "before_markdown_evidence_write",
        });
        const markdownBytes = Buffer.from(renderMarkdown(body));
        await writeNoClobber(
          paths.markdown,
          markdownBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        bindFinalEvidenceComponent(paths.markdown, markdownBytes);

        await awaitFinalCallback(dependencies.beforeCommitWrite);
        await validateFinalOperationState({
          stage: "before_commit_write",
        });
        const commitBody = {
          schema_version: COMMIT_SCHEMA,
          operation_fingerprint: fingerprint,
          runtime_authority: admittedRuntimeAuthority,
          json_sha256: sha256(jsonBytes),
          markdown_sha256: sha256(markdownBytes),
          backup_evidence_sha256: backupEvidenceSha256,
          final_completion_authority: body.final_completion_authority,
          initial_phase_sha256: initialPhaseIdentity.sha256,
          post_maintenance_phase_sha256: postMaintenancePhaseIdentity.sha256,
          protected_validation_classification_sha256:
            protectedClassificationIdentity.sha256,
          protected_backup_sha256: protectedBackupFiles.backup.sha256,
          protected_backup_verification_sha256:
            protectedBackupFiles.verification.sha256,
          protected_restore_sha256: protectedRestoreFiles.restore.sha256,
          protected_restore_evidence_sha256:
            protectedRestoreFiles.evidence.sha256,
          canonical_backup_sha256: backupFiles.backup.sha256,
          canonical_backup_verification_sha256: backupFiles.verification.sha256,
          canonical_restore_sha256: restoreFiles.restore.sha256,
          canonical_restore_evidence_sha256: restoreFiles.evidence.sha256,
          source_maintenance_performed: true,
          canonical_backup_evidence_production_database_mutated_scope:
            "restore_rehearsal_only",
          external_authority: body.external_authority,
          lease_released_before_post_release_evidence: true,
          continuous_transition_lease_coverage_claimed: false,
          post_release_maintenance_window: postReleaseMaintenanceWindow,
          post_release_compensating_fences: [...postReleaseAttestations],
          post_commit_fence_policy: body.post_commit_fence_policy,
          transition_lease_boundary: body.transition_lease_boundary,
          durability: {
            body_files_fsync: true,
            commit_file_fsync: true,
            directory_fsync: "UNSUPPORTED_NTFS_EPERM",
          },
        };
        const commitBytes = Buffer.from(
          `${JSON.stringify(stable(commitBody), null, 2)}\n`,
        );
        await writeNoClobber(
          paths.commit,
          commitBytes,
          outputDirectoryAuthority,
          { beforeMutation: assertMutationAuthority },
        );
        bindFinalEvidenceComponent(paths.commit, commitBytes);

        await awaitFinalCallback(dependencies.afterFinalCommit);
        await validateFinalOperationState({
          stage: "after_final_commit",
        });
        assertFinalAuthorityBindings();
        assertOutputFileAuthority(
          outputDirectoryAuthority,
          paths.backupEvidence,
        );
        await writeNoClobber(
          paths.backupEvidence,
          backupEvidenceBytes,
          outputDirectoryAuthority,
          {
            beforeInstall: validateFinalPrelinkState,
            beforeMutation: assertMutationAuthority,
            finalMarkerCriticalInstall: true,
          },
        );
        committed = true;
        result = {
          verdict: "PASS",
          blockers: [],
          status: "COMMITTED",
          quiescence_diagnostics: null,
          evidence_json: paths.json,
          evidence_markdown: paths.markdown,
          evidence_commit: paths.commit,
          backup_evidence_json: paths.backupEvidence,
          phase_initial: initialPhaseIdentity.path,
          phase_post_maintenance: postMaintenancePhaseIdentity.path,
          protected_validation_classification:
            protectedClassificationIdentity.path,
          phase_journals: body.phase_journals,
          protected_validation: body.protected_validation,
          canonical_artifacts: body.canonical_artifacts,
          final_completion_authority: body.final_completion_authority,
          transition_lease_boundary: body.transition_lease_boundary,
          operation_fingerprint: fingerprint,
          runtime_authority: admittedRuntimeAuthority,
          backup: backupReport,
          restore: restoreReport,
          source_maintenance_performed: true,
          external_authority: body.external_authority,
          lease_released_before_post_release_evidence: true,
          continuous_transition_lease_coverage_claimed: false,
          post_release_maintenance_window: postReleaseMaintenanceWindow,
          post_release_compensating_fences: postReleaseAttestations,
          no_clobber_crash_recovery: noClobberCrashRecovery,
        };
      }
    }
  } catch (error) {
    try {
      dependencies.onError?.(error);
    } catch {}
    const code = safeCode(error);
    let invalidationFailed = false;
    if (postReleaseEvidencePhase) {
      if (finalEvidencePaths) {
        try {
          await invalidateFinalFiles(
            finalEvidencePaths,
            outputDirectoryAuthority,
            assertMutationAuthority,
          );
        } catch {
          invalidationFailed = true;
        }
      }
      try {
        await invalidateBoundFiles(
          canonicalArtifactsForInvalidation,
          path.join(directory, "backup"),
          outputDirectoryAuthority,
          assertMutationAuthority,
        );
      } catch {
        invalidationFailed = true;
      }
    }
    const status =
      code === "source_wal_lease_release_failed" ||
      code === "source_wal_partial_output_recovery_required" ||
      invalidationFailed
        ? "RECOVERY_REQUIRED"
        : postReleaseEvidencePhase
          ? "EVIDENCE_PENDING"
          : "HELD";
    result = await hold(code, status);
    if (invalidationFailed) {
      result = {
        ...result,
        verdict: "HOLD",
        status: "RECOVERY_REQUIRED",
        blockers: [
          ...new Set([
            ...(result?.blockers || []),
            "source_wal_evidence_invalidation_failed",
          ]),
        ],
      };
    }
  } finally {
    if (lease && !leaseReleaseAttempted) {
      try {
        await releaseTransitionLease();
      } catch {
        result = {
          ...(result || {}),
          verdict: "HOLD",
          status: "RECOVERY_REQUIRED",
          blockers: [
            ...new Set([
              ...(result?.blockers || []),
              "source_wal_lease_release_failed",
            ]),
          ],
          committed_evidence_requires_recovery: committed,
        };
      }
    }
  }
  return result;
}

module.exports = {
  BACKUP_SCHEMA,
  COMMIT_SCHEMA,
  EVIDENCE_SCHEMA,
  REQUEST_SCHEMA,
  cleanCloseGovernedSourceWal,
  logicalDigest,
  samePath,
};
