"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  canonicalSha256,
  GUARDED_PUBLISH_HOURS_UTC,
  validateAutonomousWindowEligibilityAttestation,
} = require("./governed-youtube-release-runway");
const {
  validateAutonomousOfficialJitPreparationManifest,
} = require("./autonomous-official-jit-admission-packet");
const { buildCandidateRevision } = require("./multi-lane-job-routing");
const {
  youtubeAdmissionJobIdempotencyKey,
} = require("./governed-publication-job-identity");
const {
  validateOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  validateControlledExperimentObservation,
} = require("./controlled-experiment-observation");

const AUTHORITY_SCHEMA_VERSION =
  "pulse-governed-youtube-window-candidate-authority-v1";
const ADMISSION_SCHEMA_VERSION = "pulse-governed-window-candidate-admission-v1";
const PLATFORM = "youtube";
const ROLES = new Set(["PRIMARY", "STANDBY"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ADMISSION_OFFSET_MS = 75 * 60 * 1000;
const HUMAN_APPROVAL_TYPE = "HUMAN";
const AUTONOMOUS_APPROVAL_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const AUTONOMOUS_AUDIT_ACTOR =
  "pulse-autonomous-window-candidate-authority";
const AUTONOMOUS_FORBIDDEN_ADMISSION_FIELDS = Object.freeze([
  "human_review_status",
  "human_review_event_id",
  "human_review_evidence_sha256",
  "human_review_audit_id",
  "humanReviewAuditId",
  "operator",
  "actor_id",
  "reason",
  "autonomous_publication_authority",
]);

function text(value) {
  return String(value ?? "").trim();
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
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
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

function objectValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function parseObject(value, code) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(code);
    }
    return parsed;
  } catch (error) {
    if (error?.code === code) throw error;
    fail(code);
  }
}

function exactObjectFields(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code);
  }
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

function approvalVariant({ approval, humanReviewAuditId, actorId, reason }) {
  if (approval === undefined || approval === null) {
    return {
      type: HUMAN_APPROVAL_TYPE,
      humanReviewAuditId,
    };
  }
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    fail("governed_window_candidate_approval_union_invalid");
  }
  const type = text(approval.type).toUpperCase();
  if (type === HUMAN_APPROVAL_TYPE) {
    exactObjectFields(
      approval,
      ["type", "humanReviewAuditId"],
      "governed_window_candidate_human_approval_fields_invalid",
    );
    if (humanReviewAuditId !== undefined) {
      fail("governed_window_candidate_approval_cross_conflation");
    }
    return {
      type,
      humanReviewAuditId: approval.humanReviewAuditId,
    };
  }
  if (type === AUTONOMOUS_APPROVAL_TYPE) {
    exactObjectFields(
      approval,
      ["type", "eligibilityAttestation", "jitPreparation"],
      "governed_window_candidate_autonomous_approval_fields_invalid",
    );
    if (
      humanReviewAuditId !== undefined ||
      actorId !== undefined ||
      reason !== undefined
    ) {
      fail("governed_window_candidate_approval_cross_conflation");
    }
    return {
      type,
      eligibilityAttestation: approval.eligibilityAttestation,
      jitPreparation: approval.jitPreparation,
    };
  }
  fail("governed_window_candidate_approval_type_invalid");
}

function exactRole(value) {
  const role = text(value).toUpperCase();
  if (!ROLES.has(role)) {
    fail("governed_window_candidate_role_invalid");
  }
  return role;
}

function exactActorReason(actorId, reason) {
  const actor = text(actorId);
  const rationale = text(reason);
  if (!actor) fail("governed_window_candidate_actor_required");
  if (!rationale) fail("governed_window_candidate_reason_required");
  return { actor, rationale };
}

function exactSchedule(value) {
  const schedule = new Date(value);
  if (
    Number.isNaN(schedule.getTime()) ||
    !GUARDED_PUBLISH_HOURS_UTC.has(schedule.getUTCHours()) ||
    schedule.getUTCMinutes() !== 0 ||
    schedule.getUTCSeconds() !== 0 ||
    schedule.getUTCMilliseconds() !== 0
  ) {
    fail("governed_window_candidate_exact_window_required");
  }
  return schedule;
}

function effectiveNow(value) {
  const now = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(now.getTime())) {
    fail("governed_window_candidate_time_invalid");
  }
  return now;
}

function requireRepositories(repos) {
  if (
    !repos?.db ||
    typeof repos.db.prepare !== "function" ||
    !repos.stories ||
    typeof repos.stories.get !== "function" ||
    !repos.jobs ||
    typeof repos.jobs.enqueueInTransaction !== "function" ||
    !repos.publicationGovernance ||
    typeof repos.publicationGovernance.recordOperatorDecision !== "function"
  ) {
    fail("governed_window_candidate_repositories_required");
  }
  return repos;
}

function storyLaneId(story) {
  const extra = parseObject(
    story?._extra || "{}",
    "governed_window_candidate_story_extra_invalid",
  );
  const explicit = text(
    extra.editorial_format ||
      extra.format_intent ||
      extra.format_id ||
      extra.format_route,
  ).toLowerCase();
  if (
    [
      "weekly_roundup",
      "weekly_roundup_item",
      "monthly_release_radar",
      "monthly_release_radar_item",
      "pulse_briefing_longform",
      "longform",
    ].includes(explicit)
  ) {
    return "weekly_longform";
  }
  if (explicit === "evergreen_verdict_short") {
    return "evergreen_short";
  }
  if (
    extra.breaking_fast_track === true ||
    extra.breaking === true ||
    Number(story?.breaking_score || 0) >= 80 ||
    /\bbreaking\b/i.test(`${story?.classification || ""} ${story?.flair || ""}`)
  ) {
    return "breaking_short";
  }
  fail("governed_window_candidate_lane_not_governed");
}

function canonicalReviewAuditBody(row) {
  const evidence = parseObject(
    row?.evidence_json,
    "governed_window_candidate_review_evidence_invalid",
  );
  return {
    id: Number(row.id),
    actor_id: text(row.actor_id),
    action: text(row.action),
    target_type: text(row.target_type),
    target_id: text(row.target_id),
    decision: text(row.decision),
    reason: text(row.reason),
    evidence,
    idempotency_key: text(row.idempotency_key) || null,
    created_at: text(row.created_at) || null,
  };
}

function canonicalHumanRenderApprovalAuditSha256(row) {
  return canonicalSha256(canonicalReviewAuditBody(row));
}

function reviewEvidenceHashes(evidence) {
  return {
    media_sha256: exactSha256(
      evidence.media_sha256 || objectValue(evidence.final_mp4).sha256,
      "governed_window_candidate_review_media_sha256_required",
    ),
    script_sha256: exactSha256(
      evidence.script_sha256,
      "governed_window_candidate_review_script_sha256_required",
    ),
    qa_report_sha256: exactSha256(
      evidence.qa_report_sha256 || objectValue(evidence.qa_report).sha256,
      "governed_window_candidate_review_qa_sha256_required",
    ),
    rights_ledger_sha256: exactSha256(
      evidence.rights_ledger_sha256 ||
        objectValue(evidence.rights_ledger).canonical_sha256,
      "governed_window_candidate_review_rights_sha256_required",
    ),
    source_evidence_sha256: exactSha256(
      evidence.source_evidence_sha256 ||
        objectValue(evidence.source_evidence).sha256,
      "governed_window_candidate_review_source_sha256_required",
    ),
  };
}

function validateReviewControlledExperimentObservation({
  evidence,
  storyId,
  channelId,
  hashes,
}) {
  const rawObservation =
    evidence.controlled_experiment_observation;
  const rawArtifact =
    evidence.controlled_experiment_observation_artifact;
  if (rawObservation === undefined) {
    if (rawArtifact !== undefined) {
      fail(
        "governed_window_candidate_controlled_experiment_observation_required",
      );
    }
    return null;
  }
  let validated;
  try {
    validated = validateControlledExperimentObservation(
      rawObservation,
      {
        expectedIdentity: {
          story_id: storyId,
          channel_id: channelId,
        },
        expectedBindings: {
          story_intake_sha256: exactSha256(
            evidence.story_intake_sha256,
            "governed_window_candidate_controlled_experiment_story_intake_sha256_required",
          ),
          narration_manifest_sha256: exactSha256(
            evidence.narration_manifest_sha256,
            "governed_window_candidate_controlled_experiment_narration_sha256_required",
          ),
          renderer_manifest_file_sha256: exactSha256(
            evidence.renderer_manifest_file_sha256,
            "governed_window_candidate_controlled_experiment_renderer_file_sha256_required",
          ),
          renderer_manifest_canonical_sha256: exactSha256(
            evidence.renderer_manifest_sha256,
            "governed_window_candidate_controlled_experiment_renderer_canonical_sha256_required",
          ),
          qa_report_sha256: hashes.qa_report_sha256,
          media_sha256: hashes.media_sha256,
          script_sha256: hashes.script_sha256,
        },
      },
    );
  } catch (error) {
    fail(
      text(error?.code || error?.message) ||
        "governed_window_candidate_controlled_experiment_observation_invalid",
    );
  }
  exactObjectFields(
    rawArtifact,
    ["path", "file_sha256", "observation_sha256"],
    "governed_window_candidate_controlled_experiment_artifact_fields_invalid",
  );
  const artifactPath = text(rawArtifact.path);
  const artifactFileSha256 = exactSha256(
    rawArtifact.file_sha256,
    "governed_window_candidate_controlled_experiment_artifact_file_sha256_required",
  );
  const artifactObservationSha256 = exactSha256(
    rawArtifact.observation_sha256,
    "governed_window_candidate_controlled_experiment_artifact_self_sha256_required",
  );
  if (!artifactPath) {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_path_required",
    );
  }
  if (artifactObservationSha256 !== validated.sha256) {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_self_sha256_mismatch",
    );
  }
  if (
    !fs.existsSync(artifactPath) ||
    !fs.statSync(artifactPath).isFile()
  ) {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_file_required",
    );
  }
  const artifactBytes = fs.readFileSync(artifactPath);
  const actualFileSha256 = crypto
    .createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  if (actualFileSha256 !== artifactFileSha256) {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_file_sha256_mismatch",
    );
  }
  let artifactObservation;
  try {
    artifactObservation = JSON.parse(artifactBytes.toString("utf8"));
  } catch {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_invalid_json",
    );
  }
  let artifactValidation;
  try {
    artifactValidation = validateControlledExperimentObservation(
      artifactObservation,
      {
        expectedIdentity: validated.observation.identity,
        expectedBindings: validated.observation.bindings,
      },
    );
  } catch (error) {
    fail(
      text(error?.code || error?.message) ||
        "governed_window_candidate_controlled_experiment_artifact_invalid",
    );
  }
  if (
    artifactValidation.sha256 !== validated.sha256 ||
    canonicalSha256(artifactValidation.observation) !==
      canonicalSha256(validated.observation)
  ) {
    fail(
      "governed_window_candidate_controlled_experiment_artifact_observation_mismatch",
    );
  }
  return {
    observation_sha256: validated.sha256,
    file_sha256: artifactFileSha256,
    path: artifactPath,
  };
}

function exactAutonomousEligibility({
  eligibilityAttestation,
  jitPreparation,
  storyId,
  channelId,
  laneId,
  scheduledFor,
  role,
  now,
}) {
  const preparation =
    validateAutonomousOfficialJitPreparationManifest(jitPreparation);
  if (
    preparation.story_id !== storyId ||
    preparation.channel_id !== channelId ||
    preparation.lane_id !== laneId ||
    preparation.platform !== PLATFORM ||
    preparation.scheduled_for !== scheduledFor ||
    preparation.role !== role
  ) {
    fail(
      "governed_window_candidate_autonomous_jit_preparation_binding_mismatch",
    );
  }
  const attestation = validateAutonomousWindowEligibilityAttestation(
    eligibilityAttestation,
    {
      now,
      expected: {
        story_id: storyId,
        channel_id: channelId,
        lane_id: laneId,
        platform: PLATFORM,
        scheduled_for: scheduledFor,
        role,
        jit_preparation: preparation,
      },
    },
  );
  const hashes = Object.fromEntries(
    [
      "media_sha256",
      "script_sha256",
      "qa_report_sha256",
      "rights_ledger_sha256",
      "source_evidence_sha256",
    ].map((field) => [
      field,
      exactSha256(
        attestation.evidence_hashes?.[field],
        `governed_window_candidate_autonomous_${field}_required`,
      ),
    ]),
  );
  if (
    preparation.publication_evidence_gate_input.rights_ledger_sha256 !==
    hashes.rights_ledger_sha256
  ) {
    fail("governed_window_candidate_autonomous_rights_sha256_mismatch");
  }
  return {
    eligibility_attestation: stableValue(attestation),
    eligibility_attestation_id: text(attestation.attestation_id),
    eligibility_attestation_sha256: exactSha256(
      attestation.attestation_sha256,
      "governed_window_candidate_autonomous_eligibility_sha256_required",
    ),
    eligibility_valid_until: text(attestation.valid_until),
    candidate_binding_sha256: exactSha256(
      attestation.candidate_binding_sha256,
      "governed_window_candidate_autonomous_candidate_binding_sha256_required",
    ),
    source_report_sha256: exactSha256(
      attestation.source_report?.report_sha256,
      "governed_window_candidate_autonomous_source_report_sha256_required",
    ),
    source_report_valid_until: text(attestation.source_report?.valid_until),
    jit_preparation: stableValue(preparation),
    jit_preparation_sha256: exactSha256(
      preparation.preparation_sha256,
      "governed_window_candidate_autonomous_jit_preparation_sha256_required",
    ),
    candidate_revision_sha256: exactSha256(
      preparation.candidate_revision_sha256,
      "governed_window_candidate_autonomous_candidate_revision_sha256_required",
    ),
    request_fingerprint: exactSha256(
      preparation.request_fingerprint,
      "governed_window_candidate_autonomous_request_fingerprint_required",
    ),
    hashes,
  };
}

function loadExactReviewAudit(db, storyId, auditId) {
  const id = Number(auditId);
  if (!Number.isInteger(id) || id <= 0) {
    fail("governed_window_candidate_review_audit_id_required");
  }
  const row = db
    .prepare(
      `SELECT *
       FROM operator_audit_log
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id);
  if (
    !row ||
    row.action !== "governed_publication_review" ||
    row.target_type !== "story" ||
    row.target_id !== storyId ||
    row.decision !== "HUMAN_RENDER_APPROVED"
  ) {
    fail("governed_window_candidate_exact_human_render_approval_required");
  }
  const latest = db
    .prepare(
      `SELECT id
       FROM operator_audit_log
       WHERE action = 'governed_publication_review'
         AND target_type = 'story'
         AND target_id = ?
         AND decision = 'HUMAN_RENDER_APPROVED'
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(storyId);
  if (Number(latest?.id) !== id) {
    fail("governed_window_candidate_review_audit_not_current");
  }
  const canonical = canonicalReviewAuditBody(row);
  if (
    text(canonical.evidence.story_id) &&
    text(canonical.evidence.story_id) !== storyId
  ) {
    fail("governed_window_candidate_review_story_mismatch");
  }
  const admissionEvidence = objectValue(canonical.evidence.admission_evidence);
  if (
    admissionEvidence.schema_version !== "pulse-publication-review-evidence-v1"
  ) {
    fail("governed_window_candidate_admission_evidence_required");
  }
  const admissionEvidenceSha256 = exactSha256(
    canonical.evidence.admission_evidence_sha256,
    "governed_window_candidate_admission_evidence_sha256_required",
  );
  if (
    admissionEvidenceSha256 !==
    sha256Text(JSON.stringify(stableValue(admissionEvidence)))
  ) {
    fail("governed_window_candidate_admission_evidence_sha256_mismatch");
  }
  if (text(admissionEvidence.story_id) !== storyId) {
    fail("governed_window_candidate_admission_story_mismatch");
  }
  if (
    text(canonical.evidence.channel_id) &&
    text(admissionEvidence.channel_id) !== text(canonical.evidence.channel_id)
  ) {
    fail("governed_window_candidate_admission_channel_mismatch");
  }
  const hashes = reviewEvidenceHashes(admissionEvidence);
  const controlledExperimentObservation =
    validateReviewControlledExperimentObservation({
      evidence: admissionEvidence,
      storyId,
      channelId: text(canonical.evidence.channel_id),
      hashes,
    });
  if (controlledExperimentObservation) {
    const provenance =
      canonical.evidence.controlled_experiment_observation;
    exactObjectFields(
      provenance,
      ["path", "file_sha256", "observation_sha256"],
      "governed_window_candidate_controlled_experiment_provenance_fields_invalid",
    );
    if (
      canonicalSha256(provenance) !==
      canonicalSha256(controlledExperimentObservation)
    ) {
      fail(
        "governed_window_candidate_controlled_experiment_provenance_mismatch",
      );
    }
    hashes.controlled_experiment_observation_sha256 =
      controlledExperimentObservation.observation_sha256;
  } else if (
    canonical.evidence.controlled_experiment_observation !==
    undefined
  ) {
    fail(
      "governed_window_candidate_controlled_experiment_observation_required",
    );
  }
  try {
    validateOfficialSourceReleaseBinding(
      admissionEvidence.official_source_release_binding,
      {
        storyId,
        sourceEvidenceSha256: hashes.source_evidence_sha256,
      },
    );
  } catch (error) {
    fail(text(error?.code) || "official_source_release_binding_required");
  }
  for (const [actual, expected, code] of [
    [
      canonical.evidence.media_sha256,
      hashes.media_sha256,
      "governed_window_candidate_review_media_sha256_mismatch",
    ],
    [
      canonical.evidence.script_sha256,
      hashes.script_sha256,
      "governed_window_candidate_review_script_sha256_mismatch",
    ],
    [
      objectValue(canonical.evidence.qa_report).sha256,
      hashes.qa_report_sha256,
      "governed_window_candidate_review_qa_sha256_mismatch",
    ],
    [
      objectValue(canonical.evidence.rights_ledger).canonical_sha256,
      hashes.rights_ledger_sha256,
      "governed_window_candidate_review_rights_sha256_mismatch",
    ],
    [
      objectValue(canonical.evidence.source_evidence).sha256,
      hashes.source_evidence_sha256,
      "governed_window_candidate_review_source_sha256_mismatch",
    ],
  ]) {
    if (text(actual) && text(actual).toLowerCase() !== expected) {
      fail(code);
    }
  }
  return {
    row,
    canonical,
    canonical_sha256: canonicalHumanRenderApprovalAuditSha256(row),
    evidence_sha256: sha256Text(row.evidence_json),
    evidence: admissionEvidence,
    admission_evidence_sha256: admissionEvidenceSha256,
    hashes,
  };
}

function windowAuthorityAction(role) {
  return role === "STANDBY"
    ? "governed_youtube_runway_standby"
    : "governed_youtube_window_primary";
}

function windowAuthorityIdempotencyKey(role, scheduledFor) {
  return [
    "governed-youtube-window-candidate",
    role.toLowerCase(),
    scheduledFor,
  ].join(":");
}

function authorityAuditEnvelope(row) {
  if (!row) return null;
  return {
    audit_id: Number(row.id),
    action: text(row.action),
    decision: text(row.decision),
    idempotency_key: text(row.idempotency_key),
    authority_binding_sha256: exactSha256(
      parseObject(
        row.evidence_json,
        "governed_window_candidate_authority_evidence_invalid",
      ).authority_binding_sha256,
      "governed_window_candidate_authority_binding_invalid",
    ),
  };
}

function buildPreparedAuthority({
  repos,
  storyId,
  role,
  scheduledFor,
  humanReviewAuditId,
  approval,
  actorId,
  reason,
  now,
  requireFuture = true,
}) {
  requireRepositories(repos);
  const exactStoryId = text(storyId);
  if (!exactStoryId) {
    fail("governed_window_candidate_story_id_required");
  }
  const exactCandidateRole = exactRole(role);
  const schedule = exactSchedule(scheduledFor);
  const currentTime = effectiveNow(now || new Date());
  const admissionAt = new Date(schedule.getTime() - ADMISSION_OFFSET_MS);
  if (requireFuture && admissionAt.getTime() <= currentTime.getTime()) {
    fail("governed_window_candidate_t75_must_be_future");
  }
  const variant = approvalVariant({
    approval,
    humanReviewAuditId,
    actorId,
    reason,
  });
  const story = repos.stories.get(exactStoryId);
  if (!story) fail("governed_window_candidate_story_not_found");
  if (text(story.youtube_post_id)) {
    fail("governed_window_candidate_already_published");
  }
  if (story.approved !== 1 && story.approved !== true) {
    fail("governed_window_candidate_editorial_approval_required");
  }
  const channelId = text(story.channel_id || "pulse-gaming");
  const laneId = storyLaneId(story);
  if (variant.type === AUTONOMOUS_APPROVAL_TYPE) {
    const autonomous = exactAutonomousEligibility({
      eligibilityAttestation: variant.eligibilityAttestation,
      jitPreparation: variant.jitPreparation,
      storyId: exactStoryId,
      channelId,
      laneId,
      scheduledFor: schedule.toISOString(),
      role: exactCandidateRole,
      now: currentTime,
    });
    const admission = {
      schema_version: ADMISSION_SCHEMA_VERSION,
      approval_type: AUTONOMOUS_APPROVAL_TYPE,
      human_admission_required: false,
      confirmation_story_id: exactStoryId,
      scheduled_for: schedule.toISOString(),
      autonomous_eligibility_attestation_sha256:
        autonomous.eligibility_attestation_sha256,
      jit_preparation_sha256: autonomous.jit_preparation_sha256,
      autonomous_source_report_sha256: autonomous.source_report_sha256,
      autonomous_source_report_valid_until:
        autonomous.source_report_valid_until,
      autonomous_window_eligibility_attestation:
        autonomous.eligibility_attestation,
      jit_preparation: autonomous.jit_preparation,
    };
    const candidateRevision = stableValue({
      schema_version:
        "pulse-autonomous-eligible-candidate-revision-reference-v1",
      stage: "AUTONOMOUS_ELIGIBLE",
      sha256: autonomous.candidate_revision_sha256,
      candidate_binding_sha256: autonomous.candidate_binding_sha256,
      ...autonomous.hashes,
      admission_sha256: canonicalSha256(admission),
    });
    const candidateRevisionSha256 = autonomous.candidate_revision_sha256;
    const admissionJobIdempotencyKey =
      exactCandidateRole === "PRIMARY"
        ? youtubeAdmissionJobIdempotencyKey({
            laneId,
            storyId: exactStoryId,
            candidateRevisionSha256,
            scheduledFor: schedule.toISOString(),
          })
        : null;
    const body = {
      schema_version: AUTHORITY_SCHEMA_VERSION,
      platform: PLATFORM,
      role: exactCandidateRole,
      story_id: exactStoryId,
      channel_id: channelId,
      lane_id: laneId,
      scheduled_for: schedule.toISOString(),
      admission_run_at:
        exactCandidateRole === "PRIMARY" ? admissionAt.toISOString() : null,
      candidate_revision_sha256: candidateRevisionSha256,
      candidate_revision: candidateRevision,
      admission_job_idempotency_key: admissionJobIdempotencyKey,
      approval_type: AUTONOMOUS_APPROVAL_TYPE,
      human_admission_required: false,
      autonomous_eligibility_attestation_id:
        autonomous.eligibility_attestation_id,
      autonomous_eligibility_attestation_sha256:
        autonomous.eligibility_attestation_sha256,
      autonomous_eligibility_valid_until: autonomous.eligibility_valid_until,
      autonomous_source_report_sha256: autonomous.source_report_sha256,
      autonomous_source_report_valid_until:
        autonomous.source_report_valid_until,
      candidate_binding_sha256: autonomous.candidate_binding_sha256,
      request_fingerprint: autonomous.request_fingerprint,
      jit_preparation_sha256: autonomous.jit_preparation_sha256,
      jit_preparation: autonomous.jit_preparation,
      evidence_hashes: stableValue(autonomous.hashes),
      standby_authorised: exactCandidateRole === "STANDBY",
      admission,
      publish_authority: false,
      external_posting: false,
      immediate_scheduling: false,
    };
    return {
      ...body,
      authority_binding_sha256: canonicalSha256(body),
    };
  }
  const { actor, rationale } = exactActorReason(actorId, reason);
  const review = loadExactReviewAudit(
    repos.db,
    exactStoryId,
    variant.humanReviewAuditId,
  );
  const admission = {
    schema_version: ADMISSION_SCHEMA_VERSION,
    human_review_status: "approved",
    actor_id: actor,
    reason: rationale,
    confirmation_story_id: exactStoryId,
    scheduled_for: schedule.toISOString(),
    evidence: stableValue(review.evidence),
  };
  const candidateRevision = buildCandidateRevision({
    story_id: exactStoryId,
    stage: "HUMAN_APPROVED",
    ...review.hashes,
    admission,
  });
  const candidateRevisionSha256 = exactSha256(
    candidateRevision.sha256,
    "governed_window_candidate_revision_invalid",
  );
  const admissionJobIdempotencyKey =
    exactCandidateRole === "PRIMARY"
      ? youtubeAdmissionJobIdempotencyKey({
          laneId,
          storyId: exactStoryId,
          candidateRevisionSha256,
          scheduledFor: schedule.toISOString(),
        })
      : null;
  const body = {
    schema_version: AUTHORITY_SCHEMA_VERSION,
    platform: PLATFORM,
    role: exactCandidateRole,
    story_id: exactStoryId,
    channel_id: channelId,
    lane_id: laneId,
    scheduled_for: schedule.toISOString(),
    admission_run_at:
      exactCandidateRole === "PRIMARY" ? admissionAt.toISOString() : null,
    candidate_revision_sha256: candidateRevisionSha256,
    candidate_revision: stableValue(candidateRevision.bindings),
    admission_job_idempotency_key: admissionJobIdempotencyKey,
    human_review_audit_id: Number(review.row.id),
    human_review_audit_sha256: review.canonical_sha256,
    human_review_evidence_sha256: review.evidence_sha256,
    human_review_audit_idempotency_key:
      text(review.row.idempotency_key) || null,
    evidence_hashes: stableValue(review.hashes),
    operator: {
      actor_id: actor,
      reason: rationale,
    },
    standby_authorised: exactCandidateRole === "STANDBY",
    admission,
    publish_authority: false,
    external_posting: false,
    immediate_scheduling: false,
  };
  return {
    ...body,
    authority_binding_sha256: canonicalSha256(body),
  };
}

function prepareGovernedWindowCandidateAuthority(options = {}) {
  const authority = buildPreparedAuthority(options);
  const request =
    authority.approval_type === AUTONOMOUS_APPROVAL_TYPE
      ? {
          storyId: authority.story_id,
          role: authority.role,
          scheduledFor: authority.scheduled_for,
          approval: {
            type: AUTONOMOUS_APPROVAL_TYPE,
            eligibilityAttestation:
              authority.admission.autonomous_window_eligibility_attestation,
            jitPreparation: authority.admission.jit_preparation,
          },
        }
      : {
          storyId: authority.story_id,
          role: authority.role,
          scheduledFor: authority.scheduled_for,
          humanReviewAuditId: authority.human_review_audit_id,
          actorId: authority.operator.actor_id,
          reason: authority.operator.reason,
        };
  return {
    schema_version: "pulse-governed-youtube-window-candidate-preparation-v1",
    verdict: "GREEN",
    blockers: [],
    authority,
    request,
    mutation_allowed: false,
    database_mutated: false,
    external_posting: false,
    publish_authority_created: false,
  };
}

function exactConfirmation(options, authority) {
  if (text(options.confirmStoryId) !== authority.story_id) {
    fail("governed_window_candidate_exact_story_confirmation_required");
  }
  if (text(options.confirmRole).toUpperCase() !== authority.role) {
    fail("governed_window_candidate_exact_role_confirmation_required");
  }
  if (text(options.confirmScheduledFor) !== authority.scheduled_for) {
    fail("governed_window_candidate_exact_schedule_confirmation_required");
  }
  if (
    text(options.confirmAuthorityBindingSha256).toLowerCase() !==
    authority.authority_binding_sha256
  ) {
    fail("governed_window_candidate_exact_binding_confirmation_required");
  }
}

function listWindowAuthorities(db) {
  return db
    .prepare(
      `SELECT *
       FROM operator_audit_log
       WHERE decision = 'APPROVED'
         AND action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )
       ORDER BY id`,
    )
    .all()
    .map((row) => ({
      row,
      evidence: parseObject(
        row.evidence_json,
        "governed_window_candidate_authority_evidence_invalid",
      ),
    }));
}

function assertReservationAvailable(existingAuthorities, authority) {
  for (const existing of existingAuthorities) {
    const evidence = existing.evidence;
    const existingRole =
      text(evidence.role).toUpperCase() ||
      (existing.row.action === "governed_youtube_runway_standby"
        ? "STANDBY"
        : "PRIMARY");
    const sameBinding =
      evidence.authority_binding_sha256 === authority.authority_binding_sha256;
    if (
      evidence.scheduled_for === authority.scheduled_for &&
      existingRole === authority.role &&
      !sameBinding
    ) {
      fail("governed_window_candidate_role_slot_conflict");
    }
    if (
      evidence.scheduled_for === authority.scheduled_for &&
      text(evidence.story_id || existing.row.target_id) ===
        authority.story_id &&
      existingRole !== authority.role
    ) {
      fail("governed_window_candidate_distinct_story_required");
    }
    if (
      text(evidence.story_id || existing.row.target_id) ===
        authority.story_id &&
      evidence.scheduled_for !== authority.scheduled_for
    ) {
      fail("governed_window_candidate_cross_window_reservation_conflict");
    }
  }
}

function primaryAdmissionJob(authority, authorityAudit) {
  const autonomous =
    authority.approval_type === AUTONOMOUS_APPROVAL_TYPE;
  return {
    kind: "admit_governed_publication",
    channel_id: authority.channel_id,
    story_id: authority.story_id,
    payload: {
      lane_id: authority.lane_id,
      story_id: authority.story_id,
      platform: PLATFORM,
      human_admission_required: !autonomous,
      guarded_admission_authority: true,
      candidate_revision_sha256: authority.candidate_revision_sha256,
      candidate_revision: authority.candidate_revision,
      admission: authority.admission,
      ...(autonomous
        ? {
            autonomous_jit_materialisation_required: true,
          }
        : {}),
      window_candidate_authority: {
        ...authorityAudit,
        role: authority.role,
        story_id: authority.story_id,
        scheduled_for: authority.scheduled_for,
        candidate_revision_sha256: authority.candidate_revision_sha256,
      },
      publish_authority: false,
      external_posting: false,
      catch_up_allowed: false,
    },
    priority: authority.lane_id === "breaking_short" ? 6 : 18,
    run_at: authority.admission_run_at,
    max_attempts: 3,
    requires_gpu: false,
    idempotency_key: authority.admission_job_idempotency_key,
  };
}

function assertAutonomousAdmissionOnly(authority) {
  if (authority.approval_type !== AUTONOMOUS_APPROVAL_TYPE) {
    fail("governed_window_candidate_autonomous_approval_required");
  }
  for (const container of [
    authority,
    authority.admission,
    authority.candidate_revision,
  ]) {
    if (
      !container ||
      typeof container !== "object" ||
      Array.isArray(container)
    ) {
      fail("governed_window_candidate_autonomous_admission_invalid");
    }
    if (
      AUTONOMOUS_FORBIDDEN_ADMISSION_FIELDS.some((field) =>
        Object.hasOwn(container, field),
      )
    ) {
      fail(
        "governed_window_candidate_autonomous_human_or_preissued_authority_forbidden",
      );
    }
  }
  if (
    authority.human_admission_required !== false ||
    authority.admission.human_admission_required !== false ||
    authority.publish_authority !== false ||
    authority.external_posting !== false
  ) {
    fail("governed_window_candidate_autonomous_admission_scope_invalid");
  }
}

function autonomousStoryExtraProjection(authority) {
  return stableValue({
    approval_type: AUTONOMOUS_APPROVAL_TYPE,
    admission: authority.admission,
    admission_evidence_sha256: canonicalSha256(authority.admission),
    runway_eligibility_verdict: "GREEN",
    eligibility_verdict: "GREEN",
    standby_authorised: authority.role === "STANDBY",
    runway_standby_authorised: authority.role === "STANDBY",
    candidate_revision_sha256: authority.candidate_revision_sha256,
    candidate_binding_sha256: authority.candidate_binding_sha256,
    request_fingerprint: authority.request_fingerprint,
    autonomous_eligibility_attestation_id:
      authority.autonomous_eligibility_attestation_id,
    autonomous_eligibility_attestation_sha256:
      authority.autonomous_eligibility_attestation_sha256,
    autonomous_eligibility_valid_until:
      authority.autonomous_eligibility_valid_until,
    autonomous_source_report_sha256:
      authority.autonomous_source_report_sha256,
    autonomous_source_report_valid_until:
      authority.autonomous_source_report_valid_until,
    jit_preparation_sha256: authority.jit_preparation_sha256,
    media_sha256: authority.evidence_hashes.media_sha256,
    script_sha256: authority.evidence_hashes.script_sha256,
    qa_report_sha256: authority.evidence_hashes.qa_report_sha256,
    rights_ledger_sha256:
      authority.evidence_hashes.rights_ledger_sha256,
    source_evidence_sha256:
      authority.evidence_hashes.source_evidence_sha256,
  });
}

function stableValuesEqual(left, right) {
  return (
    JSON.stringify(stableValue(left)) ===
    JSON.stringify(stableValue(right))
  );
}

function inspectAutonomousStoryProjection(story, projection) {
  const extra = parseObject(
    story?._extra || "{}",
    "governed_window_candidate_story_extra_invalid",
  );
  for (const [field, expected] of Object.entries(projection)) {
    if (
      Object.hasOwn(extra, field) &&
      !stableValuesEqual(extra[field], expected)
    ) {
      fail(
        "governed_window_candidate_autonomous_story_projection_conflict",
      );
    }
  }
  return {
    extra,
    complete: Object.entries(projection).every(
      ([field, expected]) =>
        Object.hasOwn(extra, field) &&
        stableValuesEqual(extra[field], expected),
    ),
  };
}

function exactAutonomousReplay(options, existingAuthorities) {
  const confirmedBinding = exactSha256(
    options.confirmAuthorityBindingSha256,
    "governed_window_candidate_exact_binding_confirmation_required",
  );
  const prior = existingAuthorities.find(
    ({ evidence }) =>
      evidence.authority_binding_sha256 === confirmedBinding,
  );
  if (!prior) return null;

  const authority = prior.evidence;
  assertAutonomousAdmissionOnly(authority);
  const authorityBody = { ...authority };
  delete authorityBody.authority_binding_sha256;
  if (canonicalSha256(authorityBody) !== confirmedBinding) {
    fail("governed_window_candidate_authority_binding_invalid");
  }
  exactConfirmation(options, authority);
  if (text(options.storyId) !== authority.story_id) {
    fail("governed_window_candidate_exact_story_confirmation_required");
  }
  if (exactRole(options.role) !== authority.role) {
    fail("governed_window_candidate_exact_role_confirmation_required");
  }
  if (
    exactSchedule(options.scheduledFor).toISOString() !==
    authority.scheduled_for
  ) {
    fail("governed_window_candidate_exact_schedule_confirmation_required");
  }
  const variant = approvalVariant({
    approval: options.approval,
    humanReviewAuditId: options.humanReviewAuditId,
    actorId: options.actorId,
    reason: options.reason,
  });
  if (
    variant.type !== AUTONOMOUS_APPROVAL_TYPE ||
    !stableValuesEqual(
      variant.eligibilityAttestation,
      authority.admission
        .autonomous_window_eligibility_attestation,
    ) ||
    !stableValuesEqual(
      variant.jitPreparation,
      authority.admission.jit_preparation,
    )
  ) {
    fail("governed_window_candidate_autonomous_replay_conflict");
  }
  return {
    authority,
    prior,
  };
}

function admitAutonomousGovernedWindowCandidate(options = {}) {
  const repos = requireRepositories(options.repos);
  const transaction = repos.db.transaction(() => {
    const existingAuthorities = listWindowAuthorities(repos.db);
    const replay = exactAutonomousReplay(
      options,
      existingAuthorities,
    );
    if (replay) {
      const { authority, prior } = replay;
      assertReservationAvailable(existingAuthorities, authority);
      const story = repos.stories.get(authority.story_id);
      if (!story) fail("governed_window_candidate_story_not_found");
      const projected = inspectAutonomousStoryProjection(
        story,
        autonomousStoryExtraProjection(authority),
      );
      if (!projected.complete) {
        fail(
          "governed_window_candidate_autonomous_replay_projection_conflict",
        );
      }
      const audit = prior.row;
      let job = null;
      if (authority.role === "PRIMARY") {
        if (
          !repos.jobs.getByIdempotencyKey(
            authority.admission_job_idempotency_key,
          )
        ) {
          fail(
            "governed_window_candidate_idempotent_job_required_after_t75",
          );
        }
        job = repos.jobs.enqueueInTransaction(
          primaryAdmissionJob(
            authority,
            authorityAuditEnvelope(audit),
          ),
        );
      }
      return {
        prior: true,
        authority,
        audit,
        job,
      };
    }

    const authority = buildPreparedAuthority({
      ...options,
      requireFuture: false,
    });
    assertAutonomousAdmissionOnly(authority);
    exactConfirmation(options, authority);

    assertReservationAvailable(existingAuthorities, authority);
    const admissionAt = new Date(
      authority.role === "PRIMARY"
        ? authority.admission_run_at
        : Date.parse(authority.scheduled_for) -
            ADMISSION_OFFSET_MS,
    );
    const now = effectiveNow(options.now || new Date());
    if (admissionAt.getTime() <= now.getTime()) {
      fail("governed_window_candidate_t75_must_be_future");
    }

    const story = repos.stories.get(authority.story_id);
    if (!story) fail("governed_window_candidate_story_not_found");
    const projection = autonomousStoryExtraProjection(authority);
    const projected = inspectAutonomousStoryProjection(
      story,
      projection,
    );
    if (projected.complete) {
      fail(
        "governed_window_candidate_autonomous_projection_without_audit",
      );
    }

    const action = windowAuthorityAction(authority.role);
    const audit = repos.publicationGovernance.recordOperatorDecision({
      actorId: AUTONOMOUS_AUDIT_ACTOR,
      action,
      targetType: "story",
      targetId: authority.story_id,
      decision: "APPROVED",
      reason:
        authority.role === "STANDBY"
          ? "Exact autonomous official-source standby eligibility admission"
          : "Exact autonomous official-source primary eligibility admission",
      evidence: authority,
      idempotencyKey: windowAuthorityIdempotencyKey(
        authority.role,
        authority.scheduled_for,
      ),
    });
    const auditBinding = authorityAuditEnvelope(audit);

    const updated = repos.db
      .prepare(
        `UPDATE stories
         SET _extra = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(
          stableValue({
            ...projected.extra,
            ...projection,
          }),
        ),
        authority.story_id,
      );
    if (updated.changes !== 1) {
      fail(
        "governed_window_candidate_autonomous_story_update_failed",
      );
    }

    let job = null;
    if (authority.role === "PRIMARY") {
      job = repos.jobs.enqueueInTransaction(
        primaryAdmissionJob(authority, auditBinding),
      );
    }
    return {
      prior: false,
      authority,
      audit,
      job,
    };
  });
  const result = transaction.immediate();
  return {
    schema_version:
      "pulse-governed-youtube-window-candidate-autonomous-admission-result-v1",
    verdict: result.prior ? "EXISTS" : "APPLIED",
    mutated: !result.prior,
    authority_audit_id: Number(result.audit.id),
    authority_binding_sha256:
      result.authority.authority_binding_sha256,
    admission_job_id: result.job ? Number(result.job.id) : null,
    role: result.authority.role,
    story_id: result.authority.story_id,
    scheduled_for: result.authority.scheduled_for,
    admission_run_at: result.authority.admission_run_at,
    external_posting: false,
    publish_authority_created: false,
    immediate_scheduling: false,
  };
}

function authoriseGovernedWindowCandidate(options = {}) {
  const repos = requireRepositories(options.repos);
  const authority = buildPreparedAuthority({
    ...options,
    requireFuture: false,
  });
  if (authority.approval_type === AUTONOMOUS_APPROVAL_TYPE) {
    fail("governed_window_candidate_autonomous_mutation_forbidden");
  }
  exactConfirmation(options, authority);
  const action = windowAuthorityAction(authority.role);
  const idempotencyKey = windowAuthorityIdempotencyKey(
    authority.role,
    authority.scheduled_for,
  );
  const transaction = repos.db.transaction(() => {
    const existingAuthorities = listWindowAuthorities(repos.db);
    assertReservationAvailable(existingAuthorities, authority);
    const prior = existingAuthorities.find(
      ({ evidence }) =>
        evidence.authority_binding_sha256 ===
        authority.authority_binding_sha256,
    );
    const admissionAt = new Date(
      authority.role === "PRIMARY"
        ? authority.admission_run_at
        : new Date(
            Date.parse(authority.scheduled_for) - ADMISSION_OFFSET_MS,
          ).toISOString(),
    );
    const now = effectiveNow(options.now || new Date());
    if (admissionAt.getTime() <= now.getTime()) {
      if (!prior) {
        fail("governed_window_candidate_t75_must_be_future");
      }
      if (
        authority.role === "PRIMARY" &&
        !repos.jobs.getByIdempotencyKey(authority.admission_job_idempotency_key)
      ) {
        fail("governed_window_candidate_idempotent_job_required_after_t75");
      }
    }
    const audit = repos.publicationGovernance.recordOperatorDecision({
      actorId: authority.operator.actor_id,
      action,
      targetType: "story",
      targetId: authority.story_id,
      decision: "APPROVED",
      reason: authority.operator.reason,
      evidence: authority,
      idempotencyKey,
    });
    const auditBinding = authorityAuditEnvelope(audit);
    let job = null;
    if (authority.role === "PRIMARY") {
      job = repos.jobs.enqueueInTransaction(
        primaryAdmissionJob(authority, auditBinding),
      );
    }
    return {
      prior: Boolean(prior),
      audit,
      auditBinding,
      job,
    };
  });
  const result = transaction.immediate();
  return {
    schema_version:
      "pulse-governed-youtube-window-candidate-authorisation-result-v1",
    verdict: result.prior ? "EXISTS" : "APPLIED",
    mutated: !result.prior,
    authority_audit_id: Number(result.audit.id),
    authority_binding_sha256: authority.authority_binding_sha256,
    admission_job_id: result.job ? Number(result.job.id) : null,
    role: authority.role,
    story_id: authority.story_id,
    scheduled_for: authority.scheduled_for,
    admission_run_at: authority.admission_run_at,
    external_posting: false,
    publish_authority_created: false,
    immediate_scheduling: false,
  };
}

module.exports = {
  ADMISSION_OFFSET_MS,
  ADMISSION_SCHEMA_VERSION,
  AUTHORITY_SCHEMA_VERSION,
  admitAutonomousGovernedWindowCandidate,
  authoriseGovernedWindowCandidate,
  canonicalHumanRenderApprovalAuditSha256,
  prepareGovernedWindowCandidateAuthority,
  reviewEvidenceHashes,
};
