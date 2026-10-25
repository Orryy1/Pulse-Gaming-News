"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  validateGovernedAutonomousCandidateCompletionReceipt,
} = require("./governed-autonomous-candidate-completion-receipt");

const INDEX_SCHEMA_VERSION =
  "pulse-governed-autonomous-candidate-completion-index-v1";
const ACTOR_ID = "system:governed-autonomous-production";
const ACTION = "governed_autonomous_candidate_materialised";
const TARGET_TYPE = "governed_autonomous_candidate";
const DECISION = "RECORDED_GREEN";
const REASON =
  "Immutable GREEN production completion receipt recorded without approval, scheduler or publish authority.";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_RECEIPT_BYTES = 32 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const REQUIRED_AUDIT_COLUMNS = Object.freeze([
  "action",
  "actor_id",
  "decision",
  "evidence_json",
  "id",
  "idempotency_key",
  "reason",
  "target_id",
  "target_type",
]);
const REQUIRED_IMMUTABILITY_TRIGGERS = Object.freeze([
  "trg_operator_audit_log_immutable_delete",
  "trg_operator_audit_log_immutable_update",
]);
const EVIDENCE_FIELDS = Object.freeze([
  "candidate_revision_sha256",
  "channel_id",
  "lane_id",
  "platform",
  "receipt_ref",
  "request_fingerprint",
  "role",
  "scheduled_for",
  "schema_version",
  "story_id",
]);
const RECEIPT_REF_FIELDS = Object.freeze([
  "file_sha256",
  "path",
  "receipt_sha256",
]);

class GovernedAutonomousCandidateCompletionReceiptIndexError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousCandidateCompletionReceiptIndexError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousCandidateCompletionReceiptIndexError(
    code,
  );
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    fail(code);
  }
  return value;
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactStoryId(value) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) {
    fail("candidate_completion_index_story_id_invalid");
  }
  return storyId;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256Bytes(JSON.stringify(stableValue(value)));
}

function exactRelativePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    supplied.includes("\\") ||
    path.posix.isAbsolute(supplied) ||
    path.posix.normalize(supplied) !== supplied ||
    supplied === "." ||
    supplied === ".." ||
    supplied.startsWith("../")
  ) {
    fail(code);
  }
  return supplied;
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function trustedWorkspaceRoot(rootPath, fileSystem) {
  const supplied = text(rootPath);
  if (!supplied || !path.isAbsolute(supplied)) {
    fail("candidate_completion_index_workspace_root_invalid");
  }
  const resolved = path.resolve(supplied);
  let stat;
  try {
    stat = await fileSystem.lstat(resolved);
  } catch {
    fail("candidate_completion_index_workspace_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("candidate_completion_index_workspace_root_invalid");
  }
  const realPath = await fileSystem.realpath(resolved);
  if (path.resolve(realPath) !== resolved) {
    fail("candidate_completion_index_workspace_root_link_forbidden");
  }
  return Object.freeze({
    path: resolved,
    real_path: path.resolve(realPath),
  });
}

async function containedReceiptPath(root, relativePath, fileSystem) {
  const relative = exactRelativePath(
    relativePath,
    "candidate_completion_index_receipt_ref_invalid",
  );
  const resolved = path.resolve(
    root.path,
    ...relative.split("/"),
  );
  if (!pathWithin(root.path, resolved)) {
    fail("candidate_completion_index_receipt_outside_workspace");
  }
  const parts = path.relative(root.path, resolved).split(path.sep);
  let cursor = root.path;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor);
    } catch {
      fail("candidate_completion_index_receipt_missing");
    }
    if (stat.isSymbolicLink()) {
      fail("candidate_completion_index_receipt_link_forbidden");
    }
    const realPath = path.resolve(await fileSystem.realpath(cursor));
    if (!pathWithin(root.real_path, realPath)) {
      fail("candidate_completion_index_receipt_outside_workspace");
    }
  }
  return { relative, resolved };
}

async function readReceipt({
  workspaceRoot,
  receiptRef,
  fileSystem,
}) {
  exactFields(
    receiptRef,
    ["file_sha256", "path"],
    "candidate_completion_index_receipt_ref_invalid",
  );
  const expectedFileSha256 = exactSha256(
    receiptRef.file_sha256,
    "candidate_completion_index_receipt_ref_invalid",
  );
  const root = await trustedWorkspaceRoot(
    workspaceRoot,
    fileSystem,
  );
  const located = await containedReceiptPath(
    root,
    receiptRef.path,
    fileSystem,
  );
  const before = await fileSystem.lstat(located.resolved, {
    bigint: true,
  });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0n ||
    before.size > BigInt(MAX_RECEIPT_BYTES)
  ) {
    fail("candidate_completion_index_receipt_invalid");
  }
  const handle = await fileSystem.open(located.resolved, "r");
  let bytes;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, opened)) {
      fail("candidate_completion_index_receipt_changed_during_read");
    }
    const chunks = [];
    const chunk = Buffer.alloc(HASH_CHUNK_BYTES);
    let offset = 0n;
    while (offset < opened.size) {
      const remaining = opened.size - offset;
      const length = Number(
        remaining < BigInt(chunk.length)
          ? remaining
          : BigInt(chunk.length),
      );
      const { bytesRead } = await handle.read(
        chunk,
        0,
        length,
        Number(offset),
      );
      if (!bytesRead) break;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      offset += BigInt(bytesRead);
    }
    const completed = await handle.stat({ bigint: true });
    const after = await fileSystem.lstat(located.resolved, {
      bigint: true,
    });
    if (
      offset !== opened.size ||
      !sameFileIdentity(opened, completed) ||
      !sameFileIdentity(opened, after)
    ) {
      fail("candidate_completion_index_receipt_changed_during_read");
    }
    bytes = Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
  const fileSha256 = sha256Bytes(bytes);
  if (fileSha256 !== expectedFileSha256) {
    fail("candidate_completion_index_receipt_file_sha256_mismatch");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("candidate_completion_index_receipt_json_invalid");
  }
  let receipt;
  try {
    receipt =
      validateGovernedAutonomousCandidateCompletionReceipt(parsed);
  } catch (error) {
    fail(
      error?.code ||
        "candidate_completion_index_receipt_validation_failed",
    );
  }
  return Object.freeze({
    receipt,
    receipt_ref: Object.freeze({
      path: located.relative,
      file_sha256: fileSha256,
      receipt_sha256: receipt.receipt_sha256,
    }),
  });
}

function sameFileIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function requireAuditTable(db, { requireUniqueIndex = false } = {}) {
  if (
    !db ||
    typeof db.prepare !== "function" ||
    typeof db.transaction !== "function"
  ) {
    fail("candidate_completion_index_database_required");
  }
  let columns;
  try {
    columns = db.pragma("table_info(operator_audit_log)");
  } catch {
    fail("candidate_completion_index_audit_table_required");
  }
  const names = new Set(columns.map((column) => column.name));
  if (
    REQUIRED_AUDIT_COLUMNS.some((column) => !names.has(column))
  ) {
    fail("candidate_completion_index_audit_table_invalid");
  }
  const triggers = new Map(
    db
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger'
           AND tbl_name = 'operator_audit_log'`,
      )
      .all()
      .map((row) => [row.name, text(row.sql)]),
  );
  if (
    REQUIRED_IMMUTABILITY_TRIGGERS.some(
      (trigger) =>
        !triggers.has(trigger) ||
        !/RAISE\s*\(\s*ABORT\s*,\s*['"]immutable_operator_audit_log['"]\s*\)/i.test(
          triggers.get(trigger),
        ),
    )
  ) {
    fail("candidate_completion_index_audit_immutability_required");
  }
  if (requireUniqueIndex) {
    const indexes = db.pragma("index_list(operator_audit_log)");
    const hasUniqueIdempotencyIndex = indexes.some((index) => {
      if (index.unique !== 1) return false;
      const fields = db
        .pragma(`index_info(${JSON.stringify(index.name)})`)
        .map((field) => field.name);
      return (
        fields.length === 1 &&
        fields[0] === "idempotency_key"
      );
    });
    if (!hasUniqueIdempotencyIndex) {
      fail(
        "candidate_completion_index_audit_idempotency_unique_required",
      );
    }
  }
}

function evidenceFor(observed) {
  const receipt = observed.receipt;
  return {
    schema_version: INDEX_SCHEMA_VERSION,
    receipt_ref: observed.receipt_ref,
    story_id: receipt.story_id,
    channel_id: receipt.channel_id,
    lane_id: receipt.lane_id,
    platform: receipt.platform,
    scheduled_for: receipt.scheduled_for,
    role: receipt.role,
    candidate_revision_sha256:
      receipt.candidate_revision_sha256,
    request_fingerprint: receipt.request_fingerprint,
  };
}

function idempotencyKeyFor(evidence) {
  return (
    "governed-autonomous-candidate-materialised:v1:" +
    canonicalSha256({
      channel_id: evidence.channel_id,
      lane_id: evidence.lane_id,
      platform: evidence.platform,
      scheduled_for: evidence.scheduled_for,
      role: evidence.role,
    })
  );
}

function validateIndexedEvidence(value) {
  exactFields(
    value,
    EVIDENCE_FIELDS,
    "candidate_completion_index_evidence_fields_invalid",
  );
  if (value.schema_version !== INDEX_SCHEMA_VERSION) {
    fail("candidate_completion_index_evidence_schema_invalid");
  }
  exactFields(
    value.receipt_ref,
    RECEIPT_REF_FIELDS,
    "candidate_completion_index_receipt_ref_invalid",
  );
  const role = text(value.role).toUpperCase();
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.lane_id) !== "breaking_short" ||
    text(value.platform).toLowerCase() !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(role)
  ) {
    fail("candidate_completion_index_evidence_identity_invalid");
  }
  return {
    schema_version: INDEX_SCHEMA_VERSION,
    receipt_ref: {
      path: exactRelativePath(
        value.receipt_ref.path,
        "candidate_completion_index_receipt_ref_invalid",
      ),
      file_sha256: exactSha256(
        value.receipt_ref.file_sha256,
        "candidate_completion_index_receipt_ref_invalid",
      ),
      receipt_sha256: exactSha256(
        value.receipt_ref.receipt_sha256,
        "candidate_completion_index_receipt_ref_invalid",
      ),
    },
    story_id: exactStoryId(value.story_id),
    channel_id: text(value.channel_id),
    lane_id: text(value.lane_id),
    platform: text(value.platform).toLowerCase(),
    scheduled_for: exactTimestamp(
      value.scheduled_for,
      "candidate_completion_index_window_invalid",
    ),
    role,
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "candidate_completion_index_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "candidate_completion_index_fingerprint_invalid",
    ),
  };
}

function exactAuditMatch(row, expected) {
  return (
    row.actor_id === ACTOR_ID &&
    row.action === ACTION &&
    row.target_type === TARGET_TYPE &&
    row.target_id === expected.evidence.story_id &&
    row.decision === DECISION &&
    row.reason === REASON &&
    row.evidence_json === expected.evidenceJson &&
    row.idempotency_key === expected.idempotencyKey
  );
}

async function indexGovernedAutonomousCandidateCompletionReceipt(
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const observed = await readReceipt({
    workspaceRoot: options.workspaceRoot,
    receiptRef: options.receiptRef,
    fileSystem,
  });
  requireAuditTable(options.db, { requireUniqueIndex: true });
  const evidence = evidenceFor(observed);
  const evidenceJson = JSON.stringify(evidence);
  const idempotencyKey = idempotencyKeyFor(evidence);
  const expected = { evidence, evidenceJson, idempotencyKey };
  const apply = options.db.transaction(() => {
    const existing = options.db
      .prepare(
        `SELECT *
         FROM operator_audit_log
         WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey);
    if (existing) {
      if (!exactAuditMatch(existing, expected)) {
        fail("candidate_completion_index_conflicting_replay");
      }
      return { status: "REPLAYED", row: existing };
    }
    options.db
      .prepare(
        `INSERT INTO operator_audit_log
           (actor_id, action, target_type, target_id, decision,
            reason, evidence_json, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ACTOR_ID,
        ACTION,
        TARGET_TYPE,
        evidence.story_id,
        DECISION,
        REASON,
        evidenceJson,
        idempotencyKey,
      );
    const inserted = options.db
      .prepare(
        `SELECT *
         FROM operator_audit_log
         WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey);
    if (!inserted || !exactAuditMatch(inserted, expected)) {
      fail("candidate_completion_index_insert_verification_failed");
    }
    return { status: "INDEXED", row: inserted };
  });
  const applied =
    typeof apply.immediate === "function"
      ? apply.immediate()
      : apply();
  return Object.freeze({
    status: applied.status,
    audit_id: applied.row.id,
    idempotency_key: idempotencyKey,
    evidence,
    receipt: observed.receipt,
  });
}

function exactWindowRequest(options) {
  const channelId = text(options.channelId);
  const laneId = text(options.laneId);
  const platform = text(options.platform).toLowerCase();
  if (
    channelId !== "pulse-gaming" ||
    laneId !== "breaking_short" ||
    platform !== "youtube"
  ) {
    fail("candidate_completion_index_window_identity_invalid");
  }
  return {
    channel_id: channelId,
    lane_id: laneId,
    platform,
    scheduled_for: exactTimestamp(
      options.scheduledFor,
      "candidate_completion_index_window_invalid",
    ),
  };
}

function validateGovernedAutonomousCandidateCompletionAuditRow(
  row,
) {
  if (!plainObject(row)) {
    fail("candidate_completion_index_audit_row_invalid");
  }
  if (
    row.actor_id !== ACTOR_ID ||
    row.action !== ACTION ||
    row.target_type !== TARGET_TYPE ||
    row.decision !== DECISION
  ) {
    fail("candidate_completion_index_audit_identity_invalid");
  }
  if (typeof row.evidence_json !== "string") {
    fail("candidate_completion_index_evidence_json_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(row.evidence_json);
  } catch {
    fail("candidate_completion_index_evidence_json_invalid");
  }
  const evidence = validateIndexedEvidence(parsed);
  if (row.evidence_json !== JSON.stringify(evidence)) {
    fail("candidate_completion_index_evidence_json_noncanonical");
  }
  if (row.target_id !== evidence.story_id) {
    fail("candidate_completion_index_audit_target_mismatch");
  }
  if (row.reason !== REASON) {
    fail("candidate_completion_index_audit_reason_mismatch");
  }
  if (row.idempotency_key !== idempotencyKeyFor(evidence)) {
    fail("candidate_completion_index_audit_idempotency_mismatch");
  }
  return evidence;
}

function assertReceiptBindings(receipt, evidence) {
  if (receipt.receipt_sha256 !== evidence.receipt_ref.receipt_sha256) {
    fail("candidate_completion_index_receipt_sha256_drift");
  }
  const fields = [
    "story_id",
    "channel_id",
    "lane_id",
    "platform",
    "scheduled_for",
    "role",
    "candidate_revision_sha256",
    "request_fingerprint",
  ];
  for (const field of fields) {
    if (receipt[field] !== evidence[field]) {
      if (field === "scheduled_for") {
        fail("candidate_completion_index_cross_window_receipt");
      }
      if (field === "role") {
        fail("candidate_completion_index_cross_role_receipt");
      }
      fail(`candidate_completion_index_receipt_${field}_drift`);
    }
  }
}

async function loadGovernedAutonomousWindowCompletionReceipts(
  options = {},
) {
  requireAuditTable(options.db);
  const requested = exactWindowRequest(options);
  const fileSystem = options.fileSystem || defaultFileSystem;
  const rows = options.db
    .prepare(
      `SELECT *
       FROM operator_audit_log
       WHERE actor_id = ?
         AND action = ?
         AND target_type = ?
         AND decision = ?
       ORDER BY id`,
    )
    .all(ACTOR_ID, ACTION, TARGET_TYPE, DECISION);
  const matched = [];
  for (const row of rows) {
    const evidence =
      validateGovernedAutonomousCandidateCompletionAuditRow(row);
    if (
      evidence.channel_id !== requested.channel_id ||
      evidence.lane_id !== requested.lane_id ||
      evidence.platform !== requested.platform ||
      evidence.scheduled_for !== requested.scheduled_for
    ) {
      continue;
    }
    const observed = await readReceipt({
      workspaceRoot: options.workspaceRoot,
      receiptRef: {
        path: evidence.receipt_ref.path,
        file_sha256: evidence.receipt_ref.file_sha256,
      },
      fileSystem,
    });
    assertReceiptBindings(observed.receipt, evidence);
    matched.push({
      audit_id: row.id,
      idempotency_key: row.idempotency_key,
      evidence,
      receipt: observed.receipt,
    });
  }
  const primary = matched.filter(
    (entry) => entry.evidence.role === "PRIMARY",
  );
  const standby = matched.filter(
    (entry) => entry.evidence.role === "STANDBY",
  );
  if (primary.length === 0) {
    fail("candidate_completion_index_primary_missing");
  }
  if (standby.length === 0) {
    fail("candidate_completion_index_standby_missing");
  }
  if (primary.length !== 1) {
    fail("candidate_completion_index_primary_duplicate");
  }
  if (standby.length !== 1) {
    fail("candidate_completion_index_standby_duplicate");
  }
  if (primary[0].receipt.story_id === standby[0].receipt.story_id) {
    fail("candidate_completion_index_roles_not_distinct");
  }
  return Object.freeze({
    source: "operator_audit_log",
    channel_id: requested.channel_id,
    lane_id: requested.lane_id,
    platform: requested.platform,
    scheduled_for: requested.scheduled_for,
    audit_row_count: matched.length,
    primary: Object.freeze(primary[0]),
    standby: Object.freeze(standby[0]),
  });
}

module.exports = {
  ACTION,
  ACTOR_ID,
  DECISION,
  GovernedAutonomousCandidateCompletionReceiptIndexError,
  INDEX_SCHEMA_VERSION,
  TARGET_TYPE,
  indexGovernedAutonomousCandidateCompletionReceipt,
  loadGovernedAutonomousWindowCompletionReceipts,
  validateGovernedAutonomousCandidateCompletionAuditRow,
};
