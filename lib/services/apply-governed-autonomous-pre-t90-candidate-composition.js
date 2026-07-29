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

const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-pre-t90-candidate-application-result-v1";
const SOURCE_REPORT_VALIDATION_SCHEMA_VERSION =
  "pulse-governed-t90-source-report-validation-v1";
const APPROVAL_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertShadowValue(extra, field, expected, normalise = (value) => value) {
  if (
    Object.hasOwn(extra, field) &&
    !stableEqual(normalise(extra[field]), normalise(expected))
  ) {
    fail("pre_t90_apply_story_extra_shadow_conflict", { field });
  }
}

function isBreakingStory(story, extra) {
  return (
    extra.breaking_fast_track === true ||
    extra.breaking === true ||
    Number(story.breaking_score || 0) >= 80 ||
    /\bbreaking\b/i.test(`${story.classification || ""} ${story.flair || ""}`)
  );
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
}) {
  const story = repos.stories.get(candidate.story_id);
  if (!story) fail("pre_t90_apply_story_not_found");
  const extra = parseStoryExtra(story);
  if (story.approved !== 1 && story.approved !== true) {
    fail("pre_t90_apply_story_approval_required");
  }
  if (text(story.youtube_post_id)) {
    fail("pre_t90_apply_story_already_published");
  }
  if (text(story.channel_id) !== candidate.channel_id) {
    fail("pre_t90_apply_story_channel_mismatch");
  }
  if (!isBreakingStory(story, extra)) {
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
    const stories = composition.candidates.map((candidate, index) =>
      validateStory({
        repos,
        composition,
        candidate,
        media: media[index],
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
    return { admissions, exactReplay };
  });

  const result = transaction.immediate();
  const mutated =
    !result.exactReplay ||
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
