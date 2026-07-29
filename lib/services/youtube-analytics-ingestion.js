"use strict";

const {
  SNAPSHOT_WINDOWS_MS,
} = require("../repositories/youtube_analytics_experiment_snapshots");

function requireText(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function readDate(value, code) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}

function createYouTubeAnalyticsIngestionService({
  snapshots,
  analyticsAdapter,
  now = () => new Date(),
} = {}) {
  if (
    !snapshots ||
    typeof snapshots.recordSnapshot !== "function" ||
    typeof snapshots.getSnapshot !== "function"
  ) {
    throw new Error("youtube_analytics_snapshot_repository_required");
  }
  if (
    !analyticsAdapter ||
    typeof analyticsAdapter.fetchVideoSnapshot !== "function"
  ) {
    throw new Error("youtube_analytics_readonly_adapter_required");
  }
  if (typeof now !== "function") {
    throw new Error("youtube_analytics_clock_required");
  }

  return Object.freeze({
    async ingestSnapshot({
      experimentId,
      channelId,
      youtubeChannelId,
      storyId,
      videoId,
      snapshotWindow,
      publishedAt,
      signal,
    } = {}) {
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
      const published = readDate(
        publishedAt,
        "youtube_analytics_published_at_required",
      );
      const collected = readDate(
        now(),
        "youtube_analytics_collection_time_invalid",
      );
      if (collected.getTime() < published.getTime() + windowMs) {
        throw new Error("youtube_analytics_snapshot_window_not_due");
      }
      const adapterResult = await analyticsAdapter.fetchVideoSnapshot({
        channelId: identity.youtubeChannelId,
        videoId: identity.videoId,
        snapshotWindow: normalisedWindow,
        startDate: published.toISOString().slice(0, 10),
        endDate: collected.toISOString().slice(0, 10),
        includeBreakdowns: true,
        ...(signal ? { signal } : {}),
      });
      if (
        adapterResult?.channelId !== identity.youtubeChannelId ||
        adapterResult?.videoId !== identity.videoId ||
        adapterResult?.snapshotWindow !== normalisedWindow
      ) {
        throw new Error("youtube_analytics_adapter_identity_mismatch");
      }
      if (adapterResult.status === "no_data") {
        return {
          status: "no_data",
          persisted: false,
          completeness_status: "PENDING_REPORTING_LAG",
          identity: {
            ...identity,
            snapshotWindow: normalisedWindow,
          },
          sourceRequest: adapterResult.sourceRequest,
          sourcePayload: adapterResult.sourcePayload,
          warnings: Array.isArray(adapterResult.warnings)
            ? adapterResult.warnings
            : [],
        };
      }
      if (adapterResult.status !== "collected") {
        throw new Error("youtube_analytics_adapter_result_invalid");
      }
      const snapshot = snapshots.recordSnapshot({
        ...identity,
        snapshotWindow: normalisedWindow,
        publishedAt: published.toISOString(),
        collectedAt: collected.toISOString(),
        metrics: adapterResult.metrics,
        breakdowns: adapterResult.breakdowns,
        sourceRequest: adapterResult.sourceRequest,
        sourcePayload: adapterResult.sourcePayload,
      });
      const warnings = Array.isArray(adapterResult.warnings)
        ? adapterResult.warnings
        : [];
      return {
        status: "collected",
        persisted: true,
        completeness_status:
          warnings.length > 0
            ? "COMPLETE_WITH_WARNINGS"
            : "COMPLETE",
        warnings,
        snapshot,
      };
    },
  });
}

module.exports = {
  createYouTubeAnalyticsIngestionService,
  readDate,
};
