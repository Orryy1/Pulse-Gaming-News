"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-candidate-completion-receipt-request-v1";
const RECEIPT_SCHEMA_VERSION =
  "pulse-governed-autonomous-candidate-completion-receipt-v1";
const COORDINATOR_RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-result-v1";
const STAGING_RESULT_SCHEMA_VERSION =
  "pulse-autonomous-official-candidate-staging-result-v3";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;

const REQUEST_FIELDS = Object.freeze([
  "candidate_revision_sha256",
  "channel_id",
  "coordinator_result_ref",
  "generated_at",
  "lane_id",
  "mode",
  "output_path",
  "platform",
  "request_fingerprint",
  "role",
  "scheduled_for",
  "schema_version",
  "story_id",
  "workspace_root",
]);
const REFERENCE_FIELDS = Object.freeze([
  "canonical_sha256",
  "file_sha256",
  "path",
]);
const FINAL_MP4_REFERENCE_FIELDS = Object.freeze([
  "file_sha256",
  "path",
]);
const COORDINATOR_RESULT_FIELDS = Object.freeze([
  "blockers",
  "composite",
  "green_supplement",
  "intake",
  "mode",
  "narration",
  "programme",
  "publication_metadata",
  "safety",
  "schema_version",
  "staging",
  "story_id",
  "verdict",
  "visual_gate_decision",
  "visual_qa",
]);
const COORDINATOR_SAFETY_FIELDS = Object.freeze([
  "database_mutated",
  "external_publish_authorised",
  "narration_network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
]);
const GREEN_SAFETY_FIELDS = Object.freeze([
  "database_authority",
  "local_proof_only",
  "network_authority",
  "network_used",
  "oauth_or_token_authority",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
]);
const STAGING_SAFETY_FIELDS = Object.freeze([
  "database_mutated",
  "external_publish_authorised",
  "local_proof_only",
  "network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
]);
const STAGING_RESULT_FIELDS = Object.freeze([
  "blockers",
  "candidate_workspace_relative_root",
  "channel_id",
  "copied_artifact_count",
  "generated_at",
  "lane_id",
  "mode",
  "monetisation_scope",
  "platform",
  "preparation_manifest",
  "preparation_manifest_path",
  "preparation_sha256",
  "result_path",
  "result_sha256",
  "rights_evidence",
  "rights_evidence_path",
  "rights_ledger",
  "rights_ledger_path",
  "rights_ledger_sha256",
  "role",
  "safety",
  "schema_version",
  "scheduled_for",
  "story_id",
  "summary_path",
  "verdict",
  "workspace_root",
]);
const STAGING_PROOF_FIELDS = Object.freeze([
  "blockers",
  "candidate_workspace_relative_root",
  "channel_id",
  "copied_artifact_count",
  "generated_at",
  "lane_id",
  "mode",
  "monetisation_scope",
  "platform",
  "preparation_manifest",
  "preparation_sha256",
  "result_sha256",
  "rights_evidence",
  "rights_ledger",
  "rights_ledger_sha256",
  "role",
  "safety",
  "schema_version",
  "scheduled_for",
  "story_id",
  "verdict",
  "workspace_root",
]);
const STAGING_PREPARATION_REFERENCE_FIELDS = Object.freeze([
  "path",
  "sha256",
]);
const RECEIPT_FIELDS = Object.freeze([
  "blockers",
  "candidate_revision_sha256",
  "channel_id",
  "coordinator_result",
  "final_mp4",
  "generated_at",
  "lane_id",
  "mode",
  "platform",
  "preparation_manifest",
  "receipt_sha256",
  "request_fingerprint",
  "role",
  "safety",
  "scheduled_for",
  "schema_version",
  "staging_result",
  "story_id",
  "verdict",
]);
const RECEIPT_SAFETY_FIELDS = Object.freeze([
  "database_mutated",
  "external_publish_authorised",
  "local_proof_only",
  "network_used",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
]);
const FORBIDDEN_TRUE_FIELDS = new Set([
  "database_authority",
  "database_mutated",
  "external_publish_authorised",
  "mutation_authority",
  "network_authority",
  "oauth_or_token_authority",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "publish_authority_created",
  "scheduler_authority",
]);

class GovernedAutonomousCandidateCompletionReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousCandidateCompletionReceiptError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousCandidateCompletionReceiptError(code);
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
  const fields = [...expected].sort();
  if (
    actual.length !== fields.length ||
    actual.some((field, index) => field !== fields[index])
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
  return { raw, timestamp };
}

function exactStoryId(value) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) {
    fail("candidate_completion_story_id_invalid");
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
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function sameIdentity(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function exactWorkspaceRoot(rootPath, fileSystem) {
  const supplied = text(rootPath);
  if (!supplied || !path.isAbsolute(supplied)) {
    fail("candidate_completion_workspace_root_invalid");
  }
  const resolved = path.resolve(supplied);
  let stat;
  try {
    stat = await fileSystem.lstat(resolved, { bigint: true });
  } catch {
    fail("candidate_completion_workspace_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("candidate_completion_workspace_root_invalid");
  }
  const realPath = await fileSystem.realpath(resolved);
  if (path.resolve(realPath) !== resolved) {
    fail("candidate_completion_workspace_root_link_forbidden");
  }
  return Object.freeze({ path: resolved, real_path: realPath });
}

async function assertContainedComponents(
  root,
  candidate,
  {
    fileSystem,
    allowMissingLeaf = false,
    code,
  },
) {
  if (!pathWithin(root.path, candidate)) fail(code);
  const relative = path.relative(root.path, candidate);
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = root.path;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor, { bigint: true });
    } catch (error) {
      if (
        allowMissingLeaf &&
        error?.code === "ENOENT" &&
        index === parts.length - 1
      ) {
        return;
      }
      fail(code);
    }
    if (stat.isSymbolicLink()) fail(code);
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, realPath)) fail(code);
  }
}

async function assertExistingAncestorChain(
  root,
  candidate,
  { fileSystem, code },
) {
  if (!pathWithin(root.path, candidate)) fail(code);
  const relative = path.relative(root.path, candidate);
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = root.path;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      fail(code);
    }
    if (stat.isSymbolicLink()) fail(code);
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, realPath)) fail(code);
  }
}

function resolveRelative(root, relativePath, code) {
  const relative = exactRelativePath(relativePath, code);
  const resolved = path.resolve(
    root.path,
    ...relative.split("/"),
  );
  if (!pathWithin(root.path, resolved)) fail(code);
  return resolved;
}

function relativeFromRoot(root, absolutePath, code) {
  const supplied = text(absolutePath);
  if (!supplied || !path.isAbsolute(supplied)) fail(code);
  const resolved = path.resolve(supplied);
  if (!pathWithin(root.path, resolved)) fail(code);
  return path.relative(root.path, resolved).split(path.sep).join("/");
}

async function readStableFile({
  root,
  filePath,
  fileSystem,
  code,
  maximumBytes = null,
  collectBytes = false,
}) {
  await assertContainedComponents(root, filePath, {
    fileSystem,
    code,
  });
  const initial = await fileSystem.lstat(filePath, { bigint: true });
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER) ||
    (maximumBytes !== null &&
      initial.size > BigInt(maximumBytes))
  ) {
    fail(code);
  }
  const handle = await fileSystem.open(filePath, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      fail("candidate_completion_file_changed_during_read");
    }
    const hash = crypto.createHash("sha256");
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
      const bytes = Buffer.from(chunk.subarray(0, bytesRead));
      hash.update(bytes);
      if (collectBytes) chunks.push(bytes);
      offset += BigInt(bytesRead);
    }
    const completed = await handle.stat({ bigint: true });
    const finalPathStat = await fileSystem.lstat(filePath, {
      bigint: true,
    });
    if (
      offset !== opened.size ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalPathStat)
    ) {
      fail("candidate_completion_file_changed_during_read");
    }
    return {
      file_sha256: hash.digest("hex"),
      bytes: collectBytes ? Buffer.concat(chunks) : null,
    };
  } finally {
    await handle.close();
  }
}

async function readJsonReference({
  root,
  relativePath,
  expectedFileSha256,
  fileSystem,
  code,
}) {
  const resolvedPath = resolveRelative(root, relativePath, code);
  const observed = await readStableFile({
    root,
    filePath: resolvedPath,
    fileSystem,
    code,
    maximumBytes: MAX_JSON_BYTES,
    collectBytes: true,
  });
  if (observed.file_sha256 !== expectedFileSha256) {
    fail(`${code}_sha256_mismatch`);
  }
  let value;
  try {
    value = JSON.parse(observed.bytes.toString("utf8"));
  } catch {
    fail(`${code}_json_invalid`);
  }
  return {
    path: relativePath,
    resolved_path: resolvedPath,
    file_sha256: observed.file_sha256,
    value,
  };
}

async function readJsonFile({
  root,
  relativePath,
  fileSystem,
  code,
}) {
  const resolvedPath = resolveRelative(root, relativePath, code);
  const observed = await readStableFile({
    root,
    filePath: resolvedPath,
    fileSystem,
    code,
    maximumBytes: MAX_JSON_BYTES,
    collectBytes: true,
  });
  let value;
  try {
    value = JSON.parse(observed.bytes.toString("utf8"));
  } catch {
    fail(`${code}_json_invalid`);
  }
  return {
    path: relativePath,
    resolved_path: resolvedPath,
    file_sha256: observed.file_sha256,
    value,
  };
}

function assertFalseFlags(value, fields, code) {
  exactFields(value, fields, code);
  for (const field of fields) {
    if (field === "local_proof_only") {
      if (value[field] !== true) fail(code);
    } else if (field === "narration_network_used") {
      if (typeof value[field] !== "boolean") fail(code);
    } else if (value[field] !== false) {
      fail(`candidate_completion_${field}_forbidden`);
    }
  }
}

function assertNoSmuggledAuthority(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSmuggledAuthority(entry);
    return;
  }
  for (const [field, entry] of Object.entries(value)) {
    if (FORBIDDEN_TRUE_FIELDS.has(field) && entry !== false) {
      fail(`candidate_completion_${field}_forbidden`);
    }
    assertNoSmuggledAuthority(entry);
  }
}

function exactReference(value, code) {
  exactFields(value, REFERENCE_FIELDS, code);
  return {
    path: exactRelativePath(value.path, code),
    file_sha256: exactSha256(value.file_sha256, code),
    canonical_sha256: exactSha256(
      value.canonical_sha256,
      code,
    ),
  };
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "candidate_completion_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("candidate_completion_local_proof_only");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "candidate_completion_generated_at_invalid",
  );
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "candidate_completion_scheduled_for_invalid",
  );
  if (generatedAt.timestamp >= scheduledFor.timestamp) {
    fail("candidate_completion_window_expired");
  }
  const channelId = text(value.channel_id);
  const laneId = text(value.lane_id);
  const platform = text(value.platform).toLowerCase();
  const role = text(value.role).toUpperCase();
  if (
    channelId !== "pulse-gaming" ||
    laneId !== "breaking_short" ||
    platform !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(role)
  ) {
    fail("candidate_completion_identity_invalid");
  }
  const workspaceRoot = text(value.workspace_root);
  const outputPath = text(value.output_path);
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    fail("candidate_completion_workspace_root_invalid");
  }
  if (!outputPath || !path.isAbsolute(outputPath)) {
    fail("candidate_completion_output_path_invalid");
  }
  return {
    generated_at: generatedAt.raw,
    scheduled_for: scheduledFor.raw,
    workspace_root: path.resolve(workspaceRoot),
    output_path: path.resolve(outputPath),
    story_id: exactStoryId(value.story_id),
    channel_id: channelId,
    lane_id: laneId,
    platform,
    role,
    candidate_revision_sha256: exactSha256(
      value.candidate_revision_sha256,
      "candidate_completion_revision_invalid",
    ),
    request_fingerprint: exactSha256(
      value.request_fingerprint,
      "candidate_completion_fingerprint_invalid",
    ),
    coordinator_result_ref: exactReference(
      value.coordinator_result_ref,
      "candidate_completion_coordinator_ref_invalid",
    ),
  };
}

function assertIdentity(actual, request, code) {
  for (const field of [
    "story_id",
    "channel_id",
    "lane_id",
    "platform",
    "scheduled_for",
    "role",
  ]) {
    const observed =
      field === "role"
        ? text(actual[field]).toUpperCase()
        : field === "platform"
          ? text(actual[field]).toLowerCase()
          : text(actual[field]);
    if (observed !== request[field]) fail(code);
  }
}

function validateReceiptSafety(value) {
  assertFalseFlags(
    value,
    RECEIPT_SAFETY_FIELDS,
    "candidate_completion_receipt_safety_invalid",
  );
}

function validateGovernedAutonomousCandidateCompletionReceipt(
  value,
) {
  exactFields(
    value,
    RECEIPT_FIELDS,
    "candidate_completion_receipt_fields_invalid",
  );
  const suppliedSha256 = exactSha256(
    value.receipt_sha256,
    "candidate_completion_receipt_sha256_invalid",
  );
  const body = { ...value };
  delete body.receipt_sha256;
  if (canonicalSha256(body) !== suppliedSha256) {
    fail("candidate_completion_receipt_sha256_mismatch");
  }
  if (
    value.schema_version !== RECEIPT_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.verdict !== "GREEN" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0
  ) {
    fail("candidate_completion_receipt_not_green");
  }
  exactTimestamp(
    value.generated_at,
    "candidate_completion_receipt_generated_at_invalid",
  );
  exactTimestamp(
    value.scheduled_for,
    "candidate_completion_receipt_window_invalid",
  );
  exactStoryId(value.story_id);
  if (
    value.channel_id !== "pulse-gaming" ||
    value.lane_id !== "breaking_short" ||
    value.platform !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(value.role)
  ) {
    fail("candidate_completion_receipt_identity_invalid");
  }
  exactSha256(
    value.candidate_revision_sha256,
    "candidate_completion_receipt_revision_invalid",
  );
  exactSha256(
    value.request_fingerprint,
    "candidate_completion_receipt_fingerprint_invalid",
  );
  exactReference(
    value.coordinator_result,
    "candidate_completion_receipt_coordinator_ref_invalid",
  );
  exactReference(
    value.staging_result,
    "candidate_completion_receipt_staging_ref_invalid",
  );
  exactReference(
    value.preparation_manifest,
    "candidate_completion_receipt_preparation_ref_invalid",
  );
  exactFields(
    value.final_mp4,
    FINAL_MP4_REFERENCE_FIELDS,
    "candidate_completion_receipt_final_mp4_ref_invalid",
  );
  exactRelativePath(
    value.final_mp4.path,
    "candidate_completion_receipt_final_mp4_ref_invalid",
  );
  exactSha256(
    value.final_mp4.file_sha256,
    "candidate_completion_receipt_final_mp4_ref_invalid",
  );
  validateReceiptSafety(value.safety);
  assertNoSmuggledAuthority(value);
  return JSON.parse(JSON.stringify(value));
}

async function writeIdempotently({
  root,
  outputPath,
  bytes,
  fileSystem,
}) {
  async function readExisting() {
    try {
      await fileSystem.lstat(outputPath, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    return (
      await readStableFile({
        root,
        filePath: outputPath,
        fileSystem,
        code: "candidate_completion_existing_receipt_invalid",
        maximumBytes: MAX_JSON_BYTES,
        collectBytes: true,
      })
    ).bytes;
  }
  try {
    const existing = await readExisting();
    if (existing === null) throw Object.assign(new Error(), {
      code: "ENOENT",
    });
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("candidate_completion_receipt_conflict");
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousCandidateCompletionReceiptError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  let handle;
  try {
    handle = await fileSystem.open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await readExisting();
      if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
      fail("candidate_completion_receipt_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materialiseGovernedAutonomousCandidateCompletionReceipt(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const request = normaliseRequest(value);
  const root = await exactWorkspaceRoot(
    request.workspace_root,
    fileSystem,
  );
  if (!pathWithin(root.path, request.output_path)) {
    fail("candidate_completion_output_outside_workspace");
  }
  const outputParent = path.dirname(request.output_path);
  await assertExistingAncestorChain(root, outputParent, {
    fileSystem,
    code: "candidate_completion_output_parent_invalid",
  });
  await fileSystem.mkdir(outputParent, { recursive: true });
  await assertContainedComponents(root, outputParent, {
    fileSystem,
    code: "candidate_completion_output_parent_invalid",
  });
  await assertContainedComponents(root, request.output_path, {
    fileSystem,
    allowMissingLeaf: true,
    code: "candidate_completion_output_path_invalid",
  });

  const coordinatorFile = await readJsonReference({
    root,
    relativePath: request.coordinator_result_ref.path,
    expectedFileSha256:
      request.coordinator_result_ref.file_sha256,
    fileSystem,
    code: "candidate_completion_coordinator_result_invalid",
  });
  if (
    canonicalSha256(coordinatorFile.value) !==
    request.coordinator_result_ref.canonical_sha256
  ) {
    fail("candidate_completion_coordinator_canonical_mismatch");
  }
  const coordinator = exactFields(
    coordinatorFile.value,
    COORDINATOR_RESULT_FIELDS,
    "candidate_completion_coordinator_fields_invalid",
  );
  if (
    coordinator.schema_version !==
      COORDINATOR_RESULT_SCHEMA_VERSION ||
    coordinator.mode !== MODE ||
    coordinator.verdict !== "GREEN" ||
    !Array.isArray(coordinator.blockers) ||
    coordinator.blockers.length !== 0 ||
    coordinator.story_id !== request.story_id
  ) {
    fail("candidate_completion_coordinator_not_green");
  }
  assertFalseFlags(
    coordinator.safety,
    COORDINATOR_SAFETY_FIELDS,
    "candidate_completion_coordinator_safety_invalid",
  );
  const green = coordinator.green_supplement;
  if (
    !plainObject(green) ||
    green.verdict !== "GREEN" ||
    green.authority_scope !==
      "LOCAL_PROOF_EVIDENCE_ONLY" ||
    green.story_id !== request.story_id ||
    green.channel_id !== request.channel_id ||
    green.lane_id !== request.lane_id ||
    text(green.platform).toLowerCase() !== request.platform
  ) {
    fail("candidate_completion_green_supplement_invalid");
  }
  assertFalseFlags(
    green.safety,
    GREEN_SAFETY_FIELDS,
    "candidate_completion_green_safety_invalid",
  );
  const composite = coordinator.composite;
  if (
    !plainObject(composite) ||
    composite.schema_version !==
      "pulse-governed-final-composite-result-v1" ||
    composite.mode !== MODE ||
    composite.verdict !== "MATERIALIZED_LOCAL_PROOF" ||
    composite.mutated !== true ||
    composite.story_id !== request.story_id ||
    composite.channel_id !== request.channel_id ||
    composite.publish_authorised !== false ||
    composite.database_mutated !== false ||
    composite.oauth_or_tokens_mutated !== false ||
    composite.live_publish_attempted !== false ||
    composite.network_used !== false
  ) {
    fail("candidate_completion_final_composite_invalid");
  }

  const staging = exactFields(
    coordinator.staging,
    STAGING_RESULT_FIELDS,
    "candidate_completion_staging_fields_invalid",
  );
  if (
    staging.schema_version !== STAGING_RESULT_SCHEMA_VERSION ||
    staging.mode !== MODE ||
    staging.verdict !== "GREEN" ||
    !Array.isArray(staging.blockers) ||
    staging.blockers.length !== 0
  ) {
    fail("candidate_completion_staging_not_green");
  }
  assertIdentity(
    staging,
    request,
    "candidate_completion_staging_identity_mismatch",
  );
  const stagingGeneratedAt = exactTimestamp(
    staging.generated_at,
    "candidate_completion_staging_generated_at_invalid",
  );
  if (
    stagingGeneratedAt.timestamp >
    Date.parse(request.generated_at)
  ) {
    fail("candidate_completion_evidence_from_future");
  }
  if (path.resolve(staging.workspace_root) !== root.path) {
    fail("candidate_completion_staging_workspace_mismatch");
  }
  assertFalseFlags(
    staging.safety,
    STAGING_SAFETY_FIELDS,
    "candidate_completion_staging_safety_invalid",
  );
  assertNoSmuggledAuthority(coordinator);

  const stagingRelativePath = relativeFromRoot(
    root,
    staging.result_path,
    "candidate_completion_staging_result_outside_workspace",
  );
  const stagingFile = await readJsonFile({
    root,
    relativePath: stagingRelativePath,
    fileSystem,
    code: "candidate_completion_staging_result_invalid",
  });
  const stagingProof = exactFields(
    stagingFile.value,
    STAGING_PROOF_FIELDS,
    "candidate_completion_staging_proof_fields_invalid",
  );
  const stagingProofBody = { ...stagingProof };
  delete stagingProofBody.result_sha256;
  const stagingCanonicalSha256 = exactSha256(
    stagingProof.result_sha256,
    "candidate_completion_staging_result_sha256_invalid",
  );
  if (
    canonicalSha256(stagingProofBody) !==
      stagingCanonicalSha256 ||
    stagingCanonicalSha256 !== staging.result_sha256
  ) {
    fail("candidate_completion_staging_result_binding_mismatch");
  }
  if (
    stagingProof.schema_version !==
      STAGING_RESULT_SCHEMA_VERSION ||
    stagingProof.mode !== MODE ||
    stagingProof.verdict !== "GREEN" ||
    !Array.isArray(stagingProof.blockers) ||
    stagingProof.blockers.length !== 0
  ) {
    fail("candidate_completion_staging_result_not_green");
  }
  assertIdentity(
    stagingProof,
    request,
    "candidate_completion_staging_proof_identity_mismatch",
  );
  if (stagingProof.generated_at !== stagingGeneratedAt.raw) {
    fail("candidate_completion_staging_result_binding_mismatch");
  }
  assertFalseFlags(
    stagingProof.safety,
    STAGING_SAFETY_FIELDS,
    "candidate_completion_staging_proof_safety_invalid",
  );
  exactFields(
    stagingProof.preparation_manifest,
    STAGING_PREPARATION_REFERENCE_FIELDS,
    "candidate_completion_preparation_ref_invalid",
  );

  const preparationRelativePath = relativeFromRoot(
    root,
    staging.preparation_manifest_path,
    "candidate_completion_preparation_outside_workspace",
  );
  if (
    preparationRelativePath !==
    exactRelativePath(
      stagingProof.preparation_manifest.path,
      "candidate_completion_preparation_ref_invalid",
    )
  ) {
    fail("candidate_completion_preparation_path_mismatch");
  }
  const preparationFile = await readJsonReference({
    root,
    relativePath: preparationRelativePath,
    expectedFileSha256: exactSha256(
      stagingProof.preparation_manifest.sha256,
      "candidate_completion_preparation_file_sha256_invalid",
    ),
    fileSystem,
    code: "candidate_completion_preparation_invalid",
  });
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(
      preparationFile.value,
    );
  if (
    canonicalSha256(staging.preparation_manifest) !==
      canonicalSha256(preparation) ||
    preparation.preparation_sha256 !==
      exactSha256(
        staging.preparation_sha256,
        "candidate_completion_preparation_sha256_invalid",
      ) ||
    preparation.preparation_sha256 !==
      exactSha256(
        stagingProof.preparation_sha256,
        "candidate_completion_preparation_sha256_invalid",
      )
  ) {
    fail("candidate_completion_preparation_binding_mismatch");
  }
  assertIdentity(
    preparation,
    request,
    "candidate_completion_preparation_identity_mismatch",
  );
  if (
    preparation.candidate_revision_sha256 !==
      request.candidate_revision_sha256 ||
    preparation.request_fingerprint !==
      request.request_fingerprint
  ) {
    fail("candidate_completion_candidate_binding_mismatch");
  }

  const finalMp4RelativePath = exactRelativePath(
    preparation.artifacts?.final_mp4?.path,
    "candidate_completion_final_mp4_ref_invalid",
  );
  const compositeFinalMp4RelativePath = relativeFromRoot(
    root,
    composite.final_mp4_path,
    "candidate_completion_final_composite_binding_mismatch",
  );
  if (
    compositeFinalMp4RelativePath !== finalMp4RelativePath ||
    exactSha256(
      composite.media_sha256,
      "candidate_completion_final_composite_binding_mismatch",
    ) !==
      exactSha256(
        preparation.artifacts.final_mp4.sha256,
        "candidate_completion_final_composite_binding_mismatch",
      )
  ) {
    fail("candidate_completion_final_composite_binding_mismatch");
  }
  const finalMp4Path = resolveRelative(
    root,
    finalMp4RelativePath,
    "candidate_completion_final_mp4_ref_invalid",
  );
  const finalMp4 = await readStableFile({
    root,
    filePath: finalMp4Path,
    fileSystem,
    code: "candidate_completion_final_mp4_invalid",
  });
  const expectedFinalMp4Sha256 = exactSha256(
    preparation.artifacts.final_mp4.sha256,
    "candidate_completion_final_mp4_sha256_invalid",
  );
  if (finalMp4.file_sha256 !== expectedFinalMp4Sha256) {
    fail("candidate_completion_final_mp4_sha256_mismatch");
  }

  const body = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    mode: MODE,
    verdict: "GREEN",
    blockers: [],
    generated_at: request.generated_at,
    story_id: request.story_id,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    platform: request.platform,
    scheduled_for: request.scheduled_for,
    role: request.role,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    request_fingerprint: request.request_fingerprint,
    coordinator_result: request.coordinator_result_ref,
    staging_result: {
      path: stagingRelativePath,
      file_sha256: stagingFile.file_sha256,
      canonical_sha256: stagingCanonicalSha256,
    },
    preparation_manifest: {
      path: preparationRelativePath,
      file_sha256: preparationFile.file_sha256,
      canonical_sha256: preparation.preparation_sha256,
    },
    final_mp4: {
      path: finalMp4RelativePath,
      file_sha256: finalMp4.file_sha256,
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      network_used: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  const receipt =
    validateGovernedAutonomousCandidateCompletionReceipt({
      ...body,
      receipt_sha256: canonicalSha256(body),
    });
  const bytes = jsonBytes(receipt);
  const status = await writeIdempotently({
    root,
    outputPath: request.output_path,
    bytes,
    fileSystem,
  });
  return Object.freeze({
    status,
    path: request.output_path,
    file_sha256: sha256Bytes(bytes),
    receipt,
    safety: receipt.safety,
  });
}

module.exports = {
  GovernedAutonomousCandidateCompletionReceiptError,
  MODE,
  RECEIPT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materialiseGovernedAutonomousCandidateCompletionReceipt,
  validateGovernedAutonomousCandidateCompletionReceipt,
};
