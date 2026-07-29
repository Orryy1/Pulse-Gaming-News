"use strict";

const {
  SNAPSHOT_WINDOWS_MS,
} = require("../repositories/youtube_analytics_experiment_snapshots");

const SNAPSHOT_WINDOWS = Object.freeze(["24h", "48h", "7d"]);
const COMPLETENESS_SCHEMA =
  "pulse-youtube-analytics-snapshot-completeness-v1";
const REPORTING_LAG_RETRY_SECONDS = Object.freeze({
  "24h": 3600,
  "48h": 1800,
  "7d": 900,
});

function text(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function timestamp(value, code) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error(code);
  }
  return parsed;
}

function held(blocker) {
  return {
    schema_version: "pulse-youtube-analytics-snapshot-fanout-v1",
    verdict: "HOLD",
    blockers: [blocker],
    jobs: [],
    side_effects: {
      analytics_api_contacted: false,
      database_jobs_enqueued: false,
      external_posting: false,
      oauth_mutated: false,
    },
  };
}

function analyticsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveAttempt(value, code) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw analyticsError(code);
  }
  return result;
}

function classifyYouTubeAnalyticsSnapshotCompleteness({
  ingestionResult,
  job,
  snapshotWindow,
} = {}) {
  if (ingestionResult?.status !== "no_data") return null;
  const window = String(snapshotWindow || "").trim();
  const retryAfterSeconds =
    REPORTING_LAG_RETRY_SECONDS[window];
  if (!retryAfterSeconds) {
    throw analyticsError(
      "youtube_analytics_snapshot_window_invalid",
    );
  }
  const attemptCount = positiveAttempt(
    job?.attempt_count,
    "youtube_analytics_job_attempt_count_invalid",
  );
  const maxAttempts = positiveAttempt(
    job?.max_attempts,
    "youtube_analytics_job_max_attempts_invalid",
  );
  if (attemptCount > maxAttempts) {
    throw analyticsError(
      "youtube_analytics_job_attempt_budget_invalid",
    );
  }
  const terminal = attemptCount >= maxAttempts;
  const reason = terminal
    ? "youtube_analytics_summary_reporting_lag_exhausted"
    : "youtube_analytics_summary_reporting_lag";
  const completenessAudit = {
    schema_version: COMPLETENESS_SCHEMA,
    status: terminal
      ? "TERMINAL_INCOMPLETE"
      : "PENDING_REPORTING_LAG",
    terminal,
    complete: false,
    reason,
    snapshot_window: window,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
    retry_after_seconds: terminal
      ? null
      : retryAfterSeconds,
    reporting_lag_buffer_seconds:
      retryAfterSeconds * Math.max(0, maxAttempts - 1),
    source_request: ingestionResult.sourceRequest,
    source_payload: ingestionResult.sourcePayload,
    warnings: Array.isArray(ingestionResult.warnings)
      ? ingestionResult.warnings
      : [],
  };
  if (terminal) {
    return {
      status: "incomplete",
      job_outcome: "TERMINAL",
      retryable: false,
      completeness_status: "TERMINAL_INCOMPLETE",
      blockers: [reason],
      persisted: false,
      completeness_audit: completenessAudit,
    };
  }
  return {
    status: "held",
    job_outcome: "RETRY",
    retryable: true,
    completeness_status: "PENDING_REPORTING_LAG",
    retry_after_seconds: retryAfterSeconds,
    blockers: [reason],
    persisted: false,
    completeness_audit: completenessAudit,
  };
}

function createLiveYouTubeAnalyticsQueryReports({
  env = process.env,
  createAccountBoundSession = null,
  youtubeAnalyticsFactory = null,
} = {}) {
  let analyticsClientPromise = null;
  const loadAnalyticsClient = async () => {
    const youtubeModule = createAccountBoundSession
      ? null
      : require("../../upload_youtube");
    const createSession =
      createAccountBoundSession ||
      youtubeModule.createFreshYoutubeAccountBoundSession;
    const session = await createSession({ env });
    const proof =
      typeof session?.getBindingProof === "function"
        ? session.getBindingProof()
        : null;
    if (
      proof?.analytics?.learning_ready !== true ||
      proof?.analytics?.read_scope_present !== true
    ) {
      throw analyticsError("youtube_analytics_oauth_scope_required");
    }
    if (
      typeof session?.createYoutubeAnalyticsClient !== "function"
    ) {
      throw analyticsError(
        "youtube_analytics_account_bound_session_required",
      );
    }
    const factory =
      youtubeAnalyticsFactory || require("googleapis").google.youtubeAnalytics;
    const client =
      session.createYoutubeAnalyticsClient(factory);
    if (!client?.reports || typeof client.reports.query !== "function") {
      throw analyticsError("youtube_analytics_readonly_client_required");
    }
    return client;
  };

  return async function queryYouTubeAnalyticsReports(
    request,
    { signal } = {},
  ) {
    if (!analyticsClientPromise) {
      analyticsClientPromise = loadAnalyticsClient();
    }
    const client = await analyticsClientPromise;
    return client.reports.query(
      request,
      signal ? { signal } : {},
    );
  };
}

function enqueueConfirmedYouTubeAnalyticsSnapshotJobs({
  jobs,
  controlledExperiments,
  publication,
} = {}) {
  if (!jobs || typeof jobs.enqueueBatch !== "function") {
    throw new Error(
      "youtube_analytics_atomic_jobs_repository_required",
    );
  }
  if (
    !controlledExperiments ||
    typeof controlledExperiments.getAssignment !== "function"
  ) {
    throw new Error(
      "youtube_analytics_controlled_experiments_repository_required",
    );
  }
  if (publication?.confirmed !== true) {
    return held("youtube_analytics_confirmed_publication_required");
  }
  const identity = {
    experimentId: text(
      publication.experimentId,
      "youtube_analytics_experiment_id_required",
    ),
    channelId: text(
      publication.channelId,
      "youtube_analytics_channel_id_required",
    ),
    youtubeChannelId: text(
      publication.youtubeChannelId,
      "youtube_analytics_youtube_channel_id_required",
    ),
    storyId: text(publication.storyId, "youtube_analytics_story_id_required"),
    videoId: text(publication.videoId, "youtube_analytics_video_id_required"),
  };
  const publishedAt = timestamp(
    publication.publishedAt,
    "youtube_analytics_published_at_required",
  ).toISOString();
  const assignment = controlledExperiments.getAssignment({
    experimentId: identity.experimentId,
    channelId: identity.channelId,
    videoId: identity.videoId,
  });
  if (
    !assignment ||
    String(assignment.story_id || "").trim() !== identity.storyId
  ) {
    return held("youtube_analytics_experiment_assignment_required");
  }

  const requests = SNAPSHOT_WINDOWS.map((snapshotWindow) => {
    const runAt = new Date(
      Date.parse(publishedAt) + SNAPSHOT_WINDOWS_MS[snapshotWindow],
    ).toISOString();
    return {
      kind: "youtube_analytics_snapshot",
      channel_id: identity.channelId,
      story_id: identity.storyId,
      payload: {
        ...identity,
        snapshotWindow,
        publishedAt,
        read_only: true,
        external_posting: false,
        oauth_mutation: false,
      },
      priority: 45,
      run_at: runAt,
      max_attempts: 4,
      requires_gpu: false,
      idempotency_key:
        `youtube-analytics-snapshot:` +
        `${identity.channelId}:${identity.videoId}:` +
        snapshotWindow,
    };
  });
  let queuedRows;
  try {
    queuedRows = jobs.enqueueBatch(requests);
  } catch {
    return held(
      "youtube_analytics_snapshot_batch_enqueue_failed",
    );
  }
  const enqueued = requests.map((request, index) => {
    const queued = queuedRows[index];
    return {
      id: Number(queued.id),
      kind: request.kind,
      snapshot_window: request.payload.snapshotWindow,
      run_at: queued.run_at,
      idempotency_key: request.idempotency_key,
    };
  });

  return {
    schema_version: "pulse-youtube-analytics-snapshot-fanout-v1",
    verdict: "GREEN",
    blockers: [],
    experiment_id: identity.experimentId,
    channel_id: identity.channelId,
    youtube_channel_id: identity.youtubeChannelId,
    story_id: identity.storyId,
    video_id: identity.videoId,
    published_at: publishedAt,
    jobs: enqueued,
    side_effects: {
      analytics_api_contacted: false,
      database_jobs_enqueued: true,
      external_posting: false,
      oauth_mutated: false,
    },
  };
}

module.exports = {
  COMPLETENESS_SCHEMA,
  REPORTING_LAG_RETRY_SECONDS,
  SNAPSHOT_WINDOWS,
  classifyYouTubeAnalyticsSnapshotCompleteness,
  createLiveYouTubeAnalyticsQueryReports,
  enqueueConfirmedYouTubeAnalyticsSnapshotJobs,
};
