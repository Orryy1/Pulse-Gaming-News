"use strict";

const {
  resolveYoutubeScheduledPublishAt,
} = require("./youtube-scheduled-release-contract");
const {
  safeApiErrorCode,
  verifierTime,
} = require("./youtube-public-object-verifier");

function text(value) {
  return String(value ?? "").trim();
}

function scheduledObservationReason({
  item,
  privacyStatus,
  uploadStatus,
  processingStatus,
  publishAt,
  scheduledFor,
}) {
  if (!item) return "youtube_scheduled_object_not_found";
  if (privacyStatus === "public") {
    return "youtube_scheduled_object_published_early";
  }
  if (privacyStatus !== "private") {
    return "youtube_scheduled_privacy_not_private";
  }
  if (publishAt !== scheduledFor) {
    return "youtube_publish_at_mismatch";
  }
  if (uploadStatus !== "processed") {
    return "youtube_scheduled_upload_not_processed";
  }
  if (processingStatus !== "succeeded") {
    return "youtube_scheduled_processing_not_succeeded";
  }
  return "youtube_private_schedule_processed";
}

function createYoutubeScheduledObjectVerifier({
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

  return async function verifyYoutubeScheduledObject(
    candidate = {},
  ) {
    if (text(candidate.platform) !== "youtube") {
      throw new Error("youtube_verifier_platform_mismatch");
    }
    const externalId = text(
      candidate.externalId || candidate.external_id,
    );
    if (!externalId) {
      throw new Error("youtube_external_id_required");
    }
    const firstNow = now();
    const scheduledFor = resolveYoutubeScheduledPublishAt(
      candidate.scheduledFor || candidate.scheduled_for,
      { now: firstNow },
    );
    let firstCheckedAt = null;
    let latest = null;
    for (
      let attempt = 1;
      attempt <= attemptsLimit;
      attempt += 1
    ) {
      let response;
      try {
        response = await youtubeClient.videos.list({
          part: ["status", "processingDetails"],
          id: [externalId],
          maxResults: 1,
        });
      } catch (error) {
        const checkedAt = verifierTime(now);
        firstCheckedAt ||= checkedAt;
        latest = {
          confirmed: false,
          externalId,
          externalUrl: null,
          scheduledFor,
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
            max_attempts: attemptsLimit,
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
          scheduledFor,
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
            max_attempts: attemptsLimit,
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
        let publishAt = null;
        try {
          publishAt = item?.status?.publishAt
            ? new Date(item.status.publishAt).toISOString()
            : null;
        } catch {
          publishAt = null;
        }
        const reason = scheduledObservationReason({
          item,
          privacyStatus,
          uploadStatus,
          processingStatus,
          publishAt,
          scheduledFor,
        });
        const confirmed =
          reason === "youtube_private_schedule_processed";
        const incidentRequired = [
          "youtube_scheduled_object_published_early",
          "youtube_publish_at_mismatch",
        ].includes(reason);
        latest = {
          confirmed,
          externalId,
          externalUrl: item
            ? `https://www.youtube.com/watch?v=${encodeURIComponent(
                externalId,
              )}`
            : null,
          scheduledFor,
          verifiedAt: checkedAt,
          reason,
          attempts: attempt,
          incident_required: incidentRequired,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: Boolean(item),
            scheduled_release_confirmed: confirmed,
            privacy_status: privacyStatus || null,
            publish_at: publishAt,
            upload_status: uploadStatus || null,
            processing_status: processingStatus || null,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason,
            attempts: attempt,
            max_attempts: attemptsLimit,
          },
        };
        if (confirmed || incidentRequired) return latest;
      }
      if (attempt === attemptsLimit) {
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
  createYoutubeScheduledObjectVerifier,
  scheduledObservationReason,
};
