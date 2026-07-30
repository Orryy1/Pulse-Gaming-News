"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateGovernedAutonomousPreT90CandidateComposition,
} = require("./governed-autonomous-pre-t90-candidate-composition");
const {
  admitAutonomousGovernedWindowCandidate,
  prepareGovernedWindowCandidateAuthority,
} = require("./governed-youtube-window-candidate-authority");
const {
  normaliseScript,
  scriptSha256: governedStoryScriptSha256,
} = require("./governed-story-intake");
const {
  validateGovernedAutonomousT90EligibilitySourceReportForApply:
    defaultSourceReportValidator,
} = require("./governed-autonomous-t90-eligibility-source-report");
const {
  validateGovernedAutonomousDatabaseStoryBinding,
} = require("./governed-autonomous-database-story-binding");
const {
  canonicalUrl,
} = require("./url-canonical");
const {
  evaluateGovernedBreakingLaneEligibility,
  latestGovernedDecisionFromRepositories,
} = require("./governed-breaking-lane-eligibility");

const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-candidate-application-result-v1";
const SOURCE_REPORT_VALIDATION_SCHEMA_VERSION =
  "pulse-governed-t90-source-report-validation-v1";
const APPROVAL_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CANONICAL_EDITORIAL_COPY_FIELDS = Object.freeze([
  "title",
  "url",
  "score",
  "flair",
  "subreddit",
  "source_type",
  "breaking_score",
  "top_comment",
  "timestamp",
  "num_comments",
  "hook",
  "body",
  "loop",
  "full_script",
  "tts_script",
  "word_count",
  "suggested_title",
  "suggested_thumbnail_text",
  "content_pillar",
  "affiliate_url",
  "pinned_comment",
  "article_image",
  "article_url",
  "company_name",
  "company_logo_url",
  "classification",
  "quality_score",
  "title_variants",
  "active_title_index",
  "game_images",
  "downloaded_images",
  "video_clips",
  "story_image_path",
  "cta",
  "created_at",
  "channel_id",
  "source_url_hash",
  "hf_thumbnail_path",
]);
const LEGACY_EXTERNAL_STATE_FIELDS = Object.freeze([
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "published_at",
  "youtube_published_at",
  "publish_error",
  "discord_video_drop_posted_at",
  "discord_story_poll_posted_at",
]);

class GovernedAutonomousPreT90CandidateApplicationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "GovernedAutonomousPreT90CandidateApplicationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, details) {
  throw new GovernedAutonomousPreT90CandidateApplicationError(code, details);
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = new Date(raw);
  if (
    !raw ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== raw
  ) {
    fail(code);
  }
  return parsed;
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code);
  }
  return value;
}

function requireRepositories(repos) {
  if (
    !repos?.db ||
    typeof repos.db.prepare !== "function" ||
    typeof repos.db.transaction !== "function" ||
    typeof repos.stories?.get !== "function" ||
    typeof repos.jobs?.enqueueInTransaction !== "function" ||
    typeof repos.publicationGovernance?.recordOperatorDecision !== "function"
  ) {
    fail("pre_t90_apply_repositories_required");
  }
  return repos;
}

function canonicalRoot(rootPath, code) {
  const supplied = text(rootPath);
  if (!supplied || !path.isAbsolute(supplied)) fail(code);
  let stat;
  let real;
  try {
    stat = fs.lstatSync(supplied);
    real = fs.realpathSync(supplied);
  } catch {
    fail(code);
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    path.resolve(real) !== path.resolve(supplied)
  ) {
    fail(code);
  }
  return real;
}

function pathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function exactBoundFile({
  declaredPath,
  roots,
  extension,
  code,
}) {
  const supplied = text(declaredPath);
  if (!supplied) fail(code);
  const candidates = path.isAbsolute(supplied)
    ? [path.resolve(supplied)]
    : roots.map((root) => path.resolve(root, supplied));
  for (const candidate of candidates) {
    let stat;
    let real;
    try {
      stat = fs.lstatSync(candidate);
      real = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      roots.some((root) => pathInside(root, real)) &&
      path.extname(real).toLowerCase() === extension
    ) {
      return real;
    }
  }
  fail(code);
}

function bytesFromReader(readMediaBytes, filePath) {
  let raw;
  try {
    raw = readMediaBytes(filePath);
  } catch {
    fail("pre_t90_apply_media_read_failed");
  }
  const bytes = Buffer.isBuffer(raw)
    ? Buffer.from(raw)
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : null;
  if (!bytes?.length) fail("pre_t90_apply_media_empty");
  return bytes;
}

function inspectMedia({
  candidate,
  workspaceRoot,
  readMediaBytes,
}) {
  const preparation = candidate.eligibility.jit_preparation;
  const declaredPath = text(preparation.artifacts.final_mp4.path);
  const expectedSha256 = exactSha256(
    candidate.eligibility.evidence_hashes.media_sha256,
    "pre_t90_apply_media_sha256_invalid",
  );
  if (
    exactSha256(
      preparation.artifacts.final_mp4.sha256,
      "pre_t90_apply_media_sha256_invalid",
    ) !== expectedSha256
  ) {
    fail("pre_t90_apply_media_binding_mismatch");
  }
  const resolvedPath = exactBoundFile({
    declaredPath,
    roots: [workspaceRoot],
    extension: ".mp4",
    code: "pre_t90_apply_media_path_forbidden",
  });
  const actualSha256 = sha256Bytes(
    bytesFromReader(readMediaBytes, resolvedPath),
  );
  if (actualSha256 !== expectedSha256) {
    fail("pre_t90_apply_media_hash_mismatch", {
      story_id: candidate.story_id,
      expected_sha256: expectedSha256,
      observed_sha256: actualSha256,
    });
  }
  return {
    story_id: candidate.story_id,
    declared_path: declaredPath,
    resolved_path: resolvedPath,
    sha256: actualSha256,
  };
}

function exactValidationReceipt(value, expected) {
  const receipt = exactObject(
    value,
    "pre_t90_apply_source_report_validation_invalid",
  );
  const fields = [
    "schema_version",
    "report_sha256",
    "request_sha256",
    "generated_at",
    "valid_until",
  ].sort();
  const actualFields = Object.keys(receipt).sort();
  if (
    actualFields.length !== fields.length ||
    actualFields.some((field, index) => field !== fields[index]) ||
    receipt.schema_version !== SOURCE_REPORT_VALIDATION_SCHEMA_VERSION ||
    exactSha256(
      receipt.report_sha256,
      "pre_t90_apply_source_report_validation_invalid",
    ) !== expected.report_sha256 ||
    exactSha256(
      receipt.request_sha256,
      "pre_t90_apply_source_report_validation_invalid",
    ) !== expected.request_sha256 ||
    exactTimestamp(
      receipt.generated_at,
      "pre_t90_apply_source_report_validation_invalid",
    ).toISOString() !== expected.generated_at ||
    exactTimestamp(
      receipt.valid_until,
      "pre_t90_apply_source_report_validation_invalid",
    ).toISOString() !== expected.valid_until
  ) {
    fail("pre_t90_apply_source_report_validation_invalid");
  }
  return receipt;
}

function inspectSourceReport({
  candidate,
  evidenceRoots,
  sourceReportValidator,
}) {
  if (typeof sourceReportValidator !== "function") {
    fail("pre_t90_apply_source_report_validator_required");
  }
  const expected = candidate.eligibility.attestation.source_report;
  const resolvedPath = exactBoundFile({
    declaredPath: expected.path,
    roots: evidenceRoots,
    extension: ".json",
    code: "pre_t90_apply_source_report_path_forbidden",
  });
  let bytes;
  try {
    bytes = fs.readFileSync(resolvedPath);
  } catch {
    fail("pre_t90_apply_source_report_read_failed");
  }
  if (
    !bytes.length ||
    sha256Bytes(bytes) !==
      exactSha256(
        expected.file_sha256,
        "pre_t90_apply_source_report_file_sha256_invalid",
      )
  ) {
    fail("pre_t90_apply_source_report_file_hash_mismatch", {
      story_id: candidate.story_id,
    });
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("pre_t90_apply_source_report_json_invalid");
  }
  const expectedValidation = {
    story_id: candidate.story_id,
    channel_id: candidate.channel_id,
    lane_id: candidate.lane_id,
    platform: candidate.platform,
    role: candidate.role,
    scheduled_for: candidate.scheduled_for,
    jit_preparation_sha256:
      candidate.eligibility.jit_preparation.preparation_sha256,
    candidate_revision_sha256:
      candidate.candidate_revision_sha256,
    request_fingerprint: candidate.request_fingerprint,
    source_evidence_sha256:
      candidate.eligibility.evidence_hashes
        .source_evidence_sha256,
    story_intake_sha256:
      candidate.eligibility.jit_preparation.artifacts.story_intake
        .sha256,
    file_sha256: expected.file_sha256,
    report_sha256: expected.report_sha256,
    request_sha256: expected.request_sha256,
    generated_at: expected.generated_at,
    valid_until: expected.valid_until,
  };
  let validation;
  try {
    validation = sourceReportValidator({
      value,
      bytes: Buffer.from(bytes),
      expected: expectedValidation,
      resolvedPath,
    });
  } catch (error) {
    fail("pre_t90_apply_source_report_validation_failed", {
      story_id: candidate.story_id,
      cause_code: text(error?.code || error?.message) || null,
    });
  }
  exactValidationReceipt(validation, expectedValidation);
  return {
    story_id: candidate.story_id,
    declared_path: expected.path,
    resolved_path: resolvedPath,
    file_sha256: expected.file_sha256,
    report_sha256: expected.report_sha256,
    request_sha256: expected.request_sha256,
  };
}

function parseStoryExtra(story) {
  let value;
  try {
    value = JSON.parse(story?._extra || "{}");
  } catch {
    fail("pre_t90_apply_story_extra_invalid");
  }
  return exactObject(value, "pre_t90_apply_story_extra_invalid");
}

function stableEqual(left, right) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((field) => [field, stable(value[field])]),
      );
    }
    return value;
  };
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function assertShadowValue(extra, field, expected, normalise = (value) => value) {
  if (
    Object.hasOwn(extra, field) &&
    !stableEqual(normalise(extra[field]), normalise(expected))
  ) {
    fail("pre_t90_apply_story_extra_shadow_conflict", { field });
  }
}

function isBreakingStory(
  story,
  extra,
  repos,
  candidate,
  now,
) {
  const decisionStoryId =
    text(
      candidate?.database_story_binding
        ?.database_story_id,
    ) || text(story?.id);
  return evaluateGovernedBreakingLaneEligibility({
    story,
    extra,
    eligibilityAttestation:
      candidate?.eligibility?.attestation,
    attestationNow: now,
    expectedAttestation: {
      story_id: candidate?.story_id,
      channel_id: candidate?.channel_id,
      lane_id: candidate?.lane_id,
      platform: candidate?.platform,
      scheduled_for: candidate?.scheduled_for,
      role: candidate?.role,
      jit_preparation:
        candidate?.eligibility?.jit_preparation,
    },
    expectedFastNewsStoryId: decisionStoryId,
    latestGovernedDecision:
      latestGovernedDecisionFromRepositories(
        repos,
        decisionStoryId,
      ),
  }).eligible;
}

function projectionMarker({
  binding,
  markerRole,
  candidate,
  composition,
}) {
  return {
    schema_version:
      "pulse-governed-autonomous-canonical-story-projection-v1",
    role: markerRole,
    window_role: candidate.role,
    scheduled_for: candidate.scheduled_for,
    candidate_revision_sha256:
      candidate.candidate_revision_sha256,
    request_fingerprint: candidate.request_fingerprint,
    final_mp4_sha256:
      candidate.eligibility.evidence_hashes.media_sha256,
    composition_sha256: composition.composition_sha256,
    canonical_story_id: binding.canonical_story_id,
    legacy_story_id: binding.database_story_id,
    canonical_identity_url: binding.canonical_identity_url,
    inventory_file_sha256: binding.inventory_file_sha256,
    final_script_sha256: binding.final_script_sha256,
    binding_sha256: binding.binding_sha256,
  };
}

function exactProjectionMarker(
  extra,
  binding,
  markerRole,
  candidate,
  composition,
) {
  const observed =
    extra.governed_autonomous_canonical_projection;
  if (
    !observed ||
    typeof observed !== "object" ||
    Array.isArray(observed) ||
    !stableEqual(
      observed,
      projectionMarker({
        binding,
        markerRole,
        candidate,
        composition,
      }),
    )
  ) {
    fail("pre_t90_apply_canonical_projection_conflict");
  }
}

function storyCanonicalIdentityUrl(story, extra) {
  for (const candidate of [
    story.canonical_identity_url,
    story.primary_source_url,
    story.url,
    story.article_url,
    extra.canonical_identity_url,
    extra.primary_source_url,
  ]) {
    if (canonicalUrl(candidate)) return canonicalUrl(candidate);
  }
  return "";
}

function requireNoExternalPublicationState(
  story,
  { allowExported = false } = {},
) {
  if (
    LEGACY_EXTERNAL_STATE_FIELDS.some((field) =>
      text(story?.[field]),
    ) ||
    (!allowExported && text(story?.exported_path)) ||
    (!allowExported && text(story?.schedule_time))
  ) {
    fail("pre_t90_apply_database_story_publication_state_conflict");
  }
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM sqlite_master
         WHERE type = 'table' AND name = ?
         LIMIT 1`,
      )
      .get(tableName),
  );
}

function exactActiveProducerForBinding(
  row,
  candidate,
  binding,
) {
  let payload;
  try {
    payload =
      typeof row.payload === "string"
        ? JSON.parse(row.payload)
        : row.payload;
  } catch {
    return false;
  }
  const builder =
    payload?.autonomous_production_job?.builder_result;
  return (
    ["claimed", "running"].includes(text(row.status)) &&
    text(row.kind) === "produce_breaking_short" &&
    text(payload?.story_id) === candidate.story_id &&
    text(payload?.candidate_revision_sha256).toLowerCase() ===
      candidate.candidate_revision_sha256 &&
    text(builder?.story_id) === candidate.story_id &&
    text(
      builder?.production_request
        ?.candidate_revision_sha256,
    ).toLowerCase() === candidate.candidate_revision_sha256 &&
    text(
      builder?.production_request?.locked_intake
        ?.database_story_binding?.binding_sha256,
    ).toLowerCase() === binding.binding_sha256
  );
}

function assertNoLegacyPublicationRows(
  repos,
  storyId,
  candidate,
  binding,
) {
  for (const tableName of [
    "platform_posts",
    "publication_lifecycle_events",
    "platform_dispatch_ledger",
    "platform_publication_state",
    "publication_authority_audit_log",
  ]) {
    if (
      tableExists(repos.db, tableName) &&
      repos.db
        .prepare(
          `SELECT 1 FROM "${tableName}" WHERE story_id = ? LIMIT 1`,
        )
        .get(storyId)
    ) {
      fail(
        "pre_t90_apply_database_story_publication_state_conflict",
      );
    }
  }
  if (
    tableExists(repos.db, "operator_audit_log") &&
    repos.db
      .prepare(
        `SELECT 1
         FROM operator_audit_log
         WHERE target_type = 'story'
           AND target_id = ?
           AND action IN (
             'governed_youtube_window_primary',
             'governed_youtube_runway_standby'
           )
         LIMIT 1`,
      )
      .get(storyId)
  ) {
    fail("pre_t90_apply_database_story_publication_state_conflict");
  }
  if (
    tableExists(repos.db, "jobs")
  ) {
    const activeJobs = repos.db
      .prepare(
        `SELECT kind, status, payload
         FROM jobs
         WHERE story_id = ?
           AND status IN ('pending', 'claimed', 'running')
         ORDER BY id`,
      )
      .all(storyId);
    if (
      activeJobs.length > 1 ||
      activeJobs.some(
        (row) =>
          !exactActiveProducerForBinding(
            row,
            candidate,
            binding,
          ),
      )
    ) {
      fail("pre_t90_apply_database_story_active_job_conflict");
    }
  }
}

function requireProjectionSourceStory(
  story,
  binding,
  repos,
  candidate,
  now,
) {
  if (!story) fail("pre_t90_apply_database_story_not_found");
  const extra = parseStoryExtra(story);
  const consumed =
    text(story.publish_status).toLowerCase() ===
    "canonical_projection_consumed";
  const hasMarker = Object.hasOwn(
    extra,
    "governed_autonomous_canonical_projection",
  );
  if (
    text(story.id) !== binding.database_story_id ||
    (consumed
      ? story.approved !== 0 ||
        story.auto_approved !== 0 ||
        !hasMarker
      : (story.approved !== 1 && story.approved !== true) ||
        (story.auto_approved !== 1 &&
          story.auto_approved !== true) ||
        hasMarker)
  ) {
    fail("pre_t90_apply_database_story_approval_required");
  }
  requireNoExternalPublicationState(story);
  assertNoLegacyPublicationRows(
    repos,
    binding.database_story_id,
    candidate,
    binding,
  );
  if (
    text(story.youtube_post_id) ||
    text(story.channel_id) !== "pulse-gaming" ||
    governedStoryScriptSha256(story.full_script) !==
      binding.final_script_sha256 ||
    storyCanonicalIdentityUrl(story, extra) !==
      canonicalUrl(binding.canonical_identity_url)
  ) {
    fail("pre_t90_apply_database_story_binding_mismatch");
  }
  if (
    !isBreakingStory(
      story,
      extra,
      repos,
      candidate,
      now,
    )
  ) {
    fail("pre_t90_apply_story_breaking_lane_required");
  }
  return { story, extra, consumed };
}

function projectCanonicalStory({
  repos,
  candidate,
  composition,
  now,
}) {
  if (candidate.database_story_binding === null) {
    return { projected: false };
  }
  let binding;
  try {
    binding =
      validateGovernedAutonomousDatabaseStoryBinding(
        candidate.database_story_binding,
        {
          canonical_story_id: candidate.story_id,
          final_script_sha256:
            candidate.eligibility.evidence_hashes.script_sha256,
        },
      );
  } catch (error) {
    fail("pre_t90_apply_database_story_binding_invalid", {
      cause_code: text(error?.code || error?.message) || null,
    });
  }
  if (binding.database_story_id === binding.canonical_story_id) {
    return { projected: false, binding };
  }

  const source = requireProjectionSourceStory(
    repos.stories.get(binding.database_story_id),
    binding,
    repos,
    candidate,
    now,
  );
  const existing = repos.stories.get(binding.canonical_story_id);
  if (existing) {
    const existingExtra = parseStoryExtra(existing);
    exactProjectionMarker(
      existingExtra,
      binding,
      "CANONICAL",
      candidate,
      composition,
    );
    exactProjectionMarker(
      source.extra,
      binding,
      "LEGACY_ALIAS_CONSUMED",
      candidate,
      composition,
    );
    requireNoExternalPublicationState(existing, {
      allowExported: true,
    });
    if (
      (existing.approved !== 1 && existing.approved !== true) ||
      (existing.auto_approved !== 1 &&
        existing.auto_approved !== true) ||
      governedStoryScriptSha256(existing.full_script) !==
        binding.final_script_sha256 ||
      storyCanonicalIdentityUrl(existing, existingExtra) !==
        canonicalUrl(binding.canonical_identity_url) ||
      text(existing.channel_id) !== candidate.channel_id
    ) {
      fail("pre_t90_apply_canonical_projection_conflict");
    }
    return { projected: false, binding };
  }
  if (source.consumed) {
    fail("pre_t90_apply_canonical_projection_incomplete");
  }

  const schemaColumns = new Set(
    repos.db
    .prepare("PRAGMA table_info(stories)")
    .all()
    .map((column) => text(column.name))
    .filter(Boolean),
  );
  if (
    !schemaColumns.has("id") ||
    !schemaColumns.has("_extra") ||
    !schemaColumns.has("publish_status") ||
    !schemaColumns.has("approved") ||
    !schemaColumns.has("auto_approved") ||
    !schemaColumns.has("full_script")
  ) {
    fail("pre_t90_apply_story_schema_invalid");
  }
  const canonicalExtra = {
    ...source.extra,
    id: binding.canonical_story_id,
    story_id: binding.canonical_story_id,
    governed_autonomous_canonical_projection:
      projectionMarker({
        binding,
        markerRole: "CANONICAL",
        candidate,
        composition,
      }),
  };
  const copyFields =
    CANONICAL_EDITORIAL_COPY_FIELDS.filter((field) =>
      schemaColumns.has(field),
    );
  const columns = [
    "id",
    ...copyFields,
    "approved",
    "auto_approved",
    "approved_at",
    "publish_status",
    "updated_at",
    "_extra",
  ].filter(
    (field, index, fields) =>
      schemaColumns.has(field) &&
      fields.indexOf(field) === index,
  );
  const quoted = columns.map(
    (column) => `"${column.replaceAll('"', '""')}"`,
  );
  const values = columns.map((column) => {
    if (column === "id") return binding.canonical_story_id;
    if (column === "approved" || column === "auto_approved") {
      return 1;
    }
    if (column === "_extra") return JSON.stringify(canonicalExtra);
    if (column === "publish_status") return "";
    if (column === "updated_at") return now.toISOString();
    return source.story[column] ?? null;
  });
  const inserted = repos.db
    .prepare(
      `INSERT INTO stories (${quoted.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...values);
  if (inserted.changes !== 1) {
    fail("pre_t90_apply_canonical_projection_insert_failed");
  }

  const legacyExtra = {
    ...source.extra,
    governed_autonomous_canonical_projection:
      projectionMarker({
        binding,
        markerRole: "LEGACY_ALIAS_CONSUMED",
        candidate,
        composition,
      }),
  };
  const consumed = repos.db
    .prepare(
      `UPDATE stories
       SET approved = 0,
           auto_approved = 0,
           exported_path = NULL,
           audio_path = NULL,
           image_path = NULL,
           schedule_time = NULL,
           publish_status = 'canonical_projection_consumed',
           _extra = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(legacyExtra),
      now.toISOString(),
      binding.database_story_id,
    );
  if (consumed.changes !== 1) {
    fail("pre_t90_apply_legacy_projection_marker_failed");
  }
  return { projected: true, binding };
}

function mediaProjection(composition, candidate, media) {
  return {
    media_sha256: media.sha256,
    final_mp4_sha256: media.sha256,
    script_sha256: candidate.eligibility.evidence_hashes.script_sha256,
    autonomous_pre_t90_composition_sha256:
      composition.composition_sha256,
    autonomous_pre_t90_candidate_role: candidate.role,
    autonomous_pre_t90_scheduled_for: composition.scheduled_for,
  };
}

function validateStory({
  repos,
  composition,
  candidate,
  media,
  now,
}) {
  const story = repos.stories.get(candidate.story_id);
  if (!story) fail("pre_t90_apply_story_not_found");
  const extra = parseStoryExtra(story);
  if (story.approved !== 1 && story.approved !== true) {
    fail("pre_t90_apply_story_approval_required");
  }
  if (
    story.auto_approved !== 1 &&
    story.auto_approved !== true
  ) {
    fail("pre_t90_apply_story_auto_approval_required");
  }
  if (text(story.youtube_post_id)) {
    fail("pre_t90_apply_story_already_published");
  }
  if (text(story.channel_id) !== candidate.channel_id) {
    fail("pre_t90_apply_story_channel_mismatch");
  }
  if (
    !isBreakingStory(
      story,
      extra,
      repos,
      candidate,
      now,
    )
  ) {
    fail("pre_t90_apply_story_breaking_lane_required");
  }
  const scriptText = normaliseScript(story.full_script);
  const scriptSha256 = governedStoryScriptSha256(story.full_script);
  if (
    !scriptText ||
    scriptSha256 !== candidate.eligibility.evidence_hashes.script_sha256
  ) {
    fail("pre_t90_apply_story_script_hash_mismatch");
  }
  if (
    text(story.exported_path) &&
    text(story.exported_path) !== media.declared_path
  ) {
    fail("pre_t90_apply_story_media_binding_conflict");
  }
  const projection = mediaProjection(composition, candidate, media);
  assertShadowValue(extra, "id", candidate.story_id, text);
  assertShadowValue(extra, "story_id", candidate.story_id, text);
  assertShadowValue(extra, "channel_id", candidate.channel_id, text);
  assertShadowValue(extra, "lane_id", candidate.lane_id, text);
  assertShadowValue(
    extra,
    "approved",
    true,
    (value) => value === true || value === 1,
  );
  assertShadowValue(extra, "youtube_post_id", null, (value) => text(value));
  assertShadowValue(extra, "exported_path", media.declared_path, text);
  assertShadowValue(
    extra,
    "full_script",
    scriptText,
    normaliseScript,
  );
  assertShadowValue(extra, "full_script_sha256", scriptSha256, text);
  for (const [field, expected] of Object.entries(projection)) {
    assertShadowValue(extra, field, expected, text);
  }
  return {
    story,
    extra,
    projection,
    already_bound: text(story.exported_path) === media.declared_path,
  };
}

function prepareCandidate({ candidate, repos, generatedAt }) {
  return prepareGovernedWindowCandidateAuthority({
    repos,
    storyId: candidate.story_id,
    role: candidate.role,
    scheduledFor: candidate.scheduled_for,
    approval: {
      type: APPROVAL_TYPE,
      eligibilityAttestation: candidate.eligibility.attestation,
      jitPreparation: candidate.eligibility.jit_preparation,
    },
    now: new Date(generatedAt),
  });
}

function exactExistingAuthority(repos, prepared) {
  const row = repos.db
    .prepare(
      `SELECT id, evidence_json
       FROM operator_audit_log
       WHERE action = ?
         AND target_type = 'story'
         AND target_id = ?
         AND decision = 'APPROVED'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(
      prepared.authority.role === "PRIMARY"
        ? "governed_youtube_window_primary"
        : "governed_youtube_runway_standby",
      prepared.authority.story_id,
    );
  if (!row) return false;
  let evidence;
  try {
    evidence = JSON.parse(row.evidence_json);
  } catch {
    fail("pre_t90_apply_existing_authority_invalid");
  }
  return (
    evidence.authority_binding_sha256 ===
    prepared.authority.authority_binding_sha256
  );
}

function applyGovernedAutonomousPreT90CandidateComposition(options = {}) {
  const composition =
    validateGovernedAutonomousPreT90CandidateComposition(
      options.composition,
    );
  const repos = requireRepositories(options.repos);
  const workspaceRoot = canonicalRoot(
    options.workspaceRoot,
    "pre_t90_apply_workspace_root_invalid",
  );
  const evidenceRoots = (
    Array.isArray(options.allowedEvidenceRoots)
      ? options.allowedEvidenceRoots
      : [workspaceRoot]
  ).map((root) =>
    canonicalRoot(root, "pre_t90_apply_evidence_root_invalid"),
  );
  const now = exactTimestamp(
    options.now,
    "pre_t90_apply_time_invalid",
  );
  const readMediaBytes =
    options.readMediaBytes === undefined
      ? fs.readFileSync
      : options.readMediaBytes;
  const sourceReportValidator =
    options.sourceReportValidator === undefined
      ? defaultSourceReportValidator
      : options.sourceReportValidator;
  if (typeof readMediaBytes !== "function") {
    fail("pre_t90_apply_media_reader_invalid");
  }

  const media = composition.candidates.map((candidate) =>
    inspectMedia({ candidate, workspaceRoot, readMediaBytes }),
  );
  const sourceReports = composition.candidates.map((candidate) =>
    inspectSourceReport({
      candidate,
      evidenceRoots,
      sourceReportValidator,
    }),
  );
  const transaction = repos.db.transaction(() => {
    const projections = composition.candidates.map(
      (candidate) =>
        projectCanonicalStory({
          repos,
          candidate,
          composition,
          now,
        }),
    );
    const stories = composition.candidates.map((candidate, index) =>
      validateStory({
        repos,
        composition,
        candidate,
        media: media[index],
        now,
      }),
    );
    const prepared = composition.candidates.map((candidate) =>
      prepareCandidate({
        candidate,
        repos,
        generatedAt: composition.generated_at,
      }),
    );
    const existingAuthorities = prepared.map((entry) =>
      exactExistingAuthority(repos, entry),
    );
    const exactReplay =
      existingAuthorities.every(Boolean) &&
      stories.every((entry) => entry.already_bound);
    if (existingAuthorities.some(Boolean) && !exactReplay) {
      fail("pre_t90_apply_inconsistent_replay_state");
    }
    if (
      now.getTime() > Date.parse(composition.t90_at) &&
      !exactReplay
    ) {
      fail("pre_t90_apply_new_application_after_t90_forbidden");
    }

    if (!exactReplay) {
      const update = repos.db.prepare(
        `UPDATE stories
         SET exported_path = ?, _extra = ?, updated_at = ?
         WHERE id = ?`,
      );
      composition.candidates.forEach((candidate, index) => {
        const state = stories[index];
        const result = update.run(
          media[index].declared_path,
          JSON.stringify({
            ...state.extra,
            ...state.projection,
          }),
          now.toISOString(),
          candidate.story_id,
        );
        if (result.changes !== 1) {
          fail("pre_t90_apply_story_media_update_failed");
        }
      });
    }

    const admissions = composition.candidates.map((candidate, index) => {
      const authority = prepared[index].authority;
      return admitAutonomousGovernedWindowCandidate({
        ...prepared[index].request,
        repos,
        confirmStoryId: candidate.story_id,
        confirmRole: candidate.role,
        confirmScheduledFor: candidate.scheduled_for,
        confirmAuthorityBindingSha256:
          authority.authority_binding_sha256,
        now: new Date(composition.generated_at),
      });
    });

    composition.candidates.forEach((candidate, index) => {
      inspectMedia({ candidate, workspaceRoot, readMediaBytes });
      inspectSourceReport({
        candidate,
        evidenceRoots,
        sourceReportValidator,
      });
      const rebound = repos.stories.get(candidate.story_id);
      if (
        text(rebound.exported_path) !== media[index].declared_path
      ) {
        fail("pre_t90_apply_story_media_postcondition_failed");
      }
    });
    return { admissions, exactReplay, projections };
  });

  const result = transaction.immediate();
  const mutated =
    !result.exactReplay ||
    result.projections.some((entry) => entry.projected) ||
    result.admissions.some((entry) => entry.mutated);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    verdict: mutated ? "APPLIED" : "EXISTS",
    composition_sha256: composition.composition_sha256,
    applied_at: now.toISOString(),
    scheduled_for: composition.scheduled_for,
    t90_at: composition.t90_at,
    candidates: result.admissions.map((admission, index) => ({
      story_id: admission.story_id,
      role: admission.role,
      verdict: admission.verdict,
      exported_path: media[index].declared_path,
      media_sha256: media[index].sha256,
      source_report_file_sha256: sourceReports[index].file_sha256,
      authority_binding_sha256:
        admission.authority_binding_sha256,
      authority_audit_id: admission.authority_audit_id,
      admission_job_id: admission.admission_job_id,
    })),
    database_mutated: mutated,
    external_posting: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    platform_contacted: false,
    network_used: false,
    oauth_or_tokens_mutated: false,
  };
}

module.exports = {
  GovernedAutonomousPreT90CandidateApplicationError,
  RESULT_SCHEMA_VERSION,
  SOURCE_REPORT_VALIDATION_SCHEMA_VERSION,
  applyGovernedAutonomousPreT90CandidateComposition,
};
