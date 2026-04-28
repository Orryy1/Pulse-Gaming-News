"use strict";

/**
 * lib/intelligence/analytics-client.js — Session 3 (intelligence pass).
 *
 * Read-only YouTube analytics client with two modes:
 *   - mode: 'fixture' (default) — synthetic snapshot data, no network
 *   - mode: 'real'              — calls youtubeAnalytics.reports.query
 *                                 ONLY when the operator has
 *                                 explicitly authorised yt-analytics
 *                                 scopes. The function refuses to run
 *                                 without `INTELLIGENCE_REAL_MODE=true`
 *                                 set by the operator.
 *
 * This module never triggers OAuth, never prints tokens, and never
 * mutates production data. It only READS. Snapshot rows it produces
 * land in the local `video_performance_snapshots` table via the
 * caller; the client itself returns plain objects.
 *
 * Required scopes for real mode:
 *   - https://www.googleapis.com/auth/yt-analytics.readonly
 * (NOT currently in the OAuth scope list at upload_youtube.js — see
 *  PULSE_INTELLIGENCE_MONETISATION_PASS.md §C for the re-auth steps.)
 */

const REQUIRED_REAL_SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

const SNAPSHOT_LABELS = ["+1h", "+3h", "+24h", "+72h", "+7d", "+28d"];

const TARGET_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "subscribersGained",
];

function fixtureSnapshot({ videoId, label, baseSeed = 1 }) {
  // Deterministic pseudo-random — same videoId/label always returns
  // the same numbers so tests don't flap. No real metric data.
  let h = 0;
  const key = `${videoId}|${label}|${baseSeed}`;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  const rand = (n) => {
    h = (h * 9301 + 49297) % 233280;
    return Math.abs(h) % n;
  };
  const stage = SNAPSHOT_LABELS.indexOf(label) + 1;
  return {
    video_id: videoId,
    snapshot_label: label,
    snapshot_at: new Date().toISOString(),
    views: 100 * stage + rand(60),
    watch_time_seconds: (28 + rand(8)) * (100 * stage + rand(60)) * 0.001,
    average_view_duration_seconds: 28 + rand(8),
    average_percentage_viewed: 0.45 + rand(20) / 100,
    likes: Math.round((100 * stage + rand(60)) * (0.05 + rand(3) / 100)),
    comments: Math.round((100 * stage + rand(60)) * (0.012 + rand(2) / 100)),
    subscribers_gained: rand(stage * 4),
    traffic_source: ["SHORTS", "BROWSE", "SUBSCRIBER", "SEARCH"][rand(4)],
    shorts_feed_views: Math.round((100 * stage + rand(60)) * 0.6),
    raw_json: JSON.stringify({ source: "fixture", baseSeed }),
    fixture: true,
  };
}

function fixturePullForVideo(videoId, baseSeed = 1) {
  return SNAPSHOT_LABELS.map((label) =>
    fixtureSnapshot({ videoId, label, baseSeed }),
  );
}

function buildAnalyticsClient(opts = {}) {
  const mode =
    opts.mode || process.env.INTELLIGENCE_ANALYTICS_MODE || "fixture";
  if (mode !== "fixture" && mode !== "real") {
    throw new Error(`unknown analytics mode "${mode}"`);
  }
  if (mode === "real" && process.env.INTELLIGENCE_REAL_MODE !== "true") {
    throw new Error(
      "real mode requires INTELLIGENCE_REAL_MODE=true plus an OAuth token with yt-analytics.readonly. See PULSE_INTELLIGENCE_MONETISATION_PASS.md §C.",
    );
  }
  return {
    mode,
    requiredScopes: REQUIRED_REAL_SCOPES,
    snapshotLabels: SNAPSHOT_LABELS.slice(),
    targetMetrics: TARGET_METRICS.slice(),
    async pullSnapshotsForVideo(videoId, options = {}) {
      if (mode === "fixture") {
        return fixturePullForVideo(videoId, options.baseSeed ?? 1);
      }
      // Real mode: structurally implement the call but refuse to fire
      // without an explicit authorised google client. The caller is
      // expected to pre-flight scope verification — this client does
      // not initiate OAuth.
      const auth = options.authClient;
      if (!auth) {
        throw new Error(
          "real mode requires options.authClient (a googleapis OAuth2 client with yt-analytics.readonly granted). This client never initiates OAuth.",
        );
      }
      const { google } = require("googleapis");
      const ya = google.youtubeAnalytics({ version: "v2", auth });
      const start =
        options.startDate ||
        new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = options.endDate || new Date().toISOString().slice(0, 10);
      const resp = await ya.reports.query({
        ids: "channel==MINE",
        startDate: start,
        endDate: end,
        metrics: TARGET_METRICS.join(","),
        filters: `video==${videoId}`,
      });
      return [
        {
          video_id: videoId,
          snapshot_label: options.label || "+24h",
          snapshot_at: new Date().toISOString(),
          raw_json: JSON.stringify(resp.data),
          fixture: false,
        },
      ];
    },
    async pullSnapshotsForVideos(videoIds = [], options = {}) {
      const out = [];
      for (const id of videoIds) {
        try {
          const rows = await this.pullSnapshotsForVideo(id, options);
          for (const r of rows) out.push(r);
        } catch (err) {
          out.push({
            video_id: id,
            error: err.message,
            snapshot_label: options.label || "+24h",
            fixture: mode === "fixture",
          });
        }
      }
      return out;
    },
    describe() {
      return {
        mode,
        requiredScopes: REQUIRED_REAL_SCOPES,
        snapshotLabels: SNAPSHOT_LABELS,
        targetMetrics: TARGET_METRICS,
      };
    },
  };
}

module.exports = {
  buildAnalyticsClient,
  fixtureSnapshot,
  fixturePullForVideo,
  SNAPSHOT_LABELS,
  TARGET_METRICS,
  REQUIRED_REAL_SCOPES,
};
