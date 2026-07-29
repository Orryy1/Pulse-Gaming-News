"use strict";

const crypto = require("node:crypto");
const {
  ASSIGNMENT_POLICY,
  normaliseCreativeManifest,
} = require("./controlled_video_experiments");

const SNAPSHOT_WINDOWS_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
});

const METRIC_COLUMNS = Object.freeze([
  "views",
  "engaged_views",
  "shown_in_feed",
  "stayed_to_watch_percent",
  "swiped_away_percent",
  "retention_1_second_percent",
  "retention_3_second_percent",
  "retention_10_second_percent",
  "retention_25_percent",
  "retention_50_percent",
  "retention_75_percent",
  "retention_90_percent",
  "completion_percent",
  "average_view_duration_seconds",
  "average_percentage_viewed",
  "watch_hours",
  "likes",
  "comments",
  "shares",
  "saves",
  "subscribers_gained",
  "subscribers_lost",
  "new_viewers",
  "returning_viewers",
]);

const INTEGER_METRICS = new Set([
  "views",
  "engaged_views",
  "shown_in_feed",
  "likes",
  "comments",
  "shares",
  "saves",
  "subscribers_gained",
  "subscribers_lost",
  "new_viewers",
  "returning_viewers",
]);

const BREAKDOWN_COLUMNS = Object.freeze({
  traffic_sources: "traffic_sources_json",
  retention_curve: "retention_curve_json",
  country: "country_breakdown_json",
  age: "age_breakdown_json",
  device: "device_breakdown_json",
});

const EARLY_RETENTION_TARGETS = Object.freeze([
  Object.freeze({
    metric: "retention_1_second_percent",
    seconds: 1,
  }),
  Object.freeze({
    metric: "retention_3_second_percent",
    seconds: 3,
  }),
  Object.freeze({
    metric: "retention_10_second_percent",
    seconds: 10,
  }),
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function requireText(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function timestamp(value, code) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed;
}

function normaliseMetrics(metrics) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new Error("youtube_analytics_observed_metrics_required");
  }
  const keys = Object.keys(metrics).sort();
  if (keys.length === 0) {
    throw new Error("youtube_analytics_observed_metrics_required");
  }
  const result = {};
  for (const key of keys) {
    if (!METRIC_COLUMNS.includes(key)) {
      throw new Error(`youtube_analytics_metric_not_supported:${key}`);
    }
    const value = metrics[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      (INTEGER_METRICS.has(key) && !Number.isInteger(value))
    ) {
      throw new Error(`youtube_analytics_metric_invalid:${key}`);
    }
    result[key] = value;
  }
  return result;
}

function normaliseBreakdowns(breakdowns) {
  if (breakdowns === null || breakdowns === undefined) return {};
  if (typeof breakdowns !== "object" || Array.isArray(breakdowns)) {
    throw new Error("youtube_analytics_breakdowns_invalid");
  }
  const result = {};
  for (const [key, value] of Object.entries(breakdowns)) {
    const column = BREAKDOWN_COLUMNS[key];
    if (!column) {
      throw new Error(`youtube_analytics_breakdown_not_supported:${key}`);
    }
    result[column] = stableJson(value);
  }
  return result;
}

function readAssignmentCreativeManifest(assignment) {
  const json = String(assignment?.creative_manifest_json || "");
  const expectedSha256 = String(
    assignment?.creative_manifest_sha256 || "",
  );
  const observedSha256 = crypto
    .createHash("sha256")
    .update(json)
    .digest("hex");
  if (
    !json ||
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    observedSha256 !== expectedSha256
  ) {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  let parsedManifest;
  try {
    parsedManifest = JSON.parse(json);
  } catch {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  if (
    !parsedManifest ||
    typeof parsedManifest !== "object" ||
    Array.isArray(parsedManifest)
  ) {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  let normalised;
  try {
    normalised = normaliseCreativeManifest(parsedManifest);
  } catch {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  if (
    normalised.json !== json ||
    normalised.sha256 !== expectedSha256 ||
    normalised.manifest.consequence_lane !==
      assignment.editorial_lane ||
    normalised.manifest.hook_type !== assignment.hook_type ||
    normalised.manifest.runtime_seconds <
      Number(assignment.runtime_min_seconds) ||
    normalised.manifest.runtime_seconds >
      Number(assignment.runtime_max_seconds)
  ) {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  return normalised.manifest;
}

function rounded(value, decimalPlaces = 12) {
  return Number(value.toFixed(decimalPlaces));
}

function observedRetentionPoints(retentionCurve) {
  if (!Array.isArray(retentionCurve)) return [];
  const points = [];
  for (const point of retentionCurve) {
    const elapsedRatio = point?.elapsed_video_time_ratio;
    const audienceRatio = point?.audience_watch_ratio;
    if (
      typeof elapsedRatio !== "number" ||
      !Number.isFinite(elapsedRatio) ||
      elapsedRatio < 0 ||
      elapsedRatio > 1 ||
      typeof audienceRatio !== "number" ||
      !Number.isFinite(audienceRatio) ||
      audienceRatio < 0
    ) {
      continue;
    }
    points.push({
      elapsed_video_time_ratio: elapsedRatio,
      audience_watch_ratio: audienceRatio,
    });
  }
  points.sort(
    (left, right) =>
      left.elapsed_video_time_ratio -
      right.elapsed_video_time_ratio,
  );
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (
      previous.elapsed_video_time_ratio ===
        current.elapsed_video_time_ratio &&
      previous.audience_watch_ratio !== current.audience_watch_ratio
    ) {
      return [];
    }
  }
  return points.filter(
    (point, index) =>
      index === 0 ||
      point.elapsed_video_time_ratio !==
        points[index - 1].elapsed_video_time_ratio,
  );
}

function deriveEarlyRetentionMetrics({
  retentionCurve,
  runtimeSeconds,
  creativeManifestSha256,
  observedMetrics,
} = {}) {
  const metrics = {};
  const derivations = {};
  if (
    typeof runtimeSeconds !== "number" ||
    !Number.isFinite(runtimeSeconds) ||
    runtimeSeconds <= 0 ||
    !/^[a-f0-9]{64}$/.test(
      String(creativeManifestSha256 || ""),
    )
  ) {
    return { metrics, derivations };
  }
  const points = observedRetentionPoints(retentionCurve);
  if (points.length === 0) return { metrics, derivations };
  const retentionCurveSha256 = crypto
    .createHash("sha256")
    .update(stableJson(retentionCurve))
    .digest("hex");

  for (const target of EARLY_RETENTION_TARGETS) {
    if (Object.hasOwn(observedMetrics || {}, target.metric)) continue;
    const targetRatio = target.seconds / runtimeSeconds;
    if (targetRatio < 0 || targetRatio > 1) continue;
    const exact = points.find(
      (point) =>
        Math.abs(
          point.elapsed_video_time_ratio - targetRatio,
        ) <= 1e-12,
    );
    if (exact) {
      const resultPercent = rounded(
        exact.audience_watch_ratio * 100,
        6,
      );
      metrics[target.metric] = resultPercent;
      derivations[target.metric] = {
        method: "exact_observed_curve_point_v1",
        source: "retention_curve",
        runtime_source:
          "immutable_assignment_creative_manifest.runtime_seconds",
        assignment_creative_manifest_sha256:
          creativeManifestSha256,
        retention_curve_sha256: retentionCurveSha256,
        runtime_seconds: runtimeSeconds,
        target_seconds: target.seconds,
        target_elapsed_video_time_ratio: rounded(targetRatio),
        observation: exact,
        result_percent: resultPercent,
      };
      continue;
    }
    const lower = [...points]
      .reverse()
      .find(
        (point) => point.elapsed_video_time_ratio < targetRatio,
      );
    const upper = points.find(
      (point) => point.elapsed_video_time_ratio > targetRatio,
    );
    if (!lower || !upper) continue;
    const interpolationFraction =
      (targetRatio - lower.elapsed_video_time_ratio) /
      (upper.elapsed_video_time_ratio -
        lower.elapsed_video_time_ratio);
    const interpolatedAudienceRatio =
      lower.audience_watch_ratio +
      interpolationFraction *
        (upper.audience_watch_ratio - lower.audience_watch_ratio);
    const resultPercent = rounded(
      interpolatedAudienceRatio * 100,
      6,
    );
    metrics[target.metric] = resultPercent;
    derivations[target.metric] = {
      method: "linear_interpolation_elapsed_video_time_ratio_v1",
      source: "retention_curve",
      runtime_source:
        "immutable_assignment_creative_manifest.runtime_seconds",
      assignment_creative_manifest_sha256:
        creativeManifestSha256,
      retention_curve_sha256: retentionCurveSha256,
      runtime_seconds: runtimeSeconds,
      target_seconds: target.seconds,
      target_elapsed_video_time_ratio: rounded(targetRatio),
      lower_observation: lower,
      upper_observation: upper,
      interpolation_fraction: rounded(interpolationFraction),
      result_percent: resultPercent,
    };
  }
  return { metrics, derivations };
}

function bind(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("youtube_analytics_snapshot_database_required");
  }
  const getAssignment = db.prepare(`
    SELECT
      cell.*,
      experiment.assignment_policy AS experiment_assignment_policy
    FROM controlled_video_experiment_cells AS cell
    JOIN controlled_video_experiments AS experiment
      ON experiment.experiment_id = cell.experiment_id
    WHERE cell.experiment_id = ?
      AND cell.channel_id = ?
      AND cell.video_id = ?
  `);
  const getSnapshotStatement = db.prepare(`
    SELECT *
    FROM youtube_analytics_experiment_snapshots
    WHERE experiment_id = ?
      AND channel_id = ?
      AND youtube_channel_id = ?
      AND video_id = ?
      AND snapshot_window = ?
  `);
  const insertSnapshot = db.prepare(`
    INSERT INTO youtube_analytics_experiment_snapshots (
      experiment_id, experiment_cell_id, channel_id, youtube_channel_id,
      story_id, video_id,
      snapshot_window, published_at, snapshot_due_at, collected_at,
      source_system, source_fingerprint, observed_metrics_json,
      metric_derivations_json, source_request_json, source_payload_json,
      views, engaged_views, shown_in_feed, stayed_to_watch_percent,
      swiped_away_percent, retention_1_second_percent,
      retention_3_second_percent, retention_10_second_percent,
      retention_25_percent, retention_50_percent, retention_75_percent,
      retention_90_percent, completion_percent,
      average_view_duration_seconds, average_percentage_viewed, watch_hours,
      likes, comments, shares, saves, subscribers_gained, subscribers_lost,
      new_viewers, returning_viewers, traffic_sources_json,
      retention_curve_json, country_breakdown_json, age_breakdown_json,
      device_breakdown_json
    ) VALUES (
      @experimentId, @experimentCellId, @channelId, @youtubeChannelId,
      @storyId, @videoId,
      @snapshotWindow, @publishedAt, @snapshotDueAt, @collectedAt,
      'youtube_analytics_api_readonly', @sourceFingerprint,
      @observedMetricsJson, @metricDerivationsJson,
      @sourceRequestJson, @sourcePayloadJson,
      @views, @engaged_views, @shown_in_feed, @stayed_to_watch_percent,
      @swiped_away_percent, @retention_1_second_percent,
      @retention_3_second_percent, @retention_10_second_percent,
      @retention_25_percent, @retention_50_percent, @retention_75_percent,
      @retention_90_percent, @completion_percent,
      @average_view_duration_seconds, @average_percentage_viewed, @watch_hours,
      @likes, @comments, @shares, @saves, @subscribers_gained,
      @subscribers_lost, @new_viewers, @returning_viewers,
      @traffic_sources_json, @retention_curve_json, @country_breakdown_json,
      @age_breakdown_json, @device_breakdown_json
    )
  `);
  const getById = db.prepare(`
    SELECT *
    FROM youtube_analytics_experiment_snapshots
    WHERE id = ?
  `);

  const recordSnapshotTransaction = db.transaction(
    ({
      experimentId,
      channelId,
      youtubeChannelId,
      storyId,
      videoId,
      snapshotWindow,
      publishedAt,
      collectedAt,
      metrics,
      breakdowns = null,
      sourcePayload,
      sourceRequest = null,
    }) => {
      const identity = {
        experimentId: requireText(
          experimentId,
          "youtube_analytics_experiment_id_required",
        ),
        channelId: requireText(
          channelId,
          "youtube_analytics_channel_id_required",
        ),
        youtubeChannelId: requireText(
          youtubeChannelId,
          "youtube_analytics_youtube_channel_id_required",
        ),
        storyId: requireText(
          storyId,
          "youtube_analytics_story_id_required",
        ),
        videoId: requireText(
          videoId,
          "youtube_analytics_video_id_required",
        ),
      };
      const normalisedWindow = requireText(
        snapshotWindow,
        "youtube_analytics_snapshot_window_required",
      );
      const windowMs = SNAPSHOT_WINDOWS_MS[normalisedWindow];
      if (!windowMs) throw new Error("youtube_analytics_snapshot_window_invalid");
      const published = timestamp(
        publishedAt,
        "youtube_analytics_published_at_required",
      );
      const collected = timestamp(
        collectedAt,
        "youtube_analytics_collected_at_required",
      );
      const dueAt = new Date(published.getTime() + windowMs);
      if (collected.getTime() < dueAt.getTime()) {
        throw new Error("youtube_analytics_snapshot_window_not_due");
      }
      const assignment = getAssignment.get(
        identity.experimentId,
        identity.channelId,
        identity.videoId,
      );
      if (!assignment || assignment.story_id !== identity.storyId) {
        throw new Error("youtube_analytics_experiment_assignment_required");
      }
      if (
        assignment.experiment_assignment_policy !==
        ASSIGNMENT_POLICY
      ) {
        throw new Error(
          "youtube_analytics_experiment_assignment_policy_invalid",
        );
      }
      const creativeManifest =
        readAssignmentCreativeManifest(assignment);
      if (creativeManifest.published_at !== published.toISOString()) {
        throw new Error(
          "youtube_analytics_published_at_assignment_mismatch",
        );
      }
      const normalisedMetrics = normaliseMetrics(metrics);
      const derivedRetention = deriveEarlyRetentionMetrics({
        retentionCurve: breakdowns?.retention_curve,
        runtimeSeconds: creativeManifest.runtime_seconds,
        creativeManifestSha256:
          assignment.creative_manifest_sha256,
        observedMetrics: normalisedMetrics,
      });
      const persistedMetrics = {
        ...normalisedMetrics,
        ...derivedRetention.metrics,
      };
      const normalisedBreakdowns = normaliseBreakdowns(breakdowns);
      if (
        !sourcePayload ||
        typeof sourcePayload !== "object"
      ) {
        throw new Error("youtube_analytics_source_payload_required");
      }
      const observedMetrics = Object.keys(normalisedMetrics).sort();
      const requestEvidence =
        sourceRequest && typeof sourceRequest === "object"
          ? sourceRequest
          : {
              channel_id: identity.channelId,
              youtube_channel_id: identity.youtubeChannelId,
              snapshot_window: normalisedWindow,
              video_id: identity.videoId,
            };
      const evidence = {
        ...identity,
        snapshotWindow: normalisedWindow,
        publishedAt: published.toISOString(),
        collectedAt: collected.toISOString(),
        metrics: normalisedMetrics,
        derivedMetrics: derivedRetention.metrics,
        metricDerivations: derivedRetention.derivations,
        breakdowns: breakdowns || {},
        sourcePayload,
        sourceRequest: requestEvidence,
      };
      const sourceFingerprint = crypto
        .createHash("sha256")
        .update(stableJson(evidence))
        .digest("hex");
      const existing = getSnapshotStatement.get(
        identity.experimentId,
        identity.channelId,
        identity.youtubeChannelId,
        identity.videoId,
        normalisedWindow,
      );
      if (existing) {
        if (existing.source_fingerprint !== sourceFingerprint) {
          throw new Error("youtube_analytics_snapshot_conflict");
        }
        return existing;
      }
      const values = Object.fromEntries(
        METRIC_COLUMNS.map((column) => [
          column,
          Object.hasOwn(persistedMetrics, column)
            ? persistedMetrics[column]
            : null,
        ]),
      );
      for (const column of Object.values(BREAKDOWN_COLUMNS)) {
        values[column] = normalisedBreakdowns[column] || null;
      }
      const result = insertSnapshot.run({
        ...values,
        experimentId: identity.experimentId,
        experimentCellId: assignment.id,
        channelId: identity.channelId,
        youtubeChannelId: identity.youtubeChannelId,
        storyId: identity.storyId,
        videoId: identity.videoId,
        snapshotWindow: normalisedWindow,
        publishedAt: published.toISOString(),
        snapshotDueAt: dueAt.toISOString(),
        collectedAt: collected.toISOString(),
        sourceFingerprint,
        observedMetricsJson: stableJson(observedMetrics),
        metricDerivationsJson: stableJson(
          derivedRetention.derivations,
        ),
        sourceRequestJson: stableJson(requestEvidence),
        sourcePayloadJson: stableJson(sourcePayload),
      });
      return getById.get(result.lastInsertRowid);
    },
  );

  return {
    getSnapshot({
      experimentId,
      channelId,
      youtubeChannelId,
      videoId,
      snapshotWindow,
    } = {}) {
      return (
        getSnapshotStatement.get(
          requireText(
            experimentId,
            "youtube_analytics_experiment_id_required",
          ),
          requireText(channelId, "youtube_analytics_channel_id_required"),
          requireText(
            youtubeChannelId,
            "youtube_analytics_youtube_channel_id_required",
          ),
          requireText(videoId, "youtube_analytics_video_id_required"),
          requireText(
            snapshotWindow,
            "youtube_analytics_snapshot_window_required",
          ),
        ) || null
      );
    },
    recordSnapshot(input) {
      return recordSnapshotTransaction(input || {});
    },
  };
}

module.exports = {
  BREAKDOWN_COLUMNS,
  METRIC_COLUMNS,
  SNAPSHOT_WINDOWS_MS,
  bind,
};
