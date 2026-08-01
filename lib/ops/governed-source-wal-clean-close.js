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
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../stabilisation/live-runtime-transition-lease");
const {
  inspectWindowsPulseQuiescence,
} = require("./governed-exact-production-plan-drain");
const {
  DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  LIVE_PROFILE_ID,
  LIVE_PROFILE_SCHEMA,
  loadLiveGuardedRuntimeProfile,
} = require("../stabilisation/windows-live-guarded-runtime");

const REQUEST_SCHEMA = "pulse-governed-source-wal-clean-close-request-v4";
const EVIDENCE_SCHEMA = "pulse-governed-source-wal-clean-close-evidence-v4";
const BACKUP_SCHEMA = "pulse-cutover-backup-evidence-v1";
const COMMIT_SCHEMA = "pulse-governed-source-wal-clean-close-commit-v4";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const QUIESCENCE_PROBES = Object.freeze([
  "listeners",
  "processes",
  "scheduled_tasks",
]);
const QUIESCENCE_UNAVAILABLE_MAX_ATTEMPTS = 3;
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
    expiresAt - generatedAt > 15 * 60 * 1000
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

function assertQuiescent(value, profile) {
  if (!quiescenceInspectionAvailable(value)) {
    fail("source_wal_quiescence_unavailable");
  }
  if (
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

function logicalDigest(databasePath) {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return canonicalSqliteSnapshotDigest(db);
  } finally {
    db.close();
  }
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

function assertCheckpointedSidecars(databasePath) {
  const wal = inspectSidecar(databasePath, "-wal");
  if (wal.exists && wal.file.size !== 0) fail("source_wal_sidecar_remaining");
  if (inspectSidecar(databasePath, "-shm").exists) {
    fail("source_wal_sidecar_remaining");
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

function transitionLeaseCount(databasePath, expectedIdentity, code) {
  let database;
  try {
    database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    assertOpenedMainIdentity(database, expectedIdentity);
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM runtime_leases WHERE name = ?")
      .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
    const count = Number(row?.count);
    if (!Number.isInteger(count) || count < 0) fail(code);
    return count;
  } catch (error) {
    if (error instanceof Hold) throw error;
    fail(code);
  } finally {
    database?.close();
  }
}

function assertTransitionLeaseAbsent(databasePath, expectedIdentity, code) {
  if (transitionLeaseCount(databasePath, expectedIdentity, code) !== 0) {
    fail(code);
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

async function ensureOutputDirectory(root, output, fingerprint) {
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
      await fsp.mkdir(candidate, { recursive: false });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    inspectDirectory(parent, "source_wal_evidence_output_invalid");
    inspectDirectory(candidate, "source_wal_evidence_output_invalid");
    parent = candidate;
  }
  return directory;
}

async function fsyncFile(file) {
  const handle = await fsp.open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    file_fsync: true,
    directory_fsync: "UNSUPPORTED_NTFS_EPERM",
  };
}

function noClobberTemporaryPaths(file) {
  const directory = path.dirname(file);
  const basename = path.basename(file);
  try {
    fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    fail("source_wal_no_clobber_recovery_unsafe");
  }
  inspectDirectory(directory, "source_wal_no_clobber_recovery_unsafe");
  const names = fs.readdirSync(directory);
  return names
    .filter((name) => {
      if (!name.startsWith(`${basename}.`) || !name.endsWith(".tmp")) {
        return false;
      }
      return SHA256.test(name.slice(basename.length + 1, -4));
    })
    .map((name) => path.join(directory, name));
}

async function repairNoClobberCrashState(file) {
  const code = "source_wal_no_clobber_recovery_unsafe";
  const temporaryPaths = noClobberTemporaryPaths(file);
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
    try {
      await fsp.link(temporaryPath, file);
    } catch {
      fail(code);
    }
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

  await fsyncFile(file);
  try {
    await fsp.unlink(temporaryPath);
  } catch {
    fail(code);
  }
  const repaired = inspectFile(file, code);
  if (repaired.sha256 !== encodedHash) fail(code);
  return Object.freeze({
    target_path: repaired.path,
    temporary_path: path.resolve(temporaryPath),
    sha256: repaired.sha256,
    recovered_state: recoveredState,
  });
}

async function repairNoClobberCrashSet(directory) {
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
    const repair = await repairNoClobberCrashState(target);
    if (repair) repairs.push(repair);
  }
  return repairs;
}

async function writeNoClobber(file, bytes) {
  const repaired = await repairNoClobberCrashState(file);
  try {
    const existing = await fsp.readFile(file);
    inspectFile(file, "source_wal_evidence_component_unsafe");
    if (!Buffer.from(existing).equals(bytes))
      fail("source_wal_evidence_conflict");
    return {
      status: repaired ? "RECOVERED" : "REPLAYED",
      durability: await fsyncFile(file),
    };
  } catch (error) {
    if (error instanceof Hold) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${file}.${sha256(bytes)}.tmp`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    inspectFile(temporary, "source_wal_evidence_component_unsafe");
    if (!(await fsp.readFile(temporary)).equals(bytes)) {
      fail("source_wal_evidence_conflict");
    }
  }
  await fsyncFile(temporary);
  try {
    await fsp.link(temporary, file);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    inspectFile(file, "source_wal_evidence_component_unsafe");
    if (!(await fsp.readFile(file)).equals(bytes)) {
      fail("source_wal_evidence_conflict");
    }
  }
  const durability = await fsyncFile(file);
  await fsp.unlink(temporary);
  return { status: "CREATED", durability };
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

async function writeCommittedSet(paths, body, extra = {}) {
  const json = Buffer.from(`${JSON.stringify(stable(body), null, 2)}\n`);
  const markdown = Buffer.from(renderMarkdown(body));
  const jsonWrite = await writeNoClobber(paths.json, json);
  const markdownWrite = await writeNoClobber(paths.markdown, markdown);
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
  const commitWrite = await writeNoClobber(paths.commit, commit);
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

function cleanArtifactSidecars(databasePath, code) {
  const wal = inspectSidecar(databasePath, "-wal");
  if (wal.exists && wal.file.size !== 0) fail(code);
  const shm = inspectSidecar(databasePath, "-shm");
  if (shm.exists) {
    try {
      fs.unlinkSync(shm.file.path);
    } catch {
      fail(code);
    }
  }
  assertCheckpointedSidecars(databasePath);
}

function assertArtifactIntegrity(expected, code) {
  cleanArtifactSidecars(expected.path, code);
  const before = inspectBoundFile(expected, code);
  try {
    const verification = verifyBackupDatabase(expected.path);
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
  cleanArtifactSidecars(expected.path, code);
}

function validateActiveArtifactSet({
  request,
  canonicalEvidence,
  backupFiles,
  restoreFiles,
  protectedValidation,
}) {
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
  assertArtifactIntegrity(backup, "source_wal_canonical_backup_invalid");
  assertArtifactIntegrity(restore, "source_wal_canonical_restore_invalid");
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

function validatePersistedArtifactSet({ request, directory, body, commit }) {
  const paths = finalPaths(directory);
  const phases = body?.phase_journals;
  const canonical = body?.canonical_artifacts;
  const protectedValidation = body?.protected_validation;
  const leaseBoundary = body?.transition_lease_boundary;
  if (
    body?.schema_version !== EVIDENCE_SCHEMA ||
    body?.verdict !== "PASS" ||
    !phases ||
    !canonical ||
    !protectedValidation ||
    canonical.classification !== "CANONICAL_POST_TRANSITION_LEASE_RELEASE" ||
    canonical.canonical_evidence_input !== true ||
    canonical.restore_eligible !== true ||
    canonical.created_after_standard_transition_lease_release !== true ||
    protectedValidation.classification !==
      "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY" ||
    protectedValidation.canonical_evidence_input !== false ||
    protectedValidation.restore_eligible !== false ||
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
    protectedClassificationBody.canonical_evidence_input !== false ||
    protectedClassificationBody.restore_eligible !== false
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
    assertArtifactIntegrity(artifact, code);
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
    !Array.isArray(body.blockers) ||
    body.blockers.length !== 0 ||
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
  const artifacts = validatePersistedArtifactSet({
    request,
    directory,
    body,
    commit,
  });
  validateFinalEvidenceComponents(finalEvidenceComponents);
  await validateReplaySource({ request, sourceIdentity, body, fence });
  validatePersistedArtifactSet({ request, directory, body, commit });
  validateFinalEvidenceComponents(finalEvidenceComponents);
  return {
    verdict: body.verdict,
    blockers: body.blockers,
    status: "REPLAYED",
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
  };
}

async function unlinkKnownAuthorityPath(file) {
  try {
    const stat = await fsp.lstat(file);
    if (stat.isDirectory()) return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
  try {
    await fsp.unlink(file);
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

async function invalidateFinalFiles(paths) {
  let failed = false;
  for (const file of [
    paths.commit,
    paths.json,
    paths.markdown,
    paths.backupEvidence,
  ]) {
    if (!(await unlinkKnownAuthorityPath(file))) failed = true;
    let temporaryPaths = [];
    try {
      temporaryPaths = noClobberTemporaryPaths(file);
    } catch {
      failed = true;
    }
    for (const temporaryPath of temporaryPaths) {
      if (!(await unlinkKnownAuthorityPath(temporaryPath))) failed = true;
    }
  }
  if (failed) fail("source_wal_evidence_invalidation_failed");
}

async function invalidateBoundFiles(files, canonicalRoot) {
  let failed = false;
  for (const expected of files) {
    if (
      !expected?.path ||
      !samePath(path.dirname(path.resolve(expected.path)), canonicalRoot)
    ) {
      failed = true;
      continue;
    }
    if (!(await unlinkKnownAuthorityPath(expected.path))) failed = true;
  }
  if (failed) fail("source_wal_canonical_artifact_invalidation_unsafe");
}

function discoverCanonicalArtifactsForInvalidation(directory) {
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

  let directory = null;
  let lease = null;
  let leaseReleaseAttempted = false;
  let result = null;
  let committed = false;
  let postReleaseEvidencePhase = false;
  let finalEvidencePaths = null;
  let postReleaseMaintenanceWindow = null;
  let protectedValidation = null;
  let initialPhaseIdentity = null;
  let postMaintenancePhaseIdentity = null;
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

  const renewTransitionLease = async (renewedAt = new Date()) => {
    try {
      if ((await lease.renew(renewedAt)) !== true) {
        fail("source_wal_lease_lost");
      }
    } catch {
      fail("source_wal_lease_lost");
    }
  };

  const releaseTransitionLease = async () => {
    const activeLease = lease;
    lease = null;
    leaseReleaseAttempted = true;
    try {
      if ((await activeLease.release()) !== true) {
        fail("source_wal_lease_release_failed");
      }
    } catch {
      fail("source_wal_lease_release_failed");
    }
  };

  const hold = async (code, status = "HELD") => {
    const blockers = [code];
    if (!directory) {
      return {
        verdict: "HOLD",
        blockers,
        status,
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
      backup_evidence_sha256: null,
      durability: {
        body_files_fsync: true,
        commit_file_fsync: true,
        directory_fsync: "UNSUPPORTED_NTFS_EPERM",
      },
    };
    try {
      await writeCommittedSet(paths, body);
      return {
        verdict: "HOLD",
        blockers,
        status,
        evidence_json: paths.json,
        evidence_markdown: paths.markdown,
        evidence_commit: paths.commit,
        operation_fingerprint: fingerprint,
      };
    } catch {
      return {
        verdict: "HOLD",
        blockers: [...blockers, "source_wal_hold_evidence_pending"],
        status: "RECOVERY_REQUIRED",
        operation_fingerprint: fingerprint,
      };
    }
  };

  try {
    if (!safeAuthorityEnvironment(dependencies.env || process.env)) {
      fail("source_wal_authority_environment_invalid");
    }
    inspectDirectory(
      request.executor_workspace_root,
      "source_wal_executor_root_unsafe",
    );
    const executor = (dependencies.inspectExecutor || defaultExecutorInspector)(
      request.executor_workspace_root,
    );
    if (
      executor?.commit !== request.expected_executor_checkout_commit ||
      text(executor?.status) !== ""
    ) {
      fail("source_wal_executor_not_clean");
    }

    directory = await ensureOutputDirectory(
      request.executor_workspace_root,
      request.output_dir,
      fingerprint,
    );
    noClobberCrashRecovery = await repairNoClobberCrashSet(directory);
    canonicalArtifactsForInvalidation.push(
      ...discoverCanonicalArtifactsForInvalidation(directory),
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
    inspectFile(
      request.runtime_profile_path,
      "source_wal_runtime_profile_unsafe",
    );
    if (
      sha256File(request.runtime_profile_path) !==
      request.expected_runtime_profile_file_sha256
    ) {
      fail("source_wal_preflight_sha_mismatch");
    }

    let profile;
    try {
      profile = JSON.parse(
        fs.readFileSync(request.runtime_profile_path, "utf8"),
      );
    } catch {
      fail("source_wal_runtime_profile_invalid");
    }
    const profileValidation = (
      dependencies.runtimeProfileValidator || defaultRuntimeProfileValidator
    )(profile, request);
    if (
      profileValidation?.valid !== true ||
      profileValidation?.blockers?.length ||
      !samePath(profile.database_path, request.database_path) ||
      !samePath(
        profile.activation_receipt_path,
        request.activation_receipt_path,
      )
    ) {
      fail("source_wal_runtime_profile_invalid");
    }

    const fence = async () => {
      let observed;
      for (
        let attempt = 1;
        attempt <= QUIESCENCE_UNAVAILABLE_MAX_ATTEMPTS;
        attempt += 1
      ) {
        activationReceiptAbsent(request.activation_receipt_path);
        observed = await inspectQuiescence({
          profile,
          workspaceRoot: request.executor_workspace_root,
          expectedCommit: request.expected_executor_checkout_commit,
        });
        if (quiescenceInspectionAvailable(observed)) {
          assertQuiescent(observed, profile);
          return;
        }
      }
      assertQuiescent(observed, profile);
    };

    await fence();
    const replay = await recoverCommittedResult({
      directory,
      fingerprint,
      request,
      sourceIdentity: initialIdentity,
      fence,
      invalidationArtifacts: canonicalArtifactsForInvalidation,
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
      if (initialIdentity.sha256 !== request.expected_database_sha256) {
        fail("source_wal_preflight_sha_mismatch");
      }
      const initialWal = inspectSidecar(request.database_path, "-wal");
      if (initialWal.exists && initialWal.file.size !== 0) {
        fail("source_wal_preflight_wal_not_zero");
      }
      const initialDigest = logicalDigest(request.database_path);
      if (fs.readdirSync(directory).length > 0) {
        fail("source_wal_partial_output_recovery_required");
      } else {
        const phasePaths = phaseJournalPaths(directory);
        const initialPhaseBody = {
          schema_version: "pulse-source-wal-phase-initial-v1",
          operation_fingerprint: fingerprint,
          request_database_sha256: request.expected_database_sha256,
          source_identity: initialIdentity,
          source_logical_sha256: initialDigest,
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
        await writeNoClobber(phasePaths.initial, initialPhaseBytes);
        initialPhaseIdentity = inspectFile(
          phasePaths.initial,
          "source_wal_initial_phase_invalid",
        );
        lease = acquireLease({
          databasePath: request.database_path,
          action: "governed_source_wal_clean_close",
          binding: fingerprint,
          metadata: { operation_fingerprint: fingerprint },
          now: operationNow,
          runtimeTransitionLeaseFactory:
            dependencies.runtimeTransitionLeaseFactory,
        });
        if (!lease?.renew || !lease?.release) {
          fail("source_wal_lease_unavailable");
        }
        await renewTransitionLease(operationNow);
        await fence();

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
        await fsp.mkdir(protectedPaths.assetDirectory, { recursive: false });
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
        await fsyncFile(protectedBackupFiles.backup.path);
        await fsyncFile(protectedBackupFiles.verification.path);
        if (dependencies.afterBackup) await dependencies.afterBackup();
        await renewTransitionLease();

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
        await fsyncFile(protectedRestoreFiles.restore.path);
        await fsyncFile(protectedRestoreFiles.evidence.path);
        await renewTransitionLease();

        const protectedClassificationBody = {
          schema_version: "pulse-noncanonical-lease-protected-validation-v1",
          operation_fingerprint: fingerprint,
          classification: "NONCANONICAL_TRANSITION_LEASE_VALIDATION_ONLY",
          canonical_evidence_input: false,
          restore_eligible: false,
          protected_by_standard_transition_lease: true,
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
        };
        const protectedClassificationBytes = Buffer.from(
          `${JSON.stringify(stable(protectedClassificationBody), null, 2)}\n`,
        );
        await fence();
        await writeNoClobber(
          protectedPaths.classification,
          protectedClassificationBytes,
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
        await fence();
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
          fence,
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
        await fsp.mkdir(assetDirectory, { recursive: false });
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
        });

        const canonicalBackupAt = completionNow();
        if (!requestIsCurrent(request, canonicalBackupAt)) {
          fail("source_wal_request_expired_before_commit");
        }
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
        await fsyncFile(backupFiles.backup.path);
        await fsyncFile(backupFiles.verification.path);
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
        await fsyncFile(restoreFiles.restore.path);
        await fsyncFile(restoreFiles.evidence.path);
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

        const finalEvidenceComponents = [];
        const bindFinalEvidenceComponent = (file, bytes) => {
          const identity = inspectFile(
            file,
            "source_wal_final_evidence_component_invalid",
          );
          if (identity.sha256 !== sha256(bytes)) {
            fail("source_wal_final_evidence_component_invalid");
          }
          finalEvidenceComponents.push(identity);
          return identity;
        };
        const validateFinalOperationState = async ({
          stage,
          driftCode = "source_wal_source_drift_before_evidence_commit",
        }) => {
          validateActiveArtifactSet({
            request,
            canonicalEvidence: canonicalBackupEvidence,
            backupFiles,
            restoreFiles,
            protectedValidation,
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
            driftCode,
          });
          validateActiveArtifactSet({
            request,
            canonicalEvidence: canonicalBackupEvidence,
            backupFiles,
            restoreFiles,
            protectedValidation,
          });
          validateFinalEvidenceComponents(finalEvidenceComponents);
        };

        if (dependencies.afterBackupEvidenceCompose) {
          await dependencies.afterBackupEvidenceCompose();
        }
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
        if (dependencies.beforeEvidenceCommit) {
          await dependencies.beforeEvidenceCommit();
        }
        if (dependencies.beforeBackupEvidenceWrite) {
          await dependencies.beforeBackupEvidenceWrite();
        }
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

        if (dependencies.beforeJsonEvidenceWrite) {
          await dependencies.beforeJsonEvidenceWrite();
        }
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
        await writeNoClobber(paths.json, jsonBytes);
        bindFinalEvidenceComponent(paths.json, jsonBytes);

        if (dependencies.beforeMarkdownEvidenceWrite) {
          await dependencies.beforeMarkdownEvidenceWrite();
        }
        await validateFinalOperationState({
          stage: "before_markdown_evidence_write",
        });
        const markdownBytes = Buffer.from(renderMarkdown(body));
        await writeNoClobber(paths.markdown, markdownBytes);
        bindFinalEvidenceComponent(paths.markdown, markdownBytes);

        if (dependencies.beforeCommitWrite) {
          await dependencies.beforeCommitWrite();
        }
        await validateFinalOperationState({
          stage: "before_commit_write",
        });
        const commitBody = {
          schema_version: COMMIT_SCHEMA,
          operation_fingerprint: fingerprint,
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
        await writeNoClobber(paths.commit, commitBytes);
        bindFinalEvidenceComponent(paths.commit, commitBytes);

        if (dependencies.afterFinalCommit) {
          await dependencies.afterFinalCommit();
        }
        await validateFinalOperationState({
          stage: "after_final_commit",
        });
        await writeNoClobber(paths.backupEvidence, backupEvidenceBytes);
        committed = true;
        result = {
          verdict: "PASS",
          blockers: [],
          status: "COMMITTED",
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
          await invalidateFinalFiles(finalEvidencePaths);
        } catch {
          invalidationFailed = true;
        }
      }
      try {
        await invalidateBoundFiles(
          canonicalArtifactsForInvalidation,
          path.join(directory, "backup"),
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
      const activeLease = lease;
      lease = null;
      leaseReleaseAttempted = true;
      try {
        const released = await activeLease.release();
        if (released !== true) throw new Error("lease_release_false");
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
