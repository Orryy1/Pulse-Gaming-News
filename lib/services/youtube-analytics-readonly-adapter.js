"use strict";

const REQUIRED_READONLY_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
]);

const SUMMARY_METRICS = Object.freeze([
  "views",
  "engagedViews",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
]);

const SUMMARY_METRIC_MAP = Object.freeze({
  views: "views",
  engagedViews: "engaged_views",
  averageViewDuration: "average_view_duration_seconds",
  averageViewPercentage: "average_percentage_viewed",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  subscribersGained: "subscribers_gained",
  subscribersLost: "subscribers_lost",
});

const SNAPSHOT_WINDOWS = new Set(["24h", "48h", "7d"]);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function identity(value, code) {
  const result = String(value || "").trim();
  if (!result || !ID_PATTERN.test(result)) throw new Error(code);
  return result;
}

function date(value, code) {
  const result = String(value || "").trim();
  if (!DATE_PATTERN.test(result) || Number.isNaN(new Date(result).getTime())) {
    throw new Error(code);
  }
  return result;
}

function reportData(response) {
  const value = response?.data || response;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("youtube_analytics_report_payload_invalid");
  }
  return value;
}

function rowObject(payload, row) {
  const headers = Array.isArray(payload.columnHeaders)
    ? payload.columnHeaders
    : [];
  if (!Array.isArray(row) || headers.length !== row.length) {
    throw new Error("youtube_analytics_report_shape_invalid");
  }
  return Object.fromEntries(
    headers.map((header, index) => [
      String(header?.name || "").trim(),
      row[index],
    ]),
  );
}

function observedNumber(value, metricName) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`youtube_analytics_metric_invalid:${metricName}`);
  }
  return value;
}

function finiteNumber(value, metricName, { nonNegative = false } = {}) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (nonNegative && value < 0)
  ) {
    throw new Error(`youtube_analytics_metric_invalid:${metricName}`);
  }
  return value;
}

function reportIdentity(value, metricName, pattern = ID_PATTERN) {
  const result = String(value || "").trim();
  if (!result || !pattern.test(result)) {
    throw new Error(`youtube_analytics_metric_invalid:${metricName}`);
  }
  return result;
}

function reportPercent(value, metricName) {
  const result = finiteNumber(value, metricName, { nonNegative: true });
  if (result > 100) {
    throw new Error(`youtube_analytics_metric_invalid:${metricName}`);
  }
  return result;
}

function createYouTubeAnalyticsReadonlyAdapter({ queryReports } = {}) {
  if (typeof queryReports !== "function") {
    throw new Error("youtube_analytics_readonly_query_required");
  }

  return Object.freeze({
    async fetchVideoSnapshot({
      channelId,
      videoId,
      snapshotWindow,
      startDate,
      endDate,
      includeBreakdowns = false,
    } = {}) {
      const normalisedChannelId = identity(
        channelId,
        "youtube_analytics_channel_id_required",
      );
      const normalisedVideoId = identity(
        videoId,
        "youtube_analytics_video_id_required",
      );
      const normalisedWindow = String(snapshotWindow || "").trim();
      if (!SNAPSHOT_WINDOWS.has(normalisedWindow)) {
        throw new Error("youtube_analytics_snapshot_window_invalid");
      }
      const normalisedStartDate = date(
        startDate,
        "youtube_analytics_start_date_required",
      );
      const normalisedEndDate = date(
        endDate,
        "youtube_analytics_end_date_required",
      );
      if (normalisedStartDate > normalisedEndDate) {
        throw new Error("youtube_analytics_date_range_invalid");
      }
      const request = {
        dimensions: "video",
        endDate: normalisedEndDate,
        filters: `video==${normalisedVideoId}`,
        ids: `channel==${normalisedChannelId}`,
        metrics: SUMMARY_METRICS.join(","),
        startDate: normalisedStartDate,
      };
      const payload = reportData(await queryReports(request));
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (rows.length === 0) {
        return {
          status: "no_data",
          channelId: normalisedChannelId,
          videoId: normalisedVideoId,
          snapshotWindow: normalisedWindow,
          metrics: {},
          sourceRequest: { summary: request },
          sourcePayload: { summary: payload },
        };
      }
      if (rows.length !== 1) {
        throw new Error("youtube_analytics_video_row_ambiguous");
      }
      const source = rowObject(payload, rows[0]);
      if (String(source.video || "").trim() !== normalisedVideoId) {
        throw new Error("youtube_analytics_video_identity_mismatch");
      }
      const metrics = {};
      for (const [sourceName, targetName] of Object.entries(
        SUMMARY_METRIC_MAP,
      )) {
        if (!Object.hasOwn(source, sourceName)) continue;
        const value = observedNumber(source[sourceName], sourceName);
        if (value !== null) metrics[targetName] = value;
      }
      if (Object.hasOwn(source, "estimatedMinutesWatched")) {
        const minutes = observedNumber(
          source.estimatedMinutesWatched,
          "estimatedMinutesWatched",
        );
        if (minutes !== null) metrics.watch_hours = minutes / 60;
      }
      const sourceRequest = { summary: request };
      const sourcePayload = { summary: payload };
      const breakdowns = {};
      if (includeBreakdowns === true) {
        const retentionRequest = {
          dimensions: "elapsedVideoTimeRatio",
          endDate: normalisedEndDate,
          filters: `video==${normalisedVideoId}`,
          ids: `channel==${normalisedChannelId}`,
          metrics: "audienceWatchRatio,relativeRetentionPerformance",
          startDate: normalisedStartDate,
        };
        const retentionPayload = reportData(
          await queryReports(retentionRequest),
        );
        const retentionRows = Array.isArray(retentionPayload.rows)
          ? retentionPayload.rows
          : [];
        const retentionCurve = retentionRows.map((row) => {
          const point = rowObject(retentionPayload, row);
          return {
            elapsed_video_time_ratio: finiteNumber(
              point.elapsedVideoTimeRatio,
              "elapsedVideoTimeRatio",
              { nonNegative: true },
            ),
            audience_watch_ratio: finiteNumber(
              point.audienceWatchRatio,
              "audienceWatchRatio",
              { nonNegative: true },
            ),
            relative_retention_performance: finiteNumber(
              point.relativeRetentionPerformance,
              "relativeRetentionPerformance",
            ),
          };
        });
        breakdowns.retention_curve = retentionCurve;
        const retentionTargets = new Map([
          [0.25, "retention_25_percent"],
          [0.5, "retention_50_percent"],
          [0.75, "retention_75_percent"],
          [0.9, "retention_90_percent"],
          [1, "completion_percent"],
        ]);
        for (const point of retentionCurve) {
          const target = retentionTargets.get(
            point.elapsed_video_time_ratio,
          );
          if (target) {
            metrics[target] = point.audience_watch_ratio * 100;
          }
        }

        const trafficRequest = {
          dimensions: "insightTrafficSourceType",
          endDate: normalisedEndDate,
          filters: `video==${normalisedVideoId}`,
          ids: `channel==${normalisedChannelId}`,
          metrics: "views,estimatedMinutesWatched",
          startDate: normalisedStartDate,
        };
        const trafficPayload = reportData(await queryReports(trafficRequest));
        const trafficRows = Array.isArray(trafficPayload.rows)
          ? trafficPayload.rows
          : [];
        breakdowns.traffic_sources = trafficRows.map((row) => {
          const point = rowObject(trafficPayload, row);
          const sourceType = String(
            point.insightTrafficSourceType || "",
          ).trim();
          if (!sourceType) {
            throw new Error("youtube_analytics_traffic_source_invalid");
          }
          return {
            source: sourceType,
            views: finiteNumber(point.views, "trafficSourceViews", {
              nonNegative: true,
            }),
            watch_minutes: finiteNumber(
              point.estimatedMinutesWatched,
              "trafficSourceEstimatedMinutesWatched",
              { nonNegative: true },
            ),
          };
        });
        sourceRequest.retention = retentionRequest;
        sourceRequest.traffic_sources = trafficRequest;
        sourcePayload.retention = retentionPayload;
        sourcePayload.traffic_sources = trafficPayload;

        const audienceBreakdownDefinitions = [
          {
            key: "country",
            dimensions: "country",
            metrics: "engagedViews,views,estimatedMinutesWatched",
            mapRow(point) {
              return {
                country: reportIdentity(
                  point.country,
                  "country",
                  /^[A-Z]{2}$/,
                ),
                engaged_views: finiteNumber(
                  point.engagedViews,
                  "countryEngagedViews",
                  { nonNegative: true },
                ),
                views: finiteNumber(point.views, "countryViews", {
                  nonNegative: true,
                }),
                watch_minutes: finiteNumber(
                  point.estimatedMinutesWatched,
                  "countryEstimatedMinutesWatched",
                  { nonNegative: true },
                ),
              };
            },
          },
          {
            key: "age",
            dimensions: "ageGroup",
            metrics: "viewerPercentage",
            mapRow(point) {
              return {
                age_group: reportIdentity(
                  point.ageGroup,
                  "ageGroup",
                  /^age(?:13-17|18-24|25-34|35-44|45-54|55-64|65-)$/,
                ),
                viewer_percentage: reportPercent(
                  point.viewerPercentage,
                  "viewerPercentage",
                ),
              };
            },
          },
          {
            key: "device",
            dimensions: "deviceType",
            metrics: "engagedViews,views,estimatedMinutesWatched",
            mapRow(point) {
              return {
                device_type: reportIdentity(
                  point.deviceType,
                  "deviceType",
                  /^[A-Z_]+$/,
                ),
                engaged_views: finiteNumber(
                  point.engagedViews,
                  "deviceEngagedViews",
                  { nonNegative: true },
                ),
                views: finiteNumber(point.views, "deviceViews", {
                  nonNegative: true,
                }),
                watch_minutes: finiteNumber(
                  point.estimatedMinutesWatched,
                  "deviceEstimatedMinutesWatched",
                  { nonNegative: true },
                ),
              };
            },
          },
        ];
        for (const definition of audienceBreakdownDefinitions) {
          const breakdownRequest = {
            dimensions: definition.dimensions,
            endDate: normalisedEndDate,
            filters: `video==${normalisedVideoId}`,
            ids: `channel==${normalisedChannelId}`,
            metrics: definition.metrics,
            startDate: normalisedStartDate,
          };
          const breakdownPayload = reportData(
            await queryReports(breakdownRequest),
          );
          const breakdownRows = Array.isArray(breakdownPayload.rows)
            ? breakdownPayload.rows
            : [];
          breakdowns[definition.key] = breakdownRows.map((row) =>
            definition.mapRow(rowObject(breakdownPayload, row)),
          );
          sourceRequest[definition.key] = breakdownRequest;
          sourcePayload[definition.key] = breakdownPayload;
        }
      }
      return {
        status: "collected",
        channelId: normalisedChannelId,
        videoId: normalisedVideoId,
        snapshotWindow: normalisedWindow,
        metrics,
        breakdowns,
        sourceRequest,
        sourcePayload,
      };
    },
  });
}

module.exports = {
  REQUIRED_READONLY_SCOPES,
  SUMMARY_METRICS,
  SUMMARY_METRIC_MAP,
  createYouTubeAnalyticsReadonlyAdapter,
};
