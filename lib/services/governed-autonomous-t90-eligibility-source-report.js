"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  APPLY_MATERIALISER_ID,
  APPLY_REPORT_SCHEMA_VERSION,
  MAX_JIT_AGE_MS,
} = require("./autonomous-official-source-evidence-apply");
const {
  MAX_REVERIFICATION_AGE_MS,
  canonicalSha256,
} = require("./autonomous-green-admission");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const {
  MAX_CHECKPOINT_LATENESS_MS,
} = require("./governed-youtube-window-checkpoint-primer");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-t90-eligibility-source-request-v1";
const REPORT_SCHEMA_VERSION =
  "pulse-governed-autonomous-t90-eligibility-source-report-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-t90-eligibility-source-result-v1";
const MATERIALISER_ID =
  "pulse-governed-autonomous-t90-eligibility-source-v1";
const MODE = "LOCAL_PROOF";
const T90_OFFSET_MS = 90 * 60 * 1000;
const T90_EARLY_TOLERANCE_MS = 5 * 60 * 1000;
const T75_OFFSET_MS = 75 * 60 * 1000;
// Report expiry is exclusive, while checkpoint execution accepts the
// inclusive lateness boundary. Retain one second beyond that boundary.
const T75_VALIDITY_MARGIN_MS =
  MAX_CHECKPOINT_LATENESS_MS + 1000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GUARDED_PUBLISH_HOURS_UTC = new Set([9, 19]);
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "role",
  "generated_at",
  "scheduled_for",
  "candidate_revision_sha256",
  "request_fingerprint",
  "jit_preparation",
  "discovered_at",
  "publish_by",
  "stale_after",
  "stale_reframe_option",
  "upstream_source_apply_report",
  "output_path",
]);
const STALE_REFRAME_FIELDS = new Set(["allowed", "reason"]);
const UPSTREAM_REFERENCE_FIELDS = new Set([
  "path",
  "file_sha256",
  "report_sha256",
]);
const REPORT_FIELDS = new Set([
  "schema_version",
  "materialiser_id",
  "mode",
  "generated_at",
  "valid_until",
  "request_sha256",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "role",
  "scheduled_for",
  "candidate_revision_sha256",
  "request_fingerprint",
  "jit_preparation_sha256",
  "story_intake_sha256",
  "source_evidence_sha256",
  "required_checkpoint",
  "source_last_checked_at",
  "upstream_source_apply_report",
  "source_set_sha256",
  "verdict",
  "blockers",
  "publish_authority",
  "scheduler_authority",
  "database_authority",
  "external_publish_authorised",
  "platform_contacted",
  "database_mutated",
  "oauth_or_tokens_mutated",
  "report_sha256",
]);
const CHECKPOINT_FIELDS = new Set([
  "name",
  "t75_at",
  "validity_margin_ms",
  "required_valid_through",
  "final_jit_revalidation_required",
]);
const EXPECTED_FIELDS = new Set(["story_id", "scheduled_for"]);
const APPLY_VALIDATION_EXPECTED_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "role",
  "scheduled_for",
  "file_sha256",
  "report_sha256",
  "request_sha256",
  "generated_at",
  "valid_until",
  "jit_preparation_sha256",
  "candidate_revision_sha256",
  "request_fingerprint",
  "source_evidence_sha256",
  "story_intake_sha256",
]);
const APPLY_VALIDATION_RECEIPT_SCHEMA_VERSION =
  "pulse-governed-t90-source-report-validation-v1";

class GovernedAutonomousT90EligibilitySourceReportError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousT90EligibilitySourceReportError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousT90EligibilitySourceReportError(code);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, fields, code) {
  if (!object(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
  return value;
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
  return raw;
}

function exactSha256(value, code) {
  const candidate = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(candidate)) fail(code);
  return candidate;
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    fail("t90_eligibility_trusted_clock_required");
  }
  const value = clock();
  const now = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(now.getTime())) {
    fail("t90_eligibility_trusted_clock_invalid");
  }
  return now;
}

function samePath(left, right) {
  const normalise = (value) =>
    process.platform === "win32"
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
  return normalise(left) === normalise(right);
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

async function safeWorkspaceRoot(workspaceRoot, fileSystem) {
  const resolved = path.resolve(text(workspaceRoot));
  if (!text(workspaceRoot) || !path.isAbsolute(resolved)) {
    fail("t90_eligibility_workspace_root_required");
  }
  let stat;
  let real;
  try {
    stat = await fileSystem.lstat(resolved);
    real = await fileSystem.realpath(resolved);
  } catch {
    fail("t90_eligibility_workspace_root_invalid");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(real, resolved)) {
    fail("t90_eligibility_workspace_root_invalid");
  }
  return path.resolve(real);
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

async function readBoundJson({
  reference,
  workspace,
  fileSystem,
}) {
  const resolved = path.resolve(reference.path);
  if (!pathWithin(workspace, resolved)) {
    fail("t90_eligibility_upstream_outside_workspace");
  }
  let initial;
  let real;
  try {
    initial = await fileSystem.lstat(resolved, { bigint: true });
    real = await fileSystem.realpath(resolved);
  } catch {
    fail("t90_eligibility_upstream_missing");
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_JSON_BYTES) ||
    !samePath(real, resolved)
  ) {
    fail("t90_eligibility_upstream_regular_file_required");
  }
  let handle;
  try {
    handle = await fileSystem.open(resolved, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(initial, opened)) {
      fail("t90_eligibility_upstream_changed_during_read");
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const completed = await handle.stat({ bigint: true });
    const finalStat = await fileSystem.lstat(resolved, {
      bigint: true,
    });
    if (
      offset !== bytes.length ||
      !sameIdentity(opened, completed) ||
      !sameIdentity(opened, finalStat) ||
      !samePath(await fileSystem.realpath(resolved), real)
    ) {
      fail("t90_eligibility_upstream_changed_during_read");
    }
    const fileSha256 = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    if (fileSha256 !== reference.file_sha256) {
      fail("t90_eligibility_upstream_file_sha256_mismatch");
    }
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("t90_eligibility_upstream_json_invalid");
    }
    if (!object(value)) fail("t90_eligibility_upstream_json_invalid");
    return { path: resolved, file_sha256: fileSha256, value };
  } finally {
    await handle?.close();
  }
}

function validateUpstream(report, reference, now) {
  const suppliedReportSha256 = exactSha256(
    report.report_sha256,
    "t90_eligibility_upstream_report_sha256_invalid",
  );
  const { report_sha256: _reportSha256, ...payload } = report;
  if (
    suppliedReportSha256 !== reference.report_sha256 ||
    canonicalSha256(payload) !== suppliedReportSha256
  ) {
    fail("t90_eligibility_upstream_report_sha256_mismatch");
  }
  if (
    report.schema_version !== APPLY_REPORT_SCHEMA_VERSION ||
    report.materialiser_id !== APPLY_MATERIALISER_ID ||
    report.mode !== MODE
  ) {
    fail("t90_eligibility_upstream_schema_invalid");
  }
  if (
    text(report.verdict).toUpperCase() !== "GREEN" ||
    !Array.isArray(report.blockers) ||
    report.blockers.length !== 0
  ) {
    fail("t90_eligibility_upstream_not_green");
  }
  for (const field of [
    "operational_publish_authority",
    "dispatch_authorised",
    "external_publish_authorised",
    "platform_contacted",
    "database_mutated",
    "oauth_or_tokens_mutated",
    "platform_objects_created",
  ]) {
    if (report[field] !== false) {
      fail("t90_eligibility_upstream_authority_forbidden");
    }
  }
  const generatedAt = Date.parse(
    exactTimestamp(
      report.generated_at,
      "t90_eligibility_upstream_generated_at_invalid",
    ),
  );
  const validUntil = Date.parse(
    exactTimestamp(
      report.valid_until,
      "t90_eligibility_upstream_valid_until_invalid",
    ),
  );
  if (
    generatedAt > now.getTime() ||
    now.getTime() - generatedAt > MAX_JIT_AGE_MS
  ) {
    fail("t90_eligibility_upstream_stale");
  }
  if (now.getTime() >= validUntil) {
    fail("t90_eligibility_upstream_expired");
  }
  const revalidation = object(report.source_revalidation);
  const sources = Array.isArray(revalidation?.sources)
    ? revalidation.sources
    : [];
  if (
    !sources.length ||
    revalidation.snapshot_count !== sources.length ||
    revalidation.primary_count !== 1
  ) {
    fail("t90_eligibility_source_set_invalid");
  }
  let sourceLastCheckedAt = null;
  for (const source of sources) {
    const checkedAt = Date.parse(
      exactTimestamp(
        source?.revalidated_at,
        "t90_eligibility_source_revalidated_at_invalid",
      ),
    );
    if (
      source?.unchanged !== true ||
      source?.claims_match !== true ||
      Number(source?.fetch_status) < 200 ||
      Number(source?.fetch_status) >= 300 ||
      checkedAt > now.getTime() ||
      now.getTime() - checkedAt > MAX_JIT_AGE_MS
    ) {
      fail("t90_eligibility_source_revalidation_invalid");
    }
    if (sourceLastCheckedAt !== null && sourceLastCheckedAt !== checkedAt) {
      fail("t90_eligibility_source_revalidation_time_drift");
    }
    sourceLastCheckedAt = checkedAt;
  }
  return {
    source_last_checked_at: new Date(sourceLastCheckedAt).toISOString(),
    source_set_sha256: canonicalSha256(revalidation),
    report_sha256: suppliedReportSha256,
  };
}

function normaliseRequest(value, now) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "t90_eligibility_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("t90_eligibility_local_proof_only");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "t90_eligibility_generated_at_invalid",
  );
  if (generatedAt !== now.toISOString()) {
    fail("t90_eligibility_generated_at_clock_mismatch");
  }
  const scheduledFor = exactTimestamp(
    value.scheduled_for,
    "t90_eligibility_schedule_invalid",
  );
  const scheduledMs = Date.parse(scheduledFor);
  const leadMs = scheduledMs - now.getTime();
  if (
    !GUARDED_PUBLISH_HOURS_UTC.has(
      new Date(scheduledMs).getUTCHours(),
    ) ||
    new Date(scheduledMs).getUTCMinutes() !== 0 ||
    leadMs < T90_OFFSET_MS ||
    leadMs > T90_OFFSET_MS + T90_EARLY_TOLERANCE_MS
  ) {
    fail("t90_eligibility_guarded_window_required");
  }
  const storyId = text(value.story_id);
  const role = text(value.role).toUpperCase();
  if (
    !storyId ||
    value.channel_id !== "pulse-gaming" ||
    value.lane_id !== "breaking_short" ||
    value.platform !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(role)
  ) {
    fail("t90_eligibility_story_scope_invalid");
  }
  const candidateRevisionSha256 = exactSha256(
    value.candidate_revision_sha256,
    "t90_eligibility_candidate_revision_invalid",
  );
  const requestFingerprint = exactSha256(
    value.request_fingerprint,
    "t90_eligibility_request_fingerprint_invalid",
  );
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(
      value.jit_preparation,
    );
  if (
    preparation.story_id !== storyId ||
    preparation.channel_id !== "pulse-gaming" ||
    preparation.lane_id !== "breaking_short" ||
    preparation.platform !== "youtube" ||
    preparation.role !== role ||
    preparation.scheduled_for !== scheduledFor ||
    preparation.candidate_revision_sha256 !==
      candidateRevisionSha256 ||
    preparation.request_fingerprint !== requestFingerprint
  ) {
    fail("t90_eligibility_jit_preparation_binding_mismatch");
  }
  exactFields(
    value.stale_reframe_option,
    STALE_REFRAME_FIELDS,
    "t90_eligibility_stale_reframe_invalid",
  );
  if (
    typeof value.stale_reframe_option.allowed !== "boolean" ||
    !text(value.stale_reframe_option.reason)
  ) {
    fail("t90_eligibility_stale_reframe_invalid");
  }
  exactFields(
    value.upstream_source_apply_report,
    UPSTREAM_REFERENCE_FIELDS,
    "t90_eligibility_upstream_reference_invalid",
  );
  const reference = {
    path: text(value.upstream_source_apply_report.path),
    file_sha256: exactSha256(
      value.upstream_source_apply_report.file_sha256,
      "t90_eligibility_upstream_reference_invalid",
    ),
    report_sha256: exactSha256(
      value.upstream_source_apply_report.report_sha256,
      "t90_eligibility_upstream_reference_invalid",
    ),
  };
  if (!reference.path || !path.isAbsolute(reference.path)) {
    fail("t90_eligibility_upstream_reference_invalid");
  }
  const discoveredAt = exactTimestamp(
    value.discovered_at,
    "t90_eligibility_discovered_at_invalid",
  );
  const publishBy = exactTimestamp(
    value.publish_by,
    "t90_eligibility_publish_by_invalid",
  );
  const staleAfter = exactTimestamp(
    value.stale_after,
    "t90_eligibility_stale_after_invalid",
  );
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: MODE,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    role,
    generated_at: generatedAt,
    scheduled_for: scheduledFor,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    jit_preparation: preparation,
    discovered_at: discoveredAt,
    publish_by: publishBy,
    stale_after: staleAfter,
    stale_reframe_option: {
      allowed: value.stale_reframe_option.allowed,
      reason: text(value.stale_reframe_option.reason),
    },
    upstream_source_apply_report: reference,
    output_path: path.resolve(text(value.output_path)),
  };
}

function buildReport(input, upstream, source, now) {
  if (text(upstream.story_id) !== input.story_id) {
    fail("t90_eligibility_upstream_story_mismatch");
  }
  if (
    text(upstream.lineage?.story_intake_sha256).toLowerCase() !==
      input.jit_preparation.artifacts.story_intake.sha256 ||
    text(upstream.lineage?.source_evidence_sha256).toLowerCase() !==
      input.jit_preparation.artifacts.source_evidence.sha256
  ) {
    fail("t90_eligibility_upstream_preparation_lineage_mismatch");
  }
  const sourceLastCheckedMs = Date.parse(
    source.source_last_checked_at,
  );
  if (
    Date.parse(input.discovered_at) > sourceLastCheckedMs ||
    sourceLastCheckedMs > now.getTime()
  ) {
    fail("t90_eligibility_freshness_order_invalid");
  }
  const t75At = Date.parse(input.scheduled_for) - T75_OFFSET_MS;
  const requiredValidThrough =
    t75At + T75_VALIDITY_MARGIN_MS;
  if (
    requiredValidThrough - sourceLastCheckedMs >
    MAX_REVERIFICATION_AGE_MS
  ) {
    fail("t90_eligibility_validity_exceeds_freshness_policy");
  }
  if (
    requiredValidThrough > Date.parse(input.publish_by) ||
    requiredValidThrough > Date.parse(input.stale_after)
  ) {
    fail("t90_eligibility_story_lifetime_too_short");
  }
  const requestSha256 = canonicalSha256(input);
  const body = {
    schema_version: REPORT_SCHEMA_VERSION,
    materialiser_id: MATERIALISER_ID,
    mode: MODE,
    generated_at: now.toISOString(),
    valid_until: new Date(requiredValidThrough).toISOString(),
    request_sha256: requestSha256,
    story_id: input.story_id,
    channel_id: input.channel_id,
    lane_id: input.lane_id,
    platform: input.platform,
    role: input.role,
    scheduled_for: input.scheduled_for,
    candidate_revision_sha256:
      input.candidate_revision_sha256,
    request_fingerprint: input.request_fingerprint,
    jit_preparation_sha256:
      input.jit_preparation.preparation_sha256,
    story_intake_sha256:
      input.jit_preparation.artifacts.story_intake.sha256,
    source_evidence_sha256:
      input.jit_preparation.artifacts.source_evidence.sha256,
    required_checkpoint: {
      name: "T75",
      t75_at: new Date(t75At).toISOString(),
      validity_margin_ms: T75_VALIDITY_MARGIN_MS,
      required_valid_through:
        new Date(requiredValidThrough).toISOString(),
      final_jit_revalidation_required: true,
    },
    source_last_checked_at: source.source_last_checked_at,
    upstream_source_apply_report: {
      path: input.upstream_source_apply_report.path,
      file_sha256:
        input.upstream_source_apply_report.file_sha256,
      report_sha256: source.report_sha256,
    },
    source_set_sha256: source.source_set_sha256,
    verdict: "GREEN",
    blockers: [],
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
  };
  return {
    ...body,
    report_sha256: canonicalSha256(body),
  };
}

function validateGovernedAutonomousT90EligibilitySourceReport(
  value,
  options = {},
) {
  exactFields(
    value,
    REPORT_FIELDS,
    "t90_eligibility_report_fields_invalid",
  );
  exactFields(
    value.required_checkpoint,
    CHECKPOINT_FIELDS,
    "t90_eligibility_checkpoint_invalid",
  );
  if (
    value.schema_version !== REPORT_SCHEMA_VERSION ||
    value.materialiser_id !== MATERIALISER_ID ||
    value.mode !== MODE ||
    value.verdict !== "GREEN" ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0 ||
    value.required_checkpoint.name !== "T75" ||
    value.required_checkpoint.validity_margin_ms !==
      T75_VALIDITY_MARGIN_MS ||
    value.required_checkpoint.required_valid_through !==
      value.valid_until ||
    value.required_checkpoint.final_jit_revalidation_required !==
      true
  ) {
    fail("t90_eligibility_report_invalid");
  }
  for (const field of [
    "publish_authority",
    "scheduler_authority",
    "database_authority",
    "external_publish_authorised",
    "platform_contacted",
    "database_mutated",
    "oauth_or_tokens_mutated",
  ]) {
    if (value[field] !== false) {
      fail("t90_eligibility_report_authority_forbidden");
    }
  }
  const supplied = exactSha256(
    value.report_sha256,
    "t90_eligibility_report_sha256_invalid",
  );
  const { report_sha256: _reportSha256, ...body } = value;
  if (canonicalSha256(body) !== supplied) {
    fail("t90_eligibility_report_sha256_mismatch");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "t90_eligibility_report_generated_at_invalid",
  );
  const validUntil = exactTimestamp(
    value.valid_until,
    "t90_eligibility_report_valid_until_invalid",
  );
  exactTimestamp(
    value.source_last_checked_at,
    "t90_eligibility_report_source_time_invalid",
  );
  exactTimestamp(
    value.scheduled_for,
    "t90_eligibility_report_schedule_invalid",
  );
  exactTimestamp(
    value.required_checkpoint.t75_at,
    "t90_eligibility_checkpoint_invalid",
  );
  exactSha256(
    value.request_sha256,
    "t90_eligibility_report_request_sha256_invalid",
  );
  exactSha256(
    value.source_set_sha256,
    "t90_eligibility_report_source_set_sha256_invalid",
  );
  for (const field of [
    "candidate_revision_sha256",
    "request_fingerprint",
    "jit_preparation_sha256",
    "story_intake_sha256",
    "source_evidence_sha256",
  ]) {
    exactSha256(
      value[field],
      `t90_eligibility_report_${field}_invalid`,
    );
  }
  if (
    value.channel_id !== "pulse-gaming" ||
    value.lane_id !== "breaking_short" ||
    value.platform !== "youtube" ||
    !["PRIMARY", "STANDBY"].includes(value.role)
  ) {
    fail("t90_eligibility_report_scope_invalid");
  }
  exactFields(
    value.upstream_source_apply_report,
    UPSTREAM_REFERENCE_FIELDS,
    "t90_eligibility_upstream_reference_invalid",
  );
  for (const field of ["file_sha256", "report_sha256"]) {
    exactSha256(
      value.upstream_source_apply_report[field],
      "t90_eligibility_upstream_reference_invalid",
    );
  }
  if (!text(value.upstream_source_apply_report.path)) {
    fail("t90_eligibility_upstream_reference_invalid");
  }
  const expected = options.expected;
  if (expected !== undefined) {
    exactFields(
      expected,
      EXPECTED_FIELDS,
      "t90_eligibility_expected_binding_invalid",
    );
    if (
      value.story_id !== text(expected.story_id) ||
      value.scheduled_for !== text(expected.scheduled_for)
    ) {
      fail("t90_eligibility_expected_binding_mismatch");
    }
  }
  if (options.now !== undefined) {
    const now =
      options.now instanceof Date
        ? new Date(options.now)
        : new Date(options.now);
    if (
      Number.isNaN(now.getTime()) ||
      Date.parse(generatedAt) > now.getTime() ||
      now.getTime() >= Date.parse(validUntil)
    ) {
      fail("t90_eligibility_report_not_current");
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function validateGovernedAutonomousT90EligibilitySourceReportForApply({
  value,
  bytes,
  expected,
  resolvedPath,
} = {}) {
  exactFields(
    expected,
    APPLY_VALIDATION_EXPECTED_FIELDS,
    "t90_eligibility_apply_expected_invalid",
  );
  const exactBytes = Buffer.isBuffer(bytes)
    ? Buffer.from(bytes)
    : bytes instanceof Uint8Array
      ? Buffer.from(bytes)
      : null;
  if (
    !exactBytes?.length ||
    !text(resolvedPath) ||
    !path.isAbsolute(resolvedPath)
  ) {
    fail("t90_eligibility_apply_artifact_invalid");
  }
  const fileSha256 = crypto
    .createHash("sha256")
    .update(exactBytes)
    .digest("hex");
  if (
    fileSha256 !==
    exactSha256(
      expected.file_sha256,
      "t90_eligibility_apply_file_sha256_invalid",
    )
  ) {
    fail("t90_eligibility_apply_file_sha256_mismatch");
  }
  let parsed;
  try {
    parsed = JSON.parse(exactBytes.toString("utf8"));
  } catch {
    fail("t90_eligibility_apply_artifact_invalid");
  }
  if (canonicalSha256(parsed) !== canonicalSha256(value)) {
    fail("t90_eligibility_apply_value_bytes_mismatch");
  }
  const report =
    validateGovernedAutonomousT90EligibilitySourceReport(
      value,
      {
        expected: {
          story_id: expected.story_id,
          scheduled_for: expected.scheduled_for,
        },
      },
    );
  for (const [actual, declared, code] of [
    [
      report.channel_id,
      expected.channel_id,
      "t90_eligibility_apply_channel_mismatch",
    ],
    [
      report.lane_id,
      expected.lane_id,
      "t90_eligibility_apply_lane_mismatch",
    ],
    [
      report.platform,
      expected.platform,
      "t90_eligibility_apply_platform_mismatch",
    ],
    [
      report.role,
      expected.role,
      "t90_eligibility_apply_role_mismatch",
    ],
    [
      report.report_sha256,
      expected.report_sha256,
      "t90_eligibility_apply_report_sha256_mismatch",
    ],
    [
      report.request_sha256,
      expected.request_sha256,
      "t90_eligibility_apply_request_sha256_mismatch",
    ],
    [
      report.generated_at,
      expected.generated_at,
      "t90_eligibility_apply_generated_at_mismatch",
    ],
    [
      report.valid_until,
      expected.valid_until,
      "t90_eligibility_apply_valid_until_mismatch",
    ],
    [
      report.jit_preparation_sha256,
      expected.jit_preparation_sha256,
      "t90_eligibility_apply_preparation_mismatch",
    ],
    [
      report.candidate_revision_sha256,
      expected.candidate_revision_sha256,
      "t90_eligibility_apply_candidate_revision_mismatch",
    ],
    [
      report.request_fingerprint,
      expected.request_fingerprint,
      "t90_eligibility_apply_request_fingerprint_mismatch",
    ],
    [
      report.source_evidence_sha256,
      expected.source_evidence_sha256,
      "t90_eligibility_apply_source_evidence_mismatch",
    ],
    [
      report.story_intake_sha256,
      expected.story_intake_sha256,
      "t90_eligibility_apply_story_intake_mismatch",
    ],
  ]) {
    if (text(actual).toLowerCase() !== text(declared).toLowerCase()) {
      fail(code);
    }
  }
  return {
    schema_version:
      APPLY_VALIDATION_RECEIPT_SCHEMA_VERSION,
    report_sha256: report.report_sha256,
    request_sha256: report.request_sha256,
    generated_at: report.generated_at,
    valid_until: report.valid_until,
  };
}

async function outputDirectory(outputPath, workspace, fileSystem) {
  if (!outputPath || !pathWithin(workspace, outputPath)) {
    fail("t90_eligibility_output_outside_workspace");
  }
  const parent = path.dirname(outputPath);
  await fileSystem.mkdir(parent, { recursive: true });
  let real;
  try {
    real = await fileSystem.realpath(parent);
  } catch {
    fail("t90_eligibility_output_directory_invalid");
  }
  if (!pathWithin(workspace, path.resolve(real))) {
    fail("t90_eligibility_output_directory_invalid");
  }
}

async function writeNoClobber({
  outputPath,
  report,
  workspace,
  fileSystem,
}) {
  await outputDirectory(outputPath, workspace, fileSystem);
  const bytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  try {
    const existing = await fileSystem.readFile(outputPath);
    if (!existing.equals(bytes)) {
      fail("t90_eligibility_output_conflict");
    }
    return { status: "IDEMPOTENT", bytes: existing };
  } catch (error) {
    if (
      error instanceof
      GovernedAutonomousT90EligibilitySourceReportError
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
      fail("t90_eligibility_output_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return { status: "APPLIED", bytes };
}

async function materialiseGovernedAutonomousT90EligibilitySourceReport(
  request,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const now = trustedNow(options.clock);
  const workspace = await safeWorkspaceRoot(
    options.workspaceRoot,
    fileSystem,
  );
  const input = normaliseRequest(request, now);
  if (!pathWithin(workspace, input.output_path)) {
    fail("t90_eligibility_output_outside_workspace");
  }
  const observation = await readBoundJson({
    reference: input.upstream_source_apply_report,
    workspace,
    fileSystem,
  });
  const source = validateUpstream(
    observation.value,
    input.upstream_source_apply_report,
    now,
  );
  const report = buildReport(
    input,
    observation.value,
    source,
    now,
  );
  validateGovernedAutonomousT90EligibilitySourceReport(report, {
    now,
    expected: {
      story_id: input.story_id,
      scheduled_for: input.scheduled_for,
    },
  });
  const written = await writeNoClobber({
    outputPath: input.output_path,
    report,
    workspace,
    fileSystem,
  });
  const fileSha256 = crypto
    .createHash("sha256")
    .update(written.bytes)
    .digest("hex");
  return Object.freeze({
    schema_version: RESULT_SCHEMA_VERSION,
    status: written.status,
    mutated: written.status === "APPLIED",
    idempotent: written.status === "IDEMPOTENT",
    report_path: input.output_path,
    report_file_sha256: fileSha256,
    report,
    source_snapshot: {
      discovered_at: input.discovered_at,
      source_last_checked_at: report.source_last_checked_at,
      publish_by: input.publish_by,
      stale_after: input.stale_after,
      stale_reframe_option: input.stale_reframe_option,
      source_report: {
        path: input.output_path,
        file_sha256: fileSha256,
        report_sha256: report.report_sha256,
        request_sha256: report.request_sha256,
        generated_at: report.generated_at,
        valid_until: report.valid_until,
      },
    },
    safety: {
      local_proof_only: true,
      network_used: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  });
}

module.exports = {
  MATERIALISER_ID,
  REPORT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  T75_VALIDITY_MARGIN_MS,
  GovernedAutonomousT90EligibilitySourceReportError,
  materialiseGovernedAutonomousT90EligibilitySourceReport,
  validateGovernedAutonomousT90EligibilitySourceReport,
  validateGovernedAutonomousT90EligibilitySourceReportForApply,
};
