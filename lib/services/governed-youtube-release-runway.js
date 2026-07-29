"use strict";

const crypto = require("node:crypto");
const {
  youtubeAdmissionJobIdempotencyKey,
} = require("./governed-publication-job-identity");

const SCHEMA_VERSION =
  "pulse-governed-youtube-release-runway-v1";
const LOCK_SCHEMA_VERSION =
  "pulse-governed-youtube-release-runway-lock-v1";
const GUARDED_PUBLISH_HOURS_UTC = new Set([9, 19]);
const T90_OFFSET_MS = 90 * 60 * 1000;
const PHASE_TOLERANCE_MS = 5 * 60 * 1000;
const T0_TOLERANCE_MS = 60 * 1000;
const T15_OFFSET_MS = 15 * 60 * 1000;
const ADMISSION_OFFSET_MS = 75 * 60 * 1000;
const RESERVE_PROMOTION_CUTOFF_OFFSET_MS =
  60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HUMAN_APPROVAL_TYPE = "HUMAN";
const AUTONOMOUS_APPROVAL_TYPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const AUTONOMOUS_AUTHORITY_SCOPE =
  "PUBLICATION_ADMISSION_ONLY";
const AUTONOMOUS_AUTHORITY_MAX_TTL_MS = 60 * 1000;
const AUTONOMOUS_ELIGIBILITY_SCHEMA_VERSION =
  "pulse-autonomous-window-eligibility-attestation-v1";
const AUTONOMOUS_ELIGIBILITY_ATTESTOR_ID =
  "pulse-autonomous-green-admission-v2";
const AUTONOMOUS_ELIGIBILITY_SCOPE =
  "WINDOW_ELIGIBILITY_ONLY";
const AUTONOMOUS_JIT_PREPARATION_SCHEMA_VERSION =
  "pulse-autonomous-official-source-jit-preparation-v3";
const AUTONOMOUS_ELIGIBILITY_FIELDS = Object.freeze([
  "schema_version",
  "attestor_id",
  "signature_algorithm",
  "attestation_type",
  "attestation_scope",
  "decision",
  "non_consumptive",
  "human_approval",
  "may_impersonate_human",
  "admission_authorised",
  "operational_publish_authority",
  "dispatch_authorised",
  "external_publish_authorised",
  "issued_at",
  "valid_until",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "role",
  "candidate_binding_sha256",
  "evidence_hashes",
  "source_report",
  "green_admission_decision_sha256",
  "green_admission_evidence_sha256",
  "jit_preparation_sha256",
  "request_fingerprint",
  "attestation_id",
  "attestation_sha256",
]);
const AUTONOMOUS_ELIGIBILITY_EVIDENCE_FIELDS =
  Object.freeze([
    "media_sha256",
    "script_sha256",
    "qa_report_sha256",
    "rights_ledger_sha256",
    "source_evidence_sha256",
  ]);
const AUTONOMOUS_ELIGIBILITY_SOURCE_REPORT_FIELDS =
  Object.freeze([
    "path",
    "file_sha256",
    "report_sha256",
    "request_sha256",
    "generated_at",
    "valid_until",
  ]);

function text(value) {
  return String(value ?? "").trim();
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

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function autonomousEligibilityFail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactAutonomousEligibilityObject(
  value,
  fields,
  code,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    autonomousEligibilityFail(code);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    autonomousEligibilityFail(code);
  }
  return value;
}

function exactAutonomousEligibilitySha256(value, code) {
  const hash = normaliseSha256(value);
  if (!hash) autonomousEligibilityFail(code);
  return hash;
}

function exactAutonomousEligibilityTime(value, code) {
  const raw = text(value);
  const parsed = new Date(raw);
  if (
    !raw ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== raw
  ) {
    autonomousEligibilityFail(code);
  }
  return parsed;
}

function exactAutonomousEligibilityRole(value) {
  const role = text(value).toUpperCase();
  if (!["PRIMARY", "STANDBY"].includes(role)) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_role_invalid",
    );
  }
  return role;
}

function exactAutonomousEligibilityHashes(value) {
  const hashes = exactAutonomousEligibilityObject(
    value,
    AUTONOMOUS_ELIGIBILITY_EVIDENCE_FIELDS,
    "autonomous_window_eligibility_evidence_hashes_invalid",
  );
  return Object.fromEntries(
    AUTONOMOUS_ELIGIBILITY_EVIDENCE_FIELDS.map((field) => [
      field,
      exactAutonomousEligibilitySha256(
        hashes[field],
        `autonomous_window_eligibility_${field}_invalid`,
      ),
    ]),
  );
}

function exactAutonomousEligibilitySourceReport(
  value,
  now,
) {
  const report = exactAutonomousEligibilityObject(
    value,
    AUTONOMOUS_ELIGIBILITY_SOURCE_REPORT_FIELDS,
    "autonomous_window_eligibility_source_report_invalid",
  );
  if (!text(report.path)) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_source_report_path_required",
    );
  }
  const generatedAt = exactAutonomousEligibilityTime(
    report.generated_at,
    "autonomous_window_eligibility_source_report_time_invalid",
  );
  const validUntil = exactAutonomousEligibilityTime(
    report.valid_until,
    "autonomous_window_eligibility_source_report_time_invalid",
  );
  if (
    generatedAt.getTime() > now.getTime() ||
    validUntil.getTime() <= now.getTime()
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_source_report_stale",
    );
  }
  return {
    path: text(report.path),
    file_sha256: exactAutonomousEligibilitySha256(
      report.file_sha256,
      "autonomous_window_eligibility_source_report_file_sha256_invalid",
    ),
    report_sha256: exactAutonomousEligibilitySha256(
      report.report_sha256,
      "autonomous_window_eligibility_source_report_sha256_invalid",
    ),
    request_sha256: exactAutonomousEligibilitySha256(
      report.request_sha256,
      "autonomous_window_eligibility_source_request_sha256_invalid",
    ),
    generated_at: generatedAt.toISOString(),
    valid_until: validUntil.toISOString(),
  };
}

function autonomousEligibilityCandidateBinding({
  storyId,
  channelId,
  laneId,
  platform,
  scheduledFor,
  role,
  evidenceHashes,
  sourceReport,
  jitPreparationSha256,
}) {
  return canonicalSha256({
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    platform,
    scheduled_for: scheduledFor,
    role,
    evidence_hashes: evidenceHashes,
    source_report_file_sha256: sourceReport.file_sha256,
    source_report_sha256: sourceReport.report_sha256,
    source_report_request_sha256:
      sourceReport.request_sha256,
    jit_preparation_sha256: jitPreparationSha256,
  });
}

function createAutonomousWindowEligibilityAttestation(
  request = {},
) {
  const now =
    request.now instanceof Date
      ? new Date(request.now)
      : new Date(request.now);
  if (Number.isNaN(now.getTime())) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_time_invalid",
    );
  }
  const storyId = text(request.story_id);
  const channelId = text(request.channel_id);
  const laneId = text(request.lane_id);
  const platform = text(request.platform).toLowerCase();
  const role = exactAutonomousEligibilityRole(request.role);
  const schedule = exactAutonomousEligibilityTime(
    request.scheduled_for,
    "autonomous_window_eligibility_schedule_invalid",
  );
  if (
    !storyId ||
    channelId !== "pulse-gaming" ||
    laneId !== "breaking_short" ||
    platform !== "youtube" ||
    !GUARDED_PUBLISH_HOURS_UTC.has(schedule.getUTCHours()) ||
    schedule.getUTCMinutes() !== 0 ||
    schedule.getUTCSeconds() !== 0 ||
    schedule.getUTCMilliseconds() !== 0 ||
    schedule.getTime() <= now.getTime()
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_binding_invalid",
    );
  }
  const evidenceHashes = exactAutonomousEligibilityHashes(
    request.evidence_hashes,
  );
  const sourceReport = exactAutonomousEligibilitySourceReport(
    request.source_report,
    now,
  );
  const greenAdmission =
    request.green_admission &&
    typeof request.green_admission === "object" &&
    !Array.isArray(request.green_admission)
      ? request.green_admission
      : null;
  if (!greenAdmission) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_green_admission_required",
    );
  }
  const greenDecisionSha256 =
    exactAutonomousEligibilitySha256(
      greenAdmission.decision_sha256,
      "autonomous_window_eligibility_green_decision_sha256_invalid",
    );
  const {
    decision_sha256: _greenDecisionSha256,
    ...greenDecisionBody
  } = greenAdmission;
  if (
    canonicalSha256(greenDecisionBody) !== greenDecisionSha256 ||
    greenAdmission.decision_scope !==
      "EDITORIAL_ELIGIBILITY_ONLY" ||
    greenAdmission.operational_publish_authority !== false ||
    greenAdmission.dispatch_revalidation_required !== true ||
    greenAdmission.verdict !== "GREEN" ||
    greenAdmission.eligible !== true ||
    !Array.isArray(greenAdmission.blockers) ||
    greenAdmission.blockers.length !== 0 ||
    text(greenAdmission.story_id) !== storyId ||
    normaliseSha256(greenAdmission.final_mp4_sha256) !==
      evidenceHashes.media_sha256
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_green_admission_invalid",
    );
  }
  const greenEvidenceSha256 =
    exactAutonomousEligibilitySha256(
      greenAdmission.evidence_sha256,
      "autonomous_window_eligibility_green_evidence_sha256_invalid",
    );
  const greenEvaluatedAt = exactAutonomousEligibilityTime(
    greenAdmission.evaluated_at,
    "autonomous_window_eligibility_green_time_invalid",
  );
  const greenValidUntil = exactAutonomousEligibilityTime(
    greenAdmission.valid_until,
    "autonomous_window_eligibility_green_time_invalid",
  );
  if (
    greenEvaluatedAt.getTime() > now.getTime() ||
    greenValidUntil.getTime() <= now.getTime()
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_green_admission_stale",
    );
  }
  const jitPreparation =
    request.jit_preparation &&
    typeof request.jit_preparation === "object" &&
    !Array.isArray(request.jit_preparation)
      ? request.jit_preparation
      : null;
  if (
    !jitPreparation ||
    jitPreparation.schema_version !==
      AUTONOMOUS_JIT_PREPARATION_SCHEMA_VERSION
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_jit_preparation_invalid",
    );
  }
  const jitPreparationSha256 =
    exactAutonomousEligibilitySha256(
      jitPreparation.preparation_sha256,
      "autonomous_window_eligibility_jit_preparation_sha256_invalid",
    );
  const {
    preparation_sha256: _preparationSha256,
    ...jitPreparationBody
  } = jitPreparation;
  if (
    canonicalSha256(jitPreparationBody) !==
    jitPreparationSha256
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_jit_preparation_sha256_mismatch",
    );
  }
  const candidateBindingSha256 =
    autonomousEligibilityCandidateBinding({
      storyId,
      channelId,
      laneId,
      platform,
      scheduledFor: schedule.toISOString(),
      role,
      evidenceHashes,
      sourceReport,
      jitPreparationSha256,
    });
  const requestFingerprint = canonicalSha256({
    candidate_binding_sha256: candidateBindingSha256,
    green_admission_decision_sha256:
      greenDecisionSha256,
    green_admission_evidence_sha256:
      greenEvidenceSha256,
  });
  const validUntil = new Date(
    Math.min(
      greenValidUntil.getTime(),
      Date.parse(sourceReport.valid_until),
      schedule.getTime(),
    ),
  );
  if (validUntil.getTime() <= now.getTime()) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_no_fresh_window",
    );
  }
  const claims = {
    schema_version:
      AUTONOMOUS_ELIGIBILITY_SCHEMA_VERSION,
    attestor_id: AUTONOMOUS_ELIGIBILITY_ATTESTOR_ID,
    signature_algorithm: "CANONICAL_SHA256",
    attestation_type: AUTONOMOUS_APPROVAL_TYPE,
    attestation_scope: AUTONOMOUS_ELIGIBILITY_SCOPE,
    decision: "ELIGIBLE",
    non_consumptive: true,
    human_approval: false,
    may_impersonate_human: false,
    admission_authorised: false,
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    issued_at: now.toISOString(),
    valid_until: validUntil.toISOString(),
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    platform,
    scheduled_for: schedule.toISOString(),
    role,
    candidate_binding_sha256:
      candidateBindingSha256,
    evidence_hashes: evidenceHashes,
    source_report: sourceReport,
    green_admission_decision_sha256:
      greenDecisionSha256,
    green_admission_evidence_sha256:
      greenEvidenceSha256,
    jit_preparation_sha256:
      jitPreparationSha256,
    request_fingerprint: requestFingerprint,
  };
  const body = {
    ...claims,
    attestation_id:
      `autonomous-window-eligibility:${canonicalSha256(
        claims,
      )}`,
  };
  return {
    ...body,
    attestation_sha256: canonicalSha256(body),
  };
}

function validateAutonomousWindowEligibilityAttestation(
  value,
  { now = new Date(), expected = {} } = {},
) {
  const attestation = exactAutonomousEligibilityObject(
    value,
    AUTONOMOUS_ELIGIBILITY_FIELDS,
    "autonomous_window_eligibility_fields_invalid",
  );
  const attestationSha256 =
    exactAutonomousEligibilitySha256(
      attestation.attestation_sha256,
      "autonomous_window_eligibility_sha256_invalid",
    );
  const {
    attestation_sha256: _attestationSha256,
    ...body
  } = attestation;
  if (canonicalSha256(body) !== attestationSha256) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_sha256_mismatch",
    );
  }
  const {
    attestation_id: _attestationId,
    ...claims
  } = body;
  if (
    text(attestation.attestation_id) !==
    `autonomous-window-eligibility:${canonicalSha256(
      claims,
    )}`
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_id_mismatch",
    );
  }
  if (
    attestation.schema_version !==
      AUTONOMOUS_ELIGIBILITY_SCHEMA_VERSION ||
    attestation.attestor_id !==
      AUTONOMOUS_ELIGIBILITY_ATTESTOR_ID ||
    attestation.signature_algorithm !==
      "CANONICAL_SHA256" ||
    attestation.attestation_type !==
      AUTONOMOUS_APPROVAL_TYPE ||
    attestation.attestation_scope !==
      AUTONOMOUS_ELIGIBILITY_SCOPE ||
    attestation.decision !== "ELIGIBLE" ||
    attestation.non_consumptive !== true ||
    attestation.human_approval !== false ||
    attestation.may_impersonate_human !== false ||
    attestation.admission_authorised !== false ||
    attestation.operational_publish_authority !== false ||
    attestation.dispatch_authorised !== false ||
    attestation.external_publish_authorised !== false
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_scope_invalid",
    );
  }
  const current =
    now instanceof Date ? new Date(now) : new Date(now);
  if (Number.isNaN(current.getTime())) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_time_invalid",
    );
  }
  const issuedAt = exactAutonomousEligibilityTime(
    attestation.issued_at,
    "autonomous_window_eligibility_time_invalid",
  );
  const validUntil = exactAutonomousEligibilityTime(
    attestation.valid_until,
    "autonomous_window_eligibility_time_invalid",
  );
  if (
    issuedAt.getTime() > current.getTime() ||
    validUntil.getTime() <= current.getTime()
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_stale",
    );
  }
  const role = exactAutonomousEligibilityRole(
    attestation.role,
  );
  const evidenceHashes = exactAutonomousEligibilityHashes(
    attestation.evidence_hashes,
  );
  const sourceReport =
    exactAutonomousEligibilitySourceReport(
      attestation.source_report,
      current,
    );
  const jitPreparationSha256 =
    exactAutonomousEligibilitySha256(
      attestation.jit_preparation_sha256,
      "autonomous_window_eligibility_jit_preparation_sha256_invalid",
    );
  const candidateBindingSha256 =
    autonomousEligibilityCandidateBinding({
      storyId: text(attestation.story_id),
      channelId: text(attestation.channel_id),
      laneId: text(attestation.lane_id),
      platform: text(attestation.platform),
      scheduledFor: text(attestation.scheduled_for),
      role,
      evidenceHashes,
      sourceReport,
      jitPreparationSha256,
    });
  if (
    candidateBindingSha256 !==
      normaliseSha256(
        attestation.candidate_binding_sha256,
      ) ||
    canonicalSha256({
      candidate_binding_sha256:
        candidateBindingSha256,
      green_admission_decision_sha256:
        exactAutonomousEligibilitySha256(
          attestation.green_admission_decision_sha256,
          "autonomous_window_eligibility_green_decision_sha256_invalid",
        ),
      green_admission_evidence_sha256:
        exactAutonomousEligibilitySha256(
          attestation.green_admission_evidence_sha256,
          "autonomous_window_eligibility_green_evidence_sha256_invalid",
        ),
    }) !==
      exactAutonomousEligibilitySha256(
        attestation.request_fingerprint,
        "autonomous_window_eligibility_request_fingerprint_invalid",
      )
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_binding_mismatch",
    );
  }
  const exactExpected =
    expected &&
    typeof expected === "object" &&
    !Array.isArray(expected)
      ? expected
      : {};
  const comparisons = [
    ["story_id", text(attestation.story_id)],
    ["channel_id", text(attestation.channel_id)],
    ["lane_id", text(attestation.lane_id)],
    ["platform", text(attestation.platform)],
    ["scheduled_for", text(attestation.scheduled_for)],
    ["role", role],
    [
      "candidate_binding_sha256",
      candidateBindingSha256,
    ],
    [
      "source_report_sha256",
      sourceReport.report_sha256,
    ],
  ];
  for (const [field, actual] of comparisons) {
    if (
      Object.hasOwn(exactExpected, field) &&
      text(exactExpected[field]) !== actual
    ) {
      autonomousEligibilityFail(
        "autonomous_window_eligibility_binding_mismatch",
      );
    }
  }
  if (
    Object.hasOwn(exactExpected, "evidence_hashes") &&
    canonicalSha256(
      exactAutonomousEligibilityHashes(
        exactExpected.evidence_hashes,
      ),
    ) !== canonicalSha256(evidenceHashes)
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_binding_mismatch",
    );
  }
  if (
    Object.hasOwn(exactExpected, "jit_preparation") &&
    (() => {
      const expectedPreparation =
        exactExpected.jit_preparation;
      if (
        !expectedPreparation ||
        typeof expectedPreparation !== "object" ||
        Array.isArray(expectedPreparation)
      ) {
        return true;
      }
      const {
        preparation_sha256: expectedPreparationSha256,
        ...expectedPreparationBody
      } = expectedPreparation;
      return (
        normaliseSha256(expectedPreparationSha256) !==
          jitPreparationSha256 ||
        canonicalSha256(expectedPreparationBody) !==
          jitPreparationSha256
      );
    })()
  ) {
    autonomousEligibilityFail(
      "autonomous_window_eligibility_binding_mismatch",
    );
  }
  return JSON.parse(JSON.stringify(attestation));
}

function normaliseSha256(value) {
  const hash = text(value).toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function normaliseTime(value, code) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return date;
}

function resolveT90Window({ now, publish_hour_utc: publishHourUtc }) {
  const evaluatedAt = normaliseTime(now, "runway_time_invalid");
  const hour = Number(publishHourUtc);
  if (!GUARDED_PUBLISH_HOURS_UTC.has(hour)) {
    const error = new Error("runway_publish_hour_not_guarded");
    error.code = "runway_publish_hour_not_guarded";
    throw error;
  }
  const scheduledAt = new Date(
    Date.UTC(
      evaluatedAt.getUTCFullYear(),
      evaluatedAt.getUTCMonth(),
      evaluatedAt.getUTCDate(),
      hour,
    ),
  );
  const expectedT90 = scheduledAt.getTime() - T90_OFFSET_MS;
  if (
    Math.abs(evaluatedAt.getTime() - expectedT90) >
    PHASE_TOLERANCE_MS
  ) {
    const error = new Error("runway_t90_lock_time_invalid");
    error.code = "runway_t90_lock_time_invalid";
    throw error;
  }
  return {
    evaluated_at: evaluatedAt.toISOString(),
    scheduled_for: scheduledAt.toISOString(),
    window_id: `youtube:${scheduledAt.toISOString()}`,
  };
}

function candidateBinding(
  candidate,
  { now = null, scheduledFor = null } = {},
) {
  const hashes = {
    media_sha256: normaliseSha256(candidate?.media_sha256),
    script_sha256: normaliseSha256(candidate?.script_sha256),
    qa_report_sha256: normaliseSha256(
      candidate?.qa_report_sha256,
    ),
    rights_ledger_sha256: normaliseSha256(
      candidate?.rights_ledger_sha256,
    ),
    source_evidence_sha256: normaliseSha256(
      candidate?.source_evidence_sha256,
    ),
    candidate_revision_sha256: normaliseSha256(
      candidate?.candidate_revision_sha256,
    ),
  };
  const blockers = [];
  const storyId = text(candidate?.story_id);
  if (!storyId) blockers.push("runway_story_id_required");
  const stage = text(candidate?.stage).toUpperCase();
  const admission =
    candidate?.admission &&
    typeof candidate.admission === "object" &&
    !Array.isArray(candidate.admission)
      ? candidate.admission
      : null;
  const approvalType =
    stage === "AUTONOMOUS_ELIGIBLE"
      ? text(
          candidate?.approval_type ||
            admission?.approval_type,
        ).toUpperCase()
      : HUMAN_APPROVAL_TYPE;
  const human = stage === "HUMAN_APPROVED";
  const autonomous =
    stage === "AUTONOMOUS_ELIGIBLE" &&
    approvalType === AUTONOMOUS_APPROVAL_TYPE;
  if (!human && !autonomous) {
    blockers.push("runway_approval_variant_invalid");
  }
  if (
    text(candidate?.eligibility_verdict).toUpperCase() !== "GREEN"
  ) {
    blockers.push("runway_candidate_eligibility_not_green");
  }
  for (const [field, value] of Object.entries(hashes)) {
    if (!value) {
      blockers.push(`runway_${field}_required`);
    }
  }
  if (text(candidate?.youtube_post_id)) {
    blockers.push("runway_candidate_already_published");
  }
  const evidence = {};
  const optionalEvidenceFields = [
    "admission_evidence_sha256",
    "standby_authorisation_sha256",
  ];
  if (human) {
    optionalEvidenceFields.unshift(
      "human_review_evidence_sha256",
    );
  }
  for (const field of optionalEvidenceFields) {
    const raw = text(candidate?.[field]);
    if (raw) {
      const value = normaliseSha256(raw);
      if (!value) {
        blockers.push(`runway_${field}_invalid`);
      } else {
        evidence[field] = value;
      }
    }
  }
  const optionalEventFields = [
    "admission_event_id",
    "standby_authorisation_event_id",
  ];
  if (human) {
    optionalEventFields.unshift("human_review_event_id");
  }
  for (const field of optionalEventFields) {
    const value = text(candidate?.[field]);
    if (value) evidence[field] = value;
  }
  if (human) {
    if (
      text(candidate?.human_review_status).toLowerCase() !==
      "approved"
    ) {
      blockers.push("runway_human_review_approval_required");
    }
    if (
      admission?.approval_type === AUTONOMOUS_APPROVAL_TYPE ||
      Object.hasOwn(
        admission || {},
        "autonomous_publication_authority",
      )
    ) {
      blockers.push(
        "runway_human_autonomous_approval_conflation",
      );
    }
  }

  const autonomousEvidence = {};
  if (autonomous) {
    const humanFields = [
      "human_review_status",
      "human_review_event_id",
      "human_review_evidence_sha256",
      "human_review_audit_id",
      "humanReviewAuditId",
      "operator",
      "actor_id",
      "reason",
    ];
    if (
      humanFields.some(
        (field) =>
          (Object.hasOwn(candidate || {}, field) &&
            candidate?.[field] !== null &&
            candidate?.[field] !== undefined &&
            text(candidate?.[field]) !== "") ||
          Object.hasOwn(admission || {}, field),
      )
    ) {
      blockers.push(
        "runway_autonomous_human_approval_conflation",
      );
    }
    if (
      !admission ||
      admission.human_admission_required !== false ||
      text(admission.confirmation_story_id) !== storyId ||
      text(admission.scheduled_for) !== text(scheduledFor)
    ) {
      blockers.push(
        "runway_autonomous_admission_binding_invalid",
      );
    }
    const attestation =
      admission?.autonomous_window_eligibility_attestation;
    const preparation = admission?.jit_preparation;
    if (
      !attestation ||
      typeof attestation !== "object" ||
      Array.isArray(attestation) ||
      !preparation ||
      typeof preparation !== "object" ||
      Array.isArray(preparation)
    ) {
      blockers.push(
        "runway_autonomous_eligibility_and_jit_preparation_required",
      );
    } else {
      let validatedAttestation = null;
      const role =
        candidate?.standby_authorised === true
          ? "STANDBY"
          : "PRIMARY";
      try {
        validatedAttestation =
          validateAutonomousWindowEligibilityAttestation(
            attestation,
            {
              now,
              expected: {
                story_id: storyId,
                channel_id: "pulse-gaming",
                lane_id: text(candidate?.lane_id),
                platform: "youtube",
                scheduled_for: text(scheduledFor),
                role,
                evidence_hashes: {
                  media_sha256: hashes.media_sha256,
                  script_sha256: hashes.script_sha256,
                  qa_report_sha256: hashes.qa_report_sha256,
                  rights_ledger_sha256:
                    hashes.rights_ledger_sha256,
                  source_evidence_sha256:
                    hashes.source_evidence_sha256,
                },
                jit_preparation: preparation,
              },
            },
          );
      } catch (error) {
        blockers.push(
          error?.code ||
            "runway_autonomous_eligibility_attestation_invalid",
        );
      }
      if (validatedAttestation) {
        const attestationSha256 = normaliseSha256(
          validatedAttestation.attestation_sha256,
        );
        const preparationSha256 = normaliseSha256(
          preparation.preparation_sha256,
        );
        if (
          !preparationSha256 ||
          text(preparation.story_id) !== storyId ||
          text(preparation.channel_id) !== "pulse-gaming" ||
          text(preparation.lane_id) !==
            text(candidate?.lane_id) ||
          text(preparation.platform) !== "youtube" ||
          text(preparation.scheduled_for) !==
            text(scheduledFor) ||
          text(preparation.role).toUpperCase() !== role ||
          normaliseSha256(
            preparation.candidate_revision_sha256,
          ) !== hashes.candidate_revision_sha256 ||
          normaliseSha256(preparation.request_fingerprint) !==
            normaliseSha256(candidate?.request_fingerprint)
        ) {
          blockers.push(
            "runway_autonomous_jit_preparation_binding_mismatch",
          );
        }
        if (
          normaliseSha256(
            admission.autonomous_eligibility_attestation_sha256,
          ) !== attestationSha256 ||
          normaliseSha256(
            admission.jit_preparation_sha256,
          ) !== preparationSha256
        ) {
          blockers.push(
            "runway_autonomous_admission_eligibility_summary_mismatch",
          );
        }
        autonomousEvidence.approval_type =
          AUTONOMOUS_APPROVAL_TYPE;
        autonomousEvidence.candidate_binding_sha256 =
          normaliseSha256(
            validatedAttestation.candidate_binding_sha256,
          );
        autonomousEvidence.request_fingerprint =
          normaliseSha256(preparation.request_fingerprint);
        autonomousEvidence.jit_preparation_sha256 =
          preparationSha256;
        autonomousEvidence.autonomous_eligibility_attestation_id =
          text(validatedAttestation.attestation_id);
        autonomousEvidence.autonomous_eligibility_attestation_sha256 =
          attestationSha256;
        autonomousEvidence.autonomous_eligibility_valid_until =
          text(validatedAttestation.valid_until);
        autonomousEvidence.autonomous_source_report_sha256 =
          normaliseSha256(
            validatedAttestation.source_report?.report_sha256,
          );
        autonomousEvidence.autonomous_source_report_valid_until =
          text(
            validatedAttestation.source_report?.valid_until,
          );
        if (candidate?.standby_authorised === true) {
          evidence.standby_authorisation_event_id =
            text(validatedAttestation.attestation_id);
          evidence.standby_authorisation_sha256 =
            attestationSha256;
        }
      }
    }
  }

  const binding = {
    story_id: storyId,
    lane_id: text(candidate?.lane_id),
    stage,
    media_sha256: hashes.media_sha256,
    script_sha256: hashes.script_sha256,
    qa_report_sha256: hashes.qa_report_sha256,
    rights_ledger_sha256: hashes.rights_ledger_sha256,
    source_evidence_sha256: hashes.source_evidence_sha256,
    candidate_revision_sha256:
      hashes.candidate_revision_sha256,
    eligibility_verdict: "GREEN",
    standby_authorised: candidate?.standby_authorised === true,
    ...(human
      ? {
          human_review_status: "approved",
        }
      : autonomousEvidence),
    ...evidence,
  };
  return {
    binding: {
      ...binding,
      binding_sha256: canonicalSha256(binding),
    },
    blockers,
    score: Number.isFinite(Number(candidate?.score))
      ? Number(candidate.score)
      : 0,
  };
}

function parseStoredUtc(value) {
  const raw = text(value);
  const input =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jobPayload(job) {
  if (
    job?.payload &&
    typeof job.payload === "object" &&
    !Array.isArray(job.payload)
  ) {
    return job.payload;
  }
  try {
    const parsed = JSON.parse(text(job?.payload));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function primaryAdmissionJobBinding({
  jobs,
  primary,
  scheduledFor,
}) {
  if (!primary) return null;
  const scheduledAt = new Date(scheduledFor);
  const expectedRunAt = new Date(
    scheduledAt.getTime() - ADMISSION_OFFSET_MS,
  );
  const storyId = primary.binding.story_id;
  const revision =
    primary.binding.candidate_revision_sha256;
  const matches = (Array.isArray(jobs) ? jobs : []).filter(
    (job) => {
      const payload = jobPayload(job);
      const admission =
        payload.admission &&
        typeof payload.admission === "object"
          ? payload.admission
          : {};
      const runAt = parseStoredUtc(job?.run_at);
      const jobStoryId = text(
        job?.story_id || payload.story_id,
      );
      const jobRevision = normaliseSha256(
        payload.candidate_revision_sha256,
      );
      const primaryApprovalType =
        primary.binding.stage === "AUTONOMOUS_ELIGIBLE"
          ? AUTONOMOUS_APPROVAL_TYPE
          : HUMAN_APPROVAL_TYPE;
      const jobApprovalType =
        text(admission.approval_type).toUpperCase() ||
        HUMAN_APPROVAL_TYPE;
      return (
        text(job?.kind) === "admit_governed_publication" &&
        text(job?.status).toLowerCase() === "pending" &&
        Number.isInteger(Number(job?.id)) &&
        Number(job.id) > 0 &&
        jobStoryId === storyId &&
        jobRevision === revision &&
        jobApprovalType === primaryApprovalType &&
        (primaryApprovalType !== AUTONOMOUS_APPROVAL_TYPE ||
          (normaliseSha256(
            admission.autonomous_eligibility_attestation_sha256,
          ) ===
            normaliseSha256(
              primary.binding
                .autonomous_eligibility_attestation_sha256,
            ) &&
            normaliseSha256(
              admission.jit_preparation_sha256,
            ) ===
              normaliseSha256(
                primary.binding.jit_preparation_sha256,
              ))) &&
        runAt?.getTime() === expectedRunAt.getTime() &&
        text(admission.scheduled_for) === scheduledFor &&
        text(job?.idempotency_key) ===
          youtubeAdmissionJobIdempotencyKey({
            laneId: primary.binding.lane_id,
            storyId,
            candidateRevisionSha256: revision,
            scheduledFor,
          })
      );
    },
  );
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    job_id: Number(match.id),
    kind: "admit_governed_publication",
    status: "pending",
    story_id: storyId,
    candidate_revision_sha256: revision,
    run_at: expectedRunAt.toISOString(),
    scheduled_for: scheduledFor,
    idempotency_key: text(match.idempotency_key),
  };
}

function buildGovernedYoutubeRunwayLock({
  now = new Date(),
  publish_hour_utc: publishHourUtc,
  candidates = [],
  admission_jobs: admissionJobs = [],
} = {}) {
  let window;
  try {
    window = resolveT90Window({
      now,
      publish_hour_utc: publishHourUtc,
    });
  } catch (error) {
    return {
      schema_version: SCHEMA_VERSION,
      phase: "T-90",
      verdict: "HOLD",
      scheduled_for: null,
      window_id: null,
      blockers: [error.code || "runway_window_invalid"],
      lock: null,
      incident: {
        required: true,
        code: error.code || "runway_window_invalid",
      },
      safety: {
        publish_authority_created: false,
        external_publish_attempted: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        catch_up_allowed: false,
      },
    };
  }

  const assessed = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) =>
      candidateBinding(candidate, {
        now: window.evaluated_at,
        scheduledFor: window.scheduled_for,
      }),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.binding.story_id.localeCompare(
          right.binding.story_id,
        ),
    );
  const eligible = assessed.filter(
    (candidate) => candidate.blockers.length === 0,
  );
  const primary = eligible.find(
    (candidate) => candidate.binding.standby_authorised !== true,
  );
  const reserve = eligible.find(
    (candidate) =>
      candidate.binding.standby_authorised === true &&
      candidate.binding.story_id !== primary?.binding.story_id,
  );
  const lockBlockers = [];
  if (!primary) {
    lockBlockers.push("runway_primary_candidate_not_ready");
  }
  if (!reserve) {
    lockBlockers.push("runway_reserve_candidate_not_ready");
  }
  const primaryAdmissionJob = primaryAdmissionJobBinding({
    jobs: admissionJobs,
    primary,
    scheduledFor: window.scheduled_for,
  });
  if (primary && !primaryAdmissionJob) {
    lockBlockers.push(
      "runway_primary_admission_job_not_pending_at_t75",
    );
  }
  const reserveFailoverAuthority =
    primary &&
    reserve &&
    normaliseSha256(
      reserve.binding.standby_authorisation_sha256,
    )
      ? {
          schema_version:
            "pulse-governed-youtube-reserve-failover-authority-v1",
          scheduled_for: window.scheduled_for,
          primary_story_id: primary.binding.story_id,
          primary_binding_sha256:
            primary.binding.binding_sha256,
          reserve_story_id: reserve.binding.story_id,
          reserve_binding_sha256:
            reserve.binding.binding_sha256,
          standby_authorisation_event_id:
            reserve.binding.standby_authorisation_event_id,
          standby_authorisation_sha256:
            reserve.binding.standby_authorisation_sha256,
          required_primary_failure_classification:
            "DISPATCH_FAILED_BEFORE_CREATE",
          require_zero_platform_contact: true,
          require_zero_external_identity: true,
          promotion_deadline_offset_minutes: -60,
        }
      : null;
  if (reserve && !reserveFailoverAuthority) {
    lockBlockers.push(
      "runway_reserve_failover_authorisation_required",
    );
  }
  const failoverAuthorisationSha256 =
    reserveFailoverAuthority
      ? canonicalSha256(reserveFailoverAuthority)
      : null;
  const confirmedDisarmFailoverAuthority =
    reserveFailoverAuthority
      ? {
          schema_version:
            "pulse-governed-youtube-confirmed-disarm-failover-authority-v1",
          authority_type: "CONFIRMED_DISARM_FAILOVER",
          scheduled_for: window.scheduled_for,
          primary_story_id: primary.binding.story_id,
          primary_binding_sha256:
            primary.binding.binding_sha256,
          reserve_story_id: reserve.binding.story_id,
          reserve_binding_sha256:
            reserve.binding.binding_sha256,
          standby_authorisation_event_id:
            reserve.binding.standby_authorisation_event_id,
          standby_authorisation_sha256:
            reserve.binding.standby_authorisation_sha256,
          required_lifecycle_state:
            "PLATFORM_SCHEDULE_DISARMED",
          required_ledger_event_type:
            "SCHEDULE_DISARM_CONFIRMED",
          require_exact_external_identity: true,
          require_private_status: true,
          require_publish_at_absent: true,
          require_reconciliation_clear: true,
          promotion_deadline_offset_minutes: -15,
        }
      : null;
  const confirmedDisarmAuthorisationSha256 =
    confirmedDisarmFailoverAuthority
      ? canonicalSha256(confirmedDisarmFailoverAuthority)
      : null;
  const lockBody =
    lockBlockers.length === 0
      ? {
          schema_version: LOCK_SCHEMA_VERSION,
          window_id: window.window_id,
          scheduled_for: window.scheduled_for,
          locked_at: window.evaluated_at,
          primary: primary.binding,
          reserve: reserve.binding,
          primary_admission_job: primaryAdmissionJob,
          reserve_scheduled: false,
          reserve_failover: {
            verdict: "GREEN",
            code: "runway_reserve_conditionally_armed",
            reserve_story_id: reserve.binding.story_id,
            promotion_authority: true,
            second_scheduled_row_created: false,
            failover_authority:
              reserveFailoverAuthority,
            failover_authorisation_sha256:
              failoverAuthorisationSha256,
            confirmed_disarm_authority:
              confirmedDisarmFailoverAuthority,
            confirmed_disarm_authorisation_sha256:
              confirmedDisarmAuthorisationSha256,
            required_failure_classification:
              "DISPATCH_FAILED_BEFORE_CREATE",
            require_zero_platform_contact: true,
            require_zero_external_identity: true,
            promotion_deadline_offset_minutes: -60,
          },
          exact_scheduled_youtube_rows_required: 1,
          publish_authority: false,
          catch_up_allowed: false,
        }
      : null;
  const lock = lockBody
    ? {
        ...lockBody,
        lock_sha256: canonicalSha256(lockBody),
      }
    : null;
  const blockers = [...lockBlockers];

  return {
    schema_version: SCHEMA_VERSION,
    phase: "T-90",
    verdict: blockers.length ? "HOLD" : "GREEN",
    generated_at: window.evaluated_at,
    scheduled_for: window.scheduled_for,
    window_id: window.window_id,
    blockers,
    lock,
    candidates: {
      primary: primary?.binding || null,
      reserve: reserve?.binding || null,
      rejected: assessed
        .filter((candidate) => candidate.blockers.length > 0)
        .map((candidate) => ({
          story_id: candidate.binding.story_id,
          blockers: candidate.blockers,
        })),
    },
    incident: {
      required: blockers.length > 0,
      code: blockers[0] || null,
    },
    safety: {
      publish_authority_created: false,
      external_publish_attempted: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      catch_up_allowed: false,
    },
  };
}

function validateLock(lock) {
  const blockers = [];
  if (
    !lock ||
    typeof lock !== "object" ||
    Array.isArray(lock) ||
    lock.schema_version !== LOCK_SCHEMA_VERSION
  ) {
    return ["runway_lock_required"];
  }
  const lockBody = { ...lock };
  delete lockBody.lock_sha256;
  if (
    normaliseSha256(lock.lock_sha256) !==
    canonicalSha256(lockBody)
  ) {
    blockers.push("runway_lock_sha256_mismatch");
  }
  const scheduledAt = new Date(lock.scheduled_for);
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    !GUARDED_PUBLISH_HOURS_UTC.has(scheduledAt.getUTCHours()) ||
    scheduledAt.getUTCMinutes() !== 0 ||
    scheduledAt.getUTCSeconds() !== 0 ||
    scheduledAt.getUTCMilliseconds() !== 0
  ) {
    blockers.push("runway_lock_schedule_not_guarded");
  }
  if (
    !text(lock.primary?.story_id) ||
    !text(lock.reserve?.story_id) ||
    text(lock.primary?.story_id) === text(lock.reserve?.story_id)
  ) {
    blockers.push("runway_lock_distinct_candidates_required");
  }
  if (lock.reserve?.standby_authorised !== true) {
    blockers.push("runway_lock_reserve_authorisation_required");
  }
  if (lock.primary?.standby_authorised === true) {
    blockers.push("runway_lock_primary_standby_invalid");
  }
  for (const role of ["primary", "reserve"]) {
    for (const field of [
      "media_sha256",
      "script_sha256",
      "qa_report_sha256",
      "rights_ledger_sha256",
      "source_evidence_sha256",
      "candidate_revision_sha256",
      "binding_sha256",
    ]) {
      if (!normaliseSha256(lock[role]?.[field])) {
        blockers.push(`runway_lock_${role}_${field}_invalid`);
      }
    }
    const stage = text(lock[role]?.stage).toUpperCase();
    if (stage === "HUMAN_APPROVED") {
      if (
        text(lock[role]?.human_review_status).toLowerCase() !==
          "approved" ||
        Object.hasOwn(lock[role] || {}, "approval_type")
      ) {
        blockers.push(
          `runway_lock_${role}_human_review_approval_invalid`,
        );
      }
    } else if (stage === "AUTONOMOUS_ELIGIBLE") {
      if (
        lock[role]?.approval_type !==
          AUTONOMOUS_APPROVAL_TYPE ||
        !text(
          lock[role]
            ?.autonomous_eligibility_attestation_id,
        ) ||
        !normaliseSha256(
          lock[role]
            ?.autonomous_eligibility_attestation_sha256,
        ) ||
        !normaliseSha256(
          lock[role]?.candidate_binding_sha256,
        ) ||
        !normaliseSha256(
          lock[role]?.request_fingerprint,
        ) ||
        !normaliseSha256(
          lock[role]?.jit_preparation_sha256,
        ) ||
        !normaliseSha256(
          lock[role]?.autonomous_source_report_sha256,
        ) ||
        !parseStoredUtc(
          lock[role]?.autonomous_eligibility_valid_until,
        ) ||
        !parseStoredUtc(
          lock[role]
            ?.autonomous_source_report_valid_until,
        ) ||
        [
          "human_review_status",
          "human_review_event_id",
          "human_review_evidence_sha256",
        ].some((field) =>
          Object.hasOwn(lock[role] || {}, field),
        )
      ) {
        blockers.push(
          `runway_lock_${role}_autonomous_approval_invalid`,
        );
      }
    } else {
      blockers.push(
        `runway_lock_${role}_approval_variant_invalid`,
      );
    }
    if (
      text(lock[role]?.eligibility_verdict).toUpperCase() !==
      "GREEN"
    ) {
      blockers.push(
        `runway_lock_${role}_eligibility_verdict_invalid`,
      );
    }
    const evidenceFields = ["admission_evidence_sha256"];
    if (stage === "HUMAN_APPROVED") {
      evidenceFields.unshift("human_review_evidence_sha256");
    }
    for (const field of evidenceFields) {
      if (
        text(lock[role]?.[field]) &&
        !normaliseSha256(lock[role]?.[field])
      ) {
        blockers.push(`runway_lock_${role}_${field}_invalid`);
      }
    }
    const bindingBody = { ...lock[role] };
    delete bindingBody.binding_sha256;
    if (
      normaliseSha256(lock[role]?.binding_sha256) !==
      canonicalSha256(bindingBody)
    ) {
      blockers.push(
        `runway_lock_${role}_binding_sha256_mismatch`,
      );
    }
  }
  if (
    lock.reserve_scheduled !== false ||
    lock.exact_scheduled_youtube_rows_required !== 1 ||
    lock.publish_authority !== false ||
    lock.catch_up_allowed !== false
  ) {
    blockers.push("runway_lock_safety_contract_invalid");
  }
  const expectedAdmissionAt = new Date(
    scheduledAt.getTime() - ADMISSION_OFFSET_MS,
  );
  const admissionRunAt = parseStoredUtc(
    lock.primary_admission_job?.run_at,
  );
  let expectedAdmissionKey = null;
  try {
    expectedAdmissionKey =
      youtubeAdmissionJobIdempotencyKey({
        laneId: lock.primary?.lane_id,
        storyId: lock.primary?.story_id,
        candidateRevisionSha256:
          lock.primary?.candidate_revision_sha256,
        scheduledFor: lock.scheduled_for,
      });
  } catch {
    blockers.push(
      "runway_lock_primary_admission_job_binding_invalid",
    );
  }
  if (
    !Number.isInteger(
      Number(lock.primary_admission_job?.job_id),
    ) ||
    Number(lock.primary_admission_job?.job_id) <= 0 ||
    text(lock.primary_admission_job?.kind) !==
      "admit_governed_publication" ||
    text(lock.primary_admission_job?.status).toLowerCase() !==
      "pending" ||
    text(lock.primary_admission_job?.story_id) !==
      text(lock.primary?.story_id) ||
    normaliseSha256(
      lock.primary_admission_job
        ?.candidate_revision_sha256,
    ) !==
      normaliseSha256(
        lock.primary?.candidate_revision_sha256,
      ) ||
    admissionRunAt?.getTime() !== expectedAdmissionAt.getTime() ||
    text(lock.primary_admission_job?.scheduled_for) !==
      text(lock.scheduled_for) ||
    text(lock.primary_admission_job?.idempotency_key) !==
      expectedAdmissionKey
  ) {
    blockers.push(
      "runway_lock_primary_admission_job_binding_invalid",
    );
  }
  const failoverAuthority =
    lock.reserve_failover?.failover_authority;
  const confirmedDisarmAuthority =
    lock.reserve_failover?.confirmed_disarm_authority;
  if (
    lock.reserve_failover?.verdict !== "GREEN" ||
    lock.reserve_failover?.promotion_authority !== true ||
    lock.reserve_failover?.second_scheduled_row_created !== false ||
    lock.reserve_failover?.required_failure_classification !==
      "DISPATCH_FAILED_BEFORE_CREATE" ||
    lock.reserve_failover?.require_zero_platform_contact !== true ||
    lock.reserve_failover?.require_zero_external_identity !== true ||
    lock.reserve_failover?.promotion_deadline_offset_minutes !== -60 ||
    normaliseSha256(
      lock.reserve_failover?.failover_authorisation_sha256,
    ) !== canonicalSha256(failoverAuthority || {}) ||
    text(failoverAuthority?.scheduled_for) !==
      text(lock.scheduled_for) ||
    text(failoverAuthority?.primary_story_id) !==
      text(lock.primary?.story_id) ||
    normaliseSha256(
      failoverAuthority?.primary_binding_sha256,
    ) !== normaliseSha256(lock.primary?.binding_sha256) ||
    text(failoverAuthority?.reserve_story_id) !==
      text(lock.reserve?.story_id) ||
    normaliseSha256(
      failoverAuthority?.reserve_binding_sha256,
    ) !== normaliseSha256(lock.reserve?.binding_sha256) ||
    normaliseSha256(
      failoverAuthority?.standby_authorisation_sha256,
    ) !==
      normaliseSha256(
        lock.reserve?.standby_authorisation_sha256,
      ) ||
    text(
      failoverAuthority?.standby_authorisation_event_id,
    ) !==
      text(lock.reserve?.standby_authorisation_event_id)
  ) {
    blockers.push("runway_lock_reserve_failover_safety_invalid");
  }
  if (
    text(confirmedDisarmAuthority?.authority_type) !==
      "CONFIRMED_DISARM_FAILOVER" ||
    normaliseSha256(
      lock.reserve_failover
        ?.confirmed_disarm_authorisation_sha256,
    ) !== canonicalSha256(confirmedDisarmAuthority || {}) ||
    text(confirmedDisarmAuthority?.scheduled_for) !==
      text(lock.scheduled_for) ||
    text(confirmedDisarmAuthority?.primary_story_id) !==
      text(lock.primary?.story_id) ||
    normaliseSha256(
      confirmedDisarmAuthority?.primary_binding_sha256,
    ) !== normaliseSha256(lock.primary?.binding_sha256) ||
    text(confirmedDisarmAuthority?.reserve_story_id) !==
      text(lock.reserve?.story_id) ||
    normaliseSha256(
      confirmedDisarmAuthority?.reserve_binding_sha256,
    ) !== normaliseSha256(lock.reserve?.binding_sha256) ||
    normaliseSha256(
      confirmedDisarmAuthority?.standby_authorisation_sha256,
    ) !==
      normaliseSha256(
        lock.reserve?.standby_authorisation_sha256,
      ) ||
    text(
      confirmedDisarmAuthority?.standby_authorisation_event_id,
    ) !==
      text(lock.reserve?.standby_authorisation_event_id) ||
    text(confirmedDisarmAuthority?.required_lifecycle_state) !==
      "PLATFORM_SCHEDULE_DISARMED" ||
    text(confirmedDisarmAuthority?.required_ledger_event_type) !==
      "SCHEDULE_DISARM_CONFIRMED" ||
    confirmedDisarmAuthority?.require_exact_external_identity !==
      true ||
    confirmedDisarmAuthority?.require_private_status !== true ||
    confirmedDisarmAuthority?.require_publish_at_absent !== true ||
    confirmedDisarmAuthority?.require_reconciliation_clear !== true ||
    confirmedDisarmAuthority?.promotion_deadline_offset_minutes !==
      -15
  ) {
    blockers.push(
      "runway_lock_confirmed_disarm_failover_safety_invalid",
    );
  }
  return [...new Set(blockers)];
}

function buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
  now = new Date(),
  lock,
  primary_disarm: primaryDisarm,
} = {}) {
  const blockers = validateLock(lock);
  const evaluatedAt = normaliseTime(
    now,
    "runway_confirmed_disarm_promotion_time_invalid",
  );
  const scheduledAt = new Date(lock?.scheduled_for);
  const authority =
    lock?.reserve_failover?.confirmed_disarm_authority;
  const deadlineOffsetMinutes = Number(
    authority?.promotion_deadline_offset_minutes,
  );
  const cutoffAt = new Date(
    scheduledAt.getTime() +
      deadlineOffsetMinutes * 60 * 1000,
  );
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    !Number.isFinite(deadlineOffsetMinutes) ||
    evaluatedAt.getTime() >= cutoffAt.getTime()
  ) {
    blockers.push(
      "runway_confirmed_disarm_promotion_deadline_expired",
    );
  }
  const disarm =
    primaryDisarm &&
    typeof primaryDisarm === "object" &&
    !Array.isArray(primaryDisarm)
      ? primaryDisarm
      : {};
  const disarmBody = { ...disarm };
  delete disarmBody.disarm_event_sha256;
  const suppliedDisarmSha = normaliseSha256(
    disarm.disarm_event_sha256,
  );
  if (
    !suppliedDisarmSha ||
    suppliedDisarmSha !== canonicalSha256(disarmBody)
  ) {
    blockers.push(
      "runway_primary_disarm_event_sha256_mismatch",
    );
  }
  if (
    text(disarm.classification) !==
      "CONFIRMED_DISARM_FAILOVER" ||
    text(disarm.lifecycle_state) !==
      "PLATFORM_SCHEDULE_DISARMED"
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_state_required",
    );
  }
  if (
    text(disarm.story_id) !== text(lock?.primary?.story_id) ||
    text(disarm.platform).toLowerCase() !== "youtube" ||
    text(disarm.scheduled_for) !== text(lock?.scheduled_for) ||
    normaliseSha256(disarm.runway_lock_sha256) !==
      normaliseSha256(lock?.lock_sha256)
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_binding_mismatch",
    );
  }
  if (
    !text(disarm.external_id) ||
    !Number.isInteger(Number(disarm.ledger_event_id)) ||
    Number(disarm.ledger_event_id) <= 0 ||
    !text(disarm.ledger_idempotency_key) ||
    !normaliseSha256(disarm.disarm_ledger_event_sha256)
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_ledger_binding_required",
    );
  }
  if (
    !text(disarm.verified_external_id) ||
    text(disarm.verified_external_id) !==
      text(disarm.external_id)
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_external_identity_mismatch",
    );
  }
  if (
    text(disarm.privacy_status).toLowerCase() !== "private" ||
    !Object.prototype.hasOwnProperty.call(disarm, "publish_at") ||
    disarm.publish_at !== null ||
    disarm.verification_uncertain !== false ||
    disarm.reconciliation_required !== false
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_proof_invalid",
    );
  }
  const authoritySha = normaliseSha256(
    lock?.reserve_failover
      ?.confirmed_disarm_authorisation_sha256,
  );
  if (
    text(authority?.authority_type) !==
      "CONFIRMED_DISARM_FAILOVER" ||
    !authoritySha
  ) {
    blockers.push(
      "runway_confirmed_disarm_failover_authorisation_required",
    );
  }
  if (blockers.length) {
    return {
      schema_version:
        "pulse-governed-youtube-reserve-promotion-v1",
      verdict: "HOLD",
      generated_at: evaluatedAt.toISOString(),
      scheduled_for:
        Number.isNaN(scheduledAt.getTime())
          ? null
          : scheduledAt.toISOString(),
      blockers: [...new Set(blockers)],
      promotion: null,
      catch_up_allowed: false,
      platform_contacted: true,
      external_identity_active: true,
    };
  }
  const promotionBody = {
    schema_version:
      "pulse-governed-youtube-reserve-promotion-evidence-v1",
    authority_type: "CONFIRMED_DISARM_FAILOVER",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: lock.scheduled_for,
    runway_lock_sha256: lock.lock_sha256,
    failover_authorisation_sha256: authoritySha,
    primary_story_id: lock.primary.story_id,
    primary_disarm_event_sha256: suppliedDisarmSha,
    primary_disarm_ledger_event_id:
      Number(disarm.ledger_event_id),
    primary_disarm_ledger_idempotency_key:
      text(disarm.ledger_idempotency_key),
    primary_disarm_ledger_event_sha256:
      normaliseSha256(
        disarm.disarm_ledger_event_sha256,
      ),
    primary_failure_classification:
      "CONFIRMED_DISARM_FAILOVER",
    reserve_story_id: lock.reserve.story_id,
    reserve_candidate_revision_sha256:
      lock.reserve.candidate_revision_sha256,
    reserve_selection_event_sha256:
      lock.reserve.standby_authorisation_sha256,
    platform_contacted: true,
    uncertain_external_creation: false,
    external_id: text(disarm.external_id),
    external_schedule_disarmed: true,
    privacy_status: "private",
    publish_at: null,
    reconciliation_required: false,
    catch_up_allowed: false,
  };
  return {
    schema_version:
      "pulse-governed-youtube-reserve-promotion-v1",
    verdict: "GREEN",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: lock.scheduled_for,
    blockers: [],
    promotion: {
      ...promotionBody,
      promotion_sha256: canonicalSha256(promotionBody),
    },
    catch_up_allowed: false,
    platform_contacted: true,
    external_identity_active: false,
  };
}

function buildGovernedYoutubeReservePromotionEvidence({
  now = new Date(),
  lock,
  primary_failure: primaryFailure,
} = {}) {
  const blockers = validateLock(lock);
  const evaluatedAt = normaliseTime(
    now,
    "runway_reserve_promotion_time_invalid",
  );
  const scheduledAt = new Date(lock?.scheduled_for);
  const cutoffAt = new Date(
    scheduledAt.getTime() -
      RESERVE_PROMOTION_CUTOFF_OFFSET_MS,
  );
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    evaluatedAt.getTime() >= cutoffAt.getTime()
  ) {
    blockers.push(
      "runway_reserve_promotion_deadline_expired",
    );
  }
  const failure =
    primaryFailure &&
    typeof primaryFailure === "object" &&
    !Array.isArray(primaryFailure)
      ? primaryFailure
      : {};
  const failureBody = { ...failure };
  delete failureBody.failure_event_sha256;
  const suppliedFailureSha = normaliseSha256(
    failure.failure_event_sha256,
  );
  if (
    !suppliedFailureSha ||
    suppliedFailureSha !== canonicalSha256(failureBody)
  ) {
    blockers.push(
      "runway_primary_failure_event_sha256_mismatch",
    );
  }
  if (
    text(failure.classification) !==
    "DISPATCH_FAILED_BEFORE_CREATE"
  ) {
    blockers.push(
      "runway_primary_failure_not_decisive_pre_create",
    );
  }
  if (
    text(failure.story_id) !== text(lock?.primary?.story_id) ||
    text(failure.platform).toLowerCase() !== "youtube" ||
    text(failure.scheduled_for) !==
      text(lock?.scheduled_for) ||
    normaliseSha256(failure.runway_lock_sha256) !==
      normaliseSha256(lock?.lock_sha256)
  ) {
    blockers.push(
      "runway_primary_failure_binding_mismatch",
    );
  }
  if (
    failure.platform_contacted !== false ||
    failure.uncertain_external_creation !== false ||
    text(failure.external_id)
  ) {
    blockers.push(
      "runway_primary_failure_external_contact_not_zero",
    );
  }
  const authoritySha = normaliseSha256(
    lock?.reserve_failover
      ?.failover_authorisation_sha256,
  );
  if (!authoritySha) {
    blockers.push(
      "runway_reserve_failover_authorisation_required",
    );
  }
  if (blockers.length) {
    return {
      schema_version:
        "pulse-governed-youtube-reserve-promotion-v1",
      verdict: "HOLD",
      generated_at: evaluatedAt.toISOString(),
      scheduled_for:
        Number.isNaN(scheduledAt.getTime())
          ? null
          : scheduledAt.toISOString(),
      blockers: [...new Set(blockers)],
      promotion: null,
      catch_up_allowed: false,
      platform_contacted: false,
      external_identity_created: false,
    };
  }
  const promotionBody = {
    schema_version:
      "pulse-governed-youtube-reserve-promotion-evidence-v1",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: lock.scheduled_for,
    runway_lock_sha256: lock.lock_sha256,
    failover_authorisation_sha256: authoritySha,
    primary_story_id: lock.primary.story_id,
    primary_failure_event_sha256: suppliedFailureSha,
    primary_failure_classification:
      "DISPATCH_FAILED_BEFORE_CREATE",
    reserve_story_id: lock.reserve.story_id,
    reserve_candidate_revision_sha256:
      lock.reserve.candidate_revision_sha256,
    reserve_selection_event_sha256:
      lock.reserve.standby_authorisation_sha256,
    platform_contacted: false,
    uncertain_external_creation: false,
    external_id: null,
    catch_up_allowed: false,
  };
  return {
    schema_version:
      "pulse-governed-youtube-reserve-promotion-v1",
    verdict: "GREEN",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: lock.scheduled_for,
    blockers: [],
    promotion: {
      ...promotionBody,
      promotion_sha256: canonicalSha256(promotionBody),
    },
    catch_up_allowed: false,
    platform_contacted: false,
    external_identity_created: false,
  };
}

function validateGovernedYoutubeReservePromotionEvidence({
  lock,
  promotion,
} = {}) {
  const blockers = validateLock(lock);
  if (
    !promotion ||
    typeof promotion !== "object" ||
    Array.isArray(promotion)
  ) {
    return [
      ...new Set([
        ...blockers,
        "runway_reserve_promotion_evidence_required",
      ]),
    ];
  }
  const promotionBody = { ...promotion };
  delete promotionBody.promotion_sha256;
  if (
    normaliseSha256(promotion.promotion_sha256) !==
    canonicalSha256(promotionBody)
  ) {
    blockers.push(
      "runway_reserve_promotion_sha256_mismatch",
    );
  }
  if (
    text(promotion.scheduled_for) !==
      text(lock?.scheduled_for) ||
    normaliseSha256(promotion.runway_lock_sha256) !==
      normaliseSha256(lock?.lock_sha256) ||
    normaliseSha256(
      promotion.failover_authorisation_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve_failover
          ?.failover_authorisation_sha256,
      ) ||
    text(promotion.primary_story_id) !==
      text(lock?.primary?.story_id) ||
    text(promotion.reserve_story_id) !==
      text(lock?.reserve?.story_id) ||
    normaliseSha256(
      promotion.reserve_candidate_revision_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve?.candidate_revision_sha256,
      ) ||
    normaliseSha256(
      promotion.reserve_selection_event_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve?.standby_authorisation_sha256,
      )
  ) {
    blockers.push(
      "runway_reserve_promotion_binding_mismatch",
    );
  }
  if (
    text(promotion.primary_failure_classification) !==
      "DISPATCH_FAILED_BEFORE_CREATE" ||
    !normaliseSha256(
      promotion.primary_failure_event_sha256,
    ) ||
    promotion.platform_contacted !== false ||
    promotion.uncertain_external_creation !== false ||
    text(promotion.external_id) ||
    promotion.catch_up_allowed !== false
  ) {
    blockers.push(
      "runway_reserve_promotion_safety_invalid",
    );
  }
  return [...new Set(blockers)];
}

function validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
  lock,
  promotion,
} = {}) {
  const blockers = validateLock(lock);
  if (
    !promotion ||
    typeof promotion !== "object" ||
    Array.isArray(promotion)
  ) {
    return [
      ...new Set([
        ...blockers,
        "runway_reserve_promotion_evidence_required",
      ]),
    ];
  }
  const promotionBody = { ...promotion };
  delete promotionBody.promotion_sha256;
  if (
    normaliseSha256(promotion.promotion_sha256) !==
    canonicalSha256(promotionBody)
  ) {
    blockers.push(
      "runway_reserve_promotion_sha256_mismatch",
    );
  }
  if (
    text(promotion.authority_type) !==
      "CONFIRMED_DISARM_FAILOVER" ||
    text(promotion.scheduled_for) !==
      text(lock?.scheduled_for) ||
    normaliseSha256(promotion.runway_lock_sha256) !==
      normaliseSha256(lock?.lock_sha256) ||
    normaliseSha256(
      promotion.failover_authorisation_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve_failover
          ?.confirmed_disarm_authorisation_sha256,
      ) ||
    text(promotion.primary_story_id) !==
      text(lock?.primary?.story_id) ||
    text(promotion.reserve_story_id) !==
      text(lock?.reserve?.story_id) ||
    normaliseSha256(
      promotion.reserve_candidate_revision_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve?.candidate_revision_sha256,
      ) ||
    normaliseSha256(
      promotion.reserve_selection_event_sha256,
    ) !==
      normaliseSha256(
        lock?.reserve?.standby_authorisation_sha256,
      )
  ) {
    blockers.push(
      "runway_reserve_promotion_binding_mismatch",
    );
  }
  if (
    text(promotion.primary_failure_classification) !==
      "CONFIRMED_DISARM_FAILOVER" ||
    !normaliseSha256(
      promotion.primary_disarm_event_sha256,
    ) ||
    !Number.isInteger(
      Number(promotion.primary_disarm_ledger_event_id),
    ) ||
    Number(promotion.primary_disarm_ledger_event_id) <= 0 ||
    !text(
      promotion.primary_disarm_ledger_idempotency_key,
    ) ||
    !normaliseSha256(
      promotion.primary_disarm_ledger_event_sha256,
    ) ||
    promotion.platform_contacted !== true ||
    promotion.uncertain_external_creation !== false ||
    !text(promotion.external_id) ||
    promotion.external_schedule_disarmed !== true ||
    text(promotion.privacy_status).toLowerCase() !== "private" ||
    !Object.prototype.hasOwnProperty.call(
      promotion,
      "publish_at",
    ) ||
    promotion.publish_at !== null ||
    promotion.reconciliation_required !== false ||
    promotion.catch_up_allowed !== false
  ) {
    blockers.push(
      "runway_reserve_promotion_safety_invalid",
    );
  }
  return [...new Set(blockers)];
}

function verifyGovernedYoutubeLockedDispatch({
  now = new Date(),
  lock,
  scheduled_binding: scheduledBinding = {},
} = {}) {
  const blockers = validateLock(lock);
  const evaluatedAt = normaliseTime(
    now,
    "runway_dispatch_time_invalid",
  );
  const scheduledAt = new Date(lock?.scheduled_for);
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    Math.abs(evaluatedAt.getTime() - scheduledAt.getTime()) >
      T0_TOLERANCE_MS
  ) {
    blockers.push(
      evaluatedAt.getTime() > scheduledAt.getTime()
        ? "runway_window_expired_no_catch_up"
        : "runway_dispatch_window_not_open",
    );
  }
  const storyId = text(
    scheduledBinding.storyId || scheduledBinding.story_id,
  );
  const selectedRole =
    storyId === text(lock?.primary?.story_id)
      ? "primary"
      : storyId === text(lock?.reserve?.story_id)
        ? "reserve"
        : null;
  if (!selectedRole) {
    blockers.push("runway_scheduled_story_not_locked");
  }
  if (selectedRole === "reserve") {
    const promotion =
      scheduledBinding.reservePromotion ||
      scheduledBinding.reserve_promotion;
    const promotionBlockers =
      text(promotion?.authority_type) ===
      "CONFIRMED_DISARM_FAILOVER"
        ? validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
            { lock, promotion },
          )
        : validateGovernedYoutubeReservePromotionEvidence({
            lock,
            promotion,
          });
    if (promotionBlockers.length) {
      blockers.push(...promotionBlockers);
      blockers.push(
        "runway_reserve_promotion_evidence_required",
      );
    }
  }
  if (
    text(scheduledBinding.platform).toLowerCase() !== "youtube"
  ) {
    blockers.push("runway_scheduled_platform_not_youtube");
  }
  const boundScheduledFor = text(
    scheduledBinding.scheduledFor ||
      scheduledBinding.scheduled_for,
  );
  if (boundScheduledFor !== text(lock?.scheduled_for)) {
    blockers.push("runway_scheduled_time_mismatch");
  }
  const boundLockSha = normaliseSha256(
    scheduledBinding.runwayLockSha256 ||
      scheduledBinding.runway_lock_sha256,
  );
  if (boundLockSha !== normaliseSha256(lock?.lock_sha256)) {
    blockers.push("runway_scheduled_lock_sha256_mismatch");
  }
  const scheduledEventId = Number(
    scheduledBinding.scheduledEventId ||
      scheduledBinding.scheduled_event_id,
  );
  if (!Number.isInteger(scheduledEventId) || scheduledEventId <= 0) {
    blockers.push("runway_scheduled_event_id_required");
  }
  if (
    !text(
      scheduledBinding.dispatchIdempotencyKey ||
        scheduledBinding.dispatch_idempotency_key,
    )
  ) {
    blockers.push("runway_dispatch_idempotency_key_required");
  }
  if (
    !normaliseSha256(
      scheduledBinding.requestFingerprint ||
        scheduledBinding.request_fingerprint,
    )
  ) {
    blockers.push("runway_request_fingerprint_required");
  }
  return {
    schema_version:
      "pulse-governed-youtube-runway-dispatch-verification-v1",
    phase: "T0",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: Number.isNaN(scheduledAt.getTime())
      ? null
      : scheduledAt.toISOString(),
    verdict: blockers.length ? "HOLD" : "GREEN",
    blockers: [...new Set(blockers)],
    story_id: storyId || null,
    selected_role: selectedRole,
    runway_lock_sha256: normaliseSha256(lock?.lock_sha256),
    exact_scheduled_youtube_rows_required: 1,
    dispatch_authority_created: false,
    catch_up_allowed: false,
  };
}

function youtubePublicationUrl(value, externalId) {
  try {
    const url = new URL(text(value));
    const allowedHost =
      url.protocol === "https:" &&
      [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "m.youtube.com",
      ].includes(url.hostname.toLowerCase());
    return allowedHost && url.href.includes(externalId)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function classifyGovernedYoutubeWindowOutcome({
  now = new Date(),
  lock,
  observation = {},
  observations,
  selected_release: selectedRelease,
} = {}) {
  const lockBlockers = validateLock(lock);
  const evaluatedAt = normaliseTime(
    now,
    "runway_outcome_time_invalid",
  );
  const scheduledAt = new Date(lock?.scheduled_for);
  const phaseBlockers = [];
  if (
    Number.isNaN(scheduledAt.getTime()) ||
    Math.abs(
      evaluatedAt.getTime() -
        (scheduledAt.getTime() + T15_OFFSET_MS),
    ) > PHASE_TOLERANCE_MS
  ) {
    phaseBlockers.push("runway_t15_verification_time_invalid");
  }
  const observedSet =
    Array.isArray(observations) &&
    observations.length > 0
      ? observations.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item),
        )
      : [observation || {}];
  const primaryStoryId = text(lock?.primary?.story_id);
  const reserveStoryId = text(lock?.reserve?.story_id);
  const lockedStoryIds = new Set(
    [primaryStoryId, reserveStoryId].filter(Boolean),
  );
  const observedLockedStoryIds = new Set(
    observedSet
      .map((item) => text(item.story_id))
      .filter((storyId) => lockedStoryIds.has(storyId)),
  );
  const observationScopeComplete =
    Array.isArray(observations) &&
    observedLockedStoryIds.has(primaryStoryId) &&
    observedLockedStoryIds.has(reserveStoryId);
  const selectedRole = text(selectedRelease?.role).toLowerCase();
  const selectedStoryId = text(selectedRelease?.story_id);
  const explicitSelection =
    Boolean(selectedRole) || Boolean(selectedStoryId);
  const selectedStoryMatchesLock =
    (selectedRole === "primary" &&
      selectedStoryId === primaryStoryId) ||
    (selectedRole === "reserve" &&
      selectedStoryId === reserveStoryId);
  const selectedReleaseRequired = !explicitSelection;
  const selectedReleaseBindingInvalid =
    explicitSelection && !selectedStoryMatchesLock;
  const confirmedIdentityMap = new Map();
  for (const item of observedSet) {
    const storyId = text(item.story_id);
    const externalId = text(item.external_id);
    const externalUrl = youtubePublicationUrl(
      item.external_url,
      externalId,
    );
    if (
      !lockedStoryIds.has(storyId) ||
      text(item.platform).toLowerCase() !== "youtube" ||
      text(item.verification_status).toLowerCase() !==
        "confirmed" ||
      !externalId ||
      !externalUrl
    ) {
      continue;
    }
    const publishedAtMs = Date.parse(text(item.published_at));
    confirmedIdentityMap.set(`${storyId}\u0000${externalId}`, {
      story_id: storyId,
      external_id: externalId,
      external_url: externalUrl,
      published_at_ms: publishedAtMs,
      publication_time_valid:
        Number.isFinite(publishedAtMs) &&
        !Number.isNaN(scheduledAt.getTime()) &&
        publishedAtMs >=
          scheduledAt.getTime() - T0_TOLERANCE_MS &&
        publishedAtMs <=
          scheduledAt.getTime() + T15_OFFSET_MS,
    });
  }
  const confirmedIdentities = [
    ...confirmedIdentityMap.values(),
  ];
  const selectedIdentities = explicitSelection
    ? confirmedIdentities.filter(
        (identity) =>
          identity.story_id === selectedStoryId,
      )
    : confirmedIdentities;
  const selectedIdentity =
    selectedIdentities.length === 1
      ? selectedIdentities[0]
      : null;
  const selectedPublicationIdentityCountInvalid =
    explicitSelection &&
    selectedStoryMatchesLock &&
    selectedIdentities.length !== 1;
  const publishedLockedRoles = new Set(
    confirmedIdentities.map((identity) => identity.story_id),
  );
  const duplicateLockedPublication =
    publishedLockedRoles.has(primaryStoryId) &&
    publishedLockedRoles.has(reserveStoryId);
  const wrongRolePublication =
    explicitSelection &&
    selectedStoryMatchesLock &&
    confirmedIdentities.some(
      (identity) => identity.story_id !== selectedStoryId,
    );
  const selectedReleaseIntegrityViolation =
    confirmedIdentities.length > 0 &&
    (selectedReleaseRequired ||
      selectedReleaseBindingInvalid);
  const publicationIntegrityViolation =
    wrongRolePublication ||
    duplicateLockedPublication ||
    selectedReleaseIntegrityViolation ||
    selectedIdentities.length > 1 ||
    (confirmedIdentities.length > 0 &&
      !observationScopeComplete);
  const confirmedPublication =
    lockBlockers.length === 0 &&
    phaseBlockers.length === 0 &&
    selectedIdentity?.publication_time_valid === true &&
    confirmedIdentities.length === 1 &&
    explicitSelection &&
    selectedStoryMatchesLock &&
    observationScopeComplete;
  const policyBlockers = observedSet.flatMap((item) =>
    Array.isArray(item.policy_blockers)
      ? item.policy_blockers.map(text).filter(Boolean)
      : [],
  );
  let classification;
  if (confirmedPublication) {
    classification = "HIT";
  } else if (publicationIntegrityViolation) {
    classification = "EXTERNAL_FAILURE";
  } else if (
    observedSet.some((item) => item.held_policy === true) ||
    policyBlockers.length > 0
  ) {
    classification = "HELD_POLICY";
  } else if (
    observedSet.some(
      (item) =>
        item.platform_contacted === true ||
        item.dispatch_attempted === true,
    )
  ) {
    classification = "EXTERNAL_FAILURE";
  } else {
    classification = "MISSED_INTERNAL";
  }
  const blockers = [
    ...lockBlockers,
    ...phaseBlockers,
    ...(selectedReleaseRequired
      ? ["runway_selected_release_required"]
      : []),
    ...(selectedReleaseBindingInvalid
      ? ["runway_selected_release_binding_mismatch"]
      : []),
    ...(!observationScopeComplete
      ? [
          "runway_locked_publication_observation_scope_incomplete",
        ]
      : []),
    ...(selectedPublicationIdentityCountInvalid
      ? [
          "runway_selected_publication_identity_count_invalid",
        ]
      : []),
    ...(confirmedPublication
      ? []
      : publicationIntegrityViolation
        ? [
            ...(wrongRolePublication
              ? ["runway_wrong_role_publication_confirmed"]
              : []),
            ...(duplicateLockedPublication
              ? [
                  "runway_duplicate_locked_publication_confirmed",
                ]
              : []),
          ]
        : classification === "HELD_POLICY"
          ? policyBlockers.length
            ? policyBlockers
            : ["runway_dispatch_held_by_policy"]
          : classification === "EXTERNAL_FAILURE"
            ? ["runway_external_publication_not_confirmed"]
            : ["runway_window_missed_internally"]),
  ];
  return {
    schema_version:
      "pulse-governed-youtube-window-outcome-v1",
    phase: "T+15",
    generated_at: evaluatedAt.toISOString(),
    scheduled_for: Number.isNaN(scheduledAt.getTime())
      ? null
      : scheduledAt.toISOString(),
    classification,
    verdict: classification === "HIT" ? "GREEN" : "HOLD",
    blockers: [...new Set(blockers)],
    runway_lock_sha256: normaliseSha256(lock?.lock_sha256),
    selected_release: explicitSelection
      ? {
          role: selectedRole || null,
          story_id: selectedStoryId || null,
        }
      : null,
    selected_publication_identity_count:
      selectedIdentities.length,
    locked_publication_observation_scope: {
      complete: observationScopeComplete,
      observed_story_ids: [...observedLockedStoryIds],
      required_story_ids: [
        primaryStoryId || null,
        reserveStoryId || null,
      ],
    },
    publication: confirmedPublication
      ? {
          story_id: selectedIdentity.story_id,
          external_id: selectedIdentity.external_id,
          external_url: selectedIdentity.external_url,
          published_at: new Date(
            selectedIdentity.published_at_ms,
          ).toISOString(),
          verification_status: "confirmed",
        }
      : null,
    incident: {
      required: classification !== "HIT",
      classification:
        classification === "HIT" ? null : classification,
    },
    catch_up_allowed: false,
    retry_allowed: false,
    publish_authority_created: false,
  };
}

module.exports = {
  AUTONOMOUS_ELIGIBILITY_SCHEMA_VERSION,
  AUTONOMOUS_JIT_PREPARATION_SCHEMA_VERSION,
  GUARDED_PUBLISH_HOURS_UTC,
  LOCK_SCHEMA_VERSION,
  PHASE_TOLERANCE_MS,
  SCHEMA_VERSION,
  T15_OFFSET_MS,
  T90_OFFSET_MS,
  T0_TOLERANCE_MS,
  buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  buildGovernedYoutubeReservePromotionEvidence,
  buildGovernedYoutubeRunwayLock,
  canonicalSha256,
  classifyGovernedYoutubeWindowOutcome,
  createAutonomousWindowEligibilityAttestation,
  resolveT90Window,
  validateGovernedYoutubeReservePromotionEvidence,
  validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  validateLock,
  validateAutonomousWindowEligibilityAttestation,
  verifyGovernedYoutubeLockedDispatch,
};
