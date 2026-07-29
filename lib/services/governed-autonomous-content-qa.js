"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const mediaPaths = require("../media-paths");
const {
  sha256File,
} = require("./publication-request-fingerprint");

const AUTHORITY_TYPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const AUTHORITY_SCOPE = "PUBLICATION_ADMISSION_ONLY";
const DECISION_AUTHORITY = "SYSTEM_POLICY";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const VISUAL_GATE_FAILURE =
  "human_visual_review_required:studio-v21";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AUTHORITY_ID_PATTERN =
  /^autonomous-official-publication:[a-f0-9]{64}$/;
const VALIDATED_AUTHORITIES = new WeakSet();

const VISUAL_GATE_FIELDS = new Set([
  "authority_scope",
  "database_authority",
  "decision_authority",
  "decision_file_sha256",
  "decision_self_sha256",
  "distinct_model_count",
  "gate",
  "human_approval",
  "minimum_distinct_vision_models",
  "models_treated_as_humans",
  "network_used",
  "oauth_or_token_authority",
  "platform_contacted",
  "policy_id",
  "policy_version",
  "publish_authority",
  "required_aggregation",
  "required_report_schema",
  "scheduler_authority",
]);
const RELEASE_BOUNDARY_FIELDS = new Set([
  "boundary",
  "disarm_on_failure",
  "exact_binding_revalidation_required",
  "kill_switch_revalidation_required",
  "max_control_age_ms",
  "official_source_revalidation_required",
  "single_owner_revalidation_required",
]);

class GovernedAutonomousContentQaError extends Error {
  constructor(codes) {
    const values = Array.isArray(codes) ? codes : [codes];
    const unique = [...new Set(values.filter(Boolean))];
    super(unique[0] || "governed_autonomous_content_qa_invalid");
    this.name = "GovernedAutonomousContentQaError";
    this.code =
      unique[0] || "governed_autonomous_content_qa_invalid";
    this.codes = unique;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isSha256(value) {
  return SHA256_PATTERN.test(lower(value));
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

function sameValue(left, right) {
  return (
    JSON.stringify(stableValue(left)) ===
    JSON.stringify(stableValue(right))
  );
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function samePath(left, right) {
  if (!text(left) || !text(right)) return false;
  const resolvedLeft = path.resolve(text(left));
  const resolvedRight = path.resolve(text(right));
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function exactIsoTimestamp(value) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  return (
    raw &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === raw
  );
}

function addEqual(blockers, actual, expected, code) {
  if (actual !== expected) blockers.push(code);
}

function parseObject(value, code, blockers) {
  if (plainObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) {
    blockers.push(code);
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!plainObject(parsed)) {
      blockers.push(code);
      return null;
    }
    return parsed;
  } catch {
    blockers.push(code);
    return null;
  }
}

function parseScheduledEvidence(scheduledDispatch, blockers) {
  if (plainObject(scheduledDispatch?.evidence)) {
    return scheduledDispatch.evidence;
  }
  if (scheduledDispatch?.event) {
    return parseObject(
      scheduledDispatch.event.evidence_json ??
        scheduledDispatch.event.evidence,
      "governed_autonomous_scheduled_evidence_invalid",
      blockers,
    );
  }
  blockers.push("governed_autonomous_scheduled_evidence_required");
  return null;
}

function parseStoryProjection(story, blockers) {
  const direct = plainObject(
    story?.autonomous_publication_approval,
  )
    ? story.autonomous_publication_approval
    : null;
  let extraProjection = null;
  if (story?._extra !== undefined && story?._extra !== null) {
    const extra = parseObject(
      story._extra,
      "governed_autonomous_story_projection_invalid",
      blockers,
    );
    if (extra) {
      extraProjection = plainObject(
        extra.autonomous_publication_approval,
      )
        ? extra.autonomous_publication_approval
        : null;
    }
  }
  if (
    direct &&
    extraProjection &&
    !sameValue(direct, extraProjection)
  ) {
    blockers.push(
      "governed_autonomous_story_projection_conflict",
    );
  }
  const projection = direct || extraProjection;
  if (!projection) {
    blockers.push(
      "governed_autonomous_story_projection_required",
    );
  }
  return projection;
}

function validateVisualGate(value, blockers, surface) {
  const code = `governed_autonomous_${surface}_visual_gate_invalid`;
  if (!plainObject(value)) {
    blockers.push(code);
    return null;
  }
  const actual = Object.keys(value).sort();
  const expected = [...VISUAL_GATE_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    blockers.push(code);
    return null;
  }
  const minimum = Number(value.minimum_distinct_vision_models);
  const distinct = Number(value.distinct_model_count);
  if (
    !isSha256(value.decision_file_sha256) ||
    !isSha256(value.decision_self_sha256) ||
    value.decision_authority !== DECISION_AUTHORITY ||
    value.authority_scope !== AUTHORITY_TYPE ||
    value.policy_id !== "pulse-visual-review-policy" ||
    value.policy_version !== "2" ||
    value.gate !== "AUTONOMOUS_OFFICIAL_UNANIMOUS" ||
    value.required_report_schema !==
      "pulse-local-multimodal-visual-review-v1" ||
    value.required_aggregation !== "UNANIMOUS_PASS" ||
    !Number.isInteger(minimum) ||
    minimum !== 2 ||
    !Number.isInteger(distinct) ||
    distinct < minimum ||
    value.human_approval !== false ||
    value.models_treated_as_humans !== false ||
    value.publish_authority !== false ||
    value.scheduler_authority !== false ||
    value.database_authority !== false ||
    value.oauth_or_token_authority !== false ||
    value.platform_contacted !== false ||
    value.network_used !== false
  ) {
    blockers.push(code);
    return null;
  }
  return value;
}

function validateReleaseBoundary(value, blockers, surface) {
  const code =
    `governed_autonomous_${surface}_release_boundary_invalid`;
  if (!plainObject(value)) {
    blockers.push(code);
    return null;
  }
  const actual = Object.keys(value).sort();
  const expected = [...RELEASE_BOUNDARY_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index]) ||
    value.boundary !== "T_MINUS_15" ||
    value.official_source_revalidation_required !== true ||
    value.kill_switch_revalidation_required !== true ||
    value.single_owner_revalidation_required !== true ||
    value.exact_binding_revalidation_required !== true ||
    !Number.isInteger(value.max_control_age_ms) ||
    value.max_control_age_ms <= 0 ||
    value.disarm_on_failure !== true
  ) {
    blockers.push(code);
    return null;
  }
  return value;
}

function projectionFromStory(story) {
  if (plainObject(story?.autonomous_publication_approval)) {
    return story.autonomous_publication_approval;
  }
  try {
    const extra = plainObject(story?._extra)
      ? story._extra
      : JSON.parse(text(story?._extra) || "{}");
    return plainObject(extra?.autonomous_publication_approval)
      ? extra.autonomous_publication_approval
      : null;
  } catch {
    return null;
  }
}

function hasGovernedAutonomousContentQaEvidence(
  story,
  scheduledDispatch,
) {
  const projection = projectionFromStory(story);
  const evidence = plainObject(scheduledDispatch?.evidence)
    ? scheduledDispatch.evidence
    : (() => {
        try {
          const raw =
            scheduledDispatch?.event?.evidence_json ??
            scheduledDispatch?.event?.evidence;
          const parsed =
            typeof raw === "string" ? JSON.parse(raw) : raw;
          return plainObject(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })();
  return Boolean(
    projection ||
      evidence?.autonomous_authority_type ||
      evidence?.publication_authority_audit_id ||
      evidence?.autonomous_visual_gate,
  );
}

async function resolveGovernedAutonomousContentQaAuthority({
  story,
  scheduledDispatch,
  exactDispatchBinding,
  publicationGovernance,
  resolveMediaPath = mediaPaths.resolveExisting,
} = {}) {
  const blockers = [];
  if (!plainObject(story)) {
    throw new GovernedAutonomousContentQaError(
      "governed_autonomous_story_required",
    );
  }
  if (
    !plainObject(scheduledDispatch) ||
    !plainObject(exactDispatchBinding)
  ) {
    blockers.push(
      "governed_autonomous_exact_scheduled_authority_required",
    );
  }
  if (
    !publicationGovernance ||
    typeof publicationGovernance.getPublicationAuthorityDecision !==
      "function"
  ) {
    blockers.push(
      "governed_autonomous_publication_authority_repository_required",
    );
  }
  if (typeof resolveMediaPath !== "function") {
    blockers.push(
      "governed_autonomous_media_path_resolver_required",
    );
  }

  const storyId = text(story.id);
  const channelId = text(story.channel_id || CHANNEL_ID);
  const storyLaneId = text(story.lane_id || LANE_ID);
  if (
    !storyId ||
    channelId !== CHANNEL_ID ||
    storyLaneId !== LANE_ID
  ) {
    blockers.push("governed_autonomous_story_scope_invalid");
  }
  if (
    story.approved !== true &&
    story.approved !== 1
  ) {
    blockers.push(
      "governed_autonomous_editorial_approval_projection_required",
    );
  }
  if (
    story.auto_approved !== true &&
    story.auto_approved !== 1
  ) {
    blockers.push(
      "governed_autonomous_auto_approval_projection_required",
    );
  }

  const projection = parseStoryProjection(story, blockers);
  const scheduledEvidence = parseScheduledEvidence(
    scheduledDispatch,
    blockers,
  );
  const event = scheduledDispatch?.event;
  const scheduledVisualGate = scheduledEvidence
    ? validateVisualGate(
        scheduledEvidence.autonomous_visual_gate,
        blockers,
        "scheduled",
      )
    : null;
  const scheduledPublicationEvidence = plainObject(
    scheduledEvidence?.publication_evidence,
  )
    ? scheduledEvidence.publication_evidence
    : null;
  if (!scheduledPublicationEvidence) {
    blockers.push(
      "governed_autonomous_scheduled_publication_evidence_required",
    );
  }
  if (
    scheduledPublicationEvidence &&
    !sameValue(
      scheduledPublicationEvidence,
      scheduledDispatch?.publicationEvidence,
    )
  ) {
    blockers.push(
      "governed_autonomous_scheduled_publication_evidence_mismatch",
    );
  }
  const projectionVisualGate = projection
    ? validateVisualGate(
        projection.autonomous_visual_gate,
        blockers,
        "story_projection",
      )
    : null;
  const scheduledReleaseBoundary = scheduledEvidence
    ? validateReleaseBoundary(
        scheduledEvidence.required_release_boundary,
        blockers,
        "scheduled",
      )
    : null;

  const scheduledFor = text(
    scheduledDispatch?.scheduledFor ||
      scheduledEvidence?.scheduled_for,
  );
  const eventId = Number(event?.id);
  const authorityAuditId = Number(
    scheduledEvidence?.publication_authority_audit_id,
  );
  const dispatchIdempotencyKey = text(
    scheduledDispatch?.idempotencyKey ||
      scheduledEvidence?.dispatch_idempotency_key,
  );
  const requestFingerprint = lower(
    scheduledDispatch?.requestFingerprint ||
      scheduledEvidence?.request_fingerprint,
  );
  const runwayLockSha256 = lower(
    scheduledEvidence?.runway_lock_sha256,
  );
  const authorityBindingSha256 = lower(
    scheduledEvidence?.autonomous_authority_binding_sha256,
  );
  const visualDecisionSha256 = lower(
    scheduledEvidence?.autonomous_visual_gate_decision_sha256,
  );
  const scheduledMediaSha256 = lower(
    scheduledEvidence?.media_sha256,
  );
  const scheduledQaSha256 = lower(
    scheduledEvidence?.qa_report_sha256,
  );

  if (
    !exactIsoTimestamp(scheduledFor) ||
    !Number.isInteger(eventId) ||
    eventId <= 0 ||
    !Number.isInteger(authorityAuditId) ||
    authorityAuditId <= 0 ||
    !dispatchIdempotencyKey ||
    !isSha256(requestFingerprint) ||
    !isSha256(runwayLockSha256) ||
    !isSha256(authorityBindingSha256) ||
    !isSha256(visualDecisionSha256) ||
    !isSha256(scheduledMediaSha256) ||
    !isSha256(scheduledQaSha256)
  ) {
    blockers.push(
      "governed_autonomous_scheduled_binding_invalid",
    );
  }
  if (
    scheduledEvidence?.autonomous_authority_type !==
      AUTHORITY_TYPE
  ) {
    blockers.push(
      "governed_autonomous_authority_type_required",
    );
  }

  for (const [actual, expected, code] of [
    [
      text(event?.story_id),
      storyId,
      "governed_autonomous_scheduled_story_mismatch",
    ],
    [
      lower(event?.platform),
      PLATFORM,
      "governed_autonomous_scheduled_platform_mismatch",
    ],
    [
      text(scheduledEvidence?.story_id),
      storyId,
      "governed_autonomous_scheduled_evidence_story_mismatch",
    ],
    [
      lower(scheduledEvidence?.platform),
      PLATFORM,
      "governed_autonomous_scheduled_evidence_platform_mismatch",
    ],
    [
      text(scheduledEvidence?.channel_id),
      channelId,
      "governed_autonomous_scheduled_channel_mismatch",
    ],
    [
      text(scheduledEvidence?.lane_id),
      LANE_ID,
      "governed_autonomous_scheduled_lane_mismatch",
    ],
    [
      text(scheduledEvidence?.scheduled_for),
      scheduledFor,
      "governed_autonomous_scheduled_time_mismatch",
    ],
    [
      text(scheduledEvidence?.dispatch_idempotency_key),
      dispatchIdempotencyKey,
      "governed_autonomous_scheduled_dispatch_mismatch",
    ],
    [
      lower(scheduledEvidence?.request_fingerprint),
      requestFingerprint,
      "governed_autonomous_scheduled_request_mismatch",
    ],
    [
      text(exactDispatchBinding?.storyId),
      storyId,
      "governed_autonomous_exact_story_mismatch",
    ],
    [
      lower(exactDispatchBinding?.platform),
      PLATFORM,
      "governed_autonomous_exact_platform_mismatch",
    ],
    [
      text(exactDispatchBinding?.scheduledFor),
      scheduledFor,
      "governed_autonomous_exact_schedule_mismatch",
    ],
    [
      text(exactDispatchBinding?.scheduledEventId),
      text(eventId),
      "governed_autonomous_exact_event_mismatch",
    ],
    [
      text(exactDispatchBinding?.dispatchIdempotencyKey),
      dispatchIdempotencyKey,
      "governed_autonomous_exact_dispatch_mismatch",
    ],
    [
      lower(exactDispatchBinding?.requestFingerprint),
      requestFingerprint,
      "governed_autonomous_exact_request_mismatch",
    ],
  ]) {
    addEqual(blockers, actual, expected, code);
  }
  if (
    Object.hasOwn(exactDispatchBinding || {}, "channelId")
  ) {
    addEqual(
      blockers,
      text(exactDispatchBinding.channelId),
      channelId,
      "governed_autonomous_exact_channel_mismatch",
    );
  }
  if (Object.hasOwn(exactDispatchBinding || {}, "laneId")) {
    addEqual(
      blockers,
      text(exactDispatchBinding.laneId),
      LANE_ID,
      "governed_autonomous_exact_lane_mismatch",
    );
  }
  if (
    Object.hasOwn(
      exactDispatchBinding || {},
      "runwayLockSha256",
    )
  ) {
    addEqual(
      blockers,
      lower(exactDispatchBinding.runwayLockSha256),
      runwayLockSha256,
      "governed_autonomous_exact_runway_mismatch",
    );
  }
  if (
    dispatchIdempotencyKey !==
    `${PLATFORM}:${storyId}:${scheduledFor}`
  ) {
    blockers.push(
      "governed_autonomous_dispatch_identity_mismatch",
    );
  }

  let audit = null;
  if (
    Number.isInteger(authorityAuditId) &&
    authorityAuditId > 0 &&
    publicationGovernance &&
    typeof publicationGovernance.getPublicationAuthorityDecision ===
      "function"
  ) {
    try {
      audit = await publicationGovernance.getPublicationAuthorityDecision(
        authorityAuditId,
      );
    } catch {
      blockers.push(
        "governed_autonomous_publication_authority_read_failed",
      );
    }
    if (!plainObject(audit)) {
      blockers.push(
        "governed_autonomous_publication_authority_required",
      );
    }
  }

  let auditEvidence = null;
  let auditVisualGate = null;
  let auditReleaseBoundary = null;
  if (audit) {
    auditEvidence = parseObject(
      audit.evidence_json ?? audit.evidence,
      "governed_autonomous_publication_authority_evidence_invalid",
      blockers,
    );
    auditVisualGate = auditEvidence
      ? validateVisualGate(
          auditEvidence.autonomous_visual_gate,
          blockers,
          "audit",
        )
      : null;
    auditReleaseBoundary = auditEvidence
      ? validateReleaseBoundary(
          auditEvidence.required_release_boundary,
          blockers,
          "audit",
        )
      : null;
    for (const [actual, expected, code] of [
      [
        Number(audit.id),
        authorityAuditId,
        "governed_autonomous_authority_audit_id_mismatch",
      ],
      [
        text(audit.story_id),
        storyId,
        "governed_autonomous_authority_story_mismatch",
      ],
      [
        lower(audit.platform),
        PLATFORM,
        "governed_autonomous_authority_platform_mismatch",
      ],
      [
        text(audit.authority_type),
        AUTHORITY_TYPE,
        "governed_autonomous_authority_type_mismatch",
      ],
      [
        text(audit.decision),
        "APPROVED",
        "governed_autonomous_authority_decision_mismatch",
      ],
      [
        lower(audit.authority_binding_sha256),
        authorityBindingSha256,
        "governed_autonomous_authority_binding_mismatch",
      ],
      [
        text(audit.lifecycle_idempotency_key),
        `${dispatchIdempotencyKey}:lifecycle:AUTONOMOUSLY_APPROVED`,
        "governed_autonomous_authority_lifecycle_mismatch",
      ],
      [
        text(audit.idempotency_key),
        `${dispatchIdempotencyKey}:autonomous-authority`,
        "governed_autonomous_authority_idempotency_mismatch",
      ],
    ]) {
      addEqual(blockers, actual, expected, code);
    }
  }

  if (auditEvidence) {
    for (const [actual, expected, code] of [
      [
        auditEvidence.exact_candidate_bound,
        true,
        "governed_autonomous_audit_candidate_binding_required",
      ],
      [
        text(auditEvidence.authority_type),
        AUTHORITY_TYPE,
        "governed_autonomous_audit_authority_type_mismatch",
      ],
      [
        text(auditEvidence.authority_scope),
        AUTHORITY_SCOPE,
        "governed_autonomous_audit_authority_scope_mismatch",
      ],
      [
        lower(auditEvidence.authority_binding_sha256),
        authorityBindingSha256,
        "governed_autonomous_audit_binding_mismatch",
      ],
      [
        text(auditEvidence.story_id),
        storyId,
        "governed_autonomous_audit_story_mismatch",
      ],
      [
        text(auditEvidence.channel_id),
        channelId,
        "governed_autonomous_audit_channel_mismatch",
      ],
      [
        text(auditEvidence.lane_id),
        LANE_ID,
        "governed_autonomous_audit_lane_mismatch",
      ],
      [
        lower(auditEvidence.platform),
        PLATFORM,
        "governed_autonomous_audit_platform_mismatch",
      ],
      [
        text(auditEvidence.scheduled_for),
        scheduledFor,
        "governed_autonomous_audit_schedule_mismatch",
      ],
      [
        lower(auditEvidence.runway_lock_sha256),
        runwayLockSha256,
        "governed_autonomous_audit_runway_mismatch",
      ],
      [
        text(auditEvidence.dispatch_idempotency_key),
        dispatchIdempotencyKey,
        "governed_autonomous_audit_dispatch_mismatch",
      ],
      [
        lower(auditEvidence.request_fingerprint),
        requestFingerprint,
        "governed_autonomous_audit_request_mismatch",
      ],
      [
        lower(
          auditEvidence.autonomous_visual_gate_decision_sha256,
        ),
        visualDecisionSha256,
        "governed_autonomous_audit_visual_decision_mismatch",
      ],
      [
        lower(auditEvidence.media_sha256),
        scheduledMediaSha256,
        "governed_autonomous_audit_media_mismatch",
      ],
      [
        lower(auditEvidence.qa_report_sha256),
        scheduledQaSha256,
        "governed_autonomous_audit_qa_mismatch",
      ],
      [
        lower(auditEvidence.publication_evidence_sha256),
        scheduledPublicationEvidence
          ? canonicalSha256(scheduledPublicationEvidence)
          : "",
        "governed_autonomous_audit_publication_evidence_mismatch",
      ],
      [
        auditEvidence.operational_publish_authority,
        false,
        "governed_autonomous_audit_operational_authority_forbidden",
      ],
      [
        auditEvidence.dispatch_authorised,
        false,
        "governed_autonomous_audit_dispatch_authority_forbidden",
      ],
      [
        auditEvidence.external_publish_authorised,
        false,
        "governed_autonomous_audit_external_authority_forbidden",
      ],
    ]) {
      addEqual(blockers, actual, expected, code);
    }
    if (scheduledPublicationEvidence) {
      for (const [auditField, evidenceField, code] of [
        [
          "source_evidence_sha256",
          "source_evidence_sha256",
          "governed_autonomous_audit_source_evidence_mismatch",
        ],
        [
          "rights_ledger_sha256",
          "rights_ledger_sha256",
          "governed_autonomous_audit_rights_evidence_mismatch",
        ],
        [
          "qa_report_sha256",
          "qa_report_sha256",
          "governed_autonomous_audit_qa_evidence_mismatch",
        ],
        [
          "publication_metadata_sha256",
          "publication_metadata_sha256",
          "governed_autonomous_audit_metadata_evidence_mismatch",
        ],
        [
          "renderer_manifest_sha256",
          "renderer_manifest_sha256",
          "governed_autonomous_audit_renderer_evidence_mismatch",
        ],
      ]) {
        addEqual(
          blockers,
          lower(auditEvidence[auditField]),
          lower(scheduledPublicationEvidence[evidenceField]),
          code,
        );
      }
    }
    const issuedAtMs = Date.parse(auditEvidence.issued_at);
    const validUntilMs = Date.parse(auditEvidence.valid_until);
    const scheduledAtMs = Date.parse(scheduledFor);
    if (
      !exactIsoTimestamp(auditEvidence.issued_at) ||
      !exactIsoTimestamp(auditEvidence.valid_until) ||
      issuedAtMs > validUntilMs ||
      validUntilMs > scheduledAtMs
    ) {
      blockers.push(
        "governed_autonomous_audit_authority_window_invalid",
      );
    }
  }

  if (projection) {
    for (const [actual, expected, code] of [
      [
        text(projection.approval_type),
        AUTHORITY_TYPE,
        "governed_autonomous_projection_type_mismatch",
      ],
      [
        text(projection.authority_id),
        text(auditEvidence?.authority_id),
        "governed_autonomous_projection_authority_id_mismatch",
      ],
      [
        lower(projection.authority_sha256),
        authorityBindingSha256,
        "governed_autonomous_projection_authority_hash_mismatch",
      ],
      [
        text(projection.approved_at),
        text(auditEvidence?.issued_at),
        "governed_autonomous_projection_time_mismatch",
      ],
      [
        lower(
          projection.autonomous_visual_gate_decision_sha256,
        ),
        visualDecisionSha256,
        "governed_autonomous_projection_visual_decision_mismatch",
      ],
      [
        lower(projection.media_sha256),
        scheduledMediaSha256,
        "governed_autonomous_projection_media_mismatch",
      ],
      [
        lower(projection.qa_report_sha256),
        scheduledQaSha256,
        "governed_autonomous_projection_qa_mismatch",
      ],
    ]) {
      addEqual(blockers, actual, expected, code);
    }
    if (
      !AUTHORITY_ID_PATTERN.test(text(projection.authority_id)) ||
      !exactIsoTimestamp(projection.approved_at)
    ) {
      blockers.push(
        "governed_autonomous_projection_identity_invalid",
      );
    }
  }

  if (
    scheduledVisualGate &&
    lower(scheduledVisualGate.decision_file_sha256) !==
      visualDecisionSha256
  ) {
    blockers.push(
      "governed_autonomous_scheduled_visual_decision_hash_mismatch",
    );
  }
  if (
    projectionVisualGate &&
    lower(projectionVisualGate.decision_file_sha256) !==
      visualDecisionSha256
  ) {
    blockers.push(
      "governed_autonomous_projection_visual_decision_hash_mismatch",
    );
  }
  if (
    auditVisualGate &&
    lower(auditVisualGate.decision_file_sha256) !==
      visualDecisionSha256
  ) {
    blockers.push(
      "governed_autonomous_audit_visual_decision_hash_mismatch",
    );
  }
  if (
    scheduledVisualGate &&
    projectionVisualGate &&
    !sameValue(scheduledVisualGate, projectionVisualGate)
  ) {
    blockers.push(
      "governed_autonomous_visual_gate_projection_mismatch",
    );
  }
  if (
    scheduledVisualGate &&
    auditVisualGate &&
    !sameValue(scheduledVisualGate, auditVisualGate)
  ) {
    blockers.push(
      "governed_autonomous_visual_gate_audit_mismatch",
    );
  }
  if (
    scheduledReleaseBoundary &&
    auditReleaseBoundary &&
    !sameValue(
      scheduledReleaseBoundary,
      auditReleaseBoundary,
    )
  ) {
    blockers.push(
      "governed_autonomous_release_boundary_audit_mismatch",
    );
  }

  let resolvedMediaPath = null;
  let currentMediaSha256 = null;
  if (typeof resolveMediaPath === "function") {
    try {
      resolvedMediaPath = await resolveMediaPath(
        story.exported_path,
      );
      if (
        !resolvedMediaPath ||
        (path.isAbsolute(text(story.exported_path)) &&
          !samePath(resolvedMediaPath, story.exported_path))
      ) {
        blockers.push(
          "governed_autonomous_current_media_path_mismatch",
        );
      } else {
        currentMediaSha256 = lower(
          await sha256File(resolvedMediaPath),
        );
      }
    } catch {
      blockers.push(
        "governed_autonomous_current_media_hash_unavailable",
      );
    }
  }
  if (
    !isSha256(currentMediaSha256) ||
    currentMediaSha256 !== scheduledMediaSha256
  ) {
    blockers.push(
      "governed_autonomous_current_media_hash_mismatch",
    );
  }

  if (blockers.length) {
    throw new GovernedAutonomousContentQaError(blockers);
  }

  const authority = Object.freeze({
    authorityType: AUTHORITY_TYPE,
    authorityScope: AUTHORITY_SCOPE,
    decisionAuthority: DECISION_AUTHORITY,
    storyId,
    channelId,
    laneId: LANE_ID,
    platform: PLATFORM,
    scheduledFor,
    scheduledEventId: eventId,
    dispatchIdempotencyKey,
    requestFingerprint,
    runwayLockSha256,
    authorityAuditId,
    authorityBindingSha256,
    visualDecisionSha256,
    visualDecisionSelfSha256:
      scheduledVisualGate.decision_self_sha256,
    qaReportSha256: scheduledQaSha256,
    mediaSha256: currentMediaSha256,
    resolvedMediaPath,
    controls: Object.freeze({
      humanApproval: false,
      modelsTreatedAsHumans: false,
      publishAuthority: false,
      schedulerAuthority: false,
      databaseAuthority: false,
      oauthOrTokenAuthority: false,
      platformContacted: false,
      networkUsed: false,
    }),
  });
  VALIDATED_AUTHORITIES.add(authority);
  return authority;
}

function reconcileGovernedAutonomousContentQa(
  result,
  authority,
) {
  if (!VALIDATED_AUTHORITIES.has(authority)) {
    throw new GovernedAutonomousContentQaError(
      "governed_autonomous_content_qa_authority_required",
    );
  }
  const originalResult = lower(result?.result);
  const failures = Array.isArray(result?.failures)
    ? result.failures.slice()
    : [];
  const warnings = Array.isArray(result?.warnings)
    ? result.warnings.slice()
    : [];
  const retained = [];
  const resolved = [];

  if (originalResult === "fail" && failures.length === 0) {
    retained.push("content_qa_unclassified_failure");
  } else if (
    !["pass", "warn", "fail"].includes(originalResult)
  ) {
    retained.push("content_qa_result_invalid");
  }
  for (const failure of failures) {
    if (failure === VISUAL_GATE_FAILURE) {
      resolved.push(failure);
    } else {
      retained.push(failure);
    }
  }
  warnings.push(
    ...resolved.map(
      (failure) =>
        `governed_autonomous_visual_policy_resolved:${failure}`,
    ),
  );
  return {
    result: retained.length
      ? "fail"
      : warnings.length || originalResult === "warn"
        ? "warn"
        : "pass",
    failures: retained,
    warnings: [...new Set(warnings)],
    resolved,
  };
}

module.exports = {
  AUTHORITY_SCOPE,
  AUTHORITY_TYPE,
  DECISION_AUTHORITY,
  GovernedAutonomousContentQaError,
  VISUAL_GATE_FAILURE,
  hasGovernedAutonomousContentQaEvidence,
  reconcileGovernedAutonomousContentQa,
  resolveGovernedAutonomousContentQaAuthority,
};
