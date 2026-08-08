"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  materialiseAutonomousAdmissionControlProofs,
} = require("./autonomous-admission-control-proof");
const {
  APPLY_REQUEST_SCHEMA_VERSION,
  materialiseAutonomousOfficialSourceEvidence,
} = require("./autonomous-official-source-evidence-apply");
const {
  REQUEST_SCHEMA_VERSION:
    COMPLETION_RECEIPT_REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materialiseGovernedAutonomousCandidateCompletionReceipt,
} = require("./governed-autonomous-candidate-completion-receipt");
const {
  loadGovernedAutonomousWindowCompletionReceipts,
} = require("./governed-autonomous-candidate-completion-receipt-index");
const {
  REQUEST_SCHEMA_VERSION: COMPOSITION_REQUEST_SCHEMA_VERSION,
  composeGovernedAutonomousPreT90Candidates,
} = require("./governed-autonomous-pre-t90-candidate-composition");
const {
  applyGovernedAutonomousPreT90CandidateComposition,
} = require("./apply-governed-autonomous-pre-t90-candidate-composition");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const {
  REQUEST_SCHEMA_VERSION: T90_SOURCE_REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousT90EligibilitySourceReport,
} = require("./governed-autonomous-t90-eligibility-source-report");
const {
  validateStoryIntakeManifest,
} = require("./governed-story-intake");
const {
  runWithPublicationAdmissionLease,
} = require("./publication-admission-lock");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-window-runner-request-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-window-runner-result-v1";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const T94_OFFSET_MS = 94 * 60 * 1000;
const T90_OFFSET_MS = 90 * 60 * 1000;
const GUARDED_PUBLISH_HOURS_UTC = new Set([9, 19]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTEMPT_LEAF_PATTERN = /^attempt-[A-Za-z0-9._-]{1,128}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "attempt_output_root",
  "catch_up_allowed",
  "publish_authority",
  "external_posting",
]);
const FALSE_CONTROL_FIELDS = Object.freeze([
  "operational_publish_authority",
  "dispatch_authorised",
  "external_publish_authorised",
  "platform_contacted",
  "database_mutated",
  "oauth_or_tokens_mutated",
]);
const FALSE_COMPOSITION_FIELDS = Object.freeze([
  "publish_authority",
  "scheduler_authority",
  "external_publish_authorised",
  "platform_contacted",
  "oauth_or_tokens_mutated",
]);
const FALSE_APPLICATION_FIELDS = Object.freeze([
  "external_posting",
  "publish_authority_created",
  "scheduler_authority_created",
  "platform_contacted",
  "network_used",
  "oauth_or_tokens_mutated",
]);

class GovernedAutonomousPreT90WindowRunnerError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "GovernedAutonomousPreT90WindowRunnerError";
    this.code = code;
  }
}

function fail(code, cause = null) {
  throw new GovernedAutonomousPreT90WindowRunnerError(code, cause);
}

function object(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, expected, code) {
  if (
    !object(value) ||
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((field) => !expected.has(field))
  ) {
    fail(code);
  }
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return { raw, timestamp: parsed };
}

function exactSha256(value, code) {
  const candidate = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) fail(code);
  return candidate;
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    fail("pre_t90_runner_trusted_clock_required");
  }
  let observed;
  try {
    observed = clock();
  } catch (error) {
    fail("pre_t90_runner_trusted_clock_invalid", error);
  }
  if (
    !(observed instanceof Date) ||
    !Number.isFinite(Date.prototype.getTime.call(observed))
  ) {
    fail("pre_t90_runner_trusted_clock_invalid");
  }
  return new Date(observed.getTime());
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function exactWorkspaceRoot(value, fileSystem) {
  const supplied = text(value);
  if (!supplied || !path.isAbsolute(supplied)) {
    fail("pre_t90_runner_workspace_root_invalid");
  }
  const resolved = path.resolve(supplied);
  let stat;
  try {
    stat = await fileSystem.lstat(resolved);
  } catch (error) {
    fail("pre_t90_runner_workspace_root_invalid", error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("pre_t90_runner_workspace_root_invalid");
  }
  const real = path.resolve(await fileSystem.realpath(resolved));
  if (real !== resolved) {
    fail("pre_t90_runner_workspace_root_link_forbidden");
  }
  return Object.freeze({ resolved, real });
}

async function assertExistingPathSafe(
  workspace,
  candidate,
  fileSystem,
  {
    allowMissingLeaf = false,
    code = "pre_t90_runner_artifact_invalid",
  } = {},
) {
  const resolved = path.resolve(candidate);
  if (!within(workspace.resolved, resolved)) fail(code);
  const parts = path
    .relative(workspace.resolved, resolved)
    .split(path.sep)
    .filter(Boolean);
  let cursor = workspace.resolved;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor);
    } catch (error) {
      if (
        error?.code === "ENOENT" &&
        allowMissingLeaf &&
        index === parts.length - 1
      ) {
        return resolved;
      }
      fail(code, error);
    }
    if (stat.isSymbolicLink()) fail(code);
    const real = path.resolve(await fileSystem.realpath(cursor));
    if (!within(workspace.real, real)) fail(code);
  }
  return resolved;
}

async function ensureSafeDirectory(
  workspace,
  candidate,
  fileSystem,
  code,
) {
  const resolved = path.resolve(candidate);
  if (!within(workspace.resolved, resolved)) fail(code);
  const parts = path
    .relative(workspace.resolved, resolved)
    .split(path.sep)
    .filter(Boolean);
  let cursor = workspace.resolved;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fileSystem.lstat(cursor);
    } catch (error) {
      if (error?.code !== "ENOENT") fail(code, error);
      try {
        await fileSystem.mkdir(cursor);
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") {
          fail(code, mkdirError);
        }
      }
      stat = await fileSystem.lstat(cursor);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
    const real = path.resolve(await fileSystem.realpath(cursor));
    if (!within(workspace.real, real)) fail(code);
  }
  return resolved;
}

function normaliseRequest(value, now) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "pre_t90_runner_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.channel_id !== CHANNEL_ID ||
    value.lane_id !== LANE_ID ||
    text(value.platform).toLowerCase() !== PLATFORM
  ) {
    fail("pre_t90_runner_scope_invalid");
  }
  if (
    value.catch_up_allowed !== false ||
    value.publish_authority !== false ||
    value.external_posting !== false
  ) {
    fail(
      value.catch_up_allowed !== false
        ? "pre_t90_runner_catch_up_forbidden"
        : "pre_t90_runner_request_authority_forbidden",
    );
  }
  const scheduled = exactTimestamp(
    value.scheduled_for,
    "pre_t90_runner_schedule_invalid",
  );
  const scheduledDate = new Date(scheduled.timestamp);
  if (
    !GUARDED_PUBLISH_HOURS_UTC.has(scheduledDate.getUTCHours()) ||
    scheduledDate.getUTCMinutes() !== 0 ||
    scheduledDate.getUTCSeconds() !== 0 ||
    scheduledDate.getUTCMilliseconds() !== 0
  ) {
    fail("pre_t90_runner_guarded_window_required");
  }
  const t94At = scheduled.timestamp - T94_OFFSET_MS;
  const t90At = scheduled.timestamp - T90_OFFSET_MS;
  if (now.getTime() < t94At) {
    fail("pre_t90_runner_outside_preparation_interval");
  }
  if (now.getTime() >= t90At) {
    fail("pre_t90_runner_catch_up_forbidden");
  }
  const attemptOutputRoot = path.resolve(
    text(value.attempt_output_root),
  );
  if (
    !text(value.attempt_output_root) ||
    !path.isAbsolute(text(value.attempt_output_root)) ||
    !ATTEMPT_LEAF_PATTERN.test(path.basename(attemptOutputRoot))
  ) {
    fail("pre_t90_runner_attempt_output_root_invalid");
  }
  return Object.freeze({
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: scheduled.raw,
    scheduled_ms: scheduled.timestamp,
    t94_at: new Date(t94At).toISOString(),
    t90_at: new Date(t90At).toISOString(),
    attempt_output_root: attemptOutputRoot,
  });
}

function ensureBeforeT90(now, input, code) {
  if (now.getTime() >= Date.parse(input.t90_at)) fail(code);
}

async function readBoundJson({
  workspace,
  reference,
  fileSystem,
  canonical = true,
  code,
}) {
  if (
    !object(reference) ||
    !text(reference.path) ||
    !SHA256_PATTERN.test(text(reference.file_sha256).toLowerCase())
  ) {
    fail(code);
  }
  const relativePath = text(reference.path);
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith("../")
  ) {
    fail(code);
  }
  const absolutePath = path.resolve(
    workspace.resolved,
    ...relativePath.split("/"),
  );
  await assertExistingPathSafe(
    workspace,
    absolutePath,
    fileSystem,
    { code },
  );
  const before = await fileSystem.lstat(absolutePath, {
    bigint: true,
  });
  if (!before.isFile() || before.isSymbolicLink()) fail(code);
  const bytes = await fileSystem.readFile(absolutePath);
  const after = await fileSystem.lstat(absolutePath, {
    bigint: true,
  });
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs
  ) {
    fail("pre_t90_runner_artifact_changed_during_read");
  }
  if (
    sha256Bytes(bytes) !==
    text(reference.file_sha256).toLowerCase()
  ) {
    fail(code);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(code, error);
  }
  if (
    canonical &&
    exactSha256(reference.canonical_sha256, code) !==
      canonicalSha256(value)
  ) {
    fail(code);
  }
  return { absolute_path: absolutePath, value };
}

async function defaultRevalidateCandidateCompletion({
  entry,
  workspace,
  workspaceRoot,
  fileSystem,
}) {
  const receipt = entry?.receipt;
  const receiptReference = entry?.evidence?.receipt_ref;
  if (!object(receipt) || !object(receiptReference)) {
    fail("pre_t90_runner_candidate_receipt_invalid");
  }
  const receiptPath = path.resolve(
    workspace.resolved,
    ...text(receiptReference.path).split("/"),
  );
  const replay =
    await materialiseGovernedAutonomousCandidateCompletionReceipt(
      {
        schema_version:
          COMPLETION_RECEIPT_REQUEST_SCHEMA_VERSION,
        mode: MODE,
        generated_at: receipt.generated_at,
        story_id: receipt.story_id,
        channel_id: receipt.channel_id,
        lane_id: receipt.lane_id,
        platform: receipt.platform,
        scheduled_for: receipt.scheduled_for,
        role: receipt.role,
        candidate_revision_sha256:
          receipt.candidate_revision_sha256,
        request_fingerprint: receipt.request_fingerprint,
        coordinator_result_ref: receipt.coordinator_result,
        workspace_root: workspaceRoot,
        output_path: receiptPath,
      },
      { fileSystem },
    );
  if (
    replay.status !== "REPLAYED" ||
    replay.receipt.receipt_sha256 !== receipt.receipt_sha256 ||
    replay.file_sha256 !== receiptReference.file_sha256
  ) {
    fail("pre_t90_runner_candidate_receipt_replay_invalid");
  }
  const coordinator = await readBoundJson({
    workspace,
    reference: receipt.coordinator_result,
    fileSystem,
    code: "pre_t90_runner_coordinator_artifact_drift",
  });
  const preparationFile = await readBoundJson({
    workspace,
    reference: receipt.preparation_manifest,
    fileSystem,
    code: "pre_t90_runner_preparation_artifact_drift",
  });
  let preparation;
  try {
    preparation =
      validateAutonomousOfficialJitPreparationManifest(
        preparationFile.value,
      );
  } catch (error) {
    fail("pre_t90_runner_preparation_artifact_drift", error);
  }
  if (
    preparation.preparation_sha256 !==
      receipt.preparation_manifest.canonical_sha256 ||
    preparation.story_id !== receipt.story_id ||
    preparation.role !== receipt.role ||
    preparation.scheduled_for !== receipt.scheduled_for ||
    preparation.candidate_revision_sha256 !==
      receipt.candidate_revision_sha256 ||
    preparation.request_fingerprint !==
      receipt.request_fingerprint
  ) {
    fail("pre_t90_runner_preparation_artifact_drift");
  }
  const intakeReference = preparation.artifacts?.story_intake;
  if (!object(intakeReference)) {
    fail("pre_t90_runner_story_intake_artifact_drift");
  }
  const intakePath = path.resolve(
    workspace.resolved,
    ...text(intakeReference.path).split("/"),
  );
  await assertExistingPathSafe(
    workspace,
    intakePath,
    fileSystem,
    { code: "pre_t90_runner_story_intake_artifact_drift" },
  );
  const intakeBytes = await fileSystem.readFile(intakePath);
  if (
    sha256Bytes(intakeBytes) !==
      text(intakeReference.sha256).toLowerCase()
  ) {
    fail("pre_t90_runner_story_intake_artifact_drift");
  }
  let validatedIntake;
  try {
    validatedIntake = validateStoryIntakeManifest({
      manifestPath: intakePath,
    });
  } catch (error) {
    fail("pre_t90_runner_story_intake_artifact_drift", error);
  }
  if (
    validatedIntake.storyId !== receipt.story_id ||
    validatedIntake.manifestSha256 !==
      text(intakeReference.sha256).toLowerCase()
  ) {
    fail("pre_t90_runner_story_intake_artifact_drift");
  }
  return Object.freeze({
    receipt: replay.receipt,
    coordinator_result: coordinator.value,
    preparation,
    intake: validatedIntake.manifest,
  });
}

function exactRoleCandidate(value, role, scheduledFor) {
  if (
    !object(value) ||
    !object(value.receipt) ||
    value.receipt.role !== role ||
    value.receipt.scheduled_for !== scheduledFor ||
    value.receipt.channel_id !== CHANNEL_ID ||
    value.receipt.lane_id !== LANE_ID ||
    value.receipt.platform !== PLATFORM ||
    value.receipt.verdict !== "GREEN"
  ) {
    fail("pre_t90_runner_candidate_binding_invalid");
  }
  return value;
}

function requireFalseFlags(value, fields, code) {
  if (!object(value)) fail(code);
  for (const field of fields) {
    if (value[field] !== false) fail(code);
  }
}

function validateControlResult(value, candidate) {
  if (
    !object(value) ||
    value.verdict !== "GREEN" ||
    value.story_id !== candidate.receipt.story_id ||
    value.channel_id !== CHANNEL_ID
  ) {
    fail("pre_t90_runner_control_proof_failed");
  }
  requireFalseFlags(
    value,
    FALSE_CONTROL_FIELDS,
    "pre_t90_runner_control_authority_forbidden",
  );
  for (const reference of [
    value.kill_switch_proof,
    value.publication_admission_owner_proof,
  ]) {
    if (
      !object(reference) ||
      !path.isAbsolute(text(reference.path)) ||
      !SHA256_PATTERN.test(text(reference.sha256).toLowerCase())
    ) {
      fail("pre_t90_runner_control_proof_failed");
    }
  }
  return value;
}

function validateSourceResult(value, candidate, reportPath) {
  if (
    !object(value) ||
    !["APPLIED", "IDEMPOTENT"].includes(value.status) ||
    path.resolve(text(value.report_path)) !== path.resolve(reportPath) ||
    !object(value.report) ||
    value.report.verdict !== "GREEN" ||
    value.report.story_id !== candidate.receipt.story_id ||
    !Array.isArray(value.report.blockers) ||
    value.report.blockers.length !== 0
  ) {
    fail("pre_t90_runner_source_evidence_failed");
  }
  requireFalseFlags(
    value.report,
    [
      "operational_publish_authority",
      "dispatch_authorised",
      "external_publish_authorised",
      "platform_contacted",
      "database_mutated",
      "oauth_or_tokens_mutated",
      "platform_objects_created",
    ],
    "pre_t90_runner_source_authority_forbidden",
  );
  exactSha256(
    value.report.report_sha256,
    "pre_t90_runner_source_evidence_failed",
  );
  return value;
}

function validateT90SourceResult(value, candidate, reportPath) {
  if (
    !object(value) ||
    !["APPLIED", "IDEMPOTENT"].includes(value.status) ||
    path.resolve(text(value.report_path)) !== path.resolve(reportPath) ||
    !object(value.report) ||
    !object(value.source_snapshot) ||
    !object(value.source_snapshot.source_report)
  ) {
    fail("pre_t90_runner_t90_source_report_failed");
  }
  requireFalseFlags(
    value.safety,
    [
      "database_mutated",
      "oauth_or_tokens_mutated",
      "platform_contacted",
      "publish_authority",
      "scheduler_authority",
      "external_publish_authorised",
    ],
    "pre_t90_runner_t90_source_authority_forbidden",
  );
  if (
    value.source_snapshot.source_report.report_sha256 !==
      value.report.report_sha256 ||
    value.source_snapshot.source_report.file_sha256 !==
      value.report_file_sha256
  ) {
    fail("pre_t90_runner_t90_source_report_failed");
  }
  return value;
}

async function hashReportFile({
  workspace,
  filePath,
  fileSystem,
  code,
}) {
  const resolved = await assertExistingPathSafe(
    workspace,
    filePath,
    fileSystem,
    { code },
  );
  const bytes = await fileSystem.readFile(resolved);
  return sha256Bytes(bytes);
}

function sourceRequestFor({
  candidate,
  control,
  reportPath,
}) {
  return {
    schema_version: APPLY_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    story_id: candidate.receipt.story_id,
    artifacts: {
      ...candidate.preparation.artifacts,
      kill_switch_proof: control.kill_switch_proof,
      publication_admission_owner_proof:
        control.publication_admission_owner_proof,
    },
    owned_visual_assets:
      candidate.preparation.owned_visual_assets,
    report_path: reportPath,
  };
}

function t90SourceRequestFor({
  candidate,
  source,
  sourceFileSha256,
  generatedAt,
  outputPath,
}) {
  const freshness = candidate.intake?.freshness;
  if (
    !object(freshness) ||
    !object(freshness.stale_reframe_option)
  ) {
    fail("pre_t90_runner_story_freshness_invalid");
  }
  return {
    schema_version: T90_SOURCE_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    story_id: candidate.receipt.story_id,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    role: candidate.receipt.role,
    generated_at: generatedAt,
    scheduled_for: candidate.receipt.scheduled_for,
    candidate_revision_sha256:
      candidate.receipt.candidate_revision_sha256,
    request_fingerprint:
      candidate.receipt.request_fingerprint,
    jit_preparation: candidate.preparation,
    discovered_at: freshness.discovered_at,
    publish_by: freshness.publish_by,
    stale_after: freshness.stale_after,
    stale_reframe_option: freshness.stale_reframe_option,
    upstream_source_apply_report: {
      path: source.report_path,
      file_sha256: sourceFileSha256,
      report_sha256: source.report.report_sha256,
    },
    output_path: outputPath,
  };
}

function validateCompositionSafety(
  composition,
  expectedCandidates,
  scheduledFor,
) {
  if (
    !object(composition) ||
    composition.verdict !== "GREEN" ||
    !Array.isArray(composition.blockers) ||
    composition.blockers.length !== 0 ||
    !Array.isArray(composition.candidates) ||
    composition.candidates.length !== 2
  ) {
    fail("pre_t90_runner_composition_failed");
  }
  if (
    composition.scheduled_for !== scheduledFor ||
    composition.candidates.some(
      (candidate, index) =>
        candidate.story_id !==
          expectedCandidates[index].receipt.story_id ||
        candidate.role !==
          expectedCandidates[index].receipt.role,
    )
  ) {
    fail("pre_t90_runner_composition_binding_invalid");
  }
  requireFalseFlags(
    composition.safety,
    FALSE_COMPOSITION_FIELDS,
    "pre_t90_runner_composition_authority_forbidden",
  );
  exactSha256(
    composition.composition_sha256,
    "pre_t90_runner_composition_failed",
  );
  return composition;
}

function validateApplicationSafety(application, composition) {
  if (
    !object(application) ||
    !["APPLIED", "EXISTS"].includes(application.verdict) ||
    application.composition_sha256 !==
      composition.composition_sha256 ||
    !Array.isArray(application.candidates) ||
    application.candidates.length !== 2
  ) {
    fail("pre_t90_runner_atomic_apply_failed");
  }
  if (
    application.scheduled_for !== composition.scheduled_for ||
    application.candidates.some(
      (candidate, index) =>
        candidate.story_id !==
          composition.candidates[index].story_id ||
        candidate.role !== composition.candidates[index].role,
    )
  ) {
    fail("pre_t90_runner_application_binding_invalid");
  }
  requireFalseFlags(
    application,
    FALSE_APPLICATION_FIELDS,
    "pre_t90_runner_apply_authority_forbidden",
  );
  return application;
}

async function writeNoClobber({
  outputPath,
  report,
  workspace,
  fileSystem,
}) {
  const parent = path.dirname(outputPath);
  if (!within(workspace.resolved, outputPath)) {
    fail("pre_t90_runner_report_outside_workspace");
  }
  await fileSystem.mkdir(parent, { recursive: true });
  await assertExistingPathSafe(
    workspace,
    parent,
    fileSystem,
    { code: "pre_t90_runner_report_parent_invalid" },
  );
  await assertExistingPathSafe(
    workspace,
    outputPath,
    fileSystem,
    {
      allowMissingLeaf: true,
      code: "pre_t90_runner_report_path_invalid",
    },
  );
  const bytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  try {
    const handle = await fileSystem.open(outputPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { status: "APPLIED", bytes };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fileSystem.readFile(outputPath);
    if (!existing.equals(bytes)) {
      fail("pre_t90_runner_report_conflict");
    }
    return { status: "IDEMPOTENT", bytes: existing };
  }
}

function publicCandidateEvidence(candidate, source, t90Source) {
  return {
    story_id: candidate.receipt.story_id,
    role: candidate.receipt.role,
    candidate_revision_sha256:
      candidate.receipt.candidate_revision_sha256,
    request_fingerprint:
      candidate.receipt.request_fingerprint,
    receipt: {
      path: candidate.entry.evidence.receipt_ref.path,
      file_sha256:
        candidate.entry.evidence.receipt_ref.file_sha256,
      receipt_sha256: candidate.receipt.receipt_sha256,
    },
    coordinator_result: candidate.receipt.coordinator_result,
    preparation_manifest:
      candidate.receipt.preparation_manifest,
    source_apply_report: {
      path: source.report_path,
      report_sha256: source.report.report_sha256,
    },
    t90_source_report: {
      path: t90Source.report_path,
      file_sha256: t90Source.report_file_sha256,
      report_sha256: t90Source.report.report_sha256,
      valid_until: t90Source.report.valid_until,
    },
  };
}

async function runGovernedAutonomousPreT90WindowPreparation(
  request = {},
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const initialNow = trustedNow(options.clock);
  const input = normaliseRequest(request, initialNow);
  const workspace = await exactWorkspaceRoot(
    options.workspaceRoot,
    fileSystem,
  );
  if (!within(workspace.resolved, input.attempt_output_root)) {
    fail("pre_t90_runner_attempt_output_root_invalid");
  }
  await ensureSafeDirectory(
    workspace,
    path.dirname(input.attempt_output_root),
    fileSystem,
    "pre_t90_runner_attempt_output_root_invalid",
  );
  if (!options.repos?.db) {
    fail("pre_t90_runner_repositories_required");
  }

  const loadCompletionReceipts =
    options.loadCompletionReceipts ||
    loadGovernedAutonomousWindowCompletionReceipts;
  let indexed;
  try {
    indexed = await loadCompletionReceipts({
      db: options.repos.db,
      workspaceRoot: workspace.resolved,
      channelId: CHANNEL_ID,
      laneId: LANE_ID,
      platform: PLATFORM,
      scheduledFor: input.scheduled_for,
      fileSystem,
    });
  } catch (error) {
    fail(
      "pre_t90_runner_completion_receipts_unavailable",
      error,
    );
  }
  const indexedPrimary = exactRoleCandidate(
    indexed?.primary,
    "PRIMARY",
    input.scheduled_for,
  );
  const indexedStandby = exactRoleCandidate(
    indexed?.standby,
    "STANDBY",
    input.scheduled_for,
  );
  if (
    indexedPrimary.receipt.story_id ===
    indexedStandby.receipt.story_id
  ) {
    fail("pre_t90_runner_distinct_candidates_required");
  }

  const revalidateCandidate =
    options.revalidateCandidateCompletion ||
    defaultRevalidateCandidateCompletion;
  const materialiseControlProofs =
    options.materialiseControlProofs ||
    materialiseAutonomousAdmissionControlProofs;
  const materialiseSourceEvidence =
    options.materialiseSourceEvidence ||
    materialiseAutonomousOfficialSourceEvidence;
  const materialiseT90SourceReport =
    options.materialiseT90SourceReport ||
    materialiseGovernedAutonomousT90EligibilitySourceReport;
  const composeCandidates =
    options.composeCandidates ||
    composeGovernedAutonomousPreT90Candidates;
  const applyComposition =
    options.applyComposition ||
    applyGovernedAutonomousPreT90CandidateComposition;
  const withPublicationAdmissionLease =
    options.runWithPublicationAdmissionLease ||
    runWithPublicationAdmissionLease;

  let leased;
  try {
    leased = await withPublicationAdmissionLease({
      db: options.repos.db,
      leases: options.repos.runtimeLeases,
      operation: "governed_autonomous_pre_t90_window_preparation",
      runtimeAuthority: options.runtimeAuthority,
      claimedJobAuthority: options.claimedJobAuthority,
      task: async ({ assertHealthy, publicationAdmissionLease }) => {
        if (
          typeof assertHealthy !== "function" ||
          !object(publicationAdmissionLease) ||
          publicationAdmissionLease.acquired !== true
        ) {
          fail("pre_t90_runner_publication_admission_lease_invalid");
        }
        const initialCandidates = [];
        for (const entry of [indexedPrimary, indexedStandby]) {
          assertHealthy();
          let candidate;
          try {
            candidate = await revalidateCandidate({
              entry,
              workspace,
              workspaceRoot: workspace.resolved,
              fileSystem,
            });
          } catch (error) {
            fail(
              "pre_t90_runner_candidate_artifact_drift",
              error,
            );
          }
          exactRoleCandidate(
            { receipt: candidate.receipt },
            entry.receipt.role,
            input.scheduled_for,
          );
          initialCandidates.push({
            ...candidate,
            entry,
          });
        }

        const evidenceCandidates = [];
        for (const candidate of initialCandidates) {
          assertHealthy();
          const evidenceNow = trustedNow(options.clock);
          ensureBeforeT90(
            evidenceNow,
            input,
            "pre_t90_runner_crossed_t90_during_evidence",
          );
          const candidateRoot = path.join(
            input.attempt_output_root,
            candidate.receipt.role.toLowerCase(),
          );
          let control;
          try {
            control = validateControlResult(
              await materialiseControlProofs(
                {
                  storyId: candidate.receipt.story_id,
                  channelId: CHANNEL_ID,
                  workspaceRoot: workspace.resolved,
                  outputDir: path.join(
                    candidateRoot,
                    "control-proofs",
                  ),
                  repos: options.repos,
                  env: options.env || {},
                  publicationAdmissionLease,
                },
                {
                  clock: options.clock,
                  fileSystem,
                },
              ),
              candidate,
            );
          } catch (error) {
            if (
              error instanceof
              GovernedAutonomousPreT90WindowRunnerError
            ) {
              throw error;
            }
            fail("pre_t90_runner_control_proof_failed", error);
          }
          assertHealthy();
          const sourceReportPath = path.join(
            candidateRoot,
            "official-source-evidence.json",
          );
          let source;
          try {
            source = validateSourceResult(
              await materialiseSourceEvidence(
                sourceRequestFor({
                  candidate,
                  control,
                  reportPath: sourceReportPath,
                }),
                {
                  clock: options.clock,
                  fileSystem,
                  fetchCapture: options.fetchCapture,
                  workspaceRoot: workspace.resolved,
                },
              ),
              candidate,
              sourceReportPath,
            );
          } catch (error) {
            if (
              error instanceof
              GovernedAutonomousPreT90WindowRunnerError
            ) {
              throw error;
            }
            fail("pre_t90_runner_source_evidence_failed", error);
          }
          const sourceFileSha256 = await hashReportFile({
            workspace,
            filePath: source.report_path,
            fileSystem,
            code: "pre_t90_runner_source_evidence_failed",
          });
          assertHealthy();
          const t90SourceNow = trustedNow(options.clock);
          ensureBeforeT90(
            t90SourceNow,
            input,
            "pre_t90_runner_crossed_t90_during_evidence",
          );
          const t90ReportPath = path.join(
            candidateRoot,
            "t90-eligibility-source-report.json",
          );
          let t90Source;
          try {
            t90Source = validateT90SourceResult(
              await materialiseT90SourceReport(
                t90SourceRequestFor({
                  candidate,
                  source,
                  sourceFileSha256,
                  generatedAt: t90SourceNow.toISOString(),
                  outputPath: t90ReportPath,
                }),
                {
                  clock: () => new Date(t90SourceNow),
                  fileSystem,
                  workspaceRoot: workspace.resolved,
                },
              ),
              candidate,
              t90ReportPath,
            );
          } catch (error) {
            if (
              error instanceof
              GovernedAutonomousPreT90WindowRunnerError
            ) {
              throw error;
            }
            fail(
              "pre_t90_runner_t90_source_report_failed",
              error,
            );
          }
          evidenceCandidates.push({
            ...candidate,
            control,
            source,
            t90Source,
          });
        }

        const finalCandidates = [];
        for (const candidate of evidenceCandidates) {
          assertHealthy();
          let revalidated;
          try {
            revalidated = await revalidateCandidate({
              entry: candidate.entry,
              workspace,
              workspaceRoot: workspace.resolved,
              fileSystem,
            });
          } catch (error) {
            fail(
              "pre_t90_runner_candidate_artifact_drift",
              error,
            );
          }
          if (
            revalidated.receipt.receipt_sha256 !==
              candidate.receipt.receipt_sha256 ||
            canonicalSha256(revalidated.coordinator_result) !==
              canonicalSha256(candidate.coordinator_result) ||
            revalidated.preparation.preparation_sha256 !==
              candidate.preparation.preparation_sha256
          ) {
            fail("pre_t90_runner_candidate_artifact_drift");
          }
          finalCandidates.push({
            ...candidate,
            ...revalidated,
          });
        }

        assertHealthy();
        const composeNow = trustedNow(options.clock);
        ensureBeforeT90(
          composeNow,
          input,
          "pre_t90_runner_crossed_t90_before_composition",
        );
        let composition;
        try {
          composition = validateCompositionSafety(
            composeCandidates({
              schema_version:
                COMPOSITION_REQUEST_SCHEMA_VERSION,
              mode: MODE,
              now: composeNow.toISOString(),
              scheduled_for: input.scheduled_for,
              primary: {
                coordinator_result:
                  finalCandidates[0].coordinator_result,
                source_snapshot:
                  finalCandidates[0].t90Source.source_snapshot,
              },
              reserve: {
                coordinator_result:
                  finalCandidates[1].coordinator_result,
                source_snapshot:
                  finalCandidates[1].t90Source.source_snapshot,
              },
            }),
            finalCandidates,
            input.scheduled_for,
          );
        } catch (error) {
          if (
            error instanceof
            GovernedAutonomousPreT90WindowRunnerError
          ) {
            throw error;
          }
          fail("pre_t90_runner_composition_failed", error);
        }

        assertHealthy();
        const applyNow = trustedNow(options.clock);
        ensureBeforeT90(
          applyNow,
          input,
          "pre_t90_runner_crossed_t90_before_apply",
        );
        let application;
        try {
          application = validateApplicationSafety(
            applyComposition({
              composition,
              repos: options.repos,
              workspaceRoot: workspace.resolved,
              now: applyNow,
            }),
            composition,
          );
        } catch (error) {
          if (
            error instanceof
            GovernedAutonomousPreT90WindowRunnerError
          ) {
            throw error;
          }
          fail("pre_t90_runner_atomic_apply_failed", error);
        }
        return {
          marker:
            "pulse-governed-autonomous-pre-t90-window-leased-result-v1",
          compose_now: composeNow.toISOString(),
          apply_now: applyNow.toISOString(),
          candidates: finalCandidates,
          composition,
          application,
        };
      },
    });
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousPreT90WindowRunnerError
    ) {
      throw error;
    }
    fail("pre_t90_runner_publication_admission_lease_failed", error);
  }
  if (
    !object(leased) ||
    leased.marker !==
      "pulse-governed-autonomous-pre-t90-window-leased-result-v1"
  ) {
    fail("pre_t90_runner_publication_admission_lease_unavailable");
  }

  const reportBody = {
    schema_version: RESULT_SCHEMA_VERSION,
    mode: MODE,
    verdict: "GREEN",
    blockers: [],
    generated_at: leased.apply_now,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: input.scheduled_for,
    t94_at: input.t94_at,
    t90_at: input.t90_at,
    catch_up_allowed: false,
    receipt_index_source: "operator_audit_log",
    candidates: leased.candidates.map((candidate) =>
      publicCandidateEvidence(
        candidate,
        candidate.source,
        candidate.t90Source,
      ),
    ),
    composition_sha256:
      leased.composition.composition_sha256,
    application: leased.application,
    database_mutated:
      leased.application.database_mutated === true,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting: false,
    platform_contacted: false,
    network_scope:
      "OFFICIAL_PRIMARY_AND_SUPPORTING_SOURCE_READS_ONLY",
    oauth_or_tokens_mutated: false,
  };
  const report = Object.freeze({
    ...reportBody,
    report_sha256: canonicalSha256(reportBody),
  });
  const reportPath = path.join(
    input.attempt_output_root,
    "pre-t90-window-run.json",
  );
  const written = await writeNoClobber({
    outputPath: reportPath,
    report,
    workspace,
    fileSystem,
  });
  return Object.freeze({
    ...report,
    report_path: reportPath,
    report_file_sha256: sha256Bytes(written.bytes),
    report,
  });
}

module.exports = {
  GovernedAutonomousPreT90WindowRunnerError,
  MODE,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  T90_OFFSET_MS,
  T94_OFFSET_MS,
  runGovernedAutonomousPreT90WindowPreparation,
};
