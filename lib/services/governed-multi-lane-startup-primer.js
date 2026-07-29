"use strict";

const GOVERNED_MULTI_LANE_PROFILE = "governed_multi_lane";
const BUCKET_MINUTES = 15;

const STARTUP_JOBS = Object.freeze([
  Object.freeze({
    kind: "governed_youtube_window_inventory_monitor",
    priority: 5,
    planningOnly: true,
    payload: Object.freeze({
      phase: "STARTUP_CANDIDATE_INVENTORY",
      horizon_hours: 36,
      bootstrap_catch_up: false,
      catch_up_allowed: false,
      external_posting: false,
    }),
  }),
  Object.freeze({
    kind: "hunt",
    priority: 5,
    planningOnly: false,
  }),
  Object.freeze({
    kind: "governed_editorial_evidence_backfill",
    priority: 7,
    planningOnly: true,
  }),
  Object.freeze({
    kind: "reconcile_editorial_inventory",
    priority: 8,
    planningOnly: true,
  }),
  Object.freeze({
    kind: "governed_multi_lane_plan",
    priority: 10,
    planningOnly: true,
  }),
  Object.freeze({
    kind: "evergreen_candidate_builder",
    priority: 20,
    planningOnly: true,
  }),
  Object.freeze({
    kind: "plan_weekly_longform",
    priority: 30,
    planningOnly: true,
  }),
]);

function quarterHourBucket(now) {
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("governed_multi_lane_startup_time_invalid");
  }
  parsed.setUTCMinutes(
    Math.floor(parsed.getUTCMinutes() / BUCKET_MINUTES) *
      BUCKET_MINUTES,
    0,
    0,
  );
  return parsed.toISOString();
}

function requiredChannelId(value) {
  const channelId = String(value || "").trim();
  if (!channelId) {
    throw new Error(
      "governed_multi_lane_startup_channel_id_required",
    );
  }
  return channelId;
}

function primeGovernedMultiLaneStartup({
  jobs,
  schedulerProfile,
  channelId,
  now = new Date().toISOString(),
  env = process.env,
} = {}) {
  const selectedProfile = String(schedulerProfile || "").trim();
  if (selectedProfile !== GOVERNED_MULTI_LANE_PROFILE) {
    return {
      status: "SKIPPED",
      reason: "governed_multi_lane_profile_not_active",
      queued_jobs: [],
      safety: {
        database_jobs_enqueued: false,
        network_used: false,
        oauth_mutated: false,
        platform_contacted: false,
        publish_authority_created: false,
      },
    };
  }
  if (!jobs || typeof jobs.enqueue !== "function") {
    throw new Error(
      "governed_multi_lane_startup_jobs_repository_required",
    );
  }

  const exactChannelId = requiredChannelId(channelId);
  const bucket = quarterHourBucket(now);
  const bucketKey = bucket.replace(/[-:.]/g, "");
  const {
    governedLivePublishRequested,
  } = require("./multi-lane-runtime-control");
  const livePublishEnabled =
    governedLivePublishRequested({
      env,
      schedulerProfile: selectedProfile,
    });
  const commonPayload = Object.freeze({
    scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
    governed_multi_lane: true,
    bootstrap_catch_up: true,
    bootstrap_bucket: bucket,
    live_publish_enabled: livePublishEnabled,
    publish_authority: false,
    human_admission_required: true,
    human_review_required: true,
  });
  const queuedJobs = STARTUP_JOBS.map((definition) => {
    const request = {
      kind: definition.kind,
      channel_id: exactChannelId,
      payload: {
        ...commonPayload,
        ...(definition.planningOnly
          ? { planning_only: true }
          : {}),
        ...(definition.payload || {}),
      },
      priority: definition.priority,
      requires_gpu: false,
      max_attempts: 3,
      idempotency_key:
        `governed-startup:${exactChannelId}:` +
        `${bucketKey}:${definition.kind}`,
    };
    const job = jobs.enqueue(request);
    return {
      id: job?.id || null,
      kind: definition.kind,
      idempotency_key: request.idempotency_key,
    };
  });

  return {
    status: "PRIMED",
    scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
    bootstrap_bucket: bucket,
    queued_jobs: queuedJobs,
    safety: {
      database_jobs_enqueued: true,
      network_used: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  };
}

module.exports = {
  GOVERNED_MULTI_LANE_PROFILE,
  STARTUP_JOBS,
  primeGovernedMultiLaneStartup,
  quarterHourBucket,
};
