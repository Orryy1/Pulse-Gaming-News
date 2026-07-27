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

function json(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function cleanError(error) {
  return String(error?.message || error || "unknown_error").slice(0, 1000);
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
      external_id = COALESCE(excluded.external_id, platform_publication_state.external_id),
      external_url = COALESCE(excluded.external_url, platform_publication_state.external_url),
      verification_status = COALESCE(
        excluded.verification_status,
        platform_publication_state.verification_status
      ),
      verified_at = COALESCE(excluded.verified_at, platform_publication_state.verified_at),
      last_event_id = COALESCE(excluded.last_event_id, platform_publication_state.last_event_id),
      updated_at = datetime('now')
  `);
  const insertAudit = db.prepare(`
    INSERT INTO operator_audit_log
      (actor_id, action, target_type, target_id, decision, reason, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  function getState(storyId, platform) {
    return getStateStatement.get(storyId, platform) || null;
  }

  function appendLifecycle({
    storyId,
    platform,
    toState,
    fromState,
    eventReason = null,
    retryabilityClass = null,
    actorType = "system",
    actorId = null,
    evidence = null,
    idempotencyKey,
  }) {
    if (!storyId || !platform || !knownState(toState)) {
      throw new Error("valid_lifecycle_story_platform_and_state_required");
    }
    if (!idempotencyKey) throw new Error("lifecycle_idempotency_key_required");
    const existing = getLifecycleByIdempotency.get(idempotencyKey);
    if (existing) return existing;
    const current = getState(storyId, platform);
    const actualFrom =
      fromState === undefined ? current?.lifecycle_state || null : fromState;
    if (actualFrom) assertTransition(actualFrom, toState);
    else if (toState !== "DISCOVERED") {
      throw new Error(`initial_lifecycle_state_must_be_discovered:${toState}`);
    }
    const info = insertLifecycle.run({
      storyId,
      platform,
      fromState: actualFrom,
      toState,
      eventReason,
      retryabilityClass,
      actorType,
      actorId,
      evidenceJson: json(evidence),
      idempotencyKey,
    });
    // PUBLISHED has a stricter projection trigger: the external ID,
    // confirmation verdict and verification timestamp must be committed
    // together by recordPublished(). Avoid an intermediate unverified
    // PUBLISHED projection while still retaining the immutable event.
    if (toState !== "PUBLISHED") {
      upsertState.run({
        storyId,
        platform,
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

  function appendLedger({
    storyId,
    channelId = null,
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
    const existing = getLedgerByIdempotency.get(platform, idempotencyKey);
    if (existing) return existing;
    const info = insertLedger.run({
      storyId,
      channelId,
      platform,
      idempotencyKey,
      eventType,
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
    }) => {
      if (!idempotencyKey) throw new Error("dispatch_idempotency_key_required");
      let state = getState(storyId, platform);
      const startIndex = state
        ? PRE_DISPATCH_STATES.indexOf(state.lifecycle_state) + 1
        : 0;
      if (state && startIndex === 0) {
        throw new Error(
          `dispatch_not_allowed_from_state:${state.lifecycle_state}`,
        );
      }
      for (let index = startIndex; index < PRE_DISPATCH_STATES.length; index += 1) {
        const toState = PRE_DISPATCH_STATES[index];
        appendLifecycle({
          storyId,
          platform,
          toState,
          eventReason:
            toState === "DISPATCH_STARTED"
              ? "guarded_dispatch_started"
              : "pre_dispatch_evidence_backfill",
          actorType: actorId ? "operator" : "system",
          actorId,
          evidence,
          idempotencyKey: `${idempotencyKey}:lifecycle:${toState}`,
        });
      }
      const ledger = appendLedger({
        storyId,
        channelId,
        platform,
        idempotencyKey: `${idempotencyKey}:ledger:DISPATCH_STARTED`,
        eventType: "DISPATCH_STARTED",
        requestFingerprint,
        retryabilityClass: "verify_before_retry",
      });
      upsertState.run({
        storyId,
        platform,
        lifecycleState: "DISPATCH_STARTED",
        externalId: null,
        externalUrl: null,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(storyId, platform);
    },
  );

  function prepareDispatch(input) {
    return prepareDispatchTransaction(input);
  }

  const objectCreatedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      externalId,
      externalUrl = null,
    }) => {
      if (!externalId) throw new Error("external_platform_id_required");
      appendLifecycle({
        storyId,
        platform,
        toState: "PLATFORM_OBJECT_CREATED",
        eventReason: "platform_adapter_returned_external_id",
        evidence: { external_id_recorded: true },
        idempotencyKey: `${idempotencyKey}:lifecycle:PLATFORM_OBJECT_CREATED`,
      });
      const ledger = appendLedger({
        storyId,
        channelId,
        platform,
        idempotencyKey: `${idempotencyKey}:ledger:PLATFORM_OBJECT_CREATED`,
        eventType: "PLATFORM_OBJECT_CREATED",
        externalId,
        externalUrl,
        retryabilityClass: "never_retry_without_reconciliation",
        verificationStatus: "pending",
      });
      upsertState.run({
        storyId,
        platform,
        lifecycleState: "PLATFORM_OBJECT_CREATED",
        externalId,
        externalUrl,
        verificationStatus: "pending",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(storyId, platform);
    },
  );

  function recordPlatformObjectCreated(input) {
    return objectCreatedTransaction(input);
  }

  const confirmTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      verificationEvidence,
    }) => {
      appendLifecycle({
        storyId,
        platform,
        toState: "PLATFORM_CONFIRMED",
        eventReason: "platform_response_verified",
        evidence: verificationEvidence,
        idempotencyKey: `${idempotencyKey}:lifecycle:PLATFORM_CONFIRMED`,
      });
      const ledger = appendLedger({
        storyId,
        channelId,
        platform,
        idempotencyKey: `${idempotencyKey}:ledger:PLATFORM_CONFIRMED`,
        eventType: "PLATFORM_CONFIRMED",
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed",
        verificationEvidence,
      });
      upsertState.run({
        storyId,
        platform,
        lifecycleState: "PLATFORM_CONFIRMED",
        externalId: null,
        externalUrl: null,
        verificationStatus: "confirmed",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(storyId, platform);
    },
  );

  function recordPlatformConfirmed(input) {
    return confirmTransaction(input);
  }

  const publishedTransaction = db.transaction(
    ({
      storyId,
      platform,
      channelId = null,
      idempotencyKey,
      verifiedAt = new Date().toISOString(),
      verificationEvidence = null,
    }) => {
      const before = getState(storyId, platform);
      if (!before?.external_id) throw new Error("published_external_id_missing");
      appendLifecycle({
        storyId,
        platform,
        toState: "PUBLISHED",
        eventReason: "platform_object_confirmed_public",
        evidence: verificationEvidence,
        idempotencyKey: `${idempotencyKey}:lifecycle:PUBLISHED`,
      });
      const ledger = appendLedger({
        storyId,
        channelId,
        platform,
        idempotencyKey: `${idempotencyKey}:ledger:PUBLISHED`,
        eventType: "PUBLISHED",
        retryabilityClass: "not_retryable",
        verificationStatus: "confirmed",
        verificationEvidence,
      });
      upsertState.run({
        storyId,
        platform,
        lifecycleState: "PUBLISHED",
        externalId: before.external_id,
        externalUrl: before.external_url,
        verificationStatus: "confirmed",
        verifiedAt,
        lastEventId: ledger.id,
      });
      return getState(storyId, platform);
    },
  );

  function recordPublished(input) {
    return publishedTransaction(input);
  }

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
      const message = cleanError(error);
      appendLifecycle({
        storyId,
        platform,
        toState,
        eventReason: message,
        retryabilityClass,
        evidence: { error_recorded: true },
        idempotencyKey: `${idempotencyKey}:lifecycle:${toState}`,
      });
      const ledger = appendLedger({
        storyId,
        channelId,
        platform,
        idempotencyKey: `${idempotencyKey}:ledger:${toState}`,
        eventType: toState,
        retryabilityClass,
        verificationStatus: "requires_reconciliation",
        verificationEvidence: { error: message },
      });
      upsertState.run({
        storyId,
        platform,
        lifecycleState: toState,
        externalId: null,
        externalUrl: null,
        verificationStatus: "requires_reconciliation",
        verifiedAt: null,
        lastEventId: ledger.id,
      });
      return getState(storyId, platform);
    },
  );

  function recordAmbiguousDispatchFailure(input) {
    return failureTransaction({
      ...input,
      toState: "RECONCILIATION_REQUIRED",
      retryabilityClass: "verify_before_retry",
    });
  }

  function recordPreCreateFailure(input) {
    return failureTransaction({
      ...input,
      toState: "DISPATCH_FAILED_BEFORE_CREATE",
      retryabilityClass: "retryable_after_operator_review",
    });
  }

  function recordPostCreateMetadataFailure(input) {
    return failureTransaction({
      ...input,
      toState: "PLATFORM_CREATED_METADATA_FAILED",
      retryabilityClass: "never_retry_without_reconciliation",
    });
  }

  function recordOperatorDecision({
    actorId,
    action,
    targetType = null,
    targetId = null,
    decision = null,
    reason = null,
    evidence = null,
  }) {
    if (!actorId || !action) throw new Error("operator_actor_and_action_required");
    const info = insertAudit.run(
      actorId,
      action,
      targetType,
      targetId,
      decision,
      reason,
      json(evidence),
    );
    return db
      .prepare("SELECT * FROM operator_audit_log WHERE id = ?")
      .get(info.lastInsertRowid);
  }

  function listReconciliationCandidates() {
    return db
      .prepare(
        `SELECT
           posts.id,
           posts.story_id,
           posts.platform,
           posts.status,
           posts.external_id IS NOT NULL AS has_external_id,
           posts.external_url IS NOT NULL AS has_external_url,
           posts.updated_at
         FROM platform_posts AS posts
         WHERE
           (LOWER(posts.status) = 'failed' AND (
             posts.external_id IS NOT NULL OR posts.external_url IS NOT NULL
           ))
           OR (
             LOWER(posts.status) = 'published'
             AND posts.external_id IS NULL
             AND posts.external_url IS NULL
           )
         ORDER BY posts.updated_at, posts.id`,
      )
      .all();
  }

  return {
    appendLedger,
    appendLifecycle,
    getState,
    listReconciliationCandidates,
    prepareDispatch,
    recordAmbiguousDispatchFailure,
    recordOperatorDecision,
    recordPlatformConfirmed,
    recordPlatformObjectCreated,
    recordPostCreateMetadataFailure,
    recordPreCreateFailure,
    recordPublished,
  };
}

module.exports = { PRE_DISPATCH_STATES, bind };
