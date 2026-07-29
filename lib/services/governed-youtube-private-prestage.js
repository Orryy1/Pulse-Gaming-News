"use strict";

const {
  resolveYoutubeScheduledPublishAt,
} = require("./youtube-scheduled-release-contract");

function text(value) {
  return String(value ?? "").trim();
}

function readClock(value) {
  const resolved =
    typeof value === "function"
      ? value()
      : value === null || value === undefined
        ? new Date()
        : value;
  const date =
    resolved instanceof Date
      ? new Date(resolved.getTime())
      : new Date(resolved);
  if (Number.isNaN(date.getTime())) {
    throw new Error("youtube_private_prestage_clock_invalid");
  }
  return date;
}

function requiredFunction(value, code) {
  if (typeof value !== "function") throw new Error(code);
  return value;
}

function verificationClock(verifiedAt, startedAt) {
  const observed = new Date(verifiedAt);
  if (Number.isNaN(observed.getTime())) {
    throw new Error("youtube_private_prestage_verification_time_invalid");
  }
  if (observed.getTime() - startedAt.getTime() > 5 * 60 * 1000) {
    throw new Error("youtube_private_prestage_verification_time_drifted");
  }
  return observed.getTime() > startedAt.getTime()
    ? observed
    : startedAt;
}

function publicProcessed(evidence) {
  return (
    evidence &&
    typeof evidence === "object" &&
    (evidence.public === true ||
      text(evidence.visibility).toLowerCase() === "public" ||
      text(evidence.privacy_status).toLowerCase() === "public") &&
    text(evidence.upload_status).toLowerCase() === "processed"
  );
}

function privateScheduledProcessed(evidence, scheduledFor) {
  let publishAt = null;
  try {
    publishAt = evidence?.publish_at
      ? new Date(evidence.publish_at).toISOString()
      : null;
  } catch {
    publishAt = null;
  }
  return (
    evidence &&
    typeof evidence === "object" &&
    evidence.platform_object_confirmed === true &&
    evidence.scheduled_release_confirmed === true &&
    text(evidence.privacy_status).toLowerCase() === "private" &&
    publishAt === scheduledFor &&
    text(evidence.upload_status).toLowerCase() === "processed" &&
    text(evidence.processing_status).toLowerCase() === "succeeded"
  );
}

function privateUnscheduledProcessed(evidence) {
  return (
    evidence &&
    typeof evidence === "object" &&
    evidence.platform_object_confirmed === true &&
    evidence.scheduled_release_confirmed === false &&
    text(evidence.privacy_status).toLowerCase() === "private" &&
    evidence.publish_at === null &&
    text(evidence.upload_status).toLowerCase() === "processed" &&
    text(evidence.processing_status).toLowerCase() === "succeeded"
  );
}

const PRE_T15_CONTAINMENT_REASONS = new Set([
  "youtube_private_object_published_early",
  "youtube_private_object_privacy_not_private",
  "youtube_private_object_unexpected_publish_at",
  "youtube_private_object_publish_at_invalid",
]);

function exactContainmentProof(
  result,
  { externalId, containmentReason },
) {
  const evidence = result?.evidence;
  return (
    result?.confirmed === true &&
    result?.emergencyContainment === true &&
    result?.compensationConfirmed === true &&
    text(result.externalId) === externalId &&
    evidence?.schema_version ===
      "pulse-youtube-schedule-disarm-proof-v1" &&
    evidence.platform === "youtube" &&
    evidence.platform_object_confirmed === true &&
    evidence.schedule_disarm_confirmed === true &&
    text(evidence.external_id) === externalId &&
    text(evidence.privacy_status).toLowerCase() === "private" &&
    evidence.publish_at === null &&
    evidence.publish_at_present === false &&
    evidence.publish_at_invalid === false &&
    evidence.emergency_containment === true &&
    text(evidence.containment_reason) === containmentReason
  );
}

function attachCompensationMetadata(error, compensation) {
  error.compensationRequired =
    compensation.required === true;
  error.compensationAttempted =
    compensation.attempted === true;
  error.compensationConfirmed =
    compensation.confirmed === true;
  error.remoteContainmentRequired =
    compensation.required === true &&
    compensation.confirmed !== true;
  error.remoteDisarmRequired =
    error.remoteContainmentRequired;
  error.compensation = compensation;
  return error;
}

function sourceRevision(value, code) {
  const result = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(code);
  }
  return result;
}

function validateOfficialSourceRevalidation({
  value,
  expectedSourceRevisionSha256,
  now,
  scheduledFor,
}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("youtube_tminus15_source_revalidation_required");
  }
  if (
    value.schema_version !==
    "pulse-official-source-revalidation-v1"
  ) {
    throw new Error(
      "youtube_tminus15_source_revalidation_schema_invalid",
    );
  }
  if (
    value.official_source !== true ||
    value.unchanged !== true ||
    value.claims_match !== true
  ) {
    throw new Error(
      "youtube_tminus15_official_source_changed_or_unconfirmed",
    );
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(text(value.source_url));
  } catch {
    throw new Error(
      "youtube_tminus15_official_source_url_invalid",
    );
  }
  if (sourceUrl.protocol !== "https:") {
    throw new Error(
      "youtube_tminus15_official_source_url_invalid",
    );
  }
  const expectedRevision = sourceRevision(
    expectedSourceRevisionSha256,
    "youtube_tminus15_expected_source_revision_required",
  );
  const observedRevision = sourceRevision(
    value.source_revision_sha256,
    "youtube_tminus15_source_revision_required",
  );
  if (observedRevision !== expectedRevision) {
    throw new Error(
      "youtube_tminus15_source_revision_mismatch",
    );
  }
  const revalidatedAt = new Date(value.revalidated_at);
  if (
    Number.isNaN(revalidatedAt.getTime()) ||
    revalidatedAt.toISOString() !== value.revalidated_at
  ) {
    throw new Error(
      "youtube_tminus15_source_revalidation_time_invalid",
    );
  }
  const ageMs = now.getTime() - revalidatedAt.getTime();
  const runwayMs =
    Date.parse(scheduledFor) - revalidatedAt.getTime();
  if (
    ageMs < 0 ||
    ageMs > 15 * 60 * 1000 ||
    runwayMs < 0 ||
    runwayMs > 15 * 60 * 1000
  ) {
    throw new Error(
      "youtube_tminus15_source_revalidation_not_fresh",
    );
  }
  return {
    ...value,
    source_url: sourceUrl.toString(),
    source_revision_sha256: observedRevision,
    revalidated_at: revalidatedAt.toISOString(),
  };
}

function assertDependencies({ db, platformPosts, governance }) {
  if (!db || typeof db.transaction !== "function") {
    throw new Error("youtube_private_prestage_database_required");
  }
  for (const [value, method, code] of [
    [
      platformPosts,
      "ensurePending",
      "youtube_private_prestage_platform_posts_required",
    ],
    [
      platformPosts,
      "getByStoryPlatform",
      "youtube_private_prestage_platform_posts_required",
    ],
    [
      platformPosts,
      "anchorExternalObject",
      "youtube_private_prestage_platform_posts_required",
    ],
    [
      platformPosts,
      "markFailed",
      "youtube_private_prestage_platform_posts_required",
    ],
    [
      platformPosts,
      "markPublished",
      "youtube_private_prestage_platform_posts_required",
    ],
    [
      governance,
      "getState",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "preparePrivateScheduledUpload",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordPrivateScheduledPlatformObjectCreated",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordPrivateUnscheduledPlatformObjectVerified",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "assertPrivateUnscheduledPlatformObjectBinding",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordPlatformScheduled",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordPlatformCreatedConfirmationFailed",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "assertPlatformScheduledBinding",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordScheduledPlatformPublished",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordAmbiguousDispatchFailure",
      "youtube_private_prestage_governance_required",
    ],
    [
      governance,
      "recordPreCreateFailure",
      "youtube_private_prestage_governance_required",
    ],
  ]) {
    if (!value || typeof value[method] !== "function") {
      throw new Error(code);
    }
  }
}

class YoutubePrivatePrestageReconciliationRequiredError extends Error {
  constructor({ externalId = null, lifecycleState = null } = {}) {
    super("youtube_private_prestage_reconciliation_required");
    this.name = "YoutubePrivatePrestageReconciliationRequiredError";
    this.code = "youtube_private_prestage_reconciliation_required";
    this.externalId = externalId;
    this.lifecycleState = lifecycleState;
  }
}

function reconciliationError(governance, storyId, externalId = null) {
  const state = governance.getState(storyId, "youtube");
  return new YoutubePrivatePrestageReconciliationRequiredError({
    externalId: externalId || state?.external_id || null,
    lifecycleState: state?.lifecycle_state || null,
  });
}

function anchoredPrivateObjectResult({
  governance,
  platformPosts,
  binding,
  state = null,
  reused = false,
}) {
  const governanceState =
    state || governance.getState(binding.storyId, "youtube");
  const platformPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  const externalId = text(
    governanceState?.external_id || platformPost?.external_id,
  );
  if (
    governanceState?.lifecycle_state !== "PLATFORM_OBJECT_CREATED" ||
    !platformPost ||
    !externalId ||
    (platformPost.external_id &&
      text(platformPost.external_id) !== externalId)
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
  }
  return {
    status: "platform_object_created",
    lifecycleState: "PLATFORM_OBJECT_CREATED",
    releaseState: "private_unscheduled",
    scheduled: false,
    releaseArmed: false,
    verificationPending:
      governanceState.verification_status !==
      "private_unscheduled_processed",
    reused,
    externalId,
    externalUrl:
      text(
        governanceState.external_url ||
          platformPost.external_url,
      ) || null,
    platformPost,
    governanceState,
  };
}

function exactBinding(input, now) {
  if (text(input.platform) !== "youtube") {
    throw new Error("youtube_private_prestage_platform_mismatch");
  }
  return {
    scheduledFor: resolveYoutubeScheduledPublishAt(
      input.scheduledFor,
      { now, requireFuture: false },
    ),
    storyId: text(input.storyId),
    channelId: text(input.channelId),
    platform: "youtube",
    idempotencyKey: text(input.idempotencyKey),
    requestFingerprint: text(input.requestFingerprint).toLowerCase(),
    runwayLockSha256: text(input.runwayLockSha256).toLowerCase(),
  };
}

function resolveGovernedYoutubePlatformScheduledBinding(input = {}) {
  const governance = input.governance;
  if (
    !governance ||
    typeof governance.getState !== "function" ||
    typeof governance.assertPlatformScheduledBinding !== "function"
  ) {
    throw new Error("youtube_private_prestage_governance_required");
  }
  const now = readClock(input.now);
  const binding = exactBinding(input, now);
  const state = governance.getState(binding.storyId, "youtube");
  const externalId = text(input.externalId || state?.external_id);
  const persisted = governance.assertPlatformScheduledBinding({
    storyId: binding.storyId,
    platform: "youtube",
    externalId,
    idempotencyKey: binding.idempotencyKey,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
  });
  return {
    story_id: persisted.storyId,
    external_id: persisted.externalId,
    scheduled_for: persisted.scheduledFor,
    publish_at: persisted.publishAt,
    request_fingerprint: persisted.requestFingerprint,
    runway_lock_sha256: persisted.runwayLockSha256,
    scheduled_event_id: persisted.scheduledEventId,
    platform_scheduled_event_id:
      persisted.platformScheduledEventId,
  };
}

async function verifyAnchoredPrivateSchedule({
  db,
  platformPosts,
  governance,
  binding,
  verifyScheduled,
  assertHealthy,
  now,
}) {
  const state = governance.getState(binding.storyId, "youtube");
  const platformPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  const externalId = text(
    state?.external_id || platformPost?.external_id,
  );
  if (
    state?.lifecycle_state !== "PLATFORM_OBJECT_CREATED" ||
    !platformPost ||
    !externalId ||
    (platformPost.external_id &&
      text(platformPost.external_id) !== externalId)
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
  }
  let verification;
  try {
    assertHealthy();
    verification = await verifyScheduled({
      platform: "youtube",
      storyId: binding.storyId,
      externalId,
      scheduledFor: binding.scheduledFor,
    });
    assertHealthy();
  } catch (error) {
    return {
      status: "verification_pending",
      scheduled: false,
      externalId,
      reason: text(error?.code || error?.message) || "verification_error",
      platformPost,
      governanceState: state,
    };
  }
  const verificationExternalId = text(verification?.externalId);
  const verificationScheduledFor = text(verification?.scheduledFor);
  const identityMismatch =
    verificationExternalId !== externalId ||
    verificationScheduledFor !== binding.scheduledFor;
  if (verification?.confirmed !== true || identityMismatch) {
    const incidentRequired =
      verification?.incident_required === true || identityMismatch;
    if (incidentRequired) {
      const incident = new Error(
        `youtube_private_schedule_incident:${
          text(verification?.reason) || "binding_mismatch"
        }`,
      );
      platformPosts.markFailed(platformPost.id, incident, {
        externalId,
        externalUrl: platformPost.external_url,
      });
      governance.recordPlatformCreatedConfirmationFailed({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error: incident,
        verificationEvidence: {
          ...(verification?.evidence || {}),
          verification_attempted: true,
          verification_result_received: true,
          external_id: externalId,
        },
      });
      governance.recordAmbiguousDispatchFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error: incident,
      });
      throw reconciliationError(
        governance,
        binding.storyId,
        externalId,
      );
    }
    return {
      status: "verification_pending",
      scheduled: false,
      externalId,
      reason: text(verification?.reason) || "schedule_not_yet_verified",
      verification,
      platformPost,
      governanceState: state,
    };
  }
  const verificationEvidence = {
    ...(verification.evidence || {}),
    external_id: externalId,
  };
  const verificationNow = verificationClock(
    verification.verifiedAt,
    now,
  );
  const stagedState = governance.recordPlatformScheduled({
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    externalId,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    verifiedAt: verification.verifiedAt,
    verificationEvidence,
    now: verificationNow,
  });
  return {
    status: "platform_scheduled",
    scheduled: true,
    externalId,
    externalUrl:
      text(verification.externalUrl) ||
      text(platformPost.external_url) ||
      null,
    verification,
    platformPost: platformPosts.getByStoryPlatform(
      binding.storyId,
      "youtube",
    ),
    governanceState: stagedState,
  };
}

async function verifyAnchoredPrivateObject({
  platformPosts,
  governance,
  binding,
  verifyPrivate,
  containUnexpectedObject,
  assertHealthy,
  now,
}) {
  const state = governance.getState(binding.storyId, "youtube");
  const platformPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  const externalId = text(
    state?.external_id || platformPost?.external_id,
  );
  if (
    state?.lifecycle_state !== "PLATFORM_OBJECT_CREATED" ||
    !platformPost ||
    !externalId ||
    (platformPost.external_id &&
      text(platformPost.external_id) !== externalId)
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
  }
  let verification;
  try {
    assertHealthy();
    verification = await verifyPrivate({
      platform: "youtube",
      storyId: binding.storyId,
      externalId,
    });
    assertHealthy();
  } catch (error) {
    return {
      status: "verification_pending",
      scheduled: false,
      releaseArmed: false,
      externalId,
      reason:
        text(error?.code || error?.message) || "verification_error",
      platformPost,
      governanceState: state,
    };
  }
  const verificationExternalId = text(verification?.externalId);
  const identityMismatch = verificationExternalId !== externalId;
  const exactProof =
    verification?.confirmed === true &&
    !identityMismatch &&
    privateUnscheduledProcessed(verification?.evidence);
  if (!exactProof) {
    const incidentRequired =
      verification?.incident_required === true || identityMismatch;
    if (incidentRequired) {
      const containmentReason = text(
        verification?.reason ||
          verification?.evidence?.reason,
      );
      const containmentEligible =
        !identityMismatch &&
        verification?.evidence?.platform_object_confirmed === true &&
        PRE_T15_CONTAINMENT_REASONS.has(
          containmentReason,
        );
      const compensation = {
        schema_version:
          "pulse-youtube-pre-t15-containment-v1",
        required: containmentEligible,
        attempted: false,
        confirmed: false,
        reason: containmentEligible
          ? containmentReason
          : null,
        external_id: externalId,
        observed: verification?.evidence || null,
        evidence: null,
        failure: null,
      };
      if (containmentEligible) {
        if (typeof containUnexpectedObject !== "function") {
          compensation.failure =
            "youtube_pre_t15_containment_handler_required";
        } else {
          compensation.attempted = true;
          try {
            const containment =
              await containUnexpectedObject({
                platform: "youtube",
                storyId: binding.storyId,
                externalId,
                scheduledFor: binding.scheduledFor,
                emergencyContainment: true,
                containmentReason,
                observation: verification.evidence,
                assertUpdateBoundary() {
                  const currentState = governance.getState(
                    binding.storyId,
                    "youtube",
                  );
                  const currentPost =
                    platformPosts.getByStoryPlatform(
                      binding.storyId,
                      "youtube",
                    );
                  if (
                    currentState?.lifecycle_state !==
                      "PLATFORM_OBJECT_CREATED" ||
                    text(currentState.external_id) !==
                      externalId ||
                    text(currentPost?.external_id) !==
                      externalId
                  ) {
                    throw new Error(
                      "youtube_pre_t15_containment_binding_changed",
                    );
                  }
                },
                markUpdateAttemptStarted() {
                  compensation.attempted = true;
                },
              });
            compensation.confirmed =
              exactContainmentProof(containment, {
                externalId,
                containmentReason,
              });
            compensation.evidence =
              containment?.evidence || null;
            if (!compensation.confirmed) {
              compensation.failure =
                "youtube_pre_t15_containment_proof_invalid";
            }
          } catch (error) {
            compensation.failure =
              text(error?.code || error?.message) ||
              "youtube_pre_t15_containment_failed";
          }
        }
      }
      const incident = new Error(
        `youtube_private_unscheduled_incident:${
          text(verification?.reason) || "binding_mismatch"
        }`,
      );
      attachCompensationMetadata(incident, compensation);
      if (compensation.confirmed === true) {
        const contained = reconciliationError(
          governance,
          binding.storyId,
          externalId,
        );
        contained.code =
          "youtube_pre_t15_emergency_containment_confirmed";
        contained.cause = incident;
        throw attachCompensationMetadata(
          contained,
          compensation,
        );
      }
      platformPosts.markFailed(platformPost.id, incident, {
        externalId,
        externalUrl: platformPost.external_url,
      });
      governance.recordPlatformCreatedConfirmationFailed({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error: incident,
        verificationEvidence: {
          ...(verification?.evidence || {}),
          verification_attempted: true,
          verification_result_received: true,
          external_id: externalId,
          pre_t15_containment: compensation,
        },
      });
      governance.recordAmbiguousDispatchFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error: incident,
      });
      throw attachCompensationMetadata(
        reconciliationError(
          governance,
          binding.storyId,
          externalId,
        ),
        compensation,
      );
    }
    return {
      status: "verification_pending",
      scheduled: false,
      releaseArmed: false,
      externalId,
      reason:
        text(verification?.reason) ||
        "private_unscheduled_not_yet_verified",
      verification,
      platformPost,
      governanceState: state,
    };
  }
  const verificationNow = verificationClock(
    verification.verifiedAt,
    now,
  );
  const verifiedState =
    governance.recordPrivateUnscheduledPlatformObjectVerified({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      externalId,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
      verifiedAt: verification.verifiedAt,
      verificationEvidence: {
        ...(verification.evidence || {}),
        external_id: externalId,
      },
      now: verificationNow,
    });
  return {
    status: "private_object_verified",
    scheduled: false,
    releaseArmed: false,
    externalId,
    externalUrl:
      text(verification.externalUrl) ||
      text(platformPost.external_url) ||
      null,
    verification,
    platformPost: platformPosts.getByStoryPlatform(
      binding.storyId,
      "youtube",
    ),
    governanceState: verifiedState,
  };
}

async function prestageGovernedYoutubeRelease(input = {}) {
  assertDependencies(input);
  const uploadScheduled = requiredFunction(
    input.uploadScheduled,
    "youtube_private_prestage_uploader_required",
  );
  const assertHealthy = requiredFunction(
    input.assertLeaseHealthy,
    "youtube_private_prestage_lease_assertion_required",
  );
  const now = readClock(input.now);
  const binding = exactBinding(input, now);
  resolveYoutubeScheduledPublishAt(binding.scheduledFor, {
    now,
    requireFuture: true,
  });
  const {
    db,
    platformPosts,
    governance,
  } = input;
  const priorState = governance.getState(binding.storyId, "youtube");
  const priorPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  if (priorState?.lifecycle_state === "PLATFORM_SCHEDULED") {
    const externalId = text(
      priorState.external_id || priorPost?.external_id,
    );
    governance.assertPlatformScheduledBinding({
      storyId: binding.storyId,
      platform: "youtube",
      externalId,
      idempotencyKey: binding.idempotencyKey,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
      now,
    });
    return {
      status: "platform_scheduled",
      scheduled: true,
      reused: true,
      externalId,
      externalUrl: priorState.external_url || priorPost?.external_url || null,
      platformPost: priorPost,
      governanceState: priorState,
    };
  }
  if (priorState?.lifecycle_state === "PLATFORM_OBJECT_CREATED") {
    return anchoredPrivateObjectResult({
      platformPosts,
      governance,
      binding,
      state: priorState,
      reused: true,
    });
  }
  if (priorState?.lifecycle_state !== "SCHEDULED") {
    throw reconciliationError(
      governance,
      binding.storyId,
      priorPost?.external_id,
    );
  }
  if (
    priorPost &&
    (priorPost.external_id ||
      ["uploading", "published"].includes(priorPost.status))
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      priorPost.external_id,
    );
  }
  const platformPost = platformPosts.ensurePending(
    binding.storyId,
    "youtube",
    {
      channelId: binding.channelId,
      idempotencyKey: binding.idempotencyKey,
    },
  );
  governance.preparePrivateScheduledUpload({
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
  });
  let createAttemptStarted = false;
  let uploadReturned = false;
  let externalId = null;
  let externalUrl = null;
  let anchoredState = null;
  try {
    assertHealthy();
    const uploaded = await uploadScheduled({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      scheduledFor: binding.scheduledFor,
      platformPost,
      markCreateAttemptStarted() {
        createAttemptStarted = true;
      },
    });
    uploadReturned = true;
    externalId = text(uploaded?.externalId);
    externalUrl = text(uploaded?.externalUrl) || null;
    if (!externalId) {
      throw new Error("youtube_private_prestage_external_id_required");
    }
    createAttemptStarted = true;
  } catch (error) {
    platformPosts.markFailed(platformPost.id, error, {
      externalId: uploadReturned ? externalId : null,
      externalUrl: uploadReturned ? externalUrl : null,
    });
    if (createAttemptStarted) {
      governance.recordAmbiguousDispatchFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error,
      });
    } else {
      governance.recordPreCreateFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error,
      });
    }
    throw error;
  }
  try {
    assertHealthy();
    const anchor = db.transaction(() => {
      const anchored = platformPosts.anchorExternalObject(
        platformPost.id,
        { externalId, externalUrl },
      );
      if (!anchored) throw new Error("platform_post_anchor_failed");
      const state =
        governance.recordPrivateScheduledPlatformObjectCreated({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          externalUrl,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          now,
        });
      return { anchored, state };
    });
    anchoredState = anchor.immediate().state;
  } catch (error) {
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl,
    });
    governance.recordAmbiguousDispatchFailure({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
    });
    throw error;
  }
  return anchoredPrivateObjectResult({
    platformPosts,
    governance,
    binding,
    state: anchoredState,
  });
}

async function verifyGovernedYoutubePrivatePrestage(input = {}) {
  assertDependencies(input);
  const verifyPrivate = requiredFunction(
    input.verifyPrivate,
    "youtube_private_object_verifier_required",
  );
  const assertHealthy = requiredFunction(
    input.assertLeaseHealthy,
    "youtube_private_prestage_lease_assertion_required",
  );
  const now = readClock(input.now);
  const binding = exactBinding(input, now);
  resolveYoutubeScheduledPublishAt(binding.scheduledFor, {
    now,
    requireFuture: true,
  });
  const {
    db,
    platformPosts,
    governance,
  } = input;
  const state = governance.getState(binding.storyId, "youtube");
  if (state?.lifecycle_state === "PLATFORM_OBJECT_CREATED") {
    return verifyAnchoredPrivateObject({
      platformPosts,
      governance,
      binding,
      verifyPrivate,
      containUnexpectedObject:
        input.containUnexpectedObject,
      assertHealthy,
      now,
    });
  }
  throw reconciliationError(
    governance,
    binding.storyId,
    state?.external_id,
  );
}

async function armGovernedYoutubeScheduledRelease(input = {}) {
  assertDependencies(input);
  const armScheduled = requiredFunction(
    input.armScheduled,
    "youtube_schedule_armer_required",
  );
  const verifyScheduled = requiredFunction(
    input.verifyScheduled,
    "youtube_scheduled_object_verifier_required",
  );
  const revalidateOfficialSource = requiredFunction(
    input.revalidateOfficialSource,
    "youtube_official_source_revalidator_required",
  );
  const assertHealthy = requiredFunction(
    input.assertLeaseHealthy,
    "youtube_private_prestage_lease_assertion_required",
  );
  const now = readClock(input.now);
  const binding = exactBinding(input, now);
  resolveYoutubeScheduledPublishAt(binding.scheduledFor, {
    now,
    requireFuture: true,
  });
  const { platformPosts, governance } = input;
  const state = governance.getState(binding.storyId, "youtube");
  const platformPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  const externalId = text(
    state?.external_id || platformPost?.external_id,
  );
  if (
    state?.lifecycle_state !== "PLATFORM_OBJECT_CREATED" ||
    !platformPost ||
    !externalId ||
    (platformPost.external_id &&
      text(platformPost.external_id) !== externalId)
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
  }
  governance.assertPrivateUnscheduledPlatformObjectBinding({
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    externalId,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
  });
  const priorArmAttempt =
    typeof governance.getScheduledPlatformArmAttempt === "function"
      ? governance.getScheduledPlatformArmAttempt({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          now,
        })
      : null;
  if (priorArmAttempt) {
    const error = reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
    error.updateAttemptStarted = true;
    error.remoteDisarmRequired = true;
    error.armAttempt = priorArmAttempt;
    throw error;
  }
  let sourceRevalidation = null;
  let updateAttemptStarted = false;
  let armResult;
  try {
    assertHealthy();
    armResult = await armScheduled({
      platform: "youtube",
      storyId: binding.storyId,
      externalId,
      scheduledFor: binding.scheduledFor,
      async assertUpdateBoundary() {
        assertHealthy();
        governance.assertPrivateUnscheduledPlatformObjectBinding({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          now: readClock(input.now),
        });
        sourceRevalidation =
          validateOfficialSourceRevalidation({
            value: await revalidateOfficialSource({
              platform: "youtube",
              storyId: binding.storyId,
              externalId,
              scheduledFor: binding.scheduledFor,
              expectedSourceRevisionSha256:
                input.expectedSourceRevisionSha256,
            }),
            expectedSourceRevisionSha256:
              input.expectedSourceRevisionSha256,
            now: readClock(input.now),
            scheduledFor: binding.scheduledFor,
          });
        assertHealthy();
      },
      markUpdateAttemptStarted() {
        const marker =
          governance.recordScheduledPlatformArmAttemptStarted({
            storyId: binding.storyId,
            channelId: binding.channelId,
            platform: "youtube",
            idempotencyKey: binding.idempotencyKey,
            externalId,
            scheduledFor: binding.scheduledFor,
            requestFingerprint: binding.requestFingerprint,
            runwayLockSha256: binding.runwayLockSha256,
            sourceRevalidation,
            now: readClock(input.now),
          });
        updateAttemptStarted = true;
        return marker;
      },
    });
    assertHealthy();
  } catch (error) {
    const remoteContainmentRequired =
      error?.compensationRequired === true ||
      error?.remoteContainmentRequired === true;
    if (
      updateAttemptStarted ||
      error?.updateAttemptStarted === true ||
      remoteContainmentRequired
    ) {
      error.updateAttemptStarted =
        updateAttemptStarted ||
        error?.updateAttemptStarted === true;
      error.remoteDisarmRequired = true;
      error.remoteContainmentRequired =
        remoteContainmentRequired;
      platformPosts.markFailed(platformPost.id, error, {
        externalId,
        externalUrl: platformPost.external_url,
      });
      governance.recordAmbiguousDispatchFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error,
      });
    }
    throw error;
  }
  const exactArm =
    armResult?.confirmed === true &&
    updateAttemptStarted &&
    sourceRevalidation &&
    text(armResult.externalId) === externalId &&
    text(armResult.scheduledFor) === binding.scheduledFor &&
    armResult?.evidence?.schedule_arm_confirmed === true &&
    armResult?.evidence?.release_armed === true &&
    text(armResult?.evidence?.publish_at) === binding.scheduledFor;
  if (!exactArm) {
    const error = new Error(
      "youtube_schedule_arm_exact_proof_required",
    );
    if (updateAttemptStarted) {
      error.updateAttemptStarted = true;
      error.remoteDisarmRequired = true;
      platformPosts.markFailed(platformPost.id, error, {
        externalId,
        externalUrl: platformPost.external_url,
      });
      governance.recordAmbiguousDispatchFailure({
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        error,
      });
    }
    throw error;
  }
  let verification;
  try {
    assertHealthy();
    verification = await verifyScheduled({
      platform: "youtube",
      storyId: binding.storyId,
      externalId,
      scheduledFor: binding.scheduledFor,
    });
    assertHealthy();
  } catch (error) {
    error.updateAttemptStarted = true;
    error.remoteDisarmRequired = true;
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl: platformPost.external_url,
    });
    governance.recordAmbiguousDispatchFailure({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
    });
    throw error;
  }
  const exactVerification =
    verification?.confirmed === true &&
    text(verification.externalId) === externalId &&
    text(verification.scheduledFor) === binding.scheduledFor &&
    privateScheduledProcessed(
      verification.evidence,
      binding.scheduledFor,
    );
  if (!exactVerification) {
    const error = new Error(
      "youtube_schedule_arm_readback_not_confirmed",
    );
    error.updateAttemptStarted = true;
    error.remoteDisarmRequired = true;
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl: platformPost.external_url,
    });
    governance.recordPlatformCreatedConfirmationFailed({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
      verificationEvidence: {
        ...(verification?.evidence || {}),
        external_id: externalId,
      },
    });
    governance.recordAmbiguousDispatchFailure({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
    });
    const reconciliation = reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
    reconciliation.updateAttemptStarted = true;
    reconciliation.remoteDisarmRequired = true;
    throw reconciliation;
  }
  const verificationNow = verificationClock(
    verification.verifiedAt,
    now,
  );
  const recordPlatformScheduledInput = {
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    externalId,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    verifiedAt: verification.verifiedAt,
    verificationEvidence: {
      ...(verification.evidence || {}),
      external_id: externalId,
      source_revalidation: sourceRevalidation,
      schedule_arm_proof: armResult.evidence,
    },
    now: verificationNow,
  };
  let scheduledState;
  let releaseCommitment = null;
  try {
    if (typeof input.persistScheduledRelease === "function") {
      const persisted = await input.persistScheduledRelease({
        recordPlatformScheduledInput,
        externalId,
        verification,
        sourceRevalidation,
        armResult,
      });
      scheduledState = persisted?.governanceState;
      releaseCommitment =
        persisted?.releaseCommitment || null;
      if (!scheduledState || !releaseCommitment) {
        throw new Error(
          "youtube_schedule_arm_atomic_persistence_required",
        );
      }
    } else {
      scheduledState = governance.recordPlatformScheduled(
        recordPlatformScheduledInput,
      );
    }
  } catch (error) {
    error.updateAttemptStarted = true;
    error.remoteDisarmRequired = true;
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl: platformPost.external_url,
    });
    governance.recordAmbiguousDispatchFailure({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
    });
    throw error;
  }
  return {
    status: "platform_scheduled",
    scheduled: true,
    releaseArmed: true,
    externalId,
    externalUrl:
      text(verification.externalUrl) ||
      text(platformPost.external_url) ||
      null,
    sourceRevalidation,
    armResult,
    verification,
    releaseCommitment,
    platformPost: platformPosts.getByStoryPlatform(
      binding.storyId,
      "youtube",
    ),
    governanceState: scheduledState,
  };
}

async function confirmGovernedYoutubeScheduledRelease(input = {}) {
  assertDependencies(input);
  const verifyPublic = requiredFunction(
    input.verifyPublic,
    "youtube_scheduled_release_public_verifier_required",
  );
  const assertHealthy = requiredFunction(
    input.assertLeaseHealthy,
    "youtube_private_prestage_lease_assertion_required",
  );
  const now = readClock(input.now);
  const binding = exactBinding(input, now);
  const {
    db,
    platformPosts,
    governance,
  } = input;
  const state = governance.getState(binding.storyId, "youtube");
  const platformPost = platformPosts.getByStoryPlatform(
    binding.storyId,
    "youtube",
  );
  const externalId = text(
    state?.external_id || platformPost?.external_id,
  );
  if (state?.lifecycle_state === "PUBLISHED") {
    governance.assertPlatformScheduledBinding({
      storyId: binding.storyId,
      platform: "youtube",
      externalId,
      idempotencyKey: binding.idempotencyKey,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
      now,
    });
    governance.assertScheduledPlatformReleaseCommitment({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      externalId,
      idempotencyKey: binding.idempotencyKey,
      scheduledFor: binding.scheduledFor,
      requestFingerprint: binding.requestFingerprint,
      runwayLockSha256: binding.runwayLockSha256,
      allowPublishedReplay: true,
      now,
    });
    return {
      status: "published",
      published: true,
      reused: true,
      externalId,
      externalUrl: state.external_url || platformPost?.external_url || null,
      platformPost,
      governanceState: state,
    };
  }
  if (
    state?.lifecycle_state !== "PLATFORM_SCHEDULED" ||
    !platformPost ||
    !externalId
  ) {
    throw reconciliationError(
      governance,
      binding.storyId,
      externalId,
    );
  }
  const persisted = governance.assertPlatformScheduledBinding({
    storyId: binding.storyId,
    platform: "youtube",
    externalId,
    idempotencyKey: binding.idempotencyKey,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
  });
  if (now.getTime() < Date.parse(persisted.scheduledFor)) {
    return {
      status: "not_due",
      published: false,
      scheduledFor: persisted.scheduledFor,
      externalId,
      platformPost,
      governanceState: state,
    };
  }
  let verification;
  try {
    assertHealthy();
    verification = await verifyPublic({
      platform: "youtube",
      storyId: binding.storyId,
      externalId,
      scheduledFor: binding.scheduledFor,
    });
    assertHealthy();
  } catch (error) {
    return {
      status: "verification_pending",
      published: false,
      externalId,
      reason: text(error?.code || error?.message) || "verification_error",
      platformPost,
      governanceState: state,
    };
  }
  if (
    verification?.confirmed !== true ||
    text(verification.externalId) !== externalId ||
    !text(verification.verifiedAt) ||
    !publicProcessed(verification.evidence)
  ) {
    return {
      status: "verification_pending",
      published: false,
      externalId,
      reason: text(verification?.reason) || "public_release_not_verified",
      verification,
      platformPost,
      governanceState: state,
    };
  }
  const verificationEvidence = {
    ...verification.evidence,
    external_id: externalId,
  };
  try {
    const finalise = db.transaction(() => {
      const publishedState =
        governance.recordScheduledPlatformPublished({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          verifiedAt: verification.verifiedAt,
          verificationEvidence,
          now,
        });
      const publishedPost = platformPosts.markPublished(
        platformPost.id,
        {
          externalId,
          externalUrl:
            text(verification.externalUrl) ||
            text(platformPost.external_url) ||
            null,
        },
      );
      if (!publishedPost) {
        throw new Error("platform_post_projection_update_failed");
      }
      const storyProjection =
        require("./youtube-story-publication-projection")
          .projectYoutubeStoryPublication({
            db,
            storyId: binding.storyId,
            externalId,
            externalUrl: publishedPost.external_url,
            publishedAt: verification.verifiedAt,
          });
      return { publishedState, publishedPost, storyProjection };
    });
    const result = finalise.immediate();
    return {
      status: "published",
      published: true,
      externalId,
      externalUrl: result.publishedPost.external_url,
      platformPost: result.publishedPost,
      governanceState: result.publishedState,
      storyProjection: result.storyProjection,
      verification,
    };
  } catch (error) {
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl: platformPost.external_url,
    });
    governance.recordAmbiguousDispatchFailure({
      storyId: binding.storyId,
      channelId: binding.channelId,
      platform: "youtube",
      idempotencyKey: binding.idempotencyKey,
      error,
    });
    throw error;
  }
}

module.exports = {
  armGovernedYoutubeScheduledRelease,
  confirmGovernedYoutubeScheduledRelease,
  prestageGovernedYoutubeRelease,
  publicProcessed,
  readClock,
  resolveGovernedYoutubePlatformScheduledBinding,
  validateOfficialSourceRevalidation,
  verifyGovernedYoutubePrivatePrestage,
  YoutubePrivatePrestageReconciliationRequiredError,
};
