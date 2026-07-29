"use strict";

const GOVERNED_MULTI_LANE_PROFILE = "governed_multi_lane";
const DEFAULT_HORIZON_HOURS = 36;
const MIN_HORIZON_HOURS = 24;
const MAX_HORIZON_HOURS = 36;
const MAX_CHECKPOINT_LATENESS_MS = 60 * 1000;
const INCIDENT_WINDOW_MINUTES_AFTER_T0 = 60;
const WINDOW_HOURS_UTC = Object.freeze([9, 19]);

const CHECKPOINTS = Object.freeze([
  Object.freeze({
    phase: "T-90",
    kind: "governed_youtube_runway_t90",
    offset_minutes: -90,
    priority: 4,
  }),
  Object.freeze({
    phase: "T+15",
    kind: "governed_youtube_runway_tplus15",
    offset_minutes: 15,
    priority: 4,
  }),
]);
const T60_CHECKPOINT = Object.freeze({
  phase: "T-60",
  kind: "governed_youtube_runway_t60",
  offset_minutes: -60,
  priority: 3,
});
const AUTONOMOUS_PRE_T90_CHECKPOINT = Object.freeze({
  phase: "T-94",
  kind: "prepare_governed_autonomous_pre_t90_window",
  offset_minutes: -94,
  priority: 3,
});
const RELEASE_EXECUTION_CHECKPOINTS = Object.freeze([
  Object.freeze({
    phase: "T-75",
    kind: "admit_governed_publication",
    offset_minutes: -75,
  }),
  Object.freeze({
    phase: "T-70",
    kind: "prestage_governed_youtube_release",
    offset_minutes: -70,
  }),
  Object.freeze({
    phase: "T-15",
    kind: "verify_governed_youtube_release_tminus15",
    offset_minutes: -15,
  }),
  Object.freeze({
    phase: "T0",
    kind: "verify_governed_youtube_release_t0",
    offset_minutes: 0,
  }),
]);

function utcDate(value) {
  if (value instanceof Date) {
    const parsed = new Date(value.getTime());
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("window_checkpoint_primer_time_invalid");
    }
    return parsed;
  }
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("window_checkpoint_primer_time_required");
  }
  const sqliteUtc =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(sqliteUtc)
  ) {
    throw new Error(
      "window_checkpoint_primer_time_timezone_required",
    );
  }
  const parsed = new Date(sqliteUtc);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("window_checkpoint_primer_time_invalid");
  }
  return parsed;
}

function validatedHorizonHours(value) {
  const hours = Number(value);
  if (
    !Number.isFinite(hours) ||
    hours < MIN_HORIZON_HOURS ||
    hours > MAX_HORIZON_HOURS
  ) {
    throw new Error(
      "window_checkpoint_primer_horizon_must_be_24_to_36_hours",
    );
  }
  return hours;
}

function checkpointPayload(definition, publishHourUtc) {
  return {
    phase: definition.phase,
    publish_hour_utc: publishHourUtc,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
    scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
    governed_multi_lane: true,
    live_publish_enabled: false,
    human_admission_required: true,
  };
}

function checkpointIdempotencyKey(
  definition,
  scheduledAt,
) {
  const prefix =
    definition.kind === "governed_youtube_runway_t90"
      ? "governed_youtube_runway_t90"
      : "governed_youtube_runway_tplus15";
  const date = scheduledAt.toISOString().slice(0, 10);
  const hour = String(
    scheduledAt.getUTCHours(),
  ).padStart(2, "0");
  return `${prefix}:${date}:${hour}`;
}

function buildGovernedYoutubeWindowCheckpointPlan({
  now = new Date(),
  horizonHours = DEFAULT_HORIZON_HOURS,
} = {}) {
  const evaluatedAt = utcDate(now);
  const exactHorizonHours =
    validatedHorizonHours(horizonHours);
  const horizonEndsAt = new Date(
    evaluatedAt.getTime() +
      exactHorizonHours * 60 * 60 * 1000,
  );
  const currentUtcMidnight = Date.UTC(
    evaluatedAt.getUTCFullYear(),
    evaluatedAt.getUTCMonth(),
    evaluatedAt.getUTCDate(),
  );
  const requests = [];
  const elapsedCheckpoints = [];

  for (let day = 0; day <= 2; day += 1) {
    for (const publishHourUtc of WINDOW_HOURS_UTC) {
      const scheduledAt = new Date(
        currentUtcMidnight +
          day * 24 * 60 * 60 * 1000 +
          publishHourUtc * 60 * 60 * 1000,
      );
      for (const definition of CHECKPOINTS) {
        const runAt = new Date(
          scheduledAt.getTime() +
            definition.offset_minutes * 60 * 1000,
        );
        if (runAt.getTime() < evaluatedAt.getTime()) {
          const incidentObservationEndsAt =
            scheduledAt.getTime() +
            INCIDENT_WINDOW_MINUTES_AFTER_T0 *
              60 *
              1000;
          if (
            evaluatedAt.getTime() <=
            incidentObservationEndsAt
          ) {
            elapsedCheckpoints.push({
              kind: definition.kind,
              phase: definition.phase,
              scheduled_for: scheduledAt.toISOString(),
              run_at: runAt.toISOString(),
              idempotency_key: checkpointIdempotencyKey(
                definition,
                scheduledAt,
              ),
              queue_action: "SKIP_PAST",
              recovery_action:
                "VERIFY_EVIDENCE_THEN_INCIDENT_ONLY",
              catch_up_allowed: false,
              publish_authority: false,
              external_posting: false,
            });
          }
          continue;
        }
        if (runAt.getTime() > horizonEndsAt.getTime()) {
          continue;
        }
        requests.push({
          kind: definition.kind,
          channel_id: null,
          payload: checkpointPayload(
            definition,
            publishHourUtc,
          ),
          priority: definition.priority,
          requires_gpu: false,
          max_attempts: 3,
          run_at: runAt.toISOString(),
          idempotency_key: checkpointIdempotencyKey(
            definition,
            scheduledAt,
          ),
          phase: definition.phase,
          scheduled_for: scheduledAt.toISOString(),
        });
      }
    }
  }

  requests.sort(
    (left, right) =>
      Date.parse(left.run_at) - Date.parse(right.run_at) ||
      left.kind.localeCompare(right.kind),
  );
  return {
    schema_version:
      "pulse-governed-youtube-window-checkpoint-plan-v1",
    planned_at: evaluatedAt.toISOString(),
    horizon_ends_at: horizonEndsAt.toISOString(),
    horizon_hours: exactHorizonHours,
    requests,
    elapsed_checkpoints: elapsedCheckpoints,
  };
}

function governedYoutubeWindowCheckpointPrimingContract() {
  return {
    schema_version:
      "pulse-governed-youtube-window-checkpoint-priming-contract-v1",
    scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
    invocation: {
      startup_required: true,
      daily_refresh_required: true,
      daily_refresh_cron_utc: "5 0 * * *",
      timezone: "UTC",
      horizon_hours: DEFAULT_HORIZON_HOURS,
      durable_jobs_repository_required: true,
      execute_checkpoints_inline: false,
    },
    windows: {
      publish_hours_utc: [...WINDOW_HOURS_UTC],
      checkpoint_kinds: CHECKPOINTS.map(
        (checkpoint) => checkpoint.kind,
      ),
      exact_offsets_minutes_from_t0:
        Object.fromEntries(
          CHECKPOINTS.map((checkpoint) => [
            checkpoint.phase,
            checkpoint.offset_minutes,
          ]),
        ),
    },
    enqueue: {
      canonical_utc_run_at_required: true,
      explicit_run_at_required: true,
      window_scoped_idempotency_required: true,
      cron_payload_and_idempotency_compatibility_required:
        true,
      already_past_queue_action: "SKIP_PAST",
    },
    handler: {
      authoritative_due_field: "job.run_at",
      maximum_start_lateness_seconds: 60,
      late_disposition:
        "WRITE_MISSED_INTERNAL_INCIDENT_ONLY",
      retry_late_checkpoint: false,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    downstream_from_t90: {
      durable_t60_job_required: true,
      kind: T60_CHECKPOINT.kind,
      exact_offset_minutes_from_t0:
        T60_CHECKPOINT.offset_minutes,
      authoritative_due_field: "job.run_at",
      deterministic_enqueue_required: true,
      private_only: true,
      unarmed_disposition: "HOLD",
      unarmed_blocker:
        "runway_t60_private_prestage_not_armed",
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    payload_invariants: {
      scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
      governed_multi_lane: true,
      live_publish_enabled: false,
      human_admission_required: true,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
  };
}

function evaluateGovernedYoutubeCheckpointExecutionTime({
  kind,
  runAt,
  now = new Date(),
} = {}) {
  if (
    ![
      ...CHECKPOINTS,
      AUTONOMOUS_PRE_T90_CHECKPOINT,
      T60_CHECKPOINT,
      ...RELEASE_EXECUTION_CHECKPOINTS,
    ].some(
      (checkpoint) => checkpoint.kind === kind,
    )
  ) {
    throw new Error(
      "window_checkpoint_primer_checkpoint_kind_invalid",
    );
  }
  const dueAt = utcDate(runAt);
  const evaluatedAt = utcDate(now);
  const latenessMs =
    evaluatedAt.getTime() - dueAt.getTime();
  if (latenessMs < 0) {
    return {
      status: "NOT_DUE",
      classification: null,
      due_at: dueAt.toISOString(),
      evaluated_at: evaluatedAt.toISOString(),
      lateness_ms: latenessMs,
      maximum_lateness_ms:
        MAX_CHECKPOINT_LATENESS_MS,
      execute_checkpoint: false,
      catch_up_allowed: false,
      recovery_action: "WAIT_UNTIL_DUE",
    };
  }
  if (latenessMs > MAX_CHECKPOINT_LATENESS_MS) {
    return {
      status: "MISSED",
      classification: "MISSED_INTERNAL",
      due_at: dueAt.toISOString(),
      evaluated_at: evaluatedAt.toISOString(),
      lateness_ms: latenessMs,
      maximum_lateness_ms:
        MAX_CHECKPOINT_LATENESS_MS,
      execute_checkpoint: false,
      catch_up_allowed: false,
      recovery_action:
        "WRITE_MISSED_INTERNAL_INCIDENT_ONLY",
    };
  }
  return {
    status: "ACCEPTED",
    classification: null,
    due_at: dueAt.toISOString(),
    evaluated_at: evaluatedAt.toISOString(),
    lateness_ms: latenessMs,
    maximum_lateness_ms: MAX_CHECKPOINT_LATENESS_MS,
    execute_checkpoint: true,
    catch_up_allowed: false,
    recovery_action: null,
  };
}

function buildGovernedYoutubeT60PrestageJob({
  lock,
  channelId = null,
} = {}) {
  if (!lock || typeof lock !== "object") {
    throw new Error("window_checkpoint_primer_t60_lock_required");
  }
  const scheduledAt = utcDate(lock.scheduled_for);
  if (
    !WINDOW_HOURS_UTC.includes(scheduledAt.getUTCHours()) ||
    scheduledAt.getUTCMinutes() !== 0 ||
    scheduledAt.getUTCSeconds() !== 0 ||
    scheduledAt.getUTCMilliseconds() !== 0
  ) {
    throw new Error(
      "window_checkpoint_primer_t60_window_not_guarded",
    );
  }
  const lockSha256 = String(lock.lock_sha256 || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(lockSha256)) {
    throw new Error(
      "window_checkpoint_primer_t60_lock_sha256_required",
    );
  }
  const storyId = String(
    lock.primary?.story_id || "",
  ).trim();
  if (!storyId) {
    throw new Error(
      "window_checkpoint_primer_t60_primary_story_required",
    );
  }
  const laneId =
    String(lock.primary?.lane_id || "").trim() ||
    "breaking_short";
  const runAt = new Date(
    scheduledAt.getTime() +
      T60_CHECKPOINT.offset_minutes * 60 * 1000,
  );
  const date = scheduledAt.toISOString().slice(0, 10);
  const hour = String(
    scheduledAt.getUTCHours(),
  ).padStart(2, "0");
  return {
    kind: T60_CHECKPOINT.kind,
    channel_id: String(channelId || "").trim() || null,
    story_id: storyId,
    payload: {
      phase: T60_CHECKPOINT.phase,
      scheduled_for: scheduledAt.toISOString(),
      story_id: storyId,
      lane_id: laneId,
      platform: "youtube",
      scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
      runway_lock_sha256: lockSha256,
      private_only: true,
      private_prestage_authority: false,
      readiness_verification_authority: true,
      human_review_required: true,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    priority: T60_CHECKPOINT.priority,
    requires_gpu: false,
    max_attempts: 46,
    run_at: runAt.toISOString(),
    idempotency_key:
      `governed_youtube_runway_t60:${date}:${hour}:` +
      lockSha256,
  };
}

function primeGovernedYoutubeWindowCheckpoints({
  jobs,
  schedulerProfile,
  now = new Date(),
  horizonHours = DEFAULT_HORIZON_HOURS,
} = {}) {
  const selectedProfile = String(
    schedulerProfile || "",
  ).trim();
  if (selectedProfile !== GOVERNED_MULTI_LANE_PROFILE) {
    return {
      status: "SKIPPED",
      reason: "governed_multi_lane_profile_not_active",
      queued_jobs: [],
      elapsed_checkpoints: [],
      safety: {
        database_jobs_enqueued: false,
        network_used: false,
        oauth_mutated: false,
        platform_contacted: false,
        external_posting: false,
        publish_authority_created: false,
        catch_up_allowed: false,
      },
    };
  }
  if (!jobs || typeof jobs.enqueue !== "function") {
    throw new Error(
      "window_checkpoint_primer_jobs_repository_required",
    );
  }
  const plan = buildGovernedYoutubeWindowCheckpointPlan({
    now,
    horizonHours,
  });
  const queuedJobs = plan.requests.map((request) => {
    const {
      phase,
      scheduled_for: scheduledFor,
      ...jobRequest
    } = request;
    const job = jobs.enqueue(jobRequest);
    return {
      id: job?.id || null,
      kind: request.kind,
      phase,
      scheduled_for: scheduledFor,
      run_at: request.run_at,
      idempotency_key: request.idempotency_key,
    };
  });
  return {
    status: "PRIMED",
    scheduler_profile: GOVERNED_MULTI_LANE_PROFILE,
    planned_at: plan.planned_at,
    horizon_ends_at: plan.horizon_ends_at,
    horizon_hours: plan.horizon_hours,
    queued_jobs: queuedJobs,
    elapsed_checkpoints: plan.elapsed_checkpoints,
    safety: {
      database_jobs_enqueued: queuedJobs.length > 0,
      network_used: false,
      oauth_mutated: false,
      platform_contacted: false,
      external_posting: false,
      publish_authority_created: false,
      catch_up_allowed: false,
    },
  };
}

module.exports = {
  CHECKPOINTS,
  DEFAULT_HORIZON_HOURS,
  GOVERNED_MULTI_LANE_PROFILE,
  MAX_CHECKPOINT_LATENESS_MS,
  MAX_HORIZON_HOURS,
  MIN_HORIZON_HOURS,
  T60_CHECKPOINT,
  WINDOW_HOURS_UTC,
  buildGovernedYoutubeT60PrestageJob,
  buildGovernedYoutubeWindowCheckpointPlan,
  evaluateGovernedYoutubeCheckpointExecutionTime,
  governedYoutubeWindowCheckpointPrimingContract,
  primeGovernedYoutubeWindowCheckpoints,
};
