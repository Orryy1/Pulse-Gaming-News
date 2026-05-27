"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("../../package.json");

const {
  REQUIRED_YT_ANALYTICS_SCOPE,
  buildRetentionQuery,
  buildTrafficSourceQuery,
  mapRetentionReportRows,
  mapTrafficSourceReportRows,
  buildYouTubeAnalyticsIngestionPacket,
  renderYouTubeAnalyticsIngestionMarkdown,
} = require("../../lib/intelligence/youtube-analytics-ingestion-packet");

test("youtube analytics packet: blocked until yt-analytics.readonly is granted", () => {
  const packet = buildYouTubeAnalyticsIngestionPacket({
    videoIds: ["yt1"],
    tokenStatus: { exists: true, yt_analytics_scope: "missing" },
    env: {},
  });

  assert.equal(packet.verdict, "BLOCKED");
  assert.equal(packet.status, "requires_youtube_scope_reauth");
  assert.equal(packet.safety.oauth_triggered, false);
  assert.equal(packet.safety.production_db_mutated, false);
  assert.match(packet.next_actions[0], /re-auth/i);
});

test("youtube analytics packet: retention query is read-only and scoped to one video", () => {
  const query = buildRetentionQuery({
    videoId: "abc123",
    startDate: "2026-05-01",
    endDate: "2026-05-07",
  });

  assert.equal(query.ids, "channel==MINE");
  assert.equal(query.startDate, "2026-05-01");
  assert.equal(query.endDate, "2026-05-07");
  assert.equal(query.dimensions, "elapsedVideoTimeRatio");
  assert.equal(query.metrics, "audienceWatchRatio,relativeRetentionPerformance");
  assert.equal(query.filters, "video==abc123");
});

test("youtube analytics packet: traffic-source query captures source breakdown", () => {
  const query = buildTrafficSourceQuery({
    videoId: "abc123",
    startDate: "2026-05-01",
    endDate: "2026-05-07",
  });

  assert.equal(query.dimensions, "insightTrafficSourceType");
  assert.match(query.metrics, /views/);
  assert.match(query.metrics, /estimatedMinutesWatched/);
  assert.equal(query.filters, "video==abc123");
});

test("youtube analytics packet: retention rows are normalised without raw token data", () => {
  const rows = mapRetentionReportRows({
    videoId: "abc123",
    data: {
      columnHeaders: [
        { name: "elapsedVideoTimeRatio" },
        { name: "audienceWatchRatio" },
        { name: "relativeRetentionPerformance" },
      ],
      rows: [
        [0, 1, 1.1],
        [0.25, 0.72, 0.9],
      ],
    },
  });

  assert.deepEqual(rows[0], {
    video_id: "abc123",
    elapsed_video_time_ratio: 0,
    audience_watch_ratio: 1,
    relative_retention_performance: 1.1,
  });
  assert.equal(JSON.stringify(rows).includes("access_token"), false);
});

test("youtube analytics packet: traffic-source rows are normalised", () => {
  const rows = mapTrafficSourceReportRows({
    videoId: "abc123",
    data: {
      columnHeaders: [
        { name: "insightTrafficSourceType" },
        { name: "views" },
        { name: "estimatedMinutesWatched" },
        { name: "averageViewDuration" },
        { name: "averageViewPercentage" },
      ],
      rows: [["SHORTS", 123, 45.5, 22.4, 63.1]],
    },
  });

  assert.deepEqual(rows[0], {
    video_id: "abc123",
    traffic_source_type: "SHORTS",
    views: 123,
    estimated_minutes_watched: 45.5,
    average_view_duration_seconds: 22.4,
    average_percentage_viewed: 63.1,
  });
});

test("youtube analytics packet: granted scope produces a dry-run plan without network calls", () => {
  const packet = buildYouTubeAnalyticsIngestionPacket({
    videoIds: ["yt1", "yt2"],
    tokenStatus: { exists: true, yt_analytics_scope: "granted" },
    env: {},
  });

  assert.equal(packet.verdict, "READY_DRY_RUN");
  assert.equal(packet.required_scope, REQUIRED_YT_ANALYTICS_SCOPE);
  assert.equal(packet.planned_queries.length, 4);
  assert.equal(packet.safety.network_called, false);
  assert.equal(packet.safety.oauth_triggered, false);
});

test("youtube analytics packet: Markdown is operator-readable and ASCII-safe", () => {
  const packet = buildYouTubeAnalyticsIngestionPacket({
    videoIds: ["yt1"],
    tokenStatus: { exists: true, yt_analytics_scope: "missing" },
    env: {},
  });
  const markdown = renderYouTubeAnalyticsIngestionMarkdown(packet);
  assert.match(markdown, /^# YouTube Analytics Ingestion Packet/m);
  assert.doesNotMatch(markdown, /â|Â|PokÃ/);
  assert.match(markdown, /No OAuth was triggered/);
});

test("youtube analytics packet: local operator command is registered", () => {
  assert.equal(
    packageJson.scripts["ops:youtube-analytics-packet"],
    "node tools/youtube-analytics-ingestion-packet.js",
  );
});
