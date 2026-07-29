"use strict";

const {
  assertTransition,
  knownState,
} = require("../stabilisation/publication-lifecycle");
const {
  resolveYoutubeScheduledPublishAt,
} = require("../services/youtube-scheduled-release-contract");
const {
  validateOfficialSourceReleaseBinding,
  validateOfficialSourceRevalidationReceipt,
} = require("../services/official-source-revalidation");

const PRE_DISPATCH_STATES = Object.freeze([
  "DISCOVERED",
  "VERIFIED",
  "EDITORIALLY_APPROVED",
  "SCRIPT_READY",
  "ASSETS_CLEARED",
  "RENDERED",
  "QA_PASSED",
  "HUMAN_APPROVED",
  "AUTONOMOUSLY_APPROVED",
  "SCHEDULED",
  "DISPATCH_STARTED",
]);
const DIRECT_LIFECYCLE_STATES = new Set(
  PRE_DISPATCH_STATES.filter((state) => state !== "DISPATCH_STARTED"),
);
const MAX_PLATFORM_VERIFICATION_AGE_MS = 60 * 60 * 1000;
const MAX_CONTROL_TOWER_EVIDENCE_AGE_MS = 15 * 60 * 1000;
const MAX_T15_RELEASE_PROOF_AGE_MS = 15 * 60 * 1000;
const MAX_SCHEDULE_DISPATCH_DRIFT_MS = 15 * 60 * 1000;
const DEFAULT_STALE_DISPATCH_AGE_MS = 15 * 60 * 1000;
const REQUIRED_LIFECYCLE_EVIDENCE = Object.freeze({
  VERIFIED: "source_verified",
  EDITORIALLY_APPROVED: "editorial_approved",
  SCRIPT_READY: "script_ready",
  ASSETS_CLEARED: "rights_cleared",
  RENDERED: "rendered_artifact_verified",
  QA_PASSED: "qa_passed",
  HUMAN_APPROVED: "human_review_complete",
  AUTONOMOUSLY_APPROVED: "autonomous_authority_complete",
  SCHEDULED: "schedule_verified",
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function json(value) {
  return value === null || value === undefined
    ? null
    : JSON.stringify(stableValue(value));
}

function cleanError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 1000);
}

function requireText(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function assertIdempotentMatch(existing, expected, fields) {
  const conflict = fields.some(
    ([existingField, expectedField]) =>
      String(existing[existingField] ?? "") !==
      String(expected[expectedField] ?? ""),
  );
  if (conflict) throw new Error("publication_idempotency_conflict");
  return existing;
}

function verifiedTimestamp(
  value,
  {
    now = new Date(),
    maxAgeMs = MAX_PLATFORM_VERIFICATION_AGE_MS,
  } = {},
) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error("valid_platform_verification_time_required");
  }
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error("valid_platform_verification_time_required");
  }
  if (date.getTime() > effectiveNow.getTime()) {
    throw new Error("platform_verification_time_in_future");
  }
  if (
    Number.isFinite(maxAgeMs) &&
    effectiveNow.getTime() - date.getTime() > maxAgeMs
  ) {
    throw new Error("platform_verification_stale");
  }
  return date.toISOString();
}

function evidenceExternalId(evidence) {
  return String(evidence?.external_id || "").trim();
}

function meaningfulVerificationEvidence(evidence) {
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return false;
  }
  return (
    evidence.uploader_response_verified === true ||
    evidence.platform_object_confirmed === true ||
    evidence.public === true ||
    String(evidence.visibility || "").trim().toLowerCase() === "public" ||
    String(evidence.privacy_status || "").trim().toLowerCase() === "public"
  );
}

function publicPlatformEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (
    evidence.public === true ||
    String(evidence.visibility || "").trim().toLowerCase() === "public" ||
    String(evidence.privacy_status || "").trim().toLowerCase() === "public"
  );
}

function sha256(value, code) {
  const normalised = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalised)) throw new Error(code);
  return normalised;
}

function youtubePrivateScheduleEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (
    evidence.platform_object_confirmed === true &&
    evidence.scheduled_release_confirmed === true &&
    String(evidence.privacy_status || "").trim().toLowerCase() ===
      "private" &&
    String(evidence.upload_status || "").trim().toLowerCase() ===
      "processed" &&
    String(evidence.processing_status || "").trim().toLowerCase() ===
      "succeeded"
  );
}

function youtubePrivateUnscheduledEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (
    evidence.platform_object_confirmed === true &&
    evidence.scheduled_release_confirmed === false &&
    String(evidence.privacy_status || "").trim().toLowerCase() ===
      "private" &&
    evidence.publish_at === null &&
    String(evidence.upload_status || "").trim().toLowerCase() ===
      "processed" &&
    String(evidence.processing_status || "").trim().toLowerCase() ===
      "succeeded"
  );
}

function youtubePublicProcessedEvidence(evidence) {
  return (
    publicPlatformEvidence(evidence) &&
    String(evidence?.upload_status || "").trim().toLowerCase() ===
      "processed"
  );
}

function parseEvidence(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function validEvidenceTimestamp(value, code) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed;
}

function assertScheduledEvidenceShape(evidence) {
  if (
    String(evidence?.control_tower_verdict || "")
      .trim()
      .toUpperCase() !== "GREEN"
  ) {
    throw new Error("scheduled_green_control_tower_required");
  }
  validEvidenceTimestamp(
    evidence?.control_tower_checked_at,
    "scheduled_control_tower_time_required",
  );
  validEvidenceTimestamp(
    evidence?.scheduled_for,
    "scheduled_dispatch_time_required",
  );
  if (evidence?.kill_switch_healthy !== true) {
    throw new Error("scheduled_healthy_kill_switch_required");
  }
  if (evidence?.operating_contract_valid !== true) {
    throw new Error("scheduled_valid_operating_contract_required");
  }
  if (!String(evidence?.dispatch_idempotency_key || "").trim()) {
    throw new Error("scheduled_dispatch_identity_required");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(evidence?.request_fingerprint || ""))) {
    throw new Error("scheduled_request_fingerprint_required");
  }
}

function assertFreshScheduledEvidence(
  evidence,
  {
    now = new Date(),
    maxControlTowerAgeMs = MAX_CONTROL_TOWER_EVIDENCE_AGE_MS,
    maxScheduleDriftMs = MAX_SCHEDULE_DISPATCH_DRIFT_MS,
  } = {},
) {
  assertScheduledEvidenceShape(evidence);
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error("scheduled_dispatch_time_invalid");
  }
  const controlTowerCheckedAt = new Date(evidence.control_tower_checked_at);
  const controlTowerAgeMs =
    effectiveNow.getTime() - controlTowerCheckedAt.getTime();
  if (controlTowerAgeMs < 0) {
    throw new Error("scheduled_control_tower_evidence_in_future");
  }
  if (controlTowerAgeMs > maxControlTowerAgeMs) {
    throw new Error("scheduled_control_tower_evidence_stale");
  }
  const scheduledFor = new Date(evidence.scheduled_for);
  if (
    Math.abs(effectiveNow.getTime() - scheduledFor.getTime()) >
    maxScheduleDriftMs
  ) {
    throw new Error("dispatch_outside_verified_schedule_window");
  }
  return true;
}

function operationIdentity(input) {
  return {
    storyId: requireText(input.storyId, "publication_story_id_required"),
    platform: requireText(input.platform, "publication_platform_required"),
    channelId: requireText(input.channelId, "publication_channel_id_required"),
    idempotencyKey: requireText(
      input.idempotencyKey,
      "publication_operation_idempotency_key_required",
    ),
  };
}

function bind(db) {
  const getStateStatement = db.prepare(`
    SELECT *
    FROM platform_publication_state
    WHERE story_id = ? AND platform = ?
  `);
  const getLifecycleByIdempotency = db.prepare(`
    SELECT *
    FROM publication_lifecycle_events
    WHERE idempotency_key = ?
  `);
  const getLatestScheduledLifecycle = db.prepare(`
    SELECT *
    FROM publication_lifecycle_events
    WHERE story_id = ? AND platform = ? AND to_state = 'SCHEDULED'
    ORDER BY id DESC
    LIMIT 1
  `);
  const getLatestLifecycle = db.prepare(`
    SELECT *
    FROM publication_lifecycle_events
    WHERE story_id = ?
      AND platform = ?
      AND (? IS NULL OR to_state = ?)
    ORDER BY id DESC
    LIMIT 1
  `);
  const insertLifecycle = db.prepare(`
    INSERT INTO publication_lifecycle_events
      (story_id, platform, from_state, to_state, event_reason,
       retryability_class, actor_type, actor_id, evidence_json,
       idempotency_key, publication_authority_audit_id)
    VALUES
      (@storyId, @platform, @fromState, @toState, @eventReason,
       @retryabilityClass, @actorType, @actorId, @evidenceJson,
       @idempotencyKey, @publicationAuthorityAuditId)
  `);
  const insertLedger = db.prepare(`
    INSERT INTO platform_dispatch_ledger
      (story_id, channel_id, platform, idempotency_key, event_type,
       external_id, external_url, request_fingerprint,
       retryability_class, verification_status,
       verification_evidence_json, operator_decision_id)
    VALUES
      (@storyId, @channelId, @platform, @idempotencyKey, @eventType,
       @externalId, @externalUrl, @requestFingerprint,
       @retryabilityClass, @verificationStatus,
       @verificationEvidenceJson, @operatorDecisionId)
  `);
  const getLedgerByIdempotency = db.prepare(`
    SELECT *
    FROM platform_dispatch_ledger
    WHERE platform = ? AND idempotency_key = ?
  `);
  const upsertState = db.prepare(`
    INSERT INTO platform_publication_state
      (story_id, platform, lifecycle_state, external_id, external_url,
       verification_status, verified_at, last_event_id, updated_at)
    VALUES
      (@storyId, @platform, @lifecycleState, @externalId, @externalUrl,
       @verificationStatus, @verifiedAt, @lastEventId, datetime('now'))
    ON CONFLICT(story_id, platform) DO UPDATE SET
      lifecycle_state = excluded.lifecycle_state,
      external_id = COALESCE(
        excluded.external_id,
        platform_publication_state.external_id
      ),
      external_url = COALESCE(
        excluded.external_url,
        platform_publication_state.external_url
      ),
      verification_status = COALESCE(
        excluded.verification_status,
        platform_publication_state.verification_status
      ),
      verified_at = COALESCE(
        excluded.verified_at,
        platform_publication_state.verified_at
      ),
      last_event_id = COALESCE(
        excluded.last_event_id,
        platform_publication_state.last_event_id
      ),
      updated_at = datetime('now')
  `);
  const insertAudit = db.prepare(`
    INSERT INTO operator_audit_log
      (actor_id, action, target_type, target_id, decision, reason,
       evidence_json, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAuditByIdempotency = db.prepare(`
    SELECT * FROM operator_audit_log WHERE idempotency_key = ?
  `);
  const getAuditById = db.prepare(`
    SELECT * FROM operator_audit_log WHERE id = ?
  `);
  const insertPublicationAuthorityAudit = db.prepare(`
    INSERT INTO publication_authority_audit_log
      (story_id, platform, authority_type, decision, reason,
       evidence_json, authority_binding_sha256,
       lifecycle_idempotency_key, idempotency_key)
    VALUES (?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?)
  `);
  const getPublicationAuthorityById = db.prepare(`
    SELECT * FROM publication_authority_audit_log WHERE id = ?
  `);
  const getPublicationAuthorityByIdempotency = db.prepare(`
    SELECT *
    FROM publication_authority_audit_log
    WHERE idempotency_key = ?
  `);
  const getPublicationAuthorityByBinding = db.prepare(`
    SELECT *
    FROM publication_authority_audit_log
    WHERE authority_binding_sha256 = ?
  `);
  const getPublicationAuthorityByLifecycleKey = db.prepare(`
    SELECT *
    FROM publication_authority_audit_log
    WHERE lifecycle_idempotency_key = ?
  `);

  function getState(storyId, platform) {
    return getStateStatement.get(storyId, platform) || null;
  }

  function resolvePrivateScheduledTicket({
    storyId,
    platform,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
    requireFuture = true,
  }) {
    if (String(platform || "").trim() !== "youtube") {
      throw new Error("private_prestage_youtube_only");
    }
    const scheduledEvent = getLatestScheduledLifecycle.get(
      storyId,
      platform,
    );
    if (!scheduledEvent) {
      throw new Error("private_prestage_scheduled_event_required");
    }
    const evidence = parseEvidence(scheduledEvent.evidence_json);
    assertScheduledEvidenceShape(evidence);
    const requestedSchedule = resolveYoutubeScheduledPublishAt(
      scheduledFor,
      { now, requireFuture },
    );
    const ticketSchedule = resolveYoutubeScheduledPublishAt(
      evidence.scheduled_for,
      { now, requireFuture },
    );
    if (requestedSchedule !== ticketSchedule) {
      throw new Error("private_prestage_scheduled_time_mismatch");
    }
    if (
      String(evidence.dispatch_idempotency_key || "").trim() !==
      String(idempotencyKey || "").trim()
    ) {
      throw new Error("private_prestage_dispatch_identity_mismatch");
    }
    const requestedFingerprint = sha256(
      requestFingerprint,
      "private_prestage_request_fingerprint_required",
    );
    const ticketFingerprint = sha256(
      evidence.request_fingerprint,
      "private_prestage_ticket_request_fingerprint_required",
    );
    if (requestedFingerprint !== ticketFingerprint) {
      throw new Error("private_prestage_request_fingerprint_mismatch");
    }
    const requestedRunwayHash = sha256(
      runwayLockSha256,
      "private_prestage_runway_lock_sha256_required",
    );
    const ticketRunwayHash = sha256(
      evidence.runway_lock_sha256,
      "private_prestage_ticket_runway_lock_sha256_required",
    );
    if (requestedRunwayHash !== ticketRunwayHash) {
      throw new Error("private_prestage_runway_lock_sha256_mismatch");
    }
    return {
      scheduledEventId: Number(scheduledEvent.id),
      scheduledFor: ticketSchedule,
      requestFingerprint: ticketFingerprint,
      runwayLockSha256: ticketRunwayHash,
      evidence,
    };
  }

  function assertPlatformScheduledBinding({
    storyId,
    platform,
    externalId,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "publication_story_id_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "publication_platform_required",
    );
    const normalisedExternalId = requireText(
      externalId,
      "external_platform_id_required",
    );
    const ticket = resolvePrivateScheduledTicket({
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      idempotencyKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now,
      requireFuture: false,
    });
    const event = getLatestLifecycle.get(
      normalisedStoryId,
      normalisedPlatform,
      "PLATFORM_SCHEDULED",
      "PLATFORM_SCHEDULED",
    );
    if (!event) {
      throw new Error("platform_scheduled_lifecycle_event_required");
    }
    const evidence = parseEvidence(event.evidence_json);
    const state = getState(normalisedStoryId, normalisedPlatform);
    let persistedPublishAt = null;
    try {
      persistedPublishAt = evidence.publish_at
        ? new Date(evidence.publish_at).toISOString()
        : null;
    } catch {
      persistedPublishAt = null;
    }
    if (!youtubePrivateScheduleEvidence(evidence)) {
      throw new Error(
        "platform_scheduled_private_processed_proof_required",
      );
    }
    if (persistedPublishAt !== ticket.scheduledFor) {
      throw new Error("platform_scheduled_publish_at_mismatch");
    }
    for (const [actual, expected, code] of [
      [
        String(state?.external_id || "").trim(),
        normalisedExternalId,
        "platform_scheduled_state_external_id_mismatch",
      ],
      [
        String(evidence.story_id || "").trim(),
        normalisedStoryId,
        "platform_scheduled_story_id_mismatch",
      ],
      [
        String(evidence.external_id || "").trim(),
        normalisedExternalId,
        "platform_scheduled_external_id_mismatch",
      ],
      [
        String(evidence.scheduled_for || "").trim(),
        ticket.scheduledFor,
        "platform_scheduled_time_mismatch",
      ],
      [
        String(evidence.request_fingerprint || "").trim().toLowerCase(),
        ticket.requestFingerprint,
        "platform_scheduled_request_fingerprint_mismatch",
      ],
      [
        String(evidence.runway_lock_sha256 || "").trim().toLowerCase(),
        ticket.runwayLockSha256,
        "platform_scheduled_runway_lock_sha256_mismatch",
      ],
    ]) {
      if (actual !== expected) throw new Error(code);
    }
    return {
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      scheduledFor: ticket.scheduledFor,
      publishAt: persistedPublishAt,
      requestFingerprint: ticket.requestFingerprint,
      runwayLockSha256: ticket.runwayLockSha256,
      scheduledEventId: ticket.scheduledEventId,
      platformScheduledEventId: Number(event.id),
      scheduledTicketEvidence: ticket.evidence,
      evidence,
      state,
    };
  }

  function assertPrivateUnscheduledPlatformObjectBinding({
    storyId,
    channelId,
    platform,
    externalId,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "publication_story_id_required",
    );
    const normalisedChannelId = requireText(
      channelId,
      "publication_channel_id_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "publication_platform_required",
    );
    const normalisedExternalId = requireText(
      externalId,
      "external_platform_id_required",
    );
    const normalisedKey = requireText(
      idempotencyKey,
      "publication_operation_idempotency_key_required",
    );
    const ticket = resolvePrivateScheduledTicket({
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      idempotencyKey: normalisedKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now,
      requireFuture: true,
    });
    const state = getState(
      normalisedStoryId,
      normalisedPlatform,
    );
    if (state?.lifecycle_state !== "PLATFORM_OBJECT_CREATED") {
      throw new Error(
        `private_unscheduled_proof_requires_created_object:${
          state?.lifecycle_state || "NONE"
        }`,
      );
    }
    if (
      String(state.external_id || "").trim() !==
      normalisedExternalId
    ) {
      throw new Error(
        "private_unscheduled_proof_state_external_id_mismatch",
      );
    }
    const ledgerKey =
      `${normalisedKey}:ledger:PRIVATE_UNSCHEDULED_VERIFIED`;
    const ledger = getLedgerByIdempotency.get(
      normalisedPlatform,
      ledgerKey,
    );
    if (
      !ledger ||
      ledger.story_id !== normalisedStoryId ||
      ledger.channel_id !== normalisedChannelId ||
      ledger.platform !== normalisedPlatform ||
      ledger.event_type !== "PRIVATE_UNSCHEDULED_VERIFIED" ||
      String(ledger.request_fingerprint || "")
        .trim()
        .toLowerCase() !== ticket.requestFingerprint
    ) {
      if (
        ledger &&
        ledger.channel_id !== normalisedChannelId
      ) {
        throw new Error(
          "private_unscheduled_proof_channel_mismatch",
        );
      }
      throw new Error(
        "private_unscheduled_verified_proof_required",
      );
    }
    const evidence = parseEvidence(
      ledger.verification_evidence_json,
    );
    if (
      !youtubePrivateUnscheduledEvidence(evidence) ||
      evidence.release_armed !== false
    ) {
      throw new Error(
        "private_unscheduled_processed_proof_required",
      );
    }
    for (const [actual, expected, code] of [
      [
        String(evidence.story_id || "").trim(),
        normalisedStoryId,
        "private_unscheduled_proof_story_id_mismatch",
      ],
      [
        String(evidence.external_id || "").trim(),
        normalisedExternalId,
        "private_unscheduled_proof_external_id_mismatch",
      ],
      [
        Number(evidence.scheduled_event_id),
        ticket.scheduledEventId,
        "private_unscheduled_proof_scheduled_event_mismatch",
      ],
      [
        String(evidence.intended_scheduled_for || "").trim(),
        ticket.scheduledFor,
        "private_unscheduled_proof_time_mismatch",
      ],
      [
        String(evidence.request_fingerprint || "")
          .trim()
          .toLowerCase(),
        ticket.requestFingerprint,
        "private_unscheduled_proof_request_fingerprint_mismatch",
      ],
      [
        String(evidence.runway_lock_sha256 || "")
          .trim()
          .toLowerCase(),
        ticket.runwayLockSha256,
        "private_unscheduled_proof_runway_lock_mismatch",
      ],
    ]) {
      if (actual !== expected) throw new Error(code);
    }
    const verifiedAt = validEvidenceTimestamp(
      evidence.verified_at,
      "private_unscheduled_proof_verified_at_required",
    );
    if (
      verifiedAt.getTime() >= Date.parse(ticket.scheduledFor)
    ) {
      throw new Error(
        "private_unscheduled_proof_verified_too_late",
      );
    }
    return {
      storyId: normalisedStoryId,
      channelId: normalisedChannelId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      scheduledFor: ticket.scheduledFor,
      requestFingerprint: ticket.requestFingerprint,
      runwayLockSha256: ticket.runwayLockSha256,
      scheduledEventId: ticket.scheduledEventId,
      privateUnscheduledEventId: Number(ledger.id),
      scheduledTicketEvidence: ticket.evidence,
      verifiedAt: verifiedAt.toISOString(),
      evidence,
      state,
    };
  }

  function getScheduledPlatformArmAttempt({
    storyId,
    channelId,
    platform,
    externalId,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
  }) {
    const identity = operationIdentity({
      storyId,
      channelId,
      platform,
      idempotencyKey,
    });
    const normalisedExternalId = requireText(
      externalId,
      "external_platform_id_required",
    );
    const ticket = resolvePrivateScheduledTicket({
      storyId: identity.storyId,
      platform: identity.platform,
      idempotencyKey: identity.idempotencyKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now,
      requireFuture: false,
    });
    const ledgerKey =
      `${identity.idempotencyKey}:ledger:SCHEDULE_ARM_UPDATE_STARTED`;
    const ledger = getLedgerByIdempotency.get(
      identity.platform,
      ledgerKey,
    );
    if (!ledger) return null;
    if (
      ledger.story_id !== identity.storyId ||
      ledger.channel_id !== identity.channelId ||
      ledger.platform !== identity.platform ||
      ledger.event_type !== "SCHEDULE_ARM_UPDATE_STARTED" ||
      String(ledger.request_fingerprint || "")
        .trim()
        .toLowerCase() !== ticket.requestFingerprint
    ) {
      throw new Error("youtube_schedule_arm_attempt_binding_mismatch");
    }
    const evidence = parseEvidence(
      ledger.verification_evidence_json,
    );
    if (
      evidence.schema_version !==
        "pulse-youtube-schedule-arm-attempt-v1" ||
      evidence.schedule_arm_update_started !== true ||
      evidence.remote_schedule_may_exist !== true
    ) {
      throw new Error("youtube_schedule_arm_attempt_evidence_invalid");
    }
    for (const [actual, expected] of [
      [String(evidence.story_id || "").trim(), identity.storyId],
      [
        String(evidence.channel_id || "").trim(),
        identity.channelId,
      ],
      [
        String(evidence.external_id || "").trim(),
        normalisedExternalId,
      ],
      [
        String(evidence.scheduled_for || "").trim(),
        ticket.scheduledFor,
      ],
      [
        String(evidence.request_fingerprint || "")
          .trim()
          .toLowerCase(),
        ticket.requestFingerprint,
      ],
      [
        String(evidence.runway_lock_sha256 || "")
          .trim()
          .toLowerCase(),
        ticket.runwayLockSha256,
      ],
      [
        Number(evidence.scheduled_event_id),
        ticket.scheduledEventId,
      ],
    ]) {
      if (actual !== expected) {
        throw new Error(
          "youtube_schedule_arm_attempt_evidence_binding_mismatch",
        );
      }
    }
    const startedAt = validEvidenceTimestamp(
      evidence.started_at,
      "youtube_schedule_arm_attempt_time_required",
    );
    const sourceRevalidation =
      assertExactOfficialSourceRevalidation({
        receipt: evidence.source_revalidation,
        binding: {
          scheduledFor: ticket.scheduledFor,
          requestFingerprint: ticket.requestFingerprint,
          runwayLockSha256: ticket.runwayLockSha256,
          scheduledTicketEvidence: ticket.evidence,
        },
        storyId: identity.storyId,
        platform: identity.platform,
        externalId: normalisedExternalId,
        boundaryTime: startedAt,
      });
    return {
      storyId: identity.storyId,
      channelId: identity.channelId,
      platform: identity.platform,
      externalId: normalisedExternalId,
      scheduledFor: ticket.scheduledFor,
      requestFingerprint: ticket.requestFingerprint,
      runwayLockSha256: ticket.runwayLockSha256,
      scheduledEventId: ticket.scheduledEventId,
      startedAt: startedAt.toISOString(),
      remoteScheduleMayExist: true,
      sourceRevalidation,
      evidence,
      ledger,
    };
  }

  function resolveScheduledPlatformDisarmBinding({
    storyId,
    platform,
    externalId,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "publication_story_id_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "publication_platform_required",
    );
    const normalisedExternalId = requireText(
      externalId,
      "external_platform_id_required",
    );
    const state = getState(
      normalisedStoryId,
      normalisedPlatform,
    );
    if (
      String(state?.external_id || "").trim() !==
      normalisedExternalId
    ) {
      throw new Error(
        "schedule_disarm_state_external_id_mismatch",
      );
    }
    const platformScheduledEvent = getLatestLifecycle.get(
      normalisedStoryId,
      normalisedPlatform,
      "PLATFORM_SCHEDULED",
      "PLATFORM_SCHEDULED",
    );
    if (platformScheduledEvent) {
      return {
        ...assertPlatformScheduledBinding({
          storyId: normalisedStoryId,
          platform: normalisedPlatform,
          externalId: normalisedExternalId,
          idempotencyKey,
          scheduledFor,
          requestFingerprint,
          runwayLockSha256,
          now,
        }),
        anchorLifecycleState: "PLATFORM_SCHEDULED",
      };
    }
    const ticket = resolvePrivateScheduledTicket({
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      idempotencyKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now,
      requireFuture: false,
    });
    const objectCreatedEvent = getLatestLifecycle.get(
      normalisedStoryId,
      normalisedPlatform,
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_OBJECT_CREATED",
    );
    if (!objectCreatedEvent) {
      throw new Error(
        "schedule_disarm_anchored_object_event_required",
      );
    }
    const evidence = parseEvidence(
      objectCreatedEvent.evidence_json,
    );
    for (const [actual, expected, code] of [
      [
        String(evidence.story_id || "").trim(),
        normalisedStoryId,
        "schedule_disarm_story_id_mismatch",
      ],
      [
        String(evidence.external_id || "").trim(),
        normalisedExternalId,
        "schedule_disarm_external_id_mismatch",
      ],
      [
        String(evidence.scheduled_for || "").trim(),
        ticket.scheduledFor,
        "schedule_disarm_scheduled_for_mismatch",
      ],
      [
        String(evidence.request_fingerprint || "")
          .trim()
          .toLowerCase(),
        ticket.requestFingerprint,
        "schedule_disarm_request_fingerprint_mismatch",
      ],
      [
        String(evidence.runway_lock_sha256 || "")
          .trim()
          .toLowerCase(),
        ticket.runwayLockSha256,
        "schedule_disarm_runway_lock_sha256_mismatch",
      ],
    ]) {
      if (actual !== expected) throw new Error(code);
    }
    return {
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      scheduledFor: ticket.scheduledFor,
      publishAt: ticket.scheduledFor,
      requestFingerprint: ticket.requestFingerprint,
      runwayLockSha256: ticket.runwayLockSha256,
      scheduledEventId: ticket.scheduledEventId,
      platformScheduledEventId: null,
      anchoredObjectEventId: Number(objectCreatedEvent.id),
      anchorLifecycleState: "PLATFORM_OBJECT_CREATED",
      evidence,
      state,
    };
  }

  function appendLifecycleInternal(
    {
      storyId,
      platform,
      toState,
      fromState,
      eventReason = null,
      retryabilityClass = null,
      actorType = "system",
      actorId = null,
      operatorDecisionId = null,
      publicationAuthorityAuditId = null,
      evidence = null,
      idempotencyKey,
    },
    { allowSpecialisedState = false } = {},
  ) {
    const normalisedStoryId = requireText(
      storyId,
      "valid_lifecycle_story_platform_and_state_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "valid_lifecycle_story_platform_and_state_required",
    );
    if (!knownState(toState)) {
      throw new Error("valid_lifecycle_story_platform_and_state_required");
    }
    if (!allowSpecialisedState && !DIRECT_LIFECYCLE_STATES.has(toState)) {
      if (toState === "PUBLISHED") {
        throw new Error("published_state_requires_specialised_operation");
      }
      throw new Error(`specialised_lifecycle_operation_required:${toState}`);
    }
    const requiredEvidenceField = REQUIRED_LIFECYCLE_EVIDENCE[toState];
    if (
      requiredEvidenceField &&
      (!evidence ||
        typeof evidence !== "object" ||
        Array.isArray(evidence) ||
        evidence[requiredEvidenceField] !== true)
    ) {
      throw new Error(`lifecycle_evidence_required:${toState}`);
    }
    if (toState === "SCHEDULED") {
      assertScheduledEvidenceShape(evidence);
    }
    const normalisedKey = requireText(
      idempotencyKey,
      "lifecycle_idempotency_key_required",
    );
    if (toState === "HUMAN_APPROVED") {
      const decisionId = Number(operatorDecisionId);
      const normalisedActorId = String(actorId || "").trim();
      const audit =
        Number.isInteger(decisionId) && decisionId > 0
          ? getAuditById.get(decisionId)
          : null;
      if (
        actorType !== "operator" ||
        !normalisedActorId ||
        !audit ||
        audit.actor_id !== normalisedActorId ||
        audit.action !== "approve_publication" ||
        audit.target_type !== "platform_publication" ||
        audit.target_id !== `${normalisedStoryId}:${normalisedPlatform}` ||
        audit.decision !== "APPROVED" ||
        Number(evidence?.operator_decision_id) !== decisionId
      ) {
        throw new Error("human_approval_operator_decision_required");
      }
    }
    if (
      toState !== "AUTONOMOUSLY_APPROVED" &&
      publicationAuthorityAuditId !== null &&
      publicationAuthorityAuditId !== undefined
    ) {
      throw new Error(
        "publication_authority_audit_only_for_autonomous_approval",
      );
    }
    if (toState === "AUTONOMOUSLY_APPROVED") {
      const authorityId = Number(publicationAuthorityAuditId);
      const authority =
        Number.isInteger(authorityId) && authorityId > 0
          ? getPublicationAuthorityById.get(authorityId)
          : null;
      const normalisedActorId = String(actorId || "").trim();
      if (actorType !== "system" || normalisedActorId) {
        throw new Error(
          "autonomous_approval_system_actor_required",
        );
      }
      if (
        operatorDecisionId !== null &&
        operatorDecisionId !== undefined
      ) {
        throw new Error(
          "autonomous_approval_operator_decision_forbidden",
        );
      }
      if (
        !authority ||
        authority.story_id !== normalisedStoryId ||
        authority.platform !== normalisedPlatform ||
        authority.decision !== "APPROVED" ||
        authority.lifecycle_idempotency_key !== normalisedKey ||
        Number(evidence?.publication_authority_audit_id) !==
          authorityId ||
        evidence?.authority_type !== authority.authority_type ||
        evidence?.authority_binding_sha256 !==
          authority.authority_binding_sha256
      ) {
        throw new Error("autonomous_approval_authority_required");
      }
    }
    const evidenceJson = json(evidence);
    const expected = {
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      toState,
      fromState,
      eventReason,
      retryabilityClass,
      actorType,
      actorId,
      publicationAuthorityAuditId,
      evidenceJson,
    };
    const existing = getLifecycleByIdempotency.get(normalisedKey);
    if (existing) {
      expected.fromState =
        fromState === undefined ? existing.from_state : fromState;
      const matched = assertIdempotentMatch(existing, expected, [
        ["story_id", "storyId"],
        ["platform", "platform"],
        ["from_state", "fromState"],
        ["to_state", "toState"],
        ["event_reason", "eventReason"],
        ["retryability_class", "retryabilityClass"],
        ["actor_type", "actorType"],
        ["actor_id", "actorId"],
        [
          "publication_authority_audit_id",
          "publicationAuthorityAuditId",
        ],
        ["evidence_json", "evidenceJson"],
      ]);
      if (!getState(normalisedStoryId, normalisedPlatform)) {
        throw new Error("lifecycle_projection_incomplete");
      }
      return matched;
    }

    const current = getState(normalisedStoryId, normalisedPlatform);
    const currentState = current?.lifecycle_state || null;
    if (fromState !== undefined && fromState !== currentState) {
      throw new Error("lifecycle_from_state_conflict");
    }
    const actualFrom = currentState;
    if (actualFrom) assertTransition(actualFrom, toState);
    else if (toState !== "DISCOVERED") {
      throw new Error(`initial_lifecycle_state_must_be_discovered:${toState}`);
    }

    const info = insertLifecycle.run({
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      fromState: actualFrom,
      toState,
      eventReason,
      retryabilityClass,
      actorType,
      actorId,
      publicationAuthorityAuditId,
      evidenceJson,
      idempotencyKey: normalisedKey,
    });
    // PUBLISHED must be projected atomically with its external ID and
    // verification evidence by recordPublished().
    if (toState !== "PUBLISHED") {
      upsertState.run({
        storyId: normalisedStoryId,
        platform: normalisedPlatform,
        lifecycleState: toState,
        externalId: null,
        externalUrl: null,
        verificationStatus: null,
        verifiedAt: null,
        lastEventId: null,
      });
    }
    return db
      .prepare("SELECT * FROM publication_lifecycle_events WHERE id = ?")
      .get(info.lastInsertRowid);
  }
  const appendLifecycleTransaction = db.transaction((input) =>
    appendLifecycleInternal(input),
  );
  function appendLifecycle(input) {
    return appendLifecycleTransaction(input);
  }
  function appendSpecialisedLifecycle(input) {
    return appendLifecycleInternal(input, {
      allowSpecialisedState: true,
    });
  }

  function appendLedger({
    storyId,
    channelId,
    platform,
    idempotencyKey,
    eventType,
    externalId = null,
    externalUrl = null,
    requestFingerprint = null,
    retryabilityClass = null,
    verificationStatus = null,
    verificationEvidence = null,
    operatorDecisionId = null,
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "dispatch_ledger_story_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "dispatch_ledger_platform_required",
    );
    const normalisedChannelId = requireText(
      channelId,
      "dispatch_ledger_channel_required",
    );
    const normalisedKey = requireText(
      idempotencyKey,
      "dispatch_ledger_idempotency_key_required",
    );
    const normalisedEvent = requireText(
      eventType,
      "dispatch_ledger_event_type_required",
    );
    const existing = getLedgerByIdempotency.get(
      normalisedPlatform,
      normalisedKey,
    );
    if (existing) {
      const fields = [
        ["story_id", "storyId"],
        ["channel_id", "channelId"],
        ["platform", "platform"],
        ["event_type", "eventType"],
        ["external_id", "externalId"],
        ["external_url", "externalUrl"],
        ["request_fingerprint", "requestFingerprint"],
        ["retryability_class", "retryabilityClass"],
        ["verification_status", "verificationStatus"],
        ["verification_evidence_json", "verificationEvidenceJson"],
        ["operator_decision_id", "operatorDecisionId"],
      ];
      return assertIdempotentMatch(
        existing,
        {
          storyId: normalisedStoryId,
          channelId: normalisedChannelId,
          platform: normalisedPlatform,
          eventType: normalisedEvent,
          externalId,
          externalUrl,
          requestFingerprint,
          retryabilityClass,
          verificationStatus,
          verificationEvidenceJson: json(verificationEvidence),
          operatorDecisionId,
        },
        fields,
      );
    }
    const info = insertLedger.run({
      storyId: normalisedStoryId,
      channelId: normalisedChannelId,
      platform: normalisedPlatform,
      idempotencyKey: normalisedKey,
      eventType: normalisedEvent,
      externalId,
      externalUrl,
      requestFingerprint,
      retryabilityClass,
      verificationStatus,
      verificationEvidenceJson: json(verificationEvidence),
      operatorDecisionId,
    });
    return db
      .prepare("SELECT * FROM platform_dispatch_ledger WHERE id = ?")
      .get(info.lastInsertRowid);
  }

  const preparePrivateScheduledUploadTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      actorId = null,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const ticket = resolvePrivateScheduledTicket({
        storyId: identity.storyId,
        platform: identity.platform,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
        requireFuture: true,
      });
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:DISPATCH_STARTED`;
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:PRIVATE_PRESTAGE_STARTED`;
      const prestageEvidence = {
        private_prestage: true,
        scheduled_event_id: ticket.scheduledEventId,
        scheduled_for: ticket.scheduledFor,
        request_fingerprint: ticket.requestFingerprint,
        runway_lock_sha256: ticket.runwayLockSha256,
      };
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      if (!existingLedger) {
        const state = getState(identity.storyId, identity.platform);
        if (state?.lifecycle_state !== "SCHEDULED") {
          throw new Error(
            `private_prestage_requires_scheduled_state:${
              state?.lifecycle_state || "NONE"
            }`,
          );
        }
      }
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "DISPATCH_STARTED",
        eventReason: "governed_private_prestage_started",
        actorType: actorId ? "operator" : "system",
        actorId,
        evidence: prestageEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PRIVATE_PRESTAGE_STARTED",
        requestFingerprint: ticket.requestFingerprint,
        retryabilityClass: "verify_before_retry",
        verificationStatus: "pending",
        verificationEvidence: prestageEvidence,
      });
      if (existingLedger) {
        return getState(identity.storyId, identity.platform);
      }
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "DISPATCH_STARTED",
        externalId: null,
        externalUrl: null,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const prepareDispatchTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      actorId = null,
      requestFingerprint = null,
      evidence = null,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const key = identity.idempotencyKey;
      const ledgerKey = `${key}:ledger:DISPATCH_STARTED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      const state = getState(identity.storyId, identity.platform);
      if (existingLedger) {
        const retryRequestFingerprint =
          requestFingerprint || existingLedger.request_fingerprint;
        appendSpecialisedLifecycle({
          storyId: identity.storyId,
          platform: identity.platform,
          toState: "DISPATCH_STARTED",
          eventReason: "guarded_dispatch_started",
          actorType: actorId ? "operator" : "system",
          actorId,
          evidence,
          idempotencyKey: `${key}:lifecycle:DISPATCH_STARTED`,
        });
        appendLedger({
          storyId: identity.storyId,
          channelId: identity.channelId,
          platform: identity.platform,
          idempotencyKey: ledgerKey,
          eventType: "DISPATCH_STARTED",
          requestFingerprint: retryRequestFingerprint,
          retryabilityClass: "verify_before_retry",
        });
        if (!state) throw new Error("publication_idempotency_conflict");
        return state;
      }
      if (state?.lifecycle_state !== "SCHEDULED") {
        throw new Error(
          `dispatch_requires_scheduled_evidence:${
            state?.lifecycle_state || "NONE"
          }`,
        );
      }
      const scheduledEvent = getLatestScheduledLifecycle.get(
        identity.storyId,
        identity.platform,
      );
      if (!scheduledEvent) {
        throw new Error("dispatch_requires_scheduled_lifecycle_event");
      }
      const scheduledEvidence = parseEvidence(scheduledEvent.evidence_json);
      assertFreshScheduledEvidence(scheduledEvidence, { now });
      if (
        String(scheduledEvidence.dispatch_idempotency_key).trim() !==
        identity.idempotencyKey
      ) {
        throw new Error("scheduled_dispatch_identity_mismatch");
      }
      const scheduledRequestFingerprint = String(
        scheduledEvidence.request_fingerprint,
      ).trim();
      if (
        requestFingerprint &&
        String(requestFingerprint).trim() !== scheduledRequestFingerprint
      ) {
        throw new Error("scheduled_request_fingerprint_mismatch");
      }
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "DISPATCH_STARTED",
        eventReason: "guarded_dispatch_started",
        actorType: actorId ? "operator" : "system",
        actorId,
        evidence,
        idempotencyKey: `${key}:lifecycle:DISPATCH_STARTED`,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "DISPATCH_STARTED",
        requestFingerprint: scheduledRequestFingerprint,
        retryabilityClass: "verify_before_retry",
      });
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "DISPATCH_STARTED",
        externalId: null,
        externalUrl: null,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const cancelScheduledAdmissionTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      scheduledEventId,
      scheduledDispatchIdempotencyKey,
      requestFingerprint,
      actorId,
      operatorDecisionId,
      evidence = null,
      idempotencyKey,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedActor = requireText(
        actorId,
        "scheduled_cancellation_operator_required",
      );
      const decisionId = Number(operatorDecisionId);
      const decision =
        Number.isInteger(decisionId) && decisionId > 0
          ? getAuditById.get(decisionId)
          : null;
      if (
        !decision ||
        decision.actor_id !== normalisedActor ||
        ![
          "repair_governed_reviewed_qa_refusal",
          "repair_governed_reviewed_video_qa_refusal",
        ].includes(decision.action) ||
        decision.target_type !== "platform_publication" ||
        decision.target_id !==
          `${identity.storyId}:${identity.platform}` ||
        decision.decision !== "APPROVED"
      ) {
        throw new Error("scheduled_cancellation_operator_decision_required");
      }
      const existing = getLifecycleByIdempotency.get(
        identity.idempotencyKey,
      );
      if (existing) {
        if (
          existing.story_id !== identity.storyId ||
          existing.platform !== identity.platform ||
          existing.to_state !== "ADMISSION_CANCELLED_BEFORE_DISPATCH"
        ) {
          throw new Error("publication_idempotency_conflict");
        }
        return existing;
      }
      const state = getState(identity.storyId, identity.platform);
      if (state?.lifecycle_state !== "SCHEDULED") {
        throw new Error(
          `scheduled_cancellation_requires_scheduled_state:${
            state?.lifecycle_state || "NONE"
          }`,
        );
      }
      if (
        String(state.external_id || "").trim() ||
        String(state.external_url || "").trim()
      ) {
        throw new Error("scheduled_cancellation_external_identity_present");
      }
      const scheduledEvent = getLatestScheduledLifecycle.get(
        identity.storyId,
        identity.platform,
      );
      if (!scheduledEvent) {
        throw new Error("scheduled_cancellation_event_required");
      }
      if (Number(scheduledEvent.id) !== Number(scheduledEventId)) {
        throw new Error("scheduled_cancellation_event_mismatch");
      }
      const scheduledEvidence = parseEvidence(
        scheduledEvent.evidence_json,
      );
      if (
        String(scheduledEvidence.dispatch_idempotency_key || "").trim() !==
        String(scheduledDispatchIdempotencyKey || "").trim()
      ) {
        throw new Error("scheduled_cancellation_dispatch_key_mismatch");
      }
      if (
        String(scheduledEvidence.request_fingerprint || "").trim() !==
        String(requestFingerprint || "").trim()
      ) {
        throw new Error("scheduled_cancellation_request_fingerprint_mismatch");
      }
      const effectiveNow =
        now instanceof Date ? new Date(now.getTime()) : new Date(now);
      const scheduledFor = new Date(scheduledEvidence.scheduled_for);
      if (
        Number.isNaN(effectiveNow.getTime()) ||
        Number.isNaN(scheduledFor.getTime())
      ) {
        throw new Error("scheduled_cancellation_expiry_time_invalid");
      }
      if (
        effectiveNow.getTime() - scheduledFor.getTime() <=
        MAX_SCHEDULE_DISPATCH_DRIFT_MS
      ) {
        throw new Error("scheduled_cancellation_ticket_not_expired");
      }
      const decisionEvidence = parseEvidence(decision.evidence_json);
      if (
        Number(decisionEvidence.scheduled_event_id) !==
          Number(scheduledEvent.id) ||
        String(
          decisionEvidence.dispatch_idempotency_key || "",
        ).trim() !==
          String(scheduledEvidence.dispatch_idempotency_key || "").trim() ||
        String(decisionEvidence.request_fingerprint || "").trim() !==
          String(scheduledEvidence.request_fingerprint || "").trim() ||
        decisionEvidence.create_boundary_entered !== false
      ) {
        throw new Error("scheduled_cancellation_operator_evidence_mismatch");
      }
      if (
        evidence?.create_boundary_entered !== false ||
        evidence?.external_object_created !== false
      ) {
        throw new Error("scheduled_cancellation_pre_create_evidence_required");
      }
      const laterLifecycleCount = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM publication_lifecycle_events
           WHERE story_id = ? AND platform = ? AND id > ?`,
        )
        .get(
          identity.storyId,
          identity.platform,
          scheduledEvent.id,
        ).count;
      const ledgerCount = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM platform_dispatch_ledger
           WHERE story_id = ? AND platform = ?`,
        )
        .get(identity.storyId, identity.platform).count;
      const platformPostCount = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM platform_posts
           WHERE story_id = ? AND platform = ?`,
        )
        .get(identity.storyId, identity.platform).count;
      const storyProjection = db
        .prepare(
          `SELECT youtube_post_id, youtube_url
           FROM stories WHERE id = ?`,
        )
        .get(identity.storyId);
      if (
        Number(laterLifecycleCount) !== 0 ||
        Number(ledgerCount) !== 0 ||
        Number(platformPostCount) !== 0 ||
        String(storyProjection?.youtube_post_id || "").trim() ||
        String(storyProjection?.youtube_url || "").trim()
      ) {
        throw new Error("scheduled_cancellation_create_boundary_not_clear");
      }
      return appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        fromState: "SCHEDULED",
        toState: "ADMISSION_CANCELLED_BEFORE_DISPATCH",
        eventReason: "expired_admission_cancelled_after_pre_create_qa_repair",
        retryabilityClass: "reschedule_after_operator_review",
        actorType: "operator",
        actorId: normalisedActor,
        operatorDecisionId: decisionId,
        evidence: {
          ...evidence,
          scheduled_event_id: Number(scheduledEvent.id),
          scheduled_dispatch_idempotency_key:
            String(scheduledEvidence.dispatch_idempotency_key).trim(),
          request_fingerprint:
            String(scheduledEvidence.request_fingerprint).trim(),
          operator_decision_id: decisionId,
        },
        idempotencyKey: identity.idempotencyKey,
      });
    },
  );

  const objectCreatedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      externalUrl = null,
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const lifecycleKey = `${identity.idempotencyKey}:lifecycle:PLATFORM_OBJECT_CREATED`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:PLATFORM_OBJECT_CREATED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PLATFORM_OBJECT_CREATED",
        eventReason: "platform_adapter_returned_external_id",
        evidence: { external_id_recorded: true },
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PLATFORM_OBJECT_CREATED",
        externalId: normalisedExternalId,
        externalUrl,
        retryabilityClass: "never_retry_without_reconciliation",
        verificationStatus: "pending",
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_OBJECT_CREATED",
        externalId: normalisedExternalId,
        externalUrl,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const privateScheduledObjectCreatedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      externalUrl = null,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const ticket = resolvePrivateScheduledTicket({
        storyId: identity.storyId,
        platform: identity.platform,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
        requireFuture: true,
      });
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:PLATFORM_OBJECT_CREATED`;
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:PLATFORM_OBJECT_CREATED`;
      const objectEvidence = {
        external_id_recorded: true,
        story_id: identity.storyId,
        external_id: normalisedExternalId,
        scheduled_event_id: ticket.scheduledEventId,
        scheduled_for: ticket.scheduledFor,
        request_fingerprint: ticket.requestFingerprint,
        runway_lock_sha256: ticket.runwayLockSha256,
        private_prestage: true,
        requested_privacy_status: "private",
        requested_publish_at: null,
        release_armed: false,
      };
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      if (!existingLedger) {
        const state = getState(identity.storyId, identity.platform);
        if (state?.lifecycle_state !== "DISPATCH_STARTED") {
          throw new Error(
            `private_prestage_object_requires_dispatch_started:${
              state?.lifecycle_state || "NONE"
            }`,
          );
        }
      }
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PLATFORM_OBJECT_CREATED",
        eventReason: "private_scheduled_platform_object_created",
        evidence: objectEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PLATFORM_OBJECT_CREATED",
        externalId: normalisedExternalId,
        externalUrl,
        requestFingerprint: ticket.requestFingerprint,
        retryabilityClass: "never_retry_without_reconciliation",
        verificationStatus: "pending",
        verificationEvidence: objectEvidence,
      });
      if (existingLedger) {
        return getState(identity.storyId, identity.platform);
      }
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_OBJECT_CREATED",
        externalId: normalisedExternalId,
        externalUrl,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const privateUnscheduledObjectVerifiedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      verifiedAt,
      verificationEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const ticket = resolvePrivateScheduledTicket({
        storyId: identity.storyId,
        platform: identity.platform,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
        requireFuture: true,
      });
      if (!youtubePrivateUnscheduledEvidence(verificationEvidence)) {
        throw new Error(
          "youtube_private_unscheduled_processed_evidence_required",
        );
      }
      const before = getState(identity.storyId, identity.platform);
      if (before?.lifecycle_state !== "PLATFORM_OBJECT_CREATED") {
        throw new Error(
          `private_unscheduled_verification_requires_created_object:${
            before?.lifecycle_state || "NONE"
          }`,
        );
      }
      if (String(before.external_id || "").trim() !== normalisedExternalId) {
        throw new Error(
          "private_unscheduled_verification_external_id_mismatch",
        );
      }
      if (
        evidenceExternalId(verificationEvidence) !== normalisedExternalId
      ) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      if (
        Date.parse(normalisedVerifiedAt) >=
        Date.parse(ticket.scheduledFor)
      ) {
        throw new Error(
          "youtube_private_unscheduled_verified_too_late",
        );
      }
      const durableEvidence = {
        ...verificationEvidence,
        story_id: identity.storyId,
        external_id: normalisedExternalId,
        scheduled_event_id: ticket.scheduledEventId,
        intended_scheduled_for: ticket.scheduledFor,
        request_fingerprint: ticket.requestFingerprint,
        runway_lock_sha256: ticket.runwayLockSha256,
        release_armed: false,
        verified_at: normalisedVerifiedAt,
      };
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:PRIVATE_UNSCHEDULED_VERIFIED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PRIVATE_UNSCHEDULED_VERIFIED",
        externalUrl: before.external_url,
        requestFingerprint: ticket.requestFingerprint,
        retryabilityClass: "reverify_before_schedule_arm",
        verificationStatus: "private_unscheduled_processed",
        verificationEvidence: durableEvidence,
      });
      if (existingLedger) {
        return getState(identity.storyId, identity.platform);
      }
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_OBJECT_CREATED",
        externalId: normalisedExternalId,
        externalUrl: before.external_url,
        verificationStatus: "private_unscheduled_processed",
        verifiedAt: normalisedVerifiedAt,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const scheduledPlatformArmAttemptStartedTransaction =
    db.transaction(
      ({
        storyId,
        platform,
        channelId = null,
        idempotencyKey,
        externalId,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        sourceRevalidation,
        now = new Date(),
      }) => {
        const binding =
          assertPrivateUnscheduledPlatformObjectBinding({
            storyId,
            channelId,
            platform,
            externalId,
            idempotencyKey,
            scheduledFor,
            requestFingerprint,
            runwayLockSha256,
            now,
          });
        const startedAt =
          now instanceof Date
            ? new Date(now.getTime())
            : new Date(now);
        if (Number.isNaN(startedAt.getTime())) {
          throw new Error(
            "youtube_schedule_arm_attempt_clock_invalid",
          );
        }
        const validatedSource =
          assertExactOfficialSourceRevalidation({
            receipt: sourceRevalidation,
            binding,
            storyId: binding.storyId,
            platform: binding.platform,
            externalId: binding.externalId,
            boundaryTime: startedAt,
          });
        const evidence = {
          schema_version:
            "pulse-youtube-schedule-arm-attempt-v1",
          schedule_arm_update_started: true,
          remote_schedule_may_exist: true,
          story_id: binding.storyId,
          channel_id: binding.channelId,
          platform: binding.platform,
          external_id: binding.externalId,
          scheduled_event_id: binding.scheduledEventId,
          scheduled_for: binding.scheduledFor,
          request_fingerprint: binding.requestFingerprint,
          runway_lock_sha256: binding.runwayLockSha256,
          source_revalidation: validatedSource,
          started_at: startedAt.toISOString(),
        };
        const ledgerKey =
          `${idempotencyKey}:ledger:SCHEDULE_ARM_UPDATE_STARTED`;
        const existing = getLedgerByIdempotency.get(
          binding.platform,
          ledgerKey,
        );
        if (existing) {
          const recovered = getScheduledPlatformArmAttempt({
            storyId: binding.storyId,
            channelId: binding.channelId,
            platform: binding.platform,
            externalId: binding.externalId,
            idempotencyKey,
            scheduledFor: binding.scheduledFor,
            requestFingerprint: binding.requestFingerprint,
            runwayLockSha256: binding.runwayLockSha256,
            now,
          });
          if (
            json(recovered.sourceRevalidation) !==
              json(validatedSource)
          ) {
            throw new Error("publication_idempotency_conflict");
          }
          return existing;
        }
        return appendLedger({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: binding.platform,
          idempotencyKey: ledgerKey,
          eventType: "SCHEDULE_ARM_UPDATE_STARTED",
          requestFingerprint: binding.requestFingerprint,
          retryabilityClass:
            "remote_schedule_may_exist_disarm_before_retry",
          verificationStatus:
            "schedule_arm_update_started",
          verificationEvidence: evidence,
        });
      },
    );

  const platformScheduledTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      verifiedAt,
      verificationEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const ticket = resolvePrivateScheduledTicket({
        storyId: identity.storyId,
        platform: identity.platform,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
        requireFuture: true,
      });
      if (!youtubePrivateScheduleEvidence(verificationEvidence)) {
        throw new Error(
          "youtube_private_processed_schedule_evidence_required",
        );
      }
      const before = getState(identity.storyId, identity.platform);
      if (
        before?.lifecycle_state !== "PLATFORM_OBJECT_CREATED" &&
        before?.lifecycle_state !== "PLATFORM_SCHEDULED"
      ) {
        throw new Error(
          `platform_schedule_requires_created_object:${
            before?.lifecycle_state || "NONE"
          }`,
        );
      }
      if (String(before.external_id || "").trim() !== normalisedExternalId) {
        throw new Error("platform_schedule_external_id_mismatch");
      }
      if (
        evidenceExternalId(verificationEvidence) !== normalisedExternalId
      ) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      let publishAt;
      try {
        publishAt = new Date(
          verificationEvidence.publish_at,
        ).toISOString();
      } catch {
        publishAt = null;
      }
      if (publishAt !== ticket.scheduledFor) {
        throw new Error("youtube_private_publish_at_mismatch");
      }
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      if (
        Date.parse(normalisedVerifiedAt) >=
        Date.parse(ticket.scheduledFor)
      ) {
        throw new Error("youtube_private_schedule_verified_too_late");
      }
      const scheduledEvidence = {
        ...verificationEvidence,
        story_id: identity.storyId,
        external_id: normalisedExternalId,
        scheduled_event_id: ticket.scheduledEventId,
        scheduled_for: ticket.scheduledFor,
        publish_at: ticket.scheduledFor,
        request_fingerprint: ticket.requestFingerprint,
        runway_lock_sha256: ticket.runwayLockSha256,
        verified_at: normalisedVerifiedAt,
      };
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:PLATFORM_SCHEDULED`;
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:PLATFORM_SCHEDULED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PLATFORM_SCHEDULED",
        eventReason: "youtube_private_schedule_processed",
        evidence: scheduledEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PLATFORM_SCHEDULED",
        requestFingerprint: ticket.requestFingerprint,
        retryabilityClass: "verify_public_at_or_after_t0",
        verificationStatus: "scheduled_private",
        verificationEvidence: scheduledEvidence,
      });
      if (existingLedger) {
        return getState(identity.storyId, identity.platform);
      }
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_SCHEDULED",
        externalId: normalisedExternalId,
        externalUrl: null,
        verificationStatus: "scheduled_private",
        verifiedAt: normalisedVerifiedAt,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const confirmTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      verifiedAt,
      verificationEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      if (!meaningfulVerificationEvidence(verificationEvidence)) {
        throw new Error(
          "meaningful_platform_verification_evidence_required",
        );
      }
      const before = getState(identity.storyId, identity.platform);
      if (!before?.external_id) {
        throw new Error("platform_confirmation_external_id_missing");
      }
      if (
        evidenceExternalId(verificationEvidence) !== before.external_id
      ) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      const confirmedEvidence = {
        ...verificationEvidence,
        external_id: before.external_id,
        verified_at: normalisedVerifiedAt,
      };
      const lifecycleKey = `${identity.idempotencyKey}:lifecycle:PLATFORM_CONFIRMED`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:PLATFORM_CONFIRMED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PLATFORM_CONFIRMED",
        eventReason: "platform_response_verified",
        evidence: confirmedEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PLATFORM_CONFIRMED",
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed",
        verificationEvidence: confirmedEvidence,
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_CONFIRMED",
        externalId: null,
        externalUrl: null,
        verificationStatus: "confirmed",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const publishedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      verifiedAt,
      verificationEvidence = null,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      if (!publicPlatformEvidence(verificationEvidence)) {
        throw new Error("public_platform_evidence_required");
      }
      const before = getState(identity.storyId, identity.platform);
      if (!before?.external_id) throw new Error("published_external_id_missing");
      if (
        evidenceExternalId(verificationEvidence) !== before.external_id
      ) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      if (before.verification_status !== "confirmed") {
        throw new Error("published_platform_confirmation_missing");
      }
      const publishedEvidence = {
        ...(verificationEvidence || {}),
        verified_at: normalisedVerifiedAt,
      };
      const lifecycleKey = `${identity.idempotencyKey}:lifecycle:PUBLISHED`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:PUBLISHED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PUBLISHED",
        eventReason: "platform_object_confirmed_public",
        evidence: publishedEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "PUBLISHED",
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed",
        verificationEvidence: publishedEvidence,
      });
      if (existingLedger) return before;
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PUBLISHED",
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "confirmed",
        verifiedAt: normalisedVerifiedAt,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  function assertScheduledPlatformReleaseCommitment({
    storyId,
    channelId,
    platform,
    externalId,
    idempotencyKey,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
    now = new Date(),
    allowPublishedReplay = false,
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "publication_story_id_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "publication_platform_required",
    );
    const normalisedChannelId = requireText(
      channelId,
      "publication_channel_id_required",
    );
    const normalisedExternalId = requireText(
      externalId,
      "external_platform_id_required",
    );
    const normalisedKey = requireText(
      idempotencyKey,
      "publication_operation_idempotency_key_required",
    );
    const binding = assertPlatformScheduledBinding({
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      idempotencyKey: normalisedKey,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      now,
    });
    const state = getState(
      normalisedStoryId,
      normalisedPlatform,
    );
    if (
      state?.lifecycle_state !== "PLATFORM_SCHEDULED" &&
      !(
        allowPublishedReplay === true &&
        state?.lifecycle_state === "PUBLISHED"
      )
    ) {
      throw new Error(
        `release_commitment_requires_platform_scheduled:${
          state?.lifecycle_state || "NONE"
        }`,
      );
    }
    const ledgerKey =
      `${normalisedKey}:ledger:RELEASE_COMMITMENT_CONFIRMED`;
    const ledger = getLedgerByIdempotency.get(
      normalisedPlatform,
      ledgerKey,
    );
    if (
      !ledger ||
      ledger.story_id !== normalisedStoryId ||
      ledger.channel_id !== normalisedChannelId ||
      ledger.platform !== normalisedPlatform ||
      ledger.event_type !==
        "RELEASE_COMMITMENT_CONFIRMED" ||
      String(ledger.request_fingerprint || "")
        .trim()
        .toLowerCase() !== binding.requestFingerprint
    ) {
      if (
        ledger &&
        ledger.channel_id !== normalisedChannelId
      ) {
        throw new Error(
          "release_commitment_channel_mismatch",
        );
      }
      throw new Error("release_commitment_confirmed_required");
    }
    const evidence = parseEvidence(
      ledger.verification_evidence_json,
    );
    const exact = [
      [
        String(evidence.story_id || "").trim(),
        normalisedStoryId,
      ],
      [
        String(evidence.channel_id || "").trim(),
        normalisedChannelId,
      ],
      [
        String(evidence.external_id || "").trim(),
        normalisedExternalId,
      ],
      [
        String(evidence.scheduled_for || "").trim(),
        binding.scheduledFor,
      ],
      [
        String(evidence.request_fingerprint || "")
          .trim()
          .toLowerCase(),
        binding.requestFingerprint,
      ],
      [
        String(evidence.runway_lock_sha256 || "")
          .trim()
          .toLowerCase(),
        binding.runwayLockSha256,
      ],
      [
        Number(evidence.scheduled_event_id),
        binding.scheduledEventId,
      ],
      [
        Number(evidence.platform_scheduled_event_id),
        binding.platformScheduledEventId,
      ],
    ].every(([actual, expected]) => actual === expected);
    if (
      !exact ||
      evidence.release_commitment_confirmed !== true ||
      String(evidence.commitment_boundary || "").trim() !==
        "remote_private_publish_at_verified" ||
      !youtubePrivateScheduleEvidence(evidence) ||
      String(evidence.control?.verdict || "")
        .trim()
        .toUpperCase() !== "GREEN" ||
      evidence.control?.kill_switch_healthy !== true ||
      evidence.control?.operating_contract_valid !== true ||
      evidence.control?.scheduler_owner_healthy !== true ||
      evidence.control?.live_publish_enabled !== true
    ) {
      throw new Error(
        "release_commitment_exact_evidence_invalid",
      );
    }
    const committedAt = validEvidenceTimestamp(
      evidence.committed_at,
      "release_commitment_time_required",
    );
    validEvidenceTimestamp(
      evidence.control?.checked_at,
      "release_commitment_control_time_required",
    );
    assertExactT15ReleaseProofs({
      binding,
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      verificationEvidence: evidence,
      controlEvidence: evidence.control,
      boundaryTime: committedAt,
    });
    if (
      committedAt.getTime() >=
      Date.parse(binding.scheduledFor)
    ) {
      throw new Error(
        "release_commitment_must_precede_scheduled_release",
      );
    }
    return {
      storyId: normalisedStoryId,
      channelId: normalisedChannelId,
      platform: normalisedPlatform,
      externalId: normalisedExternalId,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
      scheduledEventId: binding.scheduledEventId,
      platformScheduledEventId:
        binding.platformScheduledEventId,
      evidence,
      ledger,
      state,
    };
  }

  const scheduledPlatformReleaseCommitmentTransaction =
    db.transaction(
      ({
        storyId,
        platform,
        channelId = null,
        idempotencyKey,
        externalId,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        verifiedAt,
        verificationEvidence,
        controlEvidence,
        now = new Date(),
      }) => {
        const identity = operationIdentity({
          storyId,
          platform,
          channelId,
          idempotencyKey,
        });
        const normalisedExternalId = requireText(
          externalId,
          "external_platform_id_required",
        );
        const binding = assertPlatformScheduledBinding({
          storyId: identity.storyId,
          platform: identity.platform,
          externalId: normalisedExternalId,
          idempotencyKey: identity.idempotencyKey,
          scheduledFor,
          requestFingerprint,
          runwayLockSha256,
          now,
        });
        const ledgerKey =
          `${identity.idempotencyKey}:ledger:RELEASE_COMMITMENT_CONFIRMED`;
        const existing = getLedgerByIdempotency.get(
          identity.platform,
          ledgerKey,
        );
        if (existing) {
          return assertScheduledPlatformReleaseCommitment({
            storyId: identity.storyId,
            channelId: identity.channelId,
            platform: identity.platform,
            externalId: normalisedExternalId,
            idempotencyKey: identity.idempotencyKey,
            scheduledFor: binding.scheduledFor,
            requestFingerprint: binding.requestFingerprint,
            runwayLockSha256: binding.runwayLockSha256,
            now,
          }).ledger;
        }
        const state = getState(
          identity.storyId,
          identity.platform,
        );
        if (state?.lifecycle_state !== "PLATFORM_SCHEDULED") {
          throw new Error(
            `release_commitment_requires_platform_scheduled:${
              state?.lifecycle_state || "NONE"
            }`,
          );
        }
        if (
          !youtubePrivateScheduleEvidence(
            verificationEvidence,
          ) ||
          evidenceExternalId(verificationEvidence) !==
            normalisedExternalId
        ) {
          throw new Error(
            "release_commitment_private_schedule_proof_required",
          );
        }
        const effectiveNow =
          now instanceof Date
            ? new Date(now.getTime())
            : new Date(now);
        if (Number.isNaN(effectiveNow.getTime())) {
          throw new Error(
            "release_commitment_clock_invalid",
          );
        }
        if (
          !controlEvidence ||
          typeof controlEvidence !== "object" ||
          Array.isArray(controlEvidence) ||
          String(controlEvidence.verdict || "")
            .trim()
            .toUpperCase() !== "GREEN" ||
          controlEvidence.kill_switch_healthy !== true ||
          controlEvidence.operating_contract_valid !== true ||
          controlEvidence.scheduler_owner_healthy !== true ||
          controlEvidence.live_publish_enabled !== true
        ) {
          throw new Error(
            "release_commitment_fresh_green_control_required",
          );
        }
        const checkedAt = validEvidenceTimestamp(
          controlEvidence.checked_at,
          "release_commitment_control_time_required",
        );
        const controlAge =
          effectiveNow.getTime() - checkedAt.getTime();
        if (controlAge < 0) {
          throw new Error(
            "release_commitment_control_evidence_in_future",
          );
        }
        if (
          controlAge >
          MAX_CONTROL_TOWER_EVIDENCE_AGE_MS
        ) {
          throw new Error(
            "release_commitment_control_evidence_stale",
          );
        }
        const normalisedVerifiedAt = verifiedTimestamp(
          verifiedAt,
          {
            now: effectiveNow,
            maxAgeMs:
              MAX_CONTROL_TOWER_EVIDENCE_AGE_MS,
          },
        );
        if (
          Date.parse(normalisedVerifiedAt) >=
          Date.parse(binding.scheduledFor)
        ) {
          throw new Error(
            "release_commitment_must_precede_scheduled_release",
          );
        }
        const t15Proofs = assertExactT15ReleaseProofs({
          binding,
          storyId: identity.storyId,
          platform: identity.platform,
          externalId: normalisedExternalId,
          verificationEvidence,
          controlEvidence,
          boundaryTime: normalisedVerifiedAt,
        });
        const committedEvidence = {
          ...verificationEvidence,
          source_revalidation:
            t15Proofs.sourceRevalidation,
          schedule_arm_proof:
            t15Proofs.scheduleArmProof,
          schema_version:
            "pulse-youtube-release-commitment-v1",
          release_commitment_confirmed: true,
          commitment_boundary:
            "remote_private_publish_at_verified",
          story_id: identity.storyId,
          channel_id: identity.channelId,
          external_id: normalisedExternalId,
          scheduled_event_id: binding.scheduledEventId,
          platform_scheduled_event_id:
            binding.platformScheduledEventId,
          scheduled_for: binding.scheduledFor,
          request_fingerprint: binding.requestFingerprint,
          runway_lock_sha256: binding.runwayLockSha256,
          committed_at: normalisedVerifiedAt,
          control: {
            ...controlEvidence,
            source_revalidation:
              t15Proofs.sourceRevalidation,
            schedule_arm_proof:
              t15Proofs.scheduleArmProof,
            verdict: "GREEN",
            checked_at: checkedAt.toISOString(),
          },
        };
        return appendLedger({
          storyId: identity.storyId,
          channelId: identity.channelId,
          platform: identity.platform,
          idempotencyKey: ledgerKey,
          eventType: "RELEASE_COMMITMENT_CONFIRMED",
          requestFingerprint: binding.requestFingerprint,
          retryabilityClass:
            "remote_release_armed_verify_only",
          verificationStatus:
            "remote_private_publish_at_committed",
          verificationEvidence: committedEvidence,
        });
      },
    );

  const scheduledPlatformPublishedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      verifiedAt,
      verificationEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const binding = assertPlatformScheduledBinding({
        storyId: identity.storyId,
        platform: identity.platform,
        externalId: normalisedExternalId,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
      });
      const current = getState(identity.storyId, identity.platform);
      if (current?.lifecycle_state === "PUBLISHED") return current;
      if (current?.lifecycle_state !== "PLATFORM_SCHEDULED") {
        throw new Error(
          `scheduled_publication_requires_platform_scheduled:${
            current?.lifecycle_state || "NONE"
          }`,
        );
      }
      assertScheduledPlatformReleaseCommitment({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        externalId: normalisedExternalId,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor: binding.scheduledFor,
        requestFingerprint: binding.requestFingerprint,
        runwayLockSha256: binding.runwayLockSha256,
        now,
      });
      const effectiveNow =
        now instanceof Date ? new Date(now.getTime()) : new Date(now);
      if (Number.isNaN(effectiveNow.getTime())) {
        throw new Error("youtube_scheduled_release_clock_invalid");
      }
      if (
        effectiveNow.getTime() <
        Date.parse(binding.scheduledFor)
      ) {
        throw new Error("youtube_scheduled_release_not_due");
      }
      if (!youtubePublicProcessedEvidence(verificationEvidence)) {
        throw new Error(
          "youtube_public_processed_verification_evidence_required",
        );
      }
      if (
        evidenceExternalId(verificationEvidence) !== normalisedExternalId
      ) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      if (
        Date.parse(normalisedVerifiedAt) <
        Date.parse(binding.scheduledFor)
      ) {
        throw new Error("youtube_public_verification_before_t0");
      }
      const publishedEvidence = {
        ...verificationEvidence,
        story_id: identity.storyId,
        external_id: normalisedExternalId,
        scheduled_event_id: binding.scheduledEventId,
        platform_scheduled_event_id:
          binding.platformScheduledEventId,
        scheduled_for: binding.scheduledFor,
        request_fingerprint: binding.requestFingerprint,
        runway_lock_sha256: binding.runwayLockSha256,
        verified_at: normalisedVerifiedAt,
      };
      confirmTransaction({
        storyId: identity.storyId,
        platform: identity.platform,
        channelId: identity.channelId,
        idempotencyKey: identity.idempotencyKey,
        verifiedAt: normalisedVerifiedAt,
        verificationEvidence: publishedEvidence,
        now,
      });
      return publishedTransaction({
        storyId: identity.storyId,
        platform: identity.platform,
        channelId: identity.channelId,
        idempotencyKey: identity.idempotencyKey,
        verifiedAt: normalisedVerifiedAt,
        verificationEvidence: publishedEvidence,
        now,
      });
    },
  );

  const scheduledPlatformDisarmRequestedTransaction =
    db.transaction(
      ({
        storyId,
        platform,
        channelId = null,
        idempotencyKey,
        externalId,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        disarmEvidence,
        now = new Date(),
      }) => {
        const identity = operationIdentity({
          storyId,
          platform,
          channelId,
          idempotencyKey,
        });
        const normalisedExternalId = requireText(
          externalId,
          "external_platform_id_required",
        );
        const binding = resolveScheduledPlatformDisarmBinding({
          storyId: identity.storyId,
          platform: identity.platform,
          externalId: normalisedExternalId,
          idempotencyKey: identity.idempotencyKey,
          scheduledFor,
          requestFingerprint,
          runwayLockSha256,
          now,
        });
        const ledgerKey =
          `${identity.idempotencyKey}:ledger:SCHEDULE_DISARM_REQUESTED`;
        const existing = getLedgerByIdempotency.get(
          identity.platform,
          ledgerKey,
        );
        if (existing) {
          return assertIdempotentMatch(
            existing,
            {
              storyId: identity.storyId,
              channelId: identity.channelId,
              platform: identity.platform,
              eventType: "SCHEDULE_DISARM_REQUESTED",
              externalId: null,
              requestFingerprint: binding.requestFingerprint,
            },
            [
              ["story_id", "storyId"],
              ["channel_id", "channelId"],
              ["platform", "platform"],
              ["event_type", "eventType"],
              ["external_id", "externalId"],
              ["request_fingerprint", "requestFingerprint"],
            ],
          );
        }
        const current = getState(
          identity.storyId,
          identity.platform,
        );
        if (
          ![
            "PLATFORM_OBJECT_CREATED",
            "PLATFORM_SCHEDULED",
            "RECONCILIATION_REQUIRED",
          ].includes(current?.lifecycle_state)
        ) {
          throw new Error(
            `schedule_disarm_requires_platform_scheduled:${
              current?.lifecycle_state || "NONE"
            }`,
          );
        }
        if (
          !disarmEvidence ||
          typeof disarmEvidence !== "object" ||
          Array.isArray(disarmEvidence) ||
          disarmEvidence.schedule_disarm_requested !== true ||
          String(disarmEvidence.external_id || "").trim() !==
            normalisedExternalId ||
          !String(disarmEvidence.reason || "").trim() ||
          String(disarmEvidence.authority?.verdict || "")
            .trim()
            .toUpperCase() !== "DISARM_AUTHORISED"
        ) {
          throw new Error(
            "youtube_schedule_disarm_request_evidence_required",
          );
        }
        validEvidenceTimestamp(
          disarmEvidence.requested_at,
          "youtube_schedule_disarm_request_time_required",
        );
        validEvidenceTimestamp(
          disarmEvidence.authority.checked_at,
          "youtube_schedule_disarm_authority_time_required",
        );
        return appendLedger({
          storyId: identity.storyId,
          channelId: identity.channelId,
          platform: identity.platform,
          idempotencyKey: ledgerKey,
          eventType: "SCHEDULE_DISARM_REQUESTED",
          requestFingerprint: binding.requestFingerprint,
          retryabilityClass: "verify_before_repeat_update",
          verificationStatus: "disarm_requested",
          verificationEvidence: {
            ...disarmEvidence,
            story_id: identity.storyId,
            external_id: normalisedExternalId,
            scheduled_event_id: binding.scheduledEventId,
            platform_scheduled_event_id:
              binding.platformScheduledEventId,
            scheduled_for: binding.scheduledFor,
            request_fingerprint: binding.requestFingerprint,
            runway_lock_sha256: binding.runwayLockSha256,
          },
        });
      },
    );

  const scheduledPlatformDisarmedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      scheduledFor,
      requestFingerprint,
      runwayLockSha256,
      verifiedAt,
      verificationEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedExternalId = requireText(
        externalId,
        "external_platform_id_required",
      );
      const binding = resolveScheduledPlatformDisarmBinding({
        storyId: identity.storyId,
        platform: identity.platform,
        externalId: normalisedExternalId,
        idempotencyKey: identity.idempotencyKey,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        now,
      });
      const current = getState(
        identity.storyId,
        identity.platform,
      );
      if (
        current?.lifecycle_state ===
        "PLATFORM_SCHEDULE_DISARMED"
      ) {
        if (
          String(current.external_id || "").trim() !==
          normalisedExternalId
        ) {
          throw new Error(
            "schedule_disarm_external_id_mismatch",
          );
        }
        return current;
      }
      if (
        ![
          "PLATFORM_OBJECT_CREATED",
          "PLATFORM_SCHEDULED",
          "RECONCILIATION_REQUIRED",
        ].includes(current?.lifecycle_state)
      ) {
        throw new Error(
          `schedule_disarm_requires_platform_scheduled:${
            current?.lifecycle_state || "NONE"
          }`,
        );
      }
      if (
        !verificationEvidence ||
        typeof verificationEvidence !== "object" ||
        Array.isArray(verificationEvidence) ||
        verificationEvidence.platform_object_confirmed !== true ||
        verificationEvidence.schedule_disarm_confirmed !== true ||
        String(verificationEvidence.external_id || "").trim() !==
          normalisedExternalId ||
        String(verificationEvidence.privacy_status || "")
          .trim()
          .toLowerCase() !== "private" ||
        String(verificationEvidence.publish_at || "").trim()
      ) {
        throw new Error(
          "youtube_private_unscheduled_verification_evidence_required",
        );
      }
      const normalisedVerifiedAt = verifiedTimestamp(
        verifiedAt,
        { now },
      );
      const confirmedEvidence = {
        ...verificationEvidence,
        story_id: identity.storyId,
        external_id: normalisedExternalId,
        scheduled_event_id: binding.scheduledEventId,
        platform_scheduled_event_id:
          binding.platformScheduledEventId,
        scheduled_for: binding.scheduledFor,
        request_fingerprint: binding.requestFingerprint,
        runway_lock_sha256: binding.runwayLockSha256,
        verified_at: normalisedVerifiedAt,
      };
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:PLATFORM_SCHEDULE_DISARMED`;
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:SCHEDULE_DISARM_CONFIRMED`;
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState: "PLATFORM_SCHEDULE_DISARMED",
        eventReason: "youtube_remote_schedule_disarmed",
        retryabilityClass: "not_retryable",
        evidence: confirmedEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "SCHEDULE_DISARM_CONFIRMED",
        requestFingerprint: binding.requestFingerprint,
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed_private_unscheduled",
        verificationEvidence: confirmedEvidence,
      });
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "PLATFORM_SCHEDULE_DISARMED",
        externalId: normalisedExternalId,
        externalUrl: current.external_url,
        verificationStatus: "confirmed_private_unscheduled",
        verifiedAt: normalisedVerifiedAt,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const scheduledPlatformDisarmReconciliationTransaction =
    db.transaction(
      ({
        storyId,
        platform,
        channelId = null,
        idempotencyKey,
        externalId,
        scheduledFor,
        requestFingerprint,
        runwayLockSha256,
        error,
        disarmEvidence = null,
        now = new Date(),
      }) => {
        const identity = operationIdentity({
          storyId,
          platform,
          channelId,
          idempotencyKey,
        });
        const normalisedExternalId = requireText(
          externalId,
          "external_platform_id_required",
        );
        const binding = resolveScheduledPlatformDisarmBinding({
          storyId: identity.storyId,
          platform: identity.platform,
          externalId: normalisedExternalId,
          idempotencyKey: identity.idempotencyKey,
          scheduledFor,
          requestFingerprint,
          runwayLockSha256,
          now,
        });
        const ledgerKey =
          `${identity.idempotencyKey}:ledger:SCHEDULE_DISARM_UNCERTAIN`;
        const existing = getLedgerByIdempotency.get(
          identity.platform,
          ledgerKey,
        );
        if (!existing) {
          appendLedger({
            storyId: identity.storyId,
            channelId: identity.channelId,
            platform: identity.platform,
            idempotencyKey: ledgerKey,
            eventType: "SCHEDULE_DISARM_UNCERTAIN",
            requestFingerprint: binding.requestFingerprint,
            retryabilityClass: "verify_before_repeat_update",
            verificationStatus: "requires_reconciliation",
            verificationEvidence: {
              ...(disarmEvidence &&
              typeof disarmEvidence === "object" &&
              !Array.isArray(disarmEvidence)
                ? disarmEvidence
                : {}),
              story_id: identity.storyId,
              external_id: normalisedExternalId,
              scheduled_event_id: binding.scheduledEventId,
              scheduled_for: binding.scheduledFor,
              request_fingerprint: binding.requestFingerprint,
              runway_lock_sha256: binding.runwayLockSha256,
              error_code: cleanError(
                error?.code || error,
              ),
            },
          });
        }
        const current = getState(
          identity.storyId,
          identity.platform,
        );
        if (
          current?.lifecycle_state ===
          "RECONCILIATION_REQUIRED"
        ) {
          return current;
        }
        return failureTransaction({
          storyId: identity.storyId,
          channelId: identity.channelId,
          platform: identity.platform,
          idempotencyKey:
            `${identity.idempotencyKey}:schedule-disarm`,
          error,
          toState: "RECONCILIATION_REQUIRED",
          retryabilityClass: "verify_before_repeat_update",
        });
      },
    );

  const failureTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      error,
      toState,
      retryabilityClass = "verify_before_retry",
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const message = cleanError(error);
      const decisivePreCreateEvidence =
        toState === "DISPATCH_FAILED_BEFORE_CREATE"
          ? {
              platform_contacted: false,
              create_attempt_started: false,
              uncertain_external_creation: false,
              external_id: null,
            }
          : {};
      const lifecycleKey = `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: message,
        retryabilityClass,
        evidence: {
          error_recorded: true,
          ...decisivePreCreateEvidence,
        },
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass,
        verificationStatus: "requires_reconciliation",
        verificationEvidence: {
          error: message,
          ...decisivePreCreateEvidence,
        },
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: null,
        externalUrl: null,
        verificationStatus: "requires_reconciliation",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const confirmationFailureTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      error,
      verificationEvidence,
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      if (
        !verificationEvidence ||
        typeof verificationEvidence !== "object" ||
        Array.isArray(verificationEvidence) ||
        verificationEvidence.verification_attempted !== true
      ) {
        throw new Error("confirmation_failure_verification_evidence_required");
      }
      const before = getState(identity.storyId, identity.platform);
      if (!before?.external_id) {
        throw new Error("confirmation_failure_external_id_missing");
      }
      const suppliedExternalId = evidenceExternalId(verificationEvidence);
      if (suppliedExternalId && suppliedExternalId !== before.external_id) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      const message = cleanError(error);
      const failedEvidence = {
        ...verificationEvidence,
        error: message,
        external_id: before.external_id,
      };
      const toState = "PLATFORM_CREATED_CONFIRMATION_FAILED";
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: message,
        retryabilityClass: "verify_before_retry",
        evidence: failedEvidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass: "verify_before_retry",
        verificationStatus: "requires_reconciliation",
        verificationEvidence: failedEvidence,
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "requires_reconciliation",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const analyticsPendingTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      analyticsEvidence,
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      if (
        !analyticsEvidence ||
        typeof analyticsEvidence !== "object" ||
        Array.isArray(analyticsEvidence) ||
        analyticsEvidence.analytics_collection_requested !== true
      ) {
        throw new Error("analytics_pending_evidence_required");
      }
      const requestedAt = validEvidenceTimestamp(
        analyticsEvidence.requested_at,
        "analytics_pending_requested_at_required",
      ).toISOString();
      const toState = "ANALYTICS_PENDING";
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      const before = getState(identity.storyId, identity.platform);
      if (
        !before?.external_id ||
        (!existingLedger && before.verification_status !== "confirmed")
      ) {
        throw new Error("analytics_pending_confirmed_publication_required");
      }
      const evidence = {
        ...analyticsEvidence,
        external_id: before.external_id,
        requested_at: requestedAt,
      };
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: "analytics_collection_requested",
        retryabilityClass: "retryable",
        evidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass: "retryable",
        verificationStatus: "confirmed",
        verificationEvidence: evidence,
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "confirmed",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const analyticsCollectedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      analyticsEvidence,
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      if (
        !analyticsEvidence ||
        typeof analyticsEvidence !== "object" ||
        Array.isArray(analyticsEvidence) ||
        analyticsEvidence.analytics_collected !== true
      ) {
        throw new Error("analytics_collected_evidence_required");
      }
      const collectedAt = validEvidenceTimestamp(
        analyticsEvidence.collected_at,
        "analytics_collected_at_required",
      ).toISOString();
      const metrics = analyticsEvidence.metrics;
      if (
        !metrics ||
        typeof metrics !== "object" ||
        Array.isArray(metrics) ||
        Object.keys(metrics).length === 0
      ) {
        throw new Error("analytics_metrics_snapshot_required");
      }
      const sourceSnapshotId = requireText(
        analyticsEvidence.source_snapshot_id,
        "analytics_source_snapshot_id_required",
      );
      const toState = "ANALYTICS_COLLECTED";
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      const before = getState(identity.storyId, identity.platform);
      if (
        !before?.external_id ||
        (!existingLedger && before.verification_status !== "confirmed")
      ) {
        throw new Error("analytics_collected_confirmed_publication_required");
      }
      const evidence = {
        ...analyticsEvidence,
        collected_at: collectedAt,
        external_id: before.external_id,
        source_snapshot_id: sourceSnapshotId,
      };
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: "analytics_snapshot_collected",
        retryabilityClass: "not_retryable",
        evidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed",
        verificationEvidence: evidence,
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "confirmed",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const publishedQaIncidentTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      incidentEvidence,
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      if (
        !incidentEvidence ||
        typeof incidentEvidence !== "object" ||
        Array.isArray(incidentEvidence) ||
        incidentEvidence.qa_incident_detected !== true
      ) {
        throw new Error("published_qa_incident_evidence_required");
      }
      const incidentId = requireText(
        incidentEvidence.incident_id,
        "published_qa_incident_id_required",
      );
      const finding = requireText(
        incidentEvidence.finding,
        "published_qa_incident_finding_required",
      );
      const detectedAt = validEvidenceTimestamp(
        incidentEvidence.detected_at,
        "published_qa_incident_detected_at_required",
      ).toISOString();
      const severity = String(incidentEvidence.severity || "")
        .trim()
        .toLowerCase();
      if (!["low", "medium", "high", "critical"].includes(severity)) {
        throw new Error("published_qa_incident_severity_required");
      }
      const toState = "PUBLISHED_QA_INCIDENT";
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      const before = getState(identity.storyId, identity.platform);
      if (
        !before?.external_id ||
        (!existingLedger && before.verification_status !== "confirmed")
      ) {
        throw new Error("published_qa_incident_publication_required");
      }
      const evidence = {
        ...incidentEvidence,
        detected_at: detectedAt,
        external_id: before.external_id,
        finding,
        incident_id: incidentId,
        severity,
      };
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: finding,
        retryabilityClass: "operator_review_required",
        evidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass: "operator_review_required",
        verificationStatus: "confirmed",
        verificationEvidence: evidence,
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "confirmed",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const retractedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      actorId,
      operatorDecisionId,
      verifiedAt,
      retractionEvidence,
      now = new Date(),
    }) => {
      const identity = operationIdentity({
        storyId,
        platform,
        channelId,
        idempotencyKey,
      });
      const normalisedActorId = requireText(
        actorId,
        "retraction_operator_decision_required",
      );
      const normalisedDecisionId = Number(operatorDecisionId);
      const operatorAudit =
        Number.isInteger(normalisedDecisionId) && normalisedDecisionId > 0
          ? getAuditById.get(normalisedDecisionId)
          : null;
      if (
        !operatorAudit ||
        operatorAudit.actor_id !== normalisedActorId ||
        operatorAudit.action !== "retract_publication" ||
        operatorAudit.target_type !== "platform_publication" ||
        operatorAudit.target_id !==
          `${identity.storyId}:${identity.platform}` ||
        operatorAudit.decision !== "APPROVED"
      ) {
        throw new Error("retraction_operator_decision_required");
      }
      if (
        !retractionEvidence ||
        typeof retractionEvidence !== "object" ||
        Array.isArray(retractionEvidence) ||
        retractionEvidence.platform_retraction_verified !== true
      ) {
        throw new Error("platform_retraction_evidence_required");
      }
      const reason = requireText(
        retractionEvidence.reason,
        "platform_retraction_reason_required",
      );
      const before = getState(identity.storyId, identity.platform);
      if (!before?.external_id) {
        throw new Error("platform_retraction_external_id_missing");
      }
      if (evidenceExternalId(retractionEvidence) !== before.external_id) {
        throw new Error("platform_verification_external_id_mismatch");
      }
      const normalisedVerifiedAt = verifiedTimestamp(verifiedAt, { now });
      const evidence = {
        ...retractionEvidence,
        external_id: before.external_id,
        operator_decision_id: normalisedDecisionId,
        reason,
        verified_at: normalisedVerifiedAt,
      };
      const toState = "RETRACTED";
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:${toState}`;
      const ledgerKey = `${identity.idempotencyKey}:ledger:${toState}`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      appendSpecialisedLifecycle({
        storyId: identity.storyId,
        platform: identity.platform,
        toState,
        eventReason: reason,
        retryabilityClass: "not_retryable",
        actorType: "operator",
        actorId: normalisedActorId,
        operatorDecisionId: normalisedDecisionId,
        evidence,
        idempotencyKey: lifecycleKey,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: toState,
        retryabilityClass: "not_retryable",
        verificationStatus: "retracted",
        verificationEvidence: evidence,
        operatorDecisionId: String(normalisedDecisionId),
      });
      if (existingLedger) return getState(identity.storyId, identity.platform);
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: toState,
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "retracted",
        verifiedAt: normalisedVerifiedAt,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  const legacyReconciliationImportTransaction = db.transaction(
    ({
      storyId,
      channelId,
      platform,
      platformPostId,
      externalId,
      externalUrl = null,
      idempotencyKey,
      actorId,
      operatorDecisionId,
      evidence,
    }) => {
      const identity = operationIdentity({
        storyId,
        channelId,
        platform,
        idempotencyKey,
      });
      const normalisedActor = requireText(
        actorId,
        "legacy_reconciliation_operator_required",
      );
      const normalisedDecisionId = Number(operatorDecisionId);
      const operatorAudit =
        Number.isInteger(normalisedDecisionId) &&
        normalisedDecisionId > 0
          ? getAuditById.get(normalisedDecisionId)
          : null;
      if (
        !operatorAudit ||
        operatorAudit.actor_id !== normalisedActor
      ) {
        throw new Error(
          "legacy_reconciliation_operator_decision_required",
        );
      }
      const normalisedExternalId = requireText(
        externalId,
        "legacy_reconciliation_external_id_required",
      );
      const normalisedPostId = Number(platformPostId);
      if (!Number.isInteger(normalisedPostId) || normalisedPostId <= 0) {
        throw new Error("legacy_reconciliation_platform_post_required");
      }
      if (!evidence || typeof evidence !== "object") {
        throw new Error("legacy_reconciliation_evidence_required");
      }
      const importedEvidence = {
        ...evidence,
        legacy_state_import: true,
        platform_post_id: normalisedPostId,
      };
      const lifecycleKey =
        `${identity.idempotencyKey}:lifecycle:RECONCILIATION_REQUIRED`;
      const ledgerKey =
        `${identity.idempotencyKey}:ledger:LEGACY_RECONCILIATION_IMPORTED`;
      const existingLedger = getLedgerByIdempotency.get(
        identity.platform,
        ledgerKey,
      );
      if (existingLedger) {
        const existingLifecycle =
          getLifecycleByIdempotency.get(lifecycleKey);
        if (!existingLifecycle) {
          throw new Error("legacy_reconciliation_import_incomplete");
        }
        assertIdempotentMatch(
          existingLifecycle,
          {
            storyId: identity.storyId,
            platform: identity.platform,
            toState: "RECONCILIATION_REQUIRED",
          },
          [
            ["story_id", "storyId"],
            ["platform", "platform"],
            ["to_state", "toState"],
          ],
        );
        appendLedger({
          storyId: identity.storyId,
          channelId: identity.channelId,
          platform: identity.platform,
          idempotencyKey: ledgerKey,
          eventType: "LEGACY_RECONCILIATION_IMPORTED",
          externalId: normalisedExternalId,
          externalUrl,
          retryabilityClass: "never_retry_without_reconciliation",
          verificationStatus: "requires_reconciliation",
          verificationEvidence: importedEvidence,
          operatorDecisionId: String(normalisedDecisionId),
        });
        const current = getState(identity.storyId, identity.platform);
        if (!current) throw new Error("legacy_reconciliation_import_incomplete");
        return current;
      }
      if (getState(identity.storyId, identity.platform)) {
        throw new Error("legacy_reconciliation_import_requires_untracked_state");
      }
      if (getLifecycleByIdempotency.get(lifecycleKey)) {
        throw new Error("legacy_reconciliation_import_incomplete");
      }
      insertLifecycle.run({
        storyId: identity.storyId,
        platform: identity.platform,
        fromState: null,
        toState: "RECONCILIATION_REQUIRED",
        eventReason: "legacy_platform_post_requires_reconciliation",
        retryabilityClass: "never_retry_without_reconciliation",
        actorType: "operator",
        actorId: normalisedActor,
        evidenceJson: json(importedEvidence),
        idempotencyKey: lifecycleKey,
        publicationAuthorityAuditId: null,
      });
      const ledger = appendLedger({
        storyId: identity.storyId,
        channelId: identity.channelId,
        platform: identity.platform,
        idempotencyKey: ledgerKey,
        eventType: "LEGACY_RECONCILIATION_IMPORTED",
        externalId: normalisedExternalId,
        externalUrl,
        retryabilityClass: "never_retry_without_reconciliation",
        verificationStatus: "requires_reconciliation",
        verificationEvidence: importedEvidence,
        operatorDecisionId: String(normalisedDecisionId),
      });
      upsertState.run({
        storyId: identity.storyId,
        platform: identity.platform,
        lifecycleState: "RECONCILIATION_REQUIRED",
        externalId: normalisedExternalId,
        externalUrl,
        verificationStatus: "requires_reconciliation",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(identity.storyId, identity.platform);
    },
  );

  function recordOperatorDecision({
    actorId,
    action,
    targetType = null,
    targetId = null,
    decision = null,
    reason = null,
    evidence = null,
    idempotencyKey = null,
  }) {
    const normalisedActor = requireText(
      actorId,
      "operator_actor_and_action_required",
    );
    const normalisedAction = requireText(
      action,
      "operator_actor_and_action_required",
    );
    const normalisedKey = idempotencyKey
      ? requireText(idempotencyKey, "operator_audit_idempotency_key_required")
      : null;
    if (normalisedKey) {
      const existing = getAuditByIdempotency.get(normalisedKey);
      if (existing) {
        return assertIdempotentMatch(
          existing,
          {
            actorId: normalisedActor,
            action: normalisedAction,
            targetType,
            targetId,
            decision,
            reason,
            evidenceJson: json(evidence),
          },
          [
            ["actor_id", "actorId"],
            ["action", "action"],
            ["target_type", "targetType"],
            ["target_id", "targetId"],
            ["decision", "decision"],
            ["reason", "reason"],
            ["evidence_json", "evidenceJson"],
          ],
        );
      }
    }
    const info = insertAudit.run(
      normalisedActor,
      normalisedAction,
      targetType,
      targetId,
      decision,
      reason,
      json(evidence),
      normalisedKey,
    );
    return db
      .prepare("SELECT * FROM operator_audit_log WHERE id = ?")
      .get(info.lastInsertRowid);
  }

  function getPublicationAuthorityDecision(id) {
    const authorityId = Number(id);
    if (!Number.isInteger(authorityId) || authorityId <= 0) {
      throw new Error("publication_authority_audit_id_required");
    }
    return getPublicationAuthorityById.get(authorityId) || null;
  }

  function recordAutonomousPublicationAuthority({
    storyId,
    platform,
    authorityType,
    authorityBindingSha256,
    lifecycleIdempotencyKey,
    reason = null,
    evidence,
    idempotencyKey,
  }) {
    const normalisedStoryId = requireText(
      storyId,
      "publication_authority_story_required",
    );
    const normalisedPlatform = requireText(
      platform,
      "publication_authority_platform_required",
    );
    const normalisedAuthorityType = requireText(
      authorityType,
      "publication_authority_type_required",
    );
    const normalisedBinding = String(
      authorityBindingSha256 || "",
    )
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalisedBinding)) {
      throw new Error(
        "publication_authority_binding_sha256_required",
      );
    }
    const normalisedLifecycleKey = requireText(
      lifecycleIdempotencyKey,
      "publication_authority_lifecycle_idempotency_key_required",
    );
    const normalisedKey = requireText(
      idempotencyKey,
      "publication_authority_idempotency_key_required",
    );
    const normalisedReason = String(reason || "").trim() || null;
    if (
      !evidence ||
      typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      evidence.exact_candidate_bound !== true ||
      evidence.authority_binding_sha256 !== normalisedBinding
    ) {
      throw new Error(
        "publication_authority_exact_candidate_evidence_required",
      );
    }
    const evidenceJson = json(evidence);
    const expected = {
      storyId: normalisedStoryId,
      platform: normalisedPlatform,
      authorityType: normalisedAuthorityType,
      decision: "APPROVED",
      reason: normalisedReason,
      evidenceJson,
      authorityBindingSha256: normalisedBinding,
      lifecycleIdempotencyKey: normalisedLifecycleKey,
      idempotencyKey: normalisedKey,
    };
    const existing =
      getPublicationAuthorityByIdempotency.get(normalisedKey);
    if (existing) {
      return assertIdempotentMatch(existing, expected, [
        ["story_id", "storyId"],
        ["platform", "platform"],
        ["authority_type", "authorityType"],
        ["decision", "decision"],
        ["reason", "reason"],
        ["evidence_json", "evidenceJson"],
        ["authority_binding_sha256", "authorityBindingSha256"],
        ["lifecycle_idempotency_key", "lifecycleIdempotencyKey"],
        ["idempotency_key", "idempotencyKey"],
      ]);
    }
    if (
      getPublicationAuthorityByBinding.get(normalisedBinding) ||
      getPublicationAuthorityByLifecycleKey.get(
        normalisedLifecycleKey,
      )
    ) {
      throw new Error("publication_idempotency_conflict");
    }
    const info = insertPublicationAuthorityAudit.run(
      normalisedStoryId,
      normalisedPlatform,
      normalisedAuthorityType,
      normalisedReason,
      evidenceJson,
      normalisedBinding,
      normalisedLifecycleKey,
      normalisedKey,
    );
    return getPublicationAuthorityById.get(info.lastInsertRowid);
  }

  function listReconciliationCandidates({
    now = new Date(),
    staleDispatchAfterMs = DEFAULT_STALE_DISPATCH_AGE_MS,
  } = {}) {
    const effectiveNow = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(effectiveNow.getTime())) {
      throw new Error("valid_reconciliation_inventory_time_required");
    }
    const staleAfterMs = Number(staleDispatchAfterMs);
    if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
      throw new Error("valid_stale_dispatch_age_required");
    }
    const rows = db
      .prepare(
        `SELECT
           posts.id AS platform_post_id,
           posts.story_id,
           posts.channel_id,
           posts.platform,
           posts.status,
           posts.external_id,
           posts.external_url,
           posts.created_at,
           posts.updated_at,
           state.lifecycle_state,
           state.verification_status,
           state.updated_at AS state_updated_at,
           (
             SELECT events.event_reason
             FROM publication_lifecycle_events AS events
             WHERE events.story_id = posts.story_id
               AND events.platform = posts.platform
             ORDER BY events.id DESC
             LIMIT 1
           ) AS event_reason
         FROM platform_posts AS posts
         LEFT JOIN platform_publication_state AS state
           ON state.story_id = posts.story_id
          AND state.platform = posts.platform
         WHERE
           state.lifecycle_state IN (
             'RECONCILIATION_REQUIRED',
             'DISPATCH_STARTED'
           )
           OR (
             LOWER(posts.status) = 'failed'
             AND (
               NULLIF(TRIM(posts.external_id), '') IS NOT NULL
               OR NULLIF(TRIM(posts.external_url), '') IS NOT NULL
             )
           )
           OR (
             LOWER(posts.status) = 'published'
             AND NULLIF(TRIM(posts.external_id), '') IS NULL
           )
         ORDER BY
           COALESCE(state.updated_at, posts.updated_at, posts.created_at),
           posts.id`,
      )
      .all();
    const parseDatabaseTime = (value) => {
      const normalised = String(value || "").trim();
      if (!normalised) return null;
      const isoLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
        normalised,
      )
        ? `${normalised.replace(" ", "T")}Z`
        : normalised;
      const parsed = new Date(isoLike);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    return rows
      .map((row) => {
        const lifecycleState = String(row.lifecycle_state || "").trim();
        const identityPresent = Boolean(
          String(row.external_id || "").trim(),
        );
        const activityAt =
          row.state_updated_at || row.updated_at || row.created_at;
        const activityTime = parseDatabaseTime(activityAt);
        const ageMs = activityTime
          ? Math.max(0, effectiveNow.getTime() - activityTime.getTime())
          : null;
        const stale = ageMs !== null && ageMs >= staleAfterMs;
        let reason;
        let action;
        if (lifecycleState === "RECONCILIATION_REQUIRED") {
          reason = identityPresent
            ? "governed_reconciliation_required"
            : "governed_reconciliation_identity_missing";
          action = identityPresent
            ? "verify_platform_object"
            : "discover_platform_identity";
        } else if (lifecycleState === "DISPATCH_STARTED") {
          reason = "stale_dispatch_started";
          action = identityPresent
            ? "verify_platform_object"
            : "discover_platform_identity";
        } else if (
          String(row.status || "").toLowerCase() === "published"
        ) {
          reason = "published_projection_identity_missing";
          action = "operator_review";
        } else {
          reason = identityPresent
            ? "legacy_failed_with_platform_identity"
            : "legacy_failed_identity_missing";
          action = identityPresent
            ? "verify_platform_object"
            : "discover_platform_identity";
        }
        return {
          ...row,
          state:
            lifecycleState ||
            String(row.status || "unknown").trim().toUpperCase(),
          reason,
          age_seconds:
            ageMs === null ? null : Math.floor(ageMs / 1000),
          action,
          identity_present: identityPresent,
          is_stale: stale,
          activity_at: activityAt || null,
        };
      })
      .filter(
        (candidate) =>
          candidate.lifecycle_state !== "DISPATCH_STARTED" ||
          candidate.is_stale,
      );
  }

  return {
    appendLedger,
    appendLifecycle,
    assertPlatformScheduledBinding,
    cancelScheduledAdmissionBeforeDispatch(input) {
      return cancelScheduledAdmissionTransaction(input);
    },
    getState,
    getPublicationAuthorityDecision,
    getLatestLifecycleEvent(storyId, platform, toState = null) {
      const normalisedState = toState
        ? requireText(
            toState,
            "valid_lifecycle_story_platform_and_state_required",
          )
        : null;
      if (normalisedState && !knownState(normalisedState)) {
        throw new Error(
          "valid_lifecycle_story_platform_and_state_required",
        );
      }
      return (
        getLatestLifecycle.get(
          requireText(
            storyId,
            "valid_lifecycle_story_platform_and_state_required",
          ),
          requireText(
            platform,
            "valid_lifecycle_story_platform_and_state_required",
          ),
          normalisedState,
          normalisedState,
        ) || null
      );
    },
    listReconciliationCandidates,
    recordAnalyticsCollected(input) {
      return analyticsCollectedTransaction(input);
    },
    recordAnalyticsPending(input) {
      return analyticsPendingTransaction(input);
    },
    importLegacyReconciliationCandidate(input) {
      return legacyReconciliationImportTransaction(input);
    },
    prepareDispatch(input) {
      return prepareDispatchTransaction(input);
    },
    preparePrivateScheduledUpload(input) {
      return preparePrivateScheduledUploadTransaction(input);
    },
    recordAmbiguousDispatchFailure(input) {
      return failureTransaction({
        ...input,
        toState: "RECONCILIATION_REQUIRED",
        retryabilityClass: "verify_before_retry",
      });
    },
    recordAutonomousPublicationAuthority,
    recordOperatorDecision,
    recordPlatformConfirmed(input) {
      return confirmTransaction(input);
    },
    recordPlatformCreatedConfirmationFailed(input) {
      return confirmationFailureTransaction(input);
    },
    recordPlatformObjectCreated(input) {
      return objectCreatedTransaction(input);
    },
    recordPlatformScheduled(input) {
      return platformScheduledTransaction(input);
    },
    recordPrivateScheduledPlatformObjectCreated(input) {
      return privateScheduledObjectCreatedTransaction(input);
    },
    recordPrivateUnscheduledPlatformObjectVerified(input) {
      return privateUnscheduledObjectVerifiedTransaction(input);
    },
    recordPostCreateMetadataFailure(input) {
      return failureTransaction({
        ...input,
        toState: "PLATFORM_CREATED_METADATA_FAILED",
        retryabilityClass: "never_retry_without_reconciliation",
      });
    },
    recordPublishedQaIncident(input) {
      return publishedQaIncidentTransaction(input);
    },
    recordPreCreateFailure(input) {
      return failureTransaction({
        ...input,
        toState: "DISPATCH_FAILED_BEFORE_CREATE",
        retryabilityClass: "retryable_after_operator_review",
      });
    },
    recordPublished(input) {
      return publishedTransaction(input);
    },
    recordScheduledPlatformDisarmed(input) {
      return scheduledPlatformDisarmedTransaction(input);
    },
    recordScheduledPlatformDisarmReconciliationRequired(input) {
      return scheduledPlatformDisarmReconciliationTransaction(
        input,
      );
    },
    recordScheduledPlatformDisarmRequested(input) {
      return scheduledPlatformDisarmRequestedTransaction(input);
    },
    recordScheduledPlatformArmAttemptStarted(input) {
      return scheduledPlatformArmAttemptStartedTransaction(input);
    },
    recordScheduledPlatformReleaseCommitment(input) {
      return scheduledPlatformReleaseCommitmentTransaction(
        input,
      );
    },
    recordScheduledPlatformPublished(input) {
      return scheduledPlatformPublishedTransaction(input);
    },
    recordRetracted(input) {
      return retractedTransaction(input);
    },
    assertPrivateUnscheduledPlatformObjectBinding,
    assertScheduledPlatformReleaseCommitment,
    getScheduledPlatformArmAttempt,
    resolveScheduledPlatformDisarmBinding,
  };
}

function releaseProofClock(value, code) {
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(code);
  }
  return parsed;
}

function officialSourceBindingFromScheduledTicket(
  scheduledBinding,
  storyId,
) {
  const publicationEvidence =
    scheduledBinding?.scheduledTicketEvidence
      ?.publication_evidence;
  if (
    !publicationEvidence ||
    typeof publicationEvidence !== "object" ||
    Array.isArray(publicationEvidence)
  ) {
    throw new Error(
      "release_commitment_publication_evidence_required",
    );
  }
  return validateOfficialSourceReleaseBinding(
    publicationEvidence.official_source_release_binding,
    {
      storyId,
      sourceEvidenceSha256:
        publicationEvidence.source_evidence_sha256,
    },
  ).value;
}

function assertExactScheduleArmProof({
  proof,
  binding,
  externalId,
  boundaryTime,
}) {
  const invalid =
    !proof ||
    typeof proof !== "object" ||
    Array.isArray(proof) ||
    proof.schema_version !==
      "pulse-youtube-schedule-arm-proof-v1" ||
    String(proof.platform || "").trim() !== "youtube" ||
    proof.platform_object_confirmed !== true ||
    proof.schedule_arm_confirmed !== true ||
    proof.scheduled_release_confirmed !== true ||
    String(proof.external_id || "").trim() !== externalId ||
    String(proof.privacy_status || "")
      .trim()
      .toLowerCase() !== "private" ||
    String(proof.publish_at || "").trim() !==
      binding.scheduledFor ||
    proof.release_armed !== true ||
    proof.update_attempt_started !== true ||
    String(proof.before?.privacy_status || "")
      .trim()
      .toLowerCase() !== "private" ||
    proof.before?.publish_at !== null ||
    proof.before?.release_armed !== false;
  if (invalid) {
    throw new Error(
      "release_commitment_schedule_arm_proof_invalid",
    );
  }
  const checkedAt = validEvidenceTimestamp(
    proof.checked_at,
    "release_commitment_schedule_arm_proof_invalid",
  );
  const boundary = releaseProofClock(
    boundaryTime,
    "release_commitment_proof_clock_invalid",
  );
  const ageMs = boundary.getTime() - checkedAt.getTime();
  if (
    ageMs < 0 ||
    ageMs > MAX_T15_RELEASE_PROOF_AGE_MS ||
    checkedAt.getTime() >= Date.parse(binding.scheduledFor)
  ) {
    throw new Error(
      "release_commitment_schedule_arm_proof_invalid",
    );
  }
  return proof;
}

function assertExactOfficialSourceRevalidation({
  receipt,
  binding,
  storyId,
  platform,
  externalId,
  boundaryTime,
}) {
  const sourceBinding =
    officialSourceBindingFromScheduledTicket(
      binding,
      storyId,
    );
  const validated =
    validateOfficialSourceRevalidationReceipt(receipt, {
      binding: sourceBinding,
      storyId,
      platform,
      externalId,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
    }).value;
  const revalidatedAt = validEvidenceTimestamp(
    validated.revalidated_at,
    "release_commitment_source_revalidation_time_required",
  );
  const boundary = releaseProofClock(
    boundaryTime,
    "release_commitment_proof_clock_invalid",
  );
  const ageMs =
    boundary.getTime() - revalidatedAt.getTime();
  const runwayMs =
    Date.parse(binding.scheduledFor) -
    revalidatedAt.getTime();
  if (
    ageMs < 0 ||
    ageMs > MAX_T15_RELEASE_PROOF_AGE_MS ||
    runwayMs < 0 ||
    runwayMs > MAX_T15_RELEASE_PROOF_AGE_MS
  ) {
    throw new Error(
      "release_commitment_source_revalidation_not_fresh",
    );
  }
  return validated;
}

function assertExactT15ReleaseProofs({
  binding,
  storyId,
  platform,
  externalId,
  verificationEvidence,
  controlEvidence,
  boundaryTime,
}) {
  const sourceRevalidation =
    assertExactOfficialSourceRevalidation({
      receipt: controlEvidence?.source_revalidation,
      binding,
      storyId,
      platform,
      externalId,
      boundaryTime,
    });
  const scheduleArmProof = assertExactScheduleArmProof({
    proof: controlEvidence?.schedule_arm_proof,
    binding,
    externalId,
    boundaryTime,
  });
  if (
    json(verificationEvidence?.source_revalidation) !==
      json(sourceRevalidation) ||
    json(verificationEvidence?.schedule_arm_proof) !==
      json(scheduleArmProof) ||
    json(binding.evidence?.source_revalidation) !==
      json(sourceRevalidation) ||
    json(binding.evidence?.schedule_arm_proof) !==
      json(scheduleArmProof)
  ) {
    throw new Error(
      "release_commitment_t15_proof_binding_mismatch",
    );
  }
  return {
    sourceRevalidation,
    scheduleArmProof,
  };
}

module.exports = { PRE_DISPATCH_STATES, bind };
