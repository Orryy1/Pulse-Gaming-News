"use strict";

const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const defaultFs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const Database = require("better-sqlite3");
const { bind: bindRuntimeLeases } = require("../repositories/runtime_leases");

const {
  canonicalSha256,
} = require("../services/governed-autonomous-production-request-builder");
const {
  acquireLiveRuntimeTransitionLease,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
  sameLiveRuntimeTransitionParticipant,
  validateLiveRuntimeTransitionLeaseRow,
} = require("../stabilisation/live-runtime-transition-lease");
const {
  inspectLiveDatabaseIdentity,
} = require("../stabilisation/windows-live-guarded-runtime");
const {
  inspectExactDatabaseFile,
  inspectExactGovernedPlanQuarantineBindings,
  inspectWindowsPulseQuiescence,
  normaliseQuiescence,
} = require("./governed-exact-production-plan-drain");
const {
  validateCanonicalCutoverBackupEvidenceV1,
} = require("./cutover-backup-evidence");
const {
  canonicalSqliteSnapshotDigest,
  canonicalSqliteStructuralDigest,
  canonicalSqliteStructuralSnapshot,
} = require("./sqlite-canonical-logical-snapshot");

const QUARANTINE_REQUEST_SCHEMA_VERSION =
  "pulse-governed-exact-plan-quarantine-request-v1";
const QUARANTINE_EVIDENCE_SCHEMA_VERSION =
  "pulse-governed-exact-plan-quarantine-evidence-v1";
const ACTION = "governed_exact_plan_quarantine";
const BOUNDED_AUTHORITY_SCHEMA = "pulse-windows-bounded-authority-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_MAX_AGE_MS = 5 * 60 * 1000;

const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "maintenance_mode",
  "generated_at",
  "apply",
  "confirmation_id",
  "change_id",
  "operator_id",
  "plan_path",
  "expected_plan_file_sha256",
  "expected_plan_sha256",
  "workspace_root",
  "database_path",
  "runtime_profile_path",
  "expected_runtime_profile_file_sha256",
  "expected_checkout_commit",
  "executor_workspace_root",
  "expected_executor_checkout_commit",
  "expected_reservation_file_sha256",
  "expected_reservation_set_sha256",
  "expected_primary_job_id",
  "expected_standby_job_id",
  "expected_database_sha256",
  "backup_evidence_path",
  "expected_backup_evidence_file_sha256",
  "output_dir",
]);

const OWNED_BLOCKERS = new Set([
  "quarantine_explicit_apply_required",
  "quarantine_authority_environment_invalid",
  "quarantine_publication_state_present",
  "quarantine_activation_receipt_present",
  "quarantine_runtime_not_quiescent",
  "quarantine_runtime_authority_context_drift",
  "quarantine_standby_fence_lost",
  "quarantine_database_sidecar_present",
  "quarantine_output_path_invalid",
  "quarantine_database_sha256_mismatch",
  "quarantine_database_logical_state_mismatch",
  "quarantine_database_physical_state_mismatch",
  "quarantine_open_database_identity_mismatch",
  "quarantine_file_link_forbidden",
  "quarantine_backup_evidence_stale",
  "quarantine_backup_evidence_file_sha256_mismatch",
  "quarantine_backup_transition_lease_present",
  "quarantine_replay_audit_invalid",
  "quarantine_lease_lost",
  "quarantine_lease_release_failed",
  "quarantine_transition_lease_present",
  "quarantine_apply_failed",
  "quarantine_evidence_conflict",
  "quarantine_evidence_platform_unsupported",
  "quarantine_executor_workspace_mismatch",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function openedDatabaseTransitionLeaseFactory(db) {
  const leases = bindRuntimeLeases(db);
  return () => ({
    leases,
    close() {},
  });
}

function publicError(error) {
  const blocker = safeBlocker(error);
  const result = new Error(blocker);
  result.code = blocker;
  return result;
}

function text(value) {
  return String(value || "").trim();
}

function hashBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function hashFile(fileSystem, file) {
  return hashBytes(await fileSystem.readFile(file));
}

function safeBlocker(error) {
  return OWNED_BLOCKERS.has(error?.code)
    ? error.code
    : "quarantine_apply_failed";
}

function exactFields(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== REQUEST_FIELDS.size ||
    Object.keys(value).some((key) => !REQUEST_FIELDS.has(key))
  ) {
    fail("quarantine_request_fields_invalid");
  }
}

function exactHash(value, code) {
  const result = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(result)) fail(code);
  return result;
}

function exactPath(value, code) {
  const result = text(value);
  if (!result || !path.isAbsolute(result) || path.resolve(result) !== result) {
    fail(code);
  }
  return result;
}

function exactIso(value, code = "quarantine_generated_at_invalid") {
  const result = text(value);
  const milliseconds = Date.parse(result);
  if (
    !result ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== result
  ) {
    fail(code);
  }
  return result;
}

function clockNow(clock, code = "quarantine_clock_invalid") {
  let observed;
  try {
    observed = clock();
  } catch {
    fail(code);
  }
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail(code);
  }
  return observed;
}

function assertRequestCurrent(request, now) {
  if (
    Math.abs(now.getTime() - Date.parse(request.generated_at)) >
    REQUEST_MAX_AGE_MS
  ) {
    fail("quarantine_generated_at_not_current");
  }
}

function normaliseRequest(value, now) {
  exactFields(value);
  if (
    value.schema_version !== QUARANTINE_REQUEST_SCHEMA_VERSION ||
    value.mode !== "LOCAL_PROOF" ||
    value.maintenance_mode !== "HUMAN_REVIEW"
  ) {
    fail("quarantine_mode_invalid");
  }
  if (value.apply !== true) fail("quarantine_explicit_apply_required");
  if (
    !text(value.change_id) ||
    text(value.confirmation_id) !== text(value.change_id) ||
    !text(value.operator_id)
  ) {
    fail("quarantine_confirmation_or_operator_invalid");
  }

  const generatedAt = exactIso(value.generated_at);
  assertRequestCurrent({ generated_at: generatedAt }, now);
  if (
    !COMMIT_PATTERN.test(text(value.expected_checkout_commit)) ||
    !COMMIT_PATTERN.test(text(value.expected_executor_checkout_commit))
  ) {
    fail("quarantine_checkout_commit_invalid");
  }

  const hashFields = [
    "expected_plan_file_sha256",
    "expected_plan_sha256",
    "expected_runtime_profile_file_sha256",
    "expected_reservation_file_sha256",
    "expected_reservation_set_sha256",
    "expected_database_sha256",
    "expected_backup_evidence_file_sha256",
  ];
  const pathFields = [
    "plan_path",
    "workspace_root",
    "executor_workspace_root",
    "database_path",
    "runtime_profile_path",
    "backup_evidence_path",
    "output_dir",
  ];
  for (const field of hashFields) {
    exactHash(value[field], `quarantine_${field}_invalid`);
  }
  for (const field of pathFields) {
    exactPath(value[field], `quarantine_${field}_invalid`);
  }

  const primaryJobId = Number(value.expected_primary_job_id);
  const standbyJobId = Number(value.expected_standby_job_id);
  if (
    !Number.isInteger(primaryJobId) ||
    primaryJobId < 1 ||
    !Number.isInteger(standbyJobId) ||
    standbyJobId < 1 ||
    primaryJobId === standbyJobId
  ) {
    fail("quarantine_job_ids_invalid");
  }

  const result = { ...value, generated_at: generatedAt };
  for (const field of hashFields)
    result[field] = text(value[field]).toLowerCase();
  result.expected_checkout_commit = text(
    value.expected_checkout_commit,
  ).toLowerCase();
  result.expected_executor_checkout_commit = text(
    value.expected_executor_checkout_commit,
  ).toLowerCase();
  result.expected_primary_job_id = primaryJobId;
  result.expected_standby_job_id = standbyJobId;
  return Object.freeze(result);
}

function operationFingerprint(request) {
  const body = { ...request };
  delete body.generated_at;
  return canonicalSha256(body);
}

function authorityEnvironment(environment = {}) {
  return (
    text(environment.PULSE_OPERATING_MODE).toUpperCase() === "LOCAL_PROOF" &&
    text(environment.OPERATING_MODE).toUpperCase() === "LOCAL_PROOF" &&
    /^(false|0)$/i.test(text(environment.AUTO_PUBLISH)) &&
    /^(false|0)$/i.test(
      text(environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED),
    ) &&
    /^(false|0)$/i.test(text(environment.PULSE_PRIMARY_INSTANCE)) &&
    /^(true|1)$/i.test(
      text(
        environment.PULSE_KILL_SWITCH ||
          environment.PULSE_EMERGENCY_KILL_SWITCH,
      ),
    )
  );
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative &&
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function defaultExecutorInspector(root) {
  try {
    return {
      commit: text(
        execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ).toLowerCase(),
      tracked_clean:
        text(
          execFileSync(
            "git",
            ["status", "--porcelain", "--untracked-files=normal"],
            {
              cwd: root,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
            },
          ),
        ) === "",
    };
  } catch {
    return { commit: null, tracked_clean: false };
  }
}

function windowsFileId(file) {
  if (process.platform !== "win32") return null;
  try {
    const output = execFileSync("fsutil.exe", ["file", "queryFileId", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const match = String(output).match(/0x[0-9a-f]+/i);
    return match
      ? `${path.parse(file).root.toLowerCase()}:${match[0].toLowerCase()}`
      : null;
  } catch {
    return null;
  }
}

async function fileIdentity(fileSystem, file, stat, identityProbe) {
  const device = BigInt(stat.dev || 0);
  const inode = BigInt(stat.ino || 0);
  if (device !== 0n && inode !== 0n) {
    return Object.freeze({
      source: "node-stat",
      key: `${device.toString()}:${inode.toString()}`,
    });
  }
  const probed = (identityProbe || windowsFileId)(file);
  if (!probed) fail("quarantine_file_identity_unavailable");
  return Object.freeze({ source: "windows-file-id", key: probed });
}

async function inspectRegularFile(
  fileSystem,
  file,
  code,
  identityProbe = null,
) {
  let stat;
  try {
    stat = await fileSystem.lstat(file, { bigint: true });
  } catch {
    fail(code);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  if (BigInt(stat.nlink || 0) !== 1n) fail("quarantine_file_link_forbidden");

  let realPath;
  try {
    realPath = path.resolve(await fileSystem.realpath(file));
  } catch {
    fail(code);
  }
  if (realPath !== path.resolve(file)) fail(code);
  return Object.freeze({
    path: realPath,
    identity: await fileIdentity(fileSystem, realPath, stat, identityProbe),
  });
}

async function inspectLinkedRegularFile(
  fileSystem,
  file,
  code,
  identityProbe = null,
) {
  let stat;
  try {
    stat = await fileSystem.lstat(file, { bigint: true });
  } catch {
    fail(code);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  const realPath = path.resolve(await fileSystem.realpath(file));
  if (realPath !== path.resolve(file)) fail(code);
  return {
    path: realPath,
    nlink: BigInt(stat.nlink || 0),
    identity: await fileIdentity(fileSystem, realPath, stat, identityProbe),
  };
}

function sameIdentity(left, right) {
  return left?.key && right?.key && left.key === right.key;
}

async function assertStableIdentity(
  fileSystem,
  file,
  expected,
  code,
  identityProbe,
) {
  const observed = await inspectRegularFile(
    fileSystem,
    file,
    code,
    identityProbe,
  );
  if (!sameIdentity(observed.identity, expected.identity)) fail(code);
  return observed;
}

async function assertExecutorCodeBinding({
  fileSystem,
  rootBinding,
  modulePath,
  entrypointPath,
  identityProbe = null,
}) {
  for (const [actualPath, relativePath] of [
    [
      modulePath,
      path.join("lib", "ops", "governed-exact-plan-quarantine.js"),
    ],
    [
      entrypointPath,
      path.join("tools", "governed-exact-plan-quarantine.js"),
    ],
  ]) {
    if (!actualPath || !path.isAbsolute(actualPath)) {
      fail("quarantine_executor_workspace_mismatch");
    }
    const binding = await inspectRegularFile(
      fileSystem,
      actualPath,
      "quarantine_executor_workspace_mismatch",
      identityProbe,
    );
    if (
      binding.path !== path.join(rootBinding.path, relativePath) ||
      !contained(rootBinding.path, binding.path)
    ) {
      fail("quarantine_executor_workspace_mismatch");
    }
  }
}

async function inspectDirectory(
  fileSystem,
  directory,
  code,
  identityProbe = null,
) {
  let stat;
  try {
    stat = await fileSystem.lstat(directory, { bigint: true });
  } catch {
    fail(code);
  }
  let realPath;
  try {
    realPath = path.resolve(await fileSystem.realpath(directory));
  } catch {
    fail(code);
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realPath !== path.resolve(directory)
  ) {
    fail(code);
  }
  return Object.freeze({
    path: realPath,
    identity: await fileIdentity(
      fileSystem,
      realPath,
      stat,
      identityProbe,
    ),
  });
}

async function assertDirectoryBinding(
  fileSystem,
  binding,
  code,
  identityProbe = null,
) {
  const observed = await inspectDirectory(
    fileSystem,
    binding.path,
    code,
    identityProbe,
  );
  if (!sameIdentity(observed.identity, binding.identity)) fail(code);
  return observed;
}

async function absentNoLink(fileSystem, file) {
  try {
    await fileSystem.lstat(file);
    fail("quarantine_activation_receipt_present");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (error?.code === "quarantine_activation_receipt_present") throw error;
      fail("quarantine_activation_receipt_inspection_failed");
    }
  }

  let parent = path.dirname(file);
  for (;;) {
    try {
      const stat = await fileSystem.lstat(parent);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        path.resolve(await fileSystem.realpath(parent)) !== path.resolve(parent)
      ) {
        fail("quarantine_activation_receipt_parent_link_forbidden");
      }
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const next = path.dirname(parent);
      if (next === parent) {
        fail("quarantine_activation_receipt_inspection_failed");
      }
      parent = next;
    }
  }
}

async function preflightOutput(
  fileSystem,
  root,
  output,
  fingerprint,
  identityProbe = null,
) {
  if (!contained(root, output)) fail("quarantine_output_outside_workspace");
  await inspectDirectory(
    fileSystem,
    root,
    "quarantine_output_path_invalid",
    identityProbe,
  );
  let current = root;
  for (const part of path
    .relative(root, output)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      await fileSystem.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return Object.freeze({
          path: path.join(output, fingerprint),
          identity: null,
        });
      }
      throw error;
    }
    await inspectDirectory(
      fileSystem,
      current,
      "quarantine_output_path_invalid",
      identityProbe,
    );
  }

  const directory = path.join(output, fingerprint);
  try {
    await fileSystem.lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({ path: directory, identity: null });
    }
    throw error;
  }
  return inspectDirectory(
    fileSystem,
    directory,
    "quarantine_output_path_invalid",
    identityProbe,
  );
}

async function ensureOutput(
  fileSystem,
  root,
  output,
  fingerprint,
  expectedBinding = null,
  identityProbe = null,
  guardAcquirer,
) {
  if (!contained(root, output)) fail("quarantine_output_outside_workspace");
  if (typeof guardAcquirer !== "function") {
    fail("quarantine_output_path_invalid");
  }
  const rootBinding = await inspectDirectory(
    fileSystem,
    root,
    "quarantine_output_path_invalid",
    identityProbe,
  );
  let parentBinding = rootBinding;
  let parentGuard = null;
  let current = root;
  try {
    parentGuard = await acquireBoundEvidenceDirectoryGuard({
      guardAcquirer,
      fileSystem,
      directoryBinding: parentBinding,
      identityProbe,
    });
    const relativeParts = path
      .relative(root, output)
      .split(path.sep)
      .filter(Boolean);
    const parts = [...relativeParts, fingerprint];
    for (const part of parts) {
      await assertEvidenceGuardBound(parentGuard);
      current = path.join(current, part);
      try {
        await fileSystem.mkdir(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      await assertEvidenceGuardBound(parentGuard);
      const childBinding = await inspectDirectory(
        fileSystem,
        current,
        "quarantine_output_path_invalid",
        identityProbe,
      );
      const childGuard = await acquireBoundEvidenceDirectoryGuard({
        guardAcquirer,
        fileSystem,
        directoryBinding: childBinding,
        identityProbe,
      });
      try {
        await assertEvidenceGuardBound(parentGuard);
        if ((await parentGuard.release()) !== true) {
          fail("quarantine_output_path_invalid");
        }
      } catch (error) {
        try {
          await childGuard.release();
        } catch {}
        throw error;
      }
      parentBinding = childBinding;
      parentGuard = childGuard;
    }

    if (
      expectedBinding?.identity &&
      !sameIdentity(parentBinding.identity, expectedBinding.identity)
    ) {
      fail("quarantine_output_path_invalid");
    }
    await assertEvidenceGuardBound(parentGuard);
    return {
      directoryBinding: parentBinding,
      guard: parentGuard,
    };
  } catch (error) {
    try {
      await parentGuard?.release?.();
    } catch {}
    throw error;
  }
}

async function assertSidecarsClear(fileSystem, file) {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      const stat = await fileSystem.lstat(`${file}${suffix}`);
      if (stat.isSymbolicLink() || suffix === "-shm" || stat.size > 0) {
        fail("quarantine_database_sidecar_present");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function inspectSourceSidecars(
  fileSystem,
  file,
  identityProbe = null,
) {
  const observed = {
    wal_present: false,
    wal_nonempty: false,
    shm_present: false,
    wal_file: null,
    shm_file: null,
  };
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${file}${suffix}`;
    let stat;
    try {
      stat = await fileSystem.lstat(sidecar, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail("quarantine_database_sidecar_present");
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      BigInt(stat.nlink || 0) !== 1n
    ) {
      fail("quarantine_database_sidecar_present");
    }
    const realPath = path.resolve(
      await fileSystem.realpath(sidecar).catch(() =>
        fail("quarantine_database_sidecar_present"),
      ),
    );
    if (realPath !== path.resolve(sidecar)) {
      fail("quarantine_database_sidecar_present");
    }
    const identity = await fileIdentity(
      fileSystem,
      realPath,
      stat,
      identityProbe,
    );
    if (suffix === "-wal") {
      const bytes = await fileSystem.readFile(realPath);
      await assertStableIdentity(
        fileSystem,
        realPath,
        { path: realPath, identity },
        "quarantine_database_sidecar_present",
        identityProbe,
      );
      observed.wal_present = true;
      observed.wal_nonempty = BigInt(stat.size || 0) > 0n;
      observed.wal_file = Object.freeze({
        path: realPath,
        identity,
        size: BigInt(stat.size || 0).toString(),
        sha256: hashBytes(bytes),
        bytes,
      });
    } else {
      observed.shm_present = true;
      observed.shm_file = Object.freeze({
        path: realPath,
        identity,
        size: BigInt(stat.size || 0).toString(),
      });
    }
  }
  return Object.freeze(observed);
}

function sameSourceSidecarCapture(left, right) {
  return (
    left?.wal_present === right?.wal_present &&
    left?.wal_nonempty === right?.wal_nonempty &&
    left?.shm_present === right?.shm_present &&
    (left?.wal_file === null) === (right?.wal_file === null) &&
    (left?.shm_file === null) === (right?.shm_file === null) &&
    (!left?.wal_file ||
      (sameIdentity(left.wal_file.identity, right.wal_file.identity) &&
        left.wal_file.size === right.wal_file.size &&
        left.wal_file.sha256 === right.wal_file.sha256)) &&
    (!left?.shm_file ||
      (sameIdentity(left.shm_file.identity, right.shm_file.identity) &&
        left.shm_file.size === right.shm_file.size))
  );
}

function assertObservedSourceSidecarsClear(observed) {
  if (observed?.shm_present === true || observed?.wal_nonempty === true) {
    fail("quarantine_database_sidecar_present");
  }
}

function sqliteInspectionBuffer(value) {
  const bytes = Buffer.from(value);
  const signature = Buffer.from("SQLite format 3\0", "binary");
  if (
    bytes.length < 100 ||
    !bytes.subarray(0, signature.length).equals(signature) ||
    ![1, 2].includes(bytes[18]) ||
    ![1, 2].includes(bytes[19])
  ) {
    fail("quarantine_backup_verification_invalid");
  }
  // A complete WAL-mode backup can retain WAL header bytes even though its
  // hash-bound artefact has no sidecars. Normalise only the private in-memory
  // inspection copy so SQLite never creates files beside immutable evidence.
  bytes[18] = 1;
  bytes[19] = 1;
  return bytes;
}

async function materialiseIsolatedSqliteSnapshot(
  fileSystem,
  databaseBytes,
  walBytes,
) {
  let directory = null;
  let db = null;
  try {
    directory = await fileSystem.mkdtemp(
      path.join(os.tmpdir(), "pulse-quarantine-snapshot-"),
    );
    const snapshotPath = path.join(directory, "snapshot.db");
    await fileSystem.writeFile(snapshotPath, databaseBytes, { flag: "wx" });
    if (walBytes?.length) {
      await fileSystem.writeFile(`${snapshotPath}-wal`, walBytes, {
        flag: "wx",
      });
    }
    db = new Database(snapshotPath, { fileMustExist: true, timeout: 1000 });
    const checkpoint = db.pragma("wal_checkpoint(TRUNCATE)");
    if (
      Array.isArray(checkpoint) &&
      checkpoint.some((row) => Number(row?.busy || 0) !== 0)
    ) {
      fail("quarantine_backup_verification_invalid");
    }
    const integrity = String(
      Object.values(db.prepare("PRAGMA integrity_check").get() || {})[0] ||
        "",
    ).toLowerCase();
    if (
      integrity !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail("quarantine_backup_verification_invalid");
    }
    db.close();
    db = null;
    return await fileSystem.readFile(snapshotPath);
  } catch (error) {
    if (error?.code === "quarantine_backup_verification_invalid") throw error;
    fail("quarantine_backup_verification_invalid");
  } finally {
    try {
      db?.close();
    } catch {
      // The isolated copy is discarded below.
    }
    if (directory) {
      await fileSystem.rm(directory, { recursive: true, force: true });
    }
  }
}

async function withIsolatedSnapshotDatabase(
  fileSystem,
  databaseBytes,
  identityProbe,
  callback,
) {
  let directory = null;
  let db = null;
  try {
    directory = await fileSystem.mkdtemp(
      path.join(os.tmpdir(), "pulse-quarantine-preflight-"),
    );
    const snapshotPath = path.join(directory, "snapshot.db");
    await fileSystem.writeFile(
      snapshotPath,
      sqliteInspectionBuffer(databaseBytes),
      { flag: "wx" },
    );
    const snapshotFile = await inspectExactDatabaseFile(
      snapshotPath,
      fileSystem,
    );
    db = new Database(snapshotPath, { fileMustExist: true, timeout: 1000 });
    return await callback({ db, snapshotPath, snapshotFile });
  } finally {
    try {
      db?.close();
    } catch {
      // The isolated copy is discarded below.
    }
    if (directory) {
      await fileSystem.rm(directory, { recursive: true, force: true });
    }
  }
}

function inspectSqliteFile(
  file,
  {
    excludeOperationRows = null,
    standbyJobId = null,
    databaseBytes = null,
  } = {},
) {
  let db;
  try {
    db = databaseBytes
      ? new Database(sqliteInspectionBuffer(databaseBytes))
      : new Database(file, { readonly: true, fileMustExist: true });
    const integrity = String(
      Object.values(db.prepare("PRAGMA integrity_check").get() || {})[0] || "",
    ).toLowerCase();
    if (
      integrity !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail("quarantine_backup_verification_invalid");
    }
    const structuralSnapshot = canonicalSqliteStructuralSnapshot(db);
    const transitionLeaseCount = tableExists(db, "runtime_leases")
      ? Number(
          db
            .prepare("SELECT COUNT(*) count FROM runtime_leases WHERE name=?")
            .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).count,
        )
      : 0;
    const standbyPreimage = Number.isInteger(standbyJobId)
      ? db.prepare("SELECT * FROM jobs WHERE id=?").get(standbyJobId)
      : null;
    if (Number.isInteger(standbyJobId) && !standbyPreimage) {
      fail("quarantine_backup_verification_invalid");
    }
    return {
      digest: canonicalSqliteSnapshotDigest(db),
      structural_digest: canonicalSqliteStructuralDigest(structuralSnapshot),
      operation_remainder_digest: excludeOperationRows
        ? canonicalSqliteSnapshotDigest(db, { excludeOperationRows })
        : null,
      standby_preimage: standbyPreimage
        ? Object.freeze({ ...standbyPreimage })
        : null,
      transition_lease_count: transitionLeaseCount,
    };
  } catch (error) {
    if (error?.code === "quarantine_backup_verification_invalid") throw error;
    fail("quarantine_backup_verification_invalid");
  } finally {
    try {
      db?.close();
    } catch {
      // The immutable inspection has already failed closed if it did not finish.
    }
  }
}

function assertBackupFreshness(evidence, referenceTime) {
  const referenceMs = new Date(referenceTime).getTime();
  const verifiedMs = Date.parse(evidence.verified_at);
  if (
    !Number.isFinite(referenceMs) ||
    !Number.isFinite(verifiedMs) ||
    verifiedMs > referenceMs ||
    referenceMs - verifiedMs > BACKUP_MAX_AGE_MS
  ) {
    fail("quarantine_backup_evidence_stale");
  }
}

async function inspectBackupStructure(
  request,
  fileSystem,
  identityProbe = null,
) {
  const evidenceFile = await inspectRegularFile(
    fileSystem,
    request.backup_evidence_path,
    "quarantine_backup_evidence_invalid",
    identityProbe,
  );
  const evidenceBytes = await fileSystem.readFile(request.backup_evidence_path);
  await assertStableIdentity(
    fileSystem,
    request.backup_evidence_path,
    evidenceFile,
    "quarantine_backup_evidence_invalid",
    identityProbe,
  );
  if (
    hashBytes(evidenceBytes) !== request.expected_backup_evidence_file_sha256
  ) {
    fail("quarantine_backup_evidence_file_sha256_mismatch");
  }

  let evidence;
  try {
    evidence = JSON.parse(evidenceBytes.toString("utf8"));
  } catch {
    fail("quarantine_backup_evidence_invalid");
  }
  if (!validateCanonicalCutoverBackupEvidenceV1(evidence).valid) {
    fail("quarantine_backup_evidence_contract_invalid");
  }

  const sourcePath = exactPath(
    evidence.source_database_path,
    "quarantine_backup_source_path_invalid",
  );
  const backupPath = exactPath(
    evidence.backup_path,
    "quarantine_backup_path_invalid",
  );
  const restorePath = exactPath(
    evidence.restore_path,
    "quarantine_restore_path_invalid",
  );
  const [sourceFile, backupFile, restoreFile] = await Promise.all([
    inspectRegularFile(
      fileSystem,
      sourcePath,
      "quarantine_backup_source_invalid",
      identityProbe,
    ),
    inspectRegularFile(
      fileSystem,
      backupPath,
      "quarantine_backup_file_invalid",
      identityProbe,
    ),
    inspectRegularFile(
      fileSystem,
      restorePath,
      "quarantine_restore_file_invalid",
      identityProbe,
    ),
  ]);
  const files = [evidenceFile, sourceFile, backupFile, restoreFile];
  if (
    sourceFile.path !== path.resolve(request.database_path) ||
    new Set(files.map((file) => file.identity.key)).size !== files.length
  ) {
    fail("quarantine_backup_realpath_invalid");
  }
  const sourceSidecars = await inspectSourceSidecars(
    fileSystem,
    sourcePath,
    identityProbe,
  );
  await Promise.all([
    assertSidecarsClear(fileSystem, backupPath),
    assertSidecarsClear(fileSystem, restorePath),
  ]);

  const [sourceBytes, backupBytes, restoreBytes] = await Promise.all([
    fileSystem.readFile(sourcePath),
    fileSystem.readFile(backupPath),
    fileSystem.readFile(restorePath),
  ]);
  const sourceSha256 = hashBytes(sourceBytes);
  const backupSha256 = hashBytes(backupBytes);
  const restoreSha256 = hashBytes(restoreBytes);
  await Promise.all([
    assertStableIdentity(
      fileSystem,
      sourcePath,
      sourceFile,
      "quarantine_backup_source_invalid",
      identityProbe,
    ),
    assertStableIdentity(
      fileSystem,
      backupPath,
      backupFile,
      "quarantine_backup_file_invalid",
      identityProbe,
    ),
    assertStableIdentity(
      fileSystem,
      restorePath,
      restoreFile,
      "quarantine_restore_file_invalid",
      identityProbe,
    ),
  ]);
  const stableSourceSidecars = await inspectSourceSidecars(
    fileSystem,
    sourcePath,
    identityProbe,
  );
  if (
    !sameSourceSidecarCapture(sourceSidecars, stableSourceSidecars) ||
    (await hashFile(fileSystem, sourcePath)) !== sourceSha256
  ) {
    fail("quarantine_database_sidecar_present");
  }
  if (
    backupSha256 !== text(evidence.backup_sha256).toLowerCase() ||
    restoreSha256 !== text(evidence.restore_sha256).toLowerCase() ||
    backupSha256 !== restoreSha256
  ) {
    fail("quarantine_backup_verification_invalid");
  }

  const operationExclusions = operationRowExclusions(
    request,
    operationFingerprint(request),
  );
  const sourceSnapshotBytes = sourceSidecars.wal_nonempty
    ? await materialiseIsolatedSqliteSnapshot(
        fileSystem,
        sourceBytes,
        sourceSidecars.wal_file.bytes,
      )
    : sourceBytes;
  const sourceInspection = inspectSqliteFile(null, {
    databaseBytes: sourceSnapshotBytes,
  });
  const backupInspection = inspectSqliteFile(backupPath, {
    excludeOperationRows: operationExclusions,
    standbyJobId: request.expected_standby_job_id,
    databaseBytes: backupBytes,
  });
  const restoreInspection = inspectSqliteFile(restorePath, {
    databaseBytes: restoreBytes,
  });
  if (
    backupInspection.transition_lease_count !== 0 ||
    restoreInspection.transition_lease_count !== 0
  ) {
    fail("quarantine_backup_transition_lease_present");
  }
  if (backupInspection.digest !== restoreInspection.digest) {
    fail("quarantine_backup_verification_invalid");
  }

  return Object.freeze({
    evidence,
    source_file: sourceFile,
    source_sha256: sourceSha256,
    source_logical_digest: sourceInspection.digest,
    source_transition_lease_count: sourceInspection.transition_lease_count,
    source_sidecars: sourceSidecars,
    source_snapshot_bytes: sourceSnapshotBytes,
    backup_logical_digest: backupInspection.digest,
    backup_structural_digest: backupInspection.structural_digest,
    backup_operation_remainder_digest:
      backupInspection.operation_remainder_digest,
    standby_preimage: backupInspection.standby_preimage,
  });
}

async function assertOpenedDatabaseIdentity(
  db,
  fileSystem,
  expectedSourceFile,
  identityProbe,
) {
  const main = db
    .prepare("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main");
  if (!main?.file) fail("quarantine_open_database_identity_mismatch");
  const opened = await inspectRegularFile(
    fileSystem,
    path.resolve(main.file),
    "quarantine_open_database_identity_mismatch",
    identityProbe,
  );
  if (
    opened.path !== expectedSourceFile.path ||
    !sameIdentity(opened.identity, expectedSourceFile.identity)
  ) {
    fail("quarantine_open_database_identity_mismatch");
  }
}

async function observeSourceSha256(fileSystem, sourceFile, identityProbe) {
  await assertStableIdentity(
    fileSystem,
    sourceFile.path,
    sourceFile,
    "quarantine_open_database_identity_mismatch",
    identityProbe,
  );
  const sha256 = await hashFile(fileSystem, sourceFile.path);
  await assertStableIdentity(
    fileSystem,
    sourceFile.path,
    sourceFile,
    "quarantine_open_database_identity_mismatch",
    identityProbe,
  );
  return sha256;
}

function assertExactTransitionLease(
  db,
  lease,
  fingerprint,
  planSha256,
  now,
  authorityContextSha256,
) {
  if (!tableExists(db, "runtime_leases")) {
    fail("quarantine_database_physical_state_mismatch");
  }
  const row = db
    .prepare("SELECT * FROM runtime_leases WHERE name=?")
    .get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  const validated = validateLiveRuntimeTransitionLeaseRow(row, {
    ownerId: lease?.owner_id,
    now,
    leaseMs: lease?.lease_ms,
    authorityContextSha256,
  });
  if (!validated) {
    fail("quarantine_database_physical_state_mismatch");
  }
  const { metadata } = validated;
  const handleParticipant = lease?.participant_identity;
  if (
    metadata?.transition_owner_schema_version !==
      "pulse-live-runtime-transition-owner-v2" ||
    metadata.authority_context_sha256 !== authorityContextSha256 ||
    metadata.admission_state !== "OPEN" ||
    !metadata.context ||
    Object.keys(metadata.context).length !== 2 ||
    metadata.context.operation_fingerprint !== fingerprint ||
    metadata.context.plan_sha256 !== planSha256 ||
    !Array.isArray(metadata.participants) ||
    metadata.participants.length !== 1 ||
    metadata.participants[0]?.role !== "owner" ||
    !handleParticipant ||
    !Object.isFrozen(handleParticipant) ||
    lease.authority_context_sha256 !== authorityContextSha256 ||
    typeof lease.assertCurrentAuthority !== "function" ||
    handleParticipant.role !== "owner" ||
    lease.participant_id !== handleParticipant.participant_id ||
    !sameLiveRuntimeTransitionParticipant(
      metadata.participants[0],
      handleParticipant,
    )
  ) {
    fail("quarantine_database_physical_state_mismatch");
  }
}

function assertCurrentLeaseAuthority(lease, authorityContextSha256) {
  if (
    !lease ||
    lease.authority_context_sha256 !== authorityContextSha256 ||
    typeof lease.assertCurrentAuthority !== "function"
  ) {
    fail("quarantine_lease_lost");
  }
  try {
    if (lease.assertCurrentAuthority() !== authorityContextSha256) {
      fail("quarantine_lease_lost");
    }
  } catch (error) {
    if (error?.code === "quarantine_lease_lost") throw error;
    fail("quarantine_lease_lost");
  }
}

async function assertBaselineDatabaseFence({
  db,
  fileSystem,
  backup,
  request,
  identityProbe,
}) {
  await assertOpenedDatabaseIdentity(
    db,
    fileSystem,
    backup.source_file,
    identityProbe,
  );
  const observedSha256 = await observeSourceSha256(
    fileSystem,
    backup.source_file,
    identityProbe,
  );
  if (
    observedSha256 !== request.expected_database_sha256 ||
    observedSha256 !==
      text(backup.evidence.source_database_sha256).toLowerCase()
  ) {
    fail("quarantine_database_physical_state_mismatch");
  }
  if (canonicalSqliteSnapshotDigest(db) !== backup.backup_logical_digest) {
    fail("quarantine_database_logical_state_mismatch");
  }
  return observedSha256;
}

async function assertLeasedDatabaseFence({
  db,
  fileSystem,
  backup,
  request,
  identityProbe,
  lease,
  fingerprint,
  planSha256,
  authorityContextSha256,
  now,
  expectedPhysicalSha256 = null,
}) {
  await assertOpenedDatabaseIdentity(
    db,
    fileSystem,
    backup.source_file,
    identityProbe,
  );
  const observedSha256 = await observeSourceSha256(
    fileSystem,
    backup.source_file,
    identityProbe,
  );
  if (expectedPhysicalSha256 && observedSha256 !== expectedPhysicalSha256) {
    fail("quarantine_database_physical_state_mismatch");
  }
  if (canonicalSqliteSnapshotDigest(db) !== backup.backup_logical_digest) {
    fail("quarantine_database_logical_state_mismatch");
  }
  assertExactTransitionLease(
    db,
    lease,
    fingerprint,
    planSha256,
    now,
    authorityContextSha256,
  );
  return observedSha256;
}

function sameSqliteValue(left, right) {
  if (Buffer.isBuffer(left) || Buffer.isBuffer(right)) {
    return (
      Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right)
    );
  }
  return Object.is(left, right);
}

function exactSqliteRow(left, right) {
  if (!left || !right) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameSqliteValue(left[key], right[key]),
    )
  );
}

function assertExactStandbyPostimage(preimage, postimage, appliedAt, reason) {
  if (!preimage || !postimage) {
    fail("quarantine_database_logical_state_mismatch");
  }
  const authorised = {
    status: "cancelled",
    completed_at: appliedAt,
    updated_at: appliedAt,
    last_error: reason,
  };
  const expected = { ...preimage, ...authorised };
  if (!exactSqliteRow(postimage, expected)) {
    fail("quarantine_database_logical_state_mismatch");
  }
}

function assertExactAppliedRows({
  db,
  request,
  standby,
  standbyPreimage,
  appliedAt,
  reason,
  evidence,
  auditId,
  fingerprint,
}) {
  const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(standby.job_id);
  assertExactStandbyPostimage(standbyPreimage, row, appliedAt, reason);
  if (
    !row ||
    row.kind !== standby.kind ||
    row.channel_id !== "pulse-gaming" ||
    row.story_id !== standby.database_story_id ||
    row.idempotency_key !== standby.idempotency_key ||
    row.status !== "cancelled" ||
    Number(row.attempt_count) !== 0 ||
    Number(row.max_attempts) !== 3 ||
    row.claimed_by ||
    row.claimed_at ||
    row.lease_until ||
    row.completed_at !== appliedAt ||
    row.updated_at !== appliedAt ||
    row.last_error !== reason
  ) {
    fail("quarantine_database_logical_state_mismatch");
  }
  const audit = db
    .prepare("SELECT * FROM operator_audit_log WHERE id=?")
    .get(auditId);
  if (
    !audit ||
    audit.actor_id !== request.operator_id ||
    audit.action !== ACTION ||
    audit.target_type !== "governed_exact_plan" ||
    audit.target_id !== evidence.plan_sha256 ||
    audit.decision !== "QUARANTINED" ||
    audit.reason !== reason ||
    audit.evidence_json !== JSON.stringify(evidence) ||
    audit.created_at !== appliedAt ||
    audit.idempotency_key !== auditKey(fingerprint)
  ) {
    fail("quarantine_database_logical_state_mismatch");
  }
  if (tableExists(db, "sqlite_sequence")) {
    const sequence = db
      .prepare(
        "SELECT seq FROM sqlite_sequence WHERE name='operator_audit_log'",
      )
      .get();
    if (sequence && Number(sequence.seq) !== Number(auditId)) {
      fail("quarantine_database_logical_state_mismatch");
    }
  }
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

function exactLiveDatabaseIdentity(value, databasePath) {
  const expectedPath = path.resolve(databasePath).toLowerCase();
  const observedPath = path.resolve(
    String(value?.canonical_real_path || ""),
  ).toLowerCase();
  if (
    observedPath !== expectedPath ||
    !/^[0-9]+$/.test(String(value?.device_id || "")) ||
    !/^[0-9]+$/.test(String(value?.file_id || "")) ||
    !SHA256_PATTERN.test(String(value?.database_identity_sha256 || ""))
  ) {
    fail("quarantine_open_database_identity_mismatch");
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
  const report = normaliseQuiescence(value, profile);
  const requiredTaskNames = [
    profile?.task_name,
    ...(Array.isArray(profile?.conflicting_task_names)
      ? profile.conflicting_task_names
      : []),
  ]
    .filter((identity) => typeof identity === "string" && identity.trim())
    .map((identity) => identity.trim().replace(/^\\/, "").toLowerCase());
  const absentTaskNames = new Set(
    report.absent_task_names.map((identity) =>
      identity.replace(/^\\/, "").toLowerCase(),
    ),
  );
  if (
    !report.available ||
    report.schema !== BOUNDED_AUTHORITY_SCHEMA ||
    report.verdict !== "GREEN" ||
    report.state !== "STOPPED_BOUND" ||
    report.runtime_instance_id !== null ||
    !SHA256_PATTERN.test(String(report.authority_fingerprint || "")) ||
    !SHA256_PATTERN.test(String(report.observation_sha256 || "")) ||
    !SHA256_PATTERN.test(String(report.database_snapshot_sha256 || "")) ||
    !SHA256_PATTERN.test(String(databaseIdentitySha256 || "")) ||
    !Array.isArray(report.blockers) ||
    report.blockers.length !== 0 ||
    ["listeners", "processes", "scheduled_tasks"].some(
      (key) => report.probe_attestations[key] !== true,
    ) ||
    [
      "owner_pids",
      "listener_pids",
      "scheduler_process_pids",
      "enabled_tasks",
      "running_tasks",
    ].some((key) => report[key].length) ||
    report.diagnostics !== null ||
    requiredTaskNames.some((identity) => !absentTaskNames.has(identity))
  ) {
    fail("quarantine_runtime_not_quiescent");
  }
  const context = boundedAuthorityContext(report, databaseIdentitySha256);
  if (expectedContext && !sameBoundedAuthorityContext(context, expectedContext)) {
    fail("quarantine_runtime_authority_context_drift");
  }
  return Object.freeze({ report, context });
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

function assertNoPublication(db, jobs) {
  const ids = [
    ...new Set(jobs.flatMap((job) => [job.story_id, job.database_story_id])),
  ];
  const placeholders = ids.map(() => "?").join(",");
  for (const name of [
    "platform_dispatch_ledger",
    "platform_publication_state",
    "publication_lifecycle_events",
    "platform_posts",
    "publication_authority_audit_log",
  ]) {
    if (!tableExists(db, name)) {
      fail(`quarantine_required_table_missing:${name}`);
    }
    const count = db
      .prepare(
        `SELECT COUNT(*) count FROM ${name} WHERE story_id IN (${placeholders})`,
      )
      .get(...ids).count;
    if (Number(count)) fail("quarantine_publication_state_present");
  }

  const completions = db
    .prepare(
      `SELECT COUNT(*) count
         FROM operator_audit_log
        WHERE action = 'governed_autonomous_candidate_materialised'
          AND target_type = 'governed_autonomous_candidate'
          AND decision = 'RECORDED_GREEN'
          AND target_id IN (${placeholders})`,
    )
    .get(...ids).count;
  if (Number(completions)) fail("quarantine_completion_index_present");
}

function auditKey(fingerprint) {
  return `governed-exact-plan-quarantine:v1:${fingerprint}`;
}

function operationRowExclusions(request, fingerprint) {
  return {
    standby_job_id: request.expected_standby_job_id,
    audit_idempotency_key: auditKey(fingerprint),
    operator_audit_sequence: true,
  };
}

function auditEvidence(request, binding, fingerprint, authorityContext) {
  return {
    schema_version: QUARANTINE_EVIDENCE_SCHEMA_VERSION,
    operation_fingerprint: fingerprint,
    plan_sha256: binding.plan.plan_sha256,
    plan_file_sha256: request.expected_plan_file_sha256,
    reservation_file_sha256: request.expected_reservation_file_sha256,
    reservation_set_sha256: request.expected_reservation_set_sha256,
    database_sha256: request.expected_database_sha256,
    runtime_authority: authorityContext,
    backup_evidence_file_sha256: request.expected_backup_evidence_file_sha256,
    plan_checkout_commit: request.expected_checkout_commit,
    executor_checkout_commit: request.expected_executor_checkout_commit,
    change_id: request.change_id,
    primary_job_id: request.expected_primary_job_id,
    standby_job_id: request.expected_standby_job_id,
    disposition: "QUARANTINED",
    completion_receipt_created: false,
    publication_authority_created: false,
  };
}

function bindingRequest(request, standbyStatus, cancellationReason = null) {
  return {
    generated_at: request.generated_at,
    plan_path: request.plan_path,
    expected_plan_file_sha256: request.expected_plan_file_sha256,
    expected_plan_sha256: request.expected_plan_sha256,
    workspace_root: request.workspace_root,
    database_path: request.database_path,
    runtime_profile_path: request.runtime_profile_path,
    expected_runtime_profile_file_sha256:
      request.expected_runtime_profile_file_sha256,
    expected_checkout_commit: request.expected_checkout_commit,
    expected_reservation_file_sha256: request.expected_reservation_file_sha256,
    expected_reservation_set_sha256: request.expected_reservation_set_sha256,
    expected_primary_job_id: request.expected_primary_job_id,
    expected_standby_job_id: request.expected_standby_job_id,
    expected_standby_status: standbyStatus,
    expected_standby_cancellation_reason: cancellationReason,
  };
}

const WINDOWS_EVIDENCE_GUARD_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  "using System;",
  "using System.ComponentModel;",
  "using System.Globalization;",
  "using System.Runtime.InteropServices;",
  "using Microsoft.Win32.SafeHandles;",
  "public static class PulseEvidenceGuardNative {",
  "  private const uint FILE_SHARE_READ = 0x00000001u;",
  "  private const uint FILE_SHARE_WRITE = 0x00000002u;",
  "  private const uint OPEN_EXISTING = 3u;",
  "  private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010u;",
  "  private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400u;",
  "  private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000u;",
  "  private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000u;",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  public struct FILETIME {",
  "    public uint dwLowDateTime;",
  "    public uint dwHighDateTime;",
  "  }",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  public struct BY_HANDLE_FILE_INFORMATION {",
  "    public uint dwFileAttributes;",
  "    public FILETIME ftCreationTime;",
  "    public FILETIME ftLastAccessTime;",
  "    public FILETIME ftLastWriteTime;",
  "    public uint dwVolumeSerialNumber;",
  "    public uint nFileSizeHigh;",
  "    public uint nFileSizeLow;",
  "    public uint nNumberOfLinks;",
  "    public uint nFileIndexHigh;",
  "    public uint nFileIndexLow;",
  "  }",
  "  [DllImport(\"kernel32.dll\", CharSet = CharSet.Unicode, SetLastError = true)]",
  "  private static extern SafeFileHandle CreateFileW(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);",
  "  [DllImport(\"kernel32.dll\", SetLastError = true)]",
  "  private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION information);",
  "  public static SafeFileHandle OpenDirectory(string directoryPath) {",
  "    SafeFileHandle handle = CreateFileW(directoryPath, 0u, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);",
  "    if (handle.IsInvalid) {",
  "      int error = Marshal.GetLastWin32Error();",
  "      handle.Dispose();",
  "      throw new Win32Exception(error);",
  "    }",
  "    return handle;",
  "  }",
  "  public static string Identity(SafeFileHandle handle, bool requireDirectory) {",
  "    BY_HANDLE_FILE_INFORMATION information;",
  "    if (handle == null || handle.IsInvalid || handle.IsClosed || !GetFileInformationByHandle(handle, out information)) {",
  "      throw new Win32Exception(Marshal.GetLastWin32Error());",
  "    }",
  "    if ((information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0u) {",
  "      throw new InvalidOperationException(\"reparse-point\");",
  "    }",
  "    if (requireDirectory && (information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0u) {",
  "      throw new InvalidOperationException(\"not-directory\");",
  "    }",
  "    ulong fileIndex = ((ulong)information.nFileIndexHigh << 32) | information.nFileIndexLow;",
  "    if (information.dwVolumeSerialNumber == 0u || fileIndex == 0ul) {",
  "      throw new InvalidOperationException(\"identity-unavailable\");",
  "    }",
  "    return String.Format(CultureInfo.InvariantCulture, \"{0:x8}:{1:x16}\", information.dwVolumeSerialNumber, fileIndex);",
  "  }",
  "}",
  "'@",
  "$directoryPath = [Environment]::GetEnvironmentVariable('PULSE_EVIDENCE_GUARD_DIRECTORY')",
  "$guardPath = [Environment]::GetEnvironmentVariable('PULSE_EVIDENCE_GUARD_PATH')",
  "$guardBytes = [Convert]::FromBase64String([Environment]::GetEnvironmentVariable('PULSE_EVIDENCE_GUARD_BYTES'))",
  "$directoryHandle = [PulseEvidenceGuardNative]::OpenDirectory($directoryPath)",
  "$stream = $null",
  "try {",
  "  $directoryIdentity = [PulseEvidenceGuardNative]::Identity($directoryHandle, $true)",
  "  $options = [IO.FileOptions]::WriteThrough -bor [IO.FileOptions]::DeleteOnClose",
  "  $stream = [IO.FileStream]::new($guardPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read, 4096, $options)",
  "  $stream.Write($guardBytes, 0, $guardBytes.Length)",
  "  $stream.Flush($true)",
  "  $markerIdentity = [PulseEvidenceGuardNative]::Identity($stream.SafeFileHandle, $false)",
  "  [Console]::Out.WriteLine(('READY|{0}|{1}' -f $directoryIdentity, $markerIdentity))",
  "  [Console]::Out.Flush()",
  "  $command = [Console]::In.ReadLine()",
  "  if ($command -ne 'RELEASE') { exit 23 }",
  "} finally {",
  "  if ($null -ne $stream) { $stream.Dispose() }",
  "  $directoryHandle.Dispose()",
  "}",
].join("\n");

function windowsHandleIdentityKey(value) {
  const match = /^([0-9a-f]{8}):([0-9a-f]{16})$/i.exec(String(value));
  if (!match) throw new Error("guard_identity_invalid");
  const device = BigInt(`0x${match[1]}`);
  const inode = BigInt(`0x${match[2]}`);
  if (device === 0n || inode === 0n) {
    throw new Error("guard_identity_invalid");
  }
  return `${device.toString()}:${inode.toString()}`;
}

function waitForGuardReady(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error, ready = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(ready);
    };
    const onData = (chunk) => {
      output += String(chunk);
      if (output.length > 1_024) return finish(new Error("guard_output_invalid"));
      if (!output.includes("\n")) return;
      const match =
        /^READY\|([0-9a-f]{8}:[0-9a-f]{16})\|([0-9a-f]{8}:[0-9a-f]{16})\r?\n$/i.exec(
          output,
        );
      if (!match) return finish(new Error("guard_output_invalid"));
      try {
        finish(null, {
          directoryIdentityKey: windowsHandleIdentityKey(match[1]),
          markerIdentityKey: windowsHandleIdentityKey(match[2]),
        });
      } catch (error) {
        finish(error);
      }
    };
    const onError = () => finish(new Error("guard_start_failed"));
    const onExit = () => finish(new Error("guard_exited_before_ready"));
    const timer = setTimeout(
      () => finish(new Error("guard_ready_timeout")),
      timeoutMs,
    );
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForGuardExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(code);
    };
    const onError = () => finish(new Error("guard_release_failed"));
    const onExit = (code) => finish(null, code);
    const timer = setTimeout(
      () => finish(new Error("guard_release_timeout")),
      timeoutMs,
    );
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function terminateGuardChild(child) {
  if (!child) return;
  try {
    child.stdin?.destroy();
  } catch {}
  try {
    if (child.exitCode === null) child.kill();
  } catch {}
  try {
    await waitForGuardExit(child);
  } catch {}
}

async function markerBinding(
  fileSystem,
  markerPath,
  expectedBytes,
  identityProbe,
) {
  const marker = await inspectRegularFile(
    fileSystem,
    markerPath,
    "quarantine_output_path_invalid",
    identityProbe,
  );
  const bytes = await fileSystem.readFile(markerPath);
  await assertStableIdentity(
    fileSystem,
    markerPath,
    marker,
    "quarantine_output_path_invalid",
    identityProbe,
  );
  if (!Buffer.from(bytes).equals(expectedBytes)) {
    fail("quarantine_output_path_invalid");
  }
  return marker;
}

async function markerHandleBinding(fileSystem, markerPath, expectedBytes) {
  let handle;
  try {
    handle = await fileSystem.open(markerPath, "r");
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || BigInt(stat.nlink || 0) !== 1n) {
      fail("quarantine_output_path_invalid");
    }
    const device = BigInt(stat.dev || 0);
    const inode = BigInt(stat.ino || 0);
    if (device === 0n || inode === 0n) {
      fail("quarantine_output_path_invalid");
    }
    const bytes = await handle.readFile();
    if (!Buffer.from(bytes).equals(expectedBytes)) {
      fail("quarantine_output_path_invalid");
    }
    return Object.freeze({
      source: "node-stat",
      key: `${device.toString()}:${inode.toString()}`,
    });
  } catch (error) {
    if (error?.code === "quarantine_output_path_invalid") throw error;
    fail("quarantine_output_path_invalid");
  } finally {
    try {
      await handle?.close();
    } catch {}
  }
}

async function acquireEvidenceDirectoryGuard({
  fileSystem,
  directoryBinding,
  identityProbe = null,
  platform = process.platform,
  afterReady = null,
}) {
  if (platform !== "win32") {
    fail("quarantine_evidence_platform_unsupported");
  }
  await assertDirectoryBinding(
    fileSystem,
    directoryBinding,
    "quarantine_output_path_invalid",
    identityProbe,
  );
  const nonce = crypto.randomBytes(32).toString("hex");
  const markerPath = path.join(
    directoryBinding.path,
    `.quarantine-evidence-${nonce}.guard`,
  );
  const markerBytes = Buffer.from(`${nonce}\n`);
  let child = null;
  let childStdinError = null;
  let released = false;
  try {
    const powershell = path.join(
      process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    child = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(WINDOWS_EVIDENCE_GUARD_SCRIPT, "utf16le").toString(
          "base64",
        ),
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          SystemRoot: process.env.SystemRoot || "C:\\Windows",
          WINDIR: process.env.WINDIR || process.env.SystemRoot || "C:\\Windows",
          PULSE_EVIDENCE_GUARD_DIRECTORY: directoryBinding.path,
          PULSE_EVIDENCE_GUARD_PATH: markerPath,
          PULSE_EVIDENCE_GUARD_BYTES: markerBytes.toString("base64"),
        },
      },
    );
    child.stdin?.on("error", () => {
      childStdinError ||= new Error("guard_release_failed");
    });
    const heldIdentity = await waitForGuardReady(child);
    if (typeof afterReady === "function") {
      await afterReady({ directoryBinding, markerPath });
    }
    if (
      directoryBinding.identity?.source !== "node-stat" ||
      directoryBinding.identity.key !== heldIdentity.directoryIdentityKey
    ) {
      fail("quarantine_output_path_invalid");
    }
    const handleMarkerIdentity = await markerHandleBinding(
      fileSystem,
      markerPath,
      markerBytes,
    );
    if (handleMarkerIdentity.key !== heldIdentity.markerIdentityKey) {
      fail("quarantine_output_path_invalid");
    }
    const exactMarker = await markerBinding(
      fileSystem,
      markerPath,
      markerBytes,
      identityProbe,
    );
    if (exactMarker.identity.key !== heldIdentity.markerIdentityKey) {
      fail("quarantine_output_path_invalid");
    }
    await assertDirectoryBinding(
      fileSystem,
      directoryBinding,
      "quarantine_output_path_invalid",
      identityProbe,
    );

    return {
      mode: "WINDOWS_FILESHARE_DELETE_DENIED",
      directory_binding: directoryBinding,
      async assertBound() {
        if (released || (child && child.exitCode !== null)) {
          fail("quarantine_output_path_invalid");
        }
        await assertDirectoryBinding(
          fileSystem,
          directoryBinding,
          "quarantine_output_path_invalid",
          identityProbe,
        );
        const observed = await markerBinding(
          fileSystem,
          markerPath,
          markerBytes,
          identityProbe,
        );
        if (!sameIdentity(observed.identity, exactMarker.identity)) {
          fail("quarantine_output_path_invalid");
        }
        if (observed.identity.key !== heldIdentity.markerIdentityKey) {
          fail("quarantine_output_path_invalid");
        }
        await assertDirectoryBinding(
          fileSystem,
          directoryBinding,
          "quarantine_output_path_invalid",
          identityProbe,
        );
        return true;
      },
      async release() {
        if (released) return true;
        released = true;
        if (!child || child.exitCode !== null || !child.stdin) {
          throw new Error("guard_release_failed");
        }
        let code;
        try {
          child.stdin.end("RELEASE\n");
          code = await waitForGuardExit(child);
          await new Promise((resolve) => setImmediate(resolve));
        } catch (error) {
          await terminateGuardChild(child);
          throw error;
        }
        if (childStdinError || code !== 0) {
          throw new Error("guard_release_failed");
        }
        try {
          await fileSystem.lstat(markerPath);
          fail("quarantine_output_path_invalid");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        return true;
      },
    };
  } catch (error) {
    await terminateGuardChild(child);
    throw error;
  }
}

async function assertEvidenceGuardBound(guard) {
  if (!guard || typeof guard.assertBound !== "function") {
    fail("quarantine_output_path_invalid");
  }
  if ((await guard.assertBound()) !== true) {
    fail("quarantine_output_path_invalid");
  }
}

function bindEvidenceDirectoryGuard({
  guard,
  fileSystem,
  directoryBinding,
  identityProbe = null,
}) {
  if (
    !guard ||
    typeof guard.assertBound !== "function" ||
    typeof guard.release !== "function"
  ) {
    fail("quarantine_output_path_invalid");
  }
  let released = false;
  return {
    mode: guard.mode || "INJECTED_IDENTITY_BOUND",
    directory_binding: directoryBinding,
    async assertBound() {
      if (released) fail("quarantine_output_path_invalid");
      await assertDirectoryBinding(
        fileSystem,
        directoryBinding,
        "quarantine_output_path_invalid",
        identityProbe,
      );
      if ((await guard.assertBound()) !== true) {
        fail("quarantine_output_path_invalid");
      }
      await assertDirectoryBinding(
        fileSystem,
        directoryBinding,
        "quarantine_output_path_invalid",
        identityProbe,
      );
      return true;
    },
    async release() {
      if (released) return true;
      released = true;
      return (await guard.release()) === true;
    },
  };
}

async function acquireBoundEvidenceDirectoryGuard({
  guardAcquirer,
  fileSystem,
  directoryBinding,
  identityProbe = null,
}) {
  let acquired = null;
  let bound = null;
  try {
    acquired = await guardAcquirer({
      fileSystem,
      directoryBinding,
      identityProbe,
    });
    bound = bindEvidenceDirectoryGuard({
      guard: acquired,
      fileSystem,
      directoryBinding,
      identityProbe,
    });
    await assertEvidenceGuardBound(bound);
    return bound;
  } catch (error) {
    try {
      await (bound || acquired)?.release?.();
    } catch {}
    throw error;
  }
}

async function syncFile(fileSystem, file, identityProbe, guard) {
  const directory = path.dirname(file);
  await assertEvidenceGuardBound(guard);
  const before = await inspectRegularFile(
    fileSystem,
    file,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  let handle;
  try {
    handle = await fileSystem.open(file, "r+");
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await assertEvidenceGuardBound(guard);
  await assertStableIdentity(
    fileSystem,
    file,
    before,
    "quarantine_evidence_conflict",
    identityProbe,
  );
}

async function syncDirectory(fileSystem, directory, guard) {
  let handle;
  try {
    await assertEvidenceGuardBound(guard);
    handle = await fileSystem.open(directory, "r");
    await handle.sync();
    await assertEvidenceGuardBound(guard);
    return "SYNCED";
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      return "UNSUPPORTED_WINDOWS_EPERM";
    }
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch {
      // The sync result remains authoritative; close failure is handled by write.
    }
  }
}

async function writeNoClobber(
  fileSystem,
  file,
  bytes,
  identityProbe = null,
  guard,
  {
    beforeLink = null,
    afterLink = null,
    directoryBinding = null,
  } = {},
) {
  const directory = path.dirname(file);
  const assertDirectory = () => assertEvidenceGuardBound(guard);
  await assertDirectory();
  const temporary = `${file}.${hashBytes(bytes)}.tmp`;
  let targetExists = true;
  try {
    await fileSystem.lstat(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    targetExists = false;
  }
  if (targetExists) {
    await assertDirectory();
    const linkedTarget = await inspectLinkedRegularFile(
      fileSystem,
      file,
      "quarantine_evidence_conflict",
      identityProbe,
    );
    if (linkedTarget.nlink === 2n) {
      let temporaryExists = true;
      try {
        await fileSystem.lstat(temporary);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        temporaryExists = false;
      }
      if (temporaryExists) {
        const linkedTemporary = await inspectLinkedRegularFile(
          fileSystem,
          temporary,
          "quarantine_evidence_conflict",
          identityProbe,
        );
        const [targetBytes, temporaryBytes] = await Promise.all([
          fileSystem.readFile(file),
          fileSystem.readFile(temporary),
        ]);
        if (
          linkedTemporary.nlink !== 2n ||
          !sameIdentity(linkedTarget.identity, linkedTemporary.identity) ||
          !Buffer.from(targetBytes).equals(bytes) ||
          !Buffer.from(temporaryBytes).equals(bytes)
        ) {
          fail("quarantine_evidence_conflict");
        }
        await fileSystem.unlink(temporary);
        await assertDirectory();
        const recovered = await inspectRegularFile(
          fileSystem,
          file,
          "quarantine_evidence_conflict",
          identityProbe,
        );
        if (!sameIdentity(recovered.identity, linkedTarget.identity)) {
          fail("quarantine_evidence_conflict");
        }
        await syncFile(fileSystem, file, identityProbe, guard);
        return "RECOVERED";
      }
    }
    const existing = await inspectRegularFile(
      fileSystem,
      file,
      "quarantine_evidence_conflict",
      identityProbe,
    );
    const prior = await fileSystem.readFile(file);
    await assertStableIdentity(
      fileSystem,
      file,
      existing,
      "quarantine_evidence_conflict",
      identityProbe,
    );
    if (!Buffer.from(prior).equals(bytes)) fail("quarantine_evidence_conflict");
    await syncFile(fileSystem, file, identityProbe, guard);
    return "REPLAYED";
  }

  try {
    let handle;
    try {
      await assertDirectory();
      handle = await fileSystem.open(temporary, "wx+", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existingTemporary = await inspectRegularFile(
        fileSystem,
        temporary,
        "quarantine_evidence_conflict",
        identityProbe,
      );
      const prior = await fileSystem.readFile(temporary);
      await assertStableIdentity(
        fileSystem,
        temporary,
        existingTemporary,
        "quarantine_evidence_conflict",
        identityProbe,
      );
      if (!Buffer.from(prior).equals(bytes))
        fail("quarantine_evidence_conflict");
      await syncFile(fileSystem, temporary, identityProbe, guard);
    } finally {
      await handle?.close();
    }

    await assertDirectory();
    const temporaryBinding = await inspectRegularFile(
      fileSystem,
      temporary,
      "quarantine_evidence_conflict",
      identityProbe,
    );
    let linkAttempted = false;
    let linkInstalled = false;
    try {
      await assertDirectory();
      if (typeof beforeLink === "function") {
        await beforeLink({
          target_path: file,
          temporary_path: temporary,
          temporary_binding: temporaryBinding,
        });
      }
      linkAttempted = true;
      await fileSystem.link(temporary, file);
      linkInstalled = true;
      if (typeof afterLink === "function") {
        await afterLink({
          target_path: file,
          temporary_path: temporary,
          temporary_binding: temporaryBinding,
        });
      }
      await assertDirectory();
    } catch (error) {
      if (linkInstalled) {
        await revokeExactInstalledFile({
          fileSystem,
          file,
          bytes,
          expectedIdentity: temporaryBinding.identity,
          identityProbe,
          guard,
          directoryBinding,
        });
        throw error;
      }
      if (error?.code !== "EEXIST") {
        if (linkAttempted) {
          await revokeExactInstalledFile({
            fileSystem,
            file,
            bytes,
            expectedIdentity: temporaryBinding.identity,
            identityProbe,
            guard,
            directoryBinding,
          });
        }
        throw error;
      }
      const racedTarget = await inspectLinkedRegularFile(
        fileSystem,
        file,
        "quarantine_evidence_conflict",
        identityProbe,
      );
      if (sameIdentity(racedTarget.identity, temporaryBinding.identity)) {
        await revokeExactInstalledFile({
          fileSystem,
          file,
          bytes,
          expectedIdentity: temporaryBinding.identity,
          identityProbe,
          guard,
          directoryBinding,
        });
        throw error;
      }
      const existing = await inspectRegularFile(
        fileSystem,
        file,
        "quarantine_evidence_conflict",
        identityProbe,
      );
      const prior = await fileSystem.readFile(file);
      await assertStableIdentity(
        fileSystem,
        file,
        existing,
        "quarantine_evidence_conflict",
        identityProbe,
      );
      if (!Buffer.from(prior).equals(bytes))
        fail("quarantine_evidence_conflict");
    }
  } finally {
    try {
      await assertDirectory();
      await fileSystem.unlink(temporary);
      await assertDirectory();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const installed = await inspectRegularFile(
    fileSystem,
    file,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  const installedBytes = await fileSystem.readFile(file);
  await assertStableIdentity(
    fileSystem,
    file,
    installed,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  if (!Buffer.from(installedBytes).equals(bytes)) {
    fail("quarantine_evidence_conflict");
  }
  await assertDirectory();
  await syncFile(fileSystem, file, identityProbe, guard);
  await assertDirectory();
  return "CREATED";
}

async function exactEvidenceFileBinding(
  fileSystem,
  file,
  bytes,
  identityProbe,
  guard,
) {
  await assertEvidenceGuardBound(guard);
  const binding = await inspectRegularFile(
    fileSystem,
    file,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  const observedBytes = await fileSystem.readFile(file);
  await assertStableIdentity(
    fileSystem,
    file,
    binding,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  if (!Buffer.from(observedBytes).equals(bytes)) {
    fail("quarantine_evidence_conflict");
  }
  await assertEvidenceGuardBound(guard);
  return binding;
}

async function assertExactEvidenceFileBinding(
  fileSystem,
  file,
  bytes,
  expected,
  identityProbe,
  guard,
) {
  const observed = await exactEvidenceFileBinding(
    fileSystem,
    file,
    bytes,
    identityProbe,
    guard,
  );
  if (!sameIdentity(observed.identity, expected.identity)) {
    fail("quarantine_evidence_conflict");
  }
  return observed;
}

async function revokeExactInstalledFile({
  fileSystem,
  file,
  bytes,
  expectedIdentity,
  identityProbe,
  guard,
  directoryBinding,
}) {
  try {
    await fileSystem.lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return "ABSENT";
    fail("quarantine_evidence_conflict");
  }
  if (!directoryBinding) fail("quarantine_evidence_conflict");
  await assertEvidenceGuardBound(guard);
  await assertDirectoryBinding(
    fileSystem,
    directoryBinding,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  const before = await inspectLinkedRegularFile(
    fileSystem,
    file,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  if (!sameIdentity(before.identity, expectedIdentity)) {
    fail("quarantine_evidence_conflict");
  }
  const observedBytes = await fileSystem.readFile(file);
  const stable = await inspectLinkedRegularFile(
    fileSystem,
    file,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  if (
    !sameIdentity(stable.identity, before.identity) ||
    !Buffer.from(observedBytes).equals(bytes)
  ) {
    fail("quarantine_evidence_conflict");
  }
  await assertDirectoryBinding(
    fileSystem,
    directoryBinding,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  await assertEvidenceGuardBound(guard);
  await fileSystem.unlink(file);
  await assertDirectoryBinding(
    fileSystem,
    directoryBinding,
    "quarantine_evidence_conflict",
    identityProbe,
  );
  try {
    await fileSystem.lstat(file);
    fail("quarantine_evidence_conflict");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await syncDirectory(fileSystem, directoryBinding.path, guard);
  return "REVOKED";
}

function renderMarkdown(result) {
  return [
    "# Governed Exact Plan Quarantine",
    "",
    "Verdict: QUARANTINED",
    "",
    `- Primary job ${result.primary_job_id} remains failed.`,
    `- Standby job ${result.standby_job_id} is quarantined.`,
    "- No completion receipt or publication authority was created.",
    "",
  ].join("\n");
}

async function writeEvidence(
  fileSystem,
  directoryBinding,
  body,
  identityProbe = null,
  guard,
  assertRuntimeFence = async () => true,
) {
  const directory = directoryBinding.path;
  const json = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
  const markdown = Buffer.from(renderMarkdown(body));
  const jsonPath = path.join(directory, "quarantine.json");
  const markdownPath = path.join(directory, "quarantine.md");
  const commitPath = path.join(directory, "quarantine.commit.json");

  await assertRuntimeFence();
  await assertEvidenceGuardBound(guard);
  const jsonStatus = await writeNoClobber(
    fileSystem,
    jsonPath,
    json,
    identityProbe,
    guard,
  );
  await assertRuntimeFence();
  const markdownStatus = await writeNoClobber(
    fileSystem,
    markdownPath,
    markdown,
    identityProbe,
    guard,
  );
  await assertRuntimeFence();
  await assertEvidenceGuardBound(guard);
  const bodyDirectoryFsyncStatus = await syncDirectory(
    fileSystem,
    directory,
    guard,
  );
  const jsonBinding = await exactEvidenceFileBinding(
    fileSystem,
    jsonPath,
    json,
    identityProbe,
    guard,
  );
  const markdownBinding = await exactEvidenceFileBinding(
    fileSystem,
    markdownPath,
    markdown,
    identityProbe,
    guard,
  );
  const assertComponentBindings = async () => {
    await assertEvidenceGuardBound(guard);
    await assertExactEvidenceFileBinding(
      fileSystem,
      jsonPath,
      json,
      jsonBinding,
      identityProbe,
      guard,
    );
    await assertExactEvidenceFileBinding(
      fileSystem,
      markdownPath,
      markdown,
      markdownBinding,
      identityProbe,
      guard,
    );
    await assertEvidenceGuardBound(guard);
    return true;
  };
  const commit = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: QUARANTINE_EVIDENCE_SCHEMA_VERSION,
        operation_fingerprint: body.operation_fingerprint,
        json_sha256: hashBytes(json),
        markdown_sha256: hashBytes(markdown),
        json_fsync_status: "PASS",
        markdown_fsync_status: "PASS",
        body_directory_fsync_status: bodyDirectoryFsyncStatus,
      },
      null,
      2,
    )}\n`,
  );
  let freshCommitBinding = null;
  let commitStatus;
  let commitDirectoryFsyncStatus;
  try {
    await assertRuntimeFence();
    commitStatus = await writeNoClobber(
      fileSystem,
      commitPath,
      commit,
      identityProbe,
      guard,
      {
        directoryBinding,
        async beforeLink({ temporary_path, temporary_binding }) {
          await assertComponentBindings();
          await assertExactEvidenceFileBinding(
            fileSystem,
            temporary_path,
            commit,
            temporary_binding,
            identityProbe,
            guard,
          );
          return assertRuntimeFence();
        },
        async afterLink({ temporary_binding }) {
          freshCommitBinding = Object.freeze({
            path: commitPath,
            identity: temporary_binding.identity,
          });
          await assertRuntimeFence();
          await assertComponentBindings();
        },
      },
    );
    await assertRuntimeFence();
    await assertComponentBindings();
    commitDirectoryFsyncStatus = await syncDirectory(
      fileSystem,
      directory,
      guard,
    );
    await assertRuntimeFence();
    await assertComponentBindings();
  } catch (error) {
    if (freshCommitBinding) {
      try {
        await revokeExactInstalledFile({
          fileSystem,
          file: commitPath,
          bytes: commit,
          expectedIdentity: freshCommitBinding.identity,
          identityProbe,
          guard,
          directoryBinding,
        });
      } catch (revocationError) {
        throw revocationError;
      }
    }
    throw error;
  }

  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
    commit_path: commitPath,
    json_status: jsonStatus,
    markdown_status: markdownStatus,
    commit_status: commitStatus,
    json_fsync_status: "PASS",
    markdown_fsync_status: "PASS",
    commit_fsync_status: "PASS",
    directory_fsync_status: commitDirectoryFsyncStatus,
    body_directory_fsync_status: bodyDirectoryFsyncStatus,
    commit_directory_fsync_status: commitDirectoryFsyncStatus,
  };
}

function replayAudit(
  existing,
  request,
  binding,
  fingerprint,
  now,
  authorityContext,
) {
  let evidence;
  try {
    evidence = JSON.parse(existing.evidence_json);
  } catch {
    fail("quarantine_replay_audit_invalid");
  }
  const auditCreatedAt = exactIso(
    existing.created_at,
    "quarantine_replay_audit_invalid",
  );
  if (Date.parse(auditCreatedAt) > now.getTime()) {
    fail("quarantine_replay_audit_invalid");
  }
  const reason = `governed_exact_plan_quarantined:${fingerprint}`;
  const expectedEvidence = auditEvidence(
    request,
    binding,
    fingerprint,
    authorityContext,
  );
  if (
    existing.actor_id !== request.operator_id ||
    existing.action !== ACTION ||
    existing.target_type !== "governed_exact_plan" ||
    existing.target_id !== binding.plan.plan_sha256 ||
    existing.decision !== "QUARANTINED" ||
    existing.reason !== reason ||
    existing.evidence_json !== JSON.stringify(expectedEvidence) ||
    existing.idempotency_key !== auditKey(fingerprint)
  ) {
    fail("quarantine_replay_audit_invalid");
  }
  return { evidence, auditCreatedAt, reason };
}

function recoveryHold(result, blocker, status = "RECOVERY_REQUIRED") {
  return {
    ...result,
    verdict: "HOLD",
    status,
    blocker,
    evidence: null,
  };
}

async function validateDirtyReplaySnapshot({
  request,
  backup,
  fileSystem,
  identityProbe,
  inspect,
  inspectStoppedAuthority,
  authorityContext,
  workspaceInspector,
  runtimeProfileValidator,
  clock,
  fingerprint,
  now,
}) {
  return withIsolatedSnapshotDatabase(
    fileSystem,
    backup.source_snapshot_bytes,
    identityProbe,
    async ({ db, snapshotPath, snapshotFile }) => {
      const existing = db
        .prepare(
          "SELECT * FROM operator_audit_log WHERE action=? AND idempotency_key=?",
        )
        .get(ACTION, auditKey(fingerprint));
      if (!existing) {
        fail("quarantine_database_sidecar_present");
      }
      const reason = `governed_exact_plan_quarantined:${fingerprint}`;
      const inspectionNow = clockNow(clock);
      const binding = await inspect(bindingRequest(request, "cancelled", reason), {
        db,
        fileSystem,
        databaseFileBinding: snapshotFile,
        openedDatabasePath: snapshotPath,
        workspaceInspector,
        runtimeProfileValidator,
        now: () => inspectionNow,
      });
      await inspectStoppedAuthority(binding);
      const audit = replayAudit(
        existing,
        request,
        binding,
        fingerprint,
        now,
        authorityContext(),
      );
      const replayExclusions = operationRowExclusions(request, fingerprint);
      const structuralSnapshot = canonicalSqliteStructuralSnapshot(db);
      if (
        canonicalSqliteStructuralDigest(structuralSnapshot) !==
          backup.backup_structural_digest ||
        canonicalSqliteSnapshotDigest(db, {
          excludeOperationRows: replayExclusions,
        }) !== backup.backup_operation_remainder_digest
      ) {
        fail("quarantine_database_logical_state_mismatch");
      }
      assertExactAppliedRows({
        db,
        request,
        standby: binding.plan.production_jobs[1],
        standbyPreimage: backup.standby_preimage,
        appliedAt: audit.auditCreatedAt,
        reason,
        evidence: audit.evidence,
        auditId: Number(existing.id),
        fingerprint,
      });
      assertNoPublication(db, binding.plan.production_jobs);
      return { audit, binding, existing };
    },
  );
}

async function quarantineExactGovernedProductionPlan(value, dependencies = {}) {
  const clock = dependencies.now || (() => new Date());
  const now = clockNow(clock);
  const request = normaliseRequest(value, now);
  const fileSystem = dependencies.fs || defaultFs;
  const identityProbe = dependencies.fileIdentityProbe || null;
  let db = dependencies.db || null;
  let ownsDb = false;
  let quiescenceDb = null;
  let ownsQuiescenceDb = false;
  let lease = null;
  let committed = null;
  let operationError = null;
  let outputDirectory = null;
  let replay = null;
  let replayEvidenceBody = null;
  let finalRuntimeFence = null;
  let finalOutputBinding = null;
  let admittedDatabaseIdentity = null;
  let admittedRuntimeAuthority = null;
  let latestRuntimeAuthorityFingerprint = null;
  let liveSourceFile = null;
  let latestAuthorityBinding = null;
  const inspectQuiescence =
    dependencies.inspectQuiescence ||
    ((options) => inspectWindowsPulseQuiescence(options));
  const openDatabase =
    dependencies.openDatabase ||
    ((databasePath, options) => new Database(databasePath, options));
  const inspectDatabaseIdentity =
    dependencies.inspectDatabaseIdentity || inspectLiveDatabaseIdentity;
  const measureDatabaseIdentity = () => {
    let measured;
    try {
      measured = exactLiveDatabaseIdentity(
        inspectDatabaseIdentity({ databasePath: request.database_path }),
        request.database_path,
      );
    } catch (error) {
      if (error?.code === "quarantine_open_database_identity_mismatch") {
        throw error;
      }
      fail("quarantine_open_database_identity_mismatch");
    }
    if (
      admittedDatabaseIdentity &&
      !sameLiveDatabaseIdentity(measured, admittedDatabaseIdentity)
    ) {
      fail("quarantine_open_database_identity_mismatch");
    }
    admittedDatabaseIdentity ||= measured;
    return admittedDatabaseIdentity;
  };
  const inspectStoppedAuthority = async (binding) => {
    const databaseIdentity = measureDatabaseIdentity();
    if (!quiescenceDb || !liveSourceFile) {
      fail("quarantine_open_database_identity_mismatch");
    }
    await assertOpenedDatabaseIdentity(
      quiescenceDb,
      fileSystem,
      liveSourceFile,
      identityProbe,
    ).catch(() => fail("quarantine_open_database_identity_mismatch"));
    const inspected = assertQuiescent(
      await inspectQuiescence({
        profile: binding.profile,
        workspaceRoot: binding.root.path,
        checkoutRealPath: binding.root.real_path,
        expectedCommit: request.expected_checkout_commit,
        databaseIdentitySha256: databaseIdentity.database_identity_sha256,
        db: quiescenceDb,
      }),
      binding.profile,
      databaseIdentity.database_identity_sha256,
      admittedRuntimeAuthority,
    );
    latestRuntimeAuthorityFingerprint = inspected.context.authority_fingerprint;
    admittedRuntimeAuthority ||= inspected.context;
    await absentNoLink(fileSystem, binding.activation_receipt_path);
    latestAuthorityBinding = binding;
    return inspected.report;
  };
  const openAndBindLiveDatabase = async (sourceFile) => {
    if (!db) {
      db = openDatabase(request.database_path, { fileMustExist: true });
      ownsDb = true;
    }
    await assertOpenedDatabaseIdentity(
      db,
      fileSystem,
      sourceFile,
      identityProbe,
    );
    return openedDatabaseTransitionLeaseFactory(db);
  };

  operationAttempt: try {
    if (!authorityEnvironment(dependencies.env || process.env)) {
      fail("quarantine_authority_environment_invalid");
    }
    const executorRootBinding = await inspectDirectory(
      fileSystem,
      request.executor_workspace_root,
      "quarantine_executor_workspace_invalid",
      identityProbe,
    );
    await assertExecutorCodeBinding({
      fileSystem,
      rootBinding: executorRootBinding,
      modulePath: dependencies.executorModulePath || __filename,
      entrypointPath:
        dependencies.executorEntrypointPath || require.main?.filename,
      identityProbe,
    });
    const executor = (dependencies.inspectExecutor || defaultExecutorInspector)(
      request.executor_workspace_root,
    );
    if (
      executor?.commit !== request.expected_executor_checkout_commit ||
      executor?.tracked_clean !== true
    ) {
      fail("quarantine_executor_workspace_mismatch");
    }

    const backup = await inspectBackupStructure(
      request,
      fileSystem,
      identityProbe,
    );
    liveSourceFile = backup.source_file;
    measureDatabaseIdentity();
    quiescenceDb = (
      dependencies.openQuiescenceDatabase ||
      ((databasePath, options) => new Database(databasePath, options))
    )(request.database_path, { readonly: true, fileMustExist: true });
    ownsQuiescenceDb = true;
    await assertOpenedDatabaseIdentity(
      quiescenceDb,
      fileSystem,
      backup.source_file,
      identityProbe,
    );
    const inspect =
      dependencies.inspectBindings ||
      inspectExactGovernedPlanQuarantineBindings;
    const fingerprint = operationFingerprint(request);
    const requestFingerprint = canonicalSha256(request);
    const dirtySource =
      backup.source_sidecars.wal_nonempty === true ||
      backup.source_sidecars.shm_present === true;
    let dirtyReplayPreflight = null;
    if (dirtySource) {
      if (db) {
        fail("quarantine_database_sidecar_present");
      }
      dirtyReplayPreflight = await validateDirtyReplaySnapshot({
        request,
        backup,
        fileSystem,
        identityProbe,
        inspect,
        inspectStoppedAuthority,
        authorityContext: () => admittedRuntimeAuthority,
        workspaceInspector: dependencies.workspaceInspector,
        runtimeProfileValidator: dependencies.runtimeProfileValidator,
        clock,
        fingerprint,
        now,
      });
      assertBackupFreshness(
        backup.evidence,
        dirtyReplayPreflight.audit.auditCreatedAt,
      );
      const currentSidecars = await inspectSourceSidecars(
        fileSystem,
        backup.source_file.path,
        identityProbe,
      );
      if (
        !sameSourceSidecarCapture(
          backup.source_sidecars,
          currentSidecars,
        ) ||
        (await observeSourceSha256(
          fileSystem,
          backup.source_file,
          identityProbe,
        )) !== backup.source_sha256
      ) {
        fail("quarantine_database_sidecar_present");
      }
      const replayBase = {
        ...dirtyReplayPreflight.audit.evidence,
        request_fingerprint: requestFingerprint,
        audit_id: Number(dirtyReplayPreflight.existing.id),
        primary_job_id: request.expected_primary_job_id,
        standby_job_id: request.expected_standby_job_id,
      };
      const runtimeTransitionLeaseFactory = await openAndBindLiveDatabase(
        backup.source_file,
      );
      const recoveryLeaseAcquiredAt = clockNow(clock);
      try {
        await inspectStoppedAuthority(dirtyReplayPreflight.binding);
        lease = (
          dependencies.acquireRecoveryLease ||
          acquireLiveRuntimeTransitionLease
        )({
          databasePath: request.database_path,
          action: `${ACTION}:recovery`,
          binding: fingerprint,
          metadata: {
            operation_fingerprint: fingerprint,
            plan_sha256: dirtyReplayPreflight.binding.plan.plan_sha256,
          },
          now: recoveryLeaseAcquiredAt,
          authorityContextSha256:
            admittedRuntimeAuthority.authority_fingerprint,
          authorityContextProvider: () => latestRuntimeAuthorityFingerprint,
          participantIdentity: dependencies.transitionLeaseParticipantIdentity,
          participantProcessInspector:
            dependencies.participantProcessInspector,
          runtimeTransitionLeaseFactory,
          unavailableCode: "quarantine_transition_lease_present",
          lostCode: "quarantine_lease_lost",
        });
        assertCurrentLeaseAuthority(
          lease,
          admittedRuntimeAuthority.authority_fingerprint,
        );
        assertExactTransitionLease(
          db,
          lease,
          fingerprint,
          dirtyReplayPreflight.binding.plan.plan_sha256,
          recoveryLeaseAcquiredAt,
          admittedRuntimeAuthority.authority_fingerprint,
        );
      } catch (error) {
        if (
          error?.code !== "quarantine_transition_lease_present" &&
          error?.message !== "quarantine_transition_lease_present"
        ) {
          throw error;
        }
        replay = recoveryHold(
          replayBase,
          "quarantine_transition_lease_present",
        );
        break operationAttempt;
      }
    }
    const runtimeTransitionLeaseFactory = await openAndBindLiveDatabase(
      backup.source_file,
    );

    const callInspect = (standbyStatus, reason = null) => {
      const inspectionNow = clockNow(clock);
      return inspect(bindingRequest(request, standbyStatus, reason), {
        db,
        fileSystem,
        databaseFileBinding: {
          path: backup.source_file.path,
          real_path: backup.source_file.path,
          identity: backup.source_file.identity,
        },
        workspaceInspector: dependencies.workspaceInspector,
        runtimeProfileValidator: dependencies.runtimeProfileValidator,
        now: () => inspectionNow,
      });
    };
    const assertLeaseMutationAuthority = async (binding, observedAt) => {
      await inspectStoppedAuthority(binding);
      assertCurrentLeaseAuthority(
        lease,
        admittedRuntimeAuthority.authority_fingerprint,
      );
      assertExactTransitionLease(
        db,
        lease,
        fingerprint,
        binding.plan.plan_sha256,
        observedAt,
        admittedRuntimeAuthority.authority_fingerprint,
      );
    };
    const renewTransitionLease = async (binding, observedAt) => {
      await assertLeaseMutationAuthority(binding, observedAt);
      let renewed;
      try {
        renewed = await lease.renew(observedAt);
      } catch {
        fail("quarantine_lease_lost");
      }
      if (renewed !== true) fail("quarantine_lease_lost");
      assertCurrentLeaseAuthority(
        lease,
        admittedRuntimeAuthority.authority_fingerprint,
      );
    };
    const existing = db
      .prepare(
        "SELECT * FROM operator_audit_log WHERE action=? AND idempotency_key=?",
      )
      .get(ACTION, auditKey(fingerprint));
    if (
      dirtyReplayPreflight &&
      (!existing ||
        Number(existing.id) !== Number(dirtyReplayPreflight.existing.id))
    ) {
      fail("quarantine_replay_audit_invalid");
    }

    if (existing) {
      const reason = `governed_exact_plan_quarantined:${fingerprint}`;
      const validateReplayState = async () => {
        const currentAudit = db
          .prepare(
            "SELECT * FROM operator_audit_log WHERE action=? AND idempotency_key=?",
          )
          .get(ACTION, auditKey(fingerprint));
        if (!currentAudit || Number(currentAudit.id) !== Number(existing.id)) {
          fail("quarantine_replay_audit_invalid");
        }
        const binding = await callInspect("cancelled", reason);
        await inspectStoppedAuthority(binding);
        const audit = replayAudit(
          currentAudit,
          request,
          binding,
          fingerprint,
          now,
          admittedRuntimeAuthority,
        );
        const replayExclusions = operationRowExclusions(request, fingerprint);
        const replayStructuralSnapshot = canonicalSqliteStructuralSnapshot(db);
        if (
          canonicalSqliteStructuralDigest(replayStructuralSnapshot) !==
            backup.backup_structural_digest ||
          canonicalSqliteSnapshotDigest(db, {
            excludeOperationRows: replayExclusions,
          }) !== backup.backup_operation_remainder_digest
        ) {
          fail("quarantine_database_logical_state_mismatch");
        }
        assertExactAppliedRows({
          db,
          request,
          standby: binding.plan.production_jobs[1],
          standbyPreimage: backup.standby_preimage,
          appliedAt: audit.auditCreatedAt,
          reason,
          evidence: audit.evidence,
          auditId: Number(currentAudit.id),
          fingerprint,
        });
        assertNoPublication(db, binding.plan.production_jobs);
        await assertOpenedDatabaseIdentity(
          db,
          fileSystem,
          backup.source_file,
          identityProbe,
        );
        await inspectSourceSidecars(
          fileSystem,
          backup.source_file.path,
          identityProbe,
        );
        await observeSourceSha256(fileSystem, backup.source_file, identityProbe);
        return { audit, binding, currentAudit };
      };

      const firstReplayState = await validateReplayState();
      replayEvidenceBody = firstReplayState.audit.evidence;
      assertBackupFreshness(
        backup.evidence,
        firstReplayState.audit.auditCreatedAt,
      );
      outputDirectory = await preflightOutput(
        fileSystem,
        firstReplayState.binding.root.path,
        request.output_dir,
        fingerprint,
        identityProbe,
      );
      finalOutputBinding = {
        root: firstReplayState.binding.root.path,
        fingerprint,
        preflight: outputDirectory,
      };

      const replayBase = {
        ...firstReplayState.audit.evidence,
        request_fingerprint: requestFingerprint,
        audit_id: Number(existing.id),
        primary_job_id: request.expected_primary_job_id,
        standby_job_id: request.expected_standby_job_id,
      };
      if (!lease) {
        const recoveryLeaseAcquiredAt = clockNow(clock);
        try {
          await inspectStoppedAuthority(firstReplayState.binding);
          lease = (
            dependencies.acquireRecoveryLease ||
            acquireLiveRuntimeTransitionLease
          )({
            databasePath: request.database_path,
            action: `${ACTION}:recovery`,
            binding: fingerprint,
            metadata: {
              operation_fingerprint: fingerprint,
              plan_sha256: firstReplayState.binding.plan.plan_sha256,
            },
            now: recoveryLeaseAcquiredAt,
            authorityContextSha256:
              admittedRuntimeAuthority.authority_fingerprint,
            authorityContextProvider: () => latestRuntimeAuthorityFingerprint,
            participantIdentity:
              dependencies.transitionLeaseParticipantIdentity,
            participantProcessInspector:
              dependencies.participantProcessInspector,
            runtimeTransitionLeaseFactory,
            unavailableCode: "quarantine_transition_lease_present",
            lostCode: "quarantine_lease_lost",
          });
          assertCurrentLeaseAuthority(
            lease,
            admittedRuntimeAuthority.authority_fingerprint,
          );
          assertExactTransitionLease(
            db,
            lease,
            fingerprint,
            firstReplayState.binding.plan.plan_sha256,
            recoveryLeaseAcquiredAt,
            admittedRuntimeAuthority.authority_fingerprint,
          );
        } catch (error) {
          if (
            error?.code !== "quarantine_transition_lease_present" &&
            error?.message !== "quarantine_transition_lease_present"
          ) {
            throw error;
          }
          replay = recoveryHold(
            replayBase,
            "quarantine_transition_lease_present",
          );
        }
      }

      if (lease) {
        await renewTransitionLease(
          firstReplayState.binding,
          clockNow(clock),
        );
        const finalReplayState = await validateReplayState();
        const finalLeaseNow = clockNow(clock);
        await renewTransitionLease(finalReplayState.binding, finalLeaseNow);
        assertExactTransitionLease(
          db,
          lease,
          fingerprint,
          finalReplayState.binding.plan.plan_sha256,
          finalLeaseNow,
          admittedRuntimeAuthority.authority_fingerprint,
        );
        await absentNoLink(
          fileSystem,
          finalReplayState.binding.activation_receipt_path,
        );
        finalRuntimeFence = {
          activationReceiptPath:
            finalReplayState.binding.activation_receipt_path,
          profile: finalReplayState.binding.profile,
          workspaceRoot: finalReplayState.binding.root.path,
          workspaceRealPath: finalReplayState.binding.root.real_path,
          planSha256: finalReplayState.binding.plan.plan_sha256,
          jobs: finalReplayState.binding.plan.production_jobs,
          fingerprint,
          backupEvidence: backup.evidence,
          requireBackupFreshness: false,
          sourceFile: backup.source_file,
        };
        replay = {
          ...replayBase,
          verdict: "QUARANTINED",
          status: "REPLAYED",
        };
      }
    } else {
      assertObservedSourceSidecarsClear(backup.source_sidecars);
      if (backup.source_transition_lease_count !== 0) {
        fail("quarantine_transition_lease_present");
      }
      assertBackupFreshness(backup.evidence, now);
      if (
        backup.source_sha256 !== request.expected_database_sha256 ||
        backup.source_sha256 !==
          text(backup.evidence.source_database_sha256).toLowerCase()
      ) {
        fail("quarantine_database_sha256_mismatch");
      }
      if (backup.source_logical_digest !== backup.backup_logical_digest) {
        fail("quarantine_database_logical_state_mismatch");
      }

      const binding = await callInspect("pending");
      outputDirectory = await preflightOutput(
        fileSystem,
        binding.root.path,
        request.output_dir,
        fingerprint,
        identityProbe,
      );
      finalOutputBinding = {
        root: binding.root.path,
        fingerprint,
        preflight: outputDirectory,
      };
      await absentNoLink(fileSystem, binding.activation_receipt_path);
      assertNoPublication(db, binding.plan.production_jobs);

      await inspectStoppedAuthority(binding);
      await assertBaselineDatabaseFence({
        db,
        fileSystem,
        backup,
        request,
        identityProbe,
      });

      const leaseAcquiredAt = clockNow(
        clock,
        "quarantine_database_physical_state_mismatch",
      );
      await inspectStoppedAuthority(binding);
      lease = (dependencies.acquireLease || acquireLiveRuntimeTransitionLease)({
        databasePath: request.database_path,
        action: ACTION,
        binding: fingerprint,
        metadata: {
          operation_fingerprint: fingerprint,
          plan_sha256: binding.plan.plan_sha256,
        },
        now: leaseAcquiredAt,
        authorityContextSha256:
          admittedRuntimeAuthority.authority_fingerprint,
        authorityContextProvider: () => latestRuntimeAuthorityFingerprint,
        participantIdentity: dependencies.transitionLeaseParticipantIdentity,
        participantProcessInspector: dependencies.participantProcessInspector,
        runtimeTransitionLeaseFactory,
        unavailableCode: "quarantine_transition_lease_present",
        lostCode: "quarantine_lease_lost",
      });
      assertCurrentLeaseAuthority(
        lease,
        admittedRuntimeAuthority.authority_fingerprint,
      );
      assertExactTransitionLease(
        db,
        lease,
        fingerprint,
        binding.plan.plan_sha256,
        leaseAcquiredAt,
        admittedRuntimeAuthority.authority_fingerprint,
      );
      await renewTransitionLease(binding, leaseAcquiredAt);
      const leasedPhysicalSha256 = await assertLeasedDatabaseFence({
        db,
        fileSystem,
        backup,
        request,
        identityProbe,
        lease,
        fingerprint,
        planSha256: binding.plan.plan_sha256,
        authorityContextSha256:
          admittedRuntimeAuthority.authority_fingerprint,
        now: clockNow(clock, "quarantine_database_physical_state_mismatch"),
      });
      const operationExclusions = operationRowExclusions(request, fingerprint);

      try {
        await assertLeaseMutationAuthority(
          binding,
          clockNow(clock, "quarantine_database_physical_state_mismatch"),
        );
        db.exec("BEGIN IMMEDIATE");
        await assertLeasedDatabaseFence({
          db,
          fileSystem,
          backup,
          request,
          identityProbe,
          lease,
          fingerprint,
          planSha256: binding.plan.plan_sha256,
          authorityContextSha256:
            admittedRuntimeAuthority.authority_fingerprint,
          now: clockNow(clock, "quarantine_database_physical_state_mismatch"),
          expectedPhysicalSha256: leasedPhysicalSha256,
        });
        const fresh = await callInspect("pending");
        await inspectStoppedAuthority(fresh);
        assertNoPublication(db, fresh.plan.production_jobs);
        await assertLeasedDatabaseFence({
          db,
          fileSystem,
          backup,
          request,
          identityProbe,
          lease,
          fingerprint,
          planSha256: fresh.plan.plan_sha256,
          authorityContextSha256:
            admittedRuntimeAuthority.authority_fingerprint,
          now: clockNow(clock, "quarantine_database_physical_state_mismatch"),
          expectedPhysicalSha256: leasedPhysicalSha256,
        });

        const reason = `governed_exact_plan_quarantined:${fingerprint}`;
        const standby = fresh.plan.production_jobs[1];
        const standbyPreimage = db
          .prepare("SELECT * FROM jobs WHERE id=?")
          .get(request.expected_standby_job_id);
        if (!exactSqliteRow(standbyPreimage, backup.standby_preimage)) {
          fail("quarantine_database_logical_state_mismatch");
        }
        await assertLeaseMutationAuthority(
          fresh,
          clockNow(clock, "quarantine_database_physical_state_mismatch"),
        );
        const changed = db
          .prepare(
            `UPDATE jobs
                SET status='cancelled', completed_at=?, updated_at=?, last_error=?
              WHERE id=? AND kind=? AND channel_id='pulse-gaming'
                AND story_id=? AND idempotency_key=? AND status='pending'
                AND attempt_count=0 AND max_attempts=3
                AND claimed_by IS NULL AND claimed_at IS NULL
                AND lease_until IS NULL`,
          )
          .run(
            request.generated_at,
            request.generated_at,
            reason,
            request.expected_standby_job_id,
            standby.kind,
            standby.database_story_id,
            standby.idempotency_key,
          ).changes;
        if (changed !== 1) fail("quarantine_standby_fence_lost");

        const evidence = auditEvidence(
          request,
          fresh,
          fingerprint,
          admittedRuntimeAuthority,
        );
        await assertLeaseMutationAuthority(
          fresh,
          clockNow(clock, "quarantine_database_physical_state_mismatch"),
        );
        const inserted = db
          .prepare(
            `INSERT INTO operator_audit_log
               (actor_id, action, target_type, target_id, decision, reason,
                evidence_json, created_at, idempotency_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            request.operator_id,
            ACTION,
            "governed_exact_plan",
            fresh.plan.plan_sha256,
            "QUARANTINED",
            reason,
            JSON.stringify(evidence),
            request.generated_at,
            auditKey(fingerprint),
          );
        await absentNoLink(fileSystem, fresh.activation_receipt_path);
        assertNoPublication(db, fresh.plan.production_jobs);
        const preCommitStructuralSnapshot =
          canonicalSqliteStructuralSnapshot(db);
        if (
          canonicalSqliteStructuralDigest(preCommitStructuralSnapshot) !==
            backup.backup_structural_digest ||
          canonicalSqliteSnapshotDigest(db, {
            excludeOperationRows: operationExclusions,
          }) !== backup.backup_operation_remainder_digest
        ) {
          fail("quarantine_database_logical_state_mismatch");
        }
        assertExactAppliedRows({
          db,
          request,
          standby,
          standbyPreimage,
          appliedAt: request.generated_at,
          reason,
          evidence,
          auditId: Number(inserted.lastInsertRowid),
          fingerprint,
        });
        await assertOpenedDatabaseIdentity(
          db,
          fileSystem,
          backup.source_file,
          identityProbe,
        );
        const preCommitSha256 = await observeSourceSha256(
          fileSystem,
          backup.source_file,
          identityProbe,
        );
        if (preCommitSha256 !== leasedPhysicalSha256) {
          fail("quarantine_database_physical_state_mismatch");
        }
        const preFinalAsyncFenceNow = clockNow(clock);
        assertRequestCurrent(request, preFinalAsyncFenceNow);
        assertBackupFreshness(backup.evidence, preFinalAsyncFenceNow);
        await inspectStoppedAuthority(fresh);
        const preCommitNow = clockNow(clock);
        assertRequestCurrent(request, preCommitNow);
        assertBackupFreshness(backup.evidence, preCommitNow);
        assertExactTransitionLease(
          db,
          lease,
          fingerprint,
          fresh.plan.plan_sha256,
          preCommitNow,
          admittedRuntimeAuthority.authority_fingerprint,
        );
        await assertLeaseMutationAuthority(fresh, preCommitNow);
        db.exec("COMMIT");
        committed = {
          evidence,
          result: {
            ...evidence,
            request_fingerprint: requestFingerprint,
            verdict: "QUARANTINED",
            status: "APPLIED",
            audit_id: Number(inserted.lastInsertRowid),
            primary_job_id: request.expected_primary_job_id,
            standby_job_id: request.expected_standby_job_id,
          },
        };
        finalRuntimeFence = {
          activationReceiptPath: fresh.activation_receipt_path,
          profile: fresh.profile,
          workspaceRoot: fresh.root.path,
          workspaceRealPath: fresh.root.real_path,
          planSha256: fresh.plan.plan_sha256,
          jobs: fresh.plan.production_jobs,
          fingerprint,
          backupEvidence: backup.evidence,
          requireBackupFreshness: true,
          sourceFile: backup.source_file,
        };
      } catch (error) {
        try {
          if (db.inTransaction) db.exec("ROLLBACK");
        } catch {
          // Preserve the first fail-closed error.
        }
        throw error;
      }
    }
  } catch (error) {
    operationError = error;
  }

  const releaseRuntimeResources = async () => {
    let releaseError = null;
    if (lease) {
      const activeLease = lease;
      try {
        if (!latestAuthorityBinding || !admittedRuntimeAuthority) {
          fail("quarantine_lease_release_failed");
        }
        await inspectStoppedAuthority(latestAuthorityBinding);
        assertCurrentLeaseAuthority(
          activeLease,
          admittedRuntimeAuthority.authority_fingerprint,
        );
        if ((await activeLease.release()) !== true) {
          releaseError = { code: "quarantine_lease_release_failed" };
        }
      } catch {
        releaseError = { code: "quarantine_lease_release_failed" };
      }
      lease = null;
    }
    if (ownsDb && db) {
      const ownedDb = db;
      db = null;
      ownsDb = false;
      try {
        ownedDb.close();
      } catch (error) {
        releaseError ||= error;
      }
    }
    if (ownsQuiescenceDb && quiescenceDb) {
      const ownedQuiescenceDb = quiescenceDb;
      quiescenceDb = null;
      ownsQuiescenceDb = false;
      try {
        ownedQuiescenceDb.close();
      } catch (error) {
        releaseError ||= error;
      }
    }
    return releaseError;
  };

  if (operationError || replay?.verdict === "HOLD") {
    const releaseError = await releaseRuntimeResources();
    if (releaseError) {
      const durableResult = replay || committed?.result;
      if (durableResult) {
        return recoveryHold(durableResult, safeBlocker(releaseError));
      }
      throw publicError(releaseError);
    }
    if (operationError) throw publicError(operationError);
    return replay;
  }

  const result = replay || committed?.result;
  const evidenceBody = replayEvidenceBody || committed?.evidence;
  const assertFinalRuntimeFence = async () => {
    if (!result || !finalRuntimeFence || !lease || !db) {
      fail("quarantine_lease_lost");
    }
    const fenceNow = clockNow(clock);
    assertRequestCurrent(request, fenceNow);
    if (finalRuntimeFence.requireBackupFreshness) {
      assertBackupFreshness(finalRuntimeFence.backupEvidence, fenceNow);
    }
    const binding = {
      profile: finalRuntimeFence.profile,
      root: {
        path: finalRuntimeFence.workspaceRoot,
        real_path: finalRuntimeFence.workspaceRealPath,
      },
      activation_receipt_path: finalRuntimeFence.activationReceiptPath,
      plan: {
        plan_sha256: finalRuntimeFence.planSha256,
        production_jobs: finalRuntimeFence.jobs,
      },
    };
    await inspectStoppedAuthority(binding);
    assertCurrentLeaseAuthority(
      lease,
      admittedRuntimeAuthority.authority_fingerprint,
    );
    assertExactTransitionLease(
      db,
      lease,
      finalRuntimeFence.fingerprint,
      finalRuntimeFence.planSha256,
      fenceNow,
      admittedRuntimeAuthority.authority_fingerprint,
    );
    let renewed;
    try {
      renewed = await lease.renew(fenceNow);
    } catch {
      fail("quarantine_lease_lost");
    }
    if (renewed !== true) fail("quarantine_lease_lost");
    await assertOpenedDatabaseIdentity(
      db,
      fileSystem,
      finalRuntimeFence.sourceFile,
      identityProbe,
    );
    assertExactTransitionLease(
      db,
      lease,
      finalRuntimeFence.fingerprint,
      finalRuntimeFence.planSha256,
      fenceNow,
      admittedRuntimeAuthority.authority_fingerprint,
    );
    await inspectStoppedAuthority(binding);
    assertNoPublication(db, finalRuntimeFence.jobs);
    const finalFenceNow = clockNow(clock);
    assertRequestCurrent(request, finalFenceNow);
    if (finalRuntimeFence.requireBackupFreshness) {
      assertBackupFreshness(
        finalRuntimeFence.backupEvidence,
        finalFenceNow,
      );
    }
    assertExactTransitionLease(
      db,
      lease,
      finalRuntimeFence.fingerprint,
      finalRuntimeFence.planSha256,
      finalFenceNow,
      admittedRuntimeAuthority.authority_fingerprint,
    );
    await absentNoLink(
      fileSystem,
      finalRuntimeFence.activationReceiptPath,
    );
    return true;
  };

  let evidenceGuard = null;
  let preparationError = null;
  try {
    await assertFinalRuntimeFence();
    const configuredGuardAcquirer =
      dependencies.acquireEvidenceDirectoryGuard ||
      acquireEvidenceDirectoryGuard;
    const materializedOutput = await ensureOutput(
      fileSystem,
      finalOutputBinding.root,
      request.output_dir,
      finalOutputBinding.fingerprint,
      finalOutputBinding.preflight,
      identityProbe,
      (options) =>
        configuredGuardAcquirer({
          ...options,
          platform: dependencies.evidenceGuardPlatform || process.platform,
          afterReady: dependencies.afterEvidenceGuardReady,
        }),
    );
    outputDirectory = materializedOutput.directoryBinding;
    evidenceGuard = materializedOutput.guard;
    await assertEvidenceGuardBound(evidenceGuard);
    await assertFinalRuntimeFence();
  } catch (error) {
    preparationError = error;
  }
  let evidence = null;
  let evidenceFailed = false;
  if (!preparationError) {
    try {
      await assertFinalRuntimeFence();
      await assertEvidenceGuardBound(evidenceGuard);
      evidence = await (dependencies.writeEvidence || writeEvidence)(
        fileSystem,
        outputDirectory,
        evidenceBody,
        identityProbe,
        evidenceGuard,
        assertFinalRuntimeFence,
      );
      await assertEvidenceGuardBound(evidenceGuard);
      await assertFinalRuntimeFence();
    } catch {
      evidenceFailed = true;
    }
  }
  try {
    if (evidenceGuard && (await evidenceGuard.release()) !== true) {
      evidenceFailed = true;
    }
  } catch {
    evidenceFailed = true;
  }
  if (!preparationError && !evidenceFailed) {
    try {
      await assertFinalRuntimeFence();
    } catch {
      evidenceFailed = true;
    }
  }
  const releaseError = await releaseRuntimeResources();
  if (releaseError) {
    return recoveryHold(result, safeBlocker(releaseError));
  }
  if (preparationError) {
    return recoveryHold(result, safeBlocker(preparationError));
  }
  if (evidenceFailed) {
    return recoveryHold(
      result,
      "quarantine_evidence_pending",
      "EVIDENCE_PENDING",
    );
  }
  return { ...result, evidence };
}

module.exports = {
  QUARANTINE_REQUEST_SCHEMA_VERSION,
  quarantineExactGovernedProductionPlan,
  renderMarkdown,
  safeBlocker,
};
