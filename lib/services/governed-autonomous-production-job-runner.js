"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  validateGovernedAutonomousProductionRequestBuild,
} = require("./governed-autonomous-production-request-builder");
const {
  REQUEST_SCHEMA_VERSION:
    COMPLETION_RECEIPT_REQUEST_SCHEMA_VERSION,
  validateGovernedAutonomousCandidateCompletionReceipt,
} = require("./governed-autonomous-candidate-completion-receipt");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-job-runner-request-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-job-runner-result-v1";
const COORDINATOR_RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-production-result-v1";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const REQUEST_FIELDS = Object.freeze([
  "builder_result",
  "completion_receipt_output_path",
  "coordinator_result_output_path",
  "mode",
  "schema_version",
  "workspace_root",
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
const FORBIDDEN_TRUE_FIELDS = new Set([
  "auto_publish",
  "database_authority",
  "database_mutated",
  "external_publish_authorised",
  "live_publish_attempted",
  "mutation_authority",
  "network_authority",
  "oauth_authority",
  "oauth_or_token_authority",
  "oauth_or_tokens_mutated",
  "platform_authority",
  "platform_contacted",
  "platform_posting_authorised",
  "publish_authorised",
  "publish_authority",
  "publish_authority_created",
  "publish_now",
  "scheduler_authority",
  "upload_authority",
]);

class GovernedAutonomousProductionJobRunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedAutonomousProductionJobRunnerError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousProductionJobRunnerError(code);
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

function canonicalJsonBytes(value) {
  return Buffer.from(
    `${JSON.stringify(stableValue(value), null, 2)}\n`,
    "utf8",
  );
}

function exactAbsolutePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
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

function relativeFromRoot(root, candidate, code) {
  if (!pathWithin(root.path, candidate)) fail(code);
  const relative = path.relative(root.path, candidate);
  if (!relative || relative === ".") fail(code);
  return relative.split(path.sep).join("/");
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

async function exactWorkspaceRoot(rootPath, fileSystem) {
  const resolved = exactAbsolutePath(
    rootPath,
    "autonomous_production_job_workspace_root_invalid",
  );
  let stat;
  try {
    stat = await fileSystem.lstat(resolved);
  } catch {
    fail("autonomous_production_job_workspace_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_production_job_workspace_root_invalid");
  }
  const real = path.resolve(await fileSystem.realpath(resolved));
  if (real !== resolved) {
    fail("autonomous_production_job_workspace_root_link_forbidden");
  }
  return Object.freeze({ path: resolved, real_path: real });
}

async function inspectContainedPath(
  root,
  filePath,
  fileSystem,
  { allowMissingLeaf = true } = {},
) {
  if (!pathWithin(root.path, filePath)) {
    fail("autonomous_production_job_output_outside_workspace");
  }
  const parts = path.relative(root.path, filePath).split(path.sep);
  let cursor = root.path;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor);
    } catch (error) {
      if (
        error?.code === "ENOENT" &&
        (allowMissingLeaf || index < parts.length - 1)
      ) {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      fail("autonomous_production_job_output_link_forbidden");
    }
    const real = path.resolve(await fileSystem.realpath(cursor));
    if (!pathWithin(root.real_path, real)) {
      fail("autonomous_production_job_output_outside_workspace");
    }
    if (
      index < parts.length - 1 &&
      !stat.isDirectory()
    ) {
      fail("autonomous_production_job_output_ancestor_invalid");
    }
  }
}

async function validateOutputPath(
  root,
  supplied,
  code,
  fileSystem,
) {
  const outputPath = exactAbsolutePath(supplied, code);
  if (!pathWithin(root.path, outputPath)) {
    fail(`${code.replace(/_path_invalid$/, "")}_outside_workspace`);
  }
  await inspectContainedPath(root, outputPath, fileSystem);
  return outputPath;
}

async function ensureOutputParent(
  root,
  outputPath,
  fileSystem,
) {
  await inspectContainedPath(root, outputPath, fileSystem);
  await fileSystem.mkdir(path.dirname(outputPath), {
    recursive: true,
  });
  await inspectContainedPath(root, path.dirname(outputPath), fileSystem, {
    allowMissingLeaf: false,
  });
  await inspectContainedPath(root, outputPath, fileSystem);
}

async function readStableFile(filePath, fileSystem, code) {
  let before;
  try {
    before = await fileSystem.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0n ||
    before.size > BigInt(MAX_JSON_BYTES)
  ) {
    fail(code);
  }
  const handle = await fileSystem.open(filePath, "r");
  let bytes;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, opened)) {
      fail(`${code}_changed_during_read`);
    }
    bytes = await handle.readFile();
    const completed = await handle.stat({ bigint: true });
    const after = await fileSystem.lstat(filePath, {
      bigint: true,
    });
    if (
      BigInt(bytes.length) !== opened.size ||
      !sameFileIdentity(opened, completed) ||
      !sameFileIdentity(opened, after)
    ) {
      fail(`${code}_changed_during_read`);
    }
  } finally {
    await handle.close();
  }
  return Object.freeze({
    bytes,
    file_sha256: sha256Bytes(bytes),
  });
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
}

function assertNoAuthority(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoAuthority(entry);
    return;
  }
  for (const [field, entry] of Object.entries(value)) {
    const normalised = field.toLowerCase();
    if (
      (FORBIDDEN_TRUE_FIELDS.has(normalised) ||
        /(?:^|_)(?:publish|platform|oauth|scheduler|database|mutation|upload)_authority(?:_|$)/.test(
          normalised,
        )) &&
      entry !== false
    ) {
      fail(`autonomous_production_job_${normalised}_forbidden`);
    }
    assertNoAuthority(entry);
  }
}

function assertIdentity(value, builder, code) {
  const expected = {
    story_id: builder.story_id,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: builder.scheduled_for,
    role: builder.role,
  };
  for (const [field, wanted] of Object.entries(expected)) {
    const observed =
      field === "role"
        ? text(value?.[field]).toUpperCase()
        : field === "platform"
          ? text(value?.[field]).toLowerCase()
          : text(value?.[field]);
    if (observed !== wanted) fail(code);
  }
}

function validateCoordinatorResult(value, builder) {
  exactFields(
    value,
    COORDINATOR_RESULT_FIELDS,
    "autonomous_production_job_coordinator_fields_invalid",
  );
  if (
    value.schema_version !==
      COORDINATOR_RESULT_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.verdict !== "GREEN" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0 ||
    value.story_id !== builder.story_id
  ) {
    fail("autonomous_production_job_coordinator_not_green");
  }
  exactFields(
    value.safety,
    COORDINATOR_SAFETY_FIELDS,
    "autonomous_production_job_coordinator_safety_invalid",
  );
  for (const field of COORDINATOR_SAFETY_FIELDS) {
    if (field === "narration_network_used") {
      if (typeof value.safety[field] !== "boolean") {
        fail(
          "autonomous_production_job_narration_network_state_invalid",
        );
      }
    } else if (value.safety[field] !== false) {
      fail(`autonomous_production_job_${field}_forbidden`);
    }
  }
  if (
    !plainObject(value.staging) ||
    value.staging.mode !== MODE ||
    value.staging.verdict !== "GREEN" ||
    !Array.isArray(value.staging.blockers) ||
    value.staging.blockers.length !== 0
  ) {
    fail("autonomous_production_job_staging_not_green");
  }
  assertIdentity(
    value.staging,
    builder,
    "autonomous_production_job_staging_identity_mismatch",
  );
  const preparation = value.staging.preparation_manifest;
  assertIdentity(
    preparation,
    builder,
    "autonomous_production_job_preparation_identity_mismatch",
  );
  if (
    preparation.candidate_revision_sha256 !==
      builder.production_request.candidate_revision_sha256 ||
    preparation.request_fingerprint !==
      builder.production_request.request_fingerprint
  ) {
    fail("autonomous_production_job_candidate_binding_mismatch");
  }
  const green = value.green_supplement;
  if (
    !plainObject(green) ||
    green.verdict !== "GREEN" ||
    green.authority_scope !== "LOCAL_PROOF_EVIDENCE_ONLY"
  ) {
    fail("autonomous_production_job_green_supplement_invalid");
  }
  assertIdentity(
    {
      ...green,
      scheduled_for: builder.scheduled_for,
      role: builder.role,
    },
    builder,
    "autonomous_production_job_green_identity_mismatch",
  );
  const composite = value.composite;
  if (
    !plainObject(composite) ||
    composite.schema_version !==
      "pulse-governed-final-composite-result-v1" ||
    composite.mode !== MODE ||
    composite.verdict !== "MATERIALIZED_LOCAL_PROOF" ||
    composite.story_id !== builder.story_id ||
    composite.channel_id !== CHANNEL_ID
  ) {
    fail("autonomous_production_job_composite_invalid");
  }
  assertNoAuthority(value);
  return structuredClone(value);
}

function validateReceiptBinding(
  receipt,
  builder,
  coordinatorReference,
) {
  let validated;
  try {
    validated =
      validateGovernedAutonomousCandidateCompletionReceipt(receipt);
  } catch (error) {
    fail(
      error?.code ||
        "autonomous_production_job_existing_receipt_invalid",
    );
  }
  assertIdentity(
    validated,
    builder,
    "autonomous_production_job_receipt_identity_mismatch",
  );
  if (
    validated.candidate_revision_sha256 !==
      builder.production_request.candidate_revision_sha256 ||
    validated.request_fingerprint !==
      builder.production_request.request_fingerprint
  ) {
    fail("autonomous_production_job_receipt_binding_mismatch");
  }
  if (
    coordinatorReference &&
    (validated.coordinator_result.path !==
      coordinatorReference.path ||
      validated.coordinator_result.file_sha256 !==
        coordinatorReference.file_sha256 ||
      validated.coordinator_result.canonical_sha256 !==
        coordinatorReference.canonical_sha256)
  ) {
    fail("autonomous_production_job_coordinator_result_drift");
  }
  return validated;
}

async function readExistingReceipt({
  outputPath,
  fileSystem,
  builder,
}) {
  const observed = await readStableFile(
    outputPath,
    fileSystem,
    "autonomous_production_job_existing_receipt_invalid",
  );
  if (!observed) return null;
  const parsed = parseJson(
    observed.bytes,
    "autonomous_production_job_existing_receipt_invalid",
  );
  const receipt = validateReceiptBinding(parsed, builder);
  return Object.freeze({ ...observed, receipt });
}

async function readExistingCoordinator({
  outputPath,
  fileSystem,
  builder,
  existingReceipt,
}) {
  const observed = await readStableFile(
    outputPath,
    fileSystem,
    "autonomous_production_job_existing_coordinator_invalid",
  );
  if (!observed) {
    if (existingReceipt) {
      fail(
        "autonomous_production_job_coordinator_missing_for_receipt",
      );
    }
    return null;
  }
  if (
    existingReceipt &&
    existingReceipt.receipt.coordinator_result.file_sha256 !==
      observed.file_sha256
  ) {
    fail("autonomous_production_job_coordinator_result_drift");
  }
  const parsed = parseJson(
    observed.bytes,
    "autonomous_production_job_existing_coordinator_invalid",
  );
  let result;
  try {
    result = validateCoordinatorResult(parsed, builder);
  } catch (error) {
    if (
      error instanceof GovernedAutonomousProductionJobRunnerError
    ) {
      if (existingReceipt) throw error;
      fail(
        "autonomous_production_job_existing_coordinator_invalid",
      );
    }
    throw error;
  }
  const canonicalBytes = canonicalJsonBytes(result);
  if (Buffer.compare(canonicalBytes, observed.bytes) !== 0) {
    if (existingReceipt) {
      fail("autonomous_production_job_coordinator_result_drift");
    }
    fail(
      "autonomous_production_job_existing_coordinator_invalid",
    );
  }
  const reference = {
    path: null,
    file_sha256: observed.file_sha256,
    canonical_sha256: canonicalSha256(result),
  };
  if (existingReceipt) {
    validateReceiptBinding(
      existingReceipt.receipt,
      builder,
      {
        ...reference,
        path:
          existingReceipt.receipt.coordinator_result.path,
      },
    );
  }
  return Object.freeze({
    status: "REPLAYED",
    result,
    bytes: observed.bytes,
    reference,
  });
}

async function writeCoordinatorIdempotently({
  outputPath,
  result,
  fileSystem,
}) {
  const bytes = canonicalJsonBytes(result);
  let handle;
  try {
    handle = await fileSystem.open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    return Object.freeze({
      status: "CREATED",
      result,
      bytes,
      reference: {
        path: null,
        file_sha256: sha256Bytes(bytes),
        canonical_sha256: canonicalSha256(result),
      },
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readStableFile(
      outputPath,
      fileSystem,
      "autonomous_production_job_existing_coordinator_invalid",
    );
    if (
      !existing ||
      Buffer.compare(existing.bytes, bytes) !== 0
    ) {
      fail("autonomous_production_job_coordinator_result_conflict");
    }
    return Object.freeze({
      status: "REPLAYED",
      result,
      bytes,
      reference: {
        path: null,
        file_sha256: existing.file_sha256,
        canonical_sha256: canonicalSha256(result),
      },
    });
  } finally {
    await handle?.close();
  }
}

function normaliseDependencies(value) {
  if (!plainObject(value)) {
    fail("autonomous_production_job_dependencies_required");
  }
  for (const field of [
    "materialiseGovernedAutonomousOfficialCandidate",
    "materialiseGovernedAutonomousCandidateCompletionReceipt",
    "indexGovernedAutonomousCandidateCompletionReceipt",
  ]) {
    if (typeof value[field] !== "function") {
      fail(`autonomous_production_job_${field}_required`);
    }
  }
  if (!value.db) {
    fail("autonomous_production_job_database_required");
  }
  if (!value.productionDependencies) {
    fail(
      "autonomous_production_job_production_dependencies_required",
    );
  }
  return {
    materialiseCandidate:
      value.materialiseGovernedAutonomousOfficialCandidate,
    materialiseReceipt:
      value.materialiseGovernedAutonomousCandidateCompletionReceipt,
    indexReceipt:
      value.indexGovernedAutonomousCandidateCompletionReceipt,
    productionDependencies: value.productionDependencies,
    db: value.db,
    fileSystem: value.fileSystem || defaultFileSystem,
  };
}

async function normaliseRequest(raw, fileSystem) {
  exactFields(
    raw,
    REQUEST_FIELDS,
    "autonomous_production_job_request_fields_invalid",
  );
  if (
    raw.schema_version !== REQUEST_SCHEMA_VERSION ||
    raw.mode !== MODE
  ) {
    fail("autonomous_production_job_local_proof_only");
  }
  const builder =
    validateGovernedAutonomousProductionRequestBuild(
      raw.builder_result,
    );
  const root = await exactWorkspaceRoot(
    raw.workspace_root,
    fileSystem,
  );
  if (
    path.resolve(builder.production_request.workspace_root) !==
    root.path
  ) {
    fail("autonomous_production_job_workspace_binding_mismatch");
  }
  const coordinatorOutput = await validateOutputPath(
    root,
    raw.coordinator_result_output_path,
    "autonomous_production_job_coordinator_output_path_invalid",
    fileSystem,
  );
  const receiptOutput = await validateOutputPath(
    root,
    raw.completion_receipt_output_path,
    "autonomous_production_job_receipt_output_path_invalid",
    fileSystem,
  );
  if (coordinatorOutput === receiptOutput) {
    fail("autonomous_production_job_output_paths_not_distinct");
  }
  const candidateRoot = path.resolve(
    root.path,
    ...builder.production_request.candidate_workspace_relative_root.split(
      "/",
    ),
  );
  if (
    !pathWithin(candidateRoot, coordinatorOutput) ||
    !pathWithin(candidateRoot, receiptOutput)
  ) {
    fail(
      "autonomous_production_job_output_outside_candidate_workspace",
    );
  }
  return Object.freeze({
    builder,
    root,
    coordinator_output_path: coordinatorOutput,
    receipt_output_path: receiptOutput,
  });
}

function validateMaterialisedReceipt({
  materialised,
  observed,
  request,
  builder,
  coordinatorReference,
}) {
  if (
    !plainObject(materialised) ||
    !["CREATED", "REPLAYED"].includes(materialised.status) ||
    path.resolve(text(materialised.path)) !== request.receipt_output_path ||
    exactSha256(
      materialised.file_sha256,
      "autonomous_production_job_receipt_file_sha256_invalid",
    ) !== observed.file_sha256
  ) {
    fail("autonomous_production_job_receipt_materialisation_invalid");
  }
  const receipt = validateReceiptBinding(
    observed.receipt,
    builder,
    coordinatorReference,
  );
  if (
    !plainObject(materialised.receipt) ||
    materialised.receipt.receipt_sha256 !==
      receipt.receipt_sha256
  ) {
    fail("autonomous_production_job_receipt_materialisation_invalid");
  }
  return receipt;
}

function validateIndexResult(
  indexed,
  receipt,
  receiptReference,
) {
  if (
    !plainObject(indexed) ||
    !["INDEXED", "REPLAYED"].includes(indexed.status) ||
    !Number.isInteger(indexed.audit_id) ||
    indexed.audit_id <= 0 ||
    !text(indexed.idempotency_key) ||
    !plainObject(indexed.evidence) ||
    !plainObject(indexed.evidence.receipt_ref)
  ) {
    fail("autonomous_production_job_index_result_invalid");
  }
  const evidence = indexed.evidence;
  const expected = {
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
  for (const [field, value] of Object.entries(expected)) {
    if (evidence[field] !== value) {
      fail("autonomous_production_job_index_binding_mismatch");
    }
  }
  if (
    evidence.receipt_ref.path !== receiptReference.path ||
    evidence.receipt_ref.file_sha256 !==
      receiptReference.file_sha256 ||
    evidence.receipt_ref.receipt_sha256 !==
      receipt.receipt_sha256
  ) {
    fail("autonomous_production_job_index_binding_mismatch");
  }
  if (
    !plainObject(indexed.receipt) ||
    indexed.receipt.receipt_sha256 !== receipt.receipt_sha256
  ) {
    fail("autonomous_production_job_index_binding_mismatch");
  }
  return indexed;
}

async function runGovernedAutonomousProductionJob(
  rawRequest,
  rawDependencies,
) {
  const dependencies = normaliseDependencies(rawDependencies);
  const request = await normaliseRequest(
    rawRequest,
    dependencies.fileSystem,
  );
  const builder = request.builder;
  const coordinatorRelativePath = relativeFromRoot(
    request.root,
    request.coordinator_output_path,
    "autonomous_production_job_coordinator_output_outside_workspace",
  );
  const receiptRelativePath = relativeFromRoot(
    request.root,
    request.receipt_output_path,
    "autonomous_production_job_receipt_output_outside_workspace",
  );
  const existingReceipt = await readExistingReceipt({
    outputPath: request.receipt_output_path,
    fileSystem: dependencies.fileSystem,
    builder,
  });
  let coordinator = await readExistingCoordinator({
    outputPath: request.coordinator_output_path,
    fileSystem: dependencies.fileSystem,
    builder,
    existingReceipt,
  });
  if (!coordinator) {
    const produced =
      await dependencies.materialiseCandidate(
        builder.production_request,
        dependencies.productionDependencies,
      );
    const result = validateCoordinatorResult(
      produced,
      builder,
    );
    await ensureOutputParent(
      request.root,
      request.coordinator_output_path,
      dependencies.fileSystem,
    );
    coordinator = await writeCoordinatorIdempotently({
      outputPath: request.coordinator_output_path,
      result,
      fileSystem: dependencies.fileSystem,
    });
  }
  coordinator = {
    ...coordinator,
    reference: {
      ...coordinator.reference,
      path: coordinatorRelativePath,
    },
  };
  if (existingReceipt) {
    validateReceiptBinding(
      existingReceipt.receipt,
      builder,
      coordinator.reference,
    );
  }

  const completionRequest = {
    schema_version: COMPLETION_RECEIPT_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: builder.production_request.generated_at,
    workspace_root: request.root.path,
    output_path: request.receipt_output_path,
    story_id: builder.story_id,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: builder.scheduled_for,
    role: builder.role,
    candidate_revision_sha256:
      builder.production_request.candidate_revision_sha256,
    request_fingerprint:
      builder.production_request.request_fingerprint,
    coordinator_result_ref: coordinator.reference,
  };
  const materialisedReceipt =
    await dependencies.materialiseReceipt(completionRequest);
  const observedReceipt = await readExistingReceipt({
    outputPath: request.receipt_output_path,
    fileSystem: dependencies.fileSystem,
    builder,
  });
  if (!observedReceipt) {
    fail("autonomous_production_job_receipt_missing");
  }
  const receipt = validateMaterialisedReceipt({
    materialised: materialisedReceipt,
    observed: observedReceipt,
    request,
    builder,
    coordinatorReference: coordinator.reference,
  });
  const receiptReference = {
    path: receiptRelativePath,
    file_sha256: observedReceipt.file_sha256,
  };
  const indexed = validateIndexResult(
    await dependencies.indexReceipt({
      db: dependencies.db,
      workspaceRoot: request.root.path,
      receiptRef: receiptReference,
    }),
    receipt,
    receiptReference,
  );

  return Object.freeze({
    schema_version: RESULT_SCHEMA_VERSION,
    mode: MODE,
    status: "AUTONOMOUS_CANDIDATE_MATERIALISED",
    verdict: "GREEN",
    blockers: [],
    story_id: builder.story_id,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: builder.scheduled_for,
    role: builder.role,
    candidate_revision_sha256:
      builder.production_request.candidate_revision_sha256,
    request_fingerprint:
      builder.production_request.request_fingerprint,
    builder_sha256: builder.builder_sha256,
    reservation_set_sha256:
      builder.reservation_set_sha256,
    coordinator_result: Object.freeze({
      status: coordinator.status,
      path: coordinator.reference.path,
      file_sha256: coordinator.reference.file_sha256,
      canonical_sha256:
        coordinator.reference.canonical_sha256,
    }),
    completion_receipt: Object.freeze({
      status: materialisedReceipt.status,
      path: receiptRelativePath,
      file_sha256: observedReceipt.file_sha256,
      receipt_sha256: receipt.receipt_sha256,
    }),
    completion_index: Object.freeze({
      status: indexed.status,
      audit_id: indexed.audit_id,
      idempotency_key: indexed.idempotency_key,
    }),
    safety: Object.freeze({
      local_proof_only: true,
      database_mutated: indexed.status === "INDEXED",
      database_mutation_scope:
        "IMMUTABLE_COMPLETION_RECEIPT_INDEX",
      narration_network_used:
        coordinator.result.safety.narration_network_used,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    }),
  });
}

module.exports = {
  GovernedAutonomousProductionJobRunnerError,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  runGovernedAutonomousProductionJob,
};
