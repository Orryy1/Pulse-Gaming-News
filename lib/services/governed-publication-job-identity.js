"use strict";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requiredText(value, code) {
  const normalised = String(value ?? "").trim();
  if (!normalised) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return normalised;
}

function canonicalScheduledFor(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(
      "governed_publication_scheduled_for_invalid",
    );
    error.code = error.message;
    throw error;
  }
  return parsed.toISOString();
}

function youtubeAdmissionJobIdempotencyKey({
  laneId,
  storyId,
  candidateRevisionSha256,
  scheduledFor,
} = {}) {
  const revision = requiredText(
    candidateRevisionSha256,
    "governed_publication_candidate_revision_required",
  ).toLowerCase();
  if (!SHA256_PATTERN.test(revision)) {
    const error = new Error(
      "governed_publication_candidate_revision_invalid",
    );
    error.code = error.message;
    throw error;
  }
  return [
    "admit",
    "youtube",
    requiredText(
      laneId,
      "governed_publication_lane_id_required",
    ),
    requiredText(
      storyId,
      "governed_publication_story_id_required",
    ),
    revision,
    canonicalScheduledFor(scheduledFor),
  ].join(":");
}

function youtubeReleaseJobIdempotencyKey({
  phase,
  scheduledEventId,
  requestFingerprint,
} = {}) {
  const phasePrefix = {
    "T-70": "prestage",
    "T-15": "verify-scheduled",
    T0: "verify-public",
  }[requiredText(
    phase,
    "governed_publication_release_phase_required",
  )];
  if (!phasePrefix) {
    const error = new Error(
      "governed_publication_release_phase_invalid",
    );
    error.code = error.message;
    throw error;
  }
  const eventId = Number(scheduledEventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    const error = new Error(
      "governed_publication_scheduled_event_required",
    );
    error.code = error.message;
    throw error;
  }
  const fingerprint = requiredText(
    requestFingerprint,
    "governed_publication_request_fingerprint_required",
  ).toLowerCase();
  if (!SHA256_PATTERN.test(fingerprint)) {
    const error = new Error(
      "governed_publication_request_fingerprint_invalid",
    );
    error.code = error.message;
    throw error;
  }
  return [
    phasePrefix,
    "youtube",
    String(eventId),
    fingerprint,
  ].join(":");
}

module.exports = {
  canonicalScheduledFor,
  youtubeAdmissionJobIdempotencyKey,
  youtubeReleaseJobIdempotencyKey,
};
