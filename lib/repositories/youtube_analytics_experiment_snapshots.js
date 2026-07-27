"use strict";

const crypto = require("node:crypto");

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
  let manifest;
  try {
    manifest = JSON.parse(json);
  } catch {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    typeof manifest.published_at !== "string"
  ) {
    throw new Error(
      "youtube_analytics_assignment_creative_manifest_invalid",
    );
  }
  return manifest;
}

function bind(db) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("youtube_analytics_snapshot_database_required");
  }
  const getAssignment = db.prepare(`
    SELECT *
    FROM controlled_video_experiment_cells
    WHERE experiment_id = ?
      AND channel_id = ?
      AND video_id = ?
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
      source_request_json, source_payload_json,
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
      @observedMetricsJson, @sourceRequestJson, @sourcePayloadJson,
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
      const creativeManifest =
        readAssignmentCreativeManifest(assignment);
      if (creativeManifest.published_at !== published.toISOString()) {
        throw new Error(
          "youtube_analytics_published_at_assignment_mismatch",
        );
      }
      const normalisedMetrics = normaliseMetrics(metrics);
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
          Object.hasOwn(normalisedMetrics, column)
            ? normalisedMetrics[column]
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
