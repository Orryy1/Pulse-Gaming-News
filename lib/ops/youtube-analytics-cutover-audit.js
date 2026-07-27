"use strict";

const path = require("node:path");
const Database = require("better-sqlite3");
const {
  REQUIRED_READONLY_SCOPES,
} = require("../services/youtube-analytics-readonly-adapter");

const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const YOUTUBE_PLATFORM_VALUES = Object.freeze(["youtube", "youtube_shorts"]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
const GOOGLE_SCOPE_PATTERN =
  /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+$/;

function tableExists(database, tableName) {
  return Boolean(
    database
      .prepare(
        `SELECT 1
           FROM sqlite_master
          WHERE type = 'table' AND name = ?
          LIMIT 1`,
      )
      .get(tableName),
  );
}

function tableColumns(database, tableName) {
  if (!tableExists(database, tableName)) return new Set();
  return new Set(
    database
      .prepare(`PRAGMA table_info("${tableName}")`)
      .all()
      .map((column) => String(column.name)),
  );
}

function selectColumn(columns, name, fallback = "NULL") {
  return columns.has(name) ? `"${name}"` : fallback;
}

function selectQualifiedColumn(columns, alias, name, fallback = "NULL") {
  return columns.has(name) ? `${alias}."${name}"` : fallback;
}

function scopeEntries(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const candidate = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.scopes)
        ? parsed.scopes
        : typeof parsed?.scope === "string"
          ? parsed.scope.split(/[\s,]+/)
          : [];
    return candidate.map((scope) => String(scope).trim()).filter(Boolean);
  } catch {
    return raw
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
}

function parseScopes(value) {
  return [
    ...new Set(
      scopeEntries(value).filter((scope) => GOOGLE_SCOPE_PATTERN.test(scope)),
    ),
  ].sort();
}

function diagnoseScopeMetadata(database, channelId) {
  const columns = tableColumns(database, "platform_accounts");
  if (!columns.has("platform") || !columns.has("token_scope")) {
    return {
      analytics_readonly: "missing_or_unrecorded",
      required_scopes: [...REQUIRED_READONLY_SCOPES],
      recorded_scopes: [],
      redacted_scope_entry_count: 0,
      matching_account_count: 0,
      enabled_matching_account_count: 0,
      metadata_source: "platform_accounts.token_scope",
      live_scope_verified: false,
      token_values_read: false,
      reauthorisation_required: true,
    };
  }
  const channelExpression = selectColumn(columns, "channel_id");
  const enabledExpression = selectColumn(columns, "enabled", "1");
  const rows = database
    .prepare(
      `SELECT ${channelExpression} AS channel_id,
              ${enabledExpression} AS enabled,
              "token_scope" AS token_scope
         FROM platform_accounts
        WHERE lower("platform") = 'youtube'
          AND (? IS NULL OR ${channelExpression} = ?)`,
    )
    .all(channelId || null, channelId || null);
  const enabledRows = rows.filter((row) => Number(row.enabled) === 1);
  const recordedScopes = [
    ...new Set(enabledRows.flatMap((row) => parseScopes(row.token_scope))),
  ].sort();
  const redactedScopeEntryCount = enabledRows.reduce((count, row) => {
    const entries = scopeEntries(row.token_scope);
    return (
      count +
      entries.filter((scope) => !GOOGLE_SCOPE_PATTERN.test(scope)).length
    );
  }, 0);
  const declared = recordedScopes.includes(ANALYTICS_SCOPE);
  return {
    analytics_readonly: declared ? "declared" : "missing_or_unrecorded",
    required_scopes: [...REQUIRED_READONLY_SCOPES],
    recorded_scopes: recordedScopes,
    redacted_scope_entry_count: redactedScopeEntryCount,
    matching_account_count: rows.length,
    enabled_matching_account_count: enabledRows.length,
    metadata_source: "platform_accounts.token_scope",
    live_scope_verified: false,
    token_values_read: false,
    reauthorisation_required: !declared,
  };
}

function hasExplicitTimezone(value) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(String(value || "").trim());
}

function normaliseTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      raw: null,
      utc: null,
      timezone_status: "missing",
    };
  }
  if (!hasExplicitTimezone(raw)) {
    return {
      raw,
      utc: null,
      timezone_status: "timezone_unrecorded",
    };
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    return {
      raw,
      utc: null,
      timezone_status: "invalid",
    };
  }
  return {
    raw,
    utc: new Date(milliseconds).toISOString(),
    timezone_status: "explicit",
  };
}

function publishedRows(database, channelId) {
  const posts = tableColumns(database, "platform_posts");
  const stories = tableColumns(database, "stories");
  const requiredPostColumns = ["story_id", "platform", "status", "external_id"];
  if (requiredPostColumns.some((column) => !posts.has(column))) {
    return {
      rows: [],
      blockers: ["platform_posts_published_identity_schema_incomplete"],
    };
  }
  const storyJoin = stories.has("id")
    ? `LEFT JOIN stories AS story ON story."id" = post."story_id"`
    : "";
  const storyColumn = (name) =>
    storyJoin && stories.has(name) ? `story."${name}"` : "NULL";
  const channelExpression = selectQualifiedColumn(posts, "post", "channel_id");
  const publishedAtExpression = [
    posts.has("published_at") ? `post."published_at"` : null,
    posts.has("updated_at") ? `post."updated_at"` : null,
    posts.has("created_at") ? `post."created_at"` : null,
    storyJoin && stories.has("youtube_published_at")
      ? `story."youtube_published_at"`
      : null,
  ].filter(Boolean);
  const publishedAt = publishedAtExpression.length
    ? `COALESCE(${publishedAtExpression.join(", ")})`
    : "NULL";
  const placeholders = YOUTUBE_PLATFORM_VALUES.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT post."story_id" AS story_id,
              ${channelExpression} AS channel_id,
              post."external_id" AS video_id,
              ${selectQualifiedColumn(posts, "post", "external_url")} AS external_url,
              ${selectQualifiedColumn(posts, "post", "views")} AS views,
              ${selectQualifiedColumn(posts, "post", "likes")} AS likes,
              ${selectQualifiedColumn(posts, "post", "comments")} AS comments,
              ${selectQualifiedColumn(posts, "post", "shares")} AS shares,
              ${selectQualifiedColumn(posts, "post", "stats_fetched_at")} AS stats_fetched_at,
              ${publishedAt} AS published_at,
              ${storyColumn("title")} AS title,
              ${storyColumn("youtube_post_id")} AS projected_video_id
         FROM platform_posts AS post
         ${storyJoin}
        WHERE lower(post."platform") IN (${placeholders})
          AND lower(post."status") = 'published'
          AND trim(COALESCE(post."external_id", '')) <> ''
          AND (? IS NULL OR ${channelExpression} = ?)
        ORDER BY ${publishedAt} DESC, post."story_id" ASC`,
    )
    .all(...YOUTUBE_PLATFORM_VALUES, channelId || null, channelId || null);
  return { rows, blockers: [] };
}

function buildFiveVideoMappings(database, channelId) {
  const selection = publishedRows(database, channelId);
  const blockers = [...selection.blockers];
  const seenVideoIds = new Set();
  const seenStoryIds = new Set();
  const mappings = [];
  for (const row of selection.rows) {
    const storyId = String(row.story_id || "").trim();
    const videoId = String(row.video_id || "").trim();
    if (!storyId || !VIDEO_ID_PATTERN.test(videoId)) {
      blockers.push(`invalid_published_identity:${storyId || "unknown"}`);
      continue;
    }
    if (seenVideoIds.has(videoId)) {
      blockers.push(`duplicate_published_video_id:${videoId}`);
      continue;
    }
    if (seenStoryIds.has(storyId)) {
      blockers.push(`duplicate_published_story_id:${storyId}`);
      continue;
    }
    seenVideoIds.add(videoId);
    seenStoryIds.add(storyId);
    const timestamp = normaliseTimestamp(row.published_at);
    const projectedVideoId = String(row.projected_video_id || "").trim();
    const projectionStatus = !projectedVideoId
      ? "missing"
      : projectedVideoId === videoId
        ? "matching"
        : "mismatch";
    if (projectionStatus === "mismatch") {
      blockers.push(`story_projection_mismatch:${storyId}`);
    }
    if (timestamp.timezone_status !== "explicit") {
      blockers.push(`publish_timezone_unresolved:${storyId}`);
    }
    mappings.push({
      ordinal: mappings.length + 1,
      story_id: storyId,
      video_id: videoId,
      channel_id: String(row.channel_id || channelId || "").trim() || null,
      title: String(row.title || "").trim() || null,
      published_at_source: "platform_posts",
      published_at_raw: timestamp.raw,
      published_at_utc: timestamp.utc,
      publish_timezone_status: timestamp.timezone_status,
      story_projection_status: projectionStatus,
      historical_platform_post_observation: {
        definition:
          "Existing platform_posts counters only; not YouTube Analytics API proof.",
        views: Number.isFinite(row.views) ? row.views : null,
        likes: Number.isFinite(row.likes) ? row.likes : null,
        comments: Number.isFinite(row.comments) ? row.comments : null,
        shares: Number.isFinite(row.shares) ? row.shares : null,
        observed_at: normaliseTimestamp(row.stats_fetched_at).utc,
      },
      analytics_query_status: "not_run",
    });
    if (mappings.length === 5) break;
  }
  if (mappings.length !== 5) {
    blockers.push(
      `exactly_five_published_videos_required:found_${mappings.length}`,
    );
  }
  return {
    mappings,
    blockers: [...new Set(blockers)].sort(),
    eligible_published_rows: selection.rows.length,
  };
}

function createAuditReport({
  database,
  databasePath,
  channelId = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!database || typeof database.prepare !== "function") {
    throw new Error("youtube_analytics_audit_database_required");
  }
  const timestamp = normaliseTimestamp(generatedAt);
  if (!timestamp.utc) {
    throw new Error("youtube_analytics_audit_generated_at_invalid");
  }
  const scopeDiagnosis = diagnoseScopeMetadata(database, channelId);
  const mapping = buildFiveVideoMappings(database, channelId);
  const blockers = [...mapping.blockers];
  if (scopeDiagnosis.analytics_readonly !== "declared") {
    blockers.push("yt_analytics_readonly_scope_missing_or_unrecorded");
  }
  blockers.push("live_youtube_analytics_scope_not_verified");
  blockers.push("youtube_analytics_api_sample_not_collected");
  return {
    schema_version: "pulse-youtube-analytics-cutover-audit-v1",
    generated_at: timestamp.utc,
    operating_mode: "LOCAL_PROOF",
    verdict: "HOLD",
    channel_id: channelId || null,
    source: {
      database_file: path.basename(String(databasePath || "pulse.db")),
      selection:
        "Latest five unique published YouTube platform_posts by publication timestamp, then story ID.",
      eligible_published_rows: mapping.eligible_published_rows,
    },
    scope_diagnosis: scopeDiagnosis,
    mapping_status:
      mapping.mappings.length === 5 && mapping.blockers.length === 0
        ? "ready"
        : "blocked",
    video_mappings: mapping.mappings,
    required_live_sample_fields: [
      "views",
      "engaged_views",
      "stayed_to_watch_or_documented_equivalent",
      "average_percentage_viewed",
      "retention_curve_or_supported_checkpoints",
      "traffic_sources",
      "subscribers_gained",
      "likes",
      "comments",
      "shares",
      "snapshot_time",
      "query_parameters",
    ],
    blockers: [...new Set(blockers)].sort(),
    safety: {
      database_open_mode: "readonly_query_only",
      database_mutated: false,
      external_api_calls: 0,
      oauth_mutated: false,
      token_files_opened: false,
      token_values_read: false,
      token_values_emitted: false,
      platform_objects_created: false,
    },
    limitations: [
      "Recorded scope metadata is not live OAuth token introspection.",
      "Historical platform counters are not substitutes for YouTube Analytics metrics.",
      "This audit creates a five-video identity map only; it does not collect analytics.",
    ],
  };
}

function renderAuditMarkdown(report) {
  const lines = [
    "# YouTube Analytics Cutover Audit",
    "",
    `- Verdict: **${report.verdict}**`,
    `- Generated: ${report.generated_at}`,
    `- Channel: ${report.channel_id || "all"}`,
    `- Analytics scope metadata: ${report.scope_diagnosis.analytics_readonly}`,
    `- Live scope verified: ${report.scope_diagnosis.live_scope_verified}`,
    `- Identity mapping: ${report.mapping_status}`,
    `- Published videos mapped: ${report.video_mappings.length}`,
    "",
    "## Five-video identity map",
    "",
    "| # | Story | Video | Published UTC | Projection |",
    "|---:|---|---|---|---|",
    ...report.video_mappings.map(
      (mapping) =>
        `| ${mapping.ordinal} | ${mapping.story_id} | ${mapping.video_id} | ${
          mapping.published_at_utc || "timezone unresolved"
        } | ${mapping.story_projection_status} |`,
    ),
    "",
    "## Blockers",
    "",
    ...report.blockers.map((blocker) => `- ${blocker}`),
    "",
    "## Safety",
    "",
    "- SQLite opened read-only with query-only enforcement",
    "- No YouTube or OAuth API was called",
    "- No token file or token value was read",
    "- No database row or platform object was changed",
    "",
    "## Boundary",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
  ];
  return lines.join("\n");
}

function runReadOnlyAudit({
  databasePath,
  channelId = null,
  generatedAt,
} = {}) {
  const resolvedPath = path.resolve(String(databasePath || ""));
  if (!databasePath)
    throw new Error("youtube_analytics_audit_db_path_required");
  const database = new Database(resolvedPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma("query_only = ON");
    return createAuditReport({
      database,
      databasePath: resolvedPath,
      channelId,
      generatedAt,
    });
  } finally {
    database.close();
  }
}

module.exports = {
  ANALYTICS_SCOPE,
  buildFiveVideoMappings,
  createAuditReport,
  diagnoseScopeMetadata,
  parseScopes,
  renderAuditMarkdown,
  runReadOnlyAudit,
};
