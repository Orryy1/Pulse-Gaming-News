"use strict";

const REQUIRED_YT_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

const RETENTION_METRICS =
  "audienceWatchRatio,relativeRetentionPerformance";
const TRAFFIC_SOURCE_METRICS =
  "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage";

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function reportRows(data = {}) {
  const headers = Array.isArray(data.columnHeaders) ? data.columnHeaders : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return rows
    .filter((row) => Array.isArray(row))
    .map((row) => {
      const out = {};
      headers.forEach((header, index) => {
        if (header && header.name) out[header.name] = row[index];
      });
      return out;
    });
}

function buildRetentionQuery({ videoId, startDate, endDate } = {}) {
  return {
    ids: "channel==MINE",
    startDate,
    endDate,
    dimensions: "elapsedVideoTimeRatio",
    metrics: RETENTION_METRICS,
    filters: `video==${videoId}`,
  };
}

function buildTrafficSourceQuery({ videoId, startDate, endDate } = {}) {
  return {
    ids: "channel==MINE",
    startDate,
    endDate,
    dimensions: "insightTrafficSourceType",
    metrics: TRAFFIC_SOURCE_METRICS,
    filters: `video==${videoId}`,
  };
}

function mapRetentionReportRows({ videoId, data = {} } = {}) {
  return reportRows(data).map((row) => ({
    video_id: videoId,
    elapsed_video_time_ratio: numberOrNull(row.elapsedVideoTimeRatio),
    audience_watch_ratio: numberOrNull(row.audienceWatchRatio),
    relative_retention_performance: numberOrNull(
      row.relativeRetentionPerformance,
    ),
  }));
}

function mapTrafficSourceReportRows({ videoId, data = {} } = {}) {
  return reportRows(data).map((row) => ({
    video_id: videoId,
    traffic_source_type: String(row.insightTrafficSourceType || "UNKNOWN"),
    views: numberOrNull(row.views),
    estimated_minutes_watched: numberOrNull(row.estimatedMinutesWatched),
    average_view_duration_seconds: numberOrNull(row.averageViewDuration),
    average_percentage_viewed: numberOrNull(row.averageViewPercentage),
  }));
}

function normaliseVideoIds(videoIds = []) {
  return [...new Set((videoIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
}

function defaultDateWindow(now = new Date()) {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 28 * 86400000)
    .toISOString()
    .slice(0, 10);
  return { startDate: start, endDate: end };
}

function buildYouTubeAnalyticsIngestionPacket({
  videoIds = [],
  tokenStatus = {},
  env = process.env,
  generatedAt = new Date().toISOString(),
  startDate,
  endDate,
} = {}) {
  const ids = normaliseVideoIds(videoIds);
  const dates =
    startDate && endDate ? { startDate, endDate } : defaultDateWindow();
  const scopeStatus = tokenStatus.yt_analytics_scope || "unknown";
  const realMode =
    String(env.INTELLIGENCE_ANALYTICS_MODE || "").toLowerCase() === "real" &&
    String(env.INTELLIGENCE_REAL_MODE || "").toLowerCase() === "true";

  let verdict = "BLOCKED";
  let status = "youtube_token_missing";
  const nextActions = [];

  if (scopeStatus === "granted") {
    verdict = realMode ? "READY_REAL_MODE" : "READY_DRY_RUN";
    status = realMode ? "real_mode_ready" : "dry_run_ready";
    if (!realMode) {
      nextActions.push(
        "Keep this as dry-run until Martin approves real read-only ingestion.",
      );
    } else {
      nextActions.push(
        "Run the read-only ingestion command and write snapshots only after the operator confirms the target window.",
      );
    }
  } else if (scopeStatus === "missing") {
    status = "requires_youtube_scope_reauth";
    nextActions.push(
      "Run a YouTube OAuth re-auth with yt-analytics.readonly when Martin approves it.",
    );
  } else if (tokenStatus.exists) {
    status = "scope_unknown";
    nextActions.push(
      "Confirm YouTube token scopes or re-auth with yt-analytics.readonly.",
    );
  } else {
    nextActions.push(
      "Create or restore the YouTube token before attempting analytics ingestion.",
    );
  }

  const plannedQueries = [];
  for (const videoId of ids) {
    plannedQueries.push({
      kind: "retention_curve",
      video_id: videoId,
      query: buildRetentionQuery({ videoId, ...dates }),
    });
    plannedQueries.push({
      kind: "traffic_source",
      video_id: videoId,
      query: buildTrafficSourceQuery({ videoId, ...dates }),
    });
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict,
    status,
    required_scope: REQUIRED_YT_ANALYTICS_SCOPE,
    video_count: ids.length,
    start_date: dates.startDate,
    end_date: dates.endDate,
    planned_queries: plannedQueries,
    output_targets: {
      retention_snapshot_schema: [
        "video_id",
        "elapsed_video_time_ratio",
        "audience_watch_ratio",
        "relative_retention_performance",
      ],
      traffic_source_snapshot_schema: [
        "video_id",
        "traffic_source_type",
        "views",
        "estimated_minutes_watched",
        "average_view_duration_seconds",
        "average_percentage_viewed",
      ],
    },
    safety: {
      oauth_triggered: false,
      network_called: false,
      token_values_printed: false,
      production_db_mutated: false,
      scoring_weights_changed: false,
      social_posting_triggered: false,
    },
    next_actions: nextActions,
  };
}

function renderYouTubeAnalyticsIngestionMarkdown(packet) {
  const lines = [];
  lines.push("# YouTube Analytics Ingestion Packet");
  lines.push("");
  lines.push(`Generated: ${packet.generated_at}`);
  lines.push(`Verdict: ${packet.verdict}`);
  lines.push(`Status: ${packet.status}`);
  lines.push(`Window: ${packet.start_date} to ${packet.end_date}`);
  lines.push(`Videos: ${packet.video_count}`);
  lines.push("");
  lines.push("## Planned Read-Only Queries");
  if (!packet.planned_queries.length) {
    lines.push("- none");
  }
  for (const item of packet.planned_queries) {
    lines.push(
      `- ${item.kind}: ${item.video_id} (${item.query.dimensions}; ${item.query.metrics})`,
    );
  }
  lines.push("");
  lines.push("## Output Schemas");
  lines.push(
    `- retention: ${packet.output_targets.retention_snapshot_schema.join(", ")}`,
  );
  lines.push(
    `- traffic_source: ${packet.output_targets.traffic_source_snapshot_schema.join(", ")}`,
  );
  lines.push("");
  lines.push("## Safety");
  lines.push("- No OAuth was triggered.");
  lines.push("- No network call was made by this packet.");
  lines.push("- No token values were printed.");
  lines.push("- No production DB rows were mutated.");
  lines.push("- No social posting was triggered.");
  lines.push("");
  lines.push("## Next Actions");
  for (const action of packet.next_actions || []) {
    lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  REQUIRED_YT_ANALYTICS_SCOPE,
  RETENTION_METRICS,
  TRAFFIC_SOURCE_METRICS,
  buildRetentionQuery,
  buildTrafficSourceQuery,
  mapRetentionReportRows,
  mapTrafficSourceReportRows,
  buildYouTubeAnalyticsIngestionPacket,
  renderYouTubeAnalyticsIngestionMarkdown,
};
