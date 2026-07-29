"use strict";

const {
  safeApiErrorCode,
  throwIfYoutubeVerifierAborted,
  verifierTime,
  youtubeVerifierInvocation,
} = require("./youtube-public-object-verifier");

function text(value) {
  return String(value ?? "").trim();
}

function privateObservationReason({
  item,
  privacyStatus,
  uploadStatus,
  processingStatus,
  publishAt,
  publishAtPresent,
  publishAtInvalid,
}) {
  if (!item) return "youtube_private_object_not_found";
  if (privacyStatus === "public") {
    return "youtube_private_object_published_early";
  }
  if (privacyStatus !== "private") {
    return "youtube_private_object_privacy_not_private";
  }
  if (publishAtPresent && publishAtInvalid) {
    return "youtube_private_object_publish_at_invalid";
  }
  if (publishAtPresent || publishAt !== null) {
    return "youtube_private_object_unexpected_publish_at";
  }
  if (uploadStatus !== "processed") {
    return "youtube_private_object_upload_not_processed";
  }
  if (processingStatus !== "succeeded") {
    return "youtube_private_object_processing_not_succeeded";
  }
  return "youtube_private_unscheduled_processed";
}

function createYoutubePrivateObjectVerifier({
  youtubeClient,
  now = () => new Date(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 10,
  pollIntervalMs = 5000,
} = {}) {
  if (
    !youtubeClient?.videos ||
    typeof youtubeClient.videos.list !== "function"
  ) {
    throw new Error("youtube_videos_client_required");
  }
  if (typeof now !== "function") {
    throw new Error("youtube_verifier_clock_required");
  }
  if (typeof sleep !== "function") {
    throw new Error("youtube_verifier_sleep_required");
  }
  const attemptsLimit = Number(maxAttempts);
  if (
    !Number.isInteger(attemptsLimit) ||
    attemptsLimit < 1 ||
    attemptsLimit > 10
  ) {
    throw new Error("youtube_verifier_max_attempts_invalid");
  }
  const interval = Number(pollIntervalMs);
  if (
    !Number.isFinite(interval) ||
    interval < 0 ||
    interval > 60_000
  ) {
    throw new Error("youtube_verifier_poll_interval_invalid");
  }

  return async function verifyYoutubePrivateObject(
    candidate = {},
    invocationOptions = {},
  ) {
    if (text(candidate.platform) !== "youtube") {
      throw new Error("youtube_verifier_platform_mismatch");
    }
    if (
      [
        "scheduledFor",
        "scheduled_for",
        "publishAt",
        "publish_at",
      ].some((field) => Object.hasOwn(candidate, field))
    ) {
      throw new Error(
        "youtube_private_verifier_release_authority_forbidden",
      );
    }
    const camelExternalId = text(candidate.externalId);
    const snakeExternalId = text(candidate.external_id);
    if (
      camelExternalId &&
      snakeExternalId &&
      camelExternalId !== snakeExternalId
    ) {
      throw new Error("youtube_external_id_conflict");
    }
    const externalId = camelExternalId || snakeExternalId;
    if (!externalId) {
      throw new Error("youtube_external_id_required");
    }
    const invocation = youtubeVerifierInvocation(
      invocationOptions,
      attemptsLimit,
    );
    let firstCheckedAt = null;
    let latest = null;
    for (
      let attempt = 1;
      attempt <= invocation.attemptsLimit;
      attempt += 1
    ) {
      throwIfYoutubeVerifierAborted(invocation.signal);
      let response;
      try {
        const params = {
          part: ["status", "processingDetails"],
          id: [externalId],
          maxResults: 1,
        };
        response = invocation.signal
          ? await youtubeClient.videos.list(params, {
              signal: invocation.signal,
            })
          : await youtubeClient.videos.list(params);
      } catch (error) {
        throwIfYoutubeVerifierAborted(invocation.signal);
        const checkedAt = verifierTime(now);
        firstCheckedAt ||= checkedAt;
        latest = {
          confirmed: false,
          externalId,
          externalUrl: null,
          verifiedAt: checkedAt,
          reason: "youtube_api_check_error",
          attempts: attempt,
          incident_required: false,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: false,
            scheduled_release_confirmed: false,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason: "youtube_api_check_error",
            attempts: attempt,
            max_attempts: invocation.attemptsLimit,
            api_error_code: safeApiErrorCode(error),
          },
        };
      }
      if (response && !Array.isArray(response?.data?.items)) {
        const checkedAt = verifierTime(now);
        firstCheckedAt ||= checkedAt;
        latest = {
          confirmed: false,
          externalId,
          externalUrl: null,
          verifiedAt: checkedAt,
          reason: "youtube_api_response_invalid",
          attempts: attempt,
          incident_required: false,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: false,
            scheduled_release_confirmed: false,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason: "youtube_api_response_invalid",
            attempts: attempt,
            max_attempts: invocation.attemptsLimit,
          },
        };
      } else if (response) {
        const item = response.data.items.find(
          (entry) => text(entry?.id) === externalId,
        );
        const checkedAt = verifierTime(now);
        firstCheckedAt ||= checkedAt;
        const privacyStatus = text(
          item?.status?.privacyStatus,
        ).toLowerCase();
        const uploadStatus = text(
          item?.status?.uploadStatus,
        ).toLowerCase();
        const processingStatus = text(
          item?.processingDetails?.processingStatus,
        ).toLowerCase();
        const publishAtPresent =
          Boolean(item?.status) &&
          Object.hasOwn(item.status, "publishAt");
        let publishAt = null;
        let publishAtInvalid = false;
        if (publishAtPresent) {
          const rawPublishAt = item.status.publishAt;
          const parsedPublishAt = new Date(rawPublishAt);
          if (
            typeof rawPublishAt !== "string" ||
            !rawPublishAt.trim() ||
            Number.isNaN(parsedPublishAt.getTime())
          ) {
            publishAtInvalid = true;
          } else {
            publishAt = parsedPublishAt.toISOString();
          }
        }
        const reason = privateObservationReason({
          item,
          privacyStatus,
          uploadStatus,
          processingStatus,
          publishAt,
          publishAtPresent,
          publishAtInvalid,
        });
        const confirmed =
          reason === "youtube_private_unscheduled_processed";
        const incidentRequired = [
          "youtube_private_object_published_early",
          "youtube_private_object_privacy_not_private",
          "youtube_private_object_unexpected_publish_at",
          "youtube_private_object_publish_at_invalid",
        ].includes(reason);
        latest = {
          confirmed,
          externalId,
          externalUrl: item
            ? `https://www.youtube.com/watch?v=${encodeURIComponent(
                externalId,
              )}`
            : null,
          verifiedAt: checkedAt,
          reason,
          attempts: attempt,
          incident_required: incidentRequired,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: Boolean(item),
            scheduled_release_confirmed: false,
            privacy_status: privacyStatus || null,
            publish_at: publishAt,
            publish_at_present: publishAtPresent,
            publish_at_invalid: publishAtInvalid,
            upload_status: uploadStatus || null,
            processing_status: processingStatus || null,
            release_armed: publishAtPresent,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason,
            attempts: attempt,
            max_attempts: invocation.attemptsLimit,
          },
        };
        if (confirmed || incidentRequired) return latest;
      }
      if (attempt === invocation.attemptsLimit) {
        latest.exhausted = true;
        latest.evidence.exhausted = true;
        return latest;
      }
      await sleep(interval);
    }
    return latest;
  };
}

module.exports = {
  createYoutubePrivateObjectVerifier,
  privateObservationReason,
};
