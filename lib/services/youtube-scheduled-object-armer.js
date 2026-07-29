"use strict";

const {
  resolveYoutubeScheduledPublishAt,
} = require("./youtube-scheduled-release-contract");
const {
  mutableYoutubeStatusWithoutPublishAt,
} = require("./youtube-scheduled-object-disarmer");

const DEFAULT_MAX_VERIFICATION_AGE_MS = 5 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function requiredFunction(value, code) {
  if (typeof value !== "function") {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return value;
}

function readClock(now) {
  const value = now();
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw armError("youtube_schedule_arm_clock_invalid", {
      reconciliationRequired: false,
    });
  }
  return date;
}

function armError(
  code,
  {
    cause = null,
    externalId = null,
    platformContacted = false,
    updateAttemptStarted = false,
    reconciliationRequired = true,
    compensationRequired = false,
    compensationReason = null,
    expectedScheduledObject = false,
    observedRemoteState = null,
  } = {},
) {
  const error = new Error(code);
  error.name = "YoutubeScheduleArmError";
  error.code = code;
  error.externalId = externalId;
  error.platformContacted = platformContacted;
  error.updateAttemptStarted = updateAttemptStarted;
  error.reconciliationRequired = reconciliationRequired;
  error.compensationRequired =
    compensationRequired === true;
  error.compensationReason =
    compensationRequired === true
      ? text(compensationReason)
      : null;
  error.expectedScheduledObject =
    expectedScheduledObject === true;
  error.observedRemoteState =
    observedRemoteState;
  error.remoteContainmentRequired =
    compensationRequired === true;
  error.remoteDisarmRequired =
    error.remoteContainmentRequired;
  if (cause) error.cause = cause;
  return error;
}

function statusPublishAt(status) {
  if (!status || !Object.hasOwn(status, "publishAt")) {
    return { present: false, value: null, invalid: false };
  }
  const raw = status.publishAt;
  const parsed = new Date(raw);
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    Number.isNaN(parsed.getTime())
  ) {
    return { present: true, value: null, invalid: true };
  }
  return {
    present: true,
    value: parsed.toISOString(),
    invalid: false,
  };
}

async function readExactYoutubeStatus({
  youtubeClient,
  externalId,
  phase,
  updateAttemptStarted,
}) {
  let response;
  try {
    response = await youtubeClient.videos.list({
      part: ["status"],
      id: [externalId],
      maxResults: 1,
    });
  } catch (cause) {
    throw armError(
      phase === "verification"
        ? "youtube_schedule_arm_verification_uncertain"
        : "youtube_schedule_arm_observation_uncertain",
      {
        cause,
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      },
    );
  }
  if (!Array.isArray(response?.data?.items)) {
    throw armError(
      phase === "verification"
        ? "youtube_schedule_arm_verification_uncertain"
        : "youtube_schedule_arm_observation_uncertain",
      {
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      },
    );
  }
  const exact = response.data.items.find(
    (item) => text(item?.id) === externalId,
  );
  if (!exact) {
    throw armError(
      response.data.items.length
        ? "youtube_schedule_arm_object_identity_mismatch"
        : "youtube_schedule_arm_object_not_found",
      {
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      },
    );
  }
  const status =
    exact.status &&
    typeof exact.status === "object" &&
    !Array.isArray(exact.status)
      ? exact.status
      : null;
  if (!status) {
    throw armError("youtube_schedule_arm_status_invalid", {
      externalId,
      platformContacted: true,
      updateAttemptStarted,
    });
  }
  return {
    externalId,
    status,
    privacyStatus: text(status.privacyStatus).toLowerCase(),
    publishAt: statusPublishAt(status),
  };
}

function createYoutubeScheduledObjectArmer({
  youtubeClient,
  now = () => new Date(),
  maxVerificationAgeMs = DEFAULT_MAX_VERIFICATION_AGE_MS,
} = {}) {
  if (
    !youtubeClient?.videos ||
    typeof youtubeClient.videos.list !== "function" ||
    typeof youtubeClient.videos.update !== "function"
  ) {
    throw new Error("youtube_schedule_arm_client_required");
  }
  if (typeof now !== "function") {
    throw new Error("youtube_schedule_arm_clock_required");
  }
  const maxAge = Number(maxVerificationAgeMs);
  if (
    !Number.isFinite(maxAge) ||
    maxAge < 0 ||
    maxAge > 15 * 60 * 1000
  ) {
    throw new Error("youtube_schedule_arm_verification_age_invalid");
  }

  return async function armYoutubeScheduledObject(candidate = {}) {
    if (text(candidate.platform) !== "youtube") {
      throw armError("youtube_schedule_arm_platform_mismatch", {
        reconciliationRequired: false,
      });
    }
    const externalId = text(
      candidate.externalId || candidate.external_id,
    );
    if (!externalId) {
      throw armError("youtube_schedule_arm_external_id_required", {
        reconciliationRequired: false,
      });
    }
    const startedAt = readClock(now);
    const scheduledFor = resolveYoutubeScheduledPublishAt(
      candidate.scheduledFor || candidate.scheduled_for,
      { now: startedAt, requireFuture: true },
    );
    const preStatus = await readExactYoutubeStatus({
      youtubeClient,
      externalId,
      phase: "observation",
      updateAttemptStarted: false,
    });
    const observedRemoteState = {
      external_id: externalId,
      privacy_status: preStatus.privacyStatus || null,
      publish_at: preStatus.publishAt.value,
      publish_at_present: preStatus.publishAt.present,
      publish_at_invalid: preStatus.publishAt.invalid,
    };
    const expectedScheduledObject =
      preStatus.privacyStatus === "private" &&
      preStatus.publishAt.invalid === false &&
      preStatus.publishAt.present === true &&
      preStatus.publishAt.value === scheduledFor;
    if (preStatus.privacyStatus !== "private") {
      throw armError("youtube_schedule_arm_privacy_mismatch", {
        externalId,
        platformContacted: true,
        compensationRequired: true,
        compensationReason:
          preStatus.privacyStatus === "public"
            ? "youtube_private_object_published_early"
            : "youtube_private_object_privacy_not_private",
        observedRemoteState,
      });
    }
    if (
      preStatus.publishAt.present ||
      preStatus.publishAt.invalid ||
      preStatus.publishAt.value !== null
    ) {
      throw armError(
        "youtube_schedule_arm_requires_private_unscheduled_object",
        {
          externalId,
          platformContacted: true,
          compensationRequired: true,
          compensationReason:
            preStatus.publishAt.invalid
              ? "youtube_private_object_publish_at_invalid"
              : "youtube_private_object_unexpected_publish_at",
          expectedScheduledObject,
          observedRemoteState,
        },
      );
    }

    await requiredFunction(
      candidate.assertUpdateBoundary,
      "youtube_schedule_arm_update_boundary_required",
    )();
    await requiredFunction(
      candidate.markUpdateAttemptStarted,
      "youtube_schedule_arm_update_marker_required",
    )();
    const updateAttemptStarted = true;
    const status = {
      ...mutableYoutubeStatusWithoutPublishAt(preStatus.status),
      publishAt: scheduledFor,
    };
    let response;
    try {
      response = await youtubeClient.videos.update({
        part: ["status"],
        requestBody: {
          id: externalId,
          status,
        },
      });
    } catch (cause) {
      throw armError("youtube_schedule_arm_update_uncertain", {
        cause,
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      });
    }
    if (
      text(response?.data?.id) &&
      text(response.data.id) !== externalId
    ) {
      throw armError("youtube_schedule_arm_update_identity_mismatch", {
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      });
    }
    const postStatus = await readExactYoutubeStatus({
      youtubeClient,
      externalId,
      phase: "verification",
      updateAttemptStarted,
    });
    const checkedAt = readClock(now);
    if (checkedAt.getTime() - startedAt.getTime() > maxAge) {
      throw armError(
        "youtube_schedule_arm_verification_time_drifted",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted,
        },
      );
    }
    if (
      postStatus.privacyStatus !== "private" ||
      postStatus.publishAt.invalid ||
      postStatus.publishAt.value !== scheduledFor
    ) {
      throw armError("youtube_schedule_arm_verification_failed", {
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      });
    }
    return {
      confirmed: true,
      externalId,
      externalUrl:
        `https://www.youtube.com/watch?v=${encodeURIComponent(
          externalId,
        )}`,
      scheduledFor,
      verifiedAt: checkedAt.toISOString(),
      updateAttemptStarted,
      preservedStatus: status,
      evidence: {
        schema_version: "pulse-youtube-schedule-arm-proof-v1",
        platform: "youtube",
        platform_object_confirmed: true,
        schedule_arm_confirmed: true,
        scheduled_release_confirmed: true,
        external_id: externalId,
        privacy_status: "private",
        publish_at: scheduledFor,
        release_armed: true,
        checked_at: checkedAt.toISOString(),
        update_attempt_started: true,
        before: {
          privacy_status: preStatus.privacyStatus,
          publish_at: null,
          release_armed: false,
        },
      },
    };
  };
}

module.exports = {
  DEFAULT_MAX_VERIFICATION_AGE_MS,
  armError,
  createYoutubeScheduledObjectArmer,
  readExactYoutubeStatus,
  statusPublishAt,
};
