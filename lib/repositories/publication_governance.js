"use strict";

const {
  assertTransition,
  knownState,
} = require("../stabilisation/publication-lifecycle");

const PRE_DISPATCH_STATES = Object.freeze([
  "DISCOVERED",
  "VERIFIED",
  "EDITORIALLY_APPROVED",
  "SCRIPT_READY",
  "ASSETS_CLEARED",
  "RENDERED",
  "QA_PASSED",
  "HUMAN_APPROVED",
  "SCHEDULED",
  "DISPATCH_STARTED",
]);
const DIRECT_LIFECYCLE_STATES = new Set(
  PRE_DISPATCH_STATES.filter((state) => state !== "DISPATCH_STARTED"),
);
const MAX_PLATFORM_VERIFICATION_AGE_MS = 60 * 60 * 1000;
const MAX_CONTROL_TOWER_EVIDENCE_AGE_MS = 15 * 60 * 1000;
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
       idempotency_key)
    VALUES
      (@storyId, @platform, @fromState, @toState, @eventReason,
       @retryabilityClass, @actorType, @actorId, @evidenceJson,
       @idempotencyKey)
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

  function getState(storyId, platform) {
    return getStateStatement.get(storyId, platform) || null;
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
    const normalisedKey = requireText(
      idempotencyKey,
      "lifecycle_idempotency_key_required",
    );
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
        evidence: { error_recorded: true },
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
        verificationEvidence: { error: message },
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
    getState,
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
    recordAmbiguousDispatchFailure(input) {
      return failureTransaction({
        ...input,
        toState: "RECONCILIATION_REQUIRED",
        retryabilityClass: "verify_before_retry",
      });
    },
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
    recordRetracted(input) {
      return retractedTransaction(input);
    },
  };
}

module.exports = { PRE_DISPATCH_STATES, bind };
