"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  checkpointedSqliteBlockers,
  sqliteSidecarSnapshot,
  withReadOnlySqliteSnapshot,
} = require("./stabilisation-cutover-reconcile");

const CUTOVER_SCHEMA_VERSION = "pulse-cutover-backup-evidence-v1";
const ATTEMPT_SCHEMA_VERSION = "pulse-cutover-backup-evidence-attempt-v1";
const BACKUP_SCHEMA_VERSION = "pulse-sqlite-backup-verification-v1";
const RESTORE_SCHEMA_VERSION = "pulse-restore-rehearsal-v1";
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATED_AT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function existingFile(filePath, blocker, blockers) {
  if (!filePath) {
    blockers.push(blocker);
    return null;
  }
  const resolved = path.resolve(String(filePath));
  try {
    if (!fs.statSync(resolved).isFile()) {
      blockers.push(blocker);
      return null;
    }
    return fs.realpathSync.native(resolved);
  } catch {
    blockers.push(blocker);
    return null;
  }
}

function pathKey(filePath, platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const resolved = pathApi.resolve(String(filePath || ""));
  return platform === "win32"
    ? resolved.replace(/\\/g, "/").toLowerCase()
    : resolved;
}

function samePath(left, right, platform = process.platform) {
  if (!left || !right) return false;
  try {
    return (
      pathKey(fs.realpathSync.native(path.resolve(String(left))), platform) ===
      pathKey(fs.realpathSync.native(path.resolve(String(right))), platform)
    );
  } catch {
    return pathKey(left, platform) === pathKey(right, platform);
  }
}

function parseJson(filePath, blocker, blockers) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    blockers.push(blocker);
    return null;
  }
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function verifyRecentTimestamp({ value, generatedAtMs, label, blockers }) {
  const valueMs = timestampMs(value);
  if (valueMs === null) {
    blockers.push(`${label}_time_required`);
    return null;
  }
  if (valueMs > generatedAtMs) {
    blockers.push(`${label}_time_in_future`);
  } else if (generatedAtMs - valueMs > MAX_EVIDENCE_AGE_MS) {
    blockers.push(`${label}_stale`);
  }
  return valueMs;
}

function firstColumn(row) {
  return String(Object.values(row || {})[0] || "")
    .trim()
    .toLowerCase();
}

function inspectSqlite(filePath) {
  const result = {
    openedReadOnly: false,
    quick_check: "failed",
    integrity_check: "failed",
    foreign_key_check: "failed",
    foreign_key_violation_count: null,
  };
  try {
    return withReadOnlySqliteSnapshot(filePath, (db) => {
      result.openedReadOnly = true;
      const quickRows = db.prepare("PRAGMA quick_check").all();
      const integrityRows = db.prepare("PRAGMA integrity_check").all();
      const foreignKeyRows = db.prepare("PRAGMA foreign_key_check").all();
      result.quick_check =
        quickRows.length === 1 && firstColumn(quickRows[0]) === "ok"
          ? "ok"
          : "failed";
      result.integrity_check =
        integrityRows.length === 1 && firstColumn(integrityRows[0]) === "ok"
          ? "ok"
          : "failed";
      result.foreign_key_violation_count = foreignKeyRows.length;
      result.foreign_key_check = foreignKeyRows.length === 0 ? "ok" : "failed";
      return result;
    });
  } catch {
    // The structured failed result is safer than exposing a database error.
  }
  return result;
}

function sourceSidecarBlockers(sourcePath) {
  if (!sourcePath) return [];
  return checkpointedSqliteBlockers(sqliteSidecarSnapshot(sourcePath), {
    allowSharedMemory: false,
  });
}

function proofChecksPass(verification) {
  return (
    verification?.openedReadOnly === true &&
    verification?.quick_check === "ok" &&
    verification?.integrity_check === "ok" &&
    verification?.foreign_key_check === "ok" &&
    Number(verification?.foreign_key_violation_count) === 0
  );
}

function canonicalNoLinkRegularFile(filePath) {
  const supplied = String(filePath || "");
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    return false;
  }
  try {
    const stat = fs.lstatSync(supplied, { bigint: true });
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      BigInt(stat.nlink || 0) !== 1n
    ) {
      return false;
    }
    return path.resolve(fs.realpathSync.native(supplied)) === supplied;
  } catch {
    return false;
  }
}

function validateCanonicalCutoverBackupEvidenceV1(value) {
  const blockers = [];
  const requiredTopLevelFields = [
    "schema_version",
    "backup_id",
    "backup_path",
    "backup_sha256",
    "source_database_path",
    "source_database_sha256",
    "verified_at",
    "verified_by",
    "restore_test_status",
    "integrity_check",
    "foreign_key_check",
    "quick_check",
    "restore_path",
    "restore_sha256",
    "backup_restore_hashes_match",
    "production_database_mutated",
    "verification",
    "provenance",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, blockers: ["canonical_evidence_object_required"] };
  }
  if (
    Object.keys(value).length !== requiredTopLevelFields.length ||
    requiredTopLevelFields.some((field) => !Object.hasOwn(value, field))
  ) {
    blockers.push("canonical_evidence_fields_invalid");
  }
  if (value.schema_version !== CUTOVER_SCHEMA_VERSION) {
    blockers.push("canonical_evidence_schema_invalid");
  }
  for (const [field, maximum] of [
    ["backup_id", 256],
    ["verified_by", 128],
  ]) {
    const supplied = String(value[field] || "").trim();
    if (!supplied || supplied.length > maximum || /[\r\n\0]/.test(supplied)) {
      blockers.push(`canonical_${field}_invalid`);
    }
  }
  for (const field of ["backup_path", "source_database_path", "restore_path"]) {
    if (!path.isAbsolute(String(value[field] || ""))) {
      blockers.push(`canonical_${field}_invalid`);
    }
  }
  for (const field of [
    "backup_sha256",
    "source_database_sha256",
    "restore_sha256",
  ]) {
    if (!SHA256_PATTERN.test(String(value[field] || ""))) {
      blockers.push(`canonical_${field}_invalid`);
    }
  }
  if (
    timestampMs(value.verified_at) === null ||
    new Date(timestampMs(value.verified_at)).toISOString() !== value.verified_at
  ) {
    blockers.push("canonical_verified_at_invalid");
  }
  if (
    value.restore_test_status !== "PASS" ||
    value.integrity_check !== "ok" ||
    value.foreign_key_check !== "ok" ||
    value.quick_check !== "ok" ||
    value.backup_restore_hashes_match !== true ||
    value.production_database_mutated !== false ||
    String(value.backup_sha256 || "").toLowerCase() !==
      String(value.restore_sha256 || "").toLowerCase()
  ) {
    blockers.push("canonical_verification_summary_invalid");
  }

  const verification = value.verification;
  const verificationFields = [
    "openedReadOnly",
    "quick_check",
    "integrity_check",
    "foreign_key_check",
    "foreign_key_violation_count",
  ];
  if (
    !verification ||
    typeof verification !== "object" ||
    Array.isArray(verification) ||
    Object.keys(verification).length !== 3 ||
    ["source", "backup", "restore"].some(
      (role) =>
        !Object.hasOwn(verification, role) ||
        !verification[role] ||
        typeof verification[role] !== "object" ||
        Array.isArray(verification[role]) ||
        Object.keys(verification[role]).length !== verificationFields.length ||
        verificationFields.some(
          (field) => !Object.hasOwn(verification[role], field),
        ) ||
        !proofChecksPass(verification[role]),
    )
  ) {
    blockers.push("canonical_verification_invalid");
  }

  const provenance = value.provenance;
  const provenanceFields = [
    "backup_verification_file",
    "backup_verification_schema",
    "backup_verified_at",
    "restore_rehearsal_file",
    "restore_rehearsal_schema",
    "restore_verified_at",
  ];
  const verifiedAtMs = timestampMs(value.verified_at);
  const backupVerifiedAtMs = timestampMs(provenance?.backup_verified_at);
  const restoreVerifiedAtMs = timestampMs(provenance?.restore_verified_at);
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).length !== provenanceFields.length ||
    provenanceFields.some((field) => !Object.hasOwn(provenance, field)) ||
    !canonicalNoLinkRegularFile(provenance.backup_verification_file) ||
    !canonicalNoLinkRegularFile(provenance.restore_rehearsal_file) ||
    provenance.backup_verification_schema !== BACKUP_SCHEMA_VERSION ||
    provenance.restore_rehearsal_schema !== RESTORE_SCHEMA_VERSION ||
    backupVerifiedAtMs === null ||
    restoreVerifiedAtMs === null ||
    new Date(backupVerifiedAtMs).toISOString() !==
      provenance.backup_verified_at ||
    new Date(restoreVerifiedAtMs).toISOString() !==
      provenance.restore_verified_at ||
    backupVerifiedAtMs > restoreVerifiedAtMs ||
    restoreVerifiedAtMs > verifiedAtMs
  ) {
    blockers.push("canonical_provenance_invalid");
  }
  return { valid: blockers.length === 0, blockers: unique(blockers) };
}

function observedChecksPass(verification) {
  return proofChecksPass(verification);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function composeCutoverBackupEvidence({
  databasePath,
  backupVerificationPath,
  restoreRehearsalPath,
  generatedAt = new Date(),
  verifiedBy,
} = {}) {
  const blockers = [];
  const generatedAtMs = timestampMs(generatedAt);
  if (generatedAtMs === null) {
    throw new Error("cutover_backup_evidence_generated_at_invalid");
  }
  if (Math.abs(Date.now() - generatedAtMs) > MAX_GENERATED_AT_CLOCK_SKEW_MS) {
    blockers.push("generated_at_not_current");
  }
  const generatedAtIso = new Date(generatedAtMs).toISOString();
  const operator = String(verifiedBy || "").trim();
  if (!operator || operator.length > 128 || /[\r\n\0]/.test(operator)) {
    blockers.push("backup_evidence_verifier_required");
  }

  const sourcePath = existingFile(
    databasePath,
    "source_database_file_required",
    blockers,
  );
  const sidecarPath = existingFile(
    backupVerificationPath,
    "backup_verification_file_required",
    blockers,
  );
  const rehearsalPath = existingFile(
    restoreRehearsalPath,
    "restore_rehearsal_file_required",
    blockers,
  );
  const backupProof = parseJson(
    sidecarPath,
    "backup_verification_invalid_json",
    blockers,
  );
  const restoreProof = parseJson(
    rehearsalPath,
    "restore_rehearsal_invalid_json",
    blockers,
  );
  blockers.push(...sourceSidecarBlockers(sourcePath));

  if (backupProof?.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    blockers.push("backup_verification_schema_invalid");
  }
  if (restoreProof?.schema_version !== RESTORE_SCHEMA_VERSION) {
    blockers.push("restore_rehearsal_schema_invalid");
  }

  const backupPath = existingFile(
    backupProof?.backupPath,
    "backup_file_required",
    blockers,
  );
  const restorePath = existingFile(
    restoreProof?.restored_copy,
    "restored_copy_file_required",
    blockers,
  );

  if (sourcePath && backupPath && samePath(sourcePath, backupPath)) {
    blockers.push("backup_must_be_distinct_from_source");
  }
  if (sourcePath && restorePath && samePath(sourcePath, restorePath)) {
    blockers.push("restore_must_be_distinct_from_source");
  }
  if (backupPath && restorePath && samePath(backupPath, restorePath)) {
    blockers.push("restore_must_be_distinct_from_backup");
  }
  if (sourcePath && !samePath(backupProof?.sourcePath, sourcePath)) {
    blockers.push("backup_source_database_mismatch");
  }
  if (sidecarPath && !samePath(backupProof?.evidencePath, sidecarPath)) {
    blockers.push("backup_sidecar_path_mismatch");
  }
  if (backupPath && !samePath(restoreProof?.source_backup, backupPath)) {
    blockers.push("restore_source_backup_mismatch");
  }
  if (backupProof?.method !== "better-sqlite3-online-backup") {
    blockers.push("online_backup_method_required");
  }
  if (backupProof?.mutationPerformed !== true) {
    blockers.push("online_backup_completion_required");
  }
  if (backupProof?.verified !== true) {
    blockers.push("backup_verified_status_required");
  }
  if (!proofChecksPass(backupProof?.verification)) {
    blockers.push("backup_proof_integrity_checks_required");
  }
  if (!proofChecksPass(restoreProof?.verification)) {
    blockers.push("restore_proof_integrity_checks_required");
  }
  if (restoreProof?.production_database_mutated !== false) {
    blockers.push("restore_rehearsal_must_not_mutate_production");
  }
  if (restoreProof?.restored_copy_opened_read_only !== true) {
    blockers.push("restore_rehearsal_read_only_required");
  }
  const backupVerifiedAtMs = verifyRecentTimestamp({
    value: backupProof?.verifiedAt,
    generatedAtMs,
    label: "backup_verification",
    blockers,
  });
  const backupCreatedAtMs = verifyRecentTimestamp({
    value: backupProof?.createdAt,
    generatedAtMs,
    label: "backup_created",
    blockers,
  });
  if (
    backupCreatedAtMs !== null &&
    backupVerifiedAtMs !== null &&
    backupCreatedAtMs > backupVerifiedAtMs
  ) {
    blockers.push("backup_creation_after_verification");
  }
  const restoreVerifiedAtMs = verifyRecentTimestamp({
    value: restoreProof?.generated_at,
    generatedAtMs,
    label: "restore_rehearsal",
    blockers,
  });
  if (
    backupVerifiedAtMs !== null &&
    restoreVerifiedAtMs !== null &&
    restoreVerifiedAtMs < backupVerifiedAtMs
  ) {
    blockers.push("restore_rehearsal_precedes_backup_verification");
  }

  let hashes = null;
  let observations = null;
  if (sourcePath && backupPath && restorePath) {
    blockers.push(...sourceSidecarBlockers(sourcePath));
    const firstHashes = {
      source: await sha256File(sourcePath),
      backup: await sha256File(backupPath),
      restore: await sha256File(restorePath),
    };
    observations = {
      source: inspectSqlite(sourcePath),
      backup: inspectSqlite(backupPath),
      restore: inspectSqlite(restorePath),
    };
    const secondHashes = {
      source: await sha256File(sourcePath),
      backup: await sha256File(backupPath),
      restore: await sha256File(restorePath),
    };
    blockers.push(...sourceSidecarBlockers(sourcePath));
    hashes = secondHashes;
    for (const role of ["source", "backup", "restore"]) {
      if (firstHashes[role] !== secondHashes[role]) {
        blockers.push(`${role}_file_changed_during_verification`);
      }
      if (!observedChecksPass(observations[role])) {
        blockers.push(`${role}_database_integrity_checks_failed`);
      }
    }
    if (
      !SHA256_PATTERN.test(String(backupProof?.sha256 || "")) ||
      backupProof.sha256.toLowerCase() !== secondHashes.backup
    ) {
      blockers.push("backup_sha256_mismatch");
    }
    if (
      !SHA256_PATTERN.test(String(restoreProof?.source_sha256 || "")) ||
      restoreProof.source_sha256.toLowerCase() !== secondHashes.backup
    ) {
      blockers.push("restore_source_sha256_mismatch");
    }
    if (
      !SHA256_PATTERN.test(String(restoreProof?.restored_sha256 || "")) ||
      restoreProof.restored_sha256.toLowerCase() !== secondHashes.restore
    ) {
      blockers.push("restored_copy_sha256_mismatch");
    }
    if (
      restoreProof?.hashes_match !== true ||
      secondHashes.backup !== secondHashes.restore
    ) {
      blockers.push("backup_restore_hash_mismatch");
    }
    if (Number(backupProof?.sizeBytes) !== fs.statSync(backupPath).size) {
      blockers.push("backup_size_mismatch");
    }
  }

  const finalBlockers = unique(blockers);
  const evidence =
    finalBlockers.length === 0
      ? {
          schema_version: CUTOVER_SCHEMA_VERSION,
          backup_id: String(backupProof.backup_id || "").trim(),
          backup_path: backupPath,
          backup_sha256: hashes.backup,
          source_database_path: sourcePath,
          source_database_sha256: hashes.source,
          verified_at: generatedAtIso,
          verified_by: operator,
          restore_test_status: "PASS",
          integrity_check: "ok",
          foreign_key_check: "ok",
          quick_check: "ok",
          restore_path: restorePath,
          restore_sha256: hashes.restore,
          backup_restore_hashes_match: true,
          production_database_mutated: false,
          verification: observations,
          provenance: {
            backup_verification_file: sidecarPath,
            backup_verification_schema: backupProof.schemaVersion,
            backup_verified_at: new Date(backupVerifiedAtMs).toISOString(),
            restore_rehearsal_file: rehearsalPath,
            restore_rehearsal_schema: restoreProof.schema_version,
            restore_verified_at: new Date(restoreVerifiedAtMs).toISOString(),
          },
        }
      : null;
  if (evidence && !evidence.backup_id) {
    finalBlockers.push("backup_id_required");
    return {
      schema_version: ATTEMPT_SCHEMA_VERSION,
      generated_at: generatedAtIso,
      verdict: "HOLD",
      blockers: finalBlockers,
      evidence: null,
      safety: safetyStatement(),
      _protected_paths: unique([
        sourcePath,
        sidecarPath,
        rehearsalPath,
        backupPath,
        restorePath,
      ]),
    };
  }
  return {
    schema_version: ATTEMPT_SCHEMA_VERSION,
    generated_at: generatedAtIso,
    verdict: evidence ? "PASS" : "HOLD",
    blockers: finalBlockers,
    evidence,
    safety: safetyStatement(),
    _protected_paths: unique([
      sourcePath,
      sidecarPath,
      rehearsalPath,
      backupPath,
      restorePath,
    ]),
  };
}

function safetyStatement() {
  return {
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    scheduled_tasks_mutated: false,
    platforms_contacted: false,
    external_objects_created: false,
  };
}

function renderMarkdown(result) {
  const lines = [
    "# Cutover Backup Evidence",
    "",
    `Generated: ${result.generated_at}`,
    `Verdict: ${result.verdict}`,
    "",
    "## Verification",
    "",
  ];
  if (result.evidence) {
    lines.push(
      `- Backup ID: ${result.evidence.backup_id}`,
      `- Source database: ${result.evidence.source_database_path}`,
      `- Backup: ${result.evidence.backup_path}`,
      `- Restored copy: ${result.evidence.restore_path}`,
      "- Source, backup and restored copy passed read-only SQLite checks",
      "- Backup and restored-copy SHA-256 hashes match",
    );
  } else {
    lines.push("- No reconciliation evidence was emitted.");
  }
  lines.push("", "## Blockers", "");
  if (result.blockers.length === 0) lines.push("- none");
  else result.blockers.forEach((blocker) => lines.push(`- ${blocker}`));
  lines.push(
    "",
    "> This command is read-only apart from its JSON and Markdown proof files. It grants no publish or cutover authority.",
    "",
  );
  return lines.join("\n");
}

function writeArtifacts({ outDir, result, protectedPaths = [] }) {
  if (!outDir) throw new Error("cutover_backup_evidence_output_required");
  const resolved = path.resolve(String(outDir));
  fs.mkdirSync(resolved, { recursive: true });
  const canonicalJson = path.join(
    resolved,
    "pulse_cutover_backup_evidence.json",
  );
  const canonicalMarkdown = path.join(
    resolved,
    "pulse_cutover_backup_evidence.md",
  );
  const attemptJson = path.join(
    resolved,
    "pulse_cutover_backup_evidence_attempt.json",
  );
  const attemptMarkdown = path.join(
    resolved,
    "pulse_cutover_backup_evidence_attempt.md",
  );
  const outputPaths = [
    canonicalJson,
    canonicalMarkdown,
    attemptJson,
    attemptMarkdown,
  ];
  const protectedInputPaths = unique([
    ...protectedPaths,
    ...(result?._protected_paths || []),
  ]);
  if (
    outputPaths.some((outputPath) =>
      protectedInputPaths.some((inputPath) => samePath(outputPath, inputPath)),
    )
  ) {
    throw new Error("cutover_backup_evidence_output_collides_with_input");
  }
  if (result.verdict === "PASS") {
    fs.rmSync(attemptJson, { force: true });
    fs.rmSync(attemptMarkdown, { force: true });
    fs.writeFileSync(
      canonicalJson,
      `${JSON.stringify(result.evidence, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(canonicalMarkdown, renderMarkdown(result), "utf8");
    return {
      evidence_json: canonicalJson,
      evidence_markdown: canonicalMarkdown,
    };
  }
  fs.rmSync(canonicalJson, { force: true });
  fs.rmSync(canonicalMarkdown, { force: true });
  const publicResult = { ...result };
  delete publicResult._protected_paths;
  fs.writeFileSync(
    attemptJson,
    `${JSON.stringify(publicResult, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(attemptMarkdown, renderMarkdown(result), "utf8");
  return { attempt_json: attemptJson, attempt_markdown: attemptMarkdown };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_value:${token.slice(2)}`);
    }
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

module.exports = {
  composeCutoverBackupEvidence,
  parseCliArgs,
  samePath,
  validateCanonicalCutoverBackupEvidenceV1,
  writeArtifacts,
};
