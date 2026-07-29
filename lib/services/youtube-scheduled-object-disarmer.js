"use strict";

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
    const error = new Error(
      "youtube_schedule_disarm_clock_invalid",
    );
    error.code = "youtube_schedule_disarm_clock_invalid";
    throw error;
  }
  return date;
}

function disarmError(
  code,
  {
    cause = null,
    externalId = null,
    platformContacted = false,
    updateAttemptStarted = false,
    reconciliationRequired = true,
  } = {},
) {
  const error = new Error(code);
  error.name = "YoutubeScheduleDisarmError";
  error.code = code;
  error.externalId = externalId;
  error.platformContacted = platformContacted;
  error.updateAttemptStarted = updateAttemptStarted;
  error.reconciliationRequired = reconciliationRequired;
  if (cause) error.cause = cause;
  return error;
}

function canonicalPublishAt(value) {
  if (!text(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusPublishAt(status) {
  if (!status || !Object.hasOwn(status, "publishAt")) {
    return {
      present: false,
      value: null,
      invalid: false,
    };
  }
  const raw = status.publishAt;
  const parsed = new Date(raw);
  if (
    typeof raw !== "string" ||
    !raw.trim() ||
    Number.isNaN(parsed.getTime())
  ) {
    return {
      present: true,
      value: null,
      invalid: true,
    };
  }
  return {
    present: true,
    value: parsed.toISOString(),
    invalid: false,
  };
}

function mutableYoutubeStatusWithoutPublishAt(status = {}) {
  const projected = { privacyStatus: "private" };
  if (["youtube", "creativeCommon"].includes(text(status.license))) {
    projected.license = text(status.license);
  }
  for (const field of [
    "embeddable",
    "publicStatsViewable",
    "selfDeclaredMadeForKids",
    "containsSyntheticMedia",
  ]) {
    if (typeof status[field] === "boolean") {
      projected[field] = status[field];
    }
  }
  return projected;
}

async function readExactYoutubeStatus({
  youtubeClient,
  externalId,
  phase,
  updateAttemptStarted,
} = {}) {
  let response;
  try {
    response = await youtubeClient.videos.list({
      part: ["status"],
      id: [externalId],
      maxResults: 1,
    });
  } catch (cause) {
    throw disarmError(
      phase === "verification"
        ? "youtube_schedule_disarm_verification_uncertain"
        : "youtube_schedule_disarm_observation_uncertain",
      {
        cause,
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      },
    );
  }
  if (!Array.isArray(response?.data?.items)) {
    throw disarmError(
      phase === "verification"
        ? "youtube_schedule_disarm_verification_uncertain"
        : "youtube_schedule_disarm_observation_uncertain",
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
    throw disarmError(
      response.data.items.length
        ? "youtube_schedule_disarm_object_identity_mismatch"
        : "youtube_schedule_disarm_object_not_found",
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
    throw disarmError(
      "youtube_schedule_disarm_status_invalid",
      {
        externalId,
        platformContacted: true,
        updateAttemptStarted,
      },
    );
  }
  const publishAt = statusPublishAt(status);
  return {
    externalId,
    status,
    privacyStatus: text(status.privacyStatus).toLowerCase(),
    publishAt: publishAt.value,
    publishAtPresent: publishAt.present,
    publishAtInvalid: publishAt.invalid,
  };
}

function disarmEvidence({
  externalId,
  checkedAt,
  alreadyDisarmed,
  preStatus,
  postStatus,
  updateAttemptStarted,
  emergencyContainment = false,
  containmentReason = null,
} = {}) {
  return {
    schema_version: "pulse-youtube-schedule-disarm-proof-v1",
    platform: "youtube",
    platform_object_confirmed: true,
    schedule_disarm_confirmed: true,
    external_id: externalId,
    privacy_status: postStatus.privacyStatus,
    publish_at: postStatus.publishAt,
    publish_at_present: postStatus.publishAtPresent,
    publish_at_invalid: postStatus.publishAtInvalid,
    checked_at: checkedAt,
    already_disarmed: alreadyDisarmed === true,
    update_attempt_started: updateAttemptStarted === true,
    emergency_containment: emergencyContainment === true,
    containment_reason:
      emergencyContainment === true
        ? text(containmentReason)
        : null,
    before: {
      privacy_status: preStatus.privacyStatus,
      publish_at: preStatus.publishAt,
      publish_at_present: preStatus.publishAtPresent,
      publish_at_invalid: preStatus.publishAtInvalid,
    },
  };
}

function createYoutubeScheduledObjectDisarmer({
  youtubeClient,
  now = () => new Date(),
  maxVerificationAgeMs = DEFAULT_MAX_VERIFICATION_AGE_MS,
} = {}) {
  if (
    !youtubeClient?.videos ||
    typeof youtubeClient.videos.list !== "function" ||
    typeof youtubeClient.videos.update !== "function"
  ) {
    throw new Error("youtube_schedule_disarm_client_required");
  }
  if (typeof now !== "function") {
    throw new Error("youtube_schedule_disarm_clock_required");
  }
  const maxAge = Number(maxVerificationAgeMs);
  if (
    !Number.isFinite(maxAge) ||
    maxAge < 0 ||
    maxAge > 15 * 60 * 1000
  ) {
    throw new Error(
      "youtube_schedule_disarm_verification_age_invalid",
    );
  }

  return async function disarmYoutubeScheduledObject(
    candidate = {},
  ) {
    if (text(candidate.platform) !== "youtube") {
      throw disarmError(
        "youtube_schedule_disarm_platform_mismatch",
        { reconciliationRequired: false },
      );
    }
    const externalId = text(
      candidate.externalId || candidate.external_id,
    );
    if (!externalId) {
      throw disarmError(
        "youtube_schedule_disarm_external_id_required",
        { reconciliationRequired: false },
      );
    }
    const scheduledFor = canonicalPublishAt(
      candidate.scheduledFor || candidate.scheduled_for,
    );
    if (!scheduledFor) {
      throw disarmError(
        "youtube_schedule_disarm_scheduled_for_required",
        {
          externalId,
          reconciliationRequired: false,
        },
      );
    }
    const emergencyContainment =
      candidate.emergencyContainment === true;
    const containmentReason = text(
      candidate.containmentReason ||
        candidate.containment_reason,
    );
    if (emergencyContainment && !containmentReason) {
      throw disarmError(
        "youtube_schedule_containment_reason_required",
        {
          externalId,
          reconciliationRequired: false,
        },
      );
    }
    const startedAt = readClock(now);
    const preStatus = await readExactYoutubeStatus({
      youtubeClient,
      externalId,
      phase: "observation",
      updateAttemptStarted: false,
    });
    if (
      preStatus.privacyStatus === "private" &&
      preStatus.publishAt === null &&
      preStatus.publishAtPresent === false &&
      preStatus.publishAtInvalid === false
    ) {
      const checkedAt = readClock(now);
      return {
        confirmed: true,
        alreadyDisarmed: true,
        externalId,
        externalUrl:
          `https://www.youtube.com/watch?v=${encodeURIComponent(
            externalId,
          )}`,
        verifiedAt: checkedAt.toISOString(),
        emergencyContainment,
        compensationRequired: false,
        compensationAttempted: false,
        compensationConfirmed: true,
        preservedStatus:
          mutableYoutubeStatusWithoutPublishAt(preStatus.status),
        evidence: disarmEvidence({
          externalId,
          checkedAt: checkedAt.toISOString(),
          alreadyDisarmed: true,
          preStatus,
          postStatus: preStatus,
          updateAttemptStarted: false,
          emergencyContainment,
          containmentReason,
        }),
      };
    }
    if (
      !emergencyContainment &&
      preStatus.privacyStatus !== "private"
    ) {
      throw disarmError(
        "youtube_schedule_disarm_privacy_mismatch",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted: false,
        },
      );
    }
    if (
      !emergencyContainment &&
      (preStatus.publishAtInvalid ||
        preStatus.publishAtPresent !== true ||
        preStatus.publishAt !== scheduledFor)
    ) {
      throw disarmError(
        "youtube_schedule_disarm_publish_at_mismatch",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted: false,
        },
      );
    }

    await requiredFunction(
      candidate.assertUpdateBoundary,
      "youtube_schedule_disarm_update_boundary_required",
    )();
    await requiredFunction(
      candidate.markUpdateAttemptStarted,
      "youtube_schedule_disarm_update_marker_required",
    )();
    const updateAttemptStarted = true;
    const status =
      mutableYoutubeStatusWithoutPublishAt(preStatus.status);
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
      throw disarmError(
        "youtube_schedule_disarm_update_uncertain",
        {
          cause,
          externalId,
          platformContacted: true,
          updateAttemptStarted,
        },
      );
    }
    if (
      text(response?.data?.id) &&
      text(response.data.id) !== externalId
    ) {
      throw disarmError(
        "youtube_schedule_disarm_update_identity_mismatch",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted,
        },
      );
    }
    const postStatus = await readExactYoutubeStatus({
      youtubeClient,
      externalId,
      phase: "verification",
      updateAttemptStarted,
    });
    const checkedAt = readClock(now);
    if (checkedAt.getTime() - startedAt.getTime() > maxAge) {
      throw disarmError(
        "youtube_schedule_disarm_verification_time_drifted",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted,
        },
      );
    }
    if (
      postStatus.privacyStatus !== "private" ||
      postStatus.publishAt !== null ||
      postStatus.publishAtPresent !== false ||
      postStatus.publishAtInvalid !== false
    ) {
      throw disarmError(
        "youtube_schedule_disarm_verification_failed",
        {
          externalId,
          platformContacted: true,
          updateAttemptStarted,
        },
      );
    }
    return {
      confirmed: true,
      alreadyDisarmed: false,
      externalId,
      externalUrl:
        `https://www.youtube.com/watch?v=${encodeURIComponent(
          externalId,
        )}`,
      verifiedAt: checkedAt.toISOString(),
      emergencyContainment,
      compensationRequired: emergencyContainment,
      compensationAttempted: emergencyContainment,
      compensationConfirmed: emergencyContainment,
      preservedStatus: status,
      evidence: disarmEvidence({
        externalId,
        checkedAt: checkedAt.toISOString(),
        alreadyDisarmed: false,
        preStatus,
        postStatus,
        updateAttemptStarted,
        emergencyContainment,
        containmentReason,
      }),
    };
  };
}

module.exports = {
  DEFAULT_MAX_VERIFICATION_AGE_MS,
  canonicalPublishAt,
  createYoutubeScheduledObjectDisarmer,
  disarmError,
  mutableYoutubeStatusWithoutPublishAt,
  readExactYoutubeStatus,
  statusPublishAt,
};
