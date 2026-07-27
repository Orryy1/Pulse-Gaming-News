"use strict";

function requiredText(value, code) {
  const normalised = String(value || "").trim();
  if (!normalised) throw new Error(code);
  return normalised;
}

function validateYoutubeApiKey(value) {
  const key = requiredText(value, "youtube_api_key_required");
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(key)) {
    throw new Error("youtube_api_key_invalid");
  }
  return key;
}

function verifierTime(now) {
  const value = now();
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("youtube_verifier_time_invalid");
  }
  return date.toISOString();
}

function observationReason({ item, privacyStatus, uploadStatus }) {
  if (!item) return "youtube_object_not_found";
  if (privacyStatus !== "public") return "youtube_privacy_not_public";
  if (uploadStatus !== "processed") return "youtube_upload_not_processed";
  return "youtube_public_processed";
}

function safeApiErrorCode(error) {
  const code = String(
    error?.code || error?.response?.status || error?.status || "",
  ).trim();
  return /^[a-z0-9_.-]{1,64}$/i.test(code) ? code : null;
}

function createYoutubePublicObjectVerifier({
  apiKey = null,
  youtubeClient = null,
  now = () => new Date(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 10,
  pollIntervalMs = 5000,
} = {}) {
  let client = youtubeClient;
  if (!client) {
    const key = validateYoutubeApiKey(apiKey);
    const { google } = require("googleapis");
    client = google.youtube({ version: "v3", auth: key });
  }
  if (!client?.videos || typeof client.videos.list !== "function") {
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
  if (!Number.isFinite(interval) || interval < 0 || interval > 60_000) {
    throw new Error("youtube_verifier_poll_interval_invalid");
  }

  return async function verifyYoutubePublicObject(candidate = {}) {
    if (String(candidate.platform || "").trim() !== "youtube") {
      throw new Error("youtube_verifier_platform_mismatch");
    }
    const canonicalExternalId = String(candidate.externalId || "").trim();
    const legacyExternalId = String(candidate.external_id || "").trim();
    if (
      canonicalExternalId &&
      legacyExternalId &&
      canonicalExternalId !== legacyExternalId
    ) {
      throw new Error("youtube_external_id_conflict");
    }
    const externalId = requiredText(
      canonicalExternalId || legacyExternalId,
      "youtube_external_id_required",
    );
    let firstCheckedAt = null;
    let latest = null;
    for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
      let response;
      try {
        response = await client.videos.list({
          part: ["status"],
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
          verifiedAt: checkedAt,
          reason: "youtube_api_check_error",
          attempts: attempt,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: false,
            public: false,
            privacy_status: null,
            upload_status: null,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason: "youtube_api_check_error",
            attempts: attempt,
            max_attempts: attemptsLimit,
            api_error_code: safeApiErrorCode(error),
          },
        };
        if (attempt === attemptsLimit) {
          latest.exhausted = true;
          latest.evidence.exhausted = true;
          return latest;
        }
        await sleep(interval);
        continue;
      }
      if (!Array.isArray(response?.data?.items)) {
        const checkedAt = verifierTime(now);
        firstCheckedAt ||= checkedAt;
        latest = {
          confirmed: false,
          externalId,
          externalUrl: null,
          verifiedAt: checkedAt,
          reason: "youtube_api_response_invalid",
          attempts: attempt,
          evidence: {
            platform: "youtube",
            platform_object_confirmed: false,
            public: false,
            privacy_status: null,
            upload_status: null,
            checked_at: checkedAt,
            first_checked_at: firstCheckedAt,
            reason: "youtube_api_response_invalid",
            attempts: attempt,
            max_attempts: attemptsLimit,
          },
        };
        if (attempt === attemptsLimit) {
          latest.exhausted = true;
          latest.evidence.exhausted = true;
          return latest;
        }
        await sleep(interval);
        continue;
      }
      const item = response.data.items.find(
        (entry) => String(entry?.id || "").trim() === externalId,
      );
      const checkedAt = verifierTime(now);
      firstCheckedAt ||= checkedAt;
      const privacyStatus = String(item?.status?.privacyStatus || "")
        .trim()
        .toLowerCase();
      const uploadStatus = String(item?.status?.uploadStatus || "")
        .trim()
        .toLowerCase();
      const reason = observationReason({
        item,
        privacyStatus,
        uploadStatus,
      });
      const confirmed = reason === "youtube_public_processed";
      latest = {
        confirmed,
        externalId,
        externalUrl: item
          ? `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`
          : null,
        verifiedAt: checkedAt,
        reason,
        attempts: attempt,
        evidence: {
          platform: "youtube",
          platform_object_confirmed: Boolean(item),
          public: confirmed,
          privacy_status: privacyStatus || null,
          upload_status: uploadStatus || null,
          checked_at: checkedAt,
          first_checked_at: firstCheckedAt,
          reason,
          attempts: attempt,
          max_attempts: attemptsLimit,
        },
      };
      if (confirmed) return latest;
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
  createYoutubePublicObjectVerifier,
  observationReason,
  safeApiErrorCode,
  validateYoutubeApiKey,
  verifierTime,
};
