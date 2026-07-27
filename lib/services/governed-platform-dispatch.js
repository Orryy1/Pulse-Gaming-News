"use strict";

function text(value) {
  return String(value || "").trim();
}

function hasPublicProof(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return false;
  }
  return (
    evidence.public === true ||
    text(evidence.visibility).toLowerCase() === "public" ||
    text(evidence.privacy_status).toLowerCase() === "public"
  );
}

function requiredFunction(value, code) {
  if (typeof value !== "function") throw new Error(code);
  return value;
}

function readClock(clock) {
  const value =
    typeof clock === "function"
      ? clock()
      : clock === null || clock === undefined
        ? new Date()
        : clock;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("governed_dispatch_clock_invalid");
  }
  return date;
}

class PlatformDispatchReconciliationRequiredError extends Error {
  constructor({ externalId = null, platformPostId = null } = {}) {
    super("platform_dispatch_reconciliation_required");
    this.name = "PlatformDispatchReconciliationRequiredError";
    this.code = "platform_dispatch_reconciliation_required";
    this.externalId = externalId;
    this.platformPostId = platformPostId;
  }
}

class PlatformDispatchRescheduleRequiredError extends Error {
  constructor({ lifecycleState = null, platformPostId = null } = {}) {
    super("platform_dispatch_reschedule_required");
    this.name = "PlatformDispatchRescheduleRequiredError";
    this.code = "platform_dispatch_reschedule_required";
    this.lifecycleState = lifecycleState;
    this.platformPostId = platformPostId;
  }
}

async function dispatchGovernedPlatform({
  db,
  platformPosts,
  governance,
  storyId,
  channelId,
  platform,
  idempotencyKey,
  requestFingerprint = null,
  actorId = null,
  dispatchEvidence = null,
  upload,
  verifyPublic,
  assertLeaseHealthy,
  now = null,
} = {}) {
  if (!db || typeof db.transaction !== "function") {
    throw new Error("governed_dispatch_database_required");
  }
  if (
    !platformPosts ||
    typeof platformPosts.ensurePending !== "function" ||
    typeof platformPosts.getByStoryPlatform !== "function" ||
    typeof platformPosts.anchorExternalObject !== "function" ||
    typeof platformPosts.markBlocked !== "function" ||
    typeof platformPosts.markFailed !== "function" ||
    typeof platformPosts.markPublished !== "function"
  ) {
    throw new Error("governed_dispatch_platform_posts_required");
  }
  if (
    !governance ||
    typeof governance.prepareDispatch !== "function" ||
    typeof governance.getState !== "function" ||
    typeof governance.recordAmbiguousDispatchFailure !== "function" ||
    typeof governance.recordPlatformObjectCreated !== "function" ||
    typeof governance.recordPlatformCreatedConfirmationFailed !== "function" ||
    typeof governance.recordPlatformConfirmed !== "function" ||
    typeof governance.recordPostCreateMetadataFailure !== "function" ||
    typeof governance.recordPreCreateFailure !== "function" ||
    typeof governance.recordPublished !== "function"
  ) {
    throw new Error("governed_dispatch_governance_required");
  }
  const uploadObject = requiredFunction(
    upload,
    "governed_dispatch_uploader_required",
  );
  const verifyObject = requiredFunction(
    verifyPublic,
    "governed_dispatch_public_verifier_required",
  );
  const assertHealthy = requiredFunction(
    assertLeaseHealthy,
    "governed_dispatch_lease_assertion_required",
  );
  const dispatchNow = readClock(now);

  const priorPost = platformPosts.getByStoryPlatform(storyId, platform);
  const priorState = governance.getState(storyId, platform);
  if (priorPost) {
    const unknownInFlight =
      priorState?.lifecycle_state === "DISPATCH_STARTED";
    const uncertainLifecycle = [
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_CREATED_CONFIRMATION_FAILED",
      "PLATFORM_CREATED_METADATA_FAILED",
      "RECONCILIATION_REQUIRED",
      "PUBLISHED",
    ].includes(priorState?.lifecycle_state);
    if (unknownInFlight) {
      governance.recordAmbiguousDispatchFailure({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        error: new Error("prior_dispatch_outcome_unknown"),
      });
    }
    if (
      unknownInFlight ||
      uncertainLifecycle ||
      priorPost.external_id ||
      priorPost.status === "uploading" ||
      priorPost.status === "published"
    ) {
      throw new PlatformDispatchReconciliationRequiredError({
        externalId: priorPost.external_id || priorState?.external_id || null,
        platformPostId: priorPost.id,
      });
    }
  }

  const platformPost = platformPosts.ensurePending(storyId, platform, {
    channelId,
    idempotencyKey,
  });
  const dispatchState = governance.prepareDispatch({
    storyId,
    channelId,
    platform,
    idempotencyKey,
    actorId,
    requestFingerprint,
    evidence: dispatchEvidence,
    now: dispatchNow,
  });
  if (
    platformPost.external_id ||
    dispatchState?.lifecycle_state === "RECONCILIATION_REQUIRED"
  ) {
    throw new PlatformDispatchReconciliationRequiredError({
      externalId: platformPost.external_id || dispatchState?.external_id,
      platformPostId: platformPost.id,
    });
  }
  if (dispatchState?.lifecycle_state !== "DISPATCH_STARTED") {
    throw new PlatformDispatchRescheduleRequiredError({
      lifecycleState: dispatchState?.lifecycle_state || null,
      platformPostId: platformPost.id,
    });
  }

  let uploadResult;
  let createAttemptStarted = false;
  let uploadReturned = false;
  let externalId;
  let externalUrl;
  let confirmationFailureEvidence = null;
  try {
    assertHealthy();
    uploadResult = await uploadObject({
      storyId,
      channelId,
      platform,
      idempotencyKey,
      platformPost,
      markCreateAttemptStarted() {
        createAttemptStarted = true;
      },
    });
    uploadReturned = true;
    if (uploadResult?.blocked === true) {
      if (createAttemptStarted) {
        throw new Error("platform_upload_blocked_after_create_boundary");
      }
      uploadReturned = false;
      assertHealthy();
      const reason = text(uploadResult.reason) || "platform_upload_blocked";
      const blockError = new Error(`platform_upload_blocked:${reason}`);
      const blockedPost = platformPosts.markBlocked(platformPost.id, reason);
      const governanceState = governance.recordPreCreateFailure({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        error: blockError,
      });
      return {
        status: "blocked",
        blocked: true,
        reason,
        platformPost: blockedPost,
        governanceState,
      };
    }
    externalId = text(uploadResult?.externalId);
    externalUrl = text(uploadResult?.externalUrl) || null;
    if (!externalId) throw new Error("platform_upload_external_id_required");
    createAttemptStarted = true;
  } catch (error) {
    platformPosts.markFailed(platformPost.id, error, {
      externalId: uploadReturned ? externalId : null,
      externalUrl: uploadReturned ? externalUrl : null,
    });
    if (createAttemptStarted) {
      governance.recordAmbiguousDispatchFailure({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        error,
      });
    } else {
      governance.recordPreCreateFailure({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        error,
      });
    }
    throw error;
  }

  try {
    const anchoredPost = platformPosts.anchorExternalObject(platformPost.id, {
      externalId,
      externalUrl,
    });
    if (!anchoredPost) throw new Error("platform_post_anchor_failed");
    governance.recordPlatformObjectCreated({
      storyId,
      channelId,
      platform,
      idempotencyKey,
      externalId,
      externalUrl,
    });
    assertHealthy();

    let verification;
    try {
      verification = await verifyObject({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        platformPostId: platformPost.id,
        externalId,
        externalUrl,
      });
    } catch (error) {
      confirmationFailureEvidence = {
        verification_attempted: true,
        verification_result_received: false,
      };
      throw error;
    }
    assertHealthy();
    if (
      verification?.confirmed !== true ||
      text(verification.externalId) !== externalId ||
      !text(verification.verifiedAt) ||
      !hasPublicProof(verification.evidence)
    ) {
      const returnedEvidence =
        verification?.evidence &&
        typeof verification.evidence === "object" &&
        !Array.isArray(verification.evidence)
          ? { ...verification.evidence }
          : {};
      const reportedEvidenceExternalId = text(returnedEvidence.external_id);
      delete returnedEvidence.external_id;
      confirmationFailureEvidence = {
        ...returnedEvidence,
        verification_attempted: true,
        verification_result_received: true,
        verifier_confirmed: verification?.confirmed === true,
        verifier_external_id: text(verification?.externalId) || null,
        verifier_verified_at: text(verification?.verifiedAt) || null,
        public_proof_present: hasPublicProof(verification?.evidence),
        ...(reportedEvidenceExternalId
          ? { verifier_evidence_external_id: reportedEvidenceExternalId }
          : {}),
      };
      throw new Error("public_platform_verification_required");
    }
    const verificationEvidence = {
      ...verification.evidence,
      external_id: externalId,
    };
    const verificationNow = readClock(now);
    const finalise = db.transaction(() => {
      governance.recordPlatformConfirmed({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        verifiedAt: verification.verifiedAt,
        verificationEvidence,
        now: verificationNow,
      });
      const publishedState = governance.recordPublished({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        verifiedAt: verification.verifiedAt,
        verificationEvidence,
        now: verificationNow,
      });
      const publishedPost = platformPosts.markPublished(platformPost.id, {
        externalId,
        externalUrl: verification.externalUrl || externalUrl,
      });
      if (!publishedPost) {
        throw new Error("platform_post_projection_update_failed");
      }
      const storyProjection =
        platform === "youtube"
          ? require("./youtube-story-publication-projection")
              .projectYoutubeStoryPublication({
                db,
                storyId,
                externalId,
                externalUrl:
                  verification.externalUrl || externalUrl,
                publishedAt: verification.verifiedAt,
              })
          : null;
      return { publishedPost, publishedState, storyProjection };
    });
    const {
      publishedPost,
      publishedState,
      storyProjection,
    } = finalise.immediate();
    return {
      status: "published",
      published: true,
      externalId,
      externalUrl: publishedPost.external_url,
      platformPost: publishedPost,
      governanceState: publishedState,
      storyProjection,
      verification,
    };
  } catch (error) {
    platformPosts.anchorExternalObject(platformPost.id, {
      externalId,
      externalUrl,
    });
    platformPosts.markFailed(platformPost.id, error, {
      externalId,
      externalUrl,
    });
    let state = governance.getState(storyId, platform);
    if (state?.lifecycle_state === "DISPATCH_STARTED") {
      governance.recordPlatformObjectCreated({
        storyId,
        channelId,
        platform,
        idempotencyKey,
        externalId,
        externalUrl,
      });
      state = governance.getState(storyId, platform);
    }
    if (state?.lifecycle_state === "PLATFORM_OBJECT_CREATED") {
      if (confirmationFailureEvidence) {
        governance.recordPlatformCreatedConfirmationFailed({
          storyId,
          channelId,
          platform,
          idempotencyKey,
          error,
          verificationEvidence: confirmationFailureEvidence,
        });
      } else {
        governance.recordPostCreateMetadataFailure({
          storyId,
          channelId,
          platform,
          idempotencyKey,
          error,
        });
      }
    }
    governance.recordAmbiguousDispatchFailure({
      storyId,
      channelId,
      platform,
      idempotencyKey,
      error,
    });
    throw error;
  }
}

module.exports = {
  dispatchGovernedPlatform,
  hasPublicProof,
  PlatformDispatchReconciliationRequiredError,
  PlatformDispatchRescheduleRequiredError,
  readClock,
};
